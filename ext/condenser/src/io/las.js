// @gcu/condenser — LAS provider (uncompressed point record formats 0–3 and 6–8).
// Header-driven: the public header block gives bbox, count, format, and scale/offset
// up front — no discovery pass. streamChunks() parses chunk-at-a-time from a
// ReadableStream, never holding raw file bytes beyond the current chunk (+ a
// partial-record carry). Positions come out as WORLD f64 (scale·raw + offset);
// frame-local quantization happens downstream in chunks.js — providers know
// formats, condenser knows rendering, nothing else crosses the seam.
//
// Provider contract (micro-spec §2.4):
//   openLas(blob) → { header, streamChunks(opts), columnBatches(names, opts), fetchRecord(rec) }
//   RawChunk = { count, x, y, z: Float64Array, intensity: Uint16Array,
//                classification: Uint8Array, rgb: Uint8Array(3N) | null,
//                recStart: number }   — recStart = record index of element 0.
//
// COLUMNS. Every field of the point record is a column (header.columns): the
// coordinates, intensity, the return numbers, classification, scan angle, user
// data, point source id, GPS time, RGB and NIR as the format carries them —
// plus the EXTRA BYTES a file declares (LAS 1.4 VLR LASF_Spec/4: named, typed,
// scaled per-point attributes such as reflectance or deviation). columnBatches
// streams only the columns asked for; fetchRecord reads one point's every column.

const RECLEN = { 0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38 };
const RGB_OFF = { 2: 20, 3: 28, 7: 30, 8: 30 };
const GPS_OFF = { 1: 20, 3: 20, 6: 22, 7: 22, 8: 22 };

export class LasFormatError extends Error {
  constructor(msg) { super(msg); this.name = 'LasFormatError'; }
}

// Parse the public header block from the file's first bytes (≥ 375 recommended).
export function parseLasHeader(bytes) {
  const dv = bytes instanceof DataView ? bytes : new DataView(bytes.buffer ? bytes.buffer : bytes, bytes.byteOffset || 0, bytes.byteLength);
  if (dv.byteLength < 227) throw new LasFormatError('file too small for a LAS header');
  if (dv.getUint8(0) !== 0x4C || dv.getUint8(1) !== 0x41 || dv.getUint8(2) !== 0x53 || dv.getUint8(3) !== 0x46) {
    throw new LasFormatError('not a LAS file (no LASF signature)');
  }
  const verMajor = dv.getUint8(24), verMinor = dv.getUint8(25);
  const headerSize = dv.getUint16(94, true);
  const pointOffset = dv.getUint32(96, true);
  const vlrCount = dv.getUint32(100, true);
  const fmtByte = dv.getUint8(104);
  if (fmtByte & 0x80) throw new LasFormatError('LAZ (compressed) — not supported; export uncompressed LAS');
  const format = fmtByte & 0x3f;
  if (!(format in RECLEN)) throw new LasFormatError(`unsupported point record format ${format} (supported: 0–3, 6–8)`);
  const recordLen = dv.getUint16(105, true);
  if (recordLen < RECLEN[format]) throw new LasFormatError(`record length ${recordLen} < format ${format} minimum ${RECLEN[format]}`);
  const legacyCount = dv.getUint32(107, true);
  let count = legacyCount;
  if (verMinor >= 4 && headerSize >= 255 && dv.byteLength >= 255) {
    const c64 = dv.getBigUint64(247, true);
    if (c64 > 0n) count = Number(c64);                    // 1.4 files may zero the legacy field
  }
  const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
  const offset = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
  // bbox stored max/min interleaved per axis
  const bbox = {
    min: [dv.getFloat64(187, true), dv.getFloat64(203, true), dv.getFloat64(219, true)],
    max: [dv.getFloat64(179, true), dv.getFloat64(195, true), dv.getFloat64(211, true)],
  };
  const header = {
    kind: 'las', version: `${verMajor}.${verMinor}`, format, recordLen,
    count, pointOffset, headerSize, vlrCount, scale, offset, bbox,
    hasRgb: format in RGB_OFF,
    attributes: ['intensity', 'classification', ...(format in RGB_OFF ? ['rgb'] : [])],
    extraBytes: [],
  };
  header.columns = lasFieldsOf(header).map((f) => f.name);
  return header;
}

