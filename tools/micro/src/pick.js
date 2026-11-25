// micro — the PICK: what is under a CSS pixel. The camera ray through it, the
// world point a pick lands on (a block's entered face, a mesh by BVH raycast), the
// record inspector that shows the picked row (a card on a phone), and the pick as
// a host page sees it (micro:pick, worldAt, pick). The click / touch / magnifier
// gestures that call it stay in the app.
import { S, layerById, requestRender } from './state.js';
import { FACE_CUT, FACE_NAMES, FACE_NORMALS, decodeLasRecords, faceOfId, dmWorldToLocal, isMiss, layerOfId, layerSection, mat4Inverse } from '../../../ext/condenser/src/main.js';
import { recordPosition } from './overlay.js';
import { currentSection } from './section.js';
import { attrRowCountOf, extendRow, fetchCsvRecord, fetchLayerRow, rawRecordOf, dmDocReader } from './records.js';
import { gridNodeWorld, surfaceFromGrid, gridWorldBbox4, gridLocalXY } from './grid-ops.js';
import { halfAt, volumeContextOf } from './analysis.js';
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

// half-extent of ONE block, in its lattice frame (world units). From the block-
// support contract (analysis.js halfAt): a regular model's pitch, a SUB-BLOCKED
// one's own sizes snapped to whole fine steps — the box the renderer draws (dimQ),
// so the picked face is the drawn one, from any source (CSV, .dm, Parquet).
export async function blockHalfDims(L, rec) {
  const vc = volumeContextOf(L);
  if (!vc.pitch) return null;
  if (!vc.dc) return halfAt(vc, null);
  let f = null;
  try { f = await fetchLayerRow(L, rec); } catch { f = null; }
  return f ? halfAt(vc, f) : vc.pitch.map((p) => p / 2);   // an unreadable record: one fine cell
}

