// Public API — subplots() factory, quick one-liners, plt extension registration

import { Figure, _shownFigures, _savedFigures } from './figure.js';
import { replay } from './record.js';
import { getCmap, ListedColormap, LinearSegmentedColormap } from './color.js';
import { Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm } from './norm.js';
import { setStyle, themeFromCSS } from './style.js';
import { ScalarMappable } from './axes.js';
import { Polygon, Rectangle, Circle } from './geo.js';
import { ticker, dates } from './ticker.js';
import { rcParams, _noop } from './opts.js';
import { rc, rcdefaults, rc_context, cycler, _context, _rcDefaults } from './rc.js';

// one version string, read by the extension registration below (package.json carries the same)
export const VERSION = '0.2.0';

// matplotlib's pyplot state: the figures pyplot opened (subplots, figure, subplot, or the
// first plt.plot / plt.title with none current), and a current figure and axes that
// plt.plot / plt.xlabel / plt.legend … act on. As matplotlib:
//   plt.plot(a); plt.plot(b); plt.title('t')     # one figure, two lines, a title
// A cell starts with no current figure (see the cell hooks at the bottom), the way
// Jupyter's inline backend closes a cell's figures once it has shown them — so a re-run
// draws a fresh figure instead of adding lines to the last one.
let _currentFig = null;
let _currentAx = null;
const _open = [];                 // figures pyplot opened and hasn't closed, oldest first
let _cellCtx = null;              // the running Python cell's context, while one runs

function _setCurrent(fig, ax) {
  _currentFig = fig; _currentAx = ax;
  if (fig && !_open.includes(fig)) _open.push(fig);
  return ax;
}
function _forget() { _open.length = 0; _currentFig = null; _currentAx = null; }

export function subplots(nrows, ncols, opts) {
  // Adder kwarg shapes that arrive here:
  //   plt.subplots()                          → ()
  //   plt.subplots(2, 3)                      → (2, 3)
  //   plt.subplots(figsize=(8,6))             → ({_kw, figsize}) — kwargs in arg 0
  //   plt.subplots(2, 3, figsize=(8,6))       → (2, 3, {_kw, figsize})
  //   plt.subplots(2, 3, sharex=True)         → (2, 3, {_kw, sharex})
  if (nrows && typeof nrows === 'object' && nrows._kw) {
    opts = nrows; nrows = undefined; ncols = undefined;
  } else if (ncols && typeof ncols === 'object' && ncols._kw) {
    opts = ncols; ncols = undefined;
  }
  const nr = nrows || 1;
  const nc = ncols || 1;
  const fig = new Figure(nr, nc, opts);

  if (nr === 1 && nc === 1) {
    _setCurrent(fig, fig.axes[0]);
    // array for adder tuple unpacking, named props for JS destructuring
    return Object.assign([fig, fig.axes[0]], { fig, ax: fig.axes[0] });
  }
  _setCurrent(fig, fig.axes[0]);
  // matplotlib's subplots returns axes as:
  //   nrows=1, ncols=K → flat 1D array [ax1, …, axK]
  //   nrows=R, ncols=1 → flat 1D array [ax1, …, axR]
  //   nrows=R, ncols=K → nested 2D array [[ax1,…,axK], [ax(K+1),…], …]
  // Adder code often destructures the 2D shape literally:
  //   f, ((a, b), (c, d), (e, f)) = plt.subplots(3, 2)
  // so flat-only would break those notebooks.
  let axesShape;
  if (nr === 1 || nc === 1) {
    axesShape = fig.axes.slice();
  } else {
    axesShape = [];
    for (let r = 0; r < nr; r++) {
      const row = [];
      for (let c = 0; c < nc; c++) row.push(fig.axes[r * nc + c]);
      axesShape.push(row);
    }
  }
  // numpy's ndarray idioms on the axes array, every shape: `.flat` (row-major), `.ravel()`,
  // `.flatten()`, `.shape`. On a 1-D array too — there `.flat` would otherwise be
  // Array.prototype.flat, a FUNCTION: truthy, so `axes.flat ? axes.flat : axes` took it and
  // destructuring threw (the model eval's swath pages). Non-enumerable: not in JSON or for..of.
  const flat = fig.axes.slice();
  const def = (k, value) => Object.defineProperty(axesShape, k, { value, writable: false, enumerable: false, configurable: true });
  def('flat', flat);
  def('ravel', () => flat.slice());
  def('flatten', () => flat.slice());
  def('shape', nr === 1 || nc === 1 ? [nr * nc] : [nr, nc]);
  return Object.assign([fig, axesShape], { fig, axes: axesShape });
}

