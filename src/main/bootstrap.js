const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const format = require('../format');
const printing = require('../print');

const APP_NAME = 'Jotter';
const NTB_FILTER = [{ name: 'Jotter Notebook', extensions: ['ntb'] }];
const MAX_RECENTS = 30;
const SNAPSHOT_EVERY = 10 * 60 * 1000; // keep a version at most every 10 minutes per notebook
const BAR_HEIGHT = 44;

let initialPath = findNotebookArg(process.argv);

function findNotebookArg(argv) {
  return argv.slice(1).find((a) => /\.ntb$/i.test(a) && fs.existsSync(a)) || null;
}

const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// ---------- Settings (theme, recents, preferences) ----------

const userDir = (...p) => path.join(app.getPath('userData'), ...p);
const settingsFile = () => userDir('settings.json');

const DEFAULTS = {
  theme: 'system',
  uiScale: 1,
  sidebar: true,
  paperColor: 'white',
  eraserMode: 'rub',
  defaultCover: 'kolam',
  defaultPaper: 'plain',
  defaultMode: 'paged',
  penOnly: false,
  historyLimit: 30,
  libraryDir: '', // empty means Documents/Jotter
};
let settings = { ...DEFAULTS, recents: [] };

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...data, recents: Array.isArray(data.recents) ? data.recents : [] };
  } catch {}
}

function saveSettings() {
  try {
    format.writeFileAtomic(settingsFile(), JSON.stringify(settings));
  } catch (err) {
    console.error('Could not save settings:', err.message);
  }
}

function publicSettings() {
  const { recents, ...rest } = settings;
  return rest;
}

const uiScale = () => Math.min(1.5, Math.max(0.8, Number(settings.uiScale) || 1));

function applyTheme() {
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
  for (const ctx of windows.values()) ctx.win.webContents.setZoomFactor(uiScale());
}

// ---------- The notebooks folder ----------

// Every new notebook is created here and saved automatically; the home screen lists everything in it.
const libraryDir = () =>
  settings.libraryDir && path.isAbsolute(settings.libraryDir) ? settings.libraryDir : path.join(app.getPath('documents'), 'Jotter');
const inLibrary = (file) => samePath(path.dirname(file), libraryDir());
const cleanName = (name) => String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '').slice(0, 120);

function nextBookName() {
  for (let n = 1; ; n++) if (!fs.existsSync(path.join(libraryDir(), `Book ${n}.ntb`))) return `Book ${n}`;
}

