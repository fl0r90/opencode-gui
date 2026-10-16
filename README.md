# OpenCode GUI (Autonomous LM Studio Multi-Server Edition)

A powerful, lightweight desktop GUI for [OpenCode](https://github.com/opencode-ai/opencode) and [LM Studio](https://lmstudio.ai), upgraded with **direct IP server management** and **autonomous multi-server Master ⇄ Worker agent orchestration**.

Built with **Tauri v2**, **Solid.js**, **Vite**, and **TailwindCSS**.

---

## ⚡ 1-Command Universal Installation

On any Linux machine (Ubuntu, Debian, Fedora, Arch), install everything with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/fl0r90/opencode-gui/main/install.sh | bash
```

This automated script:
1. Installs required system graphical libraries (WebKit2GTK, OpenSSL, build tools).
2. Configures Node.js and the Rust toolchain if missing.
3. Automatically downloads and installs all dependencies.
4. Compiles the native desktop app and registers the `opencode-gui` command globally.

Once installed, simply launch the app from anywhere:
```bash
opencode-gui
```

---

## ✨ Features Added in This Fork

### 1. Direct IP LM Studio Server Connection
- **Zero Config Files**: Add local or remote LM Studio instances directly from the GUI. Simply type the IP address (e.g. `192.168.1.34`, `127.0.0.1`, `192.168.0.25:1234`).
- **Auto-Discovery & Profiling**: Queries `/api/v0/models` and `/v1/models` in real time, measuring network latency, context lengths, and VRAM residency.
- **Persistent Storage**: Configured nodes and custom labels are saved automatically.

### 2. Autonomous Master ⇄ Worker Agent Orchestration
When multiple LM Studio nodes (or models) are connected, the system orchestrates them concurrently without manual prompting:
- **Intelligent Role Election**: 
  - Profiles parameter sizes (`70B`, `32B`, `14B`, `8B`, etc.) and model specializations (Reasoning: `R1`, `QwQ`, `Qwen3` vs Coding: `Coder`, `Codestral`, `DeepSeek-Coder`).
  - Automatically elects the **👑 Master (Architect / Planner / Reviewer)** and **⚡ Worker Agent (Code & Implementation)**.
  - When 2+ physical servers are added, tasks run across both machines to utilize multiple GPUs in parallel.
- **Zero-Config 3-Phase Execution Pipeline**:
  1. **Phase 1 (Master Plan)**: Master analyzes user instructions, designs architecture, and autonomously decides subtasks using `<delegate_to_worker>` blocks. Simple requests are answered immediately without overhead.
  2. **Phase 2 (Worker Execution)**: Subtasks execute in parallel on the worker node(s) with live real-time streaming into the session timeline.
  3. **Phase 3 (Master Review & Integration)**: Master reviews the code, fixes discrepancies, and delivers a unified, production-ready response.

### 3. Native Desktop App & Standalone Window
- Runs as a standalone desktop window powered by **Tauri v2**.
- Fast startup and low memory footprint.
- Resilient offline mode: boots instantly even if the OpenCode CLI daemon (`127.0.0.1:4096`) is not running.

---

## 🚀 Manual Build & Development

If you prefer building manually from source:

```bash
# 1. Clone repository
git clone https://github.com/fl0r90/opencode-gui.git
cd opencode-gui

# 2. Run automated start script (installs missing deps and launches)
./start.sh
```

Or using standard npm / cargo commands:
```bash
# Install dependencies
npm install --legacy-peer-deps

# Run in desktop dev mode (requires Rust)
npm run tauri dev

# Or build native desktop bundle (.deb, .AppImage)
npm run tauri build
```

---

## 🛠️ LM Studio Network Setup

To allow OpenCode GUI to connect to LM Studio instances across your LAN:
1. Open **LM Studio** on your host/rig.
2. Go to the **Developer / Local Server** tab (icon `<->` on the left).
3. Check **Serve on Local Network (0.0.0.0)**.
4. Check **Enable CORS** (Cross-Origin Resource Sharing).
5. Start the server (default port is `1234`).
6. In OpenCode GUI, click **"Add LM Studio IP"**, enter the host IP, and hit **Connect IP**.

---

## 📄 License

Original project licensed under Apache 2.0 / MIT.
See upstream repository: [milisp/opencode-gui](https://github.com/milisp/opencode-gui).