'use strict';

/*
  Builds the HTML used for PDF export, printing and page images. Each A4 sheet is one section:
  the page's text (offset to the sheet), its paper lines, and the ink for that sheet as vector SVG.
*/

const fs = require('fs');
const path = require('path');
const Textures = require('./renderer/textures');

const SHEET_W = 794; // A4 at 96 dpi
const SHEET_H = 1122;
const PAPER_STYLES = ['plain', 'ruled', 'grid', 'dotted', 'kolam'];

const num = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

function sheets(pages, only) {
  const out = [];
  pages.forEach((p, pi) => {
    const paper = PAPER_STYLES.includes(p.paper) ? p.paper : 'plain';
    const s = num(p.scale, 0.05, 1, 1); // pages with ink outside the text column are scaled down to fit
    const x0 = num(p.offsetX, -100000, 0, 0);
    const count = num(p.sheets, 1, 400, 1);
    for (let i = 0; i < count; i++) {
      if (only && (only.page !== pi || only.sheet !== i)) continue;
      const top = -i * SHEET_H;
      const ink = typeof p.ink[i] === 'string' && p.ink[i].startsWith('<svg') ? p.ink[i] : '';
      out.push(
        `<section class="pdf-sheet">` +
          `<div class="paper-bg" data-paper="${paper}" style="top:${top}px;width:${SHEET_W / s}px;height:${(count * SHEET_H) / s}px;transform:scale(${s});--ox:${-x0}px"></div>` +
          `<div class="note-content" data-paper="${paper}" style="left:${-x0 * s}px;top:${top}px;transform:scale(${s})">${p.html}</div>` +
          `${ink}</section>`
      );
    }
  });
  return out;
}

function buildHtml(pages, background, only = null, texture = 'none') {
  const css = fs.readFileSync(path.join(__dirname, 'renderer', 'content.css'), 'utf8');
  const bg = /^#[0-9a-f]{6}$/i.test(background) ? background : '#ffffff';
  const grain = Textures.valid(texture) ? Textures.css(texture) : 'none';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
${css}
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: ${bg}; }
.pdf-sheet { position: relative; width: ${SHEET_W}px; height: ${SHEET_H}px; overflow: hidden; break-after: page; background-color: ${bg}; background-image: ${grain}; isolation: isolate; }
.pdf-sheet:last-child { break-after: auto; }
.pdf-sheet .note-content { position: absolute; left: 0; width: ${SHEET_W}px; transform-origin: 0 0; background-image: none; }
.pdf-sheet .paper-bg { position: absolute; left: 0; transform-origin: 0 0; }
.pdf-ink { position: absolute; left: 0; top: 0; width: ${SHEET_W}px; height: ${SHEET_H}px; mix-blend-mode: multiply; overflow: hidden; }
</style></head><body>${sheets(pages, only).join('\n')}</body></html>`;
}

module.exports = { buildHtml, SHEET_W, SHEET_H };
