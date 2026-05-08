import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleEmbeddingCacheStats } from "../src/services/api-handlers.js";
import { embeddingService } from "../src/services/embedding.js";

describe("handleEmbeddingCacheStats", () => {
  beforeEach(() => {
    embeddingService.clearCache();
  });

  it("should return cache stats with zero hits/misses when empty", async () => {
    const result = await handleEmbeddingCacheStats();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      size: 0,
      maxSize: 100,
      hits: 0,
      misses: 0,
      rate: 0,
    });
  });

  it("should return updated stats after cache operations", async () => {
    // Seed the cache by calling embed with a mocked pipeline
    const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
    (embeddingService as any).pipe = mockEmbed;
    (embeddingService as any).isWarmedUp = true;
    (embeddingService as any).cachedModelName = "test-model";

    await embeddingService.embed("hello"); // miss
    await embeddingService.embed("hello"); // hit
    await embeddingService.embed("world"); // miss

    const result = await handleEmbeddingCacheStats();
    expect(result.success).toBe(true);
    expect(result.data?.size).toBe(2);
    expect(result.data?.hits).toBe(1);
    expect(result.data?.misses).toBe(2);
    expect(result.data?.rate).toBeCloseTo(1 / 3, 5);
  });
});
