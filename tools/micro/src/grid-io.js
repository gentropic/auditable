// micro — grid serialization: Surfer 6 (DSBB/DSAA), Surfer 7 (DSRB) and ESRI ASCII
// read/write, plus the export-only writers (ESRI binary float .flt/.hdr, XYZ/CSV of nodes).
// Pure — takes/returns plain grid objects and blobs, no app state. The format
// dispatch (readAnyGrid) and the sniff (ascLooksLikeGrid) stay in the app: they
// reach the GeoTIFF reader and the display path. Grid convention throughout:
// { nx, ny, data, x0, y0, dx, dy, nodata, crs, form } — row 0 is the NORTH row,
// x0/y0 are SAMPLE CENTRES, dy positive (row r's centre = y0 − r·dy).

export const SURFER_BLANK = 1.70141e38;

export async function readSurferGrd(blob) {
  const tag = new TextDecoder('latin1').decode(await blob.slice(0, 4).arrayBuffer());
  if (tag === 'DSRB') {
    const h = parseSurfer7(new DataView(await blob.slice(0, Math.min(blob.size, 4096)).arrayBuffer()));
    const src = surferBinarySource(blob, h);
    return { nx: h.nx, ny: h.ny, data: await src.images[0].read(), x0: h.xlo, y0: h.yhi, dx: h.dx, dy: h.dy, nodata: h.nodata, crs: null, form: 'Surfer 7 binary' };
  }
  if (tag === 'DSBB') {
    const v = new DataView(await blob.arrayBuffer());
    const nx = v.getInt16(4, true), ny = v.getInt16(6, true);
    const xlo = v.getFloat64(8, true), xhi = v.getFloat64(16, true);
    const ylo = v.getFloat64(24, true), yhi = v.getFloat64(32, true);
    const data = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      // Surfer stores south-first — flip to north-first
      data[(ny - 1 - r) * nx + c] = v.getFloat32(56 + (r * nx + c) * 4, true);
    }
    return { nx, ny, data, x0: xlo, y0: yhi, dx: nx > 1 ? (xhi - xlo) / (nx - 1) : 1, dy: ny > 1 ? (yhi - ylo) / (ny - 1) : 1, nodata: SURFER_BLANK, crs: null, form: 'Surfer 6 binary' };
  }
  if (tag === 'DSAA') {
    const toks = (await blob.text()).trim().split(/\s+/);
    const nx = +toks[1], ny = +toks[2];
    const xlo = +toks[3], xhi = +toks[4], ylo = +toks[5], yhi = +toks[6];
    const data = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) data[(ny - 1 - r) * nx + c] = +toks[9 + r * nx + c];
    return { nx, ny, data, x0: xlo, y0: yhi, dx: nx > 1 ? (xhi - xlo) / (nx - 1) : 1, dy: ny > 1 ? (yhi - ylo) / (ny - 1) : 1, nodata: SURFER_BLANK, crs: null, form: 'Surfer 6 ascii' };
  }
  throw new Error('not a Surfer grid (no DSAA/DSBB magic)');
}

export async function readEsriAsc(blob) {
  const text = await blob.text();
  const toks = text.trim().split(/\s+/);
  let i = 0;
  const hdr = {};
  while (i < toks.length && /^[a-z_]/i.test(toks[i])) { hdr[toks[i].toLowerCase()] = +toks[i + 1]; i += 2; }
  const nx = hdr.ncols, ny = hdr.nrows, cs = hdr.cellsize || hdr.dx, csy = hdr.dy || cs;   // dx/dy: GDAL's non-square form
  if (!nx || !ny || !cs) throw new Error('not an ESRI ASCII grid (missing ncols/nrows/cellsize)');
  const x0 = hdr.xllcenter != null ? hdr.xllcenter : hdr.xllcorner + cs / 2;
  const yll = hdr.yllcenter != null ? hdr.yllcenter : hdr.yllcorner + csy / 2;
  const data = new Float32Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) data[k] = +toks[i + k];   // already north-first
  return { nx, ny, data, x0, y0: yll + (ny - 1) * csy, dx: cs, dy: csy, nodata: hdr.nodata_value != null ? hdr.nodata_value : null, crs: null, form: 'ESRI ASCII' };
}

