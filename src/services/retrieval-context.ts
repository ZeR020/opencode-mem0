import { CONFIG } from "../config.js";
import { TECHNICAL_KEYWORDS } from "./utils/text-analysis.js";

export interface RetrievalContext {
  projectPath?: string;
  projectName?: string;
  recentFiles?: string[];
  recentQueries?: string[];
  currentQuery?: string;
}

export interface QueryIntent {
  intent: "troubleshooting" | "recall" | "exploration" | "implementation" | "general";
  topics: string[];
  isTechnical: boolean;
  requiresCode: boolean;
}

const TROUBLESHOOTING_KEYWORDS = [
  "fix",
  "bug",
  "error",
  "broken",
  "issue",
  "problem",
  "fail",
  "crash",
];
const RECALL_KEYWORDS = ["what", "did", "decide", "remember", "last time", "previously"];
const IMPLEMENTATION_KEYWORDS = ["implement", "create", "add", "build", "write", "code"];
const EXPLORATION_KEYWORDS = ["explore", "try", "experiment", "test", "options"];

const STOP_WORDS = new Set([
  "the",
  "and",
  "how",
  "what",
  "did",
  "about",
  "for",
  "with",
  "from",
  "this",
  "that",
  "have",
  "has",
  "been",
  "are",
  "was",
  "were",
  "is",
  "be",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "a",
  "an",
  "as",
  "or",
  "if",
  "it",
  "its",
  "do",
  "does",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
]);

/**
 * Analyze a user query to determine intent, topics, and technical requirements.
 * Uses fast keyword heuristics (<1ms, no LLM calls).
 *
 * @param query - The user's raw query string
 * @returns QueryIntent classification
 */
export function analyzeQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();
  let intent: QueryIntent["intent"] = "general";

  if (TROUBLESHOOTING_KEYWORDS.some((k) => lower.includes(k))) {
    intent = "troubleshooting";
  } else if (RECALL_KEYWORDS.some((k) => lower.includes(k))) {
    intent = "recall";
  } else if (IMPLEMENTATION_KEYWORDS.some((k) => lower.includes(k))) {
    intent = "implementation";
  } else if (EXPLORATION_KEYWORDS.some((k) => lower.includes(k))) {
    intent = "exploration";
  }

  const words = lower.split(/[^a-z0-9_]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  const topics = [...new Set(words)];

  const isTechnical = TECHNICAL_KEYWORDS.some((k) => lower.includes(k));
  const requiresCode =
    lower.includes("```") ||
    (IMPLEMENTATION_KEYWORDS.some((k) => lower.includes(k)) &&
      (lower.includes("function") || lower.includes("class") || lower.includes("code")));

  return { intent, topics, isTechnical, requiresCode };
}

interface ScorableMemory {
  memory?: string;
  chunk?: string;
  similarity?: number;
  finalScore?: number;
  tags?: string[];
  type?: string;
}

/**
 * Score a memory's relevance to a query intent.
 *
 * Boosts for topic overlap and type-intent alignment.
 * Penalizes for technical/code mismatches.
 * Returns a score in [0, 1].
 *
 * @param memory - Memory result from search
 * @param intent - Analyzed query intent
 * @returns Relevance score in [0, 1]
 */
