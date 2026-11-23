// micro — expression fields: the column and value autocomplete, the touch key strip,
// and the syntax highlight behind every filter and calc input.
import { activeDocs, activeLayer } from './state.js';
import { schemaExt } from './records.js';
import { _isMobile } from './windows.js';
import { complete, tokenize } from '../../../ext/expr/index.js';
import { html, setHTML } from './html.js';
const $ = (s) => document.querySelector(s);

// ── autocomplete (lamina's engine over @gcu/expr complete()): columns, functions,
// keywords, and DATA VALUES (the category dictionary — picking "HEMATITE" from the
// list is how you dodge the bare-word-vs-quoted footgun). ──
export function columnValues(name) {
  const h = (activeDocs().blockDoc || activeDocs().dhDoc) && (activeDocs().blockDoc || activeDocs().dhDoc).header;
  if (!h || !h.categories) return [];
  const lc = String(name).toLowerCase();
  const catName = h.mapping.cat != null ? h.columns[h.mapping.cat] : null;
  return catName && catName.toLowerCase() === lc ? h.categories : [];
}

export const filterCtx = () => {
  const d = activeDocs(), fd = d.blockDoc || d.dhDoc;
  if (fd) return { columns: schemaExt(activeLayer(), fd.header), values: columnValues };
  const cd = d.lasDoc || d.plyDoc;                          // a point cloud: its points' columns, all numbers
  return cd && cd.header.columns ? { columns: cd.header.columns.map((name) => ({ name, type: 'number' })) } : null;
};

export const _ac = { input: null, res: null, sel: 0, suppress: false };
// a field that places the popup at its caret (a multi-line box) registers how: field → () => rect
export const _acAnchor = new WeakMap();

export function attachAutocomplete(input, getCtx) {
  input.addEventListener('input', () => acRefresh(input, getCtx));
  input.addEventListener('keydown', (e) => acKeydown(e, input), true);   // capture: beat apply-on-Enter
  input.addEventListener('click', () => acRefresh(input, getCtx));
  input.addEventListener('blur', () => setTimeout(acClose, 120));        // delay so a popup click lands first
}

export function acRefresh(input, getCtx) {
  if (_ac.suppress || (_exprFields.has(input) && _isMobile())) return;   // a phone has the strip instead
  const ctx = getCtx(); if (!ctx) return acClose();
  const res = complete(input.value, input.selectionStart, ctx);
  if (!res.options.length) return acClose();
  _ac.input = input; _ac.res = res; _ac.sel = 0; acRender(input);
}

export function acRender(input) {
  const pop = $('#acPopup'); pop.replaceChildren();
  _ac.res.options.forEach((o, i) => {
    const row = document.createElement('div'); row.className = 'ac-item' + (i === _ac.sel ? ' sel' : '');
    const v = document.createElement('span'); v.className = 'ac-val ac-' + o.kind; v.textContent = o.value;
    const k = document.createElement('span'); k.className = 'ac-kind'; k.textContent = o.detail || o.kind;
    row.appendChild(v); row.appendChild(k);
    if (o.doc) { const d = document.createElement('span'); d.className = 'ac-doc'; d.textContent = o.doc; row.title = o.doc; row.appendChild(d); }
    row.onmousedown = (e) => { e.preventDefault(); acAccept(i); };
    pop.appendChild(row);
  });
  const r = _acAnchor.has(input) ? _acAnchor.get(input)() : input.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - 300) + 'px';
  pop.style.top = (r.bottom + 2) + 'px';
  pop.style.minWidth = Math.min(Math.max(r.width, 180), 320) + 'px';
  pop.classList.add('show');
}

export function acClose() { const pop = $('#acPopup'); if (pop) pop.classList.remove('show'); _ac.res = null; }

export function acKeydown(e, input) {
  if (!_ac.res || !$('#acPopup').classList.contains('show')) return;     // closed: Enter applies as usual
  const n = _ac.res.options.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); _ac.sel = (_ac.sel + 1) % n; acRender(input); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); _ac.sel = (_ac.sel - 1 + n) % n; acRender(input); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); acAccept(_ac.sel); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); acClose(); }
}

export function acAccept(i) {
  const input = _ac.input, res = _ac.res; if (!res) return;
  const o = res.options[i]; if (!o) return;
  const spaceAfter = (o.kind === 'operator' || o.kind === 'keyword') && !o.value.endsWith('(');
  const ins = o.insert != null ? o.insert : o.value + (spaceAfter ? ' ' : '');   // a field's own insertion text
  input.value = input.value.slice(0, res.from) + ins + input.value.slice(res.to);
  const caret = res.from + ins.length;
  input.focus(); input.setSelectionRange(caret, caret);
  _ac.suppress = true; input.dispatchEvent(new Event('input')); _ac.suppress = false;
  acClose();
  if (typeof o.after === 'function') o.after(input);              // e.g. a YAML key → straight on to its values
}

