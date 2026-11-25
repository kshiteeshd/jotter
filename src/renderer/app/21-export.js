// ---------- Export and print ----------

// Pages as sheets for printing: text, lines, and the ink of each sheet as vector graphics.
function exportPayload(list) {
  return list.map((p) => {
    let sheets = p.sheets;
    let scale = 1;
    let offsetX = 0;
    if (p.mode === 'infinite') {
      // Trim to the content and scale down when ink lies outside the text column.
      let minX = 0;
      let maxX = W;
      for (const s of p.strokes) {
        const b = Ink.box(s);
        minX = Math.min(minX, b.minX - b.pad - 12);
        maxX = Math.max(maxX, b.maxX + b.pad + 12);
      }
      scale = W / (maxX - minX);
      offsetX = minX;
      el.measure.dataset.paper = p.paper;
      el.measure.innerHTML = p.html;
      sheets = Math.max(1, Math.ceil(((contentBottom(p, el.measure) + 40) * scale) / H));
    }
    const span = H / scale;
    const ink = [];
    for (let i = 0; i < sheets; i++) {
      const strokes = p.strokes.filter((s) => {
        const b = Ink.box(s);
        return b.maxY + b.pad >= i * span && b.minY - b.pad <= (i + 1) * span;
      });
      ink.push(
        strokes.length
          ? `<svg xmlns="http://www.w3.org/2000/svg" class="pdf-ink" viewBox="${offsetX} ${i * span} ${W / scale} ${span}">${strokes.map(Ink.strokeSvg).join('')}</svg>`
          : null
      );
    }
    el.measure.textContent = '';
    return { sheets, paper: p.paper, html: Model.Images.inline(Model.sanitizeHtml(p.html)), ink, scale, offsetX };
  });
}

/*
  Export: one dialog with every choice in view, instead of a question after a question. The format (PDF,
  page image, Markdown, print), what to include, whether infinite pages come along and the background are
  all there at once; only the choices that apply are shown, and each is remembered for next time.
*/
const fileName = (name) => name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

const exportUi = { format: 'pdf', scope: 'all', infinite: 'paged', look: 'white', section: null, resolve: null };

// A list of radio cards: [{ value, title, note }].
function renderOptions(id, items, value, onPick) {
  const box = $(id);
  box.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(it.value === value));
    b.dataset.value = it.value;
    const t = document.createElement('span');
    t.className = 'option-title';
    t.textContent = it.title;
    b.append(t);
    if (it.note) {
      const n = document.createElement('small');
      n.textContent = it.note;
      b.append(n);
    }
    b.addEventListener('click', () => onPick(it.value));
    box.append(b);
  }
}

// The pages a choice covers.
function exportPages(scope = exportUi.scope) {
  const nb = state.nb;
  if (exportUi.format === 'png') return [page()];
  if (scope === 'section') return nb.sections[exportUi.section ?? state.secIdx].pages.slice();
  return Model.allPages(nb);
}

function syncExportDialog() {
  const nb = state.nb;
  const f = exportUi.format;
  setSeg('export-format', f);
  const sec = nb.sections[exportUi.section ?? state.secIdx];
  // What to include: PDFs of the whole notebook, of each section, or of one section.
  const scopes =
    f === 'pdf'
      ? [
          { value: 'all', title: 'Whole notebook', note: 'One PDF with every section' },
          ...(nb.sections.length > 1 ? [{ value: 'each', title: 'Each section as its own PDF', note: 'Saved together in a folder you choose' }] : []),
          ...(nb.sections.length > 1 || exportUi.section !== null ? [{ value: 'section', title: 'This section only', note: `Only “${sec.title}”` }] : []),
        ]
      : [];
  if (!scopes.some((s) => s.value === exportUi.scope)) exportUi.scope = scopes[0] ? scopes[0].value : 'all';
  $('export-scope-row').hidden = scopes.length < 2;
  renderOptions('export-scope', scopes, exportUi.scope, (v) => ((exportUi.scope = v), syncExportDialog()));
  // Infinite pages, when the pages mix A4 and infinite ones.
  const list = exportPages();
  const infinite = list.filter((p) => p.mode === 'infinite').length;
  const mixed = (f === 'pdf' || f === 'print') && infinite > 0 && infinite < list.length;
  $('export-infinite-row').hidden = !mixed;
  renderOptions(
    'export-infinite',
    [
      { value: 'paged', title: 'A4 pages only', note: `Leave out ${plural(infinite, 'infinite page')}` },
      { value: 'all', title: 'Include infinite pages', note: 'Trimmed to what is on them and cut into A4 sheets' },
    ],
    exportUi.infinite,
    (v) => ((exportUi.infinite = v), syncExportDialog())
  );
  // Background, for a coloured or textured paper.
  const texture = nb.paperTexture || 'none';
  const plain = nb.paperColor === 'white' && texture === 'none';
  $('export-look-row').hidden = f !== 'pdf' || plain;
  renderOptions(
    'export-look',
    [
      { value: 'white', title: 'White', note: 'Prints cleanly' },
      { value: 'paper', title: texture === 'none' ? 'Paper colour' : 'Paper colour and texture', note: 'Looks like the notebook on screen' },
    ],
    exportUi.look,
    (v) => ((exportUi.look = v), syncExportDialog())
  );
  const what = { pdf: 'A PDF, with ink as sharp vector lines.', png: `An image of “${page().title}”, with the paper's look.`, md: 'The notebook’s text as Markdown. Ink and pictures are left out.', print: 'Print the notebook on A4.' }[f];
  $('export-sub').textContent = what;
  $('export-go').textContent = f === 'print' ? 'Print…' : 'Export…';
}

