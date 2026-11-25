// micro placement — the "Placement…" window and the in-place re-read.
//
// One window per layer, three ways to set its rigid placement (a 3D similarity, src/placement-core.js):
//   typed       shift, ω/φ/κ, one uniform scale, about a pivot
//   control     ≥ 2 pairs local → true (2D: shift + κ + scale; 3D: ≥ 3, all seven), least squares
//   points      (Horn / Umeyama), each pair's residual listed and coloured, a use / drop toggle per
//               pair; the local point can be PICKED on the layer in the 3D view, and pairs PASTED
//   CRS change  from the layer's stated CRS to the project's: the true reprojection sampled over the
//               layer's extent, the best similarity fitted, its MAX deviation reported
// Never refuses — INDICATES: whatever the residual, the placement applies, and its residual is shown
// against the user's tolerance (green / amber / red) on the layer (properties), on the status line
// and in lineage.
//
// setLayerPlacement(L, placement | null) is the one door: it stores the placement and re-reads the
// layer IN PLACE (same layer, same records — paint, selection, calc columns, styling all stay).
import { S, layerById, requestRender, FRAME_DRAWERS } from './state.js';
import { projectToCss } from './overlay.js';
import { floatWin, focusWindow } from './windows.js';
import {
  compilePlacement, fitSimilarity, placementFromFit, placementFromM, crsSamplePoints, fitCrsChange, invertP, applyP, placeBbox,
  anglesFromR, residualClass, RESIDUAL_COLOR, fmtLen, describePlacement, zOnlyP, composeP,
} from './placement-core.js';
import { layerPlacementM, placementTolerance, setPlacementTolerance, fileHeader } from './placement.js';
import { openBlocksBlob, openDmBlob } from './open-blocks.js';
import { openMeshDoc } from './open-mesh.js';
import { openGridBlob } from './open-grid.js';
import { openLasBlob, openPlyBlob } from './open.js';
import { reReadMesh } from './records.js';
import { captureLayerStyling, applyLayerStyling } from './reopen.js';
import { pinEvictLayer } from './columns.js';
import { applyLayerSelection } from './selection.js';
import { refilterLayer } from './filter.js';
import { markProjectDirty } from './project.js';
import { renderLayers } from './layers-panel.js';
import { refreshProps } from './props.js';
import { pickHitPoint, meshHitAt } from './pick.js';
import { currentSection } from './section.js';
import { projectCrs, transformPoints, describePath, crsLabel, crsToJSON, lookupEpsg, crsFromDefinition } from './crs.js';
import { rebuildSurface } from './surfaces.js';
import { layerWorldBbox } from './gridtools.js';
import { recomputeUnion } from './layers.js';
import { clearSceneFrame, worldToLocal } from './coords.js';
const $ = (s) => document.querySelector(s);
const nameOf = (L) => (L ? L.label || L.name : '?');

// ── which layers take a placement ────────────────────────────────────────────
export function canPlace(L) {
  if (!L || L.viewOf != null || L.dh) return false;
  const d = L.docs || {};
  return !!(d.blockDoc || d.meshDoc || d.gridDoc || d.lasDoc || d.plyDoc);
}
const isSurfaceGrid = (L) => !!(L && L.docs && L.docs.gridDoc && L.gridSurface);

// the layer's extent in its OWN frame (its file's coordinates): a block model's file bbox, else the
// world box taken back through the current placement (an AABB — enough to sample a CRS change over)
export function layerLocalBbox(L) {
  const bd = L.docs && L.docs.blockDoc;
  if (bd && bd.header) { const fh = fileHeader(bd.header); if (fh.bbox) return { min: [...fh.bbox.min], max: [...fh.bbox.max] }; }
  const w = layerWorldBbox(L);
  if (!w) return null;
  const box = { min: [w[0], w[1], w[2]], max: [w[3], w[4], w[5]] }, M = layerPlacementM(L);
  return M ? placeBbox(invertP(M), box) : box;
}
/** a world point → the layer's own (local) coordinates, through its current placement */
export function layerLocalPoint(L, world) {
  const M = layerPlacementM(L);
  return M ? applyP(invertP(M), world[0], world[1], world[2], [0, 0, 0]) : [world[0], world[1], world[2]];
}

// ── the one door: store + re-read in place ───────────────────────────────────
/**
 * Set (or clear, with null) a layer's placement and re-read it in place. The placement is applied
 * whatever its residual (never refused — indicated). → the layer.
 */
