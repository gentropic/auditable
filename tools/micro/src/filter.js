// micro filter — the filter: ONE expression (@gcu/expr) per layer, swept over the layer's records
// by the cheapest path that gives the exact answer — the pin cache, the zone maps or sidecar
// bands, Parquet footer statistics, the columnar engine on workers, the row path — then handed
// to the renderer as a mask (or compacted chunks). Table and drillhole layers have their own
// sweeps here too. Carved from index.html (phase 3 of the 2026-10-31 review).
import { canMatch, compileBool, compileChunk, compileChunkBool, parse, validate } from '../../../ext/expr/index.js';
import { calcOrder, extendRow, layerRows, layerTableHeader, rowQualifier, schemaExt } from './records.js';
import { S, activeLayer, layerById } from './state.js';
import { ensureStoredValues, expandedDeps, pinBudgetBytes, pinGet, pinPut, pinnedSweep } from './columns.js';
import { startChunkBuilder } from './chunkworker.js';
import { canScanColumnar, scanColumnar, zoneKeeper } from './colscan.js';
import { readParquetRange } from '../../../ext/parquet/index.js';
import { coordNum, lineFields, openDmModel } from '../../../ext/condenser/src/main.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setFilterHooks): attrTableFilterChanged, frame, pushDhMask, refreshLinkedWindows, renderer, requestRender, rowsProgress, syncHL
let H = {};
export function setFilterHooks(h) { H = h; }

// predicate pushdown: can the filter be true for SOME row whose NUMERIC columns
// lie in `ranges`? Now @gcu/expr's canMatch (v0.2) — the hand-rolled walker moved
// into expr as a first-class analysis beside deps(). Conservative — a group is
// skipped ONLY when it provably holds no match — and SOUNDER than the old copy:
// `!=` no longer prunes unless the stats assert hasBlank:false (a blank row
// matches `!=`, and min/max stats say nothing about blanks).
export const pqGroupCanMatch = canMatch;

// numeric {min,max} ranges from a row group's footer column stats
export function pqGroupRanges(rg) {
  const ranges = {};
  for (const nm in rg.columns) { const st = rg.columns[nm]; const mn = Number(st.min), mx = Number(st.max); if (Number.isFinite(mn) && Number.isFinite(mx)) ranges[nm.toLowerCase()] = { min: mn, max: mx }; }
  return ranges;
}

// the table filter: the same @gcu/expr sweep, but the mask only drives the
// attribute table + export (a table has nothing on screen to hide)
export async function applyTableFilter(L, expr) {
  L.filterExpr = expr;
  dispatchEvent(new Event('micro:project-dirty'));
  const inp = $('#filter');
  const h = layerTableHeader(L);
  if (!expr.trim()) {
    L._filterMask = null; L._filterCount = 0;
    inp.classList.remove('err');
    H.attrTableFilterChanged(L.id);
    $('#meta').textContent = L.docs.tableDoc.metaLine;
    return;
  }
  let fn;
  try { fn = compileBool(expr, schemaExt(L, h), { decimal: '.' }); }
  catch (e) { inp.classList.add('err'); $('#meta').textContent = `filter: ${e.message}`; return; }
  inp.classList.remove('err');
  const mask = new Uint8Array(h.count);
  let hits = 0, rec = 0;
  for await (const batch of layerRows(L, null)) {   /* rows ok: a table: no coordinates, every row is a record */
    for (const f0 of batch) {
      const f = extendRow(L, f0, rec);
      let keep = false;
      try { keep = !!fn(f); } catch { keep = false; }
      if (keep) { mask[rec] = 1; hits++; }
      rec++;
    }
  }
  L._filterMask = mask; L._filterCount = hits;
  H.attrTableFilterChanged(L.id);
  $('#meta').textContent = `${L.label || L.name} — ${hits.toLocaleString()} of ${h.count.toLocaleString()} rows match`;
}

// ── filter: lamina's expression language over EVERY column, evaluated in one
// sweep over the file → a bitmask by record index → a GPU mask texture (dim or
// isolate). The §4 selection contract, arriving via the local UI first. ──
export const _filterEpochs = new Map();

export let _filterSeq = 0;

export function resetFilterState() { _filterEpochs.clear(); }

// L defaults to the active layer (the filter box). It used to BE the active layer,
// so every path that re-filters after a re-read did it only `if active`, and a
// background layer whose GPU mask a re-read dropped kept saying "filtered" while
// drawing everything. Any layer now; the box mirrors only the active one.
// the compaction builder each layer's running filter owns (src/chunkworker.js) —
// closed by the next filter on that layer, so a superseded one's late chunks never
// land in the new compact set
export const _compactBuilders = new Map();

