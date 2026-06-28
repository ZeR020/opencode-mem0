# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

---

# opencode-mem0

## Purpose

OpenCode plugin that gives coding agents persistent, private long-term memory via a local vector database (SQLite + usearch). No cloud services required — all data stays on the user's machine. The plugin intercepts OpenCode chat/session events, stores technical knowledge as vector-embedded memories, and injects relevant context back into agent conversations.

Cognitive enhancement fork of `tickernelz/opencode-mem`, published to npm as `opencode-mem0`. Maintained by ZeR020 under the MIT license.

## Ownership

- Repository: `github.com/ZeR020/opencode-mem0`, default branch `main`
- Package: `opencode-mem0` on npm; published artifacts are `dist/`, `package.json`, `README.md`, `LICENSE`, `docs/CHANGELOG.md`
- Runtime: Bun >= 1.0.0 (primary, Linux/macOS, native `bun:sqlite`) or Node.js >= 20.0.0 (fallback, any platform, `better-sqlite3`)
- Language: strict TypeScript, ESM (`"type": "module"`)
- Versioning/release: Conventional Commits, automated via `.github/workflows/release.yml` on `v*` tags

## Local Contracts

- TypeScript strict mode is mandatory: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. Prefer explicit types over `any`; use `unknown` then narrow when the type is truly unknown
- JSDoc required on all public functions, classes, and exported constants (`@param`, `@returns`, behavior + side effects)
- Prettier is the formatter: semicolons, double quotes, 2-space indent, 100 char width, ES5 trailing commas, LF. Run `bun run format` before committing
- Conventional Commits only: `type(scope): description`, present tense. Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`
- No `console.*` outside the logger module; no `var`; no loose `==`/`!=` outside null checks; no empty catch blocks; no non-null `!` or explicit `any` without `skipcq` annotation (DeepSource rules enforced by `scripts/lint-deepsource.sh`)
- New AI providers and embedding backends integrate through the existing factory/abstraction seams — never bypass `AIProviderFactory` or the `VectorBackend` interface
- All data stays local. Never add cloud telemetry, remote reporting, or outbound network calls beyond the user-configured embedding/AI endpoints
- Privacy boundaries are load-bearing: secrets and PII are stripped by `privacy.ts` before any LLM call; preserve that invariant in any capture path
- **No direct commits to `main`** — branch protection is enforced for all users including admins. Every change goes through a PR: branch → commit → push → PR → CI → merge. Branch naming: `fix/<desc>`, `feat/<desc>`, `refactor/<desc>`, `chore/<desc>`, `docs/<desc>`
- **PR titles use Conventional Commits** — `fix(scope): description`, `feat(scope): description`, etc. Link issues with `Fixes #N` in the PR body so GitHub auto-closes them on merge and credits the reporter in release notes
- **Squash merge only** — `required_linear_history` is enabled. PRs are squash-merged to keep `main` history clean with one commit per PR
- **Release process**: bump version in `package.json` → write `docs/CHANGELOG.md` entry (Added/Fixed/Removed/Changed/Closed/Contributors) → commit → tag `vX.Y.Z` → push tag. The release workflow auto-publishes to npm and creates the GitHub release from the changelog
- **Contributor credits**: community contributors who report issues or submit PRs are credited by GitHub username in the `docs/CHANGELOG.md` Contributors section for the release that ships their contribution

## Work Guidance

- Reuse existing patterns before introducing new ones. A second convention beside an existing one is prohibited
- Run `lsp references` before modifying exported symbols — missed callsites are bugs
- New services go in `src/services/<name>.ts`, get JSDoc, integrate through `src/services/client.ts` when part of the primary API surface, and ship with `tests/<name>.test.ts`
- Keep PRs focused; separate unrelated changes. Verify locally before opening: `bun run typecheck && bun run test && bun run build && bun run format:check && bash scripts/lint-deepsource.sh`
- When changing user-facing behavior, update the matching doc in `docs/` (`CONFIGURATION.md`, `GETTING-STARTED.md`, `DEVELOPMENT.md`, `ARCHITECTURE.md`) and any JSON schema/example configs

## Verification

- `bun run typecheck` — strict `tsc --noEmit`, zero errors
- `bun run test` — full Vitest suite (`tests/**/*.test.ts`, 430+ tests, node env, `tests/setup-home.ts` isolates HOME)
- `bun run build` — `tsc` to `dist/` + copy `src/web/` to `dist/web/` via `scripts/build.mjs`
- `bun audit` — dependency vulnerability scan (non-blocking in CI: dev-only findings don't gate `main`)
- `bun run format:check` — Prettier check
- `bash scripts/lint-deepsource.sh` — local DeepSource-equivalent lint (runs on pre-push)
- CI (`.github/workflows/ci.yml`): typecheck → build → test → audit (non-blocking), all gates pass on `main`

## Child DOX Index

| Path                | Scope                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| `src/AGENTS.md`     | Source root: plugin entry point, config layer, shared types, plugin shim |
| `tests/AGENTS.md`   | Vitest test suite conventions and mocking patterns                       |
| `scripts/AGENTS.md` | Build, lint, and migration scripts                                       |
| `docs/AGENTS.md`    | Project documentation set                                                |
| `.github/AGENTS.md` | CI workflows, issue/PR templates, release automation                     |
| `.husky/AGENTS.md`  | Git hooks (pre-commit, pre-push)                                         |

Source service subsystems are indexed under `src/AGENTS.md` → `src/services/AGENTS.md`, which owns the service-layer children (`sqlite/`, `vector-backends/`, `ai/`, `user-profile/`). The `src/web/` UI assets are indexed directly under `src/AGENTS.md` (they sit under `src/`, not `src/services/`). The `src/services/handlers/` directory has no separate AGENTS.md — see `src/services/AGENTS.md`.
