// ---------- Version history ----------

// "Today", "Yesterday", or the date.
function dayLabel(time) {
  const d = new Date(time);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? 'long' : undefined, day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

async function openHistory() {
  if (!state.path) {
    await ask({ message: 'Save the notebook first', detail: 'Earlier versions are kept once the notebook has a file.', buttons: ['OK'] });
    return;
  }
  if (state.dirty) await saveNotebook(false, true);
  const versions = await api.listHistory();
  const list = $('history-list');
  list.textContent = '';
  $('history-sub').textContent = versions.length
    ? 'Restoring opens that version in place of the current one; the current one is kept as a version too.'
    : '';
  if (!versions.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'No earlier versions yet. A version is kept every ten minutes while you work on this notebook.';
    list.append(p);
  }
  let day = '';
  for (const v of versions) {
    const label = dayLabel(v.time);
    if (label !== day) {
      day = label;
      const h = document.createElement('h3');
      h.className = 'history-day';
      h.textContent = label;
      list.append(h);
    }
    const row = document.createElement('div');
    row.className = 'history-row';
    row.setAttribute('role', 'listitem');
    const when = document.createElement('span');
    when.className = 'when';
    const strong = document.createElement('span');
    strong.textContent = new Date(v.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const small = document.createElement('small');
    small.textContent = `${timeAgo(v.time)} · ${formatBytes(v.size)}`;
    when.append(strong, small);
    const b = document.createElement('button');
    b.className = 'big';
    b.type = 'button';
    b.textContent = 'Restore';
    b.addEventListener('click', () => restoreVersion(v));
    row.append(when, b);
    list.append(row);
  }
  const total = versions.reduce((n, v) => n + v.size, 0);
  $('history-foot').textContent = versions.length ? `${plural(versions.length, 'version')} · ${formatBytes(total)}` : '';
  $('history-dialog').showModal();
}

async function restoreVersion(v) {
  $('history-dialog').close();
  const file = await api.readHistory(v.id);
  const path = state.path;
  if (await loadFile(file, true, path)) {
    state.forceSnapshot = true; // keep the version being replaced
    flash(`Restored the version from ${new Date(v.time).toLocaleString()}`);
  }
}
