// @gcu/condenser — Datamine .dm block-model provider, over @gcu/dm's windowed
// reader (micro-spec Addendum A.2). The DD page carries the grid definition as
// implicit constants (XMORIG/YMORIG/ZMORIG corner origin, XINC/YINC/ZINC block
// dims, NX/NY/NZ counts), so — unlike CSV — there is NO discovery sweep: grid,
// bbox, and schema are known from the first page. Centroids come from XC/YC/ZC
// per-record fields; the centroid of block (0,0,0) is MORIG + INC/2.
//
// Record indices are RAW record numbers (rows with missing coordinates are
// skipped but their numbers are not reused), so recordRange gives O(1) fetch of
// any picked record. Categories (first alpha column) build their dictionary
// incrementally during the single streaming sweep (≤255 distinct).
//
// Regular models (INC as DD constants) need no sweep; SUB-BLOCKED models (per-record
// XINC/YINC/ZINC) get a discovery sweep → the fine lattice + per-block dimQ
// (grid/support.js). A ROTATED model with a single rotation about Z (ANGLE1 about
// ROTAXIS1 = 3) is placed in world coordinates (world = O + R·(XC,YC,ZC), the
// convention verified on a real Isatis.neo export); two or three rotations are
// reported, not applied (their order convention is unverified).

import { detectDM, parseHeader, recordRange, decodeRecord, readField } from '../../../dm/src/dm.js';
import { inferAxis, inferSubBlockLattice, axisDistinct } from '../grid/infer.js';
import { detectRotatedLattice, detectRotatedOverAxisGrid } from '../grid/basis.js';
import { sizeCollector, putDimQ, pitchOf, datamineRotZ, placeDmColumns, placeDmRow } from '../grid/support.js';

// PROJECTED batches over any .dm — decode only the requested column indices by
// striding each field's fixed word-offset across records (no whole-record decode,
// no per-row allocation), ~4 MB page runs at a time, never the whole file. Numeric
// col → Float64Array (NaN = missing); alpha col → string[] (''=missing); constants
// come free from the header. Yields { recStart, count, cols } where cols[idx] is the
// array for column `idx`, RAW record numbering (recStart + k over ALL records).
// The page RUNS a column read walks: ~4 MB of pages each, with the records they
// hold. One definition — the generator below and a parallel scan (micro's worker
// pool) cut the file the same way, so a run is the same unit everywhere (and a
// sidecar band check asked of a run means the same records).
export function dmPageRuns(h) {
  const pagesPer = Math.max(1, Math.floor((4 << 20) / h.pageSize));
  const runs = [];
  for (let page = 2; page <= h.lastPage; page += pagesPer) {
    const pEnd = Math.min(page + pagesPer - 1, h.lastPage);
    let count = 0;
    for (let pg = page; pg <= pEnd; pg++) count += pg === h.lastPage ? h.lastRec : h.recordsPerPage;
    runs.push({ page, pEnd, start: (page - 2) * h.recordsPerPage, count });
  }
  return runs;
}
// ONE run's requested fields, by striding (only those fields are decoded):
// → { recStart, count, cols: { [colIdx]: Float64Array (blank = NaN) | string[] (blank = '') } }
// place (a header's dmPlace — a rotated model placed in world): the coordinate
// fields come back in WORLD (read even when not asked for — all three are needed).
export async function readDmRun(blob, h, colIdxs, run, place = null) {
  const ids = [...new Set(place && colIdxs.some((i) => i === place.x || i === place.y || i === place.z) ? [...colIdxs, place.x, place.y, place.z] : colIdxs)];
  const cols = ids.map((i) => h.columns[i]), alpha = cols.map((c) => c.type === 'A');
  const bytes = new Uint8Array(await blob.slice((run.page - 1) * h.pageSize, run.pEnd * h.pageSize).arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = run.count;
  const out = cols.map((c, ci) => (alpha[ci] ? new Array(total) : new Float64Array(total)));
  let w = 0;
  for (let pg = run.page; pg <= run.pEnd; pg++) {
    const nRec = pg === h.lastPage ? h.lastRec : h.recordsPerPage, pageBase = (pg - run.page) * h.pageSize;
    for (let r = 0; r < nRec; r++) {
      const recBase = pageBase + r * h.maxLen * h.wordSize;
      for (let ci = 0; ci < cols.length; ci++) { const v = readField(dv, h, cols[ci], recBase); out[ci][w] = alpha[ci] ? (v == null ? '' : v) : (v == null ? NaN : v); }
      w++;
    }
  }
  const cobj = {}; ids.forEach((idx, ci) => { cobj[idx] = out[ci]; });
  if (place) placeDmColumns(place, cobj, total);
  return { recStart: run.start, count: total, cols: cobj };
}
// opts.shouldRead(recStart, count): PUSHDOWN hook — return false and the whole
// page-run is skipped BEFORE any I/O (sidecar band stats prove no record in the run
// can match a filter — parquet's row-group skip, retrofitted onto .dm).
async function* dmColumnBatches(blob, h, colIdxs, { signal, shouldRead = null, place = null } = {}) {
  for (const run of dmPageRuns(h)) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (shouldRead && !shouldRead(run.start, run.count)) continue;
    yield await readDmRun(blob, h, colIdxs, run, place);
  }
}

