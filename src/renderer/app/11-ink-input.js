// ---------- Ink input ----------

let activeScale = null; // cached during a gesture to avoid per-event layout reads
function gestureScale() {
  if (!activeScale) activeScale = sheetScale();
  return activeScale;
}
function toSheetPoint(e, s = gestureScale()) {
  return [r1((e.clientX - s.rect.left) * s.k), r1((e.clientY - s.rect.top) * s.k)];
}

let current = null; // the gesture in progress: a stroke, an erase, a shape or a lasso
let pan = null; // { id, x, y, left, top } while dragging the page around
let spaceDown = false;
let lastPen = 0; // when a pen last touched; touches right after are treated as the palm
let inkFrame = 0;
let pendingInk = null; // batched pointer samples for the active stroke/eraser/shape/lasso

function liveSvg(markup, transform = '') {
  el.liveGroup.setAttribute('transform', transform);
  el.liveGroup.innerHTML = markup;
  strokeGroup.textContent = '';
  liveInk = null;
}

/*
  The stroke being drawn. Each pointer event adds only the newest pieces: settled pieces collect in short
  path "chunks", so a long stroke costs no more per event than a short one. The last few pieces are still
  being steadied (see Ink.filterPoint) and are redrawn on every event as the "tail". The group carries the
  marker's transparency, so overlapping pieces do not darken each other.
*/
const SVG_NS = 'http://www.w3.org/2000/svg';
const strokeGroup = document.createElementNS(SVG_NS, 'g');
el.live.insertBefore(strokeGroup, el.liveGroup);
let liveInk = null; // { n, done, chunk, d, count, tail }

function piecePath(pts, i) {
  const [sx, sy, cx, cy, ex, ey] = Ink.segment(pts, i);
  return [`M${sx} ${sy}`, `Q${cx} ${cy} ${ex} ${ey}`];
}

function liveStroke(c) {
  const pts = c.points;
  const n = pts.length / 2;
  const widths = c.w;
  if (!liveInk || n < liveInk.n) {
    strokeGroup.textContent = '';
    const attrs = { fill: 'none', stroke: c.color, 'stroke-width': c.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: c.tool === 'marker' ? Ink.MARKER_ALPHA : 1 };
    for (const [k, v] of Object.entries(attrs)) strokeGroup.setAttribute(k, v);
    liveInk = { n: 0, done: 0, chunk: null, d: '', count: 0, tail: document.createElementNS(SVG_NS, 'g') };
    strokeGroup.append(liveInk.tail);
  }
  const L = liveInk;
  L.n = n;
  const settled = n - 1 - Ink.FILTER_REACH - 1; // pieces before this no longer change
  for (; L.done < settled; L.done++) {
    const [m, q] = piecePath(pts, L.done);
    if (widths || !L.chunk || L.count >= 48) {
      if (L.chunk) L.chunk.setAttribute('d', L.d);
      L.chunk = document.createElementNS(SVG_NS, 'path');
      if (widths) L.chunk.setAttribute('stroke-width', Ink.pressureWidth(c.size, widths[L.done]));
      strokeGroup.insertBefore(L.chunk, L.tail);
      L.d = m;
      L.count = 0;
    }
    L.d += q;
    L.count++;
  }
  if (L.chunk) L.chunk.setAttribute('d', L.d);
  // The unsettled end of the line.
  let markup = '';
  let d = '';
  for (let i = L.done; i < n; i++) {
    const [m, q] = piecePath(pts, i);
    if (widths) markup += `<path d="${m}${q}" stroke-width="${Ink.pressureWidth(c.size, widths[i])}"/>`;
    else d += (d ? '' : m) + q;
  }
  L.tail.innerHTML = widths ? markup : `<path d="${d}"/>`;
}

function updateLive() {
  if (!current || current.tool === 'eraser' || current.tool === 'lasso') return liveSvg('');
  if (current.tool === 'shape') return liveSvg(Ink.strokeSvg(shapeStroke(current)));
  liveStroke(current);
}

function shapeStroke(c) {
  let { x0, y0, x1, y1 } = c;
  if (c.shift) {
    if (c.kind === 'rect' || c.kind === 'ellipse') {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    } else {
      const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(x1 - x0, y1 - y0);
      x1 = r1(x0 + Math.cos(a) * len);
      y1 = r1(y0 + Math.sin(a) * len);
    }
  }
  return { tool: 'pen', color: c.color, size: c.size, points: Ink.shapePoints(c.kind, x0, y0, x1, y1, c.size), flat: 1 };
}

