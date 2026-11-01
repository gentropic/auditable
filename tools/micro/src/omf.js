// micro OMF — an Open Mining Format v1 project (.omf; Leapfrog, Surpac, Vulcan,
// Deswik, Micromine all write it) opens as one layer per element, in a group named
// after the file. Each element goes through the host door (addLayer), which writes
// it once into micro's own formats — a block model to Parquet with its lattice
// DECLARED and checked, a surface to PLY — so it is a file-backed layer like any
// other: filter, paint, analyse, save with the project.
//   VolumeElement   → blocks: the tensor grid's centroids (rotated axes kept), one
//                     column per cell attribute; uneven tensor widths → points
//   PointSetElement → points, one column per vertex attribute
//   SurfaceElement  → mesh (triangulated surfaces); gridded surfaces are refused —
//                     their vertex order isn't pinned down well enough to draw them
//                     right
//   LineSetElement  → not read yet (said so)
// Scalar data → a numeric column; mapped data → a text column from its first legend
// of text values (index −1 → blank); vectors / dates / textures are skipped and
// counted. Project.origin offsets every element, as the format says.
// The whole file is read into memory (OMF v1 deflates each array in one piece).
import { readOMF, openOMF, blockModelCentroids } from '../../../ext/omf1/index.js';
// the app's side, passed in once (setOmfHooks): addLayer(spec) → layer id,
// closeAllLayers(), layerById(id), mkLineage, openLineage, renderLayers()
let H = {};
export function setOmfHooks(h) { H = h; }

const KIND = { VolumeElement: 'block model', PointSetElement: 'points', SurfaceElement: 'surface', LineSetElement: 'lines' };
const add3 = (a, b) => [(+a[0] || 0) + (+b[0] || 0), (+a[1] || 0) + (+b[1] || 0), (+a[2] || 0) + (+b[2] || 0)];
const num = (t) => Array.from(t, Number);
const lenOf = (t) => (t ? t.length : 0);

// the open dialog's line: the elements, without decoding an array
export async function omfCensus(blob) {
  const r = await openOMF(blob);
  const els = r.project.elements || [];
  return els.map((e) => {
    const g = e.geometry || {};
    // sizes without decoding: a volume's tensors are short; the other arrays are deflated stubs
    const size = e.type === 'VolumeElement' ? `${lenOf(g.tensor_u)}×${lenOf(g.tensor_v)}×${lenOf(g.tensor_w)}` : '';
    return { name: e.name || '(unnamed)', type: e.type, kind: KIND[e.type] || e.type, size, data: (e.data || []).length };
  });
}

// one element's data → columns at `location` (+ what was skipped)
function dataColumns(e, location, n) {
  const cols = {}, skipped = [];
  for (const d of e.data || []) {
    const nm = String(d.name || 'data').trim() || 'data';
    if (d.location && d.location !== location) { skipped.push(`${nm} (on ${d.location})`); continue; }
    if (d.type === 'ScalarData' && d.array && d.array.length === n) cols[nm] = d.array instanceof Float64Array ? d.array : Float64Array.from(d.array, Number);
    else if (d.type === 'MappedData' && d.indices && d.indices.length === n) {
      // the first legend of text values names the categories; else the first of
      // numbers (a code legend), as text; else the index itself
      const legs = (d.legends || []).filter((l) => l.values && l.values.length != null && !(l.values instanceof Blob));
      const leg = legs.find((l) => Array.from(l.values).every((v) => typeof v === 'string')) || legs.find((l) => Array.from(l.values).every((v) => Number.isFinite(Number(v))));
      const vals = leg ? Array.from(leg.values, String) : null;
      cols[nm] = Array.from(d.indices, (k) => { const i = Number(k); return i < 0 ? null : vals ? (vals[i] ?? null) : String(i); });
    } else skipped.push(`${nm} (${d.type || 'unknown'})`);
  }
  return { cols, skipped };
}
const uniq = (cols, base) => { let nm = base; while (cols[nm]) nm += '_'; return nm; };

