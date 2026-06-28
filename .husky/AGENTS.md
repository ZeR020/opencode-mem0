# .husky/

## Purpose

Git hooks managed by Husky. Enforces security checks, type safety, formatting, and DeepSource-equivalent linting before commits and pushes reach CI.

## Ownership

- `pre-commit` — Runs on `git commit`. (1) Blocks staging of sensitive file patterns (`.env*`, `.pem`, `.key`, secrets, credentials, archives, editor cruft, `.opencode/*`, `.planning/*`, etc.) and sensitive directories. (2) Scans staged text files for common secret/API key patterns (`sk-...`, `ghp_...`, `AKIA...`, `glpat-...`, `npm_...`, etc.) and warns interactively. (3) Flags tracked files matching `.gitignore`. (4) Runs `bun run typecheck && bunx lint-staged` (Prettier auto-format on staged files)
- `pre-push` — Runs on `git push`. Invokes `bash scripts/lint-deepsource.sh` to catch DeepSource JS analyzer issues (async-without-await, `var`, loose equality, `console.*` outside logger, empty catch, non-null `!` / `any` without `skipcq`) before they fail CI

## Local Contracts

- Both hooks are load-bearing gates; the rules they encode mirror the root AGENTS.md `Local Contracts` and `scripts/lint-deepsource.sh`. Keep all three in sync when a rule changes
- `pre-commit` blocks (not just warns) on sensitive file patterns and directories — do not weaken this. Bypass only via `git commit --no-verify` in genuine test/mock cases
- `lint-staged` runs Prettier on staged `*.{ts,tsx,js,jsx,css,html,json,md}` (config in `package.json`)
- Husky is installed via `npm run prepare` → `husky` (wired in `package.json` `scripts.prepare`)

## Work Guidance

- Adding a sensitive pattern → add to the `pre-commit` `case` block and note it in the root AGENTS.md
- Adding a DeepSource rule → add to `scripts/lint-deepsource.sh` (which `pre-push` runs) and the root `Local Contracts`
- Hooks are shell scripts (`#!/bin/sh`) — keep them POSIX-compatible

## Verification

- A blocked file pattern aborts the commit with a non-zero exit
- `pre-commit` runs `bun run typecheck` (strict) — any type error aborts the commit
- `pre-push` runs the DeepSource lint — any finding aborts the push

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
