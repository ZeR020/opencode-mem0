import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CONFIG } from "../src/config.js";
import {
  DeduplicationService,
  deduplicationService,
} from "../src/services/deduplication-service.js";

describe("deduplication-service", () => {
  let originalEnabled: boolean;
  let originalIngestEnabled: boolean;

  beforeEach(() => {
    originalEnabled = (CONFIG as any).deduplicationEnabled;
    originalIngestEnabled = (CONFIG as any).deduplicationIngestEnabled;
  });

  afterEach(() => {
    (CONFIG as any).deduplicationEnabled = originalEnabled;
    (CONFIG as any).deduplicationIngestEnabled = originalIngestEnabled;
  });

  it("getStatus reflects config and running state", () => {
    (CONFIG as any).deduplicationEnabled = true;
    (CONFIG as any).deduplicationSimilarityThreshold = 0.92;
    const status = deduplicationService.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.threshold).toBe(0.92);
    expect(status.isRunning).toBe(false);
  });

  it("throws when detectAndRemoveDuplicates is already running", async () => {
    const service = new DeduplicationService();
    (CONFIG as any).deduplicationEnabled = true;

    // Manually set isRunning to true via reflection
    (service as any).isRunning = true;

    await expect(service.detectAndRemoveDuplicates()).rejects.toThrow(
      "Deduplication already running"
    );
  });

  it("throws when deduplication is disabled", async () => {
    const service = new DeduplicationService();
    (CONFIG as any).deduplicationEnabled = false;

    await expect(service.detectAndRemoveDuplicates()).rejects.toThrow(
      "Deduplication is disabled in config"
    );
  });

  it("checkDuplicateAtIngest returns false when ingest dedup is disabled", async () => {
    (CONFIG as any).deduplicationIngestEnabled = false;

    const result = await deduplicationService.checkDuplicateAtIngest(
      "content",
      "opencode_project_testhash_x",
      new Float32Array(768)
    );
    expect(result).toEqual({ isDuplicate: false });
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      const sim = (deduplicationService as any).cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(1, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      const sim = (deduplicationService as any).cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(0, 5);
    });

    it("returns 0 for different lengths", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      const sim = (deduplicationService as any).cosineSimilarity(a, b);
      expect(sim).toBe(0);
    });

    it("returns 0 when both norms are zero", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([0, 0, 0]);
      const sim = (deduplicationService as any).cosineSimilarity(a, b);
      expect(sim).toBe(0);
    });
  });

  describe("_parseVectorBuffer", () => {
    it("parses valid vector buffer", () => {
      const vec = new Float32Array([0.1, 0.2, 0.3]);
      const buf = new Uint8Array(vec.buffer);
      const result = (deduplicationService as any)._parseVectorBuffer(buf);
      expect(result).not.toBeNull();
      expect(result![0]).toBeCloseTo(0.1, 6);
    });

    it("returns null for misaligned byte length", () => {
      const buf = new Uint8Array([1, 2, 3]); // 3 bytes, not multiple of 4
      const result = (deduplicationService as any)._parseVectorBuffer(buf);
      expect(result).toBeNull();
    });

    it("returns empty Float32Array for null input", () => {
      const result = (deduplicationService as any)._parseVectorBuffer(null);
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe("_parseMetadata", () => {
    it("parses JSON string metadata", () => {
      const candidate = { metadata: '{"source": "manual", "key": "val"}' };
      const result = (deduplicationService as any)._parseMetadata(candidate);
      expect(result).toEqual({ source: "manual", key: "val" });
    });

    it("returns object metadata as-is", () => {
      const candidate = { metadata: { source: "auto" } };
      const result = (deduplicationService as any)._parseMetadata(candidate);
      expect(result).toEqual({ source: "auto" });
    });

    it("returns empty object for missing metadata", () => {
      const candidate = { metadata: undefined };
      const result = (deduplicationService as any)._parseMetadata(candidate);
      expect(result).toEqual({});
    });

    it("returns empty object on JSON parse failure", () => {
      const candidate = { metadata: "{invalid" };
      const result = (deduplicationService as any)._parseMetadata(candidate);
      expect(result).toEqual({});
    });
  });

  describe("_mergeCandidateMetadata", () => {
    it("prioritizes existing metadata when new source is not manual", () => {
      const existing = { source: "auto", priority: "high" };
      const newMeta = { source: "user", extra: "val" };
      const result = (deduplicationService as any)._mergeCandidateMetadata(existing, newMeta);
      expect(result).toEqual({ source: "auto", extra: "val", priority: "high" });
    });

    it("prioritizes new metadata when source is manual", () => {
      const existing = { source: "auto", oldKey: "old" };
      const newMeta = { source: "manual", newKey: "new" };
      const result = (deduplicationService as any)._mergeCandidateMetadata(existing, newMeta);
      expect(result).toEqual({ source: "manual", oldKey: "old", newKey: "new" });
    });
  });

  describe("_findSimilarCandidate", () => {
    it("returns matching candidate above threshold", () => {
      const vec = new Float32Array([1, 0, 0]);
      const candVec = new Uint8Array(new Float32Array([1, 0, 0]).buffer);
      const candidates = [{ id: "c1", content: "test", vector: candVec }];
      const result = (deduplicationService as any)._findSimilarCandidate(vec, candidates, 0.5);
      expect(result).not.toBeNull();
      expect(result.candidate.id).toBe("c1");
    });

    it("returns null when no candidates match threshold", () => {
      const vec = new Float32Array([1, 0, 0]);
      const candVec = new Uint8Array(new Float32Array([0, 1, 0]).buffer);
      const candidates = [{ id: "c1", content: "test", vector: candVec }];
      const result = (deduplicationService as any)._findSimilarCandidate(vec, candidates, 0.99);
      expect(result).toBeNull();
    });

    it("skips candidates without vectors", () => {
      const vec = new Float32Array([1, 0, 0]);
      const candidates = [{ id: "c1", content: "test" }];
      const result = (deduplicationService as any)._findSimilarCandidate(vec, candidates, 0.5);
      expect(result).toBeNull();
    });
  });
});
