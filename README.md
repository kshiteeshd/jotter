# Jotter

A calm notebook for Windows for typing and handwriting. Notebooks are single `.ntb` files that save themselves as you work.

## Download

Get the latest installer, `Jotter-Setup-<version>.exe`, from the **Releases** page and run it. Jotter installs for the current user and opens `.ntb` files when you double-click them.

> The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC". Choose **More info → Run anyway**.

## What it does

- **Notebooks → sections → pages**, kept in one folder (`Documents\Jotter` by default) and named Book 1, Book 2… until you rename them.
- **Type and write on the same page**: headings, lists, checklists, tables, images, links and text boxes, under a pen, marker, eraser (rub out or whole stroke), shapes and lasso selection.
- **Smooth ink**: lines are steadied as you draw, pen strokes taper at both ends, pen pressure is used when there is one, and ink stays sharp at any zoom.
- **Paged A4 sheets or one infinite page**; plain, ruled, grid, dot or kolam paper in six paper colours.
- **Always saved**: autosave, a recovery copy if Jotter closes unexpectedly, and version history you can restore.
- **Export** as PDF (vector ink), page image, Markdown, or print.
- A tool bar you can dock to any edge, a page that fits and centres itself in any window size.
- Search across a notebook, focus mode, full screen, light and dark themes, 24 original covers.

See the [user guide](docs/USER-GUIDE.md) for how everything works.

## Build from source

Requires Node.js 20 or later on Windows.

```bash
npm install
npm start          # run the app (with a profile of its own, apart from an installed Jotter)
npm test           # everything: unit tests, then the app tests (about 30 seconds)
npm run test:unit  # file format, ink geometry and the script load order
npm run check      # the renderer scripts only use what is defined before them
npm run test:app   # the real app, driven by mouse and keyboard; add group names to run some
npm run audit:contrast  # colour contrast of every screen, theme and cover
npm run dist       # build the installer into dist/
```

To sign the installer, see [docs/SIGNING.md](docs/SIGNING.md).

## Project layout

| Path | What it is |
| --- | --- |
| `src/main.js`, `src/main/` | Electron main process: windows, menus, files, settings, export |
| `src/preload.js` | The small, safe API the page is allowed to use |
| `src/format.js` | Reading and writing `.ntb` files (a zip of JSON pages and images), history snapshots |
| `src/print.js` | Builds the printable/PDF version of pages |
| `src/renderer/` | The interface: `index.html`, `styles.css`, `content.css` |
| `src/renderer/ink.js` | Ink geometry: smoothing, tapering, erasing, hit-testing, drawing |
| `src/renderer/model.js` | The notebook model, templates, sanitising and save building |
| `src/renderer/app/` | The app itself, in numbered modules loaded in order |
| `test/` | `unit.test.js` (Node) and `app.e2e.js` (the app, end to end) |
| `scripts/` | The colour-contrast audit, icon and installer artwork generators |

## The `.ntb` format

A zip archive containing `notebook.json` (sections, page order, cover, settings), `pages/<id>.json` (each page's text and ink) and `assets/<hash>.<ext>` (images). Ink strokes are stored as points in A4 sheet units (794 × 1122 per sheet).

---

Copyright © 2026 Jotter. Released under the [MIT License](LICENSE).

Typefaces: [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) and [Fraunces](https://github.com/undercasetype/Fraunces), both under the SIL Open Font License 1.1 (see `src/renderer/fonts/`).
