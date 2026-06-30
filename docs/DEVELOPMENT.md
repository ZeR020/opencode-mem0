<!-- generated-by: gsd-doc-writer -->

# Development Guide

Everything you need to set up, build, test, and contribute to opencode-mem0.

---

## Local Setup

### Prerequisites

| Tool        | Version   | Purpose                                     |
| ----------- | --------- | ------------------------------------------- |
| **Bun**     | >= 1.0.0  | Primary runtime and package manager         |
| **Node.js** | >= 20.0.0 | Fallback runtime for builds and npm publish |
| **Git**     | Any       | Version control                             |

Version requirements come from `package.json` `engines`. Verify your setup:

```bash
bun --version   # 1.x.x
node --version  # v20.x.x+
```

### Fork, Clone, and Install

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/opencode-mem0.git
cd opencode-mem0

# 2. Install dependencies
bun install        # or: npm install (fallback)

# 3. Build to verify everything works
bun run build

# 4. Run the type checker
bun run typecheck
```

No `.env.example` or environment variable setup is required for local development. The plugin stores all data locally under `~/.opencode-mem0/` by default.

> **Bun vs Node:** Bun is the preferred runtime (Linux/macOS). `bun install` is faster and the test suite runs under Bun. Node.js 20+ is supported as a fallback on any platform (including Windows) via `better-sqlite3`.

---

## Build Commands

All scripts are defined in `package.json` `scripts`. The primary package manager is Bun; npm works as a fallback.

| Command                 | Description                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `bun run build`         | Compile TypeScript (`tsc`) and copy web assets (`src/web/` → `dist/web/`) via `scripts/build.mjs` |
| `bun run dev`           | Run `tsc --watch` for incremental compilation during development                                  |
| `bun run typecheck`     | Run `tsc --noEmit` — strict type checking without emitting files                                  |
| `bun run test`          | Run the full Vitest test suite                                                                    |
| `bun run test:coverage` | Run tests with V8 coverage (text + lcov + HTML in `./coverage/`)                                  |
| `bun run format`        | Run Prettier on `src/**/*.{ts,js,css,html}`                                                       |
| `bun run format:check`  | Check Prettier formatting without writing changes                                                 |
| `bun audit`             | Security audit of dependencies (Bun built-in)                                                     |
| `bunx vitest`           | Run Vitest in interactive watch mode                                                              |

### Build Pipeline Details

The build script (`scripts/build.mjs`) does two things:

1. **TypeScript compilation** — Spawns `tsc` via `createRequire` to resolve the actual `typescript/bin/tsc` entrypoint, avoiding platform shim issues. Output goes to `dist/` with declaration files (`.d.ts`) and declaration maps.
2. **Web asset copy** — Copies everything from `src/web/` to `dist/web/` for the bundled Web UI.

The `package.json` `files` array controls what gets published: `dist/`, `package.json`, `README.md`, `LICENSE`, `docs/CHANGELOG.md`.

### Git Hooks

Husky manages two git hooks:

- **pre-commit** (`.husky/pre-commit`): Runs security checks (blocks sensitive files like `*.env`, `*.pem`, `*.key`), then `bun run typecheck` and `lint-staged` (auto-formats staged files with Prettier).
- **pre-push** (`.husky/pre-push`): Runs `scripts/lint-deepsource.sh` — a local lint script that catches DeepSource JavaScript analyzer issues before they fail in CI.

---

## Code Style

### Prettier (Formatting)

All TypeScript, JavaScript, CSS, and HTML files are formatted with **Prettier**.

- **Config**: `.prettierrc` — semicolons enabled, double quotes, 2-space indent, 100 char print width, ES5 trailing commas, LF line endings
- **Run**: `bun run format` (write) or `bun run format:check` (check only)
- **Auto-format on commit**: `lint-staged` + Husky pre-commit hook formats staged `*.{ts,tsx,js,jsx,css,html,json,md}` files automatically

### TypeScript (Strict Mode)

The project uses **strict TypeScript** (`tsconfig.json`):

- `strict: true` — all strict family checks enabled
- `noUncheckedIndexedAccess: true` — indexing returns `T | undefined`
- `noImplicitOverride: true` — override keyword required
- `noFallthroughCasesInSwitch: true` — switch exhaustiveness
- `verbatimModuleSyntax: true` — explicit `type` imports required
- Prefer explicit types over `any`. Use `unknown` when the type is truly unknown, then narrow.

### DeepSource Local Lint

`scripts/lint-deepsource.sh` runs before every push and checks for:

1. Async functions without `await` (JS-0116)
2. `var` declarations (JS-0239)
3. Loose equality operators (`==` / `!=`) outside null checks
4. `console.*` usage outside the logger module (JS-E1009)
5. Empty catch blocks
6. Non-null assertions (`!`) without `skipcq` annotation
7. Explicit `any` types without `skipcq` annotation

Run manually:

```bash
bash scripts/lint-deepsource.sh
```

### JSDoc

JSDoc is required for all public functions, classes, and exported constants. Include `@param`, `@returns`, and a brief description.

---

## Branch Conventions

The default branch is **`main`**. Branch naming follows Conventional Commits prefixes:

| Prefix      | Use for                                    |
| ----------- | ------------------------------------------ |
| `feat/`     | New features                               |
| `fix/`      | Bug fixes                                  |
| `docs/`     | Documentation changes                      |
| `refactor/` | Code restructuring without behavior change |
| `test/`     | Adding or updating tests                   |
| `ci/`       | CI/CD changes                              |
| `chore/`    | Maintenance tasks                          |

Examples: `feat/hybrid-search-boost`, `fix/wal-lock-timeout`, `docs/config-examples`

---

## PR Process

1. **Create a feature branch** from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make focused changes** — separate unrelated changes into multiple PRs.

3. **Verify locally** — the PR template (`.github/pull_request_template.md`) requires:
   - [ ] `bun run typecheck` passes
   - [ ] `bun run test` (or `npm test`) passes
   - [ ] `bun run build` succeeds
   - [ ] Code follows project style guidelines
   - [ ] JSDoc comments added for new public functions
   - [ ] README/CHANGELOG updated if needed

4. **Commit messages** must follow Conventional Commits: `type(scope): description`
   - Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`
   - Present tense ("add" not "added")
   - Short, professional, user-facing description