// The chart calls draw on the current axes and return what the axes method returns, as
// matplotlib's do: [line] (`line, = plt.plot(…)`), a mappable, a BarContainer, and
// (n, bins, patches) for hist — also readable as .counts / .edges.
// plot(y), plot(x, y), plot(x, y, fmt, opts) … — Axes.plot sorts the forms out
export function plot(...args) { return _ax().plot(...args); }
// scatter(x, y, opts) and matplotlib's positional scatter(x, y, s, c)
export function scatter(...args) { return _ax().scatter(...args); }
export function imshow(...args) { return _ax().imshow(...args); }
export function bar(...args) { return _ax().bar(...args); }
export function hist(...args) { return _ax().hist(...args); }
export const cmap = getCmap;
// matplotlib's matshow opens a figure of its own and draws the matrix as an image (the
// common df.corr() pattern)
export function matshow(data, nx, ny, opts) {
  const { ax } = subplots();
  return ax.imshow(data, nx, ny, opts);
}

// plt.rcParams (matplotlib's: the keys plot reads are in rc.js, and API.md), plt.rc(group,
// **kw), rcdefaults(), rc_context({…}) (a with-block, or a function to run inside), cycler.
// rcParams['gcu.strict'] = True turns every "nothing is silently ignored" warning into an error.
export { rcParams, rc, rcdefaults, rc_context, cycler };
// plt.style.use(name) — switches the shared palette. Auditable-native
// default is dark; `plt.style.use('default')` (or 'classic' / a few
// common matplotlib-style names) flips to a light palette. Notebooks
// loaded from a .ipynb through @gcu/ipynb get this call injected
// automatically after `import matplotlib.pyplot as plt`.
export const style = {
  use(name) { setStyle(name); },
  // style.context(name | {rcParams}) — a with-block (or a function to run) in that style; the
  // style and rcParams are put back after
  context(name, fn) { return _context(() => setStyle(name), fn); },
  available: ['default', 'classic', 'matplotlib', 'dark_background', 'seaborn', 'seaborn-whitegrid', 'ggplot', 'bmh', 'dark', 'light', 'paper', 'auto'],
};
// plt.figure(...) — a new figure, and the current one (matplotlib's figure() takes
// figsize=(w,h) and other kwargs; unsupported ones warn).
export function figure(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const fig = new Figure(1, 1, o);
  _setCurrent(fig, fig.axes[0]);
  return fig;
}
// plt.show() — shows every open figure, then closes them, as matplotlib's inline backend.
// In a Python cell each lands in the cell's output where show() is called (so a loop of
// plot-and-show gives one chart per pass) and show() returns None. Elsewhere — a JS
// cell — it returns the canvas (a <div> of canvases for several figures) for the cell to
// display. With no DOM, each figure is recorded for plt.shown() and the last is returned.
export function show() {
  const figs = _open.length ? _open.slice() : (_currentFig ? [_currentFig] : []);
  _forget();
  if (!figs.length) return null;
  if (_cellCtx) { for (const f of figs) _cellCtx.display(f.show()); return null; }
  const out = figs.map((f) => f.show());
  if (out.length === 1 || typeof document === 'undefined') return out[out.length - 1];
  const div = document.createElement('div');
  for (const c of out) div.appendChild(c);
  return div;
}
// The end of a cell, as IPython's inline backend (flush_figures): every open figure not
// already shown is shown, then pyplot forgets them all. The notebook calls it after each
// Python cell; a worker or Node host running adder calls it after each run, then reads
// plt.shown(). Returns the figures it showed.
export function flush_figures() {
  const figs = _open.filter((f) => !f._displayed);
  _forget();
  for (const f of figs) {
    const out = f.show();
    if (_cellCtx) _cellCtx.display(out);
  }
  return figs;
}
// close(fig) forgets one figure, close() the current one, close('all') every one
export function close(fig) {
  const drop = (f) => {
    const i = _shownFigures.indexOf(f);
    if (i >= 0) _shownFigures.splice(i, 1);
    for (let j = _savedFigures.length - 1; j >= 0; j--) if (_savedFigures[j].figure === f) _savedFigures.splice(j, 1);
    const k = _open.indexOf(f);
    if (k >= 0) _open.splice(k, 1);
    if (_currentFig === f) { _currentFig = null; _currentAx = null; }
  };
  if (fig === 'all') { _shownFigures.length = 0; _savedFigures.length = 0; _forget(); return; }
  drop(fig && typeof fig === 'object' && !fig._kw ? fig : _currentFig);
}
// The figures shown (or saved) with no DOM, in order, and the savefig calls among them.
export function shown() { return _shownFigures.slice(); }
export function saved() { return _savedFigures.map((s) => ({ ...s })); }

