// micro — the custom-theme editor (Settings → display → custom theme, View → Theme).
// A theme is a token map over the dark or light register (theme.js); the editor
// shows every colour token of the chosen base, a swatch each, applies every change
// live, reads the contrast of the inks people actually read against the surfaces
// they sit on (Switchboard's rule: 4.5:1), and moves themes between machines as a
// small .json file. Only the tokens that DIFFER from the base are stored, so a
// theme that changes just the accent stays a three-line file.
import { clearCustomTheme, contrast, customTheme, parseThemeJson, registerTokens, sceneDefault, setCustomTheme, themeJson } from './theme.js';
import { floatWin, raiseWindow } from './windows.js';
import { deliverBlob } from './hostio.js';
const $ = (s) => document.querySelector(s);

export const THEME_GROUPS = [
  ['surfaces', [['--bg', 'page behind everything'], ['--bg-bar', 'tool bars'], ['--panel', 'windows and panels'], ['--bg-menu', 'menus'], ['--bg-field', 'text fields'], ['--bg-btn', 'buttons'], ['--bg-hover', 'hovered rows'], ['--border', 'borders'], ['--bd2', 'strong borders']]],
  ['text', [['--text-hi', 'headings, values'], ['--text', 'body text'], ['--muted', 'secondary text'], ['--dim', 'hints'], ['--faint', 'disabled']]],
  ['accents', [['--accent', 'action (orange)'], ['--on-accent', 'text on the accent'], ['--accent-soft', 'accent wash'], ['--sel', 'selected (violet)'], ['--info', 'info (blue)'], ['--ok', 'numbers, ok (green)'], ['--caution', 'caution (yellow)'], ['--warn', 'warning'], ['--fault', 'fault (red)']]],
];
// the inks people read, on the surfaces they sit on
const PAIRS = [['--text', '--panel'], ['--text-hi', '--bg-bar'], ['--muted', '--panel'], ['--dim', '--panel'], ['--accent', '--panel'], ['--on-accent', '--accent'], ['--ok', '--panel'], ['--fault', '--panel'], ['--text', '--bg-menu'], ['--text', '--bg-field']];

const HIGH_CONTRAST = {
  base: 'dark', scene: '#000000',
  tokens: {
    '--bg': '#000000', '--bg-bar': '#0b0b0b', '--bg-bar2': '#0b0b0b', '--panel': '#000000', '--panel-glass': 'rgba(0, 0, 0, 0.97)', '--bg-menu': '#0b0b0b',
    '--bg-field': '#000000', '--bg-btn': '#1c1c1c', '--bg-btn-hover': '#2a2a2a', '--bg-hover': '#1c1c1c', '--bg-active': '#262626',
    '--border': '#8c8c8c', '--bd2': '#a8a8a8', '--text': '#f0f0f0', '--text-hi': '#ffffff', '--fg': '#ffffff', '--muted': '#d2d2d2', '--dim': '#bebebe', '--faint': '#9c9c9c',
    '--accent': '#ffc24d', '--on-accent': '#000000', '--accent-soft': '#3a2c0c', '--sel': '#c9baff', '--info': '#86b6ff', '--ok': '#a3e48d', '--go': '#a3e48d',
    '--caution': '#ffd166', '--warn': '#ffb347', '--fault': '#ff8f75',
  },
};
export const THEME_STARTS = { dark: { base: 'dark', tokens: {} }, light: { base: 'light', tokens: {} }, 'high contrast': HIGH_CONTRAST };

