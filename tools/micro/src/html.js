// The ONE door to innerHTML. Text from a file (a column name, a category, a
// cell value, a file name) is never markup: html`…` escapes every
// interpolation, and setHTML refuses anything that didn't come from html`…`
// or trusted(…). test/micro-html-guard.test.mjs fails the build on any
// innerHTML / insertAdjacentHTML / outerHTML outside this file.
//
// Why it matters for a Sealed tool: connect-src 'none' blocks fetch, but not a
// top-level navigation — an onerror= in a CSV cell, rendered as markup, could
// carry data out through location=. Escaping at the one door closes that.

class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v instanceof SafeHTML ? v.s
  : Array.isArray(v) ? v.map(part).join('')
  : v == null || v === false ? '' : esc(v));

// html`<b>${name}</b>` — every ${…} is text unless it is itself html`…` (or an
// array of them); null / undefined / false render as nothing.
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new SafeHTML(out);
}
// markup authored in this repo (help pages, icons, static option lists) —
// never anything read from a file
export const trusted = (s) => new SafeHTML(String(s));
// join html`…` pieces with an html`…` (or text) separator
export const joinH = (items, sep = '') => new SafeHTML(items.map(part).join(part(sep)));
export const isHTML = (v) => v instanceof SafeHTML;

function check(h, where) {
  if (!(h instanceof SafeHTML)) throw new TypeError(`${where}: not html\`…\` — text must not become markup`);
  return h.s;
}
export function setHTML(el, h) { el.innerHTML = check(h, 'setHTML'); }
export function appendHTML(el, h) { el.insertAdjacentHTML('beforeend', check(h, 'appendHTML')); }
