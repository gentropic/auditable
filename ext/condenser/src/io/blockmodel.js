// @gcu/condenser — delimited block-model provider (CSV/GSLIB-ish exports).
// Centroid columns (XC/YC/ZC by convention, overridable) + one scalar grade
// channel + one categorical channel. A CSV carries no header bbox, so this
// provider runs an honest TWO-SWEEP recipe (both cold-re-runnable over the
// Blob): sweep 1 (discovery) parses coordinates only → per-axis distinct
// values → regular-grid inference (§2.5); sweep 2 streams full RawChunks.
// Sub-blocked / off-lattice models fail grid inference and should be routed
// to the points pipeline by the caller (header.grid === null).
//
// openBlockModel(blob, { mapping? }) → { header, streamChunks }
//   header = { kind:'blockmodel', count, bbox, grid|null, columns, mapping,
//              categories: string[]|null (code → value, ≤255) }
//   RawChunk = { count, x, y, z: Float64Array, chan: Float64Array,
//                cat: Uint8Array|null, recStart }

import { inferAxis, inferSubBlockLattice, dimKey, dimCodeFromPalette, DIM_PALETTE_MAX } from '../grid/infer.js';
import { WS, splitFields, RecordJoiner, sampleRecords } from './delimited.js';
import { detectRotatedLattice, latticeMisfit } from '../grid/basis.js';

const X_RE = /^(x|xc|xcent(er|re)?|xmid|east(ing)?|xworld|centroid_?x)$/i;
const Y_RE = /^(y|yc|ycent(er|re)?|ymid|north(ing)?|yworld|centroid_?y)$/i;
const Z_RE = /^(z|zc|zcent(er|re)?|zmid|elev(ation)?|rl|level|zworld|centroid_?z)$/i;
const DIM_RE = /^(d[xyz]|[xyz]inc|[xyz]size|[xyz]dim|dim_?[xyz])$/i;
const DIMX_RE = /^(dx|xinc|xsize|xdim|dim_?x)$/i;
const DIMY_RE = /^(dy|yinc|ysize|ydim|dim_?y)$/i;
const DIMZ_RE = /^(dz|zinc|zsize|zdim|dim_?z)$/i;
const NONGRADE_RE = /^(ijk|id|index|row|i|j|k|dens|density|sg|topo|pct|proportion)$/i;

// a RECORD splitter: RFC 4180 quotes honoured (delimited.js); unquoted lines take the plain split
const splitter = (delim) => (l) => splitFields(l, delim);

// Detect delimiter + header from the first text block.
export function sniffDelimited(text) {
  if (!text.split(/\r?\n/).some((l) => l.trim() && !l.startsWith('#'))) throw new Error('blockmodel: no data lines');
  // a sample can end mid-record; a quoted record cut off at the edge is dropped,
  // and a cut plain last line is dropped too unless it is all there is
  const cut = !/\n\s*$/.test(text);
  let best = null;
  for (const d of [',', ';', '\t', WS]) {
    let recs = sampleRecords(text, d, { max: 25 });
    if (cut && recs.length > 1 && recs.length < 25) recs = recs.slice(0, -1);
    recs = recs.slice(0, 24);
    if (!recs.length) continue;
    const split = splitter(d);
    const counts = recs.map((l) => split(l).length);
    const n = counts[0];
    if (n < 2) continue;
    if (counts.every((c) => c === n) && (!best || n > best.n)) best = { delim: d, n, first: recs[0] };
  }
  if (!best) throw new Error('blockmodel: no consistent delimiter found');
  const first = splitter(best.delim)(best.first).map((s) => s.trim());
  const numericish = (s) => s !== '' && !Number.isNaN(Number(s));
  const hasHeader = first.some((s) => !numericish(s));
  return { delim: best.delim, header: hasHeader ? first : null, columns: best.n };
}

// Per-block size columns (DX/DY/DZ, XINC…) by name → { x, y, z } indices, or
// null unless all three are present. Shared with every columnar reader so a
// Parquet file is recognised by the same names a CSV is.
export function findDimColumns(header) {
  if (!header) return null;
  const find = (re) => header.findIndex((h) => re.test(String(h).trim()));
  const d = { x: find(DIMX_RE), y: find(DIMY_RE), z: find(DIMZ_RE) };
  return d.x >= 0 && d.y >= 0 && d.z >= 0 ? d : null;
}
/** is this column name a per-block size column? */
export const isDimColumn = (name) => DIM_RE.test(String(name).trim());

