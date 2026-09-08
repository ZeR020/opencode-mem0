import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: vi.fn(),
    getWriteShard: vi.fn(),
    deleteShard: vi.fn(),
    incrementVectorCount: vi.fn(),
  },
}));

const embedMock = vi.hoisted(() => ({
  warmup: vi.fn(async () => undefined),
  clearCache: vi.fn(),
  embedWithTimeout: vi.fn(),
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: embedMock,
}));

import { CONFIG } from "../src/config.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { migrationService } from "../src/services/migration-service.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";

const NEW_DIMS = 8;
const OLD_DIMS = 4;

function vectorBlob(dims: number): Uint8Array {
  return new Uint8Array(new Float32Array(dims).fill(1).buffer);
}

describe("re-embed honesty", () => {
  let dir: string;
  let dbPath: string;
  let prevDims: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reembed-"));
    dbPath = join(dir, "s.db");
    prevDims = CONFIG.embeddingDimensions;
    CONFIG.embeddingDimensions = NEW_DIMS;
    embedMock.embedWithTimeout.mockReset();
    embedMock.warmup.mockClear();
    embedMock.clearCache.mockClear();

    vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) =>
      scope === "user"
        ? [
            {
              id: 1,
              scope: "user",
              scopeHash: "h",
              shardIndex: 0,
              dbPath,
              vectorCount: 2,
              isActive: true,
              createdAt: Date.now(),
            },
          ]
        : []
    );
    vi.mocked(shardManager.deleteShard).mockResolvedValue(undefined);
    vi.mocked(shardManager.getWriteShard).mockReturnValue({
      id: 1,
      scope: "user",
      scopeHash: "h",
      shardIndex: 0,
      dbPath,
      vectorCount: 2,
      isActive: true,
      createdAt: Date.now(),
    });

    const db = connectionManager.getConnection(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS shard_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
      "embedding_dimensions",
      String(OLD_DIMS),
    ]);
    db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
      "embedding_model",
      "old-model",
    ]);
    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        tags_vector BLOB,
        container_tag TEXT NOT NULL,
        tags TEXT,
        type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        display_name TEXT,
        user_name TEXT,
        user_email TEXT,
        project_path TEXT,
        project_name TEXT,
        git_repo_url TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_deprecated INTEGER DEFAULT 0
      )
    `);
    const now = Date.now();
    db.run(
      `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      "m1",
      "one",
      vectorBlob(OLD_DIMS),
      "mem_user_h",
      now - 2,
      now
    );
    db.run(
      `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      "m2",
      "two",
      vectorBlob(OLD_DIMS),
      "mem_user_h",
      now - 1,
      now
    );
  });

  afterEach(() => {
    CONFIG.embeddingDimensions = prevDims;
    connectionManager.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("updates vectors in place and reports success", async () => {
    embedMock.embedWithTimeout.mockResolvedValue(new Float32Array(NEW_DIMS).fill(0.5));

    const markDirty = vi.spyOn(vectorSearch, "markShardDirty");
    const result = await migrationService.migrateToNewModel("re-embed");
    expect(result.success).toBe(true);
    expect(result.reEmbeddedMemories).toBe(2);
    expect(shardManager.deleteShard).not.toHaveBeenCalled();
    expect(shardManager.getWriteShard).not.toHaveBeenCalled();
    // Live index must be invalidated — searches after a "successful"
    // migration may not serve stale old-dimension vectors until restart.
    expect(markDirty).toHaveBeenCalledWith(expect.objectContaining({ dbPath }));

    const db = connectionManager.getConnection(dbPath);
    const rows = db.prepare("SELECT id, vector FROM memories ORDER BY id").all() as Array<{
      id: string;
      vector: Uint8Array;
    }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(new Uint8Array(row.vector).byteLength).toBe(NEW_DIMS * 4);
    }
    const dims = db
      .prepare("SELECT value FROM shard_metadata WHERE key = 'embedding_dimensions'")
      .get() as { value: string };
    expect(dims.value).toBe(String(NEW_DIMS));
  });

  it("reports success false when a row fails to embed", async () => {
    embedMock.embedWithTimeout
      .mockRejectedValueOnce(new Error("embed failed"))
      .mockResolvedValue(new Float32Array(NEW_DIMS).fill(0.5));

    const result = await migrationService.migrateToNewModel("re-embed");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
