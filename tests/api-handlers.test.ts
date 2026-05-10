import { describe, it, expect, beforeEach, vi } from "vitest";

const mockDbByPath = new Map<string, any>();

function makeDb(name: string) {
  const data: Record<string, any[]> = {};
  const stmts = new Map<string, any>();
  return {
    name,
    run: (sql: string, ...params: any[]) => {
      if (sql.includes("INSERT")) {
        const table = sql.match(/INTO\s+(\w+)/)?.[1] || "default";
        if (!data[table]) data[table] = [];
        data[table].push({ id: `id_${data[table].length}`, ...params });
        return { changes: 1, lastInsertRowid: data[table].length };
      }
      if (sql.includes("DELETE")) {
        return { changes: 1 };
      }
      if (sql.includes("UPDATE")) {
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    prepare: (sql: string) => {
      if (!stmts.has(sql)) {
        stmts.set(sql, {
          get: (..._params: any[]) => {
            if (sql.includes("COUNT")) return { count: 0 };
            if (sql.includes("SUM")) return { user_count: 0, project_count: 0 };
            return null;
          },
          all: (..._params: any[]) => {
            if (sql.includes("memories")) {
              return data["memories"] || [];
            }
            if (sql.includes("memory_conflicts")) {
              return [{ count: 0 }];
            }
            return [];
          },
          run: (..._params: any[]) => ({ changes: 1 }),
        });
      }
      return stmts.get(sql)!;
    },
    _data: data,
  };
}

function makeShard(id: string) {
  return { id, dbPath: `/tmp/db-${id}.db`, scope: "project" };
}

const mockShards = [makeShard("shard-a"), makeShard("shard-b")];

const mockMemories: any[] = [
  {
    id: "mem-1",
    content: "Test memory 1",
    container_tag: "tag_project_abc123",
    type: "feature",
    tags: "react,frontend",
    created_at: Date.now(),
    updated_at: Date.now(),
    metadata: JSON.stringify({ promptId: "prompt-1" }),
    display_name: "Test User",
    user_name: "testuser",
    user_email: "test@example.com",
    project_path: "/test/project",
    project_name: "TestProject",
    git_repo_url: "https://github.com/test/project",
    is_pinned: 0,
  },
  {
    id: "mem-2",
    content: "Test memory 2",
    container_tag: "tag_project_abc123",
    type: "bug-fix",
    tags: "api,backend",
    created_at: Date.now() - 1000,
    updated_at: null,
    metadata: JSON.stringify({}),
    display_name: null,
    user_name: null,
    user_email: null,
    project_path: null,
    project_name: null,
    git_repo_url: null,
    is_pinned: 1,
  },
];

const mockDistinctTags = [
  {
    container_tag: "tag_project_abc123",
    display_name: "Test User",
    user_name: "testuser",
    user_email: "test@example.com",
    project_path: "/test/project",
    project_name: "TestProject",
    git_repo_url: "https://github.com/test/project",
  },
];

const mockPrompts = [
  {
    id: "prompt-1",
    sessionId: "sess-1",
    content: "Test prompt",
    createdAt: Date.now(),
    projectPath: "/test/project",
    linkedMemoryId: "mem-1",
  },
];

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 2, 3]),
    getCacheStats: () => ({ size: 100, maxSize: 1000, hits: 50, misses: 50, rate: 0.5 }),
    embeddingAvailable: true,
  },
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection(path: string) {
      if (!mockDbByPath.has(path)) {
        mockDbByPath.set(path, makeDb(path));
      }
      return mockDbByPath.get(path);
    },
    closeAll() {
      mockDbByPath.clear();
    },
  },
}));

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards(scope: string, hash: string) {
      return scope === "project" && hash === "" ? mockShards : [makeShard("shard-current")];
    },
    getWriteShard() {
      return mockShards[0];
    },
    incrementVectorCount() {},
    decrementVectorCount() {},
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    getDistinctTags: (_db: any) => mockDistinctTags,
    listMemories: (db: any, tag: string, limit: number) => {
      if (!tag) return mockMemories.filter((m) => m.container_tag?.includes("_project_"));
      return mockMemories.filter((m) => m.container_tag === tag).slice(0, limit);
    },
    getMemoryById: (db: any, id: string) => mockMemories.find((m) => m.id === id) || null,
    insertVector: async () => {},
    deleteVector: async () => {},
    replaceVector: async () => {},
    pinMemory: () => {},
    unpinMemory: () => {},
    updateVector: async () => {},
    searchInShard: async (_shard: any, _vector: any, _tag: string, _limit: number, _query?: string) => {
      return mockMemories.map((m) => ({
        id: m.id,
        memory: m.content,
        type: m.type,
        tags: m.tags ? m.tags.split(",") : [],
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        similarity: 0.95,
        metadata: JSON.parse(m.metadata),
        displayName: m.display_name,
        userName: m.user_name,
        userEmail: m.user_email,
        projectPath: m.project_path,
        projectName: m.project_name,
        gitRepoUrl: m.git_repo_url,
        isPinned: m.is_pinned,
      }));
    },
  },
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    getCapturedPrompts: () => mockPrompts,
    searchPrompts: (query: string, _projectPath?: string, _limit?: number) => {
      return mockPrompts.filter((p) =>
        query ? p.content.toLowerCase().includes(query.toLowerCase()) : true
      );
    },
    getPromptsByIds: (ids: string[]) => mockPrompts.filter((p) => ids.includes(p.id)),
    getPromptById: (id: string) => mockPrompts.find((p) => p.id === id) || null,
    deletePrompt: () => {},
  },
}));

