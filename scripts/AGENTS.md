# scripts/

## Purpose

Build, lint, and data-migration scripts. Not shipped in the published package (excluded from `package.json` `files`); used for development, CI, and one-off operations.

## Ownership

- `build.mjs` — Build script run by `bun run build`. (1) Compiles TypeScript via `tsc` (resolved through `createRequire` to avoid the platform shim) to `dist/` with `.d.ts` + declaration maps. (2) Copies `src/web/` → `dist/web/` verbatim. Annotated `skipcq JS-0833` for an ESM/DeepSource false positive
- `lint-deepsource.sh` — Local pre-push lint catching DeepSource JS analyzer issues before CI fails. Checks: async-without-await (JS-0116), `var` (JS-0239), loose `==`/`!=` outside null checks, `console.*` outside logger (JS-E1009), empty catch blocks, non-null `!` without `skipcq`, explicit `any` without `skipcq`. Uses `rg`; run via `bash scripts/lint-deepsource.sh`
- `migrate-v1-to-v2.ts` — One-off V1→V2 schema migration utility. Detects v1 databases by missing `store_type`/`strength` columns, adds v2 scoring/lifecycle columns, creates the conflicts table and transcripts DB. Imports source via `.ts` paths (run under Bun). CLI entry validates the storage path via `resolveStoragePath` — resolves to absolute and constrains to the user's home directory, rejecting traversal/escape attempts from untrusted CLI args (SonarCloud `tssecurity:S8707`)

## Local Contracts

- `build.mjs` is the only build entry point; `package.json` `files` controls what ships (`dist/`, `package.json`, `README.md`, `LICENSE`, `docs/CHANGELOG.md`)
- `lint-deepsource.sh` encodes the DeepSource rules that CI enforces — the rules in the root AGENTS.md `Local Contracts` mirror this script. Keep them in sync when adding a rule
- `migrate-v1-to-v2.ts` imports source modules directly (`.ts`), so it runs under Bun, not the compiled `dist/`

## Work Guidance

- A new DeepSource rule → add the check here and to the root `Local Contracts` together
- Build script changes must keep the `tsc` resolve-via-`createRequire` pattern (the platform shim breaks direct invocation)
- Migration scripts are one-off; do not wire them into the normal build or test runs

## Verification

- `bun run build` succeeds and `dist/` + `dist/web/` are populated
- `bash scripts/lint-deepsource.sh` exits 0 before push (also enforced by `.husky/pre-push`)
- `migrate-v1-to-v2.ts` is not covered by the test suite; run manually against a backed-up data dir

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