bindSeg('export-format', (v) => {
  exportUi.format = v;
  syncExportDialog();
});
$('export-cancel').addEventListener('click', () => $('export-dialog').close());
$('export-go').addEventListener('click', () => {
  exportUi.go = true;
  $('export-dialog').close();
});

// Open the export dialog. `format` picks the format; `section` (an index) fixes "This section" to it.
async function openExport({ format, section = null } = {}) {
  if (!state.nb) return;
  commitEditor();
  closePopovers();
  const prefs = state.settings.exportPrefs || {};
  Object.assign(exportUi, {
    format: format || (['pdf', 'png', 'md', 'print'].includes(prefs.format) ? prefs.format : 'pdf'),
    scope: section !== null ? 'section' : ['all', 'each', 'section'].includes(prefs.scope) ? prefs.scope : 'all',
    infinite: prefs.infinite === 'all' ? 'all' : 'paged',
    look: prefs.look === 'paper' ? 'paper' : 'white',
    section,
    go: false,
  });
  syncExportDialog();
  const dlg = $('export-dialog');
  await new Promise((resolve) => {
    dlg.addEventListener('close', resolve, { once: true });
    dlg.showModal();
    $('export-go').focus();
  });
  if (!exportUi.go) return;
  const { format: f, scope, infinite, look } = exportUi;
  state.settings.exportPrefs = { format: f, scope: section !== null ? prefs.scope || 'all' : scope, infinite, look };
  api.setSettings({ exportPrefs: state.settings.exportPrefs });
  if (f === 'png') return exportPng();
  if (f === 'md') return exportMarkdown();
  let list = exportPages();
  if (infinite === 'paged' && list.some((p) => p.mode !== 'infinite')) list = list.filter((p) => p.mode !== 'infinite');
  if (f === 'print') return printNotebook(list);
  const nb = state.nb;
  const background = look === 'paper' ? { background: Model.paperHex(nb.paperColor), texture: nb.paperTexture || 'none' } : { background: Model.PAPER_COLORS.white, texture: 'none' };
  return exportPdf(scope, list, background);
}

async function exportPdf(scope, list, look) {
  const nb = state.nb;
  if (scope === 'each') {
    const kept = new Set(list);
    const files = nb.sections
      .map((s) => ({ name: fileName(`${notebookName()} - ${s.title}`), pages: s.pages.filter((p) => kept.has(p)) }))
      .filter((f) => f.pages.length)
      .map((f) => ({ name: f.name, pages: exportPayload(f.pages) }));
    if (!files.length) return flash('Nothing to export: these sections have only infinite pages.');
    flash('Exporting PDFs…');
    const res = await api.exportPdfs({ files, ...look });
    if (!res) return flash('');
    if (res.error) return showError(res.error);
    return flash(`${plural(res.count, 'PDF')} exported to ${res.folder}`);
  }
  if (!list.length) return flash('Nothing to export: these are all infinite pages. Choose “Include infinite pages”.');
  flash('Exporting PDF…');
  const sec = nb.sections[exportUi.section ?? state.secIdx];
  const name = scope === 'section' ? fileName(`${notebookName()} - ${sec.title}`) : notebookName();
  const res = await api.exportPdf({ pages: exportPayload(list), suggestedName: name, ...look });
  if (!res) return flash('');
  if (res.error) return showError(res.error);
  flash(`PDF exported to ${res.path}`);
}

async function exportPng() {
  const res = await api.exportPng({
    pages: exportPayload([page()]),
    suggestedName: fileName(`${notebookName()} - ${page().title}`),
    background: Model.paperHex(state.nb.paperColor),
    texture: state.nb.paperTexture || 'none',
  });
  if (!res) return;
  if (res.error) return showError(res.error);
  flash(res.count > 1 ? `Exported ${res.count} images next to ${res.path}` : `Image exported to ${res.path}`);
}

async function exportMarkdown() {
  const parts = [`# ${notebookName()}`];
  for (const s of state.nb.sections) {
    parts.push(`## ${s.title}`);
    for (const p of s.pages) {
      parts.push(`### ${p.title}`);
      const md = Model.toMarkdown(p);
      if (md) parts.push(md);
    }
  }
  const res = await api.exportText({ text: `${parts.join('\n\n')}\n`, suggestedName: notebookName() });
  if (!res) return;
  if (res.error) return showError(res.error);
  flash(`Markdown exported to ${res.path}`);
}

async function printNotebook(list) {
  if (!list.length) return flash('Nothing to print: these are all infinite pages. Choose “Include infinite pages”.');
  flash('Preparing to print…');
  const res = await api.print({ pages: exportPayload(list), background: Model.PAPER_COLORS.white });
  flash('');
  if (res && res.error) await showError(res.error);
}
