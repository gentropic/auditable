// The legend — matplotlib's.
//
//   legend() · legend(labels) · legend(handles, labels) · legend({loc, bbox_to_anchor, ncols,
//   title, fontsize, frameon, framealpha, labelcolor})
//
// An entry is every labelled trace (a label starting with '_' is hidden, as in matplotlib), in
// the order drawn; legend(labels) labels the drawn traces in order; handles are what the
// chart calls returned. loc: a name or matplotlib's code; 'best' (the default) takes the slot
// that covers the least data, matplotlib's way, trying upper right first. bbox_to_anchor
// (x, y[, w, h]) in axes fractions puts the legend's `loc` corner at that point — outside the
// axes with (1.01, 1) + 'upper left', and the layout leaves room for it.

import { Axes, _KINDS, _plainOpts } from './axes.js';
import { _isArrayLike } from './data.js';
import { getCmap, _cssColor } from './color.js';
import { _noLine, dashArray } from './format.js';
import { _markerShape, _pathMarker } from './raster.js';
import { _font, _textW, _sizePx } from './style.js';
import { _rcv } from './rc.js';
import { _warn } from './opts.js';

const _LOCS = ['best', 'upper right', 'upper left', 'lower left', 'lower right', 'right', 'center left', 'center right', 'lower center', 'upper center', 'center'];

Axes.prototype.legend = function (a, b, c) {
  let handles = null, labels = null, opts = {};
  if (_plainOpts(a) && !Array.isArray(a)) opts = a;
  else if (Array.isArray(a) && Array.isArray(b)) { handles = a; labels = b; if (_plainOpts(c)) opts = c; }
  else if (Array.isArray(a) || _isArrayLike(a)) { labels = Array.from(a, String); if (_plainOpts(b)) opts = b; }
  const o = { ...opts };
  // rcParams legend.*, read as the legend is made, where the call didn't say
  if (o.loc == null && _rcv('legend.loc') !== 'best') o.loc = _rcv('legend.loc');
  if (o.frameon == null && _rcv('legend.frameon') === false) o.frameon = false;
  if (o.framealpha == null && _rcv('legend.framealpha') !== 1) o.framealpha = _rcv('legend.framealpha');
  if (o.fontsize == null && _rcv('legend.fontsize') != null) o.fontsize = _rcv('legend.fontsize');
  if (o.title_fontsize == null && _rcv('legend.title_fontsize') != null) o.title_fontsize = _rcv('legend.title_fontsize');
  if (o.handles) { handles = o.handles; delete o.handles; }
  if (o.labels) { labels = Array.from(o.labels, String); delete o.labels; }
  const known = ['loc', 'bbox_to_anchor', 'ncol', 'ncols', 'title', 'fontsize', 'title_fontsize', 'frameon', 'framealpha', 'labelcolor', 'facecolor', 'edgecolor', 'markerscale', 'borderaxespad', '_kw'];
  for (const k of Object.keys(o)) if (!known.includes(k)) _warn('legend.' + k, `legend() has no option '${k}'${['shadow', 'fancybox', 'mode', 'handlelength', 'columnspacing'].includes(k) ? ' (not supported yet)' : ''}`, this._strict);
  if (o.loc != null && typeof o.loc === 'string' && !_LOCS.includes(o.loc) && !['top', 'bottom', 'left'].includes(o.loc)) _warn('legend.loc.' + o.loc, `legend(): loc '${o.loc}' is not a place; use ${_LOCS.join(', ')}`, this._strict);
  this._legend = true;
  this._legendOpts = { ...o, handles, labels };
  return this;
};

