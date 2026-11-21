import { _warn } from './opts.js';
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
export const CMAP_NAMES = () => Object.keys(_cmaps).flatMap((k) => (k.endsWith('_r') ? [k] : [k, `${k}_r`]));


// a name, a function (t ∈ [0, 1] → colour), a list of colours (a listed map), or a
// ListedColormap / colormap object. An unknown name warns and draws viridis.
export function getCmap(name) {
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
export class ListedColormap {
  constructor(colors, name = 'from_list') {
    this.colors = Array.from(colors, (c) => _cssColor(c));
    this.name = name;
    this.N = this.colors.length;
    this._fn = _listed(this.colors);
  }
  reversed() { return new ListedColormap(this.colors.slice().reverse(), this.name + '_r'); }
}
// LinearSegmentedColormap.from_list(name, colors): an even ramp through the colours
export const LinearSegmentedColormap = {
  from_list(name, colors) {
    const stops = colors.map((c) => { const b = _colorBytes(_cssColor(Array.isArray(c) ? c[1] : c)); return b ? [b[0], b[1], b[2]] : [0, 0, 0]; });
    return { name, N: 256, _fn: _lerpCmap(stops) };
  },
};

export function cmapRgb(name, t) {
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
export function _colorBytes(c) {
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
export function _cssColor(c) {
  if (typeof c === 'string') { const n = _NAMED[c] || _NAMED[c.toLowerCase && c.toLowerCase()]; return n || c; }
  const b = _colorBytes(c);
  return b ? `rgba(${b[0]},${b[1]},${b[2]},${+(b[3] / 255).toFixed(4)})` : c;
}

// A colour map sampled into 256 RGBA entries, once per map (cached on the function).
// t in [0, 1] → entry Math.min(255, (t * 256) | 0). null when the map returns a colour
// _colorBytes can't read (a user function returning, say, 'hsl(…)'): callers then fall back
// to calling the map per value.
const _lutCache = new WeakMap();
export function _cmapLut(cmap) {
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

export function renderColorbar(ctx, x, y, w, h, cmap, vmin, vmax, opts) {
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
