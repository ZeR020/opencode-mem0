import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { CONFIG } from "../src/config.js";
import { ExactScanBackend } from "../src/services/vector-backends/exact-scan-backend.js";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";

const Database = getDatabase();

const MEMORIES_DDL = `
  CREATE TABLE memories (
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
    is_deprecated INTEGER DEFAULT 0,
    recency_score REAL DEFAULT 0.5,
    frequency_score REAL DEFAULT 0.5,
    importance_score REAL DEFAULT 0.5,
    utility_score REAL DEFAULT 0.5,
    novelty_score REAL DEFAULT 0.5,
    confidence_score REAL DEFAULT 0.5,
    interference_penalty REAL DEFAULT 0,
    strength REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    last_accessed INTEGER,
    store_type TEXT,
    decay_rate REAL,
    last_decay_at INTEGER
  )
`;

function ftsName(db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } }) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
    .get() as { name: string } | undefined;
}

describe("memories_fts", () => {
  const dirs: string[] = [];

  afterEach(() => {
    connectionManager.closeAll();
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates memories_fts on a fresh shard and keyword search uses MATCH not LIKE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memories-fts-fresh-"));
    dirs.push(dir);
    const previous = CONFIG.storagePath;
    CONFIG.storagePath = dir;
    const shard = shardManager.createShard("user", `fts${Date.now()}`, 0);
    CONFIG.storagePath = previous;

    const db = connectionManager.getConnection(shard.dbPath);
    expect(ftsName(db)?.name).toBe("memories_fts");

    const now = Date.now();
    db.run(
      `INSERT INTO memories (id, content, vector, container_tag, tags, created_at, updated_at, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      "m1",
      "uniquekeyword zebra memory",
      new Uint8Array(16),
      "mem_user_ftstest",
      "alpha",
      now,
      now
    );

    const ftsCount = db.prepare("SELECT count(*) AS n FROM memories_fts").get() as { n: number };
    expect(Number(ftsCount.n)).toBe(1);

    const prepared: string[] = [];
    const orig = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      prepared.push(sql);
      return orig(sql);
    });

    const vectorSearch = new VectorSearch(new ExactScanBackend());
    const results = await vectorSearch.searchInShard(
      shard,
      null,
      "mem_user_ftstest",
      10,
      "uniquekeyword"
    );

    expect(results.some((r) => r.id === "m1")).toBe(true);
    expect(prepared.some((s) => s.includes("memories_fts MATCH"))).toBe(true);
    expect(prepared.some((s) => /content LIKE/i.test(s))).toBe(false);
  });

  it("migrates an existing shard: creates memories_fts and backfills rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "memories-fts-migrate-"));
    dirs.push(dir);
    const dbPath = join(dir, "old.db");

    const raw = new Database(dbPath);
    raw.run(MEMORIES_DDL);
    const now = Date.now();
    raw.run(
      `INSERT INTO memories (id, content, vector, container_tag, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "old-1",
      "alpha content",
      new Uint8Array(8),
      "tag",
      "t",
      now,
      now
    );
    raw.run(
      `INSERT INTO memories (id, content, vector, container_tag, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "old-2",
      "beta content",
      new Uint8Array(8),
      "tag",
      "t",
      now,
      now
    );
    expect(ftsName(raw)).toBeUndefined();
    raw.close();

    const db = connectionManager.getConnection(dbPath);
    expect(ftsName(db)?.name).toBe("memories_fts");
    const ftsCount = db.prepare("SELECT count(*) AS n FROM memories_fts").get() as { n: number };
    expect(Number(ftsCount.n)).toBe(2);
    const hit = db
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?")
      .get("alpha") as { id: string } | undefined;
    expect(hit?.id).toBe("old-1");
  });

  it("update trigger is scoped to content/tags — metadata updates don't rewrite FTS", () => {
    const dir = mkdtempSync(join(tmpdir(), "memories-fts-scope-"));
    dirs.push(dir);
    const dbPath = join(dir, "scope.db");

    const raw = new Database(dbPath);
    raw.run(MEMORIES_DDL);
    raw.close();

    const db = connectionManager.getConnection(dbPath);

    // The trigger itself must be column-scoped.
    const trig = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='memories_fts_update'")
      .get() as { sql: string };
    expect(trig.sql).toContain("AFTER UPDATE OF content, tags ON memories");

    const now = Date.now();
    db.run(
      `INSERT INTO memories (id, content, vector, container_tag, tags, created_at, updated_at, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      "m1",
      "unscoped keyword original",
      new Uint8Array(16),
      "mem_user_ftstest",
      "alpha",
      now,
      now
    );

    // Metadata-only update (as every search/decay cycle does):
    db.run("UPDATE memories SET access_count = access_count + 1 WHERE id = 'm1'");
    const stillThere = db
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?")
      .get("unscoped") as { id: string } | undefined;
    expect(stillThere?.id).toBe("m1");

    // Content update must sync the index.
    db.run("UPDATE memories SET content = 'brandnewcontent cylindercat' WHERE id = 'm1'");
    const oldHit = db
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?")
      .get("unscoped") as { id: string } | undefined;
    expect(oldHit).toBeUndefined();
    const newHit = db
      .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?")
      .get("cylindercat") as { id: string } | undefined;
    expect(newHit?.id).toBe("m1");
  });
});
