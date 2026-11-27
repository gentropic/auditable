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
  migrate(d);
  return d;
}
// JSON for saving: frames' runtime-only fields (a decoded bitmap) are dropped
function serializeDocument(doc) {
  return JSON.stringify(doc, (k, v) => (k.startsWith('_') ? undefined : v), 1);
}

// ── IDS: every frame's ONE handle. Auto-made as <prefix>-<n> (view-1, text-2, scale-1), editable,
// a short token (letters, digits, - _ .) so a field can name it: {scale@plan}. Renaming rewrites
// every reference to it (content.of, @id in fields). ──
const ID_RE = /^[A-Za-z0-9_][\w.-]*$/;
const sanitizeId = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, '-').replace(/[^\w.-]/g, '').replace(/^[.-]+/, '');
const PREFIX = { image: 'image', text: 'text', legend: 'legend', scalebar: 'scale', north: 'north', table: 'table', drawlist: 'chart', titleblock: 'titleblock' };
const idPrefix = (frame) => (frame && frame.source && frame.source.kind === 'view' ? 'view' : (frame && frame.source && frame.source.kind === 'plot') ? 'plot' : PREFIX[frame && frame.kind] || (frame && frame.kind) || 'frame');
function newId(doc, prefix) {
  const used = new Set((doc.frames || []).map((f) => f.id));
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
// every string in a frame that can carry fields: a text's md, a legend's / table's title and note
const FIELD_KEYS = ['md', 'title', 'note'];
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rewriteRefs(doc, from, to) {
  const at = new RegExp(`@${escRe(from)}(?=\\})`, 'g');
  for (const f of doc.frames) {
    const c = f.content; if (!c) continue;
    if (c.of === from) c.of = to;
    for (const k of FIELD_KEYS) if (typeof c[k] === 'string') c[k] = c[k].replace(at, '@' + to);
    if (Array.isArray(c.rows)) for (const r of c.rows) if (Array.isArray(r) && typeof r[0] === 'string') r[0] = r[0].replace(at, '@' + to);   // a title block's rows
  }
}
// rename a frame → null, or the reason it can't be
function renameFrame(doc, from, to) {
  const f = doc.frames.find((x) => x.id === from);
  if (!f) return `no frame “${from}”`;
  if (to === from) return null;
  if (!ID_RE.test(to)) return `“${to}” — an id is letters, digits, - _ and . (no spaces)`;
  if (doc.frames.some((x) => x.id === to)) return `another frame is already “${to}”`;
  f.id = to;
  rewriteRefs(doc, from, to);
  return null;
}
// older documents: a display `name` becomes the id (when it can), and {ref:x} becomes {fig@x}
function migrate(d) {
  for (const f of d.frames) {
    const c = f.content;
    if (c) for (const k of FIELD_KEYS) if (typeof c[k] === 'string') c[k] = c[k].replace(/\{ref:([^{}:@]+)\}/g, (_, x) => `{fig@${x.trim()}}`).replace(/\{scale:([^{}:@]+)\}/g, (_, x) => `{scale@${x.trim()}}`);
  }
  for (const f of d.frames) {
    if (f.name == null) continue;
    const want = sanitizeId(f.name);
    const named = d.frames.filter((x) => x !== f);
    // a reference written to the old name follows it to the id
    if (want && ID_RE.test(want) && !named.some((x) => x.id === want)) { const old = f.id; f.id = want; rewriteRefs(d, old, want); if (f.name !== want) rewriteRefs(d, f.name, want); }
    delete f.name;
  }
  for (const hook of LOAD_MIGRATIONS) hook(d);
}
// migrations a module registers for itself (house.js: an old title block → the titleblock kind),
// run on every load after the ones above — so model.js needn't know what they migrate
const LOAD_MIGRATIONS = [];

// add a frame: { kind, box?, content, source?, style? } → the frame (placed in the margins, or
// centred, when no box is given)
function addFrame(doc, frame) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [0, 0, 0, 0];
  const box = frame.box || [m[3] + 10, m[0] + 10, Math.min(120, W - m[1] - m[3] - 20), Math.min(80, H - m[0] - m[2] - 20)];
  const f = { id: frame.id || (frame.name && ID_RE.test(sanitizeId(frame.name)) && !doc.frames.some((x) => x.id === sanitizeId(frame.name)) ? sanitizeId(frame.name) : newId(doc, idPrefix(frame))), kind: frame.kind, box: box.map(Number), content: frame.content || {}, ...(frame.source ? { source: frame.source } : {}), ...(frame.style ? { style: frame.style } : {}), ...(frame.group ? { group: frame.group } : {}), ...(frame.locked ? { locked: true } : {}), ...(frame.hidden ? { hidden: true } : {}), produced: frame.produced || new Date().toISOString() };
  doc.frames.push(f);
  return f;
}
const frameById = (doc, id) => doc.frames.find((f) => f.id === id) || null;
function removeFrames(doc, ids) { const s = new Set(ids); doc.frames = doc.frames.filter((f) => !s.has(f.id)); }


