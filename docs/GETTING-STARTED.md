# Getting Started with opencode-mem0

This guide will take you from zero to durable memory in under five minutes. No prior development experience is required.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [First-Time Setup](#first-time-setup)
4. [Basic Usage](#basic-usage)
5. [Memory Scopes](#memory-scopes)
6. [Common Workflows](#common-workflows)
7. [Troubleshooting](#troubleshooting)
8. [Next Steps](#next-steps)

---

## Prerequisites

Before installing, ensure you have the following:

| Requirement            | Version                  | How to check                        |
| ---------------------- | ------------------------ | ----------------------------------- |
| **Bun** or **Node.js** | Bun 1.x+ or Node.js 20+  | `bun --version` or `node --version` |
| **OpenCode**           | Latest                   | `opencode --version`                |
| **Operating System**   | Linux, macOS, or Windows | Any modern OS                       |

If you don't have Bun installed, you can use Node.js as a fallback. Both work equally well.

**Tip:** This plugin stores everything locally. No external account, cloud service, or API key is required for basic usage.

---

## Installation

Choose the method that fits your workflow.

### Method 1: Global Installation (Recommended)

Install once, use everywhere:

```bash
npm install -g opencode-mem0
```

This makes the plugin available to every OpenCode session on your machine.

### Method 2: Project-Local Installation

If you prefer to keep dependencies inside your project:

```bash
npm install opencode-mem0
```

Then add it to your project's OpenCode configuration instead of the global one.

### Method 3: Via the OpenCode Plugin System

Some OpenCode distributions support plugin discovery. If yours does:

```bash
opencode plugin add opencode-mem0
```

> **Which should I choose?** Use global installation for a personal machine. Use project-local if you work on shared environments where you want reproducible setups.

---

## First-Time Setup

After installation, you need to tell OpenCode to load the plugin.

### Step 1: Add to your OpenCode configuration

Edit (or create) `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-mem0"]
}
```

If you already have other plugins, simply append to the array:

```json
{
  "plugin": ["some-other-plugin", "opencode-mem0"]
}
```

### Step 2: Start OpenCode

Open a terminal and run:

```bash
opencode
```

The plugin auto-initializes on startup. You will see a brief startup message confirming the memory store is ready.

### Step 3: Verify the Web UI

Open your browser and navigate to:

```
http://localhost:4747
```

You should see the memory management dashboard. If this page loads, everything is working correctly.

### What just happened?

- A local SQLite database was created at `~/.opencode-mem0/data` (or your configured `storagePath`).
- The vector index for semantic search was initialized.
- A small web server started on port `4747` for visual memory management.
- A default configuration file was created at `~/.config/opencode/opencode-mem0.jsonc` with all options commented out.

No data leaves your machine. All memories, transcripts, and preferences are stored locally.

---

## Basic Usage

Once OpenCode is running with the plugin loaded, you can manage memories directly from chat or via the Web UI.

### Storing a Memory

```
memory add "User prefers bun over npm for package management"
```

The plugin automatically assigns a scope, scores the memory, and indexes it for later retrieval.

### Searching Memories

```
memory search "package manager preference"
```

Results are ranked by a combination of semantic similarity, text match, recency, and the built-in 7-factor memory score.

### Listing All Memories

```
memory list
```

You can also filter by project or scope:

```
memory list --scope project
```

### Deleting a Memory

First, find the memory ID from `memory list` or search results. Then:

```
memory delete <id>
```

Replace `<id>` with the actual memory identifier. Deleted memories are removed permanently.

### Using the Web UI

The Web UI at `http://localhost:4747` provides a visual interface for all of the above operations:

- **Browse** all stored memories in a timeline view.
- **Search** using keywords or natural language.
- **View details** including the 7-factor scoring breakdown.
- **Delete** or **update** memories with one click.
- **Resolve conflicts** when new memories contradict old ones.
- **Search transcripts** of past OpenCode sessions.
- **Manage your profile** and stored preferences.

---

## Memory Scopes

Memories can be scoped to a specific project or shared across all projects.

| Scope          | Behavior                                                 | Best for                                                         |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `project`      | Only visible when working inside the matching project.   | Code conventions, project-specific decisions, temporary context. |
| `all-projects` | Visible everywhere, regardless of which project is open. | Personal preferences, universal rules, cross-project knowledge.  |

**Default scope:** `project`.

When you store a memory inside a project directory, it is automatically tagged with that project's scope. When you store one outside any project, it defaults to `all-projects`.

You can override the default in your configuration:

```jsonc
{
  "memory": {
    "defaultScope": "all-projects",
  },
}
```

---

## Common Workflows

### Workflow 1: Storing a Project Convention

You just decided that all functions in this project must use explicit return types. Store it so the agent remembers:

```
memory add "All functions in this project must use explicit return types. No implicit any allowed."
```

This is scoped to the current project by default. The next time you open this project, the agent will recall this rule.

### Workflow 2: Searching for Past Decisions

You remember making a decision about the database schema last week but don't recall the details. Search for it:

```
memory search "database schema decision"
```

The hybrid search (vector + full-text + scoring + recency) will surface the most relevant memory, even if your query wording differs from the original text.

### Workflow 3: Resolving Conflicts

You store a new memory that contradicts an old one. For example:

- Old memory: "Use npm for package management."
- New memory: "Switch to bun for faster installs."

The plugin detects the conflict and presents options:

- **Keep newer** — replace the old memory.
- **Keep both** — store as separate memories (perhaps with different scopes).
- **Merge** — combine into a single updated memory.
- **Resolve manually** — review in the Web UI and decide yourself.

Conflicts are surfaced in the Web UI at `http://localhost:4747/conflicts` and via the API.

---

## Troubleshooting

### Plugin not loading

**Symptom:** OpenCode starts, but `memory` commands are not recognized.

**Steps:**

1. Verify `opencode-mem0` is in your `~/.config/opencode/opencode.json` plugin array.
2. Confirm the package is installed: `npm list -g opencode-mem0`.
3. Restart OpenCode completely.
4. Check the OpenCode logs for startup errors.

### Web UI not accessible

**Symptom:** `http://localhost:4747` does not load.

**Steps:**

1. Verify OpenCode is running.
2. Check if another service is using port `4747`.
3. Try a different port in your configuration:

   ```jsonc
   {
     "webServerPort": 4748,
   }
   ```

4. Restart OpenCode and try the new port.

### Database locked errors

**Symptom:** Commands fail with "database is locked" or similar.

**Cause:** SQLite only supports one writer at a time.

**Steps:**

1. Close any other OpenCode instances or tools accessing `~/.opencode-mem0/data`.
2. Restart OpenCode.
3. If the issue persists, the lock file may be stale. Stop OpenCode and delete any `*.lock` or `*.journal` files in the data directory, then restart.

### Port conflicts

**Symptom:** Startup fails with "address already in use."

**Steps:**

1. Find what is using the port: `lsof -i :4747` (macOS/Linux) or `netstat -ano | findstr :4747` (Windows).
2. Either stop the conflicting service, or change the `webServerPort` in your configuration.
3. Restart OpenCode.

### Memories not appearing in search

**Symptom:** You added a memory, but it does not show up in results.

**Possible causes:**

- **Scope mismatch** — you searched in a different project than where the memory was stored.
- **Low score** — the memory scored below the relevance threshold and was filtered out.
- **Indexing delay** — embeddings are computed asynchronously. Wait a few seconds and retry.
- **Archived** — very old or low-scoring memories may have been archived automatically.

**Steps:**

1. Use `memory list` to confirm the memory exists.
2. Try `memory search "your query" --scope all-projects`.
3. Check the Web UI for the memory's score and status.

---

## Next Steps

Now that you have durable memory working, you can dive deeper:

- **Customize behavior** — See [`CONFIGURATION.md`](CONFIGURATION.md) for every available option, including AI providers, scoring weights, lifecycle settings, and project-level overrides.
- **Understand the system** — See [`ARCHITECTURE.md`](ARCHITECTURE.md) for a technical deep-dive into how data flows, how the 7-factor scoring works, and how the STM/LTM lifecycle manages memory decay.
- **Development and contribution** — See [`README.md`](../README.md#development) for build instructions, test commands, and contribution guidelines.

If you encounter an issue not covered here, please open an issue on the [GitHub repository](https://github.com/ZeR020/opencode-mem0).

---

<p align="center">
  <sub>Happy remembering.</sub>
</p>
