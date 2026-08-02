// Config read/write API for LLM extraction settings.
// Reads the live CONFIG for display; writes only the whitelisted LLM-extraction
// keys to the global config file (jsonc, comment-preserving) and hot-applies
// via initConfig(). Secrets are never echoed back — only masked.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import {
  CONFIG,
  CONFIG_FILES,
  OpenCodeMemConfigSchema,
  initConfig,
  setStrictSecretResolution,
} from "../../config.js";
import { resolveSecretValue } from "../secret-resolver.js";
import { log } from "../logger.js";
import type { ApiResponse } from "./shared-types.js";

const CONFIG_KEYS = [
  "memoryProvider",
  "memoryModel",
  "memoryApiUrl",
  "memoryApiKey",
  "memoryTemperature",
  "opencodeProvider",
  "opencodeModel",
  "autoCaptureEnabled",
] as const;

export interface ConfigView {
  memoryProvider: string;
  memoryModel: string | null;
  memoryApiUrl: string | null;
  memoryApiKeyMasked: string;
  memoryTemperature: number | false | null;
  opencodeProvider: string | null;
  opencodeModel: string | null;
  autoCaptureEnabled: boolean;
  configFile: string | null;
  configFormat: "jsonc" | "json" | null;
  projectConfigFile: string | null;
  note?: string;
}

function findConfigFile(): { path: string; format: "jsonc" | "json" } | null {
  for (const [index, path] of CONFIG_FILES.entries()) {
    if (existsSync(path)) return { path, format: index === 0 ? "jsonc" : "json" };
  }
  return null;
}

function readConfigObject(): Record<string, unknown> {
  const file = findConfigFile();
  if (!file) return {};
  try {
    const parsed = parse(readFileSync(file.path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error) {
    log("handleGetConfig: failed to parse config file", { error: String(error) });
    return {};
  }
}

/** Never leak a resolved secret. env:// and file:// references are not secrets themselves. */
function maskSecret(raw: string | undefined): string {
  if (!raw) return "";
  if (raw.startsWith("env://") || raw.startsWith("file://")) return raw;
  if (raw.length > 8) return `\u2022\u2022\u2022\u2022${raw.slice(-4)}`;
  return "\u2022\u2022\u2022\u2022";
}

/** URLs may embed credentials (https://user:pass@host) — hide the userinfo. */
function maskUrlUserinfo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return `${url.protocol}//\u2022\u2022\u2022\u2022@${url.host}${url.pathname}${url.search}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

function findProjectConfigFile(): string | null {
  for (const name of ["opencode-mem0.jsonc", "opencode-mem0.json"]) {
    const candidate = join(process.cwd(), ".opencode", name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildConfigView(): ConfigView {
  const file = findConfigFile();
  const rawKey = file ? (readConfigObject().memoryApiKey as string | undefined) : undefined;
  return {
    memoryProvider: CONFIG.memoryProvider ?? "openai-chat",
    memoryModel: CONFIG.memoryModel ?? null,
    memoryApiUrl: maskUrlUserinfo(CONFIG.memoryApiUrl) ?? null,
    memoryApiKeyMasked: maskSecret(rawKey),
    memoryTemperature: CONFIG.memoryTemperature ?? null,
    opencodeProvider: CONFIG.opencodeProvider ?? null,
    opencodeModel: CONFIG.opencodeModel ?? null,
    autoCaptureEnabled: CONFIG.autoCaptureEnabled ?? true,
    configFile: file?.path ?? null,
    configFormat: file?.format ?? null,
    projectConfigFile: findProjectConfigFile(),
  };
}

export function handleGetConfig(): ApiResponse<ConfigView> {
  try {
    return { success: true, data: buildConfigView() };
  } catch (error) {
    log("handleGetConfig: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetConfig" };
  }
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

export async function handleUpdateConfig(
  partial: Record<string, unknown>
): Promise<ApiResponse<ConfigView>> {
  try {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      return { success: false, error: "Request body must be a JSON object" };
    }

    for (const key of Object.keys(partial)) {
      if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
        return { success: false, error: `unknown key: ${key}` };
      }
    }

    const requestedKeys = CONFIG_KEYS.filter((key) => Object.hasOwn(partial, key));
    if (requestedKeys.length === 0) {
      // Nothing requested: report the current view without touching the filesystem.
      return { success: true, data: { ...buildConfigView(), note: "no changes" } };
    }

    const current = readConfigObject();
    const next: Record<string, unknown> = { ...current };
    for (const key of CONFIG_KEYS) {
      if (!Object.hasOwn(partial, key)) continue;
      if (partial[key] === "") {
        delete next[key];
      } else {
        next[key] = partial[key];
      }
    }

    const validation = OpenCodeMemConfigSchema.safeParse(next);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
        .join("; ");
      return { success: false, error: `Invalid config: ${issues}` };
    }

    const file = findConfigFile();
    const target = file?.path ?? (CONFIG_FILES[0] as string);
    const originalText = file ? readFileSync(file.path, "utf8") : null;
    let text = originalText ?? "{\n}\n";

    for (const key of CONFIG_KEYS) {
      if (!Object.hasOwn(partial, key)) continue;
      const value = partial[key] === "" ? undefined : partial[key];
      const wasPresent = Object.hasOwn(current, key);
      if (value === undefined && !wasPresent) continue;
      text = applyEdits(
        text,
        modify(text, [key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        })
      );
    }

    mkdirSync(dirname(target), { recursive: true });
    atomicWrite(target, text);

    try {
      // Strict so a dangling env:///file:// reference is rejected with feedback
      // instead of silently degrading to a missing key after a dashboard save.
      setStrictSecretResolution(true);
      try {
        initConfig(process.cwd());
      } finally {
        setStrictSecretResolution(false);
      }
    } catch (error) {
      // Roll back the file so the live CONFIG and the on-disk config stay consistent.
      try {
        if (originalText !== null) {
          atomicWrite(target, originalText);
        } else {
          if (existsSync(target)) rmSync(target);
        }
        initConfig(process.cwd());
      } catch (rollbackError) {
        log("handleUpdateConfig: rollback failed", { error: String(rollbackError) });
      }
      log("handleUpdateConfig: apply failed, rolled back", { error: String(error) });
      return {
        success: false,
        error: `Config file written but could not be applied (rolled back): ${String(error)}`,
      };
    }

    // initConfig() skips re-application when both config sources load empty
    // (its transient-I/O guard) — e.g. when this write removed the file's last
    // key, leaving {}. Dashboard saves are explicit intent, so force-apply the
    // requested whitelisted keys onto the live CONFIG (last write wins).
    // Secrets must be applied the same way buildConfig resolves them — a raw
    // env:// or file:// reference assigned here would 401 on the next call.
    for (const key of CONFIG_KEYS) {
      if (!Object.hasOwn(partial, key)) continue;
      if (partial[key] === "") {
        delete (CONFIG as Record<string, unknown>)[key];
      } else if (key === "memoryApiKey") {
        (CONFIG as Record<string, unknown>)[key] = resolveSecretValue(String(partial[key]));
      } else {
        (CONFIG as Record<string, unknown>)[key] = partial[key];
      }
    }

    return { success: true, data: buildConfigView() };
  } catch (error) {
    log("handleUpdateConfig: error", { error: String(error) });
    return { success: false, error: "Internal error in handleUpdateConfig" };
  }
}
