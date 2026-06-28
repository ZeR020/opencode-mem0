# src/services/

## Purpose

The service layer — all runtime logic of the plugin. A thin plugin entry point (`src/index.ts`) delegates here. Services follow a service-oriented pattern: a central orchestrator coordinates specialized services for storage, scoring, retrieval, lifecycle, capture, conflict detection, and the web UI.

## Ownership

### Primary API surface

- `client.ts` — `LocalMemoryClient` (exported as `memoryClient` singleton). Central orchestrator for all memory operations: `addMemory`, `searchMemories`, `deleteMemory`, `listMemories`, `searchMemoriesBySessionID`. Coordinates embedding, scoring, lifecycle, deduplication, conflict detection, and storage. Exports `MemoryScope` type (`"project" | "all-projects"`). New services that are part of the primary API integrate through this client

### Memory scoring, lifecycle, retrieval

- `memory-scoring.ts` — 7-factor scoring (`calculateAllScores`, `computeStrength`): recency (Ebbinghaus half-life), frequency, importance, utility, novelty (Jaccard), confidence, interference. Weighted sum → `strength`. Configurable via `MemoryScoringWeights`
- `memory-scoring-service.ts` — Periodic scoring recalculation job (`startScoringRecalculation`/`stopScoringRecalculation`/`runOneTimeScoringRecalculation`), default every 60 min
- `memory-lifecycle.ts` — STM/LTM dual-store with Ebbinghaus decay. `classifyMemory` assigns `storeType` + `decayRate`. Promotion at `promotionThreshold` (0.7), archival below `archiveThreshold` (0.2). `startLifecycleJob`/`stopLifecycleJob`/`runLifecycleMaintenance`
- `memory-conflicts.ts` — LLM-backed contradiction detection (`detectConflicts`/`resolveConflict`) with heuristic fallback; stores conflicts in a dedicated table
- `retrieval-context.ts` — Query intent classification, context boost, diversity penalty for search reranking. `RetrievalContext` defines the query analysis result shape
- `deduplication-service.ts` — Ingest-time near-duplicate detection (≥0.9 cosine) and batch dedup across shards

### Capture and context

- `context.ts` — `formatContextForPrompt`: scores memories for query relevance, applies `injection.tokenBudget`, includes user profile if `injectProfile`, formats as `plain`/`xml`/`yaml`
- `auto-capture.ts` — `performAutoCapture`: session idle → LLM extracts technical knowledge → stores as memory. Privacy-filtered input
- `transcript-capture.ts` — Raw transcript storage/cleanup (`cleanupOldTranscripts`); FTS5-indexed
- `user-memory-learning.ts` — `performUserProfileLearning`: analyzes unanalyzed user prompts to build/update the user profile
- `privacy.ts` — `stripPrivateContent`/`isFullyPrivate`: strips API keys, tokens, PII before any LLM call. Load-bearing invariant — every capture path routes through this
- `language-detector.ts` — Language detection via `franc-min`; display names via `Intl.DisplayNames`

### Storage and infrastructure

- `sqlite/` — Database layer: connections, schema, vector search, sharding, transcripts. See `src/services/sqlite/AGENTS.md`
- `vector-backends/` — Pluggable vector index backends. See `src/services/vector-backends/AGENTS.md`
- `embedding.ts` — `EmbeddingService` singleton (`embeddingService`): local Xenova/transformers.js (`Xenova/nomic-embed-text-v1`) or remote OpenAI-compatible API. SHA-256-keyed LRU cache (100 entries). `warmup`/`isWarmedUp`/`embedWithTimeout`
- `web-server.ts` — `WebServer` / `startWebServer`: HTTP server for the Memory Explorer UI + REST API (default `127.0.0.1:4747`)
- `api-handlers.ts` — REST API endpoint handlers (CRUD, search, stats, conflicts, deduplication, migration), consumed by `web-server.ts`
- `platform-server.ts` — Platform-agnostic HTTP server abstraction (Bun vs Node)
- `tags.ts` — Project/user tag generation from git config and directory. Git executable resolved from a fixed list of trusted paths only (no ambient `PATH` lookup — SonarCloud `typescript:S4036`)
- `secret-resolver.ts` — `resolveSecretValue`: secret resolution from env vars (used by `config.ts`)
- `jsonc.ts` — JSONC (JSON with comments) parser (used by `config.ts`)
- `logger.ts` — Structured logging with level control. The only module permitted to use `console.*`
- `cleanup-service.ts` — Old memory and transcript cleanup
- `migration-service.ts` — V1→V2 data migration

### AI providers

- `ai/` — Provider factory, session management, tool schemas, validators, and provider implementations. See `src/services/ai/AGENTS.md`

### HTTP request handlers

- `handlers/` — `memory.ts`, `search.ts`, `profile.ts`, `transcripts.ts`, `conflicts.ts`, `admin.ts` request handlers; `shared.ts`/`shared-types.ts` shared handler utilities and types. Consumed by `api-handlers.ts`

### User profile and prompt

- `user-profile/` — Profile manager, types, context, utils. See `src/services/user-profile/AGENTS.md`
- `user-prompt/user-prompt-manager.ts` — User prompt storage/retrieval for learning

### Utilities

- `utils/safe-transforms.ts` — `safeJSONParse`, safe date conversion
- `utils/text-analysis.ts` — Text analysis helpers
- `utils/memory-mapper.ts` — DB row → list/session result mappers

## Local Contracts

- `memoryClient` (`client.ts`) is the primary API surface. Other services are composed by it; do not bypass it for memory operations from the plugin entry point
- Scoring weights, lifecycle thresholds, and decay curves are config-driven (`config.ts`) — hardcoding them is prohibited
- The `VectorBackend` interface (`vector-backends/types.ts`) is the only seam for new vector index implementations
- `AIProviderFactory` (`ai/ai-provider-factory.ts`) is the only seam for new AI providers; a new provider also extends `AIProviderType` in `src/types/index.ts`
- `privacy.ts` stripping is mandatory before any LLM call in any capture path — never ship a capture path that bypasses it
- `logger.ts` owns `console.*`. No other service may call `console.*` directly (DeepSource JS-E1009)

## Work Guidance

- Adding a new service: create `src/services/<name>.ts`, add JSDoc, integrate through `client.ts` if part of the primary API, add `tests/<name>.test.ts`. See `src/AGENTS.md`
- Adding an AI provider: extend `AIProviderType`, implement under `ai/providers/`, register in `ai-provider-factory.ts`. See `src/services/ai/AGENTS.md`
- Adding a vector backend: implement `VectorBackend`, register in `backend-factory.ts`. See `src/services/vector-backends/AGENTS.md`
- Background jobs must be started in `src/index.ts` and export start/stop functions; never leave a job running after plugin teardown

## Verification

- Each service module has a matching `tests/<name>.test.ts` (e.g. `tests/memory-scoring.test.ts` ↔ `src/services/memory-scoring.ts`). See `tests/AGENTS.md`
- `bun run typecheck` covers all services under strict mode
- Vector backend integration is verified by `tests/vector-backends/` and `tests/vector-search-backend-integration.test.ts`

## Child DOX Index

| Path                                     | Scope                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `src/services/sqlite/AGENTS.md`          | SQLite database layer: connections, schema, vector search, sharding, transcripts |
| `src/services/vector-backends/AGENTS.md` | Pluggable vector index backends (usearch, exact-scan)                            |
| `src/services/ai/AGENTS.md`              | AI provider factory, session, tools, validators, and provider implementations    |
| `src/services/user-profile/AGENTS.md`    | User profile manager, types, context, utils                                      |
