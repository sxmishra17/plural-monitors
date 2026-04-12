'use strict';
/**
 * monitor-manager.js
 * Detects all connected displays and spawns one frameless taskbar BrowserWindow per display.
 * Listens for display changes (hot-plug) and updates taskbars accordingly.
 * Relays window updates from WindowTracker to the appropriate taskbar renderer via IPC.
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const store = require('./store');

const TASKBAR_FILE = path.join(__dirname, '..', 'renderer', 'taskbar', 'index.html');
const SETTINGS_FILE = path.join(__dirname, '..', 'renderer', 'settings', 'index.html');

class MonitorManager {
  constructor(windowTracker) {
    /** @type {Map<string, BrowserWindow>}  monitorId -> taskbar window */
    this._taskbars = new Map();

    /** @type {BrowserWindow | null} */
    this._settingsWindow = null;

    /** @type {WindowTracker} */
    this._tracker = windowTracker;

    /** @type {Electron.Display[]} */
    this._displays = [];
  }

  /**
   * Initialize all taskbars and start listening for screen/IPC events.
   */
  async init() {
    // Register IPC handlers
    ipcMain.handle('window:restore', (_evt, hwnd) => {
      this._tracker.restoreWindow(hwnd);
    });

    ipcMain.handle('settings:open', () => {
      this._openSettings();
    });

    ipcMain.handle('settings:get', () => {
      return store.store;
    });

    ipcMain.handle('settings:set', (_evt, key, value) => {
      store.set(key, value);
      this._broadcastSettings();
    });

    ipcMain.handle('monitor:info', (_evt, monitorId) => {
      const d = this._displays.find(d => String(d.id) === monitorId);
      return d ? { id: monitorId, bounds: d.bounds, workArea: d.workArea, label: d.label } : null;
    });

    // Always-available: returns ordered list of all monitors (used by taskbar for friendly label)
    ipcMain.handle('settings:monitors-info', () => {
      return this._displays.map(d => ({
        id: String(d.id),
        bounds: d.bounds,
        workArea: d.workArea,
        label: d.label,
        scaleFactor: d.scaleFactor
      }));
    });

    // Track windows updates from WindowTracker
    this._tracker.on('windows-updated', (byMonitor) => {
      this._dispatchWindowUpdates(byMonitor);
    });

    this._tracker.on('icon-ready', ({ pid, iconBase64 }) => {
      // Broadcast icon to all taskbars (they'll filter by what they need)
      for (const win of this._taskbars.values()) {
        if (!win.isDestroyed()) {
          win.webContents.send('icon:update', { pid, iconBase64 });
        }
      }
    });

    // Initial display setup
    this._refreshDisplays();

    // Hot-plug listeners
    screen.on('display-added', () => this._refreshDisplays());
    screen.on('display-removed', () => this._refreshDisplays());
    screen.on('display-metrics-changed', () => this._refreshDisplays());
  }

  /**
   * Re-read all displays and reconcile taskbar windows.
   */
  _refreshDisplays() {
    this._displays = screen.getAllDisplays();
    this._tracker.setDisplays(this._displays);

    const currentIds = new Set(this._displays.map(d => String(d.id)));
    const existingIds = new Set(this._taskbars.keys());

    // Close taskbars for removed monitors
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const win = this._taskbars.get(id);
        if (win && !win.isDestroyed()) win.destroy();
        this._taskbars.delete(id);
      }
    }

    // Create taskbars for new monitors; reposition existing ones
    for (const display of this._displays) {
      const id = String(display.id);
      if (!this._taskbars.has(id)) {
        this._createTaskbar(display);
      } else {
        this._repositionTaskbar(this._taskbars.get(id), display);
      }
    }
  }

  _getTaskbarHeight() {
    return store.get('taskbarHeight', 52);
  }

  /**
   * Create a frameless, always-on-top taskbar pinned to the bottom of a display.
   */
  _createTaskbar(display) {
    const height = this._getTaskbarHeight();
    const { x, y, width } = display.workArea;
    const workAreaBottom = display.workArea.y + display.workArea.height;

    const win = new BrowserWindow({
      x,
      y: workAreaBottom - height,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: true,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(false);

    win.loadFile(TASKBAR_FILE, {
      query: { monitorId: String(display.id) }
    });

    win.once('ready-to-show', () => {
      win.show();
      // Send initial settings
      win.webContents.send('settings:updated', store.store);
    });

    // Register our own HWND so window-tracker excludes it
    win.on('show', () => {
      try {
        const hwndBuf = win.getNativeWindowHandle();
        const hwnd = process.platform === 'win32'
          ? hwndBuf.readInt32LE(0)
          : hwndBuf.readBigInt64LE ? Number(hwndBuf.readBigInt64LE(0)) : 0;
        if (hwnd) this._tracker.addOwnHwnd(hwnd);
      } catch (e) {
        // Non-critical: tracker may pick up our window, but it will be filtered by title
      }
    });
    win.on('closed', () => {
      const id = String(display.id);
      this._taskbars.delete(id);
    });

    this._taskbars.set(String(display.id), win);
  }

  _repositionTaskbar(win, display) {
    if (win.isDestroyed()) return;
    const height = this._getTaskbarHeight();
    const { x, width } = display.workArea;
    const workAreaBottom = display.workArea.y + display.workArea.height;
    win.setBounds({ x, y: workAreaBottom - height, width, height });
  }

  /**
   * Dispatch minimized-window lists to each taskbar renderer.
   * @param {Map<string, object[]>} byMonitor
   */
  _dispatchWindowUpdates(byMonitor) {
    for (const [monitorId, windows] of byMonitor) {
      const win = this._taskbars.get(monitorId);
      if (win && !win.isDestroyed()) {
        // Attach cached icons
        const enriched = windows.map(w => ({
          ...w,
          iconBase64: this._tracker.getCachedIcon(w.Pid)
        }));
        win.webContents.send('taskbar:windows-update', {
          monitorId,
          windows: enriched
        });
      }
    }
  }

  _broadcastSettings() {
    const settings = store.store;
    for (const win of this._taskbars.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('settings:updated', settings);
      }
    }
    if (this._settingsWindow && !this._settingsWindow.isDestroyed()) {
      this._settingsWindow.webContents.send('settings:updated', settings);
    }
    // Reposition taskbars in case height changed
    for (const display of this._displays) {
      const id = String(display.id);
      const win = this._taskbars.get(id);
      if (win) this._repositionTaskbar(win, display);
    }
  }

  _openSettings() {
    if (this._settingsWindow && !this._settingsWindow.isDestroyed()) {
      this._settingsWindow.focus();
      return;
    }

    this._settingsWindow = new BrowserWindow({
      width: 700,
      height: 620,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: false,
      title: 'Plural Monitors — Settings',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    this._settingsWindow.loadFile(SETTINGS_FILE);
    this._settingsWindow.once('ready-to-show', () => {
      this._settingsWindow.show();
      this._settingsWindow.webContents.send('settings:updated', store.store);
    });

    this._settingsWindow.on('closed', () => {
      this._settingsWindow = null;
    });
  }

  destroy() {
    for (const win of this._taskbars.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this._taskbars.clear();
    if (this._settingsWindow && !this._settingsWindow.isDestroyed()) {
      this._settingsWindow.destroy();
    }
  }
}

module.exports = MonitorManager;
