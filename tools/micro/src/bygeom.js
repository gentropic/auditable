// micro bygeom — model × geometry, micro's flagship queries: select, flag (a
// painted column) or ratio (the volume fraction, a numeric column) a block model
// against a closed SOLID (@gcu/winding — generalized winding number, BVH, on a worker
// or the GPU; depth peel where it's faster), an open SURFACE (skirt closures →
// below / above / between), or a GRIDDED surface (a heightfield: bilinear footprint
// fraction, no BVH) — and assign-domains, one category column by max-fraction
// winner. Carved from index.html (phase 3).
import { Winding, buildBVH, windingBVH } from '../../../ext/winding/index.js';
import { weldVertices } from '../../../ext/geometry/index.js';
import { attrRowCountOf, hasRecords, layerTableHeader, meshVertexData } from './records.js';
import { S } from './state.js';
import { Peel } from '../../../ext/peel/index.js';
import { canScanColumnar, scanColumnar, zoneKeeper } from './colscan.js';
import { openBlockModel, openDmModel, openLas, openPly } from '../../../ext/condenser/src/main.js';
import { surfaceFromGrid } from './grid-ops.js';
import { gridWindowFromGTiff, windowForWorldBbox } from '../../../ext/gtiff/index.js';
import { paintRecount } from './columns.js';
import { mkLineage } from './lineage.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setBygeomHooks): _attrTables, addPaintColorOptions, addPaintValue, applyLayerSelection, clearSelection, createPaintCol, frame, layerShown, layerWorldBbox, markProjectDirty, nextSelEpoch, requestRender, selEpoch, selectionStatus, setLayerColorSel
let H = {};
export function setBygeomHooks(h) { H = h; }

// ── select by solid (§17): a closed context mesh classifies records by
// generalized winding number (@gcu/winding: BVH + robust containment). A new
// selection SOURCE, not a subsystem — results land in the ordinary per-layer
// selection masks (flags) or in a numeric ratio column on the painted-column
// storage (fraction-inside, the tonnage-weighting half). |w| ≥ 0.5 so flipped
// solids classify the same; mesh-bbox pretests short-circuit the far field.
export async function meshSolidOf(meshL, variant = 'solid') {
  meshL._solidBVH = meshL._solidBVH || {};
  if (meshL._solidBVH[variant]) return meshL._solidBVH[variant];
  const m = await meshVariant(meshL, variant);
  if (!m) return null;
  $('#meta').textContent = `${meshL.label || meshL.name} — building BVH…`;
  await new Promise((r) => setTimeout(r));
  const bvh = buildBVH(m.vertices, m.triangles);
  meshL._solidBVH[variant] = { vertices: m.vertices, triangles: m.triangles, nodes: bvh.nodes, triIndices: bvh.triIndices, bbox: m.bbox };
  return meshL._solidBVH[variant];
}

// parse the mesh ONCE; measure its topology (boundary-edge map — closed =
// every edge shared by exactly two triangles); orient closed meshes outward
// by signed volume (the dense evaluator is w >= 0.5). Cached per layer.
export function orientBySignedVolume(V, T) {
  let mx0 = Infinity, my0 = Infinity, mz0 = Infinity, mx1 = -Infinity, my1 = -Infinity, mz1 = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    if (V[i] < mx0) mx0 = V[i]; if (V[i] > mx1) mx1 = V[i];
    if (V[i + 1] < my0) my0 = V[i + 1]; if (V[i + 1] > my1) my1 = V[i + 1];
    if (V[i + 2] < mz0) mz0 = V[i + 2]; if (V[i + 2] > mz1) mz1 = V[i + 2];
  }
  const c0 = [(mx0 + mx1) / 2, (my0 + my1) / 2, (mz0 + mz1) / 2];
  let vol = 0;
  for (let t = 0; t < T.length; t += 3) {
    const ax = V[T[t] * 3] - c0[0], ay = V[T[t] * 3 + 1] - c0[1], az = V[T[t] * 3 + 2] - c0[2];
    const bx = V[T[t + 1] * 3] - c0[0], by = V[T[t + 1] * 3 + 1] - c0[1], bz = V[T[t + 1] * 3 + 2] - c0[2];
    const cx = V[T[t + 2] * 3] - c0[0], cy = V[T[t + 2] * 3 + 1] - c0[1], cz = V[T[t + 2] * 3 + 2] - c0[2];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return T;
  const flipped = new Uint32Array(T.length);
  for (let t = 0; t < T.length; t += 3) { flipped[t] = T[t]; flipped[t + 1] = T[t + 2]; flipped[t + 2] = T[t + 1]; }
  return flipped;
}

// (reReadMesh / meshVertexData / meshVertexHeader live in src/records.js — the
// mesh VERTEX location's provider, shared with the solid queries below)
export async function solidOrientedMesh(meshL) {
  if (meshL._solidMesh) return meshL._solidMesh;
  const md = meshL.docs && meshL.docs.meshDoc;
  if (!md || md.header.soup) return null;                  // context tier only (soup keeps no CPU triangles)
  const m0 = await meshVertexData(meshL);                  // one parse, shared with the vertex location
  // WELD first: a 3DFACE / STL / per-face OBJ soup repeats every vertex per face,
  // so without it every edge is a "boundary" and a sheet closes as a pile of
  // separate tents (the fixture topo: 144 boundary edges where the sheet has 24).
  // New arrays — the shared parse stays as the file gave it.
  const m = (() => {
    const w = weldVertices(m0.vertices, m0.triangles);     // @gcu/geometry — the same weld mesh QA runs
    return w.welded ? w : m0;                              // nothing to weld: the parse as it is
  })();
  // topology: edge → face count; a boundary edge has exactly one face
  const edges = new Map();
  const T = m.triangles;
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = T[t + e], b2 = T[t + (e + 1) % 3];
      const key = a < b2 ? a * 4294967296 + b2 : b2 * 4294967296 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const boundary = [];
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = T[t + e], b2 = T[t + (e + 1) % 3];
      const key = a < b2 ? a * 4294967296 + b2 : b2 * 4294967296 + a;
      if (edges.get(key) === 1) boundary.push(a, b2);
    }
  }
  // closed VOLUME = watertight (zero boundary edges) OR the user forces it: an ore/oxide
  // shell clipped at the model boundary leaves an open rim yet is watertight-enough that
  // the generalized winding number still classifies inside/outside cleanly. _forceClosed
  // orients by signed volume and skips the skirt-closure (below/above) path.
  const forced = !!meshL._forceClosed;
  const closed = boundary.length === 0 || forced;
  const bb = md.header.bbox;                               // the shared parse returns arrays, not a header
  const tris = closed ? orientBySignedVolume(m.vertices, T) : T;
  meshL._solidMesh = {
    vertices: m.vertices, triangles: tris,
    bbox: [...bb.min, ...bb.max],
    closed, forced, boundaryEdges: boundary.length / 2, boundary, welded: m.welded || 0,
  };
  return meshL._solidMesh;
}

