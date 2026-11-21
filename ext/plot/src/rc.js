// matplotlib's rcParams: the keys plot reads, their defaults and their checks, and the calls
// around them — plt.rc(group, **kw), rcdefaults(), rc_context(rc) (a with-block, or a function
// to run), cycler(color=[…]).
//
// When a key is read is matplotlib's rule: at creation. The theme keys (THEME_RC in style.js)
// dress each figure as it is made; the axes keys (grid, spines, margins, title and label looks,
// ticks) are read by each new axes; the line, marker, hist, image and legend keys by each new
// line, scatter, hist, image or legend. Changing a key re-dresses nothing already made.
//
// Defaults are plot's own, and say so: rcParams['figure.figsize'] is [4, 3] (inches at dpi
// 100), not matplotlib's [6.4, 4.8]. A theme key left unset (null in the store) reads as the
// theme's value. A key plot doesn't read is stored and warned about once; a value a key can't
// take warns and leaves the key as it was (matplotlib raises; plot's rule is to warn).

import { rcParams, _rcStore, _rcHooks, _pairs, _warn } from './opts.js';
import { getCmap } from './color.js';
import { _MARKERS } from './raster.js';
import { _style, _autoTheme, THEME_RC, _isMonoName, setStyle, _styleSnapshot, _styleRestore, _DEFAULT_STYLE } from './style.js';

const SIZES = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'larger', 'smaller'];
const LINESTYLES = ['-', '--', '-.', ':', 'solid', 'dashed', 'dashdot', 'dotted', 'None', 'none', ''];
const BIN_RULES = ['auto', 'fd', 'sturges', 'sqrt', 'rice', 'scott', 'doane', 'stone'];
const WEIGHTS = ['normal', 'bold', 'light', 'medium', 'semibold', 'heavy', 'ultralight', 'black', 'regular', 'book', 'demibold', 'demi', 'roman', 'extra bold', 'ultrabold'];

// key → [default, check]. check: a kind name or a list of allowed strings.
// null default = "plot's own": for a theme key, the theme's value; for a size, plot's size.
export const RC = {
  'gcu.strict': [false, 'bool'],
  'axes.unicode_minus': [true, 'bool'],
  // the theme (read as each figure is made)
  'axes.facecolor': [null, 'color'], 'figure.facecolor': [null, 'color'], 'axes.edgecolor': [null, 'color'],
  'text.color': [null, 'color'], 'grid.color': [null, 'color'], 'axes.prop_cycle': [null, 'cycle'],
  'image.cmap': [null, 'cmap'], 'font.size': [null, 'pos'], 'font.family': [null, 'family'], 'font.monospace': [null, 'family'],
  'legend.facecolor': [null, 'color'], 'legend.edgecolor': [null, 'color'],
  // the figure
  'figure.figsize': [[4, 3], 'pair'], 'figure.dpi': [100, 'pos'],
  'figure.titlesize': [null, 'size'], 'figure.titleweight': ['normal', 'weight'],
  // each axes, as it is made
  'axes.grid': [false, 'bool'], 'axes.grid.which': ['major', ['major', 'minor', 'both']], 'axes.grid.axis': ['both', ['both', 'x', 'y']],
  'grid.linestyle': ['-', 'linestyle'], 'grid.linewidth': [0.5, 'num'], 'grid.alpha': [0.8, 'num'],
  'axes.spines.left': [true, 'bool'], 'axes.spines.right': [true, 'bool'], 'axes.spines.top': [true, 'bool'], 'axes.spines.bottom': [true, 'bool'],
  'axes.linewidth': [1, 'num'],
  'axes.xmargin': [0.05, 'num'], 'axes.ymargin': [0.05, 'num'],
  'axes.titlesize': [null, 'size'], 'axes.titleweight': ['normal', 'weight'], 'axes.titlelocation': ['center', ['left', 'center', 'right']],
  'axes.titlepad': [6, 'num'], 'axes.titlecolor': ['auto', 'color'],
  'axes.labelsize': [null, 'size'], 'axes.labelweight': ['normal', 'weight'], 'axes.labelcolor': [null, 'color'], 'axes.labelpad': [6, 'num'],
  'xtick.labelsize': [null, 'size'], 'ytick.labelsize': [null, 'size'],
  'xtick.color': [null, 'color'], 'ytick.color': [null, 'color'], 'xtick.labelcolor': ['inherit', 'color'], 'ytick.labelcolor': ['inherit', 'color'],
  'xtick.direction': ['out', ['in', 'out', 'inout']], 'ytick.direction': ['out', ['in', 'out', 'inout']],
  'xtick.major.size': [4, 'pos'], 'ytick.major.size': [4, 'pos'], 'xtick.minor.size': [2, 'pos'], 'ytick.minor.size': [2, 'pos'],
  'xtick.major.width': [1, 'pos'], 'ytick.major.width': [1, 'pos'], 'xtick.minor.width': [0.8, 'pos'], 'ytick.minor.width': [0.8, 'pos'],
  'xtick.minor.visible': [false, 'bool'], 'ytick.minor.visible': [false, 'bool'],
  // each line, scatter, hist, errorbar, image, legend, as it is made
  'lines.linewidth': [1.5, 'pos'], 'lines.linestyle': ['-', 'linestyle'], 'lines.marker': ['None', 'marker'], 'lines.markersize': [6, 'pos'],
  'scatter.marker': ['o', 'marker'], 'hist.bins': [10, 'bins'], 'errorbar.capsize': [0, 'num'],
  'image.interpolation': ['antialiased', ['nearest', 'none', 'bilinear', 'antialiased']], 'image.origin': ['upper', ['upper', 'lower']],
  'legend.loc': ['best', 'loc'], 'legend.fontsize': [null, 'size'], 'legend.title_fontsize': [null, 'size'],
  'legend.frameon': [true, 'bool'], 'legend.framealpha': [1, 'num'],
};

