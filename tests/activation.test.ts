import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "opencode-mem0-activation-"));
  homes.push(home);
  process.env.HOME = home;
  vi.resetModules();
  return home;
}

afterAll(() => {
  process.env.HOME = originalHome;
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

describe("activation gate", () => {
  it("logger writes nothing on an unconfigured machine", async () => {
    const home = freshHome();
    const { log, warn, error, flushLogs } = await import("../src/services/logger.js");
    log("info line");
    warn("warn line");
    error("error line");
    await flushLogs();
    expect(existsSync(join(home, ".opencode-mem0"))).toBe(false);
  });

  it("init creates config + data dir and flips isConfigured()", async () => {
    const home = freshHome();
    const { runInit } = await import("../src/cli.js");
    runInit();
    expect(existsSync(join(home, ".config", "opencode", "opencode-mem0.jsonc"))).toBe(true);
    expect(existsSync(join(home, ".opencode-mem0", "data"))).toBe(true);

    vi.resetModules();
    const { isConfigured } = await import("../src/config.js");
    expect(isConfigured()).toBe(true);
  });

  it("init is idempotent and never overwrites an existing config", async () => {
    const home = freshHome();
    const { runInit } = await import("../src/cli.js");
    runInit();
    const cfg = join(home, ".config", "opencode", "opencode-mem0.jsonc");
    writeFileSync(cfg, '{ "logLevel": "debug" }\n');
    runInit();
    expect(readFileSync(cfg, "utf-8")).toBe('{ "logLevel": "debug" }\n');
  });

  it("plugin entry stays inert and creates nothing when unconfigured", async () => {
    const home = freshHome();
    const project = join(home, "project");
    mkdirSync(project, { recursive: true });
    const toasts: unknown[] = [];
    const ctx = {
      directory: project,
      client: {
        path: { get: async () => ({ data: {} }) },
        provider: { list: async () => ({ data: {} }) },
        tui: {
          showToast: async (opts: unknown) => {
            toasts.push(opts);
          },
        },
      },
    };

    const { OpenCodeMemPlugin } = await import("../src/index.js");
    await OpenCodeMemPlugin(ctx as never);
    // let the fire-and-forget provider wiring settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(existsSync(join(home, ".opencode-mem0"))).toBe(false);
    expect(toasts.length).toBe(1);
    expect(JSON.stringify(toasts[0])).toContain("opencode-mem0 init");
  });
});

describe("update", () => {
  it("clears the opencode plugin cache and leaves home config untouched", async () => {
    const home = freshHome();
    const cacheDir = join(home, ".cache", "opencode");
    mkdirSync(join(cacheDir, "node_modules"), { recursive: true });
    writeFileSync(join(cacheDir, "package.json"), "{}");

    const { runUpdate } = await import("../src/cli.js");
    runUpdate({ npmInstall: false });

    expect(existsSync(cacheDir)).toBe(false);
    expect(existsSync(join(home, ".config"))).toBe(false);
  });

  it("is a no-op when no cache exists", async () => {
    freshHome();
    const { runUpdate } = await import("../src/cli.js");
    expect(() => runUpdate({ npmInstall: false })).not.toThrow();
  });
});