export async function setLayerPlacement(L, placement, { quiet = false } = {}) {
  if (!canPlace(L)) throw new Error(`${nameOf(L)} can't take a placement (blocks, meshes, grids and point clouds can; drillholes and views can't)`);
  const M = placement ? compilePlacement(placement) : null;
  if (placement && isSurfaceGrid(L) && M && !zOnlyP(M)) throw new Error(`${nameOf(L)} is shown as a surface (z = f(x, y)): it takes a rotation about Z only — drop ω / φ, or show it as points`);
  L.placement = M ? { ...placement } : null;
  if (!L.placement) delete L.placement;
  await rePlaceLayer(L);
  markProjectDirty();
  renderLayers(); refreshProps();
  if (!quiet) $('#meta').textContent = statusOf(L);
  dispatchEvent(new CustomEvent('micro:placement', { detail: { id: L.id, placement: L.placement || null } }));
  return L;
}
export function statusOf(L) {
  if (!L.placement) return `${nameOf(L)} — not placed: read in its file's own coordinates`;
  const r = L.placement.maxResidual, tol = placementTolerance();
  const tag = Number.isFinite(r) ? ` — ${({ ok: 'within', warn: 'over (≤3×)', bad: 'well over' })[residualClass(r, tol)]} the ${fmtLen(tol)} tolerance` : '';
  return `${nameOf(L)} placed · ${describePlacement(L.placement)}${tag}`;
}

// re-read the layer from its source with its (new) placement — the same layer object, so its
// records' state (paint, selection, calc columns, styling) rides through
export async function rePlaceLayer(L) {
  const d = L.docs || {};
  const style = captureLayerStyling(L);
  const sel = L._selMask && L._selCount ? L._selMask : null, filterExpr = L.filterExpr, vis = L.visible;
  // a lone layer moved far (a mine grid → UTM) re-plants the scene's frame on its new place, so
  // nothing is drawn in float32 millions of metres from the origin
  // (not a grid shown as a surface: its relief is built against the frame before the frame is planted)
  const alone = S.layers.filter((x) => x.viewOf == null).length === 1 && !(d.gridDoc && L.gridSurface);
  if (alone) clearSceneFrame();
  const first = alone;
  if (d.blockDoc) {
    const doc = d.blockDoc, h = doc.header, fh = fileHeader(h);
    if (h.dm) await openDmBlob(doc.blob, doc.name, { layer: L.id, first, keepFilter: true, forcePoints: doc.forcePoints, mapping: h.mapping, cached: fh.bbox ? { ...fh } : null });
    else await openBlocksBlob(doc.blob, doc.name, { layer: L.id, first, keepFilter: true, forcePoints: doc.forcePoints, provider: async () => ({ header: fh, streamChunks: doc.rawStream || doc.streamChunks, parquet: doc.parquet }) });
  } else if (d.meshDoc) {
    // the mesh's CPU geometry caches live on the LAYER (the by-solid topology, its BVH, the
    // variants): built from the old coordinates, they would keep answering in the old place
    L._solidMesh = null; L._solidBVH = null; L._variants = null;
    const md = d.meshDoc, prebuiltKinds = /^(dm-wireframe|dxf|wfr)$/.test(md.header.format || '');
    if (md.header.soup && !prebuiltKinds) await openMeshDoc(md.blob, md.name, { layer: L.id, first, forceSoup: true, tint: L.tint, opacity: L.opacity });
    else await openMeshDoc(md.blob, md.name, { layer: L.id, first, prebuilt: await reReadMesh({ ...md, placeM: null }), ptBlob: md.ptBlob, tint: L.tint, opacity: L.opacity, forceSoup: !!md.header.soup });
  } else if (d.gridDoc) {
    const gd = d.gridDoc;
    S.renderer.removeLayer(L.id);
    await openGridBlob(gd.blob, L.name, { layer: L.id, first, surface: !!L.gridSurface, flatZ: L.gridSurface ? L.surfaceFlatZ : null, band: gd.grid.band || 0, smooth: L.surfaceSmooth !== false, worldFile: gd.worldFile || null });
    if (L.gridSurface && (L.drapeSource || L.surfaceRange)) rebuildSurface(L);
  } else if (d.lasDoc) await openLasBlob(d.lasDoc.blob, L.name, { layer: L.id, first });
  else if (d.plyDoc) await openPlyBlob(d.plyDoc.blob, d.plyDoc.name || L.name, { layer: L.id, first });
  // what was derived from the coordinates is recomputed, not served stale
  L._colStats = null; L._bands = null; L._calcFns = null; L._catCounts = null; L._filterMask = null;
  pinEvictLayer(L.id);
  applyLayerStyling(L, style);
  if (vis === false) { L.visible = false; S.renderer.setLayerVisible(L.id, false); }
  if (sel) { L._selMask = sel; applyLayerSelection(L); }
  if (filterExpr && (d.blockDoc || d.lasDoc || d.plyDoc)) await refilterLayer(L, filterExpr);
  recomputeUnion();
  dispatchEvent(new CustomEvent('micro:layer-reread', { detail: { id: L.id } }));
  requestRender();
}

