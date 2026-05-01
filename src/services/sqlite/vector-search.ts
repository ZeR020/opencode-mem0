import { getDatabase } from "./sqlite-bootstrap.js";
import { connectionManager } from "./connection-manager.js";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";
import type { MemoryRecord, SearchResult, ShardInfo } from "./types.js";
import { createVectorBackend } from "../vector-backends/backend-factory.js";
import { ExactScanBackend } from "../vector-backends/exact-scan-backend.js";
import type { VectorBackend } from "../vector-backends/types.js";
import {
  calculateContextBoost,
  calculateDiversityPenalty,
  type RetrievalContext,
} from "../retrieval-context.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

function toBlob(vector?: Float32Array): Uint8Array | null {
  return vector ? new Uint8Array(vector.buffer) : null;
}

export class VectorSearch {
  private readonly backendPromise: Promise<VectorBackend>;
  private readonly fallbackBackend: VectorBackend;

  constructor(backend?: VectorBackend, fallbackBackend: VectorBackend = new ExactScanBackend()) {
    this.backendPromise = backend
      ? Promise.resolve(backend)
      : createVectorBackend({ vectorBackend: CONFIG.vectorBackend });
    this.fallbackBackend = fallbackBackend;
  }

  private async getBackend(): Promise<VectorBackend> {
    return this.backendPromise;
  }