// ── z-order: the frames list is back-to-front ──
function bringToFront(doc, ids) { const s = new Set(expandGroups(doc, ids)); doc.frames = doc.frames.filter((f) => !s.has(f.id)).concat(doc.frames.filter((f) => s.has(f.id))); }
function sendToBack(doc, ids) { const s = new Set(expandGroups(doc, ids)); doc.frames = doc.frames.filter((f) => s.has(f.id)).concat(doc.frames.filter((f) => !s.has(f.id))); }
// one step: each selected frame swaps past the next unselected one above (below)
function bringForward(doc, ids) {
  const s = new Set(expandGroups(doc, ids)), a = doc.frames;
  for (let i = a.length - 2; i >= 0; i--) if (s.has(a[i].id) && !s.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
}
function sendBackward(doc, ids) {
  const s = new Set(expandGroups(doc, ids)), a = doc.frames;
  for (let i = 1; i < a.length; i++) if (s.has(a[i].id) && !s.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
}

// ── groups: frames sharing a `group` id select, move, align and distribute as ONE unit ──
let _gseq = 0;
function expandGroups(doc, ids) {
  const want = new Set(ids), groups = new Set();
  for (const f of doc.frames) if (want.has(f.id) && f.group) groups.add(f.group);
  return doc.frames.filter((f) => want.has(f.id) || (f.group && groups.has(f.group))).map((f) => f.id);
}
// the selected frames (and their groups' other members) into one new group → its id
function groupFrames(doc, ids) {
  const all = expandGroups(doc, ids);
  if (all.length < 2) return null;
  const used = new Set(doc.frames.map((f) => f.group).filter(Boolean));
  let g; do g = `g${(++_gseq).toString(36)}`; while (used.has(g));
  for (const id of all) frameById(doc, id).group = g;
  gatherGroup(doc, g);
  return g;
}
// a group's frames sit together in the stacking order, where its frontmost member was — so a
// list of frames can show the group as one folder
function gatherGroup(doc, g) {
  const members = doc.frames.filter((f) => f.group === g);
  if (members.length < 2) return;
  const front = doc.frames.lastIndexOf(members[members.length - 1]);
  const before = doc.frames.slice(0, front + 1).filter((f) => f.group !== g), after = doc.frames.slice(front + 1);
  doc.frames = [...before, ...members, ...after];
}
// a one-member group is no group
function pruneGroups(doc) {
  const n = new Map();
  for (const f of doc.frames) if (f.group) n.set(f.group, (n.get(f.group) || 0) + 1);
  for (const f of doc.frames) if (f.group && n.get(f.group) < 2) delete f.group;
}
// move frames in the stacking order: ids (a group's members move as a block) go just in front of
// (above: true) or behind the frame `target`; a frame dropped outside its group's block leaves the
// group; a block never splits another group (it lands beside that group's block)
function moveInStack(doc, ids, target, above) {
  const moving = doc.frames.filter((f) => ids.includes(f.id));
  if (!moving.length || ids.includes(target)) return;
  const rest = doc.frames.filter((f) => !ids.includes(f.id));
  let t = rest.findIndex((f) => f.id === target);
  if (t < 0) return;
  const tg = rest[t].group, mg = new Set(moving.map((f) => f.group));
  const intoOwn = tg && mg.size === 1 && mg.has(tg) && moving.length < doc.frames.filter((f) => f.group === tg).length;
  if (tg && !intoOwn) {                                    // land beside the target's whole block
    const first = rest.findIndex((f) => f.group === tg), last = rest.length - 1 - [...rest].reverse().findIndex((f) => f.group === tg);
    t = above ? last : first;
  }
  const at = above ? t + 1 : t;
  if (!intoOwn) for (const f of moving) if (f.group && (!tg || f.group !== tg) && moving.length < doc.frames.filter((x) => x.group === f.group).length) delete f.group;
  doc.frames = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  pruneGroups(doc);
}
function ungroupFrames(doc, ids) { for (const id of expandGroups(doc, ids)) delete frameById(doc, id).group; }

const boundsOf = (fs) => {
  const x0 = Math.min(...fs.map((f) => f.box[0])), y0 = Math.min(...fs.map((f) => f.box[1]));
  const x1 = Math.max(...fs.map((f) => f.box[0] + f.box[2])), y1 = Math.max(...fs.map((f) => f.box[1] + f.box[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
// the units a selection arranges as: one per group, one per loose frame; a unit with any locked
// member stays where it is
function unitsOf(doc, ids) {
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
function alignFrames(doc, ids, how) {
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
function distributeFrames(doc, ids, axis) {
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
function matchSize(doc, ids, what = 'both') {
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
  const gd = doc.page.guides || {};                        // ruler guides (page.guides: { x: [mm], y: [mm] })
  xs.push(...(gd.x || [])); ys.push(...(gd.y || []));
  return [xs, ys];
}
// the grid (page.grid: { size mm, show, snap }): the grid line nearest each edge joins the candidates
const gridLines = (doc, values) => {
  const g = doc.page.grid;
  return g && g.snap && g.size > 0 ? values.map((v) => Math.round(v / g.size) * g.size) : [];
};
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
// WHERE A NEW FRAME GOES: a w × h box that overlaps no visible frame (gap mm apart) and stays inside the margins —
// beside `near` first (right of it, below it, left of it), else the first free place scanning the page top to
// bottom, left to right. New frames used to land at the top-left margin, on top of whatever was there (a table on
// the 3D view, five legends running off the page). → [x, y, w, h] (it may shrink the box to fit the free space
// it finds only as a last resort: then the page's top-left, as before)
function freeSpot(doc, w, h, { near = null, gap = 4, ignore = [], shrink = false } = {}) {
  // shrink: a frame that re-flows (a chart, a table) may come smaller rather than land on another — the largest
  // scale (down to half, aspect kept) that finds a free place
  if (shrink) {
    for (let k = 1; k >= 0.5 - 1e-9; k -= 0.05) {
      const b = freeSpot(doc, +(w * k).toFixed(1), +(h * k).toFixed(1), { near, gap, ignore });
      if (!b._fallback) return b;
    }
  }
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const others = doc.frames.filter((f) => !f.hidden && !ignore.includes(f.id)).map((f) => f.box);
  const fits = (x, y) => x >= m[3] - 1e-6 && y >= m[0] - 1e-6 && x + w <= W - m[1] + 1e-6 && y + h <= H - m[2] + 1e-6
    && others.every((b) => x + w + gap <= b[0] || b[0] + b[2] + gap <= x || y + h + gap <= b[1] || b[1] + b[3] + gap <= y);
  if (near) {
    const b = near.box || near;
    for (const [x, y] of [[b[0] + b[2] + gap, b[1]], [b[0], b[1] + b[3] + gap], [b[0] - gap - w, b[1]]]) {
      if (fits(x, y)) return [x, y, w, h];
      // slide along that side to the first free place
      for (let t = 0; t <= Math.max(W, H); t += 2) {
        if (x === b[0] + b[2] + gap || x === b[0] - gap - w) { if (fits(x, b[1] + t)) return [x, b[1] + t, w, h]; }
        else if (fits(b[0] + t, y)) return [b[0] + t, y, w, h];
      }
    }
  }
  for (let y = m[0]; y + h <= H - m[2] + 1e-6; y += 2) for (let x = m[3]; x + w <= W - m[1] + 1e-6; x += 2) if (fits(x, y)) return [x, y, w, h];
  const fb = [m[3] + 8, m[0] + 8, w, h];
  Object.defineProperty(fb, '_fallback', { value: true });   // no free place: the page's top-left, as it used to
  return fb;
}
// a moving box: its edges and centre snap to the lines above, or to an equal spacing — whichever
// is nearer, per axis, within `tol` mm → { box, guides: { x, y, gaps: [segments] } }
function snapBox(doc, box, { ignore = [], tol = 1.5 } = {}) {
  const skip = new Set(ignore), [xs, ys] = snapLines(doc, skip);
  const others = doc.frames.filter((f) => !skip.has(f.id) && !f.hidden).map((f) => f.box);
  const out = box.slice(), guides = { x: null, y: null, gaps: [] };
  for (const k of [0, 1]) {
    const edges = [[0, box[k]], [0.5, box[k] + box[k + 2] / 2], [1, box[k] + box[k + 2]]];
    const edge = nearest((k ? ys : xs).concat(gridLines(doc, [box[k], box[k] + box[k + 2]])), edges);
    const sp = spacingSnap(others, box, k);
    const e = edge && Math.abs(edge.d) <= tol ? edge : null, s = sp && Math.abs(sp.d) <= tol ? sp : null;
    if (s && (!e || Math.abs(s.d) < Math.abs(e.d) - 1e-9)) {
      out[k] += s.d;
      guides.gaps.push(...s.segs);                        // (the new gaps are measured at the snapped place)
    } else if (e) { out[k] = e.line - e.off * box[k + 2]; guides[k ? 'y' : 'x'] = e.line; }   // exactly on the line (no float drift)
  }
  return { box: out, guides };
}
// a resizing box: only the edges being dragged snap (handle [hx, hy], each 0 · 0.5 · 1)
function snapResize(doc, box, [hx, hy], { ignore = [], tol = 1.5, onlyX = false } = {}) {
  const skip = new Set(ignore), [xs, ys] = snapLines(doc, skip);
  const out = box.slice(), guides = { x: null, y: null, gaps: [] };
  const one = (k, hk, cands) => {
    if (hk === 0.5) return;
    const edge = hk === 0 ? out[k] : out[k] + out[k + 2];
    const p = nearest(cands.concat(gridLines(doc, [edge])), [[hk, edge]]);
    if (!p || Math.abs(p.d) > tol) return;
    if (hk === 0) { out[k + 2] += out[k] - p.line; out[k] = p.line; } else out[k + 2] = p.line - out[k];
    guides[k ? 'y' : 'x'] = p.line;
  };
  one(0, hx, xs);
  if (!onlyX) one(1, hy, ys);
  return { box: out, guides };
}

// ── src/type.js ──

// type: the page's fonts, sized in points on a millimetre context (a leaf: kinds and world both use it)
const SANS = "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Space Mono', 'JetBrains Mono', Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const PT = 25.4 / 72;                                      // mm per point
const INK = '#1a1a1a';
// a CSS font for the canvas — and for @gcu/pdf, which reads the same string: italic / bold pick the standard
// face (Helvetica-Oblique, Times-BoldItalic …), the first family picks sans / mono / serif
const fontMm = (pt, { mono = false, serif = false, bold = false, italic = false } = {}) =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : serif ? SERIF : SANS}`;

// ── src/fields.js ──

// FIELDS — the live bits of text on a page. A caption says `{fig}`, `{page}`, `{date:DD/MM/YYYY}`,
// `{scale}`; the page fills them in when it is drawn, so a reprint is always current.
//
//   {name}           a field
//   {name:arg}       a field with an argument (a format, a frame's name, a column …)
//   {name:arg:,.2f}  … and a number format at the end
//   {name@id}        … about the frame with that id ({scale@plan}); without one, the frame's
//                    "refers to" (content.of), else the nearest frame that fits
//   ${expr}          an expression the HOST evaluates (env.evalField), e.g. an atlas row's values
//   ${expr:,.0f}     … formatted
//
// Number formats (Python's, the useful part): `,` or `_` groups thousands (comma / space), `.N`
// the decimals, then `f` fixed, `%` percent, `e` exponent. `,` alone groups an integer.
//
// Fields are a registry: compo registers fig/page/pages/date/time/title (and scale, in
// kinds.js); a host adds its own with registerField or per page with env.fields. An unknown
// `{word}` is left exactly as written, so ordinary braces in text survive.

const FIELDS = new Map();
// fn(arg, frame, env) → a string, a number (formatted), or null/undefined (→ '—')
function registerField(name, fn, help = '') { FIELDS.set(name, { fn, help }); }
function fieldList(env = {}) {
  const out = [...FIELDS].map(([name, f]) => ({ name, help: f.help }));
  for (const h of env.fieldHelp || []) if (!out.some((o) => o.name === h.name)) out.push(h);
  return out;
}

// ── number formats ──
const SPEC_RE = /^([,_])?(?:\.(\d{1,2}))?([f%e])?$/;
const isFormatSpec = (s) => !!s && SPEC_RE.test(s);
// no format: six significant figures, but never rounding away the integer part (a UTM northing)
const plain = (x) => (Number.isInteger(x) ? String(x) : Math.abs(x) >= 1e6 ? String(Math.round(x)) : String(+x.toPrecision(6))).replace(/^-/, '−');
// small formatters a host's own fields share with compo's:
// groupDigits(2343000) → '2 343 000' — an integer's thousands grouped (a space, the SI way; ',' for 2,343,000)
const groupDigits = (n, sep = ' ') => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
// significant(1234.567, 4) → 1235 — a number to k significant figures ('' when it isn't one)
const significant = (v, k = 4) => (Number.isFinite(v) ? +v.toPrecision(k) : '');
// fmtBearing(45) → '045°' — a compass bearing, three digits, 0–359
const fmtBearing = (v) => String(Math.round(((v % 360) + 360) % 360) % 360).padStart(3, '0') + '°';
const group = (intStr, sep) => groupDigits(intStr, sep);
function formatNumber(x, spec = '') {
  if (typeof x !== 'number') return x == null ? '' : String(x);
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞';
  const m = SPEC_RE.exec(spec || '');
  if (!m || !spec) return plain(x);
  const [, sep, dec, type] = m;
  let v = x, suffix = '';
  if (type === '%') { v = x * 100; suffix = '%'; }
  let s;
  if (type === 'e') s = v.toExponential(dec != null ? +dec : 3);
  else if (dec != null) s = v.toFixed(+dec);
  else if (type === 'f' || type === '%') s = v.toFixed(type === '%' ? 0 : 6);
  else s = plain(v).replace('−', '-');
  if (sep && type !== 'e') {
    const neg = s[0] === '-', body = neg ? s.slice(1) : s, [ip, fp] = body.split('.');
    s = (neg ? '-' : '') + group(ip, sep === ',' ? ',' : ' ') + (fp != null ? '.' + fp : '');
  }
  return s.replace(/^-/, '−') + suffix;
}
// a value as text: numbers through the format, the rest as they are
const asText = (v, spec) => (v == null ? '—' : typeof v === 'number' ? formatNumber(v, spec) : String(v));

// ── dates: YYYY YY MMMM MMM MM M DD D HH mm ss ──
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = (n) => String(n).padStart(2, '0');
function formatDate(d, fmt) {
  const t = { YYYY: d.getFullYear(), YY: p2(d.getFullYear() % 100), MMMM: MON[d.getMonth()], MMM: MON[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), M: d.getMonth() + 1, DD: p2(d.getDate()), D: d.getDate(), HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()) };
  return String(fmt).replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|mm|ss/g, (k) => String(t[k]));
}
const nowOf = (env) => (env.now instanceof Date ? env.now : env.now ? new Date(env.now) : new Date());

// ── the frame a field is ABOUT ──
// refFrame(doc, frame, id, test): the frame with that id, else the nearest one passing the test
// (the gap between the boxes, then their centres: the caption under a view means that view).
function refFrame(doc, frame, id, test = () => true) {
  if (!doc) return null;
  const frames = doc.frames.filter((f) => !f.hidden && f !== frame);
  if (id) return frames.find((f) => f.id === id) || null;
  const cand = frames.filter(test);
  if (!frame || cand.length <= 1) return cand[0] || null;
  const gap = (a, b) => {
    const dx = Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])), dy = Math.max(0, a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3]));
    const cx = a[0] + a[2] / 2 - (b[0] + b[2] / 2), cy = a[1] + a[3] / 2 - (b[1] + b[3] / 2);
    return Math.hypot(dx, dy) * 1e3 + Math.hypot(cx, cy);
  };
  let best = null, bd = Infinity;
  for (const f of cand) { const d = gap(frame.box, f.box); if (d < bd) { bd = d; best = f; } }
  return best;
}
// subjectFrame(env, frame, test) — in order: the field's own @id, the frame's "refers to"
// (content.of), the nearest frame passing the test. The one rule every frame-reading field uses.
function subjectFrame(env, frame, test = () => true) {
  const doc = env.doc; if (!doc) return null;
  if (env.at) return doc.frames.find((f) => f.id === env.at) || null;
  const of = frame && frame.content && frame.content.of;
  if (of) return doc.frames.find((f) => f.id === of) || null;
  return refFrame(doc, frame, null, test);
}
const saysFig = (f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || '');

// ── the built-ins ──
registerField('fig', (a, frame, env) => {
  if (!env.figOf) return 1;
  if (!env.at) return env.figOf(frame);
  // {fig@x}: x's figure number — x a caption, or (a view) the caption nearest it
  const t = env.doc && env.doc.frames.find((f) => f.id === env.at);
  const cap = t && (saysFig(t) ? t : refFrame(env.doc, t, null, saysFig));
  return cap ? env.figOf(cap) : `⟨“${env.at}” has no {fig} caption⟩`;
}, 'the figure number (counted in page order, on across an atlas); {fig@plan} = another caption’s or view’s');
registerField('page', (a, f, env) => env.page ?? 1, 'the page number');
registerField('pages', (a, f, env) => env.pages ?? 1, 'the page count');
registerField('date', (a, f, env) => (a ? formatDate(nowOf(env), a) : env.date || formatDate(nowOf(env), 'YYYY-MM-DD')), 'today: {date} · {date:DD/MM/YYYY} · {date:D MMMM YYYY}');
registerField('time', (a, f, env) => formatDate(nowOf(env), a || 'HH:mm'), 'the time: {time} · {time:HH:mm:ss}');
registerField('title', (a, f, env) => env.title || '', "the figure's title");
// {prop:key} — a property: the document's own (doc.props — a drawing number, a revision) over the
// host's (env.props — a house style's company, client, project …)
registerField('prop', (a, f, env) => {
  if (!a) return '⟨which property? {prop:client}⟩';
  const own = env.doc && env.doc.props && env.doc.props[a], house = env.props && env.props[a];
  return own != null && own !== '' ? own : house != null && house !== '' ? house : '—';
}, "a property — the figure's own (drawing, revision) over the project's (company, client, project, prepared, checked): {prop:client}");

// {crs} — the coordinate reference system the host states (env.crs = { name, code } — code like
// 'EPSG:31983', or null for a custom definition): {crs} = "name · code", {crs:name}, {crs:code}
registerField('crs', (a, f, env) => {
  const c = env.crs;
  if (!c || !c.name) return '—';
  if (a === 'name') return c.name;
  if (a === 'code') return c.code || 'custom';
  return c.code ? `${c.name} · ${c.code}` : c.name;
}, 'the coordinate system: {crs} = “SIRGAS 2000 / UTM zone 23S · EPSG:31983” · {crs:name} · {crs:code}');

// {name}  {name:arg}  {name:arg:spec}  … and @id last: {scale@plan}, {mean:AU:.2f@plan}
const FIELD_RE = /\{([A-Za-z][\w-]*)(?::([^{}@]*))?(?:@([\w.-]+))?\}/g;
function resolveFields(src, env = {}, frame = null) {
  let s = String(src == null ? '' : src);
  // ${expr} and ${expr:spec} — the host's expressions
  s = s.replace(/\$\{([^}]*)\}/g, (_, raw) => {
    let expr = raw, spec = '';
    const k = raw.lastIndexOf(':');
    if (k >= 0 && isFormatSpec(raw.slice(k + 1).trim())) { expr = raw.slice(0, k); spec = raw.slice(k + 1).trim(); }
    if (!env.evalField) return `⟨${expr.trim()}⟩`;
    try { const v = env.evalField(expr.trim(), env.vars || {}, frame, env); return v == null ? '' : asText(v, spec); } catch (e) { return `⟨${expr.trim()}: ${e.message}⟩`; }
  });
  return s.replace(FIELD_RE, (whole, name, arg, at) => {
    const f = (env.fields && env.fields[name]) ? { fn: env.fields[name] } : FIELDS.get(name);
    if (!f) return whole;
    if (at && env.doc && !env.doc.frames.some((x) => x.id === at)) return `⟨no frame “${at}”⟩`;
    let a = arg == null ? '' : arg, spec = '';
    if (isFormatSpec(a)) { spec = a; a = ''; } else { const k = a.lastIndexOf(':'); if (k >= 0 && isFormatSpec(a.slice(k + 1))) { spec = a.slice(k + 1); a = a.slice(0, k); } }
    try { return asText(f.fn(a.trim(), frame, at ? { ...env, at } : env), spec); } catch (e) { return `⟨${name}: ${e.message}⟩`; }
  });
}

// ── src/world.js ──

// WORLD — an image frame that is a picture of 3D space (a host's render) can say how:
//
//   content.meta.proj = { m: [16 numbers, column-major: (world − origin) → clip space], origin: [x, y, z], focus?: [x, y, z] }
//
// Then compo knows where any world point lands on the page, and which world coordinate any point
// of the picture shows. That gives:
// - coordinate ticks (or a grid) on the frame's border, as vectors: "512 300 E", "630 RL";
// - labels pinned to a world point (a hole, a callout): the leader follows the point when the
//   view is rendered again.
// The matrix is the renderer's own viewProj at the frame's aspect, so vertical exaggeration and
// a perspective camera come along for free (ticks are drawn only for an orthographic view,
// where a border point has one coordinate).


const hasProj = (f) => !!(f && f.content && f.content.meta && f.content.meta.proj && Array.isArray(f.content.meta.proj.m) && f.content.meta.proj.m.length === 16);
const isOrthoProj = (m) => Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) < 1e-9;

// the picture's rect on the page (the image kind's fit), mm
function imageRect(frame) {
  const c = frame.content || {}, b = frame.box, img = frame._img;
  const iw = c.width || (img && img.width), ih = c.height || (img && img.height);
  if (!iw || !ih || c.fit === 'fill') return [b[0], b[1], b[2], b[3]];
  const k = c.fit === 'cover' ? Math.max(b[2] / iw, b[3] / ih) : Math.min(b[2] / iw, b[3] / ih);
  const w = iw * k, h = ih * k;
  return [b[0] + (b[2] - w) / 2, b[1] + (b[3] - h) / 2, w, h];
}
const mul4 = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
function inv4(m) {
  const a = m, inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) return null;
  return inv.map((v) => v / det);
}
const _inv = new WeakMap();
const invOf = (P) => { let i = _inv.get(P); if (!i) { i = inv4(P.m); _inv.set(P, i); } return i; };

// a world point → { x, y } on the page (mm) and whether it is inside the picture; null behind the eye
function worldToPage(frame, p) {
  const P = frame.content.meta.proj, o = P.origin || [0, 0, 0];
  const c = mul4(P.m, [p[0] - o[0], p[1] - o[1], p[2] - o[2], 1]);
  if (!(c[3] > 1e-12)) return null;
  const nx = c[0] / c[3], ny = c[1] / c[3], r = imageRect(frame);
  return { x: r[0] + ((nx + 1) / 2) * r[2], y: r[1] + ((1 - ny) / 2) * r[3], inside: Math.abs(nx) <= 1 && Math.abs(ny) <= 1 };
}
// the depth (NDC z) of the view's FOCUS (proj.focus, a world point — the camera's target): a ray is
// read there, not at an arbitrary depth (a near-plan view's ray drifts sideways with depth)
function focusZ(frame) {
  const P = frame.content.meta.proj, f = P.focus; if (!Array.isArray(f) || f.length !== 3) return 0;
  const o = P.origin || [0, 0, 0], c = mul4(P.m, [f[0] - o[0], f[1] - o[1], f[2] - o[2], 1]);
  return c[3] > 1e-12 ? Math.max(-1, Math.min(1, c[2] / c[3])) : 0;
}
// a page point (mm) → the world point it shows, at depth ndcZ (−1 near … 1 far; default: the focus's)
function pageToWorld(frame, x, y, ndcZ) {
  const P = frame.content.meta.proj, o = P.origin || [0, 0, 0], inv = invOf(P); if (!inv) return null;
  if (ndcZ == null) ndcZ = focusZ(frame);
  const r = imageRect(frame), nx = ((x - r[0]) / r[2]) * 2 - 1, ny = 1 - ((y - r[1]) / r[3]) * 2;
  const v = mul4(inv, [nx, ny, ndcZ, 1]);
  return [v[0] / v[3] + o[0], v[1] / v[3] + o[1], v[2] / v[3] + o[2]];
}

// ── coordinate ticks on an orthographic view's border ──
const AXIS = ['E', 'N', 'RL'];
const NICE = [1, 2, 2.5, 5, 10];
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return NICE.find((n) => n >= f - 1e-9) * p;
}
function fmtCoord(v, step) {
  const dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9));
  const s = Math.abs(v).toFixed(dec), [ip, fp] = s.split('.');
  return (v < 0 ? '−' : '') + groupDigits(ip) + (fp ? '.' + fp : '');
}
// the ticks of one view frame: [{ edge, axis, value, x, y }] — what drawTicks draws, for tests and hosts
function worldTicks(frame, { spacing = 18 } = {}) {
  if (!hasProj(frame) || !isOrthoProj(frame.content.meta.proj.m)) return [];
  const r = imageRect(frame), b = frame.box;
  const x0 = Math.max(r[0], b[0]), y0 = Math.max(r[1], b[1]), x1 = Math.min(r[0] + r[2], b[0] + b[2]), y1 = Math.min(r[1] + r[3], b[1] + b[3]);
  if (!(x1 > x0 && y1 > y0)) return [];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, n0 = pageToWorld(frame, cx, cy, -1), n1 = pageToWorld(frame, cx, cy, 1);
  if (!n0 || !n1) return [];
  const dl = Math.hypot(n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]) || 1, dir = [0, 1, 2].map((i) => (n1[i] - n0[i]) / dl);
  const edges = [['top', [x0, y0], [x1, y0]], ['bottom', [x0, y1], [x1, y1]], ['left', [x0, y0], [x0, y1]], ['right', [x1, y0], [x1, y1]]];
  const out = [];
  for (const [edge, a, bb] of edges) {
    const wa = pageToWorld(frame, a[0], a[1]), wb = pageToWorld(frame, bb[0], bb[1]);
    const e = [0, 1, 2].map((i) => wb[i] - wa[i]), el = Math.hypot(...e) || 1;
    // the coordinate this edge shows: constant along the view direction, changing most along the edge
    let ax = -1, best = 0;
    for (let i = 0; i < 3; i++) if (Math.abs(dir[i]) < 0.3 && Math.abs(e[i]) / el > 0.5 && Math.abs(e[i]) > best) { best = Math.abs(e[i]); ax = i; }
    if (ax < 0) continue;
    const lenMm = Math.hypot(bb[0] - a[0], bb[1] - a[1]), step = niceStep(Math.abs(e[ax]) / Math.max(1.5, lenMm / spacing));
    const lo = Math.min(wa[ax], wb[ax]), hi = Math.max(wa[ax], wb[ax]);
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
      const t = (v - wa[ax]) / e[ax];
      if (t < 0.02 || t > 0.98) continue;                  // not in the corners
      out.push({ edge, axis: AXIS[ax], ai: ax, value: +v.toFixed(9), step, x: a[0] + t * (bb[0] - a[0]), y: a[1] + t * (bb[1] - a[1]) });
    }
  }
  return out;
}
function drawTicks(ctx, frame, mode = 'ticks') {
  const ticks = worldTicks(frame); if (!ticks.length) return;
  const size = 5.5, tl = 1.6;
  ctx.save();
  ctx.lineWidth = 0.18; ctx.strokeStyle = '#1a1a1a';
  if (mode === 'grid') {                                   // lines across: a value on one edge to the same value on the opposite edge
    ctx.save(); ctx.strokeStyle = 'rgba(26,26,26,0.35)'; ctx.lineWidth = 0.12;
    for (const [e1, e2] of [['top', 'bottom'], ['left', 'right']]) for (const t of ticks.filter((x) => x.edge === e1)) {
      const u = ticks.find((x) => x.edge === e2 && x.axis === t.axis && Math.abs(x.value - t.value) < t.step * 1e-6);
      if (u) { ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(u.x, u.y); ctx.stroke(); }
    }
    ctx.restore();
  }
  ctx.font = fontMm(size); ctx.fillStyle = '#1a1a1a';
  for (const t of ticks) {
    const txt = `${fmtCoord(t.value, t.step)} ${t.axis}`, inward = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[t.edge];
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + inward[0] * tl, t.y + inward[1] * tl); ctx.stroke();
    const w = ctx.measureText(txt).width, hh = size * 25.4 / 72;
    // a label near a corner slides along its edge to stay inside the picture (not clipped)
    const ir = imageRect(frame), bx = frame.box, ex0 = Math.max(ir[0], bx[0]), ey0 = Math.max(ir[1], bx[1]), ex1 = Math.min(ir[0] + ir[2], bx[0] + bx[2]), ey1 = Math.min(ir[1] + ir[3], bx[1] + bx[3]);
    const clampTo = (v, a, b) => (a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v)));
    const side = t.edge === 'left' || t.edge === 'right';
    const lx = side ? t.x : clampTo(t.x, ex0 + w / 2 + 0.6, ex1 - w / 2 - 0.6), ly = side ? clampTo(t.y, ey0 + w / 2 + 0.6, ey1 - w / 2 - 0.6) : t.y;
    ctx.save();
    ctx.translate(lx + inward[0] * (tl + 0.4), ly + inward[1] * (tl + 0.4));
    if (t.edge === 'left' || t.edge === 'right') ctx.rotate(-Math.PI / 2);
    // the label sits inward of its tick, centred on it, on a light backing. Rotated −90° on the
    // side edges (reading upward), local +y points into the picture on the left edge, out of it
    // on the right — so the left and top labels hang below y = 0, the right and bottom ones above.
    const y0 = t.edge === 'top' || t.edge === 'left' ? 0 : -hh * 1.15;
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(-w / 2 - 0.4, y0, w + 0.8, hh * 1.15);
    ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(txt, 0, y0 + 0.1 * hh);
    ctx.restore();
  }
  ctx.restore();
}

// ── world OVERLAYS on a projected view: { type: 'plane', normal, position, thickness?, color?, label? }
// draws the plane's TRACE — where n·p = position crosses the picture (at the view's focal depth;
// exact for a vertical plane on a plan) — solid, with its slab's faces dashed when it has a
// thickness. A key plan wears the section of the view it keys. ──
function planeSegment(frame, normal, position) {
  const r = imageRect(frame), b = frame.box;
  const x0 = Math.max(r[0], b[0]), y0 = Math.max(r[1], b[1]), x1 = Math.min(r[0] + r[2], b[0] + b[2]), y1 = Math.min(r[1] + r[3], b[1] + b[3]);
  const g = (x, y) => { const w = pageToWorld(frame, x, y); return w ? normal[0] * w[0] + normal[1] * w[1] + normal[2] * w[2] - position : NaN; };
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], v = cs.map(([x, y]) => g(x, y)), pts = [];
  if (v.some((q) => !Number.isFinite(q))) return null;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, a = v[i], c = v[j];
    if (a === 0) pts.push(cs[i]);
    if ((a < 0 && c > 0) || (a > 0 && c < 0)) { const t = a / (a - c); pts.push([cs[i][0] + t * (cs[j][0] - cs[i][0]), cs[i][1] + t * (cs[j][1] - cs[i][1])]); }
  }
  return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null;
}
function planeTrace(frame, ov) {
  if (!hasProj(frame) || !ov || !Array.isArray(ov.normal)) return null;
  const n = ov.normal.map(Number), l = Math.hypot(...n); if (!(l > 0)) return null;
  const u = n.map((q) => q / l), d = +ov.position / l;
  // a plane facing the viewer (a level on a plan) has no trace — it is the whole picture or none of it
  const r = imageRect(frame), cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2, n0 = pageToWorld(frame, cx, cy, -1), n1 = pageToWorld(frame, cx, cy, 1);
  if (n0 && n1) { const dv = [0, 1, 2].map((i) => n1[i] - n0[i]), dl = Math.hypot(...dv) || 1; if (Math.abs((u[0] * dv[0] + u[1] * dv[1] + u[2] * dv[2]) / dl) > 0.98) return null; }
  const out = { line: planeSegment(frame, u, d), faces: [] };
  if (+ov.thickness > 0) for (const s of [-1, 1]) { const f = planeSegment(frame, u, d + (s * +ov.thickness) / 2); if (f) out.faces.push(f); }
  return out.line || out.faces.length ? out : null;
}
function drawOverlays(ctx, frame, list) {
  for (const ov of list || []) {
    if (!ov || ov.type !== 'plane') continue;
    const t = planeTrace(frame, ov); if (!t) continue;
    const col = ov.color || '#c0392b';
    ctx.save();
    ctx.strokeStyle = col;
    if (t.faces.length) {
      ctx.lineWidth = 0.18; ctx.setLineDash([0.8, 0.6]);
      for (const [a, b] of t.faces) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (t.line) {
      const [a, b] = t.line;
      ctx.lineWidth = 0.45; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if (ov.label) {
        ctx.font = fontMm(6, { bold: true }); ctx.fillStyle = col; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
        const w = ctx.measureText(String(ov.label)).width, hh = 6 * 25.4 / 72;
        const p = a[1] < b[1] ? a : b, x = Math.min(p[0] + 0.8, frame.box[0] + frame.box[2] - w - 0.8), y = Math.max(p[1] + hh + 0.8, frame.box[1] + hh + 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 0.4, y - hh - 0.2, w + 0.8, hh + 0.4);
        ctx.fillStyle = col; ctx.fillText(String(ov.label), x, y);
      }
    }
    ctx.restore();
  }
}

// ── a VECTOR picture of a section: content.vector = { background, layers: [{ type: 'cells', axis:
// { w, u, v } (world axis indices), position (the plane, on axis w), rects: [u0, v0, u1, v1, …],
// colors: [palette index…], palette }], overlay?: an image src (the other layers, transparent) }.
// Each cell is the rectangle a block makes on the section plane; its corners go through the frame's
// projection like any world point, so ticks, overlays and labels land on it as on the raster. ──
function drawVector(ctx, frame, x, y, w, h) {
  const V = frame.content.vector;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (V.background) { ctx.fillStyle = V.background; ctx.fillRect(x, y, w, h); }
  // a layer in a PLANE's coordinates ({ origin, u, v }: a point on the plane, two unit vectors in it)
  const onPlane = (pl) => (u, v) => worldToPage(frame, [pl.origin[0] + u * pl.u[0] + v * pl.v[0], pl.origin[1] + u * pl.u[1] + v * pl.v[1], pl.origin[2] + u * pl.u[2] + v * pl.v[2]]);
  const seam = (c) => { ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 0.12; };   // a hairline of the fill closes anti-aliased seams
  const shape = (ps) => { ctx.beginPath(); ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  // BLOCK OUTLINES (Ly.outline = { mode: 'sub-blocks' | 'parents', color, width (mm), rects? |
  // pts + starts? }): ink over the fills — every cell's own edge (sub-blocks), or the listed parent
  // cells (rects / polygons in the layer's own coordinates)
  const ink = (o) => { ctx.strokeStyle = o.color || '#1a1a1a'; ctx.lineWidth = +o.width > 0 ? +o.width : 0.1; ctx.lineJoin = 'miter'; };
  const ring = (ps) => { if (ps.length < 3 || !ps.every(Boolean)) return; ctx.beginPath(); ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); };
  const outlineRects = (o, R, corners) => { ink(o); for (let i = 0; i + 3 < R.length; i += 4) ring(corners(R[i], R[i + 1], R[i + 2], R[i + 3])); };
  const outlinePolys = (o, Pt, St, page) => { ink(o); for (let i = 0; i < St.length; i++) { const end = i + 1 < St.length ? St[i + 1] : Pt.length / 2, ps = []; for (let k = St[i]; k < end; k++) ps.push(page(Pt[k * 2], Pt[k * 2 + 1])); ring(ps); } };
  const lines = [];
  for (const Ly of V.layers || []) {
    if (Ly.type === 'lines') { lines.push(Ly); continue; }
    if (Ly.type === 'polys') {
      const page = onPlane(Ly.plane), Pt = Ly.pts, St = Ly.starts, C = Ly.colors;
      for (let i = 0; i < C.length; i++) {
        const end = i + 1 < St.length ? St[i + 1] : Pt.length / 2, ps = [];
        for (let k = St[i]; k < end; k++) { const p = page(Pt[k * 2], Pt[k * 2 + 1]); if (p) ps.push(p); }
        if (ps.length >= 3) { seam(Ly.palette[C[i]]); shape(ps); }
      }
      const O = Ly.outline;
      if (O && O.mode === 'sub-blocks') outlinePolys(O, Pt, St, page);
      else if (O && O.pts && O.starts) outlinePolys(O, O.pts, O.starts, page);
      continue;
    }
    if (Ly.type !== 'cells') continue;
    if (Ly.plane) {                                        // rectangles in the plane's (u, v): four corners each
      const page = onPlane(Ly.plane), R = Ly.rects, C = Ly.colors;
      for (let i = 0; i < C.length; i++) {
        const [u0, v0, u1, v1] = [R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]];
        const ps = [page(u0, v0), page(u1, v0), page(u1, v1), page(u0, v1)];
        if (ps.every(Boolean)) { seam(Ly.palette[C[i]]); shape(ps); }
      }
      const O = Ly.outline, corners = (u0, v0, u1, v1) => [page(u0, v0), page(u1, v0), page(u1, v1), page(u0, v1)];
      if (O && O.mode === 'sub-blocks') outlineRects(O, R, corners);
      else if (O && O.rects) outlineRects(O, O.rects, corners);
      continue;
    }
    const ax = Ly.axis, R = Ly.rects, C = Ly.colors, P = Ly.palette, pt = [0, 0, 0];
    pt[ax.w] = +Ly.position;
    const page = (u, v) => { pt[ax.u] = u; pt[ax.v] = v; return worldToPage(frame, pt); };
    for (let i = 0; i < C.length; i++) {
      const a = page(R[i * 4], R[i * 4 + 1]), b = page(R[i * 4 + 2], R[i * 4 + 3]);
      if (!a || !b) continue;
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
      ctx.fillStyle = P[C[i]]; ctx.strokeStyle = P[C[i]]; ctx.lineWidth = 0.12;   // a hairline of the same colour closes the seams viewers anti-alias between cells
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill(); ctx.stroke();
    }
    const O = Ly.outline, corners = (u0, v0, u1, v1) => [page(u0, v0), page(u1, v0), page(u1, v1), page(u0, v1)].map((p) => p && { x: p.x, y: p.y });
    if (O && O.mode === 'sub-blocks') outlineRects(O, R, corners);
    else if (O && O.rects) outlineRects(O, O.rects, corners);
  }
  if (frame._vimg) ctx.drawImage(frame._vimg, x, y, w, h);
  // line work on top: drillholes (width in world units — the 3D sticks' diameter) and mesh cut
  // lines (lw, in mm)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const Ly of lines) {
    const page = onPlane(Ly.plane), Pt = Ly.pts, St = Ly.starts, C = Ly.colors;
    let lw = Ly.lw || 0.3;
    if (Ly.width > 0) { const a = page(0, 0), b = page(Ly.width, 0); if (a && b) lw = Math.max(0.15, Math.hypot(b.x - a.x, b.y - a.y)); }
    ctx.lineWidth = lw;
    for (let i = 0; i < C.length; i++) {
      const end = i + 1 < St.length ? St[i + 1] : Pt.length / 2;
      ctx.strokeStyle = Ly.palette[C[i]]; ctx.beginPath();
      let pen = false;
      for (let k = St[i]; k < end; k++) { const p = page(Pt[k * 2], Pt[k * 2 + 1]); if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; } }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── src/kinds.js ──

// Frame KINDS — each a small adapter that draws finished content into its box. The context is in
// MILLIMETRES (the page's units): a canvas scaled by px-per-mm for the screen and PNG, a @gcu/pdf
// page opened with units:'mm' for PDF — one drawing path for all three. Font sizes are given in
// points and converted. A host may register more kinds (registerKind).


const KINDS = new Map();
function registerKind(kind, impl) { KINDS.set(kind, impl); }
const kindOf = (k) => KINDS.get(k) || null;

// ── fields live in fields.js; resolveFields is re-exported from here for the kinds' sake ──

// ── PINS: what a label can point at. A picture of 3D space (content.meta.proj, the camera's matrix —
// world.js) or a frame whose KIND knows its own projection: kind.project(frame, p) → { x, y, inside } |
// null (page mm) and kind.unproject(frame, x, y) → p | null. A stereonet is the second: its points are
// DIRECTIONS on the sphere, and a label pins to one. The matrix-only things (border ticks, overlays,
// vector sections) keep asking hasProj. ──
function canPin(f) { if (hasProj(f)) return true; const k = f && kindOf(f.kind); return !!(k && typeof k.project === 'function'); }
function pinToPage(f, p) {
  if (hasProj(f)) return worldToPage(f, p);
  const k = kindOf(f.kind); try { return k && k.project ? k.project(f, p) : null; } catch { return null; }
}
function pageToPin(f, x, y) {
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
function layoutText(ctx, text, width, { size = 9, mono = false, serif = false, lineHeight = 1.25 } = {}) {
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
function drawText(ctx, text, box, { size = 9, mono = false, serif = false, pad = 1, align = 'left', color = INK, lineHeight = 1.25, valign = 'top' } = {}) {
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
    const fam = c.font || (c.mono ? 'mono' : (env.doc && env.doc.page && env.doc.page.font) || 'sans');   // the page's typeface by default
    const used = drawText(ctx, text, box, { size: +c.size || 9, mono: fam === 'mono', serif: fam === 'serif', pad: c.pad ?? 1,
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
    const fam0 = c.font || (env.doc && env.doc.page && env.doc.page.font) || 'sans';
    const font = { mono: fam0 === 'mono', serif: fam0 === 'serif' };
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
    const used = drawText(ctx, text, box, { size, pad, color: c.color || INK, mono: font.mono, serif: font.serif, align: c.align || 'left' });
    frame._overflow = used > box[3] + 0.3 ? 'the label’s text runs past its box' : undefined;
    ctx.restore();
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
// A legend's DATA (entries, the ramp) is the host's: a refresh replaces it. What you SET lives beside it and
// survives a refresh — content.edit (per entry, by its key: { label, color, hidden }), content.order (keys),
// columns, swatch ('square' | 'circle' | 'line'), size, textColor, and the title once you've typed one
// (titleUser). refreshLegend is the merge every host uses.
const LEGEND_USER_KEYS = ['edit', 'order', 'columns', 'swatch', 'size', 'textColor', 'titleUser'];
function refreshLegend(old = {}, fresh = {}) {
  const out = { ...fresh };
  for (const k of LEGEND_USER_KEYS) if (old[k] !== undefined) out[k] = old[k];
  if (old.titleUser) out.title = old.title;
  return out;
}
const legendKey = (e) => String(e.key != null ? e.key : e.label);
// the entries as drawn: the host's, with your edits, in your order (hidden ones included, flagged)
function legendEntries(c) {
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
  // content: { length (world units; else the nicest that fits 80 % of the frame), segments (4), style:
  //   'alternating' (the default) | 'line' | 'ticks', ratio (true: "1 : 2 500" under it, for a view in metres) }
  draw(ctx, box, frame, env) {
    const c = frame.content || {}, meta = metaOf(frame, env.doc), wpm = +meta.worldPerMm;
    const units = meta.units || 'm';
    ctx.fillStyle = INK; ctx.font = fontMm(8); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    frame._overflow = undefined;
    if (!(wpm > 0)) { ctx.fillText('no scale (a perspective view)', box[0], box[1]); return; }
    const len = +c.length > 0 ? +c.length : niceBelow(box[2] * 0.8 * wpm), barMm = len / wpm;
    const n = Math.max(1, Math.min(10, Math.round(+c.segments || 4))), style = c.style || 'alternating';
    if (barMm > box[2] + 0.01) frame._overflow = `${len} ${units} is ${barMm.toFixed(1)} mm at this scale — wider than the frame`;
    const h = Math.min(2, box[3] * 0.25), x0 = box[0] + Math.max(0, (box[2] - barMm) / 2), y0 = box[1] + 0.5;
    const fmt = (v) => (v >= 1000 && units === 'm' ? `${+(v / 1000).toPrecision(3)} km` : `${+v.toPrecision(4)} ${units}`);
    const fmtBare = (v) => (len >= 1000 && units === 'm' ? `${+(v / 1000).toPrecision(3)}` : `${+v.toPrecision(4)}`);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.2;
    let labelY = y0 + h + 0.8;
    if (style === 'alternating') {
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : INK; ctx.fillRect(x0 + (i * barMm) / n, y0, barMm / n, h); }
      ctx.strokeRect(x0, y0, barMm, h);
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText('0', x0, labelY); ctx.fillText(fmt(len), x0 + barMm, labelY);
    } else {
      // a line with a tick at each segment: 'line' labels its ends, 'ticks' every tick
      const yl = y0 + h;
      ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(x0, yl); ctx.lineTo(x0 + barMm, yl); ctx.stroke();
      ctx.lineWidth = 0.2;
      for (let i = 0; i <= n; i++) { const x = x0 + (i * barMm) / n, t = i === 0 || i === n ? h : h * 0.55; ctx.beginPath(); ctx.moveTo(x, yl); ctx.lineTo(x, yl - t); ctx.stroke(); }
      ctx.fillStyle = INK; ctx.textAlign = 'center'; labelY = yl + 0.8;
      if (style === 'ticks') {
        for (let i = 0; i <= n; i++) ctx.fillText(i === n ? fmt(len) : fmtBare((len * i) / n), x0 + (i * barMm) / n, labelY);
      } else { ctx.fillText('0', x0, labelY); ctx.fillText(fmt(len), x0 + barMm, labelY); }
    }
    if (c.ratio && (units === 'm' || units === 'metres' || units === 'meters')) {
      const den = Math.round(wpm * 1000);                // 1 mm of paper = wpm metres = wpm·1000 mm of ground
      const nice = den >= 100 ? +den.toPrecision(3) : den;
      ctx.textAlign = 'center'; ctx.fillText(`1 : ${String(nice).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`   /* a thin space groups the digits */, x0 + barMm / 2, labelY + 8 * PT * 1.2);
    }
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
    const look = (frame.content && frame.content.style) || 'arrow';      // 'arrow' | 'needle' | 'star' | 'line'
    const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2 + 1.5, r = Math.min(box[2], box[3] - 4) / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((bearing * Math.PI) / 180);
    const half = (w, tip, tail, dark) => {               // one half of a blade, from the tip to the tail
      ctx.beginPath(); ctx.moveTo(0, tip); ctx.lineTo(w, 0); ctx.lineTo(0, tail); ctx.closePath();
      if (dark) { ctx.fillStyle = INK; ctx.fill(); } else { ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.15; ctx.stroke(); }
    };
    if (look === 'needle') {                             // a slim needle: north dark, south light
      half(r * 0.16, -r, 0, true); half(-r * 0.16, -r, 0, false); half(r * 0.16, r, 0, false); half(-r * 0.16, r, 0, true);
    } else if (look === 'star') {                        // a compass star: four points, north the longest
      for (const [ang, len] of [[0, r], [90, r * 0.62], [180, r * 0.62], [270, r * 0.62]]) {
        ctx.save(); ctx.rotate((ang * Math.PI) / 180); half(len * 0.2, -len, 0, true); half(-len * 0.2, -len, 0, false); ctx.restore();
      }
    } else if (look === 'line') {                        // a plain line with a head
      ctx.strokeStyle = INK; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(0, -r); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.22, -r * 0.55); ctx.lineTo(-r * 0.22, -r * 0.55); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.45, r * 0.7); ctx.lineTo(0, r * 0.35); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = INK; ctx.lineWidth = 0.15;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * 0.45, r * 0.7); ctx.lineTo(0, r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
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
    const c = frame.content || {}, cols = (c.columns || []).map(String);
    // decimals: every number shown to that many places (null: as it came — float noise trimmed)
    const dec = c.decimals != null && c.decimals !== '' && Number.isFinite(+c.decimals) ? Math.max(0, Math.min(8, +c.decimals)) : null;
    const asCell = (v) => { if (dec == null) return cellText(v); const t = v == null ? '' : String(v).trim(); return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? (+t).toFixed(dec) : cellText(v); };
    const rows = (c.rows || []).map((r) => (r || []).map(asCell));
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
// ── shape: a rectangle (rounded or not), an ellipse, a line or an arrow across the frame ──
// content: { shape: 'rect' | 'ellipse' | 'line' | 'arrow', stroke (colour, '' none), width (mm), fill (colour, '' none),
//   dash (bool), radius (mm, a rect's corners), dir: a line's way across the box — 'h' | 'v' | 'down' (↘) | 'up' (↗),
//   arrow head at the end (and at the start too with heads: 'both') }
registerKind('shape', {
  label: 'shape',
  draw(ctx, box, frame) {
    const c = frame.content || {}, kind = c.shape || 'rect', lw = +c.width > 0 ? +c.width : 0.35;
    const stroke = c.stroke === '' ? null : c.stroke || INK, fill = c.fill || null;
    ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (stroke) ctx.strokeStyle = stroke;
    if (ctx.setLineDash) ctx.setLineDash(c.dash ? [lw * 4, lw * 3] : []);
    const i = lw / 2, x = box[0] + i, y = box[1] + i, w = Math.max(0, box[2] - lw), hh = Math.max(0, box[3] - lw);
    if (kind === 'rect' || kind === 'ellipse') {
      ctx.beginPath();
      if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, 2 * Math.PI);
      else if (+c.radius > 0 && ctx.roundRect) ctx.roundRect(x, y, w, hh, Math.min(+c.radius, w / 2, hh / 2));
      else ctx.rect(x, y, w, hh);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) ctx.stroke();
    } else {
      const d = c.dir || 'h';
      const [ax, ay, bx, by] = d === 'v' ? [x + w / 2, y, x + w / 2, y + hh] : d === 'down' ? [x, y, x + w, y + hh] : d === 'up' ? [x, y + hh, x + w, y] : [x, y + hh / 2, x + w, y + hh / 2];
      const head = (tx, ty, fx, fy) => {                 // a filled head at (tx, ty), pointing away from (fx, fy)
        const L = Math.hypot(tx - fx, ty - fy) || 1, ux = (tx - fx) / L, uy = (ty - fy) / L, s = Math.max(1.6, lw * 5);
        ctx.setLineDash && ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * s - uy * s * 0.45, ty - uy * s + ux * s * 0.45); ctx.lineTo(tx - ux * s + uy * s * 0.45, ty - uy * s - ux * s * 0.45); ctx.closePath();
        ctx.fillStyle = stroke || INK; ctx.fill();
        return s;
      };
      let sx = ax, sy = ay, ex = bx, ey = by;
      if (kind === 'arrow') {                            // the line stops short of the heads, so they stay sharp
        const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, s = Math.max(1.6, lw * 5) * 0.8;
        ex = bx - ux * s; ey = by - uy * s; if (c.heads === 'both') { sx = ax + ux * s; sy = ay + uy * s; }
      }
      if (stroke) { if (ctx.setLineDash) ctx.setLineDash(c.dash ? [lw * 4, lw * 3] : []); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); }
      if (kind === 'arrow') { head(bx, by, ax, ay); if (c.heads === 'both') head(ax, ay, bx, by); }
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
  },
});

// ── QR code: a link or a text, scannable from the printed page (vector squares; the quiet zone inside the frame) ──
// content: { text, ecc: 'L' | 'M' | 'Q' | 'H', caption (bool: the text under it), matrix: ['0101…', …] }
// The MATRIX is stored with the frame — computed when the text is set (qrContent), by the encoder the host
// registers (setQrEncoder: @gcu/qr's toMatrix). So a saved figure prints its code in any host, encoder or not.
let _qrEncoder = null;
function setQrEncoder(fn) { _qrEncoder = typeof fn === 'function' ? fn : null; }
const hasQrEncoder = () => !!_qrEncoder;
/** a QR frame's content with its matrix made for this text (throws when the host has no encoder, or it's too long) */
function qrContent(content) {
  const c = { ...(content || {}) }, text = String(c.text || '');
  if (!text) { delete c.matrix; return c; }
  if (!_qrEncoder) throw new Error('this host has no QR encoder (setQrEncoder)');
  c.matrix = _qrEncoder(text, { ecc: c.ecc || 'M' }).map((row) => row.map((d) => (d ? '1' : '0')).join(''));
  return c;
}
registerKind('qr', {
  label: 'QR code',
  draw(ctx, box, frame) {
    const c = frame.content || {}, text = String(c.text || '');
    frame._overflow = undefined;
    const note = (t, col = '#888') => { ctx.fillStyle = col; ctx.font = fontMm(7); ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText(t, box[0], box[1]); };
    if (!text) { note('QR: no text yet'); return; }
    let m = Array.isArray(c.matrix) && c.matrix.length ? c.matrix.map((r) => [...String(r)].map((d) => d === '1')) : null;
    if (!m) {                                            // made elsewhere without its matrix: make it now, if this host can
      try { m = _qrEncoder ? _qrEncoder(text, { ecc: c.ecc || 'M' }) : null; } catch (e) { frame._overflow = e.message; note('too long for a QR code', '#b33'); return; }
      if (!m) { frame._overflow = 'this host can’t encode QR codes'; note('QR: no encoder here'); return; }
    }
    const capH = c.caption ? 7 * PT * 1.3 : 0, n = m.length, q = 2;          // a 2-module quiet zone (the frame's margin adds to it)
    const side = Math.min(box[2], box[3] - capH), u = side / (n + 2 * q);
    if (u < 0.25) frame._overflow = 'the modules are under 0.25 mm — a phone may not read it; make the frame bigger';
    const x0 = box[0] + (box[2] - side) / 2 + q * u, y0 = box[1] + q * u;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 - q * u, y0 - q * u, side, side);
    ctx.fillStyle = INK;
    for (let r = 0; r < n; r++) {                        // runs of dark modules per row: fewer, longer rectangles
      let c0 = -1;
      for (let k = 0; k <= n; k++) {
        const dark = k < n && m[r][k];
        if (dark && c0 < 0) c0 = k;
        else if (!dark && c0 >= 0) { ctx.fillRect(x0 + c0 * u, y0 + r * u, (k - c0) * u + 0.005, u + 0.005); c0 = -1; }
      }
    }
    if (c.caption) {
      ctx.font = fontMm(7); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let t = text; while (t.length > 4 && ctx.measureText(t).width > box[2]) t = t.slice(0, -2);
      ctx.fillText(t === text ? t : t + '…', box[0] + box[2] / 2, box[1] + side + 0.5);
    }
  },
});

// a TSV (an analysis window's ⧉ table) → table content
function tableFromTsv(tsv, title = '') {
  const lines = String(tsv || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return null;
  const [head, ...body] = lines.map((l) => l.split('\t'));
  return { title, columns: head, rows: body };
}

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
// characters neither WinAnsi nor Symbol has, written as their plain forms
const SUBST = { 'μ': 'µ', '∙': '·', '⋅': '·', ' ': ' ', ' ': ' ', ' ': ' ' };

// The standard SYMBOL font — every PDF reader carries it, like the others — has the Greek alphabet and the
// mathematical signs WinAnsi lacks: κ α σ for the statistics, ≥ ≤ → for the notation. Text is written in runs:
// what WinAnsi encodes in the page's font, these in Symbol (its own built-in encoding). [code, width /1000 em]
// from the Symbol AFM. (SUBST above now holds only what neither font has.)
const SYMBOL = {
  'α': [0x61, 631], 'β': [0x62, 549], 'γ': [0x67, 411], 'δ': [0x64, 494], 'ε': [0x65, 439], 'ζ': [0x7a, 494], 'η': [0x68, 603], 'θ': [0x71, 521],
  'ι': [0x69, 329], 'κ': [0x6b, 549], 'λ': [0x6c, 549], 'ν': [0x6e, 521], 'ξ': [0x78, 493], 'ο': [0x6f, 549], 'π': [0x70, 549], 'ρ': [0x72, 549],
  'σ': [0x73, 603], 'ς': [0x56, 439], 'τ': [0x74, 439], 'υ': [0x75, 576], 'φ': [0x66, 521], 'χ': [0x63, 549], 'ψ': [0x79, 686], 'ω': [0x77, 686],
  'Γ': [0x47, 603], 'Δ': [0x44, 612], 'Θ': [0x51, 741], 'Λ': [0x4c, 686], 'Ξ': [0x58, 645], 'Π': [0x50, 768], 'Σ': [0x53, 592], 'Υ': [0xa1, 620],
  'Φ': [0x46, 763], 'Ψ': [0x59, 795], 'Ω': [0x57, 768], 'ϕ': [0x6a, 603], 'ϑ': [0x4a, 631],
  '≥': [0xb3, 549], '≤': [0xa3, 549], '≠': [0xb9, 549], '≈': [0xbb, 549], '≡': [0xba, 549], '∞': [0xa5, 713], '∝': [0xb5, 713],
  '→': [0xae, 987], '←': [0xac, 987], '↑': [0xad, 603], '↓': [0xaf, 603], '↔': [0xab, 1042], '⇒': [0xde, 987], '⇐': [0xdc, 987],
  '−': [0x2d, 549], '′': [0xa2, 247], '″': [0xb2, 411], '√': [0xd6, 549], '∑': [0xe5, 713], '∏': [0xd5, 823], '∂': [0xb6, 494],
  '∫': [0xf2, 274], '∇': [0xd1, 713], '∈': [0xce, 713], '∉': [0xcf, 713], '∩': [0xc7, 768], '∪': [0xc8, 768], '⊂': [0xcc, 713],
  '∧': [0xd9, 603], '∨': [0xda, 603], '∀': [0x22, 713], '∃': [0x24, 549], '∅': [0xc6, 823], '∠': [0xd0, 768],
  '⊥': [0x5e, 658], '∴': [0x5c, 863], '∼': [0x7e, 549],
};
const isSymbolChar = (ch) => Object.prototype.hasOwnProperty.call(SYMBOL, ch);
/** text → runs: { symbol: bool, codes, text, missing } — WinAnsi runs for the page's font, Symbol runs for SYMBOL's */
function encodeRuns(text) {
  const runs = [], missing = new Set();
  let cur = null;
  for (const ch of String(text)) {
    const sym = isSymbolChar(ch);
    if (!cur || cur.symbol !== sym) { cur = { symbol: sym, codes: [], text: '' }; runs.push(cur); }
    if (sym) { cur.codes.push(SYMBOL[ch][0]); cur.text += ch; }
    else { const e = encodeWinAnsi(ch); cur.codes.push(...e.codes); cur.text += e.text; for (const m of e.missing) missing.add(m); }
  }
  return { runs, missing };
}

// (the italics come after the uprights, so a page's F1…F6 tags stay what they were; Symbol after them)
const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold', 'Times-Roman', 'Times-Bold',
  'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier-Oblique', 'Courier-BoldOblique', 'Times-Italic', 'Times-BoldItalic', 'Symbol'];

// a CSS font string → { name (a standard font), size (px of the user space), mono, serif, bold, italic }
function parseFont(css) {
  const s = String(css || '10px sans-serif');
  const m = /(\d+(?:\.\d+)?)px/.exec(s);
  const size = m ? +m[1] : 10;
  const pre = s.slice(0, m ? m.index : s.length);
  const bold = /\b(bold|bolder|[6-9]00)\b/.test(pre), italic = /\b(italic|oblique)\b/.test(pre);
  const fam = (m ? s.slice(m.index + m[0].length) : s).replace(/^\s*\/\s*[\d.]+\w*/, '').toLowerCase();
  // the FIRST family decides (a stack's fallbacks don't): 'Space Mono', … monospace → mono
  const first = (fam.split(',')[0] || '').trim();
  const mono = /mono|courier|consol|menlo|code|fixed|typewriter/.test(first) || (/\bmonospace\b/.test(fam) && !/sans|serif|helvetica|arial|barlow|system-ui/.test(first));
  const serif = !mono && (/(^|[^-])\bserif\b|times|georgia|garamond|cambria|book/.test(first) && !/sans/.test(first));
  const name = mono ? (bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : (italic ? 'Courier-Oblique' : 'Courier'))
    : serif ? (bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : (italic ? 'Times-Italic' : 'Times-Roman'))
      : (bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (italic ? 'Helvetica-Oblique' : 'Helvetica'));
  return { name, size, mono, serif, bold, italic };
}

const baseLetter = (ch) => { const d = ch.normalize('NFD'); return d.length > 1 && d.charCodeAt(0) < 128 ? d[0] : null; };

// the width of ONE (already encodable) character in 1/1000 em. The obliques share their upright's metrics
// exactly (Helvetica, Courier); Times-Italic's are close to Times-Roman's, which stand in for them
function charWidth(name, ch) {
  if (name.startsWith('Courier')) return 600;
  const tbl = name.startsWith('Helvetica-Bold') ? HELVB : name.startsWith('Times') ? TIMES : HELV;
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
  let w = 0;
  for (const r of encodeRuns(text).runs) {
    if (r.symbol) for (const ch of r.text) w += SYMBOL[ch][1];
    else for (const ch of r.text) w += charWidth(name, ch);
  }
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
    const enc = encodeRuns(text);                        // the page's font, with Greek and maths in Symbol runs
    if (enc.missing.size) this._warn('glyph:' + [...enc.missing].join(''), `characters ${[...enc.missing].map((c) => `“${c}”`).join(' ')} aren't in the standard PDF fonts — written as '?' (an embedded font would carry them)`);
    if (!enc.runs.some((r) => r.codes.length)) return;
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
    const sw = mode === 1 ? ` ${num(this._st.lineWidth * scaleOf(this._m))} w` : '';
    // one text object; a run switches font (Tj advances by each glyph's width, so the runs follow on). The first
    // run's font is set BEFORE the text matrix, as it always was — `… Tf <m> Tm (text) Tj` — so a string with no
    // Greek in it reads exactly as before; only a switch mid-string adds a Tf between the Tjs
    const runs = enc.runs.filter((r) => r.codes.length); if (!runs.length) return;
    const tf = (r) => `/${this._page._font(r.symbol ? 'Symbol' : f.name)} ${num(f.size)} Tf`;
    const shows = runs.map((r, i) => `${i ? tf(r) + ' ' : ''}${pdfString(r.codes)} Tj`);
    this._out(`${col.ops}${sw}\nBT ${tf(runs[0])} ${mode} Tr ${tm.map(num).join(' ')} Tm ${shows.join(' ')} ET`);
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
    this._files = [];                                      // attachments: { name, bytes, mime, description, relationship }
  }
  // attach a file to the document (PDF 2.0 / PDF/A-3 style: an embedded file, listed in the
  // catalog's EmbeddedFiles and /AF). data: a string (UTF-8) or bytes. relationship: Source,
  // Data, Alternative, Supplement or Unspecified (default Source — what the page was made from).
  attach(name, data, { mime = 'application/octet-stream', description = '', relationship = 'Source' } = {}) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    this._files.push({ name: String(name), bytes, mime, description, relationship });
    return this;
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
    for (const n of fontsUsed) fontIds[n] = add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${n}${n === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding'} >>` });   // Symbol keeps its own built-in encoding
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
    // attachments: an EmbeddedFile stream + a file spec each; the catalog lists them (sorted by name)
    const fileSpecs = [];
    for (const f of this._files) {
      const mimeName = f.mime.replace(/[^\w.+-]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
      const st = await stream(`<< /Type /EmbeddedFile /Subtype /${mimeName} /Params << /Size ${f.bytes.length} >>`, f.bytes);
      const eid = add({ dict: st.dict + ' >>', bytes: st.bytes });
      const sid = add({ dict: `<< /Type /Filespec /F ${textString(f.name)} /UF ${textString(f.name)}${f.description ? ` /Desc ${textString(f.description)}` : ''} /EF << /F ${eid} 0 R /UF ${eid} 0 R >> /AFRelationship /${f.relationship} >>` });
      fileSpecs.push({ name: f.name, id: sid });
    }
    fileSpecs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const names = fileSpecs.length ? ` /Names << /EmbeddedFiles << /Names [${fileSpecs.map((f) => `${textString(f.name)} ${f.id} 0 R`).join(' ')}] >> >> /AF [${fileSpecs.map((f) => `${f.id} 0 R`).join(' ')}]` : '';
    objs[catalogId - 1] = { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R${names} >>` };
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

// ── reading attachments back: enough of a PDF reader for files that keep their objects in the
// open (this writer's, and most simple PDFs; not object streams or encrypted files). Returns
// [{ name, bytes, mime, description }]. ──
async function readAttachments(pdfBytes) {
  const u8 = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  let text = ''; for (let i = 0; i < u8.length; i += 65536) text += String.fromCharCode.apply(null, u8.subarray(i, i + 65536));
  const objAt = new Map();                                 // object number → offset of "n 0 obj" (the last one wins: incremental updates)
  for (const m of text.matchAll(/(?:^|[\r\n\s])(\d+)\s+0\s+obj\b/g)) objAt.set(+m[1], m.index + m[0].length);
  const dictOf = (n) => { const at = objAt.get(n); if (at == null) return null; const end = text.indexOf('endobj', at); return text.slice(at, end < 0 ? undefined : end); };
  const strOf = (src) => {                                  // a literal (…) or hex <…> string → JS string
    if (!src) return '';
    if (src[0] === '<') { const hex = src.slice(1, -1).replace(/\s/g, ''); const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16)); if (b[0] === 0xfe && b[1] === 0xff) { let s2 = ''; for (let i = 2; i + 1 < b.length; i += 2) s2 += String.fromCharCode((b[i] << 8) | b[i + 1]); return s2; } return String.fromCharCode(...b); }
    return src.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[c] || (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c));
  };
  const STR = '(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)';
  const out = [];
  for (const [n] of objAt) {
    const d = dictOf(n); if (!d || !/\/Type\s*\/Filespec/.test(d)) continue;
    const name = strOf((new RegExp('/UF\\s*' + STR).exec(d) || new RegExp('/F\\s*' + STR).exec(d) || [])[1]);
    const desc = strOf((new RegExp('/Desc\\s*' + STR).exec(d) || [])[1]);
    const ef = /\/EF\s*<<[^>]*?\/F\s+(\d+)\s+0\s+R/.exec(d); if (!ef) continue;
    const sd = dictOf(+ef[1]); if (!sd) continue;
    const at = objAt.get(+ef[1]), sIdx = text.indexOf('stream', at);
    const len = +(/\/Length\s+(\d+)/.exec(sd) || [])[1];
    let start = sIdx + 6; if (text[start] === '\r') start++; if (text[start] === '\n') start++;
    let bytes = u8.slice(start, start + len);
    if (/\/Filter\s*\/FlateDecode/.test(sd)) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    const mime = ((/\/Subtype\s*\/([^\s/>]+)/.exec(sd) || [])[1] || '').replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out.push({ name, bytes, mime, description: desc });
  }
  return out;
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
    if (!(kind && kind.overflow)) { ctx.beginPath(); ctx.rect(b[0], b[1], b[2], b[3]); ctx.clip(); }
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
  // a vector section's overlay (the other layers, a transparent render)
  await Promise.all(doc.frames.filter((f) => f.kind === 'image' && !f._vimg && f.content && f.content.vector && f.content.vector.overlay).map(async (f) => {
    try { const im = new Image(); im.src = f.content.vector.overlay; await im.decode(); f._vimg = typeof createImageBitmap !== 'undefined' ? await createImageBitmap(im) : im; } catch { /* drawn without it */ }
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
  let figAt = env.figStart || 1;
  for (let i = 0; i < list.length; i++) {
    const doc = list[i];
    if (env.prepare) await env.prepare(doc, { dpi: opts.dpi || 300, page: i + 1 });
    await ensureImages(doc);
    const q = opts.jpegQuality ?? 0.92;
    for (const f of doc.frames) { f._jpeg = null; if (q > 0 && f.kind === 'image' && f.content && f.content.photo) await jpegFor(f, q); }
    const [W, H] = pageDims(doc.page);
    const ctx = pdf.addPage({ width: (W * 72) / 25.4, height: (H * 72) / 25.4 }).getContext('2d', { units: 'mm' });
    renderPage(doc, ctx, { ...env, page: i + 1, pages: list.length, figStart: figAt });
    figAt += doc.frames.filter((f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || '')).length;   // an atlas numbers on across pages
  }
  // the PDF carries its SOURCE: the compo document (a single page's own, or opts.source), so the
  // file can be opened again as an editable figure (figureFromPdf). opts.source = false: none.
  const src = opts.source === false ? null : (opts.source && opts.source !== true) ? opts.source : list.length === 1 ? list[0] : null;
  if (src) pdf.attach(sourceName(src), serializeDocument(src), { mime: 'application/json', description: 'the compo figure this PDF was made from: open it in compo (or micro) to edit and re-render' });
  for (const a of opts.attach || []) pdf.attach(a.name, a.data, a);
  return pdf.save();
}
const sourceName = (doc) => (String(doc.title || 'figure').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure') + '.compo.json';
// a PDF compo wrote → { doc, name, attachments } (doc null when it carries no figure)
async function figureFromPdf(bytes) {
  const attachments = await readAttachments(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const a = attachments.find((x) => /\.compo\.json$/i.test(x.name));
  return { doc: a ? parseDocument(new TextDecoder().decode(a.bytes)) : null, name: a ? a.name : null, attachments };
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

// ── src/house.js ──

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

// [key, label] — the shared ones (every figure of a project) and a figure's own
const HOUSE_KEYS = [['company', 'company'], ['client', 'client'], ['project', 'project'], ['prepared', 'prepared by'], ['checked', 'checked by'], ['disclaimer', 'disclaimer']];
const FIGURE_KEYS = [['drawing', 'drawing no.'], ['revision', 'revision']];

// ── templates ──
function setTemplate(doc, on = true) {
  if (on) doc.template = true; else delete doc.template;
  return doc;
}
// a new document from a template: its frames, page and properties; a title of its own, not a template
// itself, and the per-drawing properties (FIGURE_KEYS unless told otherwise) cleared
function docFromTemplate(tpl, title = '', { clear = FIGURE_KEYS.map(([k]) => k) } = {}) {
  const doc = parseDocument(serializeDocument(tpl));
  doc.title = title; delete doc.template;
  doc.props = { ...(tpl.props || {}) };
  for (const k of clear) delete doc.props[k];
  return doc;
}

// ── the title block: a stack of bordered rows, bottom-right inside the margins, every row made of
// fields — [md, type size pt, row height mm] ──
const TITLE_BLOCK_ROWS = [
  ['**{prop:company}**', 9, 7], ['{prop:project} · {prop:client}', 7, 5.5], ['**{title}**', 8, 6.5],
  ['drawing {prop:drawing} · rev {prop:revision} · {date}', 6.5, 5], ['prepared {prop:prepared} · checked {prop:checked}', 6.5, 5], ['scale {scale} · page {page} of {pages}', 6.5, 5],
];
const RULE = 0.2;                                          // the block's ruling, mm
// the title block on this page as ONE frame (not yet added): kind 'titleblock', content.rows
function titleBlockFrame(doc, { rows = TITLE_BLOCK_ROWS, width = 95 } = {}) {
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const hTot = rows.reduce((s, r) => s + r[2], 0);
  return { kind: 'titleblock', box: [W - m[1] - width, +(H - m[2] - hTot).toFixed(2), width, +hTot.toFixed(2)], content: { rows: rows.map((r) => r.slice()) } };
}
// the OLD form, a group of bordered text frames — kept for a host that wants loose rows
function titleBlockFrames(doc, { rows = TITLE_BLOCK_ROWS, width = 95 } = {}) {
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
function migrateTitleBlocks(doc) {
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

// ── src/insert.js ──

// INSERT — what an editor adds in more than one frame or from outside the page: the title block,
// an image from a file, small multiples. Each takes the editor (mountEditor's handle), adds its
// frames, selects them and returns their ids. The host keeps what is its own: what goes IN a
// frame (a render, a scene), and where things are kept.

// the title block (house.js): one titleblock frame, bottom-right → [its id]
function addTitleBlock(ed, opts = {}) {
  const ids = [ed.addFrame(titleBlockFrame(ed.getDoc(), opts)).id];
  ed.select(ids); ed.render();
  return ids;
}

// ── an image: a logo, a photo, a sketch ──
// addImageSrc(ed, src) — src a URL the page can load (a data: URL from a file, a blob: URL); the
// frame lands top-left inside the margins, `width` mm wide at the image's own aspect. `source` is the
// host's record of it (compo keeps it, never reads it).
async function addImageSrc(ed, src, { name = 'image', width = 35, source = null } = {}) {
  const im = new Image(); im.src = src; await im.decode();
  const doc = ed.getDoc(), m = doc.page.margins || [10, 10, 10, 10], h = +(width * im.height / Math.max(1, im.width)).toFixed(1);
  const f = ed.addFrame({ kind: 'image', box: [m[3] + 4, m[0] + 4, width, h], content: { src, width: im.width, height: im.height, fit: 'contain' }, ...(source ? { source } : {}) });
  f._img = typeof createImageBitmap !== 'undefined' ? await createImageBitmap(im) : im; ed.render();
  return f;
}
// a File / Blob → a data: URL (what a saved document can carry)
const readImageFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
// the browser's file picker → addImageSrc. opts.source(name) → the frame's source record
function addImageFromFile(ed, opts = {}) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    await addImageSrc(ed, await readImageFile(file), { ...opts, name: file.name, source: opts.source ? opts.source(file.name) : null });
  };
  inp.click();
}

// ── SMALL MULTIPLES: one frame repeated n times in a grid over its own box, each copy captioned ──
// multiplesGrid(box, n, { cols }) — the cells: [{ box, caption }] in reading order, `cols` per row
// (else about square), a caption strip under each. Throws when the cells would be too small.
function multiplesGrid(box, n, { cols = 0, gap = 3, capH = 5 } = {}) {
  const C = Math.max(1, Math.min(n, +cols || Math.ceil(Math.sqrt(n)))), R = Math.ceil(n / C);
  const cw = (box[2] - gap * (C - 1)) / C, ch = (box[3] - R * capH - gap * (R - 1)) / R;
  if (!(cw > 8 && ch > 8)) throw new Error('the view frame is too small for that many — make it bigger first');
  const cells = [];
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / C), c = k % C, x = box[0] + c * (cw + gap), y = box[1] + r * (ch + capH + gap);
    cells.push({ box: [+x.toFixed(2), +y.toFixed(2), +cw.toFixed(2), +ch.toFixed(2)], caption: [+x.toFixed(2), +(y + ch + 0.5).toFixed(2), +cw.toFixed(2), capH - 0.5] });
  }
  return { cols: C, rows: R, cells };
}
// smallMultiples(ed, f, { n, variant, caption }) — the host makes copy k: `await variant(k, box)` adds
// a frame in that box and returns it; `caption(k)` is its caption's text (a field such as {section}
// works: the caption refers to its copy). Then f goes, and the copies + captions become one group.
// → the new ids. A variant that throws stops it there, f still in place.
async function smallMultiples(ed, f, { n, variant, caption = (k) => String(k + 1), cols = 0, gap = 3, capH = 5, size = 7 }) {
  const { cells } = multiplesGrid(f.box, n, { cols, gap, capH });
  const made = [];
  for (let k = 0; k < n; k++) {
    const vf = await variant(k, cells[k].box);
    const cap = ed.addFrame({ kind: 'text', box: cells[k].caption, content: { md: caption(k), size, align: 'center', of: vf.id } });
    made.push(vf.id, cap.id);
  }
  const d = ed.getDoc();
  removeFrames(d, [f.id]); groupFrames(d, made);
  ed.select(made); ed.render();
  return made;
}

// ── src/icons.js ──

// The editor's icons: line drawings on a 24 × 24 grid, stroked in currentColor (2 px, round caps
// and joins), so a light or a dark theme colours them with the text. Built with createElementNS —
// no markup strings, nothing fetched, nothing that a strict CSP or Trusted Types would refuse.
// A host can use them (and iconButton) for its own buttons, so one toolbar speaks one language.
//
// ICONS[name] = [[tag, attrs], …]. iconSvg(name | spec) → <svg>. iconButton({ icon, label, keys,
// title, run, cls }) → a <button> holding the icon, with label as its aria-label and
// "label · keys — title" as its tooltip.

const P = (d) => ['path', { d }];
const R = (x, y, width, height, rx = 1) => ['rect', { x, y, width, height, rx }];
const FILL = { fill: 'currentColor', stroke: 'none' };
const PAGE = P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z');
const FOLD = P('M14 2v6h6');

const ICONS = {
  undo: [P('M9 14 4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [P('m15 14 5-5-5-5'), P('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
  // the page's rulers: one along the top, one down the left, with ticks
  rulers: [P('M3 3h18v5H8v13H3Z'), P('M12 3v2.5M16 3v2.5M20 3v2.5M3 12h2.5M3 16h2.5M3 20h2.5')],
  // frames
  view: [P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'), P('M3.3 7 12 12l8.7-5'), P('M12 22V12')],
  // a legend: three swatches and their words
  legend: [['rect', { x: 2.5, y: 4, width: 5, height: 4, rx: 0.5, ...FILL }], ['rect', { x: 2.5, y: 10, width: 5, height: 4, rx: 0.5, ...FILL }], ['rect', { x: 2.5, y: 16, width: 5, height: 4, rx: 0.5, ...FILL }], P('M11 6h10M11 12h10M11 18h7')],
  // a scale bar: a line with end ticks and divisions
  scalebar: [P('M3 15h18'), P('M3 9v6M21 9v6M12 11v4M7.5 13v2M16.5 13v2')],
  north: [['path', { d: 'M12 2.5 6.5 20.5 12 16.5Z', ...FILL }], P('M12 2.5l5.5 18-5.5-4-5.5 4Z')],
  text: [P('M4 7V4h16v3'), P('M12 4v16'), P('M9 20h6')],
  shape: [R(3, 3, 11, 11, 1), ['circle', { cx: 15.5, cy: 15.5, r: 5.5 }]],
  qr: [R(3, 3, 7, 7, 1), R(14, 3, 7, 7, 1), R(3, 14, 7, 7, 1), ['rect', { x: 5.5, y: 5.5, width: 2, height: 2, ...FILL }], ['rect', { x: 16.5, y: 5.5, width: 2, height: 2, ...FILL }], ['rect', { x: 5.5, y: 16.5, width: 2, height: 2, ...FILL }], P('M14 14h3v3M21 14v7h-4M14 18v3')],
  label: [R(11, 3, 10, 7), P('M14 6.5h4'), P('M11 10l-5 7'), ['circle', { cx: 5, cy: 18.5, r: 1.6, ...FILL }]],
  image: [R(3, 3, 18, 18, 2), ['circle', { cx: 9, cy: 9, r: 2 }], P('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21')],
  titleblock: [R(3, 3, 18, 18), P('M10 21v-8h11'), P('M10 17h11'), P('M15.5 13v4')],
  table: [R(3, 4, 18, 16), P('M3 9.5h18M3 15h18M9 9.5V20')],
  // align: the line the frames line up on, and two frames
  'align-left': [P('M3.5 3v18'), R(7, 5.5, 13, 5), R(7, 13.5, 8, 5)],
  'align-hcenter': [P('M12 2.5v3M12 10.5v3M12 18.5v3'), R(4.5, 5.5, 15, 5), R(8, 13.5, 8, 5)],
  'align-right': [P('M20.5 3v18'), R(4, 5.5, 13, 5), R(9, 13.5, 8, 5)],
  'align-top': [P('M3 3.5h18'), R(5.5, 7, 5, 13), R(13.5, 7, 5, 8)],
  'align-vcenter': [P('M2.5 12h3M10.5 12h3M18.5 12h3'), R(5.5, 4.5, 5, 15), R(13.5, 8, 5, 8)],
  'align-bottom': [P('M3 20.5h18'), R(5.5, 4, 5, 13), R(13.5, 9, 5, 8)],
  // distribute: equal gaps between the outer two
  'dist-h': [P('M3.5 3v18M20.5 3v18'), R(9, 6, 6, 12), P('M5.5 12h1.5M17 12h1.5')],
  'dist-v': [P('M3 3.5h18M3 20.5h18'), R(6, 9, 12, 6), P('M12 5.5V7M12 17v1.5')],
  // match size: as wide / as tall / as big as the first
  'same-w': [P('M3 5v14M21 5v14'), P('M6.5 12h11'), P('m9.5 9-3 3 3 3M14.5 9l3 3-3 3')],
  'same-h': [P('M5 3h14M5 21h14'), P('M12 6.5v11'), P('m9 9.5 3-3 3 3M9 14.5l3 3 3-3')],
  'same-wh': [R(3, 3, 18, 18), P('M8 16 16 8'), P('M11 8h5v5'), P('M13 16H8v-5')],
  // groups: a dashed-cornered box round two frames / two frames apart
  group: [P('M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2'), R(7, 7, 7, 5), R(10, 12, 7, 5)],
  ungroup: [R(4, 4, 8, 6), R(12, 14, 8, 6)],
  // stacking order
  front: [R(8, 8, 8, 8, 2), P('M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2'), P('M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2')],
  forward: [P('M12 20V5'), P('m5.5 11.5 6.5-6.5 6.5 6.5')],
  backward: [P('M12 4v15'), P('m5.5 12.5 6.5 6.5 6.5-6.5')],
  back: [R(14, 14, 8, 8, 2), R(2, 2, 8, 8, 2), P('M7 14v1a2 2 0 0 0 2 2h1'), P('M14 7h1a2 2 0 0 1 2 2v1')],
  trash: [P('M3 6h18'), P('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), P('M10 11v6M14 11v6')],
  // the figure: new, rename, delete; make again; export
  'file-new': [PAGE, FOLD, P('M12 12v6M9 15h6')],
  'file-x': [PAGE, FOLD, P('m9.5 12.5 5 5M14.5 12.5l-5 5')],
  rename: [P('M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), P('m15 5 4 4')],
  refresh: [P('M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), P('M3 3v5h5'), P('M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16'), P('M16 16h5v5')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('m7 10 5 5 5-5'), P('M12 15V3')],
};

const NS = 'http://www.w3.org/2000/svg';
function iconSvg(icon) {
  const spec = typeof icon === 'string' ? ICONS[icon] : icon;
  if (!spec) throw new Error(`compo: no icon “${icon}”`);
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const [tag, attrs] of spec) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    s.append(e);
  }
  return s;
}

// a button that is an icon: label → aria-label, "label · keys — title" → the tooltip. `text` puts a
// short word beside the icon (an export's format, say) for where the icon alone can't tell.
function iconButton({ icon, label, keys = '', title = '', text = '', run, cls = '' }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ('compo-ico ' + cls).trim();
  b.setAttribute('aria-label', label);
  b.title = label + (keys ? ' · ' + keys : '') + (title ? ' — ' + title : '');
  b.append(iconSvg(icon));
  if (text) { const t = document.createElement('span'); t.textContent = text; b.append(t); b.classList.add('with-text'); }
  if (run) b.onclick = run;
  return b;
}

// ── src/editor.js ──

// The page editor — host-agnostic DOM. A toolbar (page size / orientation / custom mm, zoom, add
// text, align · distribute, front / back, delete, plus the HOST's buttons), the page preview with
// a frame overlay (select · shift-select · drag to move with snapping guides · 8 handles to
// resize · arrows nudge · Delete · ⌘D duplicate · ⌘Z / ⌘⇧Z undo),
// box select (drag on empty page), groups (⌘G / ⌘⇧G: select and move as one), equal-spacing
// guides, snapping while resizing, match size, one-step z-order (⌘] / ⌘[), locks (a locked frame
// won't move, resize or delete), rulers (drag a guide out of one; drag it back to remove it), a
// grid that snaps, an item list (front first: show / hide, lock, rename, drag to restack, groups as
// folders), a context menu (host items +
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
.compo-bar button, .compo-bar select { box-sizing: border-box; height: 24px; }
.compo-bar .compo-grp-bar { display: inline-flex; gap: 3px; align-items: center; flex-wrap: wrap; min-width: 0; }   /* moves to the next line whole; wraps inside only when wider than the bar */
.compo-bar button.compo-ico { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 26px; padding: 0 4px; cursor: pointer; }
.compo-bar button.compo-ico svg { width: 16px; height: 16px; flex: none; display: block; }
.compo-bar button.compo-ico.with-text { padding: 0 7px 0 5px; }
.compo-bar button[aria-pressed=true] { border-color: var(--compo-accent, var(--accent, #fb9044)); color: var(--compo-accent, var(--accent, #fb9044)); }
.compo-bar button:focus-visible, .compo-bar select:focus-visible, .compo-bar input:focus-visible { outline: 2px solid var(--compo-accent, var(--accent, #fb9044)); outline-offset: 1px; }
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
/* the inspector is ONE grid: a label column, and a value cell whose controls fill it — every row
   lines up whatever its controls are (one select, an x/y pair, a checkbox, three numbers) */
.compo-side .row { display: grid; grid-template-columns: 64px minmax(0, 1fr); column-gap: 8px; align-items: center; min-height: 24px; }
.compo-side .row > span:first-child { color: var(--compo-dim, var(--dim, #9a9a9a)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.compo-side .ctl { display: flex; gap: 6px; align-items: center; min-width: 0; }
.compo-side .ctl > input:not([type=checkbox]), .compo-side .ctl > select { flex: 1 1 0; min-width: 0; width: auto; }
.compo-side .ctl > input[type=checkbox] { margin: 0; }
.compo-side .ctl > .hint { flex: none; }
.compo-side .ctl.stack { flex-direction: column; align-items: stretch; gap: 3px; }
.compo-side .ctl.stack > .pair { flex: none; }
.compo-side .row:has(.stack) { align-items: start; }
.compo-side .row:has(.stack) > span:first-child { line-height: 22px; }
.compo-side .pair { flex: 1 1 0; display: flex; gap: 4px; align-items: center; min-width: 0; }
.compo-side .leg { display: flex; gap: 4px; align-items: center; min-height: 24px; }
.compo-side .leg input:not([type]), .compo-side .leg input[type=text] { flex: 1 1 auto; min-width: 0; }
.compo-side .leg input[type=color] { width: 26px; padding: 0; flex: 0 0 auto; }
.compo-side .leg button { min-width: 22px; padding: 0 3px; }
.compo-side .leg.off input:not([type=color]) { opacity: 0.45; }
.compo-side .pair > i { font-style: normal; color: var(--compo-dim, var(--dim, #9a9a9a)); width: 8px; text-align: center; }
.compo-side .pair > input { flex: 1 1 0; min-width: 0; width: auto; }
.compo-side .row input:not([type=checkbox]), .compo-side .row select { box-sizing: border-box; height: 22px; }
.compo-side textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-family: var(--compo-mono, monospace); }
.compo-side .hint { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; }
.compo-fr.locked::after { content: 'locked'; position: absolute; right: 1px; top: 1px; font: 9px/1 system-ui, sans-serif; padding: 1px 3px; background: rgba(40,40,40,0.75); color: #fff; border-radius: 2px; pointer-events: none; }
.compo-grp { position: absolute; border: 1px dashed #3c82e6; pointer-events: none; box-sizing: border-box; }
.compo-marq { position: absolute; border: 1px solid #3c82e6; background: rgba(60,130,230,0.12); pointer-events: none; }
.compo-badge { position: absolute; left: 1px; top: 1px; font: 9px/1.2 system-ui, sans-serif; padding: 1px 4px; background: #c98a00; color: #111; border-radius: 2px; pointer-events: auto; cursor: help; max-width: calc(100% - 6px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
.compo-it .warn { color: #c98a00; margin-left: 4px; cursor: help; }
.compo-link { position: absolute; height: 0; border-top: 1px dashed #3c82e6; transform-origin: 0 0; pointer-events: none; z-index: 2; }
.compo-fr.ref { outline: 1px dashed #3c82e6; outline-offset: 2px; }
.compo-it .nm .ds { color: var(--compo-dim, var(--dim, #9a9a9a)); margin-left: 6px; font-weight: normal; }
.compo-side input.compo-id { font-family: var(--compo-mono, monospace); }
.compo-side input.compo-id.bad { outline: 1px solid #c33; }
.compo-gap { position: absolute; background: #e6339a; pointer-events: none; }
.compo-gap-l { position: absolute; font: 10px/1 system-ui, sans-serif; color: #fff; background: #e6339a; padding: 1px 3px; border-radius: 2px; transform: translate(-50%, -50%); pointer-events: none; white-space: nowrap; }
.compo-bar .status { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; margin-left: 4px; }
.compo-scroll { padding-left: 22px; }
.compo-pagewrap { margin: 30px auto 24px; }
.compo-ruler { position: absolute; cursor: crosshair; }
.compo-ruler.top { left: 0; top: -19px; } .compo-ruler.left { top: 0; left: -19px; }
.compo-gl { position: absolute; z-index: 3; }
.compo-gl.x { top: 0; height: 100%; width: 7px; margin-left: -3px; cursor: ew-resize; }
.compo-gl.y { left: 0; width: 100%; height: 7px; margin-top: -3px; cursor: ns-resize; }
.compo-gl::after { content: ''; position: absolute; background: #12a4c4; }
.compo-gl.x::after { left: 3px; top: 0; bottom: 0; width: 1px; } .compo-gl.y::after { top: 3px; left: 0; right: 0; height: 1px; }
.compo-items { display: flex; flex-direction: column; gap: 1px; max-height: 42%; overflow: auto; flex-shrink: 0; padding-bottom: 6px; border-bottom: 1px solid var(--compo-border, var(--border, #3a3d42)); }
.compo-items .ttl { display: flex; justify-content: space-between; color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; padding: 0 2px 3px; }
.compo-it { display: flex; align-items: center; gap: 3px; padding: 2px 3px; border-radius: 3px; user-select: none; }
.compo-it:hover { background: rgba(127,127,127,0.12); }
.compo-it.sel { background: rgba(60,130,230,0.3); }
.compo-it.mem { padding-left: 16px; }
.compo-it.grp .nm { font-weight: bold; }
.compo-it.hid .nm { opacity: 0.45; text-decoration: line-through; }
.compo-side .compo-it button { background: none; border: 0; padding: 0 2px; width: 18px; color: inherit; cursor: pointer; font: inherit; opacity: 0.85; }
.compo-it .nm { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.compo-it .nm input { width: 100%; box-sizing: border-box; }
.compo-it.drop-above { box-shadow: inset 0 2px 0 #3c82e6; } .compo-it.drop-below { box-shadow: inset 0 -2px 0 #3c82e6; }
.compo-insp { display: flex; flex-direction: column; gap: 6px; }
.compo-menu { position: fixed; z-index: 99999; background: var(--compo-btn, var(--bg-panel, #24272b)); border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 4px; padding: 3px 0; min-width: 150px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.compo-menu div { padding: 4px 12px; cursor: pointer; }
.compo-menu div:hover { background: var(--compo-accent, var(--accent, #fb9044)); color: #111; }
`;
let _css = false;
function injectCss() { if (_css || typeof document === 'undefined') return; _css = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v; else if (k in e) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };

// frames that refer to another (captions, scale bars, north arrows) and frames that can be referred to (views: they state a scale)
// any CSS colour → #rrggbb for an <input type=color> (which takes nothing else)
let _cc = null;
function toHex(css, dflt = '#1a1a1a') {
  if (!css) return dflt;
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  try {
    if (!_cc) _cc = document.createElement('canvas').getContext('2d');
    _cc.fillStyle = '#000'; _cc.fillStyle = css; const v = _cc.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : dflt;
  } catch { return dflt; }
}
const canRefer = (f) => f.kind === 'text' || f.kind === 'scalebar' || f.kind === 'north' || f.kind === 'label' || f.kind === 'titleblock';
const isReferable = (f) => !!(f.content && f.content.meta);
function mountEditor(el, doc, opts = {}) {
  injectCss();
  let D = doc, zoom = 3, sel = [];
  const hist = [], fut = [];
  const env = () => ({ ...(opts.env || {}) });
  // the height a text or label frame's content needs, mm — laid out exactly as the kinds lay it out
  let _mc = null;
  function contentHeight(f) {
    const c = f.content || {}, isLabel = f.kind === 'label';
    if (!_mc) _mc = document.createElement('canvas').getContext('2d');
    const size = +c.size || (isLabel ? 7 : 9), pad = isLabel ? 0.8 : (c.pad ?? 1);
    const text = resolveFields(isLabel ? (c.text != null ? c.text : (c.md || '')) : (c.md || ''), { ...env(), doc: D, title: D.title }, f);
    const fam = c.font || (c.mono ? 'mono' : (D.page && D.page.font) || 'sans');
    const { lines } = layoutText(_mc, text, f.box[2] - 2 * pad, { size, mono: fam === 'mono', serif: fam === 'serif', lineHeight: +c.lineHeight || 1.25 });
    return lines.reduce((s, l) => s + (l.gap || 0) + l.lh, 0) + 2 * pad;
  }
  const root = h('div', { className: 'compo-root', tabIndex: 0 });
  const bar = h('div', { className: 'compo-bar' });
  const scroll = h('div', { className: 'compo-scroll' });
  const wrap = h('div', { className: 'compo-pagewrap' });
  const cv = h('canvas');
  const overlay = h('div', { className: 'compo-overlay' });
  const side = h('div', { className: 'compo-side' });
  const rulerTop = h('canvas', { className: 'compo-ruler top', title: 'drag down for a guide' }), rulerLeft = h('canvas', { className: 'compo-ruler left', title: 'drag right for a guide' });
  const items = h('div', { className: 'compo-items' }), insp = h('div', { className: 'compo-insp' });
  side.append(items, insp);
  let showRulers = true; try { showRulers = localStorage.getItem('compo.rulers') !== 'off'; } catch { /* private */ }
  wrap.append(cv, overlay, rulerTop, rulerLeft); scroll.append(wrap);
  root.append(bar, h('div', { className: 'compo-main' }, scroll, side));
  el.replaceChildren(root);

  // ── history ──
  const snap = () => serializeDocument(D);
  const imgCache = new Map();                              // frame id → decoded bitmap (survives undo)
  const keepImgs = () => { for (const f of D.frames) if (f._img) imgCache.set(f.id, { img: f._img, jpeg: f._jpeg }); };
  let _nudge = null;                                       // a run of arrow nudges in progress (one undo step); any other change ends it
  function commit(fn) {
    _nudge = null;
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
  const undo = () => { if (!hist.length) return; _nudge = null; fut.push(snap()); restoreFrom(hist.pop()); };
  const redo = () => { if (!fut.length) return; _nudge = null; hist.push(snap()); restoreFrom(fut.pop()); };
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
  const gridSel = h('select', { title: 'grid — shown and snapped to' });
  for (const [v, t] of [['0', 'no grid'], ['1', 'grid 1 mm'], ['2', 'grid 2 mm'], ['5', 'grid 5 mm'], ['10', 'grid 10 mm']]) gridSel.append(h('option', { value: v, textContent: t }));
  gridSel.onchange = () => commit(() => { const v = +gridSel.value; const p = { ...D.page }; if (v) p.grid = { size: v, show: true, snap: true }; else delete p.grid; D.page = p; });
  // an icon button: its words are the aria-label and the tooltip (with the shortcut, if any)
  const ib = (icon, label, keys, title, run) => iconButton({ icon, label, keys, title, run: () => { run(); root.focus(); } });
  const rulersBtn = ib('rulers', 'Rulers', '', 'show or hide them; drag a guide out of a ruler, drag it back to remove it', () => { showRulers = !showRulers; try { localStorage.setItem('compo.rulers', showRulers ? 'on' : 'off'); } catch { /* private */ } render(); });
  const alignBtns = [['align-left', 'left', 'Align left'], ['align-hcenter', 'hcenter', 'Align centres'], ['align-right', 'right', 'Align right'], ['align-top', 'top', 'Align top'], ['align-vcenter', 'vcenter', 'Align middles'], ['align-bottom', 'bottom', 'Align bottom']]
    .map(([icon, how, l]) => ib(icon, l, '', 'two or more frames; a locked one stays put and is the reference', () => commit(() => alignFrames(D, sel, how))));
  const distBtns = [['dist-h', 'h', 'Distribute horizontally'], ['dist-v', 'v', 'Distribute vertically']].map(([icon, ax, l]) => ib(icon, l, '', 'equal gaps between three or more frames', () => commit(() => distributeFrames(D, sel, ax))));
  const sizeBtns = [['same-w', 'w', 'Same width'], ['same-h', 'h', 'Same height'], ['same-wh', 'both', 'Same size']].map(([icon, what, l]) => ib(icon, l, '', 'as the first selected frame', () => commit(() => matchSize(D, sel, what))));
  const groupBtn = ib('group', 'Group', '⌘G', 'the selected frames select and move as one', () => doGroup());
  const ungroupBtn = ib('ungroup', 'Ungroup', '⌘⇧G', '', () => doUngroup());
  const frontBtn = ib('front', 'Bring to front', '⌘⇧]', '', () => commit(() => bringToFront(D, sel)));
  const fwdBtn = ib('forward', 'Bring forward', '⌘]', 'one step', () => commit(() => bringForward(D, sel)));
  const bwdBtn = ib('backward', 'Send backward', '⌘[', 'one step', () => commit(() => sendBackward(D, sel)));
  const backBtn = ib('back', 'Send to back', '⌘⇧[', '', () => commit(() => sendToBack(D, sel)));
  const delBtn = ib('trash', 'Delete', 'Delete', 'the selected frames (locked ones stay)', () => del());
  const undoBtn = ib('undo', 'Undo', '⌘Z', '', () => undo()), redoBtn = ib('redo', 'Redo', '⌘⇧Z', '', () => redo());
  const status = h('span', { className: 'status' });
  let _stT = 0;
  const say = (msg) => { status.textContent = msg; clearTimeout(_stT); _stT = setTimeout(() => { status.textContent = ''; }, 4000); if (opts.onStatus) opts.onStatus(msg); };
  const sep = () => h('span', { className: 'sep' });
  // undo · add frames (the host's first, then label and text) · align, distribute, match size ·
  // group · stacking and delete · the page
  // each group wraps as a whole on a narrow bar, never split in the middle
  const grp = (...kids) => h('span', { className: 'compo-grp-bar' }, ...kids);
  const hostBtns = (opts.toolbar || []).map((t) => { const run = () => t.run(api); return t.icon ? ib(t.icon, t.label, t.keys || '', t.title || '', run) : btn(t.label, t.title || '', run); });
  bar.append(grp(undoBtn, redoBtn), sep(),
    grp(...hostBtns, ib('label', 'Add label', '', 'a label pinned to a point in a 3D view, or a direction on a stereonet (the host may supply the point)', () => addLabel()),
      ib('text', 'Add text', '', 'a text frame — a caption (fields: {fig} {page} {date} ${…})', () => add({ kind: 'text', content: { md: '**Figure {fig}.** caption', size: 9 } })),
      ib('shape', 'Add shape', '', 'a rectangle, an ellipse, a line or an arrow — a box round something, a pointer', () => add({ kind: 'shape', box: freeSpot(D, 40, 25), content: { shape: 'rect' } })),
      ib('qr', 'Add QR code', '', 'a link or a text, scannable from the printed page', () => addQr())),
    sep(), grp(...alignBtns, ...distBtns, ...sizeBtns), sep(), grp(groupBtn, ungroupBtn), sep(), grp(frontBtn, fwdBtn, bwdBtn, backBtn, delBtn),
    sep(), grp(sizeSel, oriSel, customSpan, zoomSel, gridSel, rulersBtn), status);

  // ── rendering ──
  function render() { sel = sel.filter((id) => frameById(D, id)); renderCanvas(); syncBar(); renderSide(); }   // (a removed frame leaves the selection)
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
    drawRulers();
  }
  function drawOverlay(guides) {
    overlay.replaceChildren();
    const m = D.page.margins || [0, 0, 0, 0], [W, H] = pageDims(D.page);
    const gr = D.page.grid;
    if (gr && gr.show && gr.size > 0) {
      overlay.style.backgroundImage = 'linear-gradient(to right, rgba(60,130,230,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(60,130,230,0.16) 1px, transparent 1px)';
      overlay.style.backgroundSize = `${gr.size * zoom}px ${gr.size * zoom}px`;
    } else overlay.style.backgroundImage = 'none';
    overlay.append(h('div', { className: 'compo-margin', style: `left:${m[3] * zoom}px;top:${m[0] * zoom}px;width:${(W - m[1] - m[3]) * zoom}px;height:${(H - m[0] - m[2]) * zoom}px` }));
    for (const f of D.frames) {
      if (f.hidden) continue;                              // hidden: not drawn, not picked (the list still has it)
      const b = f.box;
      const d = h('div', { className: 'compo-fr' + (sel.includes(f.id) ? ' sel' : '') + (f.locked ? ' locked' : ''), title: `${(kindOf(f.kind) && kindOf(f.kind).label) || f.kind}` });
      d.style.cssText = `left:${b[0] * zoom}px;top:${b[1] * zoom}px;width:${b[2] * zoom}px;height:${b[3] * zoom}px`;
      d.dataset.id = f.id;
      const bdg = badgeOf(f);
      if (bdg) d.append(h('span', { className: 'compo-badge', textContent: bdg.text, title: bdg.title || bdg.text }));
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
    if (sel.length === 1) {
      const f = frameById(D, sel[0]), t = f && canRefer(f) ? subjectFrame({ doc: D }, f, isReferable) : null;
      if (t && !t.hidden) {
        const od = [...overlay.querySelectorAll(".compo-fr")].find((x) => x.dataset.id === t.id); if (od) od.classList.add("ref");
        const ax = (f.box[0] + f.box[2] / 2) * zoom, ay = (f.box[1] + f.box[3] / 2) * zoom, bx = (t.box[0] + t.box[2] / 2) * zoom, by = (t.box[1] + t.box[3] / 2) * zoom;
        const ln = h('div', { className: 'compo-link' });
        ln.style.cssText = `left:${ax}px;top:${ay}px;width:${Math.hypot(bx - ax, by - ay)}px;transform:rotate(${Math.atan2(by - ay, bx - ax)}rad)`;
        overlay.append(ln);
      }
    }
    const gd = D.page.guides || {};
    for (const ax of ['x', 'y']) (gd[ax] || []).forEach((v, i) => {
      const gl = h('div', { className: `compo-gl ${ax}`, title: 'drag to move · drag off the page to remove' });
      gl.style[ax === 'x' ? 'left' : 'top'] = `${v * zoom}px`; gl.dataset.guide = `${ax}:${i}`;
      overlay.append(gl);
    });
    // a selected group: its bounds, dashed
    const seenG = new Set();
    for (const id of sel) {
      const f = frameById(D, id); if (!f || !f.group || seenG.has(f.group)) continue;
      seenG.add(f.group);
      const b = boundsOf(D.frames.filter((x) => x.group === f.group));
      overlay.append(h('div', { className: 'compo-grp', style: `left:${b[0] * zoom - 3}px;top:${b[1] * zoom - 3}px;width:${b[2] * zoom + 6}px;height:${b[3] * zoom + 6}px` }));
    }
    if (_marq) { const [x, y, w, hh] = _marq; overlay.append(h('div', { className: 'compo-marq', style: `left:${x * zoom}px;top:${y * zoom}px;width:${w * zoom}px;height:${hh * zoom}px` })); }
    if (guides && guides.gaps) for (const g of guides.gaps) {
      const len = (g.b - g.a) * zoom, at = g.at * zoom, a = g.a * zoom;
      if (len <= 0) continue;
      overlay.append(h('div', { className: 'compo-gap', style: g.k ? `left:${at}px;top:${a}px;width:1px;height:${len}px` : `left:${a}px;top:${at}px;height:1px;width:${len}px` }));
      const lx = g.k ? at : a + len / 2, ly = g.k ? a + len / 2 : at;
      overlay.append(h('div', { className: 'compo-gap-l', textContent: `${+(g.b - g.a).toFixed(1)}`, style: `left:${lx}px;top:${ly}px` }));
    }
    if (guides) {
      if (guides.x != null) overlay.append(h('div', { className: 'compo-guide', style: `left:${guides.x * zoom}px;top:0;width:1px;height:100%` }));
      if (guides.y != null) overlay.append(h('div', { className: 'compo-guide', style: `top:${guides.y * zoom}px;left:0;height:1px;width:100%` }));
    }
  }
  function syncBar() {
    sizeSel.value = PAPER[D.page.size] ? D.page.size : 'custom';
    gridSel.value = D.page.grid && D.page.grid.size ? String(D.page.grid.size) : '0';
    rulersBtn.setAttribute('aria-pressed', String(showRulers));
    undoBtn.disabled = !hist.length; redoBtn.disabled = !fut.length;
    oriSel.value = D.page.orientation || 'portrait'; oriSel.disabled = sizeSel.value === 'custom';
    customSpan.style.display = sizeSel.value === 'custom' ? 'inline-flex' : 'none';
    const [W, H] = pageDims(D.page); wIn.value = +W.toFixed(1); hIn.value = +H.toFixed(1);
    const nu = unitsOf(D, sel).length, grouped = sel.some((id) => { const f = frameById(D, id); return f && f.group; });
    for (const b of alignBtns) b.disabled = nu < 2;
    for (const b of distBtns) b.disabled = nu < 3;
    for (const b of sizeBtns) b.disabled = sel.length < 2;
    groupBtn.disabled = nu < 2; ungroupBtn.disabled = !grouped;
    frontBtn.disabled = fwdBtn.disabled = bwdBtn.disabled = backBtn.disabled = delBtn.disabled = !sel.length;
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
        if (_keepItems) refreshItemSel(); else buildItems();
      } while (_sideAgain);
    } finally { _inSide = false; }
  }
  function buildSide() {
    insp.replaceChildren();
    if (sel.length !== 1) {
      if (!sel.length) pagePanel();
      if (sel.length) {
        const nu = unitsOf(D, sel).length, locked = sel.filter((id) => frameById(D, id).locked).length;
        insp.append(h('div', { className: 'hint', textContent: `${sel.length} frames${nu < sel.length ? ` in ${nu} unit${nu === 1 ? '' : 's'} (groups move as one)` : ''} — align / distribute / match size from the toolbar; the FIRST selected is the size key` }));
        const lk = h('input', { type: 'checkbox', checked: locked === sel.length });
        lk.indeterminate = locked > 0 && locked < sel.length;
        lk.onchange = () => commit(() => { for (const id of sel) frameById(D, id).locked = lk.checked; });
        insp.append(h('label', { className: 'row' }, h('span', { textContent: 'locked' }), h('span', { className: 'ctl' }, lk)));
        multiPanel();
      } else insp.append(h('div', { className: 'hint', textContent: 'click a frame to edit it · drag to move (snaps to edges, centres and equal gaps; ⌥ off) · drag on the empty page to box-select · handles resize · arrows nudge (⇧ ×10) · ⌘G group · ⌘Z undo' }));
      return;
    }
    const f = frameById(D, sel[0]); if (!f) return;
    const kind = kindOf(f.kind);
    insp.append(h('div', { textContent: `${(kind && kind.label) || f.kind}`, style: 'font-weight:bold' }));
    // the id: the frame's one handle (fields say {scale@plan}); renaming rewrites every reference
    const idIn = h('input', { className: 'compo-id', value: f.id, spellcheck: false, title: 'the frame’s id — fields refer to it as @id; renaming updates every reference' });
    idIn.oninput = () => { const v = sanitizeId(idIn.value); idIn.classList.toggle('bad', !v || (v !== f.id && D.frames.some((x) => x.id === v))); };
    idIn.onchange = () => { if (!doRename(f, idIn.value)) idIn.value = f.id; };
    idIn.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') idIn.blur(); };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'id' }), h('span', { className: 'ctl' }, idIn)));
    if (canRefer(f)) {
      // refers to: the nearest view (the default — it says which), or a fixed one
      const refOK = f.kind === 'label' ? canPin : isReferable;   // a label refers to what it can pin to: a 3D view or a net
      const near = refFrame(D, f, null, refOK), cands = D.frames.filter((x) => x !== f && refOK(x));
      const rs = h('select', { title: 'the frame this one is about: its fields ({scale} {section} …), or the view a scale bar / north arrow measures' },
        h('option', { value: '', textContent: near ? `nearest → ${near.id}` : 'nearest (none yet)' }),
        ...cands.map((x) => h('option', { value: x.id, textContent: x.id })));
      rs.value = (f.content && f.content.of) || '';
      rs.onchange = () => commit(() => { f.content = { ...(f.content || {}) }; if (rs.value) f.content.of = rs.value; else delete f.content.of; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'refers to' }), h('span', { className: 'ctl' }, rs)));
    }
    const num = (label, i) => {
      const inp = h('input', { type: 'number', step: 0.5, value: +f.box[i].toFixed(1) });
      inp.onchange = () => commit(() => { const v = +inp.value; if (Number.isFinite(v)) f.box[i] = i >= 2 ? Math.max(2, v) : v; });
      return h('span', { className: 'pair' }, h('i', { textContent: label }), inp);
    };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'position' }), h('span', { className: 'ctl' }, num('x', 0), num('y', 1))));
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'size' }), h('span', { className: 'ctl' }, num('w', 2), num('h', 3))));
    const st = f.style || {};
    const setStyle = (k, v) => commit(() => { f.style = { ...(f.style || {}) }; if (v == null || v === '' || v === false) delete f.style[k]; else f.style[k] = v; });
    const bd = h('input', { type: 'checkbox', checked: !!st.border });
    bd.onchange = () => setStyle('border', bd.checked);
    const bc = h('input', { type: 'color', value: toHex(st.borderColor), title: 'border colour' });
    bc.onchange = () => setStyle('borderColor', bc.value);
    const bw = h('input', { type: 'number', min: 0.05, max: 3, step: 0.05, value: st.borderWidth || 0.25, title: 'border width (mm)', style: 'width:56px' });
    bw.onchange = () => setStyle('borderWidth', +bw.value || null);
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'border' }), h('span', { className: 'ctl' }, bd, bc, bw)));
    // a fill behind the frame: a panel, a band, a highlight (empty = none)
    // its opacity is kept beside the colour (a picked colour is #rrggbb — it used to drop an rgba fill's alpha)
    const alpha0 = (() => { const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(st.background || ''); return m ? Math.round(+m[1] * 100) : 100; })();
    const fillOn = h('input', { type: 'checkbox', checked: !!st.background, title: 'a fill behind the frame' });
    const fillC = h('input', { type: 'color', value: toHex(st.background, '#f2f2f0'), title: 'fill colour' });
    const fillA = h('input', { type: 'number', min: 0, max: 100, step: 5, value: alpha0, title: 'fill opacity (%)', style: 'width:56px' });
    const fillCss = () => { const a = Math.max(0, Math.min(100, +fillA.value || 0)); if (a >= 100) return fillC.value; const n = parseInt(fillC.value.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a / 100})`; };
    fillOn.onchange = () => setStyle('background', fillOn.checked ? fillCss() : null);
    fillC.onchange = fillA.onchange = () => { if (fillOn.checked) setStyle('background', fillCss()); };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'fill' }), h('span', { className: 'ctl' }, fillOn, fillC, h('span', { className: 'pair' }, h('i', { textContent: '%' }), fillA))));
    const lk = h('input', { type: 'checkbox', checked: !!f.locked });
    lk.onchange = () => commit(() => { f.locked = lk.checked; });
    insp.append(h('label', { className: 'row', title: 'a locked frame won’t move, resize or delete' }, h('span', { textContent: 'locked' }), h('span', { className: 'ctl' }, lk)));
    if (f.group) insp.append(h('div', { className: 'hint', textContent: `in a group of ${D.frames.filter((x) => x.group === f.group).length} — ⌘⇧G ungroups` }));
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
      const fontSel = h('select', { title: 'the typeface' }, ...[['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']].map(([v, t]) => h('option', { value: v, textContent: t })));
      fontSel.value = f.content.font || (f.content.mono ? 'mono' : 'sans');
      fontSel.onchange = () => commit(() => { f.content.font = fontSel.value; delete f.content.mono; });
      const col = h('input', { type: 'color', value: toHex(f.content.color), title: 'text colour' });
      col.onchange = () => commit(() => { f.content.color = col.value; });
      const lh = h('input', { type: 'number', min: 0.8, max: 3, step: 0.05, value: f.content.lineHeight || 1.25, title: 'line spacing (× the size)', style: 'width:56px' });
      lh.onchange = () => commit(() => { f.content.lineHeight = +lh.value || 1.25; });
      const pad = h('input', { type: 'number', min: 0, max: 20, step: 0.5, value: f.content.pad ?? 1, title: 'padding inside the frame (mm)', style: 'width:56px' });
      pad.onchange = () => commit(() => { f.content.pad = Math.max(0, +pad.value || 0); });
      // insert a field at the caret (compo's own and the host's, each with its help as the tooltip)
      const fl = fieldList(opts.env || {});
      const fsel = h('select', { title: 'insert a field at the caret', className: 'compo-fields' }, h('option', { value: '', textContent: 'insert field…' }),
        ...fl.map((x) => h('option', { value: x.name, textContent: '{' + x.name + '}', title: x.help || '' })));
      fsel.onchange = () => {
        const nm = fsel.value; fsel.value = ''; if (!nm) return;
        const tok = '{' + nm + '}', a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
        commit(() => { f.content.md = ta.value.slice(0, a) + tok + ta.value.slice(b); });
        requestAnimationFrame(() => { const t2 = side.querySelector('textarea'); if (t2) { t2.focus(); t2.selectionStart = t2.selectionEnd = a + tok.length; } });
      };
      const va = h('select', { title: 'where the text sits in the frame, top to bottom' }, ...['top', 'middle', 'bottom'].map((v) => h('option', { value: v, textContent: v })));
      va.value = f.content.valign || 'top';
      va.onchange = () => commit(() => { if (va.value === 'top') delete f.content.valign; else f.content.valign = va.value; });
      const fitB = h('button', { textContent: 'Fit to content', title: 'make the frame exactly as tall as its text' });
      fitB.onclick = () => commit(() => { f.box[3] = Math.max(2, +contentHeight(f).toFixed(1)); });
      insp.append(ta, h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), h('span', { className: 'ctl' }, size, align, va)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, fontSel, col, fitB)),
        h('div', { className: 'row' }, h('span', { textContent: 'spacing' }), h('span', { className: 'ctl' }, h('span', { className: 'pair' }, h('i', { textContent: '↕' }), lh), h('span', { className: 'pair' }, h('i', { textContent: '▢' }), pad))),
        h('div', { className: 'row' }, h('span', { textContent: 'fields' }), h('span', { className: 'ctl' }, fsel)),
        h('div', { className: 'hint', textContent: '# title · ## subtitle · - list · 1. list · --- rule · **bold** · *italic* · `code` · {name} fields, {count:,} · ${expr:,.2f}' }));
      api._focusText = () => ta.focus();
    }
    if (f.kind === 'image') {
      const fit = h('select', {}, ...['contain', 'cover', 'fill'].map((v) => h('option', { value: v, textContent: v })));
      fit.value = f.content.fit || 'contain';
      fit.onchange = () => commit(() => { f.content.fit = fit.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'fit' }), h('span', { className: 'ctl' }, fit)));
      if (hasProj(f)) {                                     // a view of 3D space: coordinates on its border
        const tk = h('select', { className: 'compo-ticks', title: 'coordinate ticks on the border (orthographic views), or a grid across' }, ...['off', 'ticks', 'grid'].map((v) => h('option', { value: v, textContent: v })));
        tk.value = f.content.ticks || 'off';
        tk.onchange = () => commit(() => { if (tk.value === 'off') delete f.content.ticks; else f.content.ticks = tk.value; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'coords' }), h('span', { className: 'ctl' }, tk)));
      }
    }
    if (f.kind === 'table') tablePanel(f);
    if (f.kind === 'scalebar') scalebarPanel(f);
    if (f.kind === 'north') northPanel(f);
    if (f.kind === 'shape') shapePanel(f);
    if (f.kind === 'qr') qrPanel(f);
    if (f.kind === 'legend') {
      // the look, then each entry: show/hide, colour, label, order. Your edits sit beside the host's data
      // (content.edit / order — kinds.js), so refreshing the legend from the data keeps them
      const c = f.content || (f.content = {});
      const ttl = h('input', { value: c.title || '', placeholder: 'no title', title: 'the legend’s title (fields work: {name})' });
      ttl.onchange = () => commit(() => { f.content.title = ttl.value; f.content.titleUser = true; });
      const gsz = h('input', { type: 'number', min: 4, max: 24, step: 0.5, value: c.size || 8, title: 'text size (pt)', style: 'width:56px' });
      gsz.onchange = () => commit(() => { f.content.size = +gsz.value || 8; });
      const tcol = h('input', { type: 'color', value: toHex(c.textColor), title: 'text colour' });
      tcol.onchange = () => commit(() => { f.content.textColor = tcol.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'title' }), h('span', { className: 'ctl' }, ttl)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, gsz, tcol)));
      const setEdit = (key, patch) => commit(() => {
        const ed = { ...(f.content.edit || {}) }, cur = { ...(ed[key] || {}), ...patch };
        for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
        if (Object.keys(cur).length) ed[key] = cur; else delete ed[key];
        if (Object.keys(ed).length) f.content.edit = ed; else delete f.content.edit;
      });
      if (c.kind === 'ramp') {
        const hiL = h('input', { value: (c.edit && c.edit.hiLabel) ?? c.hiLabel ?? String(c.hi ?? ''), title: 'the top label' });
        const loL = h('input', { value: (c.edit && c.edit.loLabel) ?? c.loLabel ?? String(c.lo ?? ''), title: 'the bottom label' });
        hiL.onchange = () => commit(() => { f.content.edit = { ...(f.content.edit || {}), hiLabel: hiL.value }; });
        loL.onchange = () => commit(() => { f.content.edit = { ...(f.content.edit || {}), loLabel: loL.value }; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'top' }), h('span', { className: 'ctl' }, hiL)),
          h('div', { className: 'row' }, h('span', { textContent: 'bottom' }), h('span', { className: 'ctl' }, loL)));
      } else {
        const cols = h('input', { type: 'number', min: 1, max: 6, step: 1, value: c.columns || 1, title: 'columns', style: 'width:56px' });
        cols.onchange = () => commit(() => { const n = Math.max(1, Math.min(6, Math.round(+cols.value || 1))); if (n === 1) delete f.content.columns; else f.content.columns = n; });
        const shape = h('select', { title: 'the swatch: a square (areas), a dot (points), a line (curves)' }, ...['square', 'circle', 'line'].map((v) => h('option', { value: v, textContent: v })));
        shape.value = c.swatch || 'square';
        shape.onchange = () => commit(() => { if (shape.value === 'square') delete f.content.swatch; else f.content.swatch = shape.value; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'layout' }), h('span', { className: 'ctl' }, h('span', { className: 'pair' }, h('i', { textContent: '▥' }), cols), shape)));
        const es = legendEntries(c), keys = es.map((e) => e._key);
        const orig = (k) => (c.entries || []).find((x) => legendKey(x) === k) || {};
        es.forEach((e, i) => {
          const eye = h('button', { textContent: e.hidden ? '◌' : '◉', title: e.hidden ? 'show this entry' : 'hide this entry (not drawn)', onclick: () => setEdit(e._key, { hidden: e.hidden ? null : true }) });
          const sw = h('input', { type: 'color', value: toHex(e.color, '#888888'), title: 'its colour' });
          sw.onchange = () => setEdit(e._key, { color: toHex(orig(e._key).color) === sw.value ? null : sw.value });
          const lb = h('input', { value: String(e.label ?? ''), title: 'its label' });
          lb.onchange = () => setEdit(e._key, { label: lb.value === String(orig(e._key).label ?? '') ? null : lb.value });
          const move = (d) => () => { const j = i + d; if (j < 0 || j >= keys.length) return; const k = keys.slice(); [k[i], k[j]] = [k[j], k[i]]; commit(() => { f.content.order = k; }); };
          const up = h('button', { textContent: '↑', title: 'move up', disabled: i === 0, onclick: move(-1) });
          const dn = h('button', { textContent: '↓', title: 'move down', disabled: i === es.length - 1, onclick: move(1) });
          insp.append(h('div', { className: 'leg' + (e.hidden ? ' off' : '') }, eye, sw, lb, up, dn));
        });
      }
      const edited = c.edit || c.order || c.titleUser;
      if (edited) insp.append(h('div', { className: 'row' }, h('span', {}), h('span', { className: 'ctl' }, h('button', { textContent: 'reset edits', title: 'back to the data’s own labels, colours and order', onclick: () => commit(() => { delete f.content.edit; delete f.content.order; delete f.content.titleUser; }) }))));
      insp.append(h('div', { className: 'hint', textContent: 'your edits stay when the legend is refreshed from the data' }));
    }
    if (f.kind === 'label') {
      const tx = h('textarea', { value: f.content.text || '', style: 'min-height:40px' });
      tx.onchange = () => commit(() => { f.content.text = tx.value; });
      const lsz = h('input', { type: 'number', min: 4, max: 48, step: 0.5, value: f.content.size || 7, title: 'size (pt)', style: 'width:56px' });
      lsz.onchange = () => commit(() => { f.content.size = +lsz.value || 7; });
      const lfont = h('select', { title: 'the typeface' }, ...[['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']].map(([v, t]) => h('option', { value: v, textContent: t })));
      lfont.value = f.content.font || 'sans';
      lfont.onchange = () => commit(() => { f.content.font = lfont.value; });
      const lcol = h('input', { type: 'color', value: toHex(f.content.color), title: 'text, leader and dot colour' });
      lcol.onchange = () => commit(() => { f.content.color = lcol.value; });
      const back = h('input', { type: 'checkbox', checked: f.content.backing !== false, title: 'a white backing behind the words, so they read over the picture' });
      back.onchange = () => commit(() => { f.content.backing = back.checked; });
      const lal = h('select', { title: 'the words’ alignment in the box' }, ...['left', 'center', 'right'].map((v) => h('option', { value: v, textContent: v })));
      lal.value = f.content.align || 'left';
      lal.onchange = () => commit(() => { if (lal.value === 'left') delete f.content.align; else f.content.align = lal.value; });
      const lead = h('select', { title: 'the leader from the box to the point' }, ...[['line', 'line + dot'], ['arrow', 'arrow'], ['none', 'none']].map(([v, t]) => h('option', { value: v, textContent: t })));
      lead.value = f.content.leader || 'line';
      lead.onchange = () => commit(() => { if (lead.value === 'line') delete f.content.leader; else f.content.leader = lead.value; });
      const lfit = h('button', { textContent: 'Fit', title: 'make the box exactly as tall as its words' });
      lfit.onclick = () => commit(() => { f.box[3] = Math.max(2, +contentHeight(f).toFixed(1)); });
      // the words show as you type (the page only; one undo step when you leave the box)
      let lt0 = null;
      tx.onfocus = () => { lt0 = snap(); };
      tx.oninput = () => { f.content.text = tx.value; renderCanvas(); };
      tx.onchange = () => { if (lt0) { hist.push(lt0); fut.length = 0; lt0 = null; } if (opts.onChange) opts.onChange(D); };
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), h('span', { className: 'ctl' }, lsz, lal, lfit)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, lfont, lcol)),
        h('div', { className: 'row' }, h('span', { textContent: 'leader' }), h('span', { className: 'ctl' }, lead)),
        h('label', { className: 'row' }, h('span', { textContent: 'backing' }), h('span', { className: 'ctl' }, back)));
      const at = f.content.at || [0, 0, 0];
      const tgt = f.content.of ? frameById(D, f.content.of) : refFrame(D, f, null, canPin);
      if (tgt && !hasProj(tgt)) {
        // pinned to a net: the point is a DIRECTION — shown and typed as a line, trend → plunge (axial, lower hemisphere)
        const len = Math.hypot(at[0], at[1], at[2]) || 1, s = at[2] > 0 ? -1 : 1, d = at.map((v) => (s * v) / len);
        const tr = ((Math.atan2(d[0], d[1]) * 180 / Math.PI) + 360) % 360, pl = Math.asin(Math.min(1, -d[2])) * 180 / Math.PI;
        const inp = h('input', { value: `${String(Math.round(tr)).padStart(3, '0')}→${Math.round(pl)}`, title: 'the direction it points at: trend → plunge (also 328/25 or 328 25)' });
        inp.onchange = () => {
          const m = /^\s*(-?[\d.]+)\s*(?:→|->|\/|,|\s)\s*(-?[\d.]+)\s*$/.exec(inp.value);
          if (!m) { say('a direction is trend → plunge, e.g. 328→25'); return; }
          const t = +m[1] * Math.PI / 180, p = +m[2] * Math.PI / 180;
          commit(() => { f.content.at = [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)].map((v) => +v.toFixed(6)); });
        };
        insp.append(tx, h('div', { className: 'row' }, h('span', { textContent: 'points at' }), h('span', { className: 'ctl' }, inp)), h('div', { className: 'hint', textContent: 'the leader follows this direction on the net it refers to' }));
      } else {
        const xyz = ['x', 'y', 'z'].map((k, i) => { const inp = h('input', { type: 'number', step: 'any', value: +(+at[i]).toFixed(3), title: `the point, world ${k}` }); inp.onchange = () => commit(() => { const a = (f.content.at || [0, 0, 0]).slice(); a[i] = +inp.value || 0; f.content.at = a; }); return h('span', { className: 'pair' }, h('i', { textContent: k }), inp); });   // world coordinates are long: one per line
        insp.append(tx, h('div', { className: 'row' }, h('span', { textContent: 'points at' }), h('span', { className: 'ctl stack' }, ...xyz)), h('div', { className: 'hint', textContent: 'the leader follows this world point in the view it refers to' }));
      }
    }
    if (f.kind === 'titleblock') {
      // its rows, one a line — each a text frame's markdown with fields; a row keeps its type
      // size and height by position (a new row: 6.5 pt, 5 mm), the frame's height follows
      const rows = () => (f.content.rows || []).map((r) => r.slice());
      const ta = h('textarea', { value: rows().map((r) => r[0]).join('\n'), spellcheck: true, title: 'one row a line: **bold** · {title} {date} {scale} {page} {pages} · {prop:company} {prop:drawing} …' });
      ta.onchange = () => commit(() => {
        const old = rows(), lines = ta.value.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || i < a.length - 1);
        const next = lines.map((md, i) => [md, old[i] ? old[i][1] : 6.5, old[i] ? old[i][2] : 5]);
        const h0 = old.reduce((s2, r) => s2 + r[2], 0) || 1, h1 = next.reduce((s2, r) => s2 + r[2], 0);
        f.content = { ...f.content, rows: next };
        f.box[1] += f.box[3] - f.box[3] * (h1 / h0); f.box[3] = +(f.box[3] * (h1 / h0)).toFixed(2);   // grows upward: the block's bottom stays on the margin
      });
      ta.onkeydown = (e) => e.stopPropagation();
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'rows' })), ta, h('div', { className: 'hint', textContent: 'one row a line — fields as in a text frame; the values come from properties…' }));
    }
    if (opts.inspector) opts.inspector(f, insp, api);
    if (f.produced) insp.append(h('div', { className: 'hint', textContent: `produced ${String(f.produced).replace('T', ' ').slice(0, 16)}` }));
  }

  // ── pointer: select, move (snapping), resize ──
  const toMm = (e) => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();                                    // keep the keyboard on the editor (no mousedown focus shuffle)
    root.focus();
    const t = e.target, id = t.dataset && t.dataset.id;
    if (t.dataset && t.dataset.guide) { const [ax, i] = t.dataset.guide.split(':'); startGuide(ax, +i, e); return; }
    if (!id) { startMarquee(e); return; }
    const f = frameById(D, id);
    if (t.dataset.handle) return startResize(e, f, t.dataset.handle.split(',').map(Number));
    const unit = expandGroups(D, [id]);                     // a group member brings its group
    if (e.shiftKey) { sel = sel.includes(id) ? sel.filter((x) => !unit.includes(x)) : sel.concat(unit.filter((x) => !sel.includes(x))); render(); return; }
    if (!sel.includes(id)) { sel = [id, ...unit.filter((x) => x !== id)]; render(); }
    if (sel.some((x) => frameById(D, x).locked)) { if (f.locked) say('locked — unlock it to move it'); return; }
    startMove(e);
  });
  overlay.addEventListener('dblclick', (e) => {
    const id = e.target.dataset && e.target.dataset.id, f = id && frameById(D, id); if (!f) return;
    if (opts.frameOpen && opts.frameOpen(f) === true) return;   // the host opens it (micro: edit a view in place)
    if (f.kind === 'text' && api._focusText) api._focusText();
  });
  overlay.addEventListener('contextmenu', (e) => {
    const id = e.target.dataset && e.target.dataset.id; if (!id) return;
    e.preventDefault();
    if (!sel.includes(id)) { const unit = expandGroups(D, [id]); sel = [id, ...unit.filter((x) => x !== id)]; render(); }
    const f = frameById(D, id), nu = unitsOf(D, sel).length, grouped = sel.some((x) => frameById(D, x).group);
    const anyLocked = sel.some((x) => frameById(D, x).locked);
    const items = [...((opts.frameMenu && opts.frameMenu(f, api)) || []), { sep: true },
      { label: 'Duplicate', run: () => dup() },
      ...(nu >= 2 ? [{ label: 'Group', run: () => doGroup() }] : []), ...(grouped ? [{ label: 'Ungroup', run: () => doUngroup() }] : []),
      ...(sel.length >= 2 ? [{ label: 'Same size as the first', run: () => commit(() => matchSize(D, sel, 'both')) }] : []),
      { sep: true },
      { label: 'Bring to front', run: () => commit(() => bringToFront(D, sel)) }, { label: 'Bring forward', run: () => commit(() => bringForward(D, sel)) },
      { label: 'Send backward', run: () => commit(() => sendBackward(D, sel)) }, { label: 'Send to back', run: () => commit(() => sendToBack(D, sel)) },
      { sep: true },
      { label: anyLocked ? 'Unlock' : 'Lock', run: () => commit(() => { for (const x of sel) frameById(D, x).locked = !anyLocked; }) }, { label: 'Delete', run: () => del() }];
    menu(e.clientX, e.clientY, items);
  });
  function startMove(e) {
    const p0 = toMm(e), starts = sel.map((id) => [id, frameById(D, id).box.slice()]);
    const b0 = boundsOf(starts.map(([, b]) => ({ box: b })));
    const before = snap();
    let moved = false;
    const mv = (ev) => {
      const p = toMm(ev); let dx = p[0] - p0[0], dy = p[1] - p0[1];
      if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
      moved = true;
      // snap the selection's bounds (a group or several frames move as one box)
      const pb = b0;
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
      const keep = ev.shiftKey && hx !== 0.5 && hy !== 0.5;
      let guides = null;
      if (!ev.altKey) { const s2 = snapResize(D, [x, y, w, hh], [hx, hy], { ignore: [f.id], onlyX: keep }); [x, y, w, hh] = s2.box; guides = s2.guides; }   // the dragged edges snap (⌥ off)
      if (keep) { hh = w / aspect; if (hy === 0) y = b0[1] + b0[3] - hh; }   // ⇧ keeps the aspect
      if (w < 3) { if (hx === 0) x = b0[0] + b0[2] - 3; w = 3; }
      if (hh < 3) { if (hy === 0) y = b0[1] + b0[3] - 3; hh = 3; }
      f.box = [x, y, w, hh];
      renderFast(guides);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); hist.push(before); fut.length = 0; changed(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  // ── guides: drag one out of a ruler; drag it to move (½ mm steps, or the grid; ⌥ free); off the
  // page removes it. page.guides = { x: [mm], y: [mm] } — saved with the figure, never printed ──
  function startGuide(axis, idx, e) {
    const before = snap();
    const gd0 = D.page.guides || {};
    const gd = { x: (gd0.x || []).slice(), y: (gd0.y || []).slice() };
    D.page = { ...D.page, guides: gd };
    if (idx == null) { gd[axis].push(axis === 'x' ? toMm(e)[0] : toMm(e)[1]); idx = gd[axis].length - 1; }
    const [W, H] = pageDims(D.page), lim = axis === 'x' ? W : H;
    const mv = (ev) => {
      const p = toMm(ev); let v = axis === 'x' ? p[0] : p[1];
      if (!ev.altKey) { const g = D.page.grid; v = g && g.snap && g.size > 0 ? Math.round(v / g.size) * g.size : Math.round(v * 2) / 2; }
      gd[axis][idx] = v; drawOverlay(); drawRulers();
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const v = gd[axis][idx], gone = !(v >= 0 && v <= lim);
      if (gone) gd[axis].splice(idx, 1);
      if (!gd.x.length && !gd.y.length) { const p = { ...D.page }; delete p.guides; D.page = p; }
      hist.push(before); fut.length = 0; changed();
      say(gone ? 'guide removed' : `guide at ${+v.toFixed(1)} mm`);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  for (const [rc, ax] of [[rulerTop, 'y'], [rulerLeft, 'x']]) {
    rc.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); root.focus(); startGuide(ax, null, e); });
    rc.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [{ label: 'Clear guides', run: () => commit(() => { const p = { ...D.page }; delete p.guides; D.page = p; }) }, { label: 'Hide rulers', run: () => rulersBtn.onclick() }]);
    });
  }
  // the rulers: mm from the page's top-left, the selection's extent shaded
  function drawRulers() {
    rulerTop.style.display = rulerLeft.style.display = showRulers ? '' : 'none';
    if (!showRulers) return;
    const [W, H] = pageDims(D.page), T = 16;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const minor = zoom >= 6 ? 1 : zoom >= 2.5 ? 2 : 5, major = zoom >= 1.6 ? 10 : 50;
    const fs2 = sel.map((id) => frameById(D, id)).filter((f) => f && !f.hidden), sb = fs2.length ? boundsOf(fs2) : null;
    const one = (c2, horiz, total) => {
      const len = total * zoom;
      c2.width = Math.round((horiz ? len : T) * dpr); c2.height = Math.round((horiz ? T : len) * dpr);
      c2.style.width = (horiz ? len : T) + 'px'; c2.style.height = (horiz ? T : len) + 'px';
      const g = c2.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#e7e8eb'; g.fillRect(0, 0, horiz ? len : T, horiz ? T : len);
      if (sb) { const k = horiz ? 0 : 1; g.fillStyle = 'rgba(60,130,230,0.28)'; if (horiz) g.fillRect(sb[0] * zoom, 0, sb[2] * zoom, T); else g.fillRect(0, sb[1] * zoom, T, sb[3] * zoom); }
      g.strokeStyle = '#6b6f76'; g.fillStyle = '#4a4e55'; g.lineWidth = 1; g.font = '9px system-ui, sans-serif';
      g.beginPath();
      for (let mm = 0; mm <= total + 1e-9; mm += minor) {
        const px = Math.round(mm * zoom) + 0.5, isMaj = mm % major === 0, isMid = mm % 5 === 0;
        const L = isMaj ? T * 0.6 : isMid ? T * 0.38 : T * 0.22;
        if (horiz) { g.moveTo(px, T); g.lineTo(px, T - L); } else { g.moveTo(T, px); g.lineTo(T - L, px); }
        if (isMaj && mm > 0) {
          if (horiz) g.fillText(String(mm), px + 2, 9);
          else { g.save(); g.translate(9, px - 2); g.rotate(-Math.PI / 2); g.fillText(String(mm), 0, 0); g.restore(); }
        }
      }
      g.stroke();
      const gd = D.page.guides || {};                      // the guides, marked on their ruler
      g.fillStyle = '#12a4c4';
      for (const v of (horiz ? gd.x : gd.y) || []) { const px = v * zoom; if (horiz) g.fillRect(px - 1, T - 5, 2, 5); else g.fillRect(T - 5, px - 1, 5, 2); }
    };
    one(rulerTop, true, W); one(rulerLeft, false, H);
  }
  // ── the item list: every frame, front first; groups as folders ──
  // a host's badge for a frame: opts.frameBadge(f) → null | 'text' | { text, title }
  // compo's own: content that didn't fit its box (a kind sets frame._overflow while drawing — text, labels,
  // legends, tables). A host's badge wins; the overflow one says what was cut and offers nothing silently.
  function badgeOf(f) {
    let b = null;
    if (opts.frameBadge) { try { const x = opts.frameBadge(f); b = !x ? null : typeof x === 'string' ? { text: x } : x; } catch { b = null; } }
    if (!b && f._overflow) b = { text: 'doesn’t fit', title: `${f._overflow} — make the frame bigger, or the text smaller (Fit to content in its panel)` };
    return b;
  }
  // a label: at the host's point (opts.labelPoint(view) → [x,y,z]) or the middle of the view, beside it.
  // Any frame it can pin to: a 3D view (a world point) or a stereonet (a direction) — see kinds.js PINS
  function addLabel() {
    const sv = sel.length === 1 ? frameById(D, sel[0]) : null;
    const v = (sv && canPin(sv)) ? sv : D.frames.find((x) => canPin(x) && !x.hidden);
    if (!v) { say('a label points at something in a 3D view or on a stereonet — add one first'); return; }
    // the host's point: [x, y, z], or { at, text } to suggest the words too (wuffle: a selected plane's attitude)
    let at = opts.labelPoint ? opts.labelPoint(v) : null, text = 'label';
    if (at && !Array.isArray(at)) { if (at.text) text = String(at.text); at = at.at || null; }
    if (!at) at = pageToPin(v, v.box[0] + v.box[2] / 2, v.box[1] + v.box[3] / 2);
    if (!at) { say('could not find a point in that frame to pin the label to'); return; }
    const box = [v.box[0] + v.box[2] * 0.62, v.box[1] + v.box[3] * 0.12, 30, 7];
    add({ kind: 'label', box, content: { text, at: at.map((n) => +(+n).toFixed(hasProj(v) ? 3 : 6)), of: v.id } });   // a direction keeps 6 places
  }
  // a rename → true; refused (and said why) → false
  function doRename(f, raw) {
    const v = sanitizeId(raw), old = f.id;
    if (v === old) return true;
    const probe = { frames: D.frames.map((x) => ({ id: x.id })) }, why = renameFrame(probe, old, v);
    if (why) { say(why); return false; }
    commit(() => { renameFrame(D, old, v); sel = sel.map((id) => (id === old ? v : id)); });
    return true;
  }
  function frameLabel(f) {
    const k = kindOf(f.kind), c = f.content || {}, src = f.source || {};
    if (k && k.describe) { try { const d = k.describe(f); if (d) return d; } catch { /* fall through */ } }
    if (f.kind === 'text') { const t = String(c.md || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); return t ? `text · ${t.length > 30 ? t.slice(0, 30) + '…' : t}` : (f.style && f.style.background ? 'rule' : 'text (empty)'); }
    if (f.kind === 'image') return src.kind === 'view' ? '3D view' : src.kind === 'plot' ? `plot · ${src.name || ''}` : 'image';
    if (f.kind === 'legend') return `legend${c.title ? ' · ' + c.title : ''}`;
    if (f.kind === 'table') return `table${c.title ? ' · ' + c.title : (src.name ? ' · ' + src.name : '')}`;
    if (f.kind === 'drawlist') return 'chart';
    if (f.kind === 'titleblock') return `title block · ${(c.rows || []).length} rows`;
    return (k && k.label) || f.kind;
  }
  let _dragItem = null, _keepItems = false;
  // a selection change re-marks the rows without rebuilding them (a rebuild between the two clicks
  // of a double-click would swallow it)
  function refreshItemSel() {
    for (const r of items.querySelectorAll('.compo-it')) {
      const it = r.dataset.item, ids = it.startsWith('g:') ? D.frames.filter((x) => x.group === it.slice(2)).map((x) => x.id) : [it];
      r.classList.toggle('sel', ids.length > 0 && ids.every((id) => sel.includes(id)));
    }
  }
  function buildItems() {
    items.replaceChildren();
    items.append(h('div', { className: 'ttl' }, h('span', { textContent: `frames · ${D.frames.length}` }), h('span', { textContent: 'front ↑' })));
    let lastG = null;
    for (const f of [...D.frames].reverse()) {
      if (f.group && f.group !== lastG) items.append(itemRow(null, f.group, D.frames.filter((x) => x.group === f.group)));
      lastG = f.group || null;
      items.append(itemRow(f));
    }
  }
  function itemRow(f, group, members) {
    const fs2 = f ? [f] : members, ids = fs2.map((x) => x.id);
    const hidden = fs2.every((x) => x.hidden), locked = fs2.every((x) => x.locked), isSel = ids.every((id) => sel.includes(id));
    const row = h('div', { className: 'compo-it' + (group ? ' grp' : '') + (f && f.group ? ' mem' : '') + (isSel ? ' sel' : '') + (hidden ? ' hid' : ''), draggable: true });
    row.dataset.item = f ? f.id : 'g:' + group;
    const eye = h('button', { textContent: hidden ? '◌' : '◉', title: hidden ? 'show' : 'hide (not drawn, not printed)', onclick: (e) => { e.stopPropagation(); commit(() => { for (const x of fs2) { if (hidden) delete x.hidden; else x.hidden = true; } }); } });
    const lk = h('button', { textContent: locked ? '🔒' : '🔓', title: locked ? 'unlock' : 'lock', style: locked ? '' : 'opacity:0.35', onclick: (e) => { e.stopPropagation(); commit(() => { for (const x of fs2) { if (locked) delete x.locked; else x.locked = true; } }); } });
    const nm = h('span', { className: 'nm' }, ...(group ? [`group · ${members.length}`] : [h('b', { className: 'id', textContent: f.id }), h('span', { className: 'ds', textContent: frameLabel(f) })]));
    row.append(eye, lk, nm);
    if (f) { const bdg = badgeOf(f); if (bdg) row.append(h('span', { className: 'warn', textContent: '⚠', title: bdg.title || bdg.text })); }
    row.onclick = (e) => {
      if (e.shiftKey) sel = isSel ? sel.filter((id) => !ids.includes(id)) : sel.concat(ids.filter((id) => !sel.includes(id)));
      else sel = ids.slice();                                // a member row selects just that member (edit inside a group)
      _keepItems = true; try { render(); } finally { _keepItems = false; } root.focus();
    };
    nm.ondblclick = (e) => {
      if (!f) return;
      e.stopPropagation();
      const inp = h('input', { value: f.id, spellcheck: false }); inp.title = 'the id (letters, digits, - _ .)';
      nm.replaceChildren(inp); inp.focus(); inp.select();
      const done = (keep) => { if (!inp.isConnected) return; const v = inp.value.trim(); if (!(keep && v && v !== f.id && doRename(f, v))) render(); };
      inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    };
    row.ondragstart = (e) => { _dragItem = row.dataset.item; e.dataTransfer.setData('text/plain', _dragItem); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragend = () => { _dragItem = null; };
    const half = (e) => { const r = row.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
    row.ondragover = (e) => { if (!_dragItem || _dragItem === row.dataset.item) return; e.preventDefault(); const up = half(e); row.classList.toggle('drop-above', up); row.classList.toggle('drop-below', !up); };
    row.ondragleave = () => row.classList.remove('drop-above', 'drop-below');
    row.ondrop = (e) => {
      e.preventDefault(); row.classList.remove('drop-above', 'drop-below');
      const src = _dragItem; _dragItem = null; if (!src || src === row.dataset.item) return;
      const mv = src.startsWith('g:') ? D.frames.filter((x) => x.group === src.slice(2)).map((x) => x.id) : [src];
      const up = half(e);                                  // the list is front-first: above a row = in front of it
      const target = f ? f.id : (up ? members[members.length - 1].id : members[0].id);
      commit(() => moveInStack(D, mv, target, up));
    };
    return row;
  }
  // box select: drag on the empty page; frames wholly inside are selected (⇧ adds), groups whole
  let _marq = null;
  function startMarquee(e) {
    const p0 = toMm(e), base = e.shiftKey ? sel.slice() : [];
    let moved = false;
    const mv = (ev) => {
      const p = toMm(ev);
      if (!moved && Math.hypot(p[0] - p0[0], p[1] - p0[1]) * zoom < 3) return;
      moved = true;
      _marq = [Math.min(p0[0], p[0]), Math.min(p0[1], p[1]), Math.abs(p[0] - p0[0]), Math.abs(p[1] - p0[1])];
      const [x, y, w, hh] = _marq;
      const inside = D.frames.filter((f) => !f.hidden && f.box[0] >= x && f.box[1] >= y && f.box[0] + f.box[2] <= x + w && f.box[1] + f.box[3] <= y + hh).map((f) => f.id);
      sel = base.concat(expandGroups(D, inside).filter((id) => !base.includes(id)));
      drawOverlay(); syncBar();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); _marq = null; if (!moved) sel = base; render(); };
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
    if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); copyStyle(); return; }
    if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); pasteStyle(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = D.frames.filter((f) => !f.hidden).map((f) => f.id); render(); return; }   // not the hidden ones: a Delete after it would take frames you can't see
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? doUngroup() : doGroup(); return; }
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault(); if (!sel.length) return;
      const up2 = e.code === 'BracketRight';
      commit(() => (e.shiftKey ? (up2 ? bringToFront : sendToBack) : (up2 ? bringForward : sendBackward))(D, sel));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); del(); } return; }
    if (e.key === 'Escape') { sel = []; render(); return; }
    const step = e.shiftKey ? 5 : 0.5, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && sel.length) {
      e.preventDefault();
      const move = () => { for (const id of sel) { const f = frameById(D, id); if (!f.locked) { f.box[0] += dir[0] * step; f.box[1] += dir[1] * step; } } };
      // a run of nudges (the same frames, no pause over a second) is ONE undo step — ⌘Z takes the run back, not 0.5 mm
      const key = sel.join(','), now = Date.now();
      if (_nudge && _nudge.key === key && now - _nudge.t < 1000 && hist.length) { move(); _nudge.t = now; changed(); }
      else { commit(move); _nudge = { key, t: now }; }
    }
  });

  // ── inspector panels ──
  const row = (label, ...ctl) => h('div', { className: 'row' }, h('span', { textContent: label }), h('span', { className: 'ctl' }, ...ctl));
  const numIn = (value, attrs = {}) => h('input', { type: 'number', value: value ?? '', style: 'width:64px', ...attrs });
  const selIn = (opts2, value, title = '') => { const s = h('select', { title }, ...opts2.map(([v, t]) => h('option', { value: v, textContent: t }))); s.value = value; return s; };
  const setC = (f, k, v) => commit(() => { f.content = { ...(f.content || {}) }; if (v == null || v === '' || v === false) delete f.content[k]; else f.content[k] = v; });
  function pagePanel() {
    const pg = D.page, m = pg.margins || [10, 10, 10, 10];
    insp.append(h('div', { textContent: 'page', style: 'font-weight:bold' }));
    const mIn = ['top', 'right', 'bottom', 'left'].map((t, i) => { const x = numIn(m[i], { min: 0, max: 60, step: 1, title: `${t} margin (mm)`, style: 'width:48px' });
      x.onchange = () => commit(() => { const mm = [...(D.page.margins || [10, 10, 10, 10])]; mm[i] = Math.max(0, +x.value || 0); D.page.margins = mm; }); return x; });
    insp.append(row('margins', ...mIn.map((x, i) => h('span', { className: 'pair' }, h('i', { textContent: '↑→↓←'[i] }), x))));
    const bgOn = h('input', { type: 'checkbox', checked: !!pg.background && pg.background !== '#ffffff', title: 'a paper colour other than white' });
    const bgC = h('input', { type: 'color', value: toHex(pg.background, '#ffffff') });
    bgOn.onchange = () => commit(() => { if (bgOn.checked) D.page.background = bgC.value; else delete D.page.background; });
    bgC.onchange = () => { if (bgOn.checked) commit(() => { D.page.background = bgC.value; }); };
    insp.append(row('paper', bgOn, bgC));
    const fnt = selIn([['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']], pg.font || 'sans', 'the typeface of every text that names none');
    fnt.onchange = () => commit(() => { if (fnt.value === 'sans') delete D.page.font; else D.page.font = fnt.value; });
    insp.append(row('typeface', fnt));
  }
  function multiPanel() {
    const fs = sel.map((id) => frameById(D, id)).filter(Boolean);
    const bd = h('input', { type: 'checkbox', checked: fs.every((f) => f.style && f.style.border) });
    bd.indeterminate = !bd.checked && fs.some((f) => f.style && f.style.border);
    bd.onchange = () => commit(() => { for (const f of fs) { f.style = { ...(f.style || {}) }; if (bd.checked) f.style.border = true; else delete f.style.border; } });
    insp.append(row('border', bd));
    const texts = fs.filter((f) => f.kind === 'text' || f.kind === 'label');
    if (texts.length === fs.length) {                       // all text: the type, together
      const sizes = new Set(texts.map((f) => +f.content.size || (f.kind === 'label' ? 7 : 9)));
      const sz = numIn(sizes.size === 1 ? [...sizes][0] : '', { min: 4, max: 72, step: 0.5, placeholder: 'mixed' });
      sz.onchange = () => commit(() => { for (const f of texts) f.content.size = +sz.value || f.content.size; });
      const col = h('input', { type: 'color', value: toHex(texts[0].content.color), title: 'text colour, all of them' });
      col.onchange = () => commit(() => { for (const f of texts) f.content.color = col.value; });
      const fnt = selIn([['', '— as they are'], ['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']], '', 'their typeface');
      fnt.onchange = () => { if (fnt.value) commit(() => { for (const f of texts) { f.content.font = fnt.value; delete f.content.mono; } }); };
      insp.append(row('size (pt)', sz, col), row('typeface', fnt));
    }
    insp.append(h('div', { className: 'hint', textContent: '⌘C / ⌘V copy and paste frames (between figures too) · ⌘⌥C / ⌘⌥V copy one frame’s style onto others' }));
  }
  function tablePanel(f) {
    const c = f.content || {};
    const ti = h('input', { value: c.title || '', placeholder: 'title (fields work)' }); ti.onchange = () => setC(f, 'title', ti.value);
    const no = h('input', { value: c.note || '', placeholder: 'a note under it (source, units…)' }); no.onchange = () => setC(f, 'note', no.value);
    const sz = numIn(c.size || 7.5, { min: 4.5, max: 14, step: 0.5, title: 'type size (pt) — it shrinks to fit the width' }); sz.onchange = () => setC(f, 'size', +sz.value || null);
    const zb = h('input', { type: 'checkbox', checked: c.zebra !== false, title: 'light stripes on alternate rows' }); zb.onchange = () => commit(() => { f.content = { ...c, zebra: zb.checked }; });
    const dc = numIn(c.decimals ?? '', { min: 0, max: 8, step: 1, placeholder: 'as is', title: 'every number to this many decimal places (empty: as it came)' }); dc.onchange = () => setC(f, 'decimals', dc.value === '' ? null : Math.max(0, Math.min(8, Math.round(+dc.value))));
    const fit = h('button', { textContent: 'Fit height', title: 'make the frame as tall as all its rows' });
    fit.onclick = () => commit(() => { const lh = (+c.size || 7.5) * 0.3528 * 1.55; f.box[3] = +(0.3 + (c.title ? lh * 1.15 : 0) + lh * (1 + (c.rows || []).length) + (c.note ? lh : 0) + 1.2).toFixed(1); });
    insp.append(row('title', ti), row('note', no), row('size (pt)', sz, zb, h('span', { textContent: 'stripes' })), row('decimals', dc, fit));
    const cols = (c.columns || []).slice(0, 12);
    if (cols.length) {
      const al = cols.map((name, j) => { const s = selIn([['', 'auto'], ['l', 'left'], ['c', 'centre'], ['r', 'right']], (c.align && c.align[j]) || '', `column “${name}”`);
        s.onchange = () => commit(() => { const a = [...(f.content.align || [])]; while (a.length < cols.length) a.push(''); a[j] = s.value; f.content = { ...f.content, align: a.some(Boolean) ? a : undefined }; if (!f.content.align) delete f.content.align; }); return h('span', { className: 'pair', title: name }, h('i', { textContent: String(name).slice(0, 6) }), s); });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'align' }), h('span', { className: 'ctl', style: 'flex-wrap:wrap' }, ...al)));
    }
  }
  function scalebarPanel(f) {
    const c = f.content || {};
    const ln = numIn(c.length ?? '', { min: 0, step: 'any', placeholder: 'auto', title: 'the bar’s length in the view’s units (empty: the roundest that fits)' }); ln.onchange = () => setC(f, 'length', +ln.value > 0 ? +ln.value : null);
    const sg = numIn(c.segments || 4, { min: 1, max: 10, step: 1, title: 'divisions' }); sg.onchange = () => setC(f, 'segments', Math.max(1, Math.min(10, Math.round(+sg.value || 4))));
    const st = selIn([['alternating', 'alternating'], ['line', 'line'], ['ticks', 'ticks, each labelled']], c.style || 'alternating'); st.onchange = () => setC(f, 'style', st.value === 'alternating' ? null : st.value);
    const ra = h('input', { type: 'checkbox', checked: !!c.ratio, title: 'the representative fraction under it (1 : 2 500) — a view in metres' }); ra.onchange = () => setC(f, 'ratio', ra.checked);
    insp.append(row('length', ln, sg, h('span', { textContent: 'parts' })), row('style', st, ra, h('span', { textContent: '1 : N' })));
  }
  function northPanel(f) {
    const st = selIn([['arrow', 'arrow'], ['needle', 'needle'], ['star', 'compass star'], ['line', 'line']], (f.content && f.content.style) || 'arrow');
    st.onchange = () => setC(f, 'style', st.value === 'arrow' ? null : st.value);
    insp.append(row('style', st));
  }
  function shapePanel(f) {
    const c = f.content || {}, kind = c.shape || 'rect';
    const sh = selIn([['rect', 'rectangle'], ['ellipse', 'ellipse'], ['line', 'line'], ['arrow', 'arrow']], kind); sh.onchange = () => setC(f, 'shape', sh.value);
    const sOn = h('input', { type: 'checkbox', checked: c.stroke !== '', title: 'an outline' });
    const sC = h('input', { type: 'color', value: toHex(c.stroke) }); const sW = numIn(c.width || 0.35, { min: 0.05, max: 5, step: 0.05, title: 'line width (mm)' });
    sOn.onchange = () => commit(() => { f.content = { ...f.content }; if (sOn.checked) { if (f.content.stroke === '') delete f.content.stroke; } else f.content.stroke = ''; });
    sC.onchange = () => setC(f, 'stroke', sC.value); sW.onchange = () => setC(f, 'width', +sW.value || null);
    const dsh = h('input', { type: 'checkbox', checked: !!c.dash, title: 'dashed' }); dsh.onchange = () => setC(f, 'dash', dsh.checked);
    insp.append(row('shape', sh), row('line', sOn, sC, sW, dsh, h('span', { textContent: 'dashed' })));
    if (kind === 'rect' || kind === 'ellipse') {
      const fOn = h('input', { type: 'checkbox', checked: !!c.fill }); const fC = h('input', { type: 'color', value: toHex(c.fill, '#f2e7c9') });
      fOn.onchange = () => setC(f, 'fill', fOn.checked ? fC.value : null); fC.onchange = () => { if (fOn.checked) setC(f, 'fill', fC.value); };
      const parts = [fOn, fC];
      if (kind === 'rect') { const rr = numIn(c.radius || 0, { min: 0, max: 30, step: 0.5, title: 'rounded corners (mm)' }); rr.onchange = () => setC(f, 'radius', +rr.value || null); parts.push(h('span', { className: 'pair' }, h('i', { textContent: '◜' }), rr)); }
      insp.append(row('fill', ...parts));
    } else {
      const dr = selIn([['h', '→ across'], ['v', '↓ down'], ['down', '↘ diagonal'], ['up', '↗ diagonal']], c.dir || 'h', 'the way across its frame (the frame’s corners are its ends)'); dr.onchange = () => setC(f, 'dir', dr.value === 'h' ? null : dr.value);
      const parts = [dr];
      if (kind === 'arrow') { const hd = selIn([['end', 'head at the end'], ['both', 'heads at both ends']], c.heads || 'end'); hd.onchange = () => setC(f, 'heads', hd.value === 'end' ? null : hd.value); parts.push(hd); }
      insp.append(row('way', ...parts));
    }
  }
  function qrPanel(f) {
    const c = f.content || {};
    const tx = h('input', { value: c.text || '', placeholder: 'https://… or any text', spellcheck: false });
    const ec = selIn([['L', 'L — 7 %'], ['M', 'M — 15 %'], ['Q', 'Q — 25 %'], ['H', 'H — 30 %']], c.ecc || 'M', 'error correction: how much of it can be damaged and still read');
    const cap = h('input', { type: 'checkbox', checked: !!c.caption, title: 'the text under the code' });
    const apply = (patch) => { try { const next = qrContent({ ...f.content, ...patch }); commit(() => { f.content = next; if (!next.caption) delete f.content.caption; }); } catch (e) { say(e.message); } };
    tx.onchange = () => apply({ text: tx.value.trim() }); ec.onchange = () => apply({ ecc: ec.value }); cap.onchange = () => commit(() => { f.content = { ...f.content, caption: cap.checked }; });
    tx.disabled = ec.disabled = !hasQrEncoder();
    insp.append(row('text', tx), row('level', ec, cap, h('span', { textContent: 'caption' })));
    if (!hasQrEncoder()) insp.append(h('div', { className: 'hint', textContent: 'this app can print QR codes but not make new ones' }));
  }
  function addQr() {
    if (!hasQrEncoder()) { say('this app can’t make QR codes'); return; }
    const f = add({ kind: 'qr', box: freeSpot(D, 28, 28), content: { ecc: 'M' } });
    requestAnimationFrame(() => { const t = side.querySelector('input[placeholder^="https"]'); if (t) t.focus(); });
    return f;
  }

  // ── copy / paste: frames (as JSON on the clipboard, so another figure — in this app or the other — takes them) and
  // a frame's STYLE (its border and fill, its type) onto others ──
  const CLIP = 'compo-frames/1\n';
  const STYLE_KEYS = ['size', 'font', 'color', 'align', 'valign', 'lineHeight', 'pad', 'backing', 'leader', 'stroke', 'width', 'dash', 'fill', 'radius'];
  let styleClip = null;
  function copyFrames() {
    const fs = sel.map((id) => frameById(D, id)).filter(Boolean); if (!fs.length) return null;
    return CLIP + serializeDocument({ frames: fs.map((f) => ({ ...f })) });
  }
  function pasteFrames(text) {
    if (!String(text).startsWith(CLIP)) return false;
    let data; try { data = JSON.parse(String(text).slice(CLIP.length)); } catch { return false; }
    const fr = (data.frames || []).filter((f) => f && f.kind && f.box), unknown = fr.filter((f) => !kindOf(f.kind)).map((f) => f.kind);
    const made = [];
    commit(() => {
      const groups = new Map();
      for (const c of fr) {
        if (!kindOf(c.kind)) continue;
        const ownId = !frameById(D, c.id);                 // from another figure: its id may stay; here: a fresh one
        const box = [...c.box]; if (!ownId) { box[0] += 5; box[1] += 5; }
        const g = c.group; const nf = addFrame(D, { ...c, box, id: ownId ? c.id : undefined, group: undefined });
        if (g) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(nf.id); }
        made.push(nf);
      }
      for (const ids of groups.values()) if (ids.length > 1) groupFrames(D, ids);
    });
    sel = made.map((f) => f.id); render();
    ensureImages(D).then(() => renderCanvas(), () => {});
    say(`${made.length} frame${made.length === 1 ? '' : 's'} pasted${unknown.length ? ` — ${unknown.length} left out (${[...new Set(unknown)].join(', ')}: not something this app draws)` : ''}`);
    return true;
  }
  root.addEventListener('copy', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = copyFrames(); if (!t) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', t); say(`${sel.length} frame${sel.length === 1 ? '' : 's'} copied`);
  });
  root.addEventListener('cut', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = copyFrames(); if (!t) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', t); del();
  });
  root.addEventListener('paste', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (t && pasteFrames(t)) e.preventDefault();
  });
  function copyStyle() {
    const f = frameById(D, sel[0]); if (!f) return;
    const c = f.content || {}, content = {}; for (const k of STYLE_KEYS) if (c[k] !== undefined) content[k] = c[k];
    styleClip = { style: { ...(f.style || {}) }, content, from: f.kind };
    say(`style copied from ${f.id} — ⌘⌥V puts it on the selected frames`);
  }
  function pasteStyle() {
    if (!styleClip || !sel.length) return;
    commit(() => {
      for (const id of sel) {
        const f = frameById(D, id); if (!f || f.locked) continue;
        f.style = { ...styleClip.style }; if (!Object.keys(f.style).length) delete f.style;
        f.content = { ...(f.content || {}) };
        for (const [k, v] of Object.entries(styleClip.content)) {
          // a shape's colours stay a shape's, a text's type a text's: only the keys that mean the same on both
          const shapeKey = ['stroke', 'width', 'dash', 'fill', 'radius'].includes(k);
          if (shapeKey === (f.kind === 'shape')) f.content[k] = v;
        }
      }
    });
    say(`style put on ${sel.length} frame${sel.length === 1 ? '' : 's'}`);
  }

  // ── actions ──
  function add(frame) { let f; commit(() => { f = addFrame(D, frame); }); sel = [f.id]; render(); return f; }
  function del() {
    const locked = sel.filter((id) => frameById(D, id).locked), go = sel.filter((id) => !locked.includes(id));
    if (go.length) commit(() => removeFrames(D, go));
    sel = locked; render();
    if (locked.length) say(`${locked.length} locked frame${locked.length === 1 ? '' : 's'} kept — unlock to delete`);
  }
  function doGroup() { if (unitsOf(D, sel).length < 2) return; commit(() => groupFrames(D, sel)); say('grouped — they select and move as one'); }
  function doUngroup() { if (!sel.some((id) => frameById(D, id).group)) return; commit(() => ungroupFrames(D, sel)); say('ungrouped'); }
  function dup() {
    if (!sel.length) return;
    const made = [];
    commit(() => {
      for (const id of sel) {
        const f = frameById(D, id), c = JSON.parse(serializeDocument({ frames: [f] })).frames[0];
        c.box[0] += 5; c.box[1] += 5; if (f._img) c._img = f._img;
        const g = c.group; delete c.group;
        const nf = addFrame(D, { ...c, id: undefined }); nf._from = g; if (c.locked) nf.locked = true;
        if (f._img) nf._img = f._img;
        made.push(nf);
      }
      // copies of a group are a NEW group
      for (const g of new Set(made.map((m) => m._from).filter(Boolean))) groupFrames(D, made.filter((m) => m._from === g).map((m) => m.id));
      for (const m of made) delete m._from;
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
  renameFrame,
  sanitizeId,
  ID_RE,
  idPrefix,
  removeFrames,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  alignFrames,
  distributeFrames,
  matchSize,
  groupFrames,
  ungroupFrames,
  expandGroups,
  unitsOf,
  boundsOf,
  gatherGroup,
  pruneGroups,
  moveInStack,
  snapBox,
  snapResize,
  freeSpot,
  LOAD_MIGRATIONS,
  SANS,
  MONO,
  SERIF,
  fontMm,
  registerKind,
  kindOf,
  canPin,
  pinToPage,
  pageToPin,
  resolveFields,
  layoutText,
  drawText,
  refreshLegend,
  legendEntries,
  legendKey,
  LEGEND_USER_KEYS,
  replayDrawList,
  niceBelow,
  frameWorldPerMm,
  tableFromTsv,
  setQrEncoder,
  hasQrEncoder,
  qrContent,
  registerField,
  fieldList,
  formatNumber,
  formatDate,
  refFrame,
  subjectFrame,
  isFormatSpec,
  groupDigits,
  significant,
  fmtBearing,
  hasProj,
  isOrthoProj,
  imageRect,
  worldToPage,
  pageToWorld,
  worldTicks,
  drawTicks,
  niceStep,
  fmtCoord,
  planeTrace,
  drawOverlays,
  drawVector,
  renderPage,
  ensureImages,
  exportPDF,
  exportPNG,
  figureFromPdf,
  HOUSE_KEYS,
  FIGURE_KEYS,
  setTemplate,
  docFromTemplate,
  TITLE_BLOCK_ROWS,
  titleBlockFrame,
  titleBlockFrames,
  migrateTitleBlocks,
  addTitleBlock,
  addImageSrc,
  addImageFromFile,
  readImageFile,
  multiplesGrid,
  smallMultiples,
  mountEditor,
  ICONS,
  iconSvg,
  iconButton,
};
