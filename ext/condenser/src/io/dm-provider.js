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
import { inferSubBlockLattice, axisDistinct } from '../grid/infer.js';
import { sizeCollector, putDimQ, pitchOf, datamineRotZ } from '../grid/support.js';

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
export async function readDmRun(blob, h, colIdxs, run) {
  const ids = [...new Set(colIdxs)];
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
  return { recStart: run.start, count: total, cols: cobj };
}
// opts.shouldRead(recStart, count): PUSHDOWN hook — return false and the whole
// page-run is skipped BEFORE any I/O (sidecar band stats prove no record in the run
// can match a filter — parquet's row-group skip, retrofitted onto .dm).
async function* dmColumnBatches(blob, h, colIdxs, { signal, shouldRead = null } = {}) {
  for (const run of dmPageRuns(h)) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (shouldRead && !shouldRead(run.start, run.count)) continue;
    yield await readDmRun(blob, h, colIdxs, run);
  }
}

const DEF_NAMES = new Set(['IJK', 'XC', 'YC', 'ZC', 'XINC', 'YINC', 'ZINC', 'XMORIG', 'YMORIG', 'ZMORIG', 'NX', 'NY', 'NZ', 'ANGLE1', 'ANGLE2', 'ANGLE3', 'ROTAXIS1', 'ROTAXIS2', 'ROTAXIS3']);

