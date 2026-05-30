import { embeddingService } from "../embedding.js";
import { shardManager, getAllShards } from "../sqlite/shard-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import { safeToISOString, safeJSONParse } from "../utils/safe-transforms.js";
import type { RawMemoryRow } from "./shared-types.js";
import type { ShardInfo, SearchResult } from "../sqlite/types.js";
import type { ApiResponse } from "./shared-types.js";
import { handleDeleteMemory } from "./memory.js";

interface CountRow {
  count: number;
}

interface ScopeCountRow {
  user_count?: number;
  project_count?: number;
}

interface TypeCountRow {
  type?: string;
  count: number;
}

interface TaggingProvider {
  executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    tool: unknown,
    sessionId: string
  ): Promise<{ success: boolean; data?: { tags?: string[] } }>;
}

export class MigrationProgressTracker {
  processed = 0;
  total = 0;
  currentBatch = 0;
  totalBatches = 0;
  isComplete = true;
  errors: string[] = [];

  reset(): void {
    this.processed = 0;
    this.total = 0;
    this.currentBatch = 0;
    this.totalBatches = 0;
    this.isComplete = true;
    this.errors = [];
  }

  toJSON() {
    return {
      processed: this.processed,
      total: this.total,
      currentBatch: this.currentBatch,
      totalBatches: this.totalBatches,
      isComplete: this.isComplete,
      errors: [...this.errors],
    };
  }
}

export const migrationProgress = new MigrationProgressTracker();

function loadAllMemoriesWithShards(): { memory: RawMemoryRow; shard: ShardInfo }[] {
  const projectShards = shardManager.getAllShards("project", "");
  const allMemories: { memory: RawMemoryRow; shard: ShardInfo }[] = [];
  for (const shard of projectShards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const memories = db.prepare("SELECT * FROM memories LIMIT 5000").all() as RawMemoryRow[];
    if (memories.length >= 5000) {
      log("loadAllMemoriesWithShards: LIMIT 5000 reached — results may be truncated", {
        shardId: shard.id,
        limit: 5000,
      });
    }
    for (const m of memories) {
      allMemories.push({ memory: m, shard });
    }
  }
  return allMemories;
}

async function processSingleTagMigration(
  m: RawMemoryRow,
  shard: ShardInfo,
  provider: TaggingProvider
): Promise<void> {
  const db = connectionManager.getConnection(shard.dbPath);

  let currentTags = m.tags
    ? m.tags
        .split(",")
        .map((t: string) => t.trim().toLowerCase())
        .filter((t: string) => t)
    : [];

  if (currentTags.length === 0) {
    const prompt = `Generate 2-4 short technical tags for this memory content:\n\n${m.content}\n\nReturn ONLY a comma-separated list of tags.`;
    const result = await provider.executeToolCall(
      "You are a technical tagger.",
      prompt,
      {
        type: "function",
        function: {
          name: "save_tags",
          description: "Save generated tags",
          parameters: {
            type: "object",
            properties: { tags: { type: "array", items: { type: "string" } } },
            required: ["tags"],
          },
        },
      },
      `migration_${m.id}`
    );
    if (result.success && result.data?.tags) {
      currentTags = result.data.tags;
      db.prepare("UPDATE memories SET tags = ? WHERE id = ?").run(currentTags.join(","), m.id);
    }
  }

  const vector = await embeddingService.embedWithTimeout(m.content);
  const tagsVector = currentTags.length
    ? await embeddingService.embedWithTimeout(currentTags.join(", "))
    : undefined;
  const vectorBuffer = new Uint8Array(vector.buffer);
  db.prepare("UPDATE memories SET vector = ?, updated_at = ? WHERE id = ?").run(
    vectorBuffer,
    Date.now(),
    m.id
  );

  await vectorSearch.updateVector(db, m.id, vector, shard, tagsVector);
}

export async function handleRunCleanup(): Promise<
  ApiResponse<{ deletedCount: number; userCount: number; projectCount: number }>
> {
  try {
    const { cleanupService } = await import("../cleanup-service.js");
    const result = await cleanupService.runCleanup();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunCleanup: error", { error: String(error) });
    return { success: false, error: "Internal error in handleRunCleanup" };
  }
}

export async function handleRunDeduplication(): Promise<
  ApiResponse<{ exactDuplicatesDeleted: number; nearDuplicateGroups: unknown[] }>
> {
  try {
    const { deduplicationService } = await import("../deduplication-service.js");
    const result = await deduplicationService.detectAndRemoveDuplicates();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunDeduplication: error", { error: String(error) });
    return { success: false, error: "Internal error in handleRunDeduplication" };
  }
}

export async function handleDetectMigration(): Promise<
  ApiResponse<{
    needsMigration: boolean;
    configDimensions: number;
    configModel: string;
    shardMismatches: unknown[];
  }>
> {
  try {
    const { migrationService } = await import("../migration-service.js");
    const result = migrationService.detectDimensionMismatch();
    return { success: true, data: result };
  } catch (error) {
    log("handleDetectMigration: error", { error: String(error) });
    return { success: false, error: "Internal error in handleDetectMigration" };
  }
}

export async function handleRunMigration(strategy: "fresh-start" | "re-embed"): Promise<
  ApiResponse<{
    success: boolean;
    strategy: string;
    deletedShards: number;
    reEmbeddedMemories: number;
    duration: number;
    error?: string;
  }>
