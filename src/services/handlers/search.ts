import { embeddingService } from "../embedding.js";
import { shardManager, getAllShards } from "../sqlite/shard-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { log } from "../logger.js";
import { userPromptManager, type UserPrompt } from "../user-prompt/user-prompt-manager.js";
import { safeToISOString, safeJSONParse } from "../utils/safe-transforms.js";
import type { SearchResult } from "../sqlite/types.js";
import {
  sanitizeListParams,
  extractScopeFromTag,
  getProjectPathFromTag,
  MAX_SEARCH_RESULTS,
} from "./shared.js";
import type { ApiResponse, PaginatedResponse } from "./shared-types.js";

interface FormattedPrompt {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
  projectPath: string | null;
  linkedMemoryId: string | null;
  similarity?: number;
  isContext?: boolean;
}

interface FormattedMemory {
  type: "memory";
  id: string;
  content: string;
  memoryType?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
  linkedPromptId?: string;
  isContext?: boolean;
}

type SearchResultItem = FormattedPrompt | FormattedMemory;

async function buildSearchQueryVector(query: string): Promise<Float32Array | null> {
  await embeddingService.warmup();
  try {
    return await embeddingService.embedWithTimeout(query);
  } catch (error) {
    if (!embeddingService.embeddingAvailable) {
      log("Embedding unavailable — falling back to text-only search", {
        query,
        error: String(error),
      });
      return null;
    }
    throw error;
  }
}

async function searchMemoriesByTag(
  queryVector: Float32Array | null,
  tag: string,
  pageSize: number,
  query: string
): Promise<{ memoryResults: SearchResult[]; promptResults: UserPrompt[] }> {
  const { scope, hash } = extractScopeFromTag(tag);
  const shards = shardManager.getAllShards(scope, hash);
  let memoryResults: SearchResult[] = [];
  for (const shard of shards) {
    try {
      const results = await vectorSearch.searchInShard(
        shard,
        queryVector,
        tag,
        pageSize * 2,
        query
      );
      memoryResults.push(...results);
    } catch (error) {
      log("Shard search error", { shardId: shard.id, error: String(error) });
    }
  }
  if (memoryResults.length > MAX_SEARCH_RESULTS) {
    memoryResults = memoryResults.slice(0, MAX_SEARCH_RESULTS);
  }
  const projectPath = getProjectPathFromTag(tag);
  const promptResults = userPromptManager.searchPrompts(query, projectPath, pageSize * 2);
  return { memoryResults, promptResults };
}

async function searchMemoriesGlobal(
  queryVector: Float32Array | null,
  page: number,
  pageSize: number,
  query: string
): Promise<{ memoryResults: SearchResult[]; promptResults: UserPrompt[] }> {
  const allShards = getAllShards();
  let memoryResults: SearchResult[] = [];
  const searchedPaths = new Set<string>();
  for (const shard of allShards) {
    if (searchedPaths.has(shard.dbPath)) continue;
    searchedPaths.add(shard.dbPath);
    try {
      const perShardLimit = Math.min(page * pageSize, 500);
      const results = await vectorSearch.searchInShard(
        shard,
        queryVector,
        "",
        perShardLimit,
        query
      );
      memoryResults.push(...results);
    } catch (error) {
      log("Shard search error", { shardId: shard.id, error: String(error) });
    }
  }
  if (memoryResults.length > MAX_SEARCH_RESULTS) {
    memoryResults = memoryResults.slice(0, MAX_SEARCH_RESULTS);
  }
  const promptResults = userPromptManager.searchPrompts(query, undefined, pageSize * 2);
  return { memoryResults, promptResults };
}

function formatSearchPrompt(p: UserPrompt): FormattedPrompt {
  return {
    type: "prompt",
    id: p.id,
    sessionId: p.sessionId,
    content: p.content,
    createdAt: safeToISOString(p.createdAt),
    projectPath: p.projectPath,
    linkedMemoryId: p.linkedMemoryId,
    similarity: 1,
  };
}

function formatSearchMemory(r: SearchResult): FormattedMemory {
  return {
    type: "memory",
    id: r.id,
    content: r.memory,
    memoryType: r.type,
    tags: r.tags,
    createdAt: safeToISOString(r.createdAt),
    updatedAt: r.updatedAt ? safeToISOString(r.updatedAt) : undefined,
    similarity: r.similarity,
    metadata: r.metadata,
    displayName: r.displayName,
    userName: r.userName,
    userEmail: r.userEmail,
    projectPath: r.projectPath,
    projectName: r.projectName,
    gitRepoUrl: r.gitRepoUrl,
    isPinned: r.isPinned === 1,
    linkedPromptId: (r.metadata as Record<string, unknown>)?.promptId as string | undefined,
  };
}

