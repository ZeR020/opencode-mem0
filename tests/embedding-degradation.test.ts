import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embeddingService } from "../src/services/embedding.js";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import { ExactScanBackend } from "../src/services/vector-backends/exact-scan-backend.js";
import { CONFIG } from "../src/config.js";

describe("EmbeddingService graceful degradation", () => {
  beforeEach(() => {
    // Reset the singleton state between tests
    (embeddingService as any).embeddingAvailable = true;
    (embeddingService as any).isWarmedUp = false;
    (embeddingService as any).initPromise = null;
    (embeddingService as any).pipe = null;
    (embeddingService as any).cache.clear();
    (embeddingService as any).cachedModelName = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets embeddingAvailable=false when embed() throws", async () => {
    expect(embeddingService.embeddingAvailable).toBe(true);

    // Mock the internal initializeModel to throw, which will cause embed() to fail
    vi.spyOn(embeddingService as any, "initializeModel").mockImplementation(() => {
      return Promise.reject(new Error("Model load failed"));
    });

    // Prevent warmup from succeeding before embed()
    (embeddingService as any).isWarmedUp = false;
    (embeddingService as any).initPromise = null;

    await expect(embeddingService.embed("test")).rejects.toThrow("Model load failed");
    expect(embeddingService.embeddingAvailable).toBe(false);
  });

  it("propagates flag=false through embedWithTimeout()", async () => {
    expect(embeddingService.embeddingAvailable).toBe(true);

    vi.spyOn(embeddingService as any, "initializeModel").mockImplementation(() => {
      return Promise.reject(new Error("Model load failed"));
    });

    (embeddingService as any).isWarmedUp = false;
    (embeddingService as any).initPromise = null;

    await expect(embeddingService.embedWithTimeout("test")).rejects.toThrow("Model load failed");
    expect(embeddingService.embeddingAvailable).toBe(false);
  });

  it("returns cached embeddings even when embeddingAvailable is false", async () => {
    const fakeVector = new Float32Array([1, 2, 3]);
    // Cache key is now SHA-256 hash of text (LRU cache from 02-02)
    const cacheKey = (embeddingService as any).getHashKey("cached-query");
    (embeddingService as any).cache.set(cacheKey, fakeVector);
    (embeddingService as any).cachedModelName = "Xenova/nomic-embed-text-v1";

    // Ensure config model matches cached model name (direct mutation since CONFIG isn't frozen in tests)
    const originalConfig = await import("../src/config.js");
    const originalModel = originalConfig.CONFIG.embeddingModel;
    const originalStorage = originalConfig.CONFIG.storagePath;
    originalConfig.CONFIG.embeddingModel = "Xenova/nomic-embed-text-v1";
    originalConfig.CONFIG.storagePath = "/tmp/test-storage";

    embeddingService.embeddingAvailable = false;
    (embeddingService as any).isWarmedUp = true; // skip warmup

    const result = await embeddingService.embed("cached-query");
    expect(result).toEqual(fakeVector);

    // Restore original config values
    originalConfig.CONFIG.embeddingModel = originalModel;
    originalConfig.CONFIG.storagePath = originalStorage;
  });
});

describe("Config defaults", () => {
  it("has warmupTimeoutMs default of 30000", () => {
    expect(CONFIG.warmupTimeoutMs).toBe(30000);
  });
});

