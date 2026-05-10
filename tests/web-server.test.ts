import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/services/api-handlers.js", () => ({
  handleListTags: () => ({ success: true, data: { project: [] } }),
  handleListMemories: () => ({
    success: true,
    data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
  }),
  handleAddMemory: () => ({ success: true, data: { id: "mem-1" } }),
  handleDeleteMemory: () => ({ success: true, data: { deletedPrompt: false } }),
  handleBulkDelete: () => ({ success: true, data: { deleted: 1 } }),
  handleUpdateMemory: () => ({ success: true }),
  handleSearch: () => ({
    success: true,
    data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
  }),
  handleStats: () => ({
    success: true,
    data: { total: 0, byScope: { user: 0, project: 0 }, byType: {} },
  }),
  handlePinMemory: () => ({ success: true }),
  handleUnpinMemory: () => ({ success: true }),
  handleRunCleanup: () => ({
    success: true,
    data: { deletedCount: 0, userCount: 0, projectCount: 0 },
  }),
  handleRunDeduplication: () => ({
    success: true,
    data: { exactDuplicatesDeleted: 0, nearDuplicateGroups: [] },
  }),
  handleDetectMigration: () => ({
    success: true,
    data: {
      needsMigration: false,
      configDimensions: 768,
      configModel: "test",
      shardMismatches: [],
    },
  }),
  handleRunMigration: () => ({
    success: true,
    data: { success: true, strategy: "test", deletedShards: 0, reEmbeddedMemories: 0, duration: 0 },
  }),
  handleDetectTagMigration: () => ({
    success: true,
    data: { needsMigration: false, count: 0 },
  }),
  handleRunTagMigrationBatch: () => ({
    success: true,
    data: { processed: 0, total: 0, hasMore: false },
  }),
  handleGetTagMigrationProgress: () => ({
    success: true,
    data: {
      processed: 0,
      total: 0,
      currentBatch: 0,
      totalBatches: 0,
      isComplete: true,
      errors: [],
    },
  }),
  handleDeletePrompt: () => ({ success: true, data: { deletedMemory: false } }),
  handleBulkDeletePrompts: () => ({ success: true, data: { deleted: 1 } }),
  handleGetUserProfile: () => ({ success: true, data: { exists: false } }),
  handleGetProfileChangelog: () => ({ success: true, data: [] }),
  handleGetProfileSnapshot: () => ({ success: true, data: { version: 1, profileData: {} } }),
  handleRefreshProfile: () => ({ success: true, data: { message: "ok" } }),
  handleListConflicts: () => ({ success: true, data: [] }),
  handleResolveConflict: () => ({ success: true, data: { mergedMemoryId: "mem-1" } }),
  handleConflictStats: () => ({ success: true, data: { unresolved: 0, resolved: 0 } }),
  handleEmbeddingCacheStats: () => ({
    success: true,
    data: { size: 0, maxSize: 1000, hits: 0, misses: 0, rate: 0 },
  }),
}));

const { WebServer } = await import("../src/services/web-server.js");

describe("WebServer", () => {
  it("constructs with config", () => {
    const server = new WebServer({ port: 4747, host: "127.0.0.1", enabled: false });
    expect(server.getUrl()).toBe("http://127.0.0.1:4747");
    expect(server.isRunning()).toBe(false);
    expect(server.isServerOwner()).toBe(false);
  });

  it("does not start when disabled", async () => {
    const server = new WebServer({ port: 4748, host: "127.0.0.1", enabled: false });
    await server.start();
    expect(server.isRunning()).toBe(false);
    await server.stop();
  });

  it("redacts PII from objects", () => {
    const server = new WebServer({ port: 4749, host: "127.0.0.1", enabled: false });
    // Access private method via any
    const redacted = (server as any).redactPII({
      userEmail: "test@example.com",
      displayName: "Test User",
      userName: "testuser",
      projectPath: "/secret/path",
      projectName: "SecretProject",
      gitRepoUrl: "https://github.com/secret/repo",
      userId: "user-123",
      safeField: "visible",
    });
    expect(redacted.userEmail).toBe("[REDACTED]");
    expect(redacted.displayName).toBe("[REDACTED]");
    expect(redacted.userName).toBe("[REDACTED]");
    expect(redacted.projectPath).toBe("[REDACTED]");
    expect(redacted.projectName).toBe("[REDACTED]");
    expect(redacted.gitRepoUrl).toBe("[REDACTED]");
    expect(redacted.userId).toBe("[REDACTED]");
    expect(redacted.safeField).toBe("visible");
  });

  it("redacts PII from nested objects", () => {
    const server = new WebServer({ port: 4750, host: "127.0.0.1", enabled: false });
    const redacted = (server as any).redactPII({
      nested: { userEmail: "test@example.com", safe: "ok" },
      arr: [{ userName: "test" }, { userName: "test2" }],
    });
    expect(redacted.nested.userEmail).toBe("[REDACTED]");
    expect(redacted.nested.safe).toBe("ok");
    expect(redacted.arr[0].userName).toBe("[REDACTED]");
    expect(redacted.arr[1].userName).toBe("[REDACTED]");
  });

  it("redacts empty/null PII values without [REDACTED]", () => {
    const server = new WebServer({ port: 4751, host: "127.0.0.1", enabled: false });
    const redacted = (server as any).redactPII({
      userEmail: "",
      displayName: null,
      userName: undefined,
      safe: "visible",
    });
    expect(redacted.userEmail).toBe("");
    expect(redacted.displayName).toBeNull();
    expect(redacted.userName).toBeUndefined();
    expect(redacted.safe).toBe("visible");
  });

  it("passes through primitives in redactPII", () => {
    const server = new WebServer({ port: 4752, host: "127.0.0.1", enabled: false });
    expect((server as any).redactPII(null)).toBeNull();
    expect((server as any).redactPII("string")).toBe("string");
    expect((server as any).redactPII(42)).toBe(42);
  });

  it("sets takeover callback", () => {
    const server = new WebServer({ port: 4753, host: "127.0.0.1", enabled: false });
    let called = false;
    server.setOnTakeoverCallback(() => {
      called = true;
      return Promise.resolve();
    });
    expect(called).toBe(false);
  });

  it("checkServerAvailable returns false for unavailable server", async () => {
    const server = new WebServer({ port: 4754, host: "127.0.0.1", enabled: false });
    const available = await server.checkServerAvailable();
    expect(available).toBe(false);
  });
});
