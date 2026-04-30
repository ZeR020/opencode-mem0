import { getDatabase } from "./src/services/sqlite/sqlite-bootstrap.js";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { log } from "./src/services/logger.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

interface MigrationResult {
  databases: number;
  columnsAdded: number;
  memoriesUpdated: number;
  conflictsTableCreated: number;
  transcriptsDbCreated: boolean;
  errors: string[];
}

/**
 * Detect if a database has the old v1 schema by checking for the absence
 * of key v2 columns (e.g., `store_type`, `strength`).
 */
function isV1Schema(db: DatabaseType): boolean {
  const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
  const columnNames = new Set(columns.map((c) => c.name));
  // If store_type or strength is missing, it's v1
  return !columnNames.has("store_type") || !columnNames.has("strength");
}

/**
 * Add all v2 scoring and lifecycle columns to an existing memories table.
 * Uses safe `ALTER TABLE ADD COLUMN` with IF NOT EXISTS semantics.
 */
function addV2Columns(db: DatabaseType): number {
  const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
  const columnNames = new Set(columns.map((c) => c.name));
  let added = 0;

  const scoringColumns = [
    { name: "recency_score", type: "REAL DEFAULT 0.5" },
    { name: "frequency_score", type: "REAL DEFAULT 0.0" },
    { name: "importance_score", type: "REAL DEFAULT 0.5" },
    { name: "utility_score", type: "REAL DEFAULT 0.3" },
    { name: "novelty_score", type: "REAL DEFAULT 0.5" },
    { name: "confidence_score", type: "REAL DEFAULT 0.7" },
    { name: "interference_penalty", type: "REAL DEFAULT 0.0" },
    { name: "strength", type: "REAL DEFAULT 0.5" },
    { name: "access_count", type: "INTEGER DEFAULT 0" },
    { name: "last_accessed", type: "INTEGER" },
    { name: "store_type", type: "TEXT DEFAULT 'stm'" },
    { name: "decay_rate", type: "REAL DEFAULT 0.05" },
    { name: "is_deprecated", type: "INTEGER DEFAULT 0" },
  ];

  for (const col of scoringColumns) {
    if (!columnNames.has(col.name)) {
      try {
        db.run(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
        added++;
        log(`Migration: added column ${col.name}`);
      } catch (error) {
        log(`Migration: failed to add column ${col.name}`, { error: String(error) });
      }
    }
  }

  return added;
}

/**
 * Backfill default scores for all existing memories that have null/default values.
 * Calculates recency based on created_at, and assigns reasonable defaults
 * for other scores.
 */
function backfillScores(db: DatabaseType): number {
  let updated = 0;

  try {
    const now = Date.now();
    const halfLifeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    const lambda = Math.log(2) / halfLifeMs;

    // Backfill recency based on age
    const recencyStmt = db.prepare(`
      UPDATE memories
      SET recency_score = MAX(0.0, MIN(1.0, EXP(-? * (? - created_at)))),
          strength = CASE
            WHEN strength IS NULL OR strength = 0.5 THEN 0.5
            ELSE strength
          END,
          frequency_score = COALESCE(frequency_score, 0),
          importance_score = COALESCE(importance_score, 0.5),
          utility_score = COALESCE(utility_score, 0.3),
          novelty_score = COALESCE(novelty_score, 0.5),
          confidence_score = COALESCE(confidence_score, 0.7),
          interference_penalty = COALESCE(interference_penalty, 0),
          access_count = COALESCE(access_count, 0),
          store_type = COALESCE(store_type, 'stm'),
          decay_rate = COALESCE(decay_rate, 0.05),
          is_deprecated = COALESCE(is_deprecated, 0)
      WHERE recency_score IS NULL OR recency_score = 0.5
    `);
    const recencyResult = recencyStmt.run(lambda, now);
    updated += Number(recencyResult.changes || 0);

    // Set store_type to 'ltm' for very old, high-quality memories (heuristic)
    const ltmStmt = db.prepare(`
      UPDATE memories
      SET store_type = 'ltm',
          decay_rate = 0.01
      WHERE created_at < ?
        AND (access_count > 3 OR strength > 0.6)
        AND store_type = 'stm'
    `);
    const cutoff = now - 30 * 24 * 60 * 60 * 1000; // 30 days old
    ltmStmt.run(cutoff);

    log("Migration: backfilled scores", { updated });
  } catch (error) {
    log("Migration: backfillScores error", { error: String(error) });
  }

  return updated;
}

/**
 * Create the memory_conflicts table if it doesn't exist.
 */
function createConflictsTable(db: DatabaseType): boolean {
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_conflicts'")
      .get() as any;
    if (exists) return false;

    db.run(`
      CREATE TABLE memory_conflicts (
        id TEXT PRIMARY KEY,
        memory_id_1 TEXT NOT NULL,
        memory_id_2 TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        detected_at INTEGER NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolution_type TEXT,
        resolved_at INTEGER,
        resolution_data TEXT,
        FOREIGN KEY (memory_id_1) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id_2) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    db.run(`CREATE INDEX idx_conflict_m1 ON memory_conflicts(memory_id_1)`);
    db.run(`CREATE INDEX idx_conflict_m2 ON memory_conflicts(memory_id_2)`);
    db.run(`CREATE INDEX idx_conflict_resolved ON memory_conflicts(resolved, detected_at)`);

    log("Migration: created memory_conflicts table");
    return true;
  } catch (error) {
    log("Migration: createConflictsTable error", { error: String(error) });
    return false;
  }
}

/**
 * Create the transcripts database with FTS5 support.
 */
function createTranscriptsDb(storagePath: string): boolean {
  try {
    const dbPath = join(storagePath, "transcripts.db");
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const db = new Database(dbPath);

    db.run(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts(created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_transcripts_project ON transcripts(project_path)`);

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
        messages,
        content='transcripts',
        content_rowid='id'
      )
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_insert
      AFTER INSERT ON transcripts BEGIN
        INSERT INTO transcripts_fts(rowid, messages) VALUES (new.id, new.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_delete
      AFTER DELETE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) VALUES ('delete', old.id, old.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_update
      AFTER UPDATE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) VALUES ('delete', old.id, old.messages);
        INSERT INTO transcripts_fts(rowid, messages) VALUES (new.id, new.messages);
      END
    `);

    db.close();
    log("Migration: created transcripts database");
    return true;
  } catch (error) {
    log("Migration: createTranscriptsDb error", { error: String(error) });
    return false;
  }
}

/**
 * Add missing indexes for v2 performance.
 */
function addV2Indexes(db: DatabaseType): void {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_strength ON memories(strength DESC)",
    "CREATE INDEX IF NOT EXISTS idx_recency ON memories(recency_score DESC)",
    "CREATE INDEX IF NOT EXISTS idx_access_count ON memories(access_count DESC)",
    "CREATE INDEX IF NOT EXISTS idx_store_type ON memories(store_type)",
    "CREATE INDEX IF NOT EXISTS idx_decay_strength ON memories(strength, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_is_deprecated ON memories(is_deprecated)",
  ];

  for (const idx of indexes) {
    try {
      db.run(idx);
    } catch (error) {
      log("Migration: add index failed", { index: idx, error: String(error) });
    }
  }
}

/**
 * Discover all shard databases in the storage path.
 */
function discoverDatabases(storagePath: string): string[] {
  const dbs: string[] = [];
  if (!existsSync(storagePath)) return dbs;

  // Metadata db
  const metaDb = join(storagePath, "metadata.db");
  if (existsSync(metaDb)) dbs.push(metaDb);

  // User and project shards
  for (const subdir of ["users", "projects"]) {
    const dir = join(storagePath, subdir);
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (entry.endsWith(".db") && statSync(fullPath).isFile()) {
          dbs.push(fullPath);
        }
      }
    } catch {
      // ignore
    }
  }

  return dbs;
}

/**
 * Main migration entry point.
 *
 * Usage:
 *   bun run scripts/migrate-v1-to-v2.ts <storagePath>
 *
 * Detects v1 databases, adds all v2 columns and tables, backfills
 * default scores, and creates the transcripts database.
 */
async function migrate(storagePath: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    databases: 0,
    columnsAdded: 0,
    memoriesUpdated: 0,
    conflictsTableCreated: 0,
    transcriptsDbCreated: false,
    errors: [],
  };

  log("Starting v1 -> v2 migration", { storagePath });

  const dbs = discoverDatabases(storagePath);
  log(`Discovered ${dbs.length} databases`);

  for (const dbPath of dbs) {
    try {
      const db = new Database(dbPath);
      const hasMemories = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
        .get() as any;

      if (!hasMemories) {
        db.close();
        continue;
      }

      result.databases++;

      if (isV1Schema(db)) {
        log(`Migrating v1 database: ${dbPath}`);
        const added = addV2Columns(db);
        result.columnsAdded += added;
      } else {
        // Still ensure all columns exist (idempotent)
        const added = addV2Columns(db);
        result.columnsAdded += added;
      }

      const updated = backfillScores(db);
      result.memoriesUpdated += updated;

      const created = createConflictsTable(db);
      if (created) result.conflictsTableCreated++;

      addV2Indexes(db);

      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    } catch (error) {
      const msg = String(error);
      result.errors.push(`${dbPath}: ${msg}`);
      log("Migration: database error", { dbPath, error: msg });
    }
  }

  result.transcriptsDbCreated = createTranscriptsDb(storagePath);

  log("Migration complete", result);
  return result;
}

// CLI entry point
const storagePath = process.argv[2] || join(process.env.HOME || ".", ".opencode-mem", "data");

migrate(storagePath)
  .then((result) => {
    console.log("\n=== Migration Results ===");
    console.log(`Databases processed:     ${result.databases}`);
    console.log(`Columns added:           ${result.columnsAdded}`);
    console.log(`Memories backfilled:     ${result.memoriesUpdated}`);
    console.log(`Conflicts tables created: ${result.conflictsTableCreated}`);
    console.log(`Transcripts DB created:   ${result.transcriptsDbCreated ? "yes" : "no (already exists)"}`);
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      result.errors.forEach((e) => console.log(`  - ${e}`));
      process.exit(1);
    }
    console.log("\nMigration completed successfully!");
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
