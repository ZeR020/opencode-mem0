import { describe, it, expect } from "vitest";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { runMigrations, getCurrentVersion } from "../src/services/sqlite/schema.js";

const DbClass = getDatabase();

describe("schema versioning", () => {
  it("new database gets schema_version table initialized to v1", () => {
    const db = new DbClass(":memory:");
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);
    db.close();
  });

  it("existing database without schema_version is detected and migrated to v1", () => {
    const db = new DbClass(":memory:");
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        container_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);

    const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));
    expect(columnNames.has("is_deprecated")).toBe(true);
    expect(columnNames.has("is_pinned")).toBe(true);
    expect(columnNames.has("store_type")).toBe(true);
    expect(columnNames.has("decay_rate")).toBe(true);
    db.close();
  });

  it("database at version N runs all migrations N+1..CURRENT sequentially", () => {
    const db = new DbClass(":memory:");
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    db.run("INSERT INTO schema_version (version, applied_at) VALUES (0, ?)", [Date.now()]);
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      )
    `);

    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);

    const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));
    expect(columnNames.has("is_deprecated")).toBe(true);
    db.close();
  });

  it("failed migration rolls back and does not insert version row", () => {
    const db = new DbClass(":memory:");
    db.run(
      "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
    );
    db.run("INSERT INTO schema_version (version, applied_at) VALUES (0, ?)", [Date.now()]);
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      )
    `);

    const badMigrations = {
      1: ["INSERT INTO nonexistent_table (x) VALUES (1)"],
    };

    expect(() => runMigrations(db, 1, badMigrations)).toThrow();

    const version = getCurrentVersion(db);
    expect(version).toBe(0);

    db.close();
  });
});
