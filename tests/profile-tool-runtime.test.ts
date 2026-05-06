import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

const WARMUP_KEY = Symbol.for("opencode-mem0.plugin.warmedup");

let tmpDir: string;

var mockClient: any;
var currentTags: any;

vi.mock("../src/services/client.js", () => ({
  memoryClient: mockClient,
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: () => currentTags,
  getProjectName: (dir: string) => dir.split(/[\\/]/).pop() || dir,
}));

mockClient = {
  warmup: async () => {},
  isReady: async () => true,
  searchMemories: async () => ({ success: true, results: [], total: 0, timing: 0 }),
  listMemories: async () => ({ success: true, memories: [], pagination: {} }),
  addMemory: async () => ({ success: true, id: "m1" }),
  deleteMemory: async () => ({ success: true }),
  searchMemoriesBySessionID: async () => ({ success: true, results: [], total: 0, timing: 0 }),
  close() {},
};

currentTags = {
  project: { tag: "project-tag" },
  user: { userEmail: undefined as string | undefined, userName: undefined as string | undefined },
};

function writeProjectConfig(config: Record<string, unknown>) {
  const opencodeDir = join(tmpDir, ".opencode");
  mkdirSync(opencodeDir, { recursive: true });
  writeFileSync(join(opencodeDir, "opencode-mem0.json"), JSON.stringify(config), "utf-8");
}

async function createPlugin(tagsMock?: { userEmail?: string; userName?: string }) {
  globalThis[WARMUP_KEY as keyof typeof globalThis] = true as any;

  if (tagsMock) {
    currentTags.user = { userEmail: tagsMock.userEmail, userName: tagsMock.userName };
  } else {
    currentTags.user = { userEmail: undefined, userName: undefined };
  }

  const { OpenCodeMemPlugin } = await import("../src/index.js");
  return OpenCodeMemPlugin({
    directory: tmpDir,
    worktree: tmpDir,
    project: { id: "test-project" } as any,
    serverUrl: new URL("http://localhost:4096"),
    client: {
      path: { get: async () => ({ data: { state: join(tmpDir, "state") } }) },
      provider: { list: async () => ({ data: { connected: [] } }) },
      tui: null,
    } as any,
    $: (() => {
      throw new Error("not used in tests");
    }) as any,
  });
}

describe("memory tool profile runtime behavior", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opencode-mem0-runtime-"));
  });

  beforeEach(() => {
    const opencodeDir = join(tmpDir, ".opencode");
    if (existsSync(opencodeDir)) rmSync(opencodeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete globalThis[WARMUP_KEY as keyof typeof globalThis];

    const userProfilesDbPath = join(tmpDir, "data", "user-profiles.db");
    if (existsSync(userProfilesDbPath)) {
      const db = connectionManager.getConnection(userProfilesDbPath);
      try {
        db.run("DELETE FROM user_profile_changelogs");
        db.run("DELETE FROM user_profiles");
      } catch {}
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis[WARMUP_KEY as keyof typeof globalThis];
  });

  afterAll(() => {
    connectionManager.closeAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects query in profile mode", async () => {
    writeProjectConfig({
      storagePath: join(tmpDir, "data"),
      userEmailOverride: "test@example.com",
      userNameOverride: "Test User",
      webServerEnabled: false,
      autoCaptureEnabled: false,
    });

    const plugin = await createPlugin({ userEmail: "test@example.com", userName: "Test User" });
    const result = JSON.parse(
      await plugin.tool.memory.execute({ mode: "profile", query: "jira" }, { sessionID: "s1" })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("query is not valid for profile mode");
  });

  it("writes a preference when content is provided and returns it on read", async () => {
    writeProjectConfig({
      storagePath: join(tmpDir, "data"),
      userEmailOverride: "test@example.com",
      userNameOverride: "Test User",
      webServerEnabled: false,
      autoCaptureEnabled: false,
    });

    const plugin = await createPlugin({ userEmail: "test@example.com", userName: "Test User" });

    const writeResult = JSON.parse(
      await plugin.tool.memory.execute(
        { mode: "profile", content: "Default Jira board is DOPS" },
        { sessionID: "s2" }
      )
    );
    expect(writeResult.success).toBe(true);

    const readResult = JSON.parse(
      await plugin.tool.memory.execute({ mode: "profile" }, { sessionID: "s2" })
    );
    expect(readResult.success).toBe(true);
    expect(
      readResult.profile.preferences.some(
        (p: any) => p.description === "Default Jira board is DOPS"
      )
    ).toBe(true);
  });

  it("blocks blank content", async () => {
    writeProjectConfig({
      storagePath: join(tmpDir, "data"),
      userEmailOverride: "test@example.com",
      userNameOverride: "Test User",
      webServerEnabled: false,
      autoCaptureEnabled: false,
    });

    const plugin = await createPlugin({ userEmail: "test@example.com", userName: "Test User" });
    const result = JSON.parse(
      await plugin.tool.memory.execute({ mode: "profile", content: "   " }, { sessionID: "s3" })
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("content must not be blank");
  });

  it("blocks fully private content including adjacent redacted blocks", async () => {
    writeProjectConfig({
      storagePath: join(tmpDir, "data"),
      userEmailOverride: "test@example.com",
      userNameOverride: "Test User",
      webServerEnabled: false,
      autoCaptureEnabled: false,
    });

    const plugin = await createPlugin({ userEmail: "test@example.com", userName: "Test User" });
    const result = JSON.parse(
      await plugin.tool.memory.execute(
        {
          mode: "profile",
          content: "<private>a</private><private>b</private>",
        },
        { sessionID: "s4" }
      )
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Private content blocked");
  });

  it("errors when no user email can be resolved", async () => {
    writeProjectConfig({
      storagePath: join(tmpDir, "data"),
      webServerEnabled: false,
      autoCaptureEnabled: false,
    });

    const plugin = await createPlugin({ userEmail: undefined, userName: undefined });
    const result = JSON.parse(
      await plugin.tool.memory.execute(
        { mode: "profile", content: "Default Jira board is DOPS" },
        { sessionID: "s5" }
      )
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "Cannot save profile preference because no user email could be resolved"
    );
  });
});
