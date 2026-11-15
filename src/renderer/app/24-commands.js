// ---------- Commands ----------

// A new notebook in the notebooks folder, saved at once ("Book 1", "Book 2"… when no name is given).
async function createNotebook(cover, name = '') {
  if (!(await leaveNotebook())) return;
  const made = await api.libraryNew(name);
  if (made.error) return showError(made.error);
  const s = state.settings;
  setNotebook(Model.newNotebook({ cover, paperColor: s.paperColor, paper: s.defaultPaper, mode: s.defaultMode }), made.path);
  await saveNotebook(false, true);
  touchRecent();
  if (!name) flash(`Created “${notebookName()}”. Click its name at the top to rename it.`);
  if (state.tool === 'text') el.editor.focus();
}

const commands = {
  new: async () => {
    const info = await api.libraryInfo();
    const pick = await pickCover({ title: 'New notebook', ok: 'Create', askName: true, placeholder: info.next });
    if (pick) await createNotebook(pick.cover, pick.name);
  },
  open: async () => {
    if (await leaveNotebook()) await loadFile(await api.openNotebook());
  },
  home: showHome,
  back: showEditor,
  save: () => saveNotebook(false),
  'save-copy': saveCopy,
  'save-as': saveCopy,
  'library-open': () => api.libraryOpen(),
  'library-change': async () => {
    const info = await api.libraryChoose();
    showLibrary(info.dir);
    if (state.view === 'home') renderHome(await api.listRecents());
  },
  history: openHistory,
  'export-pdf': exportPdf,
  'export-png': exportPng,
  'export-md': exportMarkdown,
  print: printNotebook,
  'change-cover': async () => {
    const pick = await pickCover({ title: 'Change cover', ok: 'Apply', askName: false, cover: state.nb.cover });
    if (!pick || pick.cover === state.nb.cover) return;
    state.nb.cover = pick.cover;
    markDirty(null);
    applyCoverTheme();
    renderSections();
    touchRecent();
  },
  'request-close': async () => {
    if (await leaveNotebook()) {
      state.dirty = false;
      syncChrome();
      api.closeConfirmed();
    }
  },
  undo,
  redo,
  'add-page': () => addPage(),
  'add-section': addSection,
  'rename-section': () => renameSection(),
  'toggle-templates': toggleTemplates,
  'prev-page': () => showPage(state.pageIdx - 1),
  'next-page': () => showPage(state.pageIdx + 1),
  'duplicate-page': duplicatePage,
  'extend-page': extendPage,
  'clear-ink': clearInk,
  'delete-page': () => deletePage(state.pageIdx),
  'zoom-in': () => stepZoom(1),
  'zoom-out': () => stepZoom(-1),
  'zoom-reset': () => {
    state.userZoomed = false;
    setZoom(fitZoom());
  },
  'toggle-sidebar': () => applySettings({ sidebar: !state.settings.sidebar }),
  'toggle-rail': () => setRailCollapsed(!document.body.classList.contains('rail-collapsed')),
  'toggle-focus': () => setFocusMode(!document.body.classList.contains('focus')),
  'toggle-fullscreen': () => api.setFullscreen(!state.fullscreen),
  'toggle-view-panel': () => openSettings(),
  find: () => (el.searchPanel.hidden ? openSearch() : closePopovers()),
  settings: openSettings,
  shortcuts: () => $('shortcuts').showModal(),
  about: openAbout,
  'new-window': () => api.newWindow(),
  'insert-checklist': insertChecklist,
  'insert-table': () => insertTable(),
  'insert-image': () => $('image-input').click(),
  'insert-link': insertLink,
  'insert-textbox': insertTextBox,
  'sel-copy': copySelection,
  'sel-duplicate': () => copySelection() && pasteInk(),
  'sel-delete': deleteSelection,
};
// Commands that show dialogs or replace the notebook must not overlap.
const MODAL = new Set([
  'quick-new', 'trash', 'save-copy', 'library-change', 'rename', 'change-cover', 'new', 'open', 'save', 'save-as', 'history', 'export-pdf', 'export-png', 'export-md',
  'print', 'request-close', 'clear-ink', 'delete-page', 'delete-section', 'insert-link',
]);
// Commands that work without an open notebook on screen.
const ANYWHERE = new Set(['quick-new', 'trash', 'library-open', 'library-change', 'new', 'open', 'home', 'back', 'request-close', 'toggle-fullscreen', 'toggle-view-panel', 'settings', 'shortcuts', 'about', 'new-window']);

async function run(name, fn = commands[name]) {
  if (!fn) return;
  if (!ANYWHERE.has(name) && (!state.nb || state.view !== 'editor')) return;
  if (!MODAL.has(name)) return fn();
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (err) {
    await showError(`Something went wrong.\n${err.message}`);
  } finally {
    busy = false;
  }
}

api.onCommand((name) => run(name));
api.onOpenFile((file) =>
  run('open', async () => {
    if (await leaveNotebook()) await loadFile(file);
  })
);
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => run(b.dataset.cmd)));