const hex6 = (v) => {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return null;
};
const rgba = (h, a) => { const v = parseInt(h.slice(1), 16); return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`; };

// the full colour map a theme means: its base register, then its own tokens
export function themeColors(t) {
  const base = registerTokens(t.base);
  return { ...base, ...t.tokens };
}

// keep the tokens that are spelled out twice in the registers in step
function derive(t, changed) {
  if (changed === '--panel') t.tokens['--panel-glass'] = rgba(t.tokens['--panel'], t.base === 'light' ? 0.97 : 0.96);
  if (changed === '--text-hi') t.tokens['--fg'] = t.tokens['--text-hi'];
  if (changed === '--bg-bar') t.tokens['--bg-bar2'] = t.tokens['--bg-bar'];
  if (changed === '--ok') t.tokens['--go'] = t.tokens['--ok'];
}

// only what differs from the base is stored
function diffFromBase(t) {
  const base = registerTokens(t.base), out = {};
  for (const [k, v] of Object.entries(t.tokens)) if ((hex6(base[k]) || base[k]) !== (hex6(v) || v)) out[k] = v;
  return { ...t, tokens: out };
}

let _win = null;
export function openThemeEditor() {
  if (_win) { raiseWindow(_win.el); return _win; }
  const win = floatWin({ title: 'theme', sub: 'custom', x: innerWidth / 2 - 250, y: 70, w: 500, h: 560, onClose: () => { _win = null; } });
  _win = win;
  let t = customTheme() || { v: 1, name: 'my theme', base: 'dark', tokens: {} };
  const commit = (changed) => {
    if (changed) derive(t, changed);
    t = setCustomTheme(diffFromBase(t));
    renderContrast();
  };
  win.body.style.cssText += 'display:flex;flex-direction:column;font-family:var(--mono);font-size:12px';
  const head = document.createElement('div');
  head.style.cssText = 'flex:0 0 auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--border)';
  const name = document.createElement('input'); name.className = 'sw-in'; name.value = t.name; name.style.cssText = 'flex:1;min-width:120px'; name.title = 'the theme’s name';
  name.oninput = () => { t.name = name.value || 'custom'; commit(null); };
  const start = document.createElement('select'); start.className = 'sw-sel'; start.title = 'start again from a register (replaces every colour)';
  start.append(new Option('start from…', ''), ...Object.keys(THEME_STARTS).map((k) => new Option(k, k)));
  start.onchange = () => {
    const s = THEME_STARTS[start.value]; start.value = ''; if (!s) return;
    t = { v: 1, name: t.name, base: s.base, tokens: { ...s.tokens }, ...(s.scene ? { scene: s.scene } : {}) };
    commit(null); renderRows();
  };
  head.append(name, start);
  const body = document.createElement('div'); body.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:6px 12px';
  const cr = document.createElement('div'); cr.style.cssText = 'flex:0 0 auto;border-top:1px solid var(--border);padding:6px 12px;color:var(--dim);font-size:11px;line-height:1.5;max-height:92px;overflow-y:auto';
  const foot = document.createElement('div');
  foot.style.cssText = 'flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px;border-top:1px solid var(--border);background:var(--panel)';
  const btn = (label, title, fn) => { const b = document.createElement('button'); b.className = 'awin-btn'; b.textContent = label; b.title = title; b.onclick = fn; foot.appendChild(b); return b; };
  btn('export .json', 'save this theme as a small file to share', () => {
    const fn = `${(t.name || 'theme').replace(/[^\w.-]+/g, '-')}.micro-theme.json`;
    deliverBlob(new Blob([themeJson(t)], { type: 'application/json' }), fn);
    $('#meta').textContent = `theme saved as ${fn}`;
  });
  btn('import…', 'load a theme file', () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      try { t = setCustomTheme(parseThemeJson(await f.text())); name.value = t.name; renderRows(); renderContrast(); $('#meta').textContent = `theme “${t.name}” loaded`; }
      catch (e) { $('#meta').textContent = `theme: ${f.name} — ${e.message}`; }
    };
    i.click();
  });
  btn('remove', 'forget the custom theme and go back to its base register', () => { clearCustomTheme(); win.close(); $('#meta').textContent = 'custom theme removed'; });
  win.body.append(head, body, cr, foot);

  const row = (key, label, value, onSet) => {
    const r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0';
    const sw = document.createElement('input'); sw.type = 'color'; sw.value = hex6(value) || '#000000'; sw.dataset.token = key;
    sw.style.cssText = 'width:34px;height:22px;padding:0;border:1px solid var(--border);background:none;cursor:pointer';
    const tx = document.createElement('input'); tx.className = 'sw-in'; tx.value = hex6(value) || value || ''; tx.style.cssText = 'flex:0 0 82px;width:82px;min-width:0';
    const lb = document.createElement('span'); lb.style.cssText = 'flex:1;min-width:0;color:var(--text)'; lb.textContent = label;
    const kk = document.createElement('span'); kk.style.cssText = 'color:var(--faint);font-size:10px'; kk.textContent = key;
    sw.oninput = () => { tx.value = sw.value; onSet(sw.value); };
    tx.onchange = () => { const h = hex6(tx.value); if (!h) { tx.value = sw.value; return; } sw.value = h; onSet(h); };
    r.append(sw, tx, lb, kk);
    return r;
  };
  const renderRows = () => {
    body.textContent = '';
    const colors = themeColors(t);
    for (const [g, list] of THEME_GROUPS) {
      const h = document.createElement('div'); h.style.cssText = 'color:var(--muted);margin:8px 0 2px;text-transform:uppercase;font-size:10px;letter-spacing:.06em'; h.textContent = g;
      body.appendChild(h);
      for (const [k, label] of list) body.appendChild(row(k, label, colors[k], (v) => { t.tokens[k] = v; commit(k); }));
    }
    const h = document.createElement('div'); h.style.cssText = 'color:var(--muted);margin:8px 0 2px;text-transform:uppercase;font-size:10px;letter-spacing:.06em'; h.textContent = 'scene';
    body.appendChild(h);
    body.appendChild(row('scene', 'the 3D background (when Settings → background is “match the theme”)', t.scene || sceneDefault(), (v) => { t.scene = v; commit(null); }));
  };
  const renderContrast = () => {
    const c = themeColors(t);
    const parts = PAIRS.map(([ink, on]) => {
      const r = contrast(hex6(c[ink]), hex6(c[on]));
      if (r == null) return null;
      const low = r < 4.5;
      const s = document.createElement('span');
      s.style.color = low ? 'var(--fault)' : 'var(--dim)';
      s.textContent = `${ink.slice(2)} on ${on.slice(2)} ${r.toFixed(1)}${low ? ' ⚠' : ''}`;
      return { s, low };
    }).filter(Boolean);
    const lows = parts.filter((p) => p.low).length;
    cr.textContent = '';
    const head = document.createElement('b');
    head.style.color = lows ? 'var(--fault)' : 'var(--ok)';
    head.textContent = 'contrast';
    cr.append(head, ` — ${lows ? `${lows} pair${lows > 1 ? 's' : ''} below 4.5:1` : 'every pair ≥ 4.5:1'}`);
    for (const p of parts) cr.append(' · ', p.s);
  };
  if (!customTheme()) commit(null);                        // opening the editor makes the theme live
  renderRows(); renderContrast();
  return win;
}
