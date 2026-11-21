// Plan views: maps in projected or local coordinates, with no basemap — block-model benches,
// collars, licence areas. Polygons with holes (matplotlib's fill, and its Polygon / Rectangle /
// Circle patches through add_patch), GeoJSON-shaped geometry (so @gcu/wkt output and a
// FeatureCollection drop straight in), and the map furniture: a scale bar and a north arrow.
// Each is a trace kind (axes.js _KINDS), so the autoscale, the legend, picking and the draw
// list treat it like any other mark.

import { Axes, _KINDS, _plainOpts, _result, _artistOps } from './axes.js';
import { _col, _isArrayLike } from './data.js';
import { _cssColor } from './color.js';
import { dashArray, parseFormat } from './format.js';
import { _warn, _checkOpts, _resolveAliases } from './opts.js';
import { _font } from './style.js';

// ── the polygon kind: { parts: [{ rings: [[xs, ys], …], properties }], opts }. A part is one
// polygon — its first ring the outline, the rest holes — filled even-odd, so a hole is a hole
// whichever way its ring winds (GeoJSON says counter-clockwise outlines, shapefiles say
// clockwise; neither is relied on). ──
function _ring(xs, ys) { return [Float64Array.from(xs, Number), Float64Array.from(ys, Number)]; }

function _polyTrace(ax, fn, parts, opts, cycleColor) {
  const o = ax._opts(fn, opts);
  if (o.color != null && o.facecolor == null) o.facecolor = o.color;
  if (o.facecolor == null) o.facecolor = cycleColor ? ax._nextColor() : ax._theme.cycle[0];
  o.facecolor = o.facecolor === 'none' ? 'none' : _cssColor(o.facecolor);
  if (o.edgecolor != null && o.edgecolor !== 'none') o.edgecolor = _cssColor(o.edgecolor);
  if (o.fill === false) { if (o.edgecolor == null) o.edgecolor = o.facecolor; o.facecolor = 'none'; }
  // matplotlib's legend swatch reads the face
  o.color = o.facecolor !== 'none' ? o.facecolor : o.edgecolor;
  const tr = { type: 'polygon', parts, opts: o };
  ax._traces.push(tr);
  return tr;
}

// the pixel path of every ring of the trace; a non-finite vertex lifts the pen
function _tracePath(ctx, tr, xS, yS) {
  ctx.beginPath();
  for (const part of tr.parts) {
    for (const [xs, ys] of part.rings) {
      let pen = false;
      for (let i = 0; i < xs.length; i++) {
        const X = xS.transform(xs[i]), Y = yS.transform(ys[i]);
        if (X - X !== 0 || Y - Y !== 0) { pen = false; continue; }
        if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
      }
      if (tr.opts.closed !== false) ctx.closePath();
    }
  }
}

// even-odd: is (x, y) inside the part? (data coordinates)
function _inside(part, x, y) {
  let inside = false;
  for (const [xs, ys] of part.rings) {
    const n = xs.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
    }
  }
  return inside;
}

