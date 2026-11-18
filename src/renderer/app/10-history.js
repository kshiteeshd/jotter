// ---------- Undo and redo: one history for the whole notebook ----------

/*
  Every change to the notebook goes through markDirty(), which records it here, so Undo always takes back
  the very last thing you did, wherever it was: a stroke, typing, a new or deleted page, a renamed
  section, a page's paper… and opens the page where it happened.

  The history keeps snapshots of the notebook. They are cheap: strokes are never changed in place, so a
  snapshot shares them, and each page's text is one string. Typing is grouped: a run of typing is one step,
  ended by a pause, Enter, or anything else you do.
*/
const undoLog = { undo: [], redo: [], base: null, typing: false, restoring: false, timer: 0 };
const HISTORY_LIMIT = 300; // steps
const HISTORY_BUDGET = 150e6; // characters of page text (pictures live in the text) kept only by the history
let editorChanged = false; // the editor has text the model does not have yet
let revSeq = 1e6; // restored pages get fresh revisions, so saving sends them again

// The notebook as it is now, plus where you are in it.
function snapshot() {
  if (editorChanged) commitEditor();
  const nb = state.nb;
  return {
    paperColor: nb.paperColor,
    cover: nb.cover,
    sections: nb.sections.map((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p })) })),
    at: { sec: state.secIdx, page: state.pageIdx, id: page().id },
  };
}

function resetHistory() {
  clearTimeout(undoLog.timer);
  Object.assign(undoLog, { undo: [], redo: [], typing: false, base: state.nb ? snapshot() : null, cost: 0 });
  syncUndoButtons();
}

// Keep a snapshot for Undo. Its cost is the page text it holds that the step before it does not share;
// the oldest steps go once there are too many, or once they hold too much (pages with large pictures).
function pushUndo(snap) {
  const prev = new Map();
  for (const s of undoLog.undo.at(-1)?.sections || []) for (const p of s.pages) prev.set(p.id, p.html);
  snap.cost = 0;
  for (const s of snap.sections) for (const p of s.pages) if (prev.get(p.id) !== p.html) snap.cost += p.html.length;
  undoLog.undo.push(snap);
  undoLog.cost = (undoLog.cost || 0) + snap.cost;
  while (undoLog.undo.length > 1 && (undoLog.undo.length > HISTORY_LIMIT || undoLog.cost > HISTORY_BUDGET)) {
    undoLog.cost -= undoLog.undo.shift().cost || 0;
  }
}

// Called by markDirty for every change. `kind` is 'text' for typing (in the page or its title).
function recordChange(kind) {
  if (undoLog.restoring || !state.nb || !undoLog.base) return;
  undoLog.redo.length = 0;
  if (kind === 'text') {
    if (!undoLog.typing) {
      pushUndo(undoLog.base);
      undoLog.typing = true;
    }
    clearTimeout(undoLog.timer);
    undoLog.timer = setTimeout(endTyping, 1200);
  } else if (undoLog.typing) {
    // Something changed while typing was still open without a pause in between: keep it with the typing.
    endTyping();
  } else {
    pushUndo(undoLog.base);
    undoLog.base = snapshot();
  }
  syncUndoButtons();
}

// A run of typing ends: what is there now becomes the starting point of the next step.
function endTyping() {
  clearTimeout(undoLog.timer);
  if (!undoLog.typing || !state.nb) return;
  undoLog.typing = false;
  undoLog.base = snapshot();
}

// Put the notebook back to a snapshot and open the page it was on.
function restoreSnapshot(snap) {
  undoLog.restoring = true;
  try {
    clearSelection();
    const nb = state.nb;
    nb.paperColor = snap.paperColor;
    nb.cover = snap.cover;
    nb.sections = snap.sections.map((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p, rev: ++revSeq })) }));
    let sec = Math.min(snap.at.sec, nb.sections.length - 1);
    let pg = Math.min(snap.at.page, nb.sections[sec].pages.length - 1);
    nb.sections.forEach((s, si) => s.pages.forEach((p, pi) => p.id === snap.at.id && ([sec, pg] = [si, pi])));
    state.secIdx = sec;
    state.pageIdx = pg;
    editorChanged = false;
    loadPage();
    renderSidebar();
    applyCoverTheme();
    markDirty(null);
  } finally {
    undoLog.restoring = false;
  }
}

function step(from, to, word) {
  // Not while drawing, or while a step that asks first (deleting, clearing…) is still being carried out.
  if (!state.nb || current || selDrag || pan || busy) return;
  endTyping();
  const snap = undoLog[from].pop();
  if (!snap) return flash(`Nothing to ${word}`);
  if (from === 'undo') undoLog.cost -= snap.cost || 0;
  if (to === 'undo') pushUndo(snapshot());
  else undoLog.redo.push(snapshot());
  restoreSnapshot(snap);
  undoLog.base = snapshot();
  syncUndoButtons();
}
const undo = () => step('undo', 'redo', 'undo');
const redo = () => step('redo', 'undo', 'redo');

function syncUndoButtons() {
  document.querySelectorAll('[data-cmd="undo"]').forEach((b) => (b.disabled = !undoLog.undo.length && !undoLog.typing));
  document.querySelectorAll('[data-cmd="redo"]').forEach((b) => (b.disabled = !undoLog.redo.length));
}

// Anything other than typing ends a run of typing first, so it becomes a step of its own.
document.addEventListener('pointerdown', endTyping, true);
document.addEventListener(
  'keydown',
  (e) => {
    const inText = e.target === el.editor || el.editor.contains(e.target) || e.target === el.pageTitle;
    if (!inText || e.key === 'Enter' || e.ctrlKey || e.altKey || e.metaKey) endTyping();
  },
  true
);
// The editor's own undo (for example from its right-click menu) is replaced by the notebook's.
el.editor.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault();
    (e.inputType === 'historyUndo' ? undo : redo)();
  }
});

// ---------- Ink ----------

// Replace the page's strokes (recorded like any other change).
function setStrokes(after) {
  page().strokes = after;
  markDirty();
  updateBlank();
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
