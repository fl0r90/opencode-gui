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

# 1. Auto-install dependencies if missing or package.json changed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
  echo "⏳ Dependencies missing or outdated. Installing dependencies automatically..."
  npm install --legacy-peer-deps
  echo "✅ Dependencies installed successfully!"
fi

# 2. Check if user wants native Tauri desktop window
if [ "$1" = "--tauri" ] || [ "$1" = "--desktop" ]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "🖥️ Starting Native Tauri Desktop Application..."
    exec npm run tauri dev
  else
    echo "⚠️ Cargo/Rust not found for Tauri native build. Falling back to App Window mode..."
  fi
fi

# 3. Start web server & automatically launch standalone Desktop App Window
PORT="${PORT:-1420}"
HOST="${HOST:-0.0.0.0}"
APP_URL="http://localhost:${PORT}"

echo "🌐 Starting UI on ${APP_URL} ..."

# Helper to automatically open standalone App Window without browser tabs/URL bar
open_app_window() {
  local target_url="$1"
  # Wait for server to respond
  for i in $(seq 1 30); do
    if curl -sI "$target_url" >/dev/null 2>&1; then
      break
    fi
    sleep 0.3
  done

  # Try launching in standalone App Mode (looks 100% like a native desktop app: no tabs, no address bar)
  if command -v google-chrome >/dev/null 2>&1; then
    google-chrome --app="$target_url" >/dev/null 2>&1 &
  elif command -v chromium-browser >/dev/null 2>&1; then
    chromium-browser --app="$target_url" >/dev/null 2>&1 &
  elif command -v chromium >/dev/null 2>&1; then
    chromium --app="$target_url" >/dev/null 2>&1 &
  elif command -v brave-browser >/dev/null 2>&1; then
    brave-browser --app="$target_url" >/dev/null 2>&1 &
  elif command -v msedge >/dev/null 2>&1; then
    msedge --app="$target_url" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$target_url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$target_url" >/dev/null 2>&1 &
  fi
}

# Launch window opener in background
open_app_window "$APP_URL" &

exec npm run dev -- --host "$HOST" --port "$PORT"
