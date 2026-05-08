import { getDatabase, type Database } from "./sqlite-bootstrap.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";

const Database = getDatabase();

const MAX_CONNECTIONS = 20;

export class ConnectionManager {
  private connections: Map<string, Database> = new Map();
  private accessOrder: string[] = [];
  private creating: Set<string> = new Set();
  private isClosing = false;

  private initDatabase(db: Database): void {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA cache_size = -64000");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA foreign_keys = ON");

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
    // Fast path: existing connection
    const existing = this.connections.get(dbPath);
    if (existing) {
      // Move to end of access order (MRU)
      this.accessOrder = this.accessOrder.filter((p) => p !== dbPath);
      this.accessOrder.push(dbPath);
      return existing;
    }

    if (this.isClosing) {
      throw new Error("ConnectionManager is closing — cannot create new connections");
    }

    // Race-condition guard: if another caller is already creating this path,
    // spin until they finish (safe in single-threaded JS since creation is sync)
    if (this.creating.has(dbPath)) {
      // In single-threaded JS this is unreachable, but defensively return the
      // connection that the concurrent caller will have just created.
      const raced = this.connections.get(dbPath);
      if (raced) {
        this.accessOrder = this.accessOrder.filter((p) => p !== dbPath);
        this.accessOrder.push(dbPath);
        return raced;
      }
    }

    this.creating.add(dbPath);

    try {
      // Evict oldest connection if at capacity
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

      // Double-check after eviction/mkdir in case another async caller raced us
      const doubleCheck = this.connections.get(dbPath);
      if (doubleCheck) {
        this.accessOrder = this.accessOrder.filter((p) => p !== dbPath);
        this.accessOrder.push(dbPath);
        return doubleCheck;
      }

      const db = new Database(dbPath);
      this.connections.set(dbPath, db);
      this.accessOrder.push(dbPath);
      this.initDatabase(db);

      return db;
    } finally {
      this.creating.delete(dbPath);
    }
  }

  closeConnection(dbPath: string): void {
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
