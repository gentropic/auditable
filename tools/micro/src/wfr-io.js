// micro × .wfr — reading wireframe files into the shapes micro already consumes.
//
// A .wfr element is one of three kinds, and each maps onto an existing micro layer:
//   triangles ≤ the context cap → the resident mesh contract { header, vertices, triangles, attrs }
//                                  (indexed by vid, so it is exactly the welded original mesh)
//   triangles above it          → a soup provider { header, streamChunks } streaming brick by brick
//   lines                       → stick RawChunks (+ a small resident record table, like streamed DXF)
//   points                      → point batches  (+ the same)
// Opening reads only the zip directory, the manifest and the Parquet footers; bricks are decoded
// as they are consumed. Nothing here touches the DOM or the renderer.
import { openWfr, blobSource } from '../../../ext/wireframe/index.js';

export const isWfrName = (name) => /\.wfr$/i.test(name || '');

export async function openWfrBlob(blob) { return openWfr(blobSource(blob)); }

// stored → world for one element: grid (origin + step·q) or float64 (identity)
function worldOf(el) {
  const c = el.coords;
  if (c.mode !== 'grid') return (x, y, z, n, out) => { for (let i = 0; i < n; i++) { out[3 * i] = x[i]; out[3 * i + 1] = y[i]; out[3 * i + 2] = z[i]; } };
  const o = c.origin, s = Array.isArray(c.step) ? c.step : [c.step, c.step, c.step];
  return (x, y, z, n, out) => { for (let i = 0; i < n; i++) { out[3 * i] = o[0] + s[0] * x[i]; out[3 * i + 1] = o[1] + s[1] * y[i]; out[3 * i + 2] = o[2] + s[2] * z[i]; } };
}
const bboxOf = (el) => {
  const b = el.meta.bbox;
  return b ? { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] } : { min: [0, 0, 0], max: [1, 1, 1] };
};
// non-core columns of a table, with their Parquet types (from the first row group)
function attrColumns(el, table) {
  const t = el.tables[table];
  if (!t || !t.footer.rowGroups.length) return [];
  const core = new Set(['x', 'y', 'z', 'vid', 'a', 'b', 'c']);
  return t.footer.rowGroups[0].columns.filter((c) => !core.has(c.name)).map((c) => ({ name: c.name, type: c.type }));
}
const ARR = { INT32: Int32Array, FLOAT: Float32Array, DOUBLE: Float64Array };
export const summarizeElements = (wfr) => wfr.elements.map((el) => ({ name: el.name, kind: el.kind, cells: el.meta.counts.cells, vertices: el.meta.counts.vertices, bricks: el.bricks, topology: el.meta.topology || null }));

// ── triangles: resident ────────────────────────────────────────────────────────
// → the condenser mesh contract. Vertices land at their vid, faces become vid triples: the brick
// duplication is undone and the mesh is the welded original. Numeric vertex attributes become
// header.vertexColumns + attrs (the `vertices` location's columns).
export async function wfrResidentMesh(el, { onProgress } = {}) {
  const V = el.meta.counts.vertices, F = el.meta.counts.cells;
  const vertices = new Float64Array(3 * V), triangles = new Uint32Array(3 * F);
  const vcols = attrColumns(el, 'vertices').filter((c) => ARR[c.type]);
  const attrs = Object.fromEntries(vcols.map((c) => [c.name, new ARR[c.type](V)]));
  const toWorld = worldOf(el);
  let t = 0, tmp = new Float64Array(0);
  for (let k = 0; k < el.bricks; k++) {
    const b = await el.readBrick(k, { vid: true });
    const n = b.x.length;
    if (tmp.length < 3 * n) tmp = new Float64Array(3 * n);
    toWorld(b.x, b.y, b.z, n, tmp);
    for (let i = 0; i < n; i++) { const v = 3 * b.vid[i]; vertices[v] = tmp[3 * i]; vertices[v + 1] = tmp[3 * i + 1]; vertices[v + 2] = tmp[3 * i + 2]; }
    if (vcols.length) {
      const a = await el.readRowGroup('vertices', k, vcols.map((c) => c.name));
      for (const c of vcols) { const src = a[c.name], dst = attrs[c.name]; for (let i = 0; i < n; i++) dst[b.vid[i]] = src[i]; }
    }
    const cells = b.cells;
    for (let i = 0; i < cells.length; i++) triangles[t++] = b.vid[cells[i]];
    if (onProgress) onProgress(k + 1, el.bricks);
  }
  const header = {
    kind: 'mesh', format: 'wfr', element: el.name, vertexCount: V, triCount: F, bbox: bboxOf(el),
    vertexColumns: vcols.map((c) => c.name), topology: el.meta.topology || null,
  };
  return { header, vertices, triangles, attrs };
}

