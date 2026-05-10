import { describe, it, expect, vi } from "vitest";

// Mock the logger to capture log calls
const logCalls: Array<{ message: string; data?: Record<string, unknown> }> = [];
vi.mock("../src/services/logger.js", () => ({
  log: (message: string, data?: Record<string, unknown>) => {
    logCalls.push({ message, data });
  },
}));

// Mock dependencies
vi.mock("../src/services/client.js", () => ({
  memoryClient: {
    warmup: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../src/services/web-server.js", () => ({
  WebServer: vi.fn().mockImplementation(() => ({
    getUrl: () => "http://localhost:4747",
    isRunning: () => true,
    isServerOwner: () => true,
    setOnTakeoverCallback: vi.fn(),
    checkServerAvailable: vi.fn().mockResolvedValue(false),
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

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  setStatePath: vi.fn(),
  setConnectedProviders: vi.fn(),
}));

vi.mock("../src/services/auto-capture.js", () => ({
  performAutoCapture: vi.fn(),
}));

vi.mock("../src/services/user-memory-learning.js", () => ({
  performUserProfileLearning: vi.fn(),
}));

vi.mock("../src/services/transcript-capture.js", () => ({
  performTranscriptCapture: vi.fn(),
  cleanupOldTranscripts: vi.fn(),
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    buildPrompt: vi.fn().mockReturnValue("test prompt"),
  },
}));

vi.mock("../src/services/context.js", () => ({
  formatContextForPrompt: vi.fn().mockReturnValue("context"),
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/services/privacy.js", () => ({
  stripPrivateContent: vi.fn().mockImplementation((x) => x),
  isFullyPrivate: vi.fn().mockReturnValue(false),
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

vi.mock("../src/config.js", () => ({
  isConfigured: () => true,
  CONFIG: {
    webServerEnabled: true,
    webServerPort: 4747,
    webServerHost: "127.0.0.1",
    webServerApiKey: undefined,
    warmupTimeoutMs: 30000,
    memoryScoring: {
      enabled: false,
      recalculationIntervalMinutes: 60,
      recencyHalfLifeDays: 7,
      utilityHalfLifeDays: 3,
    },
    memoryLifecycle: {
      enabled: false,
      cleanupIntervalMinutes: 60,
    },
    transcriptCapture: {
      enabled: false,
    },
    userProfileLearning: {
      enabled: false,
    },
    autoCapture: {
      enabled: false,
    },
  },
  initConfig: vi.fn(),
}));

import { OpenCodeMemPlugin } from "../src/index.js";

describe("OpenCodeMemPlugin error handling", () => {
  it("logs error via .catch() when showToast() rejects on server start", async () => {
    logCalls.length = 0;

    const showToastError = new Error("Toast failed");
    const mockCtx = {
      directory: "/test",
      client: {
        session: {
          prompt: vi.fn().mockResolvedValue({ success: true }),
        },
        tui: {
          showToast: vi.fn().mockRejectedValue(showToastError),
        },
        path: {
          get: vi.fn().mockResolvedValue({ data: { state: "/test/.opencode" } }),
        },
        provider: {
          list: vi.fn().mockResolvedValue({ data: { connected: [] } }),
        },
      },
    };

    const plugin = await OpenCodeMemPlugin(mockCtx as any);

    // Trigger the web server start by calling the event hook
    if (plugin.hooks && plugin.hooks.event) {
      await plugin.hooks.event({ type: "server-start" } as any);
    }

    // Wait for promises to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify that the .catch() handler logged the error
    const toastErrors = logCalls.filter((call) => call.message === "Toast display failed");
    expect(toastErrors.length).toBeGreaterThanOrEqual(1);
    expect(toastErrors[0].data?.error).toContain("Toast failed");
  });

  it("logs error via .catch() when showToast() rejects on server takeover", async () => {
    logCalls.length = 0;

    const showToastError = new Error("Takeover toast failed");
    const mockCtx = {
      directory: "/test",
      client: {
        session: {
          prompt: vi.fn().mockResolvedValue({ success: true }),
        },
        tui: {
          showToast: vi.fn().mockRejectedValue(showToastError),
        },
        path: {
          get: vi.fn().mockResolvedValue({ data: { state: "/test/.opencode" } }),
        },
        provider: {
          list: vi.fn().mockResolvedValue({ data: { connected: [] } }),
        },
      },
    };

    await OpenCodeMemPlugin(mockCtx as any);

    // Wait for the takeover callback to be registered and called
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify that the .catch() handler logged the error
    const toastErrors = logCalls.filter((call) => call.message === "Toast display failed");
    expect(toastErrors.length).toBeGreaterThanOrEqual(1);
    expect(toastErrors[0].data?.error).toContain("Takeover toast failed");
  });
});