// the entries: [{label, color, kind: 'line' | 'marker' | 'patch', marker, linestyle, alpha}]
function _entries(ax) {
  const th = ax._theme, lo = ax._legendOpts;
  const entryOf = (t, label) => {
    let color = t.opts.color;
    if (!color && t.cvals) color = getCmap(t.opts.cmap || th.ramp || 'viridis')(0.5);
    if (!color && t.colors) color = t.colors[0];
    if (!color && t.color) color = t.color;
    const k = _KINDS[t.type], kl = k && k.legend ? k.legend(ax, t) : null;
    const patch = kl ? !!kl.patch : !!(k && k.patch);
    const marker = t.type === 'scatter' || (t.type === 'line' && t.opts.marker && _noLine(t.opts.linestyle));
    return {
      label: String(label), color: (kl && kl.color) || color || th.cycle[0],
      kind: patch ? 'patch' : marker ? 'marker' : 'line',
      marker: t.opts.marker || 'o', linestyle: t.opts.linestyle, linewidth: t.opts.linewidth,
      lineMarker: t.type === 'line' && t.opts.marker && !_noLine(t.opts.linestyle) ? t.opts.marker : null,
      alpha: t.opts.alpha,
    };
  };
  const drawn = ax._traces.filter((t) => t.opts && !t.hidden && t.type !== 'text' && t.type !== 'bar_label' && t.type !== 'annotate');
  if (lo.handles) {
    return lo.handles.map((h, i) => {
      const t = h && (h._trace || (h[0] && h[0]._trace)) ? (h._trace || h[0]._trace) : drawn.find((d) => d === h);
      const label = lo.labels ? lo.labels[i] : t && t.opts.label;
      return t && label != null ? entryOf(t, label) : null;
    }).filter(Boolean);
  }
  if (lo.labels) return drawn.slice(0, lo.labels.length).map((t, i) => entryOf(t, lo.labels[i]));
  return drawn.filter((t) => t.opts.label != null && t.opts.label !== '' && !String(t.opts.label).startsWith('_')).map((t) => entryOf(t, t.opts.label));
}

// its size, laid out in ncols columns (entries fill down each column, matplotlib's order)
function _box(ax, entries) {
  const th = ax._theme, lo = ax._legendOpts;
  const base = th.font_size || 11;
  const fs = _sizePx(lo.fontsize, base, base - 1);
  const tfs = _sizePx(lo.title_fontsize, base, fs);
  const font = `${fs}px ${th.mono}`;
  const ncols = Math.max(1, (lo.ncols ?? lo.ncol ?? 1) | 0);
  const rows = Math.ceil(entries.length / ncols);
  const lineH = fs + 5, pad = 6, swatch = 22;
  const colW = [];
  for (let c = 0; c < ncols; c++) {
    let w = 0;
    for (let r = 0; r < rows; r++) { const e = entries[c * rows + r]; if (e) w = Math.max(w, _textW(font, e.label)); }
    colW.push(w + swatch);
  }
  const titleFont = lo.title ? `bold ${tfs}px ${th.mono}` : null;
  const titleH = lo.title ? tfs + 5 : 0;
  const w = Math.max(colW.reduce((s, x) => s + x, 0) + (ncols - 1) * 10, lo.title ? _textW(titleFont, lo.title) : 0) + pad * 2;
  const h = rows * lineH + titleH + pad * 2;
  return { w, h, rows, ncols, colW, lineH, pad, font, titleFont, titleH, swatch };
}

// where it goes: anchored (bbox_to_anchor) or in the plot area, at loc ('best': least data)
function _place(ax, B, plot) {
  const lo = ax._legendOpts;
  let loc = lo.loc ?? 'best';
  if (typeof loc === 'number') loc = _LOCS[loc] || 'best';
  const at = (name, x0, y0, W, H, inset) => {
    const right = name.includes('right'), left = name.includes('left'), upper = name.includes('upper'), lower = name.includes('lower');
    return {
      x: right ? x0 + W - B.w - inset : left ? x0 + inset : x0 + (W - B.w) / 2,
      y: upper ? y0 + inset : lower ? y0 + H - B.h - inset : y0 + (H - B.h) / 2,
    };
  };
  if (lo.bbox_to_anchor) {
    const b = Array.from(lo.bbox_to_anchor, Number);
    const ax0 = plot.x + b[0] * plot.w, ay0 = plot.y + (1 - b[1]) * plot.h;
    const name = loc === 'best' ? 'upper left' : loc;
    if (b.length === 4) return at(name, ax0, plot.y + (1 - b[1] - b[3]) * plot.h, b[2] * plot.w, b[3] * plot.h, 0);
    // a point: the legend's `loc` corner sits on it
    const right = name.includes('right'), left = name.includes('left'), upper = name.includes('upper'), lower = name.includes('lower');
    return { x: right ? ax0 - B.w : left ? ax0 : ax0 - B.w / 2, y: upper ? ay0 : lower ? ay0 - B.h : ay0 - B.h / 2 };
  }
  if (loc !== 'best') return at(loc, plot.x, plot.y, plot.w, plot.h, 6);
  // best: the candidate slot with the fewest data points (and bars) under it; matplotlib's order
  const pts = _dataPoints(ax);
  let bestPos = null, bestN = Infinity;
  for (const name of _LOCS.slice(1)) {
    const p = at(name, plot.x, plot.y, plot.w, plot.h, 6);
    let n = 0;
    for (let i = 0; i < pts.length; i += 2) if (pts[i] >= p.x && pts[i] <= p.x + B.w && pts[i + 1] >= p.y && pts[i + 1] <= p.y + B.h) n++;
    if (n < bestN) { bestN = n; bestPos = p; if (!n) break; }
  }
  return bestPos;
}

