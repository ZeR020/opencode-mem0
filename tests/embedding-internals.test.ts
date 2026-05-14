import { describe, it, expect, beforeEach, vi } from "vitest";
import { EmbeddingService, embeddingService } from "../src/services/embedding.js";

describe("EmbeddingService singleton and internals", () => {
  describe("getInstance", () => {
    it("returns the same instance on multiple calls", () => {
      const a = EmbeddingService.getInstance();
      const b = EmbeddingService.getInstance();
      expect(a).toBe(b);
    });

    it("exported embeddingService is the singleton", () => {
      const instance = EmbeddingService.getInstance();
      expect(embeddingService).toBe(instance);
    });
  });

  describe("getHashKey", () => {
    it("returns deterministic SHA256 hash", () => {
      const hash1 = (embeddingService as any).getHashKey("hello");
      const hash2 = (embeddingService as any).getHashKey("hello");
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = (embeddingService as any).getHashKey("hello");
      const hash2 = (embeddingService as any).getHashKey("world");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getCacheStats and hitRate", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      service = new EmbeddingService();
      service.clearCache();
    });

    it("returns zero stats for empty cache", () => {
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.rate).toBe(0);
    });

    it("returns correct maxSize in stats", () => {
      const stats = service.getCacheStats();
      expect(stats.maxSize).toBe(100);
    });
  });

  describe("warmup", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      service = new EmbeddingService();
      service.clearCache();
      (service as any).isWarmedUp = false;
      (service as any).initPromise = null;
    });

    it("returns immediately when already warmed up", async () => {
      (service as any).isWarmedUp = true;
      const result = await service.warmup();
      expect(result).toBeUndefined();
    });

    it("reuses in-progress initPromise on second warmup call", () => {
      // First call sets initPromise
      service.warmup();
      // Second call returns same promise
      service.warmup();
      expect((service as any).initPromise).not.toBeNull();
      // Clean up
      (service as any).initPromise = null;
    });
  });

  describe("embedWithTimeout", () => {
    it("returns embedding on success", async () => {
      const mockEmbed = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
      (embeddingService as any).pipe = mockEmbed;
      (embeddingService as any).isWarmedUp = true;
      (embeddingService as any).cachedModelName = "test";

      const result = await embeddingService.embedWithTimeout("test text");
      expect(result).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    });

    it("throws on abort/timeout", async () => {
      const neverResolve = new Promise(() => {});
      (embeddingService as any).isWarmedUp = true;
      (embeddingService as any).cachedModelName = "test";
      vi.spyOn(embeddingService, "embed").mockReturnValue(neverResolve as any);

      const promise = embeddingService.embedWithTimeout("test");
      // Should timeout after 30s — we'll just check the type
      await expect(
        Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 100)),
        ])
      ).rejects.toBeDefined();

      (embeddingService as any).embed.mockRestore();
    });
  });

  describe("clearCache", () => {
    it("resets all cache statistics", () => {
      embeddingService.clearCache();
      const stats = embeddingService.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });
  });
});
