import { getDatabase } from "./sqlite-bootstrap.js";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";
import { connectionManager } from "./connection-manager.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

export interface TranscriptRecord {
  id: string;
  sessionId: string;
  projectPath: string;
  messages: string;
  createdAt: number;
  tokenCount: number;
}

function getTranscriptDbPath(): string {
  return join(CONFIG.storagePath, "transcripts.db");
}

function approximateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

export class TranscriptManager {
  private db: DatabaseType | null = null;

  private getDb(): DatabaseType {
    if (this.db) return this.db;

    const dbPath = getTranscriptDbPath();
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = connectionManager.getConnection(dbPath);
    this.initSchema(this.db);
    return this.db;
  }

  private initSchema(db: DatabaseType): void {
    // Main transcripts table
    db.run(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_transcripts_session 
      ON transcripts(session_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_transcripts_created 
      ON transcripts(created_at DESC)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_transcripts_project 
      ON transcripts(project_path)
    `);

    // FTS5 virtual table for full-text search on messages
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
        messages,
        content='transcripts',
        content_rowid='id'
      )
    `);

    // Triggers to keep FTS index in sync
    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_insert 
      AFTER INSERT ON transcripts BEGIN
        INSERT INTO transcripts_fts(rowid, messages) 
        VALUES (new.id, new.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_delete 
      AFTER DELETE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) 
        VALUES ('delete', old.id, old.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_update 
      AFTER UPDATE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) 
        VALUES ('delete', old.id, old.messages);
        INSERT INTO transcripts_fts(rowid, messages) 
        VALUES (new.id, new.messages);
      END
    `);
  }

  saveTranscript(sessionId: string, projectPath: string, messages: unknown[]): { id: string } {
    if (!CONFIG.transcriptStorage.enabled) {
      return { id: "" };
    }

    try {
      const db = this.getDb();
      const id = `tr_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const messagesJson = JSON.stringify(messages);
      const createdAt = Date.now();
      const tokenCount = approximateTokenCount(messagesJson);

      const stmt = db.prepare(`
        INSERT INTO transcripts (id, session_id, project_path, messages, created_at, token_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, sessionId, projectPath, messagesJson, createdAt, tokenCount);

      log("Transcript saved", { sessionId, transcriptId: id, tokenCount });
      return { id };
    } catch (error) {
      log("saveTranscript: error", { sessionId, error: String(error) });
      return { id: "" };
    }
  }

  getTranscript(sessionId: string): TranscriptRecord | null {
    if (!CONFIG.transcriptStorage.enabled) {
      return null;
    }

    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT id, session_id, project_path, messages, created_at, token_count
        FROM transcripts WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
      `);

      const row = stmt.get(sessionId) as any;
      if (!row) return null;

      return {
        id: row.id,
        sessionId: row.session_id,
        projectPath: row.project_path,
        messages: row.messages,
        createdAt: row.created_at,
        tokenCount: row.token_count,
      };
    } catch (error) {
      log("getTranscript: error", { sessionId, error: String(error) });
      return null;
    }
  }

  getRecentTranscripts(limit: number = 10): TranscriptRecord[] {
    if (!CONFIG.transcriptStorage.enabled) {
      return [];
    }

    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT id, session_id, project_path, messages, created_at, token_count
        FROM transcripts ORDER BY created_at DESC LIMIT ?
      `);

      const rows = stmt.all(limit) as any[];
      return rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        projectPath: row.project_path,
        messages: row.messages,
        createdAt: row.created_at,
        tokenCount: row.token_count,
      }));
    } catch (error) {
      log("getRecentTranscripts: error", { error: String(error) });
      return [];
    }
  }

  searchTranscripts(query: string): TranscriptRecord[] {
    if (!CONFIG.transcriptStorage.enabled) {
      return [];
    }

    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT t.id, t.session_id, t.project_path, t.messages, t.created_at, t.token_count
        FROM transcripts t
        JOIN transcripts_fts fts ON fts.rowid = t.id
        WHERE transcripts_fts MATCH ?
        ORDER BY rank
      `);

      const rows = stmt.all(query) as any[];
      return rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        projectPath: row.project_path,
        messages: row.messages,
        createdAt: row.created_at,
        tokenCount: row.token_count,
      }));
    } catch (error) {
      log("searchTranscripts: error", { query, error: String(error) });
      return [];
    }
  }

  deleteOldTranscripts(cutoffTime: number): number {
    if (!CONFIG.transcriptStorage.enabled) {
      return 0;
    }

    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        DELETE FROM transcripts WHERE created_at < ?
      `);

      const result = stmt.run(cutoffTime);
      const deletedCount = Number(result.changes);

      if (deletedCount > 0) {
        log("Deleted old transcripts", { deletedCount, cutoffTime });
      }

      return deletedCount;
    } catch (error) {
      log("deleteOldTranscripts: error", { cutoffTime, error: String(error) });
      return 0;
    }
  }

  getTranscriptCount(): number {
    if (!CONFIG.transcriptStorage.enabled) {
      return 0;
    }

    try {
      const db = this.getDb();
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM transcripts`);
      const row = stmt.get() as any;
      return row?.count || 0;
    } catch (error) {
      log("getTranscriptCount: error", { error: String(error) });
      return 0;
    }
  }

  getStatus(): {
    enabled: boolean;
    maxAgeDays: number;
    transcriptCount: number;
  } {
    return {
      enabled: CONFIG.transcriptStorage.enabled ?? true,
      maxAgeDays: CONFIG.transcriptStorage.maxAgeDays ?? 30,
      transcriptCount: this.getTranscriptCount(),
    };
  }
}

export const transcriptManager = new TranscriptManager();
