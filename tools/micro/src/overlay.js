// micro — the 2D OVERLAY drawn over the 3D view: the measure tool (two picked points →
// distance, bearing and plunge, or trend & plunge), the outline of the section plane, the
// swath band an analysis window pins onto the model, and the compass.
import { S, layerById, requestRender } from './state.js';
import { fetchCsvRecord, fetchLayerRow, dmDocReader } from './records.js';
import { parquetRow } from './rowworker.js';
import { coordNum, decodeLasRecords } from '../../../ext/condenser/src/main.js';
import { _isMobile } from './windows.js';
import { rendererDocBbox } from './layers.js';
import { currentSection } from './section.js';
import { pickHitPoint, meshHitAt, dipOfNormal } from './pick.js';
import { sceneOrigin, worldToLocal, localToWorld } from './coords.js';
import { overlayDrawers, poiSink } from './overlay-hooks.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setOverlayHooks): _viewMode
let H = {};
export function setOverlayHooks(h) { H = h; }

// ── measure (m): two picks -> distance. Endpoints come from the SOURCE RECORDS
// (block centroids / point coordinates) — exact, not screen unprojections. The
// overlay re-projects each drawn frame, so it rides orbits. Esc clears. ──
// a/b = the first / last point (frame-local [x,y,z]); pts / ptsT every vertex, drawn / true (a moved
// layer); closed: the polyline closed back on its first vertex; mouse = css px rubber-band end
// mode 'planes': two clicks on surfaces, each keeping its face normal → the angle between the planes
const NEW_MEASURE = (arm, mode = 'line') => ({ arm, mode, a: null, b: null, mouse: null, pts: [], ptsT: [], closed: false, normals: [] });
export let _measure = NEW_MEASURE(0);

export async function recordPosition(hit) {
  const lid = hit.layer, rec = hit.rec;                    // measure works ACROSS layers
  const L = layerById(lid);
  const docs = L ? L.docs : {};
  const bd = docs.blockDoc, pd = docs.plyDoc, ld = docs.lasDoc, dd = docs.dhDoc;
  if (dd) return dd.recordPosition(rec);
  if (docs.tracesDoc) return docs.tracesDoc.recordPosition(rec);   // Measure on a hole trace → its collar

  // grids and meshes: this ladder is the third copy of the doc-kind dispatch, and
  // it was the one missing them — so Measure and section-plane placement silently
  // did nothing on a grid-as-points layer (pickHitPoint bails on a null position)
  // while clicking the SAME point for a record panel worked, because showRecord's
  // copy has the branch. fetchLayerRow is the complete ladder; defer to it.
  if (docs.gridDoc || docs.meshDoc) {
    const row = await fetchLayerRow(L, rec);
    return row && Number.isFinite(+row[0]) ? [+row[0], +row[1], +row[2]] : null;
  }
  const m = bd && bd.header.mapping;
  if (bd && bd.parquet) { const row = await parquetRow(bd.parquet, rec); const cn = bd.parquet.coordNames; return row ? [+row[cn[0]], +row[cn[1]], +row[cn[2]]] : null; }
  if (bd && bd.header.dm) {
    const vals = await (await dmDocReader(bd)).fetchRecord(rec);   // placed: a rotated model's record reads in world
    return [vals[m.x], vals[m.y], vals[m.z]];
  }
  if (bd) {
    const f = await fetchCsvRecord(rec, bd);
    return f ? [coordNum(f[m.x]), coordNum(f[m.y]), coordNum(f[m.z])] : null;
  }
  if (pd) {
    const vals = await pd.fetchRecord(rec);
    if (!vals) return null;
    const h = pd.header, cols = h.columns.map((c) => c.toLowerCase());
    return [vals[cols.indexOf('x')], vals[cols.indexOf('y')], vals[cols.indexOf('z')]];
  }
  if (ld) {
    const { blob, header } = ld;
    const off = header.pointOffset + rec * header.recordLen;
    const dv = new DataView(await blob.slice(off, off + header.recordLen).arrayBuffer());
    const one = decodeLasRecords(dv, header, 1, rec);
    return [one.x[0], one.y[0], one.z[0]];
  }
  return null;
}

