import { randomBytes } from "node:crypto";
import { embeddingService } from "../embedding.js";
import { shardManager } from "../sqlite/shard-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { log } from "../logger.js";
import { memoryClient } from "../client.js";
import { safeJSONParse } from "../utils/safe-transforms.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import type { MemoryType } from "../../types/index.js";
import {
  extractScopeFromTag,
  sanitizeListParams,
  findMemoryInShards,
  fetchMemoriesForList,
  mapRawMemoryToTyped,
  buildPaginatedTimeline,
  formatTimelineItem,
} from "./shared.js";
import type { ApiResponse, PaginatedResponse, TagInfo } from "./shared-types.js";

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
    return { success: false, error: "Internal error in handleListTags" };
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
    return { success: false, error: "Internal error in handleListMemories" };
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
}): Promise<ApiResponse<{ id: string; duplicate?: boolean }>> {
  if (!data.content || !data.containerTag) {
    return { success: false, error: "content and containerTag are required" };
  }
  // Delegate to memoryClient so the API path gets the same ingest-time
  // deduplication (checkDuplicateAtIngest) and conflict detection
  // (detectConflicts) as the in-agent memory tool. Re-implementing the
  // embedding/insert here previously bypassed both.
  const tags = (data.tags || []).map((t) => t.trim().toLowerCase());
  const result = await memoryClient.addMemory(data.content, data.containerTag, {
    source: "api",
    type: data.type,
    tags,
    displayName: data.displayName,
    userName: data.userName,
    userEmail: data.userEmail,
    projectPath: data.projectPath,
    projectName: data.projectName,
    gitRepoUrl: data.gitRepoUrl,
  });
  if (result.success) {
    return { success: true, data: { id: result.id, duplicate: result.duplicate } };
  }
  return { success: false, error: result.error ?? "Internal error in handleAddMemory" };
}

export function handleGetMemory(id: string): ApiResponse<unknown> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const found = findMemoryInShards(id);
    if (!found) return { success: false, error: "Memory not found" };
    return { success: true, data: formatTimelineItem(mapRawMemoryToTyped(found.memory)) };
  } catch (error) {
    log("handleGetMemory: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetMemory" };
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
    return { success: false, error: "Internal error in handleDeleteMemory" };
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
    return { success: false, error: "Internal error in handleBulkDelete" };
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
    return { success: false, error: "Internal error in handleUpdateMemory" };
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
    return { success: false, error: "Internal error in handlePinMemory" };
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
    return { success: false, error: "Internal error in handleUnpinMemory" };
  }
}
