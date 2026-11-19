// End-to-end tests: the real app, driven with real mouse and keyboard input.
//   npx electron test/app.e2e.js            run every group
//   npx electron test/app.e2e.js undo ink   run only groups whose names contain these words
// Set JOTTER_SHOTS=<folder> to also save a screenshot after each group, JOTTER_VERBOSE=1 to list every check.
const { app, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- A private profile and notebooks folder; the real ones are never touched ----------
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jotter-test-'));
const profile = path.join(root, 'profile');
const library = path.join(root, 'library');
const outFiles = { pdf: path.join(root, 'out.pdf'), png: path.join(root, 'out.png'), md: path.join(root, 'out.md'), ntb: path.join(root, 'copy.ntb') };
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ libraryDir: library, welcomed: true }));
app.setPath('userData', profile);
dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: outFiles[o.filters[0].extensions[0]] });
let nextOpen = null; // the file the next Open… picks
dialog.showOpenDialog = async () => (nextOpen ? { canceled: false, filePaths: [nextOpen] } : { canceled: true, filePaths: [] });
dialog.showMessageBox = async (_w, o) => {
  report(false, 'no unexpected system dialogs', o.message);
  return { response: o.cancelId ?? 0 };
};
shell.openPath = async () => '';
require('../src/main.js');