// ── grid SOURCES: a big .asc / .grd never becomes one string or one buffer ──
//
// readSurferGrd / readEsriAsc above read whole (one string → split): fine for a
// sidecar, fatal for a multi-GB LiDAR DEM exported as ASCII (one JS string caps
// near 512 M characters, and the full-res Float32 array would be gigabytes too).
// openGridSource returns the SAME shape @gcu/gtiff's readGTiff does — { images:
// [{ width, height, samplesPerPixel, readWindow, readDecimated, read }], geo } —
// so micro's GeoTIFF machinery (decimated display under a cap, full-res WINDOWED
// reads for evaluation, levelGeo / windowForWorldBbox / grid*FromGTiff) applies
// to every grid format unchanged.
//
// Text grids (ESRI ASCII, Surfer DSAA) are walked ONCE in slices: the header is
// read, every row's byte offset is indexed (by token count, so line wrapping
// doesn't matter), and the display decimation for `displayStep` is gathered on
// the way. A window afterwards reads only its rows' bytes. Surfer binary (DSBB) is
// fixed-width: no pass at all, rows are sliced directly.

const SLAB = 8 << 20;
const POW10 = []; for (let i = 0; i <= 22; i++) POW10.push(Number('1e' + i));
// parseFloat over bytes [s,e) — exact for ≤15 significant digits (one correctly
// rounded op), parseFloat itself otherwise
function numAt(b, s, e) {
  let i = s, neg = false;
  if (b[i] === 45 || b[i] === 43) { neg = b[i] === 45; i++; }
  let mant = 0, sig = 0, exp = 0, dot = false, digits = 0;
  for (; i < e; i++) {
    const c = b[i];
    if (c >= 48 && c <= 57) { digits++; if (sig || c !== 48) { if (++sig > 15) return slowNum(b, s, e); } mant = mant * 10 + (c - 48); if (dot) exp--; }
    else if (c === 46 && !dot) dot = true;
    else return slowNum(b, s, e);                           // exponent, junk — the general parser decides
  }
  if (!digits || -exp > 22) return slowNum(b, s, e);
  const v = exp ? mant / POW10[-exp] : mant;
  return neg ? -v : v;
}
function slowNum(b, s, e) { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return parseFloat(t); }
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13;

// walk a byte range token by token: onTok(bytes, start, end, absOffset) → false stops
async function eachToken(blob, from, to, onTok, onProgress) {
  let at = from, carry = null, carryAbs = 0;
  while (at < to) {
    const end = Math.min(to, at + SLAB);
    let b = new Uint8Array(await blob.slice(at, end).arrayBuffer());
    let base = at;
    if (carry) { const m = new Uint8Array(carry.length + b.length); m.set(carry); m.set(b, carry.length); b = m; base = carryAbs; carry = null; }
    const last = end >= to;
    let i = 0;
    const n = b.length;
    while (i < n) {
      while (i < n && isWs(b[i])) i++;
      if (i >= n) break;
      const s = i;
      while (i < n && !isWs(b[i])) i++;
      if (i >= n && !last) { carry = b.slice(s); carryAbs = base + s; break; }   // a token cut by the slab seam
      if (onTok(b, s, i, base + s) === false) return;
    }
    at = end;
    if (onProgress) onProgress(at - from, to - from);
  }
}

const ESRI_KEYS = new Set(['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value', 'dx', 'dy']);

