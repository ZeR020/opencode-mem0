<!-- generated-by: gsd-doc-writer -->

<div align="center">

# OpenCode-Mem0

OpenCode plugin that gives coding agents persistent memory using a local vector database (SQLite + usearch). No cloud services required — all data stays on your machine.

[![npm version](https://img.shields.io/npm/v/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0) [![npm downloads](https://img.shields.io/npm/dm/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0) [![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh) [![Node.js](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ZeR020/opencode-mem0)

</div>

---

## Quick Start

**Requirements:** Bun ≥ 1.0 (Linux/macOS) or Node.js ≥ 20 (any platform, including Windows — prebuilt binaries, no build tools needed).

**1. Install**

```bash
npm install opencode-mem0
```

**2. Enable the plugin** in your `opencode.json`:

```json
{ "plugin": ["opencode-mem0"] }
```

**3. Activate** (one-time, creates the config and data directory — until this, the plugin stays fully inert and touches nothing):

```bash
npx opencode-mem0 init
```

**4. Add a memory provider** for auto-capture. Edit `~/.config/opencode/opencode-mem0.jsonc` (Windows: `%USERPROFILE%\.config\opencode\opencode-mem0.jsonc`):

```jsonc
{
  "memoryProvider": "openai-chat", // or: openai-responses, anthropic, google-gemini
  "memoryModel": "gpt-4o-mini", // any cheap model is plenty for extraction
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "sk-...",
}
```

**5. Start OpenCode.** First launch downloads the ~547MB local embedding model once (cached for all future runs). The Web UI opens at `http://127.0.0.1:4747`.

> **No provider configured?** Auto-capture skips silently — manual memory tools and the Web UI still work. To reuse your main OpenCode provider instead of a separate key, set `opencodeProvider` + `opencodeModel`. Platform notes and troubleshooting: [Getting Started](docs/GETTING-STARTED.md).

## Updating

OpenCode pins plugin versions in its cache, so updates are one command:

```bash
npx opencode-mem0 update
```

It bumps any npm-installed copy and clears OpenCode's plugin cache (cross-platform, no manual `rm`). Restart OpenCode and you're on the latest. When a newer release exists, the plugin shows a toast on startup — so you'll know when it's worth doing.

## Usage

Memories are captured automatically from conversations via auto-capture (enabled by default). The agent tool below is for explicit memory operations — most users never need to invoke it manually.

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
import pluginModule from "opencode-mem0/server";
// pluginModule = { id: "opencode-mem0", server: OpenCodeMemPlugin }
// OpenCode loads this automatically when the plugin is enabled in opencode.json
```

## Key Features

- **7-Factor Memory Scoring** — recency, frequency, importance, utility, novelty, confidence, and interference combine into a single strength score that drives lifecycle decisions.
- **STM/LTM Dual-Store Lifecycle** — short-term memories decay via Ebbinghaus curves; high-strength memories auto-promote to long-term store; low-strength memories archive after inactivity.
- **Intelligent Conflict Resolution** — detects contradictions between memories (e.g., "auth uses cookies" vs. "auth uses JWT") using LLM + heuristic analysis and resolves them.
- **Hybrid Search** — vector similarity (usearch) + full-text search (SQLite FTS5) + multi-factor ranking + context boost + diversity filtering for high-relevance results.
- **Transcript Storage** — session capture with FTS5 search and configurable retention, so past conversations remain searchable.
- **Auto-Capture** — extracts important knowledge from idle sessions automatically, with privacy filtering that redacts content wrapped in `<private>` tags before LLM processing.
- **User Profiles** — learns preferences, patterns, and workflows from session history; stores them per-user for personalized context injection.
- **Web UI** — browse, search, and manage memories at `http://127.0.0.1:4747` (enabled by default).
- **Compaction Recovery** — when OpenCode compacts a session, the plugin re-injects relevant memories so context isn't lost.
- **Deduplication** — detects and merges near-duplicate memories at ingest time (configurable similarity threshold).

## Configuration

Config files are loaded in order (project overrides global):

| Location                                  | Purpose                          |
| ----------------------------------------- | -------------------------------- |
| `~/.config/opencode/opencode-mem0.jsonc`  | Global defaults                  |
| `~/.config/opencode/opencode-mem0.json`   | Global defaults (alt)            |
| `<project>/.opencode/opencode-mem0.jsonc` | Project-specific overrides       |
| `<project>/.opencode/opencode-mem0.json`  | Project-specific overrides (alt) |

All settings have sensible defaults — you only need a config file to change behavior.

### Core Settings

| Setting           | Default                 | Description                                          |
| ----------------- | ----------------------- | ---------------------------------------------------- |
| `storagePath`     | `~/.opencode-mem0/data` | SQLite database location                             |
| `logLevel`        | `info`                  | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `warmupTimeoutMs` | `30000`                 | Maximum time (ms) to wait for embedding model warmup |

### Memory & Search

| Setting               | Default         | Description                                                      |
| --------------------- | --------------- | ---------------------------------------------------------------- |
| `similarityThreshold` | `0.6`           | Minimum similarity for search results (0–1)                      |
| `maxMemories`         | `10`            | Max memories returned per search                                 |
| `vectorBackend`       | `usearch-first` | Vector search backend (`usearch-first`, `usearch`, `exact-scan`) |
| `maxVectorsPerShard`  | `50000`         | Maximum vectors per database shard                               |
| `containerTagPrefix`  | `opencode`      | Prefix for memory container tags                                 |
| `memory.defaultScope` | `project`       | Default search scope (`project` or `all-projects`)               |

### Embedding

| Setting               | Default                      | Description                                                                                                  |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `embeddingModel`      | `Xenova/nomic-embed-text-v1` | Local embedding model (runs on CPU, no API key needed)                                                       |
| `embeddingDimensions` | `768`                        | Embedding vector dimensions (auto-detected from model name if omitted)                                       |
| `embeddingApiUrl`     | —                            | Set to use an OpenAI-compatible embedding API instead of local model                                         |
| `embeddingApiKey`     | —                            | API key for remote embedding endpoint (falls back to `OPENAI_API_KEY` env var when `embeddingApiUrl` is set) |

### AI Provider (Memory Extraction)

| Setting             | Default       | Description                                                                                         |
| ------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `memoryProvider`    | `openai-chat` | AI provider for memory extraction (`openai-chat`, `openai-responses`, `anthropic`, `google-gemini`) |
| `memoryModel`       | —             | Model name for the chosen provider                                                                  |
| `memoryApiUrl`      | —             | Custom API base URL for the provider                                                                |
| `memoryApiKey`      | —             | API key (resolved via secret resolver)                                                              |
| `memoryTemperature` | —             | Sampling temperature, or `false` to disable                                                         |
| `memoryExtraParams` | —             | Additional provider-specific parameters (key-value object)                                          |
| `opencodeProvider`  | —             | Override which OpenCode-connected provider to use                                                   |
| `opencodeModel`     | —             | Override which model to use from the connected provider                                             |

### Web UI

| Setting            | Default     | Description                        |
| ------------------ | ----------- | ---------------------------------- |
| `webServerEnabled` | `true`      | Enable the memory explorer Web UI  |
| `webServerPort`    | `4747`      | Web UI port                        |
| `webServerHost`    | `127.0.0.1` | Web UI bind address                |
| `webServerApiKey`  | —           | API key required for Web UI access |

### Auto-Capture

| Setting                       | Default | Description                                             |
| ----------------------------- | ------- | ------------------------------------------------------- |
| `autoCaptureEnabled`          | `true`  | Auto-extract memories from idle sessions                |
| `autoCaptureMaxIterations`    | `5`     | Max capture iterations per idle session                 |
| `autoCaptureIterationTimeout` | `30000` | Timeout (ms) per capture iteration                      |
| `autoCaptureLanguage`         | —       | Language hint for auto-capture (e.g., `en`, `de`, `zh`) |

### Memory Scoring

| Setting                                      | Default | Description                                  |
| -------------------------------------------- | ------- | -------------------------------------------- |
| `memoryScoring.enabled`                      | `true`  | Enable 7-factor scoring recalculation        |
| `memoryScoring.recalculationIntervalMinutes` | `60`    | How often (min) to recalculate memory scores |
| `memoryScoring.recencyHalfLifeDays`          | `7`     | Half-life for recency factor decay           |
| `memoryScoring.utilityHalfLifeDays`          | `3`     | Half-life for utility factor decay           |

### Memory Lifecycle

| Setting                                | Default | Description                                            |
| -------------------------------------- | ------- | ------------------------------------------------------ |
| `memoryLifecycle.stmDecayDays`         | `7`     | Short-term memory decay period                         |
| `memoryLifecycle.ltmDecayDays`         | `90`    | Long-term memory decay period                          |
| `memoryLifecycle.promotionThreshold`   | `0.7`   | Strength score threshold for STM → LTM promotion (0–1) |
| `memoryLifecycle.archiveThreshold`     | `0.2`   | Strength score threshold for archiving (0–1)           |
| `memoryLifecycle.archiveAfterDays`     | `30`    | Days of inactivity before archival                     |
| `memoryLifecycle.checkIntervalMinutes` | `60`    | How often (min) to run lifecycle maintenance           |

### Chat Message Injection

| Setting                             | Default    | Description                                                      |
| ----------------------------------- | ---------- | ---------------------------------------------------------------- |
| `chatMessage.enabled`               | `true`     | Inject relevant memories into chat messages                      |
| `chatMessage.maxMemories`           | `3`        | Max memories injected per chat message                           |
| `chatMessage.excludeCurrentSession` | `true`     | Exclude memories from the current session                        |
| `chatMessage.maxAgeDays`            | —          | Only inject memories newer than this many days                   |
| `chatMessage.injectOn`              | `first`    | When to inject: `first` (first user message) or `always`         |
| `chatMessage.mode`                  | `relevant` | Injection mode: `relevant` (search-based) or `fast` (list-based) |

### Retrieval & Injection

| Setting                        | Default | Description                                         |
| ------------------------------ | ------- | --------------------------------------------------- |
| `retrieval.maxResults`         | `20`    | Max search results from retrieval                   |
| `retrieval.diversityThreshold` | `0.9`   | Diversity filter threshold (0–1)                    |
| `retrieval.contextBoost`       | `1.5`   | Context similarity boost multiplier                 |
| `injection.tokenBudget`        | `4000`  | Max tokens for injected memory context              |
| `injection.format`             | `plain` | Output format: `plain`, `xml`, or `yaml`            |
| `injection.relevanceThreshold` | `0.3`   | Minimum relevance score for injected memories (0–1) |

### Contextual Decay

| Setting                               | Default | Description                       |
| ------------------------------------- | ------- | --------------------------------- |
| `contextualDecay.enabled`             | `true`  | Enable context-aware memory decay |
| `contextualDecay.baseDecayRate`       | `0.05`  | Base decay rate per cycle (0–1)   |
| `contextualDecay.strengthBoostFactor` | `0.5`   | Strength boost factor (0–1)       |
| `contextualDecay.accessBoostFactor`   | `0.3`   | Access boost factor (0–1)         |
| `contextualDecay.minDecayRate`        | `0.005` | Minimum decay rate (0–1)          |
| `contextualDecay.maxDecayRate`        | `0.15`  | Maximum decay rate (0–1)          |

### Compaction Recovery

| Setting                  | Default | Description                                    |
| ------------------------ | ------- | ---------------------------------------------- |
| `compaction.enabled`     | `true`  | Re-inject memories after session compaction    |
| `compaction.memoryLimit` | `10`    | Max memories to re-inject per compaction event |

### Transcript Storage

| Setting                        | Default | Description                                      |
| ------------------------------ | ------- | ------------------------------------------------ |
| `transcriptStorage.enabled`    | `true`  | Store session transcripts for search             |
| `transcriptStorage.maxAgeDays` | `30`    | Maximum age (days) before transcripts are pruned |

### Deduplication

| Setting                            | Default | Description                              |
| ---------------------------------- | ------- | ---------------------------------------- |
| `deduplicationEnabled`             | `true`  | Enable deduplication of similar memories |
| `deduplicationSimilarityThreshold` | `0.9`   | Similarity threshold for merge (0–1)     |
| `deduplicationIngestEnabled`       | `true`  | Run deduplication at ingest time         |

### Auto-Cleanup

| Setting                    | Default | Description                       |
| -------------------------- | ------- | --------------------------------- |
| `autoCleanupEnabled`       | `true`  | Automatically clean up stale data |
| `autoCleanupRetentionDays` | `30`    | Days to retain before cleanup     |

### User Profiles

| Setting                              | Default | Description                              |
| ------------------------------------ | ------- | ---------------------------------------- |
| `injectProfile`                      | `true`  | Inject user profile into agent context   |
| `userProfileAnalysisInterval`        | `10`    | Sessions between profile re-analysis     |
| `userProfileMaxPreferences`          | `20`    | Max stored user preferences              |
| `userProfileMaxPatterns`             | `15`    | Max stored behavioral patterns           |
| `userProfileMaxWorkflows`            | `10`    | Max stored workflow descriptions         |
| `userProfileChangelogRetentionCount` | `5`     | Max profile changelog entries retained   |
| `userEmailOverride`                  | —       | Override user email for profile identity |
| `userNameOverride`                   | —       | Override user name for profile identity  |

### AI Session & Toasts

| Setting                  | Default | Description                         |
| ------------------------ | ------- | ----------------------------------- |
| `aiSessionRetentionDays` | `7`     | Days to retain AI provider sessions |
| `showAutoCaptureToasts`  | `true`  | Show toast when auto-capture runs   |
| `showUserProfileToasts`  | `true`  | Show toast when profile is updated  |
| `showErrorToasts`        | `true`  | Show toast on memory system errors  |

## Documentation

- [Getting Started](docs/GETTING-STARTED.md) — installation and first-run walkthrough
- [Configuration Reference](docs/CONFIGURATION.md) — every setting in detail
- [Architecture](docs/ARCHITECTURE.md) — how the memory system works internally
- [Development](docs/DEVELOPMENT.md) — local setup and workflow
- [Testing](docs/TESTING.md) — running and writing tests
- [Changelog](docs/CHANGELOG.md) — release history
- [Contributing](.github/CONTRIBUTING.md) — PR process and commit conventions

---

> **OpenCode-Mem0** is a cognitive enhancement fork of [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem), featuring 7-factor memory scoring, STM/LTM dual-store lifecycle, intelligent conflict resolution, hybrid search, transcript storage, and more. Active development ongoing.

---

## License

MIT License. See [`LICENSE`](LICENSE).

**Repository:** [github.com/ZeR020/opencode-mem0](https://github.com/ZeR020/opencode-mem0) · **Author:** ZeR020

---

<p align="center"><sub>Built with ❤️ for privacy-first agent memory.</sub></p>
