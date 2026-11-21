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

export const THEME_KEYS = ['background', 'figure', 'foreground', 'muted', 'grid', 'frame', 'panel', 'panel_border',
  'accent', 'selection', 'halo', 'cycle', 'ramp', 'font', 'mono', 'font_size'];

export const THEMES = {
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
// where themeFromCSS looks: per key, the custom properties to try, the first one set winning —
// auditable's own --au-* tokens first, then the spellings design systems commonly use. A host
// whose tokens are named otherwise passes a map ({ background: '--page-bg', … }): its keys
// replace these, the rest stay.
export const CSS_MAP = {
  background: ['--au-surface', '--bg-primary', '--background', '--bg', '--color-background', '--color-bg', '--surface', '--bg-color'],
  foreground: ['--au-fg', '--text-primary', '--foreground', '--fg', '--text', '--color-text', '--text-color', '--color-foreground'],
  muted: ['--au-fg-soft', '--text-secondary', '--text-muted', '--muted-foreground', '--muted', '--fg-muted'],
  grid: ['--au-border-soft', '--border-subtle', '--border-soft', '--grid'],
  frame: ['--au-rule', '--border', '--border-color', '--color-border', '--rule'],
  panel: ['--au-surface-raised', '--bg-secondary', '--surface-raised', '--card', '--panel', '--popover'],
  panel_border: ['--au-border', '--border', '--border-color', '--color-border'],
  accent: ['--au-action', '--accent', '--primary', '--color-accent', '--color-primary'],
  selection: ['--au-selected', '--selection', '--highlight', '--ring'],
  font: ['--au-font-sans', '--font-sans', '--font-family', '--font'],
  mono: ['--au-font-mono', '--font-mono', '--mono'],
  figure: ['--au-figure'],
};
// the categorical cycle from numbered tokens: --series-1, --series-2, … (the first prefix with a 1)
export const CSS_CYCLE = ['--au-series-', '--series-', '--chart-', '--chart-color-', '--color-series-'];

// a name, a partial theme ({ base: 'light', accent: '#c00' }) or nothing → a full theme.
// Unknown names fall back to dark; `onWarn` hears about it.
export function resolveTheme(t, onWarn) {
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

// read a theme from CSS custom properties on `el` (a host page's tokens, its light or dark mode):
// each key from the first of its properties that is set (CSS_MAP, or `map` merged over it — a
// property name or a list of them per key), the cycle from numbered series tokens. Unset keys
// keep the base theme's. The base is light or dark by the background found — and when no
// background property is set, by the element's own computed background (walking up past
// transparent ones) and text colour, so a light page never gets a dark chart.
export function themeFromCSS(el, map) {
  const cs = typeof getComputedStyle === 'function' && el ? getComputedStyle(el) : null;
  const out = {};
  if (!cs) return resolveTheme(out);
  const m = { ...CSS_MAP, ...(map || {}) };
  const read = (p) => cs.getPropertyValue(p).trim();
  for (const [k, props] of Object.entries(m)) {
    for (const p of Array.isArray(props) ? props : [props]) { const v = p && read(p); if (v) { out[k] = v; break; } }
  }
  for (const pre of CSS_CYCLE) {
    if (!read(pre + '1')) continue;
    const cyc = [];
    for (let i = 1; i <= 12; i++) { const v = read(pre + i); if (!v) break; cyc.push(v); }
    if (cyc.length >= 2) out.cycle = cyc;
    break;
  }
  // the page's own colours: decide light or dark when no token says (or says it in a form
  // that can't be read, e.g. oklch), and fill background / foreground when no token gave them
  const pageBg = _computedBackground(el), pageFg = cs.color;
  if (!out.background && pageBg) out.background = pageBg;
  if (!out.foreground && pageFg && parseColor(pageFg)) out.foreground = pageFg;
  const bgForBase = parseColor(out.background) ? out.background : pageBg;
  if (bgForBase) out.base = isLight(bgForBase) ? 'light' : 'dark';
  // a chart dressed by the page sits on the page: the figure's surface is the page's own
  // (transparent) unless a token says otherwise; its plot area takes the background found
  if (!out.figure) out.figure = 'transparent';
  return resolveTheme(out);
}

// the first opaque computed background-color from el up to the root
function _computedBackground(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const v = getComputedStyle(e).backgroundColor;
    const m = /^rgba\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,/]+([\d.]+)\s*\)$/.exec(v || '');
    if (v && v !== 'transparent' && !(m && +m[1] < 0.5)) return v;
  }
  return null;
}

// '#rgb' · '#rrggbb' · 'rgb(a)(…)' → [r, g, b] 0–255 (null if it can't tell)
export function parseColor(c) {
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
export function isLight(c) {
  const rgb = parseColor(c);
  if (!rgb) return false;
  const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.18;
}
