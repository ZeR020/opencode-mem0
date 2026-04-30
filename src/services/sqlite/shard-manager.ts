import { getDatabase } from "./sqlite-bootstrap.js";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { CONFIG } from "../../config.js";
import { connectionManager } from "./connection-manager.js";
import { log } from "../logger.js";
import { vectorSearch } from "./vector-search.js";
import type { ShardInfo } from "./types.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

const METADATA_DB_NAME = "metadata.db";

export class ShardManager {
  private metadataDb: DatabaseType;
  private metadataPath: string;

  constructor() {
    this.metadataPath = join(CONFIG.storagePath, METADATA_DB_NAME);
    this.metadataDb = connectionManager.getConnection(this.metadataPath);
    this.initMetadataDb();
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
  }

  private getShardPath(scope: "user" | "project", scopeHash: string, shardIndex: number): string {
    const dir = join(CONFIG.storagePath, `${scope}s`);
    return join(dir, `${scope}_${scopeHash}_shard_${shardIndex}.db`);
  }

  private resolveStoredPath(storedPath: string, scope: string): string {
    const fileName = basename(storedPath);
    return join(CONFIG.storagePath, `${scope}s`, fileName);
  }

  getActiveShard(scope: "user" | "project", scopeHash: string): ShardInfo | null {
    const stmt = this.metadataDb.prepare(`
      SELECT * FROM shards 
      WHERE scope = ? AND scope_hash = ? AND is_active = 1
      ORDER BY shard_index DESC LIMIT 1
    `);

    const row = stmt.get(scope, scopeHash) as any;
    if (!row) return null;

    return {
      id: row.id,
      scope: row.scope,
      scopeHash: row.scope_hash,
      shardIndex: row.shard_index,
      dbPath: this.resolveStoredPath(row.db_path, row.scope),
      vectorCount: row.vector_count,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    };
  }

  getAllShards(scope: "user" | "project", scopeHash: string): ShardInfo[] {
    let stmt;
    let rows;

    if (scopeHash === "") {
      stmt = this.metadataDb.prepare(`
        SELECT * FROM shards 
        WHERE scope = ?
        ORDER BY shard_index ASC
      `);
      rows = stmt.all(scope) as any[];
    } else {
      stmt = this.metadataDb.prepare(`
        SELECT * FROM shards 
        WHERE scope = ? AND scope_hash = ?
        ORDER BY shard_index ASC
      `);
      rows = stmt.all(scope, scopeHash) as any[];
    }

    return rows.map((row: any) => ({
      id: row.id,
      scope: row.scope,
      scopeHash: row.scope_hash,
      shardIndex: row.shard_index,
      dbPath: this.resolveStoredPath(row.db_path, row.scope),
      vectorCount: row.vector_count,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    }));
  }

