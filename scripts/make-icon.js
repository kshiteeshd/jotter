// Renders the app icon (build/icon.png) and the notebook file icon (build/ntb.ico): `npm run icon`
// The app icon is the kolam mark on terracotta. The file icon is a small notebook with a kolam cover,
// so .ntb files in Explorer look like the notebooks on Jotter's home screen.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const APP = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c25634"/><stop offset="1" stop-color="#8e3319"/></linearGradient></defs>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#g)"/>
  <g transform="translate(256 256) scale(6.3)" fill="none" stroke="#fff6e8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 0C-10-6-9-21 0-21S10-6 0 0zM0 0C6-10 21-9 21 0S6 10 0 0zM0 0C10 6 9 21 0 21S-10 6 0 0zM0 0C-6 10-21 9-21 0S-6-10 0 0z"/>
    <path d="M0-28C4-12 12-4 28 0 12 4 4 12 0 28-4 12-12 4-28 0-12-4-4-12 0-28z"/>
    <g fill="#f4bd4b" stroke="none">
      <circle cx="0" cy="-13" r="2.6"/><circle cx="13" cy="0" r="2.6"/><circle cx="0" cy="13" r="2.6"/><circle cx="-13" cy="0" r="2.6"/>
      <circle cx="17" cy="-17" r="2"/><circle cx="17" cy="17" r="2"/><circle cx="-17" cy="17" r="2"/><circle cx="-17" cy="-17" r="2"/>
    </g>
  </g>
</svg>`;

// Notebook file icon. Small sizes use a simpler drawing so they stay crisp.
function doc(size) {
  const detailed = size >= 48;
  const loops = detailed
    ? [[128, 74], [108, 94], [128, 94], [148, 94], [88, 114], [108, 114], [128, 114], [148, 114], [168, 114], [108, 134], [128, 134], [148, 134], [128, 154]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="#fff6e8" stroke-width="3"/><circle cx="${x}" cy="${y}" r="3.2" fill="#f4bd4b"/>`)
        .join('')
    : `<path d="M128 70 166 114 128 158 90 114z" fill="none" stroke="#fff6e8" stroke-width="12" stroke-linejoin="round"/><circle cx="128" cy="114" r="11" fill="#f4bd4b"/>`;
  const label = detailed
    ? `<rect x="80" y="182" width="104" height="30" rx="5" fill="#faf6ee"/><rect x="92" y="193" width="62" height="4" rx="2" fill="#8a7867"/><rect x="92" y="201" width="36" height="4" rx="2" fill="#c4b6a3"/>`
    : `<rect x="80" y="182" width="104" height="30" rx="5" fill="#faf6ee"/>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <rect x="66" y="22" width="158" height="216" rx="12" fill="#e8dcc6"/>
  <rect x="70" y="30" width="150" height="200" rx="9" fill="#fffaf0"/>
  <rect x="34" y="16" width="168" height="224" rx="14" fill="#b0462b"/>
  <path d="M48 16h18v224H48a14 14 0 0 1-14-14V30a14 14 0 0 1 14-14z" fill="#8e3319"/>
  ${loops}${label}
</svg>`;
}

// An icon image in the classic bitmap form (32-bit with alpha), which every part of Windows can read.
function dib(img) {
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  const maskRow = Math.ceil(width / 32) * 4;
  const out = Buffer.alloc(40 + width * height * 4 + maskRow * height);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(width, 4);
  out.writeInt32LE(height * 2, 8); // image plus its (empty) transparency mask
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(width * height * 4, 20);
  for (let y = 0; y < height; y++) bgra.copy(out, 40 + (height - 1 - y) * width * 4, y * width * 4, (y + 1) * width * 4);
  return out;
}

// A Windows .ico file: 256 px as PNG, smaller sizes as bitmaps.
function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

