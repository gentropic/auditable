// The compo document: a PAGE (size, orientation, margins — millimetres) and FRAMES on it, each a
// box [x, y, w, h] in mm from the page's top-left holding finished content of one KIND. Plain
// JSON (.compo.json): the whole figure, rebuildable. Frames may carry `source` (where the
// content came from, for a host that can refresh it) and `produced` (when).

export const COMPO_FORMAT = 'compo';
export const COMPO_VERSION = 1;

// paper sizes in mm, portrait
export const PAPER = {
  A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};

// { size: 'A4' | 'custom', orientation: 'portrait' | 'landscape', width, height (mm, custom), margins: [t, r, b, l] }
export function pageDims(page) {
  const p = page || {};
  if (p.size === 'custom' || !PAPER[p.size]) return [Math.max(10, +p.width || 210), Math.max(10, +p.height || 297)];
  const [a, b] = PAPER[p.size];
  return p.orientation === 'landscape' ? [b, a] : [a, b];
}

export function createDocument({ page = {}, theme = 'paper', title = '' } = {}) {
  return {
    format: COMPO_FORMAT, version: COMPO_VERSION, title,
    page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12], ...page },
    theme, frames: [],
  };
}

// a document from JSON (or an object), checked; unknown frame kinds are kept (a host may add kinds)
export function parseDocument(src) {
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
export function serializeDocument(doc) {
  return JSON.stringify(doc, (k, v) => (k.startsWith('_') ? undefined : v), 1);
}

let _seq = 0;
export function newId(doc, kind) {
  const used = new Set((doc.frames || []).map((f) => f.id));
  let id;
  do id = `${kind}-${(++_seq).toString(36)}`; while (used.has(id));
  return id;
}

// add a frame: { kind, box?, content, source?, style? } → the frame (placed in the margins, or
// centred, when no box is given)
export function addFrame(doc, frame) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [0, 0, 0, 0];
  const box = frame.box || [m[3] + 10, m[0] + 10, Math.min(120, W - m[1] - m[3] - 20), Math.min(80, H - m[0] - m[2] - 20)];
  const f = { id: frame.id || newId(doc, frame.kind), kind: frame.kind, box: box.map(Number), content: frame.content || {}, ...(frame.source ? { source: frame.source } : {}), ...(frame.style ? { style: frame.style } : {}), produced: frame.produced || new Date().toISOString() };
  doc.frames.push(f);
  return f;
}
export const frameById = (doc, id) => doc.frames.find((f) => f.id === id) || null;
export function removeFrames(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => !s.has(f.id)); }

// z-order: the frames list is back-to-front
export function bringToFront(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => !s.has(f.id)).concat(doc.frames.filter((f) => s.has(f.id))); }
export function sendToBack(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => s.has(f.id)).concat(doc.frames.filter((f) => !s.has(f.id))); }

// align the frames (by id) to their joint bounds: left · hcenter · right · top · vcenter · bottom
export function alignFrames(doc, ids, how) {
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
export function distributeFrames(doc, ids, axis) {
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
export function snapBox(doc, box, { ignore = [], tol = 1.5 } = {}) {
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
