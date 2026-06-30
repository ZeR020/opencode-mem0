import { type Database } from "./sqlite-bootstrap.js";
import { join, basename } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { CONFIG } from "../../config.js";
import { connectionManager } from "./connection-manager.js";
import { log } from "../logger.js";
import { vectorSearch } from "./vector-search.js";
import type { ShardInfo } from "./types.js";
import { runMigrations } from "./schema.js";

const METADATA_DB_NAME = "metadata.db";

function rowToShardInfo(
  row: any,
  resolvePath: (stored: string, scope: string) => string
): ShardInfo {
  return {
    id: row.id,
    scope: row.scope,
    scopeHash: row.scope_hash,
    shardIndex: row.shard_index,
    dbPath: resolvePath(row.db_path, row.scope),
    vectorCount: row.vector_count,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

export class ShardManager {
  private readonly metadataDb: Database;
  private readonly metadataPath: string;
  private readonly activeShardStmt: any;
  private readonly allShardsStmt: any;
  private readonly scopedShardsStmt: any;
  private readonly createShardStmt: any;

  constructor() {
    this.metadataPath = join(CONFIG.storagePath, METADATA_DB_NAME);
    this.metadataDb = connectionManager.getConnection(this.metadataPath);
    this.initMetadataDb();
    this.activeShardStmt = this.metadataDb.prepare(`
      SELECT * FROM shards WHERE scope = ? AND scope_hash = ? AND is_active = 1
      ORDER BY shard_index DESC LIMIT 1
    `);
    this.allShardsStmt = this.metadataDb.prepare(`
      SELECT * FROM shards WHERE scope = ? ORDER BY shard_index ASC
    `);
    this.scopedShardsStmt = this.metadataDb.prepare(`
      SELECT * FROM shards WHERE scope = ? AND scope_hash = ? ORDER BY shard_index ASC
    `);
    this.createShardStmt = this.metadataDb.prepare(`
      INSERT INTO shards (scope, scope_hash, shard_index, db_path, vector_count, is_active, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?)
    `);
  }

  close(): void {
    connectionManager.closeConnection(this.metadataPath);
  }

  private initMetadataDb(): void {
    this.metadataDb.run(`
      CREATE TABLE IF NOT EXISTS shards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        shard_index INTEGER NOT NULL,
        db_path TEXT NOT NULL,
        vector_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, scope_hash, shard_index)
      )
    `);

    this.metadataDb.run(`
      CREATE INDEX IF NOT EXISTS idx_active_shards 
      ON shards(scope, scope_hash, is_active)
    `);

    runMigrations(this.metadataDb);
  }

  private getShardPath(scope: "user" | "project", scopeHash: string, shardIndex: number): string {
    const dir = join(CONFIG.storagePath, `${scope}s`);
    return join(dir, `${scope}_${scopeHash}_shard_${shardIndex}.db`);
  }

  private resolveStoredPath(storedPath: string, scope: string): string {
    const fileName = basename(storedPath);
    return join(CONFIG.storagePath, `${scope}s`, fileName);
  }

  private toShardInfo(row: any): ShardInfo {
    return rowToShardInfo(row, (stored, scope) => this.resolveStoredPath(stored, scope));
  }

  getActiveShard(scope: "user" | "project", scopeHash: string): ShardInfo | null {
    const row = this.activeShardStmt.get(scope, scopeHash) as any;
    return row ? this.toShardInfo(row) : null;
  }

  getAllShards(scope: "user" | "project", scopeHash: string): ShardInfo[] {
    const rows =
      scopeHash === ""
        ? (this.allShardsStmt.all(scope) as any[])
        : (this.scopedShardsStmt.all(scope, scopeHash) as any[]);

    return rows.map((row: any) => this.toShardInfo(row));
  }

  createShard(scope: "user" | "project", scopeHash: string, shardIndex: number): ShardInfo {
    const fullPath = this.getShardPath(scope, scopeHash, shardIndex);
    const storedPath = join(`${scope}s`, basename(fullPath)).replaceAll("\\", "/");
    const now = Date.now();

    const result = this.createShardStmt.run(scope, scopeHash, shardIndex, storedPath, now);

    const db = connectionManager.getConnection(fullPath);
    this.initShardDb(db);

    return {
      id: Number(result.lastInsertRowid),
      scope,
      scopeHash,
      shardIndex,
      dbPath: fullPath,
      vectorCount: 0,
      isActive: true,
      createdAt: now,
    };
  }

  private initShardDb(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS shard_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
      "embedding_dimensions",
      String(CONFIG.embeddingDimensions),
    ]);

    db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
      "embedding_model",
      CONFIG.embeddingModel,
    ]);

    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        tags_vector BLOB,
        container_tag TEXT NOT NULL,
        tags TEXT,
        type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        display_name TEXT,
        user_name TEXT,
        user_email TEXT,
        project_path TEXT,
        project_name TEXT,
        git_repo_url TEXT,
        is_pinned INTEGER DEFAULT 0,
        recency_score REAL DEFAULT 0.5,
        frequency_score REAL DEFAULT 0.0,
        importance_score REAL DEFAULT 0.5,
        utility_score REAL DEFAULT 0.3,
        novelty_score REAL DEFAULT 0.5,
        confidence_score REAL DEFAULT 0.7,
        interference_penalty REAL DEFAULT 0.0,
        strength REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        store_type TEXT DEFAULT 'stm',
        decay_rate REAL DEFAULT 0.05,
        last_decay_at INTEGER,
        is_deprecated INTEGER DEFAULT 0
      )
    `);

    const INDEXES = [
      "idx_container_tag ON memories(container_tag)",
      "idx_type ON memories(type)",
      "idx_created_at ON memories(created_at DESC)",
      "idx_is_pinned ON memories(is_pinned)",
      "idx_strength ON memories(strength DESC)",
      "idx_recency ON memories(recency_score DESC)",
      "idx_access_count ON memories(access_count DESC)",
      "idx_store_type ON memories(store_type)",
      "idx_decay_strength ON memories(strength, created_at)",
      "idx_is_deprecated ON memories(is_deprecated)",
    ];
    for (const idx of INDEXES) {
      db.run(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS memory_conflicts (
        id TEXT PRIMARY KEY,
        memory_id_1 TEXT NOT NULL,
        memory_id_2 TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        detected_at INTEGER NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolution_type TEXT,
        resolved_at INTEGER,
        resolution_data TEXT,
        container_tag TEXT,
        FOREIGN KEY (memory_id_1) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id_2) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_conflict_m1 ON memory_conflicts(memory_id_1)");
    db.run("CREATE INDEX IF NOT EXISTS idx_conflict_m2 ON memory_conflicts(memory_id_2)");
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_conflict_resolved ON memory_conflicts(resolved, detected_at)"
    );

    this.migrateScoringColumns(db);
    this.migrateConflictColumns(db);
  }

  private migrateScoringColumns(db: Database): void {
    const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));

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
      { name: "last_decay_at", type: "INTEGER" },
      { name: "is_deprecated", type: "INTEGER DEFAULT 0" },
    ];

    for (const col of scoringColumns) {
      if (!columnNames.has(col.name)) {
        try {
          db.run(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
        } catch (error) {
          log(`Schema migration: failed to add column ${col.name}`, { error: String(error) });
        }
      }
    }
  }

  private migrateConflictColumns(db: Database): void {
    const columns = db.prepare("PRAGMA table_info(memory_conflicts)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has("container_tag")) {
      try {
        db.run("ALTER TABLE memory_conflicts ADD COLUMN container_tag TEXT");
      } catch (error) {
        log("Schema migration: failed to add column container_tag", { error: String(error) });
      }
    }
  }

  private isShardValid(shard: ShardInfo): boolean {
    if (!existsSync(shard.dbPath)) {
      log("Shard DB file missing", { dbPath: shard.dbPath, shardId: shard.id });
      return false;
    }

    try {
      const db = connectionManager.getConnection(shard.dbPath);
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
        .get() as any;
      if (!result) {
        log("Shard DB missing 'memories' table", { dbPath: shard.dbPath, shardId: shard.id });
        return false;
      }
      return true;
    } catch (error) {
      log("Error validating shard DB", { dbPath: shard.dbPath, error: String(error) });
      return false;
    }
  }

  getWriteShard(scope: "user" | "project", scopeHash: string): ShardInfo {
    const shard = this.getActiveShard(scope, scopeHash);

    if (!shard) {
      return this.createShard(scope, scopeHash, 0);
    }

    if (!this.isShardValid(shard)) {
      log("Active shard is invalid, recreating", {
        scope,
        scopeHash,
        shardIndex: shard.shardIndex,
        dbPath: shard.dbPath,
      });

      connectionManager.closeConnection(shard.dbPath);

      const deleteStmt = this.metadataDb.prepare("DELETE FROM shards WHERE id = ?");
      deleteStmt.run(shard.id);

      return this.createShard(scope, scopeHash, shard.shardIndex);
    }

    if (shard.vectorCount >= CONFIG.maxVectorsPerShard) {
      this.markShardReadOnly(shard.id);
      return this.createShard(scope, scopeHash, shard.shardIndex + 1);
    }

    return shard;
  }

  private markShardReadOnly(shardId: number): void {
    this.metadataDb.prepare("UPDATE shards SET is_active = 0 WHERE id = ?").run(shardId);
  }

  incrementVectorCount(shardId: number): void {
    this.metadataDb
      .prepare("UPDATE shards SET vector_count = vector_count + 1 WHERE id = ?")
      .run(shardId);
  }

  decrementVectorCount(shardId: number): void {
    this.metadataDb
      .prepare(
        "UPDATE shards SET vector_count = vector_count - 1 WHERE id = ? AND vector_count > 0"
      )
      .run(shardId);
  }

  async deleteShard(shardId: number): Promise<void> {
    const row = this.metadataDb.prepare("SELECT * FROM shards WHERE id = ?").get(shardId) as any;

    if (row) {
      const shard = this.toShardInfo(row);
      await vectorSearch.deleteShardIndexes(shard);
      connectionManager.closeConnection(shard.dbPath);

      try {
        if (existsSync(shard.dbPath)) {
          unlinkSync(shard.dbPath);
        }
      } catch (error) {
        log("Error deleting shard file", { dbPath: shard.dbPath, error: String(error) });
      }

      this.metadataDb.prepare("DELETE FROM shards WHERE id = ?").run(shardId);
    }
  }
}

let shardManagerInstance: ShardManager | null = null;
let shardManagerStoragePath: string | null = null;

export function getShardManager(): ShardManager {
  if (
    shardManagerInstance &&
    shardManagerStoragePath !== null &&
    shardManagerStoragePath !== CONFIG.storagePath
  ) {
    throw new Error(
      "Storage path changed — shardManager must be explicitly closed before reinitializing"
    );
  }
  if (!shardManagerInstance) {
    shardManagerInstance = new ShardManager();
    shardManagerStoragePath = CONFIG.storagePath;
  }
  return shardManagerInstance;
}

export function closeShardManager(): void {
  shardManagerInstance?.close();
  shardManagerInstance = null;
  shardManagerStoragePath = null;
}

export const shardManager = new Proxy({} as ShardManager, {
  get(_target, prop, receiver) {
    const manager = getShardManager();
    const value = Reflect.get(manager, prop, receiver);
    return typeof value === "function" ? value.bind(manager) : value;
  },
});

export function getAllShards(): ReturnType<ShardManager["getAllShards"]> {
  return [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")];
}

export function extractScopeFromContainerTag(
  containerTag: string,
  defaultScope: "user" | "project" = "user"
): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1] as "user" | "project";
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: defaultScope, hash: containerTag };
}
