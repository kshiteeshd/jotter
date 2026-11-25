# Jotter user guide

## Opening Jotter

Jotter opens where you left off: the last notebook you used, on the same page and scrolled to the same spot, in a window the size and place you left it, with each tool's colour and size as you last set them. Opening any notebook (from Home, or by double-clicking its file) also takes you back to where you were in it. Home appears when there is nothing to reopen, and in a new window.

## Home

Home shows a greeting, one-click covers to start a new notebook, the notebook you were last in, and your shelf of notebooks (search it or sort by name). **New notebook** and **Open…** are at the top. Every notebook lives in your notebooks folder, `Documents\Jotter` unless you change it at the bottom of Home or in **Settings → Storage and versions**.

- **New notebook**: click a cover. It is created at once as *Book 1*, *Book 2*… Click its name at the top of the window to rename it; the file is renamed too.
- **Open…** opens any `.ntb` file, wherever it is.
- On a notebook card: pin it to the top, make a copy, or delete it (it goes to the Recycle Bin).

## The notebook window

- **Title bar**: on the left Home, show/hide the sidebar, then where you are: notebook › section › page (click the notebook name to rename it, the page name to edit it). In the middle the page's type (Paged / Infinite) and paper (Plain, Ruled, Grid, Dots, Kolam). On the right Search, Export and Settings.
- **Status bar** (along the bottom): the section and page you are on, the page's size, whether everything is saved, and the zoom. *All changes saved* is the calm state; *Not saved* in red means something needs you.
- **Sidebar**: sections at the top, the pages of the current section below. Each section and page has a **⋯** button (and the same menu on right-click). A section's menu has **Download as PDF** (that section only), **Rename**, its **Colour** (clicking the coloured dot opens the same menu) and **Delete**; a page's menu has rename, duplicate, move to another section, clear ink and delete. Drag pages to reorder them or onto a section to move them.
- **Tool bar**: grouped as Type · Pen, Marker, Shapes · Eraser, Select, then Undo and Redo, then Focus mode and Full screen, with the chosen tool's options (colours, sizes, text styles, insert) beside them. It sits on the right at first; drag its grip (the six dots) to the left, top or bottom edge, or choose the side in **Settings → Pen and tool bar**. The arrow folds the options away.
- **The tool bar hides when not in use**: a moment after the pointer leaves it, or as soon as you start writing, it slides off its edge and a small tab with two dots marks where it went. Point at that edge (or the tab) and it slides back. The pin button on the bar keeps it shown; **Settings → Pen and tool bar → Hide when not in use** does the same. The page never moves as the bar comes and goes.

## Writing

- **Type (T)**: text style, bold, italic, underline, lists, checklists (click the box to tick), then insert a table, an image, a link (Ctrl+click to open it) or a free text box you can drag anywhere. Spelling is checked as you type; turn it off in **Settings → General**.
- **Pen (P)** and **Marker (M)**: pick a colour, then a size: one of five ready sizes, or **−** / **+** (or **[** / **]**) to go one step thinner or thicker. Each step is about 12% thicker than the last. Hold **Shift** for a straight line. Lines are steadied automatically; pen lines taper at the ends (already while you draw); a pen with pressure draws thicker when you press harder.
- **Eraser (E)**: *Rub out* removes only what you touch; *Whole stroke* removes a stroke with one touch. A pen's eraser end works too.
- **Shapes (S)**: line, arrow, rectangle, ellipse. Shift makes squares, circles and 45° lines.
- **Select (L)**: draw a loop around ink, then drag it, resize it from the corner, recolour, copy, duplicate or delete.
- **[ and ]** make the current tool smaller or larger. **Space + drag** or the middle mouse button moves around the page.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y, or Ctrl+Shift+Z) take back the very last change in the notebook, whatever it was: ink, typing (a run at a time), a new, moved or deleted page or section, a renamed title, the page type or paper, a colour. Undo only undoes: you stay on the page you are on, scrolled where you are, even when the change was on another page. A tablet pen button set to Ctrl+Z, or to a driver's own Undo, works too.

## Pages

The switches in the middle of the title bar:

