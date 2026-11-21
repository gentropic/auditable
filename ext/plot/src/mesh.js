// pcolormesh([X, Y,] C) — a colour-mapped grid on any rectilinear or curvilinear mesh.
//
// shading 'flat': X / Y are the cell EDGES (nx+1, ny+1, or (ny+1) × (nx+1) for a curvilinear
// mesh); 'nearest': they are the cell CENTRES (nx, ny) and the edges sit halfway between;
// 'auto' (the default) picks by their length, as matplotlib does. C[row][col] is the cell
// between Y[row] and Y[row+1], X[col] and X[col+1].
//
// A mesh with evenly spaced edges is an image: it goes through imshow's raster (one RGBA
// buffer, one blit, one draw-list op). Uneven or curvilinear meshes draw cell by cell.

import { Axes, _KINDS, _plainOpts, _result, _grid2d } from './axes.js';
import { _col } from './data.js';
import { _cssColor, getCmap, _cmapLut } from './color.js';
import { _indexer } from './norm.js';
import { _warn } from './opts.js';

const _even = (e) => { const d = e[1] - e[0]; for (let i = 2; i < e.length; i++) if (Math.abs(e[i] - e[i - 1] - d) > Math.abs(d) * 1e-9) return false; return true; };
// centres → edges halfway between, the ends extended by half a step
function _edgesOf(c) {
  const n = c.length, e = new Float64Array(n + 1);
  if (n === 1) { e[0] = c[0] - 0.5; e[1] = c[0] + 0.5; return e; }
  for (let i = 1; i < n; i++) e[i] = (c[i - 1] + c[i]) / 2;
  e[0] = c[0] - (c[1] - c[0]) / 2; e[n] = c[n - 1] + (c[n - 1] - c[n - 2]) / 2;
  return e;
}

Axes.prototype.pcolormesh = function (...args) {
  const a = args.slice();
  let o = {};
  if (a.length && _plainOpts(a[a.length - 1]) && !_grid2d(a[a.length - 1])) o = { ...a.pop() };
  let X = null, Y = null, C;
  if (a.length >= 3) [X, Y, C] = a; else [C] = a;
  const g = _grid2d(C);
  if (!g) throw new Error('plot: pcolormesh: C must be a 2D array (nested arrays, an ndarray or a DataFrame)');
  const { nx, ny } = g;
  let flat = g.flat;
  const shading = o.shading || 'auto';
  if (shading === 'gouraud') _warn('pcolormesh.gouraud', "pcolormesh(): shading 'gouraud' is not supported; drawing 'nearest'", this._strict);
  delete o.shading;
  const oo = this._opts('pcolormesh', o);
  const gx = X != null ? _grid2d(X) : null, gy = Y != null ? _grid2d(Y) : null;
  if (gx && gy) {
    // curvilinear: corner grids (ny+1) × (nx+1)
    if (gx.nx !== nx + 1 || gx.ny !== ny + 1 || gy.nx !== nx + 1 || gy.ny !== ny + 1) throw new Error(`plot: pcolormesh: a curvilinear mesh needs X and Y of (${ny + 1}) × (${nx + 1}) corners for C of ${ny} × ${nx}`);
    const tr = { type: 'pcolormesh', C: flat, nx, ny, cx: gx.flat, cy: gy.flat, opts: oo };
    this._traces.push(tr);
    return _result(this, [], { _trace: tr });
  }
  let ex, ey;
  if (X == null) { ex = Float64Array.from({ length: nx + 1 }, (_, i) => i); ey = Float64Array.from({ length: ny + 1 }, (_, i) => i); }
  else {
    const x = _col(X), y = _col(Y);
    const centres = shading === 'nearest' || shading === 'gouraud' || (shading === 'auto' && x.length === nx && y.length === ny);
    if (centres) {
      if (x.length !== nx || y.length !== ny) throw new Error(`plot: pcolormesh: shading 'nearest' takes X of ${nx} and Y of ${ny} centres, not ${x.length} and ${y.length}`);
      ex = _edgesOf(x); ey = _edgesOf(y);
    } else {
      if (x.length !== nx + 1 || y.length !== ny + 1) throw new Error(`plot: pcolormesh: X has ${x.length} and Y ${y.length} values; give the ${nx + 1} and ${ny + 1} cell edges (shading 'flat') or the ${nx} and ${ny} centres (shading 'nearest') for C of ${ny} × ${nx}`);
      ex = x; ey = y;
    }
  }
  // descending edges: flip C so the edges run up (the image path wants them ascending)
  if (ex[0] > ex[ex.length - 1]) { ex = Float64Array.from(ex).reverse(); const f = new Float64Array(flat.length); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = flat[j * nx + (nx - 1 - i)]; flat = f; }
  if (ey[0] > ey[ey.length - 1]) { ey = Float64Array.from(ey).reverse(); const f = new Float64Array(flat.length); for (let j = 0; j < ny; j++) f.set(flat.subarray((ny - 1 - j) * nx, (ny - j) * nx), j * nx); flat = f; }
  if (_even(ex) && _even(ey) && !oo.edgecolor) {
    // an even mesh is an image: row 0 at the bottom edge
    const tr = { type: 'imshow', data: flat, nx, ny, opts: { ...oo, extent: [ex[0], ex[nx], ey[0], ey[ny]], origin: 'lower' } };
    this._traces.push(tr);
    return _result(this, [], { _trace: tr });
  }
  const tr = { type: 'pcolormesh', C: flat, nx, ny, ex, ey, opts: oo };
  this._traces.push(tr);
  return _result(this, [], { _trace: tr });
};

