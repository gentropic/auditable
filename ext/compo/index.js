// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/compo — A figure / page composer: a page (A5–A2, Letter, custom mm; portrait or landscape) with frames placed freely on it — renders, plots, legends, scale bars, north arrows, captions with fields — drawn by one path onto a canvas, a PNG or a vector PDF (@gcu/pdf). A host-agnostic DOM editor (move, resize, snap, align, distribute, undo). Plain-JSON documents.

// ── src/model.js ──

// The compo document: a PAGE (size, orientation, margins — millimetres) and FRAMES on it, each a
// box [x, y, w, h] in mm from the page's top-left holding finished content of one KIND. Plain
// JSON (.compo.json): the whole figure, rebuildable. Frames may carry `source` (where the
// content came from, for a host that can refresh it) and `produced` (when).

const COMPO_FORMAT = 'compo';
const COMPO_VERSION = 1;

// paper sizes in mm, portrait
const PAPER = {
  A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};

// { size: 'A4' | 'custom', orientation: 'portrait' | 'landscape', width, height (mm, custom), margins: [t, r, b, l] }
function pageDims(page) {
  const p = page || {};
  if (p.size === 'custom' || !PAPER[p.size]) return [Math.max(10, +p.width || 210), Math.max(10, +p.height || 297)];
  const [a, b] = PAPER[p.size];
  return p.orientation === 'landscape' ? [b, a] : [a, b];
}

function createDocument({ page = {}, theme = 'paper', title = '' } = {}) {
  return {
    format: COMPO_FORMAT, version: COMPO_VERSION, title,
    page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12], ...page },
    theme, frames: [],
  };
}

// a document from JSON (or an object), checked; unknown frame kinds are kept (a host may add kinds)
function parseDocument(src) {
  const d = typeof src === 'string' ? JSON.parse(src) : src;
  if (!d || d.format !== COMPO_FORMAT) throw new Error('compo: not a compo document (format must be "compo")');
  if (d.version !== COMPO_VERSION) throw new Error(`compo: document version ${d.version} (this reads ${COMPO_VERSION})`);
  if (!Array.isArray(d.frames)) throw new Error('compo: the document has no frames list');
  for (const f of d.frames) {
    if (!f || typeof f.id !== 'string' || typeof f.kind !== 'string' || !Array.isArray(f.box) || f.box.length !== 4) throw new Error(`compo: a frame needs an id, a kind and a box [x, y, w, h] (${JSON.stringify(f && f.id)})`);
  }
  return d;
}
// JSON for saving: frames' runtime-only fields (a decoded bitmap) are dropped
function serializeDocument(doc) {
  return JSON.stringify(doc, (k, v) => (k.startsWith('_') ? undefined : v), 1);
}

let _seq = 0;
function newId(doc, kind) {
  const used = new Set((doc.frames || []).map((f) => f.id));
  let id;
  do id = `${kind}-${(++_seq).toString(36)}`; while (used.has(id));
  return id;
}

// add a frame: { kind, box?, content, source?, style? } → the frame (placed in the margins, or
// centred, when no box is given)
function addFrame(doc, frame) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [0, 0, 0, 0];
  const box = frame.box || [m[3] + 10, m[0] + 10, Math.min(120, W - m[1] - m[3] - 20), Math.min(80, H - m[0] - m[2] - 20)];
  const f = { id: frame.id || newId(doc, frame.kind), kind: frame.kind, box: box.map(Number), content: frame.content || {}, ...(frame.source ? { source: frame.source } : {}), ...(frame.style ? { style: frame.style } : {}), produced: frame.produced || new Date().toISOString() };
  doc.frames.push(f);
  return f;
}
const frameById = (doc, id) => doc.frames.find((f) => f.id === id) || null;
function removeFrames(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => !s.has(f.id)); }

// z-order: the frames list is back-to-front
function bringToFront(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => !s.has(f.id)).concat(doc.frames.filter((f) => s.has(f.id))); }
function sendToBack(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => s.has(f.id)).concat(doc.frames.filter((f) => !s.has(f.id))); }

// align the frames (by id) to their joint bounds: left · hcenter · right · top · vcenter · bottom
function alignFrames(doc, ids, how) {
  const fs = ids.map((id) => frameById(doc, id)).filter((f) => f && !f.locked);
  if (fs.length < 2) return;
  const x0 = Math.min(...fs.map((f) => f.box[0])), y0 = Math.min(...fs.map((f) => f.box[1]));
  const x1 = Math.max(...fs.map((f) => f.box[0] + f.box[2])), y1 = Math.max(...fs.map((f) => f.box[1] + f.box[3]));
  for (const f of fs) {
    const b = f.box;
    if (how === 'left') b[0] = x0; else if (how === 'right') b[0] = x1 - b[2]; else if (how === 'hcenter') b[0] = (x0 + x1) / 2 - b[2] / 2;
    else if (how === 'top') b[1] = y0; else if (how === 'bottom') b[1] = y1 - b[3]; else if (how === 'vcenter') b[1] = (y0 + y1) / 2 - b[3] / 2;
  }
}
// equal gaps between the frames along 'h' or 'v' (the outer two stay)
function distributeFrames(doc, ids, axis) {
  const fs = ids.map((id) => frameById(doc, id)).filter((f) => f && !f.locked);
  if (fs.length < 3) return;
  const k = axis === 'v' ? 1 : 0;
  fs.sort((a, b) => a.box[k] - b.box[k]);
  const first = fs[0].box, last = fs[fs.length - 1].box;
  const span = last[k] + last[k + 2] - first[k], used = fs.reduce((s, f) => s + f.box[k + 2], 0);
  const gap = (span - used) / (fs.length - 1);
  let at = first[k];
  for (const f of fs) { f.box[k] = at; at += f.box[k + 2] + gap; }
}

// snapping: a moving box's edges and centre snap to the page margins / centre lines and to other
// frames' edges and centres within `tol` mm → the snapped box and the guide lines used
function snapBox(doc, box, { ignore = [], tol = 1.5 } = {}) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [0, 0, 0, 0];
  const xs = [0, m[3], W / 2, W - m[1], W], ys = [0, m[0], H / 2, H - m[2], H];
  const skip = new Set(ignore);
  for (const f of doc.frames) {
    if (skip.has(f.id)) continue;
    xs.push(f.box[0], f.box[0] + f.box[2] / 2, f.box[0] + f.box[2]);
    ys.push(f.box[1], f.box[1] + f.box[3] / 2, f.box[1] + f.box[3]);
  }
  const out = box.slice(), guides = { x: null, y: null };
  const best = (cands, edges) => {
    let pick = null;
    for (const [off, e] of edges) for (const c of cands) { const d = c - e; if (Math.abs(d) <= tol && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, line: c, off }; }
    return pick;
  };
  const sx = best(xs, [[0, box[0]], [0.5, box[0] + box[2] / 2], [1, box[0] + box[2]]]);
  if (sx) { out[0] += sx.d; guides.x = sx.line; }
  const sy = best(ys, [[0, box[1]], [0.5, box[1] + box[3] / 2], [1, box[1] + box[3]]]);
  if (sy) { out[1] += sy.d; guides.y = sy.line; }
  return { box: out, guides };
}

// ── src/kinds.js ──

// Frame KINDS — each a small adapter that draws finished content into its box. The context is in
// MILLIMETRES (the page's units): a canvas scaled by px-per-mm for the screen and PNG, a @gcu/pdf
// page opened with units:'mm' for PDF — one drawing path for all three. Font sizes are given in
// points and converted. A host may register more kinds (registerKind).

const SANS = "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Space Mono', 'JetBrains Mono', Consolas, monospace";
const PT = 25.4 / 72;                                      // mm per point
const INK = '#1a1a1a';
const fontMm = (pt, { mono = false, bold = false } = {}) => `${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : SANS}`;

const KINDS = new Map();
function registerKind(kind, impl) { KINDS.set(kind, impl); }
const kindOf = (k) => KINDS.get(k) || null;

