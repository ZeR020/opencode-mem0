import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("config startup side effects", () => {
  let home: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAutoMigrate: string | undefined;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "opencode-mem0-config-home-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAutoMigrate = process.env.OPENCODE_MEM0_AUTO_MIGRATE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.OPENCODE_MEM0_AUTO_MIGRATE;
    vi.resetModules();
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalAutoMigrate === undefined) {
      delete process.env.OPENCODE_MEM0_AUTO_MIGRATE;
    } else {
      process.env.OPENCODE_MEM0_AUTO_MIGRATE = originalAutoMigrate;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("does not create opencode-mem0 files on config import", async () => {
    await import("../src/config.js");

    expect(existsSync(join(home, ".opencode-mem0"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode", "opencode-mem0.jsonc"))).toBe(false);
  });

  it("does not copy upstream opencode-mem data during init", async () => {
    mkdirSync(join(home, ".opencode-mem", "data"), { recursive: true });

    const { initConfig } = await import("../src/config.js");
    initConfig(join(home, "project"));

    expect(existsSync(join(home, ".opencode-mem"))).toBe(true);
    expect(existsSync(join(home, ".opencode-mem0"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode", "opencode-mem0.jsonc"))).toBe(false);
  });

  it("does not migrate even when the old auto-migrate env var is set", async () => {
    process.env.OPENCODE_MEM0_AUTO_MIGRATE = "true";
    mkdirSync(join(home, ".opencode-mem", "data"), { recursive: true });

    const { initConfig } = await import("../src/config.js");
    initConfig(join(home, "project"));

    expect(existsSync(join(home, ".opencode-mem0"))).toBe(false);
  });
});
