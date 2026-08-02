import { describe, it, expect, vi } from "vitest";
import { compareVersions, checkForUpdate } from "../src/services/update-checker.js";

describe("compareVersions", () => {
  it("detects newer patch/minor/major", () => {
    expect(compareVersions("2.20.1", "2.20.2")).toBeGreaterThan(0);
    expect(compareVersions("2.20.1", "2.21.0")).toBeGreaterThan(0);
    expect(compareVersions("2.20.1", "3.0.0")).toBeGreaterThan(0);
  });

  it("returns 0 for equal and negative for older", () => {
    expect(compareVersions("2.20.1", "2.20.1")).toBe(0);
    expect(compareVersions("2.20.1", "2.20.0")).toBeLessThan(0);
  });

  it("handles missing segments and ignores prerelease suffixes", () => {
    expect(compareVersions("2.20", "2.20.1")).toBeGreaterThan(0);
    // Prereleases are ignored: we only compare against npm's stable 'latest'
    expect(compareVersions("2.20.1-beta", "2.20.1")).toBe(0);
    expect(compareVersions("2.20.1", "2.20.1-rc.1")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  const jsonResponse = (version: string) =>
    ({ ok: true, json: async () => ({ version }) }) as Response;

  it("returns update info when registry has a newer version", async () => {
    const info = await checkForUpdate(vi.fn().mockResolvedValue(jsonResponse("999.0.0")));
    expect(info?.latest).toBe("999.0.0");
    expect(info?.current).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns null when up-to-date or older", async () => {
    expect(await checkForUpdate(vi.fn().mockResolvedValue(jsonResponse("0.0.1")))).toBeNull();
  });

  it("returns null on network failure or bad response", async () => {
    expect(await checkForUpdate(vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await checkForUpdate(vi.fn().mockResolvedValue({ ok: false }))).toBeNull();
    expect(
      await checkForUpdate(vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    ).toBeNull();
  });
});
