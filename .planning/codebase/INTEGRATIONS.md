# External Integrations

**Analysis Date:** 2026-05-07

## APIs & External Services

**AI Providers (Auto-Capture & Profile Learning):**
- OpenAI Chat Completions API — `src/services/ai/providers/openai-chat-completion.ts`
  - Endpoint: `{apiUrl}/chat/completions`
  - Auth: Bearer token via `memoryApiKey`
  - Supports tool calling with retry loops
  
- OpenAI Responses API — `src/services/ai/providers/openai-responses.ts`
  - Endpoint: `{apiUrl}/responses`
  - Auth: Bearer token
  - Supports conversation/session IDs for multi-turn persistence
  
- Anthropic Messages API — `src/services/ai/providers/anthropic-messages.ts`
  - Endpoint: `{apiUrl}/messages`
  - Auth: `x-api-key` header
  - Headers: `anthropic-version: 2023-06-01`
  - Supports OAuth via opencode auth bridge (`src/services/ai/opencode-provider.ts`)
  
- Google Gemini API (Google AI Studio) — `src/services/ai/providers/google-gemini.ts`
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  - Auth: `x-goog-api-key` header
  - Supports forced function calling mode

**Embedding APIs (Optional):**
- OpenAI-compatible embedding API — `src/services/embedding.ts`
  - Endpoint: `{embeddingApiUrl}/embeddings`
  - Auth: Bearer token via `embeddingApiKey`
  - Used when local HuggingFace model is not desired

**OpenCode Platform Integration:**
- OpenCode Plugin SDK — `src/index.ts`, `src/plugin.ts`
  - Hooks: `chat.message`, `event`, `tool`
  - Toast notifications via `ctx.client.tui.showToast`
  - Session messages via `ctx.client.session.messages`
  - Provider listing via `ctx.client.provider.list`
  - State path via `ctx.client.path.get`

**Vercel AI SDK (Structured Output):**
- Used in `src/services/ai/opencode-provider.ts`
  - `generateText` with `Output.object({ schema })` for typed AI responses
  - Providers: `createAnthropic()`, `createOpenAI()`

**Hugging Face Transformers:**
- Local model hosting via `@huggingface/transformers`
  - Default model: `Xenova/nomic-embed-text-v1` (768 dims)
  - Cache dir: `{storagePath}/.cache`
  - Pipeline: `feature-extraction` with mean pooling and normalization
  - Models downloaded on-demand from HuggingFace hub

## Data Storage

**Databases:**
- SQLite (primary data store)
  - Bun runtime: `bun:sqlite` native module (`src/services/sqlite/sqlite-bootstrap.ts`)
  - Node.js fallback: `better-sqlite3` package
  - Path: `~/.opencode-mem0/data/`
  - Tables: memories, prompts, transcripts, user_profiles, profile_changelogs, conflicts

**Vector Index:**
- USearch (`usearch` npm package)
  - In-memory cosine similarity index
  - Rebuilt from SQLite on startup
  - Per-shard, per-kind indexes (content + tags vectors)

**File Storage:**
- Local filesystem only
  - Config: `~/.config/opencode/opencode-mem0.jsonc`
  - Data: `~/.opencode-mem0/data/`
  - Logs: `~/.opencode-mem0/opencode-mem0.log`
  - Web UI assets: bundled in `dist/web/`

**Caching:**
- In-memory embedding cache (LRU, max 100 entries) — `src/services/embedding.ts`
- In-memory usearch index cache — `src/services/vector-backends/usearch-backend.ts`
- Global singletons via `Symbol.for` keys on `globalThis`

## Authentication & Identity

**Auth Provider:**
- API key-based for external AI providers
- OAuth for Anthropic (via opencode's stored auth.json)

**Secret Resolution (`src/services/secret-resolver.ts`):**
- Direct values in config
- File references: `file://~/.config/key.txt`
- Environment variables: `env://VAR_NAME`
- File permission checks on Unix (warns if not 600)

**Anthropic OAuth:**
- OAuth client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Token URL: `https://console.anthropic.com/v1/oauth/token`
- Refresh token flow implemented
- Auth state read from opencode's `auth.json`
- Required betas: `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`

## Monitoring & Observability

**Error Tracking:**
- File-based logging to `~/.opencode-mem0/opencode-mem0.log`
- Log rotation at 5MB (`.old` suffix)
- Secrets redacted in logs (`token`, `secret`, `password`, `api_key`, `authorization`)

**Logs:**
- `src/services/logger.ts` — synchronous file appends with timestamps
- Optional env override: `OPENCODE_MEM_LOG_FILE`
- Console output for build/auth warnings

## CI/CD & Deployment

**Hosting:**
- npm registry (public package)
- GitHub releases with auto-generated notes

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml`
  - Node.js 24
  - Steps: checkout → npm ci → typecheck → build → test → audit
  - Triggers: push/PR to `main`

**Release Pipeline:**
- GitHub Actions — `.github/workflows/release.yml`
  - Triggers on tags `v*`
  - Steps: checkout (fetch-depth 0) → npm ci → typecheck → build → test
  - Checks if version already published to npm
  - Publishes to npm if not exists (`npm publish --access public`)
  - Creates GitHub release if not exists (using `softprops/action-gh-release@v3`)
  - Requires `NPM_TOKEN` secret

## Environment Configuration

**Required env vars (optional, depending on config):**
- `OPENAI_API_KEY` — fallback for embedding API key if not in config
- `OPENCODE_MEM_LOG_FILE` — override log file path
- Any env var referenced by `env://` prefix in config

**Secrets location:**
- `~/.config/opencode/opencode-mem0.jsonc` (created with 0o600 permissions)
- `~/.opencode/state/auth.json` (opencode's auth storage, read for OAuth)
- Files referenced via `file://` URLs in config

## Webhooks & Callbacks

**Incoming:**
- None. Plugin is pull-based via OpenCode hook system.

**Outgoing:**
- None. All external communication is plugin-initiated API calls.

**Web Server:**
- Built-in HTTP server at `http://127.0.0.1:4747` (default)
  - Bun: `Bun.serve()`
  - Node: `http.createServer()` with Request/Response polyfill
- REST API endpoints for memory management (GET/POST/DELETE/PUT)
- Static file serving for web UI (`index.html`, `app.js`, `styles.css`, `i18n.js`)
- Optional API key auth for non-loopback binds (`x-opencode-mem-key` header)
- Health check endpoint: `/api/stats`
- Server takeover logic with jitter for multi-instance scenarios

---

*Integration audit: 2026-05-07*
