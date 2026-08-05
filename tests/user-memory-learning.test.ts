import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

// ---- Mutable tags + config so each test controls identity and limits ----
let currentTags: any = {
  project: {
    tag: "test-tag",
    displayName: "Test",
    userName: "test",
    userEmail: "test@example.com",
    projectPath: "/test",
    projectName: "TestProject",
    gitRepoUrl: "",
  },
  user: { userEmail: "test@example.com", displayName: "Test", userName: "test" },
};

const mockConfig: any = {
  storagePath: "", // set in beforeAll
  showUserProfileToasts: false,
  userProfileAnalysisInterval: 5,
  userProfileMaxBatchesPerIdle: 5,
  userProfileMaxPreferences: 10,
  userProfileMaxPatterns: 10,
  userProfileMaxWorkflows: 5,
  userProfileChangelogRetentionCount: 5,
  opencodeProvider: null,
  opencodeModel: null,
  memoryModel: null,
  memoryApiUrl: null,
  memoryTemperature: 0.3,
};

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: () => currentTags,
}));

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

const mockUserPromptManager = {
  countUnanalyzedForUserLearning: vi.fn(),
  getPromptsForUserLearning: vi.fn(),
  markMultipleAsUserLearningCaptured: vi.fn(),
};

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: mockUserPromptManager,
}));

const mockGenerateStructuredOutput = vi.fn();

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  isProviderConnected: () => true,
  getStatePath: () => "/tmp/test-state",
  generateStructuredOutput: (...args: unknown[]) => mockGenerateStructuredOutput(...args),
}));

// The REAL user-profile-manager module (no mock): the shared resolver and the
// SQLite-backed manager are exactly what's under test for identity behavior.
const { performUserProfileLearning, buildUserAnalysisContext } =
  await import("../src/services/user-memory-learning.js");
const { resolveProfileUserId, userProfileManager } =
  await import("../src/services/user-profile/user-profile-manager.js");

let tmpDir: string;

const ANON_PROFILE_DATA = { preferences: [], patterns: [], workflows: [] };

function makePrompts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `prompt-${i}`,
    sessionId: "s1",
    messageId: `m-${i}`,
    projectPath: "/test",
    content: `Prompt ${i} about TypeScript configuration`,
    createdAt: Date.now() + i,
    captured: true,
    userLearningCaptured: false,
    captureAttempts: 0,
    linkedMemoryId: null,
  }));
}

function allProfiles(): any[] {
  const db = connectionManager.getConnection(join(tmpDir, "user-profiles.db"));
  return db.prepare("SELECT * FROM user_profiles").all() as any[];
}

function clearProfiles(): void {
  const dbPath = join(tmpDir, "user-profiles.db");
  if (!existsSync(dbPath)) return;
  const db = connectionManager.getConnection(dbPath);
  db.run("DELETE FROM user_profile_changelogs");
  db.run("DELETE FROM user_profiles");
}

function enableAnalysis(): void {
  mockConfig.opencodeProvider = "test-provider";
  mockConfig.opencodeModel = "test-model";
}

// Queues `count` prompts and simulates consumption: each fetched batch reduces
// the remaining count, so the drain loop terminates like it would with the
// real SQLite-backed prompt store.
function queuePrompts(count: number): { remaining: () => number } {
  let remaining = count;
  mockUserPromptManager.countUnanalyzedForUserLearning.mockImplementation(() => remaining);
  mockUserPromptManager.getPromptsForUserLearning.mockImplementation((limit: number) =>
    makePrompts(Math.min(limit, remaining))
  );
  mockUserPromptManager.markMultipleAsUserLearningCaptured.mockImplementation((ids: string[]) => {
    remaining -= ids.length;
  });
  return { remaining: () => remaining };
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mem0-learning-"));
  mockConfig.storagePath = tmpDir;
  // Force the lazy manager singleton to construct now so the schema exists
  // before any test touches the DB (helpers like clearProfiles run in
  // beforeEach, before the first manager call inside a test).
  userProfileManager.getLatestActiveProfile();
});