// ── the OPEN's units and per-unit kernels ────────────────────────────────────
// The open reads the file twice: a DISCOVERY sweep (bbox, the lattice, the sizes)
// and the render DECODE. A .dm is fixed-size pages with no record across a page
// boundary, so both split into independent page runs: these two kernels are ONE
// unit's work, run in run order on the page (the default runner below) or on a
// worker pool (@gcu/scan's discoverDm / decodeDm) — the same code either way, and
// the merge (in run order) gives exactly what one sequential sweep gives.
// Units for the open: whole pages, ~`records` records each (bigger than the 4 MB
// scan runs: fewer, larger messages and yields — an open's stream is ~70 of them
// on an 18M model, not 4,000). recStart = the first page's first raw record.
export function dmOpenRuns(h, records = 1 << 18) {
  const pagesPer = Math.max(1, Math.ceil(records / Math.max(1, h.recordsPerPage)));
  const runs = [];
  for (let page = 2; page <= h.lastPage; page += pagesPer) {
    const pEnd = Math.min(page + pagesPer - 1, h.lastPage);
    let count = 0;
    for (let pg = page; pg <= pEnd; pg++) count += pg === h.lastPage ? h.lastRec : h.recordsPerPage;
    runs.push({ page, pEnd, start: (page - 2) * h.recordsPerPage, count });
  }
  return runs;
}
// DISCOVERY of one unit. p = { xc, yc, zc, dims: [ix, iy, iz] | null, cap, R, O, res }
// (R/O: a rotated model's placement — the WORLD bbox is collected beside the local
// one; res: how many leading valid centroids to keep for the rotated-lattice
// detector). → { valid, min, max, wmin, wmax, ax: [values ×3] (r10, distinct,
// capped), sizes: a sizeCollector snapshot | null, res: Float64Array | null }
export async function dmDiscoverRun(blob, h, p, run) {
  const cols = p.dims ? [p.xc, p.yc, p.zc, ...p.dims] : [p.xc, p.yc, p.zc];
  const { count, cols: c } = await readDmRun(blob, h, cols, run);
  const X = c[p.xc], Y = c[p.yc], Z = c[p.zc], DX = p.dims ? c[p.dims[0]] : null, DY = p.dims ? c[p.dims[1]] : null, DZ = p.dims ? c[p.dims[2]] : null;
  const R = p.R, O = p.O;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity];
  const axc = [axisDistinct(p.cap), axisDistinct(p.cap), axisDistinct(p.cap)];
  const sizes = p.dims ? sizeCollector() : null;
  const resOut = p.res > 0 ? new Float64Array(p.res * 3) : null;
  let nres = 0, valid = 0;
  for (let k = 0; k < count; k++) {
    const xv = X[k], yv = Y[k], zv = Z[k];
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
    if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
    if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
    if (R) {
      const wx = O[0] + R[0] * xv + R[3] * yv, wy = O[1] + R[1] * xv + R[4] * yv, wz = O[2] + zv;
      if (wx < wmin[0]) wmin[0] = wx; if (wx > wmax[0]) wmax[0] = wx;
      if (wy < wmin[1]) wmin[1] = wy; if (wy > wmax[1]) wmax[1] = wy;
      if (wz < wmin[2]) wmin[2] = wz; if (wz > wmax[2]) wmax[2] = wz;
    }
    axc[0].add(xv); axc[1].add(yv); axc[2].add(zv);
    if (sizes) sizes.add(DX[k], DY[k], DZ[k]);
    if (nres < p.res) { resOut[nres * 3] = xv; resOut[nres * 3 + 1] = yv; resOut[nres * 3 + 2] = zv; nres++; }
    valid++;
  }
  return { valid, min, max, wmin, wmax, ax: axc.map((a) => [...a.set]), sizes: sizes ? sizes.toJSON() : null, res: resOut ? resOut.slice(0, nres * 3) : null };
}
// DECODE of one unit into the chunk builder's arrays. p = { xc, yc, zc, chan, cat,
// dims, pitch, R, O }. The category arrives as LOCAL codes (Uint16, first appearance
// in this unit) + `dict` (the values in that order): the caller assigns the model's
// codes in run order, which is exactly the first-appearance order one sweep gives.
// A record without a finite centroid isn't drawn; its raw number is never reused.
export async function dmDecodeRun(blob, h, p, run) {
  const want = [p.xc, p.yc, p.zc];
  if (p.chan != null) want.push(p.chan);
  if (p.cat != null) want.push(p.cat);
  if (p.pitch) want.push(...p.dims);
  const { count, cols } = await readDmRun(blob, h, [...new Set(want)], run);
  const X = cols[p.xc], Y = cols[p.yc], Z = cols[p.zc];
  const CH = p.chan != null ? cols[p.chan] : null, CA = p.cat != null ? cols[p.cat] : null;
  const DX = p.pitch ? cols[p.dims[0]] : null, DY = p.pitch ? cols[p.dims[1]] : null, DZ = p.pitch ? cols[p.dims[2]] : null;
  const R = p.R, O = p.O;
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
  const cat = CA ? new Uint16Array(count) : null, dimQ = p.pitch ? new Uint8Array(3 * count) : null, recIdx = new Uint32Array(count);
  const dict = CA ? [] : null, local = CA ? new Map() : null;
  let m = 0;
  for (let k = 0; k < count; k++) {
    const xv = X[k], yv = Y[k], zv = Z[k];
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    if (R) { x[m] = O[0] + R[0] * xv + R[3] * yv; y[m] = O[1] + R[1] * xv + R[4] * yv; z[m] = O[2] + zv; }
    else { x[m] = xv; y[m] = yv; z[m] = zv; }
    chan[m] = CH ? CH[k] : 0;                              // NaN already when missing
    if (cat) {
      const raw = CA[k];                                   // '' when missing; a NUMERIC cat column dict-encodes as strings
      const v = raw == null || raw === '' || (typeof raw === 'number' && !Number.isFinite(raw)) ? '' : String(raw);
      let c = local.get(v);
      if (c === undefined) { c = dict.length < 65535 ? dict.length : 65535; if (c < 65535) { local.set(v, c); dict.push(v); } }
      cat[m] = c;                                          // 65535 = past a unit's dictionary: the model's code 0 (its 255 are long full)
    }
    if (dimQ) putDimQ(dimQ, m, DX[k], DY[k], DZ[k], p.pitch);
    recIdx[m++] = run.start + k;                           // RAW record number — the join key
  }
  const cut = (a) => (a && m < count ? a.slice(0, m) : a);
  return { count: m, x: cut(x), y: cut(y), z: cut(z), chan: cut(chan), cat: cut(cat), dict, dimQ: dimQ && m < count ? dimQ.slice(0, 3 * m) : dimQ, recIdx: cut(recIdx), recStart: 0 };
}
// The default RUNNER: every unit on this thread, in order. A runner is
// { discover({ file, h, p, units, onProgress, signal }) → summaries in unit order,
//   decode({ file, h, p, units, signal }) → async iterable of decoded units in order }
// — @gcu/scan's dm runner has the same face and runs them on a worker pool.
export const dmPageRunner = {
  async discover({ file, h, p, units, onProgress, signal }) {
    const out = []; let done = 0;
    for (const u of units) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      out.push(await dmDiscoverRun(file, h, u.res != null ? { ...p, res: u.res } : p, u));
      done += u.count; if (onProgress) onProgress(done);
    }
    return out;
  },
  async *decode({ file, h, p, units, signal }) {
    for (const u of units) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      yield await dmDecodeRun(file, h, p, u);
    }
  },
};

