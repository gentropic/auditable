// @gcu/condenser — block-model chunks: IJK-exact representation (micro-spec §2.5).
//
// For a REGULAR uniform grid, a block's centroid is fully determined by its integer
// IJK: center = grid.originLocal + ijk · size, where originLocal is the CENTROID of
// block (0,0,0) — the centroid convention throughout. Chunks store raw uint16 IJK
// (not bbox-normalized lattice positions), so reconstruction is EXACT — and IJK is
// itself useful for the grid-view join. Half-dims are a chunk-level uniform (all
// blocks one size) for a REGULAR grid — 0 bytes per block. SUB-BLOCKED models use
// the same IJK scheme against a FINE lattice (grid/support.js: pitch = half the size
// step) plus each block's size in fine steps, chunk.dimQ = u8 × 3 per block (the
// block-support contract); centroids stay exact, half = dimQ · pitch / 2.
//
// Attributes per block: one SCALAR channel (grade — f32 in, quantized u16 against
// the chunk's min/max, range carried per chunk) + one CATEGORY channel (u8 codes
// from the provider's dictionary, ≤255 distinct) + uint32 record index (the join).
// The intra-chunk shuffle invariant (§2.1.4) applies unchanged.
//
// BlockChunk = {
//   kind: 'blocks', count,
//   grid: { originLocal: [x,y,z], size: [dx,dy,dz] },   — shared, frame-local
//   ijk: Uint16Array(3N), chan: Uint16Array(N), chanRange: [min,max],
//   cat: Uint8Array(N), recIdx: Uint32Array(N),
//   bboxLocal: Float64Array(6)                          — outer faces, for culling
//   dimQ?: Uint8Array(3N), dimQMax?: [3]                — sub-blocked: sizes in fine steps
// }

import { mulberry32, shuffleInPlace, shuffledIndices } from './chunks.js';
import { chanScale, chanCode } from './chan.js';
import { mortonKeys, radixSortIndices } from './morton.js';

// Grid from three axes + a frame → the block-chunk grid descriptor. origin here
// is the centroid of block (0,0,0), frame-local.
//
// ROTATED lattices (grid/basis.js): `rot` is the rotation R (column-major,
// columns = the unit U/V/W directions) and `anchor` the world point the lattice
// coordinates are measured from (block 0's centroid, canonically). The axes are
// then LATTICE coordinates q = Rᵀ·(p − anchor), where the lattice is
// axis-aligned; block (i,j,k)'s world centroid is anchor + R·(origin_q + ijk·pitch).
// An axis-aligned grid is rot = null, so every existing caller is unchanged.
export function makeBlockGrid(axes, frame, rot = null, anchor = null) {
  const o = frame.origin;
  const q0 = [axes[0].origin, axes[1].origin, axes[2].origin];
  const R = rot && !isIdentity3(rot) ? Array.from(rot) : null;
  let originLocal;
  if (R) {
    const A = anchor || [0, 0, 0];
    const d = [R[0] * q0[0] + R[3] * q0[1] + R[6] * q0[2], R[1] * q0[0] + R[4] * q0[1] + R[7] * q0[2], R[2] * q0[0] + R[5] * q0[1] + R[8] * q0[2]];
    originLocal = [(A[0] - o[0]) + d[0], (A[1] - o[1]) + d[1], (A[2] - o[2]) + d[2]];   // anchor − frame first: small numbers meet small numbers
  } else originLocal = [q0[0] - o[0], q0[1] - o[1], q0[2] - o[2]];
  const g = {
    originLocal,
    size: [axes[0].pitch || 1, axes[1].pitch || 1, axes[2].pitch || 1],
    count: [axes[0].count, axes[1].count, axes[2].count],
  };
  if (R) { g.rot = Float32Array.from(R); g.rotD = R; }       // f32 for the GPU, f64 for CPU math
  return g;
}
const isIdentity3 = (r) => Math.abs(r[0] - 1) < 1e-12 && Math.abs(r[4] - 1) < 1e-12 && Math.abs(r[8] - 1) < 1e-12
  && Math.abs(r[1]) < 1e-12 && Math.abs(r[2]) < 1e-12 && Math.abs(r[3]) < 1e-12 && Math.abs(r[5]) < 1e-12 && Math.abs(r[6]) < 1e-12 && Math.abs(r[7]) < 1e-12;

