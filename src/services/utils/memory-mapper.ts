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
import type { Memory } from "../handlers/shared-types.js";
import type { MemoryConflict } from "../sqlite/types.js";

/**
 * Canonical snake_case → camelCase mapping for a memory table row.
 */
export function mapDbRow(row: Record<string, unknown>): Memory {
  function str(field: unknown): string | undefined {
    if (field === null || field === undefined) return undefined;
    return String(field);
  }

  function num(field: unknown): number | undefined {
    if (field === null || field === undefined) return undefined;
    const n = Number(field);
    return Number.isFinite(n) ? n : undefined;
  }

  function bool(field: unknown): boolean | undefined {
    if (field === null || field === undefined) return undefined;
    return field === 1 || field === true;
  }

  function tags(field: unknown): string[] | undefined {
    if (typeof field !== "string") return undefined;
    const parsed = field
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  function jsonMeta(field: unknown): Record<string, unknown> | undefined {
    if (field === null || field === undefined) return undefined;
    if (typeof field === "object") return field as Record<string, unknown>;
    return safeJSONParse(String(field)) as Record<string, unknown> | undefined;
  }

  const createdAtRaw = num(row.created_at);
  const updatedAtRaw = num(row.updated_at);

  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    type: str(row.type),
    tags: tags(row.tags),
    createdAt: createdAtRaw ? safeToISOString(createdAtRaw) : "",
    updatedAt: updatedAtRaw ? safeToISOString(updatedAtRaw) : undefined,
    metadata: jsonMeta(row.metadata),
    displayName: str(row.display_name),
    userName: str(row.user_name),
    userEmail: str(row.user_email),
    projectPath: str(row.project_path),
    projectName: str(row.project_name),
    gitRepoUrl: str(row.git_repo_url),
    isPinned: bool(row.is_pinned),
  };
}

// ── Consumer-specific types ────────────────────────────────────────────────────

/** Shape returned by mapDbRowToListItem (list-memory API). */
export interface MemoryListItem {
  id: string;
  summary: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
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
  metadata: Record<string, unknown>;
  containerTag: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  createdAt: number;
}

// ── Thin wrappers for specific consumer shapes ────────────────────────────────

/**
 * Extended memory item for list-memory responses — includes scoring fields.
 */
export function mapDbRowToListItem(row: Record<string, unknown>): MemoryListItem {
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
export function mapDbRowToSessionResult(row: Record<string, unknown>): SessionSearchResult {
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
export function mapDbRowToConflict(row: Record<string, unknown>): MemoryConflict {
  return {
    id: String(row.id),
    memoryId1: String(row.memory_id_1 ?? ""),
    memoryId2: String(row.memory_id_2 ?? ""),
    similarityScore: Number(row.similarity_score ?? 0),
    detectedAt: Number(row.detected_at ?? 0),
    resolved: Number(row.resolved ?? 0),
    resolutionType: typeof row.resolution_type === "string" ? row.resolution_type : undefined,
    resolvedAt: row.resolved_at != null ? Number(row.resolved_at) : undefined,
    resolutionData: typeof row.resolution_data === "string" ? row.resolution_data : undefined,
    containerTag: typeof row.container_tag === "string" ? row.container_tag : undefined,
  };
}
