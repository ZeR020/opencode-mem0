import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/client.js", () => ({
  memoryClient: {
    warmup: vi.fn().mockResolvedValue(undefined), // skipcq: JS-W1042
    searchMemories: vi.fn(),
    listMemories: vi.fn(),
  },
}));

vi.mock("../src/services/context.js", () => ({
  formatContextForPrompt: vi.fn().mockReturnValue("injected context"),
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: vi.fn().mockReturnValue({
    project: { tag: "test-project-tag" },
    user: { userEmail: "test@example.com" },
  }),
}));

vi.mock("../src/services/privacy.js", () => ({
  stripPrivateContent: vi.fn((x: string) => x),
  isFullyPrivate: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/services/auto-capture.js", () => ({
  performAutoCapture: vi.fn(),
}));

vi.mock("../src/services/user-memory-learning.js", () => ({
  performUserProfileLearning: vi.fn(),
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    savePrompt: vi.fn(),
  },
}));

vi.mock("../src/services/transcript-capture.js", () => ({
  performTranscriptCapture: vi.fn(),
  cleanupOldTranscripts: vi.fn(),
}));

vi.mock("../src/services/web-server.js", () => ({
  WebServer: vi.fn().mockImplementation(() => ({
    getUrl: () => "http://localhost:4747",
    isRunning: () => true,
    isServerOwner: () => true,
    setOnTakeoverCallback: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined), // skipcq: JS-W1042
  })),
  startWebServer: vi.fn().mockImplementation(() =>
    Promise.resolve({
      getUrl: () => "http://localhost:4747",
      isRunning: () => true,
      isServerOwner: () => true,
      setOnTakeoverCallback: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined), // skipcq: JS-W1042
    })
  ),
}));

vi.mock("../src/services/utils/safe-transforms.js", () => ({
  safeJSONParse: vi.fn((x: string) => {
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  }),
}));

vi.mock("../src/services/memory-scoring-service.js", () => ({
  startScoringRecalculation: vi.fn(),
  stopScoringRecalculation: vi.fn(),
  recalculateAllScores: vi.fn(),
}));

vi.mock("../src/services/memory-lifecycle.js", () => ({
  startLifecycleJob: vi.fn(),
  stopLifecycleJob: vi.fn(),
  runLifecycleMaintenance: vi.fn().mockResolvedValue(undefined), // skipcq: JS-W1042
}));

vi.mock("../src/services/ai/session/ai-session-manager.js", () => ({
  getAISessionManager: () => ({ cleanupExpiredSessions: () => 0 }),
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    embeddingAvailable: true,
    getEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  setStatePath: vi.fn(),
  setConnectedProviders: vi.fn(),
}));

vi.mock("../src/services/language-detector.js", () => ({
  getLanguageName: vi.fn().mockReturnValue("English"),
}));

vi.mock("../src/config.js", () => ({
  isConfigured: () => true,
  CONFIG: {
    chatMessage: {
      enabled: true,
      maxMemories: 3,
      excludeCurrentSession: false,
      injectOn: "always" as const,
      mode: "relevant" as string | undefined,
      maxAgeDays: undefined as number | undefined,
    },
    injection: {
      tokenBudget: 4000,
      format: "plain" as const,
    },
    showErrorToasts: false,
    warmupTimeoutMs: 30000,
    webServerEnabled: false,
    webServerPort: 4747,
    webServerHost: "127.0.0.1",
    webServerApiKey: undefined as string | undefined,
    memoryScoring: { enabled: false },
    memoryLifecycle: { enabled: false },
    transcriptStorage: { enabled: false },
    autoCaptureEnabled: false,
    promptTrackingEnabled: true,
  },
  initConfig: vi.fn(),
}));

import { OpenCodeMemPlugin } from "../src/index.js";
import { memoryClient } from "../src/services/client.js";
import { formatContextForPrompt } from "../src/services/context.js";
import { userPromptManager } from "../src/services/user-prompt/user-prompt-manager.js";

const searchMemoriesSpy = memoryClient.searchMemories as ReturnType<typeof vi.fn>;
const listMemoriesSpy = memoryClient.listMemories as ReturnType<typeof vi.fn>;
const formatContextForPromptSpy = formatContextForPrompt as ReturnType<typeof vi.fn>;
const savePromptSpy = userPromptManager.savePrompt as unknown as ReturnType<typeof vi.fn>;

