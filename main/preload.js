'use strict';
/**
 * preload.js
 * Secure bridge between renderer (taskbar / settings) and the main process.
 * Exposes only the specific IPC calls the renderer needs via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluralAPI', {
  // ── Window management ─────────────────────────────────────────────────────
  restoreWindow: (hwnd) => ipcRenderer.invoke('window:restore', hwnd),

  // ── Settings panel ────────────────────────────────────────────────────────
  openSettings: () => ipcRenderer.invoke('settings:open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // ── Monitor info ──────────────────────────────────────────────────────────
  getMonitorInfo: (monitorId) => ipcRenderer.invoke('monitor:info', monitorId),
  getAllMonitors: () => ipcRenderer.invoke('settings:monitors-info'),

  // ── Listeners (renderer subscribes to main events) ────────────────────────
  // Each channel is registered only once — calling these helpers multiple times
  // won't stack duplicate listeners (prevents memory leaks on hot-reload).
  onWindowsUpdate: (cb) => {
    ipcRenderer.removeAllListeners('taskbar:windows-update');
    ipcRenderer.on('taskbar:windows-update', (_e, data) => cb(data));
  },
  onIconUpdate: (cb) => {
    ipcRenderer.removeAllListeners('icon:update');
    ipcRenderer.on('icon:update', (_e, data) => cb(data));
  },
  onSettingsUpdated: (cb) => {
    ipcRenderer.removeAllListeners('settings:updated');
    ipcRenderer.on('settings:updated', (_e, data) => cb(data));
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  closeSettings: () => ipcRenderer.send('settings:close'),

  // ── Plugin hook (future) ──────────────────────────────────────────────────
  // Plugins will communicate via named channels; scaffolded here for extensibility
  pluginSend: (channel, data) => {
    if (channel.startsWith('plugin:')) {
      ipcRenderer.send(channel, data);
    }
  },
  pluginOn: (channel, cb) => {
    if (channel.startsWith('plugin:')) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  }
});
