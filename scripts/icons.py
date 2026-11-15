"""
Jotter icon set. Run `python scripts/icons.py` to rewrite the <svg id="icons"> block in index.html
and to write scripts/icon-sheet.html for review.

Rules, so the set reads as one family:
  - 24 x 24 grid; artwork sits inside 3..21, so every icon has the same optical size.
  - Lines only (the stroke weight is set once in CSS), round ends and joins, 1.5 px corner radius.
  - The ethnic signature: every dot, knob, bullet or ornament is a small kolam diamond, never a circle.
"""
import re
from pathlib import Path


def d(x, y, r, cls='d'):
    """A diamond centred on (x, y): filled (class d) or outlined (class o)."""
    return f'<path class="{cls}" d="M{x} {y - r}l{r} {r}-{r} {r}-{r}-{r}z"/>'


ICONS = {
    # Navigation
    'home': '<path d="M4 10.3 12 4l8 6.3V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>' + d(12, 10.4, 1.5),
    'sidebar': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/><path d="M5.8 8.2h1.4M5.8 11h1.4"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/>',
    'more': d(5.5, 12, 1.7) + d(12, 12, 1.7) + d(18.5, 12, 1.7),
    'chevron': '<path d="m7.5 10 4.5 4.5 4.5-4.5"/>',
    'close': '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    # Tools
    'type': '<path d="M5 7.5V5h14v2.5"/><path d="M12 5v14"/><path d="M9.5 19h5"/>',
    'pen': '<path d="M8 3.5h8l2.6 6.4L12 20.5 5.4 9.9z"/><path d="M12 20.5v-7"/>' + d(12, 10.5, 1.6),
    'marker': '<path d="M8.5 3.5h7v6.6l1.6 2.3v3.6H6.9v-3.6l1.6-2.3z"/><path d="M8.5 9.5h7"/><path d="M9.5 16v4.5l5-1.8V16"/>',
    'eraser': '<path d="M9.2 20.5 4.4 15.7a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l4.2 4.2a1.5 1.5 0 0 1 0 2.1l-9.3 9.5"/><path d="M8.7 9.3l6.2 6.2"/><path d="M9.2 20.5H20"/>',
    'shapes': '<path d="M8 3.5 12.5 8 8 12.5 3.5 8z"/><circle cx="16" cy="16" r="4.5"/>',
    'lasso': '<path d="M8.6 17.7C5.3 16.8 3 14.6 3 12c0-3.6 4-6.5 9-6.5s9 2.9 9 6.5-4 6.5-9 6.5c-1.1 0-2.2-.1-3.2-.4" stroke-dasharray="2.6 2.6"/><path d="M8.8 18.1c-.5 1.2-.2 2.3.9 2.9"/>',
    'undo': '<path d="M8.5 14.5 4 10l4.5-4.5"/><path d="M4 10h10a5.25 5.25 0 0 1 0 10.5h-3"/>',
    'redo': '<path d="m15.5 14.5 4.5-4.5-4.5-4.5"/><path d="M20 10H10a5.25 5.25 0 0 0 0 10.5h3"/>',
    # Text
    'bullets': '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/>' + d(5, 6.5, 1.5) + d(5, 12, 1.5) + d(5, 17.5, 1.5),
    'numbers': '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4 5.6 5.6 4.5V9"/><path d="M3.8 14.3c.6-.9 2.7-.9 2.7.5 0 1.1-2.7 2.3-2.7 3.4h2.9"/>',
    'checklist': '<rect x="3.5" y="4.5" width="5.5" height="5.5" rx="1.2"/><path d="m4.4 16.2 1.6 1.6 3-3.3"/><path d="M12.5 7.2H20.5M12.5 16H20.5"/>',
    'table': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/>',
    'image': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m4 17.6 4.8-4.8 3.7 3.7 2.6-2.6 5.4 5.1"/>' + d(15.5, 9, 1.8, 'o'),
    'link': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    'textbox': '<rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke-dasharray="3 2.4"/><path d="M9 9.5h6M12 9.5v5"/>',
    'edit': '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5z"/><path d="m14 8 3 3"/>',
    # Pages and files
    'page': '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 13h6M9 16.5h4"/>',
    'book': '<path d="M6.5 3.5H18a.5.5 0 0 1 .5.5v15.5H7.5A2.5 2.5 0 0 1 5 17V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5h11"/>' + d(12, 9, 2.4, 'o'),
    'folder': '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.3l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z"/>',
    'copy': '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.8"/><path d="M15.5 8.5V5.8A1.8 1.8 0 0 0 13.7 4H5.8A1.8 1.8 0 0 0 4 5.8v7.9a1.8 1.8 0 0 0 1.8 1.8h2.7"/>',
    'trash': '<path d="M4.5 6.5h15M10 3.5h4"/><path d="m6.5 6.5.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6"/><path d="M10 10.5v6M14 10.5v6"/>',
    'history': '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4h4"/><path d="M12 7.5v4.8l3.2 2"/>',
    'download': '<path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
    'print': '<path d="M7 8.5v-5h10v5"/><rect x="3.5" y="8.5" width="17" height="8" rx="1.8"/><path d="M7 14h10v6.5H7z"/>' + d(17, 11.3, 0.9),
    'window': '<rect x="3.5" y="4.5" width="13" height="11" rx="1.8"/><path d="M3.5 8h13"/><path d="M8 19.5h10.7a1.8 1.8 0 0 0 1.8-1.8V9"/>',
    'pin': '<path d="M9 3.5h6"/><path d="M10 3.5v5.7L7 12.5h10l-3-3.3V3.5"/><path d="M12 12.5v8"/>',
    # Settings and help
    'sliders': '<path d="M4 7h8.6M17.4 7H20M4 17h2.6M11.4 17H20"/>' + d(15, 7, 2.4, 'o') + d(9, 17, 2.4, 'o'),
    'info': '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/>' + d(12, 7.8, 1.2),
    'keyboard': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M7.5 14.5h9"/>' + ''.join(d(x, 10.2, 0.85) for x in (7.5, 12, 16.5)),
    'focus': '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>' + d(12, 12, 2.2, 'o'),
    'expand': '<path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/>',
    'grip': ''.join(d(x, y, 1.4) for y in (6.5, 12, 17.5) for x in (9, 15)),
    # Shapes
    'line': '<path d="M5 19 19 5"/>',
    'arrow': '<path d="M5 19 19 5M10.5 5H19v8.5"/>',
    'rect': '<rect x="4" y="6.5" width="16" height="11" rx="1.5"/>',
    'ellipse': '<ellipse cx="12" cy="12" rx="8.5" ry="5.8"/>',
}

