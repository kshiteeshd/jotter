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
    paperTexture: nb.paperTexture,
    cover: nb.cover,
    sections: nb.sections.map((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p })) })),
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

// Typing goes on where the change was: after an undo the cursor sits where the undone text was, after a
// redo at the end of the text that came back. (Character positions in the page's text.)
function caretAfterChange(oldText, newText) {
  let a = 0;
  while (a < oldText.length && a < newText.length && oldText[a] === newText[a]) a++;
  let b = 0;
  while (b < oldText.length - a && b < newText.length - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++;
  return newText.length - b;
}
function placeCaret(index) {
  const walk = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT);
  let left = index;
  let node = null;
  while ((node = walk.nextNode())) {
    if (left <= node.length) break;
    left -= node.length;
  }
  const range = document.createRange();
  if (node) range.setStart(node, Math.max(0, left));
  else range.selectNodeContents(el.editor), range.collapse(false);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// What the sidebar shows, to tell whether it needs drawing again.
const sidebarSig = (nb) => JSON.stringify(nb.sections.map((s) => [s.title, s.color, s.pages.map((p) => [p.id, p.title])]));

/*
  Put the notebook back to a snapshot. Undo only undoes: you stay on the page and section you are on, the
  page and the sidebar stay scrolled where they are, and the page is not reloaded; only what changed on it
  is updated in place (its ink, text, title or paper). A change on another page is undone there without
  taking you to it. Only when the undo removes the very page you are on do you move, to the page now in
  its place in the same section.
*/
function restoreSnapshot(snap) {
  undoLog.restoring = true;
  try {
    clearSelection();
    hideFloatbars();
    const nb = state.nb;
    const shown = page();
    const view = { top: el.workspace.scrollTop, left: el.workspace.scrollLeft };
    const lists = { sections: el.sectionList.scrollTop, pages: el.pageList.scrollTop };
    const before = { sidebar: sidebarSig(nb), paperColor: nb.paperColor, paperTexture: nb.paperTexture, cover: nb.cover, sec: state.secIdx, page: state.pageIdx };
    nb.paperColor = snap.paperColor;
    nb.paperTexture = snap.paperTexture;
    nb.cover = snap.cover;
    nb.sections = snap.sections.map((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p, rev: ++revSeq })) }));

    let sec = -1;
    let pg = -1;
    nb.sections.forEach((s, si) => s.pages.forEach((p, pi) => p.id === shown.id && ((sec = si), (pg = pi))));
    const stays = sec >= 0;
    if (!stays) {
      sec = Math.min(before.sec, nb.sections.length - 1);
      pg = Math.min(before.page, nb.sections[sec].pages.length - 1);
    }
    state.secIdx = sec;
    state.pageIdx = pg;
    const now = page();

    if (stays) {
      editorPage = now;
      editorChanged = false;
      if (now.html !== shown.html) {
        const typing = document.activeElement === el.editor || el.editor.contains(document.activeElement);
        const oldText = el.editor.textContent;
        el.editor.innerHTML = now.html;
        prepareBoxes();
        if (typing) {
          el.editor.focus({ preventScroll: true });
          placeCaret(caretAfterChange(oldText, el.editor.textContent));
        }
      }
      if (now.title !== shown.title) el.pageTitle.value = now.title;
      if (now.mode !== shown.mode || now.paper !== shown.paper || nb.paperColor !== before.paperColor || nb.paperTexture !== before.paperTexture) applyPaper();
      if (now.mode !== shown.mode || now.sheets !== shown.sheets) layoutSheets();
      if (now.strokes !== shown.strokes) redrawInk();
      if (now.html !== shown.html) now.mode === 'paged' ? growToFit() : ensureRoom(textBottom(el.editor));
    } else {
      loadPage(false, { scroll: view, fade: false });
    }
    if (sidebarSig(nb) !== before.sidebar || sec !== before.sec || pg !== before.page) {
      renderSidebar();
      el.sectionList.scrollTop = lists.sections;
      el.pageList.scrollTop = lists.pages;
    } else {
      const counts = el.sectionList.querySelectorAll('.count');
      if (counts[sec]) counts[sec].textContent = pages().length;
    }
    if (nb.cover !== before.cover) applyCoverTheme();
    updateBlank();
    syncChrome();
    el.workspace.scrollTop = view.top;
    el.workspace.scrollLeft = view.left;
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
