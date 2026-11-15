// Colour contrast audit: `npx electron scripts/contrast.js <output-dir>`
// Opens every screen, panel and dialog in the light and dark themes with each notebook cover, and checks
// that all visible text and icons stand out from what is behind them (WCAG: 4.5:1 for text, 3:1 for
// large text and icons). Prints each failure once, with where it appeared.
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'contrast-out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'profile'));
fs.mkdirSync(path.join(out, 'profile'), { recursive: true });
fs.writeFileSync(path.join(out, 'profile', 'settings.json'), JSON.stringify({ libraryDir: path.join(out, 'library') }));
dialog.showMessageBox = async () => ({ response: 0 });

require('../src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: returns the elements that fail.
const AUDIT = String.raw`(label) => {
  const parse = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
    }
    return null;
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // What is painted behind an element: its own and its ancestors' backgrounds, stacked.
  const backdrop = (el, includeSelf = true) => {
    const layers = [];
    for (let n = includeSelf ? el : el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const opacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const visible = (el) => {
    if (el.closest('[hidden], #icons, #measure, .thumb, .cover, .fan, .cover-opt svg, #ring')) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const describe = (el) => {
    let d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    else if (el.classList.length) d += '.' + [...el.classList].join('.');
    const p = el.parentElement && (el.parentElement.id || el.parentElement.classList[0]);
    return p ? p + ' > ' + d : d;
  };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const fails = [];
  const test = (el, kind, text, min) => {
    const bg = backdrop(el);
    const col = parse(getComputedStyle(el).color);
    if (!col) return;
    const o = opacity(el);
    if (o < 0.05) return; // hidden until you point at it
    const fg = over([col[0], col[1], col[2], col[3] * o], bg);
    const r = ratio(fg, bg);
    if (r < min) fails.push({ label, where: describe(el), kind, text: text.slice(0, 32), ratio: Math.round(r * 100) / 100, fg: hex(fg), bg: hex(bg) });
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.6 && Number(s.fontWeight) >= 600);
    if (ownText) test(el, 'text', ownText, large ? 3 : 4.5);
    else if ((el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'color' && el.type !== 'checkbox' && el.value) || (el.tagName === 'SELECT')) test(el, 'field', el.value, 4.5);
    else if (el.matches('svg.ic')) test(el, 'icon', el.closest('[aria-label],[title]')?.getAttribute('aria-label') || el.closest('[title]')?.title || 'icon', 3);
    if (el.matches('.swatch, .dye')) {
      const own = parse(s.backgroundColor);
      const behind = backdrop(el, false);
      const r = ratio(over(own, behind), behind);
      if (r < 1.25 && !/inset/.test(s.boxShadow)) fails.push({ label, where: describe(el), kind: 'swatch', text: el.title || el.getAttribute('aria-label') || '', ratio: Math.round(r * 100) / 100, fg: hex(own), bg: hex(behind), outline: s.boxShadow });
    }
  }
  // Drop-down lists open in a native pop-up: it uses the option's (or else the select's) own background
  // only when that is solid, and plain white otherwise.
  for (const sel of document.querySelectorAll('select')) {
    for (const opt of sel.querySelectorAll('option, optgroup')) {
      const own = parse(getComputedStyle(opt).backgroundColor);
      const box = parse(getComputedStyle(sel).backgroundColor);
      const bg = own && own[3] >= 1 ? own : box && box[3] >= 1 ? box : [255, 255, 255, 1];
      const col = parse(getComputedStyle(opt).color);
      const r = ratio(over(col, bg), bg);
      if (r < 4.5) fails.push({ label, where: describe(sel) + ' list', kind: 'option', text: (opt.label || opt.textContent).slice(0, 32), ratio: Math.round(r * 100) / 100, fg: hex(col), bg: hex(bg) });
    }
  }
  return fails;
}`;

app.whenReady().then(async () => {
  await sleep(1800);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  const wc = win.webContents;
  wc.on('console-message', (e) => {
    if (/Error/.test(e.message)) console.log('RENDERER:', e.message);
  });
  const js = (code) => wc.executeJavaScript(code, true);
  // Measure final colours, not frames of a fade-in.
  await wc.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  await js(`window.__audit = ${AUDIT}; 0`);

  // A notebook with something in every part of the screen.
  await js(`setNotebook(Model.newNotebook({ cover: 'kolam' }), null);
    el.editor.innerHTML = '<h1>Heading</h1><div>Body text and a <a href="https://example.com">link</a>.</div><ul class="checklist"><li class="done">Done item</li><li>Open item</li></ul><table><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table>';
    onEditorChanged(); addSection(); document.activeElement.blur(); showSection(0); 0`);
  await sleep(300);

  const states = {
    editor: `closePopovers(); 0`,
    'tool options (pen)': `setTool('pen'); 0`,
    'tool options (text)': `setTool('text'); 0`,
    'tool options (shape)': `setTool('shape'); 0`,
    'tool options (eraser)': `setTool('eraser'); 0`,
    'tool options (select)': `setTool('select'); 0`,
    'page menu': `setTool('text'); openPageMenu(0, 300, 260); 0`,
    'section menu': `openSectionMenu(0, 120, 160); 0`,
    templates: `toggleTemplates(); 0`,
    search: `closePopovers(); openSearch(); el.searchInput.value = 'body'; runSearch(); 0`,
    'ink selected': `closePopovers(); setTool('pen'); setStrokes([{ tool: 'pen', color: '#1f1b18', size: 3, points: [100, 600, 300, 640] }]); redrawInk(); setTool('select'); selectStrokes(page().strokes); 0`,
    'focus mode': `clearSelection(); setTool('text'); setFocusMode(true); 0`,
    settings: `setFocusMode(false); openSettings(); 0`,
    'cover picker': `document.getElementById('settings-dialog').close(); pickCover({ title: 'New notebook', ok: 'Create', askName: true }); 0`,
    'message dialog': `document.getElementById('cover-dialog').close(); ask({ message: 'Delete “Page 1”?', detail: 'The page will be removed.', buttons: ['Delete', 'Cancel'], danger: true }); 0`,
    'link dialog': `document.getElementById('ask').close(); setTimeout(() => ask({ message: 'Add a link', detail: 'Text', input: { label: 'Web address', value: 'example.com' }, buttons: ['Add link', 'Cancel'] }), 50); 0`,
    about: `document.getElementById('ask').close(); openAbout(); 0`,
    shortcuts: `document.getElementById('about-dialog').close(); document.getElementById('shortcuts').showModal(); 0`,
    home: `document.getElementById('shortcuts').close(); showHome(); 0`,
  };

  const all = [];
  for (const theme of ['light', 'dark']) {
    await js(`applySettings({ theme: '${theme}' })`);
    await sleep(400);
    for (const cover of await js(`Covers.ids`)) {
      await js(`run('back'); state.nb.cover = '${cover}'; applyCoverTheme(); renderSections(); 0`);
      for (const [name, code] of Object.entries(states)) {
        if (name === 'home' && cover !== 'kolam') continue; // home does not follow the cover
        await js(code);
        await sleep(name === 'link dialog' ? 250 : 120);
        const fails = await js(`window.__audit(${JSON.stringify(`${theme} / ${cover} / ${name}`)})`);
        all.push(...fails);
        if (cover === 'kolam' || cover === 'blockprint') {
          fs.writeFileSync(path.join(out, `${theme}-${cover}-${name.replace(/\W+/g, '-')}.png`), (await wc.capturePage()).toPNG());
        }
      }
      await js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); closePopovers(); 0`);
    }
  }

  // Group identical problems: same element and colours, listing where they occur.
  const groups = new Map();
  for (const f of all) {
    const key = `${f.kind} ${f.where} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f.label);
  }
  const lines = [...groups].map(([k, labels]) => `${k}\n    in ${labels.length} views, e.g. ${labels.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(out, 'report.txt'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\n${groups.size} distinct problems (${all.length} occurrences)`);
  app.exit(0);
});
