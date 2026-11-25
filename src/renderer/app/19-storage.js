// ---------- Saving and opening ----------

/*
  Send the notebook to the main process. Pages and images it already holds go by name only; if it
  turns out to be missing some (for example after an error), everything is sent once more.
*/
async function sendSave({ saveAs = false, draft = false, copy = false, resolve = null } = {}) {
  commitEditor();
  const opts = { extra: draft && state.path ? { draftOf: state.path } : {} };
  const base = { path: state.path, saveAs, draft, copy, resolve, suggestedName: notebookName(), snapshot: state.forceSnapshot };
  let built = Model.buildSave(state.nb, sent, opts);
  let res = await api.saveNotebook({ ...built.request, ...base });
  if (res && res.resend) {
    built = Model.buildSave(state.nb, sent, { ...opts, full: true });
    res = await api.saveNotebook({ ...built.request, ...base });
  }
  if (res && !res.error && !res.resend && !res.conflict) {
    built.commit();
    if (!draft) state.forceSnapshot = false;
    if (res.bytes) state.lastBytes = res.bytes;
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

async function saveNotebook(saveAs = false, silent = false, resolve = null) {
  if (silent && !state.path) return false;
  if (silent && state.conflict && !resolve) return false;
  const changes = state.changes;
  state.saving = true;
  syncChrome();
  let res;
  try {
    res = await sendSave({ saveAs, resolve });
  } finally {
    state.saving = false;
  }
  if (res && res.conflict) return resolveConflict();
  if (res && !res.error) state.conflict = false;
  state.saveFailed = !!(res && res.error);
  if (!res || res.error) {
    syncChrome();
    if (res && silent) flash(res.error.replace(/\n/g, ' '));
    else if (res) await showError(res.error);
    return false;
  }
  state.path = res.path;
  clearTimeout(draftTimer);
  if (state.changes === changes) {
    state.dirty = false;
    clearTimeout(autoTimer);
  } else {
    autoTimer = setTimeout(autoTick, autosaveDelay());
  }
  api.clearDraft();
  syncChrome();
  if (!silent) {
    touchRecent();
    flash('Saved');
  }
  return true;
}

/*
  The notebook's file was changed outside Jotter since it was opened or saved: by OneDrive or another sync
  tool bringing in an edit made on another computer, or by another program. Nothing is written over it
  without asking. Keeping both is the safe choice; whichever version is not kept stays in Version history.
*/
async function resolveConflict() {
  if (state.conflictAsking) return false;
  state.conflictAsking = true;
  state.conflict = true;
  syncChrome();
  try {
    const name = notebookName();
    const r = await ask({
      message: 'This notebook was changed outside Jotter',
      detail: `“${name}” changed on disk after you opened it, for example by OneDrive syncing an edit made on another computer. Your changes have not been saved over it.`,
      buttons: ['Keep both', 'Replace it with my version', 'Open the changed version', 'Decide later'],
      notes: [
        `Your version is saved next to it as “${name} (my changes)”`,
        'The changed version is kept in Version history',
        'Your version is kept in Version history',
      ],
      cancelId: 3,
    });
    if (r === 0 || r === 1) {
      state.conflict = false;
      const ok = await saveNotebook(false, true, r === 0 ? 'copy' : 'overwrite');
      if (ok) {
        touchRecent();
        flash(r === 0 ? `Your version is saved as “${notebookName()}”` : 'Saved your version');
      }
      return ok;
    }
    if (r === 2) {
      const kept = await sendSave({ resolve: 'mine-in-history' });
      if (!kept || kept.error) {
        if (kept) await showError(kept.error);
        return false;
      }
      state.conflict = false;
      state.dirty = false;
      await reloadFromDisk('Opened the changed version. Yours is in Version history.');
      return true;
    }
    flash('Not saved: the notebook changed outside Jotter. Save (Ctrl+S) to decide.');
    return false;
  } finally {
    state.conflictAsking = false;
    syncChrome();
  }
}

// Read the open notebook again from its file, staying on the same page and spot.
async function reloadFromDisk(message) {
  const at = placeNow();
  const file = await api.readNotebook(state.path);
  if (file.error) return showError(file.error);
  clearTimeout(autoTimer);
  clearTimeout(draftTimer);
  api.clearDraft();
  if (await loadFile({ ...file, at })) flash(message);
}

// Coming back to Jotter: if the notebook changed elsewhere meanwhile and you have nothing unsaved, show
// the new version. (With unsaved changes, the next save asks.)
window.addEventListener('focus', async () => {
  if (!state.nb || !state.path || state.view !== 'editor' || state.dirty || busy || state.saving) return;
  const r = await api.checkFile();
  if (r.changed && !state.dirty && !busy) run('reload-changed', () => reloadFromDisk('Updated with changes made outside Jotter'));
});

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
  clearTimeout(draftTimer);
  state.conflict = false;
  state.lastBytes = 0;
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
    Model.Images.clear(); // the pictures of the notebook being left (its undo history goes too)
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

