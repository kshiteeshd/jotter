// Unit tests for the file format and the ink geometry: `node --test test/`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const format = require('../src/format');
const Ink = require('../src/renderer/ink');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jotter-unit-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('notebook files round-trip, with images stored as binary', () => {
  const file = path.join(tmp, 'a.ntb');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const entries = new Map([
    ['notebook.json', Buffer.from(JSON.stringify({ format: 'jotter-notebook', version: 3, sections: [] }))],
    ['pages/p1.json', Buffer.from('{"title":"One"}')],
    ['assets/abc.png', png],
  ]);
  format.writeNotebook(file, entries);
  assert.ok(format.isZip(fs.readFileSync(file)));
  const read = format.readNotebook(file);
  assert.equal(JSON.parse(read.v3.notebook).version, 3);
  assert.equal(read.v3.pages['pages/p1.json'], '{"title":"One"}');
  assert.equal(read.v3.assets['assets/abc.png'], `data:image/png;base64,${png.toString('base64')}`);
});

test('the notebook writer makes standard zip files that reuse unchanged pages', async () => {
  const file = path.join(tmp, 'fast.ntb');
  const page = Buffer.from(JSON.stringify({ title: 'Ünïcode ✓', strokes: Array.from({ length: 2000 }, (_, i) => i) }));
  const pic = Buffer.from('89504e470d0a1a0a', 'hex');
  const entries = new Map([['notebook.json', Buffer.from('{"version":3}')], ['pages/a.json', page], ['assets/x.png', pic]]);
  await format.writeNotebookAsync(file, entries);
  const read = format.readNotebook(file);
  assert.equal(read.v3.pages['pages/a.json'], page.toString('utf8'));
  assert.equal(read.v3.assets['assets/x.png'], `data:image/png;base64,${pic.toString('base64')}`);
  // Same buffers again: nothing is compressed a second time, so it is quick even for big pages.
  const big = Buffer.alloc(8e6, 'x');
  entries.set('pages/b.json', big);
  await format.writeNotebookAsync(file, entries);
  const t = process.hrtime.bigint();
  await format.writeNotebookAsync(file, entries);
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 200, 'unchanged pages are not compressed again');
  // Saves to one file land in the order they were made.
  const last = new Map([['notebook.json', Buffer.from('{"version":3,"n":2}')]]);
  await Promise.all([format.writeNotebookAsync(file, new Map([['notebook.json', Buffer.from('{"version":3,"n":1}')]])), format.writeNotebookAsync(file, last)]);
  assert.equal(JSON.parse(format.readNotebook(file).v3.notebook).n, 2);
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')), []);
});