function newNotebookPath(name) {
  const dir = libraryDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = cleanName(name) || nextBookName();
  let file = path.join(dir, `${base}.ntb`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).ntb`);
  return file;
}

const peeks = new Map(); // path -> { mtime, info }, so the folder is not re-read on every visit home
function peekCached(file, mtime) {
  const hit = peeks.get(file);
  if (hit && hit.mtime === mtime) return hit.info;
  let info = {};
  try {
    info = format.peekNotebook(file);
  } catch {}
  peeks.set(file, { mtime, info });
  return info;
}

// Recent notebooks plus every notebook in the notebooks folder, pinned first, then newest first.
function listNotebooks() {
  const seen = new Set();
  const list = settings.recents.map((r) => {
    seen.add(path.resolve(r.path).toLowerCase());
    let mtime = 0;
    try {
      mtime = fs.statSync(r.path).mtimeMs;
    } catch {}
    const info = mtime ? peekCached(r.path, mtime) : {};
    return { ...r, missing: !mtime, library: inLibrary(r.path), modified: mtime, sections: info.sections || [], pages: info.pages || r.pages };
  });
  let names = [];
  try {
    names = fs.readdirSync(libraryDir()).filter((n) => /\.ntb$/i.test(n));
  } catch {}
  for (const n of names) {
    const file = path.join(libraryDir(), n);
    if (seen.has(path.resolve(file).toLowerCase())) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {}
    const info = peekCached(file, mtime);
    list.push({ path: file, name: n.replace(/\.ntb$/i, ''), pages: info.pages || 1, cover: info.cover || null, sections: info.sections || [], lastOpened: mtime, modified: mtime, pinned: false, missing: false, library: true });
  }
  return list.sort((a, b) => (b.pinned - a.pinned) || b.lastOpened - a.lastOpened);
}
const listRecents = listNotebooks;

function touchRecent(entry) {
  if (!entry || typeof entry.path !== 'string') return;
  const old = settings.recents.find((r) => samePath(r.path, entry.path));
  const cover =
    typeof entry.cover === 'string' && /^[a-z]{3,12}$/.test(entry.cover) ? entry.cover : (old && old.cover) || null;
  const next = {
    path: entry.path,
    name: path.basename(entry.path).replace(/\.ntb$/i, ''),
    pages: Number(entry.pages) || (old && old.pages) || 1,
    lastOpened: Date.now(),
    pinned: !!(old && old.pinned),
    cover,
  };
  settings.recents = [next, ...settings.recents.filter((r) => !samePath(r.path, entry.path))];
  const pinned = settings.recents.filter((r) => r.pinned);
  const rest = settings.recents.filter((r) => !r.pinned).slice(0, MAX_RECENTS);
  settings.recents = [...pinned, ...rest].sort((a, b) => b.lastOpened - a.lastOpened);
  saveSettings();
}

// ---------- Windows ----------

// One entry per window: its notebook state as reported by the page, and the file parts already sent for saving.
const windows = new Map();

const ctxOf = (e) => windows.get(e.sender.id);
const focusedCtx = () => {
  const w = BrowserWindow.getFocusedWindow();
  return w ? windows.get(w.webContents.id) : [...windows.values()][0];
};
const openElsewhere = (ctx, file) => [...windows.values()].find((c) => c !== ctx && samePath(c.path, file));

function overlayColors(dark = nativeTheme.shouldUseDarkColors) {
  return dark ? { color: '#141416', symbolColor: '#ececef' } : { color: '#f3f3f1', symbolColor: '#19191c' };
}

function createWindow(boot = {}) {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141416' : '#f3f3f1',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors(), height: Math.round(BAR_HEIGHT * uiScale()) },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  const ctx = {
    win,
    id: win.webContents.id,
    path: null,
    hasNotebook: false,
    dirty: false,
    closeConfirmed: false,
    cache: new Map(), // file parts from the last save, so unchanged pages need not be sent again
    snapshots: new Map(),
    draftId: crypto.randomUUID(),
    boot,
  };
  windows.set(ctx.id, ctx);

  // Undo and redo reach the notebook however they are given: the keyboard, a tablet pen button set to
  // Ctrl+Z, or an "Undo" app command from a pen or mouse driver. They are caught here, before the page,
  // so the page's own text undo never runs in their place.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = (input.key || '').toLowerCase();
    const z = k === 'z' || input.code === 'KeyZ';
    const y = k === 'y' || input.code === 'KeyY';
    if (!z && !y) return;
    event.preventDefault();
    win.webContents.send('command', z && !input.shift ? 'undo' : 'redo');
  });
  win.on('app-command', (_e, name) => {
    if (name === 'undo' || name === 'redo') win.webContents.send('command', name);
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(uiScale()));

  // Never navigate away from the app or open new windows from note content.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('enter-full-screen', () => send(ctx, 'fullscreen', true));
  win.on('leave-full-screen', () => send(ctx, 'fullscreen', false));
  win.on('close', (e) => {
    if (ctx.dirty && !ctx.closeConfirmed) {
      e.preventDefault();
      send(ctx, 'command', 'request-close');
    }
  });
  win.on('closed', () => windows.delete(ctx.id));
  return ctx;
}

function send(ctx, channel, ...args) {
  if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args);
}

// Open a notebook in a window of its own, or bring forward the window that already has it.
function openInNewWindow(file) {
  const other = file && openElsewhere(null, file);
  if (other) {
    if (other.win.isMinimized()) other.win.restore();
    other.win.focus();
    return;
  }
  createWindow({ file });
}

function buildMenu() {
  const cmd = (name) => () => send(focusedCtx(), 'command', name);
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New Notebook', accelerator: 'Ctrl+N', click: cmd('new') },
        { label: 'New Window', accelerator: 'Ctrl+Shift+M', click: () => createWindow() },
        { label: 'Open…', accelerator: 'Ctrl+O', click: cmd('open') },
        { label: 'Home', accelerator: 'Ctrl+H', click: cmd('home') },
        { type: 'separator' },
        { label: 'Save Now', accelerator: 'Ctrl+S', click: cmd('save') },
        { label: 'Save a Copy…', accelerator: 'Ctrl+Shift+S', click: cmd('save-copy') },
        { label: 'Version History…', click: cmd('history') },
        { type: 'separator' },
        { label: 'Export as PDF…', accelerator: 'Ctrl+E', click: cmd('export-pdf') },
        { label: 'Print…', accelerator: 'Ctrl+P', click: cmd('print') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Ctrl+,', click: cmd('settings') },
        { label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Ctrl+Z', click: cmd('undo') },
        { label: 'Redo', accelerator: 'Ctrl+Y', click: cmd('redo') },
        { type: 'separator' },
        // Clipboard keys are left to the page so the selection tool can copy ink.
        { role: 'cut', registerAccelerator: false },
        { role: 'copy', registerAccelerator: false },
        { role: 'paste', registerAccelerator: false },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'Ctrl+F', click: cmd('find') },
      ],
    },
    {
      label: '&Page',
      submenu: [
        { label: 'New Page', accelerator: 'Ctrl+Shift+N', click: cmd('add-page') },
        { label: 'New Section', accelerator: 'Ctrl+T', click: cmd('add-section') },
        { label: 'Rename Section', accelerator: 'Ctrl+Shift+R', click: cmd('rename-section') },
        { label: 'Duplicate Page', click: cmd('duplicate-page') },
        { label: 'Previous Page', accelerator: 'Ctrl+PageUp', click: cmd('prev-page') },
        { label: 'Next Page', accelerator: 'Ctrl+PageDown', click: cmd('next-page') },
        { type: 'separator' },
        { label: 'Delete Page', click: cmd('delete-page') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Show/Hide Page List', accelerator: 'Ctrl+\\', click: cmd('toggle-sidebar') },
        { label: 'Focus Mode', accelerator: 'Ctrl+Shift+F', click: cmd('toggle-focus') },
        { label: 'Full Screen', accelerator: 'F11', click: () => toggleFullscreen(focusedCtx()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'Ctrl+=', click: cmd('zoom-in') },
        { label: 'Zoom Out', accelerator: 'Ctrl+-', click: cmd('zoom-out') },
        { label: 'Actual Size', accelerator: 'Ctrl+0', click: cmd('zoom-reset') },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: cmd('shortcuts') },
        { label: `About ${APP_NAME}`, click: cmd('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function toggleFullscreen(ctx, on) {
  if (ctx) ctx.win.setFullScreen(typeof on === 'boolean' ? on : !ctx.win.isFullScreen());
}

// ---------- Reading notebooks ----------

function readForPage(file) {
  try {
    return { path: file, ...format.readNotebook(file) };
  } catch (err) {
    return { error: `Could not read the file.\n${err.message}` };
  }
}

const draftsDir = () => userDir('drafts');
const draftPath = (ctx) => path.join(draftsDir(), `${ctx.draftId}.ntb`);

function leftoverDrafts() {
  try {
    return fs
      .readdirSync(draftsDir())
      .filter((n) => n.endsWith('.ntb'))
      .map((n) => path.join(draftsDir(), n));
  } catch {
    return [];
  }
}

// ---------- IPC ----------

ipcMain.handle('app:ready', (e) => {
  const ctx = ctxOf(e);
  const { file, draft } = ctx.boot;
  ctx.boot = {};
  let draftFile = null;
  if (draft) {
    const loaded = readForPage(draft);
    fs.rmSync(draft, { force: true }); // the page saves its own recovery copy from now on
    if (!loaded.error) draftFile = loaded;
  }
  return {
    file: file ? readForPage(file) : null,
    draft: draftFile,
    settings: publicSettings(),
    recents: listRecents(),
    fullscreen: ctx.win.isFullScreen(),
    version: app.getVersion(),
  };
});

ipcMain.on('app:state', (e, s) => {
  const ctx = ctxOf(e);
  if (!ctx) return;
  ctx.dirty = !!s.dirty;
  ctx.path = typeof s.path === 'string' ? s.path : null;
  ctx.hasNotebook = !!s.name;
  ctx.win.setTitle(s.name ? `${s.dirty ? '● ' : ''}${s.name} — ${APP_NAME}` : APP_NAME);
});

ipcMain.on('app:close-confirmed', (e) => {
  const ctx = ctxOf(e);
  ctx.closeConfirmed = true;
  ctx.win.close();
});

ipcMain.on('window:fullscreen', (e, on) => toggleFullscreen(ctxOf(e), on));
ipcMain.on('window:new', (e, file) => openInNewWindow(typeof file === 'string' ? file : null));
ipcMain.on('window:overlay', (e, o) => {
  const ctx = ctxOf(e);
  const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
  if (ctx && hex(o.color) && hex(o.symbolColor)) {
    ctx.win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: Math.round(BAR_HEIGHT * uiScale()) });
  }
});

ipcMain.handle('settings:set', (_e, patch) => {
  for (const key of Object.keys(DEFAULTS)) {
    if (patch && key in patch && typeof patch[key] === typeof DEFAULTS[key]) settings[key] = patch[key];
  }
  settings.historyLimit = Math.min(200, Math.max(1, Math.round(settings.historyLimit)));
  saveSettings();
  applyTheme();
  for (const ctx of windows.values()) send(ctx, 'settings', publicSettings());
  return publicSettings();
});

ipcMain.handle('recents:list', () => listRecents());
ipcMain.handle('recents:touch', (_e, entry) => touchRecent(entry));
ipcMain.handle('recents:remove', (_e, p) => {
  settings.recents = settings.recents.filter((r) => r.path !== p);
  saveSettings();
  return listRecents();
});
ipcMain.handle('recents:pin', (_e, p, pinned) => {
  let r = settings.recents.find((x) => samePath(x.path, p));
  if (!r && inLibrary(p) && fs.existsSync(p)) {
    r = { path: p, name: path.basename(p).replace(/\.ntb$/i, ''), pages: 1, lastOpened: fs.statSync(p).mtimeMs, pinned: false, cover: null };
    settings.recents.push(r);
  }
  if (r) r.pinned = !!pinned;
  saveSettings();
  return listRecents();
});

ipcMain.handle('library:info', () => ({ dir: libraryDir(), next: nextBookName() }));
ipcMain.handle('library:new', (_e, name) => {
  try {
    return { path: newNotebookPath(name) };
  } catch (err) {
    return { error: `Could not create the notebook in ${libraryDir()}.\n${err.message}` };
  }
});
ipcMain.handle('library:choose', async (e) => {
  const res = await dialog.showOpenDialog(ctxOf(e).win, {
    title: 'Choose where notebooks are kept',
    defaultPath: libraryDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths[0]) {
    settings.libraryDir = res.filePaths[0];
    saveSettings();
  }
  return { dir: libraryDir(), next: nextBookName() };
});
ipcMain.handle('library:open', () => {
  fs.mkdirSync(libraryDir(), { recursive: true });
  return shell.openPath(libraryDir());
});
// Move a notebook from the notebooks folder to the Recycle Bin (it can be restored from there).
ipcMain.handle('notebook:trash', async (_e, p) => {
  if (typeof p !== 'string' || !inLibrary(p) || !fs.existsSync(p)) return { error: 'Only notebooks in the notebooks folder can be deleted here.' };
  if (openElsewhere(null, p)) return { error: 'Close the window that has this notebook open first.' };
  try {
    await shell.trashItem(p);
  } catch (err) {
    return { error: `Could not move the notebook to the Recycle Bin.\n${err.message}` };
  }
  settings.recents = settings.recents.filter((r) => !samePath(r.path, p));
  saveSettings();
  return { list: listNotebooks() };
});

ipcMain.handle('draft:clear', (e) => fs.rmSync(draftPath(ctxOf(e)), { force: true }));

ipcMain.handle('dialog:open', async (e) => {
  const ctx = ctxOf(e);
  const res = await dialog.showOpenDialog(ctx.win, {
    title: 'Open Notebook',
    defaultPath: app.getPath('documents'),
    filters: NTB_FILTER,
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return openForWindow(ctx, res.filePaths[0]);
});

function openForWindow(ctx, file) {
  const other = openElsewhere(ctx, file);
  if (other) {
    other.win.focus();
    return { focused: true };
  }
  return readForPage(file);
}

// Only notebooks the user has opened before, or ones in the notebooks folder, can be read by path.
ipcMain.handle('notebook:read', (e, p) => {
  if (typeof p !== 'string' || (!settings.recents.some((r) => r.path === p) && !inLibrary(p))) {
    return { error: 'This notebook is not in the recent list.' };
  }
  if (!fs.existsSync(p)) return { error: `The file could not be found. It may have been moved or deleted.\n${p}` };
  return openForWindow(ctxOf(e), p);
});

// Rename the notebook's file in place (same folder, new name).
ipcMain.handle('notebook:rename', (e, oldPath, newName) => {
  const ctx = ctxOf(e);
  if (!samePath(ctx.path, oldPath)) return { error: 'Only the open notebook can be renamed.' };
  const name = String(newName).trim().replace(/[. ]+$/, '');
  if (!name || name.length > 120 || /[\\/:*?"<>|\x00-\x1f]/.test(name)) {
    return { error: 'That name cannot be used. Avoid the characters \\ / : * ? " < > |' };
  }
  const target = path.join(path.dirname(oldPath), `${name}.ntb`);
  if (!samePath(target, oldPath) && fs.existsSync(target)) return { error: `A notebook named “${name}” already exists in this folder.` };
  try {
    fs.renameSync(oldPath, target);
  } catch (err) {
    return { error: `Could not rename the notebook.\n${err.message}` };
  }
  const entry = settings.recents.find((r) => samePath(r.path, oldPath));
  if (entry) {
    entry.path = target;
    entry.name = name;
    saveSettings();
  }
  ctx.path = target;
  return { path: target };
});

/*
  Save. The page sends notebook.json in full, and for each page and image either its data or only its
  name when it has not changed since the last save; unchanged parts are taken from the window's cache.
  If the cache is missing a part (for example after an error), the page is asked to send everything.
*/
ipcMain.handle('notebook:save', async (e, req) => {
  const ctx = ctxOf(e);
  const entries = new Map([['notebook.json', Buffer.from(String(req.notebook), 'utf8')]]);
  for (const part of [...(req.pages || []), ...(req.assets || [])]) {
    const name = String(part.name);
    if (!/^(pages\/[\w-]+\.json|assets\/[\w-]+\.(png|jpe?g|gif|webp))$/.test(name)) continue;
    if (typeof part.data === 'string') {
      entries.set(name, name.startsWith('assets/') ? Buffer.from(part.data, 'base64') : Buffer.from(part.data, 'utf8'));
    } else if (ctx.cache.has(name)) {
      entries.set(name, ctx.cache.get(name));
    } else {
      return { resend: true };
    }
  }
  ctx.cache = entries;

  if (req.draft) {
    try {
      fs.mkdirSync(draftsDir(), { recursive: true });
      format.writeNotebook(draftPath(ctx), entries);
      return { path: req.path || null };
    } catch (err) {
      return { error: `Could not write the recovery copy.\n${err.message}` };
    }
  }

  if (req.copy) {
    const res = await dialog.showSaveDialog(ctx.win, {
      title: 'Save a Copy',
      defaultPath: path.join(app.getPath('documents'), `${req.suggestedName || 'Notebook'} copy.ntb`),
      filters: NTB_FILTER,
    });
    if (res.canceled || !res.filePath) return null;
    let copy = res.filePath;
    if (!/\.ntb$/i.test(copy)) copy += '.ntb';
    if (samePath(copy, ctx.path) || openElsewhere(ctx, copy)) return { error: 'Choose a different name for the copy.' };
    try {
      format.writeNotebook(copy, entries);
      return { path: req.path, copy };
    } catch (err) {
      return { error: `Could not save the copy.\n${err.message}` };
    }
  }

  let target = req.path;
  if (!target || req.saveAs) {
    const res = await dialog.showSaveDialog(ctx.win, {
      title: 'Save Notebook',
      defaultPath: req.path || path.join(app.getPath('documents'), `${req.suggestedName || 'Untitled'}.ntb`),
      filters: NTB_FILTER,
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
    if (!/\.ntb$/i.test(target)) target += '.ntb';
    if (openElsewhere(ctx, target)) return { error: 'That notebook is open in another window. Choose another name.' };
  }
  try {
    const key = path.resolve(target).toLowerCase();
    // Keep the file as it was before this save, at most every ten minutes (or when asked, after a restore).
    if (fs.existsSync(target) && (req.snapshot || Date.now() - (ctx.snapshots.get(key) || 0) > SNAPSHOT_EVERY)) {
      format.snapshot(userDir('history'), target, settings.historyLimit);
      ctx.snapshots.set(key, Date.now());
    }
    format.writeNotebook(target, entries);
    ctx.path = target;
    return { path: target };
  } catch (err) {
    return { error: `Could not save the notebook.\n${err.message}` };
  }
});

ipcMain.handle('history:list', (e) => {
  const ctx = ctxOf(e);
  return ctx.path ? format.listHistory(userDir('history'), ctx.path) : [];
});
ipcMain.handle('history:read', (e, id) => {
  const ctx = ctxOf(e);
  try {
    const file = format.historyFile(userDir('history'), ctx.path, String(id));
    return { ...format.readNotebook(file), path: ctx.path };
  } catch (err) {
    return { error: `Could not read that version.\n${err.message}` };
  }
});

ipcMain.handle('shell:open', (_e, url) => {
  if (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
});
ipcMain.handle('app:licences', () => {
  const candidates = [
    path.join(path.dirname(process.execPath), 'LICENSES.chromium.html'),
    path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (file) shell.openPath(file);
  return !!file;
});

// ---------- Export and print ----------
require('./export').register({ ctxOf });

// ---------- App lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = findNotebookArg(argv);
    const ctx = focusedCtx();
    if (!file) {
      if (ctx) ctx.win.focus();
      return;
    }
    // Reuse a window that has no notebook open; otherwise give the notebook its own window.
    const idle = [...windows.values()].find((c) => !c.hasNotebook);
    if (idle && !openElsewhere(null, file)) {
      idle.win.focus();
      send(idle, 'open-file', openForWindow(idle, file));
    } else {
      openInNewWindow(file);
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    applyTheme();
    buildMenu();
    const drafts = leftoverDrafts();
    if (drafts.length) drafts.forEach((draft, i) => createWindow({ draft, file: i === 0 ? initialPath : null }));
    else createWindow({ file: initialPath });
    initialPath = null;
  });

  app.on('window-all-closed', () => app.quit());
}