// ---------- A small test runner ----------
const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
const shots = process.env.JOTTER_SHOTS;
const groups = [];
const group = (name, fn) => groups.push({ name, fn });
let passed = 0;
let failed = 0;
let groupName = '';
function report(ok, name, detail = '') {
  if (ok) passed++;
  else failed++;
  if (ok && process.env.JOTTER_VERBOSE) console.log(`  ok   ${groupName} › ${name}`);
  if (!ok) console.log(`  FAIL ${groupName} › ${name}${detail !== '' ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}
const check = (name, ok, detail) => report(!!ok, name, ok ? '' : detail);
const equal = (name, got, want) => report(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let win;
let wc;
const js = (code) => wc.executeJavaScript(code, true);
async function until(code, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (await js(code)) return true;
  return false;
}
const frame = () => js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))');

// Real input
function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
const undoKey = () => key('Z', ['control']);
const redoKey = () => key('Y', ['control']);
async function typeText(text) {
  await js(`(el.editor.focus(), 0)`);
  wc.insertText(text);
  await frame();
}
// Draw with the mouse; points are in page units from the top-left of the text column.
async function drag(points, modifiers = []) {
  const at = await js(`(() => { const s = sheetScale(); return { x: s.rect.left, y: s.rect.top, k: s.k }; })()`);
  const xy = ([x, y]) => ({ x: Math.round(at.x + x / at.k), y: Math.round(at.y + y / at.k), modifiers });
  // Each step waits for the app to have it: the pen down, every move, then the pen up.
  await until('!current && !selDrag');
  wc.sendInputEvent({ type: 'mouseMove', ...xy(points[0]) });
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...xy(points[0]) });
  await until('!!(current || selDrag)', 1000);
  for (const p of points.slice(1)) {
    wc.sendInputEvent({ type: 'mouseMove', button: 'left', ...xy(p) });
    await sleep(4);
  }
  await frame();
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...xy(points.at(-1)) });
  await until('!current && !selDrag');
  await frame();
}
const wave = (y = 300, x0 = 100, x1 = 500) => Array.from({ length: 24 }, (_, i) => [x0 + ((x1 - x0) * i) / 23, y + Math.sin(i / 3) * 30]);
async function click(selector) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!r) throw new Error(`nothing matches ${selector}`);
  wc.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(r.x), y: Math.round(r.y) });
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(r.x), y: Math.round(r.y) });
  await frame();
}
// Answer the in-app question dialog.
async function answer(label, input) {
  const ready = await until(`document.getElementById('ask').open`);
  if (!ready) throw new Error(`no dialog for "${label}"`);
  const ok = await js(`(() => {
    ${input != null ? `document.getElementById('ask-input').value = ${JSON.stringify(input)};` : ''}
    const b = [...document.querySelectorAll('#ask-buttons button')].find((b) => b.textContent === ${JSON.stringify(label)});
    if (b) b.click();
    return !!b;
  })()`);
  if (!ok) throw new Error(`no "${label}" button`);
  await until(`!document.getElementById('ask').open && !busy`);
}
// A fresh notebook for a group of tests.
async function fresh(name) {
  await js(`(async () => { await createNotebook('kolam', ${JSON.stringify(name)}); setTool('text'); })()`);
  await until('state.nb && !state.saving');
}
const strokes = () => js('page().strokes.length');
const text = () => js('(commitEditor(), Model.pageText(page()))');
const where = () => js('[state.secIdx, state.pageIdx]');

// =====================================================================================================
group('home and new notebooks', async () => {
  check('starts on the home screen', await js(`state.view === 'home'`));
  check('home shows the notebooks folder', (await js(`document.getElementById('library-path').textContent`)).includes(library));
  await js(`run('quick-new', () => createNotebook('botanical')); 0`);
  check('one click makes "Book 1" in the notebooks folder', await until(`state.view === 'editor' && notebookName() === 'Book 1'`));
  check('…and saves it at once', await until(`!state.saving`) && fs.existsSync(path.join(library, 'Book 1.ntb')));
  await fresh('');
  equal('the next one is "Book 2"', await js('notebookName()'), 'Book 2');
  await js(`run('rename', () => renameNotebook('Renamed'))`);
  check('renaming moves the file', fs.existsSync(path.join(library, 'Renamed.ntb')) && !fs.existsSync(path.join(library, 'Book 2.ntb')));
  equal('the window title follows', win.getTitle(), 'Renamed — Jotter');
  await js('showHome()');
  check('home lists both notebooks', await until(`document.querySelectorAll('#home .card').length >= 2`));
  await js(`document.getElementById('shelf-search').value = 'renam'; renderShelf(); 0`);
  equal('the shelf search filters', await js(`[...document.querySelectorAll('#home-recent .card')].length`), 1);
  await js(`document.getElementById('shelf-search').value = ''; renderShelf(); 0`);
  await js(`document.querySelector('#home-recent .card .actions button').click(); 0`);
  check('pinning moves a notebook to Pinned', await until(`!document.getElementById('home-pinned').hidden && document.querySelectorAll('#home-pinned .card').length === 1`));
});

group('typing and formatting', async () => {
  await fresh('Text');
  await typeText('Hello world');
  equal('typed text reaches the page', await text(), 'Hello world');
  await js(`document.execCommand('selectAll'); format('bold'); 0`);
  check('bold', /<b>|font-weight: ?(bold|700)/.test(await js('el.editor.innerHTML')));
  await js(`el.editor.focus(); document.getSelection().collapse(el.editor, el.editor.childNodes.length); insertChecklist(); 0`);
  wc.insertText('Buy paper');
  await frame();
  check('checklist', await js(`!!el.editor.querySelector('ul.checklist li')`));
  await js(`insertTable(2, 2); 0`);
  equal('table', await js(`el.editor.querySelectorAll('table td').length`), 4);
  await js(`run('insert-link'); 0`);
  await answer('Add link', 'example.com');
  check('link, made safe', await js(`!!el.editor.querySelector('a[href="https://example.com"]')`));
  await js(`(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; const blob = await new Promise((r) => c.toBlob(r)); await insertImageFile(new File([blob], 'a.png', { type: 'image/png' })); })()`);
  check('image', await js(`!!el.editor.querySelector('img[src^="data:image/"]')`));
  await js(`insertTextBox(); 0`);
  check('text box', await js(`!!el.editor.querySelector('.tbox .tbox-body')`));
  await js(`el.editor.focus(); document.execCommand('insertHTML', false, '<img src="x" onerror="window.__x = 1"><a href="javascript:alert(1)">bad</a>'); onEditorChanged(); 0`);
  const saved = await js('(commitEditor(), Model.sanitizeHtml(page().html))');
  check('pasted handlers and javascript: links are removed when the page is stored', !/onerror|javascript:/i.test(saved), saved);
});

group('ink tools', async () => {
  await fresh('Ink');
  await js(`setTool('pen'); 0`);
  await drag(wave(200));
  equal('a pen stroke', await strokes(), 1);
  const s = await js('page().strokes[0]');
  check('pen strokes taper and are steadied', s.taper === 1 && s.points.length >= 8, s);
  check('the stroke starts exactly where the pen touched down', Math.abs(s.points[0] - 100) < 1.5 && Math.abs(s.points[1] - 200) < 1.5, s.points.slice(0, 2));
  await js(`setTool('marker'); 0`);
  await drag(wave(320));
  equal('a marker stroke', await js(`page().strokes.at(-1).tool`), 'marker');
  await js(`setTool('pen'); 0`);
  await drag([[100, 450], [200, 470], [300, 452]], ['shift']);
  equal('Shift draws a straight line', await js(`page().strokes.at(-1).points.length`), 4);
  await js(`setTool('shape'); state.tools.shape.kind = 'rect'; 0`);
  await drag([[400, 500], [500, 600]]);
  check('a shape', await js(`page().strokes.at(-1).flat === 1`));
  const before = await strokes();
  await js(`setTool('eraser'); applySettings({ eraserMode: 'rub' }); 0`);
  await drag([[300, 150], [300, 260]]);
  check('rubbing out splits a stroke', (await strokes()) > before);
  await js(`applySettings({ eraserMode: 'stroke' }); 0`);
  const n = await strokes();
  await drag([[450, 480], [450, 520]]);
  check('the whole-stroke eraser removes strokes', (await strokes()) < n);
  await js(`setTool('select'); 0`);
  await drag([[50, 400], [560, 400], [560, 490], [50, 490], [50, 400]]);
  check('the lasso selects ink', await js(`!!selection && selection.strokes.length >= 1`));
  if (!(await js('!!selection'))) throw new Error('nothing was selected, so the selection checks cannot run');
  const sel = await js('selection.strokes.length');
  const m = await strokes();
  await js(`copySelection(); pasteInk(); 0`);
  equal('copy and paste', await strokes(), m + sel);
  await js(`deleteSelection(); 0`);
  equal('delete the selection', await strokes(), m);
  await js(`setTool('pen'); setSize(3); 0`);
  key(']');
  check('] makes the pen larger', (await js('state.tools.pen.size')) > 3);
});

group('undo and redo', async () => {
  await fresh('Undo');
  await js(`setTool('pen'); 0`);
  await drag(wave(200));
  await drag(wave(320));
  equal('two strokes', await strokes(), 2);
  undoKey();
  check('Ctrl+Z takes back the last stroke', await until('page().strokes.length === 1'));
  redoKey();
  check('Ctrl+Y brings it back', await until('page().strokes.length === 2'));
  key('Z', ['control', 'shift']);
  await frame();
  undoKey();
  check('Ctrl+Shift+Z is redo too', await until('page().strokes.length === 1'));
  redoKey();
  await until('page().strokes.length === 2');

  // Typing is one step per run; Enter starts a new step.
  await js(`setTool('text'); 0`);
  await typeText('First line');
  key('Return');
  await typeText('Second');
  undoKey();
  check('undo takes back a run of typing', await until(`!Model.pageText(page()).includes('Second') && (commitEditor(), Model.pageText(page())).includes('First line')`), await text());
  undoKey();
  check('…then the run before it', await until(`!(commitEditor(), Model.pageText(page())).includes('First')`), await text());
  undoKey();
  check('…then the ink drawn before the typing', await until('page().strokes.length === 1'));
  redoKey();
  redoKey();
  check('redo replays in order', await until(`page().strokes.length === 2 && (commitEditor(), Model.pageText(page())).includes('First line')`));
  redoKey();
  await until(`(commitEditor(), Model.pageText(page())).includes('Second')`);

  // Changes to pages and sections are steps too, and undo opens the page where the change was.
  await js(`addPage(); 0`);
  const added = await js('pages().length');
  await js(`setTool('pen'); 0`);
  await drag(wave(250));
  await js(`showPage(0); 0`);
  undoKey();
  check('undo opens the page where the last change was', await until(`state.pageIdx === 1 && page().strokes.length === 0`), await where());
  undoKey();
  check('undo takes back a new page', await until(`pages().length === ${added - 1}`));
  await js(`document.querySelector('#page-mode [data-value="infinite"]').click(); 0`);
  undoKey();
  check('undo takes back the page type', await until(`page().mode === 'paged'`));
  await js(`document.querySelector('#paper-style [data-value="grid"]').click(); 0`);
  undoKey();
  check('undo takes back the paper', await until(`page().paper !== 'grid'`));
  await js(`addSection(); 0`);
  await js(`document.activeElement.blur && document.activeElement.blur(); 0`);
  undoKey();
  check('undo takes back a new section', await until(`state.nb.sections.length === 1`));
  await js(`run('delete-page'); 0`);
  await answer('Delete');
  undoKey();
  check('undo brings back a deleted page with its content', await until(`pages().length === 1 && page().strokes.length === 2`));
  await js(`el.pageTitle.focus(); 0`);
  wc.insertText(' renamed');
  await frame();
  undoKey();
  check('undo takes back a page title edit, even with the cursor in the title', await until(`!page().title.includes('renamed')`), await js('page().title'));

  // Undo does not reload the page: the view stays put, the page is updated in place.
  await js(`addPage(); extendPage(); extendPage(); setTool('pen'); 0`);
  await js(`el.workspace.scrollTop = 1500; 0`);
  await frame();
  const view = await js(`(() => { const s = sheetScale(), ws = el.workspace.getBoundingClientRect(); return { top: el.workspace.scrollTop, y: Math.round((ws.top - s.rect.top) * s.k) }; })()`);
  await drag(wave(view.y + 250));
  await js(`window.__keep = el.editor; el.editor.dataset.marker = 'same'; el.sheet.classList.remove('swap'); 0`);
  const scrolled = await js('el.workspace.scrollTop');
  undoKey();
  await until('page().strokes.length === 0');
  check('undo keeps the view where it is', (await js('el.workspace.scrollTop')) === scrolled, `${scrolled} -> ${await js('el.workspace.scrollTop')}`);
  check('undo does not reload the page', await js(`el.editor.dataset.marker === 'same' && !el.sheet.classList.contains('swap')`));
  redoKey();
  await until('page().strokes.length === 1');
  check('redo keeps the view too', (await js('el.workspace.scrollTop')) === scrolled);
  await js(`el.workspace.scrollTop = 0; 0`);
  await frame();
  undoKey();
  await until('page().strokes.length === 0');
  check('a change out of sight is scrolled into view', await js(`(() => { const s = sheetScale(), ws = el.workspace.getBoundingClientRect(); const top = (ws.top - s.rect.top) * s.k, bottom = (ws.bottom - s.rect.top) * s.k; return ${view.y + 220} >= top && ${view.y + 280} <= bottom; })()`));
  redoKey();
  await until('page().strokes.length === 1');
  await js(`showPage(0); 0`);
  undoKey();
  check('undo on another page opens it at the change', await until(`page().strokes.length === 0 && el.workspace.scrollTop > 800`), await js('[state.pageIdx, el.workspace.scrollTop]'));
  await js(`deletePage(state.pageIdx); 0`);

  // Redo is cleared by a new change; nothing to undo is harmless.
  undoKey();
  await frame();
  await js(`setTool('pen'); 0`);
  await drag(wave(400));
  check('a new change clears redo', await js('undoLog.redo.length === 0'));
  await js(`while (undoLog.undo.length) undo(); 0`);
  undoKey();
  check('undo with nothing left only says so', await js(`document.getElementById('status-msg').textContent.includes('Nothing to undo')`));
  check('history memory is bounded', await js(`(() => {
    const big = 'x'.repeat(4e6);
    for (let i = 0; i < 60; i++) { page().html = '<div>' + big + i + '</div>'; markDirty(); }
    const ok = undoLog.cost <= HISTORY_BUDGET && undoLog.undo.length < 60;
    page().html = ''; loadPage(); resetHistory();
    return ok;
  })()`));
  check('the undo button is disabled when there is nothing to undo', await js(`document.querySelector('#dock [data-cmd="undo"]').disabled`));

  // Undo reaches the notebook from anywhere, and from pen drivers.
  await js(`setTool('pen'); 0`);
  await drag(wave(500));
  win.emit('app-command', {}, 'undo');
  check('an "undo" app command from a pen or mouse driver works', await until('page().strokes.length === 0 || undoLog.redo.length > 0'));
  win.emit('app-command', {}, 'redo');
  await until('undoLog.redo.length === 0');
  await js(`document.querySelector('#dock [data-tool="marker"]').focus(); 0`);
  undoKey();
  check('Ctrl+Z works with the focus on a tool button', await until('undoLog.redo.length === 1'));
  redoKey();
  await until('undoLog.redo.length === 0');
  await js(`run('insert-link'); 0`);
  await until(`document.getElementById('ask').open`);
  await js(`document.getElementById('ask-input').focus(); 0`);
  wc.insertText('abc');
  undoKey();
  await frame();
  const field = await js(`document.getElementById('ask-input').value`);
  await answer('Cancel');
  check('in a dialog, Ctrl+Z works on the dialog field only', field !== 'abc' && (await js('undoLog.redo.length')) === 0, field);
});

group('pages and sections', async () => {
  await fresh('Pages');
  await js(`addPage(); addPage('todo'); 0`);
  equal('pages and a template page', await js('pages().map((p) => p.title)'), ['Page 1', 'Page 2', 'To-do list']);
  check('the template has a checklist', await js(`!!el.editor.querySelector('ul.checklist')`));
  await js(`duplicatePage(); 0`);
  equal('duplicate', await js('page().title'), 'To-do list (copy)');
  await js(`addSection(); document.activeElement.blur(); renameItem('section', 1, 'Ideas'); showSection(0); movePageToSection(0, 1); 0`);
  equal('move a page to another section', await js('state.nb.sections.map((s) => s.pages.length)'), [3, 2]);
  await js(`showPage(0); run('next-page'); 0`);
  equal('next page', await js('state.pageIdx'), 1);
  await js(`run('prev-page'); 0`);
  equal('previous page', await js('state.pageIdx'), 0);
  await js(`extendPage(); 0`);
  equal('add a sheet', await js('page().sheets'), 2);
  check('sheets are separated by a numbered gap', await js(`el.breaks.firstElementChild?.dataset.n === '2'`));
  await js(`cycleSectionColor(0); 0`);
  await js(`run('delete-section', () => deleteSection(1)); 0`);
  if (await until(`document.getElementById('ask').open`, 300)) await answer('Delete');
  equal('delete a section', await js('state.nb.sections.length'), 1);
  await js(`document.querySelector('#page-mode [data-value="infinite"]').click(); 0`);
  const s0 = await js('page().sheets');
  for (let i = 0; i < 4; i++) {
    await js('el.workspace.scrollTop = el.workspace.scrollHeight; 0');
    await frame();
  }
  check('infinite pages grow as you scroll', (await js('page().sheets')) > s0);
  check('only nearby ink canvases are kept', (await js('tiles.size')) <= 4);
});

group('sidebar', async () => {
  await fresh('Sidebar');
  await js(`addSection(); document.activeElement.blur(); showSection(0); 0`);
  equal('the section menu offers every colour', await js(`document.querySelectorAll('#section-dyes .swatch').length`), await js('Model.DYES.length'));
  const li = await js(`(() => { const r = el.sectionList.children[1].getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...li });
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...li });
  wc.sendInputEvent({ type: 'contextMenu', ...li });
  check('right-click opens the section menu', await until(`!document.getElementById('section-menu').hidden`));
  const color = await js(`Model.DYES[3][0]`);
  await js(`document.querySelector('#section-dyes .swatch[data-color="${color}"]').click(); 0`);
  equal('picking a colour colours the section', await js('state.nb.sections[1].color'), color);
  undoKey();
  check('undo takes the colour back', await until(`state.nb.sections[1].color !== '${color}'`));
  await js(`el.sectionList.children[0].focus(); 0`);
  key('Down');
  check('arrow keys move between sections', await until('state.secIdx === 1'));
  key('F2');
  check('F2 renames a section in place', await until(`!!el.sectionList.querySelector('input')`));
  wc.insertText('Ideas');
  await until(`el.sectionList.querySelector('input')?.value === 'Ideas'`, 1000);
  key('Return');
  check('…and the new name sticks', await until(`state.nb.sections[1]?.title === 'Ideas'`), await js(`JSON.stringify(state.nb.sections.map((s) => s.title))`));
  undoKey();
  check('undo takes back a section rename', await until(`state.nb.sections[1]?.title !== 'Ideas'`));
  await js(`showSection(0); addPage(); addPage(); el.pageList.children[0].focus(); 0`);
  key('End');
  check('End jumps to the last page', await until('state.pageIdx === 2'));
  key('Delete');
  check('Delete removes an empty page without asking', await until('pages().length === 2'));
  await js(`duplicatePage(); 0`);
  undoKey();
  check('undo takes back a duplicate', await until('pages().length === 2'));
  await js(`setTool('pen'); 0`);
  await drag(wave(300));
  await js(`run('clear-ink'); 0`);
  await answer('Clear ink');
  await until('page().strokes.length === 0 && !busy');
  undoKey();
  check('undo brings back cleared ink', await until('page().strokes.length === 1'));
  await js(`setTool('select'); 0`);
  await drag([[60, 200], [560, 200], [560, 420], [60, 420], [60, 200]]);
  const at = await js('page().strokes[0].points[0]');
  await js(`(() => { const b = selection.box; selectStrokes(selection.strokes); })(); 0`);
  await js(`recolorSelection('#2b4a8b'); 0`);
  check('recolouring selected ink', await js(`page().strokes[0].color === '#2b4a8b'`));
  undoKey();
  check('undo takes back a recolour', await until(`page().strokes[0].color !== '#2b4a8b' && page().strokes[0].points[0] === ${at}`));
});