  /**
   * Insert a memory vector into the SQLite database and optionally index it
   * in the vector backend (usearch or exact-scan). Rolls back on backend failure.
   *
   * @param db - SQLite database handle
   * @param record - Complete memory record including vector and scores
   * @param shard - Optional shard info for vector backend indexing
   */
  async insertVector(db: DatabaseType, record: MemoryRecord, shard?: ShardInfo): Promise<void> {
    const insertMemory = db.prepare(`
      INSERT INTO memories (
        id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
        metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url,
        recency_score, frequency_score, importance_score, utility_score, novelty_score,
        confidence_score, interference_penalty, strength, access_count, last_accessed,
        store_type, decay_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMemory.run(
      record.id,
      record.content,
      toBlob(record.vector),
      toBlob(record.tagsVector),
      record.containerTag,
      record.tags || null,
      record.type || null,
      record.createdAt,
      record.updatedAt,
      record.metadata || null,
      record.displayName || null,
      record.userName || null,
      record.userEmail || null,
      record.projectPath || null,
      record.projectName || null,
      record.gitRepoUrl || null,
      record.recencyScore ?? 0.5,
      record.frequencyScore ?? 0.0,
      record.importanceScore ?? 0.5,
      record.utilityScore ?? 0.3,
      record.noveltyScore ?? 0.5,
      record.confidenceScore ?? 0.7,
      record.interferencePenalty ?? 0.0,
      record.strength ?? 0.5,
      record.accessCount ?? 0,
      record.lastAccessed || null,
      record.storeType || "stm",
      record.decayRate ?? 0.05
    );

    try {
      if (shard) {
        const backend = await this.getBackend();
        await backend.insert({ id: record.id, vector: record.vector, shard, kind: "content" });
        if (record.tagsVector) {
          await backend.insert({ id: record.id, vector: record.tagsVector, shard, kind: "tags" });
        }
      }
    } catch (error) {
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(record.id);
      throw error;
    }
  }

  /**
   * Search for memories within a single shard using hybrid ranking.
   * Combines vector similarity (60%), tag similarity (40%), and FTS5 boost,
   * then applies multi-factor ranking (strength 40% + recency 30% + semantic 30%),
   * context boosting, and diversity filtering.
   *
   * @param shard - Shard to search
   * @param queryVector - Embedded query vector
   * @param containerTag - Container tag to filter by (empty string for all)
   * @param limit - Maximum results to return from this shard
   * @param queryText - Raw query text for FTS5 and tag matching
   * @param context - Optional retrieval context for project/file boosting
   * @returns Ranked search results with score breakdowns
   */
  async searchInShard(
    shard: ShardInfo,
    queryVector: Float32Array,
    containerTag: string,
    limit: number,
    queryText?: string,
    context?: RetrievalContext
  ): Promise<SearchResult[]> {
    const db = connectionManager.getConnection(shard.dbPath);
    const backend = await this.getBackend();
    let contentResults;
    let tagsResults;

    try {
      await backend.rebuildFromShard({ db, shard, kind: "content" });
      await backend.rebuildFromShard({ db, shard, kind: "tags" });

      contentResults = await backend.search({
        db,
        shard,
        kind: "content",
        queryVector,
        limit: limit * 4,
      });
      tagsResults = await backend.search({
        db,
        shard,
        kind: "tags",
        queryVector,
        limit: limit * 4,
      });
    } catch (error) {
      log("Vector search degraded to exact scan in shard", {
        shardId: shard.id,
        backend: backend.getBackendName(),
        error: String(error),
      });

      await this.fallbackBackend.rebuildFromShard({ db, shard, kind: "content" });
      await this.fallbackBackend.rebuildFromShard({ db, shard, kind: "tags" });
      contentResults = await this.fallbackBackend.search({
        db,
        shard,
        kind: "content",
        queryVector,
        limit: limit * 4,
      });
      tagsResults = await this.fallbackBackend.search({
        db,
        shard,
        kind: "tags",
        queryVector,
        limit: limit * 4,
      });
    }

    const scoreMap = new Map<string, { contentSim: number; tagsSim: number }>();

    for (const r of contentResults) {
      scoreMap.set(r.id, { contentSim: 1 - r.distance, tagsSim: 0 });
    }

    for (const r of tagsResults) {
      const entry = scoreMap.get(r.id);
      if (entry) {
        entry.tagsSim = 1 - r.distance;
      } else {
        scoreMap.set(r.id, { contentSim: 0, tagsSim: 1 - r.distance });
      }
    }

    const ids = Array.from(scoreMap.keys());
    if (ids.length === 0) return [];

    // Hybrid search: also get FTS5 results for query text
    let ftsResults: string[] = [];
    if (queryText && queryText.length > 0) {
      try {
        const ftsStmt = db.prepare(`
          SELECT id FROM memories_fts
          WHERE memories_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `);
        const ftsRows = ftsStmt.all(queryText, limit * 2) as any[];
        ftsResults = ftsRows.map((r: any) => r.id);
      } catch {
        // FTS5 not available, fallback to LIKE
        try {
          const likeStmt = db.prepare(`
            SELECT id FROM memories
            WHERE content LIKE ? AND is_deprecated = 0
            LIMIT ?
          `);
          const likeRows = likeStmt.all(`%${queryText}%`, limit * 2) as any[];
          ftsResults = likeRows.map((r: any) => r.id);
        } catch {
          // Ignore FTS/like errors
        }
      }
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        containerTag === ""
          ? `
      SELECT * FROM memories
      WHERE id IN (${placeholders}) AND is_deprecated = 0
    `
          : `
      SELECT * FROM memories
      WHERE id IN (${placeholders}) AND container_tag = ? AND is_deprecated = 0
    `
      )
      .all(...ids, ...(containerTag === "" ? [] : [containerTag])) as any[];

    const queryWords = queryText
      ? queryText
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((w) => w.length > 1)
      : [];

    const hydratedResults: SearchResult[] = rows.map((row: any) => {
      const scores = scoreMap.get(row.id)!;
      const memoryTagsStr = row.tags || "";
      const memoryTags = memoryTagsStr.split(",").map((t: string) => t.trim().toLowerCase());

      let exactMatchBoost = 0;
      if (queryWords.length > 0 && memoryTags.length > 0) {
        const matches = queryWords.filter((w) =>
          memoryTags.some((t: string) => t.includes(w) || w.includes(t))
        ).length;
        exactMatchBoost = matches / Math.max(queryWords.length, 1);
      }

      // Hybrid: boost if in FTS results
      let ftsBoost = 0;
      if (ftsResults.includes(row.id)) {
        ftsBoost = 0.1; // Small boost for being in FTS results
      }

      const finalTagsSim = Math.max(scores.tagsSim, exactMatchBoost);
      const vectorSimilarity = scores.contentSim * 0.6 + finalTagsSim * 0.4 + ftsBoost;

      // Get scoring fields
      const strength = row.strength ?? 0.5;
      const recencyScore = row.recency_score ?? 0.5;

      // Multi-factor ranking: strength (40%) + recency (30%) + vector similarity (30%)
      const strengthWeight = strength * 0.4;
      const recencyWeight = recencyScore * 0.3;
      const vectorWeight = vectorSimilarity * 0.3;
      const similarity = strengthWeight + recencyWeight + vectorWeight;

      // Context boost
      let contextBoost = 1.0;
      if (context) {
        contextBoost = calculateContextBoost(
          {
            projectPath: row.project_path,
            projectName: row.project_name,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          },
          context
        );
      }

      return {
        id: row.id,
        memory: row.content,
        similarity: similarity * contextBoost,
        tags: memoryTagsStr ? memoryTagsStr.split(",") : [],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        containerTag: row.container_tag,
        displayName: row.display_name,
        userName: row.user_name,
        userEmail: row.user_email,
        projectPath: row.project_path,
        projectName: row.project_name,
        gitRepoUrl: row.git_repo_url,
        isPinned: row.is_pinned,
        strength: row.strength,
        recencyScore: row.recency_score,
        importanceScore: row.importance_score,
        accessCount: row.access_count,
        // Store score components for transparency
        vectorSimilarity,
        recencyWeight,
        strengthWeight,
        contextBoost,
        finalScore: similarity * contextBoost,
      };
    });

    // Sort by: pinned first, then final score
    hydratedResults.sort((a, b) => {
      if ((a.isPinned || 0) !== (b.isPinned || 0)) {
        return (b.isPinned || 0) - (a.isPinned || 0);
      }
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

    // Apply diversity penalty
    const diversityThreshold = CONFIG.retrieval.diversityThreshold || 0.9;
    const diverseResults: SearchResult[] = [];

    for (const candidate of hydratedResults) {
      if (diverseResults.length >= limit) break;

      const penalty = calculateDiversityPenalty(
        candidate.memory,
        diverseResults.map((r) => r.memory),
        diversityThreshold
      );

      candidate.diversityPenalty = penalty;

      // Apply penalty to final score for ranking, but keep original for reference
      const penalizedScore = (candidate.finalScore || 0) * (1 - penalty);

      if (penalizedScore > 0.01 || diverseResults.length < limit / 2) {
        diverseResults.push(candidate);
      }
    }

    // Update access_count for retrieved memories
    try {
      const updateAccessStmt = db.prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`
      );
      const now = Date.now();
      for (const result of diverseResults) {
        updateAccessStmt.run(now, result.id);
      }
    } catch (error) {
      log("Failed to update access count", { error: String(error) });
    }