// ── picking a point on the layer (a control point's local coordinates) ──────────
/** arm ONE click on the 3D view → the world point on what was clicked (resolves null on Escape) */
export function pickWorldPoint({ layer = null } = {}) {
  const cv = S.cv;
  return new Promise((resolve) => {
    const prev = cv.style.cursor; cv.style.cursor = 'crosshair';
    const done = (v) => { cv.removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); cv.style.cursor = prev; resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    const onDown = async (e) => {
      if (e.button !== 0) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      // a MESH: the exact ray–triangle hit (the point ON the surface — an outcrop's control point)
      const LM = layer != null ? layerById(layer) : null;
      if (LM && LM.kind === 'mesh') { const mh = await meshHitAt(LM, x, y).catch(() => null); if (mh && mh.point) { done([...mh.point]); return; } }
      const hit = S.renderer.pick(x, y, S.cam, { pointPx: +(($('#ptPx') || {}).value || 2), section: currentSection() });
      if (hit == null || (layer != null && hit.layer !== layer)) { $('#meta').textContent = layer != null ? 'placement: click on the layer being placed (Esc cancels)' : 'placement: nothing there (Esc cancels)'; return; }
      done(await pickHitPoint(hit, x, y));
    };
    cv.addEventListener('pointerdown', onDown, true);
    addEventListener('keydown', onKey, true);
  });
}

// ── pasting control points ───────────────────────────────────────────────────
/**
 * A pasted table of pairs → [{ from, to }]. One pair a line: six numbers (lx ly lz X Y Z) or four
 * (lx ly X Y — 2D), separated by tabs / commas / semicolons / spaces; a decimal comma is read when
 * the separator isn't a comma; a leading id column and a header line are skipped.
 */
export function parseControlPoints(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const sep = /\t/.test(line) ? /\t+/ : /;/.test(line) ? /\s*;\s*/ : /,/.test(line) && !/\d,\d+\s*[,;\s]\s*\d/.test(line.replace(/,(?=\d)/g, '')) ? /\s*,\s*/ : /\s+/;
    let cells = line.split(sep).map((c) => c.trim()).filter((c) => c !== '');
    const numify = (c) => +(sep.source.includes(',') ? c : c.replace(',', '.'));
    let nums = cells.map(numify);
    if (nums.length && !Number.isFinite(nums[0]) && nums.slice(1).every(Number.isFinite)) { cells = cells.slice(1); nums = nums.slice(1); }   // an id column
    if (!nums.every(Number.isFinite)) continue;                                                                                                 // a header / a note
    if (nums.length === 6) out.push({ from: nums.slice(0, 3), to: nums.slice(3, 6) });
    else if (nums.length === 4) out.push({ from: [nums[0], nums[1], 0], to: [nums[2], nums[3], 0] });
  }
  return out;
}

// ── fitting to a CRS change ──────────────────────────────────────────────────
/**
 * The best similarity taking the layer from `fromCrs` (its stated system) to the project's CRS:
 * the true reprojection (@gcu/proj, horizontal; heights carried) sampled on a 9×9 grid through the
 * layer's extent at its floor and roof, the similarity fitted in plan, its deviation checked at
 * 17×17 points it never saw. → the stored placement { source: 'crs-fit', maxResidual (the max 3D
 * deviation), hMax, vMax, … } — whatever the deviation.
 */
