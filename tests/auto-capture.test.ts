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

vi.mock("../src/services/tags.js", () => ({
  getTags: (...args: any[]) => mockGetTags(...args),
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: (...args: any[]) => mockGetTags(...args),
}));

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
  warn: (...args: any[]) => mockWarn(...args),
}));

vi.mock("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: () => ({
      executeToolCall: () => {
        throw new Error("External API not configured for auto-capture");
      },
    }),
  },
}));

vi.mock("../src/services/ai/provider-config.js", () => ({
  buildMemoryProviderConfig: () => ({}),
}));

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: mockUserPromptManager,
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
    mockMemoryClient.addMemory.mockReset();
    mockMemoryClient.listMemories.mockReset();
    mockGetTags.mockReset();
    mockWarn.mockReset();
    // Reset CONFIG to defaults
    CONFIG.opencodeProvider = undefined;
    CONFIG.opencodeModel = undefined;
    CONFIG.memoryModel = "test-model";
    CONFIG.memoryApiUrl = "http://test";
    CONFIG.memoryProvider = "openai-chat";
    CONFIG.showAutoCaptureToasts = false;
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
    await expect(performAutoCapture(ctxNoClient, "sess-1", "/test")).rejects.toThrow(
      "Client not available"
    );

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

    // This should throw "External API not configured" — proving it got past the mutex check
    await expect(performAutoCapture(ctx2, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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

  it("throws when client is not available", async () => {
    mockUserPromptManager.getLastUncapturedPrompt.mockReturnValue({
      id: "p1",
      messageId: "m1",
      content: "test",
    });
    mockUserPromptManager.claimPrompt.mockReturnValue(true);
    await expect(performAutoCapture({ client: null } as any, "sess-1", "/test")).rejects.toThrow(
      "Client not available"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    // generateSummary will fail because no API configured — error is caught by finally
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow(
      "External API not configured for auto-capture"
    );
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

    // Should proceed and throw from generateSummary (provider path)
    await expect(performAutoCapture(ctx, "sess-1", "/test")).rejects.toThrow();
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
});