function textGridSource(blob, h, rowOff, display) {
  const { nx, ny, southFirst } = h;
  // north-first rows [r0, r1) → their values, cols [c0, c1)
  async function rows(r0, r1, c0, c1, step = 1) {
    const w = Math.ceil((c1 - c0) / step), hgt = Math.ceil((r1 - r0) / step);
    const out = new Float32Array(w * hgt);
    // file rows covered (south-first files store north row r at ny-1-r)
    const f0 = southFirst ? ny - r1 : r0, f1 = southFirst ? ny - r0 : r1;
    let fr = f0, col = 0;
    await eachToken(blob, rowOff[f0], rowOff[f1], (b, s, e) => {
      const r = southFirst ? ny - 1 - fr : fr;               // north-first row
      if ((r - r0) % step === 0 && col >= c0 && col < c1 && (col - c0) % step === 0) out[((r - r0) / step) * w + (col - c0) / step] = numAt(b, s, e);
      if (++col === nx) { col = 0; fr++; }
    });
    return { data: out, w, h: hgt };
  }
  const img = {
    width: nx, height: ny, samplesPerPixel: 1, bitsPerSample: 32, sampleFormat: 3, compression: 1, tiled: false,
    async readWindow(win) {
      const x = win ? Math.max(0, win.x | 0) : 0, y = win ? Math.max(0, win.y | 0) : 0;
      const width = win ? Math.min(win.width | 0, nx - x) : nx, height = win ? Math.min(win.height | 0, ny - y) : ny;
      if (width <= 0 || height <= 0) throw new Error('grid: empty window');
      const r = await rows(y, y + height, x, x + width);
      return { data: r.data, x, y, width, height };
    },
    async read() { return (await this.readWindow(null)).data; },
    async readDecimated(step) {
      step = Math.max(1, step | 0);
      if (display && display.step === step) return display;
      const r = await rows(0, ny, 0, nx, step);
      return { data: r.data, width: nx, height: ny, step, dnx: r.w, dny: r.h };
    },
  };
  return { images: [img], geo: h.geo, warnings: [], form: h.form };
}

async function textGridHeader(blob, kind) {
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 << 10)).arrayBuffer());
  const toks = [];
  let i = 0;
  while (i < head.length && toks.length < 24) {
    while (i < head.length && isWs(head[i])) i++;
    const s = i; while (i < head.length && !isWs(head[i])) i++;
    if (i > s) toks.push({ t: slowNumText(head, s, i), s, e: i });
  }
  if (kind === 'dsaa') {
    if (toks[0].t !== 'DSAA') throw new Error('not a Surfer ASCII grid (no DSAA)');
    const v = toks.slice(1, 9).map((x) => +x.t);
    const [nx, ny, xlo, xhi, ylo, yhi] = v;
    if (!(nx > 0 && ny > 0)) throw new Error('Surfer ASCII grid: bad dimensions');
    const dx = nx > 1 ? (xhi - xlo) / (nx - 1) : 1, dy = ny > 1 ? (yhi - ylo) / (ny - 1) : 1;
    return { nx, ny, southFirst: true, dataStart: toks[8].e, form: 'Surfer 6 ascii',
      geo: { origin: [xlo, yhi], scale: [dx, dy], pixelIsPoint: true, crs: null, nodata: SURFER_BLANK } };
  }
  const hdr = {};
  let k = 0;
  while (k + 1 < toks.length && /^[a-z_]/i.test(toks[k].t) && ESRI_KEYS.has(toks[k].t.toLowerCase())) { hdr[toks[k].t.toLowerCase()] = +toks[k + 1].t; k += 2; }
  const nx = hdr.ncols, ny = hdr.nrows, cs = hdr.cellsize || hdr.dx;
  if (!nx || !ny || !cs) throw new Error('not an ESRI ASCII grid (missing ncols/nrows/cellsize)');
  const csy = hdr.dy || cs;
  const xll = hdr.xllcenter != null ? hdr.xllcenter - cs / 2 : hdr.xllcorner;
  const yll = hdr.yllcenter != null ? hdr.yllcenter - csy / 2 : hdr.yllcorner;
  return { nx, ny, southFirst: false, dataStart: toks[k - 1].e, form: 'ESRI ASCII',
    geo: { origin: [xll, yll + ny * csy], scale: [cs, csy], pixelIsPoint: false, crs: null, nodata: hdr.nodata_value != null ? hdr.nodata_value : null } };
}
function slowNumText(b, s, e) { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return t; }