// ── fields: {fig} {page} {pages} {date} {title} and ${expr} (the host evaluates) ──
function resolveFields(src, env = {}, frame = null) {
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
function layoutText(ctx, text, width, { size = 9, mono = false, lineHeight = 1.25 } = {}) {
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
function replayDrawList(ctx, list) {
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
function niceBelow(v) {
  if (!(v > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}
// the world-per-mm a scale bar measures: its own, or the frame it refers to (content.of)
// A view frame may state its scale per IMAGE PIXEL (meta.worldPerPx): the mm then follow from how
// the image is fitted into its box right now, so resizing the frame keeps the bar true.
function frameWorldPerMm(t) {
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

// ── ../pdf/src/color.js ──

// CSS colour strings → [r, g, b] in 0..1 plus an alpha, for the PDF operators (rg / RG and an
// ExtGState's ca / CA). The forms canvas code actually hands a context: #rgb #rgba #rrggbb
// #rrggbbaa, rgb()/rgba() with commas or spaces (numbers or percentages, a slash alpha), and
// the named colours. Anything else is null — the context warns and keeps the previous colour.

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', teal: '#008080', navy: '#000080', fuchsia: '#ff00ff',
  purple: '#800080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  dimgray: '#696969', dimgrey: '#696969', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b',
  steelblue: '#4682b4', tomato: '#ff6347', coral: '#ff7f50', crimson: '#dc143c', khaki: '#f0e68c',
  salmon: '#fa8072', tan: '#d2b48c', beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa', whitesmoke: '#f5f5f5',
  slategray: '#708090', slategrey: '#708090', skyblue: '#87ceeb', royalblue: '#4169e1', seagreen: '#2e8b57',
  forestgreen: '#228b22', darkorange: '#ff8c00', chocolate: '#d2691e', sienna: '#a0522d', firebrick: '#b22222',
};

const chan = (s, max) => (String(s).endsWith('%') ? (parseFloat(s) / 100) * max : parseFloat(s));

// → { rgb: [r, g, b] 0..1, a: 0..1 } or null
function parseCssColor(c) {
  if (c == null) return null;
  let s = String(c).trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return { rgb: [0, 0, 0], a: 0 };
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    const v = [0, 2, 4, 6].map((k) => (k < h.length ? parseInt(h.slice(k, k + 2), 16) : 255));
    return { rgb: [v[0] / 255, v[1] / 255, v[2] / 255], a: v[3] / 255 };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const rgb = parts.slice(0, 3).map((p) => Math.max(0, Math.min(255, chan(p, 255))) / 255);
    const a = parts.length > 3 ? Math.max(0, Math.min(1, chan(parts[3], 1))) : 1;
    return rgb.every((v) => v === v) && a === a ? { rgb, a } : null;
  }
  return null;
}

// ── ../pdf/src/fonts.js ──

// The PDF STANDARD fonts — Helvetica, Courier, Times, each with a bold face — which every PDF
// reader carries, so nothing is embedded and a page stays a few KB. A CSS font string picks one:
// a monospace stack → Courier, a serif stack → Times, anything else → Helvetica. Courier is
// exactly 0.6 em a glyph, which is the advance @gcu/plot lays every label out with, so a plot's
// text lands where its layout put it.
//
// Text is encoded WinAnsi (the standard fonts' encoding): ASCII and Latin-1 as themselves, the
// typographic marks (– — ‘ ’ “ ” • … € ™) in 128–159, and a few characters GCU text uses that the
// encoding lacks substituted by their plain forms (− → -, ≥ → >=, → → ->). Anything else is
// replaced by '?' and reported once, by the caller — an embedded font is the fix for those.

// advance widths, 1/1000 em, for codes 32..126
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
// widths for the non-ASCII WinAnsi characters that aren't an accented letter (those take their
// base letter's): per family [helvetica, times]; Courier is 600 throughout
const EXTRA = {
  ' ': [278, 250], '×': [584, 564], '÷': [584, 564], '°': [400, 400], '±': [584, 564], 'µ': [556, 500],
  '·': [278, 250], '–': [556, 500], '—': [1000, 1000], '‘': [222, 333], '’': [222, 333], '“': [333, 444], '”': [333, 444],
  '•': [350, 350], '…': [1000, 1000], '€': [556, 500], '™': [1000, 980], '¹': [333, 300], '²': [333, 300], '³': [333, 300],
  '¼': [834, 750], '½': [834, 750], '¾': [834, 750], '©': [737, 760], '®': [737, 760], '§': [556, 500], '¶': [537, 453],
  '¢': [556, 500], '£': [556, 500], '¥': [556, 500], 'ß': [611, 500], '¿': [611, 444], '¡': [333, 333], '«': [556, 500], '»': [556, 500],
};
// WinAnsi codes 128..159
const WIN_HIGH = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
// characters the encoding lacks, written as their plain forms
const SUBST = { '−': '-', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '≠': '!=', '≈': '~', '′': "'", '″': '"', 'μ': 'µ', '∙': '·', '⋅': '·', ' ': ' ', ' ': ' ', ' ': ' ' };

const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold', 'Times-Roman', 'Times-Bold'];

// a CSS font string → { name (a standard font), size (px of the user space), mono, serif, bold }
function parseFont(css) {
  const s = String(css || '10px sans-serif');
  const m = /(\d+(?:\.\d+)?)px/.exec(s);
  const size = m ? +m[1] : 10;
  const bold = /\b(bold|bolder|[6-9]00)\b/.test(s.slice(0, m ? m.index : s.length));
  const fam = (m ? s.slice(m.index + m[0].length) : s).replace(/^\s*\/\s*[\d.]+\w*/, '').toLowerCase();
  // the FIRST family decides (a stack's fallbacks don't): 'Space Mono', … monospace → mono
  const first = (fam.split(',')[0] || '').trim();
  const mono = /mono|courier|consol|menlo|code|fixed|typewriter/.test(first) || (/\bmonospace\b/.test(fam) && !/sans|serif|helvetica|arial|barlow|system-ui/.test(first));
  const serif = !mono && (/(^|[^-])\bserif\b|times|georgia|garamond|cambria|book/.test(first) && !/sans/.test(first));
  const name = mono ? (bold ? 'Courier-Bold' : 'Courier') : serif ? (bold ? 'Times-Bold' : 'Times-Roman') : (bold ? 'Helvetica-Bold' : 'Helvetica');
  return { name, size, mono, serif, bold };
}

const baseLetter = (ch) => { const d = ch.normalize('NFD'); return d.length > 1 && d.charCodeAt(0) < 128 ? d[0] : null; };

// the width of ONE (already encodable) character in 1/1000 em
function charWidth(name, ch) {
  if (name.startsWith('Courier')) return 600;
  const tbl = name === 'Helvetica-Bold' ? HELVB : name.startsWith('Times') ? TIMES : HELV;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tbl[c - 32];
  const e = EXTRA[ch];
  if (e) return name.startsWith('Times') ? e[1] : e[0];
  const b = baseLetter(ch);
  if (b) return tbl[b.charCodeAt(0) - 32];
  return name.startsWith('Times') ? 500 : 556;
}

// text → { codes: WinAnsi byte values, text: the encodable string, missing: Set of characters replaced by '?' }
function encodeWinAnsi(text) {
  const codes = [], missing = new Set();
  let out = '';
  for (const ch0 of String(text)) {
    const sub = SUBST[ch0];
    for (const ch of sub != null ? sub : ch0) {
      const c = ch.codePointAt(0);
      let code;
      if (c >= 32 && c <= 126) code = c;
      else if (c >= 160 && c <= 255) code = c;
      else if (WIN_HIGH[ch] != null) code = WIN_HIGH[ch];
      else if (c === 9) code = 32;
      else { code = 63; missing.add(ch); }
      codes.push(code);
      out += code === 63 && ch !== '?' ? '?' : ch;
    }
  }
  return { codes, text: out, missing };
}

// the advance of a string, in the font's units × size (1/1000 em · px → px)
function textWidth(name, size, text) {
  const { text: t } = encodeWinAnsi(text);
  let w = 0;
  for (const ch of t) w += charWidth(name, ch);
  return (w / 1000) * size;
}

// a PDF literal string from WinAnsi codes: ( ) \ escaped, bytes ≥ 128 as octal
function pdfString(codes) {
  let s = '(';
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

// the vertical offset (in px, positive = down in the canvas' y-down space) from the anchor y to the
// baseline, per textBaseline — the em box's proportions (ascent 0.8, descent 0.2), as browsers use
function baselineShift(baseline, size) {
  switch (baseline) {
    case 'top': return 0.8 * size;
    case 'hanging': return 0.8 * size;
    case 'middle': return 0.3 * size;
    case 'bottom': return -0.2 * size;
    case 'ideographic': return -0.2 * size;
    default: return 0;                                   // alphabetic
  }
}

// ── ../pdf/src/context.js ──

// A CanvasRenderingContext2D that writes a PDF page. The point: anything in GCU that draws on a
// canvas — @gcu/plot (replaying a draw list), micro's legends and scale bars, compo's furniture —
// draws a PDF page with the same code, and the result is VECTOR: paths are PDF paths, text is
// text (the standard fonts, fonts.js), images are image XObjects at their own resolution.
//
// The user space is the canvas one: origin top-left, y down, units = points unless the page was
// opened with units:'mm' (then a millimetre). Path points are transformed to page space as they
// are added (canvas semantics: a transform changes only what comes after), so line widths and
// dashes are scaled by the transform's scale when stroked.
//
// Supported: paths (moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect closePath),
// fill (nonzero / evenodd), stroke, clip, fillRect strokeRect, fillText strokeText measureText
// (with maxWidth), drawImage (3/5/9 args; ImageData-like {width, height, data}, a canvas, an
// ImageBitmap/image in a browser, or {jpeg, width, height}), putImageData, save/restore, the
// transform calls, line width / cap / join / miter / dash, globalAlpha and rgba alpha,
// imageSmoothingEnabled. Not expressible in PDF here — and SAID so once each, never silently
// dropped: gradients and patterns (the first colour stop is used), shadows, filters, composite
// operations other than source-over, Path2D. clearRect does nothing: a PDF page has no pixels.


const KAPPA = 0.5522847498307936;
// numbers as PDF writes them: short, never an exponent, no -0
function num(v) {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  if (r === 0) return '0';
  let s = r.toFixed(4);
  s = s.replace(/\.?0+$/, '');
  return s;
}
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const invert = (m) => {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

const DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  lineDashOffset: 0, globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
  direction: 'ltr', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', globalCompositeOperation: 'source-over',
  shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
};

class PdfContext2D {
  // page: the PdfPage (owns resources + the content stream); base: page space ← user space
  constructor(page, base) {
    this._page = page;
    this._doc = page._doc;
    this._base = base.slice();
    this._m = base.slice();
    this._st = { ...DEFAULTS, dash: [] };
    this._stack = [];
    this._path = [];                                       // page-space segments
    this._cur = null;                                      // page-space current point
    this._start = null;                                    // page-space subpath start
    this._alpha = 1;                                       // the ca/CA last set at THIS q-level ([fill, stroke])
    this._alphaS = 1;
    this.canvas = { width: page.width, height: page.height };
    // drawImage reads {width, height, data} directly — a draw-list replayer (plot's replay) hands
    // rasters over as pixels instead of going through an OffscreenCanvas
    this.acceptsImageData = true;
  }

  // ── state ──
  _set(k, v) { this._st[k] = v; }
  get fillStyle() { return this._st.fillStyle; } set fillStyle(v) { this._paint(v, 'fillStyle'); }
  get strokeStyle() { return this._st.strokeStyle; } set strokeStyle(v) { this._paint(v, 'strokeStyle'); }
  _paint(v, k) {
    if (v && typeof v === 'object') {
      this._warn('gradient', 'gradients and patterns are not drawn yet — the first colour stop is used');
      v = v._stops && v._stops.length ? v._stops[0][1] : '#000000';
    }
    if (parseCssColor(v)) this._st[k] = v;
    else this._warn('color:' + v, `colour '${v}' is not a CSS colour this context reads — kept the previous one`);
  }
  get lineWidth() { return this._st.lineWidth; } set lineWidth(v) { if (v > 0 && Number.isFinite(+v)) this._st.lineWidth = +v; }
  get lineCap() { return this._st.lineCap; } set lineCap(v) { if (['butt', 'round', 'square'].includes(v)) this._st.lineCap = v; }
  get lineJoin() { return this._st.lineJoin; } set lineJoin(v) { if (['miter', 'round', 'bevel'].includes(v)) this._st.lineJoin = v; }
  get miterLimit() { return this._st.miterLimit; } set miterLimit(v) { if (v > 0) this._st.miterLimit = +v; }
  get lineDashOffset() { return this._st.lineDashOffset; } set lineDashOffset(v) { if (Number.isFinite(+v)) this._st.lineDashOffset = +v; }
  get globalAlpha() { return this._st.globalAlpha; } set globalAlpha(v) { if (v >= 0 && v <= 1) this._st.globalAlpha = +v; }
  get font() { return this._st.font; } set font(v) { this._st.font = String(v); }
  get textAlign() { return this._st.textAlign; } set textAlign(v) { this._st.textAlign = v; }
  get textBaseline() { return this._st.textBaseline; } set textBaseline(v) { this._st.textBaseline = v; }
  get direction() { return this._st.direction; } set direction(v) { this._st.direction = v; }
  get imageSmoothingEnabled() { return this._st.imageSmoothingEnabled; } set imageSmoothingEnabled(v) { this._st.imageSmoothingEnabled = !!v; }
  get imageSmoothingQuality() { return this._st.imageSmoothingQuality; } set imageSmoothingQuality(v) { this._st.imageSmoothingQuality = v; }
  get globalCompositeOperation() { return this._st.globalCompositeOperation; }
  set globalCompositeOperation(v) { if (v !== 'source-over') this._warn('composite', `globalCompositeOperation '${v}' is not drawn — PDF pages composite source-over`); }
  get shadowBlur() { return this._st.shadowBlur; } set shadowBlur(v) { if (+v > 0) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get shadowColor() { return this._st.shadowColor; } set shadowColor(v) { this._st.shadowColor = v; }
  get shadowOffsetX() { return 0; } set shadowOffsetX(v) { if (+v) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get shadowOffsetY() { return 0; } set shadowOffsetY(v) { if (+v) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get filter() { return 'none'; } set filter(v) { if (v && v !== 'none') this._warn('filter', 'canvas filters are not drawn in PDF'); }
  setLineDash(a) { const d = Array.from(a || [], Number).filter((v) => v >= 0 && Number.isFinite(v)); this._st.dash = d.length % 2 ? d.concat(d) : d; }
  getLineDash() { return this._st.dash.slice(); }

  save() {
    this._stack.push({ st: { ...this._st, dash: this._st.dash.slice() }, m: this._m.slice(), alpha: this._alpha, alphaS: this._alphaS });
    this._out('q');
  }
  restore() {
    const s = this._stack.pop(); if (!s) return;
    this._st = s.st; this._m = s.m; this._alpha = s.alpha; this._alphaS = s.alphaS;
    this._out('Q');
  }

  // ── transforms ──
  translate(x, y) { this._m = mul(this._m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this._m = mul(this._m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._m = mul(this._m, [c, s, -s, c, 0, 0]); }
  transform(a, b, c, d, e, f) { this._m = mul(this._m, [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) {
    if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
    this._m = mul(this._base, [a, b, c, d, e, f]);
  }
  resetTransform() { this._m = this._base.slice(); }
  getTransform() { const u = mul(invert(this._base), this._m); return { a: u[0], b: u[1], c: u[2], d: u[3], e: u[4], f: u[5] }; }

  // ── paths (page space as they're added) ──
  beginPath() { this._path = []; this._cur = null; this._start = null; }
  moveTo(x, y) { const p = apply(this._m, x, y); this._path.push(['m', p[0], p[1]]); this._cur = p; this._start = p; }
  lineTo(x, y) {
    if (!this._cur) return this.moveTo(x, y);
    const p = apply(this._m, x, y); this._path.push(['l', p[0], p[1]]); this._cur = p;
  }
  bezierCurveTo(x1, y1, x2, y2, x, y) {
    if (!this._cur) this.moveTo(x1, y1);
    const a = apply(this._m, x1, y1), b = apply(this._m, x2, y2), p = apply(this._m, x, y);
    this._path.push(['c', a[0], a[1], b[0], b[1], p[0], p[1]]); this._cur = p;
  }
  quadraticCurveTo(cx, cy, x, y) {
    if (!this._cur) this.moveTo(cx, cy);
    const u = apply(invert(this._m), this._cur[0], this._cur[1]);
    this.bezierCurveTo(u[0] + (2 / 3) * (cx - u[0]), u[1] + (2 / 3) * (cy - u[1]), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }
  closePath() { if (this._cur) { this._path.push(['h']); this._cur = this._start; } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, r = 0) {
    const rr = Math.min(Math.abs(Array.isArray(r) ? r[0] || 0 : +r || 0), Math.abs(w) / 2, Math.abs(h) / 2);
    if (!rr) return this.rect(x, y, w, h);
    this.moveTo(x + rr, y); this.arcTo(x + w, y, x + w, y + h, rr); this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr); this.arcTo(x, y, x + w, y, rr); this.closePath();
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    if (rx < 0 || ry < 0) return;
    let sweep = a1 - a0;
    const TAU = Math.PI * 2;
    if (!ccw) { if (sweep < 0) sweep = (sweep % TAU) + TAU; if (a1 - a0 >= TAU) sweep = TAU; }
    else { if (sweep > 0) sweep = (sweep % TAU) - TAU; if (a0 - a1 >= TAU) sweep = -TAU; }
    if (sweep > TAU) sweep = TAU; if (sweep < -TAU) sweep = -TAU;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const pt = (t) => { const x = rx * Math.cos(t), y = ry * Math.sin(t); return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
    const d = (t) => { const x = -rx * Math.sin(t), y = ry * Math.cos(t); return [x * cr - y * sr, x * sr + y * cr]; };
    const p0 = pt(a0);
    if (this._cur) this.lineTo(p0[0], p0[1]); else this.moveTo(p0[0], p0[1]);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / n, k = (4 / 3) * Math.tan(step / 4);
    let t = a0;
    for (let i = 0; i < n; i++) {
      const t1 = t + step, q0 = pt(t), q1 = pt(t1), d0 = d(t), d1 = d(t1);
      this.bezierCurveTo(q0[0] + k * d0[0], q0[1] + k * d0[1], q1[0] - k * d1[0], q1[1] - k * d1[1], q1[0], q1[1]);
      t = t1;
    }
  }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  arcTo(x1, y1, x2, y2, r) {
    if (!this._cur) return this.moveTo(x1, y1);
    const [x0, y0] = apply(invert(this._m), this._cur[0], this._cur[1]);
    const v1x = x0 - x1, v1y = y0 - y1, v2x = x2 - x1, v2y = y2 - y1;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    const cross = v1x * v2y - v1y * v2x;
    if (!r || !l1 || !l2 || Math.abs(cross) < 1e-9) return this.lineTo(x1, y1);
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
    const t = r / Math.tan(ang / 2);
    const p1 = [x1 + (v1x / l1) * t, y1 + (v1y / l1) * t], p2 = [x1 + (v2x / l2) * t, y1 + (v2y / l2) * t];
    // the centre sits along the bisector, r away from both lines
    const bx = v1x / l1 + v2x / l2, by = v1y / l1 + v2y / l2, bl = Math.hypot(bx, by);
    const dc = Math.hypot(t, r);
    const c = [x1 + (bx / bl) * dc, y1 + (by / bl) * dc];
    const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]), a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    this.lineTo(p1[0], p1[1]);
    this.arc(c[0], c[1], r, a0, a1, cross > 0);
  }

  // ── painting ──
  fill(rule) {
    if (rule && typeof rule === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    if (!this._path.length) return;
    this._paintPath(this._path, rule === 'evenodd' ? 'f*' : 'f', true, false);
  }
  stroke(p) {
    if (p && typeof p === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    if (!this._path.length) return;
    this._paintPath(this._path, 'S', false, true);
  }
  clip(rule) {
    if (rule && typeof rule === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    this._out(this._pathOps(this._path) + (rule === 'evenodd' ? ' W* n' : ' W n'));
  }
  fillRect(x, y, w, h) { const seg = this._rectSeg(x, y, w, h); this._paintPath(seg, 'f', true, false); }
  strokeRect(x, y, w, h) { const seg = this._rectSeg(x, y, w, h); this._paintPath(seg, 'S', false, true); }
  clearRect() { /* a PDF page has no pixels to clear */ }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }

  _rectSeg(x, y, w, h) {
    const m = this._m, a = apply(m, x, y), b = apply(m, x + w, y), c = apply(m, x + w, y + h), d = apply(m, x, y + h);
    return [['m', ...a], ['l', ...b], ['l', ...c], ['l', ...d], ['h']];
  }
  _pathOps(seg) {
    return seg.map((s) => (s[0] === 'h' ? 'h' : s.slice(1).map(num).join(' ') + ' ' + s[0])).join('\n');
  }
  _colorOps(fill, stroke) {
    const parts = [];
    let fa = 1, sa = 1;
    if (fill) { const c = parseCssColor(this._st.fillStyle); parts.push(c.rgb.map(num).join(' ') + ' rg'); fa = c.a * this._st.globalAlpha; }
    if (stroke) { const c = parseCssColor(this._st.strokeStyle); parts.push(c.rgb.map(num).join(' ') + ' RG'); sa = c.a * this._st.globalAlpha; }
    const wantF = fill ? fa : this._alpha, wantS = stroke ? sa : this._alphaS;
    if (wantF !== this._alpha || wantS !== this._alphaS) {
      parts.push(`/${this._page._gs(wantF, wantS)} gs`);
      this._alpha = wantF; this._alphaS = wantS;
    }
    return { ops: parts.join(' '), visible: (fill ? fa : 1) > 0 && (stroke ? sa : 1) > 0 };
  }
  _strokeOps() {
    const s = scaleOf(this._m);
    const cap = { butt: 0, round: 1, square: 2 }[this._st.lineCap], join = { miter: 0, round: 1, bevel: 2 }[this._st.lineJoin];
    const dash = this._st.dash.length ? `[${this._st.dash.map((v) => num(v * s)).join(' ')}] ${num(this._st.lineDashOffset * s)} d` : '[] 0 d';
    return `${num(this._st.lineWidth * s)} w ${cap} J ${join} j ${num(this._st.miterLimit)} M ${dash}`;
  }
  _paintPath(seg, op, fill, stroke) {
    const col = this._colorOps(fill, stroke);
    if (!col.visible) return;
    this._out(`${col.ops}${stroke ? ' ' + this._strokeOps() : ''}\n${this._pathOps(seg)}\n${op}`);
  }

  // ── text ──
  measureText(text) {
    const f = parseFont(this._st.font);
    const w = textWidth(f.name, f.size, text);
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 0.72 * f.size, actualBoundingBoxDescent: 0.21 * f.size, fontBoundingBoxAscent: 0.8 * f.size, fontBoundingBoxDescent: 0.2 * f.size };
  }
  fillText(text, x, y, maxWidth) { this._text(text, x, y, maxWidth, 0); }
  strokeText(text, x, y, maxWidth) { this._text(text, x, y, maxWidth, 1); }
  _text(text, x, y, maxWidth, mode) {
    const f = parseFont(this._st.font);
    const enc = encodeWinAnsi(text);
    if (enc.missing.size) this._warn('glyph:' + [...enc.missing].join(''), `characters ${[...enc.missing].map((c) => `“${c}”`).join(' ')} aren't in the standard PDF fonts — written as '?' (an embedded font would carry them)`);
    if (!enc.codes.length) return;
    let w = textWidth(f.name, f.size, text);
    let sx = 1;
    if (maxWidth != null && maxWidth > 0 && w > maxWidth) { sx = maxWidth / w; w = maxWidth; }
    const align = this._st.textAlign, rtl = this._st.direction === 'rtl';
    const dx = align === 'center' ? -w / 2 : (align === 'right' || (align === 'end' && !rtl) || (align === 'start' && rtl)) ? -w : 0;
    const dy = baselineShift(this._st.textBaseline, f.size);
    // text space: x right, y UP (glyphs upright) — flip the y-down user space under the anchor
    const tm = mul(this._m, [sx, 0, 0, -1, x + dx, y + dy]);
    const col = this._colorOps(mode === 0, mode === 1);
    if (!col.visible) return;
    const font = this._page._font(f.name);
    const sw = mode === 1 ? ` ${num(this._st.lineWidth * scaleOf(this._m))} w` : '';
    this._out(`${col.ops}${sw}\nBT /${font} ${num(f.size)} Tf ${mode} Tr ${tm.map(num).join(' ')} Tm ${pdfString(enc.codes)} Tj ET`);
  }

  // ── images ──
  drawImage(src, a, b, c, d, e, f, g, h) {
    let sx = 0, sy = 0, sw, sh, dx, dy, dw, dh;
    const iw = src && (src.naturalWidth || src.videoWidth || src.width), ih = src && (src.naturalHeight || src.videoHeight || src.height);
    if (!iw || !ih) return;
    if (e === undefined) { dx = a; dy = b; dw = c === undefined ? iw : c; dh = d === undefined ? ih : d; sw = iw; sh = ih; }
    else { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g; dh = h; }
    const img = this._page._image(src, sx, sy, sw, sh, this._st.imageSmoothingEnabled, (k, m) => this._warn(k, m));
    if (!img) return;
    // the unit square (row 0 at the top, y = 1) onto the destination rect, y-down user space
    const cm = mul(this._m, [dw, 0, 0, -dh, dx, dy + dh]);
    const ga = this._st.globalAlpha;
    let gs = '';
    if (ga !== this._alpha) { gs = `/${this._page._gs(ga, this._alphaS)} gs `; this._alpha = ga; }
    if (ga <= 0) return;
    this._out(`q ${gs}${cm.map(num).join(' ')} cm /${img} Do Q`);
  }
  putImageData(imageData, dx, dy) {
    const m = this._m; this._m = this._base.slice();
    this.drawImage(imageData, dx, dy);
    this._m = m;
  }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData() { throw new Error('@gcu/pdf: getImageData — a PDF page has no pixels to read'); }

  // gradients / patterns: accepted (so canvas code runs) and drawn as their first stop, with a word
  createLinearGradient() { return this._gradient(); }
  createRadialGradient() { return this._gradient(); }
  createConicGradient() { return this._gradient(); }
  createPattern() { return this._gradient(); }
  _gradient() { const g = { _stops: [], addColorStop(o, c) { this._stops.push([o, c]); this._stops.sort((p, q) => p[0] - q[0]); } }; return g; }

  _out(s) { this._page._ops.push(s); }
  _warn(key, msg) { this._doc._warn(key, msg); }
}

// exposed for tests
const _matrix = { mul, apply, invert, KAPPA };

// ── ../pdf/src/sizes.js ──

// Page sizes and units. PDF works in POINTS (1/72 in); a page is given in points, and these turn
// the paper names and millimetres people think in into them.

const PT_PER_MM = 72 / 25.4;
const mm = (v) => v * PT_PER_MM;

// width × height in mm, portrait
const MM = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};
const PAGE_SIZES = Object.fromEntries(Object.entries(MM).map(([k, [w, h]]) => [k, [mm(w), mm(h)]]));

// pageSize('A4') · pageSize('A3', 'landscape') · pageSize([200, 150]) → [w, h] in points. A named size
// is portrait unless told otherwise; a custom [w, h] stays as given unless an orientation is named.
function pageSize(size = 'A4', orientation = null, units = 'mm') {
  let wh;
  if (Array.isArray(size)) wh = units === 'pt' ? size.slice(0, 2) : size.slice(0, 2).map(mm);
  else {
    const key = Object.keys(MM).find((k) => k.toLowerCase() === String(size).toLowerCase());
    if (!key) throw new Error(`@gcu/pdf: no page size '${size}' (${Object.keys(MM).join(', ')}, or [w, h])`);
    wh = PAGE_SIZES[key].slice();
  }
  const [a, b] = wh;
  if (orientation == null) return Array.isArray(size) ? [a, b] : [Math.min(a, b), Math.max(a, b)];
  return orientation === 'landscape' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

// ── ../pdf/src/document.js ──

// The document: pages, the resources they share (fonts, transparency states, images — each
// written once however many pages use it), and the file. `save()` is async because content and
// images are deflated with the platform's CompressionStream (no bundled zlib, no WASM).


const enc = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// a PDF text string: ASCII as a literal, anything else as UTF-16BE hex with a BOM
function textString(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}
const pdfDate = (d) => {
  const p = (n, k = 2) => String(n).padStart(k, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
// a short content hash for the trailer /ID (FNV-1a, two lanes)
function idHash(chunks) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { a = Math.imul(a ^ c[i], 16777619) >>> 0; b = Math.imul(b ^ c[i], 2246822519) >>> 0; }
  return [a, b, a ^ b, (a + b) >>> 0].map((v) => v.toString(16).padStart(8, '0')).join('');
}

class PdfPage {
  constructor(doc, width, height, units) {
    this._doc = doc;
    this.width = width; this.height = height;              // points
    this._ops = [];
    this._fonts = new Map(); this._gss = new Map(); this._images = new Map();
    this._units = units;
  }
  // a 2D context over this page; units 'pt' (default) or 'mm' for the user space
  getContext(kind = '2d', { units } = {}) {
    if (kind !== '2d') throw new Error(`@gcu/pdf: only a '2d' context (got '${kind}')`);
    const u = units || this._units || 'pt', k = u === 'mm' ? 72 / 25.4 : 1;
    // user space (y down, from the top-left) → PDF page space (y up, from the bottom-left)
    return new PdfContext2D(this, [k, 0, 0, -k, 0, this.height]);
  }
  _font(name) {
    if (!this._fonts.has(name)) this._fonts.set(name, 'F' + (STANDARD_FONTS.indexOf(name) + 1));
    return this._fonts.get(name);
  }
  _gs(ca, CA) {
    const key = `${num(ca)}/${num(CA)}`;
    if (!this._gss.has(key)) this._gss.set(key, { name: 'GS' + (this._doc._gsKeys.indexOf(key) >= 0 ? this._doc._gsKeys.indexOf(key) : this._doc._gsKeys.push(key) - 1), ca, CA });
    return this._gss.get(key).name;
  }
  _image(src, sx, sy, sw, sh, smooth, warn) {
    const img = this._doc._imageOf(src, sx, sy, sw, sh, smooth, warn);
    if (!img) return null;
    this._images.set(img.name, img);
    return img.name;
  }
}

class PdfDocument {
  // { title, author, subject, keywords, creator, created (Date or ISO string — for reproducible output),
  //   compress (default true), onWarn(msg), strict (warnings throw) }
  constructor(opts = {}) {
    this.opts = { compress: true, ...opts };
    this.pages = [];
    this.warnings = [];
    this._warned = new Set();
    this._gsKeys = [];
    this._imgs = [];                                       // { name, w, h, rgb, alpha, jpeg, smooth }
    this._imgCache = new WeakMap();
  }
  // addPage() → A4 portrait · addPage('A3', 'landscape') · addPage([w, h]) in mm · addPage({ width, height }) in points
  addPage(size = 'A4', orientation = null, { units = 'pt' } = {}) {
    let w, h;
    if (size && typeof size === 'object' && !Array.isArray(size)) { w = +size.width; h = +size.height; }
    else [w, h] = pageSize(size, orientation, 'mm');
    if (!(w > 0 && h > 0)) throw new Error('@gcu/pdf: a page needs a positive width and height');
    const p = new PdfPage(this, w, h, units);
    this.pages.push(p);
    return p;
  }

  _warn(key, msg) {
    if (this.opts.strict) throw new Error('@gcu/pdf: ' + msg);
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.warnings.push(msg);
    if (this.opts.onWarn) this.opts.onWarn(msg);
  }

  // pixels (or JPEG bytes) for an image source, cropped; cached per source + crop
  _imageOf(src, sx, sy, sw, sh, smooth, warn) {
    const key = `${sx},${sy},${sw},${sh},${smooth ? 1 : 0}`;
    const byKey = typeof src === 'object' && src ? (this._imgCache.get(src) || this._imgCache.set(src, new Map()).get(src)) : null;
    if (byKey && byKey.has(key)) return byKey.get(key);
    let rec = null;
    if (src.jpeg) {
      if (sx || sy || sw !== src.width || sh !== src.height) warn('jpegcrop', 'a cropped JPEG source is drawn whole (crop needs decoded pixels)');
      rec = { jpeg: src.jpeg instanceof Uint8Array ? src.jpeg : new Uint8Array(src.jpeg), w: src.width, h: src.height, smooth };
    } else {
      const px = pixelsOf(src);
      if (!px) { warn('imgsrc', 'drawImage: a source this context can\'t read pixels from (give ImageData, a canvas, an ImageBitmap or {jpeg, width, height})'); return null; }
      const x0 = Math.max(0, Math.round(sx)), y0 = Math.max(0, Math.round(sy));
      const w = Math.max(1, Math.min(px.width - x0, Math.round(sw))), h = Math.max(1, Math.min(px.height - y0, Math.round(sh)));
      const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
      let anyAlpha = false;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = ((y0 + r) * px.width + x0 + c) * 4, o = r * w + c;
        rgb[o * 3] = px.data[i]; rgb[o * 3 + 1] = px.data[i + 1]; rgb[o * 3 + 2] = px.data[i + 2];
        const a = px.data[i + 3]; alpha[o] = a; if (a !== 255) anyAlpha = true;
      }
      rec = { rgb, alpha: anyAlpha ? alpha : null, w, h, smooth };
    }
    rec.name = 'Im' + (this._imgs.push(rec) - 1);
    if (byKey) byKey.set(key, rec);
    return rec;
  }

  // → Uint8Array of the PDF file
  async save() {
    const objs = [];                                       // [id] = { dict, stream? } (1-based)
    const add = (o) => { objs.push(o); return objs.length; };
    const catalogId = add(null), pagesId = add(null);
    const compress = this.opts.compress !== false;
    const stream = async (dict, bytes) => {
      if (compress) { const z = await deflate(bytes); if (z) return { dict: `${dict} /Filter /FlateDecode /Length ${z.length}`, bytes: z }; }
      return { dict: `${dict} /Length ${bytes.length}`, bytes };
    };
    // shared resources: fonts used anywhere, gs states, images
    const fontsUsed = new Set(); for (const p of this.pages) for (const n of p._fonts.keys()) fontsUsed.add(n);
    const fontIds = {};
    for (const n of fontsUsed) fontIds[n] = add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>` });
    const gsIds = {};
    this._gsKeys.forEach((k, i) => { const [ca, CA] = k.split('/'); gsIds['GS' + i] = add({ dict: `<< /Type /ExtGState /ca ${ca} /CA ${CA} >>` }); });
    const imgIds = {};
    for (const im of this._imgs) {
      if (im.jpeg) {
        imgIds[im.name] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate ${im.smooth} /Length ${im.jpeg.length} >>`, bytes: im.jpeg });
        continue;
      }
      let smask = '';
      if (im.alpha) {
        const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate ${im.smooth}`, im.alpha);
        const sid = add({ dict: s.dict + ' >>', bytes: s.bytes });
        smask = ` /SMask ${sid} 0 R`;
      }
      const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${im.smooth}${smask}`, im.rgb);
      imgIds[im.name] = add({ dict: s.dict + ' >>', bytes: s.bytes });
    }
    // pages
    const pageIds = [];
    for (const p of this.pages) {
      const content = await stream('<<', enc(p._ops.join('\n')));
      const cid = add({ dict: content.dict + ' >>', bytes: content.bytes });
      const res = [];
      if (p._fonts.size) res.push(`/Font << ${[...p._fonts].map(([n, tag]) => `/${tag} ${fontIds[n]} 0 R`).join(' ')} >>`);
      if (p._gss.size) res.push(`/ExtGState << ${[...p._gss.values()].map((g) => `/${g.name} ${gsIds[g.name]} 0 R`).join(' ')} >>`);
      if (p._images.size) res.push(`/XObject << ${[...p._images.keys()].map((n) => `/${n} ${imgIds[n]} 0 R`).join(' ')} >>`);
      pageIds.push(add({ dict: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << ${res.join(' ')} >> /Contents ${cid} 0 R >>` }));
    }
    objs[pagesId - 1] = { dict: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>` };
    objs[catalogId - 1] = { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` };
    const o = this.opts, info = [];
    for (const [k, v] of [['Title', o.title], ['Author', o.author], ['Subject', o.subject], ['Keywords', o.keywords], ['Creator', o.creator]]) if (v) info.push(`/${k} ${textString(v)}`);
    info.push(`/Producer ${textString('@gcu/pdf')}`);
    info.push(`/CreationDate (${pdfDate(o.created instanceof Date ? o.created : o.created ? new Date(o.created) : new Date())})`);
    const infoId = add({ dict: `<< ${info.join(' ')} >>` });

    // the file: header, objects, xref, trailer
    const chunks = [enc('%PDF-1.7\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let at = chunks[0].length + chunks[1].length;
    const offsets = [];
    objs.forEach((ob, i) => {
      offsets[i] = at;
      const head = enc(`${i + 1} 0 obj\n${ob.dict}\n`);
      chunks.push(head); at += head.length;
      if (ob.bytes) {
        const s0 = enc('stream\n'), s1 = enc('\nendstream\n');
        chunks.push(s0, ob.bytes, s1); at += s0.length + ob.bytes.length + s1.length;
      }
      const tail = enc('endobj\n'); chunks.push(tail); at += tail.length;
    });
    const id = idHash(chunks);
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${at}\n%%EOF\n`;
    chunks.push(enc(xref));
    const total = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total);
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}

// RGBA pixels of an image source: ImageData-like, a canvas (any kind), an ImageBitmap/image
function pixelsOf(src) {
  if (src && src.data && src.width && src.height && src.data.length >= src.width * src.height * 4) return src;
  if (src && typeof src.getContext === 'function') {
    try { const g = src.getContext('2d'); if (g && g.getImageData) return g.getImageData(0, 0, src.width, src.height); } catch { /* a WebGL canvas: below */ }
  }
  const w = src && (src.naturalWidth || src.videoWidth || src.width), h = src && (src.naturalHeight || src.videoHeight || src.height);
  if (!w || !h) return null;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0); return g.getImageData(0, 0, w, h);
  } catch { return null; }
}

// ── ../pdf/src/main.js ──

// @gcu/pdf — a small PDF writer with a canvas-2D context. See README.md.

// ── src/render.js ──

// Drawing a page, and exporting it. ONE drawing path: renderPage draws in millimetres onto any 2D
// context — the editor's canvas (scaled to the zoom), a PNG canvas (scaled to the DPI), a @gcu/pdf
// page (units mm). Each frame is clipped to its box, its background under it and its border over.


// figure numbers: text frames that say {fig}, numbered in page order (back-to-front), from env.figStart
function figNumbering(doc, env) {
  const order = doc.frames.filter((f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || ''));
  return (frame) => (env.figStart || 1) + Math.max(0, order.indexOf(frame));
}

function renderPage(doc, ctx, env = {}) {
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
async function ensureImages(doc) {
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
async function exportPDF(docs, opts = {}) {
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
async function exportPNG(doc, opts = {}) {
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

// ── src/editor.js ──

// The page editor — host-agnostic DOM. A toolbar (page size / orientation / custom mm, zoom, add
// text, align · distribute, front / back, delete, plus the HOST's buttons), the page preview with
// a frame overlay (select · shift-select · drag to move with snapping guides · 8 handles to
// resize · arrows nudge · Delete · ⌘D duplicate · ⌘Z / ⌘⇧Z undo), a context menu (host items +
// built-ins) and an inspector for the selected frame (box in mm, border, the kind's own fields).
//
// mountEditor(el, doc, { env, onChange(doc), toolbar: [{ label, title, run(editor) }],
//   frameMenu(frame, editor) → [{ label, run }], inspector(frame, panelEl, editor) }) → editor


const CSS = `
.compo-root { display: flex; flex-direction: column; height: 100%; min-height: 0; font: 12px/1.35 var(--compo-font, system-ui, sans-serif); color: var(--compo-fg, var(--text, #ddd)); outline: none; }
.compo-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 6px; border-bottom: 1px solid var(--compo-border, var(--border, #3a3d42)); }
.compo-bar button, .compo-bar select, .compo-bar input, .compo-side input, .compo-side select, .compo-side textarea, .compo-side button { background: var(--compo-btn, var(--bg-btn, #2a2d31)); color: inherit; border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 3px; font: inherit; padding: 2px 6px; }
.compo-bar button:hover:not(:disabled) { border-color: var(--compo-accent, var(--accent, #fb9044)); }
.compo-bar button:disabled { opacity: 0.4; }
.compo-bar .sep { width: 1px; align-self: stretch; background: var(--compo-border, var(--border, #3a3d42)); margin: 0 3px; }
.compo-bar input[type=number] { width: 52px; }
.compo-main { flex: 1; display: flex; min-height: 0; }
.compo-scroll { flex: 1; overflow: auto; background: var(--compo-desk, #55585d); position: relative; }
.compo-pagewrap { position: relative; margin: 24px auto; box-shadow: 0 2px 14px rgba(0,0,0,0.45); }
.compo-pagewrap canvas { display: block; }
.compo-overlay { position: absolute; inset: 0; }
.compo-fr { position: absolute; box-sizing: border-box; cursor: move; }
.compo-fr:hover { outline: 1px dashed rgba(60, 130, 230, 0.7); }
.compo-fr.sel { outline: 1.5px solid #3c82e6; }
.compo-fr.locked { cursor: default; }
.compo-h { position: absolute; width: 8px; height: 8px; background: #fff; border: 1.5px solid #3c82e6; box-sizing: border-box; margin: -4px 0 0 -4px; }
.compo-guide { position: absolute; background: #e6339a; pointer-events: none; }
.compo-margin { position: absolute; border: 1px dashed rgba(60, 130, 230, 0.35); pointer-events: none; }
.compo-side { width: 230px; overflow: auto; padding: 8px; border-left: 1px solid var(--compo-border, var(--border, #3a3d42)); display: flex; flex-direction: column; gap: 6px; }
.compo-side .row { display: flex; gap: 4px; align-items: center; }
.compo-side .row > span:first-child { width: 58px; color: var(--compo-dim, var(--dim, #9a9a9a)); }
.compo-side input[type=number] { width: 54px; }
.compo-side textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-family: var(--compo-mono, monospace); }
.compo-side .hint { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; }
.compo-menu { position: fixed; z-index: 99999; background: var(--compo-btn, var(--bg-panel, #24272b)); border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 4px; padding: 3px 0; min-width: 150px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.compo-menu div { padding: 4px 12px; cursor: pointer; }
.compo-menu div:hover { background: var(--compo-accent, var(--accent, #fb9044)); color: #111; }
`;
let _css = false;
function injectCss() { if (_css || typeof document === 'undefined') return; _css = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v; else if (k in e) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };

function mountEditor(el, doc, opts = {}) {
  injectCss();
  let D = doc, zoom = 3, sel = [];
  const hist = [], fut = [];
  const env = () => ({ ...(opts.env || {}) });
  const root = h('div', { className: 'compo-root', tabIndex: 0 });
  const bar = h('div', { className: 'compo-bar' });
  const scroll = h('div', { className: 'compo-scroll' });
  const wrap = h('div', { className: 'compo-pagewrap' });
  const cv = h('canvas');
  const overlay = h('div', { className: 'compo-overlay' });
  const side = h('div', { className: 'compo-side' });
  wrap.append(cv, overlay); scroll.append(wrap);
  root.append(bar, h('div', { className: 'compo-main' }, scroll, side));
  el.replaceChildren(root);

  // ── history ──
  const snap = () => serializeDocument(D);
  const imgCache = new Map();                              // frame id → decoded bitmap (survives undo)
  const keepImgs = () => { for (const f of D.frames) if (f._img) imgCache.set(f.id, { img: f._img, jpeg: f._jpeg }); };
  function commit(fn) {
    keepImgs();
    hist.push(snap()); if (hist.length > 80) hist.shift(); fut.length = 0;
    fn();
    changed();
  }
  function restoreFrom(json) {
    keepImgs();
    const next = JSON.parse(json);
    for (const f of next.frames) { const c = imgCache.get(f.id); if (c) { f._img = c.img; f._jpeg = c.jpeg; } }
    D = next; sel = sel.filter((id) => frameById(D, id)); changed();
  }
  const undo = () => { if (!hist.length) return; fut.push(snap()); restoreFrom(hist.pop()); };
  const redo = () => { if (!fut.length) return; hist.push(snap()); restoreFrom(fut.pop()); };
  function changed() { render(); if (opts.onChange) opts.onChange(D); }

  // ── toolbar ──
  const btn = (label, title, run) => h('button', { textContent: label, title, onclick: () => { run(); root.focus(); } });
  const sizeSel = h('select', { title: 'paper size' });
  for (const k of [...Object.keys(PAPER), 'custom']) sizeSel.append(h('option', { value: k, textContent: k }));
  const oriSel = h('select', { title: 'orientation' }, h('option', { value: 'portrait', textContent: 'portrait' }), h('option', { value: 'landscape', textContent: 'landscape' }));
  const wIn = h('input', { type: 'number', title: 'page width (mm)', min: 10, step: 1 }), hIn = h('input', { type: 'number', title: 'page height (mm)', min: 10, step: 1 });
  const customSpan = h('span', { style: 'display:inline-flex;gap:3px;align-items:center' }, wIn, '×', hIn, ' mm');
  sizeSel.onchange = () => commit(() => {
    if (sizeSel.value === 'custom') { const [w, hh] = pageDims(D.page); D.page = { ...D.page, size: 'custom', width: w, height: hh }; } else D.page = { ...D.page, size: sizeSel.value };
  });
  oriSel.onchange = () => commit(() => { D.page = { ...D.page, orientation: oriSel.value }; });
  wIn.onchange = hIn.onchange = () => commit(() => { D.page = { ...D.page, size: 'custom', width: Math.max(10, +wIn.value || 10), height: Math.max(10, +hIn.value || 10) }; });
  const zoomSel = h('select', { title: 'zoom' });
  for (const [v, t] of [['fit', 'fit'], ['2', '50%'], ['3', '75%'], ['3.78', '100%'], ['5.67', '150%'], ['7.56', '200%']]) zoomSel.append(h('option', { value: v, textContent: t }));
  zoomSel.onchange = () => { if (zoomSel.value === 'fit') zoomFit(); else { zoom = +zoomSel.value; render(); } };
  const alignBtns = [['⇤', 'left'], ['⇹', 'hcenter'], ['⇥', 'right'], ['⤒', 'top'], ['⇳', 'vcenter'], ['⤓', 'bottom']].map(([l, how]) => btn(l, `align ${how}`, () => commit(() => alignFrames(D, sel, how))));
  const distBtns = [['↔', 'h'], ['↕', 'v']].map(([l, ax]) => btn(l, ax === 'h' ? 'distribute horizontally' : 'distribute vertically', () => commit(() => distributeFrames(D, sel, ax))));
  const frontBtn = btn('front', 'bring to front', () => commit(() => bringToFront(D, sel)));
  const backBtn = btn('back', 'send to back', () => commit(() => sendToBack(D, sel)));
  const delBtn = btn('delete', 'delete the selected frames', () => del());
  bar.append(sizeSel, oriSel, customSpan, h('span', { className: 'sep' }), zoomSel, h('span', { className: 'sep' }),
    btn('+ text', 'add a text frame (fields: {fig} {page} {date} ${…})', () => add({ kind: 'text', content: { md: '**Figure {fig}.** caption', size: 9 } })),
    h('span', { className: 'sep' }), ...alignBtns, ...distBtns, h('span', { className: 'sep' }), frontBtn, backBtn, delBtn);
  if (opts.toolbar && opts.toolbar.length) {
    bar.append(h('span', { className: 'sep' }));
    for (const t of opts.toolbar) bar.append(btn(t.label, t.title || '', () => t.run(api)));
  }

  // ── rendering ──
  function render() { renderCanvas(); syncBar(); renderSide(); }
  function renderCanvas() {
    const [W, H] = pageDims(D.page);
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const pw = Math.round(W * zoom), ph = Math.round(H * zoom);
    wrap.style.width = pw + 'px'; wrap.style.height = ph + 'px';
    cv.width = Math.round(pw * dpr); cv.height = Math.round(ph * dpr);
    cv.style.width = pw + 'px'; cv.style.height = ph + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    renderPage(D, g, env());
    drawOverlay();
  }
  function drawOverlay(guides) {
    overlay.replaceChildren();
    const m = D.page.margins || [0, 0, 0, 0], [W, H] = pageDims(D.page);
    overlay.append(h('div', { className: 'compo-margin', style: `left:${m[3] * zoom}px;top:${m[0] * zoom}px;width:${(W - m[1] - m[3]) * zoom}px;height:${(H - m[0] - m[2]) * zoom}px` }));
    for (const f of D.frames) {
      const b = f.box;
      const d = h('div', { className: 'compo-fr' + (sel.includes(f.id) ? ' sel' : '') + (f.locked ? ' locked' : ''), title: `${(kindOf(f.kind) && kindOf(f.kind).label) || f.kind}` });
      d.style.cssText = `left:${b[0] * zoom}px;top:${b[1] * zoom}px;width:${b[2] * zoom}px;height:${b[3] * zoom}px`;
      d.dataset.id = f.id;
      overlay.append(d);
      if (sel.length === 1 && sel[0] === f.id && !f.locked) {
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
          const k = h('div', { className: 'compo-h' });
          k.style.left = `${b[0] * zoom + hx * b[2] * zoom}px`; k.style.top = `${b[1] * zoom + hy * b[3] * zoom}px`;
          k.style.cursor = (hx === 0.5 ? 'ns' : hy === 0.5 ? 'ew' : (hx === hy ? 'nwse' : 'nesw')) + '-resize';
          k.dataset.handle = `${hx},${hy}`; k.dataset.id = f.id;
          overlay.append(k);
        }
      }
    }
    if (guides) {
      if (guides.x != null) overlay.append(h('div', { className: 'compo-guide', style: `left:${guides.x * zoom}px;top:0;width:1px;height:100%` }));
      if (guides.y != null) overlay.append(h('div', { className: 'compo-guide', style: `top:${guides.y * zoom}px;left:0;height:1px;width:100%` }));
    }
  }
  function syncBar() {
    sizeSel.value = PAPER[D.page.size] ? D.page.size : 'custom';
    oriSel.value = D.page.orientation || 'portrait'; oriSel.disabled = sizeSel.value === 'custom';
    customSpan.style.display = sizeSel.value === 'custom' ? 'inline-flex' : 'none';
    const [W, H] = pageDims(D.page); wIn.value = +W.toFixed(1); hIn.value = +H.toFixed(1);
    for (const b of alignBtns) b.disabled = sel.length < 2;
    for (const b of distBtns) b.disabled = sel.length < 3;
    frontBtn.disabled = backBtn.disabled = delBtn.disabled = !sel.length;
  }

  // ── inspector ──
  // rebuilding the panel removes a focused input, whose blur fires its change, whose commit
  // re-renders — re-entrantly. Blur first, and let a nested request just ask for one more pass.
  let _inSide = false, _sideAgain = false;
  function renderSide() {
    if (_inSide) { _sideAgain = true; return; }
    _inSide = true;
    try {
      do {
        _sideAgain = false;
        const a = document.activeElement;
        if (a && side.contains(a)) a.blur();
        buildSide();
      } while (_sideAgain);
    } finally { _inSide = false; }
  }
  function buildSide() {
    side.replaceChildren();
    if (sel.length !== 1) {
      side.append(h('div', { className: 'hint', textContent: sel.length ? `${sel.length} frames selected — align / distribute from the toolbar` : 'click a frame to edit it · drag to move · handles resize · arrows nudge (⇧ ×10) · ⌘Z undo' }));
      return;
    }
    const f = frameById(D, sel[0]); if (!f) return;
    const kind = kindOf(f.kind);
    side.append(h('div', { textContent: `${(kind && kind.label) || f.kind}`, style: 'font-weight:bold' }));
    const num = (label, i) => {
      const inp = h('input', { type: 'number', step: 0.5, value: +f.box[i].toFixed(1) });
      inp.onchange = () => commit(() => { const v = +inp.value; if (Number.isFinite(v)) f.box[i] = i >= 2 ? Math.max(2, v) : v; });
      return h('span', { style: 'display:inline-flex;gap:2px;align-items:center' }, label, inp);
    };
    side.append(h('div', { className: 'row' }, h('span', { textContent: 'position' }), num('x', 0), num('y', 1)));
    side.append(h('div', { className: 'row' }, h('span', { textContent: 'size' }), num('w', 2), num('h', 3)));
    const bd = h('input', { type: 'checkbox', checked: !!(f.style && f.style.border) });
    bd.onchange = () => commit(() => { f.style = { ...(f.style || {}), border: bd.checked }; });
    side.append(h('label', { className: 'row' }, h('span', { textContent: 'border' }), bd));
    if (f.kind === 'text') {
      const ta = h('textarea', { value: f.content.md || '', spellcheck: true });
      let t0 = null;
      ta.onfocus = () => { t0 = snap(); };
      ta.oninput = () => { f.content.md = ta.value; renderCanvas(); };   // the page only: the panel (and the caret) stay
      ta.onchange = () => { if (t0) { hist.push(t0); fut.length = 0; t0 = null; } if (opts.onChange) opts.onChange(D); };
      const size = h('input', { type: 'number', min: 4, max: 72, step: 0.5, value: f.content.size || 9 });
      size.onchange = () => commit(() => { f.content.size = +size.value || 9; });
      const align = h('select', {}, ...['left', 'center', 'right'].map((v) => h('option', { value: v, textContent: v })));
      align.value = f.content.align || 'left';
      align.onchange = () => commit(() => { f.content.align = align.value; });
      const mono = h('input', { type: 'checkbox', checked: !!f.content.mono });
      mono.onchange = () => commit(() => { f.content.mono = mono.checked; });
      side.append(ta, h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), size, align), h('label', { className: 'row' }, h('span', { textContent: 'monospace' }), mono),
        h('div', { className: 'hint', textContent: '**bold** · fields {fig} {page} {pages} {date} {title} · ${expr} from the host' }));
      api._focusText = () => ta.focus();
    }
    if (f.kind === 'image') {
      const fit = h('select', {}, ...['contain', 'cover', 'fill'].map((v) => h('option', { value: v, textContent: v })));
      fit.value = f.content.fit || 'contain';
      fit.onchange = () => commit(() => { f.content.fit = fit.value; });
      side.append(h('div', { className: 'row' }, h('span', { textContent: 'fit' }), fit));
    }
    if (f.kind === 'legend') {
      const t = h('input', { value: f.content.title || '' });
      t.onchange = () => commit(() => { f.content.title = t.value; });
      side.append(h('div', { className: 'row' }, h('span', { textContent: 'title' }), t));
    }
    if (opts.inspector) opts.inspector(f, side, api);
    if (f.produced) side.append(h('div', { className: 'hint', textContent: `produced ${String(f.produced).replace('T', ' ').slice(0, 16)}` }));
  }

  // ── pointer: select, move (snapping), resize ──
  const toMm = (e) => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();                                    // keep the keyboard on the editor (no mousedown focus shuffle)
    root.focus();
    const t = e.target, id = t.dataset && t.dataset.id;
    if (!id) { sel = []; render(); return; }
    const f = frameById(D, id);
    if (t.dataset.handle) return startResize(e, f, t.dataset.handle.split(',').map(Number));
    if (e.shiftKey) { sel = sel.includes(id) ? sel.filter((x) => x !== id) : sel.concat(id); render(); return; }
    if (!sel.includes(id)) { sel = [id]; render(); }
    if (f.locked) return;
    startMove(e);
  });
  overlay.addEventListener('dblclick', (e) => { const id = e.target.dataset && e.target.dataset.id; if (id && frameById(D, id).kind === 'text' && api._focusText) api._focusText(); });
  overlay.addEventListener('contextmenu', (e) => {
    const id = e.target.dataset && e.target.dataset.id; if (!id) return;
    e.preventDefault();
    if (!sel.includes(id)) { sel = [id]; render(); }
    const f = frameById(D, id);
    const items = [...((opts.frameMenu && opts.frameMenu(f, api)) || []), { sep: true },
      { label: 'Duplicate', run: () => dup() }, { label: 'Bring to front', run: () => commit(() => bringToFront(D, sel)) }, { label: 'Send to back', run: () => commit(() => sendToBack(D, sel)) },
      { label: f.locked ? 'Unlock' : 'Lock', run: () => commit(() => { f.locked = !f.locked; }) }, { label: 'Delete', run: () => del() }];
    menu(e.clientX, e.clientY, items);
  });
  function startMove(e) {
    const p0 = toMm(e), starts = sel.map((id) => [id, frameById(D, id).box.slice()]);
    const before = snap();
    let moved = false;
    const mv = (ev) => {
      const p = toMm(ev); let dx = p[0] - p0[0], dy = p[1] - p0[1];
      if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
      moved = true;
      // snap the first selected frame; the rest move with it
      const [pid, pb] = starts[0];
      const s = ev.altKey ? { box: [pb[0] + dx, pb[1] + dy], guides: null } : snapBox(D, [pb[0] + dx, pb[1] + dy, pb[2], pb[3]], { ignore: sel });
      dx = s.box[0] - pb[0]; dy = s.box[1] - pb[1];
      for (const [id, b] of starts) { const f = frameById(D, id); f.box[0] = b[0] + dx; f.box[1] = b[1] + dy; }
      renderFast(s.guides);
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (moved) { hist.push(before); fut.length = 0; changed(); }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function startResize(e, f, [hx, hy]) {
    const p0 = toMm(e), b0 = f.box.slice(), before = snap();
    const aspect = b0[2] / b0[3];
    const mv = (ev) => {
      const p = toMm(ev), dx = p[0] - p0[0], dy = p[1] - p0[1];
      let [x, y, w, hh] = b0;
      if (hx === 0) { x = b0[0] + dx; w = b0[2] - dx; } else if (hx === 1) w = b0[2] + dx;
      if (hy === 0) { y = b0[1] + dy; hh = b0[3] - dy; } else if (hy === 1) hh = b0[3] + dy;
      if (ev.shiftKey && hx !== 0.5 && hy !== 0.5) { hh = w / aspect; if (hy === 0) y = b0[1] + b0[3] - hh; }   // ⇧ keeps the aspect
      if (w < 3) { if (hx === 0) x = b0[0] + b0[2] - 3; w = 3; }
      if (hh < 3) { if (hy === 0) y = b0[1] + b0[3] - 3; hh = 3; }
      f.box = [x, y, w, hh];
      renderFast(null);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); hist.push(before); fut.length = 0; changed(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  let _raf = 0, _g = null;
  function renderFast(guides) {
    _g = guides;
    if (_raf) return;
    _raf = requestAnimationFrame(() => { _raf = 0; renderCanvas(); drawOverlay(_g); });
  }

  // ── keys ──
  root.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = D.frames.map((f) => f.id); render(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); del(); } return; }
    if (e.key === 'Escape') { sel = []; render(); return; }
    const step = e.shiftKey ? 5 : 0.5, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && sel.length) { e.preventDefault(); commit(() => { for (const id of sel) { const f = frameById(D, id); if (!f.locked) { f.box[0] += dir[0] * step; f.box[1] += dir[1] * step; } } }); }
  });

  // ── actions ──
  function add(frame) { let f; commit(() => { f = addFrame(D, frame); }); sel = [f.id]; render(); return f; }
  function del() { commit(() => removeFrames(D, sel)); sel = []; render(); }
  function dup() {
    if (!sel.length) return;
    const made = [];
    commit(() => {
      for (const id of sel) {
        const f = frameById(D, id), c = JSON.parse(serializeDocument({ frames: [f] })).frames[0];
        c.box[0] += 5; c.box[1] += 5; if (f._img) c._img = f._img;
        made.push(addFrame(D, { ...c, id: undefined }));
        if (f._img) made[made.length - 1]._img = f._img;
      }
    });
    sel = made.map((f) => f.id); render();
  }
  function menu(x, y, items) {
    document.querySelectorAll('.compo-menu').forEach((m) => m.remove());
    const m = h('div', { className: 'compo-menu' });
    for (const it of items) {
      if (it.sep) { if (m.lastChild && !m.lastChild.dataset.sep) m.append(h('hr', { style: 'border:0;border-top:1px solid var(--compo-border, var(--border, #3a3d42));margin:3px 0', 'data-sep': '1' })); continue; }
      m.append(h('div', { textContent: it.label, onclick: () => { m.remove(); root.focus(); it.run(); } }));
    }
    m.style.left = x + 'px'; m.style.top = y + 'px';
    document.body.append(m);
    const off = (ev) => { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
    setTimeout(() => addEventListener('pointerdown', off, true), 0);
  }
  function zoomFit() {
    const [W, H] = pageDims(D.page);
    const r = scroll.getBoundingClientRect();
    zoom = Math.max(0.5, Math.min((r.width - 48) / W, (r.height - 48) / H)) || 3;
    zoomSel.value = 'fit';
    render();
  }

  const api = {
    el: root,
    getDoc: () => D,
    setDoc(next) { D = next; sel = []; hist.length = 0; fut.length = 0; ensureImages(D).then(() => render()); render(); },
    selected: () => sel.map((id) => frameById(D, id)).filter(Boolean),
    select(ids) { sel = ids.filter((id) => frameById(D, id)); render(); },
    addFrame: add, render, zoomFit, undo, redo,
    // change a frame from outside (the host re-rendered it) as one undo step
    update(id, fn) { commit(() => { const f = frameById(D, id); if (f) fn(f); }); },
    destroy() { el.replaceChildren(); },
  };
  ensureImages(D).then(() => render());
  render();
  requestAnimationFrame(() => zoomFit());
  return api;
}

// ── src/main.js ──

// @gcu/compo — a figure / page composer. See README.md.

export {
  COMPO_FORMAT,
  COMPO_VERSION,
  PAPER,
  pageDims,
  createDocument,
  parseDocument,
  serializeDocument,
  newId,
  addFrame,
  frameById,
  removeFrames,
  bringToFront,
  sendToBack,
  alignFrames,
  distributeFrames,
  snapBox,
  SANS,
  MONO,
  fontMm,
  registerKind,
  kindOf,
  resolveFields,
  layoutText,
  replayDrawList,
  niceBelow,
  frameWorldPerMm,
  renderPage,
  ensureImages,
  exportPDF,
  exportPNG,
  mountEditor,
};
