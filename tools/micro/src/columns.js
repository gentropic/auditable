// micro columns — the derived-column STORAGE subsystem: materialized (matcol)
// accessors + the one-column-one-Parquet codec, and the budgeted PIN CACHE that
// governs both filter pins and matcol residency. No project-FS access here —
// the app injects the sidecar reader (setSidecarReader); UI reactions to a
// changed column set are injected too (setColumnsChangedHook).
import { parquetInfo, readParquetRange, writeParquet } from '../../../ext/parquet/index.js';
import { deps, parse } from '../../../ext/expr/index.js';
import { layerBlob, attrRowCountOf, layerTableHeader, colIsNumeric, blockCaps, layerRows, extendRow, rowQualifier } from './records.js';
import { openDmModel, classifyQualified } from '../../../ext/condenser/src/main.js';
import { colAcc, scanParquetInWorkers, STAT_SLICE } from './colstats.js';
import { sourceHash, sourceHashSync, sameSource } from './identity.js';

export const PAINT_BLANK = '#33373c';                      // unpainted recedes toward the background

export function paintRecount(col) {
  const counts = new Uint32Array(col.dict.length);
  for (let i = 0; i < col.codes.length; i++) if (col.codes[i] < counts.length) counts[col.codes[i]]++;
  col.counts = counts;
  return counts;
}

