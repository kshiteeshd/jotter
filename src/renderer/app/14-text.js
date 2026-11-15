// ---------- Text editing ----------

let savedRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel.rangeCount && el.editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
    syncFormatUi();
  }
});

function restoreSelection() {
  const sel = window.getSelection();
  const inEditor = sel.rangeCount && el.editor.contains(sel.anchorNode);
  if (!inEditor) {
    el.editor.focus();
    if (savedRange && el.editor.contains(savedRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }
}

function format(cmd, value) {
  restoreSelection();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, value);
  syncFormatUi();
  onEditorChanged();
}

function syncFormatUi() {
  document.querySelectorAll('.fmt').forEach((b) => {
    let on = false;
    try {
      on = document.queryCommandState(b.dataset.fmt);
    } catch {}
    b.setAttribute('aria-pressed', String(on));
  });
  let block = 'div';
  try {
    block = String(document.queryCommandValue('formatBlock')).toLowerCase();
  } catch {}
  el.blockStyle.value = ['h1', 'h2', 'h3'].includes(block) ? block : 'div';
}

function onEditorChanged() {
  textSig = editorSig();
  markDirty();
  CSS.highlights?.delete('search');
  if (page().mode === 'infinite') ensureRoom(textBottom(el.editor));
  else growToFit();
  updateBlank();
}

el.editor.addEventListener('input', (e) => {
  // Typing starts (or continues) a text run in the undo order; the editor's own undo and redo do not.
  if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') {
    const top = order.at(-1);
    if (!top || top === 'ink') order.push({ before: textSig });
    redoOrder = [];
    if (state.nb) pageHistory().redo.length = 0;
  }
  onEditorChanged();
});

const selectionNode = () => {
  const n = window.getSelection().anchorNode;
  return n && (n.nodeType === 1 ? n : n.parentElement);
};

// Tab moves between table cells, indents list items, and otherwise types a tab.
el.editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  const node = selectionNode();
  const td = node && node.closest('td');
  if (td && el.editor.contains(td)) return moveCell(td, e.shiftKey ? -1 : 1);
  if (node && node.closest('li')) {
    document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    return onEditorChanged();
  }
  if (!e.shiftKey) document.execCommand('insertText', false, '\t');
});

function moveCell(td, dir) {
  const table = td.closest('table');
  const cells = [...table.querySelectorAll('td')];
  let target = cells[cells.indexOf(td) + dir];
  if (!target && dir > 0) {
    const last = table.rows[table.rows.length - 1];
    const row = last.cloneNode(false);
    for (let i = 0; i < last.cells.length; i++) row.insertCell().innerHTML = '<br>';
    last.after(row);
    target = row.cells[0];
    onEditorChanged();
  }
  if (!target) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Clicks in the text: tick checklist items, open links with Ctrl, select images.
el.editor.addEventListener('click', (e) => {
  const li = e.target.closest('ul.checklist > li');
  if (li && e.target === li && e.clientX - li.getBoundingClientRect().left < 26 * state.zoom) {
    li.classList.toggle('done');
    onEditorChanged();
    return;
  }
  const a = e.target.closest('a[href]');
  if (a) {
    e.preventDefault();
    if (e.ctrlKey) api.openExternal(a.getAttribute('href'));
    else flash('Ctrl+click to open the link');
    return;
  }
  if (e.target.tagName === 'IMG') showImageBar(e.target);
  else hideImageBar();
});

// Paste as plain text (or as an embedded image) so notes never carry outside markup or remote content.
el.editor.addEventListener('paste', async (e) => {
  e.preventDefault();
  const item = [...e.clipboardData.items].find((it) => it.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(it.type));
  if (item) return insertImageFile(item.getAsFile());
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
});

document.querySelectorAll('.fmt').forEach((b) => b.addEventListener('click', () => format(b.dataset.fmt)));
el.blockStyle.addEventListener('change', () => format('formatBlock', el.blockStyle.value));

// Toolbar and panel buttons must not take focus away from the text being edited.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('#topbar button, #dock button, .popover button, .floatbar button, #tbox-handle button')) e.preventDefault();
});

