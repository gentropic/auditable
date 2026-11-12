// micro — a grid drawn as a SURFACE: the relief mesh built from a heightfield, its colour
// (its own values, or a second grid draped over it), the flat sheet for a grid with no
// elevation, the band a multi-band GeoTIFF shows, and the capture/apply pair that carries
// all of it through a reopen and a saved project.
import { S, requestRender } from './state.js';
import { reReadMesh } from './records.js';
import { niceStep } from './analysis-ui.js';
import { applyGridExtend, rasterizeMeshToGrid, surfaceFromGrid } from './grid-ops.js';
import { mkLineage } from './lineage.js';
import { openBlob } from './open.js';
import { writeEsriAsc } from './grid-io.js';
import { RAMP_PRESETS, rampCfgOf, rampSample } from './ramp.js';
import { buildHeightfieldMesh } from '../../../ext/condenser/src/main.js';
import { markProjectDirty } from './project.js';
import { renderLayers } from './tree.js';
import { reopenReplacing } from './reopen.js';
const $ = (s) => document.querySelector(s);

// A see-through context surface must not steal the click meant for the block
// under it — you made it see-through precisely to work on what is behind it. So
// a mesh is pickable when it is OPAQUE, or when it is the layer you have
// selected (which is how you say "I mean this surface").
export function syncMeshPickable() {
  if (!S.renderer.setLayerPickable) return;
  for (const L of S.layers) {
    if (L.kind !== 'mesh') continue;
    const opaque = (L.opacity == null || L.opacity >= 0.95);
    S.renderer.setLayerPickable(L.id, opaque || L.id === S.activeId);
  }
}

// mesh → grid by RASTERIZATION (render, not raycast): each triangle projects to
// the grid's XY plane, and every node inside its 2D footprint takes the plane's
// barycentric-interpolated Z. Overlaps (overhangs) z-buffer — 'top' keeps the
// upper surface, 'bottom' the lower. O(Σ triangle footprints) ≈ O(nodes) for a
// surface; no BVH, no per-node ray. Yields periodically to keep the UI live.
// (rasterizeMeshToGrid / markGridExterior / fillGridNearest / fillGridTrend / applyGridExtend live in src/grid-ops.js)
// the mesh → grid action: parse the mesh's triangles, default a square grid
// from its plan bbox, rasterize, then hand the ESRI-ASCII blob to openGridBlob
// (so the new layer round-trips through the same reader + persists for free)
// geom (optional) matches an existing grid's LATTICE, so a mesh can be
// rasterized onto the same nodes as a bigger DEM ("mesh smaller than grid" →
// the outside fills by `extend`). Without geom the grid == the mesh bbox.
export async function meshToGridLayer(meshL, { cell, keep = 'top', extend = 'none', holesOnly = false, geom = null } = {}) {
  const md = meshL.docs && meshL.docs.meshDoc;
  if (!md) { $('#meta').textContent = 'mesh → grid: needs a context-tier mesh'; return null; }
  $('#meta').textContent = `${meshL.label || meshL.name} — reading mesh…`;
  const m = await reReadMesh(md);
  const bb = m.header.bbox;
  const extent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]);
  const dx = geom ? geom.dx : (cell && cell > 0 ? cell : niceStep(extent / 400));
  const x0 = geom ? geom.x0 : bb.min[0];
  const y0 = geom ? geom.y0 : bb.max[1];
  const nx = geom ? geom.nx : Math.max(1, Math.floor((bb.max[0] - bb.min[0]) / dx) + 1);
  const ny = geom ? geom.ny : Math.max(1, Math.floor((bb.max[1] - bb.min[1]) / dx) + 1);
  $('#meta').textContent = `${meshL.label || meshL.name} — rasterizing ${nx}×${ny}…`;
  const grid = await rasterizeMeshToGrid(m.vertices, m.triangles, {
    x0, y0, dx, dy: dx, nx, ny, keep,
    onProgress: (f) => { $('#meta').textContent = `${meshL.label || meshL.name} — rasterizing ${Math.round(f * 100)}%…`; },
  });
  if (extend && extend !== 'none') { $('#meta').textContent = `${meshL.label || meshL.name} — extending (${extend})…`; applyGridExtend(grid, extend, holesOnly); }
  const base = (meshL.label || meshL.name).replace(/\.[^.]+$/, '');
  // stamp lineage like the sibling surface tools do — a rasterized DEM reshapes
  // topology (z-buffered overhangs, dropped vertical faces) and had no provenance
  const lin = mkLineage('rasterize', { of: meshL.name, cell, keep, extend, holesOnly }, [meshL.lineage].filter(Boolean));
  await openBlob(new Blob([writeEsriAsc(grid)]), `${base}.asc`, S.layers.length ? 'add' : 'replace', null, { lineage: lin });
  return grid;
}

