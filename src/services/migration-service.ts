import { shardManager } from "./sqlite/shard-manager.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { embeddingService } from "./embedding.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { ShardInfo } from "./sqlite/types.js";

export interface DimensionMismatch {
  needsMigration: boolean;
  configDimensions: number;
  configModel: string;
  shardMismatches: Array<{
    shardId: number;
    dbPath: string;
    storedDimensions: number;
    storedModel: string;
    vectorCount: number;
  }>;
}

export interface MigrationProgress {
  phase: "preparing" | "re-embedding" | "cleanup" | "complete";
  processed: number;
  total: number;
  currentShard?: string;
}

export interface MigrationResult {
  success: boolean;
  strategy: "fresh-start" | "re-embed";
  deletedShards: number;
  reEmbeddedMemories: number;
  duration: number;
  error?: string;
}

class MigrationService {
  private isRunning = false;
  private progressCallback?: (progress: MigrationProgress) => void;

  detectDimensionMismatch(): DimensionMismatch {
    const allShards = [
      ...shardManager.getAllShards("user", ""),
      ...shardManager.getAllShards("project", ""),
    ];

    const mismatches: DimensionMismatch["shardMismatches"] = [];

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);

        const metadataResult = db
          .prepare(
            `
          SELECT key, value FROM shard_metadata 
          WHERE key IN ('embedding_dimensions', 'embedding_model')
        `
          )
          .all() as Array<{ key: string; value: string }>;

        const metadata = Object.fromEntries(metadataResult.map((row) => [row.key, row.value]));

        const storedDimensions = Number.parseInt(metadata.embedding_dimensions || "0", 10);
        const storedModel = metadata.embedding_model || "unknown";

