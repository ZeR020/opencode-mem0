# Configuration Guide

This document describes every available configuration option for **opencode-mem0**, including defaults, allowed values, and practical examples.

---

## Table of Contents

- [Configuration File Location](#configuration-file-location)
- [Configuration Format](#configuration-format)
- [Quick Start Examples](#quick-start-examples)
  - [Minimal Configuration](#minimal-configuration)
  - [Full Configuration](#full-configuration)
  - [Custom Provider Example](#custom-provider-example)
- [Complete Option Reference](#complete-option-reference)
  - [Storage](#storage)
  - [Web Server](#web-server)
  - [Auto Capture](#auto-capture)
  - [Transcript Storage](#transcript-storage)
  - [Memory Scoring](#memory-scoring)
  - [Memory Lifecycle](#memory-lifecycle)
  - [Retrieval](#retrieval)
  - [AI Provider](#ai-provider)
  - [Embedding](#embedding)
  - [Memory Scope](#memory-scope)
  - [User Profile](#user-profile)
  - [Deduplication & Cleanup](#deduplication--cleanup)
  - [Injection & Search](#injection--search)
  - [Contextual Decay](#contextual-decay)
  - [Notifications](#notifications)
  - [Logging](#logging)
- [Environment Variable Overrides](#environment-variable-overrides)
- [Security Considerations](#security-considerations)
- [Migration Notes](#migration-notes)
- [Project-Level Configuration](#project-level-configuration)

---

## Configuration File Location

opencode-mem0 reads its configuration from the following locations (in order):

| Priority | Path                                     | Description               |
| -------- | ---------------------------------------- | ------------------------- |
| 1        | `~/.config/opencode/opencode-mem0.jsonc` | **Primary** — recommended |
| 2        | `~/.config/opencode/opencode-mem0.json`  | Fallback (no comments)    |
| 3        | `./.opencode/opencode-mem0.jsonc`        | Project-level override    |
| 4        | `./.opencode/opencode-mem0.json`         | Project-level fallback    |

> **Note:** If both global and project-level configs exist, they are **deep-merged** with project-level values taking precedence.

If no configuration file exists, a template with all options commented out is automatically created at `~/.config/opencode/opencode-mem0.jsonc` on first run.

---

## Configuration Format

The configuration file uses **JSON with Comments (JSONC)** — standard JSON syntax plus `//` and `/* */` comments. This allows inline documentation without affecting parsing.

```jsonc
{
  // This is a comment
  "storagePath": "~/.opencode-mem0/data",
}
```

All configuration options are optional. Any missing key falls back to its built-in default.

---

## Quick Start Examples

### Minimal Configuration

The bare minimum to get started with local embeddings and auto-capture disabled:

```jsonc
{
  // Local mode: uses built-in Xenova embeddings, no external API needed
  "webServerEnabled": true,
  "autoCaptureEnabled": false,
}
```

With this configuration:

- Memories are stored in `~/.opencode-mem0/data`
- The Web UI runs at `http://127.0.0.1:4747`
- No AI provider is configured (auto-capture is off)
- Local `Xenova/nomic-embed-text-v1` model handles embeddings

### Full Configuration

Every available option with its default value, suitable as a starting point for customization:

```jsonc
{
  "storagePath": "~/.opencode-mem0/data",
  "userEmailOverride": "",
  "userNameOverride": "",

  "memory": {
    "defaultScope": "project",
  },

  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "embeddingDimensions": 768,
  "similarityThreshold": 0.6,
  "maxMemories": 10,
  "maxProfileItems": 5,
  "injectProfile": true,
  "containerTagPrefix": "opencode",

  "vectorBackend": "usearch-first",
  "maxVectorsPerShard": 50000,

  "autoCaptureEnabled": true,
  "autoCaptureMaxIterations": 5,
  "autoCaptureIterationTimeout": 30000,
  "autoCaptureLanguage": "auto",

  "memoryProvider": "openai-chat",
  "memoryModel": "gpt-4o-mini",
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "sk-...",
  "memoryTemperature": 0.3,

  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-3-5-haiku-20241022",

  "aiSessionRetentionDays": 7,

  "webServerEnabled": true,
  "webServerPort": 4747,
  "webServerHost": "127.0.0.1",
  "webServerApiKey": "",

  "autoCleanupEnabled": true,
  "autoCleanupRetentionDays": 30,
  "deduplicationEnabled": true,
  "deduplicationSimilarityThreshold": 0.9,
  "deduplicationIngestEnabled": true,

  "userProfileAnalysisInterval": 10,
  "userProfileMaxPreferences": 20,
  "userProfileMaxPatterns": 15,
  "userProfileMaxWorkflows": 10,
  "userProfileConfidenceDecayDays": 30,
  "userProfileChangelogRetentionCount": 5,

  "showAutoCaptureToasts": true,
  "showUserProfileToasts": true,
  "showErrorToasts": true,

  "transcriptStorage": {
    "enabled": true,
    "maxAgeDays": 30,
  },

  "memoryScoring": {
    "enabled": true,
    "recalculationIntervalMinutes": 60,
    "recencyHalfLifeDays": 7,
    "utilityHalfLifeDays": 3,
  },

  "memoryLifecycle": {
    "stmDecayDays": 7,
    "ltmDecayDays": 90,
    "promotionThreshold": 0.7,
    "archiveThreshold": 0.2,
    "archiveAfterDays": 30,
    "checkIntervalMinutes": 60,
  },

  "compaction": {
    "enabled": true,
    "memoryLimit": 10,
  },

  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "injectOn": "first",
    "maxAgeDays": 30,
  },

  "retrieval": {
    "maxResults": 20,
    "diversityThreshold": 0.9,
    "contextBoost": 1.5,
  },

  "injection": {
    "tokenBudget": 4000,
    "format": "plain",
    "queryAwareFiltering": true,
    "relevanceThreshold": 0.3,
  },

  "contextualDecay": {
    "enabled": true,
    "baseDecayRate": 0.05,
    "strengthBoostFactor": 0.5,
    "accessBoostFactor": 0.3,
    "minDecayRate": 0.005,
    "maxDecayRate": 0.15,
  },

  "logLevel": "info",
  "warmupTimeoutMs": 30000,
}
```

### Custom Provider Example

Using DeepSeek for auto-capture with opencode's built-in provider for user profile analysis:

```jsonc
{
  "autoCaptureEnabled": true,

  // Use DeepSeek for memory auto-capture
  "memoryProvider": "openai-chat",
  "memoryModel": "deepseek-chat",
  "memoryApiUrl": "https://api.deepseek.com/v1",
  "memoryApiKey": "sk-...",

  // Use opencode's configured Anthropic provider for profile learning
  // (no separate API key needed — uses your existing opencode auth)
  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-3-5-haiku-20241022",

  // Local embeddings (no API key needed)
  "embeddingModel": "Xenova/nomic-embed-text-v1",

  "webServerEnabled": true,
  "webServerPort": 4747,
}
```

---

## Complete Option Reference

### Storage

| Option        | Type     | Default                 | Description                                                                              |
| ------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `storagePath` | `string` | `~/.opencode-mem0/data` | Directory for SQLite databases, vector indexes, and transcripts. Supports `~` expansion. |

### Web Server

| Option             | Type      | Default       | Description                                                                         |
| ------------------ | --------- | ------------- | ----------------------------------------------------------------------------------- |
| `webServerEnabled` | `boolean` | `true`        | Enable the Web UI for memory management.                                            |
| `webServerPort`    | `number`  | `4747`        | TCP port for the Web UI server.                                                     |
| `webServerHost`    | `string`  | `"127.0.0.1"` | Bind address. Use `127.0.0.1` for local-only; `0.0.0.0` for network access.         |
| `webServerApiKey`  | `string`  | _(none)_      | Optional API key. Required in `x-opencode-mem-key` header for non-localhost access. |

### Auto Capture

| Option                        | Type      | Default  | Description                                                                                          |
| ----------------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `autoCaptureEnabled`          | `boolean` | `true`   | Enable background AI analysis of conversations to extract memories.                                  |
| `autoCaptureMaxIterations`    | `number`  | `5`      | Maximum AI turns for multi-step memory extraction.                                                   |
| `autoCaptureIterationTimeout` | `number`  | `30000`  | Timeout per AI turn, in milliseconds.                                                                |
| `autoCaptureLanguage`         | `string`  | `"auto"` | Summary language. Options: `auto`, `en`, `id`, `zh`, `ja`, `es`, `fr`, `de`, `ru`, `pt`, `ar`, `ko`. |

### Transcript Storage

| Option                         | Type      | Default | Description                                          |
| ------------------------------ | --------- | ------- | ---------------------------------------------------- |
| `transcriptStorage.enabled`    | `boolean` | `true`  | Save full conversation transcripts for later review. |
| `transcriptStorage.maxAgeDays` | `number`  | `30`    | Delete transcripts older than this many days.        |

### Memory Scoring

Multi-dimensional scoring system that computes a strength score for each memory.

| Option                                       | Type      | Default | Description                                         |
| -------------------------------------------- | --------- | ------- | --------------------------------------------------- |
| `memoryScoring.enabled`                      | `boolean` | `true`  | Enable periodic score recalculation.                |
| `memoryScoring.recalculationIntervalMinutes` | `number`  | `60`    | How often to recompute all memory scores.           |
| `memoryScoring.recencyHalfLifeDays`          | `number`  | `7`     | Days until recency score halves (Ebbinghaus curve). |
| `memoryScoring.utilityHalfLifeDays`          | `number`  | `3`     | Days until utility score halves.                    |

### Memory Lifecycle

Dual-store system: **STM** (short-term, fast decay) and **LTM** (long-term, slow decay).

| Option                                 | Type     | Default | Description                                              |
| -------------------------------------- | -------- | ------- | -------------------------------------------------------- |
| `memoryLifecycle.stmDecayDays`         | `number` | `7`     | Days for STM memory strength to decay significantly.     |
| `memoryLifecycle.ltmDecayDays`         | `number` | `90`    | Days for LTM memory strength to decay.                   |
| `memoryLifecycle.promotionThreshold`   | `number` | `0.7`   | Minimum strength score for STM → LTM promotion.          |
| `memoryLifecycle.archiveThreshold`     | `number` | `0.2`   | Strength score below which memories are archived.        |
| `memoryLifecycle.archiveAfterDays`     | `number` | `30`    | Minimum age (days) before a weak memory can be archived. |
| `memoryLifecycle.checkIntervalMinutes` | `number` | `60`    | How often to run the lifecycle check.                    |

### Retrieval

Controls how memories are fetched and ranked during search.

| Option                         | Type     | Default | Description                                                                                  |
| ------------------------------ | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `retrieval.maxResults`         | `number` | `20`    | Maximum memories returned per search query.                                                  |
| `retrieval.diversityThreshold` | `number` | `0.9`   | Similarity ceiling above which duplicate results are penalized. Higher = stricter diversity. |
| `retrieval.contextBoost`       | `number` | `1.5`   | Multiplier for memories matching the current project/files. `1.5` = 50% boost.               |

### AI Provider

Two provider systems operate independently:

| Option              | Type              | Default         | Description                                                                                              |
| ------------------- | ----------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `memoryProvider`    | `string`          | `"openai-chat"` | Provider for **auto-capture**. Options: `openai-chat`, `openai-responses`, `anthropic`, `google-gemini`. |
| `memoryModel`       | `string`          | _(none)_        | Model name for auto-capture (e.g., `gpt-4o-mini`).                                                       |
| `memoryApiUrl`      | `string`          | _(none)_        | Base URL for the auto-capture API.                                                                       |
| `memoryApiKey`      | `string`          | _(none)_        | API key for auto-capture. Supports `env://` and `file://` prefixes.                                      |
| `memoryTemperature` | `number \| false` | _(none)_        | Sampling temperature. Set to `false` for models that don't support it (e.g., o1, o3).                    |
| `memoryExtraParams` | `object`          | _(none)_        | Additional parameters sent in the API request body (e.g., `{ "enable_thinking": false }`).               |
| `opencodeProvider`  | `string`          | _(none)_        | **Recommended.** Use opencode's built-in provider for user profile learning. No extra API key needed.    |
| `opencodeModel`     | `string`          | _(none)_        | Model name within the opencode provider.                                                                 |

### Embedding

| Option                | Type     | Default                        | Description                                                        |
| --------------------- | -------- | ------------------------------ | ------------------------------------------------------------------ |
| `embeddingModel`      | `string` | `"Xenova/nomic-embed-text-v1"` | Model for generating memory embeddings.                            |
| `embeddingDimensions` | `number` | `768`                          | Vector dimensions. Auto-detected for known models.                 |
| `embeddingApiUrl`     | `string` | _(none)_                       | Optional OpenAI-compatible API for embeddings.                     |
| `embeddingApiKey`     | `string` | _(none)_                       | API key for external embeddings. Supports `env://` and `file://`.  |
| `similarityThreshold` | `number` | `0.6`                          | Minimum similarity score (0–1) for search results.                 |
| `vectorBackend`       | `string` | `"usearch-first"`              | Search backend. Options: `usearch-first`, `usearch`, `exact-scan`. |
| `maxVectorsPerShard`  | `number` | `50000`                        | Shard size before automatic database splitting.                    |

### Memory Scope

| Option                | Type     | Default     | Description                                                                                 |
| --------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------- |
| `memory.defaultScope` | `string` | `"project"` | Default search scope. `"project"` = current project only; `"all-projects"` = global search. |

### User Profile

| Option                               | Type      | Default  | Description                                                             |
| ------------------------------------ | --------- | -------- | ----------------------------------------------------------------------- |
| `userEmailOverride`                  | `string`  | _(none)_ | Override email displayed in the Web UI.                                 |
| `userNameOverride`                   | `string`  | _(none)_ | Override name displayed in the Web UI.                                  |
| `userProfileAnalysisInterval`        | `number`  | `10`     | Analyze every N uncaptured prompts to update your profile.              |
| `userProfileMaxPreferences`          | `number`  | `20`     | Maximum preferences stored (e.g., "likes concise responses").           |
| `userProfileMaxPatterns`             | `number`  | `15`     | Maximum behavior patterns stored.                                       |
| `userProfileMaxWorkflows`            | `number`  | `10`     | Maximum workflow patterns stored.                                       |
| `userProfileConfidenceDecayDays`     | `number`  | `30`     | Days before un-reinforced preferences lose confidence.                  |
| `userProfileChangelogRetentionCount` | `number`  | `5`      | Number of profile versions kept for debugging.                          |
| `injectProfile`                      | `boolean` | `true`   | Inject user profile (preferences, patterns, workflows) into AI context. |

### Deduplication & Cleanup

| Option                             | Type      | Default | Description                                         |
| ---------------------------------- | --------- | ------- | --------------------------------------------------- |
| `autoCleanupEnabled`               | `boolean` | `true`  | Automatically purge old memories and transcripts.   |
| `autoCleanupRetentionDays`         | `number`  | `30`    | Age threshold for automatic deletion.               |
| `deduplicationEnabled`             | `boolean` | `true`  | Detect and skip storing duplicate memories.         |
| `deduplicationSimilarityThreshold` | `number`  | `0.9`   | Similarity threshold for duplicate detection.       |
| `deduplicationIngestEnabled`       | `boolean` | `true`  | Apply deduplication during memory ingestion.        |
| `compaction.enabled`               | `boolean` | `true`  | Compact database when memory count exceeds limit.   |
| `compaction.memoryLimit`           | `number`  | `10`    | Threshold (in thousands) for triggering compaction. |

### Injection & Search

| Option                              | Type      | Default   | Description                                                                    |
| ----------------------------------- | --------- | --------- | ------------------------------------------------------------------------------ |
| `maxMemories`                       | `number`  | `10`      | Maximum memories injected into the AI context per message.                     |
| `maxProfileItems`                   | `number`  | `5`       | Maximum profile items injected into the AI context.                            |
| `injection.tokenBudget`             | `number`  | `4000`    | Maximum tokens allocated for memory injection.                                 |
| `injection.format`                  | `string`  | `"plain"` | Injection format. Options: `plain`, `xml`, `yaml`.                             |
| `injection.queryAwareFiltering`     | `boolean` | `true`    | Filter injected memories by query relevance.                                   |
| `injection.relevanceThreshold`      | `number`  | `0.3`     | Minimum relevance score for injection.                                         |
| `chatMessage.enabled`               | `boolean` | `true`    | Inject memories into chat context.                                             |
| `chatMessage.maxMemories`           | `number`  | `3`       | Maximum memories per chat message injection.                                   |
| `chatMessage.excludeCurrentSession` | `boolean` | `true`    | Exclude memories from the current session.                                     |
| `chatMessage.injectOn`              | `string`  | `"first"` | When to inject. `"first"` = only on first message; `"always"` = every message. |
| `chatMessage.maxAgeDays`            | `number`  | _(none)_  | Maximum age of injected memories (undefined = no limit).                       |

### Contextual Decay

Gradual memory weakening based on access patterns.

| Option                                | Type      | Default | Description                         |
| ------------------------------------- | --------- | ------- | ----------------------------------- |
| `contextualDecay.enabled`             | `boolean` | `true`  | Enable contextual decay.            |
| `contextualDecay.baseDecayRate`       | `number`  | `0.05`  | Base daily decay rate (0–1).        |
| `contextualDecay.strengthBoostFactor` | `number`  | `0.5`   | How much high strength slows decay. |
| `contextualDecay.accessBoostFactor`   | `number`  | `0.3`   | How much recent access slows decay. |
| `contextualDecay.minDecayRate`        | `number`  | `0.005` | Floor for decay rate.               |
| `contextualDecay.maxDecayRate`        | `number`  | `0.15`  | Ceiling for decay rate.             |

### Notifications

| Option                  | Type      | Default | Description                                     |
| ----------------------- | --------- | ------- | ----------------------------------------------- |
| `showAutoCaptureToasts` | `boolean` | `true`  | Show notification when a memory is captured.    |
| `showUserProfileToasts` | `boolean` | `true`  | Show notification when user profile is updated. |
| `showErrorToasts`       | `boolean` | `true`  | Show notification on errors.                    |

### Logging

| Option            | Type     | Default  | Description                                            |
| ----------------- | -------- | -------- | ------------------------------------------------------ |
| `logLevel`        | `string` | `"info"` | Verbosity. Options: `debug`, `info`, `warn`, `error`.  |
| `warmupTimeoutMs` | `number` | `30000`  | Maximum time (ms) to wait for model warmup on startup. |

---

## Environment Variable Overrides

API keys support three resolution formats to avoid hardcoding secrets in config files:

| Format      | Example                             | Description                                      |
| ----------- | ----------------------------------- | ------------------------------------------------ |
| Direct      | `"sk-..."`                          | Plain text (not recommended for shared configs). |
| Environment | `"env://OPENAI_API_KEY"`            | Reads from the named environment variable.       |
| File        | `"file://~/.config/openai-key.txt"` | Reads the first line from the specified file.    |

Supported fields: `memoryApiKey`, `embeddingApiKey`, `webServerApiKey`.

> **Tip:** For `embeddingApiKey`, if the key is omitted but `embeddingApiUrl` is set, the plugin automatically falls back to the `OPENAI_API_KEY` environment variable.

---

## Security Considerations

1. **Config file permissions** — The template is created with mode `0o600` (owner read/write only). Ensure your config file is not world-readable if it contains API keys.
2. **Web UI access** — By default, the Web UI binds to `127.0.0.1` (localhost only). If you change `webServerHost` to `0.0.0.0`, **always** set `webServerApiKey` to prevent unauthorized access.
3. **API key storage** — Prefer `env://` or `file://` references over inline keys. Never commit a config file containing real API keys to version control.
4. **Auto-capture data** — Auto-capture sends conversation snippets to your configured AI provider. Ensure you trust the provider and understand their data retention policies.

---

## Migration Notes

- **Schema upgrades are automatic.** The plugin detects the current database version and applies migrations on startup. No manual intervention is required.
- **Data migration from v1** — If a `~/.opencode-mem` directory exists and `~/.opencode-mem0` does not, data is automatically copied on first run.
- **Config keys are additive.** New releases may introduce new options with sensible defaults. Existing configurations continue to work without modification.

---

## Project-Level Configuration

You can override global settings per-project by creating a config file in your project directory:

```
my-project/
  .opencode/
    opencode-mem0.jsonc   ← Project-level overrides
```

Project-level configs are **deep-merged** with the global config. Only specify the values you want to change:

```jsonc
{
  // Use a separate data directory for this project
  "storagePath": "./.opencode-mem0-data",

  // Disable auto-capture for sensitive projects
  "autoCaptureEnabled": false,

  // Different memory scope
  "memory": {
    "defaultScope": "all-projects",
  },
}
```

This is useful for:

- Isolating sensitive project memories
- Using different AI providers per project
- Disabling features (e.g., auto-capture) for specific codebases
