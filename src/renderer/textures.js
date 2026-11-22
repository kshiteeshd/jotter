'use strict';

/*
  Paper textures. Each is a small seamless tile drawn from noise (an SVG filter), laid over the paper colour
  and under the lines and writing, so it works with any paper colour. Used on screen and for PDF export,
  print and page images (the main process loads this file too).
*/
(function (root) {
  const tile = (body, size = 256) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${body}</svg>`)}")`;
  // Noise turned into soft brown-grey marks: `alpha` is the colour-matrix row that decides how much shows.
  const layer = (id, freq, octaves, alpha, seed, rgb = '0.36 0.31 0.25') => {
    const [r, g, b] = rgb.split(' ');
    return (
      `<filter id='${id}' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
      `<feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${octaves}' seed='${seed}' stitchTiles='stitch'/>` +
      `<feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${alpha}'/></filter>` +
      `<rect width='100%' height='100%' filter='url(#${id})'/>`
    );
  };

  const TEXTURES = {
    none: { name: 'None', css: 'none' },
    // Fine, even tooth, like good writing paper.
    grain: { name: 'Grain', css: tile(layer('a', '0.9', 2, '0.42 0 0 0 -0.17', 4)) },
    // Woven threads running both ways.
    linen: { name: 'Linen', css: tile(layer('a', '0.9 0.035', 2, '0.3 0 0 0 -0.125', 7) + layer('b', '0.035 0.9', 2, '0.3 0 0 0 -0.125', 11)) },
    // Scattered fibres and specks.
    recycled: { name: 'Recycled', css: tile(layer('a', '0.7', 3, '2.8 0 0 0 -2.05', 5, '0.38 0.33 0.27') + layer('b', '0.9', 2, '0.3 0 0 0 -0.12', 9)) },
    // Soft, uneven shading, like old paper.
    parchment: { name: 'Parchment', css: tile(layer('a', '0.012', 3, '0.34 0 0 0 -0.12', 3, '0.6 0.47 0.28') + layer('b', '0.9', 2, '0.3 0 0 0 -0.12', 8), 512) },
  };

  const Textures = {
    list: Object.entries(TEXTURES).map(([id, t]) => ({ id, name: t.name })),
    css: (id) => (TEXTURES[id] || TEXTURES.none).css,
    valid: (id) => Object.prototype.hasOwnProperty.call(TEXTURES, id),
  };
  if (typeof module === 'object' && module.exports) module.exports = Textures;
  else root.Textures = Textures;
})(typeof window !== 'undefined' ? window : globalThis);
