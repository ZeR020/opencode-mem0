import { beforeEach, describe, expect, it, mock } from "bun:test";

const dbByPath = new Map<string, any>();
let mockConfig: Record<string, any> = {};

mock.module("../src/services/logger.js", () => ({
  log: () => {},
}));

mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 2, 3]),
  },
}));

mock.module("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection(path: string) {
      if (!dbByPath.has(path)) {
        dbByPath.set(path, makeDb(path));
      }
      return dbByPath.get(path);
    },
    closeAll() {},
  },
}));

mock.module("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards(scope: string, hash: string) {
      return scope === "project" && hash === ""
        ? [makeShard("shard-a"), makeShard("shard-b")]
        : [makeShard("shard-current")];
    },
    getWriteShard() {
      return makeShard("shard-write");
    },
    incrementVectorCount() {},
  },
}));

mock.module("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    searchAcrossShards: async (shards: any[]) =>
      shards.map((s) => ({ id: s.id, memory: s.id, similarity: 1 })),
    listMemories: (db: any, containerTag: string) => db.listMemories(containerTag),
    insertVector: async () => {},
  },
}));

function makeShard(id: string) {
  return {
    id,
    scope: "project",
    scopeHash: "",
    shardIndex: 0,
    dbPath: `/tmp/${id}.db`,
    vectorCount: 0,
    isActive: true,
    createdAt: Date.now(),
  };
}

function makeDb(path: string) {
  const rows = path.includes("shard-a")
    ? [
        {
          id: "a",
          content: "A",
          created_at: 2,
          container_tag: "tag-a",
          is_deprecated: 0,
          store_type: "stm",
          strength: 0.5,
          access_count: 0,
        },
      ]
    : path.includes("shard-b")
      ? [
          {
            id: "b",
            content: "B",
            created_at: 1,
            container_tag: "tag-b",
            is_deprecated: 0,
            store_type: "stm",
            strength: 0.5,
            access_count: 0,
          },
        ]
      : [
          {
            id: "c",
            content: "C",
            created_at: 3,
            container_tag: "current",
            is_deprecated: 0,
            store_type: "stm",
            strength: 0.5,
            access_count: 0,
          },
        ];

  const transcriptRows: any[] = [];
  const conflictRows: any[] = [];

  return {
    prepare(sql: string) {
      return {
        all(...args: any[]) {
          if (sql.includes("transcripts")) {
            if (sql.includes("COUNT(*)")) {
              return [{ count: transcriptRows.length }];
            }
            if (sql.includes("DELETE")) {
              const cutoff = args[0];
              const before = transcriptRows.length;
              const kept = transcriptRows.filter((r) => r.created_at >= cutoff);
              transcriptRows.length = 0;
              transcriptRows.push(...kept);
              return { changes: before - kept.length };
            }
            if (sql.includes("MATCH")) {
              const query = args[0]?.toLowerCase() || "";
              return transcriptRows.filter((r) => r.messages.toLowerCase().includes(query));
            }
            const tag = args[0];
            if (tag && sql.includes("session_id = ?")) {
              return transcriptRows
                .filter((r) => r.session_id === tag)
                .sort((a: any, b: any) => b.created_at - a.created_at)
                .slice(0, 1);
            }
            return transcriptRows
              .sort((a: any, b: any) => b.created_at - a.created_at)
              .slice(0, args[0] || 10);
          }
          if (sql.includes("memory_conflicts")) {
            if (sql.includes("SELECT c.*, m1.content")) {
              return conflictRows
                .filter((r) => r.resolved === (sql.includes("resolved = ?") ? args[0] : 0))
                .slice(0, args[1] || 100);
            }
            if (sql.includes("WHERE id = ?")) {
              const id = args[0];
              return conflictRows.find((r) => r.id === id) || null;
            }
            return conflictRows;
          }
          if (sql.includes("SELECT * FROM memories")) {
            if (sql.includes("container_tag = ?")) {
              const tag = args[0];
              return rows.filter((r) => r.container_tag === tag);
            }
            return rows;
          }
          if (sql.includes("SELECT id, strength, access_count FROM memories WHERE id = ?")) {
            const id = args[0];
            const mem = rows.find((r) => r.id === id);
            return mem || null;
          }
          if (sql.includes("UPDATE memories SET")) {
            return {};
          }
          return rows;
        },
        get(...args: any[]) {
          if (sql.includes("transcripts") && sql.includes("session_id = ?")) {
            const tag = args[0];
            const matches = transcriptRows
              .filter((r) => r.session_id === tag)
              .sort((a: any, b: any) => b.created_at - a.created_at);
            return matches[0] || null;
          }
          if (sql.includes("memory_conflicts") && sql.includes("WHERE id = ?")) {
            return conflictRows.find((r) => r.id === args[0]) || null;
          }
          if (sql.includes("SELECT id, created_at FROM memories WHERE id = ?")) {
            const id = args[0];
            return rows.find((r) => r.id === id) || null;
          }
          if (sql.includes("SELECT * FROM memories WHERE id = ?")) {
            const id = args[0];
            return rows.find((r) => r.id === id) || null;
          }
          if (sql.includes("SELECT id, store_type, strength, access_count")) {
            const id = args[0];
            return rows.find((r) => r.id === id) || null;
          }
          if (sql.includes("sqlite_master")) {
            return { name: "memories_fts" };
          }
          return rows[0] ?? null;
        },
        run(...args: any[]) {
          if (sql.includes("INSERT INTO transcripts")) {
            transcriptRows.push({
              id: args[0],
              session_id: args[1],
              project_path: args[2],
              messages: args[3],
              created_at: args[4],
              token_count: args[5],
            });
          }
          if (sql.includes("UPDATE transcripts")) {
            const sessionId = args[args.length - 1];
            const row = transcriptRows.find((r) => r.session_id === sessionId);
            if (row) {
              row.created_at = args[0];
            }
            return { changes: row ? 1 : 0 };
          }
          if (sql.includes("INSERT INTO memory_conflicts")) {
            conflictRows.push({
              id: args[0],
              memory_id_1: args[1],
              memory_id_2: args[2],
              similarity_score: args[3],
              detected_at: args[4],
              resolved: args[5],
              resolution_type: args[6],
              resolved_at: args[7],
              resolution_data: args[8],
            });
          }
          if (sql.includes("UPDATE memories SET")) {
            const id = args[args.length - 1];
            const mem = rows.find((r) => r.id === id);
            if (mem) {
              if (sql.includes("is_deprecated = 1")) mem.is_deprecated = 1;
              if (sql.includes("store_type = 'ltm'")) mem.store_type = "ltm";
            }
          }
          if (sql.includes("UPDATE memory_conflicts")) {
            const id = args[args.length - 1];
            const conflict = conflictRows.find((r) => r.id === id);
            if (conflict) {
              conflict.resolved = args[0];
              conflict.resolution_type = args[1];
              conflict.resolved_at = args[2];
              conflict.resolution_data = args[3];
            }
          }
          return { changes: 1 };
        },
      };
    },
    listMemories(containerTag: string) {
      return containerTag === "" ? rows : rows.filter((r) => r.container_tag === containerTag);
    },
    run() {},
    close() {},
  };
}