- **Paged** gives A4 sheets. Sheets are separated by a visible gap with the sheet number; **Add a sheet** under the last one adds more room, and says how many sheets the page has. A page holds up to 40 sheets; once it is full, that button continues on a new page. PDF export splits pages exactly at the gaps.
- **Infinite** gives one page that fills the window and grows as you scroll.
- **Plain, Ruled, Grid, Dots, Kolam** set the paper. In **Settings → This notebook** you can choose the notebook's paper colour (four ready colours, or any colour of your own with the rainbow picker) and a **paper texture**: None, Grain, Linen, Recycled or Parchment. They apply to this notebook only; **Use this paper** makes them the paper new notebooks start with (also set in **Settings → New notebooks**).

## Saving, versions and recovery

- Notebooks save themselves a moment after every change: after 1.5 seconds for an ordinary notebook, a little longer for a very large one (so a synced folder does not upload it again and again), and at once when you switch to another window, leave the notebook or close Jotter.
- Half a second after every change, a small recovery copy of what changed is kept on this computer. If Jotter or the computer stops before the notebook is saved, Jotter offers your work back the next time (or at once, if only the page crashed).
- **Changed elsewhere**: if the notebook's file is changed outside Jotter (for example OneDrive brings in an edit made on another computer), Jotter never saves over it without asking. If you have nothing unsaved, the new version is simply shown when you come back to Jotter. If you do, you choose: **Keep both** (yours is saved next to it as *Name (my changes)*), **Replace it with my version**, or **Open the changed version**; whichever is not kept stays in Version history. **Decide later** stops autosave for that notebook until you save (Ctrl+S) and choose.
- **Version history** (Settings → This notebook): an earlier version is kept every ten minutes of work. Every version from today is kept; older ones are thinned to one a day, then one a week, within the number and the space you choose in **Settings → Storage and versions** (which also shows how much space they use). Restoring opens that version; your current one is kept too.

## Export and print

**Export** (the arrow in the title bar, or Ctrl+E) opens one dialog with every choice in view, and remembers your choices for next time:

- **Format**: PDF (one PDF page per A4 sheet, ink as sharp vector lines), Page image (PNG of the page you are on, with the paper's look), Markdown (the text), or Print (Ctrl+P).
- **Include** (PDF, when there is more than one section): the whole notebook in one PDF, **each section as its own PDF** (you choose a folder; the files are named after the notebook and section, and if they are already there you can replace them or keep both), or this section only. A section's **⋯ → Download as PDF** opens the dialog set to that section.
- **Infinite pages** (when the pages mix A4 and infinite pages): A4 pages only, or include the infinite ones, trimmed to what is on them and cut into A4 sheets.
- **Background** (with a coloured or textured paper): plain white, or the paper colour and texture.

*Save a copy* is in **Settings → This notebook**.

## View

The page fits the window by itself: actual size when there is room, smaller in a narrow window. Zoom with Ctrl + mouse wheel or touchpad pinch (it zooms around the pointer), Ctrl+= / Ctrl+-, or the zoom control in the status bar; a zoom of your own is kept until Ctrl+0 (or clicking the percentage) fits the page to the window again. **Focus mode** (Ctrl+Shift+F) hides everything but the page and the tools; Esc leaves it. **F11** is full screen.

## Settings

Settings (Ctrl+, or the sliders in the title bar) lists its categories on the left; changes apply at once.

- **This notebook**: cover, paper colour and texture, Use this paper for new notebooks, Version history, Export, Save a copy, Focus mode, Full screen, New window.
- **General**: light, dark or system theme; three interface sizes; spelling checks.
- **Pen and tool bar**: the tool bar's edge, hide it when not in use, and *Draw with the pen only* for touch screens.
- **New notebooks**: cover, page type, lines, paper colour and texture.
- **Storage and versions**: the notebooks folder, how many versions to keep and how much space they may use.
- **Keyboard shortcuts** (also F1) and **About Jotter**.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| T P M E S L | Type, pen, marker, eraser, shapes, select |
| [ ] | Smaller / larger |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C X V D | Copy, cut, paste, duplicate selected ink |
| Ctrl+PgUp, Ctrl+PgDn | Previous / next page |
| Ctrl+Shift+N, Ctrl+T | New page, new section |
| F2, Delete | Rename, delete (in the sidebar) |
| Ctrl+N, Ctrl+O | New notebook, open |
| Ctrl+F | Search |
| Ctrl+S, Ctrl+E, Ctrl+P | Save now, export, print |
| Ctrl+, | Settings |
| Ctrl+\\ | Show / hide sidebar |
| Ctrl+H | Home |
| F11, Ctrl+Shift+F | Full screen, focus mode |
| F1 | Keyboard shortcuts |
