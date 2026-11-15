// ---------- Version history ----------

async function openHistory() {
  if (!state.path) {
    await ask({ message: 'Save the notebook first.', detail: 'Earlier versions are kept once the notebook has a file.', buttons: ['OK'] });
    return;
  }
  if (state.dirty) await saveNotebook(false, true);
  const versions = await api.listHistory();
  const list = $('history-list');
  list.textContent = '';
  $('history-sub').textContent = versions.length
    ? 'A copy is kept every ten minutes while you work. Restoring replaces the notebook with that version; the current one is kept as a version too.'
    : '';
  if (!versions.length) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'No earlier versions yet. They appear as you keep working on this notebook.';
    list.append(li);
  }
  for (const v of versions) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    const strong = document.createElement('span');
    strong.textContent = new Date(v.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const small = document.createElement('small');
    small.textContent = `${timeAgo(v.time)} · ${(v.size / 1024).toFixed(v.size < 102400 ? 1 : 0)} KB`;
    when.append(strong, small);
    const b = document.createElement('button');
    b.className = 'big';
    b.textContent = 'Restore';
    b.addEventListener('click', () => restoreVersion(v));
    li.append(when, b);
    list.append(li);
  }
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

