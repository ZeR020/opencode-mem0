# GSD SDK Quick Reference

## Installation Status: ✅ Ready

- **Package**: `get-shit-done-cc@1.42.3`
- **Path**: `/home/verge/.local/bin/gsd-sdk`
- **Project**: opencode-mem0 (milestone v2.16 — COMPLETE)

---

## What Works Now

### Query Commands (No API key needed)

These work immediately and access your project's `.planning/` directory:

```bash
# Project state
gsd-sdk query state load              # Full project config + state
gsd-sdk query state json              # STATE.md frontmatter as JSON
gsd-sdk query state get               # STATE.md content
gsd-sdk query state get [section]     # Specific section
gsd-sdk query state update <field> <value>
gsd-sdk query state patch --field <f> --value <v>

# Roadmap & phases
gsd-sdk query roadmap analyze         # Full roadmap with disk status
gsd-sdk query roadmap get-phase <n>   # Extract phase from ROADMAP.md
gsd-sdk query phase-plan-index <n>    # Plans for a phase
gsd-sdk query find-phase <n>          # Phase directory info
gsd-sdk query phase next-decimal <n>  # Next phase number

# Summaries & history
gsd-sdk query history-digest          # Aggregate all SUMMARY.md data
gsd-sdk query summary-extract <path> [--fields]
gsd-sdk query verify-summary <path>
gsd-sdk query list-todos [area]       # Pending todos

# Utilities
gsd-sdk query resolve-model <agent>   # Model for agent type
gsd-sdk query generate-slug <text>   # URL-safe slug
gsd-sdk query current-timestamp      # ISO timestamp
gsd-sdk query verify-path-exists <p>  # File/directory check

# With --pick for filtering JSON output
gsd-sdk query --pick milestone state load
gsd-sdk query --pick count list-todos
```

### AI Execution Commands (API key required)

These need `ANTHROPIC_API_KEY` in your environment:

```bash
gsd-sdk run "<prompt>"               # Run full milestone from prompt
gsd-sdk auto                        # Full autonomous lifecycle
gsd-sdk init "<description>"         # Bootstrap new project
gsd-sdk init @path/to/prd.md        # From PRD file
```

**Error without API key**: `Not logged in · Please run /login`

---

## API Key Configuration

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# Required for run/auto/init (Claude Code agent)
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional — enable web search in research phase
export BRAVE_API_KEY="BSA..."
export FIRECRAWL_API_KEY="fc-..."
export EXA_API_KEY="..."
```

Reload: `source ~/.bashrc`

---

## Project Configuration

Config lives at `.planning/config.json`. Key settings:

| Setting                  | Current   | Description                     |
| ------------------------ | --------- | ------------------------------- |
| `model_profile`          | `inherit` | Use workspace model             |
| `commit_docs`            | `false`   | Don't auto-commit planning docs |
| `workflow.research`      | `true`    | Research before planning        |
| `workflow.verifier`      | `true`    | Post-execution verification     |
| `workflow.auto_advance`  | `false`   | Manual phase approval           |
| `git.branching_strategy` | `none`    | No GSD-managed branches         |
| `intel.enabled`          | `true`    | Codebase intelligence           |
| `graphify.enabled`       | `true`    | Knowledge graph integration     |

Modify with: `gsd-sdk query state patch --field <key> --value <val>`

---

## Current Project State

- **Milestone**: v2.16 "Stable, Fast, Smart"
- **Status**: ✅ COMPLETE (100%)
- **Phases**: 6 complete / 6 total
- **Plans**: 15 complete / 15 total
- **Next action**: `/gsd-new-milestone` to start next cycle

---

## Troubleshooting

| Issue                        | Solution                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| `command not found: gsd-sdk` | Run `npm install -g get-shit-done-cc`                                      |
| `requires a command`         | Add a subcommand: `gsd-sdk query <cmd>`                                    |
| `Not logged in`              | Set `ANTHROPIC_API_KEY`                                                    |
| `Unknown command`            | Check spelling or use `gsd-sdk query state load` to see available handlers |
| Stale npx symlink            | `rm ~/.local/bin/gsd-sdk && npm install -g get-shit-done-cc`               |

---

## Resources

- **Docs**: `~/.npm/_npx/.../get-shit-done-cc/README.md`
- **Commands**: `~/.npm/_npx/.../get-shit-done-cc/commands/gsd/`
- **Project planning**: `./.planning/`
- **GitHub**: https://github.com/gsd-build/get-shit-done

---

_Generated: 2026-05-20_