// Pick column roles from names. Returns null when centroids can't be identified.
export function mapColumns(header) {
  if (!header) return null;
  const find = (re) => header.findIndex((h) => re.test(h.trim()));
  const x = find(X_RE), y = find(Y_RE), z = find(Z_RE);
  if (x < 0 || y < 0 || z < 0) return null;
  const taken = new Set([x, y, z]);
  header.forEach((h, i) => { if (DIM_RE.test(h.trim())) taken.add(i); });
  let chan = -1;
  for (let i = 0; i < header.length; i++) {
    if (!taken.has(i) && !NONGRADE_RE.test(header[i].trim())) { chan = i; break; }
  }
  return { x, y, z, chan: chan >= 0 ? chan : null, cat: null };
}

// Async generator over the blob's data lines (cold recipe — call again for the
// next sweep). Skips blanks + '#'; yields trimmed field arrays in batches so the
// consumer controls pacing. Exported: the filter sweep (a mask by record index)
// re-reads raw rows through the same path.
export async function* lineFields(blob, delim, hasHeader, { signal, onProgress } = {}) {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
  const split = splitter(delim), join = new RecordJoiner(delim);
  let carry = '', first = hasHeader, bytesSeen = 0;
  const take = (l, batch) => {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (!join.pending && (!l || l[0] === '#')) return;
    const r = join.push(l);
    if (r == null) return;
    if (first) { first = false; return; }
    batch.push(split(r));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (done) break;
      bytesSeen += value.length;
      const text = carry + value;
      const lines = text.split('\n');
      carry = lines.pop();
      const batch = [];
      for (const l of lines) take(l, batch);
      if (onProgress) onProgress(bytesSeen, blob.size);
      if (batch.length) yield batch;
    }
    const batch = [];
    if (carry && (join.pending || carry.trim())) take(carry, batch);
    const rest = join.flush();
    if (rest != null && !first) batch.push(split(rest));
    if (batch.length) yield batch;
  } finally { reader.releaseLock(); }
}

// Byte-tracking sibling of lineFields for the discovery sweep: yields
// { fields, at } batches where at[i] is the ABSOLUTE byte offset of that data
// line's first byte. 0x0A never occurs inside a UTF-8 multi-byte sequence, so
// byte-level line splitting is exact; text still decodes in BULK per chunk
// (per-line decode would be ~50× slower at 50M rows). These offsets feed the
// sparse record index (fetchDelimitedRecord) — the pick join on big CSVs.
async function* lineFieldsWithOffsets(blob, delim, hasHeader, { signal, onProgress } = {}) {
  const reader = blob.stream().getReader();
  const dec = new TextDecoder();
  const split = splitter(delim), join = new RecordJoiner(delim);
  let carryText = '', carryAt = 0, pos = 0, first = hasHeader, bytesSeen = 0, recAt = 0;
  // one line (its byte offset `start`) into the joiner; a completed record keeps
  // the offset of its FIRST line, so the sparse index always points at a record start
  const take = (l, start, fields, at) => {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (!join.pending && (!l || l[0] === '#')) return;
    const wasPending = join.pending;
    const r = join.push(l);
    if (!wasPending) recAt = start;
    if (r == null) return;
    if (first) { first = false; return; }
    fields.push(split(r)); at.push(recAt);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (done) break;
      bytesSeen += value.length;
      // newline BYTE positions in this chunk (absolute)
      const nl = [];
      for (let j = 0; j < value.length; j++) if (value[j] === 10) nl.push(pos + j);
      const text = carryText + dec.decode(value, { stream: true });
      const lines = text.split('\n');
      const nextCarry = lines.pop();                       // == nl.length complete lines remain
      const fields = [], at = [];
      for (let i = 0; i < lines.length; i++) take(lines[i], i === 0 ? carryAt : nl[i - 1] + 1, fields, at);
      carryText = nextCarry;
      carryAt = nl.length ? nl[nl.length - 1] + 1 : carryAt;
      pos += value.length;
      if (onProgress) onProgress(bytesSeen, blob.size);
      if (fields.length) yield { fields, at };
    }
    const tail = carryText + dec.decode();                 // flush any held-back multi-byte bytes
    const fields = [], at = [];
    if (tail && (join.pending || tail.trim())) take(tail, carryAt, fields, at);
    const rest = join.flush();
    if (rest != null && !first) { fields.push(split(rest)); at.push(recAt); }
    if (fields.length) yield { fields, at };
  } finally { reader.releaseLock(); }
}