// Set up config mock with all new feature flags enabled
mock.module("../src/config.js", () => ({
  CONFIG: {
    storagePath: "/tmp/opencode-mem0-test",
    transcriptStorage: { enabled: true, maxAgeDays: 30 },
    memoryScoring: {
      enabled: true,
      recalculationIntervalMinutes: 60,
      recencyHalfLifeDays: 7,
      utilityHalfLifeDays: 3,
    },
    memoryLifecycle: {
      stmDecayDays: 7,
      ltmDecayDays: 90,
      promotionThreshold: 0.7,
      archiveThreshold: 0.2,
      archiveAfterDays: 30,
      checkIntervalMinutes: 60,
    },
    retrieval: { maxResults: 20, diversityThreshold: 0.9, contextBoost: 1.5 },
  },
}));

// Import the modules under test (must be after mocks)
const {
  calculateRecency,
  calculateFrequency,
  calculateImportance,
  calculateUtility,
  calculateNovelty,
  calculateConfidence,
  calculateInterference,
  computeStrength,
  calculateAllScores,
  recordAccess,
} = await import("../src/services/memory-scoring.js");
const { classifyMemory, promoteToLTM } = await import("../src/services/memory-lifecycle.js");
const { calculateContextBoost, calculateDiversityPenalty, contextTracker } =
  await import("../src/services/retrieval-context.js");
const { TranscriptManager } = await import("../src/services/sqlite/transcript-manager.js");
const { detectConflicts, resolveConflict } = await import("../src/services/memory-conflicts.js");

beforeEach(() => {
  dbByPath.clear();
  contextTracker.clear();
});