/**
 * Build one BlockChunk from columnar world-space block centroids + attributes.
 * `indices` = optional gather list (a Morton slice); shuffled like point chunks.
 * IJK is computed against the grid; anything off-lattice snaps to the nearest
 * cell (the provider validated regularity during discovery).
 */
export function buildBlockChunk({ x, y, z, chan, cat, recIdx, dimQ }, grid, frame, rnd, indices = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  const [gx, gy, gz] = grid.originLocal, [sx, sy, sz] = grid.size;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const ijk = new Uint16Array(3 * n);
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  const sub = !!dimQ;                                       // sub-blocked → per-block size in fine steps
  const outDimQ = sub ? new Uint8Array(3 * n) : null;
  let qmx = 0, qmy = 0, qmz = 0;
  // chan range over this chunk (quantize against it — per-chunk min/max, §2.1.2)
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = chanScale(cMin, cMax);                   // code 0 = blank, 1..65535 = min..max (chan.js)
  let minI = 65535, minJ = 65535, minK = 65535, maxI = 0, maxJ = 0, maxK = 0;
  // sub-blocked: the box faces in LATTICE units (doubled, so centre ± size stays integer) for the cull bbox
  let f0i = Infinity, f0j = Infinity, f0k = Infinity, f1i = -Infinity, f1j = -Infinity, f1k = -Infinity;
  const R = grid.rotD || null;                              // rotated lattice: IJK in the lattice frame
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    let bi, bj, bk;
    if (R) {
      const dx = x[i] - o[0] - gx, dy = y[i] - o[1] - gy, dz = z[i] - o[2] - gz;
      bi = Math.max(0, Math.round((R[0] * dx + R[1] * dy + R[2] * dz) / sx));
      bj = Math.max(0, Math.round((R[3] * dx + R[4] * dy + R[5] * dz) / sy));
      bk = Math.max(0, Math.round((R[6] * dx + R[7] * dy + R[8] * dz) / sz));
    } else {
      bi = Math.max(0, Math.round((x[i] - o[0] - gx) / sx));
      bj = Math.max(0, Math.round((y[i] - o[1] - gy) / sy));
      bk = Math.max(0, Math.round((z[i] - o[2] - gz) / sz));
    }
    ijk[k * 3] = bi; ijk[k * 3 + 1] = bj; ijk[k * 3 + 2] = bk;
    if (bi < minI) minI = bi; if (bi > maxI) maxI = bi;
    if (bj < minJ) minJ = bj; if (bj > maxJ) maxJ = bj;
    if (bk < minK) minK = bk; if (bk > maxK) maxK = bk;
    const cv = chan[i];
    outChan[k] = chanCode(cv, cMin, cScale);
    outCat[k] = cat ? cat[i] : 0;
    outR[k] = recIdx[i];
    if (sub) {
      const qx = dimQ[i * 3], qy = dimQ[i * 3 + 1], qz = dimQ[i * 3 + 2];
      outDimQ[k * 3] = qx; outDimQ[k * 3 + 1] = qy; outDimQ[k * 3 + 2] = qz;
      if (qx > qmx) qmx = qx; if (qy > qmy) qmy = qy; if (qz > qmz) qmz = qz;
      const ci = 2 * bi, cj = 2 * bj, ck = 2 * bk;
      if (ci - qx < f0i) f0i = ci - qx; if (ci + qx > f1i) f1i = ci + qx;
      if (cj - qy < f0j) f0j = cj - qy; if (cj + qy > f1j) f1j = cj + qy;
      if (ck - qz < f0k) f0k = ck - qz; if (ck + qz > f1k) f1k = ck + qz;
    }
  }
  // culling bbox = outer faces of the extreme blocks (variable-size when sub-blocked),
  // as a box in lattice cells; rotated: the world AABB of its 8 corners through R.
  const lo = sub ? [f0i / 2, f0j / 2, f0k / 2] : [minI - 0.5, minJ - 0.5, minK - 0.5];
  const hi = sub ? [f1i / 2, f1j / 2, f1k / 2] : [maxI + 0.5, maxJ + 0.5, maxK + 0.5];
  let bboxLocal;
  if (R) {
    bboxLocal = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (const ci of [lo[0], hi[0]]) for (const cj of [lo[1], hi[1]]) for (const ck of [lo[2], hi[2]]) {
      const u = ci * sx, v = cj * sy, w = ck * sz;
      const p = [gx + R[0] * u + R[3] * v + R[6] * w, gy + R[1] * u + R[4] * v + R[7] * w, gz + R[2] * u + R[5] * v + R[8] * w];
      for (let a = 0; a < 3; a++) { if (p[a] < bboxLocal[a]) bboxLocal[a] = p[a]; if (p[a] > bboxLocal[a + 3]) bboxLocal[a + 3] = p[a]; }
    }
  } else {
    bboxLocal = Float64Array.of(gx + lo[0] * sx, gy + lo[1] * sy, gz + lo[2] * sz, gx + hi[0] * sx, gy + hi[1] * sy, gz + hi[2] * sz);
  }
  const chunk = { kind: 'blocks', count: n, grid, ijk, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal };
  if (sub) { chunk.dimQ = outDimQ; chunk.dimQMax = [qmx, qmy, qmz]; }
  return chunk;
}

