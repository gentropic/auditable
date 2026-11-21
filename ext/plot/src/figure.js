// Figure — canvas management, subplot grid, DPI handling

import { Axes } from './axes.js';
import { _resolve, _font } from './style.js';
import { _checkOpts, _noop } from './opts.js';
import { recordingContext, replay } from './record.js';

// Figures shown (or saved) where there is no DOM, in order. plt.shown() / plt.saved() read
// them, plt.close(fig) / plt.close('all') / plt.clf() clear them.
export const _shownFigures = [];
export const _savedFigures = [];
export function _recordShown(fig) {
  if (!_shownFigures.includes(fig)) _shownFigures.push(fig);
}

export class Figure {
  constructor(nrows, ncols, opts) {
    this.nrows = nrows || 1;
    this.ncols = ncols || 1;
    const o = opts || {};
    _checkOpts('subplots', o, o.strict);
    // the palette as it stands now (style.js): this figure keeps it, whatever style.use() does
    // later. A partial {theme} overrides keys of it.
    this._strict = !!o.strict;
    // the figure's own theme: the default (style.use) unless one is given — a name, a partial
    // theme, themeFromCSS(el). Its axes all read this one object, so set_theme re-dresses them.
    this._theme = _resolve(o.theme, this._strict);
    // matplotlib's figsize is in INCHES; the canvas pixel size is
    // figsize * dpi. Default dpi 100. Notebooks like Pyrcz's pass
    // figsize=(7, 7) expecting a 700×700 canvas — without this scale
    // we'd produce a 7×7 px (effectively invisible) canvas.
    //
    // Heuristic: if both dims are ≤ 50, assume inches and scale by
    // dpi. If either is > 50, assume already-pixels (back-compat with
    // JS-side callers that pass pixel values directly).
    const rawSize = o.figsize || [4, 3];
    const dpi = o.dpi || 100;
    // points → pixels (marker sizes are in points, as matplotlib's: 1 pt = dpi / 72 px)
    this.dpi = dpi;
    const inchesShape = rawSize[0] <= 50 && rawSize[1] <= 50;
    this.width = inchesShape ? rawSize[0] * dpi : rawSize[0];
    this.height = inchesShape ? rawSize[1] * dpi : rawSize[1];
    // Figure facecolor — pulled from the style palette unless explicitly
    // overridden. Dark palette uses 'transparent' (notebook bg shows
    // through); light palette uses an opaque off-white card so dark
    // tick text contrasts even on a dark notebook bg.
    this._facecolor = o.facecolor || null;
    this._suptitle = null;
    // Inter-subplot gap in pixels. Callers that want a tight grid
    // (e.g. sadpan's scatter_matrix on a small figure) pass `gap` (or
    // matplotlib's wspace/hspace) in opts. wspace/hspace land in pixels
    // here; matplotlib's fraction-of-axis-width semantics aren't worth
    // emulating for our flat-layout use case.
    this._gapX = (o.wspace ?? o.gap ?? 10);
    this._gapY = (o.hspace ?? o.gap ?? 10);
    // Figure-level row/col labels — drawn OUTSIDE the subplot grid
    // (to the left of each row and below each column). Used by
    // matrix-shaped plots like sadpan's scatter_matrix where the
    // column names belong on the figure edges, not duplicated as
    // per-cell axis labels.
    this._rowLabels = null;
    this._colLabels = null;

    // create axes grid
    this.axes = [];
    for (let i = 0; i < this.nrows * this.ncols; i++) {
      const ax = new Axes(this._theme);
      ax._strict = this._strict;
      ax._dpi = dpi;
      this.axes.push(ax);
    }
    this._share('x', o.sharex);
    this._share('y', o.sharey);
  }

  // the figure's face: facecolor if given, else the theme's figure surface
  get facecolor() { return this._facecolor || this._theme.figure; }
  set facecolor(c) { this._facecolor = c; }

  // fig.set_theme(t): a name ('dark' · 'light' · 'paper'), a partial theme, themeFromCSS(el)
  set_theme(t) {
    const next = _resolve(t, this._strict);
    for (const k of Object.keys(this._theme)) delete this._theme[k];
    Object.assign(this._theme, next);
    return this;
  }

  // subplots(sharex / sharey): true | 'all' | 'row' | 'col'. Shared axes have one range (one
  // set_xlim moves all; the autoscale covers all their data) and one set of categories; as in
  // matplotlib, only the outer axes label their ticks.
  _share(axis, how) {
    if (!how || how === 'none') return;
    const mode = how === true ? 'all' : how;
    if (!['all', 'row', 'col'].includes(mode)) throw new TypeError(`subplots: share${axis} must be true, 'all', 'row' or 'col', not ${JSON.stringify(how)}`);
    const at = (r, c) => this.axes[r * this.ncols + c];
    const groups = [];
    if (mode === 'all') groups.push(this.axes.slice());
    else if (mode === 'row') for (let r = 0; r < this.nrows; r++) groups.push(Array.from({ length: this.ncols }, (_, c) => at(r, c)));
    else for (let c = 0; c < this.ncols; c++) groups.push(Array.from({ length: this.nrows }, (_, r) => at(r, c)));
    for (const g of groups) for (const ax of g) ax._shared[axis] = g;
    // tick labels only on the outer axes: x on the bottom row (columns share it), y on the
    // first column (rows share it)
    for (let r = 0; r < this.nrows; r++) for (let c = 0; c < this.ncols; c++) {
      const ax = at(r, c);
      if (axis === 'x' && mode !== 'row' && r < this.nrows - 1) ax._xtickLabelsOff = true;
      if (axis === 'y' && mode !== 'col' && c > 0) ax._ytickLabelsOff = true;
    }
  }

