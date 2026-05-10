import { createRequire } from "node:module";

export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Database {
  prepare(sql: string): Statement;
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  exec(sql: string): void;
  close(): void;
}

let DatabaseImpl: new (path: string) => Database;

let _require: ((id: string) => any) | undefined;
function getRequire(): (id: string) => any {
  _require ??= typeof require !== "undefined" ? require : createRequire(import.meta.url);
  return _require;
}

function wrapStatement(stmt: any): Statement {
  return {
    run: (...params: unknown[]) => {
      const result = stmt.run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (...params: unknown[]) => stmt.get(...params),
    all: (...params: unknown[]) => stmt.all(...params),
  };
}

class SqliteDatabase implements Database {
  protected db: any;

  constructor(db: any) {
    this.db = db;
  }

  prepare(sql: string): Statement {
    return wrapStatement(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

class BunSqliteDatabase extends SqliteDatabase {
  constructor(path: string) {
    const bunSqlite = getRequire()("bun:sqlite") as typeof import("bun:sqlite");
    super(new bunSqlite.Database(path));
  }
}

class BetterSqlite3Database extends SqliteDatabase {
  constructor(path: string) {
    const BetterSqlite3 = getRequire()("better-sqlite3") as typeof import("better-sqlite3");
    super(new BetterSqlite3(path));
  }
}

export function getDatabase(): new (path: string) => Database {
  if (!DatabaseImpl) {
    try {
      // Test if bun:sqlite is available
      getRequire()("bun:sqlite");
      DatabaseImpl = BunSqliteDatabase;
    } catch (err: any) {
      const isModuleMissing =
        err.code === "MODULE_NOT_FOUND" || err.message?.includes("Cannot find module");
      if (!isModuleMissing) {
        console.error(`[opencode-mem0] bun:sqlite probe failed unexpectedly: ${err}`);
      }
      DatabaseImpl = BetterSqlite3Database;
    }
  }
  return DatabaseImpl;
}
