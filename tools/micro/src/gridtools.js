// micro — the grid dialogs: rasterize a mesh onto a grid, the surface tools (fill, extrapolate,
// resample onto a lattice), and New… — an empty grid or block model from parameters or from the
// box of a layer or group, lattice-aligned to an anchor. The kernels are src/grid-ops.js; these
// are the forms and their OK / cancel handlers. The app wires the buttons.
import { S, layerById } from './state.js';
import { niceStep } from './analysis-ui.js';
import { ppNote } from './props.js';
import { meshToGridLayer } from './surfaces.js';
import { applyGridExtend, buildEmptyBlockCsv, buildEmptyGrid, coverGeometry, gridAxesOf, rasterizeMeshToGrid, surfaceFromGrid, gridWorldBbox4 } from './grid-ops.js';
import { applyP, invertP } from './placement-core.js';
import { residentGridForEval, targetsXYBbox } from './bygeom.js';
import { reReadMesh } from './records.js';
import { mkLineage } from './lineage.js';
import { openBlob } from './open.js';
import { writeEsriAsc } from './grid-io.js';
import { groupLayerIds } from './tree.js';
import { commonLattice } from '../../../ext/condenser/src/main.js';
const $ = (s) => document.querySelector(s);

// ── an empty grid or block model — a canvas to domain / rasterize into, from
// parameters or covering existing layers ──
export function layerWorldBbox(L) {
  if (!L || !L.bboxLocal || !S.frame) return null;
  const b = L.bboxLocal, o = S.frame.origin;
  return [b[0] + o[0], b[1] + o[1], b[2] + o[2], b[3] + o[0], b[4] + o[1], b[5] + o[2]];
}

export function unionWorldBbox(list) {
  let u = null;
  for (const b of list) { if (!b) continue; if (!u) u = b.slice(); else for (let i = 0; i < 3; i++) { if (b[i] < u[i]) u[i] = b[i]; if (b[i + 3] > u[i + 3]) u[i + 3] = b[i + 3]; } }
  return u;
}

// grid phasing (the "rotation origin" of Datamine/Vulcan): the lattice
// anchor + k·step must PASS THROUGH the anchor while covering [lo, hi]. half =
// step/2 for a block centre (the block reaches ±half), 0 for a grid node.
// (alignAxis / coverGeometry / buildEmptyGrid / buildEmptyBlockCsv live in src/grid-ops.js)
// mesh → grid dialog: pick a cell size (default from the mesh bbox), see the
// resulting node count live, choose the top or bottom surface, rasterize
export let _rgDlg = null;

export function openMeshGridDialog(meshL0) {
  const meshes = S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
  if (!meshes.length) { $('#meta').textContent = 'mesh → grid: needs a context-tier mesh (.msh / .obj / small .ply)'; return; }
  const meshL = meshL0 && meshes.includes(meshL0) ? meshL0 : meshes[0];
  const bb = meshL.bboxLocal ? { min: [meshL.bboxLocal[0] + S.frame.origin[0], meshL.bboxLocal[1] + S.frame.origin[1]], max: [meshL.bboxLocal[3] + S.frame.origin[0], meshL.bboxLocal[4] + S.frame.origin[1]] } : null;
  const ext = bb ? Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) : 100;
  _rgDlg = { mesh: meshL.id, cell: niceStep(ext / 400), keep: 'top', extentSrc: 'mesh', extend: 'none', holesOnly: false, ext, meshes };
  renderMeshGridDialog();
  $('#rgDlg').classList.add('show');
}

