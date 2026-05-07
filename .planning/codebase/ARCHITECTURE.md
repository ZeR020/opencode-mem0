<!-- refreshed: 2026-05-07 -->
# Architecture

**Analysis Date:** 2026-05-07

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                      Plugin Layer                             │
│   `src/plugin.ts`   `src/index.ts`                          │
│   OpenCode Plugin Hooks (chat.message, event, tool)         │
└────────┬────────────────────────────┬───────────────────────┘
         │                            │
         ▼                            ▼
┌────────────────────────┐    ┌───────────────────────────────┐
│   Web UI Layer         │    │   Core Service Layer          │
│   `src/services/       │    │   `src/services/`             │
│    web-server.ts`      │    │   client, scoring, lifecycle   │
│   `src/web/`           │    │   conflicts, retrieval         │
└────────┬───────────────┘    └────────┬──────────────────────┘
         │                             │
         ▼                             ▼
┌──────────────────────────────┐  ┌──────────────────────────┐
│   API Handler Layer          │  │   AI Provider Layer      │
│   `src/services/api-         │  │   `src/services/ai/`      │
│    handlers.ts`              │  │   factory, providers,      │
│                              │  │   session manager          │
└────────┬─────────────────────┘  └────────┬─────────────────┘
         │                               │
         ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Access Layer                         │
│              `src/services/sqlite/`                          │
│   connection-manager, shard-manager, vector-search,           │
│   transcript-manager                                          │
└────────┬────────────────────────────┬───────────────────────┘
         │                            │
         ▼                            ▼
