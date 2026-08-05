import type { Database } from "./sqlite/sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { connectionManager } from "./sqlite/connection-manager.js";
import {
  shardManager,
  getAllShards,
  extractScopeFromContainerTag,
} from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { decodeVector } from "./vector-backends/shared.js";
import { embeddingService } from "./embedding.js";
import { z } from "zod";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import type { MemoryConflict } from "./sqlite/types.js";
import { checkContradictionHeuristic } from "./utils/text-analysis.js";
import { mapDbRowToConflict } from "./utils/memory-mapper.js";

// ponytail: module-level Set, single consumer in detectConflicts. Per-key locks if contention matters.
const conflictChecksRunning = new Set<string>();

/**
 * True when any LLM contradiction provider is configured (opencode pair or
 * manual memory-provider pair). Kept separate from the verdict orchestrator
 * to hold its branch count below the DeepSource complexity threshold.
 */
const hasAnyContradictionProvider = (): boolean =>
  Boolean(
    (CONFIG.opencodeProvider && CONFIG.opencodeModel) || (CONFIG.memoryModel && CONFIG.memoryApiUrl)
  );

/**
 * Opencode provider verdict path. Returns null when the path does not apply
 * (no opencode config, or provider not connected) so the orchestrator can
 * fall through to the manual provider path. Throws on provider errors — the
 * orchestrator's try/catch maps those to "unknown".
 */
const verdictViaOpencode = async (
  prompt: string,
  timeout: number
): Promise<"yes" | "no" | null> => {
  if (!CONFIG.opencodeProvider || !CONFIG.opencodeModel) return null;

  const { isProviderConnected, getStatePath, generateStructuredOutput } =
    await import("./ai/opencode-provider.js");

  if (!isProviderConnected(CONFIG.opencodeProvider)) return null;

  const schema = z.object({
    contradicts: z.enum(["YES", "NO"]),
  });

  const result = await withTimeout(
    generateStructuredOutput({
      providerName: CONFIG.opencodeProvider,
      modelId: CONFIG.opencodeModel,
      statePath: getStatePath(),
      systemPrompt:
        "You are a precise contradiction detector. Analyze two statements and answer ONLY YES or NO. Be strict: only answer YES if the statements are logically incompatible.",
      userPrompt: prompt,
      schema,
      temperature: 0,
    }),
    timeout
  );

  return result.contradicts === "YES" ? "yes" : "no";
};

/**
 * Manual memory-provider verdict path (memoryModel + memoryApiUrl via
 * AIProviderFactory). Returns null when the path does not apply or the
 * provider produced no usable tool-call result. Throws on provider errors —
 * the orchestrator's try/catch maps those to "unknown".
 */
const verdictViaManualProvider = async (
  prompt: string,
  sessionID: string | undefined,
  timeout: number
): Promise<"yes" | "no" | null> => {
  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) return null;

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);
  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "check_contradiction",
      description: "Check if two statements contradict each other",
      parameters: {
        type: "object",
        properties: {
          contradicts: {
            type: "string",
            enum: ["YES", "NO"],
            description: "Answer only YES or NO",
          },
        },
        required: ["contradicts"],
      },
    },
  };

  const result = await withTimeout(
    provider.executeToolCall(
      "You are a precise contradiction detector. Analyze two statements and answer ONLY YES or NO. Be strict: only answer YES if the statements are logically incompatible.",
      prompt,
      toolSchema,
      sessionID || "conflict-check"
    ),
    timeout
  );

  if (!result.success || !result.data) return null;
  return result.data.contradicts === "YES" ? "yes" : "no";
};

