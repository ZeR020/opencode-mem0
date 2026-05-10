import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSessionManager = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  getMessages: vi.fn(),
  addMessageAtomic: vi.fn(),
};

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

const { GoogleGeminiProvider } = await import("../src/services/ai/providers/google-gemini.js");

describe("GoogleGeminiProvider", () => {
  let provider: any;

  beforeEach(() => {
    mockFetch.mockClear();
    mockSessionManager.getSession.mockReset();
    mockSessionManager.createSession.mockReset();
    mockSessionManager.getMessages.mockReset();
    mockSessionManager.addMessageAtomic.mockReset();

    provider = new GoogleGeminiProvider(
      {
        apiKey: "test-key",
        model: "gemini-1.5-flash",
        apiUrl: "https://test.googleapis.com/v1beta",
        maxIterations: 3,
        iterationTimeout: 5000,
        memoryTemperature: 0.3,
      },
      mockSessionManager as any
    );
  });

  it("returns correct provider name", () => {
    expect(provider.getProviderName()).toBe("google-gemini");
  });

  it("supports session", () => {
    expect(provider.supportsSession()).toBe(true);
  });

  it("creates new session if none exists", async () => {
    mockSessionManager.getSession.mockReturnValue(null);
    mockSessionManager.createSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "save_memory",
                      args: { summary: "test", type: "feature", tags: ["test"] },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "type", "tags"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    expect(mockSessionManager.createSession).toHaveBeenCalledWith({
      provider: "google-gemini",
      sessionId: "test-session",
    });
    expect(result.success).toBe(true);
  });

  it("returns error on API failure", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response("API Error", { status: 500, statusText: "Internal Server Error" })
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "type", "tags"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error for invalid response format", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Gemini API response format");
  });

  it("handles fetch errors", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("uses default API URL when not configured", async () => {
    const defaultProvider = new GoogleGeminiProvider(
      {
        apiKey: "test-key",
        model: "gemini-1.5-flash",
        maxIterations: 1,
        iterationTimeout: 5000,
        memoryTemperature: false,
      },
      mockSessionManager as any
    );

    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "save_memory",
                      args: { summary: "test", type: "feature", tags: ["test"] },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "type", "tags"],
        },
      },
    };

    await defaultProvider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toContain("generativelanguage.googleapis.com");

    // Check that no temperature was sent when memoryTemperature is false
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.generationConfig).toEqual({});
  });

  it("reaches max iterations without tool call", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    // Return a response with text but no function call (fresh Response each call)
    mockFetch.mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "I will help you." }],
                },
              },
            ],
          }),
          { status: 200 }
        )
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Max iterations");
    expect(result.iterations).toBeLessThanOrEqual(3);
  });

  it("converts existing messages to Gemini format", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([
      { role: "user", content: "Hello", toolCalls: undefined, toolCallId: undefined },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tc-1", type: "function", function: { name: "test", arguments: '{"key":"val"}' } },
        ],
      },
      { role: "tool", content: '{"result":"ok"}', toolCallId: "tc-1" },
    ]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "save_memory",
                      args: { summary: "test", type: "feature", tags: ["test"] },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "type", "tags"],
        },
      },
    };

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      toolSchema,
      "test-session"
    );

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.contents).toHaveLength(4); // 3 existing + 1 user prompt
    expect(requestBody.contents[0].role).toBe("user");
    expect(requestBody.contents[1].parts[0].functionCall).toBeDefined();
    expect(requestBody.contents[2].parts[0].functionResponse).toBeDefined();

    expect(result.success).toBe(true);
  });

  it("skips system messages when converting", async () => {
    mockSessionManager.getSession.mockReturnValue({
      id: "session-1",
      provider: "google-gemini",
      sessionId: "test-session",
    });
    mockSessionManager.getMessages.mockReturnValue([
      { role: "system", content: "System instruction" },
      { role: "user", content: "Hello" },
    ]);
    mockSessionManager.addMessageAtomic.mockReturnValue(0);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "save_memory",
                      args: { summary: "test", type: "feature", tags: ["test"] },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "save_memory",
        description: "Save memory",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "type", "tags"],
        },
      },
    };

    await provider.executeToolCall("System prompt", "User prompt", toolSchema, "test-session");

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // System message should be skipped, only user + systemInstruction should exist
    const userMessages = requestBody.contents.filter((c: any) => c.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(requestBody.systemInstruction).toBeDefined();
  });
});
