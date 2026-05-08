import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NSWBackend } from "../src/services/vector-backends/nsw-backend.js";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { createVectorBackend } from "../src/services/vector-backends/backend-factory.js";
import type { VectorBackend } from "../src/services/vector-backends/types.js";

const Database = getDatabase();

describe("NSWBackend", () => {
  const tempDirs: string[] = [];
  let backend: NSWBackend;

  beforeEach(() => {
    backend = new NSWBackend({ dimensions: 4 });
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeShard(id = 1) {
    return {
      id,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath: "",
      vectorCount: 0,
      isActive: true,
      createdAt: Date.now(),
    };
  }

  it("search returns nearest neighbors ordered by distance ascending", async () => {
    const shard = makeShard();
    await backend.insert({
      id: "a",
      vector: new Float32Array([1, 0, 0, 0]),
      shard,
      kind: "content",
    });
    await backend.insert({
      id: "b",
      vector: new Float32Array([0.8, 0.6, 0, 0]),
      shard,
      kind: "content",
    });
    await backend.insert({
      id: "c",
      vector: new Float32Array([0, 0, 1, 0]),
      shard,
      kind: "content",
    });

    const results = await backend.search({
      db: {},
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 3,
    });

    // a is exact match, b is closer than c (cosine to [0.8,0.6,0,0] is 0.8 vs 0)
    expect(results[0].id).toBe("a");
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
    expect(results[1].distance).toBeLessThanOrEqual(results[2].distance);
  });

  it("insert adds a vector that is then findable by search", async () => {
    const shard = makeShard();
    await backend.insert({
      id: "x",
      vector: new Float32Array([1, 1, 0, 0]),
      shard,
      kind: "content",
    });

    const results = await backend.search({
      db: {},
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 1, 0, 0]),
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("x");
  });

  it("delete removes a vector so subsequent search does not return it", async () => {
    const shard = makeShard();
    await backend.insert({
      id: "a",
      vector: new Float32Array([1, 0, 0, 0]),
      shard,
      kind: "content",
    });
    await backend.insert({
      id: "b",
      vector: new Float32Array([0, 1, 0, 0]),
      shard,
      kind: "content",
    });

    await backend.delete({ id: "a", shard, kind: "content" });

    const results = await backend.search({
      db: {},
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 2,
    });

    expect(results.map((r) => r.id)).not.toContain("a");
    expect(results.map((r) => r.id)).toContain("b");
  });

  it("rebuildFromShard repopulates index from SQLite rows", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nsw-rebuild-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "test.db");
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
        decay_rate REAL
      )
    `);

    db.prepare(
      `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "r1",
      "memory one",
      new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer),
      "tag",
      Date.now(),
      Date.now()
    );
    db.prepare(
      `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "r2",
      "memory two",
      new Uint8Array(new Float32Array([0, 1, 0, 0]).buffer),
      "tag",
      Date.now(),
      Date.now()
    );

    const shard = makeShard();
    await backend.rebuildFromShard({ db, shard, kind: "content" });

    const results = await backend.search({
      db,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 2,
    });

    expect(results.map((r) => r.id)).toContain("r1");
    expect(results.map((r) => r.id)).toContain("r2");
  });

  it("deleteShardIndexes clears the entire index for a shard", async () => {
    const shard = makeShard();
    await backend.insert({
      id: "a",
      vector: new Float32Array([1, 0, 0, 0]),
      shard,
      kind: "content",
    });
    await backend.insert({ id: "a", vector: new Float32Array([1, 0, 0, 0]), shard, kind: "tags" });

    await backend.deleteShardIndexes({ shard });

    const contentResults = await backend.search({
      db: {},
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });
    const tagsResults = await backend.search({
      db: {},
      shard,
      kind: "tags",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });

    expect(contentResults).toHaveLength(0);
    expect(tagsResults).toHaveLength(0);
  });

  it("getBackendName returns nsw", () => {
    expect(backend.getBackendName()).toBe("nsw");
  });

  it("insertBatch adds multiple vectors", async () => {
    const shard = makeShard();
    await backend.insertBatch({
      items: [
        { id: "a", vector: new Float32Array([1, 0, 0, 0]) },
        { id: "b", vector: new Float32Array([0, 1, 0, 0]) },
      ],
      shard,
      kind: "content",
    });

    const results = await backend.search({
      db: {},
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 2,
    });

    expect(results.map((r) => r.id)).toContain("a");
    expect(results.map((r) => r.id)).toContain("b");
  });
});

describe("NSW backend factory integration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('factory creates NSWBackend when vectorBackend is "nsw"', async () => {
    const backend = await createVectorBackend({ vectorBackend: "nsw" });
    expect(backend.getBackendName()).toBe("nsw");
  });

  it('factory creates NSWBackend when vectorBackend is "nsw-first"', async () => {
    const backend = await createVectorBackend({ vectorBackend: "nsw-first" });
    expect(backend.getBackendName()).toBe("nsw");
  });

  it('"nsw-first" falls back to exact-scan on NSW search error', async () => {
    const failingBackend: VectorBackend = {
      getBackendName: () => "nsw",
      insert: async () => {},
      insertBatch: async () => {},
      delete: async () => {},
      search: async () => {
        throw new Error("simulated-nsw-search-failure");
      },
      rebuildFromShard: async () => {
        throw new Error("simulated-nsw-rebuild-failure");
      },
      deleteShardIndexes: async () => {},
    };

    const backend = await createVectorBackend({
      vectorBackend: "nsw-first",
      createNSWBackend: () => failingBackend,
    });

    // FallbackAwareBackend should report the active backend name initially
    expect(backend.getBackendName()).toBe("nsw");

    const tempDir = mkdtempSync(join(tmpdir(), "nsw-fallback-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "test.db");
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
        decay_rate REAL
      )
    `);

    db.prepare(
      `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "f1",
      "fallback one",
      new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer),
      "tag",
      Date.now(),
      Date.now()
    );

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath,
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    // First search triggers fallback because NSW search throws
    const results = await backend.search({
      db,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });
    expect(results.map((r) => r.id)).toContain("f1");

    // After fallback, backend name should report exact-scan
    expect(backend.getBackendName()).toBe("exact-scan");
  });
});
