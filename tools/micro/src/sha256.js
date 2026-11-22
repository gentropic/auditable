// micro SHA-256 — the full hash of a file, streamed, for run records (routines v2 step 3). WebCrypto
// can't digest a stream, and a block model is gigabytes, so this is the FIPS 180-4 algorithm in plain
// JS (WASM-free, Sealed-safe), fed chunk by chunk from Blob.stream() — never the whole file in memory.
// SHA-256 because anyone can check it with `sha256sum`.
//
// It runs in a WORKER built from this file's own class text (a blob URL), so hashing a 5 GB model
// (~35 s at ~150 MB/s) doesn't freeze the page; where a worker can't start it runs on the page with
// a yield per chunk. Results are cached per file by (name, size, lastModified): a changed file is
// hashed again, an unchanged one never (the copy a project save makes gets a new mtime — that costs
// one re-hash, never a wrong one).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64); this.bufLen = 0; this.total = 0; this.w = new Uint32Array(64);
  }
  update(data) {
    const end = data.length; this.total += end;
    let i = 0;
    if (this.bufLen) {
      while (i < end && this.bufLen < 64) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    while (i + 64 <= end) { this._block(data, i); i += 64; }
    while (i < end) this.buf[this.bufLen++] = data[i++];
    return this;
  }
  hex() {
    const total = this.total, bits = total * 8;
    const pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8), n = pad.length;
    pad[0] = 0x80;
    const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
    this.update(pad); this.total = total;
    let s = ''; for (let j = 0; j < 8; j++) s += (this.h[j] >>> 0).toString(16).padStart(8, '0');
    return s;
  }
  _block(d, o) {
    const w = this.w, h = this.h, k = this.k || (this.k = Sha256.K);
    for (let t = 0; t < 16; t++) w[t] = (d[o + t * 4] << 24) | (d[o + t * 4 + 1] << 16) | (d[o + t * 4 + 2] << 8) | d[o + t * 4 + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + k[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += dd; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
}
Sha256.K = K;

// stream a Blob through the hash (on whichever thread this runs)
async function digestBlob(blob, yieldEach) {
  const sh = new Sha256(), rd = blob.stream().getReader();
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    sh.update(value);
    if (yieldEach) await new Promise((r) => setTimeout(r));
  }
  return sh.hex();
}

let _worker = null, _wSeq = 0;
const _wJobs = new Map();
function hashWorker() {
  if (_worker !== null) return _worker;
  try {
    const src = `const K = new Uint32Array([${[...K].join(',')}]);\nconst Sha256 = ${Sha256.toString()};\nSha256.K = K;\n${digestBlob.toString()}\n`
      + 'self.onmessage = async (e) => { const { id, blob } = e.data; try { self.postMessage({ id, hex: await digestBlob(blob, false) }); } catch (err) { self.postMessage({ id, err: String(err && err.message || err) }); } };';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    _worker = new Worker(url);
    _worker.onmessage = (e) => { const j = _wJobs.get(e.data.id); if (!j) return; _wJobs.delete(e.data.id); if (e.data.err) j.rej(new Error(e.data.err)); else j.res(e.data.hex); };
    _worker.onerror = () => { for (const j of _wJobs.values()) j.fallback(); _wJobs.clear(); _worker = false; };
  } catch { _worker = false; }                                // a CSP without blob workers: the page does it
  return _worker;
}

const _cache = new Map();                                     // "name|size|mtime" → Promise<hex>
const keyOf = (b) => `${b.name || ''}|${b.size}|${b.lastModified || 0}`;

// the SHA-256 of a Blob / File, hex. Cached by (name, size, lastModified).
export function sha256File(blob) {
  if (!blob || typeof blob.stream !== 'function') return Promise.resolve(null);
  const k = keyOf(blob), hit = _cache.get(k);
  if (hit) return hit;
  const onPage = () => digestBlob(blob, true);
  const w = hashWorker();
  const p = w ? new Promise((res, rej) => { const id = ++_wSeq; _wJobs.set(id, { res, rej, fallback: () => onPage().then(res, rej) }); w.postMessage({ id, blob }); }) : onPage();
  const q = p.catch((e) => { _cache.delete(k); throw e; });
  _cache.set(k, q);
  return q;
}
// a string's SHA-256 (a routine file's text, a written report) — small, on the page
export function sha256Text(s) { return new Sha256().update(new TextEncoder().encode(String(s))).hex(); }