// matplotlib's plt.rc aliases
const RC_ALIASES = { lw: 'linewidth', ls: 'linestyle', c: 'color', fc: 'facecolor', ec: 'edgecolor', mew: 'markeredgewidth', aa: 'antialiased' };

const BAD = Symbol('bad');
const _rcNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : NaN);
function _check(kind, v) {
  if (Array.isArray(kind)) return kind.includes(v) ? v : BAD;
  switch (kind) {
    case 'bool':
      if (typeof v === 'boolean') return v;
      if (v === 1 || v === 0) return !!v;
      if (typeof v === 'string') { const s = v.toLowerCase(); if (['true', 'yes', 'on', 't', 'y', '1'].includes(s)) return true; if (['false', 'no', 'off', 'f', 'n', '0'].includes(s)) return false; }
      return BAD;
    case 'num': { const n = _rcNum(v); return n - n === 0 ? n : BAD; }
    case 'pos': { const n = _rcNum(v); return n > 0 ? n : BAD; }
    case 'size': { if (SIZES.includes(v)) return v; const n = _rcNum(v); return n > 0 ? n : BAD; }
    case 'weight': { if (WEIGHTS.includes(v)) return v; const n = _rcNum(v); return n >= 100 && n <= 1000 ? n : BAD; }
    case 'color':
      if (typeof v === 'string' && v.trim()) return v.trim();
      if ((Array.isArray(v) || ArrayBuffer.isView(v)) && (v.length === 3 || v.length === 4)) return Array.from(v);
      return BAD;
    case 'cycle': {
      const cols = v && v._cycler ? v.color : Array.isArray(v) ? v : v instanceof Map ? v.get('color') : v && typeof v === 'object' ? v.color : null;
      if (v && (v._cycler || (typeof v === 'object' && !Array.isArray(v)))) {
        const others = (v._cycler ? Object.keys(v._props) : _pairs(v).map(([k]) => k)).filter((k) => k !== 'color');
        if (others.length) _warn('rc.prop_cycle.' + others.join(), `rcParams['axes.prop_cycle']: plot cycles colours only so far; ${others.join(', ')} not cycled`);
      }
      return Array.isArray(cols) && cols.length && cols.every((c) => typeof c === 'string' || Array.isArray(c)) ? cols.slice() : BAD;
    }
    case 'cmap': try { return getCmap(v) ? v : BAD; } catch { return BAD; }
    case 'family': {
      const a = [].concat(v);
      return a.length && a.every((s) => typeof s === 'string' && s.trim()) ? (Array.isArray(v) ? a.slice() : v) : BAD;
    }
    case 'pair': {
      const a = v && typeof v !== 'string' ? Array.from(v, _rcNum) : [];
      return a.length === 2 && a.every((n) => n > 0) ? a : BAD;
    }
    case 'linestyle': return LINESTYLES.includes(v) ? v : BAD;
    case 'marker': return v === 'None' || v === 'none' || v === '' || v == null ? 'None' : _MARKERS.includes(v) ? v : BAD;
    case 'bins': { if (BIN_RULES.includes(v)) return v; const n = _rcNum(v); return Number.isInteger(n) && n > 0 ? n : BAD; }
    case 'loc': return typeof v === 'string' || Number.isInteger(v) ? v : BAD;
  }
  return v;
}
const _HINT = {
  bool: 'True or False', num: 'a number', size: `a size in px or one of ${SIZES.slice(0, 7).join(', ')}`, weight: "'normal', 'bold' or 100–1000",
  pos: 'a positive number', color: 'a colour', cycle: "a list of colours or cycler(color=[…])", cmap: 'a colour-map name', family: 'a font name or a list of them',
  pair: '[width, height] in inches', linestyle: LINESTYLES.slice(0, 8).join(' '), marker: `None or one of ${_MARKERS.join(' ')}`,
  bins: `a positive integer or one of ${BIN_RULES.join(', ')}`, loc: 'a place name',
};
const _repr = (v) => { try { return typeof v === 'string' ? `'${v}'` : JSON.stringify(v) ?? String(v); } catch { return String(v); } };

