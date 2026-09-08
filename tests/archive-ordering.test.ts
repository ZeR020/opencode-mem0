import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  getAllShards: vi.fn(),
  shardManager: { decrementVectorCount: vi.fn() },
  extractScopeFromContainerTag: vi.fn(),
}));

import { CONFIG } from "../src/config.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { getAllShards } from "../src/services/sqlite/shard-manager.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";
import { applyDecay } from "../src/services/memory-lifecycle.js";

const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;

describe("archive ordering", () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "archive-order-"));
    dbPath = join(testDir, "shard.db");
    vi.mocked(getAllShards).mockReturnValue([
      {
        id: 1,
        scope: "user",
        scopeHash: "h",
        shardIndex: 0,
        dbPath,
        vectorCount: 1,
        isActive: true,
        createdAt: Date.now(),
      },
    ]);

    const db = connectionManager.getConnection(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT,
        type TEXT,
        created_at INTEGER NOT NULL,
        last_decay_at INTEGER,
        strength REAL DEFAULT 0.1,
        decay_rate REAL DEFAULT 0.05,
        store_type TEXT DEFAULT 'stm',
        access_count INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        recency_score REAL DEFAULT 0.5,
        container_tag TEXT,
        metadata TEXT
      )
    `);
    db.run(
      `INSERT INTO memories (id, content, strength, created_at, last_decay_at, store_type, is_pinned)
       VALUES ('arch-1', 'x', 0.1, ?, NULL, 'stm', 0)`,
      Date.now() - THIRTY_ONE_DAYS
    );
  });

  afterEach(() => {
    connectionManager.closeAll();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("archives in sqlite then deletes the vector after COMMIT", async () => {
    const previous = CONFIG.memoryLifecycle?.archiveThreshold;
    if (CONFIG.memoryLifecycle) CONFIG.memoryLifecycle.archiveThreshold = 0.2;

    const order: string[] = [];
    const db = connectionManager.getConnection(dbPath);
    const origRun = db.run.bind(db);
    db.run = (sql: string, ...params: unknown[]) => {
      if (sql.trim().toUpperCase().startsWith("COMMIT")) order.push("COMMIT");
      return origRun(sql, ...params);
    };
    vi.spyOn(vectorSearch, "deleteVector").mockImplementation(async () => {
      order.push("deleteVector");
    });

    try {
      await applyDecay();
    } finally {
      if (CONFIG.memoryLifecycle) CONFIG.memoryLifecycle.archiveThreshold = previous;
    }

    const archived = db.prepare("SELECT id FROM memories_archive WHERE id = ?").get("arch-1") as
      | { id: string }
      | undefined;
    const remaining = db.prepare("SELECT id FROM memories WHERE id = ?").get("arch-1");
    expect(archived?.id).toBe("arch-1");
    expect(remaining).toBeUndefined();
    expect(order).toEqual(["COMMIT", "deleteVector"]);
  });
});
