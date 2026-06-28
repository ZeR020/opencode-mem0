import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserPromptManager = {
  getLastUncapturedPrompt: vi.fn(),
  claimPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  linkMemoryToPrompt: vi.fn(),
  markAsCaptured: vi.fn(),
  resetPromptClaim: vi.fn(),
  countUnanalyzedForUserLearning: vi.fn(),
  getPromptsForUserLearning: vi.fn(),
  markMultipleAsUserLearningCaptured: vi.fn(),
};

const mockMemoryClient = {
  addMemory: vi.fn(),
  listMemories: vi.fn(),
};

const mockGetTags = vi.fn();
const mockWarn = vi.fn();
const mockLog = vi.fn();
const mockExecuteToolCall = vi.fn().mockImplementation(() => {
  throw new Error("External API not configured for auto-capture");
});
const mockCreateProvider = vi.fn().mockReturnValue({
  executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
});
const mockDetectLanguage = vi.fn().mockReturnValue("en");
const mockGetLanguageName = vi.fn().mockReturnValue("English");
const mockIsProviderConnected = vi.fn().mockReturnValue(true);
const mockGetStatePath = vi.fn().mockReturnValue("/some/path");
const mockGenerateStructuredOutput = vi.fn();

vi.mock("../src/services/tags.js", () => ({
  getTags: (...args: any[]) => mockGetTags(...args),
}));

vi.mock("../src/services/client.js", () => ({
  memoryClient: mockMemoryClient,
}));

vi.mock("../src/services/logger.js", () => ({
  log: (...args: unknown[]) => mockLog(...args),
  warn: (...args: unknown[]) => mockWarn(...args),
}));

vi.mock("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  },
}));

vi.mock("../src/services/ai/provider-config.js", () => ({
  buildMemoryProviderConfig: () => ({}),
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: mockUserPromptManager,
}));
vi.mock("../src/services/ai/opencode-provider.js", () => ({
  isProviderConnected: (...args: unknown[]) => mockIsProviderConnected(...args),
  getStatePath: (...args: unknown[]) => mockGetStatePath(...args),
  generateStructuredOutput: (...args: unknown[]) => mockGenerateStructuredOutput(...args),
}));

vi.mock("../src/services/language-detector.js", () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
  getLanguageName: (...args: unknown[]) => mockGetLanguageName(...args),
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    storagePath: "/tmp/opencode-mem0-test",
    showAutoCaptureToasts: false,
    showUserProfileToasts: false,
    opencodeProvider: null,
    opencodeModel: null,
    memoryModel: null,
    memoryApiUrl: null,
    memoryProvider: null,
    userProfileAnalysisInterval: 5,
    userProfileMaxPreferences: 10,
    userProfileMaxPatterns: 10,
    userProfileMaxWorkflows: 5,
    autoCaptureLanguage: "auto",
    memoryTemperature: 0.3,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    maxVectorsPerShard: 10000,
    maxMemories: 10,
    similarityThreshold: 0.7,
  },
}));

// Import after mocks
const { performAutoCapture } = await import("../src/services/auto-capture.js");
const { CONFIG } = await import("../src/config.js");

