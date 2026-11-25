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
import { pickHitPoint, meshHitAt } from './pick.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setOverlayHooks): _viewMode
let H = {};
export function setOverlayHooks(h) { H = h; }

// ── measure (m): two picks -> distance. Endpoints come from the SOURCE RECORDS
// (block centroids / point coordinates) — exact, not screen unprojections. The
// overlay re-projects each drawn frame, so it rides orbits. Esc clears. ──
export let _measure = { arm: 0, a: null, b: null, mouse: null };   // a/b = frame-local [x,y,z]; mouse = css px rubber-band end

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
  _measure = { arm: 1, a: null, b: null, mouse: null };
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.add('on');
  S.cv.style.cursor = 'crosshair';
  $('#meta').textContent = _isMobile() ? 'measure: tap two points — hold and slide for a crosshair' : 'measure: click two points/blocks';
}

export function clearMeasure() {
  _measure = { arm: 0, a: null, b: null, mouse: null };
  $('#measureSvg').style.display = 'none';
  $('#btnMeasure').classList.remove('on');
  S.cv.style.cursor = '';
  requestRender();
}

export async function measureClick(cssX, cssY) {
  const hit = S.renderer.pick(cssX, cssY, S.cam, { pointPx: +$('#ptPx').value, blocksAsPoints: H._viewMode === 'points', section: currentSection() });
  if (hit == null) { $('#meta').textContent = `measure: nothing there — ${_measure.a ? 'the second point' : 'two points'} on the model`; return; }
  // a MESH (a surface grid included) has no records to anchor on: it is met where the ray meets it,
  // where it is DRAWN (meshHitAt) — the same point a pivot and worldAt use
  const hitL = layerById(hit.layer);
  const world = hitL && hitL.kind === 'mesh' ? ((await meshHitAt(hitL, cssX, cssY)) || {}).drawn || null
    : await pickHitPoint(hit, cssX, cssY);                  // ON the face you clicked, not the centroid behind it
  if (!world) { if (hitL && hitL.kind === 'mesh') $('#meta').textContent = `measure: no surface under the cursor on ${hitL.label || hitL.name}`; return; }
  const local = [world[0] - S.frame.origin[0], world[1] - S.frame.origin[1], world[2] - S.frame.origin[2]];
  // a layer drawn displaced (an exploded view, a view beside its model): the line is
  // drawn where you clicked, the numbers are read from where the data really is
  const off = S.renderer.layerOffset(hit.layer) || [0, 0, 0];
  const trueLocal = [local[0] - off[0], local[1] - off[1], local[2] - off[2]];
  const moved = off.some((v) => v !== 0);
  if (!_measure.a) { _measure.a = local; _measure.aT = trueLocal; _measure.moved = moved; $('#meta').textContent = _isMobile() ? 'measure: now the second point' : 'measure: click the second point'; drawMeasure(); }
  else {
    _measure.b = local; _measure.bT = trueLocal; _measure.moved = _measure.moved || moved; _measure.arm = 0; _measure.mouse = null;
    S.cv.style.cursor = '';
    $('#btnMeasure').classList.remove('on');
    updateMeasureReadout();
    drawMeasure();
  }
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
  const A = _measure.aT || _measure.a, B = _measure.bT || _measure.b;
  const d = [0, 1, 2].map((i) => B[i] - A[i]);
  const d3 = Math.hypot(...d), plan = Math.hypot(d[0], d[1]);
  let tp = '';
  if (_measureTP) {
    const trend = ((Math.atan2(d[0], d[1]) * 180 / Math.PI) + 360) % 360;
    const plunge = Math.atan2(-d[2], plan) * 180 / Math.PI;   // positive DOWN (mining convention)
    tp = ` · ${Math.round(plunge)}°→${String(Math.round(trend)).padStart(3, '0')}°`;
  }
  $('#meta').textContent = `measure: ${d3.toFixed(2)} m · plan ${plan.toFixed(2)} m · Δz ${Math.abs(d[2]).toFixed(2)} m${tp}${_measure.moved ? ' · true positions (a layer is drawn displaced)' : ''}`;
  _measure.label = `${d3.toFixed(1)} m${tp}`;
}

export function projectToCss(local) {
  const m = S.cam.state.viewProj;
  const w = m[3] * local[0] + m[7] * local[1] + m[11] * local[2] + m[15];
  if (w <= 0) return null;
  const x = (m[0] * local[0] + m[4] * local[1] + m[8] * local[2] + m[12]) / w;
  const y = (m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13]) / w;
  return [(x + 1) / 2 * S.cv.clientWidth, (1 - y) / 2 * S.cv.clientHeight];
}

export function drawMeasure() {
  const svg = $('#measureSvg');
  if (!_measure.a) { svg.style.display = 'none'; return; }
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
  const o = S.frame ? S.frame.origin : [0, 0, 0];
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
  { // camera plunge → trend, far right of the footer (mining convention, positive down)
    const st = S.cam.state;
    const f = [st.target[0] - st.eye[0], st.target[1] - st.eye[1], st.target[2] - st.eye[2]];
    const plan = Math.hypot(f[0], f[1]);
    const trend = ((Math.atan2(f[0], f[1]) * 180 / Math.PI) + 360) % 360;
    const plunge = Math.atan2(-f[2], plan) * 180 / Math.PI;
    $('#camTP').textContent = `${String(Math.round(plunge)).padStart(3)}°→${String(Math.round(trend)).padStart(3, '0')}°`;
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
