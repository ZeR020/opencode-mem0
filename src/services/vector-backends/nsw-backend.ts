import type {
  BackendInsertItem,
  BackendSearchResult,
  VectorBackend,
  VectorBackendSearchParams,
  VectorKind,
} from "./types.js";
import type { ShardInfo } from "../sqlite/types.js";
import { cosineDistance, decodeVector, getIndexKey, KIND_COLUMN } from "./shared.js";

interface NSWNode {
  id: string;
  vector: Float32Array;
  neighbors: Set<string>;
}

/**
 * A pure-TypeScript Navigable Small World (NSW) vector backend.
 *
 * NOTE: This is a single-layer NSW graph — NOT full multi-layer HNSW.
 * HNSW (Hierarchical NSW) uses multiple layers with an exponentially
 * decreasing density to achieve O(log N) search. This implementation
 * uses only one layer, which is simpler but degrades toward O(N) at
 * very large scales. For the typical project-memory dataset size
 * (hundreds to low-thousands of vectors), performance is acceptable.
 *
 * It avoids native C++ dependencies entirely.
 *
 * Parameters:
 *   M = 16           – max bidirectional edges per node
 *   efConstruction = 200 – candidate pool size during insert
 *   efSearch = 50    – candidate pool size during search
 */
export class NSWBackend implements VectorBackend {
  private readonly graphs = new Map<string, Map<string, NSWNode>>();
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
    return "nsw";
  }

  private getGraph(indexKey: string): Map<string, NSWNode> {
    let graph = this.graphs.get(indexKey);
    if (!graph) {
      graph = new Map();
      this.graphs.set(indexKey, graph);
    }
    return graph;
  }

  insert(args: { id: string; vector: Float32Array; shard: ShardInfo; kind: VectorKind }): void {
    const indexKey = getIndexKey(args.shard, args.kind);
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

    const node: NSWNode = {
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

  insertBatch(args: { items: BackendInsertItem[]; shard: ShardInfo; kind: VectorKind }): void {
    for (const item of args.items) {
      this.insert({ id: item.id, vector: item.vector, shard: args.shard, kind: args.kind });
    }
  }

  delete(args: { id: string; shard: ShardInfo; kind: VectorKind }): void {
    const indexKey = getIndexKey(args.shard, args.kind);
    const graph = this.graphs.get(indexKey);
    if (!graph) return;
    this.removeNode(graph, args.id);
  }

  search(args: VectorBackendSearchParams): BackendSearchResult[] {
    const indexKey = getIndexKey(args.shard, args.kind);
    const graph = this.graphs.get(indexKey);
    if (!graph || graph.size === 0) {
      return [];
    }

    const results = this.searchKNN(graph, args.queryVector, args.limit, this.options.efSearch);
    return results.map((r) => ({ id: r.id, distance: r.distance }));
  }

  rebuildFromShard(args: { db: unknown; shard: ShardInfo; kind: VectorKind }): void {
    const indexKey = getIndexKey(args.shard, args.kind);
    const graph = new Map<string, NSWNode>();
    this.graphs.set(indexKey, graph);

    const column = KIND_COLUMN[args.kind];
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
      const vector = decodeVector(raw);
      if (vector.length === 0) continue;

      // Search for neighbors BEFORE adding the new node
      let neighbors: Array<{ id: string; distance: number }> = [];
      if (graph.size > 0) {
        neighbors = this.searchKNN(graph, vector, this.options.M, this.options.efConstruction);
      }

      const node: NSWNode = {
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

  deleteShardIndexes(args: { shard: ShardInfo }): void {
    for (const kind of ["content", "tags"] as const) {
      const indexKey = getIndexKey(args.shard, kind);
      this.graphs.delete(indexKey);
    }
  }

  private selectEntryPoint(nodes: NSWNode[], queryVector: Float32Array): NSWNode | undefined {
    if (nodes.length === 0) return undefined;

    let hash = 2166136261;
    const limit = Math.min(queryVector.length, 16);
    for (let i = 0; i < limit; i += 1) {
      hash ^= Math.trunc(Math.abs(queryVector[i] ?? 0) * 1_000_000);
      hash = Math.imul(hash, 16777619);
    }

    return nodes[Math.abs(hash) % nodes.length];
  }

  /**
   * Greedy best-first search for k nearest neighbors.
   *
   * Uses a candidate pool (ef) to balance exploration vs exploitation.
   * Returns the k nearest distinct nodes sorted by ascending distance.
   */
  // NOSONAR S3776: KNN graph search algorithm with candidate pool exploration is inherently
  // complex — this is a core NSW graph traversal with priority queues and visited set tracking.
  private searchKNN(
    graph: Map<string, NSWNode>,
    queryVector: Float32Array,
    k: number,
    ef: number
  ): Array<{ id: string; distance: number }> {
    if (graph.size === 0) return [];

    // Deterministic entry point derived from query vector (avoids Math.random)
    const nodes = Array.from(graph.values());
    const entryPoint = this.selectEntryPoint(nodes, queryVector);
    if (!entryPoint) return [];

    const visited = new Set<string>();
    const candidates: Array<{ id: string; distance: number }> = [];

    visited.add(entryPoint.id);
    candidates.push({
      id: entryPoint.id,
      distance: cosineDistance(queryVector, entryPoint.vector),
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

        const dist = cosineDistance(queryVector, neighbor.vector);
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

  private removeNode(graph: Map<string, NSWNode>, id: string): void {
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

  private pruneNode(graph: Map<string, NSWNode>, node: NSWNode): void {
    if (node.neighbors.size <= this.options.M) return;

    const neighborDistances: Array<{ id: string; distance: number }> = [];
    for (const neighborId of node.neighbors) {
      const neighbor = graph.get(neighborId);
      if (!neighbor) continue;
      neighborDistances.push({
        id: neighborId,
        distance: cosineDistance(node.vector, neighbor.vector),
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
}
