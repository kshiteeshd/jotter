// ---------- Page ----------

// The page the editor is showing. Its text is saved into this page and no other, even when the open page
// has already changed (adding or moving pages switches page before the editor reloads).
let editorPage = null;

// The live page's text goes back into the model (editing attributes are left out).
function commitEditor() {
  if (state.nb && state.view === 'editor' && editorPage) editorPage.html = el.editor.innerHTML.replace(/ contenteditable="(true|false)"/g, '');
  editorChanged = false;
}

// `scroll`: keep the view where it was ({ top, left }) instead of starting at the top; `fade`: the short
// fade that shows a different page has opened.
function loadPage(rebuildList = true, { scroll = null, fade = true } = {}) {
  const p = page();
  clearSelection();
  hideFloatbars();
  CSS.highlights?.delete('search');
  el.editor.innerHTML = p.html;
  editorPage = p;
  editorChanged = false;
  prepareBoxes();
  el.sheet.classList.remove('swap');
  if (fade) {
    void el.sheet.offsetWidth;
    el.sheet.classList.add('swap');
  }
  el.pageTitle.value = p.title;
  if (!scroll) el.workspace.scrollTop = 0;
  applyPaper();
  if (p.mode === 'infinite') p.sheets = Math.min(MAX_INFINITE, contentSheets(p, el.editor));
  layoutSheets();
  if (scroll) {
    el.workspace.scrollTop = scroll.top;
    el.workspace.scrollLeft = scroll.left;
  }
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

