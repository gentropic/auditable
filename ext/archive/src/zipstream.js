// Ranged / streaming ZIP — the large-file path (zip.js is the fflate one, whole
// archives in memory, no Zip64).
//
// Reader: the central directory is read from the END (EOCD → Zip64 EOCD →
// directory), then each member by byte range, so a multi-GB archive is never
// read whole. Members stream out through stored or deflate (the platform's
// DecompressionStream — a zip re-made by an OS tool still opens), with the
// CRC-32 and size checked as the bytes go by.
//
// Writer: STORED members, Zip64 whenever a size, offset or count needs it,
// optional data alignment. A member of unknown size or CRC streams through
// begin()/write()/end() with a data descriptor, so nothing is held whole.
//
// Ported from @gcu/wireframe's zip.js (the .wfr container), which keeps its
// own copy: it's a standalone repo with no dependencies.

// ── sources: { size, read(offset, length) → Promise<Uint8Array> } ──
export function bytesSource(u8) {
  return { size: u8.length, read: async (off, len) => u8.subarray(off, off + len) };
}
export function blobSource(blob) {
  return { size: blob.size, read: async (off, len) => new Uint8Array(await blob.slice(off, off + len).arrayBuffer()) };
}

const _zsU16 = (b, p) => b[p] | (b[p + 1] << 8);
const _zsU32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const _zsU64 = (b, p) => _zsU32(b, p) + _zsU32(b, p + 4) * 4294967296;
const _zsTd = new TextDecoder();
const _zsTe = new TextEncoder();
const _ZS_MAX32 = 0xffffffff;
const _ZS_CHUNK = 4 * 1024 * 1024;

