// ---------- Sheet layout ----------

// Sheet coordinates start at the top-left of the text column. On paged pages the column is the whole sheet;
// on infinite pages the paper (and ink) extends past it on both sides, so x can be negative or beyond W.
function sheetScale() {
  const rect = el.editor.getBoundingClientRect();
  return rect.width ? { rect, k: W / rect.width } : null;
}

const viewBottom = () => {
  const s = sheetScale();
  return s ? (el.workspace.getBoundingClientRect().bottom - s.rect.top) * s.k : 0;
};
const viewTop = () => {
  const s = sheetScale();
  return s ? Math.max(0, (el.workspace.getBoundingClientRect().top - s.rect.top) * s.k) : 0;
};

/*
  The page is centred on the app window, not just on the area beside the sidebar, whether the tool
  options are open or folded. It only moves aside when it would otherwise run under the sidebar or the
  tool rail (a narrow window, or zoomed in). Paged: the workspace's left padding places the sheet.
  Infinite: the paper fills the workspace and the text column is placed on it.
*/
const MIN_GAP = 16;
function centrePage() {
  if (!state.nb || state.view !== 'editor') return;
  const ws = el.workspace;
  const wr = ws.getBoundingClientRect();
  const railRoom = parseFloat(getComputedStyle(document.body).getPropertyValue('--rail-room')) || 0;
  const mid = window.innerWidth / 2 - wr.left; // window centre, measured from the workspace's left edge
  // Keep clear of the tool bar on whichever side it is docked.
  const dock = document.body.dataset.dock;
  const minLeft = dock === 'left' ? railRoom : MIN_GAP;
  const minRight = dock === 'right' ? railRoom : MIN_GAP;
  const place = (width, span) => Math.max(minLeft, Math.min(mid - width / 2, span - minRight - width));
  if (page().mode === 'infinite') {
    ws.style.paddingLeft = '';
    const z = state.zoom;
    el.editor.style.marginLeft = `${Math.round(Math.max(0, place(W * z, ws.clientWidth)) / z)}px`;
    return;
  }
  el.editor.style.marginLeft = '';
  ws.style.paddingLeft = `${Math.round(place(el.sheetWrap.getBoundingClientRect().width, ws.clientWidth))}px`;
}

function layoutSheets() {
  centrePage();
  const p = page();
  const n = p.sheets;
  el.sheet.style.height = `${n * H}px`;
  el.editor.style.minHeight = `${n * H}px`;
  el.breaks.textContent = '';
  if (p.mode === 'paged') {
    for (let i = 1; i < n; i++) {
      const d = document.createElement('div');
      d.style.top = `${i * H}px`;
      d.dataset.n = String(i + 1);
      el.breaks.append(d);
    }
  }
  syncExtend();
  updateTiles();
}

/*
  A paged page holds up to MAX_PAGED A4 sheets. The button under the last sheet says how many there are,
  and once the page is full it says so and starts a new page instead.
*/
function syncExtend() {
  const p = page();
  const full = p.sheets >= MAX_PAGED;
  const b = $('extend');
  b.dataset.full = String(full);
  b.querySelector('span').textContent = full ? 'This page is full. Continue on a new page' : 'Add a sheet';
  b.querySelector('small').textContent = `${p.sheets} of ${MAX_PAGED} sheets`;
  b.title = full ? `A page holds up to ${MAX_PAGED} A4 sheets` : 'Add another A4 sheet to the end of this page';
  $('sb-page').textContent = p.mode === 'infinite' ? 'Infinite page' : `A4 · ${plural(p.sheets, 'sheet')}`;
}
// Said once per page, when text or ink reaches the end of a full page.
const warnedFull = new WeakSet();
function warnFull(p, what) {
  if (warnedFull.has(p)) return;
  warnedFull.add(p);
  flash(`${what} Continue on a new page (Ctrl+Shift+N).`);
}

// Size of the ink area: `w` wide (sheet px), text column starting `ox` from its left, canvases at scale `s`.
let layer = { w: W, ox: 0, s: SCALE };

function measureLayer() {
  const sc = sheetScale();
  const lr = el.inkLayer.getBoundingClientRect();
  const w = Math.max(W, Math.round(lr.width * sc.k));
  const ox = Math.max(0, Math.round((sc.rect.left - lr.left) * sc.k * 2) / 2);
  // Canvas pixels per sheet unit: enough for the screen's pixel density at the current zoom, so ink stays
  // crisp (in half steps, so zooming does not redraw on every tick), lower for very wide ink areas.
  const want = Math.min(3, Math.max(SCALE, Math.ceil(((window.devicePixelRatio || 1) / sc.k) * 2) / 2));
  const s = Math.max(1, Math.min(want, 4000 / w));
  const changed = w !== layer.w || ox !== layer.ox || s !== layer.s;
  if (changed) layer = { w, ox, s };
  return changed;
}