export function closeCompactBuilder(lid) { const b = _compactBuilders.get(lid); if (b) { b.close(); _compactBuilders.delete(lid); } }

// ── what every block source's sweep shares ──────────────────────────────────
// the CHUNK plan: the predicate compiled columnar over the layer's census schema,
// and the calc columns it reaches (only those, in evaluation order)
function chunkPlan(AL, header, ast, needL) {
  const censusSchema = schemaExt(AL, header);
  const chunkF = ast ? compileChunkBool(ast, censusSchema, { decimal: '.' }) : null;
  const baseLen = header.columns.length, paintLen = ((AL && AL.paintCols) || []).length;
  const calcChunkFns = (ast && AL && AL.calcCols && AL.calcCols.length)
    ? calcOrder(AL).filter((it) => !needL || needL.has(String(it.c.name).toLowerCase()))
        .map((it) => { let fn; try { fn = compileChunk(it.c.expr, censusSchema, { decimal: '.' }); } catch { fn = () => ({ t: 'raw', buf: [] }); } return { slot: baseLen + paintLen + it.idx, fn }; })
    : null;
  return { censusSchema, chunkF, calcChunkFns };
}
// TIER 3: every needed column PINNED → the sweep runs from memory, no file read.
// → the hits (≥ 0), -1 when superseded, or null when not every column is pinned
// (the caller then reads). Its own answer, never a shared flag: filters on two
// layers run at once (routines, the host API), and the global flag this used to
// be let B reset A's mid-await, so A ran the full scan too and counted its hits
// twice. window.__pinUsed mirrors the last answer for the smokes.
async function tryPinned(AL, header, m, pinNames, needL, calcChunkFns, chunkF, { mask, collect, catCode, alive }) {
  const ok = !!chunkF && pinNames.length > 0 && pinNames.every((tn) => pinGet(AL, tn.k));
  window.__pinUsed = ok;
  if (!ok) return null;
  return pinnedSweep(AL, header, m, pinNames, needL, calcChunkFns, chunkF, { mask, collect, catCode, alive: () => alive() });
}

