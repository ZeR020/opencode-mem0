import { afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = mkdtempSync(join(tmpdir(), "opencode-mem0-vitest-home-"));
mkdirSync(join(testHome, ".opencode-mem0"), { recursive: true });

process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

afterAll(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  rmSync(testHome, { recursive: true, force: true });
});
