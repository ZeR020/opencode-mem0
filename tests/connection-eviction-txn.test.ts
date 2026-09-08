import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

const POOL_CAP = 20;

describe("connection pool eviction", () => {
  let dir: string;

  afterEach(() => {
    connectionManager.closeAll();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("eviction skips connection with open txn", () => {
    dir = mkdtempSync(join(tmpdir(), "conn-evict-txn-"));
    connectionManager.closeAll();

    const paths = Array.from({ length: POOL_CAP + 1 }, (_, i) => join(dir, `s${i}.db`));
    const dbs = paths.slice(0, POOL_CAP).map((p) => connectionManager.getConnection(p));
    const busy = dbs[0];
    const idleVictim = dbs[1];
    busy.run("BEGIN IMMEDIATE");

    connectionManager.getConnection(paths[POOL_CAP]);

    expect(() => busy.run("COMMIT")).not.toThrow();
    expect(() => idleVictim.run("SELECT 1")).toThrow();
  });
});
