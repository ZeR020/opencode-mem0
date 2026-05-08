import { describe, it, expect } from "vitest";
import {
  analyzeQueryIntent,
  scoreMemoryRelevance,
  type QueryIntent,
} from "../src/services/retrieval-context.js";

// Minimal SearchResult-like type for testing
interface TestSearchResult {
  id?: string;
  memory: string;
  similarity: number;
  tags?: string[];
  type?: string;
  finalScore?: number;
}

function makeMemory(overrides: Partial<TestSearchResult> = {}): TestSearchResult {
  return {
    id: "mem-1",
    memory: "default memory content",
    similarity: 0.8,
    tags: [],
    type: "note",
    ...overrides,
  };
}

describe("query-aware-injection", () => {
  describe("analyzeQueryIntent", () => {
    it('classifies "how do I fix the auth bug?" as troubleshooting', () => {
      const intent = analyzeQueryIntent("how do I fix the auth bug?");
      expect(intent.intent).toBe("troubleshooting");
      expect(intent.topics).toContain("auth");
      // "bug" is 3 chars so filtered by >=4 topic extraction
      expect(intent.isTechnical).toBe(true);
      expect(intent.requiresCode).toBe(false);
    });

    it('classifies "what did we decide about the database?" as recall', () => {
      const intent = analyzeQueryIntent("what did we decide about the database?");
      expect(intent.intent).toBe("recall");
      expect(intent.topics).toContain("database");
      expect(intent.topics).toContain("decide");
      expect(intent.isTechnical).toBe(true); // "database" is technical
      expect(intent.requiresCode).toBe(false);
    });

    it("classifies implementation queries correctly", () => {
      const intent = analyzeQueryIntent("implement a new search function in typescript");
      expect(intent.intent).toBe("implementation");
      expect(intent.isTechnical).toBe(true);
      expect(intent.requiresCode).toBe(true); // contains "function" and "implement"
    });

    it("classifies exploration queries correctly", () => {
      const intent = analyzeQueryIntent("explore options for caching strategies");
      expect(intent.intent).toBe("exploration");
      expect(intent.isTechnical).toBe(true);
      expect(intent.requiresCode).toBe(false);
    });

    it("defaults to general for unknown queries", () => {
      const intent = analyzeQueryIntent("hello world how are you today");
      expect(intent.intent).toBe("general");
      expect(intent.isTechnical).toBe(false);
      expect(intent.requiresCode).toBe(false);
    });

    it("filters stop words from topics", () => {
      const intent = analyzeQueryIntent("the quick brown fox and a lazy dog");
      expect(intent.topics).not.toContain("the");
      expect(intent.topics).not.toContain("and");
      expect(intent.topics).not.toContain("a");
      expect(intent.topics.length).toBeGreaterThan(0);
    });
  });

  describe("scoreMemoryRelevance", () => {
    it("boosts memory with matching topics by 1.2x per topic (capped at 1.5x)", () => {
      const intent: QueryIntent = {
        intent: "troubleshooting",
        topics: ["auth", "login"],
        isTechnical: true,
        requiresCode: false,
      };
      const memory = makeMemory({ memory: "auth token expired for login page", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      expect(score).toBeGreaterThan(0.5);
      // One topic match ("auth") → 1.2x boost. Capped total at 1.5x, so score <= 0.5 * 1.5 = 0.75
      expect(score).toBeLessThanOrEqual(0.75);
    });

    it("applies type-intent alignment boost for troubleshooting + bug", () => {
      const intent: QueryIntent = {
        intent: "troubleshooting",
        topics: [],
        isTechnical: true,
        requiresCode: false,
      };
      const memory = makeMemory({ type: "bug", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      // Base 0.5 * 1.3 (type alignment) = 0.65
      expect(score).toBeGreaterThanOrEqual(0.6);
      expect(score).toBeLessThanOrEqual(0.7);
    });

    it("applies type-intent alignment boost for recall + decision", () => {
      const intent: QueryIntent = {
        intent: "recall",
        topics: [],
        isTechnical: false,
        requiresCode: false,
      };
      const memory = makeMemory({ type: "decision", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      expect(score).toBeGreaterThanOrEqual(0.6);
      expect(score).toBeLessThanOrEqual(0.7);
    });

    it("applies type-intent alignment boost for implementation + guide", () => {
      const intent: QueryIntent = {
        intent: "implementation",
        topics: [],
        isTechnical: true,
        requiresCode: false, // isolate type-alignment boost from code penalty
      };
      const memory = makeMemory({ type: "guide", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      // 0.5 * 1.3 = 0.65
      expect(score).toBeGreaterThanOrEqual(0.6);
      expect(score).toBeLessThanOrEqual(0.7);
    });

    it("penalizes non-technical memories when intent is technical", () => {
      const intent: QueryIntent = {
        intent: "troubleshooting",
        topics: [],
        isTechnical: true,
        requiresCode: false,
      };
      const memory = makeMemory({ type: "greeting", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      expect(score).toBeLessThan(0.5);
      // 0.5 * 0.7 = 0.35
      expect(score).toBeLessThanOrEqual(0.4);
    });

    it("penalizes memories without code blocks when intent requires code", () => {
      const intent: QueryIntent = {
        intent: "implementation",
        topics: [],
        isTechnical: true,
        requiresCode: true,
      };
      const memory = makeMemory({ memory: "some plain text without code", similarity: 0.5 });
      const score = scoreMemoryRelevance(memory as any, intent);
      expect(score).toBeLessThan(0.5);
      // 0.5 * 0.8 = 0.4
      expect(score).toBeLessThanOrEqual(0.45);
    });

    it("does not penalize memories with code blocks when intent requires code", () => {
      const intent: QueryIntent = {
        intent: "implementation",
        topics: [],
        isTechnical: true,
        requiresCode: true,
      };
      const memory = makeMemory({
        memory: "```typescript\nconst x = 1;\n```",
        similarity: 0.5,
      });
      const score = scoreMemoryRelevance(memory as any, intent);
      // No code penalty, so should be around 0.5 (no other boosts/penalties)
      expect(score).toBeGreaterThanOrEqual(0.48);
      expect(score).toBeLessThanOrEqual(0.52);
    });

    it("uses finalScore when available, otherwise similarity", () => {
      const intent: QueryIntent = {
        intent: "general",
        topics: [],
        isTechnical: false,
        requiresCode: false,
      };
      const memoryWithFinal = makeMemory({ finalScore: 0.9, similarity: 0.3 });
      const score1 = scoreMemoryRelevance(memoryWithFinal as any, intent);
      expect(score1).toBeGreaterThanOrEqual(0.85);
      expect(score1).toBeLessThanOrEqual(0.95);

      const memoryWithoutFinal = makeMemory({ similarity: 0.3 });
      delete (memoryWithoutFinal as any).finalScore;
      const score2 = scoreMemoryRelevance(memoryWithoutFinal as any, intent);
      expect(score2).toBeGreaterThanOrEqual(0.25);
      expect(score2).toBeLessThanOrEqual(0.35);
    });

    it("clamps score to [0, 1] range", () => {
      const intent: QueryIntent = {
        intent: "troubleshooting",
        topics: ["auth", "login", "error", "database", "server"],
        isTechnical: true,
        requiresCode: false,
      };
      const memory = makeMemory({
        type: "bug",
        memory: "auth login error database server",
        similarity: 0.9,
      });
      const score = scoreMemoryRelevance(memory as any, intent);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("filters out memories with relevance < 0.3", () => {
      const intent: QueryIntent = {
        intent: "troubleshooting",
        topics: [],
        isTechnical: true,
        requiresCode: false,
      };
      const memory = makeMemory({ type: "greeting", similarity: 0.4 });
      const score = scoreMemoryRelevance(memory as any, intent);
      // 0.4 * 0.7 (technical mismatch penalty) = 0.28 < 0.3
      expect(score).toBeLessThan(0.3);
    });
  });
});
// audit: tests/query-aware-injection.test.ts
