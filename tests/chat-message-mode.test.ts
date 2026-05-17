import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/client.js", () => ({
  memoryClient: {
    warmup: vi.fn().mockResolvedValue(undefined),
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
  cleanupOldTranscripts: vi.fn(),
}));

vi.mock("../src/services/web-server.js", () => ({
  WebServer: vi.fn().mockImplementation(() => ({
    getUrl: () => "http://localhost:4747",
    isRunning: () => true,
    isServerOwner: () => true,
    setOnTakeoverCallback: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
  startWebServer: vi.fn().mockImplementation(() =>
    Promise.resolve({
      getUrl: () => "http://localhost:4747",
      isRunning: () => true,
      isServerOwner: () => true,
      setOnTakeoverCallback: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
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
  runOneTimeScoringRecalculation: vi.fn(),
}));

vi.mock("../src/services/memory-lifecycle.js", () => ({
  startLifecycleJob: vi.fn(),
  stopLifecycleJob: vi.fn(),
  runLifecycleMaintenance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    getProvider: vi.fn(),
    startCleanupSchedule: vi.fn(),
    stopCleanupSchedule: vi.fn(),
  },
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
      mode: "relevant" as "relevant" | "fast",
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
    webServerApiKey: undefined,
    memoryScoring: { enabled: false },
    memoryLifecycle: { enabled: false },
    transcriptStorage: { enabled: false },
    autoCaptureEnabled: false,
  },
  initConfig: vi.fn(),
}));

import { OpenCodeMemPlugin } from "../src/index.js";
import { memoryClient } from "../src/services/client.js";
import { formatContextForPrompt } from "../src/services/context.js";

const searchMemoriesSpy = memoryClient.searchMemories as ReturnType<typeof vi.fn>;
const listMemoriesSpy = memoryClient.listMemories as ReturnType<typeof vi.fn>;
const formatContextForPromptSpy = formatContextForPrompt as ReturnType<typeof vi.fn>;

function makeCtx() {
  return {
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
  };
}

function makeOutput(text: string) {
  return {
    message: { id: "msg-1" },
    parts: [{ type: "text" as const, text }],
  };
}

describe("chat-message-mode", () => {
  beforeEach(() => {
    searchMemoriesSpy.mockReset();
    listMemoriesSpy.mockReset();
    formatContextForPromptSpy.mockClear();
  });

  it("uses searchMemories when mode='relevant'", async () => {
    import("../src/config.js");
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as any).chatMessage.mode = "relevant";
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [],
      total: 0,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any);
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output);

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
    (CONFIG as any).chatMessage.mode = "fast";
    listMemoriesSpy.mockResolvedValue({
      success: true,
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any);
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output);

    expect(listMemoriesSpy).toHaveBeenCalledTimes(1);
    expect(listMemoriesSpy).toHaveBeenCalledWith("test-project-tag", 3);
    expect(searchMemoriesSpy).not.toHaveBeenCalled();
  });

  it("defaults to 'relevant' when mode is undefined", async () => {
    const { CONFIG } = await import("../src/config.js");
    (CONFIG as any).chatMessage.mode = undefined;
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [],
      total: 0,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any);
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I implement auth?");

    await (plugin as any)["chat.message"](input, output);

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
    (CONFIG as any).chatMessage.mode = "relevant";
    searchMemoriesSpy.mockResolvedValue({
      success: true,
      results: [
        { similarity: 0.87, memory: "use bcrypt for password hashing" },
        { similarity: 0.65, memory: "enable MFA on admin accounts" },
      ],
      total: 2,
      timing: 0,
    });

    const plugin = await OpenCodeMemPlugin(makeCtx() as any);
    const input = { sessionID: "s-1" };
    const output = makeOutput("how do I secure login?");

    await (plugin as any)["chat.message"](input, output);

    expect(formatContextForPromptSpy).toHaveBeenCalledTimes(1);
    const [, projectMemories] = formatContextForPromptSpy.mock.calls[0];
    expect(projectMemories.results).toHaveLength(2);
    expect(projectMemories.results[0].similarity).toBe(0.87);
    expect(projectMemories.results[1].similarity).toBe(0.65);
    expect(projectMemories.results[0].memory).toBe("use bcrypt for password hashing");
  });
});
