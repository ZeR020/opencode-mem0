import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Mutable config so the test controls the storage path ----
const mockConfig: any = {
  storagePath: "", // set in beforeAll
};

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
}));

const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");

let tmpDir: string;

function promptIds(): string[] {
  const dbPath = join(tmpDir, "user-prompts.db");
  const db = connectionManager.getConnection(dbPath);
  const rows = db.prepare("SELECT id FROM user_prompts ORDER BY id").all() as any[];
  return rows.map((r) => r.id);
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mem0-prompt-retention-"));
  mockConfig.storagePath = tmpDir;
  // Force the lazy manager singleton to construct now so the schema exists
  // before any test inserts rows.
  userPromptManager.countUnanalyzedForUserLearning();
});

beforeEach(() => {
  const dbPath = join(tmpDir, "user-prompts.db");
  if (existsSync(dbPath)) {
    connectionManager.getConnection(dbPath).run("DELETE FROM user_prompts");
  }
});
function insertPrompt(
  id: string,
  createdAt: number,
  userLearningCaptured: 0 | 1,
  content = "prompt content",
  captured: 0 | 1 = 0
): void {
  const dbPath = join(tmpDir, "user-prompts.db");
  const db = connectionManager.getConnection(dbPath);
  db.prepare(
    `INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured, user_learning_captured)
     VALUES (?, 's1', 'm1', '/test', ?, ?, ?, ?)`
  ).run(id, content, createdAt, captured, userLearningCaptured);
}

afterAll(() => {
  connectionManager.closeAll();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("pruneCapturedOlderThan", () => {
  it("deletes only old captured prompts; keeps recent captured and ALL uncaptured regardless of age", () => {
    const now = Date.now();
    insertPrompt("old-captured-1", now - 40 * DAY_MS, 1);
    insertPrompt("old-captured-2", now - 31 * DAY_MS, 1);
    insertPrompt("recent-captured", now - 1 * DAY_MS, 1);
    insertPrompt("old-uncaptured", now - 40 * DAY_MS, 0);
    insertPrompt("recent-uncaptured", now - 1 * DAY_MS, 0);

    const deleted = userPromptManager.pruneCapturedOlderThan(30);

    expect(deleted).toBe(2);
    expect(promptIds()).toEqual(["old-uncaptured", "recent-captured", "recent-uncaptured"]);
  });

  it("returns 0 when nothing is old enough", () => {
    const now = Date.now();
    insertPrompt("recent-captured", now - 5 * DAY_MS, 1);
    insertPrompt("old-uncaptured", now - 40 * DAY_MS, 0);

    expect(userPromptManager.pruneCapturedOlderThan(30)).toBe(0);
    expect(promptIds()).toHaveLength(2);
  });

  it("is idempotent: a second prune deletes nothing new", () => {
    const now = Date.now();
    insertPrompt("old-captured", now - 40 * DAY_MS, 1);

    expect(userPromptManager.pruneCapturedOlderThan(30)).toBe(1);
    expect(userPromptManager.pruneCapturedOlderThan(30)).toBe(0);
    expect(promptIds()).toEqual([]);
  });
});
