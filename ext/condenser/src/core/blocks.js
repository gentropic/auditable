// @gcu/condenser — block-model chunks: IJK-exact representation (micro-spec §2.5).
//
// For a REGULAR uniform grid, a block's centroid is fully determined by its integer
// IJK: center = grid.originLocal + ijk · size, where originLocal is the CENTROID of
// block (0,0,0) — the centroid convention throughout. Chunks store raw uint16 IJK
// (not bbox-normalized lattice positions), so reconstruction is EXACT — and IJK is
// itself useful for the grid-view join. Half-dims are a chunk-level uniform (all
// blocks one size) for a REGULAR grid. SUB-BLOCKED models use the same IJK scheme
// against a FINE lattice (pitch = min dim /2) plus a per-block u8 size code into a
// shared half-dim palette (chunk.dim + chunk.dimPalette); centroids stay exact.
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
// }

import { mulberry32, shuffleInPlace, shuffledIndices } from './chunks.js';
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
export function buildBlockChunk({ x, y, z, chan, cat, recIdx, dim }, grid, frame, rnd, indices = null, dimPalette = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  const [gx, gy, gz] = grid.originLocal, [sx, sy, sz] = grid.size;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const ijk = new Uint16Array(3 * n);
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  const sub = !!(dim && dimPalette);                        // sub-blocked → per-block size code
  const outDim = sub ? new Uint8Array(n) : null;
  // chan range over this chunk (quantize against it — per-chunk min/max, §2.1.2)
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = cMax > cMin ? 65535 / (cMax - cMin) : 0;
  let minI = 65535, minJ = 65535, minK = 65535, maxI = 0, maxJ = 0, maxK = 0;
  // sub-blocked: track actual box faces (variable half-dims) for the cull bbox
  let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity;
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
    outChan[k] = Number.isFinite(cv) ? ((cv - cMin) * cScale + 0.5) | 0 : 0;
    outCat[k] = cat ? cat[i] : 0;
    outR[k] = recIdx[i];
    if (sub) {
      const dc = dim[i]; outDim[k] = dc;
      const h = dimPalette[dc] || [sx / 2, sy / 2, sz / 2];
      const cx = gx + bi * sx, cy = gy + bj * sy, cz = gz + bk * sz;
      if (cx - h[0] < fx0) fx0 = cx - h[0]; if (cx + h[0] > fx1) fx1 = cx + h[0];
      if (cy - h[1] < fy0) fy0 = cy - h[1]; if (cy + h[1] > fy1) fy1 = cy + h[1];
      if (cz - h[2] < fz0) fz0 = cz - h[2]; if (cz + h[2] > fz1) fz1 = cz + h[2];
    }
  }
  // culling bbox = outer faces of the extreme blocks (variable-size when sub-blocked).
  // Rotated: the world AABB of the chunk's IJK box (its 8 corners through R).
  let bboxLocal;
  if (R) {
    bboxLocal = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (const ci of [minI - 0.5, maxI + 0.5]) for (const cj of [minJ - 0.5, maxJ + 0.5]) for (const ck of [minK - 0.5, maxK + 0.5]) {
      const u = ci * sx, v = cj * sy, w = ck * sz;
      const p = [gx + R[0] * u + R[3] * v + R[6] * w, gy + R[1] * u + R[4] * v + R[7] * w, gz + R[2] * u + R[5] * v + R[8] * w];
      for (let a = 0; a < 3; a++) { if (p[a] < bboxLocal[a]) bboxLocal[a] = p[a]; if (p[a] > bboxLocal[a + 3]) bboxLocal[a + 3] = p[a]; }
    }
  } else {
    bboxLocal = sub
      ? Float64Array.of(fx0, fy0, fz0, fx1, fy1, fz1)
      : Float64Array.of(
          gx + minI * sx - sx / 2, gy + minJ * sy - sy / 2, gz + minK * sz - sz / 2,
          gx + maxI * sx + sx / 2, gy + maxJ * sy + sy / 2, gz + maxK * sz + sz / 2,
        );
  }
  const chunk = { kind: 'blocks', count: n, grid, ijk, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal };
  if (sub) { chunk.dim = outDim; chunk.dimPalette = dimPalette; }
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

/**
 * BlockChunkBuilder — same shape as createChunkBuilder but for block RawChunks
 * ({ count, x, y, z, chan: Float32Array|Float64Array, cat: Uint8Array|null,
 * recStart }). Batch-Morton, sliced, shuffled. Tracks the document chan range
 * (for the color ramp) alongside the local bbox.
 */
export function createBlockChunkBuilder({ frame, grid, dimPalette = null, chunkSize = 1 << 20, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
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
      dim: dimPalette && pend.every((p) => p.dim) ? concat(Uint8Array, pend.map((p) => p.dim)) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildBlockChunk(cols, grid, frame, rnd, slice, dimPalette);
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
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), dim: s(raw.dim), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}