  suptitle(text, opts) {
    this._suptitle = { text, opts };
    return this;
  }

  // matplotlib's Figure.subplots_adjust(left, right, top, bottom, wspace, hspace) isn't
  // honoured yet (the layout uses fixed gaps): it warns rather than doing nothing quietly.
  subplots_adjust(_opts) { _noop('subplots_adjust', this._strict); return this; }
  // a true no-op by design: layout is always tight
  tight_layout(_opts) { return this; }

  // the axes whose plot area holds (px, py), CSS px of the figure, after a render
  axesAt(px, py) {
    for (const ax of this.axes) {
      const v = ax.view;
      if (v && px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h) return ax;
    }
    return null;
  }

  // In the notebook: a <canvas> node, which its display path picks up. With no DOM (a
  // worker, Node): the figure is recorded for plt.shown() and returned, so the host can
  // draw it (fig.draw / fig.toDrawList / replay).
  show() {
    if (typeof document === 'undefined') { _recordShown(this); return this; }
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const canvas = document.createElement('canvas');
    canvas.width = this.width * dpr;
    canvas.height = this.height * dpr;
    canvas.style.width = this.width + 'px';
    canvas.style.height = this.height + 'px';
    this.draw(canvas.getContext('2d'), { dpr });
    return canvas;
  }

  // Draw the whole figure on anything shaped like a CanvasRenderingContext2D.
  draw(ctx, { dpr = 1 } = {}) {
    if (dpr !== 1) ctx.scale(dpr, dpr);

    // background
    if (this.facecolor !== 'transparent') {
      ctx.fillStyle = this.facecolor;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // suptitle space
    const supH = this._suptitle ? 24 : 0;

    if (this._suptitle) {
      ctx.fillStyle = this._theme.foreground;
      ctx.font = _font(this._theme, 3);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(this._suptitle.text, this.width / 2, 4);
    }

    // Figure-level row/col label gutters. Reserve space outside the
    // subplot grid for these labels so the grid itself shrinks rather
    // than overlapping the labels.
    const rowLabelW = this._rowLabels ? 28 : 0;
    const colLabelH = this._colLabels ? 18 : 0;

    // subplot layout — grid origin shifted by the row-label gutter
    const gapX = this._gapX;
    const gapY = this._gapY;
    const gridX = rowLabelW;
    const gridY = supH;
    const gridW = this.width - rowLabelW;
    const gridH = this.height - supH - colLabelH;
    const cellW = (gridW - gapX * (this.ncols - 1)) / this.ncols;
    const cellH = (gridH - gapY * (this.nrows - 1)) / this.nrows;

    for (let r = 0; r < this.nrows; r++) {
      for (let c = 0; c < this.ncols; c++) {
        const idx = r * this.ncols + c;
        const ax = this.axes[idx];
        const rect = {
          x: gridX + c * (cellW + gapX),
          y: gridY + r * (cellH + gapY),
          w: cellW,
          h: cellH,
        };
        ax._render(ctx, rect, { dpr });
      }
    }

    // Figure-level edge labels — drawn after subplots so they sit on
    // top of any background fill. Row labels rotate -90° (read bottom-
    // to-top), centered vertically on each row. Col labels read flat,
    // centered horizontally under each column.
    if (this._rowLabels) {
      ctx.save();
      ctx.fillStyle = this._theme.foreground;
      ctx.font = _font(this._theme, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < this.nrows; r++) {
        const label = this._rowLabels[r];
        if (!label) continue;
        const cy = gridY + r * (cellH + gapY) + cellH / 2;
        ctx.save();
        ctx.translate(rowLabelW / 2, cy);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    if (this._colLabels) {
      ctx.fillStyle = this._theme.foreground;
      ctx.font = _font(this._theme, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let c = 0; c < this.ncols; c++) {
        const label = this._colLabels[c];
        if (!label) continue;
        const cx = gridX + c * (cellW + gapX) + cellW / 2;
        const cy = gridY + gridH + colLabelH / 2;
        ctx.fillText(label, cx, cy);
      }
    }
    return ctx;
  }

  // The figure as plain JSON: size, facecolor and the ordered 2D-context ops draw() makes.
  // The same figure gives the same list in every host. replay(ctx, list) draws it.
  toDrawList() {
    const rec = recordingContext(this.width, this.height);
    this.draw(rec);
    // version 2: themed text (the theme's mono stack), measured layout. The ops are unchanged
    // in kind — a draw list only ever gains ops.
    return { version: 2, width: this.width, height: this.height, facecolor: this.facecolor, ops: rec.ops };
  }

  // PNG bytes through OffscreenCanvas (workers in current browsers); rejects where there is none.
  async toPNG({ dpr = 1 } = {}) {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('toPNG needs OffscreenCanvas; use toDrawList() and replay() instead');
    const canvas = new OffscreenCanvas(Math.round(this.width * dpr), Math.round(this.height * dpr));
    this.draw(canvas.getContext('2d'), { dpr });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // In the notebook: download a PNG. With no DOM: record { name, figure } for plt.saved()
  // (and the figure for plt.shown()) so the host can offer the file.
  savefig(filename) {
    const name = (typeof filename === 'string' && filename) || 'figure.png';
    if (typeof document === 'undefined') {
      _savedFigures.push({ name, figure: this });
      _recordShown(this);
      return this;
    }
    const canvas = this.show();
    const link = document.createElement('a');
    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
}