// ── CRC-32 (slice-by-8) ──
const _ZS_CRC = (() => {
  const t = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  for (let n = 0; n < 256; n++) for (let s = 1; s < 8; s++) t[s * 256 + n] = (t[(s - 1) * 256 + n] >>> 8) ^ t[t[(s - 1) * 256 + n] & 255];
  return t;
})();
export function crc32(b, crc = 0) {
  const T = _ZS_CRC;
  let c = ~crc >>> 0, i = 0;
  const n8 = b.length & ~7;
  for (; i < n8; i += 8) {
    const lo = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) ^ c;
    c = T[1792 + (lo & 255)] ^ T[1536 + ((lo >>> 8) & 255)] ^ T[1280 + ((lo >>> 16) & 255)] ^ T[1024 + (lo >>> 24)] ^
      T[768 + b[i + 4]] ^ T[512 + b[i + 5]] ^ T[256 + b[i + 6]] ^ T[b[i + 7]];
  }
  for (; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

// ── reader ──
// → { entries: Map(name → entry), list(), dataRange(entry), stream(entry), bytes(entry) }
// entry = { name, method, crc, size, csize, localOffset, mtime (ms), dir }
export async function openZipRanged(src) {
  const tailLen = Math.min(src.size, 65557 + 20);
  const tail = await src.read(src.size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (_zsU32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip: no end-of-central-directory record (not a zip, or truncated)');
  let count = _zsU16(tail, e + 10), cdSize = _zsU32(tail, e + 12), cdOff = _zsU32(tail, e + 16);
  if (e >= 20 && _zsU32(tail, e - 20) === 0x07064b50) {
    const z64 = _zsU64(tail, e - 20 + 8);
    const rec = await src.read(z64, 56);
    if (_zsU32(rec, 0) !== 0x06064b50) throw new Error('zip: bad zip64 end-of-central-directory');
    count = _zsU64(rec, 32); cdSize = _zsU64(rec, 40); cdOff = _zsU64(rec, 48);
  }
  if (cdOff + cdSize > src.size) throw new Error('zip: central directory runs past the end (truncated)');
  const cd = await src.read(cdOff, cdSize);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (_zsU32(cd, p) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const flags = _zsU16(cd, p + 8), method = _zsU16(cd, p + 10), crc = _zsU32(cd, p + 16);
    const dosTime = _zsU16(cd, p + 12), dosDate = _zsU16(cd, p + 14);
    let csize = _zsU32(cd, p + 20), usize = _zsU32(cd, p + 24), lho = _zsU32(cd, p + 42);
    const nlen = _zsU16(cd, p + 28), elen = _zsU16(cd, p + 30), clen = _zsU16(cd, p + 32);
    const name = _zsTd.decode(cd.subarray(p + 46, p + 46 + nlen));
    let x = p + 46 + nlen; const xe = x + elen;
    while (x + 4 <= xe) {
      const id = _zsU16(cd, x), sz = _zsU16(cd, x + 2); let q = x + 4;
      if (id === 1) {
        if (usize === _ZS_MAX32) { usize = _zsU64(cd, q); q += 8; }
        if (csize === _ZS_MAX32) { csize = _zsU64(cd, q); q += 8; }
        if (lho === _ZS_MAX32) { lho = _zsU64(cd, q); q += 8; }
      }
      x += 4 + sz;
    }
    const mtime = new Date(1980 + (dosDate >> 9), ((dosDate >> 5) & 15) - 1, dosDate & 31, dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2).getTime();
    entries.set(name, { name, method, flags, crc, size: usize, csize, localOffset: lho, mtime, dir: name.endsWith('/') });
    p = xe + clen;
  }
  async function dataRange(entry) {
    if (entry.dataOffset === undefined) {
      const lh = await src.read(entry.localOffset, 30);
      if (_zsU32(lh, 0) !== 0x04034b50) throw new Error(`zip: bad local header for ${entry.name}`);
      entry.dataOffset = entry.localOffset + 30 + _zsU16(lh, 26) + _zsU16(lh, 28);
    }
    return { offset: entry.dataOffset, size: entry.csize };
  }
  // the member's bytes as a ReadableStream, decompressed, CRC + size checked at the end
  function stream(entry, { verify = true } = {}) {
    if (entry.flags & 1) throw new Error(`zip: ${entry.name} is encrypted`);
    if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip: ${entry.name} uses compression method ${entry.method} (only stored and deflate are read)`);
    let pos = 0, range = null;
    const raw = new ReadableStream({
      async pull(ctl) {
        if (!range) range = await dataRange(entry);
        if (pos >= range.size) { ctl.close(); return; }
        const n = Math.min(_ZS_CHUNK, range.size - pos);
        const c = await src.read(range.offset + pos, n);
        pos += n; ctl.enqueue(c);
      },
    });
    const decoded = entry.method === 8 ? raw.pipeThrough(new DecompressionStream('deflate-raw')) : raw;
    if (!verify) return decoded;
    let crc = 0, n = 0;
    return decoded.pipeThrough(new TransformStream({
      transform(c, ctl) { crc = crc32(c, crc); n += c.length; ctl.enqueue(c); },
      flush() {
        if (n !== entry.size) throw new Error(`zip: ${entry.name} is ${n} bytes, the directory says ${entry.size} (damaged)`);
        if (crc !== entry.crc) throw new Error(`zip: ${entry.name} fails its CRC check (damaged)`);
      },
    }));
  }
  async function bytes(entry, opts) {
    const out = new Uint8Array(entry.size); let o = 0;
    const r = stream(entry, opts).getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; out.set(value, o); o += value.length; }
    return out;
  }
  return { entries, list: () => [...entries.values()], dataRange, stream, bytes, cdOffset: cdOff };
}

// ── writer ──
// sink: { write(Uint8Array) → void|Promise } or a WritableStream. Members are STORED.
// A member's mtime (ms) becomes its DOS timestamp; absent = 1980-01-01, so an
// archive written without them is byte-deterministic.
function _zsLe(view, p, v, bytes) { for (let i = 0; i < bytes; i++) { view[p + i] = v % 256; v = Math.floor(v / 256); } }
function _zsDos(ms) {
  if (ms == null) return { time: 0, date: 0x21 };
  const d = new Date(ms), y = d.getFullYear();
  if (y < 1980) return { time: 0, date: 0x21 };
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export function createZipStreamWriter(sink, { align = 1 } = {}) {
  let closeAtFinish = null;                                // a WritableStream is ours to close; a {write} sink is the caller's
  if (typeof WritableStream !== 'undefined' && sink instanceof WritableStream) {
    const w = sink.getWriter();
    sink = { write: (b) => w.write(b) }; closeAtFinish = () => w.close();
  }
  let offset = 0;
  const cd = [];
  const put = async (b) => { await sink.write(b); offset += b.length; };
  // Local header. Streamed members carry a Zip64 extra with zero sizes; the descriptor has them.
  const localHeader = (nameB, { size = 0, crc = 0, streamed, aligned, dos }) => {
    const big = streamed || size >= _ZS_MAX32;
    const z64 = big ? 20 : 0;
    let pad = 0;
    const doAlign = aligned && align > 1;
    if (doAlign) {
      const base = offset + 30 + nameB.length + z64 + 6;   // + 0xD935 record header (4) + alignment (2)
      pad = (align - (base % align)) % align;
    }
    const elen = z64 + (doAlign ? 6 + pad : 0);
    const h = new Uint8Array(30 + nameB.length + elen);
    _zsLe(h, 0, 0x04034b50, 4); _zsLe(h, 4, big ? 45 : 20, 2); _zsLe(h, 6, streamed ? 0x0808 : 0x0800, 2); _zsLe(h, 8, 0, 2);
    _zsLe(h, 10, dos.time, 2); _zsLe(h, 12, dos.date, 2); _zsLe(h, 14, streamed ? 0 : crc, 4);
    _zsLe(h, 18, big ? _ZS_MAX32 : size, 4); _zsLe(h, 22, big ? _ZS_MAX32 : size, 4);
    _zsLe(h, 26, nameB.length, 2); _zsLe(h, 28, elen, 2); h.set(nameB, 30);
    let x = 30 + nameB.length;
    if (big) { _zsLe(h, x, 1, 2); _zsLe(h, x + 2, 16, 2); _zsLe(h, x + 4, streamed ? 0 : size, 8); _zsLe(h, x + 12, streamed ? 0 : size, 8); x += 20; }
    if (doAlign) { _zsLe(h, x, 0xd935, 2); _zsLe(h, x + 2, 2 + pad, 2); _zsLe(h, x + 4, align, 2); }
    return h;
  };
  return {
    get offset() { return offset; },
    // a whole member at once
    async add(name, data, opts = {}) {
      if (typeof data === 'string') data = _zsTe.encode(data);
      return this.addChunks(name, data.length, crc32(data), [data], opts);
    },
    // a member whose size and CRC are known, written from an (async) iterable of chunks
    async addChunks(name, size, crc, chunks, { aligned = true, mtime } = {}) {
      const nameB = _zsTe.encode(name), localOffset = offset, dos = _zsDos(mtime);
      await put(localHeader(nameB, { size, crc, streamed: false, aligned, dos }));
      let n = 0;
      for await (const c of chunks) { await put(c); n += c.length; }
      if (n !== size) throw new Error(`zip: member ${name} wrote ${n} bytes, declared ${size}`);
      cd.push({ nameB, size, crc, localOffset, flags: 0x0800, dos });
      return { size, crc };
    },
    // a member of unknown size: data descriptor (flag bit 3) + Zip64 sizes after the data
    begin(name, { aligned = true, mtime } = {}) {
      const nameB = _zsTe.encode(name), localOffset = offset, dos = _zsDos(mtime);
      let crc = 0, size = 0, started = false;
      const start = async () => { if (!started) { started = true; await put(localHeader(nameB, { streamed: true, aligned, dos })); } };
      return {
        async write(c) { await start(); crc = crc32(c, crc); size += c.length; await put(c); },
        async end() {
          await start();
          const d = new Uint8Array(24);
          _zsLe(d, 0, 0x08074b50, 4); _zsLe(d, 4, crc, 4); _zsLe(d, 8, size, 8); _zsLe(d, 16, size, 8);
          await put(d);
          cd.push({ nameB, size, crc, localOffset, flags: 0x0808, dos });
          return { size, crc };
        },
      };
    },
    // a whole stream as one member (Blob.stream(), a File's, a fetch body…)
    async addStream(name, readable, opts = {}) {
      const m = this.begin(name, opts);
      const r = readable.getReader();
      for (;;) { const { done, value } = await r.read(); if (done) break; await m.write(value); }
      return m.end();
    },
    async finish() {
      const cdStart = offset;
      for (const e of cd) {
        const needSize = e.size >= _ZS_MAX32, needOff = e.localOffset >= _ZS_MAX32;
        const z = (needSize ? 16 : 0) + (needOff ? 8 : 0);
        const elen = z ? 4 + z : 0;
        const h = new Uint8Array(46 + e.nameB.length + elen);
        _zsLe(h, 0, 0x02014b50, 4); _zsLe(h, 4, 45, 2); _zsLe(h, 6, z || e.flags & 8 ? 45 : 20, 2); _zsLe(h, 8, e.flags, 2); _zsLe(h, 10, 0, 2);
        _zsLe(h, 12, e.dos.time, 2); _zsLe(h, 14, e.dos.date, 2); _zsLe(h, 16, e.crc, 4);
        _zsLe(h, 20, needSize ? _ZS_MAX32 : e.size, 4); _zsLe(h, 24, needSize ? _ZS_MAX32 : e.size, 4);
        _zsLe(h, 28, e.nameB.length, 2); _zsLe(h, 30, elen, 2); _zsLe(h, 32, 0, 2); _zsLe(h, 34, 0, 2); _zsLe(h, 36, 0, 2); _zsLe(h, 38, 0, 4);
        _zsLe(h, 42, needOff ? _ZS_MAX32 : e.localOffset, 4); h.set(e.nameB, 46);
        if (z) {
          let x = 46 + e.nameB.length;
          _zsLe(h, x, 1, 2); _zsLe(h, x + 2, z, 2); x += 4;
          if (needSize) { _zsLe(h, x, e.size, 8); _zsLe(h, x + 8, e.size, 8); x += 16; }
          if (needOff) _zsLe(h, x, e.localOffset, 8);
        }
        await put(h);
      }
      const cdSize = offset - cdStart;
      const z64 = cd.length > 0xffff || cdStart >= _ZS_MAX32 || cdSize >= _ZS_MAX32;
      if (z64) {
        const r = new Uint8Array(56 + 20), zOff = offset;
        _zsLe(r, 0, 0x06064b50, 4); _zsLe(r, 4, 44, 8); _zsLe(r, 12, 45, 2); _zsLe(r, 14, 45, 2); _zsLe(r, 16, 0, 4); _zsLe(r, 20, 0, 4);
        _zsLe(r, 24, cd.length, 8); _zsLe(r, 32, cd.length, 8); _zsLe(r, 40, cdSize, 8); _zsLe(r, 48, cdStart, 8);
        _zsLe(r, 56, 0x07064b50, 4); _zsLe(r, 60, 0, 4); _zsLe(r, 64, zOff, 8); _zsLe(r, 72, 1, 4);
        await put(r);
      }
      const eo = new Uint8Array(22);
      _zsLe(eo, 0, 0x06054b50, 4); _zsLe(eo, 4, 0, 2); _zsLe(eo, 6, 0, 2);
      _zsLe(eo, 8, z64 ? 0xffff : cd.length, 2); _zsLe(eo, 10, z64 ? 0xffff : cd.length, 2);
      _zsLe(eo, 12, z64 ? _ZS_MAX32 : cdSize, 4); _zsLe(eo, 16, z64 ? _ZS_MAX32 : cdStart, 4); _zsLe(eo, 20, 0, 2);
      await put(eo);
      if (closeAtFinish) await closeAtFinish();
      return { size: offset, count: cd.length };
    },
  };
}
