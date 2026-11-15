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

function makeSwatch(hex, name, attr = 'color') {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset[attr] = hex;
  b.style.background = hex;
  b.title = name;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', name);
  return b;
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