function _setRc(k, v) {
  const spec = RC[k];
  if (!spec) {
    _rcStore[k] = v;
    _warn('rc.' + k, `rcParams['${k}']: plot doesn't read this key (it reads ${Object.keys(RC).length}; API.md lists them); stored, no effect`);
    return;
  }
  // None (null) puts a "plot's own" key back to plot's own
  if (v == null && spec[0] === null) { _rcStore[k] = null; return; }
  const r = _check(spec[1], v);
  if (r === BAD) {
    const hint = Array.isArray(spec[1]) ? spec[1].map(_repr).join(', ') : _HINT[spec[1]];
    _warn(`rc.${k}.${_repr(v)}`, `rcParams['${k}'] = ${_repr(v)}: it takes ${hint}; left as it was`);
    return;
  }
  _rcStore[k] = r;
  if (k === 'font.family' && ![].concat(r).some(_isMonoName)) {
    _warn('rc.font.family', `rcParams['font.family'] = ${_repr(r)}: plot draws its text in a monospace face, so a figure lays out the same live, recorded and replayed; a proportional family isn't used for chart text (set font.monospace to choose the face)`);
  }
}
function _getRc(k, v) {
  // a theme key left unset reads as the theme's value now
  if (v == null && THEME_RC[k]) { const th = _style._auto ? _autoTheme() : _style; const tv = th[THEME_RC[k]]; return Array.isArray(tv) ? tv.slice() : tv; }
  return v;
}

// the store starts at the defaults
function _fillDefaults() {
  for (const k of Object.keys(_rcStore)) delete _rcStore[k];
  for (const [k, [d]] of Object.entries(RC)) _rcStore[k] = Array.isArray(d) ? d.slice() : d;
}
_fillDefaults();
_rcHooks.set = _setRc;
_rcHooks.get = _getRc;

// plt.rc('lines', linewidth=2) · rc(['xtick', 'ytick'], {labelsize: 9}) · rc('axes', {titlesize: 'x-large'})
export function rc(group, kwargs) {
  const groups = Array.isArray(group) ? group : [group];
  const kw = _pairs(kwargs);
  if (typeof group !== 'string' && !Array.isArray(group)) throw new Error(`plot: rc(group, {…}): group is a name like 'lines' or 'axes' (or a list of them)`);
  for (const g of groups) for (const [name, v] of kw) rcParams[`${g}.${RC_ALIASES[name] || name}`] = v;
}

// every key back to plot's default, and the style back to the one a fresh page starts with
export function rcdefaults() {
  _fillDefaults();
  setStyle(_DEFAULT_STYLE === 'auto' ? 'auto' : _DEFAULT_STYLE);
}

// a snapshot of rcParams and the style, and a way back to it
function _snapshot() { return { rc: { ..._rcStore }, style: _styleSnapshot() }; }
function _restore(s) {
  for (const k of Object.keys(_rcStore)) delete _rcStore[k];
  Object.assign(_rcStore, s.rc);
  _styleRestore(s.style);
}

// a context that applies `apply` on entry and puts rcParams and the style back on exit:
// Python's `with plt.rc_context({...}):`, JS's ctx.enter() / ctx.exit(), or run(fn) around a
// function (a Promise it returns is waited for before the restore)
export function _context(apply, fn) {
  let saved = null;
  const enter = () => { saved = _snapshot(); apply(); return ctx; };
  const exit = () => { if (saved) { _restore(saved); saved = null; } return false; };
  const run = (f) => {
    enter();
    let out;
    try { out = f(); } catch (e) { exit(); throw e; }
    if (out && typeof out.then === 'function') return out.finally(exit);
    exit();
    return out;
  };
  const ctx = { enter, exit, run, __enter__: enter, __exit__: exit, __repr__: () => '<rc_context>' };
  return typeof fn === 'function' ? run(fn) : ctx;
}

