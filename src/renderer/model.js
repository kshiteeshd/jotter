'use strict';

/*
  The notebook model: creating, reading and writing notebooks, plus helpers that read page content
  (plain text for search, Markdown for export). A notebook is:
    { created, paperColor, cover, sections: [{ id, title, color, pages: [page] }] }
  and a page is:
    { id, title, mode: 'paged' | 'infinite', paper, sheets, html, strokes, rev }
  `rev` goes up whenever the page changes; saving and thumbnails use it to skip unchanged pages.
*/
(function (root) {
  const Ink = root.Ink;

  const PAPER_STYLES = ['plain', 'ruled', 'grid', 'dotted', 'kolam'];
  const PAPER_COLORS = { white: '#ffffff', cream: '#fbf6e6', sepia: '#f1e3c6', grey: '#e9eaec' };

  // Natural-dye colours: used for sections and, slightly brighter, for ink.
  const DYES = [
    ['#2f4a8a', 'Indigo'],
    ['#b3322a', 'Madder'],
    ['#c98a12', 'Turmeric'],
    ['#3f7d3a', 'Neem'],
    ['#8e2a5c', 'Lac'],
    ['#1f6b66', 'Peacock'],
    ['#d7651c', 'Saffron'],
    ['#5b4636', 'Walnut'],
  ];
  const INKS = [
    ['#1f1b18', 'Kohl'],
    ['#2b4a8b', 'Indigo'],
    ['#b3322a', 'Madder'],
    ['#d7651c', 'Saffron'],
    ['#facc15', 'Haldi'],
    ['#3f7d3a', 'Neem'],
    ['#8e2a5c', 'Lac'],
    ['#1f6b66', 'Peacock'],
  ];

  const TEMPLATES = [
    { id: 'blank', name: 'Blank page', html: '' },
    {
      id: 'todo',
      name: 'To-do list',
      paper: 'ruled',
      html: '<h1>To do</h1><ul class="checklist"><li><br></li><li><br></li><li><br></li></ul>',
    },
    {
      id: 'meeting',
      name: 'Meeting notes',
      paper: 'ruled',
      html:
        '<h1>Meeting</h1><div><b>Date:</b> </div><div><b>People:</b> </div><h2>Agenda</h2><ul><li><br></li></ul>' +
        '<h2>Notes</h2><div><br></div><h2>Actions</h2><ul class="checklist"><li><br></li></ul>',
    },
    {
      id: 'cornell',
      name: 'Cornell notes',
      paper: 'plain',
      html:
        '<h1>Topic</h1><table class="cornell"><tbody><tr><td><b>Cues</b></td><td><b>Notes</b></td></tr>' +
        '<tr><td><br></td><td><br></td></tr></tbody></table><h3>Summary</h3><div><br></div>',
    },
    {
      id: 'week',
      name: 'Week planner',
      paper: 'plain',
      html:
        '<h1>Week of</h1><table class="planner"><tbody>' +
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
          .map((d) => `<tr><td><b>${d}</b></td><td><br></td></tr>`)
          .join('') +
        '</tbody></table>',
    },
  ];

  const uid = () => crypto.randomUUID();
  const isId = (v) => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);

  function newPage(title, like = {}) {
    return {
      id: uid(),
      title,
      mode: like.mode === 'infinite' ? 'infinite' : 'paged',
      paper: PAPER_STYLES.includes(like.paper) ? like.paper : 'plain',
      sheets: 1,
      html: like.html || '',
      strokes: [],
      rev: 0,
    };
  }

  function newSection(title, color = DYES[0][0]) {
    return { id: uid(), title, color, pages: [] };
  }

  function newNotebook({ cover, paperColor, paper, mode } = {}) {
    const section = newSection('Notes');
    section.pages.push(newPage('Page 1', { paper, mode }));
    return {
      created: new Date().toISOString(),
      paperColor: PAPER_COLORS[paperColor] ? paperColor : 'white',
      cover,
      sections: [section],
    };
  }

  const allPages = (nb) => nb.sections.flatMap((s) => s.pages);

  // ---------- Cleaning untrusted content ----------

  const ALLOWED_CLASSES = new Set(['checklist', 'done', 'tbox', 'tbox-body', 'cornell', 'planner']);
  const DROP_TAGS =
    'script,style,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,svg,math,video,audio,template';

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll(DROP_TAGS).forEach((n) => n.remove());
    for (const node of doc.body.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const v = attr.value;
        if (name === 'src' && node.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(v)) continue;
        if (name === 'href' && node.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(v.trim())) continue;
        if (name === 'class') {
          const keep = v.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
          if (keep.length) node.setAttribute('class', keep.join(' '));
          else node.removeAttribute('class');
          continue;
        }
        if (name === 'style' && !/url\s*\(|expression|position|@import|behavior|javascript/i.test(v)) continue;
        if (['colspan', 'rowspan'].includes(name) && /^\d{1,2}$/.test(v)) continue;
        node.removeAttribute(attr.name);
      }
    }
    return doc.body.innerHTML;
  }

  // ---------- Reading ----------

  function readPage(p, i, assets) {
    const mode = p.mode === 'infinite' ? 'infinite' : 'paged';
    let html = typeof p.html === 'string' ? p.html : '';
    if (assets) {
      html = html.replace(/src="asset:(assets\/[\w-]+\.\w+)"/g, (_m, name) => (assets[name] ? `src="${assets[name]}"` : ''));
    }
    const strokes = (Array.isArray(p.strokes) ? p.strokes : []).filter((s) => Ink.valid(s, true)).map(Ink.clean);
    return {
      id: isId(p.id) ? p.id : uid(),
      title: typeof p.title === 'string' && p.title.trim() ? p.title.slice(0, 120) : `Page ${i + 1}`,
      mode,
      paper: PAPER_STYLES.includes(p.paper) ? p.paper : 'plain',
      sheets: Math.min(mode === 'infinite' ? 400 : 40, Math.max(1, Math.floor(Number(p.sheets)) || 1)),
      html: sanitizeHtml(html),
      strokes: strokes.some((s) => s.tool === 'eraser') ? Ink.bakeErasers(strokes) : strokes,
      rev: 0,
    };
  }

  const colorOr = (c, i) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : DYES[i % DYES.length][0]);

  // `file` is { text } (notebook versions 1–2) or { v3: { notebook, pages, assets } }.
  function parse(file, coverIds) {
    let meta;
    let sections;
    if (file.v3) {
      meta = JSON.parse(file.v3.notebook);
      if (!meta || meta.format !== 'jotter-notebook' || !Array.isArray(meta.sections)) throw new Error('This file is not a Jotter notebook.');
      let n = 0;
      sections = meta.sections.map((sec, si) => ({
        id: uid(),
        title: typeof sec.title === 'string' && sec.title.trim() ? sec.title.slice(0, 80) : `Section ${si + 1}`,
        color: colorOr(sec.color, si),
        pages: (Array.isArray(sec.pages) ? sec.pages : [])
          .filter((name) => typeof name === 'string' && file.v3.pages[name])
          .map((name) => readPage(JSON.parse(file.v3.pages[name]), n++, file.v3.assets)),
      }));
    } else {
      meta = JSON.parse(file.text);
      if (!meta || meta.format !== 'jotter-notebook' || !Array.isArray(meta.pages)) throw new Error('This file is not a Jotter notebook.');
      sections = [{ id: uid(), title: 'Notes', color: DYES[0][0], pages: meta.pages.map((p, i) => readPage(p, i, null)) }];
    }
    if (!sections.length) sections.push(newSection('Notes'));
    for (const s of sections) if (!s.pages.length) s.pages.push(newPage('Page 1'));
    return {
      created: typeof meta.created === 'string' ? meta.created : new Date().toISOString(),
      paperColor: PAPER_COLORS[meta.paperColor] ? meta.paperColor : 'white',
      cover: coverIds.includes(meta.cover) ? meta.cover : coverIds[0],
      sections,
    };
  }

  // ---------- Writing ----------

  // A short, stable name for an image, so the same picture is stored once.
  function hashName(text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 + c, 2246822519);
    }
    return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + text.length.toString(16)).slice(0, 24);
  }

  const pageCache = new WeakMap(); // page -> { key, json, assets }

  /*
    Pictures live inside a page's text as base64. Saving stores each one once, named by a fingerprint of
    its data. Fingerprints are remembered (a picture is several MB of text, and saving happens every time
    you pause), and so is the stored form of a page's text, which stays the same while only its ink changes.
  */
  const assetNames = new Map(); // picture data -> file name
  const htmlForms = new Map(); // page text -> { html, assets }
  function assetName(b64, ext) {
    let name = assetNames.get(b64);
    if (!name) {
      if (assetNames.size > 400) assetNames.clear();
      name = `assets/${hashName(b64)}.${ext === 'jpeg' ? 'jpg' : ext}`;
      assetNames.set(b64, name);
    }
    return name;
  }
  function storedHtml(source) {
    let form = htmlForms.get(source);
    if (!form) {
      const assets = [];
      const html = source.replace(/src="data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)"/g, (_m, ext, b64) => {
        const name = assetName(b64, ext);
        assets.push({ name, data: b64 });
        return `src="asset:${name}"`;
      });
      if (htmlForms.size > 60) htmlForms.clear();
      form = { html, assets };
      htmlForms.set(source, form);
    }
    return form;
  }

  function serializePage(p) {
    const key = `${p.rev}:${p.sheets}`;
    const hit = pageCache.get(p);
    if (hit && hit.key === key) return hit;
    const { html, assets } = storedHtml(p.html);
    const { id, title, mode, paper, sheets, strokes } = p;
    const entry = { key, json: JSON.stringify({ id, title, mode, paper, sheets, html, strokes }), assets };
    pageCache.set(p, entry);
    return entry;
  }

  const newSent = () => ({ pages: new Map(), assets: new Set() });

  /*
    The save request for the main process. Pages and images the main process already has (recorded in
    `sent`) are listed by name only. Returns { request, commit } — call commit() once the save succeeds.
  */
  function buildSave(nb, sent, { full = false, extra = {} } = {}) {
    const pages = [];
    const assets = new Map();
    const sentPages = [];
    const meta = {
      format: 'jotter-notebook',
      version: 3,
      created: nb.created,
      modified: new Date().toISOString(),
      paperColor: nb.paperColor,
      cover: nb.cover,
      ...extra,
      sections: nb.sections.map((sec) => ({ title: sec.title, color: sec.color, pages: sec.pages.map((p) => `pages/${p.id}.json`) })),
    };
    for (const p of allPages(nb)) {
      const entry = serializePage(p);
      const name = `pages/${p.id}.json`;
      pages.push(!full && sent.pages.get(p.id) === entry.key ? { name } : { name, data: entry.json });
      sentPages.push([p.id, entry.key]);
      for (const a of entry.assets) if (!assets.has(a.name)) assets.set(a.name, !full && sent.assets.has(a.name) ? { name: a.name } : a);
    }
    return {
      request: { notebook: JSON.stringify(meta), pages, assets: [...assets.values()] },
      commit() {
        sent.pages = new Map(sentPages);
        sent.assets = new Set(assets.keys());
      },
    };
  }

  // ---------- Reading page content ----------

  const BLOCK_END = /<(br|\/div|\/p|\/li|\/h[1-6]|\/tr|\/td)\b[^>]*>/gi;
  const textCache = new WeakMap();

  // Plain text of a page (title not included). Cached per page revision.
  function pageText(p) {
    const hit = textCache.get(p);
    if (hit && hit.rev === p.rev) return hit.text;
    const doc = new DOMParser().parseFromString(`<body>${p.html.replace(BLOCK_END, (m) => `${m}\n`)}</body>`, 'text/html');
    const text = doc.body.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    textCache.set(p, { rev: p.rev, text });
    return text;
  }

  const isBlank = (p) => !p.strokes.length && !/<img\b/i.test(p.html) && !pageText(p);

  // Markdown for a page's text. Images and ink are left out.
  function toMarkdown(p) {
    const doc = new DOMParser().parseFromString(`<body>${p.html}</body>`, 'text/html');
    const inline = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) out += n.textContent.replace(/([*_`[\]])/g, '\\$1');
        else if (n.nodeType !== 1) continue;
        else if (n.tagName === 'BR') out += '  \n';
        else if (/^(B|STRONG)$/.test(n.tagName)) out += `**${inline(n)}**`;
        else if (/^(I|EM)$/.test(n.tagName)) out += `*${inline(n)}*`;
        else if (n.tagName === 'A') out += `[${inline(n)}](${n.getAttribute('href') || ''})`;
        else if (n.tagName === 'IMG') continue;
        else if (/^(DIV|P|UL|OL|TABLE|H[1-6])$/.test(n.tagName)) out += `\n${block(n)}\n`;
        else out += inline(n);
      }
      return out;
    };
    const block = (node) => {
      const t = node.tagName;
      if (/^H[1-6]$/.test(t)) return `${'#'.repeat(Number(t[1]))} ${inline(node).trim()}`;
      if (t === 'UL' || t === 'OL') {
        const check = node.classList.contains('checklist');
        return [...node.children]
          .map((li, i) => {
            const mark = check ? `- [${li.classList.contains('done') ? 'x' : ' '}] ` : t === 'OL' ? `${i + 1}. ` : '- ';
            return mark + inline(li).trim();
          })
          .join('\n');
      }
      if (t === 'TABLE') {
        const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => inline(td).trim().replace(/\|/g, '\\|')));
        if (!rows.length) return '';
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ')} |`;
        return [line(rows[0]), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line)].join('\n');
      }
      return inline(node).trim();
    };
    const parts = [];
    for (const n of doc.body.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) parts.push(n.textContent.trim());
      else if (n.nodeType === 1) {
        const b = /^(H[1-6]|UL|OL|TABLE)$/.test(n.tagName) ? block(n) : inline(n).trim();
        if (b) parts.push(b);
      }
    }
    return parts.join('\n\n');
  }

  root.Model = {
    PAPER_STYLES,
    PAPER_COLORS,
    DYES,
    INKS,
    TEMPLATES,
    newPage,
    newSection,
    newNotebook,
    allPages,
    sanitizeHtml,
    parse,
    buildSave,
    newSent,
    pageText,
    isBlank,
    toMarkdown,
  };
})(window);
