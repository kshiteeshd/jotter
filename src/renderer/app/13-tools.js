// ---------- Tools, size, colour ----------

function setTool(tool) {
  if (tool !== 'select') clearSelection();
  state.tool = tool;
  document.body.dataset.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.setAttribute('aria-checked', String(b.dataset.tool === tool));
  });
  hideRing();
  if (tool === 'text') {
    if (state.view === 'editor') el.editor.focus();
  } else {
    el.editor.blur();
    window.getSelection().removeAllRanges();
  }
  syncToolUi();
}

/*
  Each tool's colour and size, the shape you drew last and the tool in hand are remembered, so Jotter
  opens with the pen as you left it.
*/
let toolsTimer = 0;
function saveToolsSoon() {
  clearTimeout(toolsTimer);
  toolsTimer = setTimeout(() => {
    const tools = { tool: state.tool };
    for (const k of ['text', 'pen', 'marker', 'eraser', 'shape']) tools[k] = { ...state.tools[k] };
    state.settings.tools = tools;
    api.setSettings({ tools });
  }, 800);
}
function restoreTools(saved) {
  if (!saved || typeof saved !== 'object') return 'text';
  const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  for (const k of ['text', 'pen', 'marker', 'eraser', 'shape']) {
    const from = saved[k];
    const t = state.tools[k];
    if (!from || typeof from !== 'object') continue;
    if ('color' in t && hex(from.color)) t.color = from.color.toLowerCase();
    const cfg = SIZE_CONFIG[k];
    if (cfg && Number(from.size) > 0) t.size = cfg.steps[stepIndex(cfg, Number(from.size))];
    if (k === 'shape' && ['line', 'arrow', 'rect', 'ellipse'].includes(from.kind)) t.kind = from.kind;
  }
  return ['text', 'pen', 'marker', 'eraser', 'shape', 'select'].includes(saved.tool) ? saved.tool : 'text';
}

/*
  Sizes go up in even steps of thickness, not of number: each step is about 12% thicker than the one before,
  so every step looks like the same change whether the line is thin or thick. The steps are the standard
  "preferred numbers" (Renard R20): 1, 1.12, 1.25, 1.4, 1.6, 1.8, 2, 2.24, 2.5 … The − and + buttons, the
  [ and ] keys and the five ready sizes all move along them.
*/
const R20 = [1, 1.12, 1.25, 1.4, 1.6, 1.8, 2, 2.24, 2.5, 2.8, 3.15, 3.55, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9];
function gradual(min, max) {
  const out = [];
  for (let decade = 0.1; decade <= max; decade *= 10) {
    for (const r of R20) {
      const v = Math.round(r * decade * 1000) / 1000;
      if (v >= min - 1e-9 && v <= max + 1e-9) out.push(v);
    }
  }
  return out;
}
// Five ready sizes per tool, each about twice the one before, all on the steps.
function sizeConfig(min, max, presets) {
  return { min, max, steps: gradual(min, max), presets };
}
const SIZE_CONFIG = {
  pen: sizeConfig(0.4, 16, [0.5, 1, 2, 4, 8]),
  marker: sizeConfig(4, 40, [5, 8, 12.5, 20, 31.5]),
  eraser: sizeConfig(4, 80, [8, 14, 25, 45, 80]),
  shape: sizeConfig(0.4, 12.5, [0.5, 1, 2, 4, 8]),
};
const formatSize = (n) => (Math.round(n * 100) / 100).toString();
// The step nearest to a size (nearest in thickness, so 0.5 is nearer 0.45 than 0.6).
function stepIndex(cfg, size) {
  let best = 0;
  cfg.steps.forEach((v, i) => Math.abs(Math.log(v / size)) < Math.abs(Math.log(cfg.steps[best] / size)) && (best = i));
  return best;
}
// How big to draw a size in the bar: evenly growing dots, from `small` to `large` pixels.
const dotFor = (cfg, v, small, large) => Math.round(small + ((large - small) * Math.log(v / cfg.min)) / Math.log(cfg.max / cfg.min));
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
      const d = dotFor(cfg, v, 3, 16);
      i.style.width = i.style.height = `${d}px`;
      b.append(i);
      box.append(b);
    }
    presetsTool = tool;
  }
  const cur = state.tools[tool].size;
  box.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.value) - cur) < 0.001)));
}

