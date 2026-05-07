# Testing Patterns

**Analysis Date:** 2026-05-07

## Test Framework

**Runner:**
- Vitest `^3.2.4`
- Config: `vitest.config.ts`

**Key config settings:**
```typescript
export default defineConfig({
  test: {
    globals: false,        // Must import describe/it/expect/vi explicitly
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

**Run commands:**
```bash
bun test              # Run all tests (vitest run)
npm test              # Node.js fallback (vitest run)
bun run test:bun      # Same command, Bun runtime
```

## Test File Organization

**Location:**
- All tests live under `tests/` (not co-located with source).
- Subdirectories group related domain tests: `tests/vector-backends/`.

**Naming:**
- `tests/{feature}.test.ts` — e.g., `tests/privacy.test.ts`, `tests/memory-engine.test.ts`
- `tests/{domain}/{component}.test.ts` — e.g., `tests/vector-backends/usearch-backend.test.ts`

**Full test inventory:**
- `tests/ai-provider-config.test.ts`
- `tests/anthropic-provider.test.ts`
- `tests/config-resolution.test.ts`
- `tests/config.test.ts`
- `tests/language-detector.test.ts`
- `tests/memory-engine.test.ts`
- `tests/memory-scope.test.ts`
- `tests/openai-chat-completion-provider.test.ts`
- `tests/opencode-provider.test.ts`
- `tests/plugin-loader-contract.test.ts`
- `tests/privacy.test.ts`
- `tests/profile-tool-runtime.test.ts`
- `tests/profile-write.test.ts`
- `tests/project-scope.test.ts`
- `tests/tags.test.ts`
- `tests/tool-scope.test.ts`
- `tests/vector-backends/backend-factory.test.ts`
- `tests/vector-backends/exact-scan-backend.test.ts`
- `tests/vector-backends/migration-fallback.test.ts`
- `tests/vector-backends/usearch-backend.test.ts`
- `tests/vector-search-backend-integration.test.ts`
- `tests/windows-path.test.ts`

## Test Structure

**Suite organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("feature name", () => {
  beforeEach(() => { /* reset shared state */ });
  afterEach(() => { /* cleanup temp dirs / close DBs */ });

  it("does something specific", () => {
    expect(actual).toBe(expected);
  });
});
```

**Common patterns observed:**
- Group related tests under nested `describe` blocks (e.g., `describe("transcript storage", () => { ... })` inside `describe("Memory Engine Integration", () => { ... })`).
- Use `beforeEach` to reset module-level mock state (Maps, arrays) and clear databases.
- Use `afterEach` to remove temporary directories and close SQLite connections.

## Mocking

**Framework:** Vitest built-in (`vi.mock`, `vi.fn`, `vi.spyOn`, `vi.clearAllMocks`, `vi.restoreAllMocks`)

**Module-level mocking pattern (most common):**
```typescript
vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 2, 3]),
  },
}));
```

**Partial mock with `importOriginal`:**
```typescript
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => /* mock */,
    readFileSync: (...args: unknown[]) => /* mock */,
  };
});
```

**Dynamic mock state (for config resolution tests):**
- Mock variables are declared at module scope.
- `globalThis` properties hold mutable mock state that tests update between runs.
- This pattern is required because `vi.mock` hoisting prevents referencing local variables directly inside the factory in some cases.

**Global fetch mocking (for API provider tests):**
```typescript
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("captures request body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return { ok: false, status: 400, statusText: "Bad Request", text: async () => "err" } as Response;
  }) as typeof fetch;

  // ... execute provider
  expect(capturedBody?.max_tokens).toBeDefined();
});
```

**What to mock:**
- `logger.js` — silenced in nearly every test.
- `embedding.js` — deterministic `Float32Array` returns to avoid model loading.
- `sqlite/connection-manager.js`, `sqlite/shard-manager.js`, `sqlite/vector-search.js` — in-memory fake DBs for unit tests.
- `node:fs` — for config resolution tests.
- External HTTP APIs via `globalThis.fetch`.

