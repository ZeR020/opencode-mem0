import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddingService } from "../src/services/embedding.js";
import { memoryClient } from "../src/services/client.js";

describe("API Status endpoint contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildStatusResponse() {
    const clientStatus = memoryClient.getStatus();
    const available = embeddingService.embeddingAvailable;
    return {
      success: true,
      data: {
        ready: clientStatus.ready,
        dbConnected: clientStatus.dbConnected,
        modelLoaded: clientStatus.modelLoaded,
        embeddingAvailable: available,
        mode: available ? "full" : "text-only",
      },
    };
  }

  it("returns mode='full' when embeddings are available", () => {
    vi.spyOn(memoryClient, "getStatus").mockReturnValue({
      ready: true,
      dbConnected: true,
      modelLoaded: true,
    });
    (embeddingService as any).embeddingAvailable = true;

    const result = buildStatusResponse();

    expect(result.success).toBe(true);
    expect(result.data.mode).toBe("full");
    expect(result.data.ready).toBe(true);
    expect(result.data.dbConnected).toBe(true);
    expect(result.data.modelLoaded).toBe(true);
    expect(result.data.embeddingAvailable).toBe(true);
  });

  it("returns mode='text-only' when embeddings unavailable", () => {
    vi.spyOn(memoryClient, "getStatus").mockReturnValue({
      ready: true,
      dbConnected: true,
      modelLoaded: true,
    });
    (embeddingService as any).embeddingAvailable = false;

    const result = buildStatusResponse();

    expect(result.success).toBe(true);
    expect(result.data.mode).toBe("text-only");
    expect(result.data.ready).toBe(true);
    expect(result.data.dbConnected).toBe(true);
    expect(result.data.modelLoaded).toBe(true);
    expect(result.data.embeddingAvailable).toBe(false);
  });
});
