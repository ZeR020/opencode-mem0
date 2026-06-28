import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ShardInfo } from "../src/services/sqlite/types.js";
import type { Database, Statement } from "../src/services/sqlite/sqlite-bootstrap.js";

// Setup global mock variables via vi.hoisted to prevent ReferenceErrors during module initialization
const mockState = vi.hoisted(() => ({
  shards: [] as ShardInfo[],
  dbPrepare: null as null | ((sql: string) => Statement),
  dbRun: null as
    | null
    | ((
        sql: string,
        ...params: unknown[]
      ) => { changes: number; lastInsertRowid: number | bigint }),
  logCalls: [] as Array<{ message: string; meta?: Record<string, unknown> }>,
}));

const mockConfig = vi.hoisted(() => ({
  memoryLifecycle: {
    promotionThreshold: 0.7,
    checkIntervalMinutes: 60,
    decayBatchSize: 5000,
  },
  contextualDecay: {
    enabled: true,
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn((message: string, meta?: Record<string, unknown>) => {
    if (message === "applyDecay error") {
      throw new Error("log failure");
    }
    mockState.logCalls.push({ message, meta });
  }),
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn((dbPath: string): Database => {
      // Return a typed mock Database complying with Database interface
      return {
        prepare: vi.fn((sql: string): Statement => {
          if (mockState.dbPrepare) {
            return mockState.dbPrepare(sql);
          }
          return {
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
          } satisfies Statement;
        }),
        run: vi.fn((sql: string, ...params: unknown[]) => {
          if (mockState.dbRun) {
            return mockState.dbRun(sql, ...params);
          }
          return { changes: 0, lastInsertRowid: 0 };
        }),
        exec: vi.fn(),
        close: vi.fn(),
      } satisfies Database;
    }),
  },
}));

vi.mock("../src/services/sqlite/shard-manager.js", () => {
  return {
    shardManager: {
      getAllShards: vi.fn(() => mockState.shards),
      decrementVectorCount: vi.fn(),
    },
    getAllShards: vi.fn(() => mockState.shards),
    extractScopeFromContainerTag: (tag: string, defaultScope: "user" | "project" = "user") => {
      const parts = tag.split("_");
      return parts.length >= 3
        ? { scope: parts[1] as "user" | "project", hash: parts.slice(2).join("_") }
        : { scope: defaultScope, hash: tag };
    },
  };
});

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    deleteVector: vi.fn(),
  },
}));

// Statically import the module under test and other services
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { shardManager, getAllShards } from "../src/services/sqlite/shard-manager.js";
import {
  promoteToLTM,
  scanAndPromote,
  getArchivedCount,
  getLifecycleStats,
  startLifecycleJob,
  stopLifecycleJob,
  runLifecycleMaintenance,
} from "../src/services/memory-lifecycle.js";

