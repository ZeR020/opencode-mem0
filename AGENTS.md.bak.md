## 🚨 CRITICAL: NEVER COMMIT THESE TO PUBLIC REPO

The following categories MUST remain local/private and NEVER be committed or pushed to the public GitHub repository:

| Category                   | Examples                                     | Why                                                                          |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| **Agent tooling/config**   | `.opencode/`, `AGENTS.md`, `.opencode.json`  | Personal workflow intelligence, agent definitions, proprietary GSD framework |
| **Security audits**        | `.planning/`, `*CONCERNS*`, `*AUDIT*` files  | Internal vulnerability assessments that reveal attack surface                |
| **Support tickets**        | `GITHUB_SUPPORT_TICKET*`, `*SUPPORT_TICKET*` | Internal communications, may contain personal info or private issues         |
| **Environment secrets**    | `.env*`, `*.pem`, `*.key`, credential files  | API keys, tokens, passwords                                                  |
| **Local development data** | `graphify-out/`, `temp/`, `*.test.db`        | Generated artifacts, test databases with real data                           |

**Rule for agents:** Before creating ANY new file outside of `src/`, `tests/`, `examples/`, `scripts/`, `.github/`, or standard OSS docs (README, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, LICENSE), ask: _"Would a random GitHub visitor benefit from seeing this?"_ If no, keep it local.

**If you accidentally commit any of the above:** Immediately run `git rm --cached <file>`, add to `.gitignore`, and consider a history rewrite if personal info was exposed.

---

## Project State

### Current Version

- **v2.14.2** (published to npm as `opencode-mem0`)
- Last release: 2026-04-30
- GitHub Release: https://github.com/ZeR020/opencode-mem0/releases/tag/v2.14.2

### Architecture

OpenCode plugin giving coding agents persistent memory via local vector database (SQLite + usearch).
Built as cognitive enhancement of tickernelz/opencode-mem (upstream) with fresh git history.

### Key Features Implemented

- **Transcript Storage Layer** — session capture, FTS5 search, configurable retention
- **7-Factor Memory Scoring** — recency, frequency, importance, utility, novelty, confidence, interference
- **STM/LTM Dual-Store Lifecycle** — Ebbinghaus decay, auto-promotion, archival
- **Intelligent Conflict Resolution** — LLM + heuristic contradiction detection
- **Hybrid Search** — vector + FTS5 + multi-factor ranking + context boost + diversity filtering
- **Web UI** — built-in management interface at localhost:4747
- **Migration Script** — `scripts/migrate-v1-to-v2.ts` for upgrading existing databases

### Platform Requirements

- **Bun runtime** (Linux/macOS only). Windows requires WSL2.
- Node.js 20+ fallback partial; `bun:sqlite` is hard dependency.

### Security Status

- **0 vulnerabilities** — `bun audit` clean
- Overrides patch transitive vulns: `protobufjs ^7.5.6`, `yaml ^2.8.3`, `uuid ^14.0.0`

### Repo Infrastructure (Full-Fledged)

- MIT License (full text)
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- GitHub issue templates (bug report + feature request)
- PR template with checklist
- CI workflow (typecheck + test + build + audit)
- Release workflow (tests + npm publish + GitHub release)

### Known Issues

1. **GitHub Contributors Bug** — GraphQL `mentionableUsers` incorrectly shows upstream contributors (rnbguy, Coqueiro, tickernelz, etc.) from tickernelz/opencode-mem. REST API `/contributors` correctly shows only ZeR020. This is a GitHub platform heuristic bug, not fixable via code.
2. **Test suite parallel execution interference** — 12 tests fail when `bun test` runs all together, but pass in isolation. Root causes: `connectionManager.closeAll()` affects concurrent profile tests; subprocess tests hang on background jobs; module cache pollution from mocks. CI uses `continue-on-error: true`. All 172 tests pass individually.
3. **Schema drift in manual test fixtures** — Vector backend integration tests and migration fallback test previously used v1 `memories` schema without v2 columns (`is_deprecated`, scoring fields, lifecycle fields). Fixed in commit a6853cb.

### File Structure

```
src/
├── index.ts                    # Plugin entry, lifecycle hooks
├── config.ts                   # Configuration loading
├── services/
│   ├── client.ts               # LocalMemoryClient
│   ├── memory-scoring.ts       # 7-factor scoring
│   ├── memory-lifecycle.ts     # STM/LTM management
│   ├── memory-conflicts.ts     # Contradiction detection
│   ├── retrieval-context.ts    # Context boost + diversity
│   ├── transcript-capture.ts   # Transcript hook
│   ├── sqlite/
│   │   ├── vector-search.ts       # Hybrid search
│   │   ├── transcript-manager.ts  # Transcript DB
│   │   ├── shard-manager.ts     # Sharding + migration
│   └── web/                    # UI
├── examples/                   # basic-usage.ts, custom-scoring.ts
└── scripts/
    └── migrate-v1-to-v2.ts     # Database migration
```

### Development Commands

```bash
bun install          # Install deps
bun run build        # TypeScript compile + copy web assets
bun run typecheck    # tsc --noEmit
bun test             # Run test suite
bun run format       # Prettier format
bun audit            # Security audit
```

