import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/ai/tools/tool-schema.js", () => ({
  ToolSchemaConverter: {
    toAnthropic: vi.fn((schema: any) => ({
      name: schema.function.name,
      description: schema.function.description,
      input_schema: schema.function.parameters,
    })),
  },
}));

vi.mock("../src/services/ai/validators/user-profile-validator.js", () => ({
  UserProfileValidator: {
    validate: vi.fn((data: any) => ({ valid: true, data })),
  },
}));

import { AnthropicMessagesProvider } from "../src/services/ai/providers/anthropic-messages.js";
import { AISessionManager } from "../src/services/ai/session/ai-session-manager.js";
import { ToolSchemaConverter } from "../src/services/ai/tools/tool-schema.js";
import { UserProfileValidator } from "../src/services/ai/validators/user-profile-validator.js";

describe("AnthropicMessagesProvider", () => {
  let provider: AnthropicMessagesProvider;
  let sessionManager: AISessionManager;

  const mockConfig = {
    model: "claude-3-opus",
    apiKey: "test-key",
    apiUrl: "https://api.anthropic.com/v1",
    maxTokens: 4096,
    maxIterations: 3,
    iterationTimeout: 5000,
  };

  const mockToolSchema = {
    type: "function" as const,
    function: {
      name: "save_memories",
      description: "Save user memories",
      parameters: { type: "object", properties: {} },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new AISessionManager({ dbPath: ":memory:" });
    provider = new AnthropicMessagesProvider(mockConfig, sessionManager);
  });

  it("returns provider name", () => {
    expect(provider.getProviderName()).toBe("anthropic");
  });

  it("supports sessions", () => {
    expect(provider.supportsSession()).toBe(true);
  });

  it("creates new session when none exists", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "save_memories",
            input: { memories: ["test"] },
          },
        ],
        model: "claude-3-opus",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "You are a memory assistant.",
      "Save my preferences.",
      mockToolSchema,
      "session-1"
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ memories: ["test"] });
    expect(ToolSchemaConverter.toAnthropic).toHaveBeenCalled();
  });

  it("reuses existing session", async () => {
    sessionManager.createSession({
      provider: "anthropic",
      sessionId: "session-2",
      metadata: { systemPrompt: "You are a memory assistant." },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg-2",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-2",
            name: "save_memories",
            input: { memories: ["test2"] },
          },
        ],
        model: "claude-3-opus",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "You are a memory assistant.",
      "Save my preferences.",
      mockToolSchema,
      "session-2"
    );

    expect(result.success).toBe(true);
  });

  it("handles API error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "Rate limited",
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-error"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
    expect(result.error).toContain("Rate limited");
  });

  it("handles network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-net-error"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network failure");
  });

  it("handles timeout via AbortController", async () => {
    mockFetch.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error("AbortError");
          err.name = "AbortError";
          reject(err);
        }, 100);
      });
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-timeout"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("retries when stop_reason is end_turn", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-3",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "I need to use the tool." }],
          model: "claude-3-opus",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-4",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-3",
              name: "save_memories",
              input: { memories: ["retried"] },
            },
          ],
          model: "claude-3-opus",
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-retry"
    );

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns error when max iterations reached without tool use", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "msg-5",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "I don't need to save anything." }],
        model: "claude-3-opus",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-max"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Max iterations");
  });

  it("handles validation failure", async () => {
    vi.mocked(UserProfileValidator.validate).mockReturnValueOnce({
      valid: false,
      errors: ["Missing required field: content"],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg-6",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-6",
            name: "save_memories",
            input: { invalid: true },
          },
        ],
        model: "claude-3-opus",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-validation"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Validation failed");
  });

  it("skips system messages when converting history", async () => {
    const session = sessionManager.createSession({
      provider: "anthropic",
      sessionId: "session-history",
      metadata: { systemPrompt: "System" },
    });

    // Add system message
    sessionManager.addMessageAtomic({
      aiSessionId: session.id,
      role: "system",
      content: "System message",
    });

    // Add user message
    sessionManager.addMessageAtomic({
      aiSessionId: session.id,
      role: "user",
      content: "User message",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg-7",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-7",
            name: "save_memories",
            input: { test: true },
          },
        ],
        model: "claude-3-opus",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    await provider.executeToolCall("System", "Prompt", mockToolSchema, "session-history");

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    // Should only have user messages, no system role in messages array
    expect(body.messages.every((m: any) => m.role !== "system")).toBe(true);
    expect(body.messages.length).toBe(2); // historical user + current user
  });

  it("uses contentBlocks when available", async () => {
    const session = sessionManager.createSession({
      provider: "anthropic",
      sessionId: "session-blocks",
      metadata: { systemPrompt: "System" },
    });

    sessionManager.addMessageAtomic({
      aiSessionId: session.id,
      role: "assistant",
      content: "text content",
      contentBlocks: [{ type: "text", text: "block content" }],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg-8",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-8",
            name: "save_memories",
            input: { test: true },
          },
        ],
        model: "claude-3-opus",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    await provider.executeToolCall("System", "Prompt", mockToolSchema, "session-blocks");

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const assistantMsg = body.messages.find((m: any) => m.role === "assistant");
    expect(assistantMsg.content).toEqual([{ type: "text", text: "block content" }]);
  });
});
