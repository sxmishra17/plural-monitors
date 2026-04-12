'use strict';
/**
 * main/index.js
 * Application entry point.
 * - Enforces single-instance
 * - Waits for 'ready', then initialises MonitorManager + WindowTracker
 * - Handles auto-launch settings
 * - Sets up plugin manager scaffold
 */

const { app, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// Single-instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const store = require('./store');
const WindowTracker = require('./window-tracker');
const MonitorManager = require('./monitor-manager');
const PluginManager = require('./plugin-manager');

let monitorManager = null;
let windowTracker = null;
let pluginManager = null;
let tray = null;

// Prevent Electron from showing in the native Windows taskbar as a management app item
app.setAppUserModelId('com.satish.plural-monitors');

// Disable hardware acceleration warnings on some systems
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

app.on('ready', async () => {
  // --- Auto-launch integration ---
  const autoLaunch = store.get('autoLaunchOnStartup', false);
  app.setLoginItemSettings({
    openAtLogin: autoLaunch,
    name: 'Plural Monitors'
  });

  // Sync auto-launch when setting changes — monitor-manager registers the full handler,
  // so we subscribe to store changes here via electron-store's built-in onDidChange
  store.onDidChange('autoLaunchOnStartup', (newVal) => {
    app.setLoginItemSettings({ openAtLogin: !!newVal, name: 'Plural Monitors' });
  });

  // --- Core subsystems ---
  windowTracker = new WindowTracker();
  monitorManager = new MonitorManager(windowTracker);
  pluginManager = new PluginManager(ipcMain, store);

  await monitorManager.init();

  windowTracker.start();
  pluginManager.loadAll();

  // Broadcast settings close from settings panel
  ipcMain.on('settings:close', (evt) => {
    const win = require('electron').BrowserWindow.fromWebContents(evt.sender);
    if (win) win.close();
  });

  // --- System tray icon ---
  _setupTray();
});

// Quit gracefully
app.on('before-quit', () => {
  if (windowTracker) windowTracker.stop();
  if (monitorManager) monitorManager.destroy();
  if (tray && !tray.isDestroyed()) tray.destroy();
});

// Prevent app quit when all windows are closed (taskbars are always open)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// Bring settings to front on second instance
app.on('second-instance', () => {
  if (monitorManager) monitorManager._openSettings();
});

// ── Tray setup ────────────────────────────────────────────────────────────────
function _setupTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    // Resize to standard tray size if needed
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    // Fallback: create a tiny solid-color icon programmatically
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Plural Monitors');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: 'Plural Monitors',
      enabled: false,
      icon: icon.isEmpty() ? undefined : icon.resize({ width: 16, height: 16 })
    },
    { type: 'separator' },
    {
      label: '⚙  Settings',
      click: () => monitorManager && monitorManager._openSettings()
    },
    { type: 'separator' },
    {
      label: '✕  Quit Plural Monitors',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(buildMenu());

  // Left-click also opens settings (Windows tray convention)
  tray.on('click', () => {
    monitorManager && monitorManager._openSettings();
  });
}
