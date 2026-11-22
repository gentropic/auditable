// Frame KINDS — each a small adapter that draws finished content into its box. The context is in
// MILLIMETRES (the page's units): a canvas scaled by px-per-mm for the screen and PNG, a @gcu/pdf
// page opened with units:'mm' for PDF — one drawing path for all three. Font sizes are given in
// points and converted. A host may register more kinds (registerKind).

export const SANS = "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONO = "'Space Mono', 'JetBrains Mono', Consolas, monospace";
const PT = 25.4 / 72;                                      // mm per point
const INK = '#1a1a1a';
export const fontMm = (pt, { mono = false, bold = false } = {}) => `${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : SANS}`;

const KINDS = new Map();
export function registerKind(kind, impl) { KINDS.set(kind, impl); }
export const kindOf = (k) => KINDS.get(k) || null;

// ── fields: {fig} {page} {pages} {date} {title} and ${expr} (the host evaluates) ──
export function resolveFields(src, env = {}, frame = null) {
  let s = String(src == null ? '' : src);
  s = s.replace(/\$\{([^}]*)\}/g, (_, expr) => {
    if (!env.evalField) return `⟨${expr}⟩`;
    try { const v = env.evalField(expr.trim(), env.vars || {}, frame); return v == null ? '' : String(v); } catch (e) { return `⟨${expr}: ${e.message}⟩`; }
  });
  const builtins = { page: env.page ?? 1, pages: env.pages ?? 1, date: env.date || new Date().toISOString().slice(0, 10), title: env.title || '' };
  return s.replace(/\{(fig|page|pages|date|title)\}/g, (_, k) => (k === 'fig' ? String(env.figOf ? env.figOf(frame) : 1) : String(builtins[k])));
}

// ── text: paragraphs (blank-line or newline separated), **bold** runs, word wrap to the box ──
function runsOf(line) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let at = 0, m;
  while ((m = re.exec(line))) { if (m.index > at) out.push({ t: line.slice(at, m.index), b: false }); out.push({ t: m[1], b: true }); at = m.index + m[0].length; }
  if (at < line.length) out.push({ t: line.slice(at), b: false });
  return out;
}
export function layoutText(ctx, text, width, { size = 9, mono = false, lineHeight = 1.25 } = {}) {
  const lines = [];
  const lh = size * PT * lineHeight;
  for (const para of String(text).split('\n')) {
    const words = [];
    for (const r of runsOf(para)) for (const w of r.t.split(/(\s+)/)) if (w) words.push({ t: w, b: r.b });
    let line = [], lw = 0;
    const flush = () => { while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop(); lines.push(line); line = []; lw = 0; };
    for (const w of words) {
      ctx.font = fontMm(size, { mono, bold: w.b });
      const ww = ctx.measureText(w.t).width;
      if (lw + ww > width && line.length && !/^\s+$/.test(w.t)) flush();
      if (!line.length && /^\s+$/.test(w.t)) continue;
      line.push({ ...w, w: ww }); lw += ww;
    }
    flush();
  }
  return { lines, lineHeight: lh };
}

registerKind('text', {
  label: 'text',
  draw(ctx, box, frame, env) {
    const c = frame.content || {};
    const size = +c.size || 9, mono = !!c.mono, pad = c.pad ?? 1;
    const text = resolveFields(c.md || '', env, frame);
    const { lines, lineHeight } = layoutText(ctx, text, box[2] - 2 * pad, { size, mono });
    ctx.fillStyle = c.color || INK; ctx.textBaseline = 'top';
    let y = box[1] + pad;
    for (const line of lines) {
      const tw = line.reduce((s, w) => s + w.w, 0);
      let x = c.align === 'center' ? box[0] + (box[2] - tw) / 2 : c.align === 'right' ? box[0] + box[2] - pad - tw : box[0] + pad;
      ctx.textAlign = 'left';
      // one string per same-weight run (a PDF gets one text object per run, not per word)
      for (let i = 0; i < line.length;) {
        let j = i, t = '', w = 0;
        while (j < line.length && line[j].b === line[i].b) { t += line[j].t; w += line[j].w; j++; }
        ctx.font = fontMm(size, { mono, bold: line[i].b }); ctx.fillText(t, x, y); x += w; i = j;
      }
      y += lineHeight;
    }
  },
});

