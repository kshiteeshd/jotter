// ---------- Model access ----------

const section = () => state.nb.sections[state.secIdx];
const pages = () => section().pages;
const page = () => pages()[state.pageIdx];
const totalPages = () => Model.allPages(state.nb).length;

function notebookName() {
  if (!state.path) return state.untitledName || 'Untitled';
  return state.path.split(/[\\/]/).pop().replace(/\.ntb$/i, '');
}

