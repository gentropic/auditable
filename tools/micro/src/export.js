// micro export — a layer's records out: CSV (source text or the qualified
// numbers, decimal point or comma) or Parquet (written a row group at a time;
// Morton-sorted through condenser's external sort for a spatial index), and
// "Optimize to spatial Parquet" — the layer swapped in place for its sorted
// Parquet, with everything kept per record permuted to match. Carved from
// index.html (phase 3).
import { blockCaps, colIsNumeric, extendRow, layerRows, layerTableHeader } from './records.js';
import { ensureStoredValues } from './columns.js';
import { microModelOf, mkLineage } from './lineage.js';
import { createParquetBlobWriter } from '../../../ext/parquet/index.js';
import { coordNum, createMortonSorter } from '../../../ext/condenser/src/main.js';
import { fmtSize } from './paths.js';
import { S } from './state.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setExportHooks): addPaintColorOptions, applyLayerSelection, deliverBlob, frame, markProjectDirty, openParquetBlocks, refilterLayer, renderLayers, setActiveLayer, setLayerColorSel
let H = {};
export function setExportHooks(h) { H = h; }

// ── export tools (§16): data leaves micro the way it came in — as ROWS.
// An export IS a filter sweep with a writer at the end: renderer record
// numbering (masks line up), extendRow carries ƒ calculated AND ✎ painted
// columns out — paint a DOMAIN by lasso, export, feed the estimator. CSV
// streamed into Blob parts → download; no size cliff. .dm exports too
// (@gcu/dm stays a reader — this is the .dm → CSV converter). ──
export function exportColumnsOf(L) {
  const h = layerTableHeader(L);
  if (!h) return null;
  const cols = h.columns.map((name, i) => ({ name, num: colIsNumeric(L, h, i), badge: '' }));
  for (const c of L.paintCols || []) cols.push({ name: c.name, num: c.kind === 'ratio', badge: c.kind === 'ratio' ? '%' : '✎' });   // census order: stored derived before calc (must match extendRow)
  for (const c of L.calcCols || []) cols.push({ name: c.name, num: (c.ty || 'number') === 'number', badge: 'ƒ' });
  return cols;
}

export let _exportEpoch = 0;