vi.mock("../src/services/memory-conflicts.js", () => ({
  getAllUnresolvedConflicts: (_limit: number) => [
    {
      id: "conflict-1",
      memoryId1: "mem-1",
      memoryId2: "mem-2",
      memory1Content: "Memory 1",
      memory2Content: "Memory 2",
      similarityScore: 0.8,
      detectedAt: Date.now(),
      resolved: 0,
      resolutionType: null,
    },
  ],
  resolveConflict: async () => ({ success: true, mergedMemoryId: "mem-merged" }),
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    memoryProvider: "openai",
    storagePath: "/tmp/test",
  },
}));

const {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleUpdateMemory,
  handleSearch,
  handleEmbeddingCacheStats,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleDeletePrompt,
  handleBulkDelete,
  handleGetUserProfile,
  handleListConflicts,
  handleResolveConflict,
  handleConflictStats,
  handleDetectTagMigration,
  handleGetTagMigrationProgress,
} = await import("../src/services/api-handlers.js");

describe("api-handlers", () => {
  beforeEach(() => {
    mockDbByPath.clear();
  });

  describe("handleListTags", () => {
    it("returns project tags", async () => {
      const result = await handleListTags();
      expect(result.success).toBe(true);
      expect(result.data?.project).toHaveLength(1);
      expect(result.data?.project[0].tag).toBe("tag_project_abc123");
    });
  });

  describe("handleListMemories", () => {
    it("returns paginated memories", async () => {
      const result = await handleListMemories("tag_project_abc123", 1, 20);
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThan(0);
      expect(result.data?.totalPages).toBeGreaterThanOrEqual(1);
    });

    it("returns memories without tag filter", async () => {
      const result = await handleListMemories();
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThanOrEqual(0);
    });

    it("sanitizes invalid page parameters", async () => {
      const result = await handleListMemories("tag_project_abc123", -1, 200);
      expect(result.success).toBe(true);
      expect(result.data?.page).toBe(1);
      expect(result.data?.pageSize).toBe(20);
    });
  });

  describe("handleAddMemory", () => {
    it("adds a memory successfully", async () => {
      const result = await handleAddMemory({
        content: "New memory",
        containerTag: "tag_project_abc123",
        type: "feature",
        tags: ["react", "ui"],
      });
      expect(result.success).toBe(true);
      expect(result.data?.id).toMatch(/^mem_/);
    });

    it("rejects missing content", async () => {
      const result = await handleAddMemory({
        content: "",
        containerTag: "tag_project_abc123",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("rejects missing containerTag", async () => {
      const result = await handleAddMemory({
        content: "Test",
        containerTag: "",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleDeleteMemory", () => {
    it("deletes existing memory", async () => {
      const result = await handleDeleteMemory("mem-1");
      expect(result.success).toBe(true);
    });

    it("returns not found for missing memory", async () => {
      const result = await handleDeleteMemory("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Memory not found");
    });

    it("cascades to linked prompt", async () => {
      const result = await handleDeleteMemory("mem-1", true);
      expect(result.success).toBe(true);
      expect(result.data?.deletedPrompt).toBe(true);
    });

    it("rejects empty id", async () => {
      const result = await handleDeleteMemory("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleBulkDelete", () => {
    it("deletes multiple memories", async () => {
      const result = await handleBulkDelete(["mem-1", "mem-2"]);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(2);
    });

    it("rejects empty array", async () => {
      const result = await handleBulkDelete([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleUpdateMemory", () => {
    it("updates memory content", async () => {
      const result = await handleUpdateMemory("mem-1", { content: "Updated content" });
      expect(result.success).toBe(true);
    });

    it("updates memory tags", async () => {
      const result = await handleUpdateMemory("mem-1", { tags: ["new", "tags"] });
      expect(result.success).toBe(true);
    });

    it("returns not found for missing memory", async () => {
      const result = await handleUpdateMemory("nonexistent", { content: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Memory not found");
    });

    it("rejects empty id", async () => {
      const result = await handleUpdateMemory("", { content: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleSearch", () => {
    it("searches memories by query", async () => {
      const result = await handleSearch("test", "tag_project_abc123");
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThan(0);
    });

    it("searches without tag", async () => {
      const result = await handleSearch("test");
      expect(result.success).toBe(true);
    });

    it("rejects empty query", async () => {
      const result = await handleSearch("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("sanitizes invalid page parameters", async () => {
      const result = await handleSearch("test", undefined, -1, 200);
      expect(result.success).toBe(true);
      expect(result.data?.page).toBe(1);
      expect(result.data?.pageSize).toBe(20);
    });
  });

  describe("handleEmbeddingCacheStats", () => {
    it("returns cache statistics", async () => {
      const result = await handleEmbeddingCacheStats();
      expect(result.success).toBe(true);
      expect(result.data?.size).toBe(100);
      expect(result.data?.hits).toBe(50);
      expect(result.data?.misses).toBe(50);
    });
  });

  describe("handleStats", () => {
    it("returns memory statistics", async () => {
      const result = await handleStats();
      expect(result.success).toBe(true);
      expect(result.data?.total).toBeDefined();
      expect(result.data?.byScope).toBeDefined();
      expect(result.data?.byType).toBeDefined();
    });
  });

  describe("handlePinMemory", () => {
    it("pins existing memory", async () => {
      const result = await handlePinMemory("mem-1");
      expect(result.success).toBe(true);
    });

    it("returns not found for missing memory", async () => {
      const result = await handlePinMemory("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Memory not found");
    });

    it("rejects empty id", async () => {
      const result = await handlePinMemory("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleUnpinMemory", () => {
    it("unpins existing memory", async () => {
      const result = await handleUnpinMemory("mem-2");
      expect(result.success).toBe(true);
    });

    it("returns not found for missing memory", async () => {
      const result = await handleUnpinMemory("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Memory not found");
    });
  });

  describe("handleDeletePrompt", () => {
    it("deletes existing prompt", async () => {
      const result = await handleDeletePrompt("prompt-1");
      expect(result.success).toBe(true);
      expect(result.data?.deletedMemory).toBe(false);
    });

    it("cascades to linked memory", async () => {
      const result = await handleDeletePrompt("prompt-1", true);
      expect(result.success).toBe(true);
    });

    it("returns not found for missing prompt", async () => {
      const result = await handleDeletePrompt("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Prompt not found");
    });

    it("rejects empty id", async () => {
      const result = await handleDeletePrompt("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleGetUserProfile", () => {
    it("returns profile not found", async () => {
      const result = await handleGetUserProfile("unknown-user");
      expect(result.success).toBe(true);
      expect(result.data?.exists).toBe(false);
    });
  });

  describe("handleListConflicts", () => {
    it("returns unresolved conflicts", async () => {
      const result = await handleListConflicts(false);
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].id).toBe("conflict-1");
    });

    it("returns empty for resolved conflicts", async () => {
      const result = await handleListConflicts(true);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.message).toContain("not yet supported");
    });
  });

  describe("handleResolveConflict", () => {
    it("resolves conflict with valid strategy", async () => {
      const result = await handleResolveConflict("conflict-1", "merge");
      expect(result.success).toBe(true);
      expect(result.data?.mergedMemoryId).toBe("mem-merged");
    });

    it("rejects invalid strategy", async () => {
      const result = await handleResolveConflict("conflict-1", "invalid");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid strategy");
    });

    it("rejects missing conflictId", async () => {
      const result = await handleResolveConflict("", "merge");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("rejects missing strategy", async () => {
      const result = await handleResolveConflict("conflict-1", "");
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("handleConflictStats", () => {
    it("returns conflict statistics", async () => {
      const result = await handleConflictStats();
      expect(result.success).toBe(true);
      expect(result.data?.unresolved).toBeDefined();
      expect(result.data?.resolved).toBeDefined();
    });
  });

  describe("handleDetectTagMigration", () => {
    it("returns migration status", async () => {
      const result = await handleDetectTagMigration();
      expect(result.success).toBe(true);
      expect(result.data?.needsMigration).toBeDefined();
      expect(result.data?.count).toBeDefined();
    });
  });

  describe("handleGetTagMigrationProgress", () => {
    it("returns progress tracker", async () => {
      const result = await handleGetTagMigrationProgress();
      expect(result.success).toBe(true);
      expect(result.data?.processed).toBe(0);
      expect(result.data?.isComplete).toBe(true);
    });
  });
});