// Surfer 6 binary header (56 B) → the fixed-width layout surferBinarySource reads
function parseSurfer6(v) {
  const nx = v.getInt16(4, true), ny = v.getInt16(6, true);
  const xlo = v.getFloat64(8, true), xhi = v.getFloat64(16, true), ylo = v.getFloat64(24, true), yhi = v.getFloat64(32, true);
  return { nx, ny, xlo, yhi, dx: nx > 1 ? (xhi - xlo) / (nx - 1) : 1, dy: ny > 1 ? (yhi - ylo) / (ny - 1) : 1,
    dataOff: 56, bpv: 4, nodata: SURFER_BLANK, form: 'Surfer 6 binary' };
}
// Surfer 7 binary: tagged sections (u32 tag, u32 size) — 'DSRB' header, 'GRID'
// (nRow, nCol i32; xLL, yLL, xSize, ySize, zMin, zMax, rotation, blank f64), then
// 'DATA' = nRow·nCol float64, south-first. Unknown sections ('FLTI' faults…) are skipped.
const SEC = { DSRB: 0x42525344, GRID: 0x44495247, DATA: 0x41544144 };
function parseSurfer7(v) {
  let at = 0, g = null;
  while (at + 8 <= v.byteLength) {
    const tag = v.getUint32(at, true), size = v.getUint32(at + 4, true);
    at += 8;
    if (tag === SEC.DSRB) { at += size; continue; }
    if (tag === SEC.GRID) {
      if (size < 72 || at + 72 > v.byteLength) break;
      const ny = v.getInt32(at, true), nx = v.getInt32(at + 4, true);
      const xll = v.getFloat64(at + 8, true), yll = v.getFloat64(at + 16, true);
      const dx = v.getFloat64(at + 24, true), dy = v.getFloat64(at + 32, true);
      const rot = v.getFloat64(at + 56, true), blank = v.getFloat64(at + 64, true);
      if (rot !== 0) throw new Error('Surfer 7 grid is rotated — not supported');
      g = { nx, ny, xlo: xll, yhi: yll + (ny - 1) * dy, dx, dy, bpv: 8, form: 'Surfer 7 binary',
        // a blank ≥ 1.7e38 is Surfer's own; any other blank is matched exactly as the float32 a grid holds
        nodata: blank >= 1.7e38 ? SURFER_BLANK : Math.fround(blank) };
      at += size; continue;
    }
    if (tag === SEC.DATA) {
      if (!g) break;
      if (size < g.nx * g.ny * 8) throw new Error('Surfer 7 grid: DATA section shorter than the grid');
      g.dataOff = at;
      return g;
    }
    at += size;                                            // a section we don't need
  }
  throw new Error('Surfer 7 grid: no GRID/DATA section in the header');
}

