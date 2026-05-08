import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

const testDir = mkdtempSync(join(tmpdir(), "wal-batch-test-"));
const dbPath = join(testDir, "test.db");

function getDb(): ReturnType<typeof connectionManager.getConnection> {
  return connectionManager.getConnection(dbPath);
}

describe("WAL batch write API", () => {
  beforeEach(() => {
    const db = getDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    connectionManager.closeAll();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("batchWrite queues statements without executing immediately", () => {
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", ["A"]);
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", ["B"]);

    // Before flush, rows should not exist
    const db = getDb();
    const rows = db.prepare("SELECT * FROM test_table WHERE value IN ('A', 'B')").all() as any[];
    expect(rows).toHaveLength(0);
  });

  it("flushBatch executes all queued statements in a single transaction", () => {
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", ["C"]);
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", ["D"]);
    connectionManager.flushBatch(dbPath);

    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM test_table WHERE value IN ('C', 'D') ORDER BY value")
      .all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe("C");
    expect(rows[1].value).toBe("D");
  });

  it("flushBatch rolls back entire batch if any statement throws", () => {
    // Insert a row that will cause a duplicate primary key on the second statement
    const db = getDb();
    db.run("INSERT INTO test_table (id, value) VALUES (99, 'X')");

    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (id, value) VALUES (1, 'Y')", []);
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (id, value) VALUES (99, 'Z')", []); // will fail (duplicate PK)

    expect(() => connectionManager.flushBatch(dbPath)).toThrow();

    // Neither row should exist
    const rows = db
      .prepare("SELECT * FROM test_table WHERE id IN (1, 99) ORDER BY id")
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("X"); // only the original row
  });

  it("auto-flush triggers when batch size exceeds MAX_BATCH_SIZE (50)", () => {
    // Write 50 records — should not auto-flush
    for (let i = 0; i < 50; i++) {
      connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", [
        `auto-${i}`,
      ]);
    }

    let db = getDb();
    let rows = db
      .prepare("SELECT COUNT(*) as c FROM test_table WHERE value LIKE 'auto-%'")
      .get() as any;
    expect(rows.c).toBe(0); // still queued

    // The 51st write triggers auto-flush
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", [
      "auto-trigger",
    ]);

    db = getDb();
    rows = db
      .prepare("SELECT COUNT(*) as c FROM test_table WHERE value LIKE 'auto-%'")
      .get() as any;
    expect(rows.c).toBe(51); // all flushed including trigger
  });

  it("checkpointAll flushes pending batches before checkpointing", () => {
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", [
      "pre-checkpoint",
    ]);
    connectionManager.checkpointAll();

    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM test_table WHERE value = 'pre-checkpoint'")
      .all() as any[];
    expect(rows).toHaveLength(1);
  });

  it("closeConnection flushes pending batch before closing", () => {
    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", [
      "pre-close",
    ]);
    connectionManager.closeConnection(dbPath);

    // Re-open and verify row exists
    const db = connectionManager.getConnection(dbPath);
    const rows = db.prepare("SELECT * FROM test_table WHERE value = 'pre-close'").all() as any[];
    expect(rows).toHaveLength(1);
  });

  it("closeAll flushes all pending batches before closing connections", () => {
    const dbPath2 = join(testDir, "test2.db");
    const db2 = connectionManager.getConnection(dbPath2);
    db2.run(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    connectionManager.batchWrite(dbPath, "INSERT INTO test_table (value) VALUES (?)", ["batch1"]);
    connectionManager.batchWrite(dbPath2, "INSERT INTO test_table (value) VALUES (?)", ["batch2"]);

    connectionManager.closeAll();

    // Re-open and verify both rows
    const db1Reopen = connectionManager.getConnection(dbPath);
    const rows1 = db1Reopen
      .prepare("SELECT * FROM test_table WHERE value = 'batch1'")
      .all() as any[];
    expect(rows1).toHaveLength(1);

    const db2Reopen = connectionManager.getConnection(dbPath2);
    const rows2 = db2Reopen
      .prepare("SELECT * FROM test_table WHERE value = 'batch2'")
      .all() as any[];
    expect(rows2).toHaveLength(1);
  });
});
