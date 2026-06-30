import { type Database } from "./sqlite/sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { connectionManager } from "./sqlite/connection-manager.js";
import {
  shardManager,
  getAllShards,
  extractScopeFromContainerTag,
} from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { embeddingService } from "./embedding.js";
import { z } from "zod";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import type { MemoryConflict } from "./sqlite/types.js";
import { NEGATION_PATTERNS, getWordSet } from "./utils/text-analysis.js";
import { mapDbRowToConflict } from "./utils/memory-mapper.js";

// ponytail: module-level Set, single consumer in detectConflicts. Per-key locks if contention matters.
const conflictChecksRunning = new Set<string>();

/**
 * Check if two memory statements contradict each other using an LLM.
 * Falls back to a heuristic-based check if the LLM is unavailable.
 *
 * @param memory1 - Content of the first memory
 * @param memory2 - Content of the second memory
 * @param sessionID - Optional session ID for provider routing
 * @returns true if the statements are logically incompatible
 */
async function checkContradictionWithLLM(
  memory1: string,
  memory2: string,
  sessionID?: string
): Promise<boolean> {
  const prompt = `Do these two statements contradict each other? A: ${JSON.stringify(memory1)} B: ${JSON.stringify(memory2)} Answer only YES or NO`;

  try {
    // Opencode provider path
    if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
      const { isProviderConnected, getStatePath, generateStructuredOutput } =
        await import("./ai/opencode-provider.js");

      if (isProviderConnected(CONFIG.opencodeProvider)) {
        const schema = z.object({
          contradicts: z.enum(["YES", "NO"]),
        });

        const result = await generateStructuredOutput({
          providerName: CONFIG.opencodeProvider,
          modelId: CONFIG.opencodeModel,
          statePath: getStatePath(),
          systemPrompt:
            "You are a precise contradiction detector. Analyze two statements and answer ONLY YES or NO. Be strict: only answer YES if the statements are logically incompatible.",
          userPrompt: prompt,
          schema,
          temperature: 0,
        });

        return result.contradicts === "YES";
      }
    }

    // Manual config path
    if (CONFIG.memoryModel && CONFIG.memoryApiUrl) {
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

      const result = await provider.executeToolCall(
        "You are a precise contradiction detector. Analyze two statements and answer ONLY YES or NO. Be strict: only answer YES if the statements are logically incompatible.",
        prompt,
        toolSchema,
        sessionID || "conflict-check"
      );

      if (result.success && result.data) {
        return result.data.contradicts === "YES";
      }
    }
  } catch (error) {
    log("checkContradictionWithLLM: LLM check failed, falling back to heuristic", {
      error: String(error),
    });
  }

  // Fallback heuristic: check for explicit negation patterns
  return checkContradictionHeuristic(memory1, memory2);
}

/**
 * Heuristic contradiction detection using negation patterns and keyword overlap.
 * Used as a fallback when LLM-based detection is unavailable.
 *
 * @param a - First memory content
 * @param b - Second memory content
 * @returns true if a likely contradiction is detected
 */
function checkContradictionHeuristic(a: string, b: string): boolean {
  const aWordSet = getWordSet(a);
  const bWordSet = getWordSet(b);

  const aHasNegation = NEGATION_PATTERNS.some((p) => p.test(a));
  const bHasNegation = NEGATION_PATTERNS.some((p) => p.test(b));

  // If one has negation and other doesn't, check for key concept overlap
  if (aHasNegation !== bHasNegation) {
    const commonWords = [...aWordSet].filter((w) => bWordSet.has(w));
    const uniqueRatio = commonWords.length / Math.max(aWordSet.size, bWordSet.size);
    return uniqueRatio > 0.3;
  }

  return false;
}

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
export async function detectConflicts(
  newMemoryId: string,
  newMemoryContent: string,
  containerTag: string,
  sessionID?: string
): Promise<MemoryConflict[]> {
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
}

interface SimilarMemory {
  id: string;
  content: string;
  similarity: number;
  is_deprecated: number;
}

/**
 * Find memories similar to the given content within the same container.
 * Uses FTS5 full-text search when available, falling back to LIKE queries.
 *
 * @param db - SQLite database handle
 * @param content - Content to search for similar memories
 * @param containerTag - Container tag to restrict the search
 * @returns Array of similar memories with similarity scores
 */
function findSimilarMemories(
  db: Database,
  content: string,
  containerTag: string,
  excludeMemoryId?: string
): SimilarMemory[] {
  const words = content
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 20);

  if (words.length === 0) return [];

  // Use FTS5 if available, otherwise simple LIKE query
  const hasFTS = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
    .get() as any;

  let results: SimilarMemory[] = [];

  if (hasFTS) {
    const query = words
      .map((w) => {
        // Strip FTS5 metacharacters and reserved words to prevent injection
        const clean = w.replace(/[*^:\-+?()]/g, "").replace(/\b(NEAR|AND|OR|NOT)\b/gi, "");
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
        .all(query, containerTag) as any[];

      results = rows.map((r) => ({
        id: r.id,
        content: r.content,
        similarity: 0.5,
        is_deprecated: r.is_deprecated || 0,
      }));
    } catch {
      // FTS query failed, fall through to LIKE
    }
  }

  if (results.length === 0) {
    // Fallback: LIKE query with word overlap scoring
    const likePatterns = words.slice(0, 5).map((w) => `%${w}%`);
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
      .all(containerTag, ...likePatterns, ...(excludeMemoryId ? [excludeMemoryId] : [])) as any[];

    results = rows.map((r) => {
      const rWords = r.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 3);
      const common = words.filter((w) => rWords.includes(w)).length;
      const similarity = common / Math.max(words.length, rWords.length);

      return {
        id: r.id,
        content: r.content,
        similarity,
        is_deprecated: r.is_deprecated || 0,
      };
    });
  }

  // Filter by similarity threshold
  return results.filter((r) => r.similarity > 0.3).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if a conflict between two memory IDs already exists in the database.
 * Looks for the conflict in either direction (memory1 vs memory2 or vice versa).
 *
 * @param db - SQLite database handle
 * @param memoryId1 - First memory ID
 * @param memoryId2 - Second memory ID
 * @returns The existing conflict record, or null if not found
 */
