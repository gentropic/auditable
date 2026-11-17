// micro — the chrome theme: dark (basalt) / light (equipment gray) / system / custom.
//
// The palettes themselves are CSS: the :root tokens in index.html, and their
// light register under :root[data-theme="light"]. This module only decides
// which register is live, remembers the choice (localStorage micro.theme —
// a MACHINE preference, never in the project), and tells the things that
// paint colours themselves (canvas charts, the loom attribute tables, the
// stereonet, the scene background when it follows the theme) to repaint:
// it dispatches 'micro:theme' on window and re-runs every float window's
// _onResized hook, which is already each window's "draw yourself again".
//
// A CUSTOM theme is a token map over one of the two registers:
//   { v: 1, name, base: 'dark' | 'light', tokens: { '--accent': '#…', … }, scene?: '#…' }
// applied as inline properties on <html>, so a partial theme (just an accent)
// works. It lives in localStorage micro.themeCustom (the head script applies it
// before first paint) and travels between machines as a small .json file.
//
// Zero imports on purpose — deco.js, settings.js and the chart modules all
// import from here, so it must sit below them.

const BASE_PREFS = [['dark', 'dark (basalt)'], ['light', 'light (equipment gray)'], ['system', 'follow the system']];
/** The theme choices: the three registers, plus the custom theme once one exists. */
export const THEME_PREFS = () => [...BASE_PREFS, [_custom ? 'custom' : 'custom-new', _custom ? `custom — ${_custom.name || 'unnamed'}` : 'custom…']];

// the scene clear colour that goes with each register, when the background
// preference is "match the theme" (deco.js) — a mid-light gray, not white, so
// the ramp colours and the EDL shading keep their contrast
export const SCENE_DEFAULT = { dark: '#121212', light: '#c9c8c5' };

// above _custom: parsing the stored theme at module init reads these (a TDZ
// error there was swallowed by the catch and the theme silently fell back to dark)
const HEX = /^#[0-9a-f]{6}$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const _mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
export let _themePref = (() => { try { return localStorage.getItem('micro.theme') || 'dark'; } catch { return 'dark'; } })();
let _custom = (() => { try { return normalizeTheme(JSON.parse(localStorage.getItem('micro.themeCustom') || 'null')); } catch { return null; } })();
if (_themePref === 'custom' && !_custom) _themePref = 'dark';

/** 'dark' | 'light' — the register actually showing (a custom theme's base). */
export function resolvedTheme(pref = _themePref) {
  if (pref === 'light' || pref === 'dark') return pref;
  if (pref === 'custom') return _custom ? _custom.base : 'dark';
  return _mq && _mq.matches ? 'light' : 'dark';
}

/** The scene background that "match the theme" means right now. */
export function sceneDefault() {
  if (_themePref === 'custom' && _custom && _custom.scene) return _custom.scene;
  return SCENE_DEFAULT[resolvedTheme()];
}

