// ---------- Ink history (per page) ----------

function pageHistory() {
  const id = page().id;
  if (!inkHistory.has(id)) inkHistory.set(id, { undo: [], redo: [] });
  return inkHistory.get(id);
}

// Replace the page's strokes and remember how to go back.
function setStrokes(after, before = page().strokes) {
  page().strokes = after;
  const h = pageHistory();
  h.undo.push({ before, after });
  if (h.undo.length > 200) h.undo.shift();
  h.redo.length = 0;
  order.push('ink');
  redoOrder = [];
  markDirty();
  updateBlank();
}

function stepInk(from, to) {
  const h = pageHistory();
  const op = h[from].pop();
  if (!op) return false;
  clearSelection();
  page().strokes = from === 'undo' ? op.before : op.after;
  h[to].push(op);
  redrawInk();
  markDirty();
  updateBlank();
  return true;
}

/*
  One undo for typing and ink. `order` records what happened on this page, in sequence, since it was
  opened: 'ink' for each ink change, or a text run { before, after } (signatures of the text around it).
  Undo takes the latest entry: ink changes are reverted here, text runs by the editor's own undo, one
  step at a time until the text is back to how it was before the run.
*/
let order = [];
let redoOrder = [];
let textSig = '';

function editorSig() {
  const t = el.editor.textContent;
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return `${t.length}:${h}:${el.editor.getElementsByTagName('*').length}`;
}

// Run the editor's own undo or redo. Returns whether it has more steps left.
function stepText(cmd) {
  const typing = state.tool === 'text';
  el.editor.focus({ preventScroll: true });
  document.execCommand(cmd);
  const more = document.queryCommandEnabled(cmd);
  textSig = editorSig();
  if (!typing) {
    el.editor.blur();
    window.getSelection().removeAllRanges();
  }
  return more;
}

function undo() {
  const top = order.at(-1);
  if (top && top !== 'ink') {
    if (top.after === undefined) top.after = textSig;
    const more = stepText('undo');
    if (textSig === top.before || !more) redoOrder.push(order.pop());
    return;
  }
  if (top === 'ink') redoOrder.push(order.pop());
  if (!stepInk('undo', 'redo') && !top) stepText('undo'); // nothing recorded on this visit: let the text undo if it can
}

function redo() {
  const top = redoOrder.at(-1);
  if (top && top !== 'ink') {
    const more = stepText('redo');
    if (textSig === top.after || !more) order.push(redoOrder.pop());
    return;
  }
  if (top === 'ink') order.push(redoOrder.pop());
  if (!stepInk('redo', 'undo') && !top) stepText('redo');
}

async function clearInk() {
  const p = page();
  if (!p.strokes.length) return;
  const r = await ask({
    message: 'Clear all ink on this page?',
    detail: 'Typed text is kept. You can bring the ink back with Undo.',
    buttons: ['Clear ink', 'Cancel'],
    danger: true,
  });
  if (r !== 0) return;
  setStrokes([]);
  redrawInk();
}