// ── triangles: streamed soup ───────────────────────────────────────────────────
// RawChunks { count, ax..cz, x, y, z } in world f64, one brick at a time (bricks are ≤ 64k faces).
export function wfrSoupDoc(el) {
  const header = { kind: 'mesh', format: 'wfr', element: el.name, soup: true, vertexCount: el.meta.counts.vertices, triCount: el.meta.counts.cells, bbox: bboxOf(el), vertexColumns: [], topology: el.meta.topology || null };
  async function* streamChunks({ onProgress } = {}) {
    const toWorld = worldOf(el);
    for (let k = 0; k < el.bricks; k++) {
      const b = await el.readBrick(k);
      const n = b.x.length, w = new Float64Array(3 * n);
      toWorld(b.x, b.y, b.z, n, w);
      const m = b.cells.length / 3, r = { count: m };
      for (const c of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z']) r[c] = new Float64Array(m);
      for (let f = 0; f < m; f++) {
        const A = 3 * b.cells[3 * f], B = 3 * b.cells[3 * f + 1], C = 3 * b.cells[3 * f + 2];
        r.ax[f] = w[A]; r.ay[f] = w[A + 1]; r.az[f] = w[A + 2];
        r.bx[f] = w[B]; r.by[f] = w[B + 1]; r.bz[f] = w[B + 2];
        r.cx[f] = w[C]; r.cy[f] = w[C + 1]; r.cz[f] = w[C + 2];
        r.x[f] = (w[A] + w[B] + w[C]) / 3; r.y[f] = (w[A + 1] + w[B + 1] + w[C + 1]) / 3; r.z[f] = (w[A + 2] + w[B + 2] + w[C + 2]) / 3;
      }
      if (onProgress) onProgress(k + 1, el.bricks);
      yield r;
    }
  }
  return { header, streamChunks };
}

// category table from a string attribute (≤ 255 values fit the category byte; past that, none)
function catTable() {
  const t = { names: [], colors: [], index: new Map(), overflow: false };
  t.of = (name, rgb) => {
    let i = t.index.get(name);
    if (i === undefined) {
      if (t.names.length >= 255) { t.overflow = true; return 0; }
      i = t.names.length; t.index.set(name, i); t.names.push(name); t.colors.push(rgb);
    } else if (!t.colors[i] && rgb) t.colors[i] = rgb;
    return i;
  };
  return t;
}
function growable(Type) {
  let a = new Type(1 << 16), n = 0;
  return { push(v) { if (n === a.length) { const b = new Type(a.length * 2); b.set(a); a = b; } a[n++] = v; }, at: (i) => a[i], get length() { return n; } };
}

// ── lines → a strings (sticks) layer ───────────────────────────────────────────
// Same contract as condenser's resident DXF strings: header { kind:'strings', columns, mapping,
// categories, catColors, count }, streamChunks → stick RawChunks, fetchRecord / recordPosition.
// The category comes from a `layer` cell attribute when there is one; STRING from `string`.
export function wfrStringsDoc(el) {
  const ca = new Set(attrColumns(el, 'cells').map((c) => c.name));
  const hasLayer = ca.has('layer'), hasString = ca.has('string'), hasRGB = ca.has('color.r') && ca.has('color.g') && ca.has('color.b');
  const cats = catTable(), bb = bboxOf(el), o = bb.min;
  const seg = { cat: growable(Uint8Array), str: growable(Int32Array), mx: growable(Float32Array), my: growable(Float32Array), mz: growable(Float32Array) };
  const header = { kind: 'strings', format: 'wfr', element: el.name, count: el.meta.counts.cells, strings: 0, columns: ['LAYER', 'STRING'], mapping: { chan: null, cat: hasLayer ? 0 : null }, categories: null, catColors: null, numericColumns: [], chanRange: [0, 0], bbox: bb };
  async function* streamChunks() {
    const toWorld = worldOf(el), ids = new Set();
    for (let k = 0; k < el.bricks; k++) {
      const b = await el.readBrick(k);
      const n = b.x.length, w = new Float64Array(3 * n);
      toWorld(b.x, b.y, b.z, n, w);
      const names = [hasLayer && 'layer', hasString && 'string', ...(hasRGB ? ['color.r', 'color.g', 'color.b'] : [])].filter(Boolean);
      const a = names.length ? await el.readRowGroup('cells', k, names) : {};
      const m = b.cells.length / 2, r = { count: m, cat: new Uint8Array(m), recIdx: new Uint32Array(m), chan: new Float64Array(m) };
      for (const c of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'x', 'y', 'z']) r[c] = new Float64Array(m);
      for (let s = 0; s < m; s++) {
        const A = 3 * b.cells[2 * s], B = 3 * b.cells[2 * s + 1];
        r.ax[s] = w[A]; r.ay[s] = w[A + 1]; r.az[s] = w[A + 2]; r.bx[s] = w[B]; r.by[s] = w[B + 1]; r.bz[s] = w[B + 2];
        const mx = (w[A] + w[B]) / 2, my = (w[A + 1] + w[B + 1]) / 2, mz = (w[A + 2] + w[B + 2]) / 2;
        r.x[s] = mx; r.y[s] = my; r.z[s] = mz;
        const code = hasLayer ? cats.of(a.layer[s], hasRGB ? [a['color.r'][s], a['color.g'][s], a['color.b'][s]] : null) : 0;
        const sid = hasString ? a.string[s] : -1;
        if (hasString) ids.add(sid);
        r.cat[s] = code; r.recIdx[s] = seg.cat.length;
        seg.cat.push(code); seg.str.push(sid); seg.mx.push(mx - o[0]); seg.my.push(my - o[1]); seg.mz.push(mz - o[2]);
      }
      yield r;
    }
    header.strings = ids.size;
    header.categories = hasLayer && !cats.overflow && cats.names.length ? cats.names.slice() : null;
    header.catColors = header.categories ? cats.colors.slice() : null;
  }
  return {
    header, streamChunks,
    fetchRecord: (rec) => [hasLayer ? cats.names[seg.cat.at(rec)] : '', seg.str.at(rec)],
    recordPosition: (rec) => [o[0] + seg.mx.at(rec), o[1] + seg.my.at(rec), o[2] + seg.mz.at(rec)],
  };
}

