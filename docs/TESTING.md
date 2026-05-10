# Testing Guide

This document covers how to run, write, and debug tests for opencode-mem0.

---

## Table of Contents

1. [Running Tests](#running-tests)
2. [Test Organization and Structure](#test-organization-and-structure)
3. [Writing New Tests](#writing-new-tests)
4. [Test Isolation and Temp Directories](#test-isolation-and-temp-directories)
5. [Known Issues](#known-issues)
6. [CI Testing](#ci-testing)
7. [Debugging Failing Tests](#debugging-failing-tests)

---

## Running Tests

### Test Runner

Tests use **Vitest** with the **Node** environment. The suite is designed to run under both **Bun** and **Node.js** without modification.

| Command                                        | What it does                              |
| ---------------------------------------------- | ----------------------------------------- |
| `bun run test`                                 | Run the full suite (fast, recommended)    |
| `npm run test`                                 | Run the full suite via Node.js/npm        |
| `bun run test:bun`                             | Alias for `bun run test`                  |
| `bun run test:coverage`                        | Run with V8 coverage (text + lcov + HTML) |
| `bunx vitest`                                  | Interactive watch mode for TDD            |
| `bunx vitest run tests/memory-scoring.test.ts` | Run a single file                         |
| `bunx vitest run -t "calculateRecency"`        | Run tests matching a pattern              |

### Current Suite Health

As of the latest run:

- **Test files**: 53
- **Passing**: 545
- **Skipped**: 3

A healthy run finishes in ~4-5 seconds on a modern machine.

### Coverage

Coverage is generated with the V8 provider via `c8` semantics:

```bash
bun run test:coverage
```

Reports are emitted to `./coverage/` in three formats:

- `coverage/text` — terminal summary
- `coverage/lcov.info` — LCOV for external tools (SonarCloud, IDE plugins)
- `coverage/html` — browseable HTML report

Exclusions include generated files, web assets, examples, scripts, type definitions, and `.opencode/**`. See `vitest.config.ts` for the full list.

---

## Test Organization and Structure

### File Layout

All tests live in `tests/**/*.test.ts`. The directory is flat with one nested folder for vector backend tests:

```
tests/
├── memory-scoring.test.ts
├── memory-engine.test.ts
├── contextual-decay.test.ts
├── api-handlers.test.ts
├── deduplication-service.test.ts
├── profile-tool-runtime.test.ts
├── transcript-capture.test.ts
├── vector-search-backend-integration.test.ts
├── vector-backends/
│   ├── exact-scan-backend.test.ts
│   ├── usearch-backend.test.ts
│   ├── backend-factory.test.ts
│   └── migration-fallback.test.ts
├── web-server.test.ts
├── web-server-routes.test.ts
├── cleanup-service.test.ts
├── config.test.ts
├── config-resolution.test.ts
├── privacy.test.ts
├── secret-resolver.test.ts
├── plugin-loader-contract.test.ts
├── plugin-error-handling.test.ts
├── ai-session-manager.test.ts
├── openai-responses.test.ts
├── openai-chat-completion-provider.test.ts
├── anthropic-messages.test.ts
├── anthropic-provider.test.ts
├── google-gemini.test.ts
├── opencode-provider.test.ts
├── embedding-cache.test.ts
├── embedding-cache-api.test.ts
├── embedding-degradation.test.ts
├── language-detector.test.ts
├── user-profile-validator.test.ts
├── profile-write.test.ts
├── profile-context.test.ts
├── user-memory-learning.test.ts
├── auto-capture.test.ts
├── tags.test.ts
├── tool-scope.test.ts
├── memory-scope.test.ts
├── project-scope.test.ts
├── query-aware-injection.test.ts
├── semantic-dedup-ingest.test.ts
├── adaptive-overfetch.test.ts
├── token-budget.test.ts
├── schema-version.test.ts
├── wal-batch.test.ts
├── windows-path.test.ts
├── structured-format.test.ts
├── debug-test.test.ts
├── ns ... (truncated for brevity)
```

### Key Test Areas

| Area                   | Test Files                                                                                                                    | What is covered                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Memory scoring**     | `memory-scoring.test.ts`                                                                                                      | 7-factor algorithm (recency, frequency, importance, utility, novelty, confidence, interference) |
| **Memory lifecycle**   | `memory-engine.test.ts`, `contextual-decay.test.ts`, `cleanup-service.test.ts`                                                | STM/LTM decay, promotion, archival, cleanup, contextual rate calculation                        |
| **Conflict detection** | `memory-engine.test.ts` (engine), `api-handlers.test.ts` (API surface)                                                        | Contradiction detection, resolution strategies, merge behavior                                  |
| **Transcript capture** | `transcript-capture.test.ts`                                                                                                  | Message filtering, synthetic message exclusion, storage delegation                              |
| **Hybrid search**      | `vector-search-backend-integration.test.ts`, `vector-backends/*.test.ts`                                                      | Vector + FTS5 ranking, backend fallback, exact-scan vs usearch vs NSW                           |
| **API handlers**       | `api-handlers.test.ts`, `web-server-routes.test.ts`, `web-server.test.ts`                                                     | REST endpoints, pagination, validation, error handling                                          |
| **Deduplication**      | `deduplication-service.test.ts`, `semantic-dedup-ingest.test.ts`                                                              | Duplicate detection at ingest and batch time                                                    |
| **User profile**       | `profile-tool-runtime.test.ts`, `profile-write.test.ts`, `profile-context.test.ts`, `user-profile-validator.test.ts`          | Preference storage, read/write API, validation                                                  |
| **SQLite sharding**    | `memory-engine.test.ts`, `api-handlers.test.ts`                                                                               | Shard selection, migration, tag-based routing                                                   |
| **Configuration**      | `config.test.ts`, `config-resolution.test.ts`                                                                                 | Loading, deep merge, environment overrides, scope resolution                                    |
| **AI providers**       | `anthropic-*.test.ts`, `openai-*.test.ts`, `google-gemini.test.ts`, `opencode-provider.test.ts`, `ai-session-manager.test.ts` | Provider request/response mapping, tool schema, session state                                   |
| **Privacy & security** | `privacy.test.ts`, `secret-resolver.test.ts`                                                                                  | Redaction, secret resolution, `<private>` tag handling                                          |
| **Plugin contracts**   | `plugin-loader-contract.test.ts`, `plugin-error-handling.test.ts`                                                             | OpenCode loader shape, hook signatures, error boundaries                                        |

---

## Writing New Tests

### Imports

Every test file starts with Vitest imports:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

Use `beforeAll`/`afterAll` only when you need setup that is truly shared across the entire file and expensive to repeat.

### Naming Conventions

- File: `tests/<service-name>.test.ts`
- Top-level `describe`: the module or service under test (e.g., `describe("memory-scoring", () => {`)
- Nested `describe`: the function or behavior group
- `it`: a specific expectation, phrased as a fact (e.g., `it("returns 0 for no accesses", () => {`)

### Assertion Style

Prefer `expect(...).toBe(...)`, `toEqual(...)`, `toBeGreaterThan(...)`, `toBeLessThan(...)` over snapshot tests. Numeric algorithms should use `toBeCloseTo(...)` when comparing floating-point scores.

```typescript
it("returns 1.0 for very recent memories", () => {
  const now = Date.now();
  expect(calculateRecency(now, 7)).toBeCloseTo(1.0, 5);
});
```

### Mocking Dependencies

opencode-mem0 is a plugin with many side-effecting dependencies (SQLite, HTTP, embedding models). Most tests mock their collaborators rather than relying on real databases or network calls.

#### Module-level mocks (`vi.mock`)

Place `vi.mock` calls at the top of the file, before imports. They are hoisted by Vitest:

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

#### Mocking SQLite

For unit tests, mock `connectionManager`, `shardManager`, and `vectorSearch`. For integration tests, create a real in-memory SQLite database with `new Database(":memory:")` or a temp file.

```typescript
// Unit-style mock
vi.mock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(() => ({
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(),
        run: vi.fn(),
      })),
      run: vi.fn(),
    })),
    closeAll: vi.fn(),
  },
}));
```

#### Per-test mock variation (`vi.doMock` + `vi.resetModules`)

When a single file needs different mock behaviors across tests, use `vi.doMock` and re-import the module under test:

```typescript
it("computes contextual rate and updates decay_rate column when enabled", async () => {
  _mockConfig.contextualDecay.enabled = true;

  vi.doMock("../src/services/sqlite/connection-manager.js", () => ({
    connectionManager: {
      getConnection: vi.fn(() => ({ ... })),
    },
  }));

  vi.resetModules();
  const { applyDecay: applyDecayEnabled } =
    await import("../src/services/memory-lifecycle.js");
  await applyDecayEnabled();
  // ... assertions
});
```

**Important:** `vi.mock` is hoisted and shared; `vi.doMock` is evaluated at call time and allows test-local overrides. Always pair `vi.doMock` with `vi.resetModules()` before the dynamic `import()`.

### State Capture Pattern

When verifying SQL `UPDATE` parameters, capture them in a closure:

```typescript
const capturedParams: any[] = [];

vi.doMock("../src/services/sqlite/connection-manager.js", () => ({
  connectionManager: {
    getConnection: vi.fn(() => ({
      prepare: vi.fn((sql: string) => {
        if (sql.includes("UPDATE")) {
          return {
            run: vi.fn((...args: any[]) => {
              capturedParams.push(args);
            }),
          };
        }
        return { all: vi.fn(() => []), get: vi.fn(), run: vi.fn() };
      }),
    })),
  },
}));
```

### Mocking the Plugin Loader Context

Tests for `src/index.ts` and tool runtime need a synthetic OpenCode context object:

```typescript
const plugin = await OpenCodeMemPlugin({
  directory: tmpDir,
  worktree: tmpDir,
  project: { id: "test-project" } as any,
  serverUrl: new URL("http://localhost:4096"),
  client: {
    path: { get: async () => ({ data: { state: join(tmpDir, "state") } }) },
    provider: { list: async () => ({ data: { connected: [] } }) },
    tui: null,
  } as any,
  $: (() => {
    throw new Error("not used in tests");
  }) as any,
});
```

### Mocking `CONFIG`

Many modules import `CONFIG` statically. To mutate it safely in tests, keep a stable reference:

```typescript
const _mockConfig: any = {
  contextualDecay: { enabled: true, baseDecayRate: 0.05 /* ... */ },
};

let mockConfig = _mockConfig;

vi.mock("../src/config.js", () => ({
  CONFIG: mockConfig,
}));

// In beforeEach, mutate _mockConfig in-place so the vi.mock reference sees changes
beforeEach(() => {
  _mockConfig.contextualDecay.enabled = true;
});
```

---

## Test Isolation and Temp Directories

### Goal

Tests should never write to `~/.opencode-mem0/`. Most test files use one of two strategies:

1. **Pure mocks** — no filesystem or database access at all (unit tests for scoring, config, providers).
2. **Temporary directories** — real SQLite databases created in `os.tmpdir()` and deleted in `afterEach`/`afterAll` (integration tests for search, shard migration).

### Temp Directory Pattern

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

it("searches inserted memories and preserves ranking semantics", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vector-search-integration-"));
  tempDirs.push(tempDir);
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath);
  // ... create schema, insert data, assert
});
```

### Clearing Module Mock State

Use `vi.clearAllMocks()` in `beforeEach` to reset call counts without redefining mock implementations. Use `vi.restoreAllMocks()` in `afterEach` if you used `vi.spyOn` to temporarily override real functions.

### Shared Database Connection Warning

`connectionManager` caches database connections by path. In temp-directory integration tests, call `connectionManager.closeAll()` in `afterAll` (or `afterEach`) to release file handles before deleting the temp directory. Otherwise `rmSync` may fail on Windows, or the next test may see stale state.

---

## Known Issues

### `profile-tool-runtime.test.ts` — Singleton Isolation

**Symptom:** `UserProfileManager` is instantiated as a **module-level singleton** that reads `CONFIG.storagePath` at import time. Changing the configuration per-test does not redirect it to a new temp directory.

**Impact:** The test file uses a single shared `tmpDir` for all tests instead of per-test temp directories. It cleans DB tables between tests (`DELETE FROM user_profiles`) rather than isolating at the filesystem level.

**Workaround in the test:**

```typescript
beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-mem0-runtime-"));
});

beforeEach(() => {
  // Clean tables, not directories
  const db = connectionManager.getConnection(userProfilesDbPath);
  db.run("DELETE FROM user_profile_changelogs");
  db.run("DELETE FROM user_profiles");
});
```

**Fix required:** Refactor `UserProfileManager` to accept an injected `storagePath` instead of reading from the module-level `CONFIG` at initialization. This is tracked as a low-priority known issue.

---

## CI Testing

### GitHub Actions Workflow

The CI pipeline (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun run typecheck
      - run: bun run build
      - run: bun run test
      - run: bun audit
```

### Pipeline Order

1. **Typecheck** — `tsc --noEmit` catches type errors before tests run.
2. **Build** — Ensures the cross-platform build script compiles cleanly.
3. **Test** — Full Vitest suite.
4. **Audit** — `bun audit` checks for known vulnerabilities.

All four must pass for a PR to be considered healthy.

### DeepSource Autofix PRs

DeepSource may open automated PRs with lint fixes. **Always run `bun run test` locally after merging an autofix PR.** DeepSource sometimes flags variables as unused when they are consumed in closures, `afterEach` hooks, or by imported mock helpers. Never merge an autofix without test verification.

---

## Debugging Failing Tests

### 1. Run the failing file in isolation

```bash
bunx vitest run tests/<failing-file>.test.ts
```

If it passes alone but fails in the full suite, you have an isolation problem (leaked global state, mock not reset, or temp file collision).

### 2. Run with verbose logging

```bash
bunx vitest run --reporter=verbose tests/<failing-file>.test.ts
```

### 3. Inspect temp database contents

For integration tests that use real SQLite databases, add a debugging block before the assertion:

```typescript
// Inside the test, after setup
const rows = db.prepare("SELECT * FROM memories").all();
console.log(rows);
```

Vitest captures `console.log` output and prints it with the test results.

### 4. Check for mock leakage

If a test works alone but fails when another file runs first:

- Verify `vi.clearAllMocks()` is in `beforeEach`.
- Verify `vi.restoreAllMocks()` is in `afterEach` when using `vi.spyOn`.
- Check for module-level singletons that initialize on first import (e.g., `UserProfileManager`).
- Look for `globalThis` symbol leaks (the plugin uses `Symbol.for("opencode-mem0.plugin.warmedup")`).

### 5. Timeout issues

The default test timeout is 30 seconds. If a test hangs:

- Check for unawaited promises.
- Check for infinite loops in decay/lifecycle logic when mocks return empty arrays.
- Verify `connectionManager.closeAll()` is called so temp files can be deleted.

### 6. Coverage holes

If coverage drops after adding a feature:

```bash
bun run test:coverage
# Open coverage/html/index.html in a browser
```

Look for uncovered branches in your new code. Common misses are:

- Early-return error paths (`if (!id) return { success: false, error: "required" }`)
- Catch blocks in async handlers
- Default parameter branches

---

<p align="center">
  <sub>Happy testing.</sub>
</p>
