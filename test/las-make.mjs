// Test-only synthetic LAS writer — builds valid uncompressed LAS 1.2/1.4 buffers so
// @gcu/condenser's reader can be validated without shipping a writer or real data.
// Shared by test/condenser.test.mjs and the micro render smoke.
//
// points: array of { x, y, z, intensity?, classification?, r?, g?, b?, ret?, nret?,
// scanAngle?, userData?, psid?, gps?, nir?, extra?: { name: value } } in WORLD
// coordinates; scale/offset are applied in reverse to produce the stored int32s.
// extra: [{ name, type (1–10, LAS data_type), scale?, offset?, noData? }] — an
// extra-bytes VLR (LASF_Spec / 4) and those bytes after each standard record.
export function makeLas(points, {
  format = 0,                       // 0..3, 6..8 (what the reader supports)
  scale = [0.001, 0.001, 0.001],
  offset = [0, 0, 0],
  version = [1, 2],                 // [major, minor]; 1.4 → 375-byte header + u64 count
  extra = [],
} = {}) {
  const BASE = { 0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38 }[format];
  if (!BASE) throw new Error(`las-make: unsupported format ${format}`);
  const EB = [0, 1, 1, 2, 2, 4, 4, 8, 8, 4, 8];
  const SET = [null, 'setUint8', 'setInt8', 'setUint16', 'setInt16', 'setUint32', 'setInt32', 'setBigUint64', 'setBigInt64', 'setFloat32', 'setFloat64'];
  const RECLEN = BASE + extra.reduce((a, e) => a + EB[e.type], 0);
  const is14 = version[1] >= 4;
  const headerSize = is14 ? 375 : 227;
  const vlrLen = extra.length ? 54 + 192 * extra.length : 0;
  const n = points.length;
  const buf = new ArrayBuffer(headerSize + vlrLen + n * RECLEN);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // ── public header block ──
  u8.set([0x4C, 0x41, 0x53, 0x46], 0);                    // "LASF"
  dv.setUint8(24, version[0]); dv.setUint8(25, version[1]);
  dv.setUint16(94, headerSize, true);
  dv.setUint32(96, headerSize + vlrLen, true);            // offset to point data (after the VLRs)
  dv.setUint32(100, extra.length ? 1 : 0, true);          // VLR count
  dv.setUint8(104, format);
  dv.setUint16(105, RECLEN, true);
  dv.setUint32(107, is14 ? 0 : n, true);                  // legacy count (0 in 1.4 convention)
  for (let i = 0; i < 3; i++) {
    dv.setFloat64(131 + i * 8, scale[i], true);
    dv.setFloat64(155 + i * 8, offset[i], true);
  }
  // bbox: max/min interleaved per axis (maxX, minX, maxY, minY, maxZ, minZ)
  // (loop, not Math.max(...spread) — a spread of millions of points blows the call stack)
  const ext = (k) => {
    if (!points.length) return [0, 0];
    let mx = -Infinity, mn = Infinity;
    for (const p of points) { const v = p[k]; if (v > mx) mx = v; if (v < mn) mn = v; }
    return [mx, mn];
  };
  const [maxX, minX] = ext('x'), [maxY, minY] = ext('y'), [maxZ, minZ] = ext('z');
  [[maxX, minX], [maxY, minY], [maxZ, minZ]].forEach(([mx, mn], i) => {
    dv.setFloat64(179 + i * 16, mx, true);
    dv.setFloat64(187 + i * 16, mn, true);
  });
  if (is14) dv.setBigUint64(247, BigInt(n), true);        // 1.4 u64 point count

  // ── the extra-bytes VLR ──
  if (extra.length) {
    const v = headerSize;
    u8.set([...'LASF_Spec'].map((c) => c.charCodeAt(0)), v + 2);
    dv.setUint16(v + 18, 4, true);
    dv.setUint16(v + 20, 192 * extra.length, true);
    extra.forEach((e, k) => {
      const d = v + 54 + 192 * k;
      dv.setUint8(d + 2, e.type);
      dv.setUint8(d + 3, (e.noData != null ? 1 : 0) | (e.scale != null ? 8 : 0) | (e.offset != null ? 16 : 0));
      u8.set([...e.name].map((c) => c.charCodeAt(0)), d + 4);
      if (e.noData != null) { if (e.type >= 9) dv.setFloat64(d + 40, e.noData, true); else if (e.type % 2 === 0) dv.setBigInt64(d + 40, BigInt(e.noData), true); else dv.setBigUint64(d + 40, BigInt(e.noData), true); }
      if (e.scale != null) dv.setFloat64(d + 112, e.scale, true);
      if (e.offset != null) dv.setFloat64(d + 136, e.offset, true);
    });
  }

  // ── point records ──
  const rgbOff = { 2: 20, 3: 28, 7: 30, 8: 30 }[format];
  const gpsOff = { 1: 20, 3: 20, 6: 22, 7: 22, 8: 22 }[format];
  const clsOff = format >= 6 ? 16 : 15;
  const legacy = format < 6;
  points.forEach((p, i) => {
    const o = headerSize + vlrLen + i * RECLEN;
    if (legacy) {
      dv.setUint8(o + 14, ((p.ret || 0) & 7) | (((p.nret || 0) & 7) << 3));
      dv.setInt8(o + 16, p.scanAngle || 0); dv.setUint8(o + 17, p.userData || 0); dv.setUint16(o + 18, p.psid || 0, true);
    } else {
      dv.setUint8(o + 14, ((p.ret || 0) & 15) | (((p.nret || 0) & 15) << 4));
      dv.setUint8(o + 17, p.userData || 0); dv.setInt16(o + 18, Math.round((p.scanAngle || 0) / 0.006), true); dv.setUint16(o + 20, p.psid || 0, true);
    }
    if (gpsOff != null) dv.setFloat64(o + gpsOff, p.gps || 0, true);
    if (format === 8) dv.setUint16(o + 36, p.nir || 0, true);
    let at = o + BASE;
    for (const e of extra) {
      const val = p.extra && p.extra[e.name] != null ? p.extra[e.name] : (e.noData != null ? e.noData : 0);
      const raw = e.type >= 9 || e.noData === val ? val : Math.round((val - (e.offset || 0)) / (e.scale || 1));
      dv[SET[e.type]](at, e.type === 7 || e.type === 8 ? BigInt(raw) : raw, true);
      at += EB[e.type];
    }
    dv.setInt32(o, Math.round((p.x - offset[0]) / scale[0]), true);
    dv.setInt32(o + 4, Math.round((p.y - offset[1]) / scale[1]), true);
    dv.setInt32(o + 8, Math.round((p.z - offset[2]) / scale[2]), true);
    dv.setUint16(o + 12, p.intensity || 0, true);
    dv.setUint8(clsOff + o, p.classification || 0);
    if (rgbOff != null) {
      dv.setUint16(o + rgbOff, p.r || 0, true);
      dv.setUint16(o + rgbOff + 2, p.g || 0, true);
      dv.setUint16(o + rgbOff + 4, p.b || 0, true);
    }
  });
  return buf;
}

// A deterministic synthetic terrain patch (QF-ish bench + a pit wall) for bigger tests:
// n points over [x0,x0+w]×[y0,y0+h] with a sloped/stepped z and lognormal-ish intensity.
// PRNG is mulberry32 — NOT the naive LCG `s*1103515245 & 0x7fffffff`, whose f64
// multiply exceeds 2^53 and degenerates to a ~16k-value cycle (2M "random" points
// collapse onto 16k positions; found the hard way via a sparse render).
export function makeTerrainPoints(n, { x0 = 610000, y0 = 7760000, z0 = 900, w = 400, h = 400 } = {}) {
  let a = 42 >>> 0;
  const rnd = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    const bench = Math.floor(((x - x0) / w) * 5) * 10;          // 5 benches, 10 m steps
    const z = z0 - bench + Math.sin((y - y0) / 40) * 1.5 + rnd() * 0.3;
    pts[i] = { x, y, z, intensity: Math.floor(1000 + rnd() * rnd() * 50000), classification: 2 + (i % 3), r: Math.floor(rnd() * 65535), g: Math.floor(rnd() * 65535), b: Math.floor(rnd() * 65535) };
  }
  return pts;
}
