// contour / contourf — lines and filled bands of a 2D field.
//
// HOW. Each grid cell is split into four triangles around its centre, the centre's value the
// mean of the four corners. Within a triangle the field is linear, so a level crosses it in one
// straight segment and a band is a convex clip of it: the lines and the fills come from the
// same geometry and meet exactly. The centre point resolves a saddle cell by the cell-centre
// average (the spec's rule) — the two diagonal pairs join on the side the mean is on. A cell
// with a NaN corner is left out.
//
// Filled bands are drawn bottom up as superlevel sets: band k is everything ≥ its lower
// level, painted over the band below. A point ends up in the colour of the highest level it
// reaches, and neighbouring bands overlap instead of meeting edge to edge, so no hairline of
// background shows between them.
//
// The geometry is in data coordinates and cached on the trace; a render only projects it.

import { Axes, _KINDS, _plainOpts, _result, _grid2d } from './axes.js';
import { _col, _isArrayLike } from './data.js';
import { _cssColor, getCmap, _cmapLut, _colorBytes } from './color.js';
import { _blit } from './raster.js';
import { _niceTicks } from './nice.js';
import { Normalize, BoundaryNorm, _resolveNorm } from './norm.js';
import { _warn } from './opts.js';
import { dashArray } from './format.js';

// contour(Z) · contour(Z, levels) · contour(X, Y, Z) · contour(X, Y, Z, levels), + opts
function _args(fn, args) {
  const a = args.slice();
  let opts = {};
  if (a.length && _plainOpts(a[a.length - 1]) && !_grid2d(a[a.length - 1])) opts = { ...a.pop() };
  let X = null, Y = null, Z, levels = opts.levels;
  if (a.length >= 3) { [X, Y, Z] = a; if (a.length > 3) levels = a[3]; }
  else { Z = a[0]; if (a.length > 1) levels = a[1]; }
  const g = _grid2d(Z);
  if (!g) throw new Error(`plot: ${fn}: Z must be a 2D array (nested arrays, an ndarray or a DataFrame)`);
  if (g.nx < 2 || g.ny < 2) throw new Error(`plot: ${fn}: Z must be at least 2 × 2, not ${g.ny} × ${g.nx}`);
  return { X, Y, g, levels, opts };
}

// a grid index (fi along a row, fj down the rows) → data x, y: from 1D or 2D X / Y, an extent,
// or the indices themselves (matplotlib's contour(Z))
function _mapper(X, Y, nx, ny, extent, fn) {
  if (X != null && Y != null) {
    const gx = _grid2d(X), gy = _grid2d(Y);
    if (gx && gy) {
      if (gx.nx !== nx || gx.ny !== ny || gy.nx !== nx || gy.ny !== ny) throw new Error(`plot: ${fn}: X and Y must be ${ny} × ${nx} like Z`);
      const bil = (f, fi, fj) => {
        const i = Math.min(nx - 2, Math.floor(fi)), j = Math.min(ny - 2, Math.floor(fj)), u = fi - i, v = fj - j;
        const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i], d = f[(j + 1) * nx + i + 1];
        return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
      };
      return (fi, fj) => [bil(gx.flat, fi, fj), bil(gy.flat, fi, fj)];
    }
    const x = _col(X), y = _col(Y);
    if (x.length !== nx || y.length !== ny) throw new Error(`plot: ${fn}: X has ${x.length} values and Y ${y.length}, but Z is ${ny} rows × ${nx} columns (X runs along a row, Y down the rows)`);
    const lin = (a, f) => { const i = Math.min(a.length - 2, Math.floor(f)), u = f - i; return a[i] + (a[i + 1] - a[i]) * u; };
    const m = (fi, fj) => [lin(x, fi), lin(y, fj)];
    m.inv = [_invLin(x), _invLin(y)];
    return m;
  }
  if (extent) {
    const [x0, x1, y0, y1] = Array.from(extent, Number);
    const m = (fi, fj) => [x0 + (fi / (nx - 1)) * (x1 - x0), y0 + (fj / (ny - 1)) * (y1 - y0)];
    m.inv = [(v) => ((v - x0) / (x1 - x0)) * (nx - 1), (v) => ((v - y0) / (y1 - y0)) * (ny - 1)];
    return m;
  }
  const m = (fi, fj) => [fi, fj];
  m.inv = [(v) => v, (v) => v];
  return m;
}
// a monotonic coordinate column → its fractional index at a value (NaN outside)
function _invLin(a) {
  const n = a.length, up = a[n - 1] >= a[0];
  return (v) => {
    if (up ? v < a[0] || v > a[n - 1] : v > a[0] || v < a[n - 1]) return NaN;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((a[mid] <= v) === up) lo = mid; else hi = mid; }
    const d = a[hi] - a[lo];
    return lo + (d ? (v - a[lo]) / d : 0);
  };
}

