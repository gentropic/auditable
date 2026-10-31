// Source identity by CONTENT — a sampled hash of a file's bytes.
//
// Every derived thing micro keeps beside a source (materialized and painted columns,
// the discovery/stats sidecar, the grid display cache, the pinned-column cache) must
// know whether the source is still the file it was made from. Size (+ row count)
// misses a same-size edit; size + mtime breaks on the most ordinary workflow there
// is, because micro COPIES sources into the project and a copy gets a new mtime with
// identical bytes. A content hash holds across a copy and catches an edit — and
// sampled (the head, the tail, eight blocks between) it costs ~160 KB of reads at
// any file size, so a multi-GB model is never read whole for it. An edit confined
// entirely to unsampled bytes that also keeps the size goes unseen; that is the
// price of not reading the file, and it is far narrower than size alone.
//
// Hashed once per Blob and cached (a reload, reinterpret or conversion is a new
// Blob → a new hash for free). sourceHashSync reads the cache for the synchronous
// call sites; the async paths that WRITE or COMPARE an identity await sourceHash first.

const HEAD = 1 << 16, TAIL = 1 << 16, MID = 1 << 12, NMID = 8;
const WHOLE = HEAD + TAIL + NMID * MID;                     // smaller files are hashed whole
const _hashes = new WeakMap();                              // Blob → hex | Promise<hex>

// two independent 32-bit lanes over the bytes (cyrb53's mixing, fed bytes) → 16 hex
function _idMix(h1, h2, u8) {
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return [h1, h2];
}
function _idHex(h1, h2) {
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
// the byte ranges sampled from a file of `size` bytes, in order
export function sampleRanges(size) {
  if (size <= WHOLE) return [[0, size]];
  const r = [[0, HEAD]];
  const span = size - HEAD - TAIL - MID;
  for (let i = 1; i <= NMID; i++) { const at = HEAD + Math.floor(span * i / (NMID + 1)); r.push([at, at + MID]); }
  r.push([size - TAIL, size]);
  return r;
}
async function _idCompute(blob) {
  let h1 = 0xdeadbeef ^ blob.size, h2 = 0x41c6ce57 ^ Math.floor(blob.size / 4294967296);
  for (const [a, b] of sampleRanges(blob.size)) [h1, h2] = _idMix(h1, h2, new Uint8Array(await blob.slice(a, b).arrayBuffer()));
  return _idHex(h1, h2);
}
export function sourceHash(blob) {
  if (!blob || typeof blob.slice !== 'function') return Promise.resolve(null);
  const got = _hashes.get(blob);
  if (got) return typeof got === 'string' ? Promise.resolve(got) : got;
  const p = _idCompute(blob).then((h) => { _hashes.set(blob, h); return h; }, () => { _hashes.delete(blob); return null; });
  _hashes.set(blob, p);
  return p;
}
export function sourceHashSync(blob) { const h = blob && _hashes.get(blob); return typeof h === 'string' ? h : null; }

// identity strings are "size:rows" (before content hashes) or "size:rows:hash".
// Same source = the same size and rows, and — when BOTH carry a hash — the same
// hash. One side without a hash compares what it has, so derived files written
// before this keep loading (dropping them would discard hand paint).
export function sameSource(stored, current) {
  if (stored == null || current == null) return true;
  const a = String(stored).split(':'), b = String(current).split(':');
  if (a[0] !== b[0] || a[1] !== b[1]) return false;
  return !(a[2] && b[2]) || a[2] === b[2];
}
// why stored columns no longer fit: the same bytes read as a different number of
// records (the record rule changed — e.g. rows with a blank coordinate are no
// records now) or a different file
export function staleWhy(stored, current) {
  const a = String(stored).split(':'), b = String(current).split(':');
  return a[0] === b[0] && a[1] !== b[1] && (!(a[2] && b[2]) || a[2] === b[2]) ? `the same file now reads as ${b[1]} records, not ${a[1]}` : 'source changed';
}
// a cache sidecar ({ size, mtime?, hash? }) against the file it sits beside: the
// hash decides when both have one (a byte-identical copy matches whatever its
// mtime); otherwise the mtime, as before
export function sidecarMatches(j, file, fileHash) {
  if (!j || j.size !== file.size) return false;
  if (j.hash && fileHash) return j.hash === fileHash;
  return !j.mtime || j.mtime === file.lastModified;
}