// ── image: a bitmap the host decoded (frame._img) or the stored src; fit contain / cover / fill ──
registerKind('image', {
  label: 'image',
  draw(ctx, box, frame) {
    const c = frame.content || {};
    const img = frame._img;
    const iw = c.width || (img && img.width), ih = c.height || (img && img.height);
    if (!img || !iw || !ih) {                              // not decoded yet: a placeholder, never a blank hole
      ctx.fillStyle = '#e6e6e6'; ctx.fillRect(box[0], box[1], box[2], box[3]);
      ctx.fillStyle = '#888'; ctx.font = fontMm(8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.missing || 'image', box[0] + box[2] / 2, box[1] + box[3] / 2);
      return;
    }
    const fit = c.fit || 'contain';
    let w = box[2], h = box[3];
    if (fit !== 'fill') {
      const k = fit === 'cover' ? Math.max(box[2] / iw, box[3] / ih) : Math.min(box[2] / iw, box[3] / ih);
      w = iw * k; h = ih * k;
    }
    const x = box[0] + (box[2] - w) / 2, y = box[1] + (box[3] - h) / 2;
    ctx.imageSmoothingEnabled = c.smooth !== false;
    // a PDF page takes JPEG bytes as they are (a photo-like 3D render: a fraction of the size)
    const src = ctx.acceptsImageData && frame._jpeg ? frame._jpeg : img;
    ctx.drawImage(src, x, y, w, h);
  },
});

// ── drawlist: a @gcu/plot figure (fig.toDrawList()) — vector, replayed scaled into the box ──
export function replayDrawList(ctx, list) {
  for (const op of list.ops || []) {
    const [name, ...a] = op;
    if (name === 'set') { ctx[a[0]] = a[1]; continue; }
    if (name === 'image') {
      const [x, y, w, h, cols, rows, b64] = a;
      const bin = atob(b64), px = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
      const data = { width: cols, height: rows, data: px };
      const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      if (ctx.acceptsImageData) ctx.drawImage(data, x, y, w, h);
      else {
        const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cols, rows) : Object.assign(document.createElement('canvas'), { width: cols, height: rows });
        cv.getContext('2d').putImageData(new ImageData(px, cols, rows), 0, 0);
        ctx.drawImage(cv, x, y, w, h);
      }
      ctx.imageSmoothingEnabled = smooth;
      continue;
    }
    if (typeof ctx[name] === 'function') ctx[name](...a);
  }
}
registerKind('drawlist', {
  label: 'chart',
  draw(ctx, box, frame) {
    const list = frame.content && frame.content.list;
    if (!list || !list.width) return;
    const k = Math.min(box[2] / list.width, box[3] / list.height);
    ctx.save();
    ctx.translate(box[0] + (box[2] - list.width * k) / 2, box[1] + (box[3] - list.height * k) / 2);
    ctx.scale(k, k);
    replayDrawList(ctx, list);
    ctx.restore();
  },
});

// ── legend: classes (swatch + label) or a ramp (bar + ends), with a title ──
registerKind('legend', {
  label: 'legend',
  draw(ctx, box, frame) {
    const c = frame.content || {};
    const size = +c.size || 8, row = size * PT * 1.55, sw = size * PT * 1.1;
    let y = box[1] + 0.5;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = INK;
    if (c.title) { ctx.font = fontMm(size + 1, { bold: true }); ctx.fillText(c.title, box[0] + 0.5, y); y += row * 1.1; }
    ctx.font = fontMm(size);
    if (c.kind === 'ramp' && Array.isArray(c.stops) && c.stops.length) {
      const bh = Math.max(10, box[1] + box[3] - y - (c.tail ? row : 0) - 1), bw = sw * 1.2;
      const n = c.stops.length;
      for (let i = 0; i < n; i++) { ctx.fillStyle = c.stops[n - 1 - i]; ctx.fillRect(box[0] + 0.5, y + (i * bh) / n, bw, (bh / n) * (i < n - 1 ? 1.6 : 1)); }   // each step tucks under the next: no seams
      ctx.strokeStyle = '#555'; ctx.lineWidth = 0.15; ctx.strokeRect(box[0] + 0.5, y, bw, bh);
      ctx.fillStyle = INK; ctx.textBaseline = 'middle';
      ctx.fillText(c.hiLabel ?? String(c.hi ?? ''), box[0] + bw + 1.5, y + size * PT * 0.4);
      ctx.fillText(c.loLabel ?? String(c.lo ?? ''), box[0] + bw + 1.5, y + bh - size * PT * 0.4);
      y += bh + 1;
      if (c.tail) { ctx.fillStyle = c.tail.color; ctx.fillRect(box[0] + 0.5, y, sw, sw); ctx.fillStyle = INK; ctx.fillText(c.tail.label, box[0] + sw + 2, y + sw / 2); }
      return;
    }
    const entries = (c.entries || []).concat(c.tail ? [c.tail] : []);
    ctx.textBaseline = 'middle';
    for (const e of entries) {
      if (y + row > box[1] + box[3] + 0.5) break;
      ctx.fillStyle = e.color; ctx.fillRect(box[0] + 0.5, y, sw, sw);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.12; ctx.strokeRect(box[0] + 0.5, y, sw, sw);
      ctx.fillStyle = INK; ctx.fillText(String(e.label), box[0] + sw + 2, y + sw / 2);
      y += row;
    }
  },
});

