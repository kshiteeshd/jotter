// ---------- Covers ----------

let pickedCover = null;

function selectCover(id) {
  pickedCover = id;
  $('cover-grid')
    .querySelectorAll('.cover-opt')
    .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
}

function buildCoverGrid() {
  const grid = $('cover-grid');
  if (grid.childElementCount) return;
  let group = null;
  for (const c of Covers.list) {
    if (c.group !== group) {
      group = c.group;
      const h = document.createElement('div');
      h.className = 'cover-group';
      h.textContent = group;
      grid.append(h);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cover-opt';
    b.dataset.id = c.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${c.name}, ${c.note}`);
    b.title = `${c.name}: ${c.note}`;
    b.insertAdjacentHTML('afterbegin', Covers.svg(c.id));
    const name = document.createElement('span');
    name.textContent = c.name;
    const note = document.createElement('small');
    note.textContent = c.note;
    b.append(name, note);
    grid.append(b);
  }
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.cover-opt');
    if (b) selectCover(b.dataset.id);
  });
  grid.addEventListener('dblclick', (e) => {
    if (e.target.closest('.cover-opt')) $('cover-ok').click();
  });
  $('cover-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('cover-ok').click();
    }
  });
}

// Ask for a cover (and optionally a name). Resolves to { cover, name }, or null when cancelled.
function pickCover({ title, ok, askName, cover, placeholder = 'Untitled' }) {
  buildCoverGrid();
  const dlg = $('cover-dialog');
  $('cover-title').textContent = title;
  $('cover-ok').textContent = ok;
  $('cover-name-row').hidden = !askName;
  $('cover-name').value = '';
  $('cover-name').placeholder = placeholder;
  selectCover(cover || state.settings.defaultCover || Covers.ids[0]);
  return new Promise((resolve) => {
    dlg.returnValue = '';
    dlg.addEventListener(
      'close',
      () => {
        const name = $('cover-name').value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '');
        resolve(dlg.returnValue === 'ok' ? { cover: pickedCover, name } : null);
      },
      { once: true }
    );
    dlg.showModal();
    (askName ? $('cover-name') : dlg.querySelector('.cover-opt[aria-checked="true"]')).focus();
  });
}

