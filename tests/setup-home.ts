import { afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushLogs } from "../src/services/logger.js";

async function flushBuiltLogs(): Promise<void> {
  try {
    const builtLogger = await import("../dist/services/logger.js");
    await builtLogger.flushLogs?.();
  } catch {
    // The built package is optional during source-only test runs.
  }
}

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = mkdtempSync(join(tmpdir(), "opencode-mem0-vitest-home-"));
mkdirSync(join(testHome, ".opencode-mem0"), { recursive: true });

process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

afterAll(async () => {
  await flushLogs();
  await flushBuiltLogs();
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  rmSync(testHome, { recursive: true, force: true });
});
