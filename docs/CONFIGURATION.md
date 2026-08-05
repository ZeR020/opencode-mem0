<!-- generated-by: gsd-doc-writer -->

# Configuration

opencode-mem0 is configured via a JSON/JSONC config file. All settings are optional — the plugin works out of the box with sensible defaults using local embedding models and SQLite storage.

## Config File Location

The plugin loads configuration from these paths in order (first found wins):

| Priority | Path                                      | Scope   |
| -------- | ----------------------------------------- | ------- |
| 1        | `~/.config/opencode/opencode-mem0.jsonc`  | Global  |
| 2        | `~/.config/opencode/opencode-mem0.json`   | Global  |
| 3        | `<project>/.opencode/opencode-mem0.jsonc` | Project |
| 4        | `<project>/.opencode/opencode-mem0.json`  | Project |

Project-level config is **deep-merged** on top of global config, so you only need to specify overrides. The `.jsonc` extension supports JSON with comments.

**Example minimal config** (`~/.config/opencode/opencode-mem0.jsonc`):

```jsonc
{
  // Override user identity
  "userNameOverride": "Jane",
  "userEmailOverride": "jane@example.com",

  // Use remote OpenAI embeddings instead of local
  "embeddingApiUrl": "https://api.openai.com/v1",
  "embeddingApiKey": "env://OPENAI_API_KEY",
  "embeddingModel": "text-embedding-3-small",

  // Use Anthropic for memory analysis
  "memoryProvider": "anthropic",
  "memoryModel": "claude-sonnet-4-20250514",
  "memoryApiUrl": "https://api.anthropic.com/v1",
  "memoryApiKey": "env://ANTHROPIC_API_KEY",
}
```

## Environment Variables

| Variable                 | Required | Default                              | Description                                                                                                                      |
| ------------------------ | -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | Optional | —                                    | Fallback API key for remote embeddings when `embeddingApiUrl` is set and `embeddingApiKey` is not configured.                    |
| `OPENCODE_MEM_LOG_LEVEL` | Optional | `info`                               | Overrides log level at startup (before config file is read). Values: `debug`, `info`, `warn`, `error`.                           |
| `OPENCODE_MEM_LOG_FILE`  | Optional | `~/.opencode-mem0/opencode-mem0.log` | Override log file path. Set to a filepath to redirect logs; unset disables file logging if the data directory doesn't exist yet. |
| `USER`                   | Optional | —                                    | Fallback username for user identity tagging when no git config or override is available.                                         |
| `USERNAME`               | Optional | —                                    | Fallback username on Windows systems (same purpose as `USER`).                                                                   |

## Secret Resolution

API key fields (`embeddingApiKey`, `memoryApiKey`) support three value formats:

| Format           | Example                                                              | Behavior                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain string     | `"sk-abc123"`                                                        | Used directly                                                                                                                                                                             |
| `env://` prefix  | `"env://OPENAI_API_KEY"`                                             | Reads the named environment variable at startup. Throws if the variable is not set.                                                                                                       |
| `file://` prefix | `"file:///run/secrets/api_key"` or `"file://~/.config/opencode/key"` | Reads the file contents (trimmed). Supports `~` home expansion. Checks permissions and warns if group/other readable. Throws if the file doesn't exist or contains path traversal (`..`). |

## Core Settings

| Setting              | Type                                     | Default                 | Description                                                                                    |
| -------------------- | ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `storagePath`        | `string`                                 | `~/.opencode-mem0/data` | Root directory for SQLite databases and vector indexes. Supports `~` expansion.                |
| `userEmailOverride`  | `string`                                 | —                       | Override the user email identity (normally auto-detected from git config).                     |
| `userNameOverride`   | `string`                                 | —                       | Override the user display name.                                                                |
| `containerTagPrefix` | `string`                                 | `"opencode"`            | Prefix for internal memory container tags. Change only if running multiple isolated instances. |
| `logLevel`           | `"debug" \| "info" \| "warn" \| "error"` | `"info"`                | Plugin log verbosity.                                                                          |
| `warmupTimeoutMs`    | `number`                                 | `30000`                 | Maximum milliseconds to wait for the local embedding model to load on startup.                 |

