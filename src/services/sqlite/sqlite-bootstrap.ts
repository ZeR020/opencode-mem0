import type { Database as BSqliteDatabase, Statement as BSqliteStatement } from "better-sqlite3";
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

let _require: NodeRequire | undefined;
function getRequire(): NodeRequire {
  if (!_require) {
    _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);
  }
  return _require;
}

class BunSqliteDatabase implements Database {
  private db: any;

  constructor(path: string) {
    const bunSqlite = getRequire()("bun:sqlite") as typeof import("bun:sqlite");
    this.db = new bunSqlite.Database(path);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = params.length > 0 ? stmt.run(...params) : stmt.run();
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: unknown[]) => {
        return params.length > 0 ? stmt.get(...params) : stmt.get();
      },
      all: (...params: unknown[]) => {
        return params.length > 0 ? stmt.all(...params) : stmt.all();
      },
    };
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    const result = params.length > 0 ? stmt.run(...params) : stmt.run();
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

class BetterSqlite3Database implements Database {
  private db: BSqliteDatabase;

  constructor(path: string) {
    const BetterSqlite3 = getRequire()("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new BetterSqlite3(path);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = params.length > 0 ? stmt.run(...params) : stmt.run();
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: unknown[]) => {
        return params.length > 0 ? stmt.get(...params) : stmt.get();
      },
      all: (...params: unknown[]) => {
        return params.length > 0 ? stmt.all(...params) : stmt.all();
      },
    };
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    const result = params.length > 0 ? stmt.run(...params) : stmt.run();
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

export function getDatabase(): new (path: string) => Database {
  if (!DatabaseImpl) {
    try {
      // Test if bun:sqlite is available
      getRequire()("bun:sqlite");
      DatabaseImpl = BunSqliteDatabase;
    } catch {
      DatabaseImpl = BetterSqlite3Database;
    }
  }
  return DatabaseImpl;
}

// AUDIT_TRIGGER — Round 3 full repo audit