const DEF_NAMES = new Set(['IJK', 'XC', 'YC', 'ZC', 'XINC', 'YINC', 'ZINC', 'XMORIG', 'YMORIG', 'ZMORIG', 'NX', 'NY', 'NZ', 'ANGLE1', 'ANGLE2', 'ANGLE3', 'ROTAXIS1', 'ROTAXIS2', 'ROTAXIS3']);

// `cached` (a sidecar's discovery results: { grid, bbox, subBlocked, categories })
// skips the full-file discovery sweep — a 13 GB sub-blocked model reopens straight
// to streaming. Callers own freshness (name+size match).
// `origin` ([x, y, z]) — the world position of the model's local origin, for a
// rotated model whose file doesn't carry it (X0/Y0/Z0 = 0, an anonymised export).
// `runner` — who reads the open's units (dmPageRunner: this thread, in order; a
// caller with workers passes @gcu/scan's dm runner). The answer is the same.
// `unitRecords` — the units' size, at most (tests cut a small file into many).
export async function openDmModel(blob, { mapping = null, forcePoints = false, onProgress = null, cached = null, origin = null, runner = null, unitRecords = 1 << 18 } = {}) {
  const run = runner || dmPageRunner;
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  const fmt = detectDM(head);
  if (!fmt) throw new Error('dm: not a recognizable .dm file');
  const h = parseHeader(head, fmt);
  const names = h.columns.map((c) => c.name);
  const idx = (n) => names.indexOf(n);
  const constVal = (n) => { const c = h.columns[idx(n)]; return c && c.isConstant ? c.constantValue : null; };

  // centroid fields: stated by the caller (mapping.x/y/z), else XC/YC/ZC (or X/Y/Z)
  const xc = mapping && mapping.x != null ? mapping.x : idx('XC') >= 0 ? idx('XC') : idx('X');
  const yc = mapping && mapping.y != null ? mapping.y : idx('YC') >= 0 ? idx('YC') : idx('Y');
  const zc = mapping && mapping.z != null ? mapping.z : idx('ZC') >= 0 ? idx('ZC') : idx('Z');
  if (xc < 0 || yc < 0 || zc < 0) throw new Error('dm: no XC/YC/ZC centroid fields — not a block model export');

  // Decoded-record batches (a cold recipe). Reads ~4 MB page runs sequentially;
  // yields { recStart, rows } with RAW record numbering (recStart + k, no skips
  // here). Full decode — every field of every record. For a column-selective op
  // (a filter, a grade scan, the render stream) prefer columnBatches, which
  // strides only the fields it needs (≈ 3–30× less work; see bench-formats).
  async function* recordBatches({ signal } = {}) {
    const pagesPer = Math.max(1, Math.floor((4 << 20) / h.pageSize));
    for (let page = 2; page <= h.lastPage; page += pagesPer) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const pEnd = Math.min(page + pagesPer - 1, h.lastPage);
      const bytes = new Uint8Array(await blob.slice((page - 1) * h.pageSize, pEnd * h.pageSize).arrayBuffer());
      const rows = [];
      for (let pg = page; pg <= pEnd; pg++) {
        const nRec = pg === h.lastPage ? h.lastRec : h.recordsPerPage;
        const base = (pg - page) * h.pageSize;
        for (let r = 0; r < nRec; r++) {
          rows.push(placeDmRow(place, decodeRecord(bytes.subarray(base + r * h.maxLen * h.wordSize, base + (r + 1) * h.maxLen * h.wordSize), h)));
        }
      }
      yield { recStart: (page - 2) * h.recordsPerPage, rows };
    }
  }

  // PROJECTED batches — decode only the requested column indices by striding each
  // field's fixed word-offset across records (no whole-record decode, no per-row
  // allocation). Numeric col → Float64Array (NaN = missing); alpha col → string[]
  // (''=missing); constants come free from the header. Yields { recStart, count,
  // cols } where cols[idx] is the array for column `idx`. Same RAW numbering as
  // recordBatches (recStart + k over ALL records, skips resolved by the caller).
  // opts.shouldRead(recStart, count): PUSHDOWN hook — return false and the whole
  // page-run is skipped BEFORE any I/O (sidecar band stats prove no record in
  // the run can match a filter — parquet's row-group skip, retrofitted onto .dm)
  // These three READ FOR CONSUMERS and speak the model's placed frame: a rotated
  // model's XC/YC/ZC come back in WORLD (`place`, set below once the rotation is
  // known), like every other model's. The open's own sweeps (discovery, the render
  // stream) read the file's local values through localColumns and place them
  // themselves.
  let place = null;
  const localColumns = (colIdxs, opts) => dmColumnBatches(blob, h, colIdxs, opts);
  const columnBatches = (colIdxs, opts) => dmColumnBatches(blob, h, colIdxs, { ...(opts || {}), place });
  const fetchRecord = (rec) => fetchDmRecord(blob, h, rec, place);

  // the grid, straight from the DD (corner origin → centroid convention).
  // A regular model carries the grid as DD constants (XMORIG/XINC/NX…) → no sweep.
  // A SUB-BLOCKED model has per-record XINC/YINC/ZINC (not constants) → a discovery
  // sweep finds the fine lattice (pitch = min dim /2) + a size palette, exactly
  // like the CSV provider → variable-size boxes. Anything else → points (grid:null).
  const mor = [constVal('XMORIG'), constVal('YMORIG'), constVal('ZMORIG')];
  const inc = [constVal('XINC'), constVal('YINC'), constVal('ZINC')];
  const cnt = [constVal('NX'), constVal('NY'), constVal('NZ')];
  const regular = !forcePoints && mor.every(Number.isFinite) && inc.every((v) => Number.isFinite(v) && v > 0) && cnt.every((v) => Number.isFinite(v) && v >= 1);
  // per-record dim columns (non-constant XINC/YINC/ZINC) → sub-block candidate
  const incIdx = { x: idx('XINC'), y: idx('YINC'), z: idx('ZINC') };
  const perRecDims = !regular && !forcePoints && incIdx.x >= 0 && incIdx.y >= 0 && incIdx.z >= 0
    && !h.columns[incIdx.x].isConstant && !h.columns[incIdx.y].isConstant && !h.columns[incIdx.z].isConstant;

  // A Datamine ROTATED model carries up to three successive rotations as DD
  // constants: ANGLEn (degrees) about ROTAXISn (1 = X, 2 = Y, 3 = Z), and XC/YC/ZC
  // in the model's own (unrotated) frame. ONE rotation, ANGLE1 about Z, is applied:
  // ANGLE1 turns the model axes clockwise seen from above (R = −ANGLE1 in the math
  // sense; ANGLE1 = −50 → model X at N40°E) — checked on a real Isatis.neo export,
  // whose world centroid bounds it reproduces to 0.01 m. Anything else (a second or
  // third rotation, another axis) is REPORTED, never applied: its order convention
  // is unverified, and a plausible wrong placement is worse than an honest frame.
  // header.dmRotation = null, or [{ n, axis: 'X'|'Y'|'Z'|'?', angle }] in file order.
  const dmRotation = [];
  for (const n of [1, 2, 3]) {
    const a = constVal('ANGLE' + n), ax = constVal('ROTAXIS' + n);
    if (Number.isFinite(a) && Math.abs(a) > 1e-9) dmRotation.push({ n, axis: ({ 1: 'X', 2: 'Y', 3: 'Z' })[Math.round(ax)] || '?', angle: a });
  }
  const rotApplied = dmRotation.length === 1 && dmRotation[0].n === 1 && dmRotation[0].axis === 'Z';
  const R = rotApplied ? datamineRotZ(dmRotation[0].angle) : null;
  // the world position of the local origin: the caller's, else the file's X0/Y0/Z0 (0 when absent)
  const O = rotApplied ? (origin && origin.length === 3 ? origin.map(Number) : [constVal('X0'), constVal('Y0'), constVal('Z0')].map((v) => (Number.isFinite(v) ? v : 0))) : null;
  // local → world for one point (rotated models only)
  const toW = (x, y, z, out) => { out[0] = O[0] + R[0] * x + R[3] * y; out[1] = O[1] + R[1] * x + R[4] * y; out[2] = O[2] + z; return out; };
  // a local bbox → its world AABB (the 8 corners through R)
  const worldBox = (b) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = [0, 0, 0];
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      toW(x, y, z, p); for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
    }
    return { min: mn, max: mx };
  };
  // a cache written for another placement (an older, unrotated sidecar; another origin) is not trusted
  const sameAnchor = (g) => !!(g && g.rot && g.anchor && O && g.anchor.every((v, a) => Math.abs(v - O[a]) < 1e-6));
  const cacheOk = cached && cached.bbox && !forcePoints && (rotApplied ? sameAnchor(cached.grid) : !(cached.grid && cached.grid.rot));

  let grid = null, bbox, subBlocked = false, sizeQMax = null, sizeShapes = 0, subBlockRefused = null;
  let latticeFrom = null, latticeCandidate = null, nFinite = 0;   // a regular lattice found from the centroids; a rotated candidate
  if (cacheOk) {
    // sidecar-cached discovery: trust it wholesale (freshness is the caller's contract);
    // an older sidecar's dimPalette isn't needed — the fine grid's pitch says it all
    grid = cached.grid || null; bbox = cached.bbox;
    subBlocked = !!(cached.subBlocked && grid);
    sizeQMax = cached.sizeQMax || null;
  } else if (regular) {
    grid = {
      x: { origin: mor[0] + inc[0] / 2, pitch: inc[0], count: Math.round(cnt[0]) },
      y: { origin: mor[1] + inc[1] / 2, pitch: inc[1], count: Math.round(cnt[1]) },
      z: { origin: mor[2] + inc[2] / 2, pitch: inc[2], count: Math.round(cnt[2]) },
    };
    bbox = { min: [mor[0], mor[1], mor[2]], max: [mor[0] + inc[0] * cnt[0], mor[1] + inc[1] * cnt[1], mor[2] + inc[2] * cnt[2]] };
    if (rotApplied) bbox = worldBox(bbox);
  } else {
    const CAP = 300000;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity];   // world centroid bounds (rotated)
    const ax = [new Set(), new Set(), new Set()];          // axis distinct centroids (for the fine lattice), r10, capped
    const sizes = sizeCollector();
    // an UNROTATED model's first centroids (local = world): the rotated-lattice detector's reservoir
    const RES = 50000, res = [], detect = !forcePoints && !dmRotation.length;
    // the units, each a unit's summary (dmDiscoverRun) — on the runner's threads —
    // merged HERE in unit order: bounds, the distinct axis values (a union, clipped
    // at the cap — an axis at the cap reads as no lattice either way), the sizes
    // (sizeCollector.merge keeps first-appearance order) and the reservoir (asked of
    // the leading units; topped up below if they held too few valid centroids)
    const units = dmOpenRuns(h, unitRecords).map((u) => ({ ...u, res: detect && u.start < 4 * RES ? RES : 0 }));
    const dp = { xc, yc, zc, dims: perRecDims ? [incIdx.x, incIdx.y, incIdx.z] : null, cap: CAP, R: rotApplied ? Array.from(R) : null, O: rotApplied ? O : null, res: 0 };
    const parts = await run.discover({ file: blob, h, p: dp, units,
      onProgress: onProgress ? (done) => onProgress({ phase: 'discovery', done, total: h.recordCount }) : null });
    let resFrom = units.length;                            // the first unit whose reservoir wasn't asked for
    for (let g = 0; g < parts.length; g++) {
      const s = parts[g];
      for (let a = 0; a < 3; a++) {
        if (s.min[a] < min[a]) min[a] = s.min[a]; if (s.max[a] > max[a]) max[a] = s.max[a];
        if (s.wmin[a] < wmin[a]) wmin[a] = s.wmin[a]; if (s.wmax[a] > wmax[a]) wmax[a] = s.wmax[a];
        const set = ax[a];
        for (const v of s.ax[a]) { if (set.size >= CAP) break; set.add(v); }
      }
      if (s.sizes) sizes.merge(s.sizes);
      if (detect && !units[g].res && resFrom === units.length) resFrom = g;
      if (s.res && detect) for (let k = 0; k < s.res.length && res.length < RES * 3; k++) res.push(s.res[k]);
      nFinite += s.valid;
    }
    for (let g = resFrom; detect && g < units.length && res.length < RES * 3; g++) {   // rare: the leading units were mostly blank
      const s = await dmDiscoverRun(blob, h, { ...dp, dims: null, res: RES }, units[g]);
      for (let k = 0; k < s.res.length && res.length < RES * 3; k++) res.push(s.res[k]);
    }
    if (!Number.isFinite(min[0])) throw new Error('dm: no finite XC/YC/ZC centroids');
    bbox = rotApplied ? { min: wmin, max: wmax } : { min, max };
    // sub-blocked: the fine lattice + per-block dimQ — the same rule as CSV
    const sb = perRecDims ? inferSubBlockLattice(ax, sizes, { cap: CAP }) : null;
    if (sb && sb.refused) subBlockRefused = sb.refused;
    else if (sb) { subBlocked = true; sizeQMax = sb.sizeQMax; sizeShapes = sb.shapes; grid = sb.grid; }
    // REGULAR without the DD lattice (no XMORIG/NX constants — sizes, if any, constant
    // per record): the lattice from the centroids, as CSV / Parquet find theirs. A
    // block size the file states (one per-record value, or a DD constant) is the pitch
    // to check against; else the centroids' own step (inferAxis). Local frame — a
    // single Z rotation is applied below like any other grid.
    if (!grid && !subBlockRefused && !forcePoints) {
      const stated = perRecDims && sizes.count && !sizes.varies && !sizes.overflow ? [0, 1, 2].map((a) => [...sizes.axes[a]][0])
        : inc.every((v) => Number.isFinite(v) && v > 0) ? inc : null;
      const axes = ax.map((set, a) => {
        if (!set.size || set.size >= CAP) return null;
        const vals = [...set].sort((u, v) => u - v);
        if (!stated) return inferAxis(vals);
        const origin = vals[0], pitch = stated[a], count = Math.round((vals[vals.length - 1] - origin) / pitch) + 1;
        if (count > 65535) return null;
        const eps = Math.min(pitch / 10, Math.max(pitch * 1e-3, Math.abs(origin) * 1e-6));
        for (const v of vals) if (Math.abs(origin + Math.round((v - origin) / pitch) * pitch - v) > eps) return null;
        return { origin, pitch, count };
      });
      if (axes.every(Boolean)) { grid = { x: axes[0], y: axes[1], z: axes[2] }; latticeFrom = 'centroids'; }
    }
    // an unrotated .dm that isn't on an axis grid may be on a ROTATED one (or read as a
    // sparse, wrong axis grid at 45°): a CANDIDATE, confirmed by the caller, never applied here
    if (detect && !subBlocked && !subBlockRefused && res.length >= 24) {
      const sweep = () => (async function* () { for await (const { count, cols } of localColumns([xc, yc, zc])) yield { x: cols[xc], y: cols[yc], z: cols[zc], count }; })();
      if (!grid) latticeCandidate = await detectRotatedLattice(Float64Array.from(res), sweep);
      else if (latticeFrom) { const c = await detectRotatedOverAxisGrid(grid, nFinite, Float64Array.from(res), sweep); if (c) { grid = null; latticeFrom = null; latticeCandidate = c; } }
    }
  }
  // rotated: the local grid becomes a lattice about the world origin O (grid/basis.js form)
  if (grid && rotApplied && !grid.rot) grid = { ...grid, rot: R, anchor: O };
  const pitchQ = subBlocked && grid ? pitchOf(grid) : null;

  // channels: every per-record numeric non-definition column; first alpha = category
  const numericColumns = h.columns
    .map((c, i) => ({ c, i }))
    .filter((o) => o.c.type === 'N' && !o.c.isConstant && !DEF_NAMES.has(o.c.name))
    .map((o) => ({ i: o.i, name: o.c.name }));
  const chan = mapping && mapping.chan != null ? mapping.chan : (numericColumns[0] ? numericColumns[0].i : null);
  // category: an explicit mapping.cat wins (any column — numeric domain codes
  // dict-encode as strings below); default = the first non-constant alpha
  const catIdx = mapping && mapping.cat != null ? mapping.cat : h.columns.findIndex((c) => c.type === 'A' && !c.isConstant);   // mapping.cat = -1 → stated: none
  // a sidecar's categories describe the column it was written for — a re-keyed
  // cat must rebuild its dict during the sweep, not inherit the old column's
  const cachedCats = cached && cached.categories && (!cached.mapping || cached.mapping.cat == null || cached.mapping.cat === catIdx) ? cached.categories : null;
  const categories = catIdx >= 0 ? (cachedCats ? [...cachedCats] : []) : null;   // fills incrementally during the sweep (or prefilled from a sidecar)
  const catCode = catIdx >= 0 ? new Map(categories.map((v, i) => [v, i])) : null;

  const header = {
    kind: 'blockmodel', count: h.recordCount,
    dmRotation: dmRotation.length ? dmRotation : null,
    dmRotationApplied: rotApplied,                          // true: placed in world (one rotation about Z)
    dmOrigin: rotApplied ? O : null,                        // the world position of the model's local origin
    dmPlace: null,                                          // set below: the placement the readers apply (rotated only)
    lattice: rotApplied && grid ? { basis: 'declared', by: 'datamine' } : latticeFrom && grid ? { basis: 'inferred', from: latticeFrom } : null,
    latticeCandidate,                                       // an unrotated .dm on a ROTATED lattice: the caller confirms (never applied here)
    bbox, grid, subBlocked, sizeQMax, sizeShapes, subBlockRefused, dimCols: subBlocked ? incIdx : null,
    columns: names,
    mapping: { x: xc, y: yc, z: zc, chan, cat: catIdx >= 0 ? catIdx : null },
    numericColumns, categories,
    attributes: [...(chan != null ? [names[chan]] : []), ...(catIdx >= 0 ? [names[catIdx]] : [])],
    dm: h,                                                  // the @gcu/dm header: O(1) record fetch + the filter sweep
  };

  if (rotApplied) place = header.dmPlace = { x: xc, y: yc, z: zc, R: Array.from(R), O: [...O] };

  // the render stream: each unit decoded (dmDecodeRun — on the runner's threads),
  // handed on IN UNIT ORDER. The category's codes are assigned here, in that order,
  // from each unit's first-appearance dictionary: the codes one sweep gives.
  // Units arrive whole (~chunkPoints records): the chunk builder cuts its batches
  // wherever pushes end, so the chunks are the same as the old fixed-size stream's.
  async function* streamChunks({ chunkPoints = 1 << 18, signal, onProgress } = {}) {
    const dp = { xc, yc, zc, chan, cat: catIdx >= 0 ? catIdx : null, dims: pitchQ ? [incIdx.x, incIdx.y, incIdx.z] : null, pitch: pitchQ, R: R ? Array.from(R) : null, O: R ? O : null };
    let done = 0;
    for await (const u of run.decode({ file: blob, h, p: dp, units: dmOpenRuns(h, Math.min(chunkPoints, unitRecords)), signal })) {
      let cat = null;
      if (u.cat) {
        const lut = new Uint8Array(65536);                 // local code → the model's (65535 and any overflow → 0)
        for (let i = 0; i < u.dict.length; i++) {
          const v = u.dict[i];
          let code = catCode.get(v);
          if (code === undefined) {
            if (catCode.size < 255) { code = catCode.size; catCode.set(v, code); categories.push(v); }
            else code = 0;
          }
          lut[i] = code;
        }
        cat = new Uint8Array(u.count);
        for (let i = 0; i < u.count; i++) cat[i] = lut[u.cat[i]];
      } else if (catCode) cat = new Uint8Array(u.count);
      done += u.count;
      if (onProgress) onProgress(done, h.recordCount);
      if (u.count) yield { count: u.count, x: u.x, y: u.y, z: u.z, chan: u.chan, cat, dimQ: u.dimQ, recIdx: u.recIdx, recStart: 0 };
    }
  }

  return { header, streamChunks, recordBatches, columnBatches, fetchRecord };
}

