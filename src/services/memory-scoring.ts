import { log } from "./logger.js";

export interface ScoreComponents {
  recency: number;
  frequency: number;
  importance: number;
  utility: number;
  novelty: number;
  confidence: number;
  interference: number;
}

export interface MemoryScoringWeights {
  recency: number;
  frequency: number;
  importance: number;
  utility: number;
  novelty: number;
  confidence: number;
  interference: number;
}

const DEFAULT_WEIGHTS: MemoryScoringWeights = {
  recency: 0.2,
  frequency: 0.15,
  importance: 0.25,
  utility: 0.2,
  novelty: 0.1,
  confidence: 0.1,
  interference: -0.1,
};

// Technical keywords that indicate high-importance memories
const TECHNICAL_KEYWORDS = [
  "function",
  "class",
  "interface",
  "type",
  "import",
  "export",
  "const",
  "let",
  "async",
  "await",
  "promise",
  "error",
  "bug",
  "fix",
  "refactor",
  "implement",
  "feature",
  "test",
  "build",
  "deploy",
  "api",
  "database",
  "schema",
  "migration",
  "query",
  "endpoint",
  "route",
  "middleware",
  "component",
  "hook",
  "state",
  "props",
  "context",
  "reducer",
  "action",
  "dispatch",
  "store",
  "config",
  "setting",
  "environment",
  "variable",
  "docker",
  "container",
  "kubernetes",
  "k8s",
  "ci",
  "cd",
  "pipeline",
  "github",
  "git",
  "commit",
  "branch",
  "merge",
  "pull",
  "request",
  "review",
  "lint",
  "format",
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "sql",
  "json",
  "yaml",
  "xml",
  "html",
  "css",
  "scss",
  "webpack",
  "vite",
  "esbuild",
  "rollup",
  "babel",
  "eslint",
  "prettier",
  "jest",
  "vitest",
  "cypress",
  "playwright",
  "unit",
  "integration",
  "e2e",
  "performance",
  "optimization",
  "cache",
  "memory",
  "leak",
  "race",
  "condition",
  "deadlock",
  "concurrent",
  "thread",
  "process",
  "worker",
  "event",
  "listener",
  "callback",
  "handler",
  "middleware",
  "auth",
  "authentication",
  "authorization",
  "permission",
  "role",
  "token",
  "jwt",
  "oauth",
  "session",
  "cookie",
  "csrf",
  "xss",
  "sql injection",
  "security",
  "vulnerability",
  "encrypt",
  "hash",
  "salt",
  "certificate",
  "ssl",
  "tls",
  "https",
  "proxy",
  "load",
  "balancer",
  "nginx",
  "apache",
  "server",
  "client",
  "frontend",
  "backend",
  "fullstack",
  "rest",
  "graphql",
  "grpc",
  "websocket",
  "sse",
  "event sourcing",
  "cqrs",
  "microservice",
  "monolith",
  "architecture",
  "pattern",
  "singleton",
  "factory",
  "observer",
  "strategy",
  "decorator",
  "dependency injection",
  "ioc",
  "orm",
  "odm",
  "prisma",
  "typeorm",
  "sequelize",
  "mongoose",
  "mongodb",
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "elastic",
  "s3",
  "blob",
  "storage",
];

// Negation patterns for interference detection
const NEGATION_PATTERNS = [
  /\b(not|no|never|none|nothing|nobody|nowhere|neither|nor)\b/gi,
  /\b(don't|doesn't|didn't|won't|wouldn't|shouldn't|couldn't|can't|cannot)\b/gi,
  /\b(removed|deleted|reverted|undone|cancelled|canceled|disabled|turned off)\b/gi,
  /\b(un|dis|mis|non)[a-z]+\b/gi,
  /\b(false|incorrect|wrong|invalid|failed|error)\b/gi,
];

// Positive/action patterns
const ACTION_PATTERNS = [
  /\b(added|created|implemented|built|developed|wrote|wrote|configured|enabled|fixed|resolved|solved)\b/gi,
  /\b(true|correct|valid|success|working|active|enabled|on)\b/gi,
];

/**
 * Calculate recency score using exponential decay.
 * Score = exp(-λ * age_in_days)
 * λ = ln(2) / half_life_days (default half-life = 7 days)
 */
export function calculateRecency(
  createdAt: number,
  halfLifeDays: number = 7
): number {
  const now = Date.now();
  const ageMs = now - createdAt;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays < 0) return 1.0;

  const lambda = Math.log(2) / halfLifeDays;
  const score = Math.exp(-lambda * ageDays);

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate frequency score using log scale.
 * Score = log(1 + accessCount) / log(1 + maxExpectedAccesses)
 * Max expected accesses = 100 (normalized to 1.0)
 */
