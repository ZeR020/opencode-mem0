import { type Database } from "../sqlite/sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { connectionManager } from "../sqlite/connection-manager.js";
import { CONFIG } from "../../config.js";

const USER_PROMPTS_DB_NAME = "user-prompts.db";

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => String.raw`\${char}`);
}

export interface UserPrompt {
  id: string;
  sessionId: string;
  messageId: string;
  projectPath: string | null;
  content: string;
  createdAt: number;
  captured: boolean;
  userLearningCaptured: boolean;
  linkedMemoryId: string | null;
}

export class UserPromptManager {
  private readonly db: Database;
  private readonly dbPath: string;
  private readonly stmts: {
    savePrompt: ReturnType<Database["prepare"]>;
    getLastUncaptured: ReturnType<Database["prepare"]>;
    deletePrompt: ReturnType<Database["prepare"]>;
    markCaptured: ReturnType<Database["prepare"]>;
    claimPrompt: ReturnType<Database["prepare"]>;
    resetClaim: ReturnType<Database["prepare"]>;
    countUncaptured: ReturnType<Database["prepare"]>;
    getUncaptured: ReturnType<Database["prepare"]>;
    countUnanalyzed: ReturnType<Database["prepare"]>;
    getForUserLearning: ReturnType<Database["prepare"]>;
    markUserLearningCaptured: ReturnType<Database["prepare"]>;
    getLinkedMemoryIds: ReturnType<Database["prepare"]>;
    deleteOldPrompts: ReturnType<Database["prepare"]>;
    linkMemory: ReturnType<Database["prepare"]>;
    getById: ReturnType<Database["prepare"]>;
    getCaptured: ReturnType<Database["prepare"]>;
    getCapturedByProject: ReturnType<Database["prepare"]>;
    searchPrompts: ReturnType<Database["prepare"]>;
    searchPromptsByProject: ReturnType<Database["prepare"]>;
    getByIds: ReturnType<Database["prepare"]>;
  };

  constructor() {
    this.dbPath = join(CONFIG.storagePath, USER_PROMPTS_DB_NAME);
    this.db = connectionManager.getConnection(this.dbPath);
    this.initDatabase();
    this.stmts = {
      savePrompt: this.db.prepare(`
        INSERT INTO user_prompts (id, session_id, message_id, project_path, content, created_at, captured)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `),
      getLastUncaptured: this.db.prepare(`
        SELECT * FROM user_prompts 
        WHERE session_id = ? AND captured = 0
        ORDER BY created_at DESC 
        LIMIT 1
      `),
      deletePrompt: this.db.prepare("DELETE FROM user_prompts WHERE id = ?"),
      markCaptured: this.db.prepare("UPDATE user_prompts SET captured = 1 WHERE id = ?"),
      claimPrompt: this.db.prepare(
        "UPDATE user_prompts SET captured = 2 WHERE id = ? AND captured = 0"
      ),
      resetClaim: this.db.prepare(
        "UPDATE user_prompts SET captured = 0 WHERE id = ? AND captured = 2"
      ),
      countUncaptured: this.db.prepare(
        "SELECT COUNT(*) as count FROM user_prompts WHERE captured = 0"
      ),
      getUncaptured: this.db.prepare(`
        SELECT * FROM user_prompts 
        WHERE captured = 0 
        ORDER BY created_at ASC 
        LIMIT ?
      `),
      countUnanalyzed: this.db.prepare(
        "SELECT COUNT(*) as count FROM user_prompts WHERE user_learning_captured = 0"
      ),
      getForUserLearning: this.db.prepare(`
        SELECT * FROM user_prompts 
        WHERE user_learning_captured = 0 
        ORDER BY created_at ASC 
        LIMIT ?
      `),
      markUserLearningCaptured: this.db.prepare(
        "UPDATE user_prompts SET user_learning_captured = 1 WHERE id = ?"
      ),
      getLinkedMemoryIds: this.db.prepare(`
        SELECT linked_memory_id FROM user_prompts 
        WHERE created_at < ? AND linked_memory_id IS NOT NULL
      `),
      deleteOldPrompts: this.db.prepare("DELETE FROM user_prompts WHERE created_at < ?"),
      linkMemory: this.db.prepare("UPDATE user_prompts SET linked_memory_id = ? WHERE id = ?"),
      getById: this.db.prepare("SELECT * FROM user_prompts WHERE id = ?"),
      getCaptured: this.db.prepare(
        "SELECT * FROM user_prompts WHERE captured = 1 ORDER BY created_at DESC"
      ),
      getCapturedByProject: this.db.prepare(
        "SELECT * FROM user_prompts WHERE captured = 1 AND project_path = ? ORDER BY created_at DESC"
      ),
      searchPrompts: this.db.prepare(
        String.raw`SELECT * FROM user_prompts WHERE content LIKE ? ESCAPE '\' AND captured = 1 ORDER BY created_at DESC LIMIT ?`
      ),
      searchPromptsByProject: this.db.prepare(
        String.raw`SELECT * FROM user_prompts WHERE content LIKE ? ESCAPE '\' AND captured = 1 AND project_path = ? ORDER BY created_at DESC LIMIT ?`
      ),
      getByIds: this.db.prepare("SELECT * FROM user_prompts WHERE id = ?"),
    };
  }

