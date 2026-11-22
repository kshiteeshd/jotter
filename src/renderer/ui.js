'use strict';

/* Small interface helpers shared by the app: element lookup, in-app dialogs, messages, popovers. */
(function (root) {
  const $ = (id) => document.getElementById(id);

  // ---------- Keyboard or pointer? Focus rings show only for keyboard use. ----------
  document.addEventListener('keydown', (e) => {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F6'].includes(e.key)) document.body.classList.add('kbd');
  });
  document.addEventListener('pointerdown', () => document.body.classList.remove('kbd'), true);

  // ---------- Messages ----------
  let msgTimer = 0;
  function flash(msg) {
    const el = $('status-msg');
    el.textContent = msg;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (el.textContent = ''), 4000);
  }

  // ---------- In-app dialog ----------
  /*
    ask({ message, detail, buttons, defaultId, cancelId, danger, input })
    Resolves to the index of the chosen button, or { index, value } when `input` is given
    ({ label, value, placeholder }). Esc chooses the cancel button.
  */
  /*
    A question in a dialog. Short answers sit in the footer, Cancel on the left and the main answer on the
    right. Longer or more numerous answers become a list of full-width choices, each with an optional note
    (`notes`, in the same order as `buttons`), and Cancel stays in the footer.
  */
  function ask({ message, detail = '', buttons = ['OK'], notes = null, defaultId = 0, cancelId = buttons.length - 1, danger = false, input = null }) {
    const dlg = $('ask');
    $('ask-title').textContent = message;
    $('ask-detail').textContent = detail;
    $('ask-detail').hidden = !detail;
    const field = $('ask-field');
    const inputEl = $('ask-input');
    field.hidden = !input;
    if (input) {
      $('ask-label').textContent = input.label || '';
      inputEl.value = input.value || '';
      inputEl.placeholder = input.placeholder || '';
    }
    const row = $('ask-buttons');
    const list = $('ask-choices');
    row.textContent = '';
    list.textContent = '';
    let result = cancelId;
    const choose = (i) => () => {
      result = i;
      dlg.close();
    };
    const asList = !!notes || buttons.length > 3 || buttons.some((label, i) => i !== cancelId && label.length > 18);
    list.hidden = !asList;
    buttons.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (asList && i !== cancelId) {
        b.className = `choice${i === defaultId ? ' primary' : ''}`;
        const title = document.createElement('span');
        title.className = 'choice-title';
        title.textContent = label;
        b.append(title);
        if (notes && notes[i]) {
          const note = document.createElement('small');
          note.textContent = notes[i];
          b.append(note);
        }
        list.append(b);
      } else {
        b.className = `big${i === defaultId ? (danger ? ' danger' : ' primary') : ''}`;
        b.textContent = label;
        row.append(b);
      }
      b.addEventListener('click', choose(i));
    });
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        result = defaultId;
        dlg.close();
      }
    };
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(input ? { index: result, value: inputEl.value } : result), { once: true });
      dlg.showModal();
      if (input) {
        inputEl.focus();
        inputEl.select();
      } else (asList ? list.querySelector('.primary') : [...row.children].find((b) => b.classList.contains('primary') || b.classList.contains('danger')))?.focus();
    });
  }

  const showError = (message) => ask({ message: message.split('\n')[0], detail: message.split('\n').slice(1).join('\n'), buttons: ['OK'] });

  // ---------- Popovers ----------
  const popovers = () => [...document.querySelectorAll('.popover')];
  const anyPopoverOpen = () => popovers().some((p) => !p.hidden);

  function closePopovers(except) {
    for (const p of popovers()) if (p !== except) p.hidden = true;
    document.querySelectorAll('[aria-haspopup]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  // Show `pop` under `anchor` (centred, or aligned to its left or right edge), kept inside the window.
  function openPopover(pop, anchor, align = 'center', trigger = null) {
    closePopovers(pop);
    pop.hidden = false;
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = align === 'right' ? a.right - w : align === 'left' ? a.left : a.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = a.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    if (document.body.classList.contains('kbd')) [...pop.querySelectorAll('button, input, select')].find((b) => b.offsetParent)?.focus();
  }

  // Every dialog has a close button in its corner (the same as Cancel, or Esc).
  for (const d of document.querySelectorAll('dialog')) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'dialog-close';
    x.title = 'Close (Esc)';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
    x.addEventListener('click', () => d.close());
    d.prepend(x);
  }

  // ---------- Segmented controls (radio groups) ----------
  function setSeg(id, value) {
    $(id)
      .querySelectorAll('button')
      .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(value))));
  }
  function bindSeg(id, onChange) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) onChange(b.dataset.value);
    });
  }

  function timeAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
    return new Date(ts).toLocaleDateString();
  }

  // "1 page", "3 pages".
  const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

  root.UI = { $, flash, ask, showError, closePopovers, openPopover, anyPopoverOpen, setSeg, bindSeg, timeAgo, plural };
})(window);
