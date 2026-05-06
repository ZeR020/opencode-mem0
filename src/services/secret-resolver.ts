import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

function checkFilePermissions(filePath: string): void {
  if (platform() === "win32") {
    return;
  }

  try {
    const stats = statSync(filePath);
    const mode = stats.mode & 0o777;

    if ((mode & 0o077) !== 0) {
      console.warn(
        `Warning: Secret file ${filePath} has group/other permissions (${(mode & 0o077).toString(8)}). Recommend chmod 600.`
      );
    }
  } catch (error) {
    console.warn(`Warning: Could not check file permissions for ${filePath}`);
  }
}

export function resolveSecretValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("file://")) {
    const filePath = expandPath(fileURLToPath(new URL(value)));

    if (!existsSync(filePath)) {
      throw new Error(`Secret file not found: ${filePath}`);
    }

    try {
      checkFilePermissions(filePath);

      const content = readFileSync(filePath, "utf-8");
      return content.trim();
    } catch (error) {
      throw new Error(`Failed to read secret file ${filePath}: ${error}`);
    }
  }

  if (value.startsWith("env://")) {
    const envVar = value.slice(6);
    const envValue = process.env[envVar];

    if (!envValue) {
      throw new Error(`Environment variable not found: ${envVar}`);
    }

    return envValue;
  }

  return value;
}
// AUDIT_MARKER
