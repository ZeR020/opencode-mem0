# Codebase Structure

**Analysis Date:** 2026-05-07

## Directory Layout

```
opencode-mem0/
├── src/                    # Source code
│   ├── index.ts            # Main plugin implementation (hooks, tools, lifecycle)
│   ├── plugin.ts           # Plugin entry point for OpenCode loader
│   ├── config.ts           # Configuration loading, defaults, migration
│   ├── types/              # Shared TypeScript types
│   │   ├── index.ts        # MemoryType, MemoryMetadata, AIProviderType
│   │   └── usearch.d.ts    # usearch type declarations
│   ├── services/           # Core business logic and infrastructure
│   │   ├── ai/             # LLM provider abstraction
│   │   ├── sqlite/         # Database layer (SQLite, sharding, search)
│   │   ├── user-profile/   # User profile management
│   │   ├── user-prompt/    # Prompt tracking for learning
│   │   ├── utils/          # Shared utilities (safe transforms)
│   │   ├── vector-backends/# Vector index implementations
│   │   ├── api-handlers.ts # REST API endpoint handlers
│   │   ├── auto-capture.ts # LLM-based memory auto-extraction
│   │   ├── cleanup-service.ts # Data cleanup orchestration
│   │   ├── client.ts       # LocalMemoryClient (primary API)
│   │   ├── context.ts      # Memory context formatting for prompts
│   │   ├── deduplication-service.ts # Memory deduplication
│   │   ├── embedding.ts    # Text embedding service
│   │   ├── jsonc.ts        # JSONC comment stripping
│   │   ├── language-detector.ts # Language detection for i18n
│   │   ├── logger.ts       # Central logging utility
│   │   ├── memory-conflicts.ts # Contradiction detection
│   │   ├── memory-lifecycle.ts # STM/LTM lifecycle management
│   │   ├── memory-scoring-service.ts # Background scoring jobs
│   │   ├── memory-scoring.ts # 7-factor scoring algorithms
│   │   ├── migration-service.ts # Schema migration helpers
│   │   ├── platform-server.ts # Cross-platform HTTP server
│   │   ├── privacy.ts      # Content privacy filtering
│   │   ├── retrieval-context.ts # Search context boost/diversity
│   │   ├── secret-resolver.ts # Secret value resolution
│   │   ├── tags.ts         # Tag generation from git/directory
│   │   ├── transcript-capture.ts # Session transcript capture
│   │   ├── user-memory-learning.ts # Profile learning from prompts
│   │   ├── web-server.ts   # Web UI HTTP server
│   │   └── web-server-worker.ts # Worker-thread web server variant
│   └── web/                # Static web UI assets
│       ├── app.js          # Web application logic
│       ├── i18n.js         # Internationalization
│       ├── index.html      # Main HTML page
│       ├── styles.css      # Stylesheet
│       └── favicon.ico     # Favicon
├── tests/                  # Test suite (vitest)
│   ├── vector-backends/    # Vector backend unit tests
│   └── *.test.ts           # Component and integration tests
├── scripts/                # Build and migration scripts
│   ├── build.mjs           # Cross-platform build script
│   ├── migrate-tests.mjs   # bun:test → vitest migration
│   └── migrate-v1-to-v2.ts # Database migration script
├── examples/               # Usage examples
│   ├── basic-usage.ts
│   └── custom-scoring.ts
├── dist/                   # Compiled output (TypeScript → JS + .d.ts)
├── .planning/              # Planning and analysis artifacts
│   ├── codebase/           # This directory
│   ├── graphs/             # Knowledge graph outputs
│   └── config.json         # Planning configuration
├── graphify-out/           # graphify knowledge graph
│   ├── graph.json
│   └── wiki/               # Obsidian-style wiki
├── .github/                # GitHub templates and workflows
│   ├── workflows/          # CI/CD (ci.yml, release.yml, opencode.yml)
│   └── ISSUE_TEMPLATE/     # Issue templates
├── package.json            # Package manifest
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Vitest test configuration
└── AGENTS.md               # Project agent configuration
```

## Directory Purposes

**`src/`:**
- Purpose: All source code
- Contains: TypeScript files, web assets
- Key files: `src/index.ts`, `src/config.ts`, `src/plugin.ts`

**`src/services/`:**
- Purpose: Business logic and infrastructure services
- Contains: 20+ service modules organized by subdomain
- Key files: `src/services/client.ts`, `src/services/api-handlers.ts`, `src/services/web-server.ts`

**`src/services/ai/`:**
- Purpose: LLM provider abstraction and session management
- Contains: Provider factory, 4 concrete providers, session manager, tool schema, validators
- Key files: `src/services/ai/ai-provider-factory.ts`, `src/services/ai/providers/openai-chat-completion.ts`

**`src/services/sqlite/`:**
- Purpose: Data persistence layer
- Contains: Database abstraction, connection pooling, sharding, vector search, transcript storage
- Key files: `src/services/sqlite/shard-manager.ts`, `src/services/sqlite/vector-search.ts`, `src/services/sqlite/connection-manager.ts`

**`src/services/vector-backends/`:**
- Purpose: Pluggable vector indexing
- Contains: USearch backend, exact-scan fallback, factory, types
- Key files: `src/services/vector-backends/backend-factory.ts`, `src/services/vector-backends/usearch-backend.ts`