export function fitLayerToCrs(L, fromCrs, toCrs = projectCrs()) {
  if (!toCrs) throw new Error('the project has no coordinate system — set one first (the CRS chip in the top bar)');
  if (!fromCrs) throw new Error('give the layer\'s coordinate system');
  const bb = layerLocalBbox(L);
  if (!bb) throw new Error(`${nameOf(L)}: no extent yet`);
  const src = crsSamplePoints(bb, 9), dst = transformPoints(fromCrs, toCrs, src);
  const fit = fitCrsChange(src, dst);
  const dense = crsSamplePoints(bb, 17), truth = transformPoints(fromCrs, toCrs, dense);
  let hMax = fit.hMax, vMax = fit.vMax, max = fit.max;
  const o = [0, 0, 0];
  for (let i = 0; i < dense.length; i++) {
    applyP(fit.M, dense[i][0], dense[i][1], dense[i][2], o);
    const h = Math.hypot(o[0] - truth[i][0], o[1] - truth[i][1]), v = Math.abs(o[2] - dense[i][2]);
    if (h > hMax) hMax = h; if (v > vMax) vMax = v; if (Math.hypot(h, v) > max) max = Math.hypot(h, v);
  }
  const mid = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
  let path = null; try { path = describePath(fromCrs, toCrs, { at: mid }).text; } catch { /* a path text is a nicety */ }
  return placementFromM(fit.M, 'crs-fit', {
    fromCrs: crsToJSON(fromCrs), toCrs: crsToJSON(toCrs), fromCrsLabel: crsLabel(fromCrs), toCrsLabel: crsLabel(toCrs),
    maxResidual: max, hMax, vMax, samples: src.length, checked: dense.length, path,
    extent: { min: bb.min, max: bb.max },
  });
}

// ── the window ───────────────────────────────────────────────────────────────
const _open = new Map();                                   // layer id → state
const CSS = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 8px;align-items:center;font:12px var(--mono, monospace)';
const inp = (v, w = '100%') => { const e = document.createElement('input'); e.type = 'text'; e.spellcheck = false; e.value = v == null ? '' : String(v); e.style.cssText = `width:${w};box-sizing:border-box;font:12px var(--mono, monospace)`; return e; };
const btn = (t, fn, title = '') => { const b = document.createElement('button'); b.textContent = t; b.title = title; b.onclick = fn; return b; };
const div = (css = '', text = '') => { const d = document.createElement('div'); if (css) d.style.cssText = css; if (text) d.textContent = text; return d; };
const nOr = (v, d = 0) => { const x = +String(v).replace(',', '.'); return Number.isFinite(x) ? x : d; };

