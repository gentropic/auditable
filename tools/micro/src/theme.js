// micro — the chrome theme: dark (basalt) / light (equipment gray) / system.
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
// Zero imports on purpose — deco.js, settings.js and the chart modules all
// import from here, so it must sit below them.

export const THEME_PREFS = [['dark', 'dark (basalt)'], ['light', 'light (equipment gray)'], ['system', 'follow the system']];

// the scene clear colour that goes with each register, when the background
// preference is "match the theme" (deco.js) — a mid-light gray, not white, so
// the ramp colours and the EDL shading keep their contrast
export const SCENE_DEFAULT = { dark: '#121212', light: '#c9c8c5' };

const _mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
export let _themePref = (() => { try { return localStorage.getItem('micro.theme') || 'dark'; } catch { return 'dark'; } })();

/** 'dark' | 'light' — the register actually showing. */
export function resolvedTheme(pref = _themePref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return _mq && _mq.matches ? 'light' : 'dark';
}

let _applied = null;
function apply() {
  const t = resolvedTheme();
  const root = document.documentElement;
  if (t === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#e4e3e1' : '#1a1a1a');
  if (_applied === t) return;
  const first = _applied === null;
  _applied = t; _tokCache.clear();
  if (first) return;                        // boot: nothing has painted yet
  window.dispatchEvent(new CustomEvent('micro:theme', { detail: { theme: t } }));
  for (const el of document.querySelectorAll('.fwin')) { try { if (el._onResized) el._onResized(); } catch { /* a window mid-teardown */ } }
}

/** Set the preference ('dark' | 'light' | 'system'), remember it, repaint. */
export function setTheme(pref) {
  if (!['dark', 'light', 'system'].includes(pref)) return;
  _themePref = pref;
  try { localStorage.setItem('micro.theme', pref); } catch { /* private mode */ }
  apply();
}

/** Called once at boot (the inline head script already set data-theme for first paint). */
export function initTheme() {
  apply();
  if (_mq) _mq.addEventListener('change', () => { if (_themePref === 'system') apply(); });
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