// the levels: given, or about n nice ones (matplotlib's default n = 7); for filled bands the
// outer levels reach past the data so every value is in a band
function _levels(levels, zlo, zhi, filled) {
  if (_isArrayLike(levels)) return Array.from(levels, Number).sort((a, b) => a - b);
  const n = levels == null ? 7 : Math.max(1, levels | 0);
  if (!(zhi > zlo)) return filled ? [zlo - 0.5, zlo + 0.5] : [zlo];
  const t = _niceTicks(zlo, zhi, n + 2), step = t.step || (zhi - zlo) / n;   // MaxNLocator(n + 1): n + 1 bins
  const lv = Array.from(t);
  if (!filled) return lv.filter((v) => v > zlo && v < zhi).length ? lv.filter((v) => v > zlo && v < zhi) : lv;
  if (lv[0] > zlo + step * 1e-9) lv.unshift(+(lv[0] - step).toPrecision(12));
  if (lv[lv.length - 1] < zhi - step * 1e-9) lv.push(+(lv[lv.length - 1] + step).toPrecision(12));
  return lv;
}

// the four triangles of every cell: each as three (fi, fj, z) vertices, through `visit`
function _eachTriangle(g, visit) {
  const { flat: Z, nx, ny } = g;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = Z[j * nx + i], b = Z[j * nx + i + 1], c = Z[(j + 1) * nx + i + 1], d = Z[(j + 1) * nx + i];
      if (a - a !== 0 || b - b !== 0 || c - c !== 0 || d - d !== 0) continue;
      const e = (a + b + c + d) / 4, ei = i + 0.5, ej = j + 0.5;
      visit(i, j, a, i + 1, j, b, ei, ej, e);
      visit(i + 1, j, b, i + 1, j + 1, c, ei, ej, e);
      visit(i + 1, j + 1, c, i, j + 1, d, ei, ej, e);
      visit(i, j + 1, d, i, j, a, ei, ej, e);
    }
  }
}

// clip a polygon [fi, fj, z, …] to z ≥ c (sign 1) or z ≤ c (sign -1): Sutherland–Hodgman
function _clip(poly, c, sign) {
  const out = [], n = poly.length / 3;
  for (let k = 0; k < n; k++) {
    const i0 = k * 3, i1 = ((k + 1) % n) * 3;
    const z0 = poly[i0 + 2], z1 = poly[i1 + 2];
    const in0 = sign > 0 ? z0 >= c : z0 <= c, in1 = sign > 0 ? z1 >= c : z1 <= c;
    if (in0) out.push(poly[i0], poly[i0 + 1], z0);
    if (in0 !== in1) {
      const t = (c - z0) / (z1 - z0);
      out.push(poly[i0] + (poly[i1] - poly[i0]) * t, poly[i0 + 1] + (poly[i1 + 1] - poly[i0 + 1]) * t, c);
    }
  }
  return out;
}

