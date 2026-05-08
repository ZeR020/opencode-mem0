import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { runMigrations, getCurrentVersion } from "../src/services/sqlite/schema.js";

const testDir = mkdtempSync(join(tmpdir(), "schema-version-test-"));
const DbClass = getDatabase();

beforeEach(() => {
  connectionManager.closeAll();
});

afterEach(() => {
  connectionManager.closeAll();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("schema versioning", () => {
  it("new database gets schema_version table initialized to v1", () => {
    const dbPath = join(testDir, "new.db");
    const db = connectionManager.getConnection(dbPath);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);
  });

  it("existing database without schema_version is detected and migrated to v1", () => {
    const dbPath = join(testDir, "old.db");
    const rawDb = new DbClass(dbPath);
    rawDb.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        container_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    rawDb.close();

    const db = connectionManager.getConnection(dbPath);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);

    const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));
    expect(columnNames.has("is_deprecated")).toBe(true);
    expect(columnNames.has("is_pinned")).toBe(true);
    expect(columnNames.has("store_type")).toBe(true);
    expect(columnNames.has("decay_rate")).toBe(true);
  });

  it("database at version N runs all migrations N+1..CURRENT sequentially", () => {
    const dbPath = join(testDir, "partial.db");
    const rawDb = new DbClass(dbPath);
    rawDb.run(
      "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
    );
    rawDb.run("INSERT INTO schema_version (version, applied_at) VALUES (0, ?)", [Date.now()]);
    rawDb.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      )
    `);
    rawDb.close();

    const db = connectionManager.getConnection(dbPath);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);

    const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columnNames = new Set(columns.map((c) => c.name));
    expect(columnNames.has("is_deprecated")).toBe(true);
  });

  it("failed migration rolls back and does not insert version row", () => {
    const dbPath = join(testDir, "fail.db");
    const db = new DbClass(dbPath);
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
      1: ["ALTER TABLE nonexistent_table ADD COLUMN foo TEXT"],
    };

    expect(() => runMigrations(db, 1, badMigrations)).toThrow();

    const version = getCurrentVersion(db);
    expect(version).toBe(0);

    db.close();
  });
});
