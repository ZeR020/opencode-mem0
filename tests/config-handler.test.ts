import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConfigView } from "../src/services/handlers/config.js";
import type { ApiResponse } from "../src/services/handlers/shared-types.js";

// Config handler tests run against a throwaway HOME so the global config file
// and the live CONFIG singleton never touch the developer's real setup.
let configDir: string;
let prevHome: string | undefined;

async function loadFresh() {
  vi.resetModules();
  const configModule = await import("../src/config.js");
  const handlerModule = await import("../src/services/handlers/config.js");
  return { ...handlerModule, CONFIG: configModule.CONFIG, CONFIG_FILES: configModule.CONFIG_FILES };
}

function configFilePath(format: "jsonc" | "json" = "jsonc"): string {
  return join(homedir(), ".config", "opencode", `opencode-mem0.${format}`);
}

/** Assert success and narrow res.data to a concrete ConfigView. */
function expectData(res: ApiResponse<ConfigView>): ConfigView {
  expect(res.success).toBe(true);
  expect(res.data).toBeDefined();
  return res.data as ConfigView;
}

function firstConfigFile(files: string[]): string {
  return files[0] as string;
}

beforeEach(() => {
  prevHome = process.env.HOME;
  configDir = mkdtempSync(join(tmpdir(), "mem0-config-test-"));
  process.env.HOME = configDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(configDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("config handler", () => {
  it("GET returns defaults with a masked empty key when no config file exists", async () => {
    const { handleGetConfig } = await loadFresh();
    const res = await handleGetConfig();
    const data = expectData(res);
    expect(data.memoryProvider).toBe("openai-chat");
    expect(data.memoryApiKeyMasked).toBe("");
    expect(data.configFile).toBeNull();
    expect(data.projectConfigFile).toBeNull();
  });

  it("PUT persists provider + model to disk and hot-applies to live CONFIG", async () => {
    const { handleUpdateConfig, CONFIG, CONFIG_FILES } = await loadFresh();
    const res = await handleUpdateConfig({
      memoryProvider: "anthropic",
      memoryModel: "claude-sonnet-4-20250514",
    });
    const data = expectData(res);
    expect(data.memoryProvider).toBe("anthropic");
    expect(CONFIG.memoryProvider).toBe("anthropic");
    expect(CONFIG.memoryModel).toBe("claude-sonnet-4-20250514");
    const configPath = firstConfigFile(CONFIG_FILES);
    expect(existsSync(configPath)).toBe(true);
    const text = readFileSync(configPath, "utf8");
    expect(text).toContain('"memoryProvider": "anthropic"');
    expect(text).toContain('"memoryModel": "claude-sonnet-4-20250514"');
  });

  it("stores the raw API key in the file but only ever returns a masked form", async () => {
    const { handleUpdateConfig, handleGetConfig, CONFIG_FILES } = await loadFresh();
    await handleUpdateConfig({ memoryApiKey: "sk-test-1234567890" });
    const fileText = readFileSync(CONFIG_FILES[0], "utf8");
    expect(fileText).toContain("sk-test-1234567890");
    const res = await handleGetConfig();
    const data = expectData(res);
    expect(data.memoryApiKeyMasked).toBe("\u2022\u2022\u2022\u2022" + "7890");
    expect(data.memoryApiKeyMasked).not.toContain("sk-test");
  });

  it('removes a key from file and CONFIG when set to ""', async () => {
    const { handleUpdateConfig, CONFIG, CONFIG_FILES } = await loadFresh();
    await handleUpdateConfig({ memoryModel: "claude-sonnet-4-20250514" });
    expect(CONFIG.memoryModel).toBe("claude-sonnet-4-20250514");
    const res = await handleUpdateConfig({ memoryModel: "" });
    expect(res.success).toBe(true);
    expect(CONFIG.memoryModel).toBeUndefined();
    expect(readFileSync(firstConfigFile(CONFIG_FILES), "utf8")).not.toContain("memoryModel");
  });

  it("rejects unknown keys without touching the file", async () => {
    const { handleUpdateConfig, CONFIG_FILES } = await loadFresh();
    const res = await handleUpdateConfig({ webServerPort: 9000 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("unknown key: webServerPort");
    expect(existsSync(firstConfigFile(CONFIG_FILES))).toBe(false);
  });

  it("preserves existing comments in a .jsonc file across updates", async () => {
    const { handleUpdateConfig } = await loadFresh();
    const path = configFilePath("jsonc");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{\n  // my custom note\n  "memoryProvider": "openai-chat",\n}\n', {
      mode: 0o600,
    });
    const res = await handleUpdateConfig({ memoryModel: "gpt-4o-mini" });
    const data = expectData(res);
    expect(data.configFormat).toBe("jsonc");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("// my custom note");
    expect(text).toContain('"memoryModel": "gpt-4o-mini"');
  });

  it("rejects invalid enum values before writing anything", async () => {
    const { handleUpdateConfig, CONFIG_FILES } = await loadFresh();
    const res = await handleUpdateConfig({ memoryProvider: "nope" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("memoryProvider");
    expect(existsSync(firstConfigFile(CONFIG_FILES))).toBe(false);
  });

  it("no-ops on an empty partial without touching the filesystem", async () => {
    const { handleUpdateConfig, CONFIG_FILES } = await loadFresh();
    const res = await handleUpdateConfig({});
    const data = expectData(res);
    expect(data.note).toBe("no changes");
    expect(existsSync(firstConfigFile(CONFIG_FILES))).toBe(false);
  });

  it("resolves env:// API keys on hot-apply but keeps the reference in the file", async () => {
    process.env.MEM0_TEST_LLM_KEY = "sk-resolved";
    try {
      const { handleUpdateConfig, CONFIG, CONFIG_FILES } = await loadFresh();
      const res = await handleUpdateConfig({ memoryApiKey: "env://MEM0_TEST_LLM_KEY" });
      expect(res.success).toBe(true);
      // Live CONFIG must hold the resolved secret, not the raw env:// reference.
      expect(CONFIG.memoryApiKey).toBe("sk-resolved");
      expect(readFileSync(firstConfigFile(CONFIG_FILES), "utf8")).toContain(
        "env://MEM0_TEST_LLM_KEY"
      );
    } finally {
      delete process.env.MEM0_TEST_LLM_KEY;
    }
  });
});
