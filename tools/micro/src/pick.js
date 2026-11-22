// micro — the PICK: what is under a CSS pixel. The camera ray through it, the
// world point a pick lands on (a block's entered face, a mesh by BVH raycast), the
// record inspector that shows the picked row (a card on a phone), and the pick as
// a host page sees it (micro:pick, worldAt, pick). The click / touch / magnifier
// gestures that call it stay in the app.
import { S, layerById, requestRender } from './state.js';
import { FACE_CUT, FACE_NAMES, FACE_NORMALS, decodeLasRecords, faceOfId, fetchDmRecord, isMiss, layerOfId, layerSection, mat4Inverse } from '../../../ext/condenser/src/main.js';
import { recordPosition } from './overlay.js';
import { currentSection } from './section.js';
import { attrRowCountOf, extendRow, fetchCsvRecord, rawRecordOf } from './records.js';
import { rendererDocBbox } from './layers.js';
import { html, setHTML } from './html.js';
import { _propOpen, closeProps } from './props.js';
import { _isMobile, _sheetExclusive } from './windows.js';
import { menuXY } from './menu.js';
import { meshSolidOf } from './bygeom.js';
import { raycastBVH } from '../../../ext/winding/index.js';
import { attrTableReveal } from './attrtable.js';
import { parquetRow } from './rowworker.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setPickHooks): _viewMode
let H = {};
export function setPickHooks(h) { H = h; }