group('saving and files', async () => {
  await fresh('Files');
  await typeText('Saved words');
  await js(`setTool('pen'); 0`);
  await drag(wave(300));
  const file = path.join(library, 'Files.ntb');
  check('autosave writes the file', await until(`!state.dirty`, 6000));
  await js(`(async () => { await leaveNotebook(); await loadFile(await api.readNotebook(${JSON.stringify(file)})); })()`);
  check('reopened with text and ink intact', (await text()).includes('Saved words') && (await strokes()) === 1);
  check('reopening starts a fresh undo history', await js('undoLog.undo.length === 0'));
  await js(`run('save-copy'); 0`);
  check('save a copy', await until(`true`) && (await (async () => { for (let i = 0; i < 40 && !fs.existsSync(outFiles.ntb); i++) await sleep(50); return fs.existsSync(outFiles.ntb); })()));
  await js(`page().title = 'Changed'; markDirty(); state.forceSnapshot = true; saveNotebook(false, true)`);
  await until('!state.saving');
  const versions = await js('api.listHistory()');
  check('version history keeps the previous version', versions.length >= 1);
  await js(`restoreVersion(${JSON.stringify(versions[0])}); 0`);
  check('restore an earlier version', await until(`page().title !== 'Changed'`));
  const hostile = path.join(root, 'hostile.ntb');
  fs.writeFileSync(hostile, JSON.stringify({ format: 'jotter-notebook', version: 2, sections: [{ title: 'S', pages: [{ title: 'P', html: '<img src=x onerror="window.__p=1"><b class="evil checklist">ok</b>', strokes: [{ tool: 'pen', color: 'red', size: 3, points: [0, 0] }, { tool: 'pen', color: '#000000', size: 3, points: [0, 0, 10, 10] }] }] }] }));
  nextOpen = hostile;
  await js(`run('open'); 0`);
  await until(`notebookName() === 'hostile'`);
  nextOpen = null;
  check('hostile files are cleaned on opening', await js(`!el.editor.innerHTML.includes('onerror') && !el.editor.innerHTML.includes('evil') && page().strokes.length === 1 && window.__p === undefined`));
});

