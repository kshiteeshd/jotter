// ---------- About ----------

function openAbout() {
  $('about-version').textContent = `Version ${state.version}`;
  $('about-dialog').showModal();
}
$('about-close').addEventListener('click', () => $('about-dialog').close());
$('btn-licences').addEventListener('click', async () => {
  if (!(await api.openLicences())) flash('The licence file is not available in this build.');
});

