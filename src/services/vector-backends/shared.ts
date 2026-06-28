import type { ShardInfo } from "../sqlite/types.js";
import type { VectorKind } from "./types.js";

export function decodeVector(value: Uint8Array | ArrayBuffer | null | undefined): Float32Array {
  if (!value) return new Float32Array();
  if (value instanceof Uint8Array) {
    return new Float32Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    );
  }
  return new Float32Array(value);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function getIndexKey(shard: ShardInfo, kind: VectorKind): string {
  return `${shard.scope}_${shard.scopeHash}_${shard.shardIndex}_${kind}`;
}

export const KIND_COLUMN: Record<string, string> = {
  content: "vector",
  tags: "tags_vector",
};
