// ---------- View: zoom, settings, focus, full screen ----------

// Zoom, keeping the point under (cx, cy) where it is: the pointer when given, else the middle of the view.
function setZoom(z, cx, cy) {
  z = Math.min(2, Math.max(0.5, z));
  const before = state.view === 'editor' ? sheetScale() : null;
  if (before && cx === undefined) {
    const ws = el.workspace.getBoundingClientRect();
    cx = ws.left + ws.width / 2;
    cy = ws.top + ws.height / 2;
  }
  const sx = before ? (cx - before.rect.left) * before.k : 0;
  const sy = before ? (cy - before.rect.top) * before.k : 0;
  state.zoom = z;
  el.sheetWrap.style.zoom = z;
  el.zoomValue.textContent = `${Math.round(z * 100)}%`;
  const after = before && sheetScale();
  if (after) {
    el.workspace.scrollLeft += after.rect.left + sx / after.k - cx;
    el.workspace.scrollTop += after.rect.top + sy / after.k - cy;
  }
  onViewportChange();
}
/*
  Until you zoom yourself, the page is sized to fit the window: actual size when there is room, smaller
  (down to 50%) in a narrow window so it stays clear of the sidebar and the tool bar. Ctrl+0 returns to this.
*/
function fitZoom() {
  const room = parseFloat(getComputedStyle(document.body).getPropertyValue('--rail-room')) || 0;
  // Room for the bar on its own side, a small margin on the other.
  const side = ['left', 'right'].includes(document.body.dataset.dock);
  const avail = el.workspace.clientWidth - (side ? room + 16 : 2 * Math.max(room, 16));
  return Math.min(1, Math.max(0.5, Math.floor((avail / W) * 100) / 100));
}
function autoZoom() {
  if (state.userZoomed || state.view !== 'editor') return;
  const z = fitZoom();
  if (Math.abs(z - state.zoom) > 0.005) setZoom(z);
}

function stepZoom(dir) {
  state.userZoomed = true;
  const next = dir > 0 ? ZOOMS.find((z) => z > state.zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < state.zoom - 0.001);
  if (next) setZoom(next);
}
el.workspace.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    state.userZoomed = true;
    // Ctrl+wheel and touchpad pinch: glide in or out around the pointer.
    setZoom(state.zoom * Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0022), e.clientX, e.clientY);
  },
  { passive: false }
);

function syncSettingsUi() {
  const s = state.settings;
  setSeg('theme', s.theme);
  setSeg('ui-scale', s.uiScale);
  setSeg('eraser-mode', s.eraserMode);
  setSeg('set-mode', s.defaultMode);
  $('set-cover').value = s.defaultCover;
  $('set-paper').value = s.defaultPaper;
  $('set-penonly').checked = s.penOnly;
  $('set-history').value = String([10, 30, 100].reduce((a, b) => (Math.abs(b - s.historyLimit) < Math.abs(a - s.historyLimit) ? b : a)));
  document.body.classList.toggle('no-sidebar', !s.sidebar);
  document.body.classList.toggle('pen-only', s.penOnly);
  $('btn-sidebar').setAttribute('aria-pressed', String(!!s.sidebar));
  syncDockHiding();
}

async function applySettings(patch) {
  Object.assign(state.settings, patch);
  syncSettingsUi();
  state.settings = await api.setSettings(patch);
  syncSettingsUi();
  onViewportChange();
  // Theme changes reach the page's colour scheme a moment later.
  setTimeout(applyCoverTheme, 50);
}

bindSeg('theme', (theme) => applySettings({ theme }));
bindSeg('ui-scale', (v) => applySettings({ uiScale: Number(v) }));
bindSeg('set-mode', (v) => applySettings({ defaultMode: v }));
for (const g of Covers.groups) {
  const og = document.createElement('optgroup');
  og.label = g;
  for (const c of Covers.list.filter((x) => x.group === g)) og.append(new Option(c.name, c.id));
  $('set-cover').append(og);
}
$('set-cover').addEventListener('change', (e) => applySettings({ defaultCover: e.target.value }));
$('set-paper').addEventListener('change', (e) => applySettings({ defaultPaper: e.target.value }));
$('set-penonly').addEventListener('change', (e) => applySettings({ penOnly: e.target.checked }));
$('set-dockhide').addEventListener('change', (e) => applySettings({ dockAutoHide: e.target.checked }));
$('set-history').addEventListener('change', (e) => applySettings({ historyLimit: Number(e.target.value) }));

$('settings-dialog').addEventListener(
  'click',
  (e) => {
    if (e.target.closest('[data-cmd]')) $('settings-dialog').close();
  },
  true
);

function openSettings() {
  closePopovers();
  syncSettingsUi();
  const editing = state.view === 'editor' && !!state.nb;
  $('set-notebook').hidden = !editing;
  if (editing) $('set-cover-name').textContent = Covers.get(state.nb.cover).name;
  api.libraryInfo().then((info) => showLibrary(info.dir));
  $('settings-dialog').showModal();
}

for (const [key, hex] of Object.entries(Model.PAPER_COLORS)) {
  const b = makeSwatch(hex, key[0].toUpperCase() + key.slice(1), 'value');
  b.dataset.value = key;
  $('paper-colors').insertBefore(b, $('paper-custom-wrap'));
}
// Your own paper colour: shown on the page while you choose, kept (and undoable) when you settle on it.
$('paper-custom').addEventListener('input', (e) => {
  if (!state.nb) return;
  state.nb.paperColor = e.target.value.toLowerCase();
  applyPaper();
});
$('paper-custom').addEventListener('change', (e) => {
  if (!state.nb) return;
  state.nb.paperColor = e.target.value.toLowerCase();
  applyPaper();
  markDirty(null);
  applySettings({ paperColor: state.nb.paperColor });
});
// Paper textures: each choice shows a sample of itself on the notebook's paper colour.
for (const t of Textures.list) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'texture';
  b.dataset.value = t.id;
  b.title = t.name;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', `${t.name} texture`);
  b.style.setProperty('--texture', Textures.css(t.id));
  const label = document.createElement('span');
  label.textContent = t.name;
  b.append(label);
  $('paper-textures').append(b);
}
$('paper-textures').addEventListener('click', (e) => {
  const b = e.target.closest('.texture');
  if (!b || !state.nb || (state.nb.paperTexture || 'none') === b.dataset.value) return;
  state.nb.paperTexture = b.dataset.value;
  applyPaper();
  markDirty(null);
  applySettings({ paperTexture: b.dataset.value });
});
$('paper-colors').addEventListener('click', (e) => {
  const key = e.target.dataset.value;
  if (!key || !state.nb || state.nb.paperColor === key) return;
  state.nb.paperColor = key;
  applyPaper();
  renderPageList();
  markDirty(null);
  applySettings({ paperColor: key });
});

function setFocusMode(on) {
  document.body.classList.toggle('focus', on);
  for (const id of ['btn-focus', 'dock-focus']) $(id).setAttribute('aria-pressed', String(on));
  closePopovers();
  onViewportChange();
  sendOverlay();
}

api.onFullscreen((on) => {
  state.fullscreen = on;
  for (const id of ['btn-fullscreen', 'dock-fullscreen']) $(id).setAttribute('aria-pressed', String(on));
  updateWco();
});
api.onSettings((s) => {
  state.settings = s;
  syncSettingsUi();
});

