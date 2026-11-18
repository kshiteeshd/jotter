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
  }
  // A small dot in a fixed-width slot: the bar never shifts as saving comes and goes.
  let save = 'saved';
  if (nb) {
    if (state.saving) save = 'saving';
    else if (state.saveFailed) save = 'failed';
    else if (state.dirty && !state.path) save = 'unsaved';
    else if (state.dirty) save = 'pending';
  }
  const SAVE_TEXT = { saved: 'All changes saved', pending: 'Saving shortly', saving: 'Saving…', failed: 'Not saved', unsaved: 'Not saved yet' };
  if (el.saveState.dataset.state !== save) {
    el.saveState.dataset.state = save;
    el.saveState.title = SAVE_TEXT[save];
    el.saveState.lastElementChild.textContent = save === 'failed' || save === 'unsaved' ? SAVE_TEXT[save] : '';
  }
  api.setState({ name, dirty: !!nb && state.dirty, path: state.path });
}

let autoTimer = 0;
let thumbTimer = 0;

// Record a change. `p` is the page that changed (null when only the notebook's structure changed);
// `kind` is 'text' for typing, which Undo takes back a run at a time.
function markDirty(p = state.nb && page(), kind = 'edit') {
  if (p) p.rev++;
  recordChange(kind);
  state.changes++;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(autoTick, AUTOSAVE_DELAY);
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(refreshActiveThumb, 700);
  if (!state.dirty) {
    state.dirty = true;
    syncChrome();
  }
}

// Autosave to the notebook's own file; notebooks without a file (or with autosave off) go to a recovery copy.
async function autoTick() {
  if (!state.nb || !state.dirty) return;
  if (busy || current || selDrag || state.saving) {
    autoTimer = setTimeout(autoTick, 500);
    return;
  }
  if (state.path) await saveNotebook(false, true);
  else await writeDraft();
}

