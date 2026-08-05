import { afterEach, describe, expect, it, vi } from "vitest";
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
    const mockFs = (
      globalThis as {
        __mockFs?: { existsSync: (p: unknown) => boolean; readFileSync: () => string };
      }
    ).__mockFs;
    if (!mockFs) return;
    // Provide a non-empty global config so the empty-config guard doesn't fire;
    // buildConfig({autoCaptureEnabled: true}) produces all defaults.
    mockFs.existsSync = (p: unknown) => String(p).includes(".config/opencode/opencode-mem0");
    mockFs.readFileSync = () => JSON.stringify({ autoCaptureEnabled: true });
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

  it("resolves promptTrackingEnabled and profileLearningEnabled from config", () => {
    (globalThis as any).__mockFs.existsSync = (p: unknown) =>
      String(p).includes(".config/opencode/opencode-mem0");
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({ promptTrackingEnabled: false, profileLearningEnabled: false });
    initConfig("/some/project");
    expect(CONFIG.promptTrackingEnabled).toBe(false);
    expect(CONFIG.profileLearningEnabled).toBe(false);
  });

  it("resolves promptRetentionDays with default 30, false keeps forever, and 90 from file config", () => {
    (globalThis as any).__mockFs.existsSync = (p: unknown) =>
      String(p).includes(".config/opencode/opencode-mem0");

    (globalThis as any).__mockFs.readFileSync = () => JSON.stringify({});
    initConfig("/some/project");
    expect(CONFIG.promptRetentionDays).toBe(30);

    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({ promptRetentionDays: false });
    initConfig("/some/project");
    expect(CONFIG.promptRetentionDays).toBe(false);

    (globalThis as any).__mockFs.readFileSync = () => JSON.stringify({ promptRetentionDays: 90 });
    initConfig("/some/project");
    expect(CONFIG.promptRetentionDays).toBe(90);
  });

  it("preserves existing CONFIG when both config sources are empty (transient I/O failure)", () => {
    const mockFs = (
      globalThis as {
        __mockFs?: { existsSync: (p: unknown) => boolean; readFileSync: () => string };
      }
    ).__mockFs;
    if (!mockFs) return;
    // Load a non-default config first
    mockFs.existsSync = (p: unknown) => String(p).includes(".config/opencode/opencode-mem0");
    mockFs.readFileSync = () =>
      JSON.stringify({ embeddingModel: "test-model", embeddingDimensions: 1024 });
    initConfig("/some/project");
    expect(CONFIG.embeddingModel).toBe("test-model");
    expect(CONFIG.embeddingDimensions).toBe(1024);

    // Simulate transient I/O failure — both configs return empty
    mockFs.existsSync = () => false;
    initConfig("/some/project");
    // CONFIG must be preserved, NOT reset to defaults
    expect(CONFIG.embeddingModel).toBe("test-model");
    expect(CONFIG.embeddingDimensions).toBe(1024);
  });
});