// plt.subplot(nrows, ncols, index) — matplotlib's per-axes shortcut.
// Also accepts the 3-digit form `plt.subplot(311)` (sugar for 3,1,1).
// Returns the indexed axes and sets it as current. Distinct from
// `subplots(nrows, ncols)` which returns the full grid.
export function subplot(...args) {
  let nrows, ncols, index;
  if (args.length === 1 && typeof args[0] === 'number' && args[0] >= 111 && args[0] < 1000) {
    const n = args[0];
    nrows = Math.floor(n / 100);
    ncols = Math.floor((n / 10) % 10);
    index = n % 10;
  } else {
    nrows = args[0] || 1;
    ncols = args[1] || 1;
    index = args[2] || 1;
  }
  // as matplotlib: plt.subplot(211) … plt.subplot(212) are two axes of ONE figure. The
  // current figure is reused when its grid is this grid; an untouched 1×1 figure (one
  // plt.figure(figsize=…) made for it) gives way to the grid, keeping its options.
  let fig = _currentFig;
  if (!fig || fig.nrows !== nrows || fig.ncols !== ncols) {
    const blank = fig && fig.nrows * fig.ncols === 1 && !fig.axes[0]._traces.length && !fig.axes[0]._title;
    const opts = blank ? fig._opts : undefined;
    if (blank) close(fig);
    fig = subplots(nrows, ncols, opts).fig;
  }
  const ax = fig.axes[index - 1];
  if (!ax) throw new Error(`subplot: index ${index} is outside a ${nrows}×${ncols} grid`);
  _setCurrent(fig, ax);
  return ax;
}

// plt.cm — matplotlib's colormap namespace. Each public name is a
// colormap function `(t in [0,1]) → 'rgb(r,g,b)'`. Notebooks reference
// these as `cmap = plt.cm.viridis`. We mirror the names we have in
// getCmap; unknown / dunder access returns undefined so adder's
// attribute probing (__adderClass__, __iter__, etc.) doesn't get
// fooled into thinking every name is a cmap.
const _CMAP_NAMES = [
  'viridis', 'coolwarm', 'turbo',
  'plasma', 'inferno', 'magma', 'cividis',
  'jet', 'gray', 'Greys', 'hot', 'cool',
  'spring', 'summer', 'autumn', 'winter',
  'viridis_r', 'plasma_r', 'inferno_r', 'magma_r', 'jet_r', 'gray_r',
];
// matplotlib.colors
export const colors = { Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm, ListedColormap, LinearSegmentedColormap };
export const cm = {};
for (const n of _CMAP_NAMES) {
  Object.defineProperty(cm, n, {
    get() { return getCmap(n); },
    enumerable: true,
  });
}
cm.get_cmap = getCmap;
cm.ScalarMappable = ScalarMappable;

// matplotlib stateful interface — module-level helpers that delegate to
// the current axes. Each lazily creates an axes if none exists yet, so
// `plt.title("x")` as the very first call still works (matches mpl).
function _ax() {
  if (!_currentAx) subplots();
  return _currentAx;
}
export function gca() { return _ax(); }
export function gcf() { if (!_currentFig) subplots(); return _currentFig; }
export function xlabel(text, opts) { _ax().set_xlabel(text, opts); }
export function ylabel(text, opts) { _ax().set_ylabel(text, opts); }
export function title(text, opts) { _ax().set_title(text, opts); }
export function xlim(lo, hi) { _ax().set_xlim(lo, hi); }
export function ylim(lo, hi) { _ax().set_ylim(lo, hi); }
export function xscale(scale) { _ax().set_xscale(scale); }
export function yscale(scale) { _ax().set_yscale(scale); }
export function legend(opts) { _ax().legend(opts); }
export function grid(...args) { return _ax().grid(...args); }
export function vlines(...args) { return _ax().vlines(...args); }
export function hlines(...args) { return _ax().hlines(...args); }
export function axhline(...args) { return _ax().axhline(...args); }
export function axvline(...args) { return _ax().axvline(...args); }
export function text(...args) { return _ax().text(...args); }
// subplots_adjust isn't honoured yet (it warns); tight_layout is a true no-op: layout is always tight
export function subplots_adjust(_opts) { _noop('subplots_adjust'); }
export function tight_layout(_opts) { /* layout is always tight */ }
export function savefig(filename) { return _currentFig && _currentFig.savefig(filename); }
export function clf() { _forget(); _shownFigures.length = 0; _savedFigures.length = 0; }
export function cla() { _currentAx = null; }