group('export', async () => {
  await fresh('Export');
  await typeText('Export me');
  await js(`addPage(); document.querySelector('#page-mode [data-value="infinite"]').click(); 0`);
  const pdfPages = () => (fs.readFileSync(outFiles.pdf, 'latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  const exportPdf = async (choice) => {
    fs.rmSync(outFiles.pdf, { force: true });
    await js(`run('export-pdf'); 0`);
    await answer(choice);
    for (let i = 0; i < 100 && !fs.existsSync(outFiles.pdf); i++) await sleep(50);
    await sleep(100);
  };
  await exportPdf('A4 pages only');
  equal('PDF of A4 pages only', pdfPages(), 1);
  await exportPdf('Include infinite pages');
  equal('PDF with the infinite page too', pdfPages(), 2);
  await js(`run('export-png'); 0`);
  for (let i = 0; i < 100 && !fs.existsSync(outFiles.png); i++) await sleep(50);
  check('page image', fs.existsSync(outFiles.png));
  await js(`run('export-md'); 0`);
  for (let i = 0; i < 100 && !fs.existsSync(outFiles.md); i++) await sleep(50);
  check('Markdown', fs.existsSync(outFiles.md) && fs.readFileSync(outFiles.md, 'utf8').includes('Export me'));
});

group('search', async () => {
  await fresh('Search');
  await typeText('alpha');
  await js(`addPage(); 0`);
  await typeText('needle in the haystack');
  await js(`showPage(0); openSearch(); el.searchInput.value = 'needle'; runSearch(); 0`);
  equal('finds text on other pages', await js(`el.searchResults.querySelectorAll('.result').length`), 1);
  await js(`el.searchResults.querySelector('.result').click(); 0`);
  equal('a result opens its page', await js('state.pageIdx'), 1);
  check('and highlights the match', await js(`!!CSS.highlights.get('search')`));
});

group('performance with a heavy notebook', async () => {
  await fresh('Heavy');
  // 20 pages of dense handwriting and a large picture.
  await js(`(() => {
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; const g = c.getContext('2d');
    const img = g.createImageData(500, 500); for (let i = 0; i < img.data.length; i++) img.data[i] = (r() * 255) | 0; g.putImageData(img, 0, 0);
    const pic = c.toDataURL('image/png');
    const sec = state.nb.sections[0]; sec.pages.length = 0;
    for (let p = 0; p < 20; p++) {
      const page = Model.newPage('Page ' + (p + 1));
      for (let s = 0; s < 300; s++) { const pts = []; let x = 60 + r() * 600, y = 60 + r() * 1000; for (let k = 0; k < 100; k++) { x += r() * 3 - 1.5; y += r() * 3 - 1.5; pts.push(Math.round(x), Math.round(y)); } page.strokes.push({ tool: 'pen', color: '#1f1b18', size: 3, points: pts }); }
      page.html = '<div>Notes</div>' + (p === 0 ? '<img src="' + pic + '">' : '');
      sec.pages.push(page);
    }
    state.pageIdx = 0; loadPage(); renderSidebar(); resetHistory(); markDirty(null);
  })()`);
  await js('saveNotebook(false, true)');
  // While autosave runs, the main process (which passes pen and keyboard input to the page) must not stall.
  let last = Date.now();
  let worst = 0;
  const tick = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 5); last = n; }, 5);
  const took = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await js(`(async () => { el.editor.focus(); document.execCommand('insertText', false, ' more'); page().strokes = [...page().strokes]; markDirty(); await saveNotebook(false, true); })()`);
    took.push(Date.now() - t);
  }
  clearInterval(tick);
  check('autosave of a heavy notebook is quick', Math.max(...took) < 400, `${took.join(', ')} ms`);
  check('autosave never freezes input', worst < 120, `main thread stalled ${worst} ms`);
  const prep = await js(`(() => { page().rev++; const t = performance.now(); Model.buildSave(state.nb, sent); return performance.now() - t; })()`);
  check('preparing a save of a page with a large picture is quick', prep < 40, `${Math.round(prep)} ms`);
  const undoTime = await js(`(() => { page().strokes = page().strokes.slice(1); markDirty(); const t = performance.now(); undo(); return performance.now() - t; })()`);
  check('undo on a heavy notebook is quick', undoTime < 100, `${Math.round(undoTime)} ms`);
});

