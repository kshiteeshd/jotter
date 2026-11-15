'use strict';

/*
  Ink geometry and drawing. A stroke is a plain object:
    { tool: 'pen' | 'marker', color: '#rrggbb', size, points: [x, y, x, y, …], w?: [pressure…], flat?: 1, taper?: 1 }
  Coordinates are in sheet units (an A4 sheet is 794 × 1122). `flat` strokes (shapes) are drawn as straight
  segments; others are smoothed. `taper` strokes thin out gently at both ends, like ink from a real nib. Strokes are treated as immutable: editing returns new stroke objects.
*/
(function (root) {
  const W = 794;
  const H = 1122;
  const MARKER_ALPHA = 0.45;

  const r1 = (v) => Math.round(v * 10) / 10;
  const pressureWidth = (size, p) => size * (0.35 + 1.3 * p);

  // ---------- Bounds ----------

  const boxes = new WeakMap();
  function box(s) {
    let b = boxes.get(s);
    if (b) return b;
    const p = s.points;
    b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1];
      if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
    }
    b.pad = (s.w ? s.size * 1.65 : s.size) / 2 + 1;
    boxes.set(s, b);
    return b;
  }

  function sheetRange(s, h = H) {
    const b = box(s);
    return [Math.max(0, Math.floor((b.minY - b.pad) / h)), Math.floor((b.maxY + b.pad) / h)];
  }

  function boundsOf(strokes) {
    const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of strokes) {
      const b = box(s);
      out.minX = Math.min(out.minX, b.minX - b.pad);
      out.minY = Math.min(out.minY, b.minY - b.pad);
      out.maxX = Math.max(out.maxX, b.maxX + b.pad);
      out.maxY = Math.max(out.maxY, b.maxY + b.pad);
    }
    return out;
  }

  // ---------- Paths ----------

  // Smooth path through the points: quadratic curves between the midpoints.
  function smoothD(p) {
    const n = p.length / 2;
    let d = `M${p[0]} ${p[1]}`;
    if (n === 1) return `${d}L${p[0] + 0.01} ${p[1]}`;
    for (let i = 1; i < n - 1; i++) {
      d += `Q${p[i * 2]} ${p[i * 2 + 1]} ${r1((p[i * 2] + p[i * 2 + 2]) / 2)} ${r1((p[i * 2 + 1] + p[i * 2 + 3]) / 2)}`;
    }
    return `${d}L${p[n * 2 - 2]} ${p[n * 2 - 1]}`;
  }

  function flatD(p) {
    let d = `M${p[0]} ${p[1]}`;
    if (p.length === 2) return `${d}L${p[0] + 0.01} ${p[1]}`;
    for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
    return d;
  }

  const strokeD = (s) => (s.flat ? flatD(s.points) : smoothD(s.points));

  // The curve piece around point i, so pressure strokes can vary their width along the line.
  function segment(p, i) {
    const n = p.length / 2;
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    const sx = i === 0 ? x : (p[i * 2 - 2] + x) / 2;
    const sy = i === 0 ? y : (p[i * 2 - 1] + y) / 2;
    let ex = i === n - 1 ? x : (x + p[i * 2 + 2]) / 2;
    const ey = i === n - 1 ? y : (y + p[i * 2 + 3]) / 2;
    if (sx === ex && sy === ey) ex += 0.01;
    return [sx, sy, x, y, ex, ey];
  }

  // Pressure along a stroke: recorded from the pen, or a gentle taper at both ends for `taper` strokes.
  // The taper is measured along the line (not by point count), so it looks the same at any drawing speed.
  const tapers = new WeakMap();
  function widths(s) {
    if (s.w) return s.w;
    if (!s.taper) return null;
    let w = tapers.get(s);
    if (!w) {
      const p = s.points;
      const n = p.length / 2;
      const along = new Float64Array(n);
      for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const total = along[n - 1];
      const reach = Math.min(total / 3, 6 + s.size * 4);
      w = new Array(n);
      for (let i = 0; i < n; i++) {
        const t = reach > 0 ? Math.min(1, Math.min(along[i], total - along[i]) / reach) : 1;
        w[i] = 0.15 + 0.35 * Math.sqrt(t); // 0.5 is the stroke's own size
      }
      tapers.set(s, w);
    }
    return w;
  }

  /*
    Steadying a hand-drawn line: point i becomes a weighted average of the raw points around it
    (weights 1 4 6 4 1). Mouse input arrives in whole screen pixels; this turns the resulting staircase
    into a clean curve without lagging behind the pointer, and the first point stays exactly where the
    stroke began.
  */
  const FILTER = [1, 4, 6, 4, 1];
  const FILTER_REACH = 2;
  function filterPoint(raw, i) {
    const n = raw.length / 2;
    if (i === 0 || i === n - 1 || n < 3) return [raw[i * 2], raw[i * 2 + 1]];
    let x = 0;
    let y = 0;
    for (let k = -FILTER_REACH; k <= FILTER_REACH; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      x += raw[j * 2] * FILTER[k + FILTER_REACH];
      y += raw[j * 2 + 1] * FILTER[k + FILTER_REACH];
    }
    return [r1(x / 16), r1(y / 16)];
  }

  // Pressure strokes are drawn as runs of pieces that share a width (rounded to a quarter unit), which keeps
  // the number of drawing calls low even for long strokes.
  function pressureRuns(s) {
    const runs = [];
    const pw = widths(s);
    let cur = null;
    for (let i = 0; i < pw.length; i++) {
      const w = Math.max(0.25, Math.round(pressureWidth(s.size, pw[i]) * 4) / 4);
      const [sx, sy, cx, cy, ex, ey] = segment(s.points, i);
      if (!cur || cur.w !== w) {
        cur = { w, d: `M${r1(sx)} ${r1(sy)}` };
        runs.push(cur);
      }
      cur.d += `Q${cx} ${cy} ${r1(ex)} ${r1(ey)}`;
    }
    return runs;
  }

  const paths = new WeakMap();
  function drawStroke(ctx, s) {
    let runs = paths.get(s);
    if (!runs) {
      runs = widths(s) ? pressureRuns(s).map((r) => ({ w: r.w, p: new Path2D(r.d) })) : [{ w: s.size, p: new Path2D(strokeD(s)) }];
      paths.set(s, runs);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = s.tool === 'marker' ? MARKER_ALPHA : 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = s.color;
    for (const r of runs) {
      ctx.lineWidth = r.w;
      ctx.stroke(r.p);
    }
  }

  // SVG markup for a stroke (used for live previews and vector PDF export).
  function strokeSvg(s) {
    const op = s.tool === 'marker' ? ` stroke-opacity="${MARKER_ALPHA}"` : '';
    const attrs = `fill="none" stroke="${s.color}" stroke-linecap="round" stroke-linejoin="round"${op}`;
    if (widths(s)) return pressureRuns(s).map((r) => `<path d="${r.d}" stroke-width="${r.w}" ${attrs}/>`).join('');
    return `<path d="${strokeD(s)}" stroke-width="${s.size}" ${attrs}/>`;
  }

  // ---------- Hit testing ----------

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  function hitsStroke(s, x, y, radius) {
    const b = box(s);
    const reach = radius + b.pad;
    if (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach) return false;
    const p = s.points;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
    for (let i = 0; i < p.length - 2; i += 2) {
      if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
    }
    return false;
  }

  // ---------- Erasing ----------

  // The stroke's points, filled in so that no two are further apart than `step`.
  function resample(s, step) {
    const p = s.points;
    const w = s.w;
    const pts = [p[0], p[1]];
    const ws = w ? [w[0]] : null;
    for (let i = 2; i < p.length; i += 2) {
      const x0 = p[i - 2];
      const y0 = p[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(p[i] - x0, p[i + 1] - y0) / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        pts.push(r1(x0 + (p[i] - x0) * t), r1(y0 + (p[i + 1] - y0) * t));
        if (ws) ws.push(r1(w[i / 2 - 1] + (w[i / 2] - w[i / 2 - 1]) * t));
      }
    }
    return { pts, ws };
  }

  function piece(s, pts, ws) {
    const out = { tool: s.tool, color: s.color, size: s.size, points: pts };
    if (s.flat) out.flat = 1;
    if (ws) out.w = ws;
    else if (s.taper) out.taper = 1;
    return out;
  }

  // The parts of `s` outside the eraser's path (a round brush moved from a to b), or null if untouched.
  function cut(s, ax, ay, bx, by, reach) {
    const { pts, ws } = resample(s, Math.max(1.5, reach / 2));
    const n = pts.length / 2;
    const keep = new Uint8Array(n);
    let hit = false;
    for (let i = 0; i < n; i++) {
      keep[i] = distToSegment(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by) > reach ? 1 : 0;
      if (!keep[i]) hit = true;
    }
    if (!hit) return null;
    const pieces = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && keep[i]) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if (i - start >= 2) pieces.push(piece(s, pts.slice(start * 2, i * 2), ws && ws.slice(start, i)));
        start = -1;
      }
    }
    return pieces;
  }

  // Rub out along a→b. Returns a new strokes array if anything changed, otherwise null.
  function eraseAlong(strokes, ax, ay, bx, by, radius) {
    let out = null;
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      const b = box(s);
      const reach = radius + s.size * 0.35;
      const far =
        Math.max(ax, bx) < b.minX - reach - b.pad ||
        Math.min(ax, bx) > b.maxX + reach + b.pad ||
        Math.max(ay, by) < b.minY - reach - b.pad ||
        Math.min(ay, by) > b.maxY + reach + b.pad;
      const pieces = far ? null : cut(s, ax, ay, bx, by, reach);
      if (!pieces) {
        if (out) out.push(s);
        continue;
      }
      if (!out) out = strokes.slice(0, i);
      out.push(...pieces);
    }
    return out;
  }

  // Older notebooks stored eraser strokes on top of the ink. Apply them for real, in order.
  function bakeErasers(strokes) {
    let out = [];
    for (const s of strokes) {
      if (s.tool !== 'eraser') {
        out.push(s);
        continue;
      }
      const p = s.points;
      const r = s.size / 2;
      if (p.length === 2) out = eraseAlong(out, p[0], p[1], p[0], p[1], r) || out;
      for (let i = 2; i < p.length; i += 2) out = eraseAlong(out, p[i - 2], p[i - 1], p[i], p[i + 1], r) || out;
    }
    return out;
  }

  // ---------- Selection ----------

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i];
      const yi = poly[i + 1];
      const xj = poly[j];
      const yj = poly[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Strokes with most of their points inside the lasso.
  function inLasso(strokes, poly) {
    const out = [];
    if (poly.length < 6) return out;
    for (const s of strokes) {
      const p = s.points;
      let inside = 0;
      for (let i = 0; i < p.length; i += 2) if (pointInPolygon(p[i], p[i + 1], poly)) inside++;
      if (inside / (p.length / 2) >= 0.6) out.push(s);
    }
    return out;
  }

  function transform(s, fx, fy, k = 1) {
    const p = s.points;
    const pts = new Array(p.length);
    for (let i = 0; i < p.length; i += 2) {
      pts[i] = r1(fx(p[i]));
      pts[i + 1] = r1(fy(p[i + 1]));
    }
    const out = piece(s, pts, s.w && s.w.slice());
    out.size = Math.max(0.5, Math.round(s.size * k * 10) / 10);
    return out;
  }
  const translate = (s, dx, dy) => transform(s, (x) => x + dx, (y) => y + dy);
  const scaleAbout = (s, ox, oy, k) => transform(s, (x) => ox + (x - ox) * k, (y) => oy + (y - oy) * k, k);

  // ---------- Shapes ----------

  // Points for a shape dragged from (x0, y0) to (x1, y1). Returns a flat point list.
  function shapePoints(kind, x0, y0, x1, y1, size = 3) {
    if (kind === 'rect') return [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
    if (kind === 'ellipse') {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(r1(cx + Math.cos(a) * rx), r1(cy + Math.sin(a) * ry));
      }
      return pts;
    }
    if (kind === 'arrow') {
      const a = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.max(10, size * 3.5);
      const h1 = [r1(x1 - len * Math.cos(a - 0.45)), r1(y1 - len * Math.sin(a - 0.45))];
      const h2 = [r1(x1 - len * Math.cos(a + 0.45)), r1(y1 - len * Math.sin(a + 0.45))];
      return [x0, y0, x1, y1, ...h1, x1, y1, ...h2];
    }
    return [x0, y0, x1, y1];
  }

  // ---------- Validation ----------

  function valid(s, allowEraser = false) {
    return (
      !!s &&
      (['pen', 'marker'].includes(s.tool) || (allowEraser && s.tool === 'eraser')) &&
      Number.isFinite(s.size) &&
      (s.tool === 'eraser' || /^#[0-9a-f]{6}$/i.test(s.color)) &&
      Array.isArray(s.points) &&
      s.points.length >= 2 &&
      s.points.length % 2 === 0 &&
      s.points.length <= 400000 &&
      s.points.every(Number.isFinite) &&
      (s.w === undefined || (Array.isArray(s.w) && s.w.length === s.points.length / 2 && s.w.every(Number.isFinite)))
    );
  }

  function clean(s) {
    const out = {
      tool: s.tool,
      color: s.tool === 'eraser' ? '#000000' : s.color.toLowerCase(),
      size: Math.min(200, Math.max(0.5, s.size)),
      points: s.points,
    };
    if (s.flat) out.flat = 1;
    if (s.w && s.tool === 'pen') out.w = s.w.map((v) => Math.min(1, Math.max(0, v)));
    else if (s.taper && s.tool === 'pen' && !s.flat) out.taper = 1;
    return out;
  }

  const Ink = {
    W,
    H,
    MARKER_ALPHA,
    r1,
    pressureWidth,
    widths,
    filterPoint,
    FILTER_REACH,
    box,
    sheetRange,
    boundsOf,
    smoothD,
    strokeD,
    segment,
    drawStroke,
    strokeSvg,
    distToSegment,
    hitsStroke,
    resample,
    eraseAlong,
    bakeErasers,
    pointInPolygon,
    inLasso,
    translate,
    scaleAbout,
    shapePoints,
    valid,
    clean,
  };
  if (typeof module === 'object' && module.exports) module.exports = Ink;
  else root.Ink = Ink;
})(typeof window === 'object' ? window : globalThis);
