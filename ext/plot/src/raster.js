// Markers and rasters — the shapes every marker draws as, and the two raster paths that keep
// big figures fast: images (imshow) and point clouds too big to draw one canvas call at a time.
//
// MARKER SHAPES. One definition per marker, in pixels around the point, used both by the
// vector path (a canvas path per marker) and by the raster path (an antialiased stamp), so a
// marker looks the same whichever path drew it. `r` is half the marker's nominal size.
//
// STAMPS. A stamp is a marker's coverage, worked out by pure arithmetic (4 × 4 samples per
// pixel, 8 × 8 with an edge), never by drawing on a canvas: the same marker gives the same
// bytes in a browser, a worker and Node, so a rasterized figure's draw list is identical in
// every host. Positions are quantised to a quarter device pixel (16 phase stamps per marker),
// radii to ⅛ px up to 4 px and ~4% steps above, edge widths to ¹⁄₁₆ px: below what the eye
// resolves at those sizes, and it lets a handful of stamps serve every point of a cloud.
//
// BLENDING. Points composite source-over in DATA ORDER into a premultiplied RGBA byte buffer,
// exactly as one canvas fill per point would — overlaps and alpha come out as matplotlib's do.

import { isRecordingContext } from './record.js';

export const _MARKERS = 'o . s ^ v < > d D p h * + x'.split(' ');

function _regular(n, r, rot) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([r * Math.sin(a), -r * Math.cos(a)]);
  }
  return pts;
}

// marker → { kind: 'circle', r } | { kind: 'poly', pts } | { kind: 'strokes', segs, lw }
// in px, y down (so '^' points up the screen)
export function _markerShape(marker, r, lw = 1.5) {
  switch (marker) {
    case '.': return { kind: 'circle', r: Math.max(0.5, r * 0.5) };
    case 's': return { kind: 'poly', pts: [[-r, -r], [r, -r], [r, r], [-r, r]] };
    case '^': return { kind: 'poly', pts: [[0, -r], [r, r], [-r, r]] };
    case 'v': return { kind: 'poly', pts: [[0, r], [-r, -r], [r, -r]] };
    case '<': return { kind: 'poly', pts: [[-r, 0], [r, -r], [r, r]] };
    case '>': return { kind: 'poly', pts: [[r, 0], [-r, r], [-r, -r]] };
    case 'D': return { kind: 'poly', pts: [[0, -r], [r, 0], [0, r], [-r, 0]] };
    case 'd': return { kind: 'poly', pts: [[0, -r], [r * 0.6, 0], [0, r], [-r * 0.6, 0]] };
    case 'p': return { kind: 'poly', pts: _regular(5, r, 0) };
    case 'h': return { kind: 'poly', pts: _regular(6, r, 0) };
    case '*': {
      const pts = [], ri = r * 0.381966;
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5, rr = i % 2 ? ri : r;
        pts.push([rr * Math.sin(a), -rr * Math.cos(a)]);
      }
      return { kind: 'poly', pts };
    }
    case '+': return { kind: 'strokes', segs: [[-r, 0, r, 0], [0, -r, 0, r]], lw };
    case 'x': return { kind: 'strokes', segs: [[-r, -r, r, r], [r, -r, -r, r]], lw };
    default: return { kind: 'circle', r };
  }
}

// add one marker at (px, py) to the current path (the vector path batches many per path)
export function _pathMarker(ctx, shape, px, py) {
  if (shape.kind === 'circle') { ctx.moveTo(px + shape.r, py); ctx.arc(px, py, shape.r, 0, Math.PI * 2); return; }
  if (shape.kind === 'poly') {
    const p = shape.pts;
    ctx.moveTo(px + p[0][0], py + p[0][1]);
    for (let i = 1; i < p.length; i++) ctx.lineTo(px + p[i][0], py + p[i][1]);
    ctx.closePath();
    return;
  }
  for (const s of shape.segs) { ctx.moveTo(px + s[0], py + s[1]); ctx.lineTo(px + s[2], py + s[3]); }
}

// ── stamps ──────────────────────────────────────────────────────────────────────────────────

function _segDist(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  let t = l2 ? ((x - x0) * dx + (y - y0) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
  return Math.sqrt(ex * ex + ey * ey);
}

function _inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// signed distance to the shape's outline: negative inside
function _sdf(shape, x, y) {
  if (shape.kind === 'circle') return Math.sqrt(x * x + y * y) - shape.r;
  if (shape.kind === 'poly') {
    const p = shape.pts;
    let d = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, _segDist(x, y, p[j][0], p[j][1], p[i][0], p[i][1]));
    return _inPoly(x, y, p) ? -d : d;
  }
  let d = Infinity;
  for (const s of shape.segs) d = Math.min(d, _segDist(x, y, s[0], s[1], s[2], s[3]));
  return d - shape.lw / 2;
}