export async function applyBlockFilter(expr, L = activeLayer()) {
  const isActive = !!L && L.id === S.activeId;
  const inp = isActive ? $('#filter') : document.createElement('input');   // the box's error mark belongs to the active layer's filter
  expr = String(expr == null ? '' : expr);
  if (isActive) H.syncHL(inp, $('#filterHL'));               // the input text is overlay-drawn — keep it painted on programmatic sets too
  // the TARGET layer's docs, never the module aliases — a stale alias once
  // filtered the assay table while the model was active and hung a 7k-bit
  // mask on a 1.8M-block layer
  const AL = L;
  if (AL && AL.kind === 'table') return applyTableFilter(AL, expr);   // no geometry to mask — the table view is the whole effect
  const fBlockDoc = AL ? AL.docs.blockDoc : null;
  const fDhDoc = AL ? AL.docs.dhDoc : null;
  if (!fBlockDoc && !fDhDoc) { $('#meta').textContent = 'filter: open a block model or drillholes first'; return; }
  const lid = AL.id;                                        // the sweep belongs to THIS layer even if focus moves
  AL.filterExpr = expr;
  dispatchEvent(new Event('micro:project-dirty'));
  // superseded = a NEWER filter on the SAME layer (it was one global counter, so
  // filtering one layer silently aborted another layer's running sweep)
  const epoch = ++_filterSeq;                               // one sequence for all layers: safe across recycled ids
  _filterEpochs.set(lid, epoch);
  const alive = () => _filterEpochs.get(lid) === epoch;
  if (!expr.trim() && !(fDhDoc && (AL._holeMask || AL._secHoleMask))) {   // drillholes: the hole filter / the section's holes still go through the sweep
    closeCompactBuilder(lid); H.renderer.setFilter(null, {}, lid); H.renderer.clearCompact(lid); inp.classList.remove('err'); H.requestRender();
    { const Lf = layerById(lid); if (Lf) { Lf._filterMask = null; H.attrTableFilterChanged(lid); H.refreshLinkedWindows(Lf, 'filtered'); } }
    $('#meta').textContent = (fBlockDoc || fDhDoc).metaLine; return;
  }
  { let ast0 = null; try { ast0 = parse(expr); } catch { /* the branches report */ }
    if (ast0) await ensureStoredValues(layerById(lid), expandedDeps(layerById(lid), ast0)); }   // evicted matcols re-fault before the sweep
  // drillholes: the interval table is in memory — the sweep is a plain loop
  if (fDhDoc) {
    const r = dhFilterSweep(AL, expr);
    if (r && r.err) { inp.classList.add('err'); $('#meta').textContent = `filter: ${r.err}`; return; }
    inp.classList.remove('err');
    $('#meta').textContent = dhFilterMeta(AL);
    return;
  }
  const { blob, header } = fBlockDoc;
  const schema = schemaExt(AL, header);
  const v = validate(expr, schema);
  if (!v.ok) { inp.classList.add('err'); $('#meta').textContent = `filter: ${v.errors[0] && v.errors[0].message || 'invalid expression'}`; return; }
  inp.classList.remove('err');
  const fn = compileBool(expr, schema, { decimal: '.' });
  $('#meta').textContent = 'filter: scanning…';
  closeCompactBuilder(lid); H.renderer.clearCompact(lid);    // a previous compaction is stale now
  const mask = new Uint8Array(header.count);
  let rec = 0, hits = 0;
  const m = header.mapping;
  const isolate = true;                                    // filters isolate — the dim/context mode had no takers

  // ── compaction (isolate + regular grid): the sweep already has every matching
  // row in hand, so tee matches into a second chunk builder — the render budget
  // then runs over the MATCHES (12k feels like 12k, not like 1.8M shader-discards).
  // Bounded: above the cap (half the model, ≤8M) the mask path wins on memory.
  // Compact chunks carry RAW record indices, so pick / panel / measure are untouched;
  // color stays full-doc (addChunk skips the ramp update for the compact set). ──
  const compactCap = Math.min(Math.floor(header.count / 2) || 0, 8_000_000);
  const catCode = header.categories ? new Map(header.categories.map((v2, i2) => [v2, i2])) : null;
  // sub-blocked models opt OUT of compaction: the compact builder has no dim
  // palette, so matches would collapse to the fine-grid cell (minDim/2). The
  // mask path preserves each block's true size (it keeps the base chunks).
  // the builder runs OFF the page (src/chunkworker.js): a 2M-match batch's Morton
  // sort + packing froze the page ~0.5 s, several times per filter on a big model
  let cb2 = isolate && fBlockDoc.grid && compactCap > 0 && !header.subBlocked
    ? await startChunkBuilder({ frame: H.frame, grid: fBlockDoc.grid, chunkSize: 1 << 17, batchSize: 1 << 21, seed: 2, onChunk: (c) => { if (alive()) H.renderer.addChunk(c, 'compact', lid); } })
    : null;
  if (cb2) { _compactBuilders.set(lid, cb2); window.__compactOffPage = cb2.offPage; }   // smoke hook: where compaction ran
  const CB = 1 << 18;
  let cx, cy, czz, cch, cct, crr, cfill = 0, collected = 0;
  const callocz = () => { cx = new Float64Array(CB); cy = new Float64Array(CB); czz = new Float64Array(CB); cch = new Float64Array(CB); cct = catCode ? new Uint8Array(CB) : null; crr = new Uint32Array(CB); cfill = 0; };
  if (cb2) callocz();
  const cflush = () => { if (cfill) { cb2.push({ count: cfill, x: cx, y: cy, z: czz, chan: cch, cat: cct, recIdx: crr }); callocz(); } };
  const collect = (xv, yv, zv, cv, code, r) => {
    if (!cb2) return;
    if (collected >= compactCap) { closeCompactBuilder(lid); H.renderer.clearCompact(lid); cb2 = null; return; }   // too many — the mask path wins
    cx[cfill] = xv; cy[cfill] = yv; czz[cfill] = zv;
    cch[cfill] = Number.isFinite(cv) ? cv : 0;
    if (cct) cct[cfill] = code;
    crr[cfill] = r;
    cfill++; collected++;
    if (cfill === CB) cflush();
  };

  // the COLUMNAR engine (src/colscan.js) for a Parquet or .dm model: row groups /
  // page runs on the worker pool (or on the page one per task), the same chunk view
  // as everywhere, units the pushdown rules out never read (keepUnit: the footer's
  // min/max, or the .dm sidecar bands), matches + pins handed over IN UNIT ORDER.
  // false = superseded by a newer filter on this layer.
  const engineFilter = async (readCols, keepUnit, skipWhat, keepZone = null) => {
      // tee the scan into the pin cache — only when its columns FIT the budget (a
      // refine needs every one of them): at 60M blocks four columns are 1.9 GB, and
      // the cache kept almost none of it after a half-second allocate-and-fill
      const tee = pinBudgetBytes() > 0 && readCols.length * header.count * 8 <= pinBudgetBytes() ? {} : null;
      const ac = new AbortController();                      // a newer filter on this layer supersedes → stop the workers
      const names = fBlockDoc.parquet ? fBlockDoc.parquet.names : header.columns;
      const params = { expr, coords: [names[m.x], names[m.y], names[m.z]], chan: m.chan != null ? names[m.chan] : null, cat: m.cat != null ? names[m.cat] : null, categories: header.categories || null, tee: tee ? readCols : null };
      let skipped = 0, units = 0, zonesSkipped = 0, zonesTotal = 0;
      const teePart = (part, start) => {
        for (const nm of readCols) {
          if (tee[nm] === null) continue;
          const src = part.tee && part.tee[nm];
          if (!src) { tee[nm] = null; continue; }
          let e = tee[nm];
          if (e === undefined) e = tee[nm] = src.data ? { data: new Float64Array(header.count) } : { codes: new Uint16Array(header.count), dict: [''], map: new Map([['', 0]]) };   // no fill: a pinned scan is COMPLETE, every record gets written
          if (e.data && src.data) { e.data.set(src.data, start); continue; }
          if (!(e.codes && src.codes)) { tee[nm] = null; continue; }   // a column that changed kind between groups isn't pinned
          const re = new Uint16Array(src.dict.length);          // the group's local dictionary → the layer's
          let full = false;
          for (let c = 0; c < src.dict.length; c++) { const v = src.dict[c]; let gc = e.map.get(v); if (gc === undefined) { if (e.dict.length > 65535) { full = true; break; } gc = e.dict.length; e.dict.push(v); e.map.set(v, gc); } re[c] = gc; }
          if (full) { tee[nm] = null; continue; }
          for (let q = 0; q < src.codes.length; q++) e.codes[start + q] = re[src.codes[q]];
        }
      };
      try {
        const res = await scanColumnar(AL, { kernel: 'filter', params, exprs: [expr], extraCols: readCols, signal: ac.signal, keepZone,
          skipGroup: keepUnit ? (g, u) => { units++; const sk = !keepUnit(u); if (sk) skipped++; return sk; } : null,
          onProgress: (d, N, w) => { if (alive() && N) $('#meta').textContent = `filter: ${H.rowsProgress(d, N)} · ${w}`; },
          onPart: (g, part, start) => {
            if (!alive()) { ac.abort(); return; }
            mask.set(part.mask, start); hits += part.hits;
            const mt = part.match;
            for (let j = 0; j < mt.rec.length; j++) collect(mt.x[j], mt.y[j], mt.z[j], mt.chan[j], mt.cat ? mt.cat[j] : 0, start + mt.rec[j]);
            if (tee) teePart(part, start);
          } });
        zonesSkipped = res.zonesSkipped; zonesTotal = res.zones;
      } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
      if (!alive()) return false;
      rec = header.count;
      window.__pqFilterSkipped = skipped;                    // smoke hook
      if (tee && !skipped && !zonesSkipped) {                // pin ONLY a complete scan (skipped groups would leave holes)
        for (const nm of readCols) { const e = tee[nm]; if (!e) continue; delete e.map; pinPut(AL, nm, e); }
      }
      if (skipped) $('#meta').textContent = `filter: ${skipped} of ${units} ${skipWhat}…`;
      if (zonesSkipped) $('#meta').textContent = `filter: ${zonesSkipped} of ${zonesTotal} zones skipped by the zone maps…`;
      window.__csvZonesSkipped = zonesSkipped;             // smoke hook
      window.__dmBandsSkipped = skipped;                   // smoke hook (the .dm name)
      return true;
  };
  if (fBlockDoc.parquet) {
    // parquet: the footer prunes work TWO ways —
    //  · row-group SKIP: per-group column min/max prove no match → never decode
    //  · column PRUNE: read only the predicate's columns (+ coords/cat), unless
    //    calc/painted columns are in play (their formulas may reach further)
    const P = fBlockDoc.parquet;
    let ast = null; try { ast = parse(expr); } catch { ast = null; }
    const needL = ast ? expandedDeps(AL, ast) : null;      // calc-expanded → projection works WITH derived columns now
    let readCols = P.names;
    if (ast) {
      const need = new Set(P.coordNames.map((n) => n.toLowerCase()));
      if (P.catName) need.add(P.catName.toLowerCase());
      if (m.chan != null) need.add(P.names[m.chan].toLowerCase());
      for (const d of needL) need.add(d);
      readCols = P.names.filter((n) => need.has(n.toLowerCase()));
    }
    // the CHUNK path: the filter (and any calc it references) evaluates columnar
    // over each row group via compileChunk — rows are built only for MATCHES
    const { chunkF, calcChunkFns } = chunkPlan(AL, header, ast, needL);
    // ── TIER 3, REFINE: every needed column pinned → evaluate with NO file read ──
    const pinned = await tryPinned(AL, header, m, readCols.map((nm) => ({ k: nm })), needL, calcChunkFns, chunkF, { mask, collect, catCode, alive });
    if (pinned != null) {
      if (pinned < 0) return; hits += pinned; rec = header.count;
    } else if (chunkF) {
      if (!(await engineFilter(readCols, (rg) => pqGroupCanMatch(ast, pqGroupRanges(rg)), 'row groups skipped by the footer'))) return;
    } else {
    // no parseable expression: the ROW path, every column of every group
    let start = 0, skipped = 0;
    for (const rg of P.rowGroups) {
      const count = rg.rowCount;
      if (ast && !pqGroupCanMatch(ast, pqGroupRanges(rg))) { start += count; skipped++; continue; }   // pushdown skip
      const cols = await readParquetRange(P.buf, readCols, start, start + count, P.meta);
      for (let i = 0; i < count; i++) {                     // no parseable ast — the row path
        const r = start + i;
        const f = new Array(P.names.length);
        for (let ci = 0; ci < P.names.length; ci++) { const c = cols[P.names[ci]]; f[ci] = c ? (c[i] ?? '') : ''; }
        const xv = coordNum(f[m.x]), yv = coordNum(f[m.y]), zv = coordNum(f[m.z]);
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (fn(extendRow(AL, f, r))) {
          mask[r] = 1; hits++;
          const code = catCode ? (catCode.get(String(f[m.cat] ?? '').trim()) ?? 0) : 0;
          collect(xv, yv, zv, m.chan != null ? +f[m.chan] : 0, code, r);
        }
      }
      rec = start + count;
      start += count;                                       // advance for kept groups too (skip branch does its own)
      window.__pqFilterSkipped = skipped;                  // smoke hook
      await new Promise((r2) => setTimeout(r2)); if (!alive()) return;
    }
    if (skipped) $('#meta').textContent = `filter: ${skipped} of ${P.rowGroups.length} row groups skipped by the footer…`;
    }
  } else if (header.dm) {
    // .dm: PROJECT only the predicate's columns (+ coords/cat/chan) and decode
    // them by striding — not all N fields. Same RAW record numbering as recIdx.
    // Calc/painted columns → their formulas may reach any column, so fall back to
    // the full decode (matches the parquet column-prune rule).
    const { columnBatches, recordBatches } = await openDmModel(blob);
    let ast = null; try { ast = parse(expr); } catch { ast = null; }
    let colIdxs = null;
    const needL = ast ? expandedDeps(AL, ast) : null;       // calc-expanded: projection works WITH derived columns now
    if (ast) {
      const need = new Set([m.x, m.y, m.z]);
      if (m.cat != null) need.add(m.cat);
      if (m.chan != null) need.add(m.chan);
      const lower = header.columns.map((n) => String(n).toLowerCase());
      for (const d of needL) { const i = lower.indexOf(d); if (i >= 0) need.add(i); }
      colIdxs = [...need];
    }
    // TIER 3: pinned -> no file read; else the projected scan TEES into the cache
    const { censusSchema, chunkF, calcChunkFns } = chunkPlan(AL, header, ast, needL);
    const pinNames = colIdxs ? colIdxs.map((bi) => ({ k: header.columns[bi], bi })) : [];
    const pinned = await tryPinned(AL, header, m, pinNames, needL, calcChunkFns, chunkF, { mask, collect, catCode, alive });
    if (pinned != null) { if (pinned < 0) return; hits += pinned; rec = header.count; }
    if (pinned == null) {
    // BAND PUSHDOWN: sidecar per-64k min/max per column → skip whole page-runs
    // the predicate provably can't match (parquet's row-group skip on .dm).
    // Sound/conservative — pqGroupCanMatch keeps anything it can't decide.
    let bandsSkipped = 0, bandsTotal = 0;
    const shouldRead = (AL && AL._bands && ast && colIdxs) ? (recStart, count) => {
      bandsTotal++;
      const B = AL._bands, b0 = (recStart / B.size) | 0, b1 = ((recStart + count - 1) / B.size) | 0;
      const ranges = {};
      for (const nm in B.cols) {
        const arr = B.cols[nm];
        let mn = Infinity, mx = -Infinity;
        for (let b = b0; b <= b1; b++) { const v0 = arr[b * 2], v1 = arr[b * 2 + 1]; if (v0 == null) continue; if (v0 < mn) mn = v0; if (v1 > mx) mx = v1; }
        if (mn !== Infinity) ranges[nm.toLowerCase()] = { min: mn, max: mx };   // pqGroupCanMatch's key convention
      }
      const keep = pqGroupCanMatch(ast, ranges);
      if (!keep) bandsSkipped++;
      return keep;
    } : null;
    if (colIdxs && chunkF) {
      // the engine: page runs in parallel, the sidecar band pushdown skips runs unread
      const keep = shouldRead ? (u) => shouldRead(u.start, u.count) : null;
      if (!(await engineFilter(colIdxs.map((ci) => header.columns[ci]), keep, 'page-runs skipped by the sidecar index'))) return;
    } else if (colIdxs) {
      const tee = (chunkF && pinBudgetBytes() > 0) ? {} : null;
      for await (const { recStart, count, cols } of columnBatches(colIdxs, { shouldRead })) {
        if (tee) for (const tn of pinNames) {
          let e = tee[tn.k];
          if (e === undefined) {
            const ty = (censusSchema.find((c2) => c2.name === tn.k) || {}).type;
            e = tee[tn.k] = ty === 'number' ? { data: new Float64Array(header.count).fill(NaN) } : { codes: new Uint16Array(header.count), dict: [''], map: new Map([['', 0]]) };
          }
          if (e === null) continue;
          const src = cols[tn.bi];
          if (e.data) { for (let k = 0; k < count; k++) { const v = src[k]; const x = +v; e.data[recStart + k] = (v == null || v === '' || !Number.isFinite(x)) ? NaN : x; } }
          else for (let k = 0; k < count; k++) {
            const sv = src[k] == null ? '' : String(src[k]); let c = e.map.get(sv);
            if (c === undefined) { if (e.dict.length > 65535) { tee[tn.k] = null; break; } c = e.dict.length; e.dict.push(sv); e.map.set(sv, c); }
            e.codes[recStart + k] = c;
          }
        }
        for (let k = 0; k < count; k++) {
          const r = recStart + k;
          const vals = new Array(header.columns.length);
          for (const ci of colIdxs) { const v = cols[ci][k]; vals[ci] = (typeof v === 'number' && Number.isNaN(v)) ? '' : v; }
          if (fn(extendRow(AL, vals, r))) {
            mask[r] = 1; hits++;
            const code = catCode ? (catCode.get(String(vals[m.cat] ?? '').trim()) ?? 0) : 0;
            collect(coordNum(vals[m.x]), coordNum(vals[m.y]), coordNum(vals[m.z]), m.chan != null ? +vals[m.chan] : 0, code, r);
          }
        }
        rec = recStart + count;
        await new Promise((r2) => setTimeout(r2));
        if (!alive()) return;
      }
      if (tee && !bandsSkipped && alive()) { for (const tn of pinNames) { const e = tee[tn.k]; if (!e) continue; delete e.map; pinPut(AL, tn.k, e); } }   // pin only COMPLETE scans
      window.__dmBandsSkipped = bandsSkipped;              // smoke hook
      if (bandsSkipped) $('#meta').textContent = `filter: ${bandsSkipped} of ${bandsTotal} page-runs skipped by the sidecar index…`;
    } else {
      for await (const { recStart, rows } of recordBatches()) {   // full decode (calc/paint reach any column)
        for (let k = 0; k < rows.length; k++) {
          const vals = rows[k].map((v) => (v == null ? '' : v));
          if (fn(extendRow(AL, vals, recStart + k))) {
            mask[recStart + k] = 1; hits++;
            const code = catCode ? (catCode.get(String(vals[m.cat] ?? '').trim()) ?? 0) : 0;
            collect(coordNum(vals[m.x]), coordNum(vals[m.y]), coordNum(vals[m.z]), m.chan != null ? +vals[m.chan] : 0, code, recStart + k);
          }
        }
        rec = recStart + rows.length;
        await new Promise((r) => setTimeout(r));
        if (!alive()) return;
      }
    }
    }
  } else {
    let teeAcc = null; const pinNames = [];                 // pin-cache tee state (set up below)
    const qRow = rowQualifier(AL);                          // <0.001 → its substitute, as every other read
    const scanRow = (f0) => {
      const f = qRow ? qRow(f0) : f0;
      const xv = coordNum(f[m.x]), yv = coordNum(f[m.y]), zv = coordNum(f[m.z]);
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) return;   // same rows sweep 2 kept
      if (teeAcc) for (const tn of pinNames) {
        const e = teeAcc[tn.k]; if (!e) continue; const v = f[e.bi];
        if (e.data) { const x = +v; e.data[rec] = (v == null || v === '' || !Number.isFinite(x)) ? NaN : x; }
        else { const sv = v == null ? '' : String(v); let c = e.map.get(sv); if (c === undefined) { if (e.dict.length > 65535) { teeAcc[tn.k] = null; continue; } c = e.dict.length; e.dict.push(sv); e.map.set(sv, c); } e.codes[rec] = c; }
      }
      if (fn(extendRow(AL, f, rec))) {
        mask[rec] = 1; hits++;
        const code = catCode ? (catCode.get((f[m.cat] || '').trim()) ?? 0) : 0;
        collect(xv, yv, zv, m.chan != null ? +f[m.chan] : 0, code, rec);
      }
      rec++;
    };
    // BAND PUSHDOWN (sidecar bands + the line-offset index): the anchors mark
    // the byte start of every k-th ACCEPTED row, and bands are numbered in
    // accepted-row order — so a band the stats prove can't match is skipped by
    // SEEKING past its bytes, with the record numbering advanced exactly.
    let astC = null; try { astC = parse(expr); } catch { astC = null; }
    // ── TIER 3 (pin cache): needed columns pinned → evaluate with NO file read ──
    const needL = astC ? expandedDeps(AL, astC) : null;
    const { censusSchema, chunkF, calcChunkFns } = chunkPlan(AL, header, astC, needL);
    if (chunkF) {                                          // the needed BASE columns, by name (coords + cat + chan + the dep cone)
      const want = new Set([m.x, m.y, m.z]); if (m.cat != null) want.add(m.cat); if (m.chan != null) want.add(m.chan);
      const lowById = new Map(header.columns.map((nm, i) => [String(nm).toLowerCase(), i]));
      if (needL) for (const d of needL) { const bi = lowById.get(d); if (bi !== undefined) want.add(bi); }
      for (const bi of want) if (bi != null && header.columns[bi] != null) pinNames.push({ k: header.columns[bi], bi });
    }
    const pinned = await tryPinned(AL, header, m, pinNames, needL, calcChunkFns, chunkF, { mask, collect, catCode, alive });
    if (pinned != null) { if (pinned < 0) return; hits += pinned; rec = header.count; }
    const pinUsed = pinned != null;
    if (!pinUsed && chunkF && canScanColumnar(AL)) {
      // the engine: the line index's runs on the worker pool (src/colscan.js), the
      // sidecar bands skipping runs unread — a run is one band
      const BK = AL && AL._bands;
      const keep = BK && astC ? (u) => {
        const b0 = (u.start / BK.size) | 0, b1 = ((u.start + u.count - 1) / BK.size) | 0, ranges = {};
        for (const nm in BK.cols) {
          const arr = BK.cols[nm]; let mn = Infinity, mx = -Infinity;
          for (let b = b0; b <= b1; b++) { const v0 = arr[b * 2], v1 = arr[b * 2 + 1]; if (v0 == null) continue; if (v0 < mn) mn = v0; if (v1 > mx) mx = v1; }
          if (mn !== Infinity) ranges[nm.toLowerCase()] = { min: mn, max: mx };
        }
        return pqGroupCanMatch(astC, ranges);
      } : null;
      const kz = zoneKeeper(AL, { ast: astC });              // the zone maps (finer); the bands where there are none
      const ok = await engineFilter(pinNames.map((tn) => tn.k), kz ? null : keep, 'runs skipped by the sidecar index', kz);
      window.__csvBandsSkipped = kz ? window.__csvZonesSkipped : window.__dmBandsSkipped;   // smoke hook (the CSV name)
      if (!ok) return;
    } else if (!pinUsed) {
    const BB = AL && AL._bands, idxC = header.index;
    const perBand = BB && idxC && idxC.k ? Math.round(BB.size / idxC.k) : 0;
    if (BB && idxC && astC && perBand > 0 && idxC.offsets && idxC.offsets.length > 0) {
      let bandsSkipped = 0;
      const nBands = Math.ceil(header.count / BB.size);
      for (let b = 0; b < nBands; b++) {
        if (!alive()) return;
        const ranges = {};
        for (const nm in BB.cols) { const arr = BB.cols[nm]; const v0 = arr[b * 2], v1 = arr[b * 2 + 1]; if (v0 != null) ranges[nm.toLowerCase()] = { min: v0, max: v1 }; }
        if (!pqGroupCanMatch(astC, ranges)) { bandsSkipped++; rec = Math.min(header.count, (b + 1) * BB.size); continue; }
        const a0 = b * perBand, aN = (b + 1) * perBand;
        const byteStart = a0 < idxC.offsets.length ? idxC.offsets[a0] : null;
        if (byteStart == null) break;                      // index ran short — nothing left to read
        const byteEnd = aN < idxC.offsets.length ? idxC.offsets[aN] : blob.size;
        rec = b * BB.size;                                 // accepted-row numbering at the band start
        const bandEnd = Math.min(header.count, (b + 1) * BB.size);
        for await (const batch of lineFields(blob.slice(byteStart, byteEnd), header.delim, false)) {
          for (const f of batch) { if (rec >= bandEnd) break; scanRow(f); }
          await new Promise((r) => setTimeout(r));
          if (!alive()) return;
        }
      }
      window.__csvBandsSkipped = bandsSkipped;             // smoke hook
      if (bandsSkipped) $('#meta').textContent = `filter: ${bandsSkipped} of ${nBands} bands skipped by the sidecar index…`;
    } else {
    if (chunkF && pinBudgetBytes() > 0 && pinNames.length) {   // a COMPLETE scan → tee into the pin cache
      teeAcc = {};
      for (const tn of pinNames) {
        const ty = (censusSchema.find((c2) => c2.name === tn.k) || {}).type;
        teeAcc[tn.k] = ty === 'number' ? { bi: tn.bi, data: new Float64Array(header.count).fill(NaN) } : { bi: tn.bi, codes: new Uint16Array(header.count), dict: [''], map: new Map([['', 0]]) };
      }
    }
    for await (const batch of lineFields(blob, header.delim, header.hasHeaderRow !== undefined ? header.hasHeaderRow : !!header.columns)) {
      for (const f of batch) scanRow(f);
      await new Promise((r) => setTimeout(r));
      if (!alive()) return;                  // superseded — stop before pushing more compact chunks
    }
    if (teeAcc && alive()) { for (const tn of pinNames) { const e = teeAcc[tn.k]; if (!e) continue; delete e.map; delete e.bi; pinPut(AL, tn.k, e); } teeAcc = null; }
    }
    }
  }

  if (!alive()) return;                      // superseded mid-scan by a newer filter
  if (cb2) {                                               // compacted: matches ARE the chunks — no mask needed
    cflush();
    try { await cb2.flush(); } catch { /* a closed / failed builder: superseded, or the mask path below */ }
    if (!alive()) return;
    if (_compactBuilders.get(lid) === cb2) closeCompactBuilder(lid);
    H.renderer.setFilter(null, {}, lid);
    H.renderer.setActiveSet('compact', lid);
  } else {
    H.renderer.setActiveSet('base', lid);
    H.renderer.setFilter(mask, { isolate }, lid);         // default = isolate; context = dim the rest
  }
  // the attribute table's only-matches mode needs the mask EITHER WAY — the
  // compact path renders matches as chunks, but the table reads rows
  { const Lf = layerById(lid); if (Lf) { Lf._filterMask = mask; H.attrTableFilterChanged(lid); H.refreshLinkedWindows(Lf, 'filtered'); } }
  H.requestRender();
  $('#meta').textContent = `${fBlockDoc.metaLine} · filter: ${hits.toLocaleString()} of ${rec.toLocaleString()} match${cb2 ? ' · compacted' : ''}`;
}