// A camera ray through a CSS pixel — frame-local {o, d}, honouring ortho.
// (unprojectToMidZ below is the perspective-only special case it grew from.)
export function pixelRay(cssX, cssY) {
  const st = S.cam.state, r = S.cv.getBoundingClientRect();
  const ndcX = (2 * cssX / r.width) - 1, ndcY = 1 - (2 * cssY / r.height);
  // Unproject the pixel through inverse(viewProj) — which INCLUDES vertical
  // exaggeration. The old geometric construction from eye/view/fov ignored zExag,
  // so Measure and the knife landed on the wrong world point (off by the z-scale)
  // whenever exaggeration was active, though the picked PIXEL was drawn exaggerated.
  // inverse(viewProj) maps clip → REAL world (the camera's own contract), for both
  // ortho and perspective, so this is one path instead of two.
  const inv = mat4Inverse(st.viewProj);
  if (!inv) return { o: st.eye.slice(), d: [0, 0, -1] };   // singular — degrade rather than throw
  const un = (nz) => {                                     // NDC (x,y,nz) → world
    const x = ndcX, y = ndcY, z = nz;
    const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
    return [
      (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w,
      (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
      (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w,
    ];
  };
  const near = un(-1), far = un(1);
  const d = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const dl = Math.hypot(...d) || 1;
  return { o: near, d: d.map((c) => c / dl) };
}

// Where EXACTLY did the ray meet the thing it picked? The GPU already solved the
// ray-box entry to write true depth, and it told us WHICH FACE it entered through
// — so the plane is known and the point is one intersection, with no second
// ray-AABB on the CPU to drift from what was drawn. A splat, a capsule or a hit
// with no face falls back to the source record's centroid (exact, just coarser).
export async function pickHitPoint(hit, cssX, cssY) {
  const truePos = await recordPosition(hit);               // world centroid — the fallback, and the plane's anchor
  if (!truePos) return null;
  // a MOVED layer (a view with an offset) is hit where it is DRAWN: the point is
  // on the displaced face, so a pivot or a measure lands on what was clicked
  const off = S.renderer.layerOffset(hit.layer);
  const world = [truePos[0] + off[0], truePos[1] + off[1], truePos[2] + off[2]];
  const face = hit.face;
  if (face == null || face === 7) return world;
  const { o, d } = pixelRay(cssX, cssY);
  let n, dist;                                             // plane: dot(n, p_local) = dist
  if (face === FACE_CUT) {
    // the cut face is one of the LAYER's slab faces (d ± half — its own slab, a
    // half-space's true plane, the section's slab), whichever the ray meets
    // first. It used to be the section plane d0 always, so a pick on a ±5 m
    // slab's wall landed 5 m deep and a layer's own slab wasn't seen at all.
    const sec = currentSection();
    if (!sec || !sec.on) return world;
    const s = layerSection(sec, S.renderer.layerSectioned(hit.layer));
    if (!s) return world;
    n = s.n;
    const on = n[0] * o[0] + n[1] * o[1] + n[2] * o[2], dn = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    if (Math.abs(dn) < 1e-9) return world;
    const ts = [s.d - s.half, s.d + s.half].map((f) => (f - on) / dn).filter((t) => t > 0);
    if (!ts.length) return world;
    const t = Math.min(...ts);
    return [o[0] + d[0] * t + S.frame.origin[0], o[1] + d[1] * t + S.frame.origin[1], o[2] + d[2] * t + S.frame.origin[2]];
  } else {
    const L = layerById(hit.layer);
    const half = await blockHalfDims(L, hit.rec);          // sub-blocks carry their own size
    if (!half) return world;
    const ax = face >> 1;                                  // 0=−X 1=+X 2=−Y 3=+Y 4=−Z 5=+Z (a ROTATED model: its lattice U/V/W faces)
    n = FACE_NORMALS[face];
    const R = L && L.docs.blockDoc && L.docs.blockDoc.header.grid && L.docs.blockDoc.header.grid.rot;
    if (R) n = [R[0] * n[0] + R[3] * n[1] + R[6] * n[2], R[1] * n[0] + R[4] * n[1] + R[7] * n[2], R[2] * n[0] + R[5] * n[1] + R[8] * n[2]];
    const cLocal = [world[0] - S.frame.origin[0], world[1] - S.frame.origin[1], world[2] - S.frame.origin[2]];
    dist = n[0] * cLocal[0] + n[1] * cLocal[1] + n[2] * cLocal[2] + half[ax];   // the face plane: dot(n, centre) + half-extent
  }
  const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(den) < 1e-9) return world;
  const t = (dist - (n[0] * o[0] + n[1] * o[1] + n[2] * o[2])) / den;
  if (!Number.isFinite(t) || t <= 0) return world;
  return [o[0] + d[0] * t + S.frame.origin[0], o[1] + d[1] * t + S.frame.origin[1], o[2] + d[2] * t + S.frame.origin[2]];
}

// half-extent of ONE block, in world units. A regular model reads the grid pitch;
// a SUB-BLOCKED one reads the record's own dim columns — a sub-block's face is
// its own, not its parent cell's.
export async function blockHalfDims(L, rec) {
  const bd = L && L.docs && L.docs.blockDoc;
  const g = bd && bd.header && bd.header.grid;              // { x: {origin,pitch,count}, y: …, z: … }
  if (!g || !g.x || !g.y || !g.z) return null;
  const h = [g.x.pitch / 2, g.y.pitch / 2, g.z.pitch / 2];  // sub-blocked → this is the FINE pitch (the fallback)
  const dc = bd.header.subBlocked && bd.header.dimCols;    // { x, y, z } → column INDICES
  if (!dc) return h;
  let f = null;
  try {
    if (bd.header.dm) f = await fetchDmRecord(bd.blob, bd.header.dm, rec);
    else if (!bd.parquet) f = await fetchCsvRecord(rec, bd);
  } catch { f = null; }
  if (!f) return h;                                        // parquet sub-blocks: the parent pitch (honest, coarser)
  const v = [+f[dc.x], +f[dc.y], +f[dc.z]];
  return v.every((x) => Number.isFinite(x) && x > 0) ? [v[0] / 2, v[1] / 2, v[2] / 2] : h;
}

// A camera ray through a CSS pixel, intersected with the horizontal plane at the
// document's mid-elevation → a frame-local world point (no picking needed).
export function unprojectToMidZ(cssX, cssY) {
  const st = S.cam.state, r = S.cv.getBoundingClientRect();
  const ndcX = (2 * cssX / r.width) - 1, ndcY = 1 - (2 * cssY / r.height);
  const v = st.view;
  const right = [v[0], v[4], v[8]], up = [v[1], v[5], v[9]];
  const fwd = [st.target[0] - st.eye[0], st.target[1] - st.eye[1], st.target[2] - st.eye[2]];
  const fl = Math.hypot(...fwd) || 1;
  const tanF = Math.tan(st.fovY / 2);
  const dir = [0, 1, 2].map((i) => fwd[i] / fl + right[i] * ndcX * tanF * st.aspect + up[i] * ndcY * tanF);
  const b = rendererDocBbox();
  const zMid = (b[2] + b[5]) / 2;
  if (Math.abs(dir[2]) < 1e-9) return null;
  const t = (zMid - st.eye[2]) / dir[2];
  if (t <= 0) return null;
  return [st.eye[0] + dir[0] * t, st.eye[1] + dir[1] * t, zMid];
}

// ── pick → record inspector: a CLICK (not a drag) GPU-picks the element under
// the cursor (record index), then fetches the full source row — O(1) for LAS
// (fixed records), an early-exit sweep for CSV — into the right panel. ──
// record-panel field selection: a per-layer HIDDEN set (default show-all) keyed
// by column name; the picker (search + all/none + checklist) mirrors the export
// dialog. State lives on the layer (`L._recHide`) so it persists to the manifest.
let _recLayer = null, _recRows = [], _recNote = '', _recAllNames = [], _recQ = '';

function paintRecList() {
  const hide = _recLayer && _recLayer._recHide;
  const vis = (hide && hide.size) ? _recRows.filter(([k]) => !hide.has(String(k))) : _recRows;
  setHTML($('#rpList'), html`${vis.map(([k, v]) => html`<div class="rp-row"><span class="k" title="${k}">${k}</span><span class="v">${v}</span></div>`)}${_recNote ? html`<div class="rp-note">${_recNote}</div>` : ''}`);
  const fb = $('#rpFieldsBtn');
  fb.style.display = _recAllNames.length ? '' : 'none';
  const nh = hide ? hide.size : 0;
  fb.textContent = nh ? `fields ▾ (${_recAllNames.length - nh}/${_recAllNames.length})` : 'fields ▾';
}

function renderRecCfg() {
  const cfg = $('#rpCfg'), L = _recLayer;
  if (!L) { cfg.classList.remove('show'); return; }
  L._recHide = L._recHide || new Set();
  const names = _recAllNames;
  cfg.textContent = '';
  const search = document.createElement('input'); search.className = 'rp-search'; search.type = 'text'; search.placeholder = 'search fields…'; search.value = _recQ;
  const links = document.createElement('div'); links.className = 'rp-links';
  const allA = document.createElement('a'), noneA = document.createElement('a'), tally = document.createElement('span'); tally.className = 'tally';
  links.append(allA, noneA, tally);
  const checks = document.createElement('div'); checks.className = 'rp-checks';
  cfg.append(search, links, checks);
  let shown = [];
  const rebuild = () => {
    const q = _recQ.toLowerCase();
    shown = names.filter((n) => !q || n.toLowerCase().includes(q));
    allA.textContent = q ? 'all shown' : 'all';
    noneA.textContent = q ? 'none shown' : 'none';
    tally.textContent = `${names.length - L._recHide.size}/${names.length} shown${q ? ` · ${shown.length} match` : ''}`;
    checks.textContent = '';
    for (const n of shown) {
      const lab = document.createElement('label'); lab.title = n;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !L._recHide.has(n);
      cb.onchange = () => { if (cb.checked) L._recHide.delete(n); else L._recHide.add(n); paintRecList(); rebuild(); };
      lab.append(cb, document.createTextNode(n));
      checks.appendChild(lab);
    }
    if (!shown.length) { const s = document.createElement('span'); s.style.color = 'var(--muted)'; s.textContent = 'no fields match'; checks.appendChild(s); }
  };
  search.oninput = () => { _recQ = search.value; rebuild(); };
  allA.onclick = () => { for (const n of shown) L._recHide.delete(n); paintRecList(); rebuild(); };
  noneA.onclick = () => { for (const n of shown) L._recHide.add(n); paintRecList(); rebuild(); };
  rebuild();
}

let _recFace = null;                                        // the face of the current block pick (null = n/a)

// What a mesh hit IS: a triangle, a point on it, and the way it faces. Dip/dip-dir
// come free from the normal — on a pit shell or a vein wall that is the number a
// geologist actually wants.
export async function showMeshRecord(L, cssX, cssY) {
  _recFace = null;
  const h = await meshHitAt(L, cssX, cssY);
  const tag = L.label || L.name;
  if (!h) { showRecPanel(`${tag} · surface`, [], 'no triangle under the cursor'); return null; }
  const w = h.point;                                        // already world (the BVH is world-space)
  const n = h.normal;
  const dip = Math.acos(Math.min(1, Math.abs(n[2]))) * 180 / Math.PI;          // from horizontal
  let dipDir = Math.atan2(n[0], n[1]) * 180 / Math.PI;                          // azimuth of the down-dip vector
  if (n[2] > 0) dipDir += 180;
  dipDir = ((dipDir % 360) + 360) % 360;
  showRecPanel(`${tag} · triangle ${h.tri.toLocaleString()}`, [
    ['X', +w[0].toFixed(3)], ['Y', +w[1].toFixed(3)], ['Z', +w[2].toFixed(3)],
    ['dip', +dip.toFixed(1)], ['dip dir', +dipDir.toFixed(1)],
    ['vertices', h.verts.join(', ')],
    ['distance', +h.t.toFixed(2)],
  ]);
  return h;
}

// the phone: a pick opens a CARD (content-sized, floating, the view doesn't yield); a record
// already open swaps its contents in place, card or sheet, with no close-and-reopen
let _recTap = null;                                        // { y, t }: where the canvas tap landed — good across the

                                                           // "fetching…" placeholder and the rows that follow it
function placeRecCard() {
  const P = $('#recPanel');
  P.classList.remove('card-top');
  if (!_recTap || performance.now() - _recTap.t > 4000) return;
  if (_recTap.y > P.getBoundingClientRect().top - 24) P.classList.add('card-top');   // it would cover what you tapped
}

export function expandRecCard() {
  const P = $('#recPanel');
  P.classList.remove('card', 'card-top');
  if (_propOpen) closeProps();
  _sheetExclusive(P);
}

function showRecPanel(title, rows, note) {
  const P = $('#recPanel'), mobile = _isMobile();
  const card = mobile && (!P.classList.contains('show') || P.classList.contains('card'));
  if (_propOpen && !card) closeProps();
  $('#rpTitle').textContent = _recFace != null ? `${title} · ${FACE_NAMES[_recFace]}` : title;
  _recRows = rows; _recNote = note || ''; _recAllNames = rows.map(([k]) => String(k));
  paintRecList();
  if ($('#rpCfg').classList.contains('show')) renderRecCfg();
  P.classList.toggle('card', card);
  P.classList.add('show');
  if (card) { $('#rpCfg').classList.remove('show'); placeRecCard(); }
  else _sheetExclusive(P);
}

// the record panel's own controls: the fields picker, the row menu, close
export function installRecordPanel() {
  $('#rpFieldsBtn').onclick = () => {
    if ($('#recPanel').classList.contains('card')) expandRecCard();   // field choosing wants the room
    const cfg = $('#rpCfg');
    if (cfg.classList.contains('show')) cfg.classList.remove('show');
    else { cfg.classList.add('show'); renderRecCfg(); }
  };
  $('#rpList').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.rp-row'); if (!row || !_recLayer) return;
    const kEl = row.querySelector('.k'); const name = kEl && (kEl.getAttribute('title') || kEl.textContent);
    if (!name) return;
    e.preventDefault();
    const hasHidden = _recLayer._recHide && _recLayer._recHide.size;
    menuXY(e.clientX, e.clientY, [
      { label: `Hide “${name}”`, action: () => { _recLayer._recHide = _recLayer._recHide || new Set(); _recLayer._recHide.add(name); paintRecList(); if ($('#rpCfg').classList.contains('show')) renderRecCfg(); } },
      ...(hasHidden ? [{ label: 'Show all fields', action: () => { _recLayer._recHide.clear(); paintRecList(); if ($('#rpCfg').classList.contains('show')) renderRecCfg(); } }] : []),
    ]);
  });
  $('#rpClose').onclick = () => { _recSeq++; $('#recPanel').classList.remove('show'); $('#rpCfg').classList.remove('show'); S.renderer.setPicked(null); requestRender(); emitPick(null); };
}