// plt.xticks(ticks, labels) / yticks — custom ticks aren't supported yet; they warn once and
// the axes keep their automatic ticks.
// plt.xticks(ticks?, labels?, {rotation}) — sets them; with no ticks, returns [locs, labels]
export function xticks(ticks, labels, opts) { return _pyTicks('x', ticks, labels, opts); }
export function yticks(ticks, labels, opts) { return _pyTicks('y', ticks, labels, opts); }
function _pyTicks(axis, ticks, labels, opts) {
  const ax = _ax();
  if (ticks && typeof ticks === 'object' && !Array.isArray(ticks) && !ArrayBuffer.isView(ticks)) { opts = ticks; ticks = opts.ticks; labels = opts.labels; }
  if (labels && typeof labels === 'object' && !Array.isArray(labels) && !ArrayBuffer.isView(labels)) { opts = labels; labels = opts.labels; }
  if (ticks != null) ax[axis === 'x' ? 'set_xticks' : 'set_yticks'](ticks, labels, opts);
  else if (opts && opts.rotation != null) ax.tick_params({ axis, labelrotation: opts.rotation });
  return [ax[axis === 'x' ? 'get_xticks' : 'get_yticks'](), ax[axis === 'x' ? 'get_xticklabels' : 'get_yticklabels']()];
}
export function axis(arg) { return _ax().axis(arg); }
// the marks, on the current axes (matplotlib's pyplot state)
export function barh(...args) { return _ax().barh(...args); }
export function bar_label(container, labels, opts) { return _ax().bar_label(container, labels, opts); }
export function errorbar(...args) { return _ax().errorbar(...args); }
export function fill_between(...args) { return _ax().fill_between(...args); }
export function fill_betweenx(...args) { return _ax().fill_betweenx(...args); }
export function step(...args) { return _ax().step(...args); }
export function axhspan(...args) { return _ax().axhspan(...args); }
export function axvspan(...args) { return _ax().axvspan(...args); }
export function annotate(...args) { return _ax().annotate(...args); }
export function boxplot(...args) { return _ax().boxplot(...args); }
export function contour(...args) { return _ax().contour(...args); }
export function contourf(...args) { return _ax().contourf(...args); }
export function pcolormesh(...args) { return _ax().pcolormesh(...args); }
// plan views: polygons, GeoJSON, the map furniture (geo.js)
export function fill(...args) { return _ax().fill(...args); }
export function add_geometry(geom, opts) { return _ax().add_geometry(geom, opts); }
export { Polygon, Rectangle, Circle, ScalarMappable };
// tier 2: distributions, stacks, ticks (dist.js, marks.js, ticker.js)
export function violinplot(...args) { return _ax().violinplot(...args); }
export function hexbin(...args) { return _ax().hexbin(...args); }
export function hist2d(...args) { return _ax().hist2d(...args); }
export function stackplot(x, ...args) { return _ax().stackplot(x, ...args); }
export function minorticks_on() { _ax().minorticks_on(); }
export function minorticks_off() { _ax().minorticks_off(); }
export function tick_params(opts) { _ax().tick_params(opts); }
// matplotlib.ticker and matplotlib.dates, as plt.ticker / plt.dates
export { ticker, dates };
export function margins(x, y) { return _ax().margins(x, y); }

// plt.colorbar(im, ax=None, **kwargs) — attach a colorbar to the axes
// that holds `im`. matplotlib's `im` is an AxesImage; since our
// ax.matshow/.imshow return the Axes itself (for chaining), `im` will
// usually BE the axes. We accept:
//   - an opts.ax kwarg pointing at a specific Axes
//   - any object with a `.colorbar` method (an Axes)
//   - any object with `.axes` pointing at an Axes (matplotlib-shape)
//   - falls back to the current axes
// Returns the axes (matplotlib returns a Colorbar object, but no
// caller in the GCU stack uses it as anything other than a side-
// effect call).
export function colorbar(mappable, opts) {
  if (mappable && typeof mappable === 'object' && !mappable._trace && !mappable.axes && !Array.isArray(mappable) && opts == null) { opts = mappable; mappable = null; }
  const o = opts && typeof opts === 'object' ? opts : {};
  const ax = o.ax || (mappable && mappable.axes) || (mappable && typeof mappable.colorbar === 'function' ? mappable : null) || _ax();
  const rest = { ...o }; delete rest.ax;
  return mappable && mappable._trace ? ax.colorbar(mappable, rest) : ax.colorbar(rest);
}
// plt.suptitle — sets the figure-level title above all subplots.
// Delegates to the current figure's suptitle method.
export function suptitle(text, opts) {
  const fig = gcf();
  return fig && fig.suptitle ? fig.suptitle(text, opts) : null;
}