// O(1) fetch of one record by RAW record number (the pick → inspector path).
// place (header.dmPlace): a rotated model's coordinates in WORLD; omitted → as stored.
export async function fetchDmRecord(blob, h, rec, place = null) {
  const { offset, length } = recordRange(h, rec);
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  return placeDmRow(place, decodeRecord(bytes, h));        // positional values, h.columns order
}

// ── Datamine WIREFRAME (triangulated surface / DTM / solid) ──────────────────
// A Datamine wireframe is a PAIR of .dm files: a POINTS file (XP/YP/ZP + PID) and
// a TRIANGLES file (PID1/PID2/PID3 indexing the points by id), by convention named
// <base>pt.dm / <base>tr.dm. Together they're an indexed mesh — the same
// { vertices, triangles } shape the OBJ/MSH/PLY providers return, so buildMeshChunk
// and the whole mesh pipeline take it unchanged.

// Peek a .dm's column names without the block-model requirement (openDmModel throws
// for non-block-model files). Returns names[] or null if not a recognizable .dm.
export async function peekDmColumns(blob) {
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  const fmt = detectDM(head);
  if (!fmt) return null;
  try { return parseHeader(head, fmt).columns.map((c) => c.name); } catch { return null; }
}

// A .dm's rotation as its DD page states it, without opening the model: → null (not
// rotated) or { applied, rotations: [{ n, axis, angle }], origin: [X0, Y0, Z0] } —
// applied = the one case openDmModel places in world (ANGLE1 about Z alone); origin
// = the file's X0/Y0/Z0 (0 where absent — an anonymised export carries none).
export async function peekDmRotation(blob) {
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  const fmt = detectDM(head);
  if (!fmt) return null;
  let h; try { h = parseHeader(head, fmt); } catch { return null; }
  const cv = (n) => { const c = h.columns.find((x) => x.name === n); return c && c.isConstant ? c.constantValue : null; };
  const rotations = [];
  for (const n of [1, 2, 3]) {
    const a = cv('ANGLE' + n), ax = cv('ROTAXIS' + n);
    if (Number.isFinite(a) && Math.abs(a) > 1e-9) rotations.push({ n, axis: ({ 1: 'X', 2: 'Y', 3: 'Z' })[Math.round(ax)] || '?', angle: a });
  }
  if (!rotations.length) return null;
  const applied = rotations.length === 1 && rotations[0].n === 1 && rotations[0].axis === 'Z';
  return { applied, rotations, origin: ['X0', 'Y0', 'Z0'].map((n) => { const v = cv(n); return Number.isFinite(v) ? v : 0; }) };
}