// a uniform tensor grid → its declared lattice (block 0's centroid + U/V/W); null if uneven
function latticeOf(g, origin) {
  const t = [g.tensor_u, g.tensor_v, g.tensor_w].map(num);
  if (t.some((a) => !a.length || a.some((w) => Math.abs(w - a[0]) > 1e-9 * Math.max(1, a[0])))) return null;
  const ax = [g.axis_u || [1, 0, 0], g.axis_v || [0, 1, 0], g.axis_w || [0, 0, 1]].map((v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); });
  const p = t.map((a) => a[0]);
  const c0 = [0, 1, 2].map((k) => origin[k] + ax[0][k] * p[0] / 2 + ax[1][k] * p[1] / 2 + ax[2][k] * p[2] / 2);
  return { origin: c0, U: ax[0].map((c) => c * p[0]), V: ax[1].map((c) => c * p[1]), W: ax[2].map((c) => c * p[2]), counts: t.map((a) => a.length), source: 'omf' };
}

// → { layers: [ids], notes: [text] }
export async function openOmfBlob(blob, name, mode = 'replace') {
  if (mode !== 'add') H.closeAllLayers();
  const project = await readOMF(blob);
  const po = project.origin || [0, 0, 0];
  const group = String(name).replace(/\.omf$/i, '');
  const ids = [], notes = [];
  for (const e of project.elements || []) {
    const en = e.name || KIND[e.type] || 'element';
    const g = e.geometry || {};
    try {
      let spec = null, skipped = [];
      if (e.type === 'VolumeElement') {
        const o = add3(po, g.origin || [0, 0, 0]);
        const xyz = blockModelCentroids({ ...g, origin: o }), n = xyz.length / 3;
        const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
        for (let i = 0; i < n; i++) { X[i] = xyz[3 * i]; Y[i] = xyz[3 * i + 1]; Z[i] = xyz[3 * i + 2]; }
        const dc = dataColumns(e, 'cells', n); skipped = dc.skipped;
        const cols = {}, xn = uniq(dc.cols, 'X'), yn = uniq(dc.cols, 'Y'), zn = uniq(dc.cols, 'Z');
        cols[xn] = X; cols[yn] = Y; cols[zn] = Z; Object.assign(cols, dc.cols);
        const lattice = latticeOf(g, o);
        spec = { kind: lattice ? 'blocks' : 'points', columns: cols, roles: { x: xn, y: yn, z: zn }, ...(lattice ? { lattice } : {}) };
        if (!lattice) notes.push(`${en}: uneven block widths — opened as centroids (points)`);
      } else if (e.type === 'PointSetElement') {
        const v = g.vertices, n = v ? v.length / 3 : 0;
        if (!n) { notes.push(`${en}: no vertices`); continue; }
        const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
        for (let i = 0; i < n; i++) { X[i] = v[3 * i] + (+po[0] || 0); Y[i] = v[3 * i + 1] + (+po[1] || 0); Z[i] = v[3 * i + 2] + (+po[2] || 0); }
        const dc = dataColumns(e, 'vertices', n); skipped = dc.skipped;
        const cols = {}, xn = uniq(dc.cols, 'X'), yn = uniq(dc.cols, 'Y'), zn = uniq(dc.cols, 'Z');
        cols[xn] = X; cols[yn] = Y; cols[zn] = Z; Object.assign(cols, dc.cols);
        spec = { kind: 'points', columns: cols, roles: { x: xn, y: yn, z: zn } };
      } else if (e.type === 'SurfaceElement') {
        if (g.type !== 'SurfaceGeometry') { notes.push(`${en}: a gridded surface — not read yet`); continue; }
        const v = Float64Array.from(g.vertices || [], Number);
        for (let i = 0; i < v.length; i += 3) { v[i] += +po[0] || 0; v[i + 1] += +po[1] || 0; v[i + 2] += +po[2] || 0; }
        spec = { kind: 'mesh', vertices: v, triangles: Uint32Array.from(g.triangles || [], Number) };
        for (const d of e.data || []) skipped.push(`${d.name || 'data'} (surface data)`);
      } else { notes.push(`${en}: ${KIND[e.type] || e.type} — not read yet`); continue; }
      const lid = await H.addLayer({ ...spec, name: en, group });
      const L = H.layerById(lid);
      if (L) L.lineage = H.mkLineage('omf', { element: en, type: e.type, ...(spec.lattice ? { lattice: 'declared' } : {}) }, [H.openLineage(name, blob)]);
      ids.push(lid);
      if (skipped.length) notes.push(`${en}: skipped ${skipped.join(', ')}`);
    } catch (err) { notes.push(`${en}: ${err.message}`); }
  }
  H.renderLayers();
  return { layers: ids, notes };
}
