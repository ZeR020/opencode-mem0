import { describe, it, expect, vi } from "vitest";

const mockGetActiveProfile = vi.fn();

vi.mock("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: (...args: any[]) => mockGetActiveProfile(...args),
  },
}));

const { getUserProfileContext } = await import("../src/services/user-profile/profile-context.js");

describe("getUserProfileContext", () => {
  it("returns null when no profile exists", () => {
    mockGetActiveProfile.mockReturnValue(null);
    expect(getUserProfileContext("user-1")).toBeNull();
  });

  it("returns fallback message when profile data is invalid JSON", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: "not-json",
    });
    expect(getUserProfileContext("user-1")).toBe("User profile data is unavailable.");
  });

  it("returns null when profile has no preferences, patterns, or workflows", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({}),
    });
    expect(getUserProfileContext("user-1")).toBeNull();
  });

  it("formats preferences sorted by confidence and capped at 5", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({
        preferences: [
          { category: "style", description: "Concise", confidence: 0.7, evidence: ["e1"] },
          { category: "tools", description: "Neovim", confidence: 0.9, evidence: ["e2"] },
          { category: "lang", description: "TypeScript", confidence: 0.5, evidence: ["e3"] },
        ],
      }),
    });
    const result = getUserProfileContext("user-1")!;
    expect(result).toContain("User Preferences:");
    expect(result).toContain("[tools] Neovim");
    expect(result).toContain("[style] Concise");
    expect(result).toContain("[lang] TypeScript");
    // Should be sorted by confidence descending
    const toolsIndex = result.indexOf("[tools]");
    const styleIndex = result.indexOf("[style]");
    const langIndex = result.indexOf("[lang]");
    expect(toolsIndex).toBeLessThan(styleIndex);
    expect(styleIndex).toBeLessThan(langIndex);
  });

  it("formats patterns sorted by frequency and capped at 5", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({
        patterns: [
          { category: "domain", description: "Backend APIs", frequency: 3 },
          { category: "topic", description: "Auth", frequency: 5 },
        ],
      }),
    });
    const result = getUserProfileContext("user-1")!;
    expect(result).toContain("User Patterns:");
    expect(result).toContain("[topic] Auth");
    expect(result).toContain("[domain] Backend APIs");
  });

  it("formats workflows sorted by frequency and capped at 3", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({
        workflows: [
          { description: "TDD cycle", steps: ["write test", "run", "implement"], frequency: 2 },
          { description: "Debug flow", steps: ["reproduce", "isolate", "fix"], frequency: 1 },
        ],
      }),
    });
    const result = getUserProfileContext("user-1")!;
    expect(result).toContain("User Workflows:");
    expect(result).toContain("- TDD cycle");
    expect(result).toContain("- Debug flow");
  });

  it("combines all sections when present", () => {
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({
        preferences: [{ category: "a", description: "b", confidence: 1.0, evidence: ["e"] }],
        patterns: [{ category: "c", description: "d", frequency: 1 }],
        workflows: [{ description: "e", steps: ["s1"], frequency: 1 }],
      }),
    });
    const result = getUserProfileContext("user-1")!;
    expect(result).toContain("User Preferences:");
    expect(result).toContain("User Patterns:");
    expect(result).toContain("User Workflows:");
  });

  it("caps preferences at 5 items", () => {
    const prefs = Array.from({ length: 10 }, (_, i) => ({
      category: `cat-${i}`,
      description: `desc-${i}`,
      confidence: i / 10,
      evidence: ["e"],
    }));
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({ preferences: prefs }),
    });
    const result = getUserProfileContext("user-1")!;
    const matches = result.match(/\[cat-/g);
    expect(matches).toHaveLength(5);
  });

  it("caps patterns at 5 items", () => {
    const patterns = Array.from({ length: 10 }, (_, i) => ({
      category: `cat-${i}`,
      description: `desc-${i}`,
      frequency: i,
    }));
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({ patterns }),
    });
    const result = getUserProfileContext("user-1")!;
    const matches = result.match(/\[cat-/g);
    expect(matches).toHaveLength(5);
  });

  it("caps workflows at 3 items", () => {
    const workflows = Array.from({ length: 10 }, (_, i) => ({
      description: `wf-${i}`,
      steps: ["s1"],
      frequency: i,
    }));
    mockGetActiveProfile.mockReturnValue({
      id: "prof-1",
      profileData: JSON.stringify({ workflows }),
    });
    const result = getUserProfileContext("user-1")!;
    const matches = result.match(/- wf-/g);
    expect(matches).toHaveLength(3);
  });
});