### Tool Preferences

| Instead of   | Use            | Why                                                    |
| ------------ | -------------- | ------------------------------------------------------ |
| `grep`       | `rg` (ripgrep) | Recursive, respects `.gitignore`, colored, MUCH faster |
| `ls`         | `eza`          | Colors, git integration, tree view                     |
| `cat`        | `batcat`       | Syntax highlighting, git gutter, line numbers          |
| `find`       | `fdfind`       | Fast, respects `.gitignore`, simpler syntax            |
| `cd`         | `zoxide`       | Frecency-based directory jumping (type `z <pattern>`)  |
| `top`        | `htop`         | Interactive, colored, better process tree              |
| `diff` (git) | `delta`        | Syntax-highlighted diffs, side-by-side                 |
| `vim`/`nano` | `nvim`         | Modern vim with LSP support                            |
| `man`        | `tldr`         | Practical command examples                             |
| `rm` (files) | `trash`        | Moves to trash instead of permanent deletion           |
| `curl` only  | `curl` + `jq`  | Always pipe JSON API output through `jq`               |

**Critical notes:** `batcat`/`fdfind` are Ubuntu binary names; `yq` is the **Python** version (3.1.0), not Go; `delta` is auto-configured in gitconfig.

### Package Manager Safety

- **System packages:** Use `apt` (do not use `pip install --upgrade` on system packages)
- **Node packages:** Use `npm` via `nvm` — never system node/npm
- **Python packages:** Many are system-managed. Use `sudo apt upgrade python3-*` instead of `pip install --upgrade`

### Quick Reference

```bash
fd <pattern>                    # fdfind alias
rg <pattern> <path>             # ripgrep
batcat <file>                   # syntax highlighted
del <file>                      # trash alias
git diff                        # auto-uses delta
git log --graph                 # visual history
```

---

## Git & GitHub Standards

### Commit Messages

- Always use conventional commit format: `type(scope): description`
- Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`
- Description must be short, professional, and user-facing
- No bullet points revealing internal cleanup, history rewrites, or debugging work
- If amending history, message should reflect the end state, not the process

### Pre-Push Checklist

- No `AGENTS.md`, `.opencode/`, `opencode.json`, `graphify-out/` in staging
- No files matching: `*.pem`, `*.key`, `.env*`, `*AUDIT*`, `*CONCERNS*`, `*SUPPORT_TICKET*`, `claude*.md`, `*report.md`
- No real email addresses or user IDs hardcoded in any file
- No personal file paths (e.g. `/home/verge/`, `/mnt/c/Users/`) in any committed file
- Run `git diff --cached --name-only` and review before every push

## If any of the above are found in staging, abort the push, `git rm --cached` the file, add to `.gitignore`, then re-stage clean files.

## graphify

This project has a graphify knowledge graph at graphify-out/.

### When to use what

| Situation                             | Command                                         | Cost                               |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| **First time / after major refactor** | `graphify .` or `/graphify .`                   | Full rebuild (AST + semantic)      |
| **After code changes only**           | Auto-handled by `graphify watch` + git hook     | **Free** (AST-only)                |
| **After docs/images/web changes**     | `graphify --update .` or `/graphify --update .` | LLM tokens for semantic extraction |
| **Quick check if update needed**      | `graphify check-update .`                       | **Free** (just checks flag)        |
| **Query the graph**                   | `graphify query "<question>"`                   | **Free** (reads existing graph)    |
| **Trace path between concepts**       | `graphify path "A" "B"`                         | **Free**                           |
| **Explain a node**                    | `graphify explain "<concept>"`                  | **Free**                           |

### Key rules for agents

- Before answering architecture questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query`, `graphify path`, or `graphify explain` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files, `graphify update .` is usually enough (AST-only, no API cost)
- After modifying docs, HTML, images, or any non-code files, use `graphify --update .` to trigger semantic re-extraction

### Graph outputs (in graphify-out/)

- **graph.json** — raw graph data (nodes + edges + communities)
- **GRAPH_REPORT.md** — audit report with god nodes, surprising connections, cohesion scores
- **graph.html** — interactive visualization (open in browser)
- **wiki/** — Obsidian-style wiki with community overviews and node articles
- **.needs_update** — flag file; if present, semantic re-extraction is pending

### Automation

- **Watch process:** `graphify watch .` is running in background — auto-rebuilds on code changes
- **Git hook:** post-commit hook rebuilds graph after every commit (code files only)
- **Semantic updates:** NOT automated (requires LLM tokens). Check `graphify-out/.needs_update` or run `graphify check-update .`

---

## Agent Maintenance Rule

**Update this AGENTS.md** when making major changes:

- New release → bump version in "Current Version"
- New feature → add to "Key Features Implemented"
- Breaking change → document migration path
- New/Fixed issue → add/remove in "Known Issues"
- Architecture change → update "File Structure"
- **Do NOT update** for minor refactors, docs-only changes, or dependency bumps.
- **Keep this file under 200 lines.** If it grows, compress or move details to README/CHANGELOG.