export function armMeasure() {
  _measure = NEW_MEASURE(1);
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.add('on');
  S.cv.style.cursor = 'crosshair';
  $('#meta').textContent = _isMobile() ? 'measure: tap two points — hold and slide for a crosshair' : 'measure: click two points/blocks — ⇧-click to add a vertex (a polyline; back on the first closes it)';
}

// the angle between two PLANES: click two surfaces (a mesh, a grid shown as a surface); each click
// keeps the face it met. → both attitudes, the angle between them, and their line of intersection
export function armPlaneAngle() {
  _measure = NEW_MEASURE(1, 'planes');
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.add('on');
  S.cv.style.cursor = 'crosshair';
  $('#meta').textContent = 'angle between planes: click a surface, then another (a mesh face, a grid surface)';
}

// two normals → { a: {dip, dipDir}, b, angle (0–90°, between the planes), line: {trend, plunge} | null
// (parallel planes meet nowhere) }. The line of intersection is n₁ × n₂, pointed down.
export function planeAngle(n1, n2) {
  const u = (n) => { const l = Math.hypot(...n) || 1; return n.map((v) => v / l); };
  const a = u(n1), b = u(n2);
  const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  const angle = Math.acos(Math.min(1, c)) * 180 / Math.PI;
  let x = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const xl = Math.hypot(...x);
  let line = null;
  if (xl > 1e-9) {
    x = x.map((v) => v / xl); if (x[2] > 0) x = x.map((v) => -v);
    const h = Math.hypot(x[0], x[1]);
    line = { plunge: Math.atan2(-x[2], h) * 180 / Math.PI, trend: h < 1e-12 ? 0 : ((Math.atan2(x[0], x[1]) * 180 / Math.PI) + 360) % 360 };
  }
  return { a: dipOfNormal(a), b: dipOfNormal(b), angle, line };
}
// attitudes as text, the GCU way (@gcu/stereonet's formatter): planes dip direction/dip (243/03), lines and
// directions trend→plunge (192→02; plunge positive down). One helper each, so no readout drifts.
const az3 = (v) => String(((Math.round(v) % 360) + 360) % 360).padStart(3, '0');
const att = (o) => `${az3(o.dipDir)}/${Math.round(o.dip).toString().padStart(2, '0')}`;
const fmtTP = (trend, plunge) => `${az3(trend)}°→${Math.round(plunge)}°`;

async function planeClick(cssX, cssY) {
  const hit = S.renderer.pick(cssX, cssY, S.cam, { pointPx: +$('#ptPx').value, section: currentSection() });
  const hitL = hit != null ? layerById(hit.layer) : null;
  const h = hitL && hitL.kind === 'mesh' ? await meshHitAt(hitL, cssX, cssY) : null;
  if (!h || !h.normal || (h.grid && h.grid.flat)) { $('#meta').textContent = `angle between planes: ${hitL ? `${hitL.label || hitL.name} has no face there` : 'no surface there'} — click a mesh or a grid surface`; return; }
  const local = worldToLocal(h.drawn || h.point);
  _measure.pts.push(local); _measure.ptsT.push(local); _measure.normals.push(Array.from(h.normal));
  if (_measure.pts.length === 1) {
    _measure.a = local;
    $('#meta').textContent = `angle between planes: the first is ${att(dipOfNormal(h.normal))} (dip direction/dip) — now click the second`;
    drawMeasure(); return;
  }
  _measure.b = local;
  const r = planeAngle(_measure.normals[0], _measure.normals[1]);
  _measure.planeResult = r;
  _measure.arm = 0; _measure.mouse = null;
  S.cv.style.cursor = '';
  $('#btnMeasure').classList.remove('on');
  $('#meta').textContent = `angle between planes: ${r.angle.toFixed(1)}° · ${att(r.a)} and ${att(r.b)} (dip direction/dip)`
    + (r.line ? ` · they meet along ${az3(r.line.trend)}→${Math.round(r.line.plunge).toString().padStart(2, '0')} (trend→plunge)` : ' · parallel: they never meet');
  _measure.label = `${r.angle.toFixed(1)}°`;
  drawMeasure();
}

