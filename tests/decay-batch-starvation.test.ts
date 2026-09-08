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
import { applyDecay } from "../src/services/memory-lifecycle.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

describe("decay batch starvation", () => {
  let testDir: string;
  let dbPath: string;
  let previousBatchSize: number | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "decay-starvation-"));
    dbPath = join(testDir, "shard.db");
    previousBatchSize = CONFIG.memoryLifecycle?.decayBatchSize;
    if (CONFIG.memoryLifecycle) CONFIG.memoryLifecycle.decayBatchSize = 2;

    vi.mocked(getAllShards).mockReturnValue([
      {
        id: 1,
        scope: "user",
        scopeHash: "h",
        shardIndex: 0,
        dbPath,
        vectorCount: 3,
        isActive: true,
        createdAt: Date.now(),
      },
    ]);

    const db = connectionManager.getConnection(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        strength REAL DEFAULT 0.9,
        decay_rate REAL DEFAULT 0.05,
        created_at INTEGER NOT NULL,
        last_decay_at INTEGER,
        store_type TEXT DEFAULT 'stm',
        access_count INTEGER DEFAULT 0,
        type TEXT,
        is_pinned INTEGER DEFAULT 0,
        recency_score REAL DEFAULT 0.5
      )
    `);
    const createdAt = Date.now() - TWO_DAYS_MS;
    for (const id of ["early-1", "early-2", "late-3"]) {
      db.run(
        `INSERT INTO memories (id, content, strength, created_at, last_decay_at, store_type, is_pinned)
         VALUES (?, 'x', 0.9, ?, NULL, 'stm', 0)`,
        id,
        createdAt
      );
    }
  });

  afterEach(() => {
    if (CONFIG.memoryLifecycle) CONFIG.memoryLifecycle.decayBatchSize = previousBatchSize;
    connectionManager.closeAll();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("second cycle decays rows past the batch cap instead of reprocessing the first batch", async () => {
    await applyDecay();

    const db = connectionManager.getConnection(dbPath);
    const afterFirst = db
      .prepare("SELECT id, last_decay_at, strength FROM memories ORDER BY id")
      .all() as Array<{ id: string; last_decay_at: number | null; strength: number }>;
    const firstTouched = afterFirst.filter((r) => r.last_decay_at != null).map((r) => r.id);
    expect(firstTouched).toHaveLength(2);
    expect(afterFirst.find((r) => r.id === "late-3")?.last_decay_at).toBeNull();

    await applyDecay();

    const afterSecond = db
      .prepare("SELECT id, last_decay_at, strength FROM memories WHERE id = ?")
      .get("late-3") as { id: string; last_decay_at: number | null; strength: number };
    expect(afterSecond.last_decay_at).not.toBeNull();
    expect(afterSecond.strength).toBeLessThan(0.9);
  });
});
