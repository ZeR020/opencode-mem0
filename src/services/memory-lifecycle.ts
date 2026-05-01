import { shardManager } from "./sqlite/shard-manager.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";

let lifecycleInterval: Timer | null = null;
let isRunning = false;

// Memory type classification rules
const LTM_TYPES = new Set([
  "preference",
  "constraint",
  "decision",
  "requirement",
  "architecture",
  "configuration",
  "rule",
]);

const STM_TYPES = new Set([
  "episodic",
  "chat",
  "conversation",
  "greeting",
  "casual",
  "question",
  "answer",
  "exchange",
]);

const SLOW_DECAY_LTM_TYPES = new Set([
  "learning",
  "procedural",
  "how-to",
  "guide",
  "tutorial",
  "workflow",
  "process",
]);

/**
 * Classify a memory's store type and decay rate based on its type field.
 * - preferences, constraints, decisions → LTM, never decay (decay_rate = 0)
 * - episodic, conversational → STM, fast decay (decay_rate = 0.05)
 * - learning, procedural → LTM, slow decay (decay_rate = 0.01)
 * - everything else → STM, default decay (decay_rate = 0.05)
 */
export function classifyMemory(memoryType?: string): {
  storeType: "stm" | "ltm";
  decayRate: number;
} {
  const type = (memoryType || "").toLowerCase().trim();

  if (LTM_TYPES.has(type)) {
    return { storeType: "ltm", decayRate: 0.0 };
  }

  if (SLOW_DECAY_LTM_TYPES.has(type)) {
    return { storeType: "ltm", decayRate: 0.01 };
  }

  if (STM_TYPES.has(type)) {
    return { storeType: "stm", decayRate: 0.05 };
  }

  // Default: STM with standard decay
  return { storeType: "stm", decayRate: 0.05 };
}

/**
 * Promote a memory from STM to LTM when it meets criteria:
 * - strength > promotionThreshold (default 0.7)
 * - access_count > 3
 * Only STM memories are candidates.
 */
export function promoteToLTM(memoryId: string): { success: boolean; promoted: boolean } {
  try {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const threshold = CONFIG.memoryLifecycle?.promotionThreshold ?? 0.7;

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);

        const memory = db
          .prepare(`SELECT id, store_type, strength, access_count FROM memories WHERE id = ?`)
          .get(memoryId) as any;

        if (!memory) continue;

        if (memory.store_type !== "stm") {
          return { success: true, promoted: false };
        }

        const strength = Number(memory.strength || 0);
        const accessCount = Number(memory.access_count || 0);

        if (strength > threshold && accessCount > 3) {
          db.prepare(`UPDATE memories SET store_type = 'ltm', decay_rate = 0.01 WHERE id = ?`).run(
            memoryId
          );

          log("Memory promoted to LTM", {
            memoryId,
            strength,
            accessCount,
            shardId: shard.id,
          });

          return { success: true, promoted: true };
        }

        return { success: true, promoted: false };
      } catch (error) {
        log("promoteToLTM shard error", { shardId: shard.id, error: String(error) });
      }
    }

    return { success: false, promoted: false };
  } catch (error) {
    log("promoteToLTM error", { memoryId, error: String(error) });
    return { success: false, promoted: false };
  }
}

/**
 * Apply Ebbinghaus forgetting curve decay to STM memories.
 * Formula: strength = strength * e^(-decay_rate * days_since_creation)
 * STM decay_rate = 0.05 (fast), LTM with decay = 0.01 (slow).
 * LTM with decay_rate = 0 is never decayed.
 */