**What NOT to mock (integration tests):**
- `getDatabase()` from `sqlite-bootstrap.js` is used directly for real SQLite in `vector-backends/` and `vector-search-backend-integration.test.ts`.
- `ExactScanBackend` and `USearchBackend` are tested against real temporary SQLite databases.

## Fixtures and Factories

**No separate fixture files** — test data is created inline or via helper functions.

**Common factory patterns:**

`makeShard(id)` — creates a mock shard object:
```typescript
function makeShard(id: string) {
  return {
    id,
    scope: "project",
    scopeHash: "",
    shardIndex: 0,
    dbPath: `/tmp/${id}.db`,
    vectorCount: 0,
    isActive: true,
    createdAt: Date.now(),
  };
}
```

`makeDb(path)` — creates an in-memory fake SQLite interface:
```typescript
function makeDb(path: string) {
  const rows = /* ... */;
  return {
    prepare(sql: string) {
      return {
        all(...args: any[]) { /* route by SQL pattern */ },
        get(...args: any[]) { /* route by SQL pattern */ },
        run(...args: any[]) { /* route by SQL pattern */ },
      };
    },
    listMemories(containerTag: string) { /* ... */ },
    run() {},
    close() {},
  };
}
```

`makeProvider()` / `makeTestableProvider()` — wraps constructor calls with fake dependencies:
```typescript
function makeProvider(config: Record<string, unknown> = {}) {
  return new OpenAIChatCompletionProvider(
    { model: "gpt-4o-mini", apiKey: "test-key", ...config },
    new FakeSessionManager() as any
  );
}
```

`createPlugin()` — bootstraps the plugin with mock context for runtime tests.

## Temporary Resources

**Pattern for filesystem/DB tests:**
```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});
```

**SQLite connection cleanup:**
```typescript
import { connectionManager } from "../src/services/sqlite/connection-manager.js";

afterEach(() => {
  connectionManager.closeAll();
});
```

## Assertion Patterns

**Common styles:**
```typescript
// Boolean state
expect(result.success).toBe(true);
expect(result.success).toBe(false);

// Numeric comparisons
expect(score).toBeGreaterThan(0);
expect(score).toBeLessThan(0.3);
expect(value).toBeCloseTo(1.0, 1);

// Collections
expect(result.map((x) => x.id)).toEqual(["a", "c"]);
expect(recent[0].sessionId).toBe("sess-3");

// String containment
expect(result.error).toContain("memoryId required");

// Null / truthiness
expect(profile).not.toBeNull();
expect(profile).toBeNull();

// Type checks
expect(typeof CONFIG.webServerPort).toBe("number");
expect(Array.isArray(capturedBody?.messages)).toBe(true);
```

## Test Types

**Unit tests:**
- Pure utility functions: `tests/privacy.test.ts`, `tests/tags.test.ts`, `tests/language-detector.test.ts`, `tests/memory-engine.test.ts` (scoring math).
- AI provider request formatting: `tests/openai-chat-completion-provider.test.ts`, `tests/anthropic-provider.test.ts`.

**Integration tests:**
- Real SQLite + vector backends: `tests/vector-backends/usearch-backend.test.ts`, `tests/vector-backends/exact-scan-backend.test.ts`, `tests/vector-search-backend-integration.test.ts`.
- Plugin runtime with mocked context: `tests/profile-tool-runtime.test.ts`, `tests/tool-scope.test.ts`.

**Contract / regression tests:**
- `tests/plugin-loader-contract.test.ts` — verifies built `dist/plugin.js` satisfies the OpenCode plugin-loader contract (exports, hooks, id).

**E2E tests:** Not detected.

## Coverage

**Requirements:** Not enforced in config.
**View coverage:** No coverage script defined in `package.json`.

## Known Test Issues

- **Parallel execution interference:** 12 tests fail when the full suite runs concurrently, but pass in isolation. Root causes: `connectionManager.closeAll()` affects concurrent profile tests; subprocess tests hang on background jobs; module cache pollution from mocks. CI uses `continue-on-error: true`.
- **Bun vs Node:** The suite runs under both `bun test` and `npm test` (Vitest). Bun’s module cache behavior can differ for `vi.mock` hoisting.

---

*Testing analysis: 2026-05-07*
