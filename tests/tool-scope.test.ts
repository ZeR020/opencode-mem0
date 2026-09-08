import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import type { PluginInput } from "@opencode-ai/plugin";

const searchCalls: unknown[][] = [];
let lastListScope: string | undefined;

let mockConfig: any;
let mockClient: any;

vi.mock("../src/services/logger.js", () => ({ log: () => {}, flushLogs: () => Promise.resolve() }));
vi.mock("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "project-tag" }, user: { userEmail: "u@example.com" } }),
}));
vi.mock("../src/services/context.js", () => ({ formatContextForPrompt: () => "" }));
vi.mock("../src/services/privacy.js", () => ({
  stripPrivateContent: (value: unknown) => value,
  isFullyPrivate: () => false,
}));
vi.mock("../src/services/auto-capture.js", () => ({ performAutoCapture: () => {} }));
vi.mock("../src/services/user-memory-learning.js", () => ({
  performUserProfileLearning: () => {},
}));
vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: { savePrompt() {} },
}));
vi.mock("../src/services/web-server.js", () => ({
  startWebServer: () => null,
  WebServer: class {},
}));
vi.mock("../src/services/language-detector.js", () => ({ getLanguageName: () => "English" }));

vi.mock("../src/services/ai/session/ai-session-manager.js", () => ({
  getAISessionManager: vi.fn(() => ({
    createSession: vi.fn(),
    getSession: vi.fn(),
    getMessages: vi.fn(() => []),
    getLastSequence: vi.fn(() => 0),
    updateSession: vi.fn(),
    cleanupExpiredSessions: vi.fn(() => 0),
  })),
}));

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
  isConfigured: () => true,
  initConfig: () => {},
}));

vi.mock("../src/services/client.js", () => ({
  memoryClient: mockClient,
}));

mockConfig = {
  autoCaptureLanguage: "auto",
  storagePath: `/tmp/opencode-mem0-test-scope-${process.pid}`,
  memory: { defaultScope: undefined as "project" | "all-projects" | undefined },
  webServerEnabled: false,
  autoCaptureEnabled: false,
  vectorBackend: "exact-scan",
  similarityThreshold: 0.6,
  maxMemories: 10,
  injectProfile: false,
  containerTagPrefix: "opencode",
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  showAutoCaptureToasts: false,
  showUserProfileToasts: false,
  showErrorToasts: false,
  userProfileAnalysisInterval: 10,
  userProfileMaxPreferences: 20,
  userProfileMaxPatterns: 15,
  userProfileMaxWorkflows: 10,
  userProfileChangelogRetentionCount: 5,
  aiSessionRetentionDays: 7,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  maxVectorsPerShard: 50000,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  deduplicationEnabled: true,
  deduplicationSimilarityThreshold: 0.9,
  transcriptStorage: { enabled: false, maxAgeDays: 30 },
  memoryScoring: {
    enabled: false,
    recalculationIntervalMinutes: 60,
    recencyHalfLifeDays: 7,
    utilityHalfLifeDays: 3,
  },
  memoryLifecycle: {
    stmDecayDays: 7,
    ltmDecayDays: 90,
    promotionThreshold: 0.7,
    archiveThreshold: 0.2,
    archiveAfterDays: 30,
    checkIntervalMinutes: 60,
  },
  compaction: { enabled: true, memoryLimit: 10 },
  chatMessage: {
    enabled: false,
    maxMemories: 3,
    excludeCurrentSession: true,
    injectOn: "first" as const,
    maxAgeDays: undefined,
  },
  retrieval: { maxResults: 20, diversityThreshold: 0.9, contextBoost: 1.5 },
};

mockClient = {
  warmup: () => {},
  isReady: () => true,
  searchMemories: (...args: unknown[]) => {
    searchCalls.push(args);
    return { success: true, results: [], total: 0, timing: 0 };
  },
  listMemories: (_tag: unknown, _limit: unknown, scope = "project") => {
    lastListScope = scope;
    return {
      success: true,
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
      scope,
    };
  },
  addMemory: () => ({ success: true, id: "m1" }),
  deleteMemory: () => ({ success: true }),
  searchMemoriesBySessionID: () => ({ success: true, results: [], total: 0, timing: 0 }),
  close() {},
};

async function createPlugin(defaultScope?: "project" | "all-projects") {
  mockConfig.memory.defaultScope = defaultScope;
  const { OpenCodeMemPlugin } = await import("../src/index.js");
  return OpenCodeMemPlugin({
    directory: "/workspace",
    client: {},
  } as unknown as PluginInput);
}

// The public `Tool` type demands a full ToolContext and returns a
// ToolResult wrapper, but the memory tool's execute actually takes
// `{ sessionID }` and returns a JSON string (see src/index.ts: every
// branch JSON.stringifies). Type the call sites to that contract.
type MemoryToolLike = {
  execute: (
    args: {
      mode?: "add" | "search" | "profile" | "list" | "forget" | "help";
      content?: string;
      query?: string;
      tags?: string;
      type?: string;
      memoryId?: string;
      limit?: number;
      scope?: "project" | "all-projects";
    },
    ctx: { sessionID: string }
  ) => Promise<string>;
};

function getMemoryTool(plugin: { tool?: Record<string, unknown> }): MemoryToolLike {
  const memoryTool = plugin.tool?.memory;
  if (!memoryTool) throw new Error("memory tool not available");
  return memoryTool as MemoryToolLike;
}

describe("tool memory scope", () => {
  afterEach(() => {
    searchCalls.length = 0;
    lastListScope = undefined;
    vi.clearAllMocks();
  });

  it("falls back to config default scope", async () => {
    const memoryTool = getMemoryTool(await createPlugin("all-projects"));

    await memoryTool.execute({ mode: "search", query: "hello" }, { sessionID: "s1" });
    expect(searchCalls[0]?.[2]).toBe("all-projects");
  });

  it("lets explicit args scope override config", async () => {
    const memoryTool = getMemoryTool(await createPlugin("all-projects"));

    await memoryTool.execute({ mode: "list", scope: "project" }, { sessionID: "s1" });
    expect(lastListScope).toBe("project");
  });

  it("falls back to project when config scope is unset", async () => {
    const memoryTool = getMemoryTool(await createPlugin(undefined));

    await memoryTool.execute({ mode: "list" }, { sessionID: "s1" });
    expect(lastListScope).toBe("project");
  });

  it("reports actual deletion failures from forget", async () => {
    mockClient.deleteMemory = () => ({ success: false, error: "Memory not found" });
    const memoryTool = getMemoryTool(await createPlugin());

    const result = JSON.parse(
      await memoryTool.execute({ mode: "forget", memoryId: "missing" }, { sessionID: "s1" })
    );
    expect(result.success).toBe(false);
    expect(result.message).toBe("Memory not found");

    mockClient.deleteMemory = () => ({ success: true });
  });
});

afterAll(() => {
  rmSync(`/tmp/opencode-mem0-test-scope-${process.pid}`, { recursive: true, force: true });
});
