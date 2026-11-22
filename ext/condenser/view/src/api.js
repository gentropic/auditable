// @gcu/condenser/view — the viewer for any browser page: the twin of the Python
// `gcu.condenser`. SAME functions, SAME option names (snake_case included), SAME
// defaults, so one document teaches both:
//
//   import { view, blocks, points, drillholes } from '@gcu/condenser/view';
//
//   const v = view(el, [
//     blocks({ x: X, y: Y, z: Z, value: FE }, { name: 'model', threshold: [28, 99], ramp: 'viridis' }),
//     drillholes(collar, survey, assay, { value: 'AU', labels: true }),
//     points({ x: tx, y: ty, z: tz }, { name: 'topo', sectioned: false }),
//   ], { section: { axis: 'z', position: 485, thickness: 10 }, height: 520 });
//
//   v.on('pick', (p) => …);                      // { layer, name, index, x, y, z, value, … }
//   v.layer('model').set({ threshold: [30, 99] });
//   v.cut('z', 470, 10);  v.look('plan');  v.fit();
//   const png = await v.snapshot();              // a Blob, the figure chrome composited
//
// The data arrive as columns: typed arrays (used where they are, never copied when they
// are already the wire type), plain arrays, or a table — any object whose columns are
// reachable as t[name], t.get(name) or t.getChild(name) (an Arrow table). The packing
// below is a line-by-line port of gcu/condenser/__init__.py (_value_and_cat, the lattice
// inference, the wire v3 encodings), checked against it by test/condenser-view-api.test.mjs.
//
// No network, no WASM, no workers required (the streaming path uses one when it can, and
// falls back inline), no eval — it runs inside a strict sandbox.

import { mountView } from './view.js';
import { createStore } from './store.js';
import { normLock, LOCK_NAMES } from './lock.js';

const U16MAX = 65535;

// ── options: the Python traits, with their defaults ─────────────────────────────────────
export const STYLE_DEFAULTS = {
  name: '', visible: true, color: 'z', value: '', ramp: 'viridis', clip: [], threshold: [],
  filter_mode: 'isolate', opacity: 1.0, point_size: 2.5, as_points: false, block_edges: false,
  radius: 1.5, labels: false, categories_hidden: [], sectioned: true,
  // the legend and the class colours: units after the title; colours per class ({label: colour}
  // or a list in class order); the class order; counts per class ('all' rows or the 'selection')
  units: '', colors: null, category_order: [], legend_counts: false,
};
export const VIEW_DEFAULTS = {
  // background: '' takes the theme's
  section: null, background: '', height: 460, toolbar: true, edl: true, edl_strength: 1.0,
  z_exaggeration: 1.0, decorations: true, camera: {}, hover: false, select_through: false, budget: 3_000_000,
  // the orientation lock: 'free' · 'plan' · 'section' · 'north' · 'south' · 'east' · 'west' · {azimuth, plunge}
  lock: 'free', lock_toggle: true, twist: false,
  // the theme ('auto' follows the page · 'dark' · 'light' · 'paper' · 'css' · a partial theme) and the chrome switches
  theme: 'auto', chrome: {},
  // grid lines across a locked view's axes
  grid: false,
  // plot items over locked views, as data: [{kind: 'scatter' | 'plot' | 'fill' | 'text' |
  // 'geometry' | 'legend', x, y, …style, on: 'plan' | [axis, axis] | 'any'}] (see API.md)
  overlay: [],
  // JS only: false when the page's CSP allows no workers (streams then build inline)
  workers: true,
};
// the column-mapping options each constructor takes besides the style
const COLUMN_OPTS = {
  points: ['x', 'y', 'z', 'value', 'category', 'rgb'],
  blocks: ['x', 'y', 'z', 'value', 'category', 'size'],
  drillholes: ['bhid', 'x', 'y', 'z', 'eoh', 'depth', 'az', 'dip', 'frm', 'from', 'to', 'value', 'category', 'method', 'dip_convention'],
  mesh: [],
  surface: ['origin', 'pitch', 'drape', 'nodata', 'flat_z', 'stride', 'nx', 'ny'],
};

const _warned = new Set();
function _lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; }
  }
  return d[b.length];
}
// the built-in chrome, by the switch that names it in `chrome: {…}`
export const CHROME_KEYS = ['axes', 'toolbar', 'section', 'pick', 'status', 'readout', 'legend', 'scalebar', 'north', 'exaggeration', 'labels', 'triad', 'box'];

// an option nobody reads warns once, with the nearest real name — nothing is silently ignored
function _checkKeys(where, opts, known) {
  for (const k of Object.keys(opts || {})) {
    if (known.includes(k)) continue;
    const key = `${where}.${k}`;
    if (_warned.has(key)) continue;
    _warned.add(key);
    let best = null, bd = 3;
    for (const n of known) { const d = _lev(k.toLowerCase(), n.toLowerCase()); if (d < bd) { bd = d; best = n; } }
    if (typeof console !== 'undefined') console.warn(`condenser: ${where} has no option '${k}'${best ? `, did you mean '${best}'?` : ''}`);
  }
}

// ── column plumbing ─────────────────────────────────────────────────────────────────────
const isArrayLike = (v) => v != null && typeof v !== 'string' && (Array.isArray(v) || ArrayBuffer.isView(v) || typeof v.length === 'number');

function _lookup(src, name) {
  if (src == null) return undefined;
  if (typeof src.getChild === 'function') { const c = src.getChild(name); if (c) return typeof c.toArray === 'function' ? c.toArray() : c; }
  if (typeof src.get === 'function' && !(src instanceof Map && !src.has(name))) { const c = src.get(name); if (c !== undefined) return c; }
  return src[name];
}

