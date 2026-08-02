import { join } from "node:path";
import { embeddingService } from "./embedding.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";

// ── Re-export all domain handlers ───────────────────────────────────────────

// Memory CRUD handlers
export {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleGetMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handlePinMemory,
  handleUnpinMemory,
} from "./handlers/memory.js";

// Search handler
export { handleSearch } from "./handlers/search.js";

// Config handler
export { handleGetConfig, handleUpdateConfig } from "./handlers/config.js";

// Profile handlers
export {
  handleGetUserProfile,
  handleUpdateUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
} from "./handlers/profile.js";

// Conflict handlers
export {
  handleListConflicts,
  handleResolveConflict,
  handleConflictStats,
} from "./handlers/conflicts.js";

// Transcript handlers
export { handleSearchTranscripts, handleListTranscripts } from "./handlers/transcripts.js";

// Admin / migration / cleanup handlers
export {
  handleRunCleanup,
  handleRunDeduplication,
  handleDetectMigration,
  handleRunMigration,
  handleRunTagMigrationBatch,
  handleGetTagMigrationProgress,
  handleStats,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleDetectTagMigration,
  MigrationProgressTracker,
  migrationProgress,
} from "./handlers/admin.js";

// ── Shared types (re-exported for consumers) ────────────────────────────────

export type {
  ApiResponse,
  PaginatedResponse,
  TagInfo,
  FormattedConflict,
  RawMemoryRow,
} from "./handlers/shared-types.js";

export type { ShardInfo } from "./sqlite/types.js";

// ── Remaining inline handlers (don't cleanly fit a domain module) ───────────

export function handleEmbeddingCacheStats(): ApiResponse<{
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  rate: number;
}> {
  try {
    const stats = embeddingService.getCacheStats();
    return { success: true, data: stats };
  } catch (error) {
    log("handleEmbeddingCacheStats: error", { error: String(error) });
    return { success: false, error: "Internal error in handleEmbeddingCacheStats" };
  }
}

export function handleApiStatus(): ApiResponse<{
  mode: "full" | "text-only";
  warmedUp: boolean;
  ready: boolean;
}> {
  try {
    const mode = embeddingService.embeddingAvailable ? "full" : "text-only";
    const warmedUp = embeddingService.isWarmedUp;
    let ready = false;
    try {
      const metadataPath = join(CONFIG.storagePath, "metadata.db");
      const db = connectionManager.getConnection(metadataPath);
      const row = db.prepare("SELECT COUNT(*) as count FROM shards").get() as { count: number };
      ready = row.count > 0;
    } catch {
      ready = false;
    }
    return { success: true, data: { mode, warmedUp, ready } };
  } catch (error) {
    log("handleApiStatus: error", { error: String(error) });
    return { success: false, error: "Internal error in handleApiStatus" };
  }
}

// ── Local type (not re-exported from shared-types, kept for barrel self-containment) ──
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
