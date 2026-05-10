# opencode-mem0 Architecture

**Version:** 2.16 (Phase 03: Experience & Polish)  
**Runtime:** Bun (primary), Node.js 20+ (fallback)  
**Storage:** SQLite + usearch (local vector DB)  
**License:** MIT

---

## Table of Contents

1. [High-Level System Diagram](#1-high-level-system-diagram)
2. [Data Flow](#2-data-flow)
3. [Module Breakdown](#3-module-breakdown)
4. [Database Schema](#4-database-schema)
5. [Memory Lifecycle State Machine](#5-memory-lifecycle-state-machine)
6. [Search Pipeline](#6-search-pipeline)
7. [Storage Architecture](#7-storage-architecture)
8. [Cross-Platform Runtime Abstraction](#8-cross-platform-runtime-abstraction)
9. [Extension Points](#9-extension-points)
10. [AI Provider Ecosystem](#10-ai-provider-ecosystem)
11. [Security & Privacy Model](#11-security--privacy-model)

---

## 1. High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Host                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ chat.message │  │  session.*   │  │   tool       │  │   event (idle)   │ │
│  │   hook       │  │   hooks      │  │  (memory)    │  │    hook          │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │                 │                 │                   │           │
│         └─────────────────┴─────────────────┴───────────────────┘           │
│                                    │                                        │
│                         ┌──────────▼──────────┐                           │
│                         │   OpenCodeMemPlugin   │                           │
│                         │     (src/index.ts)    │                           │
│                         └──────────┬──────────┘                           │
│                                    │                                        │
│    ┌───────────────────────────────┼───────────────────────────────┐         │
│    │                               │                               │         │
│    ▼                               ▼                               ▼         │
│ ┌────────────┐            ┌─────────────────┐            ┌───────────────┐  │
│ │ Auto-Capture│            │  Memory Client   │            │   Web Server   │  │
│ │ (AI-driven)│            │ (src/services/  │            │  (localhost:   │  │
│ │            │            │    client.ts)    │            │    4747)       │  │
│ └─────┬──────┘            └────────┬─────────┘            └───────┬───────┘  │
│       │                            │                              │         │
│       ▼                            ▼                              │         │
│ ┌──────────────┐         ┌─────────────────────┐                  │         │
│ │ Transcript   │         │   7-Factor Scoring   │                  │         │
│ │ Capture      │         │   (memory-scoring.ts)│                 │         │
│ └──────┬───────┘         └──────────┬──────────┘                  │         │
│        │                            │                             │         │
│        ▼                            ▼                             ▼         │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │                         SQLite Storage Layer                             │ │
│ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐ │ │
│ │  │  Memories  │  │  Shards    │  │  Conflicts │  │ User Profiles    │ │ │
│ │  │  (FTS5+Vec)│  │  Metadata  │  │            │  │                  │ │ │
│ │  └────────────┘  └────────────┘  └────────────┘  └──────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
│                         ┌──────────▼──────────┐                           │
│                         │  Vector Backends     │                           │
│                         │  (usearch/NSW/exact) │                           │
│                         └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow

### 2.1 Memory Ingestion Flow

```
User / AI Action
      │
      ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenCode Hook  │────▶│  Privacy Filter  │────▶│  Deduplication   │
│ (chat.message /  │     │ (stripPrivate,   │     │ (ingest-time     │
│  tool execute)   │     │  isFullyPrivate) │     │  similarity check)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                              ┌─────────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Embedding Gen   │
                    │ (Xenova local /  │
                    │  OpenAI API)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │ 7-Factor   │ │ Lifecycle  │ │ Conflict   │
       │ Scoring    │ │ Classify   │ │ Detection  │
       │ (recency,  │ │ (STM/LTM)  │ │ (async)    │
       │ frequency, │ │            │ │            │
       │ importance, │ │            │ │            │
       │ utility,    │ │            │ │            │
       │ novelty,    │ │            │ │            │
       │ confidence, │ │            │ │            │
       │ interference)│ │            │ │            │
       └──────┬─────┘ └─────┬──────┘ └─────┬──────┘
              │             │              │
              └─────────────┼──────────────┘
                            ▼
                   ┌─────────────────┐
                   │  Shard Manager   │
                   │ (getWriteShard) │
                   └────────┬────────┘
                            ▼
                   ┌─────────────────┐
                   │ SQLite INSERT   │
                   │ + Vector Index  │
                   │ (atomic txn)    │
                   └─────────────────┘
```

### 2.2 Memory Retrieval Flow

```
User Query
      │
      ▼
┌─────────────────┐     ┌─────────────────┐
│  Query Intent    │────▶│  Embedding Gen   │
│  Analysis        │     │ (with timeout)   │
│ (retrieval-ctx)  │     └────────┬────────┘
└─────────────────┘              │
                                 ▼
                    ┌──────────────────────────┐
                    │  Shard Resolution         │
                    │  (scope: user/project/all)│
                    └─────────────┬────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │ Vector     │  │ FTS5 Text  │  │ Tag        │
           │ Search     │  │ Search     │  │ Search     │
           │ (backend)  │  │            │  │            │
           └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                 │               │               │
                 └───────────────┼───────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │  Hybrid Score Merge       │
                    │  (60% vector + 40% tags    │
                    │   + 0.1 FTS boost)        │
                    └─────────────┬────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │ Multi-Factor│  │ Context    │  │ Diversity  │
           │ Ranking     │  │ Boost      │  │ Penalty    │
           │ (40/30/30)  │  │            │  │ (Jaccard)  │
           └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                 │               │               │
                 └───────────────┼───────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │  Final Result Set          │
                    │  (sorted, pinned first)   │
                    └──────────────────────────┘
```

---

## 3. Module Breakdown

| Module                  | File                                                | Responsibility                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plugin Entry**        | `src/index.ts`                                      | OpenCode lifecycle hooks (`chat.message`, `tool`, `event`), warmup, shutdown, web server orchestration                                                                                                                           |
| **Configuration**       | `src/config.ts`                                     | Zod-validated config schema, JSONC parsing, defaults, migration from v1 (`~/.opencode-mem`)                                                                                                                                      |
| **Memory Client**       | `src/services/client.ts`                            | Public API facade: `addMemory`, `searchMemories`, `deleteMemory`, `listMemories`, `searchMemoriesBySessionID`                                                                                                                    |
| **Scoring Engine**      | `src/services/memory-scoring.ts`                    | 7-factor scoring: recency (exponential decay), frequency (log scale), importance (keyword + type analysis), utility (context-aware), novelty (Jaccard vs existing), confidence (source-based), interference (negation detection) |
| **Scoring Service**     | `src/services/memory-scoring-service.ts`            | Background recalculation scheduler (interval-based, configurable)                                                                                                                                                                |
| **Lifecycle**           | `src/services/memory-lifecycle.ts`                  | STM/LTM classification, decay application (Ebbinghaus curve), promotion scanning, archival                                                                                                                                       |
| **Conflict Detection**  | `src/services/memory-conflicts.ts`                  | LLM-assisted contradiction detection with heuristic pre-filter; resolution strategies: `keep_newer`, `keep_both`, `merge`, `manual`                                                                                              |
| **Retrieval Context**   | `src/services/retrieval-context.ts`                 | Query intent analysis, context boost (project/file/query matching), diversity penalty (Jaccard), `ContextTracker` (scoped, LRU-evicted)                                                                                          |
| **Vector Search**       | `src/services/sqlite/vector-search.ts`              | Hybrid search orchestration: vector backend search + FTS5 + hydration + scoring + diversity filtering + access-count updates                                                                                                     |
| **Shard Manager**       | `src/services/sqlite/shard-manager.ts`              | Metadata DB (`metadata.db`), per-scope shard creation, auto-split at `maxVectorsPerShard` (default 50k), read-only promotion                                                                                                     |
| **Connection Manager**  | `src/services/sqlite/connection-manager.ts`         | SQLite connection pooling, WAL mode, batch write queuing, checkpoint scheduling                                                                                                                                                  |
| **Transcript Manager**  | `src/services/sqlite/transcript-manager.ts`         | Session transcript storage with FTS5 indexing                                                                                                                                                                                    |
| **Transcript Capture**  | `src/services/transcript-capture.ts`                | OpenCode session message capture, synthetic-part filtering, cleanup scheduling                                                                                                                                                   |
| **Embedding Service**   | `src/services/embedding.ts`                         | Local Xenova Transformers.js pipeline or OpenAI-compatible API fallback; SHA256 LRU cache (max 100); timeout wrapper                                                                                                             |
| **Deduplication**       | `src/services/deduplication-service.ts`             | Exact duplicate removal (same content+container) and near-duplicate detection (cosine similarity) at ingest and batch-cleanup time                                                                                               |
| **User Profile**        | `src/services/user-profile/user-profile-manager.ts` | Profile CRUD, changelog versioning, confidence decay, merge strategies for preferences/patterns/workflows                                                                                                                        |
| **Profile Context**     | `src/services/user-profile/profile-context.ts`      | Profile serialization for injection into AI context                                                                                                                                                                              |
| **Prompt Manager**      | `src/services/user-prompt/user-prompt-manager.ts`   | User prompt accumulation for profile analysis                                                                                                                                                                                    |
| **Auto-Capture**        | `src/services/auto-capture.ts`                      | AI-driven memory extraction from idle sessions                                                                                                                                                                                   |
| **User Learning**       | `src/services/user-memory-learning.ts`              | Profile analysis from accumulated prompts via AI providers                                                                                                                                                                       |
| **Web Server**          | `src/services/web-server.ts`                        | HTTP request router, static asset serving, API handler delegation, ownership election (multi-instance safe)                                                                                                                      |
| **Platform Server**     | `src/services/platform-server.ts`                   | Runtime abstraction: Bun.serve() or Node.js `http.createServer()`                                                                                                                                                                |
| **API Handlers**        | `src/services/api-handlers.ts`                      | REST API endpoints for web UI: memories CRUD, search, conflicts, profiles, transcripts, system status                                                                                                                            |
| **Context Formatter**   | `src/services/context.ts`                           | Memory injection formatting: plain/XML/YAML output with token budgeting and query-aware relevance filtering                                                                                                                      |
| **AI Provider Factory** | `src/services/ai/ai-provider-factory.ts`            | Provider instantiation: OpenAI Chat/Responses, Anthropic Messages, Google Gemini; session cleanup scheduling                                                                                                                     |
| **Base Provider**       | `src/services/ai/providers/base-provider.ts`        | Abstract base with retry logic, rate limiting, error normalization                                                                                                                                                               |
| **OpenCode Provider**   | `src/services/ai/opencode-provider.ts`              | Bridge to OpenCode's configured providers (Claude, OpenAI, etc.) via SDK state path                                                                                                                                              |
| **AI Session Manager**  | `src/services/ai/session/ai-session-manager.ts`     | Session state retention for providers that support it (OpenAI Responses, Anthropic)                                                                                                                                              |
| **Privacy Filter**      | `src/services/privacy.ts`                           | PII redaction (`[REDACTED]`), fully-private content blocking                                                                                                                                                                     |
| **Tags**                | `src/services/tags.ts`                              | Container tag generation from git/project metadata; user/project scope separation                                                                                                                                                |
| **Language Detector**   | `src/services/language-detector.ts`                 | ISO code → human-readable language name for UI/help localization                                                                                                                                                                 |
| **Logger**              | `src/services/logger.ts`                            | Structured logging with configurable level (debug/info/warn/error)                                                                                                                                                               |
| **Safe Transforms**     | `src/services/utils/safe-transforms.ts`             | JSON parse/stringify wrappers, ISO date formatting with fallbacks                                                                                                                                                                |

---

## 4. Database Schema

### 4.1 Metadata Database (`metadata.db`)

```sql
CREATE TABLE shards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,              -- 'user' | 'project'
  scope_hash TEXT NOT NULL,         -- container hash
  shard_index INTEGER NOT NULL,     -- 0, 1, 2... per scope+hash
  db_path TEXT NOT NULL,            -- relative path like "projects/proj_hash_shard_0.db"
  vector_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,    -- 0 = read-only (full), 1 = active (write)
  created_at INTEGER NOT NULL,
  UNIQUE(scope, scope_hash, shard_index)
);

CREATE INDEX idx_active_shards ON shards(scope, scope_hash, is_active);
```

### 4.2 Shard Database (`<scope>_<hash>_shard_<N>.db`)

#### `memories` — Primary memory store

| Column                 | Type             | Default | Purpose                                       |
| ---------------------- | ---------------- | ------- | --------------------------------------------- |
| `id`                   | TEXT PRIMARY KEY | —       | `mem_${ts}_${randomHex(10)}`                  |
| `content`              | TEXT NOT NULL    | —       | Full memory text                              |
| `vector`               | BLOB NOT NULL    | —       | Float32Array binary embedding                 |
| `tags_vector`          | BLOB             | NULL    | Separate embedding for tags                   |
| `container_tag`        | TEXT NOT NULL    | —       | `mem_project_<hash>` or `mem_user_<hash>`     |
| `tags`                 | TEXT             | NULL    | Comma-separated tags                          |
| `type`                 | TEXT             | NULL    | Memory classification (preference, bug, etc.) |
| `created_at`           | INTEGER NOT NULL | —       | Unix epoch ms                                 |
| `updated_at`           | INTEGER NOT NULL | —       | Last modification                             |
| `metadata`             | TEXT             | NULL    | JSON blob (sessionID, tool, source, etc.)     |
| `display_name`         | TEXT             | NULL    | User display name                             |
| `user_name`            | TEXT             | NULL    | Git user.name                                 |
| `user_email`           | TEXT             | NULL    | Git user.email                                |
| `project_path`         | TEXT             | NULL    | Absolute project directory                    |
| `project_name`         | TEXT             | NULL    | Project directory basename                    |
| `git_repo_url`         | TEXT             | NULL    | Remote origin URL                             |
| `is_pinned`            | INTEGER          | 0       | 1 = always rank first                         |
| `is_deprecated`        | INTEGER          | 0       | 1 = logically deleted                         |
| `store_type`           | TEXT             | 'stm'   | 'stm' (short-term) or 'ltm' (long-term)       |
| `decay_rate`           | REAL             | 0.05    | Ebbinghaus decay lambda                       |
| `last_decay_at`        | INTEGER          | NULL    | Last maintenance timestamp                    |
| **Scoring columns**    |                  |         |                                               |
| `recency_score`        | REAL             | 0.5     | `exp(-λ * age_days)`                          |
| `frequency_score`      | REAL             | 0.0     | `log(1+accesses) / log(101)`                  |
| `importance_score`     | REAL             | 0.5     | Keyword + type + length analysis              |
| `utility_score`        | REAL             | 0.3     | Context-aware access recency                  |
| `novelty_score`        | REAL             | 0.5     | 1 - max Jaccard(existing)                     |
| `confidence_score`     | REAL             | 0.7     | Source reliability                            |
| `interference_penalty` | REAL             | 0.0     | Contradiction penalty                         |
| `strength`             | REAL             | 0.5     | Weighted composite [0,1]                      |
| `access_count`         | INTEGER          | 0       | Incremented on each search hit                |
| `last_accessed`        | INTEGER          | NULL    | Last search timestamp                         |

#### `memories_fts` — FTS5 virtual table (auto-created by `sqlite-bootstrap.ts`)

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,                          -- mirrored from memories.content
  content='memories',               -- source table
  content_rowid='rowid'             -- rowid linkage
);
```

Triggers maintain FTS5 sync on INSERT/UPDATE/DELETE.

#### `memory_conflicts` — Contradiction tracking

| Column             | Type             | Purpose                                         |
| ------------------ | ---------------- | ----------------------------------------------- |
| `id`               | TEXT PRIMARY KEY | `conflict_${ts}_${hex}`                         |
| `memory_id_1`      | TEXT FK          | First memory                                    |
| `memory_id_2`      | TEXT FK          | Second memory                                   |
| `similarity_score` | REAL             | Content overlap score                           |
| `detected_at`      | INTEGER          | Detection timestamp                             |
| `resolved`         | INTEGER          | 0 = unresolved, 1 = resolved                    |
| `resolution_type`  | TEXT             | `keep_newer` / `keep_both` / `merge` / `manual` |
| `resolved_at`      | INTEGER          | Resolution timestamp                            |
| `resolution_data`  | TEXT             | JSON (e.g., merged memory ID)                   |

#### `memories_archive` — Archived weak memories

Same columns as `memories` minus `vector`/`tags_vector`, plus `archived_at`.

#### `shard_metadata` — Per-shard bookkeeping

| Column  | Type             | Purpose                                   |
| ------- | ---------------- | ----------------------------------------- |
| `key`   | TEXT PRIMARY KEY | `embedding_dimensions`, `embedding_model` |
| `value` | TEXT NOT NULL    | Stored config at creation time            |

### 4.3 User Profiles Database (`user-profiles.db`)

```sql
CREATE TABLE user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  profile_data TEXT NOT NULL,       -- JSON: {preferences[], patterns[], workflows[]}
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_analyzed_at INTEGER NOT NULL,
  total_prompts_analyzed INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT 1
);

CREATE TABLE user_profile_changelogs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  profile_data_snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);
```

### 4.4 Transcript Database (`transcripts.db`)

```sql
CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_path TEXT,
  messages TEXT NOT NULL,           -- JSON array of filtered messages
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  messages,
  content='transcripts',
  content_rowid='rowid'
);
```

---

## 5. Memory Lifecycle State Machine

```
                    ┌─────────────────┐
                    │   Creation      │
                    │  (addMemory)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │   STM      │ │   LTM      │ │   LTM      │
       │ (default)  │ │ (hard:     │ │ (slow:     │
       │ decay=0.05 │ │ preference,│ │ learning,  │
       │            │ │ decision,  │ │ tutorial)  │
       │            │ │ rule,      │ │ decay=0.01 │
       │            │ │ arch)      │ │            │
       │            │ │ decay=0.0  │ │            │
       └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
             │              │              │
             │              │              │ (optional decay)
             ▼              │              ▼
    ┌─────────────────┐     │       ┌─────────────────┐
    │  Access / Use   │     │       │  Contextual     │
    │  (increment     │     │       │  Decay (opt.)   │
    │   access_count) │     │       │  rate = base ×  │
    └────────┬────────┘     │       │  √(strengthM ×│
             │              │       │   accessM)     │
             │              │       └─────────────────┘
             ▼              │
    ┌─────────────────┐      │
    │  Promotion Check │     │
    │  (lifecycle job) │     │
    │  strength > 0.7  │     │
    │  access_count > 3│    │
    └────────┬────────┘     │
             │ Yes          │
             ▼              │
    ┌─────────────────┐     │
    │  Promote to LTM  │─────┘
    │  decay_rate → 0  │
    │  (or 0.01)       │
    └─────────────────┘


    ┌──────────────────────────────────────────────┐
    │              DECAY BRANCH (STM)              │
    └──────────────────────────────────────────────┘

    ┌─────────────────┐
    │ applyDecay()    │
    │  runs every N   │
    │  minutes        │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │ strength *= exp(-decay×days)│
    │ (Ebbinghaus forgetting curve) │
    └────────┬────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │ strength < 0.2  │─────No────▶ Keep in STM
    │ AND age > 30d   │
    └────────┬────────┘
             │ Yes
             ▼
    ┌─────────────────────────────┐
    │ Archive to memories_archive │
    │ Delete vector index         │
    │ Keep for audit/history      │
    └─────────────────────────────┘
```

### Classification Rules

| Memory Type                                                                                    | Store | Decay Rate    | Examples                   |
| ---------------------------------------------------------------------------------------------- | ----- | ------------- | -------------------------- |
| `preference`, `constraint`, `decision`, `requirement`, `architecture`, `configuration`, `rule` | LTM   | `0.0` (never) | "User prefers no comments" |
| `learning`, `procedural`, `how-to`, `guide`, `tutorial`, `workflow`, `process`                 | LTM   | `0.01` (slow) | "How to migrate schemas"   |
| `episodic`, `chat`, `conversation`, `greeting`, `casual`, `question`, `answer`, `exchange`     | STM   | `0.05` (fast) | "Good morning"             |
| All others (default)                                                                           | STM   | `0.05` (fast) | Uncategorized entries      |

---

## 6. Search Pipeline

The search pipeline is implemented in `VectorSearch` (`src/services/sqlite/vector-search.ts`) and operates in **6 stages**:

### Stage 1: Query Embedding

- Attempts local/API embedding with 30-second timeout
- On failure: marks `degraded=true`, proceeds with text-only search

### Stage 2: Shard Resolution

- `scope="project"` → search shards matching current project hash
- `scope="all-projects"` → search all project shards
- `scope="user"` → search user-scoped shards

### Stage 3: Backend Search (per shard)

**Over-fetch strategy**: starts at 2.0x `limit`; if fill ratio < 85%, retries up to 8.0x.

```
contentVector.search(queryVector, limit × multiplier)
  → {id, distance}

tagsVector.search(queryVector, limit × multiplier)
  → {id, distance}
```

Distances converted to similarities: `sim = 1 - distance`.

### Stage 4: FTS5 Fallback / Boost

```sql
SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?
```

- Sanitizes query: strips `*^:-+?()"` and FTS5 reserved words
- If FTS5 fails → `LIKE '%word%'` fallback
- FTS5 hits receive `+0.1` boost in hybrid scoring

### Stage 5: Hybrid Scoring & Hydration

For each candidate memory:

```
vectorSimilarity = contentSim × 0.6 + max(tagsSim, exactMatchBoost) × 0.4 + ftsBoost

finalSimilarity = strength × 0.4 + recencyScore × 0.3 + vectorSimilarity × 0.3

finalScore = finalSimilarity × contextBoost(projectPath, projectName, files, queries)
```

- **Tag exact match boost**: `matching_tags / max(query_words, 1)`
- **Context boost**: `1.5` (default) for project path/name match; `√1.5` for metadata file references

Sorting: `is_pinned DESC → finalScore DESC`

### Stage 6: Diversity Filtering

Greedy selection with Jaccard similarity penalty:

```
for candidate in sortedResults:
    penalty = max_jaccard_similarity(candidate, selected) > threshold
              ? (sim - threshold) / (1 - threshold)
              : 0

    penalizedScore = finalScore × (1 - penalty)

    if penalizedScore > 0.01 OR selected.length < limit/2:
        selected.push(candidate)
```

- Word-level Jaccard on words > 4 chars
- Default threshold: `0.9` (very strict)
- Global diversity applied across all shard results

### Access Count Update

After final selection, `UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN (results)`

---

## 7. Storage Architecture

### 7.1 Directory Layout

```
~/.opencode-mem0/data/
├── metadata.db                    # Shard registry + schema_version
├── user-profiles.db               # User profile store
├── transcripts.db                 # Session transcript store
├── users/
│   └── user_<hash>_shard_0.db     # User-scoped memories
└── projects/
    ├── project_<hash>_shard_0.db  # Project-scoped memories (active)
    ├── project_<hash>_shard_1.db  # Auto-created when shard_0 full
    └── project_<other>_shard_0.db # Other projects
```

### 7.2 Sharding Strategy

- **Scope**: Every memory is either `user`-scoped or `project`-scoped
- **Container Tag Format**: `mem_<scope>_<hash>` where hash = SHA256 of project path or user email
- **Shard Splitting**: When `vector_count >= maxVectorsPerShard` (default 50,000):
  1. Mark current shard `is_active = 0` (read-only)
  2. Create new shard with `shard_index + 1`
  3. Writes go to new shard; searches scan all shards in the scope
- **Validation**: On read, validates shard file exists and `memories` table present; auto-recreates if corrupt

### 7.3 Connection Management

- **WAL Mode**: All SQLite connections use `PRAGMA journal_mode = WAL` for concurrent read/write
- **Connection Pool**: Lazy-initialized `Map<dbPath, Database>` in `ConnectionManager`
- **Batch Writes**: `batchWrite()` queues INSERTs and flushes in a single transaction every N items or on explicit `flushBatch()`
- **Checkpointing**: `connectionManager.checkpointAll()` called during idle processing to shrink WAL files

### 7.4 Per-Project Isolation

- Each project gets independent shard(s) in `projects/`
- Searches default to `project` scope (current project only)
- `all-projects` scope flattens results across all project shards
- User-scoped memories (profiles, global preferences) live in `users/`

---

## 8. Cross-Platform Runtime Abstraction

### 8.1 HTTP Server Abstraction

`src/services/platform-server.ts` provides a unified `serve()` interface:

```typescript
interface PlatformServer {
  stop(): void;
  requestIP(req: Request): { address: string } | null;
}

function serve(options: ServeOptions): Promise<PlatformServer>;
```

**Bun path** (`typeof Bun !== 'undefined'`):

- Uses native `Bun.serve(options)`
- Zero-copy Request/Response
- Native `requestIP()` via `BunServer.requestIP(req)`

**Node.js path**:

- Uses `node:http.createServer()`
- Streams body with 256 KiB max payload limit (413 on overflow)
- Converts `IncomingMessage` → `Request` via `normalizeHeaders()`
- Attaches remote address via `Symbol.for("opencode-mem0.remoteAddress")`

### 8.2 SQLite Bootstrap

`src/services/sqlite/sqlite-bootstrap.ts` abstracts the SQLite driver:

- **Bun**: Uses `bun:sqlite` (native, fastest)
- **Node.js**: Uses `better-sqlite3` (C++ bindings)
- Both expose identical `Database` interface with `.prepare()`, `.run()`, `.get()`, `.all()`, `.transaction()`

### 8.3 Vector Backend Abstraction

`src/services/vector-backends/types.ts` defines the `VectorBackend` contract:

```typescript
interface VectorBackend {
  getBackendName(): string;
  insert(args: { id; vector; shard; kind }): Promise<void>;
  insertBatch(args: { items; shard; kind }): Promise<void>;
  delete(args: { id; shard; kind }): Promise<void>;
  search(args: { db; shard; kind; queryVector; limit }): Promise<{ id; distance }[]>;
  rebuildFromShard(args: { db; shard; kind }): Promise<void>;
  deleteShardIndexes(args: { shard }): Promise<void>;
}
```

| Backend        | Implementation                                                | Use Case                          |
| -------------- | ------------------------------------------------------------- | --------------------------------- |
| **usearch**    | `usearch-backend.ts` — loads `usearch` npm package (C++ HNSW) | Production, fast ANN              |
| **nsw**        | `nsw-backend.ts` — pure-JS HNSW implementation                | Fallback when usearch unavailable |
| **exact-scan** | `exact-scan-backend.ts` — brute-force cosine over all rows    | Guaranteed availability, slower   |

**Factory** (`backend-factory.ts`) implements `usearch-first` / `usearch` / `exact-scan` strategies with automatic fallback:

- Probes `usearch` import at startup
- If probe fails → exact-scan
- If search fails at runtime → degrades to exact-scan for that operation

---

## 9. Extension Points

### 9.1 Vector Backends

Implement `VectorBackend` interface and register via `createVectorBackend({ createUSearchBackend, createNSWBackend })`:

```typescript
import type { VectorBackend } from "./services/vector-backends/types.js";

class MyBackend implements VectorBackend {
  getBackendName() {
    return "my-backend";
  }
  async insert(args) {
    /* ... */
  }
  async search(args) {
    /* ... */
  }
  // ... all methods
}
```

### 9.2 AI Providers

Extend `BaseAIProvider` and register in `AIProviderFactory`:

1. Create `src/services/ai/providers/my-provider.ts`
2. Extend `BaseAIProvider` (handles retries, rate limiting, error normalization)
3. Implement `executeToolCall(systemPrompt, userPrompt, toolSchema, sessionID)`
4. Register in `AIProviderFactory.createProvider()` switch statement
5. Add to `AIProviderType` union in `session-types.ts`

Supported out-of-the-box:

- **OpenAI Chat Completions** (`openai-chat`) — Generic OpenAI-compatible (DeepSeek, Groq, etc.)
- **OpenAI Responses** (`openai-responses`) — Stateful sessions
- **Anthropic Messages** (`anthropic`) — Claude with session support
- **Google Gemini** (`google-gemini`) — Native Gemini API

### 9.3 Memory Types & Scoring

Add new memory types to scoring heuristics:

- Edit `TECHNICAL_KEYWORDS` array in `memory-scoring.ts` for importance detection
- Edit `LTM_TYPES` / `STM_TYPES` / `SLOW_DECAY_LTM_TYPES` in `memory-lifecycle.ts` for store classification
- Edit `HIGH_IMPORTANCE_TYPES` / `MEDIUM_IMPORTANCE_TYPES` / `LOW_IMPORTANCE_TYPES` for type-based scoring

### 9.4 Query Intent & Retrieval Context

Extend `analyzeQueryIntent()` in `retrieval-context.ts`:

- Add keyword arrays for new intents
- Modify `scoreMemoryRelevance()` for intent→type alignment rules
- Adjust `calculateContextBoost()` for new context signals

### 9.5 Web UI

The web UI (`src/web/app.js`, `src/web/index.html`) is a vanilla JavaScript SPA:

- Add new API routes in `api-handlers.ts`
- Add new UI panels in `app.js` (no build step required)
- Static assets served from `src/web/` directory at runtime

---

## 10. AI Provider Ecosystem

### Provider Configuration Resolution

1. **Opencode Provider** (recommended): If `opencodeProvider` + `opencodeModel` are set, uses OpenCode's already-authenticated provider (Claude Pro/Max via OAuth, or any API key configured in OpenCode). No separate key needed.
2. **Manual Config**: Falls back to `memoryProvider` + `memoryModel` + `memoryApiUrl` + `memoryApiKey` for standalone operation.

### Session Retention

- **OpenAI Responses**: Native `previous_response_id` chaining
- **Anthropic**: Conversation history managed in `AISessionManager`
- **OpenAI Chat / Gemini**: Stateless per-call (history tracked in `AISessionManager` for context)

### Cleanup

`AIProviderFactory.startCleanupSchedule(3600*1000)` purges sessions older than `aiSessionRetentionDays` (default 7 days).

---

## 11. Security & Privacy Model

### Content Filtering

| Stage      | Mechanism                                                                                | File                 |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------- |
| **Ingest** | `stripPrivateContent()` — redacts emails, tokens, keys with `[REDACTED]`                 | `privacy.ts`         |
| **Ingest** | `isFullyPrivate()` — blocks content that is 100% private material                        | `privacy.ts`         |
| **Config** | `resolveSecretValue()` — supports `file://` and `env://` references so keys never inline | `secret-resolver.ts` |
| **Config** | Config file created with `0o600` permissions                                             | `config.ts`          |

### Web UI Security

- **Localhost-only by default**: `webServerHost = "127.0.0.1"`
- **API Key mode**: When binding to `0.0.0.0`, require `x-opencode-mem-key` header matching `webServerApiKey`
- **No CORS**: Not designed for cross-origin use

### Database Security

- All databases stored in user's home directory (`~/.opencode-mem0/`)
- WAL mode prevents corruption on crash
- Atomic transactions for all write operations (memories, conflicts, profiles)
- Rollback on vector backend failure during insert

---

## Appendix: Key Configuration Defaults

| Parameter                                    | Default                      | Description                       |
| -------------------------------------------- | ---------------------------- | --------------------------------- |
| `embeddingModel`                             | `Xenova/nomic-embed-text-v1` | 768-dim local model               |
| `similarityThreshold`                        | `0.6`                        | Min similarity for search results |
| `maxVectorsPerShard`                         | `50000`                      | Auto-shard threshold              |
| `memoryLifecycle.stmDecayDays`               | `7`                          | STM half-life                     |
| `memoryLifecycle.ltmDecayDays`               | `90`                         | LTM half-life                     |
| `retrieval.diversityThreshold`               | `0.9`                        | Jaccard diversity cutoff          |
| `retrieval.contextBoost`                     | `1.5`                        | Context match multiplier          |
| `memoryScoring.recalculationIntervalMinutes` | `60`                         | Background scoring period         |
| `webServerPort`                              | `4747`                       | Web UI port                       |
| `transcriptStorage.maxAgeDays`               | `30`                         | Transcript retention              |
| `autoCleanupRetentionDays`                   | `30`                         | Memory auto-delete age            |

---

_Generated from source analysis. Architecture reflects v2.16 codebase state._
