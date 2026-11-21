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
  plot: [..._ARTIST, 'linestyle', 'linewidth', 'marker', 'markersize', 'markerfacecolor', 'markeredgecolor', 'markeredgewidth', 'fmt'],
  scatter: [..._ARTIST, 'c', 's', 'cmap', 'vmin', 'vmax', 'marker', 'edgecolor', 'linewidth', 'plotnonfinite'],
  bar: [..._ARTIST, 'width', 'edgecolor', 'linewidth'],
  barh: [..._ARTIST, 'height', 'edgecolor', 'linewidth'],
  hist: [..._ARTIST, 'bins', 'range', 'weights', 'density', 'cumulative', 'edgecolor', 'linewidth'],
  imshow: ['label', 'alpha', 'zorder', 'cmap', 'vmin', 'vmax', 'origin', 'nodata', 'extent', 'interpolation', 'aspect'],
  axhline: [..._ARTIST, 'linestyle', 'linewidth'],
  axvline: [..._ARTIST, 'linestyle', 'linewidth'],
  hlines: [..._ARTIST, 'colors', 'linestyle', 'linewidth'],
  vlines: [..._ARTIST, 'colors', 'linestyle', 'linewidth'],
  text: ['color', 'alpha', 'zorder', 'fontsize', 'ha', 'va', 'horizontalalignment', 'verticalalignment', 'transform', 'rotation', 'fontweight'],
  legend: ['loc'],
  colorbar: ['label', 'ax'],
  grid: ['color', 'alpha', 'linestyle', 'linewidth', 'which', 'axis'],
  subplots: ['figsize', 'dpi', 'facecolor', 'gap', 'wspace', 'hspace', 'strict', 'theme', 'sharex', 'sharey'],
  label: ['fontsize', 'color', 'loc', 'pad', 'fontweight'],
};

// known, not done yet: the hint says what to do instead
const _UNSUPPORTED = {
  plot: { drawstyle: "not supported yet — use step() when it lands, or repeat the points", dashes: "use linestyle ('--', '-.', ':')" },
  scatter: { norm: 'not supported yet — use vmin / vmax' },
  bar: { bottom: 'stacked bars are not supported yet', align: "bars are centred on x (align='center')", tick_label: 'not supported yet' },
  barh: { left: 'stacked bars are not supported yet', align: "bars are centred on y (align='center')" },
  hist: { histtype: "only histtype='bar' for now", orientation: 'only vertical histograms for now', stacked: 'not supported yet', log: "use ax.set_yscale('log')", bottom: 'not supported yet', align: 'not supported yet', rwidth: 'not supported yet' },
  imshow: { norm: 'not supported yet — use vmin / vmax' },
  axhline: { xmin: 'not supported yet — use hlines(y, x0, x1)', xmax: 'not supported yet — use hlines(y, x0, x1)' },
  axvline: { ymin: 'not supported yet — use vlines(x, y0, y1)', ymax: 'not supported yet — use vlines(x, y0, y1)' },
  text: { bbox: 'not supported yet' },
  legend: { bbox_to_anchor: 'not supported yet — use loc', ncol: 'not supported yet', title: 'not supported yet', fontsize: 'not supported yet', frameon: 'not supported yet', framealpha: 'not supported yet' },
  colorbar: { shrink: 'not supported yet', orientation: 'only vertical colorbars for now', ticks: 'not supported yet', extend: 'not supported yet', fraction: 'not supported yet', pad: 'not supported yet' },
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

// -- ticks.js --

// Ticks and their labels, sized to the axis's PIXEL length and measured, so labels never overlap and margins can be measured from them.
//
// An axis's ticks come from, in order:
//   1. set_xticks(values, labels?, {rotation}) — exactly those (a label list may be shorter);
//   2. a category axis (strings given as x or y) — one tick per category, labelled;
//   3. the scale — about one tick per 70 px on x, per 38 px on y.
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
  if (custom && custom.values) {
    values = Array.from(custom.values, Number);
    labels = custom.labels ? values.map((_, i) => (custom.labels[i] != null ? String(custom.labels[i]) : '')) : _fmtTicks(scale, values);
  } else if (cats && cats.list.length) {
    values = cats.list.map((_, i) => i);
    labels = cats.list.slice();
  } else {
    const per = axis === 'x' ? 55 : 32;
    let count = Math.max(2, Math.min(12, Math.floor(len / per) + 1));
    for (;;) {
      values = scale.log ? scale.ticks() : _niceTicks(lo, hi, count);
      labels = scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (hi - lo));
      if (axis === 'y' || count <= 2 || scale.log) break;
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
  return { values, labels, rot, extent, maxW, widths };
}

// draw one axis's ticks and labels. side: 'bottom' | 'top' | 'left' | 'right'
function _drawTicks(ctx, spec, scale, side, plot, color, tickColor, font) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 1;
  const { values, labels, rot } = spec;
  for (let i = 0; i < values.length; i++) {
    const p = scale.transform(values[i]);
    ctx.beginPath();
    if (side === 'bottom') { ctx.moveTo(p, plot.y + plot.h); ctx.lineTo(p, plot.y + plot.h + 4); }
    else if (side === 'top') { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y - 4); }
    else if (side === 'left') { ctx.moveTo(plot.x - 4, p); ctx.lineTo(plot.x, p); }
    else { ctx.moveTo(plot.x + plot.w, p); ctx.lineTo(plot.x + plot.w + 4, p); }
    ctx.stroke();
    const s = labels[i];
    if (!s) continue;
    if (side === 'bottom' || side === 'top') {
      const y = side === 'bottom' ? plot.y + plot.h + 6 : plot.y - 6;
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
      ctx.fillText(s, side === 'left' ? plot.x - 6 : plot.x + plot.w + 6, p);
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

function getCmap(name) {
  if (typeof name === 'function') return name;
  // an array of colors is a categorical map (matplotlib's ListedColormap):
  // [0,1) splits into equal buckets, one color each
  if (Array.isArray(name)) {
    const n = name.length;
    const f = (t) => (t !== t ? _NO_COLOR : name[Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, Math.min(1, t)) * n)))]);
    f._listed = name;
    return f;
  }
  return _cmaps[name] || _cmaps.viridis;
}

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