// filled: per band, the polygons of {z ≥ lower} (∩ {z ≤ top} unless extending past it), in data
// coordinates: { xy: Float64Array, starts: number[] }. A cell wholly inside a band region joins
// a run along its row, and a run is ONE rectangle (on a rectilinear grid; a curvilinear grid
// keeps its cells' own quads); only cells a level crosses are split into triangles.
function _bands(g, levels, extend, map) {
  const { flat: Z, nx, ny } = g;
  const nb = levels.length - 1;
  const lows = [];
  if (extend === 'min' || extend === 'both') lows.push(-Infinity);
  for (let k = 0; k < nb; k++) lows.push(levels[k]);
  if (extend === 'max' || extend === 'both') lows.push(levels[nb]);
  const top = extend === 'max' || extend === 'both' ? Infinity : levels[nb];
  const acc = lows.map(() => ({ xy: [], starts: [] }));
  const rect = !!map.inv;
  const poly = (k, pts) => {                               // pts: [fi, fj, …] in index space
    const a = acc[k];
    a.starts.push(a.xy.length);
    for (let q = 0; q < pts.length; q += 2) { const p = map(pts[q], pts[q + 1]); a.xy.push(p[0], p[1]); }
  };
  const run = new Int32Array(lows.length).fill(-1);
  const flush = (k, j, iEnd) => {
    if (run[k] < 0) return;
    const i0 = run[k];
    if (rect) poly(k, [i0, j, iEnd, j, iEnd, j + 1, i0, j + 1]);
    else for (let i = i0; i < iEnd; i++) poly(k, [i, j, i + 1, j, i + 1, j + 1, i, j + 1]);
    run[k] = -1;
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = Z[j * nx + i], b = Z[j * nx + i + 1], c = Z[(j + 1) * nx + i + 1], d = Z[(j + 1) * nx + i];
      if (a - a !== 0 || b - b !== 0 || c - c !== 0 || d - d !== 0) { for (let k = 0; k < lows.length; k++) flush(k, j, i); continue; }
      const e = (a + b + c + d) / 4;
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      for (let k = 0; k < lows.length; k++) {
        const L = lows[k];
        if (lo >= L && hi <= top) { if (run[k] < 0) run[k] = i; continue; }   // wholly inside: extend the run
        flush(k, j, i);
        if (hi < L || lo > top) continue;                   // wholly outside
        // crossed: its four triangles, clipped
        const ei = i + 0.5, ej = j + 0.5;
        for (const tri of [[i, j, a, i + 1, j, b, ei, ej, e], [i + 1, j, b, i + 1, j + 1, c, ei, ej, e], [i + 1, j + 1, c, i, j + 1, d, ei, ej, e], [i, j + 1, d, i, j, a, ei, ej, e]]) {
          let t3 = tri;
          const tl = Math.min(t3[2], t3[5], t3[8]), th = Math.max(t3[2], t3[5], t3[8]);
          if (th < L || tl > top) continue;
          if (th > top) t3 = _clip(t3, top, -1);
          if (tl < L) t3 = _clip(t3, L, 1);
          if (t3.length < 9) continue;
          const pts = [];
          for (let q = 0; q < t3.length; q += 3) pts.push(t3[q], t3[q + 1]);
          poly(k, pts);
        }
      }
    }
    for (let k = 0; k < lows.length; k++) flush(k, j, nx - 1);
  }
  return { lows, bands: acc.map((a) => ({ xy: Float64Array.from(a.xy), starts: a.starts })) };
}

