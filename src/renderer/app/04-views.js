// ---------- Views ----------

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  closePopovers();
  hideFloatbars();
  applyCoverTheme();
}

async function showHome() {
  if (state.nb) {
    commitEditor();
    touchRecent();
  }
  setView('home');
  renderHome(await api.listRecents());
  syncChrome();
}

function showEditor() {
  if (!state.nb) return;
  setView('editor');
  layoutSheets();
  redrawInk();
  if (state.tool === 'text') el.editor.focus();
}

