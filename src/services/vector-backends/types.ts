import type { ShardInfo } from "../sqlite/types.js";

export type VectorKind = "content" | "tags";

export interface BackendSearchResult {
  id: string;
  distance: number;
}

export interface BackendInsertItem {
  id: string;
  vector: Float32Array;
}

export interface VectorBackendSearchParams {
  db: unknown;
  shard: ShardInfo;
  kind: VectorKind;
  queryVector: Float32Array;
  limit: number;
}

export interface VectorBackend {
  getBackendName(): string;
  insert(args: {
    id: string;
    vector: Float32Array;
    shard: ShardInfo;
    kind: VectorKind;
  }): void | Promise<void>;
  insertBatch(args: {
    items: BackendInsertItem[];
    shard: ShardInfo;
    kind: VectorKind;
  }): void | Promise<void>;
  delete(args: { id: string; shard: ShardInfo; kind: VectorKind }): void | Promise<void>;
  search(args: VectorBackendSearchParams): BackendSearchResult[] | Promise<BackendSearchResult[]>;
  rebuildFromShard(args: { db: unknown; shard: ShardInfo; kind: VectorKind }): void | Promise<void>;
  deleteShardIndexes(args: { shard: ShardInfo }): void | Promise<void>;
}

export interface VectorBackendFactoryOptions {
  vectorBackend: "usearch-first" | "usearch" | "exact-scan";
  probeUSearch?: () => Promise<boolean>;
  createUSearchBackend?: () => VectorBackend;
}
