// Shared types used across handler modules — extracted from api-handlers.ts

import type { MemoryMetadata } from "../sqlite/types.js";

export type { MemoryMetadata };

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

export interface FormattedConflict {
  id: string;
  memoryId1: string;
  memoryId2: string;
  memory1Content?: string;
  memory2Content?: string;
  similarityScore: number;
  detectedAt: string;
  resolved: boolean;
  resolutionType?: string;
  resolvedAt?: string;
}

/** Raw row shape from the memories table */
export interface RawMemoryRow {
  id: string;
  content: string;
  type?: string | null;
  tags?: string | null;
  metadata?: string | null;
  created_at: number | string;
  updated_at?: number | string | null;
  container_tag?: string | null;
  display_name?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  project_path?: string | null;
  project_name?: string | null;
  git_repo_url?: string | null;
  is_pinned?: number | null;
}

export interface TimelineMemoryItem extends Omit<Memory, "createdAt" | "updatedAt" | "type"> {
  type: "memory";
  memoryType?: string;
  createdAt: number;
  updatedAt?: number;
  linkedPromptId?: string;
}

export interface TimelinePromptItem {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  projectPath?: string | null;
  linkedMemoryId?: string | null;
}

export type TimelineItem = TimelineMemoryItem | TimelinePromptItem;

export interface LinkedTimelinePair {
  memory: TimelineMemoryItem | null;
  prompt: TimelinePromptItem | null;
}

export interface Memory {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  metadata?: MemoryMetadata;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

export type FormattedTimelineItem =
  | {
      type: "memory";
      id: string;
      content: string;
      memoryType?: string;
      tags?: string[];
      createdAt: string;
      updatedAt?: string;
      metadata?: MemoryMetadata;
      linkedPromptId?: string;
      displayName?: string;
      userName?: string;
      userEmail?: string;
      projectPath?: string;
      projectName?: string;
      gitRepoUrl?: string;
      isPinned?: boolean;
    }
  | {
      type: "prompt";
      id: string;
      sessionId: string;
      content: string;
      createdAt: string;
      projectPath?: string | null;
      linkedMemoryId?: string | null;
    };

export interface UserPrompt {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  projectPath?: string | null;
  linkedMemoryId?: string | null;
}