// a surface CLOSURE: a vertical PRISM — every boundary edge drops a wall straight
// down ('below') or up ('above') to a flat cap far away, so the footprint does
// NOT taper with depth (the earlier fan to a single apex shaved the outer blocks
// deep under a surface: 1417 of 1536 "below" a topo that covered them all).
// Each wall traverses its boundary edge REVERSED — the skirt is the "second
// face" of that edge, so it must run backwards to stay consistently wound with
// the sheet; the cap fans the base loop from its centroid, exact in signed area
// for any loop and only ever wrong near the cap itself, far from every record.
// Signed-volume re-orient makes w ≥ 0.5 inside; beyond the footprint is
// genuinely outside — unclassified, honestly.
export function surfaceClosure(m, dir) {
  const [bx0, by0, bz0, bx1, by1, bz1] = m.bbox;
  const reach = Math.max(bx1 - bx0, by1 - by0, bz1 - bz0, 1) * 4;
  const capZ = dir === 'below' ? bz0 - reach : bz1 + reach;
  const nv = m.vertices.length / 3;
  const V = new Float64Array(m.vertices.length * 2 + 3);
  V.set(m.vertices);
  for (let i = 0; i < nv; i++) { V[(nv + i) * 3] = m.vertices[i * 3]; V[(nv + i) * 3 + 1] = m.vertices[i * 3 + 1]; V[(nv + i) * 3 + 2] = capZ; }
  const apex = nv * 2;
  V[apex * 3] = (bx0 + bx1) / 2; V[apex * 3 + 1] = (by0 + by1) / 2; V[apex * 3 + 2] = capZ;
  const nb = m.boundary.length / 2;
  const T = new Uint32Array(m.triangles.length + nb * 9);
  T.set(m.triangles);
  let at = m.triangles.length;
  for (let e = 0; e < m.boundary.length; e += 2) {
    const a = m.boundary[e], b = m.boundary[e + 1], a2 = nv + a, b2 = nv + b;
    T[at++] = b; T[at++] = a; T[at++] = a2;                // wall (b a a2) (b a2 b2) — the edge reversed
    T[at++] = b; T[at++] = a2; T[at++] = b2;
    T[at++] = b2; T[at++] = a2; T[at++] = apex;            // cap: the base edge reversed again, to the centroid
  }
  const tris = orientBySignedVolume(V, T);
  const bbox = [bx0, by0, Math.min(bz0, capZ), bx1, by1, Math.max(bz1, capZ)];
  return { vertices: V, triangles: tris, bbox, closed: true };
}

// the query VARIANT for a mode: a closed mesh is its own solid; an open
// surface answers below/above through its closures. Cached per layer.
export async function meshVariant(meshL, variant) {
  const m = await solidOrientedMesh(meshL);
  if (!m) return null;
  if (variant === 'solid' || m.closed) return m;           // closed meshes ignore below/above (inside covers it)
  meshL._variants = meshL._variants || {};
  if (!meshL._variants[variant]) meshL._variants[variant] = surfaceClosure(m, variant);
  return meshL._variants[variant];
}

// GPU winding is the default; a user can force the worker CPU path (slower, but it
// can't trip the GPU driver watchdog) when a device is flaky on a huge solid.
export let _windingGpu = (() => { try { return localStorage.getItem('micro.windingCpu') !== '1'; } catch { return true; } })();

export function setWindingGpu(on) {
  _windingGpu = !!on;
  try { localStorage.setItem('micro.windingCpu', on ? '0' : '1'); } catch { /* private */ }
  for (const L of S.layers) {                                // drop cached engines so the next run uses the chosen backend
    if (L._windingEngine && L._windingEngine.terminate) L._windingEngine.terminate();
    if (L._peelEngine && L._peelEngine.terminate) L._peelEngine.terminate();
    L._windingEngine = null; L._windingMeshes = null; L._peelEngine = null; L._peelMeshes = null;
  }
  $('#meta').textContent = `winding: ${on ? 'GPU' : 'CPU (worker)'} for the next solid query`;
}

// the cached @gcu/winding engine per mesh layer: a Web Worker when the environment
// allows (WebGPU inside it when present, unless CPU is forced), silent main-thread
// CPU fallback otherwise (file:// blocks blob workers)
export async function meshWinding(meshL, variant = 'solid') {
  const m = await meshVariant(meshL, variant);
  if (!m) return null;
  if (!meshL._windingEngine) {
    let W = null;
    try { W = await Winding.create({ worker: true, gpu: _windingGpu }); }
    catch { W = await Winding.create({}); }
    meshL._windingEngine = W;
    meshL._windingMeshes = new Set();
  }
  if (!meshL._windingMeshes.has(variant)) {
    meshL._windingEngine.setMesh(m.vertices, m.triangles, { frame: H.frame, name: variant });
    meshL._windingMeshes.add(variant);
  }
  return meshL._windingEngine;
}

// the cached @gcu/peel engine per mesh layer — the fast depth-peel path for a clean
// closed solid on a regular grid (one ray per column, exact along z). Honors the same
// GPU/CPU toggle as winding; silent CPU fallback if the worker/GPU can't start.
export async function meshPeel(meshL) {
  const m = await meshVariant(meshL, 'solid');
  if (!m) return null;
  if (!meshL._peelEngine) {
    let P = null;
    try { P = await Peel.create({ worker: true, gpu: _windingGpu }); }
    catch { P = await Peel.create({}); }
    meshL._peelEngine = P; meshL._peelMeshes = new Set();
  }
  if (!meshL._peelMeshes.has('solid')) {
    meshL._peelEngine.setMesh(m.vertices, m.triangles, { frame: H.frame, name: 'solid' });
    meshL._peelMeshes.add('solid');
  }
  return meshL._peelEngine;
}

// dense clipped-lattice evaluation for GRID layers: the block model's lattice
// clipped to the solid's bbox (the pretest, expressed as lattice clipping —
// cells outside are 0 by definition), handed whole to winding's evaluator
// (worker + per-layer progress), then one cheap position pass maps records
// onto the lattice. Returns null when the layer has no regular grid.
// remaining-time estimate for a long winding sweep — linear extrapolation from
// elapsed × (1−f)/f; blank until there's enough progress to be meaningful.
export function etaStr(t0, frac) {
  if (!(frac > 0.03)) return '';
  const rem = ((performance.now() - t0) / 1000) * (1 - frac) / frac;
  if (!Number.isFinite(rem) || rem < 0.5) return '';
  return rem >= 90 ? ` · ~${Math.round(rem / 60)} min left` : ` · ~${Math.max(1, Math.round(rem))}s left`;
}

export let _sbActive = null;

