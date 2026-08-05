# AGENTS.md — Development Rules

Rules for AI agents and humans working in this repo. Contributor-facing detail lives in `.github/CONTRIBUTING.md`; this file is the enforceable contract.

## Quality gates — run before every commit

```bash
bun run format && bun run typecheck && bun run test && bun run build
```

CI runs the same four gates on every PR and push to `main`. A failing gate means fix the code — never disable the rule, skip the test, or widen a config to make it pass. If CI fails on your change, read the failure output and fix the root cause before pushing again.

## Commits

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` with optional scope (`fix(conflicts): …`).
- **Atomic**: one logical change per commit. Never mix formatting with behavior changes, or refactors with features.
- Message explains the _why_, not the _what_ (the diff shows the what).
- Never commit secrets, `.env`, build output (`dist/`), or `node_modules/`. The pre-commit hook blocks common secret patterns — don't bypass it with `--no-verify` unless it's a proven test value.

## Branching

- Solo-maintainer flow: direct pushes to `main` are allowed; `main` must always stay releasable.
- External contributors: short-lived branches from `main` (`feat/x`, `fix/x`, `docs/x`), merged via PR within days, not weeks. Delete after merge.
- Never force-push `main` or rewrite published history (enforced by branch protection).

## Versioning & releases

- **SemVer**, tag-driven: breaking → MAJOR, additive → MINOR, fix → PATCH. A behavior change consumers rely on is breaking regardless of diff size.
- Release flow: update `docs/CHANGELOG.md` (move `Unreleased` entries into a `## [X.Y.Z] - YYYY-MM-DD` section) → bump `package.json` **and run `bun install` to sync `bun.lock`** → commit `chore: release vX.Y.Z` → `git tag vX.Y.Z && git push --tags`. The tag triggers the release workflow, which **fails** if the tag ≠ `package.json` version or the changelog section is missing/empty.
- Write the changelog entry **with the change**, in `## [Unreleased]`, grouped by `Added / Changed / Fixed / Deprecated / Removed / Security`, phrased for user impact — not reconstructed from git log at release time.
- Credit people in changelog/release notes only for real contributions (code, PRs, design). Plain issue reports get no credit; exception only for an exceptional report that materially saved the fix (e.g., deep root-cause analysis).

## Scope discipline

- Change only what the task requires. Drive-by cleanups go in a separate commit/PR.
- After a change, report: files touched, files intentionally not touched, risks.
- Reuse existing helpers/patterns before writing new ones; stdlib/native over new dependencies. New dependencies need justification.

## Testing

- New logic ships with a test (`tests/**/*.test.ts`, vitest). Bug fixes get a regression test that fails without the fix.
- Coverage of `src/` is gated by SonarCloud — don't add files to the coverage-exclusion lists to dodge the gate.

## What CI enforces (don't duplicate locally)

| Concern                      | Enforced by                   |
| ---------------------------- | ----------------------------- |
| Format, types, tests, build  | `ci.yml` (required check)     |
| Code quality + coverage gate | SonarCloud                    |
| Secrets in staged diffs      | `.husky/pre-commit`           |
| Dependency updates           | Dependabot (minor/patch only) |
| npm + GitHub release         | `release.yml` on `v*` tags    |