beforeEach(() => {
  vi.clearAllMocks();
  clearProfiles();
  currentTags = {
    project: {
      tag: "test-tag",
      displayName: "Test",
      userName: "test",
      userEmail: "test@example.com",
      projectPath: "/test",
      projectName: "TestProject",
      gitRepoUrl: "",
    },
    user: { userEmail: "test@example.com", displayName: "Test", userName: "test" },
  };
  mockConfig.opencodeProvider = null;
  mockConfig.opencodeModel = null;
  mockConfig.userProfileAnalysisInterval = 5;
  mockConfig.userProfileMaxBatchesPerIdle = 5;
});

afterAll(() => {
  connectionManager.closeAll();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("user-memory-learning", () => {
  it("returns early when not enough prompts", async () => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(2);
    await performUserProfileLearning({} as any, "/test");
    expect(mockUserPromptManager.getPromptsForUserLearning).not.toHaveBeenCalled();
    expect(mockUserPromptManager.markMultipleAsUserLearningCaptured).not.toHaveBeenCalled();
  });

  it("returns early when no prompts available", async () => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(10);
    mockUserPromptManager.getPromptsForUserLearning.mockReturnValue([]);
    await performUserProfileLearning({} as any, "/test");
    expect(mockUserPromptManager.markMultipleAsUserLearningCaptured).not.toHaveBeenCalled();
    expect(allProfiles()).toHaveLength(0);
  });

  it("skips without consuming prompts when no analysis provider is configured", async () => {
    // The mocked CONFIG has no opencodeProvider/opencodeModel and no
    // memoryModel/memoryApiUrl — learning must stay inert and leave the
    // prompt queue untouched (previously it threw every idle, or worse,
    // consumed prompts and silently discarded the data).
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(10);
    await expect(performUserProfileLearning({} as any, "/test")).resolves.toBeUndefined();
    expect(mockUserPromptManager.getPromptsForUserLearning).not.toHaveBeenCalled();
    expect(mockUserPromptManager.markMultipleAsUserLearningCaptured).not.toHaveBeenCalled();
    expect(allProfiles()).toHaveLength(0);
  });
});

describe("stable profile identity", () => {
  it("resolves the git email first when present", () => {
    currentTags.user.userEmail = "dev@example.com";
    expect(resolveProfileUserId(currentTags)).toBe("dev@example.com");
  });

  it("falls back to the latest active profile's userId when no email is present", () => {
    currentTags.user.userEmail = undefined;
    userProfileManager.createProfile(
      "legacy-anon-1",
      "Test",
      "test",
      "unknown",
      ANON_PROFILE_DATA,
      10
    );
    expect(resolveProfileUserId(currentTags)).toBe("legacy-anon-1");
  });

  it("falls back to the constant 'anonymous' when no email and no profiles exist", () => {
    currentTags.user.userEmail = undefined;
    expect(resolveProfileUserId(currentTags)).toBe("anonymous");
  });

  it("reuses the existing active profile's userId when learning without an email (no new profile)", async () => {
    // Pre-fix code minted a fresh random identity per run, so this would have
    // created a second profile instead of updating the seeded one.
    currentTags.user.userEmail = undefined;
    userProfileManager.createProfile(
      "legacy-anon-1",
      "Test",
      "test",
      "unknown",
      ANON_PROFILE_DATA,
      10
    );
    enableAnalysis();
    queuePrompts(10);
    mockGenerateStructuredOutput.mockResolvedValue(ANON_PROFILE_DATA);

    await performUserProfileLearning({} as any, "/test");

    const profiles = allProfiles();
    expect(profiles).toHaveLength(1); // no new profile created
    expect(profiles[0].user_id).toBe("legacy-anon-1");
    expect(profiles[0].total_prompts_analyzed).toBe(20); // 10 seeded + 2×5 analyzed, updated not created
  });

  it("creates one 'anonymous' profile across two runs when no email and no profiles exist", async () => {
    // Pre-fix code generated a new random identity every run, accumulating
    // one profile per batch (4 profiles from 40 prompts in the issue report).
    currentTags.user.userEmail = undefined;
    enableAnalysis();
    queuePrompts(10);
    mockGenerateStructuredOutput.mockResolvedValue(ANON_PROFILE_DATA);

    await performUserProfileLearning({} as any, "/test");
    queuePrompts(10); // second run sees a fresh backlog
    await performUserProfileLearning({} as any, "/test");

    const profiles = allProfiles();
    expect(profiles).toHaveLength(1); // still one profile
    expect(profiles[0].user_id).toBe("anonymous");
    expect(profiles[0].total_prompts_analyzed).toBe(20); // 10 + 10 on the same profile
  });
});

