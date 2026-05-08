import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMemoryEntry, formatContextForPrompt } from "../src/services/context.js";

// Mock user profile context to avoid side effects
vi.mock("../src/services/user-profile/profile-context.js", () => ({
  getUserProfileContext: vi.fn(() => null),
}));

describe("structured-format", () => {
  describe("formatMemoryEntry", () => {
    it("plain format returns similarity percentage and content", () => {
      const result = {
        similarity: 0.92,
        memory: "Use async/await for database queries",
        type: "decision",
      };
      const formatted = formatMemoryEntry(result as any, 0.85, "plain");
      expect(formatted).toBe("- [92%] Use async/await for database queries");
    });

    it("xml format returns memory element with attributes", () => {
      const result = {
        similarity: 0.92,
        memory: "Use async/await for database queries",
        type: "decision",
      };
      const formatted = formatMemoryEntry(result as any, 0.85, "xml");
      expect(formatted).toContain("<memory");
      expect(formatted).toContain('similarity="0.92"');
      expect(formatted).toContain('relevance="0.85"');
      expect(formatted).toContain('type="decision"');
      expect(formatted).toContain("Use async/await for database queries");
      expect(formatted).toContain("</memory>");
    });

    it("xml format escapes special characters", () => {
      const result = {
        similarity: 0.8,
        memory: 'Use "special" <tags> & entities',
        type: "note",
      };
      const formatted = formatMemoryEntry(result as any, 0.75, "xml");
      expect(formatted).toContain("&quot;special&quot;");
      expect(formatted).toContain("&lt;tags&gt;");
      expect(formatted).toContain("&amp; entities");
    });

    it("yaml format returns structured entry", () => {
      const result = {
        similarity: 0.92,
        memory: "Use async/await for database queries",
        type: "decision",
      };
      const formatted = formatMemoryEntry(result as any, 0.85, "yaml");
      expect(formatted).toContain("- similarity: 0.92");
      expect(formatted).toContain("  relevance: 0.85");
      expect(formatted).toContain("  type: decision");
      expect(formatted).toContain("  content: |");
      expect(formatted).toContain("    Use async/await for database queries");
    });

    it("yaml format handles multi-line content with proper indentation", () => {
      const result = {
        similarity: 0.85,
        memory: "Line one\nLine two\nLine three",
        type: "guide",
      };
      const formatted = formatMemoryEntry(result as any, 0.8, "yaml");
      const lines = formatted.split("\n");
      expect(lines[0]).toBe("- similarity: 0.85");
      expect(lines[1]).toBe("  relevance: 0.80");
      expect(lines[2]).toBe("  type: guide");
      expect(lines[3]).toBe("  content: |");
      expect(lines[4]).toBe("    Line one");
      expect(lines[5]).toBe("    Line two");
      expect(lines[6]).toBe("    Line three");
    });

    it("plain format is default when format is omitted", () => {
      const result = {
        similarity: 0.75,
        memory: "Default format test",
      };
      const formatted = formatMemoryEntry(result as any, 0.7);
      expect(formatted).toBe("- [75%] Default format test");
    });
  });

  describe("formatContextForPrompt format options", () => {
    it("produces xml output when format is xml", () => {
      const memories = {
        results: [{ similarity: 0.9, memory: "First memory", type: "decision" }],
      };
      const result = formatContextForPrompt(null, memories as any, {
        format: "xml",
      });
      expect(result).toContain("<memory");
      expect(result).toContain("</memory>");
      expect(result).not.toContain("- [90%]");
    });

    it("produces yaml output when format is yaml", () => {
      const memories = {
        results: [{ similarity: 0.8, memory: "Memory content", type: "note" }],
      };
      const result = formatContextForPrompt(null, memories as any, {
        format: "yaml",
      });
      expect(result).toContain("- similarity: 0.80");
      expect(result).toContain("  content: |");
      expect(result).not.toContain("- [80%]");
    });

    it("produces plain output when format is plain", () => {
      const memories = {
        results: [{ similarity: 0.85, memory: "Plain memory", type: "bug" }],
      };
      const result = formatContextForPrompt(null, memories as any, {
        format: "plain",
      });
      expect(result).toContain("- [85%] Plain memory");
    });
  });

  describe("config injection defaults", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    let testConfig: any;

    beforeAll(async () => {
      const home = mkdtempSync(join(tmpdir(), "opencode-mem0-test-"));
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      // Dynamic import to get fresh config with temp home
      const mod = await import("../src/config.js");
      testConfig = mod.CONFIG;
    });

    afterAll(() => {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    });

    it("has injection.format defaulting to plain", () => {
      expect(testConfig.injection?.format).toBe("plain");
    });

    it("has injection.tokenBudget defaulting to 4000", () => {
      expect(testConfig.injection?.tokenBudget).toBe(4000);
    });

    it("has injection.queryAwareFiltering defaulting to true", () => {
      expect(testConfig.injection?.queryAwareFiltering).toBe(true);
    });

    it("has injection.relevanceThreshold defaulting to 0.3", () => {
      expect(testConfig.injection?.relevanceThreshold).toBe(0.3);
    });
  });
});