function appendCalcRows(rows, L, f, h, rec) {
  if (!L || ((!L.calcCols || !L.calcCols.length) && (!L.paintCols || !L.paintCols.length))) return;
  const ext = extendRow(L, f, rec);
  // census order: base → STORED (paint/materialized) → calc (matches extendRow)
  (L.paintCols || []).forEach((c, k) => {
    const v = ext[h.columns.length + k];
    rows.push([`${c.kind === 'ratio' ? '%' : '✎'} ${c.name}`, v === '' || v == null ? '—' : (typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v)]);
  });
  (L.calcCols || []).forEach((c, k) => {
    const v = ext[h.columns.length + (L.paintCols || []).length + k];
    rows.push([`ƒ ${c.name}`, v == null ? '—' : (typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v)]);
  });
}

// The GPU said "this mesh". Which triangle, and where exactly? Raycast the same
// BVH the solid queries use (@gcu/winding raycastBVH) along the pixel's own ray.
// The mesh has no rows, so there is nothing to look up — the geometry IS the record.
export async function meshHitAt(L, cssX, cssY) {
  if (!L || L.kind !== 'mesh') return null;
  const bvh = await meshSolidOf(L).catch(() => null);      // the same BVH the solid queries build (cached)
  if (!bvh) return null;
  // The solid BVH is built from the mesh's SOURCE blob, so it lives in WORLD
  // coordinates (that is the space the winding queries feed it). The camera ray
  // is frame-local. Lift the origin; the direction is unaffected — a frame is a
  // pure translation, never a rotation (@gcu/frame's whole contract).
  const { o, d } = pixelRay(cssX, cssY);
  const ow = [o[0] + S.frame.origin[0], o[1] + S.frame.origin[1], o[2] + S.frame.origin[2]];
  return raycastBVH(bvh, ow, d);                           // world in → world out
}

