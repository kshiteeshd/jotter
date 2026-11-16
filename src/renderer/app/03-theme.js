// ---------- Theme: the open notebook's cover sets the accent ----------

const prefersDark = matchMedia('(prefers-color-scheme: dark)');

function applyCoverTheme() {
  const rootStyle = document.documentElement.style;
  if (state.view === 'editor' && state.nb) {
    const c = Covers.get(state.nb.cover);
    rootStyle.setProperty('--accent', prefersDark.matches ? c.accent[1] : c.accent[0]);
    rootStyle.setProperty('--cover-band', c.band);
  } else {
    rootStyle.removeProperty('--accent');
    rootStyle.removeProperty('--cover-band');
  }
  sendOverlay();
}
prefersDark.addEventListener('change', applyCoverTheme);

// The window buttons sit in our title bar; give them our colours.
function sendOverlay() {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue('--bg').trim();
  const symbolColor = css.getPropertyValue('--text').trim();
  if (/^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) api.setOverlay({ color, symbolColor });
}

// Keep our controls clear of the window buttons.
let wcoQueued = false;
function updateWco() {
  if (wcoQueued) return;
  wcoQueued = true;
  requestAnimationFrame(() => {
    wcoQueued = false;
    const wco = navigator.windowControlsOverlay;
    let w = 0;
    if (wco && wco.visible) {
      const r = wco.getTitlebarAreaRect();
      if (r && r.width >= 0) w = Math.max(0, window.innerWidth - r.x - r.width);
    } else if (!wco && !state.fullscreen) {
      w = 140;
    }
    document.documentElement.style.setProperty('--wco', `${Math.min(240, Math.max(0, Math.round(w)))}px`);
  });
}
navigator.windowControlsOverlay?.addEventListener('geometrychange', updateWco);

// The page switches sit over the middle of the window (where the page is), not the middle of the bar, which
// the window buttons push to the left; they never move so far that they touch the buttons on the right.
const pageOpts = document.querySelector('.page-opts');
function placeSwitches() {
  if (state.view !== 'editor') return;
  pageOpts.style.transform = '';
  const o = pageOpts.getBoundingClientRect();
  if (!o.width) return;
  const right = document.querySelector('.tb-right').getBoundingClientRect();
  const shift = Math.max(0, Math.min(innerWidth / 2 - (o.left + o.right) / 2, right.left - 8 - o.right));
  pageOpts.style.transform = `translateX(${Math.round(shift)}px)`;
}
new ResizeObserver(placeSwitches).observe(document.getElementById('topbar'));
// Text widths change when the bundled fonts finish loading: measure the layout again then.
document.fonts.addEventListener('loadingdone', () => {
  placeSwitches();
  if (typeof onViewportChange === 'function') onViewportChange();
});
window.addEventListener('resize', updateWco);