export async function evalSolidOnGrid(meshL, L, { mode, resolution = [3, 3, 3], onProgress, variant = 'solid', method = 'winding' } = {}) {
  const doc = L.docs.blockDoc;
  const grid = doc && (doc.grid || (doc.header && doc.header.grid));
  if (!grid || !grid.size || !grid.count) return null;
  if (grid.rot) return null;                               // a ROTATED lattice: the dense engine samples an axis-aligned one — callers fall back to per-centroid winding
  const usePeel = method === 'peel';
  const m = await meshVariant(meshL, usePeel ? 'solid' : variant);   // peel handles closed/open via surfaceType, no skirt closures
  const eng = usePeel ? await meshPeel(meshL) : await meshWinding(meshL, variant);
  if (!m || !eng) return null;
  const [dx, dy, dz] = grid.size;
  const [nx, ny, nz] = grid.count;
  const corner = [                                         // world MIN corner (originLocal = block-0 CENTER, frame-local)
    grid.originLocal[0] - dx / 2 + H.frame.origin[0],
    grid.originLocal[1] - dy / 2 + H.frame.origin[1],
    grid.originLocal[2] - dz / 2 + H.frame.origin[2],
  ];
  const [bx0, by0, bz0, bx1, by1, bz1] = m.bbox;
  const clip = (lo, hi, c, d, n) => [
    Math.max(0, Math.min(n - 1, Math.floor((lo - c) / d))),
    Math.max(0, Math.min(n - 1, Math.ceil((hi - c) / d) - 1)),
  ];
  const [i0, i1] = clip(bx0, bx1, corner[0], dx, nx);
  const [j0, j1] = clip(by0, by1, corner[1], dy, ny);
  // peel casts rays along Z: the ray must START outside the solid, so it needs the FULL
  // Z span (winding clips all 3 axes as a bbox pretest; peel would otherwise start the ray
  // inside the solid and mis-pair crossings). XY clip still limits which columns get a ray.
  // (Caveat: a solid extending past the model's Z floor/ceiling can't be peeled — use winding.)
  const [k0, k1] = usePeel ? [0, nz - 1] : clip(bz0, bz1, corner[2], dz, nz);
  const cnx = i1 - i0 + 1, cny = j1 - j0 + 1, cnz = k1 - k0 + 1;
  if (cnx < 1 || cny < 1 || cnz < 1) return { lookup: () => 0 };   // solid entirely off-model
  const bm = {
    origin: [corner[0] + i0 * dx, corner[1] + j0 * dy, corner[2] + k0 * dz],
    size: grid.size,
    count: [cnx, cny, cnz],
  };
  // flag = centroid membership (ONE sample/block) — winding needs no res³ grid and peel
  // is exact along its axis, so a flag is 27× cheaper than a sampled proportion. Running
  // winding flags at the [3,3,3] default was the DXGI_ERROR_DEVICE_HUNG on work-scale data.
  const res = mode === 'flag' ? [1, 1, 1] : resolution;
  const run = { W: eng, meshL, reject: null };
  _sbActive = run;
  const t0 = performance.now();
  const tag = eng.hasWorker ? (eng.hasGPU ? 'GPU' : 'CPU') : 'CPU';
  const prog2 = (f) => { if (onProgress) onProgress(f); $('#meta').textContent = `${usePeel ? 'peel' : 'winding'} sweep: ${Math.round(f * 100)}%${etaStr(t0, f)} (${tag})`; };
  let result;
  try {
    if (usePeel) {
      // peel: one ray per column, exact 1D interval along z. origin is block-0 CENTROID
      // (min corner + half); resolution is a 2D sub-grid on the XY plane (z stays exact).
      // surfaceType comes from the mesh's own topology — peel classifies an OPEN surface
      // natively (inside = BELOW it), no skirt closures; ABOVE is the complement.
      const bmPeel = { origin: [bm.origin[0] + dx / 2, bm.origin[1] + dy / 2, bm.origin[2] + dz / 2], size: grid.size, count: [cnx, cny, cnz] };
      const pres = mode === 'flag' ? [1, 1] : [Math.max(1, resolution[0] | 0), Math.max(1, resolution[1] | 0)];
      const stype = m.closed ? 'closed' : 'open';
      result = await Promise.race([
        eng.evaluate(bmPeel, { mode, axis: 'z', surfaceType: stype, maxPeels: 32, resolution: pres, frame: H.frame, onProgress: prog2, mesh: 'solid' }),
        new Promise((_, rej) => { run.reject = rej; }),
      ]);
      if (result && result.overflow) $('#meta').textContent = `peel: ${result.overflow.toLocaleString()} column(s) exceeded maxPeels — some blocks may be wrong; switch to winding`;
      if (result && !m.closed && variant === 'above') {      // peel 'open' gives BELOW; ABOVE = complement
        const vv = mode === 'proportion' ? result.proportions : result.flags;
        if (mode === 'proportion') for (let z = 0; z < vv.length; z++) vv[z] = 1 - vv[z];
        else for (let z = 0; z < vv.length; z++) vv[z] = vv[z] ? 0 : 1;
      }
    } else {
      result = await Promise.race([
        eng.evaluate(bm, { mode, resolution: res, threshold: 0.5, frame: H.frame, onProgress: prog2, mesh: variant }),
        new Promise((_, rej) => { run.reject = rej; }),
      ]);
    }
  } finally { if (_sbActive === run) _sbActive = null; }
  const values = mode === 'proportion' ? result.proportions : result.flags;
  return {
    engine: (usePeel ? 'peel:' : '') + (eng.hasWorker ? (eng.hasGPU ? 'worker+gpu' : 'worker') : 'cpu'),
    bbox: m.bbox,                                          // world; the spatial-pushdown filter for the sweep
    lookup(x, y, z) {
      const ii = Math.round((x - corner[0]) / dx - 0.5);
      const jj = Math.round((y - corner[1]) / dy - 0.5);
      const kk = Math.round((z - corner[2]) / dz - 0.5);
      if (ii < i0 || ii > i1 || jj < j0 || jj > j1 || kk < k0 || kk > k1) return 0;
      return values[(ii - i0) + (jj - j0) * cnx + (kk - k0) * cnx * cny];
    },
  };
}

export function sbCancelActive() {
  const run = _sbActive;
  if (!run) return;
  if (run.reject) run.reject(new Error('cancelled'));
  if (run.W && run.W.hasWorker) { run.W.terminate(); run.meshL._windingEngine = null; run.meshL._peelEngine = null; run.meshL._windingMeshes = null; run.meshL._peelMeshes = null; }
  _sbActive = null;
  H.nextSelEpoch(); _ratioEpoch++;
}

// which query variant answers a mode: solids by containment, surfaces by
// their closures ('between' runs below-of-A AND above-of-B)
export const SB_VARIANT = { inside: 'solid', outside: 'solid', below: 'below', above: 'above' };

export function solidHit(S) {
  const [bx0, by0, bz0, bx1, by1, bz1] = S.bbox;
  return (x, y, z) =>
    x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && z >= bz0 && z <= bz1
    && Math.abs(windingBVH(x, y, z, S.vertices, S.triangles, S.nodes, S.triIndices)) >= 0.5;
}

// stream world positions for an element layer — dh resolves O(1), providers
// re-stream (the cold-recipe spine the volume gestures already walk)
// world 3D bbox [minX,minY,minZ,maxX,maxY,maxZ] intersects a row group's footer
// X/Y/Z stats? (no stats → keep). The spatial-pushdown test for the eval sweep.
export let _pqPosSkipped = 0;

