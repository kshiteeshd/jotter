// ---------- Tools, size, colour ----------

function setTool(tool) {
  if (tool !== 'select') clearSelection();
  state.tool = tool;
  document.body.dataset.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.setAttribute('aria-checked', String(b.dataset.tool === tool));
  });
  el.ring.style.display = 'none';
  if (tool === 'text') {
    if (state.view === 'editor') el.editor.focus();
  } else {
    el.editor.blur();
    window.getSelection().removeAllRanges();
    if (state.tools[tool].size) el.size.value = state.tools[tool].size;
  }
  syncToolUi();
}

const SIZE_CONFIG = {
  pen: { min: 0.5, max: 16, step: 0.5, presets: [1, 1.5, 2, 3, 4, 6, 8, 12] },
  marker: { min: 4, max: 40, step: 1, presets: [6, 10, 14, 18, 24, 32] },
  eraser: { min: 4, max: 80, step: 1, presets: [8, 16, 24, 32, 48, 64] },
  shape: { min: 0.5, max: 12, step: 0.5, presets: [1, 2, 3, 4, 6, 8] },
};
const formatSize = (n) => (Math.round(n * 10) / 10).toString();
let presetsTool = '';

function renderSizePresets(tool) {
  const cfg = SIZE_CONFIG[tool];
  const box = $('size-presets');
  if (!cfg || !box) return;
  if (presetsTool !== tool) {
    box.textContent = '';
    for (const v of cfg.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.value = String(v);
      b.title = `${formatSize(v)} px`;
      b.setAttribute('aria-label', `${formatSize(v)} px`);
      const i = document.createElement('i');
      const d = Math.max(4, Math.min(18, Math.round(v * 0.9)));
      i.style.width = i.style.height = `${d}px`;
      b.append(i);
      box.append(b);
    }
    presetsTool = tool;
  }
  const cur = state.tools[tool].size;
  box.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.value) - cur) < 0.01)));
}

function syncToolUi() {
  const t = state.tools[state.tool];
  const cfg = SIZE_CONFIG[state.tool];
  if (t.size && cfg) {
    if (el.size.min !== String(cfg.min)) {
      el.size.min = cfg.min;
      el.size.max = cfg.max;
      el.size.step = cfg.step;
    }
    el.size.value = t.size;
    el.sizeValue.textContent = formatSize(t.size);
    const d = Math.min(26, Math.max(2, t.size));
    el.sizeDot.style.width = el.sizeDot.style.height = `${d}px`;
    el.sizeDot.style.background = state.tool === 'eraser' ? '' : t.color;
    el.sizeDot.style.opacity = state.tool === 'marker' ? 0.6 : 1;
    renderSizePresets(state.tool);
  }
  if (t.color) {
    el.swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s.dataset.color === t.color)));
    el.customColor.value = t.color;
  }
  setSeg('shape-kind', state.tools.shape.kind);
}

function setSize(size) {
  const t = state.tools[state.tool];
  const cfg = SIZE_CONFIG[state.tool];
  if (!t || !cfg) return;
  const step = cfg.step || 1;
  const snapped = Math.round(Number(size) / step) * step;
  t.size = Math.min(cfg.max, Math.max(cfg.min, Math.round(snapped * 100) / 100));
  if (el.size) el.size.value = t.size;
  syncToolUi();
}

function setColor(color) {
  const t = state.tools[state.tool];
  if (!t || !('color' in t)) return;
  t.color = color;
  if (state.tool === 'text') format('foreColor', color);
  syncToolUi();
}


for (const [hex, name] of Model.INKS) {
  el.swatches.append(makeSwatch(hex, name));
  $('sel-swatches').append(makeSwatch(hex, name));
}
el.swatches.addEventListener('click', (e) => {
  if (e.target.dataset.color) setColor(e.target.dataset.color);
});
$('sel-swatches').addEventListener('click', (e) => {
  if (e.target.dataset.color) recolorSelection(e.target.dataset.color);
});
el.customColor.addEventListener('input', () => setColor(el.customColor.value));
el.size.addEventListener('input', () => setSize(Number(el.size.value)));
$('size-presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-value]');
  if (b) setSize(Number(b.dataset.value));
});
bindSeg('eraser-mode', (mode) => applySettings({ eraserMode: mode }));
bindSeg('shape-kind', (kind) => {
  state.tools.shape.kind = kind;
  syncToolUi();
});

// The chosen tool's options are shown beside the tools in the bar.
function onToolClick(tool) {
  setTool(tool);
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => onToolClick(b.dataset.tool)));


// The options column of the tool rail can be folded away, leaving just the tools; the page then sits in
// the middle of the window. Remembered on this computer.
function setRailCollapsed(on) {
  document.body.classList.toggle('rail-collapsed', on);
  const b = $('btn-rail');
  const label = on ? 'Show tool options' : 'Hide tool options';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-expanded', String(!on));
  try {
    localStorage.setItem('railCollapsed', on ? '1' : '');
  } catch {}
  onViewportChange();
}
try {
  if (localStorage.getItem('railCollapsed')) setRailCollapsed(true);
} catch {}

// ---------- Docking the tool bar ----------

const DOCK_SIDES = ['right', 'left', 'top', 'bottom'];

function setDockSide(side) {
  if (!DOCK_SIDES.includes(side)) side = 'right';
  document.body.dataset.dock = side;
  setSeg('set-dock', side);
  try {
    localStorage.setItem('dockSide', side);
  } catch {}
  onViewportChange();
}
try {
  setDockSide(localStorage.getItem('dockSide') || 'right');
} catch {
  setDockSide('right');
}
bindSeg('set-dock', setDockSide);

// The edge of the page area nearest to a point (measured relative to the area's size).
function nearestSide(x, y) {
  const r = document.getElementById('page-area').getBoundingClientRect();
  const d = { left: (x - r.left) / r.width, right: (r.right - x) / r.width, top: (y - r.top) / r.height, bottom: (r.bottom - y) / r.height };
  return DOCK_SIDES.reduce((a, b) => (d[b] < d[a] ? b : a));
}

// Drag the grip anywhere; on release the bar docks to the nearest edge, which lights up meanwhile.
(() => {
  const grip = $('btn-dock-grip');
  const ghost = $('dock-ghost');
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {}
    document.body.classList.add('dock-dragging');
    ghost.dataset.side = document.body.dataset.dock;
  });
  grip.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) ghost.dataset.side = nearestSide(e.clientX, e.clientY);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    document.body.classList.remove('dock-dragging');
    const side = ghost.dataset.side;
    delete ghost.dataset.side;
    if (side && side !== document.body.dataset.dock) setDockSide(side);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  // From the keyboard: arrow keys move the bar to that edge.
  grip.addEventListener('keydown', (e) => {
    const side = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }[e.key];
    if (!side) return;
    e.preventDefault();
    setDockSide(side);
  });
})();
