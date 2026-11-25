// micro LAS CRS — a point cloud's coordinate system (the LAS "LASF_Projection" VLRs: OGC WKT, or
// GeoTIFF GeoKeys) and its reprojection into the project's CRS on read.
//
//   await lasCrsOf(header) → a @gcu/proj CRS | null
//   reprojectLas(provider, from, to) → the same provider shape (header, streamChunks, columnBatches,
//     fetchRecord) whose X / Y come out in `to`: every chunk, every column batch and every record
//     read is transformed on the way (horizontal only — Z untouched), and header.bbox is the
//     transformed extent. The provider's own bytes are never touched: a re-read reprojects again.
import { crsFromPrj, crsFromGeoKeys, transformer, whereOf, describePath, crsLabel, crsToJSON } from '../../../ext/proj/index.js';

export async function lasCrsOf(header) {
  const c = header && header.crs;
  if (!c) return null;
  if (c.wkt) { try { const r = await crsFromPrj(c.wkt); if (r) return r; } catch { /* fall through */ } }
  if (c.geoKeys) return crsFromGeoKeys(c.geoKeys);
  return null;
}

export function reprojectLas(prov, from, to) {
  const h = prov.header, b = h.bbox;
  const at = whereOf(from, [[(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]]);
  const t = transformer(from, to, { at });
  // the extent: sampled along the box's edges (a projection bends straight edges)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    if (i && i < 8 && j && j < 8) continue;
    const q = t.forward([b.min[0] + (b.max[0] - b.min[0]) * i / 8, b.min[1] + (b.max[1] - b.min[1]) * j / 8]);
    if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
  }
  const path = describePath(from, to, { at });
  const header = { ...h, bbox: { min: [x0, y0, b.min[2]], max: [x1, y1, b.max[2]] },
    reprojected: { from: crsLabel(from), to: crsLabel(to), fromCrs: crsToJSON(from), toCrs: crsToJSON(to), by: 'LAS coordinate-system VLR', path: path.text, accuracy: path.accuracy, heights: 'unchanged (horizontal reprojection)', at } };
  const xi = (h.columns || []).indexOf('X'), yi = (h.columns || []).indexOf('Y');
  async function* streamChunks(opts) {
    for await (const c of prov.streamChunks(opts)) {
      for (let i = 0; i < c.count; i++) { const q = t.forward([c.x[i], c.y[i]]); c.x[i] = q[0]; c.y[i] = q[1]; }
      yield c;
    }
  }
  async function* columnBatches(names, opts) {
    const lx = names.findIndex((n) => String(n).toUpperCase() === 'X'), ly = names.findIndex((n) => String(n).toUpperCase() === 'Y');
    if (lx < 0 && ly < 0) { yield* prov.columnBatches(names, opts); return; }
    const ask = names.slice();
    if (lx < 0) ask.push('X'); if (ly < 0) ask.push('Y');
    const kx = lx < 0 ? ask.length - (ly < 0 ? 2 : 1) : lx, ky = ly < 0 ? ask.length - 1 : ly;
    for await (const bt of prov.columnBatches(ask, opts)) {
      const X = bt.cols[ask[kx]], Y = bt.cols[ask[ky]];
      for (let i = 0; i < bt.n; i++) { const q = t.forward([X[i], Y[i]]); X[i] = q[0]; Y[i] = q[1]; }
      const cols = {}; for (const n of names) cols[n] = bt.cols[n];
      yield { ...bt, cols };
    }
  }
  async function fetchRecord(rec) {
    const row = await prov.fetchRecord(rec);
    if (row && xi >= 0 && yi >= 0) { const q = t.forward([row[xi], row[yi]]); row[xi] = +q[0].toFixed(4); row[yi] = +q[1].toFixed(4); }
    return row;
  }
  return { ...prov, header, streamChunks, columnBatches, fetchRecord };
}
