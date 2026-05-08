import { CONFIG } from "../config.js";
import { getUserProfileContext } from "./user-profile/profile-context.js";
import { analyzeQueryIntent, scoreMemoryRelevance, type QueryIntent } from "./retrieval-context.js";

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
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      return `<memory similarity="${(result.similarity || 0).toFixed(2)}" relevance="${relevance.toFixed(2)}" type="${result.type || "note"}">${safeContent}</memory>`;
    }
    case "yaml": {
      const indentedContent = content
        .split("\n")
        .map((line) => "    " + line)
        .join("\n");
      return `- similarity: ${(result.similarity || 0).toFixed(2)}\n  relevance: ${relevance.toFixed(2)}\n  type: ${result.type || "note"}\n  content: |\n${indentedContent}`;
    }
    case "plain":
    default:
      return `- [${similarity}%] ${content}`;
  }
}

export function formatContextForPrompt(
  userId: string | null,
  projectMemories: MemoriesResponseMinimal,
  options?: FormatOptions
): string {
  const tokenBudget = options?.tokenBudget ?? (CONFIG as any).injection?.tokenBudget ?? 4000;
  const format = options?.format ?? (CONFIG as any).injection?.format ?? "plain";
  const query = options?.query;

  // 1. Analyze query if provided
  let scoredMemories: Array<{ result: MemoryResultMinimal; relevance: number }> = [];
  if (query) {
    const intent = analyzeQueryIntent(query);
    scoredMemories = (projectMemories.results || []).map((m) => ({
      result: m,
      relevance: scoreMemoryRelevance(m, intent),
    }));
    scoredMemories.sort((a, b) => b.relevance - a.relevance);
    // Filter below threshold
    const threshold = (CONFIG as any).injection?.relevanceThreshold ?? 0.3;
    scoredMemories = scoredMemories.filter((m) => m.relevance >= threshold);
  } else {
    scoredMemories = (projectMemories.results || []).map((m) => ({
      result: m,
      relevance: m.similarity || 0,
    }));
  }

  // 2. Build output with token budget
  let usedTokens = 0;
  const parts: string[] = [];
  const header = "[MEMORY]";
  usedTokens += estimateTokens(header);
  parts.push(header);

  if (CONFIG.injectProfile && userId) {
    const profileContext = getUserProfileContext(userId);
    if (profileContext) {
      const profileTokens = estimateTokens(profileContext);
      if (usedTokens + profileTokens < tokenBudget || tokenBudget === 0) {
        usedTokens += profileTokens;
        parts.push("\n" + profileContext);
      }
    }
  }

  const sectionHeader = "\nProject Knowledge:";
  const sectionTokens = estimateTokens(sectionHeader);
  let sectionAdded = false;

  for (const { result, relevance } of scoredMemories) {
    const formatted = formatMemoryEntry(result, relevance, format);
    const entryTokens = estimateTokens(formatted);
    // Account for section header cost on first memory addition
    const overhead = sectionAdded ? 0 : sectionTokens;
    if (tokenBudget !== 0 && usedTokens + overhead + entryTokens > tokenBudget) {
      continue; // Skip this memory — would exceed budget
    }
    if (!sectionAdded) {
      usedTokens += sectionTokens;
      parts.push(sectionHeader);
      sectionAdded = true;
    }
    usedTokens += entryTokens;
    parts.push(formatted);
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}
// audit: src/services/context.ts
