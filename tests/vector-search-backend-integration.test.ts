import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExactScanBackend } from "../src/services/vector-backends/exact-scan-backend.js";
import { getDatabase } from "../src/services/sqlite/sqlite-bootstrap.js";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import type { VectorBackend } from "../src/services/vector-backends/types.js";

const Database = getDatabase();

function createFailingBackend(): VectorBackend {
  return {
    getBackendName: () => "usearch",
    insert: async () => {},
    insertBatch: () => {},
    delete: () => {},
    search: () => {
      return Promise.reject(new Error("forced-search-failure"));
    },
    rebuildFromShard: () => {
      return Promise.reject(new Error("forced-rebuild-failure"));
    },
    deleteShardIndexes: () => {},
  };
}

describe("vector search backend integration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("searches inserted memories and preserves ranking semantics", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vector-search-integration-"));
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

    const vectorSearch = new VectorSearch(new ExactScanBackend());
    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath,
      vectorCount: 2,
      isActive: true,
      createdAt: Date.now(),
    };

    await vectorSearch.insertVector(
      db,
      {
        id: "b",
        content: "beta memory",
        vector: new Float32Array([0, 1, 0, 0]),
        tagsVector: new Float32Array([0, 1, 0, 0]),
        containerTag: "opencode_project_hash",
        tags: "beta",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      shard
    );

    await vectorSearch.insertVector(
      db,
      {
        id: "a",
        content: "alpha memory",
        vector: new Float32Array([1, 0, 0, 0]),
        tagsVector: new Float32Array([1, 0, 0, 0]),
        containerTag: "opencode_project_hash",
        tags: "alpha,priority",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      shard
    );

    const results = await vectorSearch.searchInShard(
      shard,
      new Float32Array([1, 0, 0, 0]),
      "opencode_project_hash",
      2,
      "alpha"
    );

    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(results[0]?.similarity).toBeGreaterThan(results[1]?.similarity ?? 0);
    expect(typeof results[0]?.similarity).toBe("number");
    expect(typeof results[1]?.similarity).toBe("number");
  });

  it("falls back to exact scan when the preferred backend fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vector-search-fallback-"));
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

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath,
      vectorCount: 2,
      isActive: true,
      createdAt: Date.now(),
    };

    const vectorSearch = new VectorSearch(createFailingBackend(), new ExactScanBackend());

    db.prepare(
      "INSERT INTO memories (id, content, vector, tags_vector, container_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "a",
      "alpha memory",
      new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer),
      new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer),
      "opencode_project_hash",
      Date.now(),
      Date.now()
    );
    db.prepare(
      "INSERT INTO memories (id, content, vector, tags_vector, container_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "b",
      "beta memory",
      new Uint8Array(new Float32Array([0, 1, 0, 0]).buffer),
      new Uint8Array(new Float32Array([0, 1, 0, 0]).buffer),
      "opencode_project_hash",
      Date.now(),
      Date.now()
    );

    const results = await vectorSearch.searchInShard(
      shard,
      new Float32Array([1, 0, 0, 0]),
      "opencode_project_hash",
      2,
      "alpha"
    );

    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(typeof results[0]?.similarity).toBe("number");
  });

  describe("dirty-flag index rebuilds", () => {
    const tempDirsFlag: string[] = [];

    afterEach(() => {
      while (tempDirsFlag.length > 0) {
        const dir = tempDirsFlag.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
      }
    });

    function setupDb() {
      const tempDir = mkdtempSync(join(tmpdir(), "vector-search-dirty-"));
      tempDirsFlag.push(tempDir);
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

      return { db, dbPath };
    }

    function makeShard(dbPath: string) {
      return {
        id: 1,
        scope: "project" as const,
        scopeHash: "hash",
        shardIndex: 0,
        dbPath,
        vectorCount: 2,
        isActive: true,
        createdAt: Date.now(),
      };
    }

    it("skips rebuildFromShard on second search when no new inserts (dirty-flag gate)", async () => {
      const { db, dbPath } = setupDb();
      const backend = new ExactScanBackend();
      const rebuildSpy = vi.spyOn(backend, "rebuildFromShard");
      const vectorSearch = new VectorSearch(backend);
      const shard = makeShard(dbPath);

      // Insert a record so there's something to search
      await vectorSearch.insertVector(
        db,
        {
          id: "mem-1",
          content: "test memory",
          vector: new Float32Array([1, 0, 0]),
          tagsVector: new Float32Array([0, 1, 0]),
          containerTag: "opencode_project_hash",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        shard
      );

      // First search — rebuildFromShard should be called (dirty after insert)
      const firstCallCount = rebuildSpy.mock.calls.length;
      await vectorSearch.searchInShard(
        shard,
        new Float32Array([1, 0, 0]),
        "opencode_project_hash",
        5
      );

      // Rebuild should have been called during first search
      expect(rebuildSpy.mock.calls.length).toBeGreaterThan(firstCallCount);

      // Second search on SAME shard with NO new inserts — rebuildFromShard should NOT be called
      const afterFirstSearch = rebuildSpy.mock.calls.length;
      await vectorSearch.searchInShard(
        shard,
        new Float32Array([1, 0, 0]),
        "opencode_project_hash",
        5
      );

      // No additional rebuild calls — dirty flag was cleared
      expect(rebuildSpy.mock.calls.length).toBe(afterFirstSearch);

      rebuildSpy.mockRestore();
    });

    it("triggers rebuildFromShard after batchInsertVectors (dirty-flag set)", async () => {
      const { db, dbPath } = setupDb();
      const backend = new ExactScanBackend();
      const rebuildSpy = vi.spyOn(backend, "rebuildFromShard");
      const vectorSearch = new VectorSearch(backend);
      const shard = makeShard(dbPath);

      // Insert first record and search to clear dirty flag
      await vectorSearch.insertVector(
        db,
        {
          id: "mem-1",
          content: "first memory",
          vector: new Float32Array([1, 0, 0]),
          tagsVector: new Float32Array([0, 1, 0]),
          containerTag: "opencode_project_hash",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        shard
      );

      await vectorSearch.searchInShard(
        shard,
        new Float32Array([1, 0, 0]),
        "opencode_project_hash",
        5
      );

      const callsAfterClear = rebuildSpy.mock.calls.length;

      // Now insert more vectors via batchInsertVectors — should set dirty flag
      await vectorSearch.batchInsertVectors(
        db,
        [
          {
            id: "mem-2",
            content: "second memory",
            vector: new Float32Array([0, 1, 1]),
            tagsVector: new Float32Array([1, 0, 1]),
            containerTag: "opencode_project_hash",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        shard
      );

      // Search again — rebuildFromShard should be called because dirty flag was set
      await vectorSearch.searchInShard(
        shard,
        new Float32Array([0, 1, 0]),
        "opencode_project_hash",
        5
      );

      expect(rebuildSpy.mock.calls.length).toBeGreaterThan(callsAfterClear);

      rebuildSpy.mockRestore();
    });
  });
});