  createShard(scope: "user" | "project", scopeHash: string, shardIndex: number): ShardInfo {
    const fullPath = this.getShardPath(scope, scopeHash, shardIndex);
    const storedPath = join(`${scope}s`, basename(fullPath)).replace(/\\/g, "/");
    const now = Date.now();

    const stmt = this.metadataDb.prepare(`
      INSERT INTO shards (scope, scope_hash, shard_index, db_path, vector_count, is_active, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?)
    `);

    const result = stmt.run(scope, scopeHash, shardIndex, storedPath, now);

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

  private initShardDb(db: DatabaseType): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS shard_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    db.run(`
      INSERT OR REPLACE INTO shard_metadata (key, value) 
      VALUES ('embedding_dimensions', '${CONFIG.embeddingDimensions}')
    `);

    db.run(`
      INSERT OR REPLACE INTO shard_metadata (key, value) 
      VALUES ('embedding_model', '${CONFIG.embeddingModel}')
    `);

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
        is_deprecated INTEGER DEFAULT 0
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_container_tag ON memories(container_tag)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_type ON memories(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON memories(created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_is_pinned ON memories(is_pinned)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_strength ON memories(strength DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_recency ON memories(recency_score DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_count ON memories(access_count DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_store_type ON memories(store_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_decay_strength ON memories(strength, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_is_deprecated ON memories(is_deprecated)`);

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
        FOREIGN KEY (memory_id_1) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id_2) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_conflict_m1 ON memory_conflicts(memory_id_1)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conflict_m2 ON memory_conflicts(memory_id_2)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conflict_resolved ON memory_conflicts(resolved, detected_at)`);

    // Migrate existing databases to add scoring columns
    this.migrateScoringColumns(db);
  }

  private migrateScoringColumns(db: DatabaseType): void {
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
      { name: "is_deprecated", type: "INTEGER DEFAULT 0" },
    ];

    for (const col of scoringColumns) {
      if (!columnNames.has(col.name)) {
        try {
          db.run(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
        } catch (error) {
          log(`Schema migration: failed to add column ${col.name}`, {
            error: String(error),
          });
        }
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
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`)
        .get() as any;
      if (!result) {
        log("Shard DB missing 'memories' table", {
          dbPath: shard.dbPath,
          shardId: shard.id,
        });
        return false;
      }
      return true;
    } catch (error) {
      log("Error validating shard DB", {
        dbPath: shard.dbPath,
        error: String(error),
      });
      return false;
    }
  }

  private ensureShardTables(shard: ShardInfo): void {
    try {
      const db = connectionManager.getConnection(shard.dbPath);
      this.initShardDb(db);
    } catch (error) {
      log("Error ensuring shard tables", {
        dbPath: shard.dbPath,
        error: String(error),
      });
    }
  }

  getWriteShard(scope: "user" | "project", scopeHash: string): ShardInfo {
    let shard = this.getActiveShard(scope, scopeHash);

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

      const deleteStmt = this.metadataDb.prepare(`DELETE FROM shards WHERE id = ?`);
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
    const stmt = this.metadataDb.prepare(`
      UPDATE shards SET is_active = 0 WHERE id = ?
    `);
    stmt.run(shardId);
  }

  incrementVectorCount(shardId: number): void {
    const stmt = this.metadataDb.prepare(`
      UPDATE shards SET vector_count = vector_count + 1 WHERE id = ?
    `);
    stmt.run(shardId);
  }

  decrementVectorCount(shardId: number): void {
    const stmt = this.metadataDb.prepare(`
      UPDATE shards SET vector_count = vector_count - 1 WHERE id = ? AND vector_count > 0
    `);
    stmt.run(shardId);
  }

  getShardByPath(dbPath: string): ShardInfo | null {
    const fileName = basename(dbPath);
    const stmt = this.metadataDb.prepare(`SELECT * FROM shards WHERE db_path LIKE '%' || ?`);
    const row = stmt.get(fileName) as any;
    if (!row) return null;

    return {
      id: row.id,
      scope: row.scope,
      scopeHash: row.scope_hash,
      shardIndex: row.shard_index,
      dbPath: this.resolveStoredPath(row.db_path, row.scope),
      vectorCount: row.vector_count,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    };
  }

  async deleteShard(shardId: number): Promise<void> {
    const stmt = this.metadataDb.prepare(`SELECT * FROM shards WHERE id = ?`);
    const row = stmt.get(shardId) as any;

    if (row) {
      const fullPath = this.resolveStoredPath(row.db_path, row.scope);
      await vectorSearch.deleteShardIndexes({
        id: row.id,
        scope: row.scope,
        scopeHash: row.scope_hash,
        shardIndex: row.shard_index,
        dbPath: fullPath,
        vectorCount: row.vector_count,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
      });
      connectionManager.closeConnection(fullPath);

      try {
        const fs = require("node:fs");
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (error) {
        log("Error deleting shard file", {
          dbPath: fullPath,
          error: String(error),
        });
      }

      const deleteStmt = this.metadataDb.prepare(`DELETE FROM shards WHERE id = ?`);
      deleteStmt.run(shardId);
    }
  }
}

export const shardManager = new ShardManager();
