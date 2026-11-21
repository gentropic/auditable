import { _warn, _rcStore, rcParams } from './opts.js';
import { resolveTheme, themeFromCSS, THEMES, isLight } from '../../theme/src/theme.js';

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
// - 'auto' — THE DEFAULT ON A PAGE; also `style.use('auto')`, or `theme: 'auto'` — follows the PAGE: the
//   page's tokens and colours as themeFromCSS reads them, so a light page gets a light chart.
//   With no DOM (a worker, Node) it is the dark default. Resolved when a figure is made, as any
//   style: re-make (or fig.set_theme('auto')) after the page switches mode.
// - Per-axes overrides (`_bgcolor`, `_textColor`, `_gridColor`, `_frameColor`) still win, for
//   callers that dress one cell of a grid.
//
// Notebooks loaded from a .ipynb through @gcu/ipynb get an automatic
// `plt.style.use('default')` after their `import matplotlib.pyplot`, so they render light as
// their authors saw them in Jupyter. Native auditable cells follow the notebook's own theme ('auto').
//
// Text: plot draws every label in the theme's MONOSPACE stack (`mono`), at `font_size`
// (ticks one px smaller, titles two larger). Monospace is what keeps the draw list the same
// on every host: the recording context measures text as 0.6 em per character, which is
// right for any monospace face and wrong for a proportional one.

const _LIGHT_STYLES = ['default', 'classic', 'matplotlib', 'seaborn', 'seaborn-whitegrid', 'seaborn-v0_8', 'seaborn-v0_8-whitegrid', 'ggplot', 'bmh', 'fast', 'grayscale'];

// the default theme a new figure copies (style.use changes it)
export const _style = resolveTheme('dark');

// a theme, as a figure takes it: names and partials resolved over the default theme's base.
// plot 0.2's own keys (bgcolor, textColor, …) are still read, mapped onto the shared ones.
const _LEGACY = { bgcolor: 'background', textColor: 'foreground', gridColor: 'grid', frameColor: 'frame', figureFacecolor: 'figure', legendBg: 'panel', legendBorder: 'panel_border', refColor: 'muted' };
// the page's theme ('auto'): its tokens and computed colours, on <body> (custom properties
// set on :root reach it); dark where there is no page
export function _autoTheme() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return resolveTheme('dark');
  const el = document.body || document.documentElement;
  return el ? themeFromCSS(el) : resolveTheme('dark');
}
export function _resolve(t, strict) {
  if (t == null) return _snapshotStyle();
  if (typeof t === 'string' && t.toLowerCase() === 'auto') return _autoTheme();
  if (typeof t === 'string') {
    const key = _LIGHT_STYLES.includes(t.toLowerCase()) ? 'paper' : t.toLowerCase() === 'dark_background' ? 'dark' : t;
    return resolveTheme(key, (m) => _warn(`theme.${t}`, `plot: ${m}`, strict));
  }
  const o = {};
  for (const [k, v] of Object.entries(t)) o[_LEGACY[k] || k] = v;
  if (!o.base && !o.background) o.base = _style._auto ? (isLight(_autoTheme().background) ? 'light' : 'dark') : _style._name || 'dark';
  return resolveTheme(o, (m) => _warn(`theme.${m}`, `plot: ${m}`, strict));
}

