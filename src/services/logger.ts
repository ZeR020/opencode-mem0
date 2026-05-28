import { writeFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

function getLogFilePath(): string | null {
  if (process.env.OPENCODE_MEM_LOG_FILE) return process.env.OPENCODE_MEM_LOG_FILE;
  const defaultPath = join(homedir(), ".opencode-mem0", "opencode-mem0.log");
  return existsSync(dirname(defaultPath)) ? defaultPath : null;
}

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const GLOBAL_LOGGER_KEY = Symbol.for("opencode-mem0.logger.initialized");

function rotateLog() {
  const logFile = getLogFilePath();
  if (!logFile) return;
  try {
    if (!existsSync(logFile)) return;
    if (statSync(logFile).size < MAX_LOG_SIZE) return;

    const oldLog = `${logFile}.old`;
    if (existsSync(oldLog)) unlinkSync(oldLog);
    renameSync(logFile, oldLog);
  } catch (err) {
    console.error(`[opencode-mem0] Failed to rotate log at ${logFile}: ${err}`);
  }
}

const SENSITIVE_KEY_REGEX = /token|secret|password|api[-_]?key|authorization/i;

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, (key, value) =>
      SENSITIVE_KEY_REGEX.test(key) ? "[REDACTED]" : value
    );
  } catch {
    return '"[Unserializable data]"';
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLogLevel: LogLevel = (process.env.OPENCODE_MEM_LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: LogLevel) {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

let writeQueue: Promise<void> = Promise.resolve();

function logWithLevel(level: LogLevel, message: string, data?: unknown) {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLogLevel]) return;

  const logFile = getLogFilePath();
  if (!logFile) return;

  const logDir = dirname(logFile);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const isInitialized = (globalThis as any)[GLOBAL_LOGGER_KEY];
  if (!isInitialized) {
    rotateLog();
    (globalThis as any)[GLOBAL_LOGGER_KEY] = true;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const line = data ? `${prefix} ${message}: ${safeStringify(data)}\n` : `${prefix} ${message}\n`;

  writeQueue = writeQueue
    .then(async () => {
      await mkdir(dirname(logFile), { recursive: true });
      await appendFile(logFile, line);
    })
    .catch((err: unknown) => {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") return;
      console.error(`[opencode-mem0] Log write failed: ${err}`);
    });
}

export function log(message: string, data?: unknown) {
  logWithLevel("info", message, data);
}

export function debug(message: string, data?: unknown) {
  logWithLevel("debug", message, data);
}

export function warn(message: string, data?: unknown) {
  logWithLevel("warn", message, data);
}

export function error(message: string, data?: unknown) {
  logWithLevel("error", message, data);
}

export function flushLogs(): Promise<void> {
  return writeQueue;
}
