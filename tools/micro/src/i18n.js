// micro — the interface language (English / Português do Brasil). A catalog keyed
// by the English text (src/i18n-pt.js), so t(english) is the whole API and a
// missing entry shows English, never a key. It covers the CHROME: the menubar and
// every menu (menu.js translates each label as it draws), window titles, the
// command palette (searched in both languages, whatever is showing), Settings, and
// the static toolbar (translateDom walks text, title, placeholder and aria-label,
// keeping the originals so a switch back is exact). Status messages, the in-app Help
// and the manual stay English for now. The choice is a machine preference
// (localStorage micro.lang). micro starts in English and never switches on its
// own: a browser set to Portuguese gets a one-line OFFER on the start screen
// (offerLanguage) — the interface doesn't change under anyone unasked.
// Zero imports beyond the catalog: menu.js, windows.js and settings.js import this.
import PT from './i18n-pt.js';

const CATALOGS = { pt: PT };
export const LANGS = [['en', 'English'], ['pt', 'Português (Brasil)']];

const stored = () => { try { const s = localStorage.getItem('micro.lang'); return s === 'en' || s === 'pt' ? s : null; } catch { return null; } };
export let LANG = stored() || 'en';

/** The text in the interface language. vars fill {name} slots. */
export function t(s, vars) {
  if (s == null) return s;
  let out = String(s);
  const c = LANG !== 'en' && CATALOGS[LANG];
  if (c) {
    const hit = c[out];
    if (hit) out = hit;
    else {
      const m = /^(✓ |• )(.*)$/.exec(out);                 // a checked item: translate what follows the mark
      if (m && c[m[2]]) out = m[1] + c[m[2]];
      else {
        // a label with a live part: "model QA · deposit.csv", "Opacity (100%)", "Block edges: auto"
        const d = /^(.*?)( · .*| \([^()]*\)|: .*)$/.exec(out);
        if (d && c[d[1]]) out = c[d[1]] + (c[d[2].replace(/^: /, '')] ? ': ' + c[d[2].replace(/^: /, '')] : d[2]);
      }
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return out;
}

/** Both languages' words for a string — the palette searches these. */
export function bothTongues(s) { const p = PT[s]; return p ? `${s} ${p}` : String(s); }

// ── the static DOM: text nodes and title / placeholder / aria-label ──
const _orig = new WeakMap();                               // node → { text } | element → { title, placeholder, aria }
// never the DATA: layer names, column names, records, file names, help text, the filter
const DATA = 'script, style, textarea, .fwin-body, .menu, [data-no-i18n], #meta, #stats, #lpRows, #rpList, #ppBody, #helpBody, #emptyRecents, #emptyProjects, #acPopup, #filterHL, #fdrawer, #colorBy';
const ATTRS = ['title', 'placeholder', 'aria-label'];
export function translateDom(root = document.body) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      const p = n.parentElement;
      if (!p || p.closest(DATA)) continue;
      let o = _orig.get(n);
      if (!o) { const raw = n.nodeValue; const tr = raw.trim(); if (!tr || !(tr in PT)) continue; o = { text: raw }; _orig.set(n, o); }
      const tr = o.text.trim();
      n.nodeValue = o.text.replace(tr, t(tr));
    } else if (n.nodeType === 1) {
      if (n.closest(DATA)) continue;
      let o = _orig.get(n);
      for (const a of ATTRS) {
        const cur = n.getAttribute(a); if (cur == null) continue;
        if (!o) { o = {}; _orig.set(n, o); }
        if (!(a in o)) { if (!(cur in PT)) continue; o[a] = cur; }
        n.setAttribute(a, t(o[a]));
      }
    }
  }
}

/** Switch the interface language: remembered, the static chrome re-labelled, 'micro:lang' told. */
export function setLang(l) {
  if (!LANGS.some(([k]) => k === l)) return;
  LANG = l;
  try { localStorage.setItem('micro.lang', l); } catch { /* private mode */ }
  document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en';
  translateDom(document.body);
  window.dispatchEvent(new CustomEvent('micro:lang', { detail: { lang: l } }));
}

// the start screen's one-line offer, for a browser in Portuguese that hasn't chosen
export function offerLanguage(host) {
  if (!host || stored() || !/^pt\b/i.test(navigator.language || '')) return null;
  const d = document.createElement('div'); d.className = 'lang-offer'; d.setAttribute('data-no-i18n', '');
  d.style.cssText = 'margin-top:10px;display:flex;gap:8px;justify-content:center;font-family:var(--mono);font-size:12px;color:var(--muted)';   // styled as the recent-project chips (#empty .lang-offer .er-chip)
  const yes = document.createElement('button'); yes.className = 'er-chip'; yes.textContent = 'Interface em português';
  yes.onclick = () => { setLang('pt'); d.remove(); };
  const no = document.createElement('button'); no.className = 'er-chip'; no.textContent = 'keep English';
  no.onclick = () => { try { localStorage.setItem('micro.lang', 'en'); } catch { /* private */ } d.remove(); };
  d.append(yes, no);
  host.appendChild(d);
  return d;
}

export function initLang() {
  document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';
  if (LANG !== 'en') { translateDom(document.body); setTimeout(() => translateDom(document.body), 0); }   // again once boot has built the rest of the chrome
}