describe("auto-capture helpers", () => {
  beforeEach(() => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReset();
    mockUserPromptManager.claimPrompt.mockReset();
    mockUserPromptManager.deletePrompt.mockReset();
    mockUserPromptManager.linkMemoryToPrompt.mockReset();
    mockUserPromptManager.markAsCaptured.mockReset();
    mockUserPromptManager.resetPromptClaim.mockReset();
    mockMemoryClient.addMemory.mockReset().mockResolvedValue({ success: true, id: "mem1" });
    mockMemoryClient.listMemories.mockReset();
    mockGetTags.mockReset();
    mockWarn.mockReset();
    mockLog.mockReset();
    // Reset CONFIG to defaults
    CONFIG.opencodeProvider = undefined;
    CONFIG.opencodeModel = undefined;
    CONFIG.memoryModel = "test-model";
    CONFIG.memoryApiUrl = "http://test";
    CONFIG.memoryProvider = "openai-chat";
    CONFIG.showAutoCaptureToasts = false;
    mockExecuteToolCall.mockReset().mockImplementation(() => {
      throw new Error("External API not configured for auto-capture");
    });
    mockCreateProvider.mockReset().mockReturnValue({
      executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
    });
    mockDetectLanguage.mockReset().mockReturnValue("en");
    mockGetLanguageName.mockReset().mockReturnValue("English");
    mockIsProviderConnected.mockReset().mockReturnValue(true);
    mockGetStatePath.mockReset().mockReturnValue("/some/path");
    mockGenerateStructuredOutput.mockReset();
  });

  it("acquires mutex and prevents concurrent capture calls", async () => {
    let resolveMessages: (value: any) => void = () => {};
    const messagesPromise = new Promise((resolve) => {
      resolveMessages = resolve;
    });

    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);

    const ctx = {
      client: {
        session: {
          messages: () => messagesPromise,
        },
      },
    } as any;

    // First call enters and waits on messages()
    const firstCall = performAutoCapture(ctx, "sess-1", "/test");

    // Second call should return early because isCaptureRunning is true
    const secondCall = performAutoCapture(ctx, "sess-1", "/test");

    // Second call should resolve immediately without throwing
    await expect(secondCall).resolves.toBeUndefined();

    // Clean up first call
    resolveMessages({ data: [] });
    await firstCall;
  });

  it("releases mutex after exception, allowing subsequent calls", async () => {
    // First call: no client, throws "Client not available"
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);

    const ctxNoClient = { client: null } as any;
    // Config errors no longer re-throw — they return cleanly
    await expect(performAutoCapture(ctxNoClient, "sess-1", "/test")).resolves.toBeUndefined();

    // Second call: should proceed past the mutex check because it was released
    const ctx2 = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "reply" }] },
            ],
          }),
        },
      },
    } as any;

    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });

    // Proves it got past the mutex check — config errors no longer re-throw
    await expect(performAutoCapture(ctx2, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("returns early when no uncaptured prompt", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue(null);
    await performAutoCapture({} as any, "sess-1", "/test");
    expect(mockUserPromptManager.claimPrompt).not.toHaveBeenCalled();
  });

  it("returns early when prompt claim fails", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(false);
    await performAutoCapture({} as any, "sess-1", "/test");
    expect(mockMemoryClient.addMemory).not.toHaveBeenCalled();
  });

  it("returns gracefully when client is not available", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    // Config errors no longer re-throw — they return cleanly
    await expect(
      performAutoCapture({ client: null } as any, "sess-1", "/test")
    ).resolves.toBeUndefined();
  });

  it("returns early when prompt message not found in session", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "missing",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: { messages: () => ({ data: [{ info: { id: "other" } }] }) },
      },
    } as any;
    await performAutoCapture(ctx, "sess-1", "/test");
    expect(mockMemoryClient.addMemory).not.toHaveBeenCalled();
  });

  it("returns early when no AI messages after prompt", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: { messages: () => ({ data: [{ info: { id: "m1" } }] }) },
      },
    } as any;
    await performAutoCapture(ctx, "sess-1", "/test");
    expect(mockMemoryClient.addMemory).not.toHaveBeenCalled();
  });

  it("returns early when AI messages contain only empty text", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test prompt",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "text", text: "" }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await performAutoCapture(ctx, "sess-1", "/test");
    expect(mockMemoryClient.addMemory).not.toHaveBeenCalled();
  });

  it("returns early when session messages fail", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: { messages: () => ({ data: undefined }) },
      },
    } as any;
    await performAutoCapture(ctx, "sess-1", "/test");
    expect(mockMemoryClient.addMemory).not.toHaveBeenCalled();
  });

  it("returns early when AI response has only tool calls with no text", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "tool", tool: "read", state: { input: "file.ts" } }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    // Config errors no longer re-throw — they return cleanly
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("processes through when all data is valid (falls through to generateSummary error)", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "fix the bug in auth",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "text", text: "Fixed the authentication bug in login.ts" }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    // generateSummary fails because no API configured — config errors no longer re-throw
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("includes latest memory context when available", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "add login feature",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "text", text: "Added login page component" }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({
      success: true,
      memories: [{ summary: "Previous: added auth middleware" }],
    });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("truncates long latest memory content", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const longContent = "x".repeat(1000);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "text", text: "Done" }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({
      success: true,
      memories: [{ summary: longContent }],
    });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("extracts tool call input from object state", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test with tools",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [
                  { type: "text", text: "Used tool" },
                  {
                    type: "tool",
                    tool: "write",
                    state: { input: { filePath: "/a/b.ts", content: "code" } },
                  },
                ],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("extracts tool call input from string parameter", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [
                  { type: "text", text: "done" },
                  {
                    type: "tool",
                    tool: "bash",
                    state: { input: "npm install" },
                  },
                ],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("handles non-assistant role messages gracefully", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              { info: { id: "a1", role: "system" }, parts: [{ type: "text", text: "system msg" }] },
              {
                info: { id: "a2", role: "assistant" },
                parts: [{ type: "text", text: "assistant reply" }],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("handles messages without parts array", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [{ type: "text", text: "reply" }],
              },
              { info: { id: "a2", role: "assistant" } },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("truncates long tool input", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    const longInput = "x".repeat(200);
    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              {
                info: { id: "a1", role: "assistant" },
                parts: [
                  { type: "text", text: "done" },
                  { type: "tool", tool: "write", state: { input: longInput } },
                ],
              },
            ],
          }),
        },
      },
    } as any;
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
  });

  it("skips capture with log warning when no LLM is configured", async () => {
    CONFIG.opencodeProvider = undefined;
    CONFIG.opencodeModel = undefined;
    CONFIG.memoryModel = undefined;
    CONFIG.memoryApiUrl = undefined;

    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);

    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });

    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "reply" }] },
            ],
          }),
        },
      },
    } as any;

    await performAutoCapture(ctx, "sess-1", "/test");

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("not configured"));
  });

  it("resumes capture after LLM config becomes available", async () => {
    // First: no config
    CONFIG.opencodeProvider = undefined;
    CONFIG.opencodeModel = undefined;
    CONFIG.memoryModel = undefined;
    CONFIG.memoryApiUrl = undefined;

    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);

    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });

    const ctx = {
      client: {
        session: {
          messages: () => ({
            data: [
              { info: { id: "m1" } },
              { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "reply" }] },
            ],
          }),
        },
      },
    } as any;

    await performAutoCapture(ctx, "sess-1", "/test");
    expect(mockWarn).toHaveBeenCalled();
    mockWarn.mockClear();

    // Now set config and try again
    CONFIG.memoryModel = "gpt-4";
    CONFIG.memoryApiUrl = "http://test";

    // Config errors no longer re-throw; provider setup failure returns cleanly
    await expect(performAutoCapture(ctx, "sess-1", "/test")).resolves.toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("shows TUI toast only for unexpected runtime errors, not for missing config", async () => {
    CONFIG.showAutoCaptureToasts = true;

    const showToast = vi.fn().mockResolvedValue(undefined);
    const mockMessages = vi.fn();

    const ctx = {
      client: {
        session: {
          messages: mockMessages,
        },
        tui: { showToast },
      },
    } as any;

    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);

    // Scenario 1: missing config error
    CONFIG.opencodeProvider = undefined;
    CONFIG.opencodeModel = undefined;
    CONFIG.memoryModel = undefined;
    CONFIG.memoryApiUrl = undefined;

    mockMessages.mockResolvedValue({
      data: [
        { info: { id: "m1" } },
        { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "reply" }] },
      ],
    });
    mockGetTags.mockReturnValue({
      project: {
        tag: "mem_project_test",
        displayName: "Test",
        userName: null,
        userEmail: null,
        projectPath: "/test",
        projectName: "test",
        gitRepoUrl: null,
      },
    });
    mockMemoryClient.listMemories.mockResolvedValue({ success: false, memories: [] });

    await performAutoCapture(ctx, "sess-1", "/test").catch(() => {});
    expect(showToast).not.toHaveBeenCalled();

    // Scenario 2: runtime error (network error from messages)
    showToast.mockClear();
    const networkError = new Error("Network timeout");
    mockMessages.mockRejectedValue(networkError);

    await performAutoCapture(ctx, "sess-1", "/test").catch(() => {});
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Auto-capture Error",
          variant: "error",
        }),
      })
    );
  });

  describe("new coverage branches", () => {
    describe("generateSummaryViaProvider", () => {
      it("handles success path, lowercasing and trimming tags", async () => {
        // ponytail: config and prompt mock
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Created a new test",
            type: "feature",
            tags: [" TEST ", "coverage"],
          },
        });

        mockMemoryClient.addMemory.mockResolvedValue({
          success: true,
          id: "mem1",
          type: "feature",
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalled();
        expect(mockMemoryClient.addMemory).toHaveBeenCalledWith(
          "Created a new test",
          "mem_project_test",
          expect.objectContaining({
            type: "feature",
            tags: ["test", "coverage"],
          })
        );
      });

      it("handles failure path where executeToolCall returns success=false", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: false,
          error: "API rate limit reached",
        });

        await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
          "API rate limit reached"
        );
      });

      it("handles missing data path where executeToolCall returns success=true but data=null", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: null,
        });

        await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
          "Failed to generate summary"
        );
      });
    });

    describe("generateSummary branching", () => {
      it("calls generateSummaryViaOpencode when opencode config is present", async () => {
        CONFIG.opencodeProvider = "openai";
        CONFIG.opencodeModel = "gpt-4o";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockIsProviderConnected.mockReturnValue(true);
        mockGenerateStructuredOutput.mockResolvedValue({
          summary: "Opencode generated summary",
          type: "feature",
          tags: ["opencode"],
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockGenerateStructuredOutput).toHaveBeenCalled();
        expect(mockExecuteToolCall).not.toHaveBeenCalled();
      });

      it("calls generateSummaryViaProvider when opencode is missing but provider config is present", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Provider generated summary",
            type: "feature",
            tags: ["provider"],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalled();
        expect(mockGenerateStructuredOutput).not.toHaveBeenCalled();
      });

      it("throws error when neither is configured", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "temp-model";
        CONFIG.memoryApiUrl = "http://temp";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockImplementation(() => {
          CONFIG.memoryModel = undefined;
          CONFIG.memoryApiUrl = undefined;
          return {
            project: {
              tag: "mem_project_test",
              displayName: "Test",
              userName: null,
              userEmail: null,
              projectPath: "/test",
              projectName: "test",
              gitRepoUrl: null,
            },
          };
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockLog).toHaveBeenCalledWith(
          "Auto-capture skipped — configuration not ready",
          expect.objectContaining({ error: "External API not configured for auto-capture" })
        );
      });
    });

    describe("generateSummaryViaOpencode", () => {
      it("handles success path and lowercases tags", async () => {
        CONFIG.opencodeProvider = "openai";
        CONFIG.opencodeModel = "gpt-4o";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockIsProviderConnected.mockReturnValue(true);
        mockGenerateStructuredOutput.mockResolvedValue({
          summary: "Opencode generated summary",
          type: "feature",
          tags: [" OPENCODE ", "test"],
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockMemoryClient.addMemory).toHaveBeenCalledWith(
          "Opencode generated summary",
          "mem_project_test",
          expect.objectContaining({
            type: "feature",
            tags: ["opencode", "test"],
          })
        );
      });

      it("throws cleanly when provider is not connected", async () => {
        CONFIG.opencodeProvider = "openai";
        CONFIG.opencodeModel = "gpt-4o";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        mockIsProviderConnected.mockReturnValue(false);

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockLog).toHaveBeenCalledWith(
          "Auto-capture skipped — configuration not ready",
          expect.objectContaining({
            error:
              "opencode provider 'openai' is not connected. Check your opencode provider configuration.",
          })
        );
      });
    });

    describe("detectTargetLanguage", () => {
      it("calls detectLanguage when autoCaptureLanguage is auto", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";
        CONFIG.autoCaptureLanguage = "auto";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "bonjour tout le monde",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockDetectLanguage).toHaveBeenCalledWith("bonjour tout le monde");
        expect(mockGetLanguageName).toHaveBeenCalled();
      });

      it("returns the configured fixed language directly without calling detectLanguage", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";
        CONFIG.autoCaptureLanguage = "fr";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "bonjour tout le monde",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockDetectLanguage).not.toHaveBeenCalled();
        expect(mockGetLanguageName).toHaveBeenCalledWith("fr");
      });
    });

    describe("getLatestProjectMemory", () => {
      it("includes short memory content in markdown context", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [{ summary: "Short previous memory" }],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining("Short previous memory"),
          expect.any(Object),
          expect.any(String)
        );
      });

      it("truncates long memory content > 500 chars in markdown context", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        const longMemory = "a".repeat(600);
        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [{ summary: longMemory }],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        const expectedTruncated = "a".repeat(500) + "...";
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining(expectedTruncated),
          expect.any(Object),
          expect.any(String)
        );
      });

      it("returns null context when memories are empty", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.any(String),
          expect.not.stringContaining("Previous Memory Context"),
          expect.any(Object),
          expect.any(String)
        );
      });

      it("returns null context when listMemories fails/throws", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "test prompt",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockRejectedValue(new Error("DB Connection Error"));

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.any(String),
          expect.not.stringContaining("Previous Memory Context"),
          expect.any(Object),
          expect.any(String)
        );
      });
    });

    describe("buildMarkdownContext", () => {
      it("builds context with all sections present", async () => {
        CONFIG.opencodeProvider = undefined;
        CONFIG.opencodeModel = undefined;
        CONFIG.memoryModel = "test-model";
        CONFIG.memoryApiUrl = "http://test";
        CONFIG.memoryProvider = "openai-chat";

        mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
          id: "p1",
          messageId: "m1",
          content: "User request text",
        });
        mockUserPromptManager.claimPrompt.mockReturnValue(true);

        mockGetTags.mockReturnValue({
          project: {
            tag: "mem_project_test",
            displayName: "Test",
            userName: null,
            userEmail: null,
            projectPath: "/test",
            projectName: "test",
            gitRepoUrl: null,
          },
        });

        mockMemoryClient.listMemories.mockResolvedValue({
          success: true,
          memories: [{ summary: "Previous context text" }],
        });

        const mockMessages = async () => ({
          data: [
            { info: { id: "m1" } },
            {
              info: { id: "a1", role: "assistant" },
              parts: [
                { type: "text", text: "AI Response text" },
                { type: "tool", tool: "toolWithInput", state: { input: "arg1" } },
                { type: "tool", tool: "toolNoInput" },
              ],
            },
          ],
        });

        const ctx = {
          client: {
            session: {
              messages: mockMessages,
            },
          },
        } as unknown as PluginInput;

        mockExecuteToolCall.mockResolvedValue({
          success: true,
          data: {
            summary: "Done",
            type: "feature",
            tags: [],
          },
        });

        await performAutoCapture(ctx, "sess-1", "/test");

        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining(
            "## Previous Memory Context\n---\nPrevious context text\n---\n\n## User Request\n---\nUser request text\n---\n\n## AI Response\n---\nAI Response text\n---\n\n## Tools Used\n---\n- toolWithInput(arg1)\n- toolNoInput\n---"
          ),
          expect.any(Object),
          expect.any(String)
        );
      });
    });
  });
});
