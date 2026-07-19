import { createRequire } from "node:module";
import { log } from "../logger.js";

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

/**
 * Minimal shape of the raw underlying driver. Each backend (bun:sqlite,
 * node:sqlite, better-sqlite3) structurally satisfies this; we cast the
 * required module to it rather than importing each driver's types (which are
 * conditionally available — only one loads at runtime).
 */
interface RawDatabase {
  prepare(sql: string): RawStatement;
  exec(sql: string): void;
  close(): void;
}

interface RawStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

type RawDatabaseConstructor = new (path: string) => RawDatabase;

/**
 * Normalize bind params for driver parity. `better-sqlite3` auto-unpacks a
 * single Array argument into positional params; `node:sqlite` and `bun:sqlite`
 * do not. Spread it here so every backend behaves identically and callsites
 * can keep the `db.run(sql, [a, b])` form without per-driver branching.
 */
function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as unknown[];
  }
  return params;
}

let DatabaseImpl: RawDatabaseConstructor & { new (path: string): Database };

type RequireFn = (id: string) => unknown;
let _require: RequireFn | undefined;
function getRequire(): RequireFn {
  _require ??= typeof require !== "undefined" ? require : createRequire(import.meta.url);
  return _require;
}

function wrapStatement(stmt: RawStatement): Statement {
  return {
    run: (...params: unknown[]) => {
      const result = stmt.run(...normalizeParams(params));
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (...params: unknown[]) => stmt.get(...normalizeParams(params)),
    all: (...params: unknown[]) => stmt.all(...normalizeParams(params)),
  };
}

class SqliteDatabase implements Database {
  protected readonly db: RawDatabase;

  constructor(db: RawDatabase) {
    this.db = db;
  }

  prepare(sql: string): Statement {
    return wrapStatement(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...normalizeParams(params));
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
    const mod = getRequire()("bun:sqlite") as { Database: RawDatabaseConstructor };
    super(new mod.Database(path));
  }
}

class NodeSqliteDatabase extends SqliteDatabase {
  constructor(path: string) {
    const mod = getRequire()("node:sqlite") as { DatabaseSync: RawDatabaseConstructor };
    super(new mod.DatabaseSync(path));
  }
}

class BetterSqlite3Database extends SqliteDatabase {
  constructor(path: string) {
    const mod = getRequire()("better-sqlite3") as { default: RawDatabaseConstructor };
    super(new mod.default(path));
  }
}

/**
 * Smoke-test a backend by opening and closing `:memory:`. Importability is not
 * enough: a prebuilt native `.node` can load yet fail at runtime against a
 * different Node ABI (e.g. better-sqlite3 prebuilds vs. a newer Node). A real
 * open/close catches that before the backend is selected.
 */
function probeBackend(impl: RawDatabaseConstructor, label: string): boolean {
  try {
    const probe: RawDatabase = new impl(":memory:");
    probe.close();
    return true;
  } catch (err: unknown) {
    log(`[opencode-mem0] ${label} unavailable, falling back: ${err}`, { level: "error" });
    return false;
  }
}

/**
 * Resolve the SQLite driver once. Probe order prefers backends with no native
 * ABI risk: `bun:sqlite` (Bun runtime) → `node:sqlite` (Node >= 22.5, stdlib,
 * no `.node` binary) → `better-sqlite3` (last resort; prebuilt binary may not
 * match the host Node ABI). Each candidate is load-tested via `:memory:` so a
 * broken native build never gets selected silently.
 * @returns A Database constructor bound to the first available backend.
 */
export function getDatabase(): new (path: string) => Database {
  if (!DatabaseImpl) {
    const candidates: Array<[RawDatabaseConstructor, string]> = [
      [BunSqliteDatabase, "bun:sqlite"],
      [NodeSqliteDatabase, "node:sqlite"],
      [BetterSqlite3Database, "better-sqlite3"],
    ];
    for (const [impl, label] of candidates) {
      if (probeBackend(impl, label)) {
        DatabaseImpl = impl as RawDatabaseConstructor & { new (path: string): Database };
        break;
      }
    }
    if (!DatabaseImpl) {
      // ponytail: unreachable on any supported runtime (Bun ships bun:sqlite,
      // Node >= 22.5 ships node:sqlite, Node >= 20 can load better-sqlite3).
      // If all three fail, surface a clear error at the first DB open rather
      // than a downstream "undefined is not a constructor" from callers.
      throw new Error(
        "[opencode-mem0] No SQLite backend available. Install Bun, use Node >= 22.5 (for node:sqlite), or install better-sqlite3 build tools."
      );
    }
  }
  return DatabaseImpl;
}
