import { log } from "../logger.js";
import type { Database } from "./sqlite-bootstrap.js";

export const CURRENT_SCHEMA_VERSION = 1;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    "ALTER TABLE memories ADD COLUMN is_deprecated INTEGER DEFAULT 0",
    "ALTER TABLE memories ADD COLUMN is_pinned INTEGER DEFAULT 0",
    "ALTER TABLE memories ADD COLUMN store_type TEXT DEFAULT 'stm'",
    "ALTER TABLE memories ADD COLUMN decay_rate REAL DEFAULT 0.05",
  ],
};

function tableExists(db: Database, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName) as any;
    return Boolean(row);
  } catch {
    return false;
  }
}

export function getCurrentVersion(db: Database): number {
  try {
    const row = db
      .prepare("SELECT COALESCE(MAX(version), 0) as version FROM schema_version")
      .get() as any;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

export function runMigrations(
  db: Database,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
  migrations: Record<number, string[]> = MIGRATIONS
): void {
  const existingVersion = getCurrentVersion(db);
  if (existingVersion >= targetVersion) return;

  const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
  const columnNames = new Set(columns.map((c) => c.name));

  for (let v = existingVersion + 1; v <= targetVersion; v++) {
    const versionMigrations = migrations[v];
    if (!versionMigrations) continue;

    db.run("BEGIN IMMEDIATE");
    try {
      for (const sql of versionMigrations) {
        // Skip ALTER TABLE on non-existent tables
        const alterMatch = sql.match(/ALTER TABLE (\w+)/i);
        if (alterMatch?.[1]) {
          if (!tableExists(db, alterMatch[1])) continue;
        }

        // Skip ADD COLUMN if column already exists
        const addColMatch = sql.match(/ADD COLUMN (\w+)/i);
        if (addColMatch?.[1]) {
          if (columnNames.has(addColMatch[1])) continue;
        }

        db.run(sql);
      }

      db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [v, Date.now()]);
      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        log(`Schema migration v${v} rollback failed`, { error: String(rollbackErr) });
      }
      log(`Schema migration v${v} failed`, { error: String(error) });
      throw error;
    }
  }
}
