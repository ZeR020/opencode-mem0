/**
 * Canonical row-to-object mapper for memory queries.
 *
 * All snake_case SQL column rows flow through this module so every consumer
 * gets the same camelCase Memory shape, preventing field mapping drift.
 *
 * Thin wrappers (mapDbRowToListItem, mapDbRowToSessionResult, mapDbRowToConflict)
 * call mapDbRow then pick or adjust the subset of fields their caller expects.
 */

import { safeToISOString, safeJSONParse } from "./safe-transforms.js";
import type { Memory, RawMemoryRow } from "../handlers/shared-types.js";
import type { MemoryConflict, MemoryMetadata } from "../sqlite/types.js";

function parseTagList(field: string | null | undefined): string[] | undefined {
  if (field == null) return undefined;
  const parsed = field
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function parseMetadata(field: string | null | undefined): MemoryMetadata | undefined {
  if (field == null) return undefined;
  return safeJSONParse<MemoryMetadata>(field);
}

function asString(field: string | number | null | undefined): string | undefined {
  if (field == null) return undefined;
  return String(field);
}

/**
 * Canonical snake_case → camelCase mapping for a memory table row.
 */
export function mapDbRow(row: RawMemoryRow): Memory {
  const createdAtRaw = Number(row.created_at);
  const updatedAtRaw = row.updated_at == null ? undefined : Number(row.updated_at);

  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    type: asString(row.type),
    tags: parseTagList(row.tags),
    createdAt: createdAtRaw ? safeToISOString(createdAtRaw) : "",
    updatedAt: updatedAtRaw ? safeToISOString(updatedAtRaw) : undefined,
    metadata: parseMetadata(row.metadata),
    displayName: asString(row.display_name),
    userName: asString(row.user_name),
    userEmail: asString(row.user_email),
    projectPath: asString(row.project_path),
    projectName: asString(row.project_name),
    gitRepoUrl: asString(row.git_repo_url),
    isPinned: row.is_pinned == null ? undefined : row.is_pinned === 1,
  };
}

// ── Consumer-specific types ────────────────────────────────────────────────────

/** Extra numeric columns read by mapDbRowToListItem / mapDbRowToSessionResult. */
export type ScoredMemoryRow = RawMemoryRow & {
  strength?: number | null;
  recency_score?: number | null;
  frequency_score?: number | null;
  importance_score?: number | null;
  utility_score?: number | null;
  novelty_score?: number | null;
  confidence_score?: number | null;
  interference_penalty?: number | null;
  access_count?: number | null;
  similarity?: number | null;
};

/** Shape returned by mapDbRowToListItem (list-memory API). */
export interface MemoryListItem {
  id: string;
  summary: string;
  createdAt: string;
  metadata?: MemoryMetadata;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  strength: number;
  recencyScore: number;
  frequencyScore: number;
  importanceScore: number;
  utilityScore: number;
  noveltyScore: number;
  confidenceScore: number;
  interferencePenalty: number;
  accessCount: number;
  isPinned: boolean;
}

/** Shape returned by mapDbRowToSessionResult (session-search API). */
export interface SessionSearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags: string[];
  metadata: MemoryMetadata;
  containerTag: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  createdAt: number;
}

type ConflictDbRow = {
  id: string;
  memory_id_1?: string | null;
  memory_id_2?: string | null;
  similarity_score?: number | null;
  detected_at?: number | null;
  resolved?: number | null;
  resolution_type?: string | null;
  resolved_at?: number | null;
  resolution_data?: string | null;
  container_tag?: string | null;
};

// ── Thin wrappers for specific consumer shapes ────────────────────────────────

/**
 * Extended memory item for list-memory responses — includes scoring fields.
 */
export function mapDbRowToListItem(row: ScoredMemoryRow): MemoryListItem {
  const base = mapDbRow(row);
  return {
    id: base.id,
    summary: base.content,
    createdAt: base.createdAt,
    metadata: base.metadata,
    displayName: base.displayName,
    userName: base.userName,
    userEmail: base.userEmail,
    projectPath: base.projectPath,
    projectName: base.projectName,
    gitRepoUrl: base.gitRepoUrl,
    strength: Number(row.strength ?? 0),
    recencyScore: Number(row.recency_score ?? 0),
    frequencyScore: Number(row.frequency_score ?? 0),
    importanceScore: Number(row.importance_score ?? 0),
    utilityScore: Number(row.utility_score ?? 0),
    noveltyScore: Number(row.novelty_score ?? 0),
    confidenceScore: Number(row.confidence_score ?? 0),
    interferencePenalty: Number(row.interference_penalty ?? 0),
    accessCount: Number(row.access_count ?? 0),
    isPinned: base.isPinned ?? false,
  };
}

/**
 * Session-search result shape — uses `memory` instead of `content` and
 * includes similarity + containerTag.
 */
export function mapDbRowToSessionResult(row: ScoredMemoryRow): SessionSearchResult {
  const base = mapDbRow(row);
  return {
    id: base.id,
    memory: base.content,
    similarity: Number(row.similarity ?? 1),
    tags: base.tags ?? [],
    metadata: base.metadata ?? {},
    containerTag: String(row.container_tag ?? ""),
    displayName: base.displayName,
    userName: base.userName,
    userEmail: base.userEmail,
    projectPath: base.projectPath,
    projectName: base.projectName,
    gitRepoUrl: base.gitRepoUrl,
    createdAt: Number(row.created_at ?? 0),
  };
}

/**
 * Conflict row → MemoryConflict.
 */
export function mapDbRowToConflict(row: ConflictDbRow): MemoryConflict {
  return {
    id: String(row.id),
    memoryId1: String(row.memory_id_1 ?? ""),
    memoryId2: String(row.memory_id_2 ?? ""),
    similarityScore: Number(row.similarity_score ?? 0),
    detectedAt: Number(row.detected_at ?? 0),
    resolved: Number(row.resolved ?? 0),
    resolutionType: row.resolution_type ?? undefined,
    resolvedAt: row.resolved_at != null ? Number(row.resolved_at) : undefined,
    resolutionData: row.resolution_data ?? undefined,
    containerTag: row.container_tag ?? undefined,
  };
}
