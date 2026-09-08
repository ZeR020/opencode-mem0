import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmbeddingService } from "../src/services/embedding.js";

const logCalls: Array<{ message: string }> = [];
vi.mock("../src/services/logger.js", () => ({
  log: (message: string) => {
    logCalls.push({ message });
  },
}));

let warmupTimeoutMs = 100;

vi.mock("../src/config.js", () => ({
  get CONFIG() {
    return {
      get warmupTimeoutMs() {
        return warmupTimeoutMs;
      },
      storagePath: "/test",
      embeddingModel: "test-model",
      embeddingApiUrl: undefined,
      embeddingApiKey: undefined,
    };
  },
}));

const hangingPipeline = new Promise(() => {});
vi.mock("@huggingface/transformers", () => ({
  pipeline: () => hangingPipeline,
  env: {},
}));

describe("embed() warmup wait is bounded (review finding Codex-P1 on #62)", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    vi.useFakeTimers();
    logCalls.length = 0;
    warmupTimeoutMs = 100;
    // Fresh instance per test — the singleton caches model/pipeline state.
    service = new EmbeddingService();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with AbortError and stays enabled when warmup never finishes", async () => {
    const warmupWait = service.embed("something").catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1);
    const early = await Promise.race([warmupWait, "pending"]);
    expect(early).toBe("pending");

    await vi.advanceTimersByTimeAsync(warmupTimeoutMs);
    const err = await warmupWait;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
    // Crucially not disabled — the model load is still running and the next
    // call may succeed once it lands.
    expect((service as unknown as { embeddingAvailable: boolean }).embeddingAvailable).toBe(true);
  });

  it("degrade-on-abort: caller's signal interrupts the warmup wait", async () => {
    const controller = new AbortController();
    const embedPromise = service.embed("something", controller.signal).catch((e: unknown) => e);
    controller.abort();
    const err = await embedPromise;
    expect((err as Error).name).toBe("AbortError");
    expect((service as unknown as { embeddingAvailable: boolean }).embeddingAvailable).toBe(true);
  });
});
