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
const { zipSync, unzipSync } = require('fflate');

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
function writeNotebook(file, entries) {
  const input = {};
  for (const [name, data] of entries) input[name] = [data, { level: name.startsWith('assets/') ? 0 : 6 }];
  writeFileAtomic(file, zipSync(input));
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

module.exports = { readNotebook, peekNotebook, writeNotebook, writeFileAtomic, snapshot, listHistory, historyFile, isZip };
