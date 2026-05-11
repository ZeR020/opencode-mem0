import { vectorSearch } from "./sqlite/vector-search.js";
import { shardManager } from "./sqlite/shard-manager.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import { calculateRecency } from "./memory-scoring.js";

let _lifecycleIsRunning = false;

class LifecycleManager {
  private timeout: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timeout) return;
    log("Memory lifecycle job started", {
      intervalMinutes: CONFIG.memoryLifecycle?.checkIntervalMinutes ?? 60,
    });
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const intervalMs = (CONFIG.memoryLifecycle?.checkIntervalMinutes ?? 60) * 60 * 1000;
    this.timeout = setTimeout(async () => {
      if (!_lifecycleIsRunning) {
        _lifecycleIsRunning = true;
        try {
          await applyDecay();
          scanAndPromote();
        } catch (error) {
          log("Lifecycle job error", { error: String(error) });
        } finally {
          _lifecycleIsRunning = false;
        }
      }
      this.scheduleNext();
    }, intervalMs);
  }

  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
      log("Memory lifecycle job stopped");
    }
  }

  isActive(): boolean {
    return this.timeout !== null;
  }
}

const lifecycleManager = new LifecycleManager();

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
 * Calculate a contextual decay rate based on memory strength, access frequency,
 * and type. Strong, frequently-accessed memories decay slower; weak, rarely-
 * accessed memories decay faster.
 *
 * Formula:
 *   rate = baseRate × √(strengthMultiplier × accessMultiplier)
 *   strengthMultiplier = max(0, 1 - strengthBoostFactor × strength)
 *   accessMultiplier   = max(0, 1 - accessBoostFactor × log₂(accessCount + 1))
 *
 * The result is clamped to [minDecayRate, maxDecayRate].
 */