export function applyDecay(): {
  updated: number;
  decayed: number;
  archived: number;
  duration: number;
} {
  const startTime = Date.now();
  let totalUpdated = 0;
  let totalDecayed = 0;
  let totalArchived = 0;

  try {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const now = Date.now();
    const archiveThreshold = CONFIG.memoryLifecycle?.archiveThreshold ?? 0.2;
    const archiveAfterDays = CONFIG.memoryLifecycle?.archiveAfterDays ?? 30;
    const archiveAfterMs = archiveAfterDays * 24 * 60 * 60 * 1000;

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);

        // Get all STM memories and LTM memories with non-zero decay
        const memories = db
          .prepare(
            `SELECT id, strength, decay_rate, created_at, store_type, access_count
             FROM memories
             WHERE store_type = 'stm' OR (store_type = 'ltm' AND decay_rate > 0)`
          )
          .all() as any[];

        if (memories.length === 0) continue;

        const updateStmt = db.prepare(
          `UPDATE memories SET strength = ?, recency_score = ? WHERE id = ?`
        );

        db.run("BEGIN TRANSACTION");

        for (const memory of memories) {
          const createdAt = Number(memory.created_at);
          const ageMs = now - createdAt;
          const ageDays = ageMs / (24 * 60 * 60 * 1000);
          const currentStrength = Number(memory.strength || 0.5);
          const decayRate = Number(memory.decay_rate || 0.05);

          if (decayRate <= 0) continue; // LTM with zero decay rate — skip

          // Ebbinghaus: strength *= e^(-decay_rate * age_in_days)
          const newStrength = currentStrength * Math.exp(-decayRate * ageDays);
          const clampedStrength = Math.max(0, Math.min(1, newStrength));

          // Update strength and sync recency_score to match
          updateStmt.run(clampedStrength, clampedStrength, memory.id);
          totalUpdated++;

          if (clampedStrength < currentStrength) {
            totalDecayed++;
          }

          // Archive check: if strength < threshold AND older than archiveAfterDays
          if (clampedStrength < archiveThreshold && ageMs > archiveAfterMs) {
            archiveMemory(db, memory.id, shard.id);
            totalArchived++;
          }
        }

        db.run("COMMIT");
      } catch (error) {
        log("applyDecay shard error", { shardId: shard.id, error: String(error) });
      }
    }

    const duration = Date.now() - startTime;
    log("Memory decay applied", {
      updated: totalUpdated,
      decayed: totalDecayed,
      archived: totalArchived,
      duration: `${duration}ms`,
    });

    return {
      updated: totalUpdated,
      decayed: totalDecayed,
      archived: totalArchived,
      duration,
    };
  } catch (error) {
    log("applyDecay error", { error: String(error) });
    return {
      updated: totalUpdated,
      decayed: totalDecayed,
      archived: totalArchived,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Archive a memory by moving it to an archive table and deleting from memories.
 */
function archiveMemory(db: any, memoryId: string, shardId: number): void {
  try {
    // Create archive table if not exists
    db.run(`
      CREATE TABLE IF NOT EXISTS memories_archive (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT,
        type TEXT,
        created_at INTEGER NOT NULL,
        archived_at INTEGER NOT NULL,
        strength REAL,
        access_count INTEGER,
        container_tag TEXT,
        metadata TEXT,
        store_type TEXT,
        decay_rate REAL
      )
    `);

    // Copy to archive
    db.run(
      `
      INSERT INTO memories_archive
      SELECT id, content, tags, type, created_at, ?, strength, access_count,
             container_tag, metadata, store_type, decay_rate
      FROM memories WHERE id = ?
    `,
      Date.now(),
      memoryId
    );

    // Delete from memories
    db.run(`DELETE FROM memories WHERE id = ?`, memoryId);

    log("Memory archived", { memoryId, shardId });
  } catch (error) {
    log("archiveMemory error", { memoryId, error: String(error) });
  }
}

/**
 * Get count of archived memories.
 */
export function getArchivedCount(): number {
  let count = 0;

  try {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);
        const result = db.prepare(`SELECT COUNT(*) as count FROM memories_archive`).get() as any;
        count += result?.count || 0;
      } catch {
        // Archive table may not exist
      }
    }
  } catch (error) {
    log("getArchivedCount error", { error: String(error) });
  }

  return count;
}

/**
 * Scan for promotion candidates and promote eligible STM memories to LTM.
 */
export function scanAndPromote(): { scanned: number; promoted: number } {
  let scanned = 0;
  let promoted = 0;

  try {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const threshold = CONFIG.memoryLifecycle?.promotionThreshold ?? 0.7;

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);

        const candidates = db
          .prepare(
            `SELECT id, strength, access_count FROM memories
             WHERE store_type = 'stm' AND strength > ? AND access_count > 3`
          )
          .all(threshold) as any[];

        scanned += candidates.length;

        for (const candidate of candidates) {
          const result = promoteToLTM(candidate.id);
          if (result.promoted) promoted++;
        }
      } catch (error) {
        log("scanAndPromote shard error", { shardId: shard.id, error: String(error) });
      }
    }

    log("Memory promotion scan complete", { scanned, promoted });
    return { scanned, promoted };
  } catch (error) {
    log("scanAndPromote error", { error: String(error) });
    return { scanned, promoted };
  }
}

/**
 * Start the background lifecycle job.
 * Runs applyDecay and scanAndPromote at the configured interval.
 */
export function startLifecycleJob(): void {
  if (lifecycleInterval) return;

  const intervalMs = (CONFIG.memoryLifecycle?.checkIntervalMinutes ?? 60) * 60 * 1000;

  lifecycleInterval = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      await applyDecay();
      scanAndPromote();
    } catch (error) {
      log("Lifecycle job error", { error: String(error) });
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  log("Memory lifecycle job started", {
    intervalMinutes: CONFIG.memoryLifecycle?.checkIntervalMinutes ?? 60,
  });
}

/**
 * Stop the background lifecycle job.
 */
export function stopLifecycleJob(): void {
  if (lifecycleInterval) {
    clearInterval(lifecycleInterval as any);
    lifecycleInterval = null;
    log("Memory lifecycle job stopped");
  }
}

/**
 * Run lifecycle maintenance immediately (useful for startup cleanup).
 */
export async function runLifecycleMaintenance(): Promise<void> {
  try {
    applyDecay();
    scanAndPromote();
  } catch (error) {
    log("Lifecycle maintenance error", { error: String(error) });
  }
}
