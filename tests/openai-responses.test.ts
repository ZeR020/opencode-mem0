import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/services/ai/tools/tool-schema.js", () => ({
  ToolSchemaConverter: {
    toResponsesAPI: vi.fn((schema: any) => ({
      type: "function",
      function: schema.function,
    })),
  },
}));

import { OpenAIResponsesProvider } from "../src/services/ai/providers/openai-responses.js";
import { AISessionManager } from "../src/services/ai/session/ai-session-manager.js";

describe("OpenAIResponsesProvider", () => {
  let provider: OpenAIResponsesProvider;
  let sessionManager: AISessionManager;

  const mockConfig = {
    model: "gpt-4o",
    apiKey: "test-key",
    apiUrl: "https://api.openai.com/v1",
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
    provider = new OpenAIResponsesProvider(mockConfig, sessionManager);
  });

  it("returns provider name", () => {
    expect(provider.getProviderName()).toBe("openai-responses");
  });

  it("supports sessions", () => {
    expect(provider.supportsSession()).toBe(true);
  });

  it("creates new session when none exists", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-1",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-1",
            call_id: "call-1",
            name: "save_memories",
            arguments: JSON.stringify({ memories: ["test"] }),
          },
        ],
        conversation: "conv-1",
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
  });

  it("reuses existing session with conversationId", async () => {
    const _session = sessionManager.createSession({
      provider: "openai-responses",
      sessionId: "session-2",
    });
    sessionManager.updateSession("session-2", "openai-responses", {
      conversationId: "conv-existing",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-2",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-2",
            call_id: "call-2",
            name: "save_memories",
            arguments: JSON.stringify({ memories: ["existing"] }),
          },
        ],
        conversation: "conv-existing-2",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-2"
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ memories: ["existing"] });
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

  it("retries when no tool call is found", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp-3",
          object: "response",
          model: "gpt-4o",
          output: [
            {
              type: "message",
              content: "I need to use the tool.",
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp-4",
          object: "response",
          model: "gpt-4o",
          output: [
            {
              type: "function_call",
              id: "fc-4",
              call_id: "call-4",
              name: "save_memories",
              arguments: JSON.stringify({ memories: ["retried"] }),
            },
          ],
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

  it("returns error when max iterations reached without tool call", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "resp-5",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "message",
            content: "I don't need to save anything.",
          },
        ],
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

  it("handles extra params", async () => {
    const configWithExtras = {
      ...mockConfig,
      extraParams: { seed: 42, max_completion_tokens: 100 },
    };
    provider = new OpenAIResponsesProvider(configWithExtras, sessionManager);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-extra",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-extra",
            call_id: "call-extra",
            name: "save_memories",
            arguments: JSON.stringify({ test: true }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-extra"
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.seed).toBe(42);
    expect(body.max_completion_tokens).toBe(100);
  });

  it("handles invalid JSON in function arguments", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-bad",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-bad",
            call_id: "call-bad",
            name: "save_memories",
            arguments: "not valid json",
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-bad-json"
    );

    expect(result.success).toBe(false);
  });

  it("handles missing function arguments", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-no-args",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-no",
            call_id: "call-no",
            name: "save_memories",
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-no-args"
    );

    expect(result.success).toBe(false);
  });

  it("uses instructions on first call, conversation on subsequent", async () => {
    const _session = sessionManager.createSession({
      provider: "openai-responses",
      sessionId: "session-instructions",
    });

    // First call - should use instructions
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-inst",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-inst",
            call_id: "call-inst",
            name: "save_memories",
            arguments: JSON.stringify({ test: true }),
          },
        ],
        conversation: "conv-inst",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    await provider.executeToolCall(
      "You are a memory assistant.",
      "Save preferences",
      mockToolSchema,
      "session-instructions"
    );

    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.instructions).toBe("You are a memory assistant.");
    expect(firstBody.conversation).toBeUndefined();

    // Second call - should use conversation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-conv",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-conv",
            call_id: "call-conv",
            name: "save_memories",
            arguments: JSON.stringify({ test: true }),
          },
        ],
        conversation: "conv-inst",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    await provider.executeToolCall(
      "You are a memory assistant.",
      "More preferences",
      mockToolSchema,
      "session-instructions"
    );

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.conversation).toBe("conv-inst");
    expect(secondBody.instructions).toBeUndefined();
  });

  it("validates response structure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-val",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-val",
            call_id: "call-val",
            name: "save_memories",
            arguments: JSON.stringify({ test: true }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-validation"
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("rejects array responses from validation", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp-arr",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "fc-arr",
            call_id: "call-arr",
            name: "save_memories",
            arguments: JSON.stringify(["item1", "item2"]),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const result = await provider.executeToolCall(
      "System prompt",
      "User prompt",
      mockToolSchema,
      "session-array"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("array");
  });
});