describe("VectorSearch FTS5 fallback when embedding unavailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockDb(ftsRows: any[], memoryRows: any[]) {
    return {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("memories_fts")) {
          return { all: vi.fn().mockReturnValue(ftsRows) };
        }
        if (sql.includes("SELECT * FROM memories") && sql.includes("id IN")) {
          return { all: vi.fn().mockReturnValue(memoryRows) };
        }
        if (sql.includes("UPDATE memories SET access_count")) {
          return { run: vi.fn() };
        }
        return {
          all: vi.fn().mockReturnValue([]),
          get: vi.fn().mockReturnValue(null),
          run: vi.fn(),
        };
      }),
      run: vi.fn(),
    };
  }

  it("searchInShard returns FTS5 results when queryVector is null", async () => {
    const memoryRows = [
      {
        id: "fts-1",
        content: "Memory one",
        tags: "tag1",
        container_tag: "test",
        is_pinned: 0,
        strength: 0.8,
        recency_score: 0.7,
        importance_score: 0.5,
        access_count: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        project_path: "/test",
        project_name: "test",
      },
    ];

    const mockDb = createMockDb([{ id: "fts-1" }], memoryRows);

    const mockBackend = {
      rebuildFromShard: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      getBackendName: () => "mock",
    };

    const { connectionManager } = await import("../src/services/sqlite/connection-manager.js");
    vi.spyOn(connectionManager, "getConnection").mockReturnValue(mockDb as any);

    const vectorSearch = new VectorSearch(mockBackend as any, new ExactScanBackend());

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "abc",
      shardIndex: 0,
      dbPath: ":memory:",
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    const results = await vectorSearch.searchInShard(
      shard,
      null, // embedding unavailable
      "test",
      10,
      "test query"
    );

    expect(results.length).toBe(1);
    expect(mockBackend.rebuildFromShard).not.toHaveBeenCalled();
    expect(results[0].id).toBe("fts-1");
    // In degraded mode, vector similarity should be low (only FTS boost)
    expect(results[0].vectorSimilarity).toBeLessThan(0.2);
  });

  it("searchAcrossShards skips similarity threshold when degraded", async () => {
    // Low strength/recency that would normally be filtered by threshold=0.6
    const memoryRows = [
      {
        id: "m1",
        content: "A memory",
        tags: "",
        container_tag: "",
        is_pinned: 0,
        strength: 0.3,
        recency_score: 0.2,
        importance_score: 0.1,
        access_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        project_path: "",
        project_name: "",
      },
    ];

    const mockDb = createMockDb([{ id: "m1" }], memoryRows);

    const mockBackend = {
      rebuildFromShard: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      getBackendName: () => "mock",
    };

    const { connectionManager } = await import("../src/services/sqlite/connection-manager.js");
    vi.spyOn(connectionManager, "getConnection").mockReturnValue(mockDb as any);

    const vectorSearch = new VectorSearch(mockBackend as any, new ExactScanBackend());

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "abc",
      shardIndex: 0,
      dbPath: ":memory:",
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    // With similarityThreshold=0.6 and degraded=true, the result should still come through
    const results = await vectorSearch.searchAcrossShards(
      [shard],
      null,
      "",
      10,
      0.6, // high threshold
      "query",
      undefined,
      true // degraded
    );

    expect(results.length).toBe(1);
    expect(results[0].id).toBe("m1");
  });

  it("searchInShard still uses vector backend when queryVector is provided", async () => {
    const memoryRows = [
      {
        id: "vec-1",
        content: "Vector memory",
        tags: "",
        container_tag: "",
        is_pinned: 0,
        strength: 0.5,
        recency_score: 0.5,
        importance_score: 0.5,
        access_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        project_path: "",
        project_name: "",
      },
    ];

    const mockDb = createMockDb([], memoryRows);

    const mockBackend = {
      rebuildFromShard: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([{ id: "vec-1", distance: 0.1 }]),
      getBackendName: () => "mock",
    };

    const { connectionManager } = await import("../src/services/sqlite/connection-manager.js");
    vi.spyOn(connectionManager, "getConnection").mockReturnValue(mockDb as any);

    const vectorSearch = new VectorSearch(mockBackend as any, new ExactScanBackend());

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "abc",
      shardIndex: 0,
      dbPath: ":memory:",
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    const queryVector = new Float32Array(768);
    const results = await vectorSearch.searchInShard(shard, queryVector, "", 10);

    expect(results.length).toBe(1);
    expect(mockBackend.rebuildFromShard).toHaveBeenCalled();
    expect(results[0].vectorSimilarity).toBeGreaterThan(0.5); // 1 - 0.1 = 0.9
  });
});
