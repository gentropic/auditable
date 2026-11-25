// @gcu/gtiff — a minimal, WASM-free GeoTIFF WRITER: one band, float32, classic
// little-endian TIFF, strips or square tiles, compression none or deflate (the
// platform's CompressionStream — no bundled zlib, no WASM, so Sealed tools keep
// their claim), predictor 3 optional. Geo tags: ModelPixelScale + ModelTiepoint
// always (PixelIsArea, the tiepoint at the north-west CORNER), GDAL_NODATA when a
// nodata value is given, and a GeoKeyDirectory ONLY for a known EPSG code — a
// CRS is never invented (@gcu/frame's rule: identity, never a guess).
//
// Grid in = the reader's convention: { nx, ny, data, x0, y0, dx, dy } — row 0 is
// the NORTH row, x0/y0 the centre of sample (0,0), dy positive.

const LE = true;

// EPSG code → GeoTIFF model type. The EPSG registry puts geographic 2D/3D CRSs in
// 4000–4999 (4326 WGS 84, 4674 SIRGAS 2000, 4269 NAD83, 4979…); projected ones
// live elsewhere (UTM 326xx/327xx, SIRGAS UTM 319xx, 2000–3999, 5000+). The few
// projected codes inside 4000–4999 (4087, 4088 — equidistant cylindrical) are
// listed. No database is carried: this is the identity the code states.
const PROJECTED_4XXX = new Set([4087, 4088]);
export function epsgModelType(code) {
  if (!(code > 0 && code < 32767)) return null;
  return code >= 4000 && code < 5000 && !PROJECTED_4XXX.has(code) ? 'geographic' : 'projected';
}

const parseEpsg = (crs) => {
  if (crs == null) return null;
  const m = /^\s*EPSG\s*:\s*(\d+)\s*$/i.exec(String(crs));
  if (!m) return null;
  const code = +m[1];
  return code > 0 && code < 32767 ? code : null;
};

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('gtiff: deflate needs CompressionStream (not available here) — write uncompressed');
  const cs = new CompressionStream('deflate');            // zlib-wrapped = TIFF compression 8
  const out = new Response(cs.readable).arrayBuffer();
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await out);
}

// predictor 3, encode side (the mirror of codec.js undoPredictor3): byte-plane
// shuffle each row (plane b = byte b of every sample, big-endian significance),
// then horizontal byte differencing across the row
function applyPredictor3(bytes, rowWidth, rows) {
  const B = 4, w = rowWidth, rowBytes = w * B;
  const tmp = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const off = r * rowBytes;
    for (let i = 0; i < w; i++) for (let b = 0; b < B; b++) tmp[b * w + i] = bytes[off + i * B + (B - 1 - b)];   // LE sample → BE planes
    for (let i = rowBytes - 1; i > 0; i--) tmp[i] = (tmp[i] - tmp[i - 1]) & 0xff;
    bytes.set(tmp, off);
  }
}

/**
 * writeGeoTiff(grid, opts) → Promise<Uint8Array>
 *   opts.compression  'none' | 'deflate'          (default 'deflate')
 *   opts.predictor    1 | 3                        (default 3 with deflate; ignored uncompressed)
 *   opts.layout       'strips' | 'tiles'           (default 'strips')
 *   opts.tileSize     tile edge, a multiple of 16  (default 256)
 *   opts.nodata       number (NaN allowed) | null  — written as GDAL_NODATA; cells that
 *                     are NaN or equal to grid.nodata (or ≥1.7014e38 for a Surfer blank)
 *                     become this value
 *   opts.crs          'EPSG:n' — GeoKeys only for a known EPSG code; anything else → none
 *   opts.description  ImageDescription text (e.g. provenance JSON)
 *   opts.software     Software tag
 *   opts.transform    [a, b, c, d, e, f] — a ROTATED raster's affine over pixel corners
 *                     (X = a·i + b·j + c, Y = d·i + e·j + f): written as ModelTransformation
 *                     (34264) in place of ModelPixelScale + ModelTiepoint
 * The result's `.info` = { crs, geoKeys, compression, layout, segments }.
 */
