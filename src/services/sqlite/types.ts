export interface ShardInfo {
  id: number;
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
  dbPath: string;
  vectorCount: number;
  isActive: boolean;
  createdAt: number;
}

export interface MemoryRecord {
  id: string;
  content: string;
  vector: Float32Array;
  tagsVector?: Float32Array;
  containerTag: string;
  tags?: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  // Scoring fields
  recencyScore?: number;
  frequencyScore?: number;
  importanceScore?: number;
  utilityScore?: number;
  noveltyScore?: number;
  confidenceScore?: number;
  interferencePenalty?: number;
  strength?: number;
  accessCount?: number;
  lastAccessed?: number;
}

export interface SearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: number;
  // Scoring fields
  strength?: number;
  recencyScore?: number;
  importanceScore?: number;
  accessCount?: number;
}