export async function runExport(L, { scope = 'all', colIdx = null, delim = ',', decimalComma = false, filename = 'export.csv', download = true, format = 'csv', codec = 'SNAPPY', spatialSort = false, qualified = false } = {}) {
  const h = layerTableHeader(L); if (!h) return -1;
  await ensureStoredValues(L, null);                       // exports read every column
  const cols = exportColumnsOf(L);
  if (!colIdx) colIdx = cols.map((_, i) => i);
  const epoch = ++_exportEpoch;
  const mask = scope === 'matches' ? L._filterMask : scope === 'selection' ? L._selMask : null;
  if (scope !== 'all' && !mask) { $('#meta').textContent = `export: no ${scope === 'matches' ? 'filter' : 'selection'} on this layer`; return -1; }
  const sep = delim === 'tab' ? '\t' : delim;
  const needQuote = new RegExp('["\\r\\n' + (sep === '\t' ? '\\t' : '\\' + sep) + ']');
  const esc = (s) => (needQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const numAt = colIdx.map((i) => cols[i].num);
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
      { key: 'micro:frame', value: JSON.stringify({ origin: H.frame ? [...H.frame.origin] : [0, 0, 0], crs: (h.crs || (L.docs.gridDoc && L.docs.gridDoc.grid.crs)) || null, spatial: doSort }) },
      { key: 'micro:lineage', value: JSON.stringify(expLin) },
      // full-scope exports carry their discovery (self-describing on reopen);
      // filtered/selection subsets don't — their bbox/categories would lie
      ...(scope === 'all' && h.bbox ? [{ key: 'micro:model', value: JSON.stringify(microModelOf(h)) }] : []),
    ];
    const columnTypes = {}; colIdx.forEach((i, k) => { columnTypes[cols[i].name] = numAt[k] ? 'DOUBLE' : 'STRING'; });
    pqw = createParquetBlobWriter({ columnTypes, codec, kvMetadata: kv });
    if (doSort) sorter = createMortonSorter({ bbox: h.bbox, n: h.count || 0, kinds: numAt.map((x) => (x ? 'num' : 'str')), target: window.__msortTarget || undefined });
    else grp = colIdx.map(() => []);
  }
  const flushGrp = () => { if (!grpN) return; pqw.write(colIdx.map((i, k) => ({ name: cols[i].name, data: grp[k] }))); grp = colIdx.map(() => []); grpN = 0; };
  const one = isParquet ? new Array(colIdx.length) : null;
  const parts = [colIdx.map((i) => esc(cols[i].name)).join(sep) + '\r\n'];
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
      if (isParquet) {
        for (let k = 0; k < colIdx.length; k++) {
          const v = f[colIdx[k]];
          one[k] = numAt[k]
            ? (v == null || v === '' || Number.isNaN(+v) ? null : +v)
            : (v == null || v === '' ? null : String(v));
        }
        if (sorter) sorter.push(coordNum(f[m.x]), coordNum(f[m.y]), coordNum(f[m.z]), one, written);
        else { for (let k = 0; k < colIdx.length; k++) grp[k].push(one[k]); if (++grpN === GROUP) flushGrp(); }
      } else {
        let line = '';
        for (let k = 0; k < colIdx.length; k++) line += (k ? sep : '') + fmt(f[colIdx[k]], numAt[k]);
        buf.push(line);
        if (buf.length >= 65536) { parts.push(buf.join('\r\n') + '\r\n'); buf = []; }
      }
      written++;
    }
    $('#meta').textContent = `export: ${written.toLocaleString()} rows…`;
    await new Promise((r) => setTimeout(r));
    if (epoch !== _exportEpoch) return -1;                 // superseded
  }
  let blob;
  if (isParquet) {
    // Morton order → consecutive row groups are spatially contiguous, so each
    // group's footer X/Y/Z min/max is a TIGHT box (a spatial index for free)
    if (sorter) {
      let at = 0;
      for await (const g of sorter.batches(GROUP)) {
        pqw.write(colIdx.map((i, k) => ({ name: cols[i].name, data: g.cols[k] })));
        at += g.count; $('#meta').textContent = `export: spatial sort + write — ${at.toLocaleString()} / ${written.toLocaleString()}…`;
        await new Promise((r) => setTimeout(r));
        if (epoch !== _exportEpoch) return -1;             // superseded
      }
    } else flushGrp();
    if (!written) pqw.write(colIdx.map((i) => ({ name: cols[i].name, data: [] })));   // an empty export is still a file
    blob = new Blob([pqw.finish()], { type: 'application/octet-stream' });
  } else {
    if (buf.length) parts.push(buf.join('\r\n') + '\r\n');
    blob = new Blob(parts, { type: 'text/csv' });
  }
  window._lastExport = blob;                               // the smoke reads content here
  $('#meta').textContent = `exported ${written.toLocaleString()} rows → ${filename} (${fmtSize(blob.size)})`;
  if (download) H.deliverBlob(blob, filename);
  return written;
}

