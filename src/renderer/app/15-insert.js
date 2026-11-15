// ---------- Inserting: checklists, tables, links, images, text boxes ----------

function insertChecklist() {
  restoreSelection();
  let ul = selectionNode()?.closest('ul');
  if (ul && el.editor.contains(ul)) {
    ul.classList.toggle('checklist');
  } else {
    document.execCommand('insertUnorderedList');
    ul = selectionNode()?.closest('ul');
    if (ul) ul.classList.add('checklist');
  }
  onEditorChanged();
}

function insertTable(rows = 3, cols = 3) {
  restoreSelection();
  const row = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
  document.execCommand('insertHTML', false, `<table><tbody>${row.repeat(rows)}</tbody></table><div><br></div>`);
  onEditorChanged();
}

const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function insertLink() {
  restoreSelection();
  const sel = window.getSelection();
  const range = sel.rangeCount && el.editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  const text = range ? range.toString() : '';
  const res = await ask({
    message: 'Add a link',
    detail: text ? `Links the text “${text.slice(0, 60)}”.` : 'The address is added at the cursor.',
    input: { label: 'Web address', value: '', placeholder: 'https://example.com' },
    buttons: ['Add link', 'Cancel'],
  });
  if (res.index !== 0 || !res.value.trim()) return;
  let url = res.value.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  if (!/^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+)$/i.test(url)) return showError('That is not a valid web address.');
  el.editor.focus();
  if (range) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (text) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
  onEditorChanged();
}

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

// Images are scaled down to at most MAX_IMAGE pixels so notebooks stay small.
async function imageDataUrl(file) {
  if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return null;
  if (file.size > 30 * 1024 * 1024) {
    flash('That image is too large (over 30 MB).');
    return null;
  }
  if (file.type === 'image/gif') return readAsDataUrl(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const k = Math.min(1, MAX_IMAGE / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1 && file.size < 1.5 * 1024 * 1024) return readAsDataUrl(file);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function insertImageFile(file) {
  const data = await imageDataUrl(file);
  if (!data) return;
  restoreSelection();
  document.execCommand('insertImage', false, data);
  onEditorChanged();
}

$('image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await insertImageFile(file);
});

// Drop pictures onto the page.
el.sheet.addEventListener('drop', async (e) => {
  const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  if (state.tool !== 'text') setTool('text');
  const r = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (r && el.editor.contains(r.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  }
  for (const f of files) await insertImageFile(f);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

let selectedImg = null;
function showImageBar(img) {
  hideImageBar();
  selectedImg = img;
  img.classList.add('selected');
  el.imgBar.hidden = false;
  const r = img.getBoundingClientRect();
  const w = el.imgBar.offsetWidth;
  el.imgBar.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
  el.imgBar.style.top = `${Math.max(56, r.top - 48)}px`;
}
function hideImageBar() {
  if (selectedImg) selectedImg.classList.remove('selected');
  selectedImg = null;
  el.imgBar.hidden = true;
}
el.imgBar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !selectedImg) return;
  const img = selectedImg;
  if (b.dataset.size === 'delete') {
    hideImageBar();
    img.remove();
  } else {
    img.style.width = `${b.dataset.size}%`;
    showImageBar(img);
  }
  onEditorChanged();
});

function hideFloatbars() {
  hideImageBar();
  el.selBar.hidden = true;
  hideBoxHandle();
}

// Text boxes: positioned anywhere on the page, each with its own editable area.
function prepareBoxes() {
  for (const box of el.editor.querySelectorAll('.tbox')) {
    box.contentEditable = 'false';
    let body = box.querySelector('.tbox-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'tbox-body';
      body.append(...box.childNodes);
      box.append(body);
    }
    body.contentEditable = 'true';
  }
}

function insertTextBox() {
  const box = document.createElement('div');
  box.className = 'tbox';
  box.style.left = '120px';
  box.style.top = `${Math.round(viewTop() + 140)}px`;
  box.style.width = '320px';
  const body = document.createElement('div');
  body.className = 'tbox-body';
  body.innerHTML = '<br>';
  box.append(body);
  el.editor.append(box);
  prepareBoxes();
  body.focus();
  onEditorChanged();
  showBoxHandle(box);
}

let handleBox = null;
function showBoxHandle(box) {
  handleBox = box;
  const h = el.tboxHandle;
  h.hidden = false;
  h.style.left = `${el.editor.offsetLeft + box.offsetLeft}px`;
  h.style.top = `${box.offsetTop - 34}px`;
}
function hideBoxHandle() {
  handleBox = null;
  el.tboxHandle.hidden = true;
}
el.editor.addEventListener('pointerover', (e) => {
  const box = e.target.closest('.tbox');
  if (box && box !== handleBox) showBoxHandle(box);
});
el.editor.addEventListener('focusin', (e) => {
  const box = e.target.closest('.tbox');
  if (box) showBoxHandle(box);
});
// An emptied text box disappears when you leave it.
el.editor.addEventListener('focusout', (e) => {
  const box = e.target.closest && e.target.closest('.tbox');
  if (!box || box.contains(e.relatedTarget) || el.tboxHandle.contains(e.relatedTarget)) return;
  if (!box.textContent.trim() && !box.querySelector('img')) {
    box.remove();
    hideBoxHandle();
    onEditorChanged();
  }
});
// The browser's resize handle sets a height too; text boxes grow with their text instead.
el.editor.addEventListener('mouseup', () => {
  for (const b of el.editor.querySelectorAll('.tbox')) {
    if (b.style.height) {
      b.style.height = '';
      onEditorChanged();
    }
  }
});
el.tboxHandle.querySelector('.del').addEventListener('click', () => {
  if (!handleBox) return;
  handleBox.remove();
  hideBoxHandle();
  onEditorChanged();
});
el.tboxHandle.querySelector('.grip').addEventListener('pointerdown', (e) => {
  if (!handleBox) return;
  e.preventDefault();
  const box = handleBox;
  const k = sheetScale().k;
  const start = { x: e.clientX, y: e.clientY, left: box.offsetLeft, top: box.offsetTop };
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const move = (ev) => {
    box.style.left = `${Math.round(start.left + (ev.clientX - start.x) * k)}px`;
    box.style.top = `${Math.max(0, Math.round(start.top + (ev.clientY - start.y) * k))}px`;
    showBoxHandle(box);
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    onEditorChanged();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