function paginateSearchResults(
  results: SearchResultItem[],
  page: number,
  pageSize: number
): { paginated: SearchResultItem[]; total: number; totalPages: number } {
  const total = results.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  return { paginated: results.slice(offset, offset + pageSize), total, totalPages };
}

function fetchMissingLinkedItems(results: SearchResultItem[]): SearchResultItem[] {
  const missingPromptIds = new Set<string>();
  const missingMemoryIds = new Set<string>();
  const existingIds = new Set(results.map((r) => r.id));
  for (const item of results) {
    if (item.type === "memory" && item.linkedPromptId) {
      if (!existingIds.has(item.linkedPromptId)) missingPromptIds.add(item.linkedPromptId);
    } else if (item.type === "prompt" && item.linkedMemoryId) {
      if (!existingIds.has(item.linkedMemoryId)) missingMemoryIds.add(item.linkedMemoryId);
    }
  }

  if (missingPromptIds.size > 0) {
    const extraPrompts = userPromptManager.getPromptsByIds(Array.from(missingPromptIds));
    for (const p of extraPrompts) {
      results.push({
        type: "prompt",
        id: p.id,
        sessionId: p.sessionId,
        content: p.content,
        createdAt: safeToISOString(p.createdAt),
        projectPath: p.projectPath,
        linkedMemoryId: p.linkedMemoryId,
        similarity: 0,
        isContext: true,
      });
    }
  }

  if (missingMemoryIds.size > 0) {
    const projectShards = shardManager.getAllShards("project", "");
    for (const shard of projectShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      for (const mid of missingMemoryIds) {
        const memory = vectorSearch.getMemoryById(db, mid);
        if (memory && !existingIds.has(memory.id)) {
          const parsedMetadata = safeJSONParse(memory.metadata) as
            | Record<string, unknown>
            | undefined;
          results.push({
            type: "memory",
            id: memory.id,
            content: memory.content,
            memoryType: memory.type,
            tags: memory.tags ? memory.tags.split(",").map((t: string) => t.trim()) : [],
            createdAt: safeToISOString(memory.created_at),
            updatedAt: memory.updated_at ? safeToISOString(memory.updated_at) : undefined,
            similarity: 0,
            metadata: parsedMetadata,
            displayName: memory.display_name,
            userName: memory.user_name,
            userEmail: memory.user_email,
            projectPath: memory.project_path,
            projectName: memory.project_name,
            gitRepoUrl: memory.git_repo_url,
            isPinned: memory.is_pinned === 1,
            linkedPromptId: parsedMetadata?.promptId as string | undefined,
            isContext: true,
          });
        }
      }
    }
  }

  return results;
}

export async function handleSearch(
  query: string,
  tag?: string,
  page = 1,
  pageSize = 20
): Promise<ApiResponse<PaginatedResponse<SearchResultItem>>> {
  try {
    if (!query) return { success: false, error: "query is required" };
    const { safePage, safePageSize } = sanitizeListParams(page, pageSize);

    const queryVector = await buildSearchQueryVector(query);

    let memoryResults: SearchResult[];
    let promptResults: UserPrompt[];
    if (tag) {
      const results = await searchMemoriesByTag(queryVector, tag, safePageSize, query);
      memoryResults = results.memoryResults;
      promptResults = results.promptResults;
    } else {
      const results = await searchMemoriesGlobal(queryVector, safePage, safePageSize, query);
      memoryResults = results.memoryResults;
      promptResults = results.promptResults;
    }

    const formattedPrompts = promptResults.map(formatSearchPrompt);
    const formattedMemories = memoryResults.map(formatSearchMemory);

    const combinedResults = [...formattedMemories, ...formattedPrompts].sort(
      (a, b) => (b.similarity || 0) - (a.similarity || 0) || b.createdAt.localeCompare(a.createdAt)
    );

    let {
      paginated: paginatedResults,
      total,
      totalPages,
    } = paginateSearchResults(combinedResults, safePage, safePageSize);
    paginatedResults = fetchMissingLinkedItems(paginatedResults);

    return {
      success: true,
      data: { items: paginatedResults, total, page: safePage, pageSize: safePageSize, totalPages },
    };
  } catch (error) {
    log("handleSearch: error", { error: String(error) });
    return { success: false, error: "Internal error in handleSearch" };
  }
}