**`src/services/user-profile/`:**
- Purpose: User profile CRUD and versioning
- Contains: Profile manager, context builder, utilities, types
- Key files: `src/services/user-profile/user-profile-manager.ts`

**`src/services/user-prompt/`:**
- Purpose: Prompt tracking for user learning
- Contains: Prompt manager with SQLite storage
- Key files: `src/services/user-prompt/user-prompt-manager.ts`

**`src/web/`:**
- Purpose: Built-in web UI assets
- Contains: Static JS, HTML, CSS files served by web-server.ts
- Key files: `src/web/app.js`, `src/web/index.html`

**`tests/`:**
- Purpose: Test suite
- Contains: 20+ test files covering all major components
- Key files: `tests/memory-engine.test.ts`, `tests/vector-search-backend-integration.test.ts`

**`scripts/`:**
- Purpose: Build automation and data migration
- Contains: Build script, test migration, v1→v2 DB migration
- Key files: `scripts/build.mjs`, `scripts/migrate-v1-to-v2.ts`

**`examples/`:**
- Purpose: Usage examples for consumers
- Contains: Basic usage, custom scoring configuration
- Key files: `examples/basic-usage.ts`, `examples/custom-scoring.ts`

**`dist/`:**
- Purpose: Compiled JavaScript output
- Contains: `.js`, `.d.ts`, `.d.ts.map` files mirroring `src/` structure
- Generated: Yes (via `npm run build` or `bun run build`)
- Committed: Yes (published to npm)

## Key File Locations

**Entry Points:**
- `src/plugin.ts`: Plugin registration for OpenCode
- `src/index.ts`: Main plugin function with all hooks
- `dist/plugin.js`: Compiled plugin entry (npm main)

**Configuration:**
- `src/config.ts`: Config loading, defaults, template generation
- `tsconfig.json`: TypeScript compiler settings
- `vitest.config.ts`: Test runner configuration

**Core Logic:**
- `src/services/client.ts`: `LocalMemoryClient` — primary API for memory operations
- `src/services/memory-scoring.ts`: Scoring algorithms
- `src/services/memory-lifecycle.ts`: STM/LTM management
- `src/services/memory-conflicts.ts`: Contradiction detection
- `src/services/api-handlers.ts`: REST API implementations (30+ handlers)

**Testing:**
- `tests/memory-engine.test.ts`: Core memory engine tests
- `tests/vector-search-backend-integration.test.ts`: Integration tests for vector backends
- `tests/vector-backends/`: Backend unit tests

## Naming Conventions

**Files:**
- Lowercase with hyphens: `memory-scoring.ts`, `api-handlers.ts`
- Test files: `<name>.test.ts` (co-located in `tests/`)
- Declarations: `types.d.ts`

**Directories:**
- Lowercase with hyphens: `vector-backends/`, `user-profile/`

**Classes:**
- PascalCase: `LocalMemoryClient`, `WebServer`, `ShardManager`

**Functions:**
- camelCase: `performAutoCapture`, `calculateContextBoost`

**Constants:**
- UPPER_SNAKE_CASE for module-level constants: `DEFAULT_WEIGHTS`, `MAX_TOOL_INPUT_LENGTH`

## Where to Add New Code

**New Memory Feature:**
- Core logic: `src/services/client.ts` (extend `LocalMemoryClient`)
- Scoring: `src/services/memory-scoring.ts` (add factor function)
- API endpoint: `src/services/api-handlers.ts` (add handler function)
- Web route: `src/services/web-server.ts` (add route mapping)
- Tests: `tests/memory-engine.test.ts` or new `tests/<feature>.test.ts`

**New LLM Provider:**
- Implementation: `src/services/ai/providers/<name>.ts` (extend `BaseAIProvider`)
- Registration: `src/services/ai/ai-provider-factory.ts` (add case + import)
- Type: `src/types/index.ts` (add to `AIProviderType` if needed)
- Tests: `tests/<name>-provider.test.ts`

**New Vector Backend:**
- Implementation: `src/services/vector-backends/<name>-backend.ts` (implement `VectorBackend`)
- Registration: `src/services/vector-backends/backend-factory.ts` (add probe + strategy)
- Tests: `tests/vector-backends/<name>-backend.test.ts`

**New Web UI Endpoint:**
- Handler: `src/services/api-handlers.ts` (add exported handler)
- Route: `src/services/web-server.ts` (add to route table)
- No frontend build step — update `src/web/app.js` directly

**Utilities:**
- Shared helpers: `src/services/utils/<name>.ts`
- Import from sibling services via relative paths

## Special Directories

**`dist/`:**
- Purpose: Compiled output for npm publishing
- Generated: Yes
- Committed: Yes (required for npm package)

**`graphify-out/`:**
- Purpose: graphify knowledge graph outputs
- Generated: Yes
- Committed: Yes (tracked for reference)

**`.planning/`:**
- Purpose: Internal planning documents, knowledge graphs, configs
- Generated: Mixed
- Committed: No (should be in `.gitignore` or kept local per AGENTS.md)

**`src/graphify-out/cache/`:**
- Purpose: graphify internal cache files
- Generated: Yes
- Committed: No (should be in `.gitignore`)

---

*Structure analysis: 2026-05-07*