// ── extra bytes (LAS 1.4 §2.6, VLR "LASF_Spec" / 4): 192-byte descriptors, in
// record order, starting right after the format's standard fields ──
const EB_SIZE = [0, 1, 1, 2, 2, 4, 4, 8, 8, 4, 8];
const EB_GET = [null, 'getUint8', 'getInt8', 'getUint16', 'getInt16', 'getUint32', 'getInt32', 'getBigUint64', 'getBigInt64', 'getFloat32', 'getFloat64'];
const cstr = (dv, o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };

// the VLR block (bytes [headerSize, pointOffset)) → the header's extraBytes
export function parseLasVlrs(header, bytes) {
  const dv = bytes instanceof DataView ? bytes : new DataView(bytes.buffer ? bytes.buffer : bytes, bytes.byteOffset || 0, bytes.byteLength);
  const out = [];
  let o = 0;
  for (let k = 0; k < header.vlrCount && o + 54 <= dv.byteLength; k++) {
    const user = cstr(dv, o + 2, 16), id = dv.getUint16(o + 18, true), len = dv.getUint16(o + 20, true);
    const data = o + 54;
    // the coordinate system (LAS 1.4 §2.5): "LASF_Projection" 2112 = OGC WKT text; 34735 = the
    // GeoTIFF GeoKeyDirectory (inline SHORT keys: 3072 ProjectedCSType, 2048 GeographicType, …).
    // Recorded on the header as header.crs = { wkt } | { geoKeys } — naming it is the host's job.
    if (user === 'LASF_Projection' && data + len <= dv.byteLength) {
      if (id === 2112) { let s = ''; for (let i = 0; i < len; i++) { const c = dv.getUint8(data + i); if (!c) break; s += String.fromCharCode(c); } if (s.trim()) header.crs = { ...(header.crs || {}), wkt: s.trim() }; }
      else if (id === 34735 && len >= 8) {
        const nk = dv.getUint16(data + 6, true), keys = {};
        for (let k2 = 0; k2 < nk && data + 8 + 8 * k2 + 8 <= data + len; k2++) {
          const e = data + 8 + 8 * k2, kid = dv.getUint16(e, true), loc = dv.getUint16(e + 2, true);
          if (loc === 0) keys[kid] = dv.getUint16(e + 6, true);
        }
        header.crs = { ...(header.crs || {}), geoKeys: keys };
      }
    }
    if (user === 'LASF_Spec' && id === 4 && data + len <= dv.byteLength) {
      let at = RECLEN[header.format];
      for (let d = data; d + 192 <= data + len; d += 192) {
        const type = dv.getUint8(d + 2), opts = dv.getUint8(d + 3), name = cstr(dv, d + 4, 32) || `extra_${out.length}`;
        const base = type >= 1 && type <= 10 ? type : type >= 11 && type <= 20 ? type - 10 : type >= 21 && type <= 30 ? type - 20 : 0;
        const n = type >= 21 ? 3 : type >= 11 ? 2 : 1;
        const size = base ? EB_SIZE[base] : opts;           // type 0: `options` is the byte count, undocumented
        for (let e = 0; e < n; e++) {
          if (base) {
            const isFloat = base >= 9, isSigned = base % 2 === 0;
            const nd = !isFloat && !isSigned ? Number(dv.getBigUint64(d + 40 + 8 * e, true)) : !isFloat ? Number(dv.getBigInt64(d + 40 + 8 * e, true)) : dv.getFloat64(d + 40 + 8 * e, true);
            out.push({
              name: n > 1 ? `${name}[${e}]` : name, type: base, offset: at, size,
              noData: opts & 1 ? nd : null,
              scale: opts & 8 ? dv.getFloat64(d + 112 + 8 * e, true) : 1,
              add: opts & 16 ? dv.getFloat64(d + 136 + 8 * e, true) : 0,
              description: cstr(dv, d + 160, 32),
            });
          }
          at += size;
        }
      }
    }
    o = data + len;
  }
  const fit = out.filter((f) => f.offset + f.size <= header.recordLen);   // a descriptor past the record is the file's error, not a column
  header.extraBytes = fit;
  header.columns = lasFieldsOf(header).map((f) => f.name);
  return header;
}

