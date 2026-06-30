import { type Database } from "./sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";
import { connectionManager } from "./connection-manager.js";

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

const WORD_SPLIT_RE = /\s+/;

function approximateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(WORD_SPLIT_RE).length * 1.33);
}

function rowToTranscript(row: any): TranscriptRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    messages: row.messages,
    createdAt: row.created_at,
    tokenCount: row.token_count,
  };
}

const TRANSCRIPT_FIELDS = "id, session_id, project_path, messages, created_at, token_count";

export class TranscriptManager {
  private db: Database | null = null;
  private dbPath: string | null = null;

  private getDb(): Database {
    const dbPath = getTranscriptDbPath();
    if (this.db && this.dbPath === dbPath) return this.db;

    if (this.dbPath && this.dbPath !== dbPath) {
      connectionManager.closeConnection(this.dbPath);
      this.db = null;
    }

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = connectionManager.getConnection(dbPath);
    this.dbPath = dbPath;
    this.initSchema(this.db);
    return this.db;
  }

  close(): void {
    if (this.dbPath) {
      connectionManager.closeConnection(this.dbPath);
      this.dbPath = null;
      this.db = null;
    }
  }

  private initSchema(db: Database): void {
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

    db.run("CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts(created_at DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_transcripts_project ON transcripts(project_path)");

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
        messages,
        content='transcripts'
      )
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_insert 
      AFTER INSERT ON transcripts BEGIN
        INSERT INTO transcripts_fts(rowid, messages) 
        VALUES (new.rowid, new.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_delete 
      AFTER DELETE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) 
        VALUES ('delete', old.rowid, old.messages);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS transcripts_fts_update 
      AFTER UPDATE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, messages) 
        VALUES ('delete', old.rowid, old.messages);
        INSERT INTO transcripts_fts(rowid, messages) 
        VALUES (new.rowid, new.messages);
      END
    `);
  }

  saveTranscript(sessionId: string, projectPath: string, messages: unknown[]): { id: string } {
    if (!CONFIG.transcriptStorage.enabled) return { id: "" };

    try {
      const db = this.getDb();
      const id = `tr_${Date.now()}_${randomBytes(5).toString("hex")}`;
      const messagesJson = JSON.stringify(messages);
      const createdAt = Date.now();
      const tokenCount = approximateTokenCount(messagesJson);

      db.prepare(
        `
        INSERT INTO transcripts (id, session_id, project_path, messages, created_at, token_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(id, sessionId, projectPath, messagesJson, createdAt, tokenCount);

      log("Transcript saved", { sessionId, transcriptId: id, tokenCount });
      return { id };
    } catch (error) {
      log("saveTranscript: error", { sessionId, error: String(error) });
      return { id: "" };
    }
  }

  getRecentTranscripts(limit: number = 10): TranscriptRecord[] {
    if (!CONFIG.transcriptStorage.enabled) return [];

    try {
      const db = this.getDb();
      const rows = db
        .prepare(
          `
        SELECT ${TRANSCRIPT_FIELDS}
        FROM transcripts ORDER BY created_at DESC LIMIT ?
      `
        )
        .all(limit) as any[];

      return rows.map(rowToTranscript);
    } catch (error) {
      log("getRecentTranscripts: error", { error: String(error) });
      return [];
    }
  }

  searchTranscripts(
    query: string,
    limit: number = 20,
    offset: number = 0
  ): { transcripts: TranscriptRecord[]; total: number } {
    if (!CONFIG.transcriptStorage.enabled) return { transcripts: [], total: 0 };

    try {
      const db = this.getDb();

      const totalRow = db
        .prepare(
          `
        SELECT count(*) as total FROM transcripts_fts WHERE transcripts_fts MATCH ?
      `
        )
        .get(query) as { total: number } | null;

      const rows = db
        .prepare(
          `
        SELECT t.${TRANSCRIPT_FIELDS}
        FROM transcripts t
        JOIN transcripts_fts fts ON fts.rowid = t.rowid
        WHERE transcripts_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `
        )
        .all(query, limit, offset) as any[];

      return {
        transcripts: rows.map(rowToTranscript),
        total: totalRow?.total ?? 0,
      };
    } catch (error) {
      log("searchTranscripts: error", { query, error: String(error) });
      return { transcripts: [], total: 0 };
    }
  }

  deleteOldTranscripts(cutoffTime: number): number {
    if (!CONFIG.transcriptStorage.enabled) return 0;

    try {
      const db = this.getDb();
      const result = db.prepare("DELETE FROM transcripts WHERE created_at < ?").run(cutoffTime);
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
    if (!CONFIG.transcriptStorage.enabled) return 0;

    try {
      const db = this.getDb();
      const row = db.prepare("SELECT COUNT(*) as count FROM transcripts").get() as any;
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
