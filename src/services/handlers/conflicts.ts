import { getAllShards } from "../sqlite/shard-manager.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { log } from "../logger.js";
import { safeToISOString } from "../utils/safe-transforms.js";
import { mapDbRowToConflict } from "../utils/memory-mapper.js";
import {
  getAllConflicts,
  getAllUnresolvedConflicts,
  resolveConflict,
} from "../memory-conflicts.js";
import type { ApiResponse, FormattedConflict } from "./shared-types.js";

/** Raw joined conflict-row shape (memory_conflicts + m1/m2 memory content). */
type ConflictJoinRow = {
  id: string;
  memory_id_1: string;
  memory_id_2: string;
  similarity_score: number;
  detected_at: number;
  resolved: number;
  resolution_type?: string;
  resolved_at?: number;
  resolution_data?: string;
  container_tag?: string;
  m1_content?: string;
  m2_content?: string;
};

export const handleListConflicts = (
  resolved = false,
  limit = 100
): ApiResponse<FormattedConflict[]> => {
  try {
    const conflicts = getAllConflicts(resolved, limit);
    const formatted = conflicts.map((conflict) => ({
      id: conflict.id,
      memoryId1: conflict.memoryId1,
      memoryId2: conflict.memoryId2,
      memory1Content: conflict.memory1Content,
      memory2Content: conflict.memory2Content,
      similarityScore: conflict.similarityScore,
      detectedAt: safeToISOString(conflict.detectedAt),
      resolved: conflict.resolved === 1,
      resolutionType: conflict.resolutionType,
      resolvedAt: conflict.resolvedAt != null ? safeToISOString(conflict.resolvedAt) : undefined,
    }));
    return { success: true, data: formatted };
  } catch (error) {
    log("handleListConflicts: error", { error: String(error) });
    return { success: false, error: "Internal error in handleListConflicts" };
  }
};

export const handleResolveConflict = async (
  conflictId: string,
  strategy: string,
  mergedContent?: string
): Promise<ApiResponse<{ mergedMemoryId?: string }>> => {
  try {
    if (!conflictId || !strategy) {
      return { success: false, error: "conflictId and strategy are required" };
    }

    const validStrategies = ["keep_newer", "keep_both", "merge", "manual"];
    if (!validStrategies.includes(strategy)) {
      return {
        success: false,
        error: `Invalid strategy. Must be one of: ${validStrategies.join(", ")}`,
      };
    }

    const result = await resolveConflict(
      conflictId,
      strategy as "keep_newer" | "keep_both" | "merge" | "manual",
      mergedContent
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, data: { mergedMemoryId: result.mergedMemoryId } };
  } catch (error) {
    log("handleResolveConflict: error", { error: String(error) });
    return { success: false, error: "Internal error in handleResolveConflict" };
  }
};

export const handleGetConflict = (conflictId: string): ApiResponse<FormattedConflict> => {
  try {
    if (!conflictId) return { success: false, error: "conflictId is required" };
    const shards = getAllShards();
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db
        .prepare(
          `
          SELECT c.*, m1.content as m1_content, m2.content as m2_content
          FROM memory_conflicts c
          LEFT JOIN memories m1 ON c.memory_id_1 = m1.id
          LEFT JOIN memories m2 ON c.memory_id_2 = m2.id
          WHERE c.id = ?
          LIMIT 1
        `
        )
        .get(conflictId) as ConflictJoinRow | undefined;
      if (row) {
        const conflict = mapDbRowToConflict(row);
        return {
          success: true,
          data: {
            id: conflict.id,
            memoryId1: conflict.memoryId1,
            memoryId2: conflict.memoryId2,
            memory1Content: row.m1_content,
            memory2Content: row.m2_content,
            similarityScore: conflict.similarityScore,
            detectedAt: safeToISOString(conflict.detectedAt),
            resolved: conflict.resolved === 1,
            resolutionType: conflict.resolutionType,
            resolvedAt:
              conflict.resolvedAt != null ? safeToISOString(conflict.resolvedAt) : undefined,
          },
        };
      }
    }
    return { success: false, error: "Conflict not found" };
  } catch (error) {
    log("handleGetConflict: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetConflict" };
  }
};

export const handleConflictStats = (): ApiResponse<{ unresolved: number; resolved: number }> => {
  try {
    const unresolved = getAllUnresolvedConflicts(1000);
    // Count resolved across all shards
    let resolved = 0;
    const shards = getAllShards();
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db
        .prepare("SELECT COUNT(*) as count FROM memory_conflicts WHERE resolved = 1")
        .get() as { count: number } | undefined;
      resolved += row?.count || 0;
    }
    return { success: true, data: { unresolved: unresolved.length, resolved } };
  } catch (error) {
    log("handleConflictStats: error", { error: String(error) });
    return { success: false, error: "Internal error in handleConflictStats" };
  }
};
