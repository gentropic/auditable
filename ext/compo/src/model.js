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


// ── z-order: the frames list is back-to-front ──
export function bringToFront(doc, ids) { const s = new Set(expandGroups(doc, ids)); doc.frames = doc.frames.filter((f) => !s.has(f.id)).concat(doc.frames.filter((f) => s.has(f.id))); }
export function sendToBack(doc, ids) { const s = new Set(expandGroups(doc, ids)); doc.frames = doc.frames.filter((f) => s.has(f.id)).concat(doc.frames.filter((f) => !s.has(f.id))); }
// one step: each selected frame swaps past the next unselected one above (below)
export function bringForward(doc, ids) {
  const s = new Set(expandGroups(doc, ids)), a = doc.frames;
  for (let i = a.length - 2; i >= 0; i--) if (s.has(a[i].id) && !s.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
}
export function sendBackward(doc, ids) {
  const s = new Set(expandGroups(doc, ids)), a = doc.frames;
  for (let i = 1; i < a.length; i++) if (s.has(a[i].id) && !s.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
}

// ── groups: frames sharing a `group` id select, move, align and distribute as ONE unit ──
let _gseq = 0;
export function expandGroups(doc, ids) {
  const want = new Set(ids), groups = new Set();
  for (const f of doc.frames) if (want.has(f.id) && f.group) groups.add(f.group);
  return doc.frames.filter((f) => want.has(f.id) || (f.group && groups.has(f.group))).map((f) => f.id);
}
// the selected frames (and their groups' other members) into one new group → its id
export function groupFrames(doc, ids) {
  const all = expandGroups(doc, ids);
  if (all.length < 2) return null;
  const used = new Set(doc.frames.map((f) => f.group).filter(Boolean));
  let g; do g = `g${(++_gseq).toString(36)}`; while (used.has(g));
  for (const id of all) frameById(doc, id).group = g;
  return g;
}
export function ungroupFrames(doc, ids) { for (const id of expandGroups(doc, ids)) delete frameById(doc, id).group; }

export const boundsOf = (fs) => {
  const x0 = Math.min(...fs.map((f) => f.box[0])), y0 = Math.min(...fs.map((f) => f.box[1]));
  const x1 = Math.max(...fs.map((f) => f.box[0] + f.box[2])), y1 = Math.max(...fs.map((f) => f.box[1] + f.box[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
// the units a selection arranges as: one per group, one per loose frame; a unit with any locked
// member stays where it is
export function unitsOf(doc, ids) {
  const keyed = new Map();
  for (const id of expandGroups(doc, ids)) {
    const f = frameById(doc, id), k = f.group ? 'g:' + f.group : 'f:' + f.id;
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k).push(f);
  }
  return [...keyed.values()].map((members) => ({ members, box: boundsOf(members), locked: members.some((f) => f.locked) }));
}
const moveUnit = (u, dx, dy) => { for (const f of u.members) { f.box[0] += dx; f.box[1] += dy; } u.box[0] += dx; u.box[1] += dy; };

// align the units to their joint bounds: left · hcenter · right · top · vcenter · bottom. A locked
// unit is a REFERENCE: it counts for the bounds but stays put (lock the view, align legends to it).
export function alignFrames(doc, ids, how) {
  const all = unitsOf(doc, ids);
  if (all.length < 2) return;
  const [x0, y0, w0, h0] = boundsOf(all.map((u) => ({ box: u.box }))), x1 = x0 + w0, y1 = y0 + h0;
  for (const u of all.filter((v) => !v.locked)) {
    const b = u.box; let dx = 0, dy = 0;
    if (how === 'left') dx = x0 - b[0]; else if (how === 'right') dx = x1 - b[2] - b[0]; else if (how === 'hcenter') dx = (x0 + x1) / 2 - b[2] / 2 - b[0];
    else if (how === 'top') dy = y0 - b[1]; else if (how === 'bottom') dy = y1 - b[3] - b[1]; else if (how === 'vcenter') dy = (y0 + y1) / 2 - b[3] / 2 - b[1];
    moveUnit(u, dx, dy);
  }
}
// equal gaps between the units along 'h' or 'v' (the outer two stay)
export function distributeFrames(doc, ids, axis) {
  const us = unitsOf(doc, ids).filter((u) => !u.locked);
  if (us.length < 3) return;
  const k = axis === 'v' ? 1 : 0;
  us.sort((a, b) => a.box[k] - b.box[k]);
  const first = us[0].box, last = us[us.length - 1].box;
  const span = last[k] + last[k + 2] - first[k], used = us.reduce((s, u) => s + u.box[k + 2], 0);
  const gap = (span - used) / (us.length - 1);
  let at = first[k];
  for (const u of us) { const d = at - u.box[k]; moveUnit(u, k ? 0 : d, k ? d : 0); at += u.box[k + 2] + gap; }
}
// make the frames the size of the FIRST one in `ids` (the key frame — the one clicked first):
// 'w' · 'h' · 'both'. Top-left corners stay; locked frames don't change.
export function matchSize(doc, ids, what = 'both') {
  const fs = ids.map((id) => frameById(doc, id)).filter(Boolean);
  if (fs.length < 2) return;
  const [key, ...rest] = fs;
  for (const f of rest) {
    if (f.locked) continue;
    if (what !== 'h') f.box[2] = key.box[2];
    if (what !== 'w') f.box[3] = key.box[3];
  }
}

// ── snapping ──
// the lines a box can snap to: page edges, margins, centre; other frames' edges and centres
function snapLines(doc, skip) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [0, 0, 0, 0];
  const xs = [0, m[3], W / 2, W - m[1], W], ys = [0, m[0], H / 2, H - m[2], H];
  for (const f of doc.frames) {
    if (skip.has(f.id) || f.hidden) continue;
    xs.push(f.box[0], f.box[0] + f.box[2] / 2, f.box[0] + f.box[2]);
    ys.push(f.box[1], f.box[1] + f.box[3] / 2, f.box[1] + f.box[3]);
  }
  return [xs, ys];
}
const nearest = (cands, edges) => {
  let pick = null;
  for (const [off, e] of edges) for (const c of cands) { const d = c - e; if (!pick || Math.abs(d) < Math.abs(pick.d)) pick = { d, line: c, off }; }
  return pick;
};
// equal spacing along axis k (0 = x, 1 = y): the moving box's gap to its nearest neighbour
// matches a gap that already exists between two frames side by side, or the box sits centred
// between two neighbours. → { d, segs: [{ k, a, b, at }] } (gap segments to draw) or null
function spacingSnap(others, box, k) {
  const c = 1 - k, lo = (o) => o[k], hi = (o) => o[k] + o[k + 2];
  const overlap = (p, q) => p[c] < q[c] + q[c + 2] && p[c] + p[c + 2] > q[c];
  const mid = (p, q) => (Math.max(p[c], q[c]) + Math.min(p[c] + p[c + 2], q[c] + q[c + 2])) / 2;
  const gaps = [];
  for (const a of others) for (const b of others) if (a !== b && overlap(a, b) && hi(a) <= lo(b) + 1e-9) {
    // only adjacent pairs: nothing in between on this row
    if (others.some((o) => o !== a && o !== b && overlap(o, a) && overlap(o, b) && lo(o) >= hi(a) && hi(o) <= lo(b))) continue;
    const g = lo(b) - hi(a); if (g > 0.5) gaps.push({ g, seg: { k, a: hi(a), b: lo(b), at: mid(a, b) } });
  }
  const row = others.filter((o) => overlap(o, box));
  const left = row.filter((o) => hi(o) <= lo(box) + 2).sort((p, q) => hi(q) - hi(p))[0];
  const right = row.filter((o) => lo(o) >= hi(box) - 2).sort((p, q) => lo(p) - lo(q))[0];
  let best = null;
  const offer = (d, segs) => { if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, segs }; };
  if (left && right) {                                     // centred between the two
    const pos = (hi(left) + lo(right) - box[k + 2]) / 2, g = pos - hi(left);
    if (g > 0.5) offer(pos - lo(box), [{ k, a: hi(left), b: pos, at: mid(left, box) }, { k, a: pos + box[k + 2], b: lo(right), at: mid(right, box) }]);
  }
  for (const { g, seg } of gaps) {
    if (left) { const pos = hi(left) + g; offer(pos - lo(box), [seg, { k, a: hi(left), b: pos, at: mid(left, box) }]); }
    if (right) { const pos = lo(right) - g - box[k + 2]; offer(pos - lo(box), [seg, { k, a: pos + box[k + 2], b: lo(right), at: mid(right, box) }]); }
  }
  return best;
}
// a moving box: its edges and centre snap to the lines above, or to an equal spacing — whichever
// is nearer, per axis, within `tol` mm → { box, guides: { x, y, gaps: [segments] } }
export function snapBox(doc, box, { ignore = [], tol = 1.5 } = {}) {
  const skip = new Set(ignore), [xs, ys] = snapLines(doc, skip);
  const others = doc.frames.filter((f) => !skip.has(f.id) && !f.hidden).map((f) => f.box);
  const out = box.slice(), guides = { x: null, y: null, gaps: [] };
  for (const k of [0, 1]) {
    const edge = nearest(k ? ys : xs, [[0, box[k]], [0.5, box[k] + box[k + 2] / 2], [1, box[k] + box[k + 2]]]);
    const sp = spacingSnap(others, box, k);
    const e = edge && Math.abs(edge.d) <= tol ? edge : null, s = sp && Math.abs(sp.d) <= tol ? sp : null;
    if (s && (!e || Math.abs(s.d) < Math.abs(e.d) - 1e-9)) {
      out[k] += s.d;
      guides.gaps.push(...s.segs);                        // (the new gaps are measured at the snapped place)
    } else if (e) { out[k] += e.d; guides[k ? 'y' : 'x'] = e.line; }
  }
  return { box: out, guides };
}
// a resizing box: only the edges being dragged snap (handle [hx, hy], each 0 · 0.5 · 1)
export function snapResize(doc, box, [hx, hy], { ignore = [], tol = 1.5, onlyX = false } = {}) {
  const skip = new Set(ignore), [xs, ys] = snapLines(doc, skip);
  const out = box.slice(), guides = { x: null, y: null, gaps: [] };
  const one = (k, hk, cands) => {
    if (hk === 0.5) return;
    const edge = hk === 0 ? out[k] : out[k] + out[k + 2];
    const p = nearest(cands, [[hk, edge]]);
    if (!p || Math.abs(p.d) > tol) return;
    if (hk === 0) { out[k] += p.d; out[k + 2] -= p.d; } else out[k + 2] += p.d;
    guides[k ? 'y' : 'x'] = p.line;
  };
  one(0, hx, xs);
  if (!onlyX) one(1, hy, ys);
  return { box: out, guides };
}
