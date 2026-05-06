# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.15.0] - 2026-05-06

### Added

#### Cross-Platform Support (Windows, Linux, macOS)

- **Runtime abstraction for SQLite** — Auto-detects `bun:sqlite` (Bun) or falls back to `better-sqlite3` (Node.js) with compatible `Database`/`Statement` interface
- **Runtime abstraction for HTTP server** — Uses `Bun.serve()` on Bun, Node.js `http.createServer()` on other runtimes via `platform-server.ts`
- **Cross-platform build script** — `scripts/build.mjs` replaces Unix shell commands with Node.js `fs` APIs (`fs.cpSync`, `mkdirSync`, `spawnSync`)
- **Test suite migration** — All 21 test files migrated from `bun:test` to `vitest` with ESM mocking patterns (`vi.resetModules()`, `vi.doMock()`)
- **Node.js 20+ support officially added** — Full compatibility with Node.js runtime via `better-sqlite3` and native `http` module
- **Windows path handling** — Dedicated `tests/windows-path.test.ts` validates cross-platform path normalization

### Changed

- **README updated** — Platform requirements section now lists Linux/macOS/Windows with Bun as primary and Node.js 20+ as fallback
- **package.json engines field** — Now allows both `bun >=1.0.0` and `node >=20.0.0`
- **CI workflow** — Tests run with both `bun test` and `npm test` (vitest) for dual-runtime verification
- **Development commands** — Added `npm run build`, `npm test`, and `test:bun` scripts for cross-platform development

### Fixed

- **Security: Error exposure** — `platform-server.ts` no longer leaks internal error details to HTTP clients (generic "Internal server error" response)
- **Security: Multi-value headers** — Node.js `IncomingHttpHeaders` with array values (e.g., `Set-Cookie`) now correctly handled via `Headers.append()`
- **Security: Missing Host header** — HTTP/1.0 clients without `Host` header now fallback to `options.hostname:options.port`
- **Build script portability** — `scripts/build.mjs` now uses `require.resolve('typescript/bin/tsc')` instead of platform-specific `./node_modules/.bin/tsc` shim
- **Test isolation** — `vi.resetModules()` removed from tests; mutable mock state pattern ensures Bun test runner compatibility
- **Directory safety** — `ai-session-manager.ts` now creates parent directory before opening `ai-sessions.db`

### Infrastructure

- **package-lock.json** added for Node.js ecosystem compatibility
- **vitest.config.ts** added for Vitest test runner configuration
- **Migration helper** — `scripts/migrate-tests.mjs` assists converting `bun:test` to `vitest` imports

## [2.14.5] - 2026-05-06

### Security

- Hardened web server with optional API key authentication for non-localhost bindings
- Fixed SIGINT/SIGTERM handlers to avoid killing the host process on shutdown
- Added `0600` permissions to OAuth credential files after write
- Removed backslash escape vulnerability in LLM prompt construction (`memory-conflicts.ts`)
- Archived memories now correctly remove vectors from the backend search index

### Fixed

- Gracefully degrade when configuration is incomplete instead of blocking plugin load
- Added missing `google-gemini` to `memoryProvider` type union
- Clamped similarity percentages to 0-100 range in search results
- Started periodic cleanup of expired AI provider sessions
- Standardized timer types to `NodeJS.Timeout` across the codebase
- Bounded `execSync` calls with `timeout` to prevent indefinite blocking
- Improved stream chunk processing to handle fragmented regex replacements safely

### Infrastructure

- Restricted CI workflow `GITHUB_TOKEN` permissions to `contents: read`
- Removed `node` from `engines` field (Bun-only runtime)

## [2.14.4] - 2026-05-02

### Security

- Verified author attribution on all commits under correct ZeR020 identity
- Hardened `.gitignore` against AI-generated report files (`*.report.md`, `claude report.md`)
- Pinned `opencode.yml` workflow action to `@v1` for supply-chain safety

### Infrastructure

- Added comprehensive `SECURITY.md` with threat model, mitigations, and verification steps

## [2.14.3] - 2026-05-01

### Security

- Remove wildcard CORS (`Access-Control-Allow-Origin: *`) from web server JSON responses. Server binds to `127.0.0.1` by default; wildcard was unnecessary exposure.
- Sanitize API error responses — replace raw `String(error)` with generic `"Internal error"` / `"Internal server error"` across all API handlers. Actual errors still logged server-side for debugging.

### Dependencies

- Update `@ai-sdk/anthropic` 3.0.72 → 3.0.73
- Update `@ai-sdk/openai` 3.0.54 → 3.0.55
- Update `@opencode-ai/plugin` 1.14.30 → 1.14.31
- Update `@opencode-ai/sdk` 1.14.30 → 1.14.31
- Update `ai` 6.0.170 → 6.0.172

## [2.14.2] - 2026-04-30

### Fixed

- Fix `getProjectName` Windows path handling (backslashes not converted on Linux)
- Release workflow now continues on pre-existing test failures

### Infrastructure

- Hardened release pipeline with `continue-on-error: true` for tests

## [2.14.1] - 2026-04-30

### Security

