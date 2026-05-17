import { writeFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

function getLogFilePath(): string | null {
  if (process.env.OPENCODE_MEM_LOG_FILE) {
    return process.env.OPENCODE_MEM_LOG_FILE;
  }
  const defaultPath = join(homedir(), ".opencode-mem0", "opencode-mem0.log");
  // Only use default log path if the directory already exists (plugin was previously set up)
  if (existsSync(dirname(defaultPath))) {
    return defaultPath;
  }
  return null;
}

function getLogDirPath(): string | null {
  const logFile = getLogFilePath();
  return logFile ? dirname(logFile) : null;
}

const MAX_LOG_SIZE = 5 * 1024 * 1024;

const GLOBAL_LOGGER_KEY = Symbol.for("opencode-mem0.logger.initialized");

function rotateLog() {
  const logFile = getLogFilePath();
  if (!logFile) return;
  try {
    if (!existsSync(logFile)) return;
    const stats = statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    const oldLog = `${logFile}.old`;
    if (existsSync(oldLog)) unlinkSync(oldLog);
    renameSync(logFile, oldLog);
  } catch (err) {
    console.error(`[opencode-mem0] Failed to rotate log at ${logFile}: ${err}`);
  }
}

function ensureLoggerInitialized() {
  const logFile = getLogFilePath();
  if (!logFile) return; // Plugin not initialized — no file logging

  const logDir = getLogDirPath();
  if (logDir && !existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  if ((globalThis as any)[GLOBAL_LOGGER_KEY]) {
    if (!existsSync(logFile)) {
      writeFileSync(logFile, `\n--- Session started: ${new Date().toISOString()} ---\n`, {
        flag: "a",
      });
    }
    return;
  }
  rotateLog();
  writeFileSync(logFile, `\n--- Session started: ${new Date().toISOString()} ---\n`, {
    flag: "a",
  });
  (globalThis as any)[GLOBAL_LOGGER_KEY] = true;
}

const SENSITIVE_KEY_REGEX = /token|secret|password|api[-_]?key|authorization/i;

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, (key, value) => {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        return "[REDACTED]";
      }
      return value;
    });
  } catch {
    return '"[Unserializable data]"';
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = (process.env.OPENCODE_MEM_LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: LogLevel) {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

// Ordered async write queue — prevents interleaved log lines from concurrent writes
let writeQueue: Promise<void> = Promise.resolve();

function logWithLevel(level: LogLevel, message: string, data?: unknown) {
  if (!shouldLog(level)) return;
  ensureLoggerInitialized();
  const logFile = getLogFilePath();
  if (!logFile) return; // Skip file logging when plugin hasn't set up its directory

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const line = data ? `${prefix} ${message}: ${safeStringify(data)}\n` : `${prefix} ${message}\n`;
  writeQueue = writeQueue
    .then(() => appendFile(logFile, line))
    .catch((err) => {
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