// NOSONAR S3776: Multi-factor relevance scoring (topic overlap, type-intent alignment,
// technical/code mismatch penalties) is inherently complex — each factor is domain-specific.
export function scoreMemoryRelevance(memory: ScorableMemory, intent: QueryIntent): number {
  const base = memory.finalScore ?? memory.similarity ?? 0.5;
  let score = base;

  // Topic match boost: 1.2x per matching topic, capped at 1.5x total
  if (intent.topics.length > 0) {
    const contentLower = (memory.memory || memory.chunk || "").toLowerCase();
    const tagsSet = new Set((memory.tags || []).map((t) => t.toLowerCase()));
    let matchCount = 0;
    for (const topic of intent.topics) {
      if (contentLower.includes(topic) || tagsSet.has(topic)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const boost = Math.min(1.2 * matchCount, 1.5);
      score *= boost;
    }
  }

  // Type-intent alignment boost
  const memoryType = (memory.type || "").toLowerCase();
  if (
    (intent.intent === "troubleshooting" && (memoryType === "bug" || memoryType === "error")) ||
    (intent.intent === "recall" && (memoryType === "decision" || memoryType === "preference")) ||
    (intent.intent === "implementation" && (memoryType === "guide" || memoryType === "tutorial"))
  ) {
    score *= 1.3;
  }

  // Technical mismatch penalty
  if (intent.isTechnical && (memoryType === "greeting" || memoryType === "casual")) {
    score *= 0.7;
  }

  // Code mismatch penalty
  if (intent.requiresCode) {
    const content = memory.memory || memory.chunk || "";
    if (!content.includes("```")) {
      score *= 0.8;
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate a context-based score boost for a memory result.
 * Boosts scores when the memory's project path, project name, or metadata
 * references match the current retrieval context (recent files, queries).
 *
 * @param result - Memory result with project and metadata info
 * @param context - Current retrieval context
 * @returns Multiplicative boost factor (>= 1.0)
 */
// skipcq: JS-0067
export function calculateContextBoost(
  result: {
    projectPath?: string;
    projectName?: string;
    metadata?: Record<string, unknown>;
  },
  context: RetrievalContext
) {
  const boost = CONFIG.retrieval.contextBoost || 1.5;
  let score = 1;

  // Project path match
  if (context.projectPath && result.projectPath) {
    if (result.projectPath === context.projectPath) {
      score *= boost;
    } else if (
      result.projectPath.startsWith(context.projectPath) ||
      context.projectPath.startsWith(result.projectPath)
    ) {
      score *= Math.sqrt(boost);
    }
  }

  // Project name match
  if (context.projectName && result.projectName) {
    if (result.projectName === context.projectName) {
      score *= boost;
    }
  }

  // Check metadata for file references
  const recentFiles = context.recentFiles;
  if (result.metadata && recentFiles && recentFiles.length > 0) {
    const metadataStr = JSON.stringify(result.metadata).toLowerCase();
    for (const file of recentFiles) {
      if (metadataStr.includes(file.toLowerCase())) {
        score *= Math.sqrt(boost);
        break;
      }
    }
  }

  return score;
}

/**
 * Calculate a diversity penalty for a candidate memory based on Jaccard similarity
 * with already-selected memories. If similarity exceeds the threshold, a proportional
 * penalty is applied to discourage redundant results.
 *
 * @param content - Candidate memory content
 * @param selectedContents - Already selected memory contents
 * @param threshold - Jaccard similarity threshold (default 0.9 from config)
 * @returns Penalty value in [0, 1] range
 */
export function calculateDiversityPenalty(
  content: string,
  selectedContents: string[],
  threshold: number
): number {
  if (!content || selectedContents.length === 0) return 0;

  const contentWords = new Set(
    content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );
  if (contentWords.size === 0) return 0;

  let maxSimilarity = 0;
  for (const selected of selectedContents) {
    if (!selected) continue;

    const selectedWords = new Set(
      selected
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
    );
    if (selectedWords.size === 0) continue;

    let intersectionSize = 0;
    for (const w of contentWords) {
      if (selectedWords.has(w)) intersectionSize++;
    }
    const unionSize = contentWords.size + selectedWords.size - intersectionSize;
    const sim = unionSize > 0 ? intersectionSize / unionSize : 0;

    if (sim > maxSimilarity) {
      maxSimilarity = sim;
    }
  }

  if (threshold >= 1) return 0;
  if (maxSimilarity > threshold) {
    // Apply penalty proportional to how much over threshold
    return (maxSimilarity - threshold) / (1 - threshold);
  }

  return 0;
}