export function calculateContextualDecayRate(
  memoryType?: string,
  strength?: number,
  accessCount?: number,
  isPinned?: boolean
): number {
  // Pinned memories never decay
  if (isPinned) {
    return 0.0;
  }

  // Fall back to static classification when contextual decay is disabled
  if (!CONFIG.contextualDecay?.enabled || strength === undefined) {
    return classifyMemory(memoryType).decayRate;
  }

  // Hard LTM types (preference, decision, etc.) have static decayRate 0.0
  const staticRate = classifyMemory(memoryType).decayRate;
  if (staticRate === 0.0) {
    return 0.0;
  }

  const config = CONFIG.contextualDecay;
  const baseRate = config?.baseDecayRate ?? 0.05;
  const strengthBoost = config?.strengthBoostFactor ?? 0.5;
  const accessBoost = config?.accessBoostFactor ?? 0.3;
  const minRate = config?.minDecayRate ?? 0.005;
  const maxRate = config?.maxDecayRate ?? 0.15;

  const strengthMultiplier = Math.max(0, 1 - strengthBoost * strength);
  const accessMultiplier = Math.max(0, 1 - accessBoost * Math.log2((accessCount ?? 0) + 1));

  const combinedMultiplier = Math.sqrt(strengthMultiplier * accessMultiplier);
  const rate = baseRate * combinedMultiplier;

  return Math.max(minRate, Math.min(maxRate, rate));
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
          .prepare("SELECT id, store_type, strength, access_count FROM memories WHERE id = ?")
          .get(memoryId) as any;

        if (!memory) continue;

        if (memory.store_type !== "stm") {
          return { success: true, promoted: false };
        }

        const strength = Number(memory.strength || 0);
        const accessCount = Number(memory.access_count || 0);

        if (strength > threshold && accessCount > 3) {
          db.prepare("UPDATE memories SET store_type = 'ltm', decay_rate = 0.01 WHERE id = ?").run(
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
export async function applyDecay(): Promise<{
  updated: number;
  decayed: number;
  archived: number;
  duration: number;
}> {
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
      let db: any = null;
      let inTxn = false;
      const toArchive: Array<{ id: string; shard: any }> = [];
      try {
        db = connectionManager.getConnection(shard.dbPath);

        // Get all STM memories and LTM memories with non-zero decay, excluding pinned
        const memories = db
          .prepare(
            `SELECT id, strength, decay_rate, created_at, last_decay_at, store_type, access_count, type, is_pinned
             FROM memories
             WHERE (store_type = 'stm' OR (store_type = 'ltm' AND decay_rate > 0)) AND is_pinned = 0`
          )
          .all() as any[];

        if (memories.length === 0) continue;

        const contextualDecayEnabled = CONFIG.contextualDecay?.enabled ?? false;

        const updateStmt = db.prepare(
          contextualDecayEnabled
            ? "UPDATE memories SET strength = ?, recency_score = ?, last_decay_at = ?, decay_rate = ? WHERE id = ?"
            : "UPDATE memories SET strength = ?, recency_score = ?, last_decay_at = ? WHERE id = ?"
        );

        db.run("BEGIN IMMEDIATE");
        inTxn = true;

        for (const memory of memories) {
          const createdAt = Number(memory.created_at);
          const lastDecayAt = memory.last_decay_at ? Number(memory.last_decay_at) : createdAt;

          // Skip rows already decayed by a concurrent writer in this time window
          if (lastDecayAt >= now) continue;

          const deltaMs = now - lastDecayAt;
          const deltaDays = deltaMs / (24 * 60 * 60 * 1000);
          const currentStrength = Number(memory.strength || 0.5);
          const storedDecayRate = Number(memory.decay_rate || 0.05);

          let decayRate = storedDecayRate;

          if (contextualDecayEnabled) {
            const contextualRate = calculateContextualDecayRate(
              memory.type,
              currentStrength,
              Number(memory.access_count || 0),
              memory.is_pinned === 1
            );

            if (contextualRate !== storedDecayRate) {
              log("Contextual decay rate applied", {
                memoryId: memory.id,
                oldRate: storedDecayRate,
                newRate: contextualRate,
                strength: currentStrength,
                accessCount: memory.access_count,
              });
            }

            decayRate = contextualRate;
          }

          if (decayRate <= 0) continue; // LTM with zero decay rate — skip

          // Incremental Ebbinghaus decay since last maintenance
          const newStrength = currentStrength * Math.exp(-decayRate * deltaDays);
          const clampedStrength = Math.max(0, Math.min(1, newStrength));
          const recencyScore = calculateRecency(createdAt);

          // Update strength, recency_score, last_decay_at, and optionally decay_rate
          if (contextualDecayEnabled) {
            updateStmt.run(clampedStrength, recencyScore, now, decayRate, memory.id);
          } else {
            updateStmt.run(clampedStrength, recencyScore, now, memory.id);
          }
          totalUpdated++;

          if (clampedStrength < currentStrength) {
            totalDecayed++;
          }

          // Archive check: if strength < threshold AND older than archiveAfterDays
          const ageMs = now - createdAt;
          if (clampedStrength < archiveThreshold && ageMs > archiveAfterMs) {
            archiveMemory(db, memory.id, shard);
            toArchive.push({ id: memory.id, shard });
            totalArchived++;
          }
        }

        db.run("COMMIT");
        inTxn = false;

        // Delete vectors after transaction commits to avoid fire-and-forget desync
        for (const item of toArchive) {
          try {
            await vectorSearch.deleteVector(db, item.id, item.shard);
            shardManager.decrementVectorCount(item.shard.id);
          } catch (err) {
            log("applyDecay vector delete error", { memoryId: item.id, error: String(err) });
          }
        }
      } catch (error) {
        if (inTxn) {
          try {
            db.run("ROLLBACK");
          } catch (rollbackErr) {
            log("applyDecay rollback failed", { error: String(rollbackErr) });
          }
        }
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
async function archiveMemory(db: any, memoryId: string, shard: any): Promise<void> {
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
    const insertResult = db.run(
      `
      INSERT INTO memories_archive
      SELECT id, content, tags, type, created_at, ?, strength, access_count,
             container_tag, metadata, store_type, decay_rate
      FROM memories WHERE id = ?
    `,
      Date.now(),
      memoryId
    );

    if (insertResult.changes === 0) {
      log("archiveMemory: memory already removed, skipping delete", { memoryId });
      return;
    }

    // Delete from memories
    db.run("DELETE FROM memories WHERE id = ?", memoryId);

    // Ensure the vector is removed from the backend index
    try {
      await vectorSearch.deleteVector(db, memoryId, shard);
      shardManager.decrementVectorCount(shard.id);
    } catch (err) {
      log("archiveMemory vector delete error", { memoryId, error: String(err) });
    }

    log("Memory archived", { memoryId, shardId: shard.id });
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
        const result = db.prepare("SELECT COUNT(*) as count FROM memories_archive").get() as any;
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
  lifecycleManager.start();
}

/**
 * Stop the background lifecycle job.
 */
export function stopLifecycleJob(): void {
  lifecycleManager.stop();
}

/**
 * Run lifecycle maintenance immediately (useful for startup cleanup).
 */
export async function runLifecycleMaintenance(): Promise<void> {
  if (_lifecycleIsRunning) {
    log("Lifecycle maintenance skipped: already running");
    return;
  }
  _lifecycleIsRunning = true;
  try {
    await applyDecay();
    scanAndPromote();
  } catch (error) {
    log("Lifecycle maintenance error", { error: String(error) });
  } finally {
    _lifecycleIsRunning = false;
  }
}
