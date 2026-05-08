import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatContextForPrompt } from "../src/services/context.js";

// Mock user profile context to avoid side effects
vi.mock("../src/services/user-profile/profile-context.js", () => ({
  getUserProfileContext: vi.fn(() => null),
}));

// Mock config to control injectProfile
vi.mock("../src/config.js", () => ({
  CONFIG: {
    injectProfile: false,
    injection: {
      tokenBudget: 4000,
      format: "plain",
      queryAwareFiltering: true,
      relevanceThreshold: 0.3,
    },
  },
}));

interface MemoryResult {
  similarity: number;
  memory?: string;
  chunk?: string;
  type?: string;
  tags?: string[];
}

function makeMemories(contents: string[], similarity = 0.9): { results: MemoryResult[] } {
  return {
    results: contents.map((content) => ({ similarity, memory: content })),
  };
}

describe("token-budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes only memories that fit within token budget", () => {
    // Each memory content is ~100 tokens (400 chars / 4)
    const contents = ["a".repeat(400), "b".repeat(400), "c".repeat(400)];
    const memories = makeMemories(contents);

    // Budget 250 tokens. Header is ~5 tokens. Each memory ~100 tokens.
    // So header (5) + first memory (100) = 105 < 250
    // header (5) + first (100) + second (100) = 205 < 250
    // header (5) + first (100) + second (100) + third (100) = 305 > 250
    // So only first 2 memories should be included
    const result = formatContextForPrompt(null, memories, { tokenBudget: 250 });

    expect(result).toContain("[MEMORY]");
    expect(result).toContain("a".repeat(400));
    expect(result).toContain("b".repeat(400));
    expect(result).not.toContain("c".repeat(400));
  });

  it("includes all memories when budget is 0 (no enforcement)", () => {
    const contents = ["x".repeat(400), "y".repeat(400), "z".repeat(400)];
    const memories = makeMemories(contents);

    const result = formatContextForPrompt(null, memories, { tokenBudget: 0 });

    expect(result).toContain("x".repeat(400));
    expect(result).toContain("y".repeat(400));
    expect(result).toContain("z".repeat(400));
  });

  it("sorts memories by relevance score before budget accumulation", () => {
    const memories = {
      results: [
        { similarity: 0.5, memory: "low relevance memory content here" },
        { similarity: 0.95, memory: "high relevance memory content here" },
        { similarity: 0.7, memory: "medium relevance memory content here" },
      ],
    };

    // Budget enough for header + 2 memories
    const result = formatContextForPrompt(null, memories as any, {
      tokenBudget: 80,
      query: "test query",
    });

    // Should be sorted by relevance: 0.95 first, then 0.7, then 0.5
    const lines = result.split("\n");
    const highIdx = lines.findIndex((l) => l.includes("high relevance"));
    const medIdx = lines.findIndex((l) => l.includes("medium relevance"));
    const lowIdx = lines.findIndex((l) => l.includes("low relevance"));

    expect(highIdx).toBeGreaterThan(-1);
    expect(medIdx).toBeGreaterThan(-1);
    expect(lowIdx).toBe(-1); // low relevance excluded by budget
    expect(highIdx).toBeLessThan(medIdx);
  });

  it("estimates tokens at ~4 characters per token", () => {
    // 40 chars = ~10 tokens
    const memories = makeMemories(["x".repeat(40)]);
    // Budget 15: header (~5 tokens) + memory (~10 tokens) = 15, should fit
    const result1 = formatContextForPrompt(null, memories, { tokenBudget: 15 });
    expect(result1).toContain("x".repeat(40));

    // Budget 14: header (~5) + memory (~10) = 15 > 14, should NOT fit
    const result2 = formatContextForPrompt(null, memories, { tokenBudget: 14 });
    // Only header should remain, but header alone without memories returns ""
    expect(result2).toBe("");
  });

  it("skips an entire memory that would exceed budget (does not truncate)", () => {
    const memories = {
      results: [
        { similarity: 0.9, memory: "short" }, // ~2 tokens
        { similarity: 0.8, memory: "a".repeat(200) }, // ~50 tokens
        { similarity: 0.7, memory: "also short" }, // ~3 tokens
      ],
    };

    // Budget: header (5) + short (2) + long (50) = 57. If budget = 30,
    // after short (5+2=7), long would make 57 > 30, so long is skipped.
    // Then also short: 7 + 3 = 10 <= 30, so it should be included.
    const result = formatContextForPrompt(null, memories as any, {
      tokenBudget: 30,
    });

    expect(result).toContain("short");
    expect(result).not.toContain("a".repeat(200)); // skipped
    expect(result).toContain("also short"); // included after skipping big one
  });

  it("uses default budget of 4000 when no tokenBudget provided", () => {
    const longContent = "x".repeat(16000); // ~4000 tokens exactly
    const memories = makeMemories([longContent]);

    const result = formatContextForPrompt(null, memories);
    expect(result).toContain(longContent);
  });

  it("preserves backward compatibility without options", () => {
    const memories = makeMemories(["memory one", "memory two"]);
    const result = formatContextForPrompt(null, memories);

    expect(result).toContain("[MEMORY]");
    expect(result).toContain("memory one");
    expect(result).toContain("memory two");
  });
});
