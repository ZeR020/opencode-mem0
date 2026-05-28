import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/services/sqlite/shard-manager.js", () => {
  const shardMgr: any = {
    getAllShards: vi.fn(),
  };
  return {
    shardManager: shardMgr,
    getAllShards: vi.fn(() => [
      ...shardMgr.getAllShards("user", ""),
      ...shardMgr.getAllShards("project", ""),
    ]),
    extractScopeFromContainerTag: (tag: string, defaultScope: "user" | "project" = "user") => {
      const parts = tag.split("_");
      return parts.length >= 3
        ? { scope: parts[1] as "user" | "project", hash: parts.slice(2).join("_") }
        : { scope: defaultScope, hash: tag };
    },
  };
});

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(),
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    memoryScoring: {
      enabled: true,
      recencyHalfLifeDays: 7,
      utilityHalfLifeDays: 30,
      recalculationIntervalMinutes: 60,
    },
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

import {
  recalculateAllScores,
  startScoringRecalculation,
  stopScoringRecalculation,
  runOneTimeScoringRecalculation,
} from "../src/services/memory-scoring-service.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { CONFIG } from "../src/config.js";

function makeMockDb(memories: any[] = [], throwOnTransaction = false) {
  const mockPrepare = vi.fn();
  const mockRun = vi.fn();
  const mockAll = vi.fn();

  mockPrepare.mockImplementation((sql: string) => {
    if (sql.includes("SELECT") && sql.includes("FROM memories")) {
      return {
        all: mockAll.mockReturnValue(memories),
        get: vi.fn(),
        run: mockRun,
      };
    }
    return {
      all: mockAll,
      get: vi.fn(),
      run: mockRun,
    };
  });

  const mockDb = {
    prepare: mockPrepare,
    run: mockRun.mockImplementation(() => {
      if (throwOnTransaction) throw new Error("Transaction failed");
    }),
    exec: vi.fn(),
    close: vi.fn(),
  };

  return { mockDb, mockPrepare, mockRun, mockAll };
}

function makeMemory(id: string, content: string, createdAt = Date.now() - 3600000) {
  return {
    id,
    content,
    type: "note",
    created_at: createdAt,
    access_count: 5,
    last_accessed: Date.now(),
    recency_score: 0.5,
    frequency_score: 0.3,
    importance_score: 0.5,
    utility_score: 0.3,
    novelty_score: 0.5,
    confidence_score: 0.7,
    interference_penalty: 0,
    strength: 0.5,
    metadata: null,
    container_tag: "mem_project_test",
  };
}

describe("memory-scoring-service", () => {
  beforeEach(() => {
    vi.mocked(shardManager.getAllShards).mockReturnValue([]);
    vi.mocked(connectionManager.getConnection).mockReset();
    (CONFIG as any).memoryScoring = {
      enabled: true,
      recencyHalfLifeDays: 7,
      utilityHalfLifeDays: 30,
      recalculationIntervalMinutes: 60,
    };
  });

  afterEach(() => {
    stopScoringRecalculation();
  });

  describe("recalculateAllScores", () => {
    it("returns empty result when no shards exist", () => {
      vi.mocked(shardManager.getAllShards).mockReturnValue([]);
      const result = recalculateAllScores();
      expect(result.updated).toBe(0);
      expect(result.shards).toBe(0);
    });

    it("skips shards with no memories", () => {
      const { mockDb } = makeMockDb([]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores();
      expect(result.updated).toBe(0);
      expect(result.shards).toBe(0);
    });

    it("recalculates scores for all memories in a shard", () => {
      const memories = [
        makeMemory("mem-1", "hello world test content", Date.now() - 86400000),
        makeMemory("mem-2", "another memory entry here", Date.now() - 172800000),
      ];
      const { mockDb, mockRun } = makeMockDb(memories);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(4);
      expect(mockRun).toHaveBeenCalledWith("BEGIN TRANSACTION");
      expect(mockRun).toHaveBeenCalledWith("COMMIT");
    });

    it("handles JSON metadata parsing", () => {
      const memory = makeMemory("mem-meta", "content with metadata");
      memory.metadata = JSON.stringify({ source: "manual", sessionID: "s1" });
      const { mockDb } = makeMockDb([memory]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
    });

    it("handles malformed JSON metadata gracefully", () => {
      const memory = makeMemory("mem-bad", "bad metadata");
      memory.metadata = "{invalid json";
      const { mockDb } = makeMockDb([memory]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
    });

    it("handles null metadata", () => {
      const memory = makeMemory("mem-null", "null metadata");
      memory.metadata = null;
      const { mockDb } = makeMockDb([memory]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
    });

    it("handles missing last_accessed gracefully", () => {
      const memory = makeMemory("mem-no-la", "no last accessed");
      memory.last_accessed = null;
      const { mockDb } = makeMockDb([memory]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
    });

    it("handles zero access_count", () => {
      const memory = makeMemory("mem-zero", "zero accesses");
      memory.access_count = 0;
      const { mockDb } = makeMockDb([memory]);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
    });

    it("recalculates novelty and interference when flag is true", () => {
      const memories = [
        makeMemory("mem-a", "function test() { return 1; }"),
        makeMemory("mem-b", "const x = test();"),
      ];
      const { mockDb } = makeMockDb(memories);
      vi.mocked(shardManager.getAllShards).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);

      const result = recalculateAllScores(true);
      expect(result.updated).toBe(4);
    });

    it("processes multiple shards", () => {
      const mem1 = [makeMemory("mem-1", "shard 1 content")];
      const mem2 = [makeMemory("mem-2", "shard 2 content")];
      const { mockDb: db1 } = makeMockDb(mem1);
      const { mockDb: db2 } = makeMockDb(mem2);

      vi.mocked(connectionManager.getConnection).mockReturnValueOnce(db1 as any);
      vi.mocked(connectionManager.getConnection).mockReturnValueOnce(db2 as any);

      vi.mocked(shardManager.getAllShards).mockReturnValueOnce([
        { id: "user-shard", dbPath: "/tmp/user.db" },
      ]);
      vi.mocked(shardManager.getAllShards).mockReturnValueOnce([
        { id: "proj-shard", dbPath: "/tmp/proj.db" },
      ]);

      const result = recalculateAllScores(false);
      expect(result.updated).toBe(2);
      expect(result.shards).toBe(2);
    });
  });

  describe("startScoringRecalculation", () => {
    it("starts the interval when enabled", () => {
      const result = startScoringRecalculation();
      expect(result).toBeUndefined();
    });

    it("does not start when scoring is disabled", () => {
      (CONFIG as any).memoryScoring.enabled = false;
      startScoringRecalculation();
      // No error thrown, just returns silently
    });

    it("does not start a second interval when already running", () => {
      startScoringRecalculation();
      startScoringRecalculation();
      // Second call should be a no-op
    });
  });

  describe("stopScoringRecalculation", () => {
    it("stops active interval", () => {
      startScoringRecalculation();
      stopScoringRecalculation();
      // No error thrown
    });

    it("is safe to call when no interval is running", () => {
      stopScoringRecalculation();
      // No error thrown
    });
  });

  describe("runOneTimeScoringRecalculation", () => {
    it("calls recalculateAllScores with full recalculation", () => {
      vi.mocked(shardManager.getAllShards).mockReturnValue([]);
      const result = runOneTimeScoringRecalculation();
      expect(result).toHaveProperty("updated");
      expect(result).toHaveProperty("shards");
      expect(result).toHaveProperty("duration");
    });
  });
});
