// HOUSE STYLE — a document's PROPERTIES and the TITLE BLOCK that shows them, and TEMPLATES.
//
// Properties are plain strings read by the {prop:key} field (fields.js): the document's own
// (doc.props — a drawing number, a revision) over the host's (env.props — a house style's company,
// client, project …). compo names the usual ones; where they are kept (a project folder, a
// settings store) is the host's business.
//
// Any document can be a TEMPLATE (doc.template = true): a new document can start from one — its
// frames, its page and its properties, the per-drawing ones (drawing, revision) cleared. Which
// templates exist, and where, is the host's catalogue.
import { pageDims, parseDocument, serializeDocument } from './model.js';

// [key, label] — the shared ones (every figure of a project) and a figure's own
export const HOUSE_KEYS = [['company', 'company'], ['client', 'client'], ['project', 'project'], ['prepared', 'prepared by'], ['checked', 'checked by'], ['disclaimer', 'disclaimer']];
export const FIGURE_KEYS = [['drawing', 'drawing no.'], ['revision', 'revision']];

// ── templates ──
export function setTemplate(doc, on = true) {
  if (on) doc.template = true; else delete doc.template;
  return doc;
}
// a new document from a template: its frames, page and properties; a title of its own, not a template
// itself, and the per-drawing properties (FIGURE_KEYS unless told otherwise) cleared
export function docFromTemplate(tpl, title = '', { clear = FIGURE_KEYS.map(([k]) => k) } = {}) {
  const doc = parseDocument(serializeDocument(tpl));
  doc.title = title; delete doc.template;
  doc.props = { ...(tpl.props || {}) };
  for (const k of clear) delete doc.props[k];
  return doc;
}

// ── the title block: a stack of bordered text rows, bottom-right inside the margins, every row
// made of fields — [md, type size pt, row height mm] ──
export const TITLE_BLOCK_ROWS = [
  ['**{prop:company}**', 9, 7], ['{prop:project} · {prop:client}', 7, 5.5], ['**{title}**', 8, 6.5],
  ['drawing {prop:drawing} · rev {prop:revision} · {date}', 6.5, 5], ['prepared {prop:prepared} · checked {prop:checked}', 6.5, 5], ['scale {scale} · page {page} of {pages}', 6.5, 5],
];
// the frames of a title block on this page (not yet added): [{ kind, box, content, style }]
export function titleBlockFrames(doc, { rows = TITLE_BLOCK_ROWS, width = 95 } = {}) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const hTot = rows.reduce((s, r) => s + r[2], 0);
  let y = H - m[2] - hTot; const x = W - m[1] - width, out = [];
  for (const [md, size, h] of rows) {
    out.push({ kind: 'text', box: [x, +y.toFixed(2), width, h], content: { md, size, pad: 1 }, style: { border: true, borderWidth: 0.2 } });
    y += h;
  }
  return out;
}
