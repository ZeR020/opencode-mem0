import { CONFIG } from "../config.js";

export interface RetrievalContext {
  projectPath?: string;
  projectName?: string;
  recentFiles?: string[];
  recentQueries?: string[];
  currentQuery?: string;
}

// Simple context tracker that stores recent queries and files
class ContextTracker {
  private recentQueries: string[] = [];
  private recentFiles: string[] = [];
  private maxHistory = 10;

  addQuery(query: string) {
    this.recentQueries.push(query);
    if (this.recentQueries.length > this.maxHistory) {
      this.recentQueries.shift();
    }
  }

  addFiles(files: string[]) {
    this.recentFiles.push(...files);
    if (this.recentFiles.length > this.maxHistory) {
      this.recentFiles = this.recentFiles.slice(-this.maxHistory);
    }
  }

  getContext(projectPath?: string, projectName?: string): RetrievalContext {
    return {
      projectPath,
      projectName,
      recentFiles: [...this.recentFiles],
      recentQueries: [...this.recentQueries],
      currentQuery: this.recentQueries[this.recentQueries.length - 1],
    };
  }

  clear() {
    this.recentQueries = [];
    this.recentFiles = [];
  }
}

export const contextTracker = new ContextTracker();

/**
 * Calculate a context-based score boost for a memory result.
 * Boosts scores when the memory's project path, project name, or metadata
 * references match the current retrieval context (recent files, queries).
 *
 * @param result - Memory result with project and metadata info
 * @param context - Current retrieval context
 * @returns Multiplicative boost factor (>= 1.0)
 */
export function calculateContextBoost(
  result: {
    projectPath?: string;
    projectName?: string;
    metadata?: Record<string, unknown>;
  },
  context: RetrievalContext
): number {
  const boost = CONFIG.retrieval.contextBoost || 1.5;
  let score = 1.0;

  // Project path match
  if (context.projectPath && result.projectPath) {
    if (result.projectPath === context.projectPath) {
      score *= boost;
    } else if (result.projectPath.startsWith(context.projectPath) ||
               context.projectPath.startsWith(result.projectPath)) {
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
  if (result.metadata && context.recentFiles && context.recentFiles.length > 0) {
    const metadataStr = JSON.stringify(result.metadata).toLowerCase();
    for (const file of context.recentFiles) {
      if (metadataStr.includes(file.toLowerCase())) {
        score *= Math.sqrt(boost);
        break;
      }
    }
  }

  // Query relevance - check if memory content contains words from recent queries
  if (context.recentQueries && context.recentQueries.length > 0) {
    const queryWords = context.recentQueries
      .join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    // This is checked at a higher level where we have access to content
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

  const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  if (contentWords.size === 0) return 0;

  let maxSimilarity = 0;
  for (const selected of selectedContents) {
    if (!selected) continue;
    
    const selectedWords = new Set(selected.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    if (selectedWords.size === 0) continue;
    
    const intersection = [...contentWords].filter(w => selectedWords.has(w));
    const union = new Set([...contentWords, ...selectedWords]);
    const sim = union.size > 0 ? intersection.length / union.size : 0;
    
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
    }
  }

  if (maxSimilarity > threshold) {
    // Apply penalty proportional to how much over threshold
    return (maxSimilarity - threshold) / (1 - threshold);
  }

  return 0;
}