// a nice length ≤ v: 1, 2, 5 × 10^k
export function niceBelow(v) {
  if (!(v > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}
// the world-per-mm a scale bar measures: its own, or the frame it refers to (content.of)
// A view frame may state its scale per IMAGE PIXEL (meta.worldPerPx): the mm then follow from how
// the image is fitted into its box right now, so resizing the frame keeps the bar true.
export function frameWorldPerMm(t) {
  const c = t.content || {}, m = c.meta || {};
  if (+m.worldPerMm > 0) return +m.worldPerMm;
  if (!(+m.worldPerPx > 0)) return null;
  const iw = c.width || (t._img && t._img.width), ih = c.height || (t._img && t._img.height);
  if (!iw || !ih) return null;
  const fit = c.fit || 'contain', b = t.box;
  if (fit === 'fill') return null;                         // stretched: no single scale
  const k = fit === 'cover' ? Math.max(b[2] / iw, b[3] / ih) : Math.min(b[2] / iw, b[3] / ih);   // mm per pixel
  return +m.worldPerPx / k;
}
const metaOf = (frame, doc) => {
  const c = frame.content || {};
  if (c.of && doc) {
    const t = doc.frames.find((f) => f.id === c.of);
    if (t && t.content && t.content.meta) return { ...t.content.meta, worldPerMm: frameWorldPerMm(t) };
    if (t) return {};
  }
  return c;
};
registerKind('scalebar', {
  label: 'scale bar',
  draw(ctx, box, frame, env) {
    const meta = metaOf(frame, env.doc), wpm = +meta.worldPerMm;
    const units = meta.units || 'm';
    ctx.fillStyle = INK; ctx.font = fontMm(8); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    if (!(wpm > 0)) { ctx.fillText('no scale (a perspective view)', box[0], box[1]); return; }
    const len = niceBelow(box[2] * 0.8 * wpm), barMm = len / wpm, n = 4, h = Math.min(2, box[3] * 0.25);
    const x0 = box[0] + (box[2] - barMm) / 2, y0 = box[1] + 0.5;
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : INK; ctx.fillRect(x0 + (i * barMm) / n, y0, barMm / n, h); }
    ctx.strokeStyle = INK; ctx.lineWidth = 0.2; ctx.strokeRect(x0, y0, barMm, h);
    ctx.fillStyle = INK; ctx.textAlign = 'center';
    const fmt = (v) => (v >= 1000 && units === 'm' ? `${+(v / 1000).toPrecision(3)} km` : `${+v.toPrecision(4)} ${units}`);
    ctx.fillText('0', x0, y0 + h + 0.8); ctx.fillText(fmt(len), x0 + barMm, y0 + h + 0.8);
  },
});
registerKind('north', {
  label: 'north arrow',
  draw(ctx, box, frame, env) {
    const meta = metaOf(frame, env.doc);
    if (meta.north === null) {                             // a view looking along north: no arrow to draw
      ctx.fillStyle = INK; ctx.font = fontMm(7); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N · out of the page', box[0] + box[2] / 2, box[1] + box[3] / 2);
      return;
    }
    const bearing = Number.isFinite(+meta.north) ? +meta.north : 0;   // degrees clockwise from page-up to north
    const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2 + 1.5, r = Math.min(box[2], box[3] - 4) / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((bearing * Math.PI) / 180);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.45, r * 0.7); ctx.lineTo(0, r * 0.35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = INK; ctx.lineWidth = 0.15;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * 0.45, r * 0.7); ctx.lineTo(0, r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = fontMm(9, { bold: true }); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, -r - 0.4);
    ctx.restore();
  },
});