function syncToolUi() {
  const t = state.tools[state.tool];
  const cfg = SIZE_CONFIG[state.tool];
  if (t.size && cfg) {
    const i = stepIndex(cfg, t.size);
    $('size-down').disabled = i === 0;
    $('size-up').disabled = i === cfg.steps.length - 1;
    el.sizeValue.textContent = formatSize(t.size);
    const d = dotFor(cfg, t.size, 2, 26);
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
  saveToolsSoon();
}

// Set the size to the step nearest `size`.
function setSize(size) {
  const t = state.tools[state.tool];
  const cfg = SIZE_CONFIG[state.tool];
  if (!t || !cfg || !(size > 0)) return;
  t.size = cfg.steps[stepIndex(cfg, size)];
  syncToolUi();
}

// One step thicker (+1) or thinner (-1): the [ and ] keys.
function stepSize(dir) {
  const cfg = SIZE_CONFIG[state.tool];
  if (!cfg) return;
  const i = Math.min(cfg.steps.length - 1, Math.max(0, stepIndex(cfg, state.tools[state.tool].size) + dir));
  setSize(cfg.steps[i]);
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
$('size-down').addEventListener('click', () => stepSize(-1));
$('size-up').addEventListener('click', () => stepSize(1));
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

// ---------- The tool bar hides when not in use ----------

/*
  With "hide when not in use" on (the pin off), the tool bar slides off its edge a moment after the
  pointer leaves it, or as soon as you start writing, leaving a small tab at that edge. Pointing at the
  edge, or at the tab, brings it back. It stays while you are using it: the pointer over it, the keyboard
  in it, or dragging it to another edge. The page does not keep room for it meanwhile, so nothing moves
  as it comes and goes.
*/
const dockBar = $('dock');
let dockTimer = 0;
let slideTimer = 0;
const dockHides = () => !!state.settings.dockAutoHide;

function setDockHidden(hidden) {
  clearTimeout(dockTimer);
  dockTimer = 0;
  if (document.body.classList.contains('dock-hidden') === hidden) return;
  clearTimeout(slideTimer);
  document.body.classList.add('dock-sliding');
  slideTimer = setTimeout(() => document.body.classList.remove('dock-sliding'), 320);
  document.body.classList.toggle('dock-hidden', hidden);
}
function dockInUse() {
  const keyboard = document.body.classList.contains('kbd') && dockBar.contains(document.activeElement); // not a button just clicked
  return dockBar.matches(':hover') || keyboard || document.body.classList.contains('dock-dragging');
}
function hideDockSoon(ms = 900) {
  if (!dockHides() || dockTimer || document.body.classList.contains('dock-hidden')) return;
  dockTimer = setTimeout(() => {
    dockTimer = 0;
    if (dockHides() && state.view === 'editor' && !dockInUse()) setDockHidden(true);
  }, ms);
}
function syncDockHiding() {
  const on = dockHides();
  document.body.classList.toggle('dock-autohide', on);
  $('btn-dock-pin').setAttribute('aria-pressed', String(!on));
  $('set-dockhide').checked = on;
  if (!on) setDockHidden(false);
  else hideDockSoon(1500);
  onViewportChange();
}

// Is the point at the edge the bar is docked to (within the page area)?
let areaRect = null; // measured again when the page area changes size
new ResizeObserver(() => (areaRect = null)).observe($('page-area'));
function atDockEdge(x, y) {
  const a = areaRect || (areaRect = $('page-area').getBoundingClientRect());
  const zone = 24;
  if (x < a.left || x > a.right || y < a.top || y > a.bottom) return false;
  const side = document.body.dataset.dock;
  if (side === 'right') return x >= a.right - zone;
  if (side === 'left') return x <= a.left + zone;
  if (side === 'top') return y <= a.top + zone;
  return y >= a.bottom - zone;
}

// Where the pointer is, looked at once a frame (a pen reports far more often), never mid-stroke.
let dockPointer = null;
function checkDockPointer() {
  const { x, y } = dockPointer;
  dockPointer = null;
  if (!dockHides() || state.view !== 'editor' || current || pan) return;
  if (document.body.classList.contains('dock-hidden')) {
    if (atDockEdge(x, y)) setDockHidden(false);
    return;
  }
  const r = dockBar.getBoundingClientRect();
  const near = x > r.left - 32 && x < r.right + 32 && y > r.top - 32 && y < r.bottom + 32;
  if (near) {
    clearTimeout(dockTimer);
    dockTimer = 0;
  } else hideDockSoon();
}
document.addEventListener(
  'pointermove',
  (e) => {
    if (!dockHides() || state.view !== 'editor' || current || pan) return;
    if (!dockPointer) requestAnimationFrame(checkDockPointer);
    dockPointer = { x: e.clientX, y: e.clientY };
  },
  { passive: true }
);
// Starting to write puts it away at once.
el.inkLayer.addEventListener('pointerdown', () => dockHides() && !dockInUse() && setDockHidden(true), true);
$('dock-peek').addEventListener('click', () => setDockHidden(false));
$('dock-peek').addEventListener('pointerenter', () => setDockHidden(false));
$('btn-dock-pin').addEventListener('click', () => applySettings({ dockAutoHide: !dockHides() }));
dockBar.addEventListener('focusin', () => document.body.classList.contains('kbd') && setDockHidden(false));
