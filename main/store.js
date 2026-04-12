'use strict';

const Store = require('electron-store');

const schema = {
  taskbarHeight: {
    type: 'number',
    default: 52
  },
  taskbarOpacity: {
    type: 'number',
    default: 0.9,
    minimum: 0.3,
    maximum: 1.0
  },
  pollingIntervalMs: {
    type: 'number',
    default: 1000,
    minimum: 500,
    maximum: 5000
  },
  autoLaunchOnStartup: {
    type: 'boolean',
    default: false
  },
  showMonitorLabel: {
    type: 'boolean',
    default: true
  },
  accentColor: {
    type: 'string',
    default: '#6366f1'
  },
  // Plugin registry — future use
  plugins: {
    type: 'array',
    default: []
  }
};

const store = new Store({ schema });

module.exports = store;
