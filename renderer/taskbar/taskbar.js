/**
 * taskbar.js — Plural Monitors Taskbar Renderer
 *
 * Responsibilities:
 *  - Reads monitorId from URL query params
 *  - Subscribes to IPC events from main process
 *  - Renders minimized window buttons with icons
 *  - Handles click → restore, hover → tooltip
 *  - Applies settings (accent color, height, label visibility)
 */

'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const MONITOR_ID = params.get('monitorId') || '0';

const windowList = document.getElementById('window-list');
const emptyState = document.getElementById('empty-state');
const monitorLabel = document.getElementById('monitor-label');
const settingsBtn = document.getElementById('settings-btn');
const tooltip = document.getElementById('tooltip');

// Current state
/** @type {Map<number, {handle, title, pid, iconBase64}>} */
let currentWindows = new Map();

/** @type {Map<number, string>}  pid → icon base64 */
const iconCache = new Map();

let tooltipTimerId = null;

// ── Monitor label ─────────────────────────────────────────────────────────────

(async () => {
  try {
    // Get all monitors ordered left→right, top→bottom, primary first
    const all = await window.pluralAPI.getAllMonitors();
    if (all && all.length > 0) {
      // Sort: primary (0,0) first, then by x position, then y
      const sorted = [...all].sort((a, b) => {
        const aPrimary = a.bounds.x === 0 && a.bounds.y === 0 ? 0 : 1;
        const bPrimary = b.bounds.x === 0 && b.bounds.y === 0 ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
        return a.bounds.y - b.bounds.y;
      });
      const idx = sorted.findIndex(d => d.id === MONITOR_ID);
      monitorLabel.textContent = `Monitor ${idx >= 0 ? idx + 1 : '?'}`;
    } else {
      monitorLabel.textContent = 'Monitor';
    }
  } catch {
    monitorLabel.textContent = 'Monitor';
  }
})();

// ── Settings ─────────────────────────────────────────────────────────────────

window.pluralAPI.onSettingsUpdated((settings) => {
  applySettings(settings);
});

function applySettings(s) {
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent', s.accentColor);
    document.documentElement.style.setProperty('--accent-dim', hexToRgba(s.accentColor, 0.15));
    document.documentElement.style.setProperty('--accent-glow', hexToRgba(s.accentColor, 0.35));
  }
  if (s.taskbarHeight) {
    document.documentElement.style.setProperty('--taskbar-h', s.taskbarHeight + 'px');
    document.documentElement.style.height = s.taskbarHeight + 'px';
    document.body.style.height = s.taskbarHeight + 'px';
  }
  if (s.taskbarOpacity !== undefined) {
    // Apply opacity to the taskbar background CSS variable
    const opacity = Math.min(1, Math.max(0, s.taskbarOpacity));
    document.documentElement.style.setProperty(
      '--bg', `rgba(10, 10, 16, ${opacity})`
    );
  }
  if (typeof s.showMonitorLabel === 'boolean') {
    document.getElementById('brand-section').style.display =
      s.showMonitorLabel ? 'flex' : 'none';
  }
}

// ── Window updates ────────────────────────────────────────────────────────────

window.pluralAPI.onWindowsUpdate(({ monitorId, windows }) => {
  if (monitorId !== MONITOR_ID) return;
  updateWindowButtons(windows);
});

// ── Icon updates ─────────────────────────────────────────────────────────────

window.pluralAPI.onIconUpdate(({ pid, iconBase64 }) => {
  iconCache.set(pid, iconBase64);
  // Update any existing button for this pid
  const btn = document.querySelector(`.win-btn[data-pid="${pid}"]`);
  if (btn) {
    const img = btn.querySelector('.app-icon');
    const placeholder = btn.querySelector('.app-icon-placeholder');
    if (img) {
      img.src = 'data:image/png;base64,' + iconBase64;
    } else if (placeholder) {
      // Replace placeholder with real icon
      const newImg = document.createElement('img');
      newImg.className = 'app-icon';
      newImg.src = 'data:image/png;base64,' + iconBase64;
      newImg.alt = '';
      placeholder.replaceWith(newImg);
    }
  }
});

// ── Settings button ───────────────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  window.pluralAPI.openSettings();
});

