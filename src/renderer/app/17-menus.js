// ---------- Menus ----------

// Right-click a page for rename, duplicate, move, clear ink and delete.
function openPageMenu(i, x, y) {
  if (i !== state.pageIdx) showPage(i);
  $('page-menu-title').textContent = page().title;
  const targets = $('move-targets');
  targets.textContent = '';
  state.nb.sections.forEach((s, i) => {
    if (i === state.secIdx) return;
    const b = document.createElement('button');
    b.className = 'item';
    const dye = document.createElement('span');
    dye.className = 'dye';
    dye.style.background = s.color;
    b.append(dye, `Move to ${s.title}`);
    b.addEventListener('click', () => movePageToSection(state.pageIdx, i));
    targets.append(b);
  });
  openPopover(el.pageMenu, { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }, 'left');
}
el.pageList.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  e.preventDefault();
  openPageMenu(Number(li.dataset.index), e.clientX, e.clientY);
});
el.pageMenu.querySelector('[data-action="rename"]').addEventListener('click', () => {
  closePopovers();
  startInlineRename(el.pageList.children[state.pageIdx], 'page');
});

function toggleTemplates() {
  if (!el.templatesMenu.hidden) return closePopovers();
  openPopover(el.templatesMenu, $('btn-templates'), 'left', $('btn-templates'));
}
for (const t of Model.TEMPLATES) {
  const b = document.createElement('button');
  b.className = 'item';
  b.innerHTML = icon(t.id === 'blank' ? 'i-page' : t.id === 'todo' ? 'i-checklist' : t.id === 'week' ? 'i-table' : 'i-type');
  b.append(t.name);
  b.addEventListener('click', () => addPage(t.id));
  el.templatesMenu.append(b);
}

document.addEventListener('pointerdown', (e) => {
  if (anyPopoverOpen() && !e.target.closest('.popover, .tool, [aria-haspopup]')) closePopovers();
  if (!el.imgBar.hidden && !e.target.closest('#img-bar') && e.target.tagName !== 'IMG') hideImageBar();
  if (!el.tboxHandle.hidden && !e.target.closest('.tbox, #tbox-handle')) hideBoxHandle();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('.popover .item')) closePopovers();
});