/**
 * Check if two memory statements contradict each other using an LLM.
 * Falls back to a heuristic-based check if the LLM is unavailable.
 *
 * @param memory1 - Content of the first memory
 * @param memory2 - Content of the second memory
 * @param sessionID - Optional session ID for provider routing
 * - "yes" / "no": a provider confirmed/denied, or no provider is configured
 *   at all (the heuristic verdict then stands).
 * - "unknown": a provider IS configured but errored, timed out, or produced
 *   no result. Callers decide the fallback — dedup merges (preserving
 *   pre-delta behavior during outages), detectConflicts falls back to the
 *   heuristic.
 *
 * @param memory1 - Content of the first memory
 * @param memory2 - Content of the second memory
 * @param sessionID - Optional session ID for provider routing
 * @param timeoutMs - Optional override for the provider timeout; defaults to
 *   CONFIG.autoCaptureIterationTimeout (30000).
 */
export const checkContradictionVerdict = async (
  memory1: string,
  memory2: string,
  sessionID?: string,
  timeoutMs?: number
): Promise<"yes" | "no" | "unknown"> => {
  const prompt = `Do these two statements contradict each other? A: ${JSON.stringify(memory1)} B: ${JSON.stringify(memory2)} Answer only YES or NO`;
  const timeout = timeoutMs ?? CONFIG.autoCaptureIterationTimeout ?? 30000;

  // No provider configured: the heuristic verdict stands.
  if (!hasAnyContradictionProvider()) {
    return checkContradictionHeuristic(memory1, memory2) ? "yes" : "no";
  }

  try {
    const opencodeVerdict = await verdictViaOpencode(prompt, timeout);
    if (opencodeVerdict !== null) return opencodeVerdict;

    const manualVerdict = await verdictViaManualProvider(prompt, sessionID, timeout);
    if (manualVerdict !== null) return manualVerdict;
  } catch (error) {
    log("checkContradictionVerdict: LLM check failed, treating verdict as unknown", {
      error: String(error),
    });
    return "unknown";
  }

  // Provider configured but no path yielded a verdict (e.g. opencode provider
  // not connected and no manual config): unavailable, not a heuristic verdict.
  return "unknown";
};

/**
 * Check if two memory statements contradict each other using an LLM.
 * Falls back to a heuristic-based check if the LLM is unavailable.
 * Byte-compatible boolean view over checkContradictionVerdict (unknown →
 * heuristic), kept for detectConflicts and existing call sites.
 *
 * @param memory1 - Content of the first memory
 * @param memory2 - Content of the second memory
 * @param sessionID - Optional session ID for provider routing
 * @returns true if the statements are logically incompatible
 */
export const checkContradictionWithLLM = async (
  memory1: string,
  memory2: string,
  sessionID?: string
): Promise<boolean> => {
  const verdict = await checkContradictionVerdict(memory1, memory2, sessionID);
  if (verdict === "unknown") {
    return checkContradictionHeuristic(memory1, memory2);
  }
  return verdict === "yes";
};

/**
 * Bounded race so a hung provider call can never stall callers indefinitely
 * (e.g. the per-shard write lock in addMemory). The losing provider promise
 * gets a no-op catch so its late rejection is not an unhandled rejection.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`LLM contradiction check timed out after ${ms}ms`)),
      ms
    );
  });
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Detect conflicts between a newly added memory and existing similar memories.
 * Performs similarity search, then LLM-based or heuristic contradiction detection.
 * Runs asynchronously to avoid blocking memory insertion.
 *
 * @param newMemoryId - ID of the newly created memory
 * @param newMemoryContent - Content of the new memory
 * @param containerTag - Container tag for scoping the search
 * @param sessionID - Optional session ID for provider routing
 * @returns Array of detected conflicts (may be empty)
 */
