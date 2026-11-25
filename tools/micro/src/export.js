// micro export — a layer's records out: CSV (source text or the qualified
// numbers, decimal point or comma) or Parquet (written a row group at a time;
// Morton-sorted through condenser's external sort for a spatial index), and
// "Optimize to spatial Parquet" — the layer swapped in place for its sorted
// Parquet, with everything kept per record permuted to match. Carved from
// index.html (phase 3).
import { blockCaps, colIsNumericForStore, extendRow, layerRows, layerTableHeader } from './records.js';
import { ensureStoredValues, holdStoredValues } from './columns.js';
import { microModelOf, mkLineage } from './lineage.js';
import { createParquetBlobWriter } from '../../../ext/parquet/index.js';
import { basisAngles, coordNum, createMortonSorter, latticeMapOf, microModelLine, MICRO_MODEL_KEY } from '../../../ext/condenser/src/main.js';
import { fmtSize } from './paths.js';
import { S } from './state.js';
import { addPaintColorOptions } from './paint.js';
import { markProjectDirty } from './project.js';
import { openParquetBlocks } from './open-blocks.js';
import { renderLayers } from './layers-panel.js';
import { deliverBlob } from './hostio.js';
import { setLayerColorSel } from './color.js';
import { refilterLayer } from './filter.js';
import { setActiveLayer } from './layers.js';
import { applyLayerSelection } from './selection.js';
import { sceneOrigin } from './coords.js';
const $ = (s) => document.querySelector(s);

// ── export tools (§16): data leaves micro the way it came in — as ROWS.
// An export IS a filter sweep with a writer at the end: renderer record
// numbering (masks line up), extendRow carries ƒ calculated AND ✎ painted
// columns out — paint a DOMAIN by lasso, export, feed the estimator. CSV
// streamed into Blob parts → download; no size cliff. .dm exports too
// (@gcu/dm stays a reader — this is the .dm → CSV converter). ──
// A rotated Datamine model placed in world (one rotation about Z) is read and
// exported in WORLD coordinates, so the .dm's placement constants — ANGLEn / ROTAXISn
// (the rotation), X0/Y0/Z0 (where the local origin sits) and XMORIG… (the lattice
// corner in the LOCAL frame) — no longer describe the rows next to them: a package
// that re-applied ANGLE1 to these XC/YC/ZC would rotate them twice. They are not
// exported (`stale`); the lattice travels in micro:model (the Parquet kv, the CSV
// `# micro:model` line), and "lattice as columns" writes a self-consistent set.
// Counts (NX…) and sizes are frame-free and stay.
const DM_PLACEMENT = new Set(['ANGLE1', 'ANGLE2', 'ANGLE3', 'ROTAXIS1', 'ROTAXIS2', 'ROTAXIS3', 'X0', 'Y0', 'Z0', 'XMORIG', 'YMORIG', 'ZMORIG']);
export const STALE_PLACEMENT_NOTE = 'a Datamine placement constant — this model is exported in WORLD coordinates, which it no longer describes (re-applied, it would rotate them twice); the lattice travels in micro:model';
export function exportColumnsOf(L) {
  const h = layerTableHeader(L);
  if (!h) return null;
  const placed = !!(h.dm && h.dmRotationApplied);
  const cols = h.columns.map((name, i) => ({ name, num: colIsNumericForStore(L, h, i), badge: '', ...(placed && DM_PLACEMENT.has(String(name).toUpperCase()) ? { stale: STALE_PLACEMENT_NOTE } : {}) }));
  for (const c of L.paintCols || []) cols.push({ name: c.name, num: c.kind === 'ratio', badge: c.kind === 'ratio' && !c.mat ? '%' : '✎' });   // census order: stored derived before calc (must match extendRow)
  for (const c of L.calcCols || []) cols.push({ name: c.name, num: (c.ty || 'number') === 'number', badge: 'ƒ' });
  return cols;
}

