import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";

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

        const contentMap = new Map<string, any[]>();
        for (const memory of memories) {
          const key = `${memory.container_tag}:${memory.content}`;
          if (!contentMap.has(key)) {
            contentMap.set(key, []);
          }
          const arr = contentMap.get(key);
          if (arr) arr.push(memory);
        }
        const uniqueMemories = Array.from(contentMap.values()).map((arr) => arr[0]);

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

  private _parseVectorBuffer(rawVector: any): Float32Array | null {
    try {
      const buf = new Uint8Array(rawVector);
      if (buf.byteLength % 4 !== 0) throw new Error("Invalid vector alignment");
      return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch {
      return null;
    }
  }

  private _deleteExactDuplicates(memories: any[], db: any, shard: any): number {
    const contentMap = new Map<string, any[]>();
    for (const memory of memories) {
      const key = `${memory.container_tag}:${memory.content}`;
      if (!contentMap.has(key)) {
        contentMap.set(key, []);
      }
      const arr = contentMap.get(key);
      if (arr) arr.push(memory);
    }

    let exactDeleted = 0;
    for (const [, duplicates] of contentMap) {
      if (duplicates.length > 1) {
        duplicates.sort((a, b) => Number(b.created_at) - Number(a.created_at));
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

  private _findNearDuplicates(uniqueMemories: any[], shard: any): DuplicateGroup[] {
    const processedIds = new Set<string>();
    let comparisonCount = 0;
    const MAX_COMPARISONS = 100_000;
    const nearDuplicateGroups: DuplicateGroup[] = [];

    for (let i = 0; i < uniqueMemories.length; i++) {
      const mem1 = uniqueMemories[i];
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

        const similarity = this.cosineSimilarity(vector1, vector2);
        if (similarity >= CONFIG.deduplicationSimilarityThreshold && similarity < 1.0) {
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

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private _parseMetadata(candidate: any): Record<string, unknown> {
    if (candidate.metadata && typeof candidate.metadata === "string") {
      try {
        return JSON.parse(candidate.metadata) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return (candidate.metadata as Record<string, unknown>) ?? {};
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
    candidates: any[],
    threshold: number
  ): { candidate: any; similarity: number } | null {
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

      const similarity = this.cosineSimilarity(vector, candidateVector);
      if (similarity >= threshold) {
        return { candidate, similarity };
      }
    }
    return null;
  }

  checkDuplicateAtIngest(
    content: string,
    containerTag: string,
    vector: Float32Array,
    metadata?: Record<string, unknown>
  ): { isDuplicate: boolean; existingId?: string; merged?: boolean } {
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

    const threshold = CONFIG.deduplicationSimilarityThreshold ?? 0.92;
    const match = this._findSimilarCandidate(vector, candidates, threshold);
    if (!match) {
      return { isDuplicate: false };
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