// A camera ray through a CSS pixel, intersected with the horizontal plane at the
// document's mid-elevation → a frame-local world point (no picking needed). The knife's ray:
// pixelRay, so vertical exaggeration and an orthographic camera are honoured (sweep 2026-11-25:
// this built its own perspective ray from eye/fov, which pixelRay had already retired for measure).
export function unprojectToMidZ(cssX, cssY) {
  const { o, d } = pixelRay(cssX, cssY);
  const b = rendererDocBbox();
  const zMid = (b[2] + b[5]) / 2;
  if (Math.abs(d[2]) < 1e-12) return null;
  const t = (zMid - o[2]) / d[2];
  if (!(t > 0)) return null;
  return [o[0] + d[0] * t, o[1] + d[1] * t, zMid];
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

// a normal → dip (from horizontal) and dip direction (the azimuth DOWN-dip, clockwise from north).
// Turned to face up first: an upward normal's horizontal part points down the slope, so its
// azimuth IS the dip direction — no half-turn (the panel added 180° to an upward normal and read
// every slope backwards, 270 for a plane dipping due east — found 2026-11-25)
export function dipOfNormal(n) {
  const u = n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
  const dip = Math.acos(Math.min(1, Math.abs(u[2]) / (Math.hypot(u[0], u[1], u[2]) || 1))) * 180 / Math.PI;
  const dd = Math.hypot(u[0], u[1]) < 1e-12 ? 0 : ((Math.atan2(u[0], u[1]) * 180 / Math.PI) % 360 + 360) % 360;
  return { dip, dipDir: dd };
}

// What a mesh hit IS: a triangle, a point on it, and the way it faces. Dip/dip-dir
// come free from the normal — on a pit shell or a vein wall that is the number a
// geologist actually wants.
export async function showMeshRecord(L, cssX, cssY) {
  _recFace = null;
  const h = await meshHitAt(L, cssX, cssY);
  const tag = L.label || L.name;
  if (!h) { showRecPanel(`${tag} · surface`, [], 'no triangle under the cursor'); return null; }
  if (h.grid) {                                            // a grid shown as a surface: its node, its value, its slope
    const w2 = h.point, { dip: dip2, dipDir: dd2 } = dipOfNormal(h.normal);
    showRecPanel(`${tag} · surface · node ${h.grid.r},${h.grid.c}`, [
      ['X', +w2[0].toFixed(3)], ['Y', +w2[1].toFixed(3)], [h.grid.flat ? 'value' : 'Z', +h.grid.value.toFixed(3)],
      ...(h.grid.flat ? [['Z (sheet)', +w2[2].toFixed(3)]] : [['slope', +dip2.toFixed(1)], ['slope dir', +dd2.toFixed(1)]]),
      ['row', h.grid.r], ['col', h.grid.c],
    ]);
    return h;
  }
  const w = h.point;                                        // already world (the BVH is world-space)
  const { dip, dipDir } = dipOfNormal(h.normal);
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
    rows.push([`${c.kind === 'ratio' && !c.mat ? '%' : '✎'} ${c.name}`, v === '' || v == null ? '—' : (typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v)]);
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
  // a GRID shown as a surface draws as a mesh but has no mesh document — no triangles for a BVH;
  // it is met through its own height function (v0.7.3: a click on one said "no triangle")
  if (L.docs && L.docs.gridDoc && L.docs.gridDoc.grid && !L.docs.meshDoc) return surfaceHitAt(L, cssX, cssY);
  const bvh = await meshSolidOf(L).catch(() => null);      // the same BVH the solid queries build (cached)
  if (!bvh) return null;
  // The solid BVH is built from the mesh's SOURCE blob, so it lives in WORLD
  // coordinates (that is the space the winding queries feed it). The camera ray
  // is frame-local. Lift the origin; the direction is unaffected — a frame is a
  // pure translation, never a rotation (@gcu/frame's whole contract).
  // A MOVED layer (an exploded group, a view with an offset) is DRAWN displaced by its offset while
  // its BVH stays where the data is: shift the ray back by the offset before casting (sweep
  // 2026-11-25: the cast ignored it, so a click on a moved mesh missed or hit the wrong one).
  // → the hit with `point` TRUE (the mesh's own geometry: the record panel, the structure brush,
  // control points) and `drawn` = where it shows on screen (a pivot, worldAt — as pickHitPoint)
  const { o, d } = pixelRay(cssX, cssY);
  const off = S.renderer.layerOffset ? S.renderer.layerOffset(L.id) : [0, 0, 0];
  const ow = [o[0] + S.frame.origin[0] - off[0], o[1] + S.frame.origin[1] - off[1], o[2] + S.frame.origin[2] - off[2]];
  const hit = raycastBVH(bvh, ow, d);                      // world in → world out
  if (hit && hit.point) hit.drawn = [hit.point[0] + off[0], hit.point[1] + off[1], hit.point[2] + off[2]];
  return hit;
}

// The pixel's ray against a grid shown as a SURFACE (z = f(x, y), placed or not) or as a flat
// sheet at a fixed z. The ray is clipped to the grid's box and elevation range, marched at half a
// cell, and the crossing bisected. → { point (true world), drawn (+ the layer's display offset),
// normal, t, grid: { r, c, value } } | null. Like meshHitAt, a moved layer is met where it's drawn.
function surfaceHitAt(L, cssX, cssY) {
  const g = L.docs.gridDoc.grid;
  if (!g || !g.data) return null;
  let surf; try { surf = surfaceFromGrid(g); } catch { return null; }   // a tilted sheet has no z = f(x, y)
  const { o, d } = pixelRay(cssX, cssY);
  const off = S.renderer.layerOffset ? S.renderer.layerOffset(L.id) : [0, 0, 0];
  const ow = [o[0] + S.frame.origin[0] - off[0], o[1] + S.frame.origin[1] - off[1], o[2] + S.frame.origin[2] - off[2]];
  const at = (t) => [ow[0] + d[0] * t, ow[1] + d[1] * t, ow[2] + d[2] * t];
  const flat = L.surfaceFlatZ != null && Number.isFinite(+L.surfaceFlatZ) ? +L.surfaceFlatZ : null;
  let tHit = null;
  if (flat != null) {                                      // a flat sheet: the plane, valued where the grid has data
    if (Math.abs(d[2]) < 1e-12) return null;
    const t = (flat - ow[2]) / d[2];
    if (!(t > 0)) return null;
    const q = at(t);
    if (!Number.isFinite(surf.sampleZ(q[0], q[1]))) return null;
    tHit = t;
  } else {
    // the elevation range, once per grid (the place's z scale and shift included)
    if (!g._zr) {
      let lo = Infinity, hi = -Infinity; const nod = g.nodata;
      for (const v of g.data) if (Number.isFinite(v) && v !== nod && Math.abs(v) < 1.7e38) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const zs = g.place ? g.place.s : 1, zt = g.place ? g.place.t[2] : 0;
      Object.defineProperty(g, '_zr', { value: [zt + zs * lo, zt + zs * hi], enumerable: false, configurable: true });
    }
    const bb = gridWorldBbox4(g), zr = g._zr, pad = 1e-6 + 1e-9 * Math.abs(zr[1]);
    // slab clip of the ray to [x] × [y] × [z ± pad]
    let t0 = 0, t1 = Infinity;
    for (const [lo, hi, a, da] of [[bb[0], bb[2], ow[0], d[0]], [bb[1], bb[3], ow[1], d[1]], [zr[0] - pad, zr[1] + pad, ow[2], d[2]]]) {
      if (Math.abs(da) < 1e-15) { if (a < lo || a > hi) return null; continue; }
      let ta = (lo - a) / da, tb = (hi - a) / da; if (ta > tb) { const x = ta; ta = tb; tb = x; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    }
    if (!(t1 > t0)) return null;
    const cell = Math.min(g.dx, g.dy || g.dx) * (g.place ? g.place.s : 1);
    const f = (t) => { const q = at(t); return q[2] - surf.sampleZ(q[0], q[1]); };
    const dxy = Math.hypot(d[0], d[1]);
    const n = Math.max(1, Math.min(200000, dxy > 1e-12 ? Math.ceil((t1 - t0) * dxy / (cell / 2)) : 1));
    let ta = t0, fa = f(t0);
    for (let i = 1; i <= n && tHit == null; i++) {
      const tb = t0 + (t1 - t0) * i / n, fb = f(tb);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb <= 0) {
        let a = ta, b = tb, va = fa;
        for (let k = 0; k < 60; k++) { const m = (a + b) / 2, vm = f(m); if (!Number.isFinite(vm)) break; if (va * vm <= 0) b = m; else { a = m; va = vm; } }
        tHit = (a + b) / 2;
      }
      ta = tb; fa = fb;
    }
    if (tHit == null) return null;
  }
  const point = at(tHit);
  const value = surf.sampleZ(point[0], point[1]);
  if (flat == null) point[2] = value;                      // ON the surface (the bisection's last 1e-12 of slack)
  // the slope, from the height function either side (half a cell)
  const e = Math.min(g.dx, g.dy || g.dx) * (g.place ? g.place.s : 1) / 2;
  const zx = (surf.sampleZ(point[0] + e, point[1]) - surf.sampleZ(point[0] - e, point[1])) / (2 * e);
  const zy = (surf.sampleZ(point[0], point[1] + e) - surf.sampleZ(point[0], point[1] - e)) / (2 * e);
  let normal = [-zx, -zy, 1];
  if (!normal.every(Number.isFinite)) normal = [0, 0, 1];
  { const l = Math.hypot(...normal); normal = normal.map((v) => v / l); }
  if (flat != null) normal = [0, 0, 1];
  // the nearest node, in the grid's own frame
  const toLocal = gridLocalXY(g), uv = toLocal ? toLocal(point[0], point[1]) : [point[0], point[1]];
  const c = Math.round((uv[0] - g.x0) / g.dx), r = Math.round((g.y0 - uv[1]) / (g.dy || g.dx));
  return { point, drawn: [point[0] + off[0], point[1] + off[1], point[2] + off[2]], normal, t: tHit, grid: { r, c, value, flat: flat != null } };
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
      ['X', +gridNodeWorld(g, r, c)[0].toFixed(3)], ['Y', +gridNodeWorld(g, r, c)[1].toFixed(3)],
      ['Z', +gridNodeWorld(g, r, c)[2].toFixed(3)], ['row', r], ['col', c],
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
    const vals = await (await dmDocReader(bd)).fetchRecord(rec);   // a rotated model's XC/YC/ZC read in WORLD (records.js)
    const rows = bd.header.columns.map((name, i) => [name, vals[i] == null ? '—' : vals[i]]);
    // a placed (rotated) model: its own frame's coordinates — what the file stores — beside the world ones
    const pl = bd.header.dmPlace, m = bd.header.mapping;
    if (pl && [m.x, m.y, m.z].every((i) => typeof vals[i] === 'number')) {
      const q = dmWorldToLocal(pl, vals[m.x], vals[m.y], vals[m.z]);
      rows.splice(Math.max(m.x, m.y, m.z) + 1, 0, ...['x', 'y', 'z'].map((a, k) => [`${bd.header.columns[m[a]]} · model frame`, +q[k].toFixed(6)]));
    }
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
      if (mh && mh.drawn) out[k] = { world: [+mh.drawn[0], +mh.drawn[1], +mh.drawn[2]], layer: hit.layer, rec: null, face: null };   // where it is DRAWN, as pickHitPoint
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
