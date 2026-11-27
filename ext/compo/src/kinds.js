// Frame KINDS — each a small adapter that draws finished content into its box. The context is in
// MILLIMETRES (the page's units): a canvas scaled by px-per-mm for the screen and PNG, a @gcu/pdf
// page opened with units:'mm' for PDF — one drawing path for all three. Font sizes are given in
// points and converted. A host may register more kinds (registerKind).

import { SANS, MONO, SERIF, PT, INK, fontMm } from './type.js';
export { SANS, MONO, SERIF, fontMm };

const KINDS = new Map();
export function registerKind(kind, impl) { KINDS.set(kind, impl); }
export const kindOf = (k) => KINDS.get(k) || null;

// ── fields live in fields.js; resolveFields is re-exported from here for the kinds' sake ──
import { resolveFields, registerField, subjectFrame, formatNumber } from './fields.js';
import { hasProj, worldToPage, pageToWorld, drawTicks, imageRect, drawOverlays, drawVector } from './world.js';
export { resolveFields };

// ── PINS: what a label can point at. A picture of 3D space (content.meta.proj, the camera's matrix —
// world.js) or a frame whose KIND knows its own projection: kind.project(frame, p) → { x, y, inside } |
// null (page mm) and kind.unproject(frame, x, y) → p | null. A stereonet is the second: its points are
// DIRECTIONS on the sphere, and a label pins to one. The matrix-only things (border ticks, overlays,
// vector sections) keep asking hasProj. ──
export function canPin(f) { if (hasProj(f)) return true; const k = f && kindOf(f.kind); return !!(k && typeof k.project === 'function'); }
export function pinToPage(f, p) {
  if (hasProj(f)) return worldToPage(f, p);
  const k = kindOf(f.kind); try { return k && k.project ? k.project(f, p) : null; } catch { return null; }
}
export function pageToPin(f, x, y) {
  if (hasProj(f)) return pageToWorld(f, x, y, 0);
  const k = kindOf(f.kind); try { return k && k.unproject ? k.unproject(f, x, y) : null; } catch { return null; }
}
// the part of a pinnable frame its points can land in (an off-picture point's leader stops at its edge)
const pinRect = (f) => (hasProj(f) ? imageRect(f) : f.box);

