import { describe, expect, it } from "bun:test";
import { createVectorBackend } from "../../src/services/vector-backends/backend-factory.js";
import type { VectorBackend } from "../../src/services/vector-backends/types.js";

function createThrowingBackend(method: "search" | "rebuildFromShard"): VectorBackend {
  return {
    getBackendName: () => "usearch",
    insert: async () => {},
    insertBatch: async () => {},
    delete: async () => {},
    search: async (args) => {
      if (method === "search") throw new Error("boom-search");
      void args;
      return [];
    },
    rebuildFromShard: async (args) => {
      if (method === "rebuildFromShard") throw new Error("boom-rebuild");
      void args;
    },
    deleteShardIndexes: async () => {},
  };
}

describe("vector backend factory", () => {
  it("defaults to usearch-first strategy", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch-first",
      probeUSearch: async () => true,
    });

    expect(backend.getBackendName()).toBe("usearch");
  });

  it("falls back to exact scan when usearch-first cannot load usearch", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch-first",
      probeUSearch: async () => false,
    });

    expect(backend.getBackendName()).toBe("exact-scan");
  });

  it("uses usearch backend when requested and available", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch",
      probeUSearch: async () => true,
    });

    expect(backend.getBackendName()).toBe("usearch");
  });

  it("falls back to exact scan when usearch is unavailable", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch",
      probeUSearch: async () => false,
    });

    expect(backend.getBackendName()).toBe("exact-scan");
  });

  it("falls back to exact scan on usearch search failure", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch-first",
      probeUSearch: async () => true,
      createUSearchBackend: () => createThrowingBackend("search"),
    });

    const result = await backend.search({
      db: {
        prepare: () => ({
          all: () => [],
        }),
      },
      shard: {
        id: 1,
        scope: "project",
        scopeHash: "hash",
        shardIndex: 0,
        dbPath: "test.db",
        vectorCount: 0,
        isActive: true,
        createdAt: Date.now(),
      },
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });

    expect(backend.getBackendName()).toBe("exact-scan");
    expect(result).toEqual([]);
  });

  it("falls back to exact scan on usearch rebuild failure", async () => {
    const backend = await createVectorBackend({
      vectorBackend: "usearch-first",
      probeUSearch: async () => true,
      createUSearchBackend: () => createThrowingBackend("rebuildFromShard"),
    });

    await expect(
      backend.rebuildFromShard({
        db: null,
        shard: {
          id: 1,
          scope: "project",
          scopeHash: "hash",
          shardIndex: 0,
          dbPath: "test.db",
          vectorCount: 0,
          isActive: true,
          createdAt: Date.now(),
        },
        kind: "content",
      })
    ).resolves.toBeUndefined();

    expect(backend.getBackendName()).toBe("exact-scan");
  });
});
