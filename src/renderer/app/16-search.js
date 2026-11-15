// ---------- Search ----------

function openSearch() {
  commitEditor();
  openPopover(el.searchPanel, $('btn-search'), 'left', $('btn-search'));
  el.searchInput.focus();
  el.searchInput.select();
  runSearch();
}

function marked(text, query) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  let i = 0;
  let at = lower.indexOf(query);
  while (at >= 0) {
    frag.append(text.slice(i, at));
    const m = document.createElement('mark');
    m.textContent = text.slice(at, at + query.length);
    frag.append(m);
    i = at + query.length;
    at = lower.indexOf(query, i);
  }
  frag.append(text.slice(i));
  return frag;
}

function runSearch() {
  const box = el.searchResults;
  box.textContent = '';
  const q = el.searchInput.value.trim().toLowerCase();
  if (!q) return;
  let count = 0;
  state.nb.sections.forEach((sec, si) =>
    sec.pages.forEach((p, pi) => {
      if (count >= 60) return;
      const text = Model.pageText(p);
      const at = text.toLowerCase().indexOf(q);
      if (at < 0 && !p.title.toLowerCase().includes(q)) return;
      count++;
      const b = document.createElement('button');
      b.className = 'result';
      b.setAttribute('role', 'option');
      const where = document.createElement('div');
      where.className = 'where';
      const dye = document.createElement('span');
      dye.className = 'dye';
      dye.style.background = sec.color;
      const title = document.createElement('span');
      title.append(marked(p.title, q));
      const small = document.createElement('small');
      small.textContent = sec.title;
      where.append(dye, title, small);
      b.append(where);
      if (at >= 0) {
        const start = Math.max(0, at - 40);
        const snippet = document.createElement('div');
        snippet.className = 'snippet';
        snippet.append(marked(`${start ? '…' : ''}${text.slice(start, at + 80).replace(/\n/g, ' ')}`, q));
        b.append(snippet);
      }
      b.addEventListener('click', () => goToResult(si, pi, q));
      box.append(b);
    })
  );
  if (!count) {
    const none = document.createElement('div');
    none.className = 'no-results';
    none.textContent = 'No pages match.';
    box.append(none);
  }
}

function goToResult(si, pi, q) {
  closePopovers();
  if (si !== state.secIdx) showSection(si, pi);
  else showPage(pi);
  highlightMatches(q);
}

// Highlight every match on the open page and bring the first into view.
function highlightMatches(q) {
  if (!CSS.highlights || !q) return;
  const ranges = [];
  const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.toLowerCase();
    for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) {
      const r = new Range();
      r.setStart(n, at);
      r.setEnd(n, at + q.length);
      ranges.push(r);
    }
  }
  CSS.highlights.set('search', new Highlight(...ranges));
  if (ranges.length) {
    const r = ranges[0].getBoundingClientRect();
    el.workspace.scrollTop += r.top - el.workspace.getBoundingClientRect().top - 140;
  }
}

el.searchInput.addEventListener('input', runSearch);
el.searchInput.addEventListener('keydown', (e) => {
  const results = [...el.searchResults.querySelectorAll('.result')];
  if (e.key === 'Enter' && results[0]) results[0].click();
  if (e.key === 'ArrowDown' && results[0]) {
    e.preventDefault();
    results[0].focus();
  }
});
el.searchResults.addEventListener('keydown', (e) => {
  const results = [...el.searchResults.querySelectorAll('.result')];
  const i = results.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && results[i + 1]) results[i + 1].focus();
  if (e.key === 'ArrowUp') (i > 0 ? results[i - 1] : el.searchInput).focus();
  if (['ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
});

