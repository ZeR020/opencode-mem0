import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { CONFIG } from "../src/config.js";

// R8.1/V3: the ingest-dedup path consults the tri-state LLM contradiction
// verdict for the final veto. Override it here (importOriginal keeps
// resolveConflict and the rest real); each test sets its return value.
const contradictionVerdictMock = vi.hoisted(() => ({ checkContradictionVerdict: vi.fn() }));

vi.mock("../src/services/memory-conflicts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/memory-conflicts.js")>();
  return {
    ...actual,
    checkContradictionVerdict: contradictionVerdictMock.checkContradictionVerdict,
  };
});

// Bag-of-words pseudo-embedding: deterministic per-content vectors with high
// cosine for overlapping vocabulary. Same approach as semantic-dedup-ingest.
vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    embedWithTimeout: (text: string) => pseudoEmbed(text),
    embed: (text: string) => pseudoEmbed(text),
    isWarmedUp: true,
    warmup: () => {},
    embeddingAvailable: true,
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

function pseudoEmbed(text: string): Float32Array {
  const dims = 768;
  const vec = new Float32Array(dims);
  const words = [...new Set(text.toLowerCase().match(/\b\w+\b/g) || [])];
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;
  }
  let mag = 0;
  for (let i = 0; i < dims; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < dims; i++) vec[i] /= mag;
  }
  return vec;
}

import { LocalMemoryClient } from "../src/services/client.js";
import { resolveConflict, getAllConflicts } from "../src/services/memory-conflicts.js";
import { handleGetConflict } from "../src/services/handlers/conflicts.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";
import { USearchBackend } from "../src/services/vector-backends/usearch-backend.js";
import { decodeVector } from "../src/services/vector-backends/shared.js";

