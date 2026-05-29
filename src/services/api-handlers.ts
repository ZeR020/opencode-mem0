import { transcriptManager, type TranscriptRecord } from "./sqlite/transcript-manager.js";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { embeddingService } from "./embedding.js";
import {
  shardManager,
  getAllShards,
  extractScopeFromContainerTag,
} from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import type { MemoryType } from "../types/index.js";
import { userPromptManager, type UserPrompt } from "./user-prompt/user-prompt-manager.js";
import { getAllUnresolvedConflicts, resolveConflict } from "./memory-conflicts.js";
import { safeToISOString, safeJSONParse } from "./utils/safe-transforms.js";
import type { UserProfileData } from "./user-profile/types.js";
import type { SearchResult, ShardInfo } from "./sqlite/types.js";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface Memory {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface FormattedConflict {
  id: string;
  memoryId1: string;
  memoryId2: string;
  memory1Content?: string;
  memory2Content?: string;
  similarityScore: number;
  detectedAt: string;
  resolved: boolean;
  resolutionType?: string;
}

interface RawMemoryRow {
  id: string;
  content: string;
  type?: string;
  tags?: string;
  metadata?: string;
  created_at: number | string;
  updated_at?: number | string;
  container_tag?: string;
  display_name?: string;
  user_name?: string;
  user_email?: string;
  project_path?: string;
  project_name?: string;
  git_repo_url?: string;
  is_pinned?: number;
}

interface TimelineMemoryItem extends Omit<Memory, "createdAt" | "updatedAt" | "type"> {
  type: "memory";
  memoryType?: string;
  createdAt: number;
  updatedAt?: number;
  linkedPromptId?: string;
}

interface TimelinePromptItem {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  projectPath?: string | null;
  linkedMemoryId?: string | null;
}

type TimelineItem = TimelineMemoryItem | TimelinePromptItem;

interface LinkedTimelinePair {
  memory: TimelineMemoryItem | null;
  prompt: TimelinePromptItem | null;
}

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

const extractScopeFromTag = (tag: string) => extractScopeFromContainerTag(tag, "project");

function findMemoryInShards(id: string): { shard: ShardInfo; memory: RawMemoryRow } | null {
  for (const shard of getAllShards()) {
    const db = connectionManager.getConnection(shard.dbPath);
    const memory = vectorSearch.getMemoryById(db, id);
    if (memory) return { shard, memory };
  }
  return null;
}

function getProjectPathFromTag(tag: string): string | undefined {
  const { scope, hash } = extractScopeFromTag(tag);
  const shards = shardManager.getAllShards(scope, hash);
  for (const shard of shards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const tags = vectorSearch.getDistinctTags(db);
    for (const t of tags) {
      if (t.container_tag === tag && t.project_path) {
        return t.project_path;
      }
    }
  }
  return undefined;
}

function sanitizeListParams(
  page: number,
  pageSize: number
): { safePage: number; safePageSize: number } {
  const safePage = Number.isFinite(page) && page > 0 ? Math.min(Math.floor(page), 10000) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0 && pageSize <= 100 ? Math.floor(pageSize) : 20;
  return { safePage, safePageSize };
}

function fetchMemoriesForList(tag: string | undefined, perShardLimit: number): RawMemoryRow[] {
  let allMemories: RawMemoryRow[] = [];
  if (tag) {
    const { scope: tagScope, hash } = extractScopeFromTag(tag);
    const shards = shardManager.getAllShards(tagScope, hash);
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.listMemories(db, tag, perShardLimit) as RawMemoryRow[];
      allMemories.push(...memories);
    }
  } else {
    const shards = shardManager.getAllShards("project", "");
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.listMemories(db, "", perShardLimit) as RawMemoryRow[];
      allMemories.push(...memories.filter((m) => m.container_tag?.includes("_project_")));
    }
  }
  const MAX_LIST_MEMORIES = 2000;
  if (allMemories.length > MAX_LIST_MEMORIES) {
    allMemories = allMemories.slice(0, MAX_LIST_MEMORIES);
  }
  return allMemories;
}

