// micro — the BLOCK MODEL readers, one per source: delimited (CSV/TXT/DAT, two-sweep grid
// inference, sub-blocks, rotated lattice candidates), Datamine .dm (strided column reads)
// and Parquet (streamed row group by row group, the micro:model footer). reopenBlockChan
// re-reads a model for a new colour channel through the same three. openBlob
// (src/open.js) dispatches here.
import { startChunkBuilder } from './chunkworker.js';
import { layerById, S, requestRender } from './state.js';
import { gridFromBasis, mapColumns, findDimColumns, DIM_PALETTE_MAX, inferAxis, inferSubBlockLattice, detectRotatedLattice, detectRotatedOverAxisGrid, isDimColumn, dimKey, basisAngles, openBlockModel, makeBlockGrid, createChunkBuilder, dmWireframeRole, peekDmColumns, openDmModel } from '../../../ext/condenser/src/main.js';
import { parquetInfoAsync, streamParquetColumns } from '../../../ext/parquet/index.js';
import { scan } from './scanner.js';
import { microConfirm } from './prompts.js';
import { registerDocs, streamInto } from './open.js';
import { fitFromHeader, recomputeUnion } from './layers.js';
import { setColorLabels } from './color.js';
import { applyBlockFilter } from './filter.js';
const $ = (s) => document.querySelector(s);