function surferBinarySource(blob, h) {
  const { nx, ny, xlo, yhi, dx, dy, dataOff, bpv } = h;
  const rowB = nx * bpv;
  const getV = bpv === 8 ? (dv, o) => dv.getFloat64(o, true) : (dv, o) => dv.getFloat32(o, true);
  // north-first rows [r0, r1), every `step`-th row/col from c0 — south-first on disk
  async function rows(r0, r1, c0, c1, step = 1) {
    const w = Math.ceil((c1 - c0) / step), hgt = Math.ceil((r1 - r0) / step);
    const out = new Float32Array(w * hgt);
    const per = Math.max(1, Math.floor(SLAB / rowB));
    for (let fr0 = ny - r1; fr0 < ny - r0; fr0 += per) {    // file rows, read in slabs
      const fr1 = Math.min(ny - r0, fr0 + per);
      const dv = new DataView(await blob.slice(dataOff + fr0 * rowB, dataOff + fr1 * rowB).arrayBuffer());
      for (let fr = fr0; fr < fr1; fr++) {
        const r = ny - 1 - fr;
        if ((r - r0) % step) continue;
        const o = (fr - fr0) * rowB, orow = ((r - r0) / step) * w;
        for (let c = c0, k = 0; c < c1; c += step, k++) out[orow + k] = getV(dv, o + c * bpv);
      }
    }
    return { data: out, w, h: hgt };
  }
  const img = {
    width: nx, height: ny, samplesPerPixel: 1, bitsPerSample: 32, sampleFormat: 3, compression: 1, tiled: false,
    async readWindow(win) {
      const x = win ? Math.max(0, win.x | 0) : 0, y = win ? Math.max(0, win.y | 0) : 0;
      const width = win ? Math.min(win.width | 0, nx - x) : nx, height = win ? Math.min(win.height | 0, ny - y) : ny;
      if (width <= 0 || height <= 0) throw new Error('grid: empty window');
      const r = await rows(y, y + height, x, x + width);
      return { data: r.data, x, y, width, height };
    },
    async read() { return (await this.readWindow(null)).data; },
    async readDecimated(step) {
      step = Math.max(1, step | 0);
      const r = await rows(0, ny, 0, nx, step);
      return { data: r.data, width: nx, height: ny, step, dnx: r.w, dny: r.h };
    },
  };
  return { images: [img], warnings: [], form: h.form,
    geo: { origin: [xlo, yhi], scale: [dx, dy], pixelIsPoint: true, crs: null, nodata: h.nodata } };
}

/**
 * openGridSource(blob, name, { displayCap, onProgress }) → a readGTiff-shaped
 * source for .asc (ESRI ASCII) and .grd (Surfer 7 binary DSRB, Surfer 6 binary DSBB / ascii DSAA).
 * Text grids take ONE indexing pass; its display decimation (the step that fits
 * displayCap cells) is gathered on the same pass and served from readDecimated.
 */
export async function openGridSource(blob, name, { displayCap = 8_000_000, onProgress } = {}) {
  let kind = 'esri';
  if (/\.grd$/i.test(name)) {
    const tag = new TextDecoder('latin1').decode(await blob.slice(0, 4).arrayBuffer());
    if (tag === 'DSRB') return surferBinarySource(blob, parseSurfer7(new DataView(await blob.slice(0, Math.min(blob.size, 4096)).arrayBuffer())));
    if (tag === 'DSBB') return surferBinarySource(blob, parseSurfer6(new DataView(await blob.slice(0, 56).arrayBuffer())));
    if (tag !== 'DSAA') throw new Error('not a Surfer grid (no DSAA/DSBB magic)');
    kind = 'dsaa';
  }
  const h = await textGridHeader(blob, kind);
  const { nx, ny } = h;
  const step = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / Math.max(1, displayCap))));
  const dnx = Math.ceil(nx / step), dny = Math.ceil(ny / step);
  const disp = new Float32Array(dnx * dny);
  // the index: rowOff[f] = byte offset of file row f's first value; rowOff[ny] = the end
  const rowOff = new Float64Array(ny + 1);
  let col = 0, fr = 0, seen = 0;
  // dataStart = the end of the last header token (ESRI's last key value / DSAA's zhi)
  await eachToken(blob, h.dataStart, blob.size, (b, s, e, abs) => {
    if (fr >= ny) return false;
    if (col === 0) rowOff[fr] = abs;
    const r = h.southFirst ? ny - 1 - fr : fr;             // north-first row
    if (r % step === 0 && col % step === 0) disp[(r / step) * dnx + col / step] = numAt(b, s, e);
    seen++;
    if (++col === nx) { col = 0; fr++; }
  }, onProgress);
  if (fr < ny) throw new Error(`grid: ${seen.toLocaleString()} values, expected ${(nx * ny).toLocaleString()} (${nx}×${ny}) — truncated file?`);
  rowOff[ny] = blob.size;
  return textGridSource(blob, h, rowOff, { data: disp, width: nx, height: ny, step, dnx, dny });
}

