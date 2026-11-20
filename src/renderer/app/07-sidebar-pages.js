// ---------- Sidebar: pages ----------

// The list keeps its scroll position when it is drawn again (a rename, an undo); it scrolls to show the open
// page only when you have moved to another page or section.
let listShown = { sec: -1, page: -1 };
function renderPageList() {
  commitEditor();
  const sameSection = listShown.sec === state.secIdx;
  const top = el.pageList.scrollTop;
  el.pageList.textContent = '';
  pages().forEach((p, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = i;
    li.setAttribute('role', 'option');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = p.title;
    li.append(title, rowButton('ren', 'i-edit', `Rename page ${p.title}`), delButton(`Delete page ${p.title}`));
    el.pageList.append(li);
  });
  if (sameSection) el.pageList.scrollTop = top;
  markActiveInList(!sameSection || listShown.page !== state.pageIdx);
}

function markActiveInList(reveal = true) {
  [...el.pageList.children].forEach((li, i) => {
    const active = i === state.pageIdx;
    li.setAttribute('aria-selected', String(active));
    li.tabIndex = active ? 0 : -1;
    if (active && reveal) li.scrollIntoView({ block: 'nearest' });
  });
  listShown = { sec: state.secIdx, page: state.pageIdx };
  const counts = el.sectionList.querySelectorAll('.count');
  if (counts[state.secIdx]) counts[state.secIdx].textContent = pages().length;
}

function showPage(idx) {
  if (idx === state.pageIdx || idx < 0 || idx >= pages().length) return;
  commitEditor();
  refreshActiveThumb();
  state.pageIdx = idx;
  loadPage(false);
}

function addPage(templateId = 'blank') {
  const t = Model.TEMPLATES.find((x) => x.id === templateId) || Model.TEMPLATES[0];
  commitEditor();
  let n = pages().length + 1;
  while (pages().some((p) => p.title === `Page ${n}`)) n++;
  const like = page();
  const p = Model.newPage(t.id === 'blank' ? `Page ${n}` : t.name, { mode: like.mode, paper: t.paper || like.paper, html: t.html });
  pages().splice(state.pageIdx + 1, 0, p);
  state.pageIdx += 1;
  markDirty(null);
  loadPage();
  if (state.tool === 'text') el.editor.focus();
}

function duplicatePage() {
  commitEditor();
  const src = page();
  const copy = Model.newPage(`${src.title} (copy)`.slice(0, 120), src);
  Object.assign(copy, { sheets: src.sheets, html: src.html, strokes: src.strokes.slice() });
  pages().splice(state.pageIdx + 1, 0, copy);
  state.pageIdx += 1;
  markDirty(null);
  loadPage();
}

function movePageToSection(idx, secIdx) {
  if (secIdx === state.secIdx) return;
  commitEditor();
  const [p] = pages().splice(idx, 1);
  const target = state.nb.sections[secIdx];
  target.pages.push(p);
  if (!pages().length) pages().push(Model.newPage('Page 1', { paper: p.paper, mode: p.mode }));
  if (idx < state.pageIdx || state.pageIdx >= pages().length) state.pageIdx = Math.max(0, state.pageIdx - 1);
  markDirty(null);
  loadPage();
  renderSidebar();
  flash(`Moved “${p.title}” to ${target.title}`);
}

async function deletePage(idx) {
  commitEditor();
  const p = pages()[idx];
  if (!Model.isBlank(p)) {
    const r = await ask({
      message: `Delete “${p.title}”?`,
      detail: 'The page and everything on it will be removed.',
      buttons: ['Delete', 'Cancel'],
      danger: true,
    });
    if (r !== 0) return;
  }
  pages().splice(idx, 1);
  if (!pages().length) pages().push(Model.newPage('Page 1', { paper: p.paper, mode: p.mode }));
  if (idx < state.pageIdx || state.pageIdx >= pages().length) state.pageIdx = Math.max(0, state.pageIdx - 1);
  markDirty(null);
  loadPage();
}

function renameItem(kind, idx, value) {
  if (kind === 'section') {
    const s = state.nb.sections[idx];
    const t = value.trim().slice(0, 80) || s.title;
    if (t !== s.title) {
      s.title = t;
      markDirty(null);
    }
    renderSections();
    syncChrome();
    return;
  }
  const p = pages()[idx];
  const t = value.trim().slice(0, 120) || p.title;
  if (t !== p.title) {
    p.title = t;
    markDirty(p);
  }
  if (idx === state.pageIdx) el.pageTitle.value = t;
  renderPageList();
}

