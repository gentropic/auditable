import { _warn } from './opts.js';
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
// - 'auto' — `style.use('auto')`, or `theme: 'auto'` for one figure — follows the PAGE: the
//   page's tokens and colours as themeFromCSS reads them, so a light page gets a light chart.
//   With no DOM (a worker, Node) it is the dark default. Resolved when a figure is made, as any
//   style: re-make (or fig.set_theme('auto')) after the page switches mode.
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

// the default theme as it stands now, for a figure being made
export function _snapshotStyle() {
  if (_style._auto) return _autoTheme();
  return { ..._style, cycle: _style.cycle.slice() };
}

// matplotlib's style.use: a name or a list of names. The light matplotlib styles are the
// white `paper` theme, 'dark_background' is `dark`, and dark / light / paper are taken as
// they are. Anything else warns and changes nothing.
export function setStyle(name) {
  const names = Array.isArray(name) ? name : [name];
  for (const n of names) {
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

export { themeFromCSS };

// fonts: the theme's monospace stack at a size relative to font_size
export const _font = (th, d = 0, bold = false) => `${bold ? 'bold ' : ''}${(th.font_size || 11) + d}px ${th.mono}`;

// A text's width for LAYOUT: 0.6 em per character, what every monospace face advances (and
// what the recording context answers), so a figure lays out identically live, recorded, in
// a worker or in Node — and a draw list replays onto exactly the pixels the live draw made.
export const _textW = (font, s) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return String(s).length * 0.6 * (m ? +m[1] : 10);
};
