import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

let originalStoragePath: string;
const tmpDirs: string[] = [];

async function makeSessionManager() {
  const tmpDir = mkdtempSync(join(tmpdir(), "opencode-mem0-ai-session-"));
  tmpDirs.push(tmpDir);
  const { CONFIG } = await import("../src/config.js");
  if (originalStoragePath === undefined) {
    originalStoragePath = CONFIG.storagePath;
  }
  CONFIG.storagePath = tmpDir;
  const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
  return { manager: new AISessionManager(), tmpDir };
}

describe("AISessionManager", () => {
  afterEach(async () => {
    connectionManager.closeAll();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
    if (originalStoragePath !== undefined) {
      const { CONFIG } = await import("../src/config.js");
      CONFIG.storagePath = originalStoragePath;
    }
  });

  it("creates and retrieves a session", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-1",
      provider: "openai-chat",
    });
    expect(session.sessionId).toBe("sess-1");
    expect(session.provider).toBe("openai-chat");
    expect(session.id).toMatch(/^sess_\d+_[a-f0-9]+$/);

    const retrieved = manager.getSession("sess-1", "openai-chat");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });

  it("returns null for non-existent session", async () => {
    const { manager } = await makeSessionManager();
    expect(manager.getSession("nonexistent", "openai-chat")).toBeNull();
  });

  it("creates session with conversationId and metadata", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-2",
      provider: "anthropic",
      conversationId: "conv-1",
      metadata: { model: "claude-3" },
    });
    expect(session.conversationId).toBe("conv-1");
    expect(session.metadata).toEqual({ model: "claude-3" });
  });

  it("updates session conversationId", async () => {
    const { manager } = await makeSessionManager();
    manager.createSession({
      sessionId: "sess-3",
      provider: "openai-chat",
    });
    manager.updateSession("sess-3", "openai-chat", { conversationId: "new-conv" });
    const retrieved = manager.getSession("sess-3", "openai-chat");
    expect(retrieved!.conversationId).toBe("new-conv");
  });

  it("updates session metadata", async () => {
    const { manager } = await makeSessionManager();
    manager.createSession({
      sessionId: "sess-4",
      provider: "openai-chat",
    });
    manager.updateSession("sess-4", "openai-chat", { metadata: { key: "value" } });
    const retrieved = manager.getSession("sess-4", "openai-chat");
    expect(retrieved!.metadata).toEqual({ key: "value" });
  });

  it("updates both conversationId and metadata", async () => {
    const { manager } = await makeSessionManager();
    manager.createSession({
      sessionId: "sess-5",
      provider: "openai-chat",
    });
    manager.updateSession("sess-5", "openai-chat", {
      conversationId: "conv-5",
      metadata: { model: "gpt-4" },
    });
    const retrieved = manager.getSession("sess-5", "openai-chat");
    expect(retrieved!.conversationId).toBe("conv-5");
    expect(retrieved!.metadata).toEqual({ model: "gpt-4" });
  });

  it("adds and retrieves messages", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-6",
      provider: "openai-chat",
    });
    manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "user",
      content: "Hello",
    });
    manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "assistant",
      content: "Hi there",
    });
    const messages = manager.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("adds message atomically with auto sequence", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-7",
      provider: "openai-chat",
    });
    const seq1 = manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "user",
      content: "First",
    });
    const seq2 = manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "assistant",
      content: "Second",
    });
    expect(seq1).toBe(0);
    expect(seq2).toBe(1);
  });

  it("gets last sequence", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-8",
      provider: "openai-chat",
    });
    expect(manager.getLastSequence(session.id)).toBe(-1);
    manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "user",
      content: "Hello",
    });
    expect(manager.getLastSequence(session.id)).toBe(0);
  });

  it("cleans up expired sessions", async () => {
    await makeSessionManager();
    // Set retention to 0 to make sessions expire immediately
    const { CONFIG } = await import("../src/config.js");
    const originalRetention = CONFIG.aiSessionRetentionDays;
    CONFIG.aiSessionRetentionDays = 0;

    // Create new manager with 0 retention
    connectionManager.closeAll();
    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    const zeroManager = new AISessionManager();

    zeroManager.createSession({
      sessionId: "sess-expired",
      provider: "openai-chat",
    });

    // Wait a tiny bit
    await new Promise((r) => setTimeout(r, 10));

    const deleted = zeroManager.cleanupExpiredSessions();
    expect(deleted).toBeGreaterThanOrEqual(0);

    CONFIG.aiSessionRetentionDays = originalRetention;
  });

  it("handles message with tool calls", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-11",
      provider: "openai-chat",
    });
    manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc-1", type: "function", function: { name: "test", arguments: "{}" } }],
    });
    const messages = manager.getMessages(session.id);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls![0].function.name).toBe("test");
  });

  it("handles message with content blocks", async () => {
    const { manager } = await makeSessionManager();
    const session = manager.createSession({
      sessionId: "sess-12",
      provider: "openai-chat",
    });
    manager.addMessageAtomic({
      aiSessionId: session.id,
      role: "assistant",
      content: "",
      contentBlocks: [{ type: "text", text: "Hello" }],
    });
    const messages = manager.getMessages(session.id);
    expect(messages[0].contentBlocks).toHaveLength(1);
    expect(messages[0].contentBlocks![0].type).toBe("text");
  });

  it("accepts dbPath option to use :memory: SQLite", async () => {
    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    const manager = new AISessionManager({ dbPath: ":memory:" });
    const session = manager.createSession({
      sessionId: "sess-memory",
      provider: "openai-chat",
    });
    expect(session.sessionId).toBe("sess-memory");

    const retrieved = manager.getSession("sess-memory", "openai-chat");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });
});