describe("backlog draining", () => {
  function drainFixture(): void {
    enableAnalysis();
    mockConfig.userProfileAnalysisInterval = 10;
  }

  it("drains up to userProfileMaxBatchesPerIdle batches in one run", async () => {
    drainFixture();
    mockConfig.userProfileMaxBatchesPerIdle = 5;
    const queue = queuePrompts(25);
    mockGenerateStructuredOutput.mockResolvedValue(ANON_PROFILE_DATA);

    await performUserProfileLearning({} as any, "/test");

    // 25 prompts, threshold 10, cap 5 → 2 batches of 10 analyzed, 5 remain.
    expect(queue.remaining()).toBe(5);
    expect(mockUserPromptManager.getPromptsForUserLearning).toHaveBeenCalledTimes(2);

    const profiles = allProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].total_prompts_analyzed).toBe(20);
  });

  it("respects a cap of 1 batch per run", async () => {
    drainFixture();
    mockConfig.userProfileMaxBatchesPerIdle = 1;
    const queue = queuePrompts(25);
    mockGenerateStructuredOutput.mockResolvedValue(ANON_PROFILE_DATA);

    await performUserProfileLearning({} as any, "/test");

    expect(queue.remaining()).toBe(15); // only one batch of 10 analyzed
    expect(mockUserPromptManager.getPromptsForUserLearning).toHaveBeenCalledTimes(1);
  });
});

describe("single merge owner", () => {
  it("stores the LLM-returned profile as-is (no double-increment) and enforces caps", async () => {
    enableAnalysis();
    mockConfig.userProfileAnalysisInterval = 10;
    mockConfig.userProfileMaxBatchesPerIdle = 5;
    mockConfig.userProfileMaxPreferences = 3;
    mockConfig.userProfileMaxPatterns = 3;
    mockConfig.userProfileMaxWorkflows = 3;

    // Existing profile with items the LLM will "merge" back at higher values.
    const now = Date.now();
    userProfileManager.createProfile(
      "test@example.com",
      "Test",
      "test",
      "test@example.com",
      {
        preferences: [
          {
            category: "code-style",
            description: "prefers tabs",
            confidence: 0.5,
            evidence: ["old-evidence"],
            lastUpdated: now,
          },
        ],
        patterns: [{ category: "ts", description: "typescript work", frequency: 2, lastSeen: now }],
        workflows: [{ description: "build flow", steps: ["a"], frequency: 1 }],
      },
      10
    );

    // The LLM is instructed to return the FULLY MERGED profile.
    const llmMerged = {
      preferences: [
        {
          category: "code-style",
          description: "prefers tabs",
          confidence: 0.9,
          evidence: ["new-evidence"],
          lastUpdated: now,
        },
        {
          category: "lang",
          description: "python",
          confidence: 0.8,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "tool",
          description: "vim",
          confidence: 0.7,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "style",
          description: "docstrings",
          confidence: 0.6,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "style",
          description: "naming",
          confidence: 0.5,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "style",
          description: "imports",
          confidence: 0.4,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "style",
          description: "quotes",
          confidence: 0.3,
          evidence: ["e"],
          lastUpdated: now,
        },
        {
          category: "style",
          description: "semicolons",
          confidence: 0.2,
          evidence: ["e"],
          lastUpdated: now,
        },
      ],
      patterns: [
        { category: "ts", description: "typescript work", frequency: 4, lastSeen: now },
        { category: "web", description: "react work", frequency: 3, lastSeen: now },
        { category: "lang", description: "go work", frequency: 2, lastSeen: now },
      ],
      workflows: [
        { description: "deploy flow", steps: ["a"], frequency: 5 },
        { description: "test flow", steps: ["a"], frequency: 4 },
        { description: "lint flow", steps: ["a"], frequency: 3 },
        { description: "debug flow", steps: ["a"], frequency: 2 },
        { description: "build flow", steps: ["a"], frequency: 1 },
      ],
    };
    mockGenerateStructuredOutput.mockResolvedValue(llmMerged);
    queuePrompts(10);

    await performUserProfileLearning({} as any, "/test");

    const profiles = allProfiles();
    expect(profiles).toHaveLength(1);
    const stored = JSON.parse(profiles[0].profile_data);

    // Merged preference keeps the LLM's confidence (0.9), NOT existing 0.5 + 0.1.
    const tabs = stored.preferences.find((p: any) => p.description === "prefers tabs");
    expect(tabs.confidence).toBe(0.9);

    // Merged pattern keeps the LLM's frequency (4), NOT existing 2 + 1.
    const ts = stored.patterns.find((p: any) => p.description === "typescript work");
    expect(ts.frequency).toBe(4);

    // Caps: 8 LLM preferences → exactly maxPreferences (3), top-confidence kept.
    expect(stored.preferences).toHaveLength(3);
    expect(stored.preferences.map((p: any) => p.confidence)).toEqual([0.9, 0.8, 0.7]);
    expect(stored.patterns).toHaveLength(3);
    expect(stored.patterns.map((p: any) => p.frequency)).toEqual([4, 3, 2]);
    expect(stored.workflows).toHaveLength(3);
    expect(stored.workflows.map((w: any) => w.frequency)).toEqual([5, 4, 3]);
  });
});

