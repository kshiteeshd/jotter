const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, screen } = require('electron');
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

/*
  The development copy (`npm start`) keeps a profile of its own: its own settings, recent list, recovery
  copies and single-instance lock, so it never takes over, or is taken over by, the installed Jotter. Its
  first start borrows the installed copy's settings once. (Tests and scripts set their own profile.)
*/
if (!app.isPackaged && path.resolve(app.getPath('userData')).toLowerCase() === path.join(app.getPath('appData'), app.getName()).toLowerCase()) {
  const shared = path.join(app.getPath('appData'), 'Jotter');
  const dev = path.join(app.getPath('appData'), 'Jotter Development');
  try {
    if (!fs.existsSync(path.join(dev, 'settings.json')) && fs.existsSync(path.join(shared, 'settings.json'))) {
      fs.mkdirSync(dev, { recursive: true });
      fs.copyFileSync(path.join(shared, 'settings.json'), path.join(dev, 'settings.json'));
    }
  } catch {}
  app.setPath('userData', dev);
}

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
  paperTexture: 'none',
  dockAutoHide: true,
  eraserMode: 'rub',
  defaultCover: 'kolam',
  defaultPaper: 'plain',
  defaultMode: 'paged',
  penOnly: false,
  spellcheck: true,
  historyLimit: 30,
  historyBudgetMB: 500,
  libraryDir: '', // empty means Documents/Jotter
  tools: {}, // each tool's colour and size, as you last left them
  exportPrefs: {}, // the answers you last gave when exporting
  zoom: 0, // 0: fit the page to the window
};
const PRIVATE = ['recents', 'window'];
let settings = { ...DEFAULTS, recents: [], window: null };

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...data, recents: Array.isArray(data.recents) ? data.recents : [], window: data.window || null };
    for (const key of Object.keys(DEFAULTS)) if (typeof settings[key] !== typeof DEFAULTS[key] || settings[key] === null) settings[key] = DEFAULTS[key];
  } catch {}
}

/*
  Settings are written a moment after they change, in the background (your place in a notebook is
  remembered every few seconds while you scroll), and at once when Jotter quits.
*/
let settingsTimer = 0;
let settingsWriting = Promise.resolve();
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = 0;
    const data = JSON.stringify(settings);
    settingsWriting = settingsWriting
      .then(() => format.writeFileAtomicAsync(settingsFile(), data))
      .catch((err) => console.error('Could not save settings:', err.message));
  }, 400);
}
function flushSettings() {
  if (!settingsTimer) return;
  clearTimeout(settingsTimer);
  settingsTimer = 0;
  try {
    format.writeFileAtomic(settingsFile(), JSON.stringify(settings));
  } catch (err) {
    console.error('Could not save settings:', err.message);
  }
}

function publicSettings() {
  const rest = { ...settings };
  for (const k of PRIVATE) delete rest[k];
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

// Where you were in a notebook: the section, the page (by id) and how far down the page (in page units).
function validPlace(at) {
  if (!at || typeof at !== 'object') return null;
  const sec = Number(at.sec);
  const y = Number(at.y);
  if (!Number.isInteger(sec) || sec < 0 || sec > 10000 || typeof at.page !== 'string' || !/^[\w-]{1,64}$/.test(at.page)) return null;
  return { sec, page: at.page, y: Number.isFinite(y) ? Math.max(0, Math.min(1e6, Math.round(y))) : 0 };
}
const placeOf = (file) => (settings.recents.find((r) => samePath(r.path, file)) || {}).at || null;

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
    at: validPlace(entry.at) || (old && old.at) || null,
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

// Where a new window opens: where the last one was (if that is still on a screen), or a little below
// and to the right of the window you are in.
function windowPlace() {
  const w = settings.window;
  const onScreen = (b) =>
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width - 120 && b.x + b.width > a.x + 120 && b.y >= a.y - 8 && b.y < a.y + a.height - 80;
    });
  const valid = w && [w.x, w.y, w.width, w.height].every(Number.isFinite) && w.width >= 860 && w.height >= 560;
  const from = BrowserWindow.getFocusedWindow();
  if (from && !from.isFullScreen()) {
    const b = from.getNormalBounds();
    const next = { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height };
    return onScreen(next) ? next : { width: b.width, height: b.height };
  }
  if (valid && onScreen(w)) return { x: w.x, y: w.y, width: w.width, height: w.height, maximized: !!w.maximized };
  return { width: valid ? w.width : 1320, height: valid ? w.height : 880 };
}