// POINTS OF INTEREST (poi.js) pick through the same click: mode 'poi' stays armed, and every
// resolved point (TRUE world) goes to the sink poi.js registers — overlay never imports poi.js
export function armPoiPick() {
  _measure = NEW_MEASURE(1, 'poi');
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.add('on');
  S.cv.style.cursor = 'crosshair';
}

export function clearMeasure() {
  _measure = NEW_MEASURE(0);
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.remove('on');
  S.cv.style.cursor = '';
  requestRender();
}

// a click: the first point, a vertex more (add: ⇧), or the last (a plain click ends it). Clicking back
// on the first vertex (within 10 px) of three or more closes the outline: its area.
export async function measureClick(cssX, cssY, { add = false } = {}) {
  if (_measure.mode === 'planes') return planeClick(cssX, cssY);
  if (_measure.mode === 'poi') {
    const p = await clickPoint(cssX, cssY, 'point of interest');
    const sink = poiSink();
    if (p && sink) sink(localToWorld(p.trueLocal));
    return;
  }
  if (_measure.pts.length >= 3) {
    const f = projectToCss(_measure.pts[0]);
    if (f && Math.hypot(f[0] - cssX, f[1] - cssY) <= 10) { _measure.closed = true; finishMeasure(); return; }
  }
  const P = await clickPoint(cssX, cssY, 'measure');
  if (!P) return;
  const { local, trueLocal, moved } = P;
  _measure.pts.push(local); _measure.ptsT.push(trueLocal); _measure.moved = _measure.moved || moved;
  if (_measure.pts.length === 1) { _measure.a = local; _measure.aT = trueLocal; $('#meta').textContent = _isMobile() ? 'measure: now the second point' : 'measure: click the second point'; drawMeasure(); return; }
  if (add) { updateMeasureReadout(); drawMeasure(); return; }    // a vertex more: keep going
  finishMeasure();
}
// the point under a click: the pick, met ON the face (a mesh / a grid surface where the ray meets
// it) → { local (where it is drawn), trueLocal (where the data is), moved } | null (said why)
async function clickPoint(cssX, cssY, what) {
  const hit = S.renderer.pick(cssX, cssY, S.cam, { pointPx: +$('#ptPx').value, blocksAsPoints: H._viewMode === 'points', section: currentSection() });
  if (hit == null) { $('#meta').textContent = `${what}: nothing there — click on the model`; return null; }
  // a MESH (a surface grid included) has no records to anchor on: it is met where the ray meets it,
  // where it is DRAWN (meshHitAt) — the same point a pivot and worldAt use
  const hitL = layerById(hit.layer);
  const world = hitL && hitL.kind === 'mesh' ? ((await meshHitAt(hitL, cssX, cssY)) || {}).drawn || null
    : await pickHitPoint(hit, cssX, cssY);                  // ON the face you clicked, not the centroid behind it
  if (!world) { if (hitL && hitL.kind === 'mesh') $('#meta').textContent = `${what}: no surface under the cursor on ${hitL.label || hitL.name}`; return null; }
  const local = worldToLocal(world);
  // a layer drawn displaced (an exploded view, a view beside its model): the line is
  // drawn where you clicked, the numbers are read from where the data really is
  const off = S.renderer.layerOffset(hit.layer) || [0, 0, 0];
  return { local, trueLocal: [local[0] - off[0], local[1] - off[1], local[2] - off[2]], moved: off.some((v) => v !== 0) };
}

function finishMeasure() {
  const n = _measure.pts.length;
  _measure.b = _measure.pts[n - 1]; _measure.bT = _measure.ptsT[n - 1];
  _measure.arm = 0; _measure.mouse = null;
  S.cv.style.cursor = '';
  $('#btnMeasure').classList.remove('on');
  updateMeasureReadout();
  drawMeasure();
}

