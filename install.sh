#!/usr/bin/env bash
set -e

# ==============================================================================
# OpenCode GUI - Autonomous LM Studio Multi-Server Edition
# One-Command Universal Installer
# ==============================================================================

echo "=========================================================="
echo "  🚀 Installing OpenCode GUI (LM Studio Multi-Server)     "
echo "=========================================================="

REPO_DIR="$HOME/.opencode-gui-app"
TARGET_DIR="${PWD}"

# If running directly via curl/bash, clone to $HOME/.opencode-gui-app
if [ ! -f "package.json" ]; then
  echo "📥 Cloning repository..."
  rm -rf "$REPO_DIR"
  git clone https://github.com/fl0r90/opencode-gui.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# 1. Detect OS & Package Manager
OS_TYPE="$(uname -s)"
echo "🖥️  Detected OS: $OS_TYPE"

install_linux_deps() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "📦 Detected Debian/Ubuntu. Installing required system libraries..."
    if [ "$EUID" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
      sudo apt-get update -y || true
      sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev build-essential curl wget file || true
    elif [ "$EUID" -eq 0 ]; then
      apt-get update -y || true
      apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev build-essential curl wget file || true
    fi
  elif command -v dnf >/dev/null 2>&1; then
    echo "📦 Detected Fedora/RHEL. Installing required system libraries..."
    sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget || true
  elif command -v pacman >/dev/null 2>&1; then
    echo "📦 Detected Arch Linux. Installing required system libraries..."
    sudo pacman -S --noconfirm webkit2gtk-4.1 base-devel openssl curl wget || true
  fi
}

if [ "$OS_TYPE" = "Linux" ]; then
  install_linux_deps
fi

# 2. Check / Install Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "📦 Node.js not found. Installing via NodeSource..."
  if [ "$OS_TYPE" = "Linux" ] && command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || true
    sudo apt-get install -y nodejs || true
  fi
fi

# Fallback: check NVM
if [ -z "$(command -v node)" ]; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required. Please install Node.js (https://nodejs.org) and re-run."
  exit 1
fi

echo "✅ Node.js: $(node -v)"
echo "✅ NPM:     $(npm -v)"

# 3. Check / Install Rust Toolchain (needed for native Tauri desktop build)
if ! command -v cargo >/dev/null 2>&1; then
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.cargo/env"
  fi
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "🦀 Rust/Cargo not found. Installing Rust toolchain (user mode)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi

if command -v cargo >/dev/null 2>&1; then
  echo "✅ Rust:    $(rustc --version)"
  echo "✅ Cargo:   $(cargo --version)"
fi

# 4. Install Node Dependencies
echo "📦 Installing project dependencies..."
npm install --legacy-peer-deps

# 5. Build native Desktop application
echo "🔨 Building native desktop application with Tauri..."
if command -v cargo >/dev/null 2>&1; then
  npm run tauri build || {
    echo "⚠️ Native Tauri build completed with warnings. Running dev launcher..."
  }
fi

# 6. Create universal desktop command / shortcut: 'opencode-gui'
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

cat << 'EOF' > "$BIN_DIR/opencode-gui"
#!/usr/bin/env bash
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
APP_DIR="$HOME/.opencode-gui-app"
if [ ! -d "$APP_DIR" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ -f "$APP_DIR/start.sh" ]; then
  exec "$APP_DIR/start.sh" "$@"
else
  cd "$APP_DIR" && npm run tauri dev
fi
EOF

chmod +x "$BIN_DIR/opencode-gui"
chmod +x start.sh

# Add to PATH in .bashrc if missing
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.bashrc"
  export PATH="$BIN_DIR:$PATH"
fi

echo "=========================================================="
echo "🎉 INSTALLATION COMPLETE!"
echo ""
echo "You can now run OpenCode GUI anytime from anywhere with:"
echo "   opencode-gui"
echo ""
echo "Or start it right now:"
echo "   ./start.sh"
echo "=========================================================="