_KINDS.pcolormesh = {
  z: 0, cmap: true, image: false,
  crange(ax, t) {
    let lo = Infinity, hi = -Infinity, minPos = Infinity;
    for (let i = 0; i < t.C.length; i++) { const v = t.C[i]; if (v - v === 0) { if (v < lo) lo = v; if (v > hi) hi = v; if (v > 0 && v < minPos) minPos = v; } }
    return { lo, hi, minPos: minPos === Infinity ? undefined : minPos };
  },
  extent(ax, t, axis, log, take, stick) {
    if (t.ex) { const e = axis === 'x' ? t.ex : t.ey; take(e[0]); take(e[e.length - 1]); stick(e[0]); stick(e[e.length - 1]); return; }
    const c = axis === 'x' ? t.cx : t.cy;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < c.length; i++) { if (c[i] < lo) lo = c[i]; if (c[i] > hi) hi = c[i]; }
    take(lo); take(hi); stick(lo); stick(hi);
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts, norm = ax._cmapNorm(t), at = _indexer(norm);
    const cm = o.cmap || ax._theme.ramp || 'viridis', lut = _cmapLut(cm), fn = lut ? null : getCmap(cm);
    const colorOf = (q) => (lut ? `rgb(${lut[q * 4]},${lut[q * 4 + 1]},${lut[q * 4 + 2]})` : fn((q + 0.5) / 256));
    const ec = o.edgecolor && o.edgecolor !== 'none' ? _cssColor(o.edgecolor) : null;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    const { nx, ny } = t;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = at(t.C[j * nx + i]);
        if (q < 0) continue;
        ctx.fillStyle = colorOf(q);
        if (t.ex) {
          const x0 = xScale.transform(t.ex[i]), x1 = xScale.transform(t.ex[i + 1]), y0 = yScale.transform(t.ey[j]), y1 = yScale.transform(t.ey[j + 1]);
          const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
          ctx.fillRect(x, y, w + (ec ? 0 : 0.5), h + (ec ? 0 : 0.5));   // a half-pixel overlap hides the seams
          if (ec) { ctx.strokeStyle = ec; ctx.lineWidth = o.linewidth || 0.5; ctx.strokeRect(x, y, w, h); }
        } else {
          const W = nx + 1, k = (r, c) => [xScale.transform(t.cx[r * W + c]), yScale.transform(t.cy[r * W + c])];
          const p = [k(j, i), k(j, i + 1), k(j + 1, i + 1), k(j + 1, i)];
          ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let s = 1; s < 4; s++) ctx.lineTo(p[s][0], p[s][1]); ctx.closePath();
          ctx.fill();
          if (ec) { ctx.strokeStyle = ec; ctx.lineWidth = o.linewidth || 0.5; ctx.stroke(); }
          else { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.5; ctx.stroke(); }
        }
      }
    }
    ctx.restore();
  },
};
