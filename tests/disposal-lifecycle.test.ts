import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../src/services/client.js", () => ({
  memoryClient: {
    warmup: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  },
}));

let disposed = false;

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  setStatePath: vi.fn(),
  setConnectedProviders: vi.fn(),
  setProviderStateInit: vi.fn(),
  ensureProviderState: () => Promise.resolve(),
  markPluginDisposed: (value: boolean) => {
    disposed = value;
  },
  isPluginDisposed: () => disposed,
}));

const mocks = vi.hoisted(() => ({
  performAutoCapture: vi.fn().mockResolvedValue(undefined),
  performTranscriptCapture: vi.fn().mockResolvedValue(undefined),
  cleanupOldTranscripts: vi.fn(),
  performUserProfileLearning: vi.fn().mockResolvedValue(undefined),
  startWebServerDeferred: [] as Array<(server: unknown) => void>,
  lastServer: null as {
    getUrl: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    isServerOwner: ReturnType<typeof vi.fn>;
    setOnTakeoverCallback: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock("../src/services/auto-capture.js", () => ({
  performAutoCapture: mocks.performAutoCapture,
}));

vi.mock("../src/services/user-memory-learning.js", () => ({
  performUserProfileLearning: mocks.performUserProfileLearning,
}));

vi.mock("../src/services/transcript-capture.js", () => ({
  performTranscriptCapture: mocks.performTranscriptCapture,
  cleanupOldTranscripts: mocks.cleanupOldTranscripts,
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    savePrompt: vi.fn(),
    buildPrompt: vi.fn().mockReturnValue("test"),
    pruneCapturedOlderThan: vi.fn().mockReturnValue(0),
  },
}));

vi.mock("../src/services/context.js", () => ({
  formatContextForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: vi.fn().mockReturnValue({ project: { tag: "tag_project_test" } }),
}));

vi.mock("../src/services/privacy.js", () => ({
  stripPrivateContent: vi.fn((x: string) => x),
  isFullyPrivate: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/services/ai/session/ai-session-manager.js", () => ({
  getAISessionManager: () => ({ cleanupExpiredSessions: () => 0 }),
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    embeddingAvailable: true,
    isWarmedUp: true,
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

vi.mock("../src/services/cleanup-service.js", () => ({
  cleanupService: {
    shouldRunCleanup: () => false,
    runCleanup: vi.fn(),
  },
}));

vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: { checkpointAll: vi.fn() },
}));

let configWebServerEnabled = false;

vi.mock("../src/config.js", () => ({
  isConfigured: () => true,
  initConfig: vi.fn(),
  get CONFIG() {
    return {
      get webServerEnabled() {
        return configWebServerEnabled;
      },
      webServerPort: 4747,
      webServerHost: "127.0.0.1",
      webServerApiKey: undefined,
      warmupTimeoutMs: 100,
      memoryScoring: { enabled: false },
      memoryLifecycle: { enabled: false },
      transcriptStorage: { enabled: true, maxAgeDays: 30 },
      autoCaptureEnabled: true,
      profileLearningEnabled: true,
      promptRetentionDays: 30,
      compaction: { enabled: false, memoryLimit: 10 },
      chatMessage: { enabled: false },
      showAutoCaptureToasts: false,
    };
  },
}));

vi.mock("../src/services/web-server.js", () => ({
  WebServer: vi.fn(),
  startWebServer: vi.fn(
    () =>
      new Promise((resolve) => {
        // Resolved by the test — models slow listener startup
        mocks.startWebServerDeferred.push(resolve);
      })
  ),
}));

import { OpenCodeMemPlugin } from "../src/index.js";

function makeCtx() {
  return {
    directory: "/test",
    client: {
      session: { prompt: vi.fn().mockResolvedValue({ success: true }) },
      tui: { showToast: vi.fn().mockResolvedValue(undefined) },
      path: { get: vi.fn().mockResolvedValue({ data: { state: "/test/.opencode" } }) },
      provider: { list: vi.fn().mockResolvedValue({ data: { connected: [] } }) },
    },
  };
}

describe("plugin disposal lifecycle (review findings D1/D2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    disposed = false;
    configWebServerEnabled = false;
    mocks.startWebServerDeferred = [];
    mocks.lastServer = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("idle event arriving after dispose starts no new work", async () => {
    const plugin = await OpenCodeMemPlugin(makeCtx() as never);
    if (!plugin.event) throw new Error("event hook missing");
    await plugin.dispose();

    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "sess-after" } },
    });

    // Idle handler debounces 10s — advance past it
    await vi.advanceTimersByTimeAsync(10001);

    expect(mocks.performAutoCapture).not.toHaveBeenCalled();
    expect(mocks.performTranscriptCapture).not.toHaveBeenCalled();
  });

  it("web server resolution after dispose is stopped, not resurrected", async () => {
    configWebServerEnabled = true;
    const plugin = await OpenCodeMemPlugin(makeCtx() as never);
    await plugin.dispose();

    expect(mocks.startWebServerDeferred.length).toBe(1);
    const server = {
      getUrl: vi.fn(() => "http://localhost:4747"),
      isRunning: vi.fn(() => true),
      isServerOwner: vi.fn(() => true),
      setOnTakeoverCallback: vi.fn(),
      stop: vi.fn(),
    };
    mocks.lastServer = server;
    mocks.startWebServerDeferred[0](server);
    await vi.advanceTimersByTimeAsync(50);

    expect(server.stop).toHaveBeenCalled();
    expect(server.getUrl).not.toHaveBeenCalled();
  });
});
