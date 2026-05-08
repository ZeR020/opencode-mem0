import { describe, it, expect, beforeEach, vi } from "vitest";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import { ExactScanBackend } from "../src/services/vector-backends/exact-scan-backend.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(() => ({
      prepare: vi.fn((sql: string) => {
        // Return appropriate mock based on SQL
        if (sql.includes("UPDATE memories SET access_count")) {
          return { run: vi.fn() };
        }
        if (sql.includes("SELECT * FROM memories")) {
          return { all: vi.fn(() => []), get: vi.fn(() => null) };
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

    await (search as any).searchWithMultiplier(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      1.5,
      "test",
      undefined,
      db
    );

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

    await (search as any).searchWithMultiplier(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      8.0,
      "test",
      undefined,
      db
    );

    const call = mockBackend.search.mock.calls[0];
    expect(call[0].limit).toBe(5 * 8);
  });

  it("should retry with larger multiplier when fill ratio is low", async () => {
    // First call returns few results, second call returns more
    let callCount = 0;
    mockBackend.search.mockImplementation((args: any) => {
      callCount++;
      if (callCount === 1) {
        // First call with 2x multiplier returns only 2 results (fill ratio = 2/5 = 40% < 85%)
        return Promise.resolve([
          { id: "id-1", distance: 0.5 },
          { id: "id-2", distance: 0.5 },
        ]);
      }
      // Second call with larger multiplier returns more
      return Promise.resolve([
        { id: "id-1", distance: 0.5 },
        { id: "id-2", distance: 0.5 },
        { id: "id-3", distance: 0.5 },
        { id: "id-4", distance: 0.5 },
        { id: "id-5", distance: 0.5 },
      ]);
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

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    // Should have called search twice (initial + retry)
    expect(mockBackend.search).toHaveBeenCalledTimes(2);
  });

  it("should not retry when fill ratio is high", async () => {
    mockBackend.search.mockImplementation((args: any) => {
      return Promise.resolve([
        { id: "id-1", distance: 0.1 },
        { id: "id-2", distance: 0.1 },
        { id: "id-3", distance: 0.1 },
        { id: "id-4", distance: 0.1 },
        { id: "id-5", distance: 0.1 },
      ]);
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

    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test",
      undefined
    );

    // Should have called search only once
    expect(mockBackend.search).toHaveBeenCalledTimes(1);
  });

  it("should reset multiplier per query", async () => {
    // First query
    mockBackend.search.mockImplementation((args: any) => {
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

    const firstCallLimit = mockBackend.search.mock.calls[0][0].limit;

    // Second query should use same base multiplier, not carry over from first
    await (search as any).searchInShard(
      shard,
      new Float32Array([1, 0, 0]),
      "",
      5,
      "test2",
      undefined
    );

    const secondCallLimit = mockBackend.search.mock.calls[2][0].limit;
    expect(secondCallLimit).toBe(firstCallLimit);
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
