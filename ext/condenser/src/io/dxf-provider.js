// DXF — the drafting exchange format mine software round-trips everything
// through: triangulated surfaces and solids as 3DFACE soup or polyface-mesh
// POLYLINEs, design strings / contours as 3D polylines, survey pegs as POINTs.
// @gcu/dxf parses (read + explode + extractScene); this provider shapes the
// scene into the standard docs:
//
//   openDxf(blob, { as }) →
//     mesh    { header:{kind:'mesh', format:'dxf', …}, vertices, triangles }
//     strings { header:{kind:'strings', …}, streamChunks, fetchRecord, recordPosition }
//             — stick-shaped chunks (ax…bz segments), category = the DXF layer
//     points  { header:{kind:'blockmodel', grid:null, …}, streamChunks, fetchRecord }
//             — grid:null downgrades to a point cloud at the caller, like any
//             irregular table
//
// `as` ('mesh' | 'strings' | 'points') overrides the dominant-content pick
// (faces win, then strings, then points). A DXF is parsed resident — like OBJ
// and MSH, these are design files, not block models.
import { read as readDxf } from '../../../dxf/src/read.js';
import { extractScene } from '../../../dxf/src/scene.js';

export async function peekDxfScene(blob) {
  const scene = extractScene(readDxf(await blob.text()));
  return scene.counts;
}

export async function openDxf(blob, { as = null } = {}) {
  const doc = readDxf(await blob.text());
  const scene = extractScene(doc);
  const kinds = [];
  if (scene.mesh) kinds.push('mesh');
  if (scene.strings.length) kinds.push('strings');
  if (scene.points.length) kinds.push('points');
  const want = as || kinds[0];
  if (!want || !kinds.length) throw new Error('dxf: no 3D scene geometry (no faces, polylines or points)');
  if (as && !kinds.includes(as)) throw new Error(`dxf: no ${as} content — the file carries ${kinds.join(' + ')}`);

  const bbox = scene.bbox
    ? { min: scene.bbox.slice(0, 3), max: scene.bbox.slice(3) }
    : { min: [0, 0, 0], max: [1, 1, 1] };
  // ≤255 layers fit the category byte; a wilder file keeps geometry, loses classes
  const categories = scene.layers.length && scene.layers.length <= 255 ? scene.layers : null;
  const catOf = (layer) => (categories ? Math.max(0, categories.indexOf(layer)) : 0);
  // authored colours: a uniform mesh colour → the tint; per-layer colours →
  // the category palette (indices track `categories`). Pure white is ACI 7 =
  // "foreground" — a theme placeholder, not a colour choice — so it does NOT
  // tint (the viewer's default reads better on any background).
  const authored = (c) => (c && !(c[0] === 255 && c[1] === 255 && c[2] === 255) ? c : null);
  const catColors = categories ? categories.map((l) => authored(scene.layerColors[l])) : null;
  const common = { format: 'dxf', bbox, dxfLayers: scene.layers, dxfCounts: scene.counts, catColors, warnings: doc.warnings };

  if (want === 'mesh') {
    const { vertices, triangles } = scene.mesh;
    return {
      header: {
        ...common, kind: 'mesh',
        vertexCount: (vertices.length / 3) | 0, triCount: (triangles.length / 3) | 0,
        vertexColumns: [],
        meshColor: authored(scene.mesh.color),             // [r,g,b] 0..255 when every face agrees (foreground-white → null)
      },
      vertices, triangles,
    };
  }

  if (want === 'strings') {
    // flatten the polylines into segment arrays once (already resident)
    let nSeg = 0;
    for (const s of scene.strings) nSeg += Math.max(0, s.pts.length / 3 - 1);
    const ax = new Float64Array(nSeg), ay = new Float64Array(nSeg), az = new Float64Array(nSeg);
    const bx = new Float64Array(nSeg), by = new Float64Array(nSeg), bz = new Float64Array(nSeg);
    const mx = new Float64Array(nSeg), my = new Float64Array(nSeg), mz = new Float64Array(nSeg);
    const cat = new Uint8Array(nSeg), ofString = new Uint32Array(nSeg);
    let w = 0;
    scene.strings.forEach((s, si) => {
      const p = s.pts, code = catOf(s.layer);
      for (let i = 0; i + 5 < p.length; i += 3) {
        ax[w] = p[i]; ay[w] = p[i + 1]; az[w] = p[i + 2];
        bx[w] = p[i + 3]; by[w] = p[i + 4]; bz[w] = p[i + 5];
        mx[w] = (ax[w] + bx[w]) / 2; my[w] = (ay[w] + by[w]) / 2; mz[w] = (az[w] + bz[w]) / 2;
        cat[w] = code; ofString[w] = si;
        w++;
      }
    });
    const header = {
      ...common, kind: 'strings', count: nSeg,
      columns: ['LAYER', 'STRING'], mapping: { chan: null, cat: 0 },
      categories: categories ? [...categories] : null,
      numericColumns: [], chanRange: [0, 0],
      strings: scene.strings.length,
    };
    async function* streamChunks({ chunkPoints = 1 << 16 } = {}) {
      for (let at = 0; at < nSeg; at += chunkPoints) {
        const n = Math.min(chunkPoints, nSeg - at);
        const recIdx = new Uint32Array(n);
        for (let i = 0; i < n; i++) recIdx[i] = at + i;
        const sub = (a) => a.subarray(at, at + n);
        yield {
          count: n,
          ax: sub(ax), ay: sub(ay), az: sub(az), bx: sub(bx), by: sub(by), bz: sub(bz),
          x: sub(mx), y: sub(my), z: sub(mz),
          chan: new Float64Array(n), cat: sub(cat), recIdx,
        };
      }
    }
    return {
      header, streamChunks,
      fetchRecord: (rec) => [scene.strings[ofString[rec]].layer, ofString[rec]],
      recordPosition: (rec) => [mx[rec], my[rec], mz[rec]],
    };
  }

  // points: blockmodel-shaped with grid:null — the caller's points fallback
  const n = scene.points.length;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const pcat = new Uint8Array(n);
  scene.points.forEach((p, i) => { px[i] = p.x; py[i] = p.y; pz[i] = p.z; pcat[i] = catOf(p.layer); });
  const header = {
    ...common, kind: 'blockmodel', count: n, grid: null,
    columns: ['X', 'Y', 'Z', 'LAYER'], mapping: { x: 0, y: 1, z: 2, chan: null, cat: 3 },
    categories: categories ? [...categories] : null, numericColumns: [],
  };
  async function* streamChunks({ chunkPoints = 1 << 16 } = {}) {
    for (let at = 0; at < n; at += chunkPoints) {
      const k = Math.min(chunkPoints, n - at);
      const recIdx = new Uint32Array(k);
      for (let i = 0; i < k; i++) recIdx[i] = at + i;
      yield {
        count: k,
        x: px.subarray(at, at + k), y: py.subarray(at, at + k), z: pz.subarray(at, at + k),
        chan: new Float64Array(k), cat: pcat.subarray(at, at + k), recIdx, recStart: at,
      };
    }
  }
  return {
    header, streamChunks,
    fetchRecord: (rec) => [px[rec], py[rec], pz[rec], scene.points[rec].layer],
  };
}