LOGO = (
    '<symbol id="i-logo" viewBox="-32 -32 64 64"><path d="M0 0C-10-6-9-21 0-21S10-6 0 0zM0 0C6-10 21-9 21 0S6 10 0 0z'
    'M0 0C10 6 9 21 0 21S-10 6 0 0zM0 0C-6 10-21 9-21 0S-6-10 0 0z"/><path d="M0-28C4-12 12-4 28 0 12 4 4 12 0 28-4 12-12 4-28 0'
    '-12-4-4-12 0-28z"/><circle class="dot" cx="0" cy="-13" r="2.3"/><circle class="dot" cx="13" cy="0" r="2.3"/>'
    '<circle class="dot" cx="0" cy="13" r="2.3"/><circle class="dot" cx="-13" cy="0" r="2.3"/></symbol>'
)

root = Path(__file__).resolve().parent.parent
symbols = ''.join(f'\n    <symbol id="i-{k}" viewBox="0 0 24 24">{v}</symbol>' for k, v in ICONS.items())
block = (
    '<svg id="icons" aria-hidden="true">'
    + symbols
    + f'\n    {LOGO}\n  </svg>'
)

index = root / 'src' / 'renderer' / 'index.html'
html = index.read_text(encoding='utf-8')
html, n = re.subn(r'<svg id="icons" aria-hidden="true">.*?</svg>', lambda _m: block, html, count=1, flags=re.S)
assert n == 1, 'icon block not found'
html = re.sub(
    r'<!-- Icon set:.*?-->',
    '<!-- Icon set drawn for Jotter: 24 px grid, one line weight, round ends; every dot or knob is a kolam diamond. -->',
    html,
    count=1,
    flags=re.S,
)
index.write_text(html, encoding='utf-8', newline='')

# Every icon referenced by the app must exist.
used = set(re.findall(r'#i-([\w-]+)', html)) | set(re.findall(r"'i-([\w-]+)'", (root / 'src' / 'renderer' / 'app.js').read_text(encoding='utf-8')))
missing = sorted(u for u in used if u not in ICONS and u != 'logo')
print('missing:', missing or 'none')
print('unused:', sorted(set(ICONS) - used) or 'none')

# Review sheet: every icon at the toolbar size and enlarged.
cells = ''.join(
    f'<figure><svg class="ic s20"><use href="#i-{k}"/></svg><svg class="ic s48"><use href="#i-{k}"/></svg><figcaption>{k}</figcaption></figure>'
    for k in ICONS
)
sheet = f'''<!doctype html><html><head><meta charset="utf-8"><style>
#icons {{ position: absolute; width: 0; height: 0; }}
body {{ margin: 0; padding: 24px; font: 12px 'Segoe UI', sans-serif; color: #2a221c; background: #faf7f0; }}
.grid {{ display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; }}
figure {{ margin: 0; display: grid; justify-items: center; gap: 8px; padding: 14px 6px 10px; border-radius: 10px; background: #f0e9dc; }}
.ic {{ fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }}
.ic .d {{ fill: currentColor; stroke: currentColor; stroke-width: 0.8; }}
.ic .o {{ fill: none; }}
.s20 {{ width: 20px; height: 20px; }} .s48 {{ width: 48px; height: 48px; stroke-width: 1.6; }}
figcaption {{ color: #76675a; }}
.dark {{ background: #1f1a16; color: #f0e7d9; margin-top: 16px; padding: 14px; border-radius: 12px; display: flex; flex-wrap: wrap; gap: 14px; }}
</style></head><body>
{block}
<div class="grid">{cells}</div>
<div class="dark">{''.join(f'<svg class="ic s20"><use href="#i-{k}"/></svg>' for k in ICONS)}</div>
</body></html>'''
(root / 'scripts' / 'icon-sheet.html').write_text(sheet, encoding='utf-8')
print(len(ICONS), 'icons')
