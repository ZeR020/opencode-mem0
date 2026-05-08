import type {
  BackendInsertItem,
  BackendSearchResult,
  VectorBackend,
  VectorBackendSearchParams,
  VectorKind,
} from "./types.js";
import type { ShardInfo } from "../sqlite/types.js";

interface HNSWNode {
  id: string;
  vector: Float32Array;
  neighbors: Set<string>;
}

/**
 * A pure-TypeScript Navigable Small World (NSW) vector backend.
 *
 * This is a single-layer HNSW approximation that avoids native C++ dependencies.
 * It provides approximate nearest-neighbor search with O(log N) average query
 * time versus O(N) for exact scan, at the cost of approximate results.
 *
 * Parameters:
 *   M = 16           – max bidirectional edges per node
 *   efConstruction = 200 – candidate pool size during insert
 *   efSearch = 50    – candidate pool size during search
 */
export class HNSWBackend implements VectorBackend {
  private readonly graphs = new Map<string, Map<string, HNSWNode>>();
  private readonly options: {
    dimensions: number;
    M: number;
    efConstruction: number;
    efSearch: number;
  };

  constructor(options: {
    dimensions: number;
    M?: number;
    efConstruction?: number;
    efSearch?: number;
  }) {
    this.options = {
      dimensions: options.dimensions,
      M: options.M ?? 16,
      efConstruction: options.efConstruction ?? 200,
      efSearch: options.efSearch ?? 50,
    };
  }

  getBackendName(): string {
    return "hnsw";
  }

  private getGraph(indexKey: string): Map<string, HNSWNode> {
    let graph = this.graphs.get(indexKey);
    if (!graph) {
      graph = new Map();
      this.graphs.set(indexKey, graph);
    }
    return graph;
  }

  private getIndexKey(shard: ShardInfo, kind: VectorKind): string {
    return `${shard.scope}_${shard.scopeHash}_${shard.shardIndex}_${kind}`;
  }