// the polyline's numbers, from its TRUE positions: total 3D and plan length, the last segment, the
// angle at the middle of three, a closed outline's area in plan and in 3D (its vector area)
export function measureFigures(P = _measure.ptsT.length ? _measure.ptsT : _measure.pts, closed = _measure.closed) {
  const n = P.length, segs = [];
  const ring = closed && n >= 3 ? [...P, P[0]] : P;
  let len = 0, plan = 0;
  for (let i = 1; i < ring.length; i++) { const d = [0, 1, 2].map((k) => ring[i][k] - ring[i - 1][k]); const l = Math.hypot(...d), pl = Math.hypot(d[0], d[1]); segs.push({ d, l, pl }); len += l; plan += pl; }
  const out = { n, segs, length: len, plan, closed: closed && n >= 3 };
  if (n === 3 && !out.closed) {
    const u = [0, 1, 2].map((k) => P[0][k] - P[1][k]), v = [0, 1, 2].map((k) => P[2][k] - P[1][k]);
    const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
    out.angle = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  if (out.closed) {
    let a = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
      vx += p[1] * q[2] - p[2] * q[1]; vy += p[2] * q[0] - p[0] * q[2]; vz += p[0] * q[1] - p[1] * q[0];
    }
    out.areaPlan = Math.abs(a) / 2; out.area3d = Math.hypot(vx, vy, vz) / 2;
  }
  return out;
}

// trend & plunge of the A→B line (structural convention: plunge positive
// down, trend degrees clockwise from north). Toggleable — View menu.
export let _measureTP = (() => { try { return localStorage.getItem('micro.measureTP') === 'on'; } catch { return false; } })();

export function toggleMeasureTP() {
  _measureTP = !_measureTP;
  try { localStorage.setItem('micro.measureTP', _measureTP ? 'on' : 'off'); } catch { /* ignore */ }
  if (_measure.a && _measure.b) { updateMeasureReadout(); drawMeasure(); }
}

export function updateMeasureReadout() {
  if (_measure.pts.length > 2 || _measure.closed || (_measure.arm && _measure.pts.length === 2)) return updatePolyReadout();
  const A = _measure.aT || _measure.a, B = _measure.bT || _measure.b;
  const d = [0, 1, 2].map((i) => B[i] - A[i]);
  const d3 = Math.hypot(...d), plan = Math.hypot(d[0], d[1]);
  let tp = '';
  if (_measureTP) {
    const trend = ((Math.atan2(d[0], d[1]) * 180 / Math.PI) + 360) % 360;
    const plunge = Math.atan2(-d[2], plan) * 180 / Math.PI;   // positive DOWN (mining convention)
    tp = ` · ${fmtTP(trend, plunge)}`;
  }
  $('#meta').textContent = `measure: ${d3.toFixed(2)} m · plan ${plan.toFixed(2)} m · Δz ${Math.abs(d[2]).toFixed(2)} m${tp}${_measure.moved ? ' · true positions (a layer is drawn displaced)' : ''}`;
  _measure.label = `${d3.toFixed(1)} m${tp}`;
}

const tpOf = (d) => { const plan = Math.hypot(d[0], d[1]); return ` · ${fmtTP((Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360, Math.atan2(-d[2], plan) * 180 / Math.PI)}`; };
function updatePolyReadout() {
  const F = measureFigures(), last = F.segs[F.segs.length - 1];
  const parts = [`measure: ${F.length.toFixed(2)} m along ${F.segs.length} segment${F.segs.length === 1 ? '' : 's'}`, `plan ${F.plan.toFixed(2)} m`];
  if (last) parts.push(`last ${last.l.toFixed(2)} m${_measureTP ? tpOf(last.d) : ''}`);
  if (F.angle != null) parts.push(`angle at the middle ${F.angle.toFixed(1)}°`);
  if (F.closed) parts.push(`closed: area ${F.areaPlan.toFixed(1)} m² in plan, ${F.area3d.toFixed(1)} m² in 3D`);
  if (_measure.arm) parts.push('⇧-click a vertex more, click to end');
  if (_measure.moved) parts.push('true positions (a layer is drawn displaced)');
  $('#meta').textContent = parts.join(' · ');
  _measure.label = F.closed ? `${F.areaPlan.toFixed(0)} m²` : `${F.length.toFixed(1)} m`;
}