// ── "lattice as columns": the Datamine habit — the model's lattice as CONSTANT
// columns on every row, for a package that reads neither micro:model carrier. Wasteful
// (the same numbers on every row) and off by default; the `# micro:model` line is the
// compact, checked path. Self-consistent in Datamine's reading, world = (X0,Y0,Z0) +
// R(ANGLE1 about Z)·(XL,YL,ZL), so the coordinates stay WORLD (XC/YC/ZC as written) and
// the local ones ride beside them:
//   rotated     X0 Y0 Z0 (world of the local origin) · ANGLE1 ROTAXIS1 (=3; a rotation
//               about Z only — a tilted lattice gets none, said) · XL YL ZL (local centroid)
//   regular     XMORIG YMORIG ZMORIG (lattice corner, local frame) · XINC YINC ZINC · NX NY NZ
//   sub-blocked no parent lattice is known — the sizes ride in their own columns
// → { cols: [{ name, value } | { name, local: 0|1|2 }], note } | null (no lattice)
const r12 = (v) => +(+v).toPrecision(12);
export function latticeConstantsOf(h) {
  const g = h && h.grid;
  if (!g || !g.x) return null;
  const cols = [], notes = [];
  const R = g.rot || null, A = g.anchor || [0, 0, 0];
  if (R) {
    cols.push({ name: 'X0', value: r12(A[0]) }, { name: 'Y0', value: r12(A[1]) }, { name: 'Z0', value: r12(A[2]) });
    if (basisAngles(R).zOnly) cols.push({ name: 'ANGLE1', value: r12(-Math.atan2(R[1], R[0]) * 180 / Math.PI) }, { name: 'ROTAXIS1', value: 3 });
    else notes.push('the lattice is tilted: no Datamine rotation is written (its three-rotation order is unverified) — the # micro:model line carries it');
    cols.push({ name: 'XL', local: 0 }, { name: 'YL', local: 1 }, { name: 'ZL', local: 2 });
  }
  if (!h.subBlocked) {
    const ax = [g.x, g.y, g.z];
    ['X', 'Y', 'Z'].forEach((n, a) => cols.push({ name: `${n}MORIG`, value: r12(ax[a].origin - ax[a].pitch / 2) }));
    ['X', 'Y', 'Z'].forEach((n, a) => cols.push({ name: `${n}INC`, value: r12(ax[a].pitch) }));
    ['X', 'Y', 'Z'].forEach((n, a) => cols.push({ name: `N${n}`, value: ax[a].count }));
  } else notes.push('sub-blocked: no parent lattice is known, so none is written — each block\'s size rides in its own columns');
  return { cols, note: notes.join('; ') };
}

export let _exportEpoch = 0;

// a long job the user can stop (export, optimize): the footer's cancel button —
// shown while it runs, one job at a time; done() hides it again
function busyCancel() {
  const b = $('#metaCancel'), ac = new AbortController();
  b.hidden = false; b.onclick = () => { ac.abort(); b.hidden = true; };
  return { signal: ac.signal, done: () => { b.hidden = true; b.onclick = null; } };
}

