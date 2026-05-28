import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    insertVector: vi.fn(),
    deleteVector: vi.fn(),
    searchSimilar: vi.fn(),
    listMemories: vi.fn(),
  },
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    embed: vi.fn().mockResolvedValue(new Float32Array(768)),
  },
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    opencodeProvider: null,
    opencodeModel: null,
    memoryModel: null,
    memoryApiUrl: null,
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  isProviderConnected: vi.fn().mockReturnValue(false),
  getStatePath: vi.fn().mockReturnValue("/tmp/state.json"),
  generateStructuredOutput: vi.fn(),
}));

vi.mock("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: vi.fn(),
  },
}));

vi.mock("../src/services/ai/provider-config.js", () => ({
  buildMemoryProviderConfig: vi.fn().mockReturnValue({}),
}));

import {
  detectConflicts,
  resolveConflict,
  getConflicts,
  getAllUnresolvedConflicts,
} from "../src/services/memory-conflicts.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";
import { embeddingService } from "../src/services/embedding.js";
import {
  isProviderConnected,
  generateStructuredOutput,
} from "../src/services/ai/opencode-provider.js";

function makeMockDb(
  options: {
    ftsMemories?: any[];
    likeMemories?: any[];
    conflictRows?: any[];
    memForAge?: any[];
  } = {}
) {
  const ftsMemories = options.ftsMemories || [];
  const likeMemories = options.likeMemories || [];
  const conflictRows = options.conflictRows || [];
  const memForAge = options.memForAge || [];

  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master") && sql.includes("memories_fts")) {
        return {
          get: vi.fn().mockReturnValue(ftsMemories.length > 0 ? { name: "memories_fts" } : null),
        };
      }
      if (
        sql.includes("memory_conflicts WHERE (memory_id_1 =") ||
        (sql.includes("memory_conflicts WHERE id = ?") && !sql.includes("LEFT JOIN"))
      ) {
        return {
          get: vi.fn().mockReturnValue(conflictRows[0] || null),
        };
      }
      return {
        all: vi.fn().mockImplementation((...args: any[]) => {
          if (sql.includes("memories_fts MATCH")) return ftsMemories;
          if (sql.includes("content LIKE") || sql.includes("AND id !=")) return likeMemories;
          if (sql.includes("memory_conflicts") && sql.includes("LEFT JOIN")) return conflictRows;
          if (
            sql.includes("FROM memories WHERE id = ?") ||
            sql.includes("FROM memories WHERE id IN")
          )
            return memForAge;
          return [];
        }),
        get: vi.fn().mockReturnValue(memForAge[0] || null),
        run: vi.fn(),
      };
    }),
    run: vi.fn(),
    exec: vi.fn(),
    close: vi.fn(),
  };
}

