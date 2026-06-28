import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

function expandPath(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

function checkFilePermissions(filePath: string): void {
  if (platform() === "win32") return;

  try {
    const mode = statSync(filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      log(
        `Warning: Secret file ${filePath} has group/other permissions (${(mode & 0o077).toString(8)}). Recommend chmod 600.`,
        { level: "warn" }
      );
    }
  } catch (error) {
    log(`Warning: Could not check file permissions for ${filePath}`, {
      level: "warn",
      error: String(error),
    });
  }
}

export function resolveSecretValue(value: string | undefined): string | undefined {
  if (!value) return undefined;

  if (value.startsWith("file://")) {
    const rawPath = value.slice(7);
    const resolved = rawPath.startsWith("~") ? expandPath(rawPath) : fileURLToPath(new URL(value));
    const filePath = normalize(expandPath(resolved));

    if (filePath.includes("..")) {
      throw new Error(`Secret file path traversal blocked: ${filePath}`);
    }

    if (!existsSync(filePath)) {
      throw new Error(`Secret file not found: ${filePath}`);
    }

    try {
      checkFilePermissions(filePath);
      return readFileSync(filePath, "utf-8").trim();
    } catch (error) {
      throw new Error(`Failed to read secret file ${filePath}: ${error}`);
    }
  }

  if (value.startsWith("env://")) {
    const envVar = value.slice(6);
    const envValue = process.env[envVar];
    if (!envValue) throw new Error(`Environment variable not found: ${envVar}`);
    return envValue;
  }

  return value;
}