const _stampCache = new Map();
// samples per pixel, per axis: 4 for a fill, 8 when there is an edge (a 0.5 px edge band
// sampled every ¼ px comes out several percent too heavy)
const _SS_FILL = 4, _SS_EDGE = 8;

// A marker's stamp: coverage bytes for its fill and (optionally) its edge, on a (2h+1)² grid
// around the pixel holding the point. `r` and `ew` (edge width) are in device px.
//
// `phase` (0–15) is where in that pixel the point sits, to a quarter pixel each way:
// phase = 4·qx + qy puts the centre at ((qx + 0.5) / 4, (qy + 0.5) / 4) of the pixel. Without
// it the stamp is centred on the pixel's centre. Sixteen stamps per marker keep every point
// within ⅛ px of where it is, so a raster scatter looks like the vector one.
export function _stamp(marker, r, ew, phase) {
  // ⅛ px steps for small markers; ~4% steps (2^(1/16)) above 4 px, so a per-point size
  // column with thousands of distinct values still makes only dozens of stamps
  const rq = r <= 4 ? Math.max(0.25, Math.round(r * 8) / 8) : Math.pow(2, Math.round(Math.log2(r) * 16) / 16);
  const eq = ew > 0 ? Math.max(0.0625, Math.round(ew * 16) / 16) : 0;
  const key = `${marker}|${rq}|${eq}|${phase}`;
  let s = _stampCache.get(key);
  if (s) return s;
  const shape = _markerShape(marker, rq, Math.max(1, rq * 0.4));
  // the centre's offset from the pixel centre
  const ox = phase == null ? 0 : (((phase >> 2) + 0.5) / 4) - 0.5;
  const oy = phase == null ? 0 : (((phase & 3) + 0.5) / 4) - 0.5;
  const half = Math.ceil(rq + eq / 2 + 1);
  const size = 2 * half + 1;
  const fill = new Uint8Array(size * size);
  const edge = eq > 0 && shape.kind !== 'strokes' ? new Uint8Array(size * size) : null;
  const SS = eq > 0 ? _SS_EDGE : _SS_FILL, total = SS * SS;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let nf = 0, ne = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          // sample at the sub-pixel centre, relative to the marker's centre;
          // pixel (i, j) spans [i - half - 0.5, i - half + 0.5) around the holding pixel's centre
          const x = i - half - 0.5 + (si + 0.5) / SS - ox;
          const y = j - half - 0.5 + (sj + 0.5) / SS - oy;
          const d = _sdf(shape, x, y);
          if (d <= 0) nf++;
          if (edge && Math.abs(d) <= eq / 2) ne++;
        }
      }
      fill[j * size + i] = Math.round((nf * 255) / total);
      if (edge) edge[j * size + i] = Math.round((ne * 255) / total);
    }
  }
  s = { half, size, fill, edge, f: _sparse(fill, size, half), e: edge ? _sparse(edge, size, half) : null };
  if (_stampCache.size >= 4096) _stampCache.clear();          // a bound, not an LRU: rebuilds are cheap
  _stampCache.set(key, s);
  return s;
}

// the non-zero cells of a coverage grid, as offsets from the centre (most of a small
// marker's square is empty: a 1 px dot touches 9 of its 25 cells)
function _sparse(cov, size, half) {
  let m = 0;
  for (let i = 0; i < cov.length; i++) if (cov[i]) m++;
  const dx = new Int16Array(m), dy = new Int16Array(m), c = new Uint8Array(m);
  for (let i = 0, k = 0; i < cov.length; i++) {
    if (!cov[i]) continue;
    dx[k] = (i % size) - half; dy[k] = ((i / size) | 0) - half; c[k] = cov[i]; k++;
  }
  return { dx, dy, c, W: -1, lin: null };
}

// the same cells as pixel-index offsets in a buffer W pixels wide
function _lin(sp, W) {
  if (sp.W !== W) {
    sp.lin = new Int32Array(sp.c.length);
    for (let k = 0; k < sp.c.length; k++) sp.lin[k] = sp.dy[k] * W + sp.dx[k];
    sp.W = W;
  }
  return sp.lin;
}

// ── point rasterizer ────────────────────────────────────────────────────────────────────────

// x / 255, rounded, for x in 0 … 65535 (exact; no division in the hot loop)
// ((x + 128) + ((x + 128) >> 8)) >> 8

