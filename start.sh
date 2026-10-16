#!/usr/bin/env bash
set -e
export PATH="/home/cfp-90/.nvm/versions/node/v20.19.5/bin:$PATH"
cd "$(dirname "$0")"
echo "🚀 Starting OpenCode GUI (Autonomous LM Studio Multi-Server Edition) on http://localhost:1420 ..."
npm run dev -- --host 0.0.0.0
