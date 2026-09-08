import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import type { VectorBackend } from "../src/services/vector-backends/types.js";
import type { MemoryRecord, ShardInfo } from "../src/services/sqlite/types.js";

const Database = getDatabase();

function record(id: string): MemoryRecord {
  return {
    id,
    content: id,
    vector: new Float32Array([1, 0, 0, 0]),
    containerTag: "mem_user_t",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("insertVector transaction does not span await", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("second insertVector during deferred backend insert does not nested-BEGIN and both rows land", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insert-txn-"));
    dirs.push(dir);
    const dbPath = join(dir, "t.db");
    const db = new Database(dbPath);
    db.run(`
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
        recency_score REAL DEFAULT 0.5,
        frequency_score REAL DEFAULT 0,
        importance_score REAL DEFAULT 0.5,
        utility_score REAL DEFAULT 0.3,
        novelty_score REAL DEFAULT 0.5,
        confidence_score REAL DEFAULT 0.7,
        interference_penalty REAL DEFAULT 0,
        strength REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        store_type TEXT DEFAULT 'stm',
        decay_rate REAL DEFAULT 0.05
      )
    `);

    const unlocks: Array<() => void> = [];
    const backend: VectorBackend = {
      getBackendName: () => "deferred",
      insert: () => new Promise<void>((resolve) => unlocks.push(resolve)),
      insertBatch: () => {},
      delete: () => {},
      search: () => [],
      rebuildFromShard: () => {},
      deleteShardIndexes: () => {},
    };

    const vectorSearch = new VectorSearch(backend);
    const shard: ShardInfo = {
      id: 1,
      scope: "user",
      scopeHash: "t",
      shardIndex: 0,
      dbPath,
      vectorCount: 0,
      isActive: true,
      createdAt: Date.now(),
    };

    const first = vectorSearch.insertVector(db, record("a"), shard);
    await new Promise((r) => setImmediate(r));
    expect(unlocks.length).toBeGreaterThan(0);

    let secondErr: unknown;
    const second = vectorSearch.insertVector(db, record("b"), shard).catch((e: unknown) => {
      secondErr = e;
    });
    await new Promise((r) => setImmediate(r));
    expect(secondErr).toBeUndefined();

    unlocks.forEach((u) => u());
    await first;
    await second;
    expect(secondErr).toBeUndefined();

    const rows = db.prepare("SELECT id FROM memories ORDER BY id").all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    db.close();
  });
});