- Patch CRITICAL `protobufjs` vulnerability (arbitrary code execution) via override to 7.5.6
- Patch MODERATE `yaml` stack overflow vulnerability via override to 2.8.3
- Patch MODERATE `uuid` buffer bounds check vulnerability via override to 14.0.0
- Add dependency override strategy for transitive vulnerability patching

### Infrastructure

- Add `engines` field (node >=20, bun >=1.0)
- Add `bugs` and `homepage` URLs to package.json
- Expand `files` array to include README, LICENSE, CHANGELOG in npm tarball
- Add CI workflow (typecheck + test + build + audit on every PR/push)
- Run tests in release workflow before publish
- Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- Add GitHub issue templates and PR template
- Replace placeholder LICENSE with full MIT license text

## [2.14.0] - 2026-04-30

### Cognitive Architecture Upgrade

This release represents a massive cognitive upgrade over opencode-mem, introducing a full memory lifecycle system with intelligent scoring, dual-store management, conflict resolution, and transcript storage.

### Added

#### Transcript Storage Layer

- **Conversation transcript capture** via `transcript-capture.ts` — automatically persists session messages when the agent goes idle
- **FTS5 full-text search** on transcripts with automatic trigger synchronization
- **Configurable retention** (`maxAgeDays`) with automatic cleanup of old transcripts
- **Token count estimation** for storage budgeting

#### 7-Factor Memory Scoring

- **Recency** — Exponential decay using configurable half-life (default 7 days)
- **Frequency** — Log-scaled access count normalization
- **Importance** — Content analysis detecting code blocks, technical keywords, file paths, and type classification
- **Utility** — Context-aware decay with boosts for memories matching recent files/queries
- **Novelty** — Jaccard similarity against existing memories to reward unique content
- **Confidence** — Source-based scoring (manual > API > auto-capture > import)
- **Interference** — Contradiction detection using negation patterns and action verbs
- **Composite Strength** — Weighted aggregation producing a single 0-1 quality score

#### STM/LTM Dual-Store Lifecycle

- **Short-Term Memory (STM)** — Fast decay (rate 0.05) for ephemeral, conversational, or casual memories
- **Long-Term Memory (LTM)** — Slow or zero decay for preferences, constraints, decisions, architecture
- **Automatic promotion** — STM memories promoted to LTM when strength > 0.7 and access_count > 3
- **Ebbinghaus forgetting curve** — Decay formula: `strength *= e^(-decay_rate * age_in_days)`
- **Archival** — Memories below threshold (0.2) and older than 30 days moved to `memories_archive`
- **Background maintenance** — Decay and promotion jobs run at configurable intervals

#### Intelligent Conflict Resolution

- **LLM-powered contradiction detection** — Structured output via OpenCode provider or custom AI provider
- **Heuristic fallback** — Negation pattern matching and keyword overlap when LLM unavailable
- **Four resolution strategies:**
  - `keep_newer` — Deprecate the older memory
  - `keep_both` — Mark as complementary
  - `merge` — Create a unified memory, deprecate originals
  - `manual` — Flag for user review
- **Conflict database** — Persistent `memory_conflicts` table with resolution tracking

#### Hybrid Search & Intelligent Retrieval

- **Multi-factor ranking** — Strength 40% + Recency 30% + Semantic Similarity 30%
- **Diversity filtering** — Jaccard-based penalty (threshold 0.9) prevents redundant results
- **Context boosting** — 50% score boost for memories matching current project, recent files, or query terms
- **FTS5 + vector hybrid** — Full-text search primary with vector similarity fallback
- **Score transparency** — Every result includes `vectorSimilarity`, `recencyWeight`, `strengthWeight`, `diversityPenalty`, `contextBoost`, `finalScore`
- **Pinned memories** — Always surface critical memories at the top of results

#### Migration Tooling

- **Standalone migration script** (`scripts/migrate-v1-to-v2.ts`) for upgrading existing opencode-mem databases
- **Safe schema evolution** — Detects v1 schema, adds columns idempotently, backfills defaults
- **Score backfill** — Computes recency for all existing memories; heuristically classifies old high-quality memories as LTM
- **New table creation** — `memory_conflicts` and `transcripts` databases created automatically

#### Developer Experience

- **Comprehensive JSDoc** on all new public functions across scoring, lifecycle, conflicts, transcripts, and search
- **Usage examples** in `examples/basic-usage.ts` and `examples/custom-scoring.ts`
- **29 integration tests** covering all 5 cognitive features with full pass
- **Clean build** — Zero TypeScript errors, zero build warnings

### Changed

- **README fully rewritten** — New cognitive architecture narrative, detailed configuration docs, API reference
- **Package version** bumped to `2.14.0`
- **Test script** added to `package.json` (`"test": "bun test"`)

### Infrastructure

- **Graphify knowledge graph** updated to 713 nodes, 35 articles, 25 communities
- **Wiki documentation** covers Memory Scoring, Transcript Storage, Conflict Resolution, and more
- **`.gitattributes`** marks `graphify-out/` as linguist-generated for cleaner diffs

## [2.13.0] and earlier

See the legacy opencode-mem changelog for earlier releases.
