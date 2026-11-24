// micro command palette (GCU noun-first model): one searchable list over every verb (the
// registry in src/commands.js), context-aware via when(ctx) — the discoverability surface that
// ties the menubar, the context menus and the keyboard together. Ctrl/⌘K or the ⌘K button;
// Alt+K the experimental plain-language bar (src/nl.js). Carved from index.html (2026-11-24).
import { setHTML, trusted } from './html.js';
import { _isMobile } from './windows.js';
import { t as tr, bothTongues } from './i18n.js';
import { _nlOn, nlStarters, _nlDispatcher, _nlBusy, nlEnsureTrained, nlPropose, nlComplete } from './nl.js';
import { COMMANDS, commandCtx } from './commands.js';

const $ = (s) => document.querySelector(s);

export let _palOpen = false, _palSel = 0, _palItems = [], _palNlMode = false;

export function openPalette(opts = {}) {
  if (_palOpen) return; _palOpen = true; _palNlMode = !!opts.nl && _nlOn;
  let ov = $('#palOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'palOverlay';
    setHTML(ov, trusted('<div id="palBox"><input id="palInput" placeholder="Type a command…  (↑↓ to move · Enter to run · Esc to close)" autocomplete="off" spellcheck="false"><div id="palList"></div></div>'));
    document.body.appendChild(ov);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) closePalette(); });
    $('#palInput').addEventListener('input', () => { _palSel = _isMobile() ? -1 : 0; renderPalette(); });
    $('#palInput').addEventListener('keydown', palKeydown);
  }
  $('#palInput').placeholder = tr(_palNlMode ? 'Ask in plain language…  (dispatch — experimental)' : 'Type a command…  (↑↓ to move · Enter to run · Esc to close)');
  ov.style.display = 'flex'; $('#palInput').value = ''; _palSel = _isMobile() ? -1 : 0; renderPalette(); $('#palInput').focus();
}
export function closePalette() { _palOpen = false; _palNlMode = false; const ov = $('#palOverlay'); if (ov) ov.style.display = 'none'; }
function renderPalette() {
  const q = $('#palInput').value.trim().toLowerCase(), ctx = commandCtx();
  const toks = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const c of COMMANDS) {
    if (c.when && !c.when(ctx)) continue;
    const hay = (bothTongues(c.title) + ' ' + bothTongues(c.group) + ' ' + (c.kw || '')).toLowerCase();
    if (toks.every((t) => hay.includes(t))) { const tt = tr(c.title).toLowerCase(); scored.push({ c, score: tt.startsWith(q) || c.title.toLowerCase().startsWith(q) ? 0 : tt.includes(q) || c.title.toLowerCase().includes(q) ? 1 : 2 }); }
  }
  scored.sort((a, b) => a.score - b.score);
  _palItems = scored.map((s) => s.c);
  // EXPERIMENTAL @gcu/dispatch. NL mode (Alt+K): a pure NL surface — starters when the
  // box is empty, else the live interpretation + word completions. Default (⌘K): only
  // ask dispatch when NOTHING matched a command by name, and show just the proposal.
  if (_nlOn && _palNlMode) {
    const raw = $('#palInput').value, rq = raw.trim();
    if (!rq) _palItems = nlStarters();
    else {
      if (!_nlDispatcher && !_nlBusy) { nlEnsureTrained().then(() => { if (_palOpen) renderPalette(); }); }
      const prop = rq.length >= 4 ? nlPropose(raw) : null;
      _palItems = [...(prop ? [prop] : []), ...nlComplete(raw)];
    }
  } else if (_nlOn && !_palItems.length && q.length >= 4) {
    if (!_nlDispatcher && !_nlBusy) { nlEnsureTrained().then(() => { if (_palOpen) renderPalette(); }); }
    const prop = nlPropose($('#palInput').value.trim());
    if (prop) _palItems = [prop];
  }
  if (_palSel >= _palItems.length) _palSel = Math.max(0, _palItems.length - 1);
  const list = $('#palList'); list.textContent = '';
  if (_nlOn && _nlBusy && !_palItems.length) {
    const d = document.createElement('div'); d.className = 'pal-item';
    d.textContent = 'learning this project\u2019s vocabulary\u2026';                  // ~1 s, once per session
    list.appendChild(d); return;
  }
  _palItems.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'pal-item' + (i === _palSel ? ' sel' : '');
    if (c.nl && c.breakdown) {                               // the live interpretation: sentence + structured chips
      d.classList.add('pal-nl');
      const top = document.createElement('div'); top.className = 'pal-top';
      const t = document.createElement('span'); t.className = 'pal-t'; t.textContent = tr(c.title);
      const h = document.createElement('span'); h.className = 'pal-hint'; h.textContent = 'Enter to run';
      top.append(t, h);
      const bd = document.createElement('div'); bd.className = 'pal-bd';
      for (const part of c.breakdown) { const chip = document.createElement('span'); chip.className = 'pal-chip'; if (part.k) { const b = document.createElement('b'); b.textContent = part.k; chip.appendChild(b); } chip.appendChild(document.createTextNode(String(part.v))); bd.appendChild(chip); }
      d.append(top, bd);
    } else {
      const g = document.createElement('span'); g.className = 'pal-g'; g.textContent = tr(c.group || '');
      const t = document.createElement('span'); t.className = 'pal-t'; t.textContent = tr(c.title);
      d.append(g, t);
      if (c.hint) { const k = document.createElement('span'); k.className = 'pal-kind'; k.textContent = c.hint; d.appendChild(k); }
    }
    d.onmousemove = () => { if (_palSel !== i) { _palSel = i; renderPalette(); } }; d.onclick = () => runPalette(i);
    list.appendChild(d);
    if (i === _palSel) d.scrollIntoView({ block: 'nearest' });
  });
  if (!_palItems.length) { const d = document.createElement('div'); d.className = 'pal-empty'; d.textContent = 'no matching command'; list.appendChild(d); }
}
function palKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); _palSel = Math.min(_palItems.length - 1, _palSel + 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _palSel = Math.max(0, _palSel - 1); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(_palSel); }
}
function runPalette(i) {
  const c = _palItems[i]; if (!c) return;
  if (c.fill != null) { const inp = $('#palInput'); inp.value = c.fill; _palSel = 0; renderPalette(); inp.focus(); return; }   // a completion / starter — fill the box, don't run
  closePalette(); try { c.run(commandCtx()); } catch (err) { $('#meta').textContent = `${c.title}: ${err.message}`; }
}
$('#btnCmd').onclick = () => (_palOpen ? closePalette() : openPalette());
