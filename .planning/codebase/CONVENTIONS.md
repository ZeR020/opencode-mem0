# Coding Conventions

**Analysis Date:** 2026-05-07

## Language & Tooling

- **TypeScript** with `strict: true`, ESM modules (`"type": "module"`), and `verbatimModuleSyntax: true`
- **Runtime targets:** Bun >=1.0.0, Node.js >=20.0.0 (fallback)
- **Formatter:** Prettier (`v3.8.3`) — config in `.prettierrc`
- **Linter:** No ESLint or Biome configuration detected. Code quality relies on TypeScript strictness and Prettier formatting.
- **Git hooks:** Husky (`^9.1.7`) with `lint-staged` runs `prettier --write` on `*.{ts,tsx,js,jsx,css,html,json,md}`

## Prettier Settings

Key settings from `.prettierrc`:
- `semi: true`
- `singleQuote: false` (use double quotes)
- `tabWidth: 2`
- `useTabs: false`
- `printWidth: 100`
- `trailingComma: "es5"`
- `arrowParens: "always"`
- `endOfLine: "lf"`

**Run formatting:**
```bash
bun run format          # Write
bun run format:check    # Check only
```

## Naming Patterns

**Files & directories:**
- Source files: kebab-case (`memory-scoring.ts`, `anthropic-messages.ts`)
- Directories: kebab-case or lowercase (`user-profile/`, `vector-backends/`, `sqlite/`)
- Test files: kebab-case with `.test.ts` suffix (`memory-engine.test.ts`, `privacy.test.ts`)

**Code identifiers:**
- **Classes:** PascalCase (`LocalMemoryClient`, `VectorSearch`, `UserProfileManager`, `AISessionManager`)
- **Interfaces / Types:** PascalCase (`ScoreComponents`, `MemoryRecord`, `ShardInfo`)
- **Functions:** camelCase, descriptive (`calculateRecency`, `stripPrivateContent`, `safeToISOString`)
- **Variables:** camelCase, prefer `const`
- **Module-level constants:** UPPER_SNAKE_CASE (`DEFAULT_WEIGHTS`, `TECHNICAL_KEYWORDS`, `MAX_LOG_SIZE`, `AI_SESSIONS_DB_NAME`)
- **Private members:** `private` or `private readonly` (`private readonly dbPath: string`)
- **Type aliases:** PascalCase (`MemoryScope`, `VectorKind`)

## Import Organization

**Order (observed consistently):**
1. Node.js built-ins with `node:` prefix (`node:fs`, `node:crypto`, `node:os`, `node:path`)
2. External packages (`@opencode-ai/plugin`, `ai`, `zod`)
3. Internal relative imports (`../config.js`, `./logger.js`, `../sqlite/types.js`)

**Key rules:**
- Always use `node:` prefix for built-in modules.
- Always append `.js` to relative imports, even for `.ts` files (`import { log } from "./logger.js"`).
- Use `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`).
- No barrel files detected — import directly from the defining file.

## Error Handling

**Primary pattern (used throughout services):**
```typescript
try {
  // operation
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log("operation: error", { error: errorMessage });
  return { success: false as const, error: errorMessage };
}
```

**Guidelines:**
- Wrap service operations in `try/catch`.
- Normalize errors to string messages.
- Return structured results with `success: boolean` and optional `error: string`.
- Log errors via the custom `log()` utility (`src/services/logger.js`) rather than `console.error`.
- Use `as const` on literal boolean returns (`success: true as const`).

## Logging

**Framework:** Custom file logger in `src/services/logger.js`

**Pattern:**
```typescript
log("message describing operation", { key: value });
```

- Logs are written to `~/.opencode-mem0/opencode-mem0.log` (or `OPENCODE_MEM_LOG_FILE`).
- Automatic log rotation at 5 MB.
- Secrets redaction: keys matching `/token|secret|password|api[-_]?key|authorization/i` are replaced with `"[REDACTED]"`.
- Session start markers are written on first log call.

## Comments & Documentation

**When to comment:**
- JSDoc blocks for exported utility functions, especially those with parameters or non-obvious math.
- Inline comments for complex regex, performance optimizations, or workarounds.
- Section dividers in large files (`// ─── Memory Scoring ─────────────────────────────────`).

**JSDoc style (observed):**
```typescript
/**
 * Calculate recency score using exponential decay.
 * Score = exp(-λ * age_in_days)
 * λ = ln(2) / half_life_days (default half-life = 7 days)
 */
export function calculateRecency(createdAt: number, halfLifeDays: number = 7): number {
```

## Function & Module Design

**Function size:** Small to medium. Utility functions are typically <50 lines. Class methods may be longer when handling SQL or async orchestration.

**Parameters:**
- Prefer destructured options objects for complex parameter sets (e.g., `calculateAllScores(options: { createdAt, accessCount, ... })`).
- Default values used extensively for config fields.

**Return values:**
- Prefer returning structured objects over throwing when the failure is expected (`{ success, error, results }`).
- Throw only for unrecoverable / programming errors.

**Module exports:**
- Named exports preferred over default exports.
- Singleton instances exported as constants (`export const memoryClient = new LocalMemoryClient()`).

**Global state guards:**
- Use `Symbol.for("opencode-mem0.*")` on `globalThis` to prevent double-binding or re-initialization in multi-load scenarios (`src/index.ts`, `src/services/logger.js`).

## TypeScript Patterns

- `as const` is used frequently to narrow literal return types.
- `any` is used sparingly, mainly in plugin context objects and test mocks.
- `noUnusedLocals: false` and `noUnusedParameters: false` are set in `tsconfig.json` — unused variables do not fail the build.
- `noUncheckedIndexedAccess: true` is enabled — array/object indexing may require `undefined` checks.

---

*Convention analysis: 2026-05-07*
