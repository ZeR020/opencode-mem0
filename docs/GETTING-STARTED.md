<!-- generated-by: gsd-doc-writer -->

# Getting Started

This guide walks you through installing, configuring, and running opencode-mem0 for the first time.

## Prerequisites

| Requirement  | Version   | Notes                                                                                                                                         |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**      | >= 1.0.0  | Primary runtime (Linux/macOS). Required for `bun:sqlite` — the fast native SQLite driver.                                                     |
| **Node.js**  | >= 20.0.0 | Fallback runtime (any platform including Windows). Uses `better-sqlite3` instead of `bun:sqlite`. Full functionality on Bun; partial on Node. |
| **OpenCode** | latest    | The agent framework this plugin extends. Install via `npm install -g opencode` or your preferred method.                                      |
| **Git**      | any       | For cloning the repository.                                                                                                                   |

> **Bun is strongly recommended** for best performance. The plugin probes for `bun:sqlite` at startup and falls back to `better-sqlite3` on Node.js (including Windows), but the Bun path is faster and is the tested primary target.

## Installation Steps

### 1. Clone the repository

```bash
git clone https://github.com/ZeR020/opencode-mem0.git
cd opencode-mem0
```

### 2. Install dependencies

```bash
bun install
```

If you don't have Bun, use npm (Node.js >= 20):

```bash
npm install
```

### 3. Build the plugin

```bash
bun run build
```

This compiles TypeScript to `dist/plugin.js` using the custom build script at `scripts/build.mjs`.

### 4. Verify the build

```bash
bun run typecheck
```

Confirms the TypeScript compiles without errors.

## First Run

opencode-mem0 is an OpenCode plugin — it activates automatically when OpenCode loads it. There is no standalone server to start (the optional Web UI starts as part of the plugin lifecycle).

### Quick verification

1. **Ensure OpenCode is installed and configured.** The plugin registers via the `opencode` field in `package.json` (hooks: `chat.message`, `event`).

2. **Run the test suite to confirm everything works:**

   ```bash
   bun test
   ```

   This runs vitest. All 641 tests should pass individually. Note: running the full suite in parallel may produce 12 flaky failures due to SQLite file contention — this is a known issue, not a setup problem.

3. **Use the plugin through OpenCode.** Once loaded, the plugin exposes six tool commands to the agent:

   | Command   | Description                             |
   | --------- | --------------------------------------- |
   | `add`     | Store a new memory                      |
   | `search`  | Search memories by keywords             |
   | `profile` | View or update user profile/preferences |
   | `list`    | List recent memories                    |
   | `forget`  | Remove a memory by ID                   |

4. **Open the Web UI.** By default, the plugin starts a web dashboard at `http://127.0.0.1:4747`. Open it in your browser to browse memories, view profiles, and manage data visually.

### Minimal configuration

No configuration is required for first run. The plugin uses these defaults:

- **Storage**: `~/.opencode-mem0/data/` (local SQLite + usearch vectors)
- **Embedding model**: `Xenova/nomic-embed-text-v1` (runs locally, no API key needed)
- **Web UI**: enabled on `127.0.0.1:4747`
- **Auto-capture**: enabled (automatically extracts memories from conversations)
- **Memory scope**: per-project

To override defaults, create a config file at `~/.config/opencode/opencode-mem0.jsonc`:

```jsonc
{
  // Use your name instead of the system default
  "userNameOverride": "Your Name",
  "userEmailOverride": "you@example.com",
}
```

See [CONFIGURATION.md](CONFIGURATION.md) for the full list of settings.

## Common Setup Issues

### Bun not found / wrong runtime

**Symptom:** `bun: command not found` or the plugin logs `"bun:sqlite probe failed"`.

**Solution:** Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your shell after installation. On Node.js, the plugin works but uses `better-sqlite3` as a fallback, which is slower for vector operations.

### Embedding model warmup timeout

**Symptom:** Plugin logs `"Embedding model warmup timed out"` during startup.

**Solution:** The first run downloads the local embedding model (~270 MB). On slow connections, the 30-second default timeout may be insufficient. Increase it in config:

```jsonc
{
  "warmupTimeoutMs": 120000, // 2 minutes
}
```

After the initial download, subsequent runs are near-instant. Alternatively, use a remote embedding API (see [CONFIGURATION.md](CONFIGURATION.md)).

### Running on Windows

**Symptom:** `bun: command not found` on Windows, or `bun:sqlite` probe fails.

**Solution:** Bun does not currently support Windows. Use Node.js >= 20.0.0 instead — the plugin automatically falls back to `better-sqlite3` for SQLite operations. All core features work on Windows via Node.js, though vector operations may be slightly slower than the Bun path.

### Port 4747 already in use

**Symptom:** Web UI fails to start; log shows EADDRINUSE.

**Solution:** Change the port in config:

```jsonc
{
  "webServerPort": 5050,
}
```

Or disable the web UI entirely: `"webServerEnabled": false`.

### Tests fail when running the full suite

**Symptom:** `bun test` reports ~12 failures out of 641 tests.

**Solution:** This is a known parallel-execution issue with SQLite file contention. All 641 tests pass when run individually. For CI, tests run successfully because vitest handles isolation. For local development, re-run tests or run a subset.

## Next Steps

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Understand the system design, data flow, and key abstractions.
- **[CONFIGURATION.md](CONFIGURATION.md)** — Explore all configurable settings including memory scoring, lifecycle, retrieval, and AI provider options.
- **[examples/basic-usage.ts](../examples/basic-usage.ts)** — See a complete code example for adding, searching, and listing memories.
- **[examples/custom-scoring.ts](../examples/custom-scoring.ts)** — Learn how the 7-factor memory scoring system works.