// Exact centroid of element k, frame-local (tests + picking).
export function blockLocalCenter(chunk, k) {
  const g = chunk.grid;
  const u = chunk.ijk[k * 3] * g.size[0], v = chunk.ijk[k * 3 + 1] * g.size[1], w = chunk.ijk[k * 3 + 2] * g.size[2];
  const R = g.rotD;
  if (R) return [g.originLocal[0] + R[0] * u + R[3] * v + R[6] * w, g.originLocal[1] + R[1] * u + R[4] * v + R[7] * w, g.originLocal[2] + R[2] * u + R[5] * v + R[8] * w];
  return [g.originLocal[0] + u, g.originLocal[1] + v, g.originLocal[2] + w];
}

// a batch's own random stream (seedPerBatch): batch k shuffles the same way
// whoever builds it and whatever was built before — what lets batches be built
// in parallel (micro's chunkworker) and still come out byte-identical
export const batchSeed = (seed, k) => (Math.imul(k + 1, 0x9E3779B1) ^ seed) >>> 0;

// ONE Morton batch → its chunks: sort the batch by Morton key, slice it into
// chunkSize pieces, build (and shuffle) each. cols = { x, y, z, chan, cat, dimQ,
// recIdx } of n records. The builder's batch step, exported so a worker can run it.
export function buildBlockBatch(cols, n, { grid, frame, chunkSize, rnd }) {
  const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
  const out = [];
  for (let start = 0; start < n; start += chunkSize) out.push(buildBlockChunk(cols, grid, frame, rnd, order.subarray(start, Math.min(start + chunkSize, n))));
  return out;
}

/**
 * Legacy size CODES (u8) + a half-dim palette — the Jupyter widget's wire format —
 * → dimQ (u8 × 3, fine steps of the grid's pitch). The engine draws dimQ only.
 */