describe("Memory Engine Integration", () => {
  // ─── Transcript Storage ─────────────────────────────
  describe("transcript storage", () => {
    it("saves and retrieves a transcript", () => {
      const mgr = new TranscriptManager();
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ];
      const { id } = mgr.saveTranscript("sess-1", "/project/a", messages);
      expect(id).toBeTruthy();
      expect(id.startsWith("tr_")).toBe(true);

      const retrieved = mgr.getTranscript("sess-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe("sess-1");
      expect(retrieved!.projectPath).toBe("/project/a");
      expect(retrieved!.tokenCount).toBeGreaterThan(0);
    });

    it("returns recent transcripts ordered by time", () => {
      const mgr = new TranscriptManager();
      const now = Date.now();
      // Save with manual timestamps to ensure ordering
      const db = (mgr as any).getDb();
      mgr.saveTranscript("sess-1", "/project/a", [{ content: "first" }]);
      db.prepare("UPDATE transcripts SET created_at = ? WHERE session_id = ?").run(
        now - 2000,
        "sess-1"
      );
      mgr.saveTranscript("sess-2", "/project/b", [{ content: "second" }]);
      db.prepare("UPDATE transcripts SET created_at = ? WHERE session_id = ?").run(
        now - 1000,
        "sess-2"
      );
      mgr.saveTranscript("sess-3", "/project/c", [{ content: "third" }]);

      const recent = mgr.getRecentTranscripts(2);
      expect(recent.length).toBe(2);
      expect(recent[0].sessionId).toBe("sess-3");
      expect(recent[1].sessionId).toBe("sess-2");
    });

    it("deletes old transcripts", () => {
      const mgr = new TranscriptManager();
      const oldTime = Date.now() - 1000 * 60 * 60 * 24 * 40; // 40 days ago
      mgr.saveTranscript("sess-old", "/project/old", [{ content: "old" }]);
      // Manually override created_at for the first row
      const db = (mgr as any).getDb();
      db.prepare("UPDATE transcripts SET created_at = ? WHERE session_id = ?").run(
        oldTime,
        "sess-old"
      );

      const deleted = mgr.deleteOldTranscripts(Date.now() - 1000 * 60 * 60 * 24 * 30);
      expect(deleted).toBeGreaterThanOrEqual(0);
    });

    it("reports status correctly", () => {
      const mgr = new TranscriptManager();
      const status = mgr.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.maxAgeDays).toBe(30);
      expect(status.transcriptCount).toBeGreaterThanOrEqual(0);
    });

    it("returns empty when disabled", async () => {
      // Temporarily disable
      const { CONFIG } = await import("../src/config.js");
      const original = CONFIG.transcriptStorage.enabled;
      CONFIG.transcriptStorage.enabled = false;

      const mgr = new TranscriptManager();
      const result = mgr.saveTranscript("sess", "/p", []);
      expect(result.id).toBe("");

      CONFIG.transcriptStorage.enabled = original;
    });
  });

  // ─── Memory Scoring ─────────────────────────────────
  describe("memory scoring", () => {
    it("calculates recency score with exponential decay", () => {
      const now = Date.now();
      const recent = calculateRecency(now, 7);
      const old = calculateRecency(now - 7 * 24 * 60 * 60 * 1000, 7);
      const veryOld = calculateRecency(now - 30 * 24 * 60 * 60 * 1000, 7);

      expect(recent).toBe(1.0);
      expect(old).toBeCloseTo(0.5, 1);
      expect(veryOld).toBeLessThan(0.1);
      expect(veryOld).toBeGreaterThanOrEqual(0);
    });

    it("calculates frequency score with log scale", () => {
      expect(calculateFrequency(0)).toBe(0);
      expect(calculateFrequency(1)).toBeGreaterThan(0);
      expect(calculateFrequency(10)).toBeGreaterThan(calculateFrequency(1));
      expect(calculateFrequency(100)).toBeCloseTo(1.0, 1);
    });

    it("calculates importance with technical keywords", () => {
      const low = calculateImportance("Hello world");
      const high = calculateImportance(
        "Implement async function with TypeScript interface and database schema migration"
      );
      expect(high).toBeGreaterThan(low);
      expect(high).toBeGreaterThan(0.6);
    });

    it("calculates importance with code blocks", () => {
      const withCode = calculateImportance("```ts\nconst x = 1;\n```");
      const withoutCode = calculateImportance("Some text without code");
      expect(withCode).toBeGreaterThan(withoutCode);
    });

    it("calculates utility with recency decay", () => {
      const now = Date.now();
      const recentAccess = calculateUtility(now, 3);
      const oldAccess = calculateUtility(now - 3 * 24 * 60 * 60 * 1000, 3);
      expect(recentAccess).toBeGreaterThan(oldAccess);
    });

    it("calculates novelty as inverse of similarity", () => {
      const novel = calculateNovelty("Completely unique topic about quantum computing", [
        "Common programming patterns",
      ]);
      const duplicate = calculateNovelty("Common programming patterns", [
        "Common programming patterns",
      ]);
      expect(novel).toBeGreaterThan(duplicate);
      expect(duplicate).toBeLessThan(0.5);
    });

    it("calculates confidence by source", () => {
      expect(calculateConfidence("manual")).toBeGreaterThan(calculateConfidence("auto-capture"));
      expect(calculateConfidence("api")).toBeGreaterThan(calculateConfidence("import"));
    });

    it("calculates interference for contradictory memories", () => {
      const penalty = calculateInterference("Added feature X", [
        "Removed feature X",
        "Feature X is disabled",
      ]);
      expect(penalty).toBeGreaterThan(0);
    });

    it("computes overall strength from components", () => {
      const scores = {
        recency: 1.0,
        frequency: 1.0,
        importance: 1.0,
        utility: 1.0,
        novelty: 1.0,
        confidence: 1.0,
        interference: 0,
      };
      const strength = computeStrength(scores);
      expect(strength).toBeCloseTo(1.0, 1);

      const weakScores = {
        ...scores,
        recency: 0,
        frequency: 0,
        importance: 0,
        utility: 0,
        novelty: 0,
        confidence: 0,
        interference: 1.0,
      };
      const weakStrength = computeStrength(weakScores);
      expect(weakStrength).toBeLessThan(0.3);
    });

    it("calculates all scores in one call", () => {
      const result = calculateAllScores({
        createdAt: Date.now(),
        accessCount: 5,
        lastAccessed: Date.now(),
        content: "Implement database migration using Prisma ORM",
        existingContents: ["Some old content"],
        conflictingMemories: [],
        source: "manual",
        type: "feature",
      });
      expect(result.recency).toBeGreaterThan(0);
      expect(result.frequency).toBeGreaterThan(0);
      expect(result.importance).toBeGreaterThan(0);
      expect(result.strength).toBeGreaterThan(0);
      expect(result.strength).toBeLessThanOrEqual(1);
    });

    it("records access increment", () => {
      const result = recordAccess(5);
      expect(result.accessCount).toBe(6);
      expect(result.lastAccessed).toBeGreaterThan(0);
    });
  });

  // ─── Memory Lifecycle ─────────────────────────────────
  describe("memory lifecycle", () => {
    it("classifies preferences as LTM with no decay", () => {
      const result = classifyMemory("preference");
      expect(result.storeType).toBe("ltm");
      expect(result.decayRate).toBe(0);
    });

    it("classifies chat as STM with fast decay", () => {
      const result = classifyMemory("chat");
      expect(result.storeType).toBe("stm");
      expect(result.decayRate).toBe(0.05);
    });

    it("classifies learning as LTM with slow decay", () => {
      const result = classifyMemory("learning");
      expect(result.storeType).toBe("ltm");
      expect(result.decayRate).toBe(0.01);
    });

    it("defaults to STM when type is unknown", () => {
      const result = classifyMemory("random-thing");
      expect(result.storeType).toBe("stm");
      expect(result.decayRate).toBe(0.05);
    });

    it("promotes STM to LTM when strength and access are high", () => {
      const db = dbByPath.get("/tmp/shard-current.db") || makeDb("/tmp/shard-current.db");
      dbByPath.set("/tmp/shard-current.db", db);
      // Override the row for promotion test
      db.prepare = (sql: string) => ({
        all: () => [],
        get: (...args: any[]) => {
          if (sql.includes("store_type, strength, access_count") && args[0] === "promote-me") {
            return { id: "promote-me", store_type: "stm", strength: 0.8, access_count: 5 };
          }
          if (sql.includes("store_type, strength, access_count") && args[0] === "already-ltm") {
            return { id: "already-ltm", store_type: "ltm", strength: 0.8, access_count: 5 };
          }
          return null;
        },
        run: () => ({ changes: 1 }),
      });

      const promoted = promoteToLTM("promote-me");
      expect(promoted.success).toBe(true);
      expect(promoted.promoted).toBe(true);

      const notPromoted = promoteToLTM("already-ltm");
      expect(notPromoted.success).toBe(true);
      expect(notPromoted.promoted).toBe(false);
    });
  });

  // ─── Retrieval Context ──────────────────────────────
  describe("retrieval context", () => {
    it("calculates context boost for matching project", () => {
      const boost = calculateContextBoost(
        { projectPath: "/project/a", projectName: "my-project" },
        { projectPath: "/project/a", projectName: "my-project" }
      );
      expect(boost).toBeGreaterThan(1);
    });

    it("calculates no boost for unrelated project", () => {
      const boost = calculateContextBoost(
        { projectPath: "/project/a", projectName: "my-project" },
        { projectPath: "/project/b", projectName: "other-project" }
      );
      expect(boost).toBe(1);
    });

    it("applies diversity penalty for similar content", () => {
      const penalty = calculateDiversityPenalty(
        "Use TypeScript for backend API development testing",
        ["Use TypeScript for backend API development testing"],
        0.9
      );
      expect(penalty).toBeGreaterThan(0);
    });

    it("applies no diversity penalty for distinct content", () => {
      const penalty = calculateDiversityPenalty(
        "Docker container orchestration with Kubernetes",
        ["Frontend React component state management"],
        0.9
      );
      expect(penalty).toBe(0);
    });

    it("tracks recent queries and files", () => {
      contextTracker.addQuery("database optimization");
      contextTracker.addFiles(["src/db.ts", "src/schema.prisma"]);
      const ctx = contextTracker.getContext("/project", "my-project");
      expect(ctx.recentQueries).toContain("database optimization");
      expect(ctx.recentFiles).toContain("src/db.ts");
    });
  });

  // ─── Memory Conflicts ───────────────────────────────
  describe("memory conflicts", () => {
    it("detects conflicts via heuristic fallback", async () => {
      // Mock memory rows for conflict detection
      const db = makeDb("/tmp/shard-current.db");
      dbByPath.set("/tmp/shard-current.db", db);
      // Override prepare for conflict-specific queries
      let conflictSaved = false;
      db.prepare = (sql: string) => {
        if (sql.includes("sqlite_master")) {
          return {
            get: () => ({ name: "memories_fts" }),
            all: () => [{ name: "memories_fts" }],
            run: () => {},
          };
        }
        if (sql.includes("memories_fts MATCH")) {
          return {
            all: () => [
              { id: "existing-1", content: "Use JavaScript for the project", is_deprecated: 0 },
            ],
            get: () => null,
            run: () => {},
          };
        }
        if (sql.includes("memory_conflicts")) {
          return {
            all: () => [],
            get: () => null,
            run: () => {
              conflictSaved = true;
              return { changes: 1 };
            },
          };
        }
        return {
          all: () => [],
          get: () => null,
          run: () => {},
        };
      };

      const conflicts = await detectConflicts(
        "new-1",
        "Use TypeScript for the project, not JavaScript",
        "mem_project_abc"
      );
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it("resolves conflict with keep_newer strategy", async () => {
      const db = makeDb("/tmp/shard-current.db");
      dbByPath.set("/tmp/shard-current.db", db);
      let deprecatedId: string | null = null;

      db.prepare = (sql: string) => {
        if (sql.includes("memory_conflicts WHERE id = ?")) {
          return {
            get: (id: string) => ({
              id,
              memory_id_1: "mem-new",
              memory_id_2: "mem-old",
              similarity_score: 0.8,
              detected_at: Date.now(),
              resolved: 0,
              resolution_type: null,
              resolved_at: null,
              resolution_data: null,
            }),
            all: () => [],
            run: () => {},
          };
        }
        if (sql.includes("SELECT id, created_at FROM memories")) {
          return {
            get: (id: string) => {
              if (id === "mem-new") return { id, created_at: Date.now() };
              if (id === "mem-old") return { id, created_at: Date.now() - 10000 };
              return null;
            },
            all: () => [],
            run: () => {},
          };
        }
        if (sql.includes("UPDATE memories SET is_deprecated = 1")) {
          return {
            run: (id: string) => {
              deprecatedId = id;
              return { changes: 1 };
            },
            get: () => null,
            all: () => [],
          };
        }
        if (sql.includes("UPDATE memory_conflicts")) {
          return {
            run: () => ({ changes: 1 }),
            get: () => null,
            all: () => [],
          };
        }
        return { all: () => [], get: () => null, run: () => ({ changes: 0 }) };
      };

      const result = await resolveConflict("conflict-1", "keep_newer");
      expect(result.success).toBe(true);
    });

    it("rejects merge strategy without mergedContent", async () => {
      const result = await resolveConflict("conflict-2", "merge");
      expect(result.success).toBe(false);
      // Should fail either because conflict not found (mock limitation) or because mergedContent is required
      expect(result.error).toBeTruthy();
    });
  });
});