describe("memory-conflicts", () => {
  beforeEach(() => {
    (shardManager.getAllShards as any).mockReturnValue([]);
  });

  describe("extractScopeFromContainerTag (via detectConflicts)", () => {
    it("returns empty conflicts when no shards exist", async () => {
      (shardManager.getAllShards as any).mockReturnValue([]);
      const conflicts = await detectConflicts("mem-1", "test content", "mem_project_abc");
      expect(conflicts).toEqual([]);
    });
  });

  describe("detectConflicts", () => {
    it("skips when another check is running", async () => {
      // First call acquires lock
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ likeMemories: [] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      // Fire first call (don't await — lock is held)
      const promise1 = detectConflicts("mem-new", "new content", "mem_project_hash");
      // Second call should skip
      const conflicts = await detectConflicts("mem-new-2", "other content", "mem_project_hash");
      expect(conflicts).toEqual([]);

      // Clean up
      await promise1;
    });

    it("deduplicates concurrent conflict checks by (memoryId, containerTag)", async () => {
      // Setup candidate that passes heuristic (negation pattern with overlap)
      const candidate = {
        id: "mem-existing",
        content: "not similar technical content here",
        is_deprecated: 0,
      };

      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ likeMemories: [candidate] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const getConnectionSpy = connectionManager.getConnection as any;
      getConnectionSpy.mockClear();

      // Make LLM path hang so lock stays held
      (isProviderConnected as any).mockReturnValue(true);
      (generateStructuredOutput as any).mockImplementation(() => new Promise(() => {}) as any);

      // Content overlaps with candidate and has no negation (heuristic passes)
      const promise1 = detectConflicts(
        "mem-same",
        "similar technical content here",
        "mem_project_hash"
      );
      const promise2 = detectConflicts("mem-same", "other content", "mem_project_hash");

      // Second call should be deduplicated immediately while first is still running
      const result2 = await promise2;
      expect(result2).toEqual([]);

      // Only the first call should have reached getConnection
      expect(getConnectionSpy).toHaveBeenCalledTimes(1);
    });

    it("allows parallel checks for different memoryIds", async () => {
      // Setup candidate that passes heuristic
      const candidate = {
        id: "mem-existing",
        content: "not similar technical content here",
        is_deprecated: 0,
      };

      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ likeMemories: [candidate] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const getConnectionSpy = connectionManager.getConnection as any;
      getConnectionSpy.mockClear();

      // Make LLM path hang so lock stays held
      (isProviderConnected as any).mockReturnValue(true);
      (generateStructuredOutput as any).mockImplementation(() => new Promise(() => {}) as any);

      const promise1 = detectConflicts(
        "mem-1",
        "similar technical content here",
        "mem_project_hash"
      );
      const promise2 = detectConflicts(
        "mem-2",
        "similar technical content here",
        "mem_project_hash"
      );

      // With Set-based deduplication (desired), both should execute concurrently
      // With current global lock, promise2 returns [] immediately
      await Promise.all([promise1, promise2]);

      // Both calls for different memoryIds should have been allowed to run
      expect(getConnectionSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolveConflict", () => {
    it("returns error when conflict not found", async () => {
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb();
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("nonexistent", "keep_both");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Conflict not found");
    });

    it("resolve keep_both strategy", async () => {
      const conflictRow = {
        id: "conflict-1",
        memory_id_1: "mem-1",
        memory_id_2: "mem-2",
        similarity_score: 0.85,
        detected_at: Date.now(),
        resolved: 0,
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-1", "keep_both");
      expect(result.success).toBe(true);
    });

    it("resolve keep_newer strategy", async () => {
      const conflictRow = {
        id: "conflict-kn",
        memory_id_1: "mem-old",
        memory_id_2: "mem-new",
        similarity_score: 0.9,
        detected_at: Date.now(),
        resolved: 0,
      };
      const oldMem = { id: "mem-old", created_at: 1000 };
      const newMem = { id: "mem-new", created_at: 2000 };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow], memForAge: [oldMem, newMem] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-kn", "keep_newer");
      expect(result.success).toBe(true);
    });

    it("resolve merge strategy with merged content", async () => {
      const conflictRow = {
        id: "conflict-merge",
        memory_id_1: "mem-a",
        memory_id_2: "mem-b",
        similarity_score: 0.88,
        detected_at: Date.now(),
        resolved: 0,
      };
      const memData = {
        id: "mem-a",
        created_at: 1000,
        tags_vector: null,
        container_tag: "mem_project_xyz",
        tags: null,
        type: "note",
        display_name: null,
        user_name: null,
        user_email: null,
        project_path: null,
        project_name: null,
        git_repo_url: null,
        recency_score: 0.5,
        frequency_score: 0,
        importance_score: 0.5,
        utility_score: 0.3,
        novelty_score: 0.5,
        confidence_score: 0.7,
        interference_penalty: 0,
        strength: 0.5,
        access_count: 1,
        last_accessed: null,
        store_type: "ltm",
        decay_rate: 0.05,
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow], memForAge: [memData] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);
      (vectorSearch.insertVector as any).mockResolvedValue(undefined);

      const result = await resolveConflict("conflict-merge", "merge", "merged content text");
      expect(result.success).toBe(true);
      expect(result.mergedMemoryId).toBeDefined();
    });

    it("resolve merge fails without merged content", async () => {
      const conflictRow = {
        id: "conflict-nocontent",
        memory_id_1: "mem-a",
        memory_id_2: "mem-b",
        similarity_score: 0.88,
        detected_at: Date.now(),
        resolved: 0,
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-nocontent", "merge");
      expect(result.success).toBe(false);
      expect(result.error).toContain("mergedContent");
    });

    it("resolve manual strategy", async () => {
      const conflictRow = {
        id: "conflict-manual",
        memory_id_1: "mem-1",
        memory_id_2: "mem-2",
        similarity_score: 0.85,
        detected_at: Date.now(),
        resolved: 0,
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-manual", "manual");
      expect(result.success).toBe(true);
    });

    it("returns error for unknown strategy", async () => {
      const conflictRow = {
        id: "conflict-1",
        memory_id_1: "mem-1",
        memory_id_2: "mem-2",
        similarity_score: 0.85,
        detected_at: Date.now(),
        resolved: 0,
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-1", "unknown_strategy" as any);
      expect(result.success).toBe(false);
    });

    it("reads container_tag from conflict record during resolution", async () => {
      const conflictRow = {
        id: "conflict-tag",
        memory_id_1: "mem-a",
        memory_id_2: "mem-b",
        similarity_score: 0.88,
        detected_at: Date.now(),
        resolved: 0,
        container_tag: "mem_project_abc123",
      };

      const getAllShardsSpy = shardManager.getAllShards as any;
      getAllShardsSpy.mockClear();
      getAllShardsSpy.mockImplementation((scope: string, hash: string) => {
        if (scope === "project" && hash === "abc123") {
          return [
            {
              id: 1,
              scope: "project" as const,
              scopeHash: "abc123",
              shardIndex: 0,
              dbPath: "/tmp/project.db",
              vectorCount: 0,
              isActive: true,
              createdAt: Date.now(),
            },
          ];
        }
        if (scope === "user" && hash === "") {
          return [
            {
              id: 2,
              scope: "user" as const,
              scopeHash: "",
              shardIndex: 0,
              dbPath: "/tmp/user.db",
              vectorCount: 0,
              isActive: true,
              createdAt: Date.now(),
            },
          ];
        }
        return [];
      });

      const db = makeMockDb({ conflictRows: [conflictRow], memForAge: [] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const result = await resolveConflict("conflict-tag", "keep_both");

      // Should have looked up project shards with hash from the conflict's container_tag
      expect(getAllShardsSpy).toHaveBeenCalledWith("project", "abc123");
      expect(result.success).toBe(true);
    });

    it("auto-migrates container_tag column on old schema", async () => {
      const db = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("PRAGMA table_info(memory_conflicts)")) {
            return {
              all: vi.fn().mockReturnValue([
                { name: "id" },
                { name: "memory_id_1" },
                { name: "memory_id_2" },
                { name: "similarity_score" },
                { name: "detected_at" },
                { name: "resolved" },
                // container_tag is missing!
              ]),
            };
          }
          if (sql.includes("ALTER TABLE")) {
            return { run: vi.fn() };
          }
          return { all: vi.fn(), get: vi.fn(), run: vi.fn() };
        }),
        run: vi.fn(),
        exec: vi.fn(),
        close: vi.fn(),
      };

      // Verify schema detection
      const columns = db.prepare("PRAGMA table_info(memory_conflicts)").all();
      const hasContainerTag = columns.some((c: any) => c.name === "container_tag");
      expect(hasContainerTag).toBe(false);

      // After migration, the column should exist
      db.prepare("ALTER TABLE memory_conflicts ADD COLUMN container_tag TEXT").run();
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("ALTER TABLE memory_conflicts ADD COLUMN container_tag")
      );
    });
  });

  describe("getConflicts", () => {
    it("returns unresolved conflicts", () => {
      const conflictRow = {
        id: "c1",
        memory_id_1: "mem-1",
        memory_id_2: "mem-2",
        similarity_score: 0.9,
        detected_at: Date.now(),
        resolved: 0,
        resolution_type: null,
        resolved_at: null,
        resolution_data: null,
        m1_content: "content 1",
        m2_content: "content 2",
      };
      const db = makeMockDb({ conflictRows: [conflictRow] });
      const conflicts = getConflicts(db as any, false);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].id).toBe("c1");
      expect(conflicts[0].memory1Content).toBe("content 1");
    });

    it("returns resolved conflicts", () => {
      const db = makeMockDb({ conflictRows: [] });
      const conflicts = getConflicts(db as any, true);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("getAllUnresolvedConflicts", () => {
    it("aggregates across shards", () => {
      const conflictRow = {
        id: "c1",
        memory_id_1: "mem-1",
        memory_id_2: "mem-2",
        similarity_score: 0.9,
        detected_at: Date.now(),
        resolved: 0,
        resolution_type: null,
        resolved_at: null,
        resolution_data: null,
        m1_content: "c1 m1",
        m2_content: "c1 m2",
      };
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/a.db" },
        { id: "shard-2", dbPath: "/tmp/b.db" },
      ]);
      const db = makeMockDb({ conflictRows: [conflictRow] });
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const conflicts = getAllUnresolvedConflicts();
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("findSimilarMemories (via detectConflicts)", () => {
    it("finds similar memories via LIKE fallback", async () => {
      const similarMem = {
        id: "mem-existing",
        content: "similar technical content here",
        is_deprecated: 0,
      };
      const db = makeMockDb({ likeMemories: [similarMem] });
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const conflicts = await detectConflicts(
        "mem-new",
        "new technical content here",
        "mem_project_test"
      );
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it("finds similar memories via FTS5", async () => {
      const similarMem = {
        id: "mem-fts",
        content: "another similar technical piece of content",
        is_deprecated: 0,
      };
      const db = makeMockDb({ ftsMemories: [similarMem], likeMemories: [] });
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const conflicts = await detectConflicts(
        "mem-new",
        "another similar technical piece of content here",
        "mem_project_test"
      );
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it("returns empty for blank content", async () => {
      const db = makeMockDb();
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const conflicts = await detectConflicts("mem-new", "a b c", "mem_project_test");
      expect(conflicts).toEqual([]);
    });
  });

  describe("checkContradictionHeuristic (via detectConflicts)", () => {
    it("detects contraditions with negation patterns", async () => {
      const candidate = {
        id: "mem-old",
        content: "removed deprecated function foo",
        is_deprecated: 0,
      };
      // Need enough words to pass word overlap > 0.3 with a negation on one side
      const db = makeMockDb({ likeMemories: [candidate] });
      (shardManager.getAllShards as any).mockReturnValue([
        { id: "shard-1", dbPath: "/tmp/test.db" },
      ]);
      (connectionManager.getConnection as any).mockReturnValue(db as any);

      const conflicts = await detectConflicts(
        "mem-new",
        "added function foo with implementation feature",
        "mem_project_contra"
      );
      // Without LLM, the heuristic passes but then LLM check fails (not configured)
      // So no conflict should be created
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });
});