function findExistingConflict(
  db: Database,
  memoryId1: string,
  memoryId2: string
): MemoryConflict | null {
  const row = db
    .prepare(
      `
      SELECT * FROM memory_conflicts
      WHERE (memory_id_1 = ? AND memory_id_2 = ?)
         OR (memory_id_1 = ? AND memory_id_2 = ?)
      LIMIT 1
    `
    )
    .get(memoryId1, memoryId2, memoryId2, memoryId1) as any;

  if (!row) return null;

  return mapDbRowToConflict(row);
}

/**
 * Persist a detected conflict to the database.
 *
 * @param db - SQLite database handle
 * @param conflict - The conflict record to save
 */
function saveConflict(db: Database, conflict: MemoryConflict): void {
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
}

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
export async function resolveConflict(
  conflictId: string,
  strategy: "keep_newer" | "keep_both" | "merge" | "manual",
  mergedContent?: string
): Promise<{ success: boolean; error?: string; mergedMemoryId?: string }> {
  try {
    // First, find the conflict in any shard to read its container_tag
    let conflictRow: any = null;
    let conflictDb: Database | null = null;
    const searchShards = getAllShards();

    for (const shard of searchShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db.prepare("SELECT * FROM memory_conflicts WHERE id = ?").get(conflictId) as any;
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
      const row = db.prepare("SELECT * FROM memory_conflicts WHERE id = ?").get(conflictId) as any;

      if (!row) continue;

      const conflict = mapDbRowToConflict(row);

      const now = Date.now();

      switch (strategy) {
        case "keep_newer": {
          // Get both memories, deprecate older
          const mem1 = db
            .prepare("SELECT id, created_at FROM memories WHERE id = ?")
            .get(conflict.memoryId1) as any;
          const mem2 = db
            .prepare("SELECT id, created_at FROM memories WHERE id = ?")
            .get(conflict.memoryId2) as any;

          if (!mem1 || !mem2) {
            return { success: false, error: "One or both memories not found" };
          }

          const olderId = mem1.created_at > mem2.created_at ? mem2.id : mem1.id;
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
          if (!mem1) {
            return { success: false, error: "Original memory not found" };
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
              tagsVector: mem1.tags_vector,
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
              recencyScore: mem1.recency_score || 0.5,
              frequencyScore: mem1.frequency_score || 0,
              importanceScore: mem1.importance_score || 0.5,
              utilityScore: mem1.utility_score || 0.3,
              noveltyScore: mem1.novelty_score || 0.5,
              confidenceScore: mem1.confidence_score || 0.7,
              interferencePenalty: mem1.interference_penalty || 0,
              strength: mem1.strength || 0.5,
              accessCount: mem1.access_count || 0,
              lastAccessed: mem1.last_accessed || null,
              storeType: mem1.store_type || "ltm",
              decayRate: mem1.decay_rate || 0.05,
            },
            shard
          );

          db.prepare("UPDATE memories SET is_deprecated = 1 WHERE id IN (?, ?)").run(
            conflict.memoryId1,
            conflict.memoryId2
          );

          // Update conflict with merged memory info
          conflict.resolutionData = JSON.stringify({ mergedMemoryId: mergedId });

          return { success: true, mergedMemoryId: mergedId };
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
      return { success: true };
    }

    return { success: false, error: "Conflict not found" };
  } catch (error) {
    const msg = String(error);
    log("resolveConflict: error", { conflictId, strategy, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Retrieve conflicts from a single database shard.
 *
 * @param db - SQLite database handle
 * @param resolved - If true, return resolved conflicts; otherwise unresolved
 * @param limit - Maximum number of conflicts to return
 * @returns Array of conflicts with optional memory content previews
 */
export function getConflicts(
  db: Database,
  resolved: boolean = false,
  limit: number = 100
): (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] {
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
    .all(resolved ? 1 : 0, limit) as any[];

  return rows.map((r) => ({
    ...mapDbRowToConflict(r),
    memory1Content: r.m1_content,
    memory2Content: r.m2_content,
  }));
}

/**
 * Retrieve all unresolved conflicts across every shard in the system.
 *
 * @param limit - Maximum total number of conflicts to return
 * @returns Array of unresolved conflicts sorted by detection time (newest first)
 */
export function getAllUnresolvedConflicts(
  limit: number = 1000
): (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] {
  const allConflicts: (MemoryConflict & { memory1Content?: string; memory2Content?: string })[] =
    [];
  const shards = getAllShards();

  for (const shard of shards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const conflicts = getConflicts(db, false, limit);
    allConflicts.push(...conflicts);
  }

  return allConflicts.toSorted((a, b) => b.detectedAt - a.detectedAt).slice(0, limit);
}
