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
  <a href="#configuration">Configuration</a> ·
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
npm install opencode-mem0
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

## What It Does

### Intelligent Memory Ranking

Every memory gets a transparent strength score that balances recency, frequency, importance, utility, novelty, confidence, and interference. Strong memories surface first; stale or low-value memories naturally decay.

### Short-Term and Long-Term Memory

`opencode-mem0` separates conversational short-term memory from long-term rules and preferences. Useful short-term memories can be promoted automatically, while obsolete context is archived.

### Conflict Detection

When new memories contradict old ones, conflicts are detected with an LLM-assisted check and a heuristic fallback. You can keep the newer memory, keep both, merge them, or resolve manually.

### Context-Aware Retrieval

Search combines vectors, tags, full-text search, score weighting, project context, recency, and diversity filtering so results are relevant instead of merely similar.

---

## Current Release

`v2.15.1` focuses on stability and trust:

| Area                   | Improvement                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| Cross-platform runtime | Native Bun support plus Node.js 20+ fallback for Windows, Linux, macOS.  |
| Storage safety         | Shards are deleted only after successful re-embedding.                   |
| Concurrency            | Prompt claims reset on early exits to prevent permanent deadlocks.       |
| Web UI hardening       | Safer pagination boundaries and stricter API authentication behavior.    |
| Test coverage          | 173 tests across memory lifecycle, transcript storage, search, and APIs. |

For full historical release notes, see [`CHANGELOG.md`](CHANGELOG.md).

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

Core modules live in `src/services/`:

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

## Migration

Migrating from `opencode-mem` v1 is idempotent and safe to run more than once:

```bash
bun run scripts/migrate-v1-to-v2.ts ~/.opencode-mem/data
```

The migration upgrades schema columns, backfills scores, creates transcript/conflict tables, adds indexes, and promotes high-quality existing memories to long-term memory.

---

## Web UI and API

Open the UI at `http://localhost:4747`.

| Endpoint                        | Method | Description                |
| ------------------------------- | ------ | -------------------------- |
| `/api/memories`                 | GET    | List all memories.         |
| `/api/memories/search?q=...`    | GET    | Search memories.           |
| `/api/memories`                 | POST   | Add a memory.              |
| `/api/memories/:id`             | DELETE | Delete a memory.           |
| `/api/conflicts`                | GET    | List unresolved conflicts. |
| `/api/conflicts/:id`            | POST   | Resolve a conflict.        |
| `/api/transcripts`              | GET    | List transcripts.          |
| `/api/transcripts/search?q=...` | GET    | Search transcripts.        |

---

## Development

### Requirements

| Runtime     | Status                                                |
| ----------- | ----------------------------------------------------- |
| Bun 1.x     | Recommended runtime and fastest path.                 |
| Node.js 20+ | Full fallback via `better-sqlite3` and native `http`. |

### Commands

```bash
bun install          # install dependencies
bun run build        # build with Bun
npm run build        # cross-platform Node.js build
bun test             # Bun test runner
npm test             # Vitest / Node.js test runner
bun run typecheck    # TypeScript validation
```

---

## License

MIT License. See [`LICENSE`](LICENSE).

Repository: [github.com/ZeR020/opencode-mem0](https://github.com/ZeR020/opencode-mem0)

Original project: [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem)

Inspired by [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem).
