// Nothing is silently ignored. Every option a plot function takes is listed here, in ONE place:
// what it accepts, and what it knows of but can't do yet (with what to use instead). An option
// not in either list warns once per function and key, with the nearest real name. With
// rcParams['gcu.strict'] (or a figure made with {strict: true}) every warning throws instead.
//
// The lists double as documentation: API.md's "unsupported" table is generated from
// _UNSUPPORTED, so the warnings and the docs can't drift.

// matplotlib's short aliases, resolved into the canonical name at trace ingress
export const _ALIASES = {
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

export const _KNOWN = {
  plot: [..._ARTIST, 'linestyle', 'linewidth', 'marker', 'markersize', 'markerfacecolor', 'markeredgecolor', 'markeredgewidth', 'fmt', 'drawstyle'],
  scatter: [..._ARTIST, 'c', 's', 'cmap', 'vmin', 'vmax', 'marker', 'edgecolor', 'linewidth', 'plotnonfinite'],
  bar: [..._ARTIST, 'width', 'bottom', 'align', 'edgecolor', 'linewidth', 'tick_label'],
  barh: [..._ARTIST, 'height', 'left', 'align', 'edgecolor', 'linewidth', 'tick_label'],
  hist: [..._ARTIST, 'bins', 'range', 'weights', 'density', 'cumulative', 'edgecolor', 'linewidth', 'histtype', 'orientation', 'stacked', 'log', 'bottom', 'align', 'rwidth', 'linestyle'],
  fill_between: [..._ARTIST, 'where', 'step', 'interpolate', 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'y2'],
  fill_betweenx: [..._ARTIST, 'where', 'step', 'interpolate', 'facecolor', 'edgecolor', 'linewidth', 'linestyle', 'x2'],
  axhspan: [..._ARTIST, 'xmin', 'xmax', 'facecolor', 'edgecolor', 'linewidth'],
  axvspan: [..._ARTIST, 'ymin', 'ymax', 'facecolor', 'edgecolor', 'linewidth'],
  imshow: ['label', 'alpha', 'zorder', 'cmap', 'vmin', 'vmax', 'origin', 'nodata', 'extent', 'interpolation', 'aspect'],
  axhline: [..._ARTIST, 'linestyle', 'linewidth', 'xmin', 'xmax'],
  axvline: [..._ARTIST, 'linestyle', 'linewidth', 'ymin', 'ymax'],
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
export const _UNSUPPORTED = {
  plot: { dashes: "use linestyle ('--', '-.', ':')" },
  scatter: { norm: 'not supported yet — use vmin / vmax' },
  bar: { hatch: 'not supported yet', yerr: 'use errorbar() on the bar positions', xerr: 'use errorbar() on the bar positions' },
  barh: { hatch: 'not supported yet', xerr: 'use errorbar() on the bar positions' },
  hist: { hatch: 'not supported yet' },
  imshow: { norm: 'not supported yet — use vmin / vmax' },
  text: { bbox: 'not supported yet' },
  legend: { bbox_to_anchor: 'not supported yet — use loc', ncol: 'not supported yet', title: 'not supported yet', fontsize: 'not supported yet', frameon: 'not supported yet', framealpha: 'not supported yet' },
  colorbar: { shrink: 'not supported yet', orientation: 'only vertical colorbars for now', ticks: 'not supported yet', extend: 'not supported yet', fraction: 'not supported yet', pad: 'not supported yet' },
  subplots: { squeeze: 'not supported yet', constrained_layout: 'layout is always tight', layout: 'layout is always tight' },
};

// The calls that do nothing yet, by name → what to do instead
export const _NOOP_CALLS = {
  rc: "plt.rc is not supported yet; use plt.style.use('default' | 'dark_background')",
  set_zorder: 'axes are drawn in creation order',
  subplots_adjust: 'not supported yet; use subplots(..., {gap}) for the space between axes',
};

// plt.rcParams lives here so the strict flag can be read without an import cycle
export const rcParams = {};
Object.defineProperty(rcParams, 'update', {
  value(obj) { if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) if (k !== '_kw') rcParams[k] = obj[k]; },
  enumerable: false,
});

const _warned = new Set();

function _strict(strictFlag) {
  return !!(strictFlag || rcParams['gcu.strict']);
}

// one message per (function, key): a notebook loop must not print the same warning 10,000 times
export function _warn(key, msg, strictFlag) {
  if (_strict(strictFlag)) throw new Error('plot: ' + msg);
  if (_warned.has(key)) return;
  _warned.add(key);
  if (typeof console !== 'undefined' && console.warn) console.warn('plot: ' + msg);
}

// for tests: forget which warnings have been shown
export function _resetWarnings() { _warned.clear(); }

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
export function _checkOpts(fn, o, strictFlag) {
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
export function _resolveAliases(o) {
  if (!o) return o;
  for (const [a, k] of Object.entries(_ALIASES)) {
    if (o[a] !== undefined && o[k] === undefined) o[k] = o[a];
  }
  return o;
}

// a call plot accepts but can't honour yet
export function _noop(name, strictFlag) {
  _warn('call.' + name, `${name}() does nothing yet — ${_NOOP_CALLS[name]}`, strictFlag);
}