// the raster path, for big rectilinear grids: each device pixel takes the band of the field
// at its centre — the same four-triangle linear field the lines follow, so they agree — in
// one image (one blit, one draw-list op). The vector bands stay what SVG export draws.
const _RASTER_CELLS = 40000;
function _bandRaster(ax, t, xScale, yScale, rect, colors) {
  const { flat: Z, nx, ny } = t.g, [ix, iy] = t.map.inv;
  const dpr = rect.dpr || 1, W = Math.max(1, Math.round(rect.w * dpr)), H = Math.max(1, Math.round(rect.h * dpr));
  const lows = t._cache.lows, top = t.extend === 'max' || t.extend === 'both' ? Infinity : t.levels[t.levels.length - 1];
  const bytes = colors.map((cc) => { const b = _colorBytes(cc); return b || [0, 0, 0, 0]; });
  const fis = new Float64Array(W), fjs = new Float64Array(H);
  for (let px = 0; px < W; px++) fis[px] = ix(xScale.inverse(rect.x + (px + 0.5) / dpr));
  for (let py = 0; py < H; py++) fjs[py] = iy(yScale.inverse(rect.y + (py + 0.5) / dpr));
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let py = 0; py < H; py++) {
    const fj = fjs[py];
    if (fj !== fj) continue;
    const j = Math.min(ny - 2, Math.floor(fj)), v = fj - j;
    for (let px = 0; px < W; px++) {
      const fi = fis[px];
      if (fi !== fi) continue;
      const i = Math.min(nx - 2, Math.floor(fi)), u = fi - i;
      const a = Z[j * nx + i], b = Z[j * nx + i + 1], c = Z[(j + 1) * nx + i + 1], d = Z[(j + 1) * nx + i];
      if (a - a !== 0 || b - b !== 0 || c - c !== 0 || d - d !== 0) continue;
      const e = (a + b + c + d) / 4;
      // which of the four triangles about the centre, then linear in it
      let z;
      if (v <= u && v <= 1 - u) z = a + (b - a) * (u - v) + (e - a) * 2 * v;               // bottom (a, b, e)
      else if (u >= v && u >= 1 - v) z = b + (c - b) * (v - (1 - u)) + (e - b) * 2 * (1 - u); // right (b, c, e)
      else if (v >= u && v >= 1 - u) z = d + (c - d) * (u - (1 - v)) + (e - d) * 2 * (1 - v); // top (d, c, e)
      else z = a + (d - a) * (v - u) + (e - a) * 2 * u;                                       // left (a, d, e)
      if (z > top) continue;
      let k = -1;
      for (let q = lows.length - 1; q >= 0; q--) if (z >= lows[q]) { k = q; break; }
      if (k < 0) continue;
      const o = (py * W + px) * 4, cb = bytes[k];
      rgba[o] = cb[0]; rgba[o + 1] = cb[1]; rgba[o + 2] = cb[2]; rgba[o + 3] = cb[3];
    }
  }
  return { rgba, W, H };
}

// lines: per level, the segments where the triangles cross it, in data coordinates
function _lines(g, levels, map) {
  const acc = levels.map(() => []);
  _eachTriangle(g, (i0, j0, z0, i1, j1, z1, i2, j2, z2) => {
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    for (let k = 0; k < levels.length; k++) {
      const c = levels[k];
      if (c < lo || c > hi || lo === hi) continue;
      const P = [i0, j0, z0, i1, j1, z1, i2, j2, z2], pts = [];
      for (let e = 0; e < 3; e++) {
        const a = e * 3, b = ((e + 1) % 3) * 3, za = P[a + 2], zb = P[b + 2];
        if ((za < c) !== (zb < c)) { const t = (c - za) / (zb - za); pts.push(P[a] + (P[b] - P[a]) * t, P[a + 1] + (P[b + 1] - P[a + 1]) * t); }
      }
      if (pts.length >= 4) { const p = map(pts[0], pts[1]), q = map(pts[2], pts[3]); acc[k].push(p[0], p[1], q[0], q[1]); }
    }
  });
  return acc.map((s) => Float64Array.from(s));
}

