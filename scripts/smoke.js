// End-to-end test: `npx electron scripts/smoke.js <output-dir>`
// Drives the real app through every feature and saves screenshots for review.
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'smoke-out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, 'profile');
app.setPath('userData', profile); // keep the test away from the real settings and recent list
const library = path.join(out, 'library'); // the notebooks folder for this test
// Start with the test's own notebooks folder, so the real Documents\Jotter is never listed or touched.
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ libraryDir: library }));
const files = { ntb: path.join(library, 'smoke.ntb'), copy: path.join(out, 'copy.ntb'), pdf: path.join(out, 'smoke.pdf'), png: path.join(out, 'page.png'), md: path.join(out, 'smoke.md') };

dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: opts.title === 'Save a Copy' ? files.copy : files[opts.filters[0].extensions[0]] });
dialog.showMessageBox = async (_w, opts) => {
  console.log('NATIVE DIALOG (unexpected):', opts.message);
  return { response: opts.cancelId ?? 0 };
};

require('../src/main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

app.whenReady().then(async () => {
  await sleep(1800);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  const wc = win.webContents;
  wc.on('console-message', (e) => {
    if (!/Content Security Policy|willReadFrequently/.test(e.message)) console.log('RENDERER:', e.message);
  });
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (name) => {
    await sleep(300);
    fs.writeFileSync(path.join(out, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  // Click a button in the in-app dialog once it is open.
  async function answer(label, input) {
    for (let i = 0; i < 60; i++) {
      const r = await js(`(() => {
        const d = document.getElementById('ask');
        if (!d.open) return 'wait';
        ${input != null ? `document.getElementById('ask-input').value = ${JSON.stringify(input)};` : ''}
        const b = [...d.querySelectorAll('#ask-buttons button')].find((b) => b.textContent === ${JSON.stringify(label)});
        if (!b) return 'missing';
        b.click();
        return 'ok';
      })()`);
      if (r === 'ok') return true;
      if (r === 'missing') throw new Error(`No "${label}" button in the dialog`);
      await sleep(100);
    }
    throw new Error(`No dialog appeared for "${label}"`);
  }
  async function until(code, ms = 6000) {
    for (let t = 0; t < ms; t += 100) {
      if (await js(code)) return true;
      await sleep(100);
    }
    return false;
  }

  async function drag(points, modifiers = []) {
    const rect = await js(`(() => { const r = el.editor.getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
    const at = ([x, y]) => ({ x: Math.round(rect.x + x), y: Math.round(rect.y + y), modifiers });
    wc.sendInputEvent({ type: 'mouseMove', ...at(points[0]) });
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at(points[0]) });
    for (const p of points.slice(1)) {
      wc.sendInputEvent({ type: 'mouseMove', button: 'left', ...at(p) });
      await sleep(8);
    }
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at(points[points.length - 1]) });
    await sleep(80);
  }
  const click = async (x, y) => {
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(x), y: Math.round(y) });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(x), y: Math.round(y) });
    await sleep(120);
  };
  const wave = (y, amp = 25) => Array.from({ length: 40 }, (_, i) => [90 + i * 14, y + Math.sin(i / 3) * amp]);
  const pixel = (x, y) => js(`[...tiles.get(0).getContext('2d').getImageData((${x} + layer.ox) * layer.s, ${y} * layer.s, 1, 1).data]`);
  const waveY = 450 + Math.sin(15 / 3) * 40; // the red wave at x = 300
  const tools = () => js(`page().strokes.map((s) => s.tool + ':' + s.color).join()`);

  // ----- Home -----
  check('starts on the home screen', (await js(`state.view`)) === 'home' && (await js(`state.nb`)) === null);
  check('home greets you and shows a fan of covers', /^Good (morning|afternoon|evening)$/.test(await js(`document.getElementById('home-greeting').textContent`)) && (await js(`document.querySelectorAll('.fan svg').length`)) === 3);
  check('eight one-click starts offered', (await js(`document.querySelectorAll('#starters .starter').length`)) === 8);
  check('no Continue card before there is a notebook', await js(`document.getElementById('home-continue').hidden`));
  await shot('01-home-empty');

  // ----- New notebook: created in the notebooks folder and saved automatically -----
  await js(`applySettings({ libraryDir: ${JSON.stringify(library)} })`);
  await js(`run('new'); 0`);
  check('new notebook asks for a cover', await until(`document.getElementById('cover-dialog').open`));
  check('24 covers offered in three groups', (await js(`document.querySelectorAll('#cover-grid .cover-opt').length + ':' + document.querySelectorAll('#cover-grid .cover-group').length`)) === '24:3');
  await js(`document.querySelector('#cover-grid [data-id="ajrakh"]').click(); 0`);
  await shot('02-cover-picker');
  check('the name field suggests Book 1', (await js(`document.getElementById('cover-name').placeholder`)) === 'Book 1');
  await js(`document.getElementById('cover-name').value = 'smoke'; document.getElementById('cover-ok').click(); 0`);
  check('new notebook opens the editor', await until(`state.view === 'editor'`));
  check('the notebook is created in the notebooks folder', (await until(`!!state.path`)) && fs.existsSync(files.ntb));
  check('cover is kept and sets the accent', ['ajrakh#8e2433', 'ajrakh#e4848f'].includes(await js(`state.nb.cover + getComputedStyle(document.documentElement).getPropertyValue('--accent')`)));
  check('a new notebook has one section', (await js(`state.nb.sections.length + ':' + section().title`)) === '1:Notes');
  check('an empty page shows the motif', await js(`el.sheet.classList.contains('blank')`));

  await js(`el.editor.focus(); document.execCommand('insertText', false, 'Meeting notes');
    format('formatBlock', 'h1'); document.execCommand('insertParagraph'); format('formatBlock', 'div');
    document.execCommand('insertText', false, 'Typed text sits under the ink layer. Highlight this line.'); 0`);
  check('typed text', (await js(`el.editor.innerText`)).includes('Meeting notes'));
  check('motif gone once there is text', !(await js(`el.sheet.classList.contains('blank')`)));
  const draftsDir = path.join(profile, 'drafts');
  const draftCount = () => (fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).length : 0);
  await sleep(2600);
  check('typing is saved without asking', !(await js(`state.dirty`)) && fs.statSync(files.ntb).size > 0 && draftCount() === 0);

  // ----- Pen, marker, rub-out eraser -----
  await js(`setTool('pen'); setColor('#2563eb'); setSize(4); 0`);
  await drag(wave(300));
  await js(`setTool('marker'); 0`);
  await drag([[70, 132], [300, 132], [520, 132]]);
  await js(`setTool('pen'); setColor('#dc2626'); setSize(10); 0`);
  await drag(wave(450, 40));
  await js(`setTool('eraser'); setSize(30); 0`);
  await drag([[300, 380], [300, 520]]);
  check('rubbing out splits the red stroke (no eraser strokes kept)', (await tools()) === 'pen:#2563eb,marker:#facc15,pen:#dc2626,pen:#dc2626', await tools());
  check('erased ink is gone', (await pixel(300, waveY))[3] === 0);
  check('marker is translucent', ((a) => a > 60 && a < 200)((await pixel(200, 132))[3]));
  await js(`undo(); 0`);
  check('undo brings the erased ink back', (await pixel(300, waveY))[3] > 0 && (await js(`page().strokes.length`)) === 3);
  await js(`redo(); undo(); 0`);

  // ----- Whole-stroke eraser -----
  await js(`applySettings({ eraserMode: 'stroke' })`);
  await drag([[400, 250], [400, 350]]);
  check('whole-stroke eraser removes one stroke', (await tools()) === 'marker:#facc15,pen:#dc2626');
  await js(`undo(); applySettings({ eraserMode: 'rub' })`);
  check('undo puts it back in place', (await tools()) === 'pen:#2563eb,marker:#facc15,pen:#dc2626');

  // ----- Straight line, pressure, shapes -----
  await js(`setTool('pen'); setColor('#16a34a'); setSize(3); 0`);
  await drag([[100, 600], [200, 640], [300, 590], [500, 604]], ['shift']);
  const line = await js(`page().strokes.at(-1).points`);
  check('shift draws a straight snapped line', line.length === 4 && line[1] === line[3], JSON.stringify(line));
  await js(`setStrokes([...page().strokes, { tool: 'pen', color: '#1c1c1c', size: 10, points: [100,700, 200,700, 300,700, 400,700], w: [0.05, 0.05, 1, 1] }]); redrawInk(); 0`);
  check('pressure: thin where light, thick where heavy', (await pixel(120, 705))[3] === 0 && (await pixel(370, 705))[3] > 200);
  await js(`setTool('shape'); state.tools.shape.kind = 'ellipse'; 0`);
  await drag([[640, 160], [700, 200], [760, 250]]);
  check('shape tool draws an ellipse', (await js(`(() => { const s = page().strokes.at(-1); return s.flat === 1 && s.points.length === 146; })()`)) === true, await js(`JSON.stringify(page().strokes.at(-1)).slice(0, 160) + ' tool=' + state.tool + ' n=' + page().strokes.length`));

  // ----- Lasso: select, move, recolour, delete -----
  await js(`setTool('select'); 0`);
  await drag([[620, 148], [780, 148], [780, 262], [620, 262], [620, 148]]);
  check('lasso selects the ellipse', (await js(`selection && selection.strokes.length`)) === 1);
  await shot('03-selection');
  const before = await js(`Ink.box(selection.strokes[0]).minX`);
  await drag([[700, 205], [730, 215], [750, 205]]);
  check('dragging moves the selection', Math.round((await js(`Ink.box(page().strokes.at(-1)).minX`)) - before) === 50);
  await js(`recolorSelection('#8e2a5c'); 0`);
  check('selection can be recoloured', (await js(`page().strokes.at(-1).color`)) === '#8e2a5c');
  await js(`copySelection(); pasteInk(); 0`);
  check('copy and paste ink', (await js(`page().strokes.length`)) === 7 && (await js(`selection.strokes.length`)) === 1);
  await js(`deleteSelection(); 0`);
  check('delete removes the pasted copy', (await js(`page().strokes.length`)) === 6);
  await shot('04-editor-ink');

  // ----- Paper -----
  await js(`document.querySelector('#paper-style [data-value="kolam"]').click(); 0`);
  check('kolam dot paper', (await js(`getComputedStyle(el.editor).backgroundImage`)).includes('radial-gradient'));
  await js(`document.querySelector('#paper-style [data-value="ruled"]').click(); 0`);
  check('ruled paper snaps text rows', (await js(`getComputedStyle(el.editor).lineHeight`)) === '32px');
  await js(`document.querySelector('#paper-colors [data-value="sepia"]').click(); 0`);
  check('paper colour applied', (await js(`getComputedStyle(el.sheet).backgroundColor`)) === 'rgb(241, 227, 198)');

  // ----- Tool options sit in the bar; page actions on right-click -----
  const shown = (id) => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  await js(`setTool('text'); document.querySelector('.tool[data-tool="marker"]').click(); 0`);
  check('the marker shows its colours and size in the bar', (await js(shown('color-options'))) && (await js(shown('size-options'))) && !(await js(shown('text-options'))));
  check('no panel opens when picking a tool', !(await js(`anyPopoverOpen()`)));
  await shot('05-tool-options');
  // The tool buttons stay exactly where they are whatever tool (and so whatever options) is chosen,
  // and the title bar keeps its layout while saving comes and goes.
  const toolSpots = await js(`(() => { const out = new Set(); for (const t of ['text', 'pen', 'marker', 'eraser', 'shape', 'select']) {
    setTool(t); out.add([...document.querySelectorAll('.tool')].map((b) => { const r = b.getBoundingClientRect(); return r.left + ',' + r.top; }).join(' ')); }
    setTool('marker'); return out.size; })()`);
  check('tool buttons never move when the tool changes', toolSpots === 1, toolSpots);
  const barSpots = await js(`(() => { const out = new Set(); const at = () => [...document.querySelectorAll('#topbar .tb-right .btn')].map((b) => b.getBoundingClientRect().left).join();
    for (const k of [{ saving: true }, { saving: false, dirty: true }, { dirty: false }]) { Object.assign(state, k); syncChrome(); out.add(at()); }
    return out.size; })()`);
  check('title bar buttons stay put while saving', barSpots === 1, barSpots);
  // The page is centred on the app window with the tool options open and folded.
  await js(`setTool('pen'); 0`);
  await shot('05b-rail-open');
  const centred = `(() => { const p = el.sheet.getBoundingClientRect(); return Math.abs((p.left + p.right) / 2 - innerWidth / 2) < 2; })()`;
  check('the page is centred with the options open', await js(centred));
  await js(`run('toggle-rail'); 0`);
  await sleep(100);
  check('the options column folds away', !(await js(`document.querySelector('.opts').offsetWidth`)));
  check('the page is centred with the options folded', await js(centred));
  await shot('05c-rail-folded');
  await js(`run('toggle-rail'); setTool('marker'); 0`);
  const rowAt = `(() => { const r = document.querySelector('.page-opts').getBoundingClientRect(); const t = el.pageTitle.getBoundingClientRect(); return [r.left, r.top, t.left, t.width].map(Math.round).join(); })()`;
  const rowBefore = await js(rowAt);
  await js(`el.workspace.scrollTop = 400; state.userZoomed = true; setZoom(1.5); 0`);
  await sleep(150);
  const rowAfter = await js(rowAt);
  await js(`run('zoom-reset'); el.workspace.scrollTop = 0; 0`);
  check('the page name and switches stay put in the top bar while the page scrolls and zooms', rowBefore === rowAfter, `${rowBefore} / ${rowAfter}`);

  // ----- The tool bar docks to every edge, and everything lines up at every window size -----
  fs.mkdirSync(path.join(out, 'layout'), { recursive: true });
  const layoutProblems = [];
  for (const [w, h] of [[860, 560], [1100, 700], [1400, 900], [1920, 1080]]) {
    win.setSize(w, h);
    for (const side of ['right', 'left', 'top', 'bottom']) {
      await js(`setDockSide('${side}'); setTool('pen'); el.workspace.scrollTop = 0; 0`);
      await sleep(260);
      const bad = await js(`(() => {
        const R = (e) => (typeof e === 'string' ? document.querySelector(e) : e).getBoundingClientRect();
        const over = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const area = R('#page-area'), dock = R('#dock'), top = R('#topbar'), side = R('#sidebar'), sheet = R(el.sheet), opts = R('.page-opts');
        const out = [];
        if (dock.left < area.left - 1 || dock.right > area.right + 1 || dock.top < area.top - 1 || dock.bottom > area.bottom + 1) out.push('bar outside the page area');
        if (over(dock, top)) out.push('bar under the title bar');
        if (side.width && sheet.left < side.right - 1) out.push('page under the sidebar');
        if (['left', 'right'].includes(document.body.dataset.dock) && over({ ...sheet.toJSON(), top: dock.top, bottom: dock.bottom }, dock)) out.push('page under the bar (sheet ' + Math.round(sheet.left) + '-' + Math.round(sheet.right) + ', bar ' + Math.round(dock.left) + '-' + Math.round(dock.right) + ', pad ' + el.workspace.style.paddingLeft + ', zoom ' + state.zoom + ')');
        const tb = document.getElementById('topbar');
        if (tb.scrollWidth > tb.clientWidth + 1) out.push('title bar overflows');
        if (opts.right > top.right + 1 || opts.left < top.left) out.push('page switches cut off');
        if (el.workspace.scrollWidth > el.workspace.clientWidth + 1) out.push('page scrolls sideways');
        const title = R(el.pageTitle), left = R('.tb-left'), right = R('.tb-right');
        if (title.width < 60) out.push('page name squeezed');
        if (over(opts, left) || over(opts, right)) out.push('page switches collide in the top bar');
        if (innerWidth >= 1280 && Math.abs((opts.left + opts.right) / 2 - innerWidth / 2) > 2) out.push('page switches not centred');
        if (R('#nb-name').width < 40) out.push('notebook name squeezed');
        const tools = document.querySelector('.tools').getBoundingClientRect();
        if (tools.bottom > area.bottom + 1 || tools.right > area.right + 1) out.push('tools cut off');
        return out.join(', ');
      })()`);
      if (bad) layoutProblems.push(`${w}x${h} ${side}: ${bad}`);
      fs.writeFileSync(path.join(out, 'layout', `${w}x${h}-${side}.png`), (await wc.capturePage()).toPNG());
    }
  }
  await js(`document.getElementById('dock-focus').click(); 0`);
  await sleep(150);
  check('the focus button in the tool bar turns focus mode on', (await js(`document.body.classList.contains('focus') && document.getElementById('dock-focus').getAttribute('aria-pressed')`)) === 'true');
  fs.writeFileSync(path.join(out, 'layout', 'focus-from-bar.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('dock-focus').click(); 0`);
  await sleep(150);
  check('and off again', (await js(`document.body.classList.contains('focus')`)) === false);
  const crumbs = await js(`(() => {
    const parts = [document.querySelector('#nb-name span'), document.getElementById('crumb-section'), el.pageTitle].filter((e) => e.getBoundingClientRect().width);
    const mids = parts.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
    const fonts = new Set(parts.map((e) => { const c = getComputedStyle(e); return c.fontFamily + ' ' + c.fontSize; }));
    return { spread: Math.max(...mids) - Math.min(...mids), fonts: fonts.size, family: getComputedStyle(el.pageTitle).fontFamily, loaded: document.fonts.check('600 14px "Plus Jakarta Sans Variable"') };
  })()`);
  check('notebook, section and page names share one typeface and line', crumbs.spread <= 1 && crumbs.fonts === 1 && crumbs.loaded, JSON.stringify(crumbs));
  check('tool bar and page line up at every size and edge', !layoutProblems.length, layoutProblems.join(' | '));
  win.setSize(860, 560);
  await js(`showHome(); 0`);
  await sleep(400);
  check('home fits the smallest window', await js(`(() => { const h = document.getElementById('home'); return h.scrollWidth <= h.clientWidth + 1; })()`));
  fs.writeFileSync(path.join(out, 'layout', 'home-860x560.png'), (await wc.capturePage()).toPNG());
  await js(`showEditor(); 0`);
  await sleep(200);
  win.setSize(1400, 900);
  await js(`setDockSide('right'); 0`);
  await sleep(200);
  await js(`setTool('text'); 0`);
  check('typing shows text options and hides size', (await js(shown('text-options'))) && !(await js(shown('size-options'))));
  await js(`(() => { const li = el.pageList.children[0]; const r = li.getBoundingClientRect();
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); })()`);
  check('right-clicking a page opens its menu', !(await js(`el.pageMenu.hidden`)));
  await shot('06-page-menu');
  await js(`closePopovers(); 0`);

  // ----- Rich text: checklist, table, link, image, text box -----
  await js(`setTool('text'); const r = document.createRange(); r.selectNodeContents(el.editor); r.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('insertParagraph');
    document.execCommand('insertText', false, 'Buy paper'); insertChecklist(); 0`);
  check('checklist inserted', (await js(`!!el.editor.querySelector('ul.checklist li')`)) === true);
  const li = await js(`(() => { const r = el.editor.querySelector('ul.checklist li').getBoundingClientRect(); return { x: r.left + 7, y: r.top + 10 }; })()`);
  await click(li.x, li.y);
  check('clicking the box ticks the item', await js(`el.editor.querySelector('ul.checklist li').classList.contains('done')`));
  await js(`const r2 = document.createRange(); r2.selectNodeContents(el.editor); r2.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r2);
    document.execCommand('insertParagraph'); insertTable(2, 2); 0`);
  check('table inserted', (await js(`el.editor.querySelectorAll('table td').length`)) === 4);
  await js(`const td = [...el.editor.querySelectorAll('td')].at(-1); const r3 = document.createRange(); r3.selectNodeContents(td); r3.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r3); moveCell(td, 1); 0`);
  check('Tab in the last cell adds a row', (await js(`el.editor.querySelectorAll('table tr').length`)) === 3);
  await js(`const p = el.editor.querySelector('h1').firstChild; const r4 = document.createRange(); r4.setStart(p, 0); r4.setEnd(p, 7);
    getSelection().removeAllRanges(); getSelection().addRange(r4); run('insert-link'); 0`);
  await answer('Add link', 'example.com');
  check('link added to the selected text', await until(`el.editor.querySelector('h1 a')?.getAttribute('href') === 'https://example.com'`), await js(`el.editor.querySelector('h1').outerHTML`));
  await js(`(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 1500; const x = c.getContext('2d'); x.fillStyle = '#2b4a8b'; x.fillRect(0, 0, 3000, 1500);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const r5 = document.createRange(); r5.selectNodeContents(el.editor); r5.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r5); await insertImageFile(new File([blob], 'big.png', { type: 'image/png' })); })()`);
  check('image inserted and scaled down', (await until(`(() => { const i = el.editor.querySelector('img'); return i && i.naturalWidth === 1600; })()`)) === true);
  await js(`insertTextBox(); document.execCommand('insertText', false, 'Side note'); 0`);
  check('text box placed on the page', (await js(`el.editor.querySelector('.tbox')?.textContent`)) === 'Side note');
  await shot('07-rich-text');
  const mdPage = await js(`commitEditor(); Model.toMarkdown(page())`);
  check('rich text converts to Markdown', mdPage.includes('- [x] Buy paper') && mdPage.includes('[Meeting](https://example.com)') && mdPage.includes('| --- |'), JSON.stringify(mdPage.slice(0, 120)));

  // ----- Sections and templates -----
  await js(`document.activeElement.blur(); addSection(); 0`);
  await sleep(100);
  await js(`document.activeElement.blur(); renameItem('section', 1, 'Ideas'); 0`);
  check('a second section', (await js(`state.nb.sections.map((s) => s.title).join()`)) === 'Notes,Ideas' && (await js(`state.secIdx`)) === 1);
  // Rename a section from its right-click menu and from the rename button.
  await js(`(() => { const li = el.sectionList.children[1]; const r = li.getBoundingClientRect();
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); })()`);
  check('right-clicking a section opens its menu', !(await js(`document.getElementById('section-menu').hidden`)));
  await shot('07b-section-menu');
  await js(`document.querySelector('#section-menu [data-action="rename"]').click(); 0`);
  check('rename from the menu opens the name field', (await js(`el.sectionList.querySelector('input')?.value`)) === 'Ideas');
  await js(`(() => { const i = el.sectionList.querySelector('input'); i.value = 'Ideas and plans'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  check('section renamed from its menu', (await js(`state.nb.sections[1].title`)) === 'Ideas and plans');
  await js(`el.sectionList.children[1].querySelector('.ren').click(); 0`);
  await js(`(() => { const i = el.sectionList.querySelector('input'); i.value = 'Ideas'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  check('section renamed with its rename button', (await js(`state.nb.sections[1].title + ':' + section().title`)) === 'Ideas:Ideas');
  await js(`run('rename-section'); 0`);
  check('the menu command renames the open section', (await js(`el.sectionList.querySelector('input')?.value`)) === 'Ideas');
  await js(`(() => { const i = el.sectionList.querySelector('input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); })()`);
  await js(`addPage('todo'); 0`);
  check('template page', (await js(`page().title + '|' + !!el.editor.querySelector('ul.checklist')`)) === 'To-do list|true');
  await js(`movePageToSection(state.pageIdx, 0); 0`);
  check('page moved to another section', (await js(`state.nb.sections.map((s) => s.pages.length).join()`)) === '2,1');
  await js(`showSection(0); 0`);

  // ----- Page with two sheets, page with infinite space -----
  await js(`showPage(0); addPage(); extendPage(); setTool('pen'); setSize(6); el.workspace.scrollTop = 900; 0`);
  await sleep(150);
  await drag([[200, 1050], [260, 1182], [320, 1050], [380, 1182]]);
  check('paged page with two sheets + stroke', (await js(`page().sheets + ':' + page().strokes.length`)) === '2:1');
  check('sheets are separated by a visible numbered gap', (await js(`(() => { const b = el.breaks.firstElementChild; return (b.getBoundingClientRect().height >= 10) + ' ' + b.dataset.n; })()`)) === 'true 2');
  await shot('08a-page-break');
  await js(`addPage(); document.querySelector('#page-mode [data-value="infinite"]').click(); 0`);
  await sleep(100);
  const s0 = await js(`page().sheets`);
  for (let i = 0; i < 6; i++) {
    await js(`el.workspace.scrollTop = el.workspace.scrollHeight; 0`);
    await sleep(120);
  }
  check('infinite page grows while scrolling', (await js(`page().sheets`)) > s0 + 2);
  check('only nearby canvases are kept', (await js(`tiles.size`)) <= 4);
  check('the text column of an infinite page is centred on the window', await js(`(() => { const r = el.editor.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2; })()`));
  await js(`el.workspace.scrollTop = 0; 0`);
  await sleep(150);
  await drag([[150, 200], [300, 260], [450, 200]]);
  await drag([[820, 300], [900, 340]]);
  check('ink outside the text column on infinite pages', (await js(`page().strokes.at(-1).points[0] > 794`)) === true,
    await js(`JSON.stringify({ current: !!current, last: page().strokes.at(-1).points.slice(0, 4), ed: el.editor.getBoundingClientRect().left, ink: el.inkLayer.getBoundingClientRect().right, ws: el.workspace.clientWidth })`));
  await shot('08-infinite');
  check('every page listed in the sidebar', (await js(`el.pageList.querySelectorAll('li').length`)) === 4);

  // ----- Search -----
  await js(`showPage(3); run('find'); el.searchInput.value = 'highlight'; runSearch(); 0`);
  check('search finds text on another page', (await js(`el.searchResults.querySelectorAll('.result').length`)) === 1);
  await shot('09-search');
  await js(`el.searchResults.querySelector('.result').click(); 0`);
  check('opening a result goes to the page and highlights it', (await js(`state.pageIdx + ':' + (CSS.highlights.get('search')?.size || 0)`)) === '0:1');

  // ----- Save (new zip format) -----
  await js(`run('save')`);
  check('.ntb written as a zip archive', fs.readFileSync(files.ntb).subarray(0, 2).toString() === 'PK');
  check('clean after save', !(await js(`state.dirty`)));
  check('recovery copy cleared after save', draftCount() === 0);
  check('window title', win.getTitle() === 'smoke — Jotter', win.getTitle());
  const zip = fs.readFileSync(files.ntb).toString('latin1');
  const pageJson = await js(`Model.buildSave(state.nb, Model.newSent(), { full: true }).request.pages.map((p) => p.data).join()`);
  check('rich text is saved', ['checklist', 'class=\\"done\\"', '<table', 'tbox', 'asset:assets/'].every((t) => pageJson.includes(t)));
  check('image stored once as a file in the archive', (zip.match(/assets\/[\w]+\.png/g) || []).length >= 1 && !zip.includes('data:image'));
  await js(`page().title = 'Changed'; markDirty(); 0`);
  check('only the changed page is sent on the next save', (await js(`Model.buildSave(state.nb, sent).request.pages.filter((p) => p.data).length`)) === 1);

  await js(`showPage(0); el.pageTitle.value = 'Renamed by autosave'; el.pageTitle.dispatchEvent(new Event('input')); 0`);
  check('autosave writes the change', await until(`!state.dirty`, 4000));
  const versions = await js(`api.listHistory()`);
  check('the earlier version was kept', versions.length === 1);

  // ----- Version history: restore -----
  await js(`run('history'); 0`);
  check('history dialog lists versions', await until(`document.querySelectorAll('#history-list button').length === 1`));
  await shot('10-history');
  await js(`document.querySelector('#history-list button').click(); 0`);
  check('restoring brings back the earlier title', await until(`state.nb && Model.allPages(state.nb)[0].title === 'Page 1'`));
  check('the restored notebook saves itself', await until(`!state.dirty`, 4000));
  check('the replaced version is kept too', (await js(`api.listHistory()`)).length === 2);

  // ----- Home shelf -----
  const summary = `JSON.stringify(state.nb.sections.map((s) => [s.title, s.color, s.pages.map((p) => [p.title, p.mode, p.paper, p.strokes.length, p.sheets])]))`;
  const saved = await js(summary);
  await js(`run('home')`);
  await sleep(300);
  check('home shows the notebook as a cover', (await js(`document.querySelector('#home-recent .card .label').textContent`)) === 'smoke');
  await shot('11-home-shelf');
  await js(`document.querySelector('.card .actions button').click(); 0`);
  await sleep(300);
  check('pinning moves it to Pinned', (await js(`document.querySelectorAll('#home-pinned .card').length`)) === 1);

  await js(`setNotebook(Model.newNotebook({ cover: 'kolam' }), null); showHome()`);
  await js(`document.querySelector('.card').click(); 0`);
  check('reopened from home with everything intact', (await until(`state.path && state.path.endsWith('smoke.ntb')`)) && (await js(summary)) === saved);

  // ----- Older and hostile files -----
  await js(`loadFile({ path: null, text: JSON.stringify({ format: 'jotter-notebook', pages: [{ title: 'x',
    html: '<img src="https://example.com/a.png" onerror="window.__pwned = 1"><script>window.__pwned = 1</script><b onclick="1" class="evil checklist">ok</b><a href="javascript:alert(1)">l</a>',
    strokes: [{ tool: 'pen', color: '#000000', size: 4, points: [0, 100, 200, 100] }, { tool: 'eraser', size: 20, points: [100, 80, 100, 120] },
      { tool: 'pen', color: 'red', size: 3, points: [1, 2] }] }] }) })`);
  await sleep(200);
  check('unsafe content is removed', (await js(`el.editor.innerHTML`)) === '<img><b class="checklist">ok</b><a>l</a>' && !(await js(`window.__pwned`)));
  check('old eraser strokes are applied and dropped', (await js(`page().strokes.map((s) => s.tool).join()`)) === 'pen,pen');
  await js(`loadFile({ path: 'bad.ntb', text: 'not json' }); 0`);
  await answer('OK');

  // ----- Rename the file; autosave follows -----
  await js(`setNotebook(Model.newNotebook({ cover: 'kolam' }), null); 0`);
  await js(`(async () => loadFile(await api.readNotebook(${JSON.stringify(files.ntb)})))()`);
  await js(`run('rename', () => renameNotebook('Renamed book'))`);
  const renamed = path.join(library, 'Renamed book.ntb');
  check('rename moves the file', fs.existsSync(renamed) && !fs.existsSync(files.ntb));
  check('rename updates the title', win.getTitle() === 'Renamed book — Jotter', win.getTitle());

  // ----- Exports -----
  // A notebook with A4 pages and an infinite page: the PDF can leave the infinite page out.
  await js(`document.querySelector('#paper-colors [data-value="sepia"]').click(); addPage(); document.querySelector('#page-mode [data-value="infinite"]').click(); 0`);
  await sleep(150);
  const waitPdf = async () => { for (let i = 0; i < 200 && !fs.existsSync(files.pdf); i++) await sleep(100); await sleep(500); return fs.existsSync(files.pdf); };
  const pdfSheets = () => (fs.readFileSync(files.pdf, 'latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  if (fs.existsSync(files.pdf)) fs.unlinkSync(files.pdf);
  await js(`run('export-pdf'); 0`);
  await answer('A4 pages only');
  await answer('Paper colour');
  check('pdf asks about infinite pages and can leave them out', (await waitPdf()) && pdfSheets() === (await js(`exportPayload(Model.allPages(state.nb).filter((p) => p.mode !== 'infinite')).reduce((n, p) => n + p.sheets, 0)`)));
  fs.unlinkSync(files.pdf);
  await js(`run('export-pdf'); 0`);
  await answer('Include infinite pages');
  await answer('Paper colour');
  check('pdf written', await waitPdf());
  const expected = await js(`exportPayload(Model.allPages(state.nb)).reduce((n, p) => n + p.sheets, 0)`);
  const pdfPages = (fs.readFileSync(files.pdf, 'latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  check('pdf has one page per sheet', pdfPages === expected, `(${pdfPages} of ${expected})`);
  await js(`run('export-png')`);
  check('page image written', fs.existsSync(files.png) && fs.statSync(files.png).size > 5000);
  await js(`run('export-md')`);
  const md = fs.existsSync(files.md) ? fs.readFileSync(files.md, 'utf8') : '';
  check('markdown export', md.startsWith('# Renamed book') && md.includes('## Notes') && md.includes('### Page 1'));

  // ----- Appearance and dialogs -----
  await js(`showPage(0); setTool('pen'); run('toggle-focus'); 0`);
  await shot('12-focus');
  await js(`run('toggle-focus'); applySettings({ theme: 'dark' })`);
  await sleep(200);
  await js(`setTool('text'); 0`);
  await shot('13-dark-editor');
  await js(`run('settings'); 0`);
  check('settings show the notebook options while editing', !(await js(`document.getElementById('set-notebook').hidden`)));
  await shot('14-settings');
  await js(`document.getElementById('settings-dialog').close(); applySettings({ theme: 'light' })`);
  await sleep(200);
  await js(`run('about'); 0`);
  await shot('15-about');
  await js(`document.getElementById('about-dialog').close(); run('shortcuts'); 0`);
  await shot('16-shortcuts');
  await js(`document.getElementById('shortcuts').close(); showPage(0); 0`);
  await shot('17-light-editor');
  await js(`run('home')`);
  await shot('18-light-home');

  // ----- Save a copy; a second notebook gets the next free name -----
  await js(`run('back'); run('save-copy')`);
  check('save a copy writes elsewhere and stays on the original', fs.existsSync(files.copy) && (await js(`state.path`)) === renamed);
  await js(`run('home')`);
  await sleep(300);
  check('Continue shows the last notebook with its sections', (await js(`document.querySelector('#continue-card .continue-name').textContent + ':' + document.querySelectorAll('#continue-card .chip').length`)) === 'Renamed book:1');
  await js(`document.querySelector('#starters .starter[title*="Botanical"]').click(); 0`);
  check('one click on a cover starts Book 1 with it', (await until(`state.path && state.path.endsWith('Book 1.ntb')`)) && fs.existsSync(path.join(library, 'Book 1.ntb')) && (await js(`state.nb.cover`)) === 'botanical');
  await js(`run('home')`);
  await sleep(300);
  await js(`document.getElementById('shelf-search').value = 'renam'; renderShelf(); 0`);
  check('the shelf search filters notebooks', (await js(`document.querySelectorAll('#home-recent .card, #home-pinned .card').length`)) >= 1 && (await js(`document.querySelectorAll('#home-recent .card').length`)) === 0);
  await js(`document.getElementById('shelf-search').value = ''; renderShelf(); 0`);
  check('home lists every notebook in the folder', (await js(`document.querySelectorAll('#home .card').length`)) === 2);
  check('notebooks in the folder offer Delete', (await js(`document.querySelectorAll('#home .card [aria-label="Delete notebook"]').length`)) === 2);
  await shot('19-home-two-books');

  // ----- Full screen and a second window -----
  await js(`run('back'); run('toggle-fullscreen'); 0`);
  await sleep(1200);
  check('full screen on', win.isFullScreen() && (await js(`state.fullscreen`)) && (await js(`document.getElementById('dock-fullscreen').getAttribute('aria-pressed')`)) === 'true');
  await js(`run('toggle-fullscreen'); 0`);
  await sleep(1200);
  check('full screen off', !win.isFullScreen());
  await js(`run('new-window'); 0`);
  await sleep(1500);
  check('a second window opens', BrowserWindow.getAllWindows().length === 2);
  BrowserWindow.getAllWindows().find((w) => w !== win)?.destroy();

  console.log(results.every(Boolean) ? 'ALL PASSED' : `${results.filter((r) => !r).length} FAILED`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
