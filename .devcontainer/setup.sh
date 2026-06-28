#!/usr/bin/env bash
# opencode-mem0 Codespace setup — runs on create and every rebuild.
# Installs current bun + opencode, installs deps, builds and links the plugin
# so a rebuild always gives a fresh, working test environment.
set -euo pipefail

echo "=== opencode-mem0 test VM setup ==="

# --- bun (primary runtime for this project) ---
echo "→ Installing bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# --- opencode CLI ---
echo "→ Installing opencode..."
curl -fsSL https://opencode.ai/install | bash

# --- project deps + build ---
echo "→ Installing dependencies..."
bun install

echo "→ Building plugin..."
bun run build

# --- link plugin globally so opencode can load it by name ---
echo "→ Linking opencode-mem0..."
bun link

echo ""
echo "=== Setup complete ==="
echo "bun:       $(bun --version)"
echo "node:      $(node --version)"
echo "opencode:  $(opencode --version 2>/dev/null || echo 'installed — run opencode to verify')"
echo ""
echo "Next steps to start testing:"
echo "  1. opencode auth login -p <provider>   # store your LLM API key"
echo "  2. Create ~/.config/opencode/opencode.json with:"
echo '       { "plugin": ["opencode-mem0"] }'
echo "  3. opencode                             # launch — plugin loads via bun link"
