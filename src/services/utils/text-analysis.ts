/**
 * Shared text analysis utilities for memory processing.
 *
 * Provides canonical word tokenization and shared keyword/pattern arrays
 * used across memory-scoring, retrieval-context, and memory-conflicts modules.
 */

// ---------------------------------------------------------------------------
// Technical Keywords — merged from memory-scoring.ts (167 entries)
// and retrieval-context.ts (27 entries), deduplicated.
// ---------------------------------------------------------------------------
export const TECHNICAL_KEYWORDS: string[] = [
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
  // --- Additional entries from retrieval-context.ts (not present in memory-scoring.ts) ---
  "code",
  "program",
  "software",
  "module",
  "library",
  "framework",
  "service",
  "caching",
  "network",
  "protocol",
];

// ---------------------------------------------------------------------------
// Negation Patterns — merged from memory-scoring.ts (5 word-boundary patterns)
// and memory-conflicts.ts (9 simpler patterns). Prefer word-boundary versions
// and extend with missing keywords (disable, deprecated, obsolete).
// ---------------------------------------------------------------------------
export const NEGATION_PATTERNS: RegExp[] = [
  // Pattern 1: Common negation words (word-boundary, replaces mc #1-3)
  /\b(not|no|never|none|nothing|nobody|nowhere|neither|nor)\b/i,
  // Pattern 2: Contracted negations
  /\b(don't|doesn't|didn't|won't|wouldn't|shouldn't|couldn't|can't|cannot)\b/i,
  // Pattern 3: Removal/negation action words (extends ms pattern with mc #4,8,9)
  /\b(removed|deleted|reverted|undone|cancelled|canceled|disabled|disable|deprecated|obsolete|turned off)\b/i,
  // Pattern 4: Negative prefixes
  /\b(un|dis|mis|non)[a-z]+\b/i,
  // Pattern 5: False/error states
  /\b(false|incorrect|wrong|invalid|failed|error)\b/i,
];

// ---------------------------------------------------------------------------
// Token splitter — splits on sequences of characters that are NOT
// lowercase letters, digits, or underscores. Lowercases all output.
// ---------------------------------------------------------------------------
const TOKEN_SPLIT_RE = /[^a-z0-9_]+/;

export interface TokenizeOptions {
  /** Minimum token length (inclusive). Default 1. */
  minLength?: number;
  /** Words to exclude from results. */
  stopWords?: Set<string>;
}

/**
 * Canonical word tokenizer. Lowercases the input, splits on non-alphanumeric
 * characters, filters by minimum length, and optionally removes stop words.
 */
export function tokenizeWords(text: string, options: TokenizeOptions = {}): string[] {
  const { minLength = 1, stopWords } = options;
  const lower = text.toLowerCase().trim();
  if (!lower) return [];

  const tokens = lower.split(TOKEN_SPLIT_RE).filter((t) => t.length >= minLength);

  if (stopWords && stopWords.size > 0) {
    return tokens.filter((t) => !stopWords.has(t));
  }

  return tokens;
}

/**
 * Convenience wrapper: returns a Set of words with minimum length 4.
 * Used by conflict detection for Jaccard-similarity comparisons.
 */
export function getWordSet(text: string): Set<string> {
  return new Set(tokenizeWords(text, { minLength: 4 }));
}

/**
 * Jaccard similarity coefficient: |A ∩ B| / |A ∪ B|.
 * Returns 0 when the union is empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}