function startInlineRename(li, kind) {
  if (!li) return;
  const idx = Number(li.dataset.index);
  const label = li.querySelector(kind === 'section' ? '.name' : '.title');
  const input = document.createElement('input');
  input.value = label.textContent;
  input.maxLength = kind === 'section' ? 80 : 120;
  input.setAttribute('aria-label', kind === 'section' ? 'Section name' : 'Page name');
  li.draggable = false;
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) renameItem(kind, idx, input.value);
    else if (kind === 'section') renderSections();
    else renderPageList();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
}

// Arrow keys, Home/End, F2 and Delete in the section and page lists.
function listKeys(e, kind) {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  const list = kind === 'section' ? el.sectionList : el.pageList;
  const idx = Number(li.dataset.index);
  const count = list.children.length;
  const go = (i) => {
    e.preventDefault();
    if (kind === 'section') showSection(i);
    else showPage(i);
    list.children[kind === 'section' ? state.secIdx : state.pageIdx]?.focus();
  };
  if (e.key === 'ArrowUp') go(Math.max(0, idx - 1));
  else if (e.key === 'ArrowDown') go(Math.min(count - 1, idx + 1));
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(count - 1);
  else if (e.key === 'F2') startInlineRename(li, kind);
  else if (e.key === 'Delete') run(kind === 'section' ? 'delete-section' : 'delete-page', () => (kind === 'section' ? deleteSection(idx) : deletePage(idx)));
  else if (e.key === 'Enter' && state.tool === 'text') {
    e.preventDefault();
    el.editor.focus();
  }
}

el.pageList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  const idx = Number(li.dataset.index);
  if (e.target.closest('.del')) run('delete-page', () => deletePage(idx));
  else if (e.target.closest('.ren')) startInlineRename(li, 'page');
  else showPage(idx);
});
el.pageList.addEventListener('dblclick', (e) => {
  const li = e.target.closest('li');
  if (li && e.target.closest('.title')) startInlineRename(li, 'page');
});
el.pageList.addEventListener('keydown', (e) => listKeys(e, 'page'));

// Drag pages to reorder them or onto a section to move them; drag sections to reorder them.
let drag = null;
const clearDropMarks = () =>
  document.querySelectorAll('.drop-target, .drop-before').forEach((n) => n.classList.remove('drop-target', 'drop-before'));

el.pageList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  drag = { kind: 'page', from: Number(li.dataset.index) };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
});
el.sectionList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  drag = { kind: 'section', from: Number(li.dataset.index) };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
});
el.pageList.addEventListener('dragover', (e) => {
  const li = e.target.closest('li');
  if (!drag || drag.kind !== 'page' || !li) return;
  e.preventDefault();
  clearDropMarks();
  li.classList.add('drop-target');
});
el.sectionList.addEventListener('dragover', (e) => {
  const li = e.target.closest('li');
  if (!drag || !li) return;
  e.preventDefault();
  clearDropMarks();
  li.classList.add(drag.kind === 'page' ? 'drop-target' : 'drop-before');
});
el.pageList.addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('li');
  if (!drag || drag.kind !== 'page' || !li) return;
  let to = Number(li.dataset.index);
  const from = drag.from;
  if (to !== from && to !== from + 1) {
    commitEditor();
    const active = page();
    const [moved] = pages().splice(from, 1);
    if (to > from) to--;
    pages().splice(to, 0, moved);
    state.pageIdx = pages().indexOf(active);
    markDirty(null);
  }
  renderPageList();
  syncChrome();
});
el.sectionList.addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('li');
  if (!drag || !li) return;
  const to = Number(li.dataset.index);
  if (drag.kind === 'page') {
    movePageToSection(drag.from, to);
  } else if (to !== drag.from) {
    const active = section();
    const [moved] = state.nb.sections.splice(drag.from, 1);
    state.nb.sections.splice(to > drag.from ? to - 1 : to, 0, moved);
    state.secIdx = state.nb.sections.indexOf(active);
    markDirty(null);
    renderSections();
  }
});
document.addEventListener('dragend', () => {
  drag = null;
  clearDropMarks();
});

el.pageTitle.addEventListener('input', () => {
  page().title = el.pageTitle.value.trim() || 'Untitled page';
  markDirty(page(), 'text');
  const active = el.pageList.querySelector('li[aria-selected="true"] .title');
  if (active) active.textContent = page().title;
});
el.pageTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.pageTitle.blur();
});
el.pageTitle.addEventListener('blur', () => state.nb && (el.pageTitle.value = page().title));