test('PDFs and prints carry the paper texture when asked, and nothing unknown', () => {
  const printing = require('../src/print');
  const page = [{ sheets: 1, paper: 'ruled', html: '<div>x</div>', ink: [null] }];
  assert.match(printing.buildHtml(page, '#fbf6e6', null, 'linen'), /background-image: url\("data:image\/svg\+xml/);
  assert.match(printing.buildHtml(page, '#fbf6e6', null, 'nonsense'), /background-image: none/);
  assert.match(printing.buildHtml(page, 'red', null), /background-color: #ffffff/);
});

test('old JSON notebooks are read as text', () => {
  const file = path.join(tmp, 'old.ntb');
  fs.writeFileSync(file, '{"format":"jotter-notebook","pages":[]}');
  assert.deepEqual(format.readNotebook(file), { text: '{"format":"jotter-notebook","pages":[]}' });
});

test('unexpected archive entries are ignored', () => {
  const file = path.join(tmp, 'odd.ntb');
  format.writeNotebook(file, new Map([['notebook.json', Buffer.from('{}')], ['../evil.json', Buffer.from('x')], ['pages/a.exe', Buffer.from('x')]]));
  const read = format.readNotebook(file);
  assert.deepEqual(Object.keys(read.v3.pages), []);
});

test('version history keeps the newest copies only', () => {
  const file = path.join(tmp, 'h.ntb');
  const root = path.join(tmp, 'history');
  fs.writeFileSync(file, 'v');
  for (let i = 0; i < 4; i++) {
    format.snapshot(root, file, 2);
    const start = Date.now();
    while (Date.now() === start) {} // distinct millisecond names
  }
  const list = format.listHistory(root, file);
  assert.equal(list.length, 2);
  assert.ok(list[0].time > list[1].time);
  assert.throws(() => format.historyFile(root, file, '../x.ntb'));
});

const line = (x0, x1, y = 100, size = 4) => ({ tool: 'pen', color: '#000000', size, points: [x0, y, x1, y] });

test('rubbing out the middle of a stroke splits it in two', () => {
  const out = Ink.eraseAlong([line(0, 200)], 100, 80, 100, 120, 10);
  assert.equal(out.length, 2);
  const [a, b] = out.map((s) => Ink.boundsOf([s]));
  assert.ok(a.maxX < 95 && b.minX > 105, 'the erased gap is gone');
  assert.ok(a.minX <= 0 && b.maxX >= 200, 'the ends are kept');
});

test('erasing away from a stroke changes nothing', () => {
  const strokes = [line(0, 200)];
  assert.equal(Ink.eraseAlong(strokes, 100, 300, 120, 300, 10), null);
});

test('erasing a whole short stroke removes it', () => {
  assert.deepEqual(Ink.eraseAlong([line(95, 105)], 100, 100, 100, 100, 20), []);
});

test('pressure is kept on the pieces that remain', () => {
  const s = { tool: 'pen', color: '#000000', size: 4, points: [0, 100, 200, 100], w: [0.2, 0.8] };
  const out = Ink.eraseAlong([s], 100, 80, 100, 120, 10);
  for (const p of out) assert.equal(p.w.length, p.points.length / 2);
});

test('old eraser strokes are applied only to ink drawn before them', () => {
  const eraser = { tool: 'eraser', color: '#000000', size: 20, points: [100, 80, 100, 120] };
  const out = Ink.bakeErasers([line(0, 200), eraser, line(0, 200, 100, 2)]);
  assert.equal(out.length, 3, 'first line split in two, later line untouched');
  assert.ok(out.every((s) => s.tool === 'pen'));
  assert.equal(out[2].size, 2);
});

test('the lasso picks strokes that are mostly inside it', () => {
  const inside = line(10, 50);
  const outside = line(300, 400);
  const poly = [0, 50, 100, 50, 100, 150, 0, 150];
  assert.deepEqual(Ink.inLasso([inside, outside], poly), [inside]);
});

test('moving and resizing make new strokes', () => {
  const s = line(0, 100);
  const moved = Ink.translate(s, 10, 5);
  assert.deepEqual(moved.points, [10, 105, 110, 105]);
  assert.notEqual(moved, s);
  const big = Ink.scaleAbout(s, 0, 100, 2);
  assert.deepEqual(big.points, [0, 100, 200, 100]);
  assert.equal(big.size, 8);
});

test('shapes produce closed outlines', () => {
  const rect = Ink.shapePoints('rect', 0, 0, 10, 20);
  assert.deepEqual(rect.slice(0, 2), rect.slice(-2));
  const ellipse = Ink.shapePoints('ellipse', 0, 0, 100, 50);
  assert.equal(ellipse.length, 146);
  assert.equal(Ink.shapePoints('arrow', 0, 0, 100, 0).length, 10);
});

test('invalid strokes are rejected', () => {
  assert.ok(Ink.valid(line(0, 10)));
  assert.ok(!Ink.valid({ tool: 'pen', color: 'red', size: 3, points: [0, 0] }));
  assert.ok(!Ink.valid({ tool: 'pen', color: '#000000', size: 3, points: [0, 0, 1] }));
  assert.ok(!Ink.valid({ tool: 'eraser', size: 3, points: [0, 0] }));
  assert.ok(Ink.valid({ tool: 'eraser', size: 3, points: [0, 0] }, true));
});

test('steadying keeps both ends and smooths a pixel staircase', () => {
  const raw = [];
  for (let i = 0; i < 12; i++) raw.push(i, i % 2); // zig-zag of one pixel
  const out = [];
  for (let i = 0; i < 12; i++) out.push(...Ink.filterPoint(raw, i));
  assert.deepEqual(out.slice(0, 2), [0, 0]);
  assert.deepEqual(out.slice(-2), [11, 1]);
  for (let i = 2; i < 10; i++) assert.ok(Math.abs(out[i * 2 + 1] - 0.5) <= 0.13, `point ${i} is steadied`);
});

test('tapered strokes thin out by distance at both ends', () => {
  const s = { tool: 'pen', color: '#000000', size: 3, points: [], taper: 1 };
  for (let i = 0; i <= 100; i++) s.points.push(i * 2, 0);
  const w = Ink.widths(s);
  assert.equal(w.length, 101);
  assert.ok(w[0] < 0.2 && w[100] < 0.2, 'ends are thin');
  assert.equal(w[50], 0.5, 'middle is full size');
  assert.equal(Ink.widths({ ...s, taper: undefined }), null);
});