// NOSONAR S3776: Conflict detection involves similarity search, LLM-based contradiction checking,
// heuristic fallback, and database persistence — natural decomposition would fragment the detection pipeline.
export const detectConflicts = async (
  newMemoryId: string,
  newMemoryContent: string,
  containerTag: string,
  sessionID?: string
): Promise<MemoryConflict[]> => {
  const lockKey = `${newMemoryId}:${containerTag}`;
  if (conflictChecksRunning.has(lockKey)) {
    log("detectConflicts: skipping, another check is running", {
      memoryId: newMemoryId,
      containerTag,
    });
    return [];
  }
  conflictChecksRunning.add(lockKey);

  try {
    const { scope, hash } = extractScopeFromContainerTag(containerTag);
    const shards = shardManager.getAllShards(scope, hash);

    if (shards.length === 0) return [];
    const conflicts: MemoryConflict[] = [];

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);

      // Search for similar memories using text search first (cheaper than vector)
      const similarMemories = findSimilarMemories(db, newMemoryContent, containerTag, newMemoryId);

      for (const candidate of similarMemories) {
        if (candidate.id === newMemoryId) continue;
        if (candidate.is_deprecated) continue;

        // Check if conflict already recorded
        const existingConflict = findExistingConflict(db, newMemoryId, candidate.id);
        if (existingConflict) continue;

        // Heuristic pre-filter: skip expensive LLM call for obvious non-contradictions
        const heuristicContradiction = checkContradictionHeuristic(
          newMemoryContent,
          candidate.content
        );
        if (!heuristicContradiction) continue;

        // LLM-based contradiction check (expensive, only for heuristic positives)
        const isContradiction = await checkContradictionWithLLM(
          newMemoryContent,
          candidate.content,
          sessionID
        );

        if (isContradiction) {
          const conflictId = `conflict_${Date.now()}_${randomBytes(4).toString("hex")}`;
          const conflict: MemoryConflict = {
            id: conflictId,
            memoryId1: newMemoryId,
            memoryId2: candidate.id,
            similarityScore: candidate.similarity,
            detectedAt: Date.now(),
            resolved: 0,
            containerTag,
          };

          saveConflict(db, conflict);
          conflicts.push(conflict);

          log("Conflict detected", {
            conflictId,
            memoryId1: newMemoryId,
            memoryId2: candidate.id,
            similarity: candidate.similarity,
          });
        }
      }
    }

    return conflicts;
  } catch (error) {
    log("detectConflicts: error", { error: String(error) });
    return [];
  } finally {
    conflictChecksRunning.delete(lockKey);
  }
};

interface SimilarMemory {
  id: string;
  content: string;
  similarity: number;
  is_deprecated: number;
}

/** Raw row shape for the similar-memory queries (id/content/is_deprecated). */
type SimilarMemoryRow = {
  id: string;
  content: string;
  is_deprecated: number;
};

/**
 * Raw memory_conflicts row shape (optionally joined with the two memories'
 * content for the list/get queries). Optional fields mirror the sqlite
 * nullable columns; the join columns are absent on plain SELECT * reads.
 */
type ConflictRow = {
  id: string;
  memory_id_1: string;
  memory_id_2: string;
  similarity_score: number;
  detected_at: number;
  resolved: number;
  resolution_type?: string;
  resolved_at?: number;
  resolution_data?: string;
  container_tag?: string;
  m1_content?: string;
  m2_content?: string;
};

/**
 * Find memories similar to the given content within the same container.
 * Uses FTS5 full-text search when available, falling back to LIKE queries.
 *
 * @param db - SQLite database handle
 * @param content - Content to search for similar memories
 * @param containerTag - Container tag to restrict the search
 * @returns Array of similar memories with similarity scores
 */
