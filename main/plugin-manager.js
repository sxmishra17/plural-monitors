'use strict';
/**
 * plugin-manager.js
 * Scaffold for a future plugin/extension system.
 * Plugins must reside in the plugins/ directory and export:
 *   { name, version, hooks: { onWindowListUpdate?, onTaskbarRender?, onSettingsLoad? } }
 *
 * v1: loads plugins silently and exposes hook infrastructure.
 * Future: plugin marketplace, sandboxed execution, UI for enabling/disabling.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getPluginsDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'plugins');
  }
  return path.join(__dirname, '..', 'plugins');
}

class PluginManager {
  constructor(ipcMain, store) {
    this._ipcMain = ipcMain;
    this._store = store;
    /** @type {Array<{name: string, version: string, hooks: object, module: object}>} */
    this._plugins = [];
  }

  loadAll() {
    const dir = getPluginsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        this._loadPlugin(path.join(dir, entry.name));
      } else if (entry.isDirectory()) {
        const indexPath = path.join(dir, entry.name, 'index.js');
        if (fs.existsSync(indexPath)) {
          this._loadPlugin(indexPath);
        }
      }
    }

    console.log(`[PluginManager] Loaded ${this._plugins.length} plugin(s).`);
  }

  _loadPlugin(filePath) {
    try {
      const mod = require(filePath);
      if (!mod.name || !mod.version || !mod.hooks) {
        console.warn('[PluginManager] skipping malformed plugin:', filePath);
        return;
      }
      this._plugins.push({ ...mod, module: mod });

      // Register any IPC channels the plugin declares
      if (mod.ipcHandlers) {
        for (const [channel, handler] of Object.entries(mod.ipcHandlers)) {
          if (channel.startsWith('plugin:')) {
            this._ipcMain.handle(channel, handler);
          }
        }
      }

      console.log(`[PluginManager] Loaded plugin: ${mod.name} v${mod.version}`);
    } catch (e) {
      console.error('[PluginManager] Failed to load plugin:', filePath, e.message);
    }
  }

  /**
   * Call a specific hook on all plugins that implement it.
   * @param {'onWindowListUpdate'|'onTaskbarRender'|'onSettingsLoad'} hookName
   * @param {any} payload
   */
  callHook(hookName, payload) {
    for (const plugin of this._plugins) {
      if (typeof plugin.hooks[hookName] === 'function') {
        try {
          plugin.hooks[hookName](payload);
        } catch (e) {
          console.error(`[PluginManager] Plugin ${plugin.name} hook ${hookName} error:`, e.message);
        }
      }
    }
  }

  getPluginList() {
    return this._plugins.map(p => ({ name: p.name, version: p.version }));
  }
}

module.exports = PluginManager;