// Colour a heightfield mesh's vertices — by ELEVATION (its own values) or DRAPED
// from another grid sampled bilinearly at each vertex's world (x,y). Off the drape
// grid → a dim grey so gaps read honestly. The drape range auto-spans the sampled
// values. (Phase 2 of the heightfield-drape arc, §17.)
export function surfaceColorArray(hf, drapeGrid, rampPreset, elevLo, elevHi) {
  const stops = RAMP_PRESETS[rampPreset] || RAMP_PRESETS.viridis;
  const color = new Float32Array(hf.count * 3), o = S.frame ? S.frame.origin : [0, 0, 0];
  if (drapeGrid) {
    const surf = surfaceFromGrid(drapeGrid), vals = new Float32Array(hf.count);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < hf.count; i++) { const v = surf.sampleZ(hf.pos[i * 3] + o[0], hf.pos[i * 3 + 1] + o[1]); vals[i] = v; if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = (hi - lo) || 1;
    for (let i = 0; i < hf.count; i++) {
      const v = vals[i];
      if (Number.isNaN(v)) { color[i * 3] = 0.24; color[i * 3 + 1] = 0.24; color[i * 3 + 2] = 0.27; }
      else { const c = rampSample(stops, (v - lo) / span); color[i * 3] = c[0] / 255; color[i * 3 + 1] = c[1] / 255; color[i * 3 + 2] = c[2] / 255; }
    }
  } else {
    const span = (elevHi - elevLo) || 1;
    for (let i = 0; i < hf.count; i++) { const c = rampSample(stops, (hf.values[i] - elevLo) / span); color[i * 3] = c[0] / 255; color[i * 3 + 1] = c[1] / 255; color[i * 3 + 2] = c[2] / 255; }
  }
  return color;
}