// a column: an array, or a column NAME when `src` is a table (the Python _col)
function _col(src, spec, what, n) {
  if (spec == null) return null;
  let a = spec;
  if (typeof spec === 'string') {
    if (src == null) throw new TypeError(`condenser: ${what}=${JSON.stringify(spec)} is a column name, but no table was given`);
    a = _lookup(src, spec);
    if (a == null) throw new Error(`condenser: no column ${JSON.stringify(spec)} in the table`);
  }
  if (!isArrayLike(a)) throw new TypeError(`condenser: ${what} must be a column (an array) or a column name`);
  if (n != null && a.length !== n) throw new Error(`condenser: ${what} has ${a.length} values, expected ${n}`);
  return a;
}

function _f64(a) {
  if (a instanceof Float64Array) return a;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) { const v = a[i]; out[i] = v == null ? NaN : +v; }
  return out;
}

function _range(f) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === -Infinity || hi === Infinity) {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < f.length; i++) { const v = f[i]; if (v - v !== 0) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return lo <= hi ? [lo, hi] : null;
}

// numpy.unique order: numbers numerically, anything else as strings
function _sortedLabels(set) {
  const vals = Array.from(set);
  const allNum = vals.every((v) => typeof v === 'number');
  return allNum ? vals.sort((a, b) => a - b) : vals.map(String).sort();
}

// any categorical column → (u8 codes, labels). >256 distinct folds the tail into '(other)'
function _codes(values) {
  const n = values.length;
  const seen = new Set();
  for (let i = 0; i < n; i++) seen.add(values[i]);
  let labels = _sortedLabels(seen);
  const index = new Map(labels.map((l, k) => [l, k]));
  const codes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    let k = index.get(typeof labels[0] === 'string' ? String(v) : v);
    codes[i] = Math.min(k, 255);
  }
  if (labels.length > 256) labels = [...labels.slice(0, 255), '(other)'];
  return { codes, labels: labels.map(String) };
}

// shared BHID factorization across the three drillhole tables (u32 codes join like names)
function _ids(...cols) {
  const seen = new Set();
  for (const c of cols) for (let i = 0; i < c.length; i++) seen.add(String(c[i]));
  const labels = Array.from(seen).sort();
  const index = new Map(labels.map((l, k) => [l, k]));
  return { codes: cols.map((c) => { const o = new Uint32Array(c.length); for (let i = 0; i < c.length; i++) o[i] = index.get(String(c[i])); return o; }), labels };
}

// ── lattices ────────────────────────────────────────────────────────────────────────────
function _uniqueSorted(v) {
  const f = new Float64Array(v.length);
  let m = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x - x === 0) f[m++] = x; }
  const s = f.subarray(0, m).sort();
  let u = 0;
  for (let i = 0; i < m; i++) if (i === 0 || s[i] !== s[i - 1]) s[u++] = s[i];
  return s.subarray(0, u);
}

// a regular lattice (origin, pitch, count) from centroids — the Python _axis_from_centroids
function _axisFromCentroids(v, name) {
  const u = _uniqueSorted(v);
  if (!u.length) throw new Error(`condenser: axis ${name} has no finite values`);
  if (u.length === 1) return [u[0], 1.0, 1];
  let pitch = Infinity;
  for (let i = 1; i < u.length; i++) pitch = Math.min(pitch, u[i] - u[i - 1]);
  if (!(pitch > 0)) throw new Error(`condenser: axis ${name} has a zero pitch`);
  const count = Math.round((u[u.length - 1] - u[0]) / pitch) + 1;
  for (let i = 0; i < u.length; i++) {
    const off = (u[i] - u[0]) / pitch;
    if (Math.abs(off - Math.round(off)) > 1e-3) {
      throw new Error(`condenser: ${name} centroids are not on a regular lattice. Pass size: [dx, dy, dz] if this is a sub-blocked model, or use points(...) to view the centroids.`);
    }
  }
  if (count > U16MAX) throw new Error(`condenser: axis ${name} needs ${count} cells (max ${U16MAX})`);
  return [u[0], pitch, count];
}

// the lattice of a SUB-BLOCKED axis: the finest block's pitch, or half of it
function _axisSubblocked(v, size, name) {
  let lo = Infinity, hi = -Infinity, fine = Infinity;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x - x !== 0) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    if (size[i] < fine) fine = size[i];
  }
  if (!(fine > 0) || fine === Infinity) throw new Error(`condenser: axis ${name} has a non-positive block size`);
  for (const pitch of [fine, fine / 2]) {
    let ok = true;
    for (let i = 0; i < v.length && ok; i++) {
      const x = v[i];
      if (x - x !== 0) continue;
      const off = (x - lo) / pitch;
      if (Math.abs(off - Math.round(off)) >= 1e-3) ok = false;
    }
    if (ok) {
      const count = Math.round((hi - lo) / pitch) + 1;
      if (count > U16MAX) throw new Error(`condenser: sub-blocked axis ${name} needs ${count} fine cells (max ${U16MAX}). Use points(...) for this model.`);
      return [lo, pitch, count];
    }
  }
  throw new Error(`condenser: sub-blocked axis ${name} is not on a common fine lattice (the sub-division is not a whole multiple). Use points(...).`);
}

