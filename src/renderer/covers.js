'use strict';

/*
  Notebook cover artwork, in three groups: traditions (drawn in the manner of Indian textile and
  folk-art traditions), modern (graphic and geometric) and nature. Every cover is an original drawing
  built from simple shapes, so it stays crisp at any size. Each one also gives the app an accent colour
  (light and dark theme) and the colour of the band under the title bar.
*/
const Covers = (() => {
  let uid = 0;
  const W = 118;
  const H = 156;
  const RICE = '#fff6e8';
  const TURMERIC = '#f4bd4b';
  const INK = '#2c221c';

  const list = [
    { group: 'Traditions', id: 'kolam', name: 'Kolam', note: 'dots and loops', accent: ['#b0462b', '#e58a66'], band: '#b0462b' },
    { group: 'Traditions', id: 'warli', name: 'Warli', note: 'mud wall figures', accent: ['#8a5434', '#d6a07a'], band: '#6b3f28' },
    { group: 'Traditions', id: 'blockprint', name: 'Block print', note: 'indigo repeat', accent: ['#2f4a8a', '#93aae6'], band: '#2c3e6b' },
    { group: 'Traditions', id: 'jali', name: 'Jali', note: 'carved stone lattice', accent: ['#2f6b5a', '#82c7b0'], band: '#2f5d50' },
    { group: 'Traditions', id: 'madhubani', name: 'Madhubani', note: 'fish and borders', accent: ['#b3322a', '#ee8a7c'], band: '#c98a12' },
    { group: 'Traditions', id: 'rangoli', name: 'Rangoli', note: 'petals in a ring', accent: ['#1f6b66', '#74c8c0'], band: '#1f4a47' },
    { group: 'Traditions', id: 'ajrakh', name: 'Ajrakh', note: 'crimson and indigo', accent: ['#8e2433', '#e4848f'], band: '#7d1f2c' },
    { group: 'Traditions', id: 'plain', name: 'Plain', note: 'a single motif', accent: ['#b0462b', '#e58a66'], band: '#c4b49a' },
    { group: 'Modern', id: 'linen', name: 'Linen', note: 'woven slate cloth', accent: ['#3d5a80', '#9db7d9'], band: '#3d4a5c' },
    { group: 'Modern', id: 'graph', name: 'Graph', note: 'engineer’s grid', accent: ['#2b5ea7', '#93b4ea'], band: '#2b5ea7' },
    { group: 'Modern', id: 'bauhaus', name: 'Bauhaus', note: 'circles and blocks', accent: ['#c0392b', '#ef8f84'], band: '#1d3557' },
    { group: 'Modern', id: 'stripes', name: 'Stripes', note: 'bold diagonals', accent: ['#835a00', '#f2c14e'], band: '#1d1d1f' },
    { group: 'Modern', id: 'polka', name: 'Polka', note: 'cream on coral', accent: ['#c0303c', '#f39aa1'], band: '#e8505b' },
    { group: 'Modern', id: 'terrazzo', name: 'Terrazzo', note: 'speckled stone', accent: ['#4f6b52', '#9cc3a0'], band: '#b9a891' },
    { group: 'Modern', id: 'marble', name: 'Marble', note: 'grey veins', accent: ['#4a5568', '#b8c2d0'], band: '#8e98a3' },
    { group: 'Modern', id: 'waves', name: 'Waves', note: 'flowing lines', accent: ['#1f5a8a', '#8fc1ea'], band: '#12355b' },
    { group: 'Nature', id: 'botanical', name: 'Botanical', note: 'leaves', accent: ['#2f6b4f', '#8fd1ad'], band: '#23453a' },
    { group: 'Nature', id: 'mountains', name: 'Mountains', note: 'layered peaks', accent: ['#3b4a6b', '#a9b8db'], band: '#3b4a6b' },
    { group: 'Nature', id: 'night', name: 'Night sky', note: 'moon and stars', accent: ['#3b4fa0', '#a8b5f0'], band: '#141b33' },
    { group: 'Nature', id: 'sunset', name: 'Sunset', note: 'warm bands', accent: ['#a83f6b', '#f29bbd'], band: '#d2557a' },
    { group: 'Nature', id: 'forest', name: 'Forest', note: 'pines in mist', accent: ['#2f5d3a', '#93cfa0'], band: '#2f5d3a' },
    { group: 'Nature', id: 'dunes', name: 'Dunes', note: 'desert curves', accent: ['#9a5a31', '#e7b083'], band: '#c97f45' },
    { group: 'Nature', id: 'rain', name: 'Rain', note: 'cloud and drops', accent: ['#3e5a78', '#a9c3de'], band: '#3e5a78' },
    { group: 'Nature', id: 'blossom', name: 'Blossom', note: 'flowering branch', accent: ['#a3375f', '#f2a5c0'], band: '#d77a9a' },
  ];

  // Repeatable pseudo-random numbers, so speckled covers look the same every time.
  function rand(seed) {
    let x = seed;
    return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  }

  const art = {
    kolam() {
      const rows = [[65], [49, 65, 81], [33, 49, 65, 81, 97], [49, 65, 81], [65]];
      let loops = '';
      let dots = '';
      rows.forEach((xs, i) =>
        xs.forEach((x) => {
          const y = 30 + i * 16;
          loops += `<circle cx="${x}" cy="${y}" r="8"/>`;
          dots += `<circle cx="${x}" cy="${y}" r="2.2"/>`;
        })
      );
      return {
        bg: '#b0462b',
        spine: '#8e3319',
        body: `<g fill="none" stroke="${RICE}" stroke-width="1.2">${loops}</g><g fill="${TURMERIC}">${dots}</g>`,
      };
    },

    warli() {
      const fig = (x) =>
        `<circle cx="${x}" cy="72" r="3.5" stroke="none"/><path d="M${x - 6} 77h12l-6 11zM${x - 6} 99h12l-6-11z"/><path d="M${x} 99v10M${x - 6} 109h6" fill="none"/>`;
      return {
        bg: '#6b3f28',
        spine: '#4f2c1b',
        body:
          `<g fill="none" stroke="#f3e6d0" stroke-width="1.2" stroke-linecap="round"><circle cx="65" cy="34" r="7"/><circle cx="65" cy="34" r="3.5"/><path d="M65 22v-5M65 46v5M53 34h-5M77 34h5M56.5 25.5l-3.5-3.5M73.5 25.5l3.5-3.5M56.5 42.5l-3.5 3.5M73.5 42.5l3.5 3.5"/></g>` +
          `<g fill="#f3e6d0" stroke="#f3e6d0" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${fig(36)}${fig(65)}${fig(94)}</g>` +
          `<path d="M42 79h11M71 79h11M30 79l-8 5M100 79l8 5" stroke="#f3e6d0" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
      };
    },

    blockprint(n) {
      return {
        bg: '#2c3e6b',
        spine: '#1f2d52',
        defs: `<pattern id="bp${n}" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M11 3L15 11 11 19 7 11z" fill="none" stroke="#e8e0cf" stroke-width="1.1"/><circle cx="11" cy="11" r="1.7" fill="#e8e0cf"/><circle cx="0" cy="0" r="1.2" fill="#e8e0cf"/><circle cx="22" cy="0" r="1.2" fill="#e8e0cf"/><circle cx="0" cy="22" r="1.2" fill="#e8e0cf"/><circle cx="22" cy="22" r="1.2" fill="#e8e0cf"/></pattern>`,
        body: `<rect x="12" width="106" height="156" fill="url(#bp${n})"/>`,
      };
    },

    jali(n) {
      return {
        bg: '#d8b985',
        spine: '#b89862',
        defs: `<pattern id="jl${n}" width="26" height="26" patternUnits="userSpaceOnUse"><rect x="5" y="5" width="16" height="16" fill="none" stroke="#2f5d50" stroke-width="1.2"/><rect x="5" y="5" width="16" height="16" fill="none" stroke="#2f5d50" stroke-width="1.2" transform="rotate(45 13 13)"/><circle cx="13" cy="13" r="2" fill="#2f5d50"/></pattern>`,
        body: `<rect x="12" width="106" height="156" fill="url(#jl${n})"/>`,
      };
    },

    madhubani() {
      return {
        bg: '#f3e3c0',
        spine: '#d8c18f',
        body:
          `<rect x="19" y="8" width="93" height="140" fill="none" stroke="#b0462b" stroke-width="1.5"/><rect x="24" y="13" width="83" height="130" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1 4" stroke-linecap="round"/>` +
          `<ellipse cx="62" cy="66" rx="26" ry="15" fill="#d9951a" stroke="${INK}" stroke-width="1.3"/><path d="M87 66l16-13v26z" fill="#b0462b" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>` +
          `<circle cx="47" cy="62" r="2.6" fill="${INK}"/><path d="M58 53v26M66 53v26M74 55v22" stroke="${INK}" stroke-width="1.1" fill="none"/>` +
          `<path d="M44 90c6 5 12 5 18 0s12-5 18 0" stroke="#b0462b" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M44 98c6 5 12 5 18 0s12-5 18 0" stroke="${INK}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
      };
    },

    rangoli() {
      let outer = '';
      let inner = '';
      let ring = '';
      for (let k = 0; k < 8; k++) {
        outer += `<ellipse cx="65" cy="42" rx="7" ry="17" transform="rotate(${k * 45} 65 62)"/>`;
        inner += `<ellipse cx="65" cy="51" rx="4.5" ry="9" transform="rotate(${k * 45 + 22.5} 65 62)"/>`;
      }
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        ring += `<circle cx="${(65 + Math.sin(a) * 38).toFixed(1)}" cy="${(62 - Math.cos(a) * 38).toFixed(1)}" r="2"/>`;
      }
      return {
        bg: '#1f4a47',
        spine: '#153634',
        body: `<g fill="#f2a7b8">${outer}</g><g fill="${RICE}">${inner}</g><g fill="${TURMERIC}">${ring}</g><circle cx="65" cy="62" r="5" fill="#c0392b"/>`,
      };
    },

    ajrakh(n) {
      return {
        bg: '#7d1f2c',
        spine: '#5c1520',
        defs: `<pattern id="aj${n}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M12 2l10 10-10 10L2 12z" fill="none" stroke="#efe3cc" stroke-width="1.2"/><path d="M12 7l5 5-5 5-5-5z" fill="#1f3a6b"/><circle cx="12" cy="12" r="1.6" fill="#efe3cc"/><circle cx="0" cy="0" r="1.6" fill="#efe3cc"/><circle cx="24" cy="0" r="1.6" fill="#efe3cc"/><circle cx="0" cy="24" r="1.6" fill="#efe3cc"/><circle cx="24" cy="24" r="1.6" fill="#efe3cc"/></pattern>`,
        body: `<rect x="12" y="10" width="106" height="136" fill="url(#aj${n})"/><rect x="12" y="0" width="106" height="8" fill="#1f3a6b"/><rect x="12" y="148" width="106" height="8" fill="#1f3a6b"/>`,
      };
    },

    plain() {
      return {
        bg: '#ece3d2',
        spine: '#d6c9b2',
        body:
          `<path d="M65 40L90 65 65 90 40 65z" fill="none" stroke="#b0462b" stroke-width="1.3" stroke-linejoin="round"/>` +
          `<g fill="#d9951a"><circle cx="65" cy="65" r="2.6"/><circle cx="65" cy="30" r="1.8"/><circle cx="100" cy="65" r="1.8"/><circle cx="65" cy="100" r="1.8"/><circle cx="30" cy="65" r="1.8"/></g>`,
      };
    },

    // ---------- Modern ----------

    linen(n) {
      return {
        bg: '#3d4a5c',
        spine: '#2e3846',
        defs: `<pattern id="ln${n}" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 .5h3M.5 0v3" stroke="#ffffff" stroke-opacity="0.07" stroke-width="0.6"/></pattern>`,
        body:
          `<rect x="12" width="106" height="156" fill="url(#ln${n})"/>` +
          `<rect x="24" y="22" width="82" height="90" rx="2" fill="none" stroke="#c9d3e0" stroke-opacity="0.55" stroke-width="1"/>` +
          `<rect x="28" y="26" width="74" height="82" rx="1.5" fill="none" stroke="#c9d3e0" stroke-opacity="0.3" stroke-width="0.8"/>`,
      };
    },

    graph(n) {
      return {
        bg: '#f4f1e8',
        spine: '#2b5ea7',
        defs:
          `<pattern id="gr${n}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#2b5ea7" stroke-opacity="0.22" stroke-width="0.6"/></pattern>` +
          `<pattern id="gR${n}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#2b5ea7" stroke-opacity="0.4" stroke-width="0.8"/></pattern>`,
        body: `<rect x="12" width="106" height="156" fill="url(#gr${n})"/><rect x="12" width="106" height="156" fill="url(#gR${n})"/>` +
          `<path d="M30 92 50 70 66 80 92 44" fill="none" stroke="#c0392b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<g fill="#c0392b"><circle cx="50" cy="70" r="2.4"/><circle cx="66" cy="80" r="2.4"/><circle cx="92" cy="44" r="2.4"/></g>`,
      };
    },

    bauhaus() {
      return {
        bg: '#f2ead8',
        spine: '#1d3557',
        body:
          `<circle cx="48" cy="46" r="24" fill="#c0392b"/>` +
          `<rect x="66" y="58" width="36" height="36" fill="#1d3557"/>` +
          `<path d="M24 112a30 30 0 0 1 30-30v30z" fill="#e9b949"/>` +
          `<path d="M60 108h46" stroke="#1d1d1f" stroke-width="3"/><circle cx="96" cy="30" r="5" fill="#1d1d1f"/>`,
      };
    },

    stripes(n) {
      return {
        bg: '#1d1d1f',
        spine: '#111112',
        defs: `<pattern id="st${n}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="14" fill="#f2c14e"/></pattern>`,
        body: `<rect x="12" width="106" height="156" fill="url(#st${n})"/><rect x="12" y="116" width="106" height="40" fill="#1d1d1f"/>`,
      };
    },

    polka(n) {
      return {
        bg: '#e8505b',
        spine: '#c63d48',
        defs: `<pattern id="pd${n}" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.6" fill="#fff4e6"/><circle cx="12" cy="12" r="2.6" fill="#fff4e6"/></pattern>`,
        body: `<rect x="12" width="106" height="156" fill="url(#pd${n})"/>`,
      };
    },

    terrazzo() {
      const r = rand(7);
      const colors = ['#c8553d', '#5b7f5e', '#3d4a5c', '#e2a33b', '#8f8478'];
      let chips = '';
      for (let i = 0; i < 46; i++) {
        const x = 14 + r() * 104;
        const y = 2 + r() * 152;
        const s = 1.6 + r() * 3.8;
        const a = r() * 6.28;
        const pts = [0, 1, 2, 3]
          .map((k) => {
            const ang = a + k * 1.57 + (r() - 0.5) * 0.8;
            const rad = s * (0.6 + r() * 0.6);
            return `${(x + Math.cos(ang) * rad).toFixed(1)},${(y + Math.sin(ang) * rad).toFixed(1)}`;
          })
          .join(' ');
        chips += `<polygon points="${pts}" fill="${colors[i % colors.length]}"/>`;
      }
      return { bg: '#efe9e1', spine: '#c9bba8', body: chips };
    },

    marble() {
      return {
        bg: '#f4f2ef',
        spine: '#c9ccd1',
        body:
          `<g fill="none" stroke-linecap="round">` +
          `<path d="M12 30C40 40 50 20 76 34s30 30 42 24" stroke="#9aa3ad" stroke-width="1.4"/>` +
          `<path d="M20 70c18-10 30 8 50-2s22-26 48-16" stroke="#b7bec6" stroke-width="0.9"/>` +
          `<path d="M12 98c26 10 34-10 58 0s30 18 48 4" stroke="#8e98a3" stroke-width="1.6"/>` +
          `<path d="M50 34c4 14-6 22 0 36M84 60c-6 12 6 20-2 38" stroke="#c4cad1" stroke-width="0.7"/>` +
          `<path d="M12 138c22-6 40 8 64-2s28-6 42 2" stroke="#a7afb8" stroke-width="1"/></g>`,
      };
    },

    waves() {
      let lines = '';
      for (let i = 0; i < 13; i++) {
        const y = 14 + i * 11;
        lines += `<path d="M10 ${y}c9-6 18-6 27 0s18 6 27 0 18-6 27 0 18 6 27 0" stroke="${i % 3 === 1 ? '#8fc1ea' : '#4c86b9'}" stroke-opacity="${i % 3 === 1 ? 0.9 : 0.6}"/>`;
      }
      return { bg: '#12355b', spine: '#0c2643', body: `<g fill="none" stroke-width="1.6" stroke-linecap="round">${lines}</g>` };
    },

    // ---------- Nature ----------

    botanical() {
      const leaf = (x, y, rot, s, c) =>
        `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0C8-12 24-14 34 0 24 14 8 12 0 0z" fill="${c}"/><path d="M2 0h28" stroke="#23453a" stroke-width="0.9" stroke-opacity="0.6"/></g>`;
      return {
        bg: '#23453a',
        spine: '#18332a',
        body:
          `<path d="M66 156C64 120 70 80 62 30" fill="none" stroke="#8fbf9f" stroke-width="1.6"/>` +
          leaf(64, 40, -120, 1, '#6fa883') + leaf(64, 52, -50, 1.05, '#8fbf9f') + leaf(65, 72, -135, 1.1, '#5b9470') +
          leaf(65, 86, -40, 1.1, '#a9d3b3') + leaf(66, 106, -140, 1.15, '#7db38f') + leaf(66, 118, -35, 1.05, '#6fa883'),
      };
    },

    mountains() {
      return {
        bg: '#f6d2b5',
        spine: '#24324d',
        body:
          `<circle cx="80" cy="46" r="15" fill="#f08a5d"/>` +
          `<path d="M12 104 40 62 58 86 78 58 118 108V156H12z" fill="#7d8db0"/>` +
          `<path d="M12 120 34 96 54 114 82 84 118 124V156H12z" fill="#4c5d84"/>` +
          `<path d="M12 138 46 116 70 132 96 112 118 130V156H12z" fill="#24324d"/>`,
      };
    },

    night() {
      const r = rand(11);
      let stars = '';
      for (let i = 0; i < 34; i++) stars += `<circle cx="${(14 + r() * 102).toFixed(1)}" cy="${(4 + r() * 112).toFixed(1)}" r="${(0.5 + r() * 1.1).toFixed(1)}" fill="#e9ecff" fill-opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
      return {
        bg: '#141b33',
        spine: '#0d1224',
        body:
          stars +
          `<path d="M80 30a20 20 0 1 0 14 34 16 16 0 1 1-14-34z" fill="#f6e7b8"/>` +
          `<path d="M12 132c20-10 40-10 60-2s32 6 46-2V156H12z" fill="#0d1224"/>`,
      };
    },

    sunset() {
      return {
        bg: '#ffb26b',
        spine: '#7a3e7a',
        body:
          `<rect x="12" y="40" width="106" height="30" fill="#ff8f6b"/>` +
          `<rect x="12" y="70" width="106" height="28" fill="#e9667a"/>` +
          `<path d="M42 98a23 23 0 0 1 46 0z" fill="#ffe2a8"/>` +
          `<rect x="12" y="98" width="106" height="58" fill="#7a3e7a"/>` +
          `<path d="M30 108h70M44 116h42M54 124h22" stroke="#ffb26b" stroke-opacity="0.6" stroke-width="1.6" stroke-linecap="round"/>`,
      };
    },

    forest() {
      const pine = (x, base, h, c) => `<path d="M${x} ${base - h}l${h * 0.34} ${h * 0.55}h${-h * 0.12}l${h * 0.22} ${h * 0.45}H${x - h * 0.44}l${h * 0.22}-${h * 0.45}h${-h * 0.12}z" fill="${c}"/>`;
      return {
        bg: '#e3ece1',
        spine: '#2f5d3a',
        body:
          `<circle cx="88" cy="34" r="11" fill="#f6f1df"/>` +
          pine(34, 104, 44, '#9cbf9f') + pine(58, 98, 52, '#9cbf9f') + pine(96, 104, 46, '#9cbf9f') +
          pine(44, 126, 50, '#5f8f68') + pine(80, 122, 58, '#5f8f68') +
          `<rect x="12" y="118" width="106" height="38" fill="#2f5d3a"/>` +
          pine(26, 140, 40, '#2f5d3a') + pine(64, 146, 46, '#244a2e') + pine(104, 140, 38, '#2f5d3a'),
      };
    },

    dunes() {
      return {
        bg: '#f6e3c4',
        spine: '#9a5a31',
        body:
          `<circle cx="38" cy="38" r="12" fill="#f2b863"/>` +
          `<path d="M12 92c24-16 52-18 76-6s22 8 30 6V156H12z" fill="#e7b083"/>` +
          `<path d="M12 116c30-12 56-6 74 2s24 6 32 2V156H12z" fill="#c97f45"/>` +
          `<path d="M12 136c22-8 48-6 64 2s30 4 42-2V156H12z" fill="#9a5a31"/>` +
          `<path d="M40 100c10-4 22-4 32 0" stroke="#f6e3c4" stroke-opacity="0.5" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
      };
    },

    rain() {
      const r = rand(23);
      let drops = '';
      for (let i = 0; i < 30; i++) {
        const x = 18 + r() * 96;
        const y = 64 + r() * 84;
        drops += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l-3 8" />`;
      }
      return {
        bg: '#5d7186',
        spine: '#3e5a78',
        body:
          `<g stroke="#cfe0f0" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.85">${drops}</g>` +
          `<path d="M34 56a14 14 0 0 1 4-27 18 18 0 0 1 34-4 13 13 0 0 1 14 18 10 10 0 0 1-2 13z" fill="#eef3f8"/>`,
      };
    },

    blossom() {
      const flower = (x, y, s) => {
        let petals = '';
        for (let k = 0; k < 5; k++) petals += `<ellipse cx="${x}" cy="${y - 4.2 * s}" rx="${2.6 * s}" ry="${3.8 * s}" transform="rotate(${k * 72} ${x} ${y})"/>`;
        return `<g fill="#f2a5c0">${petals}</g><circle cx="${x}" cy="${y}" r="${1.5 * s}" fill="#c2416b"/>`;
      };
      return {
        bg: '#fbeef0',
        spine: '#d77a9a',
        body:
          `<path d="M118 22C96 34 80 46 64 70s-24 40-40 52M84 46c-4-10 0-18 6-22M60 76c10-2 18 2 22 10M40 102c-8-4-12-10-12-18" fill="none" stroke="#6b4a3a" stroke-width="2.2" stroke-linecap="round"/>` +
          flower(94, 34, 1.3) + flower(90, 22, 0.9) + flower(70, 62, 1.2) + flower(84, 88, 1) + flower(52, 90, 1.15) + flower(28, 82, 0.95) + flower(30, 112, 1.1),
      };
    },
  };

  // Returns the cover as an inline SVG string (118 x 156 viewBox). Safe to call many times per page.
  function svg(id) {
    const make = art[id] || art.kolam;
    const n = ++uid;
    const c = make(n);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">` +
      `<defs><clipPath id="cv${n}"><rect width="${W}" height="${H}" rx="6"/></clipPath>${c.defs || ''}</defs>` +
      `<g clip-path="url(#cv${n})"><rect width="${W}" height="${H}" fill="${c.bg}"/>${c.body}` +
      `<rect width="12" height="${H}" fill="${c.spine}"/></g></svg>`
    );
  }

  const get = (id) => list.find((c) => c.id === id) || list[0];
  const groups = [...new Set(list.map((c) => c.group))];
  return { list, ids: list.map((c) => c.id), groups, svg, get };
})();
