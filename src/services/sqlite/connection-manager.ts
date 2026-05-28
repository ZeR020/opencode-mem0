import { getDatabase, type Database } from "./sqlite-bootstrap.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../logger.js";
import { runMigrations } from "./schema.js";

const DB = getDatabase();

const MAX_CONNECTIONS = 20;
const MAX_BATCH_SIZE = 50;

export class ConnectionManager {
  private readonly connections: Map<string, Database> = new Map();
  private accessOrder: string[] = [];
  private readonly creating: Set<string> = new Set();
  private isClosing = false;
  private readonly batches: Map<string, Array<{ sql: string; params: any[] }>> = new Map();
  private readonly stmtCache = new WeakMap<Database, Map<string, any>>();

  private touchAccessOrder(dbPath: string): void {
    this.accessOrder = this.accessOrder.filter((p) => p !== dbPath);
    this.accessOrder.push(dbPath);
  }

  private getStmt(db: Database, sql: string): any {
    let dbCache = this.stmtCache.get(db);
    if (!dbCache) {
      dbCache = new Map();
      this.stmtCache.set(db, dbCache);
    }
    let stmt = dbCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      dbCache.set(sql, stmt);
    }
    return stmt;
  }

  batchWrite(dbPath: string, sql: string, params: any[]): void {
    let batch = this.batches.get(dbPath);
    if (!batch) {
      batch = [];
      this.batches.set(dbPath, batch);
    }
    batch.push({ sql, params });
    if (batch.length > MAX_BATCH_SIZE) {
      this.flushBatch(dbPath);
    }
  }

  flushBatch(dbPath: string): void {
    const batch = this.batches.get(dbPath);
    if (!batch || batch.length === 0) return;

    const db = this.connections.get(dbPath);
    if (!db) {
      this.batches.delete(dbPath);
      throw new Error(`No open connection for ${dbPath} — cannot flush batch`);
    }

    db.run("BEGIN IMMEDIATE");
    try {
      for (const item of batch) {
        const stmt = this.getStmt(db, item.sql);
        stmt.run(...item.params);
      }
      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("Batch flush rollback failed", { error: String(rollbackErr) });
      }
      throw error;
    } finally {
      this.batches.delete(dbPath);
    }
  }

  private initDatabase(db: Database): void {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA cache_size = -64000");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA foreign_keys = ON");

    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    runMigrations(db);

    this.migrateSchema(db);
  }

  private migrateSchema(db: Database): void {
    try {
      const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
      const hasTags = columns.some((c) => c.name === "tags");

      if (!hasTags && columns.length > 0) {
        db.run("ALTER TABLE memories ADD COLUMN tags TEXT");
      }
    } catch (error) {
      log("Schema migration error", { error: String(error) });
    }
  }

  getConnection(dbPath: string): Database {
    const existing = this.connections.get(dbPath);
    if (existing) {
      this.touchAccessOrder(dbPath);
      return existing;
    }

    if (this.isClosing) {
      throw new Error("ConnectionManager is closing — cannot create new connections");
    }

    if (this.creating.has(dbPath)) {
      const raced = this.connections.get(dbPath);
      if (raced) {
        this.touchAccessOrder(dbPath);
        return raced;
      }
    }

    this.creating.add(dbPath);

    try {
      if (this.connections.size >= MAX_CONNECTIONS) {
        const oldestPath = this.accessOrder.shift();
        if (oldestPath) {
          this.closeConnection(oldestPath);
          log("ConnectionManager: evicted oldest connection", { path: oldestPath });
        }
      }

      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const doubleCheck = this.connections.get(dbPath);
      if (doubleCheck) {
        this.touchAccessOrder(dbPath);
        return doubleCheck;
      }

      const db = new DB(dbPath);
      this.connections.set(dbPath, db);
      this.accessOrder.push(dbPath);
      this.initDatabase(db);

      return db;
    } finally {
      this.creating.delete(dbPath);
    }
  }

  closeConnection(dbPath: string): void {
    this.flushBatch(dbPath);
    const db = this.connections.get(dbPath);
    if (db) {
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch (error) {
        log("Error closing database", { path: dbPath, error: String(error) });
      }
      this.connections.delete(dbPath);
    }
    this.accessOrder = this.accessOrder.filter((p) => p !== dbPath);
  }

  closeAll(): void {
    this.isClosing = true;
    try {
      for (const path of this.batches.keys()) {
        this.flushBatch(path);
      }
      for (const [path, db] of this.connections) {
        try {
          db.run("PRAGMA wal_checkpoint(TRUNCATE)");
          db.close();
        } catch (error) {
          log("Error closing database", { path, error: String(error) });
        }
      }
      this.connections.clear();
      this.accessOrder = [];
    } finally {
      this.isClosing = false;
    }
  }

  checkpointAll(): void {
    for (const path of this.batches.keys()) {
      this.flushBatch(path);
    }
    for (const [path, db] of this.connections) {
      try {
        db.run("PRAGMA wal_checkpoint(PASSIVE)");
      } catch (error) {
        log("Error checkpointing database", { path, error: String(error) });
      }
    }
  }
}

export const connectionManager = new ConnectionManager();

function emergencyFlush(): void {
  try {
    connectionManager.closeAll();
  } catch (error) {
    log("Emergency batch flush failed", { error: String(error) });
  }
}

(globalThis as any)[Symbol.for("opencode-mem0.emergencyFlush")] = emergencyFlush;