group('layout at every size and edge', async () => {
  await fresh('Layout');
  await js(`setTool('pen'); 0`);
  const problems = [];
  for (const [w, h] of [[860, 560], [1400, 900], [1920, 1080]]) {
    win.setSize(w, h);
    for (const side of ['right', 'left', 'top', 'bottom']) {
      await js(`setDockSide('${side}'); 0`);
      await until('true');
      await sleep(60);
      const bad = await js(`(() => {
        const R = (e) => (typeof e === 'string' ? document.querySelector(e) : e).getBoundingClientRect();
        const over = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const area = R('#page-area'), dock = R('#dock'), top = R('#topbar'), side = R('#sidebar'), sheet = R(el.sheet), opts = R('.page-opts');
        const out = [];
        if (dock.left < area.left - 1 || dock.right > area.right + 1 || dock.top < area.top - 1 || dock.bottom > area.bottom + 1) out.push('bar outside its area');
        if (side.width && sheet.left < side.right - 1) out.push('page under the sidebar');
        if (['left', 'right'].includes(document.body.dataset.dock) && over({ left: sheet.left, right: sheet.right, top: dock.top, bottom: dock.bottom }, dock)) out.push('page under the bar');
        if (el.workspace.scrollWidth > el.workspace.clientWidth + 1) out.push('page scrolls sideways');
        const tb = document.getElementById('topbar');
        if (tb.scrollWidth > tb.clientWidth + 1) out.push('top bar overflows');
        if (over(opts, R('.tb-left')) || over(opts, R('.tb-right'))) out.push('switches collide');
        if (R(el.pageTitle).width < 60) out.push('page name squeezed');
        if (innerWidth >= 1280 && Math.abs((opts.left + opts.right) / 2 - innerWidth / 2) > 2) out.push('switches not centred');
        if (innerWidth >= 1280 && ['top', 'bottom'].includes(document.body.dataset.dock) && Math.abs((sheet.left + sheet.right) / 2 - innerWidth / 2) > 2) out.push('page not centred');
        const tools = R('.tools');
        if (tools.bottom > area.bottom + 1 || tools.right > area.right + 1) out.push('tools cut off');
        return out.join(', ');
      })()`);
      if (bad) problems.push(`${w}x${h} ${side}: ${bad}`);
    }
  }
  check('bar, page, title bar and switches fit at 3 sizes × 4 edges', !problems.length, problems.join(' | '));
  win.setSize(1400, 900);
  await js(`setDockSide('right'); 0`);
  const toolSpots = await js(`(() => { const s = new Set(); for (const t of ['text', 'pen', 'marker', 'eraser', 'shape', 'select']) { setTool(t); s.add([...document.querySelectorAll('.tool')].map((b) => b.getBoundingClientRect().top).join()); } setTool('pen'); return s.size; })()`);
  equal('tool buttons never move when the tool changes', toolSpots, 1);
  await js(`run('toggle-rail'); 0`);
  check('the options fold away', await js(`document.querySelector('.opts').offsetWidth === 0`));
  await js(`run('toggle-rail'); 0`);
  await js(`document.getElementById('dock-focus').click(); 0`);
  check('focus mode from the bar', await js(`document.body.classList.contains('focus') && document.getElementById('dock-focus').getAttribute('aria-pressed') === 'true'`));
  await js(`document.getElementById('dock-focus').click(); 0`);
  win.setSize(900, 700);
  check('a narrow window fits the page by zooming out', await until('state.zoom < 1'));
  win.setSize(1400, 900);
  check('…and back to actual size when there is room', await until('state.zoom === 1'));
  await js(`run('zoom-in'); 0`);
  check('zoom in', await until('state.zoom > 1'));
  await js(`run('zoom-reset'); 0`);
  check('zoom reset fits again', await until('state.zoom === 1'));
});

