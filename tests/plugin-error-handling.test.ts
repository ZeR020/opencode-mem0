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
  setProviderStateInit: vi.fn(),
  ensureProviderState: () => Promise.resolve(),
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

vi.mock("../src/services/ai/session/ai-session-manager.js", () => ({
  getAISessionManager: () => ({ cleanupExpiredSessions: () => 0 }),
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
  recalculateAllScores: vi.fn(),
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

  it("warmup timeout race no longer triggers an unhandled promise rejection", async () => {
    vi.useFakeTimers();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const warmupKey = Symbol.for("opencode-mem0.plugin.warmedup");
    delete (globalThis as Record<symbol, unknown>)[warmupKey];
    const timeoutMs = 50;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const { memoryClient } = await import("../src/services/client.js");
      const { CONFIG } = await import("../src/config.js");
      (CONFIG as { warmupTimeoutMs: number }).warmupTimeoutMs = timeoutMs;
      (memoryClient.warmup as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(() => resolve(), 1))
      );

      const mockCtx = {
        directory: "/test",
        client: {
          session: { prompt: vi.fn().mockResolvedValue({ success: true }) },
          tui: { showToast: vi.fn().mockResolvedValue(undefined) },
          path: { get: vi.fn().mockResolvedValue({ data: { state: "/test/.opencode" } }) },
          provider: { list: vi.fn().mockResolvedValue({ data: { connected: [] } }) },
        },
      };

      const pluginPromise = OpenCodeMemPlugin(mockCtx as never);
      await Promise.resolve();
      const timeoutCallIndex = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === timeoutMs);
      expect(timeoutCallIndex).toBeGreaterThanOrEqual(0);
      const timeoutId = setTimeoutSpy.mock.results[timeoutCallIndex]?.value;

      await vi.advanceTimersByTimeAsync(1);
      await pluginPromise;
      await vi.advanceTimersByTimeAsync(timeoutMs + 50);
      await Promise.resolve();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
      (globalThis as Record<symbol, unknown>)[warmupKey] = true;
    }
  });
});
