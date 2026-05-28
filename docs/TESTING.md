<!-- generated-by: gsd-doc-writer -->

# Testing

## Test Framework and Setup

The project uses **Vitest** (`vitest` ^3.2.4) as its test framework with the V8 coverage provider (`@vitest/coverage-v8` ^3.2.4). Tests run in a Node.js environment — no browser or jsdom setup is required.

Configuration is defined in [`vitest.config.ts`](../vitest.config.ts) at the project root:

| Setting         | Value                               |
| --------------- | ----------------------------------- |
| Environment     | `node`                              |
| Globals         | `false` (explicit imports required) |
| Test timeout    | 30 seconds                          |
| Hook timeout    | 30 seconds                          |
| Setup file      | `tests/setup-home.ts`               |
| Include pattern | `tests/**/*.test.ts`                |

The setup file (`tests/setup-home.ts`) creates an isolated temporary HOME directory for each test run, ensuring tests never touch the user's real `~/.opencode-mem0` data. It also flushes logger buffers in `afterAll` to prevent hanging processes.

**Before running tests**, ensure dependencies are installed:

```bash
bun install
```

## Running Tests

### Full test suite

```bash
bun run test
# or equivalently:
vitest run
```

### With coverage report

```bash
bun run test:coverage
```

Coverage output is written to `./coverage/` in text, LCOV, and HTML formats. Exclusions are configured in `vitest.config.ts` (test files, types, web UI, examples, scripts, config files).

### Watch mode

```bash
vitest
```

### Single test file

```bash
vitest run tests/memory-engine.test.ts
```

### Filtering by test name

```bash
vitest run -t "memory scoring"
```

### Known issue: parallel execution interference

When running `bun test` (Bun's native test runner, **not** Vitest), approximately 12 tests fail due to shared-state interference between parallel test workers. All 172+ tests pass individually and all 60 test files pass when run via `vitest run` (which uses isolated worker processes). The CI pipeline uses `vitest run` and is not affected.

If you encounter failures with `bun test`, re-run with Vitest instead:

```bash
bun run test   # uses vitest run — reliable
```

## Writing New Tests

### File naming and location

- Test files use the `*.test.ts` suffix and live in the `tests/` directory (or `tests/vector-backends/` for vector backend tests).
- Name the file after the module it tests: e.g., `tests/my-feature.test.ts` tests `src/services/my-feature.ts`.

### Required imports

Since `globals: false` in the Vitest config, always import test functions explicitly:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

### Mocking patterns

The codebase relies heavily on `vi.mock()` to isolate units under test. Common mocks include:

| Mocked module                                  | Purpose                         |
| ---------------------------------------------- | ------------------------------- |
| `../src/services/logger.js`                    | Suppress log output             |
| `../src/services/embedding.js`                 | Avoid loading ML models         |
| `../src/services/sqlite/connection-manager.js` | Provide in-memory DB stubs      |
| `../src/services/sqlite/shard-manager.js`      | Control shard data              |
| `../src/services/sqlite/vector-search.js`      | Stub vector operations          |
| `../src/config.js`                             | Override configuration defaults |

Example mock pattern from the test suite:

```typescript
vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/services/embedding.js", () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: () => Promise.resolve(),
    embedWithTimeout: () => Promise.resolve(new Float32Array([1, 2, 3])),
  },
}));
```

### HOME directory isolation

If your test loads modules that read from `~/.opencode-mem0`, override `HOME` before importing the module under test:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testHome = mkdtempSync(join(tmpdir(), "opencode-mem0-test-"));
process.env.HOME = testHome;

// Import AFTER setting HOME
const { myFunction } = await import("../src/my-module.js");

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});
```

### Test structure

Follow the existing convention: one top-level `describe` block per test file named after the module under test, with nested `describe` blocks for logical groupings:

```typescript
describe("my-feature", () => {
  describe("core behavior", () => {
    it("should do X when Y", () => {
      // ...
    });
  });

  describe("edge cases", () => {
    it("should handle Z gracefully", () => {
      // ...
    });
  });
});
```

## Coverage Requirements

No minimum coverage threshold is configured in `vitest.config.ts`. The project does not enforce a coverage gate in CI.

Coverage is generated for informational purposes via `bun run test:coverage` and consumed by the SonarCloud scan (see CI integration below). Excluded from coverage: test files, type definitions, web UI, examples, scripts, and config files.

## CI Integration

### CI workflow (`.github/workflows/ci.yml`)

Triggered on pushes and pull requests to `main`. Steps:

1. `bun install` — install dependencies
2. `bun run typecheck` — TypeScript type checking
3. `bun run build` — production build
4. `bun run test` — full test suite via Vitest
5. `bun audit` — dependency vulnerability audit

### SonarCloud workflow (`.github/workflows/sonarcloud.yml`)

Triggered on pushes and pull requests to `main`. Runs `bun run test:coverage` and uploads the LCOV report to SonarCloud. Coverage exclusions are defined in `sonar-project.properties`.

### Release workflow (`.github/workflows/release.yml`)

Triggered on tag pushes (`v*`). Runs typecheck, build, and tests before publishing to npm and creating a GitHub release.