function _contour(ax, fn, filled, args) {
  const { X, Y, g, levels: lv, opts } = _args(fn, args);
  const o = ax._opts(fn, opts);
  delete o.levels;
  let zlo = Infinity, zhi = -Infinity;
  for (let i = 0; i < g.flat.length; i++) { const v = g.flat[i]; if (v - v === 0) { if (v < zlo) zlo = v; if (v > zhi) zhi = v; } }
  if (!(zlo <= zhi)) { zlo = 0; zhi = 1; }
  const levels = _levels(lv, zlo, zhi, filled);
  if (filled && levels.length < 2) throw new Error(`plot: ${fn}: filled contours need at least two levels`);
  const extend = o.extend || 'neither';
  if (!['neither', 'min', 'max', 'both'].includes(extend)) _warn(`${fn}.extend.${extend}`, `${fn}(): extend must be 'neither', 'min', 'max' or 'both'`, ax._strict);
  const map = _mapper(X, Y, g.nx, g.ny, o.extent, fn);
  // the corners give the trace's extent
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (let j = 0; j < g.ny; j += Math.max(1, g.ny - 1)) for (let i = 0; i < g.nx; i++) { const p = map(i, j); xlo = Math.min(xlo, p[0]); xhi = Math.max(xhi, p[0]); ylo = Math.min(ylo, p[1]); yhi = Math.max(yhi, p[1]); }
  for (let i = 0; i < g.nx; i += Math.max(1, g.nx - 1)) for (let j = 0; j < g.ny; j++) { const p = map(i, j); xlo = Math.min(xlo, p[0]); xhi = Math.max(xhi, p[0]); ylo = Math.min(ylo, p[1]); yhi = Math.max(yhi, p[1]); }
  if (o.colors != null) o.colors = (Array.isArray(o.colors) ? o.colors : [o.colors]).map(_cssColor);
  const trace = { type: filled ? 'contourf' : 'contour', g, levels, extend, map, box: [xlo, xhi, ylo, yhi], opts: o, cmapped: o.colors == null };
  ax._traces.push(trace);
  return _result(ax, [], { levels: levels.slice(), extend, _trace: trace, filled, cmap: o.cmap, get allsegs() { return _allsegs(trace); },
    __repr__: () => '<matplotlib.contour.QuadContourSet>' });
}
function _allsegs(t) {
  const segs = t._cache && t._cache.lines ? t._cache.lines : _lines(t.g, t.levels, t.map);
  return segs.map((s) => { const out = []; for (let i = 0; i < s.length; i += 4) out.push([[s[i], s[i + 1]], [s[i + 2], s[i + 3]]]); return out; });
}

// a level's (or band's) colour: the colors option (cycled), else the map through the norm
function _colorsOf(ax, t, values) {
  const o = t.opts;
  if (o.colors) return values.map((_, k) => o.colors[k % o.colors.length]);
  const norm = ax._cmapNorm(t), fn = getCmap(o.cmap || ax._theme.ramp || 'viridis'), lut = _cmapLut(o.cmap || ax._theme.ramp || 'viridis');
  return values.map((v) => {
    const tt = norm.call(v);
    if (lut) { const q = Math.max(0, Math.min(255, (tt * 256) | 0)) * 4; return `rgb(${lut[q]},${lut[q + 1]},${lut[q + 2]})`; }
    return fn(tt);
  });
}
// the lower level of each band region (the extend bands' open ends included)
function _bandLows(t) {
  const L = t.levels, lows = [];
  if (t.extend === 'min' || t.extend === 'both') lows.push(-Infinity);
  for (let k = 0; k < L.length - 1; k++) lows.push(L[k]);
  if (t.extend === 'max' || t.extend === 'both') lows.push(L[L.length - 1]);
  return lows;
}

// what a band's colour is taken at: its middle (matplotlib's "layers"); an extended band its
// open end's level
function _layers(t) {
  const L = t.levels, out = [];
  if (t.extend === 'min' || t.extend === 'both') out.push(L[0] - (L[1] - L[0]) / 2);
  for (let k = 0; k < L.length - 1; k++) out.push((L[k] + L[k + 1]) / 2);
  if (t.extend === 'max' || t.extend === 'both') out.push(L[L.length - 1] + (L[L.length - 1] - L[L.length - 2]) / 2);
  return out;
}