// Render SVG to an image of the given size (height defaults to the width).
async function renderImage(svg, width, height = width) {
  const win = new BrowserWindow({ width, height, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const file = path.join(require('os').tmpdir(), `jotter-icon-${width}x${height}.html`);
  // Draw the artwork at exactly the requested size, whatever size it was written at.
  const sized = svg.replace(/(<svg[^>]*?)\swidth="\d+"\s+height="\d+"/, `$1 width="${width}" height="${height}"`);
  fs.writeFileSync(file, `<html><body style="margin:0;overflow:hidden;background:transparent">${sized}</body></html>`);
  await win.loadFile(file);
  fs.rmSync(file, { force: true });
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage()).resize({ width, height, quality: 'best' });
  win.destroy();
  return img;
}
const render = async (svg, size) => (await renderImage(svg, size)).toPNG();

// A 24-bit Windows bitmap, the format the installer's side panel needs.
function bmp(img) {
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  const row = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * height);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * row; // bitmaps are stored bottom row first
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      out[dst + x * 3] = bgra[src];
      out[dst + x * 3 + 1] = bgra[src + 1];
      out[dst + x * 3 + 2] = bgra[src + 2];
    }
  }
  return out;
}

// Side panel of the installer's welcome and finish pages (164 x 314).
const SIDEBAR = `
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8502f"/><stop offset="1" stop-color="#8e3319"/></linearGradient>
    <pattern id="k" width="16" height="10" patternUnits="userSpaceOnUse">
      <path d="M8 1.5 11.5 5 8 8.5 4.5 5z" fill="none" stroke="#fff6e8" stroke-opacity="0.55" stroke-width="0.9"/>
      <path d="M8 4 9 5 8 6 7 5z" fill="#f4bd4b"/>
    </pattern>
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <g transform="translate(82 104) scale(1.35)" fill="none" stroke="#fff6e8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 0C-10-6-9-21 0-21S10-6 0 0zM0 0C6-10 21-9 21 0S6 10 0 0zM0 0C10 6 9 21 0 21S-10 6 0 0zM0 0C-6 10-21 9-21 0S-6-10 0 0z"/>
    <path d="M0-28C4-12 12-4 28 0 12 4 4 12 0 28-4 12-12 4-28 0-12-4-4-12 0-28z"/>
    <g fill="#f4bd4b" stroke="none"><circle cx="0" cy="-13" r="2.3"/><circle cx="13" cy="0" r="2.3"/><circle cx="0" cy="13" r="2.3"/><circle cx="-13" cy="0" r="2.3"/></g>
  </g>
  <text x="82" y="190" text-anchor="middle" fill="#fff6e8" font-family="Sitka Heading, Palatino Linotype, Georgia, serif" font-size="30" font-weight="600">Jotter</text>
  <text x="82" y="212" text-anchor="middle" fill="#f6dcc8" font-family="Segoe UI, sans-serif" font-size="11">Type and write by hand</text>
  <rect x="0" y="280" width="164" height="10" fill="url(#k)"/>
</svg>`;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep running between renders
app.whenReady().then(async () => {
  const dir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), await render(APP, 512));
  const sizes = [256, 64, 48, 32, 24, 16];
  const pngs = [];
  for (const size of sizes) {
    const img = await renderImage(doc(size), size);
    pngs.push({ size, data: size >= 256 ? img.toPNG() : dib(img) });
  }
  fs.writeFileSync(path.join(dir, 'ntb.ico'), ico(pngs));
  const appPngs = [];
  for (const size of sizes) {
    const img = await renderImage(APP, size);
    appPngs.push({ size, data: size >= 256 ? img.toPNG() : dib(img) });
  }
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(appPngs));
  const sidebar = await renderImage(SIDEBAR, 164, 314);
  fs.writeFileSync(path.join(dir, 'installerSidebar.bmp'), bmp(sidebar));
  fs.writeFileSync(path.join(require('os').tmpdir(), 'jotter-sidebar-preview.png'), sidebar.toPNG());
  console.log('wrote build/icon.png, build/icon.ico, build/ntb.ico and build/installerSidebar.bmp');
  app.exit(0);
});
