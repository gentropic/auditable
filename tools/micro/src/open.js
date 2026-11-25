// micro — the layer OPENERS: one file in, one layer out. openBlob is the ONE dispatcher
// (by extension, then by content). The readers behind it live by source family:
// src/open-blocks.js (delimited / Datamine / Parquet block models), src/open-mesh.js
// (PLY / OBJ / MSH / LFM / DXF / .wfr meshes and Datamine wireframe pairs),
// src/open-grid.js (GeoTIFF, Surfer, ESRI ASCII) and src/open-table.js (tables and
// workbooks). Here: the dispatcher, LAS and PLY point clouds, drillhole sets, and the
// helpers every reader shares (registerDocs, streamInto, layerFailed).
import { S, _fileHandles, activeLayer, layerById, requestRender } from './state.js';
import { syncNoData } from './ramp.js';
import { createChunkBuilder, createStickChunkBuilder, mapColumns, openDrillholes, openLas, openPly, sniffDelimited } from '../../../ext/condenser/src/main.js';
import { openLineage } from './lineage.js';
import { isWfrName } from './wfr-io.js';
import { maybeOfferParquet } from './pqoffer.js';
import { isBackupName } from './backup.js';
import { openPackFile } from './project-pack.js';
import { openOmfBlob } from './omf.js';
import { qualifyDhDoc } from './records.js';
import { peekCollarCols } from './manifest.js';
import { renderLayers } from './layers-panel.js';
import { ensureDhSetGroups, reopenDh } from './drillholes.js';
import { setColorLabels } from './color.js';
import { LAYER_CAP, allocLayerId, closeAllLayers, fitFromHeader, recomputeUnion, setActiveLayer } from './layers.js';
import { detectDmWireframePairs, openDmWireframeBlob, plyHasFaces, openWfrFile, openDxfBlob, openMeshDoc } from './open-mesh.js';
import { openGridBlob, ascLooksLikeGrid } from './open-grid.js';
import { openDmBlob, openParquetBlocks, openBlocksBlob } from './open-blocks.js';
import { openXlsxBlob, openTableBlob } from './open-table.js';
import { openFeaturesBlob } from './poly-ui.js';
import { featureKindOf, FEATURE_EXT, groupShapefileParts, zipShapefileSet } from './poly-io.js';
import { lasCrsOf, reprojectLas } from './las-crs.js';
import { setProjectCrs, sameCrs, crsLabel } from './crs.js';
import { layerPlacementM, placeCloudProvider } from './placement.js';
const $ = (s) => document.querySelector(s);

export async function streamInto(cb, streamChunks, header, name, chunkPoints, lid = S.activeId) {
  let done = 0, doc;
  try {
    for await (const rc of streamChunks({ chunkPoints })) {
      const n = rc.count;
      await cb.push(rc); done += n;                       // (an off-page builder may take rc's arrays: read nothing from it after; it may hold us back)
      $('#meta').textContent = `${name} — streaming ${Math.round(100 * done / (header.count || 1))}%`;
      await new Promise((r) => setTimeout(r));            // yield to the render loop
    }
    if (window.__openPhases) window.__openPhases.streamed = performance.now();
    doc = await cb.flush();
    if (window.__openPhases) window.__openPhases.flushed = performance.now();
  } finally { if (cb.close) cb.close(); }                 // every chunk is in (or the read failed): the worker can go
  const L = layerById(lid);
  if (L) L.bboxLocal = doc.bboxLocal;
  recomputeUnion();
  return doc;
}

async function openBlobs(files, mode = 'replace', at = null) {
  if (!files.length) return;
  // Datamine WIREFRAMES arrive as a pt/tr PAIR (points + triangles, two .dm files).
  // Detect them among the opened files (by fields — XP/YP/ZP+PID vs PID1/2/3) and
  // load each pair as ONE mesh; everything else opens normally. Pairs a points with
  // a triangles file, preferring the same <base>pt/<base>tr base name.
  const { pairs, singles: rest } = await detectDmWireframePairs(files);
  // loose SHAPEFILE parts (.shp + .dbf + .prj + .cpg) open as one layer: one zip of the set
  const { sets: shpSets, rest: singles } = groupShapefileParts(rest);
  let first = true;
  const openNext = async (fn) => { await fn(first && mode !== 'add' ? 'replace' : 'add', first ? at : null); first = false; };
  for (const [pt, tr] of pairs) await openNext((m, a) => openDmWireframeBlob(pt, tr, m, a));
  for (const set of shpSets) { const z = await zipShapefileSet(set); await openNext((m, a) => openBlob(z, `${set.base}.zip`, m, a)); }
  for (const f of singles) await openNext((m, a) => openBlob(f, f.name, m, a));
}

