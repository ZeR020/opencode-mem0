# docs/

## Purpose

Project documentation set. User-facing and contributor-facing docs covering setup, configuration, architecture, development, testing, and release history. `docs/CHANGELOG.md` is shipped in the published package; the rest are repo-only.

## Ownership

- `README.md` (repo root, not here) — Project overview, install, usage, config reference. The public face of the package
- `GETTING-STARTED.md` — First-run guide: prerequisites, install steps, minimal config, verification, next steps
- `CONFIGURATION.md` — Full configuration reference: file locations, deep-merge order, every setting with default and description. The source of truth for config fields
- `ARCHITECTURE.md` — System overview, data flow (memory injection, storage, auto-capture, lifecycle, compaction recovery), key abstractions, directory structure, storage layout, vector search pipeline, configuration layer
- `DEVELOPMENT.md` — Contributor guide: setup, build commands, code style (Prettier, strict TS, DeepSource lint, JSDoc), branch conventions, PR process, project structure, release process
- `TESTING.md` — Test framework, running tests, writing new tests, mocking patterns, HOME isolation, coverage, CI integration
- `CHANGELOG.md` — Keep a Changelog format, Semantic Versioning. **Shipped in the published package** (`package.json` `files`). Updated per release

## Local Contracts

- These docs carry a `<!-- generated-by: gsd-doc-writer -->` header marking their origin; treat them as maintained prose, not auto-generated throwaway
- `CONFIGURATION.md` is the source of truth for config fields. Adding/removing/renaming a field in `src/config.ts` requires a matching update here and in the Zod schema
- `ARCHITECTURE.md` describes the system data flow and key abstractions; structural changes (new service, changed flow, new abstraction) require an update here
- `CHANGELOG.md` is the only doc shipped to npm — keep entries user-facing and grouped under Keep a Changelog categories (`Added`, `Changed`, `Fixed`, `Security & Reliability`, etc.)
- `DEVELOPMENT.md` and `TESTING.md` encode the contributor workflow that the root and `tests/` AGENTS.md files also reference — keep them consistent

## Work Guidance

- User-facing behavior change → update the relevant doc here plus `README.md`
- Config field change → update `CONFIGURATION.md` and the Zod schema together
- Release → bump `package.json` version, add a `CHANGELOG.md` entry, tag `v*` (see `DEVELOPMENT.md` release process)
- Prefer editing existing docs over creating new ones

## Verification

- No automated doc lint exists. Manual review on PR; the PR template asks for doc updates when behavior changes
- `CHANGELOG.md` accuracy is verified at release time against the git log

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
