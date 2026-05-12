import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecretValue } from "../src/services/secret-resolver.js";
import * as logger from "../src/services/logger.js";

describe("secret-resolver", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.TEST_SECRET_VAR;
  });

  it("returns undefined for undefined input", () => {
    expect(resolveSecretValue()).toBeUndefined();
  });

  it("returns plain string unchanged", () => {
    expect(resolveSecretValue("plain-secret")).toBe("plain-secret");
  });

  it("resolves env:// variable", () => {
    process.env.TEST_SECRET_VAR = "env-value";
    expect(resolveSecretValue("env://TEST_SECRET_VAR")).toBe("env-value");
  });

  it("throws for missing env:// variable", () => {
    expect(() => resolveSecretValue("env://MISSING_SECRET_VAR")).toThrow(
      /Environment variable not found/
    );
  });

  it("throws for missing file:// file", () => {
    expect(() => resolveSecretValue("file:///nonexistent/secret.txt")).toThrow(
      /Secret file not found/
    );
  });

  it("reads and trims secret from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "secret-resolver-"));
    tempDirs.push(dir);
    const filePath = join(dir, "secret.txt");
    writeFileSync(filePath, "  my-secret-value  \n", "utf-8");

    const result = resolveSecretValue(`file://${filePath}`);
    expect(result).toBe("my-secret-value");
  });

  it("warns about loose file permissions on non-Windows", () => {
    if (process.platform === "win32") {
      // eslint-disable-next-line no-console
      console.log("Skipping permission check on Windows");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "secret-resolver-perms-"));
    tempDirs.push(dir);
    const filePath = join(dir, "secret.txt");
    writeFileSync(filePath, "secret", "utf-8");
    chmodSync(filePath, 0o644);

    const logSpy = vi.spyOn(logger, "log").mockImplementation(() => undefined);
    resolveSecretValue(`file://${filePath}`);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Recommend chmod 600"),
      expect.any(Object)
    );
    logSpy.mockRestore();
  });

  it("handles file read errors gracefully", () => {
    if (process.platform === "win32") {
      // eslint-disable-next-line no-console
      console.log("Skipping file read error on Windows");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "secret-resolver-err-"));
    tempDirs.push(dir);
    const filePath = join(dir, "secret.txt");
    writeFileSync(filePath, "secret", "utf-8");
    chmodSync(filePath, 0o000);

    expect(() => resolveSecretValue(`file://${filePath}`)).toThrow(/Failed to read secret file/);
  });
});
