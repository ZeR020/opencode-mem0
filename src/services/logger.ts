import {
  appendFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

function getLogFilePath(): string {
  return (
    process.env.OPENCODE_MEM_LOG_FILE || join(homedir(), ".opencode-mem0", "opencode-mem0.log")
  );
}

function getLogDirPath(): string {
  const logFile = getLogFilePath();
  const lastSlash = Math.max(logFile.lastIndexOf("/"), logFile.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : logFile.slice(0, lastSlash);
}

const MAX_LOG_SIZE = 5 * 1024 * 1024;

const GLOBAL_LOGGER_KEY = Symbol.for("opencode-mem0.logger.initialized");

function rotateLog() {
  const logFile = getLogFilePath();
  try {
    if (!existsSync(logFile)) return;
    const stats = statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    const oldLog = logFile + ".old";
    if (existsSync(oldLog)) unlinkSync(oldLog);
    renameSync(logFile, oldLog);
  } catch {}
}

function ensureLoggerInitialized() {
  if ((globalThis as any)[GLOBAL_LOGGER_KEY]) return;
  const logDir = getLogDirPath();
  const logFile = getLogFilePath();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  rotateLog();
  writeFileSync(logFile, `\n--- Session started: ${new Date().toISOString()} ---\n`, {
    flag: "a",
  });
  (globalThis as any)[GLOBAL_LOGGER_KEY] = true;
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, (key, value) => {
      if (/token|secret|password|api[-_]?key|authorization/i.test(key)) {
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

function logWithLevel(level: LogLevel, message: string, data?: unknown) {
  if (!shouldLog(level)) return;
  ensureLoggerInitialized();
  const logFile = getLogFilePath();
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const line = data ? `${prefix} ${message}: ${safeStringify(data)}\n` : `${prefix} ${message}\n`;
  appendFileSync(logFile, line);
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