let _recSeq = 0;

export async function showRecord(hit) {
  // a record's row arrives AFTER an await (Parquet / .dm / CSV / PLY / LAS read), and
  // by then the user may have closed the panel or picked something else. Only the
  // newest pick shows its result: a stale one neither reopens a closed panel nor
  // overwrites the record that replaced it. (× and every new pick bump _recSeq.)
  const seq = ++_recSeq;
  const show = (...a) => { if (seq === _recSeq) showRecPanel(...a); };
  // the picked record's position: what the composer's + label points at next
  recordPosition(hit).then((p) => { if (p && p.every(Number.isFinite)) S.lastPoint = { at: p.slice(), t: Date.now() }; }, () => {});
  // a pick is a (layer, record) PAIR — resolve THAT layer's own docs, not the
  // active aliases: any visible layer is pickable
  const lid = hit.layer, rec = hit.rec;
  const L = layerById(lid);
  // …and the pick knows WHICH FACE of the block you hit (the shader solved it to
  // write depth). Name it in the title — it is what you clicked, and it is the
  // plane "section here" and measure snap to.
  _recFace = (L && L.kind === 'blocks' && hit.face != null && hit.face <= 6) ? hit.face : null;
  _recLayer = L;                        // gate the field picker to the picked layer's own hidden set
  attrTableReveal(lid, rec);
  const docs = L ? L.docs : {};
  const tag = (S.layers.length > 1 && L ? `${L.label || L.name} · ` : '') + (L && L.offset ? 'drawn displaced · ' : '');
  const bd = docs.blockDoc, pd = docs.plyDoc, ld = docs.lasDoc, dd = docs.dhDoc;
  if (docs.gridDoc) {
    const gd = docs.gridDoc, g = gd.grid;
    const i = gd.dispIdx ? gd.dispIdx[rec] : rec;
    const r = (i / g.nx) | 0, c = i % g.nx;
    show(`${tag}cell · ${r},${c}`, [
      ['X', +(g.x0 + c * g.dx).toFixed(3)], ['Y', +(g.y0 - r * g.dy).toFixed(3)],
      ['Z', +g.data[i].toFixed(3)], ['row', r], ['col', c],
    ]);
    return;
  }
  if (dd) {
    const f = rawRecordOf(L, rec) || dd.fetchRecord(rec);
    if (!f) { show(`${tag}interval · row ${rec.toLocaleString()}`, [], 'row not found'); return; }
    const rows = dd.header.columns.map((name, i) => [name, f[i]]);
    appendCalcRows(rows, L, f, dd.header, rec);
    show(`${tag}interval · row ${rec.toLocaleString()}`, rows);
    return;
  }
  if (bd && bd.parquet) {
    show(`${tag}block · row ${rec.toLocaleString()}`, [], 'fetching…');
    const row = await parquetRow(bd.parquet, rec);
    if (!row) { show(`${tag}block · row ${rec.toLocaleString()}`, [], 'row not found'); return; }
    const f = bd.header.columns.map((n) => { const v = row[n]; return v == null ? '—' : v; });
    const rows = bd.header.columns.map((nm, i) => [nm, f[i]]);
    appendCalcRows(rows, L, f, bd.header, rec);
    show(`${tag}block · row ${rec.toLocaleString()}`, rows);
    return;
  }
  if (bd && bd.header.dm) {
    const vals = await fetchDmRecord(bd.blob, bd.header.dm, rec);
    const rows = bd.header.columns.map((name, i) => [name, vals[i] == null ? '—' : vals[i]]);
    appendCalcRows(rows, L, vals, bd.header, rec);
    show(`${tag}block · record ${rec.toLocaleString()}`, rows);
    return;
  }
  if (bd) {
    show(`${tag}block · row ${rec.toLocaleString()}`, [], 'fetching…');
    const f = await fetchCsvRecord(rec, bd);
    if (!f) { show(`${tag}block · row ${rec.toLocaleString()}`, [], 'row not found'); return; }
    const rows = bd.header.columns.map((name, i) => [name, f[i]]);
    appendCalcRows(rows, L, f, bd.header, rec);
    show(`${tag}block · row ${rec.toLocaleString()}`, rows);
  } else if (pd) {
    show(`${tag}point · #${rec.toLocaleString()}`, [], 'fetching…');
    const vals = await pd.fetchRecord(rec);
    if (!vals) { show(`${tag}point · #${rec.toLocaleString()}`, [], 'record not found'); return; }
    const rows = pd.header.columns.map((name, i) => [name, Number.isInteger(vals[i]) ? vals[i] : +vals[i].toFixed(4)]);
    show(`${tag}point · #${rec.toLocaleString()}`, rows);
  } else if (ld) {
    const { blob, header } = ld;
    const off = header.pointOffset + rec * header.recordLen;
    const dv = new DataView(await blob.slice(off, off + header.recordLen).arrayBuffer());
    const one = decodeLasRecords(dv, header, 1, rec);
    const rows = [
      ['X', one.x[0].toFixed(3)], ['Y', one.y[0].toFixed(3)], ['Z', one.z[0].toFixed(3)],
      ['intensity', one.intensity[0]], ['classification', one.classification[0]],
    ];
    if (one.rgb) rows.push(['rgb', `${one.rgb[0]} ${one.rgb[1]} ${one.rgb[2]}`]);
    show(`${tag}point · #${rec.toLocaleString()}`, rows);
  }
}

