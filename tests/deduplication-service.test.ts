import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { CONFIG } from "../src/config.js";
import { shardManager } from "../src/services/sqlite/shard-manager.js";
import { vectorSearch } from "../src/services/sqlite/vector-search.js";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import {
  DeduplicationService,
  deduplicationService,
} from "../src/services/deduplication-service.js";

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: vi.fn(() => []),
    decrementVectorCount: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    getAllMemories: vi.fn(() => []),
    deleteVector: vi.fn(),
    listMemories: vi.fn(() => []),
  },
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(),
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));
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

  describe("checkDuplicateAtIngest integration", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (CONFIG as any).deduplicationIngestEnabled = true;
      (CONFIG as any).deduplicationSimilarityThreshold = 0.92;
    });

    it("returns false when no shard matches the containerTag", async () => {
      vi.mocked(shardManager.getAllShards).mockReturnValue([]);
      const result = await deduplicationService.checkDuplicateAtIngest(
        "content",
        "opencode_project_testhash_x",
        new Float32Array(768)
      );
      expect(result).toEqual({ isDuplicate: false });
    });

    it("returns false when the shard is found but there are no candidate memories", async () => {
      const shard = { id: "s1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockReturnValue([shard]);
      const mockDb = {
        prepare: vi.fn(),
      };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);
      vi.mocked(vectorSearch.listMemories).mockReturnValue([]);

      const result = await deduplicationService.checkDuplicateAtIngest(
        "content",
        "opencode_project_testhash_x",
        new Float32Array(768)
      );
      expect(result).toEqual({ isDuplicate: false });
    });

    it("returns false when candidates exist but none meet the similarity threshold", async () => {
      const shard = { id: "s1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockReturnValue([shard]);
      const mockDb = {
        prepare: vi.fn(),
      };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const vec = new Float32Array([0, 1, 0]);
      const candidates = [
        { id: "c1", content: "diff", container_tag: "tag", vector: vec.buffer, metadata: "{}" },
      ];
      vi.mocked(vectorSearch.listMemories).mockReturnValue(candidates);

      const result = await deduplicationService.checkDuplicateAtIngest(
        "content",
        "opencode_project_testhash_x",
        new Float32Array([1, 0, 0])
      );
      expect(result).toEqual({ isDuplicate: false });
    });

    it("returns true, merges metadata, and updates memory access when candidate meets threshold", async () => {
      const shard = { id: "s1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockReturnValue([shard]);

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({ run: mockRun }),
      };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const vec = new Float32Array([1, 0, 0]);
      const candidates = [
        {
          id: "c1",
          content: "same",
          container_tag: "tag",
          vector: vec.buffer,
          metadata: '{"source": "auto", "priority": "low"}',
        },
      ];
      vi.mocked(vectorSearch.listMemories).mockReturnValue(candidates);

      const result = await deduplicationService.checkDuplicateAtIngest(
        "content",
        "opencode_project_testhash_x",
        new Float32Array([0.95, 0.31, 0]),
        { source: "manual", comment: "test" }
      );

      expect(result).toEqual({ isDuplicate: true, existingId: "c1", merged: true });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE memories"));
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(Number),
        JSON.stringify({ source: "manual", priority: "low", comment: "test" }),
        "c1"
      );
    });

    it("skips candidates with malformed vectors during ingest dedup", async () => {
      const shard = { id: "s1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockReturnValue([shard]);
      const mockDb = { prepare: vi.fn() };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const candidates = [
        {
          id: "c1",
          content: "same",
          container_tag: "tag",
          vector: new Uint8Array([1, 2, 3]),
          metadata: "{}",
        },
      ];
      vi.mocked(vectorSearch.listMemories).mockReturnValue(candidates);

      const result = await deduplicationService.checkDuplicateAtIngest(
        "content",
        "opencode_project_testhash_x",
        new Float32Array([1, 0, 0])
      );
      expect(result).toEqual({ isDuplicate: false });
    });
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

  describe("detectAndRemoveDuplicates and inner branches", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (CONFIG as any).deduplicationEnabled = true;
      (CONFIG as any).deduplicationSimilarityThreshold = 0.92;
    });

    it("getStatus returns enabled:false when disabled", () => {
      (CONFIG as any).deduplicationEnabled = false;
      const status = deduplicationService.getStatus();
      expect(status.enabled).toBe(false);
    });

    it("success path: processes shards, deletes exact duplicates, groups near duplicates", async () => {
      const shard1 = { id: "shard-1", dbPath: "path-1" };
      const shard2 = { id: "shard-2", dbPath: "path-2" };
      vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) => {
        if (scope === "user") return [shard1];
        if (scope === "project") return [shard2];
        return [];
      });

      const mockDb1 = {
        prepare: vi.fn().mockReturnValue({ run: vi.fn(), all: vi.fn() }),
      };
      const mockDb2 = {
        prepare: vi.fn().mockReturnValue({ run: vi.fn(), all: vi.fn() }),
      };
      vi.mocked(connectionManager.getConnection).mockImplementation((path: string) => {
        if (path === "path-1") return mockDb1;
        if (path === "path-2") return mockDb2;
        throw new Error("Invalid path");
      });

      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0.95, 0.31, 0]);
      const vec3 = new Float32Array([0, 1, 0]);

      const mems1 = [
        {
          id: "m1",
          content: "exact",
          container_tag: "tag1",
          created_at: 1000,
          vector: vec1.buffer,
        },
        {
          id: "m2",
          content: "exact",
          container_tag: "tag1",
          created_at: 2000,
          vector: vec1.buffer,
        },
        { id: "m3", content: "diff", container_tag: "tag1", created_at: 3000, vector: vec3.buffer },
      ];

      const mems2 = [
        {
          id: "m4",
          content: "near1",
          container_tag: "tag2",
          created_at: 4000,
          vector: vec1.buffer,
        },
        {
          id: "m5",
          content: "near2",
          container_tag: "tag2",
          created_at: 5000,
          vector: vec2.buffer,
        },
      ];

      vi.mocked(vectorSearch.getAllMemories).mockImplementation((db: any) => {
        if (db === mockDb1) return mems1;
        if (db === mockDb2) return mems2;
        return [];
      });

      const result = await deduplicationService.detectAndRemoveDuplicates();

      expect(result.exactDuplicatesDeleted).toBe(1);
      expect(vectorSearch.deleteVector).toHaveBeenCalledWith(mockDb1, "m1", shard1);
      expect(shardManager.decrementVectorCount).toHaveBeenCalledWith("shard-1");

      expect(result.nearDuplicateGroups).toHaveLength(1);
      expect(result.nearDuplicateGroups[0].representative.id).toBe("m4");
      expect(result.nearDuplicateGroups[0].duplicates).toHaveLength(1);
      expect(result.nearDuplicateGroups[0].duplicates[0].id).toBe("m5");
      expect(result.nearDuplicateGroups[0].duplicates[0].similarity).toBeCloseTo(0.95, 2);
    });

    it("skips oversized shards", async () => {
      const shard = { id: "oversized-shard", dbPath: "oversized-path" };
      vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) => {
        if (scope === "user") return [shard];
        return [];
      });

      const mockDb = { prepare: vi.fn() };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const oversizedMemories = Array.from({ length: 5001 }, (_, i) => ({
        id: `m${i}`,
        content: "test",
        container_tag: "tag",
        created_at: Date.now(),
        vector: null,
      }));
      vi.mocked(vectorSearch.getAllMemories).mockReturnValue(oversizedMemories);

      const result = await deduplicationService.detectAndRemoveDuplicates();
      expect(result.exactDuplicatesDeleted).toBe(0);
      expect(result.nearDuplicateGroups).toHaveLength(0);
      expect(vectorSearch.deleteVector).not.toHaveBeenCalled();
    });

    it("handles deleteVector errors gracefully in _deleteExactDuplicates", async () => {
      const shard = { id: "shard-1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) => {
        if (scope === "user") return [shard];
        return [];
      });
      const mockDb = { prepare: vi.fn() };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const vec1 = new Float32Array([1, 0, 0]);
      const mems = [
        {
          id: "m1",
          content: "exact",
          container_tag: "tag1",
          created_at: 1000,
          vector: vec1.buffer,
        },
        {
          id: "m2",
          content: "exact",
          container_tag: "tag1",
          created_at: 2000,
          vector: vec1.buffer,
        },
      ];
      vi.mocked(vectorSearch.getAllMemories).mockReturnValue(mems);
      vi.mocked(vectorSearch.deleteVector).mockImplementation(() => {
        throw new Error("delete error");
      });

      const result = await deduplicationService.detectAndRemoveDuplicates();
      expect(result.exactDuplicatesDeleted).toBe(0); // Failed to delete
    });

    it("skips malformed vectors in _findNearDuplicates", async () => {
      const shard = { id: "shard-1", dbPath: "path-1" };
      vi.mocked(shardManager.getAllShards).mockImplementation((scope: string) => {
        if (scope === "user") return [shard];
        return [];
      });
      const mockDb = { prepare: vi.fn() };
      vi.mocked(connectionManager.getConnection).mockReturnValue(mockDb);

      const mems = [
        {
          id: "m1",
          content: "a",
          container_tag: "tag1",
          created_at: 1000,
          vector: new Uint8Array([1, 2, 3]),
        }, // malformed (fails line 136)
        {
          id: "m2",
          content: "b",
          container_tag: "tag1",
          created_at: 2000,
          vector: new Float32Array([1, 0, 0]).buffer,
        }, // valid (passes line 136)
        {
          id: "m3",
          content: "c",
          container_tag: "tag1",
          created_at: 3000,
          vector: new Uint8Array([1, 2, 3]),
        }, // malformed (fails line 169)
      ];
      vi.mocked(vectorSearch.getAllMemories).mockReturnValue(mems);

      const result = await deduplicationService.detectAndRemoveDuplicates();
      expect(result.nearDuplicateGroups).toHaveLength(0);
    });

    it("resets isRunning to false on finally block when an error is thrown", async () => {
      vi.mocked(shardManager.getAllShards).mockImplementation(() => {
        throw new Error("unhandled error");
      });

      await expect(deduplicationService.detectAndRemoveDuplicates()).rejects.toThrow(
        "unhandled error"
      );
      const status = deduplicationService.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });
});
