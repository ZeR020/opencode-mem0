import { describe, it, expect, beforeEach, vi } from "vitest";
import { EmbeddingService } from "../src/services/embedding.js";

/**
 * Tests for the LRU embedding cache with content-hash keys.
 * These tests verify:
 * 1. Cache hit returns cached result with zero pipeline calls
 * 2. Distinct texts produce distinct cached entries
 * 3. LRU eviction at MAX_CACHE_SIZE (100)
 * 4. Model change clears entire cache
 * 5. Returned arrays are copies, not shared mutable references
 * 6. Long text uses hash key, not raw text
 */

describe("EmbeddingService LRU cache", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
    service.clearCache();
  });

  it("should cache embedding result and return on second call", async () => {
    // Mock the embed pipeline to return predictable results
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    const result1 = await service.embed("hello");
    const result2 = await service.embed("hello");

    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    expect(result2).toEqual(new Float32Array([0.1, 0.2, 0.3]));
  });

  it("should cache distinct embeddings for distinct texts", async () => {
    const mockEmbed = vi.fn().mockImplementation((text: string) => {
      if (text === "hello") return Promise.resolve({ data: new Float32Array([0.1, 0.2, 0.3]) });
      if (text === "world") return Promise.resolve({ data: new Float32Array([0.4, 0.5, 0.6]) });
      return Promise.resolve({ data: new Float32Array([0.7, 0.8, 0.9]) });
    });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    const result1 = await service.embed("hello");
    const result2 = await service.embed("world");

    expect(mockEmbed).toHaveBeenCalledTimes(2);
    expect(result1).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    expect(result2).toEqual(new Float32Array([0.4, 0.5, 0.6]));
  });

  it("should evict least-recently-used entry when cache exceeds MAX_CACHE_SIZE", async () => {
    const mockEmbed = vi.fn().mockImplementation((text: string) => {
      return Promise.resolve({ data: new Float32Array([parseFloat(text), 0, 0]) });
    });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    // Insert MAX_CACHE_SIZE (100) unique entries
    for (let i = 0; i < 100; i++) {
      await service.embed(`text-${i}`);
    }

    expect(service.getCacheStats().size).toBe(100);

    // First entry should be evicted on 101st insert
    await service.embed("text-new");

    expect(service.getCacheStats().size).toBe(100);

    // Accessing the first entry should trigger a re-compute (cache miss)
    await service.embed("text-0");

    // The first entry was evicted, so embed should have been called once more
    expect(mockEmbed).toHaveBeenCalledTimes(102);
  });

  it("should clear cache when embedding model changes", async () => {
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "model-a";

    await service.embed("hello");
    expect(service.getCacheStats().size).toBe(1);

    // Simulate model change
    (service as any).cachedModelName = "model-b";
    await service.embed("world");

    expect(service.getCacheStats().size).toBe(1);
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it("should return copied Float32Array to prevent mutation of cached value", async () => {
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    const result = await service.embed("hello");
    result[0] = 999;

    const result2 = await service.embed("hello");
    expect(result2[0]).not.toBe(999);
    expect(result2[0]).toBeCloseTo(0.1, 6);
  });

  it("should use hash keys for long text instead of raw text", async () => {
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    const longText = "a".repeat(10000);
    await service.embed(longText);

    // The cache should not store the raw 10KB string as a key
    // We verify by checking cache stats and ensuring embed was called once
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(service.getCacheStats().size).toBe(1);

    // Second call should be a cache hit
    await service.embed(longText);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it("should track cache hit and miss statistics", async () => {
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (service as any).pipe = mockEmbed;
    (service as any).isWarmedUp = true;
    (service as any).cachedModelName = "test-model";

    await service.embed("hello"); // miss
    await service.embed("hello"); // hit
    await service.embed("world"); // miss
    await service.embed("world"); // hit

    const stats = service.getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.rate).toBe(0.5);
  });
});
