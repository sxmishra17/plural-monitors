# Plural Monitors — Plugin Directory

Place your plugins here. Each plugin can be:
- A single `.js` file, OR
- A folder with an `index.js` entry point

## Plugin API

Each plugin must export the following shape:

```js
module.exports = {
  name: 'my-plugin-name',    // string, unique
  version: '1.0.0',          // semver string
  hooks: {
    // Called every time the minimized window list is refreshed
    onWindowListUpdate({ byMonitor }) { },

    // Called when a taskbar renderer loads
    onTaskbarRender({ monitorId }) { },

    // Called when settings are loaded or changed
    onSettingsLoad(settings) { }
  },

  // Optional: register IPC handlers that renderers can call
  // Channel names MUST start with "plugin:"
  ipcHandlers: {
    'plugin:my-plugin-action': async (event, data) => {
      return { result: 'ok' };
    }
  }
};
```

## Example: Clock Widget Plugin (future)

```js
// plugins/clock-widget/index.js
module.exports = {
  name: 'clock-widget',
  version: '1.0.0',
  hooks: {
    onTaskbarRender({ monitorId }) {
      console.log(`Clock widget ready on monitor ${monitorId}`);
    }
  }
};
```
