// ---------- Chrome: names, save state ----------

function syncChrome() {
  const nb = state.nb;
  const name = nb ? notebookName() : '';
  if (nb) {
    el.nbName.firstElementChild.textContent = name;
    el.nbName.title = `Rename notebook — ${state.path || 'not saved to a file yet'}`;
    el.statusPage.textContent = `${state.pageIdx + 1} / ${pages().length}`;
    $('section-name').textContent = section().title;
    $('crumb-section').textContent = section().title;
    // The status bar: where you are, and the page's size.
    const p = page();
    $('sb-where').textContent = `${section().title} · Page ${state.pageIdx + 1} of ${pages().length}`;
    $('sb-page').textContent = p.mode === 'infinite' ? 'Infinite page' : `A4 · ${plural(p.sheets, 'sheet')}`;
  }
  // Saving, in words, in a fixed-width slot: the bar never shifts as saving comes and goes.
  let save = 'saved';
  if (nb) {
    if (state.saving) save = 'saving';
    else if (state.conflict) save = 'conflict';
    else if (state.saveFailed) save = 'failed';
    else if (state.dirty && !state.path) save = 'unsaved';
    else if (state.dirty) save = 'pending';
  }
  const SAVE_TEXT = { saved: 'All changes saved', pending: 'Saving…', saving: 'Saving…', failed: 'Not saved', unsaved: 'Not saved to a file yet', conflict: 'Not saved: changed elsewhere' };
  if (el.saveState.dataset.state !== save) {
    el.saveState.dataset.state = save;
    el.saveState.title = save === 'conflict' ? 'The file changed outside Jotter. Save (Ctrl+S) to choose what to keep.' : SAVE_TEXT[save];
    el.saveState.lastElementChild.textContent = SAVE_TEXT[save];
  }
  api.setState({ name, dirty: !!nb && state.dirty, path: state.path });
}

let autoTimer = 0;
let draftTimer = 0;
let thumbTimer = 0;

/*
  When saving happens. A recovery copy (only what changed, on this computer) is written half a second
  after you pause, so a crash loses almost nothing. The notebook's own file, often in a synced folder, is
  written a moment later: 1.5 s for an ordinary notebook, longer for a big one (up to 12 s), since every
  save rewrites the whole file and a sync tool uploads it again. It is also written at once when you
  switch to another window, leave the notebook or close Jotter.
*/
const DRAFT_DELAY = 500;
function autosaveDelay() {
  const mb = (state.lastBytes || 0) / 1e6;
  return Math.round(Math.min(12000, AUTOSAVE_DELAY + Math.max(0, mb - 2) * 500));
}

// Record a change. `p` is the page that changed (null when only the notebook's structure changed);
// `kind` is 'text' for typing, which Undo takes back a run at a time.
function markDirty(p = state.nb && page(), kind = 'edit') {
  if (p) p.rev++;
  recordChange(kind);
  state.changes++;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(autoTick, autosaveDelay());
  if (state.path) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(draftTick, DRAFT_DELAY);
  }
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(refreshActiveThumb, 700);
  if (!state.dirty) {
    state.dirty = true;
    syncChrome();
  }
}

// Not now: in the middle of drawing, of a question, or of another save.
const saveWaits = () => busy || current || selDrag || state.saving || !!document.querySelector('dialog[open]');

// Autosave to the notebook's own file; notebooks without a file go to a recovery copy.
async function autoTick() {
  clearTimeout(autoTimer);
  if (!state.nb || !state.dirty || state.conflict) return;
  if (saveWaits()) {
    autoTimer = setTimeout(autoTick, 500);
    return;
  }
  if (state.path) await saveNotebook(false, true);
  else await writeDraft();
}

async function draftTick() {
  if (!state.nb || !state.dirty || !state.path) return;
  if (saveWaits()) {
    draftTimer = setTimeout(draftTick, 400);
    return;
  }
  await writeDraft();
}

// Switching to another window saves at once.
window.addEventListener('blur', () => {
  if (state.nb && state.dirty && state.path) autoTick();
});

