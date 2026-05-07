# Technology Stack

**Analysis Date:** 2026-05-07

## Languages

**Primary:**
- TypeScript 5.9.3 (`typescript` devDependency) — all business logic, AI providers, database layer, plugin hooks
- Target: ESNext, Module: ESNext, Resolution: bundler

**Secondary:**
- JavaScript — web UI frontend (`src/web/app.js`, `src/web/i18n.js`)
- CSS — web UI styling (`src/web/styles.css`)
- HTML — web UI shell (`src/web/index.html`)

## Runtime

**Environment:**
- Bun >=1.0.0 (preferred runtime, uses `bun:sqlite` native module)
- Node.js >=20.0.0 (full fallback runtime, uses `better-sqlite3` and `node:http`)

**Package Manager:**
- npm 11.x (via nvm Node 24)
- Lockfile: `package-lock.json` v3 present

**Module System:**
- ES modules (`"type": "module"` in `package.json`)
- `verbatimModuleSyntax: true` in `tsconfig.json`

## Frameworks

**Core:**
- `@opencode-ai/plugin` ^1.14.31 — Plugin lifecycle framework (hooks: `chat.message`, `event`, `tool`)
- `@opencode-ai/sdk` ^1.14.31 — OpenCode SDK types (Part, PluginInput)
- `ai` ^6.0.172 — Vercel AI SDK for structured output generation (`generateText` with `Output.object`)

**AI Provider SDKs:**
- `@ai-sdk/anthropic` ^3.0.73 — Anthropic provider for Vercel AI SDK
- `@ai-sdk/openai` ^3.0.55 — OpenAI provider for Vercel AI SDK

**ML/Vector:**
- `@huggingface/transformers` ^4.2.0 — Local transformer pipeline for embeddings (`feature-extraction`)
- `usearch` ^2.25.1 — Vector similarity search index (cosine metric, in-memory)

**Validation:**
- `zod` ^4.4.1 — Schema validation for AI tool outputs and user profile data

**Database:**
- `better-sqlite3` ^12.1.0 — SQLite driver for Node.js fallback
- Native `bun:sqlite` — SQLite driver for Bun runtime (no package, built-in)

**Utilities:**
- `franc-min` ^6.2.0 + `iso-639-3` ^3.0.1 — Language detection for auto-capture localization

**Testing:**
- `vitest` ^3.2.4 — Test runner (config: `vitest.config.ts`)
- Node test environment, 30s timeouts

**Build/Dev:**
- `typescript` ^5.9.3 — Compiler (`tsc`)
- Custom build script: `scripts/build.mjs` (spawns tsc, copies web assets)
- `prettier` ^3.8.3 — Code formatting
- `husky` ^9.1.7 + `lint-staged` ^16.4.0 — Git hooks for formatting on commit

## Key Dependencies

**Critical:**
- `@opencode-ai/plugin` — Plugin registration and hook system. Entire architecture depends on this interface.
- `usearch` — Core vector indexing. Without it, similarity search degrades to exact-scan backend.
- `@huggingface/transformers` — Local embedding generation. Without it, requires external OpenAI-compatible embedding API.
- `better-sqlite3` — Required on Node.js. Native module that may need compilation.

**Infrastructure:**
- `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` — Structured output generation for user profile learning when using opencode provider auth.
- `zod` — Runtime type validation for all AI-generated structured data.

## Configuration

**Environment:**
- Config files: JSON/JSONC in `~/.config/opencode/opencode-mem0.jsonc` or project `.opencode/opencode-mem0.jsonc`
- Secrets via `file://`, `env://`, or direct values in config (see `src/services/secret-resolver.ts`)
- Log file path override: `OPENCODE_MEM_LOG_FILE` env var
- Data directory: `~/.opencode-mem0/data`

**Build:**
- `tsconfig.json` — `rootDir: ./src`, `outDir: ./dist`, `declaration: true`
- `scripts/build.mjs` — Runs tsc, copies `src/web/*` to `dist/web/`

## Platform Requirements

**Development:**
- Bun 1.0+ OR Node.js 20+
- Git (for hooks)

**Production:**
- Published as npm package `opencode-mem0`
- Distributed via npm registry and GitHub releases
- Target platforms: Linux, macOS, Windows (with runtime abstractions for SQLite and HTTP)

---

*Stack analysis: 2026-05-07*