5. **Open the PR** against `main` with a clear description and reference to related issues (`Closes #123`).

6. **CI runs automatically** — typecheck, build, test, and audit must all pass (see `.github/workflows/ci.yml`).

---

## Project Structure

```
opencode-mem0/
├── src/                          # Source code
│   ├── index.ts                  # Plugin entry point, lifecycle hooks
│   ├── plugin.ts                 # Plugin loader contract
│   ├── config.ts                 # Configuration loading and resolution
│   ├── services/
│   │   ├── client.ts             # LocalMemoryClient (primary API surface)
│   │   ├── memory-scoring.ts     # 7-factor memory scoring
│   │   ├── memory-lifecycle.ts   # STM/LTM state machine and decay
│   │   ├── memory-conflicts.ts   # Contradiction detection
│   │   ├── retrieval-context.ts  # Context boost + diversity ranking
│   │   ├── transcript-capture.ts # Chat transcript ingestion hook
│   │   ├── auto-capture.ts       # Automatic memory extraction
│   │   ├── embedding.ts          # Embedding model management
│   │   ├── cleanup-service.ts    # Background maintenance tasks
│   │   ├── ai/                   # AI provider subsystem
│   │   │   ├── ai-provider-factory.ts
│   │   │   ├── provider-config.ts
│   │   │   ├── session/          # AI session management
│   │   │   ├── providers/        # OpenAI, Anthropic, Google, OpenCode
│   │   │   ├── tools/            # Tool schema definitions
│   │   │   └── validators/       # User profile validation
│   │   ├── sqlite/               # Database layer (schema, connections, vector search)
│   │   ├── vector-backends/      # Pluggable vector search (usearch, NSW, exact scan)
│   │   ├── user-profile/         # Profile and preference storage
│   │   ├── user-prompt/          # User prompt management
│   │   └── utils/                # Shared utilities
│   ├── types/                    # TypeScript type definitions
│   └── web/                      # Web UI static assets (HTML, CSS, JS)
├── tests/                        # Vitest test suite (60+ test files)
├── scripts/
│   ├── build.mjs                 # Cross-platform build script
│   ├── lint-deepsource.sh        # Local DeepSource-equivalent linting
│   └── migrate-v1-to-v2.ts      # Database migration utility
├── docs/                         # Project documentation
├── .github/                      # GitHub config (CI, release, issue/PR templates)
└── dist/                         # Compiled output (generated, gitignored)
```

### Adding New Services

To add a new service module:

1. Create `src/services/your-service.ts` with a named export class or function.
2. Add JSDoc to all public exports.
3. Import and integrate in `src/services/client.ts` if it's part of the primary API surface.
4. Create `tests/your-service.test.ts` with descriptive test cases.
5. Run `bun run typecheck && bun run test && bun run build` to verify.

### Debugging

| Problem                  | How to investigate                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Plugin not loading       | Check OpenCode logs for startup errors; verify `opencode.json` plugin array                                |
| Database locked          | Ensure only one OpenCode instance is running; check for stale `*.journal` files in `~/.opencode-mem0/`     |
| Port conflict (Web UI)   | `lsof -i :4747` (macOS/Linux) to find the process using port 4747                                          |
| Search returning nothing | Inspect `memories` table directly: `sqlite3 ~/.opencode-mem0/data` then `SELECT * FROM memories LIMIT 10;` |
| Build failure            | Run `bun run typecheck` first to isolate TypeScript errors from build script issues                        |

The Web UI at `http://localhost:4747` provides a visual way to inspect stored memories, transcripts, and conflicts. To iterate on UI changes, edit `src/web/`, re-run `bun run build`, and restart OpenCode.

---

## Release Process

Releases are automated via `.github/workflows/release.yml`, triggered by pushing a `v*` tag.

```bash
# 1. Bump version in package.json
# 2. Update docs/CHANGELOG.md
# 3. Commit and tag
git add package.json docs/CHANGELOG.md
git commit -m "chore(release): prepare v2.x.x"
git tag v2.x.x
git push origin main --tags
```

CI runs typecheck, build, and test. If all pass, it publishes to npm and creates a GitHub Release. The workflow is idempotent — re-running it won't duplicate publishes if the version already exists on npm.

### Pre-Release Checklist

```bash
bun run typecheck   # No TypeScript errors
bun run build       # Build succeeds
bun run test        # All tests pass
bun audit           # No unaddressed security issues
```

<!-- VERIFY: npm publish uses NPM_TOKEN repository secret and https://registry.npmjs.org -->
