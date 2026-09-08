import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { TranscriptManager } from "../src/services/sqlite/transcript-manager.js";

describe("transcript FTS query sanitization", () => {
  let tmp: string;
  let originalPath: string;
  let originalEnabled: boolean;
  let mgr: TranscriptManager;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "opencode-mem0-fts-"));
    originalPath = CONFIG.storagePath;
    originalEnabled = CONFIG.transcriptStorage.enabled;
    CONFIG.storagePath = tmp;
    CONFIG.transcriptStorage.enabled = true;
    mgr = new TranscriptManager();
    mgr.saveTranscript("sess-1", "/p", [{ role: "user", content: "unclosed quote about react" }]);
  });

  afterEach(() => {
    mgr.close();
    CONFIG.storagePath = originalPath;
    CONFIG.transcriptStorage.enabled = originalEnabled;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does not throw on FTS operator syntax and still matches tokens", () => {
    expect(() => mgr.searchTranscripts(`"unclosed quote`)).not.toThrow();
    const quoted = mgr.searchTranscripts(`"unclosed quote`);
    expect(quoted.transcripts.length).toBeGreaterThan(0);

    expect(() => mgr.searchTranscripts(`" ( ay "*`)).not.toThrow();
    const junk = mgr.searchTranscripts(`" ( ay "*`);
    expect(junk.transcripts).toEqual([]);
    expect(junk.total).toBe(0);
  });

  it("matches punctuated terms that previously caused silent empty results", () => {
    mgr.saveTranscript("sess-2", "/p", [
      { role: "user", content: "fixed the don't panic bug in react.js via email@example.com" },
    ]);

    // Punctuation FTS5 rejects in barewords — quoted phrases must match.
    for (const q of ["don't", "react.js", "email@example.com", "panic bug"]) {
      const res = mgr.searchTranscripts(q);
      expect(res.transcripts.some((t) => t.sessionId === "sess-2")).toBe(true);
    }
    // Reserved word as bareword was a syntax error — now a valid (empty) phrase query.
    expect(mgr.searchTranscripts("AND").total).toBe(0);
  });

  it("truncates very long queries without producing unbalanced quotes", () => {
    expect(() => mgr.searchTranscripts("word ".repeat(400))).not.toThrow();
    const res = mgr.searchTranscripts("word ".repeat(400));
    expect(res).toBeTruthy();
  });
});
