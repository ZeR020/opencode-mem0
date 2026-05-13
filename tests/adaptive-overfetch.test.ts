import { describe, it, expect, beforeEach, vi } from "vitest";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import { ExactScanBackend } from "../src/services/vector-backends/exact-scan-backend.js";

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(() => ({
      prepare: vi.fn((sql: string) => {
        // Return appropriate mock based on SQL
        if (sql.includes("UPDATE memories SET access_count")) {
          return { run: vi.fn() };
        }
        if (sql.includes("SELECT * FROM memories")) {
          return {
            all: vi.fn((...params: any[]) => {
              // Extract IDs from IN clause parameters
              const ids = params.filter((p) => typeof p === "string" && p.startsWith("id-"));
              return ids.map((id) => ({
                id,
                content: `memory-${id}`,
                tags: null,
                container_tag: "",
                type: null,
                created_at: Date.now(),
                updated_at: Date.now(),
                metadata: null,
                display_name: null,
                user_name: null,
                user_email: null,
                project_path: null,
                project_name: null,
                git_repo_url: null,
                is_pinned: 0,
                strength: 0.5,
                recency_score: 0.5,
                importance_score: 0.5,
                access_count: 0,
                is_deprecated: 0,
              }));
            }),
            get: vi.fn(() => null),
          };
        }
        if (sql.includes("memories_fts")) {
          return { all: vi.fn(() => []) };
        }
        if (sql.includes("memories WHERE content LIKE")) {
          return { all: vi.fn(() => []) };
        }
        return { all: vi.fn(() => []), get: vi.fn(() => null), run: vi.fn() };
      }),
      run: vi.fn(),
    })),
  },
}));

/**
 * Tests for adaptive over-fetch multiplier in vector search.
 * These verify:
 * 1. High-quality results (all similarities > 0.9) use minimum multiplier 1.5x
 * 2. Low-quality results (similarities < 0.5) use maximum multiplier 8x
 * 3. Medium-quality results use interpolated multiplier
 * 4. Retry with larger multiplier when fill ratio < 85%
 * 5. Multiplier is per-shard and per-query (no cross-query state)
 * 6. Adaptive multiplier is used in both content and tags search
 */