// Keep ink canvases only for the sheets near the viewport, so very long pages stay light.
function updateTiles() {
  const s = sheetScale();
  if (!s || !state.nb) return;
  const n = page().sheets;
  if (measureLayer()) {
    for (const c of tiles.values()) c.remove();
    tiles.clear();
    el.sheet.style.setProperty('--ox', `${layer.ox}px`);
  }
  el.live.setAttribute('viewBox', `${-layer.ox} 0 ${layer.w} ${n * H}`);
  const ws = el.workspace.getBoundingClientRect();
  const a = Math.max(0, Math.floor(((ws.top - s.rect.top) * s.k) / H) - 1);
  const b = Math.min(n - 1, Math.floor(((ws.bottom - s.rect.top) * s.k) / H) + 1);
  for (const [i, c] of tiles) {
    if (i < a || i > b) {
      c.remove();
      tiles.delete(i);
    }
  }
  for (let i = a; i <= b; i++) {
    if (tiles.has(i)) continue;
    const c = document.createElement('canvas');
    c.width = Math.round(layer.w * layer.s);
    c.height = Math.round(H * layer.s);
    c.style.top = `${i * H}px`;
    c.style.width = `${layer.w}px`;
    el.inkLayer.insertBefore(c, el.live);
    tiles.set(i, c);
    renderTile(i, c);
  }
}

let hiddenStrokes = null; // strokes being moved are drawn in the live layer instead

function tileCtx(i) {
  const ctx = tiles.get(i).getContext('2d');
  ctx.setTransform(layer.s, 0, 0, layer.s, layer.ox * layer.s, -i * H * layer.s);
  return ctx;
}

function renderTile(i, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(layer.s, 0, 0, layer.s, layer.ox * layer.s, -i * H * layer.s);
  for (const s of page().strokes) {
    if (hiddenStrokes && hiddenStrokes.has(s)) continue;
    const [a, b] = Ink.sheetRange(s);
    if (i >= a && i <= b) Ink.drawStroke(ctx, s);
  }
}

function redrawInk() {
  for (const [i, c] of tiles) renderTile(i, c);
}

function drawOnTiles(stroke) {
  const [a, b] = Ink.sheetRange(stroke);
  for (let i = a; i <= b; i++) if (tiles.has(i)) Ink.drawStroke(tileCtx(i), stroke);
}

// How far down the content of a page reaches (text measured in `textEl`).
function contentBottom(p, textEl) {
  let bottom = 0;
  for (const s of p.strokes) bottom = Math.max(bottom, Ink.box(s).maxY);
  return Math.max(bottom, textBottom(textEl));
}

function textBottom(node) {
  if (!node.textContent.trim() && !node.querySelector('img, table, .tbox')) return 0;
  const outer = node.getBoundingClientRect();
  if (!outer.width) return 0;
  const range = document.createRange();
  range.selectNodeContents(node);
  return (range.getBoundingClientRect().bottom - outer.top) * (W / outer.width);
}

const contentSheets = (p, textEl) => Math.max(1, Math.ceil((contentBottom(p, textEl) + 40) / H));

// Paged: give the page more sheets when the text runs past the bottom.
function growToFit() {
  const p = page();
  const want = Math.ceil((el.editor.scrollHeight - 1) / H);
  if (want > MAX_PAGED) warnFull(p, `This page is full (${MAX_PAGED} A4 sheets): text past the end will not show in PDFs.`);
  const needed = Math.min(MAX_PAGED, want);
  if (needed > p.sheets) {
    p.sheets = needed;
    layoutSheets();
  }
}

// Infinite: always keep blank room below `y` (sheet coordinates).
function ensureRoom(y) {
  const p = page();
  if (p.mode !== 'infinite') return;
  if (Math.ceil((y + ROOM) / H) > MAX_INFINITE) warnFull(p, 'This infinite page has reached its full length.');
  const wanted = Math.min(MAX_INFINITE, Math.ceil((y + ROOM) / H));
  if (wanted > p.sheets) {
    p.sheets = wanted;
    layoutSheets();
  }
}

function extendPage() {
  const p = page();
  if (p.mode === 'infinite') return flash('Infinite pages grow by themselves as you scroll.');
  if (p.sheets >= MAX_PAGED) return addPage();
  p.sheets += 1;
  layoutSheets();
  markDirty();
}

let viewQueued = false;
function onViewportChange() {
  activeScale = null;
  if (viewQueued) return;
  viewQueued = true;
  requestAnimationFrame(() => {
    viewQueued = false;
    if (!state.nb || state.view !== 'editor') return;
    autoZoom();
    centrePage();
    ensureRoom(viewBottom());
    updateTiles();
    if (selection) showSelection();
    hideImageBar();
  });
}
el.workspace.addEventListener('scroll', onViewportChange, { passive: true });
new ResizeObserver(() => { activeScale = null; onViewportChange(); }).observe(el.workspace);

