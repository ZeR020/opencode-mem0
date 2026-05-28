import { type Database } from "./sqlite-bootstrap.js";
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

interface SearchWithMultiplierOptions {
  shard: ShardInfo;
  queryVector: Float32Array | null;
  containerTag: string;
  limit: number;
  overFetchMultiplier: number;
  queryText?: string;
  context?: RetrievalContext;
  providedDb?: Database;
}

interface SearchAcrossShardsOptions {
  shards: ShardInfo[];
  queryVector: Float32Array | null;
  containerTag: string;
  limit: number;
  similarityThreshold: number;
  queryText?: string;
  context?: RetrievalContext;
  embeddingDegraded?: boolean;
}

function toBlob(vector?: Float32Array): Uint8Array | null {
  return vector ? new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength) : null;
}

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log("Corrupt metadata for memory", { raw: raw.substring(0, 100) });
    return undefined;
  }
}

function recordToInsertParams(record: MemoryRecord): unknown[] {
  return [
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
    record.frequencyScore ?? 0,
    record.importanceScore ?? 0.5,
    record.utilityScore ?? 0.3,
    record.noveltyScore ?? 0.5,
    record.confidenceScore ?? 0.7,
    record.interferencePenalty ?? 0,
    record.strength ?? 0.5,
    record.accessCount ?? 0,
    record.lastAccessed || null,
    record.storeType || "stm",
    record.decayRate ?? 0.05,
  ];
}

