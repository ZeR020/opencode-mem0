import { describe, it, expect } from "vitest";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";

/**
 * Regression guard for issue #52: better-sqlite3 prebuilt `.node` binaries
 * target Node ABI 137 (Node 22), but OpenCode v1.18.3 bundles Node 24 (ABI 146).
 * The probe chain must fall back to `node:sqlite` (stdlib, no native binary)
 * before reaching the broken `better-sqlite3` build.
 *
 * These tests are backend-agnostic — they run under whichever backend
 * `getDatabase()` selects on the host runtime (bun:sqlite on Bun, node:sqlite
 * on Node >= 22.5, better-sqlite3 on older Node) and assert the shared wrapper
 * contract holds, including the array-arg normalization that prevents the
 * `node:sqlite` "Unknown named parameter '0'" failure seen at the three
 * `db.run(sql, [params])` callsites in schema.ts and shard-manager.ts.
 */
describe("sqlite-bootstrap backend selection", () => {
  it("getDatabase selects a known backend", () => {
    const Db = getDatabase();
    expect(Db.name).toMatch(/^(BunSqliteDatabase|NodeSqliteDatabase|BetterSqlite3Database)$/);
  });

  it("getDatabase is memoized — returns the same constructor on repeat calls", () => {
    const a = getDatabase();
    const b = getDatabase();
    expect(b).toBe(a);
  });

  it("selected backend opens :memory:, runs queries, and closes", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE probe(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
    const ins = db.prepare("INSERT INTO probe(name) VALUES(?)");
    const r = ins.run("alice");
    expect(r.changes).toBe(1);
    expect(Number(r.lastInsertRowid)).toBe(1);
    const row = db.prepare("SELECT * FROM probe WHERE id = ?").get(1) as {
      id: number;
      name: string;
    };
    expect(row.name).toBe("alice");
    db.close();
  });

  it("db.run with spread params works on every backend", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE s(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const result = db.run("INSERT INTO s(v) VALUES(?)", "x");
    expect(result.changes).toBe(1);
    expect(db.prepare("SELECT v FROM s WHERE id = ?").get(1)).toEqual({ v: "x" });
    db.close();
  });

  it("db.run with single array arg is unpacked to positional params (node:sqlite parity)", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE s(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT, n INTEGER)");
    // This form is used by schema.ts and shard-manager.ts. better-sqlite3
    // auto-unpacks it; node:sqlite does not. The wrapper normalizes so all
    // backends accept it.
    const result = db.run("INSERT INTO s(v, n) VALUES (?, ?)", ["alice", 42]);
    expect(result.changes).toBe(1);
    const row = db.prepare("SELECT v, n FROM s WHERE id = ?").get(1) as {
      v: string;
      n: number;
    };
    expect(row).toEqual({ v: "alice", n: 42 });
    db.close();
  });

  it("prepared statement .run with single array arg is unpacked", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE s(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT, n INTEGER)");
    const stmt = db.prepare("INSERT INTO s(v, n) VALUES (?, ?)");
    const result = stmt.run(["bob", 7]);
    expect(result.changes).toBe(1);
    const row = db.prepare("SELECT v, n FROM s WHERE id = ?").get(1) as {
      v: string;
      n: number;
    };
    expect(row).toEqual({ v: "bob", n: 7 });
    db.close();
  });

  it("BLOB roundtrip preserves Uint8Array bytes", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE b(id INTEGER, blob BLOB)");
    const bytes = new Uint8Array([1, 2, 3, 255, 0]);
    db.prepare("INSERT INTO b(id, blob) VALUES(?, ?)").run(1, bytes);
    const row = db.prepare("SELECT blob FROM b WHERE id = ?").get(1) as {
      blob: Uint8Array;
    };
    expect(Array.from(row.blob)).toEqual([1, 2, 3, 255, 0]);
    db.close();
  });

  it("FTS5 virtual table and MATCH query work", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE VIRTUAL TABLE fts USING fts5(content)");
    db.prepare("INSERT INTO fts(content) VALUES(?)").run("persistent vector memory");
    const hit = db.prepare("SELECT content FROM fts WHERE fts MATCH ?").get("vector") as
      | {
          content: string;
        }
      | undefined;
    expect(hit?.content).toContain("vector");
    db.close();
  });

  it("transaction BEGIN/COMMIT round-trips", () => {
    const Db = getDatabase();
    const db = new Db(":memory:");
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v INTEGER)");
    db.run("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO t(id, v) VALUES(?, ?)").run(1, 100);
    db.run("COMMIT");
    expect(db.prepare("SELECT v FROM t WHERE id = ?").get(1)).toEqual({ v: 100 });
    db.close();
  });
});
