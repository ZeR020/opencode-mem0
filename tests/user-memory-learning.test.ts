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
