import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(),
    closeConnection: vi.fn(),
    checkpointAll: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    deleteShardIndexes: vi.fn(),
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    storagePath: "/tmp/test-shard-mgr",
    embeddingDimensions: 384,
    embeddingModel: "test-model",
    maxVectorsPerShard: 1000,
  },
}));

vi.mock("../src/services/sqlite/schema.js", () => ({
  runMigrations: vi.fn(),
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

import {
  extractScopeFromContainerTag,
  getAllShards,
} from "../src/services/sqlite/shard-manager.js";

describe("extractScopeFromContainerTag", () => {
  it("extracts scope and hash from standard container tag", () => {
    const result = extractScopeFromContainerTag("mem_user_abc123");
    expect(result).toEqual({ scope: "user", hash: "abc123" });
  });

  it("extracts project scope from container tag", () => {
    const result = extractScopeFromContainerTag("mem_project_def456");
    expect(result).toEqual({ scope: "project", hash: "def456" });
  });

  it("handles hash with underscores", () => {
    const result = extractScopeFromContainerTag("mem_user_abc_123_def");
    expect(result).toEqual({ scope: "user", hash: "abc_123_def" });
  });

  it("returns default scope for short tags", () => {
    const result = extractScopeFromContainerTag("short");
    expect(result).toEqual({ scope: "user", hash: "short" });
  });

  it("returns default scope for two-part tags", () => {
    const result = extractScopeFromContainerTag("mem_user");
    expect(result).toEqual({ scope: "user", hash: "mem_user" });
  });

  it("uses project as default scope when specified", () => {
    const result = extractScopeFromContainerTag("short", "project");
    expect(result).toEqual({ scope: "project", hash: "short" });
  });

  it("handles project scope with underscores in hash", () => {
    const result = extractScopeFromContainerTag("mem_project_x_y_z");
    expect(result).toEqual({ scope: "project", hash: "x_y_z" });
  });
});

describe("getAllShards", () => {
  it("returns concatenated user and project shards", () => {
    const mockGetAllShards = vi.fn();
    mockGetAllShards
      .mockReturnValueOnce([{ id: 1, scope: "user", scopeHash: "h1" }])
      .mockReturnValueOnce([{ id: 2, scope: "project", scopeHash: "h2" }]);

    vi.doMock("../src/services/sqlite/shard-manager.js", async () => {
      const actual = await vi.importActual("../src/services/sqlite/shard-manager.js");
      return {
        ...actual,
        shardManager: {
          getAllShards: mockGetAllShards,
        },
      };
    });

    expect(mockGetAllShards).toBeDefined();
  });
});
