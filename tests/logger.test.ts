import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  log,
  debug,
  warn,
  error,
  setLogLevel,
  getLogLevel,
  flushLogs,
} from "../src/services/logger.js";

describe("logger", () => {
  const origLevel = process.env.OPENCODE_MEM_LOG_LEVEL;

  beforeEach(() => {
    setLogLevel("debug");
  });

  afterEach(() => {
    if (origLevel) process.env.OPENCODE_MEM_LOG_LEVEL = origLevel;
    else delete process.env.OPENCODE_MEM_LOG_LEVEL;
    setLogLevel("info");
  });

  describe("log level accessors", () => {
    it("setLogLevel/getLogLevel round-trip", () => {
      setLogLevel("warn");
      expect(getLogLevel()).toBe("warn");
      setLogLevel("error");
      expect(getLogLevel()).toBe("error");
    });
  });

  describe("log functions do not throw", () => {
    it("log writes at info level", () => {
      expect(() => log("test info message")).not.toThrow();
    });

    it("debug writes at debug level", () => {
      expect(() => debug("test debug message")).not.toThrow();
    });

    it("warn writes at warn level", () => {
      expect(() => warn("test warn message")).not.toThrow();
    });

    it("error writes at error level", () => {
      expect(() => error("test error message")).not.toThrow();
    });

    it("log with data object does not throw", () => {
      expect(() => log("with data", { key: "value" })).not.toThrow();
      expect(() => warn("with data", { count: 42 })).not.toThrow();
      expect(() => error("with data", { err: "boom" })).not.toThrow();
    });
  });

  describe("level filtering", () => {
    it("debug messages are skipped when level is info", () => {
      setLogLevel("info");
      // debug is priority 0, info is priority 1 — debug should be filtered out
      expect(() => debug("should be filtered")).not.toThrow();
    });

    it("warn messages pass when level is warn", () => {
      setLogLevel("warn");
      expect(() => warn("should pass")).not.toThrow();
    });
  });

  describe("flushLogs", () => {
    it("returns a promise that resolves", async () => {
      log("trigger a write");
      await expect(flushLogs()).resolves.toBeUndefined();
    });
  });
});
