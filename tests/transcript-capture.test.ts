import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSaveTranscript = vi.fn();
const mockDeleteOldTranscripts = vi.fn();

vi.mock("../src/services/sqlite/transcript-manager.js", () => ({
  transcriptManager: {
    saveTranscript: (...args: any[]) => mockSaveTranscript(...args),
    deleteOldTranscripts: (...args: any[]) => mockDeleteOldTranscripts(...args),
  },
}));

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: () => ({
    project: {
      tag: "test-tag",
      displayName: "Test",
      userName: "test",
      userEmail: "test@example.com",
      projectPath: "/test",
      projectName: "TestProject",
      gitRepoUrl: "https://github.com/test",
    },
    user: { userEmail: "test@example.com", displayName: "Test", userName: "test" },
  }),
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    transcriptStorage: { enabled: true, maxAgeDays: 30 },
  },
}));

const { performTranscriptCapture, cleanupOldTranscripts } =
  await import("../src/services/transcript-capture.js");

describe("transcript-capture", () => {
  beforeEach(() => {
    mockSaveTranscript.mockClear();
    mockDeleteOldTranscripts.mockClear();
  });

  it("returns early if client is missing", async () => {
    await performTranscriptCapture({} as any, "sess-1", "/test");
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("returns early if no messages", async () => {
    await performTranscriptCapture(
      { client: { session: { messages: async () => ({ data: [] }) } } } as any,
      "sess-1",
      "/test"
    );
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("captures and saves transcript with filtered messages", async () => {
    const messages = [
      {
        info: { role: "user", id: "msg-1", timestamp: Date.now() },
        parts: [
          { type: "text", text: "Hello" },
          { type: "text", text: "Synthetic", synthetic: true },
        ],
      },
      {
        info: { role: "assistant", id: "msg-2" },
        parts: [
          { type: "text", text: "Hi there" },
          { type: "tool", tool: "test", state: { status: "done", input: "in", output: "out" } },
        ],
      },
    ];
    mockSaveTranscript.mockReturnValue({ id: "trans-1" });

    await performTranscriptCapture(
      { client: { session: { messages: async () => ({ data: messages }) } } } as any,
      "sess-2",
      "/test"
    );

    expect(mockSaveTranscript).toHaveBeenCalledOnce();
    const [, projectPath, filtered] = mockSaveTranscript.mock.calls[0];
    expect(projectPath).toBe("/test");
    expect(filtered).toHaveLength(2);
    // First message should have only 1 part (synthetic filtered out)
    expect(filtered[0].parts).toHaveLength(1);
    expect(filtered[0].parts[0].text).toBe("Hello");
    // Second message should have tool part with state stripped
    expect(filtered[1].parts).toHaveLength(2);
    expect(filtered[1].parts[1].state).toEqual({ status: "done", input: "in", output: "out" });
  });

  it("skips messages without parts", async () => {
    const messages = [{ info: { role: "user" } }];
    mockSaveTranscript.mockReturnValue({ id: "trans-2" });

    await performTranscriptCapture(
      { client: { session: { messages: async () => ({ data: messages }) } } } as any,
      "sess-3",
      "/test"
    );

    expect(mockSaveTranscript).toHaveBeenCalledOnce();
    const [, , filtered] = mockSaveTranscript.mock.calls[0];
    expect(filtered[0].parts).toBeUndefined();
  });

  it("does not capture same session concurrently", async () => {
    const messages = [{ info: { role: "user" }, parts: [{ type: "text", text: "Hello" }] }];
    mockSaveTranscript.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: "trans" }), 50))
    );

    const ctx = { client: { session: { messages: async () => ({ data: messages }) } } } as any;
    const p1 = performTranscriptCapture(ctx, "sess-dedup", "/test");
    const p2 = performTranscriptCapture(ctx, "sess-dedup", "/test");
    await Promise.all([p1, p2]);
    expect(mockSaveTranscript).toHaveBeenCalledTimes(1);
  });

  it("handles errors gracefully", async () => {
    await performTranscriptCapture(
      {
        client: {
          session: {
            messages: () => {
              return Promise.reject(new Error("fail"));
            },
          },
        },
      } as any,
      "sess-err",
      "/test"
    );
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  describe("cleanupOldTranscripts", () => {
    it("returns 0 when disabled", async () => {
      const original = (await import("../src/config.js")).CONFIG;
      original.transcriptStorage.enabled = false;
      const result = await cleanupOldTranscripts();
      expect(result).toBe(0);
      original.transcriptStorage.enabled = true;
    });

    it("deletes old transcripts when enabled", async () => {
      mockDeleteOldTranscripts.mockReturnValue(5);
      const result = await cleanupOldTranscripts();
      expect(result).toBe(5);
      expect(mockDeleteOldTranscripts).toHaveBeenCalledOnce();
      const [cutoff] = mockDeleteOldTranscripts.mock.calls[0];
      expect(cutoff).toBeLessThan(Date.now());
      expect(cutoff).toBeGreaterThan(Date.now() - 31 * 24 * 60 * 60 * 1000);
    });
  });
});
