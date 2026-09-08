import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ensureProviderState,
  markPluginDisposed,
  setProviderStateInit,
} from "../src/services/ai/opencode-provider.js";

const logCalls: Array<{ message: string }> = [];
vi.mock("../src/services/logger.js", () => ({
  log: (message: string) => {
    logCalls.push({ message });
  },
}));

vi.mock("ai", () => ({
  generateText: vi.fn(() => Promise.resolve({ output: {} })),
  Output: { object: ({ schema }: { schema: unknown }) => ({ schema }) },
}));

describe("ensureProviderState is bounded when host init hangs (review finding C1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logCalls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    setProviderStateInit(Promise.resolve());
    markPluginDisposed(false);
  });

  it("settles after the timeout when provider init never resolves", async () => {
    setProviderStateInit(new Promise(() => {}));

    let settled = false;
    const p = ensureProviderState().then(() => {
      settled = true;
    });

    // Before the timeout it is still pending…
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);

    // …and after the 10s bound it completes instead of wedging forever.
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(settled).toBe(true);
    expect(logCalls.some((c) => c.message.includes("proceeding without it"))).toBe(true);
  });

  it("completes immediately when provider init already settled", async () => {
    setProviderStateInit(Promise.resolve());
    await expect(ensureProviderState()).resolves.toBeUndefined();
    expect(logCalls.some((c) => c.message.includes("proceeding without it"))).toBe(false);
  });
});