// the drawn data, as pixel points (sampled: at most ~4000 per trace), for loc='best'
function _dataPoints(ax) {
  const v = ax.view, out = [];
  if (!v) return out;
  const push = (x, y) => { const px = v.xScale.transform(x), py = v.yScale.transform(y); if (px - px === 0 && py - py === 0) out.push(px, py); };
  for (const t of ax._traces) {
    if ((t.type === 'line' || t.type === 'scatter' || t.type === 'errorbar') && t.x && t.y) {
      const n = t.x.length, step = Math.max(1, Math.floor(n / 4000));
      for (let i = 0; i < n; i += step) {
        push(t.x[i], t.y[i]);
        // a line's segments count along their length, not only at the vertices
        if (t.type === 'line' && i + step < n) for (let k = 1; k < 4; k++) push(t.x[i] + (t.x[i + step] - t.x[i]) * k / 4, t.y[i] + (t.y[i + step] - t.y[i]) * k / 4);
      }
    } else if (t._cache && t._cache.rects) {
      const R = t._cache.rects;
      for (let i = 0; i < R.x0.length; i++) for (let k = 0; k <= 4; k++) for (let q = 0; q <= 4; q++) push(R.x0[i] + (R.x1[i] - R.x0[i]) * k / 4, R.y0[i] + (R.y1[i] - R.y0[i]) * q / 4);
    } else if (t._cache && t._cache.hrects) {
      const R = t._cache.hrects;
      for (let i = 0; i < R.x0.length; i++) for (let k = 0; k <= 2; k++) for (let q = 0; q <= 4; q++) push(R.x0[i] + (R.x1[i] - R.x0[i]) * k / 2, R.y0[i] + (R.y1[i] - R.y0[i]) * q / 4);
    } else if (t.type === 'fill_between' && t.t) {
      // a band covers its area, not only its edges: points across it at each sampled step
      const n = t.t.length, step = Math.max(1, Math.floor(n / 400));
      for (let i = 0; i < n; i += step) {
        if (t.where && !t.where[i]) continue;
        // across the band every ~10 px (a legend box is a few rows tall: coarser sampling misses it)
        const pa = t.horiz ? v.xScale.transform(t.a[i]) : v.yScale.transform(t.a[i]), pb = t.horiz ? v.xScale.transform(t.b[i]) : v.yScale.transform(t.b[i]);
        const K = Math.min(60, Math.max(2, Math.ceil(Math.abs(pb - pa) / 10)));
        for (let k = 0; k <= K; k++) { const q = t.a[i] + (t.b[i] - t.a[i]) * k / K; if (t.horiz) push(q, t.t[i]); else push(t.t[i], q); }
      }
    } else if (t.type === 'span') {
      // across the axes between its fractions: a grid over its rectangle, in pixels
      const x0 = t.horiz ? v.x + t.f0 * v.w : v.xScale.transform(t.lo), x1 = t.horiz ? v.x + t.f1 * v.w : v.xScale.transform(t.hi);
      const y0 = t.horiz ? v.yScale.transform(t.lo) : v.y + (1 - t.f0) * v.h, y1 = t.horiz ? v.yScale.transform(t.hi) : v.y + (1 - t.f1) * v.h;
      const KX = Math.min(80, Math.max(2, Math.ceil(Math.abs(x1 - x0) / 10))), KY = Math.min(80, Math.max(2, Math.ceil(Math.abs(y1 - y0) / 10)));
      for (let k = 0; k <= KX; k++) for (let q = 0; q <= KY; q++) { const px = x0 + (x1 - x0) * k / KX, py = y0 + (y1 - y0) * q / KY; if (px - px === 0 && py - py === 0) out.push(px, py); }
    } else if (t.type === 'polygon' && t.parts && t.opts.facecolor !== 'none') {
      // a filled polygon: a grid over each part's box, kept where it falls inside (even-odd)
      for (const part of t.parts) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [xs, ys] of part.rings) for (let i = 0; i < xs.length; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
        // every ~10 px over its box (at most 80 a side)
        const KX = Math.min(80, Math.max(2, Math.ceil(Math.abs(v.xScale.transform(x1) - v.xScale.transform(x0)) / 10)));
        const KY = Math.min(80, Math.max(2, Math.ceil(Math.abs(v.yScale.transform(y1) - v.yScale.transform(y0)) / 10)));
        for (let k = 0; k <= KX; k++) for (let q = 0; q <= KY; q++) {
          const x = x0 + (x1 - x0) * k / KX, y = y0 + (y1 - y0) * q / KY;
          if (_insideRings(part.rings, x, y)) push(x, y);
        }
      }
    } else if (t.type === 'violin' && t.stats) {
      // each body, across its width at its sampled heights
      t.stats.forEach((s, i) => {
        if (!s.vals.length) return;
        let vmax = 0; for (const q of s.vals) if (q > vmax) vmax = q;
        const kw = (0.5 * t.widths[i]) / vmax, p = t.positions[i];
        for (let j = 0; j < s.coords.length; j += 5) for (let k = -2; k <= 2; k++) { const a = p + (s.vals[j] * kw * k) / 2; if (t.horiz) push(s.coords[j], a); else push(a, s.coords[j]); }
      });
    }
  }
  return out;
}

