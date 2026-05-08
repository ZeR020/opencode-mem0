import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLog = vi.fn();

vi.mock("../src/services/logger.js", () => ({
  log: mockLog,
}));

let mockConfig: any = {
  contextualDecay: {
    enabled: true,
    baseDecayRate: 0.05,
    strengthBoostFactor: 0.5,
    accessBoostFactor: 0.3,
    minDecayRate: 0.005,
    maxDecayRate: 0.15,
  },
  memoryLifecycle: {
    archiveThreshold: 0.2,
    archiveAfterDays: 30,
    checkIntervalMinutes: 60,
  },
};

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(() => ({
      prepare: vi.fn(() => ({
        get: vi.fn(),
        all: vi.fn(() => []),
        run: vi.fn(),
      })),
      run: vi.fn(),
    })),
  },
}));

vi.mock("../src/services/sqlite/shard-manager.js", () => ({
  shardManager: {
    getAllShards: vi.fn(() => []),
    decrementVectorCount: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/vector-search.js", () => ({
  vectorSearch: {
    deleteVector: vi.fn(),
  },
}));

const { classifyMemory, calculateContextualDecayRate } =
  await import("../src/services/memory-lifecycle.js");

describe("contextual-decay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      contextualDecay: {
        enabled: true,
        baseDecayRate: 0.05,
        strengthBoostFactor: 0.5,
        accessBoostFactor: 0.3,
        minDecayRate: 0.005,
        maxDecayRate: 0.15,
      },
      memoryLifecycle: {
        archiveThreshold: 0.2,
        archiveAfterDays: 30,
        checkIntervalMinutes: 60,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateContextualDecayRate", () => {
    it("returns min decay rate for strong, frequently accessed memories", () => {
      // strength=0.9, access_count=10
      // With formula, this should hit the minimum bound
      const rate = calculateContextualDecayRate("bug-fix", 0.9, 10, false);
      expect(rate).toBe(0.005);
    });

    it("returns elevated decay rate for weak, rarely accessed memories", () => {
      // strength=0.3, access_count=1
      // Should be higher than baseRate (0.05) or at least in elevated range
      const rate = calculateContextualDecayRate("bug-fix", 0.3, 1, false);
      expect(rate).toBeGreaterThan(0.005);
      expect(rate).toBeLessThan(0.15);
    });

    it("returns moderate decay rate for average strength and access", () => {
      // strength=0.6, access_count=3
      // Should be in the middle range
      const rate = calculateContextualDecayRate("bug-fix", 0.6, 3, false);
      expect(rate).toBeGreaterThan(0.005);
      expect(rate).toBeLessThan(0.05);
      expect(rate).toBeGreaterThan(0.01);
      expect(rate).toBeLessThan(0.04);
    });

    it("returns 0.0 for pinned memories regardless of strength or access count", () => {
      const rate = calculateContextualDecayRate("bug-fix", 0.3, 1, true);
      expect(rate).toBe(0.0);
    });

    it("returns 0.0 for hard LTM types regardless of strength or access count", () => {
      const rate1 = calculateContextualDecayRate("preference", 0.3, 1, false);
      const rate2 = calculateContextualDecayRate("decision", 0.9, 100, false);
      const rate3 = calculateContextualDecayRate("constraint", 0.5, 5, false);
      expect(rate1).toBe(0.0);
      expect(rate2).toBe(0.0);
      expect(rate3).toBe(0.0);
    });

    it("falls back to static classifyMemory rates when contextual decay is disabled", () => {
      mockConfig.contextualDecay.enabled = false;

      const rate1 = calculateContextualDecayRate("chat", 0.3, 1, false);
      expect(rate1).toBe(0.05);

      const rate2 = calculateContextualDecayRate("guide", 0.3, 1, false);
      expect(rate2).toBe(0.01);

      const rate3 = calculateContextualDecayRate("preference", 0.3, 1, false);
      expect(rate3).toBe(0.0);
    });

    it("clamps decay rate between min and max bounds", () => {
      // Test min clamp with very strong/frequent memory
      const rate1 = calculateContextualDecayRate("bug-fix", 0.99, 100, false);
      expect(rate1).toBeGreaterThanOrEqual(0.005);

      // Test max clamp by temporarily raising baseDecayRate
      const originalBase = mockConfig.contextualDecay.baseDecayRate;
      mockConfig.contextualDecay.baseDecayRate = 0.2;
      const rate2 = calculateContextualDecayRate("chat", 0.01, 0, false);
      expect(rate2).toBe(0.15);
      mockConfig.contextualDecay.baseDecayRate = originalBase;
    });
  });

  describe("classifyMemory backward compatibility", () => {
    it("maintains original signature and static rates", () => {
      const result1 = classifyMemory("chat");
      expect(result1).toEqual({ storeType: "stm", decayRate: 0.05 });

      const result2 = classifyMemory("preference");
      expect(result2).toEqual({ storeType: "ltm", decayRate: 0.0 });

      const result3 = classifyMemory("guide");
      expect(result3).toEqual({ storeType: "ltm", decayRate: 0.01 });

      const result4 = classifyMemory();
      expect(result4).toEqual({ storeType: "stm", decayRate: 0.05 });
    });
  });
});