        if (
          storedDimensions !== CONFIG.embeddingDimensions ||
          storedModel !== CONFIG.embeddingModel
        ) {
          const vectorCount = vectorSearch.countAllVectors(db);

          mismatches.push({
            shardId: shard.id,
            dbPath: shard.dbPath,
            storedDimensions,
            storedModel,
            vectorCount,
          });
        }
      } catch (error) {
        log("Migration: error checking shard", {
          shardId: shard.id,
          error: String(error),
        });
      }
    }

    return {
      needsMigration: mismatches.length > 0,
      configDimensions: CONFIG.embeddingDimensions,
      configModel: CONFIG.embeddingModel,
      shardMismatches: mismatches,
    };
  }

  async migrateToNewModel(
    strategy: "fresh-start" | "re-embed",
    progressCallback?: (progress: MigrationProgress) => void
  ): Promise<MigrationResult> {
    if (this.isRunning) {
      throw new Error("Migration already running");
    }

    this.isRunning = true;
    this.progressCallback = progressCallback;
    const startTime = Date.now();

    try {
      const mismatch = this.detectDimensionMismatch();

      if (!mismatch.needsMigration) {
        return {
          success: true,
          strategy,
          deletedShards: 0,
          reEmbeddedMemories: 0,
          duration: Date.now() - startTime,
        };
      }

      if (strategy === "fresh-start") {
        return await this.freshStartMigration(mismatch, startTime);
      }
      return await this.reEmbedMigration(mismatch, startTime);
    } catch (error) {
      log("Migration: failed", { error: String(error) });
      return {
        success: false,
        strategy,
        deletedShards: 0,
        reEmbeddedMemories: 0,
        duration: Date.now() - startTime,
        error: String(error),
      };
    } finally {
      this.isRunning = false;
      this.progressCallback = undefined;
    }
  }

  private async freshStartMigration(
    mismatch: DimensionMismatch,
    startTime: number
  ): Promise<MigrationResult> {
    this.reportProgress({
      phase: "preparing",
      processed: 0,
      total: mismatch.shardMismatches.length,
    });

    let deletedShards = 0;

    for (const [index, shardInfo] of mismatch.shardMismatches.entries()) {
      try {
        this.reportProgress({
          phase: "cleanup",
          processed: index,
          total: mismatch.shardMismatches.length,
          currentShard: String(shardInfo.shardId),
        });

        await shardManager.deleteShard(shardInfo.shardId);
        deletedShards++;
      } catch (error) {
        log("Migration: error deleting shard", {
          shardId: shardInfo.shardId,
          error: String(error),
        });
      }
    }

    this.reportProgress({
      phase: "complete",
      processed: mismatch.shardMismatches.length,
      total: mismatch.shardMismatches.length,
    });

    const expected = mismatch.shardMismatches.length;
    const success = deletedShards === expected;
    return {
      success,
      strategy: "fresh-start",
      deletedShards,
      reEmbeddedMemories: 0,
      duration: Date.now() - startTime,
      ...(success ? {} : { error: "Failed to delete one or more shards" }),
    };
  }

  private _backupMemories(memories: any[]): Array<{
    id: string;
    content: string;
    containerTag: string;
    type: string | null;
    createdAt: number;
    updatedAt: number;
    metadata: string | null;
    displayName: string | null;
    userName: string | null;
    userEmail: string | null;
    projectPath: string | null;
    projectName: string | null;
    gitRepoUrl: string | null;
    isPinned: number;
  }> {
    return memories.map((memory) => ({
      id: memory.id,
      content: memory.content,
      containerTag: memory.container_tag,
      type: memory.type,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
      metadata: memory.metadata,
      displayName: memory.display_name,
      userName: memory.user_name,
      userEmail: memory.user_email,
      projectPath: memory.project_path,
      projectName: memory.project_name,
      gitRepoUrl: memory.git_repo_url,
      isPinned: memory.is_pinned || 0,
    }));
  }

  private async _reEmbedSingleMemory(
    memory: any,
    processedCount: number,
    totalMemories: number,
    shardId: string,
    db: ReturnType<typeof connectionManager.getConnection>,
    shard?: ShardInfo
  ): Promise<{ success: boolean; processedCount: number }> {
    try {
      const vector = await embeddingService.embedWithTimeout(memory.content);
      // Re-embed the tags text too: after a dimension change the stored
      // tags_vector has old dimensions and would poison a rebuilt index —
      // reproducing the exact capture-time embedding text keeps tag search
      // consistent (Devin findings on #63).
      let tagsVector: Float32Array | undefined;
      const tagsText = typeof memory.tags === "string" ? memory.tags.trim() : "";
      if (tagsText) {
        tagsVector = await embeddingService.embedWithTimeout(
          `Topics: ${tagsText.split(",").join(", ")}`
        );
      }
      await vectorSearch.updateVector(db, memory.id, vector, shard, tagsVector);
      const nextCount = processedCount + 1;

      this.reportProgress({
        phase: "re-embedding",
        processed: nextCount,
        total: totalMemories,
        currentShard: shardId,
      });

      return { success: true, processedCount: nextCount };
    } catch (error) {
      log("Migration: error re-embedding memory", { memoryId: memory.id, error: String(error) });
      return { success: false, processedCount: processedCount + 1 };
    }
  }

  private async reEmbedMigration(
    mismatch: DimensionMismatch,
    startTime: number
  ): Promise<MigrationResult> {
    await embeddingService.warmup();
    embeddingService.clearCache();

    const totalMemories = mismatch.shardMismatches.reduce((sum, s) => sum + s.vectorCount, 0);

    this.reportProgress({
      phase: "preparing",
      processed: 0,
      total: totalMemories,
    });

    // The mismatch list carries dbPaths — resolve full ShardInfo so the
    // re-embeds can update the live backend index (R1 finding on #63).
    const shardByDbPath = new Map<string, ShardInfo>(
      [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")].map(
        (s) => [s.dbPath, s]
      )
    );

    let reEmbeddedCount = 0;
    let processedCount = 0;
    let shardHadFailures = false;

    for (const shardInfo of mismatch.shardMismatches) {
      this.reportProgress({
        phase: "re-embedding",
        processed: processedCount,
        total: totalMemories,
        currentShard: String(shardInfo.shardId),
      });

      try {
        const db = connectionManager.getConnection(shardInfo.dbPath);
        // Re-embedding needs a full scan — pass an explicit high limit.
        // Default 10000 is too low for shards with large memory counts.
        const memories = vectorSearch.getAllMemories(db, 1_000_000);
        const tempMemories = this._backupMemories(memories);
        let thisShardFailed = false;

        const shard = shardByDbPath.get(shardInfo.dbPath);
        for (const memory of tempMemories) {
          const result = await this._reEmbedSingleMemory(
            memory,
            processedCount,
            totalMemories,
            String(shardInfo.shardId),
            db,
            shard
          );
          processedCount = result.processedCount;
          if (result.success) {
            reEmbeddedCount++;
          } else {
            thisShardFailed = true;
            shardHadFailures = true;
          }
        }

        if (!thisShardFailed) {
          db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
            "embedding_dimensions",
            String(CONFIG.embeddingDimensions),
          ]);
          db.run("INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)", [
            "embedding_model",
            CONFIG.embeddingModel,
          ]);
          // The dims may have changed: any initialized in-memory index
          // holds old-dimension vectors. Force a rebuild from sqlite on
          // next search — the live index must not go stale until restart.
          if (shard) vectorSearch.markShardDirty(shard);
        } else {
          log("Migration: keeping original shard due to re-embedding failures", {
            shardId: shardInfo.shardId,
          });
        }
      } catch (error) {
        shardHadFailures = true;
        log("Migration: error processing shard", {
          shardId: shardInfo.shardId,
          error: String(error),
        });
      }
    }

    this.reportProgress({
      phase: "complete",
      processed: totalMemories,
      total: totalMemories,
    });

    const success = !shardHadFailures && reEmbeddedCount === totalMemories;
    return {
      success,
      strategy: "re-embed",
      deletedShards: 0,
      reEmbeddedMemories: reEmbeddedCount,
      duration: Date.now() - startTime,
      ...(success ? {} : { error: "One or more memories failed to re-embed" }),
    };
  }

  private reportProgress(progress: MigrationProgress): void {
    this.progressCallback?.(progress);
  }
}

export const migrationService = new MigrationService();