// materialize a block model as a Morton-sorted spatial-Parquet layer — the
// safe project-store path: bake ALL columns (incl. painted/calc, correctly
// reordered under the Morton sort) into a new .parquet layer that saves/reloads
// through the existing parquet path (no manifest surgery, no in-place record
// remap). A subsequent project save stores the optimized copy.
export async function convertLayerToParquet(L, cvOpts = {}) {
  const h = layerTableHeader(L);
  if (!h || (L.docs.blockDoc && L.docs.blockDoc.parquet)) { $('#meta').textContent = 'store as Parquet: needs a non-Parquet block model'; return; }
  const m = h.mapping || {};
  if (m.x == null || m.y == null || m.z == null) { $('#meta').textContent = 'store as Parquet: needs X/Y/Z columns'; return; }
  const names = h.columns, isNum = names.map((_, k) => colIsNumeric(L, h, k));
  const isDm = !!(L.docs.blockDoc && L.docs.blockDoc.header.dm), isDelim = !!(L.docs.blockDoc && !isDm);
  const intern = names.map((_, k) => (isNum[k] ? null : new Map()));   // one string object per distinct value, not per row
  const kvOf = (lin) => [
    { key: 'micro:frame', value: JSON.stringify({ origin: H.frame ? [...H.frame.origin] : [0, 0, 0], crs: (h.crs) || null, spatial: !(lin.params && lin.params.streaming) }) },
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
    }
    if (!n) { $('#meta').textContent = 'store as Parquet: empty model'; return; }
    optLineage = mkLineage('optimize', { morton: true, format: 'parquet', blocks: n }, [L.lineage]);
    const columnTypes = {}; names.forEach((nm, k) => { columnTypes[nm] = isNum[k] ? 'DOUBLE' : 'STRING'; });
    const w = createParquetBlobWriter({ columnTypes, kvMetadata: kvOf(optLineage) });
    order = new Uint32Array(n);
    let at = 0;
    for await (const g of sorter.batches(1 << 16)) {      // 1<<16 = a sub-multiple of the render chunk
      w.write(names.map((nm, k) => ({ name: nm, data: g.cols[k] })));
      order.set(g.recs, at); at += g.count;
      $('#meta').textContent = `optimize: spatial sort + write — ${at.toLocaleString()} / ${n.toLocaleString()}…`;
      await new Promise((r) => setTimeout(r));
    }
    outBlob = w.finish();
  } catch (e) { $('#meta').textContent = `optimize: ${e.message}`; return; }
  // 4. replace the blockDoc IN PLACE (reuse the layer id, keep paint/calc/style)
  const base = (L.label || L.name).replace(/\.[^.]+$/, ''), keepLabel = L.label, keepColorSel = L.colorSel, keepFilter = L.filterExpr;
  const oldHandle = L.handle;                              // the PRE-optimize source file (CSV/.dm) — now stale + orphanable
  const savedActive = S.activeId; H.setActiveLayer(L.id);
  try {
    await H.openParquetBlocks(outBlob, `${base}.parquet`, { layer: L.id, first: false });
  } catch (e) { $('#meta').textContent = `store as Parquet: reopen — ${e.message}`; H.setActiveLayer(savedActive); return; }
  L.name = `${base}.parquet`;                              // so save/reload routes to the parquet path
  L.lineage = optLineage;                                  // provenance: this layer was optimized in place
  if (keepLabel) L.label = keepLabel;
  // the bytes are now Parquet, but L.handle still points at the PRE-optimize source
  // (CSV/.dm). Drop it → saveProject re-triages this layer and persists model.parquet.
  // Leaving the stale handle made save resolve it INSIDE the project and treat the CSV
  // as still the layer's file → the parquet was never written → reload found no rows.
  L.handle = null; L.storage = 'loose';
  L._optimizedOrphan = (cvOpts.keepOriginal ? null : oldHandle) || null;   // saveProject removes the leftover source (unless the user chose to keep it)
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
    if (L._selMask && L._selMask.length === n) { const nm = new Uint8Array(n); for (let i = 0; i < n; i++) nm[i] = L._selMask[order[i]]; L._selMask = nm; H.applyLayerSelection(L); }
    if (L._filterMask) L._filterMask = null;                // rebuilt by the re-sweep below; stale rows would be misaligned
  }
  L._colStats = null;                                      // aggregate — recomputed on demand
  H.addPaintColorOptions(L);
  if (keepColorSel && [...$('#colorBy').options].some((o) => o.value === keepColorSel)) { L.colorSel = keepColorSel; H.setLayerColorSel(L, keepColorSel); }
  // calc columns recompute from the reordered base (no per-record cache); the
  // filter re-sweeps (with pushdown) against the new order
  await H.refilterLayer(L, keepFilter);
  H.renderLayers(); H.markProjectDirty();
  $('#meta').textContent = `optimized “${base}.parquet” — ${n.toLocaleString()} blocks, Morton-sorted (spatial index) · painting stays editable. Save the project to store it.`;
}
