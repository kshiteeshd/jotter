// ---------- Saving and opening ----------

/*
  Send the notebook to the main process. Pages and images it already holds go by name only; if it
  turns out to be missing some (for example after an error), everything is sent once more.
*/
async function sendSave({ saveAs = false, draft = false, copy = false } = {}) {
  commitEditor();
  const opts = { extra: draft && state.path ? { draftOf: state.path } : {} };
  const base = { path: state.path, saveAs, draft, copy, suggestedName: notebookName(), snapshot: state.forceSnapshot };
  let built = Model.buildSave(state.nb, sent, opts);
  let res = await api.saveNotebook({ ...built.request, ...base });
  if (res && res.resend) {
    built = Model.buildSave(state.nb, sent, { ...opts, full: true });
    res = await api.saveNotebook({ ...built.request, ...base });
  }
  if (res && !res.error && !res.resend) {
    built.commit();
    if (!draft) state.forceSnapshot = false;
  }
  return res;
}

async function writeDraft() {
  state.saving = true;
  try {
    await sendSave({ draft: true });
  } finally {
    state.saving = false;
  }
}

async function saveNotebook(saveAs = false, silent = false) {
  if (silent && !state.path) return false;
  const changes = state.changes;
  state.saving = true;
  syncChrome();
  let res;
  try {
    res = await sendSave({ saveAs });
  } finally {
    state.saving = false;
  }
  state.saveFailed = !!(res && res.error);
  if (!res || res.error) {
    syncChrome();
    if (res && silent) flash(res.error.replace(/\n/g, ' '));
    else if (res) await showError(res.error);
    return false;
  }
  state.path = res.path;
  if (state.changes === changes) {
    state.dirty = false;
    clearTimeout(autoTimer);
  } else {
    autoTimer = setTimeout(autoTick, AUTOSAVE_DELAY);
  }
  api.clearDraft();
  syncChrome();
  if (!silent) {
    touchRecent();
    flash('Saved');
  }
  return true;
}

async function saveCopy() {
  const res = await sendSave({ copy: true });
  if (!res) return;
  if (res.error) return showError(res.error);
  flash(`Copy saved to ${res.copy}`);
}

// Returns true when it is safe to replace or close the current notebook.
async function leaveNotebook() {
  clearTimeout(thumbTimer);
  if (!state.nb) return true;
  if (state.dirty) {
    const autosaved = state.path && (await saveNotebook(false, true));
    if (!autosaved) {
      const r = await ask({
        message: `Save changes to “${notebookName()}”?`,
        detail: "Your changes will be lost if you don't save them.",
        buttons: ['Save', "Don't save", 'Cancel'],
        cancelId: 2,
      });
      if (r === 2) return false;
      if (r === 0 && !(await saveNotebook())) return false;
    }
  }
  clearTimeout(autoTimer);
  api.clearDraft();
  touchRecent();
  return true;
}

function setNotebook(nb, path, dirty = false) {
  clearTimeout(autoTimer);
  state.nb = nb;
  state.path = path;
  state.untitledName = '';
  state.dirty = dirty;
  state.secIdx = 0;
  state.pageIdx = 0;
  undoLog.base = null; // no history is recorded while the notebook opens
  sent = Model.newSent();
  setView('editor');
  loadPage();
  renderSidebar();
  if (dirty) markDirty(null);
  resetHistory();
}

async function loadFile(file, dirty = false, pathOverride) {
  if (!file || file.focused) return false;
  if (file.error) {
    await showError(file.error);
    return false;
  }
  let nb;
  try {
    nb = Model.parse(file, Covers.ids);
  } catch (err) {
    const why = err instanceof SyntaxError ? 'The file is damaged or is not a Jotter notebook.' : err.message;
    await showError(`Could not open the notebook.\n${why}`);
    return false;
  }
  setNotebook(nb, pathOverride !== undefined ? pathOverride : file.path, dirty);
  if (file.at) goToPlace(file.at);
  if (!dirty) touchRecent();
  if (state.tool === 'text') el.editor.focus();
  return true;
}

// Rename the notebook. A saved notebook's file is renamed in its folder; an unsaved one just gets the
// name it will be saved under.
async function renameNotebook(input) {
  const name = input.trim().replace(/[. ]+$/, '');
  if (!name || name === notebookName()) return;
  if (name.length > 120 || /[\\/:*?"<>|]/.test(name)) {
    return showError('That name cannot be used.\nAvoid the characters \\ / : * ? " < > |');
  }
  if (!state.path) {
    state.untitledName = name;
    return syncChrome();
  }
  while (state.saving) await new Promise((r) => setTimeout(r, 50));
  await api.touchRecent({ path: state.path, pages: totalPages(), cover: state.nb.cover });
  const res = await api.renameNotebook(state.path, name);
  if (res.error) return showError(res.error);
  state.path = res.path;
  syncChrome();
  flash(`Renamed to ${name}`);
}

function startNotebookRename() {
  if ($('nb-rename')) return;
  const input = document.createElement('input');
  input.id = 'nb-rename';
  input.value = notebookName();
  input.maxLength = 120;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Notebook name');
  el.nbName.hidden = true;
  el.nbName.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value;
    input.remove();
    el.nbName.hidden = false;
    if (save) run('rename', () => renameNotebook(value));
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
}
el.nbName.addEventListener('click', startNotebookRename);

