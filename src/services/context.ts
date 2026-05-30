import { CONFIG } from "../config.js";
import { getUserProfileContext } from "./user-profile/profile-context.js";
import { analyzeQueryIntent, scoreMemoryRelevance } from "./retrieval-context.js";

const injectionConfig = CONFIG.injection ?? {};

export interface MemoryResultMinimal {
  id?: string;
  similarity: number;
  memory?: string;
  chunk?: string;
  type?: string;
  tags?: string[];
}

interface MemoriesResponseMinimal {
  results?: MemoryResultMinimal[];
}

export interface FormatOptions {
  query?: string;
  tokenBudget?: number;
  format?: "plain" | "xml" | "yaml";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format a single memory entry according to the specified output format.
 *
 * @param result - Memory result
 * @param relevance - Computed relevance score
 * @param format - Output format (plain, xml, yaml)
 * @returns Formatted string
 */
export function formatMemoryEntry(
  result: MemoryResultMinimal,
  relevance: number,
  format: "plain" | "xml" | "yaml" = "plain"
): string {
  const content = result.memory || result.chunk || "";
  const similarity = Math.round((result.similarity || 0) * 100);

  switch (format) {
    case "xml": {
      const safeContent = content
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
      return `<memory similarity="${(result.similarity || 0).toFixed(2)}" relevance="${relevance.toFixed(2)}" type="${result.type || "note"}">${safeContent}</memory>`;
    }
    case "yaml": {
      const indentedContent = content
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      return `- similarity: ${(result.similarity || 0).toFixed(2)}\n  relevance: ${relevance.toFixed(2)}\n  type: ${result.type || "note"}\n  content: |\n${indentedContent}`;
    }
    case "plain":
    default:
      return `- [${similarity}%] ${content}`;
  }
}

function scoreMemoriesForQuery(
  memories: MemoryResultMinimal[],
  query: string | undefined
): Array<{ result: MemoryResultMinimal; relevance: number }> {
  if (!query) {
    return memories.map((m) => ({ result: m, relevance: m.similarity || 0 }));
  }

  const intent = analyzeQueryIntent(query);
  const scored = memories.map((m) => ({
    result: m,
    relevance: scoreMemoryRelevance(m, intent),
  }));
  scored.sort((a, b) => b.relevance - a.relevance);

  const threshold = injectionConfig.relevanceThreshold ?? 0.3;
  return scored.filter((m) => m.relevance >= threshold);
}

function buildContextParts(
  scoredMemories: Array<{ result: MemoryResultMinimal; relevance: number }>,
  userId: string | null,
  format: "plain" | "xml" | "yaml",
  tokenBudget: number
): string[] {
  const parts: string[] = [];
  let usedTokens = 0;

  const header = "[MEMORY]";
  usedTokens += estimateTokens(header);
  parts.push(header);

  if (CONFIG.injectProfile && userId) {
    const profileContext = getUserProfileContext(userId);
    if (profileContext) {
      const profileTokens = estimateTokens(profileContext);
      if (usedTokens + profileTokens < tokenBudget || tokenBudget === 0) {
        usedTokens += profileTokens;
        parts.push(`\n${profileContext}`);
      }
    }
  }

  const sectionHeader = "\nProject Knowledge:";
  const sectionTokens = estimateTokens(sectionHeader);
  let sectionAdded = false;

  for (const { result, relevance } of scoredMemories) {
    const formatted = formatMemoryEntry(result, relevance, format);
    const entryTokens = estimateTokens(formatted);
    const overhead = sectionAdded ? 0 : sectionTokens;
    if (tokenBudget !== 0 && usedTokens + overhead + entryTokens > tokenBudget) {
      continue;
    }
    if (!sectionAdded) {
      usedTokens += sectionTokens;
      parts.push(sectionHeader);
      sectionAdded = true;
    }
    usedTokens += entryTokens;
    parts.push(formatted);
  }

  return parts;
}

export function formatContextForPrompt(
  userId: string | null,
  projectMemories: MemoriesResponseMinimal,
  options?: FormatOptions
): string {
  const tokenBudget = options?.tokenBudget ?? injectionConfig.tokenBudget ?? 4000;
  const format = options?.format ?? injectionConfig.format ?? "plain";
  const query = options?.query;

  const memories = projectMemories.results || [];
  const scoredMemories = scoreMemoriesForQuery(memories, query);
  const parts = buildContextParts(scoredMemories, userId, format, tokenBudget);

  if (parts.length <= 1) {
    return "";
  }

  return parts.join("\n");
}