    return diverseResults;
  }

  /**
   * Execute a vector search across multiple shards and merge results.
   * Applies global diversity filtering to ensure the final result set
   * is not redundant across shards.
   *
   * @param shards - Array of shards to search
   * @param queryVector - Embedded query vector
   * @param containerTag - Container tag to filter by
   * @param limit - Per-shard result limit
   * @param similarityThreshold - Minimum similarity score to include
   * @param queryText - Raw query text for FTS5
   * @param context - Optional retrieval context for boosting
   * @returns Globally ranked and deduplicated search results
   */
  async searchAcrossShards(
    shards: ShardInfo[],
    queryVector: Float32Array,
    containerTag: string,
    limit: number,
    similarityThreshold: number,
    queryText?: string,
    context?: RetrievalContext
  ): Promise<SearchResult[]> {
    const shardPromises = shards.map(async (shard) => {
      try {
        return await this.searchInShard(
          shard,
          queryVector,
          containerTag,
          limit,
          queryText,
          context
        );
      } catch (error) {
        log("Shard search error", { shardId: shard.id, error: String(error) });
        return [];
      }
    });

    const resultsArray = await Promise.all(shardPromises);
    const allResults = resultsArray.flat();

    // Re-sort with full global diversity penalty
    allResults.sort((a, b) => {
      if ((a.isPinned || 0) !== (b.isPinned || 0)) {
        return (b.isPinned || 0) - (a.isPinned || 0);
      }
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

    // Apply global diversity filtering across shards
    const diversityThreshold = CONFIG.retrieval.diversityThreshold || 0.9;
    const finalResults: SearchResult[] = [];
    const maxResults = CONFIG.retrieval.maxResults || limit;

    for (const candidate of allResults) {
      if (finalResults.length >= maxResults) break;

      // Only filter by diversity, don't re-penalize scores
      let isDiverse = true;
      for (const selected of finalResults) {
        // Simple text-based diversity check as fallback
        const candidateWords = new Set(
          candidate.memory
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 4)
        );
        const selectedWords = new Set(
          selected.memory
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 4)
        );
        const intersection = [...candidateWords].filter((w) => selectedWords.has(w));
        const union = new Set([...candidateWords, ...selectedWords]);
        const jaccard = union.size > 0 ? intersection.length / union.size : 0;

        if (jaccard > diversityThreshold) {
          isDiverse = false;
          break;
        }
      }

      if (isDiverse || finalResults.length < maxResults / 2) {
        finalResults.push(candidate);
      }
    }

    return finalResults.filter((r) => r.similarity >= similarityThreshold);
  }

  /**
   * Delete a memory from SQLite and the vector backend.
   *
   * @param db - SQLite database handle
   * @param memoryId - ID of the memory to delete
   * @param shard - Optional shard info for backend index cleanup
   */
  async deleteVector(db: DatabaseType, memoryId: string, shard?: ShardInfo): Promise<void> {
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);

    if (shard) {
      const backend = await this.getBackend();
      await backend.delete({ id: memoryId, shard, kind: "content" });
      await backend.delete({ id: memoryId, shard, kind: "tags" });
    }
  }

  /**
   * Update a memory's vector in SQLite and the vector backend.
   *
   * @param db - SQLite database handle
   * @param memoryId - ID of the memory to update
   * @param vector - New content vector
   * @param shard - Optional shard info for backend re-indexing
   * @param tagsVector - Optional new tags vector
   */
  async updateVector(
    db: DatabaseType,
    memoryId: string,
    vector: Float32Array,
    shard?: ShardInfo,
    tagsVector?: Float32Array
  ): Promise<void> {
    db.prepare(`UPDATE memories SET vector = ?, tags_vector = ? WHERE id = ?`).run(
      toBlob(vector),
      toBlob(tagsVector),
      memoryId
    );

    if (shard) {
      const backend = await this.getBackend();
      await backend.insert({ id: memoryId, vector, shard, kind: "content" });
      if (tagsVector) {
        await backend.insert({ id: memoryId, vector: tagsVector, shard, kind: "tags" });
      } else {
        await backend.delete({ id: memoryId, shard, kind: "tags" });
      }
    }
  }

  /**
   * List non-deprecated memories from a shard, ordered by pinned, strength, recency.
   *
   * @param db - SQLite database handle
   * @param containerTag - Container tag to filter by (empty for all)
   * @param limit - Maximum memories to return
   * @returns Raw database rows
   */
  listMemories(db: DatabaseType, containerTag: string, limit: number): any[] {
    const stmt = db.prepare(
      containerTag === ""
        ? `
      SELECT * FROM memories
      WHERE is_deprecated = 0
      ORDER BY is_pinned DESC, strength DESC, recency_score DESC
      LIMIT ?
    `
        : `
      SELECT * FROM memories
      WHERE container_tag = ? AND is_deprecated = 0
      ORDER BY is_pinned DESC, strength DESC, recency_score DESC
      LIMIT ?
    `
    );

    return (containerTag === "" ? stmt.all(limit) : stmt.all(containerTag, limit)) as any[];
  }

  /**
   * Retrieve all non-deprecated memories from a shard.
   *
   * @param db - SQLite database handle
   * @returns All memory rows ordered by creation time
   */
  getAllMemories(db: DatabaseType): any[] {
    const stmt = db.prepare(
      `SELECT * FROM memories WHERE is_deprecated = 0 ORDER BY created_at DESC`
    );
    return stmt.all() as any[];
  }

  /**
   * Fetch a single memory by its ID.
   *
   * @param db - SQLite database handle
   * @param memoryId - Memory ID to look up
   * @returns The memory row, or null if not found
   */
  getMemoryById(db: DatabaseType, memoryId: string): any | null {
    const stmt = db.prepare(`SELECT * FROM memories WHERE id = ?`);
    return stmt.get(memoryId) as any;
  }

  /**
   * Find memories associated with a specific session ID via metadata.
   *
   * @param db - SQLite database handle
   * @param sessionID - Session ID to search for in metadata
   * @returns Matching memory rows with parsed tags and metadata
   */
  getMemoriesBySessionID(db: DatabaseType, sessionID: string): any[] {
    const stmt = db.prepare(`
      SELECT * FROM memories
      WHERE metadata LIKE ? AND is_deprecated = 0
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(`%"sessionID":"${sessionID}"%`) as any[];

    return rows.map((row: any) => ({
      ...row,
      tags: row.tags ? row.tags.split(",") : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }));
  }

  /**
   * Count non-deprecated memories for a specific container tag.
   *
   * @param db - SQLite database handle
   * @param containerTag - Container tag to count
   * @returns Number of matching memories
   */
  countVectors(db: DatabaseType, containerTag: string): number {
    const stmt = db.prepare(
      `SELECT COUNT(*) as count FROM memories WHERE container_tag = ? AND is_deprecated = 0`
    );
    const result = stmt.get(containerTag) as any;
    return result.count;
  }

  /**
   * Count all non-deprecated memories in a shard.
   *
   * @param db - SQLite database handle
   * @returns Total number of memories
   */
  countAllVectors(db: DatabaseType): number {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE is_deprecated = 0`);
    const result = stmt.get() as any;
    return result.count;
  }

  getDistinctTags(db: DatabaseType): any[] {
    const stmt = db.prepare(`
      SELECT DISTINCT
        container_tag,
        display_name,
        user_name,
        user_email,
        project_path,
        project_name,
        git_repo_url
      FROM memories
    `);
    return stmt.all() as any[];
  }

  /**
   * Pin a memory so it always appears at the top of search results.
   *
   * @param db - SQLite database handle
   * @param memoryId - ID of the memory to pin
   */
  pinMemory(db: DatabaseType, memoryId: string): void {
    const stmt = db.prepare(`UPDATE memories SET is_pinned = 1 WHERE id = ?`);
    stmt.run(memoryId);
  }

  /**
   * Unpin a memory, returning it to normal ranking.
   *
   * @param db - SQLite database handle
   * @param memoryId - ID of the memory to unpin
   */
  unpinMemory(db: DatabaseType, memoryId: string): void {
    const stmt = db.prepare(`UPDATE memories SET is_pinned = 0 WHERE id = ?`);
    stmt.run(memoryId);
  }

  async rebuildIndexForShard(
    db: DatabaseType,
    scope: string,
    scopeHash: string,
    shardIndex: number
  ): Promise<void> {
    const backend = await this.getBackend();
    const shard = {
      id: 0,
      scope: scope as "user" | "project",
      scopeHash,
      shardIndex,
      dbPath: "",
      vectorCount: 0,
      isActive: true,
      createdAt: Date.now(),
    };
    await backend.rebuildFromShard({ db, shard, kind: "content" });
    await backend.rebuildFromShard({ db, shard, kind: "tags" });
  }

  async deleteShardIndexes(shard: ShardInfo): Promise<void> {
    const backend = await this.getBackend();
    await backend.deleteShardIndexes({ shard });
  }
}

export const vectorSearch = new VectorSearch();