const findSimilarMemories = (
  db: Database,
  content: string,
  containerTag: string,
  excludeMemoryId?: string
): SimilarMemory[] => {
  const words = content
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 20);

  if (words.length === 0) return [];

  // Use FTS5 if available, otherwise simple LIKE query
  const hasFTS = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
    .get() as { name: string } | undefined;

  let results: SimilarMemory[] = [];

  if (hasFTS) {
    const query = words
      .map((word) => {
        // Strip FTS5 metacharacters and reserved words to prevent injection
        const clean = word.replace(/[*^:\-+?()]/g, "").replace(/\b(NEAR|AND|OR|NOT)\b/gi, "");
        return clean ? `"${clean.replaceAll('"', '""')}"` : "";
      })
      .filter(Boolean)
      .join(" OR ");
    try {
      const rows = db
        .prepare(
          `
          SELECT m.id, m.content, m.is_deprecated
          FROM memories_fts fts
          JOIN memories m ON fts.rowid = m.rowid
          WHERE memories_fts MATCH ? AND m.container_tag = ? AND m.is_deprecated = 0
          LIMIT 20
        `
        )
        .all(query, containerTag) as SimilarMemoryRow[];

      results = rows.map((row) => ({
        id: row.id,
        content: row.content,
        similarity: 0.5,
        is_deprecated: row.is_deprecated || 0,
      }));
    } catch {
      // FTS query failed, fall through to LIKE
    }
  }

  if (results.length === 0) {
    // Fallback: LIKE query with word overlap scoring
    const likePatterns = words.slice(0, 5).map((word) => `%${word}%`);
    const placeholders = likePatterns.map(() => "content LIKE ?").join(" OR ");

    const idClause = excludeMemoryId ? "AND id != ?" : "";
    const rows = db
      .prepare(
        `
        SELECT id, content, is_deprecated
        FROM memories
        WHERE container_tag = ? AND is_deprecated = 0
        AND (${placeholders})
        ${idClause}
        LIMIT 20
      `
      )
      .all(
        containerTag,
        ...likePatterns,
        ...(excludeMemoryId ? [excludeMemoryId] : [])
      ) as SimilarMemoryRow[];

    results = rows.map((row) => {
      const rowWords = row.content
        .toLowerCase()
        .split(/\s+/)
        .filter((word: string) => word.length > 3);
      const common = words.filter((word) => rowWords.includes(word)).length;
      const similarity = common / Math.max(words.length, rowWords.length);

      return {
        id: row.id,
        content: row.content,
        similarity,
        is_deprecated: row.is_deprecated || 0,
      };
    });
  }

  // Filter by similarity threshold
  return results
    .filter((result) => result.similarity > 0.3)
    .sort((left, right) => right.similarity - left.similarity);
};

/**
 * Check if a conflict between two memory IDs already exists in the database.
 * Looks for the conflict in either direction (memory1 vs memory2 or vice versa).
 *
 * @param db - SQLite database handle
 * @param memoryId1 - First memory ID
 * @param memoryId2 - Second memory ID
 * @returns The existing conflict record, or null if not found
 */
const findExistingConflict = (
  db: Database,
  memoryId1: string,
  memoryId2: string
): MemoryConflict | null => {
  const row = db
    .prepare(
      `
      SELECT * FROM memory_conflicts
      WHERE (memory_id_1 = ? AND memory_id_2 = ?)
         OR (memory_id_1 = ? AND memory_id_2 = ?)
      LIMIT 1
    `
    )
    .get(memoryId1, memoryId2, memoryId2, memoryId1) as ConflictRow | undefined;

  if (!row) return null;

  return mapDbRowToConflict(row);
};

/**
 * Persist a detected conflict to the database.
 *
 * @param db - SQLite database handle
 * @param conflict - The conflict record to save
 */