export function dimQFromCodes(codes, palette, grid, n = codes.length) {
  const s = grid.size, lut = new Uint8Array(palette.length * 3);
  for (let c = 0; c < palette.length; c++) for (let a = 0; a < 3; a++) lut[c * 3 + a] = Math.max(1, Math.min(255, Math.round((2 * palette[c][a]) / s[a])));
  const out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) { const c = codes[i] < palette.length ? codes[i] : 0; out[i * 3] = lut[c * 3]; out[i * 3 + 1] = lut[c * 3 + 1]; out[i * 3 + 2] = lut[c * 3 + 2]; }
  return out;
}

/**
 * BlockChunkBuilder — same shape as createChunkBuilder but for block RawChunks
 * ({ count, x, y, z, chan: Float32Array|Float64Array, cat: Uint8Array|null,
 * dimQ: Uint8Array(3·count)|null, recStart }). Batch-Morton, sliced, shuffled.
 * Tracks the document chan range (for the color ramp) alongside the local bbox.
 * A sub-blocked raw chunk carries dimQ; `dimPalette` accepts the legacy code +
 * palette form (raw.dim, the widget's wire) and converts it (dimQFromCodes).
 */
// The size of the Morton batch that starts at record `start`. batchN everywhere, unless
// the builder knows the stream's `total`: then its last 2–3 batches' worth is cut into
// `tailPieces` equal smaller batches. A batch is built whole, after its last record
// arrives, so the open's tail — the time from the stream's end to the last chunk — is
// one batch's build; at 2M records that was ~1.2 s on a worker, a piece is a fraction
// of it, and several pieces build at once on a parallel builder. Deterministic (it
// depends on total alone), and the same rule here and in micro's parallel builder.
export function batchSizeAt(start, batchN, total = 0, tailPieces = 8) {
  if (!(total > 0) || !(tailPieces > 1)) return batchN;
  const tailStart = Math.max(0, Math.floor(total / batchN) - 2) * batchN;
  if (start < tailStart) return batchN;
  return Math.max(1, Math.ceil((total - tailStart) / tailPieces));
}
export function createBlockChunkBuilder({ frame, grid, dimPalette = null, chunkSize = 1 << 20, batchSize = 0, seed = 1, seedPerBatch = false, total = 0, tailPieces = 8, onChunk }) {
  let rnd = mulberry32(seed), batchNo = 0, cutAt = 0;
  const batchN0 = batchSize || chunkSize * 4;
  let batchN = batchSizeAt(0, batchN0, total, tailPieces);
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
    chanRange: [Infinity, -Infinity],
  };
  const concat = (Type, parts, per = 1) => {
    const out = new Type(pendCount * per);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((p) => p.x)),
      y: concat(Float64Array, pend.map((p) => p.y)),
      z: concat(Float64Array, pend.map((p) => p.z)),
      chan: concat(Float64Array, pend.map((p) => p.chan)),
      cat: pend.every((p) => p.cat) ? concat(Uint8Array, pend.map((p) => p.cat)) : null,
      dimQ: pend.every((p) => p.dimQ) ? concat(Uint8Array, pend.map((p) => p.dimQ), 3) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    cutAt += n; batchN = batchSizeAt(cutAt, batchN0, total, tailPieces);
    if (seedPerBatch) rnd = mulberry32(batchSeed(seed, batchNo));
    batchNo++;
    for (const chunk of buildBlockBatch(cols, n, { grid, frame, chunkSize, rnd })) {
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      if (chunk.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = chunk.chanRange[0];
      if (chunk.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = chunk.chanRange[1];
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      // record indices: the provider may supply raw.recIdx directly (RAW record
      // numbers, gaps allowed — .dm skips bad rows but keeps true row numbers so
      // O(1) record fetch works); default = recStart + i (gapless providers).
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i;
      }
      const dimQ = raw.dimQ || (raw.dim && dimPalette ? dimQFromCodes(raw.dim, dimPalette, grid, raw.count) : null);
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), dimQ: dimQ ? dimQ.subarray(taken * 3, (taken + n) * 3) : null, recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}
