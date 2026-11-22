// Drawing a page, and exporting it. ONE drawing path: renderPage draws in millimetres onto any 2D
// context — the editor's canvas (scaled to the zoom), a PNG canvas (scaled to the DPI), a @gcu/pdf
// page (units mm). Each frame is clipped to its box, its background under it and its border over.

import { pageDims } from './model.js';
import { kindOf, fontMm } from './kinds.js';
import { PdfDocument } from '../../pdf/src/main.js';

// figure numbers: text frames that say {fig}, numbered in page order (back-to-front), from env.figStart
function figNumbering(doc, env) {
  const order = doc.frames.filter((f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || ''));
  return (frame) => (env.figStart || 1) + Math.max(0, order.indexOf(frame));
}

export function renderPage(doc, ctx, env = {}) {
  const [W, H] = pageDims(doc.page);
  const e = { ...env, doc, title: env.title ?? doc.title, figOf: env.figOf || figNumbering(doc, env) };
  if (env.background !== false) { ctx.fillStyle = doc.page.background || '#ffffff'; ctx.fillRect(0, 0, W, H); }
  for (const f of doc.frames) {
    if (f.hidden) continue;
    const kind = kindOf(f.kind), b = f.box, st = f.style || {};
    ctx.save();
    if (st.background) { ctx.fillStyle = st.background; ctx.fillRect(b[0], b[1], b[2], b[3]); }
    ctx.beginPath(); ctx.rect(b[0], b[1], b[2], b[3]); ctx.clip();
    if (kind) {
      try { kind.draw(ctx, b, f, e); } catch (err) { drawError(ctx, b, `${f.kind}: ${err.message}`); }
    } else drawError(ctx, b, `no frame kind “${f.kind}”`);
    ctx.restore();
    if (st.border) { ctx.save(); ctx.strokeStyle = st.borderColor || '#1a1a1a'; ctx.lineWidth = st.borderWidth || 0.25; ctx.strokeRect(b[0], b[1], b[2], b[3]); ctx.restore(); }
  }
}
function drawError(ctx, b, msg) {
  ctx.fillStyle = '#fbe9e9'; ctx.fillRect(b[0], b[1], b[2], b[3]);
  ctx.fillStyle = '#a3262a'; ctx.font = fontMm(7); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(msg, b[0] + 1, b[1] + 1);
}

// decode every image frame's stored src into frame._img (a host may have set _img already). An
// <img> decodes it, not fetch(): a sealed page (CSP connect-src 'none') may still show data: images.
export async function ensureImages(doc) {
  await Promise.all(doc.frames.filter((f) => f.kind === 'image' && !f._img && f.content && f.content.src).map(async (f) => {
    try {
      if (typeof Image !== 'undefined') {
        const im = new Image(); im.src = f.content.src; await im.decode();
        f._img = typeof createImageBitmap !== 'undefined' ? await createImageBitmap(im) : im;
      } else f._img = await createImageBitmap(await (await fetch(f.content.src)).blob());   // a worker
    } catch { f.content.missing = 'image not readable'; }
  }));
}

const newCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// JPEG bytes for the frames marked photo-like (3D renders): a PDF embeds them as they are
async function jpegFor(f, quality) {
  const img = f._img; if (!img) return;
  const cv = newCanvas(img.width, img.height);
  cv.getContext('2d').drawImage(img, 0, 0);
  const blob = cv.convertToBlob ? await cv.convertToBlob({ type: 'image/jpeg', quality }) : await new Promise((r) => cv.toBlob(r, 'image/jpeg', quality));
  f._jpeg = { jpeg: new Uint8Array(await blob.arrayBuffer()), width: img.width, height: img.height };
}

// one or more pages (an atlas: a list of documents) → PDF bytes. opts: { env, title, created,
// dpi (for env.prepare), jpegQuality (photo frames; 0 = lossless), onWarn }. env.prepare(doc,
// { dpi, page }) is the host's hook to re-render its frames at print resolution first.
export async function exportPDF(docs, opts = {}) {
  const list = Array.isArray(docs) ? docs : [docs];
  const env = opts.env || {};
  const pdf = new PdfDocument({ title: opts.title || list[0].title || undefined, creator: opts.creator || '@gcu/compo', created: opts.created, onWarn: opts.onWarn, ...(opts.compress === false ? { compress: false } : {}) });
  for (let i = 0; i < list.length; i++) {
    const doc = list[i];
    if (env.prepare) await env.prepare(doc, { dpi: opts.dpi || 300, page: i + 1 });
    await ensureImages(doc);
    const q = opts.jpegQuality ?? 0.92;
    for (const f of doc.frames) { f._jpeg = null; if (q > 0 && f.kind === 'image' && f.content && f.content.photo) await jpegFor(f, q); }
    const [W, H] = pageDims(doc.page);
    const ctx = pdf.addPage({ width: (W * 72) / 25.4, height: (H * 72) / 25.4 }).getContext('2d', { units: 'mm' });
    renderPage(doc, ctx, { ...env, page: i + 1, pages: list.length });
  }
  return pdf.save();
}

// a page → a PNG Blob at `dpi`
export async function exportPNG(doc, opts = {}) {
  const env = opts.env || {}, dpi = opts.dpi || 200;
  if (env.prepare) await env.prepare(doc, { dpi, page: 1 });
  await ensureImages(doc);
  const [W, H] = pageDims(doc.page), k = dpi / 25.4;
  const cv = newCanvas(Math.round(W * k), Math.round(H * k));
  const g = cv.getContext('2d');
  g.scale(k, k);
  renderPage(doc, g, { ...env, page: 1, pages: 1 });
  return cv.convertToBlob ? cv.convertToBlob({ type: 'image/png' }) : new Promise((r) => cv.toBlob(r, 'image/png'));
}
