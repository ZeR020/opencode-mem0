import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConfig, CONFIG } from "../src/config.js";

(globalThis as any).__mockFs = {
  existsSync: () => false,
  readFileSync: () => "{}",
};

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => {
      const m = (globalThis as any).__mockFs;
      return m ? m.existsSync(...args) : false;
    },
    readFileSync: (...args: unknown[]) => {
      const m = (globalThis as any).__mockFs;
      return m ? m.readFileSync(...args) : "{}";
    },
  };
});

describe("project-scoped config resolution", () => {
  afterEach(() => {
    (globalThis as any).__mockFs.existsSync = () => false;
    (globalThis as any).__mockFs.readFileSync = () => "{}";
    // Reset to global-only config
    initConfig("/nonexistent-project");
  });

  it("uses global config when no project config exists", () => {
    (globalThis as any).__mockFs.existsSync = (p: unknown) => {
      const path = String(p);
      return path.includes(".config/opencode/opencode-mem0");
    };
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({ opencodeModel: "global-model" });
    initConfig("/some/project");
    expect(CONFIG.opencodeModel).toBe("global-model");
  });

  it("project config overrides global config", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = (p: unknown) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem0")) {
        return JSON.stringify({
          opencodeProvider: "openai",
          opencodeModel: "project-model",
        }) as any;
      }
      return JSON.stringify({
        opencodeProvider: "anthropic",
        opencodeModel: "global-model",
      }) as any;
    };
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("openai");
    expect(CONFIG.opencodeModel).toBe("project-model");
  });

  it("shallow merge: project adds fields, global fields preserved when not overridden", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = (p: unknown) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem0")) {
        return JSON.stringify({ opencodeProvider: "anthropic" }) as any;
      }
      return JSON.stringify({ opencodeModel: "claude-haiku", autoCaptureEnabled: false }) as any;
    };
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("anthropic");
    expect(CONFIG.opencodeModel).toBe("claude-haiku");
    expect(CONFIG.autoCaptureEnabled).toBe(false);
  });

  it("falls back to defaults when neither global nor project config exists", () => {
    (globalThis as any).__mockFs.existsSync = () => false;
    initConfig("/no/config/project");
    expect(CONFIG.autoCaptureEnabled).toBe(true); // default value
    expect(CONFIG.opencodeProvider).toBeUndefined();
  });
});

// AUDIT_TRIGGER — Round 3 full repo audit
