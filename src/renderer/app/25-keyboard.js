// ---------- Keyboard ----------

const isTyping = (t) => t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);

function stopPanKey() {
  spaceDown = false;
  if (!pan) document.body.classList.remove('panning');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return; // the dialog closes itself
    if (anyPopoverOpen()) closePopovers();
    else if (selection) clearSelection();
    else if (!el.imgBar.hidden) hideImageBar();
    else if (document.body.classList.contains('focus')) setFocusMode(false);
    else if (state.fullscreen) api.setFullscreen(false);
    else if (state.view === 'home' && state.nb) showEditor();
    return;
  }
  if (state.view !== 'editor' || isTyping(e.target) || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey && !e.altKey && state.tool === 'select') {
    const k = e.key.toLowerCase();
    if (k === 'c') copySelection();
    else if (k === 'x' && copySelection()) deleteSelection();
    else if (k === 'v') pasteInk();
    else if (k === 'd' && copySelection()) pasteInk();
    else return;
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (e.key === ' ' && state.tool !== 'text' && !e.target.closest('button')) {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      document.body.classList.add('panning');
      el.ring.style.display = 'none';
    }
    return;
  }
  const tool = { t: 'text', p: 'pen', m: 'marker', e: 'eraser', s: 'shape', l: 'select' }[e.key.toLowerCase()];
  if (tool) {
    e.preventDefault();
    setTool(tool);
  } else if (e.key === '[' || e.key === ']') {
    stepSize(e.key === ']' ? 1 : -1);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') stopPanKey();
});
window.addEventListener('blur', stopPanKey);

