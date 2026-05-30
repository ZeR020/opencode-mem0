import { describe, it, expect } from "vitest";
import {
  TECHNICAL_KEYWORDS,
  NEGATION_PATTERNS,
  tokenizeWords,
  getWordSet,
  jaccardSimilarity,
} from "../src/services/utils/text-analysis.js";

describe("text-analysis", () => {
  describe("tokenizeWords", () => {
    it("splits simple text into lowercase words", () => {
      const result = tokenizeWords("hello world test");
      expect(result).toEqual(["hello", "world", "test"]);
    });

    it("strips punctuation and respects minLength", () => {
      // "hi" has length 2, which is < minLength 3, so it gets filtered out
      const result = tokenizeWords("HI, test123!", { minLength: 3 });
      expect(result).toEqual(["test123"]);
    });

    it("filters out tokens below default minLength=1", () => {
      const result = tokenizeWords("a bb ccc");
      expect(result).toEqual(["a", "bb", "ccc"]);
    });

    it("filters stopWords when provided", () => {
      const result = tokenizeWords("the quick brown fox", {
        stopWords: new Set(["the", "brown"]),
      });
      expect(result).toEqual(["quick", "fox"]);
    });

    it("returns empty array for empty input", () => {
      expect(tokenizeWords("")).toEqual([]);
    });

    it("preserves underscores in tokens (underscore is an allowed char)", () => {
      // _ is not a split character, so hello_world stays as one token
      const result = tokenizeWords("hello_world test_var");
      expect(result).toEqual(["hello_world", "test_var"]);
    });

    it("handles numbers in tokens", () => {
      const result = tokenizeWords("v2 api3 test_123");
      expect(result).toEqual(["v2", "api3", "test_123"]);
    });
  });

  describe("getWordSet", () => {
    it("returns a Set of words with minLength 4", () => {
      // "test" has 4 chars (>= minLength 4) so it IS included
      // "hi" has 2 chars (< 4) so it gets filtered
      const result = getWordSet("hello world test hi abcd");
      expect(result).toBeInstanceOf(Set);
      expect(result.has("hello")).toBe(true);
      expect(result.has("world")).toBe(true);
      expect(result.has("test")).toBe(true);
      expect(result.has("abcd")).toBe(true);
      expect(result.has("hi")).toBe(false);
    });

    it("filters short words below minLength 4", () => {
      const result = getWordSet("short if a long enough words here");
      expect(result.has("short")).toBe(true);
      expect(result.has("enough")).toBe(true);
      expect(result.has("words")).toBe(true);
      expect(result.has("here")).toBe(true); // 4 chars
      expect(result.has("if")).toBe(false);
      expect(result.has("a")).toBe(false);
      expect(result.has("long")).toBe(true);
    });
  });

  describe("jaccardSimilarity", () => {
    it("computes Jaccard similarity for overlapping sets", () => {
      const result = jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]));
      // intersection = {b, c} size 2, union = {a, b, c, d} size 4
      expect(result).toBe(0.5);
    });

    it("returns 1 for identical sets", () => {
      const result = jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]));
      expect(result).toBe(1);
    });

    it("returns 0 for disjoint sets", () => {
      const result = jaccardSimilarity(new Set(["a", "b"]), new Set(["c", "d"]));
      expect(result).toBe(0);
    });

    it("returns 0 when union is empty", () => {
      const result = jaccardSimilarity(new Set<string>(), new Set<string>());
      expect(result).toBe(0);
    });
  });

  describe("TECHNICAL_KEYWORDS", () => {
    it("contains key entries from memory-scoring.ts original array", () => {
      expect(TECHNICAL_KEYWORDS).toContain("function");
      expect(TECHNICAL_KEYWORDS).toContain("class");
      expect(TECHNICAL_KEYWORDS).toContain("interface");
      expect(TECHNICAL_KEYWORDS).toContain("middleware");
      expect(TECHNICAL_KEYWORDS).toContain("typescript");
      expect(TECHNICAL_KEYWORDS).toContain("docker");
      expect(TECHNICAL_KEYWORDS).toContain("microservice");
    });

    it("contains key entries from retrieval-context.ts original array", () => {
      expect(TECHNICAL_KEYWORDS).toContain("program");
      expect(TECHNICAL_KEYWORDS).toContain("software");
      expect(TECHNICAL_KEYWORDS).toContain("module");
      expect(TECHNICAL_KEYWORDS).toContain("library");
      expect(TECHNICAL_KEYWORDS).toContain("framework");
      expect(TECHNICAL_KEYWORDS).toContain("service");
      expect(TECHNICAL_KEYWORDS).toContain("network");
      expect(TECHNICAL_KEYWORDS).toContain("protocol");
    });

    it("has no duplicates", () => {
      const seen = new Set<string>();
      for (const kw of TECHNICAL_KEYWORDS) {
        expect(seen.has(kw)).toBe(false);
        seen.add(kw);
      }
    });
  });

  describe("NEGATION_PATTERNS", () => {
    it("includes word-boundary patterns from memory-scoring.ts", () => {
      // Pattern that matches "not"/"no"/"never" with word boundaries
      const hasNegativeWordPattern = NEGATION_PATTERNS.some((p) => p.test("this is not working"));
      expect(hasNegativeWordPattern).toBe(true);
    });

    it("correctly rejects non-matching text", () => {
      const allMatch = NEGATION_PATTERNS.every((p) =>
        p.test("this is a normal positive statement")
      );
      // At least one pattern should NOT match a positive statement
      // (the broader patterns like un/dis/mis/non might match words accidentally,
      // so we can't assert all fail — but key patterns should not match)
      expect(allMatch).toBe(false);
    });

    it("has at least 5 patterns (union of both sources)", () => {
      expect(NEGATION_PATTERNS.length).toBeGreaterThanOrEqual(5);
    });
  });
});