// ── WRITERS ────────────────────────────────────────────────────────────────
// Every writer takes the grid convention above and the same option words:
//   nodata    the value written for an empty cell (formats with a fixed blank —
//             Surfer — ignore it)
//   decimals  text formats: digits after the point, or null = float32-exact (the
//             shortest text that reads back to the very same float32)
// Text writers come in two shapes: `…Parts(grid, opts)` → an array of string
// chunks (a few thousand rows each — new Blob(parts) never builds one giant
// string), and a convenience that joins them.

// is this cell empty? NaN, the grid's own nodata, or a Surfer blank (anything ≥ 1.7014e38)
export function gridBlankTest(grid) {
  const nd = grid.nodata;
  if (nd == null || Number.isNaN(nd)) return (v) => Number.isNaN(v);
  if (nd >= 1.7e38) return (v) => Number.isNaN(v) || v >= 1.7014e38;
  return (v) => Number.isNaN(v) || v === nd;
}

// the default nodata a format writes when the caller names none: the grid's own
// when it is an ordinary number, else -9999 (the ESRI habit)
export const defaultNodata = (grid) => (grid.nodata != null && Number.isFinite(grid.nodata) && grid.nodata < 1.7e38 ? grid.nodata : -9999);

// number → text. decimals = null → float32-exact: the fewest significant digits
// that round back to the same float32 (6 to 9 of them), so nothing is lost and no
// float64 noise (123.4000015258789) is written for a value that was 123.4.
export function valueFormatter(decimals) {
  if (decimals == null) {
    return (v) => {
      if (Number.isInteger(v)) return String(v);
      const f = Math.fround(v);
      for (let p = 6; p < 9; p++) { const s = +v.toPrecision(p); if (Math.fround(s) === f) return String(s); }
      return String(+v.toPrecision(9));
    };
  }
  const d = Math.max(0, Math.min(12, decimals | 0));
  return (v) => { const s = v.toFixed(d); return d && s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s; };
}
// a coordinate: exact to the micrometre, without float sums' last-digit noise
const coordText = (x) => String(+x.toFixed(6));

const ROWS_PER_PART = 2048;
const isSquare = (g) => Math.abs(g.dx - g.dy) <= Math.abs(g.dx) * 1e-9;

