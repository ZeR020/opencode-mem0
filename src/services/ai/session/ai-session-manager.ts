import { type Database } from "../../sqlite/sqlite-bootstrap.js";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { connectionManager } from "../../sqlite/connection-manager.js";
import { CONFIG } from "../../../config.js";
import {
  type AIProviderType,
  type AISession,
  type AIMessage,
  type SessionCreateParams,
  type SessionUpdateParams,
} from "./session-types.js";

type DatabaseType = Database;

const AI_SESSIONS_DB_NAME = "ai-sessions.db";

export class AISessionManager {
  private db: DatabaseType;
  private readonly dbPath: string;
  private readonly sessionRetentionMs: number;

  constructor() {
    this.dbPath = join(CONFIG.storagePath, AI_SESSIONS_DB_NAME);
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = connectionManager.getConnection(this.dbPath);
    this.sessionRetentionMs = CONFIG.aiSessionRetentionDays * 24 * 60 * 60 * 1000;
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        conversation_id TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_ai_sessions_session_id ON ai_sessions(session_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_ai_sessions_expires_at ON ai_sessions(expires_at)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_ai_sessions_provider ON ai_sessions(provider)");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ai_session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        content_blocks TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (ai_session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(ai_session_id, sequence)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ai_messages_role ON ai_messages(ai_session_id, role)"
    );
  }

  getSession(sessionId: string, provider: AIProviderType): AISession | null {
    const stmt = this.db.prepare(`
      SELECT * FROM ai_sessions 
      WHERE session_id = ? AND provider = ? AND expires_at > ?
    `);
    const row = stmt.get(sessionId, provider, Date.now()) as any;

    if (!row) return null;

    return this.rowToSession(row);
  }

  createSession(params: SessionCreateParams): AISession {
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const expiresAt = now + this.sessionRetentionMs;

    this.db.run(
      `
      INSERT INTO ai_sessions (
        id, provider, session_id, conversation_id, 
        metadata, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        params.provider,
        params.sessionId,
        params.conversationId || null,
        JSON.stringify(params.metadata || {}),
        now,
        now,
        expiresAt,
      ]
    );

    return this.getSession(params.sessionId, params.provider)!;
  }

  updateSession(sessionId: string, provider: AIProviderType, updates: SessionUpdateParams): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.conversationId !== undefined) {
      fields.push("conversation_id = ?");
      values.push(updates.conversationId);
    }

    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    fields.push("updated_at = ?");
    values.push(Date.now());

    values.push(sessionId);
    values.push(provider);

    this.db.run(
      `
      UPDATE ai_sessions 
      SET ${fields.join(", ")}
      WHERE session_id = ? AND provider = ?
    `,
      values
    );
  }

  cleanupExpiredSessions(): number {
    const result = this.db.run(`DELETE FROM ai_sessions WHERE expires_at < ?`, [Date.now()]);
    return result.changes;
  }

  deleteSession(sessionId: string, provider: AIProviderType): void {
    this.db.run(`DELETE FROM ai_sessions WHERE session_id = ? AND provider = ?`, [
      sessionId,
      provider,
    ]);
  }

  addMessage(message: Omit<AIMessage, "id" | "createdAt">): void {
    this.db.run(
      `INSERT INTO ai_messages (
        ai_session_id, sequence, role, content, 
        tool_calls, tool_call_id, content_blocks, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.aiSessionId,
        message.sequence,
        message.role,
        message.content,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId || null,
        message.contentBlocks ? JSON.stringify(message.contentBlocks) : null,
        Date.now(),
      ]
    );
  }

  getMessages(aiSessionId: string): AIMessage[] {
    const stmt = this.db.prepare(
      "SELECT * FROM ai_messages WHERE ai_session_id = ? ORDER BY sequence ASC"
    );
    const rows = stmt.all(aiSessionId) as any[];

    return rows.map(this.rowToMessage);
  }

  getLastSequence(aiSessionId: string): number {
    const stmt = this.db.prepare(
      "SELECT MAX(sequence) as max_seq FROM ai_messages WHERE ai_session_id = ?"
    );
    const row = stmt.get(aiSessionId) as any;

    return row?.max_seq ?? -1;
  }

  clearMessages(aiSessionId: string): void {
    this.db.run("DELETE FROM ai_messages WHERE ai_session_id = ?", [aiSessionId]);
  }

  private rowToSession(row: any): AISession {
    return {
      id: row.id,
      provider: row.provider as AIProviderType,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  private rowToMessage(row: any): AIMessage {
    return {
      id: row.id,
      aiSessionId: row.ai_session_id,
      sequence: row.sequence,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolCallId: row.tool_call_id,
      contentBlocks: row.content_blocks ? JSON.parse(row.content_blocks) : undefined,
      createdAt: row.created_at,
    };
  }
}

let _aiSessionManager: AISessionManager | null = null;

export function getAISessionManager(): AISessionManager {
  if (!_aiSessionManager) {
    _aiSessionManager = new AISessionManager();
  }
  return _aiSessionManager;
}

// Backward-compatible named export (lazy — no side effects at import time)
export const aiSessionManager = {
  get cleanupExpiredSessions() {
    return getAISessionManager().cleanupExpiredSessions.bind(getAISessionManager());
  },
  get createSession() {
    return getAISessionManager().createSession.bind(getAISessionManager());
  },
  get getSession() {
    return getAISessionManager().getSession.bind(getAISessionManager());
  },
  get getMessages() {
    return getAISessionManager().getMessages.bind(getAISessionManager());
  },
  get addMessage() {
    return getAISessionManager().addMessage.bind(getAISessionManager());
  },
  get updateSession() {
    return getAISessionManager().updateSession.bind(getAISessionManager());
  },
  get getLastSequence() {
    return getAISessionManager().getLastSequence.bind(getAISessionManager());
  },
} as unknown as AISessionManager;
// AUDIT_MARKER