// every column of a record: { name, read(dv, o) → number } (o = the record's byte offset)
export function lasFieldsOf(header) {
  const { format, scale, offset } = header;
  const legacy = format < 6;
  const f = [
    { name: 'X', read: (dv, o) => dv.getInt32(o, true) * scale[0] + offset[0] },
    { name: 'Y', read: (dv, o) => dv.getInt32(o + 4, true) * scale[1] + offset[1] },
    { name: 'Z', read: (dv, o) => dv.getInt32(o + 8, true) * scale[2] + offset[2] },
    { name: 'intensity', read: (dv, o) => dv.getUint16(o + 12, true) },
    { name: 'return_number', read: legacy ? (dv, o) => dv.getUint8(o + 14) & 7 : (dv, o) => dv.getUint8(o + 14) & 15 },
    { name: 'number_of_returns', read: legacy ? (dv, o) => (dv.getUint8(o + 14) >> 3) & 7 : (dv, o) => dv.getUint8(o + 14) >> 4 },
    { name: 'classification', read: legacy ? (dv, o) => dv.getUint8(o + 15) & 31 : (dv, o) => dv.getUint8(o + 16) },
    { name: 'scan_angle', read: legacy ? (dv, o) => dv.getInt8(o + 16) : (dv, o) => dv.getInt16(o + 18, true) * 0.006 },   // degrees
    { name: 'user_data', read: legacy ? (dv, o) => dv.getUint8(o + 17) : (dv, o) => dv.getUint8(o + 17) },
    { name: 'point_source_id', read: legacy ? (dv, o) => dv.getUint16(o + 18, true) : (dv, o) => dv.getUint16(o + 20, true) },
  ];
  if (GPS_OFF[format] != null) { const g = GPS_OFF[format]; f.push({ name: 'gps_time', read: (dv, o) => dv.getFloat64(o + g, true) }); }
  if (RGB_OFF[format] != null) {
    const r = RGB_OFF[format];
    f.push({ name: 'red', read: (dv, o) => dv.getUint16(o + r, true) }, { name: 'green', read: (dv, o) => dv.getUint16(o + r + 2, true) }, { name: 'blue', read: (dv, o) => dv.getUint16(o + r + 4, true) });
  }
  if (format === 8) f.push({ name: 'nir', read: (dv, o) => dv.getUint16(o + 36, true) });
  const taken = new Set(f.map((x) => x.name.toLowerCase()));
  for (const e of header.extraBytes || []) {
    let name = e.name; while (taken.has(name.toLowerCase())) name += '_x';
    taken.add(name.toLowerCase());
    const g = EB_GET[e.type], big = e.type === 7 || e.type === 8;
    const raw = big ? (dv, o) => Number(dv[g](o + e.offset, true)) : (dv, o) => dv[g](o + e.offset, true);
    f.push({ name, extra: true, read: (dv, o) => { const v = raw(dv, o); return e.noData != null && v === e.noData ? NaN : v * e.scale + e.add; } });
  }
  return f;
}

// Decode `n` fixed-size records from dv starting at byte 0 into columnar arrays.
// RGB: LAS stores u16 per channel, but many files carry 8-bit values in the low
// byte. Decode as u16, decide once per chunk (any channel > 255 → 16-bit → >>8),
// or accept a `forceRgb16` override (sticky across chunks — see streamChunks).
export function decodeLasRecords(dv, header, n, recStart, { forceRgb16 = false } = {}) {
  const { format, recordLen, scale, offset } = header;
  const clsOff = format >= 6 ? 16 : 15;
  const rgbOff = RGB_OFF[format];
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const intensity = new Uint16Array(n), classification = new Uint8Array(n);
  const rgb16 = rgbOff != null ? new Uint16Array(3 * n) : null;
  for (let i = 0; i < n; i++) {
    const o = i * recordLen;
    x[i] = dv.getInt32(o, true) * scale[0] + offset[0];
    y[i] = dv.getInt32(o + 4, true) * scale[1] + offset[1];
    z[i] = dv.getInt32(o + 8, true) * scale[2] + offset[2];
    intensity[i] = dv.getUint16(o + 12, true);
    classification[i] = dv.getUint8(o + clsOff);
    if (rgb16) {
      rgb16[i * 3] = dv.getUint16(o + rgbOff, true);
      rgb16[i * 3 + 1] = dv.getUint16(o + rgbOff + 2, true);
      rgb16[i * 3 + 2] = dv.getUint16(o + rgbOff + 4, true);
    }
  }
  let rgb = null, rgbIs16 = forceRgb16;
  if (rgb16) {
    if (!rgbIs16) { for (let k = 0; k < rgb16.length; k++) if (rgb16[k] > 255) { rgbIs16 = true; break; } }
    rgb = new Uint8Array(3 * n);
    if (rgbIs16) for (let k = 0; k < rgb16.length; k++) rgb[k] = rgb16[k] >> 8;
    else rgb.set(rgb16);                                   // values ≤255 fit as-is
  }
  return { count: n, x, y, z, intensity, classification, rgb, recStart, rgbIs16 };
}

