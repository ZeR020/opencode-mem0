import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/client.js", () => ({
  memoryClient: {
    warmup: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  },
}));

vi.mock("../src/services/web-server.js", () => ({
  WebServer: vi.fn().mockImplementation(() => ({
    getUrl: () => "http://localhost:4747",
    isRunning: () => true,
    isServerOwner: () => false,
    setOnTakeoverCallback: vi.fn(),
    stop: vi.fn(),
  })),
  startWebServer: vi.fn().mockResolvedValue({
    getUrl: () => "http://localhost:4747",
    isRunning: () => true,
    isServerOwner: () => false,
    setOnTakeoverCallback: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("../src/services/ai/opencode-provider.js", () => ({
  setStatePath: vi.fn(),
  setConnectedProviders: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  performAutoCapture: vi.fn().mockResolvedValue(undefined),
  performTranscriptCapture: vi.fn().mockResolvedValue(undefined),
  cleanupOldTranscripts: vi.fn(),
  performUserProfileLearning: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../src/config.js", () => ({
  isConfigured: () => true,
  CONFIG: {
    webServerEnabled: false,
    warmupTimeoutMs: 100,
    memoryScoring: { enabled: false },
    memoryLifecycle: { enabled: false },
    transcriptStorage: { enabled: true, maxAgeDays: 30 },
    autoCaptureEnabled: true,
    compaction: { enabled: false, memoryLimit: 10 },
    chatMessage: { enabled: false },
    showAutoCaptureToasts: false,
  },
  initConfig: vi.fn(),
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

describe("session.idle transcript capture wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls performTranscriptCapture on session.idle", async () => {
    const plugin = await OpenCodeMemPlugin(makeCtx() as never);
    if (!plugin.event) throw new Error("event hook missing");

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "sess-1" } } });

    // Idle handler debounces 10s — advance fake timers past it
    await vi.advanceTimersByTimeAsync(10001);

    expect(mocks.performTranscriptCapture).toHaveBeenCalledWith(
      expect.any(Object),
      "sess-1",
      "/test"
    );
  });

  it("calls performAutoCapture on session.idle", async () => {
    const plugin = await OpenCodeMemPlugin(makeCtx() as never);
    if (!plugin.event) throw new Error("event hook missing");

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "sess-2" } } });

    await vi.advanceTimersByTimeAsync(10001);

    expect(mocks.performAutoCapture).toHaveBeenCalledWith(expect.any(Object), "sess-2", "/test");
  });
});