// -- format.js --

// Format string parser: 'r--o' → { color, linestyle, marker }
//
// matplotlib's fmt is '[marker][line][color]' in ANY order ('o-', 'ro', '--r', 'k.' are all
// valid), and a format with a marker but no line style draws MARKERS ONLY: plot(x, y, 'o') is
// a scatter of dots, not a line through them. Both rules are what a model writing matplotlib
// from memory expects.


// plot's own softened single-letter colours (kept from 0.1: changing them would repaint every
// existing figure); colour NAMES like color='r' get matplotlib's exact ones (color.js)
const _colorChars = { b: '#4488ff', g: '#44bb44', r: '#ee4444', c: '#44dddd', m: '#dd44dd', y: '#dddd44', k: '#000000', w: '#ffffff' };
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
//               | { lut: Uint8ClampedArray (256 × 4), vals, vmin, vk }   colour-mapped: entry
//                 ((v - vmin) · vk) clamped to 0–255; a NaN value draws nothing
//               | { bytes: Uint8ClampedArray (n × 4) }
//   alpha       0–1, applied on top of each colour's own alpha
//   edge        null | { bytes: [r,g,b,a] | 'face', width (device px) }
function _rasterPoints(W, H, X, Y, ox, oy, k, rad, marker, colors, alpha, edge) {
  const buf = new Uint8Array(W * H * 4);              // premultiplied while drawing
  const b32 = new Uint32Array(buf.buffer);
  const n = X.length;
  const uni = colors.uniform, lut = colors.lut, vals = colors.vals, vmin = colors.vmin, vk = colors.vk, bytes = colors.bytes;
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
      const v = vals[p];
      if (v !== v) continue;
      let q = ((v - vmin) * vk) | 0;
      q = (q < 0 ? 0 : q > 255 ? 255 : q) << 2;
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
    this._traces.push({ type: 'line', x: X, y: Y, opts: o });
    return this;
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
    return this;
  }

  bar(x, heights, opts) {
    const o = this._opts('bar', opts);
    if (!o.color) o.color = this._nextColor();
    const X = this._axisCol('x', x), H = _col(heights);
    if (X.length !== H.length) throw _lenErr('bar', 'x', X.length, 'height', H.length);
    if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
    this._traces.push({ type: 'bar', x: X, heights: H, opts: o });
    return this;
  }

  barh(y, widths, opts) {
    const o = this._opts('barh', opts);
    if (!o.color) o.color = this._nextColor();
    const Yc = this._axisCol('y', y), W = _col(widths);
    if (Yc.length !== W.length) throw _lenErr('barh', 'y', Yc.length, 'width', W.length);
    if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
    this._traces.push({ type: 'barh', y: Yc, widths: W, opts: o });
    return this;
  }

  hist(data, opts) {
    const o = this._opts('hist', opts);
    if (!o.color) o.color = this._nextColor();
    // several datasets (a list of arrays) aren't drawn side by side yet: say so, draw the first
    if (Array.isArray(data) && data.length && _isArrayLike(data[0])) {
      _warn('hist.multi', 'hist(): several datasets are not supported yet; drawing the first', this._strict);
      data = data[0];
    }
    const D = _col(data);
    if (o.bins != null && typeof o.bins !== 'number') {
      if (typeof o.bins === 'string') {
        _warn('hist.bins.' + o.bins, `hist(): bins='${o.bins}' is not supported yet; using 10 bins`, this._strict);
        o.bins = 10;
      } else o.bins = _col(o.bins);
    }
    if (o.weights != null) {
      o.weights = _col(o.weights);
      if (o.weights.length !== D.length) throw _lenErr('hist', 'weights', o.weights.length, 'x', D.length);
    }
    this._traces.push({ type: 'hist', data: D, opts: o });
    return this;
  }

  // matshow — render a 2D matrix as a heatmap. Accepts diverse inputs:
  // a sadpan DataFrame (uses .to_numpy()), a natra ndarray, a
  // Float64Array with .shape, a nested JS array, or already-flat data
  // with shape. Extracts flat data + nx + ny + passes through to imshow.
  matshow(data, opts) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    let flat, nx, ny;
    // sadpan DataFrame
    if (data && data._tbl && typeof data.to_numpy === 'function') {
      const arr2d = data.to_numpy();
      ny = arr2d.shape[0];
      nx = arr2d.shape[1];
      flat = arr2d.data instanceof Float64Array ? arr2d.data : Float64Array.from([].concat(...arr2d.tolist()));
    } else if (data instanceof Float64Array && Array.isArray(data.shape) && data.shape.length === 2) {
      ny = data.shape[0]; nx = data.shape[1]; flat = data;
    } else if (data && data.data instanceof Float64Array && Array.isArray(data.shape) && data.shape.length === 2) {
      ny = data.shape[0]; nx = data.shape[1]; flat = data.data;
    } else if (data && data._nd && data._arr && data._arr.ndim === 2) {
      const a = data._arr;
      ny = a.shape[0]; nx = a.shape[1];
      flat = new Float64Array(a.memory.buffer, a.ptr, ny * nx).slice();
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      ny = data.length;
      nx = data[0].length;
      flat = new Float64Array(ny * nx);
      for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) flat[i * nx + j] = data[i][j] == null ? NaN : data[i][j];
    } else {
      // Fall back to imshow as-is and let it complain.
      return this.imshow(data, undefined, undefined, opts);
    }
    // matshow defaults to 'upper' origin (row 0 at top) — opposite of
    // imshow's default. honor unless caller explicitly set otherwise.
    if (!o.origin) o.origin = 'upper';
    // Aspect equal so cells render as squares.
    if (this._aspect === 'auto') this._aspect = 'equal';
    return this.imshow(flat, nx, ny, o);
  }

  // imshow(data, nx, ny, opts): a flat row-major grid of nx × ny values
  imshow(data, nx, ny, opts) {
    if (typeof nx !== 'number' || typeof ny !== 'number') {
      throw new Error('plot: imshow: give the grid size, imshow(data, nx, ny, opts), with data flat and row-major; for a 2D array use matshow(Z)');
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
    this._traces.push({ type: 'imshow', data: D, nx, ny, opts: o });
    // default to equal aspect for grid data (matches matplotlib)
    if (this._aspect === 'auto') this._aspect = 'equal';
    return this;
  }

  axhline(y, opts) {
    const o = this._opts('axhline', opts);
    if (o.linewidth == null) o.linewidth = 1;
    this._traces.push({ type: 'hline', y, opts: o });
    return this;
  }

  axvline(x, opts) {
    const o = this._opts('axvline', opts);
    if (o.linewidth == null) o.linewidth = 1;
    this._traces.push({ type: 'vline', x, opts: o });
    return this;
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
    const o = this._opts('text', opts);
    if (o.horizontalalignment && !o.ha) o.ha = o.horizontalalignment;
    if (o.verticalalignment && !o.va) o.va = o.verticalalignment;
    this._traces.push({ type: 'text', x, y, text, opts: o });
    return this;
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
  tick_params(opts) {
    const o = _plainOpts(opts) ? opts : {};
    const which = o.axis || 'both';
    if (o.labelrotation != null) for (const a of (which === 'both' ? ['x', 'y'] : [which])) {
      const key = a === 'x' ? '_xticks' : '_yticks';
      this[key] = { ...(this[key] || { values: null, labels: null }), rotation: o.labelrotation };
    }
    for (const k of Object.keys(o)) if (k !== 'axis' && k !== 'labelrotation' && k !== '_kw') _warn('tick_params.' + k, `tick_params(): '${k}' is not supported yet (only axis and labelrotation)`, this._strict);
    return this;
  }
  // every axes that shares this one's `axis` (subplots(sharex / sharey)), this one included
  _group(axis) { return this._shared[axis] || [this]; }
  // a column for `axis`: numbers, or labels that make (or extend) that axis's categories
  _axisCol(axis, arr) {
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
    t._ylim = this._ylim;
    this._twinY = t;
    return t;
  }

  legend(opts) { this._legend = true; this._legendOpts = _checkOpts('legend', _plainOpts(opts) ? opts : {}, this._strict); return this; }

  colorbar(opts) { this._colorbar = true; this._colorbarOpts = _checkOpts('colorbar', _plainOpts(opts) ? opts : {}, this._strict); return this; }

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
      const which = g.axis || 'both';
      if (which !== 'y') for (const v of xt.values) {
        const px = xScale.transform(v);
        ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
      }
      if (which !== 'x') for (const v of yt.values) {
        const py = yScale.transform(v);
        ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // own traces (clipped to the plot area), then the twins' (with their own axis)
    const lastCmapTrace = this._renderTraces(ctx, xScale, yScale, plotX, plotY, plotW, plotH, dpr);
    if (this._twin) this._twin._renderAsTwin(ctx, xScale, plotX, plotY, plotW, plotH, dpr, L.twinYt);
    if (this._twinY) this._twinY._renderAsTwinY(ctx, yScale, plotX, plotY, plotW, plotH, dpr, L.twinXt);

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
    if (cb && lastCmapTrace) {
      const cbX = rect.x + rect.w - m.right + 10;
      const { vmin, vmax } = this._cmapRange(lastCmapTrace);
      if (vmin - vmin === 0 && vmax - vmax === 0) {
        renderColorbar(ctx, cbX, fullPlotY, 12, fullPlotH, lastCmapTrace.opts.cmap || th.ramp || 'viridis', vmin, vmax, {
          textColor, font: fTick, label: this._colorbarOpts.label, labelFont: fLab, labelOffset: 12 + 6 + cb.labelsW + 6,
        });
      }
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
  _colorbarInfo(ctx, fTick) {
    let tr = null;
    for (const t of this._traces) if (t.type === 'imshow' || t.cvals || (_KINDS[t.type] && _KINDS[t.type].cmap && t.cmapped !== false)) tr = t;
    if (!tr) return null;
    const { vmin, vmax } = this._cmapRange(tr);
    if (!(vmin - vmin === 0 && vmax - vmax === 0)) return null;
    ctx.font = fTick;
    const sc = new LinearScale([Math.min(vmin, vmax), Math.max(vmin, vmax)], [0, 1]);
    let w = 0;
    for (const v of [vmin, vmax, ...sc.ticks(5)]) w = Math.max(w, _textW(fTick, sc.tickFormat()(v)));
    return { labelsW: w };
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

  // vmin / vmax of a colour-mapped trace: the options, or the finite data range
  _cmapRange(trace) {
    let vmin = trace.opts.vmin, vmax = trace.opts.vmax;
    if (vmin == null || vmax == null) {
      const r = trace.type === 'imshow' ? this._imshowRange(trace) : _traceRange(trace, 'c', trace.cvals);
      if (vmin == null) vmin = r.lo;
      if (vmax == null) vmax = r.hi;
    }
    return { vmin, vmax };
  }

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
    for (const [, ti] of order) {
      const trace = this._traces[ti];
      switch (trace.type) {
        case 'imshow': this._renderImshow(ctx, trace, xScale, yScale, rect); lastCmapTrace = trace; break;
        case 'line': this._renderLine(ctx, trace, xScale, yScale, rect); break;
        case 'scatter': this._renderScatter(ctx, trace, xScale, yScale, rect); if (trace.cvals) lastCmapTrace = trace; break;
        case 'bar': this._renderBar(ctx, trace, xScale, yScale); break;
        case 'barh': this._renderBarh(ctx, trace, xScale, yScale); break;
        case 'hist': this._renderHist(ctx, trace, xScale, yScale); break;
        case 'hline': this._renderHline(ctx, trace, xScale, yScale, plotX, plotW); break;
        case 'vline': this._renderVline(ctx, trace, xScale, yScale, plotY, plotH); break;
        case 'text': this._renderText(ctx, trace, xScale, yScale, rect); break;
        default: {
          const k = _KINDS[trace.type];
          if (k) { k.render(this, ctx, trace, xScale, yScale, rect); if (k.cmap && trace.cmapped !== false) lastCmapTrace = trace; }
        }
      }
    }
    ctx.restore();
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
        case 'bar': {
          if (axis === 'x') {
            const r = _traceRange(trace, 'x', trace.x), w = typeof trace.opts.width === 'number' ? trace.opts.width : 0.8;
            if (r.n) { take(r.lo - w / 2); take(r.hi + w / 2); }
          } else {
            if (!log) { take(0); stick(0); }
            takeRange(_traceRange(trace, 'h', trace.heights, log));
          }
          break;
        }
        case 'barh': {
          if (axis === 'y') {
            const r = _traceRange(trace, 'y', trace.y), h = typeof trace.opts.height === 'number' ? trace.opts.height : 0.8;
            if (r.n) { take(r.lo - h / 2); take(r.hi + h / 2); }
          } else {
            if (!log) { take(0); stick(0); }
            takeRange(_traceRange(trace, 'w', trace.widths, log));
          }
          break;
        }
        case 'hist': {
          const { edges, counts } = this._hist(trace);
          if (axis === 'x') { take(edges[0]); take(edges[edges.length - 1]); }
          else { if (!log) { take(0); stick(0); } for (const c of counts) take(c); }
          break;
        }
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
      const { vmin, vmax } = this._cmapRange(trace);
      spec.cmap = { name: o.cmap || 'viridis', vmin, vmax };
    } else if (trace.colors) spec.list = trace.colors;
    else spec.uniform = o.color;
    this._drawPoints(ctx, trace, pos, rect, spec);
  }

  // colour-map indices for a trace (0–255, -1 for NaN), cached on (cmap, vmin, vmax)
  _cmapIdx(trace, vmin, vmax) {
    const c = trace._cache || (trace._cache = {});
    const key = `${vmin}|${vmax}`;
    if (c.cidx && c.cidx.key === key) return c.cidx.idx;
    const v = trace.cvals, n = v.length, idx = new Int16Array(n);
    const k = vmax !== vmin ? 256 / (vmax - vmin) : 0;
    for (let i = 0; i < n; i++) {
      const val = v[i];
      if (val !== val) { idx[i] = -1; continue; }
      let q = k ? ((val - vmin) * k) | 0 : 128;
      idx[i] = q < 0 ? 0 : q > 255 ? 255 : q;
    }
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
    if (spec.cmap) idx = this._cmapIdx(trace, spec.cmap.vmin, spec.cmap.vmax);
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
    const key = `${pos.key}|${W}x${H}|${dpr}|${spec.cmap ? spec.cmap.vmin + ',' + spec.cmap.vmax + ',' + spec.cmap.name : ''}|${spec.alpha}`;
    let h = c[holderKey];
    if (!h || h.key !== key) {
      const n = pos.X.length;
      let rad;
      if (typeof spec.radius === 'number') rad = spec.radius * dpr;
      else { rad = new Float32Array(n); for (let i = 0; i < n; i++) rad[i] = Math.sqrt(spec.radius[i]) * spec.rk * dpr; }
      let colors;
      if (col.lut) {
        // the same LUT entry _cmapIdx gives: ((v - vmin) · 256 / (vmax - vmin)), and the
        // middle entry when vmin = vmax
        const { vmin, vmax } = spec.cmap;
        colors = vmax !== vmin ? { lut: col.lut, vals: trace.cvals, vmin, vk: 256 / (vmax - vmin) } : { lut: col.lut, vals: trace.cvals, vmin: vmin - 0.5, vk: 256 };
      } else colors = col.bytes ? { bytes: col.bytes } : { uniform: col.uni };
      const edge = spec.edge ? { bytes: spec.edge.color === 'face' ? 'face' : _colorBytes(spec.edge.color), width: spec.edge.width * dpr } : null;
      const rgba = _rasterPoints(W, H, pos.X, pos.Y, rect.x, rect.y, dpr, rad, spec.marker, colors, spec.alpha, edge);
      h = c[holderKey] = { key, rgba, W, H };
    }
    return _blit(ctx, rect.x, rect.y, rect.w, rect.h, h.W, h.H, h.rgba, h, false);
  }

  _renderBar(ctx, trace, xScale, yScale) {
    const { x, heights, opts } = trace;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    ctx.globalAlpha = alpha;
    const py0 = yScale.transform(0);
    for (let i = 0; i < x.length; i++) {
      const bw = _isArrayLike(opts.width) ? opts.width[i] : (opts.width || 0.8);
      const xv = x[i], hv = heights[i];
      if (xv - xv !== 0 || hv - hv !== 0) continue;
      const px = xScale.transform(xv - bw / 2);
      const pw = xScale.transform(xv + bw / 2) - px;
      const py = yScale.transform(hv);
      ctx.fillStyle = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color;
      ctx.fillRect(px, py, pw, py0 - py);
      if (opts.edgecolor) {
        ctx.strokeStyle = _cssColor(opts.edgecolor);
        ctx.lineWidth = opts.linewidth || 1;
        ctx.strokeRect(px, py, pw, py0 - py);
      }
    }
    ctx.globalAlpha = 1;
  }

  _renderBarh(ctx, trace, xScale, yScale) {
    const { y, widths, opts } = trace;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    ctx.globalAlpha = alpha;
    const px0 = xScale.transform(0);
    for (let i = 0; i < y.length; i++) {
      const bh = _isArrayLike(opts.height) ? opts.height[i] : (opts.height || 0.8);
      const yv = y[i], wv = widths[i];
      if (yv - yv !== 0 || wv - wv !== 0) continue;
      const py = yScale.transform(yv + bh / 2);
      const ph = yScale.transform(yv - bh / 2) - py;
      const px = xScale.transform(wv);
      ctx.fillStyle = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color;
      ctx.fillRect(px0, py, px - px0, ph);
      if (opts.edgecolor) {
        ctx.strokeStyle = _cssColor(opts.edgecolor);
        ctx.lineWidth = opts.linewidth || 1;
        ctx.strokeRect(px0, py, px - px0, ph);
      }
    }
    ctx.globalAlpha = 1;
  }

  _renderHist(ctx, trace, xScale, yScale) {
    const { edges, counts } = this._hist(trace);
    const alpha = trace.opts.alpha != null ? trace.opts.alpha : 0.8;
    ctx.fillStyle = trace.opts.color;
    ctx.globalAlpha = alpha;
    const py0 = yScale.transform(yScale.log ? yScale.domain[0] : 0);
    for (let i = 0; i < counts.length; i++) {
      if (!(counts[i] > 0) && yScale.log) continue;
      const px0 = xScale.transform(edges[i]);
      const px1 = xScale.transform(edges[i + 1]);
      const py = yScale.transform(counts[i]);
      ctx.fillRect(px0, py, px1 - px0, py0 - py);
      if (trace.opts.edgecolor) {
        ctx.strokeStyle = _cssColor(trace.opts.edgecolor);
        ctx.lineWidth = trace.opts.linewidth || 1;
        ctx.strokeRect(px0, py, px1 - px0, py0 - py);
      }
    }
    ctx.globalAlpha = 1;
  }

  // An image is ONE RGBA buffer (built with the colour map's LUT, cached on the trace until
  // vmin / vmax / cmap / origin change), blitted into its extent: one drawImage live, one
  // 'image' op recorded. NaN and nodata cells are transparent.
  _renderImshow(ctx, trace, xScale, yScale) {
    const { data, nx, ny, opts } = trace;
    const nodata = opts.nodata;
    const origin = opts.origin || 'lower';
    const cmapName = opts.cmap || 'viridis';
    const { vmin, vmax } = this._cmapRange(trace);
    const c = trace._cache || (trace._cache = {});
    const key = `${vmin}|${vmax}|${origin}|${nodata}`;
    let img = c.img;
    if (!img || img.key !== key || img.cmap !== cmapName) {
      const rgba = new Uint8ClampedArray(nx * ny * 4);
      const lut = _cmapLut(cmapName), fn = lut ? null : getCmap(cmapName);
      const vr = vmax - vmin, k = vr ? 256 / vr : 0;
      for (let iy = 0; iy < ny; iy++) {
        // image row 0 is the TOP: origin='lower' puts data row ny-1 there
        const row = origin === 'lower' ? ny - 1 - iy : iy;
        for (let ix = 0; ix < nx; ix++) {
          const v = data[iy * nx + ix];
          if (v - v !== 0 || (nodata != null && v === nodata)) continue;   // transparent
          const o = (row * nx + ix) * 4;
          if (lut) {
            let q = k ? ((v - vmin) * k) | 0 : 128;
            q = (q < 0 ? 0 : q > 255 ? 255 : q) * 4;
            rgba[o] = lut[q]; rgba[o + 1] = lut[q + 1]; rgba[o + 2] = lut[q + 2]; rgba[o + 3] = lut[q + 3];
          } else {
            const b = _colorBytes(fn(vr ? (v - vmin) / vr : 0.5));
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

  _renderHline(ctx, trace, xScale, yScale, plotX, plotW) {
    const py = yScale.transform(trace.y);
    if (py - py !== 0) return;
    ctx.globalAlpha = trace.opts.alpha != null ? trace.opts.alpha : 1;
    ctx.strokeStyle = trace.opts.color || this._theme.muted;
    ctx.lineWidth = trace.opts.linewidth || 1;
    ctx.setLineDash(dashArray(trace.opts.linestyle));
    ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _renderVline(ctx, trace, xScale, yScale, plotY, plotH) {
    const px = xScale.transform(trace.x);
    if (px - px !== 0) return;
    ctx.globalAlpha = trace.opts.alpha != null ? trace.opts.alpha : 1;
    ctx.strokeStyle = trace.opts.color || this._theme.muted;
    ctx.lineWidth = trace.opts.linewidth || 1;
    ctx.setLineDash(dashArray(trace.opts.linestyle));
    ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
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

  _renderLegend(ctx, plotX, plotY, plotW, plotH) {
    const th = this._theme;
    const entries = [];
    for (const t of this._traces) {
      if (!t.opts.label) continue;
      let color = t.opts.color;
      if (!color && t.cvals) color = getCmap(t.opts.cmap || 'viridis')(0.5);
      if (!color && t.colors) color = t.colors[0];
      entries.push({ label: String(t.opts.label), color: color || th.cycle[0], type: t.type, marker: t.opts.marker, noLine: _noLine(t.opts.linestyle) });
    }
    if (!entries.length) return;

    ctx.font = _font(th, -1);
    const lineH = (th.font_size || 11) + 4;
    const padding = 6;
    let maxW = 0;
    for (const e of entries) {
      const w = _textW(ctx.font, e.label);
      if (w > maxW) maxW = w;
    }
    const boxW = maxW + 24 + padding * 2;
    const boxH = entries.length * lineH + padding * 2;

    // position: default top-right. matplotlib's numeric codes map to the names; 'best'
    // (code 0) is upper right until placement that avoids the data lands.
    const _LOC = ['upper right', 'upper right', 'upper left', 'lower left', 'lower right', 'right', 'center left', 'center right', 'lower center', 'upper center', 'center'];
    let loc = this._legendOpts.loc ?? 'upper right';
    if (typeof loc === 'number') loc = _LOC[loc] || 'upper right';
    loc = String(loc);
    if (loc === 'best') loc = 'upper right';
    let lx, ly;
    if (loc.includes('right')) lx = plotX + plotW - boxW - 6;
    else if (loc.includes('left')) lx = plotX + 6;
    else lx = plotX + (plotW - boxW) / 2;
    if (loc.includes('upper') || loc.includes('top')) ly = plotY + 6;
    else if (loc.includes('lower') || loc.includes('bottom')) ly = plotY + plotH - boxH - 6;
    else ly = plotY + (plotH - boxH) / 2;

    ctx.fillStyle = th.panel;
    ctx.fillRect(lx, ly, boxW, boxH);
    ctx.strokeStyle = th.panel_border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly, boxW, boxH);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ey = ly + padding + i * lineH + lineH / 2;
      ctx.fillStyle = e.color;
      if (e.type === 'scatter' || (e.type === 'line' && e.marker && e.noLine)) {
        ctx.beginPath(); _pathMarker(ctx, _markerShape(e.marker || 'o', 3), lx + padding + 7, ey);
        if (e.marker === '+' || e.marker === 'x') { ctx.strokeStyle = e.color; ctx.lineWidth = 1.5; ctx.stroke(); } else ctx.fill();
      } else {
        ctx.fillRect(lx + padding, ey - 1, 14, 2);
      }
      ctx.fillStyle = this._textColor || th.foreground;
      ctx.fillText(e.label, lx + padding + 18, ey);
    }
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
    // bars and histogram bins, by column (the last drawn wins: it is on top)
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      if (px < v.x || px > v.x + v.w || py < v.y || py > v.y + v.h) continue;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti];
        if (t.type === 'bar') {
          for (let i = t.x.length - 1; i >= 0; i--) {
            const bw = _isArrayLike(t.opts.width) ? t.opts.width[i] : (t.opts.width || 0.8);
            const a = v.xScale.transform(t.x[i] - bw / 2), b = v.xScale.transform(t.x[i] + bw / 2);
            if (px >= Math.min(a, b) && px <= Math.max(a, b)) return { axes: ax, trace: t, traceIndex: ti, kind: 'bar', index: i, x: t.x[i], y: t.heights[i], c: null, s: null, label: t.opts.label ?? null };
          }
        } else if (t.type === 'barh') {
          for (let i = t.y.length - 1; i >= 0; i--) {
            const bh = _isArrayLike(t.opts.height) ? t.opts.height[i] : (t.opts.height || 0.8);
            const a = v.yScale.transform(t.y[i] - bh / 2), b = v.yScale.transform(t.y[i] + bh / 2);
            if (py >= Math.min(a, b) && py <= Math.max(a, b)) return { axes: ax, trace: t, traceIndex: ti, kind: 'bar', index: i, x: t.widths[i], y: t.y[i], c: null, s: null, label: t.opts.label ?? null };
          }
        } else if (t.type === 'hist') {
          const { edges, counts } = ax._hist(t);
          const xv = v.xScale.inverse(px);
          for (let i = 0; i < counts.length; i++) {
            if (xv >= edges[i] && xv <= edges[i + 1]) return { axes: ax, trace: t, traceIndex: ti, kind: 'bin', index: i, x: (edges[i] + edges[i + 1]) / 2, y: counts[i], edges: [edges[i], edges[i + 1]], c: null, s: null, label: t.opts.label ?? null };
          }
        }
      }
    }
    // image cells
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti];
        if (t.type !== 'imshow') continue;
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

// -- figure.js --

// Figure — canvas management, subplot grid, DPI handling





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

// -- api.js --

// Public API — subplots() factory, quick one-liners, plt extension registration






// one version string, read by the extension registration below (package.json carries the same)
const VERSION = '0.2.0';

// matplotlib stateful interface — plt.xlabel/.ylim/.legend/etc. all
// operate on a global "current axes". subplots() and the _quick()
// wrappers update it. Cells running in sequence share the same
// _currentAx so a stateful sequence like
//   plt.hist(...)        # creates an axes, becomes current
//   plt.xlabel('x')      # sets xlabel on that axes
//   plt.vlines(...)      # adds vertical lines to that axes
// works the same as matplotlib.
let _currentFig = null;
let _currentAx = null;

function _setCurrent(fig, ax) { _currentFig = fig; _currentAx = ax; return ax; }

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

// quick one-liners — create figure, add trace, return canvas
function _quick(fn) {
  return function (...args) {
    const { fig, ax } = subplots();
    fn(ax, ...args);
    _setCurrent(fig, ax);
    return fig.show();
  };
}

// plot(y), plot(x, y), plot(x, y, fmt, opts) … — Axes.plot sorts the forms out
const plot = _quick((ax, ...args) => ax.plot(...args));
// scatter(x, y, opts) and matplotlib's positional scatter(x, y, s, c)
const scatter = _quick((ax, ...args) => ax.scatter(...args));
const imshow = _quick((ax, data, nx, ny, opts) => ax.imshow(data, nx, ny, opts));
const bar = _quick((ax, x, heights, opts) => ax.bar(x, heights, opts));
const cmap = getCmap;
// matplotlib's matshow renders a 2D matrix as an image with no axes
// inversion — effectively imshow with origin='upper'. We alias for
// the common df.corr().matshow pattern.
const matshow = _quick((ax, data, nx, ny, opts) => ax.imshow(data, nx, ny, opts));

// plt.hist — matplotlib returns (counts, edges, patches). Adder cells
// destructure as `n, bins, patches = plt.hist(...)` or index as
// `result = plt.hist(...); n = result[0]`. We return an array-like
// with both index access and named getters (.counts/.edges/.canvas)
// so JS-side use is also ergonomic.
function hist(data, opts) {
  const { fig, ax } = subplots();
  ax.hist(data, opts);
  // Compute the actual counts + edges that the trace will render with,
  // so the caller sees real values matching the drawn bars.
  const trace = ax._traces[ax._traces.length - 1];
  const { edges, counts } = ax._hist(trace);
  const canvas = fig.show();
  return Object.assign([counts, edges, canvas], {
    counts, edges, canvas,
  });
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
// plt.figure(...) — return a fresh Figure (matplotlib's figure() takes
// figsize=(w,h) and other kwargs; we accept and ignore unsupported ones).
function figure(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  return new Figure(1, 1, o);
}
// plt.show() — renders the current figure to a canvas and returns it.
// When `plt.show()` is the last expression of an adder cell, adder's
// display path picks up the canvas (via nodeType check) and renders.
// Matplotlib's pyplot also renders implicitly after each cell in
// %matplotlib inline; for now we require an explicit `plt.show()` as
// the trailing statement.
function show() {
  if (!_currentFig) return null;
  return _currentFig.show();
}
// plt.close(fig?) — close a figure (matplotlib reclaims its handle).
// We hold no figure registry, so no-op.
// close(fig) forgets one figure, close() the current one, close('all') every one
function close(fig) {
  const drop = (f) => {
    const i = _shownFigures.indexOf(f);
    if (i >= 0) _shownFigures.splice(i, 1);
    for (let j = _savedFigures.length - 1; j >= 0; j--) if (_savedFigures[j].figure === f) _savedFigures.splice(j, 1);
    if (_currentFig === f) { _currentFig = null; _currentAx = null; }
  };
  if (fig === 'all') { _shownFigures.length = 0; _savedFigures.length = 0; _currentFig = null; _currentAx = null; return; }
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
  const sub = subplots(nrows, ncols);
  const ax = (sub.axes && sub.axes.length) ? sub.axes[index - 1] : sub.ax;
  _setCurrent(sub.fig, ax);
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
const cm = {};
for (const n of _CMAP_NAMES) {
  Object.defineProperty(cm, n, {
    get() { return getCmap(n); },
    enumerable: true,
  });
}
cm.get_cmap = getCmap;

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
function clf() { _currentFig = null; _currentAx = null; _shownFigures.length = 0; _savedFigures.length = 0; }
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
function colorbar(im, opts) {
  // Adder kwargs land in the trailing arg; pull `ax` out.
  let ax = null;
  if (opts && typeof opts === 'object' && opts.ax) ax = opts.ax;
  else if (im && typeof im === 'object' && typeof im.colorbar === 'function') ax = im;
  else if (im && im.axes && typeof im.axes.colorbar === 'function') ax = im.axes;
  else ax = _ax();
  ax.colorbar(opts && typeof opts === 'object' ? opts : {});
  return ax;
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
  rc, rcParams, style, show, close, shown, saved, replay,
  gca, gcf, xlabel, ylabel, title, xlim, ylim, xscale, yscale,
  legend, grid, vlines, hlines, axhline, axvline, text,
  subplots_adjust, tight_layout, savefig, clf, cla,
  xticks, yticks, axis, margins, colorbar, suptitle, themeFromCSS,
};

// register as auditable extension for adder `import plt`
if (typeof window !== 'undefined') {
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

export { subplots, plot, scatter, imshow, hist, bar, cmap, Figure, Axes, LinearScale, LogScale, getCmap, pltAdder, replay, recordingContext, rcParams, VERSION, themeFromCSS, resolveTheme };