function mapRawMemoryToTyped(r: RawMemoryRow): TimelineMemoryItem {
  const metadata = safeJSONParse(r.metadata) as Record<string, unknown> | undefined;
  const linkedPromptId = metadata?.promptId;
  return {
    type: "memory",
    id: r.id,
    content: r.content,
    memoryType: r.type,
    tags: r.tags ? r.tags.split(",").map((t: string) => t.trim()) : [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : undefined,
    metadata,
    linkedPromptId: typeof linkedPromptId === "string" ? linkedPromptId : undefined,
    displayName: r.display_name,
    userName: r.user_name,
    userEmail: r.user_email,
    projectPath: r.project_path,
    projectName: r.project_name,
    gitRepoUrl: r.git_repo_url,
    isPinned: r.is_pinned === 1,
  };
}

function buildPaginatedTimeline(
  memoriesWithType: TimelineMemoryItem[],
  includePrompts: boolean,
  tag: string | undefined,
  safePage: number,
  safePageSize: number
): { items: TimelineItem[]; total: number; totalPages: number } {
  let timeline: TimelineItem[] = memoriesWithType;
  if (includePrompts) {
    const projectPath = tag ? getProjectPathFromTag(tag) : undefined;
    const prompts = userPromptManager.getCapturedPrompts(projectPath);
    const promptsWithType: TimelinePromptItem[] = prompts.map((p: UserPrompt) => ({
      type: "prompt",
      id: p.id,
      sessionId: p.sessionId,
      content: p.content,
      createdAt: p.createdAt,
      projectPath: p.projectPath,
      linkedMemoryId: p.linkedMemoryId,
    }));
    timeline = [...memoriesWithType, ...promptsWithType];
  }

  const MAX_TIMELINE_ITEMS = 2500;
  if (timeline.length > MAX_TIMELINE_ITEMS) {
    timeline = timeline.slice(0, MAX_TIMELINE_ITEMS);
  }

  const linkedPairs = new Map<string, LinkedTimelinePair>();
  const standalone: TimelineItem[] = [];
  for (const item of timeline) {
    if (item.type === "memory" && item.linkedPromptId) {
      if (!linkedPairs.has(item.linkedPromptId)) {
        linkedPairs.set(item.linkedPromptId, { memory: item, prompt: null });
      } else {
        const pair = linkedPairs.get(item.linkedPromptId);
        if (pair) pair.memory = item;
      }
    } else if (item.type === "prompt" && item.linkedMemoryId) {
      if (!linkedPairs.has(item.id)) {
        linkedPairs.set(item.id, { memory: null, prompt: item });
      } else {
        const pair = linkedPairs.get(item.id);
        if (pair) pair.prompt = item;
      }
    } else {
      standalone.push(item);
    }
  }

  const sortedTimeline: TimelineItem[] = [];
  const pairs = Array.from(linkedPairs.values())
    .filter((p): p is { memory: TimelineMemoryItem; prompt: TimelinePromptItem } =>
      Boolean(p.memory && p.prompt)
    )
    .sort((a, b) => b.memory.createdAt - a.memory.createdAt);
  for (const pair of pairs) {
    sortedTimeline.push(pair.memory);
    sortedTimeline.push(pair.prompt);
  }
  standalone.sort((a, b) => b.createdAt - a.createdAt);
  sortedTimeline.push(...standalone);

  const total = sortedTimeline.length;
  const totalPages = Math.ceil(total / safePageSize);
  const offset = (safePage - 1) * safePageSize;
  const paginatedResults = sortedTimeline.slice(offset, offset + safePageSize);

  return { items: paginatedResults, total, totalPages };
}

function formatTimelineItem(item: TimelineItem): Record<string, unknown> {
  if (item.type === "memory") {
    return {
      type: "memory",
      id: item.id,
      content: item.content,
      memoryType: item.memoryType,
      tags: item.tags,
      createdAt: safeToISOString(item.createdAt),
      updatedAt: item.updatedAt ? safeToISOString(item.updatedAt) : undefined,
      metadata: item.metadata,
      linkedPromptId: item.linkedPromptId,
      displayName: item.displayName,
      userName: item.userName,
      userEmail: item.userEmail,
      projectPath: item.projectPath,
      projectName: item.projectName,
      gitRepoUrl: item.gitRepoUrl,
      isPinned: item.isPinned,
    };
  }
  return {
    type: "prompt",
    id: item.id,
    sessionId: item.sessionId,
    content: item.content,
    createdAt: safeToISOString(item.createdAt),
    projectPath: item.projectPath,
    linkedMemoryId: item.linkedMemoryId,
  };
}

export async function handleListTags(): Promise<ApiResponse<{ project: TagInfo[] }>> {
  try {
    await embeddingService.warmup();
    const projectShards = shardManager.getAllShards("project", "");
    const tagsMap = new Map<string, TagInfo>();
    for (const shard of projectShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const tags = vectorSearch.getDistinctTags(db);
      for (const t of tags) {
        if (t.container_tag && !tagsMap.has(t.container_tag)) {
          tagsMap.set(t.container_tag, {
            tag: t.container_tag,
            displayName: t.display_name,
            userName: t.user_name,
            userEmail: t.user_email,
            projectPath: t.project_path,
            projectName: t.project_name,
            gitRepoUrl: t.git_repo_url,
          });
        }
      }
    }
    const projectTags: TagInfo[] = [];
    for (const tagInfo of tagsMap.values()) {
      if (tagInfo.tag.includes("_project_")) {
        projectTags.push(tagInfo);
      }
    }
    return { success: true, data: { project: projectTags } };
  } catch (error) {
    log("handleListTags: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleListMemories(
  tag?: string,
  page = 1,
  pageSize = 20,
  includePrompts = true
): Promise<ApiResponse<PaginatedResponse<Record<string, unknown>>>> {
  try {
    const { safePage, safePageSize } = sanitizeListParams(page, pageSize);
    await embeddingService.warmup();
    const perShardLimit = Math.min(safePageSize * 2, 500);
    const allMemories = fetchMemoriesForList(tag, perShardLimit);
    const memoriesWithType = allMemories.map(mapRawMemoryToTyped);
    const {
      items: paginatedResults,
      total,
      totalPages,
    } = buildPaginatedTimeline(memoriesWithType, includePrompts, tag, safePage, safePageSize);
    const items = paginatedResults.map(formatTimelineItem);

    return {
      success: true,
      data: { items, total, page: safePage, pageSize: safePageSize, totalPages },
    };
  } catch (error) {
    log("handleListMemories: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleAddMemory(data: {
  content: string;
  containerTag: string;
  type?: MemoryType;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    if (!data.content || !data.containerTag) {
      return { success: false, error: "content and containerTag are required" };
    }
    await embeddingService.warmup();
    const tags = (data.tags || []).map((t) => t.trim().toLowerCase());
    const embeddingInput =
      tags.length > 0 ? `${data.content}\nTags: ${tags.join(", ")}` : data.content;

    const vector = await embeddingService.embedWithTimeout(embeddingInput);
    let tagsVector: Float32Array | undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "));
    }

    const { scope, hash } = extractScopeFromTag(data.containerTag);

    const shard = shardManager.getWriteShard(scope, hash);

    const id = `mem_${Date.now()}_${randomBytes(5).toString("hex")}`;
    const now = Date.now();

    const record = {
      id,
      content: data.content,
      vector,
      tagsVector,
      containerTag: data.containerTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type,
      createdAt: now,
      updatedAt: now,
      displayName: data.displayName,
      userName: data.userName,
      userEmail: data.userEmail,
      projectPath: data.projectPath,
      projectName: data.projectName,
      gitRepoUrl: data.gitRepoUrl,
      metadata: JSON.stringify({ source: "api" }),
    };
    const db = connectionManager.getConnection(shard.dbPath);
    await vectorSearch.insertVector(db, record, shard);
    shardManager.incrementVectorCount(shard.id);
    return { success: true, data: { id } };
  } catch (error) {
    log("handleAddMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export function handleGetMemory(id: string): ApiResponse<unknown> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    return { success: true, data: formatTimelineItem(mapRawMemoryToTyped(found.memory)) };
  } catch (error) {
    log("handleGetMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleDeleteMemory(
  id: string,
  cascade = false
): Promise<ApiResponse<{ deletedPrompt: boolean }>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    const metadata = safeJSONParse(found.memory.metadata) as Record<string, unknown> | undefined;
    const linkedPromptId = metadata?.promptId as string | undefined;
    if (cascade && linkedPromptId) {
      userPromptManager.deletePrompt(linkedPromptId);
    }
    const db = connectionManager.getConnection(found.shard.dbPath);
    await vectorSearch.deleteVector(db, id, found.shard);
    shardManager.decrementVectorCount(found.shard.id);
    return {
      success: true,
      data: { deletedPrompt: cascade && Boolean(linkedPromptId) },
    };
  } catch (error) {
    log("handleDeleteMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleBulkDelete(
  ids: string[],
  cascade = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeleteMemory(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDelete: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleUpdateMemory(
  id: string,
  data: { content?: string; type?: MemoryType; tags?: string[] }
): Promise<ApiResponse<void>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    await embeddingService.warmup();
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    const existingMemory = found.memory;
    const newContent = data.content || existingMemory.content;
    const tags = data.tags || (existingMemory.tags ? existingMemory.tags.split(",") : []);

    const vector = await embeddingService.embedWithTimeout(newContent);
    let tagsVector: Float32Array | undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "));
    }

    const updatedRecord = {
      id,
      content: newContent,
      vector,
      tagsVector,
      containerTag: existingMemory.container_tag || "",
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type || existingMemory.type,
      createdAt: Number(existingMemory.created_at),
      updatedAt: Date.now(),
      metadata: existingMemory.metadata,
      displayName: existingMemory.display_name,
      userName: existingMemory.user_name,
      userEmail: existingMemory.user_email,
      projectPath: existingMemory.project_path,
      projectName: existingMemory.project_name,
      gitRepoUrl: existingMemory.git_repo_url,
    };

    const db = connectionManager.getConnection(found.shard.dbPath);
    await vectorSearch.replaceVector(db, id, updatedRecord, found.shard);
    return { success: true };
  } catch (error) {
    log("handleUpdateMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

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
  const MAX_SEARCH_RESULTS = 2000;
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
  const MAX_SEARCH_RESULTS = 2000;
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
    return { success: false, error: "Internal error" };
  }
}

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
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
  }
}

export function handlePinMemory(id: string): ApiResponse<void> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    const db = connectionManager.getConnection(found.shard.dbPath);
    vectorSearch.pinMemory(db, id);
    return { success: true };
  } catch (error) {
    log("handlePinMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export function handleUnpinMemory(id: string): ApiResponse<void> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    const db = connectionManager.getConnection(found.shard.dbPath);
    vectorSearch.unpinMemory(db, id);
    return { success: true };
  } catch (error) {
    log("handleUnpinMemory: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleRunCleanup(): Promise<
  ApiResponse<{ deletedCount: number; userCount: number; projectCount: number }>
> {
  try {
    const { cleanupService } = await import("./cleanup-service.js");
    const result = await cleanupService.runCleanup();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunCleanup: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleRunDeduplication(): Promise<
  ApiResponse<{ exactDuplicatesDeleted: number; nearDuplicateGroups: unknown[] }>
> {
  try {
    const { deduplicationService } = await import("./deduplication-service.js");
    const result = await deduplicationService.detectAndRemoveDuplicates();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunDeduplication: error", { error: String(error) });
    return { success: false, error: "Internal error" };
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
    const { migrationService } = await import("./migration-service.js");
    const result = migrationService.detectDimensionMismatch();
    return { success: true, data: result };
  } catch (error) {
    log("handleDetectMigration: error", { error: String(error) });
    return { success: false, error: "Internal error" };
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
    const { migrationService } = await import("./migration-service.js");
    const result = await migrationService.migrateToNewModel(strategy);
    return { success: result.success, data: result };
  } catch (error) {
    log("handleRunMigration: error", { error: String(error) });
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
  }
}

export async function handleGetUserProfile(
  userId?: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const { getTags } = await import("./tags.js");
    let targetUserId = userId;
    if (!targetUserId) {
      const tags = getTags(process.cwd());
      targetUserId = tags.user.userEmail || "unknown";
    }
    const profile = userProfileManager.getActiveProfile(targetUserId);
    if (!profile)
      return {
        success: true,
        data: {
          exists: false,
          userId: targetUserId,
          message: "No profile found. Keep chatting to build your profile.",
        },
      };
    const profileData = safeJSONParse(profile.profileData) as Record<string, unknown> | undefined;
    return {
      success: true,
      data: {
        exists: true,
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        userName: profile.userName,
        userEmail: profile.userEmail,
        version: profile.version,
        createdAt: safeToISOString(profile.createdAt),
        lastAnalyzedAt: safeToISOString(profile.lastAnalyzedAt),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        profileData,
      },
    };
  } catch (error) {
    log("handleGetUserProfile: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleUpdateUserProfile(
  userId: string | undefined,
  profileData: UserProfileData
): Promise<ApiResponse<{ message: string }>> {
  try {
    const targetUserId = userId || "default";
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const profile = userProfileManager.getActiveProfile(targetUserId);

    if (!profile) {
      return { success: false, error: "No profile found to update." };
    }

    userProfileManager.updateProfile(profile.id, profileData, 0, "Manual profile edit via UI");

    return { success: true, data: { message: "Profile updated successfully." } };
  } catch (error) {
    log("API error in handleUpdateUserProfile", { error: String(error) });
    return { success: false, error: "Internal error updating profile" };
  }
}

export async function handleGetProfileChangelog(
  profileId: string,
  limit = 5
): Promise<ApiResponse<Record<string, unknown>[]>> {
  try {
    if (!profileId) return { success: false, error: "profileId is required" };
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const changelogs = userProfileManager.getProfileChangelogs(profileId, limit);
    const formattedChangelogs = changelogs.map((c) => ({
      id: c.id,
      profileId: c.profileId,
      version: c.version,
      changeType: c.changeType,
      changeSummary: c.changeSummary,
      createdAt: safeToISOString(c.createdAt),
    }));
    return { success: true, data: formattedChangelogs };
  } catch (error) {
    log("handleGetProfileChangelog: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleGetProfileSnapshot(
  changelogId: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    if (!changelogId) return { success: false, error: "changelogId is required" };
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const changelogs = userProfileManager.getProfileChangelogs(changelogId, 50);
    const changelog = changelogs.find((c) => c.id === changelogId);
    if (!changelog) return { success: false, error: "Changelog not found" };
    const profileData = safeJSONParse(changelog.profileDataSnapshot) as
      | Record<string, unknown>
      | undefined;
    return {
      success: true,
      data: {
        version: changelog.version,
        createdAt: safeToISOString(changelog.createdAt),
        profileData,
      },
    };
  } catch (error) {
    log("handleGetProfileSnapshot: error", { error: String(error) });
    return { success: false, error: "Internal error" };
  }
}

export async function handleRefreshProfile(
  userId?: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    const { getTags } = await import("./tags.js");
    const { userPromptManager } = await import("./user-prompt/user-prompt-manager.js");
    const unanalyzedCount = userPromptManager.countUnanalyzedForUserLearning();
    return {
      success: true,
      data: {
        message: "Profile refresh queued",
        unanalyzedPrompts: unanalyzedCount,
        note: "Profile will be updated when threshold is reached",
      },
    };
  } catch (error) {
    log("handleRefreshProfile: error", { error: String(error) });
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
  }
}

class MigrationProgressTracker {
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

const migrationProgress = new MigrationProgressTracker();

export function handleGetTagMigrationProgress(): ApiResponse<
  ReturnType<MigrationProgressTracker["toJSON"]>
> {
  return { success: true, data: migrationProgress.toJSON() };
}

function loadAllMemoriesWithShards(): { memory: RawMemoryRow; shard: ShardInfo }[] {
  const projectShards = shardManager.getAllShards("project", "");
  const allMemories: { memory: RawMemoryRow; shard: ShardInfo }[] = [];
  for (const shard of projectShards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const memories = db.prepare("SELECT * FROM memories").all() as RawMemoryRow[];
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

export async function handleRunTagMigrationBatch(
  batchSize = 5
): Promise<ApiResponse<{ processed: number; total: number; hasMore: boolean }>> {
  try {
    const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
    const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
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
    return { success: false, error: "Internal error" };
  }
}

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
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
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
    return { success: false, error: "Internal error" };
  }
}

export async function handleSearchTranscripts(
  query: string,
  page: number,
  pageSize: number
): Promise<
  ApiResponse<{ transcripts: TranscriptRecord[]; total: number; page: number; totalPages: number }>
> {
  try {
    const offset = (page - 1) * pageSize;
    const { transcripts, total } = transcriptManager.searchTranscripts(query, pageSize, offset);

    return {
      success: true,
      data: {
        transcripts,
        total,
        page,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    log("API error in handleSearchTranscripts", { error: String(error) });
    return { success: false, error: "Internal error searching transcripts" };
  }
}

export function handleListTranscripts(
  page: number,
  pageSize: number,
  projectPath?: string
): ApiResponse<{
  transcripts: TranscriptRecord[];
  total: number;
  page: number;
  totalPages: number;
}> {
  try {
    const { safePage, safePageSize } = sanitizeListParams(page, pageSize);
    const offset = (safePage - 1) * safePageSize;
    const maxToFetch = Math.min(offset + safePageSize, 500);
    let transcripts = transcriptManager.getRecentTranscripts(maxToFetch);
    if (projectPath) {
      transcripts = transcripts.filter((t) => t.projectPath === projectPath);
    }
    const total = transcripts.length;
    return {
      success: true,
      data: {
        transcripts: transcripts.slice(offset, offset + safePageSize),
        total,
        page: safePage,
        totalPages: Math.ceil(total / safePageSize),
      },
    };
  } catch (error) {
    log("API error in handleListTranscripts", { error: String(error) });
    return { success: false, error: "Internal error listing transcripts" };
  }
}
