import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { CONFIG } from "../src/config.js";
import { LocalMemoryClient } from "../src/services/client.js";

describe("semantic deduplication at ingest", () => {
  const tempDirs: string[] = [];
  let client: LocalMemoryClient;
  let sharedTempDir: string;

  beforeAll(() => {
    sharedTempDir = mkdtempSync(join(tmpdir(), "dedup-ingest-"));
    tempDirs.push(sharedTempDir);
    (CONFIG as any).storagePath = sharedTempDir;
  });

  beforeEach(() => {
    // Override CONFIG for test
    (CONFIG as any).deduplicationIngestEnabled = true;
    (CONFIG as any).deduplicationSimilarityThreshold = 0.92;

    client = new LocalMemoryClient();
  });

  afterEach(() => {
    // Intentionally NOT calling connectionManager.closeAll() here
    // because shardManager.metadataDb must stay open across tests.
    // Each test uses a unique containerTag hash, so shard files are isolated.
  });

  afterAll(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function getDbForShard(containerTag: string): any {
    const parts = containerTag.split("_");
    const scopeVal = parts.length >= 3 ? parts[1] : "user";
    const hashVal = parts.slice(2).join("_");
    const shard = shardManager.getAllShards(scopeVal as "user" | "project", hashVal)[0];
    if (!shard) return null;
    return connectionManager.getConnection(shard.dbPath);
  }

  async function getMemoryById(id: string, containerTag: string): Promise<any> {
    const db = getDbForShard(containerTag);
    if (!db) return null;
    return db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as any;
  }

  async function countMemories(containerTag: string): Promise<number> {
    const db = getDbForShard(containerTag);
    if (!db) return 0;
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM memories WHERE container_tag = ?`)
      .get(containerTag) as any;
    return row?.count ?? 0;
  }

  it("returns existing memory ID for exact duplicate content and containerTag", async () => {
    const content = "exact duplicate memory content";
    const containerTag = "opencode_project_testhash_a";

    const result1 = await client.addMemory(content, containerTag);
    expect(result1.success).toBe(true);
    expect(result1.id).toBeDefined();
    const id1 = result1.id;

    const result2 = await client.addMemory(content, containerTag);
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBe(true);
    expect(result2.id).toBe(id1);

    // Should only have one row in DB
    const count = await countMemories(containerTag);
    expect(count).toBe(1);
  });

  it("merges metadata for near-duplicate with cosine similarity > threshold", async () => {
    const content1 = "implement user authentication with JWT tokens";
    // Semantically very close — same words, slightly different phrasing
    const content2 = "implement user authentication using JWT tokens";
    const containerTag = "opencode_project_testhash_b";

    const result1 = await client.addMemory(content1, containerTag, {
      source: "auto-capture",
      tags: ["auth"],
    });
    expect(result1.success).toBe(true);
    const id1 = result1.id;

    const result2 = await client.addMemory(content2, containerTag, {
      source: "manual",
      tags: ["jwt", "security"],
    });
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBe(true);
    expect(result2.id).toBe(id1);

    // Access count should have been incremented
    const row = await getMemoryById(id1!);
    expect(row.access_count).toBeGreaterThanOrEqual(1);
    expect(row.updated_at).toBeGreaterThanOrEqual(row.created_at);
  });

  it("creates a new memory when similarity is below threshold", async () => {
    const content1 = "completely different topic about database optimization";
    const content2 = "something about frontend UI components and React hooks";
    const containerTag = "opencode_project_testhash_c";

    const result1 = await client.addMemory(content1, containerTag);
    expect(result1.success).toBe(true);
    const id1 = result1.id;

    const result2 = await client.addMemory(content2, containerTag);
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBeFalsy();
    expect(result2.id).not.toBe(id1);

    const count = await countMemories(containerTag);
    expect(count).toBe(2);
  });

  it("checks deduplication only within the same containerTag", async () => {
    const content = "shared content across projects";
    const tag1 = "opencode_project_hash1_d";
    const tag2 = "opencode_project_hash2_d";

    const result1 = await client.addMemory(content, tag1);
    expect(result1.success).toBe(true);

    // Same content but different containerTag should create new memory
    const result2 = await client.addMemory(content, tag2);
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBeFalsy();
    expect(result2.id).not.toBe(result1.id);
  });

  it("increments access_count and updates updated_at when merging duplicate", async () => {
    const content = "memory that will be deduplicated";
    const containerTag = "opencode_project_testhash_e";

    const result1 = await client.addMemory(content, containerTag);
    expect(result1.success).toBe(true);

    // Wait a tiny bit to ensure updated_at is different
    await new Promise((r) => setTimeout(r, 50));

    const result2 = await client.addMemory(content, containerTag);
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBe(true);

    const row = await getMemoryById(result1.id!, containerTag);
    expect(row.access_count).toBe(1);
    expect(row.updated_at).toBeGreaterThan(row.created_at);
  });

  it("is gated by CONFIG.deduplicationIngestEnabled", async () => {
    (CONFIG as any).deduplicationIngestEnabled = false;

    const content = "content with dedup disabled";
    const containerTag = "opencode_project_testhash_f";

    const result1 = await client.addMemory(content, containerTag);
    expect(result1.success).toBe(true);

    const result2 = await client.addMemory(content, containerTag);
    expect(result2.success).toBe(true);
    expect((result2 as any).duplicate).toBeFalsy();
    expect(result2.id).not.toBe(result1.id);

    const count = await countMemories(containerTag);
    expect(count).toBe(2);
  });
});