// O(anchors) record fetch: jump to the nearest preceding anchor, walk forward
// applying the SAME accept predicate as the sweeps (blank/# skipped in the
// reader; non-finite coords skipped here — record numbers count accepted rows
// only). Reads ~indexEvery lines instead of the whole file.
export async function fetchDelimitedRecord(blob, header, rec) {
  const idx = header.index;
  if (!idx || !idx.offsets.length || rec < 0 || rec >= header.count) return null;
  const a = Math.min(Math.floor(rec / idx.k), idx.offsets.length - 1);
  let remaining = rec - a * idx.k;
  const m = header.mapping;
  const split = splitter(header.delim), join = new RecordJoiner(header.delim);
  const reader = blob.slice(idx.offsets[a]).stream().pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const lines = done ? (carry ? [carry] : []) : (carry + value).split('\n');
      if (!done) carry = lines.pop();
      if (done && join.pending) lines.push(null);           // end of file: flush an unterminated quoted record
      for (let l of lines) {
        let rec2;
        if (l === null) rec2 = join.flush();
        else {
          if (l.endsWith('\r')) l = l.slice(0, -1);
          if (!join.pending && (!l || l[0] === '#')) continue;
          rec2 = join.push(l);
        }
        if (rec2 == null) continue;
        const f = split(rec2);
        const xv = +f[m.x], yv = +f[m.y], zv = +f[m.z];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (remaining === 0) return f;
        remaining--;
      }
      if (done) return null;
    }
  } finally { reader.releaseLock(); }
}

const CAP_DISTINCT = 300000;                               // per-axis discovery cap

// sweep 2 as a shared factory: the same cold-recipe stream whether the header
// came from a live discovery or a cached `discovered` payload (sidecars)
function makeDelimitedStream(blob, delim, hasHeaderRow, map, catCol, catCode, dimInfo = null) {
  return async function* streamChunks({ chunkPoints = 1 << 18, signal: s2, onProgress: op2 } = {}) {
    const alloc = () => ({ x: new Float64Array(chunkPoints), y: new Float64Array(chunkPoints), z: new Float64Array(chunkPoints), chan: new Float64Array(chunkPoints), cat: catCode ? new Uint8Array(chunkPoints) : null, dim: dimInfo ? new Uint8Array(chunkPoints) : null });
    let buf = alloc(), fill = 0, recStart = 0;
    for await (const batch of lineFields(blob, delim, hasHeaderRow, { signal: s2, onProgress: op2 })) {
      for (const f of batch) {
        const xv = +f[map.x], yv = +f[map.y], zv = +f[map.z];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        buf.x[fill] = xv; buf.y[fill] = yv; buf.z[fill] = zv;
        buf.chan[fill] = map.chan != null ? +f[map.chan] : 0;
        if (buf.cat) { const c = catCode.get((f[catCol] || '').trim()); buf.cat[fill] = c === undefined ? 0 : c; }
        if (buf.dim) { const c = dimInfo.code.get(dimKey(+f[dimInfo.cols.x], +f[dimInfo.cols.y], +f[dimInfo.cols.z])); buf.dim[fill] = c === undefined ? 0 : c; }
        fill++;
        if (fill === chunkPoints) {
          yield { count: fill, x: buf.x, y: buf.y, z: buf.z, chan: buf.chan, cat: buf.cat, dim: buf.dim, recStart };
          recStart += fill; buf = alloc(); fill = 0;
        }
      }
    }
    if (fill) yield { count: fill, x: buf.x.subarray(0, fill), y: buf.y.subarray(0, fill), z: buf.z.subarray(0, fill), chan: buf.chan.subarray(0, fill), cat: buf.cat ? buf.cat.subarray(0, fill) : null, dim: buf.dim ? buf.dim.subarray(0, fill) : null, recStart };
  };
}