// a finger is not a pixel: when the exact pixel under a TOUCH misses, take the
// nearest hit within R css px — one ID-buffer read over the disc. A drillhole a
// pixel or two wide was all but untappable. → { hit, x, y } (css, the hit's pixel) | null
export const TOUCH_PICK_R = 16;

export function nearPick(cx, cy, R, opts) {
  const region = S.renderer.pickRegion({ x: Math.max(0, cx - R), y: Math.max(0, cy - R), w: 2 * R + 1, h: 2 * R + 1 }, S.cam, opts);
  if (!region) return null;
  const { data, w, h, dpr } = region, rx = Math.max(0, cx - R), ry = Math.max(0, cy - R);
  let best = null, bd = R * R;
  for (let j = 0; j < h; j++) {
    const y = ry + (h - 1 - j) / dpr;                      // GL rows are bottom-up
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      if (isMiss(data[o + 1])) continue;
      const x = rx + i / dpr, d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > bd) continue;
      bd = d2; best = { hit: { layer: layerOfId(data[o + 1]), rec: data[o] >>> 0, face: faceOfId(data[o + 1]) }, x, y };
    }
  }
  return best;
}

// what a tap on the canvas shows: the record (a card on a phone), or a surface's geometry,
// or nothing — the tap handler's and the magnifier's one path
export function showPickAt(hit, px, py) {
  const r = S.cv.getBoundingClientRect();
  if (hit == null) { $('#recPanel').classList.remove('show'); S.renderer.setPicked(null); requestRender(); emitPick(null); return; }
  _recTap = { y: r.top + py, t: performance.now() };      // the card keeps clear of the tapped spot
  const hitL = layerById(hit.layer);
  if (hitL && hitL.kind === 'mesh') {                      // a surface: no rows to show, so show the geometry
    S.renderer.setPicked(null); requestRender();
    showMeshRecord(hitL, px, py)
      .then((h) => emitPick(h ? { layer: hit.layer, rec: null } : null, 'canvas', h ? { kind: 'mesh', world: h.point } : null));
    return;
  }
  S.renderer.setPicked(hit); requestRender();
  showRecord(hit);
  emitPick(hit, 'canvas');
}