// The matplotlib-shaped module object, built in every host: a worker or Node registers it
// with adder (registerModule('plt', pltAdder)); the notebook gets it below.
export const pltAdder = {
  subplots, subplot, figure, Figure, cmap, cm, plot, scatter, imshow, matshow, hist, bar,
  rc, rcParams, style, show, flush_figures, close, shown, saved, replay,
  gca, gcf, xlabel, ylabel, title, xlim, ylim, xscale, yscale,
  legend, grid, vlines, hlines, axhline, axvline, text,
  subplots_adjust, tight_layout, savefig, clf, cla,
  xticks, yticks, axis, margins, colorbar, suptitle, themeFromCSS,
  colors, Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm, ListedColormap,
  boxplot, contour, contourf, pcolormesh, fill, add_geometry, Polygon, Rectangle, Circle, ScalarMappable,
  violinplot, hexbin, hist2d, stackplot, minorticks_on, minorticks_off, tick_params, ticker, dates,
  barh, bar_label, errorbar, fill_between, fill_betweenx, step, axhspan, axvspan, annotate,
  rcdefaults, rc_context, cycler,
};
// `import matplotlib as mpl` (an .ipynb's, through @gcu/ipynb): matplotlib's top-level names
// that plot has — rcParams and friends, the style, colour maps, colours, ticker, dates.
// mpl.use(backend) is a no-op (the notebook is the backend).
pltAdder.matplotlib = {
  rcParams, rc, rcdefaults, rc_context, style, cm, colors, ticker, dates, cycler,
  patches: { Rectangle, Polygon, Circle },
  use() {}, get_backend: () => 'module://gcu.plot', __version__: '3.9.0',
  rcParamsDefault: null,
};
Object.defineProperty(pltAdder.matplotlib, 'rcParamsDefault', { get: () => _rcDefaults(), enumerable: true });
pltAdder.cycler = cycler;

// The notebook's cells. A Python (adder) cell is matplotlib's inline backend: it starts
// with no current figure, and when it ends its figures not yet shown land in its output.
// A JS cell starts with no current figure too, and shows only what it asks to
// (plt.show(), fig.show()) — a JS cell often builds a figure for another to compose.
function _installCellHooks() {
  window._adderCellHooks = window._adderCellHooks || [];
  window._adderCellHooks.push({
    before(_scope, cell) { _forget(); _cellCtx = (cell && cell._ctx) || null; return null; },
    // the cell arrives here too: a cell whose `import plt` loaded this module began before
    // this hook existed, and its figures still belong in its output
    after(_state, _defines, _scope, cell) {
      if (!_cellCtx) _cellCtx = (cell && cell._ctx) || null;
      try { if (_cellCtx) flush_figures(); else _forget(); } finally { _cellCtx = null; }
    },
  });
  const hooks = window.auditable && window.auditable.hooks;
  if (hooks && typeof hooks.on === 'function') hooks.on('dag:cell:before-exec', () => { if (!_cellCtx) _forget(); });
}

// register as auditable extension for adder `import plt`
if (typeof window !== 'undefined') {
  _installCellHooks();
  const _plt = pltAdder;
  const register = window.auditable?.registerExtension;
  if (register) {
    register({
      name: '@gcu/plot',
      version: VERSION,
      description: 'Canvas 2D plotting library \u2014 line, scatter, bar, hist, imshow',
      pluginUrl: '@gcu/plot',
      exports: { plt: _plt },
    });
  } else {
    window._auditableExtensions = window._auditableExtensions || {};
    window._auditableExtensions['plt'] = _plt;
    if (window._auditablePlugins) {
      window._auditablePlugins.set('@gcu/plot', { description: 'Canvas 2D plotting library \u2014 line, scatter, bar, hist, imshow' });
    }
  }
}