// a PDF: micro reads only the ones its composer wrote (they carry their figure) — set by the app
let _figurePdf = null;
export function setFigurePdfOpener(fn) { _figurePdf = fn; }
export async function openBlob(blob, name, mode = 'replace', at = null, over = {}) {
  if (/\.pdf$/i.test(name)) {
    if (!_figurePdf) return null;
    try { await _figurePdf(blob, name); } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; if (over.throw) throw e; }
    return null;
  }
  if (isBackupName(name)) { await openPackFile(blob); return null; }   // a project pack opens as the project (or unpacks), not as a layer
  // an OMF project is many layers (one per element), each through the host door
  if (/\.omf$/i.test(name)) {
    try {
      const r = await openOmfBlob(blob, name, mode);
      $('#meta').textContent = `${name} — ${r.layers.length} layer${r.layers.length === 1 ? '' : 's'}${r.notes.length ? ' · ' + r.notes.join(' · ') : ''}`;
      return r.layers.length ? r.layers[0] : null;
    } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; if (over.throw) throw e; return null; }
  }
  if (mode !== 'add') closeAllLayers();
  // interpretation: honor an explicit asKind override ('points' | 'blocks' |
  // 'mesh'), else sniff by extension/content. grid-from-table isn't a provider
  // yet, so 'grid' stays extension-driven (tif/grd/asc).
  let forcePoints = over.forcePoints;
  if (over.asKind === 'points') forcePoints = true;
  else if (over.asKind === 'blocks') forcePoints = false;
  else if (over.asKind == null && /\.(xyz|pts)$/i.test(name)) forcePoints = true;   // point dumps default to points
  const isMesh = over.asKind === 'mesh'
    ? /\.(msh|obj|lfm|ply)$/i.test(name)
    : (over.asKind == null && (/\.(msh|obj|lfm)$/i.test(name) || (/\.ply$/i.test(name) && !forcePoints && await plyHasFaces(blob))));
  // strings & polygons (src/poly-io.js): GeoJSON, WKT, a shapefile (zipped), a table with a WKT
  // column or the ID + X/Y/Z string shape — by name and head; "Open as → features" asks for it
  // (a DXF too). A shapefile PART alone is a helpful refusal, not "can't read .dbf".
  let featKind = null;
  if (over.asKind === 'features') featKind = /\.dxf$/i.test(name) ? 'dxf' : (await featureKindOf(blob, name)) || 'none';
  else if (over.asKind == null && !over.mapping && !over.discovered && (FEATURE_EXT.test(name) || /\.(csv|txt|tsv|dat)$/i.test(name))) featKind = await featureKindOf(blob, name);
  if (over.asKind == null && /\.(dbf|prj|shx|cpg)$/i.test(name)) featKind = 'part';
  // a table is decided before allocation: an explicit asKind, a workbook, or a
  // delimited file with no coordinate columns
  const isTable = !featKind && (over.asKind === 'table' || /\.xlsx$/i.test(name)
    || (/\.(csv|txt|dat|tsv)$/i.test(name) && !over.mapping && !over.discovered && !isMesh && over.asKind == null && !await delimitedHasCoords(blob)));
  window.__openPhases = { t0: performance.now() };        // bench hook: where an open's time goes (provider · stream · flush)
  const lid = allocLayerId();
  if (lid == null) { const msg = `layer limit reached (${LAYER_CAP}) — remove one first`; $('#meta').textContent = msg; return layerFailed(name, new Error(msg), over); }
  const first = S.layers.length === 0;
  S.layers.push({ id: lid, name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: (blob && typeof blob === 'object' && _fileHandles.get(blob)) || null, storage: 'loose', lineage: over.lineage || openLineage(name, blob), ...((over.placement || (S.reopenCarry && S.reopenCarry.placement)) ? { placement: over.placement || S.reopenCarry.placement } : {}) });   // a placement (a project's, a host's) is on the layer BEFORE its open applies it
  S.activeId = lid;
  $('#meta').textContent = `${name} — reading…`;
  $('#empty').style.display = 'none';
  try {
    if (featKind === 'part') throw new Error(`${name} is one part of a shapefile — open it together with its .shp (and .dbf / .prj), or the .zip that holds them`);
    if (featKind === 'none') throw new Error(`${name}: no strings or polygons here — a table needs a WKT column (wkt_geom) or an ID column with X / Y (Z) rows`);
    if (featKind) { await openFeaturesBlob(blob, name, { layer: lid, first, kind: featKind, parts: over.shpParts, poly: over.poly, z: over.z, assumeProjected: over.assumeProjected, noAsk: !!over.throw }); }
    else if (isWfrName(name)) { await openWfrFile(blob, name, { layer: lid, first, element: over.element, tint: over.tint, opacity: over.opacity, forceSoup: over.forceSoup, forceContext: over.forceContext }); }
    else if (/\.dxf$/i.test(name)) { await openDxfBlob(blob, name, { layer: lid, first, as: over.asKind === 'lines' ? 'strings' : (over.asKind === 'mesh' || over.asKind === 'points') ? over.asKind : null, tint: over.tint, opacity: over.opacity, stream: !!over.streamDxf }); }
    else if (isMesh && /\.(msh|obj|lfm|ply)$/i.test(name)) { await openMeshDoc(blob, name, { layer: lid, first, tint: over.tint, opacity: over.opacity, forceSoup: over.forceSoup, forceContext: over.forceContext }); }
    else if (/\.dm$/i.test(name)) { await openDmBlob(blob, name, { layer: lid, first, forcePoints, cached: over.cached, mapping: over.mapping, origin: over.origin }); }
    // grid stays extension-driven (no table→grid provider yet); asKind only picks points↔surface.
    else if ((over.asKind == null || over.asKind === 'surface' || over.asKind === 'points') && /\.(tif|tiff|grd)$/i.test(name)) { await openGridBlob(blob, name, { layer: lid, first, displayCache: over.displayCache, surface: over.asKind === 'surface', flatZ: over.flatZ != null ? over.flatZ : null, band: over.band || 0, smooth: over.smooth, worldFile: over.worldFile || (S.reopenCarry && S.reopenCarry.worldFile) || null }); }
    else if ((over.asKind == null || over.asKind === 'surface' || over.asKind === 'points') && /\.asc$/i.test(name) && await ascLooksLikeGrid(blob)) { await openGridBlob(blob, name, { layer: lid, first, surface: over.asKind === 'surface', flatZ: over.flatZ != null ? over.flatZ : null, smooth: over.smooth }); }
    else if (/\.(parquet|pq)$/i.test(name)) { await openParquetBlocks(blob, name, { layer: lid, first, forcePoints, mapping: over.mapping, cached: over.cached, strictMapping: over.strictMapping, acceptLattice: over.acceptLattice, lattice: over.lattice, declaredBy: over.declaredBy, dimCols: over.dimCols }); }
    // .xyz/.pts default to POINTS (2-decimal coords form a fake lattice); a
    // block/points asKind override rides forcePoints for every delimited file.
    else if (/\.xlsx$/i.test(name)) { await openXlsxBlob(blob, name, { layer: lid, first, sheet: over.sheet }); }
    // a delimited file with NO X/Y/Z is a TABLE, not an error (unless a mapping
    // was passed, which asserts the coordinates by hand)
    else if (isTable && /\.(csv|txt|dat|tsv)$/i.test(name)) { await openTableBlob(blob, name, { layer: lid, first }); }
    else if (/\.(csv|txt|dat|tsv|asc|xyz|pts)$/i.test(name)) { await openBlocksBlob(blob, name, { layer: lid, first, forcePoints, mapping: over.mapping, discovered: over.discovered, lattice: over.lattice, acceptLattice: over.acceptLattice, dimCols: over.dimCols }); }
    else if (/\.ply$/i.test(name)) { await openPlyBlob(blob, name, { layer: lid, first }); }
    else if (/\.las$/i.test(name)) { await openLasBlob(blob, name, { layer: lid, first }); }
    else if (/\.laz$/i.test(name)) throw new Error('LAZ (compressed LAS) isn’t supported — export as .las, or use lasZip to convert');
    else throw new Error(`micro doesn’t read ${(name.match(/\.[^.]+$/) || ['this file'])[0]} — it reads .csv .txt .dat .tsv .xlsx .dm .parquet .las .ply .xyz .pts .msh .obj .lfm .dxf .wfr .omf .tif .grd .asc .geojson .wkt .shp .zip (a shapefile)`);

    const L = layerById(lid);
    if (L && L.colorSel == null) L.colorSel = $('#colorBy').value;   // a fallback — a branch that chose (DXF strings → 'cat') keeps its choice
    renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name, kind: L ? L.kind : null } }));
    if (!over.throw) maybeOfferParquet(lid, performance.now() - window.__openPhases.t0);   // a slow block-model open: offer Parquet (a host's addLayer — over.throw — is never offered)
    return lid;
  } catch (e) {
    $('#meta').textContent = `${name} — ${e.message}`;
    S.renderer.removeLayer(lid);
    S.layers = S.layers.filter((l) => l.id !== lid);
    if (S.layers.length) setActiveLayer(S.layers[0].id);
    else $('#empty').style.display = '';
    renderLayers();
    return layerFailed(name, e, over);
  }
}

