import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readOpencodeAuth,
  createOpencodeAIProvider,
  createOAuthFetch,
  setStatePath,
  getStatePath,
  setConnectedProviders,
  isProviderConnected,
} from "../src/services/ai/opencode-provider.js";

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

describe("readOpencodeAuth", () => {
  afterEach(() => {
    (globalThis as any).__mockFs.existsSync = () => false;
    (globalThis as any).__mockFs.readFileSync = () => "{}";
  });

  it("returns OAuth auth when provider has oauth type", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({
        anthropic: { type: "oauth", refresh: "r", access: "a", expires: 9999 },
      });
    const result = readOpencodeAuth("/state", "anthropic");
    expect(result).toEqual({ type: "oauth", refresh: "r", access: "a", expires: 9999 });
  });

  it("returns API auth when provider has api type", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({ openai: { type: "api", key: "sk-test" } });
    const result = readOpencodeAuth("/state", "openai");
    expect(result).toEqual({ type: "api", key: "sk-test" });
  });

  it("throws when auth.json file is missing", () => {
    (globalThis as any).__mockFs.existsSync = () => false;
    expect(() => readOpencodeAuth("/state", "anthropic")).toThrow(/not found/);
  });

  it("throws when provider not in auth.json", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({
        anthropic: { type: "oauth", refresh: "r", access: "a", expires: 9999 },
      });
    expect(() => readOpencodeAuth("/state", "openai")).toThrow(/not found in opencode auth\.json/);
  });

  it("throws when auth.json contains invalid JSON", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () => "not-json";
    expect(() => readOpencodeAuth("/state", "anthropic")).toThrow(/invalid JSON/);
  });
});

describe("createOpencodeAIProvider", () => {
  afterEach(() => {
    (globalThis as any).__mockFs.existsSync = () => false;
    (globalThis as any).__mockFs.readFileSync = () => "{}";
  });

  it("creates Anthropic provider with authToken for OAuth", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({
        anthropic: { type: "oauth", refresh: "r", access: "tok", expires: 9999999999999 },
      });
    const provider = createOpencodeAIProvider(
      "anthropic",
      {
        type: "oauth",
        refresh: "r",
        access: "tok",
        expires: 9999999999999,
      },
      "/mock/state"
    );
    expect(typeof provider).toBe("function");
  });

  it("creates Anthropic provider with apiKey for API auth", () => {
    const provider = createOpencodeAIProvider("anthropic", {
      type: "api",
      key: "sk-ant-test",
    });
    expect(typeof provider).toBe("function");
  });

  it("creates OpenAI provider with apiKey", () => {
    const provider = createOpencodeAIProvider("openai", {
      type: "api",
      key: "sk-test",
    });
    expect(typeof provider).toBe("function");
  });

  it("throws for OpenAI with OAuth auth", () => {
    expect(() =>
      createOpencodeAIProvider("openai", {
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
      })
    ).toThrow(/does not support OAuth/);
  });

  it("throws for unsupported provider name", () => {
    expect(() => createOpencodeAIProvider("gemini", { type: "api", key: "key" })).toThrow(
      /Unsupported opencode provider/
    );
  });

  it("creates Anthropic provider with OAuth using createOAuthFetch", () => {
    (globalThis as any).__mockFs.existsSync = () => true;
    (globalThis as any).__mockFs.readFileSync = () =>
      JSON.stringify({
        anthropic: { type: "oauth", refresh: "r", access: "tok", expires: 9999999999999 },
      });
    const provider = createOpencodeAIProvider(
      "anthropic",
      {
        type: "oauth",
        refresh: "r",
        access: "tok",
        expires: 9999999999999,
      },
      "/mock/state"
    );
    expect(typeof provider).toBe("function");
  });
});

describe("createOAuthFetch", () => {
  it("returns a fetch function", () => {
    const fetchFn = createOAuthFetch("/state", "anthropic");
    expect(typeof fetchFn).toBe("function");
  });
});

describe("state management", () => {
  it("setStatePath and getStatePath work correctly", () => {
    setStatePath("/test/state");
    expect(getStatePath()).toBe("/test/state");
  });

  it("getStatePath returns the last value set by setStatePath", () => {
    setStatePath("/valid/path");
    expect(getStatePath()).toBe("/valid/path");
  });

  it("setConnectedProviders and isProviderConnected work correctly", () => {
    setConnectedProviders(["anthropic", "openai"]);
    expect(isProviderConnected("anthropic")).toBe(true);
    expect(isProviderConnected("openai")).toBe(true);
    expect(isProviderConnected("gemini")).toBe(false);
  });
});
