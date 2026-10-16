#!/usr/bin/env bash
set -e

# Change to script directory
cd "$(dirname "$0")"

echo "=========================================================="
echo "  🚀 OpenCode GUI (Autonomous LM Studio Multi-Server)    "
echo "=========================================================="

# Auto-load NVM if installed
if [ -z "$(command -v node)" ]; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
  elif [ -s "/usr/local/nvm/nvm.sh" ]; then
    export NVM_DIR="/usr/local/nvm"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
  fi
fi

# Fallback path check
export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed or not in PATH. Please install Node.js (v18+) to run OpenCode GUI."
  exit 1
fi

echo "📦 Node.js version: $(node -v)"
echo "📦 NPM version:     $(npm -v)"

# 1. Auto-install dependencies if node_modules is missing or package.json changed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
  echo "⏳ Dependencies missing or outdated. Installing dependencies automatically..."
  npm install --legacy-peer-deps
  echo "✅ Dependencies installed successfully!"
fi

# 2. Start the dev server
PORT="${PORT:-1420}"
HOST="${HOST:-0.0.0.0}"

echo "🌐 Starting UI on http://localhost:${PORT} (listening on all interfaces: ${HOST}) ..."
echo "👉 Open http://localhost:${PORT} in your browser"
echo "=========================================================="

exec npm run dev -- --host "$HOST" --port "$PORT"