// ── the phone's EXPRESSION STRIP: a field registered here (the filter, the ƒ editor)
// gets, while it has focus on a phone, a keys row (caret ◂ ▸ and the symbols a phone
// keyboard hides — = > < ( ) " , …) and a suggestions row — the completer's own options
// at the caret, so after a column it offers operators, after `=` the category values.
// It takes the floating popup's place there. Chips act on click with mousedown
// prevented, so the field keeps focus and the keyboard stays up. ──
export const _exprFields = new WeakMap();                         // field → () => completer ctx

export const XS_KEYS = ['=', '>', '<', '(', ')', '"', ',', '!=', '>=', '<=', '+', '-', '*', '/'];

export const XS_PAD = new Set(['=', '>', '<', '!=', '>=', '<=', '+', '-', '*', '/']);   // spaced both sides

export function exprField(el, getCtx) { _exprFields.set(el, getCtx); }

export const exprStripField = () => { const a = document.activeElement; return a && _exprFields.has(a) && _isMobile() ? a : null; };

// put `txt` over [from, to) with the caret `back` chars before its end, then let the
// field's own input listeners (highlight, validation, the strip) see it
export function xsInsert(el, from, to, txt, back = 0) {
  el.value = el.value.slice(0, from) + txt + el.value.slice(to);
  const c = from + txt.length - back;
  el.setSelectionRange(c, c);
  el.dispatchEvent(new Event('input'));
}

export function xsKey(el, k) {
  const v = el.value, a = el.selectionStart, b = el.selectionEnd;
  if (k === '◂' || k === '▸') { const c = Math.max(0, Math.min(v.length, (k === '◂' ? Math.min(a, b) : Math.max(a, b)) + (a === b ? (k === '◂' ? -1 : 1) : 0))); el.setSelectionRange(c, c); return xsSync(); }
  if (k === '"') {                                        // a pair, caret inside — or step over a closing one
    if (a === b && v[a] === '"') { el.setSelectionRange(a + 1, a + 1); return xsSync(); }
    return xsInsert(el, a, b, '""', 1);
  }
  if (k === ')' && a === b && v[a] === ')') { el.setSelectionRange(a + 1, a + 1); return xsSync(); }
  if (XS_PAD.has(k)) {
    const pre = a > 0 && !/\s/.test(v[a - 1]) ? ' ' : '';
    const post = v[b] === ' ' ? '' : ' ';
    return xsInsert(el, a, b, pre + k + post, post ? 0 : -1);   // over an existing space: land past it
  }
  xsInsert(el, a, b, k === ',' ? ', ' : k);
}

export function xsAccept(el, res, o) {                            // a suggestion: acAccept's replace, plus a trailing
  const tail = el.value[res.to];                           // space so the next row (operators) follows on
  const opens = o.value.endsWith('(');
  const ins = o.value + (opens || tail === ' ' || tail === ')' ? '' : ' ');
  xsInsert(el, res.from, res.to, ins);
}

export function xsSync() {
  const el = exprStripField();
  document.body.classList.toggle('expr-on', !!el);
  if (!el) return;
  acClose();
  const strip = $('#exprStrip'), keys = strip.querySelector('.xs-keys'), sugg = strip.querySelector('.xs-sugg');
  if (!keys.childElementCount) for (const k of ['◂', '▸', ...XS_KEYS]) {
    const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.textContent = k === '-' ? '−' : k; b.dataset.k = k;
    if (k === '◂' || k === '▸') b.setAttribute('aria-label', k === '◂' ? 'caret left' : 'caret right');
    keys.appendChild(b);
  }
  sugg.replaceChildren();
  const ctx = _exprFields.get(el)();
  const res = ctx ? complete(el.value, el.selectionStart, ctx) : { options: [] };
  if (!res.options.length) { const s = document.createElement('span'); s.className = 'xs-none'; s.textContent = ctx ? 'no suggestions here — type, or use the keys above' : 'no columns'; sugg.appendChild(s); }
  for (const o of res.options.slice(0, 60)) {
    const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.className = 'k-' + o.kind; b.textContent = o.value;
    if (o.detail) b.title = o.detail;
    b.onclick = () => xsAccept(el, res, o);
    sugg.appendChild(b);
  }
  sugg.scrollLeft = 0;
}

// ── expr syntax highlighting (lamina's overlay pattern verbatim): a colored
// layer driven by expr.tokenize behind a transparent-text input. Monospace +
// matched padding makes it align by construction; we keep it scroll-synced. ──
export function renderExprHL(hl, src) {
  if (!hl) return;
  const toks = tokenize(src), parts = [];
  let pos = 0;
  for (const t of toks) {
    if (t.start > pos) parts.push(src.slice(pos, t.start));
    parts.push(html`<span class="hl-${t.kind}">${t.value}</span>`);
    pos = t.end;
  }
  if (pos < src.length) parts.push(src.slice(pos));
  setHTML(hl, html`${parts}`);
}

export function syncHL(input, hl) { if (!hl) return; renderExprHL(hl, input.value); hl.scrollLeft = input.scrollLeft; hl.scrollTop = input.scrollTop || 0; }