## Memory Settings

| Setting               | Type                          | Default     | Description                                                                                                                  |
| --------------------- | ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `memory.defaultScope` | `"project" \| "all-projects"` | `"project"` | Default scope when storing memories. `"project"` isolates memories per project; `"all-projects"` shares across all projects. |
| `maxMemories`         | `number`                      | `10`        | Maximum memories injected into a single chat context.                                                                        |
| `injectProfile`       | `boolean`                     | `true`      | Whether to include user profile data in injected context.                                                                    |
| `similarityThreshold` | `number` (0–1)                | `0.6`       | Minimum cosine similarity for a memory to be considered relevant during search.                                              |

## Embedding Settings

| Setting               | Type     | Default                                | Description                                                                                                                                             |
| --------------------- | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `embeddingModel`      | `string` | `"Xenova/nomic-embed-text-v1"`         | Model identifier. Local Xenova models run via `@huggingface/transformers`; remote API models (e.g. `text-embedding-3-small`) require `embeddingApiUrl`. |
| `embeddingDimensions` | `number` | Auto-detected from model               | Vector dimensions. Auto-detected from the model name for known models; falls back to `768` for unknown models.                                          |
| `embeddingApiUrl`     | `string` | —                                      | Base URL for a remote OpenAI-compatible embeddings API (e.g. `https://api.openai.com/v1`). When set, remote API is used instead of local model.         |
| `embeddingApiKey`     | `string` | Falls back to `OPENAI_API_KEY` env var | API key for the remote embeddings endpoint. Supports [secret resolution](#secret-resolution). Only used when `embeddingApiUrl` is set.                  |

**Known embedding models and their auto-detected dimensions:**

| Model                                | Dimensions |
| ------------------------------------ | ---------- |
| `Xenova/nomic-embed-text-v1`         | 768        |
| `Xenova/all-MiniLM-L6-v2`            | 384        |
| `Xenova/all-mpnet-base-v2`           | 768        |
| `Xenova/bge-small-en-v1.5`           | 384        |
| `Xenova/bge-base-en-v1.5`            | 768        |
| `Xenova/jina-embeddings-v2-small-en` | 512        |
| `Xenova/GIST-small-Embedding-v0`     | 384        |
| `text-embedding-3-small`             | 1536       |
| `text-embedding-3-large`             | 3072       |
| `text-embedding-ada-002`             | 1536       |
| `embed-english-v3.0` (Cohere)        | 1024       |
| `voyage-3`                           | 1024       |
| `voyage-3-lite`                      | 512        |
| `text-embedding-004` (Google)        | 768        |

## AI Provider Settings

These configure the LLM used for memory analysis, auto-capture reasoning, and conflict resolution.

| Setting             | Type                                                                    | Default         | Description                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `memoryProvider`    | `"openai-chat" \| "openai-responses" \| "anthropic" \| "google-gemini"` | `"openai-chat"` | AI provider backend for memory operations.                                                                                             |
| `memoryModel`       | `string`                                                                | —               | Model identifier for the chosen provider (e.g. `gpt-4o`, `claude-sonnet-4-20250514`). **Required when using an external AI provider.** |
| `memoryApiUrl`      | `string`                                                                | —               | API base URL for the AI provider. **Required when using an external AI provider.**                                                     |
| `memoryApiKey`      | `string`                                                                | —               | API key for the AI provider. Supports [secret resolution](#secret-resolution).                                                         |
| `memoryTemperature` | `number \| false`                                                       | —               | Sampling temperature for AI calls. `false` disables temperature parameter.                                                             |
| `memoryExtraParams` | `Record<string, unknown>`                                               | —               | Additional provider-specific parameters passed to the AI SDK.                                                                          |
| `opencodeProvider`  | `string`                                                                | —               | Provider name hint for the host OpenCode instance (informational).                                                                     |
| `opencodeModel`     | `string`                                                                | —               | Model name hint for the host OpenCode instance (informational).                                                                        |

When `memoryModel` and `memoryApiUrl` are both set, the plugin routes memory analysis to that external API. When they are unset, the plugin falls back to the OpenCode host's built-in AI capabilities.

## Auto-Capture Settings

Auto-capture observes chat exchanges and automatically extracts memorable information.

| Setting                       | Type      | Default       | Description                                                                                                  |
| ----------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `autoCaptureEnabled`          | `boolean` | `true`        | Enable automatic memory extraction from conversations.                                                       |
| `promptTrackingEnabled`       | `boolean` | `true`        | Persist user prompts for profile learning (disable to stop prompt tracking while keeping memory injection).  |
| `profileLearningEnabled`      | `boolean` | `true`        | Learn user profile from idle sessions (disable to stop profile learning while keeping other idle features).  |
| `autoCaptureMaxIterations`    | `number`  | `5`           | Maximum LLM reasoning iterations per auto-capture call.                                                      |
| `autoCaptureIterationTimeout` | `number`  | `30000`       | Timeout in milliseconds per LLM iteration.                                                                   |
| `autoCaptureLanguage`         | `string`  | Auto-detected | Force a specific language for captured memories (ISO 639-3 code). Default uses automatic language detection. |
| `showAutoCaptureToasts`       | `boolean` | `true`        | Show toast notifications when memories are auto-captured.                                                    |

## Web UI Settings

| Setting            | Type      | Default       | Description                                                                                                                                                                        |
| ------------------ | --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webServerEnabled` | `boolean` | `true`        | Enable the management web UI.                                                                                                                                                      |
| `webServerPort`    | `number`  | `4747`        | Port for the web UI server.                                                                                                                                                        |
| `webServerHost`    | `string`  | `"127.0.0.1"` | Host binding for the web server. Defaults to loopback for security. **`webServerApiKey` is required if binding to a non-loopback address.**                                        |
| `webServerApiKey`  | `string`  | —             | API key for authenticating web UI requests. Required when `webServerHost` is not a loopback address (`127.0.0.1`, `localhost`, `::1`). Value is used as-is (no secret resolution). |

## Vector Search Settings

| Setting              | Type                                           | Default           | Description                                                                                                                                                     |
| -------------------- | ---------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vectorBackend`      | `"usearch-first" \| "usearch" \| "exact-scan"` | `"usearch-first"` | Vector search backend. `usearch-first` tries usearch and falls back to exact scan; `usearch` requires usearch; `exact-scan` uses brute-force cosine similarity. |
| `maxVectorsPerShard` | `number`                                       | `50000`           | Maximum vectors per SQLite shard file. New shards are created when this limit is reached.                                                                       |

## Memory Lifecycle Settings

Controls the STM → LTM promotion and archival pipeline based on Ebbinghaus-style decay.

| Setting                                | Type           | Default | Description                                                       |
| -------------------------------------- | -------------- | ------- | ----------------------------------------------------------------- |
| `memoryLifecycle.stmDecayDays`         | `number`       | `7`     | Days before a short-term memory begins decaying.                  |
| `memoryLifecycle.ltmDecayDays`         | `number`       | `90`    | Days before a long-term memory begins decaying.                   |
| `memoryLifecycle.promotionThreshold`   | `number` (0–1) | `0.7`   | Composite score threshold for promoting STM → LTM.                |
| `memoryLifecycle.archiveThreshold`     | `number` (0–1) | `0.2`   | Score below which a memory is archived.                           |
| `memoryLifecycle.archiveAfterDays`     | `number`       | `30`    | Minimum days before a memory can be archived regardless of score. |
| `memoryLifecycle.checkIntervalMinutes` | `number`       | `60`    | How often the lifecycle maintenance job runs.                     |

## Memory Scoring Settings

The 7-factor scoring system (recency, frequency, importance, utility, novelty, confidence, interference).

| Setting                                      | Type      | Default | Description                         |
| -------------------------------------------- | --------- | ------- | ----------------------------------- |
| `memoryScoring.enabled`                      | `boolean` | `true`  | Enable the memory scoring service.  |
| `memoryScoring.recalculationIntervalMinutes` | `number`  | `60`    | How often scores are recalculated.  |
| `memoryScoring.recencyHalfLifeDays`          | `number`  | `7`     | Half-life for recency factor decay. |
| `memoryScoring.utilityHalfLifeDays`          | `number`  | `3`     | Half-life for utility factor decay. |

## Chat Message Injection Settings

Controls how memories are injected into the OpenCode chat context.

| Setting                             | Type                   | Default       | Description                                                            |
| ----------------------------------- | ---------------------- | ------------- | ---------------------------------------------------------------------- |
| `chatMessage.enabled`               | `boolean`              | `true`        | Inject relevant memories into chat messages.                           |
| `chatMessage.maxMemories`           | `number`               | `3`           | Maximum memories injected per message.                                 |
| `chatMessage.excludeCurrentSession` | `boolean`              | `true`        | Don't inject memories from the current session.                        |
| `chatMessage.maxAgeDays`            | `number`               | — (unlimited) | Only inject memories newer than this many days.                        |
| `chatMessage.injectOn`              | `"first" \| "always"`  | `"first"`     | Inject on first message only (`first`) or every message (`always`).    |
| `chatMessage.mode`                  | `"relevant" \| "fast"` | `"relevant"`  | `relevant` uses full vector search; `fast` uses keyword matching only. |

## Retrieval Settings

| Setting                        | Type           | Default | Description                                                                           |
| ------------------------------ | -------------- | ------- | ------------------------------------------------------------------------------------- |
| `retrieval.maxResults`         | `number`       | `20`    | Maximum search results from hybrid retrieval.                                         |
| `retrieval.diversityThreshold` | `number` (0–1) | `0.9`   | Minimum dissimilarity between results for diversity filtering. Higher = more diverse. |
| `retrieval.contextBoost`       | `number`       | `1.5`   | Score multiplier for memories matching the current project/context.                   |

## Injection Settings

Controls the formatting and filtering of injected memory context.

| Setting                        | Type                         | Default   | Description                                                                         |
| ------------------------------ | ---------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `injection.tokenBudget`        | `number`                     | `4000`    | Maximum token count for the injected memory context.                                |
| `injection.format`             | `"plain" \| "xml" \| "yaml"` | `"plain"` | Output format for injected memories.                                                |
| `injection.relevanceThreshold` | `number` (0–1)               | `0.3`     | Minimum score for a memory to be included in injection after query-aware filtering. |

## Contextual Decay Settings

Time-based decay with boosts on access and relevance strength.

| Setting                               | Type           | Default | Description                                          |
| ------------------------------------- | -------------- | ------- | ---------------------------------------------------- |
| `contextualDecay.enabled`             | `boolean`      | `true`  | Enable contextual decay of memory scores.            |
| `contextualDecay.baseDecayRate`       | `number` (0–1) | `0.05`  | Base decay rate per day.                             |
| `contextualDecay.strengthBoostFactor` | `number` (0–1) | `0.5`   | Score boost when a memory's source strength is high. |
| `contextualDecay.accessBoostFactor`   | `number` (0–1) | `0.3`   | Score boost when a memory is accessed/retrieved.     |
| `contextualDecay.minDecayRate`        | `number` (0–1) | `0.005` | Minimum decay rate (prevents zero-decay edge cases). |
| `contextualDecay.maxDecayRate`        | `number` (0–1) | `0.15`  | Maximum decay rate (prevents too-aggressive decay).  |

## Transcript Storage Settings

| Setting                        | Type      | Default | Description                                                          |
| ------------------------------ | --------- | ------- | -------------------------------------------------------------------- |
| `transcriptStorage.enabled`    | `boolean` | `true`  | Store session transcripts for FTS5 search.                           |
| `transcriptStorage.maxAgeDays` | `number`  | `30`    | Maximum age in days before transcripts are automatically cleaned up. |

## Compaction Settings

| Setting                  | Type      | Default | Description                                                                |
| ------------------------ | --------- | ------- | -------------------------------------------------------------------------- |
| `compaction.enabled`     | `boolean` | `true`  | Enable memory compaction (merging related memories when limit is reached). |
| `compaction.memoryLimit` | `number`  | `10`    | Number of memories that triggers compaction for a given scope.             |

## Cleanup & Deduplication Settings

| Setting                            | Type           | Default | Description                                                              |
| ---------------------------------- | -------------- | ------- | ------------------------------------------------------------------------ |
| `autoCleanupEnabled`               | `boolean`      | `true`  | Automatically clean up old memories and transcripts.                     |
| `autoCleanupRetentionDays`         | `number`       | `30`    | Days to retain before auto-cleanup.                                      |
| `deduplicationEnabled`             | `boolean`      | `true`  | Enable deduplication of similar memories.                                |
| `deduplicationSimilarityThreshold` | `number` (0–1) | `0.9`   | Similarity threshold above which two memories are considered duplicates. |
| `deduplicationIngestEnabled`       | `boolean`      | `true`  | Run deduplication at ingest time (before storage).                       |

## User Profile Settings

| Setting                              | Type      | Default | Description                                                |
| ------------------------------------ | --------- | ------- | ---------------------------------------------------------- |
| `userProfileAnalysisInterval`        | `number`  | `10`    | Number of chat messages between profile analysis runs.     |
| `userProfileMaxPreferences`          | `number`  | `20`    | Maximum preference entries in the user profile.            |
| `userProfileMaxPatterns`             | `number`  | `15`    | Maximum behavior pattern entries.                          |
| `userProfileMaxWorkflows`            | `number`  | `10`    | Maximum workflow entries.                                  |
| `userProfileChangelogRetentionCount` | `number`  | `5`     | Number of profile changelog entries to retain.             |
| `showUserProfileToasts`              | `boolean` | `true`  | Show toast notifications when the user profile is updated. |
| `showErrorToasts`                    | `boolean` | `true`  | Show toast notifications for errors.                       |

## AI Session Retention

| Setting                  | Type     | Default | Description                                                       |
| ------------------------ | -------- | ------- | ----------------------------------------------------------------- |
| `aiSessionRetentionDays` | `number` | `7`     | Days to retain AI session data (intermediate analysis artifacts). |

## Required vs Optional Settings

**No settings are strictly required** — the plugin starts with all defaults and uses local Xenova embeddings out of the box.

The following settings become **conditionally required** based on your deployment:

| Condition                                         | Required Settings                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Using remote OpenAI-compatible embeddings         | `embeddingApiUrl`, and either `embeddingApiKey` or `OPENAI_API_KEY` env var |
| Using an external AI provider for memory analysis | `memoryModel`, `memoryApiUrl`                                               |
| Binding web UI to a non-loopback address          | `webServerApiKey`                                                           |

When `memoryModel` or `memoryApiUrl` is missing and an external AI operation is attempted, the plugin throws: `"External API not configured for memory provider"`.

## Per-Environment Overrides

Use the layered config file approach to manage different environments:

- **Global defaults**: `~/.config/opencode/opencode-mem0.jsonc` — shared across all projects
- **Project overrides**: `<project>/.opencode/opencode-mem0.jsonc` — per-project settings (deep-merged on top of global)

Common override patterns:

```jsonc
// ~/.config/opencode/opencode-mem0.jsonc (global — local embeddings, no API keys)
{
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "memoryProvider": "openai-chat"
}

// <project>/.opencode/opencode-mem0.jsonc (project — use remote API for this project)
{
  "embeddingApiUrl": "https://api.openai.com/v1",
  "embeddingApiKey": "env://OPENAI_API_KEY",
  "embeddingModel": "text-embedding-3-small",
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "env://OPENAI_API_KEY",
  "memoryModel": "gpt-4o"
}
```

## Config Validation

All config values are validated against a Zod schema at startup. Invalid values produce a descriptive error:

```
Invalid opencode-mem0 config: memoryLifecycle.promotionThreshold: Number must be between 0 and 1
```

The plugin will not start with an invalid configuration file.