// ── points → a points layer ────────────────────────────────────────────────────
// The DXF-pegs contract: a blockmodel-shaped header (grid null, X/Y/Z/LAYER), point batches with
// cat + recIdx, fetchRecord → [x, y, z, layer].
export function wfrPointsDoc(el) {
  const va = new Set(attrColumns(el, 'vertices').map((c) => c.name));
  const hasLayer = va.has('layer'), hasRGB = va.has('color.r') && va.has('color.g') && va.has('color.b');
  const cats = catTable(), bb = bboxOf(el);
  const pt = { x: growable(Float64Array), y: growable(Float64Array), z: growable(Float64Array), cat: growable(Uint8Array) };
  const header = { kind: 'blockmodel', format: 'wfr', element: el.name, count: el.meta.counts.vertexRows, grid: null, columns: ['X', 'Y', 'Z', 'LAYER'], mapping: { x: 0, y: 1, z: 2, chan: null, cat: hasLayer ? 3 : null }, categories: null, catColors: null, numericColumns: [], bbox: bb };
  async function* streamChunks() {
    const toWorld = worldOf(el);
    for (let k = 0; k < el.bricks; k++) {
      const names = ['x', 'y', 'z', ...(hasLayer ? ['layer'] : []), ...(hasRGB ? ['color.r', 'color.g', 'color.b'] : [])];
      const a = await el.readRowGroup('vertices', k, names);
      const n = a.x.length, w = new Float64Array(3 * n);
      toWorld(a.x, a.y, a.z, n, w);
      const r = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), cat: new Uint8Array(n), recIdx: new Uint32Array(n), recStart: pt.x.length };
      for (let i = 0; i < n; i++) {
        r.x[i] = w[3 * i]; r.y[i] = w[3 * i + 1]; r.z[i] = w[3 * i + 2];
        const code = hasLayer ? cats.of(a.layer[i], hasRGB ? [a['color.r'][i], a['color.g'][i], a['color.b'][i]] : null) : 0;
        r.cat[i] = code; r.recIdx[i] = pt.x.length;
        pt.x.push(r.x[i]); pt.y.push(r.y[i]); pt.z.push(r.z[i]); pt.cat.push(code);
      }
      yield r;
    }
    header.categories = hasLayer && !cats.overflow && cats.names.length ? cats.names.slice() : null;
    header.catColors = header.categories ? cats.colors.slice() : null;
  }
  return { header, streamChunks, fetchRecord: (rec) => [pt.x.at(rec), pt.y.at(rec), pt.z.at(rec), hasLayer ? cats.names[pt.cat.at(rec)] : ''] };
}

// Re-read one element as the resident mesh (reReadMesh / solid queries / export).
export async function rereadWfrMesh(blob, elementName) {
  const wfr = await openWfrBlob(blob);
  const el = elementName != null ? wfr.element(elementName) : wfr.elements.find((e) => e.kind === 'triangles');
  if (!el || el.kind !== 'triangles') throw new Error(`wfr: no triangles element "${elementName}"`);
  return wfrResidentMesh(el);
}

// Per-vertex colour for the GPU (Float32 rgb 0–1) from color.r/g/b or PLY red/green/blue attrs.
export function vertexColorOf(attrs, n) {
  if (!attrs) return null;
  const pick = (a, b) => attrs[a] || attrs[b];
  const r = pick('color.r', 'red'), g = pick('color.g', 'green'), b = pick('color.b', 'blue');
  if (!r || !g || !b || r.length < n) return null;
  // integer channels are 0–255; float channels are 0–1 unless their values say otherwise
  let s = 1 / 255;
  if (r instanceof Float32Array || r instanceof Float64Array) {
    let mx = 0;
    for (let i = 0; i < Math.min(n, 4096); i++) mx = Math.max(mx, r[i], g[i], b[i]);
    if (mx <= 1) s = 1;
  }
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { out[3 * i] = r[i] * s; out[3 * i + 1] = g[i] * s; out[3 * i + 2] = b[i] * s; }
  return out;
}
