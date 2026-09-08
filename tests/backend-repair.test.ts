import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VectorBackend } from "../src/services/vector-backends/types.js";
import type { ShardInfo } from "../src/services/sqlite/types.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { VectorSearch } from "../src/services/sqlite/vector-search.js";
import type { MemoryRecord } from "../src/services/sqlite/types.js";

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: { getAllShards: vi.fn(), getWriteShard: vi.fn(), deleteShard: vi.fn() },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
  warn: vi.fn(),
}));

const shard: ShardInfo = {
  id: 7,
  scope: "user",
  scopeHash: "h",
  shardIndex: 0,
  dbPath: "/tmp/repair-shard.db",
  vectorCount: 0,
  isActive: true,
  createdAt: Date.now(),
};

function record(id: string, first = 1): MemoryRecord {
  return {
    id,
    content: `content ${id}`,
    vector: new Float32Array([first, 2, 3, 4]),
    tagsVector: new Float32Array([9, 9, 9, 9]),
    containerTag: "mem_user_h",
    tags: "alpha",
    type: "semantic",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: "{}",
    displayName: null,
    userName: null,
    userEmail: null,
    projectPath: null,
    projectName: null,
    gitRepoUrl: null,
    isPinned: 0,
    isDeprecated: 0,
    recency: 0.5,
    frequency: 0.5,
    importance: 0.5,
    utility: 0.5,
    novelty: 0.5,
    confidence: 0.5,
    interferencePenalty: 0,
    strength: 0.5,
    accessCount: 0,
    lastAccessed: null,
    storeType: "stm",
    decayRate: null,
  } as unknown as MemoryRecord;
}

function makeBackend(): VectorBackend & {
  insertCalls: number;
  rebuildCalls: Array<{ kind: string; force: boolean | undefined }>;
} {
  const api = {
    insertCalls: 0,
    rebuildCalls: [] as Array<{ kind: string; force: boolean | undefined }>,
    async insert() {
      api.insertCalls++;
      throw new Error("backend index write failed");
    },
    async insertBatch() {},
    async delete() {},
    async search() {
      return [];
    },
    async rebuildFromShard(args: { kind: string; force?: boolean }) {
      api.rebuildCalls.push({ kind: args.kind, force: args.force });
    },
    deleteShardIndexes() {},
    getBackendName() {
      return "mock";
    },
  };
  return api as never;
}

describe("post-commit backend failure repair (Devin/Codex findings on #63)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "backend-repair-"));
    dbPath = join(dir, "shard.db");
    shard.dbPath = dbPath;
    const db = connectionManager.getConnection(dbPath);
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, vector BLOB NOT NULL, tags_vector BLOB,
        container_tag TEXT NOT NULL, tags TEXT, type TEXT, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, metadata TEXT, display_name TEXT, user_name TEXT,
        user_email TEXT, project_path TEXT, project_name TEXT, git_repo_url TEXT,
        is_pinned INTEGER DEFAULT 0, is_deprecated INTEGER DEFAULT 0,
        recency_score REAL DEFAULT 0.5, frequency_score REAL DEFAULT 0.5,
        importance_score REAL DEFAULT 0.5, utility_score REAL DEFAULT 0.5,
        novelty_score REAL DEFAULT 0.5, confidence_score REAL DEFAULT 0.5,
        interference_penalty REAL DEFAULT 0, strength REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0, last_accessed INTEGER, store_type TEXT, decay_rate REAL, last_decay_at INTEGER
      )
    `);
  });
  afterEach(() => {
    connectionManager.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("insertVector with failing backend resolves, persists, and forces a rebuild on next search", async () => {
    const backend = makeBackend();
    const vectorSearch = new VectorSearch(backend);
    const db = connectionManager.getConnection(dbPath);

    await expect(vectorSearch.insertVector(db, record("a"), shard)).resolves.toBeUndefined();
    expect(backend.insertCalls).toBeGreaterThan(0);

    const rows = db.prepare("SELECT id FROM memories").all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["a"]);

    // First search: dirty from the failure → force rebuild.
    await vectorSearch.searchInShard(shard, new Float32Array([1, 2, 3, 4]), "mem_user_h", 10);
    expect(backend.rebuildCalls.some((c) => c.force === true)).toBe(true);
  });

  it("markShardDirty forces a rebuild even when the index was served before", async () => {
    const backend = makeBackend();
    const vectorSearch = new VectorSearch(backend);
    const db = connectionManager.getConnection(dbPath);

    // A search on a clean shard bootstraps without force.
    await vectorSearch.searchInShard(shard, new Float32Array([1, 2, 3, 4]), "mem_user_h", 10);
    expect(backend.rebuildCalls).toHaveLength(2);
    expect(backend.rebuildCalls.every((c) => c.force !== true)).toBe(true);

    // Migration marks the shard dirty — next search must FORCE.
    vectorSearch.markShardDirty(shard);
    await vectorSearch.searchInShard(shard, new Float32Array([1, 2, 3, 4]), "mem_user_h", 10);
    expect(backend.rebuildCalls.filter((c) => c.force === true).length).toBe(2);
  });
});
