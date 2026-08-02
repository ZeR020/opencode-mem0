import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../../src/services/sqlite/sqlite-bootstrap.js";
import { USearchBackend } from "../../src/services/vector-backends/usearch-backend.js";
import type {
  BackendInsertItem,
  BackendSearchResult,
} from "../../src/services/vector-backends/types.js";
import type { ShardInfo } from "../../src/services/sqlite/types.js";

async function insertManyForTest(
  backend: USearchBackend,
  indexKey: string,
  items: BackendInsertItem[]
): Promise<void> {
  const parts = indexKey.split("_");
  const scope = parts[0] as "project" | "user";
  const scopeHash = parts[1]!;
  const shardIndex = parseInt(parts[2]!, 10);
  const kind = parts[3] as "content" | "tags";

  const shard: ShardInfo = {
    id: 1,
    scope,
    scopeHash,
    shardIndex,
    dbPath: "",
    vectorCount: items.length,
    isActive: true,
    createdAt: Date.now(),
  };

  await backend.insertBatch({
    items,
    shard,
    kind,
  });
}

async function searchForTest(
  backend: USearchBackend,
  indexKey: string,
  queryVector: Float32Array,
  limit: number
): Promise<BackendSearchResult[]> {
  const parts = indexKey.split("_");
  const scope = parts[0] as "project" | "user";
  const scopeHash = parts[1]!;
  const shardIndex = parseInt(parts[2]!, 10);
  const kind = parts[3] as "content" | "tags";

  const shard: ShardInfo = {
    id: 1,
    scope,
    scopeHash,
    shardIndex,
    dbPath: "",
    vectorCount: 0,
    isActive: true,
    createdAt: Date.now(),
  };

  return backend.search({
    db: null,
    shard,
    kind,
    queryVector,
    limit,
  });
}

const Database = getDatabase();

describe("USearchBackend", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates and searches an in-memory index", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-"));
    tempDirs.push(baseDir);

    const backend = new USearchBackend({ baseDir, dimensions: 4 });

    await insertManyForTest(backend, "project_hash_0_content", [
      { id: "a", vector: new Float32Array([1, 0, 0, 0]) },
      { id: "b", vector: new Float32Array([0, 1, 0, 0]) },
      { id: "c", vector: new Float32Array([0.9, 0.1, 0, 0]) },
    ]);

    const result = await searchForTest(
      backend,
      "project_hash_0_content",
      new Float32Array([1, 0, 0, 0]),
      2
    );

    expect(result.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("supports public insert and search path", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-public-"));
    tempDirs.push(baseDir);

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath: join(baseDir, "test.db"),
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    const backend = new USearchBackend({ baseDir, dimensions: 4 });
    await backend.insert({
      id: "alpha",
      vector: new Float32Array([1, 0, 0, 0]),
      shard,
      kind: "content",
    });

    const result = await backend.search({
      db: null,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });

    expect(result.map((x) => x.id)).toEqual(["alpha"]);
  });

  it("updates an existing id instead of failing on duplicate insert", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-upsert-"));
    tempDirs.push(baseDir);

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath: join(baseDir, "test.db"),
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    const backend = new USearchBackend({ baseDir, dimensions: 4 });
    await backend.insert({
      id: "alpha",
      vector: new Float32Array([0, 1, 0, 0]),
      shard,
      kind: "content",
    });
    await backend.insert({
      id: "alpha",
      vector: new Float32Array([1, 0, 0, 0]),
      shard,
      kind: "content",
    });

    const result = await backend.search({
      db: null,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });

    expect(result.map((x) => x.id)).toEqual(["alpha"]);
  });

  it("rebuilds an index from sqlite rows", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-rebuild-"));
    tempDirs.push(baseDir);
    const db = new Database(join(baseDir, "test.db"));
    db.run(
      "CREATE TABLE memories (id TEXT PRIMARY KEY, vector BLOB, tags_vector BLOB, is_deprecated INTEGER DEFAULT 0)"
    );
    db.prepare("INSERT INTO memories (id, vector, tags_vector) VALUES (?, ?, ?)").run(
      "alpha",
      new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer),
      null
    );

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath: join(baseDir, "test.db"),
      vectorCount: 1,
      isActive: true,
      createdAt: Date.now(),
    };

    const backend = new USearchBackend({ baseDir, dimensions: 4 });
    await backend.rebuildFromShard({ db, shard, kind: "content" });

    const result = await backend.search({
      db,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 1,
    });

    expect(result.map((x) => x.id)).toEqual(["alpha"]);
  });

  it("returns [] for an empty index without touching the native search call", async () => {
    // Regression: native usearch Index.search() on an empty index parks the
    // calling thread indefinitely (verified: process blocked >30s at 0% CPU,
    // wedging the whole web server). The zero-hit case must short-circuit.
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-empty-"));
    tempDirs.push(baseDir);

    const backend = new USearchBackend({ baseDir, dimensions: 4 });
    const result = await backend.search({
      db: null,
      shard: {
        id: 99,
        scope: "user",
        scopeHash: "empty",
        shardIndex: 0,
        dbPath: "",
        vectorCount: 0,
        isActive: true,
        createdAt: Date.now(),
      },
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 5,
    });

    expect(result).toEqual([]);
  });

  it("rebuilds an index from sqlite rows excluding deprecated memories", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "usearch-backend-rebuild-dep-"));
    tempDirs.push(baseDir);
    const db = new Database(join(baseDir, "test.db"));
    db.run(
      "CREATE TABLE memories (id TEXT PRIMARY KEY, vector BLOB, tags_vector BLOB, is_deprecated INTEGER DEFAULT 0)"
    );
    const insert = db.prepare(
      "INSERT INTO memories (id, vector, tags_vector, is_deprecated) VALUES (?, ?, ?, ?)"
    );
    insert.run("live", new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer), null, 0);
    insert.run("deprecated", new Uint8Array(new Float32Array([0.95, 0.05, 0, 0]).buffer), null, 1);

    const shard = {
      id: 1,
      scope: "project" as const,
      scopeHash: "hash",
      shardIndex: 0,
      dbPath: join(baseDir, "test.db"),
      vectorCount: 2,
      isActive: true,
      createdAt: Date.now(),
    };

    const backend = new USearchBackend({ baseDir, dimensions: 4 });
    await backend.rebuildFromShard({ db, shard, kind: "content" });

    const result = await backend.search({
      db,
      shard,
      kind: "content",
      queryVector: new Float32Array([1, 0, 0, 0]),
      limit: 5,
    });

    expect(result.map((x) => x.id)).toEqual(["live"]);
  });
});
