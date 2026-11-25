// ---------- About ----------

// About Jotter is a page of the settings (see showPane).
const openAbout = () => openSettings('about');
$('btn-licences').addEventListener('click', async () => {
  if (!(await api.openLicences())) flash('The licence file is not available in this build.');
});