// ── value channels + category (the Python _value_and_cat) ───────────────────────────────
function _valueAndCat(src, value, category, n, cols, extra, kind) {
  let chans = [];
  if (value == null) chans = [];
  else if (typeof value === 'string') chans = [[value, _col(src, value, 'value', n)]];
  else if (Array.isArray(value) && value.length && value.every((v) => typeof v === 'string')) chans = value.map((v) => [v, _col(src, v, `value ${v}`, n)]);
  else if (!isArrayLike(value) && typeof value === 'object') chans = Object.entries(value).map(([k, v]) => [String(k), _col(src, v, `value ${k}`, n)]);
  else if (Array.isArray(value) && value.length && value.every(isArrayLike)) chans = value.map((v, k) => [k ? `value${k + 1}` : 'value', _col(src, v, `value ${k + 1}`, n)]);
  else chans = [['value', _col(src, value, 'value', n)]];
  const names = [], ranges = [];
  chans.forEach(([nm, val], k) => {
    const vf = _f64(val);
    const r = _range(vf) || [0, 1];
    names.push(nm); ranges.push(r);
    // wire v3: values ride f32 (the f64 range stays in the header)
    cols[k === 0 ? 'value' : `value${k}`] = val instanceof Float32Array ? val : Float32Array.from(vf);
    if (kind === 'points') {
      // the points pipeline colors from a u16 intensity channel: hi lands on 65535
      const span = r[1] > r[0] ? r[1] - r[0] : 1;
      const q = new Uint16Array(n);
      for (let i = 0; i < n; i++) { const v = vf[i]; q[i] = v - v === 0 ? Math.round(Math.max(0, Math.min(1, (v - r[0]) / span)) * 65535) : 0; }
      cols[k === 0 ? 'value_u16' : `value_u16_${k}`] = q;
    }
  });
  if (names.length) { extra.value_range = ranges[0]; extra.value_channels = names; extra.value_ranges = ranges; }
  let labels = [];
  const cat = _col(src, category, 'category', n);
  if (cat != null) {
    const c = _codes(cat);
    cols.cat = c.codes; labels = c.labels;
    extra.cat_n = labels.length; extra.cat_labels = labels;
  }
  return { names, labels };
}

// split one options object into the column mapping and the style
function _split(kind, opts) {
  const o = opts || {};
  const colKeys = COLUMN_OPTS[kind];
  _checkKeys(`${kind}()`, o, [...colKeys, ...Object.keys(STYLE_DEFAULTS)]);
  const map = {}, style = {};
  for (const [k, v] of Object.entries(o)) (colKeys.includes(k) ? map : style)[k] = v;
  return { map, style };
}

// the first argument: a table, or (as in Python) the columns object itself
function _defaults(src, map, names) {
  for (const n of names) {
    if (map[n] !== undefined || !src) continue;
    const v = _lookup(src, n); if (v == null) continue;
    // value given IN the columns object as a mapping or a list of columns: take it as it is (not as a name)
    map[n] = n === 'value' && _isMultiValue(v) ? v : n;
  }
}
// several value columns: { name: array } or [array, array, …]
const _isMultiValue = (v) => (!isArrayLike(v) && typeof v === 'object') || (Array.isArray(v) && v.length > 0 && v.every(isArrayLike));

// ── layers ──────────────────────────────────────────────────────────────────────────────
export class Layer {
  constructor(kind, cols, extra, categories, style) {
    this.kind = kind;
    this.cols = cols;                    // name → typed array (the wire form)
    this.extra = extra;                  // the per-layer header
    this.categories = categories || [];
    this.style = { ...STYLE_DEFAULTS, ...style };
    this._stream = null;
  }
  get count() { return this.extra.count || 0; }
  get name() { return this.style.name; }
}

function _finishStyle(style, chanNames, hasCat) {
  if (style.color === undefined) style.color = chanNames.length ? 'value' : (hasCat ? 'category' : 'z');
  if (style.value === undefined) style.value = chanNames.length ? chanNames[0] : '';
  return style;
}

// points(src, { x, y, z, value, category, rgb, ...style })
export function points(src, opts) {
  const { map, style } = _split('points', opts);
  _defaults(src, map, ['x', 'y', 'z', 'value', 'category', 'rgb']);
  const xa = _col(src, map.x ?? 'x', 'x');
  const n = xa.length;
  const xf = _f64(xa), yf = _f64(_col(src, map.y ?? 'y', 'y', n)), zf = _f64(_col(src, map.z ?? 'z', 'z', n));
  const cols = {};
  const extra = { count: n };
  const { names, labels } = _valueAndCat(src, map.value, map.category, n, cols, extra, 'points');
  if (map.rgb != null) {
    const a = _col(src, map.rgb, 'rgb');
    let bytes;
    if (a.length === n * 3 && typeof a[0] === 'number') bytes = a instanceof Uint8Array ? a : Uint8Array.from(a);
    else if (a.length === n && isArrayLike(a[0])) { bytes = new Uint8Array(n * 3); for (let i = 0; i < n; i++) bytes.set(a[i], i * 3); }
    else throw new Error('condenser: rgb must be n × 3 bytes (flat, or one [r, g, b] per point)');
    cols.rgb = bytes;
  }
  const rx = _range(xf), ry = _range(yf), rz = _range(zf);
  if (!rx || !ry || !rz) throw new Error('condenser: points has no finite coordinates');
  extra.bbox = [rx[0], ry[0], rz[0], rx[1], ry[1], rz[1]];
  // wire v3: positions ride f32 about the layer's own bbox center, the f64 origin in the header
  const ox = (rx[0] + rx[1]) / 2, oy = (ry[0] + ry[1]) / 2, oz = (rz[0] + rz[1]) / 2;
  const fx = new Float32Array(n), fy = new Float32Array(n), fz = new Float32Array(n);
  for (let i = 0; i < n; i++) { fx[i] = xf[i] - ox; fy[i] = yf[i] - oy; fz[i] = zf[i] - oz; }
  cols.x = fx; cols.y = fy; cols.z = fz;
  extra.pos_origin = [ox, oy, oz];
  return new Layer('points', cols, extra, labels, _finishStyle(style, names, !!cols.cat));
}

