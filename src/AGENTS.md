# src/

## Purpose

Source root for the opencode-mem0 plugin. Contains the plugin entry point and lifecycle hooks, the configuration layer, shared types, and the `services/` subtree that holds all runtime logic.

## Ownership

- `src/index.ts` — Plugin entry point. Exports `OpenCodeMemPlugin` (the `Plugin` object loaded by OpenCode). Wires all OpenCode hooks (`chat.message`, `session.idle`, `session.compacted`, `session.end`), defines the `memory` tool (modes: `add`, `search`, `profile`, `list`, `forget`, `help`), starts/stops background jobs (scoring recalculation, lifecycle maintenance), and launches the Web UI server. This is the single integration seam with the OpenCode host
- `src/plugin.ts` — Plugin loader shim. Dynamically imports `index.js`, exports `{ id, server: OpenCodeMemPlugin }` satisfying `PluginModule`. The `console.error` here is the one sanctioned `console.*` outside the logger (annotated `skipcq JS-0002`)
- `src/config.ts` — Configuration loading, validation, defaults, and global/project merge. Defines `OpenCodeMemConfig`, `VectorBackendConfig`, the Zod schema `OpenCodeMemConfigSchema`, and exports `CONFIG`, `isConfigured`, `initConfig`. Loads from `~/.config/opencode/opencode-mem0.jsonc|.json` (global) and `<project>/.opencode/opencode-mem0.jsonc|.json` (project, overrides global). Secrets resolved via `services/secret-resolver.js` `resolveSecretValue()` (env var indirection). Known tech debt (noted in-file): 85+ `as` casts on SQL results from `bun:sqlite` `.all()` returning `unknown[]`
- `src/types/index.ts` — Shared, stable types: `MemoryType` (semantic string alias), `MemoryMetadata` (with `[key: string]: unknown` extension seam), `AIProviderType` union (`"openai-chat" | "openai-responses" | "anthropic" | "google-gemini"`)

## Local Contracts

- The OpenCode host loads `src/plugin.ts`; everything else is reached through `index.ts` or via `services/client.ts` as the primary programmatic API surface
- The `memory` tool modes in `index.ts` are the agent-facing contract: `add`, `search`, `profile`, `list`, `forget`, `help`. Adding a mode is a user-facing change — update README, tool schema, and tests
- Configuration fields are public contract. Adding/removing/renaming a field in `config.ts` requires updating `docs/CONFIGURATION.md` and the Zod schema together
- `MemoryMetadata` and `AIProviderType` in `types/index.ts` are shared across services; widen via the `[key: string]: unknown` index signature rather than breaking existing fields
- Privacy invariant: every chat/transcript path into an LLM passes through `services/privacy.ts` (`stripPrivateContent` / `isFullyPrivate`) — `index.ts` enforces this at the capture boundaries

## Work Guidance

- New runtime logic belongs in `src/services/<name>.ts`, integrated through `services/client.ts` when part of the primary API. See `src/services/AGENTS.md`
- The Web UI assets live in `src/web/` and are copied verbatim to `dist/web/` by the build — see `src/web/AGENTS.md`
- Prefer named exports. Dynamic `import()` is used deliberately in `plugin.ts` to surface load failures with the plugin id

## Verification

- `bun run typecheck` (strict `tsc --noEmit`) covers all of `src/`
- `bun run build` compiles `src/` → `dist/` with declaration files and copies `src/web/` → `dist/web/`
- Per-module behavior is verified by the matching `tests/*.test.ts` — see `tests/AGENTS.md`

## Child DOX Index

| Path                     | Scope                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/services/AGENTS.md` | Service layer: memory client, scoring, lifecycle, retrieval, capture, storage, AI providers, web server |
| `src/web/AGENTS.md`      | Web UI static assets (SPA shell, app logic, styles, i18n)                                               |