// one coverage list of one colour onto the buffer at pixel `base` (interior) or with
// per-cell bounds checks (a point near the edge)
function _paint(b32, W, H, sp, base, cx, cy, interior, pr, pg, pb, a) {
  const c = sp.c, m = c.length;
  const lin = _lin(sp, W);
  // opaque full coverage is one 32-bit store (little-endian RGBA: r is the low byte)
  const packed = ((a << 24) | (pb << 16) | (pg << 8) | pr) >>> 0;
  for (let k = 0; k < m; k++) {
    let pix;
    if (interior) pix = base + lin[k];
    else {
      const X = cx + sp.dx[k], Y = cy + sp.dy[k];
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      pix = Y * W + X;
    }
    const cov = c[k];
    if (cov === 255 && a === 255) { b32[pix] = packed; continue; }
    let t = cov * a + 128;
    const sa = (t + (t >> 8)) >> 8;
    if (sa === 0) continue;
    const kk = 255 - sa;
    // one 32-bit read and one 32-bit write per blended pixel, not four byte loads and stores
    const d = b32[pix];
    t = pr * cov + 128; let r = (t + (t >> 8)) >> 8;
    t = pg * cov + 128; let g = (t + (t >> 8)) >> 8;
    t = pb * cov + 128; let b = (t + (t >> 8)) >> 8;
    t = (d & 255) * kk + 128; r += (t + (t >> 8)) >> 8;
    t = ((d >>> 8) & 255) * kk + 128; g += (t + (t >> 8)) >> 8;
    t = ((d >>> 16) & 255) * kk + 128; b += (t + (t >> 8)) >> 8;
    t = (d >>> 24) * kk + 128;
    const na = sa + ((t + (t >> 8)) >> 8);
    b32[pix] = ((na << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
}

// Draw points into a W × H straight-alpha RGBA buffer.
//   X, Y        positions in CSS px of the figure (NaN = skip); the buffer's pixel is
//               ((X - ox) · k, (Y - oy) · k), k being the device pixel ratio
//   rad         radius in device px: a number, or a per-point Float32Array
//   colors      { uniform: [r,g,b,a] }
//               | { lut: Uint8ClampedArray (256 × 4), idx: Int16Array }   colour-mapped: the
//                 LUT entry per point, from the trace's norm (-1: no colour, draws nothing)
//               | { bytes: Uint8ClampedArray (n × 4) }
//   alpha       0–1, applied on top of each colour's own alpha
//   edge        null | { bytes: [r,g,b,a] | 'face', width (device px) }
export function _rasterPoints(W, H, X, Y, ox, oy, k, rad, marker, colors, alpha, edge) {
  const buf = new Uint8Array(W * H * 4);              // premultiplied while drawing
  const b32 = new Uint32Array(buf.buffer);
  const n = X.length;
  const uni = colors.uniform, lut = colors.lut, idx = colors.idx, bytes = colors.bytes;
  const ew = edge ? edge.width : 0;
  const perPointR = typeof rad !== 'number';
  // a fixed radius: its 16 phase stamps, and their cells as pixel offsets for the inlined
  // interior loop below
  const sts = perPointR ? null : Array.from({ length: 16 }, (_, q) => _stamp(marker, rad, ew, q));
  const lins = sts ? sts.map((x) => _lin(x.f, W)) : null;
  let st = null;
  const A = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  for (let p = 0; p < n; p++) {
    const fx = (X[p] - ox) * k, fy = (Y[p] - oy) * k;
    if (fx !== fx || fy !== fy) continue;
    let r, g, b, a;
    if (uni) { r = uni[0]; g = uni[1]; b = uni[2]; a = uni[3]; }
    else if (lut) {
      let q = idx[p];
      if (q < 0) continue;
      q <<= 2;
      r = lut[q]; g = lut[q + 1]; b = lut[q + 2]; a = lut[q + 3];
    } else { const q = p << 2; r = bytes[q]; g = bytes[q + 1]; b = bytes[q + 2]; a = bytes[q + 3]; }
    if (A !== 255) { const t = a * A + 128; a = (t + (t >> 8)) >> 8; }
    if (a === 0) continue;
    // the pixel holding the point, and where in it the point sits (to a quarter pixel)
    const cx = Math.floor(fx), cy = Math.floor(fy);
    const phase = ((((fx - cx) * 4) | 0) << 2) | (((fy - cy) * 4) | 0);
    if (perPointR) { const rr = rad[p]; if (!(rr > 0)) continue; st = _stamp(marker, rr, ew, phase); }
    else st = sts[phase];
    const h = st.half;
    if (cx + h < 0 || cy + h < 0 || cx - h >= W || cy - h >= H) continue;
    const interior = cx - h >= 0 && cy - h >= 0 && cx + h < W && cy + h < H;
    const base = cy * W + cx;
    // premultiply once per point
    let t = r * a + 128; const pr = (t + (t >> 8)) >> 8;
    t = g * a + 128; const pg = (t + (t >> 8)) >> 8;
    t = b * a + 128; const pb = (t + (t >> 8)) >> 8;
    if (interior && !perPointR) {
      // the common case, inlined: a fixed stamp wholly inside the buffer
      const packed = ((a << 24) | (pb << 16) | (pg << 8) | pr) >>> 0;
      const fLin = lins[phase], fCov = st.f.c, fM = fCov.length;
      for (let q = 0; q < fM; q++) {
        const pix = base + fLin[q], cov = fCov[q];
        if (cov === 255 && a === 255) { b32[pix] = packed; continue; }
        t = cov * a + 128;
        const sa = (t + (t >> 8)) >> 8;
        if (sa === 0) continue;
        const kk = 255 - sa, d = b32[pix];
        t = pr * cov + 128; let cr = (t + (t >> 8)) >> 8;
        t = pg * cov + 128; let cg = (t + (t >> 8)) >> 8;
        t = pb * cov + 128; let cb = (t + (t >> 8)) >> 8;
        t = (d & 255) * kk + 128; cr += (t + (t >> 8)) >> 8;
        t = ((d >>> 8) & 255) * kk + 128; cg += (t + (t >> 8)) >> 8;
        t = ((d >>> 16) & 255) * kk + 128; cb += (t + (t >> 8)) >> 8;
        t = (d >>> 24) * kk + 128;
        const na = sa + ((t + (t >> 8)) >> 8);
        b32[pix] = ((na << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
      }
    } else _paint(b32, W, H, st.f, base, cx, cy, interior, pr, pg, pb, a);
    if (st.e && edge) {
      let er, eg, eb, ea;
      if (edge.bytes === 'face') { er = r; eg = g; eb = b; ea = a; }
      else { er = edge.bytes[0]; eg = edge.bytes[1]; eb = edge.bytes[2]; t = edge.bytes[3] * A + 128; ea = (t + (t >> 8)) >> 8; }
      t = er * ea + 128; const per = (t + (t >> 8)) >> 8;
      t = eg * ea + 128; const peg = (t + (t >> 8)) >> 8;
      t = eb * ea + 128; const peb = (t + (t >> 8)) >> 8;
      _paint(b32, W, H, st.e, base, cx, cy, interior, per, peg, peb, ea);
    }
  }
  _unpremultiply(buf);
  return new Uint8ClampedArray(buf.buffer);
}

// premultiplied → straight alpha (what ImageData and the draw list's image op carry). A
// channel can round a hair above its alpha after many blends; it is clamped, not wrapped.
function _unpremultiply(buf) {
  for (let o = 0; o < buf.length; o += 4) {
    const a = buf[o + 3];
    if (a === 0 || a === 255) continue;
    const h = a >> 1;
    buf[o] = Math.min(255, ((buf[o] * 255 + h) / a) | 0);
    buf[o + 1] = Math.min(255, ((buf[o + 1] * 255 + h) / a) | 0);
    buf[o + 2] = Math.min(255, ((buf[o + 2] * 255 + h) / a) | 0);
  }
}

// ── blitting a buffer onto the figure ───────────────────────────────────────────────────────

function _scratch(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    if (c && c.getContext) { c.width = w; c.height = h; return c; }
  }
  return null;
}

// Draw a cols × rows RGBA buffer into the rect (x, y, w, h). `holder` (any object) keeps the
// scratch canvas or the encoded op between draws, so a redraw at the same view only re-blits.
// Returns false when this host can't blit (no canvas to put the pixels on); callers fall back.
export function _blit(ctx, x, y, w, h, cols, rows, rgba, holder, smooth = false) {
  if (isRecordingContext(ctx)) {
    ctx._image(x, y, w, h, cols, rows, rgba, holder);
    return true;
  }
  if (typeof ctx.drawImage !== 'function') return false;
  let cv = holder && holder.canvas && holder.rgba === rgba ? holder.canvas : null;
  if (!cv) {
    cv = _scratch(cols, rows);
    if (!cv || typeof ImageData === 'undefined') return false;
    cv.getContext('2d').putImageData(new ImageData(rgba, cols, rows), 0, 0);
    if (holder) { holder.canvas = cv; holder.rgba = rgba; }
  }
  const was = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = !!smooth;
  ctx.drawImage(cv, x, y, w, h);
  ctx.imageSmoothingEnabled = was;
  return true;
}