export function calculateFrequency(accessCount: number): number {
  const maxExpected = 100;
  const score = Math.log(1 + accessCount) / Math.log(1 + maxExpected);
  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate importance based on content analysis.
 * Factors: code blocks, technical keywords, length, type.
 */
export function calculateImportance(
  content: string,
  type?: string
): number {
  let score = 0.5; // Base score

  const lowerContent = content.toLowerCase();

  // Code blocks boost importance
  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  score += Math.min(codeBlockCount * 0.15, 0.3);

  // Technical keywords boost importance
  let keywordMatches = 0;
  for (const keyword of TECHNICAL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = lowerContent.match(regex);
    if (matches) {
      keywordMatches += matches.length;
    }
  }
  score += Math.min(keywordMatches * 0.02, 0.2);

  // Length factor: moderate length preferred
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) {
    score -= 0.1; // Too short
  } else if (wordCount > 500) {
    score += 0.05; // Comprehensive
  } else if (wordCount > 50 && wordCount < 300) {
    score += 0.1; // Sweet spot
  }

  // Type-based importance
  const highImportanceTypes = ["bug-fix", "feature", "refactor", "architecture", "decision"];
  const mediumImportanceTypes = ["analysis", "configuration", "optimization", "security"];
  const lowImportanceTypes = ["greeting", "chat", "casual", "meta"];

  if (type && highImportanceTypes.some((t) => type.toLowerCase().includes(t))) {
    score += 0.15;
  } else if (type && mediumImportanceTypes.some((t) => type.toLowerCase().includes(t))) {
    score += 0.05;
  } else if (type && lowImportanceTypes.some((t) => type.toLowerCase().includes(t))) {
    score -= 0.1;
  }

  // File paths and specific identifiers indicate high importance
  const hasFilePaths = /[\w-]+\.[a-zA-Z]{2,5}/.test(content);
  if (hasFilePaths) score += 0.05;

  const hasSpecificIdentifiers = /\b[A-Z_]+\b/.test(content);
  if (hasSpecificIdentifiers) score += 0.03;

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate utility based on how recently the memory was accessed.
 * Similar to recency but applied to last_accessed instead of created_at.
 */
export function calculateUtility(
  lastAccessed: number | null,
  halfLifeDays: number = 3
): number {
  if (!lastAccessed) return 0.3; // Default for never accessed

  const now = Date.now();
  const ageMs = now - lastAccessed;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays < 0) return 1.0;

  const lambda = Math.log(2) / halfLifeDays;
  const score = Math.exp(-lambda * ageDays);

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate novelty based on how unique the content is compared to existing memories.
 * Uses simple word overlap and length similarity.
 * Lower overlap = higher novelty.
 */
export function calculateNovelty(
  content: string,
  existingContents: string[]
): number {
  if (existingContents.length === 0) return 1.0; // First memory is fully novel

  const contentWords = new Set(
    content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  );

  if (contentWords.size === 0) return 0.5;

  let maxSimilarity = 0;

  for (const existing of existingContents.slice(0, 20)) {
    // Sample at most 20 existing memories for performance
    const existingWords = new Set(
      existing.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );

    if (existingWords.size === 0) continue;

    const intersection = new Set([...contentWords].filter((w) => existingWords.has(w)));
    const union = new Set([...contentWords, ...existingWords]);

    const jaccardSimilarity = intersection.size / union.size;
    maxSimilarity = Math.max(maxSimilarity, jaccardSimilarity);

    // Length similarity
    const lengthRatio =
      Math.min(content.length, existing.length) /
      Math.max(content.length, existing.length);
    maxSimilarity = Math.max(maxSimilarity, lengthRatio * 0.5);
  }

  // Novelty = 1 - similarity (with floor to avoid 0)
  const novelty = Math.max(0.1, 1 - maxSimilarity);
  return novelty;
}

/**
 * Calculate confidence based on source and extraction method.
 * Manual memories have higher confidence than auto-captured ones.
 */
export function calculateConfidence(
  source?: string,
  type?: string
): number {
  let score = 0.7; // Base confidence

  // Source-based confidence
  if (source === "manual") {
    score += 0.2;
  } else if (source === "auto-capture") {
    score += 0.05;
  } else if (source === "api") {
    score += 0.1;
  } else if (source === "import") {
    score += 0.0;
  }

  // Type-based confidence adjustments
  const highConfidenceTypes = ["decision", "architecture", "configuration", "security"];
  const lowConfidenceTypes = ["greeting", "chat", "casual", "meta", "question"];

  if (type && highConfidenceTypes.some((t) => type.toLowerCase().includes(t))) {
    score += 0.05;
  } else if (type && lowConfidenceTypes.some((t) => type.toLowerCase().includes(t))) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate interference penalty based on contradictions with other memories.
 * Detects negation patterns and conflicting action descriptions.
 */
export function calculateInterference(
  content: string,
  conflictingMemories: string[]
): number {
  if (conflictingMemories.length === 0) return 0;

  const lowerContent = content.toLowerCase();

  // Check if this memory contains negation patterns
  let hasNegation = false;
  for (const pattern of NEGATION_PATTERNS) {
    if (pattern.test(lowerContent)) {
      hasNegation = true;
      break;
    }
  }

  // Check if this memory contains action patterns
  let hasAction = false;
  for (const pattern of ACTION_PATTERNS) {
    if (pattern.test(lowerContent)) {
      hasAction = true;
      break;
    }
  }

  let conflictScore = 0;

  for (const conflicting of conflictingMemories.slice(0, 10)) {
    // Sample at most 10 conflicts for performance
    const lowerConflicting = conflicting.toLowerCase();

    // Check for direct contradiction patterns
    // One says "added X" and another says "removed X" or "don't use X"
    const contentHasAdd = /\b(added|created|implemented|enabled|turned on)\b/i.test(content);
    const contentHasRemove = /\b(removed|deleted|disabled|turned off|reverted)\b/i.test(content);
    const conflictingHasAdd = /\b(added|created|implemented|enabled|turned on)\b/i.test(conflicting);
    const conflictingHasRemove = /\b(removed|deleted|disabled|turned off|reverted)\b/i.test(conflicting);

    if ((contentHasAdd && conflictingHasRemove) || (contentHasRemove && conflictingHasAdd)) {
      conflictScore += 0.3;
    }

    // Check for negation of the same topic
    if (hasNegation) {
      const contentCore = content
        .replace(/\b(not|no|never|none|don't|doesn't|didn't|won't|shouldn't|couldn't|can't|removed|deleted|disabled)\b/gi, "")
        .trim();
      const conflictingCore = conflicting
        .replace(/\b(not|no|never|none|don't|doesn't|didn't|won't|shouldn't|couldn't|can't|removed|deleted|disabled)\b/gi, "")
        .trim();

      // Simple overlap check
      const contentWords = new Set(contentCore.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
      const conflictingWords = new Set(conflictingCore.toLowerCase().split(/\s+/).filter((w) => w.length > 4));

      if (contentWords.size > 0 && conflictingWords.size > 0) {
        const intersection = new Set([...contentWords].filter((w) => conflictingWords.has(w)));
        const overlapRatio = intersection.size / Math.min(contentWords.size, conflictingWords.size);

        if (overlapRatio > 0.3) {
          conflictScore += 0.2;
        }
      }
    }

    // Similar content but opposite sentiment
    if (hasAction && hasNegation) {
      const contentActionWords = lowerContent.match(/\b(added|created|implemented|built|fixed|resolved|enabled|configured)\b/g) || [];
      const conflictingActionWords = lowerConflicting.match(/\b(added|created|implemented|built|fixed|resolved|enabled|configured)\b/g) || [];

      const commonActions = contentActionWords.filter((a) =>
        conflictingActionWords.some((ca) => ca.toLowerCase() === a.toLowerCase())
      );

      if (commonActions.length > 0) {
        conflictScore += 0.15;
      }
    }
  }

  return Math.min(1, conflictScore);
}

/**
 * Compute overall strength as a weighted sum of all score components.
 * Weights: [0.2, 0.15, 0.25, 0.2, 0.1, 0.1, -0.1]
 */
export function computeStrength(
  scores: ScoreComponents,
  weights: MemoryScoringWeights = DEFAULT_WEIGHTS
): number {
  const rawStrength =
    scores.recency * weights.recency +
    scores.frequency * weights.frequency +
    scores.importance * weights.importance +
    scores.utility * weights.utility +
    scores.novelty * weights.novelty +
    scores.confidence * weights.confidence -
    scores.interference * Math.abs(weights.interference);

  // Normalize to [0, 1] range
  // Max possible: 0.2 + 0.15 + 0.25 + 0.2 + 0.1 + 0.1 = 1.0 (interference subtracts)
  // Min possible: 0 - 0.1 = -0.1
  const normalized = (rawStrength + 0.1) / 1.1;

  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate all scores for a memory in one call.
 */
export function calculateAllScores(options: {
  createdAt: number;
  accessCount: number;
  lastAccessed: number | null;
  content: string;
  existingContents: string[];
  conflictingMemories: string[];
  source?: string;
  type?: string;
  halfLifeDays?: number;
  utilityHalfLifeDays?: number;
}): ScoreComponents & { strength: number } {
  const scores: ScoreComponents = {
    recency: calculateRecency(options.createdAt, options.halfLifeDays),
    frequency: calculateFrequency(options.accessCount),
    importance: calculateImportance(options.content, options.type),
    utility: calculateUtility(options.lastAccessed, options.utilityHalfLifeDays),
    novelty: calculateNovelty(options.content, options.existingContents),
    confidence: calculateConfidence(options.source, options.type),
    interference: calculateInterference(options.content, options.conflictingMemories),
  };

  const strength = computeStrength(scores);

  return { ...scores, strength };
}

/**
 * Increment access count and update last_accessed timestamp.
 * Returns updated access count.
 */
export function recordAccess(currentAccessCount: number): {
  accessCount: number;
  lastAccessed: number;
} {
  return {
    accessCount: currentAccessCount + 1,
    lastAccessed: Date.now(),
  };
}