export function openPlacementDialog(L, { tab = null } = {}) {
  if (!canPlace(L)) { $('#meta').textContent = `${nameOf(L)} can't take a placement`; return null; }
  if (_open.has(L.id)) { const st = _open.get(L.id); focusWindow(st.win.el); if (tab) st.show(tab); return st; }
  const p0 = L.placement || null, a0 = p0 ? anglesFromR(compilePlacement(p0) ? compilePlacement(p0).R : [1, 0, 0, 0, 1, 0, 0, 0, 1]) : { omega: 0, phi: 0, kappa: 0 };
  const win = floatWin({ title: `placement · ${nameOf(L)}`, sub: '', w: 640, h: 520, onClose: () => { _open.delete(L.id); requestRender(); } });
  win.el.dataset.placement = String(L.id);
  const st = { L, win, pairs: (p0 && p0.source === 'gcp' && Array.isArray(p0.pairs) ? p0.pairs : []).map((q) => ({ from: q.from.slice(), to: q.to.slice(), use: q.use !== false })), fit: null, crsFit: null, mode: (p0 && p0.mode) || 'auto' };
  _open.set(L.id, st);
  const body = win.body; body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:8px;overflow:auto';
  // the current placement, coloured against the tolerance
  const cur = div('font:12px var(--mono, monospace);padding:4px 6px;border:1px solid var(--bd2, #444);border-radius:4px');
  cur.dataset.placementCurrent = '1';
  const tolRow = div('display:flex;gap:6px;align-items:center;font:12px var(--mono, monospace)');
  const tol = inp(placementTolerance(), '80px'); tol.dataset.placementTol = '1';
  tol.onchange = () => { setPlacementTolerance(nOr(tol.value, 0.05)); paintCurrent(); renderFit(); };
  tolRow.append('tolerance (m)', tol, div('color:var(--muted, #888)', 'residuals: green within · amber within 3× · red beyond — always applied, always shown'));
  const tabs = div('display:flex;gap:4px'), panes = {};
  const show = (k) => { for (const [n, pn] of Object.entries(panes)) { pn.style.display = n === k ? '' : 'none'; } for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === k); st.tab = k; requestRender(); };
  st.show = show;
  for (const [k, t] of [['typed', 'typed'], ['gcp', 'control points'], ['crs', 'CRS change']]) { const b = btn(t, () => show(k)); b.dataset.tab = k; tabs.append(b); }
  const surf = isSurfaceGrid(L);

  // — typed —
  const ty = div('display:flex;flex-direction:column;gap:6px'); panes.typed = ty;
  const f = {
    tx: inp(p0 ? p0.tx : 0), ty: inp(p0 ? p0.ty : 0), tz: inp(p0 ? p0.tz : 0),
    omega: inp(+a0.omega.toFixed(9)), phi: inp(+a0.phi.toFixed(9)), kappa: inp(+a0.kappa.toFixed(9)), scale: inp(p0 ? p0.scale : 1),
    px: inp(p0 && p0.pivot ? p0.pivot[0] : 0), py: inp(p0 && p0.pivot ? p0.pivot[1] : 0), pz: inp(p0 && p0.pivot ? p0.pivot[2] : 0),
  };
  for (const [k, e] of Object.entries(f)) e.dataset.placementField = k;
  if (surf) { f.omega.disabled = f.phi.disabled = true; f.omega.title = f.phi.title = 'a surface (z = f(x, y)) takes a rotation about Z only'; }
  const g1 = div(CSS);
  g1.append(div('', 'shift X'), f.tx, div('', 'Y'), f.ty, div('', 'Z'), f.tz, div('', 'scale'), f.scale,
    div('', 'ω (about X)°'), f.omega, div('', 'φ (about Y)°'), f.phi, div('', 'κ (about Z)°'), f.kappa, div('', ''), div('', ''),
    div('', 'pivot X'), f.px, div('', 'Y'), f.py, div('', 'Z'), f.pz);
  const centre = btn('pivot = the layer\'s centre', () => { const b = layerLocalBbox(L); if (b) { f.px.value = +((b.min[0] + b.max[0]) / 2).toFixed(3); f.py.value = +((b.min[1] + b.max[1]) / 2).toFixed(3); f.pz.value = +((b.min[2] + b.max[2]) / 2).toFixed(3); } });
  ty.append(g1, div('display:flex;gap:6px;flex-wrap:wrap', ''), div('color:var(--muted, #888);font-size:11px', `world = pivot + shift + scale·R·(local − pivot); R = Rz(κ)·Ry(φ)·Rx(ω), angles counter-clockwise looking down each axis (κ: counter-clockwise from above).${surf ? ' A surface takes κ only.' : ''}`));
  ty.children[1].append(centre, btn('apply typed', async () => { await applyPlacement(typedPlacement()); }, 'set the placement from these numbers'));
  const typedPlacement = () => ({ tx: nOr(f.tx.value), ty: nOr(f.ty.value), tz: nOr(f.tz.value), omega: surf ? 0 : nOr(f.omega.value), phi: surf ? 0 : nOr(f.phi.value), kappa: nOr(f.kappa.value), scale: nOr(f.scale.value, 1) || 1, pivot: [nOr(f.px.value), nOr(f.py.value), nOr(f.pz.value)], source: 'typed' });

  // — control points —
  const gp = div('display:flex;flex-direction:column;gap:6px'); panes.gcp = gp;
  const tbl = document.createElement('table'); tbl.style.cssText = 'border-collapse:collapse;font:11px var(--mono, monospace);width:100%'; tbl.dataset.placementPairs = '1';
  const fitLine = div('font:12px var(--mono, monospace)'); fitLine.dataset.placementFit = '1';
  const modeSel = document.createElement('select'); for (const [v, t] of [['auto', 'auto (3D with heights + ≥3 points)'], ['2d', '2D — shift + κ + scale (≥2)'], ['3d', '3D — all seven (≥3)']]) modeSel.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
  modeSel.value = st.mode; modeSel.onchange = () => { st.mode = modeSel.value; refit(); };
  modeSel.dataset.placementMode = '1';
  const pasteBox = document.createElement('textarea'); pasteBox.rows = 3; pasteBox.placeholder = 'paste pairs: lx ly lz X Y Z (or lx ly X Y) — one a line; tab, comma, semicolon or space'; pasteBox.style.cssText = 'width:100%;box-sizing:border-box;font:11px var(--mono, monospace)'; pasteBox.dataset.placementPaste = '1';
  const bar = div('display:flex;gap:6px;flex-wrap:wrap;align-items:center');
  bar.append(btn('+ pair', () => { st.pairs.push({ from: [0, 0, 0], to: [0, 0, 0], use: true }); renderPairs(); }),
    btn('add pasted', () => { const got = parseControlPoints(pasteBox.value); st.pairs.push(...got.map((q) => ({ ...q, use: true }))); pasteBox.value = ''; renderPairs(); refit(); $('#meta').textContent = `placement: ${got.length} pair${got.length === 1 ? '' : 's'} added`; }),
    modeSel, btn('apply fit', async () => { if (!st.fit) { refit(); if (!st.fit) return; } await applyPlacement(placementFromFit(st.fit, 'gcp', { pairs: st.pairs.map((q) => ({ from: q.from, to: q.to, use: q.use })), used: st.fit.used, residuals: st.fit.residuals.map((r) => +r.d.toPrecision(6)) })); }));
  gp.append(div('color:var(--muted, #888);font-size:11px', 'local = the layer\'s own coordinates (⌖ picks one on the layer in the 3D view) · true = where that point really is'), tbl, bar, pasteBox, fitLine);
  const renderPairs = () => {
    tbl.textContent = '';
    const hr = document.createElement('tr');
    for (const h of ['#', 'use', 'local x', 'y', 'z', '', 'true X', 'Y', 'Z', 'residual', '']) { const th = document.createElement('th'); th.textContent = h; th.style.cssText = 'text-align:left;font-weight:normal;color:var(--muted, #888)'; hr.append(th); }
    tbl.append(hr);
    st.pairs.forEach((q, i) => {
      const tr = document.createElement('tr'); tr.dataset.pair = String(i);
      const cell = (el) => { const td = document.createElement('td'); td.append(el); tr.append(td); return td; };
      const use = document.createElement('input'); use.type = 'checkbox'; use.checked = q.use; use.onchange = () => { q.use = use.checked; refit(); };
      use.dataset.pairUse = String(i);
      cell(div('color:var(--muted, #888)', String(i + 1)));
      cell(use);
      for (let a = 0; a < 3; a++) { const e = inp(q.from[a], '90px'); e.onchange = () => { q.from[a] = nOr(e.value); refit(); }; cell(e); }
      cell(btn('⌖', async () => {
        $('#meta').textContent = `placement: click a point on ${nameOf(L)} (Esc cancels)`;
        const w = await pickWorldPoint({ layer: L.id });
        if (!w) return;
        q.from = layerLocalPoint(L, w).map((v) => +v.toFixed(4));
        renderPairs(); refit();
        $('#meta').textContent = `placement: local point ${q.from.join(', ')} — now type where it truly is`;
      }, 'pick this local point on the layer in the 3D view'));
      for (let a = 0; a < 3; a++) { const e = inp(q.to[a], '100px'); e.onchange = () => { q.to[a] = nOr(e.value); refit(); }; cell(e); }
      const res = div('min-width:70px'); res.dataset.pairRes = String(i); cell(res);
      cell(btn('×', () => { st.pairs.splice(i, 1); renderPairs(); refit(); }, 'remove this pair'));
      tbl.append(tr);
    });
    renderFit();
  };
  const refit = () => {
    st.fit = null; st.fitErr = null;
    try { if (st.pairs.filter((q) => q.use).length >= 2) st.fit = fitSimilarity(st.pairs, { mode: st.mode }); } catch (e) { st.fitErr = e.message; }
    renderFit();
  };
  const renderFit = () => {
    requestRender();                                       // the control points drawn in 3D follow the table
    const tolV = placementTolerance();
    if (st.fit) {
      st.fit.residuals.forEach((r, i) => {
        const el = tbl.querySelector(`[data-pair-res="${i}"]`); if (!el) return;
        const c = residualClass(r.d, tolV);
        el.textContent = `${fmtLen(r.d)}${r.use ? '' : ' (dropped)'}`;
        el.style.color = RESIDUAL_COLOR[c]; el.dataset.cls = c; el.title = `Δx ${fmtLen(r.dx)} · Δy ${fmtLen(r.dy)} · Δz ${fmtLen(r.dz)}`;
      });
      const a = anglesFromR(st.fit.R), c = residualClass(st.fit.max, tolV);
      fitLine.textContent = `${st.fit.mode.toUpperCase()} fit to ${st.fit.used} pairs · rms ${fmtLen(st.fit.rms)} · max ${fmtLen(st.fit.max)} · shift ${st.fit.t.map((v) => +v.toFixed(3)).join(', ')} · κ ${+a.kappa.toFixed(5)}°${st.fit.mode === '3d' ? ` ω ${+a.omega.toFixed(5)}° φ ${+a.phi.toFixed(5)}°` : ''} · scale ${+st.fit.s.toPrecision(9)}`;
      fitLine.style.color = RESIDUAL_COLOR[c]; fitLine.dataset.cls = c;
    } else {
      for (const el of tbl.querySelectorAll('[data-pair-res]')) { el.textContent = '—'; el.style.color = ''; }
      fitLine.textContent = st.fitErr || 'two pairs or more fit a placement (2D: shift + κ + scale; 3D: three or more)';
      fitLine.style.color = 'var(--muted, #888)';
    }
  };

  // — CRS change —
  const cp = div('display:flex;flex-direction:column;gap:6px'); panes.crs = cp;
  const fromIn = inp(p0 && p0.fromCrs ? (p0.fromCrs.epsg ? `EPSG:${p0.fromCrs.epsg}` : (p0.fromCrs.def || '')) : '', '100%'); fromIn.placeholder = 'the layer\'s system: an EPSG code (29193), EPSG:31984, a proj4 string or a WKT'; fromIn.dataset.placementFromCrs = '1';
  const crsOut = div('font:12px var(--mono, monospace)'); crsOut.dataset.placementCrsOut = '1';
  const pc = projectCrs();
  cp.append(div('', `the project: ${pc ? crsLabel(pc) : 'NO coordinate system — set one first (the CRS chip)'}`), fromIn,
    div('display:flex;gap:6px', ''),
    div('color:var(--muted, #888);font-size:11px', 'samples the true reprojection over the layer\'s extent (a 9×9 grid at its floor and roof), fits the best similarity, then checks it at 17×17 points it never saw — the MAX deviation is what you are told. A uniform scale also stretches heights about the layer\'s mid height: reported as the vertical part.'), crsOut);
  const resolveCrs = async (t) => { const s2 = String(t).trim(); if (/^\d+$/.test(s2)) return lookupEpsg(+s2); if (/^epsg:\s*\d+$/i.test(s2)) return lookupEpsg(+s2.split(':')[1]); return crsFromDefinition(s2); };
  cp.children[2].append(btn('fit', async () => {
    try {
      const from = await resolveCrs(fromIn.value);
      if (!from) throw new Error(`“${fromIn.value}” is not a coordinate system micro knows`);
      st.crsFit = fitLayerToCrs(L, from);
      const c = residualClass(st.crsFit.maxResidual, placementTolerance());
      crsOut.textContent = `${st.crsFit.fromCrsLabel} → ${st.crsFit.toCrsLabel} by best-fit similarity: max deviation ${fmtLen(st.crsFit.maxResidual)} (plan ${fmtLen(st.crsFit.hMax)}, heights ${fmtLen(st.crsFit.vMax)}) over ${st.crsFit.checked} check points · scale ${+st.crsFit.scale.toPrecision(9)} · κ ${+st.crsFit.kappa.toFixed(6)}°${st.crsFit.path ? ` · ${st.crsFit.path}` : ''}`;
      crsOut.style.color = RESIDUAL_COLOR[c]; crsOut.dataset.cls = c;
    } catch (e) { st.crsFit = null; crsOut.textContent = e.message; crsOut.style.color = RESIDUAL_COLOR.bad; }
  }), btn('apply', async () => { if (st.crsFit) await applyPlacement(st.crsFit); else crsOut.textContent = 'fit first'; }));

  // — footer —
  const foot = div('display:flex;gap:6px;justify-content:flex-end');
  foot.append(btn('clear placement', async () => { await applyPlacement(null); }, 'back to the file\'s own coordinates'), btn('close', () => win.close()));
  const paintCurrent = () => {
    const r = L.placement ? L.placement.maxResidual : null, c = Number.isFinite(r) ? residualClass(r, placementTolerance()) : 'none';
    cur.textContent = L.placement ? describePlacement(L.placement) : 'not placed — the file\'s own coordinates';
    cur.style.borderColor = RESIDUAL_COLOR[c]; cur.style.color = c === 'none' ? '' : RESIDUAL_COLOR[c]; cur.dataset.cls = c;
  };
  const applyPlacement = async (p) => {
    win.sub.textContent = 'placing…';
    try { await setLayerPlacement(L, p); }
    catch (e) { win.sub.textContent = ''; $('#meta').textContent = `placement: ${e.message}`; return; }
    win.sub.textContent = '';
    paintCurrent();
  };
  st.apply = applyPlacement; st.refit = refit; st.renderPairs = renderPairs; st.fields = f; st.paste = pasteBox; st.fromIn = fromIn;
  body.append(cur, tolRow, tabs, ty, gp, cp, foot);
  paintCurrent(); renderPairs(); refit();
  show(tab || (p0 && p0.source === 'gcp' ? 'gcp' : p0 && p0.source === 'crs-fit' ? 'crs' : 'typed'));
  return st;
}

