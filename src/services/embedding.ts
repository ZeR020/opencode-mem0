import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { join } from "node:path";
import { createHash } from "node:crypto";

const TIMEOUT_MS = 30000;
const GLOBAL_EMBEDDING_KEY = Symbol.for("opencode-mem0.embedding.instance");
const MAX_CACHE_SIZE = 100;

let _transformers: {
  pipeline: (typeof import("@huggingface/transformers"))["pipeline"];
  env: (typeof import("@huggingface/transformers"))["env"];
} | null = null;

async function ensureTransformersLoaded(): Promise<NonNullable<typeof _transformers>> {
  if (_transformers !== null) return _transformers;
  const mod = await import("@huggingface/transformers");
  mod.env.allowLocalModels = true;
  mod.env.allowRemoteModels = true;
  mod.env.cacheDir = join(CONFIG.storagePath, ".cache");
  _transformers = mod;
  return _transformers;
}

export class EmbeddingService {
  private pipe: any = null;
  private initPromise: Promise<void> | null = null;
  public isWarmedUp: boolean = false;
  public embeddingAvailable: boolean = true;
  private readonly cache = new Map<string, Float32Array>();
  private cachedModelName: string | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;

  static getInstance(): EmbeddingService {
    if (!(globalThis as any)[GLOBAL_EMBEDDING_KEY]) {
      (globalThis as any)[GLOBAL_EMBEDDING_KEY] = new EmbeddingService();
    }
    return (globalThis as any)[GLOBAL_EMBEDDING_KEY];
  }

  private getHashKey(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  private getFromCache(key: string): Float32Array | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      this.cacheHits++;
      log("Embedding cache hit", {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        rate: this.hitRate(),
      });
    }
    return value;
  }

  private setInCache(key: string, value: Float32Array): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  private hitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }

  getCacheStats(): { size: number; maxSize: number; hits: number; misses: number; rate: number } {
    return {
      size: this.cache.size,
      maxSize: MAX_CACHE_SIZE,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      rate: this.hitRate(),
    };
  }

  warmup(progressCallback?: (progress: any) => void): Promise<void> {
    if (this.isWarmedUp) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initializeModel(progressCallback);
    return this.initPromise;
  }

  private async initializeModel(progressCallback?: (progress: any) => void): Promise<void> {
    try {
      if (CONFIG.embeddingApiUrl && CONFIG.embeddingApiKey) {
        this.isWarmedUp = true;
        return;
      }
      const { pipeline } = await ensureTransformersLoaded();
      this.pipe = await pipeline("feature-extraction", CONFIG.embeddingModel, {
        progress_callback: progressCallback,
      });
      this.isWarmedUp = true;
    } catch (error) {
      this.initPromise = null;
      log("Failed to initialize embedding model", { error: String(error) });
      throw error;
    }
  }

  async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    if (this.cachedModelName !== CONFIG.embeddingModel) {
      this.clearCache();
      this.cachedModelName = CONFIG.embeddingModel;
    }

    const hash = this.getHashKey(text);
    const cached = this.getFromCache(hash);
    if (cached) return new Float32Array(cached);

    this.cacheMisses++;
    log("Embedding cache miss", { misses: this.cacheMisses });

    let result: Float32Array;

    try {
      if (!this.isWarmedUp && !this.initPromise) {
        await this.warmup();
      }
      if (this.initPromise) {
        await this.initPromise;
      }

      if (CONFIG.embeddingApiUrl && CONFIG.embeddingApiKey) {
        const response = await fetch(`${CONFIG.embeddingApiUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.embeddingApiKey}`,
          },
          body: JSON.stringify({
            input: text,
            model: CONFIG.embeddingModel,
          }),
          signal,
        });

        if (!response.ok) {
          throw new Error(`API embedding failed: ${response.statusText}`);
        }

        const data: any = await response.json();
        result = new Float32Array(data.data[0].embedding);
      } else {
        const output = await this.pipe(text, { pooling: "mean", normalize: true });
        result = new Float32Array(output.data);
      }
    } catch (error) {
      this.embeddingAvailable = false;
      log("Embedding failed — falling back to text-only search", { error: String(error) });
      throw error;
    }

    this.setInCache(hash, result);

    return new Float32Array(result);
  }

  async embedWithTimeout(text: string): Promise<Float32Array> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);
    try {
      // skipcq: await required for try/catch error handling
      return await this.embed(text, abortController.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

export const embeddingService = EmbeddingService.getInstance();