// The caller's half of a load. A failed load has always been shown in #meta and
// cleaned up; a host driving micro also needs to KNOW. openBlob resolves to the
// new layer id (null on failure) and fires micro:layer-added / micro:layer-failed;
// with over.throw it rejects with the error instead of resolving null.
function layerFailed(name, err, over = {}) {
  dispatchEvent(new CustomEvent('micro:layer-failed', { detail: { name, error: err && err.message || String(err) } }));
  if (over.throw) { if (err && typeof err === 'object') err._micro = true; throw err; }
  return null;
}

// register a layer's docs. The open path hands its doc over EXPLICITLY — the
// old shadow-global relay (_blockDoc/_dhDoc/…, snapshotted here) was a second
// source of truth that only coincided with L.docs while that layer was active,
// which is the seam the 2026-08 dispatch bugs grew from.
export function registerDocs(lid, kind, docs = {}) {
  const L = layerById(lid); if (!L) return;
  L.kind = kind;
  L.docs = docs;
  syncNoData(L);                                          // blanks draw as "no data", not the lowest grade (src/ramp.js)
}

// LAS path. Also the in-place re-read of a LAS layer (a new placement — src/placement-ui.js).
export async function openLasBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId, first = opts.first !== false;
  let prov = await openLas(blob);
  // its coordinate system (a LASF_Projection VLR): adopted as the project's when none is set,
  // reprojected into the project's when it differs (src/las-crs.js); a geographic cloud with
  // no project CRS is refused like a geographic vector file
  const lcrs = await lasCrsOf(prov.header);
  if (lcrs && !S.crs && lcrs.kind === 'geographic') throw new Error(`${name}: its coordinate system is ${crsLabel(lcrs)} — longitude/latitude, and the project has no coordinate system to reproject it into: set one (the CRS chip in the status bar) and open it again`);
  if (lcrs && !S.crs) await setProjectCrs(lcrs, { why: `from ${name}` });
  else if (lcrs && !sameCrs(lcrs, S.crs)) { prov = reprojectLas(prov, lcrs, S.crs); const Lr = layerById(lid); if (Lr && Lr.lineage) Lr.lineage.params = { ...(Lr.lineage.params || {}), reproject: prov.header.reprojected }; }
  // the layer's rigid placement (after any reprojection): every chunk, column batch and record placed
  const PM = layerPlacementM(layerById(lid));
  if (PM) prov = placeCloudProvider(prov, PM);
  const { header, streamChunks, columnBatches, fetchRecord } = prov;
  if (lcrs) header.crsName = crsLabel(lcrs);
  S.renderer.removeLayer(lid);
  registerDocs(lid, 'points', { lasDoc: { blob, name, header, columnBatches, fetchRecord, ...(header.reprojected || header.placed ? { streamChunks } : {}) } });
  stampPlacementOf(layerById(lid));
  fitFromHeader(header, first);
  setColorLabels(header);
  const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
  $('#meta').textContent = `${name} — ${doc.count.toLocaleString()} points · LAS ${header.version} fmt ${header.format}${S.frame.origin.some((v) => v) ? ` · origin ${S.frame.origin.map((v) => v.toLocaleString()).join(', ')}` : ''}`;
  requestRender();
}
const stampPlacementOf = (L) => { if (!L || !L.lineage) return; const p = { ...(L.lineage.params || {}) }; if (L.placement) p.placement = L.placement; else delete p.placement; L.lineage.params = p; };