// Remove ink along the eraser's path: parts of strokes (rub out) or whole strokes.
function eraseAlong(ax, ay, bx, by) {
  const strokes = page().strokes;
  const r = current.size / 2;
  let next = null;
  if (current.mode === 'stroke') {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(2, r)));
    const hit = (s) => {
      for (let k = 0; k <= steps; k++) if (Ink.hitsStroke(s, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, r)) return true;
      return false;
    };
    const kept = strokes.filter((s) => !hit(s));
    if (kept.length !== strokes.length) next = kept;
  } else {
    next = Ink.eraseAlong(strokes, ax, ay, bx, by, r);
  }
  if (next) {
    page().strokes = next;
    current.changed = true;
    // Redraw only sheets the eraser passed through (faster than a full redraw).
    const pad = r + 24;
    const minY = Math.min(ay, by) - pad;
    const maxY = Math.max(ay, by) + pad;
    const a = Math.max(0, Math.floor(minY / H));
    const b = Math.min(page().sheets - 1, Math.floor(maxY / H));
    let drew = false;
    for (let i = a; i <= b; i++) if (tiles.has(i)) { renderTile(i, tiles.get(i)); drew = true; }
    if (!drew) redrawInk();
  }
}

function addPoint(e, sc = activeScale) {
  const [x, y] = toSheetPoint(e, sc || gestureScale());
  const c = current;
  if (c.tool === 'lasso') {
    c.poly.push(x, y);
    return;
  }
  if (c.tool === 'shape') {
    Object.assign(c, { x1: x, y1: y, shift: e.shiftKey });
    return;
  }
  if (c.tool === 'eraser') {
    eraseAlong(c.last[0], c.last[1], x, y);
    c.last = [x, y];
    return;
  }
  const pts = c.points;
  // Shift: straight line from where the stroke began, snapping to horizontal, vertical and 45°.
  if (e.shiftKey) {
    const dx = x - pts[0];
    const dy = y - pts[1];
    const a = Math.atan2(dy, dx);
    const snapped = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    let ex = x;
    let ey = y;
    if (Math.abs(a - snapped) < 0.07) {
      const len = Math.hypot(dx, dy);
      ex = r1(pts[0] + Math.cos(snapped) * len);
      ey = r1(pts[1] + Math.sin(snapped) * len);
    }
    c.points = [pts[0], pts[1], ex, ey];
    c.raw = [pts[0], pts[1], ex, ey];
    c.straight = true;
    delete c.w;
    return;
  }
  // Freehand: skip samples closer than about a screen pixel to the last one, then steady the line.
  const raw = c.raw;
  const minGap = (e.pointerType === 'mouse' ? 1.5 : 0.75) * ((sc || gestureScale())?.k || 1);
  if (Math.hypot(x - raw[raw.length - 2], y - raw[raw.length - 1]) < minGap) return;
  raw.push(x, y);
  // Pressure is eased too, so the line's width swells and thins instead of jumping.
  if (c.w) c.w.push(r1(c.w[c.w.length - 1] * 0.6 + (e.pressure || 0.5) * 0.4));
  const n = raw.length / 2;
  pts.length = n * 2;
  for (let i = Math.max(1, n - 1 - Ink.FILTER_REACH - 1); i < n; i++) {
    const [fx, fy] = Ink.filterPoint(raw, i);
    pts[i * 2] = fx;
    pts[i * 2 + 1] = fy;
  }
}

function capture(e) {
  try {
    el.inkLayer.setPointerCapture(e.pointerId);
  } catch {}
}

el.inkLayer.addEventListener('pointerdown', (e) => {
  if (state.tool === 'text' || current || pan || selDrag) return;
  if (e.pointerType === 'pen') lastPen = Date.now();
  if (e.pointerType === 'touch' && (state.settings.penOnly || Date.now() - lastPen < 800)) return;
  if (spaceDown || e.button === 1) {
    e.preventDefault();
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.workspace.scrollLeft, top: el.workspace.scrollTop };
    document.body.classList.add('panning', 'dragging');
    el.ring.style.display = 'none';
    capture(e);
    return;
  }
  const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
  if (e.button !== 0 && !penEraser) return;
  e.preventDefault();
  activeScale = sheetScale();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  closePopovers();
  capture(e);
  const tool = penEraser ? 'eraser' : state.tool;
  const [x, y] = toSheetPoint(e, activeScale);
  if (tool === 'select') return startSelectGesture(e, x, y);
  const t = state.tools[tool];
  if (tool === 'shape') {
    current = { pointerId: e.pointerId, tool, kind: t.kind, color: t.color, size: t.size, x0: x, y0: y, x1: x, y1: y };
  } else if (tool === 'eraser') {
    current = { pointerId: e.pointerId, tool, size: t.size, mode: state.settings.eraserMode, last: [x, y] };
    eraseAlong(x, y, x, y);
  } else {
    current = { pointerId: e.pointerId, tool, color: t.color, size: t.size, points: [x, y], raw: [x, y] };
    if (tool === 'pen' && e.pointerType === 'pen') current.w = [r1(e.pressure || 0.5)];
  }
  updateLive();
});