function rememberPlace(win) {
  if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  settings.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  saveSettings();
}

function createWindow(boot = {}) {
  const place = windowPlace();
  const win = new BrowserWindow({
    ...(place.x !== undefined ? { x: place.x, y: place.y } : {}),
    width: place.width,
    height: place.height,
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
  if (place.maximized) win.maximize();
  let placeTimer = 0;
  const keepPlace = () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => rememberPlace(win), 600);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, keepPlace);
  const ctx = {
    win,
    id: win.webContents.id,
    path: null,
    hasNotebook: false,
    dirty: false,
    closeConfirmed: false,
    cache: new Map(), // file parts from the last save, so unchanged pages need not be sent again
    saved: new Map(), // the parts as last written to the notebook's own file
    stamp: null, // the notebook file as last read or written (see format.fileStamp)
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
  // If the page crashes, it starts again from its recovery copy (or the notebook as last saved).
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    format.settled(draftPath(ctx)).then(() => {
      const draft = fs.existsSync(draftPath(ctx)) ? draftPath(ctx) : null;
      ctx.boot = draft ? { draft } : { file: ctx.path, resume: !ctx.path };
      Object.assign(ctx, { cache: new Map(), saved: new Map(), dirty: false });
      if (!win.isDestroyed()) win.reload();
    });
  });
  win.on('close', (e) => {
    rememberPlace(win);
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

function readForPage(file, ctx = null) {
  try {
    const stamp = format.fileStamp(file);
    const data = format.readNotebook(file);
    if (ctx) ctx.stamp = stamp && { ...stamp, crc: data.crc };
    delete data.crc;
    return { path: file, at: placeOf(file), ...data };
  } catch (err) {
    return { error: `Could not read the file.\n${err.message}` };
  }
}

/*
  A recovery copy of a notebook that has a file holds only what changed since the file was last saved;
  restoring it lays those parts over the file. If the file has changed elsewhere since, the next save asks
  before replacing it.
*/
function readDraft(ctx, draft) {
  const loaded = readForPage(draft);
  if (loaded.error || !loaded.v3) return loaded;
  let meta = {};
  try {
    meta = JSON.parse(loaded.v3.notebook);
  } catch {}
  if (typeof meta.draftOf !== 'string' || !fs.existsSync(meta.draftOf)) return loaded;
  try {
    const base = format.readNotebook(meta.draftOf);
    if (base.v3) {
      loaded.v3.pages = { ...base.v3.pages, ...loaded.v3.pages };
      loaded.v3.assets = { ...base.v3.assets, ...loaded.v3.assets };
    }
    const now = format.fileStamp(meta.draftOf);
    ctx.stamp = meta.draftBase && typeof meta.draftBase === 'object' ? meta.draftBase : now && { ...now, crc: base.crc };
  } catch {}
  return loaded;
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
  let draftFile = null;
  if (draft) {
    const loaded = readDraft(ctx, draft);
    fs.rmSync(draft, { force: true }); // the page saves its own recovery copy from now on
    if (!loaded.error) draftFile = loaded;
  }
  let resume = null;
  if (ctx.boot.resume && !file && !draftFile) {
    const last = [...settings.recents].sort((a, b) => b.lastOpened - a.lastOpened).find((r) => fs.existsSync(r.path) && !openElsewhere(ctx, r.path));
    if (last) resume = readForPage(last.path, ctx);
  }
  ctx.boot = {};
  return {
    file: file ? readForPage(file, ctx) : null,
    resume: resume && !resume.error ? resume : null,
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
    if (patch && key in patch && typeof patch[key] === typeof DEFAULTS[key] && patch[key] !== null) settings[key] = patch[key];
  }
  // Objects from the page are kept small and plain.
  for (const key of ['tools', 'exportPrefs']) {
    if (Array.isArray(settings[key]) || JSON.stringify(settings[key]).length > 4000) settings[key] = {};
  }
  settings.historyLimit = Math.min(200, Math.max(1, Math.round(settings.historyLimit)));
  settings.historyBudgetMB = Math.min(20000, Math.max(20, Math.round(settings.historyBudgetMB)));
  settings.zoom = settings.zoom === 0 ? 0 : Math.min(2, Math.max(0.5, Number(settings.zoom) || 0));
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

// Wait for a recovery copy still being written, so a stale one is never left behind.
ipcMain.handle('draft:clear', async (e) => {
  const file = draftPath(ctxOf(e));
  await format.settled(file);
  fs.rmSync(file, { force: true });
});

// Has the open notebook's file changed outside Jotter since it was read or saved?
ipcMain.handle('file:check', (e) => {
  const ctx = ctxOf(e);
  if (!ctx || !ctx.path || !ctx.stamp) return { changed: false };
  return { changed: format.changedSince(ctx.path, ctx.stamp) };
});

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
  return readForPage(file, ctx);
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
  if (ctx.stamp) ctx.stamp = { ...ctx.stamp, ...format.fileStamp(target) };
  return { path: target };
});

const historyOpts = () => ({ limit: settings.historyLimit, budget: settings.historyBudgetMB * 1e6 });

// "Book 1 (my changes).ntb", "Book 1 (my changes 2).ntb"…: a free name next to the notebook.
function besideName(file, label) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.ntb$/i, '');
  let out = path.join(dir, `${base} (${label}).ntb`);
  for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${base} (${label} ${n}).ntb`);
  return out;
}

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
      // For a notebook with a file, only what changed since its last save (see readDraft).
      let parts = entries;
      if (ctx.path && ctx.saved.size) {
        let meta = {};
        try {
          meta = JSON.parse(entries.get('notebook.json').toString('utf8'));
        } catch {}
        meta.draftBase = ctx.stamp;
        parts = new Map([['notebook.json', Buffer.from(JSON.stringify(meta), 'utf8')]]);
        for (const [name, buf] of entries) if (name !== 'notebook.json' && ctx.saved.get(name) !== buf) parts.set(name, buf);
      }
      await format.writeNotebookAsync(draftPath(ctx), parts);
      return { path: req.path || null };
    } catch (err) {
      return { error: `Could not write the recovery copy.\n${err.message}` };
    }
  }

  // The file changed elsewhere since it was read or saved (see the conflict check below). `req.resolve`
  // says what to do: keep your version in the file's version history (before opening the other one), save
  // yours as a copy next to it, or replace it.
  if (req.resolve === 'mine-in-history' && ctx.path) {
    try {
      await format.snapshotEntries(userDir('history'), ctx.path, entries, historyOpts());
      return { path: ctx.path };
    } catch (err) {
      return { error: `Could not keep your version.\n${err.message}` };
    }
  }
  if (req.resolve === 'copy' && ctx.path) {
    const copy = besideName(ctx.path, 'my changes');
    try {
      ctx.stamp = await format.writeNotebookAsync(copy, entries);
      ctx.saved = entries;
      ctx.path = copy;
      return { path: copy, bytes: ctx.stamp.size };
    } catch (err) {
      return { error: `Could not save your copy.\n${err.message}` };
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
      await format.writeNotebookAsync(copy, entries);
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
  if (!req.saveAs && req.resolve !== 'overwrite' && samePath(target, ctx.path) && ctx.stamp && format.changedSince(target, ctx.stamp)) {
    return { conflict: true, path: target };
  }
  try {
    const key = path.resolve(target).toLowerCase();
    // Keep the file as it was before this save, at most every ten minutes (or when asked: after a restore,
    // or when replacing a copy changed elsewhere).
    if (fs.existsSync(target) && (req.snapshot || req.resolve === 'overwrite' || Date.now() - (ctx.snapshots.get(key) || 0) > SNAPSHOT_EVERY)) {
      format.snapshot(userDir('history'), target, historyOpts());
      ctx.snapshots.set(key, Date.now());
    }
    ctx.stamp = await format.writeNotebookAsync(target, entries);
    ctx.saved = entries;
    ctx.path = target;
    return { path: target, bytes: ctx.stamp.size };
  } catch (err) {
    return { error: `Could not save the notebook.\n${err.message}` };
  }
});

ipcMain.handle('history:usage', () => format.historyUsage(userDir('history')));
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
    else createWindow({ file: initialPath, resume: true });
    initialPath = null;
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', flushSettings);
}

// For the tests: open a window as at startup.
module.exports = { createWindow };