// the open's block chunk builder: OFF the page (src/chunkworker.js — the same
// builder, batches and seed, so the same chunks). Building ran on the page and
// was most of a big open's stalls (~0.5 s a 2M-block batch, Morton sort and
// packing). 128k/chunk, 16 chunks per Morton batch: tight bboxes are what give
// the frustum test teeth. Where workers can't run, the page builds, as before.
async function baseBlockBuilder(lid, { frame, grid, dimPalette }) {
  // several builders, a Morton batch each (every batch its own seed, so the
  // chunks — and their order — are the same however many build them, or the page)
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const cb = await startChunkBuilder({ frame, grid, dimPalette, chunkSize: 1 << 17, batchSize: 1 << 21, seed: 1, seedPerBatch: true,
    workers: window.__baseBuilders || Math.max(1, Math.min(4, hc - 2)),
    onChunk: (c) => { if (layerById(lid)) { S.renderer.addChunk(c, 'base', lid); requestRender(); } } });
  window.__baseOffPage = cb.offPage; window.__baseBuilders_n = cb.workers;   // smoke hooks: where (and on how many) the open built its chunks
  return cb;
}
// Parquet block model (columnar): the FOOTER gives columns + types + row count
// for free (no text sniff), coord columns come from the schema, and the whole
// table is read as in-memory column arrays that the shared block pipeline (grid
// inference, chunks, pick, filter, eval) consumes via a provider hook. Native
// row-group streaming + the footer's per-group bbox as a spatial index are the
// next step; this is the working opener.
const _pqNum = (t) => /INT|FLOAT|DOUBLE|DECIMAL/.test(t || '');
// micro:model's grid → micro's internal grid. Forms accepted: per-axis
// { x, y, z } (axis-aligned), the internal rotated form (+ rot, anchor), or a
// producer's { basis: { origin, U, V, W, counts, source? } } alone.
function microModelGrid(m) {
  const g = m && m.grid;
  if (!g) return null;
  if (g.rot && g.anchor && g.x) return { x: g.x, y: g.y, z: g.z, rot: g.rot, anchor: g.anchor, ...(g.source ? { source: g.source } : {}) };
  if (g.basis) return gridFromBasis(g.basis);
  return g.x ? { x: g.x, y: g.y, z: g.z } : null;
}
// micro:model `dims` (names) → column indices in THIS file, or null if absent/missing
function microModelDimCols(m, names) {
  if (!m || !m.dims) return null;
  const d = { x: names.indexOf(m.dims.x), y: names.indexOf(m.dims.y), z: names.indexOf(m.dims.z) };
  return d.x >= 0 && d.y >= 0 && d.z >= 0 ? d : null;
}
export async function openParquetBlocks(blob, name, opts = {}) {
  // the layer holds the BLOB, never the bytes: every read below range-reads
  // (toAsyncBuffer slices the blob), so a multi-GB parquet costs no residency.
  // info.meta rides along so hyparquet never re-parses the footer per call.
  $('#meta').textContent = `${name} — reading parquet footer…`;
  const info = await parquetInfoAsync(blob);
  const names = info.columns.map((c) => c.name);
  const typeOf = {}; info.columns.forEach((c) => { typeOf[c.name] = c.type; });
  if (names.length < 3) throw new Error('parquet: need at least 3 columns (X, Y, Z)');
  const mapping = opts.mapping || mapColumns(names) || { x: 0, y: 1, z: 2, chan: names.length > 3 ? 3 : null, cat: null };
  if (mapping.x == null || mapping.y == null || mapping.z == null) throw new Error('parquet: could not identify X/Y/Z centroid columns');
  if (mapping.chan != null && !_pqNum(typeOf[names[mapping.chan]])) mapping.chan = null;   // demote a text auto-chan
  // a host's stated roles are exact (strictMapping): no auto-category
  if (mapping.cat == null && !opts.strictMapping) for (let i = 0; i < names.length; i++) { if (i === mapping.x || i === mapping.y || i === mapping.z || i === mapping.chan) continue; if (!_pqNum(typeOf[names[i]])) { mapping.cat = i; break; } }
  const xN = names[mapping.x], yN = names[mapping.y], zN = names[mapping.z];
  const chanN = mapping.chan != null ? names[mapping.chan] : null, catN = mapping.cat != null ? names[mapping.cat] : null;
  const N = info.rowCount;
  if (!N) throw new Error('parquet: empty table');
  // ── discovery: ONE streamed pass over the coord (+ cat) columns — a row
  // group resident at a time, nothing retained. bbox could come from the
  // footer stats; the distinct axes (grid pitch) need the values. ──
  // cached discovery: an explicit sidecar wins, else the file's own
  // `micro:model` kv (micro-written parquets are self-describing)
  let kvModel = null;
  try { const e = (info.meta.key_value_metadata || []).find((x) => x.key === 'micro:model'); if (e) kvModel = JSON.parse(e.value); } catch { /* foreign file */ }
  // per-block size columns (DX/DY/DZ…) → maybe SUB-BLOCKED, as for CSV. A
  // cached model that says sub-blocked must name its size columns and carry the
  // palette (micro:model `dims` + `dimPalette`); one that doesn't (older micro
  // exports wrote only the flag) is not trusted — discovery rebuilds it.
  const dimIdx = opts.dimCols || findDimColumns(names);
  // a CALLER-declared lattice (addLayer on a file) outranks the footer: the
  // discovery sweep still runs (bbox, categories) and checks every record on it
  const declared = opts.lattice || null;
  const cachedPq0 = declared ? null : (opts.cached || kvModel);
  const cachedDims = cachedPq0 && cachedPq0.subBlocked ? microModelDimCols(cachedPq0, names) : null;
  // the cached categories must be THIS open's category column. Older footers don't
  // name it (catColumn), so they're trusted unless the caller changed the category;
  // a model cached with none can't serve one either. Untrusted → discovery sweeps.
  const catOk = (c) => (!c.categories ? catN == null : c.catColumn ? c.catColumn === catN : !opts.catChanged);
  const cachedPq = cachedPq0 && catOk(cachedPq0) && (!cachedPq0.subBlocked || (cachedDims && Array.isArray(cachedPq0.dimPalette))) ? cachedPq0 : null;
  let grid = null, categories = null, subBlocked = false, dimPalette = null, dimCols = null;
  let latticeInfo = null, latticeCandidate = null, latticeRejected = null;
  // a colour-by switch on the SAME file: grid, bbox, categories and sizes don't
  // depend on the channel, so the live header serves them (CSV and .dm already
  // did this; Parquet re-ran the discovery sweep — 75 s on a 60M model)
  const reuse = opts.reuse;
  const reuseOk = reuse && reuse.mapping && ['x', 'y', 'z', 'cat'].every((k) => (reuse.mapping[k] ?? null) === (mapping[k] ?? null));
  if (reuseOk) {
    grid = reuse.grid || null; categories = reuse.categories || null;
    subBlocked = !!reuse.subBlocked; dimPalette = reuse.dimPalette || null; dimCols = reuse.dimCols || null;
    var min = [...reuse.bbox.min], max = [...reuse.bbox.max];   // hoisted, as below
    latticeInfo = reuse.lattice || null; latticeRejected = reuse.latticeRejected || null;
  } else if (cachedPq && cachedPq.bbox && !opts.forcePoints) {
    // freshness = the caller's contract (sidecar) or intrinsic (kv rides the file)
    grid = microModelGrid(cachedPq);
    categories = cachedPq.categories || null;
    if (cachedPq.subBlocked && grid) { subBlocked = true; dimPalette = cachedPq.dimPalette; dimCols = cachedDims; }
    var min = [...cachedPq.bbox.min], max = [...cachedPq.bbox.max];   // hoisted (used by header below)
    // a DECLARED lattice (a producer stated it) or any rotated one is the file's
    // statement, applied without a confirm — but checked against every centroid:
    // one off it and the declaration is refused, loudly, and the model shows as points
    // ...and so is an axis grid another producer stated (not micro's own): a
    // corner origin where micro expects a centroid is a half-block shift
    if (grid && (grid.rot || cachedPq.declared || cachedPq.by !== 'micro') && !opts.cached) {
      $('#meta').textContent = `${name} — checking the declared lattice…`;
      // on the worker pool when it can run, else on the page (@gcu/scan decides)
      const { bad } = await scan.checkLattice({ file: blob, meta: info.meta, rowGroups: info.rowGroups, cols: [xN, yN, zN], grid });
      if (bad) { latticeRejected = bad; grid = null; subBlocked = false; }
    }
    if (grid) latticeInfo = cachedPq.lattice || (cachedPq.declared || grid.rot ? { basis: 'declared', by: cachedPq.declared || 'file' } : null);
  } else {
  const CAP = 100000;
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const ax = [new Set(), new Set(), new Set()];
  const catSet = catN ? new Set() : null;
  const dN = dimIdx ? [names[dimIdx.x], names[dimIdx.y], names[dimIdx.z]] : null;
  const minDim = [Infinity, Infinity, Infinity], dimSet = new Set();
  const RES = 50000, res = [];                              // reservoir: the first centroids (rotated-lattice inference)
  const discCols = [xN, yN, zN, ...(catN ? [catN] : []), ...(dN || [])];
  $('#meta').textContent = `${name} — discovering grid…`;
  // @gcu/scan runs each row group's summary on the worker pool when it can, else
  // on the page; merged here in group order, caps included, it is what one
  // sequential sweep gives (the grid, categories and reservoir)
  const groups = await scan.discoverParquet({
    file: blob, meta: info.meta, rowGroups: info.rowGroups, res: RES,
    p: { cols: discCols, xN, yN, zN, catN, dN, cap: CAP, dimMax: DIM_PALETTE_MAX },
    onProgress: (d) => { $('#meta').textContent = `${name} — discovering grid… ${Math.round(100 * d / N)}%`; },
  });
  for (const g of groups) {
    for (let a = 0; a < 3; a++) { if (g.min[a] < min[a]) min[a] = g.min[a]; if (g.max[a] > max[a]) max[a] = g.max[a]; for (const v of g.ax[a]) { if (ax[a].size >= CAP) break; ax[a].add(v); } }
    if (catSet && g.cats) for (const v of g.cats) { if (catSet.size > 256) break; catSet.add(v); }
    if (g.dims) { for (let a = 0; a < 3; a++) if (g.minDim[a] < minDim[a]) minDim[a] = g.minDim[a]; for (const k of g.dims) { if (dimSet.size > DIM_PALETTE_MAX) break; dimSet.add(k); } }
    if (g.res) for (let k = 0; k < g.res.length && res.length < RES * 3; k++) res.push(g.res[k]);
  }
  // a declared lattice is checked against every centroid, as its own job
  const declaredBad = declared ? (await scan.checkLattice({ file: blob, meta: info.meta, rowGroups: info.rowGroups, cols: [xN, yN, zN], grid: declared })).bad : null;
  if (declared && declaredBad) throw new Error(`declared lattice rejected — ${declaredBad}`);
  const axes = declared ? null : ax.map((set) => (set.size < CAP ? inferAxis([...set].sort((a, b) => a - b)) : null));
  grid = opts.forcePoints ? null : declared ? { ...declared } : axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;
  if (declared) latticeInfo = { basis: 'declared', by: opts.declaredBy || 'caller' };
  // the same sub-block rule as the CSV and .dm readers (condenser grid/infer.js)
  const sb = !opts.forcePoints && !declared && dN ? inferSubBlockLattice(ax, minDim, dimSet, { cap: CAP }) : null;
  if (sb) { grid = sb.grid; subBlocked = true; dimPalette = sb.dimPalette; dimCols = dimIdx; }
  // not an axis-aligned grid → maybe a ROTATED one: a candidate the opener confirms
  const coordSweep = () => (async function* () {
    for await (const { count, cols } of streamParquetColumns(blob, [xN, yN, zN], info.rowGroups, info.meta)) yield { x: cols[xN], y: cols[yN], z: cols[zN], count };
  })();
  if (!grid && !subBlocked && !opts.forcePoints && res.length >= 24) {
    $('#meta').textContent = `${name} — trying a rotated lattice…`;
    latticeCandidate = await detectRotatedLattice(Float64Array.from(res), coordSweep);
  } else if (grid && !declared && !subBlocked && !opts.forcePoints) {
    // a rotated model can ALSO read as a sparse, wrong axis grid (45°, 3-4-5…)
    const c = await detectRotatedOverAxisGrid(grid, N, Float64Array.from(res), coordSweep);
    if (c) { grid = null; latticeCandidate = c; }
  }
  categories = catSet && catSet.size > 0 && catSet.size <= 255 ? [...catSet].sort() : null;
  }
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;
  const numericColumns = names.map((n, i) => ({ name: n, i })).filter(({ i }) => i !== mapping.x && i !== mapping.y && i !== mapping.z && !(subBlocked && isDimColumn(names[i])) && _pqNum(typeOf[names[i]]));
  const attributes = names.filter((_, i) => i !== mapping.x && i !== mapping.y && i !== mapping.z);
  let crs = null;
  try { const e = (info.meta.key_value_metadata || []).find((x) => x.key === 'micro:frame'); if (e) crs = JSON.parse(e.value).crs || null; } catch { /* foreign file */ }
  const header = { kind: 'blockmodel', count: N, bbox: { min, max }, grid, subBlocked, dimPalette, dimCols, columns: names, mapping, delim: ',', hasHeaderRow: true, numericColumns, categories, attributes, parquet: true, crs, lattice: latticeInfo, latticeCandidate, latticeRejected };
  // ── display: stream the coord + chan + cat (+ size) columns row-group by
  // row-group into the chunk builder; nothing decoded is retained after it. ──
  const dimCode = subBlocked ? new Map(dimPalette.map((hd, i) => [dimKey(hd[0] * 2, hd[1] * 2, hd[2] * 2), i])) : null;
  const sizeN = subBlocked ? [names[dimCols.x], names[dimCols.y], names[dimCols.z]] : null;
  async function* streamChunks() {
    const cnames = [...new Set([xN, yN, zN, ...(chanN ? [chanN] : []), ...(catN ? [catN] : []), ...(sizeN || [])])];
    // each group as the builder's typed arrays, in order — decoded on the worker
    // pool when it can run, else on the page; here the page only builds chunks
    yield* scan.decodeParquet({ file: blob, meta: info.meta, rowGroups: info.rowGroups,
      p: { cols: cnames, xN, yN, zN, chanN, catN, sizeN, categories, dimKeys: subBlocked ? dimPalette.map((hd) => dimKey(hd[0] * 2, hd[1] * 2, hd[2] * 2)) : null } });
  }
  // the layer holds NO decoded columns — just the bytes, schema, and row-group
  // table; pick/filter/eval re-read the source, a group at a time (like CSV)
  const pq = { buf: blob, meta: info.meta, names, mapping, rowGroups: info.rowGroups, coordNames: [xN, yN, zN], catName: catN, catCode };
  await openBlocksBlob(blob, name, { ...opts, provider: async () => ({ header, streamChunks, parquet: pq }) });
}
// ── rotated lattices (condenser grid/basis.js) ───────────────────────────────
// A provider that finds no axis-aligned grid tries a ROTATED one and hands back
// header.latticeCandidate — never applied silently (spec §3): the user says
// boxes or points. opts.acceptLattice (true/false) answers for a caller that
// has already decided (a host, a test); the decision is stamped on the header
// (header.lattice) and so rides into the sidecar, the manifest and lineage.
const fmtPitch = (v) => String(+(+v).toFixed(4));
function latticeNote(g) {
  if (!g || !g.rot) return '';
  const a = basisAngles(g.rot);
  return ` · rotated ${a.azimuth.toFixed(1)}°${a.zOnly ? '' : `, tilt ${a.tilt.toFixed(1)}°`}`;
}
async function settleLatticeCandidate(header, name, opts = {}) {
  const c = header.latticeCandidate;
  if (!c || header.grid) return;
  const g = c.grid, a = c.angles;
  const desc = `${g.x.count}×${g.y.count}×${g.z.count} blocks of ${fmtPitch(g.x.pitch)}×${fmtPitch(g.y.pitch)}×${fmtPitch(g.z.pitch)}, azimuth ${a.azimuth.toFixed(1)}°${a.zOnly ? '' : `, tilted ${a.tilt.toFixed(1)}°`}`;
  const yes = opts.acceptLattice != null ? !!opts.acceptLattice
    : await microConfirm('rotated block model', `${name} isn't on an axis-aligned grid, but every centroid sits on a ROTATED lattice: ${desc}. Draw it as rotated boxes, or keep the centroids as points?`, 'rotated boxes', 'points');
  header.latticeCandidate = null;
  if (yes) { header.grid = g; header.lattice = { basis: 'inferred', confirmed: opts.acceptLattice != null ? 'caller' : 'user', azimuth: +a.azimuth.toFixed(4), tilt: +a.tilt.toFixed(4) }; }
}
// rows a delimited model dropped because they have no usable coordinates (blank
// or not a number) — a data error, so it's said, never silent
// A rotated Datamine model (ANGLEn about ROTAXISn) is shown in its own,
// unrotated frame — micro does not yet convert Datamine's rotation (no
// rotated fixture has been checked against its convention), so it SAYS so
// everywhere the layer is described, rather than placing blocks plausibly wrong.
export function dmRotationText(h) {
  const r = h && h.dmRotation;
  return r && r.length ? r.map((x) => `${+x.angle.toFixed(3)}° about ${x.axis}`).join(', then ') : '';
}
export function rotationNote(h) {
  const t = dmRotationText(h);
  return t ? ` · ⚠ ROTATED Datamine model (${t}) — shown in the model's own frame, NOT rotated into world coordinates: volumes, grades and tonnages are right; positions against other layers are not` : '';
}
export function droppedNote(h) {
  const d = h && h.dropped;
  if (!d || !(d.blank + d.text)) return '';
  const why = [d.blank ? `${d.blank.toLocaleString()} blank` : '', d.text ? `${d.text.toLocaleString()} not a number` : ''].filter(Boolean).join(', ');
  return ` · ${(d.blank + d.text).toLocaleString()} row${d.blank + d.text === 1 ? '' : 's'} dropped — no usable coordinates (${why}; first at data row ${d.firstRow.toLocaleString()})`;
}
export async function openBlocksBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  // a cached discovery skips sweep 1: project sidecars pass opts.discovered;
  // a channel switch on the SAME blob reuses the TARGET LAYER's live header
  // (grid / index / categories are mapping-independent — only the chan changes)
  const prevDoc = (layerById(lid) || {}).docs && layerById(lid).docs.blockDoc || null;
  const discovered = opts.discovered
    || (opts.chan != null && prevDoc && prevDoc.header && prevDoc.blob === blob
      ? { ...prevDoc.header, mapping: { ...prevDoc.header.mapping, chan: opts.chan } }
      : null);
  $('#meta').textContent = `${name} — ${discovered || opts.provider ? 'reading…' : 'discovering grid…'}`;   // a provider has already discovered
  const mapping = opts.mapping
    || (opts.chan != null && prevDoc && prevDoc.header ? { ...prevDoc.header.mapping, chan: opts.chan } : null);
  S.renderer.removeLayer(lid); if (!opts.keepFilter) S.renderer.setFilter(null, {}, lid);
  const prov = opts.provider ? await opts.provider() : null;
  const qualify = (layerById(lid) || {}).qualify || opts.qualify || null;
  const bmOpts = discovered ? { discovered, qualify } : { qualify, zones: !window.__noZones, ...(mapping ? { mapping } : {}), ...(opts.lattice ? { lattice: opts.lattice } : {}), ...(opts.dimCols ? { dims: opts.dimCols } : {}), rotated: !opts.forcePoints };
  const { header, streamChunks } = prov || await openBlockModel(blob, bmOpts);
  if (opts.forcePoints) { header.grid = null; header.latticeCandidate = null; }
  await settleLatticeCandidate(header, name, opts);
  if (header.latticeRejected) dispatchEvent(new CustomEvent('micro:lattice-rejected', { detail: { name, reason: header.latticeRejected } }));
  // keep the provider's STREAM, not just its data. It used to be used once at
  // open and discarded, so every later consumer re-derived how to read this
  // source from format flags — which is how Parquet kept landing in the
  // delimited branch. A doc that carries its own reader cannot be misread.
  const blockDoc = { blob, name, header, metaLine: '', forcePoints: opts.forcePoints, parquet: prov ? prov.parquet : null, streamChunks };
  registerDocs(lid, header.grid ? 'blocks' : 'points', { blockDoc });
  { const L0 = layerById(lid); if (L0 && L0.lineage && header.grid && header.grid.rot) L0.lineage.params = { ...(L0.lineage.params || {}), lattice: { rotated: true, ...basisAngles(header.grid.rot), ...(header.lattice || { basis: 'declared' }) } }; }
  fitFromHeader(header, opts.first !== false && opts.chan == null);
  S.renderer.setCategories(header.categories ? header.categories.length : 0);
  setColorLabels(header);
  if (header.grid) {
    const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], S.frame, header.grid.rot || null, header.grid.anchor || null);
    blockDoc.grid = grid;
    const dimPalette = header.subBlocked ? header.dimPalette : null;
    const cb = await baseBlockBuilder(lid, { frame: S.frame, grid, dimPalette });   // 128k/chunk, 16 chunks per Morton batch: tight bboxes are what give the frustum test teeth
    const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
    blockDoc.drawn = doc.count;                            // how many records have a block (a value texture leaves the rest out of its range)
    blockDoc.metaLine = header.subBlocked
      ? `${name} — ${doc.count.toLocaleString()} sub-blocks · fine ${header.grid.x.pitch}×${header.grid.y.pitch}×${header.grid.z.pitch} · ${header.dimPalette.length} sizes${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`
      : `${name} — ${doc.count.toLocaleString()} blocks · grid ${header.grid.x.count}×${header.grid.y.count}×${header.grid.z.count} @ ${fmtPitch(header.grid.x.pitch)}×${fmtPitch(header.grid.y.pitch)}×${fmtPitch(header.grid.z.pitch)}${latticeNote(header.grid)}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
    blockDoc.metaLine += droppedNote(header);
    $('#meta').textContent = blockDoc.metaLine;
    { const Lk = layerById(lid); if (opts.keepFilter && Lk && (Lk.filterExpr || "").trim()) applyBlockFilter(Lk.filterExpr, Lk); }   // THIS layer's filter (was the active one's)
  } else {
    // centroids as points (sub-blocked / irregular): grade → the intensity slot
    const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
    let done = 0;
    for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
      let cMin = Infinity, cMax = -Infinity;
      for (let i = 0; i < rc.count; i++) { const v = rc.chan[i]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
      const s = cMax > cMin ? 65535 / (cMax - cMin) : 0;
      const intensity = new Uint16Array(rc.count);
      for (let i = 0; i < rc.count; i++) intensity[i] = Number.isFinite(rc.chan[i]) ? ((rc.chan[i] - cMin) * s) | 0 : 0;
      cb.push({ count: rc.count, x: rc.x, y: rc.y, z: rc.z, intensity, classification: rc.cat || new Uint8Array(rc.count), rgb: null, recStart: rc.recStart, ...(rc.recIdx ? { recIdx: rc.recIdx } : {}) });   // raw numbers when the source has gaps (Parquet)
      done += rc.count;
      $('#meta').textContent = `${name} — streaming ${Math.round(100 * done / (header.count || 1))}% (no regular grid — showing centroids)`;
      await new Promise((r) => setTimeout(r));
    }
    const doc = cb.flush();
    const L2 = layerById(lid); if (L2) L2.bboxLocal = doc.bboxLocal;
    recomputeUnion();
    blockDoc.metaLine = `${name} — ${doc.count.toLocaleString()} centroids${header.latticeRejected ? ` (the declared lattice was REFUSED: ${header.latticeRejected} — points view)` : blockDoc.forcePoints ? '' : ' (no regular grid detected — points view)'}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
    blockDoc.metaLine += droppedNote(header);
    $('#meta').textContent = blockDoc.metaLine;
    { const Lk = layerById(lid); if (opts.keepFilter && Lk && (Lk.filterExpr || "").trim()) applyBlockFilter(Lk.filterExpr, Lk); }   // THIS layer's filter (was the active one's)
  }
  requestRender();
}
// .dm path: grid, bbox, and schema come from the DD page — no discovery sweep
// (micro-spec Addendum A.2). Record numbers are RAW, so picks fetch O(1).
export async function openDmBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  const prevDoc = (layerById(lid) || {}).docs && layerById(lid).docs.blockDoc || null;
  // a lone Datamine wireframe half → guide the user to open the pair (a wireframe
  // is a points file + a triangles file; one alone isn't a viewable model)
  if (opts.chan == null) {
    const role = dmWireframeRole(await peekDmColumns(blob).catch(() => null));
    if (role) { const other = role === 'points' ? 'triangles (…tr.dm)' : 'points (…pt.dm)'; throw new Error(`Datamine wireframe ${role} file — open it together with its ${other} file to view the mesh`); }
  }
  $('#meta').textContent = `${name} — reading DD…`;
  // an explicit full mapping (project restore / cat re-key) wins; else a chan
  // switch reuses the live layer's header, optionally re-keying the category
  let mapping = opts.mapping || null;
  if (!mapping && (opts.chan != null || opts.cat != null) && prevDoc && prevDoc.header)
    mapping = { chan: opts.chan != null ? opts.chan : prevDoc.header.mapping.chan, ...(opts.cat != null ? { cat: opts.cat } : {}) };
  S.renderer.removeLayer(lid); if (!opts.keepFilter) S.renderer.setFilter(null, {}, lid);
  // sub-blocked / irregular models run a FULL discovery sweep before the first
  // chunk (a 13 GB file reads silently for a minute otherwise) — show progress
  const gb = blob.size / 1073741824;
  const onProgress = (p) => { $('#meta').textContent = `${name} — discovery sweep ${Math.round(100 * p.done / (p.total || 1))}% of ${p.total.toLocaleString()} records${gb > 0.5 ? ` (${gb.toFixed(1)} GB)` : ''}…`; };
  const { header, streamChunks } = await openDmModel(blob, { ...(mapping ? { mapping } : {}), forcePoints: opts.forcePoints, onProgress, cached: opts.cached || null });
  const blockDoc = { blob, name, header, metaLine: '', forcePoints: opts.forcePoints, streamChunks };
  registerDocs(lid, header.grid ? 'blocks' : 'points', { blockDoc });
  fitFromHeader(header, opts.first !== false && opts.chan == null);
  S.renderer.setCategories(header.categories ? 1 : 0);
  setColorLabels(header);
  if (header.grid) {
    const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], S.frame);
    blockDoc.grid = grid;
    const dimPalette = header.subBlocked ? header.dimPalette : null;
    const cb = await baseBlockBuilder(lid, { frame: S.frame, grid, dimPalette });
    const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
    blockDoc.drawn = doc.count;
    blockDoc.metaLine = header.subBlocked
      ? `${name} — ${doc.count.toLocaleString()} sub-blocks · .dm fine ${header.grid.x.pitch}×${header.grid.y.pitch}×${header.grid.z.pitch} · ${header.dimPalette.length} sizes${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`
      : `${name} — ${doc.count.toLocaleString()} blocks · .dm grid ${header.grid.x.count}×${header.grid.y.count}×${header.grid.z.count} @ ${header.grid.x.pitch}×${header.grid.y.pitch}×${header.grid.z.pitch}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
    blockDoc.metaLine += rotationNote(header);
  } else {
    // sub-blocked / forced points: centroids as points (grade → intensity slot),
    // RAW record numbers preserved so a picked centroid fetches its .dm record
    const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
    let done = 0;
    for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
      let cMin = Infinity, cMax = -Infinity;
      for (let i = 0; i < rc.count; i++) { const v = rc.chan[i]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
      const s = cMax > cMin ? 65535 / (cMax - cMin) : 0;
      const intensity = new Uint16Array(rc.count);
      for (let i = 0; i < rc.count; i++) intensity[i] = Number.isFinite(rc.chan[i]) ? ((rc.chan[i] - cMin) * s) | 0 : 0;
      cb.push({ count: rc.count, x: rc.x, y: rc.y, z: rc.z, intensity, classification: rc.cat || new Uint8Array(rc.count), rgb: null, recIdx: rc.recIdx });
      done += rc.count;
      await new Promise((r) => setTimeout(r));
    }
    const doc = cb.flush();
    const L2 = layerById(lid); if (L2) L2.bboxLocal = doc.bboxLocal;
    recomputeUnion();
    blockDoc.metaLine = `${name} — ${doc.count.toLocaleString()} centroids (sub-blocked .dm — points view)${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}` + rotationNote(header);
  }
  $('#meta').textContent = blockDoc.metaLine;
  { const Lk = layerById(lid); if (opts.keepFilter && Lk && (Lk.filterExpr || "").trim()) applyBlockFilter(Lk.filterExpr, Lk); }   // THIS layer's filter (was the active one's)
  requestRender();
}
// Re-open a block model on a new grade channel. THREE sources, not two — and the
// dispatch lives HERE, once, because it existed in three copies and two of them
// were wrong. A Parquet layer handed to openBlocksBlob gets its bytes sniffed as
// delimited text, yielding no rows and an empty layer that keeps its name, its
// columns and its count; Parquet must re-open through its own provider, and takes
// the channel as a mapping patch because it resolves columns by mapping rather
// than by an opts.chan index.
export function reopenBlockChan(doc, chan, extra = {}) {
  const o = { keepFilter: true, forcePoints: doc.forcePoints, layer: S.activeId, first: false, ...extra };
  if (doc.header.dm) return openDmBlob(doc.blob, doc.name, { ...o, chan });
  if (doc.parquet) {
    const m = doc.header.mapping;
    return openParquetBlocks(doc.blob, doc.name, { ...o, mapping: { x: m.x, y: m.y, z: m.z, chan, cat: m.cat }, reuse: doc.header });
  }
  return openBlocksBlob(doc.blob, doc.name, { ...o, chan });
}