// opts.lattice — a DECLARED lattice ({ x, y, z } axes, optionally rot + anchor
//   for a rotated one; see grid/basis.js): applied as stated, never inferred,
//   but every record is checked against it in the discovery sweep and the open
//   throws (naming the record) if one is off it.
// opts.rotated — false skips the rotated-lattice detection. Otherwise a model
//   that is NOT an axis-aligned grid is tried as a rotated one (reservoir →
//   basis → a fit over every record); a hit is returned as
//   header.latticeCandidate and NOT applied — the caller confirms it (an
//   inferred rotation is never applied silently).
// opts.dims — { x, y, z } column indices of the per-block size columns, stated
//   by the caller (otherwise found by name: DX/DY/DZ, XINC…).
// mapping.cat = -1 — "no category" (no auto-pick from the text columns).
export async function openBlockModel(blob, { mapping = null, discovered = null, lattice = null, rotated = true, dims = null, sample = 512 * 1024, indexEvery = 1024, signal, onProgress } = {}) {
  // a cached discovery (project sidecars / channel re-streams): skip sweep 1
  // entirely — the header is rebuilt from the payload, sweep 2 streams as usual
  if (discovered) {
    const header = {
      ...discovered,
      bbox: { min: [...discovered.bbox.min], max: [...discovered.bbox.max] },
      index: discovered.index
        ? { k: discovered.index.k, offsets: discovered.index.offsets instanceof Float64Array ? discovered.index.offsets : Float64Array.from(discovered.index.offsets) }
        : undefined,
    };
    const map2 = header.mapping;
    const catCode2 = header.categories ? new Map(header.categories.map((v, i) => [v, i])) : null;
    // sub-blocked: rebuild the size-code map from the persisted half-dim palette (×2)
    const dimInfo2 = header.subBlocked && header.dimCols && header.dimPalette
      ? { cols: header.dimCols, code: dimCodeFromPalette(header.dimPalette) }
      : null;
    return { header, streamChunks: makeDelimitedStream(blob, header.delim, header.hasHeaderRow, map2, map2.cat, catCode2, dimInfo2) };
  }
  const head = await blob.slice(0, Math.min(sample, blob.size)).text();
  const sniff = sniffDelimited(head);
  // headerless numeric files (XYZ dumps): columns 0/1/2 = x/y/z, a 4th numeric = the
  // scalar channel; names generated so schema/filter/autocomplete still work.
  if (!sniff.header && sniff.columns >= 3) {
    sniff.header = Array.from({ length: sniff.columns }, (_, i) => (i === 0 ? 'X' : i === 1 ? 'Y' : i === 2 ? 'Z' : `V${i + 1}`));
    sniff.generated = true;
    if (!mapping) mapping = { x: 0, y: 1, z: 2, chan: sniff.columns > 3 ? 3 : null, cat: null };
  }
  const map = mapping || mapColumns(sniff.header);
  if (!map) throw new Error('blockmodel: could not identify X/Y/Z centroid columns — pass a mapping');

  // mapColumns picks the channel BY NAME (first leftover column) — a text
  // column (XC,YC,ZC,LITO) would claim it, killing both the channel and the
  // category detection below (which skips map.chan). Demote a non-numeric
  // AUTO pick; an explicit mapping stays the caller's call.
  if (!mapping && map.chan != null && sniff.header) {
    const lines0 = sampleRecords(head, sniff.delim, { max: 40 }).slice(1);
    const split0 = splitter(sniff.delim);
    const vals0 = lines0.map((l) => (split0(l)[map.chan] || '').trim()).filter(Boolean);
    if (vals0.length && vals0.every((v) => Number.isNaN(Number(v)))) map.chan = null;
  }

  // auto category: first column whose head-sample values are all non-numeric
  let catCol = map.cat;
  if (catCol === -1) catCol = null;                         // stated: no category
  else if (catCol == null && sniff.header) {
    const lines = sampleRecords(head, sniff.delim, { max: 40 }).slice(1);
    const split = splitter(sniff.delim);
    for (let i = 0; i < sniff.columns && catCol == null; i++) {
      if (i === map.x || i === map.y || i === map.z || i === map.chan) continue;
      const vals = lines.map((l) => (split(l)[i] || '').trim()).filter(Boolean);
      if (vals.length && vals.every((v) => Number.isNaN(Number(v)))) catCol = i;
    }
  }

  // per-block dimension columns (DX/DY/DZ, XINC…) → the model may be SUB-BLOCKED
  // (variable box size). Discovery tracks the fine pitch (min dim/axis) + the
  // distinct (dx,dy,dz) triples that become the size-code palette.
  const dimCols = dims || findDimColumns(sniff.header) || { x: -1, y: -1, z: -1 };
  const hasDims = dimCols.x >= 0;
  const minDim = [Infinity, Infinity, Infinity];
  const dimSet = new Set();

  // ── sweep 1: discovery — axis distincts + extents + category dictionary ──
  const ax = [new Set(), new Set(), new Set()];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const catCounts = new Map();
  const round10 = (v) => Number(v.toPrecision(10));
  let count = 0;
  const hasHeaderRow = !!sniff.header && !sniff.generated;
  const anchors = [];                                      // sparse record index: byte offset of every indexEvery-th accepted row
  const RES = 50000, res = [];                             // reservoir: the first centroids (rotated-lattice inference)
  let declaredMisfit = null;
  for await (const { fields, at } of lineFieldsWithOffsets(blob, sniff.delim, hasHeaderRow, { signal, onProgress })) {
    for (let fi = 0; fi < fields.length; fi++) {
      const f = fields[fi];
      const xv = +f[map.x], yv = +f[map.y], zv = +f[map.z];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
      if (count % indexEvery === 0) anchors.push(at[fi]);
      if (lattice && declaredMisfit === null) declaredMisfit = latticeMisfit(lattice, xv, yv, zv, count);
      else if (!lattice && res.length < RES * 3) res.push(xv, yv, zv);
      count++;
      if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
      if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
      if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
      if (ax[0].size < CAP_DISTINCT) ax[0].add(round10(xv));
      if (ax[1].size < CAP_DISTINCT) ax[1].add(round10(yv));
      if (ax[2].size < CAP_DISTINCT) ax[2].add(round10(zv));
      if (catCol != null && catCounts.size <= 256) { const v = (f[catCol] || '').trim(); if (v) catCounts.set(v, (catCounts.get(v) || 0) + 1); }
      if (hasDims) {
        const dx = +f[dimCols.x], dy = +f[dimCols.y], dz = +f[dimCols.z];
        if (dx > 0 && dy > 0 && dz > 0) {
          if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
          if (dimSet.size <= DIM_PALETTE_MAX) dimSet.add(dimKey(dx, dy, dz));
        }
      }
    }
  }

  if (lattice && declaredMisfit) throw new Error(`declared lattice rejected — ${declaredMisfit}`);
  const axes = ax.map((s) => (s.size < CAP_DISTINCT ? inferAxis([...s].sort((a, b) => a - b)) : null));
  let grid = lattice ? { ...lattice } : axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;

  // ── sub-blocked detection ── dims vary → fine-lattice IJK (pitch = min dim /2,
  // so every power-of-2 sub-block centroid lands on it) + a size-code palette.
  // Off the fine lattice (non-power-of-2 splits) → leave it null → points fallback.
  let subBlocked = false, dimPalette = null, dimInfo = null;
  const sb = hasDims && !lattice ? inferSubBlockLattice(ax, minDim, dimSet, { cap: CAP_DISTINCT }) : null;
  if (sb) {
    subBlocked = true;
    dimPalette = sb.dimPalette;                                // half-dims (box radius)
    dimInfo = { cols: dimCols, code: sb.dimCode };
    grid = sb.grid;                                            // fine lattice → IJK
  }
  // not an axis-aligned grid → maybe a ROTATED one (a candidate, for the caller to confirm)
  let latticeCandidate = null;
  if (!grid && !subBlocked && rotated && res.length >= 24) {
    const coordSweep = () => (async function* () {
      for await (const batch of lineFields(blob, sniff.delim, hasHeaderRow, { signal })) {
        const n = batch.length, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
        for (let i = 0; i < n; i++) { const f = batch[i]; x[i] = +f[map.x]; y[i] = +f[map.y]; z[i] = +f[map.z]; }
        yield { x, y, z, count: n };
      }
    })();
    latticeCandidate = await detectRotatedLattice(Float64Array.from(res), coordSweep);
  }
  const categories = catCol != null && catCounts.size > 0 && catCounts.size <= 255
    ? [...catCounts.keys()].sort() : null;
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;

  // every plausible scalar column (numeric in the head sample, not a coord/dim) —
  // the UI offers these as color channels; switching re-runs sweep 2 only.
  const numericColumns = [];
  if (sniff.header) {
    const lines2 = sampleRecords(head, sniff.delim, { max: 40 }).slice(1);
    const split2 = splitter(sniff.delim);
    for (let i = 0; i < sniff.columns; i++) {
      if (i === map.x || i === map.y || i === map.z || DIM_RE.test(sniff.header[i].trim())) continue;
      const vals = lines2.map((l) => (split2(l)[i] || '').trim()).filter(Boolean);
      if (vals.length && vals.every((v) => !Number.isNaN(Number(v)))) numericColumns.push({ i, name: sniff.header[i] });
    }
  }
  const header = {
    kind: 'blockmodel', count,
    bbox: { min, max },
    grid,                                                   // null → not a regular grid (points fallback)
    latticeCandidate,                                       // a detected ROTATED lattice, not applied (caller confirms) — or null
    lattice: lattice ? { basis: 'declared' } : null,
    subBlocked, dimPalette, dimCols: subBlocked ? dimCols : null,   // variable-size boxes: half-dim palette + size-code per block
    columns: sniff.header, mapping: { ...map, cat: categories ? catCol : null },
    delim: sniff.delim, hasHeaderRow,                       // for external sweeps (the filter mask)
    index: { k: indexEvery, offsets: Float64Array.from(anchors) },   // sparse line-offset index (fetchDelimitedRecord)
    numericColumns,
    categories,
    attributes: [
      ...(map.chan != null && sniff.header ? [sniff.header[map.chan]] : []),
      ...(categories && sniff.header ? [sniff.header[catCol]] : []),
    ],
  };

  // ── sweep 2 (cold recipe): the shared stream factory ──
  const streamChunks = makeDelimitedStream(blob, sniff.delim, hasHeaderRow, map, catCol, catCode, dimInfo);

  return { header, streamChunks };
}