// the status line for a drillhole layer's filter (+ the section's holes, said apart)
export function dhFilterMeta(L) {
  const dh = L.docs.dhDoc;
  let t = dh.metaLine;
  if (L._filterMask) t += ` · filter: ${(L._filterHits || 0).toLocaleString()} of ${dh.header.count.toLocaleString()} match${L._holeIds ? ` · ${L._holeIds.size} holes` : ''}`;
  if (L._secHoleSig != null) t += ` · ${L._secHoleCount} holes cross the section`;
  return t;
}

export function dhFilterSweep(L, expr) {                          // the interval-table sweep for ANY dh layer (hole-mask aware)
  const dh = L && L.docs && L.docs.dhDoc; if (!dh) return null;
  const hm = L._holeMask || null;                           // the hole filter IS a filter; the section's holes are not
  if (!(expr || '').trim()) {
    L._filterMask = hm ? hm.slice() : null;
    let hits = 0; if (hm) for (const m of hm) if (m) hits++;
    L._filterHits = hits;
    H.attrTableFilterChanged(L.id); H.refreshLinkedWindows(L, 'filtered'); H.pushDhMask(L);
    return hm ? hits : null;
  }
  const schema = schemaExt(L, dh.header);
  const v2 = validate(expr, schema);
  if (!v2.ok) return { err: (v2.errors[0] && v2.errors[0].message) || 'invalid expression' };
  const fn2 = compileBool(expr, schema, { decimal: '.' });
  const mask2 = new Uint8Array(dh.header.count);
  let hits2 = 0;
  for (let i = 0; i < dh.header.count; i++) { if (hm && !hm[i]) continue; if (fn2(extendRow(L, dh.fetchRecord(i), i))) { mask2[i] = 1; hits2++; } }
  L._filterMask = mask2; L._filterHits = hits2;
  H.attrTableFilterChanged(L.id); H.refreshLinkedWindows(L, 'filtered'); H.pushDhMask(L);
  return hits2;
}