export function pqGroupBboxIntersects(rg, coordNames, bb) {
  const [xN, yN, zN] = coordNames;
  const rx = rg.columns[xN], ry = rg.columns[yN], rz = rg.columns[zN];
  if (!rx || !ry || !rz || typeof rx.min !== 'number') return true;
  return !(Number(rx.max) < bb[0] || Number(rx.min) > bb[3]
        || Number(ry.max) < bb[1] || Number(ry.min) > bb[4]
        || Number(rz.max) < bb[2] || Number(rz.min) > bb[5]);
}

// bbox: a SPATIAL PUSHDOWN — only for a question about what's INSIDE something.
// "Outside a solid" is every block the solid's bbox doesn't touch too, so those
// callers pass null (passing the bbox silently dropped every far-away row group
// from an outside selection / flag / fraction on Parquet models).
export async function* layerPositions(L, bbox = null) {
  const d = L.docs;
  const n = attrRowCountOf(L);
  if (d.meshDoc) {                                         // the `vertices` location: the records ARE positions
    const v = await meshVertexData(L);
    if (!v) return;
    const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), recs = new Uint32Array(n);
    for (let r = 0; r < n; r++) { x[r] = v.vertices[r * 3]; y[r] = v.vertices[r * 3 + 1]; z[r] = v.vertices[r * 3 + 2]; recs[r] = r; }
    yield { x, y, z, recs, base: 0, count: n };
    return;
  }
  if (d.dhDoc && d.dhDoc.recordPosition) {
    const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
    let count = 0;
    const recs = new Uint32Array(n);
    for (let r = 0; r < n; r++) {
      const pos = d.dhDoc.recordPosition(r);
      if (pos) { x[count] = pos[0]; y[count] = pos[1]; z[count] = pos[2]; recs[count] = r; count++; }
    }
    yield { x, y, z, recs, base: 0, count };
    return;
  }
  if (canScanColumnar(L)) {
    // the COLUMNAR engine (src/colscan.js): the coordinates of each row group (or .dm page run) read
    // on the worker pool (or on the page where workers can't start), handed over
    // in group order with backpressure — a slow consumer (the per-point winding
    // fallback) holds a few groups, never the model. Spatial pushdown: a Morton-
    // sorted parquet has tight per-group bboxes, so a solid's bbox skips the groups
    // it can't touch (never read). Records without finite coordinates aren't
    // positions (they were read as 0,0,0 — inside or outside a solid at the origin).
    const P = d.blockDoc.parquet, hh = layerTableHeader(L), mm = hh.mapping;
    const coordNames = P ? P.coordNames : [hh.columns[mm.x], hh.columns[mm.y], hh.columns[mm.z]];
    const ac = new AbortController(), queue = [];
    let wake = null, finished = false, failure = null, skipped = 0;
    const poke = () => { if (wake) { const w = wake; wake = null; w(); } };
    scanColumnar(L, { kernel: 'positions', params: { coords: coordNames }, exprs: [], extraCols: coordNames, signal: ac.signal,
      skipGroup: (g, rg) => { const sk = !!bbox && !!P && !pqGroupBboxIntersects(rg, P.coordNames, bbox); if (sk) skipped++; return sk; },   // footer bboxes: Parquet
      keepZone: bbox ? zoneKeeper(L, { bbox }) : null,     // a CSV's zone bboxes
      onPart: (g, part, start) => new Promise((taken) => { if (ac.signal.aborted) { taken(); return; } queue.push({ part, start, taken }); poke(); }) })
      .then(() => { finished = true; poke(); }, (e) => { failure = e; poke(); });
    try {
      for (;;) {
        if (queue.length) {
          const { part, start, taken } = queue.shift();
          const recs = new Uint32Array(part.rec.length);
          for (let i = 0; i < recs.length; i++) recs[i] = start + part.rec[i];
          yield { x: part.x, y: part.y, z: part.z, recs, base: start, count: recs.length };
          taken();                                         // the consumer came back for more → the next group may go
          continue;
        }
        if (failure) { if (failure.name === 'AbortError') return; throw failure; }
        if (finished) { _pqPosSkipped = skipped; try { window.__pqPosSkipped = skipped; } catch { /* headless */ } return; }
        await new Promise((r) => { wake = r; });
      }
    } finally {                                            // the consumer stopped early (superseded, cancelled) → stop the workers
      if (!finished) { ac.abort(); for (const q of queue.splice(0)) q.taken(); }
    }
  }
  let streamChunks = null;
  if (d.blockDoc && d.blockDoc.header.dm) ({ streamChunks } = await openDmModel(d.blockDoc.blob));
  else if (d.blockDoc) ({ streamChunks } = await openBlockModel(d.blockDoc.blob, { mapping: d.blockDoc.header.mapping }));
  else if (d.lasDoc) ({ streamChunks } = await openLas(d.lasDoc.blob));
  else if (d.plyDoc) ({ streamChunks } = await openPly(d.plyDoc.blob));
  if (!streamChunks) return;
  for await (const rc2 of streamChunks({ chunkPoints: 1 << 18 })) {
    yield { x: rc2.x, y: rc2.y, z: rc2.z, recs: rc2.recIdx || null, base: rc2.recStart || 0, count: rc2.count };
  }
}

// ── gridded surfaces (§7.1 → §17): a 2D grid IS a single-valued heightfield,
// so flag/ratio against it needs NO BVH and NO worker — a bilinear world
// sample per block, footprint-averaged, is the integral of the surface over
// the block and converges fast. O(1) per record: a 2M model in seconds. ──
// (surfaceFromGrid lives in src/grid-ops.js)
export function gridSurfaceOf(gridL) { return surfaceFromGrid(gridL.docs.gridDoc.grid); }

// XY world bbox [minX, minY, maxX, maxY] over a set of layers
export function targetsXYBbox(list) {
  let u = null;
  for (const L of list) { const b = H.layerWorldBbox(L); if (!b) continue; const w = [b[0], b[1], b[3], b[4]]; if (!u) u = w; else { if (w[0] < u[0]) u[0] = w[0]; if (w[1] < u[1]) u[1] = w[1]; if (w[2] > u[2]) u[2] = w[2]; if (w[3] > u[3]) u[3] = w[3]; } }
  return u;
}

// the grid used for EVALUATION: a display grid decoded from an overview is
// coarse, so decode the FULL-RES window covering the targets (only the
// overlapping tiles) — accurate flag/ratio without decoding the whole DEM
export async function residentGridForEval(gridL, bbox4) {
  const gd = gridL.docs.gridDoc;
  if (!gd || !gd.source || !gd.source.g || gd.fullRes || !bbox4) return gd.grid;
  try {
    const win = windowForWorldBbox(gd.source.g, 0, bbox4, 2);
    if (win.width <= 0 || win.height <= 0) return gd.grid;
    $('#meta').textContent = `${gridL.label || gridL.name} — reading full-res window ${win.width}×${win.height}…`;
    // the BAND is part of what is being evaluated: this is the sole eval path
    // for every by-surface query and surface-extend, and omitting it sampled
    // band 0's elevations whenever the user had picked another band
    return await gridWindowFromGTiff(gd.source.g, 0, win, gd.source.band || 0);
  } catch (e) {
    // degrading to the DISPLAY grid changes the answer's resolution — say so
    // rather than silently serving coarse numbers (the display grid may be a
    // decimated overview on a big COG)
    if (!gd.fullRes) $('#meta').textContent = `${gridL.label || gridL.name} — full-res read failed (${e.message}); using the display grid`;
    return gd.grid;
  }
}