> {
  try {
    const { migrationService } = await import("../migration-service.js");
    const result = await migrationService.migrateToNewModel(strategy);
    return { success: result.success, data: result };
  } catch (error) {
    log("handleRunMigration: error", { error: String(error) });
    return { success: false, error: "Internal error in handleRunMigration" };
  }
}

export async function handleDeletePrompt(
  id: string,
  cascade = false
): Promise<ApiResponse<{ deletedMemory: boolean }>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const prompt = userPromptManager.getPromptById(id);
    if (!prompt) return { success: false, error: "Prompt not found" };
    let deletedMemory = false;
    if (cascade && prompt.linkedMemoryId) {
      const result = await handleDeleteMemory(prompt.linkedMemoryId, false);
      if (result.success) deletedMemory = true;
    }
    userPromptManager.deletePrompt(id);
    return { success: true, data: { deletedMemory } };
  } catch (error) {
    log("handleDeletePrompt: error", { error: String(error) });
    return { success: false, error: "Internal error in handleDeletePrompt" };
  }
}

export async function handleBulkDeletePrompts(
  ids: string[],
  cascade = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeletePrompt(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDeletePrompts: error", { error: String(error) });
    return { success: false, error: "Internal error in handleBulkDeletePrompts" };
  }
}

export function handleStats(): ApiResponse<{
  total: number;
  byScope: { user: number; project: number };
  byType: Record<string, number>;
}> {
  try {
    const allShards = getAllShards();
    let userCount = 0,
      projectCount = 0;
    const typeCount: Record<string, number> = {};
    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const scopeRow = db
        .prepare(
          "SELECT SUM(CASE WHEN container_tag LIKE '%_user_%' THEN 1 ELSE 0 END) as user_count, SUM(CASE WHEN container_tag LIKE '%_project_%' THEN 1 ELSE 0 END) as project_count FROM memories WHERE is_deprecated = 0"
        )
        .get() as ScopeCountRow | undefined;
      userCount += scopeRow?.user_count || 0;
      projectCount += scopeRow?.project_count || 0;

      const typeRows = db
        .prepare(
          "SELECT type, COUNT(*) as count FROM memories WHERE is_deprecated = 0 GROUP BY type"
        )
        .all() as TypeCountRow[];
      for (const row of typeRows) {
        if (row.type) {
          typeCount[row.type] = (typeCount[row.type] || 0) + row.count;
        }
      }
    }
    return {
      success: true,
      data: {
        total: userCount + projectCount,
        byScope: { user: userCount, project: projectCount },
        byType: typeCount,
      },
    };
  } catch (error) {
    log("handleStats: error", { error: String(error) });
    return { success: false, error: "Internal error in handleStats" };
  }
}

export function handleDetectTagMigration(): ApiResponse<{
  needsMigration: boolean;
  count: number;
}> {
  try {
    const projectShards = shardManager.getAllShards("project", "");
    let untaggedCount = 0;
    for (const shard of projectShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const rows = db
        .prepare("SELECT COUNT(*) as count FROM memories WHERE tags IS NULL OR tags = ''")
        .get() as CountRow | undefined;
      untaggedCount += rows?.count || 0;
    }
    return { success: true, data: { needsMigration: untaggedCount > 0, count: untaggedCount } };
  } catch (error) {
    log("Tag migration detection failed", { error: String(error) });
    return { success: false, error: "Internal error in handleDetectTagMigration" };
  }
}

export function handleGetTagMigrationProgress(): ApiResponse<
  ReturnType<MigrationProgressTracker["toJSON"]>
> {
  return { success: true, data: migrationProgress.toJSON() };
}

export async function handleRunTagMigrationBatch(
  batchSize = 5
): Promise<ApiResponse<{ processed: number; total: number; hasMore: boolean }>> {
  try {
    const { AIProviderFactory } = await import("../ai/ai-provider-factory.js");
    const { buildMemoryProviderConfig } = await import("../ai/provider-config.js");
    const providerConfig = buildMemoryProviderConfig(CONFIG, {
      maxIterations: 1,
      iterationTimeout: 30000,
    });
    const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

    const allMemories = loadAllMemoriesWithShards();

    if (migrationProgress.total === 0) {
      migrationProgress.total = allMemories.length;
      migrationProgress.totalBatches = Math.ceil(allMemories.length / batchSize);
      migrationProgress.isComplete = false;
    }

    const startIdx = migrationProgress.processed;
    const endIdx = Math.min(startIdx + batchSize, allMemories.length);

    for (let i = startIdx; i < endIdx; i++) {
      const item = allMemories[i];
      if (!item) continue;
      try {
        await processSingleTagMigration(item.memory, item.shard, provider);
        migrationProgress.processed++;
      } catch (e) {
        const errorMsg = String(e);
        migrationProgress.errors.push(errorMsg);
        log("Migration error for memory", { id: item.memory.id, error: errorMsg });
      }
    }

    migrationProgress.currentBatch++;
    const hasMore = migrationProgress.processed < migrationProgress.total;

    if (!hasMore) {
      migrationProgress.isComplete = true;
    }

    return {
      success: true,
      data: { processed: migrationProgress.processed, total: migrationProgress.total, hasMore },
    };
  } catch (error) {
    log("Tag migration batch failed", { error: String(error) });
    return { success: false, error: "Internal error in handleRunTagMigrationBatch" };
  }
}
