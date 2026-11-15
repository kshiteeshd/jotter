'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow, dialog, ipcMain, app } = require('electron');
const printing = require('../print');

function register({ ctxOf }) {
  async function withSheetWindow(html, fn, scale = 0) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotter-'));
    const tmpHtml = path.join(tmpDir, 'sheets.html');
    const k = scale || 1;
    const win = new BrowserWindow({
      show: false,
      width: printing.SHEET_W * k,
      height: printing.SHEET_H * k,
      useContentSize: true,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, offscreen: !!scale },
    });
    if (scale) win.webContents.setZoomFactor(scale);
    try {
      fs.writeFileSync(tmpHtml, html, 'utf8');
      await win.loadFile(tmpHtml);
      return await fn(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async function askSavePath(ctx, title, name, ext, label) {
    const res = await dialog.showSaveDialog(ctx.win, {
      title,
      defaultPath: path.join(app.getPath('documents'), `${name || 'Notebook'}.${ext}`),
      filters: [{ name: label, extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    return new RegExp(`\\.${ext}$`, 'i').test(res.filePath) ? res.filePath : `${res.filePath}.${ext}`;
  }

  ipcMain.handle('export:pdf', async (e, { pages, suggestedName, background }) => {
    const ctx = ctxOf(e);
    const target = await askSavePath(ctx, 'Export as PDF', suggestedName, 'pdf', 'PDF Document');
    if (!target) return null;
    try {
      const pdf = await withSheetWindow(printing.buildHtml(pages, background), (w) =>
        w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      );
      fs.writeFileSync(target, pdf);
      return { path: target };
    } catch (err) {
      return { error: `Could not export the PDF.\n${err.message}` };
    }
  });

  ipcMain.handle('export:print', async (_e, { pages, background }) => {
    try {
      return await withSheetWindow(
        printing.buildHtml(pages, background),
        (w) =>
          new Promise((resolve) =>
            w.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (ok, reason) =>
              resolve(ok || reason === 'cancelled' ? { ok } : { error: `Could not print.\n${reason}` })
            )
          )
      );
    } catch (err) {
      return { error: `Could not print.\n${err.message}` };
    }
  });

  ipcMain.handle('export:png', async (e, { pages, suggestedName, background }) => {
    const ctx = ctxOf(e);
    const target = await askSavePath(ctx, 'Export Page as Image', suggestedName, 'png', 'PNG Image');
    if (!target) return null;
    try {
      const count = Math.min(400, Math.max(1, pages[0].sheets | 0));
      const files = [];
      for (let i = 0; i < count; i++) {
        const png = await withSheetWindow(
          printing.buildHtml(pages, background, { page: 0, sheet: i }),
          async (w) => {
            w.webContents.setZoomFactor(2);
            await new Promise((r) => setTimeout(r, 300));
            const shot = w.webContents.capturePage();
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('The page did not render in time.')), 15000));
            return (await Promise.race([shot, timeout])).toPNG();
          },
          2
        );
        const file = count === 1 ? target : target.replace(/\.png$/i, `-${i + 1}.png`);
        fs.writeFileSync(file, png);
        files.push(file);
      }
      return { path: files[0], count };
    } catch (err) {
      return { error: `Could not export the image.\n${err.message}` };
    }
  });

  ipcMain.handle('export:text', async (e, { text, suggestedName }) => {
    const ctx = ctxOf(e);
    const target = await askSavePath(ctx, 'Export as Markdown', suggestedName, 'md', 'Markdown');
    if (!target) return null;
    try {
      fs.writeFileSync(target, String(text), 'utf8');
      return { path: target };
    } catch (err) {
      return { error: `Could not export.\n${err.message}` };
    }
  });
}

module.exports = { register };