// fraction of a block column [z−hz, z+hz] that lies BELOW the surface, averaged
// over an rx×ry plan sub-sample of the footprint (±hx,±hy). hz=0 (points) → a
// step. NaN = footprint entirely off-grid (leave the record untouched).
export function gridFracBelow(surf, x, y, z, hx, hy, hz, rx, ry) {
  let sum = 0, n = 0;
  for (let a = 0; a < rx; a++) {
    const sx = rx === 1 ? x : x - hx + (2 * hx) * (a + 0.5) / rx;
    for (let b = 0; b < ry; b++) {
      const sy = ry === 1 ? y : y - hy + (2 * hy) * (b + 0.5) / ry;
      const zs = surf.sampleZ(sx, sy);
      if (Number.isNaN(zs)) continue;
      sum += hz > 0 ? Math.max(0, Math.min(1, (zs - (z - hz)) / (2 * hz))) : (z < zs ? 1 : 0);
      n++;
    }
  }
  return n ? sum / n : NaN;
}

// per-record classifier: { hit, frac } for below / above / between (below A ∧
// above B). frac is the proportion for the ratio column.
export function gridClassify(surfA, surfB, mode, hx, hy, hz, rx, ry) {
  return (x, y, z) => {
    const pA = gridFracBelow(surfA, x, y, z, hx, hy, hz, rx, ry);
    if (Number.isNaN(pA)) return { hit: false, frac: NaN };
    if (mode === 'below') return { hit: pA >= 0.5, frac: pA };
    if (mode === 'above') return { hit: (1 - pA) >= 0.5, frac: 1 - pA };
    const pbB = gridFracBelow(surfB, x, y, z, hx, hy, hz, rx, ry);   // between
    if (Number.isNaN(pbB)) return { hit: false, frac: NaN };
    const pAboveB = 1 - pbB;
    return { hit: pA >= 0.5 && pAboveB >= 0.5, frac: Math.max(0, pA + pAboveB - 1) };
  };
}

export function blockHalfExtents(L) {
  const doc = L.docs.blockDoc;
  const g = doc && (doc.grid || (doc.header && doc.header.grid));
  return g && g.size ? [g.size[0] / 2, g.size[1] / 2, g.size[2] / 2] : [0, 0, 0];
}

export async function selectByGridSurface(gridL, { mode = 'below', meshB = null, targets = null, combine = 'replace', onProgress = null } = {}) {
  const epoch = H.nextSelEpoch();
  if (combine === 'replace') H.clearSelection({ silent: true });
  const v = combine === 'subtract' ? 0 : 1;
  const Ls = targets || S.layers.filter((L) => H.layerShown(L.id) && hasRecords(L) && !L.docs.gridDoc);   // what's on screen (a hidden group hides its layers)
  const bbox4 = targetsXYBbox(Ls);
  const surfA = surfaceFromGrid(await residentGridForEval(gridL, bbox4));
  const surfB = mode === 'between' && meshB && meshB.docs.gridDoc ? surfaceFromGrid(await residentGridForEval(meshB, bbox4)) : null;
  if (mode === 'between' && !surfB) { $('#meta').textContent = 'select by surface: between needs a second grid'; return; }
  for (let li = 0; li < Ls.length; li++) {
    const L = Ls[li];
    const n = attrRowCountOf(L);
    if (!n || L.kind === 'mesh' || L.docs.gridDoc) continue;
    if (!L._selMask || L._selMask.length !== n) L._selMask = new Uint8Array(n);
    const m = L._selMask;
    const [hx, hy, hz] = blockHalfExtents(L);
    const rr = hz > 0 ? 2 : 1;
    const cls = gridClassify(surfA, surfB, mode, hx, hy, hz, rr, rr);
    let done = 0;
    $('#meta').textContent = `select by surface: sampling ${L.label || L.name}…`;
    try {
      for await (const ch of layerPositions(L)) {
        if (epoch !== H.selEpoch()) return;
        for (let i = 0; i < ch.count; i++) {
          if (cls(ch.x[i], ch.y[i], ch.z[i]).hit) { const r = ch.recs ? ch.recs[i] : ch.base + i; if (r < n) m[r] = v; }
          if ((i & 0x3FFF) === 0x3FFF) { if (onProgress) onProgress((li + (done + i) / n) / Ls.length, `sampling · ${L.label || L.name}`); await new Promise((r2) => setTimeout(r2)); if (epoch !== H.selEpoch()) return; }
        }
        done += ch.count;
        if (onProgress) onProgress((li + Math.min(1, done / n)) / Ls.length, `sampling · ${L.label || L.name}`);
        await new Promise((r2) => setTimeout(r2));
      }
    } catch (e) { if (e.message !== 'cancelled') $('#meta').textContent = `select by surface: ${L.name} — ${e.message}`; return; }
    H.applyLayerSelection(L);
  }
  if (epoch !== H.selEpoch()) return;
  H.selectionStatus(); H.markProjectDirty(); H.requestRender();
}

export async function ratioByGridSurface(gridL, L, { name, res = [2, 2, 1], mode = 'below', meshB = null, onProgress = null } = {}) {
  const doc = L.docs.blockDoc;
  const grid = doc && (doc.grid || (doc.header && doc.header.grid));
  if (!grid || !grid.size) { $('#meta').textContent = 'ratio by surface: needs a regular block model'; return null; }
  const bbox4 = targetsXYBbox([L]);
  const surfA = surfaceFromGrid(await residentGridForEval(gridL, bbox4));
  const surfB = mode === 'between' && meshB && meshB.docs.gridDoc ? surfaceFromGrid(await residentGridForEval(meshB, bbox4)) : null;
  if (mode === 'between' && !surfB) { $('#meta').textContent = 'ratio by surface: between needs a second grid'; return null; }
  const resolution = Array.isArray(res) ? res.map((v) => Math.max(1, v | 0)) : [res, res, 1];
  const [hx, hy, hz] = [grid.size[0] / 2, grid.size[1] / 2, grid.size[2] / 2];
  const epoch = ++_ratioEpoch;
  const col = H.createPaintCol(L, name, 'ratio'); if (!col) return null;
  const n = attrRowCountOf(L), codes = col.codes;
  const cls = gridClassify(surfA, surfB, mode, hx, hy, hz, resolution[0], resolution[1]);
  let done = 0, touched = 0;
  try {
    for await (const ch of layerPositions(L)) {
      if (epoch !== _ratioEpoch) return null;
      for (let i = 0; i < ch.count; i++) {
        const { frac } = cls(ch.x[i], ch.y[i], ch.z[i]);
        if (Number.isNaN(frac) || !frac) continue;
        const r = ch.recs ? ch.recs[i] : ch.base + i;
        if (r < n) { codes[r] = Math.round(255 * frac); touched++; }
      }
      done += ch.count;
      if (onProgress) onProgress(Math.min(1, done / n), 'sampling');
      $('#meta').textContent = `ratio by surface: sampling ${done.toLocaleString()} records…`;
      await new Promise((r2) => setTimeout(r2));
    }
  } catch (e) { if (e.message !== 'cancelled') $('#meta').textContent = `ratio by surface: ${e.message}`; return null; }
  paintRecount(col); L._colStats = null; H.addPaintColorOptions(L);
  H.setLayerColorSel(L, 'paint:' + col.name);
  const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  $('#meta').textContent = `ratio by surface: ${touched.toLocaleString()} of ${n.toLocaleString()} blocks vs “${gridL.label || gridL.name}” → ${col.name}`;
  H.markProjectDirty(); H.requestRender();
  return col;
}

