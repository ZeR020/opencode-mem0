#!/usr/bin/env bash
# opencode-mem0 Codespace setup — runs on create and every rebuild.
# Installs build tools + bun + opencode, installs deps, builds and links the plugin
# so a rebuild always gives a fresh, working test environment.
set -euo pipefail

echo "=== opencode-mem0 test VM setup ==="

# Build tools + JupyterLab. The typescript-node base image ships node 22 +
# npm + node-gyp and has python3, but lacks build tools, pip, and JupyterLab.
echo "→ Ensuring native-build toolchain + JupyterLab..."
sudo apt-get update -qq && sudo apt-get install -y -qq build-essential pkg-config python3-pip >/dev/null
# JupyterLab into system Python (Codespaces "Open in JupyterLab" needs it).
# --break-system-packages is safe on a throwaway codespace VM (PEP 668).
sudo pip3 install --break-system-packages jupyterlab >/dev/null 2>&1

# --- bun (primary runtime for this project) ---
echo "→ Installing bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# --- opencode CLI (via npm — reliable in non-interactive postCreateCommand) ---
echo "→ Installing opencode..."
npm install -g opencode-ai
# npm global bin is already on PATH for node-baked-in images; no extra PATH needed

# Symlink bun into /usr/local/bin so non-login shells (OMP ssh tool, postCreateCommand) find it
# without needing a PATH export. .bashrc already has the bun PATH for interactive shells.
sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun

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
