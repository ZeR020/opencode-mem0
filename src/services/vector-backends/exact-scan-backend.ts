import type {
  BackendInsertItem,
  BackendSearchResult,
  VectorBackend,
  VectorBackendSearchParams,
  VectorKind,
} from "./types.js";
import type { ShardInfo } from "../sqlite/types.js";
import { cosineSimilarity, decodeVector, KIND_COLUMN } from "./shared.js";

interface RankedRow {
  id: string;
  vector: Float32Array;
}

interface VectorRow {
  id: string;
  vector?: Uint8Array | ArrayBuffer | null;
  tags_vector?: Uint8Array | ArrayBuffer | null;
}

export class ExactScanBackend implements VectorBackend {
  getBackendName(): string {
    return "exact-scan";
  }

  rankVectors(rows: RankedRow[], queryVector: Float32Array, limit: number): BackendSearchResult[] {
    return rows
      .map((row) => ({
        id: row.id,
        distance: 1 - cosineSimilarity(row.vector, queryVector),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  insert(_args: { id: string; vector: Float32Array; shard: ShardInfo; kind: VectorKind }): void {
    // No-op: exact-scan searches directly from SQLite, no index to maintain
  }

  insertBatch(_args: { items: BackendInsertItem[]; shard: ShardInfo; kind: VectorKind }): void {
    // No-op: exact-scan searches directly from SQLite, no index to maintain
  }

  delete(_args: { id: string; shard: ShardInfo; kind: VectorKind }): void {
    // No-op: exact-scan searches directly from SQLite, no index to maintain
  }

  search(args: VectorBackendSearchParams): BackendSearchResult[] {
    const column = KIND_COLUMN[args.kind];
    if (!column) {
      throw new Error(`Invalid vector kind: ${args.kind}`);
    }
    const rows = (
      args.db as {
        prepare: (sql: string) => { all: () => VectorRow[] };
      }
    )
      .prepare(
        `SELECT id, ${column} FROM memories WHERE ${column} IS NOT NULL AND is_deprecated = 0`
      )
      .all();

    if (rows.length === 0) {
      return [];
    }

    const rankedRows: RankedRow[] = rows
      .map((row) => ({
        id: row.id,
        vector: decodeVector(args.kind === "tags" ? row.tags_vector : row.vector),
      }))
      .filter((row) => row.vector.length > 0);

    return this.rankVectors(rankedRows, args.queryVector, args.limit);
  }

  rebuildFromShard(_args: { db: unknown; shard: ShardInfo; kind: VectorKind }): void {
    // No-op: exact-scan searches directly from SQLite, no index to rebuild
  }

  deleteShardIndexes(_args: { shard: ShardInfo }): void {
    // No-op: exact-scan searches directly from SQLite, no index to delete
  }
}