// rc_context(rc?, fn?) — matplotlib's: `with plt.rc_context({'lines.linewidth': 3}):`. Also
// rc_context({rc, fname}) as keywords. With a function: runs it inside, returns its result.
export function rc_context(rcOrKw, fn) {
  let src = rcOrKw;
  if (src && !(src instanceof Map) && typeof src === 'object' && src._kw && 'rc' in src) src = src.rc;
  if (typeof src === 'function') { fn = src; src = null; }
  if (src && typeof src === 'object' && !(src instanceof Map) && 'fname' in src && !('rc' in src)) _warn('rc_context.fname', 'rc_context(fname=…): plot reads no matplotlibrc files; pass the keys as a dict');
  return _context(() => { if (src) rcParams.update(src); }, fn);
}

// cycler(color=[…]) · cycler('color', […]) — what axes.prop_cycle takes. plot cycles colours.
export function cycler(a, b) {
  const props = {};
  if (typeof a === 'string') props[a] = Array.from(b || []);
  else for (const [k, v] of _pairs(a)) props[k] = Array.from(v);
  const n = Math.max(0, ...Object.values(props).map((v) => v.length));
  const c = {
    _cycler: true, _props: props, color: props.color || null, keys: Object.keys(props),
    by_key: () => ({ ...props }),
    __len__: () => n,
    __repr__: () => `cycler(${Object.entries(props).map(([k, v]) => `${_repr(k)}, ${_repr(v)}`).join(') + cycler(')})`,
  };
  return c;
}
cycler.cycler = cycler;   // `from cycler import cycler` (the module and the function share the name)

// the rc an axes reads as it is made: grid, spines, margins, title / label / tick looks
export function _rcAxes(ax) {
  const r = _rcStore;
  ax._grid = !!r['axes.grid'];
  ax._gridRc = { which: r['axes.grid.which'], axis: r['axes.grid.axis'], linestyle: r['grid.linestyle'], linewidth: r['grid.linewidth'], alpha: r['grid.alpha'] };
  ax._gridOpts = { ...ax._gridRc };
  ax._xmargin = r['axes.xmargin'];
  ax._ymargin = r['axes.ymargin'];
  ax._spines = {};
  for (const s of ['left', 'right', 'top', 'bottom']) ax._spines[s] = { visible: r['axes.spines.' + s] !== false, color: null, linewidth: r['axes.linewidth'], linestyle: null };
  ax._rc = {
    titleSize: r['axes.titlesize'], titleWeight: r['axes.titleweight'], titleLoc: r['axes.titlelocation'], titlePad: r['axes.titlepad'],
    titleColor: r['axes.titlecolor'] === 'auto' ? null : r['axes.titlecolor'],
    labelSize: r['axes.labelsize'], labelWeight: r['axes.labelweight'], labelColor: r['axes.labelcolor'], labelPad: r['axes.labelpad'],
    tickSize: { x: r['xtick.labelsize'], y: r['ytick.labelsize'] },
  };
  // tick marks: only what differs from plot's defaults goes into tick_params' store
  const tp = {};
  for (const a of ['x', 'y']) {
    const col = r[a + 'tick.color'], lab = r[a + 'tick.labelcolor'];
    for (const w of ['major', 'minor']) {
      const p = {};
      if (r[`${a}tick.direction`] !== 'out') p.direction = r[`${a}tick.direction`];
      if (r[`${a}tick.${w}.size`] !== RC[`${a}tick.${w}.size`][0]) p.length = r[`${a}tick.${w}.size`];
      if (r[`${a}tick.${w}.width`] !== RC[`${a}tick.${w}.width`][0]) p.width = r[`${a}tick.${w}.width`];
      if (col != null) p.color = col;
      if (w === 'major' && lab != null && lab !== 'inherit') p.labelcolor = lab;
      else if (w === 'major' && col != null) p.labelcolor = col;
      if (Object.keys(p).length) { tp[a] = tp[a] || {}; tp[a][w] = p; }
    }
    if (r[a + 'tick.minor.visible']) ax._ticker(a).minorOn = true;
  }
  if (Object.keys(tp).length) ax._tickParams = tp;
}

// matplotlib's rcParamsDefault: plot's defaults, as a plain dict
export function _rcDefaults() { return Object.fromEntries(Object.entries(RC).map(([k, [d]]) => [k, Array.isArray(d) ? d.slice() : d])); }

// a read of one key's raw value (plot's code uses it at creation)
export const _rcv = (k) => _rcStore[k];
