import { getDatabase } from "./sqlite/sqlite-bootstrap.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import type { MemoryConflict } from "./sqlite/types.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

let isConflictCheckRunning = false;

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
  const prompt = `Do these two statements contradict each other? A: '${memory1.replace(/'/g, "\\'")}' B: '${memory2.replace(/'/g, "\\'")}' Answer only YES or NO`;

  try {
    // Opencode provider path
    if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
      const { isProviderConnected, getStatePath, generateStructuredOutput } =
        await import("./ai/opencode-provider.js");

      if (isProviderConnected(CONFIG.opencodeProvider)) {
        const { z } = await import("zod");
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
          temperature: 0.0,
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
  const negationPatterns = [
    /not\s+/i,
    /never\s+/i,
    /no\s+/i,
    /disable/i,
    /remove/i,
    /delete/i,
    /false/i,
    /deprecated/i,
    /obsolete/i,
  ];

  const aWords = a
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const bWords = b
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const aHasNegation = negationPatterns.some((p) => p.test(a));
  const bHasNegation = negationPatterns.some((p) => p.test(b));

  // If one has negation and other doesn't, check for key concept overlap
  if (aHasNegation !== bHasNegation) {
    const commonWords = aWords.filter((w) => bWords.includes(w));
    const uniqueRatio = commonWords.length / Math.max(aWords.length, bWords.length);
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
export async function detectConflicts(
  newMemoryId: string,
  newMemoryContent: string,
  containerTag: string,
  sessionID?: string
): Promise<MemoryConflict[]> {
  if (isConflictCheckRunning) {
    log("detectConflicts: skipping, another check is running");
    return [];
  }
  isConflictCheckRunning = true;

  try {
    const { scope, hash } = extractScopeFromContainerTag(containerTag);
    const shards = shardManager.getAllShards(scope, hash);

    if (shards.length === 0) return [];

    const conflicts: MemoryConflict[] = [];

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);

      // Search for similar memories using text search first (cheaper than vector)
      const similarMemories = findSimilarMemories(db, newMemoryContent, containerTag);

      for (const candidate of similarMemories) {
        if (candidate.id === newMemoryId) continue;
        if (candidate.is_deprecated) continue;

        // Check if conflict already recorded
        const existingConflict = findExistingConflict(db, newMemoryId, candidate.id);
        if (existingConflict) continue;

        // LLM-based contradiction check
        const isContradiction = await checkContradictionWithLLM(
          newMemoryContent,
          candidate.content,
          sessionID
        );

        if (isContradiction) {
          const conflictId = `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const conflict: MemoryConflict = {
            id: conflictId,
            memoryId1: newMemoryId,
            memoryId2: candidate.id,
            similarityScore: candidate.similarity,
            detectedAt: Date.now(),
            resolved: 0,
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
    isConflictCheckRunning = false;
  }
}

/**
 * Extract scope and hash from a container tag string.
 * Container tags follow the format `mem_<scope>_<hash>`.
 *
 * @param containerTag - The container tag to parse
 * @returns Object with scope ('user' or 'project') and hash
 */
function extractScopeFromContainerTag(containerTag: string): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1] as "user" | "project";
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: "user", hash: containerTag };
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
  db: DatabaseType,
  content: string,
  containerTag: string
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
    const query = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" OR ");
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

    const rows = db
      .prepare(
        `
        SELECT id, content, is_deprecated
        FROM memories
        WHERE container_tag = ? AND is_deprecated = 0
        AND (${placeholders})
        AND id != ?
        LIMIT 20
      `
      )
      .all(containerTag, ...likePatterns, `mem_${Date.now()}`) as any[];

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
  db: DatabaseType,
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

  return {
    id: row.id,
    memoryId1: row.memory_id_1,
    memoryId2: row.memory_id_2,
    similarityScore: row.similarity_score,
    detectedAt: row.detected_at,
    resolved: row.resolved,
    resolutionType: row.resolution_type,
    resolvedAt: row.resolved_at,
    resolutionData: row.resolution_data,
  };
}

/**
 * Persist a detected conflict to the database.
 *
 * @param db - SQLite database handle
 * @param conflict - The conflict record to save
 */
function saveConflict(db: DatabaseType, conflict: MemoryConflict): void {
  db.prepare(
    `
    INSERT INTO memory_conflicts (
      id, memory_id_1, memory_id_2, similarity_score, detected_at, resolved, resolution_type, resolved_at, resolution_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    conflict.resolutionData || null
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
export async function resolveConflict(
  conflictId: string,
  strategy: "keep_newer" | "keep_both" | "merge" | "manual",
  mergedContent?: string
): Promise<{ success: boolean; error?: string; mergedMemoryId?: string }> {
  try {
    const { scope, hash } = extractScopeFromContainerTag("mem_user_"); // We'll search all shards
    const shards = [
      ...shardManager.getAllShards("user", ""),
      ...shardManager.getAllShards("project", hash),
    ];

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db.prepare("SELECT * FROM memory_conflicts WHERE id = ?").get(conflictId) as any;

      if (!row) continue;

      const conflict: MemoryConflict = {
        id: row.id,
        memoryId1: row.memory_id_1,
        memoryId2: row.memory_id_2,
        similarityScore: row.similarity_score,
        detectedAt: row.detected_at,
        resolved: row.resolved,
        resolutionType: row.resolution_type,
        resolvedAt: row.resolved_at,
        resolutionData: row.resolution_data,
      };

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

          const mergedId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          db.prepare(
            `
            INSERT INTO memories (
              id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
              metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url,
              recency_score, frequency_score, importance_score, utility_score, novelty_score,
              confidence_score, interference_penalty, strength, access_count, last_accessed,
              store_type, decay_rate, is_deprecated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          ).run(
            mergedId,
            mergedContent,
            mem1.vector,
            mem1.tags_vector,
            mem1.container_tag,
            mem1.tags,
            mem1.type,
            now,
            now,
            JSON.stringify({
              mergedFrom: [conflict.memoryId1, conflict.memoryId2],
              originalType: mem1.type,
            }),
            mem1.display_name,
            mem1.user_name,
            mem1.user_email,
            mem1.project_path,
            mem1.project_name,
            mem1.git_repo_url,
            mem1.recency_score || 0.5,
            mem1.frequency_score || 0,
            mem1.importance_score || 0.5,
            mem1.utility_score || 0.3,
            mem1.novelty_score || 0.5,
            mem1.confidence_score || 0.7,
            mem1.interference_penalty || 0,
            mem1.strength || 0.5,
            mem1.access_count || 0,
            mem1.last_accessed || null,
            mem1.store_type || "ltm",
            mem1.decay_rate || 0.05,
            0
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
  db: DatabaseType,
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
    id: r.id,
    memoryId1: r.memory_id_1,
    memoryId2: r.memory_id_2,
    similarityScore: r.similarity_score,
    detectedAt: r.detected_at,
    resolved: r.resolved,
    resolutionType: r.resolution_type,
    resolvedAt: r.resolved_at,
    resolutionData: r.resolution_data,
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
  const shards = [
    ...shardManager.getAllShards("user", ""),
    ...shardManager.getAllShards("project", ""),
  ];

  for (const shard of shards) {
    const db = connectionManager.getConnection(shard.dbPath);
    const conflicts = getConflicts(db, false, limit);
    allConflicts.push(...conflicts);
  }

  return allConflicts.sort((a, b) => b.detectedAt - a.detectedAt).slice(0, limit);
}
