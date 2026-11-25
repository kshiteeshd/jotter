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

// A zoom of your own is remembered (and used for every notebook) until you fit the page again (Ctrl+0).
let zoomTimer = 0;
function rememberZoom() {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    const zoom = state.userZoomed ? Math.round(state.zoom * 100) / 100 : 0;
    if (state.settings.zoom === zoom) return;
    state.settings.zoom = zoom;
    api.setSettings({ zoom });
  }, 700);
}

function stepZoom(dir) {
  state.userZoomed = true;
  const next = dir > 0 ? ZOOMS.find((z) => z > state.zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < state.zoom - 0.001);
  if (next) setZoom(next);
  rememberZoom();
}
el.workspace.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    state.userZoomed = true;
    // Ctrl+wheel and touchpad pinch: glide in or out around the pointer.
    setZoom(state.zoom * Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0022), e.clientX, e.clientY);
    rememberZoom();
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
  $('set-spellcheck').checked = s.spellcheck !== false;
  el.editor.spellcheck = s.spellcheck !== false;
  const nearest = (list, v) => String(list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)));
  $('set-history').value = nearest([10, 30, 100], s.historyLimit);
  $('set-history-budget').value = nearest([100, 500, 2000, 5000], s.historyBudgetMB || 500);
  document.body.classList.toggle('no-sidebar', !s.sidebar);
  document.body.classList.toggle('pen-only', s.penOnly);
  $('btn-sidebar').setAttribute('aria-pressed', String(!!s.sidebar));
  syncPaperPickers();
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
$('set-spellcheck').addEventListener('change', (e) => applySettings({ spellcheck: e.target.checked }));
$('set-dockhide').addEventListener('change', (e) => applySettings({ dockAutoHide: e.target.checked }));
$('set-history').addEventListener('change', (e) => applySettings({ historyLimit: Number(e.target.value) }));
$('set-history-budget').addEventListener('change', (e) => applySettings({ historyBudgetMB: Number(e.target.value) }));

// Commands in the settings (Version history, Export…) close it first.
$('settings-dialog').addEventListener(
  'click',
  (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b && !['toggle-focus', 'toggle-fullscreen', 'library-open', 'library-change'].includes(b.dataset.cmd)) $('settings-dialog').close();
  },
  true
);

// ---------- The settings window: categories on the left ----------

const PANES = ['notebook', 'general', 'pen', 'new', 'storage', 'shortcuts', 'about'];
function showPane(name) {
  const editing = state.view === 'editor' && !!state.nb;
  if (!PANES.includes(name) || (name === 'notebook' && !editing)) name = editing ? 'notebook' : 'general';
  for (const b of document.querySelectorAll('.settings-nav [data-pane]')) b.setAttribute('aria-current', String(b.dataset.pane === name));
  for (const p of document.querySelectorAll('.settings-panes .pane')) p.hidden = p.dataset.pane !== name;
  $('settings-dialog').dataset.pane = name;
  if (name === 'storage') {
    api.libraryInfo().then((info) => showLibrary(info.dir));
    api.historyUsage().then((bytes) => ($('set-history-usage').textContent = `Earlier versions of all notebooks use ${formatBytes(bytes)} now.`));
  }
  if (name === 'about') $('about-version').textContent = `Version ${state.version}`;
}
document.querySelector('.settings-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pane]');
  if (b) showPane(b.dataset.pane);
});
// Up and down move through the categories.
document.querySelector('.settings-nav').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...document.querySelectorAll('.settings-nav [data-pane]')].filter((b) => !b.hidden);
  const i = items.indexOf(document.activeElement);
  const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
  e.preventDefault();
  next.focus();
  showPane(next.dataset.pane);
});

const formatBytes = (n) => (n < 1e6 ? `${Math.max(0, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(1)} GB`);

function openSettings(pane) {
  closePopovers();
  syncSettingsUi();
  const editing = state.view === 'editor' && !!state.nb;
  $('nav-notebook').hidden = !editing;
  if (editing) {
    $('set-cover-name').textContent = Covers.get(state.nb.cover).name;
    $('set-nb-name').textContent = notebookName();
  }
  showPane(typeof pane === 'string' ? pane : editing ? 'notebook' : 'general');
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
}

/*
  Paper colour and texture pickers. "This notebook" changes the open notebook only (undoably); "New
  notebooks" sets what new notebooks start with. The two are separate: changing one never changes the
  other, except with "Use this paper", which copies the notebook's paper to the new-notebook choice.
*/
function paperPicker({ colors, custom, textures, get, set, preview }) {
  for (const [key, hex] of Object.entries(Model.PAPER_COLORS)) {
    const b = makeSwatch(hex, key[0].toUpperCase() + key.slice(1), 'value');
    b.dataset.value = key;
    $(colors).insertBefore(b, $(custom).closest('label'));
  }
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
    $(textures).append(b);
  }
  $(colors).addEventListener('click', (e) => {
    const key = e.target.dataset.value;
    if (key && get().paperColor !== key) set({ paperColor: key });
  });
  $(custom).addEventListener('input', (e) => preview && preview(e.target.value.toLowerCase()));
  $(custom).addEventListener('change', (e) => set({ paperColor: e.target.value.toLowerCase() }));
  $(textures).addEventListener('click', (e) => {
    const b = e.target.closest('.texture');
    if (b && (get().paperTexture || 'none') !== b.dataset.value) set({ paperTexture: b.dataset.value });
  });
  return () => {
    const { paperColor, paperTexture } = get();
    const own = !Model.PAPER_COLORS[paperColor];
    $(colors).querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === paperColor)));
    $(custom).closest('label').setAttribute('aria-checked', String(own));
    if (own) $(custom).value = paperColor;
    $(textures).style.setProperty('--paper', Model.paperHex(paperColor));
    $(textures).querySelectorAll('.texture').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === (paperTexture || 'none'))));
  };
}

const syncNotebookPaper = paperPicker({
  colors: 'paper-colors',
  custom: 'paper-custom',
  textures: 'paper-textures',
  get: () => state.nb || {},
  set: (patch) => {
    if (!state.nb) return;
    Object.assign(state.nb, patch);
    applyPaper();
    renderPageList();
    markDirty(null);
    syncPaperPickers();
  },
  // Your own colour is shown on the page while you choose, and kept (undoably) when you settle on it.
  preview: (hex) => {
    if (!state.nb) return;
    state.nb.paperColor = hex;
    applyPaper();
  },
});
const syncNewPaper = paperPicker({
  colors: 'new-paper-colors',
  custom: 'new-paper-custom',
  textures: 'new-paper-textures',
  get: () => state.settings,
  set: (patch) => applySettings(patch),
});
function syncPaperPickers() {
  syncNewPaper();
  if (!state.nb) return;
  syncNotebookPaper();
  const same = state.nb.paperColor === state.settings.paperColor && (state.nb.paperTexture || 'none') === (state.settings.paperTexture || 'none');
  $('btn-paper-default').disabled = same;
  $('paper-default-note').textContent = same ? 'New notebooks already start on this paper.' : 'New notebooks start on this paper colour and texture.';
}
$('btn-paper-default').addEventListener('click', () => {
  if (!state.nb) return;
  applySettings({ paperColor: state.nb.paperColor, paperTexture: state.nb.paperTexture || 'none' });
  flash('New notebooks will start on this paper');
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

