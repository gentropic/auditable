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
import { pageDims, parseDocument, serializeDocument, newId, LOAD_MIGRATIONS } from './model.js';
import { registerKind, kindOf } from './kinds.js';
import { INK } from './type.js';

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

// ── the title block: a stack of bordered rows, bottom-right inside the margins, every row made of
// fields — [md, type size pt, row height mm] ──
export const TITLE_BLOCK_ROWS = [
  ['**{prop:company}**', 9, 7], ['{prop:project} · {prop:client}', 7, 5.5], ['**{title}**', 8, 6.5],
  ['drawing {prop:drawing} · rev {prop:revision} · {date}', 6.5, 5], ['prepared {prop:prepared} · checked {prop:checked}', 6.5, 5], ['scale {scale} · page {page} of {pages}', 6.5, 5],
];
const RULE = 0.2;                                          // the block's ruling, mm
// the title block on this page as ONE frame (not yet added): kind 'titleblock', content.rows
export function titleBlockFrame(doc, { rows = TITLE_BLOCK_ROWS, width = 95 } = {}) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const hTot = rows.reduce((s, r) => s + r[2], 0);
  return { kind: 'titleblock', box: [W - m[1] - width, +(H - m[2] - hTot).toFixed(2), width, +hTot.toFixed(2)], content: { rows: rows.map((r) => r.slice()) } };
}
// the OLD form, a group of bordered text frames — kept for a host that wants loose rows
export function titleBlockFrames(doc, { rows = TITLE_BLOCK_ROWS, width = 95 } = {}) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const hTot = rows.reduce((s, r) => s + r[2], 0);
  let y = H - m[2] - hTot; const x = W - m[1] - width, out = [];
  for (const [md, size, h] of rows) {
    out.push({ kind: 'text', box: [x, +y.toFixed(2), width, h], content: { md, size, pad: 1 }, style: { border: true, borderWidth: RULE } });
    y += h;
  }
  return out;
}
// The kind: the rows stacked in the box (their heights scaled to fill it), each ruled, each drawn
// by the text kind — so its fields resolve exactly as a text frame's do, about this frame.
registerKind('titleblock', {
  label: 'title block',
  draw(ctx, box, frame, env) {
    const rows = (frame.content && frame.content.rows) || TITLE_BLOCK_ROWS;
    const hTot = rows.reduce((s, r) => s + (+r[2] || 5), 0) || 1, k = box[3] / hTot, text = kindOf('text');
    let y = box[1];
    for (const [md, size, h0] of rows) {
      const h = (+h0 || 5) * k, rb = [box[0], y, box[2], h];
      ctx.save();
      ctx.beginPath(); ctx.rect(rb[0], rb[1], rb[2], rb[3]); ctx.clip();
      text.draw(ctx, rb, { ...frame, box: rb, content: { md: String(md || ''), size: +size || 6.5, pad: 1 } }, env);
      ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = RULE; ctx.strokeRect(rb[0], rb[1], rb[2], rb[3]);
      y += h;
    }
  },
});
// A title block saved by an older compo (a group of text frames laid out by titleBlockFrames,
// rows unchanged) becomes ONE titleblock frame on load: the same rows, sizes and heights, the
// same place. A group anyone edited (a row's text changed, a frame moved off the stack) stays
// as it was — text frames still open; nothing is lost either way.
export function migrateTitleBlocks(doc) {
  const want = TITLE_BLOCK_ROWS.map((r) => r[0]);
  const groups = new Map();
  for (const f of doc.frames) if (f.group) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
  for (const fs of groups.values()) {
    if (fs.length !== want.length || !fs.every((f) => f.kind === 'text' && f.style && f.style.border)) continue;
    const st = fs.slice().sort((a, b) => a.box[1] - b.box[1]);
    if (st.some((f, i) => (f.content && f.content.md) !== want[i])) continue;
    const x = st[0].box[0], w = st[0].box[2];
    let flush = true;
    for (let i = 0; i < st.length; i++) {
      const b = st[i].box;
      if (Math.abs(b[0] - x) > 0.01 || Math.abs(b[2] - w) > 0.01 || (i && Math.abs(st[i - 1].box[1] + st[i - 1].box[3] - b[1]) > 0.02)) { flush = false; break; }
    }
    if (!flush) continue;
    const drop = new Set(fs), last = st[st.length - 1].box;
    let at = 0;                                             // where the group sat in the stacking order: before its first member
    for (const f of doc.frames) { if (drop.has(f)) break; at++; }
    const tb = { id: newId(doc, 'titleblock'), kind: 'titleblock', box: [x, st[0].box[1], w, +(last[1] + last[3] - st[0].box[1]).toFixed(2)],
      content: { rows: st.map((f) => [f.content.md, f.content.size || 6.5, f.box[3]]) }, ...(st[0].locked ? { locked: true } : {}), ...(st[0].produced ? { produced: st[0].produced } : {}) };
    doc.frames = doc.frames.filter((f) => !drop.has(f));
    doc.frames.splice(at, 0, tb);
  }
  return doc;
}
LOAD_MIGRATIONS.push(migrateTitleBlocks);