export function renderMeshGridDialog() {
  const d = _rgDlg; if (!d) return;
  const body = $('#rgDlgBody'); body.textContent = '';
  const meshL = layerById(d.mesh);
  const bb = meshL.bboxLocal;
  const wx = bb ? bb[3] - bb[0] : d.ext, wy = bb ? bb[4] - bb[1] : d.ext;
  const row = (label, ...els) => { const r = document.createElement('div'); r.className = 'ex-row'; const b = document.createElement('b'); b.textContent = label; r.append(b, ...els); body.appendChild(r); return r; };
  const mSel = document.createElement('select');
  for (const L of d.meshes) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; mSel.appendChild(o); }
  mSel.value = String(d.mesh);
  mSel.onchange = () => { d.mesh = +mSel.value; renderMeshGridDialog(); };
  row('surface', mSel);
  const gridLayers = S.layers.filter((L) => L.docs.gridDoc);
  const eSel = document.createElement('select');
  { const o = document.createElement('option'); o.value = 'mesh'; o.textContent = 'the mesh bounds'; eSel.appendChild(o); }
  for (const L of gridLayers) { const o = document.createElement('option'); o.value = 'G' + L.id; o.textContent = `match: ${L.label || L.name}`; eSel.appendChild(o); }
  eSel.value = d.extentSrc; eSel.onchange = () => { d.extentSrc = eSel.value; renderMeshGridDialog(); };
  row('extent', eSel);
  const rgGeom = () => { if (d.extentSrc === 'mesh') return null; const L = layerById(+d.extentSrc.slice(1)); const g = L && L.docs.gridDoc && L.docs.gridDoc.grid; return g ? { x0: g.x0, y0: g.y0, dx: g.dx, nx: g.nx, ny: g.ny } : null; };
  const geom = rgGeom();
  const cellIn = document.createElement('input'); cellIn.type = 'number'; cellIn.min = '0'; cellIn.step = 'any'; cellIn.value = String(geom ? geom.dx : d.cell); cellIn.style.width = '90px'; cellIn.disabled = !!geom;
  const tally = document.createElement('span'); tally.style.color = 'var(--muted)';
  const upd = () => { const g2 = rgGeom(); const nx = g2 ? g2.nx : Math.max(1, Math.floor(wx / d.cell) + 1), ny = g2 ? g2.ny : Math.max(1, Math.floor(wy / d.cell) + 1); tally.textContent = `= ${nx.toLocaleString()} × ${ny.toLocaleString()} nodes (${(nx * ny).toLocaleString()})`; };
  cellIn.oninput = () => { d.cell = Math.max(1e-9, +cellIn.value || d.cell); upd(); };
  row('cell (m)', cellIn, tally); upd();
  const kRow = row('keep');
  for (const [k, lab] of [['top', 'top surface'], ['bottom', 'bottom surface']]) {
    const l = document.createElement('label'); const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'rgkeep'; rb.checked = d.keep === k; rb.onchange = () => { d.keep = k; }; l.append(rb, lab); kRow.appendChild(l);
  }
  const exRow = row('empties');
  const exSel = document.createElement('select');
  for (const [v, t] of [['none', 'leave nodata'], ['nearest', 'nearest (flat extension)'], ['trend', 'planar trend (continue dip)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; exSel.appendChild(o); }
  exSel.value = d.extend; exSel.onchange = () => { d.extend = exSel.value; renderMeshGridDialog(); };
  exRow.appendChild(exSel);
  if (d.extend !== 'none') { const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.holesOnly; cb.onchange = () => { d.holesOnly = cb.checked; }; l.append(cb, 'holes only'); exRow.appendChild(l); }
  body.appendChild(ppNote('renders the mesh onto a regular grid (overhangs keep the chosen side). Match an existing grid to rasterize a small mesh onto a bigger DEM\'s lattice; empty nodes fill by nearest (flat) or planar trend (continue the dip) — “holes only” patches interior gaps but leaves beyond-the-edge nodata.'));
  $('#rgDlgMsg').textContent = '';
}

export function rgCancel() { $('#rgDlg').classList.remove('show'); _rgDlg = null; }

export async function rgGo() {
  const d = _rgDlg; if (!d) return;
  const meshL = layerById(d.mesh); if (!meshL) return;
  const btn = $('#rgGo'); btn.disabled = true;
  for (const el of $('#rgDlgBody').querySelectorAll('input, select')) el.disabled = true;
  try {
    const geom = d.extentSrc === 'mesh' ? null : (() => { const L = layerById(+d.extentSrc.slice(1)); const g = L && L.docs.gridDoc && L.docs.gridDoc.grid; return g ? { x0: g.x0, y0: g.y0, dx: g.dx, nx: g.nx, ny: g.ny, ...(g.place ? { place: g.place } : {}) } : null; })();   // a rotated grid's own lattice
    await meshToGridLayer(meshL, { cell: d.cell, keep: d.keep, extend: d.extend, holesOnly: d.holesOnly, geom });
    $('#rgDlg').classList.remove('show'); _rgDlg = null;
  } catch (e) { $('#rgDlgMsg').textContent = e.message; }
  finally { btn.disabled = false; for (const el of $('#rgDlgBody').querySelectorAll('input, select')) el.disabled = false; }
}

// ── SURFACE TOOLS: extend to a footprint + combine with overlap rules ────────
// Grid-mediated by design (settled 2026-07-10): the output IS a grid layer —
// downstream flag/between/reconcile consume heightfields natively and exactly,
// and a naive TIN would be 2 tris/cell of bloat. Mesh-native (exact vertices)
// waits on CDT; grid→simplified-TIN is a separate roadmapped verb.
export const surfaceableLayers = () => S.layers.filter((L) => (L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup) || L.docs.gridDoc);

// any surface source (mesh or grid layer) → Float32 heights on a target lattice
export async function gridOnLattice(L, geom, onProgress) {
  const P = geom.place || null;                            // a ROTATED lattice: its nodes in world through the placement
  if (L.docs.gridDoc) {
    const bbox4 = P ? gridWorldBbox4({ ...geom, dy: geom.dx }) : [geom.x0, geom.y0 - (geom.ny - 1) * geom.dx, geom.x0 + (geom.nx - 1) * geom.dx, geom.y0];
    const surf = surfaceFromGrid(await residentGridForEval(L, bbox4));
    const data = new Float32Array(geom.nx * geom.ny).fill(-9999), q = [0, 0, 0];
    for (let r = 0; r < geom.ny; r++) {
      const y = geom.y0 - r * geom.dx;
      for (let c = 0; c < geom.nx; c++) {
        let z;
        if (P) { applyP(P, geom.x0 + c * geom.dx, y, 0, q); z = (surf.sampleZ(q[0], q[1]) - P.t[2]) / P.s; }   // stored in the lattice's own frame (z = t_z + s·value)
        else z = surf.sampleZ(geom.x0 + c * geom.dx, y);
        if (Number.isFinite(z)) data[r * geom.nx + c] = z;
      }
      if (onProgress && (r & 63) === 0) onProgress(r / geom.ny);
    }
    return { nx: geom.nx, ny: geom.ny, x0: geom.x0, y0: geom.y0, dx: geom.dx, dy: geom.dx, data, nodata: -9999, crs: null, form: 'resample', ...(P ? { place: P } : {}) };
  }
  let m = await reReadMesh(L.docs.meshDoc);
  if (P) { const inv = invertP(P), V = new Float64Array(m.vertices.length), q = [0, 0, 0]; for (let i = 0; i < V.length; i += 3) { applyP(inv, m.vertices[i], m.vertices[i + 1], m.vertices[i + 2], q); V[i] = q[0]; V[i + 1] = q[1]; V[i + 2] = q[2]; } m = { ...m, vertices: V }; }
  const g = await rasterizeMeshToGrid(m.vertices, m.triangles, { x0: geom.x0, y0: geom.y0, dx: geom.dx, dy: geom.dx, nx: geom.nx, ny: geom.ny, keep: 'top', onProgress });
  if (P) g.place = P;
  return g;
}

export const surfCellOf = (L) => (L.docs.gridDoc ? L.docs.gridDoc.grid.dx : (L.bboxLocal ? niceStep(Math.max(L.bboxLocal[3] - L.bboxLocal[0], L.bboxLocal[4] - L.bboxLocal[1]) / 400) : 10));

export let _sfDlg = null;

export function openSurfaceTools(mode, L0) {
  const surfs = surfaceableLayers();
  if (!surfs.length) { $('#meta').textContent = 'surface tools: needs a surface (a context-tier mesh or a grid layer)'; return; }
  const src = L0 && surfs.includes(L0) ? L0 : surfs[0];
  _sfDlg = { mode: mode || 'extend', src: src.id, srcs: surfs.slice(0, 2).map((L) => L.id), rule: 'min',
    foot: 'all', cell: surfCellOf(src), fill: 'nearest', combFill: 'none' };
  renderSurfaceTools();
  $('#sfDlg').classList.add('show');
}

// the footprint's world XY bbox [minX, minY, maxX, maxY]
export function sfFootBbox(d) {
  if (d.mode === 'combine') return targetsXYBbox(d.srcs.map(layerById).filter(Boolean));
  if (d.foot === 'all') return targetsXYBbox(S.layers);
  const L = layerById(+d.foot); const bb = L && layerWorldBbox(L);
  return bb ? [bb[0], bb[1], bb[3], bb[4]] : null;
}

export function sfGeom(d) {
  const bb = sfFootBbox(d); if (!bb) return null;
  const dx = Math.max(1e-9, d.cell || 1);
  const nx = Math.max(2, Math.floor((bb[2] - bb[0]) / dx) + 1), ny = Math.max(2, Math.floor((bb[3] - bb[1]) / dx) + 1);
  return { x0: bb[0], y0: bb[3], dx, nx, ny };
}

export function renderSurfaceTools() {
  const d = _sfDlg; if (!d) return;
  $('#sfTitle').textContent = d.mode === 'extend' ? 'extend surface' : 'combine surfaces';
  const body = $('#sfDlgBody'); body.textContent = '';
  const row = (label, ...els) => { const r = document.createElement('div'); r.className = 'ex-row'; const b = document.createElement('b'); b.textContent = label; r.append(b, ...els); body.appendChild(r); return r; };
  const surfs = surfaceableLayers();
  const mSel = document.createElement('select');
  for (const [v, t] of [['extend', 'extend to a footprint'], ['combine', 'combine with a rule']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; mSel.append(o); }
  mSel.value = d.mode; mSel.onchange = () => { d.mode = mSel.value; renderSurfaceTools(); };
  row('mode', mSel);
  const laySel = (val, onchange) => { const s = document.createElement('select'); for (const L of surfs) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = (L.label || L.name) + (L.docs.gridDoc ? ' (grid)' : ' (mesh)'); s.append(o); } s.value = String(val); s.onchange = () => onchange(+s.value); return s; };
  if (d.mode === 'extend') {
    row('surface', laySel(d.src, (v) => { d.src = v; d.cell = surfCellOf(layerById(v)); renderSurfaceTools(); }));
    const fSel = document.createElement('select');
    { const o = document.createElement('option'); o.value = 'all'; o.textContent = 'all layers (union)'; fSel.append(o); }
    for (const L of S.layers) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; fSel.append(o); }
    fSel.value = d.foot; fSel.onchange = () => { d.foot = fSel.value; renderSurfaceTools(); };
    row('footprint', fSel);
    const eSel = document.createElement('select');
    for (const [v, t] of [['nearest', 'nearest (flat extension)'], ['trend', 'planar trend (continue dip)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; eSel.append(o); }
    eSel.value = d.fill; eSel.onchange = () => { d.fill = eSel.value; };
    row('extend by', eSel);
  } else {
    // ordered source list — order IS the priority for the 'first' rule
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%';
    d.srcs.forEach((id, i) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:6px;align-items:center';
      const s = laySel(id, (v) => { d.srcs[i] = v; renderSurfaceTools(); }); s.style.flex = '1';
      const up = document.createElement('button'); up.textContent = '↑'; up.disabled = i === 0; up.onclick = () => { [d.srcs[i - 1], d.srcs[i]] = [d.srcs[i], d.srcs[i - 1]]; renderSurfaceTools(); };
      const x = document.createElement('button'); x.textContent = '×'; x.disabled = d.srcs.length <= 2; x.onclick = () => { d.srcs.splice(i, 1); renderSurfaceTools(); };
      r.append(s, up, x); list.append(r);
    });
    const add = document.createElement('button'); add.textContent = '+ add surface'; add.disabled = d.srcs.length >= surfs.length;
    add.onclick = () => { const used = new Set(d.srcs); const nxt = surfs.find((L) => !used.has(L.id)); if (nxt) { d.srcs.push(nxt.id); renderSurfaceTools(); } };
    list.append(add);
    row('surfaces', list);
    const rSel = document.createElement('select'); rSel.title = 'where surfaces overlap: min = take the lower (topo ∧ weathering) · max = the higher · first = the FIRST listed wins where it has data (patch a survey into topo) · mean';
    for (const [v, t] of [['min', 'min — take the lower'], ['max', 'max — take the higher'], ['first', 'first listed wins (priority)'], ['mean', 'mean']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; rSel.append(o); }
    rSel.value = d.rule; rSel.onchange = () => { d.rule = rSel.value; };
    row('overlap', rSel);
    const cSel = document.createElement('select');
    for (const [v, t] of [['none', 'leave nodata'], ['nearest', 'nearest (flat)'], ['trend', 'planar trend']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; cSel.append(o); }
    cSel.value = d.combFill; cSel.onchange = () => { d.combFill = cSel.value; };
    row('empties', cSel);
  }
  const cellIn = document.createElement('input'); cellIn.type = 'number'; cellIn.min = '0'; cellIn.step = 'any'; cellIn.value = String(d.cell); cellIn.style.width = '90px';
  const tally = document.createElement('span'); tally.style.color = 'var(--muted)';
  const upd = () => { const g = sfGeom(d); tally.textContent = g ? `= ${g.nx.toLocaleString()} × ${g.ny.toLocaleString()} nodes (${(g.nx * g.ny).toLocaleString()})` : '(no extent)'; $('#sfGo').disabled = !g || g.nx * g.ny > 32e6; $('#sfDlgMsg').textContent = g && g.nx * g.ny > 32e6 ? 'over 32M nodes — raise the cell size' : ''; };
  cellIn.oninput = () => { d.cell = Math.max(1e-9, +cellIn.value || d.cell); upd(); };
  row('cell (m)', cellIn, tally); upd();
  body.appendChild(ppNote(d.mode === 'extend'
    ? 'rasterizes the surface onto a lattice covering the footprint, then fills beyond its edge — nearest holds the boundary z flat, trend continues the fitted dip. The output is a GRID layer (exact for flags/reconcile; export .asc anytime).'
    : 'each surface is rasterized onto one common lattice, then combined node-wise by the rule. For “first”, list order is priority — the top surface wins where it has data. The output is a GRID layer named for the rule.'));
}

export function sfCancel() { $('#sfDlg').classList.remove('show'); _sfDlg = null; }

export async function sfGo() {
  const d = _sfDlg; if (!d) return;
  const btn = $('#sfGo'); btn.disabled = true;
  for (const el of $('#sfDlgBody').querySelectorAll('input, select, button')) el.disabled = true;
  try {
    const geom = sfGeom(d); if (!geom) throw new Error('no extent');
    const prog = (label) => (f) => { $('#sfDlgMsg').textContent = `${label} ${Math.round(f * 100)}%…`; };
    if (d.mode === 'extend') {
      const L = layerById(d.src); if (!L) throw new Error('surface gone');
      const grid = await gridOnLattice(L, geom, prog('rasterizing'));
      $('#sfDlgMsg').textContent = `extending (${d.fill})…`;
      applyGridExtend(grid, d.fill, false);
      const base = (L.label || L.name).replace(/\.[^.]+$/, '');
      const lin = mkLineage('surface.extend', { footprint: d.foot === 'all' ? 'all layers' : (layerById(+d.foot) || {}).name, cell: geom.dx, fill: d.fill }, [L.lineage]);
      await openBlob(new Blob([writeEsriAsc(grid)]), `${base}_ext.asc`, S.layers.length ? 'add' : 'replace', null, { lineage: lin });
    } else {
      const Ls = d.srcs.map(layerById).filter(Boolean);
      if (Ls.length < 2) throw new Error('combine needs two surfaces');
      const grids = [];
      for (let i = 0; i < Ls.length; i++) grids.push(await gridOnLattice(Ls[i], geom, prog(`rasterizing ${i + 1}/${Ls.length}`)));
      $('#sfDlgMsg').textContent = `combining (${d.rule})…`;
      const N = geom.nx * geom.ny, out = new Float32Array(N).fill(-9999);
      const bad = (v) => Number.isNaN(v) || v === -9999;
      for (let i = 0; i < N; i++) {
        let acc = NaN, n = 0;
        for (const g of grids) {
          const v = g.data[i]; if (bad(v)) continue;
          n++;
          if (d.rule === 'first') { acc = v; break; }
          if (Number.isNaN(acc)) acc = v;
          else acc = d.rule === 'min' ? Math.min(acc, v) : d.rule === 'max' ? Math.max(acc, v) : acc + v;
        }
        if (n) out[i] = d.rule === 'mean' ? acc / n : acc;
      }
      const grid = { nx: geom.nx, ny: geom.ny, x0: geom.x0, y0: geom.y0, dx: geom.dx, dy: geom.dx, data: out, nodata: -9999, crs: null, form: 'combine' };
      if (d.combFill !== 'none') { $('#sfDlgMsg').textContent = `filling (${d.combFill})…`; applyGridExtend(grid, d.combFill, false); }
      const names = Ls.map((L) => (L.label || L.name).replace(/\.[^.]+$/, ''));
      const lin = mkLineage('surface.combine', { rule: d.rule, of: names, cell: geom.dx, fill: d.combFill }, Ls.map((L) => L.lineage));
      await openBlob(new Blob([writeEsriAsc(grid)]), `${d.rule}_${names.join('_').slice(0, 40)}.asc`, S.layers.length ? 'add' : 'replace', null, { lineage: lin });
    }
    $('#sfDlg').classList.remove('show'); _sfDlg = null;
  } catch (e) { $('#sfDlgMsg').textContent = e.message; }
  finally { btn.disabled = false; for (const el of $('#sfDlgBody').querySelectorAll('input, select, button')) el.disabled = false; if (_sfDlg) renderSurfaceTools(); }
}

// New grid / block model dialog: type + extent (parameters or cover a layer /
// group / all layers) + cell/block size + fill; live count tally
export let _ngDlg = null;

export function ngGroups() {
  const gs = [];
  const walk = (arr) => { for (const nd of arr) if (typeof nd !== 'number' && nd.group) { gs.push(nd); walk(nd.children); } };
  walk(S.layerTree);
  return gs;
}

export function ngSourceBbox(d) {
  if (d.src === 'all') return unionWorldBbox(S.layers.map(layerWorldBbox));
  if (d.src && d.src[0] === 'G') { const g = ngGroups()[+d.src.slice(1)]; return g ? unionWorldBbox(groupLayerIds(g).map((id) => layerWorldBbox(layerById(id)))) : null; }
  return d.src ? layerWorldBbox(layerById(+d.src.slice(1))) : null;
}

// block-model layers eligible for the common-grid creator, and the common
// lattice covering the selected ones at the chosen resolution.
export const ngBlockLayers = () => S.layers.filter((L) => { const g = gridAxesOf(L); return g && !g.rot; });   // the creator builds axis-aligned grids

export function compatAxes(d) {
  const sel = ngBlockLayers().filter((L) => d.compatSel.has(L.id));
  if (sel.length < 1) return { ok: false, reason: 'pick at least one model' };
  return commonLattice(sel.map((L) => gridAxesOf(L)), { resolution: d.res });
}

// resolve the target lattice from the dialog state (shared by the Run handler and
// the recipe-save path so they never drift)
export function resolveGeom(d) {
  const isBM = d.type === 'block' || d.mode === 'compat';
  let x0, y0, z0, nx, ny, nz, dx = d.dx, dy = d.dy, dz = d.dz;
  if (d.mode === 'compat') { const ca = compatAxes(d); if (!ca.ok) throw new Error(ca.reason); x0 = ca.x.origin; y0 = ca.y.origin; z0 = ca.z.origin; nx = ca.x.count; ny = ca.y.count; nz = ca.z.count; dx = ca.x.pitch; dy = ca.y.pitch; dz = ca.z.pitch; }
  else if (d.mode === 'cover') { const bb = ngSourceBbox(d); if (!bb) throw new Error('no bounding box'); const g = coverGeometry(d, bb); x0 = g.x0; y0 = g.y0; z0 = g.z0; nx = g.nx; ny = g.ny; nz = g.nz; }
  else { nx = Math.max(1, d.nx | 0); ny = Math.max(1, d.ny | 0); nz = isBM ? Math.max(1, d.nz | 0) : 1; x0 = d.x0; y0 = d.y0; z0 = d.z0; }
  return { isBM, x0, y0, z0, nx, ny, nz, dx, dy, dz };
}

export function openNewDialog() {
  const bb = S.docBbox && S.frame ? unionWorldBbox(S.layers.map(layerWorldBbox)) : null;
  _ngDlg = {
    kind: 'create',
    type: 'grid', mode: S.layers.length ? 'cover' : 'params',
    src: S.layers.length ? 'all' : null,
    x0: bb ? +bb[0].toFixed(2) : 0, y0: bb ? +bb[4].toFixed(2) : 0, z0: bb ? +bb[2].toFixed(2) : 0,
    dx: 10, dy: 10, dz: 10, nx: 50, ny: 50, nz: 20, fill: 0, valName: 'VAL',
    align: false, ax: 0, ay: 0, az: 0,
    res: 'finest', compatSel: new Set(),
  };
  const hd = $('#ngDlg .hd span'); if (hd) hd.textContent = 'new grid / block model'; $('#ngGo').textContent = 'Create';
  renderNewDialog();
  $('#ngDlg').classList.add('show');
}

export function renderNewDialog() {
  const d = _ngDlg; if (!d) return;
  const body = $('#ngDlgBody'); body.textContent = '';
  const isBM = d.type === 'block' || d.mode === 'compat';
  const row = (label, ...els) => { const r = document.createElement('div'); r.className = 'ex-row'; const b = document.createElement('b'); b.textContent = label; r.append(b, ...els); body.appendChild(r); return r; };
  const num = (key, w = 90) => { const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.value = String(d[key]); inp.style.width = w + 'px'; inp.oninput = () => { d[key] = +inp.value; updTally(); }; return inp; };
  const radios = (r, group, pairs, cur, pick) => { for (const [k, lab] of pairs) { const l = document.createElement('label'); const rb = document.createElement('input'); rb.type = 'radio'; rb.name = group; rb.checked = cur === k; rb.onchange = () => { pick(k); }; l.append(rb, lab); r.appendChild(l); } };
  if (d.mode !== 'compat') radios(row('type'), 'ngtype', [['grid', 'grid (heightfield)'], ['block', 'block model']], d.type, (k) => { d.type = k; renderNewDialog(); });
  const modes = [...(S.layers.length ? [['cover', 'cover a layer']] : []), ...(ngBlockLayers().length ? [['compat', 'cover compatible models']] : []), ['params', 'from parameters']];
  radios(row('extent'), 'ngmode', modes, d.mode, (k) => { d.mode = k; if (k === 'compat') d.type = 'block'; renderNewDialog(); });
  if (d.mode === 'compat') {
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin:2px 0 6px';
    for (const L of ngBlockLayers()) {
      const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:6px;font-size:12px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.compatSel.has(L.id);
      cb.onchange = () => { if (cb.checked) d.compatSel.add(L.id); else d.compatSel.delete(L.id); renderNewDialog(); };
      const ax = gridAxesOf(L); const sz = document.createElement('span'); sz.style.color = 'var(--dim)'; sz.textContent = ` ${ax.x.pitch}×${ax.y.pitch}×${ax.z.pitch} m`;
      l.append(cb, document.createTextNode(L.label || L.name), sz); list.appendChild(l);
    }
    body.appendChild(row('models')); body.appendChild(list);
    radios(row('resolution'), 'ngres', [['finest', 'finest'], ['coarsest', 'coarsest'], ['gcd', 'common lattice']], d.res, (k) => { d.res = k; renderNewDialog(); });
    const ca = compatAxes(d);
    const ban = document.createElement('div');
    if (ca.ok) { ban.className = 'pp-banner ok'; ban.textContent = `common ${ca.x.pitch}×${ca.y.pitch}×${ca.z.pitch} m, ${ca.x.count}×${ca.y.count}×${ca.z.count} = ${(ca.x.count * ca.y.count * ca.z.count).toLocaleString()} blocks`; }
    else { ban.className = 'pp-banner bad'; ban.textContent = d.compatSel.size ? `incompatible — ${ca.reason}` : 'select the models to combine'; }
    body.appendChild(ban);
  } else if (d.mode === 'cover') {
    const sel = document.createElement('select');
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('all', 'all layers');
    ngGroups().forEach((g, i) => add('G' + i, `▸ group: ${g.name}`));
    for (const L of S.layers) add('L' + L.id, L.label || L.name);
    sel.value = d.src || 'all';
    sel.onchange = () => { d.src = sel.value; updTally(); };
    row('source', sel);
    const alignRow = row('align');
    const cbl = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.align; cb.onchange = () => { d.align = cb.checked; renderNewDialog(); }; cbl.append(cb, 'to a point'); alignRow.appendChild(cbl);
    if (d.align) alignRow.append(num('ax'), num('ay'), ...(isBM ? [num('az')] : []));
    if (d.align) body.appendChild(ppNote(`the lattice passes through (${d.ax}, ${d.ay}${isBM ? `, ${d.az}` : ''}) as a ${isBM ? 'block centre' : 'node'}, while still covering the extent`));
  } else {
    row(isBM ? 'origin X,Y,Z' : 'origin X,Y', num('x0'), num('y0'), ...(isBM ? [num('z0')] : []));
    row(isBM ? 'counts' : 'counts', num('nx', 64), num('ny', 64), ...(isBM ? [num('nz', 64)] : []));
  }
  if (d.mode !== 'compat') { if (isBM) row('block (m)', num('dx', 60), num('dy', 60), num('dz', 60)); else row('cell (m)', num('dx', 90)); }
  const fillRow = row(isBM ? 'fill VAL' : 'fill Z', num('fill'));
  if (isBM) { const nm = document.createElement('input'); nm.type = 'text'; nm.value = d.valName; nm.style.width = '80px'; nm.oninput = () => { d.valName = nm.value.trim() || 'VAL'; }; fillRow.append(document.createTextNode(' column '), nm); }
  const tally = document.createElement('div'); tally.className = 'pp-note'; tally.id = 'ngTally'; body.appendChild(tally);
  function dims() {
    if (d.mode === 'compat') { const ca = compatAxes(d); return ca.ok ? { nx: ca.x.count, ny: ca.y.count, nz: ca.z.count } : null; }
    if (d.mode === 'cover') {
      const bb = ngSourceBbox(d);
      if (!bb) return null;
      const g = coverGeometry(d, bb);
      return { nx: g.nx, ny: g.ny, nz: g.nz, bb };
    }
    return { nx: Math.max(1, d.nx | 0), ny: Math.max(1, d.ny | 0), nz: isBM ? Math.max(1, d.nz | 0) : 1 };
  }
  function updTally() {
    const dd = dims();
    if (!dd) { tally.textContent = d.mode === 'compat' ? '' : 'this source has no bounding box yet'; $('#ngGo').disabled = true; return; }
    $('#ngGo').disabled = false;
    const tot = dd.nx * dd.ny * dd.nz;
    if (d.mode === 'compat') { tally.textContent = ''; return; }   // the banner shows the count
    tally.textContent = isBM
      ? `= ${dd.nx}×${dd.ny}×${dd.nz} = ${tot.toLocaleString()} blocks`
      : `= ${dd.nx}×${dd.ny} = ${tot.toLocaleString()} nodes`;
  }
  updTally();
  $('#ngDlgMsg').textContent = '';
}

export function ngCancel() { $('#ngDlg').classList.remove('show'); _ngDlg = null; }

export async function ngGo() {
  const d = _ngDlg; if (!d) return;
  const btn = $('#ngGo'); btn.disabled = true;
  for (const el of $('#ngDlgBody').querySelectorAll('input, select')) el.disabled = true;
  try {
    let isBM, x0, y0, z0, nx, ny, nz, dx, dy, dz;
    ({ isBM, x0, y0, z0, nx, ny, nz, dx, dy, dz } = resolveGeom(d));
    const gridLin = d.mode === 'compat'
      ? mkLineage('grid-cover', { resolution: d.res, block: [dx, dy, dz], count: [nx, ny, nz] }, ngBlockLayers().filter((L2) => d.compatSel.has(L2.id)).map((L2) => L2.lineage))
      : mkLineage('grid-new', { mode: d.mode, block: [dx, dy, dz], count: [nx, ny, nz], origin: [x0, y0, z0] }, d.mode === 'cover' && d.src && d.src[0] === 'L' ? [layerById(+d.src.slice(1)) && layerById(+d.src.slice(1)).lineage] : []);
    if (isBM) {
      $('#ngDlgMsg').textContent = 'building…';
      const blob = await buildEmptyBlockCsv({ x0, y0, z0, dx, dy, dz, nx, ny, nz, fill: d.fill, valName: d.valName, onProgress: (f) => { $('#ngDlgMsg').textContent = `building ${Math.round(f * 100)}%…`; } });
      await openBlob(blob, d.mode === 'compat' ? 'common_model.csv' : 'new_model.csv', S.layers.length ? 'add' : 'replace', null, { lineage: gridLin });
    } else {
      const grid = buildEmptyGrid({ x0, y0, dx, nx, ny, fill: d.fill });
      await openBlob(new Blob([writeEsriAsc(grid)]), 'new_grid.asc', S.layers.length ? 'add' : 'replace', null, { lineage: gridLin });
    }
    $('#ngDlg').classList.remove('show'); _ngDlg = null;
  } catch (e) { $('#ngDlgMsg').textContent = e.message; }
  finally { btn.disabled = false; for (const el of $('#ngDlgBody').querySelectorAll('input, select')) el.disabled = false; }
}
