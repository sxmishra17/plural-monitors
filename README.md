# Plural Monitors 🖥️

A cross-platform (Windows-first) Electron desktop application that provides independent, per-monitor supplemental taskbars. Designed for multi-display setups, it tracks windows and minimizes them exclusively to the taskbar of the display they were open on.

> **Note:** Windows 10/11 includes a native setting for this behavior (`Taskbar behaviors > Taskbar where window is open`). This application was created as a custom overlay alternative and as a foundation for Linux support where this feature is often missing.

## Features ✨
- **Mult-Monitor Support:** Automatically detects all connected displays and spawns a sleek, frameless taskbar per monitor.
- **Intelligent Tracking:** PowerShell-based window tracking binds minimized application icons strictly to their last known monitor.
- **Modern UI:** Glassmorphism design and deep dark theme (#0a0a0f) powered by raw HTML/CSS/JS.
- **Native Extraction:** Real-time Win32 API calls extract executable icons natively via `System.Drawing.Icon`.
- **Extensible:** Includes a drop-in Plugin Manager foundation for future widgets (clocks, CPU monitors).
- **Settings Panel:** Fully customizable settings (height, accent color, opacity, etc.) persisted to `%APPDATA%`.

## Architecture 🔧
- **Main Process (Node.js):** Manages `WindowTracker` (spawns PowerShell scripts for async window polling) and `MonitorManager`.
- **Preload Bridge:** Context isolation and IPC bridging via `contextBridge`.
- **Renderer Process:** Standalone Taskbar UIs + Settings UI.
- **Scripts:** 
  - `window-monitor.ps1` (enumerates windows and attributes them by spatial metrics)
  - `get-icon.ps1` (extracts base64 icon from PID)
  - `restore-window.ps1` (Win32 window restore)

## Getting Started 🚀

### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18+ recommended)
- Windows OS (for the PowerShell tracking engine)

### Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/plural-monitors.git
cd plural-monitors

# Install dependencies
npm install

# Run in development mode
npm start
```

### Packaging 📦
To generate the standalone `.exe` installer (NSIS):
```bash
npm run build:win
```
The installer will be generated in the `dist/` directory.

## License 📜
All Rights Reserved