// Classify a .dm by its fields: a wireframe points half, a triangle half, or null.
export function dmWireframeRole(names) {
  if (!names) return null;
  const has = (n) => names.some((c) => String(c).toUpperCase() === n);
  if (has('PID1') && has('PID2') && has('PID3')) return 'triangles';
  if (has('PID') && has('XP') && has('YP') && has('ZP')) return 'points';
  return null;
}

// Join a points file + a triangles file into a mesh. Both halves are read in page
// runs, striding only the fields the join needs (PID/XP/YP/ZP, PID1-3) — never a
// whole-file buffer, so a big survey DTM pair opens too; maps PID → 0-based vertex
// index (gaps ok); drops any triangle whose vertices don't resolve (reports the
// count). Multiple GROUPs merge into one mesh for v1.
const dmHeadOf = async (blob) => {
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  return parseHeader(head, detectDM(head) || {});
};
const missing = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
export async function openDmWireframe(ptBlob, trBlob) {
  const ph = await dmHeadOf(ptBlob);
  const pu = ph.columns.map((c) => c.name.toUpperCase());
  const xi = pu.indexOf('XP'), yi = pu.indexOf('YP'), zi = pu.indexOf('ZP'), pid = pu.indexOf('PID');
  if (xi < 0 || yi < 0 || zi < 0 || pid < 0) throw new Error('dm wireframe: the points file needs XP/YP/ZP/PID');
  const idxOfPid = new Map();
  const vx = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for await (const run of dmColumnBatches(ptBlob, ph, [pid, xi, yi, zi])) {
    const P = run.cols[pid], X = run.cols[xi], Y = run.cols[yi], Z = run.cols[zi];
    for (let k = 0; k < run.count; k++) {
      const id = P[k], x = X[k], y = Y[k], z = Z[k];
      if (missing(id) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      idxOfPid.set(id, n++); vx.push(x, y, z);
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
  }
  const th = await dmHeadOf(trBlob);
  const tu = th.columns.map((c) => c.name.toUpperCase());
  const a = tu.indexOf('PID1'), b = tu.indexOf('PID2'), c = tu.indexOf('PID3');
  if (a < 0 || b < 0 || c < 0) throw new Error('dm wireframe: the triangles file needs PID1/PID2/PID3');
  const tri = [];
  let dropped = 0;
  for await (const run of dmColumnBatches(trBlob, th, [a, b, c])) {
    const A = run.cols[a], B = run.cols[b], C = run.cols[c];
    for (let k = 0; k < run.count; k++) {
      const i1 = idxOfPid.get(A[k]), i2 = idxOfPid.get(B[k]), i3 = idxOfPid.get(C[k]);
      if (i1 == null || i2 == null || i3 == null || i1 === i2 || i2 === i3 || i1 === i3) { dropped++; continue; }
      tri.push(i1, i2, i3);
    }
  }
  if (!n || !tri.length) throw new Error('dm wireframe: no resolvable triangles');
  const vertices = Float64Array.from(vx), triangles = Uint32Array.from(tri);
  return { header: { kind: 'mesh', format: 'dm-wireframe', vertexCount: n, triCount: triangles.length / 3 | 0, bbox: { min, max }, dropped }, vertices, triangles };
}