describe("mid-loop failure", () => {
  it("commits the successful batch, propagates the error, and releases the single-flight lock", async () => {
    enableAnalysis();
    mockConfig.userProfileAnalysisInterval = 10;
    mockConfig.userProfileMaxBatchesPerIdle = 5;
    const queue = queuePrompts(25);

    let calls = 0;
    mockGenerateStructuredOutput.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(ANON_PROFILE_DATA);
      return Promise.reject(new Error("analysis failed"));
    });

    await expect(performUserProfileLearning({} as any, "/test")).rejects.toThrow("analysis failed");

    // Batch 1 (10 prompts) was marked captured before the failure; 15 remain.
    expect(queue.remaining()).toBe(15);
    expect(mockUserPromptManager.markMultipleAsUserLearningCaptured).toHaveBeenCalledWith(
      makePrompts(10).map((p) => p.id)
    );
    expect(mockUserPromptManager.getPromptsForUserLearning).toHaveBeenCalledTimes(2);

    // The single-flight lock was released: a subsequent run executes instead of no-oping.
    mockGenerateStructuredOutput.mockResolvedValue(ANON_PROFILE_DATA);
    await performUserProfileLearning({} as any, "/test");

    expect(mockUserPromptManager.getPromptsForUserLearning).toHaveBeenCalledTimes(3);
    expect(queue.remaining()).toBe(5);
  });
});

describe("language pinning", () => {
  const germanPrompt =
    "Dies ist ein deutscher Testsatz mit mehreren Wörtern für die Spracherkennung";
  const englishPrompt = "This is an English test sentence for the language detector";

  it("names the detected dominant language when creating a new profile", () => {
    const prompts = [
      { ...makePrompts(1)[0], content: germanPrompt },
      { ...makePrompts(1)[0], content: germanPrompt },
      { ...makePrompts(1)[0], content: englishPrompt },
    ];
    const { context, languageName } = buildUserAnalysisContext(prompts, null);
    expect(languageName).toBe("German");
    expect(context).toContain("Write ALL output in German");
  });

  it("keeps the existing profile's language when updating", () => {
    const existing = {
      id: "prof-1",
      userId: "u1",
      profileData: JSON.stringify(ANON_PROFILE_DATA),
    };
    const { context, languageName } = buildUserAnalysisContext(
      [{ ...makePrompts(1)[0], content: germanPrompt }],
      existing as any
    );
    expect(languageName).toBeNull();
    expect(context).toContain("same language as the existing profile");
  });
});