// blocks(src, { x, y, z, value, category, size: [dx, dy, dz], ...style })
export function blocks(src, opts) {
  const { map, style } = _split('blocks', opts);
  _defaults(src, map, ['x', 'y', 'z', 'value', 'category']);
  const xa = _col(src, map.x ?? 'x', 'x');
  const n = xa.length;
  const xf = _f64(xa), yf = _f64(_col(src, map.y ?? 'y', 'y', n)), zf = _f64(_col(src, map.z ?? 'z', 'z', n));
  const cols = {};
  const extra = { count: n };
  const { names, labels } = _valueAndCat(src, map.value, map.category, n, cols, extra, 'blocks');
  let axes;
  if (map.size == null) {
    axes = [_axisFromCentroids(xf, 'x'), _axisFromCentroids(yf, 'y'), _axisFromCentroids(zf, 'z')];
  } else {
    if (!Array.isArray(map.size) || map.size.length !== 3) throw new Error('condenser: size must be [dx, dy, dz]');
    const dims = map.size.map((s, i) => (typeof s === 'number' ? new Float64Array(n).fill(s) : _f64(_col(src, s, `size[${i}]`, n))));
    axes = [_axisSubblocked(xf, dims[0], 'x'), _axisSubblocked(yf, dims[1], 'y'), _axisSubblocked(zf, dims[2], 'z')];
    // a palette of HALF-dims keyed by the distinct (dx, dy, dz), numpy.unique(axis=0) order
    const key = (i) => `${dims[0][i]},${dims[1][i]},${dims[2][i]}`;
    const trips = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); if (!trips.has(k)) trips.set(k, [dims[0][i], dims[1][i], dims[2][i]]); }
    if (trips.size > 256) throw new Error(`condenser: ${trips.size} distinct block sizes (max 256). Round the size columns, or use points(...).`);
    const uniq = Array.from(trips.values()).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const code = new Map(uniq.map((t, k) => [t.join(','), k]));
    const dim = new Uint8Array(n);
    for (let i = 0; i < n; i++) dim[i] = code.get(key(i));
    cols.dim = dim;
    extra.dim_palette = uniq.map((t) => t.map((d) => d / 2));
    extra.sub_blocked = true;
  }
  extra.axes = axes;
  // wire v3: positions ride as u16 LATTICE INDICES; the axes decode them exactly
  let allFinite = true;
  for (let i = 0; i < n && allFinite; i++) if (xf[i] - xf[i] !== 0 || yf[i] - yf[i] !== 0 || zf[i] - zf[i] !== 0) allFinite = false;
  if (allFinite) {
    for (const [cn, arr, ax] of [['i', xf, axes[0]], ['j', yf, axes[1]], ['k', zf, axes[2]]]) {
      const q = new Uint16Array(n);
      for (let i = 0; i < n; i++) q[i] = Math.round((arr[i] - ax[0]) / ax[1]);
      cols[cn] = q;
    }
    extra.pos = 'ijk';
  } else { cols.x = xf; cols.y = yf; cols.z = zf; }
  const rx = _range(xf), ry = _range(yf), rz = _range(zf);
  const half = axes.map((a) => a[1] / 2);
  extra.bbox = [rx[0] - half[0], ry[0] - half[1], rz[0] - half[2], rx[1] + half[0], ry[1] + half[1], rz[1] + half[2]];
  return new Layer('blocks', cols, extra, labels, _finishStyle(style, names, !!cols.cat));
}

// drillholes(collar, survey, intervals, { bhid, x, y, z, eoh, depth, az, dip, from, to, value, category, method, dip_convention, ...style })
export function drillholes(collar, survey, intervals, opts) {
  const { map, style } = _split('drillholes', opts);
  const bhid = map.bhid ?? 'BHID';
  const cb = _col(collar, bhid, 'collar bhid'), sb = _col(survey, bhid, 'survey bhid'), ib = _col(intervals, bhid, 'interval bhid');
  const { codes: [cbc, sbc, ibc], labels: holeNames } = _ids(cb, sb, ib);
  const n = ib.length;
  const cx = _f64(_col(collar, map.x ?? 'X', 'collar x')), cy = _f64(_col(collar, map.y ?? 'Y', 'collar y')), cz = _f64(_col(collar, map.z ?? 'Z', 'collar z'));
  const cols = {
    c_bhid: cbc, c_x: cx, c_y: cy, c_z: cz,
    s_bhid: sbc,
    s_depth: _f64(_col(survey, map.depth ?? 'DEPTH', 'survey depth')),
    s_az: _f64(_col(survey, map.az ?? 'AZ', 'survey az')),
    s_dip: _f64(_col(survey, map.dip ?? 'DIP', 'survey dip')),
    i_bhid: ibc,
    i_from: _f64(_col(intervals, map.from ?? map.frm ?? 'FROM', 'interval from')),
    i_to: _f64(_col(intervals, map.to ?? 'TO', 'interval to')),
  };
  if (map.eoh != null) cols.c_eoh = _f64(_col(collar, map.eoh, 'collar eoh'));
  const extra = { count: n, method: map.method ?? 'minimumCurvature', dip_convention: map.dip_convention ?? 'auto', holes: holeNames.length };
  if (holeNames.length <= 5000) extra.hole_names = holeNames;
  const { names, labels } = _valueAndCat(intervals, map.value, map.category, n, cols, extra, 'blocks');
  // a generous bbox from collars + total depth; the desurvey in the view gives the exact one
  let reach = 0;
  for (let i = 0; i < n; i++) if (cols.i_to[i] > reach) reach = cols.i_to[i];
  const rx = _range(cx), ry = _range(cy), rz = _range(cz);
  extra.bbox = [rx[0] - reach, ry[0] - reach, rz[0] - reach, rx[1] + reach, ry[1] + reach, rz[1]];
  const lay = new Layer('drillholes', cols, extra, labels, _finishStyle(style, names, !!cols.cat));
  lay.hole_names = holeNames;
  return lay;
}