// ── the control points drawn in 3D, while a placement window's control-points tab is open ──
// Per pair: a ring at its LOCAL point, a filled square at its TRUE point, a line between them
// coloured like its residual (green / amber / red; grey with no fit; dashed when the pair is
// dropped), and its table row number. SVG over the canvas, re-projected every frame.
// Drawn where the layer IS drawn: the local point through the layer's present placement (where it
// was picked, on the mesh), the true point taken back onto the layer by the current fit and out
// through that same placement (Mdisp · Mfit⁻¹ · true) — so before the fit is applied the residuals
// show ON the mesh (a drone model in its own frame, its true points kilometres away), and once it
// is applied (Mdisp = Mfit) the ring is the local point placed by the fit and the square IS the
// true point. With no fit yet, the true point is drawn only when the layer is already placed.
const SVGNS = 'http://www.w3.org/2000/svg';
const mkSvg = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const unsetTrue = (q) => !q.to || (q.to[0] === 0 && q.to[1] === 0 && q.to[2] === 0);
/** the 3D markers of one open window's pairs, in WORLD (the scene's coordinates): [{ i, local, true, cls, use }] */
export function controlPointMarkers(st) {
  const L = st.L, out = [];
  const Md = layerPlacementM(L);
  let back = null;                                         // true → where the layer is drawn
  try { if (st.fit) { const Mf = compilePlacement(placementFromFit(st.fit, 'gcp')); back = Md ? composeP(Md, invertP(Mf)) : invertP(Mf); } } catch { back = null; }
  const tolV = placementTolerance();
  st.pairs.forEach((q, i) => {
    const local = Md ? applyP(Md, q.from[0], q.from[1], q.from[2], [0, 0, 0]) : [q.from[0], q.from[1], q.from[2]];
    let tru = null;
    if (!unsetTrue(q)) tru = back ? applyP(back, q.to[0], q.to[1], q.to[2], [0, 0, 0]) : Md ? [q.to[0], q.to[1], q.to[2]] : null;
    const r = st.fit && st.fit.residuals[i];
    out.push({ i, local, true: tru, cls: r ? residualClass(r.d, tolV) : 'none', use: q.use !== false });
  });
  return out;
}
function gcpSvg() {
  let s = document.getElementById('gcpSvg');
  if (!s) {
    const view = document.getElementById('view'); if (!view) return null;
    s = document.createElementNS(SVGNS, 'svg'); s.id = 'gcpSvg';
    s.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:2');
    view.appendChild(s);
  }
  return s;
}
export function drawControlPoints() {
  const s = gcpSvg(); if (!s) return;
  const open = [..._open.values()].filter((st) => st.tab === 'gcp' && st.win && st.win.el && st.win.el.isConnected && st.pairs.length);
  if (!open.length || !S.frame || !S.cam || !S.cam.state.viewProj) { if (s.style.display !== 'none') { s.style.display = 'none'; s.textContent = ''; } return; }
  s.style.display = ''; s.textContent = '';
  const css = (w) => (w ? projectToCss(worldToLocal(w)) : null);
  for (const st of open) {
    for (const m of controlPointMarkers(st)) {
      const a = css(m.local), b = css(m.true), col = RESIDUAL_COLOR[m.cls], dash = m.use ? '' : '4 3';
      if (a && b) {
        s.append(mkSvg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], style: 'stroke:#121212;stroke-width:4;stroke-linecap:round' }));
        s.append(mkSvg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], style: `stroke:${col};stroke-width:1.6`, 'stroke-dasharray': dash, 'data-gcp-line': m.i, 'data-cls': m.cls }));
      }
      if (a) s.append(mkSvg('circle', { cx: a[0], cy: a[1], r: 4.5, style: `fill:none;stroke:${col};stroke-width:2`, 'data-gcp-local': m.i, 'data-layer': st.L.id }));
      if (b) s.append(mkSvg('rect', { x: b[0] - 4, y: b[1] - 4, width: 8, height: 8, style: `fill:${col};stroke:#121212;stroke-width:1.2`, 'data-gcp-true': m.i, 'data-cls': m.cls }));
      const at = b || a;
      if (at) { const t = mkSvg('text', { x: at[0] + 7, y: at[1] - 6, style: 'fill:#fff;font:11px monospace;paint-order:stroke;stroke:#121212;stroke-width:3', 'data-gcp-label': m.i }); t.textContent = String(m.i + 1); s.append(t); }
    }
  }
}
try { FRAME_DRAWERS.push(drawControlPoints); } catch { /* headless */ }

try { window._microPlacement = { setLayerPlacement, openPlacementDialog, fitLayerToCrs, parseControlPoints, pickWorldPoint, layerLocalPoint, layerLocalBbox, canPlace, statusOf, fitSimilarity, placementFromFit, controlPointMarkers, drawControlPoints, dialogs: _open }; } catch { /* headless */ }
