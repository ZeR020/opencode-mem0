<h1 align="center"><ins><strong>opencode-mem0</strong></ins></h1>

<p align="center">
  <strong>Private long-term memory for OpenCode agents.</strong>
</p>

<p align="center">
  Give your coding agent durable context across sessions: preferences, project decisions, transcripts, profiles, and architecture notes, all stored locally on your machine.
</p>

<p align="center">
  <strong>Local SQLite</strong> · <strong>Vector + FTS5 search</strong> · <strong>Transcript recall</strong> · <strong>Web UI</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-mem0"><img alt="npm version" src="https://img.shields.io/npm/v/opencode-mem0.svg"></a>
  <a href="https://www.npmjs.com/package/opencode-mem0"><img alt="npm downloads" src="https://img.shields.io/npm/dm/opencode-mem0.svg"></a>
  <a href="https://github.com/ZeR020/opencode-mem0/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/ZeR020/opencode-mem0.svg?style=flat"></a>
  <a href="https://bun.sh/"><img alt="Bun" src="https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20+-green?logo=node.js&logoColor=white"></a>
  <a href="https://github.com/ZeR020/opencode-mem0/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/opencode-mem0.svg"></a>
  <a href="https://deepwiki.com/ZeR020/opencode-mem0"><img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-opencode-mem0">Why opencode-mem0</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#feature-deep-dives">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#api-endpoints">API</a> ·
  <a href="#development">Development</a>
</p>

---

## Why opencode-mem0

Most agents forget everything when the session ends. `opencode-mem0` gives OpenCode a local memory layer that can recall what matters without sending your project context to another hosted memory service.

| What you get                      | Why it matters                                                    |
| --------------------------------- | ----------------------------------------------------------------- |
| **Persistent project memory**     | Your agent remembers conventions, commands, decisions, and fixes. |
| **Privacy-first local storage**   | Memories stay in `~/.opencode-mem0`; no telemetry or cloud sync.  |
| **Hybrid semantic + text search** | Vector search, FTS5, scoring, recency, and context-aware ranking. |
| **Transcript-aware recall**       | Past conversations become searchable instead of disappearing.     |
| **Built-in web UI**               | Browse, search, delete, and resolve conflicts from localhost.     |
| **Bun + Node.js support**         | Works on Linux, macOS, and Windows with Node.js 20+ fallback.     |

---

## Quick Start

### 1. Install

```bash
npm install -g opencode-mem0
```

### 2. Enable the Plugin

Add it to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-mem0"]
}
```

### 3. Start Remembering

```bash
# Store a durable preference
memory add "User prefers TypeScript strict mode and avoids implicit any"

# Search remembered context
memory search "typescript strict mode"

# Open the local management UI
open http://localhost:4747
```

---

## Screenshots

| Project Memory Timeline                                                                                                                                       | User Profile Viewer                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Project Memory Timeline](https://github.com/ZeR020/opencode-mem0/raw/main/.github/screenshot-project-memory.png)](https://github.com/ZeR020/opencode-mem0) | [![User Profile Viewer](https://github.com/ZeR020/opencode-mem0/raw/main/.github/screenshot-user-profile.png)](https://github.com/ZeR020/opencode-mem0) |

---

## Feature Deep-Dives

### Intelligent Memory Ranking

Every memory gets a transparent strength score that balances **recency, frequency, importance, utility, novelty, confidence, and interference**. Strong memories surface first; stale or low-value memories naturally decay.

The scoring system evaluates:

- **Recency**: How recently the memory was accessed or created
- **Frequency**: How often the memory is referenced
- **Importance**: User-marked or inferred priority
- **Utility**: Practical value based on successful retrievals
- **Novelty**: Uniqueness compared to existing memories
- **Confidence**: Certainty score from extraction quality
- **Interference**: Penalty for conflicting or redundant information

### Short-Term and Long-Term Memory (STM/LTM)

`opencode-mem0` separates conversational short-term memory from long-term rules and preferences. Useful short-term memories can be promoted automatically based on scoring thresholds, while obsolete context is archived.

| Memory Type          | Decay Period | Promotion Threshold | Use Case                                                      |
| -------------------- | ------------ | ------------------- | ------------------------------------------------------------- |
| **Short-Term (STM)** | 7 days       | 0.7                 | Recent conversations, temporary context                       |
| **Long-Term (LTM)**  | 90 days      | N/A                 | Project conventions, user preferences, architecture decisions |

When STM memories score above the promotion threshold, they graduate to LTM automatically. Memories below the archive threshold are safely archived after the configured period.

### Conflict Detection

When new memories contradict old ones, conflicts are detected with an LLM-assisted semantic check and a heuristic fallback for offline operation. You can:

- **Keep the newer memory** — replace the old one
- **Keep both** — store as separate, potentially-scoped memories
- **Merge** — combine into a single updated memory
- **Resolve manually** — use the web UI to review and decide

Conflicts are surfaced in the web UI at `/conflicts` and via the `/api/conflicts` endpoint.

### Context-Aware Retrieval

Search combines multiple signals so results are **relevant** instead of merely similar:

1. **Vector similarity** — semantic meaning via usearch vector index
2. **Full-text search (FTS5)** — keyword matching with SQLite FTS5
3. **Score weighting** — 7-factor memory strength
4. **Project context boost** — prioritize current project memories
5. **Recency bias** — favor recently used memories
6. **Diversity filtering** — avoid redundant results above similarity threshold

This hybrid approach ensures you get the most useful memories for your current task.

### Transcript Capture

Session transcripts are automatically captured and stored with FTS5 indexing, making every conversation searchable. Transcripts decay after the configured retention period (default 30 days) to prevent unbounded growth.

### Web UI

A built-in management interface runs at `http://localhost:4747`:

- Browse and search all memories
- View memory details and scoring breakdown
- Resolve conflicts visually
- Search transcript history
- Manage user profile and preferences

---

## Architecture

```text
OpenCode hooks
    -> transcript capture
    -> memory extraction
    -> scoring + lifecycle jobs
    -> SQLite shards + vector index + FTS5
    -> hybrid retrieval
    -> local web UI / REST API
```

### File Structure

```
src/
├── index.ts              # Plugin entry, lifecycle hooks
├── config.ts             # Configuration loading
├── services/
│   ├── client.ts         # LocalMemoryClient
│   ├── memory-scoring.ts # 7-factor scoring
│   ├── memory-lifecycle.ts   # STM/LTM management
│   ├── memory-conflicts.ts     # Contradiction detection
│   ├── retrieval-context.ts    # Context boost + diversity
│   ├── transcript-capture.ts   # Transcript hook
│   ├── platform-server.ts      # Bun/Node HTTP server abstraction
│   ├── sqlite/
│   │   ├── sqlite-bootstrap.ts # Runtime SQLite abstraction
│   │   ├── vector-search.ts    # Hybrid search
│   │   ├── transcript-manager.ts   # Transcript DB
│   │   └── shard-manager.ts      # Sharding + migration
│   └── web/              # UI assets and handlers
├── examples/             # basic-usage.ts, custom-scoring.ts
├── scripts/
│   ├── build.mjs         # Cross-platform build
│   ├── migrate-tests.mjs # bun:test → vitest migration helper
│   └── migrate-v1-to-v2.ts   # Database migration
└── vitest.config.ts      # Vitest test runner config
```

### Core Modules

| Module                    | Responsibility                          |
| ------------------------- | --------------------------------------- |
| `client.ts`               | Add, search, list, and delete memories. |
| `memory-scoring.ts`       | 7-factor memory scoring.                |
| `memory-lifecycle.ts`     | STM/LTM decay, promotion, and archival. |
| `memory-conflicts.ts`     | Contradiction detection and resolution. |
| `retrieval-context.ts`    | Context boost and diversity filtering.  |
| `transcript-capture.ts`   | Session transcript capture and cleanup. |
| `sqlite/vector-search.ts` | Hybrid vector + FTS5 retrieval.         |
| `sqlite/shard-manager.ts` | Project sharding and schema migration.  |
| `platform-server.ts`      | Bun/Node HTTP server abstraction.       |

---

## Configuration

The plugin works with defaults. Customize it in `~/.config/opencode/opencode-mem0.jsonc` when you need a different storage path, web UI settings, retention policy, scoring behavior, or AI provider.

```json
{
  "storagePath": "~/.opencode-mem0/data",
  "webServerEnabled": true,
  "webServerPort": 4747,
  "webServerHost": "127.0.0.1",
  "webServerApiKey": "change-me",
  "autoCaptureEnabled": true,

  "transcriptStorage": {
    "enabled": true,
    "maxAgeDays": 30
  },

  "memoryScoring": {
    "enabled": true,
    "recalculationIntervalMinutes": 60,
    "recencyHalfLifeDays": 7,
    "utilityHalfLifeDays": 3
  },

  "memoryLifecycle": {
    "stmDecayDays": 7,
    "ltmDecayDays": 90,
    "promotionThreshold": 0.7,
    "archiveThreshold": 0.2,
    "archiveAfterDays": 30,
    "checkIntervalMinutes": 60
  },

  "retrieval": {
    "maxResults": 20,
    "diversityThreshold": 0.9,
    "contextBoost": 1.5
  }
}
```

### Memory Scope

| Scope          | Behavior                           |
| -------------- | ---------------------------------- |
| `project`      | Search only the current project.   |
| `all-projects` | Search across every project shard. |

### Auto-Capture Providers

Use your existing OpenCode auth:

```json
{
  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-haiku-4-5-20251001"
}
```

Or any OpenAI-compatible endpoint such as Ollama, vLLM, Groq, or a local model:

```json
{
  "memoryApiUrl": "http://localhost:11434/v1",
  "memoryModel": "llama3.1",
  "memoryApiKey": "sk-optional"
}
```

---

## API Endpoints

