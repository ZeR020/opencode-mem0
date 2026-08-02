import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { cosineSimilarity } from "./vector-backends/shared.js";
import { checkContradictionHeuristic } from "./utils/text-analysis.js";
import { checkContradictionVerdict } from "./memory-conflicts.js";
import type { Database } from "./sqlite/sqlite-bootstrap.js";
import type { ShardInfo } from "./sqlite/types.js";

/** Minimal raw memory-row shape read by the dedup scans (snake_case columns). */
type DedupMemoryRow = {
  id: string;
  content: string;
  container_tag: string;
  created_at: number;
  metadata: string | null;
  vector: unknown;
};

interface DuplicateGroup {
  representative: {
    id: string;
    content: string;
    containerTag: string;
    createdAt: number;
  };
  duplicates: Array<{
    id: string;
    content: string;
    similarity: number;
  }>;
}

interface DeduplicationResult {
  exactDuplicatesDeleted: number;
  nearDuplicateGroups: DuplicateGroup[];
}

export class DeduplicationService {
  private isRunning: boolean = false;

  async detectAndRemoveDuplicates(): Promise<DeduplicationResult> {
    if (this.isRunning) {
      throw new Error("Deduplication already running");
    }

    if (!CONFIG.deduplicationEnabled) {
      throw new Error("Deduplication is disabled in config");
    }

    this.isRunning = true;

    try {
      const userShards = shardManager.getAllShards("user", "");
      const projectShards = shardManager.getAllShards("project", "");
      const allShards = [...userShards, ...projectShards];

      let exactDeleted = 0;
      const nearDuplicateGroups: DuplicateGroup[] = [];

      for (const shard of allShards) {
        const db = connectionManager.getConnection(shard.dbPath);
        const memories = vectorSearch.getAllMemories(db);

        const MAX_DEDUP_MEMORIES = 5000;
        if (memories.length > MAX_DEDUP_MEMORIES) {
          log("Deduplication: skipping oversized shard", {
            shardId: shard.id,
            memoryCount: memories.length,
            max: MAX_DEDUP_MEMORIES,
          });
          continue;
        }

        exactDeleted += this._deleteExactDuplicates(memories, db, shard);

        const contentMap = this.buildContentMap(memories);
        // Every group has at least one entry (pushed in buildContentMap).
        const uniqueMemories = Array.from(contentMap.values()).map(
          (group) => group[0] as DedupMemoryRow
        );

        nearDuplicateGroups.push(...this._findNearDuplicates(uniqueMemories, shard));
      }

      return {
        exactDuplicatesDeleted: exactDeleted,
        nearDuplicateGroups,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private _parseVectorBuffer(rawVector: unknown): Float32Array | null {
    try {
      const buf = new Uint8Array(rawVector as ArrayBufferLike);
      if (buf.byteLength % 4 !== 0) throw new Error("Invalid vector alignment");
      return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch {
      return null;
    }
  }

  private buildContentMap(memories: DedupMemoryRow[]): Map<string, DedupMemoryRow[]> {
    const contentMap = new Map<string, DedupMemoryRow[]>();
    for (const memory of memories) {
      const key = `${memory.container_tag}:${memory.content}`;
      if (!contentMap.has(key)) contentMap.set(key, []);
      contentMap.get(key)!.push(memory);
    }
    return contentMap;
  }

  private _deleteExactDuplicates(
    memories: DedupMemoryRow[],
    db: Database,
    shard: ShardInfo
  ): number {
    const contentMap = this.buildContentMap(memories);

    let exactDeleted = 0;
    for (const [, duplicates] of contentMap) {
      if (duplicates.length > 1) {
        duplicates.sort((left, right) => Number(right.created_at) - Number(left.created_at));
        const toDelete = duplicates.slice(1);

        for (const dup of toDelete) {
          try {
            vectorSearch.deleteVector(db, dup.id, shard);
            shardManager.decrementVectorCount(shard.id);
            exactDeleted++;
          } catch (error) {
            log("Deduplication: delete error", {
              memoryId: dup.id,
              error: String(error),
            });
          }
        }
      }
    }
    return exactDeleted;
  }

  private _findNearDuplicates(
    uniqueMemories: DedupMemoryRow[],
    shard: ShardInfo
  ): DuplicateGroup[] {
    const processedIds = new Set<string>();
    let comparisonCount = 0;
    const MAX_COMPARISONS = 100_000;
    const nearDuplicateGroups: DuplicateGroup[] = [];

    for (let i = 0; i < uniqueMemories.length; i++) {
      const mem1 = uniqueMemories[i];
      if (!mem1) continue;
      if (!mem1.vector || processedIds.has(mem1.id)) continue;

      const vector1 = this._parseVectorBuffer(mem1.vector);
      if (!vector1) {
        log("Deduplication: skipping malformed vector", {
          id: mem1.id,
          containerTag: mem1.container_tag,
        });
        continue;
      }

      const similarGroup: DuplicateGroup = {
        representative: {
          id: mem1.id,
          content: mem1.content,
          containerTag: mem1.container_tag,
          createdAt: mem1.created_at,
        },
        duplicates: [],
      };

      for (let j = i + 1; j < uniqueMemories.length; j++) {
        if (comparisonCount >= MAX_COMPARISONS) {
          log("Deduplication: hit max comparisons, stopping early", {
            shardId: shard.id,
            comparisons: comparisonCount,
          });
          break;
        }
        comparisonCount++;
        const mem2 = uniqueMemories[j];
        if (!mem2) continue;
        if (!mem2.vector || processedIds.has(mem2.id)) continue;
        if (mem1.container_tag !== mem2.container_tag) continue;

        const vector2 = this._parseVectorBuffer(mem2.vector);
        if (!vector2) {
          log("Deduplication: skipping malformed vector", {
            id: mem2.id,
            containerTag: mem2.container_tag,
          });
          continue;
        }

        const similarity = cosineSimilarity(vector1, vector2);
        if (similarity >= CONFIG.deduplicationSimilarityThreshold && similarity < 1) {
          similarGroup.duplicates.push({
            id: mem2.id,
            content: mem2.content,
            similarity,
          });
          processedIds.add(mem2.id);
        }
      }

      if (similarGroup.duplicates.length > 0) {
        nearDuplicateGroups.push(similarGroup);
      }
    }

    return nearDuplicateGroups;
  }

  private _parseMetadata(candidate: DedupMemoryRow): Record<string, unknown> {
    if (typeof candidate.metadata === "string") {
      try {
        return JSON.parse(candidate.metadata) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return (candidate.metadata ?? {}) as Record<string, unknown>;
  }

  private _mergeCandidateMetadata(
    existingMetadata: Record<string, unknown>,
    newMetadata: Record<string, unknown>
  ): Record<string, unknown> {
    return newMetadata.source === "manual"
      ? { ...existingMetadata, ...newMetadata }
      : { ...newMetadata, ...existingMetadata };
  }

  private _findSimilarCandidate(
    vector: Float32Array,
    candidates: DedupMemoryRow[],
    threshold: number
  ): { candidate: DedupMemoryRow; similarity: number } | null {
    for (const candidate of candidates) {
      if (!candidate.vector) continue;

      const candidateVector = this._parseVectorBuffer(candidate.vector);
      if (!candidateVector) {
        log("Ingest dedup: skipping malformed vector", {
          id: candidate.id,
          containerTag: candidate.container_tag,
        });
        continue;
      }

      const similarity = cosineSimilarity(vector, candidateVector);
      if (similarity >= threshold) {
        return { candidate, similarity };
      }
    }
    return null;
  }

  async checkDuplicateAtIngest(
    content: string,
    containerTag: string,
    vector: Float32Array,
    metadata?: Record<string, unknown>,
    vettedConflictCandidateId?: string
  ): Promise<{
    isDuplicate: boolean;
    existingId?: string;
    merged?: boolean;
    conflictCandidateId?: string;
    conflictSimilarity?: number;
  }> {
    if (!CONFIG.deduplicationIngestEnabled) {
      return { isDuplicate: false };
    }

    const parts = containerTag.split("_");
    const scope = (parts.length >= 3 ? parts[1] : "user") as "user" | "project";
    const hash = parts.slice(2).join("_");

    const shard = shardManager.getAllShards(scope, hash)[0];
    if (!shard) {
      return { isDuplicate: false };
    }

    const db = connectionManager.getConnection(shard.dbPath);
    const candidates = vectorSearch.listMemories(db, containerTag, 50);
    if (candidates.length === 0) {
      return { isDuplicate: false };
    }

    const threshold = CONFIG.deduplicationSimilarityThreshold ?? 0.9;
    const match = this._findSimilarCandidate(vector, candidates, threshold);
    if (!match) {
      return { isDuplicate: false };
    }

    // C5/R1: a near-duplicate pair with asymmetric negation/substitution is a
    // contradiction, not a duplicate. Merging it would silently drop the new
    // statement and the conflict would never be recorded. The tri-state LLM
    // verdict decides: "yes" → skip the merge and surface the pair as a
    // conflict candidate; "no" → the heuristic was a false positive, proceed
    // with the normal merge; "unknown" (provider outage) → preserve the
    // pre-delta dedup behavior and merge rather than recording conflict rows
    // for every heuristic-positive pair during an outage.
    if (checkContradictionHeuristic(content, match.candidate.content)) {
      // V4: the first (pre-lock) check already vetted this exact pair — the
      // locked recheck must not pay a second LLM round-trip for the same
      // candidate; the verdict is reused as-is.
      if (match.candidate.id === vettedConflictCandidateId) {
        log("Ingest dedup: recheck reuse — candidate already vetted", {
          existingId: match.candidate.id,
          containerTag,
          similarity: match.similarity,
        });
        return {
          isDuplicate: false,
          conflictCandidateId: match.candidate.id,
          conflictSimilarity: match.similarity,
        };
      }

      const verdict = await checkContradictionVerdict(
        content,
        match.candidate.content,
        metadata?.sessionID as string | undefined
      );
      if (verdict === "yes") {
        log("Ingest dedup: merge skipped — contradiction confirmed", {
          existingId: match.candidate.id,
          containerTag,
          similarity: match.similarity,
          content: content.slice(0, 80),
        });
        return {
          isDuplicate: false,
          conflictCandidateId: match.candidate.id,
          conflictSimilarity: match.similarity,
        };
      }
      if (verdict === "unknown") {
        log("Ingest dedup: contradiction verdict unavailable — merging (provider outage)", {
          existingId: match.candidate.id,
          containerTag,
          similarity: match.similarity,
        });
      } else {
        log("Ingest dedup: contradiction heuristic vetoed by LLM — merging", {
          existingId: match.candidate.id,
          containerTag,
          similarity: match.similarity,
        });
      }
    }

    const existingMetadata = this._parseMetadata(match.candidate);
    const newMetadata = metadata ?? {};
    const mergedMetadata = this._mergeCandidateMetadata(existingMetadata, newMetadata);

    const updateStmt = db.prepare(`
      UPDATE memories
      SET access_count = access_count + 1,
          updated_at = ?,
          metadata = ?
      WHERE id = ?
    `);
    updateStmt.run(Date.now(), JSON.stringify(mergedMetadata), match.candidate.id);

    log("Ingest dedup: merged near-duplicate memory", {
      existingId: match.candidate.id,
      containerTag,
      similarity: match.similarity,
      content: content.slice(0, 80),
    });

    return { isDuplicate: true, existingId: match.candidate.id, merged: true };
  }

  getStatus() {
    return {
      enabled: CONFIG.deduplicationEnabled,
      threshold: CONFIG.deduplicationSimilarityThreshold,
      isRunning: this.isRunning,
    };
  }
}

export const deduplicationService = new DeduplicationService();
