// ---------- Start ----------

(async function init() {
  const boot = await api.ready();
  state.settings = boot.settings;
  state.fullscreen = boot.fullscreen;
  state.version = boot.version;
  syncSettingsUi();
  setTool('text');
  setZoom(1);
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
  renderHome(boot.recents);
  syncChrome();
})();
