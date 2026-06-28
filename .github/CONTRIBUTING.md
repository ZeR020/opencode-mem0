# Contributing to opencode-mem0

Welcome, and thank you for your interest in contributing to **opencode-mem0** — an MIT-licensed OpenCode plugin that gives coding agents persistent, private long-term memory using a local vector database (SQLite + usearch).

This project is a cognitive enhancement of [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem) (upstream) with a fresh git history, cross-platform support, and advanced features such as 7-factor memory scoring, STM/LTM dual-store lifecycle, intelligent conflict resolution, and hybrid vector + FTS5 search.

Whether you're fixing a bug, adding a feature, improving documentation, or sharing feedback, we appreciate your help.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style Requirements](#code-style-requirements)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Areas Needing Contributions](#areas-needing-contributions)
- [Security Issues](#security-issues)
- [Code of Conduct](#code-of-conduct)
- [License](#license)
- [Attribution](#attribution)

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) 1.x **(primary runtime)** or Node.js 20+
- Git

### Quick Start

```bash
# 1. Fork the repository on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/opencode-mem0.git
cd opencode-mem0

# 3. Install dependencies
bun install        # or: npm install

# 4. Verify the build
bun run build      # or: npm run build

# 5. Run the test suite
bun test           # or: npm test
```

### Useful Commands

| Command                 | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `bun run typecheck`     | Run TypeScript in strict mode (`tsc --noEmit`) |
| `bun test`              | Run the full test suite (Vitest)               |
| `bun run test:coverage` | Run tests with coverage report                 |
| `bun run format`        | Format code with Prettier                      |
| `bun run format:check`  | Check formatting without writing               |
| `bun run build`         | Compile TypeScript + copy web assets           |
| `bun audit`             | Run security audit                             |

---

## Code Style Requirements

All contributions must follow these standards. CI will enforce them.

### TypeScript

- **Strict mode is mandatory.** All code must pass `tsc --noEmit` with zero errors.
- Prefer explicit types over `any`. Use `unknown` when the type is truly unknown, then narrow.
- Keep functions focused and testable. Avoid deep nesting.

### Formatting

- **Prettier** is used for all TypeScript, JavaScript, CSS, and HTML files.
- Run `bun run format` before committing, or configure your editor to format on save.
- `lint-staged` + Husky will auto-format staged files, but do not rely solely on this.

### Documentation

- **JSDoc is required** for all public functions, classes, and exported constants.
- Include `@param`, `@returns`, and a brief description of behavior and side effects.
- Update relevant documentation in `docs/` if your change affects user-facing behavior.

### Commit Messages

We use **Conventional Commits**. This drives our changelog and release automation.

```
type(scope): description
```

**Valid types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`

Examples:

```
feat(retrieval): add diversity-aware re-ranking
fix(sqlite): handle WAL checkpoint during concurrent reads
docs(api): document new env:// override syntax
test(scoring): add edge case for negative recency boost
```

- Use the present tense ("add" not "added").
- Do not use bullet points or reveal internal cleanup/history rewrites in commit messages.
- If you amend a commit, the message must reflect the **end state**, not the process.

---

## Testing Requirements

- **Run the full test suite before opening any pull request:**

  ```bash
  bun test      # or: npm test
  ```

- The project currently maintains **430+ tests** across 53 test files.
- All tests must pass. If a test is flaky, open an issue rather than ignoring it.
- New features must include accompanying tests.
- Bug fixes should include a regression test that fails before the fix and passes after.
- Use descriptive test names. Prefer `it('should reject invalid API keys', ...)` over `it('test 7', ...)`.

---

## Pull Request Process

1. **Fork and branch**
   - Create a feature branch from `main`:
     ```bash
     git checkout -b feature/your-feature-name
     ```
   - Use descriptive branch names: `feat/hybrid-search-boost`, `fix/wal-lock-timeout`, `docs/config-examples`.

2. **Make your changes**
   - Follow the [Code Style Requirements](#code-style-requirements).
   - Keep changes focused. Separate unrelated changes into multiple PRs.

3. **Verify locally**
   - [ ] `bun run typecheck` passes
   - [ ] `bun test` passes (all tests green)
   - [ ] `bun run build` succeeds
   - [ ] `bun audit` reports no new vulnerabilities
   - [ ] `bun run format` has been applied

4. **Update documentation**
   - If your PR changes user-facing behavior, update the relevant docs in `docs/` (e.g., `CONFIGURATION.md`, `GETTING-STARTED.md`, `DEVELOPMENT.md`, `ARCHITECTURE.md`).
   - If you modify configuration options, update the JSON schema and example configs.

5. **Open the PR**
   - Fill out the PR template (if applicable).
   - Include a clear description of what changed and **why**.
   - Reference related issues: `Closes #123`, `Fixes #456`.
   - Ensure CI passes (typecheck, build, test, audit).

6. **Review**
   - Request review from maintainers.
   - Be responsive to feedback. Changes may be requested before merging.


---

## Release Process

Releases are automated via GitHub Actions (`.github/workflows/release.yml`), triggered by pushing a `v*` tag. The workflow runs typecheck → build → test → npm publish → GitHub release.

### How releases are prepared

1. All changes are delivered via PRs to `main` (no direct commits)
2. The maintainer bumps the version in `package.json` and writes a changelog entry in `docs/CHANGELOG.md`
3. The changelog entry includes: **Added**, **Fixed**, **Removed**, **Changed**, **Closed** sections, and a **Contributors** section crediting community contributors by GitHub username
4. A `vX.Y.Z` tag is pushed, which triggers the release workflow
5. The GitHub release body is extracted from `docs/CHANGELOG.md`, with auto-generated PR references appended

### Contributor Credits

Community contributors who report issues or submit PRs are credited in:
- The `docs/CHANGELOG.md` **Contributors** section for the release that includes their contribution
- The GitHub release notes (auto-generated from PRs, manually added for issue reporters)

If you report an issue that gets fixed, you will be credited by your GitHub username in the release that ships the fix.

### Version Numbering

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
- **Major (X.0.0):** Breaking changes to the public API or config schema
- **Minor (X.Y.0):** New features, bug fixes, dead code removal (safe if removed APIs had zero consumers)
- **Patch (X.Y.Z):** Bug fixes only
---

## Areas Needing Contributions

We welcome contributions in all areas. Below are some open directions:

- **Additional AI providers** — Integrations beyond OpenAI, Anthropic, and Google Gemini.
- **Embedding backends** — Alternative local embedding models or backends.
- **Web UI improvements** — Accessibility, mobile layout, or new visualizations.
- **Performance** — Faster vector search, reduced memory footprint, or parallelized indexing.
- **Cross-platform packaging** — Easier install methods for Windows, macOS, and Linux.
- **Documentation** — Tutorials, video guides, or translated docs.
- **Test coverage** — Edge cases for conflict resolution, migration paths, and platform abstractions.

If you have an idea not listed here, open a discussion issue first so we can align on approach before you invest significant time.

---

## Security Issues

**Do NOT open a public issue for security vulnerabilities.**

Instead, report privately via one of these channels:

- Open a [GitHub private security advisory](https://github.com/ZeR020/opencode-mem0/security/advisories/new)
- Or contact the maintainer directly: [@ZeR020](https://github.com/ZeR020)

We aim to acknowledge receipt within 48 hours and will work with you to assess, fix, and disclose responsibly. See [SECURITY.md](./SECURITY.md) for the full policy, supported versions, and disclosure timeline.

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainer.

---

## License

By contributing to opencode-mem0, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## Attribution

opencode-mem0 is a cognitive enhancement fork of [tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem), the upstream OpenCode memory plugin. We are grateful for the foundation it provided and recognize its authors for the original design and architecture.
