import { shardManager } from "./sqlite/shard-manager.js";
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

let scoringInterval: Timer | null = null;
let isRunning = false;

function getDatabase() {
  // Lazy import to avoid circular dependency
  const { getDatabase: getDb } = require("./sqlite/sqlite-bootstrap.js");
  return getDb();
}

/**
 * Recalculate scores for all memories in all shards.
 * Updates recency, utility, and strength in-place.
 * Optionally recalculates novelty and interference (expensive).
 */
export async function recalculateAllScores(
  recalculateNoveltyAndInterference: boolean = false
): Promise<{ updated: number; shards: number; duration: number }> {
  const startTime = Date.now();
  let totalUpdated = 0;
  let shardsProcessed = 0;

  try {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    for (const shard of allShards) {
      try {
        const db = connectionManager.getConnection(shard.dbPath);

        // Get all memories in this shard
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

        // Get all contents for novelty calculation
        const allContents = memories.map((m) => m.content || "");

        // Batch update statement
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

        for (const memory of memories) {
          const content = memory.content || "";
          const createdAt = Number(memory.created_at);
          const accessCount = Number(memory.access_count || 0);
          const lastAccessed = memory.last_accessed ? Number(memory.last_accessed) : null;
          const type = memory.type || undefined;

          let metadata: any = {};
          try {
            if (memory.metadata) {
              metadata = JSON.parse(memory.metadata);
            }
          } catch {
            // ignore parse errors
          }

          const source = metadata.source || undefined;

          // Recalculate dynamic scores
          const recency = calculateRecency(createdAt, CONFIG.memoryScoring.recencyHalfLifeDays);
          const frequency = calculateFrequency(accessCount);
          const utility = calculateUtility(lastAccessed, CONFIG.memoryScoring.utilityHalfLifeDays);

          // Static scores (can optionally recalculate)
          let importance = Number(memory.importance_score ?? 0.5);
          let novelty = Number(memory.novelty_score ?? 0.5);
          let confidence = Number(memory.confidence_score ?? 0.7);
          let interference = Number(memory.interference_penalty ?? 0.0);

          if (recalculateNoveltyAndInterference) {
            importance = calculateImportance(content, type);
            novelty = calculateNovelty(
              content,
              allContents.filter((c) => c !== content)
            );
            confidence = calculateConfidence(source, type);

            // Find potential conflicts
            const otherContents = allContents.filter((c) => c !== content);
            const conflictingMemories = otherContents
              .filter((existing: string) => {
                const words = content
                  .toLowerCase()
                  .split(/\s+/)
                  .filter((w: string) => w.length > 4);
                return words.some((w: string) => existing.toLowerCase().includes(w));
              })
              .slice(0, 10);

            interference = calculateInterference(content, conflictingMemories);
          }

          // Compute final strength
          const strength = computeStrength({
            recency,
            frequency,
            importance,
            utility,
            novelty,
            confidence,
            interference,
          });

          updateStmt.run(
            recency,
            frequency,
            importance,
            utility,
            novelty,
            confidence,
            interference,
            strength,
            memory.id
          );

          totalUpdated++;
        }

        db.run("COMMIT");
        shardsProcessed++;
      } catch (error) {
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

  scoringInterval = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      cycleCount++;
      const fullRecalc = cycleCount % 4 === 0; // Full recalc every 4 cycles
      await recalculateAllScores(fullRecalc);
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
    clearInterval(scoringInterval as any);
    scoringInterval = null;
    log("Memory scoring recalculation stopped");
  }
}

/**
 * Run a one-time score recalculation (useful for initial migration or manual trigger).
 */
export async function runOneTimeScoringRecalculation(): Promise<{
  updated: number;
  shards: number;
  duration: number;
}> {
  return recalculateAllScores(true);
}