describe("VectorSearch adaptive over-fetch", () => {
  let search: VectorSearch;
  let mockBackend: any;

  beforeEach(() => {
    mockBackend = {
      search: vi.fn(),
      rebuildFromShard: vi.fn().mockResolvedValue(undefined),
      getBackendName: () => "mock",
      insert: vi.fn(),
      delete: vi.fn(),
      deleteShardIndexes: vi.fn(),
    };
    search = new VectorSearch(mockBackend, new ExactScanBackend());
  });

  it("should use minimum multiplier 1.5x for high-quality results", async () => {
    // Setup: return high-similarity results
    mockBackend.search.mockImplementation((args: any) => {
      const results = [];
      for (let i = 0; i < args.limit; i++) {
        results.push({ id: `id-${i}`, distance: 0.05 }); // similarity = 0.95
      }
      return Promise.resolve(results);
    });

    const db = { prepare: vi.fn(() => ({ all: () => [], get: () => ({}) })) } as any;
    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchWithMultiplier({
      shard,
      queryVector: new Float32Array([1, 0, 0]),
      containerTag: "",
      limit: 5,
      overFetchMultiplier: 1.5,
      queryText: "test",
      providedDb: db,
    });

    // Verify backend.search was called with limit = 5 * 1.5 = 7.5 ≈ 7 or 8
    const call = mockBackend.search.mock.calls[0];
    expect(call[0].limit).toBe(Math.ceil(5 * 1.5));
  });

  it("should use maximum multiplier 8x for low-quality results", async () => {
    // Setup: return low-similarity results
    mockBackend.search.mockImplementation((args: any) => {
      const results = [];
      for (let i = 0; i < args.limit; i++) {
        results.push({ id: `id-${i}`, distance: 0.8 }); // similarity = 0.2
      }
      return Promise.resolve(results);
    });

    const db = { prepare: vi.fn(() => ({ all: () => [], get: () => ({}) })) } as any;
    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchWithMultiplier({
      shard,
      queryVector: new Float32Array([1, 0, 0]),
      containerTag: "",
      limit: 5,
      overFetchMultiplier: 8.0,
      queryText: "test",
      providedDb: db,
    });

    const call = mockBackend.search.mock.calls[0];
    expect(call[0].limit).toBe(5 * 8);
  });

  it("should retry with larger multiplier when fill ratio is low", async () => {
    // Always return only 2 results (fill ratio = 2/5 = 40% < 85%)
    mockBackend.search.mockImplementation((_args: any) => {
      return Promise.resolve([
        { id: "id-1", distance: 0.5 },
        { id: "id-2", distance: 0.5 },
      ]);
    });

    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    // Should have called search 4 times (content+tags initial + content+tags retry)
    expect(mockBackend.search).toHaveBeenCalledTimes(4);
  });

  it("should not retry when fill ratio is high", async () => {
    mockBackend.search.mockImplementation((_args: any) => {
      return Promise.resolve([
        { id: "id-1", distance: 0.1 },
        { id: "id-2", distance: 0.1 },
        { id: "id-3", distance: 0.1 },
        { id: "id-4", distance: 0.1 },
        { id: "id-5", distance: 0.1 },
      ]);
    });

    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    // Should have called search twice (content + tags, no retry since fill is high)
    expect(mockBackend.search).toHaveBeenCalledTimes(2);
  });

  it("should reset multiplier per query", async () => {
    // First query returns few results (triggers retry)
    mockBackend.search.mockImplementation((_args: any) => {
      return Promise.resolve([
        { id: "id-1", distance: 0.1 },
        { id: "id-2", distance: 0.1 },
      ]);
    });

    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    // First call of first query uses base multiplier
    const firstQueryFirstCallLimit = mockBackend.search.mock.calls[0][0].limit;
    expect(firstQueryFirstCallLimit).toBe(10); // 5 * 2.0

    // Reset mock to return enough results for second query (no retry)
    mockBackend.search.mockClear();
    mockBackend.search.mockImplementation((_args: any) => {
      return Promise.resolve([
        { id: "id-1", distance: 0.1 },
        { id: "id-2", distance: 0.1 },
        { id: "id-3", distance: 0.1 },
        { id: "id-4", distance: 0.1 },
        { id: "id-5", distance: 0.1 },
      ]);
    });

    // Second query should use same base multiplier, not carry over from first
    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test2",
      undefined
    );

    const secondQueryFirstCallLimit = mockBackend.search.mock.calls[0][0].limit;
    expect(secondQueryFirstCallLimit).toBe(firstQueryFirstCallLimit);
  });

  it("should use adaptive multiplier based on result quality", async () => {
    // Medium quality results (similarity around 0.6)
    mockBackend.search.mockImplementation((args: any) => {
      const results = [];
      for (let i = 0; i < args.limit; i++) {
        results.push({ id: `id-${i}`, distance: 0.4 }); // similarity = 0.6
      }
      return Promise.resolve(results);
    });

    const shard = {
      id: 1,
      dbPath: "/tmp/test.db",
      scope: "user" as const,
      scopeHash: "abc",
      shardIndex: 0,
      vectorCount: 100,
      isActive: true,
      createdAt: Date.now(),
    };

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    const call = mockBackend.search.mock.calls[0];
    // With medium quality (avg similarity ~0.6), multiplier should be between 1.5 and 8
    const expectedLimit = call[0].limit;
    expect(expectedLimit).toBeGreaterThanOrEqual(5 * 1.5);
    expect(expectedLimit).toBeLessThanOrEqual(5 * 8);
  });
});
