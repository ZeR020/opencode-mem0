# .github/

## Purpose

GitHub repository configuration: CI/CD workflows, release automation, and issue/PR templates. Defines what runs on `main` pushes, PRs, and version tags.

## Ownership

### Workflows (`workflows/`)
- `ci.yml` — CI on push/PR to `main`. Steps: `bun install` → `bun run typecheck` → `bun run build` → `bun run test` → `bun audit` (non-blocking: `continue-on-error: true`, dev-only findings don't gate `main`). Permissions: `contents: read`
- `sonarcloud.yml` — Runs `bun run test:coverage` and uploads the LCOV report to SonarCloud on push/PR to `main`. Coverage exclusions in `sonar-project.properties` (repo root)
- `release.yml` — Triggered by `v*` tag pushes. Runs typecheck, build, test; checks if the version is already on npm and if a GitHub release exists; publishes to npm (Node 24, `NPM_TOKEN` secret, `https://registry.npmjs.org`) and creates a GitHub Release with body extracted from `docs/CHANGELOG.md` plus auto-generated PR notes. Idempotent — re-runs won't duplicate publishes/releases
- `opencode.yml` — OpenCode-related workflow

### Templates and community files (repo root of `.github/`)
- `pull_request_template.md` — PR checklist (typecheck, test, build, style, JSDoc, README/CHANGELOG)
- `ISSUE_TEMPLATE/bug_report.md`, `ISSUE_TEMPLATE/feature_request.md` — Issue templates
- `CONTRIBUTING.md` — Contributor guide including Release Process, Contributor Credits, and Version Numbering sections; the canonical contributor reference is `docs/DEVELOPMENT.md` + `docs/TESTING.md`
- `SECURITY.md` — Private vulnerability reporting policy (GitHub security advisory or direct contact to @ZeR020). Supported versions and disclosure timeline
- `CODE_OF_CONDUCT.md` — Contributor Covenant
- README assets (banner, screenshots) moved to `docs/assets/`

## Local Contracts

- CI gates on `main`: typecheck, build, test must pass. `bun audit` runs but is non-blocking (dev-only vulnerabilities don't gate CI). The same checks run on PRs
- Release is tag-driven (`v*`) only; never publish to npm outside the release workflow. `NPM_TOKEN` is the required repository secret
- The release workflow is idempotent (checks `npm view` and `gh release view` before acting) — preserve those guards
- `permissions` blocks are scoped (`contents: read` for CI, `contents: write` for release) — do not broaden them
- SonarCloud coverage exclusions live in `sonar-project.properties`; keep them aligned with `vitest.config.ts` coverage excludes

## Work Guidance

- New CI check → add to `ci.yml` and to the local verification list in the root AGENTS.md and `docs/DEVELOPMENT.md`
- Release process: bump `package.json`, update `docs/CHANGELOG.md`, commit, tag `v*`, push `main --tags`. See `docs/DEVELOPMENT.md`
- Security issues are reported privately per `SECURITY.md` — never via a public issue or workflow change

## Verification

- CI runs on every push/PR to `main` and must be green
- Release workflow is verified end-to-end only on an actual `v*` tag; dry-run by checking the `release_state` step logic locally

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