// PLY path: discovery sweep (no header bbox) → the points pipeline. The
// provider owns fetchRecord (O(1) binary / sweep ascii) for the pick join.
export async function openPlyBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading header…`;
  let prov = await openPly(blob);
  const PM = layerPlacementM(layerById(lid));
  if (PM) prov = placeCloudProvider(prov, PM);
  const { header, streamChunks, columnBatches, fetchRecord } = prov;
  S.renderer.removeLayer(lid);
  registerDocs(lid, 'points', { plyDoc: { blob, name, header, columnBatches, fetchRecord, ...(header.placed ? { streamChunks } : {}) } });
  stampPlacementOf(layerById(lid));
  fitFromHeader(header, opts.first !== false);
  setColorLabels(header);
  const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
  $('#meta').textContent = `${name} — ${doc.count.toLocaleString()} points · PLY ${header.format === 'ascii' ? 'ascii' : 'binary'}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
  requestRender();
}

// Drillholes (micro-layers spec §5): collar + survey + intervals → desurveyed
// interval midpoints as ONE element layer over the assay table. recIdx = the
// original interval row (the identity survives @gcu/drillhole's depth sort).
export async function openDrillholeLayer(files, opts = {}, mode = 'add', over = {}) {
  if (mode !== 'add') closeAllLayers();
  const lid = allocLayerId();
  if (lid == null) { const msg = `layer limit reached (${LAYER_CAP}) — remove one first`; $('#meta').textContent = msg; return layerFailed('drillholes', new Error(msg), over); }
  const first = S.layers.length === 0;
  const name = (files.intervals && files.intervals.name) || 'drillholes';
  S.layers.push({ id: lid, name, label: `holes · ${name}`, kind: 'points', dh: true, docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'loose', lineage: over.lineage || openLineage(name, files.intervals) });
  S.activeId = lid;
  $('#meta').textContent = `${name} — desurveying…`;
  $('#empty').style.display = 'none';
  try {
    const { header, streamChunks, fetchRecord, recordPosition, holePaths } = await openDrillholes(
      { collar: files.collar, survey: files.survey, intervals: files.intervals }, opts);
    const dhDoc = { blobs: { ...files }, header, streamChunks, fetchRecord, recordPosition, holePaths, config: { ...opts } };   // streamChunks: the placed intervals (vector sections)
    peekCollarCols(dhDoc);                                 // warm the collar-column cache (menu + manifest)
    registerDocs(lid, 'points', { dhDoc });
    qualifyDhDoc(layerById(lid));                          // <0.001 → a number for every interval reader; rawRecord keeps the text
    fitFromHeader(header, first);
    S.renderer.setCategories(header.categories ? 1 : 0);
    S.renderer.setLayerCats(lid, header.categories ? 256 : 0);
    S.renderer.setLayerStickRadius(lid, opts.radius || 1);
    setColorLabels(header);
    const cb = createStickChunkBuilder({ frame: S.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
    for await (const rc of streamChunks({ chunkPoints: 1 << 16 })) {
      cb.push(rc);
      await new Promise((r) => setTimeout(r));
    }
    const doc = cb.flush();
    const L = layerById(lid);
    if (L) { L.bboxLocal = doc.bboxLocal; L.colorSel = $('#colorBy').value; }
    recomputeUnion();
    const warn = header.report.checks.reduce((t, c) => t + c.count, 0);
    dhDoc.metaLine = `${name} — ${header.placed.toLocaleString()}/${header.count.toLocaleString()} intervals · ${header.holes} holes · ${header.method === 'minimumCurvature' ? 'min curvature' : header.method} · dip ${header.dipConvention}${warn ? ` · ⚠ ${warn} check${warn > 1 ? 's' : ''} (File info)` : ''}`;
    $('#meta').textContent = dhDoc.metaLine;
    ensureDhSetGroups();                                   // every dh layer lives in its SET group (the group IS the element)
    renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name, kind: 'drillholes' } }));
    requestRender();
    return lid;
  } catch (e) {
    $('#meta').textContent = `${name} — ${e.message}`;
    S.renderer.removeLayer(lid);
    S.layers = S.layers.filter((l) => l.id !== lid);
    if (S.layers.length) setActiveLayer(S.layers[0].id);
    else $('#empty').style.display = '';
    renderLayers();
    return layerFailed(name, e, over);
  }
}

// re-channel a drillhole layer (all in memory upstream — cheap). It is a re-desurvey
// with a new channel: it had its own copy that removed the layer BEFORE reopening,
// the order reopenDh was fixed away from (a failed open lost the layer).
export async function reopenDhChan(chan, L = activeLayer()) {
  if (!L || !L.dh || !L.docs.dhDoc) return null;
  return reopenDh(L, { chan });
}

// does a delimited file carry X/Y/Z? (mapColumns is the same test the block
// provider uses — null means "no centroid columns", i.e. it is a plain table)
async function delimitedHasCoords(blob) {
  try {
    const sniff = sniffDelimited(await blob.slice(0, 64 * 1024).text());
    return !!(sniff.header && mapColumns(sniff.header));
  } catch { return false; }
}