// ── materialized numeric columns ──────────────────────────────────────────────
// A materialized column is a PAINT column (kind 'ratio') carrying a full-precision
// `fvalues` Float32 backing (`mat:true`): the `codes` give the 256-level GPU colour
// (visually fine), `fvalues` give full precision for filter/GT/export, and the
// legend reads the real [min,max]. Aligned 1:1 by record index. The fvalues
// persist in a per-layer <layer>.cols/ sidecar (project dir → FSAA/OPFS), else
// IDB (loose), else memory; a manifest sourceHash guards a source reorder.
// Source-agnostic — "materialize a calc column" and other producers write here.
//
// The identity is "size:rows:hash" — the hash a sampled CONTENT hash (src/identity.js)
// of the layer's source (a drillhole layer's: its interval table, the file its rows
// come from; its size field stays 0, as it always was). Compare identities with
// sameSource, never ===: one written before hashes is "size:rows" and still matches.
const idBlob = (L) => layerBlob(L) || (L && L.dh && L.docs.dhDoc && L.docs.dhDoc.blobs && L.docs.dhDoc.blobs.intervals) || null;
export function ensureSourceHash(L) { return sourceHash(idBlob(L)); }   // await before writing or comparing an identity
export function matColSourceHash(L) {
  const b = layerBlob(L), ib = idBlob(L);
  const h = sourceHashSync(ib);
  if (!h && ib) sourceHash(ib);                            // fill the cache for the next caller
  return `${(b && b.size) || 0}:${attrRowCountOf(L) || 0}${h ? ':' + h : ''}`;
}
export function matColLooseId(L) { const b = layerBlob(L); return `${L.name}:${(b && b.size) || 0}`; }
export function matColList(L) { return ((L && L.paintCols) || []).filter((c) => c.mat); }
// everything the .cols/ sidecar stores: numeric matcols + ALL dict category
// columns (op-produced AND hand-paint — dense string Parquet; the spec's call:
// paint is an ordinary dense category column). Still on project.json RLE:
// '_swath' (volatile zebra) + non-mat ratio brushes (codes ARE the value).
export const isStoredCat = (c) => !c.mat && c.kind !== 'ratio' && c.name !== '_swath';
export function storedCols(L) { return ((L && L.paintCols) || []).filter((c) => c.mat || isStoredCat(c)); }
export function matColGet(L, name) { return matColList(L).find((c) => c.name === name) || null; }
// derive 256-level display codes (1..255) from fvalues over [min,max]; NaN → 0 (blank)
export function matColCodes(fvalues, min, max) {
  const span = (max - min) || 1, codes = new Uint8Array(fvalues.length);
  for (let i = 0; i < fvalues.length; i++) { const v = fvalues[i]; codes[i] = Number.isFinite(v) ? 1 + Math.max(0, Math.min(254, Math.round(254 * (v - min) / span))) : 0; }
  return codes;
}
// golden-angle hues, same family as the category palette — the default color
// for a rule / a restored category without one
export function ruleDefaultColor(i) {
  const h = (i * 137.508) % 360, s = 0.62, v = 0.86;
  const f = (n2) => { const k = (n2 + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  const hx = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + hx(f(5)) + hx(f(3)) + hx(f(1));
}
// the app's UI reaction to a changed column set (color-by options track it)
let _onColumnsChanged = () => {};
export function setColumnsChangedHook(fn) { _onColumnsChanged = fn; }
export const columnsChanged = (L) => _onColumnsChanged(L);   // for sibling modules (element-store)
// attach (or replace) a materialized column: fvalues (truth) + derived paint codes
export function matColSet(L, name, fvalues, meta = {}) {
  let mn = Infinity, mx = -Infinity, nn = 0;
  for (let i = 0; i < fvalues.length; i++) { const v = fvalues[i]; if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; nn++; } }
  if (!nn) { mn = 0; mx = 0; }
  const col = { name, kind: 'ratio', mat: true, fvalues, codes: matColCodes(fvalues, mn, mx), dict: [''], colors: ['#000000'], blankColor: PAINT_BLANK, min: mn, max: mx, count: fvalues.length, nonnull: nn, lineage: meta.lineage || null, source: matColSourceHash(L) };
  paintRecount(col);
  pinPutMatcol(L, col);                                    // governed residency: evictable under the pin budget
  L.paintCols = (L.paintCols || []).filter((c) => c.name !== name); L.paintCols.push(col);
  L._colStats = null; L._calcFns = null;                   // schema changed → invalidate cached scans/fns
  _onColumnsChanged(L);
  return col;
}
// one column ↔ one Parquet file (manifest rule A.1): typed, null-aware (NaN ↔ null),
// SNAPPY, canonical 256K row groups with footer stats — a materialized column reads
// like any base column and gains push-down. Legacy raw .f32 still loads (PAR1 sniff).
export function matColEncode(c) {
  const data = c.mat
    ? Array.from(c.fvalues, (v) => (Number.isFinite(v) ? v : null))
    : Array.from(c.codes, (code) => (code ? (c.dict[code] ?? null) : null));   // category: dict-decoded strings
  return writeParquet({
    columnData: [{ name: c.name, data }],
    codec: 'SNAPPY', rowGroupSize: 1 << 18,
    kvMetadata: [{ key: 'micro:lineage', value: JSON.stringify(c.lineage || null) }],
  });
}
export async function matColDecodeStr(bytes) {
  const u8v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const info = parquetInfo(u8v);
  const name = info.columns[0].name || info.columns[0];
  return (await readParquetRange(u8v, [name], 0, info.rowCount, info.meta))[name];
}
export async function matColDecode(bytes) {
  const u8v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(u8v[0] === 0x50 && u8v[1] === 0x41 && u8v[2] === 0x52 && u8v[3] === 0x31)) return new Float32Array(u8v.buffer.slice(u8v.byteOffset, u8v.byteOffset + u8v.byteLength));   // legacy raw .f32
  const info = parquetInfo(u8v);
  const name = info.columns[0].name || info.columns[0];
  const a = (await readParquetRange(u8v, [name], 0, info.rowCount, info.meta))[name];
  const out = new Float32Array(info.rowCount);
  for (let i = 0; i < info.rowCount; i++) { const v = a[i]; out[i] = v == null ? NaN : v; }
  return out;
}