describe("memory-lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.logCalls.length = 0;
    mockState.dbPrepare = null;
    mockState.dbRun = null;
    mockState.shards = [
      {
        id: 1,
        scope: "user",
        scopeHash: "hash1",
        shardIndex: 0,
        dbPath: "path1",
        vectorCount: 0,
        isActive: true,
        createdAt: Date.now(),
      },
    ];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("promoteToLTM", () => {
    it("should return success: false when memory is not found in any shard", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = promoteToLTM("nonexistent");
      expect(res).toEqual({ success: false, promoted: false });
    });

    it("should return success: true, promoted: false if store_type is not stm", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: "mem-1", store_type: "ltm", strength: 0.9, access_count: 5 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: true, promoted: false });
    });

    it("should return success: true, promoted: false if strength <= threshold", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: "mem-1", store_type: "stm", strength: 0.6, access_count: 5 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: true, promoted: false });
    });

    it("should return success: true, promoted: false if access_count <= 3", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: "mem-1", store_type: "stm", strength: 0.8, access_count: 3 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: true, promoted: false });
    });

    it("should promote memory and return success: true, promoted: true if strength > threshold and access_count > 3", () => {
      const runMock = vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }));
      mockState.dbPrepare = vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("SELECT")) {
          return {
            get: vi.fn(() => ({ id: "mem-1", store_type: "stm", strength: 0.8, access_count: 5 })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
          } satisfies Statement;
        }
        if (sql.includes("UPDATE")) {
          return {
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
            run: runMock,
          } satisfies Statement;
        }
        return {
          get: vi.fn(() => undefined),
          all: vi.fn(() => []),
          run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
        } satisfies Statement;
      });

      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: true, promoted: true });
      expect(runMock).toHaveBeenCalledWith("mem-1");
      expect(mockState.logCalls.some((c) => c.message === "Memory promoted to LTM")).toBe(true);
    });

    it("should handle shard-level error, log it, and continue/return success: false", () => {
      mockState.dbPrepare = vi.fn().mockImplementation(() => {
        throw new Error("db failure");
      });

      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: false, promoted: false });
      expect(mockState.logCalls.some((c) => c.message === "promoteToLTM shard error")).toBe(true);
    });

    it("should handle outer error, log it, and return success: false", () => {
      vi.mocked(getAllShards).mockImplementationOnce(() => {
        throw new Error("outer crash");
      });
      const res = promoteToLTM("mem-1");
      expect(res).toEqual({ success: false, promoted: false });
      expect(mockState.logCalls.some((c) => c.message === "promoteToLTM error")).toBe(true);
    });
  });

  describe("scanAndPromote", () => {
    it("should scan and promote candidates", () => {
      const runMock = vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }));
      mockState.dbPrepare = vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("store_type = 'stm'")) {
          return {
            get: vi.fn(() => undefined),
            all: vi.fn(() => [{ id: "cand-1", strength: 0.8, access_count: 5 }]),
            run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
          } satisfies Statement;
        }
        if (sql.includes("SELECT id, store_type, strength, access_count")) {
          return {
            get: vi.fn(() => ({ id: "cand-1", store_type: "stm", strength: 0.8, access_count: 5 })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
          } satisfies Statement;
        }
        if (sql.includes("UPDATE")) {
          return {
            get: vi.fn(() => undefined),
            all: vi.fn(() => []),
            run: runMock,
          } satisfies Statement;
        }
        return {
          get: vi.fn(() => undefined),
          all: vi.fn(() => []),
          run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
        } satisfies Statement;
      });

      const res = scanAndPromote();
      expect(res).toEqual({ scanned: 1, promoted: 1 });
      expect(runMock).toHaveBeenCalledWith("cand-1");
      expect(mockState.logCalls.some((c) => c.message === "Memory promotion scan complete")).toBe(
        true
      );
    });

    it("should catch shard-level error, log it, and continue", () => {
      mockState.shards = [
        {
          id: 1,
          scope: "user",
          scopeHash: "failed",
          shardIndex: 0,
          dbPath: "failed-path",
          vectorCount: 0,
          isActive: true,
          createdAt: Date.now(),
        },
        {
          id: 2,
          scope: "user",
          scopeHash: "ok",
          shardIndex: 1,
          dbPath: "ok-path",
          vectorCount: 0,
          isActive: true,
          createdAt: Date.now(),
        },
      ];

      // Mock getConnection to throw for the first call, and return normal mock database for second
      vi.mocked(connectionManager.getConnection)
        .mockImplementationOnce(() => {
          throw new Error("connection failed");
        })
        .mockImplementationOnce((): Database => {
          return {
            prepare: vi.fn(() => ({
              get: vi.fn(() => undefined),
              all: vi.fn(() => []),
              run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
            })),
            run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
            exec: vi.fn(),
            close: vi.fn(),
          } satisfies Database;
        });

      const res = scanAndPromote();
      expect(res).toEqual({ scanned: 0, promoted: 0 });
      expect(mockState.logCalls.some((c) => c.message === "scanAndPromote shard error")).toBe(true);
    });

    it("should catch outer error, log it, and return scanned: 0, promoted: 0", () => {
      vi.mocked(getAllShards).mockImplementationOnce(() => {
        throw new Error("outer crash");
      });
      const res = scanAndPromote();
      expect(res).toEqual({ scanned: 0, promoted: 0 });
      expect(mockState.logCalls.some((c) => c.message === "scanAndPromote error")).toBe(true);
    });
  });

  describe("getArchivedCount", () => {
    it("should return the sum of counts from all shards", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ count: 42 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = getArchivedCount();
      expect(res).toBe(42);
    });

    it("should return 0 for a shard if the archive table is missing or query throws", () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => {
          throw new Error("no such table");
        }),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      const res = getArchivedCount();
      expect(res).toBe(0);
    });

    it("should log error and return 0 on outer error", () => {
      vi.mocked(getAllShards).mockImplementationOnce(() => {
        throw new Error("outer crash");
      });

      const res = getArchivedCount();
      expect(res).toBe(0);
      expect(mockState.logCalls.some((c) => c.message === "getArchivedCount error")).toBe(true);
    });
  });

  describe("getLifecycleStats", () => {
    it("should return the current stats", () => {
      const stats = getLifecycleStats();
      expect(stats).toHaveProperty("skippedCycles");
      expect(stats).toHaveProperty("lastDurationMs");
      expect(typeof stats.skippedCycles).toBe("number");
      expect(typeof stats.lastDurationMs).toBe("number");
    });
  });

  describe("runLifecycleMaintenance", () => {
    it("should run successfully and handle already running guard", async () => {
      // For this test, mock applyDecay queries to just return empty array
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      // Trigger twice concurrently to test the already running guard
      const p1 = runLifecycleMaintenance();
      const p2 = runLifecycleMaintenance();

      await Promise.all([p1, p2]);

      expect(
        mockState.logCalls.some(
          (c) => c.message === "Lifecycle maintenance skipped: already running"
        )
      ).toBe(true);
    });

    it("should catch errors, log them, and reset running flag", async () => {
      vi.mocked(getAllShards).mockImplementationOnce(() => {
        throw new Error("maintenance crash");
      });

      await runLifecycleMaintenance();
      expect(mockState.logCalls.some((c) => c.message === "Lifecycle maintenance error")).toBe(
        true
      );
    });
  });

  describe("startLifecycleJob / stopLifecycleJob & LifecycleManager internals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      stopLifecycleJob();
    });

    it("should start, stop, and track skipped cycles when run concurrently", async () => {
      mockState.dbPrepare = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
      } satisfies Statement);

      startLifecycleJob();
      expect(mockState.logCalls.some((c) => c.message === "Memory lifecycle job started")).toBe(
        true
      );

      // Simulate running by calling runLifecycleMaintenance but not awaiting it
      const maintenancePromise = runLifecycleMaintenance();

      // Advance timers by 60 minutes
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(getLifecycleStats().skippedCycles).toBe(1);

      // Advance another 9 times to trigger log message (total 10 skipped cycles)
      for (let i = 0; i < 9; i++) {
        vi.advanceTimersByTime(60 * 60 * 1000);
      }
      expect(getLifecycleStats().skippedCycles).toBe(10);
      expect(
        mockState.logCalls.some(
          (c) => c.message === "Lifecycle job falling behind — skipped cycles accumulating"
        )
      ).toBe(true);

      await maintenancePromise;

      stopLifecycleJob();
      expect(mockState.logCalls.some((c) => c.message === "Memory lifecycle job stopped")).toBe(
        true
      );
    });
  });
});