export async function flagByGridSurface(gridL, targets, { name, label = 'IN', mode = 'below', meshB = null, onProgress = null } = {}) {
  const bbox4 = targetsXYBbox(targets);
  const surfA = surfaceFromGrid(await residentGridForEval(gridL, bbox4));
  const surfB = mode === 'between' && meshB && meshB.docs.gridDoc ? surfaceFromGrid(await residentGridForEval(meshB, bbox4)) : null;
  if (mode === 'between' && !surfB) { $('#meta').textContent = 'flag by surface: between needs a second grid'; return 0; }
  const epoch = ++_ratioEpoch;
  let made = 0;
  for (let li = 0; li < targets.length; li++) {
    const L = targets[li];
    if (!layerTableHeader(L)) continue;
    const col = H.createPaintCol(L, name); if (!col) continue;
    const code = H.addPaintValue(L, col, label);
    const n = attrRowCountOf(L), codes = col.codes;
    const [hx, hy, hz] = blockHalfExtents(L);
    const rr = hz > 0 ? 2 : 1;
    const cls = gridClassify(surfA, surfB, mode, hx, hy, hz, rr, rr);
    let done = 0, cnt = 0;
    $('#meta').textContent = `flag by surface: sampling ${L.label || L.name}…`;
    try {
      for await (const ch of layerPositions(L)) {
        if (epoch !== _ratioEpoch) return made;
        for (let i = 0; i < ch.count; i++) {
          if (cls(ch.x[i], ch.y[i], ch.z[i]).hit) { const r = ch.recs ? ch.recs[i] : ch.base + i; if (r < n) { codes[r] = code; cnt++; } }
          if ((i & 0x3FFF) === 0x3FFF) { if (onProgress) onProgress((li + (done + i) / n) / targets.length, `sampling · ${L.label || L.name}`); await new Promise((r2) => setTimeout(r2)); if (epoch !== _ratioEpoch) return made; }
        }
        done += ch.count;
        if (onProgress) onProgress((li + Math.min(1, done / n)) / targets.length, `sampling · ${L.label || L.name}`);
        await new Promise((r2) => setTimeout(r2));
      }
    } catch (e) { if (e.message !== 'cancelled') $('#meta').textContent = `flag by surface: ${L.name} — ${e.message}`; return made; }
    paintRecount(col); L._colStats = null; H.addPaintColorOptions(L);
    const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
    H.setLayerColorSel(L, 'paint:' + name);
    made++;
    $('#meta').textContent = `flag by surface: ${cnt.toLocaleString()} of ${n.toLocaleString()} → ${name} = ${label} · ${L.label || L.name}`;
  }
  H.markProjectDirty(); H.requestRender();
  return made;
}

export async function selectBySolid(meshL, { mode = 'inside', meshB = null, targets = null, combine = 'replace', onProgress = null, method = 'winding' } = {}) {
  if (meshL.docs.gridDoc) return selectByGridSurface(meshL, { mode, meshB, targets, combine, onProgress });
  const between = mode === 'between';
  const variant = between ? 'below' : (SB_VARIANT[mode] || 'solid');
  const want = mode !== 'outside';
  const epoch = H.nextSelEpoch();
  if (combine === 'replace') H.clearSelection({ silent: true });
  const v = combine === 'subtract' ? 0 : 1;
  const Ls = targets || S.layers.filter((L) => H.layerShown(L.id) && hasRecords(L));
  let S = null, SB = null;                                 // the sparse-path BVHs, built lazily
  for (let li = 0; li < Ls.length; li++) {
    const L = Ls[li];
    const n = attrRowCountOf(L);
    if (!n || L.kind === 'mesh') continue;
    if (!L._selMask || L._selMask.length !== n) L._selMask = new Uint8Array(n);
    const m = L._selMask;
    const prog = (f, label) => { if (onProgress) onProgress((li + f) / Ls.length, `${label} · ${L.label || L.name}`); };
    $('#meta').textContent = `select by solid: sweeping ${L.label || L.name}…`;
    try {
      // grid layers: the dense engine (worker + clipped lattice) — centroids only
      const dense = L.docs.blockDoc ? await evalSolidOnGrid(meshL, L, { mode: 'flag', variant, method, onProgress: (f) => prog(f * (between ? 0.4 : 0.8), 'winding') }) : null;
      const denseB = dense && between ? await evalSolidOnGrid(meshB, L, { mode: 'flag', variant: 'above', method, onProgress: (f) => prog(0.4 + f * 0.4, 'winding B') }) : null;
      if (dense && (!between || denseB)) {
        let done = 0;
        for await (const ch of layerPositions(L, want || between ? dense.bbox : null)) {
          if (epoch !== H.selEpoch()) return;
          for (let i = 0; i < ch.count; i++) {
            const hitA = dense.lookup(ch.x[i], ch.y[i], ch.z[i]) >= 1;
            const hit = between ? (hitA && denseB.lookup(ch.x[i], ch.y[i], ch.z[i]) >= 1) : (hitA === want);
            if (hit) {
              const r = ch.recs ? ch.recs[i] : ch.base + i;
              if (r < n) m[r] = v;
            }
          }
          done += ch.count;
          prog(0.8 + 0.2 * Math.min(1, done / n), 'mapping');
          await new Promise((r2) => setTimeout(r2));
        }
      } else {
        if (!S) S = await meshSolidOf(meshL, variant);
        if (between && !SB) SB = await meshSolidOf(meshB, 'above');
        if (!S || (between && !SB)) { $('#meta').textContent = 'select by solid: needs context-tier meshes'; return; }
        const inA = solidHit(S);
        const inB = between ? solidHit(SB) : null;
        let done = 0;
        for await (const ch of layerPositions(L, want || between ? S.bbox : null)) {
          if (epoch !== H.selEpoch()) return;
          for (let i = 0; i < ch.count; i++) {
            const hitA = inA(ch.x[i], ch.y[i], ch.z[i]);
            const hit = between ? (hitA && inB(ch.x[i], ch.y[i], ch.z[i])) : (hitA === want);
            if (hit) {
              const r = ch.recs ? ch.recs[i] : ch.base + i;
              if (r < n) m[r] = v;
            }
            if ((i & 0x3FFF) === 0x3FFF) {                 // slice the winding loop — the UI stays live
              prog(Math.min(1, (done + i) / n), 'winding');
              await new Promise((r2) => setTimeout(r2));
              if (epoch !== H.selEpoch()) return;
            }
          }
          done += ch.count;
          prog(Math.min(1, done / n), 'winding');
          await new Promise((r2) => setTimeout(r2));
        }
      }
    } catch (e) { if (e.message !== 'cancelled') $('#meta').textContent = `select by solid: ${L.name} — ${e.message}`; return; }
    H.applyLayerSelection(L);
  }
  if (epoch !== H.selEpoch()) return;
  H.selectionStatus();
  H.markProjectDirty(); H.requestRender();
}