_KINDS.polygon = {
  z: 1, patch: true,
  extent(ax, tr, axis, log, take) {
    for (const part of tr.parts) for (const ring of part.rings) {
      const a = ring[axis === 'x' ? 0 : 1];
      for (let i = 0; i < a.length; i++) { const v = a[i]; if (v - v === 0 && (!log || v > 0)) take(v); }
    }
  },
  render(ax, ctx, tr, xScale, yScale) {
    const o = tr.opts;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    _tracePath(ctx, tr, xScale, yScale);
    if (o.facecolor !== 'none') { ctx.fillStyle = o.facecolor; ctx.fill('evenodd'); }
    if (o.edgecolor && o.edgecolor !== 'none') {
      ctx.strokeStyle = o.edgecolor;
      ctx.lineWidth = o.linewidth != null ? o.linewidth : 1;
      ctx.setLineDash(dashArray(o.linestyle));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },
  // a click inside a polygon picks it (the last drawn on top): its part index and properties
  pick(ax, tr, px, py) {
    const x = ax.view.xScale.inverse(px), y = ax.view.yScale.inverse(py);
    for (let i = tr.parts.length - 1; i >= 0; i--) {
      if (_inside(tr.parts[i], x, y)) return { kind: 'polygon', index: i, x, y, properties: tr.parts[i].properties || null };
    }
    return null;
  },
};

// ── ax.fill(x, y, [fmt], {facecolor, edgecolor, linewidth, linestyle, alpha, label, closed}) —
// matplotlib's: a filled polygon per x, y pair, fill(x1, y1, x2, y2, …) for several. Returns
// [Polygon]. ──
Axes.prototype.fill = function (...args) {
  let opts = null;
  if (args.length && _plainOpts(args[args.length - 1])) opts = args.pop();
  const out = [];
  let fmtColor = null;
  for (let i = 0; i < args.length;) {
    const xs = args[i], ys = args[i + 1];
    if (!_isArrayLike(xs) || !_isArrayLike(ys)) throw new TypeError('fill: expected x, y pairs of arrays');
    i += 2;
    if (typeof args[i] === 'string') { const f = parseFormat(args[i]); fmtColor = f.color ? _cssColor(f.color) : null; i++; }
    const X = _col(xs), Y = _col(ys);
    if (X.length !== Y.length) throw new TypeError(`fill: x has ${X.length} values but y has ${Y.length}`);
    const o = { ...(opts || {}) };
    if (fmtColor && o.color == null && o.facecolor == null) o.facecolor = fmtColor;
    const tr = _polyTrace(this, 'fill', [{ rings: [_ring(X, Y)] }], o, true);
    out.push(_patchHandle(this, tr));
  }
  return out;
};

function _patchHandle(ax, tr) {
  return {
    _trace: tr, axes: ax, ..._artistOps(ax, () => [tr]),
    get_facecolor: () => tr.opts.facecolor, get_edgecolor: () => tr.opts.edgecolor || 'none',
    get_label: () => tr.opts.label ?? null,
    get_xy: () => { const [xs, ys] = tr.parts[0].rings[0]; return Array.from(xs, (x, i) => [x, ys[i]]); },
    __repr__: () => '<matplotlib.patches.Polygon>',
  };
}

// ── patches: Polygon(xy, {closed}), Rectangle([x, y], width, height, {angle}),
// Circle([x, y], radius) — matplotlib.patches, built and then given to ax.add_patch(p). A
// circle is a 128-gon in data coordinates: round on an equal-aspect axes, an ellipse on any
// other, as matplotlib draws it. ──
export class Polygon {
  constructor(xy, opts) {
    const pts = Array.from(xy, (p) => [Number(p[0]), Number(p[1])]);
    this._rings = [_ring(pts.map((p) => p[0]), pts.map((p) => p[1]))];
    this._opts = _plainOpts(opts) ? { ...opts } : {};
    this.axes = null;
  }
  get_xy() { const [xs, ys] = this._rings[0]; return Array.from(xs, (x, i) => [x, ys[i]]); }
  // once added (add_patch): hide, show or take it off its axes
  set_visible(v) { if (this.axes) _artistOps(this.axes, () => (this._trace ? [this._trace] : [])).set_visible(v); return this; }
  get_visible() { return !(this._trace && this._trace.hidden); }
  remove() { if (this.axes) _artistOps(this.axes, () => (this._trace ? [this._trace] : [])).remove(); this.axes = null; }
  __repr__() { return `<matplotlib.patches.${this.constructor.name}>`; }
}
export class Rectangle extends Polygon {
  constructor(xy, width, height, opts) {
    if (_plainOpts(width)) { opts = width; width = opts.width; height = opts.height; }
    const o = _plainOpts(opts) ? opts : {};
    const a = ((o.angle || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const [x, y] = [Number(xy[0]), Number(xy[1])];
    // matplotlib rotates about the anchor corner
    const corner = ([u, v]) => [x + u * c - v * s, y + u * s + v * c];
    super([[0, 0], [width, 0], [width, height], [0, height]].map(corner), o);
    delete this._opts.angle; delete this._opts.width; delete this._opts.height;
  }
}
export class Circle extends Polygon {
  constructor(xy, radius = 5, opts) {
    if (_plainOpts(radius)) { opts = radius; radius = opts.radius ?? 5; }
    const N = 128, pts = [];
    for (let i = 0; i < N; i++) { const t = (2 * Math.PI * i) / N; pts.push([Number(xy[0]) + radius * Math.cos(t), Number(xy[1]) + radius * Math.sin(t)]); }
    super(pts, opts);
    delete this._opts.radius;
  }
}
Axes.prototype.add_patch = function (p) {
  if (!(p instanceof Polygon)) throw new TypeError('add_patch: expected a Polygon, Rectangle or Circle (plt.Polygon(xy), …)');
  const tr = _polyTrace(this, 'add_patch', [{ rings: p._rings }], p._opts, false);
  p.axes = this; p._trace = tr;
  return p;
};

// ── ax.add_geometry(geojson, {facecolor, edgecolor, linewidth, linestyle, alpha, label,
// color, marker, s}) — GeoJSON-shaped geometry: a Geometry (Point, MultiPoint, LineString,
// MultiLineString, Polygon, MultiPolygon, GeometryCollection), a Feature, or a
// FeatureCollection. Polygons (holes and all) become one polygon trace whose parts keep their
// feature's properties (a pick returns them); lines one line trace, broken at NaN between
// pieces; points one scatter. Coordinates are [x, y] in the axes' data units; z is ignored.
// Returns the artists made. (geopandas' GeoSeries.plot(ax=) is the matplotlib-world name for
// this; plot has no GeoDataFrame, so the call takes the geometry itself.) ──
Axes.prototype.add_geometry = function (geom, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  _checkOpts('add_geometry', o, this._strict);
  _resolveAliases(o);
  const polys = [], lines = [], points = [];
  const walk = (g, props) => {
    if (!g) return;
    switch (g.type) {
      case 'FeatureCollection': for (const f of g.features || []) walk(f, null); break;
      case 'Feature': walk(g.geometry, g.properties || null); break;
      case 'GeometryCollection': for (const c of g.geometries || []) walk(c, props); break;
      case 'Point': points.push(g.coordinates); break;
      case 'MultiPoint': for (const c of g.coordinates) points.push(c); break;
      case 'LineString': lines.push(g.coordinates); break;
      case 'MultiLineString': for (const c of g.coordinates) lines.push(c); break;
      case 'Polygon': polys.push({ rings: g.coordinates.map((r) => _ring(r.map((p) => p[0]), r.map((p) => p[1]))), properties: props }); break;
      case 'MultiPolygon': for (const c of g.coordinates) polys.push({ rings: c.map((r) => _ring(r.map((p) => p[0]), r.map((p) => p[1]))), properties: props }); break;
      default: _warn('add_geometry.' + g.type, `add_geometry(): '${g.type}' is not a GeoJSON geometry; use Point, LineString, Polygon, their Multi- forms, a Feature or a FeatureCollection`, this._strict);
    }
  };
  walk(geom, null);
  const out = [];
  const pick = (keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
  if (polys.length) out.push(_patchHandle(this, _polyTrace(this, 'add_geometry', polys, pick(['facecolor', 'edgecolor', 'linewidth', 'linestyle', 'alpha', 'label', 'color', 'zorder']), true)));
  if (lines.length) {
    const xs = [], ys = [];
    lines.forEach((l, k) => { if (k) { xs.push(NaN); ys.push(NaN); } for (const p of l) { xs.push(p[0]); ys.push(p[1]); } });
    const lo = pick(['linewidth', 'linestyle', 'alpha', 'zorder']);
    lo.color = o.edgecolor || o.color;
    if (!polys.length && o.label != null) lo.label = o.label;
    if (lo.color == null) delete lo.color;
    out.push(...this.plot(xs, ys, lo));
  }
  if (points.length) {
    const po = pick(['alpha', 'zorder', 'marker', 's']);
    if (o.color != null) po.color = o.color;
    if (!polys.length && !lines.length && o.label != null) po.label = o.label;
    this.scatter(points.map((p) => p[0]), points.map((p) => p[1]), po);
    out.push({ _trace: this._traces[this._traces.length - 1], axes: this });
  }
  return _result(this, out, {});
};

// ── map furniture: ax.scalebar({units = 'm', length, loc = 'lower right', color, frameon})
// and ax.north_arrow({loc = 'upper right', rotation = 0, size = 28}). Drawn over the data
// and not clipped. The scale bar measures the x axis (a plan view has one scale both ways at
// equal aspect); its length, unless given, is the nice number nearest a fifth of the view,
// and metres read as km from 1,000. North is +y; `rotation` (degrees clockwise) turns the
// arrow for a grid that isn't north-up. ──
const _CORNERS = ['lower right', 'lower left', 'upper right', 'upper left'];
function _corner(loc, rect, w, h, pad) {
  const right = /right/.test(loc), upper = /upper/.test(loc);
  return [right ? rect.x + rect.w - pad - w : rect.x + pad, upper ? rect.y + pad : rect.y + rect.h - pad - h];
}
function _nice(v) {
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e;
}
function _haloText(ctx, ax, s, x, y) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = ax._theme.halo;
  ctx.strokeText(s, x, y);
  ctx.fillText(s, x, y);
}

Axes.prototype.scalebar = function (opts) {
  const o = _checkOpts('scalebar', _plainOpts(opts) ? { ...opts } : {}, this._strict);
  if (o.loc != null && !_CORNERS.includes(o.loc)) _warn('scalebar.loc.' + o.loc, `scalebar(): loc must be one of ${_CORNERS.join(', ')}`, this._strict);
  this._traces.push({ type: 'scalebar', opts: o });
  return this;
};
_KINDS.scalebar = {
  z: 4, noclip: true,
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts;
    if (ax._xscale === 'log') { _warn('scalebar.log', 'scalebar(): a log x axis has no single scale; the bar is not drawn', ax._strict); return; }
    const d = xScale.domain, perUnit = rect.w / Math.abs(d[1] - d[0]);
    if (!(perUnit > 0) || !Number.isFinite(perUnit)) return;
    const len = o.length != null ? +o.length : _nice(Math.abs(d[1] - d[0]) / 5);
    const units = o.units == null ? 'm' : String(o.units);
    const label = o.label != null ? String(o.label)
      : units === 'm' && len >= 1000 ? `${_fmtLen(len / 1000)} km` : `${_fmtLen(len)}${units ? ' ' + units : ''}`;
    const w = len * perUnit, fs = ax._theme.font_size || 11;
    if (!(w > 2) || w > rect.w) return;
    const [x, y] = _corner(o.loc || 'lower right', rect, w, fs + 10, 10);
    const color = _cssColor(o.color) || ax._theme.foreground;
    ctx.save();
    ctx.font = _font(ax._theme, -1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    _haloText(ctx, ax, label, x + w / 2, y + fs);
    // two alternating halves, outlined: the classic map bar
    const by = y + fs + 3, bh = 5;
    ctx.fillStyle = ax._theme.halo; ctx.fillRect(x - 1, by - 1, w + 2, bh + 2);
    ctx.fillStyle = color; ctx.fillRect(x, by, w / 2, bh);
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x, by, w, bh);
    ctx.restore();
  },
};
function _fmtLen(v) { return Number.isInteger(v) ? v.toLocaleString('en-US') : String(+v.toPrecision(6)); }

Axes.prototype.north_arrow = function (opts) {
  const o = _checkOpts('north_arrow', _plainOpts(opts) ? { ...opts } : {}, this._strict);
  if (o.loc != null && !_CORNERS.includes(o.loc)) _warn('north_arrow.loc.' + o.loc, `north_arrow(): loc must be one of ${_CORNERS.join(', ')}`, this._strict);
  this._traces.push({ type: 'north_arrow', opts: o });
  return this;
};
_KINDS.north_arrow = {
  z: 4, noclip: true,
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts, size = o.size || 28, fs = ax._theme.font_size || 11;
    const [x, y] = _corner(o.loc || 'upper right', rect, size, size + fs + 2, 10);
    const cx = x + size / 2, cy = y + fs + 2 + size / 2;
    // +y on screen: up, unless the y axis is inverted; then turned by rotation
    const up = ax.view && ax.view.yinv ? 1 : -1;
    const a = ((o.rotation || 0) * Math.PI) / 180;
    const color = _cssColor(o.color) || ax._theme.foreground;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, (up * size) / 2);
    ctx.lineTo(size / 4, (-up * size) / 2);
    ctx.lineTo(0, (-up * size) / 4);
    ctx.lineTo(-size / 4, (-up * size) / 2);
    ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = ax._theme.halo; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    ctx.font = _font(ax._theme, 0, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = up < 0 ? 'bottom' : 'top';
    _haloText(ctx, ax, 'N', 0, (up * size) / 2 + up * 2);
    ctx.restore();
  },
};