let _applied = null, _inline = [];
function apply() {
  const t = resolvedTheme();
  const root = document.documentElement;
  if (t === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme;
  if (_applied === null) for (let i = 0; i < root.style.length; i++) if (root.style[i].startsWith('--')) _inline.push(root.style[i]);   // the head script's first-paint tokens
  for (const k of _inline) root.style.removeProperty(k);
  _inline = [];
  const live = _themePref === 'custom' && _custom ? _custom : null;
  if (live) for (const [k, v] of Object.entries(live.tokens)) { root.style.setProperty(k, v); _inline.push(k); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', live && live.tokens['--bg-bar'] ? live.tokens['--bg-bar'] : t === 'light' ? '#e4e3e1' : '#1a1a1a');
  const key = t + '|' + (live ? JSON.stringify(live) : '');
  if (_applied === key) return;
  const first = _applied === null;
  _applied = key; _tokCache.clear();
  if (first) return;                        // boot: nothing has painted yet
  window.dispatchEvent(new CustomEvent('micro:theme', { detail: { theme: t } }));
  for (const el of document.querySelectorAll('.fwin')) { try { if (el._onResized) el._onResized(); } catch { /* a window mid-teardown */ } }
}

/** Set the preference ('dark' | 'light' | 'system' | 'custom'), remember it, repaint. */
export function setTheme(pref) {
  if (!['dark', 'light', 'system', 'custom'].includes(pref)) return;
  if (pref === 'custom' && !_custom) return;
  _themePref = pref;
  try { localStorage.setItem('micro.theme', pref); } catch { /* private mode */ }
  apply();
}

/** Called once at boot (the inline head script already set data-theme for first paint). */
export function initTheme() {
  apply();
  if (_mq) _mq.addEventListener('change', () => { if (_themePref === 'system') apply(); });
}

// ── custom themes ────────────────────────────────────────────────────────────

/** A theme object made safe: only colour-valued custom properties, a known base. Null when unusable. */
export function normalizeTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const base = t.base === 'light' ? 'light' : 'dark';
  const tokens = {};
  for (const [k, v] of Object.entries(t.tokens || {})) {
    if (/^--[a-z0-9-]+$/i.test(k) && k !== '--mono' && k !== '--sans' && typeof v === 'string' && COLOR.test(v.trim())) tokens[k] = v.trim();
  }
  const out = { v: 1, name: String(t.name || 'custom').slice(0, 60), base, tokens };
  if (typeof t.scene === 'string' && HEX.test(t.scene)) out.scene = t.scene.toLowerCase();
  return out;
}

/** The stored custom theme (a copy), or null. */
export function customTheme() { return _custom ? JSON.parse(JSON.stringify(_custom)) : null; }

/** Store a custom theme and make it the live one. Returns the normalized theme. */
export function setCustomTheme(t) {
  const n = normalizeTheme(t);
  if (!n) throw new Error('not a theme');
  _custom = n;
  try { localStorage.setItem('micro.themeCustom', JSON.stringify(n)); } catch { /* private mode */ }
  setTheme('custom');
  return customTheme();
}

/** Forget the custom theme; falls back to its base register. */
export function clearCustomTheme() {
  const base = _custom ? _custom.base : 'dark';
  _custom = null;
  try { localStorage.removeItem('micro.themeCustom'); } catch { /* private mode */ }
  if (_themePref === 'custom') setTheme(base);
}

/** A theme as the text of a .json file. */
export const themeJson = (t = _custom) => JSON.stringify({ format: 'micro-theme', ...normalizeTheme(t) }, null, 2) + '\n';

/** Parse a .json theme file's text → a normalized theme (throws on anything else). */
export function parseThemeJson(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('not JSON'); }
  if (!o || (o.format && o.format !== 'micro-theme') || !o.tokens) throw new Error('not a micro theme (no tokens)');
  const n = normalizeTheme(o);
  if (!Object.keys(n.tokens).length) throw new Error('the theme sets no colours');
  return n;
}

/** The value every token has in a register, read from the stylesheet — what a custom theme starts from. */
export function registerTokens(base = 'dark') {
  const out = {};
  const want = base === 'light' ? ':root[data-theme="light"]' : ':root';
  const rules = [];
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.selectorText === ':root' || r.selectorText === want) rules.push(r); } catch { /* cross-origin sheet */ } }
  for (const r of rules.sort((a, b) => (a.selectorText === ':root' ? -1 : 0) - (b.selectorText === ':root' ? -1 : 0))) {
    for (let i = 0; i < r.style.length; i++) {
      const k = r.style[i];
      if (!k.startsWith('--') || k === '--mono' || k === '--sans') continue;
      if (r.selectorText === ':root' || base === 'light') out[k] = r.style.getPropertyValue(k).trim();
    }
  }
  return out;
}

// WCAG contrast between two #rrggbb colours (1…21)
const lum = (h) => {
  const v = parseInt(h.slice(1), 16), c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function contrast(a, b) {
  if (!HEX.test(a || '') || !HEX.test(b || '')) return null;
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── tokens for things that paint colours themselves ─────────────────────────
const _tokCache = new Map();
/** A theme token's current value, e.g. tok('--accent') → '#c89b3c'. */
export function tok(name, fallback = '#888') {
  let v = _tokCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    _tokCache.set(name, v);
  }
  return v;
}

/** A token at an alpha — for canvas fills (CSS uses color-mix instead). */
export function tokAlpha(name, a) {
  const h = tok(name);
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return h;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** @gcu/loom's colour set, from the live tokens (pass to createGrid / setColors). */
export function loomColors() {
  const light = resolvedTheme() === 'light';
  return {
    gridLine: light ? '#cfcecb' : '#1e1e1e', hdrBg: tok('--bg-bar'), hdrBorder: tok('--border'), hdrText: tok('--muted'),
    cellText: tok('--text'), cellNum: tok('--ok'), cellDerived: tok('--accent'), cellError: tok('--fault'),
    cellPending: tok('--faint'), cellOutOfOrder: tok('--caution'), hdrGlyph: tok('--dim'),
    editedBar: tok('--accent'), selFill: tokAlpha('--accent', 0.14), selStroke: tok('--accent'),
    highlightFill: light ? 'rgba(90,100,190,0.16)' : 'rgba(120,130,225,0.22)',
    invalidFill: tokAlpha('--fault', light ? 0.13 : 0.2),
    bg: tok('--panel'), scrollThumb: tok('--bd2'), scrollTrack: tok('--panel'),
  };
}
