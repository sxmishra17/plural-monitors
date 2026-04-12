/**
 * settings.js — Plural Monitors Settings Panel Renderer
 * Controls: sidebar navigation, all settings toggles/sliders,
 * monitors info display, live preview, and persisting values.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentSettings = {};

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.panel;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById('panel-' + targetId).classList.add('active');

    // Lazy-load monitors info when that tab is clicked
    if (targetId === 'monitors') loadMonitors();
  });
});

// ── Close button ──────────────────────────────────────────────────────────────
document.getElementById('close-btn').addEventListener('click', () => {
  window.pluralAPI.closeSettings();
});

// ── Load settings from main process ──────────────────────────────────────────
async function loadSettings() {
  currentSettings = await window.pluralAPI.getSettings() || {};
  applySettingsToUI(currentSettings);
}

function applySettingsToUI(s) {
  // Checkboxes
  document.querySelectorAll('input[data-key]').forEach(el => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') {
      el.checked = !!s[key];
    } else if (el.type === 'range' || el.type === 'number') {
      if (s[key] !== undefined) el.value = s[key];
    } else if (el.type === 'color') {
      if (s[key]) el.value = s[key];
    }
  });

  // Update slider display values
  updateSliderDisplay('taskbar-height', s.taskbarHeight, v => v + 'px');
  updateSliderDisplay('taskbar-opacity', s.taskbarOpacity, v => Math.round(v * 100) + '%');
  updateColorDisplay(s.accentColor);
  updatePreview(s);
}

function updateSliderDisplay(id, val, fmt) {
  if (val === undefined) return;
  const el = document.getElementById(id + '-val');
  if (el) el.textContent = fmt(val);
}

function updateColorDisplay(hex) {
  if (!hex) return;
  const el = document.getElementById('accent-color-val');
  if (el) el.textContent = hex;
  // Update CSS variable in settings panel itself
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-dim', hexToRgba(hex, 0.15));
  document.documentElement.style.setProperty('--accent-border', hexToRgba(hex, 0.4));
}

// ── Settings persistence ──────────────────────────────────────────────────────
document.querySelectorAll('input[data-key]').forEach(el => {
  const key = el.dataset.key;
  const eventType = el.type === 'range' || el.type === 'color' ? 'input' : 'change';

  el.addEventListener(eventType, () => {
    let value;
    if (el.type === 'checkbox') {
      value = el.checked;
    } else if (el.type === 'number') {
      value = parseInt(el.value, 10);
    } else if (el.type === 'range') {
      value = parseFloat(el.value);
    } else {
      value = el.value;
    }

    currentSettings[key] = value;
    window.pluralAPI.setSetting(key, value);

    // Update live displays
    if (key === 'taskbarHeight') updateSliderDisplay('taskbar-height', value, v => v + 'px');
    if (key === 'taskbarOpacity') updateSliderDisplay('taskbar-opacity', value, v => Math.round(v * 100) + '%');
    if (key === 'accentColor') updateColorDisplay(value);

    updatePreview(currentSettings);
  });
});

// ── Live preview ──────────────────────────────────────────────────────────────
function updatePreview(s) {
  const preview = document.getElementById('taskbar-preview');
  if (!preview) return;

  if (s.taskbarHeight) preview.style.height = s.taskbarHeight + 'px';
  if (s.taskbarOpacity !== undefined) {
    preview.style.background = `rgba(10, 10, 16, ${s.taskbarOpacity})`;
  }
  if (s.accentColor) {
    preview.querySelectorAll('.preview-brand svg, .preview-brand').forEach(el => {
      el.style.color = s.accentColor;
    });
    preview.querySelectorAll('.preview-icon').forEach(el => {
      el.style.color = s.accentColor;
    });
  }
}

// ── Settings updates from main ────────────────────────────────────────────────
window.pluralAPI.onSettingsUpdated((s) => {
  Object.assign(currentSettings, s);
  applySettingsToUI(currentSettings);
});

// ── Monitors panel ────────────────────────────────────────────────────────────
async function loadMonitors() {
  const list = document.getElementById('monitors-list');
  list.innerHTML = '<div class="loading-hint">Detecting monitors…</div>';

  try {
    const monitors = await window.pluralAPI.getAllMonitors();
    if (!monitors || monitors.length === 0) {
      list.innerHTML = '<div class="loading-hint">No monitors detected.</div>';
      return;
    }

    list.innerHTML = '';
    monitors.forEach((m, idx) => {
      const card = document.createElement('div');
      card.className = 'monitor-card';

      const w = m.bounds.width;
      const h = m.bounds.height;
      const isPrimary = m.bounds.x === 0 && m.bounds.y === 0;

      card.innerHTML = `
        <div class="monitor-diagram">
          <div class="monitor-bar"></div>
        </div>
        <div class="monitor-details">
          <div class="monitor-name">Monitor ${idx + 1}</div>
          <div class="monitor-meta">${w} × ${h} px &nbsp;·&nbsp; Scale ${m.scaleFactor}x</div>
          <div class="monitor-meta">Position: (${m.bounds.x}, ${m.bounds.y})</div>
        </div>
        ${isPrimary ? '<span class="monitor-badge">Primary</span>' : ''}
      `;
      list.appendChild(card);
    });
  } catch (e) {
    list.innerHTML = `<div class="loading-hint">Error: ${e.message}</div>`;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
