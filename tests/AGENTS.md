# tests/

## Purpose

The Vitest test suite. One test file per source module, mirroring the `src/services/` layout. 710+ tests across 60+ files, running in a Node environment with an isolated temporary HOME so tests never touch real `~/.opencode-mem0` data.

## Ownership

- `setup-home.ts` — Global setup file (wired in `vitest.config.ts`). Creates a temp `HOME`/`USERPROFILE` under `os.tmpdir()`, ensures `~/.opencode-mem0` exists, and in `afterAll` flushes logger buffers (source + built) and removes the temp dir. Prevents tests from polluting real user data and prevents hanging logger handles
- `*.test.ts` — One top-level `describe` per file named after the module under test, with nested `describe` blocks for logical groupings
- `vector-backends/` — Vector backend tests (`usearch-backend.test.ts`, `exact-scan-backend.test.ts`, `migration-fallback.test.ts`, `backend-factory.test.ts`) plus `vector-search-backend-integration.test.ts` at the top level

## Local Contracts

- Framework: Vitest ^3.2.4, V8 coverage provider. Config in `vitest.config.ts`
- `globals: false` — always import test functions explicitly: `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`
- File naming: `tests/<module>.test.ts` mirrors `src/services/<module>.ts`; vector backend tests live in `tests/vector-backends/`
- Test timeout 30s, hook timeout 30s
- HOME isolation is mandatory for any test that loads modules reading from `~/.opencode-mem0`. The global `setup-home.ts` covers the common case; tests that import modules before HOME is set must set HOME themselves before importing (see TESTING.md pattern)
- Mocking is via `vi.mock()`. Common mocks: `logger.js` (suppress output), `embedding.js` (avoid ML models), `sqlite/connection-manager.js` (in-memory stubs), `sqlite/shard-manager.js`, `sqlite/vector-search.js`, `config.js` (override defaults)
- No minimum coverage threshold is enforced; coverage is informational and feeds SonarCloud
- Coverage excludes: tests, types, web UI, examples, scripts, config files, `src/services/ai/session-types.ts` (see `vitest.config.ts`)

## Work Guidance

- New feature → add `tests/<feature>.test.ts`. Bug fix → add a regression test that fails before the fix and passes after
- Use descriptive test names: `it("should reject invalid API keys", ...)` over `it("test 7", ...)`
- Avoid loading real ML models in tests — mock `embedding.js`
- Run `bun run test` (Vitest directly) rather than `bun test` (Bun's runner has incomplete Vitest API compatibility)
- Coverage report: `bun run test:coverage` → `./coverage/` (text, LCOV, HTML)

## Verification

- `bun run test` — full suite (`tests/**/*.test.ts`)
- `bun run test:coverage` — suite + V8 coverage to `./coverage/`
- Single file: `vitest run tests/<file>.test.ts`; filter by name: `vitest run -t "name"`
- CI (`.github/workflows/ci.yml`) and SonarCloud (`.github/workflows/sonarcloud.yml`) run the suite on `main`

## Child DOX Index

| Path                     | Scope                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| `tests/vector-backends/` | Vector backend unit tests (no separate AGENTS.md — follow parent conventions) |
