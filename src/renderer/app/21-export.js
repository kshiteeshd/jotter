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
    return { sheets, paper: p.paper, html: Model.sanitizeHtml(p.html), ink, scale, offsetX };
  });
}

/*
  Which pages go into a PDF or a print-out. When the pages mix A4 pages and infinite pages, you choose
  whether the infinite ones come along (trimmed to their content and cut into A4 sheets) or only the
  proper A4 pages are exported. Returns null when cancelled.
*/
async function pagesToExport(all = Model.allPages(state.nb)) {
  const infinite = all.filter((p) => p.mode === 'infinite').length;
  const paged = all.length - infinite;
  if (!infinite || !paged) return all;
  const r = await ask({
    message: `Include the ${plural(infinite, 'infinite page')}?`,
    detail: `There ${paged === 1 ? 'is' : 'are'} ${plural(paged, 'A4 page')} and ${plural(infinite, 'infinite page')}. Infinite pages are trimmed to what is on them and cut into A4 sheets.`,
    buttons: ['A4 pages only', 'Include infinite pages', 'Cancel'],
    cancelId: 2,
  });
  if (r === 0) return all.filter((p) => p.mode !== 'infinite');
  if (r === 1) return all;
  return null;
}

// The look of exported pages: plain white, or the notebook's own paper colour and texture.
async function exportLook() {
  const nb = state.nb;
  const texture = nb.paperTexture || 'none';
  if (nb.paperColor === 'white' && texture === 'none') return { background: Model.PAPER_COLORS.white, texture: 'none' };
  const r = await ask({
    message: 'Which background should the PDF have?',
    detail: 'White prints cleanly. The paper keeps the PDF looking like the notebook on screen. Lines are included either way.',
    buttons: ['White', texture === 'none' ? 'Paper colour' : 'Paper colour and texture', 'Cancel'],
    cancelId: 2,
  });
  if (r === 0) return { background: Model.PAPER_COLORS.white, texture: 'none' };
  if (r === 1) return { background: Model.paperHex(nb.paperColor), texture };
  return null;
}

const fileName = (name) => name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

// Export as PDF: the whole notebook in one file, each section in a file of its own, or this section.
async function exportPdf() {
  commitEditor();
  const nb = state.nb;
  let scope = 'all';
  if (nb.sections.length > 1) {
    const r = await ask({
      message: 'What should the PDF include?',
      detail: `This notebook has ${plural(nb.sections.length, 'section')}. Each section can also be its own PDF, all saved together in a folder you choose.`,
      buttons: ['Whole notebook', 'Each section as its own PDF', `This section only`, 'Cancel'],
      cancelId: 3,
    });
    if (r !== 0 && r !== 1 && r !== 2) return;
    scope = ['all', 'each', 'this'][r];
  }
  const list = await pagesToExport(scope === 'this' ? section().pages.slice() : Model.allPages(nb));
  if (!list) return;
  const look = await exportLook();
  if (!look) return;
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
  if (!list.length) return flash('Nothing to export: this section has only infinite pages.');
  flash('Exporting PDF…');
  const name = scope === 'this' ? fileName(`${notebookName()} - ${section().title}`) : notebookName();
  const res = await api.exportPdf({ pages: exportPayload(list), suggestedName: name, ...look });
  if (!res) return flash('');
  if (res.error) return showError(res.error);
  flash(`PDF exported to ${res.path}`);
}

async function exportPng() {
  commitEditor();
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
  commitEditor();
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

async function printNotebook() {
  commitEditor();
  const list = await pagesToExport();
  if (!list) return;
  flash('Preparing to print…');
  const res = await api.print({ pages: exportPayload(list), background: Model.PAPER_COLORS.white });
  flash('');
  if (res && res.error) await showError(res.error);
}