const saveConflict = (db: Database, conflict: MemoryConflict): void => {
  db.prepare(
    `
    INSERT INTO memory_conflicts (
      id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved, resolution_type, resolved_at, resolution_data, container_tag
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    conflict.id,
    conflict.memoryId1,
    conflict.memoryId2,
    conflict.similarityScore,
    conflict.detectedAt,
    conflict.resolved,
    conflict.resolutionType || null,
    conflict.resolvedAt || null,
    conflict.resolutionData || null,
    conflict.containerTag || null
  );
};

// Resolution strategies
/**
 * Resolve a conflict using one of four strategies:
 * - `keep_newer`: Deprecate the older memory, keep the newer
 * - `keep_both`: Mark as complementary, no changes to memories
 * - `merge`: Create a new merged memory, deprecate both originals
 * - `manual`: Flag for user review without automatic action
 *
 * @param conflictId - ID of the conflict to resolve
 * @param strategy - Resolution strategy to apply
 * @param mergedContent - Required when using the `merge` strategy
 * @returns Object indicating success and optionally the merged memory ID
 */
// NOSONAR S3776: Conflict resolution requires strategy-specific branching (keep_newer, keep_both,
// merge, manual), database transactions, and vector index updates — complexity is inherent to the domain.
export const resolveConflict = async (
  conflictId: string,
  strategy: "keep_newer" | "keep_both" | "merge" | "manual",
  mergedContent?: string
): Promise<{ success: boolean; error?: string; mergedMemoryId?: string }> => {
  try {
    // First, find the conflict in any shard to read its container_tag
    let conflictRow: ConflictRow | null = null;
    let conflictDb: Database | null = null;
    const searchShards = getAllShards();

    for (const shard of searchShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db
        .prepare("SELECT * FROM memory_conflicts WHERE id = ?")
        .get(conflictId) as ConflictRow | null;
      if (row) {
        conflictRow = row;
        conflictDb = db;
        break;
      }
    }

    if (!conflictRow || !conflictDb) {
      return { success: false, error: "Conflict not found" };
    }

    const containerTag = conflictRow.container_tag || "mem_user_";
    const { scope, hash } = extractScopeFromContainerTag(containerTag);
    const targetShards = shardManager.getAllShards(scope, hash);

    for (const shard of targetShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db.prepare("SELECT * FROM memory_conflicts WHERE id = ?").get(conflictId) as
        | ConflictRow
        | undefined;

      if (!row) continue;

      const conflict = mapDbRowToConflict(row);

      if (conflict.resolved === 1) {
        return { success: false, error: "Conflict already resolved" };
      }

      const now = Date.now();

      let mergedMemoryId: string | undefined;

      switch (strategy) {
        case "keep_newer": {
          // Get both memories, deprecate older
          const mem1 = db
            .prepare("SELECT id, created_at FROM memories WHERE id = ?")
            .get(conflict.memoryId1) as { id: string; created_at: number } | undefined;
          const mem2 = db
            .prepare("SELECT id, created_at FROM memories WHERE id = ?")
            .get(conflict.memoryId2) as { id: string; created_at: number } | undefined;

          if (!mem1 || !mem2) {
            return { success: false, error: "One or both memories not found" };
          }

          // R2: on created_at ties, keep the newly-added memory (memoryId1) —
          // deprecating mem1 on ties would deprecate the NEWER row.
          const olderId = mem1.created_at >= mem2.created_at ? mem2.id : mem1.id;
          db.prepare("UPDATE memories SET is_deprecated = 1 WHERE id = ?").run(olderId);
          break;
        }
        case "keep_both": {
          // Just mark as complementary - no action needed
          break;
        }
        case "merge": {
          if (!mergedContent) {
            return { success: false, error: "mergedContent required for merge strategy" };
          }

          // Create merged memory, deprecate both originals
          const mem1 = db
            .prepare("SELECT * FROM memories WHERE id = ?")
            .get(conflict.memoryId1) as any;
          const mem2 = db
            .prepare("SELECT * FROM memories WHERE id = ?")
            .get(conflict.memoryId2) as any;
          if (!mem1 || !mem2) {
            return { success: false, error: "One or both original memories not found" };
          }

          // R3: idempotent merge — if a merged memory for this pair already
          // exists (e.g. a previous attempt crashed after insertVector but
          // before the conflict-record UPDATE), reuse it instead of inserting
          // a duplicate. Full atomicity would require threading an outer
          // transaction through insertVector; deferred — idempotent retry
          // covers the practical failure.
          const existingMerged = db
            .prepare(
              `
              SELECT id FROM memories
              WHERE metadata LIKE '%"mergedFrom"%'
                AND metadata LIKE '%' || ? || '%'
                AND metadata LIKE '%' || ? || '%'
              LIMIT 1
            `
            )
            .get(conflict.memoryId1, conflict.memoryId2) as { id: string } | undefined;

          if (existingMerged?.id) {
            mergedMemoryId = existingMerged.id;
            conflict.resolutionData = JSON.stringify({ mergedMemoryId: existingMerged.id });
            log("Conflict merge: reused existing merged memory", {
              conflictId,
              mergedMemoryId: existingMerged.id,
            });
            break;
          }

          // Re-embed merged content so vector matches content (P0-2 fix)
          const mergedVector = await embeddingService.embed(mergedContent);

          const mergedId = `mem_${Date.now()}_${randomBytes(5).toString("hex")}`;
          await vectorSearch.insertVector(
            db,
            {
              id: mergedId,
              content: mergedContent,
              vector: mergedVector,
              tagsVector: mem1.tags_vector ? decodeVector(mem1.tags_vector) : undefined,
              containerTag: mem1.container_tag,
              tags: mem1.tags,
              type: mem1.type,
              createdAt: now,
              updatedAt: now,
              metadata: JSON.stringify({
                mergedFrom: [conflict.memoryId1, conflict.memoryId2],
                originalType: mem1.type,
              }),
              displayName: mem1.display_name,
              userName: mem1.user_name,
              userEmail: mem1.user_email,
              projectPath: mem1.project_path,
              projectName: mem1.project_name,
              gitRepoUrl: mem1.git_repo_url,
              recencyScore: mem1.recency_score ?? 0.5,
              frequencyScore: mem1.frequency_score ?? 0,
              importanceScore: mem1.importance_score ?? 0.5,
              utilityScore: mem1.utility_score ?? 0.3,
              noveltyScore: mem1.novelty_score ?? 0.5,
              confidenceScore: mem1.confidence_score ?? 0.7,
              interferencePenalty: mem1.interference_penalty ?? 0,
              strength: mem1.strength ?? 0.5,
              accessCount: mem1.access_count ?? 0,
              lastAccessed: mem1.last_accessed ?? null,
              storeType: mem1.store_type ?? "ltm",
              decayRate: mem1.decay_rate ?? 0.05,
            },
            shard
          );

          db.prepare("UPDATE memories SET is_deprecated = 1 WHERE id IN (?, ?)").run(
            conflict.memoryId1,
            conflict.memoryId2
          );

          // Update conflict with merged memory info
          mergedMemoryId = mergedId;
          conflict.resolutionData = JSON.stringify({ mergedMemoryId: mergedId });
          break; // fall through to the shared conflict-record UPDATE below
        }
        case "manual": {
          // Just flag for user review - update conflict record
          break;
        }
        default:
          return { success: false, error: `Unknown resolution strategy: ${strategy}` };
      }

      // Update conflict record
      db.prepare(
        `
        UPDATE memory_conflicts
        SET resolved = 1, resolution_type = ?, resolved_at = ?, resolution_data = ?
        WHERE id = ?
      `
      ).run(strategy, now, conflict.resolutionData || null, conflictId);

      log("Conflict resolved", { conflictId, strategy });
      return { success: true, mergedMemoryId };
    }

    return { success: false, error: "Conflict not found" };
  } catch (error) {
    const msg = String(error);
    log("resolveConflict: error", { conflictId, strategy, error: msg });
    return { success: false, error: msg };
  }
};

/**
 * Record a conflict between a newly inserted memory and an existing one
 * directly, bypassing the FTS-based rediscovery in {@link detectConflicts}.
 * Used when ingest-dedup already identified the pair (R1): the dedup
 * similarity (cosine) is more truthful than the FTS score, and recording
 * here guarantees the pair becomes a conflict even if FTS would miss it.
 * The existing-pair guard (findExistingConflict) dedupes in both orders.
 *
 * @returns true if a conflict row was inserted, false if the pair already
 * had a conflict recorded.
 */
// skipcq: JS-0116 — fully synchronous by design (no awaits before saveConflict);
// async keyword kept so the public Promise<boolean> signature is unchanged.
export const recordConflictPair = async (args: {
  newMemoryId: string;
  existingMemoryId: string;
  similarityScore: number;
  containerTag: string;
  sessionId?: string;
}): Promise<boolean> => {
  const { newMemoryId, existingMemoryId, similarityScore, containerTag } = args;
  // Safety: fully synchronous by design (no awaits before saveConflict) — the
  // caller serializes the write under withShardWriteLock; the shard[0] lookup
  // here is only a read, so lock correctness never depends on this function.
  try {
    const { scope, hash } = extractScopeFromContainerTag(containerTag);
    const shards = shardManager.getAllShards(scope, hash);
    const shard = shards[0];
    if (!shard) return false;

    const db = connectionManager.getConnection(shard.dbPath);
    if (findExistingConflict(db, newMemoryId, existingMemoryId)) return false;

    const conflict: MemoryConflict = {
      id: `conflict_${Date.now()}_${randomBytes(4).toString("hex")}`,
      memoryId1: newMemoryId,
      memoryId2: existingMemoryId,
      similarityScore,
      detectedAt: Date.now(),
      resolved: 0,
      containerTag,
    };
    saveConflict(db, conflict);
    log("Conflict recorded (direct pair from ingest dedup)", {
      conflictId: conflict.id,
      memoryId1: newMemoryId,
      memoryId2: existingMemoryId,
      similarity: similarityScore,
    });
    return true;
  } catch (error) {
    log("recordConflictPair: error", { error: String(error) });
    return false;
  }
};

/**
 * Retrieve conflicts from a single database shard.
 *
 * @param db - SQLite database handle
 * @param resolved - If true, return resolved conflicts; otherwise unresolved
 * @param limit - Maximum number of conflicts to return
 * @returns Array of conflicts with optional memory content previews
 */
export const getConflicts = (
  db: Database,
  resolved: boolean = false,
  limit: number = 100
): (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] => {
  const rows = db
    .prepare(
      `
      SELECT c.*, m1.content as m1_content, m2.content as m2_content
      FROM memory_conflicts c
      LEFT JOIN memories m1 ON c.memory_id_1 = m1.id
      LEFT JOIN memories m2 ON c.memory_id_2 = m2.id
      WHERE c.resolved = ?
      ORDER BY c.detected_at DESC
      LIMIT ?
    `
    )
    .all(resolved ? 1 : 0, limit) as ConflictRow[];

  return rows.map((row) => ({
    ...mapDbRowToConflict(row),
    memory1Content: row.m1_content,
    memory2Content: row.m2_content,
  }));
};

/**
 * Retrieve all conflicts (resolved or unresolved) across every shard in the system.
 *
 * @param resolved - If true, return resolved conflicts; otherwise unresolved
 * @param limit - Maximum total number of conflicts to return
 * @returns Array of conflicts sorted by detection time (newest first)
 */
export const getAllConflicts = (
  resolved: boolean,
  limit: number = 1000
): (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] => {
  const allConflicts: (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] =
    [];
  const shards = getAllShards();

  for (const shard of shards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const conflicts = getConflicts(db, resolved, limit);
    allConflicts.push(...conflicts);
  }

  return allConflicts.toSorted((left, right) => right.detectedAt - left.detectedAt).slice(0, limit);
};

/**
 * Retrieve all unresolved conflicts across every shard in the system.
 * Thin wrapper over {@link getAllConflicts} kept for API compatibility.
 */
export const getAllUnresolvedConflicts = (
  limit: number = 1000
): (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] => {
  return getAllConflicts(false, limit);
};
