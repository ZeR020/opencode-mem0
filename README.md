<!-- generated-by: gsd-doc-writer -->

<div align="center">

<h3>opencode</h3>

```
 ███╗   ███╗███████╗███╗   ███╗ ██████╗
 ████╗ ████║██╔════╝████╗ ████║██╔═████╗
 ██╔████╔██║█████╗  ██╔████╔██║██║██╔██║
 ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║████╔╝██║
 ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝
 ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝
```

</div>

<div align="center">

OpenCode plugin that gives coding agents persistent memory using a local vector database (SQLite + usearch). No cloud services required — all data stays on your machine.

</div>

<div align="center">

[![npm version](https://img.shields.io/npm/v/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0) [![npm downloads](https://img.shields.io/npm/dm/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0) [![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh) [![Node.js](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ZeR020/opencode-mem0)

</div>

## Installation

```bash
npm install opencode-mem0
```

Requires **Bun >= 1.0.0** (Linux/macOS) for native `bun:sqlite`, or **Node.js >= 20.0.0** (any platform including Windows) via `better-sqlite3` fallback.

## Quick Start

1. Install the plugin in your OpenCode project:
   ```bash
   npm install opencode-mem0
   ```
2. Create a config file at `~/.config/opencode/opencode-mem0.json` (optional — defaults work out of the box):
   ```json
   {
     "webServerEnabled": true,
     "autoCaptureEnabled": true
   }
   ```
3. Start OpenCode — the plugin warms up automatically, the Web UI launches at `http://127.0.0.1:4747`, and memories are captured from your sessions.

## Usage Examples

### Agent Tool — Memory Commands

The plugin exposes a `memory` tool to the OpenCode agent with six modes:

| Mode      | Description                   | Key Args                    |
| --------- | ----------------------------- | --------------------------- |
| `add`     | Store a new memory            | `content`, `type?`, `tags?` |
| `search`  | Hybrid search (vector + FTS5) | `query`, `scope?`           |
| `profile` | Read/write user preferences   | `content?`                  |
| `list`    | List recent memories          | `limit?`, `scope?`          |
| `forget`  | Delete a memory by ID         | `memoryId`                  |
| `help`    | Show usage guide              | —                           |

```
Agent:  memory mode=search query="dark mode preference"
→ {"success":true,"query":"dark mode preference","count":1,"results":[{"id":"abc123","content":"User prefers dark mode","similarity":92}]}
```

```
Agent:  memory mode=add content="API base URL is https://api.example.com/v2" tags="api,config"
→ {"success":true,"message":"Memory added","id":"def456","tags":["api","config"]}
```

### Programmatic API

```typescript
import plugin from "opencode-mem0/server";

// The plugin auto-registers with OpenCode when loaded
// Configure via opencode.json (see Configuration section)
```

## Key Features

- **7-Factor Memory Scoring** — recency, frequency, importance, utility, novelty, confidence, and interference combine into a single strength score that drives lifecycle decisions.
- **STM/LTM Dual-Store Lifecycle** — short-term memories decay via Ebbinghaus curves; high-strength memories auto-promote to long-term store; low-strength memories archive after inactivity.
- **Intelligent Conflict Resolution** — detects contradictions between memories (e.g., "auth uses cookies" vs. "auth uses JWT") using LLM + heuristic analysis and resolves them.
- **Hybrid Search** — vector similarity (usearch) + full-text search (SQLite FTS5) + multi-factor ranking + context boost + diversity filtering for high-relevance results.
- **Transcript Storage** — session capture with FTS5 search and configurable retention, so past conversations remain searchable.
- **Auto-Capture** — extracts important knowledge from idle sessions automatically, with privacy filtering that strips secrets and PII.
- **User Profiles** — learns preferences, patterns, and workflows from session history; stores them per-user for personalized context injection.
- **Web UI** — browse, search, and manage memories at `http://127.0.0.1:4747` (enabled by default).
- **Compaction Recovery** — when OpenCode compacts a session, the plugin re-injects relevant memories so context isn't lost.
- **Deduplication** — detects and merges near-duplicate memories at ingest time (configurable similarity threshold).

## Configuration

Config files are loaded in order (project overrides global):

| Location                                  | Purpose                    |
| ----------------------------------------- | -------------------------- |
| `~/.config/opencode/opencode-mem0.jsonc`  | Global defaults            |
| `~/.config/opencode/opencode-mem0.json`   | Global defaults (alt)      |
| `<project>/.opencode/opencode-mem0.jsonc` | Project-specific overrides |

All settings have sensible defaults — you only need a config file to change behavior. Key options:

| Setting                        | Default                      | Description                                                                                         |
| ------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `webServerEnabled`             | `true`                       | Enable the memory explorer Web UI                                                                   |
| `webServerPort`                | `4747`                       | Web UI port                                                                                         |
| `autoCaptureEnabled`           | `true`                       | Auto-extract memories from idle sessions                                                            |
| `embeddingModel`               | `Xenova/nomic-embed-text-v1` | Local embedding model (runs on CPU, no API key needed)                                              |
| `embeddingApiUrl`              | —                            | Set to use an OpenAI-compatible embedding API instead of local model                                |
| `memoryProvider`               | `openai-chat`                | AI provider for memory extraction (`openai-chat`, `openai-responses`, `anthropic`, `google-gemini`) |
| `similarityThreshold`          | `0.6`                        | Minimum similarity for search results                                                               |
| `maxMemories`                  | `10`                         | Max memories injected per chat message                                                              |
| `memoryScoring.enabled`        | `true`                       | Enable 7-factor scoring recalculation                                                               |
| `memoryLifecycle.stmDecayDays` | `7`                          | Short-term memory decay period                                                                      |
| `memoryLifecycle.ltmDecayDays` | `90`                         | Long-term memory decay period                                                                       |
| `storagePath`                  | `~/.opencode-mem0/data`      | SQLite database location                                                                            |

See [`src/config.ts`](src/config.ts) for the complete list of configurable options and their defaults.

## License

MIT License. See [`LICENSE`](LICENSE).

**Repository:** [github.com/ZeR020/opencode-mem0](https://github.com/ZeR020/opencode-mem0)

**Author:** ZeR020

**Original project:** [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem) — `opencode-mem0` is a cognitive enhancement fork. Currently ongoing development.

---

<p align="center">
  <sub>Built with ❤️ for privacy-first agent memory.</sub>
</p>