// `cached` (a sidecar's discovery results: { grid, bbox, subBlocked, categories })
// skips the full-file discovery sweep — a 13 GB sub-blocked model reopens straight
// to streaming. Callers own freshness (name+size match).
// `origin` ([x, y, z]) — the world position of the model's local origin, for a
// rotated model whose file doesn't carry it (X0/Y0/Z0 = 0, an anonymised export).
export async function openDmModel(blob, { mapping = null, forcePoints = false, onProgress = null, cached = null, origin = null } = {}) {
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
          rows.push(decodeRecord(bytes.subarray(base + r * h.maxLen * h.wordSize, base + (r + 1) * h.maxLen * h.wordSize), h));
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
  const columnBatches = (colIdxs, opts) => dmColumnBatches(blob, h, colIdxs, opts);

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
    const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity], wp = [0, 0, 0];   // world centroid bounds (rotated)
    const axc = [axisDistinct(CAP), axisDistinct(CAP), axisDistinct(CAP)];   // axis distinct centroids (for the fine lattice)
    const ax = axc.map((c) => c.set);
    const sizes = sizeCollector();
    const sweepCols = perRecDims ? [xc, yc, zc, incIdx.x, incIdx.y, incIdx.z] : [xc, yc, zc];
    for await (const { recStart, count, cols } of columnBatches(sweepCols)) {
      if (onProgress) onProgress({ phase: 'discovery', done: recStart + count, total: h.recordCount });
      const X = cols[xc], Y = cols[yc], Z = cols[zc], DX = perRecDims ? cols[incIdx.x] : null, DY = perRecDims ? cols[incIdx.y] : null, DZ = perRecDims ? cols[incIdx.z] : null;
      for (let k = 0; k < count; k++) {
        const xv = X[k], yv = Y[k], zv = Z[k];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
        if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
        if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
        if (rotApplied) {
          toW(xv, yv, zv, wp);
          for (let a = 0; a < 3; a++) { if (wp[a] < wmin[a]) wmin[a] = wp[a]; if (wp[a] > wmax[a]) wmax[a] = wp[a]; }
        }
        if (perRecDims) {
          axc[0].add(xv); axc[1].add(yv); axc[2].add(zv);
          sizes.add(DX[k], DY[k], DZ[k]);
        }
      }
    }
    if (!Number.isFinite(min[0])) throw new Error('dm: no finite XC/YC/ZC centroids');
    bbox = rotApplied ? { min: wmin, max: wmax } : { min, max };
    // sub-blocked: the fine lattice + per-block dimQ — the same rule as CSV
    const sb = perRecDims ? inferSubBlockLattice(ax, sizes, { cap: CAP }) : null;
    if (sb && sb.refused) subBlockRefused = sb.refused;
    else if (sb) { subBlocked = true; sizeQMax = sb.sizeQMax; sizeShapes = sb.shapes; grid = sb.grid; }
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
    lattice: rotApplied && grid ? { basis: 'declared', by: 'datamine' } : null,
    bbox, grid, subBlocked, sizeQMax, sizeShapes, subBlockRefused, dimCols: subBlocked ? incIdx : null,
    columns: names,
    mapping: { x: xc, y: yc, z: zc, chan, cat: catIdx >= 0 ? catIdx : null },
    numericColumns, categories,
    attributes: [...(chan != null ? [names[chan]] : []), ...(catIdx >= 0 ? [names[catIdx]] : [])],
    dm: h,                                                  // the @gcu/dm header: O(1) record fetch + the filter sweep
  };

  async function* streamChunks({ chunkPoints = 1 << 18, signal, onProgress } = {}) {
    const alloc = () => ({
      x: new Float64Array(chunkPoints), y: new Float64Array(chunkPoints), z: new Float64Array(chunkPoints),
      chan: new Float64Array(chunkPoints), cat: catCode ? new Uint8Array(chunkPoints) : null,
      dimQ: pitchQ ? new Uint8Array(3 * chunkPoints) : null,
      recIdx: new Uint32Array(chunkPoints),
    });
    // project ONLY the fields the render needs (coords + grade + category + dims)
    // — not all N columns. On the real Leapfrog .dm that's ~6 of 14+.
    const streamCols = [xc, yc, zc];
    if (chan != null) streamCols.push(chan);
    if (catIdx >= 0) streamCols.push(catIdx);
    if (pitchQ) streamCols.push(incIdx.x, incIdx.y, incIdx.z);
    let buf = alloc(), fill = 0, done = 0;
    for await (const { recStart, count, cols } of columnBatches(streamCols, { signal })) {
      const X = cols[xc], Y = cols[yc], Z = cols[zc];
      const CH = chan != null ? cols[chan] : null, CA = catIdx >= 0 ? cols[catIdx] : null;
      const DX = pitchQ ? cols[incIdx.x] : null, DY = pitchQ ? cols[incIdx.y] : null, DZ = pitchQ ? cols[incIdx.z] : null;
      for (let k = 0; k < count; k++) {
        const xv = X[k], yv = Y[k], zv = Z[k];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;   // skipped, raw number NOT reused
        if (R) {                                           // rotated: the stream speaks WORLD coordinates
          buf.x[fill] = O[0] + R[0] * xv + R[3] * yv; buf.y[fill] = O[1] + R[1] * xv + R[4] * yv; buf.z[fill] = O[2] + zv;
        } else { buf.x[fill] = xv; buf.y[fill] = yv; buf.z[fill] = zv; }
        buf.chan[fill] = CH ? CH[k] : 0;                   // NaN already when missing
        if (buf.cat) {
          const raw = CA[k];                               // '' when missing; a NUMERIC cat column dict-encodes as strings
          const v = raw == null || raw === '' || (typeof raw === 'number' && !Number.isFinite(raw)) ? '' : String(raw);
          let code = catCode.get(v);
          if (code === undefined) {
            if (catCode.size < 255) { code = catCode.size; catCode.set(v, code); categories.push(v); }
            else code = 0;
          }
          buf.cat[fill] = code;
        }
        if (buf.dimQ) putDimQ(buf.dimQ, fill, DX[k], DY[k], DZ[k], pitchQ);
        buf.recIdx[fill] = recStart + k;                   // RAW record number — the join key
        fill++;
        if (fill === chunkPoints) {
          yield { count: fill, x: buf.x, y: buf.y, z: buf.z, chan: buf.chan, cat: buf.cat, dimQ: buf.dimQ, recIdx: buf.recIdx, recStart: 0 };
          buf = alloc(); fill = 0;
        }
      }
      done += count;
      if (onProgress) onProgress(done, h.recordCount);
    }
    if (fill) {
      yield {
        count: fill, x: buf.x.subarray(0, fill), y: buf.y.subarray(0, fill), z: buf.z.subarray(0, fill),
        chan: buf.chan.subarray(0, fill), cat: buf.cat ? buf.cat.subarray(0, fill) : null,
        dimQ: buf.dimQ ? buf.dimQ.subarray(0, 3 * fill) : null,
        recIdx: buf.recIdx.subarray(0, fill), recStart: 0,
      };
    }
  }

  return { header, streamChunks, recordBatches, columnBatches };
}

// O(1) fetch of one record by RAW record number (the pick → inspector path).
export async function fetchDmRecord(blob, h, rec) {
  const { offset, length } = recordRange(h, rec);
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  return decodeRecord(bytes, h);                           // positional values, h.columns order
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
