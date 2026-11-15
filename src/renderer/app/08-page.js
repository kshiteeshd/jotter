// ---------- Page ----------

// The live page's text goes back into the model (editing attributes are left out).
function commitEditor() {
  if (state.nb && state.view === 'editor') page().html = el.editor.innerHTML.replace(/ contenteditable="(true|false)"/g, '');
}

function loadPage(rebuildList = true) {
  const p = page();
  clearSelection();
  hideFloatbars();
  CSS.highlights?.delete('search');
  el.editor.innerHTML = p.html;
  prepareBoxes();
  order = [];
  redoOrder = [];
  textSig = editorSig();
  // A short fade as the page changes.
  el.sheet.classList.remove('swap');
  void el.sheet.offsetWidth;
  el.sheet.classList.add('swap');
  el.pageTitle.value = p.title;
  el.workspace.scrollTop = 0;
  applyPaper();
  if (p.mode === 'infinite') p.sheets = Math.min(MAX_INFINITE, contentSheets(p, el.editor));
  layoutSheets();
  if (p.mode === 'infinite') ensureRoom(viewBottom());
  else growToFit();
  redrawInk();
  updateBlank();
  if (rebuildList) renderPageList();
  else markActiveInList();
  syncChrome();
}

function applyPaper() {
  const p = page();
  el.sheet.style.setProperty('--paper', Model.PAPER_COLORS[state.nb.paperColor]);
  el.editor.dataset.paper = p.paper;
  $('paper-bg').dataset.paper = p.paper;
  setSeg('paper-style', p.paper);
  setSeg('page-mode', p.mode);
  document.body.dataset.mode = p.mode;
  document
    .querySelectorAll('#paper-colors .swatch')
    .forEach((s) => s.setAttribute('aria-checked', String(s.dataset.value === state.nb.paperColor)));
}

// An empty page shows a faint motif.
function updateBlank() {
  const empty = !page().strokes.length && !el.editor.textContent.trim() && !el.editor.querySelector('img, table, .tbox');
  el.sheet.classList.toggle('blank', empty);
}

bindSeg('page-mode', (mode) => {
  const p = page();
  if (p.mode === mode) return;
  p.mode = mode;
  p.sheets = Math.min(MAX_PAGED, contentSheets(p, el.editor));
  applyPaper();
  layoutSheets();
  if (mode === 'infinite') ensureRoom(viewBottom());
  redrawInk();
  markDirty();
});
bindSeg('paper-style', (paper) => {
  if (page().paper === paper) return;
  page().paper = paper;
  applyPaper();
  if (page().mode === 'paged') growToFit();
  markDirty();
});

