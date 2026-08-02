import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The analyzer is mocked so tests never hit a real LLM.
vi.mock("../src/services/user-memory-learning.js", () => ({
  performUserProfileLearning: vi.fn(),
}));

// userPromptManager is a Proxy singleton (get trap forwards to a lazy real
// instance), so overriding methods on the proxy shell is ignored. Mock the
// module instead; profile.ts only uses countUnanalyzedForUserLearning.
vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    countUnanalyzedForUserLearning: vi.fn(() => 0),
  },
}));

let configDir: string;
let prevHome: string | undefined;
let handleRefreshProfile: (userId?: string) => Promise<any>;
let userPromptManager: any;
let performUserProfileLearning: any;

beforeEach(async () => {
  prevHome = process.env.HOME;
  configDir = mkdtempSync(join(tmpdir(), "mem0-profile-test-"));
  process.env.HOME = configDir;
  vi.resetModules();
  const profileModule = await import("../src/services/handlers/profile.js");
  handleRefreshProfile = profileModule.handleRefreshProfile;
  userPromptManager = (await import("../src/services/user-prompt/user-prompt-manager.js"))
    .userPromptManager;
  performUserProfileLearning = (await import("../src/services/user-memory-learning.js"))
    .performUserProfileLearning;
  userPromptManager.countUnanalyzedForUserLearning.mockClear();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(configDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("handleRefreshProfile", () => {
  it("does not analyze below threshold and reports the gap", async () => {
    const res = await handleRefreshProfile();
    expect(res.success).toBe(true);
    expect(res.data.analyzed).toBe(0);
    expect(res.data.unanalyzedPrompts).toBe(0);
    expect(res.data.threshold).toBeGreaterThan(0);
    expect(performUserProfileLearning).not.toHaveBeenCalled();
    expect(String(res.data.message)).toContain("more unanalyzed prompt");
  });

  it("runs the analyzer at threshold and reports how many prompts were analyzed", async () => {
    // First call (before analysis) returns 10; default 4 covers the two
    // subsequent calls (after analysis + remaining).
    userPromptManager.countUnanalyzedForUserLearning.mockReturnValue(4).mockReturnValueOnce(10);
    const res = await handleRefreshProfile();
    expect(performUserProfileLearning).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.data.analyzed).toBe(6);
    expect(res.data.unanalyzedPrompts).toBe(4);
  });

  it("surfaces analyzer failure with a pointer to the LLM settings", async () => {
    performUserProfileLearning.mockRejectedValue(new Error("External API not configured"));
    userPromptManager.countUnanalyzedForUserLearning.mockReturnValueOnce(10);
    const res = await handleRefreshProfile();
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain("Settings");
    expect(String(res.error)).toContain("External API not configured");
  });
});