// ── the TABLE provider: a delimited file with NO geometry ─────────────────────
// Not every table in a project is spatial — a join source, a parameter table, a
// cut-off/density lookup, a price deck, an analysis result. This reads one as a
// plain tabular document: columns, a row count, numeric-column detection, and
// the line index `fetchDelimitedRecord` needs. No coordinates, no bbox, no
// chunks — nothing here reaches the renderer.
export async function openTable(blob, { signal, onProgress } = {}) {
  const sniff = sniffDelimited(await blob.slice(0, 64 * 1024).text());   // { delim, header: [names]|null, columns: n }
  const hasHeaderRow = !!sniff.header;
  const columns = sniff.header
    ? sniff.header.map((h, i) => String(h).trim() || `col${i + 1}`)
    : Array.from({ length: sniff.columns }, (_, i) => `col${i + 1}`);
  // one pass: count the rows and sample each column's type (a column is numeric
  // when ≥90% of its non-empty values parse — the same tolerance the block
  // provider uses, so mixed columns with a stray 'n/a' still read as numbers)
  const stat = columns.map(() => ({ n: 0, num: 0 }));
  let count = 0;
  for await (const batch of lineFields(blob, sniff.delim, hasHeaderRow, { signal, onProgress })) {
    for (const f of batch) {
      for (let i = 0; i < columns.length && i < f.length; i++) {
        const v = f[i];
        if (v === '' || v == null) continue;
        stat[i].n++;
        if (Number.isFinite(+v)) stat[i].num++;
      }
      count++;
    }
  }
  const numericColumns = [];
  for (let i = 0; i < columns.length; i++) if (stat[i].n && stat[i].num / stat[i].n >= 0.9) numericColumns.push({ i, name: columns[i] });
  // a table needs ROWS. Prose lands here with a plausible-looking delimiter and
  // no data — "0 rows · 10 columns" is not a table, it is a misread file.
  if (!count) throw new Error('no data rows — this does not look like a table');
  return { header: { table: true, columns, count, delim: sniff.delim, hasHeaderRow, numericColumns, mapping: null, grid: null, bbox: null } };
}
