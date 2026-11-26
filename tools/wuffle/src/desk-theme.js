// wuffle desk — the theme: system / basalt (dark) / equipment gray (light), remembered per viewer. Sets
// data-theme (an explicit choice) and data-resolved-theme (what is showing) on <html>; listeners redraw
// whatever paints from tokens (nets, the loom grid).

export const THEMES = [['system', 'System'], ['dark', 'Basalt (dark)'], ['light', 'Equipment gray (light)']];
const KEY = 'wuffle.theme';

/** a token's value as the page resolves it right now */
export const tok = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

export function createTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  let pref = 'system';
  try { pref = localStorage.getItem(KEY) || 'system'; } catch { /* private window */ }
  const apply = () => {
    const r = document.documentElement;
    if (pref === 'system') delete r.dataset.theme; else r.dataset.theme = pref;
    r.dataset.resolvedTheme = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
    for (const fn of listeners) fn(r.dataset.resolvedTheme);
  };
  media.addEventListener('change', apply);
  return {
    get pref() { return pref; },
    get resolved() { return document.documentElement.dataset.resolvedTheme; },
    label() { return pref === 'system' ? `system · ${this.resolved}` : pref === 'dark' ? 'basalt' : 'equipment gray'; },
    set(p) { pref = p; try { localStorage.setItem(KEY, p); } catch { /* private window */ } apply(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    apply,
  };
}

/** the net's look, from the tokens (bearing draws SVG attributes, which can't read var()) */
export const netTheme = () => ({ background: tok('--w-net-bg'), rim: tok('--w-net-rim'), grid: tok('--w-net-grid'), cardinals: tok('--w-text-mid'), font: tok('--w-mono') || 'monospace' });