// ── the PIN CACHE (filter tier 3: prune → scan → REFINE) ──────────────────────
// After a filter scans a layer once, the columns it touched stay pinned (typed
// arrays / dict codes) inside a GLOBAL, budgeted, LRU pool — the next filter
// change evaluates over pinned columns via compileChunk with NO file read.
// Budget: localStorage 'micro.pinBudget' = 'off' | 'auto' | MB; auto scales with
// navigator.deviceMemory. Exact accounting (we own every array); eviction is
// column-granular LRU; entries carry the layer sourceHash (stale → drop).
const _pinCache = new Map(); let _pinBytes = 0, _pinTick = 0;
export function pinBudgetBytes() {
  let v = 'auto'; try { v = localStorage.getItem('micro.pinBudget') || 'auto'; } catch { /* private mode */ }
  if (v === 'off') return 0;
  if (v === 'auto') { const dm = (navigator.deviceMemory || 4); return Math.min(1024, Math.max(128, dm * 64)) * 1048576; }   // 8 GB → 512 MB
  return Math.max(0, +v || 0) * 1048576;
}
export function setPinBudget(v) { try { localStorage.setItem('micro.pinBudget', String(v)); } catch { /* ignore */ } pinTrim(); }
export function pinStats() { return { bytes: _pinBytes, budget: pinBudgetBytes(), cols: _pinCache.size }; }
export function pinTrim(extra = 0) {
  const cap = pinBudgetBytes();
  if (cap === 0) { _pinCache.clear(); _pinBytes = 0; return; }
  while (_pinBytes + extra > cap && _pinCache.size) {      // LRU: evict the least-recently-used column
    let lk = null, lt = Infinity;
    for (const [k, e] of _pinCache) if (e.t < lt) { lt = e.t; lk = k; }
    const e = _pinCache.get(lk); _pinCache.delete(lk); _pinBytes -= e.bytes;
    if (e.matcol && e.ref) e.ref.fvalues = null;           // governed residency: drop the values, keep codes (display)
  }
}
// ── GOVERNED matcol residency: fvalues register in the SAME budgeted LRU pool
// the filter pins use — resident while the budget allows (sync access intact),
// EVICTABLE under pressure, re-faulted ASYNC from the sidecar Parquet at the
// next scan that needs them (every scan head calls ensureStoredValues first).
// This is spec-step "kill resident fvalues" delivered as governance: bounded
// memory now, and the injected sidecar reader IS the read machinery true
// lazy-chunking would build on. Budget 'off' → nothing registers → always-resident.
export function pinPutMatcol(L, pc) {
  if (!pc.fvalues || pinBudgetBytes() === 0) return;
  const k = L.id + ':#mat:' + String(pc.name).toLowerCase();
  const old = _pinCache.get(k); if (old) _pinBytes -= old.bytes;
  const e = { matcol: true, ref: pc, bytes: pc.fvalues.byteLength, hash: matColSourceHash(L), t: ++_pinTick };
  pinTrim(e.bytes);
  _pinCache.set(k, e); _pinBytes += e.bytes;               // always registered (governance, not admission)
}
export function pinTouchMatcol(L, pc) { const e = _pinCache.get(L.id + ':#mat:' + String(pc.name).toLowerCase()); if (e) e.t = ++_pinTick; }
// the app injects how a stored column's bytes are read back (project sidecar /
// IDB) — this module owns residency, not the filesystem
let _readSidecarCol = async () => null;
export function setSidecarReader(fn) { _readSidecarCol = fn; }
export async function ensureStoredValues(L, needed) {      // needed: lowercased Set, or null = every matcol
  if (!L) return;
  for (const pc of matColList(L)) {
    if (needed && !needed.has(String(pc.name).toLowerCase())) continue;
    if (pc.fvalues) { pinTouchMatcol(L, pc); continue; }
    const buf = await _readSidecarCol(L, pc.name);
    if (!buf) { const el = document.querySelector('#meta'); if (el) el.textContent = `${pc.name}: values not resident and no sidecar — re-run the op`; continue; }
    pc.fvalues = await matColDecode(buf);
    pinPutMatcol(L, pc);
  }
}
export function pinPut(L, name, entry) {
  if (pinBudgetBytes() === 0) return;
  entry.bytes = (entry.data ? entry.data.byteLength : entry.codes.byteLength + entry.dict.join('').length * 2);
  entry.hash = matColSourceHash(L); entry.t = ++_pinTick;
  pinTrim(entry.bytes);
  if (entry.bytes + _pinBytes > pinBudgetBytes()) return;  // single column over budget → don't pin
  const k = L.id + ':' + String(name).toLowerCase();
  const old = _pinCache.get(k); if (old) _pinBytes -= old.bytes;
  _pinCache.set(k, entry); _pinBytes += entry.bytes;
}
export function pinGet(L, name) {
  const e = _pinCache.get(L.id + ':' + String(name).toLowerCase());
  if (!e) return null;
  if (!sameSource(e.hash, matColSourceHash(L))) { pinEvictLayer(L.id); return null; }   // source changed → stale
  e.t = ++_pinTick; return e;
}
export function pinEvictLayer(id) { for (const [k, e] of [..._pinCache]) if (k.startsWith(id + ':')) { _pinCache.delete(k); _pinBytes -= e.bytes; } }
// a pinned column's values for records [start, start+n) as compileChunk input
export function pinWindow(e, start, n, scratch) {
  if (e.data) return e.data.subarray(start, start + n);    // numeric: zero-copy view
  const a = scratch && scratch.length >= n ? scratch : new Array(n);
  for (let i = 0; i < n; i++) a[i] = e.dict[e.codes[start + i]] ?? '';   // dict: decode a window
  return a;
}