┌────────────────────┐      ┌────────────────────────────────┐
│   Vector Backend   │      │   Persistence Layer            │
│   `src/services/   │      │   SQLite + FTS5 (content)      │
│    vector-backends/ │      │   SQLite (transcripts, profiles) │
│   usearch / exact  │      │   ~/.opencode-mem0/data/         │
└────────────────────┘      └────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Plugin Entry | Exports plugin module for OpenCode loader | `src/plugin.ts` |
| OpenCodeMemPlugin | Main plugin implementation: hooks, tools, lifecycle | `src/index.ts` |
| LocalMemoryClient | Primary API for memory CRUD and search operations | `src/services/client.ts` |
| Memory Scoring | 7-factor scoring (recency, frequency, importance, utility, novelty, confidence, interference) | `src/services/memory-scoring.ts` |
| Memory Lifecycle | STM/LTM classification, decay, promotion, archiving | `src/services/memory-lifecycle.ts` |
| Memory Conflicts | LLM + heuristic contradiction detection between memories | `src/services/memory-conflicts.ts` |
| Retrieval Context | Context boost and diversity filtering for search results | `src/services/retrieval-context.ts` |
| Web Server | HTTP server serving web UI + REST API | `src/services/web-server.ts` |
| API Handlers | REST endpoint implementations for memories, profiles, conflicts | `src/services/api-handlers.ts` |
| AI Provider Factory | Creates LLM providers (OpenAI, Anthropic, Gemini) | `src/services/ai/ai-provider-factory.ts` |
| Embedding Service | Text embedding via HuggingFace transformers or OpenAI API | `src/services/embedding.ts` |
| Shard Manager | Database sharding by scope (user/project) and lifecycle | `src/services/sqlite/shard-manager.ts` |
| Vector Search | Hybrid search (vector + FTS5 + multi-factor ranking) | `src/services/sqlite/vector-search.ts` |
| Transcript Manager | Session transcript storage with FTS5 search | `src/services/sqlite/transcript-manager.ts` |
| User Profile Manager | Profile CRUD, changelog, versioning | `src/services/user-profile/user-profile-manager.ts` |
| Auto Capture | LLM-based technical memory extraction from sessions | `src/services/auto-capture.ts` |
| User Memory Learning | Profile learning from user prompts via LLM analysis | `src/services/user-memory-learning.ts` |

## Pattern Overview

**Overall:** Plugin-based extension with layered services

**Key Characteristics:**
- Event-driven architecture via OpenCode plugin hooks (`chat.message`, `event`, `tool.memory`)
- Dual-store memory lifecycle (STM/LTM) with configurable decay rates
- Hybrid vector search combining approximate (usearch) and exact scan backends
- Background job scheduling for scoring recalculation and lifecycle maintenance
- Cross-platform abstraction (Bun/Node.js) for SQLite and HTTP server
- Singleton service instances managed via global Symbols

## Layers

**Plugin Layer:**
- Purpose: OpenCode integration and lifecycle management
- Location: `src/plugin.ts`, `src/index.ts`
- Contains: Plugin exports, hook handlers, tool definitions, warmup/shutdown logic
- Depends on: All core services
- Used by: OpenCode plugin loader

**Core Service Layer:**
- Purpose: Business logic for memory operations
- Location: `src/services/client.ts`, `src/services/memory-*.ts`, `src/services/retrieval-context.ts`
- Contains: Memory CRUD, scoring algorithms, lifecycle management, conflict detection
- Depends on: Data Access Layer, Embedding Service
- Used by: Plugin Layer, Web UI Layer, API Handlers

**AI Provider Layer:**
- Purpose: LLM abstraction for memory analysis, conflict detection, auto-capture
- Location: `src/services/ai/`
- Contains: Provider factory, concrete providers (OpenAI Chat, OpenAI Responses, Anthropic, Google Gemini), session manager
- Depends on: `@ai-sdk/*` packages, `ai` package
- Used by: Auto Capture, User Memory Learning, Memory Conflicts

**Data Access Layer:**
- Purpose: SQLite persistence with cross-platform abstraction
- Location: `src/services/sqlite/`
- Contains: Connection pooling, schema migration, sharding, vector search, transcript storage
- Depends on: `bun:sqlite` or `better-sqlite3`
- Used by: Core Service Layer, Vector Backend Layer

**Vector Backend Layer:**
- Purpose: Vector indexing with fallback strategies
- Location: `src/services/vector-backends/`
- Contains: USearch (approximate), ExactScan (fallback), factory with probe-based selection
- Depends on: `usearch` npm package (optional)
- Used by: Data Access Layer via `vector-search.ts`

**Web UI Layer:**
- Purpose: Built-in management interface at localhost:4747
- Location: `src/services/web-server.ts`, `src/web/`
- Contains: HTTP server, static assets (app.js, i18n.js, index.html, styles.css), REST API
- Depends on: API Handlers, Platform Server abstraction
- Used by: End users via browser

## Data Flow

### Primary Memory Write Path

1. User invokes `memory` tool with `mode: "add"` (`src/index.ts:366-391`)
2. Content is privacy-sanitized via `stripPrivateContent` (`src/services/privacy.ts`)
3. `LocalMemoryClient.addMemory()` generates embedding via `embeddingService.embed()` (`src/services/client.ts`)
4. Vector + content stored in SQLite shard via `shardManager.getOrCreateShard()` (`src/services/sqlite/shard-manager.ts`)
5. Vector indexed in backend (usearch or exact-scan) (`src/services/sqlite/vector-search.ts:69-91`)
6. Scores calculated: recency, frequency, importance, utility, novelty, confidence, interference (`src/services/memory-scoring.ts`)
7. Memory classified as STM/LTM with decay rate (`src/services/memory-lifecycle.ts:79-112`)

### Primary Search Path

1. Query submitted via tool `mode: "search"` or web API (`src/index.ts:393-402`)
2. `LocalMemoryClient.searchMemories()` embeds query (`src/services/client.ts:90-100`)
3. `vectorSearch.searchVectors()` queries vector backend for approximate matches (`src/services/sqlite/vector-search.ts`)
4. FTS5 full-text search runs in parallel on content and tags (`src/services/sqlite/vector-search.ts`)
5. Results merged, scored by multi-factor ranking (similarity + strength scores) (`src/services/sqlite/vector-search.ts`)
6. Context boost and diversity penalty applied (`src/services/retrieval-context.ts`)
7. Final ranked results returned to caller

### Auto-Capture Flow

1. `session.idle` event fires (`src/index.ts:530-558`)
2. `performAutoCapture()` retrieves uncaptured prompt from `userPromptManager` (`src/services/auto-capture.ts`)
3. AI provider generates summary and tags via structured output (`src/services/auto-capture.ts`)
4. Memory stored via `LocalMemoryClient.addMemory()` with `source: "auto-capture"`
5. On web server owner instance: `performUserProfileLearning()` analyzes prompts (`src/services/user-memory-learning.ts`)
6. Cleanup and transcript archival run (`src/services/cleanup-service.ts`, `src/services/transcript-capture.ts`)

## Key Abstractions

**PlatformServer:**
- Purpose: Cross-platform HTTP server (Bun.serve vs Node.js http.createServer)
- Examples: `src/services/platform-server.ts`
- Pattern: Runtime detection with fallback implementation

**Database:**
- Purpose: Cross-platform SQLite abstraction (bun:sqlite vs better-sqlite3)
- Examples: `src/services/sqlite/sqlite-bootstrap.ts`
- Pattern: Adapter pattern with runtime probe

**VectorBackend:**
- Purpose: Pluggable vector index (usearch approximate vs exact-scan fallback)
- Examples: `src/services/vector-backends/types.ts`, `src/services/vector-backends/backend-factory.ts`
- Pattern: Strategy pattern with degrade-on-failure

**BaseAIProvider:**
- Purpose: Unified LLM interface for all supported providers
- Examples: `src/services/ai/providers/base-provider.ts`
- Pattern: Template method with provider-specific implementations

**TagInfo:**
- Purpose: Scoped container tags linking memories to users/projects
- Examples: `src/services/tags.ts`
- Pattern: Composite identity from git config + directory + overrides

## Entry Points

**Plugin Registration:**
- Location: `src/plugin.ts`
- Triggers: OpenCode plugin loader
- Responsibilities: Export plugin ID and server function

**Plugin Initialization:**
- Location: `src/index.ts` (OpenCodeMemPlugin function)
- Triggers: OpenCode loads plugin for a project directory
- Responsibilities: Config init, warmup, web server start, background jobs, hook registration

**Web UI Server:**
- Location: `src/services/web-server.ts`
- Triggers: Plugin init if `CONFIG.webServerEnabled`
- Responsibilities: Serve static assets, handle REST API calls, owner election

**Migration Script:**
- Location: `scripts/migrate-v1-to-v2.ts`
- Triggers: Manual execution
- Responsibilities: Migrate old opencode-mem database schema to v2 with scoring/lifecycle columns

## Architectural Constraints

- **Threading:** Single-threaded event loop. Heavy operations (embedding, LLM calls) use async/await. SQLite operations are synchronous via better-sqlite3 or bun:sqlite.
- **Global state:** Multiple singletons stored on `globalThis` via Symbols to survive hot reloads:
  - `Symbol.for("opencode-mem0.embedding.instance")` — `src/services/embedding.ts:6`
  - `Symbol.for("opencode-mem0.plugin.warmedup")` — `src/index.ts:73`
  - `Symbol.for("opencode-mem0.signals.bound")` — `src/index.ts:210`
- **Circular imports:** Minimal; `memory-scoring-service.ts` uses `require()` for lazy import of `sqlite-bootstrap.js` to avoid circularity with `client.ts`.
- **Database locking:** SQLite WAL mode with busy_timeout = 5000ms. Sharding reduces contention.
- **Vector backend availability:** `usearch` is optional; system probes at startup and falls back to `exact-scan`.

## Anti-Patterns

### GlobalThis Singletons

**What happens:** Services store their singleton instances on `globalThis` using Symbol keys to survive module reloads.
**Why it's wrong:** Obscures dependency graph, makes testing harder (requires global cleanup), can leak state between tests.
**Do this instead:** Use an explicit dependency container or pass instances through the plugin context. Reference: `src/services/embedding.ts:46-50`, `src/index.ts:73-78`.

### Synchronous SQLite in Async Context

**What happens:** SQLite operations via `better-sqlite3` or `bun:sqlite` are synchronous, but wrapped in async functions throughout the client.
**Why it's wrong:** Can block the event loop on large queries or batch operations.
**Do this instead:** Consider worker threads for large batch scoring recalculations. Reference: `src/services/memory-scoring-service.ts` batch updates run in the main thread.

## Error Handling

**Strategy:** Log-and-continue with graceful degradation

**Patterns:**
- All service errors are caught, logged via `log()` utility, and returned as `{ success: false, error: string }` objects
- Vector backend degrades from usearch to exact-scan on any failure (`src/services/vector-backends/backend-factory.ts`)
- Embedding API falls back to local transformers if API fails (not yet implemented; currently throws)
- Web server start failure is non-fatal; plugin continues without web UI

## Cross-Cutting Concerns

**Logging:** Central `log()` utility in `src/services/logger.ts` — JSON-formatted console output
**Validation:** Zod schemas used for LLM structured output (`src/services/ai/opencode-provider.ts`), manual validation for user inputs
**Authentication:** Web server API key check for non-localhost access (`src/services/web-server.ts`); no auth within plugin context (relies on OpenCode sandbox)

---

*Architecture analysis: 2026-05-07*