group('settings and dialogs', async () => {
  await fresh('Settings');
  await js(`openSettings(); 0`);
  check('settings open', await js(`document.getElementById('settings-dialog').open`));
  await js(`document.querySelector('#theme [data-value="light"]').click(); 0`);
  check('light theme', await until(`!matchMedia('(prefers-color-scheme: dark)').matches`));
  await js(`document.querySelector('#theme [data-value="dark"]').click(); 0`);
  check('dark theme', await until(`matchMedia('(prefers-color-scheme: dark)').matches`));
  await js(`document.querySelector('#set-dock [data-value="left"]').click(); 0`);
  equal('tool bar side from settings', await js('document.body.dataset.dock'), 'left');
  await js(`setDockSide('right'); document.getElementById('set-penonly').click(); 0`);
  check('pen-only drawing', await until(`document.body.classList.contains('pen-only')`));
  await js(`document.getElementById('set-penonly').click(); document.getElementById('settings-dialog').close(); 0`);
  const lists = await js(`[...document.querySelectorAll('select option')].every((o) => { const c = getComputedStyle(o).backgroundColor; return !/rgba\\(.*, 0\\)|transparent/.test(c); })`);
  check('drop-down lists have solid colours', lists);
  for (const cmd of ['about', 'shortcuts']) {
    await js(`run('${cmd}'); 0`);
    check(`${cmd} dialog opens`, await until(`!!document.querySelector('dialog[open]')`));
    await js(`document.querySelector('dialog[open]').close(); 0`);
  }
  await js(`run('toggle-fullscreen'); 0`);
  check('full screen', await until('state.fullscreen', 4000));
  await js(`run('toggle-fullscreen'); 0`);
  await until('!state.fullscreen', 4000);
  const count = BrowserWindow.getAllWindows().length;
  await js(`run('new-window'); 0`);
  for (let i = 0; i < 60 && BrowserWindow.getAllWindows().length === count; i++) await sleep(50);
  check('a second window', BrowserWindow.getAllWindows().length === count + 1);
  BrowserWindow.getAllWindows().filter((w) => w !== win).forEach((w) => w.destroy());
});

