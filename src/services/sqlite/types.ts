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
  // Lifecycle fields
  storeType?: "stm" | "ltm";
  decayRate?: number;
  isDeprecated?: number;
}

/** JSON blob stored on a memory. Only the fields we actually read are named. */
export interface MemoryMetadata {
  promptId?: string;
  sessionID?: string;
}

export interface MemoryConflict {
  id: string;
  memoryId1: string;
  memoryId2: string;
  similarityScore: number;
  detectedAt: number;
  resolved: number;
  resolutionType?: string;
  resolvedAt?: number;
  resolutionData?: string;
  containerTag?: string;
}

export interface SearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags?: string[];
  metadata?: MemoryMetadata;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: number;
  type?: string;
  createdAt?: number;
  updatedAt?: number;
  // Scoring fields
  strength?: number;
  recencyScore?: number;
  importanceScore?: number;
  accessCount?: number;
  // Retrieval scoring fields
  vectorSimilarity?: number;
  recencyWeight?: number;
  strengthWeight?: number;
  diversityPenalty?: number;
  contextBoost?: number;
  finalScore?: number;
}