/**
 * Open a LAS Blob/File. Reads the header up front (one small slice) and the VLR
 * block (for extra-bytes columns), then streamChunks() yields RawChunks of ≤
 * chunkPoints records, parsing from a fresh ReadableStream (a cold re-runnable
 * recipe — call it again for a second sweep). Carries partial records across
 * stream chunk boundaries.
 */
export async function openLas(blob, { headerBytes = 512 } = {}) {
  const head = new DataView(await blob.slice(0, Math.min(headerBytes, blob.size)).arrayBuffer());
  const header = parseLasHeader(head);
  if (header.vlrCount && header.pointOffset > header.headerSize) {
    const end = Math.min(header.pointOffset, header.headerSize + (8 << 20), blob.size);
    try { parseLasVlrs(header, new DataView(await blob.slice(header.headerSize, end).arrayBuffer())); } catch { /* a damaged VLR block costs only the extra columns */ }
  }
  const recordLen = header.recordLen;

  // record slabs: (DataView over n whole records, n, recStart), from a fresh stream
  async function* slabs({ chunkPoints = 1 << 20, signal } = {}) {
    const stream = blob.slice(header.pointOffset).stream();
    const reader = stream.getReader();
    let carry = new Uint8Array(0);
    let recDone = 0;
    try {
      while (recDone < header.count) {
        const { done, value } = await reader.read();
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (done) break;
        let buf = value;
        if (carry.length) {                                // stitch the partial record from last read
          const joined = new Uint8Array(carry.length + value.length);
          joined.set(carry, 0); joined.set(value, carry.length);
          buf = joined; carry = new Uint8Array(0);
        }
        let avail = Math.floor(buf.length / recordLen);
        if (avail * recordLen < buf.length) carry = buf.slice(avail * recordLen);
        avail = Math.min(avail, header.count - recDone);
        let off = 0;
        while (avail > 0) {
          const n = Math.min(avail, chunkPoints);
          yield { dv: new DataView(buf.buffer, buf.byteOffset + off, n * recordLen), n, recStart: recDone };
          recDone += n; off += n * recordLen; avail -= n;
        }
      }
    } finally {
      reader.releaseLock();
      try { await stream.cancel(); } catch { /* already done */ }
    }
  }

  async function* streamChunks(opts = {}) {
    let rgb16 = false;                                     // sticky: once 16-bit color is seen, stay >>8
    for await (const { dv, n, recStart } of slabs(opts)) {
      const chunk = decodeLasRecords(dv, header, n, recStart, { forceRgb16: rgb16 });
      if (chunk.rgbIs16) rgb16 = true;
      yield chunk;
    }
  }

  // only the named columns: { n, recStart, cols: { name: Float64Array } }
  const fields = lasFieldsOf(header);
  async function* columnBatches(names, opts = {}) {
    const want = names.map((nm) => { const f = fields.find((q) => q.name === nm) || fields.find((q) => q.name.toLowerCase() === String(nm).toLowerCase()); if (!f) throw new Error(`LAS: no column “${nm}”`); return f; });
    for await (const { dv, n, recStart } of slabs({ chunkPoints: opts.chunkPoints || 1 << 18, signal: opts.signal })) {
      const cols = {};
      want.forEach((f, k) => { const a = new Float64Array(n), rd = f.read; for (let i = 0; i < n; i++) a[i] = rd(dv, i * recordLen); cols[names[k]] = a; });
      yield { n, recStart, cols };
    }
  }

  async function fetchRecord(rec) {
    if (rec < 0 || rec >= header.count) return null;
    const off = header.pointOffset + rec * recordLen;
    const dv = new DataView(await blob.slice(off, off + recordLen).arrayBuffer());
    return fields.map((f) => { const v = f.read(dv, 0); return Number.isFinite(v) && !Number.isInteger(v) ? +v.toFixed(6) : v; });
  }

  return { header, streamChunks, columnBatches, fetchRecord };
}