// mesh(vertices, triangles, { color: '#9aa4ab', opacity, ...style }) — context: scenery
export function mesh(vertices, triangles, opts) {
  const { style } = _split('mesh', opts);
  const flat = (a, what) => {
    if (!isArrayLike(a) || !a.length) throw new Error(`condenser: mesh needs ${what}`);
    if (isArrayLike(a[0])) { const o = new Float64Array(a.length * 3); for (let i = 0; i < a.length; i++) { o[i * 3] = a[i][0]; o[i * 3 + 1] = a[i][1]; o[i * 3 + 2] = a[i][2]; } return o; }
    return a;
  };
  const v = _f64(flat(vertices, 'vertices AND triangles'));
  const t = flat(triangles, 'vertices AND triangles');
  const nv = v.length / 3;
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < t.length; i++) { if (t[i] < tmin) tmin = t[i]; if (t[i] > tmax) tmax = t[i]; }
  if (tmin < 0 || tmax >= nv) throw new Error(`condenser: triangle indices run ${tmin}..${tmax} but there are only ${nv} vertices`);
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i++) {
    const a = i % 3, x = v[i];
    if (x - x !== 0) throw new Error('condenser: mesh found non-finite vertices');
    if (x < mins[a]) mins[a] = x;
    if (x > maxs[a]) maxs[a] = x;
  }
  const origin = [0, 1, 2].map((a) => (mins[a] + maxs[a]) / 2);
  const verts = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) verts[i] = v[i] - origin[i % 3];
  const cols = { verts, tris: t instanceof Uint32Array ? t : Uint32Array.from(t) };
  const extra = { count: t.length / 3, vertex_count: nv, pos_origin: origin, bbox: [...mins, ...maxs] };
  if (style.color === undefined) style.color = '#9aa4ab';
  return new Layer('mesh', cols, extra, null, style);
}

// surface(data, { origin: [x0, y0], pitch, drape, nodata, flat_z, stride, nx, ny, ...style })
// data: rows (row 0 the NORTHERNMOST), or flat row-major with nx and ny
export function surface(data, opts) {
  const { map, style } = _split('surface', opts);
  let g, nx, ny;
  if (isArrayLike(data) && isArrayLike(data[0])) {
    ny = data.length; nx = data[0].length; g = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) g[r * nx + c] = data[r][c] == null ? NaN : data[r][c];
  } else {
    nx = map.nx; ny = map.ny;
    if (!(nx > 0 && ny > 0)) throw new Error('condenser: surface data is flat — give nx and ny, or pass rows');
    if (data.length !== nx * ny) throw new Error(`condenser: surface data has ${data.length} values, nx × ny is ${nx * ny}`);
    g = data instanceof Float32Array ? data : Float32Array.from(data, (v) => (v == null ? NaN : v));
  }
  const pitch = map.pitch ?? 1.0;
  const [dx, dy] = Array.isArray(pitch) ? [+pitch[0], +pitch[1]] : [+pitch, +pitch];
  if (!(dx > 0 && dy > 0)) throw new Error('condenser: surface pitch must be positive');
  const [x0, y0] = map.origin ?? [0, 0];
  const nodata = map.nodata;
  let zlo = Infinity, zhi = -Infinity, valid = 0;
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    if (v - v !== 0 || (nodata != null && v === Math.fround(nodata))) continue;
    valid++; if (v < zlo) zlo = v; if (v > zhi) zhi = v;
  }
  if (!valid) throw new Error('condenser: the surface grid has no valid values');
  if (map.flat_z != null) zlo = zhi = +map.flat_z;
  const cols = { grid: g };
  const extra = { count: valid, nx, ny, x0: +x0, y0: +y0, dx, dy, bbox: [+x0, y0 - (ny - 1) * dy, zlo, x0 + (nx - 1) * dx, +y0, zhi] };
  if (nodata != null) extra.nodata = +nodata;
  if (map.flat_z != null) extra.flat_z = +map.flat_z;
  if (map.stride != null) extra.stride = Math.max(1, map.stride | 0);
  let vr = [zlo, zhi];
  if (map.drape != null) {
    let d;
    if (isArrayLike(map.drape[0])) { d = new Float32Array(nx * ny); for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) d[r * nx + c] = map.drape[r][c]; }
    else d = map.drape instanceof Float32Array ? map.drape : Float32Array.from(map.drape);
    if (d.length !== nx * ny) throw new Error(`condenser: drape has ${d.length} values, the surface grid ${nx * ny}`);
    cols.drape = d; extra.drape = true;
    vr = _range(d) || [0, 0];
  }
  extra.value_range = vr;
  if (style.color === undefined) style.color = 'value';
  return new Layer('surface', cols, extra, null, style);
}