// even-odd: is (x, y) inside these rings
function _insideRings(rings, x, y) {
  let inside = false;
  for (const [xs, ys] of rings) {
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
    }
  }
  return inside;
}

// how far an anchored legend reaches past the plot area (the layout makes room)
Axes.prototype._legendOverflow = function (plot) {
  if (!this._legend || !this._legendOpts.bbox_to_anchor) return null;
  const entries = _entries(this);
  if (!entries.length) return null;
  const B = _box(this, entries), p = _place(this, B, plot);
  return {
    left: Math.max(0, plot.x - p.x), right: Math.max(0, p.x + B.w - (plot.x + plot.w)),
    top: Math.max(0, plot.y - p.y), bottom: Math.max(0, p.y + B.h - (plot.y + plot.h)),
  };
};

Axes.prototype._renderLegend = function (ctx, plotX, plotY, plotW, plotH) {
  const th = this._theme, lo = this._legendOpts;
  const entries = _entries(this);
  if (!entries.length) return;
  const B = _box(this, entries);
  const p = _place(this, B, { x: plotX, y: plotY, w: plotW, h: plotH });
  if (!p) return;
  const { x: lx, y: ly } = p;
  ctx.save();
  if (lo.frameon !== false) {
    ctx.globalAlpha = lo.framealpha != null ? +lo.framealpha : 1;
    ctx.fillStyle = _cssColor(lo.facecolor) || th.panel;
    ctx.fillRect(lx, ly, B.w, B.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = _cssColor(lo.edgecolor) || th.panel_border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly, B.w, B.h);
  }
  const text = this._textColor || th.foreground;
  if (lo.title) {
    ctx.font = B.titleFont; ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lo.title, lx + B.w / 2, ly + B.pad + B.titleH / 2);
  }
  ctx.font = B.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cx = lx + B.pad;
  for (let c = 0; c < B.ncols; c++) {
    for (let r = 0; r < B.rows; r++) {
      const e = entries[c * B.rows + r];
      if (!e) continue;
      const ey = ly + B.pad + B.titleH + r * B.lineH + B.lineH / 2;
      ctx.fillStyle = e.color; ctx.strokeStyle = e.color;
      if (e.kind === 'marker') {
        ctx.beginPath(); _pathMarker(ctx, _markerShape(e.marker, 3.5), cx + 8, ey);
        if (e.marker === '+' || e.marker === 'x' || e.marker === '|' || e.marker === '_') { ctx.lineWidth = 1.5; ctx.stroke(); } else ctx.fill();
      } else if (e.kind === 'patch') {
        ctx.globalAlpha = e.alpha != null ? e.alpha : 1;
        ctx.fillRect(cx + 2, ey - 4, 12, 8);
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = Math.min(4, e.linewidth || 1.5);
        ctx.setLineDash(dashArray(e.linestyle));
        ctx.beginPath(); ctx.moveTo(cx, ey); ctx.lineTo(cx + 16, ey); ctx.stroke();
        ctx.setLineDash([]);
        if (e.lineMarker) { ctx.beginPath(); _pathMarker(ctx, _markerShape(e.lineMarker, 3), cx + 8, ey); ctx.fill(); }
      }
      ctx.fillStyle = lo.labelcolor === 'linecolor' ? e.color : _cssColor(lo.labelcolor) || text;
      ctx.fillText(e.label, cx + B.swatch, ey);
    }
    cx += B.colW[c] + 10;
  }
  ctx.restore();
};