// ── text: paragraphs (blank-line or newline separated), **bold** runs, word wrap to the box ──
// ── MARKDOWN, the part a figure needs. Blocks, one per line: '# ', '## ', '### ' headings · '- ' / '* '
// bullets and '1. ' numbered items (hanging indent) · '---' a rule · anything else a paragraph line (a blank
// line a gap). Inline: **bold**, *italic* or _italic_, `code`. Fields ({date} …) are resolved before this. ──
const HEAD = { 1: 1.6, 2: 1.3, 3: 1.12 };
function runsOf(line) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|`([^`]+)`/g;
  let at = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > at) out.push({ t: line.slice(at, m.index) });
    if (m[1] != null) out.push({ t: m[1], b: true });
    else if (m[2] != null || m[3] != null) out.push({ t: m[2] != null ? m[2] : m[3], i: true });
    else out.push({ t: m[4], m: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ t: line.slice(at) });
  return out;
}
const styleOf = (w, mono, serif, size) => fontMm(w.size || size, { mono: mono || !!w.m, serif: serif && !w.m, bold: !!w.b, italic: !!w.i });
// text → lines, each an array of measured words ({ t, b, i, m, size, w }) carrying its block's look:
// line.size, line.lh (its height, mm), line.indent (mm), line.marker ({ t, w } on a list item's first
// line), line.gap (space above, mm), line.rule (a horizontal rule). lineHeight is the body's.
export function layoutText(ctx, text, width, { size = 9, mono = false, serif = false, lineHeight = 1.25 } = {}) {
  const lines = [], body = size * PT * lineHeight;
  let prevBlock = null;
  for (const raw of String(text).split('\n')) {
    let para = raw, lsize = size, bold = false, marker = null, kind = 'p';
    const hd = /^(#{1,3})\s+(.*)$/.exec(para), li = /^\s*([-*•])\s+(.*)$/.exec(para), ol = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(para);
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(para)) {
      const r = []; r.rule = true; r.lh = body * 0.8; r.gap = 0; r.size = size; r.indent = 0; lines.push(r); prevBlock = 'rule'; continue;
    }
    if (hd) { kind = 'h'; lsize = size * HEAD[hd[1].length]; bold = true; para = hd[2]; }
    else if (li) { kind = 'li'; marker = '•'; para = li[2]; }
    else if (ol) { kind = 'li'; marker = ol[1] + '.'; para = ol[2]; }
    const lh = lsize * PT * lineHeight;
    // a heading gets air above it (not at the very top); list items sit together
    const gap = kind === 'h' && lines.length ? body * 0.45 : 0;
    let mk = null, indent = 0;
    if (marker) { ctx.font = fontMm(lsize, { mono, serif }); const mw = ctx.measureText(marker + ' ').width; mk = { t: marker, w: mw }; indent = Math.max(mw, lsize * PT * 1.1); }
    const words = [];
    for (const r of runsOf(para)) for (const t of r.t.split(/(\s+)/)) if (t) words.push({ t, b: r.b || bold, i: r.i, m: r.m, size: lsize });
    let line = [], lw = 0, first = true;
    const flush = () => {
      while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
      line.size = lsize; line.lh = lh; line.indent = indent; line.gap = first ? gap : 0;
      if (first && mk) line.marker = mk;
      lines.push(line); line = []; lw = 0; first = false;
    };
    for (const w of words) {
      ctx.font = styleOf(w, mono, serif, lsize);
      const ww = ctx.measureText(w.t).width;
      if (lw + ww > width - indent && line.length && !/^\s+$/.test(w.t)) flush();
      if (!line.length && /^\s+$/.test(w.t)) continue;
      line.push({ ...w, w: ww }); lw += ww;
    }
    flush();
    prevBlock = kind;
  }
  return { lines, lineHeight: body };
}
// lay out and draw markdown into a box (text frames, labels): { size, mono, serif, pad, align, color, lineHeight }
export function drawText(ctx, text, box, { size = 9, mono = false, serif = false, pad = 1, align = 'left', color = INK, lineHeight = 1.25, valign = 'top' } = {}) {
  const { lines } = layoutText(ctx, text, box[2] - 2 * pad, { size, mono, serif, lineHeight });
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const total = lines.reduce((s, l) => s + (l.gap || 0) + l.lh, 0);
  let y = box[1] + pad;
  if (valign === 'middle') y = box[1] + Math.max(pad, (box[3] - total) / 2);
  else if (valign === 'bottom') y = box[1] + Math.max(pad, box[3] - pad - total);
  for (const line of lines) {
    y += line.gap || 0;
    if (line.rule) { ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(box[0] + pad, y + line.lh / 2); ctx.lineTo(box[0] + box[2] - pad, y + line.lh / 2); ctx.stroke(); y += line.lh; continue; }
    const tw = line.reduce((s, w) => s + w.w, 0) + (line.indent || 0);
    const x0 = align === 'center' ? box[0] + (box[2] - tw) / 2 : align === 'right' ? box[0] + box[2] - pad - tw : box[0] + pad;
    if (line.marker) { ctx.font = fontMm(line.size, { mono, serif }); ctx.fillText(line.marker.t, x0, y); }
    let x = x0 + (line.indent || 0);
    // one string per run of the same look (a PDF gets one text object per run, not per word)
    for (let i = 0; i < line.length;) {
      const k = styleOf(line[i], mono, serif, line.size);
      let j = i, t = '', w = 0;
      while (j < line.length && styleOf(line[j], mono, serif, line.size) === k) { t += line[j].t; w += line[j].w; j++; }
      ctx.font = k; ctx.fillText(t, x, y); x += w; i = j;
    }
    y += line.lh;
  }
  return y - box[1];                                        // the height used (mm)
}

registerKind('text', {
  label: 'text',
  draw(ctx, box, frame, env) {
    const c = frame.content || {};
    const text = resolveFields(c.md || '', env, frame);
    const used = drawText(ctx, text, box, { size: +c.size || 9, mono: !!c.mono || c.font === 'mono', serif: c.font === 'serif', pad: c.pad ?? 1,
      align: c.align || 'left', color: c.color || INK, lineHeight: +c.lineHeight || 1.25, valign: c.valign || 'top' });
    frame._overflow = used > box[3] + 0.3 ? 'the text runs past the bottom of the frame' : undefined;   // the editor badges it
  },
});

// ── image: a bitmap the host decoded (frame._img) or the stored src; fit contain / cover / fill ──
registerKind('image', {
  label: 'image',
  draw(ctx, box, frame, env = {}) {
    const c = frame.content || {};
    const img = frame._img;
    const iw = c.width || (img && img.width), ih = c.height || (img && img.height);
    if (!img || !iw || !ih) {                              // not decoded yet: a placeholder, never a blank hole
      ctx.fillStyle = '#e6e6e6'; ctx.fillRect(box[0], box[1], box[2], box[3]);
      ctx.fillStyle = '#888'; ctx.font = fontMm(8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.missing || 'image', box[0] + box[2] / 2, box[1] + box[3] / 2);
      if (c.ticks && c.ticks !== 'off' && hasProj(frame) && iw && ih) drawTicks(ctx, frame, c.ticks);   // the coordinates are known without the picture
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
    if (c.vector && c.vectorOn !== false && hasProj(frame)) drawVector(ctx, frame, x, y, w, h);   // a vector section: cells, then the other layers' transparent render
    else {
      const src = ctx.acceptsImageData && frame._jpeg ? frame._jpeg : img;
      ctx.drawImage(src, x, y, w, h);
    }
    // a picture of 3D space (meta.proj) may wear its coordinates: ticks on the border, or a grid
    if (c.ticks && c.ticks !== 'off' && hasProj(frame)) drawTicks(ctx, frame, c.ticks);
    // world overlays: its own (content.overlays) and the host's (env.overlaysFor — a key plan's section)
    if (hasProj(frame)) drawOverlays(ctx, frame, [...(c.overlays || []), ...((env.overlaysFor && env.overlaysFor(frame, env)) || [])]);
  },
});

// ── label: text pinned to a WORLD point. The box holds the text, wherever you put it; a leader runs
// to where content.at lands in the view it refers to (content.of, else the nearest frame it can pin
// to) — so the label follows its point when the view is rendered again. On a stereonet the point is a
// direction (see PINS above). ──
registerKind('label', {
  label: 'label',
  overflow: true,                                          // the leader leaves the box: not clipped to it
  draw(ctx, box, frame, env) {
    const c = frame.content || {}, size = +c.size || 7, pad = 0.8;
    const text = resolveFields(c.text != null ? c.text : (c.md || ''), env, frame);
    let anc = null, off = false;
    if (Array.isArray(c.at) && c.at.length === 3 && env.doc) {
      const v = subjectFrame(env, frame, canPin);
      if (v && canPin(v)) {
        const p = pinToPage(v, c.at.map(Number));
        if (p && p.inside) anc = p;
        else if (p) {
          // the point is outside the picture: the leader stops at the picture's edge, toward it, with an arrowhead
          const r = pinRect(v), cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2, dx = p.x - cx, dy = p.y - cy;
          let t = 1;
          for (const [d, lo, hi, o] of [[dx, r[0], r[0] + r[2], cx], [dy, r[1], r[1] + r[3], cy]]) if (d) { const tt = ((d > 0 ? hi : lo) - o) / d; if (tt > 0) t = Math.min(t, tt); }
          if (t > 0 && t < 1) { anc = { x: cx + dx * t, y: cy + dy * t }; off = true; }
        }
      }
    }
    // the words' own extent: the backing hugs them (a box-sized backing whited out what the label points at),
    // and the leader leaves from it
    const font = { mono: c.font === 'mono', serif: c.font === 'serif' };
    const lay = layoutText(ctx, text, box[2] - 2 * pad, { size, ...font });
    const tw = Math.min(box[2], Math.max(0, ...lay.lines.map((l) => l.reduce((s, w) => s + w.w, 0) + (l.indent || 0))) + 2 * pad);
    const th = Math.min(box[3], lay.lines.reduce((s, l) => s + (l.gap || 0) + l.lh, 0) + 2 * pad);
    const hx = c.align === 'center' ? box[0] + (box[2] - tw) / 2 : c.align === 'right' ? box[0] + box[2] - tw : box[0];
    const hug = [hx, box[1], tw, th];
    const leader = c.leader || 'line', ink = c.color || INK;
    const head = (x, y, fx, fy) => {                     // an arrowhead at (x, y), pointing away from (fx, fy)
      const a = Math.atan2(y - fy, x - fx), L = 1.6;
      ctx.fillStyle = ink; ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - L * Math.cos(a - 0.4), y - L * Math.sin(a - 0.4)); ctx.lineTo(x - L * Math.cos(a + 0.4), y - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
    };
    if (anc && leader !== 'none') {
      const inHug = anc.x >= hug[0] && anc.x <= hug[0] + hug[2] && anc.y >= hug[1] && anc.y <= hug[1] + hug[3];
      const ex = Math.max(hug[0], Math.min(hug[0] + hug[2], anc.x)), ey = Math.max(hug[1], Math.min(hug[1] + hug[3], anc.y));
      if (!inHug) { ctx.strokeStyle = ink; ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(anc.x, anc.y); ctx.stroke(); }
      if (off || leader === 'arrow') head(anc.x, anc.y, ex, ey);
      else { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(anc.x, anc.y, 0.55, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(box[0], box[1], box[2], box[3]); ctx.clip();
    if (c.backing !== false) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(hug[0], hug[1], hug[2], hug[3]); }
    const used = drawText(ctx, text, box, { size, pad, color: c.color || INK, mono: c.font === 'mono', serif: c.font === 'serif', align: c.align || 'left' });
    frame._overflow = used > box[3] + 0.3 ? 'the label’s text runs past its box' : undefined;
    ctx.restore();
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
// A legend's DATA (entries, the ramp) is the host's: a refresh replaces it. What you SET lives beside it and
// survives a refresh — content.edit (per entry, by its key: { label, color, hidden }), content.order (keys),
// columns, swatch ('square' | 'circle' | 'line'), size, textColor, and the title once you've typed one
// (titleUser). refreshLegend is the merge every host uses.
export const LEGEND_USER_KEYS = ['edit', 'order', 'columns', 'swatch', 'size', 'textColor', 'titleUser'];
export function refreshLegend(old = {}, fresh = {}) {
  const out = { ...fresh };
  for (const k of LEGEND_USER_KEYS) if (old[k] !== undefined) out[k] = old[k];
  if (old.titleUser) out.title = old.title;
  return out;
}
export const legendKey = (e) => String(e.key != null ? e.key : e.label);
// the entries as drawn: the host's, with your edits, in your order (hidden ones included, flagged)
export function legendEntries(c) {
  const edit = c.edit || {};
  let es = (c.entries || []).map((e, i) => ({ ...e, ...(edit[legendKey(e)] || {}), _key: legendKey(e), _i: i }));
  if (Array.isArray(c.order) && c.order.length) {
    const pos = new Map(c.order.map((k, i) => [k, i]));
    es.sort((a, b) => (pos.has(a._key) ? pos.get(a._key) : 1e6 + a._i) - (pos.has(b._key) ? pos.get(b._key) : 1e6 + b._i));
  }
  return es;
}
registerKind('legend', {
  label: 'legend',
  draw(ctx, box, frame, env) {
    const c = frame.content || {}, ink = c.textColor || INK;
    const title = c.title ? resolveFields(c.title, env, frame) : '';
    const size = +c.size || 8, row = size * PT * 1.55, sw = size * PT * 1.1;
    let y = box[1] + 0.5;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = ink;
    if (title) { ctx.font = fontMm(size + 1, { bold: true }); ctx.fillText(title, box[0] + 0.5, y); y += row * 1.1; }
    ctx.font = fontMm(size);
    if (c.kind === 'ramp' && Array.isArray(c.stops) && c.stops.length) {
      const bh = Math.max(10, box[1] + box[3] - y - (c.tail ? row : 0) - 1), bw = sw * 1.2;
      const n = c.stops.length;
      for (let i = 0; i < n; i++) { ctx.fillStyle = c.stops[n - 1 - i]; ctx.fillRect(box[0] + 0.5, y + (i * bh) / n, bw, (bh / n) * (i < n - 1 ? 1.6 : 1)); }   // each step tucks under the next: no seams
      ctx.strokeStyle = '#555'; ctx.lineWidth = 0.15; ctx.strokeRect(box[0] + 0.5, y, bw, bh);
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      const ed = c.edit || {};
      ctx.fillText(ed.hiLabel ?? c.hiLabel ?? String(c.hi ?? ''), box[0] + bw + 1.5, y + size * PT * 0.4);
      ctx.fillText(ed.loLabel ?? c.loLabel ?? String(c.lo ?? ''), box[0] + bw + 1.5, y + bh - size * PT * 0.4);
      y += bh + 1;
      if (c.tail) { ctx.fillStyle = c.tail.color; ctx.fillRect(box[0] + 0.5, y, sw, sw); ctx.fillStyle = ink; ctx.fillText(c.tail.label, box[0] + sw + 2, y + sw / 2); }
      return;
    }
    const entries = legendEntries(c).filter((e) => !e.hidden).concat(c.tail ? [c.tail] : []);
    const cols = Math.max(1, Math.min(6, Math.round(+c.columns || 1))), colW = (box[2] - 0.5) / cols;
    ctx.textBaseline = 'middle';
    let cut = 0;
    entries.forEach((e, i) => {
      const cx = box[0] + 0.5 + (i % cols) * colW, cy = y + Math.floor(i / cols) * row;
      if (cy + row > box[1] + box[3] + 0.5) { cut++; return; }
      const shape = e.swatch || c.swatch || 'square';
      ctx.fillStyle = e.color; ctx.strokeStyle = e.color;
      if (shape === 'circle') { ctx.beginPath(); ctx.arc(cx + sw / 2, cy + sw / 2, sw * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.12; ctx.stroke(); }
      else if (shape === 'line') { ctx.lineWidth = Math.max(0.3, sw * 0.18); ctx.beginPath(); ctx.moveTo(cx, cy + sw / 2); ctx.lineTo(cx + sw * 1.4, cy + sw / 2); ctx.stroke(); }
      else { ctx.fillRect(cx, cy, sw, sw); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.12; ctx.strokeRect(cx, cy, sw, sw); }
      ctx.fillStyle = ink; ctx.fillText(String(e.label), cx + (shape === 'line' ? sw * 1.4 : sw) + 2, cy + sw / 2);
    });
    frame._overflow = cut ? `${cut} entr${cut === 1 ? 'y doesn’t' : 'ies don’t'} fit — more columns, or a taller frame` : undefined;
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
// {scale} — the representative fraction of a view frame (the field's @id, the caption's "refers
// to", else the nearest frame that states a scale). A perspective view has none, and says so.
const hasScaleMeta = (f) => !!(f.content && f.content.meta && (f.content.meta.worldPerPx > 0 || f.content.meta.worldPerMm > 0 || 'worldPerPx' in f.content.meta || 'ortho' in f.content.meta));
const UNIT_MM = { m: 1000, km: 1e6, ft: 304.8, mm: 1, cm: 10 };
registerField('scale', (a, frame, env) => {
  const t = subjectFrame(env, frame, hasScaleMeta);
  if (!t) return '—';
  const wpm = frameWorldPerMm(t);
  if (!(wpm > 0)) return 'no scale (perspective)';
  const n = wpm * (UNIT_MM[(t.content.meta.units || 'm')] || 1000);
  const r = +n.toPrecision(n >= 1000 ? 3 : 2);
  return '1 : ' + String(Math.round(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}, 'the scale of the view: 1 : 2 500 (orthographic views only) · {scale@plan}');
// a scale bar / north arrow: its own numbers, or the view it refers to (content.of), else the nearest view
const metaOf = (frame, doc) => {
  const c = frame.content || {};
  const own = c.worldPerMm != null || c.north !== undefined;
  if (doc && (c.of || !own)) {
    const t = subjectFrame({ doc }, frame, hasScaleMeta);
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
      // the axis-out-of-the-page sign (⊙) under its N, and the words under it — their type
      // shrunk, and broken onto two lines, until they fit the frame (it used to read “out of the p”)
      const x = box[0] + box[2] / 2, W = box[2] * 0.94;
      let size = 7, lines = ['out of the page'];
      ctx.font = fontMm(size);
      if (ctx.measureText(lines[0]).width > W) {
        lines = ['out of', 'the page'];
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        if (w > W) size = Math.max(3.5, size * (W / w));
      }
      const lh = size * PT * 1.15, nh = 8 * PT;            // a text line · the N's height
      const r = Math.max(0.8, Math.min(box[2] * 0.22, (box[3] - nh - lines.length * lh - 1.2) / 2));
      const top = box[1] + Math.max(0, (box[3] - (nh + 2 * r + lines.length * lh + 1.2)) / 2);
      const cy = top + nh + 0.4 + r;
      ctx.fillStyle = INK; ctx.font = fontMm(8, { bold: true }); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('N', x, cy - r - 0.3);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, cy, Math.max(0.25, r * 0.22), 0, 2 * Math.PI); ctx.fill();
      ctx.font = fontMm(size); ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, x, cy + r + 0.8 + i * lh));
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

// ── table: a title, a header row and rows — book style (a rule above and below, a thin one under
// the header, no vertical lines), numbers right-aligned, light striping. The type shrinks to fit
// the box's width (down to 4.5 pt); rows that don't fit say how many were left out.
// content: { title, columns: [..], rows: [[..]], size (pt), zebra, align: ['l'|'r'|'c', …], note }
const NUMERIC = /^[-+−]?(\d[\d,  ]*)?(\.\d+)?([eE][-+]?\d+)?\s*%?$/;
// a cell as shown: a number's float noise (1.0823529411764705, 2559000.0000000005) at six significant
// figures — the integer part never rounded away — everything else as written
const cellText = (v) => (v == null ? '' : typeof v === 'number' ? formatNumber(v) : /^[-+]?\d*\.\d{7,}(?:e[-+]?\d+)?$/i.test(String(v).trim()) ? formatNumber(+v) : String(v));
registerKind('table', {
  label: 'table',
  draw(ctx, box, frame, env) {
    const c = frame.content || {}, cols = (c.columns || []).map(String), rows = (c.rows || []).map((r) => (r || []).map(cellText));
    if (!cols.length) return;
    const pad = 1.1, avail = box[2] - 0.5;
    const isNum = cols.map((_, j) => (c.align && c.align[j]) ? c.align[j] === 'r' : rows.length > 0 && rows.every((r) => r[j] === '' || NUMERIC.test(r[j].trim())));
    let size = +c.size || 7.5, widths;
    for (let pass = 0; pass < 8; pass++) {                 // shrink the type until the natural widths fit
      widths = cols.map((h, j) => {
        ctx.font = fontMm(size, { bold: true }); let w = ctx.measureText(h).width;
        ctx.font = fontMm(size);
        for (const r of rows) w = Math.max(w, ctx.measureText(r[j] || '').width);
        return w + 2 * pad;
      });
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum <= avail || size <= 4.5) { const extra = Math.max(0, avail - sum); widths = widths.map((w) => w + extra * (w / sum)); break; }
      size = Math.max(4.5, size * (avail / sum) * 0.98);
    }
    const lh = size * PT * 1.55;
    let y = box[1] + 0.3;
    ctx.textBaseline = 'middle';
    const title = c.title ? resolveFields(c.title, env, frame) : '', note = c.note ? resolveFields(c.note, env, frame) : '';
    if (title) { ctx.fillStyle = INK; ctx.font = fontMm(size + 1, { bold: true }); ctx.textAlign = 'left'; ctx.fillText(title, box[0], y + lh * 0.5); y += lh * 1.15; }
    const x0 = box[0], x1 = box[0] + widths.reduce((a, b) => a + b, 0);
    const rule = (yy, w) => { ctx.strokeStyle = INK; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); };
    const cells = (vals, yy, bold) => {
      let x = x0;
      ctx.font = fontMm(size, { bold }); ctx.fillStyle = INK;
      vals.forEach((v, j) => {
        const a = (c.align && c.align[j]) || (isNum[j] ? 'r' : 'l');
        ctx.textAlign = a === 'r' ? 'right' : a === 'c' ? 'center' : 'left';
        ctx.fillText(v, a === 'r' ? x + widths[j] - pad : a === 'c' ? x + widths[j] / 2 : x + pad, yy + lh / 2);
        x += widths[j];
      });
    };
    rule(y, 0.35);
    cells(cols, y, true); y += lh;
    rule(y, 0.18);
    const bottom = box[1] + box[3] - (note ? lh : 0) - 0.5;
    const fit = Math.max(0, Math.floor((bottom - y) / lh));
    const shown = rows.length > fit ? Math.max(0, fit - 1) : rows.length;
    for (let i = 0; i < shown; i++) {
      if (c.zebra !== false && i % 2 === 1) { ctx.fillStyle = 'rgba(0,0,0,0.045)'; ctx.fillRect(x0, y, x1 - x0, lh); }
      cells(rows[i], y, false); y += lh;
    }
    frame._overflow = shown < rows.length ? `${rows.length - shown} row${rows.length - shown === 1 ? '' : 's'} don’t fit` : undefined;
    if (shown < rows.length) { ctx.fillStyle = '#666'; ctx.font = fontMm(size); ctx.textAlign = 'left'; ctx.fillText(`… ${rows.length - shown} more row${rows.length - shown === 1 ? '' : 's'}`, x0 + pad, y + lh / 2); y += lh; }
    rule(y, 0.35);
    if (note) { ctx.fillStyle = '#555'; ctx.font = fontMm(size - 0.5); ctx.textAlign = 'left'; ctx.fillText(note, x0, y + lh * 0.55); }
  },
});
// a TSV (an analysis window's ⧉ table) → table content
export function tableFromTsv(tsv, title = '') {
  const lines = String(tsv || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return null;
  const [head, ...body] = lines.map((l) => l.split('\t'));
  return { title, columns: head, rows: body };
}
