import { embeddingService } from "./embedding.js";
import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { MemoryType } from "../types/index.js";
import type { MemoryRecord } from "./sqlite/types.js";
import { calculateAllScores } from "./memory-scoring.js";
import { classifyMemory } from "./memory-lifecycle.js";
import { detectConflicts } from "./memory-conflicts.js";

export type MemoryScope = "project" | "all-projects";

function safeToISOString(timestamp: any): string {
  try {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    const numValue = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp);

    if (isNaN(numValue) || numValue < 0) {
      return new Date().toISOString();
    }

    return new Date(numValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function safeJSONParse(jsonString: any): any {
  if (!jsonString || typeof jsonString !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

function extractScopeFromContainerTag(containerTag: string): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1] as "user" | "project";
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: "user", hash: containerTag };
}

function resolveScopeValue(
  scope: MemoryScope,
  containerTag: string
): { scope: "user" | "project"; hash: string } {
  if (scope === "all-projects") {
    return { scope: "project", hash: "" };
  }
  return extractScopeFromContainerTag(containerTag);
}

export class LocalMemoryClient {
  private initPromise: Promise<void> | null = null;
  private isInitialized: boolean = false;

  constructor() {}

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        this.isInitialized = true;
      } catch (error) {
        this.initPromise = null;
        log("SQLite initialization failed", { error: String(error) });
        throw error;
      }
    })();

    return this.initPromise;
  }

  async warmup(progressCallback?: (progress: any) => void): Promise<void> {
    await this.initialize();
    await embeddingService.warmup(progressCallback);
  }

  async isReady(): Promise<boolean> {
    return this.isInitialized && embeddingService.isWarmedUp;
  }

  getStatus(): {
    dbConnected: boolean;
    modelLoaded: boolean;
    ready: boolean;
  } {
    return {
      dbConnected: this.isInitialized,
      modelLoaded: embeddingService.isWarmedUp,
      ready: this.isInitialized && embeddingService.isWarmedUp,
    };
  }

  close(): void {
    connectionManager.closeAll();
  }

  async searchMemories(
    query: string,
    containerTag: string,
    scope: MemoryScope = "project",
    context?: { projectPath?: string; projectName?: string; recentFiles?: string[] }
  ) {
    try {
      await this.initialize();

      const queryVector = await embeddingService.embedWithTimeout(query);
      const resolved = resolveScopeValue(scope, containerTag);
      const shards = shardManager.getAllShards(resolved.scope, resolved.hash);

      if (shards.length === 0) {
        return { success: true as const, results: [], total: 0, timing: 0 };
      }

      // Build retrieval context
      const retrievalContext = context
        ? {
            projectPath: context.projectPath,
            projectName: context.projectName,
            recentFiles: context.recentFiles,
            recentQueries: [query],
            currentQuery: query,
          }
        : undefined;

      const results = await vectorSearch.searchAcrossShards(
        shards,
        queryVector,
        scope === "all-projects" ? "" : containerTag,
        CONFIG.maxMemories,
        CONFIG.similarityThreshold,
        query,
        retrievalContext
      );

      return { success: true as const, results, total: results.length, timing: 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemories: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: {
      type?: MemoryType;
      source?: "manual" | "auto-capture" | "import" | "api";
      tags?: string[];
      tool?: string;
      sessionID?: string;
      reasoning?: string;
      captureTimestamp?: number;
      displayName?: string;
      userName?: string;
      userEmail?: string;
      projectPath?: string;
      projectName?: string;
      gitRepoUrl?: string;
      [key: string]: unknown;
    }
  ) {
    try {
      await this.initialize();

      const tags = metadata?.tags || [];
      const vector = await embeddingService.embedWithTimeout(content);
      let tagsVector: Float32Array | undefined = undefined;

      if (tags.length > 0) {
        tagsVector = await embeddingService.embedWithTimeout(tags.join(", "));
      }

      const { scope, hash } = extractScopeFromContainerTag(containerTag);
      const shard = shardManager.getWriteShard(scope, hash);

      const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const now = Date.now();

      const {
        displayName,
        userName,
        userEmail,
        projectPath,
        projectName,
        gitRepoUrl,
        type,
        tags: _tags,
        ...dynamicMetadata
      } = metadata || {};

      // Fetch existing memories from same container for novelty and interference
      const db = connectionManager.getConnection(shard.dbPath);
      let existingContents: string[] = [];
      let conflictingMemories: string[] = [];

      try {
        const existingMemories = vectorSearch.listMemories(db, containerTag, 50);
        existingContents = existingMemories.map((m: any) => m.content || "");

        // Check for potential conflicts (simplified: memories with similar content)
        conflictingMemories = existingContents
          .filter((existing) => {
            const existingLower = existing.toLowerCase();
            const contentLower = content.toLowerCase();
            // Simple overlap check for potential conflicts
            const words = contentLower.split(/\s+/).filter((w) => w.length > 4);
            return words.some((w) => existingLower.includes(w));
          })
          .slice(0, 10);
      } catch (error) {
        log("addMemory: failed to fetch existing memories for scoring", {
          error: String(error),
        });
      }

      // Calculate all scores
      const scores = calculateAllScores({
        createdAt: now,
        accessCount: 0,
        lastAccessed: null,
        content,
        existingContents,
        conflictingMemories,
        source: metadata?.source,
        type,
      });

      // Classify memory store type and decay rate
      const { storeType, decayRate } = classifyMemory(type);

      const record: MemoryRecord = {
        id,
        content,
        vector,
        tagsVector,
        containerTag,
        tags: tags.length > 0 ? tags.join(",") : undefined,
        type,
        createdAt: now,
        updatedAt: now,
        displayName,
        userName,
        userEmail,
        projectPath,
        projectName,
        gitRepoUrl,
        metadata:
          Object.keys(dynamicMetadata).length > 0 ? JSON.stringify(dynamicMetadata) : undefined,
        recencyScore: scores.recency,
        frequencyScore: scores.frequency,
        importanceScore: scores.importance,
        utilityScore: scores.utility,
        noveltyScore: scores.novelty,
        confidenceScore: scores.confidence,
        interferencePenalty: scores.interference,
        strength: scores.strength,
        accessCount: 0,
        lastAccessed: undefined,
        storeType,
        decayRate,
      };

      await vectorSearch.insertVector(db, record, shard);
      shardManager.incrementVectorCount(shard.id);

      // Run conflict detection asynchronously (don't block addMemory response)
      detectConflicts(id, content, containerTag, metadata?.sessionID).catch((err) => {
        log("addMemory: conflict detection failed", { error: String(err) });
      });

      return { success: true as const, id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("addMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async deleteMemory(memoryId: string) {
    try {
      await this.initialize();

      const userShards = shardManager.getAllShards("user", "");
      const projectShards = shardManager.getAllShards("project", "");
      const allShards = [...userShards, ...projectShards];

      for (const shard of allShards) {
        const db = connectionManager.getConnection(shard.dbPath);
        const memory = vectorSearch.getMemoryById(db, memoryId);

        if (memory) {
          await vectorSearch.deleteVector(db, memoryId, shard);
          shardManager.decrementVectorCount(shard.id);
          return { success: true };
        }
      }

      return { success: false, error: "Memory not found" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("deleteMemory: error", { memoryId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(containerTag: string, limit = 20, scope: MemoryScope = "project") {
    try {
      await this.initialize();

      const resolved = resolveScopeValue(scope, containerTag);
      const shards = shardManager.getAllShards(resolved.scope, resolved.hash);

      if (shards.length === 0) {
        return {
          success: true as const,
          memories: [],
          pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
        };
      }

      const allMemories: any[] = [];

      for (const shard of shards) {
        const db = connectionManager.getConnection(shard.dbPath);
        const memories = vectorSearch.listMemories(
          db,
          scope === "all-projects" ? "" : containerTag,
          limit
        );
        allMemories.push(...memories);
      }

      // Sort by pinned first, then strength, then recency
      allMemories.sort((a, b) => {
        const pinnedDiff = (b.is_pinned || 0) - (a.is_pinned || 0);
        if (pinnedDiff !== 0) return pinnedDiff;
        const strengthDiff = (b.strength || 0) - (a.strength || 0);
        if (strengthDiff !== 0) return strengthDiff;
        return (b.recency_score || 0) - (a.recency_score || 0);
      });

      const memories = allMemories.slice(0, limit).map((r: any) => ({
        id: r.id,
        summary: r.content,
        createdAt: safeToISOString(r.created_at),
        metadata: safeJSONParse(r.metadata),
        displayName: r.display_name,
        userName: r.user_name,
        userEmail: r.user_email,
        projectPath: r.project_path,
        projectName: r.project_name,
        gitRepoUrl: r.git_repo_url,
        strength: r.strength,
        recencyScore: r.recency_score,
        frequencyScore: r.frequency_score,
        importanceScore: r.importance_score,
        utilityScore: r.utility_score,
        noveltyScore: r.novelty_score,
        confidenceScore: r.confidence_score,
        interferencePenalty: r.interference_penalty,
        accessCount: r.access_count,
        isPinned: r.is_pinned,
      }));

      return {
        success: true as const,
        memories,
        pagination: { currentPage: 1, totalItems: memories.length, totalPages: 1 },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("listMemories: error", { error: errorMessage });
      return {
        success: false as const,
        error: errorMessage,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
      };
    }
  }

  async searchMemoriesBySessionID(sessionID: string, containerTag: string, limit: number = 10) {
    try {
      await this.initialize();

      const { scope, hash } = extractScopeFromContainerTag(containerTag);
      const shards = shardManager.getAllShards(scope, hash);

      if (shards.length === 0) {
        return { success: true as const, results: [], total: 0, timing: 0 };
      }

      const allMemories: any[] = [];

      for (const shard of shards) {
        const db = connectionManager.getConnection(shard.dbPath);
        const memories = vectorSearch.getMemoriesBySessionID(db, sessionID);
        allMemories.push(...memories);
      }

      allMemories.sort((a, b) => b.created_at - a.created_at);

      const results = allMemories.slice(0, limit).map((row: any) => ({
        id: row.id,
        memory: row.content,
        similarity: 1.0,
        tags: row.tags || [],
        metadata: row.metadata || {},
        containerTag: row.container_tag,
        displayName: row.display_name,
        userName: row.user_name,
        userEmail: row.user_email,
        projectPath: row.project_path,
        projectName: row.project_name,
        gitRepoUrl: row.git_repo_url,
        createdAt: row.created_at,
      }));

      return { success: true as const, results, total: results.length, timing: 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemoriesBySessionID: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }
}

export const memoryClient = new LocalMemoryClient();
