import { type Database } from "../../sqlite/sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { connectionManager } from "../../sqlite/connection-manager.js";
import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";
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
  private readonly db: DatabaseType;
  private readonly dbPath: string;
  private readonly sessionRetentionMs: number;
  private readonly getSessionStmt: any;
  private readonly getMessagesStmt: any;
  private readonly getLastSequenceStmt: any;
  private readonly cleanupExpiredStmt: any;
  private readonly deleteSessionStmt: any;
  private readonly getMessagesByRoleStmt: any;
  private readonly addMessageStmt: any;
  private readonly getNextSeqStmt: any;
  private readonly clearMessagesStmt: any;
  private readonly updateConversationIdStmt: any;
  private readonly updateMetadataStmt: any;
  private readonly updateBothStmt: any;

  constructor(opts?: { dbPath?: string }) {
    this.dbPath = opts?.dbPath ?? join(CONFIG.storagePath, AI_SESSIONS_DB_NAME);
    const dir = dirname(this.dbPath);
    if (this.dbPath !== ":memory:" && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = connectionManager.getConnection(this.dbPath);
    this.sessionRetentionMs = CONFIG.aiSessionRetentionDays * 24 * 60 * 60 * 1000;
    this.initDatabase();
    this.getSessionStmt = this.db.prepare(`
      SELECT * FROM ai_sessions WHERE session_id = ? AND provider = ? AND expires_at > ?
    `);
    this.getMessagesStmt = this.db.prepare(
      "SELECT * FROM ai_messages WHERE ai_session_id = ? ORDER BY sequence ASC"
    );
    this.getLastSequenceStmt = this.db.prepare(
      "SELECT MAX(sequence) as max_seq FROM ai_messages WHERE ai_session_id = ?"
    );
    this.cleanupExpiredStmt = this.db.prepare("DELETE FROM ai_sessions WHERE expires_at < ?");
    this.deleteSessionStmt = this.db.prepare(
      "DELETE FROM ai_sessions WHERE session_id = ? AND provider = ?"
    );
    this.getMessagesByRoleStmt = this.db.prepare(
      "SELECT * FROM ai_messages WHERE ai_session_id = ? AND role = ? ORDER BY sequence ASC"
    );
    this.addMessageStmt = this.db.prepare(`
      INSERT INTO ai_messages (
        ai_session_id, sequence, role, content, tool_calls, tool_call_id, content_blocks, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getNextSeqStmt = this.db.prepare(
      "SELECT COALESCE(MAX(sequence), -1) + 1 as next_seq FROM ai_messages WHERE ai_session_id = ?"
    );
    this.clearMessagesStmt = this.db.prepare("DELETE FROM ai_messages WHERE ai_session_id = ?");
    this.updateConversationIdStmt = this.db.prepare(
      "UPDATE ai_sessions SET conversation_id = ?, updated_at = ? WHERE session_id = ? AND provider = ?"
    );
    this.updateMetadataStmt = this.db.prepare(
      "UPDATE ai_sessions SET metadata = ?, updated_at = ? WHERE session_id = ? AND provider = ?"
    );
    this.updateBothStmt = this.db.prepare(
      "UPDATE ai_sessions SET conversation_id = ?, metadata = ?, updated_at = ? WHERE session_id = ? AND provider = ?"
    );
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
    this.ensureUniqueMessageSequences();
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ai_messages_role ON ai_messages(ai_session_id, role)"
    );
  }

  private ensureUniqueMessageSequences(): void {
    this.db.run("BEGIN");
    try {
      this.db.run(`
        DELETE FROM ai_messages
        WHERE id IN (
          SELECT newer.id
          FROM ai_messages newer
          JOIN ai_messages older
            ON newer.ai_session_id = older.ai_session_id
           AND newer.sequence = older.sequence
           AND newer.id > older.id
        )
      `);
      this.db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_session_sequence_unique ON ai_messages(ai_session_id, sequence)"
      );
      this.db.run("COMMIT");
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("AI session schema rollback failed", { error: String(rollbackErr), level: "error" });
      }
      throw error;
    }
  }

  getSession(sessionId: string, provider: AIProviderType): AISession | null {
    const row = this.getSessionStmt.get(sessionId, provider, Date.now()) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  createSession(params: SessionCreateParams): AISession {
    const id = `sess_${Date.now()}_${randomBytes(4).toString("hex")}`;
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

    // skipcq: JS-0339 — session is guaranteed after insert above
    return this.getSession(params.sessionId, params.provider)!;
  }

  updateSession(sessionId: string, provider: AIProviderType, updates: SessionUpdateParams): void {
    const now = Date.now();
    if (updates.conversationId !== undefined && updates.metadata !== undefined) {
      this.updateBothStmt.run(
        updates.conversationId,
        JSON.stringify(updates.metadata),
        now,
        sessionId,
        provider
      );
    } else if (updates.conversationId !== undefined) {
      this.updateConversationIdStmt.run(updates.conversationId, now, sessionId, provider);
    } else if (updates.metadata !== undefined) {
      this.updateMetadataStmt.run(JSON.stringify(updates.metadata), now, sessionId, provider);
    }
  }

  cleanupExpiredSessions(): number {
    const result = this.cleanupExpiredStmt.run(Date.now());
    return result.changes;
  }

  deleteSession(sessionId: string, provider: AIProviderType): void {
    this.deleteSessionStmt.run(sessionId, provider);
  }

  addMessage(message: Omit<AIMessage, "id" | "createdAt">): void {
    this.addMessageStmt.run(
      message.aiSessionId,
      message.sequence,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId || null,
      message.contentBlocks ? JSON.stringify(message.contentBlocks) : null,
      Date.now()
    );
  }

  getMessages(aiSessionId: string): AIMessage[] {
    const rows = this.getMessagesStmt.all(aiSessionId) as any[];
    return rows.map((row) => this.rowToMessage(row));
  }

  getLastSequence(aiSessionId: string): number {
    // skipcq: JS-0323 — SQLite raw row, strict typing would require schema duplication
    const row = this.getLastSequenceStmt.get(aiSessionId) as any;
    return row?.max_seq ?? -1;
  }

  // skipcq: JS-R1005 — Transaction logic is intentionally sequential for atomicity
  addMessageAtomic(message: Omit<AIMessage, "id" | "sequence" | "createdAt">): number {
    this.db.run("BEGIN IMMEDIATE");
    try {
      const nextSeq = this.getNextSeqStmt.get(message.aiSessionId) as { next_seq: number };
      const seq = nextSeq.next_seq;

      this.addMessageStmt.run(
        message.aiSessionId,
        seq,
        message.role,
        message.content,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId || null,
        message.contentBlocks ? JSON.stringify(message.contentBlocks) : null,
        Date.now()
      );

      this.db.run("COMMIT");
      return seq;
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch (rollbackErr) {
        log("AI message add rollback failed", { error: String(rollbackErr), level: "error" });
      }
      throw error;
    }
  }

  clearMessages(aiSessionId: string): void {
    this.clearMessagesStmt.run(aiSessionId);
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

  // skipcq: JS-0105 — Private row mapper, static would break class encapsulation pattern
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

// skipcq: JS-0067 — Intentional module-level singleton for connection pooling
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
