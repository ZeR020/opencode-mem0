# opencode-mem0

Persistent memory plugin for OpenCode coding agents. Stores memories in a local SQLite-backed vector database with intelligent scoring, dual-store lifecycle management, conflict resolution, transcript storage, and context-aware retrieval.

## Features

- **Local Vector Database** — SQLite + usearch/exact-scan backends, no cloud required
- **Memory Scoring System** — 7-factor scoring (recency, frequency, importance, utility, novelty, confidence, interference) with automatic background recalculation
- **Dual-Store Lifecycle (STM/LTM)** — Short-term memories decay fast; long-term memories persist. Automatic promotion and archival based on Ebbinghaus forgetting curve
- **Intelligent Retrieval** — Multi-factor ranking (strength 40% + recency 30% + semantic similarity 30%), diversity filtering, and context-aware boosting
- **Intelligent Conflict Resolution** — LLM-powered contradiction detection with 4 resolution strategies (keep newer, keep both, merge, manual review)
- **Transcript Storage** — Automatic conversation transcript capture with FTS5 full-text search
- **Web UI** — Built-in management interface at `http://localhost:4747`
- **User Profile Learning** — Automatic preference/pattern/workflow extraction
- **Auto-Capture** — Background AI analysis extracts memories from conversations
- **Project Scoping** — Memories scoped per-project or cross-project

## Installation

```bash
npm install opencode-mem0
```

Or clone and build locally:

```bash
git clone https://github.com/ZeR020/opencode-mem0.git
cd opencode-mem0
bun install
bun run build
```

## Quick Start

The plugin auto-creates a config template at `~/.config/opencode/opencode-mem.jsonc` on first run. Edit it to customize:

```json
{
  "storagePath": "~/.opencode-mem/data",
  "webServerEnabled": true,
  "webServerPort": 4747,
  "autoCaptureEnabled": true
}
```

Then enable the plugin in your OpenCode configuration.

## Architecture

```
src/
├── index.ts                    # Plugin entry point, lifecycle hooks
├── config.ts                   # Configuration loading and defaults
├── services/
│   ├── client.ts              # Memory client (add/search/list)
│   ├── memory-scoring.ts      # 7-factor scoring algorithms
│   ├── memory-lifecycle.ts    # STM/LTM classification, decay, promotion
│   ├── memory-conflicts.ts    # Contradiction detection & resolution
│   ├── retrieval-context.ts   # Context tracking & diversity filtering
│   ├── transcript-capture.ts  # Session transcript lifecycle hook
│   ├── sqlite/
│   │   ├── transcript-manager.ts   # Transcript DB with FTS5
│   │   ├── vector-search.ts       # Hybrid FTS5 + vector search
│   │   ├── shard-manager.ts       # Database sharding
│   │   └── ...
│   └── web/                   # Built-in web UI
│       ├── index.html
│       ├── app.js
│       └── styles.css
```

## Configuration

See the auto-generated `~/.config/opencode/opencode-mem.jsonc` for full documentation. Key sections:

### Transcript Storage
```json
"transcriptStorage": {
  "enabled": true,
  "maxAgeDays": 30
}
```

### Memory Scoring
```json
"memoryScoring": {
  "enabled": true,
  "recalculationIntervalMinutes": 60,
  "recencyHalfLifeDays": 7,
  "utilityHalfLifeDays": 3
}
```

### Memory Lifecycle (STM/LTM)
```json
"memoryLifecycle": {
  "stmDecayDays": 7,
  "ltmDecayDays": 90,
  "promotionThreshold": 0.7,
  "archiveThreshold": 0.2,
  "archiveAfterDays": 30,
  "checkIntervalMinutes": 60
}
```

### Intelligent Retrieval
```json
"retrieval": {
  "maxResults": 20,
  "diversityThreshold": 0.9,
  "contextBoost": 1.5
}
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/memory-engine.test.ts

# Type check
bun run typecheck

# Build
bun run build
```

## API (Web UI)

- `GET /api/memories` — List memories
- `GET /api/memories/search?q=...` — Search memories
- `POST /api/memories` — Add memory
- `DELETE /api/memories/:id` — Delete memory
- `GET /api/conflicts` — List unresolved conflicts
- `POST /api/conflicts/:id` — Resolve conflict
- `GET /api/conflicts/stats` — Conflict statistics
- `GET /api/transcripts` — List transcripts
- `GET /api/transcripts/search?q=...` — Search transcripts

## License

MIT