function flushInkMove() {
  inkFrame = 0;
  const batch = pendingInk;
  pendingInk = null;
  if (!batch || !current || batch.pointerId !== current.pointerId) return;
  if (!activeScale) activeScale = sheetScale();
  for (const ev of batch.events) addPoint(ev, activeScale);
  if (current.tool === 'lasso') drawLasso();
  else updateLive();
}

el.inkLayer.addEventListener('pointermove', (e) => {
  if (pan) {
    if (e.pointerId !== pan.id) return;
    el.workspace.scrollLeft = pan.left - (e.clientX - pan.x);
    el.workspace.scrollTop = pan.top - (e.clientY - pan.y);
    return;
  }
  if (selDrag) return moveSelection(e);
  moveRing(e);
  if (!current || e.pointerId !== current.pointerId) return;
  if (e.pointerType === 'pen') lastPen = Date.now();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const last = events[events.length - 1];
  const usable = last && Math.abs(last.clientX - e.clientX) < 1.5 && Math.abs(last.clientY - e.clientY) < 1.5;
  const list = usable ? events : [e];
  if (pendingInk && pendingInk.pointerId === e.pointerId) pendingInk.events.push(...list);
  else pendingInk = { pointerId: e.pointerId, events: list.slice() };
  if (!inkFrame) inkFrame = requestAnimationFrame(flushInkMove);
});

function finishGesture(e) {
  if (pan && e.pointerId === pan.id) {
    pan = null;
    document.body.classList.remove('dragging');
    if (!spaceDown) document.body.classList.remove('panning');
    return;
  }
  if (selDrag) return finishSelectionDrag(e);
  if (!current || e.pointerId !== current.pointerId) return;
  if (inkFrame) { cancelAnimationFrame(inkFrame); inkFrame = 0; }
  if (pendingInk && pendingInk.pointerId === e.pointerId) {
    if (!activeScale) activeScale = sheetScale();
    for (const ev of pendingInk.events) addPoint(ev, activeScale);
    pendingInk = null;
  }
  const c = current;
  current = null;
  activeScale = null;
  liveSvg('');
  if (c.tool === 'lasso') return finishLasso(c);
  const p = page();
  if (c.tool === 'eraser') {
    if (c.changed) setStrokes(p.strokes);
    return;
  }
  let stroke;
  if (c.tool === 'shape') {
    if (Math.hypot(c.x1 - c.x0, c.y1 - c.y0) < 3) return;
    stroke = shapeStroke(c);
  } else {
    const pts = c.points;
    stroke = { tool: c.tool, color: c.color, size: c.size, points: pts };
    if (c.w) stroke.w = c.w;
    else if (c.tool === 'pen' && !c.straight && pts.length >= 8) stroke.taper = 1; // thins out at both ends
  }
  setStrokes([...p.strokes, stroke]);
  drawOnTiles(stroke);
  ensureRoom(Ink.box(stroke).maxY);
}
el.inkLayer.addEventListener('pointerup', finishGesture);
el.inkLayer.addEventListener('pointercancel', finishGesture);
// A release anywhere else (over the tool rail, outside the window) still ends the gesture, so a stroke can
// never be left half-finished (which would also hold up autosave).
window.addEventListener('pointerup', finishGesture);
window.addEventListener('pointercancel', finishGesture);
el.inkLayer.addEventListener('pointerenter', moveRing);
el.inkLayer.addEventListener('pointerleave', () => (el.ring.style.display = 'none'));
// Stop the middle mouse button from starting the browser's own auto-scroll; it pans the page instead.
el.inkLayer.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});

// Drawing tools show their nib instead of the system pointer: a dot of the pen's colour and size,
// a translucent marker tip, or the outline of the eraser.
function moveRing(e) {
  const tool = state.tool;
  if (!['pen', 'marker', 'eraser'].includes(tool) || spaceDown || e.pointerType === 'touch') return;
  const s = activeScale || sheetScale();
  if (!s) return;
  const t = state.tools[tool];
  // Pointer/nib preview matches the tool's actual stroke size on screen.
  const d = Math.max(1.5, t.size / s.k);
  const st = el.ring.style;
  el.ring.dataset.tool = tool;
  if (t.color) st.setProperty('--ring', t.color);
  st.display = 'block';
  st.width = st.height = `${d}px`;
  st.transform = `translate(${e.clientX - d / 2}px, ${e.clientY - d / 2}px)`;
}