Open the UI at `http://localhost:4747`.

| Endpoint                        | Method | Description               | Parameters                               |
| ------------------------------- | ------ | ------------------------- | ---------------------------------------- |
| `/api/memories`                 | GET    | List all memories         | `project`, `scope`, `limit`, `offset`    |
| `/api/memories/search?q=...`    | GET    | Search memories           | `q` (query), `project`, `scope`, `limit` |
| `/api/memories`                 | POST   | Add a memory              | `{ content, scope, type, tags }`         |
| `/api/memories/:id`             | GET    | Get memory by ID          | `id` (path)                              |
| `/api/memories/:id`             | DELETE | Delete a memory           | `id` (path)                              |
| `/api/memories/:id`             | PUT    | Update a memory           | `id` (path), `{ content, tags }`         |
| `/api/conflicts`                | GET    | List unresolved conflicts | `limit`, `offset`                        |
| `/api/conflicts/:id`            | GET    | Get conflict details      | `id` (path)                              |
| `/api/conflicts/:id`            | POST   | Resolve a conflict        | `id` (path), `{ resolution }`            |
| `/api/transcripts`              | GET    | List transcripts          | `project`, `limit`, `offset`             |
| `/api/transcripts/search?q=...` | GET    | Search transcripts        | `q` (query), `project`, `limit`          |
| `/api/profile`                  | GET    | Get user profile          | —                                        |
| `/api/profile`                  | PUT    | Update user profile       | `{ name, email, preferences }`           |
| `/api/stats`                    | GET    | Memory statistics         | `project`                                |
| `/api/health`                   | GET    | Health check              | —                                        |

All API endpoints except `/api/health` require the `Authorization: Bearer <webServerApiKey>` header when `webServerApiKey` is configured.

---

## Examples

```typescript
await memoryClient.addMemory("Use bun instead of npm for this project", {
  scope: "project",
  type: "preference",
});

const results = await memoryClient.searchMemories("package manager preference");
const memories = await memoryClient.listMemories("my-project", 10);
```

More examples: [`examples/basic-usage.ts`](examples/basic-usage.ts) and [`examples/custom-scoring.ts`](examples/custom-scoring.ts).

---

## Migration from v1

Migrating from `opencode-mem` v1 is idempotent and safe to run more than once:

```bash
bun run scripts/migrate-v1-to-v2.ts ~/.opencode-mem/data
```

The migration upgrades schema columns, backfills scores, creates transcript/conflict tables, adds indexes, and promotes high-quality existing memories to long-term memory.

### What the migration does

1. **Schema upgrade** — Adds new columns (score factors, lifecycle state, conflict markers)
2. **Backfill scores** — Calculates 7-factor scores for existing memories
3. **Create new tables** — Transcript storage, conflict tracking, user profiles
4. **Add indexes** — FTS5 indexes for full-text search, vector index for semantic search
5. **Promote memories** — High-quality v1 memories graduate to LTM automatically

---

## Development

### Requirements

| Runtime     | Status                                                |
| ----------- | ----------------------------------------------------- |
| Bun 1.x     | Recommended runtime and fastest path.                 |
| Node.js 20+ | Full fallback via `better-sqlite3` and native `http`. |

### Commands

```bash
# Install dependencies
bun install          # Bun
npm install          # Node.js

# Build
bun run build        # TypeScript compile + copy web assets (Bun)
npm run build        # TypeScript compile + copy web assets (Node.js)

# Type checking
bun run typecheck    # tsc --noEmit

# Tests
bun test             # Run test suite (Bun)
npm test             # Run test suite (Node.js / vitest)
bun run test:bun     # Run test suite with Bun test runner

# Code quality
bun run format       # Prettier format
bun audit            # Security audit
```

### Test Coverage

- **545 tests** covering memory lifecycle, transcript storage, hybrid search, conflict resolution, web API, and cross-platform runtime abstraction.

---

## Current Release

`v2.16` (in development) — Phase 03: Experience & Polish

| Area                   | Improvement                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| Cross-platform runtime | Native Bun support plus Node.js 20+ fallback for Windows, Linux, macOS.  |
| Storage safety         | Shards are deleted only after successful re-embedding.                   |
| Concurrency            | Prompt claims reset on early exits to prevent permanent deadlocks.       |
| Web UI hardening       | Safer pagination boundaries and stricter API authentication behavior.    |
| Test coverage          | 545 tests across memory lifecycle, transcript storage, search, and APIs. |

For full historical release notes, see [`CHANGELOG.md`](docs/CHANGELOG.md).

---

## License

MIT License. See [`LICENSE`](LICENSE).

**Repository:** [github.com/ZeR020/opencode-mem0](https://github.com/ZeR020/opencode-mem0)

**Author:** ZeR020

**Original project:** [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem) — `opencode-mem0` is a cognitive enhancement fork with fresh git history, extended features, and ongoing development.

---

<p align="center">
  <sub>Built with ❤️ for privacy-first agent memory.</sub>
</p>