// ── streams: rows that arrive over time ─────────────────────────────────────────────────
// The view renders a streamed layer progressively as chunks land, but it needs the SHAPE
// before the first row: the capacity, the lattice (blocks) or bbox (points), the value
// range and the category labels — what cd.open's discovery pass reads from a file. A page
// that has no file declares them:
//
//   const m = blocks.stream({ axes: [[x0, dx, nx], [y0, dy, ny], [z0, dz, nz]], capacity: 2e6,
//                             value_range: [0, 70], categories: ['ox', 'fr'] }, { name: 'model' });
//   view(el, [m]);  m.append({ x, y, z, value, category });  …  m.end();
function _streamLayer(kind, decl, opts) {
  const d = decl || {};
  _checkKeys(`${kind}.stream()`, d, ['axes', 'bbox', 'capacity', 'value_range', 'categories']);
  const { style } = _split(kind, opts);
  const cap = d.capacity | 0;
  if (!(cap > 0)) throw new Error(`condenser: ${kind}.stream needs a capacity (the most rows that will arrive)`);
  const extra = { count: cap, streamed: true };
  if (kind === 'blocks') {
    if (!Array.isArray(d.axes) || d.axes.length !== 3) throw new Error('condenser: blocks.stream needs axes: [[origin, pitch, count] × 3]');
    for (const a of d.axes) if (!(a[1] > 0) || !(a[2] >= 1) || a[2] > U16MAX) throw new Error('condenser: each axis is [origin, pitch > 0, 1 ≤ count ≤ 65535]');
    extra.axes = d.axes.map((a) => [+a[0], +a[1], a[2] | 0]);
    extra.pos = 'ijk';
    extra.bbox = [0, 1, 2].map((a) => extra.axes[a][0] - extra.axes[a][1] / 2).concat([0, 1, 2].map((a) => extra.axes[a][0] + (extra.axes[a][2] - 0.5) * extra.axes[a][1]));
  } else {
    if (!Array.isArray(d.bbox) || d.bbox.length !== 6) throw new Error('condenser: points.stream needs bbox: [xmin, ymin, zmin, xmax, ymax, zmax]');
    extra.bbox = d.bbox.map(Number);
    extra.pos_origin = [0, 1, 2].map((a) => (extra.bbox[a] + extra.bbox[a + 3]) / 2);
  }
  if (d.value_range) extra.value_range = [+d.value_range[0], +d.value_range[1]];
  const labels = d.categories ? d.categories.map(String) : [];
  if (labels.length > 256) throw new Error('condenser: at most 256 categories in a stream');
  if (labels.length) { extra.cat_n = labels.length; extra.cat_labels = labels; }
  const lay = new Layer(kind, {}, extra, labels, _finishStyle(style, d.value_range ? ['value'] : [], !!labels.length));
  lay._stream = { got: 0, ended: false, catIndex: new Map(labels.map((l, k) => [l, k])) };
  return lay;
}
points.stream = (decl, opts) => _streamLayer('points', decl, opts);
blocks.stream = (decl, opts) => _streamLayer('blocks', decl, opts);

// one appended batch → the wire v3 chunk the view assembles (the Python _stream_messages)
function _chunkOf(lay, rows) {
  const e = lay.extra, st = lay._stream;
  const xa = _col(rows, 'x', 'x');
  const n = xa.length;
  const xf = _f64(xa), yf = _f64(_col(rows, 'y', 'y', n)), zf = _f64(_col(rows, 'z', 'z', n));
  const names = [], bufs = [];
  if (lay.kind === 'points') {
    const o = e.pos_origin;
    for (const [nm, arr, oo] of [['x', xf, o[0]], ['y', yf, o[1]], ['z', zf, o[2]]]) {
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = arr[i] - oo;
      names.push(nm); bufs.push(f);
    }
  } else {
    for (const [nm, arr, ax] of [['i', xf, e.axes[0]], ['j', yf, e.axes[1]], ['k', zf, e.axes[2]]]) {
      const q = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        const c = Math.round((arr[i] - ax[0]) / ax[1]);
        if (!(c >= 0 && c < ax[2])) throw new Error(`condenser: append: a block at ${nm}=${arr[i]} is outside the declared axes`);
        q[i] = c;
      }
      names.push(nm); bufs.push(q);
    }
  }
  const v = _lookup(rows, 'value');
  if (v != null && e.value_range) { names.push('value'); bufs.push(Float32Array.from(_f64(_col(rows, 'value', 'value', n)))); }
  const c = _lookup(rows, 'category');
  if (c != null && e.cat_n) {
    const cc = _col(rows, 'category', 'category', n), u = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = st.catIndex.get(String(cc[i]));
      if (k === undefined) throw new Error(`condenser: append: category ${JSON.stringify(cc[i])} was not declared`);
      u[i] = k;
    }
    names.push('cat'); bufs.push(u);
  }
  return { n, names, bufs };
}

// ── the view ────────────────────────────────────────────────────────────────────────────
function _payload(layers) {
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (const L of layers) {
    const b = L.extra.bbox;
    if (!b) continue;
    for (let a = 0; a < 3; a++) { if (b[a] < mins[a]) mins[a] = b[a]; if (b[a + 3] > maxs[a]) maxs[a] = b[a + 3]; }
  }
  const auto = !mins.every(Number.isFinite);
  const frame = auto ? [0.5, 0.5, 0.5] : mins.map((m, a) => (m + maxs[a]) / 2);
  return { frame, frame_auto: auto, layers: layers.map((L) => ({ ...L.extra, kind: L.kind, cols: { ...L.cols } })) };
}

const EVENTS = ['pick', 'hover', 'select', 'measure', 'section', 'camera', 'style', 'lock', 'view'];

function _checkLock(where, v) {
  if (normLock(v)) return;
  throw new TypeError(`condenser: ${where}: lock ${JSON.stringify(v)} — use ${LOCK_NAMES.map((n) => `'${n}'`).join(', ')} or { azimuth, plunge }`);
}

