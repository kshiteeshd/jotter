// ---------- Home ----------

const icon = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;

function hashIndex(text, n) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}
// Notebooks without a stored cover get a stable one chosen from their name.
const coverFor = (r) => (Covers.ids.includes(r.cover) ? r.cover : Covers.ids[hashIndex(r.name, Covers.ids.length)]);

function showLibrary(dir) {
  $('library-path').textContent = dir;
  $('set-library').textContent = dir;
  $('set-library').title = dir;
}

async function trashNotebook(r) {
  if (r.path === state.path) return showError('This notebook is open.\nOpen a different notebook first, then delete this one.');
  const a = await ask({
    message: `Delete “${r.name}”?`,
    detail: 'It goes to the Recycle Bin, so you can restore it from there.',
    buttons: ['Delete', 'Cancel'],
    danger: true,
  });
  if (a !== 0) return;
  const res = await api.trashNotebook(r.path);
  if (res.error) return showError(res.error);
  renderHome(res.list);
  flash(`Moved “${r.name}” to the Recycle Bin`);
}

// The home screen: a greeting, one-click starts, the notebook you were last in, and your shelf.
let homeList = [];
let shelfSort = 'recent';
const STARTER_COVERS = ['kolam', 'botanical', 'bauhaus', 'night', 'blockprint', 'mountains', 'terrazzo'];

function renderHome(recents) {
  homeList = recents;
  api.libraryInfo().then((info) => showLibrary(info.dir));

  const now = new Date();
  const h = now.getHours();
  $('home-greeting').textContent = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('home-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const live = recents.filter((r) => !r.missing);
  $('home-sub').textContent = live.length
    ? `${plural(live.length, 'notebook')} · ${plural(live.reduce((n, r) => n + (r.pages || 0), 0), 'page')}, all saved automatically.`
    : 'Pick a cover below and start writing.';
  buildFan(live.slice(0, 3).map(coverFor));
  buildStarters();
  renderContinue(live[0]);

  const pinned = recents.filter((r) => r.pinned);
  const pinnedSec = $('home-pinned');
  pinnedSec.querySelector('.cards').replaceChildren(...pinned.map(makeCard));
  pinnedSec.hidden = !pinned.length;
  renderShelf();
}

// Your notebooks, filtered by the search box and sorted by recent use or name.
function renderShelf() {
  const q = $('shelf-search').value.trim().toLowerCase();
  let items = homeList.filter((r) => !r.pinned);
  if (q) items = items.filter((r) => r.name.toLowerCase().includes(q));
  items.sort(shelfSort === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) : (a, b) => b.lastOpened - a.lastOpened);
  const sec = $('home-recent');
  sec.querySelector('.cards').replaceChildren(...items.map(makeCard));
  $('nb-count').textContent = homeList.length ? homeList.length : '';
  sec.querySelector('.empty:not(.no-match)').hidden = homeList.length > 0;
  sec.querySelector('.no-match').hidden = !(homeList.length && q && !items.length);
  sec.querySelector('.shelf-tools').hidden = homeList.length < 2;
  setSeg('shelf-sort', shelfSort);
}
$('shelf-search').addEventListener('input', renderShelf);
bindSeg('shelf-sort', (v) => {
  shelfSort = v;
  renderShelf();
});

function buildFan(ids) {
  const fan = document.querySelector('.fan');
  const want = [...ids, 'kolam', 'mountains', 'bauhaus'].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  if (fan.dataset.covers === want.join()) return;
  fan.dataset.covers = want.join();
  fan.replaceChildren(
    ...want.map((id) => {
      const d = document.createElement('div');
      d.innerHTML = Covers.svg(id);
      return d;
    })
  );
}

// One click on a cover starts a notebook with it; the first tile opens the full cover choice.
function buildStarters() {
  const row = $('starters');
  if (row.childElementCount) return;
  const more = document.createElement('button');
  more.className = 'starter more';
  more.innerHTML = `<span class="starter-cover">${icon('i-plus')}</span><span>All covers…</span>`;
  more.addEventListener('click', () => run('new'));
  row.append(more);
  for (const id of STARTER_COVERS) {
    const c = Covers.get(id);
    const b = document.createElement('button');
    b.className = 'starter';
    b.title = `New notebook with the ${c.name} cover`;
    b.innerHTML = `<span class="starter-cover">${Covers.svg(id)}</span>`;
    const name = document.createElement('span');
    name.textContent = c.name;
    b.append(name);
    b.addEventListener('click', () => run('quick-new', () => createNotebook(id)));
    row.append(b);
  }
}