const MEMORIES_INSERT_SQL = `
  INSERT INTO memories (
    id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
    metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url,
    recency_score, frequency_score, importance_score, utility_score, novelty_score,
    confidence_score, interference_penalty, strength, access_count, last_accessed,
    store_type, decay_rate
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export class VectorSearch {
  private readonly backendPromise: Promise<VectorBackend>;
  private readonly fallbackBackend: VectorBackend;
  private readonly stmtCache = new WeakMap<Database, Map<string, any>>();
  private readonly wordSetCache = new Map<string, Set<string>>();
  private readonly MAX_WORDSET_CACHE = 1000;

  // NOSONAR S7059: Async backend initialization via stored Promise — static factory
  // would break the module-level singleton export used across 10+ call sites.
  constructor(backend?: VectorBackend, fallbackBackend: VectorBackend = new ExactScanBackend()) {
    this.backendPromise = backend
      ? Promise.resolve(backend)
      : createVectorBackend({ vectorBackend: CONFIG.vectorBackend });
    this.fallbackBackend = fallbackBackend;
  }

  private setWordSet(key: string, value: Set<string>): void {
    this.wordSetCache.set(key, value);
    if (this.wordSetCache.size > this.MAX_WORDSET_CACHE) {
      const firstKey = this.wordSetCache.keys().next().value;
      if (firstKey !== undefined) {
        this.wordSetCache.delete(firstKey);
      }
    }
  }

  private getStmt(db: Database, sql: string): any {
    let dbCache = this.stmtCache.get(db);
    if (!dbCache) {
      dbCache = new Map();
      this.stmtCache.set(db, dbCache);
    }
    let stmt = dbCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      dbCache.set(sql, stmt);
    }
    return stmt;
  }

  private getBackend(): Promise<VectorBackend> {
    return this.backendPromise;
  }

  async insertVector(db: Database, record: MemoryRecord, shard?: ShardInfo): Promise<void> {
    const insertMemory = this.getStmt(db, MEMORIES_INSERT_SQL);

    db.run("BEGIN IMMEDIATE");
    try {
      insertMemory.run(...recordToInsertParams(record));

      if (shard) {
        const backend = await this.getBackend();
        await backend.insert({ id: record.id, vector: record.vector, shard, kind: "content" });
        if (record.tagsVector) {
          await backend.insert({ id: record.id, vector: record.tagsVector, shard, kind: "tags" });
        }
      }

      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("Rollback failed", { error: String(rollbackErr) });
      }
      throw error;
    }
  }

  async batchInsertVectors(
    db: Database,
    records: MemoryRecord[],
    shard?: ShardInfo
  ): Promise<void> {
    if (records.length === 0) return;

    if (!shard) {
      for (const record of records) {
        await this.insertVector(db, record);
      }
      return;
    }

    for (const record of records) {
      connectionManager.batchWrite(shard.dbPath, MEMORIES_INSERT_SQL, recordToInsertParams(record));
    }

    connectionManager.flushBatch(shard.dbPath);

    const backend = await this.getBackend();
    const insertPromises: Promise<void>[] = [];
    for (const record of records) {
      insertPromises.push(
        Promise.resolve(
          backend.insert({ id: record.id, vector: record.vector, shard, kind: "content" })
        )
      );
      if (record.tagsVector) {
        insertPromises.push(
          Promise.resolve(
            backend.insert({ id: record.id, vector: record.tagsVector, shard, kind: "tags" })
          )
        );
      }
    }
    try {
      await Promise.all(insertPromises);
    } catch (error) {
      log("Batch vector backend indexing error", {
        error: String(error),
        recordCount: records.length,
        shardId: shard.id,
      });
    }
  }

  private static readonly MIN_OVER_FETCH = 1.5;
  private static readonly MAX_OVER_FETCH = 8;
  private static readonly TARGET_FILL_RATIO = 0.85;
  private static readonly BASE_MULTIPLIER = 2;

  // NOSONAR S3776: FTS5 search with query sanitization, tokenization, and LIKE fallback
  // is inherently complex — decomposition would fragment the search pipeline.
  private searchFTS5(db: Database, queryText: string | undefined, limit: number): string[] {
    if (!queryText || queryText.length === 0) return [];

    const safeFtsQuery = queryText
      .replace(/[*^:\-+?()"]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    if (safeFtsQuery.length === 0) return [];

    try {
      const ftsRows = db
        .prepare(
          `
        SELECT id FROM memories_fts
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
        )
        .all(safeFtsQuery, limit * 2) as any[];
      return ftsRows.map((r: any) => r.id);
    } catch {
      try {
        const likeRows = db
          .prepare(
            `
          SELECT id FROM memories
          WHERE content LIKE ? AND is_deprecated = 0
          LIMIT ?
        `
          )
          .all(`%${queryText}%`, limit * 2) as any[];
        return likeRows.map((r: any) => r.id);
      } catch {
        return [];
      }
    }
  }

  // NOSONAR S3776: Multi-factor scoring (vector + FTS5 + context boost + diversity penalty)
  // is inherently complex — decomposition would break cross-factor scoring consistency.
  private hydrateAndScoreResults(
    rows: any[],
    scoreMap: Map<string, { contentSim: number; tagsSim: number }>,
    ftsResults: string[],
    queryText: string | undefined,
    context?: RetrievalContext
  ): SearchResult[] {
    const queryWords = queryText
      ? queryText
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((w) => w.length > 1)
      : [];

    const hydratedResults: SearchResult[] = rows.map((row: any) => {
      const scores = scoreMap.get(row.id) ?? { contentSim: 0, tagsSim: 0 };
      const memoryTagsStr = row.tags || "";
      const memoryTags = memoryTagsStr.split(",").map((t: string) => t.trim().toLowerCase());

      let exactMatchBoost = 0;
      if (queryWords.length > 0 && memoryTags.length > 0) {
        const matches = queryWords.filter((w) =>
          memoryTags.some((t: string) => t.includes(w) || w.includes(t))
        ).length;
        exactMatchBoost = matches / Math.max(queryWords.length, 1);
      }

      const ftsBoost = ftsResults.includes(row.id) ? 0.1 : 0;
      const finalTagsSim = Math.max(scores.tagsSim, exactMatchBoost);
      const vectorSimilarity = scores.contentSim * 0.6 + finalTagsSim * 0.4 + ftsBoost;

      const strength = row.strength ?? 0.5;
      const recencyScore = row.recency_score ?? 0.5;

      const strengthWeight = strength * 0.4;
      const recencyWeight = recencyScore * 0.3;
      const vectorWeight = vectorSimilarity * 0.3;
      const similarity = strengthWeight + recencyWeight + vectorWeight;

      let contextBoost = 1;
      if (context) {
        contextBoost = calculateContextBoost(
          {
            projectPath: row.project_path,
            projectName: row.project_name,
            metadata: safeParseMetadata(row.metadata),
          },
          context
        );
      }

      return {
        id: row.id,
        memory: row.content,
        similarity: similarity * contextBoost,
        tags: memoryTagsStr ? memoryTagsStr.split(",") : [],
        metadata: safeParseMetadata(row.metadata),
        containerTag: row.container_tag,
        displayName: row.display_name,
        userName: row.user_name,
        userEmail: row.user_email,
        projectPath: row.project_path,
        projectName: row.project_name,
        gitRepoUrl: row.git_repo_url,
        isPinned: row.is_pinned,
        type: row.type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        strength: row.strength,
        recencyScore: row.recency_score,
        importanceScore: row.importance_score,
        accessCount: row.access_count,
        vectorSimilarity,
        recencyWeight,
        strengthWeight,
        contextBoost,
        finalScore: similarity * contextBoost,
      };
    });

    hydratedResults.sort((a, b) => {
      if ((a.isPinned || 0) !== (b.isPinned || 0)) {
        return (b.isPinned || 0) - (a.isPinned || 0);
      }
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

    return hydratedResults;
  }

  private updateAccessCounts(db: Database, results: SearchResult[]): void {
    try {
      const updateAccessStmt = db.prepare(
        "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?"
      );
      const now = Date.now();
      for (const result of results) {
        updateAccessStmt.run(now, result.id);
      }
    } catch (error) {
      log("Failed to update access count", { error: String(error) });
    }
  }

  async searchWithMultiplier(options: SearchWithMultiplierOptions): Promise<SearchResult[]> {
    const {
      shard,
      queryVector,
      containerTag,
      limit,
      overFetchMultiplier,
      queryText,
      context,
      providedDb,
    } = options;
    const db = providedDb || connectionManager.getConnection(shard.dbPath);
    const backend = await this.getBackend();
    let contentResults: { id: string; distance: number }[] = [];
    let tagsResults: { id: string; distance: number }[] = [];
    let embeddingDegraded = false;

    const searchLimit = Math.ceil(limit * overFetchMultiplier);

    if (queryVector) {
      try {
        await backend.rebuildFromShard({ db, shard, kind: "content" });
        await backend.rebuildFromShard({ db, shard, kind: "tags" });

        contentResults = await backend.search({
          db,
          shard,
          kind: "content",
          queryVector,
          limit: searchLimit,
        });
        tagsResults = await backend.search({
          db,
          shard,
          kind: "tags",
          queryVector,
          limit: searchLimit,
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
          limit: searchLimit,
        });
        tagsResults = await this.fallbackBackend.search({
          db,
          shard,
          kind: "tags",
          queryVector,
          limit: searchLimit,
        });
      }
    } else {
      embeddingDegraded = true;
      contentResults = [];
      tagsResults = [];
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

    const ftsResults = this.searchFTS5(db, queryText, limit);
    const ids = Array.from(new Set([...scoreMap.keys(), ...ftsResults]));

    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        containerTag === ""
          ? `SELECT * FROM memories WHERE id IN (${placeholders}) AND is_deprecated = 0`
          : `SELECT * FROM memories WHERE id IN (${placeholders}) AND container_tag = ? AND is_deprecated = 0`
      )
      .all(...ids, ...(containerTag === "" ? [] : [containerTag])) as any[];

    const hydratedResults = this.hydrateAndScoreResults(
      rows,
      scoreMap,
      ftsResults,
      queryText,
      context
    );

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

      const penalizedScore = (candidate.finalScore || 0) * (1 - penalty);

      if (penalizedScore > 0.01 || diverseResults.length < limit / 2) {
        diverseResults.push(candidate);
      }
    }

    this.updateAccessCounts(db, diverseResults);

    return diverseResults;
  }

  async searchInShard(
    shard: ShardInfo,
    queryVector: Float32Array | null,
    containerTag: string,
    limit: number,
    queryText?: string,
    context?: RetrievalContext
  ): Promise<SearchResult[]> {
    let finalResults = await this.searchWithMultiplier({
      shard,
      queryVector,
      containerTag,
      limit,
      overFetchMultiplier: VectorSearch.BASE_MULTIPLIER,
      queryText,
      context,
    });

    if (finalResults.length < limit * VectorSearch.TARGET_FILL_RATIO && queryVector !== null) {
      const retryMultiplier = Math.min(
        VectorSearch.MAX_OVER_FETCH,
        VectorSearch.BASE_MULTIPLIER * 2
      );
      finalResults = await this.searchWithMultiplier({
        shard,
        queryVector,
        containerTag,
        limit,
        overFetchMultiplier: retryMultiplier,
        queryText,
        context,
      });
    }

    return finalResults;
  }

  async searchAcrossShards(options: SearchAcrossShardsOptions): Promise<SearchResult[]> {
    const {
      shards,
      queryVector,
      containerTag,
      limit,
      similarityThreshold,
      queryText,
      context,
      embeddingDegraded = false,
    } = options;
    const maxSearchMs = 30000;
    const deadline = Date.now() + maxSearchMs;

    const resultsArray = await Promise.all(
      shards.map(async (shard) => {
        if (Date.now() > deadline) {
          log("Shard search deadline exceeded", { shardId: shard.id });
          return [];
        }
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
      })
    );

    const allResults = resultsArray.flat();

    allResults.sort((a, b) => {
      if ((a.isPinned || 0) !== (b.isPinned || 0)) {
        return (b.isPinned || 0) - (a.isPinned || 0);
      }
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

    const diversityThreshold = CONFIG.retrieval.diversityThreshold || 0.9;
    const finalResults: SearchResult[] = [];
    const maxResults = CONFIG.retrieval.maxResults || limit;

    const getWordSet = (text: string): Set<string> => {
      let set = this.wordSetCache.get(text);
      if (!set) {
        set = new Set(
          (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 4)
        );
        this.setWordSet(text, set);
      }
      return set;
    };

    for (const candidate of allResults) {
      if (finalResults.length >= maxResults) break;

      let isDiverse = true;
      const candidateWords = getWordSet(candidate.memory);
      for (const selected of finalResults) {
        const selectedWords = getWordSet(selected.memory);
        const [smaller, larger] =
          candidateWords.size <= selectedWords.size
            ? [candidateWords, selectedWords]
            : [selectedWords, candidateWords];
        let intersectionSize = 0;
        for (const word of smaller) {
          if (larger.has(word)) intersectionSize++;
        }
        const unionSize = candidateWords.size + selectedWords.size - intersectionSize;
        const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

        if (jaccard > diversityThreshold) {
          isDiverse = false;
          break;
        }
      }

      if (isDiverse || finalResults.length < maxResults / 2) {
        finalResults.push(candidate);
      }
    }

    if (embeddingDegraded) return finalResults;
    return finalResults.filter((r) => r.similarity >= similarityThreshold);
  }

  async deleteVector(db: Database, memoryId: string, shard?: ShardInfo): Promise<void> {
    this.getStmt(db, "DELETE FROM memories WHERE id = ?").run(memoryId);

    if (shard) {
      const backend = await this.getBackend();
      await backend.delete({ id: memoryId, shard, kind: "content" });
      await backend.delete({ id: memoryId, shard, kind: "tags" });
    }
  }

  async updateVector(
    db: Database,
    memoryId: string,
    vector: Float32Array,
    shard?: ShardInfo,
    tagsVector?: Float32Array
  ): Promise<void> {
    db.run("BEGIN IMMEDIATE");
    try {
      this.getStmt(db, "UPDATE memories SET vector = ?, tags_vector = ? WHERE id = ?").run(
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

      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("Rollback failed", { error: String(rollbackErr) });
      }
      throw error;
    }
  }

  async replaceVector(
    db: Database,
    memoryId: string,
    record: MemoryRecord,
    shard?: ShardInfo
  ): Promise<void> {
    const insertMemory = this.getStmt(db, MEMORIES_INSERT_SQL);

    db.run("BEGIN IMMEDIATE");
    try {
      this.getStmt(db, "DELETE FROM memories WHERE id = ?").run(memoryId);
      insertMemory.run(...recordToInsertParams(record));

      if (shard) {
        const backend = await this.getBackend();
        await backend.delete({ id: memoryId, shard, kind: "content" });
        await backend.delete({ id: memoryId, shard, kind: "tags" });
        await backend.insert({ id: record.id, vector: record.vector, shard, kind: "content" });
        if (record.tagsVector) {
          await backend.insert({ id: record.id, vector: record.tagsVector, shard, kind: "tags" });
        }
      }

      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("Rollback failed", { error: String(rollbackErr) });
      }
      throw error;
    }
  }

  listMemories(db: Database, containerTag: string, limit: number): any[] {
    const sql =
      containerTag === ""
        ? "SELECT * FROM memories WHERE is_deprecated = 0 ORDER BY is_pinned DESC, strength DESC, recency_score DESC LIMIT ?"
        : "SELECT * FROM memories WHERE container_tag = ? AND is_deprecated = 0 ORDER BY is_pinned DESC, strength DESC, recency_score DESC LIMIT ?";
    const stmt = this.getStmt(db, sql);
    return (containerTag === "" ? stmt.all(limit) : stmt.all(containerTag, limit)) as any[];
  }

  getAllMemories(db: Database): any[] {
    return this.getStmt(
      db,
      "SELECT * FROM memories WHERE is_deprecated = 0 ORDER BY created_at DESC"
    ).all() as any[];
  }

  getMemoryById(db: Database, memoryId: string): any {
    return this.getStmt(db, "SELECT * FROM memories WHERE id = ?").get(memoryId);
  }

  private mapRowToResult(row: any): any {
    return {
      ...row,
      tags: row.tags ? row.tags.split(",") : [],
      metadata: safeParseMetadata(row.metadata) || {},
    };
  }

  getMemoriesBySessionID(db: Database, sessionID: string): any[] {
    try {
      const stmt = this.getStmt(
        db,
        `
        SELECT * FROM memories
        WHERE json_extract(metadata, '$.sessionID') = ? AND is_deprecated = 0
        ORDER BY created_at DESC
      `
      );
      const rows = stmt.all(sessionID) as any[];
      return rows.map((row: any) => this.mapRowToResult(row));
    } catch {
      const likeEscaped = sessionID.replace(/[\\%_]/g, String.raw`\$&`);
      const likeStmt = this.getStmt(
        db,
        `
        SELECT * FROM memories
        WHERE metadata LIKE ? ESCAPE '\' AND is_deprecated = 0
        ORDER BY created_at DESC
      `
      );
      const rows = likeStmt.all(`%"sessionID":"${likeEscaped}"%`) as any[];
      return rows.map((row: any) => this.mapRowToResult(row));
    }
  }

  countVectors(db: Database, containerTag: string): number {
    const result = this.getStmt(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE container_tag = ? AND is_deprecated = 0"
    ).get(containerTag);
    return result.count;
  }

  countAllVectors(db: Database): number {
    const result = this.getStmt(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE is_deprecated = 0"
    ).get() as any;
    return result.count;
  }

  getDistinctTags(db: Database): any[] {
    return this.getStmt(
      db,
      `
      SELECT DISTINCT
        container_tag, display_name, user_name, user_email, project_path, project_name, git_repo_url
      FROM memories
    `
    ).all() as any[];
  }

  pinMemory(db: Database, memoryId: string): void {
    this.getStmt(db, "UPDATE memories SET is_pinned = 1 WHERE id = ?").run(memoryId);
  }

  unpinMemory(db: Database, memoryId: string): void {
    this.getStmt(db, "UPDATE memories SET is_pinned = 0 WHERE id = ?").run(memoryId);
  }

  async rebuildIndexForShard(
    db: Database,
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
