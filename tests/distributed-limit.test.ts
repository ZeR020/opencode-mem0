import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn((path: string) => ({
      _dbPath: path,
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => null),
        run: vi.fn(),
      })),
      run: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    })),
    closeAll: vi.fn(),
  },
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: vi.fn(),
    embedWithTimeout: vi.fn().mockResolvedValue(new Float32Array([1, 2, 3])),
  },
}));

const getAllShardsSpy = vi.fn();
const listMemoriesSpy = vi.fn();

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: getAllShardsSpy,
    getWriteShard: vi.fn(),
    incrementVectorCount: vi.fn(),
    decrementVectorCount: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    listMemories: listMemoriesSpy,
    searchAcrossShards: vi.fn(),
    insertVector: vi.fn(),
    deleteVector: vi.fn(),
    getMemoryById: vi.fn(),
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    storagePath: "/tmp/test-data",
    similarityThreshold: 0.6,
    maxMemories: 10,
    maxVectorsPerShard: 50000,
  },
  isConfigured: () => true,
  initConfig: vi.fn(),
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

const { memoryClient } = await import("../src/services/client.js");

function makeMemory(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `memory-${id}`,
    container_tag: "test-tag",
    created_at: Date.now(),
    is_pinned: 0,
    strength: 0.5,
    recency_score: 0.5,
    ...overrides,
  };
}

describe("distributed-limit", () => {
  beforeEach(() => {
    getAllShardsSpy.mockReset();
    listMemoriesSpy.mockReset();
  });

  it("over-fetches 2x per shard and returns globally top N", async () => {
    getAllShardsSpy.mockReturnValue([
      { id: "shard-a", dbPath: "/tmp/a.db" },
      { id: "shard-b", dbPath: "/tmp/b.db" },
      { id: "shard-c", dbPath: "/tmp/c.db" },
    ]);

    listMemoriesSpy.mockImplementation((_db: any, _tag: string, limit: number) => {
      const memories = [];
      for (let i = 0; i < limit; i++) {
        memories.push(makeMemory(`${_tag}-${i}`, { strength: 0.5 - i * 0.01 }));
      }
      return memories;
    });

    const result = await memoryClient.listMemories("test-tag", 5);

    expect(result.success).toBe(true);
    expect(listMemoriesSpy).toHaveBeenCalledTimes(3);
    // Each shard should be queried with limit=10 (2x the requested 5)
    for (const call of listMemoriesSpy.mock.calls) {
      expect(call[2]).toBe(10);
    }
    expect(result.memories.length).toBe(5);
  });

  it("does not under-fetch when one shard dominates", async () => {
    getAllShardsSpy.mockReturnValue([
      { id: "shard-a", dbPath: "/tmp/a.db" },
      { id: "shard-b", dbPath: "/tmp/b.db" },
      { id: "shard-c", dbPath: "/tmp/c.db" },
    ]);

    listMemoriesSpy.mockImplementation((db: any, _tag: string, limit: number) => {
      if (db._dbPath.includes("a")) {
        const memories = [];
        for (let i = 0; i < 20; i++) {
          memories.push(makeMemory(`a-${i}`, { strength: 1.0 - i * 0.01 }));
        }
        return memories;
      }
      return [];
    });

    const result = await memoryClient.listMemories("test-tag", 5);

    expect(result.success).toBe(true);
    expect(result.memories.length).toBe(5);
    // All 5 should be from shard A since B and C returned nothing
    expect(result.memories.every((m: any) => m.id.startsWith("a-"))).toBe(true);
    // Verify top result has highest strength
    expect(result.memories[0].id).toBe("a-0");
  });
});