// The notebook you were last in, large, with its sections.
function renderContinue(r) {
  const sec = $('home-continue');
  sec.hidden = !r;
  if (!r) return;
  const card = $('continue-card');
  card.replaceChildren();
  card.setAttribute('aria-label', `Continue ${r.name}`);
  const cover = document.createElement('div');
  cover.className = 'continue-cover';
  cover.innerHTML = Covers.svg(coverFor(r));
  const body = document.createElement('div');
  body.className = 'continue-body';
  const name = document.createElement('div');
  name.className = 'continue-name';
  name.textContent = r.name;
  const meta = document.createElement('div');
  meta.className = 'continue-meta';
  const sections = r.sections || [];
  meta.textContent = [`Edited ${timeAgo(r.modified || r.lastOpened)}`, plural(r.pages, 'page'), sections.length > 1 ? `${sections.length} sections` : '']
    .filter(Boolean)
    .join(' · ');
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const s of sections.slice(0, 5)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const dye = document.createElement('span');
    dye.className = 'dye';
    dye.style.background = s.color;
    chip.append(dye, s.title);
    chips.append(chip);
  }
  if (sections.length > 5) {
    const more = document.createElement('span');
    more.className = 'chip';
    more.textContent = `+${sections.length - 5} more`;
    chips.append(more);
  }
  const go = document.createElement('span');
  go.className = 'big primary';
  go.textContent = r.path === state.path && state.nb ? 'Back to notebook' : 'Continue';
  body.append(name, meta, chips, go);
  card.append(cover, body);
  card.onclick = () => run('open', () => openRecent(r));
  card.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.onclick();
    }
  };
}

function cardAction(iconId, title, onClick, pressed) {
  const b = document.createElement('button');
  b.innerHTML = icon(iconId);
  b.title = title;
  b.setAttribute('aria-label', title);
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function makeCard(r) {
  const card = document.createElement('div');
  card.className = `card${r.missing ? ' missing' : ''}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Open notebook ${r.name}`);

  const cover = document.createElement('div');
  cover.className = 'cover';
  cover.innerHTML = Covers.svg(coverFor(r));
  const label = document.createElement('div');
  label.className = 'label';
  const name = document.createElement('span');
  name.textContent = r.name;
  label.append(name);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    cardAction('i-pin', r.pinned ? 'Unpin' : 'Pin to the top', async () => renderHome(await api.pinRecent(r.path, !r.pinned)), !!r.pinned),
    cardAction('i-window', 'Open in a new window', () => api.newWindow(r.path)),
    r.library
      ? cardAction('i-trash', 'Delete notebook', () => run('trash', () => trashNotebook(r)))
      : cardAction('i-close', 'Remove from this list (the file is kept)', async () => renderHome(await api.removeRecent(r.path)))
  );
  cover.append(label, actions);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.title = r.path;
  meta.textContent = r.missing ? 'File not found' : `${plural(r.pages, 'page')} · ${timeAgo(r.lastOpened)}`;

  card.append(cover, meta);
  const open = () => run('open', () => openRecent(r));
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  });
  return card;
}

async function openRecent(r) {
  if (r.path === state.path && state.nb) return showEditor();
  if (r.missing) {
    const a = await ask({
      message: `“${r.name}” could not be found.`,
      detail: `It may have been moved, renamed or deleted.\n${r.path}`,
      buttons: ['Remove from list', 'Cancel'],
    });
    if (a === 0) renderHome(await api.removeRecent(r.path));
    return;
  }
  if (await leaveNotebook()) await loadFile(await api.readNotebook(r.path));
}

function touchRecent() {
  if (!state.nb || !state.path) return;
  api.touchRecent({ path: state.path, pages: totalPages(), cover: state.nb.cover });
}

// The open page's row follows its title as you type.
function refreshActiveThumb() {
  clearTimeout(thumbTimer);
  const title = el.pageList.children[state.pageIdx]?.querySelector('.title');
  if (title && state.nb) title.textContent = page().title;
}