export function projectToCss(local) {
  const m = S.cam.state.viewProj;
  const w = m[3] * local[0] + m[7] * local[1] + m[11] * local[2] + m[15];
  if (w <= 0) return null;
  const x = (m[0] * local[0] + m[4] * local[1] + m[8] * local[2] + m[12]) / w;
  const y = (m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13]) / w;
  return [(x + 1) / 2 * S.cv.clientWidth, (1 - y) / 2 * S.cv.clientHeight];
}

// the polyline before the last segment (or the rubber band), and its inner vertices
function drawMeasurePoly(svg) {
  let poly = svg.querySelector('#mPoly'), dots = svg.querySelector('#mDots');
  if (!poly) {
    const NS = 'http://www.w3.org/2000/svg';
    poly = document.createElementNS(NS, 'polyline'); poly.id = 'mPoly'; poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#ff26b3'); poly.setAttribute('stroke-width', '1.5');
    dots = document.createElementNS(NS, 'g'); dots.id = 'mDots';
    svg.insertBefore(dots, svg.firstChild); svg.insertBefore(poly, svg.firstChild);
  }
  const P = _measure.pts, done = !_measure.arm;
  const ring = _measure.closed ? [...P, P[0]] : P;
  const upto = done ? ring.length : P.length;                // done: the whole line; drawing: up to the last vertex
  const css = ring.slice(0, upto).map(projectToCss);
  poly.setAttribute('points', css.length > 1 && css.every(Boolean) ? css.map((c) => c.join(',')).join(' ') : '');
  dots.textContent = '';
  for (const c of css.slice(1, done && !_measure.closed ? -1 : undefined)) if (c) { const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); d.setAttribute('cx', c[0]); d.setAttribute('cy', c[1]); d.setAttribute('r', 3); d.setAttribute('fill', '#ff26b3'); d.setAttribute('stroke', '#121212'); d.setAttribute('stroke-width', 1); dots.appendChild(d); }
}

export function drawMeasure() {
  for (const fn of overlayDrawers) { try { fn(); } catch { /* an overlay never breaks the frame */ } }
  const svg = $('#measureSvg');
  if (!_measure.a) { svg.style.display = 'none'; return; }
  drawMeasurePoly(svg);
  if (_measure.pts.length > 1) {                           // a polyline: mLine is the rubber band from the last vertex (or nothing)
    svg.style.display = '';
    const a0 = projectToCss(_measure.a); if (a0) { $('#mA').setAttribute('cx', a0[0]); $('#mA').setAttribute('cy', a0[1]); }
    const last = projectToCss(_measure.pts[_measure.pts.length - 1]), B = $('#mB'), T = $('#mLabel'), L = $('#mLine'), C = $('#mLineCase');
    const seg = (x1, y1, x2, y2) => { for (const el of [C, L]) { el.setAttribute('x1', x1); el.setAttribute('y1', y1); el.setAttribute('x2', x2); el.setAttribute('y2', y2); } };
    if (_measure.arm && _measure.mouse && last) { seg(last[0], last[1], _measure.mouse[0], _measure.mouse[1]); L.setAttribute('stroke-dasharray', '5 4'); C.setAttribute('stroke-dasharray', '5 4'); }
    else if (last) seg(last[0], last[1], last[0], last[1]);
    if (last && !_measure.closed) { B.style.display = ''; B.setAttribute('cx', last[0]); B.setAttribute('cy', last[1]); } else B.style.display = 'none';
    const anchor = last || a0;
    if (anchor) { T.setAttribute('x', anchor[0] + 8); T.setAttribute('y', anchor[1] - 8); }
    T.textContent = _measure.arm ? '' : (_measure.label || '');
    return;
  }
  const a = projectToCss(_measure.a);
  const pending = !_measure.b;                             // rubber-band: A picked, B follows the mouse
  const b = pending ? _measure.mouse : projectToCss(_measure.b);
  if (!a) { svg.style.display = 'none'; return; }
  svg.style.display = '';
  $('#mA').setAttribute('cx', a[0]); $('#mA').setAttribute('cy', a[1]);
  const L = $('#mLine'), C = $('#mLineCase'), B = $('#mB'), T = $('#mLabel');
  const seg = (x1, y1, x2, y2) => { for (const el of [C, L]) { el.setAttribute('x1', x1); el.setAttribute('y1', y1); el.setAttribute('x2', x2); el.setAttribute('y2', y2); } };
  if (!b) {                                                // A alone (mouse not moved yet)
    seg(a[0], a[1], a[0], a[1]);
    B.style.display = 'none'; T.textContent = '';
    return;
  }
  seg(a[0], a[1], b[0], b[1]);
  L.setAttribute('stroke-dasharray', pending ? '5 4' : '');
  C.setAttribute('stroke-dasharray', pending ? '5 4' : '');
  B.style.display = pending ? 'none' : '';
  if (!pending) { B.setAttribute('cx', b[0]); B.setAttribute('cy', b[1]); }
  T.setAttribute('x', (a[0] + b[0]) / 2 + 8); T.setAttribute('y', (a[1] + b[1]) / 2 - 6);
  T.textContent = pending ? '' : (_measure.label || '');
}

