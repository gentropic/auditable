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
const PREFIX = { image: 'image', text: 'text', legend: 'legend', scalebar: 'scale', north: 'north', table: 'table', drawlist: 'chart' };
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
}

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
const PT = 25.4 / 72;                                      // mm per point
const INK = '#1a1a1a';
const fontMm = (pt, { mono = false, bold = false } = {}) => `${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : SANS}`;

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
const group = (intStr, sep) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
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
  return (v < 0 ? '−' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fp ? '.' + fp : '');
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
    ctx.save();
    ctx.translate(t.x + inward[0] * (tl + 0.4), t.y + inward[1] * (tl + 0.4));
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
  for (const Ly of V.layers || []) {
    if (Ly.type !== 'cells') continue;
    const ax = Ly.axis, R = Ly.rects, C = Ly.colors, P = Ly.palette, pt = [0, 0, 0];
    pt[ax.w] = +Ly.position;
    const page = (u, v) => { pt[ax.u] = u; pt[ax.v] = v; return worldToPage(frame, pt); };
    for (let i = 0; i < C.length; i++) {
      const a = page(R[i * 4], R[i * 4 + 1]), b = page(R[i * 4 + 2], R[i * 4 + 3]);
      if (!a || !b) continue;
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
      ctx.fillStyle = P[C[i]]; ctx.strokeStyle = P[C[i]]; ctx.lineWidth = 0.04;   // a hairline of the same colour closes the seams viewers anti-alias between cells
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill(); ctx.stroke();
    }
  }
  if (frame._vimg) ctx.drawImage(frame._vimg, x, y, w, h);
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
// to where content.at lands in the view it refers to (content.of, else the nearest view with a
// projection) — so the label follows its point when the view is rendered again. ──
registerKind('label', {
  label: 'label',
  overflow: true,                                          // the leader leaves the box: not clipped to it
  draw(ctx, box, frame, env) {
    const c = frame.content || {}, size = +c.size || 7, pad = 0.8;
    const text = resolveFields(c.text != null ? c.text : (c.md || ''), env, frame);
    let anc = null, off = false;
    if (Array.isArray(c.at) && c.at.length === 3 && env.doc) {
      const v = subjectFrame(env, frame, hasProj);
      if (v && hasProj(v)) {
        const p = worldToPage(v, c.at.map(Number));
        if (p && p.inside) anc = p;
        else if (p) {
          // the point is outside the picture: the leader stops at the picture's edge, toward it, with an arrowhead
          const r = imageRect(v), cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2, dx = p.x - cx, dy = p.y - cy;
          let t = 1;
          for (const [d, lo, hi, o] of [[dx, r[0], r[0] + r[2], cx], [dy, r[1], r[1] + r[3], cy]]) if (d) { const tt = ((d > 0 ? hi : lo) - o) / d; if (tt > 0) t = Math.min(t, tt); }
          if (t > 0 && t < 1) { anc = { x: cx + dx * t, y: cy + dy * t }; off = true; }
        }
      }
    }
    if (off) {
      const a = Math.atan2(anc.y - (box[1] + box[3] / 2), anc.x - (box[0] + box[2] / 2)), L = 1.6;
      ctx.fillStyle = c.color || INK; ctx.beginPath();
      ctx.moveTo(anc.x, anc.y); ctx.lineTo(anc.x - L * Math.cos(a - 0.4), anc.y - L * Math.sin(a - 0.4)); ctx.lineTo(anc.x - L * Math.cos(a + 0.4), anc.y - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
    }
    if (anc && !(anc.x >= box[0] && anc.x <= box[0] + box[2] && anc.y >= box[1] && anc.y <= box[1] + box[3])) {
      const ex = Math.max(box[0], Math.min(box[0] + box[2], anc.x)), ey = Math.max(box[1], Math.min(box[1] + box[3], anc.y));
      ctx.strokeStyle = c.color || INK; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(anc.x, anc.y); ctx.stroke();
    }
    if (anc && !off) { ctx.fillStyle = c.color || INK; ctx.beginPath(); ctx.arc(anc.x, anc.y, 0.55, 0, Math.PI * 2); ctx.fill(); }
    ctx.save();
    ctx.beginPath(); ctx.rect(box[0], box[1], box[2], box[3]); ctx.clip();
    if (c.backing !== false) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(box[0], box[1], box[2], box[3]); }
    const { lines, lineHeight } = layoutText(ctx, text, box[2] - 2 * pad, { size });
    ctx.fillStyle = c.color || INK; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    let y = box[1] + pad;
    for (const line of lines) {
      let x = box[0] + pad;
      for (const w of line) { ctx.font = fontMm(size, { bold: w.b }); ctx.fillText(w.t, x, y); x += w.w; }
      y += lineHeight;
    }
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
registerKind('legend', {
  label: 'legend',
  draw(ctx, box, frame, env) {
    const c = frame.content || {};
    const title = c.title ? resolveFields(c.title, env, frame) : '';
    const size = +c.size || 8, row = size * PT * 1.55, sw = size * PT * 1.1;
    let y = box[1] + 0.5;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = INK;
    if (title) { ctx.font = fontMm(size + 1, { bold: true }); ctx.fillText(title, box[0] + 0.5, y); y += row * 1.1; }
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
    if (shown < rows.length) { ctx.fillStyle = '#666'; ctx.font = fontMm(size); ctx.textAlign = 'left'; ctx.fillText(`… ${rows.length - shown} more row${rows.length - shown === 1 ? '' : 's'}`, x0 + pad, y + lh / 2); y += lh; }
    rule(y, 0.35);
    if (note) { ctx.fillStyle = '#555'; ctx.font = fontMm(size - 0.5); ctx.textAlign = 'left'; ctx.fillText(note, x0, y + lh * 0.55); }
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
.compo-fr.locked::after { content: 'locked'; position: absolute; right: 1px; top: 1px; font: 9px/1 system-ui, sans-serif; padding: 1px 3px; background: rgba(40,40,40,0.75); color: #fff; border-radius: 2px; pointer-events: none; }
.compo-grp { position: absolute; border: 1px dashed #3c82e6; pointer-events: none; box-sizing: border-box; }
.compo-marq { position: absolute; border: 1px solid #3c82e6; background: rgba(60,130,230,0.12); pointer-events: none; }
.compo-badge { position: absolute; left: 1px; top: 1px; font: 9px/1.2 system-ui, sans-serif; padding: 1px 4px; background: #c98a00; color: #111; border-radius: 2px; pointer-events: auto; cursor: help; max-width: calc(100% - 6px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
.compo-it .warn { color: #c98a00; margin-left: 4px; cursor: help; }
.compo-link { position: absolute; height: 0; border-top: 1px dashed #3c82e6; transform-origin: 0 0; pointer-events: none; z-index: 2; }
.compo-fr.ref { outline: 1px dashed #3c82e6; outline-offset: 2px; }
.compo-it .nm .ds { color: var(--compo-dim, var(--dim, #9a9a9a)); margin-left: 6px; font-weight: normal; }
.compo-side input.compo-id { width: 120px; font-family: var(--compo-mono, monospace); }
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
const canRefer = (f) => f.kind === 'text' || f.kind === 'scalebar' || f.kind === 'north' || f.kind === 'label';
const isReferable = (f) => !!(f.content && f.content.meta);
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
  const gridSel = h('select', { title: 'grid — shown and snapped to' });
  for (const [v, t] of [['0', 'no grid'], ['1', 'grid 1 mm'], ['2', 'grid 2 mm'], ['5', 'grid 5 mm'], ['10', 'grid 10 mm']]) gridSel.append(h('option', { value: v, textContent: t }));
  gridSel.onchange = () => commit(() => { const v = +gridSel.value; const p = { ...D.page }; if (v) p.grid = { size: v, show: true, snap: true }; else delete p.grid; D.page = p; });
  const rulersBtn = btn('rulers', 'show / hide the rulers (drag a guide out of a ruler; drag it back to remove it)', () => { showRulers = !showRulers; try { localStorage.setItem('compo.rulers', showRulers ? 'on' : 'off'); } catch { /* private */ } render(); });
  const alignBtns = [['⇤', 'left'], ['⇹', 'hcenter'], ['⇥', 'right'], ['⤒', 'top'], ['⇳', 'vcenter'], ['⤓', 'bottom']].map(([l, how]) => btn(l, `align ${how}`, () => commit(() => alignFrames(D, sel, how))));
  const distBtns = [['↔', 'h'], ['↕', 'v']].map(([l, ax]) => btn(l, ax === 'h' ? 'distribute horizontally' : 'distribute vertically', () => commit(() => distributeFrames(D, sel, ax))));
  const sizeBtns = [['W=', 'w', 'same width as the first selected'], ['H=', 'h', 'same height as the first selected'], ['▣=', 'both', 'same size as the first selected']].map(([l, what, t]) => btn(l, t, () => commit(() => matchSize(D, sel, what))));
  const groupBtn = btn('group', 'group the selected frames (⌘G) — they select and move as one', () => doGroup());
  const ungroupBtn = btn('ungroup', 'ungroup (⌘⇧G)', () => doUngroup());
  const frontBtn = btn('front', 'bring to front (⌘⇧])', () => commit(() => bringToFront(D, sel)));
  const fwdBtn = btn('↑', 'bring forward one step (⌘])', () => commit(() => bringForward(D, sel)));
  const bwdBtn = btn('↓', 'send backward one step (⌘[)', () => commit(() => sendBackward(D, sel)));
  const backBtn = btn('back', 'send to back (⌘⇧[)', () => commit(() => sendToBack(D, sel)));
  const delBtn = btn('delete', 'delete the selected frames (locked ones stay)', () => del());
  const status = h('span', { className: 'status' });
  let _stT = 0;
  const say = (msg) => { status.textContent = msg; clearTimeout(_stT); _stT = setTimeout(() => { status.textContent = ''; }, 4000); if (opts.onStatus) opts.onStatus(msg); };
  bar.append(sizeSel, oriSel, customSpan, h('span', { className: 'sep' }), zoomSel, gridSel, rulersBtn, h('span', { className: 'sep' }),
    btn('+ label', 'a label pinned to a world point in a 3D view (the host may supply the point)', () => addLabel()),
    btn('+ text', 'add a text frame (fields: {fig} {page} {date} ${…})', () => add({ kind: 'text', content: { md: '**Figure {fig}.** caption', size: 9 } })),
    h('span', { className: 'sep' }), ...alignBtns, ...distBtns, ...sizeBtns, h('span', { className: 'sep' }), groupBtn, ungroupBtn, h('span', { className: 'sep' }), frontBtn, fwdBtn, bwdBtn, backBtn, delBtn);
  if (opts.toolbar && opts.toolbar.length) {
    bar.append(h('span', { className: 'sep' }));
    for (const t of opts.toolbar) bar.append(btn(t.label, t.title || '', () => t.run(api)));
  }
  bar.append(status);

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
    rulersBtn.style.opacity = showRulers ? '1' : '0.55';
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
      if (sel.length) {
        const nu = unitsOf(D, sel).length, locked = sel.filter((id) => frameById(D, id).locked).length;
        insp.append(h('div', { className: 'hint', textContent: `${sel.length} frames${nu < sel.length ? ` in ${nu} unit${nu === 1 ? '' : 's'} (groups move as one)` : ''} — align / distribute / match size from the toolbar; the FIRST selected is the size key` }));
        const lk = h('input', { type: 'checkbox', checked: locked === sel.length });
        lk.indeterminate = locked > 0 && locked < sel.length;
        lk.onchange = () => commit(() => { for (const id of sel) frameById(D, id).locked = lk.checked; });
        insp.append(h('label', { className: 'row' }, h('span', { textContent: 'locked' }), lk));
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
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'id' }), idIn));
    if (canRefer(f)) {
      // refers to: the nearest view (the default — it says which), or a fixed one
      const near = refFrame(D, f, null, isReferable), cands = D.frames.filter((x) => x !== f && isReferable(x));
      const rs = h('select', { title: 'the frame this one is about: its fields ({scale} {section} …), or the view a scale bar / north arrow measures' },
        h('option', { value: '', textContent: near ? `nearest → ${near.id}` : 'nearest (none yet)' }),
        ...cands.map((x) => h('option', { value: x.id, textContent: x.id })));
      rs.value = (f.content && f.content.of) || '';
      rs.onchange = () => commit(() => { f.content = { ...(f.content || {}) }; if (rs.value) f.content.of = rs.value; else delete f.content.of; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'refers to' }), rs));
    }
    const num = (label, i) => {
      const inp = h('input', { type: 'number', step: 0.5, value: +f.box[i].toFixed(1) });
      inp.onchange = () => commit(() => { const v = +inp.value; if (Number.isFinite(v)) f.box[i] = i >= 2 ? Math.max(2, v) : v; });
      return h('span', { style: 'display:inline-flex;gap:2px;align-items:center' }, label, inp);
    };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'position' }), num('x', 0), num('y', 1)));
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'size' }), num('w', 2), num('h', 3)));
    const bd = h('input', { type: 'checkbox', checked: !!(f.style && f.style.border) });
    bd.onchange = () => commit(() => { f.style = { ...(f.style || {}), border: bd.checked }; });
    insp.append(h('label', { className: 'row' }, h('span', { textContent: 'border' }), bd));
    const lk = h('input', { type: 'checkbox', checked: !!f.locked });
    lk.onchange = () => commit(() => { f.locked = lk.checked; });
    insp.append(h('label', { className: 'row', title: 'a locked frame won’t move, resize or delete' }, h('span', { textContent: 'locked' }), lk));
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
      const mono = h('input', { type: 'checkbox', checked: !!f.content.mono });
      mono.onchange = () => commit(() => { f.content.mono = mono.checked; });
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
      insp.append(ta, h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), size, align), h('label', { className: 'row' }, h('span', { textContent: 'monospace' }), mono),
        h('div', { className: 'row' }, h('span', { textContent: 'fields' }), fsel),
        h('div', { className: 'hint', textContent: '**bold** · {name} or {name:arg} · a number format at the end, {count:,} · ${expr:,.2f}' }));
      api._focusText = () => ta.focus();
    }
    if (f.kind === 'image') {
      const fit = h('select', {}, ...['contain', 'cover', 'fill'].map((v) => h('option', { value: v, textContent: v })));
      fit.value = f.content.fit || 'contain';
      fit.onchange = () => commit(() => { f.content.fit = fit.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'fit' }), fit));
      if (hasProj(f)) {                                     // a view of 3D space: coordinates on its border
        const tk = h('select', { className: 'compo-ticks', title: 'coordinate ticks on the border (orthographic views), or a grid across' }, ...['off', 'ticks', 'grid'].map((v) => h('option', { value: v, textContent: v })));
        tk.value = f.content.ticks || 'off';
        tk.onchange = () => commit(() => { if (tk.value === 'off') delete f.content.ticks; else f.content.ticks = tk.value; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'coords' }), tk));
      }
    }
    if (f.kind === 'label') {
      const tx = h('textarea', { value: f.content.text || '', style: 'min-height:40px' });
      tx.onchange = () => commit(() => { f.content.text = tx.value; });
      const at = f.content.at || [0, 0, 0];
      const xyz = ['x', 'y', 'z'].map((k, i) => { const inp = h('input', { type: 'number', step: 'any', value: +(+at[i]).toFixed(3), style: 'width:62px', title: `the point, world ${k}` }); inp.onchange = () => commit(() => { const a = (f.content.at || [0, 0, 0]).slice(); a[i] = +inp.value || 0; f.content.at = a; }); return inp; });
      insp.append(tx, h('div', { className: 'row' }, h('span', { textContent: 'points at' }), ...xyz), h('div', { className: 'hint', textContent: 'the leader follows this world point in the view it refers to' }));
    }
    if (f.kind === 'legend') {
      const t = h('input', { value: f.content.title || '' });
      t.onchange = () => commit(() => { f.content.title = t.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'title' }), t));
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
  function badgeOf(f) {
    if (!opts.frameBadge) return null;
    try { const b = opts.frameBadge(f); return !b ? null : typeof b === 'string' ? { text: b } : b; } catch { return null; }
  }
  // a label: at the host's point (opts.labelPoint(view) → [x,y,z]) or the middle of the view, beside it
  function addLabel() {
    const sv = sel.length === 1 ? frameById(D, sel[0]) : null;
    const v = (sv && hasProj(sv)) ? sv : D.frames.find((x) => hasProj(x) && !x.hidden);
    if (!v) { say('a label points at a 3D view — add one first'); return; }
    let at = opts.labelPoint ? opts.labelPoint(v) : null;
    if (!at) at = pageToWorld(v, v.box[0] + v.box[2] / 2, v.box[1] + v.box[3] / 2, 0);
    const box = [v.box[0] + v.box[2] * 0.62, v.box[1] + v.box[3] * 0.12, 30, 7];
    add({ kind: 'label', box, content: { text: 'label', at: at.map((n) => +(+n).toFixed(3)), of: v.id } });
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
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = D.frames.map((f) => f.id); render(); return; }
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
    if (dir && sel.length) { e.preventDefault(); commit(() => { for (const id of sel) { const f = frameById(D, id); if (!f.locked) { f.box[0] += dir[0] * step; f.box[1] += dir[1] * step; } } }); }
  });

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
  tableFromTsv,
  registerField,
  fieldList,
  formatNumber,
  formatDate,
  refFrame,
  subjectFrame,
  isFormatSpec,
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
  mountEditor,
};
