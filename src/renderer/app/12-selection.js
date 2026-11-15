// ---------- Selecting ink ----------

let selection = null; // { strokes, box }
let selDrag = null; // { pointerId, mode: 'move' | 'scale', x0, y0, dx, dy, k }
let inkClipboard = null;

function drawLasso() {
  const p = current.poly;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  el.lassoPath.setAttribute('d', `${d}Z`);
}

function startSelectGesture(e, x, y) {
  if (selection) {
    const b = selection.box;
    const k = sheetScale().k;
    const nearHandle = Math.hypot(x - b.maxX, y - b.maxY) < 14 * k;
    const inside = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
    if (nearHandle || inside) {
      selDrag = { pointerId: e.pointerId, mode: nearHandle ? 'scale' : 'move', x0: x, y0: y, dx: 0, dy: 0, k: 1 };
      hiddenStrokes = new Set(selection.strokes);
      redrawInk();
      liveSvg(selection.strokes.map(Ink.strokeSvg).join(''));
      el.selBar.hidden = true;
      return;
    }
  }
  clearSelection();
  current = { pointerId: e.pointerId, tool: 'lasso', poly: [x, y] };
}

function finishLasso(c) {
  el.lassoPath.setAttribute('d', '');
  const picked = Ink.inLasso(page().strokes, c.poly);
  if (picked.length) selectStrokes(picked);
}

function selectStrokes(strokes) {
  selection = { strokes, box: Ink.boundsOf(strokes) };
  showSelection();
}

function selectionTransform() {
  const { mode, dx, dy, k } = selDrag;
  const b = selection.box;
  return mode === 'move' ? `translate(${dx} ${dy})` : `translate(${b.minX} ${b.minY}) scale(${k}) translate(${-b.minX} ${-b.minY})`;
}

function moveSelection(e) {
  if (e.pointerId !== selDrag.pointerId) return;
  const [x, y] = toSheetPoint(e);
  const b = selection.box;
  if (selDrag.mode === 'move') {
    selDrag.dx = x - selDrag.x0;
    selDrag.dy = y - selDrag.y0;
  } else {
    const kx = (x - b.minX) / Math.max(1, b.maxX - b.minX);
    const ky = (y - b.minY) / Math.max(1, b.maxY - b.minY);
    selDrag.k = Math.min(10, Math.max(0.1, Math.max(kx, ky)));
  }
  el.liveGroup.setAttribute('transform', selectionTransform());
  showSelection(selDrag);
}

function finishSelectionDrag(e) {
  if (e.pointerId !== selDrag.pointerId) return;
  const d = selDrag;
  selDrag = null;
  hiddenStrokes = null;
  liveSvg('');
  const b = selection.box;
  const moved = d.mode === 'move' ? Math.hypot(d.dx, d.dy) > 0.5 : Math.abs(d.k - 1) > 0.005;
  if (moved) {
    const map = new Map(
      selection.strokes.map((s) => [s, d.mode === 'move' ? Ink.translate(s, d.dx, d.dy) : Ink.scaleAbout(s, b.minX, b.minY, d.k)])
    );
    setStrokes(page().strokes.map((s) => map.get(s) || s));
    selection.strokes = [...map.values()];
    selection.box = Ink.boundsOf(selection.strokes);
  }
  redrawInk();
  showSelection();
}

function showSelection(drag = null) {
  if (!selection) return;
  let { minX, minY, maxX, maxY } = selection.box;
  if (drag && drag.mode === 'move') {
    minX += drag.dx;
    maxX += drag.dx;
    minY += drag.dy;
    maxY += drag.dy;
  } else if (drag) {
    maxX = minX + (maxX - minX) * drag.k;
    maxY = minY + (maxY - minY) * drag.k;
  }
  const pad = 6;
  Object.assign(el.sel.style, {
    left: `${minX + layer.ox - pad}px`,
    top: `${minY - pad}px`,
    width: `${maxX - minX + pad * 2}px`,
    height: `${maxY - minY + pad * 2}px`,
  });
  el.sel.hidden = false;
  if (drag) return;
  el.selBar.hidden = false;
  const r = el.sel.getBoundingClientRect();
  const w = el.selBar.offsetWidth;
  el.selBar.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
  el.selBar.style.top = `${Math.max(56, r.top - 52)}px`;
}

function clearSelection() {
  selection = null;
  el.sel.hidden = true;
  el.selBar.hidden = true;
}

function deleteSelection() {
  if (!selection) return;
  const gone = new Set(selection.strokes);
  setStrokes(page().strokes.filter((s) => !gone.has(s)));
  clearSelection();
  redrawInk();
}

function copySelection() {
  if (!selection) return false;
  inkClipboard = selection.strokes;
  flash(`Copied ${plural(selection.strokes.length, 'stroke')}`);
  return true;
}

function pasteInk() {
  if (!inkClipboard || !inkClipboard.length) return;
  const b = Ink.boundsOf(inkClipboard);
  // Paste next to the original when it is in view, otherwise near the top of the view.
  const top = viewTop();
  const dy = b.minY + 24 > top && b.minY < viewBottom() ? 24 : top + 80 - b.minY;
  const pasted = inkClipboard.map((s) => Ink.translate(s, 24, dy));
  setStrokes([...page().strokes, ...pasted]);
  ensureRoom(Ink.boundsOf(pasted).maxY);
  redrawInk();
  if (state.tool !== 'select') setTool('select');
  selectStrokes(pasted);
}

function recolorSelection(color) {
  if (!selection) return;
  const map = new Map(selection.strokes.map((s) => [s, { ...s, color }]));
  setStrokes(page().strokes.map((s) => map.get(s) || s));
  selection.strokes = [...map.values()];
  redrawInk();
}