// fraction-inside ratio column (block grids): res³ sub-samples across each
// block's exact extent → a u8 code (code/255 ≈ 0.4 % resolution, finer than
// the sampling error). Lands on the painted-column storage, kind 'ratio' —
// filter / scan / table / export see a plain numeric column.
export let _ratioEpoch = 0;

export async function ratioBySolid(meshL, L, { name, res = 3, mode = 'inside', meshB = null, onProgress = null, method = 'winding' } = {}) {
  if (meshL.docs.gridDoc) return ratioByGridSurface(meshL, L, { name, res, mode, meshB, onProgress });
  const doc = L.docs.blockDoc;
  const grid = doc && (doc.grid || (doc.header && doc.header.grid));
  if (!grid || !grid.size) { $('#meta').textContent = 'ratio by solid: needs a regular block model'; return null; }
  const resolution = Array.isArray(res) ? res.map((v) => Math.max(1, v | 0)) : [res, res, res];
  const between = mode === 'between';
  const variant = between ? 'below' : (SB_VARIANT[mode] || 'solid');
  const epoch = ++_ratioEpoch;
  $('#meta').textContent = 'ratio by solid: winding sweep…';
  let dense, denseB = null;
  try {
    dense = await evalSolidOnGrid(meshL, L, {
      mode: 'proportion', resolution, variant, method,
      onProgress: (f) => {
        if (onProgress) onProgress(f * (between ? 0.45 : 0.85), 'winding sweep');
        $('#meta').textContent = `ratio by solid: winding sweep ${Math.round(f * 100)}%…`;
      },
    });
    if (between) denseB = await evalSolidOnGrid(meshB, L, {
      mode: 'proportion', resolution, variant: 'above', method,
      onProgress: (f) => {
        if (onProgress) onProgress(0.45 + f * 0.4, 'winding sweep B');
        $('#meta').textContent = `ratio by solid: second surface ${Math.round(f * 100)}%…`;
      },
    });
  } catch (e) { if (e.message !== 'cancelled') $('#meta').textContent = `ratio by solid: ${e.message}`; return null; }
  if (!dense || (between && !denseB)) { $('#meta').textContent = (L.docs.blockDoc && L.docs.blockDoc.header.grid && L.docs.blockDoc.header.grid.rot) ? 'ratio by solid: proportions on a ROTATED model aren\'t supported yet — select / flag by solid work (per centroid)' : 'ratio by solid: needs context-tier meshes + a regular model'; return null; }
  if (epoch !== _ratioEpoch) return null;
  const col = H.createPaintCol(L, name, 'ratio');
  if (!col) return null;
  const n = attrRowCountOf(L);
  const codes = col.codes;
  let done = 0, touched = 0;
  for await (const ch of layerPositions(L, mode === 'outside' ? null : dense.bbox)) {
    if (epoch !== _ratioEpoch) return null;
    for (let i = 0; i < ch.count; i++) {
      let p2 = dense.lookup(ch.x[i], ch.y[i], ch.z[i]);
      // between = fraction below A AND above B: exact for non-crossing
      // surfaces (probe columns are monotone), conservative when they cross
      if (between) p2 = Math.max(0, p2 + denseB.lookup(ch.x[i], ch.y[i], ch.z[i]) - 1);
      else if (mode === 'outside') p2 = 1 - p2;
      if (!p2) continue;
      const r = ch.recs ? ch.recs[i] : ch.base + i;
      if (r < n) { codes[r] = Math.round(255 * p2); touched++; }
    }
    done += ch.count;
    if (onProgress) onProgress(0.85 + 0.15 * Math.min(1, done / n), 'mapping records');
    $('#meta').textContent = `ratio by solid: mapping ${done.toLocaleString()} records…`;
    await new Promise((r2) => setTimeout(r2));
  }
  col.lineage = mkLineage('fraction', { by: 'solid', solid: meshL.name, mode, touched }, [meshL.lineage, L.lineage]);
  paintRecount(col);
  L._colStats = null;
  H.addPaintColorOptions(L);
  H.setLayerColorSel(L, 'paint:' + col.name);                // see the result land
  const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  $('#meta').textContent = `ratio by solid: ${touched.toLocaleString()} of ${n.toLocaleString()} blocks touch “${meshL.label || meshL.name}” → ${col.name} (${dense.engine})`;
  H.markProjectDirty(); H.requestRender();
  return col;
}

