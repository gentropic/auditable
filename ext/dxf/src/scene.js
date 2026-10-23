// scene — extract VIEWER-shaped geometry from a Document: one merged mesh
// (3DFACE soup + polyface/polygon meshes), strings (polylines with bulges
// sampled to chords, lines, arcs, circles), and points — each tagged with its
// DXF layer. This is the bridge a 3D viewer (micro's condenser engine) builds
// layers from; the Document itself stays the canonical, lossless model.
//
// The per-feature walk (emitSceneFeature) is shared with the STREAMING reader
// (stream.js), so a file read whole and the same file streamed produce the same
// strings, chords and colours — one geometry rule, two transports.
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

// a bulge-polyline geometry → its chord points (bulges sampled), or null (< 2 vertices)
export function polylineChords(g) {
  const v = g.vertices;
  const nV = v.length / 3;
  if (nV < 2) return null;
  if (!g.bulges && !g.closed) return Float64Array.from(v);   // straight & open: the vertices ARE the chords
  const pts = [v[0], v[1], v[2]];
  const spans = g.closed ? nV : nV - 1;
  for (let i = 0; i < spans; i++) {
    const a = i, b = (i + 1) % nV;
    const bulge = g.bulges ? g.bulges[a] || 0 : 0;
    sampleSpan([v[a * 3], v[a * 3 + 1]], [v[b * 3], v[b * 3 + 1]], bulge, v[a * 3 + 2], v[b * 3 + 2], pts);
  }
  return Float64Array.from(pts);
}

const TRI = Uint32Array.of(0, 1, 2), QUAD = Uint32Array.of(0, 1, 2, 0, 2, 3);

/**
 * Route one exploded feature into a scene sink:
 *   sink.mesh(layer, rgb, vertices, triangles)   — optional; absent → per-triangle
 *   sink.tri(layer, rgb, ax, ay, az, bx, by, bz, cx, cy, cz)
 *   sink.string(layer, rgb, pts)                  — chord points, Float64Array
 *   sink.point(layer, rgb, x, y, z)
 * Text / attdef / hatch metadata are not scene geometry → ignored.
 */
export function emitSceneFeature(f, layers, sink) {
  const g = f.geometry;
  if (!g) return;
  const layer = (f.properties && f.properties.layer) || '0';
  const rgb = colorToRgb(f.properties && f.properties.color, layer, layers);
  if (g.kind === 'mesh') {
    if (sink.mesh) { sink.mesh(layer, rgb, g.vertices, g.triangles); return; }
    const v = g.vertices, t = g.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      sink.tri(layer, rgb, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
    }
  } else if (g.kind === 'face') {
    const v = g.vertices;
    const nV = v.length / 3;
    if (sink.mesh) {                                       // indexed: a quad shares its diagonal's vertices
      if (nV >= 3) sink.mesh(layer, rgb, v, nV === 4 ? QUAD : TRI);
      return;
    }
    if (nV >= 3) sink.tri(layer, rgb, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
    if (nV === 4) sink.tri(layer, rgb, v[0], v[1], v[2], v[6], v[7], v[8], v[9], v[10], v[11]);
  } else if (g.kind === 'polyline') {
    const pts = polylineChords(g);
    if (pts) sink.string(layer, rgb, pts);
  } else if (g.kind === 'circle') {
    const n = 32, pts = new Float64Array(3 * (n + 1));
    const z = g.center[2] || 0;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      pts[3 * k] = g.center[0] + g.radius * Math.cos(a); pts[3 * k + 1] = g.center[1] + g.radius * Math.sin(a); pts[3 * k + 2] = z;
    }
    sink.string(layer, rgb, pts);
  } else if (g.kind === 'point') {
    sink.point(layer, rgb, g.position[0], g.position[1], g.position[2] || 0);
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
  const foldLayerColor = (layer, rgb) => {
    if (!(layer in layerColors) || (layerColors[layer] == null && rgb)) layerColors[layer] = rgb;
  };
  const seen = (layer, rgb) => { layerSet.add(layer); foldLayerColor(layer, rgb); };
  const foldMeshColor = (rgb) => {
    if (meshColor === undefined) meshColor = rgb;
    else if (meshColor && (!rgb || meshColor[0] !== rgb[0] || meshColor[1] !== rgb[1] || meshColor[2] !== rgb[2])) meshColor = null;
  };
  const sink = {
    mesh(layer, rgb, vertices, triangles) {
      const base = mv.length / 3;
      for (let i = 0; i < vertices.length; i++) mv.push(vertices[i]);
      for (let i = 0; i < triangles.length; i++) mt.push(base + triangles[i]);
      seen(layer, rgb); foldMeshColor(rgb);
    },
    tri(layer, rgb, ax, ay, az, bx, by, bz, cx, cy, cz) {
      const base = mv.length / 3;
      mv.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      mt.push(base, base + 1, base + 2);
      seen(layer, rgb); foldMeshColor(rgb);
    },
    string(layer, rgb, pts) { strings.push({ layer, color: rgb, pts }); seen(layer, rgb); },
    point(layer, rgb, x, y, z) { points.push({ layer, color: rgb, x, y, z }); seen(layer, rgb); },
  };
  for (const f of flat.features || []) {
    // layer colours are folded for every geometry-bearing feature, as before
    if (f.geometry) {
      const layer = (f.properties && f.properties.layer) || '0';
      foldLayerColor(layer, colorToRgb(f.properties && f.properties.color, layer, doc.layers));
    }
    emitSceneFeature(f, doc.layers, sink);
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
