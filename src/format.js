'use strict';

/*
  Notebook file format (.ntb).

  Version 3 is a zip archive:
    notebook.json        notebook metadata and the order of sections and pages
    pages/<id>.json      one file per page (text, ink, settings)
    assets/<hash>.<ext>  images, stored once as binary instead of base64 text

  Older notebooks (versions 1 and 2) are a single JSON text file and are still read.
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { unzipSync } = require('fflate');

const deflateRaw = promisify(zlib.deflateRaw);

const MAX_UNZIPPED = 1024 * 1024 * 1024; // refuse archives that expand beyond 1 GB
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const isZip = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4;

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// Reads a notebook file into the shape the renderer parses:
// { text } for old JSON notebooks, or { v3: { notebook, pages: {name: json}, assets: {name: dataUrl} } }.
function readNotebook(file) {
  const buf = fs.readFileSync(file);
  if (!isZip(buf)) return { text: buf.toString('utf8') };
  let total = 0;
  const files = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
    filter(f) {
      total += f.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('The notebook is too large to open.');
      return f.name === 'notebook.json' || /^pages\/[\w-]+\.json$/.test(f.name) || /^assets\/[\w-]+\.\w+$/.test(f.name);
    },
  });
  if (!files['notebook.json']) throw new Error('This file is not a Jotter notebook.');
  const dec = new TextDecoder();
  const pages = {};
  const assets = {};
  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith('pages/')) pages[name] = dec.decode(data);
    else if (name.startsWith('assets/')) {
      const mime = MIME[name.split('.').pop().toLowerCase()];
      if (mime) assets[name] = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    }
  }
  return { v3: { notebook: dec.decode(files['notebook.json']), pages, assets } };
}

// Cover, page count and sections of a notebook, reading only its small notebook.json (for the home screen).
function peekNotebook(file) {
  const buf = fs.readFileSync(file);
  if (!isZip(buf)) {
    const data = JSON.parse(buf.toString('utf8'));
    const pages = Array.isArray(data.pages) ? data.pages.length : 1;
    return { pages, cover: typeof data.cover === 'string' ? data.cover : null, sections: [{ title: 'Notes', color: '#2f4a8a', pages }] };
  }
  const files = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { filter: (f) => f.name === 'notebook.json' });
  const meta = JSON.parse(new TextDecoder().decode(files['notebook.json']));
  const sections = (Array.isArray(meta.sections) ? meta.sections : []).slice(0, 50).map((s) => ({
    title: typeof s.title === 'string' ? s.title.slice(0, 80) : 'Section',
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#2f4a8a',
    pages: Array.isArray(s.pages) ? s.pages.length : 0,
  }));
  const pages = sections.reduce((n, s) => n + s.pages, 0);
  return { pages: pages || 1, cover: typeof meta.cover === 'string' ? meta.cover : null, sections };
}

// entries: Map of name -> Uint8Array. Text is compressed; images are stored as they are.
/*
  Writing notebooks. Saving happens every time you pause, so it must stay cheap however big the notebook
  grows: each entry is compressed once and remembered by its content buffer (the main process reuses the
  buffer of every page that has not changed), and the compressing and the disk write happen off the main
  thread, which is also the thread that passes your pen and keyboard input to the page.
*/
const packed = new WeakMap(); // content buffer -> { method, body, crc, size }

function packWith(name, data, body) {
  const p = { method: body === data ? 0 : 8, body, crc: zlib.crc32(data), size: data.length };
  packed.set(data, p);
  return p;
}
const storeOnly = (name) => name.startsWith('assets/'); // pictures are compressed already

function packSync(name, data) {
  return packed.get(data) || packWith(name, data, storeOnly(name) ? data : zlib.deflateRawSync(data, { level: 6 }));
}
async function pack(name, data) {
  return packed.get(data) || packWith(name, data, storeOnly(name) ? data : await deflateRaw(data, { level: 6 }));
}

// A standard zip archive (readable by any zip tool) from packed entries.
function zipFrom(list) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, p] of list) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(p.method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(p.crc >>> 0, 14);
    local.writeUInt32LE(p.body.length, 18);
    local.writeUInt32LE(p.size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(p.method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(p.crc >>> 0, 16);
    dir.writeUInt32LE(p.body.length, 20);
    dir.writeUInt32LE(p.size, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, p.body);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + p.body.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

function writeNotebook(file, entries) {
  writeFileAtomic(file, zipFrom([...entries].map(([name, data]) => [name, packSync(name, data)])));
}

// Saves to the same file run one after another, so an older save can never land after a newer one.
const queues = new Map();
function writeNotebookAsync(file, entries) {
  const key = path.resolve(file).toLowerCase();
  const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const list = [];
    for (const [name, data] of entries) list.push([name, await pack(name, data)]);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, zipFrom(list));
    try {
      await fs.promises.rename(tmp, file);
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      throw err;
    }
  });
  queues.set(key, run);
  run.finally(() => queues.get(key) === run && queues.delete(key)).catch(() => {});
  return run;
}

// ---------- Version history ----------

const historyDir = (root, file) =>
  path.join(root, crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16));

// Copy the file as it is now into its history folder, keeping the newest `limit` copies.
function snapshot(root, file, limit) {
  if (!fs.existsSync(file)) return;
  const dir = historyDir(root, file);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, `${Date.now()}.ntb`));
  const old = listHistory(root, file).slice(Math.max(1, limit));
  for (const v of old) fs.rmSync(path.join(dir, v.id), { force: true });
}

function listHistory(root, file) {
  const dir = historyDir(root, file);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^\d+\.ntb$/.test(n))
    .map((n) => ({ id: n, time: Number(n.slice(0, -4)), size: fs.statSync(path.join(dir, n)).size }))
    .sort((a, b) => b.time - a.time);
}

function historyFile(root, file, id) {
  if (!/^\d+\.ntb$/.test(id)) throw new Error('Unknown version.');
  return path.join(historyDir(root, file), id);
}

module.exports = { readNotebook, peekNotebook, writeNotebook, writeNotebookAsync, writeFileAtomic, snapshot, listHistory, historyFile, isZip };