// view(el, layers, options) → the handle
export function view(el, layers, opts) {
  if (!el || typeof el.appendChild !== 'function') throw new TypeError('condenser: view(el, layers, options) — el must be a DOM element');
  const list = (Array.isArray(layers) ? layers : [layers]).flat().filter(Boolean);
  for (const L of list) if (!(L instanceof Layer)) throw new TypeError('condenser: view() takes layers made by points / blocks / drillholes / mesh / surface');
  const o = opts || {};
  _checkKeys('view()', o, Object.keys(VIEW_DEFAULTS));
  if (o.chrome) _checkKeys('view({chrome})', o.chrome, CHROME_KEYS);
  if ('lock' in o) _checkLock('view()', o.lock);
  list.forEach((L, i) => { if (!L.style.name) L.style.name = `${L.kind}-${i + 1}`; });

  const store = createStore({
    ...VIEW_DEFAULTS, ...o,
    _payload: _payload(list), _styles: list.map((L) => ({ ...L.style })),
    _fit: 0, _view: {}, _sel_rows: null, _clear_sel: 0, measurement: {}, selection: {},
    _snapshot_req: 0, snapshot_png: null, _file_info: {}, _rect: null,
  });
  const subs = new Map(EVENTS.map((e) => [e, new Set()]));
  const fire = (ev, data) => { for (const fn of Array.from(subs.get(ev) || [])) { try { fn(data); } catch (e) { console.error(`condenser: a '${ev}' handler threw`, e); } } };
  store.notify = fire;

  // streams: every load of the view announces itself with an epoch ('ready'), and a
  // chunk is only taken with that epoch. A load (the first, or after add / remove) starts
  // each stream from its first row, so every message is kept and replayed on 'ready';
  // until then appended rows simply wait in the log.
  let epoch = null;
  const sentLog = new Map();                                // layer object → [[content, bufs]]
  store.on('send', (c) => {
    if (!c || c.type !== 'ready') return;
    epoch = c.epoch;
    list.forEach((L, li) => { for (const [m, b] of sentLog.get(L) || []) store.emit({ ...m, epoch, layer: li }, b); });
  });
  const sendStream = (L, content, bufs) => {
    if (!sentLog.has(L)) sentLog.set(L, []);
    sentLog.get(L).push([content, bufs]);
    const li = list.indexOf(L);
    if (li >= 0 && epoch != null) store.emit({ ...content, epoch, layer: li }, bufs);
  };

  store.on('change:_styles', () => {                       // the toolbar edits styles: mirror them
    const st = store.get('_styles') || [];
    list.forEach((L, i) => { if (st[i]) L.style = { ...STYLE_DEFAULTS, ...st[i] }; });
    fire('style', st);
  });
  store.on('change:section', () => fire('section', store.get('section')));
  store.on('change:camera', () => fire('camera', store.get('camera')));
  store.on('change:lock', () => fire('lock', normLock(store.get('lock')) || 'free'));

  const pushStyles = () => store.set('_styles', list.map((L) => ({ ...L.style })));
  const repack = () => { epoch = null; store.set('_payload', _payload(list)); pushStyles(); };
  const index = (key) => {
    if (typeof key === 'number') { if (key >= 0 && key < list.length) return key; }
    else { const i = list.findIndex((L) => L.style.name === key); if (i >= 0) return i; }
    throw new Error(`condenser: no layer ${JSON.stringify(key)}`);
  };

  // per-layer handles (the Python Layer's live traits)
  const handles = new WeakMap();
  const handleOf = (L) => {
    if (handles.has(L)) return handles.get(L);
    const h = {
      get name() { return L.style.name; }, get kind() { return L.kind; }, get count() { return L.count; },
      get categories() { return L.categories.slice(); }, get hole_names() { return L.hole_names; },
      get(key) { return L.style[key]; },
      style() { return { ...L.style }; },
      set(style) {
        _checkKeys(`layer('${L.style.name}').set()`, style, Object.keys(STYLE_DEFAULTS));
        L.style = { ...L.style, ...style };
        pushStyles();
      },
      // rows the rectangle / lasso selected on this layer
      get selected_rows() { return selRows().get(list.indexOf(L)) || new Uint32Array(0); },
      append(rows) {
        if (!L._stream) throw new Error(`condenser: layer '${L.style.name}' is not a stream — make it with ${L.kind}.stream({...}) to append rows`);
        if (L._stream.ended) throw new Error(`condenser: layer '${L.style.name}' has ended`);
        const { n, names, bufs } = _chunkOf(L, rows);
        if (L._stream.got + n > L.count) throw new Error(`condenser: append: ${L._stream.got + n} rows exceed the declared capacity ${L.count}`);
        sendStream(L, { type: 'chunk', seq: L._stream.seq = (L._stream.seq || 0) + 1, rows: n, cols: names }, bufs.map((b) => b.buffer.byteLength === b.byteLength ? b.buffer : b.slice().buffer));
        L._stream.got += n;
      },
      end() {
        if (!L._stream || L._stream.ended) return;
        L._stream.ended = true;
        sendStream(L, { type: 'eof', rows_total: L._stream.got }, []);
      },
    };
    handles.set(L, h);
    return h;
  };

  // the packed region selection → layer index → rows
  const selRows = () => {
    const out = new Map();
    const dv = store.get('_sel_rows');
    if (!dv || dv.byteLength < 4) return out;
    const n = dv.getUint32(0, true);
    let at = 4;
    for (let q = 0; q < n && at + 8 <= dv.byteLength; q++) {
      const li = dv.getUint32(at, true), count = dv.getUint32(at + 4, true);
      at += 8;
      const rows = new Uint32Array(count);
      for (let r = 0; r < count; r++) rows[r] = dv.getUint32(at + r * 4, true);
      at += count * 4;
      out.set(li, rows);
    }
    return out;
  };

  const cleanup = mountView(el, store);

  const handle = {
    get layers() { return list.map(handleOf); },
    layer(key) { return handleOf(list[index(key)]); },
    // view options (height, section, background, z_exaggeration, toolbar, …), or a state()
    set(options) {
      const s = options || {};
      if (s.layers) {
        for (const [name, st] of Object.entries(s.layers)) { const i = list.findIndex((L) => L.style.name === name); if (i >= 0) list[i].style = { ...list[i].style, ...st }; }
        pushStyles();
      }
      const rest = { ...s }; delete rest.layers;
      // { view: { rect: { u0, u1, v0, v1 } } }: frame that world rectangle (a locked view)
      if (rest.view) {
        const r = rest.view.rect;
        if (!r || !['u0', 'u1', 'v0', 'v1'].every((k) => Number.isFinite(+r[k]))) throw new TypeError('condenser: set({view: {rect: {u0, u1, v0, v1}}}) — four numbers, world coordinates along the screen axes');
        store.set('_rect', { rect: { u0: +r.u0, u1: +r.u1, v0: +r.v0, v1: +r.v1 }, n: ((store.get('_rect') || {}).n | 0) + 1 });
        delete rest.view;
      }
      _checkKeys('set()', rest, Object.keys(VIEW_DEFAULTS));
      if ('lock' in rest) _checkLock('set()', rest.lock);
      if (rest.chrome) _checkKeys('set({chrome})', rest.chrome, CHROME_KEYS);
      for (const [k, v] of Object.entries(rest)) if (k in VIEW_DEFAULTS) store.set(k, v);
      if (rest.theme === 'css' || rest.theme === 'auto') store.set('_theme_n', (store.get('_theme_n') | 0) + 1);   // set again = read the page again
      return handle;
    },
    get(key) { return store.get(key); },
    // look('plan' | 'north' | 'south' | 'east' | 'west' | 'iso[-ne|-nw|-se|-sw]' | 'three-quarter[-…]' | '3/4[-…]', {ortho}) · look({ azimuth, plunge, distance, target, ortho })
    look(nameOrCam, extra) {
      if (nameOrCam && typeof nameOrCam === 'object') {
        _checkKeys('look()', nameOrCam, ['azimuth', 'plunge', 'distance', 'target', 'ortho']);
        const cam = { ...(store.get('camera') || {}) };
        for (const k of ['azimuth', 'plunge', 'distance', 'ortho']) if (nameOrCam[k] != null) cam[k] = k === 'ortho' ? !!nameOrCam[k] : +nameOrCam[k];
        if (nameOrCam.target != null) cam.target = Array.from(nameOrCam.target, Number);
        cam.n = (cam.n | 0) + 1;
        store.set('camera', cam);
      } else {
        const v = { name: nameOrCam || 'three-quarter', n: ((store.get('_view') || {}).n | 0) + 1 };
        if (extra && extra.ortho != null) v.ortho = !!extra.ortho;
        store.set('_view', v);
      }
      return handle;
    },
    // cut('z', 470, 10) · cut({ normal: [nx, ny, nz], position, thickness }) · cut() clears
    cut(axisOrSpec, position, thickness = 10) {
      if (axisOrSpec == null) store.set('section', null);
      else if (typeof axisOrSpec === 'object') store.set('section', { thickness: 10, position: 0, ...axisOrSpec });
      else store.set('section', { axis: axisOrSpec, position: +position || 0, thickness: +thickness });
      return handle;
    },
    fit() { store.set('_fit', (store.get('_fit') | 0) + 1); return handle; },
    clear_selection() { store.set('_clear_sel', (store.get('_clear_sel') | 0) + 1); return handle; },
    get selection() { return store.get('selection') || {}; },
    get selected_rows() { const m = selRows(), out = {}; for (const [li, r] of m) if (list[li]) out[list[li].style.name] = r; return out; },
    get measurement() { return store.get('measurement') || {}; },
    get camera() { return store.get('camera') || {}; },
    // the figure as PNG (GL + chrome composited): resolves once the view has drawn it
    snapshot() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { store.off('change:snapshot_png', got); reject(new Error('condenser: snapshot timed out')); }, 10000);
        const got = () => {
          clearTimeout(timer); store.off('change:snapshot_png', got);
          const dv = store.get('snapshot_png');
          resolve(new Blob([dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)], { type: 'image/png' }));
        };
        store.on('change:snapshot_png', got);
        store.set('_snapshot_req', (store.get('_snapshot_req') | 0) + 1);
      });
    },
    add(layer) {
      if (!(layer instanceof Layer)) throw new TypeError('condenser: add() takes a layer');
      if (!layer.style.name) layer.style.name = `${layer.kind}-${list.length + 1}`;
      list.push(layer); repack();
      return handleOf(layer);
    },
    remove(key) { const L = list.splice(index(key), 1)[0]; sentLog.delete(L); repack(); return handle; },
    // everything needed to put the view back as it is: JSON
    state() {
      const out = {};
      for (const k of Object.keys(VIEW_DEFAULTS)) out[k] = store.get(k);
      out.layers = Object.fromEntries(list.map((L) => [L.style.name, { ...L.style }]));
      return JSON.parse(JSON.stringify(out));
    },
    on(ev, fn) { if (!subs.has(ev)) throw new Error(`condenser: no event '${ev}' (${EVENTS.join(', ')})`); subs.get(ev).add(fn); return handle; },
    off(ev, fn) { const s = subs.get(ev); if (s) s.delete(fn); return handle; },
    destroy() { cleanup(); for (const s of subs.values()) s.clear(); },
    // the store, for hosts that need the raw state (and the tests)
    // the chrome: plugins over the scene — add({id, slot, mount | measure + draw, …}),
    // remove(id), has(id), list(). See API.md, "Chrome plugins".
    chrome: cleanup.chrome || { add() { return null; }, remove() { return false; }, has: () => false, list: () => [] },
    // the @gcu/plot Axes drawn around a locked view: add plot items in world coordinates
    // (v.axes.scatter(e, n), v.axes.add_geometry(licence), v.axes.contour(…)); they draw in
    // locked orthographic views, over the scene and under the frame
    get axes() { return cleanup.axes ? cleanup.axes() : null; },
    _store: store,
  };
  return handle;
}

export { createStore, mountView };
