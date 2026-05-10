import { describe, it, expect, vi, beforeEach } from "vitest";
const mockFetch = vi.fn();
global.fetch = mockFetch;
vi.mock("../src/services/logger.js", () => ({ log: vi.fn() }));
vi.mock("../src/services/ai/tools/tool-schema.js", () => ({
  ToolSchemaConverter: {
    toResponsesAPI: vi.fn((schema: any) => ({ type: "function", function: schema.function })),
  },
}));
import { OpenAIResponsesProvider } from "../src/services/ai/providers/openai-responses.js";
import { AISessionManager } from "../src/services/ai/session/ai-session-manager.js";
describe("debug", () => {
  let provider: OpenAIResponsesProvider;
  let sessionManager: AISessionManager;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new AISessionManager({ dbPath: ":memory:" });
    provider = new OpenAIResponsesProvider(
      {
        model: "gpt-4o",
        apiKey: "k",
        apiUrl: "https://api.openai.com/v1",
        maxIterations: 3,
        iterationTimeout: 5000,
      },
      sessionManager
    );
  });
  it("debug", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "r",
        object: "response",
        model: "gpt-4o",
        output: [
          {
            type: "function_call",
            id: "f",
            call_id: "c",
            name: "save_memories",
            arguments: JSON.stringify({ test: true }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    });
    await provider.executeToolCall(
      "System prompt",
      "User prompt",
      {
        type: "function",
        function: { name: "save_memories", description: "Save", parameters: {} },
      },
      "sess-1"
    );
    console.log("calls:", mockFetch.mock.calls.length);
    console.log("body:", mockFetch.mock.calls[0]?.[1]?.body);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    console.log("parsed:", body);
    expect(body.instructions).toBe("System prompt");
  });
});