// ── compass: the classic folded north dart (two triangles, west half dark),
// living on the ground plane and projected through the CAMERA — it foreshortens
// in oblique views, collapses edge-on, and flips seen from below, so it reads
// as real orientation, not a decal. Ring + ticks stay screen-fixed. ──
// a plane (frame-local normal n, offset d) intersected with a bbox: crossings
// on the 12 edges, ordered around their centroid in an in-plane basis, projected
// through the camera → an SVG points string (null when degenerate / behind eye).
export function planeBboxCssPts(n, d, b) {
  const corner = (c) => [b[(c & 1) ? 3 : 0], b[(c & 2) ? 4 : 1], b[(c & 4) ? 5 : 2]];
  const sd = (p) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d;
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const P = [];
  for (const [i, j] of EDGES) {
    const a = corner(i), c2 = corner(j), sa = sd(a), sb = sd(c2);
    if ((sa > 0) === (sb > 0)) continue;
    const t = sa / (sa - sb);
    P.push([a[0] + t * (c2[0] - a[0]), a[1] + t * (c2[1] - a[1]), a[2] + t * (c2[2] - a[2])]);
  }
  if (P.length < 3) return null;
  const c0 = [0, 1, 2].map((k) => P.reduce((s2, p) => s2 + p[k], 0) / P.length);
  let u = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [1, 0, 0];
  const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w2 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const ang = (p) => Math.atan2((p[0] - c0[0]) * w2[0] + (p[1] - c0[1]) * w2[1] + (p[2] - c0[2]) * w2[2],
                                (p[0] - c0[0]) * u[0] + (p[1] - c0[1]) * u[1] + (p[2] - c0[2]) * u[2]);
  P.sort((a, c2) => ang(a) - ang(c2));
  const vp = S.cam.state.viewProj, r = S.cv.getBoundingClientRect();
  const pts = [];
  for (const p of P) {
    const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (cw < 1e-6) return null;                              // a vertex behind the eye — skip this frame
    pts.push(`${((cx / cw) * 0.5 + 0.5) * r.width},${(0.5 - (cy / cw) * 0.5) * r.height}`);
  }
  return pts;
}

// the section plane made visible: a dashed outline in the overlay SVG.
export function drawSectionPlane() {
  const svg = $('#secSvg');
  const sec = $('#secPlaneVis').checked ? currentSection() : null;
  if (!sec || !S.cam.state.viewProj) { svg.style.display = 'none'; return; }
  const pts = planeBboxCssPts(sec.n, sec.d0, rendererDocBbox());
  if (!pts) { svg.style.display = 'none'; return; }
  $('#secPoly').setAttribute('points', pts.join(' '));
  svg.style.display = '';
}

