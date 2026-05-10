import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CONFIG } from "../src/config.js";
import {
  DeduplicationService,
  deduplicationService,
} from "../src/services/deduplication-service.js";

describe("deduplication-service", () => {
  let originalEnabled: boolean;
  let originalIngestEnabled: boolean;

  beforeEach(() => {
    originalEnabled = (CONFIG as any).deduplicationEnabled;
    originalIngestEnabled = (CONFIG as any).deduplicationIngestEnabled;
  });

  afterEach(() => {
    (CONFIG as any).deduplicationEnabled = originalEnabled;
    (CONFIG as any).deduplicationIngestEnabled = originalIngestEnabled;
  });

  it("getStatus reflects config and running state", () => {
    (CONFIG as any).deduplicationEnabled = true;
    (CONFIG as any).deduplicationSimilarityThreshold = 0.92;
    const status = deduplicationService.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.threshold).toBe(0.92);
    expect(status.isRunning).toBe(false);
  });

  it("throws when detectAndRemoveDuplicates is already running", async () => {
    const service = new DeduplicationService();
    (CONFIG as any).deduplicationEnabled = true;

    // Manually set isRunning to true via reflection
    (service as any).isRunning = true;

    await expect(service.detectAndRemoveDuplicates()).rejects.toThrow(
      "Deduplication already running"
    );
  });

  it("throws when deduplication is disabled", async () => {
    const service = new DeduplicationService();
    (CONFIG as any).deduplicationEnabled = false;

    await expect(service.detectAndRemoveDuplicates()).rejects.toThrow(
      "Deduplication is disabled in config"
    );
  });

  it("checkDuplicateAtIngest returns false when ingest dedup is disabled", async () => {
    (CONFIG as any).deduplicationIngestEnabled = false;

    const result = await deduplicationService.checkDuplicateAtIngest(
      "content",
      "opencode_project_testhash_x",
      new Float32Array(768)
    );
    expect(result).toEqual({ isDuplicate: false });
  });
});
