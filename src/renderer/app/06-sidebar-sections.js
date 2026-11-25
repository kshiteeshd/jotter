// ---------- Sidebar: sections ----------

function renderSidebar() {
  renderSections();
  renderPageList();
}

// Small buttons shown on a list row when you point at it.
function rowButton(cls, iconId, label) {
  const b = document.createElement('button');
  b.className = cls;
  b.tabIndex = -1;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(iconId);
  return b;
}

function renderSections() {
  const list = el.sectionList;
  const top = list.scrollTop;
  list.textContent = '';
  state.nb.sections.forEach((s, i) => {
    const li = document.createElement('li');
    li.dataset.index = i;
    li.draggable = true;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === state.secIdx));
    li.tabIndex = i === state.secIdx ? 0 : -1;
    const dye = document.createElement('button');
    dye.className = 'dye';
    dye.tabIndex = -1;
    dye.style.background = s.color;
    dye.title = 'Change colour';
    dye.setAttribute('aria-label', `Change colour of ${s.title}`);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.title;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = s.pages.length;
    li.append(dye, name, count, rowButton('more', 'i-more', `Download, rename, colour or delete ${s.title}`));
    list.append(li);
  });
  list.scrollTop = top; // drawing the list again keeps it where it was
  $('side-cover').innerHTML = Covers.svg(state.nb.cover);
}

function showSection(i, pageIdx = null) {
  if (i < 0 || i >= state.nb.sections.length) return;
  if (i === state.secIdx && pageIdx === null) return;
  commitEditor();
  refreshActiveThumb();
  section().lastPage = state.pageIdx;
  state.secIdx = i;
  const s = section();
  state.pageIdx = pageIdx ?? Math.min(s.lastPage || 0, s.pages.length - 1);
  loadPage();
  renderSidebar();
}

function addSection() {
  commitEditor();
  const used = new Set(state.nb.sections.map((s) => s.color));
  const color = (Model.DYES.find(([c]) => !used.has(c)) || Model.DYES[state.nb.sections.length % Model.DYES.length])[0];
  let n = state.nb.sections.length + 1;
  while (state.nb.sections.some((s) => s.title === `Section ${n}`)) n++;
  const s = Model.newSection(`Section ${n}`, color);
  s.pages.push(Model.newPage('Page 1', { paper: state.settings.defaultPaper, mode: state.settings.defaultMode }));
  section().lastPage = state.pageIdx;
  state.nb.sections.splice(state.secIdx + 1, 0, s);
  state.secIdx += 1;
  state.pageIdx = 0;
  markDirty(null);
  loadPage();
  renderSidebar();
  startInlineRename(el.sectionList.children[state.secIdx], 'section');
}

async function deleteSection(i) {
  const nb = state.nb;
  if (nb.sections.length === 1) return flash('A notebook needs at least one section.');
  commitEditor();
  const s = nb.sections[i];
  if (s.pages.some((p) => !Model.isBlank(p))) {
    const r = await ask({
      message: `Delete the section “${s.title}”?`,
      detail: `${plural(s.pages.length, 'page')} in it will be removed.`,
      buttons: ['Delete', 'Cancel'],
      danger: true,
    });
    if (r !== 0) return;
  }
  nb.sections.splice(i, 1);
  if (i < state.secIdx || state.secIdx >= nb.sections.length) state.secIdx = Math.max(0, state.secIdx - 1);
  state.pageIdx = Math.min(section().lastPage || 0, pages().length - 1);
  markDirty(null);
  loadPage();
  renderSidebar();
}

el.sectionList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  const i = Number(li.dataset.index);
  // The ⋯ button and the colour dot open the section's menu.
  const opener = e.target.closest('.more, .dye');
  if (opener) {
    const r = opener.getBoundingClientRect();
    openSectionMenu(i, r.left, r.bottom);
  } else showSection(i);
});
el.sectionList.addEventListener('dblclick', (e) => {
  const li = e.target.closest('li');
  if (li && e.target.closest('.name')) startInlineRename(li, 'section');
});

// Rename a section in place (the current one if no index is given).
function renameSection(i = state.secIdx) {
  if (i !== state.secIdx) showSection(i);
  startInlineRename(el.sectionList.children[state.secIdx], 'section');
}

$('section-name').title = 'Double-click to rename this section';
$('section-name').addEventListener('dblclick', () => renameSection());

// Right-click a section for rename, colour and delete.
let sectionMenuIdx = 0;
function openSectionMenu(i, x, y) {
  sectionMenuIdx = i;
  const s = state.nb.sections[i];
  $('section-menu-title').textContent = s.title;
  $('section-dyes')
    .querySelectorAll('.swatch')
    .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === s.color)));
  const dye = Model.DYES.find(([c]) => c === s.color);
  $('section-colour-name').textContent = dye ? `· ${dye[1]}` : '';
  openPopover($('section-menu'), { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }, 'left');
}
el.sectionList.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  e.preventDefault();
  openSectionMenu(Number(li.dataset.index), e.clientX, e.clientY);
});
$('section-menu').addEventListener('click', (e) => {
  const i = sectionMenuIdx;
  const b = e.target.closest('button');
  if (!b || !state.nb.sections[i]) return;
  if (b.dataset.color) {
    state.nb.sections[i].color = b.dataset.color;
    markDirty(null);
    renderSections();
    closePopovers();
  } else if (b.dataset.action === 'pdf') {
    closePopovers();
    run('export-pdf', () => openExport({ format: 'pdf', section: i }));
  } else if (b.dataset.action === 'rename') renameSection(i);
  else if (b.dataset.action === 'delete') run('delete-section', () => deleteSection(i));
});
for (const [hex, name] of Model.DYES) $('section-dyes').append(makeSwatch(hex, name));
el.sectionList.addEventListener('keydown', (e) => listKeys(e, 'section'));

