import { getAllShards } from "../sqlite/shard-manager.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { log } from "../logger.js";
import { safeToISOString } from "../utils/safe-transforms.js";
import { getAllUnresolvedConflicts, resolveConflict } from "../memory-conflicts.js";
import type { ApiResponse, FormattedConflict } from "./shared-types.js";

export function handleListConflicts(
  resolved = false,
  limit = 100
): ApiResponse<FormattedConflict[]> {
  try {
    if (resolved) {
      return {
        success: true,
        data: [],
        message: "Resolved conflicts are not yet supported — returning empty list",
      };
    }
    const conflicts = getAllUnresolvedConflicts(limit);
    const formatted = conflicts.map((c) => ({
      id: c.id,
      memoryId1: c.memoryId1,
      memoryId2: c.memoryId2,
      memory1Content: c.memory1Content,
      memory2Content: c.memory2Content,
      similarityScore: c.similarityScore,
      detectedAt: safeToISOString(c.detectedAt),
      resolved: c.resolved === 1,
      resolutionType: c.resolutionType,
    }));
    return { success: true, data: formatted };
  } catch (error) {
    log("handleListConflicts: error", { error: String(error) });
    return { success: false, error: "Internal error in handleListConflicts" };
  }
}

export async function handleResolveConflict(
  conflictId: string,
  strategy: string,
  mergedContent?: string
): Promise<ApiResponse<{ mergedMemoryId?: string }>> {
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
}

export function handleConflictStats(): ApiResponse<{ unresolved: number; resolved: number }> {
  try {
    const unresolved = getAllUnresolvedConflicts(1000);
    // Count resolved across all shards
    let resolved = 0;
    const shards = getAllShards();
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db
        .prepare("SELECT COUNT(*) as count FROM memory_conflicts WHERE resolved = 1")
        .get() as any;
      resolved += row?.count || 0;
    }
    return { success: true, data: { unresolved: unresolved.length, resolved } };
  } catch (error) {
    log("handleConflictStats: error", { error: String(error) });
    return { success: false, error: "Internal error in handleConflictStats" };
  }
}