// ── the swath band GHOST: hovering the swath plot lights the band's slab on
// the 3D (both slab faces × the layer bbox — same construction as the section
// outline). t values are WORLD projections along dir; sticky = a dragged range
// held for select-in-3D. ──
export let _swathBand = null;   // { a, b, dir:[3], bbox (frame-local), sticky }

export function setSwathBand(band) { _swathBand = band; drawSwathBand(); }

export function drawSwathBand() {
  const svg = $('#bandSvg');
  const B = _swathBand;
  if (!B || !S.cam.state.viewProj) { if (svg) svg.style.display = 'none'; return; }
  const o = sceneOrigin();
  const dLoc = (t) => t - (B.dir[0] * o[0] + B.dir[1] * o[1] + B.dir[2] * o[2]);   // world t → frame-local plane offset
  const ptsA = planeBboxCssPts(B.dir, dLoc(B.a), B.bbox);
  const ptsB = planeBboxCssPts(B.dir, dLoc(B.b), B.bbox);
  if (!ptsA && !ptsB) { svg.style.display = 'none'; return; }
  const col = B.sticky ? '#b48ead' : '#4a78b0';              // violet = held range, info = hover
  const pA = $('#bandPolyA'), pB = $('#bandPolyB'), lab = $('#bandLabel');
  pA.setAttribute('points', ptsA ? ptsA.join(' ') : ''); pA.setAttribute('stroke', col);
  pA.setAttribute('fill', B.sticky ? 'rgba(180,142,173,0.10)' : 'rgba(74,120,176,0.10)');
  pB.setAttribute('points', ptsB ? ptsB.join(' ') : ''); pB.setAttribute('stroke', col);
  if (ptsA && ptsA.length) { const [x, y] = ptsA[0].split(','); lab.setAttribute('x', +x + 6); lab.setAttribute('y', +y - 6); lab.textContent = B.label || ''; }
  else lab.textContent = '';
  svg.style.display = '';
}

export function drawCompass() {
  const v = S.cam.state.view;
  if (!v) return;                                          // camera not updated yet (first paint comes with the loop)
  { // camera trend → plunge, far right of the footer (plunge positive down)
    const st = S.cam.state;
    const f = [st.target[0] - st.eye[0], st.target[1] - st.eye[1], st.target[2] - st.eye[2]];
    const plan = Math.hypot(f[0], f[1]);
    const trend = ((Math.atan2(f[0], f[1]) * 180 / Math.PI) + 360) % 360;
    const plunge = Math.atan2(-f[2], plan) * 180 / Math.PI;
    $('#camTP').textContent = fmtTP(trend, plunge);
  }
  const R = [v[0], v[4], v[8]], U = [v[1], v[5], v[9]];    // camera basis (world → screen)
  const SC = 27, cxp = 37, cyp = 37;
  const pr = (d) => [cxp + (R[0] * d[0] + R[1] * d[1] + R[2] * d[2]) * SC,
                     cyp - (U[0] * d[0] + U[1] * d[1] + U[2] * d[2]) * SC];
  const tip = pr([0, 0.95, 0]), notch = pr([0, -0.22, 0]);
  const bL = pr([-0.5, -0.82, 0]), bR = pr([0.5, -0.82, 0]);
  $('#cmpW').setAttribute('points', `${tip} ${bL} ${notch}`);
  $('#cmpE').setAttribute('points', `${tip} ${notch} ${bR}`);
  const nx = R[1] * SC, ny = -U[1] * SC;                     // projected north (screen px)
  const m = Math.hypot(nx, ny);
  const T = $('#cmpN');
  if (m < 3) T.setAttribute('opacity', '0');               // north points at/away from the eye
  else {
    T.setAttribute('opacity', '1');
    T.setAttribute('x', cxp + (nx / m) * 24);
    T.setAttribute('y', cyp + (ny / m) * 24);
  }
}