// ── the pick, for a host page ──────────────────────────────────────────────────
// A USER pick leaves micro as `micro:pick` on window: { layer, rec, face, world,
// source: 'canvas'|'table' } (+ kind:'mesh', rec:null for a surface), or null when
// a click hits nothing or the record panel is closed. Fired where the user picks,
// not inside showRecord: a host calls showRecord/pick itself, and hearing its own
// picks back as clicks is how a host↔micro loop starts. `rec` is micro's record
// (as fetchLayerRow takes it); `world` is world coordinates, resolved first.
export async function emitPick(hit, source, extra) {
  let detail = null;
  if (hit) {
    let world = extra && extra.world ? [+extra.world[0], +extra.world[1], +extra.world[2]] : null;
    if (!world && hit.rec != null) {
      try { const p = await recordPosition(hit); world = p && p.every(Number.isFinite) ? [+p[0], +p[1], +p[2]] : null; } catch { world = null; }
    }
    detail = { layer: hit.layer, rec: hit.rec ?? null, face: hit.face ?? null, world, source };
    if (extra && extra.kind) detail.kind = extra.kind;
  }
  dispatchEvent(new CustomEvent('micro:pick', { detail }));
}

// ── screen → world, for a host (window.micro.worldAt). Many canvas CSS points,
// ONE pick render: the ID buffer over their bbox, each point decoded where a click
// would decode it, then the click's own hit-point resolution — a block's entered
// FACE (section + z-exaggeration honoured through pixelRay), a mesh by BVH raycast.
// No micro:pick, no record panel, no highlight. → [{ world, layer, rec, face } | null]
export async function worldAtPoints(points) {
  const out = new Array(points.length).fill(null);
  if (!points.length || !S.renderer.chunkCount) return out;
  const r = S.cv.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (!(x >= 0 && y >= 0 && x < r.width && y < r.height)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return out;                          // every point off the canvas
  const rx = Math.max(0, Math.floor(x0) - 1), ry = Math.max(0, Math.floor(y0) - 1);
  const region = S.renderer.pickRegion({ x: rx, y: ry, w: Math.ceil(x1) - rx + 2, h: Math.ceil(y1) - ry + 2 }, S.cam,
    { pointPx: +$('#ptPx').value, blocksAsPoints: H._viewMode === 'points', section: currentSection() });
  if (!region) return out;
  const { data, w, h, dpr } = region;
  // the region's GL origin, as gl.js computed it (rows are bottom-up)
  const gx0 = Math.max(0, Math.round(rx * dpr));
  const gy0 = Math.max(0, S.cv.height - Math.round(ry * dpr) - h);
  for (let k = 0; k < points.length; k++) {
    const [x, y] = points[k];
    if (!(x >= 0 && y >= 0 && x < r.width && y < r.height)) continue;
    const i = Math.round(x * dpr) - gx0, j = Math.round(S.cv.height - y * dpr - 1) - gy0;
    if (i < 0 || j < 0 || i >= w || j >= h) continue;
    const o = (j * w + i) * 4, g = data[o + 1];
    if (isMiss(g)) continue;
    const hit = { layer: layerOfId(g), rec: data[o] >>> 0, face: faceOfId(g) };
    const L = layerById(hit.layer);
    if (!L) continue;
    if (L.kind === 'mesh') {
      const mh = await meshHitAt(L, x, y).catch(() => null);
      if (mh && mh.point) out[k] = { world: [+mh.point[0], +mh.point[1], +mh.point[2]], layer: hit.layer, rec: null, face: null };
      continue;
    }
    const p = await pickHitPoint(hit, x, y).catch(() => null);
    if (p && p.every(Number.isFinite)) out[k] = { world: [+p[0], +p[1], +p[2]], layer: hit.layer, rec: hit.rec, face: hit.face === NO_FACE_CODE ? null : hit.face };
  }
  return out;
}

const NO_FACE_CODE = 7;

// The other direction: a host picks a record. Highlights it, shows its panel,
// reveals it in an open attribute table and, with `frame`, centres the view on it
// (orbit distance kept). Does NOT fire micro:pick. Resolves to the record's world
// position, or null; an unknown layer or a bad rec rejects.
export async function pickRecord({ layer, rec, frame: center = false } = {}) {
  const L = layerById(layer);
  if (!L) throw new Error(`pick: no layer ${layer}`);
  const n = attrRowCountOf(L);
  if (!Number.isInteger(rec) || rec < 0 || (n && rec >= n)) throw new Error(`pick: rec ${rec} is not a record of “${L.name}”`);
  const hit = { layer: L.id, rec };
  S.renderer.setPicked(hit);
  await showRecord(hit);                                   // also reveals the row in an open attribute table
  let world = null;
  try { const p = await recordPosition(hit); world = p && p.every(Number.isFinite) ? [+p[0], +p[1], +p[2]] : null; } catch { world = null; }
  if (center && world) {
    S.cam.state.target = [world[0] - S.frame.origin[0], world[1] - S.frame.origin[1], world[2] - S.frame.origin[2]];
    S.cam.update();
  }
  requestRender();
  return world;
}
