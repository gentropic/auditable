// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/theme — One theme vocabulary for GCU figures: the keys (background, foreground, muted, grid, frame, panel, accent, cycle, fonts, …), dark/light/paper themes from the Switchboard palette, and themeFromCSS to take a host page's design tokens. Shared by @gcu/condenser's view and @gcu/plot, so one theme dresses a chart and the 3D view beside it. Zero dependencies.

// ── src/theme.js ──

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

// ── src/main.js ──



export {
  THEME_KEYS,
  THEMES,
  CSS_MAP,
  resolveTheme,
  themeFromCSS,
  parseColor,
  isLight,
};
