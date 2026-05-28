import { shardManager, getAllShards } from "./sqlite/shard-manager.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import {
  calculateRecency,
  calculateFrequency,
  calculateImportance,
  calculateUtility,
  calculateNovelty,
  calculateConfidence,
  calculateInterference,
  computeStrength,
} from "./memory-scoring.js";
import type { ScoreComponents } from "./memory-scoring.js";
import { safeJSONParse } from "./utils/safe-transforms.js";

let scoringInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Recalculate scores for all memories in all shards.
 * Updates recency, utility, and strength in-place.
 * Optionally recalculates novelty and interference (expensive).
 */
function findConflictingMemories(content: string, allContents: string[]): string[] {
  const words = content
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
  if (words.length === 0) return [];
  return allContents
    .filter((c) => c !== content)
    .filter((existing) => words.some((w) => existing.toLowerCase().includes(w)))
    .slice(0, 10);
}

function recalculateSingleMemory(
  memory: any,
  allContents: string[],
  recalculateNoveltyAndInterference: boolean
): ScoreComponents & { strength: number } {
  const content = memory.content || "";
  const createdAt = Number(memory.created_at);
  const accessCount = Number(memory.access_count || 0);
  const lastAccessed = memory.last_accessed ? Number(memory.last_accessed) : null;
  const type = memory.type || undefined;

  const metadata = (safeJSONParse(memory.metadata) as Record<string, any>) ?? {};
  const source = metadata.source || undefined;

  const recency = calculateRecency(createdAt, CONFIG.memoryScoring.recencyHalfLifeDays);
  const frequency = calculateFrequency(accessCount);
  const utility = calculateUtility(lastAccessed, CONFIG.memoryScoring.utilityHalfLifeDays);

  let importance = Number(memory.importance_score ?? 0.5);
  let novelty = Number(memory.novelty_score ?? 0.5);
  let confidence = Number(memory.confidence_score ?? 0.7);
  let interference = Number(memory.interference_penalty ?? 0);

  if (recalculateNoveltyAndInterference) {
    importance = calculateImportance(content, type);
    novelty = calculateNovelty(
      content,
      allContents.filter((c) => c !== content)
    );
    confidence = calculateConfidence(source, type);
    interference = calculateInterference(content, findConflictingMemories(content, allContents));
  }

  const strength = computeStrength({
    recency,
    frequency,
    importance,
    utility,
    novelty,
    confidence,
    interference,
  });

  return { recency, frequency, importance, utility, novelty, confidence, interference, strength };
}

export function recalculateAllScores(recalculateNoveltyAndInterference: boolean = false): {
  updated: number;
  shards: number;
  duration: number;
} {
  const startTime = Date.now();
  let totalUpdated = 0;
  let shardsProcessed = 0;

  try {
    const allShards = getAllShards();

    for (const shard of allShards) {
      let db: any = null;
      let inTxn = false;
      try {
        db = connectionManager.getConnection(shard.dbPath);
        const memories = db
          .prepare(
            `SELECT id, content, type, created_at, access_count, last_accessed,
                    recency_score, frequency_score, importance_score, utility_score,
                    novelty_score, confidence_score, interference_penalty, strength,
                    metadata, container_tag
             FROM memories`
          )
          .all() as any[];

        if (memories.length === 0) continue;

        const allContents = memories.map((m) => m.content || "");
        const updateStmt = db.prepare(`
          UPDATE memories
          SET recency_score = ?,
              frequency_score = ?,
              importance_score = ?,
              utility_score = ?,
              novelty_score = ?,
              confidence_score = ?,
              interference_penalty = ?,
              strength = ?
          WHERE id = ?
        `);

        db.run("BEGIN TRANSACTION");
        inTxn = true;

        for (const memory of memories) {
          const scores = recalculateSingleMemory(
            memory,
            allContents,
            recalculateNoveltyAndInterference
          );

          updateStmt.run(
            scores.recency,
            scores.frequency,
            scores.importance,
            scores.utility,
            scores.novelty,
            scores.confidence,
            scores.interference,
            scores.strength,
            memory.id
          );

          totalUpdated++;
        }

        db.run("COMMIT");
        inTxn = false;
        shardsProcessed++;
      } catch (error) {
        if (inTxn) {
          try {
            db.run("ROLLBACK");
          } catch (rollbackErr) {
            log("Score recalculation rollback failed", { error: String(rollbackErr) });
          }
        }
        log("Score recalculation failed for shard", {
          shardId: shard.id,
          error: String(error),
        });
      }
    }

    const duration = Date.now() - startTime;
    log("Memory score recalculation complete", {
      updated: totalUpdated,
      shards: shardsProcessed,
      duration: `${duration}ms`,
    });

    return { updated: totalUpdated, shards: shardsProcessed, duration };
  } catch (error) {
    log("Score recalculation error", { error: String(error) });
    return { updated: totalUpdated, shards: shardsProcessed, duration: Date.now() - startTime };
  }
}

/**
 * Start the background scoring recalculation job.
 * Recalculates dynamic scores (recency, utility, strength) at the configured interval.
 * Full recalculation (including novelty/interference) happens every 4th cycle.
 */
export function startScoringRecalculation(): void {
  if (scoringInterval) return;
  if (!CONFIG.memoryScoring.enabled) return;

  const intervalMs = (CONFIG.memoryScoring.recalculationIntervalMinutes || 60) * 60 * 1000;
  let cycleCount = 0;

  scoringInterval = setInterval(() => {
    if (isRunning) return;
    isRunning = true;

    try {
      cycleCount++;
      const fullRecalc = cycleCount % 4 === 0; // Full recalc every 4 cycles
      recalculateAllScores(fullRecalc);
    } catch (error) {
      log("Background scoring recalculation error", { error: String(error) });
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  log("Memory scoring recalculation started", {
    intervalMinutes: CONFIG.memoryScoring.recalculationIntervalMinutes,
  });
}

/**
 * Stop the background scoring recalculation job.
 */
export function stopScoringRecalculation(): void {
  if (scoringInterval) {
    clearInterval(scoringInterval);
    scoringInterval = null;
    log("Memory scoring recalculation stopped");
  }
}

/**
 * Run a one-time score recalculation (useful for initial migration or manual trigger).
 */
export function runOneTimeScoringRecalculation(): {
  updated: number;
  shards: number;
  duration: number;
} {
  return recalculateAllScores(true);
}