// =====================================================================================================
app.whenReady().then(async () => {
  const started = Date.now();
  for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await sleep(50);
  win = BrowserWindow.getAllWindows()[0];
  wc = win.webContents;
  win.setSize(1400, 900);
  // Off-screen, so the real mouse (someone using the PC while the tests run) never mixes with the test's
  // input; the window still renders normally there.
  win.setPosition(-20000, -20000);
  wc.on('console-message', (e) => /error|Uncaught/i.test(e.message) && !/Content Security Policy/.test(e.message) && report(false, 'no script errors', `${e.message} at ${String(e.sourceId || '').split('/').pop()}:${e.lineNumber}`));
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await until('typeof run === "function" && state.version');
  for (const g of groups) {
    if (only.length && !only.some((w) => g.name.includes(w))) continue;
    groupName = g.name;
    const t = Date.now();
    const before = failed;
    try {
      await g.fn();
    } catch (err) {
      report(false, 'ran to the end', err.message);
    }
    console.log(`${failed > before ? '✗' : '✓'} ${g.name}  ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      fs.writeFileSync(path.join(shots, `${g.name.replace(/\W+/g, '-')}.png`), (await wc.capturePage()).toPNG());
    }
    await js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); closePopovers(); 0`).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  BrowserWindow.getAllWindows().forEach((w) => w.destroy());
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
  app.exit(failed ? 1 : 0);
});