// ESRI ASCII grid (.asc). North-first rows. A grid whose cells aren't square has
// no `cellsize` to give: it is written with GDAL's `dx`/`dy` pair instead (GDAL,
// QGIS and micro read it; ArcGIS proper wants square cells).
export function esriAscParts(grid, { nodata, decimals = 3 } = {}) {
  const { nx, ny, x0, y0, dx, dy, data } = grid;
  const nd = nodata == null ? defaultNodata(grid) : nodata;
  const bad = gridBlankTest(grid), fmt = valueFormatter(decimals), ndText = Number.isNaN(nd) ? 'nan' : String(nd);
  const head = [`ncols ${nx}`, `nrows ${ny}`, `xllcorner ${coordText(x0 - dx / 2)}`, `yllcorner ${coordText(y0 - (ny - 1) * dy - dy / 2)}`,
    ...(isSquare(grid) ? [`cellsize ${dx}`] : [`dx ${dx}`, `dy ${dy}`]), `NODATA_value ${ndText}`];
  const parts = [head.join('\n') + '\n'];
  let buf = [];
  for (let r = 0; r < ny; r++) {
    const row = new Array(nx);
    for (let c = 0; c < nx; c++) { const v = data[r * nx + c]; row[c] = bad(v) ? ndText : fmt(v); }
    buf.push(row.join(' '));
    if (buf.length === ROWS_PER_PART) { parts.push(buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) parts.push(buf.join('\n') + '\n');
  return parts;
}
// a rasterized grid persists as this (dogfoods the reader; projects reload it)
export function writeEsriAsc(grid, opts) { return esriAscParts(grid, opts).join(''); }

// Surfer 6 ASCII (DSAA). South-first rows, ten values to a line and a blank line
// between rows — Surfer's own layout. Blank = 1.70141e38 (the format's fixed blank).
export function surferAsciiParts(grid, { decimals = 3 } = {}) {
  const { nx, ny, x0, y0, dx, dy, data } = grid;
  const bad = gridBlankTest(grid), fmt = valueFormatter(decimals);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < nx * ny; i++) { const v = data[i]; if (bad(v)) continue; if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  if (!(zmin <= zmax)) { zmin = 0; zmax = 0; }
  const parts = [`DSAA\n${nx} ${ny}\n${coordText(x0)} ${coordText(x0 + (nx - 1) * dx)}\n${coordText(y0 - (ny - 1) * dy)} ${coordText(y0)}\n${fmt(zmin)} ${fmt(zmax)}\n`];
  let buf = [];
  for (let r = ny - 1; r >= 0; r--) {
    const lines = [];
    for (let c0 = 0; c0 < nx; c0 += 10) {
      const vals = [];
      for (let c = c0; c < Math.min(nx, c0 + 10); c++) { const v = data[r * nx + c]; vals.push(bad(v) ? '1.70141e+38' : fmt(v)); }
      lines.push(vals.join(' '));
    }
    buf.push(lines.join('\n') + '\n');
    if (buf.length === ROWS_PER_PART) { parts.push(buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) parts.push(buf.join('\n') + '\n');
  return parts;
}

// Surfer 6 binary (DSBB) writer — 4 B/value + a 56 B header, nx/ny ≤ 32767 (int16).
// Also the display-cache sidecar's format.
export function writeSurferGrd(g) {
  const { nx, ny, x0, y0, dx, dy, data } = g;
  if (nx > 32767 || ny > 32767) throw new Error(`Surfer 6 holds at most 32767 rows and columns (this grid is ${nx}×${ny}) — use Surfer 7`);
  const isBad = gridBlankTest(g);
  let zmin = Infinity, zmax = -Infinity;
  for (const v of data) { if (isBad(v)) continue; if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  if (!(zmin <= zmax)) { zmin = 0; zmax = 0; }
  const buf = new ArrayBuffer(56 + nx * ny * 4);
  const v = new DataView(buf);
  v.setUint8(0, 0x44); v.setUint8(1, 0x53); v.setUint8(2, 0x42); v.setUint8(3, 0x42);   // 'DSBB'
  v.setInt16(4, nx, true); v.setInt16(6, ny, true);
  v.setFloat64(8, x0, true); v.setFloat64(16, x0 + (nx - 1) * dx, true);                // xlo, xhi
  v.setFloat64(24, y0 - (ny - 1) * dy, true); v.setFloat64(32, y0, true);               // ylo, yhi
  v.setFloat64(40, zmin, true); v.setFloat64(48, zmax, true);
  let o = 56;                                                                            // Surfer is SOUTH-first
  for (let r = ny - 1; r >= 0; r--) for (let c = 0; c < nx; c++) { const val = data[r * nx + c]; v.setFloat32(o, isBad(val) ? SURFER_BLANK : val, true); o += 4; }
  return buf;
}

// Surfer 7 binary (DSRB): tagged sections, int32 dimensions, float64 values
// south-first, blank 1.70141e38. Version 1 (blank matched exactly — what we write).
export function writeSurfer7Grd(g) {
  const { nx, ny, x0, y0, dx, dy, data } = g;
  const isBad = gridBlankTest(g);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < nx * ny; i++) { const val = data[i]; if (isBad(val)) continue; if (val < zmin) zmin = val; if (val > zmax) zmax = val; }
  if (!(zmin <= zmax)) { zmin = 0; zmax = 0; }
  const n = nx * ny;
  const buf = new ArrayBuffer(12 + 8 + 72 + 8 + n * 8);
  const v = new DataView(buf);
  let o = 0;
  v.setUint32(o, SEC.DSRB, true); v.setUint32(o + 4, 4, true); v.setUint32(o + 8, 1, true); o += 12;
  v.setUint32(o, SEC.GRID, true); v.setUint32(o + 4, 72, true); o += 8;
  v.setInt32(o, ny, true); v.setInt32(o + 4, nx, true);
  v.setFloat64(o + 8, x0, true); v.setFloat64(o + 16, y0 - (ny - 1) * dy, true);
  v.setFloat64(o + 24, dx, true); v.setFloat64(o + 32, dy, true);
  v.setFloat64(o + 40, zmin, true); v.setFloat64(o + 48, zmax, true);
  v.setFloat64(o + 56, 0, true); v.setFloat64(o + 64, SURFER_BLANK, true); o += 72;
  v.setUint32(o, SEC.DATA, true); v.setUint32(o + 4, n * 8, true); o += 8;
  for (let r = ny - 1; r >= 0; r--) for (let c = 0; c < nx; c++) { const val = data[r * nx + c]; v.setFloat64(o, isBad(val) ? SURFER_BLANK : val, true); o += 8; }
  return buf;
}

// ESRI binary float grid: { flt: float32 little-endian, north-first; hdr: its
// text header }. Non-square cells → GDAL's xdim/ydim instead of cellsize.
export function writeEsriFlt(grid, { nodata } = {}) {
  const { nx, ny, x0, y0, dx, dy, data } = grid;
  const nd = nodata == null ? defaultNodata(grid) : nodata;
  const bad = gridBlankTest(grid);
  const flt = new ArrayBuffer(nx * ny * 4), v = new DataView(flt);
  for (let i = 0; i < nx * ny; i++) { const val = data[i]; v.setFloat32(i * 4, bad(val) ? nd : val, true); }
  const hdr = [`ncols ${nx}`, `nrows ${ny}`, `xllcorner ${coordText(x0 - dx / 2)}`, `yllcorner ${coordText(y0 - (ny - 1) * dy - dy / 2)}`,
    ...(isSquare(grid) ? [`cellsize ${dx}`] : [`xdim ${dx}`, `ydim ${dy}`]), `NODATA_value ${Number.isNaN(nd) ? 'nan' : nd}`, 'byteorder LSBFIRST'].join('\n') + '\n';
  return { flt, hdr };
}

// XYZ / CSV of nodes: one row per node (north row first, west to east), x and y
// at the node, then the value. delim ',' | ' ' | '\t'. skipEmpty drops empty
// nodes; otherwise an empty node writes an empty field (or, space-delimited, where
// an empty field can't exist, the nodata value). names = [x, y, value] headers.
export function gridXyzParts(grid, { delim = ',', header = true, names = ['x', 'y', 'z'], skipEmpty = true, nodata, decimals = 3 } = {}) {
  const { nx, ny, x0, y0, dx, dy, data } = grid;
  const bad = gridBlankTest(grid), fmt = valueFormatter(decimals);
  const nd = nodata == null ? defaultNodata(grid) : nodata;
  const emptyText = delim === ' ' ? (Number.isNaN(nd) ? 'nan' : String(nd)) : '';
  const parts = header ? [names.join(delim) + '\n'] : [];
  const xs = new Array(nx); for (let c = 0; c < nx; c++) xs[c] = coordText(x0 + c * dx);
  let buf = [], written = 0;
  for (let r = 0; r < ny; r++) {
    const y = coordText(y0 - r * dy);
    for (let c = 0; c < nx; c++) {
      const v = data[r * nx + c];
      if (bad(v)) { if (skipEmpty) continue; buf.push(xs[c] + delim + y + delim + emptyText); }
      else buf.push(xs[c] + delim + y + delim + fmt(v));
      written++;
    }
    if (buf.length >= 65536) { parts.push(buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) parts.push(buf.join('\n') + '\n');
  parts.rows = written;
  return parts;
}
