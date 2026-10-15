# Claude Session Manager (VS Code Extension)

[Tiếng Việt](README.vn.md) | **English**

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://marketplace.visualstudio.com)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> A fast, lightweight, and real-time VS Code extension to monitor, organize, categorize, and switch between **Claude Code** sessions effortlessly. Seamlessly supports both **Issue/Ticket-based workflows (`#xxxx`)** and **free-form ad-hoc chats**.

---

## 💡 Why Claude Session Manager?

When working extensively with Claude Code (or autonomous AI agent workflows):
- You often have multiple tasks running simultaneously and lose track of which session is **running**, which is **done**, and which is **awaiting your approval (`need accept`)**.
- Chat logs accumulate over time, making it hard to find and switch back to previous contexts.
- Reviewing command execution or jumping back into an old session requires manually finding session IDs or typing terminal commands.

**Claude Session Manager** inspects active OS runtime processes and session transcripts in real-time, bringing an interactive, clean, single-click task dashboard right into your VS Code Sidebar and Status Bar.

---

## ✨ Key Features

### 1. Real-Time OS Process & State Tracking
- 🔵 **Running**: Tracked directly via OS-level Process ID (PID) liveness. The session only shows as running when the Claude process is actively alive in system memory.
- 🟡 **Need Accept**: Instantly alerts you when Claude is paused waiting for your permission (dangerous shell commands, file modifications, or plan approvals).
- 🟢 **Done**: Tasks that have completed their turn.

### 2. Dual Workflow Modes
- **Ticket / Issue-Driven Workflow**: Automatically parses issue tags matching `#<number>` (e.g., `#100`, `#7152`, `#5433`), displays a dedicated highlighted badge, and cleans up redundant text from session titles.
- **Free-Form Chat Workflow**: When no issue number is present, it intelligently extracts your initial query as the concise session title without placeholder artifacts.

### 3. Dual Notification Access Points
- **Activity Bar (Sidebar)**: Custom Claude icon with a **real-time numeric badge** indicating active tasks requiring approval.
- **Status Bar (Bottom Right)**: Live indicator (e.g., `🔔 Claude: 1 Need Accept` or `✨ Claude: 5 Tasks`) that focuses the panel with a single click.

### 4. 1-Click Instant Session Switch
Click on any session card to immediately open and focus the corresponding conversation tab in Claude Code.

### 5. Clean, Single-Line Meta Layout (Zero Clutter)
Every session card displays rich, distraction-free technical metrics neatly truncated on single lines:
- 🕒 **Relative Timestamp**: `3 minutes ago`, `2 hours ago`, `5 days ago`...
- 💻 **Environment Source**: `VS Code` or `Terminal`
- 🌿 **Git Branch**: Identifies the working git branch per session.
- ✨ **Model Identifier**: `Opus 5.5`, `Sonnet 3.7`, `Haiku 3.5`...
- 🗄️ **Token Metrics**: Compact human-readable token counts (`1.5B · 2.4M out`).
- 💵 **Cost Tracking**: Accurate calculated USD API expense per task.
- 💬 **Turns Count & Short Session ID** (first 8 characters).

### 6. Sub-millisecond Load Times & Auto Cache Purge
- Employs in-memory caching and 64KB chunked file streaming for instantaneous 0ms panel rendering.
- Automatically purges deleted session files to keep your dashboard clean.

---

## 🛠️ Installation

### Method 1: Install from `.vsix` Package (Recommended for Users)

Compatible with macOS, Linux, and Windows without requiring Node.js:

1. Download **`claude-session-manager-0.1.0.vsix`** from the latest GitHub Release or repository root.
2. Open VS Code and press:
   - **macOS**: `Cmd + Shift + P`
   - **Windows / Linux**: `Ctrl + Shift + P`
3. Type:
   ```text
   Extensions: Install from VSIX...
   ```
4. Select the downloaded `.vsix` file and click **Install**.
5. Reload VS Code (`Developer: Reload Window`).

---

### Method 2: Development & Source Build

```bash
# 1. Clone repository
git clone https://github.com/mquand/Claude-Session-Manager-.git
cd Claude-Session-Manager-

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile

# 4. Open in VS Code and press F5 to launch the Extension Development Host
code .
```

---

## ⚙️ Configuration

The extension defaults to standard Claude Code directories:
- `~/.claude/projects` (session transcript logs)
- `~/.claude/sessions` (active runtime PID states)

To customize settings:
1. Open VS Code Settings (`Cmd + ,` or `Ctrl + ,`).
2. Search for `Claude Session Manager`.
3. Configurable properties:
   - `claudeSessionManager.storagePath`: Custom path to your Claude project directory.
   - `claudeSessionManager.autoRefreshInterval`: Background scan interval in seconds (default: `10`).

---

## 📦 Building a New `.vsix` Release

To package a new release for distribution:

```bash
npm run compile
npx @vscode/vsce package --no-dependencies
```

This outputs `claude-session-manager-0.1.0.vsix`, ready to be attached to GitHub Releases.

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