// ── the resolver's CHUNK FACE ── census-aligned column arrays for records
// [start, start+n): base from decoded columns (zero-copy), materialized as
// Float32 subarray VIEWS, paint decoded to dict strings, calcs REALIZED
// chunk-wise (compileChunk) in dependency order. PROJECTED: only `needed`
// (lowercased) columns materialize; the rest stay null (blank).
export function censusChunkCols(L, h, baseByName, start, n, needed, calcChunkFns) {
  const base = h.columns, pcs = (L && L.paintCols) || [], ccs = (L && L.calcCols) || [];
  const out = new Array(base.length + pcs.length + ccs.length).fill(null);
  for (let i = 0; i < base.length; i++) { const c = baseByName[base[i]]; if (c) out[i] = c; }
  for (let j = 0; j < pcs.length; j++) {
    const pc = pcs[j];
    if (needed && !needed.has(String(pc.name).toLowerCase())) continue;
    if (pc.mat) { out[base.length + j] = pc.fvalues ? pc.fvalues.subarray(start, start + n) : null; continue; }   // evicted mid-scan → blanks (ensureStoredValues at scan heads prevents this)
    const a = new Array(n);
    for (let i = 0; i < n; i++) { const code = pc.codes[start + i] || 0; a[i] = pc.kind === 'ratio' ? +(code / 255).toFixed(3) : ((code && pc.dict[code]) || ''); }
    out[base.length + j] = a;
  }
  if (calcChunkFns) for (const { slot, fn } of calcChunkFns) { const { buf } = fn(out, n); out[slot] = buf; }
  return out;
}
// an expression's dependency cone, calc-EXPANDED (lowercased names)
export function expandedDeps(L, ast) {
  const out = new Set(); const ccs = new Map(((L && L.calcCols) || []).map((c) => [String(c.name).toLowerCase(), c]));
  const walk = (a) => { let ds = []; try { ds = deps(a); } catch { /* bad expr */ } for (const d of ds) { const k = String(d).toLowerCase(); if (out.has(k)) continue; out.add(k); const cc = ccs.get(k); if (cc) { try { walk(parse(cc.expr)); } catch { /* ignore */ } } } };
  walk(ast); return out;
}
// the shared TIER-3 sweep: evaluate the filter over PINNED columns in 256K
// windows (no file read). Returns hits, or -1 if superseded (caller returns).
// Everything app-side arrives injected: chunkF compiles the filter, o carries
// the mask + collect callback + the liveness check.
export async function pinnedSweep(AL, header, m, names, needL, calcChunkFns, chunkF, o) {
  const total = header.count, scr = {};
  const cn = (i) => header.columns[i];
  const gx = pinGet(AL, cn(m.x)), gy = pinGet(AL, cn(m.y)), gz = pinGet(AL, cn(m.z));
  const gch = m.chan != null ? pinGet(AL, cn(m.chan)) : null, gca = m.cat != null ? pinGet(AL, cn(m.cat)) : null;
  let hits = 0;
  for (let at = 0; at < total; at += (1 << 18)) {
    const n = Math.min(1 << 18, total - at);
    const byName = {};
    names.forEach((t, ci) => { byName[t.k] = pinWindow(pinGet(AL, t.k), at, n, scr[ci] || (scr[ci] = [])); });
    const ccols = censusChunkCols(AL, header, byName, at, n, needL, calcChunkFns);
    const mk = chunkF(ccols, n);
    const wX = pinWindow(gx, at, n), wY = pinWindow(gy, at, n), wZ = pinWindow(gz, at, n);
    const wCh = gch ? pinWindow(gch, at, n) : null, wCa = gca ? pinWindow(gca, at, n, scr._c || (scr._c = [])) : null;
    for (let i = 0; i < n; i++) {
      if (mk[i] !== 1) continue;
      const xv = +wX[i], yv = +wY[i], zv = +wZ[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
      const r = at + i;
      o.mask[r] = 1; hits++;
      const code = o.catCode && wCa ? (o.catCode.get(String(wCa[i] ?? '').trim()) ?? 0) : 0;
      o.collect(xv, yv, zv, wCh ? +wCh[i] : 0, code, r);
    }
    await new Promise((r2) => setTimeout(r2)); if (!o.alive()) return -1;
  }
  return hits;
}
// ── column statistics ─────────────────────────────────────────────────────────
// Per-column stats for the columns tab and the styling histogram: welford +
// t-digest for numbers, topK/cardinality for text. Streamed, bounded memory.
//
// opts.columns — the names to scan (default: every column). A partial scan
//   MERGES into L._colStats, so asking for one column never drops the others.
// opts.bands — also collect per-64k-record-band min/max for every BASE numeric
//   column into L._bands, the .dm/CSV pushdown substrate (parquet's footer
//   stats, retrofitted). Whole-table scans only. Band numbering = the layer's
//   RECORD numbering (raw for .dm/parquet, accepted rows for delimited).
// opts.signal — an AbortSignal; an aborted scan throws AbortError and leaves
//   L._colStats as it was.
// opts.workers — false keeps a Parquet scan on the page (the fallback path).
//
// Parquet base columns go to a pool of workers (colstats.js), row groups
// shared out, states merged; where workers can't run (file://) the page does it.
// Parquet and .dm base columns are read COLUMNAR (only the asked-for columns,
// typed batches, no row arrays); calc/paint columns and delimited sources ride
// the row pass (extendRow needs whole rows). onTick(done, total) reports rows.
const YIELD_MS = 12;

export async function scanColumns(L, onTick, { bands = false, columns = null, signal = null, workers = true } = {}) {
  const h = layerTableHeader(L); if (!h) return null;
  const calc = L.calcCols || [];
  const paint = L.paintCols || [];
  const nBase = h.columns.length;
  const cols = h.columns.concat(calc.map((c) => c.name), paint.map((c) => c.name));
  const isNumAt = (i) => (i < nBase ? colIsNumeric(L, h, i)
    : i < nBase + calc.length ? (calc[i - nBase].ty || 'number') === 'number'
    : paint[i - nBase - calc.length].kind === 'ratio');   // painted = categorical, ratio = numeric
  const want = columns ? new Set(columns) : null;
  const idxs = cols.map((_, i) => i).filter((i) => !want || want.has(cols[i]));
  if (want) bands = false;                                 // bands index the whole table, never a subset
  const acc = colAcc();
  const st = new Map(idxs.map((i) => [i, acc.create(isNumAt(i))]));
  const doc = L.docs.blockDoc;
  const columnar = !!(doc && (doc.parquet || (doc.header && doc.header.dm)));
  const colIdx = columnar ? idxs.filter((i) => i < nBase) : [];
  const rowIdx = columnar ? idxs.filter((i) => i >= nBase) : idxs;
  const total = (doc && doc.header && doc.header.count) || 0;
  const passes = (colIdx.length ? 1 : 0) + (rowIdx.length ? 1 : 0);
  let pass = 0;
  const tick = onTick ? (done) => onTick(Math.round((pass * total + done) / Math.max(1, passes)), total) : null;
  const pacer = makePacer(signal);
  const BAND = 65536;
  let bandData = null, rows = 0;
  const qual = new Map();                                 // column → { below, above, code } substituted on read (the row scan fills it)
  // Parquet: a pool of workers, row groups handed out (null = can't run here → below)
  let via = 'page';
  if (colIdx.length && doc.parquet && !bands && workers) {
    const P = doc.parquet;
    const got = await scanParquetInWorkers({ file: P.buf, meta: P.meta, rowGroups: P.rowGroups, cols: colIdx.map((i) => ({ name: h.columns[i], num: isNumAt(i) })), signal, onProgress: tick });
    if (got) { colIdx.forEach((i, k) => st.set(i, got[k])); rows = total; pass++; colIdx.length = 0; via = 'workers'; }
  }
  if (colIdx.length) {
    const bandCols = bands ? colIdx.filter((i) => isNumAt(i)) : [];
    if (bands) bandData = new Map(bandCols.map((i) => [i, []]));
    for await (const { start, count, i, arr } of columnarBatches(L, colIdx, signal)) {
      {
        const c = st.get(i);
        for (let a = 0; a < count; a += STAT_SLICE) {
          const b = Math.min(count, a + STAT_SLICE);
          if (c.num) acc.pushNumbers(c, arr, a, b); else for (let k = a; k < b; k++) acc.pushText(c, arr[k]);
          await pacer();
        }
        if (bandData && bandData.has(i)) bandMinMax(bandData.get(i), arr, count, start, BAND);
      }
      rows = Math.max(rows, start + count);
      if (tick) tick(rows);
    }
    pass++;
  }
  if (rowIdx.length) {
    const bandCols = bands && !colIdx.length ? h.columns.map((nm, i) => (colIsNumeric(L, h, i) ? i : -1)).filter((i) => i >= 0) : [];
    if (bandCols.length) bandData = new Map(bandCols.map((i) => [i, []]));
    const mSc = h.mapping || {};
    const isDelimSc = !blockCaps(L).rowIsRecord;           // renderer record numbering for painted lookups (delimited skips bad-coord rows)
    let recSc = 0, done = 0;
    rows = 0;
    // read RAW and qualify here, so the scan can count what was substituted
    // (<x below detection, >x above, lab codes) — the stats say so, never silently
    const q = rowQualifier(L);
    for await (const batch of layerRows(L, null, { raw: true })) {
      for (const fr of batch) {
        const f0 = q ? q(fr) : fr;
        if (f0 !== fr) for (let i = 0; i < nBase; i++) if (f0[i] !== fr[i]) {
          let t = qual.get(i); if (!t) qual.set(i, (t = { below: 0, above: 0, code: 0 }));
          const k = classifyQualified(fr[i]).kind;
          if (k === 'below' || (k === 'num' && +fr[i] < 0)) t.below++; else if (k === 'above') t.above++; else t.code++;
        }
        let rAt = null;
        if (!isDelimSc) rAt = recSc++;
        else if (Number.isFinite(+f0[mSc.x]) && Number.isFinite(+f0[mSc.y]) && Number.isFinite(+f0[mSc.z])) rAt = recSc++;
        const f = extendRow(L, f0, rAt);
        rows++;
        if (bandCols.length && rAt != null) {              // band index rides the layer's record numbering (raw for .dm, accepted for CSV)
          const at = ((rAt / BAND) | 0) * 2;
          for (const i of bandCols) {
            const x = typeof f0[i] === 'number' ? f0[i] : parseFloat(f0[i]);
            if (!Number.isFinite(x)) continue;
            const arr = bandData.get(i);
            if (arr[at] === undefined) { arr[at] = x; arr[at + 1] = x; }
            else { if (x < arr[at]) arr[at] = x; if (x > arr[at + 1]) arr[at + 1] = x; }
          }
        }
        for (const i of rowIdx) {
          const c = st.get(i);
          if (c.num) acc.pushNumber(c, f[i]); else acc.pushText(c, f[i]);
        }
        if ((++done & 4095) === 0) await pacer();
      }
      if (tick) tick(rows);
      await pacer();
    }
    pass++;
  }
  if (signal && signal.aborted) throw abortError();
  if (bandData) {
    const colsOut = {};
    for (const [i, arr] of bandData) colsOut[h.columns[i]] = Array.from(arr, (v) => (v === undefined ? null : v));
    L._bands = { size: BAND, cols: colsOut };
  }
  const out = want && L._colStats ? { ...L._colStats } : {};
  for (const i of idxs) out[cols[i]] = acc.result(st.get(i), rows);
  for (const [i, t] of qual) if (out[cols[i]]) out[cols[i]].qual = t;   // { below, above, code } substituted on read
  L._colStats = out;
  L._lastScan = { via };                                   // which path ran (the smoke reads it)
  return out;
}

// every column of the table has a scanned entry (a partial scan leaves gaps)
export function colStatsComplete(L) {
  const h = layerTableHeader(L);
  if (!h || !L._colStats) return false;
  const names = h.columns.concat((L.calcCols || []).map((c) => c.name), (L.paintCols || []).map((c) => c.name));
  return names.every((n) => L._colStats[n]);
}

// what Parquet's footer already knows, per column, before any scan: n, nulls,
// min and max (numbers only). { name → { kind:'num', n, nulls, min, max, footer:true } }
// or null for a source with no footer.
export function footerColStats(L) {
  const P = L.docs && L.docs.blockDoc && L.docs.blockDoc.parquet;
  if (!P || !P.rowGroups) return null;
  const out = {};
  for (const rg of P.rowGroups) {
    for (const name in rg.columns || {}) {
      const c = rg.columns[name];
      const o = out[name] || (out[name] = { kind: 'num', n: 0, nulls: 0, min: Infinity, max: -Infinity, footer: true, ok: true });
      o.n += rg.rowCount; o.nulls += c.nulls || 0;
      if (typeof c.min === 'number' && typeof c.max === 'number') { if (c.min < o.min) o.min = c.min; if (c.max > o.max) o.max = c.max; } else o.ok = false;
    }
  }
  for (const name in out) {
    const o = out[name];
    o.n -= o.nulls;
    if (!o.ok || o.min === Infinity) delete out[name];   // a text column, or a group without stats
    else delete o.ok;
  }
  return out;
}

// columnar batches of BASE columns, ONE column at a time: { start, count, i, arr }
// (i = the column index, start = the batch's first record). Parquet: one row
// group at a time, one column chunk decoded per call — one column resident and
// the page never waits on a whole group's decode. .dm: strided, those fields only.
async function* columnarBatches(L, colIdx, signal) {
  const doc = L.docs.blockDoc, h = doc.header;
  if (doc.parquet) {
    const P = doc.parquet;
    let start = 0;
    for (const rg of P.rowGroups) {
      const count = rg.rowCount;
      for (const i of colIdx) {
        if (signal && signal.aborted) throw abortError();
        const name = h.columns[i];
        const got = await readParquetRange(P.buf, [name], start, start + count, P.meta);
        yield { start, count, i, arr: got[name] };
      }
      start += count;
    }
    return;
  }
  const { columnBatches } = await openDmModel(doc.blob);
  for await (const { recStart, count, cols } of columnBatches(colIdx)) {
    for (const i of colIdx) {
      if (signal && signal.aborted) throw abortError();
      yield { start: recStart, count, i, arr: cols[i] };
    }
  }
}

// per-64k-record band min/max of one column batch (records start..start+count)
function bandMinMax(out, col, count, start, BAND) {
  for (let k = 0; k < count; k++) {
    const v = col[k];
    const x = typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v));
    if (!Number.isFinite(x)) continue;
    const at = (((start + k) / BAND) | 0) * 2;
    if (out[at] === undefined) { out[at] = x; out[at + 1] = x; }
    else { if (x < out[at]) out[at] = x; if (x > out[at + 1]) out[at + 1] = x; }
  }
}

// yield to the page every YIELD_MS of work (a fixed yield per batch either
// starves the page on big batches or wastes time on small ones); checks abort
function makePacer(signal) {
  let last = performance.now();
  return async () => {
    if (signal && signal.aborted) throw abortError();
    if (performance.now() - last < YIELD_MS) return;
    await new Promise((r) => setTimeout(r));
    last = performance.now();
    if (signal && signal.aborted) throw abortError();
  };
}
function abortError() { return Object.assign(new Error('scan cancelled'), { name: 'AbortError' }); }
