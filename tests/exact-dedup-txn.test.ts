import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: vi.fn(),
    decrementVectorCount: vi.fn(),
  },
}));

import { CONFIG } from "../src/config.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { DeduplicationService } from "../src/services/deduplication-service.js";

describe("exact-dedup transactions", () => {
  let dir: string;
  let dbPath: string;
  let previousEnabled: boolean | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exact-dedup-txn-"));
    dbPath = join(dir, "s.db");
    previousEnabled = CONFIG.deduplicationEnabled;
    (CONFIG as { deduplicationEnabled: boolean }).deduplicationEnabled = true;

    vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) =>
      scope === "user"
        ? [
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
          ]
        : []
    );

    const db = connectionManager.getConnection(dbPath);
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        container_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        vector BLOB,
        is_deprecated INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);
    const now = Date.now();
    for (const [id, created] of [
      ["d1", now],
      ["d2", now - 1],
      ["d3", now - 2],
    ] as const) {
      db.run(
        "INSERT INTO memories (id, content, container_tag, created_at) VALUES (?, ?, ?, ?)",
        id,
        "same",
        "tag",
        created
      );
    }
  });

  afterEach(() => {
    (CONFIG as { deduplicationEnabled: boolean }).deduplicationEnabled = previousEnabled as boolean;
    connectionManager.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rolls back all exact-dup deletes if a later delete throws", async () => {
    const db = connectionManager.getConnection(dbPath);
    const origRun = db.run.bind(db);
    let deletes = 0;
    db.run = (sql: string, ...params: unknown[]) => {
      if (/DELETE FROM memories/i.test(sql)) {
        deletes++;
        if (deletes === 2) throw new Error("boom");
      }
      return origRun(sql, ...params);
    };

    const result = await new DeduplicationService().detectAndRemoveDuplicates();
    expect(result.exactDuplicatesDeleted).toBe(0);

    const rows = db.prepare("SELECT id FROM memories ORDER BY id").all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
  });
});