// both long jobs can be STOPPED: the footer's cancel button (busyCancel)
// aborts between batches — an export writes nothing, an optimize leaves the layer
// exactly as it was. A caller's own signal is honoured too.
const cancelled = (signal) => !!(signal && signal.aborted);
export async function runExport(L, opts = {}) {
  const bc = busyCancel();
  try { return await runExportInner(L, { ...opts, signal: opts.signal || bc.signal }); } finally { bc.done(); }
}
// latticeHeader: a CSV of a block model on a lattice starts with its `# micro:model`
//   line (grid/model.js) — micro reopens it as the same boxes, declared not inferred;
//   other readers skip `#` lines. Parquet always carries micro:model in its footer.
// latticeColumns: also write the lattice as constant columns (latticeConstantsOf).
async function runExportInner(L, { scope = 'all', colIdx = null, delim = ',', decimalComma = false, filename = 'export.csv', download = true, format = 'csv', codec = 'SNAPPY', spatialSort = false, qualified = false, signal = null, mask: maskIn = null, returnBlob = false, latticeHeader = true, latticeColumns = false } = {}) {
  const h = layerTableHeader(L); if (!h) return -1;
  await ensureStoredValues(L, null);                       // exports read every column
  const cols = exportColumnsOf(L);
  if (!colIdx) colIdx = cols.map((_, i) => i);
  colIdx = colIdx.filter((i) => !cols[i].stale);           // a placed .dm's rotation/origin constants: they'd lie next to world coordinates
  // the lattice as columns: they REPLACE any source column of the same name (a .dm's own
  // XMORIG… / NX… — the same numbers, now consistent with the local coordinates beside them)
  const lc = latticeColumns ? latticeConstantsOf(h) : null;
  const lcCols = lc ? lc.cols : [];
  if (lcCols.length) { const taken = new Set(lcCols.map((c) => c.name.toUpperCase())); colIdx = colIdx.filter((i) => !taken.has(String(cols[i].name).toUpperCase())); }
  const outNames = [...colIdx.map((i) => cols[i].name), ...lcCols.map((c) => c.name)];
  const nSrc = colIdx.length, nOut = outNames.length;
  const toLocal = lcCols.some((c) => c.local != null) ? latticeMapOf(h.grid) : null;
  const epoch = ++_exportEpoch;
  // maskIn: the records to write, given (the export tool's filter expression); else the scope's
  const mask = maskIn || (scope === 'matches' ? L._filterMask : scope === 'selection' ? L._selMask : null);
  if (!maskIn && scope !== 'all' && !mask) { $('#meta').textContent = `export: no ${scope === 'matches' ? 'filter' : 'selection'} on this layer`; return -1; }
  const sep = delim === 'tab' ? '\t' : delim;
  const needQuote = new RegExp('["\\r\\n' + (sep === '\t' ? '\\t' : '\\' + sep) + ']');
  const esc = (s) => (needQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const numAt = [...colIdx.map((i) => cols[i].num), ...lcCols.map(() => true)];
  // micro:model for this file — the whole model's (discovery included) for a full
  // export; a SUBSET's lattice part alone. Written only when the lattice can be read
  // back from what's written: the coordinate columns, and a sub-blocked model's sizes.
  const m0 = h.mapping || {};
  const written_ = new Set(colIdx.map((i) => cols[i].name));
  const latOk = !!(h.grid && [m0.x, m0.y, m0.z].every((k) => k != null && written_.has(h.columns[k]))
    && (!h.subBlocked || (h.dimCols && ['x', 'y', 'z'].every((a) => written_.has(h.columns[h.dimCols[a]])))));
  const isSubset = !!mask;
  const model = isSubset ? (latOk ? microModelOf(h, { latticeOnly: true, subset: maskIn ? 'filter' : scope }) : null)
    : (latOk || (format === 'parquet' && h.bbox) ? microModelOf(h) : null);
  const NUMRE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
  const fmt = (v, isNum) => {
    if (v == null || v === '') return '';
    const s = String(v);
    if (decimalComma && isNum && NUMRE.test(s)) return esc(s.replace('.', ','));
    return esc(s);
  };
  const isParquet = format === 'parquet';
  const m = h.mapping || {};
  // Parquet goes out ONE ROW GROUP AT A TIME (createParquetBlobWriter): the null-
  // aware arrays the writer takes exist for 64k rows at most. Sorted, the rows go
  // through condenser's EXTERNAL Morton sort first (bucketed, spilled as Blob
  // parts, read back bucket by bucket). Every exported column used to be one
  // boxed JS array for the whole model — ~12-18 GB at 50M rows × 15 columns.
  const doSort = isParquet && spatialSort && !!h.bbox && m.x != null;
  const GROUP = 1 << 16;                                   // a sub-multiple of the render chunk
  let pqw = null, sorter = null, grp = null, grpN = 0;
  if (isParquet) {
    // stamp the document frame (origin + any CRS) so georeferencing round-trips
    const expLin = mkLineage('export', { format: 'parquet', codec, scope, spatial: doSort, filter: (scope === 'filtered' && L.filterExpr) || undefined }, [L.lineage]);
    const kv = [
      { key: 'micro:frame', value: JSON.stringify({ origin: sceneOrigin(), crs: (h.crs || (L.docs.gridDoc && L.docs.gridDoc.grid.crs)) || null, spatial: doSort }) },
      { key: 'micro:lineage', value: JSON.stringify(expLin) },
      // a full export carries its discovery (self-describing on reopen); a filtered /
      // selection subset its LATTICE alone (frame, rotation, pitch, size columns) —
      // the whole model's bbox/categories would lie about the rows it holds
      ...(model ? [{ key: MICRO_MODEL_KEY, value: JSON.stringify(model) }] : []),
    ];
    const columnTypes = {}; outNames.forEach((nm, k) => { columnTypes[nm] = numAt[k] ? 'DOUBLE' : 'STRING'; });
    pqw = createParquetBlobWriter({ columnTypes, codec, kvMetadata: kv });
    if (doSort) sorter = createMortonSorter({ bbox: h.bbox, n: h.count || 0, kinds: numAt.map((x) => (x ? 'num' : 'str')), target: window.__msortTarget || undefined });
    else grp = outNames.map(() => []);
  }
  const flushGrp = () => { if (!grpN) return; pqw.write(outNames.map((nm, k) => ({ name: nm, data: grp[k] }))); grp = outNames.map(() => []); grpN = 0; };
  const one = isParquet ? new Array(nOut) : null;
  const lcVals = lcCols.map((c) => (c.local != null ? null : c.value));   // a row's lattice-column values (locals filled per row)
  const parts = [outNames.map((nm) => esc(nm)).join(sep) + '\r\n'];
  if (!isParquet && model && latticeHeader && h.grid) parts.unshift(microModelLine(model) + '\r\n');   // before the header row: a comment line other readers skip
  let buf = [];
  const isDelim = !blockCaps(L).rowIsRecord;
  const isDm = !!(L.docs.blockDoc && L.docs.blockDoc.header.dm);
  let rec = 0, written = 0;
  // CSV keeps the source text (<0.001) unless asked for the substitutes; Parquet's
  // numeric columns are doubles, so it always writes the substituted number
  for await (const batch of layerRows(L, null, { raw: !isParquet && !qualified })) {   /* rows ok: export: raw source text; gates its own coordinates below */
    for (const f0 of batch) {
      if (isDelim) {
        const xv = coordNum(f0[m.x]), yv = coordNum(f0[m.y]), zv = coordNum(f0[m.z]);
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;   // renderer numbering
      }
      const rAt = rec++;
      if (mask && !mask[rAt]) continue;
      const f = extendRow(L, isDm ? f0.map((v) => (v == null ? '' : v)) : f0, rAt);
      if (toLocal) {                                       // the local centroid (lattice frame) beside the world one
        const q = toLocal(coordNum(f[m.x]), coordNum(f[m.y]), coordNum(f[m.z]));
        for (let k = 0; k < lcCols.length; k++) if (lcCols[k].local != null) lcVals[k] = r12(q[lcCols[k].local]);
      }
      const at = (k) => (k < nSrc ? f[colIdx[k]] : lcVals[k - nSrc]);
      if (isParquet) {
        for (let k = 0; k < nOut; k++) {
          const v = at(k);
          one[k] = numAt[k]
            ? (v == null || v === '' || Number.isNaN(+v) ? null : +v)
            : (v == null || v === '' ? null : String(v));
        }
        if (sorter) sorter.push(coordNum(f[m.x]), coordNum(f[m.y]), coordNum(f[m.z]), one, written);
        else { for (let k = 0; k < nOut; k++) grp[k].push(one[k]); if (++grpN === GROUP) flushGrp(); }
      } else {
        let line = '';
        for (let k = 0; k < nOut; k++) line += (k ? sep : '') + fmt(at(k), numAt[k]);
        buf.push(line);
        if (buf.length >= 65536) { parts.push(buf.join('\r\n') + '\r\n'); buf = []; }
      }
      written++;
    }
    $('#meta').textContent = `export: ${written.toLocaleString()} rows…`;
    await new Promise((r) => setTimeout(r));
    if (epoch !== _exportEpoch) return -1;                 // superseded
    if (cancelled(signal)) { $('#meta').textContent = 'export cancelled — nothing written'; return -1; }
  }
  let blob;
  if (isParquet) {
    // Morton order → consecutive row groups are spatially contiguous, so each
    // group's footer X/Y/Z min/max is a TIGHT box (a spatial index for free)
    if (sorter) {
      let at = 0;
      for await (const g of sorter.batches(GROUP)) {
        pqw.write(outNames.map((nm, k) => ({ name: nm, data: g.cols[k] })));
        at += g.count; $('#meta').textContent = `export: spatial sort + write — ${at.toLocaleString()} / ${written.toLocaleString()}…`;
        await new Promise((r) => setTimeout(r));
        if (epoch !== _exportEpoch) return -1;             // superseded
        if (cancelled(signal)) { $('#meta').textContent = 'export cancelled — nothing written'; return -1; }
      }
    } else flushGrp();
    if (!written) pqw.write(outNames.map((nm) => ({ name: nm, data: [] })));   // an empty export is still a file
    blob = new Blob([pqw.finish()], { type: 'application/octet-stream' });
  } else {
    if (buf.length) parts.push(buf.join('\r\n') + '\r\n');
    blob = new Blob(parts, { type: 'text/csv' });
  }
  // a cancel that landed while the row stream read past its last batch (no
  // per-batch check runs after that) — honoured here, the last moment before
  // anything is committed; nothing awaits between this and the button hiding
  if (cancelled(signal)) { $('#meta').textContent = 'export cancelled — nothing written'; return -1; }
  window._lastExport = blob;                               // the smoke reads content here
  $('#meta').textContent = `exported ${written.toLocaleString()} rows → ${filename} (${fmtSize(blob.size)})`;
  if (download) deliverBlob(blob, filename);
  return returnBlob ? { written, blob } : written;
}

// materialize a block model as a Morton-sorted spatial-Parquet layer — the
// safe project-store path: bake ALL columns (incl. painted/calc, correctly
// reordered under the Morton sort) into a new .parquet layer that saves/reloads
// through the existing parquet path (no manifest surgery, no in-place record
// remap). A subsequent project save stores the optimized copy.
export async function convertLayerToParquet(L, cvOpts = {}) {
  const bc = busyCancel();
  // the reorder permutes every stored column and renames the layer (the
  // sidecar key): an evicted column would keep its OLD order, unreadable after
  const hold = await holdStoredValues(L);
  try { return await convertInner(L, { ...cvOpts, signal: cvOpts.signal || bc.signal }); } finally { hold.release(); bc.done(); }
}
async function convertInner(L, cvOpts) {
  const signal = cvOpts.signal;
  const h = layerTableHeader(L);
  if (!h || (L.docs.blockDoc && L.docs.blockDoc.parquet)) { $('#meta').textContent = 'store as Parquet: needs a non-Parquet block model'; return; }
  const m = h.mapping || {};
  if (m.x == null || m.y == null || m.z == null) { $('#meta').textContent = 'store as Parquet: needs X/Y/Z columns'; return; }
  const names = h.columns, isNum = names.map((_, k) => colIsNumericForStore(L, h, k));
  const isDm = !!(L.docs.blockDoc && L.docs.blockDoc.header.dm), isDelim = !!(L.docs.blockDoc && !isDm);
  const intern = names.map((_, k) => (isNum[k] ? null : new Map()));   // one string object per distinct value, not per row
  const kvOf = (lin) => [
    { key: 'micro:frame', value: JSON.stringify({ origin: sceneOrigin(), crs: (h.crs) || null, spatial: !(lin.params && lin.params.streaming) }) },
    { key: 'micro:lineage', value: JSON.stringify(lin) },
    // self-description: a micro-written parquet opens FOOTER-ONLY — the grid /
    // categories discovery is already done, so carry it in the file itself
    // (shared files stay self-contained; foreign parquets fall back to discovery
    // + the project sidecar)
    { key: 'micro:model', value: JSON.stringify(microModelOf(h)) },
  ];
  // ONE path at any size: the EXTERNAL Morton sort (condenser createMortonSorter)
  // — records bucketed by key and spilled as Blob parts, each bucket sorted and
  // written as it is read back, so peak memory is about one bucket, whatever the
  // model size. It replaced holding every column boxed in memory (~2 GB at 8M
  // blocks) and, above that ceiling, streaming in FILE order (no spatial index).
  if (!h.bbox) { $('#meta').textContent = 'store as Parquet: the model has no bounding box yet'; return; }
  const kinds = names.map((_, k) => (isNum[k] ? 'num' : 'str'));
  const sorter = createMortonSorter({ bbox: h.bbox, n: h.count || 0, kinds, target: window.__msortTarget || undefined });   // the hook: small buckets in a smoke
  const one = new Array(names.length);
  const valOf = (k, v) => {
    if (isNum[k]) return v == null || v === '' || Number.isNaN(+v) ? null : +v;
    if (v == null || v === '') return null;
    const s2 = String(v); let iv = intern[k].get(s2); if (iv === undefined) { iv = s2; intern[k].set(s2, s2); } return iv;
  };
  let n = 0, order = null, optLineage, outBlob = null;
  try {
    $('#meta').textContent = `${L.label || L.name} — reading columns…`;
    for await (const batch of layerRows(L, null)) {   /* rows ok: optimize: gates its own coordinates */
      for (const f0 of batch) {
        const xv = coordNum(f0[m.x]), yv = coordNum(f0[m.y]), zv = coordNum(f0[m.z]);
        if (isDelim && (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv))) continue;
        const f = isDm ? f0.map((v) => (v == null ? '' : v)) : f0;
        for (let k = 0; k < names.length; k++) one[k] = valOf(k, f[k]);
        sorter.push(xv, yv, zv, one, n++);
      }
      $('#meta').textContent = `optimize: ${n.toLocaleString()} / ${(h.count || 0).toLocaleString()} blocks read…`;
      await new Promise((r) => setTimeout(r));
      if (cancelled(signal)) { $('#meta').textContent = 'optimize cancelled — the layer is unchanged'; return; }
    }
    if (!n) { $('#meta').textContent = 'store as Parquet: empty model'; return; }
    // a PLACED model's rows read in world: the Parquet is written in world, so the placement is
    // BAKED into it (cleared on the layer below, stamped here) — never applied twice
    optLineage = mkLineage('optimize', { morton: true, format: 'parquet', blocks: n, ...(L.placement ? { placementBaked: L.placement } : {}) }, [L.lineage]);
    const columnTypes = {}; names.forEach((nm, k) => { columnTypes[nm] = isNum[k] ? 'DOUBLE' : 'STRING'; });
    const w = createParquetBlobWriter({ columnTypes, kvMetadata: kvOf(optLineage) });
    order = new Uint32Array(n);
    let at = 0;
    for await (const g of sorter.batches(1 << 16)) {      // 1<<16 = a sub-multiple of the render chunk
      w.write(names.map((nm, k) => ({ name: nm, data: g.cols[k] })));
      order.set(g.recs, at); at += g.count;
      $('#meta').textContent = `optimize: spatial sort + write — ${at.toLocaleString()} / ${n.toLocaleString()}…`;
      await new Promise((r) => setTimeout(r));
      if (cancelled(signal)) { $('#meta').textContent = 'optimize cancelled — the layer is unchanged'; return; }
    }
    outBlob = w.finish();
    // a cancel during the sorter's trailing read (after the last per-batch check)
    if (cancelled(signal)) { $('#meta').textContent = 'optimize cancelled — the layer is unchanged'; return; }
  } catch (e) { $('#meta').textContent = `optimize: ${e.message}`; return; }
  // 4. replace the blockDoc IN PLACE (reuse the layer id, keep paint/calc/style)
  const base = (L.label || L.name).replace(/\.[^.]+$/, ''), keepLabel = L.label, keepColorSel = L.colorSel, keepFilter = L.filterExpr;
  const oldHandle = L.handle;                              // the PRE-optimize source file (CSV/.dm) — now stale + orphanable
  const savedActive = S.activeId; setActiveLayer(L.id);
  const bakedPlacement = L.placement || null;
  L.placement = null;                                      // baked (the file now holds world coordinates)
  try {
    await openParquetBlocks(outBlob, `${base}.parquet`, { layer: L.id, first: false });
  } catch (e) { L.placement = bakedPlacement; $('#meta').textContent = `store as Parquet: reopen — ${e.message}`; setActiveLayer(savedActive); return; }
  L.name = `${base}.parquet`;                              // so save/reload routes to the parquet path
  L.lineage = optLineage;                                  // provenance: this layer was optimized in place
  if (keepLabel) L.label = keepLabel;
  // the bytes are now Parquet, but L.handle still points at the PRE-optimize source
  // (CSV/.dm). Drop it → saveProject re-triages this layer and persists model.parquet.
  // Leaving the stale handle made save resolve it INSIDE the project and treat the CSV
  // as still the layer's file → the parquet was never written → reload found no rows.
  L.handle = null; L.storage = 'loose';
  L._optimizedOrphan = (cvOpts.keepOriginal ? null : oldHandle) || null;   // saveProject removes the leftover source (unless the user chose to keep it)
  // the Parquet exists only in memory: there is no file to LINK to, so the next save
  // copies it in whatever was chosen for the files outside (a drag-dropped model has
  // no old handle, and was then offered "link" → a project naming a file that never was)
  L.memoryOnly = true;
  // 5. PERMUTE every per-record thing by the SAME order — paint stays editable.
  if (order) {
    for (const col of L.paintCols || []) {
      const nc = new Uint8Array(n); for (let i = 0; i < n; i++) nc[i] = col.codes[order[i]]; col.codes = nc;
      // fvalues is the TRUTH for a materialized column — codes are only its
      // 256-level display view. Permuting one and not the other left every
      // estimated grade attached to the wrong block: the colour stayed right
      // (codes moved) while export, filter and grade-tonnage read shuffled
      // numbers, and persistElement then baked the misordering into the sidecar.
      if (col.fvalues && col.fvalues.length === n) {
        const nf = new Float32Array(n); for (let i = 0; i < n; i++) nf[i] = col.fvalues[order[i]]; col.fvalues = nf;
      }
    }
    if (L._selMask && L._selMask.length === n) { const nm = new Uint8Array(n); for (let i = 0; i < n; i++) nm[i] = L._selMask[order[i]]; L._selMask = nm; applyLayerSelection(L); }
    if (L._filterMask) L._filterMask = null;                // rebuilt by the re-sweep below; stale rows would be misaligned
  }
  L._colStats = null;                                      // aggregate — recomputed on demand
  addPaintColorOptions(L);
  if (keepColorSel && [...$('#colorBy').options].some((o) => o.value === keepColorSel)) { L.colorSel = keepColorSel; setLayerColorSel(L, keepColorSel); }
  // calc columns recompute from the reordered base (no per-record cache); the
  // filter re-sweeps (with pushdown) against the new order
  await refilterLayer(L, keepFilter);
  renderLayers(); markProjectDirty();
  $('#meta').textContent = `optimized “${base}.parquet” — ${n.toLocaleString()} blocks, Morton-sorted (spatial index) · painting stays editable. Save the project to store it.`;
}