describe("conflict resolution against a real database", () => {
  const tempDirs: string[] = [];
  let client: LocalMemoryClient;
  let sharedTempDir: string;
  let originalStoragePath: string;

  const CONTAINER = "opencode_project_testhash_conflict";

  function getShardDb(): any {
    const parts = CONTAINER.split("_");
    const scopeVal = parts.length >= 3 ? parts[1] : "user";
    const hashVal = parts.slice(2).join("_");
    const shard = shardManager.getAllShards(scopeVal as "user" | "project", hashVal)[0];
    if (!shard) return null;
    return connectionManager.getConnection(shard.dbPath);
  }

  function getMemoryById(id: string): any {
    const db = getShardDb();
    if (!db) return null;
    return db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
  }

  function getConflictRow(id: string): any {
    const db = getShardDb();
    if (!db) return null;
    return db.prepare("SELECT * FROM memory_conflicts WHERE id = ?").get(id) as any;
  }

  beforeAll(() => {
    originalStoragePath = (CONFIG as any).storagePath;
    sharedTempDir = mkdtempSync(join(tmpdir(), "conflict-resolution-"));
    tempDirs.push(sharedTempDir);
    (CONFIG as any).storagePath = sharedTempDir;
  });

  beforeEach(() => {
    contradictionVerdictMock.checkContradictionVerdict.mockClear();
    (CONFIG as any).deduplicationIngestEnabled = true;
    (CONFIG as any).deduplicationSimilarityThreshold = 0.92;
    client = new LocalMemoryClient();
  });

  afterAll(() => {
    (CONFIG as any).storagePath = originalStoragePath;
    connectionManager.closeAll();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merge resolution persists resolved state, resolution data and deprecates both originals", async () => {
    const content1 = "the sky is blue in testland";
    const content2 = "database password rotation happens weekly";

    const r1 = await client.addMemory(content1, CONTAINER);
    expect(r1.success).toBe(true);
    const r2 = await client.addMemory(content2, CONTAINER);
    expect(r2.success).toBe(true);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    // Insert a real conflict row referencing both memories
    const db = getShardDb();
    expect(db).toBeTruthy();
    const conflictId = "conflict-real-merge";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`
    ).run(conflictId, id1, id2, 0.88, Date.now(), CONTAINER);

    const mergedContent = "merged: sky is blue and passwords rotate weekly";
    const result = await resolveConflict(conflictId, "merge", mergedContent);

    expect(result.success).toBe(true);
    expect(result.mergedMemoryId).toBeDefined();

    // Conflict row must be marked resolved with resolution data persisted
    const row = getConflictRow(conflictId);
    expect(row).toBeTruthy();
    expect(row.resolved).toBe(1);
    expect(row.resolution_type).toBe("merge");
    const resolutionData = JSON.parse(row.resolution_data || "{}");
    expect(resolutionData.mergedMemoryId).toBe(result.mergedMemoryId);

    // Both originals deprecated
    expect(getMemoryById(id1).is_deprecated).toBe(1);
    expect(getMemoryById(id2).is_deprecated).toBe(1);

    // Merged memory exists with the merged content
    const merged = getMemoryById(result.mergedMemoryId as string);
    expect(merged).toBeTruthy();
    expect(merged.content).toBe(mergedContent);

    // Resolved history now includes it
    const resolvedList = getAllConflicts(true, 100);
    expect(resolvedList.some((c: { id: string }) => c.id === conflictId)).toBe(true);
  });

  it("rejects re-resolution of an already resolved conflict", async () => {
    const content1 = "the moon is made of cheese in testland";
    const content2 = "ssh keys rotate quarterly in testland";

    const r1 = await client.addMemory(content1, CONTAINER);
    const r2 = await client.addMemory(content2, CONTAINER);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    const db = getShardDb();
    const conflictId = "conflict-real-twice";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 1, 'keep_both', ?, NULL, ?)`
    ).run(conflictId, id1, id2, 0.8, Date.now(), Date.now(), CONTAINER);

    const result = await resolveConflict(conflictId, "keep_both");
    expect(result.success).toBe(false);
    expect(result.error).toContain("already resolved");
  });

  it("R8.1/V3 ingest dedup: LLM 'no' verdict on a contradiction merges instead of recording a conflict", async () => {
    contradictionVerdictMock.checkContradictionVerdict.mockResolvedValue("no");
    const containerTag = "opencode_project_testhash_r1veto";
    const content1 = "use bun for builds in r1veto";
    const content2 = "never use bun for builds in r1veto";

    const r1 = await client.addMemory(content1, containerTag);
    expect(r1.success).toBe(true);
    const id1 = r1.id;

    const r2 = await client.addMemory(content2, containerTag);
    expect(r2.success).toBe(true);
    // LLM vetoed the contradiction → normal dedup merge path
    expect((r2 as any).duplicate).toBe(true);
    expect(r2.id).toBe(id1);

    const db = connectionManager.getConnection(
      (shardManager.getAllShards("project", "testhash_r1veto") as any)[0].dbPath
    );
    const conflictCount = db
      .prepare(
        "SELECT COUNT(*) as c FROM memory_conflicts WHERE memory_id_1 = ? OR memory_id_2 = ?"
      )
      .get(id1!, id1!) as any;
    expect(conflictCount.c).toBe(0);
  });

  it("R8.1/V3 ingest dedup: confirmed contradiction ('yes') records exactly one conflict with real cosine similarity", async () => {
    contradictionVerdictMock.checkContradictionVerdict.mockResolvedValue("yes");
    const containerTag = "opencode_project_testhash_r1record";
    const content1 = "use bun for builds in r1record";
    const content2 = "never use bun for builds in r1record";

    const r1 = await client.addMemory(content1, containerTag);
    expect(r1.success).toBe(true);
    const id1 = r1.id;

    const r2 = await client.addMemory(content2, containerTag);
    expect(r2.success).toBe(true);
    expect((r2 as any).duplicate).toBeUndefined();
    expect(r2.id).not.toBe(id1);
    const id2 = r2.id as string;

    // Direct record happens synchronously inside addMemory — no polling needed.
    const db = connectionManager.getConnection(
      (shardManager.getAllShards("project", "testhash_r1record") as any)[0].dbPath
    );
    const rows = db
      .prepare("SELECT * FROM memory_conflicts WHERE memory_id_1 = ? OR memory_id_2 = ?")
      .all(id2, id2) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].resolved).toBe(0);
    // The real cosine similarity, not the FTS fallback 0.5
    expect(rows[0].similarity_score).toBeGreaterThan(0.5);
    expect(rows[0].similarity_score).toBeLessThanOrEqual(1);

    // Re-adding the same contradictory content must not create a second conflict
    const r3 = await client.addMemory(content2, containerTag);
    expect(r3.success).toBe(true);
    const rowsAfter = db
      .prepare("SELECT * FROM memory_conflicts WHERE memory_id_1 = ? OR memory_id_2 = ?")
      .all(id2, id2) as any[];
    expect(rowsAfter).toHaveLength(1);
  });

  it("R8.2 keep_newer on created_at tie keeps the newly-added memory", async () => {
    const content1 = "tie test memory alpha";
    const content2 = "tie test memory beta";

    const r1 = await client.addMemory(content1, CONTAINER);
    const r2 = await client.addMemory(content2, CONTAINER);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    const db = getShardDb();
    // Force an exact created_at tie
    const sameTs = Date.now();
    db.prepare("UPDATE memories SET created_at = ? WHERE id IN (?, ?)").run(sameTs, id1, id2);

    const conflictId = "conflict-real-tie";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`
    ).run(conflictId, id1, id2, 0.9, Date.now(), CONTAINER);

    const result = await resolveConflict(conflictId, "keep_newer");
    expect(result.success).toBe(true);
    // memoryId1 = newly-added memory; on tie it must survive, mem2 deprecated
    expect(getMemoryById(id1).is_deprecated).toBe(0);
    expect(getMemoryById(id2).is_deprecated).toBe(1);
  });

  it("R8.3 merge resolution reuses an existing merged memory (idempotent retry)", async () => {
    const content1 = "idempotent test memory one";
    const content2 = "idempotent test memory two";

    const r1 = await client.addMemory(content1, CONTAINER);
    const r2 = await client.addMemory(content2, CONTAINER);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    const db = getShardDb();
    // Pre-existing merged memory with mergedFrom metadata pointing at the pair
    const preMerged = await client.addMemory("pre-existing merged content", CONTAINER);
    const preMergedId = preMerged.id as string;
    db.prepare("UPDATE memories SET metadata = ? WHERE id = ?").run(
      JSON.stringify({ mergedFrom: [id1, id2] }),
      preMergedId
    );

    const conflictId = "conflict-real-idem";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`
    ).run(conflictId, id1, id2, 0.88, Date.now(), CONTAINER);

    const result = await resolveConflict(conflictId, "merge", "merged content here");
    expect(result.success).toBe(true);
    expect(result.mergedMemoryId).toBe(preMergedId);

    // No duplicate merged memory created
    const mergedCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM memories
         WHERE metadata LIKE '%"mergedFrom"%'
           AND metadata LIKE '%' || ? || '%'
           AND metadata LIKE '%' || ? || '%'`
      )
      .get(id1, id2) as any;
    expect(mergedCount.c).toBe(1);

    // Conflict row persisted as resolved with the reused id
    const row = getConflictRow(conflictId);
    expect(row.resolved).toBe(1);
    const resolutionData = JSON.parse(row.resolution_data || "{}");
    expect(resolutionData.mergedMemoryId).toBe(preMergedId);
  });

  it("R8.5 merge resolution copies tags_vector as a decoded Float32Array (regression: raw sqlite blob crashed USearch with 'Duplicate keys')", async () => {
    const content1 = "regression tags memory alpha";
    const content2 = "regression tags memory beta";

    const r1 = await client.addMemory(content1, CONTAINER, { tags: ["alpha"] });
    expect(r1.success).toBe(true);
    const r2 = await client.addMemory(content2, CONTAINER, { tags: ["beta"] });
    expect(r2.success).toBe(true);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    const db = getShardDb();
    expect(db).toBeTruthy();

    // Precondition: sqlite stores tags_vector as a raw blob (Uint8Array) —
    // exactly the shape resolveConflict used to hand to USearchBackend.insert.
    const mem1Row = getMemoryById(id1);
    expect(mem1Row.tags_vector).toBeInstanceOf(Uint8Array);
    expect((mem1Row.tags_vector as Uint8Array).length).toBe(768 * 4);

    const conflictId = "conflict-real-tags-blob";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`
    ).run(conflictId, id1, id2, 0.88, Date.now(), CONTAINER);

    const mergedContent = "merged: regression tags alpha and beta";
    const result = await resolveConflict(conflictId, "merge", mergedContent);
    expect(result.success).toBe(true);
    expect(result.mergedMemoryId).toBeDefined();

    // Merged row exists and its tags_vector blob round-trips byte-identically
    const merged = getMemoryById(result.mergedMemoryId as string);
    expect(merged).toBeTruthy();
    expect(merged.content).toBe(mergedContent);
    expect(merged.tags_vector).toBeInstanceOf(Uint8Array);
    expect((merged.tags_vector as Uint8Array).length).toBe(768 * 4);
    expect(
      Buffer.from(merged.tags_vector as Uint8Array).equals(
        Buffer.from(mem1Row.tags_vector as Uint8Array)
      )
    ).toBe(true);

    // Conflict row resolved with mergedMemoryId in resolution_data
    const row = getConflictRow(conflictId);
    expect(row.resolved).toBe(1);
    const resolutionData = JSON.parse(row.resolution_data || "{}");
    expect(resolutionData.mergedMemoryId).toBe(result.mergedMemoryId);

    // Tags index contains the merged id: query with mem1's tags vector
    const parts = CONTAINER.split("_");
    const shard = shardManager.getAllShards(
      parts[1] as "user" | "project",
      parts.slice(2).join("_")
    )[0];
    expect(shard).toBeTruthy();
    const tagsQuery = decodeVector(mem1Row.tags_vector as Uint8Array);
    const searchResults = await vectorSearch.searchInShard(shard, tagsQuery, CONTAINER, 10);
    expect(searchResults.some((s) => s.id === result.mergedMemoryId)).toBe(true);
  });

  it("R8.6 USearchBackend.insert fails loudly on a raw blob instead of the misleading 'Duplicate keys'", async () => {
    const r = await client.addMemory("blob guard seed memory", CONTAINER);
    expect(r.success).toBe(true);

    const parts = CONTAINER.split("_");
    const shard = shardManager.getAllShards(
      parts[1] as "user" | "project",
      parts.slice(2).join("_")
    )[0];
    expect(shard).toBeTruthy();

    const backend = new USearchBackend({ baseDir: sharedTempDir, dimensions: 768 });
    const blob = new Uint8Array(new Float32Array(768).buffer);
    await expect(
      backend.insert({
        id: "blob-guard",
        vector: blob as unknown as Float32Array,
        shard,
        kind: "tags",
      })
    ).rejects.toThrow(/USearch upsertItem expects Float32Array, got Uint8Array/);
  });

  it("R8.4 handleGetConflict finds a conflict by id across shards, and 404s unknown ids", async () => {
    const content1 = "getconflict test memory one";
    const content2 = "getconflict test memory two";

    const r1 = await client.addMemory(content1, CONTAINER);
    const r2 = await client.addMemory(content2, CONTAINER);
    const id1 = r1.id as string;
    const id2 = r2.id as string;

    const db = getShardDb();
    const conflictId = "conflict-real-get";
    db.prepare(
      `INSERT INTO memory_conflicts (
        id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved,
        resolution_type, resolved_at, resolution_data, container_tag
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`
    ).run(conflictId, id1, id2, 0.77, Date.now(), CONTAINER);

    const found = handleGetConflict(conflictId);
    expect(found.success).toBe(true);
    expect(found.data?.id).toBe(conflictId);
    expect(found.data?.memory1Content).toBe(content1);
    expect(found.data?.memory2Content).toBe(content2);

    const missing = handleGetConflict("conflict-does-not-exist");
    expect(missing.success).toBe(false);
  });

  it("V4: locked recheck reuses the vetted verdict — single provider call for the pair", async () => {
    contradictionVerdictMock.checkContradictionVerdict.mockResolvedValue("yes");
    const containerTag = "opencode_project_testhash_v4reuse";

    const r1 = await client.addMemory("use bun for builds in v4reuse", containerTag);
    expect(r1.success).toBe(true);

    const r2 = await client.addMemory("never use bun for builds in v4reuse", containerTag);
    expect(r2.success).toBe(true);
    expect((r2 as any).duplicate).toBeUndefined();
    expect(r2.id).not.toBe(r1.id);

    // First check pays one verdict call; the locked recheck must reuse it
    // (vettedConflictCandidateId matches the same candidate).
    expect(contradictionVerdictMock.checkContradictionVerdict).toHaveBeenCalledTimes(1);

    // And the pair is still recorded exactly once.
    const db = connectionManager.getConnection(
      (shardManager.getAllShards("project", "testhash_v4reuse") as any)[0].dbPath
    );
    const rows = db
      .prepare("SELECT * FROM memory_conflicts WHERE memory_id_1 = ? OR memory_id_2 = ?")
      .all(r2.id as string, r2.id as string) as any[];
    expect(rows).toHaveLength(1);
  });
});
