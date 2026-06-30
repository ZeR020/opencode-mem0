import { getAllShards } from "./sqlite/shard-manager.js";
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
import type { Database } from "./sqlite/sqlite-bootstrap.js";
import { safeJSONParse } from "./utils/safe-transforms.js";

let scoringInterval: NodeJS.Timeout | null = null;
let isRunning = false;
export let scoringSkippedCycles = 0; // skipcq JS-E1009
export let scoringLastDurationMs = 0; // skipcq JS-E1009

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

interface ScoringMemoryRow {
  id: string;
  content: string;
  type: string | null;
  created_at: number;
  access_count: number;
  last_accessed: number | null;
  recency_score: number;
  frequency_score: number;
  importance_score: number;
  utility_score: number;
  novelty_score: number;
  confidence_score: number;
  interference_penalty: number;
  strength: number;
  metadata: string | null;
  container_tag: string;
}

function recalculateSingleMemory(
  memory: ScoringMemoryRow,
  allContents: string[],
  recalculateNoveltyAndInterference: boolean
): ScoreComponents & { strength: number } {
  const content = memory.content || "";
  const createdAt = Number(memory.created_at);
  const accessCount = Number(memory.access_count || 0);
  const lastAccessed = memory.last_accessed ? Number(memory.last_accessed) : null;
  const type = memory.type || undefined;

  const metadata = (safeJSONParse(memory.metadata) as Record<string, unknown>) ?? {};
  const source = typeof metadata.source === "string" ? metadata.source : undefined;

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
  const batchSize = CONFIG.memoryScoring.recalculationBatchSize ?? 500;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let shardsProcessed = 0;

  try {
    const allShards = getAllShards();

    for (const shard of allShards) {
      let db: Database | null = null;
      let inTxn = false;
      try {
        db = connectionManager.getConnection(shard.dbPath);

        // Count total memories in this shard for progress tracking
        const countRow = db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as {
          cnt: number;
        };
        const totalInShard = countRow.cnt;
        if (totalInShard === 0) continue;

        const totalBatches = Math.ceil(totalInShard / batchSize);

        const selectStmt = db.prepare(
          `SELECT id, content, type, created_at, access_count, last_accessed,
                  recency_score, frequency_score, importance_score, utility_score,
                  novelty_score, confidence_score, interference_penalty, strength,
                  metadata, container_tag
           FROM memories
           ORDER BY rowid
           LIMIT ? OFFSET ?`
        );

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

        let chunkIndex = 0;

        for (let offset = 0; offset < totalInShard; offset += batchSize) {
          chunkIndex++;
          const chunk = selectStmt.all(batchSize, offset) as ScoringMemoryRow[];

          if (chunk.length === 0) break;

          const allContents = chunk.map((m) => m.content || "");

          db.run("BEGIN TRANSACTION");
          inTxn = true;

          for (const memory of chunk) {
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
          totalProcessed += chunk.length;

          log(`recalculateAllScores chunk ${chunkIndex}/${totalBatches} (shard ${shard.id})`, {
            chunkSize: chunk.length,
            totalUpdated,
          });
        }

        shardsProcessed++;
      } catch (error) {
        if (inTxn) {
          try {
            db!.run("ROLLBACK");
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
      processed: totalProcessed,
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
    if (isRunning) {
      scoringSkippedCycles++;
      if (scoringSkippedCycles % 10 === 0) {
        log("Scoring recalculation falling behind — skipped cycles accumulating", {
          skippedCycles: scoringSkippedCycles,
        });
      }
      return;
    }
    isRunning = true;

    const cycleStart = Date.now();
    try {
      cycleCount++;
      const fullRecalc = cycleCount % 4 === 0; // Full recalc every 4 cycles
      recalculateAllScores(fullRecalc);
    } catch (error) {
      log("Background scoring recalculation error", { error: String(error) });
    } finally {
      scoringLastDurationMs = Date.now() - cycleStart;
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
