# opencode-mem0

[![npm version](https://img.shields.io/npm/v/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0)
[![npm downloads](https://img.shields.io/npm/dm/opencode-mem0.svg)](https://www.npmjs.com/package/opencode-mem0)
[![license](https://img.shields.io/npm/l/opencode-mem0.svg)](https://github.com/ZeR020/opencode-mem0/blob/main/LICENSE)

> **An advanced cognitive fork/enhancement of [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem).** Built on their excellent foundation of local vector memory for coding agents, then upgraded with a full cognitive architecture.

**A persistent memory system for AI coding agents** that enables long-term context retention across sessions using local vector database technology — now with intelligent scoring, dual-store lifecycle, conflict resolution, and transcript capture.

---

## Quick Start

```bash
# Install
npm install opencode-mem0

# Or use with OpenCode — add to ~/.config/opencode/opencode.json:
{
  "plugin": ["opencode-mem0"]
}
```

```bash
# Store a memory
memory add "User prefers TypeScript strict mode and avoids implicit any"

# Search memories
memory search "typescript strict mode"

# List recent memories
memory list

# Access the web UI
open http://localhost:4747
```

---

## Screenshots

**Project Memory Timeline:**

[![Project Memory Timeline](https://github.com/ZeR020/opencode-mem0/raw/main/.github/screenshot-project-memory.png)](https://github.com/ZeR020/opencode-mem0)

**User Profile Viewer:**

[![User Profile Viewer](https://github.com/ZeR020/opencode-mem0/raw/main/.github/screenshot-user-profile.png)](https://github.com/ZeR020/opencode-mem0)

<!-- TODO: Add screenshot of Conflict Resolution UI for v2.14.0 -->

---

## What's New in v2.14.0

### Transcript Storage Layer

Every conversation is captured, stripped of synthetic noise, and stored in a dedicated FTS5-indexed database. Searchable, retrievable, and auto-purged by age.

### 7-Factor Memory Scoring

Every memory is scored on seven dimensions:

| Factor           | What It Measures                       | Weight |
| ---------------- | -------------------------------------- | ------ |
| **Recency**      | How old is the memory?                 | 20%    |
| **Frequency**    | How often is it accessed?              | 15%    |
| **Importance**   | Code, technical keywords, file paths?  | 25%    |
| **Utility**      | Accessed recently in relevant context? | 20%    |
| **Novelty**      | How unique vs existing memories?       | 10%    |
| **Confidence**   | Manual, auto-captured, or imported?    | 10%    |
| **Interference** | Contradicts other memories?            | −10%   |

Rolls up into a single **Strength** score (0-1) that drives ranking, promotion, and archival.

### STM / LTM Dual-Store Lifecycle

- **Short-Term Memory (STM)** — Ephemeral, conversational. Decays fast (5%/day). Archived below strength 0.2 after 30 days.
- **Long-Term Memory (LTM)** — Preferences, architecture, constraints. Slow decay (1%/day) or **zero decay** for critical rules.

**Auto-promotion**: STM memories exceeding strength 0.7 with 3+ accesses get promoted to LTM. No manual tagging needed.

Decay follows the **Ebbinghaus curve**: `strength *= e^(-decay_rate * age_in_days)`.

### Intelligent Conflict Resolution

When a new memory contradicts an existing one, opencode-mem0 detects it — first with an **LLM-powered structured check**, then with a **heuristic fallback** using negation patterns and action-verb analysis.

Four resolution strategies: `keep_newer`, `keep_both`, `merge`, `manual`. All conflicts tracked in `memory_conflicts` with resolution history.

### Hybrid Search & Context-Aware Retrieval

Not just "nearest neighbor." A multi-stage pipeline:

1. **Vector + Tag Similarity** — Content vectors 60%, tag vectors 40%
2. **FTS5 Boost** — Text matches get ranking bonus
3. **Multi-Factor Ranking** — `strength * 0.4 + recency * 0.3 + similarity * 0.3`
4. **Context Boost** — Current project or recent files get up to 50% boost
5. **Diversity Filtering** — Jaccard similarity penalty prevents redundant results (threshold 0.9)

Every result includes transparent score breakdown: `vectorSimilarity`, `recencyWeight`, `strengthWeight`, `diversityPenalty`, `contextBoost`, `finalScore`.

---

## Architecture

```
src/
├── index.ts                    # Plugin entry point, lifecycle hooks, background jobs
├── config.ts                   # Configuration loading and validation
├── services/
│   ├── client.ts               # LocalMemoryClient (add/search/list/delete)
│   ├── memory-scoring.ts       # 7-factor scoring algorithms
│   ├── memory-scoring-service.ts  # Background score recalculation job
│   ├── memory-lifecycle.ts     # STM/LTM classification, decay, promotion, archival
│   ├── memory-conflicts.ts     # LLM + heuristic contradiction detection & resolution
│   ├── retrieval-context.ts    # ContextTracker, context boost, diversity penalty
│   ├── transcript-capture.ts   # Session transcript lifecycle hook
│   ├── sqlite/
│   │   ├── vector-search.ts       # Hybrid FTS5 + vector search with multi-factor ranking
│   │   ├── transcript-manager.ts  # Transcript DB with FTS5, triggers, cleanup
│   │   ├── shard-manager.ts       # Database sharding and v2 schema migration
│   │   └── ...
│   └── web/                    # Built-in management UI
│       ├── index.html
│       ├── app.js
│       └── styles.css
```

---

## Configuration

Edit `~/.config/opencode/opencode-mem.jsonc`:

```json
{
  "storagePath": "~/.opencode-mem/data",
  "webServerEnabled": true,
  "webServerPort": 4747,
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

- `scope: "project"` — query only current project (default)
- `scope: "all-projects"` — query across all project shards

### Auto-Capture AI Provider

Recommended: use opencode's built-in providers (no separate API key):

```json
{
  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-haiku-4-5-20251001"
}
```

---

## Examples

See [`examples/basic-usage.ts`](examples/basic-usage.ts) and [`examples/custom-scoring.ts`](examples/custom-scoring.ts) for full walkthroughs.

---

## Migrating from opencode-mem v1

If you have an existing opencode-mem database:

```bash
bun run scripts/migrate-v1-to-v2.ts ~/.opencode-mem/data
```

This will:

- Detect v1 schema and add all v2 columns safely
- Backfill recency scores for existing memories
- Create `memory_conflicts` and `transcripts` databases
- Add performance indexes
- Heuristically promote old, high-quality memories to LTM

The migration is **idempotent** — safe to run multiple times.

---

## Web UI API

The built-in web server exposes a REST API:

| Endpoint                        | Method | Description               |
| ------------------------------- | ------ | ------------------------- |
| `/api/memories`                 | GET    | List all memories         |
| `/api/memories/search?q=...`    | GET    | Search memories           |
| `/api/memories`                 | POST   | Add a new memory          |
| `/api/memories/:id`             | DELETE | Delete a memory           |
| `/api/conflicts`                | GET    | List unresolved conflicts |
| `/api/conflicts/:id`            | POST   | Resolve a conflict        |
| `/api/conflicts/stats`          | GET    | Conflict statistics       |
| `/api/transcripts`              | GET    | List transcripts          |
| `/api/transcripts/search?q=...` | GET    | Search transcripts        |

Access the UI at `http://localhost:4747`.

---

## Testing

```bash
# Run all tests
bun test

# Run specific feature tests
bun test tests/memory-engine.test.ts

# Type check
bun run typecheck

# Build
bun run build
```

29 integration tests cover transcript storage, conflict resolution, hybrid search, diversity ranking, and STM/LTM decay.

---

## Development

### Platform Requirements

**Linux / macOS**: Native support. Requires [Bun](https://bun.sh/) runtime.

**Windows**: Not natively supported. Bun does not currently run on Windows. Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with a Linux distribution, then install Bun inside WSL.

### Prerequisites

- [Bun](https://bun.sh/) 1.x
- TypeScript 5.7+

### Build

```bash
bun run build
```

Output goes to `dist/`. Web UI assets are copied to `dist/web/`.

### Format

```bash
bun run format        # auto-fix
bun run format:check  # verify
```

---

## License

MIT License - see [LICENSE](LICENSE)

- **Repository**: [https://github.com/ZeR020/opencode-mem0](https://github.com/ZeR020/opencode-mem0)
- **Issues**: [https://github.com/ZeR020/opencode-mem0/issues](https://github.com/ZeR020/opencode-mem0/issues)
- **Original Project**: [https://github.com/tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem)

Inspired by [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem) and [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory).
