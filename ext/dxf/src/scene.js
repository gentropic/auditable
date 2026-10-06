// scene — extract VIEWER-shaped geometry from a Document: one merged mesh
// (3DFACE soup + polyface/polygon meshes), strings (polylines with bulges
// sampled to chords, lines, arcs, circles), and points — each tagged with its
// DXF layer. This is the bridge a 3D viewer (micro's condenser engine) builds
// layers from; the Document itself stays the canonical, lossless model.
import { explode } from './explode.js';
import { arcFromBulge, TAU } from './arc.js';
import { colorToRgb } from './color.js';

// sample one bulge span into chord points (excluding p0, including p1):
// ~24 chords for a full circle, never fewer than 2 for a visible arc
function sampleSpan(p0, p1, bulge, z0, z1, out) {
  const arc = arcFromBulge(p0, p1, bulge);
  if (!arc) { out.push(p1[0], p1[1], z1); return; }
  const n = Math.max(2, Math.ceil((Math.abs(arc.sweep) / TAU) * 24));
  const a0 = arc.startAngle;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const a = a0 + arc.sweep * t;
    out.push(arc.center[0] + arc.radius * Math.cos(a), arc.center[1] + arc.radius * Math.sin(a), z0 + (z1 - z0) * t);
  }
}

// → { mesh: {vertices,triangles}|null, strings: [{layer,pts:Float64Array}],
//     points: [{layer,x,y,z}], layers: [names], counts, bbox: [min3,max3]|null }
export function extractScene(doc) {
  const flat = doc.exploded ? doc : explode(doc);
  const mv = [], mt = [];
  const strings = [], points = [];
  const layerSet = new Set();
  const layerColors = {};                                  // layer name → [r,g,b] | null (first resolved wins)
  let meshColor;                                           // uniform across every face → the mesh tint; mixed → null

  for (const f of flat.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const layer = (f.properties && f.properties.layer) || '0';
    const rgb = colorToRgb(f.properties && f.properties.color, layer, doc.layers);
    if (!(layer in layerColors) || (layerColors[layer] == null && rgb)) layerColors[layer] = rgb;

    const foldMeshColor = () => {
      if (meshColor === undefined) meshColor = rgb;
      else if (meshColor && (!rgb || meshColor[0] !== rgb[0] || meshColor[1] !== rgb[1] || meshColor[2] !== rgb[2])) meshColor = null;
    };
    if (g.kind === 'mesh') {
      const base = mv.length / 3;
      for (let i = 0; i < g.vertices.length; i++) mv.push(g.vertices[i]);
      for (let i = 0; i < g.triangles.length; i++) mt.push(base + g.triangles[i]);
      layerSet.add(layer);
      foldMeshColor();
    } else if (g.kind === 'face') {
      const v = g.vertices;
      const base = mv.length / 3;
      for (let i = 0; i < v.length; i++) mv.push(v[i]);
      const nV = v.length / 3;
      if (nV >= 3) mt.push(base, base + 1, base + 2);
      if (nV === 4) mt.push(base, base + 2, base + 3);
      layerSet.add(layer);
      foldMeshColor();
    } else if (g.kind === 'polyline') {
      const v = g.vertices;
      const nV = v.length / 3;
      if (nV < 2) continue;
      const pts = [v[0], v[1], v[2]];
      const spans = g.closed ? nV : nV - 1;
      for (let i = 0; i < spans; i++) {
        const a = i, b = (i + 1) % nV;
        const bulge = g.bulges ? g.bulges[a] || 0 : 0;
        sampleSpan([v[a * 3], v[a * 3 + 1]], [v[b * 3], v[b * 3 + 1]], bulge, v[a * 3 + 2], v[b * 3 + 2], pts);
      }
      strings.push({ layer, color: rgb, pts: Float64Array.from(pts) });
      layerSet.add(layer);
    } else if (g.kind === 'circle') {
      const n = 32, pts = [];
      const z = g.center[2] || 0;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * TAU;
        pts.push(g.center[0] + g.radius * Math.cos(a), g.center[1] + g.radius * Math.sin(a), z);
      }
      strings.push({ layer, color: rgb, pts: Float64Array.from(pts) });
      layerSet.add(layer);
    } else if (g.kind === 'point') {
      points.push({ layer, color: rgb, x: g.position[0], y: g.position[1], z: g.position[2] || 0 });
      layerSet.add(layer);
    }
    // text / attdef / hatch metadata: not scene geometry
  }

  // the shared bbox over everything extracted
  let bbox = null;
  const grow = (x, y, z) => {
    if (!bbox) bbox = [x, y, z, x, y, z];
    else {
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y; if (z < bbox[2]) bbox[2] = z;
      if (x > bbox[3]) bbox[3] = x; if (y > bbox[4]) bbox[4] = y; if (z > bbox[5]) bbox[5] = z;
    }
  };
  for (let i = 0; i < mv.length; i += 3) grow(mv[i], mv[i + 1], mv[i + 2]);
  for (const s of strings) for (let i = 0; i < s.pts.length; i += 3) grow(s.pts[i], s.pts[i + 1], s.pts[i + 2]);
  for (const p of points) grow(p.x, p.y, p.z);

  return {
    mesh: mt.length ? { vertices: Float64Array.from(mv), triangles: Uint32Array.from(mt), color: meshColor || null } : null,
    strings, points,
    layers: [...layerSet].sort(),
    layerColors,
    counts: { triangles: mt.length / 3, strings: strings.length, points: points.length },
    bbox,
  };
}