// the rcParams keys that are theme keys: set, they dress every figure made after (over the
// style — matplotlib's order: a style sets rcParams, a later rcParams assignment wins), and a
// style.use() puts them back to the style's. Unset (null), the theme's value stands.
export const THEME_RC = {
  'axes.facecolor': 'background', 'figure.facecolor': 'figure', 'axes.edgecolor': 'frame',
  'text.color': 'foreground', 'grid.color': 'grid', 'axes.prop_cycle': 'cycle', 'image.cmap': 'ramp',
  'font.size': 'font_size', 'font.monospace': 'mono', 'legend.facecolor': 'panel', 'legend.edgecolor': 'panel_border',
};
function _rcOverlay(th) {
  for (const [k, tk] of Object.entries(THEME_RC)) {
    const v = _rcStore[k];
    if (v == null) continue;
    if (tk === 'cycle') th.cycle = v.slice();
    else if (tk === 'mono') th.mono = _familyStack(v, th.mono);
    else th[tk] = v;
  }
  // font.family: a monospace face goes at the front of the mono stack (the face plot draws in);
  // a proportional family dresses the sans stack (condenser's chrome) only
  const fam = _rcStore['font.family'];
  if (fam != null) {
    const names = [].concat(fam).map(String);
    if (names.some(_isMonoName)) th.mono = _familyStack(names.filter((n) => n !== 'monospace'), th.mono);
    else th.font = _familyStack(names, th.font);
  }
  return th;
}
const _GENERIC = ['monospace', 'sans-serif', 'serif', 'cursive', 'fantasy', 'system-ui'];
export const _isMonoName = (n) => /mono|courier|consolas|menlo|code|typewriter|fixed/i.test(n);
// font names in front of a CSS stack (quoted unless a generic family)
function _familyStack(names, stack) {
  const front = [].concat(names).map(String).filter(Boolean).map((n) => (_GENERIC.includes(n) || /^['"]/.test(n) ? n : `'${n}'`));
  return front.length ? `${front.join(', ')}, ${stack}` : stack;
}

// the default theme as it stands now, for a figure being made (rcParams over the style)
export function _snapshotStyle() {
  if (_style._auto) return _rcOverlay(_autoTheme());
  return _rcOverlay({ ..._style, cycle: _style.cycle.slice() });
}

// the style as it stands (rc_context / style.context put it back after)
export function _styleSnapshot() { return { ..._style, cycle: _style.cycle.slice() }; }
export function _styleRestore(s) { for (const k of Object.keys(_style)) delete _style[k]; Object.assign(_style, s); }

// matplotlib's style.use: a name or a list of names. The light matplotlib styles are the
// white `paper` theme, 'dark_background' is `dark`, and dark / light / paper are taken as
// they are. Anything else warns and changes nothing.
export function setStyle(name) {
  const names = Array.isArray(name) ? name : [name];
  for (const n of names) {
    // a dict of rcParams (matplotlib's style.use({...})): applied as rcParams
    if (n instanceof Map || (n && typeof n === 'object')) { rcParams.update(n); continue; }
    // a named style puts the theme-backed rcParams back to it
    for (const k of Object.keys(THEME_RC)) _rcStore[k] = null;
    _rcStore['font.family'] = null;
    const key = String(n || '').toLowerCase();
    if (key === 'auto') {
      // follow the page: each new figure reads it (the dark values stay for no-DOM hosts)
      for (const k of Object.keys(_style)) delete _style[k];
      Object.assign(_style, resolveTheme('dark'), { _name: 'auto', _auto: true });
      continue;
    }
    const theme = _LIGHT_STYLES.includes(key) ? 'paper' : key === 'dark_background' ? 'dark' : THEMES[key] ? key : null;
    if (!theme) {
      _warn('style.' + key, `style.use('${n}') is not a style plot knows; use 'default' (white), 'dark_background', 'auto' (the page's), or a theme: ${Object.keys(THEMES).join(', ')}`);
      continue;
    }
    for (const k of Object.keys(_style)) delete _style[k];
    Object.assign(_style, resolveTheme(theme), { _name: theme });
  }
}
_style._name = 'dark';
// On a page the default is 'auto' — a chart follows the page it's drawn on (a light page, a light
// chart; auditable's notebooks in either mode). Off a page (a worker, Node) it stays dark, so a
// draw list made there is the same in every host.
if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') { _style._name = 'auto'; _style._auto = true; }
// the style a fresh page starts with (rcdefaults() goes back to it)
export const _DEFAULT_STYLE = _style._name;

export { themeFromCSS };

// matplotlib's named font sizes, as factors of font.size
const _SIZE_FACTORS = { 'xx-small': 0.579, 'x-small': 0.694, small: 0.833, medium: 1, large: 1.2, 'x-large': 1.44, 'xx-large': 1.728, larger: 1.2, smaller: 0.833 };
// a fontsize (px, a name, or null = dflt) → px
export function _sizePx(v, fs, dflt) {
  if (v == null) return dflt;
  if (typeof v === 'number') return v > 0 ? v : dflt;
  if (_SIZE_FACTORS[v]) return Math.round(fs * _SIZE_FACTORS[v] * 10) / 10;
  const n = +v;
  return n > 0 ? n : dflt;
}
export const _isBold = (w) => ['bold', 'heavy', 'black', 'semibold', 'demibold', 'demi', 'extra bold', 'ultrabold'].includes(w) || +w >= 600;
export const _fontAt = (th, px, bold = false) => `${bold ? 'bold ' : ''}${px}px ${th.mono}`;

// fonts: the theme's monospace stack at a size relative to font_size
export const _font = (th, d = 0, bold = false) => `${bold ? 'bold ' : ''}${(th.font_size || 11) + d}px ${th.mono}`;

// A text's width for LAYOUT: 0.6 em per character, what every monospace face advances (and
// what the recording context answers), so a figure lays out identically live, recorded, in
// a worker or in Node — and a draw list replays onto exactly the pixels the live draw made.
export const _textW = (font, s) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return String(s).length * 0.6 * (m ? +m[1] : 10);
};