  close(): void {
    connectionManager.closeConnection(this.dbPath);
  }

  private initDatabase(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        project_path TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        captured BOOLEAN DEFAULT 0,
        user_learning_captured BOOLEAN DEFAULT 0,
        linked_memory_id TEXT
      )
    `);

    this.db.run("UPDATE user_prompts SET captured = 0 WHERE captured = 2");

    const indexes: Array<[string, string]> = [
      ["idx_user_prompts_session", "session_id"],
      ["idx_user_prompts_captured", "captured"],
      ["idx_user_prompts_created", "created_at DESC"],
      ["idx_user_prompts_project", "project_path"],
      ["idx_user_prompts_linked", "linked_memory_id"],
      ["idx_user_prompts_user_learning", "user_learning_captured"],
    ];
    for (const [name, column] of indexes) {
      this.db.run(`CREATE INDEX IF NOT EXISTS ${name} ON user_prompts(${column})`);
    }
  }

  savePrompt(sessionId: string, messageId: string, projectPath: string, content: string): string {
    const id = `prompt_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = Date.now();
    this.stmts.savePrompt.run(id, sessionId, messageId, projectPath, content, now);
    return id;
  }

  getLastUncapturedPrompt(sessionId: string): UserPrompt | null {
    const row = this.stmts.getLastUncaptured.get(sessionId) as any;
    if (!row) return null;
    return this.rowToPrompt(row);
  }

  deletePrompt(promptId: string): void {
    this.stmts.deletePrompt.run(promptId);
  }

  markAsCaptured(promptId: string): void {
    this.stmts.markCaptured.run(promptId);
  }

  claimPrompt(promptId: string): boolean {
    const result = this.stmts.claimPrompt.run(promptId);
    return result.changes > 0;
  }

  resetPromptClaim(promptId: string): void {
    this.stmts.resetClaim.run(promptId);
  }

  countUncapturedPrompts(): number {
    const row = this.stmts.countUncaptured.get() as any;
    return row?.count || 0;
  }

  getUncapturedPrompts(limit: number): UserPrompt[] {
    const rows = this.stmts.getUncaptured.all(limit) as any[];
    return rows.map((row) => this.rowToPrompt(row));
  }

  markMultipleAsCaptured(promptIds: string[]): void {
    this.markMultiple(promptIds, "captured", 1);
  }

  countUnanalyzedForUserLearning(): number {
    const row = this.stmts.countUnanalyzed.get() as any;
    return row?.count || 0;
  }

  getPromptsForUserLearning(limit: number): UserPrompt[] {
    const rows = this.stmts.getForUserLearning.all(limit) as any[];
    return rows.map((row) => this.rowToPrompt(row));
  }

  markAsUserLearningCaptured(promptId: string): void {
    this.stmts.markUserLearningCaptured.run(promptId);
  }

  markMultipleAsUserLearningCaptured(promptIds: string[]): void {
    this.markMultiple(promptIds, "user_learning_captured", 1);
  }

  deleteOldPrompts(cutoffTime: number): { deleted: number; linkedMemoryIds: string[] } {
    const linkedRows = this.stmts.getLinkedMemoryIds.all(cutoffTime) as any[];
    const linkedMemoryIds = linkedRows.map((row) => row.linked_memory_id).filter(Boolean);
    const result = this.stmts.deleteOldPrompts.run(cutoffTime);
    return {
      deleted: result.changes,
      linkedMemoryIds,
    };
  }

  linkMemoryToPrompt(promptId: string, memoryId: string): void {
    this.stmts.linkMemory.run(memoryId, promptId);
  }

  getPromptById(promptId: string): UserPrompt | null {
    const row = this.stmts.getById.get(promptId) as any;
    if (!row) return null;
    return this.rowToPrompt(row);
  }

  getCapturedPrompts(projectPath?: string): UserPrompt[] {
    if (projectPath) {
      const rows = this.stmts.getCapturedByProject.all(projectPath) as any[];
      return rows.map((row) => this.rowToPrompt(row));
    }
    const rows = this.stmts.getCaptured.all() as any[];
    return rows.map((row) => this.rowToPrompt(row));
  }

  searchPrompts(query: string, projectPath?: string, limit: number = 20): UserPrompt[] {
    const likePattern = `%${escapeLikePattern(query)}%`;
    if (projectPath) {
      const rows = this.stmts.searchPromptsByProject.all(likePattern, projectPath, limit) as any[];
      return rows.map((row) => this.rowToPrompt(row));
    }
    const rows = this.stmts.searchPrompts.all(likePattern, limit) as any[];
    return rows.map((row) => this.rowToPrompt(row));
  }

  getPromptsByIds(ids: string[]): UserPrompt[] {
    if (ids.length === 0) return [];
    if (ids.length === 1) {
      const row = this.stmts.getByIds.get(ids[0]) as any;
      return row ? [this.rowToPrompt(row)] : [];
    }
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(`SELECT * FROM user_prompts WHERE id IN (${placeholders})`);
    const rows = stmt.all(...ids) as any[];
    return rows.map((row) => this.rowToPrompt(row));
  }

  private markMultiple(ids: string[], field: string, value: number): void {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      this.db.prepare(`UPDATE user_prompts SET ${field} = ? WHERE id = ?`).run(value, ids[0]);
      return;
    }
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(`UPDATE user_prompts SET ${field} = ${value} WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  private rowToPrompt(row: any): UserPrompt {
    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      projectPath: row.project_path,
      content: row.content,
      createdAt: row.created_at,
      captured: row.captured === 1,
      userLearningCaptured: row.user_learning_captured === 1,
      linkedMemoryId: row.linked_memory_id,
    };
  }
}

let userPromptManagerInstance: UserPromptManager | null = null;
let userPromptManagerStoragePath: string | null = null;

export function getUserPromptManager(): UserPromptManager {
  if (!userPromptManagerInstance || userPromptManagerStoragePath !== CONFIG.storagePath) {
    userPromptManagerInstance?.close();
    userPromptManagerInstance = new UserPromptManager();
    userPromptManagerStoragePath = CONFIG.storagePath;
  }
  return userPromptManagerInstance;
}

export const userPromptManager = new Proxy({} as UserPromptManager, {
  get(_target, prop, receiver) {
    const manager = getUserPromptManager();
    const value = Reflect.get(manager, prop, receiver);
    return typeof value === "function" ? value.bind(manager) : value;
  },
});
