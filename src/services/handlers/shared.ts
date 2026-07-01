import {
  shardManager,
  getAllShards,
  extractScopeFromContainerTag,
} from "../sqlite/shard-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { safeToISOString } from "../utils/safe-transforms.js";
import { mapDbRow } from "../utils/memory-mapper.js";
import type {
  RawMemoryRow,
  TimelineMemoryItem,
  TimelinePromptItem,
  TimelineItem,
  LinkedTimelinePair,
  UserPrompt,
} from "./shared-types.js";
import type { ShardInfo } from "../sqlite/types.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";

// Re-export for convenience
export type { RawMemoryRow } from "./shared-types.js";
export type { ShardInfo } from "../sqlite/types.js";

// ── Named limits (replaces inline magic numbers) ──────────────────────────────

/** Maximum memories returned in a list-memories query. */
const MAX_LIST_MEMORIES = 2000;

/** Maximum items in a paginated timeline before truncation. */
const MAX_TIMELINE_ITEMS = 2500;

/** Maximum search results before truncation. Also referenced by search.ts. */
export const MAX_SEARCH_RESULTS = 2000;

// ── Shared helpers ───────────────────────────────────────────────────────────

export const extractScopeFromTag = (tag: string) => extractScopeFromContainerTag(tag, "project");

export function sanitizeListParams(
  page: number,
  pageSize: number
): { safePage: number; safePageSize: number } {
  const safePage = Number.isFinite(page) && page > 0 ? Math.min(Math.floor(page), 10000) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0 && pageSize <= 100 ? Math.floor(pageSize) : 20;
  return { safePage, safePageSize };
}

export function findMemoryInShards(id: string): { shard: ShardInfo; memory: RawMemoryRow } | null {
  for (const shard of getAllShards()) {
    const db = connectionManager.getConnection(shard.dbPath);
    const memory = vectorSearch.getMemoryById(db, id);
    if (memory) return { shard, memory };
  }
  return null;
}

export function getProjectPathFromTag(tag: string): string | undefined {
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

export function fetchMemoriesForList(
  tag: string | undefined,
  perShardLimit: number
): RawMemoryRow[] {
  let allMemories: RawMemoryRow[] = [];
  if (tag) {
    const { scope: tagScope, hash } = extractScopeFromTag(tag);
    const shards = shardManager.getAllShards(tagScope, hash);
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.listMemories(db, tag, perShardLimit) as RawMemoryRow[];
      allMemories = allMemories.concat(memories);
    }
  } else {
    const shards = shardManager.getAllShards("project", "");
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.listMemories(db, "", perShardLimit) as RawMemoryRow[];
      allMemories = allMemories.concat(
        memories.filter((m) => m.container_tag?.includes("_project_"))
      );
    }
    const userShards = shardManager.getAllShards("user", "");
    for (const shard of userShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.listMemories(db, "", perShardLimit) as RawMemoryRow[];
      allMemories = allMemories.concat(memories.filter((m) => m.container_tag?.includes("_user_")));
    }
  }
  if (allMemories.length > MAX_LIST_MEMORIES) {
    allMemories = allMemories.slice(0, MAX_LIST_MEMORIES);
  }
  return allMemories;
}

export function mapRawMemoryToTyped(r: RawMemoryRow): TimelineMemoryItem {
  const base = mapDbRow(r as unknown as Record<string, unknown>);
  const linkedPromptId = base.metadata?.promptId;
  return {
    type: "memory",
    id: r.id,
    content: base.content,
    memoryType: base.type,
    tags: base.tags || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : undefined,
    metadata: base.metadata,
    linkedPromptId: typeof linkedPromptId === "string" ? linkedPromptId : undefined,
    displayName: base.displayName,
    userName: base.userName,
    userEmail: base.userEmail,
    projectPath: base.projectPath,
    projectName: base.projectName,
    gitRepoUrl: base.gitRepoUrl,
    isPinned: base.isPinned,
  };
}

export function buildPaginatedTimeline(
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

  if (timeline.length > MAX_TIMELINE_ITEMS) {
    timeline = timeline.slice(0, MAX_TIMELINE_ITEMS);
  }

  const linkedPairs = new Map<string, LinkedTimelinePair>();
  const standalone: TimelineItem[] = [];
  for (const item of timeline) {
    if (item.type === "memory" && item.linkedPromptId && includePrompts) {
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

  let sortedTimeline: TimelineItem[] = [];
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
  sortedTimeline = sortedTimeline.concat(standalone);

  const total = sortedTimeline.length;
  const totalPages = Math.ceil(total / safePageSize);
  const offset = (safePage - 1) * safePageSize;
  const paginatedResults = sortedTimeline.slice(offset, offset + safePageSize);

  return { items: paginatedResults, total, totalPages };
}

export function formatTimelineItem(item: TimelineItem): Record<string, unknown> {
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
