#!/usr/bin/env bash
# opencode-mem0 Codespace setup — runs on create and every rebuild.
# Installs build tools + bun + opencode, installs deps, builds and links the plugin
# so a rebuild always gives a fresh, working test environment.
set -euo pipefail

echo "=== opencode-mem0 test VM setup ==="

# Build tools for native modules (better-sqlite3 fallback). The typescript-node
# base image ships node 22 + npm + node-gyp, but ensure python3/make/g++ exist.
echo "→ Ensuring native-build toolchain..."
sudo apt-get update -qq && sudo apt-get install -y -qq build-essential python3 pkg-config >/dev/null

# --- bun (primary runtime for this project) ---
echo "→ Installing bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# --- opencode CLI ---
echo "→ Installing opencode..."
curl -fsSL https://opencode.ai/install | bash
# opencode installer adds itself to .bashrc; also make it visible to login + non-interactive shells
export PATH="$HOME/.local/bin:$PATH"

# Persist PATH so both login (.profile) and interactive (.bashrc) shells find bun + opencode.
PATH_LINE="export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\""
grep -qxF "$PATH_LINE" "$HOME/.bashrc" 2>/dev/null || echo "$PATH_LINE" >> "$HOME/.bashrc"
grep -qxF "$PATH_LINE" "$HOME/.profile" 2>/dev/null || echo "$PATH_LINE" >> "$HOME/.profile"

# --- project deps + build ---
cd /workspaces/opencode-mem0

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
