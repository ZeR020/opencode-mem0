import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: vi.fn(),
    decrementVectorCount: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    deleteVector: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(),
    checkpointAll: vi.fn(),
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    autoCleanupEnabled: true,
    autoCleanupRetentionDays: 30,
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    deleteOldPrompts: vi.fn(),
  },
}));

import { CleanupService, cleanupService } from "../src/services/cleanup-service.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { CONFIG } from "../src/config.js";
import { userPromptManager } from "../src/services/user-prompt/user-prompt-manager.js";

function makeMockDb(scenario: { pinned?: any[]; oldMemories?: any[] } = {}) {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      all: vi.fn().mockImplementation(() => {
        if (sql.includes("is_pinned = 1")) return scenario.pinned || [];
        return scenario.oldMemories || [];
      }),
    })),
  };
}

describe("CleanupService", () => {
  let service: CleanupService;

  beforeEach(() => {
    service = new CleanupService();
    vi.clearAllMocks();
    CONFIG.autoCleanupEnabled = true;
    CONFIG.autoCleanupRetentionDays = 30;
  });

  describe("shouldRunCleanup", () => {
    it("returns false when autoCleanupEnabled is false", async () => {
      CONFIG.autoCleanupEnabled = false;
      expect(await service.shouldRunCleanup()).toBe(false);
    });

    it("returns false when cleanup is already running", async () => {
      (service as any).isRunning = true;
      expect(await service.shouldRunCleanup()).toBe(false);
    });

    it("returns false when less than a day has passed", async () => {
      (service as any).lastCleanupTime = Date.now() - 1000;
      expect(await service.shouldRunCleanup()).toBe(false);
    });

    it("returns true when all conditions are met", async () => {
      (service as any).lastCleanupTime = 0;
      expect(await service.shouldRunCleanup()).toBe(true);
    });
  });

  describe("runCleanup", () => {
    it("throws when cleanup is already running", async () => {
      (service as any).isRunning = true;
      await expect(service.runCleanup()).rejects.toThrow("Cleanup already running");
    });

    it("returns zero counts when no shards exist", async () => {
      vi.mocked(shardManager.getAllShards).mockReturnValue([]);
      vi.mocked(userPromptManager.deleteOldPrompts).mockReturnValue({
        deleted: 0,
        linkedMemoryIds: [],
      });

      const result = await service.runCleanup();

      expect(result).toEqual({
        deletedCount: 0,
        userCount: 0,
        projectCount: 0,
        promptsDeleted: 0,
        linkedMemoriesProtected: 0,
        pinnedMemoriesSkipped: 0,
      });
    });

    it("skips pinned memories", async () => {
      const mockDb = makeMockDb({
        pinned: [{ id: "pinned-mem-1" }],
        oldMemories: [{ id: "mem-1", container_tag: "project_test", is_pinned: 1 }],
      });

      vi.mocked(shardManager.getAllShards).mockImplementation((type: string) =>
        type === "project"
          ? [{ id: "shard-1", dbPath: "/test/db.sqlite", tag: `${type}_test` }]
          : []
      );
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);
      vi.mocked(userPromptManager.deleteOldPrompts).mockReturnValue({
        deleted: 0,
        linkedMemoryIds: [],
      });

      const result = await service.runCleanup();

      expect(result.pinnedMemoriesSkipped).toBe(1);
      expect(result.deletedCount).toBe(0);
    });

    it("deletes old non-pinned memories", async () => {
      const mockDb = makeMockDb({
        pinned: [],
        oldMemories: [
          { id: "old-mem-1", container_tag: "xxx_project_xxx", is_pinned: 0 },
          { id: "old-mem-2", container_tag: "xxx_user_xxx", is_pinned: 0 },
        ],
      });

      vi.mocked(shardManager.getAllShards).mockImplementation((type: string) =>
        type === "project"
          ? [{ id: "shard-1", dbPath: "/test/db.sqlite", tag: `${type}_test` }]
          : []
      );
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);
      vi.mocked(vectorSearch.deleteVector).mockResolvedValue(undefined);
      vi.mocked(userPromptManager.deleteOldPrompts).mockReturnValue({
        deleted: 0,
        linkedMemoryIds: [],
      });

      const result = await service.runCleanup();

      expect(result.deletedCount).toBe(2);
      expect(result.projectCount).toBe(1);
      expect(result.userCount).toBe(1);
      expect(vectorSearch.deleteVector).toHaveBeenCalledTimes(2);
    });

    it("protects linked memories", async () => {
      const mockDb = makeMockDb({
        pinned: [],
        oldMemories: [
          { id: "linked-mem-1", container_tag: "project_test", is_pinned: 0 },
          { id: "normal-mem-1", container_tag: "project_test", is_pinned: 0 },
        ],
      });

      vi.mocked(shardManager.getAllShards).mockImplementation((type: string) =>
        type === "project"
          ? [{ id: "shard-1", dbPath: "/test/db.sqlite", tag: `${type}_test` }]
          : []
      );
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);
      vi.mocked(userPromptManager.deleteOldPrompts).mockReturnValue({
        deleted: 2,
        linkedMemoryIds: ["linked-mem-1"],
      });

      const result = await service.runCleanup();

      expect(result.linkedMemoriesProtected).toBe(1);
      expect(result.deletedCount).toBe(1);
    });

    it("handles errors during memory deletion gracefully", async () => {
      const mockDb = makeMockDb({
        pinned: [],
        oldMemories: [{ id: "err-mem-1", container_tag: "project_test", is_pinned: 0 }],
      });

      vi.mocked(shardManager.getAllShards).mockImplementation((type: string) =>
        type === "project"
          ? [{ id: "shard-1", dbPath: "/test/db.sqlite", tag: `${type}_test` }]
          : []
      );
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb as any);
      vi.mocked(vectorSearch.deleteVector).mockRejectedValue(new Error("DB error"));
      vi.mocked(userPromptManager.deleteOldPrompts).mockReturnValue({
        deleted: 0,
        linkedMemoryIds: [],
      });

      const result = await service.runCleanup();

      // Should not throw; error is logged and memory is not counted as deleted
      expect(result.deletedCount).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("returns current status", () => {
      const status = service.getStatus();
      expect(status).toEqual({
        enabled: true,
        retentionDays: 30,
        lastCleanupTime: 0,
        isRunning: false,
      });
    });
  });

  describe("singleton", () => {
    it("exports a singleton instance", () => {
      expect(cleanupService).toBeInstanceOf(CleanupService);
    });
  });
});
