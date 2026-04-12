'use strict';
/**
 * window-tracker.js
 * Spawns a long-running PowerShell process to enumerate OS windows every second.
 * Tracks last-known monitor for each window so minimized windows (which move to -32000,-32000)
 * can still be attributed to the correct monitor.
 *
 * Emits events:
 *   'windows-updated'  { monitorId -> [WindowInfo] }   — only when data changed
 *   'icon-ready'       { pid, iconBase64 }              — when an icon is fetched
 *   'error'            Error
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const { app } = require('electron');

// Resolve scripts directory — works both in dev and packaged (extraResources)
function getScriptsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts');
  }
  return path.join(__dirname, '..', 'scripts');
}

class WindowTracker extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<number, string>}  hwnd -> monitorId  */
    this._lastKnownMonitor = new Map();

    /** @type {Set<number>}  pids we already have icons for */
    this._iconCache = new Map();

    /** @type {Array<Display>}  set by monitor-manager */
    this._displays = [];

    /** @type {ChildProcess | null} */
    this._psProcess = null;

    this._lineBuffer = '';
    this._running = false;

    // IDs of our own windows to exclude from tracking
    this._ownHwnds = new Set();
  }

  /**
   * Update the list of known displays. Called whenever monitor layout changes.
   * @param {Electron.Display[]} displays
   */
  setDisplays(displays) {
    this._displays = displays;
  }

  /**
   * Register a window handle to exclude from tracking (our own taskbar windows).
   * @param {number} hwnd
   */
  addOwnHwnd(hwnd) {
    this._ownHwnds.add(hwnd);
  }

  removeOwnHwnd(hwnd) {
    this._ownHwnds.delete(hwnd);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._spawnMonitor();
  }

  stop() {
    this._running = false;
    if (this._psProcess) {
      this._psProcess.kill();
      this._psProcess = null;
    }
  }

  _spawnMonitor() {
    const scriptPath = path.join(getScriptsDir(), 'window-monitor.ps1');
    this._psProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath
    ], {
      windowsHide: true
    });

    this._lineBuffer = '';

    this._psProcess.stdout.on('data', (chunk) => {
      this._lineBuffer += chunk.toString('utf8');
      const lines = this._lineBuffer.split('\n');
      this._lineBuffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this._processLine(trimmed);
      }
    });

    this._psProcess.stderr.on('data', (d) => {
      console.error('[WindowTracker PS stderr]', d.toString());
    });

    this._psProcess.on('exit', (code) => {
      if (this._running) {
        console.warn('[WindowTracker] PS exited with', code, '— restarting in 2s');
        setTimeout(() => this._spawnMonitor(), 2000);
      }
    });
  }

  /**
   * Process one line of JSON from the PowerShell monitor script.
   * @param {string} line
   */
  _processLine(line) {
    let windows;
    try {
      windows = JSON.parse(line);
    } catch (e) {
      return; // skip malformed lines
    }

    if (!Array.isArray(windows)) return;

    // Filter out our own taskbar windows
    windows = windows.filter(w => !this._ownHwnds.has(w.Handle));

    // Build current snapshot
    const currentSnapshot = new Map();
    for (const w of windows) {
      currentSnapshot.set(w.Handle, w);
    }

    // Update last-known monitor for non-minimized windows
    for (const [hwnd, w] of currentSnapshot) {
      if (!w.IsMinimized) {
        const monitorId = this._findMonitorForRect(w.Left, w.Top, w.Right, w.Bottom);
        if (monitorId) {
          this._lastKnownMonitor.set(hwnd, monitorId);
        }
      }
    }

    // Remove stale entries in last-known cache
    for (const hwnd of this._lastKnownMonitor.keys()) {
      if (!currentSnapshot.has(hwnd)) {
        this._lastKnownMonitor.delete(hwnd);
      }
    }

    // Group MINIMIZED windows by their last-known monitor
    /** @type {Map<string, WindowInfo[]>} monitorId -> windows */
    const byMonitor = new Map();
    for (const display of this._displays) {
      byMonitor.set(String(display.id), []);
    }

    let hasNew = false;
    for (const [hwnd, w] of currentSnapshot) {
      if (w.IsMinimized) {
        const monitorId = this._lastKnownMonitor.get(hwnd) || this._getPrimaryMonitorId();
        if (!byMonitor.has(monitorId)) byMonitor.set(monitorId, []);
        byMonitor.get(monitorId).push(w);

        // Request icon if we don't have it
        if (!this._iconCache.has(w.Pid)) {
          this._iconCache.set(w.Pid, 'pending');
          this._fetchIcon(w.Pid);
        }
      }
    }

    // Check if anything changed to avoid unnecessary IPC traffic
    const serialized = JSON.stringify([...byMonitor.entries()]);
    if (serialized === this._prevSerialized) return;
    this._prevSerialized = serialized;

    this.emit('windows-updated', byMonitor);
  }

  /**
   * Determine which display a window rect primarily belongs to.
   * Returns monitorId (string) or null.
   */
  _findMonitorForRect(left, top, right, bottom) {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;

    let best = null;
    let bestArea = -1;

    for (const d of this._displays) {
      const { x, y, width, height } = d.bounds;
      // Check center point first
      if (cx >= x && cx < x + width && cy >= y && cy < y + height) {
        return String(d.id);
      }
      // Fall back to intersection area
      const ix = Math.max(0, Math.min(right, x + width) - Math.max(left, x));
      const iy = Math.max(0, Math.min(bottom, y + height) - Math.max(top, y));
      const area = ix * iy;
      if (area > bestArea) {
        bestArea = area;
        best = String(d.id);
      }
    }
    return best;
  }

  _getPrimaryMonitorId() {
    const primary = this._displays.find(d => d.bounds.x === 0 && d.bounds.y === 0)
      || this._displays[0];
    return primary ? String(primary.id) : null;
  }

  /**
   * Fetch icon for a PID async via PowerShell and emit 'icon-ready'.
   * Uses spawn (not spawnSync) to avoid blocking the event loop.
   */
  _fetchIcon(pid) {
    const scriptPath = path.join(getScriptsDir(), 'get-icon.ps1');
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      String(pid)
    ], { windowsHide: true });

    let output = '';
    const timer = setTimeout(() => {
      ps.kill();
      this._iconCache.delete(pid); // allow retry
    }, 6000);

    ps.stdout.on('data', (chunk) => { output += chunk.toString(); });

    ps.on('close', (code) => {
      clearTimeout(timer);
      const iconBase64 = output.trim();
      if (iconBase64 && code === 0) {
        this._iconCache.set(pid, iconBase64);
        this.emit('icon-ready', { pid, iconBase64 });
      } else {
        this._iconCache.delete(pid); // allow retry on next poll
      }
    });

    ps.on('error', () => {
      clearTimeout(timer);
      this._iconCache.delete(pid);
    });
  }

  /**
   * Restore a window by its HWND.
   * @param {number} hwnd
   */
  restoreWindow(hwnd) {
    const scriptPath = path.join(getScriptsDir(), 'restore-window.ps1');
    spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      String(hwnd)
    ], { windowsHide: true });
  }

  /**
   * Get cached icon for a pid, or null.
   * @param {number} pid
   * @returns {string|null}
   */
  getCachedIcon(pid) {
    const v = this._iconCache.get(pid);
    return (v && v !== 'pending') ? v : null;
  }
}

module.exports = WindowTracker;
