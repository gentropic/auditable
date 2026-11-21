// ⚠ GENERATED FILE — DO NOT EDIT. Source: ext/plot/src/  Build: node ext/plot/build.js
// @gcu/plot — Canvas 2D plotting library for Auditable
// Line, scatter, bar, histogram, imshow. GCU dark theme.

// -- opts.js --

// Nothing is silently ignored. Every option a plot function takes is listed here, in ONE place:
// what it accepts, and what it knows of but can't do yet (with what to use instead). An option
// not in either list warns once per function and key, with the nearest real name. With
// rcParams['gcu.strict'] (or a figure made with {strict: true}) every warning throws instead.
//
// The lists double as documentation: API.md's "unsupported" table is generated from
// _UNSUPPORTED, so the warnings and the docs can't drift.

// matplotlib's short aliases, resolved into the canonical name at trace ingress
const _ALIASES = {
  c: 'color',
  ls: 'linestyle',
  lw: 'linewidth',
  ms: 'markersize',
  mec: 'markeredgecolor',
  mfc: 'markerfacecolor',
  mew: 'markeredgewidth',
  // scatter() takes plural edgecolors / linewidths (they can be per point); the renderer
  // reads the singular
  edgecolors: 'edgecolor',
  linewidths: 'linewidth',
  fc: 'facecolor',
  ec: 'edgecolor',
};

// keys every artist takes
const _ARTIST = ['label', 'alpha', 'zorder', 'color'];

const _KNOWN = {
  plot: [..._ARTIST, 'linestyle', 'linewidth', 'marker', 'markersize', 'markerfacecolor', 'markeredgecolor', 'markeredgewidth', 'fmt', 'drawstyle'],
  scatter: [..._ARTIST, 'c', 's', 'cmap', 'vmin', 'vmax', 'norm', 'marker', 'edgecolor', 'linewidth', 'plotnonfinite'],
  bar: [..._ARTIST, 'width', 'bottom', 'align', 'edgecolor', 'linewidth', 'tick_label'],
  barh: [..._ARTIST, 'height', 'left', 'align', 'edgecolor', 'linewidth', 'tick_label'],
  hist: [..._ARTIST, 'bins', 'range', 'weights', 'density', 'cumulative', 'edgecolor', 'linewidth', 'histtype', 'orientation', 'stacked', 'log', 'bottom', 'align', 'rwidth', 'linestyle'],
  fill_between: [..._ARTIST, 'where', 'step', 'interpolate', 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'y2'],
  fill_betweenx: [..._ARTIST, 'where', 'step', 'interpolate', 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'x2'],
  contour: [..._ARTIST, 'levels', 'colors', 'cmap', 'norm', 'vmin', 'vmax', 'linewidths', 'linestyles', 'extend', 'extent', 'origin', 'antialiased'],
  contourf: [..._ARTIST, 'levels', 'colors', 'cmap', 'norm', 'vmin', 'vmax', 'extend', 'extent', 'origin', 'antialiased', 'hatches', 'vector'],
  pcolormesh: [..._ARTIST, 'cmap', 'norm', 'vmin', 'vmax', 'edgecolor', 'linewidth', 'antialiased', 'rasterized'],
  axhspan: [..._ARTIST, 'xmin', 'xmax', 'facecolor', 'edgecolor', 'linewidth'],
  axvspan: [..._ARTIST, 'ymin', 'ymax', 'facecolor', 'edgecolor', 'linewidth'],
  imshow: ['label', 'alpha', 'zorder', 'cmap', 'vmin', 'vmax', 'norm', 'origin', 'nodata', 'extent', 'interpolation', 'aspect'],
  axhline: [..._ARTIST, 'linestyle', 'linewidth', 'xmin', 'xmax'],
  axvline: [..._ARTIST, 'linestyle', 'linewidth', 'ymin', 'ymax'],
  hlines: [..._ARTIST, 'colors', 'linestyle', 'linewidth'],
  vlines: [..._ARTIST, 'colors', 'linestyle', 'linewidth'],
  text: ['color', 'alpha', 'zorder', 'fontsize', 'ha', 'va', 'horizontalalignment', 'verticalalignment', 'transform', 'rotation', 'fontweight'],
  legend: ['loc', 'bbox_to_anchor', 'ncol', 'ncols', 'title', 'fontsize', 'title_fontsize', 'frameon', 'framealpha', 'labelcolor', 'facecolor', 'edgecolor', 'markerscale', 'borderaxespad', 'handles', 'labels'],
  colorbar: ['label', 'ax', 'ticks', 'extend', 'format', 'cmap', 'norm', 'vmin', 'vmax'],
  grid: ['color', 'alpha', 'linestyle', 'linewidth', 'which', 'axis'],
  subplots: ['figsize', 'dpi', 'facecolor', 'gap', 'wspace', 'hspace', 'strict', 'theme', 'sharex', 'sharey'],
  label: ['fontsize', 'color', 'loc', 'pad', 'fontweight'],
  fill: [..._ARTIST, 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'fill', 'closed'],
  add_patch: [..._ARTIST, 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'fill', 'closed'],
  add_geometry: [..._ARTIST, 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'marker', 's'],
  scalebar: ['units', 'length', 'loc', 'color', 'label'],
  north_arrow: ['loc', 'rotation', 'size', 'color'],
  hexbin: ['label', 'alpha', 'zorder', 'C', 'gridsize', 'bins', 'xscale', 'yscale', 'extent', 'cmap', 'norm', 'vmin', 'vmax', 'linewidths', 'edgecolors', 'reduce_C_function', 'mincnt'],
  hist2d: ['label', 'alpha', 'zorder', 'bins', 'range', 'density', 'weights', 'cmin', 'cmax', 'cmap', 'norm', 'vmin', 'vmax'],
  stackplot: ['labels', 'colors', 'baseline', 'alpha', 'zorder', 'edgecolor', 'linewidth'],
};

// known, not done yet: the hint says what to do instead
const _UNSUPPORTED = {
  hexbin: { marginals: 'not supported yet; draw hist() on twin axes' },
  stackplot: { hatch: 'not supported yet' },
  plot: { dashes: "use linestyle ('--', '-.', ':')" },
  bar: { hatch: 'not supported yet', yerr: 'use errorbar() on the bar positions', xerr: 'use errorbar() on the bar positions' },
  barh: { hatch: 'not supported yet', xerr: 'use errorbar() on the bar positions' },
  hist: { hatch: 'not supported yet' },
  text: { bbox: 'not supported yet' },
  legend: { shadow: 'not supported yet', fancybox: 'not supported yet', mode: 'not supported yet', handlelength: 'not supported yet', columnspacing: 'not supported yet' },
  colorbar: { shrink: 'not supported yet', orientation: 'only vertical colorbars for now', fraction: 'not supported yet', pad: 'not supported yet' },
  subplots: { squeeze: 'not supported yet', constrained_layout: 'layout is always tight', layout: 'layout is always tight' },
};

// The calls that do nothing yet, by name → what to do instead
const _NOOP_CALLS = {
  rc: "plt.rc is not supported yet; use plt.style.use('default' | 'dark_background')",
  set_zorder: 'axes are drawn in creation order',
  subplots_adjust: 'not supported yet; use subplots(..., {gap}) for the space between axes',
};

// plt.rcParams lives here so the strict flag can be read without an import cycle
const rcParams = {};
Object.defineProperty(rcParams, 'update', {
  value(obj) { if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) if (k !== '_kw') rcParams[k] = obj[k]; },
  enumerable: false,
});

const _warned = new Set();

function _strict(strictFlag) {
  return !!(strictFlag || rcParams['gcu.strict']);
}

// one message per (function, key): a notebook loop must not print the same warning 10,000 times
function _warn(key, msg, strictFlag) {
  if (_strict(strictFlag)) throw new Error('plot: ' + msg);
  if (_warned.has(key)) return;
  _warned.add(key);
  if (typeof console !== 'undefined' && console.warn) console.warn('plot: ' + msg);
}

// for tests: forget which warnings have been shown
function _resetWarnings() { _warned.clear(); }

function _lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

function _suggest(key, names) {
  let best = null, bd = 3;
  const k = key.toLowerCase();
  for (const n of names) {
    const d = _lev(k, n.toLowerCase());
    if (d < bd) { bd = d; best = n; }
  }
  // 'colour' → 'color' is distance 1; anything that far off from every name gets no guess
  return best;
}

// Check an options object for function `fn`. Unknown keys warn (or throw when strict).
function _checkOpts(fn, o, strictFlag) {
  if (!o || typeof o !== 'object') return o;
  const known = _KNOWN[fn];
  if (!known) return o;
  const uns = _UNSUPPORTED[fn] || {};
  for (const key of Object.keys(o)) {
    if (key === '_kw' || key.startsWith('_')) continue;            // adder's kwargs marker; plot's own internals
    if (known.includes(key) || (_ALIASES[key] && known.includes(_ALIASES[key]))) continue;
    if (key in uns) { _warn(`${fn}.${key}`, `${fn}(): '${key}' — ${uns[key]}`, strictFlag); continue; }
    const names = known.concat(Object.keys(_ALIASES).filter((a) => known.includes(_ALIASES[a])));
    const s = _suggest(key, names);
    _warn(`${fn}.${key}`, `${fn}() has no option '${key}'${s ? `, did you mean '${s}'?` : ''}`, strictFlag);
  }
  return o;
}

// resolve the short aliases into canonical names (the long name wins if both are given)
function _resolveAliases(o) {
  if (!o) return o;
  for (const [a, k] of Object.entries(_ALIASES)) {
    if (o[a] !== undefined && o[k] === undefined) o[k] = o[a];
  }
  return o;
}

// a call plot accepts but can't honour yet
function _noop(name, strictFlag) {
  _warn('call.' + name, `${name}() does nothing yet — ${_NOOP_CALLS[name]}`, strictFlag);
}

// -- data.js --

// Columnar ingest — every place plot takes a column (x, y, c, s, weights, bins, data) goes
// through _col, so every array-like works everywhere and big columns are never copied twice.
//
//   typed array          → kept AS IS (no copy; plot never writes into a caller's array)
//   plain Array, numbers → one Float64Array (null / undefined / non-numbers become NaN)
//   plain Array, strings → kept as an Array (category labels, per-point colour names)
//   natra / vec ndarrays → a typed view or copy of their data (natra's lives in Wasm memory,
//                          which can grow and detach a view, so that one is copied)
//   any other iterable   → read once, then as a plain Array
//
// Traces are immutable once added, so anything derived from a column (its finite range, a
// histogram, a raster) is cached ON THE TRACE, never on the caller's array: a caller who
// mutates an array and plots it again gets a fresh trace and fresh numbers.

function _isArrayLike(v) {
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return false;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return true;
  if (typeof v !== 'object' && typeof v !== 'function') return false;
  if (v._nd && v._arr) return true;
  if (v.data && (ArrayBuffer.isView(v.data) || Array.isArray(v.data))) return true;
  return typeof v[Symbol.iterator] === 'function';
}

function _fromPlainArray(a) {
  // numeric → Float64Array; anything holding a string (or a Date, an object) stays an Array
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    if (v != null && typeof v !== 'number' && typeof v !== 'boolean') return a;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = a[i]; out[i] = v == null ? NaN : +v; }
  return out;
}

function _col(x) {
  if (x == null) return new Float64Array(0);
  if (ArrayBuffer.isView(x) && !(x instanceof DataView)) {
    // BigInt columns can't mix with Number arithmetic: those (only those) are converted once
    if ((typeof BigInt64Array !== 'undefined' && x instanceof BigInt64Array) || (typeof BigUint64Array !== 'undefined' && x instanceof BigUint64Array)) return Float64Array.from(x, Number);
    return x;
  }
  if (Array.isArray(x)) return _fromPlainArray(x);
  if (typeof x === 'number' || typeof x === 'boolean') return Float64Array.of(+x);
  if (typeof x === 'string') return [x];
  // natra adder wrapper: {_nd: true, _arr: <descriptor>}
  if (x._nd && x._arr) {
    const a = x._arr;
    if (a.memory && a.memory.buffer && a.dtype === 'f64' && typeof a.ptr === 'number') {
      return new Float64Array(a.memory.buffer, a.ptr, a.length).slice();
    }
    if (a.data) return _col(a.data.subarray ? a.data.subarray(0, a.length) : a.data);
  }
  // data-backed ndarray (vec / numpy-like): a view on its data, not a copy
  if (x.data && (ArrayBuffer.isView(x.data) || Array.isArray(x.data))) {
    const d = x.data, n = x.length != null ? x.length : d.length;
    if (ArrayBuffer.isView(d)) return n === d.length ? d : d.subarray(0, n);
    return _fromPlainArray(n === d.length ? d : d.slice(0, n));
  }
  if (typeof x[Symbol.iterator] === 'function') return _fromPlainArray(Array.from(x));
  return Float64Array.of(+x);
}

// Is this column numbers (a typed array, or a Float64Array we made)?
function _isNumericCol(a) {
  return ArrayBuffer.isView(a);
}

// A column's finite min and max: { lo, hi, n } with n = 1 when there is any finite value
// (0 when none). NaN and ±Inf never reach a range.
//
// Fast because NaN fails every comparison: the plain min/max loop already skips it. Only an
// infinity can sneak in, and only then does a second, checked pass run.
function _finiteRange(a) {
  let lo = Infinity, hi = -Infinity;
  if (!_isNumericCol(a)) return { lo, hi, n: 0 };
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === -Infinity || hi === Infinity) {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < len; i++) {
      const v = a[i];
      if (v - v !== 0) continue;        // NaN or ±Inf (v - v is NaN for both)
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, hi, n: lo <= hi ? 1 : 0 };
}

// the smallest positive finite value — what a log axis can show (Infinity when none)
function _minPositive(a) {
  let m = Infinity;
  if (!_isNumericCol(a)) return m;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v > 0 && v < m) m = v; }
  return m;
}

// cached per trace: `trace._cache.range_<key>`; `.minPos` is filled in when a log axis asks
function _traceRange(trace, key, arr, log = false) {
  const c = trace._cache || (trace._cache = {});
  const k = 'range_' + key;
  const r = c[k] || (c[k] = _finiteRange(arr));
  if (log && r.minPos === undefined) r.minPos = _minPositive(arr);
  return r;
}

// Is a numeric column non-decreasing (ignoring NaN)? Line decimation needs it.
function _isMonotonic(a) {
  let prev = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) continue;
    if (v < prev) return false;
    prev = v;
  }
  return true;
}

// 0, 1, …, n-1 — the x of plot(y)
function _arange(n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

// Format a count the way an error message should: 1,000 not 1000
function _fmtCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// -- theme.js --

// @gcu/theme — one theme vocabulary for GCU figures. @gcu/condenser's view and @gcu/plot
// read the same keys, so one theme dresses a chart and the 3D view beside it.
//
// A theme is a plain object. The keys:
//
//   background    the plot area's / the 3D scene's background
//   figure        the surface around a chart's plot areas (a figure's face); charts only
//   foreground    primary text and marks
//   muted         secondary text: tick labels, captions, units
//   grid          grid lines
//   frame         axis lines, bar outlines, legend swatch borders
//   panel         the fill behind floating chrome (legends, readouts, toolbars)
//   panel_border  its border
//   accent        the action colour: a pressed button, a cut line, a highlight
//   selection     what is selected
//   halo          the outline that keeps text readable over a busy scene
//   cycle         the categorical colours, in order
//   ramp          the default colour map's name
//   font          the sans stack (titles, labels)
//   mono          the monospace stack (numbers, readouts)
//   font_size     the base size in CSS px
//
// The dark theme is Switchboard's basalt, the light one its equipment gray; paper is
// white, for printed figures. Colours are CSS colour strings.

const MONO = "'Space Mono', 'JetBrains Mono', Consolas, ui-monospace, Menlo, monospace";
const SANS = "'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif";

// matplotlib's default cycle (tab10, its C0–C9): what a chart written from matplotlib
// memory expects its first line, bar or class to be
const CYCLE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

const THEME_KEYS = ['background', 'figure', 'foreground', 'muted', 'grid', 'frame', 'panel', 'panel_border',
  'accent', 'selection', 'halo', 'cycle', 'ramp', 'font', 'mono', 'font_size'];

const THEMES = {
  dark: {
    background: '#15171A', figure: 'transparent', foreground: '#DDDCDA', muted: '#9E9C98', grid: '#2F3338', frame: '#83817E',
    panel: 'rgba(29,32,36,0.88)', panel_border: '#2F3338', accent: '#FB9044', selection: '#EC9FFF',
    halo: 'rgba(0,0,0,0.75)', cycle: CYCLE, ramp: 'viridis', font: SANS, mono: MONO, font_size: 11,
  },
  light: {
    background: '#E4E3E1', figure: '#E4E3E1', foreground: '#232322', muted: '#504F4C', grid: '#C6C4C1', frame: '#5A5856',
    panel: 'rgba(237,236,235,0.92)', panel_border: '#B3B1AD', accent: '#8B3F00', selection: '#793A8D',
    halo: 'rgba(255,255,255,0.8)', cycle: CYCLE, ramp: 'viridis', font: SANS, mono: MONO, font_size: 11,
  },
  paper: {
    background: '#FFFFFF', figure: '#FFFFFF', foreground: '#1A1A1A', muted: '#555555', grid: '#DDDDDD', frame: '#333333',
    panel: 'rgba(255,255,255,0.92)', panel_border: '#BBBBBB', accent: '#8B3F00', selection: '#793A8D',
    halo: 'rgba(255,255,255,0.85)', cycle: CYCLE, ramp: 'viridis', font: SANS, mono: MONO, font_size: 11,
  },
};

// the Switchboard semantic tokens (--au-*) each key reads; a host's own design tokens
// can be mapped the same way
const CSS_MAP = {
  background: '--au-surface', foreground: '--au-fg', muted: '--au-fg-soft', grid: '--au-border-soft',
  frame: '--au-rule', panel: '--au-surface-raised', panel_border: '--au-border', accent: '--au-action',
  selection: '--au-selected', font: '--au-font-sans', mono: '--au-font-mono',
};

// a name, a partial theme ({ base: 'light', accent: '#c00' }) or nothing → a full theme.
// Unknown names fall back to dark; `onWarn` hears about it.
function resolveTheme(t, onWarn) {
  if (t == null || t === '') return _copyTheme(THEMES.dark);
  if (typeof t === 'string') {
    if (THEMES[t]) return _copyTheme(THEMES[t]);
    if (onWarn) onWarn(`no theme '${t}' (${Object.keys(THEMES).join(', ')}); using dark`);
    return _copyTheme(THEMES.dark);
  }
  const base = resolveTheme(t.base || (t.background && isLight(t.background) ? 'light' : 'dark'), onWarn);
  for (const k of THEME_KEYS) if (t[k] != null && t[k] !== '') base[k] = k === 'cycle' ? Array.from(t[k]) : t[k];
  if (onWarn) for (const k of Object.keys(t)) if (k !== 'base' && !THEME_KEYS.includes(k)) onWarn(`a theme has no key '${k}'`);
  return base;
}
const _copyTheme = (t) => ({ ...t, cycle: t.cycle.slice() });

// read a theme from CSS custom properties on `el` (a host page's tokens, its light or
// dark mode). Properties that are unset keep the base theme's value; the base is light
// or dark by the background found.
function themeFromCSS(el, map = CSS_MAP) {
  const cs = typeof getComputedStyle === 'function' && el ? getComputedStyle(el) : null;
  const out = {};
  if (cs) for (const [k, prop] of Object.entries(map)) {
    const v = cs.getPropertyValue(prop).trim();
    if (v) out[k] = v;
  }
  if (out.background) out.base = isLight(out.background) ? 'light' : 'dark';
  return resolveTheme(out);
}

// '#rgb' · '#rrggbb' · 'rgb(a)(…)' → [r, g, b] 0–255 (null if it can't tell)
function parseColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]].map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return null;
}

// relative luminance above the midpoint: a light theme
function isLight(c) {
  const rgb = parseColor(c);
  if (!rgb) return false;
  const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.18;
}

// -- style.js --

// The theme. plot speaks @gcu/theme's keys (background, figure, foreground, muted, grid,
// frame, panel, panel_border, accent, selection, halo, cycle, ramp, font, mono, font_size),
// the same ones @gcu/condenser's 3D view reads, so one theme dresses a chart and the view
// beside it. No colour is hard-coded outside a theme.
//
// - `plt.style.use(name)` sets the DEFAULT theme, which a figure copies when it is made
//   (matplotlib's rule: a style applies to what is created after it). matplotlib's light
//   styles ('default', 'classic', …) are the white `paper` theme; 'dark_background' is
//   `dark`; @gcu/theme's own names work too.
// - `subplots({theme})` / `figure({theme})` / `fig.set_theme(t)` give one figure its own:
//   a name, a partial theme ({base: 'light', accent: '#c00'}), or themeFromCSS(el).
// - Per-axes overrides (`_bgcolor`, `_textColor`, `_gridColor`, `_frameColor`) still win, for
//   callers that dress one cell of a grid.
//
// Notebooks loaded from a .ipynb through @gcu/ipynb get an automatic
// `plt.style.use('default')` after their `import matplotlib.pyplot`, so they render light as
// their authors saw them in Jupyter. Native auditable cells keep the dark default.
//
// Text: plot draws every label in the theme's MONOSPACE stack (`mono`), at `font_size`
// (ticks one px smaller, titles two larger). Monospace is what keeps the draw list the same
// on every host: the recording context measures text as 0.6 em per character, which is
// right for any monospace face and wrong for a proportional one.

const _LIGHT_STYLES = ['default', 'classic', 'matplotlib', 'seaborn', 'seaborn-whitegrid', 'seaborn-v0_8', 'seaborn-v0_8-whitegrid', 'ggplot', 'bmh', 'fast', 'grayscale'];

// the default theme a new figure copies (style.use changes it)
const _style = resolveTheme('dark');

// a theme, as a figure takes it: names and partials resolved over the default theme's base.
// plot 0.2's own keys (bgcolor, textColor, …) are still read, mapped onto the shared ones.
const _LEGACY = { bgcolor: 'background', textColor: 'foreground', gridColor: 'grid', frameColor: 'frame', figureFacecolor: 'figure', legendBg: 'panel', legendBorder: 'panel_border', refColor: 'muted' };
function _resolve(t, strict) {
  if (t == null) return _snapshotStyle();
  if (typeof t === 'string') {
    const key = _LIGHT_STYLES.includes(t.toLowerCase()) ? 'paper' : t.toLowerCase() === 'dark_background' ? 'dark' : t;
    return resolveTheme(key, (m) => _warn(`theme.${t}`, `plot: ${m}`, strict));
  }
  const o = {};
  for (const [k, v] of Object.entries(t)) o[_LEGACY[k] || k] = v;
  if (!o.base && !o.background) o.base = _style._name || 'dark';
  return resolveTheme(o, (m) => _warn(`theme.${m}`, `plot: ${m}`, strict));
}

// the default theme as it stands now, for a figure being made
function _snapshotStyle() {
  return { ..._style, cycle: _style.cycle.slice() };
}

// matplotlib's style.use: a name or a list of names. The light matplotlib styles are the
// white `paper` theme, 'dark_background' is `dark`, and dark / light / paper are taken as
// they are. Anything else warns and changes nothing.
function setStyle(name) {
  const names = Array.isArray(name) ? name : [name];
  for (const n of names) {
    const key = String(n || '').toLowerCase();
    const theme = _LIGHT_STYLES.includes(key) ? 'paper' : key === 'dark_background' ? 'dark' : THEMES[key] ? key : null;
    if (!theme) {
      _warn('style.' + key, `style.use('${n}') is not a style plot knows; use 'default' (white), 'dark_background', or a theme: ${Object.keys(THEMES).join(', ')}`);
      continue;
    }
    for (const k of Object.keys(_style)) delete _style[k];
    Object.assign(_style, resolveTheme(theme), { _name: theme });
  }
}
_style._name = 'dark';


// fonts: the theme's monospace stack at a size relative to font_size
const _font = (th, d = 0, bold = false) => `${bold ? 'bold ' : ''}${(th.font_size || 11) + d}px ${th.mono}`;

// A text's width for LAYOUT: 0.6 em per character, what every monospace face advances (and
// what the recording context answers), so a figure lays out identically live, recorded, in
// a worker or in Node — and a draw list replays onto exactly the pixels the live draw made.
const _textW = (font, s) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return String(s).length * 0.6 * (m ? +m[1] : 10);
};

// -- scale.js --

// Linear scale with Heckbert nice-number tick generation

function _niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

// Hot loops don't call transform() per point: every scale also carries its fold, px = a·v + b
// (on log10(v) for a log scale; `log` says which), worked out once per render.
class LinearScale {
  constructor(domain, range) {
    this.domain = domain;
    this.range = range;
    this.log = false;
    const dr = domain[1] - domain[0];
    this.a = dr === 0 ? 0 : (range[1] - range[0]) / dr;
    this.b = dr === 0 ? (range[0] + range[1]) / 2 : range[0] - domain[0] * this.a;
  }

  transform(v) {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const dr = d1 - d0;
    if (dr === 0) return (r0 + r1) / 2;
    return r0 + (v - d0) / dr * (r1 - r0);
  }

  inverse(px) {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const rr = r1 - r0;
    if (rr === 0) return (d0 + d1) / 2;
    return d0 + (px - r0) / rr * (d1 - d0);
  }

  ticks(count) {
    if (count == null) count = 5;
    const [lo, hi] = this.domain;
    const range = _niceNum(hi - lo, false);
    const step = _niceNum(range / (count - 1), true);
    const start = Math.ceil(lo / step) * step;
    const end = Math.floor(hi / step) * step;
    const ticks = [];
    // safety: ensure finite loop
    if (step <= 0 || !isFinite(start) || !isFinite(end)) return [lo, hi];
    for (let v = start; v <= end + step * 0.5; v += step) {
      ticks.push(+v.toPrecision(12));
    }
    return ticks;
  }

  tickFormat() {
    const [lo, hi] = this.domain;
    const range = Math.abs(hi - lo);
    if (range === 0) return (v) => String(v);
    const mag = Math.log10(Math.max(Math.abs(lo), Math.abs(hi), 1e-30));
    if (mag > 6 || mag < -3) return (v) => v.toExponential(1);
    const dec = Math.max(0, -Math.floor(Math.log10(range)) + 1);
    return (v) => v.toFixed(Math.min(dec, 6));
  }
}

// Log10 scale — matplotlib's `set_xscale('log')` equivalent. Domain
// must be strictly positive; callers should clamp lo before passing.
// Ticks are integer powers of 10 within the domain.
class LogScale {
  constructor(domain, range) {
    // Clamp lo to a tiny positive value if non-positive (defensive).
    const [d0, d1] = domain;
    this.domain = [d0 > 0 ? d0 : 1e-300, d1 > 0 ? d1 : 1];
    this.range = range;
    this.log = true;
    const l0 = Math.log10(this.domain[0]), dl = Math.log10(this.domain[1]) - l0;
    this.a = dl === 0 ? 0 : (range[1] - range[0]) / dl;
    this.b = dl === 0 ? (range[0] + range[1]) / 2 : range[0] - l0 * this.a;
  }

  transform(v) {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    if (v <= 0) return r0;
    const l0 = Math.log10(d0);
    const l1 = Math.log10(d1);
    const dr = l1 - l0;
    if (dr === 0) return (r0 + r1) / 2;
    return r0 + (Math.log10(v) - l0) / dr * (r1 - r0);
  }

  inverse(px) {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const rr = r1 - r0;
    const l0 = Math.log10(d0);
    const l1 = Math.log10(d1);
    if (rr === 0) return Math.pow(10, (l0 + l1) / 2);
    return Math.pow(10, l0 + (px - r0) / rr * (l1 - l0));
  }

  ticks() {
    const [lo, hi] = this.domain;
    const loE = Math.ceil(Math.log10(lo));
    const hiE = Math.floor(Math.log10(hi));
    const ticks = [];
    // Limit decade-count so degenerate domains don't blow up.
    if (hiE - loE > 30) return [lo, hi];
    for (let e = loE; e <= hiE; e++) ticks.push(Math.pow(10, e));
    return ticks;
  }

  tickFormat() {
    return (v) => {
      const e = Math.round(Math.log10(v));
      // Pretty-print integer powers as 10^N.
      if (Math.abs(Math.pow(10, e) - v) / v < 1e-6) {
        if (e >= -3 && e <= 4) return Math.pow(10, e).toString();
        return '10^' + e;
      }
      return v.toExponential(1);
    };
  }
}

// -- nice.js --

// Round tick values and their labels — the leaf both ticks.js and ticker.js stand on (no imports).

// at most `count` round ticks inside [lo, hi], as many as fit: the smallest step of 1, 2, 2.5
// or 5 × a power of ten that gives no more than `count` (and at least two while the range
// allows) — matplotlib's MaxNLocator idea
function _niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const n = (step) => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1;
  const e0 = Math.floor(Math.log10(span)) - 3;
  let step = null;
  for (let e = e0; e <= e0 + 5 && step == null; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const s = m * Math.pow(10, e);
      if (n(s) <= Math.max(2, count)) { step = s; break; }
    }
  }
  if (step == null) step = Math.pow(10, e0 + 6);
  const a = Math.ceil(lo / step - 1e-9), b = Math.floor(hi / step + 1e-9);
  const out = [];
  for (let k = a; k <= b && out.length < 200; k++) out.push(+(k * step).toPrecision(12));
  out.step = step;
  return out;
}

// labels for ticks with this step: just the decimals the step needs; plain digits up to 1e9
// (a northing reads 8200100, as matplotlib prints it), exponents past that or below 1e-4
function _fmtStep(values, step) {
  const big = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (big >= 1e9 || (big > 0 && big < 1e-4)) return values.map((v) => (v === 0 ? '0' : v.toExponential(Math.max(0, Math.min(3, Math.round(-Math.log10(step / big)))))));
  let dec = 0;
  while (dec < 10 && Math.abs(step * Math.pow(10, dec) - Math.round(step * Math.pow(10, dec))) > 1e-6 * Math.max(1, step * Math.pow(10, dec))) dec++;
  return values.map((v) => { const s = v.toFixed(dec); return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s; });
}

// -- ticks.js --

// Ticks and their labels, sized to the axis's PIXEL length and measured, so labels never overlap and margins can be measured from them.
//
// An axis's ticks come from, in order:
//   1. set_xticks(values, labels?, {rotation}) — exactly those (a label list may be shorter);
//   2. a category axis (strings given as x or y) — one tick per category, labelled;
//   3. the scale — at most one tick per 55 px on x, per 32 px on y, as many round ones as fit.
// Labels that would collide are fixed: numeric ticks get fewer; categories rotate 45°, and
// if they still collide only every k-th is labelled (the ticks stay).






// a category axis: labels in first-appearance order, each at the integer position 0, 1, 2 …
class _Categories {
  constructor() { this.list = []; this.index = new Map(); }
  // an array of labels (strings or numbers-as-labels) → their positions
  positions(arr) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null || (typeof v === 'number' && v !== v)) { out[i] = NaN; continue; }
      const key = String(v);
      let k = this.index.get(key);
      if (k === undefined) { k = this.list.length; this.list.push(key); this.index.set(key, k); }
      out[i] = k;
    }
    return out;
  }
}

// does this column hold labels rather than numbers (matplotlib: strings make a category axis)
function _isCategorical(arr) {
  if (!arr || typeof arr === 'string' || ArrayBuffer.isView(arr)) return false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    return typeof v === 'string';
  }
  return false;
}

// does this column hold Dates (a date axis)
function _isDateCol(arr) {
  if (!arr || typeof arr === 'string' || ArrayBuffer.isView(arr)) return false;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v == null) continue; return v instanceof Date; }
  return false;
}

// numbers as a scale formats them: a common precision for the set
function _fmtTicks(scale, values) {
  if (!scale.log && values.length > 1) return _fmtStep(values, Math.abs(values[1] - values[0]));
  const f = scale.tickFormat();
  return values.map((v) => f(v));
}

// the ticks of one axis: { values, labels, rot (degrees), extent (px the labels take
// perpendicular to the axis), along (the widest label along the axis) }
// `ax`: the Axes; `axis`: 'x' | 'y'; `scale`; `len`: the axis length in px; `ctx` to measure
function _tickSpec(ax, axis, scale, len, ctx, font, fontPx) {
  const custom = axis === 'x' ? ax._xticks : ax._yticks;
  const cats = axis === 'x' ? ax._xcats : ax._ycats;
  ctx.font = font;
  const W = (s) => _textW(font, s);
  const [d0, d1] = scale.domain;
  const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
  const inside = (v) => v >= lo - Math.abs(hi - lo) * 1e-9 && v <= hi + Math.abs(hi - lo) * 1e-9;
  let values, labels, rot = 0, fixedRot = false, thin = 1;

  if (custom && custom.rotation != null) { rot = custom.rotation === 'vertical' ? 90 : +custom.rotation || 0; fixedRot = true; }
  // the axis's ticker (axis.js): a locator and formatter set on ax.xaxis / ax.yaxis, minor ticks
  const tk = ax._ticker ? ax._ticker(axis) : null;
  const date = (axis === 'x' ? ax._xdate : ax._ydate) && !scale.log;
  const fmtCtx = (vals) => ({ step: vals.step || (vals.length > 1 ? Math.abs(vals[1] - vals[0]) : hi - lo), values: vals, range: hi - lo, date });
  const formatted = (vals, F) => { const c = fmtCtx(vals); return vals.map((v, i) => F.format(v, i, c)); };
  if (custom && custom.values) {
    values = Array.from(custom.values, Number);
    labels = custom.labels ? values.map((_, i) => (custom.labels[i] != null ? String(custom.labels[i]) : ''))
      : tk && tk.majorF ? formatted(values, tk.majorF) : date ? _dateLabels(values) : _fmtTicks(scale, values);
  } else if (cats && cats.list.length) {
    values = cats.list.map((_, i) => i);
    labels = cats.list.slice();
  } else {
    const per = axis === 'x' ? 55 : 32;
    let count = Math.max(2, Math.min(12, Math.floor(len / per) + 1));
    for (;;) {
      if (tk && tk.majorL) {
        values = tk.majorL.tick_values(lo, hi, { count, log: !!scale.log });
        labels = date ? _dateLabels(values) : scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (values.length > 1 ? Math.abs(values[1] - values[0]) : hi - lo));
      } else if (date) {
        ({ values, labels } = _dateTicks(lo, hi, count));
      } else {
        values = scale.log ? scale.ticks() : _niceTicks(lo, hi, count);
        labels = scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (hi - lo));
      }
      if (tk && tk.majorF) labels = formatted(values, tk.majorF);
      // a locator says where the ticks go: no thinning
      if (axis === 'y' || count <= 2 || scale.log || (tk && tk.majorL)) break;
      // x: shrink the count until neighbouring labels clear each other by 8 px
      const px = values.map((v) => scale.transform(v));
      let ok = true;
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(px[i] - px[i - 1]) < (W(labels[i]) + W(labels[i - 1])) / 2 + 8) { ok = false; break; }
      }
      if (ok) break;
      count--;
    }
  }
  const keep = values.map((v) => v - v === 0 && inside(v));
  values = values.filter((_, i) => keep[i]);
  labels = labels.filter((_, i) => keep[i]);
  const widths = labels.map(W);
  const maxW = widths.length ? Math.max(...widths) : 0;

  if (axis === 'x' && !fixedRot && values.length > 1) {
    // labels that collide flat: rotate 45° (only for labels, e.g. categories — numbers were
    // thinned above); if they still collide, label every k-th
    const px = values.map((v) => scale.transform(v));
    let minGap = Infinity;
    for (let i = 1; i < px.length; i++) minGap = Math.min(minGap, Math.abs(px[i] - px[i - 1]));
    if (minGap < maxW + 6) {
      rot = 45;
      const need = fontPx * 1.15;                      // rotated 45°, neighbours clear by their height / sin
      if (minGap * Math.SQRT1_2 < need) thin = Math.ceil(need / (minGap * Math.SQRT1_2));
    }
  }
  if (thin > 1) labels = labels.map((l, i) => (i % thin === 0 ? l : ''));

  const r = (rot * Math.PI) / 180;
  const extent = axis === 'x'
    ? (rot ? maxW * Math.abs(Math.sin(r)) + fontPx * Math.abs(Math.cos(r)) : fontPx)
    : maxW;
  // minor ticks: a minor locator, or minorticks_on() (AutoMinorLocator), between the majors;
  // unlabelled unless a minor formatter says otherwise
  let minor = null, minorLabels = null;
  if (tk && (tk.minorL || tk.minorOn) && !(cats && cats.list.length)) {
    const L = tk.minorL || new AutoMinorLocator();
    const majors = new Set(values.map((v) => +v.toPrecision(10)));
    minor = L.tick_values(lo, hi, { majors: values, log: !!scale.log }).filter((v) => inside(v) && !majors.has(+v.toPrecision(10)));
    if (tk.minorF) minorLabels = formatted(minor, tk.minorF);
  }
  const params = ax._tickParams ? ax._tickParams[axis] || null : null;
  return { values, labels, rot, extent, maxW, widths, minor, minorLabels, params };
}

// labels for date ticks a locator placed: the format their spacing reads in
function _dateLabels(values) {
  if (!values.length) return [];
  const d = values.length > 1 ? Math.abs(values[1] - values[0]) : 864e5;
  const fmt = d >= 360 * 864e5 ? '%Y' : d >= 28 * 864e5 ? '%Y-%m' : d >= 864e5 ? '%Y-%m-%d' : d >= 6e4 ? '%H:%M' : d >= 1e3 ? '%H:%M:%S' : '%H:%M:%S.%f';
  return values.map((t) => strftime(t, fmt));
}

// draw one axis's ticks and labels. side: 'bottom' | 'top' | 'left' | 'right'
// tick_params: { major: {length, direction, width, color}, minor: {…} } per axis; length in px
// (4 major, 2 minor), direction 'out' (default) | 'in' | 'inout'
function _drawTicks(ctx, spec, scale, side, plot, color, tickColor, font) {
  ctx.font = font;
  ctx.fillStyle = color;
  const { values, labels, rot } = spec;
  const P = spec.params || {}, maj = P.major || {}, mnr = P.minor || {};
  // one tick mark at p: out of the frame, into it, or across it
  const mark = (p, len, dir) => {
    const a = dir === 'in' ? 0 : len, b = dir === 'out' || !dir ? 0 : len;   // outward, inward
    ctx.beginPath();
    if (side === 'bottom') { ctx.moveTo(p, plot.y + plot.h - b); ctx.lineTo(p, plot.y + plot.h + a); }
    else if (side === 'top') { ctx.moveTo(p, plot.y + b); ctx.lineTo(p, plot.y - a); }
    else if (side === 'left') { ctx.moveTo(plot.x - a, p); ctx.lineTo(plot.x + b, p); }
    else { ctx.moveTo(plot.x + plot.w + a, p); ctx.lineTo(plot.x + plot.w - b, p); }
    ctx.stroke();
  };
  if (spec.minor && spec.minor.length) {
    ctx.strokeStyle = mnr.color || tickColor;
    ctx.lineWidth = mnr.width != null ? mnr.width : 0.8;
    const len = mnr.length != null ? mnr.length : 2;
    for (const v of spec.minor) { const p = scale.transform(v); if (p - p === 0) mark(p, len, mnr.direction); }
  }
  ctx.strokeStyle = maj.color || tickColor;
  ctx.lineWidth = maj.width != null ? maj.width : 1;
  const len = maj.length != null ? maj.length : 4;
  const gap = 2 + (maj.direction === 'in' ? 0 : len);   // labels clear the mark
  for (let i = 0; i < values.length; i++) {
    const p = scale.transform(values[i]);
    mark(p, len, maj.direction);
    const s = labels[i];
    if (!s) continue;
    if (side === 'bottom' || side === 'top') {
      const y = side === 'bottom' ? plot.y + plot.h + gap : plot.y - gap;
      if (rot) {                                       // rotated: the label's END sits under the tick
        ctx.save();
        ctx.translate(p, y);
        ctx.rotate((side === 'bottom' ? -1 : 1) * rot * Math.PI / 180);
        ctx.textAlign = 'right';
        ctx.textBaseline = side === 'bottom' ? 'top' : 'bottom';
        ctx.fillText(s, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = side === 'bottom' ? 'top' : 'bottom';
        ctx.fillText(s, p, y);
      }
    } else {
      ctx.textAlign = side === 'left' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, side === 'left' ? plot.x - gap : plot.x + plot.w + gap, p);
    }
  }
}

// -- color.js --

// Colormaps — perceptual maps interpolate anchor stops sampled from the
// reference palettes (the retired polynomial fits went badly wrong at the
// ends: viridis(1) came out green, coolwarm(1) white).

// A NaN value has no colour: every map returns transparent for it (not 'rgb(NaN,…)', which a
// canvas rejects and which used to push imshow off its raster path).
const _NO_COLOR = 'rgba(0,0,0,0)';

function _lerpCmap(stops) {
  return (t) => {
    if (t !== t) return _NO_COLOR;
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(x));
    const f = x - k;
    const c = [0, 1, 2].map((i) => Math.round(stops[k][i] + (stops[k + 1][i] - stops[k][i]) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
}

// Direct-function colormaps for the easy ones — jet, gray, hot, cool
// are well-defined by closed-form ramps.
function _rgb(r, g, b) {
  if (r !== r || g !== g || b !== b) return _NO_COLOR;
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

const _cmaps = {
  viridis: _lerpCmap([
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [33, 145, 140],
    [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
  ]),
  coolwarm: _lerpCmap([
    [59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221],
    [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38],
  ]),
  turbo: _lerpCmap([
    [48, 18, 59], [70, 107, 227], [40, 167, 221], [32, 229, 181], [110, 252, 107],
    [202, 240, 52], [253, 188, 39], [240, 96, 12], [122, 4, 3],
  ]),
  plasma: _lerpCmap([
    [13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104],
    [244, 136, 73], [254, 188, 43], [244, 238, 39], [240, 249, 33],
  ]),
  inferno: _lerpCmap([
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66],
    [245, 125, 21], [250, 193, 39], [245, 240, 132], [252, 255, 164],
  ]),
  magma: _lerpCmap([
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [158, 47, 127], [222, 73, 104],
    [247, 120, 107], [254, 176, 120], [254, 229, 160], [252, 253, 191],
  ]),
  cividis: _lerpCmap([
    [0, 32, 77], [26, 51, 105], [60, 77, 110], [92, 102, 112], [124, 123, 120],
    [155, 148, 115], [187, 173, 108], [222, 202, 92], [255, 234, 70],
  ]),
  // direct-function ramps
  jet: (t) => {
    t = Math.max(0, Math.min(1, t));
    let r, g, b;
    if (t < 0.25) { r = 0; g = t * 4; b = 1; }
    else if (t < 0.5) { r = 0; g = 1; b = 1 - (t - 0.25) * 4; }
    else if (t < 0.75) { r = (t - 0.5) * 4; g = 1; b = 0; }
    else { r = 1; g = 1 - (t - 0.75) * 4; b = 0; }
    return _rgb(r, g, b);
  },
  gray: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(t, t, t); },
  Greys: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(1 - t, 1 - t, 1 - t); },
  hot: (t) => {
    t = Math.max(0, Math.min(1, t));
    return _rgb(Math.min(1, t * 3), Math.max(0, t * 3 - 1), Math.max(0, t * 3 - 2));
  },
  cool: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(t, 1 - t, 1); },
  spring: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(1, t, 1 - t); },
  summer: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(t, 0.5 + t * 0.5, 0.4); },
  autumn: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(1, t, 0); },
  winter: (t) => { t = Math.max(0, Math.min(1, t)); return _rgb(0, t, 1 - 0.5 * t); },
  // Named reversed variants — matplotlib's `_r` suffix convention
  viridis_r: (t) => _cmaps.viridis(1 - t),
  plasma_r: (t) => _cmaps.plasma(1 - t),
  inferno_r: (t) => _cmaps.inferno(1 - t),
  magma_r: (t) => _cmaps.magma(1 - t),
  jet_r: (t) => _cmaps.jet(1 - t),
  gray_r: (t) => _cmaps.gray(1 - t),
};

// The ColorBrewer and matplotlib maps people name: diverging, sequential, qualitative.
// Hex anchors interpolate evenly (ColorBrewer's 9- and 11-class schemes); the qualitative ones
// are listed (one colour per equal bucket).
const _hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const _hexes = (s) => s.split(' ').map(_hex);
Object.assign(_cmaps, {
  RdBu: _lerpCmap(_hexes('#67001f #b2182b #d6604d #f4a582 #fddbc7 #f7f7f7 #d1e5f0 #92c5de #4393c3 #2166ac #053061')),
  RdYlBu: _lerpCmap(_hexes('#a50026 #d73027 #f46d43 #fdae61 #fee090 #ffffbf #e0f3f8 #abd9e9 #74add1 #4575b4 #313695')),
  RdYlGn: _lerpCmap(_hexes('#a50026 #d73027 #f46d43 #fdae61 #fee08b #ffffbf #d9ef8b #a6d96a #66bd63 #1a9850 #006837')),
  Spectral: _lerpCmap(_hexes('#9e0142 #d53e4f #f46d43 #fdae61 #fee08b #ffffbf #e6f598 #abdda4 #66c2a5 #3288bd #5e4fa2')),
  PiYG: _lerpCmap(_hexes('#8e0152 #c51b7d #de77ae #f1b6da #fde0ef #f7f7f7 #e6f5d0 #b8e186 #7fbc41 #4d9221 #276419')),
  BrBG: _lerpCmap(_hexes('#543005 #8c510a #bf812d #dfc27d #f6e8c3 #f5f5f5 #c7eae5 #80cdc1 #35978f #01665e #003c30')),
  Blues: _lerpCmap(_hexes('#f7fbff #deebf7 #c6dbef #9ecae1 #6baed6 #4292c6 #2171b5 #08519c #08306b')),
  Reds: _lerpCmap(_hexes('#fff5f0 #fee0d2 #fcbba1 #fc9272 #fb6a4a #ef3b2c #cb181d #a50f15 #67000d')),
  Greens: _lerpCmap(_hexes('#f7fcf5 #e5f5e0 #c7e9c0 #a1d99b #74c476 #41ab5d #238b45 #006d2c #00441b')),
  Oranges: _lerpCmap(_hexes('#fff5eb #fee6ce #fdd0a2 #fdae6b #fd8d3c #f16913 #d94801 #a63603 #7f2704')),
  Purples: _lerpCmap(_hexes('#fcfbfd #efedf5 #dadaeb #bcbddc #9e9ac8 #807dba #6a51a3 #54278f #3f007d')),
  YlOrRd: _lerpCmap(_hexes('#ffffcc #ffeda0 #fed976 #feb24c #fd8d3c #fc4e2a #e31a1c #bd0026 #800026')),
  YlOrBr: _lerpCmap(_hexes('#ffffe5 #fff7bc #fee391 #fec44f #fe9929 #ec7014 #cc4c02 #993404 #662506')),
  YlGnBu: _lerpCmap(_hexes('#ffffd9 #edf8b1 #c7e9b4 #7fcdbb #41b6c4 #1d91c0 #225ea8 #253494 #081d58')),
  YlGn: _lerpCmap(_hexes('#ffffe5 #f7fcb9 #d9f0a3 #addd8e #78c679 #41ab5d #238443 #006837 #004529')),
  bwr: _lerpCmap([[0, 0, 255], [255, 255, 255], [255, 0, 0]]),
  seismic: _lerpCmap([[0, 0, 77], [0, 0, 255], [255, 255, 255], [255, 0, 0], [128, 0, 0]]),
  // matplotlib's terrain: its segment anchors at 0, .15, .25, .5, .75, 1 (sampled evenly in fifths
  // would bend it; _segCmap keeps the anchors where matplotlib puts them)
  terrain: _segCmap([[0, 51, 51, 153], [0.15, 0, 153, 255], [0.25, 0, 204, 102], [0.5, 255, 255, 153], [0.75, 128, 92, 84], [1, 255, 255, 255]]),
});
const _QUAL = {
  tab10: '#1f77b4 #ff7f0e #2ca02c #d62728 #9467bd #8c564b #e377c2 #7f7f7f #bcbd22 #17becf',
  tab20: '#1f77b4 #aec7e8 #ff7f0e #ffbb78 #2ca02c #98df8a #d62728 #ff9896 #9467bd #c5b0d5 #8c564b #c49c94 #e377c2 #f7b6d2 #7f7f7f #c7c7c7 #bcbd22 #dbdb8d #17becf #9edae5',
  Set1: '#e41a1c #377eb8 #4daf4a #984ea3 #ff7f00 #ffff33 #a65628 #f781bf #999999',
  Set2: '#66c2a5 #fc8d62 #8da0cb #e78ac3 #a6d854 #ffd92f #e5c494 #b3b3b3',
  Set3: '#8dd3c7 #ffffb3 #bebada #fb8072 #80b1d3 #fdb462 #b3de69 #fccde5 #d9d9d9 #bc80bd #ccebc5 #ffed6f',
  Paired: '#a6cee3 #1f78b4 #b2df8a #33a02c #fb9a99 #e31a1c #fdbf6f #ff7f00 #cab2d6 #6a3d9a #ffff99 #b15928',
  Dark2: '#1b9e77 #d95f02 #7570b3 #e7298a #66a61e #e6ab02 #a6761d #666666',
};
for (const [k, v] of Object.entries(_QUAL)) _cmaps[k] = _listed(v.split(' '));

// a listed map (matplotlib's ListedColormap): [0, 1] splits into N equal buckets
function _listed(colors) {
  const n = colors.length;
  const f = (t) => (t !== t ? _NO_COLOR : colors[Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, Math.min(1, t)) * n)))]);
  f._listed = colors;
  f.N = n;
  return f;
}
// matplotlib's segment maps: [t, r, g, b] anchors at their own positions
function _segCmap(anchors) {
  return (t) => {
    if (t !== t) return _NO_COLOR;
    t = Math.max(0, Math.min(1, t));
    let k = 0;
    while (k < anchors.length - 2 && t > anchors[k + 1][0]) k++;
    const a = anchors[k], b = anchors[k + 1], f = (t - a[0]) / (b[0] - a[0] || 1);
    return `rgb(${[1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * f)).join(',')})`;
  };
}

// every map name plot knows, '_r' reversals included
const CMAP_NAMES = () => Object.keys(_cmaps).flatMap((k) => (k.endsWith('_r') ? [k] : [k, `${k}_r`]));


// a name, a function (t ∈ [0, 1] → colour), a list of colours (a listed map), or a
// ListedColormap / colormap object. An unknown name warns and draws viridis.
function getCmap(name) {
  if (typeof name === 'function') return name;
  if (Array.isArray(name)) return _listed(name);
  if (name && typeof name === 'object' && typeof name._fn === 'function') return name._fn;
  if (name == null) return _cmaps.viridis;
  if (_cmaps[name]) return _cmaps[name];
  const m = /^(.*)_r$/.exec(name);
  if (m && _cmaps[m[1]]) { const base = _cmaps[m[1]]; const r = (t) => base(1 - t); if (base._listed) { r._listed = base._listed.slice().reverse(); r.N = base.N; } _cmaps[name] = r; return r; }
  _warn('cmap.' + name, `no colour map '${name}'; using viridis. Known: ${Object.keys(_cmaps).filter((k) => !k.endsWith('_r')).join(', ')} (and each with _r)`);
  return _cmaps.viridis;
}

// matplotlib.colors.ListedColormap(colors, name?): a map of N listed colours, for discrete
// classes; with BoundaryNorm, one colour per class
class ListedColormap {
  constructor(colors, name = 'from_list') {
    this.colors = Array.from(colors, (c) => _cssColor(c));
    this.name = name;
    this.N = this.colors.length;
    this._fn = _listed(this.colors);
  }
  reversed() { return new ListedColormap(this.colors.slice().reverse(), this.name + '_r'); }
}
// LinearSegmentedColormap.from_list(name, colors): an even ramp through the colours
const LinearSegmentedColormap = {
  from_list(name, colors) {
    const stops = colors.map((c) => { const b = _colorBytes(_cssColor(Array.isArray(c) ? c[1] : c)); return b ? [b[0], b[1], b[2]] : [0, 0, 0]; });
    return { name, N: 256, _fn: _lerpCmap(stops) };
  },
};

function cmapRgb(name, t) {
  return getCmap(name)(t);
}

// ── colours as bytes ────────────────────────────────────────────────────────────────────────
// The raster paths (imshow, big scatters) write RGBA bytes, so they need a colour as numbers,
// not a 'rgb(…)' string, and no hot loop may build or parse strings. _colorBytes parses the
// forms plot and its callers use; _cmapLut samples a colour map into 256 RGBA entries once.

// matplotlib's single letters, its default cycle ('C0'…'C9', 'tab:blue'…), and the CSS names
// people actually type. A name not here can't be rasterized; those draws fall back to the
// vector path, which hands the string to the canvas as is.
const _NAMED = {
  // matplotlib's BASE_COLORS — color='r' used to reach the canvas as 'r', which it rejects
  b: '#0000ff', g: '#008000', r: '#ff0000', c: '#00bfbf', m: '#bf00bf', y: '#bfbf00', k: '#000000', w: '#ffffff',
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080', brown: '#a52a2a', pink: '#ffc0cb',
  gray: '#808080', grey: '#808080', olive: '#808000', navy: '#000080', teal: '#008080', maroon: '#800000',
  lime: '#00ff00', gold: '#ffd700', silver: '#c0c0c0', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b',
  steelblue: '#4682b4', skyblue: '#87ceeb', crimson: '#dc143c', tomato: '#ff6347', salmon: '#fa8072',
  coral: '#ff7f50', tan: '#d2b48c', khaki: '#f0e68c', indigo: '#4b0082', violet: '#ee82ee', orchid: '#da70d6',
  turquoise: '#40e0d0', slategray: '#708090', slategrey: '#708090', dimgray: '#696969', dimgrey: '#696969',
  darkorange: '#ff8c00', royalblue: '#4169e1', forestgreen: '#228b22', seagreen: '#2e8b57', firebrick: '#b22222',
  chocolate: '#d2691e', sienna: '#a0522d', beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa',
  transparent: 'rgba(0,0,0,0)', none: 'rgba(0,0,0,0)',
};
const _TAB10 = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
const _TABNAMES = ['blue', 'orange', 'green', 'red', 'purple', 'brown', 'pink', 'gray', 'olive', 'cyan'];
_TABNAMES.forEach((n, i) => { _NAMED['tab:' + n] = _TAB10[i]; _NAMED['C' + i] = _TAB10[i]; });
_NAMED['tab:grey'] = _TAB10[7];

// any colour plot accepts → [r, g, b, a] bytes (a 0–255), or null when it can't tell
function _colorBytes(c) {
  if (typeof c !== 'string') {
    // an RGB(A) tuple in 0–1, matplotlib's other colour form
    if ((Array.isArray(c) || ArrayBuffer.isView(c)) && (c.length === 3 || c.length === 4) && typeof c[0] === 'number') {
      const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
      return [f(c[0]), f(c[1]), f(c[2]), c.length === 4 ? f(c[3]) : 255];
    }
    return null;
  }
  const s = c.trim();
  const named = _NAMED[s] || _NAMED[s.toLowerCase()];
  if (named) return _colorBytes(named);
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [+m[1] | 0, +m[2] | 0, +m[3] | 0, m[4] == null ? 255 : Math.round(+m[4] * 255)];
  m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
  }
  return null;
}

// a colour the canvas can take: names it might not know become hex, tuples become rgba()
function _cssColor(c) {
  if (typeof c === 'string') { const n = _NAMED[c] || _NAMED[c.toLowerCase && c.toLowerCase()]; return n || c; }
  const b = _colorBytes(c);
  return b ? `rgba(${b[0]},${b[1]},${b[2]},${+(b[3] / 255).toFixed(4)})` : c;
}

// A colour map sampled into 256 RGBA entries, once per map (cached on the function).
// t in [0, 1] → entry Math.min(255, (t * 256) | 0). null when the map returns a colour
// _colorBytes can't read (a user function returning, say, 'hsl(…)'): callers then fall back
// to calling the map per value.
const _lutCache = new WeakMap();
function _cmapLut(cmap) {
  const fn = getCmap(cmap);
  if (_lutCache.has(fn)) return _lutCache.get(fn);
  const lut = new Uint8ClampedArray(256 * 4);
  let ok = true;
  for (let i = 0; i < 256 && ok; i++) {
    const b = _colorBytes(fn((i + 0.5) / 256));
    if (!b) { ok = false; break; }
    lut[i * 4] = b[0]; lut[i * 4 + 1] = b[1]; lut[i * 4 + 2] = b[2]; lut[i * 4 + 3] = b[3];
  }
  const out = ok ? lut : null;
  _lutCache.set(fn, out);
  return out;
}

function renderColorbar(ctx, x, y, w, h, cmap, vmin, vmax, opts) {
  const cmapFn = getCmap(cmap);
  const n = Math.max(1, Math.floor(h));
  for (let i = 0; i < n; i++) {
    const t = 1 - i / (n - 1);
    ctx.fillStyle = cmapFn(t);
    ctx.fillRect(x, y + i, w, Math.ceil(h / n) + 1);
  }
  // tick labels
  const textColor = opts?.textColor || 'currentColor';
  ctx.fillStyle = textColor;
  ctx.font = opts?.font || '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const nticks = opts?.nticks || 5;
  const fmt = opts?.format || ((v) => {
    const range = Math.abs(vmax - vmin);
    if (range === 0) return String(v);
    const mag = Math.log10(Math.max(Math.abs(vmin), Math.abs(vmax), 1e-30));
    if (mag > 6 || mag < -3) return v.toExponential(1);
    const dec = Math.max(0, -Math.floor(Math.log10(range)) + 1);
    return v.toFixed(Math.min(dec, 6));
  });
  for (let i = 0; i < nticks; i++) {
    const t = i / (nticks - 1);
    const val = vmin + (1 - t) * (vmax - vmin);
    const ty = y + t * h;
    ctx.fillText(fmt(val), x + w + 4, ty);
  }
  // label
  if (opts?.label) {
    ctx.save();
    if (opts.labelFont) ctx.font = opts.labelFont;
    ctx.translate(x + (opts.labelOffset ?? w + 40), y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.label, 0, 0);
    ctx.restore();
  }
}

// -- norm.js --

// Colour normalisation (matplotlib.colors' norms) and the colorbar.
//
// A norm maps a data value to t ∈ [0, 1] along the colour map: Normalize (linear), LogNorm,
// TwoSlopeNorm (diverging about a centre), CenteredNorm, BoundaryNorm (discrete classes).
// Every colour-mapped trace — scatter, imshow, pcolormesh, contour(f) — resolves ONE norm per
// render (its vmin / vmax filled from the data where not given), and the colorbar draws that
// same norm, so the bar can't disagree with the plot.




const _log10 = Math.log10;

class Normalize {
  constructor(vmin = null, vmax = null, clip = false) {
    if (vmin && typeof vmin === 'object') ({ vmin = null, vmax = null, clip = false } = vmin);
    this.vmin = vmin; this.vmax = vmax; this.clip = clip;
  }
  // data → t (outside [0, 1] when the value is; NaN: no colour)
  call(v) { const d = this.vmax - this.vmin; return d ? (v - this.vmin) / d : 0.5; }
  inverse(t) { return this.vmin + t * (this.vmax - this.vmin); }
  get scaled() { return this.vmin != null && this.vmax != null; }
  // a copy with the missing ends filled (the data's range); norms given by the caller are
  // never changed, so one norm can serve several figures
  _resolved(lo, hi) { const n = Object.create(Object.getPrototypeOf(this)); Object.assign(n, this); if (n.vmin == null) n.vmin = lo; if (n.vmax == null) n.vmax = hi; return n; }
  get _key() { return `${this.constructor.name}|${this.vmin}|${this.vmax}`; }
  _ticks(n) { const t = _niceTicks(Math.min(this.vmin, this.vmax), Math.max(this.vmin, this.vmax), n); return { values: Array.from(t), labels: _fmtStep(Array.from(t), t.step || 1) }; }
}

class LogNorm extends Normalize {
  call(v) {
    if (!(v > 0)) return NaN;
    const a = _log10(this.vmin), b = _log10(this.vmax);
    return b - a ? (_log10(v) - a) / (b - a) : 0.5;
  }
  inverse(t) { const a = _log10(this.vmin), b = _log10(this.vmax); return Math.pow(10, a + t * (b - a)); }
  _ticks() {
    const lo = Math.ceil(_log10(this.vmin) - 1e-9), hi = Math.floor(_log10(this.vmax) + 1e-9);
    const values = [];
    for (let e = lo; e <= hi; e++) values.push(Math.pow(10, e));
    if (values.length < 2) for (const m of [2, 5]) for (let e = lo - 1; e <= hi; e++) { const v = m * Math.pow(10, e); if (v >= this.vmin && v <= this.vmax) values.push(v); }
    values.sort((a, b) => a - b);
    return { values, labels: values.map((v) => { const e = Math.round(_log10(v)); return Math.abs(Math.pow(10, e) - v) < v * 1e-9 && (e < -3 || e > 4) ? `1e${e}` : String(+v.toPrecision(6)); }) };
  }
}

// diverging about vcenter: each side spans half the map
class TwoSlopeNorm extends Normalize {
  constructor(vcenter, vmin = null, vmax = null) {
    if (vcenter && typeof vcenter === 'object') ({ vcenter, vmin = null, vmax = null } = vcenter);
    super(vmin, vmax);
    this.vcenter = +vcenter;
  }
  call(v) {
    const c = this.vcenter;
    if (v < c) return c - this.vmin ? 0.5 * (v - this.vmin) / (c - this.vmin) : 0.5;
    return this.vmax - c ? 0.5 + 0.5 * (v - c) / (this.vmax - c) : 0.5;
  }
  inverse(t) { const c = this.vcenter; return t < 0.5 ? this.vmin + (t / 0.5) * (c - this.vmin) : c + ((t - 0.5) / 0.5) * (this.vmax - c); }
  _resolved(lo, hi) { const n = super._resolved(Math.min(lo, this.vcenter), Math.max(hi, this.vcenter)); return n; }
  get _key() { return `TwoSlope|${this.vmin}|${this.vcenter}|${this.vmax}`; }
}

// symmetric about vcenter: halfrange from the data's furthest value unless given
class CenteredNorm extends Normalize {
  constructor(vcenter = 0, halfrange = null) {
    if (vcenter && typeof vcenter === 'object') ({ vcenter = 0, halfrange = null } = vcenter);
    super(); this.vcenter = +vcenter; this.halfrange = halfrange;
  }
  _resolved(lo, hi) {
    const n = Object.create(CenteredNorm.prototype); Object.assign(n, this);
    const h = this.halfrange != null ? +this.halfrange : Math.max(Math.abs(lo - this.vcenter), Math.abs(hi - this.vcenter)) || 1;
    n.vmin = this.vcenter - h; n.vmax = this.vcenter + h;
    return n;
  }
}

// discrete classes: the value's bin among `boundaries` picks one of `ncolors` colours spread
// along the map (ncolors = the listed map's N for one colour per class)
class BoundaryNorm extends Normalize {
  constructor(boundaries, ncolors = 256, clip = false) {
    if (boundaries && !Array.isArray(boundaries) && !ArrayBuffer.isView(boundaries) && typeof boundaries === 'object') ({ boundaries, ncolors = 256, clip = false } = boundaries);
    const b = Array.from(boundaries, Number);
    if (b.length < 2) throw new Error('plot: BoundaryNorm needs at least two boundaries');
    super(b[0], b[b.length - 1], clip);
    this.boundaries = b; this.ncolors = ncolors;
  }
  // the class index of a value: 0 … nb-1; below / above the boundaries take the end classes
  _bin(v) {
    const b = this.boundaries, nb = b.length - 1;
    if (v < b[0]) return -1;
    if (v >= b[nb]) return v === b[nb] ? nb - 1 : nb;
    let lo = 0, hi = nb - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= v) lo = m; else hi = m - 1; }
    return lo;
  }
  call(v) {
    if (v !== v) return NaN;
    const nb = this.boundaries.length - 1;
    const i = Math.max(0, Math.min(nb - 1, this._bin(v)));
    const idx = nb > 1 ? Math.round((i * (this.ncolors - 1)) / (nb - 1)) : (this.ncolors - 1) / 2;
    return (idx + 0.5) / this.ncolors;
  }
  inverse(t) { return this.boundaries[0] + t * (this.boundaries[this.boundaries.length - 1] - this.boundaries[0]); }
  _resolved() { return this; }
  get _key() { return `Boundary|${this.boundaries.join(',')}|${this.ncolors}`; }
  _ticks() { const v = this.boundaries.slice(); let step = Infinity; for (let i = 1; i < v.length; i++) step = Math.min(step, Math.abs(v[i] - v[i - 1])); return { values: v, labels: _fmtStep(v, step) }; }
}

// a norm option (an instance, 'linear', 'log') with vmin / vmax and the data's range → the norm
// this render uses
function _resolveNorm(norm, vmin, vmax, lo, hi, minPos) {
  if (norm === 'log') norm = new LogNorm();
  else if (norm === 'linear' || norm == null) norm = new Normalize();
  else if (typeof norm === 'string') throw new Error(`plot: norm '${norm}' is not supported; use a Normalize, LogNorm, TwoSlopeNorm, CenteredNorm or BoundaryNorm, or 'linear' / 'log'`);
  const n = norm._resolved(norm instanceof LogNorm ? (minPos ?? lo) : lo, hi);
  if (vmin != null && !(norm instanceof BoundaryNorm)) n.vmin = +vmin;
  if (vmax != null && !(norm instanceof BoundaryNorm)) n.vmax = +vmax;
  if (n.vmin === n.vmax && !(n instanceof BoundaryNorm)) { n.vmin -= 0.5; n.vmax += 0.5; }
  return n;
}

// value → LUT index 0–255, -1 for no colour; the linear case inlined (the hot loops call this
// for every point or cell)
function _indexer(norm) {
  if (norm.constructor === Normalize) {
    const lo = norm.vmin, k = norm.vmax !== norm.vmin ? 256 / (norm.vmax - norm.vmin) : 0;
    return (v) => { if (v !== v) return -1; const q = k ? ((v - lo) * k) | 0 : 128; return q < 0 ? 0 : q > 255 ? 255 : q; };
  }
  return (v) => { if (v !== v) return -1; const t = norm.call(v); if (t !== t) return -1; const q = (t * 256) | 0; return q < 0 ? 0 : q > 255 ? 255 : q; };
}

// ── the colorbar ──
// the ticks a colorbar of height h draws: given ticks, or the norm's own
function _cbTicks(norm, h, opts) {
  let ticks;
  if (opts.ticks != null) {
    const v = Array.from(opts.ticks, Number);
    let step = Infinity; for (let i = 1; i < v.length; i++) step = Math.min(step, Math.abs(v[i] - v[i - 1]));
    ticks = { values: v, labels: _fmtStep(v, step === Infinity ? 1 : step) };
  } else ticks = norm._ticks(Math.max(2, Math.floor(h / 32) + 1));
  if (opts.format) {
    const f = opts.format;
    ticks.labels = ticks.values.map((v) => (typeof f === 'function' ? String(f(v)) : _cbFmt(f, v)));
  }
  return ticks;
}
function _cbFmt(f, v) {
  const m = /%[-+ 0#]*\d*(?:\.(\d+))?([dfgeE%])/.exec(f);
  if (m) {
    const p = m[1] == null ? null : +m[1];
    const s = m[2] === 'd' ? String(Math.round(v)) : m[2] === 'f' ? v.toFixed(p ?? 6) : m[2] === 'e' || m[2] === 'E' ? v.toExponential(p ?? 6) : m[2] === '%' ? (v * 100).toFixed(p ?? 0) + '%' : String(+v.toPrecision(p || 6));
    return f.replace(m[0], s);
  }
  const b = /\{(?:[^:}]*):?(,?)(?:\.(\d+))?([fgde%]?)\}/.exec(f);
  if (b) {
    const p = b[2] == null ? null : +b[2];
    let s = b[3] === 'f' ? v.toFixed(p ?? 6) : b[3] === 'e' ? v.toExponential(p ?? 6) : b[3] === 'd' ? String(Math.round(v)) : b[3] === '%' ? (v * 100).toFixed(p ?? 0) + '%' : String(+v.toPrecision(p || 6));
    if (b[1]) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d != null ? '.' + d : ''); }
    return f.replace(b[0], s);
  }
  return String(v);
}
function _cbLabelsW(ticks, font) { return ticks.labels.reduce((m, s) => Math.max(m, _textW(font, s)), 0); }

// draw a vertical colorbar in [x, y, w, h]: the map through the norm (bands for BoundaryNorm
// and listed maps), extend triangles at the ends, ticks and labels on the right, the label
// rotated beyond them
function _drawColorbar(ctx, x, y, w, h, cmap, norm, ticks, opts) {
  const fn = getCmap(cmap), lut = _cmapLut(cmap);
  const colorAt = (t) => {
    if (lut) { const q = Math.max(0, Math.min(255, (t * 256) | 0)) * 4; return `rgb(${lut[q]},${lut[q + 1]},${lut[q + 2]})`; }
    return fn(t);
  };
  const ext = opts.extend || 'neither';
  const tri = Math.min(w * 1.2, h * 0.06);
  const top = ext === 'max' || ext === 'both' ? tri : 0, bot = ext === 'min' || ext === 'both' ? tri : 0;
  const by = y + top, bh = h - top - bot;
  // where a value sits along the bar: discrete classes stand evenly (matplotlib's 'uniform')
  const discrete = norm instanceof BoundaryNorm;
  const posOf = (v) => {
    if (discrete) {
      const b = norm.boundaries, nb = b.length - 1;
      let i = 0; while (i < nb - 1 && v > b[i + 1]) i++;
      const f = (v - b[i]) / (b[i + 1] - b[i] || 1);
      return by + bh * (1 - (i + Math.max(0, Math.min(1, f))) / nb);
    }
    const t = norm.call(v);
    return by + bh * (1 - t);
  };
  if (discrete) {
    const b = norm.boundaries, nb = b.length - 1;
    for (let i = 0; i < nb; i++) {
      ctx.fillStyle = opts.bandColors ? opts.bandColors[i] : colorAt(norm.call((b[i] + b[i + 1]) / 2));
      const y0 = by + bh * (1 - (i + 1) / nb);
      ctx.fillRect(x, y0, w, bh / nb + 0.5);
    }
  } else {
    const n = Math.max(1, Math.floor(bh));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colorAt(1 - (i + 0.5) / n);
      ctx.fillRect(x, by + (i * bh) / n, w, bh / n + 0.6);
    }
  }
  // the ends beyond the norm: matplotlib's extend arrows, in the end colours
  if (top) { ctx.fillStyle = opts.extColors ? opts.extColors[1] : colorAt(1); ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, by); ctx.closePath(); ctx.fill(); }
  if (bot) { ctx.fillStyle = opts.extColors ? opts.extColors[0] : colorAt(0); ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x + w, by + bh); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = opts.frameColor; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, by); if (top) ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, by);
  ctx.lineTo(x + w, by + bh); if (bot) ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, by + bh); ctx.closePath();
  ctx.stroke();
  // ticks
  ctx.fillStyle = opts.textColor; ctx.font = opts.font;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = opts.frameColor;
  const lo = Math.min(norm.vmin, norm.vmax), hi = Math.max(norm.vmin, norm.vmax);
  for (let i = 0; i < ticks.values.length; i++) {
    const v = ticks.values[i];
    if (!(v >= lo - Math.abs(hi - lo) * 1e-9 && v <= hi + Math.abs(hi - lo) * 1e-9)) continue;
    const py = posOf(v);
    if (py - py !== 0) continue;
    ctx.beginPath(); ctx.moveTo(x + w, py); ctx.lineTo(x + w + 3, py); ctx.stroke();
    ctx.fillText(ticks.labels[i], x + w + 5, py);
  }
  if (opts.label) {
    ctx.save();
    ctx.font = opts.labelFont || opts.font;
    ctx.translate(x + w + 5 + opts.labelsW + 6, y + h / 2);
    ctx.rotate(-Math.PI / 2);                              // reads bottom to top, like a ylabel
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(opts.label, 0, 0);
    ctx.restore();
  }
}
void _colorBytes;

// -- format.js --

// Format string parser: 'r--o' → { color, linestyle, marker }
//
// matplotlib's fmt is '[marker][line][color]' in ANY order ('o-', 'ro', '--r', 'k.' are all
// valid), and a format with a marker but no line style draws MARKERS ONLY: plot(x, y, 'o') is
// a scatter of dots, not a line through them. Both rules are what a model writing matplotlib
// from memory expects.


// matplotlib's single-letter colours, exactly (M2: they were a softened palette, a departure a
// model writing 'r--' from memory wouldn't expect); the same as color='r' (color.js)
const _colorChars = { b: '#0000ff', g: '#008000', r: '#ff0000', c: '#00bfbf', m: '#bf00bf', y: '#bfbf00', k: '#000000', w: '#ffffff' };
const _markerChars = new Set(['o', 's', '^', 'v', '<', '>', 'd', 'D', 'p', 'h', '*', '+', 'x', '.']);

function parseFormat(fmt) {
  if (!fmt || typeof fmt !== 'string') return {};
  const result = {};
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (fmt.startsWith('--', i)) { result.linestyle = '--'; i += 2; continue; }
    if (fmt.startsWith('-.', i)) { result.linestyle = '-.'; i += 2; continue; }
    if (ch === '-' || ch === ':') { result.linestyle = ch; i++; continue; }
    // 'C0'…'C9': the default colour cycle by index
    if (ch === 'C' && /\d/.test(fmt[i + 1] || '')) { result.color = 'C' + fmt[i + 1]; i += 2; continue; }
    if (_markerChars.has(ch)) { result.marker = ch; i++; continue; }
    if (_colorChars[ch]) { result.color = _colorChars[ch]; i++; continue; }
    _warn('fmt.' + fmt, `plot(): format string '${fmt}' has '${ch}', which is not a colour, marker or line style; it was ignored`);
    i++;
  }
  if (result.marker && !result.linestyle) result.linestyle = 'None';
  return result;
}

function dashArray(linestyle) {
  switch (linestyle) {
    case '--': case 'dashed': return [6, 4];
    case '-.': case 'dashdot': return [6, 2, 2, 2];
    case ':': case 'dotted': return [2, 3];
    default: return [];
  }
}

// no line at all: matplotlib's 'None' / 'none' / '' / ' '
function _noLine(linestyle) {
  return linestyle === 'None' || linestyle === 'none' || linestyle === '' || linestyle === ' ';
}

// -- pyfmt.js --

// Python's number formatting, the parts a matplotlib user writes: str.format templates
// ('{x:,.0f}', '{:.1%}', '{x} m', '{pos}') and %-formatting ('%.2f', '%d', '%5.1e'). Tick
// formatters (StrMethodFormatter, FormatStrFormatter, a plain string to set_major_formatter)
// and bar_label read them. Deterministic: no locale, the same text in every host.
//
// The format spec: [[fill]align][sign][#][0][width][grouping][.precision][type]
//   align < > ^ =  ·  sign + - space  ·  grouping , or _  ·  type d i n f F e E g G % s x X o b c
//   no type: a float prints as Python's repr would (1.0, 2.5, 1e-05)

// Python's repr of a float, near enough: integers keep '.0'; exponents have two digits
function _pyRepr(v) {
  if (typeof v !== 'number') return String(v);
  if (v !== v) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
  const a = Math.abs(v);
  if (a >= 1e16 || a < 1e-4) return _expo(v.toExponential().replace(/\.?0+e/, 'e'));
  return String(v);
}
// toFixed as Python rounds: an EXACT binary tie goes to the even digit ('{:.0f}' of 1234.5 is
// '1234'); everything else is already the nearest (2.675 is 2.67499… in binary, in both)
// The tie is tested on the double's EXACT value (mantissa × 2^e, in BigInt): a × 10^p
// computed in floating point can land on .5 when the true value doesn't (2.675 × 100).
const _dv = new DataView(new ArrayBuffer(8));
function _fixed(a, p) {
  if (!(a >= 0) || a === Infinity || p > 20) return a.toFixed(Math.min(p, 100));
  // past 1e21 toFixed writes an exponent; Python writes the digits (a double that big is an integer)
  if (a >= 1e21) return BigInt(a).toString() + (p ? '.' + '0'.repeat(p) : '');
  _dv.setFloat64(0, a);
  const hi = _dv.getUint32(0), lo = _dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  if (be === 0) return a.toFixed(p);                       // zero and subnormals: no ties there
  const mant = (BigInt(hi & 0xfffff) << 32n | BigInt(lo)) | (1n << 52n);
  const shift = be - 1075 + 1 + p;                         // 2 × a × 10^p = mant × 5^p × 2^shift
  let n = mant * 5n ** BigInt(p);
  if (shift >= 0) n <<= BigInt(shift);
  else { const d = 1n << BigInt(-shift); if (n % d !== 0n) return a.toFixed(p); n /= d; }
  if (n % 2n === 0n) return a.toFixed(p);                  // an integer number of half-units, even: no tie
  const q = (n - 1n) / 2n, m = q % 2n === 0n ? q : q + 1n; // the tie: to the even neighbour
  const s = m.toString().padStart(p + 1, '0');
  return p ? `${s.slice(0, -p)}.${s.slice(-p)}` : s;
}
// JS writes e+6; Python e+06
const _expo = (s) => s.replace(/e([+-])(\d)$/, 'e$10$2');

function _group(intPart, sep) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

// one value through one spec (the part after ':' in '{x:...}')
function _formatSpec(v, spec) {
  const m = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec || '');
  if (!m) throw new Error(`plot: '${spec}' is not a format spec plot knows (the Python subset: [[fill]align][sign][#][0][width][,][.precision][type])`);
  let [, fill, align, sign, alt, zero, width, grouping, prec, type] = m;
  prec = prec == null ? null : +prec;
  width = width == null ? 0 : +width;
  if (zero && !align) { fill = '0'; align = '='; }
  if (typeof v !== 'number') {
    let s = String(v);
    if (prec != null) s = s.slice(0, prec);
    return _pad(s, '', width, fill || ' ', align || '<');
  }
  const neg = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  let body;
  if (a !== a) body = 'nan';
  else if (a === Infinity) body = 'inf';
  else switch (type) {
    case 'd': case 'i': case 'n': body = String(Math.round(a)); break;
    case 'f': case 'F': body = _fixed(a, prec ?? 6); break;
    case 'e': case 'E': body = _expo(a.toExponential(prec ?? 6)); break;
    case '%': body = _fixed(a * 100, prec ?? 6) + '%'; break;
    case 'g': case 'G': body = _gfmt(a, prec ?? 6, !!alt); break;
    case 'x': case 'X': body = Math.round(a).toString(16); break;
    case 'o': body = Math.round(a).toString(8); break;
    case 'b': body = Math.round(a).toString(2); break;
    case 'c': body = String.fromCharCode(Math.round(a)); break;
    case 's': body = _pyRepr(a); break;
    default: body = prec != null ? _gfmt(a, prec, false, true) : _pyRepr(a);
  }
  if (type === 'E' || type === 'G' || type === 'F' || type === 'X') body = body.toUpperCase();
  if (grouping && /^\d/.test(body)) {
    const i = body.search(/[.e%]/);
    const ip = i < 0 ? body : body.slice(0, i), rest = i < 0 ? '' : body.slice(i);
    body = _group(ip, grouping) + rest;
  }
  const sgn = neg && body !== 'nan' ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  return _pad(body, sgn, width, fill || ' ', align || '>');
}

// Python's 'g': p significant digits, fixed or exponent by the exponent, zeros stripped;
// noType: the empty type with a precision (like g, but keeps at least one decimal)
function _gfmt(a, p, alt, noType) {
  if (p === 0) p = 1;
  if (a === 0) return alt ? (0).toFixed(p - 1) : noType ? '0.0' : '0';
  const exp = Math.floor(Math.log10(a));
  let s;
  if (exp >= -4 && exp < p) {
    s = _fixed(a, Math.max(0, p - 1 - exp));
    // rounding can carry into a new digit (9.99 → 10.0): toFixed handles it; strip zeros
    if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    if (noType && !s.includes('.')) s += '.0';
  } else {
    s = a.toExponential(p - 1);
    if (!alt) s = s.replace(/\.?0+e/, 'e');
    s = _expo(s);
  }
  return s;
}

function _pad(body, sgn, width, fill, align) {
  const n = body.length + sgn.length;
  if (n >= width) return sgn + body;
  const k = width - n;
  if (align === '=') return sgn + fill.repeat(k) + body;
  if (align === '<') return sgn + body + fill.repeat(k);
  if (align === '^') { const l = Math.floor(k / 2); return fill.repeat(l) + sgn + body + fill.repeat(k - l); }
  return fill.repeat(k) + sgn + body;
}

// a str.format template: '{x:,.0f} m', '{:.1%}', '{0}', '{pos}'. `named` gives the fields
// ({x, pos}); bare and numbered fields take `args` in order.
function pyFormat(template, named, ...args) {
  let auto = 0;
  return String(template).replace(/\{\{|\}\}|\{([^{}:!]*)(?:![rsa])?(?::([^{}]*))?\}/g, (whole, field, spec) => {
    if (whole === '{{') return '{';
    if (whole === '}}') return '}';
    let v;
    if (field === '' || field == null) v = args.length ? args[auto++] : named && named.x;
    else if (/^\d+$/.test(field)) v = args.length ? args[+field] : named && named.x;
    else if (named && field in named) v = named[field];
    else throw new Error(`plot: '{${field}}' has nothing to fill it (the fields are ${named ? Object.keys(named).map((k) => `{${k}}`).join(', ') : 'positional'})`);
    // pos is matplotlib's tick index, an int: it prints as one
    if (field === 'pos' && Number.isInteger(v) && !spec) return String(v);
    return spec ? _formatSpec(v, spec) : (typeof v === 'number' ? _pyRepr(v) : String(v));
  });
}

// %-formatting: '%.2f', '%d', '%5.1e', '%s', '%%' — one value
function pctFormat(fmt, v) {
  return String(fmt).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([diouxXeEfFgGcrs%])/g, (whole, flags, width, prec, type) => {
    if (type === '%') return '%';
    let align = flags.includes('-') ? '<' : '>';
    let spec = '';
    if (flags.includes('0') && !flags.includes('-')) spec += '0';
    if (width) spec += width;
    if (prec != null) spec += '.' + prec;
    const t = type === 'i' || type === 'u' ? 'd' : type === 'r' || type === 's' ? 's' : type;
    spec += t;
    const sign = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    // %s is str(v): Python's repr of a float ('%s' % 1.0 is '1.0')
    if (t === 's') return _formatSpec(typeof v === 'number' ? _pyRepr(v) : v, (align === '<' ? '<' : '') + (width || ''));
    // %d truncates toward zero ('%d' % 2.7 is '2'), unlike {:d}, which refuses a float
    const val = t === 'd' && typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : v;
    return _formatSpec(val, (align === '<' ? '<' : '') + sign + spec);
  });
}

// -- ticker.js --

// matplotlib.ticker and matplotlib.dates, the parts people reach for (spec tier 2):
//
//   ax.xaxis.set_major_formatter('{x:,.0f} m')             // a str → StrMethodFormatter
//   ax.xaxis.set_major_formatter((x, pos) => …)            // a function → FuncFormatter
//   ax.yaxis.set_major_formatter(new ticker.PercentFormatter(1))
//   ax.xaxis.set_major_locator(new ticker.MultipleLocator(50))
//   ax.minorticks_on() · ax.xaxis.set_minor_locator(new ticker.AutoMinorLocator(4))
//   ax.plot(dates, y)                                       // Date objects: a date axis
//   ax.xaxis.set_major_formatter(new dates.DateFormatter('%b %Y'))
//
// Locators give tick values for a range: tick_values(vmin, vmax, ctx). Formatters give each
// tick its label: format(value, pos, ctx), ctx = { step, values, range }. Both live on the axes'
// Axis objects (ax.xaxis, ax.yaxis); shared axes (subplots(sharex)) share them, as matplotlib's do.
//
// Dates are milliseconds since 1970-01-01 UTC — JavaScript's own number for a Date
// (matplotlib counts days; plot counts what Date.getTime() returns). Calendar ticks and labels
// are computed in UTC, so a figure is the same in every host whatever its time zone.



// ── formatters ──
class Formatter { format(v) { return String(v); } }
class ScalarFormatter extends Formatter {
  format(v, pos, ctx) { return _fmtStep([v], (ctx && ctx.step) || Math.abs(v) || 1)[0]; }
}
class NullFormatter extends Formatter { format() { return ''; } }
class FuncFormatter extends Formatter {
  constructor(func) { super(); if (typeof func !== 'function') throw new TypeError('FuncFormatter(func): func(x, pos) → str'); this.func = func; }
  format(v, pos) { const s = this.func(v, pos); return s == null ? '' : String(s); }
}
class StrMethodFormatter extends Formatter {
  constructor(fmt) { super(); this.fmt = String(fmt); }
  format(v, pos) { return pyFormat(this.fmt, { x: v, pos }); }
}
class FormatStrFormatter extends Formatter {
  constructor(fmt) { super(); this.fmt = String(fmt); }
  format(v) { return pctFormat(this.fmt, v); }
}
class FixedFormatter extends Formatter {
  constructor(seq) { super(); this.seq = Array.from(seq, String); }
  format(v, pos) { return pos != null && pos < this.seq.length ? this.seq[pos] : ''; }
}
// PercentFormatter(xmax = 100, decimals = null, symbol = '%'): xmax is 100 % (1 for fractions).
// decimals null: as many as the view's range needs (matplotlib's rule)
class PercentFormatter extends Formatter {
  constructor(xmax = 100, decimals = null, symbol = '%') {
    super();
    if (xmax && typeof xmax === 'object' && !Array.isArray(xmax)) ({ xmax = 100, decimals = null, symbol = '%' } = xmax);
    this.xmax = +xmax; this.decimals = decimals; this.symbol = symbol == null ? '' : String(symbol);
  }
  format(v, pos, ctx) {
    const pct = (v / this.xmax) * 100;
    let d = this.decimals;
    if (d == null) {
      const r = ctx && ctx.range ? (ctx.range / this.xmax) * 100 : 0;
      d = r <= 0 ? 0 : Math.max(0, Math.min(5, Math.ceil(2 - Math.log10(2 * r))));
    }
    return _formatSpec(pct, `.${d}f`) + this.symbol;
  }
}
// EngFormatter(unit = '', places = null): SI prefixes, 12.3 k
const _SI = { '-24': 'y', '-21': 'z', '-18': 'a', '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T', 15: 'P', 18: 'E', 21: 'Z', 24: 'Y' };
class EngFormatter extends Formatter {
  constructor(unit = '', places = null, sep = ' ') {
    super();
    if (unit && typeof unit === 'object') ({ unit = '', places = null, sep = ' ' } = unit);
    this.unit = unit; this.places = places; this.sep = sep;
  }
  format(v) {
    if (v === 0) return `0${this.unit ? this.sep + this.unit : ''}`;
    let e = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
    e = Math.max(-24, Math.min(24, e));
    const m = v / Math.pow(10, e);
    const s = this.places == null ? String(+m.toPrecision(6)) : _formatSpec(m, `.${this.places}f`);
    const suf = _SI[e] + this.unit;
    return suf ? `${s}${this.sep}${suf}` : s;
  }
}

// ── locators ──
class Locator { tick_values(lo, hi) { return _niceTicks(lo, hi, 6); } }
class NullLocator extends Locator { tick_values() { return []; } }
class FixedLocator extends Locator {
  constructor(locs) { super(); this.locs = Array.from(locs, Number); }
  tick_values(lo, hi) { return this.locs.filter((v) => v >= lo && v <= hi); }
}
// every multiple of base (+ offset) in the view
class MultipleLocator extends Locator {
  constructor(base = 1, offset = 0) { super(); this.base = +base; this.offset = +offset; if (!(this.base > 0)) throw new RangeError('MultipleLocator(base): base > 0'); }
  tick_values(lo, hi) {
    const b = this.base, o = this.offset;
    const a = Math.ceil((lo - o) / b - 1e-9), z = Math.floor((hi - o) / b + 1e-9);
    if (z - a > 2000) return _niceTicks(lo, hi, 10);    // a base far too fine for the view
    const out = [];
    for (let k = a; k <= z; k++) out.push(+(k * b + o).toPrecision(12));
    out.step = b;
    return out;
  }
}
// MaxNLocator(nbins = 'auto' | n, {integer, steps}): at most nbins intervals of a round step
class MaxNLocator extends Locator {
  constructor(nbins = 'auto', opts) {
    super();
    if (nbins && typeof nbins === 'object') { opts = nbins; nbins = opts.nbins ?? 'auto'; }
    const o = opts || {};
    this.nbins = nbins; this.integer = !!o.integer;
  }
  tick_values(lo, hi, ctx) {
    const n = this.nbins === 'auto' ? (ctx && ctx.count) || 9 : +this.nbins + 1;
    let t = _niceTicks(lo, hi, n);
    if (this.integer && t.step < 1) {
      const out = []; for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) out.push(k);
      out.step = 1;
      t = out.length > n ? new MultipleLocator(Math.ceil((hi - lo) / Math.max(1, n - 1))).tick_values(lo, hi) : out;
    }
    return t;
  }
}
// AutoMinorLocator(n): n intervals between majors (5 for a step of 1, 2.5 or 5 × 10^k, else 4)
class AutoMinorLocator extends Locator {
  constructor(n = null) { super(); this.n = n; }
  tick_values(lo, hi, ctx) {
    const majors = (ctx && ctx.majors) || [];
    if (ctx && ctx.log) return _logMinors(lo, hi);
    if (majors.length < 2) return [];
    const step = Math.abs(majors[1] - majors[0]);
    let n = this.n;
    if (n == null) { const m = step / Math.pow(10, Math.floor(Math.log10(step))); n = [1, 2.5, 5, 10].some((q) => Math.abs(m - q) < 1e-9) ? 5 : 4; }
    const d = step / n, out = [];
    const first = Math.min(...majors);
    const a = Math.ceil((lo - first) / d - 1e-9), z = Math.floor((hi - first) / d + 1e-9);
    if (z - a > 4000) return [];
    for (let k = a; k <= z; k++) { if (((k % n) + n) % n === 0) continue; out.push(+(first + k * d).toPrecision(12)); }
    return out;
  }
}
// a log axis's minor ticks: 2 … 9 × each decade
function _logMinors(lo, hi) {
  const out = [];
  if (!(lo > 0) || !(hi > lo)) return out;
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)) && out.length < 2000; e++) {
    for (let m = 2; m <= 9; m++) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(+v.toPrecision(12)); }
  }
  return out;
}
// LogLocator(base = 10): the decades
class LogLocator extends Locator {
  constructor(base = 10) { super(); this.base = +base; }
  tick_values(lo, hi) {
    const b = this.base, out = [];
    if (!(lo > 0)) lo = hi / 1e6;
    for (let e = Math.ceil(Math.log(lo) / Math.log(b) - 1e-9); Math.pow(b, e) <= hi * (1 + 1e-9) && out.length < 400; e++) out.push(+Math.pow(b, e).toPrecision(12));
    return out;
  }
}

// ── dates ──
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const p2 = (n) => String(n).padStart(2, '0');

// strftime, the usual codes, in UTC: %Y %y %m %d %e %H %I %M %S %f %p %b %B %a %A %j %%
function strftime(ms, fmt) {
  const d = new Date(ms);
  if (!(ms - ms === 0)) return '';
  return String(fmt).replace(/%([YymdeHIMSfpbBaAj%])/g, (_, c) => {
    switch (c) {
      case 'Y': return String(d.getUTCFullYear());
      case 'y': return p2(d.getUTCFullYear() % 100);
      case 'm': return p2(d.getUTCMonth() + 1);
      case 'd': return p2(d.getUTCDate());
      case 'e': return String(d.getUTCDate()).padStart(2, ' ');
      case 'H': return p2(d.getUTCHours());
      case 'I': return p2(((d.getUTCHours() + 11) % 12) + 1);
      case 'M': return p2(d.getUTCMinutes());
      case 'S': return p2(d.getUTCSeconds());
      case 'f': return String(Math.round(((ms % SEC) + SEC) % SEC * 1000)).padStart(6, '0');
      case 'p': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      case 'b': return _MON[d.getUTCMonth()];
      case 'B': return _MONTH[d.getUTCMonth()];
      case 'a': return _DAYN[d.getUTCDay()];
      case 'A': return _DAYNAME[d.getUTCDay()];
      case 'j': return String(Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1).padStart(3, '0');
      default: return '%';
    }
  });
}

// the calendar steps a date axis chooses from, finest first: [unit, step, typical ms]
const _DATE_STEPS = [
  ...[1, 2, 5, 10, 15, 30].map((s) => ['second', s, s * SEC]),
  ...[1, 2, 5, 10, 15, 30].map((s) => ['minute', s, s * MIN]),
  ...[1, 2, 3, 6, 12].map((s) => ['hour', s, s * HOUR]),
  ...[1, 2, 7, 14].map((s) => ['day', s, s * DAY]),
  ...[1, 2, 3, 6].map((s) => ['month', s, s * 30.44 * DAY]),
  ...[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map((s) => ['year', s, s * 365.25 * DAY]),
];
// ticks for one calendar step (UTC): seconds to hours on multiples since the epoch's midnight;
// days on the month's days 1, 1 + step, … (7 → 1, 8, 15, 22, 29); months on Jan + k·step;
// years on multiples of step
function _dateTicksAt(unit, step, lo, hi) {
  const out = [];
  if (unit === 'second' || unit === 'minute' || unit === 'hour') {
    const st = step * (unit === 'second' ? SEC : unit === 'minute' ? MIN : HOUR);
    for (let t = Math.ceil(lo / st) * st; t <= hi && out.length < 5000; t += st) out.push(t);
  } else if (unit === 'day') {
    const d0 = new Date(lo);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
    while (out.length < 5000) {
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= dim; d += step) { const t = Date.UTC(y, m, d); if (t > hi) return out; if (t >= lo) out.push(t); }
      if (++m === 12) { m = 0; y++; }
      if (Date.UTC(y, m, 1) > hi) break;
    }
  } else if (unit === 'month') {
    const d0 = new Date(lo);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth() - (d0.getUTCMonth() % step);
    for (let t = Date.UTC(y, m, 1); t <= hi && out.length < 5000; t = Date.UTC(y, m, 1)) { if (t >= lo) out.push(t); m += step; if (m >= 12) { y += Math.floor(m / 12); m %= 12; } }
  } else {
    const y0 = new Date(lo).getUTCFullYear();
    for (let y = Math.ceil(y0 / step) * step; out.length < 5000; y += step) { const t = Date.UTC(y, 0, 1); if (t > hi) break; if (t >= lo) out.push(t); }
  }
  return out;
}
// the label format each unit reads in (matplotlib's AutoDateFormatter scale)
const _DATE_FMT = { year: '%Y', month: '%Y-%m', day: '%Y-%m-%d', hour: '%H:%M', minute: '%H:%M', second: '%H:%M:%S', ms: '%H:%M:%S.%f' };
// at most `count` calendar ticks in [lo, hi]: { values, labels, unit }
function _dateTicks(lo, hi, count) {
  const span = hi - lo;
  for (const [unit, step, approx] of _DATE_STEPS) {
    if (span / approx > count + 1) continue;
    const values = _dateTicksAt(unit, step, lo, hi);
    if (values.length > count && !(unit === 'year' && step === 1000)) continue;
    if (values.length < 2 && unit !== _DATE_STEPS[0][0]) continue;
    const fmt = _DATE_FMT[unit];
    // hours and minutes across days: midnight says which day
    const labels = values.map((t) => ((unit === 'hour' || unit === 'minute') && t % DAY === 0 ? strftime(t, '%Y-%m-%d') : strftime(t, fmt)));
    values.step = approx;
    return { values, labels, unit };
  }
  // under a second: plain milliseconds, round steps
  const values = _niceTicks(lo, hi, count);
  return { values, labels: values.map((t) => strftime(t, _DATE_FMT.ms).replace(/0{3}$/, '')), unit: 'ms' };
}

class DateFormatter extends Formatter {
  constructor(fmt, tz) { super(); this.fmt = String(fmt); if (tz != null && tz !== 'UTC') this._tzWarn = true; }
  format(v) { return strftime(v, this.fmt); }
}
// the automatic calendar locator (what a date axis uses with no locator set)
class AutoDateLocator extends Locator {
  constructor(opts) { super(); const o = opts || {}; this.maxticks = o.maxticks || null; }
  tick_values(lo, hi, ctx) { return _dateTicks(lo, hi, this.maxticks || (ctx && ctx.count) || 7).values; }
}
class _CalLocator extends Locator {
  constructor(unit, interval) { super(); this.unit = unit; this.interval = Math.max(1, Math.round(+interval || 1)); }
  tick_values(lo, hi) { return _dateTicksAt(this.unit, this.interval, lo, hi); }
}
class YearLocator extends _CalLocator { constructor(base = 1) { super('year', base); } }
class MonthLocator extends _CalLocator { constructor(bymonth = null, bymonthday = 1, interval = 1) { super('month', typeof bymonth === 'object' && bymonth && !Array.isArray(bymonth) ? bymonth.interval || 1 : interval); } }
class DayLocator extends _CalLocator { constructor(bymonthday = null, interval = 1) { super('day', typeof bymonthday === 'object' && bymonthday && !Array.isArray(bymonthday) ? bymonthday.interval || 1 : interval); } }
class HourLocator extends _CalLocator { constructor(byhour = null, interval = 1) { super('hour', typeof byhour === 'object' && byhour && !Array.isArray(byhour) ? byhour.interval || 1 : interval); } }
class MinuteLocator extends _CalLocator { constructor(byminute = null, interval = 1) { super('minute', typeof byminute === 'object' && byminute && !Array.isArray(byminute) ? byminute.interval || 1 : interval); } }

// a Date, an ISO string, or ms → ms; date2num / num2date in plot's units (ms, UTC)
const _toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : +v);
function date2num(d) { return Array.isArray(d) || ArrayBuffer.isView(d) ? Array.from(d, _toMs) : _toMs(d); }
function num2date(n) { return Array.isArray(n) || ArrayBuffer.isView(n) ? Array.from(n, (v) => new Date(v)) : new Date(n); }

// the namespaces, as matplotlib's modules (plt.ticker, plt.dates)
const ticker = {
  Formatter, ScalarFormatter, NullFormatter, FuncFormatter, StrMethodFormatter, FormatStrFormatter, FixedFormatter, PercentFormatter, EngFormatter,
  Locator, NullLocator, FixedLocator, MultipleLocator, MaxNLocator, AutoMinorLocator, LogLocator,
};
const dates = {
  DateFormatter, AutoDateLocator, YearLocator, MonthLocator, DayLocator, HourLocator, MinuteLocator, date2num, num2date, strftime,
};

// what set_major_formatter takes: a Formatter, a function (x, pos), or a str (a {}-template)
function _asFormatter(f, strictFlag) {
  if (f instanceof Formatter) return f;
  if (typeof f === 'function') return new FuncFormatter(f);
  if (typeof f === 'string') return new StrMethodFormatter(f);
  if (f && typeof f.format === 'function') return f;
  throw new TypeError('set_major_formatter: give a Formatter, a function (x, pos) → str, or a format string like "{x:,.0f}"');
}
function _asLocator(l) {
  if (l instanceof Locator || (l && typeof l.tick_values === 'function')) return l;
  if (Array.isArray(l) || ArrayBuffer.isView(l)) return new FixedLocator(l);
  throw new TypeError('set_major_locator: give a Locator (MultipleLocator(5), MaxNLocator(6), FixedLocator([...]), …)');
}

// -- record.js --

// Figures as data: a recording 2D context and its replay.
//
// `recordingContext(w, h)` stands in for a CanvasRenderingContext2D. Every call plot makes on
// it becomes one plain-JSON op, `[name, ...args]`, and every property assignment becomes
// `['set', name, value]`. `replay(ctx, list)` plays the ops back on a real context. Nothing here
// touches the DOM, so a figure can be drawn in a worker or Node and shown somewhere else.
//
// Text widths: every font plot uses is monospace, so `measureText(s)` answers
// s.length × 0.6 × px. That keeps layout identical in every host, Node included.
//
// Ops whose numeric arguments are not finite are dropped, which is what a canvas does with
// them anyway (and JSON could not carry NaN).
//
// One op is not a canvas call: `['image', x, y, w, h, cols, rows, rgbaBase64]`, a whole
// colour-mapped raster (imshow) in one op instead of one fillRect per cell.

const _METHODS = new Set([
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
  'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect',
  'strokeRect', 'clearRect', 'fillText', 'strokeText', 'translate', 'rotate', 'scale',
  'transform', 'setTransform', 'resetTransform', 'setLineDash',
]);

const _DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif',
  textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, lineCap: 'butt',
  lineJoin: 'miter', lineDashOffset: 0, imageSmoothingEnabled: true,
};

function _fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? +m[1] : 10;
}

function _finiteArgs(args) {
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) return false;
  return true;
}

function recordingContext(width, height) {
  const ops = [];
  let state = { ..._DEFAULTS };
  let dash = [];
  const stack = [];
  const target = {
    _plotRecorder: true,
    ops,
    canvas: { width, height },
    measureText(s) {
      return { width: String(s).length * 0.6 * _fontPx(state.font) };
    },
    getLineDash() { return dash.slice(); },
    // the raster op (see the header)
    // `holder` (optional) keeps the encoding between draws of the same raster
    _image(x, y, w, h, cols, rows, rgba, holder) {
      if (!_finiteArgs([x, y, w, h])) return;
      let b64;
      if (holder && holder.b64Of === rgba) b64 = holder.b64;
      else { b64 = _toBase64(rgba); if (holder) { holder.b64Of = rgba; holder.b64 = b64; } }
      ops.push(['image', x, y, w, h, cols, rows, b64]);
    },
  };
  return new Proxy(target, {
    get(t, name) {
      if (name in t) return t[name];
      if (typeof name === 'string' && _METHODS.has(name)) {
        return (...args) => {
          if (name === 'save') stack.push({ state: { ...state }, dash: dash.slice() });
          if (name === 'restore' && stack.length) { const s = stack.pop(); state = s.state; dash = s.dash; }
          if (name === 'setLineDash') { dash = Array.from(args[0] || []); ops.push(['setLineDash', dash.slice()]); return; }
          if (!_finiteArgs(args)) return;
          ops.push([name, ...args]);
        };
      }
      return state[name];
    },
    set(t, name, value) {
      state[name] = value;
      ops.push(['set', name, value]);
      return true;
    },
  });
}

function isRecordingContext(ctx) {
  return !!(ctx && ctx._plotRecorder);
}

// Play a draw list back on a real 2D context.
function replay(ctx, list) {
  const ops = Array.isArray(list) ? list : list && list.ops;
  if (!Array.isArray(ops)) throw new TypeError('replay: expected a draw list (fig.toDrawList()) or its ops');
  for (const op of ops) {
    const [name, ...args] = op;
    if (name === 'set') { ctx[args[0]] = args[1]; continue; }
    if (name === 'image') { _replayImage(ctx, ...args); continue; }
    if (!_METHODS.has(name)) throw new Error(`replay: unknown op '${name}'`);
    ctx[name](...args);
  }
}

function _replayImage(ctx, x, y, w, h, cols, rows, b64) {
  const bytes = _fromBase64(b64);
  const make = (cw, ch) => (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement('canvas'), { width: cw, height: ch }));
  const scratch = make(cols, rows);
  const sctx = scratch.getContext('2d');
  sctx.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length), cols, rows), 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, w, h);
  ctx.imageSmoothingEnabled = smooth;
}

// 'rgb(r,g,b)' / 'rgba(r,g,b,a)' / '#rgb' / '#rrggbb' → [r, g, b, a] bytes, or null
function parseColorBytes(c) {
  if (typeof c !== 'string') return null;
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 255 : Math.round(+m[4] * 255)];
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  return null;
}

// Base64 by table into ASCII bytes, decoded to a string once: a raster is megabytes, and
// btoa needs it as one binary string first (a 16 MB image spent most of its draw-list time
// there). Falls back to btoa where TextDecoder is missing.
const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let _B64PAIRS = null;
function _toBase64(bytes) {
  if (typeof TextDecoder === 'undefined') {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  if (!_B64PAIRS) {
    // every 12-bit value → its two characters, as one 16-bit unit (little-endian bytes)
    _B64PAIRS = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) _B64PAIRS[i] = _B64.charCodeAt(i >> 6) | (_B64.charCodeAt(i & 63) << 8);
  }
  const n = bytes.length, full = n - (n % 3);
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  const o16 = new Uint16Array(out.buffer);
  let j = 0;
  for (let i = 0; i < full; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    o16[j++] = _B64PAIRS[v >> 12];
    o16[j++] = _B64PAIRS[v & 4095];
  }
  let o = j * 2;
  const rest = n - full;
  if (rest) {
    const v = (bytes[full] << 16) | (rest === 2 ? bytes[full + 1] << 8 : 0);
    out[o++] = _B64.charCodeAt(v >> 18);
    out[o++] = _B64.charCodeAt((v >> 12) & 63);
    out[o++] = rest === 2 ? _B64.charCodeAt((v >> 6) & 63) : 61;   // '='
    out[o++] = 61;
  }
  return new TextDecoder('latin1').decode(out);
}

function _fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// -- raster.js --

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


const _MARKERS = 'o . s ^ v < > d D p h * + x'.split(' ');

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
function _markerShape(marker, r, lw = 1.5) {
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
function _pathMarker(ctx, shape, px, py) {
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
function _stamp(marker, r, ew, phase) {
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
function _rasterPoints(W, H, X, Y, ox, oy, k, rad, marker, colors, alpha, edge) {
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
function _blit(ctx, x, y, w, h, cols, rows, rgba, holder, smooth = false) {
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

// -- pick.js --

// Picking — "what is under the pointer?" in under a millisecond at a million points.
//
// Each pickable trace gets a uniform grid of its points in PIXEL space (a counting sort into
// CELL-px cells), built lazily on the first pick after a render and thrown away by the next
// render, since any change of view moves every pixel. A pick then looks only at the cells
// within `radius` of the pointer.

const _CELL = 16;

// px, py: device-independent pixel positions (NaN = off the axes or not finite)
function _buildGrid(px, py, x0, y0, w, h, pad) {
  const cols = Math.max(1, Math.ceil((w + 2 * pad) / _CELL));
  const rows = Math.max(1, Math.ceil((h + 2 * pad) / _CELL));
  const n = px.length;
  const cellOf = new Int32Array(n);
  const counts = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const X = px[i], Y = py[i];
    if (X !== X || Y !== Y) { cellOf[i] = -1; continue; }
    const cx = Math.floor((X - x0 + pad) / _CELL), cy = Math.floor((Y - y0 + pad) / _CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { cellOf[i] = -1; continue; }
    const c = cy * cols + cx;
    cellOf[i] = c;
    counts[c + 1]++;
  }
  for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
  const start = counts.slice(0, cols * rows + 1);
  const items = new Int32Array(counts[cols * rows]);
  const fillAt = start.slice();
  for (let i = 0; i < n; i++) { const c = cellOf[i]; if (c >= 0) items[fillAt[c]++] = i; }
  return { cols, rows, x0: x0 - pad, y0: y0 - pad, start, items, px, py };
}

// nearest point of the grid within `radius` px of (qx, qy): { index, d } or null
function _queryGrid(g, qx, qy, radius) {
  const c0 = Math.max(0, Math.floor((qx - radius - g.x0) / _CELL)), c1 = Math.min(g.cols - 1, Math.floor((qx + radius - g.x0) / _CELL));
  const r0 = Math.max(0, Math.floor((qy - radius - g.y0) / _CELL)), r1 = Math.min(g.rows - 1, Math.floor((qy + radius - g.y0) / _CELL));
  let best = -1, bd = radius * radius;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * g.cols + c;
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
        const i = g.items[k];
        const dx = g.px[i] - qx, dy = g.py[i] - qy, d = dx * dx + dy * dy;
        // ties go to the later point: it is the one drawn on top
        if (d < bd || (d === bd && i > best)) { bd = d; best = i; }
      }
    }
  }
  return best < 0 ? null : { index: best, d: Math.sqrt(bd) };
}

// -- axes.js --

// Axes — trace storage, layout computation, canvas rendering, picking.
//
// HOW A RENDER IS FAST. Columns arrive through _col (data.js) and are never copied again.
// Each trace caches what it derives — its finite ranges, histogram counts, colour indices, an
// image's RGBA, a scatter's raster, its pixel positions — on itself, keyed by whatever the
// result depends on (the view, vmin/vmax, …), so drawing the same view twice only re-blits.
// Hot loops never call scale.transform(): they use the scale's fold (px = a·v + b) inline.
//
// HOW BIG FIGURES DRAW. Scatters up to _engine.rasterMin points draw as canvas paths (batched into
// a few fill calls when nothing overlaps visibly differently: alpha 1, no edge). Past that
// they rasterize: one antialiased stamp per point, composited in data order into one image
// (raster.js), which is one blit live and one 'image' op in a draw list. Lines longer than 4
// points per device pixel are decimated min/max per pixel column (M4: identical pixels).
// Images always go through one RGBA buffer, never one fillRect per cell.
//
// NOTHING NON-FINITE POISONS ANYTHING. NaN and ±Inf never reach a range; a line breaks at a
// NaN (matplotlib's rule); a NaN colour value draws nothing; NaN cells are transparent; a log
// axis ignores values ≤ 0.












// The fast-path thresholds (measured: bench/BENCH.md). Scatters with more than rasterMin points
// rasterize; lines with more than 4 vertices per device pixel decimate. Tests turn them off
// to compare the fast paths against the plain ones.
const _engine = { rasterMin: 4000, m4: true, batch: true };
const _M4_SUB = 4;          // M4 columns per device pixel (see _pathM4)

// Trace kinds beyond the core ones register here (marks.js, box.js, contour.js, …), so each
// lives in its own module: { extent(ax, trace, axis, log, take, stick), render(ax, ctx, trace,
// xScale, yScale, rect), z (the default zorder), cmap (it colour-maps: a colorbar follows it),
// legend(ax, trace) → a legend entry }. take(v) widens the range; stick(v) is a sticky edge
// that the margins stop at (matplotlib's sticky_edges: bars at 0, images at their extent).
const _KINDS = {};
// ingress hooks the later modules fill (marks.js: plot's drawstyle)
const _hooks = {};

// matplotlib's default zorders: images 0, patches and collections 1, lines 2, text 3. Traces
// draw in zorder, ties in the order they were added.
const _ZORDER = { imshow: 0, bar: 1, barh: 1, hist: 1, scatter: 1, line: 2, hline: 2, vline: 2, text: 3 };

function _plainOpts(o) {
  // an options object, as opposed to a column or a format string
  return o != null && typeof o === 'object' && !_isArrayLike(o);
}

function _lenErr(fn, a, na, b, nb) {
  return new Error(`plot: ${fn}: ${a} has ${_fmtCount(na)} values but ${b} has ${_fmtCount(nb)}`);
}

// What a chart call returns: matplotlib's container — an array (bar's rectangles; hist's
// [n, bins, patches]; errorbar's [line, caps, bars]) with its own fields and .axes — through
// which every other name reads the axes, so ax.bar(…).set_title(…) still chains.
// matplotlib.cm.ScalarMappable({cmap, norm}) — a colour scale with no data of plot's behind it:
// fig.colorbar(sm, {ax}) draws its bar (the legend of a picture another renderer draws).
// vmin / vmax are the short form of norm=Normalize(vmin, vmax); set_clim moves them.
class ScalarMappable {
  constructor(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    this._scalar = true;
    this.cmap = o.cmap ?? null;
    this.norm = o.norm ?? null;
    this.vmin = o.vmin ?? null;
    this.vmax = o.vmax ?? null;
  }
  set_clim(vmin, vmax) { if (Array.isArray(vmin)) [vmin, vmax] = vmin; this.vmin = vmin; this.vmax = vmax; return this; }
  set_cmap(c) { this.cmap = c; return this; }
  set_norm(n) { this.norm = n; return this; }
  set_array(_a) { return this; }               // matplotlib's idiom sm.set_array([]): nothing to hold
  __repr__() { return '<matplotlib.cm.ScalarMappable>'; }
}

// matplotlib's Artist.set_visible / get_visible / remove, for the traces a call made. Hidden
// traces don't draw, pick or appear in the legend; removed ones are gone. A figure under
// interact() redraws by itself.
function _artistOps(ax, tracesOf) {
  const redraw = () => { if (ax.figure && ax.figure._requestDraw) ax.figure._requestDraw(); };
  return {
    set_visible(v) { for (const t of tracesOf()) t.hidden = !v; redraw(); return this; },
    get_visible() { return tracesOf().some((t) => !t.hidden); },
    remove() { const gone = new Set(tracesOf()); ax._traces = ax._traces.filter((t) => !gone.has(t)); redraw(); },
  };
}

function _result(ax, items, fields) {
  const f = fields || {};
  const tracesOf = () => (f._trace ? [f._trace] : f._traces ? f._traces : Array.from(items).filter((i) => i && i._trace).map((i) => i._trace));
  const ops = _artistOps(ax, tracesOf);
  for (const k of Object.keys(ops)) if (!(k in f)) f[k] = ops[k];
  const target = Object.assign(items, f, { axes: ax });
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      // dunders stay the container's own: a [line] reads as a list, not as its axes
      if (typeof k === 'string' && k.startsWith('__')) return undefined;
      const v = ax[k];
      return typeof v === 'function' ? v.bind(ax) : v;
    },
  });
}

// fold a column through a scale into pixel positions (NaN for anything not drawable)
function _project(arr, s, out) {
  const a = s.a, b = s.b, n = arr.length;
  if (s.log) {
    for (let i = 0; i < n; i++) { const v = arr[i]; out[i] = v > 0 && v !== Infinity ? a * Math.log10(v) + b : NaN; }
  } else {
    for (let i = 0; i < n; i++) { const v = arr[i]; out[i] = v - v === 0 ? a * v + b : NaN; }
  }
  return out;
}

// matplotlib's named font sizes, as px relative to the theme's base size
const _FONTSIZES = { 'xx-small': -4, 'x-small': -3, small: -2, medium: 0, large: 2, 'x-large': 4, 'xx-large': 6 };

// a 2D grid → { flat (row-major Float64Array), nx, ny }: nested arrays, a Float64Array with a
// 2D shape, an ndarray-like { data, shape }, a natra ndarray, a sadpan DataFrame; null if not
function _grid2d(data) {
  if (data && data._tbl && typeof data.to_numpy === 'function') {
    const a = data.to_numpy();
    return { ny: a.shape[0], nx: a.shape[1], flat: a.data instanceof Float64Array ? a.data : Float64Array.from([].concat(...a.tolist())) };
  }
  if (data instanceof Float64Array && Array.isArray(data.shape) && data.shape.length === 2) return { ny: data.shape[0], nx: data.shape[1], flat: data };
  if (data && ArrayBuffer.isView(data.data) && Array.isArray(data.shape) && data.shape.length === 2) return { ny: data.shape[0], nx: data.shape[1], flat: data.data instanceof Float64Array ? data.data : Float64Array.from(data.data) };
  if (data && data._nd && data._arr && data._arr.ndim === 2) {
    const a = data._arr;
    return { ny: a.shape[0], nx: a.shape[1], flat: new Float64Array(a.memory.buffer, a.ptr, a.shape[0] * a.shape[1]).slice() };
  }
  if (Array.isArray(data) && data.length && _isArrayLike(data[0])) {
    const ny = data.length, nx = data[0].length, flat = new Float64Array(ny * nx);
    for (let i = 0; i < ny; i++) {
      if (data[i].length !== nx) throw new Error(`plot: a 2D array needs rows of one length: row 0 has ${nx}, row ${i} has ${data[i].length}`);
      for (let j = 0; j < nx; j++) { const v = data[i][j]; flat[i * nx + j] = v == null ? NaN : +v; }
    }
    return { ny, nx, flat };
  }
  return null;
}

class Axes {
  constructor(theme) {
    this._theme = theme || _snapshotStyle();
    this._traces = [];
    this._title = null;
    this._xlabel = null;
    this._ylabel = null;
    this._xlim = null;
    this._ylim = null;
    this._grid = false;
    this._gridOpts = {};
    this._legend = false;
    this._legendOpts = {};
    this._colorbar = false;
    this._colorbarOpts = {};
    this._aspect = 'auto';
    this._colorIdx = 0;
    this._strict = false;
    this._dpi = 100;             // the figure's, for sizes given in points (markers)
    this._xticks = null;         // set_xticks: { values, labels, rotation }
    this._yticks = null;
    this._xcats = null;          // a category axis (strings as x): _Categories
    this._ycats = null;
    this._xinv = false;          // invert_xaxis()
    this._yinv = false;
    this._xmargin = 0.05;        // ax.margins(): the share of the data range added each side
    this._ymargin = 0.05;
    this._axisOn = true;         // axis('off') hides the frame, ticks and axis labels
    this._shared = { x: null, y: null };   // subplots(sharex / sharey): every axes sharing that axis
    this.view = null;            // set by a render: { x, y, w, h, xScale, yScale }
  }

  _nextColor() {
    const cyc = this._theme.cycle || _style.cycle;
    return cyc[this._colorIdx++ % cyc.length];
  }

  // copy, check and alias-resolve an options object for function `fn`
  _opts(fn, opts, keepC) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    _checkOpts(fn, o, this._strict);
    if (keepC) { const c = o.c; delete o.c; _resolveAliases(o); if (c !== undefined) o.c = c; }
    else _resolveAliases(o);
    if (o.color != null) o.color = _cssColor(o.color);
    return o;
  }

  _checkMarker(fn, m) {
    if (m == null || _MARKERS.includes(m)) return m;
    _warn(`${fn}.marker.${m}`, `${fn}(): marker '${m}' is not supported; use one of ${_MARKERS.join(' ')}`, this._strict);
    return 'o';
  }

  // plot(y) · plot(y, fmt) · plot(x, y) · plot(x, y, fmt) · plot(x, y, fmt, opts) · plot(x, y, opts)
  plot(x, y, fmtOrOpts, opts) {
    if (!_isArrayLike(y)) {                        // plot(y …): x is 0 … n-1
      opts = fmtOrOpts; fmtOrOpts = y; y = x; x = undefined;
    }
    let fmt = null;
    if (typeof fmtOrOpts === 'string') fmt = fmtOrOpts;
    else if (_plainOpts(fmtOrOpts)) opts = fmtOrOpts;
    const o = this._opts('plot', opts);
    if (o.fmt) { fmt = o.fmt; delete o.fmt; }
    if (fmt) { const f = parseFormat(fmt); for (const k in f) if (o[k] === undefined) o[k] = k === 'color' ? _cssColor(f[k]) : f[k]; }
    if (!o.color) o.color = this._nextColor();
    o.marker = this._checkMarker('plot', o.marker);
    const Y = this._axisCol('y', y);
    const X = x === undefined ? _arange(Y.length) : this._axisCol('x', x);
    if (X.length !== Y.length) throw _lenErr('plot', 'x', X.length, 'y', Y.length);
    const trace = { type: 'line', x: X, y: Y, opts: o };
    if (o.drawstyle && _hooks.drawstyle) _hooks.drawstyle(this, trace);
    this._traces.push(trace);
    // matplotlib returns [Line2D]: `line, = ax.plot(…)` unpacks; the rest reads the axes (chaining)
    const line = { get_xdata: () => trace.x, get_ydata: () => trace.y, get_color: () => o.color, get_label: () => o.label ?? null, axes: this, _trace: trace, ..._artistOps(this, () => [trace]),
      __repr__: () => `<Line2D ${o.label != null ? JSON.stringify(String(o.label)) : 'unlabeled'}>` };
    return _result(this, [line], {});
  }

  // scatter(x, y, opts) · scatter(x, y, s, c, opts) — matplotlib's positional s and c too
  scatter(x, y, sOrOpts, c, opts) {
    let o;
    if (_plainOpts(sOrOpts)) o = this._opts('scatter', sOrOpts, true);
    else {
      o = this._opts('scatter', opts, true);
      if (sOrOpts != null) o.s = sOrOpts;
      if (c != null) o.c = c;
    }
    const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
    if (Y.length !== n) throw _lenErr('scatter', 'x', n, 'y', Y.length);
    const trace = { type: 'scatter', x: X, y: Y, opts: o, cvals: null, colors: null, s: null };
    // c: a colour, numbers to colour-map, or one colour per point
    let cc = o.c;
    if (cc === undefined && o.color != null && _isArrayLike(o.color)) { cc = o.color; delete o.color; }
    // an RGB(A) tuple: 3 or 4 numbers in [0, 1], when there aren't that many points
    const tuple = (Array.isArray(cc) || ArrayBuffer.isView(cc)) && (cc.length === 3 || cc.length === 4) && n !== cc.length
      && Array.prototype.every.call(cc, (v) => typeof v === 'number' && v >= 0 && v <= 1);
    if (cc != null && typeof cc !== 'string' && !tuple) {
      const col = _col(cc);
      if (col.length !== n) throw _lenErr('scatter', 'c', col.length, 'x', n);
      if (_isNumericCol(col)) trace.cvals = col;
      else trace.colors = col.map(_cssColor);
      delete o.c;
    } else if (cc != null) {
      o.color = _cssColor(cc);
      delete o.c;
    }
    if (!o.color && !trace.cvals && !trace.colors) o.color = this._nextColor();
    if (o.s != null && typeof o.s !== 'number') {
      const s = _col(o.s);
      if (s.length !== n) throw _lenErr('scatter', 's', s.length, 'x', n);
      trace.s = s;
    }
    o.marker = this._checkMarker('scatter', o.marker);
    this._traces.push(trace);
    return _result(this, [], { _trace: trace, __repr__: () => '<matplotlib.collections.PathCollection>' });   // a mappable: colorbar(sc) follows it
  }

  // matshow — render a 2D matrix as a heatmap. Accepts diverse inputs:
  // a sadpan DataFrame (uses .to_numpy()), a natra ndarray, a
  // Float64Array with .shape, a nested JS array, or already-flat data
  // with shape. Extracts flat data + nx + ny + passes through to imshow.
  matshow(data, opts) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    const g = _grid2d(data);
    if (!g) return this.imshow(data, undefined, undefined, opts);   // let it complain
    const { flat, nx, ny } = g;
    // matshow defaults to 'upper' origin (row 0 at top) — opposite of
    // imshow's default. honor unless caller explicitly set otherwise.
    if (!o.origin) o.origin = 'upper';
    // Aspect equal so cells render as squares.
    if (this._aspect === 'auto') this._aspect = 'equal';
    return this.imshow(flat, nx, ny, o);
  }

  // imshow(data, nx, ny, opts): a flat row-major grid of nx × ny values
  // imshow(Z, opts): a 2D array (nested arrays, an ndarray, a DataFrame), with matplotlib's
  // defaults: origin 'upper' (row 0 at the top), each cell centred on its integer index
  // (extent [-0.5, nx-0.5, ny-0.5, -0.5]), y running down. imshow(data, nx, ny, opts): plot's
  // flat form, row-major, origin 'lower' and extent [0, nx, 0, ny] unless given.
  imshow(data, nx, ny, opts) {
    if (typeof nx !== 'number' || typeof ny !== 'number') {
      const g = _grid2d(data);
      if (!g) throw new Error('plot: imshow: give a 2D array (nested arrays, an ndarray or a DataFrame), or the flat form imshow(data, nx, ny, opts)');
      const o = _plainOpts(nx) ? { ...nx } : {};
      if (o.origin == null) o.origin = 'upper';
      if (o.extent == null) {
        o.extent = o.origin === 'upper' ? [-0.5, g.nx - 0.5, g.ny - 0.5, -0.5] : [-0.5, g.nx - 0.5, -0.5, g.ny - 0.5];
      }
      const res = this.imshow(g.flat, g.nx, g.ny, o);
      // an extent running down (y0 > y1, origin 'upper') is an inverted y-axis, as in matplotlib
      if (o.extent[2] > o.extent[3] && !this._ylim) this._yinv = true;
      return res;
    }
    const o = this._opts('imshow', opts);
    const D = _col(data);
    if (D.length !== nx * ny) throw new Error(`plot: imshow: data has ${_fmtCount(D.length)} values but nx × ny is ${_fmtCount(nx * ny)}`);
    if (o.interpolation != null && !['nearest', 'none', 'bilinear', 'antialiased'].includes(o.interpolation)) {
      _warn('imshow.interp.' + o.interpolation, `imshow(): interpolation '${o.interpolation}' is not supported; use 'nearest' or 'bilinear'`, this._strict);
    }
    if (o.extent != null) {
      const e = Array.from(_col(o.extent));
      if (e.length !== 4) throw new Error('plot: imshow: extent must be [x0, x1, y0, y1]');
      o.extent = e;
    }
    if (o.aspect != null) this._aspect = o.aspect;
    const trace = { type: 'imshow', data: D, nx, ny, opts: o };
    this._traces.push(trace);
    // default to equal aspect for grid data (matches matplotlib)
    if (this._aspect === 'auto') this._aspect = 'equal';
    return _result(this, [], { _trace: trace, norm: o.norm, cmap: o.cmap, __repr__: () => '<matplotlib.image.AxesImage>' });
  }

  // vlines(x, ymin, ymax) — vertical line segments. x can be scalar or
  // array. Implemented as line traces (x=[x_i,x_i] y=[ymin,ymax]) so no
  // new trace type is needed.
  vlines(x, ymin, ymax, opts) {
    const xs = _col(x);
    const o = this._opts('vlines', opts);
    if (!o.color && o.colors) o.color = _cssColor(Array.isArray(o.colors) ? o.colors[0] : o.colors);
    delete o.colors;
    if (!o.color) o.color = this._nextColor();
    for (const xv of xs) {
      this._traces.push({ type: 'line', x: Float64Array.of(xv, xv), y: Float64Array.of(ymin, ymax), opts: { ...o } });
    }
    return this;
  }

  hlines(y, xmin, xmax, opts) {
    const ys = _col(y);
    const o = this._opts('hlines', opts);
    if (!o.color && o.colors) o.color = _cssColor(Array.isArray(o.colors) ? o.colors[0] : o.colors);
    delete o.colors;
    if (!o.color) o.color = this._nextColor();
    for (const yv of ys) {
      this._traces.push({ type: 'line', x: Float64Array.of(xmin, xmax), y: Float64Array.of(yv, yv), opts: { ...o } });
    }
    return this;
  }

  text(x, y, text, opts) {
    if (x instanceof Date) x = x.getTime();                // on a date axis
    if (y instanceof Date) y = y.getTime();
    const o = this._opts('text', opts);
    if (o.horizontalalignment && !o.ha) o.ha = o.horizontalalignment;
    if (o.verticalalignment && !o.va) o.va = o.verticalalignment;
    this._traces.push({ type: 'text', x, y, text, opts: o });
    return this;
  }

  // ax.figure is set by the Figure that made it; matplotlib's repr names what's been set
  get_figure() { return this.figure || null; }
  __repr__() {
    const q = (l) => JSON.stringify(String(l.text)).replace(/^"|"$/g, "'");
    const parts = [];
    if (this._title) parts.push(`title={'center': ${q(this._title)}}`);
    if (this._xlabel) parts.push(`xlabel=${q(this._xlabel)}`);
    if (this._ylabel) parts.push(`ylabel=${q(this._ylabel)}`);
    return `<Axes: ${parts.join(', ')}>`;
  }
  set_title(text, opts) { this._title = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  set_xlabel(text, opts) { this._xlabel = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  set_ylabel(text, opts) { this._ylabel = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  // set_xlim(left, right) · set_xlim([left, right]) · set_xlim({left: 0}) (keyword, as adder
  // passes it). A missing end keeps what it was (matplotlib: set_xlim(left=0)); null means
  // "from the data". left > right is an inverted axis. Shared axes (subplots(sharex)) all move.
  set_xlim(lo, hi) { this._setLim('x', lo, hi, 'left', 'right', 'xmin', 'xmax'); return this; }
  set_ylim(lo, hi) { this._setLim('y', lo, hi, 'bottom', 'top', 'ymin', 'ymax'); return this; }
  _setLim(axis, lo, hi, kLo, kHi, kMin, kMax) {
    // Dates (a date axis) first: a Date would otherwise pass for an options object
    if (lo instanceof Date || hi instanceof Date) for (const a of this._group(axis)) a[axis === 'x' ? '_xdate' : '_ydate'] = true;
    if (lo instanceof Date) lo = lo.getTime();
    if (hi instanceof Date) hi = hi.getTime();
    if (_plainOpts(lo)) { const o = lo; lo = o[kLo] !== undefined ? o[kLo] : o[kMin]; hi = o[kHi] !== undefined ? o[kHi] : o[kMax]; }
    else if (_isArrayLike(lo) && hi === undefined) { hi = lo[1]; lo = lo[0]; }
    const key = axis === 'x' ? '_xlim' : '_ylim';
    const cur = this[key] || [null, null];
    const lim = [lo === undefined ? cur[0] : lo, hi === undefined ? cur[1] : hi];
    for (const ax of this._group(axis)) { ax[key] = lim.slice(); ax[axis === 'x' ? '_xinv' : '_yinv'] = false; }
  }
  // the limits as drawn (inverted axes give [high, low], as matplotlib does)
  get_xlim() { return this._getLim('x'); }
  get_ylim() { return this._getLim('y'); }
  _getLim(axis) {
    const v = this.view;
    if (v) { const d = (axis === 'x' ? v.xScale : v.yScale).domain; return (axis === 'x' ? v.xinv : v.yinv) ? [d[1], d[0]] : d.slice(); }
    const R = this._axisRange(axis, (axis === 'x' ? this._xscale : this._yscale) === 'log');
    return R.inv ? [R.hi, R.lo] : [R.lo, R.hi];
  }
  invert_xaxis() { for (const ax of this._group('x')) ax._xinv = !ax._xinv; return this; }
  invert_yaxis() { for (const ax of this._group('y')) ax._yinv = !ax._yinv; return this; }
  xaxis_inverted() { const l = this.get_xlim(); return l[0] > l[1]; }
  yaxis_inverted() { const l = this.get_ylim(); return l[0] > l[1]; }
  // margins(m) · margins(x, y) · margins({x, y}) · margins() → [x, y]
  margins(x, y) {
    if (x === undefined) return [this._xmargin, this._ymargin];
    if (_plainOpts(x)) { y = x.y; x = x.x; }
    else if (y === undefined) y = x;
    if (x != null) this._xmargin = +x;
    if (y != null) this._ymargin = +y;
    return this;
  }
  // axis('off' | 'on' | 'equal' | 'scaled' | 'image' | 'tight' | [x0, x1, y0, y1]) → the limits
  axis(arg) {
    if (arg != null && _plainOpts(arg)) { const o = arg; arg = o.option ?? null; if (o.xmin != null || o.xmax != null) this.set_xlim(o.xmin, o.xmax); if (o.ymin != null || o.ymax != null) this.set_ylim(o.ymin, o.ymax); }
    if (_isArrayLike(arg) && arg.length === 4) { this.set_xlim(arg[0], arg[1]); this.set_ylim(arg[2], arg[3]); }
    else if (arg === false || arg === 'off') this._axisOn = false;
    else if (arg === true || arg === 'on') this._axisOn = true;
    else if (arg === 'equal' || arg === 'scaled' || arg === 'square') this._aspect = 'equal';
    else if (arg === 'image') { this._aspect = 'equal'; this._xmargin = this._ymargin = 0; }
    else if (arg === 'tight') { this._xmargin = this._ymargin = 0; }
    else if (arg === 'auto' || arg === 'normal') this._aspect = 'auto';
    else if (arg != null) _warn('axis.' + arg, `axis('${arg}') is not supported; use 'off', 'on', 'equal', 'scaled', 'image', 'tight', 'auto' or [x0, x1, y0, y1]`, this._strict);
    return [...this.get_xlim(), ...this.get_ylim()];
  }
  // set_xticks(ticks, labels?, {rotation}) — exactly these ticks; [] for none. Labels may also
  // come later from set_xticklabels.
  set_xticks(ticks, labels, opts) { this._setTicks('x', ticks, labels, opts); return this; }
  set_yticks(ticks, labels, opts) { this._setTicks('y', ticks, labels, opts); return this; }
  set_xticklabels(labels, opts) { this._setTickLabels('x', labels, opts); return this; }
  set_yticklabels(labels, opts) { this._setTickLabels('y', labels, opts); return this; }
  get_xticks() { return this._ticksNow('x').values.slice(); }
  get_yticks() { return this._ticksNow('y').values.slice(); }
  get_xticklabels() { return this._ticksNow('x').labels.slice(); }
  get_yticklabels() { return this._ticksNow('y').labels.slice(); }
  _setTicks(axis, ticks, labels, opts) {
    if (_plainOpts(labels)) { opts = labels; labels = opts.labels; }
    const o = _plainOpts(opts) ? opts : {};
    const t = { values: Array.from(ticks == null ? [] : _isArrayLike(ticks) ? ticks : [ticks], Number), labels: labels != null ? Array.from(labels, (l) => (l == null ? '' : String(l))) : null, rotation: o.rotation ?? null };
    this[axis === 'x' ? '_xticks' : '_yticks'] = t;
  }
  _setTickLabels(axis, labels, opts) {
    const o = _plainOpts(opts) ? opts : {};
    const key = axis === 'x' ? '_xticks' : '_yticks';
    const cur = this[key] || { values: this._ticksNow(axis).values.slice(), rotation: null };
    this[key] = { values: cur.values, labels: Array.from(labels || [], (l) => (l == null ? '' : String(l))), rotation: o.rotation ?? cur.rotation };
  }
  // the ticks as the last render chose them (or as set)
  _ticksNow(axis) {
    const set = axis === 'x' ? this._xticks : this._yticks;
    if (set && set.labels) return set;
    const spec = axis === 'x' ? this._lastXt : this._lastYt;
    if (spec) return spec;
    if (set) return { values: set.values, labels: set.values.map(String) };
    return { values: [], labels: [] };
  }
  // tick_params(axis, {labelrotation}) — the part of it that sets what plot draws
  // tick_params({axis = 'both', which = 'major' | 'minor' | 'both', length, width, direction
  // ('out' | 'in' | 'inout'), color, labelrotation})
  tick_params(opts) {
    const o = _plainOpts(opts) ? opts : {};
    const axes = (o.axis || 'both') === 'both' ? ['x', 'y'] : [o.axis];
    const whiches = (o.which || 'major') === 'both' ? ['major', 'minor'] : [o.which || 'major'];
    if (o.labelrotation != null) for (const a of axes) {
      const key = a === 'x' ? '_xticks' : '_yticks';
      this[key] = { ...(this[key] || { values: null, labels: null }), rotation: o.labelrotation };
    }
    if (o.direction != null && !['in', 'out', 'inout'].includes(o.direction)) _warn('tick_params.direction.' + o.direction, `tick_params(): direction must be 'in', 'out' or 'inout'`, this._strict);
    const set = {};
    for (const k of ['length', 'width', 'direction', 'color']) if (o[k] != null) set[k] = k === 'color' ? _cssColor(o[k]) : o[k];
    if (Object.keys(set).length) {
      const tp = this._tickParams || (this._tickParams = {});
      for (const a of axes) { tp[a] = tp[a] || {}; for (const w of whiches) tp[a][w] = { ...(tp[a][w] || {}), ...set }; }
    }
    for (const k of Object.keys(o)) if (!['axis', 'which', 'labelrotation', 'length', 'width', 'direction', 'color', '_kw'].includes(k)) _warn('tick_params.' + k, `tick_params(): '${k}' is not supported yet (axis, which, length, width, direction, color, labelrotation)`, this._strict);
    return this;
  }
  // every axes that shares this one's `axis` (subplots(sharex / sharey)), this one included
  _group(axis) { return this._shared[axis] || [this]; }
  // a column for `axis`: numbers, or labels that make (or extend) that axis's categories
  _axisCol(axis, arr) {
    // Date objects make a date axis (ticker.js): their numbers are ms since 1970 UTC
    if (_isDateCol(arr)) {
      for (const a of this._group(axis)) a[axis === 'x' ? '_xdate' : '_ydate'] = true;
      const out = new Float64Array(arr.length);
      for (let i = 0; i < arr.length; i++) { const v = arr[i]; out[i] = v instanceof Date ? v.getTime() : v == null ? NaN : +v; }
      return out;
    }
    if (!_isCategorical(arr)) return _col(arr);
    const key = axis === 'x' ? '_xcats' : '_ycats';
    if (!this[key]) {
      const cats = new _Categories();
      for (const ax of this._group(axis)) if (!ax[key]) ax[key] = cats;
    }
    return this[key].positions(arr);
  }
  set_xscale(scale) { this._checkScale(scale); this._xscale = scale; return this; }
  set_yscale(scale) { this._checkScale(scale); this._yscale = scale; return this; }
  _checkScale(scale) {
    if (scale !== 'linear' && scale !== 'log') _warn('scale.' + scale, `set_xscale/set_yscale('${scale}') is not supported; use 'linear' or 'log'`, this._strict);
  }
  set_zorder(_n) { _noop('set_zorder', this._strict); return this; }
  set_aspect(aspect) { this._aspect = aspect; return this; }

  // twinx() — a sister axes that shares this one's x-scale, has its own y-scale, and renders
  // overlaid in the same rect with its y-axis on the right edge (dual-y plots). The twin is
  // NOT added to the figure's axes grid — its parent renders it as part of its own pass.
  twinx() {
    const t = new Axes(this._theme);
    t._strict = this._strict;
    t._twinOf = this;
    t._dpi = this._dpi;
    t._xscale = this._xscale;
    t.figure = this.figure;
    t._xlim = this._xlim;
    this._twin = t;
    return t;
  }
  // twiny() — the mirror: shares y, has its own x-scale, its x-axis along the top edge
  twiny() {
    const t = new Axes(this._theme);
    t._strict = this._strict;
    t._twinOf = this;
    t._dpi = this._dpi;
    t._yscale = this._yscale;
    t.figure = this.figure;
    t._ylim = this._ylim;
    this._twinY = t;
    return t;
  }


  // colorbar(mappable, {label, ticks, extend, format}). The mappable is what a colour-mapped
  // call returned, or a ScalarMappable({cmap, norm}) — matplotlib's bar with nothing of plot's
  // behind it. colorbar({cmap, vmin, vmax, norm}) is the short form of the same: the bar for a
  // picture another renderer draws (axes as chrome, §9a).
  colorbar(mappable, opts) {
    if (mappable && (mappable._trace || mappable._scalar)) { opts = { ...(_plainOpts(opts) ? opts : {}) }; opts[mappable._scalar ? '_scalar' : 'mappable'] = mappable._scalar ? mappable : mappable._trace; }
    else if (_plainOpts(mappable)) opts = mappable;
    const o = _plainOpts(opts) ? { ...opts } : {};
    const mp = o.mappable; delete o.mappable;
    let sm = o._scalar || null; delete o._scalar;
    this._colorbar = true;
    _checkOpts('colorbar', o, this._strict);
    if (!sm && !mp && (o.cmap != null || o.norm != null || o.vmin != null || o.vmax != null)) sm = new ScalarMappable({ cmap: o.cmap, norm: o.norm, vmin: o.vmin, vmax: o.vmax });
    for (const k of ['cmap', 'norm', 'vmin', 'vmax']) delete o[k];
    this._colorbarOpts = o;
    if (mp) this._colorbarOpts.mappable = mp;
    if (sm) this._colorbarOpts.scalar = sm;
    return _result(this, [], { _colorbar: true });
  }

  // ── axes as chrome over another renderer (§9a) ──
  // set_facecolor('none'): no face, so a canvas under the figure shows through the plot rect
  set_facecolor(c) { this._bgcolor = c === 'none' || c === 'transparent' ? 'none' : _cssColor(c); return this; }
  get_facecolor() { return this._bgcolor || this._theme.background; }
  // set_view({xlim, ylim}) — the limits another renderer's camera shows; also takes
  // condenser's view rect, {rect: {u0, u1, v0, v1}} or the rect itself. Draw the figure after
  // it; at equal aspect the drawn limits may be wider than asked (matplotlib's datalim):
  // read get_xlim() / get_ylim() and ax.view {x, y, w, h} to fit the other camera to the plot.
  set_view(v) {
    if (!v || typeof v !== 'object') throw new TypeError('set_view: expected {xlim, ylim} or a view rect {u0, u1, v0, v1}');
    const r = v.rect || (v.u0 != null ? v : null);
    const xlim = v.xlim || (r && [r.u0, r.u1]), ylim = v.ylim || (r && [r.v0, r.v1]);
    if (xlim) this.set_xlim(+xlim[0], +xlim[1]);
    if (ylim) this.set_ylim(+ylim[0], +ylim[1]);
    // a figure under interact() redraws itself (and, the view having come from outside, says
    // nothing back through onViewChange)
    if (this.figure && this.figure._requestDraw) this.figure._requestDraw();
    return this;
  }

  // grid() · grid(False) · grid(True, {alpha}) · grid({alpha}) (adder kwargs arrive as the first arg)
  grid(on, opts) {
    if (_plainOpts(on)) { opts = on; on = opts.visible !== undefined ? opts.visible : opts.b !== undefined ? opts.b : true; }
    this._grid = on !== false;
    if (opts) {
      const o = { ...opts }; delete o.visible; delete o.b;
      this._gridOpts = _resolveAliases(_checkOpts('grid', o, this._strict));
    }
    return this;
  }

  // ── view ──────────────────────────────────────────────────────────────────────────────────

  _needView(fn) {
    if (!this.view) throw new Error(`plot: ax.${fn} needs a drawn figure — call fig.show() or fig.draw(ctx) first`);
    return this.view;
  }
  // data → pixel (CSS px in the figure), and back
  toPixel(x, y) { const v = this._needView('toPixel'); return [v.xScale.transform(x), v.yScale.transform(y)]; }
  toData(px, py) { const v = this._needView('toData'); return [v.xScale.inverse(px), v.yScale.inverse(py)]; }

  // --- rendering ---

  // One pass lays the axes out with estimated margins and chooses the ticks for that size;
  // the next measures the real tick labels, titles and axis labels and lays it out again
  // (until the margins settle, at most three passes). Callers that need a grid of cells to
  // line up pass _margins = { left, right, top, bottom } and skip the measuring.
  _render(ctx, rect, env) {
    const dpr = (env && env.dpr) || 1;
    const th = this._theme;
    // per-Axes overrides (_bgcolor, _textColor, _gridColor, _frameColor) still win
    const bgcolor = this._bgcolor || th.background;
    const textColor = this._textColor || th.foreground;
    const gridColor = this._gridColor || th.grid;
    const frameColor = this._frameColor || th.frame;
    const fs = th.font_size || 11;
    const fTick = _font(th, -1), fLab = _font(th, 0), fTitle = _font(th, 2);
    const xLog = this._xscale === 'log', yLog = this._yscale === 'log';
    const XR = this._axisRange('x', xLog), YR = this._axisRange('y', yLog);
    const cb = this._colorbar ? this._colorbarInfo(ctx, fTick) : null;

    let m = this._margins
      ? { left: this._margins.left ?? 42, right: this._margins.right ?? 12, top: this._margins.top ?? 8, bottom: this._margins.bottom ?? 26 }
      : { left: 42, right: cb ? 70 : 12, top: this._title ? 24 : 8, bottom: 26 };
    let L = null;
    for (let pass = 0; pass < 3; pass++) {
      L = this._layout(ctx, rect, m, XR, YR, xLog, yLog, fTick, fs);
      if (!L || this._margins) break;
      const next = this._measure(rect, L, cb, fs);
      if (Math.abs(next.left - m.left) < 1 && Math.abs(next.right - m.right) < 1 && Math.abs(next.top - m.top) < 1 && Math.abs(next.bottom - m.bottom) < 1) break;
      m = next;
    }
    if (!L) return;
    const { plotX, plotY, plotW, plotH, fullPlotY, fullPlotH, xScale, yScale, xt, yt } = L;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    this._lastXt = xt; this._lastYt = yt;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale, yScale, dpr, xinv: L.xinv, yinv: L.yinv };
    const on = this._axisOn;

    // axes background
    if (on && bgcolor !== 'none' && bgcolor !== 'transparent') {
      ctx.fillStyle = bgcolor;
      ctx.fillRect(plotX, plotY, plotW, plotH);
    }

    // grid, at the ticks
    if (this._grid && on) {
      const g = this._gridOpts;
      ctx.strokeStyle = _cssColor(g.color) || gridColor;
      ctx.lineWidth = g.linewidth || 0.5;
      ctx.globalAlpha = g.alpha != null ? g.alpha : 0.8;
      ctx.setLineDash(dashArray(g.linestyle));
      const which = g.axis || 'both', level = g.which || 'major';
      const lines = (xs, ys) => {
        if (which !== 'y') for (const v of xs) {
          const px = xScale.transform(v);
          ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
        }
        if (which !== 'x') for (const v of ys) {
          const py = yScale.transform(v);
          ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
        }
      };
      if (level !== 'minor') lines(xt.values, yt.values);
      // the minor grid (where there are minor ticks: minorticks_on() or a minor locator), fainter
      if (level !== 'major' && (xt.minor || yt.minor)) {
        ctx.globalAlpha = (g.alpha != null ? g.alpha : 0.8) * 0.5;
        lines(xt.minor || [], yt.minor || []);
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // own traces (clipped to the plot area), then the twins' (with their own axis)
    const lastCmapTrace = this._renderTraces(ctx, xScale, yScale, plotX, plotY, plotW, plotH, dpr);
    if (this._twin) this._twin._renderAsTwin(ctx, xScale, plotX, plotY, plotW, plotH, dpr, L.twinYt);
    if (this._twinY) this._twinY._renderAsTwinY(ctx, yScale, plotX, plotY, plotW, plotH, dpr, L.twinXt);
    if (this._highlight) this._renderHighlight(ctx, xScale, yScale, { ...plot, dpr }, bgcolor);   // the trace renderers' rect carries dpr (the raster path sizes by it)

    if (on) {
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(plotX, plotY, plotW, plotH);
      if (!this._hideXTicks) _drawTicks(ctx, this._xtickLabelsOff ? { ...xt, labels: xt.labels.map(() => '') } : xt, xScale, 'bottom', plot, textColor, frameColor, fTick);
      if (!this._hideYTicks) _drawTicks(ctx, this._ytickLabelsOff ? { ...yt, labels: yt.labels.map(() => '') } : yt, yScale, 'left', plot, textColor, frameColor, fTick);
    }

    // title (above a top twin axis, when there is one)
    if (this._title) {
      ctx.fillStyle = textColor;
      ctx.font = fTitle;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const above = L.twinXt ? 6 + L.twinXt.extent + 4 + (this._twinY._xlabel ? fs + 6 : 0) : 0;
      ctx.fillText(this._title.text, plotX + plotW / 2, plotY - 6 - above);
    }
    if (on && this._xlabel) {
      ctx.fillStyle = textColor;
      ctx.font = fLab;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const below = this._hideXTicks ? 4 : 6 + xt.extent + 6;
      ctx.fillText(this._xlabel.text, plotX + plotW / 2, plotY + plotH + below);
    }
    if (on && this._ylabel) {
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = fLab;
      const left = this._hideYTicks ? 4 : 4 + 6 + yt.maxW + 6;
      ctx.translate(plotX - left, plotY + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._ylabel.text, 0, 0);
      ctx.restore();
    }

    if (this._legend) this._renderLegend(ctx, plotX, plotY, plotW, plotH);

    // colorbar — pinned right of the plot, full pre-aspect height (it doesn't shrink with an
    // equal-aspect image)
    if (cb && (lastCmapTrace || cb.scalar)) {
      const cbX = rect.x + rect.w - m.right + 10;
      _drawColorbar(ctx, cbX, fullPlotY, 12, fullPlotH, cb.cmap, cb.norm, cb.ticks, {
        textColor, frameColor, font: fTick, labelFont: fLab, label: this._colorbarOpts.label, labelsW: cb.labelsW,
        extend: this._colorbarOpts.extend || cb.extend, bandColors: cb.bandColors, extColors: cb.extColors,
      });
    }
  }

  // the plot rect for margins m, the scales (equal aspect applied), and the ticks for that size
  _layout(ctx, rect, m, XR, YR, xLog, yLog, fTick, fs) {
    let plotX = rect.x + m.left, plotY = rect.y + m.top;
    let plotW = rect.x + rect.w - m.right - plotX, plotH = rect.y + rect.h - m.bottom - plotY;
    if (plotW <= 1 || plotH <= 1) return null;
    const fullPlotY = plotY, fullPlotH = plotH;
    let { lo: xlo, hi: xhi } = XR, { lo: ylo, hi: yhi } = YR;
    // equal aspect: an image-led axes (matshow, a raster map) SHRINKS the plot rect so cells are
    // square; anything else WIDENS the data range, as matplotlib's adjustable='datalim' does
    if (this._aspect === 'equal' && !xLog && !yLog) {
      const dataW = xhi - xlo, dataH = yhi - ylo;
      const sx = plotW / dataW, sy = plotH / dataH;
      if (this._traces.some((t) => t.type === 'imshow' || (_KINDS[t.type] && _KINDS[t.type].image))) {
        const k = Math.min(sx, sy), nw = dataW * k, nh = dataH * k;
        plotX += (plotW - nw) / 2; plotY += (plotH - nh) / 2; plotW = nw; plotH = nh;
      } else if (sx < sy) {
        const c = (ylo + yhi) / 2, half = plotH / sx / 2; ylo = c - half; yhi = c + half;
      } else {
        const c = (xlo + xhi) / 2, half = plotW / sy / 2; xlo = c - half; xhi = c + half;
      }
    }
    const xScale = this._scaleOf(xlo, xhi, XR.inv, plotX, plotX + plotW, xLog);
    const yScale = this._scaleOf(ylo, yhi, YR.inv, plotY + plotH, plotY, yLog);
    const xt = _tickSpec(this, 'x', xScale, plotW, ctx, fTick, fs - 1);
    const yt = _tickSpec(this, 'y', yScale, plotH, ctx, fTick, fs - 1);
    let twinYt = null, twinXt = null;
    if (this._twin) { const ys = this._twin._ownScale('y', plotY + plotH, plotY); if (ys) twinYt = _tickSpec(this._twin, 'y', ys, plotH, ctx, fTick, fs - 1); }
    if (this._twinY) { const xs = this._twinY._ownScale('x', plotX, plotX + plotW); if (xs) twinXt = _tickSpec(this._twinY, 'x', xs, plotW, ctx, fTick, fs - 1); }
    return { plotX, plotY, plotW, plotH, fullPlotY, fullPlotH, xScale, yScale, xt, yt, twinYt, twinXt, xinv: XR.inv, yinv: YR.inv };
  }

  // the margins this layout's labels need
  _measure(rect, L, cb, fs) {
    const on = this._axisOn, xt = L.xt, yt = L.yt;
    let left = 6, right = 10, top = 8, bottom = 6;
    if (on && !this._hideYTicks) left = 4 + 6 + (this._ytickLabelsOff ? 0 : yt.maxW) + 6;
    if (on && this._ylabel) left += fs + 4;
    if (on && !this._hideXTicks) bottom = 6 + (this._xtickLabelsOff ? 0 : xt.extent) + 4;
    if (on && this._xlabel) bottom += fs + 8;
    if (this._title) top += fs + 2 + 6;
    if (L.twinXt) { top += 6 + L.twinXt.extent + 4; if (this._twinY._xlabel) top += fs + 6; }
    if (L.twinYt) right = Math.max(right, 4 + 6 + L.twinYt.maxW + 6 + (this._twin._ylabel ? fs + 4 : 0));
    if (cb) right = Math.max(right, 10 + 12 + 6 + cb.labelsW + 6 + (this._colorbarOpts.label ? fs + 4 : 0));
    // a legend anchored outside the axes (bbox_to_anchor) gets room
    const lo = this._legendOverflow ? this._legendOverflow({ x: L.plotX, y: L.plotY, w: L.plotW, h: L.plotH }) : null;
    if (lo) { left += lo.left; right += lo.right + (lo.right ? 4 : 0); top += lo.top; bottom += lo.bottom; }
    // x tick labels hang past the ends of the axis: half a flat label, a whole rotated one
    if (on && !this._hideXTicks && !this._xtickLabelsOff && xt.values.length) {
      const k = xt.rot ? Math.cos((xt.rot * Math.PI) / 180) : 0.5;
      for (let i = 0; i < xt.values.length; i++) {
        if (!xt.labels[i]) continue;
        const p = L.xScale.transform(xt.values[i]);
        const a = p - xt.widths[i] * k, b = xt.rot ? p : p + xt.widths[i] * k;
        if (a < rect.x + 2) left += rect.x + 2 - a;
        if (b > rect.x + rect.w - 2) right += b - (rect.x + rect.w - 2);
      }
    }
    return { left, right, top, bottom };
  }

  _scaleOf(lo, hi, inv, r0, r1, log) {
    const range = inv ? [r1, r0] : [r0, r1];
    return log ? new LogScale(_logBounds(lo, hi), range) : new LinearScale([lo, hi], range);
  }

  // the colorbar's labels, measured: the right margin depends on them
  // The colorbar: the mappable colorbar() was given, else the last colour-mapped trace; its
  // norm and colour map, its ticks and how wide their labels are (the right margin needs it).
  // A kind can describe its own bar (cbar: contourf's bands).
  _colorbarInfo(ctx, fTick) {
    const sm = this._colorbarOpts.scalar;
    if (sm) {
      // no data behind the bar: an unset end of the scale reads 0 … 1
      const norm = _resolveNorm(sm.norm, sm.vmin, sm.vmax, 0, 1, 1e-3);
      if (!(norm.vmin - norm.vmin === 0 && norm.vmax - norm.vmax === 0)) return null;
      const ticks = _cbTicks(norm, this.view ? this.view.h : 200, this._colorbarOpts);
      return { trace: null, scalar: true, norm, ticks, labelsW: _cbLabelsW(ticks, fTick), cmap: sm.cmap || this._theme.ramp || 'viridis', extend: null, bandColors: null, extColors: null };
    }
    let tr = this._colorbarOpts.mappable && this._traces.includes(this._colorbarOpts.mappable) ? this._colorbarOpts.mappable : null;
    if (!tr) for (const t of this._traces) if (t.type === 'imshow' || t.cvals || (_KINDS[t.type] && _KINDS[t.type].cmap && t.cmapped !== false)) tr = t;
    if (!tr) return null;
    const k = _KINDS[tr.type];
    const own = k && k.cbar ? k.cbar(this, tr) : null;
    const norm = own ? own.norm : this._cmapNorm(tr);
    if (!(norm.vmin - norm.vmin === 0 && norm.vmax - norm.vmax === 0)) return null;
    const h = this.view ? this.view.h : 200;
    const ticks = _cbTicks(norm, h, own && own.ticks && this._colorbarOpts.ticks == null ? { ...this._colorbarOpts, ticks: own.ticks } : this._colorbarOpts);
    return {
      trace: tr, norm, ticks, labelsW: _cbLabelsW(ticks, fTick),
      cmap: tr.opts.cmap || this._theme.ramp || 'viridis', extend: own ? own.extend : tr.opts.extend, bandColors: own ? own.bandColors : null, extColors: own ? own.extColors : null,
    };
  }

  // ── ranges ────────────────────────────────────────────────────────────────────────────────
  // The drawn range of one axis: { lo, hi (lo < hi), inv }. Explicit limits (null ends from
  // the data), else the data's extent widened by the margins. inv: left > right as given, or
  // flipped by invert_xaxis().
  _axisRange(axis, log) {
    const lim = axis === 'x' ? this._xlim : this._ylim;
    let [a, b] = lim ? this._limits(lim, axis, log) : this._autoExtent(axis, log);
    let inv = a > b;
    if (axis === 'x' ? this._xinv : this._yinv) inv = !inv;
    let lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo - lo !== 0 || hi - hi !== 0) { lo = log ? 1 : 0; hi = log ? 10 : 1; }
    if (lo === hi) { if (log) { lo /= 10; hi *= 10; } else { lo -= 0.5; hi += 0.5; } }
    return { lo, hi, inv };
  }

  // explicit limits, with a None (null) end filled from the data
  _limits(lim, axis, log) {
    let [lo, hi] = lim;
    if (lo == null || hi == null) {
      const [dlo, dhi] = this._autoExtent(axis, log);
      if (lo == null) lo = hi != null && hi < dlo ? dhi : dlo;
      if (hi == null) hi = lo != null && lo > dhi ? dlo : dhi;
    }
    return [lo, hi];
  }

  // the data extent along `axis` of every axes sharing it (subplots sharing, a twin), widened
  // by the margins — except where a sticky edge stops it (bars at 0, an image's extent)
  _autoExtent(axis, log) {
    const members = new Set(this._group(axis));
    const twin = axis === 'x' ? this._twin : this._twinY;
    if (twin) members.add(twin);
    let lo = Infinity, hi = -Infinity;
    const sticky = [];
    for (const ax of members) {
      const r = ax._rawExtent(axis, log);
      if (r.lo < lo) lo = r.lo;
      if (r.hi > hi) hi = r.hi;
      for (const v of r.sticky) sticky.push(v);
    }
    if (!(lo <= hi)) return log ? [1, 10] : [0, 1];
    const m = axis === 'x' ? this._xmargin : this._ymargin;
    let plo, phi;
    if (log) { const f = Math.pow(hi / lo, m); plo = lo / f; phi = hi * f; }
    else { const pad = (hi - lo) * m; plo = lo - pad; phi = hi + pad; }
    for (const v of sticky) { if (v <= lo && v > plo) plo = v; if (v >= hi && v < phi) phi = v; }
    return [plo, phi];
  }

  // the norm of a colour-mapped trace: its norm option (an instance, 'linear', 'log'), with
  // vmin / vmax, filled from the trace's finite data range. A kind can give its own range
  // (crange) and norm (cnorm: contourf's levels).
  _cmapNorm(trace) {
    const k = _KINDS[trace.type];
    if (k && k.cnorm) return k.cnorm(this, trace);
    const o = trace.opts;
    const r = trace.type === 'imshow' ? this._imshowRange(trace)
      : k && k.crange ? k.crange(this, trace)
        : _traceRange(trace, 'c', trace.cvals, o.norm === 'log' || (o.norm && o.norm.constructor && o.norm.constructor.name === 'LogNorm'));
    return _resolveNorm(o.norm, o.vmin, o.vmax, r.lo, r.hi, r.minPos);
  }
  // vmin / vmax of a colour-mapped trace (kept for callers outside plot)
  _cmapRange(trace) { const n = this._cmapNorm(trace); return { vmin: n.vmin, vmax: n.vmax, norm: n }; }

  _imshowRange(trace) {
    const c = trace._cache || (trace._cache = {});
    if (c.range_img) return c.range_img;
    const nodata = trace.opts.nodata;
    if (nodata == null) return (c.range_img = _traceRange(trace, 'data', trace.data));
    let lo = Infinity, hi = -Infinity;
    const d = trace.data;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v - v !== 0 || v === nodata) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (c.range_img = { lo, hi });
  }

  // Render this axes' traces into the given plot rect, clipped. Returns
  // the last trace that contributed a colormap (for colorbar rendering).
  // Shared with the twin overlay paths.
  _renderTraces(ctx, xScale, yScale, plotX, plotY, plotW, plotH, dpr = 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();
    const rect = { x: plotX, y: plotY, w: plotW, h: plotH, dpr };
    let lastCmapTrace = null;
    const order = this._traces.map((t, i) => [t.opts && t.opts.zorder != null ? +t.opts.zorder : (_ZORDER[t.type] ?? (_KINDS[t.type] ? _KINDS[t.type].z ?? 1 : 1)), i]);
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // text, annotations and bar labels aren't clipped to the axes (matplotlib: clip_on=False
    // for text): they draw after the clipped pass, still in zorder
    const free = (t) => t.type === 'text' || (_KINDS[t.type] && _KINDS[t.type].noclip);
    const draw = (trace) => {
      if (trace.hidden) return;                          // set_visible(false)
      switch (trace.type) {
        case 'imshow': this._renderImshow(ctx, trace, xScale, yScale, rect); lastCmapTrace = trace; break;
        case 'line': this._renderLine(ctx, trace, xScale, yScale, rect); break;
        case 'scatter': this._renderScatter(ctx, trace, xScale, yScale, rect); if (trace.cvals) lastCmapTrace = trace; break;
        case 'hline': this._renderHline(ctx, trace, xScale, yScale, plotX, plotW); break;
        case 'vline': this._renderVline(ctx, trace, xScale, yScale, plotY, plotH); break;
        case 'text': this._renderText(ctx, trace, xScale, yScale, rect); break;
        default: {
          const k = _KINDS[trace.type];
          if (k) { k.render(this, ctx, trace, xScale, yScale, rect); if (k.cmap && trace.cmapped !== false) lastCmapTrace = trace; }
        }
      }
    };
    for (const [, ti] of order) if (!free(this._traces[ti])) draw(this._traces[ti]);
    ctx.restore();
    for (const [, ti] of order) if (free(this._traces[ti])) draw(this._traces[ti]);
    return lastCmapTrace;
  }

  // the y-scale of a twin that only has its own y (twinx), or x (twiny)
  _ownScale(axis, r0, r1) {
    const log = (axis === 'x' ? this._xscale : this._yscale) === 'log';
    const lim = axis === 'x' ? this._xlim : this._ylim;
    if (!lim && !this._traces.length) return null;
    const R = this._axisRange(axis, log);
    return this._scaleOf(R.lo, R.hi, R.inv, r0, r1, log);
  }

  // Render as a twinx overlay — shares the parent's xScale, uses own y-scale, draws the
  // y-axis ticks/label on the right edge of the rect. Title/xlabel/legend belong to parent.
  _renderAsTwin(ctx, parentXScale, plotX, plotY, plotW, plotH, dpr = 1, spec) {
    const yScale = this._ownScale('y', plotY + plotH, plotY);
    if (!yScale) return;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale: parentXScale, yScale, dpr };
    this._renderTraces(ctx, parentXScale, yScale, plotX, plotY, plotW, plotH, dpr);
    const th = this._theme, tc = this._textColor || th.foreground, fc = this._frameColor || th.frame;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    if (spec) _drawTicks(ctx, spec, yScale, 'right', plot, tc, fc, _font(th, -1));
    // the right ylabel, rotated +90° so it reads top to bottom (matplotlib's right axis)
    if (this._ylabel) {
      ctx.save();
      ctx.fillStyle = tc;
      ctx.font = _font(th, 0);
      ctx.translate(plotX + plotW + 4 + 6 + (spec ? spec.maxW : 0) + 6, plotY + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._ylabel.text, 0, 0);
      ctx.restore();
    }
  }

  // a twiny overlay: shares the parent's y, its own x along the TOP edge
  _renderAsTwinY(ctx, parentYScale, plotX, plotY, plotW, plotH, dpr = 1, spec) {
    const xScale = this._ownScale('x', plotX, plotX + plotW);
    if (!xScale) return;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale, yScale: parentYScale, dpr };
    this._renderTraces(ctx, xScale, parentYScale, plotX, plotY, plotW, plotH, dpr);
    const th = this._theme, tc = this._textColor || th.foreground, fc = this._frameColor || th.frame;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    if (spec) _drawTicks(ctx, spec, xScale, 'top', plot, tc, fc, _font(th, -1));
    if (this._xlabel) {
      ctx.fillStyle = tc;
      ctx.font = _font(th, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._xlabel.text, plotX + plotW / 2, plotY - 6 - (spec ? spec.extent : 0) - 6);
    }
  }

  // { lo, hi, sticky } of everything this axes draws along `axis` (no margins). `log`: only
  // positive values count. sticky: edges the margins must not cross (bars and histograms at
  // 0, images at their extent). Kept: _dataExtent, the padded range (callers outside plot).
  _rawExtent(axis, log = false) {
    let lo = Infinity, hi = -Infinity;
    const sticky = [];
    const take = (v) => { if (v - v === 0 && (!log || v > 0)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    const stick = (v) => { if (v - v === 0 && (!log || v > 0)) sticky.push(v); };
    const takeRange = (r) => { if (!r.n) return; take(log ? r.minPos : r.lo); take(r.hi); };
    for (const trace of this._traces) {
      switch (trace.type) {
        case 'line':
        case 'scatter':
          takeRange(_traceRange(trace, axis, axis === 'x' ? trace.x : trace.y, log));
          break;
        case 'imshow': {
          const e = this._imshowExtent(trace);
          const [a, b] = axis === 'x' ? [e[0], e[1]] : [e[2], e[3]];
          take(a); take(b); stick(a); stick(b);
          break;
        }
        case 'hline': if (axis === 'y') take(trace.y); break;
        case 'vline': if (axis === 'x') take(trace.x); break;
        case 'text': if (!trace.opts.transform) take(axis === 'x' ? trace.x : trace.y); break;
        default: { const k = _KINDS[trace.type]; if (k && k.extent) k.extent(this, trace, axis, log, take, stick); }
      }
    }
    return { lo, hi, sticky };
  }
  _dataExtent(axis, log = false) { return this._autoExtent(axis, log); }

  _imshowExtent(trace) {
    return trace.opts.extent || [0, trace.nx, 0, trace.ny];
  }

  // ── histogram ─────────────────────────────────────────────────────────────────────────────
  // Counted once per trace (traces are immutable) in one pass: uniform bins index directly,
  // given edges binary-search. numpy's rules: the last bin includes its right edge; NaN and
  // values outside the range are left out; a value that rounds into the wrong bin is moved
  // back (numpy's own correction), so counts match numpy.histogram exactly.
  _hist(trace) {
    const c = trace._cache || (trace._cache = {});
    if (c.hist) return c.hist;
    const data = trace.data, o = trace.opts, w = o.weights || null;
    let edges;
    if (o.bins != null && typeof o.bins !== 'number') {
      edges = Array.from(o.bins);
    } else {
      const nb = Math.max(1, (o.bins || 10) | 0);
      let lo, hi;
      if (o.range) { lo = +o.range[0]; hi = +o.range[1]; }
      else { const r = _traceRange(trace, 'data', data); lo = r.n ? r.lo : 0; hi = r.n ? r.hi : 1; }
      if (lo === hi) { lo -= 0.5; hi += 0.5; }
      edges = new Array(nb + 1);
      const step = (hi - lo) / nb;
      for (let i = 0; i <= nb; i++) edges[i] = lo + i * step;
      edges[nb] = hi;
    }
    const nb = edges.length - 1;
    const counts = new Float64Array(Math.max(0, nb));
    if (nb > 0) {
      const lo = edges[0], hi = edges[nb];
      const uniform = typeof o.bins !== 'object' || o.bins == null;
      const E = Float64Array.from(edges);
      const k = nb / (hi - lo), len = data.length;
      if (uniform && !w) {
        const ic = _countUniform(data, lo, hi, nb, E);
        for (let b = 0; b < nb; b++) counts[b] = ic[b];
      } else {
        for (let i = 0; i < len; i++) {
          const v = data[i];
          if (!(v >= lo && v <= hi)) continue;
          let b;
          if (uniform) {
            b = ((v - lo) * k) | 0;
            if (b >= nb) b = nb - 1;
            if (v < E[b]) b--;
            else if (b < nb - 1 && v >= E[b + 1]) b++;
          } else {
            let L = 0, R = nb - 1;                           // largest b with edges[b] <= v
            while (L < R) { const m = (L + R + 1) >> 1; if (E[m] <= v) L = m; else R = m - 1; }
            b = L;
          }
          counts[b] += w ? w[i] : 1;
        }
      }
    }
    let out = Array.from(counts);
    if (o.density) {
      let total = 0;
      for (const v of out) total += v;
      out = out.map((v, i) => (total > 0 ? v / (total * (edges[i + 1] - edges[i])) : 0));
    }
    if (o.cumulative) {
      let acc = 0;
      out = out.map((v, i) => (acc += o.density ? v * (edges[i + 1] - edges[i]) : v));
    }
    return (c.hist = { edges, counts: out });
  }

  // kept for callers that read them (plt.hist's return value, tests)
  _computeHistBins(trace) { return { bins: this._hist(trace).edges }; }
  _computeHistCounts(trace) { return this._hist(trace).counts; }

  // --- trace renderers ---

  // a trace's pixel positions at this view (cached until the view changes)
  _positions(trace, xs, ys) {
    const key = `${xs.domain}|${xs.range}|${xs.log}|${ys.domain}|${ys.range}|${ys.log}`;
    const c = trace._cache || (trace._cache = {});
    if (c.pos && c.pos.key === key) return c.pos;
    const n = trace.x.length;
    const X = new Float32Array(n), Y = new Float32Array(n);
    if (!xs.log && !ys.log) {
      // one pass for both columns (the common case); a point with either coordinate
      // non-finite gets NaN for both
      const x = trace.x, y = trace.y, ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b;
      for (let i = 0; i < n; i++) {
        const xv = x[i], yv = y[i];
        if (xv - xv === 0 && yv - yv === 0) { X[i] = ax * xv + bx; Y[i] = ay * yv + by; }
        else { X[i] = NaN; Y[i] = NaN; }
      }
    } else {
      _project(trace.x, xs, X);
      _project(trace.y, ys, Y);
      for (let i = 0; i < n; i++) if (X[i] !== X[i] || Y[i] !== Y[i]) { X[i] = NaN; Y[i] = NaN; }
    }
    return (c.pos = { key, X, Y, grid: null });
  }

  _renderLine(ctx, trace, xScale, yScale, rect) {
    const { x, y, opts } = trace;
    if (!x.length) return;
    const color = opts.color || this._theme.cycle[0];
    const alpha = opts.alpha != null ? opts.alpha : 1;
    if (!_noLine(opts.linestyle)) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = opts.linewidth || 1.5;
      const dash = dashArray(opts.linestyle);
      ctx.setLineDash(dash);
      const n = x.length, dpr = rect.dpr;
      const c = trace._cache || (trace._cache = {});
      if (c.mono === undefined) c.mono = _isNumericCol(x) && _isMonotonic(x);
      const m4 = _engine.m4 && !dash.length && c.mono && n > 4 * _M4_SUB * rect.w * dpr;
      const build = (target) => (m4 ? this._pathM4(target, x, y, xScale, yScale, dpr) : this._pathFull(target, x, y, xScale, yScale));
      if (n > 1000 && typeof Path2D !== 'undefined' && !isRecordingContext(ctx)) {
        // a long line on a real canvas: build its path once per view, then a redraw is one
        // stroke (a draw list has no Path2D, so recording still writes the vertices out)
        const key = `${xScale.domain}|${xScale.range}|${yScale.domain}|${yScale.range}|${dpr}|${m4}`;
        if (!c.path || c.path.key !== key) { const p = new Path2D(); build(p); c.path = { key, p }; }
        ctx.stroke(c.path.p);
      } else {
        ctx.beginPath();
        build(ctx);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // markers
    if (opts.marker) {
      // markersize: the diameter in points, default 6 (matplotlib's lines.markersize)
      const r = ((opts.markersize || 6) * this._dpi) / 144;
      const face = opts.markerfacecolor ? _cssColor(opts.markerfacecolor) : color;
      const edge = opts.markeredgecolor ? { color: _cssColor(opts.markeredgecolor), width: ((opts.markeredgewidth ?? 1) * this._dpi) / 72 } : null;   // points, as matplotlib's
      const pos = this._positions(trace, xScale, yScale);
      this._drawPoints(ctx, trace, pos, rect, { marker: opts.marker, radius: r, uniform: face, alpha, edge, cacheKey: 'mk' });
    }
  }

  // every vertex; a non-finite point (or ≤ 0 on a log axis) lifts the pen
  _pathFull(ctx, x, y, xs, ys) {
    const ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b, xl = xs.log, yl = ys.log;
    let pen = false;
    for (let i = 0; i < x.length; i++) {
      const xv = x[i], yv = y[i];
      const X = xl ? (xv > 0 ? ax * Math.log10(xv) + bx : NaN) : ax * xv + bx;
      const Y = yl ? (yv > 0 ? ay * Math.log10(yv) + by : NaN) : ay * yv + by;
      if (X - X !== 0 || Y - Y !== 0) { pen = false; continue; }
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    }
  }

  // M4 decimation for long lines with non-decreasing x: per column, keep the first, the min,
  // the max and the last vertex, in index order; a NaN still breaks the line. The columns are
  // QUARTER device pixels: M4 at whole pixels is exact for aliased 1-px lines, but an
  // antialiased stroke over a dense column zigzags across its whole width, and one vertical
  // stroke per pixel draws a visibly thinner, lopsided band. Four per pixel keeps that spread
  // for ~16 vertices per pixel — still a few thousand for a figure, however long the line.
  _pathM4(ctx, x, y, xs, ys, dpr) {
    const ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b, xl = xs.log, yl = ys.log;
    let pen = false, col = NaN, iF = -1, iL = -1, iMin = -1, iMax = -1, yMin = 0, yMax = 0;
    const emit = (i) => {
      const xv = x[i], yv = y[i];
      const X = xl ? ax * Math.log10(xv) + bx : ax * xv + bx;
      const Y = yl ? ay * Math.log10(yv) + by : ay * yv + by;
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    };
    const flush = () => {
      if (iF < 0) return;
      const ids = [iF, iMin, iMax, iL].sort((p, q) => p - q);
      let last = -1;
      for (const i of ids) if (i !== last) { emit(i); last = i; }
      iF = -1;
    };
    for (let i = 0; i < x.length; i++) {
      const xv = x[i], yv = y[i];
      const X = xl ? (xv > 0 ? ax * Math.log10(xv) + bx : NaN) : ax * xv + bx;
      const Y = yl ? (yv > 0 ? ay * Math.log10(yv) + by : NaN) : ay * yv + by;
      if (X - X !== 0 || Y - Y !== 0) { flush(); pen = false; col = NaN; continue; }
      const k = Math.floor(X * dpr * _M4_SUB);
      if (k !== col) { flush(); col = k; iF = iL = iMin = iMax = i; yMin = yMax = Y; continue; }
      iL = i;
      if (Y < yMin) { yMin = Y; iMin = i; }
      if (Y > yMax) { yMax = Y; iMax = i; }
    }
    flush();
  }

  _renderScatter(ctx, trace, xScale, yScale, rect) {
    const o = trace.opts;
    const pos = this._positions(trace, xScale, yScale);
    // s is matplotlib's: the marker's AREA in points², default 36 (lines.markersize²). Its
    // diameter is √s points, so the radius in px is √s · dpi / 144.
    const rk = this._dpi / 144;
    const sz = trace.s ? trace.s : (typeof o.s === 'number' ? o.s : 36);
    const radius = typeof sz === 'number' ? Math.sqrt(sz) * rk : sz;   // per-point: resolved in _drawPoints
    const alpha = o.alpha != null ? o.alpha : 1;
    let edge = null;
    if (o.edgecolor != null && o.edgecolor !== 'none') {
      // edge width in points (matplotlib's); 0.5 px when not given
      edge = { color: o.edgecolor === 'face' ? 'face' : _cssColor(o.edgecolor), width: o.linewidth != null ? (o.linewidth * this._dpi) / 72 : 0.5 };
    }
    const spec = { marker: o.marker || 'o', radius, rk, alpha, edge, cacheKey: 'sc' };
    if (trace.cvals) {
      // a highlight subset keeps the colour scale of the trace it came from
      const norm = trace._norm || this._cmapNorm(trace);
      spec.cmap = { name: o.cmap || this._theme.ramp || 'viridis', norm, vmin: norm.vmin, vmax: norm.vmax };
    } else if (trace.colors) spec.list = trace.colors;
    else spec.uniform = o.color;
    this._drawPoints(ctx, trace, pos, rect, spec);
  }

  // colour-map indices for a trace (0–255, -1 for NaN), cached on (cmap, vmin, vmax)
  _cmapIdx(trace, norm) {
    const c = trace._cache || (trace._cache = {});
    const key = norm._key;
    if (c.cidx && c.cidx.key === key) return c.cidx.idx;
    const v = trace.cvals, n = v.length, idx = new Int16Array(n), at = _indexer(norm);
    for (let i = 0; i < n; i++) idx[i] = at(v[i]);
    c.cidx = { key, idx };
    return idx;
  }

  // Draw a set of markers: vector paths for a few, one raster for many (see the header).
  //   spec: { marker, radius (px or per-point s column), alpha, edge, uniform | cmap | list, cacheKey }
  _drawPoints(ctx, trace, pos, rect, spec) {
    const n = pos.X.length;
    if (!n) return;
    const perPoint = typeof spec.radius !== 'number';
    // resolve the colour source into bytes, if it can be rasterized at all
    let lut = null, idx = null, uni = null, bytes = null, cmapFn = null;
    if (spec.cmap) {
      cmapFn = getCmap(spec.cmap.name);
      lut = _cmapLut(spec.cmap.name);
    } else if (spec.list) {
      const c = trace._cache || (trace._cache = {});
      if (c.listBytes === undefined) {
        const b = new Uint8ClampedArray(n * 4);
        let ok = true;
        for (let i = 0; i < n && ok; i++) { const v = _colorBytes(spec.list[i]); if (!v) ok = false; else b.set(v, i * 4); }
        c.listBytes = ok ? b : null;
      }
      bytes = c.listBytes;
    } else uni = _colorBytes(spec.uniform);
    const rasterizable = (spec.cmap ? !!lut : spec.list ? !!bytes : !!uni) && (!spec.edge || spec.edge.color === 'face' || !!_colorBytes(spec.edge.color));
    if (n > _engine.rasterMin && rasterizable && this._rasterPoints(ctx, trace, pos, rect, spec, { lut, uni, bytes })) return;

    // ── vector ──
    if (spec.cmap) idx = this._cmapIdx(trace, spec.cmap.norm);
    const alpha = spec.alpha;
    const fillOf = (i) => spec.cmap ? (lut ? null : cmapFn(idx[i] < 0 ? NaN : (idx[i] + 0.5) / 256)) : spec.list ? spec.list[i] : spec.uniform;
    const rOf = (i) => (perPoint ? Math.sqrt(spec.radius[i]) * spec.rk : spec.radius);
    const X = pos.X, Y = pos.Y;
    if (_engine.batch && alpha >= 1 && !spec.edge && !perPoint) {
      // batch: one path per colour (colour-mapped points group into ≤ 256 LUT colours; within
      // a colour, overlap order is data order, across colours it is colour order)
      const shape = _markerShape(spec.marker, spec.radius);
      const stroke = shape.kind === 'strokes';
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        if (X[i] !== X[i]) continue;
        let key;
        if (spec.cmap) { if (idx[i] < 0) continue; key = idx[i]; } else key = spec.list ? spec.list[i] : 0;
        let g = groups.get(key); if (!g) groups.set(key, (g = [])); g.push(i);
      }
      const keys = spec.cmap ? Array.from(groups.keys()).sort((a, b) => a - b) : Array.from(groups.keys());
      for (const k of keys) {
        const color = spec.cmap ? (lut ? `rgb(${lut[k * 4]},${lut[k * 4 + 1]},${lut[k * 4 + 2]})` : cmapFn((k + 0.5) / 256)) : spec.list ? k : spec.uniform;
        ctx.beginPath();
        for (const i of groups.get(k)) _pathMarker(ctx, shape, X[i], Y[i]);
        if (stroke) { ctx.strokeStyle = color; ctx.lineWidth = shape.lw; ctx.stroke(); }
        else { ctx.fillStyle = color; ctx.fill(); }
      }
      return;
    }
    // per point: alpha < 1 or an edge — each marker composites over the last, as matplotlib's do
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      if (X[i] !== X[i]) continue;
      if (spec.cmap && idx[i] < 0) continue;
      const shape = _markerShape(spec.marker, rOf(i));
      let fill = fillOf(i);
      if (fill == null) fill = `rgb(${lut[idx[i] * 4]},${lut[idx[i] * 4 + 1]},${lut[idx[i] * 4 + 2]})`;
      ctx.beginPath();
      _pathMarker(ctx, shape, X[i], Y[i]);
      if (shape.kind === 'strokes') { ctx.strokeStyle = fill; ctx.lineWidth = shape.lw; ctx.stroke(); continue; }
      ctx.fillStyle = fill;
      ctx.fill();
      if (spec.edge) {
        ctx.strokeStyle = spec.edge.color === 'face' ? fill : spec.edge.color;
        ctx.lineWidth = spec.edge.width;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // the raster path for many points; false if this host can't blit (caller draws vectors)
  _rasterPoints(ctx, trace, pos, rect, spec, col) {
    const dpr = rect.dpr;
    const W = Math.max(1, Math.round(rect.w * dpr)), H = Math.max(1, Math.round(rect.h * dpr));
    const c = trace._cache || (trace._cache = {});
    const holderKey = 'raster_' + spec.cacheKey;
    const key = `${pos.key}|${W}x${H}|${dpr}|${spec.cmap ? spec.cmap.norm._key + ',' + spec.cmap.name : ''}|${spec.alpha}`;
    let h = c[holderKey];
    if (!h || h.key !== key) {
      const n = pos.X.length;
      let rad;
      if (typeof spec.radius === 'number') rad = spec.radius * dpr;
      else { rad = new Float32Array(n); for (let i = 0; i < n; i++) rad[i] = Math.sqrt(spec.radius[i]) * spec.rk * dpr; }
      let colors;
      if (col.lut) colors = { lut: col.lut, idx: this._cmapIdx(trace, spec.cmap.norm) };   // the norm's LUT entries
      else colors = col.bytes ? { bytes: col.bytes } : { uniform: col.uni };
      const edge = spec.edge ? { bytes: spec.edge.color === 'face' ? 'face' : _colorBytes(spec.edge.color), width: spec.edge.width * dpr } : null;
      const rgba = _rasterPoints(W, H, pos.X, pos.Y, rect.x, rect.y, dpr, rad, spec.marker, colors, spec.alpha, edge);
      h = c[holderKey] = { key, rgba, W, H };
    }
    return _blit(ctx, rect.x, rect.y, rect.w, rect.h, h.W, h.H, h.rgba, h, false);
  }

  // An image is ONE RGBA buffer (built with the colour map's LUT, cached on the trace until
  // vmin / vmax / cmap / origin change), blitted into its extent: one drawImage live, one
  // 'image' op recorded. NaN and nodata cells are transparent.
  _renderImshow(ctx, trace, xScale, yScale) {
    const { data, nx, ny, opts } = trace;
    const nodata = opts.nodata;
    const origin = opts.origin || 'lower';
    const cmapName = opts.cmap || this._theme.ramp || 'viridis';
    const norm = this._cmapNorm(trace);
    const c = trace._cache || (trace._cache = {});
    const key = `${norm._key}|${origin}|${nodata}`;
    let img = c.img;
    if (!img || img.key !== key || img.cmap !== cmapName) {
      const rgba = new Uint8ClampedArray(nx * ny * 4);
      const lut = _cmapLut(cmapName), fn = lut ? null : getCmap(cmapName);
      const at = _indexer(norm);
      for (let iy = 0; iy < ny; iy++) {
        // image row 0 is the TOP: origin='lower' puts data row ny-1 there
        const row = origin === 'lower' ? ny - 1 - iy : iy;
        for (let ix = 0; ix < nx; ix++) {
          const v = data[iy * nx + ix];
          if (v - v !== 0 || (nodata != null && v === nodata)) continue;   // transparent
          let q = at(v);
          if (q < 0) continue;                             // LogNorm of v ≤ 0: no colour
          const o = (row * nx + ix) * 4;
          if (lut) {
            q *= 4;
            rgba[o] = lut[q]; rgba[o + 1] = lut[q + 1]; rgba[o + 2] = lut[q + 2]; rgba[o + 3] = lut[q + 3];
          } else {
            const b = _colorBytes(fn((q + 0.5) / 256));
            if (b) { rgba[o] = b[0]; rgba[o + 1] = b[1]; rgba[o + 2] = b[2]; rgba[o + 3] = b[3]; }
          }
        }
      }
      img = c.img = { key, cmap: cmapName, rgba };
    }
    const e = this._imshowExtent(trace);
    const x0 = xScale.transform(e[0]), x1 = xScale.transform(e[1]);
    const yA = yScale.transform(e[2]), yB = yScale.transform(e[3]);
    const smooth = opts.interpolation === 'bilinear' || opts.interpolation === 'antialiased';
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    const ok = _blit(ctx, Math.min(x0, x1), Math.min(yA, yB), Math.abs(x1 - x0), Math.abs(yB - yA), nx, ny, img.rgba, img, smooth);
    if (!ok) this._imshowCells(ctx, img.rgba, nx, ny, x0, x1, yA, yB);
    ctx.globalAlpha = 1;
  }

  // last resort for a context that can't take an image: one fillRect per cell
  _imshowCells(ctx, rgba, nx, ny, x0, x1, yA, yB) {
    const left = Math.min(x0, x1), top = Math.min(yA, yB);
    const cw = Math.abs(x1 - x0) / nx, ch = Math.abs(yB - yA) / ny;
    for (let r = 0; r < ny; r++) for (let q = 0; q < nx; q++) {
      const o = (r * nx + q) * 4;
      if (!rgba[o + 3]) continue;
      ctx.fillStyle = `rgba(${rgba[o]},${rgba[o + 1]},${rgba[o + 2]},${rgba[o + 3] / 255})`;
      ctx.fillRect(left + q * cw, top + r * ch, cw + 0.5, ch + 0.5);
    }
  }

  // text(x, y, s): x, y in data coordinates, or with {transform: 'axes'} (matplotlib's
  // ax.transAxes) as fractions of the axes, 0–1 from the lower left
  _renderText(ctx, trace, xScale, yScale, rect) {
    const o = trace.opts, axes = o.transform === 'axes' || o.transform === 'transAxes';
    const px = axes ? rect.x + trace.x * rect.w : xScale.transform(trace.x);
    const py = axes ? rect.y + (1 - trace.y) * rect.h : yScale.transform(trace.y);
    if (px - px !== 0 || py - py !== 0) return;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color || this._textColor || this._theme.foreground;
    const fsz = o.fontsize != null ? (typeof o.fontsize === 'number' ? o.fontsize : _FONTSIZES[o.fontsize] ?? 0) : null;
    ctx.font = `${o.fontweight === 'bold' ? 'bold ' : ''}${fsz != null ? (typeof o.fontsize === 'number' ? fsz : (this._theme.font_size || 11) + fsz) : (this._theme.font_size || 11)}px ${this._theme.mono}`;
    ctx.textAlign = { center: 'center', left: 'left', right: 'right' }[o.ha] || 'left';
    ctx.textBaseline = { center: 'middle', baseline: 'alphabetic', top: 'top', bottom: 'bottom' }[o.va] || 'alphabetic';
    ctx.translate(px, py);
    if (o.rotation) ctx.rotate((-(o.rotation === 'vertical' ? 90 : +o.rotation || 0) * Math.PI) / 180);
    ctx.fillText(String(trace.text), 0, 0);
    ctx.restore();
  }

  // ── highlight ─────────────────────────────────────────────────────────────────────────────
  // ax.highlight(sel, {trace, dim = 0.65}) — show some points and dim the rest: a veil over the
  // plot, then only the chosen points drawn again on top, in their own colours (a colour-mapped
  // trace keeps its full range). sel: indices, a boolean mask, or a predicate (i, x, y) → bool;
  // null clears. Indices and masks are of one scatter — {trace} (what scatter() returned, or
  // its index among the axes' scatters), the first by default; a predicate runs over every
  // scatter. A mask is booleans or a Uint8Array as long as the trace; any other array is
  // indices. A figure under interact() redraws itself; otherwise draw again.
  highlight(sel, opts) {
    const o = _plainOpts(opts) ? opts : {};
    if (sel == null || sel === false) this._highlight = null;
    else {
      const scatters = this._traces.filter((t) => t.type === 'scatter');
      let targets;
      if (typeof sel === 'function') targets = scatters;
      else {
        const t = o.trace && o.trace._trace ? o.trace._trace : typeof o.trace === 'number' ? scatters[o.trace] : scatters[0];
        if (!t) throw new Error('highlight: the axes has no scatter to highlight');
        targets = [t];
      }
      const subs = [];
      for (const t of targets) {
        const n = t.x.length, keep = [];
        if (typeof sel === 'function') { for (let i = 0; i < n; i++) if (sel(i, t.x[i], t.y[i])) keep.push(i); }
        // a mask: booleans, or a Uint8Array as long as the trace (indices: any other array)
        else if (sel.length === n && (typeof sel[0] === 'boolean' || sel instanceof Uint8Array)) {
          for (let i = 0; i < n; i++) if (sel[i]) keep.push(i);
        } else for (const i of sel) { const k = +i; if (k >= 0 && k < n && Number.isInteger(k)) keep.push(k); }
        subs.push({ src: t, keep });
      }
      this._highlight = { subs, dim: o.dim != null ? +o.dim : 0.65, built: null };
    }
    if (this.figure && this.figure._requestDraw) this.figure._requestDraw();
    return this;
  }
  _renderHighlight(ctx, xScale, yScale, plot, bgcolor) {
    const h = this._highlight;
    ctx.save();
    ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    ctx.globalAlpha = h.dim;
    ctx.fillStyle = bgcolor !== 'none' && bgcolor !== 'transparent' ? bgcolor : this._theme.background;
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
    ctx.globalAlpha = 1;
    // the subsets, built once per highlight (a fresh trace each, so their caches are their own)
    if (!h.built) {
      h.built = h.subs.map(({ src, keep }) => {
        const pick = (a) => { const out = new Float64Array(keep.length); for (let j = 0; j < keep.length; j++) out[j] = a[keep[j]]; return out; };
        const sub = { type: 'scatter', x: pick(src.x), y: pick(src.y), opts: src.opts, _index: Int32Array.from(keep) };
        if (src.cvals) { sub.cvals = pick(src.cvals); sub._norm = this._cmapNorm(src); }
        if (src.colors) sub.colors = keep.map((i) => src.colors[i]);
        if (src.s) sub.s = pick(src.s);
        return sub;
      });
    }
    for (const sub of h.built) if (sub.x.length) this._renderScatter(ctx, sub, xScale, yScale, plot);
    ctx.restore();
  }

  // ── picking ───────────────────────────────────────────────────────────────────────────────
  // ax.pick(px, py, {radius}) → the nearest thing drawn under (px, py), in CSS px of the
  // figure, after a render. Markers win over line vertices, which win over bars (picked by
  // column), which win over image cells. Searches this axes' traces and its twins'.
  //   → { axes, trace, traceIndex, kind, index, x, y, c, s, label, value } | null
  pick(px, py, opts) {
    const radius = (opts && opts.radius != null) ? opts.radius : 8;
    this._needView('pick');
    const owners = [this, this._twin, this._twinY].filter((a) => a && a.view);
    const best = { marker: null, vertex: null };
    for (const ax of owners) {
      const v = ax.view;
      ax._traces.forEach((t, ti) => {
        if (t.hidden) return;
        const isMarker = t.type === 'scatter' || (t.type === 'line' && t.opts.marker);
        if (t.type !== 'scatter' && t.type !== 'line') return;
        const pos = ax._positions(t, v.xScale, v.yScale);
        if (!pos.grid) pos.grid = _buildGrid(pos.X, pos.Y, v.x, v.y, v.w, v.h, 32);
        const hit = _queryGrid(pos.grid, px, py, radius);
        if (!hit) return;
        const slot = isMarker ? 'marker' : 'vertex';
        if (!best[slot] || hit.d <= best[slot].d) best[slot] = { ax, t, ti, i: hit.index, d: hit.d };
      });
    }
    const pt = best.marker || best.vertex;
    if (pt) {
      const t = pt.t, i = pt.i;
      return {
        axes: pt.ax, trace: t, traceIndex: pt.ti, kind: t.type === 'scatter' ? 'marker' : best.marker ? 'marker' : 'vertex', index: i,
        x: t.x[i], y: t.y[i],
        c: t.cvals ? t.cvals[i] : t.colors ? t.colors[i] : (t.opts.color ?? null),
        s: t.s ? t.s[i] : (typeof t.opts.s === 'number' ? t.opts.s : null),
        label: t.opts.label ?? null,
      };
    }
    // bars, histogram bins and other registered kinds that pick (the last drawn wins: on top)
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      if (px < v.x || px > v.x + v.w || py < v.y || py > v.y + v.h) continue;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti], k = _KINDS[t.type];
        if (!k || !k.pick || t.hidden) continue;
        const hit = k.pick(ax, t, px, py);
        if (hit) return { axes: ax, trace: t, traceIndex: ti, c: null, s: null, label: t.opts.label ?? null, ...hit };
      }
    }
    // image cells
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti];
        if (t.type !== 'imshow' || t.hidden) continue;
        const e = ax._imshowExtent(t);
        const xv = v.xScale.inverse(px), yv = v.yScale.inverse(py);
        const fx = (xv - e[0]) / (e[1] - e[0]), fy = (yv - e[2]) / (e[3] - e[2]);
        if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) continue;
        const col = Math.floor(fx * t.nx);
        // data row: origin 'lower' puts row 0 at the extent's y0
        const up = Math.floor(fy * t.ny);
        const row = (t.opts.origin || 'lower') === 'lower' ? up : t.ny - 1 - up;
        const index = row * t.nx + col;
        const cx = e[0] + ((col + 0.5) / t.nx) * (e[1] - e[0]), cy = e[2] + ((up + 0.5) / t.ny) * (e[3] - e[2]);
        return { axes: ax, trace: t, traceIndex: ti, kind: 'cell', index, col, row, x: cx, y: cy, value: t.data[index], c: null, s: null, label: t.opts.label ?? null };
      }
    }
    return null;
  }
}

// The common histogram, in its own function so the engine optimizes this loop alone: uniform
// bins, no weights, integer counts. numpy's correction (a value that rounds into the
// neighbouring bin is moved back) is only needed within a hair of an edge, so the edges are
// read only there.
// (The hot path never reassigns b — engines keep it a small integer then — and counts into
// nb + 1 slots, so v = hi needs no branch: slot nb folds into the last bin at the end.)
function _countUniform(data, lo, hi, nb, E) {
  const ic = new Uint32Array(nb + 1), k = nb / (hi - lo), len = data.length;
  for (let i = 0; i < len; i++) {
    const v = data[i];
    if (!(v >= lo && v <= hi)) continue;                     // NaN fails both
    const f = (v - lo) * k;
    const b = f | 0;
    const frac = f - b;
    if (frac < 1e-6 || frac > 0.999999) { ic[_binExact(v, b, nb, E)]++; continue; }
    ic[b]++;
  }
  ic[nb - 1] += ic[nb];
  return ic.subarray(0, nb);
}

// the bin of v by the real edges, from a guess b that may be one off (numpy's correction)
function _binExact(v, b, nb, E) {
  if (b >= nb) b = nb - 1;
  if (v < E[b]) b--;
  else if (b < nb - 1 && v >= E[b + 1]) b++;
  return b;
}

// Log scale needs strictly-positive bounds; clamp lo (falling back to hi/1e6 or 1e-9).
function _logBounds(lo, hi) {
  let l = lo, h = hi;
  if (!(l > 0)) l = h > 0 ? h / 1e6 : 1e-9;
  if (!(h > l)) h = l * 10;
  return [l, h];
}

// -- axis.js --

// ax.xaxis / ax.yaxis — matplotlib's Axis objects, as far as a chart's code reaches for them:
// the tick formatters and locators (major and minor), a date axis, the axis label. They hold
// their settings on the axes they belong to, for every axes sharing that axis.



class Axis {
  constructor(ax, name) { this.axes = ax; this.axis_name = name; }
  _set(k, v) {
    for (const a of this.axes._group(this.axis_name)) a._ticker(this.axis_name)[k] = v;
    return this;
  }
  set_major_formatter(f) { return this._set('majorF', f == null ? null : _asFormatter(f)); }
  set_minor_formatter(f) { return this._set('minorF', f == null ? null : _asFormatter(f)); }
  set_major_locator(l) { return this._set('majorL', l == null ? null : _asLocator(l)); }
  set_minor_locator(l) { return this._set('minorL', l == null ? null : _asLocator(l)); }
  get_major_formatter() { return this.axes._ticker(this.axis_name).majorF; }
  get_minor_formatter() { return this.axes._ticker(this.axis_name).minorF; }
  get_major_locator() { return this.axes._ticker(this.axis_name).majorL; }
  get_minor_locator() { return this.axes._ticker(this.axis_name).minorL; }
  // the axis holds dates: numbers on it are ms since 1970 UTC (Date objects say so by themselves)
  axis_date(_tz) { for (const a of this.axes._group(this.axis_name)) a[this.axis_name === 'x' ? '_xdate' : '_ydate'] = true; return this; }
  set_label_text(s, opts) { return this.axes[this.axis_name === 'x' ? 'set_xlabel' : 'set_ylabel'](s, opts); }
  get_label_text() { const l = this.axes[this.axis_name === 'x' ? '_xlabel' : '_ylabel']; return l ? l.text : ''; }
  set_ticks(ticks, labels, opts) { return this.axes[this.axis_name === 'x' ? 'set_xticks' : 'set_yticks'](ticks, labels, opts); }
  get_ticklocs() { return this.axes[this.axis_name === 'x' ? 'get_xticks' : 'get_yticks'](); }
  get_ticklabels() { return this.axes[this.axis_name === 'x' ? 'get_xticklabels' : 'get_yticklabels'](); }
  __repr__() { return `<${this.axis_name.toUpperCase()}Axis>`; }
}

Axes.prototype._ticker = function (axis) {
  const k = axis === 'x' ? '_tkx' : '_tky';
  return this[k] || (this[k] = { majorF: null, minorF: null, majorL: null, minorL: null, minorOn: false });
};
Object.defineProperty(Axes.prototype, 'xaxis', { get() { return this._xaxisObj || (this._xaxisObj = new Axis(this, 'x')); }, configurable: true });
Object.defineProperty(Axes.prototype, 'yaxis', { get() { return this._yaxisObj || (this._yaxisObj = new Axis(this, 'y')); }, configurable: true });
Axes.prototype.xaxis_date = function (tz) { this.xaxis.axis_date(tz); return this; };
Axes.prototype.yaxis_date = function (tz) { this.yaxis.axis_date(tz); return this; };
// minor ticks between the majors (AutoMinorLocator), on both axes
Axes.prototype.minorticks_on = function () { for (const a of ['x', 'y']) for (const g of this._group(a)) g._ticker(a).minorOn = true; return this; };
Axes.prototype.minorticks_off = function () { for (const a of ['x', 'y']) for (const g of this._group(a)) { const t = g._ticker(a); t.minorOn = false; t.minorL = null; } return this; };

// -- bars.js --

// Bars and histograms: bar, barh, hist, bar_label.
//
// A bar trace keeps the columns as given (x + heights for bar, y + widths for barh) plus the
// base each bar stands on (bottom / left) and its thickness, and answers one question for the
// renderer, the autoscale and the picker alike: its rectangles in data coordinates.
//
// Histograms (numpy's counting, data.js / axes.js _hist) share one set of bins across every
// dataset passed, as matplotlib does; several datasets draw side by side, or stacked.








const _num = (v, i) => (_isArrayLike(v) ? +v[i] : +v);
const _pick = (v, i) => (Array.isArray(v) ? v[i % v.length] : v);

// ── bar / barh ──
// bar(x, height, {width = 0.8, bottom = 0, align = 'center' | 'edge', color, edgecolor,
// linewidth, tick_label, label}) → a BarContainer: an array of the bars (each with
// get_x / get_y / get_width / get_height), .datavalues, .axes. Anything else read off it is
// the axes', so ax.bar(…).set_title(…) still chains.
function _bar(ax, orient, pos, size, opts) {
  const fn = orient === 'v' ? 'bar' : 'barh';
  const o = ax._opts(fn, opts);
  const P = ax._axisCol(orient === 'v' ? 'x' : 'y', pos), S = _col(size);
  if (P.length !== S.length) throw _lenErr(fn, orient === 'v' ? 'x' : 'y', P.length, orient === 'v' ? 'height' : 'width', S.length);
  const thickKey = orient === 'v' ? 'width' : 'height', baseKey = orient === 'v' ? 'bottom' : 'left';
  // on a date axis matplotlib's 0.8 is 0.8 of a DAY (its dates count days; plot's count ms)
  const onDates = orient === 'v' ? ax._xdate : ax._ydate;
  const thick = o[thickKey] == null ? (onDates ? 0.8 * 864e5 : 0.8) : _isArrayLike(o[thickKey]) ? _col(o[thickKey]) : +o[thickKey];
  const base = o[baseKey] == null ? null : _isArrayLike(o[baseKey]) ? _col(o[baseKey]) : +o[baseKey];
  if (o.align != null && o.align !== 'center' && o.align !== 'edge') _warn(`${fn}.align.${o.align}`, `${fn}(): align must be 'center' or 'edge', not '${o.align}'`, ax._strict);
  if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
  else if (!o.color) o.color = ax._nextColor();
  if (Array.isArray(o.edgecolor)) o.edgecolor = o.edgecolor.map(_cssColor);
  else if (o.edgecolor) o.edgecolor = _cssColor(o.edgecolor);
  const trace = orient === 'v' ? { type: 'bar', x: P, heights: S, opts: o } : { type: 'barh', y: P, widths: S, opts: o };
  trace.orient = orient; trace.thick = thick; trace.base = base;
  ax._traces.push(trace);
  // tick_label: labels at the bars' positions
  if (o.tick_label != null) {
    const labels = Array.isArray(o.tick_label) ? o.tick_label : Array.from(P, () => o.tick_label);
    ax[orient === 'v' ? 'set_xticks' : 'set_yticks'](Array.from(P), labels);
  }
  const rects = _barRects(trace);
  const patches = [];
  for (let i = 0; i < P.length; i++) {
    const r = { x: rects.x0[i], y: rects.y0[i], width: rects.x1[i] - rects.x0[i], height: rects.y1[i] - rects.y0[i] };
    patches.push({ ...r, get_x: () => r.x, get_y: () => r.y, get_width: () => r.width, get_height: () => r.height, get_xy: () => [r.x, r.y] });
  }
  return _result(ax, patches, { datavalues: S, orientation: orient === 'v' ? 'vertical' : 'horizontal', _trace: trace, patches,
    __repr__: () => `<BarContainer object of ${patches.length} artists>` });
}

// every bar's rectangle in data coordinates (x0 ≤ x1 not guaranteed: a negative height runs down)
function _barRects(t) {
  const c = t._cache || (t._cache = {});
  if (c.rects) return c.rects;
  const v = t.orient === 'v', P = v ? t.x : t.y, S = v ? t.heights : t.widths, n = P.length;
  const edge = t.opts.align === 'edge';
  const a0 = new Float64Array(n), a1 = new Float64Array(n), b0 = new Float64Array(n), b1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = _num(t.thick, i), base = t.base == null ? 0 : _num(t.base, i);
    a0[i] = edge ? P[i] : P[i] - w / 2; a1[i] = edge ? P[i] + w : P[i] + w / 2;
    b0[i] = base; b1[i] = base + S[i];
  }
  return (c.rects = v ? { x0: a0, x1: a1, y0: b0, y1: b1 } : { x0: b0, x1: b1, y0: a0, y1: a1 });
}

function _drawRects(ax, ctx, R, xScale, yScale, colorOf, opts, alpha) {
  ctx.globalAlpha = alpha;
  const lw = opts.linewidth;
  for (let i = 0; i < R.x0.length; i++) {
    const X0 = xScale.transform(R.x0[i]), X1 = xScale.transform(R.x1[i]);
    const Y0 = yScale.transform(yScale.log && !(R.y0[i] > 0) ? yScale.domain[0] : R.y0[i]);
    const Y1 = yScale.transform(R.y1[i]);
    if (X0 - X0 !== 0 || X1 - X1 !== 0 || Y0 - Y0 !== 0 || Y1 - Y1 !== 0) continue;
    const x = Math.min(X0, X1), y = Math.min(Y0, Y1), w = Math.abs(X1 - X0), h = Math.abs(Y1 - Y0);
    const fc = colorOf(i);
    if (fc && fc !== 'none') { ctx.fillStyle = fc; ctx.fillRect(x, y, w, h); }
    const ec = _pick(opts.edgecolor, i);
    if (ec && ec !== 'none') { ctx.strokeStyle = ec; ctx.lineWidth = lw == null ? 1 : _pick(lw, i); ctx.strokeRect(x, y, w, h); }
  }
  ctx.globalAlpha = 1;
}

// the bar (or bin) under a pixel: vertical bars by column, horizontal by row (the whole
// column / row, above or beside the bar too — the bar is the column's subject)
function _pickRects(ax, t, R, px, py, kind) {
  const v = ax.view, vert = t.orient !== 'h';
  for (let i = R.x0.length - 1; i >= 0; i--) {
    const a = vert ? v.xScale.transform(R.x0[i]) : v.yScale.transform(R.y0[i]);
    const b = vert ? v.xScale.transform(R.x1[i]) : v.yScale.transform(R.y1[i]);
    const p = vert ? px : py;
    if (p >= Math.min(a, b) && p <= Math.max(a, b)) return i;
  }
  void kind;
  return -1;
}

const _barKind = {
  z: 1, patch: true,
  extent(ax, t, axis, log, take, stick) {
    const R = _barRects(t);
    const along = t.orient === 'v' ? axis === 'x' : axis === 'y';
    const [A, B] = axis === 'x' ? [R.x0, R.x1] : [R.y0, R.y1];
    for (let i = 0; i < A.length; i++) { take(A[i]); take(B[i]); }
    if (!along && t.base == null && !log) stick(0);
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts;
    _drawRects(ax, ctx, _barRects(t), xScale, yScale, (i) => _pick(o.color, i), o, o.alpha != null ? o.alpha : 1);
  },
  pick(ax, t, px, py) {
    const i = _pickRects(ax, t, _barRects(t), px, py);
    if (i < 0) return null;
    return t.orient === 'v'
      ? { kind: 'bar', index: i, x: t.x[i], y: t.heights[i] }
      : { kind: 'bar', index: i, x: t.widths[i], y: t.y[i] };
  },
};
_KINDS.bar = _barKind;
_KINDS.barh = _barKind;

Axes.prototype.bar = function (x, height, opts) { return _bar(this, 'v', x, height, opts); };
Axes.prototype.barh = function (y, width, opts) { return _bar(this, 'h', y, width, opts); };

// ── bar_label(container, labels?, {fmt, padding, label_type, color, fontsize, rotation}) ──
// fmt: '%g' (default), any %-format, a '{:.1f}' format, or a function
// a bar label's text: fmt a callable, a {}-style template ('{:.1f}', '{x:,.0f} t') or %-style
// ('%.1f', '%g', the default) — Python's own rules (pyfmt.js)
function _fmtValue(fmt, v) {
  if (typeof fmt === 'function') return String(fmt(v));
  if (fmt == null) fmt = '%g';
  const f = String(fmt);
  if (f.includes('{')) return pyFormat(f, { x: v }, v);
  return f.includes('%') ? pctFormat(f, v) : f;
}

Axes.prototype.bar_label = function (container, labels, opts) {
  if (_plainOpts(labels)) { opts = labels; labels = opts.labels; }
  const t = container && container._trace;
  if (!t || (t.type !== 'bar' && t.type !== 'barh')) throw new TypeError('plot: bar_label(container): give it what bar() or barh() returned');
  const o = _plainOpts(opts) ? { ...opts } : {};
  this._traces.push({ type: 'bar_label', of: t, labels: labels != null ? Array.from(labels) : null, opts: o });
  return _result(this, [], {});
};
_KINDS.bar_label = {
  z: 3, noclip: true,
  render(ax, ctx, tr, xScale, yScale) {
    const t = tr.of, o = tr.opts, R = _barRects(t), th = ax._theme;
    const S = t.orient === 'v' ? t.heights : t.widths;
    const pad = ((o.padding || 0) * ax._dpi) / 72 + 2;
    ctx.save();
    ctx.fillStyle = _cssColor(o.color) || ax._textColor || th.foreground;
    ctx.font = o.fontsize != null ? `${o.fontsize}px ${th.mono}` : _font(th, -1);
    for (let i = 0; i < S.length; i++) {
      if (!(S[i] - S[i] === 0)) continue;
      const s = tr.labels ? (tr.labels[i] == null ? '' : String(tr.labels[i])) : _fmtValue(o.fmt, S[i]);
      if (!s) continue;
      const cx = (xScale.transform(R.x0[i]) + xScale.transform(R.x1[i])) / 2, cy = (yScale.transform(R.y0[i]) + yScale.transform(R.y1[i])) / 2;
      let x = cx, y = cy;
      const center = o.label_type === 'center';
      if (t.orient === 'v') {
        ctx.textAlign = 'center';
        if (center) ctx.textBaseline = 'middle';
        else {
          const end = yScale.transform(R.y1[i]), up = yScale.transform(R.y1[i]) <= yScale.transform(R.y0[i]);
          y = up ? end - pad : end + pad; ctx.textBaseline = up ? 'bottom' : 'top';
        }
      } else {
        ctx.textBaseline = 'middle';
        if (center) ctx.textAlign = 'center';
        else {
          const end = xScale.transform(R.x1[i]), right = end >= xScale.transform(R.x0[i]);
          x = right ? end + pad : end - pad; ctx.textAlign = right ? 'left' : 'right';
        }
      }
      ctx.fillText(s, x, y);
    }
    ctx.restore();
  },
};

// ── hist ──
// numpy's bin rules for bins='auto' and its named estimators
function _binCount(rule, data, lo, hi) {
  const v = [];
  for (let i = 0; i < data.length; i++) { const x = data[i]; if (x >= lo && x <= hi) v.push(x); }
  const n = v.length;
  if (n < 2 || !(hi > lo)) return 1;
  const range = hi - lo;
  // every rule is a bin WIDTH, turned into a count as numpy does: ceil(range / width)
  const count = (w) => (w > 0 ? Math.max(1, Math.ceil(range / w)) : 1);
  const iqr = () => {
    v.sort((a, b) => a - b);
    const q = (p) => { const k = (n - 1) * p, f = Math.floor(k); return v[f] + (v[Math.min(n - 1, f + 1)] - v[f]) * (k - f); };
    return q(0.75) - q(0.25);
  };
  const sd = () => { let m = 0; for (const x of v) m += x; m /= n; let s = 0; for (const x of v) s += (x - m) * (x - m); return Math.sqrt(s / n); };
  const sturges = range / (Math.log2(n) + 1), sqrt = range / Math.sqrt(n);
  const fd = () => 2 * iqr() / Math.cbrt(n);
  switch (rule) {
    case 'sturges': return count(sturges);
    case 'sqrt': return count(sqrt);
    case 'rice': return count(range / (2 * Math.cbrt(n)));
    case 'scott': return count(Math.cbrt(24 * Math.sqrt(Math.PI) / n) * sd());
    case 'fd': return count(fd());
    // numpy ≥ 2: the narrower of Sturges and a relaxed Freedman–Diaconis (never under half
    // the sqrt rule's width, so a small IQR can't explode the bin count)
    case 'auto': return count(Math.min(Math.max(fd(), sqrt / 2), sturges));
    default: return null;
  }
}

// hist(x, {bins = 10 | 'auto' | … | edges, range, weights, density, cumulative, histtype =
// 'bar' | 'barstacked' | 'step' | 'stepfilled', orientation, bottom, log, stacked, rwidth,
// align, color, label, …}) → [n, bins, patches] (and the axes' methods, for chaining). x may be
// one array or a list of arrays: one set of bins for all, side by side or stacked.
Axes.prototype.hist = function (data, opts) {
  const o = this._opts('hist', opts);
  const multi = Array.isArray(data) && data.length > 0 && _isArrayLike(data[0]);
  const sets = multi ? data.map((d) => _col(d)) : [_col(data)];
  const W = o.weights == null ? null : multi ? o.weights.map((w) => (w == null ? null : _col(w))) : [_col(o.weights)];
  if (W) W.forEach((w, k) => { if (w && w.length !== sets[k].length) throw _lenErr('hist', 'weights', w.length, 'x', sets[k].length); });
  const histtype = o.histtype || 'bar';
  if (!['bar', 'barstacked', 'step', 'stepfilled'].includes(histtype)) _warn(`hist.histtype.${histtype}`, `hist(): histtype must be 'bar', 'barstacked', 'step' or 'stepfilled', not '${histtype}'`, this._strict);
  const stacked = !!o.stacked || histtype === 'barstacked';
  const horiz = o.orientation === 'horizontal';
  // one set of bins for every dataset
  let lo, hi, bins = o.bins == null ? 10 : o.bins;
  if (_isArrayLike(bins) && typeof bins !== 'string') bins = _col(bins);
  else {
    if (o.range) { lo = +o.range[0]; hi = +o.range[1]; }
    else {
      lo = Infinity; hi = -Infinity;
      sets.forEach((d) => { const r = _traceRange({ _cache: {} }, 'd', d); if (r.n) { lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi); } });
      if (!(lo <= hi)) { lo = 0; hi = 1; }
    }
    if (typeof bins === 'string') {
      let all = sets[0];
      if (sets.length > 1) { all = new Float64Array(sets.reduce((s, d) => s + d.length, 0)); let at = 0; for (const d of sets) { all.set(d, at); at += d.length; } }
      const nb = _binCount(bins, all, lo, hi);
      if (nb == null) { _warn('hist.bins.' + bins, `hist(): bins='${bins}' is not a rule plot knows (auto, fd, sturges, sqrt, rice, scott); using 10`, this._strict); bins = 10; }
      else bins = nb;
    }
  }
  if (o.log) this[horiz ? '_xscale' : '_yscale'] = 'log';
  const colors = Array.isArray(o.color) ? o.color.map(_cssColor) : null;
  const labels = Array.isArray(o.label) ? o.label : null;
  const traces = [];
  sets.forEach((D, k) => {
    const to = { ...o, bins, histtype, weights: W ? W[k] : undefined };
    if (lo != null) to.range = [lo, hi];
    to.color = colors ? colors[k % colors.length] : k === 0 && o.color && !colors ? o.color : this._nextColor();
    to.label = labels ? labels[k] : k === 0 ? o.label : undefined;
    delete to.stacked;
    const t = { type: 'hist', data: D, opts: to, slot: { k, n: sets.length, stacked, horiz }, below: stacked && k > 0 ? traces[k - 1] : null };
    traces.push(t);
    this._traces.push(t);
  });
  const res = traces.map((t) => _histBars(this, t));
  const n = multi ? res.map((r) => Float64Array.from(r.counts)) : Float64Array.from(res[0].counts);
  const edges = Float64Array.from(res[0].edges);
  const nBars = (edges.length - 1) * traces.length;
  const patches = _result(this, [], { _traces: traces, __repr__: () => `<BarContainer object of ${nBars} artists>` });
  const arr = (a) => `array([${Array.from(a, (v) => (Number.isInteger(v) ? v + '.' : String(v))).join(', ')}])`;
  // matplotlib returns the tuple (n, bins, patches); at the end of a cell it prints as one
  const __repr__ = () => `(${multi ? '[' + n.map(arr).join(', ') + ']' : arr(n)}, ${arr(edges)}, ${patches.__repr__()})`;
  return _result(this, [n, edges, patches], { n, bins: edges, patches, counts: n, edges, __repr__ });
};

// a histogram trace's bars: its bins, counts and the base each stands on (stacked on the
// dataset below, or on bottom)
function _histBars(ax, t) {
  const c = t._cache || (t._cache = {});
  if (c.bars) return c.bars;
  const { edges, counts } = ax._hist(t);
  const nb = counts.length, base = new Float64Array(nb);
  if (t.below) { const b = _histBars(ax, t.below); for (let i = 0; i < nb; i++) base[i] = b.base[i] + b.counts[i]; }
  else if (t.opts.bottom != null) for (let i = 0; i < nb; i++) base[i] = _num(t.opts.bottom, i);
  return (c.bars = { edges, counts, base });
}

// the rectangles a 'bar' histogram draws: side by side for several unstacked datasets
function _histRects(ax, t) {
  const c = t._cache || (t._cache = {});
  if (c.hrects) return c.hrects;
  const { edges, counts, base } = _histBars(ax, t);
  const { k, n, stacked, horiz } = t.slot;
  const nb = counts.length;
  const total = t.opts.rwidth != null ? +t.opts.rwidth : (n > 1 && !stacked ? 0.8 : 1);
  const each = stacked ? total : total / n;
  const off = stacked ? (1 - total) / 2 : (1 - total) / 2 + k * each;
  const shift = t.opts.align === 'left' ? -0.5 : t.opts.align === 'right' ? 0.5 : 0;
  const a0 = new Float64Array(nb), a1 = new Float64Array(nb), b0 = new Float64Array(nb), b1 = new Float64Array(nb);
  for (let i = 0; i < nb; i++) {
    const w = edges[i + 1] - edges[i], e = edges[i] + shift * w;
    a0[i] = e + off * w; a1[i] = e + (off + each) * w;
    b0[i] = base[i]; b1[i] = base[i] + counts[i];
  }
  return (c.hrects = horiz ? { x0: b0, x1: b1, y0: a0, y1: a1 } : { x0: a0, x1: a1, y0: b0, y1: b1 });
}

_KINDS.hist = {
  z: 1, patch: true,
  extent(ax, t, axis, log, take, stick) {
    const { edges, counts, base } = _histBars(ax, t);
    const horiz = t.slot.horiz;
    const binsAxis = horiz ? axis === 'y' : axis === 'x';
    if (binsAxis) {
      const sh = t.opts.align === 'left' ? -0.5 : t.opts.align === 'right' ? 0.5 : 0;
      take(edges[0] + sh * (edges[1] - edges[0])); take(edges[edges.length - 1] + sh * (edges[edges.length - 1] - edges[edges.length - 2] || 0));
    } else {
      for (let i = 0; i < counts.length; i++) { take(base[i] + counts[i]); if (!log) take(base[i]); }
      if (!log && !t.below && t.opts.bottom == null) stick(0);
    }
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts, ht = o.histtype;
    if (ht === 'bar' || ht === 'barstacked' || !ht) {
      _drawRects(ax, ctx, _histRects(ax, t), xScale, yScale, () => o.color, o, o.alpha != null ? o.alpha : 1);
      return;
    }
    // step / stepfilled: the outline of the bins, from the base along the tops and back
    const { edges, counts, base } = _histBars(ax, t), horiz = t.slot.horiz, nb = counts.length;
    const P = (along, value) => (horiz ? [xScale.transform(value), yScale.transform(along)] : [xScale.transform(along), yScale.transform(value)]);
    const floor = (v) => ((horiz ? xScale : yScale).log && !(v > 0) ? (horiz ? xScale : yScale).domain[0] : v);
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.beginPath();
    let [x, y] = P(edges[0], floor(base[0]));
    ctx.moveTo(x, y);
    for (let i = 0; i < nb; i++) {
      [x, y] = P(edges[i], base[i] + counts[i]); ctx.lineTo(x, y);
      [x, y] = P(edges[i + 1], base[i] + counts[i]); ctx.lineTo(x, y);
    }
    [x, y] = P(edges[nb], floor(base[nb - 1])); ctx.lineTo(x, y);
    if (ht === 'stepfilled') {
      for (let i = nb - 1; i >= 0; i--) { [x, y] = P(edges[i + 1], floor(base[i])); ctx.lineTo(x, y); [x, y] = P(edges[i], floor(base[i])); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = o.color; ctx.fill();
      if (o.edgecolor) { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.stroke(); }
    } else {
      ctx.strokeStyle = o.edgecolor ? _cssColor(o.edgecolor) : o.color;
      ctx.lineWidth = o.linewidth || 1.5;
      ctx.setLineDash(dashArray(o.linestyle));
      ctx.stroke();
    }
    ctx.restore();
  },
  pick(ax, t, px, py) {
    const R = _histRects(ax, t), i = _pickRects(ax, { orient: t.slot.horiz ? 'h' : 'v' }, R, px, py);
    if (i < 0) return null;
    const { edges, counts } = _histBars(ax, t);
    return { kind: 'bin', index: i, x: (edges[i] + edges[i + 1]) / 2, y: counts[i], edges: [edges[i], edges[i + 1]] };
  },
  legend(ax, t) { return { patch: t.opts.histtype !== 'step', color: t.opts.color }; },
};

// -- marks.js --

// The common marks: fill_between / fill_betweenx, step (and plot's drawstyle), errorbar,
// axhspan / axvspan, annotate, and axhline / axvline's axes-fraction ends. Each registers a
// trace kind (axes.js _KINDS) for its autoscale and its drawing, so axes.js stays the core.







// ── fill_between(x, y1, y2 = 0, {where, step, interpolate, color | facecolor, edgecolor,
// linewidth, alpha, label}) — the band between two curves; fill_betweenx(y, x1, x2 = 0) is
// the same turned on its side. NaN or a false `where` splits the band into pieces. ──
function _fillBetween(ax, fn, horiz, t, a, b, opts) {
  const o = ax._opts(fn, opts);
  const T = ax._axisCol(horiz ? 'y' : 'x', t), n = T.length;
  const col = (v, name) => {
    if (v == null) return new Float64Array(n);
    if (!_isArrayLike(v)) return new Float64Array(n).fill(+v);
    const c = _col(v);
    if (c.length !== n) throw _lenErr(fn, name, c.length, horiz ? 'y' : 'x', n);
    return c;
  };
  const A = col(a, horiz ? 'x1' : 'y1'), B = col(b, horiz ? 'x2' : 'y2');
  let where = null;
  if (o.where != null) { where = Array.from(o.where, Boolean); if (where.length !== n) throw _lenErr(fn, 'where', where.length, horiz ? 'y' : 'x', n); }
  if (o.facecolor) o.color = _cssColor(o.facecolor);
  if (!o.color) o.color = ax._nextColor();
  if (o.step != null && !['pre', 'post', 'mid'].includes(o.step)) _warn(`${fn}.step.${o.step}`, `${fn}(): step must be 'pre', 'post' or 'mid'`, ax._strict);
  const trace = { type: 'fill_between', t: T, a: A, b: B, where, horiz, opts: o };
  ax._traces.push(trace);
  return _result(ax, [], { _trace: trace });
}
Axes.prototype.fill_between = function (x, y1, y2, opts) {
  if (_plainOpts(y2)) { opts = y2; y2 = opts.y2; }
  return _fillBetween(this, 'fill_between', false, x, y1, y2 == null ? 0 : y2, opts);
};
Axes.prototype.fill_betweenx = function (y, x1, x2, opts) {
  if (_plainOpts(x2)) { opts = x2; x2 = opts.x2; }
  return _fillBetween(this, 'fill_betweenx', true, y, x1, x2 == null ? 0 : x2, opts);
};

// the vertices of a stepped curve (matplotlib's drawstyle steps-pre / -post / -mid)
function _stepped(T, V, where) {
  const n = T.length;
  if (n < 2) return [Float64Array.from(T), Float64Array.from(V)];
  if (where === 'mid') {
    const t = new Float64Array(2 * n), v = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const l = i === 0 ? T[0] : (T[i - 1] + T[i]) / 2, r = i === n - 1 ? T[n - 1] : (T[i] + T[i + 1]) / 2;
      t[2 * i] = l; t[2 * i + 1] = r; v[2 * i] = V[i]; v[2 * i + 1] = V[i];
    }
    return [t, v];
  }
  const t = new Float64Array(2 * n - 1), v = new Float64Array(2 * n - 1);
  t[0] = T[0]; v[0] = V[0];
  for (let i = 1; i < n; i++) {
    // pre: jump at the start of each interval (x[i-1] → x[i] at y[i]); post: at its end
    t[2 * i - 1] = where === 'post' ? T[i] : T[i - 1]; v[2 * i - 1] = where === 'post' ? V[i - 1] : V[i];
    t[2 * i] = T[i]; v[2 * i] = V[i];
  }
  return [t, v];
}

_KINDS.fill_between = {
  z: 1, patch: true,
  extent(ax, tr, axis, log, take) {
    const own = tr.horiz ? axis === 'y' : axis === 'x';
    const r = own ? [_traceRange(tr, 't', tr.t, log)] : [_traceRange(tr, 'a', tr.a, log), _traceRange(tr, 'b', tr.b, log)];
    for (const q of r) if (q.n) { take(log ? q.minPos : q.lo); take(q.hi); }
  },
  render(ax, ctx, tr, xScale, yScale) {
    const o = tr.opts, n = tr.t.length;
    const P = (t, v) => (tr.horiz ? [xScale.transform(v), yScale.transform(t)] : [xScale.transform(t), yScale.transform(v)]);
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color;
    ctx.beginPath();
    // each run of drawable points (finite, `where` true) is one closed piece
    let i = 0;
    while (i < n) {
      const ok = (k) => (!tr.where || tr.where[k]) && tr.t[k] - tr.t[k] === 0 && tr.a[k] - tr.a[k] === 0 && tr.b[k] - tr.b[k] === 0;
      if (!ok(i)) { i++; continue; }
      let j = i;
      while (j + 1 < n && ok(j + 1)) j++;
      let T = tr.t.subarray(i, j + 1), A = tr.a.subarray(i, j + 1), B = tr.b.subarray(i, j + 1);
      if (o.step) { const s1 = _stepped(T, A, o.step), s2 = _stepped(T, B, o.step); T = s1[0]; A = s1[1]; B = s2[1]; }
      let [x, y] = P(T[0], A[0]);
      ctx.moveTo(x, y);
      for (let k = 1; k < T.length; k++) { [x, y] = P(T[k], A[k]); ctx.lineTo(x, y); }
      for (let k = T.length - 1; k >= 0; k--) { [x, y] = P(T[k], B[k]); ctx.lineTo(x, y); }
      ctx.closePath();
      i = j + 1;
    }
    ctx.fill();
    if (o.edgecolor && o.edgecolor !== 'none') { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.stroke(); }
    ctx.restore();
  },
};

// ── step(x, y, fmt?, {where = 'pre'}) — and plot(…, {drawstyle: 'steps-post'}) ──
Axes.prototype.step = function (x, y, fmtOrOpts, opts) {
  if (!_isArrayLike(y)) { opts = fmtOrOpts; fmtOrOpts = y; y = x; x = undefined; }
  let fmt = typeof fmtOrOpts === 'string' ? fmtOrOpts : null;
  if (_plainOpts(fmtOrOpts)) opts = fmtOrOpts;
  const o = _plainOpts(opts) ? { ...opts } : {};
  const where = o.where || 'pre';
  delete o.where;
  if (!['pre', 'post', 'mid'].includes(where)) _warn('step.where.' + where, `step(): where must be 'pre', 'post' or 'mid', not '${where}'`, this._strict);
  o.drawstyle = `steps-${where}`;
  return fmt ? this.plot(x === undefined ? _col(y).map((_, i) => i) : x, y, fmt, o) : this.plot(x === undefined ? _col(y).map((_, i) => i) : x, y, o);
};
// plot's drawstyle: the line's vertices are replaced by the stepped ones at ingress
function _applyDrawstyle(ax, trace) {
  const ds = trace.opts.drawstyle;
  if (!ds || ds === 'default') { delete trace.opts.drawstyle; return; }
  const m = /^steps(?:-(pre|post|mid))?$/.exec(ds);
  if (!m) { _warn('plot.drawstyle.' + ds, `plot(): drawstyle '${ds}' is not supported; use 'default', 'steps-pre', 'steps-mid' or 'steps-post'`, ax._strict); delete trace.opts.drawstyle; return; }
  const [t, v] = _stepped(trace.x, trace.y, m[1] || 'pre');
  trace.x = t; trace.y = v;
}

// ── errorbar(x, y, {yerr, xerr, fmt = '', ecolor, elinewidth, capsize = 0, capthick,
// barsabove, label, …line options}) → [line, caps, bars] with .lines. yerr / xerr: a number,
// one per point, or [lower, upper] (two arrays, or two numbers). ──
function _errCols(v, n, name) {
  if (v == null) return null;
  if (!_isArrayLike(v)) { const c = new Float64Array(n).fill(Math.abs(+v)); return [c, c]; }
  if (v.length === 2 && (_isArrayLike(v[0]) || _isArrayLike(v[1])) && n !== 2) {
    const lo = _isArrayLike(v[0]) ? _col(v[0]) : new Float64Array(n).fill(+v[0]);
    const hi = _isArrayLike(v[1]) ? _col(v[1]) : new Float64Array(n).fill(+v[1]);
    if (lo.length !== n || hi.length !== n) throw new Error(`plot: errorbar: ${name} as [lower, upper] needs ${n} values in each`);
    return [lo, hi];
  }
  if (v.length === 2 && _isArrayLike(v[0]) && n === 2) return [_col(v[0]), _col(v[1])];
  const c = _col(v);
  if (c.length !== n) throw _lenErr('errorbar', name, c.length, 'x', n);
  return [c, c];
}
Axes.prototype.errorbar = function (x, y, opts) {
  const o0 = _plainOpts(opts) ? { ...opts } : {};
  const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
  if (Y.length !== n) throw _lenErr('errorbar', 'x', n, 'y', Y.length);
  const yerr = _errCols(o0.yerr, n, 'yerr'), xerr = _errCols(o0.xerr, n, 'xerr');
  const fmt = o0.fmt == null ? '' : o0.fmt;
  const errOpts = { ecolor: o0.ecolor, elinewidth: o0.elinewidth, capsize: o0.capsize ?? 0, capthick: o0.capthick, barsabove: o0.barsabove, alpha: o0.alpha };
  for (const k of ['yerr', 'xerr', 'fmt', 'ecolor', 'elinewidth', 'capsize', 'capthick', 'barsabove', 'errorevery', 'lolims', 'uplims', 'xlolims', 'xuplims']) delete o0[k];
  // the data line (or markers): an ordinary plot trace, so it legends and picks as one;
  // fmt 'none' draws no line, only the bars
  let line = null;
  if (fmt !== 'none') {
    if (fmt) this.plot(X, Y, fmt, o0); else this.plot(X, Y, o0);
    line = this._traces[this._traces.length - 1];
  }
  const color = _cssColor(errOpts.ecolor) || (line ? line.opts.color : _cssColor(o0.color) || this._nextColor());
  const tr = { type: 'errorbar', x: X, y: Y, yerr, xerr, color, opts: { ...errOpts, zorder: o0.zorder } };
  this._traces.push(tr);
  return _result(this, [line, [], []], { lines: [line, [], []], _trace: tr });
};
_KINDS.errorbar = {
  z: 2,
  extent(ax, tr, axis, log, take) {
    const P = axis === 'x' ? tr.x : tr.y, E = axis === 'x' ? tr.xerr : tr.yerr;
    for (let i = 0; i < P.length; i++) { const v = P[i]; take(E ? v - E[0][i] : v); take(E ? v + E[1][i] : v); }
  },
  render(ax, ctx, tr, xScale, yScale) {
    const o = tr.opts;
    const cap = ((o.capsize || 0) * ax._dpi) / 72 / 2;       // capsize is the cap's full length in points
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.strokeStyle = tr.color;
    ctx.lineWidth = o.elinewidth != null ? (o.elinewidth * ax._dpi) / 72 : 1.5 * ax._dpi / 72;
    ctx.beginPath();
    for (let i = 0; i < tr.x.length; i++) {
      const xv = tr.x[i], yv = tr.y[i];
      if (xv - xv !== 0 || yv - yv !== 0) continue;
      const px = xScale.transform(xv), py = yScale.transform(yv);
      if (tr.yerr) {
        const a = yScale.transform(yv - tr.yerr[0][i]), b = yScale.transform(yv + tr.yerr[1][i]);
        if (a - a === 0 && b - b === 0) {
          ctx.moveTo(px, a); ctx.lineTo(px, b);
          if (cap) { ctx.moveTo(px - cap, a); ctx.lineTo(px + cap, a); ctx.moveTo(px - cap, b); ctx.lineTo(px + cap, b); }
        }
      }
      if (tr.xerr) {
        const a = xScale.transform(xv - tr.xerr[0][i]), b = xScale.transform(xv + tr.xerr[1][i]);
        if (a - a === 0 && b - b === 0) {
          ctx.moveTo(a, py); ctx.lineTo(b, py);
          if (cap) { ctx.moveTo(a, py - cap); ctx.lineTo(a, py + cap); ctx.moveTo(b, py - cap); ctx.lineTo(b, py + cap); }
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  },
};

// ── axhspan(ymin, ymax, {xmin = 0, xmax = 1}) / axvspan(xmin, xmax, {ymin = 0, ymax = 1}):
// a band across the axes, its other extent a fraction of the axes ──
function _span(ax, fn, horiz, lo, hi, opts) {
  const o = ax._opts(fn, opts);
  if (o.facecolor) o.color = _cssColor(o.facecolor);
  if (!o.color) o.color = ax._theme.cycle[0];
  const tr = { type: 'span', horiz, lo: +lo, hi: +hi, f0: horiz ? (o.xmin ?? 0) : (o.ymin ?? 0), f1: horiz ? (o.xmax ?? 1) : (o.ymax ?? 1), opts: o };
  ax._traces.push(tr);
  return _result(ax, [], { _trace: tr });
}
Axes.prototype.axhspan = function (ymin, ymax, opts) { return _span(this, 'axhspan', true, ymin, ymax, opts); };
Axes.prototype.axvspan = function (xmin, xmax, opts) { return _span(this, 'axvspan', false, xmin, xmax, opts); };
_KINDS.span = {
  z: 1, patch: true,
  extent(ax, tr, axis, log, take) { if (tr.horiz ? axis === 'y' : axis === 'x') { take(tr.lo); take(tr.hi); } },
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color;
    let x0, x1, y0, y1;
    if (tr.horiz) { y0 = yScale.transform(tr.lo); y1 = yScale.transform(tr.hi); x0 = rect.x + tr.f0 * rect.w; x1 = rect.x + tr.f1 * rect.w; }
    else { x0 = xScale.transform(tr.lo); x1 = xScale.transform(tr.hi); y0 = rect.y + (1 - tr.f0) * rect.h; y1 = rect.y + (1 - tr.f1) * rect.h; }
    if ([x0, x1, y0, y1].every((v) => v - v === 0)) {
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (o.edgecolor && o.edgecolor !== 'none') { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
    }
    ctx.restore();
  },
};

// ── annotate(text, xy, {xytext, xycoords = 'data', textcoords, arrowprops, ha, va, fontsize,
// color}) — xycoords / textcoords: 'data', 'axes fraction', 'offset points' (textcoords);
// arrowprops {arrowstyle: '->' | '-|>' | '-' | '<-' | '<->', color, lw, shrink} ──
Axes.prototype.annotate = function (text, xy, opts) {
  if (_plainOpts(xy) && opts == null) { opts = xy; xy = opts.xy; }
  const o = _plainOpts(opts) ? { ...opts } : {};
  for (const k of Object.keys(o)) {
    if (!['xytext', 'xycoords', 'textcoords', 'arrowprops', 'ha', 'va', 'horizontalalignment', 'verticalalignment', 'fontsize', 'color', 'alpha', 'zorder', 'fontweight', 'rotation', '_kw'].includes(k)) _warn('annotate.' + k, `annotate(): '${k}' is not supported`, this._strict);
  }
  const tr = { type: 'annotate', text: String(text), xy: Array.from(xy, Number), opts: o };
  this._traces.push(tr);
  return _result(this, [], { _trace: tr });
};
_KINDS.annotate = {
  z: 3, noclip: true,
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts, th = ax._theme;
    const at = (p, coords) => {
      if (coords === 'axes fraction') return [rect.x + p[0] * rect.w, rect.y + (1 - p[1]) * rect.h];
      if (coords === 'figure pixels') return [p[0], p[1]];
      return [xScale.transform(p[0]), yScale.transform(p[1])];
    };
    const P = at(tr.xy, o.xycoords || 'data');
    let T = P;
    if (o.xytext) {
      const tc = o.textcoords || o.xycoords || 'data';
      if (tc === 'offset points' || tc === 'offset pixels') {
        const k = tc === 'offset points' ? ax._dpi / 72 : 1;
        T = [P[0] + o.xytext[0] * k, P[1] - o.xytext[1] * k];
      } else T = at(o.xytext, tc);
    }
    if (![...P, ...T].every((v) => v - v === 0)) return;
    const color = _cssColor(o.color) || ax._textColor || th.foreground;
    ctx.save();
    if (o.arrowprops && o.xytext) {
      const ap = o.arrowprops, style = ap.arrowstyle || '-|>';
      ctx.strokeStyle = _cssColor(ap.color || ap.facecolor) || color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = ap.lw ?? ap.linewidth ?? 1;
      const dx = P[0] - T[0], dy = P[1] - T[1], L = Math.hypot(dx, dy);
      if (L > 1) {
        const ux = dx / L, uy = dy / L, s0 = 8, s1 = ap.shrink != null ? ap.shrink * L : 2;
        const a = [T[0] + ux * s0, T[1] + uy * s0], b = [P[0] - ux * s1, P[1] - uy * s1];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const head = (q, dir) => {
          const hx = q[0], hy = q[1], h = 8, w = 3.5, bx = hx - dir[0] * h, by = hy - dir[1] * h;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(bx - dir[1] * w, by + dir[0] * w); ctx.lineTo(bx + dir[1] * w, by - dir[0] * w); ctx.closePath();
          if (style.includes('|>')) ctx.fill();
          else { ctx.beginPath(); ctx.moveTo(bx - dir[1] * w, by + dir[0] * w); ctx.lineTo(hx, hy); ctx.lineTo(bx + dir[1] * w, by - dir[0] * w); ctx.stroke(); }
        };
        if (style.endsWith('>')) head(b, [ux, uy]);
        if (style.startsWith('<')) head(a, [-ux, -uy]);
      }
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.font = o.fontsize != null && typeof o.fontsize === 'number' ? `${o.fontweight === 'bold' ? 'bold ' : ''}${o.fontsize}px ${th.mono}` : _font(th, 0, o.fontweight === 'bold');
    const ha = o.ha || o.horizontalalignment, va = o.va || o.verticalalignment;
    ctx.textAlign = { center: 'center', left: 'left', right: 'right' }[ha] || (o.xytext ? 'center' : 'left');
    ctx.textBaseline = { center: 'middle', top: 'top', bottom: 'bottom', baseline: 'alphabetic' }[va] || (o.xytext ? 'middle' : 'alphabetic');
    ctx.fillText(tr.text, T[0], T[1]);
    ctx.restore();
  },
};

// ── axhline / axvline with xmin / xmax (ymin / ymax): their extent across the axes, as a
// fraction of it ──
Axes.prototype.axhline = function (y, opts) {
  const o = this._opts('axhline', opts);
  if (o.linewidth == null) o.linewidth = 1;
  this._traces.push({ type: 'hline', y: y == null ? 0 : +y, opts: o });
  return _result(this, [], {});
};
Axes.prototype.axvline = function (x, opts) {
  const o = this._opts('axvline', opts);
  if (o.linewidth == null) o.linewidth = 1;
  this._traces.push({ type: 'vline', x: x == null ? 0 : +x, opts: o });
  return _result(this, [], {});
};
Axes.prototype._renderHline = function (ctx, trace, xScale, yScale, plotX, plotW) {
  const py = yScale.transform(trace.y);
  if (py - py !== 0) return;
  const o = trace.opts, f0 = o.xmin ?? 0, f1 = o.xmax ?? 1;
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.strokeStyle = o.color || this._theme.muted;
  ctx.lineWidth = o.linewidth || 1;
  ctx.setLineDash(dashArray(o.linestyle));
  ctx.beginPath(); ctx.moveTo(plotX + f0 * plotW, py); ctx.lineTo(plotX + f1 * plotW, py); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
Axes.prototype._renderVline = function (ctx, trace, xScale, yScale, plotY, plotH) {
  const px = xScale.transform(trace.x);
  if (px - px !== 0) return;
  const o = trace.opts, f0 = o.ymin ?? 0, f1 = o.ymax ?? 1;
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.strokeStyle = o.color || this._theme.muted;
  ctx.lineWidth = o.linewidth || 1;
  ctx.setLineDash(dashArray(o.linestyle));
  ctx.beginPath(); ctx.moveTo(px, plotY + (1 - f0) * plotH); ctx.lineTo(px, plotY + (1 - f1) * plotH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
_hooks.drawstyle = _applyDrawstyle;
void parseFormat;

// ── stackplot(x, y1, y2, … | ys, {labels, colors, baseline = 'zero' | 'sym' | 'wiggle' |
// 'weighted_wiggle', alpha, edgecolor, linewidth}) — layers stacked from a baseline, each a
// fill_between from the one below; matplotlib's baselines exactly. Returns the layers. ──
Axes.prototype.stackplot = function (x, ...args) {
  let opts = null;
  if (args.length && _plainOpts(args[args.length - 1])) opts = args.pop();
  const o = this._opts('stackplot', opts);
  // one 2D argument (a list of series) or several 1D ones
  const series = args.length === 1 && _isArrayLike(args[0]) && args[0].length && _isArrayLike(args[0][0]) ? Array.from(args[0]) : args;
  const X = this._axisCol('x', x), n = X.length, m = series.length;
  if (!m) throw new TypeError('stackplot(x, y1, y2, …): give at least one series');
  const Y = series.map((s, k) => { const c = _col(s); if (c.length !== n) throw _lenErr('stackplot', `y${k + 1}`, c.length, 'x', n); return c; });
  // the running sum, then the baseline under it
  const stack = Y.map(() => new Float64Array(n));
  for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) { s += Y[k][j]; stack[k][j] = s; } }
  const first = new Float64Array(n);
  const base = o.baseline || 'zero';
  if (base === 'sym') for (let j = 0; j < n; j++) first[j] = -stack[m - 1][j] / 2;
  else if (base === 'wiggle') {
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += Y[k][j] * (m - 0.5 - k); first[j] = -s / m; }
  } else if (base === 'weighted_wiggle') {
    let center = 0;
    for (let j = 0; j < n; j++) {
      const total = stack[m - 1][j], inv = total > 0 ? 1 / total : 0;
      let c = 0;
      for (let k = 0; k < m; k++) {
        const inc = j === 0 ? Y[k][0] : Y[k][j] - Y[k][j - 1];
        const below = total - stack[k][j] + 0.5 * Y[k][j];
        const up = j === 0 ? 0.5 : below * inv;
        c += (up - 0.5) * inc;
      }
      center += c;
      first[j] = center - 0.5 * total;
    }
  } else if (base !== 'zero') _warn('stackplot.baseline.' + base, `stackplot(): baseline must be 'zero', 'sym', 'wiggle' or 'weighted_wiggle'`, this._strict);
  for (let k = 0; k < m; k++) for (let j = 0; j < n; j++) stack[k][j] += first[j];
  const labels = o.labels ? Array.from(o.labels) : [];
  const colors = o.colors ? Array.from(o.colors) : null;
  const out = [];
  for (let k = 0; k < m; k++) {
    const fo = {};
    if (labels[k] != null) fo.label = labels[k];
    if (colors) fo.color = colors[k % colors.length];
    for (const key of ['alpha', 'zorder', 'edgecolor', 'linewidth']) if (o[key] != null) fo[key] = o[key];
    out.push(this.fill_between(X, k === 0 ? first : stack[k - 1], stack[k], fo));
  }
  return out;
};

// -- box.js --

// boxplot — matplotlib's, statistic for statistic.
//
// The statistics are matplotlib's cbook.boxplot_stats: quartiles by linear interpolation
// (numpy's default percentile method), whiskers at the furthest datum within whis × IQR of the
// box (Tukey; whis = [p_lo, p_hi] gives percentiles instead), fliers beyond them, NaN left out.
// boxplot returns them, so a caller can print the medians it drew: { medians, boxes, whiskers,
// caps, fliers, means, stats } — each artist list with matplotlib's get_ydata / get_xdata.






// the linear-interpolation percentile of sorted values (numpy's default)
function _pct(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const k = (n - 1) * p, f = Math.floor(k), c = Math.min(n - 1, f + 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function _boxStats(data, whis = 1.5, label = null) {
  const v = [];
  for (let i = 0; i < data.length; i++) { const x = +data[i]; if (x - x === 0) v.push(x); }
  v.sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { mean: NaN, med: NaN, q1: NaN, q3: NaN, iqr: NaN, whislo: NaN, whishi: NaN, cilo: NaN, cihi: NaN, fliers: [], label, n: 0 };
  let mean = 0;
  for (const x of v) mean += x;
  mean /= n;
  const q1 = _pct(v, 0.25), med = _pct(v, 0.5), q3 = _pct(v, 0.75), iqr = q3 - q1;
  let lo, hi;
  if (Array.isArray(whis)) { lo = _pct(v, whis[0] / 100); hi = _pct(v, whis[1] / 100); }
  else if (whis === 'range') { lo = v[0]; hi = v[n - 1]; }
  else { lo = q1 - whis * iqr; hi = q3 + whis * iqr; }
  // the whiskers end at data: the lowest value ≥ lo, the highest ≤ hi (matplotlib clips them
  // to the box when nothing qualifies)
  let whislo = q1, whishi = q3;
  for (const x of v) if (x >= lo) { whislo = Math.min(x, q1); break; }
  for (let i = n - 1; i >= 0; i--) if (v[i] <= hi) { whishi = Math.max(v[i], q3); break; }
  const fliers = v.filter((x) => x < whislo || x > whishi);
  const ci = 1.57 * iqr / Math.sqrt(n);
  return { mean, med, q1, q3, iqr, whislo, whishi, cilo: med - ci, cihi: med + ci, fliers, label, n };
}

// x: one array, a list of arrays, or a mapping { label: array }
function _datasets(x) {
  if (x && typeof x === 'object' && !_isArrayLike(x) && !Array.isArray(x)) {
    if (typeof x.to_numpy === 'function' && x.columns) {        // a DataFrame: one box per column
      const cols = Array.from(x.columns);
      return { sets: cols.map((c) => _col(x.get ? x.get(c) : x[c])), labels: cols.map(String) };
    }
    const keys = Object.keys(x).filter((k) => k !== '_kw');
    return { sets: keys.map((k) => _col(x[k])), labels: keys };
  }
  if (Array.isArray(x) && x.length && _isArrayLike(x[0])) return { sets: x.map((d) => _col(d)), labels: null };
  return { sets: [_col(x)], labels: null };
}

const _lineObj = (xs, ys) => ({ get_xdata: () => xs.slice(), get_ydata: () => ys.slice(), xdata: xs, ydata: ys });

Axes.prototype.boxplot = function (x, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  const known = ['whis', 'labels', 'tick_labels', 'vert', 'orientation', 'showfliers', 'showmeans', 'meanline', 'widths', 'positions', 'patch_artist', 'boxprops', 'medianprops', 'whiskerprops', 'capprops', 'flierprops', 'meanprops', 'manage_ticks', 'showcaps', 'showbox', 'zorder', 'notch', 'sym', 'bootstrap', 'usermedians', 'conf_intervals', 'autorange', 'capwidths', '_kw'];
  for (const k of Object.keys(o)) if (!known.includes(k)) _warn('boxplot.' + k, `boxplot() has no option '${k}'`, this._strict);
  for (const k of ['notch', 'bootstrap', 'usermedians', 'conf_intervals']) if (o[k]) _warn('boxplot.' + k, `boxplot(): '${k}' is not supported yet`, this._strict);
  const { sets, labels: keyLabels } = _datasets(x);
  const n = sets.length;
  const labels = o.tick_labels || o.labels || keyLabels;
  const horiz = o.vert === false || o.orientation === 'horizontal';
  const positions = o.positions ? Array.from(o.positions, Number) : sets.map((_, i) => i + 1);
  const span = positions.length > 1 ? Math.max(...positions) - Math.min(...positions) : 1;
  const wdef = Math.min(0.5, Math.max(0.15, 0.15 * span));
  const widths = o.widths == null ? positions.map(() => wdef) : _isArrayLike(o.widths) ? Array.from(o.widths, Number) : positions.map(() => +o.widths);
  const whis = o.whis == null ? 1.5 : o.whis;
  const stats = sets.map((d, i) => _boxStats(d, whis, labels ? String(labels[i]) : null));
  const trace = {
    type: 'boxplot', stats, positions, widths, horiz,
    showfliers: o.showfliers !== false, showmeans: !!o.showmeans, meanline: !!o.meanline,
    showcaps: o.showcaps !== false, showbox: o.showbox !== false, patch: !!o.patch_artist,
    props: { box: o.boxprops || {}, median: o.medianprops || {}, whisker: o.whiskerprops || {}, cap: o.capprops || {}, flier: o.flierprops || {}, mean: o.meanprops || {} },
    colors: { box: null, fill: this._theme.cycle[0], median: this._theme.cycle[1], mean: this._theme.cycle[2] },
    opts: { zorder: o.zorder, label: undefined },
  };
  this._traces.push(trace);
  // ticks at the positions, labelled (matplotlib's manage_ticks)
  if (o.manage_ticks !== false) this[horiz ? 'set_yticks' : 'set_xticks'](positions, labels ? labels.map(String) : positions.map((p) => String(p)));
  // matplotlib's artists, as data
  const P = (a, b) => (horiz ? [b, a] : [a, b]);
  const medians = [], boxes = [], whiskers = [], caps = [], fliers = [], means = [];
  stats.forEach((s, i) => {
    const p = positions[i], w = widths[i];
    const m = P([p - w / 2, p + w / 2], [s.med, s.med]); medians.push(_lineObj(m[0], m[1]));
    const b = P([p - w / 2, p + w / 2, p + w / 2, p - w / 2, p - w / 2], [s.q1, s.q1, s.q3, s.q3, s.q1]); boxes.push(_lineObj(b[0], b[1]));
    const w1 = P([p, p], [s.q1, s.whislo]), w2 = P([p, p], [s.q3, s.whishi]); whiskers.push(_lineObj(w1[0], w1[1]), _lineObj(w2[0], w2[1]));
    const c1 = P([p - w / 4, p + w / 4], [s.whislo, s.whislo]), c2 = P([p - w / 4, p + w / 4], [s.whishi, s.whishi]); caps.push(_lineObj(c1[0], c1[1]), _lineObj(c2[0], c2[1]));
    const f = P(s.fliers.map(() => p), s.fliers); fliers.push(_lineObj(f[0], f[1]));
    const mn = P([p], [s.mean]); means.push(_lineObj(mn[0], mn[1]));
  });
  const out = { medians, boxes, whiskers, caps, fliers, means, stats };
  return _result(this, [], out);
};

_KINDS.boxplot = {
  z: 2, patch: true,
  extent(ax, t, axis, log, take) {
    const along = t.horiz ? axis === 'y' : axis === 'x';
    t.stats.forEach((s, i) => {
      if (along) { take(t.positions[i] - t.widths[i] / 2); take(t.positions[i] + t.widths[i] / 2); }
      else { take(s.whislo); take(s.whishi); if (t.showfliers) for (const f of s.fliers) take(f); if (t.showmeans) take(s.mean); }
    });
  },
  render(ax, ctx, t, xScale, yScale) {
    const th = ax._theme, fg = ax._textColor || th.foreground;
    const pr = t.props;
    const col = (p, dflt) => _cssColor(p.color) || dflt;
    const lw = (p, d = 1) => (p.linewidth ?? p.lw ?? d);
    const P = (a, v) => (t.horiz ? [xScale.transform(v), yScale.transform(a)] : [xScale.transform(a), yScale.transform(v)]);
    const seg = (a0, v0, a1, v1) => { const p = P(a0, v0), q = P(a1, v1); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
    ctx.save();
    t.stats.forEach((s, i) => {
      if (!s.n) return;
      const p = t.positions[i], w = t.widths[i];
      // the box: filled with patch_artist (matplotlib: C0), else an outline
      if (t.showbox) {
        const a = P(p - w / 2, s.q1), b = P(p + w / 2, s.q3);
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), W = Math.abs(b[0] - a[0]), H = Math.abs(b[1] - a[1]);
        if (t.patch) { ctx.fillStyle = _cssColor(pr.box.facecolor) || t.colors.fill; ctx.fillRect(x, y, W, H); }
        ctx.strokeStyle = col(pr.box, _cssColor(pr.box.edgecolor) || fg); ctx.lineWidth = lw(pr.box);
        ctx.strokeRect(x, y, W, H);
      }
      // whiskers and caps
      ctx.strokeStyle = col(pr.whisker, fg); ctx.lineWidth = lw(pr.whisker);
      ctx.beginPath(); seg(p, s.q1, p, s.whislo); seg(p, s.q3, p, s.whishi); ctx.stroke();
      if (t.showcaps) {
        ctx.strokeStyle = col(pr.cap, fg); ctx.lineWidth = lw(pr.cap);
        ctx.beginPath(); seg(p - w / 4, s.whislo, p + w / 4, s.whislo); seg(p - w / 4, s.whishi, p + w / 4, s.whishi); ctx.stroke();
      }
      // the median (matplotlib: C1, the orange line)
      ctx.strokeStyle = col(pr.median, t.colors.median); ctx.lineWidth = lw(pr.median, 1.5);
      ctx.beginPath(); seg(p - w / 2, s.med, p + w / 2, s.med); ctx.stroke();
      // fliers: open circles
      if (t.showfliers && s.fliers.length) {
        const m = pr.flier.marker && _MARKERS.includes(pr.flier.marker) ? pr.flier.marker : 'o';
        const r = ((pr.flier.markersize ?? 6) * ax._dpi) / 144;
        ctx.strokeStyle = _cssColor(pr.flier.markeredgecolor) || fg; ctx.lineWidth = 1;
        const fc = _cssColor(pr.flier.markerfacecolor);
        for (const f of s.fliers) {
          const q = P(p, f);
          ctx.beginPath(); _pathMarker(ctx, _markerShape(m, r), q[0], q[1]);
          if (fc && fc !== 'none') { ctx.fillStyle = fc; ctx.fill(); }
          ctx.stroke();
        }
      }
      // the mean: a triangle (matplotlib: C2), or a dashed line with meanline
      if (t.showmeans) {
        const mc = _cssColor(pr.mean.markerfacecolor || pr.mean.color) || t.colors.mean;
        if (t.meanline) { ctx.strokeStyle = mc; ctx.setLineDash([4, 3]); ctx.beginPath(); seg(p - w / 2, s.mean, p + w / 2, s.mean); ctx.stroke(); ctx.setLineDash([]); }
        else { const q = P(p, s.mean); ctx.fillStyle = mc; ctx.beginPath(); _pathMarker(ctx, _markerShape(pr.mean.marker || '^', ((pr.mean.markersize ?? 6) * ax._dpi) / 144), q[0], q[1]); ctx.fill(); }
      }
    });
    ctx.restore();
  },
  pick(ax, t, px, py) {
    const v = ax.view;
    for (let i = 0; i < t.positions.length; i++) {
      const p = t.positions[i], w = t.widths[i];
      const a = t.horiz ? v.yScale.transform(p - w / 2) : v.xScale.transform(p - w / 2), b = t.horiz ? v.yScale.transform(p + w / 2) : v.xScale.transform(p + w / 2);
      const q = t.horiz ? py : px;
      if (q >= Math.min(a, b) && q <= Math.max(a, b)) { const s = t.stats[i]; return { kind: 'box', index: i, x: t.horiz ? s.med : p, y: t.horiz ? p : s.med, value: s.med, stats: s }; }
    }
    return null;
  },
};

// -- contour.js --

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

// -- mesh.js --

// pcolormesh([X, Y,] C) — a colour-mapped grid on any rectilinear or curvilinear mesh.
//
// shading 'flat': X / Y are the cell EDGES (nx+1, ny+1, or (ny+1) × (nx+1) for a curvilinear
// mesh); 'nearest': they are the cell CENTRES (nx, ny) and the edges sit halfway between;
// 'auto' (the default) picks by their length, as matplotlib does. C[row][col] is the cell
// between Y[row] and Y[row+1], X[col] and X[col+1].
//
// A mesh with evenly spaced edges is an image: it goes through imshow's raster (one RGBA
// buffer, one blit, one draw-list op). Uneven or curvilinear meshes draw cell by cell.






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

// -- legend.js --

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








const _LOCS = ['best', 'upper right', 'upper left', 'lower left', 'lower right', 'right', 'center left', 'center right', 'lower center', 'upper center', 'center'];
const _SIZES = { 'xx-small': -4, 'x-small': -3, small: -2, medium: 0, large: 2, 'x-large': 4, 'xx-large': 6 };

Axes.prototype.legend = function (a, b, c) {
  let handles = null, labels = null, opts = {};
  if (_plainOpts(a) && !Array.isArray(a)) opts = a;
  else if (Array.isArray(a) && Array.isArray(b)) { handles = a; labels = b; if (_plainOpts(c)) opts = c; }
  else if (Array.isArray(a) || _isArrayLike(a)) { labels = Array.from(a, String); if (_plainOpts(b)) opts = b; }
  const o = { ...opts };
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
  const fs = lo.fontsize == null ? (th.font_size || 11) - 1 : typeof lo.fontsize === 'number' ? lo.fontsize : (th.font_size || 11) + (_SIZES[lo.fontsize] ?? 0);
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
  const titleFont = lo.title ? `bold ${fs}px ${th.mono}` : null;
  const titleH = lo.title ? lineH : 0;
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
    }
  }
  return out;
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
    ctx.fillText(lo.title, lx + B.w / 2, ly + B.pad + B.lineH / 2);
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

// -- geo.js --

// Plan views: maps in projected or local coordinates, with no basemap — block-model benches,
// collars, licence areas. Polygons with holes (matplotlib's fill, and its Polygon / Rectangle /
// Circle patches through add_patch), GeoJSON-shaped geometry (so @gcu/wkt output and a
// FeatureCollection drop straight in), and the map furniture: a scale bar and a north arrow.
// Each is a trace kind (axes.js _KINDS), so the autoscale, the legend, picking and the draw
// list treat it like any other mark.







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
class Polygon {
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
class Rectangle extends Polygon {
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
class Circle extends Polygon {
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

// -- dist.js --

// Distributions, tier 2: violinplot, hexbin, hist2d — matplotlib's algorithms.
//
// - violinplot: a Gaussian KDE per dataset (bandwidth by Scott's rule, n^-1/5 × the sample
//   std, as matplotlib's mlab.GaussianKDE; 'silverman', a number or a function too), evaluated
//   at `points` values from the data's min to its max, scaled so the widest point is
//   widths / 2 each side. Extrema, medians, means and quantiles as lines across, half the width.
// - hexbin: matplotlib's lattice exactly — two offset rectangular lattices, each point to the
//   nearer centre (the 3:1 metric), so counts match matplotlib's for the same gridsize and
//   extent. With no C every hexagon of the extent is drawn, empty ones at the bottom of the
//   colour map (bins='log' leaves them clear); with C, reduce_C_function (mean) of the values
//   in each.
// - hist2d: numpy's histogram2d (even bins, the last edge inclusive), drawn as a pcolormesh;
//   returns [h, xedges, yedges, image], h[i][j] the count of x bin i and y bin j.







// ── violinplot ──
const _finiteSorted = (d) => { const v = []; for (let i = 0; i < d.length; i++) { const x = +d[i]; if (x - x === 0) v.push(x); } return v.sort((a, b) => a - b); };
function _vpct(v, p) { const n = v.length; if (!n) return NaN; const k = (n - 1) * p, f = Math.floor(k), c = Math.min(n - 1, f + 1); return v[f] + (v[c] - v[f]) * (k - f); }

// the KDE of sorted values at `points` coordinates between min and max
function _violinStats(v, points, bw) {
  const n = v.length;
  const out = { coords: [], vals: [], mean: NaN, median: NaN, min: NaN, max: NaN, n };
  if (!n) return out;
  let mean = 0; for (const x of v) mean += x; mean /= n;
  let ss = 0; for (const x of v) ss += (x - mean) * (x - mean);
  const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  Object.assign(out, { mean, median: _vpct(v, 0.5), min: v[0], max: v[n - 1] });
  const factor = typeof bw === 'function' ? bw(v) : typeof bw === 'number' ? bw
    : bw === 'silverman' ? Math.pow((n * 3) / 4, -0.2) : Math.pow(n, -0.2);
  const h = factor * std;
  if (!(h > 0)) return out;                                 // constant data: lines only
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  for (let k = 0; k < points; k++) {
    const c = points > 1 ? v[0] + ((v[n - 1] - v[0]) * k) / (points - 1) : v[0];
    let s = 0;
    for (let i = 0; i < n; i++) { const z = (c - v[i]) / h; if (z > -8 && z < 8) s += Math.exp(-0.5 * z * z); }
    out.coords.push(c); out.vals.push(s * norm);
  }
  return out;
}

Axes.prototype.violinplot = function (dataset, opts) {
  if (_plainOpts(dataset) && opts == null && dataset.dataset != null) { opts = dataset; dataset = opts.dataset; }
  const o = _plainOpts(opts) ? { ...opts } : {};
  const known = ['positions', 'vert', 'orientation', 'widths', 'showmeans', 'showextrema', 'showmedians', 'quantiles', 'points', 'bw_method', 'side', 'zorder', '_kw'];
  for (const k of Object.keys(o)) if (!known.includes(k)) _warn('violinplot.' + k, `violinplot() has no option '${k}'`, this._strict);
  const { sets, labels } = _datasets(dataset);
  const horiz = o.vert === false || o.orientation === 'horizontal';
  const positions = o.positions ? Array.from(o.positions, Number) : sets.map((_, i) => i + 1);
  if (positions.length !== sets.length) throw _lenErr('violinplot', 'positions', positions.length, 'dataset', sets.length);
  const widths = o.widths == null ? positions.map(() => 0.5) : _isArrayLike(o.widths) ? Array.from(o.widths, Number) : positions.map(() => +o.widths);
  const points = o.points || 100;
  const qs = o.quantiles ? (Array.isArray(o.quantiles[0]) || ArrayBuffer.isView(o.quantiles[0]) ? o.quantiles.map((q) => Array.from(q, Number)) : sets.map(() => Array.from(o.quantiles, Number))) : null;
  const sorted = sets.map(_finiteSorted);
  const stats = sorted.map((v) => _violinStats(v, points, o.bw_method));
  const color = this._nextColor();
  const trace = {
    type: 'violin', stats, positions, widths, horiz, qs, sorted, side: o.side || 'both',
    show: { means: !!o.showmeans, extrema: o.showextrema !== false, medians: !!o.showmedians },
    body: stats.map(() => ({ facecolor: color, edgecolor: null, alpha: 0.3 })),
    lines: { cmeans: { color }, cmins: { color }, cmaxes: { color }, cbars: { color }, cmedians: { color }, cquantiles: { color } },
    opts: { zorder: o.zorder, label: undefined, color },
  };
  this._traces.push(trace);
  if (labels) this[horiz ? 'set_yticks' : 'set_xticks'](positions, labels);
  // matplotlib's returns: bodies you restyle (set_facecolor / set_edgecolor / set_alpha), the
  // line collections (set_color / set_linewidth)
  const body = (i) => ({
    set_facecolor(c) { trace.body[i].facecolor = _cssColor(c); return this; },
    set_edgecolor(c) { trace.body[i].edgecolor = c === 'none' ? null : _cssColor(c); return this; },
    set_alpha(a) { trace.body[i].alpha = a == null ? 1 : +a; return this; },
    set_linewidth(w) { trace.body[i].linewidth = +w; return this; },
    get_facecolor: () => trace.body[i].facecolor,
  });
  const coll = (k) => ({
    set_color(c) { trace.lines[k].color = _cssColor(c); return this; },
    set_linewidth(w) { trace.lines[k].linewidth = +w; return this; },
    set_linestyle(s) { trace.lines[k].linestyle = s; return this; },
  });
  const out = { bodies: stats.map((_, i) => body(i)), stats: stats.map((s) => ({ mean: s.mean, median: s.median, min: s.min, max: s.max, coords: s.coords, vals: s.vals })) };
  if (trace.show.extrema) { out.cmins = coll('cmins'); out.cmaxes = coll('cmaxes'); out.cbars = coll('cbars'); }
  if (trace.show.means) out.cmeans = coll('cmeans');
  if (trace.show.medians) out.cmedians = coll('cmedians');
  if (qs) out.cquantiles = coll('cquantiles');
  return _result(this, [], out);
};

_KINDS.violin = {
  z: 2, patch: true,
  extent(ax, t, axis, log, take) {
    const along = t.horiz ? axis === 'y' : axis === 'x';
    t.stats.forEach((s, i) => {
      if (along) { take(t.positions[i] - t.widths[i] / 2); take(t.positions[i] + t.widths[i] / 2); }
      else { take(s.min); take(s.max); }
    });
  },
  render(ax, ctx, t, xScale, yScale) {
    const P = (a, v) => (t.horiz ? [xScale.transform(v), yScale.transform(a)] : [xScale.transform(a), yScale.transform(v)]);
    ctx.save();
    t.stats.forEach((s, i) => {
      const p = t.positions[i], w = t.widths[i], b = t.body[i];
      if (s.vals.length) {
        let vmax = 0; for (const v of s.vals) if (v > vmax) vmax = v;
        const k = (0.5 * w) / vmax, n = s.coords.length;
        const right = t.side !== 'low', left = t.side !== 'high';
        ctx.beginPath();
        for (let j = 0; j < n; j++) { const q = P(p + (right ? s.vals[j] * k : 0), s.coords[j]); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        for (let j = n - 1; j >= 0; j--) { const q = P(p - (left ? s.vals[j] * k : 0), s.coords[j]); ctx.lineTo(q[0], q[1]); }
        ctx.closePath();
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = b.facecolor; ctx.fill();
        ctx.globalAlpha = 1;
        if (b.edgecolor) { ctx.strokeStyle = b.edgecolor; ctx.lineWidth = b.linewidth || 1; ctx.stroke(); }
      }
      // the lines across: half the width, matplotlib's
      const seg = (key, v, half = w / 4) => {
        const L = t.lines[key], a = P(p - half, v), c = P(p + half, v);
        if (!(a[0] - a[0] === 0 && a[1] - a[1] === 0)) return;
        ctx.strokeStyle = L.color; ctx.lineWidth = L.linewidth || 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      };
      if (t.show.extrema && s.n) {
        seg('cmins', s.min); seg('cmaxes', s.max);
        const L = t.lines.cbars, a = P(p, s.min), c = P(p, s.max);
        ctx.strokeStyle = L.color; ctx.lineWidth = L.linewidth || 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
      if (t.show.medians && s.n) seg('cmedians', s.median);
      if (t.show.means && s.n) seg('cmeans', s.mean);
      if (t.qs && t.qs[i]) for (const q of t.qs[i]) seg('cquantiles', _vpct(t.sorted[i], q), w / 8);
    });
    ctx.restore();
  },
  legend(ax, t) { return { patch: true, color: t.body[0] && t.body[0].facecolor }; },
  pick(ax, t, px, py) {
    const v = ax.view;
    for (let i = 0; i < t.positions.length; i++) {
      const p = t.positions[i], w = t.widths[i];
      const a = (t.horiz ? v.yScale : v.xScale).transform(p - w / 2), b = (t.horiz ? v.yScale : v.xScale).transform(p + w / 2);
      const q = t.horiz ? py : px;
      if (q >= Math.min(a, b) && q <= Math.max(a, b)) { const s = t.stats[i]; return { kind: 'violin', index: i, x: t.horiz ? s.median : p, y: t.horiz ? p : s.median, value: s.median }; }
    }
    return null;
  },
};

// ── hexbin ──
// matplotlib's mtransforms.nonsingular: a zero-width range opens by 10 %
function _nonsingular(lo, hi) {
  if (!(hi - lo > 1e-12 * Math.max(Math.abs(lo), Math.abs(hi), 1e-300))) {
    if (lo === 0 && hi === 0) return [-0.1, 0.1];
    return [lo - 0.1 * Math.abs(lo), hi + 0.1 * Math.abs(hi)];
  }
  return [lo, hi];
}

Axes.prototype.hexbin = function (x, y, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  _checkOpts('hexbin', o, this._strict);
  const X = _col(x), Y = _col(y), n = X.length;
  if (Y.length !== n) throw _lenErr('hexbin', 'y', Y.length, 'x', n);
  const C = o.C != null ? _col(o.C) : null;
  if (C && C.length !== n) throw _lenErr('hexbin', 'C', C.length, 'x', n);
  const gs = o.gridsize == null ? 100 : o.gridsize;
  const [nx, ny] = _isArrayLike(gs) ? [Math.max(1, Math.round(gs[0])), Math.max(1, Math.round(gs[1]))] : [Math.max(1, Math.round(gs)), Math.max(1, Math.floor(gs / Math.sqrt(3)))];
  let xmin, xmax, ymin, ymax;
  if (o.extent) [xmin, xmax, ymin, ymax] = Array.from(o.extent, Number);
  else {
    xmin = Infinity; xmax = -Infinity; ymin = Infinity; ymax = -Infinity;
    for (let i = 0; i < n; i++) { const a = X[i], b = Y[i]; if (a - a !== 0 || b - b !== 0) continue; if (a < xmin) xmin = a; if (a > xmax) xmax = a; if (b < ymin) ymin = b; if (b > ymax) ymax = b; }
    if (xmin > xmax) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
    [xmin, xmax] = _nonsingular(xmin, xmax); [ymin, ymax] = _nonsingular(ymin, ymax);
  }
  const pad = 1e-9 * (xmax - xmin);
  xmin -= pad; xmax += pad;
  const sx = (xmax - xmin) / nx, sy = (ymax - ymin) / ny;
  const nx1 = nx + 1, ny1 = ny + 1, n1 = nx1 * ny1, n2 = nx * ny;
  const count = new Float64Array(n1 + n2);
  const reduce = typeof o.reduce_C_function === 'function' ? o.reduce_C_function : null;
  const sum = C ? new Float64Array(n1 + n2) : null;
  const lists = C && reduce ? Array.from({ length: n1 + n2 }, () => []) : null;
  for (let i = 0; i < n; i++) {
    const a = X[i], b = Y[i];
    if (a - a !== 0 || b - b !== 0) continue;
    if (C && C[i] - C[i] !== 0) continue;
    const ix = (a - xmin) / sx, iy = (b - ymin) / sy;
    const ix1 = Math.round(ix), iy1 = Math.round(iy), ix2 = Math.floor(ix), iy2 = Math.floor(iy);
    // numpy rounds halves to even; Math.round rounds them up — on exact halves only
    const r1 = (v, r) => (Math.abs(v - Math.trunc(v)) === 0.5 ? 2 * Math.round(v / 2) : r);
    const jx1 = r1(ix, ix1), jy1 = r1(iy, iy1);
    const d1 = (ix - jx1) ** 2 + 3 * (iy - jy1) ** 2, d2 = (ix - ix2 - 0.5) ** 2 + 3 * (iy - iy2 - 0.5) ** 2;
    let k = -1;
    if (d1 < d2) { if (jx1 >= 0 && jx1 < nx1 && jy1 >= 0 && jy1 < ny1) k = jx1 * ny1 + jy1; }
    else if (ix2 >= 0 && ix2 < nx && iy2 >= 0 && iy2 < ny) k = n1 + ix2 * ny + iy2;
    if (k < 0) continue;
    count[k]++;
    if (sum) sum[k] += C[i];
    if (lists) lists[k].push(C[i]);
  }
  const accum = new Float64Array(n1 + n2);
  const mincnt = o.mincnt == null ? (C ? 1 : null) : +o.mincnt;
  for (let k = 0; k < n1 + n2; k++) {
    if (mincnt != null && count[k] < mincnt) { accum[k] = NaN; continue; }
    accum[k] = !C ? count[k] : lists ? reduce(lists[k]) : count[k] ? sum[k] / count[k] : NaN;
  }
  const cx = new Float64Array(n1 + n2), cy = new Float64Array(n1 + n2);
  for (let i = 0; i < nx1; i++) for (let j = 0; j < ny1; j++) { const k = i * ny1 + j; cx[k] = xmin + i * sx; cy[k] = ymin + j * sy; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const k = n1 + i * ny + j; cx[k] = xmin + (i + 0.5) * sx; cy[k] = ymin + (j + 0.5) * sy; }
  if (o.bins === 'log' && o.norm == null) o.norm = 'log';
  else if (o.bins != null && o.bins !== 'log') _warn('hexbin.bins', "hexbin(): bins='log' or None (a count or edges isn't supported yet; use norm=BoundaryNorm(...))", this._strict);
  if (o.xscale === 'log' || o.yscale === 'log') _warn('hexbin.xscale', 'hexbin(): log-scaled bins are not supported yet', this._strict);
  const tr = { type: 'hexbin', cx, cy, accum, sx, sy, ext: [xmin, xmax, ymin, ymax], counts: count, opts: o, cmapped: true };
  this._traces.push(tr);
  const out = _result(this, [], { _trace: tr, get_array: () => accum.filter((v) => v === v), get_offsets: () => Array.from(cx, (v, k) => [v, cy[k]]).filter((_, k) => accum[k] === accum[k]), __repr__: () => '<matplotlib.collections.PolyCollection>' });
  return out;
};

// the six corners of a hexagon of the lattice, in units of (sx, sy) — matplotlib's
const _HEX = [[0.5, -0.5 / 3], [0.5, 0.5 / 3], [0, 1 / 3], [-0.5, 0.5 / 3], [-0.5, -0.5 / 3], [0, -1 / 3]];

_KINDS.hexbin = {
  z: 0, cmap: true,
  crange(ax, t) {
    let lo = Infinity, hi = -Infinity, minPos = Infinity;
    for (const v of t.accum) if (v - v === 0) { if (v < lo) lo = v; if (v > hi) hi = v; if (v > 0 && v < minPos) minPos = v; }
    return { lo, hi, minPos: minPos === Infinity ? undefined : minPos };
  },
  // matplotlib autoscales a hexbin tight to its hexagons
  extent(ax, t, axis, log, take, stick) {
    const [x0, x1, y0, y1] = t.ext;
    const a = axis === 'x' ? x0 - t.sx / 2 : y0 - t.sy / 3, b = axis === 'x' ? x1 + t.sx / 2 : y1 + t.sy / 3;
    take(a); take(b); stick(a); stick(b);
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts, norm = ax._cmapNorm(t), at = _indexer(norm);
    const cm = o.cmap || ax._theme.ramp || 'viridis', lut = _cmapLut(cm), fn = lut ? null : getCmap(cm);
    const colorOf = (q) => (lut ? `rgb(${lut[q * 4]},${lut[q * 4 + 1]},${lut[q * 4 + 2]})` : fn((q + 0.5) / 256));
    // one path per colour: at most 256 fills, however many hexagons
    const buckets = new Map();
    const linear = !xScale.log && !yScale.log;
    const off = _HEX.map(([u, v]) => [u * t.sx * xScale.a, v * t.sy * yScale.a]);
    for (let k = 0; k < t.accum.length; k++) {
      const q = at(t.accum[k]);
      if (q < 0) continue;
      let list = buckets.get(q);
      if (!list) buckets.set(q, (list = []));
      list.push(k);
    }
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    const ec = o.edgecolors != null && o.edgecolors !== 'face' ? (o.edgecolors === 'none' ? null : _cssColor(o.edgecolors)) : 'face';
    for (const q of [...buckets.keys()].sort((a, b) => a - b)) {
      ctx.beginPath();
      for (const k of buckets.get(q)) {
        if (linear) {
          const X = xScale.transform(t.cx[k]), Y = yScale.transform(t.cy[k]);
          ctx.moveTo(X + off[0][0], Y + off[0][1]);
          for (let s = 1; s < 6; s++) ctx.lineTo(X + off[s][0], Y + off[s][1]);
        } else {
          for (let s = 0; s < 6; s++) {
            const X = xScale.transform(t.cx[k] + _HEX[s][0] * t.sx), Y = yScale.transform(t.cy[k] + _HEX[s][1] * t.sy);
            if (s) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
          }
        }
        ctx.closePath();
      }
      const c = colorOf(q);
      ctx.fillStyle = c; ctx.fill();
      // matplotlib's edgecolors='face': a hairline of the fill closes the seams
      if (ec === 'face') { ctx.strokeStyle = c; ctx.lineWidth = o.linewidths != null ? +o.linewidths : 0.5; ctx.stroke(); }
      else if (ec) { ctx.strokeStyle = ec; ctx.lineWidth = o.linewidths != null ? +o.linewidths : 0.5; ctx.stroke(); }
    }
    ctx.restore();
  },
  // the hexagon under the pointer: its centre, count and value
  pick(ax, t, px, py) {
    const v = ax.view, X = v.xScale.inverse(px), Y = v.yScale.inverse(py);
    let best = -1, bd = Infinity;
    const [x0, , y0] = t.ext, ix = (X - x0) / t.sx, iy = (Y - y0) / t.sy;
    for (let k = 0; k < t.accum.length; k++) {
      const dx = (t.cx[k] - x0) / t.sx - ix;
      if (Math.abs(dx) > 1) continue;
      const dy = (t.cy[k] - y0) / t.sy - iy, d = dx * dx + 3 * dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0 || bd > 1 || !(t.accum[best] === t.accum[best])) return null;
    return { kind: 'hexbin', index: best, x: t.cx[best], y: t.cy[best], value: t.accum[best], count: t.counts[best] };
  },
};

// ── hist2d ──
function _edges(data, bins, range, name) {
  if (_isArrayLike(bins)) { const e = Float64Array.from(bins, Number); if (e.length < 2) throw new Error(`hist2d: ${name} edges need at least 2 values`); return e; }
  let lo, hi;
  if (range) [lo, hi] = range.map(Number);
  else { lo = Infinity; hi = -Infinity; for (const v of data) if (v - v === 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(lo <= hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const nb = Math.max(1, Math.round(+bins || 10)), e = new Float64Array(nb + 1);
  for (let i = 0; i <= nb; i++) e[i] = lo + ((hi - lo) * i) / nb;
  return e;
}
const _binOf = (e, v) => {
  const n = e.length - 1;
  if (!(v >= e[0] && v <= e[n])) return -1;
  if (v === e[n]) return n - 1;                             // the last edge is inclusive (numpy)
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v >= e[m]) lo = m; else hi = m; }
  return lo;
};

Axes.prototype.hist2d = function (x, y, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  _checkOpts('hist2d', o, this._strict);
  const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
  if (Y.length !== n) throw _lenErr('hist2d', 'y', Y.length, 'x', n);
  const W = o.weights != null ? _col(o.weights) : null;
  if (W && W.length !== n) throw _lenErr('hist2d', 'weights', W.length, 'x', n);
  // bins: n · [nx, ny] · edges · [xedges, yedges] — numpy's rule: a length-2 sequence is one
  // per axis, anything else is for both
  const B = o.bins == null ? 10 : o.bins;
  const [bx, by] = _isArrayLike(B) && B.length === 2 ? [B[0], B[1]] : [B, B];
  const rx = o.range ? o.range[0] : null, ry = o.range ? o.range[1] : null;
  const ex = _edges(X, bx, rx, 'x'), ey = _edges(Y, by, ry, 'y');
  const nxb = ex.length - 1, nyb = ey.length - 1;
  const h = Array.from({ length: nxb }, () => new Float64Array(nyb));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = _binOf(ex, X[i]), b = _binOf(ey, Y[i]);
    if (a < 0 || b < 0) continue;
    const w = W ? W[i] : 1;
    if (!(w - w === 0)) continue;
    h[a][b] += w; total += w;
  }
  if (o.density && total > 0) for (let a = 0; a < nxb; a++) for (let b = 0; b < nyb; b++) h[a][b] /= total * (ex[a + 1] - ex[a]) * (ey[b + 1] - ey[b]);
  // the image: h transposed (rows are y), cmin / cmax masked
  const C = new Float64Array(nxb * nyb);
  for (let b = 0; b < nyb; b++) for (let a = 0; a < nxb; a++) {
    const v = h[a][b];
    C[b * nxb + a] = (o.cmin != null && v < o.cmin) || (o.cmax != null && v > o.cmax) ? NaN : v;
  }
  const pm = {};
  for (const k of ['cmap', 'norm', 'vmin', 'vmax', 'alpha', 'label', 'zorder']) if (o[k] !== undefined) pm[k] = o[k];
  const C2 = Array.from({ length: nyb }, (_, b) => C.subarray(b * nxb, (b + 1) * nxb));
  const image = this.pcolormesh(ex, ey, C2, pm);
  return _result(this, [h, ex, ey, image], { h, xedges: ex, yedges: ey, image, _trace: image._trace });
};

// -- png.js --

// PNG bytes from RGBA, in plain JS: no canvas, no CompressionStream (it is async, and absent in
// some hosts), no dependency. toSVG embeds a draw list's `image` ops with it, so an SVG of a
// raster is built the same in a worker, in Node, and on the page — byte for byte.
//
// Deflate here is one fixed-Huffman block over an LZ77 pass (3-byte hash heads, a chain capped
// at 16 links): a third of a good zlib's speed and a few percent larger, and deterministic. Each
// row takes the PNG filter (none, Sub or Up) with the smallest sum of absolute bytes, the usual
// heuristic; colour-mapped rasters repeat a lot, so Up is often all zeros.

let _CRC = null;
function _crc32(bytes, start, end) {
  if (!_CRC) {
    _CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = _CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── deflate, fixed Huffman ──
const _LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const _LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const _DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const _DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
let _LIT = null, _LITLEN = null, _DIST = null, _LCODE = null;
function _rev(v, n) { let r = 0; for (let i = 0; i < n; i++) { r = (r << 1) | (v & 1); v >>= 1; } return r; }
function _tables() {
  _LIT = new Uint16Array(288); _LITLEN = new Uint8Array(288);
  for (let i = 0; i < 288; i++) {
    let code, len;
    if (i < 144) { code = 0x30 + i; len = 8; } else if (i < 256) { code = 0x190 + i - 144; len = 9; } else if (i < 280) { code = i - 256; len = 7; } else { code = 0xc0 + i - 280; len = 8; }
    _LIT[i] = _rev(code, len); _LITLEN[i] = len;
  }
  _DIST = new Uint8Array(30);
  for (let i = 0; i < 30; i++) _DIST[i] = _rev(i, 5);
  _LCODE = new Uint8Array(259);                       // match length → its code index (0–28)
  for (let c = 0; c < 29; c++) for (let l = _LBASE[c]; l < (c === 28 ? 259 : _LBASE[c + 1]); l++) _LCODE[l] = c;
  _LCODE[258] = 28;
}
function _distCode(d) { let lo = 0, hi = 29; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (_DBASE[m] <= d) lo = m; else hi = m - 1; } return lo; }

function _deflate(data) {
  if (!_LIT) _tables();
  const n = data.length;
  let out = new Uint8Array(Math.max(64, (n >> 1) + 64)), o = 0, bits = 0, nb = 0;
  const put = (v, len) => {
    bits |= v << nb; nb += len;
    while (nb >= 8) {
      if (o >= out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; }
      out[o++] = bits & 255; bits >>>= 8; nb -= 8;
    }
  };
  const lit = (c) => put(_LIT[c], _LITLEN[c]);
  put(1, 1); put(1, 2);                                // BFINAL, BTYPE = fixed Huffman
  const HBITS = 15, HSIZE = 1 << HBITS, WIN = 32768, MAXCHAIN = 16;
  const head = new Int32Array(HSIZE).fill(-1), prev = new Int32Array(WIN);
  const hash = (i) => (((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HSIZE - 1));
  let i = 0;
  while (i < n) {
    let best = 0, dist = 0;
    if (i + 2 < n) {
      const h = hash(i);
      let j = head[h], chain = 0;
      const limit = Math.min(258, n - i);
      while (j >= 0 && i - j <= WIN && chain++ < MAXCHAIN) {
        if (data[j + best] === data[i + best]) {
          let l = 0;
          while (l < limit && data[j + l] === data[i + l]) l++;
          if (l > best) { best = l; dist = i - j; if (l === limit) break; }
        }
        j = prev[j & (WIN - 1)];
      }
      prev[i & (WIN - 1)] = head[h]; head[h] = i;
    }
    if (best >= 3) {
      const c = _LCODE[best];
      lit(257 + c);
      if (_LEXTRA[c]) put(best - _LBASE[c], _LEXTRA[c]);
      const dc = _distCode(dist);
      put(_DIST[dc], 5);
      if (_DEXTRA[dc]) put(dist - _DBASE[dc], _DEXTRA[dc]);
      // index the bytes the match covered, so later matches can start inside it
      for (let k = 1; k < best; k++) { const p = i + k; if (p + 2 < n) { const h = hash(p); prev[p & (WIN - 1)] = head[h]; head[h] = p; } }
      i += best;
    } else { lit(data[i]); i++; }
  }
  lit(256);
  if (nb) put(0, 8 - nb);
  return out.subarray(0, o);
}

function _zlib(data) {
  const d = _deflate(data);
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const out = new Uint8Array(d.length + 6);
  out[0] = 0x78; out[1] = 0x01;
  out.set(d, 2);
  const ad = ((b << 16) | a) >>> 0;
  out[d.length + 2] = ad >>> 24; out[d.length + 3] = (ad >>> 16) & 255; out[d.length + 4] = (ad >>> 8) & 255; out[d.length + 5] = ad & 255;
  return out;
}

// RGBA (w × h × 4 bytes) → PNG bytes
function encodePNG(rgba, w, h) {
  const stride = w * 4, raw = new Uint8Array((stride + 1) * h);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < h; y++) {
    const r = y * stride;
    let bestF = 0, bestS = Infinity;
    for (let f = 0; f < 3; f++) {
      const c = cand[f]; let s = 0;
      for (let x = 0; x < stride; x++) {
        const v = rgba[r + x], left = x >= 4 ? rgba[r + x - 4] : 0, up = y ? rgba[r - stride + x] : 0;
        const q = (f === 0 ? v : f === 1 ? v - left : v - up) & 255;
        c[x] = q; s += q < 128 ? q : 256 - q;
      }
      if (s < bestS) { bestS = s; bestF = f; }
    }
    raw[y * (stride + 1)] = bestF;
    raw.set(cand[bestF], y * (stride + 1) + 1);
  }
  const idat = _zlib(raw);
  const chunks = [['IHDR', _ihdr(w, h)], ['IDAT', idat], ['IEND', new Uint8Array(0)]];
  let len = 8; for (const [, d] of chunks) len += 12 + d.length;
  const out = new Uint8Array(len);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  for (const [type, d] of chunks) {
    const n = d.length;
    out[o] = n >>> 24; out[o + 1] = (n >>> 16) & 255; out[o + 2] = (n >>> 8) & 255; out[o + 3] = n & 255;
    for (let k = 0; k < 4; k++) out[o + 4 + k] = type.charCodeAt(k);
    out.set(d, o + 8);
    const c = _crc32(out, o + 4, o + 8 + n);
    out[o + 8 + n] = c >>> 24; out[o + 9 + n] = (c >>> 16) & 255; out[o + 10 + n] = (c >>> 8) & 255; out[o + 11 + n] = c & 255;
    o += 12 + n;
  }
  return out;
}
function _ihdr(w, h) {
  const d = new Uint8Array(13);
  d[0] = w >>> 24; d[1] = (w >>> 16) & 255; d[2] = (w >>> 8) & 255; d[3] = w & 255;
  d[4] = h >>> 24; d[5] = (h >>> 16) & 255; d[6] = (h >>> 8) & 255; d[7] = h & 255;
  d[8] = 8; d[9] = 6;                                  // 8-bit RGBA; compression, filter, interlace 0
  return d;
}

// -- svg.js --

// SVG from a draw list (spec §10). `toSVG(list)` walks the ops fig.toDrawList() makes and writes
// what a canvas would have painted: paths as `d` strings, text as <text> in the theme's font,
// the raster op as an embedded PNG, clipping as <clipPath>. It reads only the list, so it is the
// same in every host, and the same list always gives the same SVG, byte for byte.
//
// The canvas transform is applied to coordinates as they are added (as a canvas does), so the
// output has no nested transforms except on text and images. plot only ever translates,
// rotates and scales uniformly; arcs assume that (a skewed arc would come out circular).
//
// Big scatters are rasters in the list (one `image` op), and stay rasters in the SVG: an honest
// picture of a million points, small, not a million <circle>s.



const _svgNum = (v) => { const s = (Math.round(v * 100) / 100).toString(); return s === '-0' ? '0' : s; };
const _svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// a paint: [colour, opacity] — rgba() split, so every SVG reader gets it
function _svgPaint(c) {
  if (c == null || c === 'none' || c === 'transparent') return ['none', 0];
  const b = parseColorBytes(String(c).replace(/\s+/g, ''));
  if (!b) return [String(c), 1];
  const hex = '#' + [b[0], b[1], b[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return [hex, b[3] / 255];
}

const _SVG_ANCHOR = { center: 'middle', right: 'end', end: 'end', left: 'start', start: 'start' };
const _SVG_BASELINE = { top: 'text-before-edge', hanging: 'hanging', middle: 'central', bottom: 'text-after-edge', ideographic: 'ideographic', alphabetic: 'alphabetic' };

function _svgFont(f) {
  const m = /^\s*(?:(italic|oblique)\s+)?(?:(normal|bold|bolder|lighter|[1-9]00)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(f || '');
  if (!m) return { size: 10, family: 'sans-serif', weight: null, style: null };
  return { style: m[1] || null, weight: m[2] && m[2] !== 'normal' ? m[2] : null, size: +m[3], family: m[4].trim() };
}

function _b64bytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
function _bytesB64(bytes) {
  if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  return Buffer.from(bytes).toString('base64');
}

function toSVG(list, opts) {
  const o = opts || {};
  if (!list || !Array.isArray(list.ops)) throw new TypeError('toSVG: expected a draw list (fig.toDrawList())');
  const W = list.width, H = list.height;
  const DEF = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', lineDashOffset: 0 };
  let st = { ...DEF, m: [1, 0, 0, 1, 0, 0], dash: [], clip: null };
  const stack = [];
  const defs = [], body = [];
  let clipN = 0, group = null;
  let path = [], cur = null, start = null;

  const T = (x, y) => { const m = st.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  const scaleOf = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const pt = (p) => `${_svgNum(p[0])} ${_svgNum(p[1])}`;
  const emit = (el) => {
    // consecutive elements under one clip share a group
    if (group !== st.clip) { if (group) body.push('</g>'); group = st.clip; if (group) body.push(`<g clip-path="url(#${group})">`); }
    body.push(el);
  };
  const alpha = (a) => (a < 1 ? ` opacity="${_svgNum(a * 1000) / 1000}"` : '');
  const d = () => path.join('');

  const arc = (x, y, r, a0, a1, ccw) => {
    const TAU = 2 * Math.PI;
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= TAU - 1e-9 || sweep <= -TAU + 1e-9;
    if (!full) { sweep %= TAU; if (sweep < 0) sweep += TAU; }
    const at = (a) => T(x + r * Math.cos(a), y + r * Math.sin(a));
    const S = at(a0);
    // a canvas joins the arc to the current point; already there (a marker's moveTo), no join
    if (!cur) { path.push(`M${pt(S)}`); start = S; }
    else if (_svgNum(cur[0]) !== _svgNum(S[0]) || _svgNum(cur[1]) !== _svgNum(S[1])) path.push(`L${pt(S)}`);
    const R = _svgNum(r * scaleOf());
    let flag = ccw ? 0 : 1;
    if (st.m[0] * st.m[3] - st.m[1] * st.m[2] < 0) flag = 1 - flag;
    const dir = ccw ? -1 : 1;
    if (full) {
      const M = at(a0 + dir * Math.PI);
      path.push(`A${R} ${R} 0 0 ${flag} ${pt(M)}A${R} ${R} 0 0 ${flag} ${pt(S)}`);
      cur = S;
    } else {
      const E = at(a0 + dir * sweep);
      path.push(`A${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} ${flag} ${pt(E)}`);
      cur = E;
    }
  };

  for (const op of list.ops) {
    const [name, ...a] = op;
    switch (name) {
      case 'set': st[a[0]] = a[1]; break;
      case 'save': stack.push({ ...st, m: st.m.slice(), dash: st.dash.slice() }); break;
      case 'restore': if (stack.length) st = stack.pop(); break;
      case 'setLineDash': st.dash = Array.from(a[0] || []); break;
      case 'translate': st.m = mul(st.m, [1, 0, 0, 1, a[0], a[1]]); break;
      case 'scale': st.m = mul(st.m, [a[0], 0, 0, a[1], 0, 0]); break;
      case 'rotate': { const c = Math.cos(a[0]), s = Math.sin(a[0]); st.m = mul(st.m, [c, s, -s, c, 0, 0]); break; }
      case 'transform': st.m = mul(st.m, a); break;
      case 'setTransform': st.m = a.length === 6 ? a.slice() : [1, 0, 0, 1, 0, 0]; break;
      case 'resetTransform': st.m = [1, 0, 0, 1, 0, 0]; break;
      case 'beginPath': path = []; cur = start = null; break;
      case 'moveTo': { const p = T(a[0], a[1]); path.push(`M${pt(p)}`); cur = start = p; break; }
      case 'lineTo': { const p = T(a[0], a[1]); path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); if (!cur) start = p; cur = p; break; }
      case 'closePath': if (cur) { path.push('Z'); cur = start; } break;
      case 'rect': {
        const [x, y, w, h] = a, P = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)];
        path.push(`M${pt(P[0])}L${pt(P[1])}L${pt(P[2])}L${pt(P[3])}Z`); cur = start = P[0]; break;
      }
      case 'arc': arc(a[0], a[1], a[2], a[3], a[4], !!a[5]); break;
      case 'ellipse': {
        // sampled: plot draws no ellipse today; a polyline keeps any that come exact enough
        const [x, y, rx, ry, rot, a0, a1, ccw] = a, N = 64;
        let sw = ccw ? a0 - a1 : a1 - a0; if (sw < 0) sw += 2 * Math.PI;
        for (let k = 0; k <= N; k++) {
          const t = a0 + (ccw ? -1 : 1) * (sw * k) / N, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
          const p = T(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot));
          path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); if (!cur) start = p; cur = p;
        }
        break;
      }
      case 'quadraticCurveTo': { const c = T(a[0], a[1]), p = T(a[2], a[3]); path.push(`Q${pt(c)} ${pt(p)}`); cur = p; break; }
      case 'bezierCurveTo': { const c1 = T(a[0], a[1]), c2 = T(a[2], a[3]), p = T(a[4], a[5]); path.push(`C${pt(c1)} ${pt(c2)} ${pt(p)}`); cur = p; break; }
      case 'arcTo': { const p = T(a[2], a[3]); path.push(cur ? `L${pt(p)}` : `M${pt(p)}`); cur = p; break; }
      case 'fill': {
        if (!path.length) break;
        const [c, op_] = _svgPaint(st.fillStyle);
        if (c === 'none') break;
        const rule = a[0] === 'evenodd' ? ' fill-rule="evenodd"' : '';
        emit(`<path d="${d()}" fill="${c}"${rule}${alpha(op_ * st.globalAlpha)}/>`);
        break;
      }
      case 'stroke': {
        if (!path.length) break;
        const el = _svgStroke(`<path d="${d()}" fill="none"`, st, scaleOf());
        if (el) emit(el);
        break;
      }
      case 'fillRect': case 'strokeRect': {
        const [x, y, w, h] = a, m = st.m;
        const fill = name === 'fillRect';
        const [c, op_] = _svgPaint(fill ? st.fillStyle : st.strokeStyle);
        if (c === 'none' || !(w && h)) break;
        let geom;
        if (m[1] === 0 && m[2] === 0) {
          const p = T(x, y), q = T(x + w, y + h);
          geom = `<rect x="${_svgNum(Math.min(p[0], q[0]))}" y="${_svgNum(Math.min(p[1], q[1]))}" width="${_svgNum(Math.abs(q[0] - p[0]))}" height="${_svgNum(Math.abs(q[1] - p[1]))}"`;
        } else {
          const P = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)];
          geom = `<path d="M${pt(P[0])}L${pt(P[1])}L${pt(P[2])}L${pt(P[3])}Z"`;
        }
        if (fill) emit(`${geom} fill="${c}"${alpha(op_ * st.globalAlpha)}/>`);
        else { const el = _svgStroke(`${geom} fill="none"`, st, scaleOf()); if (el) emit(el); }
        break;
      }
      case 'clearRect': break;   // nothing under an SVG to clear; the figure paints its own face
      case 'clip': {
        if (!path.length) break;
        const id = `${o.idPrefix || 'p'}c${++clipN}`;
        const nest = st.clip ? ` clip-path="url(#${st.clip})"` : '';
        defs.push(`<clipPath id="${id}"${nest}><path d="${d()}"${a[0] === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
        st.clip = id;
        break;
      }
      case 'fillText': case 'strokeText': {
        const [s, x, y] = a;
        if (s == null || s === '') break;
        const f = _svgFont(st.font), p = T(x, y), k = scaleOf();
        const ang = Math.atan2(st.m[1], st.m[0]) * 180 / Math.PI;
        const fill = name === 'fillText';
        const [c, op_] = _svgPaint(fill ? st.fillStyle : st.strokeStyle);
        if (c === 'none') break;
        let el = `<text x="${_svgNum(p[0])}" y="${_svgNum(p[1])}" font-family="${_svgEsc(f.family.replace(/"/g, "'"))}" font-size="${_svgNum(f.size * k)}"`;
        if (f.weight) el += ` font-weight="${f.weight}"`;
        if (f.style) el += ` font-style="${f.style}"`;
        const an = _SVG_ANCHOR[st.textAlign] || 'start';
        if (an !== 'start') el += ` text-anchor="${an}"`;
        const bl = _SVG_BASELINE[st.textBaseline] || 'alphabetic';
        if (bl !== 'alphabetic') el += ` dominant-baseline="${bl}"`;
        if (Math.abs(ang) > 1e-6) el += ` transform="rotate(${_svgNum(ang)} ${_svgNum(p[0])} ${_svgNum(p[1])})"`;
        if (fill) el += ` fill="${c}"${alpha(op_ * st.globalAlpha)}`;
        else el += ` fill="none" stroke="${c}" stroke-width="${_svgNum(st.lineWidth * k)}" stroke-linejoin="round"${alpha(op_ * st.globalAlpha)}`;
        emit(`${el}>${_svgEsc(s)}</text>`);
        break;
      }
      case 'image': {
        const [x, y, w, h, cols, rows, b64] = a;
        const png = encodePNG(_b64bytes(b64), cols, rows);
        const m = st.m, ident = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
        const tf = ident ? '' : ` transform="matrix(${m.map(_svgNum).join(' ')})"`;
        emit(`<image x="${_svgNum(x)}" y="${_svgNum(y)}" width="${_svgNum(w)}" height="${_svgNum(h)}" preserveAspectRatio="none" style="image-rendering:pixelated"${tf}${alpha(st.globalAlpha)} href="data:image/png;base64,${_bytesB64(png)}"/>`);
        break;
      }
      default: throw new Error(`toSVG: unknown op '${name}'`);
    }
  }
  if (group) body.push('</g>');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${_svgNum(W)}" height="${_svgNum(H)}" viewBox="0 0 ${_svgNum(W)} ${_svgNum(H)}">`;
  // an export's face, under everything (Figure.toSVG passes the theme's background when the
  // figure has none of its own)
  const [fc, fo] = _svgPaint(o.facecolor);
  const face = fc !== 'none' ? `<rect width="${_svgNum(W)}" height="${_svgNum(H)}" fill="${fc}"${fo < 1 ? ` opacity="${_svgNum(fo * 1000) / 1000}"` : ''}/>\n` : '';
  return `${head}\n${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${face}${body.join('\n')}\n</svg>\n`;
}

function _svgStroke(open, st, k) {
  const [c, op_] = _svgPaint(st.strokeStyle);
  if (c === 'none') return '';
  let el = `${open} stroke="${c}" stroke-width="${_svgNum(st.lineWidth * k)}"`;
  if (st.lineCap !== 'butt') el += ` stroke-linecap="${st.lineCap}"`;
  if (st.lineJoin !== 'miter') el += ` stroke-linejoin="${st.lineJoin}"`;
  if (st.dash.length) el += ` stroke-dasharray="${st.dash.map((v) => _svgNum(v * k)).join(' ')}"`;
  if (st.dash.length && st.lineDashOffset) el += ` stroke-dashoffset="${_svgNum(st.lineDashOffset * k)}"`;
  if (op_ * st.globalAlpha < 1) el += ` opacity="${_svgNum(op_ * st.globalAlpha * 1000) / 1000}"`;
  return el + '/>';
}

// -- interact.js --

// @gcu/plot/interact — interaction for a figure on a page (spec §9). Opt-in: the core never
// touches the DOM's events; this module does, and only when called.
//
//   const ui = interact(fig, canvas?, {readout, crosshair, units, format, extra, brush,
//                                      onBrush, onClick, onViewChange, radius, label})
//   document.body.append(ui.element)              // the canvas, wrapped with its overlay
//   ui.on('brush' | 'click' | 'view' | 'hover', fn) · ui.off(…) · ui.reset() · ui.redraw()
//   ui.setSelection({axes, x: [lo, hi], y: [lo, hi]} | null) · ui.destroy()
//   link([ax1, ax2, …], {x: true, y: false})       // linked views, across figures too
//
// - Hover: a readout, crosshair and highlight ring, drawn on an OVERLAY canvas — a pointer
//   move never redraws the figure. The readout names the picked trace and its values
//   (format(pick) replaces the lines, extra(trace, index) adds some); with nothing picked it
//   shows the coordinates under the pointer (with units: a plan view's readout).
// - Wheel zooms about the cursor (shift: x only, alt: y only; never one axis alone at equal
//   aspect, which would break it); drag pans; double-click resets. Everything is done in pixel
//   space through the axes' own scales, so log and inverted axes zoom and pan correctly.
// - Shift-drag brushes (or plain drag, with {brush: 'x' | 'y' | 'xy'}): onBrush({axes,
//   x: [lo, hi] | null, y: [lo, hi] | null}); a click clears it.
// - Keyboard: the canvas is focusable with an aria-label; arrows pan, + and − zoom, 0 resets,
//   Esc clears the selection. Touch: pointer events, two fingers pinch-zoom and pan.
// - The figure's limits are plain set_xlim / set_ylim, so a shared axis (subplots(sharex))
//   moves with it; link() goes across figures. ax.set_view() from a host redraws the figure
//   and fires no onViewChange (it came from outside), so two views can follow each other
//   without echoing.

const _figs = new WeakMap();           // figure → its controller (link redraws through it)

function interact(fig, canvas, opts) {
  if (canvas && !(typeof canvas.getContext === 'function') && typeof canvas === 'object' && opts === undefined) { opts = canvas; canvas = null; }
  if (!fig || !Array.isArray(fig.axes)) throw new TypeError('interact: expected a Figure (subplots()[0])');
  if (typeof document === 'undefined') throw new Error('interact: needs a DOM; with none, use ax.pick / toData / toPixel directly');
  const o = opts || {};
  if (_figs.has(fig)) _figs.get(fig).destroy();
  canvas = canvas || fig.show();
  const th = fig._theme;
  const listeners = { brush: [], click: [], view: [], hover: [] };
  if (o.onBrush) listeners.brush.push(o.onBrush);
  if (o.onClick) listeners.click.push(o.onClick);
  if (o.onViewChange) listeners.view.push(o.onViewChange);
  if (o.onHover) listeners.hover.push(o.onHover);
  const emit = (ev, arg) => { for (const fn of listeners[ev]) { try { fn(arg); } catch (e) { console.error(e); } } };

  // ── the wrapper and the overlay ──
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;line-height:0;';
  if (canvas.parentNode) canvas.parentNode.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  const over = document.createElement('canvas');
  over.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  wrap.appendChild(over);
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.style.outline = 'none';
  const label = o.label || [fig._suptitle && fig._suptitle.text, ...fig.axes.map((a) => a._title && a._title.text)].filter(Boolean).join('; ') || 'chart';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label} — interactive: drag to pan, wheel or + and − to zoom, arrows to pan, 0 to reset`);

  const dprOf = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const sizeTo = () => {
    const dpr = dprOf();
    for (const c of [canvas, over]) {
      const w = Math.round(fig.width * dpr), h = Math.round(fig.height * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      c.style.width = fig.width + 'px'; c.style.height = fig.height + 'px';
    }
  };

  // ── drawing ──
  let frame = 0, pendingView = null, hover = null, sel = null, drag = null;
  const draw = () => {
    frame = 0;
    sizeTo();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fig.draw(ctx, { dpr: dprOf() });
    if (pendingView) { const axs = pendingView; pendingView = null; for (const ax of axs) emit('view', { axes: ax, xlim: ax.get_xlim(), ylim: ax.get_ylim() }); }
    // the pointer's pick belongs to the old view; look again
    if (hover) hover = hoverAt(hover.px, hover.py);
    drawOverlay();
  };
  const request = () => { if (!frame) frame = requestAnimationFrame(draw); };
  fig._requestDraw = request;

  const ox = () => over.getContext('2d');
  function drawOverlay() {
    const dpr = dprOf(), g = ox();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, over.width, over.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sel && sel.axes.view) drawBrush(g, sel.axes, sel.x, sel.y, false);
    if (drag && drag.mode === 'brush') drawBrush(g, drag.ax, ...drag.range(), true);
    if (hover && !drag) drawHover(g, hover);
  }
  function drawBrush(g, ax, xr, yr, live) {
    const v = ax.view;
    const xs = xr ? xr.map((d) => v.xScale.transform(d)) : [v.x, v.x + v.w];
    const ys = yr ? yr.map((d) => v.yScale.transform(d)) : [v.y, v.y + v.h];
    const x0 = Math.max(v.x, Math.min(...xs)), x1 = Math.min(v.x + v.w, Math.max(...xs));
    const y0 = Math.max(v.y, Math.min(...ys)), y1 = Math.min(v.y + v.h, Math.max(...ys));
    g.save();
    g.fillStyle = th.selection || th.accent;
    g.globalAlpha = live ? 0.18 : 0.12;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.globalAlpha = 1;
    g.strokeStyle = th.selection || th.accent;
    g.lineWidth = 1;
    g.setLineDash(live ? [4, 3] : []);
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    g.restore();
  }
  const fontOf = (d = -1) => `${(th.font_size || 11) + d}px ${th.mono || th.font || 'monospace'}`;
  function drawHover(g, h) {
    const ax = h.ax, v = ax.view;
    g.save();
    if (o.crosshair !== false) {
      g.strokeStyle = th.muted || th.foreground;
      g.globalAlpha = 0.6;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(Math.round(h.px) + 0.5, v.y); g.lineTo(Math.round(h.px) + 0.5, v.y + v.h);
      g.moveTo(v.x, Math.round(h.py) + 0.5); g.lineTo(v.x + v.w, Math.round(h.py) + 0.5);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    if (h.pick && h.pick.kind !== 'polygon' && h.pick.x != null) {
      const [qx, qy] = h.pick.axes.toPixel(h.pick.x, h.pick.y);
      if (qx - qx === 0 && qy - qy === 0) {
        g.strokeStyle = th.halo; g.lineWidth = 4;
        g.beginPath(); g.arc(qx, qy, 6, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = th.accent; g.lineWidth = 2;
        g.beginPath(); g.arc(qx, qy, 6, 0, 2 * Math.PI); g.stroke();
      }
    }
    if (o.readout !== false && h.lines.length) {
      g.font = fontOf(-1);
      const lh = (th.font_size || 11) + 3, pad = 6;
      const w = Math.max(...h.lines.map((s) => g.measureText(s).width)) + 2 * pad, hh = h.lines.length * lh + 2 * pad - 3;
      let bx = h.px + 14, by = h.py + 14;
      if (bx + w > fig.width - 2) bx = h.px - 14 - w;
      if (by + hh > fig.height - 2) by = h.py - 14 - hh;
      bx = Math.max(2, bx); by = Math.max(2, by);
      g.fillStyle = th.panel || th.background;
      g.globalAlpha = 0.94;
      g.fillRect(bx, by, w, hh);
      g.globalAlpha = 1;
      g.strokeStyle = th.panel_border || th.frame;
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, w - 1, hh - 1);
      g.fillStyle = th.foreground;
      g.textBaseline = 'top';
      h.lines.forEach((s, i) => g.fillText(s, bx + pad, by + pad + i * lh));
    }
    g.restore();
  }

  // ── the readout's numbers: as many decimals as one pixel resolves ──
  const unitOf = (axis) => (o.units == null ? '' : typeof o.units === 'string' ? o.units : o.units[axis] || '');
  const nameOf = (ax, axis) => { const l = axis === 'x' ? ax._xlabel : ax._ylabel; const t = l && String(l.text); return t && t.length <= 14 ? t : axis; };
  function fmtAxis(ax, axis, val) {
    if (val == null || val !== val) return '—';
    if (typeof val === 'string') return val;
    const cats = axis === 'x' ? ax._xcats : ax._ycats;
    if (cats && Number.isInteger(val) && cats.list[val] != null) return cats.list[val];
    const v = ax.view, s = axis === 'x' ? v.xScale : v.yScale;
    // a date axis: the date, to what one pixel resolves (UTC, as its ticks)
    if (axis === 'x' ? ax._xdate : ax._ydate) {
      const per = Math.abs(s.domain[1] - s.domain[0]) / (axis === 'x' ? v.w : v.h);
      const iso = new Date(val).toISOString();
      return per >= 864e5 ? iso.slice(0, 10) : per >= 6e4 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : per >= 1e3 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(11, 23);
    }
    let str;
    if (s.log) str = Number(val).toPrecision(4);
    else {
      const per = Math.abs(s.domain[1] - s.domain[0]) / (axis === 'x' ? v.w : v.h);
      const dec = Math.max(0, Math.min(8, Math.ceil(-Math.log10(per))));
      str = Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    const u = unitOf(axis);
    return u ? `${str} ${u}` : str;
  }
  const fmtNum = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toPrecision(4) : String(+v.toPrecision(5)));
  function linesOf(ax, pick, xd, yd) {
    if (pick && o.format) { const r = o.format(pick); return r == null ? [] : Array.isArray(r) ? r.map(String) : String(r).split('\n'); }
    const out = [];
    if (pick) {
      if (pick.label) out.push(String(pick.label));
      if (pick.kind === 'polygon') {
        const p = pick.properties || {};
        for (const k of Object.keys(p).slice(0, 6)) out.push(`${k}: ${fmtNum(p[k])}`);
        out.push(`${nameOf(ax, 'x')} = ${fmtAxis(ax, 'x', xd)}`, `${nameOf(ax, 'y')} = ${fmtAxis(ax, 'y', yd)}`);
      } else {
        out.push(`${nameOf(pick.axes, 'x')} = ${fmtAxis(pick.axes, 'x', pick.x)}`, `${nameOf(pick.axes, 'y')} = ${fmtAxis(pick.axes, 'y', pick.y)}`);
        if (pick.value != null) out.push(`value = ${fmtNum(pick.value)}`);
        else if (typeof pick.c === 'number') out.push(`c = ${fmtNum(pick.c)}`);
        if (pick.kind === 'bin' && pick.edges) out.push(`bin = [${fmtNum(pick.edges[0])}, ${fmtNum(pick.edges[1])})`);
      }
      if (o.extra) { const e = o.extra(pick.trace, pick.index, pick); if (e != null) out.push(...(Array.isArray(e) ? e : String(e).split('\n')).map(String)); }
    } else if (o.coordinates !== false) {
      out.push(`${nameOf(ax, 'x')} = ${fmtAxis(ax, 'x', xd)}`, `${nameOf(ax, 'y')} = ${fmtAxis(ax, 'y', yd)}`);
    }
    return out;
  }
  function hoverAt(px, py) {
    const ax = fig.axesAt(px, py);
    if (!ax) return null;
    const pick = ax.pick(px, py, { radius: o.radius != null ? o.radius : 8 });
    const [xd, yd] = ax.toData(px, py);
    return { ax, px, py, pick, lines: linesOf(ax, pick, xd, yd) };
  }

  // ── the view: zoom and pan in PIXEL space, through the axes' own scales ──
  // the limits that put pixel x0 at the left edge and x1 at the right (display order: an
  // inverted axis stays inverted, a log axis stays geometric)
  const limsAt = (s, p0, p1) => [s.inverse(p0), s.inverse(p1)];
  const changed = new Set();
  function setLims(ax, xl, yl) {
    if (xl && xl.every((v) => v - v === 0)) ax.set_xlim(xl[0], xl[1]);
    if (yl && yl.every((v) => v - v === 0)) ax.set_ylim(yl[0], yl[1]);
    changed.add(ax);
    // linked views, in other figures too (their own redraw); the link says which axes follow
    for (const l of ax._links || []) for (const b of l.axes) {
      if (b === ax) continue;
      if (l.x && xl) b.set_xlim(xl[0], xl[1]);
      if (l.y && yl) b.set_ylim(yl[0], yl[1]);
      const c = b.figure && _figs.get(b.figure);
      if (c && b.figure !== fig) c._viewFromLink(b); else changed.add(b);
    }
  }
  function commitView() {
    pendingView = [...changed];
    changed.clear();
    request();
  }
  const equalAspect = (ax) => ax._aspect === 'equal';
  function zoomAt(ax, cx, cy, f, lockAxis) {
    const v = ax.view;
    const only = equalAspect(ax) ? null : lockAxis;
    const xl = only === 'y' ? null : limsAt(v.xScale, cx + (v.x - cx) * f, cx + (v.x + v.w - cx) * f);
    const yl = only === 'x' ? null : limsAt(v.yScale, cy + (v.y + v.h - cy) * f, cy + (v.y - cy) * f);
    setLims(ax, xl, yl);
  }
  function panBy(ax, view, dx, dy) {
    const v = view;
    setLims(ax, limsAt(v.xScale, v.x - dx, v.x + v.w - dx), limsAt(v.yScale, v.y + v.h - dy, v.y - dy));
  }
  function reset() {
    for (const [ax, h] of home) setLims(ax, h.x, h.y);
    commitView();
  }

  // ── pointer events ──
  const pointers = new Map();
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) * fig.width) / r.width, ((e.clientY - r.top) * fig.height) / r.height]; };
  const snapView = (ax) => ({ ...ax.view, xScale: ax.view.xScale, yScale: ax.view.yScale });
  function onDown(e) {
    canvas.focus({ preventScroll: true });
    const [px, py] = local(e);
    pointers.set(e.pointerId, { px, py });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (pointers.size === 2) {
      // a pinch: from the two fingers' midpoint and distance
      const [a, b] = [...pointers.values()];
      const ax = fig.axesAt((a.px + b.px) / 2, (a.py + b.py) / 2) || (drag && drag.ax);
      if (!ax) return;
      drag = { mode: 'pinch', ax, view: snapView(ax), mid: [(a.px + b.px) / 2, (a.py + b.py) / 2], dist: Math.hypot(a.px - b.px, a.py - b.py) || 1 };
      return;
    }
    const ax = fig.axesAt(px, py);
    if (!ax || (e.button != null && e.button > 1)) return;
    const brushMode = o.brush ? (e.shiftKey ? null : o.brush) : e.shiftKey ? 'xy' : null;
    const mode = e.button === 1 ? 'pan' : brushMode ? 'brush' : 'pan';
    drag = {
      mode, ax, view: snapView(ax), x0: px, y0: py, x1: px, y1: py, moved: false, brush: brushMode,
      range() {
        const v = this.view, b = this.brush;
        const xr = b === 'y' ? null : [v.xScale.inverse(this.x0), v.xScale.inverse(this.x1)].sort((p, q) => p - q);
        const yr = b === 'x' ? null : [v.yScale.inverse(this.y0), v.yScale.inverse(this.y1)].sort((p, q) => p - q);
        return [xr, yr];
      },
    };
  }
  function onMove(e) {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { px, py });
    if (drag && drag.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = [(a.px + b.px) / 2, (a.py + b.py) / 2], dist = Math.hypot(a.px - b.px, a.py - b.py) || 1;
      const f = drag.dist / dist, v = drag.view;
      // scale about the starting midpoint, then follow the midpoint's travel
      const cx = drag.mid[0], cy = drag.mid[1], dx = mid[0] - cx, dy = mid[1] - cy;
      const xl = limsAt(v.xScale, cx + (v.x - cx) * f - dx * f, cx + (v.x + v.w - cx) * f - dx * f);
      const yl = limsAt(v.yScale, cy + (v.y + v.h - cy) * f - dy * f, cy + (v.y - cy) * f - dy * f);
      setLims(drag.ax, xl, yl);
      commitView();
      return;
    }
    if (drag) {
      drag.x1 = px; drag.y1 = py;
      if (Math.abs(px - drag.x0) + Math.abs(py - drag.y0) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.mode === 'pan') { panBy(drag.ax, drag.view, px - drag.x0, py - drag.y0); commitView(); }
      else drawOverlay();
      return;
    }
    hover = hoverAt(px, py);
    drawOverlay();
    if (hover) emit('hover', hover.pick);
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const d = drag;
    if (d.mode === 'pinch') { if (pointers.size === 0) drag = null; return; }
    drag = null;
    if (!d.moved) {
      // a click: clears a brush, and reports what's under it
      if (sel) setSelection(null);
      const pick = d.ax.pick(d.x0, d.y0, { radius: o.radius != null ? o.radius : 8 });
      emit('click', pick ? { ...pick } : { axes: d.ax, pick: null, x: d.ax.toData(d.x0, d.y0)[0], y: d.ax.toData(d.x0, d.y0)[1] });
    } else if (d.mode === 'brush') {
      const [x, y] = d.range();
      setSelection({ axes: d.ax, x, y });
    }
    drawOverlay();
  }
  function onLeave() { if (!drag) { hover = null; drawOverlay(); } }
  function onWheel(e) {
    const [px, py] = local(e);
    const ax = fig.axesAt(px, py);
    if (!ax) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0015)));
    zoomAt(ax, px, py, f, e.shiftKey ? 'x' : e.altKey ? 'y' : null);
    commitView();
  }
  function onDbl(e) { e.preventDefault(); reset(); }
  function onKey(e) {
    const ax = (hover && hover.ax) || (sel && sel.axes) || fig.axes[0];
    if (!ax || !ax.view) return;
    const v = ax.view, cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const step = 0.1;
    let done = true;
    switch (e.key) {
      case 'ArrowLeft': panBy(ax, v, v.w * step, 0); break;
      case 'ArrowRight': panBy(ax, v, -v.w * step, 0); break;
      case 'ArrowUp': panBy(ax, v, 0, v.h * step); break;
      case 'ArrowDown': panBy(ax, v, 0, -v.h * step); break;
      case '+': case '=': zoomAt(ax, cx, cy, 0.8, null); break;
      case '-': case '_': zoomAt(ax, cx, cy, 1.25, null); break;
      case '0': case 'Home': reset(); return e.preventDefault();
      case 'Escape': if (sel) setSelection(null); else done = false; break;
      default: done = false;
    }
    if (!done) return;
    e.preventDefault();
    if (e.key !== 'Escape') commitView();
  }

  function setSelection(s) {
    sel = s && s.axes ? { axes: s.axes, x: s.x || null, y: s.y || null } : null;
    drawOverlay();
    emit('brush', sel ? { ...sel } : null);
  }

  // the first draw, then the home limits (ax.view exists from then on)
  draw();
  const home = new Map(fig.axes.map((ax) => [ax, { x: ax.get_xlim(), y: ax.get_ylim() }]));

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('keydown', onKey);

  const ctl = {
    element: wrap, canvas, overlay: over, figure: fig,
    on(ev, fn) { if (!listeners[ev]) throw new Error(`interact: no event '${ev}'; use brush, click, view or hover`); listeners[ev].push(fn); return ctl; },
    off(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } return ctl; },
    reset, setSelection, redraw: request,
    get selection() { return sel ? { ...sel } : null; },
    // a linked axes in this figure moved: redraw here, and say so
    _viewFromLink(ax) { changed.add(ax); commitView(); },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('keydown', onKey);
      if (frame) cancelAnimationFrame(frame);
      if (fig._requestDraw === request) delete fig._requestDraw;
      over.remove();
      if (wrap.parentNode) wrap.parentNode.replaceChild(canvas, wrap);
      _figs.delete(fig);
    },
  };
  _figs.set(fig, ctl);
  return ctl;
}

// link([ax1, ax2, …], {x = true, y = true}) — these axes share their view: zooming or panning
// one moves the others, in other figures too. Returns an unlink function.
function link(axes, opts) {
  const o = opts || {};
  const l = { axes: Array.from(axes), x: o.x !== false, y: o.y !== false };
  if (!l.x && !l.y) throw new Error('link: link x, y or both');
  for (const ax of l.axes) (ax._links || (ax._links = [])).push(l);
  return () => { for (const ax of l.axes) if (ax._links) ax._links = ax._links.filter((k) => k !== l); };
}

// -- figure.js --

// Figure — canvas management, subplot grid, DPI handling



// the chart kinds beyond the core: they add to Axes.prototype, so they load after axes.js












// Figures shown (or saved) where there is no DOM, in order. plt.shown() / plt.saved() read
// them, plt.close(fig) / plt.close('all') / plt.clf() clear them.
const _shownFigures = [];
const _savedFigures = [];
function _recordShown(fig) {
  if (!_shownFigures.includes(fig)) _shownFigures.push(fig);
}

class Figure {
  constructor(nrows, ncols, opts) {
    this.nrows = nrows || 1;
    this.ncols = ncols || 1;
    const o = opts || {};
    this._opts = o;                   // plt.subplot() rebuilds an untouched figure as a grid with them
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
      ax.figure = this;
      this.axes.push(ax);
    }
    this._share('x', o.sharex);
    this._share('y', o.sharey);
  }

  // the figure's face: facecolor if given, else the theme's figure surface
  get facecolor() { return this._facecolor || this._theme.figure; }
  set facecolor(c) { this._facecolor = c; }
  // fig.set_facecolor('none') with ax.set_facecolor('none'): only the chrome is drawn, so the
  // figure can sit over another renderer's canvas (§9a)
  set_facecolor(c) { this._facecolor = c; return this; }
  get_facecolor() { return this.facecolor; }

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

  // fig.colorbar(mappable, {ax}): the bar on the mappable's axes (or ax)
  colorbar(mappable, opts) {
    const o = opts && typeof opts === 'object' ? { ...opts } : {};
    const ax = o.ax || (mappable && mappable.axes) || this.axes[0];
    delete o.ax;
    return ax.colorbar(mappable, o);
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
    this._displayed = true;           // pyplot's end-of-cell display skips a figure already shown
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

  __repr__() { return `<Figure size ${Math.round(this.width)}x${Math.round(this.height)} with ${this.axes.length} Axes>`; }

  // Draw the whole figure on anything shaped like a CanvasRenderingContext2D.
  draw(ctx, { dpr = 1 } = {}) {
    if (dpr !== 1) ctx.scale(dpr, dpr);

    // background
    if (this.facecolor !== 'transparent' && this.facecolor !== 'none') {
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

  // The figure as an SVG string, from its draw list (svg.js): the same in every host.
  // The theme's figure surface may be 'transparent' (the dark default, so a figure blends into
  // the page it sits on); a FILE has no page, so an export paints the theme's background
  // under it unless the face was set (fig.set_facecolor('none') stays transparent) or
  // {facecolor} is given.
  toSVG(opts) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    if (o.facecolor === undefined) o.facecolor = this._exportFace();
    return toSVG(this.toDrawList(), o);
  }
  _exportFace() {
    if (this._facecolor) return null;           // set by the caller: the draw list paints it (or not)
    return this.facecolor === 'transparent' || this.facecolor === 'none' ? this._theme.background : null;
  }

  // savefig('x.png') · savefig('x.svg') · savefig(name, {format: 'svg' | 'png'}). In the
  // notebook: a download. With no DOM: record { name, format, figure } for plt.saved() (and
  // the figure for plt.shown()) so the host can offer the file (figure.toSVG() / toPNG()).
  savefig(filename, opts) {
    if (_plainOpts(filename)) { opts = filename; filename = opts.fname; }
    const o = _plainOpts(opts) ? opts : {};
    let name = (typeof filename === 'string' && filename) || '';
    const ext = /\.([a-z0-9]+)$/i.exec(name);
    const format = String(o.format || (ext ? ext[1] : 'png')).toLowerCase();
    if (format !== 'png' && format !== 'svg') throw new Error(`savefig: format '${format}' is not supported; use 'png' or 'svg'`);
    if (!name) name = `figure.${format}`;
    if (typeof document === 'undefined') {
      _savedFigures.push({ name, format, figure: this });
      _recordShown(this);
      return this;
    }
    const link = document.createElement('a');
    link.download = name;
    if (format === 'svg') {
      const url = URL.createObjectURL(new Blob([this.toSVG()], { type: 'image/svg+xml' }));
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } else {
      const canvas = this.show(), face = this._exportFace();
      if (face) {
        // the face goes under what's drawn
        const g = canvas.getContext('2d');
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over';
        g.fillStyle = face; g.fillRect(0, 0, canvas.width, canvas.height); g.restore();
      }
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }
}

// -- api.js --

// Public API — subplots() factory, quick one-liners, plt extension registration










// one version string, read by the extension registration below (package.json carries the same)
const VERSION = '0.2.0';

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

function subplots(nrows, ncols, opts) {
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
    // matplotlib's ndarray exposes `.flat` for row-major flat iteration
    // alongside the nested [r][c] view. We mirror that so callers can
    // do `axes.flat[k]` without manually computing row/col from k.
    // Non-enumerable so it doesn't show up in JSON / for..of.
    Object.defineProperty(axesShape, 'flat', {
      value: fig.axes.slice(),
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
  return Object.assign([fig, axesShape], { fig, axes: axesShape });
}

// The chart calls draw on the current axes and return what the axes method returns, as
// matplotlib's do: [line] (`line, = plt.plot(…)`), a mappable, a BarContainer, and
// (n, bins, patches) for hist — also readable as .counts / .edges.
// plot(y), plot(x, y), plot(x, y, fmt, opts) … — Axes.plot sorts the forms out
function plot(...args) { return _ax().plot(...args); }
// scatter(x, y, opts) and matplotlib's positional scatter(x, y, s, c)
function scatter(...args) { return _ax().scatter(...args); }
function imshow(data, nx, ny, opts) { return _ax().imshow(data, nx, ny, opts); }
function bar(x, heights, opts) { return _ax().bar(x, heights, opts); }
function hist(data, opts) { return _ax().hist(data, opts); }
const cmap = getCmap;
// matplotlib's matshow opens a figure of its own and draws the matrix as an image (the
// common df.corr() pattern)
function matshow(data, nx, ny, opts) {
  const { ax } = subplots();
  return ax.imshow(data, nx, ny, opts);
}

// plt.rc(group, **kwargs) — `plt.rc('font', size=14)` — isn't honoured yet; it warns once
// (and a notebook carries on to its real plotting calls).
function rc(_group, _opts) { _noop('rc'); }
// plt.rcParams — a dict-like bag (opts.js). Only 'gcu.strict' is read today: true turns every
// "nothing is silently ignored" warning into an error.

// plt.style.use(name) — switches the shared palette. Auditable-native
// default is dark; `plt.style.use('default')` (or 'classic' / a few
// common matplotlib-style names) flips to a light palette. Notebooks
// loaded from a .ipynb through @gcu/ipynb get this call injected
// automatically after `import matplotlib.pyplot as plt`.
const style = {
  use(name) { setStyle(name); },
  available: ['default', 'classic', 'matplotlib', 'dark_background', 'seaborn', 'seaborn-whitegrid', 'ggplot', 'bmh', 'dark', 'light', 'paper'],
};
// plt.figure(...) — a new figure, and the current one (matplotlib's figure() takes
// figsize=(w,h) and other kwargs; unsupported ones warn).
function figure(opts) {
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
function show() {
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
function flush_figures() {
  const figs = _open.filter((f) => !f._displayed);
  _forget();
  for (const f of figs) {
    const out = f.show();
    if (_cellCtx) _cellCtx.display(out);
  }
  return figs;
}
// close(fig) forgets one figure, close() the current one, close('all') every one
function close(fig) {
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
function shown() { return _shownFigures.slice(); }
function saved() { return _savedFigures.map((s) => ({ ...s })); }

// plt.subplot(nrows, ncols, index) — matplotlib's per-axes shortcut.
// Also accepts the 3-digit form `plt.subplot(311)` (sugar for 3,1,1).
// Returns the indexed axes and sets it as current. Distinct from
// `subplots(nrows, ncols)` which returns the full grid.
function subplot(...args) {
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
const colors = { Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm, ListedColormap, LinearSegmentedColormap };
const cm = {};
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
function gca() { return _ax(); }
function gcf() { if (!_currentFig) subplots(); return _currentFig; }
function xlabel(text, opts) { _ax().set_xlabel(text, opts); }
function ylabel(text, opts) { _ax().set_ylabel(text, opts); }
function title(text, opts) { _ax().set_title(text, opts); }
function xlim(lo, hi) { _ax().set_xlim(lo, hi); }
function ylim(lo, hi) { _ax().set_ylim(lo, hi); }
function xscale(scale) { _ax().set_xscale(scale); }
function yscale(scale) { _ax().set_yscale(scale); }
function legend(opts) { _ax().legend(opts); }
function grid(on, opts) { _ax().grid(on, opts); }
function vlines(x, ymin, ymax, opts) { _ax().vlines(x, ymin, ymax, opts); }
function hlines(y, xmin, xmax, opts) { _ax().hlines(y, xmin, xmax, opts); }
function axhline(y, opts) { _ax().axhline(y, opts); }
function axvline(x, opts) { _ax().axvline(x, opts); }
function text(x, y, s, opts) { _ax().text(x, y, s, opts); }
// subplots_adjust isn't honoured yet (it warns); tight_layout is a true no-op: layout is always tight
function subplots_adjust(_opts) { _noop('subplots_adjust'); }
function tight_layout(_opts) { /* layout is always tight */ }
function savefig(filename) { return _currentFig && _currentFig.savefig(filename); }
function clf() { _forget(); _shownFigures.length = 0; _savedFigures.length = 0; }
function cla() { _currentAx = null; }

// plt.xticks(ticks, labels) / yticks — custom ticks aren't supported yet; they warn once and
// the axes keep their automatic ticks.
// plt.xticks(ticks?, labels?, {rotation}) — sets them; with no ticks, returns [locs, labels]
function xticks(ticks, labels, opts) { return _pyTicks('x', ticks, labels, opts); }
function yticks(ticks, labels, opts) { return _pyTicks('y', ticks, labels, opts); }
function _pyTicks(axis, ticks, labels, opts) {
  const ax = _ax();
  if (ticks && typeof ticks === 'object' && !Array.isArray(ticks) && !ArrayBuffer.isView(ticks)) { opts = ticks; ticks = opts.ticks; labels = opts.labels; }
  if (labels && typeof labels === 'object' && !Array.isArray(labels) && !ArrayBuffer.isView(labels)) { opts = labels; labels = opts.labels; }
  if (ticks != null) ax[axis === 'x' ? 'set_xticks' : 'set_yticks'](ticks, labels, opts);
  else if (opts && opts.rotation != null) ax.tick_params({ axis, labelrotation: opts.rotation });
  return [ax[axis === 'x' ? 'get_xticks' : 'get_yticks'](), ax[axis === 'x' ? 'get_xticklabels' : 'get_yticklabels']()];
}
function axis(arg) { return _ax().axis(arg); }
// the marks, on the current axes (matplotlib's pyplot state)
function barh(y, width, opts) { return _ax().barh(y, width, opts); }
function bar_label(container, labels, opts) { return _ax().bar_label(container, labels, opts); }
function errorbar(x, y, opts) { return _ax().errorbar(x, y, opts); }
function fill_between(x, y1, y2, opts) { return _ax().fill_between(x, y1, y2, opts); }
function fill_betweenx(y, x1, x2, opts) { return _ax().fill_betweenx(y, x1, x2, opts); }
function step(x, y, fmt, opts) { return _ax().step(x, y, fmt, opts); }
function axhspan(ymin, ymax, opts) { return _ax().axhspan(ymin, ymax, opts); }
function axvspan(xmin, xmax, opts) { return _ax().axvspan(xmin, xmax, opts); }
function annotate(text, xy, opts) { return _ax().annotate(text, xy, opts); }
function boxplot(x, opts) { return _ax().boxplot(x, opts); }
function contour(...args) { return _ax().contour(...args); }
function contourf(...args) { return _ax().contourf(...args); }
function pcolormesh(...args) { return _ax().pcolormesh(...args); }
// plan views: polygons, GeoJSON, the map furniture (geo.js)
function fill(...args) { return _ax().fill(...args); }
function add_geometry(geom, opts) { return _ax().add_geometry(geom, opts); }

// tier 2: distributions, stacks, ticks (dist.js, marks.js, ticker.js)
function violinplot(dataset, opts) { return _ax().violinplot(dataset, opts); }
function hexbin(x, y, opts) { return _ax().hexbin(x, y, opts); }
function hist2d(x, y, opts) { return _ax().hist2d(x, y, opts); }
function stackplot(x, ...args) { return _ax().stackplot(x, ...args); }
function minorticks_on() { _ax().minorticks_on(); }
function minorticks_off() { _ax().minorticks_off(); }
function tick_params(opts) { _ax().tick_params(opts); }
// matplotlib.ticker and matplotlib.dates, as plt.ticker / plt.dates

function margins(x, y) { return _ax().margins(x, y); }

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
function colorbar(mappable, opts) {
  if (mappable && typeof mappable === 'object' && !mappable._trace && !mappable.axes && !Array.isArray(mappable) && opts == null) { opts = mappable; mappable = null; }
  const o = opts && typeof opts === 'object' ? opts : {};
  const ax = o.ax || (mappable && mappable.axes) || (mappable && typeof mappable.colorbar === 'function' ? mappable : null) || _ax();
  const rest = { ...o }; delete rest.ax;
  return mappable && mappable._trace ? ax.colorbar(mappable, rest) : ax.colorbar(rest);
}
// plt.suptitle — sets the figure-level title above all subplots.
// Delegates to the current figure's suptitle method.
function suptitle(text, opts) {
  const fig = gcf();
  return fig && fig.suptitle ? fig.suptitle(text, opts) : null;
}

// The matplotlib-shaped module object, built in every host: a worker or Node registers it
// with adder (registerModule('plt', pltAdder)); the notebook gets it below.
const pltAdder = {
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
};

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

export { VERSION, subplots, plot, scatter, imshow, bar, hist, cmap, matshow, rc, style, figure, show, flush_figures, close, shown, saved, subplot, colors, cm, gca, gcf, xlabel, ylabel, title, xlim, ylim, xscale, yscale, legend, grid, vlines, hlines, axhline, axvline, text, subplots_adjust, tight_layout, savefig, clf, cla, xticks, yticks, axis, barh, bar_label, errorbar, fill_between, fill_betweenx, step, axhspan, axvspan, annotate, boxplot, contour, contourf, pcolormesh, fill, add_geometry, violinplot, hexbin, hist2d, stackplot, minorticks_on, minorticks_off, tick_params, margins, colorbar, suptitle, pltAdder, rcParams, Polygon, Rectangle, Circle, ScalarMappable, ticker, dates, Figure, Axes, LinearScale, LogScale, getCmap, replay, recordingContext, themeFromCSS, resolveTheme, Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm, ListedColormap, LinearSegmentedColormap, toSVG, encodePNG, interact, link };