// flag column: mark records inside (or outside) the solid// flag column: mark records inside (or outside) the solid with a value in a
// NEW painted column — one step instead of select-then-apply, and because it
// IS a painted column you can touch it up with the brush afterwards. Works
// on any table-backed layer (blocks, xyz points, drillholes).
export async function flagBySolid(meshL, targets, { name, label = 'IN', mode = 'inside', meshB = null, onProgress = null, method = 'winding' } = {}) {
  if (meshL.docs.gridDoc) return flagByGridSurface(meshL, targets, { name, label, mode, meshB, onProgress });
  const between = mode === 'between';
  const failed = [];                                       // targets that errored mid-loop → thrown after, not swallowed
  const variant = between ? 'below' : (SB_VARIANT[mode] || 'solid');
  const want = mode !== 'outside';
  const epoch = ++_ratioEpoch;
  let made = 0;
  let S = null, SB = null;
  for (let li = 0; li < targets.length; li++) {
    const L = targets[li];
    if (!layerTableHeader(L)) continue;                    // painted columns need a table behind them
    const col = H.createPaintCol(L, name);
    if (!col) continue;                                    // name taken here — createPaintCol already said so
    const code = H.addPaintValue(L, col, label);
    const n = attrRowCountOf(L);
    const codes = col.codes;
    const prog = (f, lab) => { if (onProgress) onProgress((li + f) / targets.length, `${lab} · ${L.label || L.name}`); };
    let cnt = 0, done = 0;
    $('#meta').textContent = `flag by solid: sweeping ${L.label || L.name}…`;
    try {
      const dense = L.docs.blockDoc ? await evalSolidOnGrid(meshL, L, { mode: 'flag', variant, method, onProgress: (f) => prog(f * (between ? 0.4 : 0.8), 'winding') }) : null;
      const denseB = dense && between ? await evalSolidOnGrid(meshB, L, { mode: 'flag', variant: 'above', method, onProgress: (f) => prog(0.4 + f * 0.4, 'winding B') }) : null;
      if (epoch !== _ratioEpoch) return made;
      if (dense && (!between || denseB)) {
        for await (const ch of layerPositions(L, want || between ? dense.bbox : null)) {
          if (epoch !== _ratioEpoch) return made;
          for (let i = 0; i < ch.count; i++) {
            const hitA = dense.lookup(ch.x[i], ch.y[i], ch.z[i]) >= 1;
            const hit = between ? (hitA && denseB.lookup(ch.x[i], ch.y[i], ch.z[i]) >= 1) : (hitA === want);
            if (hit) {
              const r = ch.recs ? ch.recs[i] : ch.base + i;
              if (r < n) { codes[r] = code; cnt++; }
            }
          }
          done += ch.count;
          prog(0.8 + 0.2 * Math.min(1, done / n), 'mapping');
          await new Promise((r2) => setTimeout(r2));
        }
      } else {
        if (!S) S = await meshSolidOf(meshL, variant);
        if (between && !SB) SB = await meshSolidOf(meshB, 'above');
        if (!S || (between && !SB)) { $('#meta').textContent = 'flag by solid: needs context-tier meshes'; return made; }
        const inA = solidHit(S);
        const inB = between ? solidHit(SB) : null;
        for await (const ch of layerPositions(L, want || between ? S.bbox : null)) {
          if (epoch !== _ratioEpoch) return made;
          for (let i = 0; i < ch.count; i++) {
            const hitA = inA(ch.x[i], ch.y[i], ch.z[i]);
            const hit = between ? (hitA && inB(ch.x[i], ch.y[i], ch.z[i])) : (hitA === want);
            if (hit) {
              const r = ch.recs ? ch.recs[i] : ch.base + i;
              if (r < n) { codes[r] = code; cnt++; }
            }
            if ((i & 0x3FFF) === 0x3FFF) {
              prog(Math.min(1, (done + i) / n), 'winding');
              await new Promise((r2) => setTimeout(r2));
              if (epoch !== _ratioEpoch) return made;
            }
          }
          done += ch.count;
          prog(Math.min(1, done / n), 'winding');
          await new Promise((r2) => setTimeout(r2));
        }
      }
    } catch (e) {
      if (e.message === 'cancelled') return made;
      // a real failure on ONE target used to `return made` — reporting the
      // targets flagged before it as success and silently skipping the rest.
      failed.push(`${L.name}: ${e.message}`); continue;
    }
    col.lineage = mkLineage('flag', { by: 'solid', solid: meshL.name, mode, label, inside: cnt }, [meshL.lineage, L.lineage]);
    paintRecount(col);
    L._colStats = null;
    H.addPaintColorOptions(L);
    const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
    H.setLayerColorSel(L, 'paint:' + name);
    made++;
    $('#meta').textContent = `flag by solid: ${cnt.toLocaleString()} of ${n.toLocaleString()} inside → ${name} · filter with ${name} == "${label}"`;
  }
  H.markProjectDirty(); H.requestRender();
  if (failed.length) throw new Error(`flag by solid failed on ${failed.length} of ${targets.length} target${targets.length > 1 ? 's' : ''} — ${failed[0]}`);
  return made;
}

// ── ASSIGN DOMAINS (§7.2's payoff): one proportion field per solid, ONE
// categorical column — each block goes to the solid holding its largest
// fraction (ties → the earlier solid; nothing claims → unpainted). The
// vendor-file → coded-model loop in a single run; painted-column storage,
// so the result is brush-editable afterwards. ──
export async function assignDomains(solids, L, { name = 'DOMAIN', res = [2, 2, 2], onProgress = null } = {}) {
  const doc = L.docs.blockDoc;
  const grid = doc && (doc.grid || (doc.header && doc.header.grid));
  if (!grid || !grid.size) { $('#meta').textContent = 'assign domains: needs a regular block model'; return null; }
  const resolution = Array.isArray(res) ? res.map((v) => Math.max(1, v | 0)) : [res, res, res];
  const epoch = ++_ratioEpoch;
  const fields = [];
  for (let k = 0; k < solids.length; k++) {
    const meshL = solids[k];
    $('#meta').textContent = `assign domains: ${meshL.label || meshL.name}…`;
    let dense = null;
    try {
      dense = await evalSolidOnGrid(meshL, L, {
        mode: 'proportion', resolution, variant: 'solid',
        onProgress: (f) => { if (onProgress) onProgress((k + f) / (solids.length + 0.3), meshL.label || meshL.name); },
      });
    } catch (e) {
      if (e.message === 'cancelled') return null;
      // every sibling (selectBySolid / ratioBySolid / flagBySolid) reports this.
      // Swallowing it made a solid that FAILED indistinguishable from one that
      // legitimately claims nothing — a wrong domain coding with no indication.
      $('#meta').textContent = `assign domains: “${meshL.label || meshL.name}” failed — ${e.message}`;
      throw e;
    }
    if (epoch !== _ratioEpoch) return null;
    fields.push(dense);                                    // null = unreadable mesh → claims nothing
  }
  const col = H.createPaintCol(L, name);
  if (!col) return null;
  const codeOf = solids.map((meshL) => H.addPaintValue(L, col, (meshL.label || meshL.name).replace(/\.[^.]+$/, '')));
  const n = attrRowCountOf(L);
  const codes = col.codes;
  let done = 0, assigned = 0;
  const uBbox = fields.reduce((u, d2) => { if (!d2 || !d2.bbox) return u; if (!u) return [...d2.bbox]; for (let a = 0; a < 3; a++) { if (d2.bbox[a] < u[a]) u[a] = d2.bbox[a]; if (d2.bbox[a + 3] > u[a + 3]) u[a + 3] = d2.bbox[a + 3]; } return u; }, null);
  for await (const ch of layerPositions(L, uBbox)) {
    if (epoch !== _ratioEpoch) return null;
    for (let i = 0; i < ch.count; i++) {
      let best = 0, bi = -1;
      for (let k = 0; k < fields.length; k++) {
        if (!fields[k]) continue;
        const p2 = fields[k].lookup(ch.x[i], ch.y[i], ch.z[i]);
        if (p2 > best) { best = p2; bi = k; }
      }
      if (bi < 0) continue;
      const r = ch.recs ? ch.recs[i] : ch.base + i;
      if (r < n) { codes[r] = codeOf[bi]; assigned++; }
    }
    done += ch.count;
    if (onProgress) onProgress((solids.length + 0.3 * Math.min(1, done / n)) / (solids.length + 0.3), 'assigning');
    $('#meta').textContent = `assign domains: assigning ${done.toLocaleString()}…`;
    await new Promise((r2) => setTimeout(r2));
  }
  paintRecount(col);
  L._colStats = null;
  H.addPaintColorOptions(L);
  H.setLayerColorSel(L, 'paint:' + col.name);
  const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  $('#meta').textContent = `assign domains: ${assigned.toLocaleString()} of ${n.toLocaleString()} claimed by ${solids.length} solids → ${name}`;
  H.markProjectDirty(); H.requestRender();
  return col;
}
