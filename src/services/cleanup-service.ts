import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { ShardInfo } from "./sqlite/types.js";
import { userPromptManager } from "./user-prompt/user-prompt-manager.js";

interface CleanupResult {
  deletedCount: number;
  userCount: number;
  projectCount: number;
  promptsDeleted: number;
  linkedMemoriesProtected: number;
  pinnedMemoriesSkipped: number;
}

export class CleanupService {
  private lastCleanupTime = 0;
  private isRunning = false;

  shouldRunCleanup(): boolean {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    return CONFIG.autoCleanupEnabled && !this.isRunning && now - this.lastCleanupTime >= oneDayMs;
  }

  private _collectPinnedMemoryIds(allShards: ShardInfo[]): Set<string> {
    const pinnedMemoryIds = new Set<string>();
    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const pinned = db.prepare("SELECT id FROM memories WHERE is_pinned = 1").all() as {
        id: string;
      }[];
      pinned.forEach((row) => pinnedMemoryIds.add(row.id));
    }
    return pinnedMemoryIds;
  }

  private async _cleanupShard(
    shard: ShardInfo,
    cutoffTime: number,
    protectedMemoryIds: Set<string>
  ): Promise<{
    totalDeleted: number;
    userDeleted: number;
    projectDeleted: number;
    linkedMemoriesProtected: number;
    pinnedSkipped: number;
  }> {
    const db = connectionManager.getConnection(shard.dbPath);
    const oldMemories = db
      .prepare("SELECT id, container_tag, is_pinned FROM memories WHERE updated_at < ?")
      .all(cutoffTime) as { id: string; container_tag: string; is_pinned: number }[];

    let totalDeleted = 0;
    let userDeleted = 0;
    let projectDeleted = 0;
    let linkedMemoriesProtected = 0;
    let pinnedSkipped = 0;

    for (const memory of oldMemories) {
      try {
        if (memory.is_pinned === 1) {
          pinnedSkipped++;
          continue;
        }

        if (protectedMemoryIds.has(memory.id)) {
          linkedMemoriesProtected++;
          continue;
        }

        await vectorSearch.deleteVector(db, memory.id, shard);
        shardManager.decrementVectorCount(shard.id);
        totalDeleted++;

        if (memory.container_tag?.includes("_user_")) {
          userDeleted++;
        } else if (memory.container_tag?.includes("_project_")) {
          projectDeleted++;
        }
      } catch (error) {
        log("Cleanup: delete error", { memoryId: memory.id, error: String(error) });
      }
    }

    return { totalDeleted, userDeleted, projectDeleted, linkedMemoriesProtected, pinnedSkipped };
  }

  async runCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      throw new Error("Cleanup already running");
    }

    this.isRunning = true;

    try {
      const cutoffTime = Date.now() - CONFIG.autoCleanupRetentionDays * 24 * 60 * 60 * 1000;

      const allShards = [
        ...shardManager.getAllShards("user", ""),
        ...shardManager.getAllShards("project", ""),
      ];

      const pinnedMemoryIds = this._collectPinnedMemoryIds(allShards);
      const promptCleanupResult = userPromptManager.deleteOldPrompts(cutoffTime);
      const linkedMemoryIds = new Set(promptCleanupResult.linkedMemoryIds);
      const protectedMemoryIds = new Set([...pinnedMemoryIds, ...linkedMemoryIds]);

      let totalDeleted = 0;
      let userDeleted = 0;
      let projectDeleted = 0;
      let linkedMemoriesProtected = 0;
      let pinnedSkipped = 0;

      for (const shard of allShards) {
        const result = await this._cleanupShard(shard, cutoffTime, protectedMemoryIds);
        totalDeleted += result.totalDeleted;
        userDeleted += result.userDeleted;
        projectDeleted += result.projectDeleted;
        linkedMemoriesProtected += result.linkedMemoriesProtected;
        pinnedSkipped += result.pinnedSkipped;
      }

      const promptsDeleted = promptCleanupResult.deleted - linkedMemoryIds.size;

      const result = {
        deletedCount: totalDeleted,
        userCount: userDeleted,
        projectCount: projectDeleted,
        promptsDeleted,
        linkedMemoriesProtected,
        pinnedMemoriesSkipped: pinnedSkipped,
      };
      this.lastCleanupTime = Date.now();
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: CONFIG.autoCleanupEnabled,
      retentionDays: CONFIG.autoCleanupRetentionDays,
      lastCleanupTime: this.lastCleanupTime,
      isRunning: this.isRunning,
    };
  }
}

export const cleanupService = new CleanupService();