const _kind = (filled) => ({
  z: filled ? 0.5 : 2, cmap: true,
  extent(ax, t, axis, log, take, stick) {
    const [a, b] = axis === 'x' ? [t.box[0], t.box[1]] : [t.box[2], t.box[3]];
    take(a); take(b); stick(a); stick(b);                  // contours autoscale tight, as images do
  },
  // the norm: over the levels (lines) or the band middles (fills), unless given
  cnorm(ax, t) {
    const o = t.opts, vals = filled ? _layers(t) : t.levels;
    const inner = filled ? vals.slice(t.extend === 'min' || t.extend === 'both' ? 1 : 0, vals.length - (t.extend === 'max' || t.extend === 'both' ? 1 : 0)) : vals;
    const lo = Math.min(...inner), hi = Math.max(...inner);
    return _resolveNorm(o.norm, o.vmin, o.vmax, lo, hi === lo ? lo + 1 : hi, lo > 0 ? lo : undefined);
  },
  render(ax, ctx, t, xScale, yScale, rect) {
    const o = t.opts, c = t._cache || (t._cache = {});
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    const ax_ = xScale.a, bx = xScale.b, ay = yScale.a, by = yScale.b, xl = xScale.log, yl = yScale.log;
    const px = (v) => (xl ? xScale.transform(v) : ax_ * v + bx), py = (v) => (yl ? yScale.transform(v) : ay * v + by);
    if (filled) {
      const colors = _colorsOf(ax, t, _layers(t));
      if (t.map.inv && (t.g.nx - 1) * (t.g.ny - 1) > _RASTER_CELLS && !t.opts.vector) {
        if (!c.lows) c.lows = _bandLows(t);
        const key = `${xScale.a},${xScale.b},${yScale.a},${yScale.b},${rect.w}x${rect.h},${rect.dpr},${colors.join(',')}`;
        if (!c.raster || c.raster.key !== key) c.raster = { key, ..._bandRaster(ax, t, xScale, yScale, rect, colors) };
        ctx.restore();
        _blit(ctx, rect.x, rect.y, rect.w, rect.h, c.raster.W, c.raster.H, c.raster.rgba, c.raster, false);
        return;
      }
      if (!c.bands) c.bands = _bands(t.g, t.levels, t.extend, t.map);
      c.bands.bands.forEach((b, k) => {
        if (!b.starts.length) return;
        ctx.beginPath();
        const { xy, starts } = b;
        for (let s = 0; s < starts.length; s++) {
          const from = starts[s], to = s + 1 < starts.length ? starts[s + 1] : xy.length;
          ctx.moveTo(px(xy[from]), py(xy[from + 1]));
          for (let q = from + 2; q < to; q += 2) ctx.lineTo(px(xy[q]), py(xy[q + 1]));
          ctx.closePath();
        }
        ctx.fillStyle = colors[k];
        ctx.fill();
      });
    } else {
      if (!c.lines) c.lines = _lines(t.g, t.levels, t.map);
      const colors = _colorsOf(ax, t, t.levels);
      const lws = o.linewidths, lss = o.linestyles;
      const mono = o.colors && o.colors.length === 1;
      c.lines.forEach((seg, k) => {
        if (!seg.length) return;
        ctx.strokeStyle = colors[k];
        ctx.lineWidth = lws == null ? 1.5 : _isArrayLike(lws) ? +lws[k % lws.length] : +lws;
        // matplotlib: a single-colour contour draws negative levels dashed
        const ls = lss != null ? (Array.isArray(lss) ? lss[k % lss.length] : lss) : mono && t.levels[k] < 0 ? '--' : '-';
        ctx.setLineDash(dashArray(ls));
        ctx.beginPath();
        for (let q = 0; q < seg.length; q += 4) { ctx.moveTo(px(seg[q]), py(seg[q + 1])); ctx.lineTo(px(seg[q + 2]), py(seg[q + 3])); }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    ctx.restore();
  },
  // the colorbar: filled bands as discrete, evenly spaced blocks with the levels as ticks
  // (matplotlib's colorbar for contourf); lines as a continuous bar ticked at the levels
  cbar(ax, t) {
    if (!filled) return { norm: ax._cmapNorm(t), extend: t.extend, ticks: t.levels.slice() };
    const L = t.levels.slice();
    const colors = _colorsOf(ax, t, _layers(t));
    const inner = colors.slice(t.extend === 'min' || t.extend === 'both' ? 1 : 0, colors.length - (t.extend === 'max' || t.extend === 'both' ? 1 : 0));
    return { norm: new BoundaryNorm(L, 256), bandColors: inner, extend: t.extend, extColors: [colors[0], colors[colors.length - 1]] };
  },
  legend(ax, t) { return { patch: filled, color: _colorsOf(ax, t, filled ? _layers(t) : t.levels)[0] }; },
});
_KINDS.contourf = _kind(true);
_KINDS.contour = _kind(false);

Axes.prototype.contour = function (...args) { return _contour(this, 'contour', false, args); };
Axes.prototype.contourf = function (...args) { return _contour(this, 'contourf', true, args); };
void Normalize;