// Rebuild a loaded surface in place from the in-memory grid (no re-read) — honours
// its shape (relief heightfield, or a flat sheet at L.surfaceFlatZ) and its colour
// (elevation/value, or draped from L.drapeSource). removeLayer wipes layer state,
// so visibility/section/opacity are restored.
export function rebuildSurface(L) {
  const gd = L.docs && L.docs.gridDoc; if (!gd || !L.gridSurface) return;
  const flatZ = L.surfaceFlatZ != null ? L.surfaceFlatZ : null;
  const hf = buildHeightfieldMesh(gd.grid, { stride: gd.stride, frame: S.frame, flatZ }); if (!hf) return;
  let zmin = Infinity, zmax = -Infinity;                    // grid VALUE range (= colour range for elevation/value)
  for (let i = 0; i < hf.count; i++) { const z = hf.values[i]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  const drapeLayer = L.drapeSource ? S.layers.find((x) => x.name === L.drapeSource && x.docs && x.docs.gridDoc && x.docs.gridDoc.grid) : null;
  const color = surfaceColorArray(hf, drapeLayer ? drapeLayer.docs.gridDoc.grid : null, (rampCfgOf(L) || {}).preset, zmin, zmax);
  const smooth = L.surfaceSmooth !== false;                 // faceted (no normals → flat per-triangle shading) reads the cell structure
  const vis = L.visible, sec = S.renderer.layerSectioned(L.id), op = L.opacity != null ? L.opacity : 1;
  S.renderer.removeLayer(L.id);
  S.renderer.setLayerMeshStyle(L.id, { tint: [0.6, 0.63, 0.66], opacity: op });
  S.renderer.addChunk({ kind: 'mesh', pos: hf.pos, idx: hf.idx, color, normal: smooth ? hf.normal : null, count: hf.count, bboxLocal: hf.bboxLocal }, 'base', L.id);
  L.bboxLocal = hf.bboxLocal;
  if (vis === false) S.renderer.setLayerVisible(L.id, false);
  if (sec != null && sec !== true) S.renderer.setLayerSectioned(L.id, sec);
  requestRender(); markProjectDirty();
}

// set the drape source (null = the grid's own elevation/value)
export function recolorSurface(L, drapeLayer) {
  if (!L.gridSurface) { $('#meta').textContent = 'drape: not a surface layer'; return; }
  L.drapeSource = drapeLayer ? drapeLayer.name : null;
  rebuildSurface(L);
  $('#meta').textContent = drapeLayer ? `draped ${L.label || L.name} with ${drapeLayer.label || drapeLayer.name}` : `${L.label || L.name} — coloured by its own value`;
}

// relief (flatZ=null) ↔ a flat horizontal sheet at a world elevation
export function setSurfaceFlatZ(L, flatZ) {
  if (!L.gridSurface) return;
  L.surfaceFlatZ = flatZ;
  rebuildSurface(L);
  $('#meta').textContent = flatZ != null ? `${L.label || L.name} — flat sheet at z ${flatZ}` : `${L.label || L.name} — relief`;
}

// ── the SINGLE per-layer surface-presentation state ──
// captureLayerSurface / applyLayerSurface are the ONE place the grid-surface state
// (gridSurface · drape · flatZ · faceted · band) is serialized. The project
// manifest AND scenes both call these, so adding a field is ONE edit and the two
// paths can't silently diverge (the parity smoke enforces it). Empty {} for a
// non-grid or an un-styled grid.
export function captureLayerSurface(L) {
  const gd = L && L.docs && L.docs.gridDoc; if (!gd) return {};
  const s = {};
  if (L.gridSurface) {
    s.gridSurface = true;
    if (L.drapeSource) s.drape = L.drapeSource;
    if (L.surfaceFlatZ != null) s.flatZ = L.surfaceFlatZ;
    if (L.surfaceSmooth === false) s.faceted = true;
  }
  if (gd.grid.band) s.band = gd.grid.band;
  return s;
}

// bring L to match a saved surface state — reopens the grid only if a reopen-
// requiring field changed (surface↔points, band, flatZ, faceted); the drape is a
// cheap in-place rebuild. Returns the (possibly new) layer. Used by applyScene AND
// the project load's post-pass.
export async function applyLayerSurface(L, s) {
  const gd = L && L.docs && L.docs.gridDoc; if (!gd) return L;
  s = s || {};
  const cur = captureLayerSurface(L);
  const needsReopen = !!cur.gridSurface !== !!s.gridSurface || (cur.band || 0) !== (s.band || 0)
    || (cur.flatZ != null ? cur.flatZ : null) !== (s.flatZ != null ? s.flatZ : null) || !!cur.faceted !== !!s.faceted;
  let L2 = L;
  if (needsReopen) {
    const blob = gd.blob, name = L.name;
    L2 = await reopenReplacing(L, blob, () => openBlob(blob, name, 'add', null, { asKind: s.gridSurface ? 'surface' : 'points', band: s.band || 0, flatZ: s.gridSurface && s.flatZ != null ? s.flatZ : null, smooth: s.gridSurface ? !s.faceted : undefined }));
  }
  if (L2 && L2.gridSurface) {                                // drape: in-place rebuild, no reopen
    const want = s.drape || null;
    if ((L2.drapeSource || null) !== want) { const g = want ? S.layers.find((x) => x.name === want && x.docs && x.docs.gridDoc && x.docs.gridDoc.grid) : null; recolorSurface(L2, g); }
  }
  return L2;
}

// smooth (grid-gradient normals) ↔ faceted (flat per-triangle shading — reads the
// cell structure, better for some interpretation)
export function setSurfaceSmooth(L, smooth) {
  if (!L.gridSurface) return;
  L.surfaceSmooth = !!smooth;
  rebuildSurface(L);
  $('#meta').textContent = `${L.label || L.name} — ${smooth ? 'smooth' : 'faceted'} shading`;
}

// pick which BAND of a multi-band GeoTIFF is displayed (grid ≈ columns) — re-reads
// the grid at that band, preserving surface / drape / flat / visibility. Anytime,
// not import-only (like the block-model channel picker).
export async function setGridBand(L, band) {
  const gd = L.docs && L.docs.gridDoc; if (!gd || !(gd.grid.bands > 1)) return;
  const blob = gd.blob, name = L.name;
  const wasSurface = !!L.gridSurface, drape = L.drapeSource, flatZ = L.surfaceFlatZ, smooth = L.surfaceSmooth;
  const L2 = await reopenReplacing(L, blob, () => openBlob(blob, name, 'add', null, { asKind: wasSurface ? 'surface' : 'points', band, flatZ: wasSurface ? flatZ : null, smooth: wasSurface ? smooth : undefined }));
  if (L2) {
    if (wasSurface && drape) { const g = S.layers.find((x) => x.name === drape && x.docs && x.docs.gridDoc && x.docs.gridDoc.grid); if (g) recolorSurface(L2, g); }
  }
  renderLayers(); markProjectDirty();
  $('#meta').textContent = `${name} — band ${band + 1} of ${gd.grid.bands}`;
}