// ── Render logic ──────────────────────────────────────────────────────────────

function updateWindowButtons(windows) {
  const incoming = new Map(windows.map(w => [w.Handle, w]));

  // Find removed windows → animate out
  for (const [hwnd, _] of currentWindows) {
    if (!incoming.has(hwnd)) {
      const btn = document.querySelector(`.win-btn[data-hwnd="${hwnd}"]`);
      if (btn) {
        btn.classList.add('leaving');
        btn.addEventListener('animationend', () => btn.remove(), { once: true });
      }
    }
  }

  // Add / update icons for new windows
  for (const [hwnd, w] of incoming) {
    if (!currentWindows.has(hwnd)) {
      // New window → create button
      const btn = createWindowButton(w);
      windowList.insertBefore(btn, emptyState);
      // Trigger entrance animation next frame
      requestAnimationFrame(() => btn.classList.add('entering'));
    } else {
      // Existing: update title if changed
      const btn = document.querySelector(`.win-btn[data-hwnd="${hwnd}"]`);
      if (btn) {
        const titleEl = btn.querySelector('.win-title');
        if (titleEl && titleEl.textContent !== w.Title) {
          titleEl.textContent = truncate(w.Title, 22);
          btn.title = w.Title;
        }
        // Update icon if now available
        if (w.iconBase64 && !iconCache.has(w.Pid)) {
          iconCache.set(w.Pid, w.iconBase64);
          const placeholder = btn.querySelector('.app-icon-placeholder');
          if (placeholder) {
            const img = makeIcon(w.iconBase64, w.Title);
            placeholder.replaceWith(img);
          }
        }
      }
    }
  }

  currentWindows = incoming;

  // Show/hide empty state
  const hasWindows = incoming.size > 0;
  emptyState.style.display = hasWindows ? 'none' : 'flex';
}

function createWindowButton(w) {
  const btn = document.createElement('button');
  btn.className = 'win-btn';
  btn.dataset.hwnd = w.Handle;
  btn.dataset.pid = w.Pid;
  btn.setAttribute('role', 'listitem');
  btn.setAttribute('aria-label', `Restore ${w.Title}`);

  // Icon
  const iconSource = w.iconBase64 || iconCache.get(w.Pid);
  const iconEl = iconSource
    ? makeIcon(iconSource, w.Title)
    : makePlaceholderIcon(w.Title);
  btn.appendChild(iconEl);

  // Title
  const titleEl = document.createElement('span');
  titleEl.className = 'win-title';
  titleEl.textContent = truncate(w.Title, 22);
  btn.appendChild(titleEl);

  // Click → restore
  btn.addEventListener('click', () => {
    window.pluralAPI.restoreWindow(w.Handle);
  });

  // Tooltip
  btn.addEventListener('mouseenter', (e) => showTooltip(w.Title, e));
  btn.addEventListener('mouseleave', hideTooltip);

  return btn;
}

function makeIcon(base64, alt) {
  const img = document.createElement('img');
  img.className = 'app-icon';
  img.src = 'data:image/png;base64,' + base64;
  img.alt = alt || '';
  img.onerror = () => {
    img.replaceWith(makePlaceholderIcon(alt));
  };
  return img;
}

function makePlaceholderIcon(title) {
  const div = document.createElement('div');
  div.className = 'app-icon-placeholder';
  div.setAttribute('aria-hidden', 'true');
  // First letter of app name
  const letter = (title || '?').trim()[0].toUpperCase();
  div.textContent = letter;
  div.style.fontSize = '11px';
  div.style.fontWeight = '700';
  return div;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showTooltip(text, event) {
  clearTimeout(tooltipTimerId);
  tooltip.textContent = text;
  // Position above the button
  const rect = event.currentTarget.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 260);
  tooltip.style.left = Math.max(4, left) + 'px';
  tooltipTimerId = setTimeout(() => {
    tooltip.classList.add('visible');
  }, 300);
}

function hideTooltip() {
  clearTimeout(tooltipTimerId);
  tooltip.classList.remove('visible');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Initial settings load ─────────────────────────────────────────────────────

(async () => {
  const s = await window.pluralAPI.getSettings();
  if (s) applySettings(s);
})();