export async function writeGeoTiff(grid, opts = {}) {
  const { nx, ny, data, x0, y0, dx, dy } = grid;
  if (!(nx > 0 && ny > 0) || !data || data.length < nx * ny) throw new Error('gtiff write: grid needs nx, ny and nx·ny values');
  const compression = opts.compression === 'none' ? 'none' : 'deflate';
  const predictor = compression === 'deflate' ? (opts.predictor === 1 ? 1 : 3) : 1;
  const tiled = opts.layout === 'tiles';
  const tile = tiled ? Math.max(16, Math.round((opts.tileSize || 256) / 16) * 16) : 0;
  const outNd = opts.nodata === undefined ? (grid.nodata ?? null) : opts.nodata;
  const srcNd = grid.nodata;
  const isBad = (v) => Number.isNaN(v) || (srcNd != null && (srcNd >= 1.7e38 ? v >= 1.7014e38 : v === srcNd));
  const fill = outNd == null ? NaN : outNd;

  // ── the segments: strips of ~256 KB of raw samples, or tile×tile tiles ──
  const segs = [];                                          // { x0, y0, w, h } in pixels
  let rowsPerStrip = 0;
  if (tiled) {
    for (let ty = 0; ty < ny; ty += tile) for (let tx = 0; tx < nx; tx += tile) segs.push({ x0: tx, y0: ty, w: tile, h: tile });
  } else {
    rowsPerStrip = Math.max(1, Math.min(ny, Math.floor((256 << 10) / (nx * 4))));
    for (let y = 0; y < ny; y += rowsPerStrip) segs.push({ x0: 0, y0: y, w: nx, h: Math.min(rowsPerStrip, ny - y) });
  }
  const encoded = [];
  for (const s of segs) {
    const raw = new Uint8Array(s.w * s.h * 4);
    const dv = new DataView(raw.buffer);
    for (let r = 0; r < s.h; r++) {
      const gr = s.y0 + r;
      for (let c = 0; c < s.w; c++) {
        const gc = s.x0 + c;
        let v = 0;                                          // tile padding past the edge: zeros (TIFF leaves it undefined)
        if (gr < ny && gc < nx) { v = data[gr * nx + gc]; if (isBad(v)) v = fill; }
        dv.setFloat32((r * s.w + c) * 4, v, LE);
      }
    }
    if (predictor === 3) applyPredictor3(raw, s.w, s.h);
    encoded.push(compression === 'deflate' ? await deflate(raw) : raw);
  }

  // ── tags ──
  const epsg = parseEpsg(opts.crs);
  const model = epsg ? epsgModelType(epsg) : null;
  const tags = [];                                          // [tag, type, values]  type: 2 ascii · 3 short · 4 long · 12 double
  const T = (tag, type, values) => tags.push([tag, type, values]);
  T(256, 4, [nx]); T(257, 4, [ny]);
  T(258, 3, [32]);
  T(259, 3, [compression === 'deflate' ? 8 : 1]);
  T(262, 3, [1]);                                           // BlackIsZero
  if (opts.description) T(270, 2, String(opts.description));
  if (!tiled) T(273, 4, segs.map(() => 0));                 // StripOffsets — patched below
  T(277, 3, [1]);
  if (!tiled) { T(278, 4, [rowsPerStrip]); T(279, 4, encoded.map((e) => e.length)); }
  T(284, 3, [1]);
  if (opts.software) T(305, 2, String(opts.software));
  if (predictor === 3) T(317, 3, [3]);
  if (tiled) { T(322, 3, [tile]); T(323, 3, [tile]); T(324, 4, segs.map(() => 0)); T(325, 4, encoded.map((e) => e.length)); }
  T(339, 3, [3]);                                           // IEEE float
  const xf = Array.isArray(opts.transform) && opts.transform.length === 6 && opts.transform.every(Number.isFinite) ? opts.transform : null;
  if (xf) {
    const [a, b, c, d, e, f] = xf;
    T(34264, 12, [a, b, 0, c, d, e, 0, f, 0, 0, 0, 0, 0, 0, 0, 1]);
  } else if (x0 != null && y0 != null && dx && dy) {
    T(33550, 12, [dx, dy, 0]);
    T(33922, 12, [0, 0, 0, x0 - dx / 2, y0 + dy / 2, 0]);   // PixelIsArea: raster (0,0) = the NW corner
  }
  if (epsg) {
    // KeyDirectory header [version 1, revision 1.0, nkeys], then keys [id, location 0, count 1, value]
    const keys = [[1024, model === 'geographic' ? 2 : 1], [1025, 1], [model === 'geographic' ? 2048 : 3072, epsg]];
    T(34735, 3, [1, 1, 0, keys.length, ...keys.flatMap(([id, v]) => [id, 0, 1, v])]);
  }
  if (outNd != null) T(42113, 2, Number.isNaN(outNd) ? 'nan' : String(outNd));
  tags.sort((a, b) => a[0] - b[0]);

  // ── layout: header · IFD · out-of-line values · segment data ──
  const SZ = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const valBytes = (type, values) => (type === 2 ? values.length + 1 : values.length * SZ[type]);
  const ifdOff = 8, ifdLen = 2 + tags.length * 12 + 4;
  let at = ifdOff + ifdLen;
  const extOff = new Map();
  for (const t of tags) {
    const n = valBytes(t[1], t[2]);
    if (n > 4) { if (at & 1) at++; extOff.set(t, at); at += n; }
  }
  if (at & 1) at++;
  const segOffs = [];
  for (const e of encoded) { segOffs.push(at); at += e.length; }
  if (at > 0xFFFFFFFF) throw new Error('gtiff write: over 4 GB — classic TIFF cannot hold it (BigTIFF not written yet)');
  const offTag = tags.find((t) => t[0] === (tiled ? 324 : 273));
  offTag[2] = segOffs;

  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; v.setUint16(2, 42, LE); v.setUint32(4, ifdOff, LE);
  v.setUint16(ifdOff, tags.length, LE);
  const putVals = (p, type, values) => {
    if (type === 2) { for (let i = 0; i < values.length; i++) out[p + i] = values.charCodeAt(i) & 0xff; out[p + values.length] = 0; return; }
    values.forEach((x, i) => {
      if (type === 3) v.setUint16(p + i * 2, x, LE);
      else if (type === 4) v.setUint32(p + i * 4, x, LE);
      else v.setFloat64(p + i * 8, x, LE);
    });
  };
  tags.forEach((t, i) => {
    const e = ifdOff + 2 + i * 12, [tag, type, values] = t;
    const count = type === 2 ? values.length + 1 : values.length;
    v.setUint16(e, tag, LE); v.setUint16(e + 2, type, LE); v.setUint32(e + 4, count, LE);
    if (extOff.has(t)) { v.setUint32(e + 8, extOff.get(t), LE); putVals(extOff.get(t), type, values); }
    else putVals(e + 8, type, values);
  });
  v.setUint32(ifdOff + 2 + tags.length * 12, 0, LE);       // one IFD
  encoded.forEach((e, i) => out.set(e, segOffs[i]));
  out.info = { crs: epsg ? `EPSG:${epsg}` : null, geoKeys: !!epsg, model, compression, predictor, layout: tiled ? 'tiles' : 'strips', segments: segs.length };
  return out;
}