describe("chat-message-mode", () => {
  const makeCtx = (): Record<string, unknown> => ({
    directory: "/test",
    client: {
      session: {
        messages: vi.fn().mockResolvedValue({ data: [] }),
      },
      tui: {
        showToast: vi.fn(),
      },
      path: {
        get: vi.fn().mockResolvedValue({ data: { state: "/test/.opencode" } }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({ data: { connected: [] } }),
      },
    },
  });

  const makeOutput = (text: string): Record<string, unknown> => ({
    message: { id: "msg-1" },
    parts: [{ type: "text" as const, text }],
  });

  beforeEach(() => {
    searchMemoriesSpy.mockReset();
    listMemoriesSpy.mockReset();
    formatContextForPromptSpy.mockClear();
    savePromptSpy.mockClear();
  });

  it("uses searchMemories when mode='relevant'", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as { chatMessage: { mode?: string | undefined } }).chatMessage.mode = "relevant";
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [],
      total: 0,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any); // skipcq: JS-0323
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output); // skipcq: JS-0323

    expect(searchMemoriesSpy).toHaveBeenCalledTimes(1);
    expect(searchMemoriesSpy).toHaveBeenCalledWith(
      "how do I implement auth?",
      "test-project-tag",
      "project",
      { projectPath: "/test" }
    );
    expect(listMemoriesSpy).not.toHaveBeenCalled();
  });

  it("uses listMemories when mode='fast'", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as { chatMessage: { mode?: string | undefined } }).chatMessage.mode = "fast";
    listMemoriesSpy.mockResolvedValue({
      success: true,
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any); // skipcq: JS-0323
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output); // skipcq: JS-0323

    expect(listMemoriesSpy).toHaveBeenCalledTimes(1);
    expect(listMemoriesSpy).toHaveBeenCalledWith("test-project-tag", 3);
    expect(searchMemoriesSpy).not.toHaveBeenCalled();
  });

  it("defaults to 'relevant' when mode is undefined", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as { chatMessage: { mode?: string | undefined } }).chatMessage.mode = undefined;
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [],
      total: 0,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any); // skipcq: JS-0323
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output); // skipcq: JS-0323

    expect(searchMemoriesSpy).toHaveBeenCalledTimes(1);
    expect(searchMemoriesSpy).toHaveBeenCalledWith(
      "how do I implement auth?",
      "test-project-tag",
      "project",
      { projectPath: "/test" }
    );
    expect(listMemoriesSpy).not.toHaveBeenCalled();
  });

  it("injects actual similarity scores from searchMemories in 'relevant' mode", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as { chatMessage: { mode?: string | undefined } }).chatMessage.mode = "relevant";
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [
        { similarity: 0.87, memory: "use bcrypt for password hashing" },
        { similarity: 0.65, memory: "enable MFA on admin accounts" },
      ],
      total: 2,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any); // skipcq: JS-0323
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I secure login?");

    await (plugin as any)["chat.message"](input, output); // skipcq: JS-0323

    expect(formatContextForPromptSpy).toHaveBeenCalledTimes(1);
    const [, projectMemories] = formatContextForPromptSpy.mock.calls[0];
    expect(projectMemories.results).toHaveLength(2);
    expect(projectMemories.results[0].similarity).toBe(0.87);
    expect(projectMemories.results[1].similarity).toBe(0.65);
    expect(projectMemories.results[0].memory).toBe("use bcrypt for password hashing");
  });

  it("skips savePrompt when promptTrackingEnabled=false but still injects", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as { promptTrackingEnabled: boolean }).promptTrackingEnabled = false;
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [{ similarity: 0.8, memory: "use bcrypt for password hashing" }],
      total: 1,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any); // skipcq: JS-0323
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I secure login?");

    await (plugin as any)["chat.message"](input, output); // skipcq: JS-0323

    expect(savePromptSpy).not.toHaveBeenCalled();
    expect(searchMemoriesSpy).toHaveBeenCalledTimes(1);
    expect(formatContextForPromptSpy).toHaveBeenCalledTimes(1);
    (CONFIG as { promptTrackingEnabled: boolean }).promptTrackingEnabled = true;
  });
});
