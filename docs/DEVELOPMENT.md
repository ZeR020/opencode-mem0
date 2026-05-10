# Development Guide

This document covers everything you need to build, test, debug, and release opencode-mem0.

---

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Project Structure Overview](#project-structure-overview)
3. [Build System](#build-system)
4. [Development Commands](#development-commands)
5. [Testing](#testing)
6. [Debugging](#debugging)
7. [Contributing](#contributing)
8. [Release Process](#release-process)

---

## Development Environment Setup

### Prerequisites

| Tool        | Version | Purpose                                     |
| ----------- | ------- | ------------------------------------------- |
| **Bun**     | 1.x+    | Primary runtime and package manager         |
| **Node.js** | 20+     | Fallback runtime for builds and npm publish |
| **Git**     | Any     | Version control                             |

Check your versions:

```bash
bun --version   # Should print 1.x.x
node --version  # Should print v20.x.x or higher
```

### Installing Bun

Bun is the primary development runtime. If you don't have it installed:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

> Bun handles dependency installation, running the test suite, and local development faster than Node.js. Node.js remains supported as a fallback for environments where Bun is unavailable.

### Cloning and Installing

```bash
# Clone the repository
git clone https://github.com/ZeR020/opencode-mem0.git
cd opencode-mem0

# Install dependencies (uses Bun)
bun install

# Verify the install
bun run typecheck
bun run build
```

If you only have Node.js available, `npm install` works as a fallback, though Bun is strongly preferred for local development.

---

## Project Structure Overview

```
opencode-mem0/
├── src/                          # Source code
│   ├── index.ts                  # Plugin entry point, lifecycle hooks
│   ├── plugin.ts                 # Plugin loader contract
│   ├── config.ts                 # Configuration loading and resolution
│   ├── services/
│   │   ├── client.ts             # LocalMemoryClient (primary API surface)
│   │   ├── memory-scoring.ts     # 7-factor memory scoring implementation
│   │   ├── memory-lifecycle.ts   # STM/LTM state machine and decay
│   │   ├── memory-conflicts.ts   # Contradiction detection
│   │   ├── retrieval-context.ts  # Context boost + diversity ranking
│   │   ├── transcript-capture.ts # Chat transcript ingestion hook
│   │   ├── platform-server.ts    # Bun/Node HTTP server abstraction
│   │   ├── web-server.ts         # Web UI request handlers
│   │   ├── api-handlers.ts       # REST API route handlers
│   │   ├── auto-capture.ts      # Automatic memory extraction
│   │   ├── embedding.ts         # Embedding model management
│   │   ├── cleanup-service.ts   # Background maintenance tasks
│   │   ├── ai/                  # AI provider subsystem
│   │   │   ├── ai-provider-factory.ts
│   │   │   ├── provider-config.ts
│   │   │   ├── session/
│   │   │   │   └── ai-session-manager.ts
│   │   │   ├── providers/
│   │   │   │   ├── base-provider.ts
│   │   │   │   ├── anthropic-messages.ts
│   │   │   │   ├── openai-responses.ts
│   │   │   │   ├── openai-chat-completion.ts
│   │   │   │   ├── google-gemini.ts
│   │   │   │   └── opencode-provider.ts
│   │   │   ├── tools/
│   │   │   │   └── tool-schema.ts
│   │   │   └── validators/
│   │   │       └── user-profile-validator.ts
│   │   ├── sqlite/              # Database layer
│   │   │   ├── sqlite-bootstrap.ts
│   │   │   ├── connection-manager.ts
│   │   │   ├── schema.ts
│   │   │   ├── vector-search.ts
│   │   │   ├── transcript-manager.ts
│   │   │   ├── shard-manager.ts
│   │   │   └── types.ts
│   │   ├── vector-backends/     # Pluggable vector search backends
│   │   │   ├── backend-factory.ts
│   │   │   ├── exact-scan-backend.ts
│   │   │   ├── usearch-backend.ts
│   │   │   ├── nsw-backend.ts
│   │   │   └── types.ts
│   │   ├── user-profile/        # Profile and preference storage
│   │   │   ├── user-profile-manager.ts
│   │   │   ├── profile-context.ts
│   │   │   ├── profile-utils.ts
│   │   │   └── types.ts
│   │   ├── user-prompt/
│   │   │   └── user-prompt-manager.ts
│   │   ├── utils/
│   │   │   └── safe-transforms.ts
│   │   ├── logger.ts
│   │   ├── context.ts
│   │   ├── tags.ts
│   │   ├── privacy.ts
│   │   ├── language-detector.ts
│   │   ├── secret-resolver.ts
│   │   ├── jsonc.ts
│   │   ├── memory-scoring-service.ts
│   │   ├── user-memory-learning.ts
│   │   ├── migration-service.ts
│   │   └── deduplication-service.ts
│   ├── types/
│   │   ├── index.ts
│   │   └── usearch.d.ts
│   └── web/                     # Web UI static assets (HTML, CSS, JS)
├── tests/                        # Test suite (Vitest)
├── scripts/
│   ├── build.mjs                # Cross-platform build script
│   └── migrate-v1-to-v2.ts      # Database migration utility
├── docs/
│   ├── GETTING-STARTED.md
│   ├── CONFIGURATION.md
│   ├── ARCHITECTURE.md
│   └── DEVELOPMENT.md           # This file
├── dist/                         # Compiled output (generated)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .github/
│   ├── CONTRIBUTING.md
│   ├── CODE_OF_CONDUCT.md
│   └── SECURITY.md
└── .github/workflows/
    ├── ci.yml                    # CI: typecheck + build + test + audit
    ├── release.yml               # Release: npm publish + GitHub release
    ├── sonarcloud.yml            # SonarCloud code quality analysis
    └── opencode.yml              # OpenCode-specific automation
```

### Key Design Principles

- **Dual runtime support**: All code runs on both Bun and Node.js 20+. The `platform-server.ts` module abstracts runtime differences.
- **Strict TypeScript**: `strict: true`, explicit types preferred over `any`, `noUncheckedIndexedAccess` enabled.
- **Local-first**: Everything stores in SQLite under `~/.opencode-mem0/`. No cloud dependency for core features.
- **Modular scoring**: Memory ranking is decomposed into 7 independently testable factors.

---

## Build System

### `bun run build`

Runs the cross-platform build script at `scripts/build.mjs`:

1. **TypeScript compilation**: Spawns `tsc` to compile `src/` into `dist/` with declaration files (`.d.ts`) and declaration maps.
2. **Web asset copy**: Copies everything from `src/web/` to `dist/web/` for the bundled Web UI.

The build script resolves the actual `typescript/bin/tsc` entrypoint via `createRequire` to avoid platform shim issues, making it work under both Bun and Node.js.

### `npm run build`

Identical output. The `build.mjs` script is written in plain Node.js module syntax and runs under either runtime.

### Build Outputs

After a successful build, `dist/` contains:

```
dist/
├── index.js / index.d.ts         # Plugin entry
├── plugin.js / plugin.d.ts       # Plugin loader
├── config.js / config.d.ts       # Config module
├── services/                     # Compiled service modules
├── types/                        # Compiled type modules
└── web/                          # Copied web assets
```

The `package.json` `files` array only includes `dist/`, `package.json`, `README.md`, `LICENSE`, and `docs/CHANGELOG.md` in the published tarball.

---

## Development Commands

### Essential Commands

| Command                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `bun install`           | Install dependencies using Bun                            |
| `npm install`           | Install dependencies using Node.js/npm (fallback)         |
| `bun run build`         | Compile TypeScript + copy web assets                      |
| `bun run typecheck`     | Run `tsc --noEmit` to verify types without emitting files |
| `bun run test`          | Run the full test suite via Vitest                        |
| `bun run test:bun`      | Alias for `bun run test` (explicit Bun invocation)        |
| `bun run test:coverage` | Run tests with V8 coverage report (text + lcov + HTML)    |
| `bun run format`        | Run Prettier on `src/**/*.{ts,js,css,html}`               |
| `bun run format:check`  | Check formatting without writing changes                  |
| `bun audit`             | Security audit of dependencies (Bun's built-in audit)     |

### Watch Mode

For incremental development:

```bash
# TypeScript watch mode (recompiles on change)
bun run dev
```

This runs `tsc --watch` and emits to `dist/` continuously. For test-driven development, run Vitest in watch mode:

```bash
bunx vitest
```

---

## Testing

### Test Runner

Tests use **Vitest** with the **Node** environment. Bun is used as the execution engine (`bun run test`), but the runner itself is Vitest for compatibility with both runtimes.

Configuration: `vitest.config.ts`

- **Test files**: `tests/**/*.test.ts`
- **Timeout**: 30 seconds per test and hook
- **Coverage**: V8 provider, outputs text/lcov/HTML to `./coverage/`

### Running Tests

```bash
# Full suite (fast)
bun run test

# With coverage report
bun run test:coverage

# Interactive watch mode
bunx vitest

# Run a specific test file
bunx vitest run tests/memory-scoring.test.ts

# Run tests matching a pattern
bunx vitest run -t "calculateRecency"
```

### Test Organization

| Area                | Example Test Files                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Core scoring        | `tests/memory-scoring.test.ts`                                                                      |
| Memory engine       | `tests/memory-engine.test.ts`                                                                       |
| Configuration       | `tests/config.test.ts`, `tests/config-resolution.test.ts`                                           |
| Web server          | `tests/web-server.test.ts`, `tests/web-server-routes.test.ts`                                       |
| AI providers        | `tests/anthropic-messages.test.ts`, `tests/openai-responses.test.ts`, `tests/google-gemini.test.ts` |
| Vector search       | `tests/vector-search-backend-integration.test.ts`, `tests/vector-backends/*.test.ts`                |
| Lifecycle & cleanup | `tests/cleanup-service.test.ts`, `tests/contextual-decay.test.ts`                                   |
| Privacy & security  | `tests/privacy.test.ts`, `tests/secret-resolver.test.ts`                                            |
| Plugin contracts    | `tests/plugin-loader-contract.test.ts`, `tests/plugin-error-handling.test.ts`                       |

### Test Isolation Notes

Tests generally use temporary directories for database storage to avoid interfering with developer data. One known exception is `tests/profile-tool-runtime.test.ts`, where `UserProfileManager` is a module-level singleton that reads `CONFIG.storagePath` at import time. This test cannot use per-test temp directories without refactoring the manager to accept an injected path. This is documented as a low-priority known issue.

### Coverage Exclusions

The coverage configuration excludes generated files, config files, web assets, examples, scripts, and type definitions. See `vitest.config.ts` for the full exclusion list.

### Detailed Testing Documentation

For in-depth testing patterns, mocking strategies, and how to write new tests for this codebase, see `TESTING.md` (to be created if it does not yet exist) or the test files themselves, which serve as living documentation.

---

## Debugging

### Local Database Location

By default, all SQLite databases and vector indexes are stored under the user's home directory:

```
~/.opencode-mem0/
├── data/                        # Main SQLite database + vector index
├── transcripts/                 # Transcript shard databases
└── ...
```

You can inspect the database directly:

```bash
# Using sqlite3 CLI
sqlite3 ~/.opencode-mem0/data

# List tables
.tables

# View recent memories
SELECT id, content, created_at FROM memories ORDER BY created_at DESC LIMIT 10;
```

### Logs and Verbose Mode

The plugin uses a lightweight internal logger (`src/services/logger.ts`). For troubleshooting:

1. Check OpenCode's own logs for plugin startup messages and errors.
2. Look for the brief startup message confirming the memory store is ready.
3. The Web UI at `http://localhost:4747` provides a visual way to inspect stored memories, transcripts, and conflicts without touching the database directly.

### Web UI Dev Mode

The Web UI is served from `dist/web/` at runtime. To iterate on UI changes during development:

1. Make edits in `src/web/`.
2. Re-run `bun run build` to copy assets to `dist/web/`.
3. Restart OpenCode or the standalone server to pick up changes.

There is no separate hot-reload server; the UI is intentionally simple static HTML/CSS/JS served by the plugin's embedded HTTP server.

### Common Debug Workflows

| Problem                  | How to investigate                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Plugin not loading       | Check OpenCode logs for startup errors; verify `opencode.json` plugin array         |
| Database locked          | Ensure only one OpenCode instance is running; check for stale `*.journal` files     |
| Port conflict            | `lsof -i :4747` (macOS/Linux) or `netstat -ano \| findstr :4747` (Windows)          |
| Search returning nothing | Check scope settings; inspect `memories` table directly with sqlite3                |
| Build failure            | Run `bun run typecheck` first to isolate TypeScript errors from build script issues |

---

## Contributing

Please read [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) for the full contribution workflow. In summary:

1. Fork and clone the repository.
2. Install dependencies with `bun install`.
3. Create a feature branch: `git checkout -b feat/your-feature`.
4. Make your changes.
5. Ensure the following pass before submitting a PR:
   - `bun run typecheck`
   - `bun run test`
   - `bun run build`
   - `bun run format` (or let lint-staged handle it on commit)
6. Push your branch and open a pull request.

CI will run the same checks (`typecheck`, `build`, `test`, `audit`) automatically on every PR.

---

## Release Process

Releases are automated via GitHub Actions (`.github/workflows/release.yml`) and triggered by pushing a version tag.

### Steps to Release

1. **Update version**: Bump the version in `package.json` following [SemVer](https://semver.org/).

2. **Update changelog**: Add release notes to `docs/CHANGELOG.md`.

3. **Commit and tag**:

   ```bash
   git add package.json docs/CHANGELOG.md
   git commit -m "chore(release): prepare v2.x.x"
   git tag v2.x.x
   git push origin main --tags
   ```

4. **CI handles the rest**:
   - The `release.yml` workflow triggers on `v*` tags.
   - It runs `bun run typecheck`, `bun run build`, and `bun run test`.
   - If tests pass, it publishes to npm (if the version is not already published).
   - It creates a GitHub Release with auto-generated release notes.

### Release Safety Checks

The release workflow includes idempotency checks:

- If the version is already on npm, the publish step is skipped.
- If the GitHub Release already exists, creation is skipped.

This makes it safe to re-run or retry a release workflow without causing duplicate publishes.

### Pre-Release Checklist

Before pushing a release tag, verify locally:

```bash
bun run typecheck   # No TypeScript errors
bun run build       # Build succeeds
bun run test        # All tests pass
bun audit           # No unaddressed security issues
```

### npm Publish Details

- **Registry**: `https://registry.npmjs.org`
- **Access**: `public` (scoped package behavior not applicable)
- **Auth**: Uses `NPM_TOKEN` repository secret
- **Files included**: `dist/`, `package.json`, `README.md`, `LICENSE`, `docs/CHANGELOG.md`

---

<p align="center">
  <sub>Happy hacking.</sub>
</p>