  private cosineDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 1;

    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      dot += av * bv;
      magA += av * av;
      magB += bv * bv;
    }

    if (magA === 0 || magB === 0) return 1;
    return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  async insert(args: {
    id: string;
    vector: Float32Array;
    shard: ShardInfo;
    kind: VectorKind;
  }): Promise<void> {
    const indexKey = this.getIndexKey(args.shard, args.kind);
    const graph = this.getGraph(indexKey);

    // Remove existing node if present (upsert)
    const existing = graph.get(args.id);
    if (existing) {
      this.removeNode(graph, args.id);
    }

    // Search for neighbors BEFORE adding the new node, so the entry point
    // is always an existing node with established edges.
    let neighbors: Array<{ id: string; distance: number }> = [];
    if (graph.size > 0) {
      neighbors = this.searchKNN(graph, args.vector, this.options.M, this.options.efConstruction);
    }

    const node: HNSWNode = {
      id: args.id,
      vector: args.vector,
      neighbors: new Set(),
    };
    graph.set(args.id, node);

    for (const n of neighbors) {
      if (n.id === args.id) continue;
      const neighborNode = graph.get(n.id);
      if (!neighborNode) continue;
      node.neighbors.add(n.id);
      neighborNode.neighbors.add(args.id);

      // Prune if neighbor exceeds M connections
      if (neighborNode.neighbors.size > this.options.M) {
        this.pruneNode(graph, neighborNode);
      }
    }

    // Prune self if exceeds M
    if (node.neighbors.size > this.options.M) {
      this.pruneNode(graph, node);
    }
  }

  async insertBatch(args: {
    items: BackendInsertItem[];
    shard: ShardInfo;
    kind: VectorKind;
  }): Promise<void> {
    for (const item of args.items) {
      await this.insert({ id: item.id, vector: item.vector, shard: args.shard, kind: args.kind });
    }
  }

  async delete(args: { id: string; shard: ShardInfo; kind: VectorKind }): Promise<void> {
    const indexKey = this.getIndexKey(args.shard, args.kind);
    const graph = this.graphs.get(indexKey);
    if (!graph) return;
    this.removeNode(graph, args.id);
  }

  async search(args: VectorBackendSearchParams): Promise<BackendSearchResult[]> {
    const indexKey = this.getIndexKey(args.shard, args.kind);
    const graph = this.graphs.get(indexKey);
    if (!graph || graph.size === 0) {
      return [];
    }

    const results = this.searchKNN(graph, args.queryVector, args.limit, this.options.efSearch);
    return results.map((r) => ({ id: r.id, distance: r.distance }));
  }

  async rebuildFromShard(args: { db: unknown; shard: ShardInfo; kind: VectorKind }): Promise<void> {
    const indexKey = this.getIndexKey(args.shard, args.kind);
    const graph = new Map<string, HNSWNode>();
    this.graphs.set(indexKey, graph);

    const column = args.kind === "tags" ? "tags_vector" : "vector";
    const rows = (
      args.db as {
        prepare: (sql: string) => {
          all: () => Array<{
            id: string;
            vector?: Uint8Array | ArrayBuffer | null;
            tags_vector?: Uint8Array | ArrayBuffer | null;
          }>;
        };
      }
    )
      .prepare(`SELECT id, ${column} FROM memories WHERE ${column} IS NOT NULL`)
      .all();

    for (const row of rows) {
      const raw = args.kind === "tags" ? row.tags_vector : row.vector;
      const vector = this.decodeVector(raw);
      if (vector.length === 0) continue;

      // Search for neighbors BEFORE adding the new node
      let neighbors: Array<{ id: string; distance: number }> = [];
      if (graph.size > 0) {
        neighbors = this.searchKNN(graph, vector, this.options.M, this.options.efConstruction);
      }

      const node: HNSWNode = {
        id: row.id,
        vector,
        neighbors: new Set(),
      };
      graph.set(row.id, node);

      for (const n of neighbors) {
        if (n.id === row.id) continue;
        const neighborNode = graph.get(n.id);
        if (!neighborNode) continue;
        node.neighbors.add(n.id);
        neighborNode.neighbors.add(row.id);

        if (neighborNode.neighbors.size > this.options.M) {
          this.pruneNode(graph, neighborNode);
        }
      }

      if (node.neighbors.size > this.options.M) {
        this.pruneNode(graph, node);
      }
    }
  }

  async deleteShardIndexes(args: { shard: ShardInfo }): Promise<void> {
    for (const kind of ["content", "tags"] as const) {
      const indexKey = this.getIndexKey(args.shard, kind);
      this.graphs.delete(indexKey);
    }
  }

  /**
   * Greedy best-first search for k nearest neighbors.
   *
   * Uses a candidate pool (ef) to balance exploration vs exploitation.
   * Returns the k nearest distinct nodes sorted by ascending distance.
   */
  private searchKNN(
    graph: Map<string, HNSWNode>,
    queryVector: Float32Array,
    k: number,
    ef: number
  ): Array<{ id: string; distance: number }> {
    if (graph.size === 0) return [];

    // Pick a random entry point
    const nodes = Array.from(graph.values());
    const entryPoint = nodes[Math.floor(Math.random() * nodes.length)];
    if (!entryPoint) return [];

    const visited = new Set<string>();
    const candidates: Array<{ id: string; distance: number }> = [];

    visited.add(entryPoint.id);
    candidates.push({
      id: entryPoint.id,
      distance: this.cosineDistance(queryVector, entryPoint.vector),
    });

    let bestUnvisitedIndex = 0;

    while (bestUnvisitedIndex < candidates.length && bestUnvisitedIndex < ef) {
      const current = candidates[bestUnvisitedIndex];
      if (!current) break;
      bestUnvisitedIndex++;

      const node = graph.get(current.id);
      if (!node) continue;

      for (const neighborId of node.neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighbor = graph.get(neighborId);
        if (!neighbor) continue;

        const dist = this.cosineDistance(queryVector, neighbor.vector);
        candidates.push({ id: neighborId, distance: dist });
      }
    }

    // Sort by distance ascending and return top-k distinct ids
    candidates.sort((a, b) => a.distance - b.distance);
    const seen = new Set<string>();
    const results: Array<{ id: string; distance: number }> = [];

    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      results.push(c);
      if (results.length >= k) break;
    }

    return results;
  }

  private removeNode(graph: Map<string, HNSWNode>, id: string): void {
    const node = graph.get(id);
    if (!node) return;

    for (const neighborId of node.neighbors) {
      const neighbor = graph.get(neighborId);
      if (neighbor) {
        neighbor.neighbors.delete(id);
      }
    }

    graph.delete(id);
  }

  private pruneNode(graph: Map<string, HNSWNode>, node: HNSWNode): void {
    if (node.neighbors.size <= this.options.M) return;

    const neighborDistances: Array<{ id: string; distance: number }> = [];
    for (const neighborId of node.neighbors) {
      const neighbor = graph.get(neighborId);
      if (!neighbor) continue;
      neighborDistances.push({
        id: neighborId,
        distance: this.cosineDistance(node.vector, neighbor.vector),
      });
    }

    neighborDistances.sort((a, b) => a.distance - b.distance);
    const keep = new Set(neighborDistances.slice(0, this.options.M).map((n) => n.id));

    for (const neighborId of node.neighbors) {
      if (!keep.has(neighborId)) {
        node.neighbors.delete(neighborId);
        const neighbor = graph.get(neighborId);
        if (neighbor) {
          neighbor.neighbors.delete(node.id);
        }
      }
    }
  }

  private decodeVector(value: Uint8Array | ArrayBuffer | null | undefined): Float32Array {
    if (!value) return new Float32Array();
    if (value instanceof Uint8Array) {
      return new Float32Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      );
    }
    return new Float32Array(value);
  }
}
