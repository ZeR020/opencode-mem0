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

import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";

function blob(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

describe("updateVector preserves tags_vector when not provided (Devin finding on #63)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tags-preserve-"));
    dbPath = join(dir, "s.db");
    const db = connectionManager.getConnection(dbPath);
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
      `INSERT INTO memories (id, content, vector, tags_vector, container_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "m1",
      "one",
      blob([1, 2, 3, 4]),
      blob([9, 9, 9, 9]),
      "mem_user_h",
      now,
      now
    );
  });

  afterEach(() => {
    connectionManager.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("content-only re-embed leaves tags_vector intact (direct)", async () => {
    const db = connectionManager.getConnection(dbPath);
    await vectorSearch.updateVector(db, "m1", new Float32Array([5, 6, 7, 8]));

    const row = db.prepare("SELECT tags_vector FROM memories WHERE id = 'm1'").get() as {
      tags_vector: Uint8Array;
    };
    expect(row.tags_vector).not.toBeNull();
    expect(
      Array.from(new Float32Array(row.tags_vector.buffer, row.tags_vector.byteOffset, 4))
    ).toEqual([9, 9, 9, 9]);

    const vecRow = db.prepare("SELECT vector FROM memories WHERE id = 'm1'").get() as {
      vector: Uint8Array;
    };
    expect(Array.from(new Float32Array(vecRow.vector.buffer, vecRow.vector.byteOffset, 4))).toEqual(
      [5, 6, 7, 8]
    );
  });

  it("explicit tagsVector still overwrites", async () => {
    const db = connectionManager.getConnection(dbPath);
    await vectorSearch.updateVector(
      db,
      "m1",
      new Float32Array([1, 1, 1, 1]),
      undefined,
      new Float32Array([7, 7, 7, 7])
    );

    const row = db.prepare("SELECT tags_vector FROM memories WHERE id = 'm1'").get() as {
      tags_vector: Uint8Array;
    };
    expect(
      Array.from(new Float32Array(row.tags_vector.buffer, row.tags_vector.byteOffset, 4))
    ).toEqual([7, 7, 7, 7]);
  });
});
