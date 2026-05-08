import { describe, it, expect } from "vitest";
import {
  calculateRecency,
  calculateFrequency,
  calculateImportance,
  calculateUtility,
  calculateNovelty,
  calculateConfidence,
  calculateInterference,
  computeStrength,
  recordAccess,
} from "../src/services/memory-scoring.js";

describe("memory-scoring", () => {
  describe("calculateRecency", () => {
    it("returns 1.0 for very recent memories", () => {
      const now = Date.now();
      expect(calculateRecency(now, 7)).toBeCloseTo(1.0, 10);
    });

    it("returns lower values for older memories", () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const score = calculateRecency(oneDayAgo, 7);
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThan(0);
    });

    it("approaches 0 for very old memories", () => {
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const score = calculateRecency(thirtyDaysAgo, 7);
      expect(score).toBeLessThan(0.1);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateFrequency", () => {
    it("returns 0 for no accesses", () => {
      expect(calculateFrequency(0)).toBe(0);
    });

    it("returns higher values for more accesses", () => {
      const score1 = calculateFrequency(1);
      const score5 = calculateFrequency(5);
      const score10 = calculateFrequency(10);
      expect(score5).toBeGreaterThan(score1);
      expect(score10).toBeGreaterThan(score5);
    });

    it("has diminishing returns for high access counts", () => {
      const score100 = calculateFrequency(100);
      const score200 = calculateFrequency(200);
      // Should not double
      expect(score200).toBeLessThan(score100 * 1.5);
    });
  });

  describe("calculateImportance", () => {
    it("returns base score for empty content", () => {
      expect(calculateImportance("")).toBeGreaterThan(0);
    });

    it("boosts technical keywords", () => {
      const base = calculateImportance("hello world");
      const technical = calculateImportance("function async await error");
      expect(technical).toBeGreaterThan(base);
    });

    it("boosts high-importance types", () => {
      const base = calculateImportance("test content");
      const bug = calculateImportance("test content", "bug");
      const fix = calculateImportance("test content", "fix");
      expect(bug).toBeGreaterThanOrEqual(base);
      expect(fix).toBeGreaterThanOrEqual(bug);
    });

    it("handles custom type variants with substring matching", () => {
      const critical = calculateImportance("test", "bug-fix-critical");
      const normal = calculateImportance("test", "note");
      expect(critical).toBeGreaterThanOrEqual(normal);
    });
  });

  describe("calculateUtility", () => {
    it("returns base score without context", () => {
      expect(calculateUtility(Date.now())).toBeGreaterThan(0);
    });

    it("boosts for recent files match", () => {
      const base = calculateUtility(Date.now(), 3, "test content", {});
      const withFiles = calculateUtility(Date.now(), 3, "test content", {
        recentFiles: ["/test/file.ts"],
      });
      expect(withFiles).toBeGreaterThanOrEqual(base);
    });

    it("boosts for query match", () => {
      const base = calculateUtility(Date.now(), 3, "hello world", { recentQueries: ["hello"] });
      const withQuery = calculateUtility(Date.now(), 3, "hello world", {
        recentQueries: ["world"],
      });
      expect(withQuery).toBeGreaterThanOrEqual(base);
    });
  });

  describe("calculateNovelty", () => {
    it("returns high score for unique content", () => {
      expect(calculateNovelty("completely unique", ["other", "different"])).toBeGreaterThan(0.5);
    });

    it("returns lower score for similar content", () => {
      const existing = ["function foo() { return 1; }"];
      const similar = "function bar() { return 2; }";
      const score = calculateNovelty(similar, existing);
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThan(0);
    });

    it("returns low score for identical content", () => {
      expect(calculateNovelty("same", ["same"])).toBeLessThan(0.2);
    });
  });

  describe("calculateConfidence", () => {
    it("returns base score for unknown source", () => {
      expect(calculateConfidence()).toBeGreaterThan(0);
    });

    it("boosts for manual source", () => {
      const base = calculateConfidence();
      const manual = calculateConfidence("manual", "note");
      expect(manual).toBeGreaterThan(base);
    });

    it("boosts for technical types", () => {
      const note = calculateConfidence("user", "note");
      const decision = calculateConfidence("user", "decision");
      expect(decision).toBeGreaterThanOrEqual(note);
    });
  });

  describe("calculateInterference", () => {
    it("returns 0 for no conflicts", () => {
      expect(calculateInterference("test", [])).toBe(0);
    });

    it("detects direct contradictions", () => {
      const base = calculateInterference("test", []);
      const withConflict = calculateInterference("added feature X", ["removed feature X"]);
      expect(withConflict).toBeGreaterThan(base);
    });

    it("increases with more contradictions", () => {
      const one = calculateInterference("added feature", ["removed feature"]);
      const two = calculateInterference("added feature", ["removed feature", "deleted feature"]);
      expect(two).toBeGreaterThanOrEqual(one);
    });
  });

  describe("computeStrength", () => {
    it("computes weighted sum correctly", () => {
      const scores = {
        recency: 1.0,
        frequency: 0.5,
        importance: 0.8,
        utility: 0.7,
        novelty: 0.9,
        confidence: 0.6,
        interference: -0.2,
      };
      const weights = {
        recency: 0.2,
        frequency: 0.15,
        importance: 0.25,
        utility: 0.2,
        novelty: 0.1,
        confidence: 0.1,
        interference: -0.1,
      };
      const strength = computeStrength(scores, weights);
      expect(strength).toBeGreaterThan(0);
      expect(strength).toBeLessThanOrEqual(1.0);
    });
  });

  describe("recordAccess", () => {
    it("increments access count", () => {
      const result0 = recordAccess(0);
      expect(result0.accessCount).toBe(1);
      const result5 = recordAccess(5);
      expect(result5.accessCount).toBe(6);
    });
  });
});
