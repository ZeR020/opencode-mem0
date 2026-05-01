# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
