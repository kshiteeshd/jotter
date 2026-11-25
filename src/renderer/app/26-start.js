// ---------- Start ----------

(async function init() {
  const boot = await api.ready();
  state.settings = boot.settings;
  state.fullscreen = boot.fullscreen;
  state.version = boot.version;
  syncSettingsUi();
  setTool(restoreTools(boot.settings.tools));
  state.userZoomed = boot.settings.zoom > 0;
  setZoom(state.userZoomed ? boot.settings.zoom : 1);
  updateWco();
  applyCoverTheme();

  if (boot.file && (await loadFile(boot.file))) return;

  if (boot.draft) {
    const r = await ask({
      message: 'Restore your unsaved work?',
      detail: 'Jotter closed before these changes were saved to a notebook file.',
      buttons: ['Restore', 'Discard'],
      cancelId: 1,
    });
    let draftOf = null;
    try {
      draftOf = boot.draft.v3 ? JSON.parse(boot.draft.v3.notebook).draftOf || null : null;
    } catch {}
    if (r === 0 && (await loadFile(boot.draft, true, typeof draftOf === 'string' ? draftOf : null))) return;
  }
  // Otherwise pick up where you left off: the last notebook, at the same page and spot. Home is for when
  // there is nothing to reopen.
  if (boot.resume && (await loadFile(boot.resume))) return;
  renderHome(boot.recents);
  syncChrome();
})();
