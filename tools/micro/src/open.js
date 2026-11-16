// micro — the layer OPENERS: one file in, one layer out. openBlob is the ONE dispatcher
// (by extension, then by content). The readers behind it live by source family:
// src/open-blocks.js (delimited / Datamine / Parquet block models), src/open-mesh.js
// (PLY / OBJ / MSH / LFM / DXF / .wfr meshes and Datamine wireframe pairs),
// src/open-grid.js (GeoTIFF, Surfer, ESRI ASCII) and src/open-table.js (tables and
// workbooks). Here: the dispatcher, LAS and PLY point clouds, drillhole sets, and the
// helpers every reader shares (registerDocs, streamInto, layerFailed).
import { S, _fileHandles, activeLayer, layerById, requestRender } from './state.js';
import { createChunkBuilder, createStickChunkBuilder, mapColumns, openDrillholes, openLas, openPly, sniffDelimited } from '../../../ext/condenser/src/main.js';
import { openLineage } from './lineage.js';
import { isWfrName } from './wfr-io.js';
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
    doc = await cb.flush();
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
  const { pairs, singles } = await detectDmWireframePairs(files);
  let first = true;
  const openNext = async (fn) => { await fn(first && mode !== 'add' ? 'replace' : 'add', first ? at : null); first = false; };
  for (const [pt, tr] of pairs) await openNext((m, a) => openDmWireframeBlob(pt, tr, m, a));
  for (const f of singles) await openNext((m, a) => openBlob(f, f.name, m, a));
}

export async function openBlob(blob, name, mode = 'replace', at = null, over = {}) {
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
  // a table is decided before allocation: an explicit asKind, a workbook, or a
  // delimited file with no coordinate columns
  const isTable = over.asKind === 'table' || /\.xlsx$/i.test(name)
    || (/\.(csv|txt|dat|tsv)$/i.test(name) && !over.mapping && !over.discovered && !isMesh && over.asKind == null && !await delimitedHasCoords(blob));
  const lid = allocLayerId();
  if (lid == null) { const msg = `layer limit reached (${LAYER_CAP}) — remove one first`; $('#meta').textContent = msg; return layerFailed(name, new Error(msg), over); }
  const first = S.layers.length === 0;
  S.layers.push({ id: lid, name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: (blob && typeof blob === 'object' && _fileHandles.get(blob)) || null, storage: 'loose', lineage: over.lineage || openLineage(name, blob) });
  S.activeId = lid;
  $('#meta').textContent = `${name} — reading…`;
  $('#empty').style.display = 'none';
  try {
    if (isWfrName(name)) { await openWfrFile(blob, name, { layer: lid, first, element: over.element, tint: over.tint, opacity: over.opacity, forceSoup: over.forceSoup, forceContext: over.forceContext }); }
    else if (/\.dxf$/i.test(name)) { await openDxfBlob(blob, name, { layer: lid, first, as: over.asKind === 'lines' ? 'strings' : (over.asKind === 'mesh' || over.asKind === 'points') ? over.asKind : null, tint: over.tint, opacity: over.opacity, stream: !!over.streamDxf }); }
    else if (isMesh && /\.(msh|obj|lfm|ply)$/i.test(name)) { await openMeshDoc(blob, name, { layer: lid, first, tint: over.tint, opacity: over.opacity, forceSoup: over.forceSoup, forceContext: over.forceContext }); }
    else if (/\.dm$/i.test(name)) { await openDmBlob(blob, name, { layer: lid, first, forcePoints, cached: over.cached, mapping: over.mapping }); }
    // grid stays extension-driven (no table→grid provider yet); asKind only picks points↔surface.
    else if ((over.asKind == null || over.asKind === 'surface' || over.asKind === 'points') && /\.(tif|tiff|grd)$/i.test(name)) { await openGridBlob(blob, name, { layer: lid, first, displayCache: over.displayCache, surface: over.asKind === 'surface', flatZ: over.flatZ != null ? over.flatZ : null, band: over.band || 0, smooth: over.smooth }); }
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
    else if (/\.laz$/i.test(name)) throw new Error('LAZ (compressed LAS) isn’t supported — export as .las, or use lasZip to convert');
    else if (!/\.(las)$/i.test(name)) throw new Error(`micro doesn’t read ${(name.match(/\.[^.]+$/) || ['this file'])[0]} — it reads .csv .txt .dat .tsv .xlsx .dm .parquet .las .ply .xyz .pts .msh .obj .lfm .dxf .wfr .omf .tif .grd .asc`);
    else {
      const { header, streamChunks, columnBatches, fetchRecord } = await openLas(blob);
      registerDocs(lid, 'points', { lasDoc: { blob, header, columnBatches, fetchRecord } });
      fitFromHeader(header, first);
      setColorLabels(header);
      const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
      const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
      $('#meta').textContent = `${name} — ${doc.count.toLocaleString()} points · LAS ${header.version} fmt ${header.format}${S.frame.origin.some((v) => v) ? ` · origin ${S.frame.origin.map((v) => v.toLocaleString()).join(', ')}` : ''}`;
      requestRender();
    }
    const L = layerById(lid);
    if (L && L.colorSel == null) L.colorSel = $('#colorBy').value;   // a fallback — a branch that chose (DXF strings → 'cat') keeps its choice
    renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name, kind: L ? L.kind : null } }));
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
}

// PLY path: discovery sweep (no header bbox) → the points pipeline. The
// provider owns fetchRecord (O(1) binary / sweep ascii) for the pick join.
async function openPlyBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading header…`;
  const { header, streamChunks, columnBatches, fetchRecord } = await openPly(blob);
  registerDocs(lid, 'points', { plyDoc: { blob, name, header, columnBatches, fetchRecord } });
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
    const dhDoc = { blobs: { ...files }, header, fetchRecord, recordPosition, holePaths, config: { ...opts } };
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

