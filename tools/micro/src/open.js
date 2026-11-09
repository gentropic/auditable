// micro — the layer OPENERS: one file in, one layer out. openBlob is the ONE dispatcher
// (by extension, then by content); behind it sit the readers for every source micro takes:
// LAS and PLY clouds, delimited / Datamine / Parquet block models, meshes (PLY, OBJ, MSH,
// LFM, DXF, .wfr, Datamine wireframe pairs), grids (GeoTIFF, Surfer, ESRI ASCII), drillhole
// sets and plain tables. The app keeps the document frame, the layer set and the tree, and
// hands them in as hooks.
import { startChunkBuilder } from './chunkworker.js';
import { S, activeLayer, layerById } from './state.js';
import { DIM_PALETTE_MAX, DXF_STREAM_BYTES, basisAngles, buildHeightfieldMesh, buildMeshChunk, createChunkBuilder, createSoupChunkBuilder, createStickChunkBuilder, detectRotatedLattice, dimKey, dmWireframeRole, findDimColumns, gridFromBasis, inferAxis, inferSubBlockLattice, isDimColumn, makeBlockGrid, mapColumns, openBlockModel, openDmModel, openDmWireframe, openDrillholes, openDxf, openDxfStream, openLas, openMsh, openMshSoup, openObj, openObjSoup, openPly, openPlyMesh, openPlySoup, openTable, parsePlyHeader, peekDmColumns, readMSHLayout, sniffDelimited, soupFromMesh } from '../../../ext/condenser/src/main.js';
import { openLineage } from './lineage.js';
import { isWfrName, openWfrBlob, summarizeElements, vertexColorOf, wfrPointsDoc, wfrResidentMesh, wfrSoupDoc, wfrStringsDoc } from './wfr-io.js';
import { applyCatLegend, rampCfgOf } from './props.js';
import { isBackupName } from './backup.js';
import { openPackFile } from './project.js';
import { openOmfBlob } from './omf.js';
import { gridDecimatedFromGTiff, gridFromGTiff, pickOverviewForCap, readGTiff, stepForCap } from '../../../ext/gtiff/index.js';
import { SURFER_BLANK, openGridSource } from './grid-io.js';
import { readLFM, writeLFM } from '../../../ext/lfm/lfm.js';
import { lfmTriCount, openLfmMesh, openLfmSoup, qualifyDhDoc } from './records.js';
import { peekCollarCols } from './manifest.js';
import { parquetInfoAsync, streamParquetColumns } from '../../../ext/parquet/index.js';
import { scan } from './scanner.js';
import { census as xlsxCensus, openSheet as xlsxOpenSheet } from '../../../ext/sheet/index.js';
import { basename } from './paths.js';
import { floatWin } from './windows.js';
import { applyBlockFilter } from './filter.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setOpenHooks): LAYER_CAP, _docBbox, _fileHandles, allocLayerId, cam, closeAllLayers, createLayerGroup, ensureDhSetGroups, fitFromHeader, frame, microConfirm, recomputeUnion, removeLayerUI, renderLayers, renderer, reopenDh, requestRender, setActiveLayer, setColorLabels, surfaceColorArray
let H = {};
export function setOpenHooks(h) { H = h; }

// the open's block chunk builder: OFF the page (src/chunkworker.js — the same
// builder, batches and seed, so the same chunks). Building ran on the page and
// was most of a big open's stalls (~0.5 s a 2M-block batch, Morton sort and
// packing). 128k/chunk, 16 chunks per Morton batch: tight bboxes are what give
// the frustum test teeth. Where workers can't run, the page builds, as before.
export async function baseBlockBuilder(lid, { frame, grid, dimPalette }) {
  // several builders, a Morton batch each (every batch its own seed, so the
  // chunks — and their order — are the same however many build them, or the page)
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const cb = await startChunkBuilder({ frame, grid, dimPalette, chunkSize: 1 << 17, batchSize: 1 << 21, seed: 1, seedPerBatch: true,
    workers: window.__baseBuilders || Math.max(1, Math.min(4, hc - 2)),
    onChunk: (c) => { if (layerById(lid)) { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } } });
  window.__baseOffPage = cb.offPage; window.__baseBuilders_n = cb.workers;   // smoke hooks: where (and on how many) the open built its chunks
  return cb;
}

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
  H.recomputeUnion();
  return doc;
}

export async function openBlobs(files, mode = 'replace', at = null) {
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

export async function detectDmWireframePairs(files) {
  const dm = files.filter((f) => /\.dm$/i.test(f.name));
  if (dm.length < 2) return { pairs: [], singles: files };
  const role = new Map();
  for (const f of dm) { try { role.set(f, dmWireframeRole(await peekDmColumns(f))); } catch { role.set(f, null); } }
  const pts = dm.filter((f) => role.get(f) === 'points'), trs = dm.filter((f) => role.get(f) === 'triangles');
  const pairs = [], used = new Set();
  const baseOf = (n) => n.replace(/\.dm$/i, '').replace(/(pt|tr)$/i, '');
  for (const pt of pts) {
    const b = baseOf(pt.name);
    const tr = trs.find((t) => !used.has(t) && baseOf(t.name) === b) || trs.find((t) => !used.has(t));
    if (tr) { pairs.push([pt, tr]); used.add(pt); used.add(tr); }
  }
  return { pairs, singles: files.filter((f) => !used.has(f)) };
}

// Open a Datamine wireframe pair as a single mesh layer (routes the joined mesh
// through openMeshDoc's static path via opts.prebuilt).
export async function openDmWireframeBlob(ptFile, trFile, mode = 'replace', at = null) {
  if (mode !== 'add') H.closeAllLayers();
  const lid = H.allocLayerId();
  if (lid == null) { $('#meta').textContent = `layer limit reached (${H.LAYER_CAP}) — remove one first`; return; }
  const first = S.layers.length === 0;
  const base = trFile.name.replace(/\.dm$/i, '').replace(/tr$/i, '');
  const name = `${base || 'wireframe'} (Datamine wireframe)`;
  S.layers.push({ id: lid, name, kind: 'mesh', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'loose', lineage: openLineage(name, trFile) });
  S.activeId = lid;
  $('#empty').style.display = 'none';
  $('#meta').textContent = `${name} — joining points + triangles…`;
  try {
    const mesh = await openDmWireframe(ptFile, trFile);
    await openMeshDoc(trFile, name, { layer: lid, first, prebuilt: mesh, ptBlob: ptFile });
    const drop = mesh.header.dropped ? ` · ${mesh.header.dropped} triangles dropped (unresolved)` : '';
    $('#meta').textContent = `${name} — ${mesh.header.triCount.toLocaleString()} triangles · ${mesh.header.vertexCount.toLocaleString()} vertices${drop}`;
    const L = layerById(lid); if (L) L.colorSel = $('#colorBy').value;
    H.renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
  } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; const L = layerById(lid); if (L) H.removeLayerUI(lid); }
}

// DXF: the drafting format mine software round-trips everything through.
// condenser's openDxf picks the dominant content (3DFACE/polyface surfaces →
// mesh, 3D polylines → design strings as capsules, POINTs → pegs) and `as`
// overrides it (the dialog's Open-as / Reinterpret-as 'lines'). Strings become
// a sticks layer whose CATEGORY is the DXF layer — class eyes hide a bench.
export async function openDxfBlob(blob, name, opts) {
  // big files stream; `stream` forces it for a small one (the smoke guards the streamed path with a fixture)
  if (opts.stream || blob.size > DXF_STREAM_BYTES) return openDxfStreamed(blob, name, opts);
  const lid = opts.layer, first = opts.first;
  const r = await openDxf(blob, { as: opts.as || null });
  const dxfHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  if (r.header.kind === 'mesh') {
    const L0 = layerById(lid); if (L0) L0.kind = 'mesh';
    const tint = opts.tint !== undefined ? opts.tint : (r.header.meshColor ? dxfHex(r.header.meshColor) : undefined);
    await openMeshDoc(blob, name, { layer: lid, first, prebuilt: r, tint, opacity: opts.opacity });
    const c = r.header.dxfCounts;
    $('#meta').textContent = `${name} — ${r.header.triCount.toLocaleString()} triangles · ${r.header.vertexCount.toLocaleString()} vertices${c.strings ? ` · +${c.strings} design strings (Reinterpret as…)` : ''}`;
    const L = layerById(lid); if (L) L.colorSel = $('#colorBy').value;
    return;
  }
  if (r.header.kind === 'strings') {
    const header = await openStringsLayer(blob, name, lid, first, r);
    $('#meta').textContent = `${name} — ${(header.strings || 0).toLocaleString()} design strings · ${header.count.toLocaleString()} segments · ${(header.categories || []).length} DXF layers`;
    return;
  }
  const header = await openPegsLayer(blob, name, lid, first, r);
  $('#meta').textContent = `${name} — ${header.count.toLocaleString()} points (DXF pegs)`;
}

// A .wfr (wireframe container) — one layer per element, siblings in a group when there are
// several, each layer keeping L.name = the file (the project source) and its element's name in
// the doc header. Triangles take the context tier up to CONTEXT_TRI_CAP (re-welded by vid, vertex
// attributes become the vertices location's columns, colours reach the GPU) and stream brick by
// brick above it; lines become a strings layer; points a points layer. `element` (Reinterpret,
// a project reload) opens just that one.
export async function openWfrFile(blob, name, opts) {
  const wfr = await openWfrBlob(blob);
  let els = wfr.elements;
  if (opts.element != null) els = els.filter((e) => e.name === opts.element);
  if (!els.length) throw new Error(opts.element != null ? `wfr: no element "${opts.element}" in ${name}` : `wfr: ${name} holds no elements`);
  const primary = layerById(opts.layer), ids = [], skipped = [];
  const multi = els.length > 1;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    let lid = opts.layer;
    if (i > 0) {
      lid = H.allocLayerId();
      if (lid == null) { skipped.push(el.name); continue; }
      S.layers.push({ id: lid, name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: primary ? primary.handle : null, storage: 'loose', lineage: openLineage(name, blob) });
    }
    const L = layerById(lid);
    if (L && multi) L.label = `${name} · ${el.name}`;
    const first = opts.first && i === 0;
    const tag = `${name}${multi ? ` · ${el.name}` : ''}`;
    if (el.kind === 'triangles') {
      if (!opts.forceSoup && (opts.forceContext || el.meta.counts.cells <= CONTEXT_TRI_CAP)) {
        const m = await wfrResidentMesh(el, { onProgress: (k, n) => { $('#meta').textContent = `${tag} — reading bricks ${k}/${n}…`; } });
        await openMeshDoc(blob, name, { layer: lid, first, prebuilt: m, tint: opts.tint, opacity: opts.opacity });
      } else await openMeshDoc(blob, name, { layer: lid, first, soupDoc: wfrSoupDoc(el), tint: opts.tint, opacity: opts.opacity });
    } else if (el.kind === 'lines') {
      const h = await openStringsLayer(blob, name, lid, first, wfrStringsDoc(el), { authoredOnly: true });
      $('#meta').textContent = `${tag} — ${h.count.toLocaleString()} segments${h.strings ? ` · ${h.strings.toLocaleString()} strings` : ''}${h.categories ? ` · ${h.categories.length} layers` : ''}`;
    } else {
      const h = await openPegsLayer(blob, name, lid, first, wfrPointsDoc(el), { authoredOnly: true });
      $('#meta').textContent = `${tag} — ${h.count.toLocaleString()} points`;
    }
    ids.push(lid);
  }
  if (ids.length > 1) H.createLayerGroup(name, ids, { collapsed: false });
  if (multi) $('#meta').textContent = `${name} — ${ids.length} elements (${summarizeElements(wfr).filter((s) => !skipped.includes(s.name)).map((s) => `${s.name}: ${s.kind}`).join(' · ')})${skipped.length ? ` · ${skipped.length} skipped (layer limit)` : ''}`;
  return ids;
}

// A strings (sticks) layer from any provider of the condenser strings contract — resident DXF,
// a .wfr lines element: { header, streamChunks → stick RawChunks, fetchRecord, recordPosition }.
// The header may only learn its categories while streaming (a .wfr reads its layer attribute
// brick by brick), so the category legend is applied after the stream.
export async function openStringsLayer(blob, name, lid, first, r, catOpts) {
  const { header, streamChunks, fetchRecord, recordPosition } = r;
  registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord, recordPosition } });
  H.fitFromHeader(header, first);
  const catsUpfront = header.mapping && header.mapping.cat != null;
  H.renderer.setCategories(catsUpfront ? 1 : 0);
  H.renderer.setLayerCats(lid, catsUpfront ? 256 : 0);
  H.renderer.setLayerStickRadius(lid, 0.8);
  H.setColorLabels(header);
  const cb = createStickChunkBuilder({ frame: H.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
  for await (const rc of streamChunks({ chunkPoints: 1 << 16 })) { cb.push(rc); await new Promise((r2) => setTimeout(r2)); }
  const doc = cb.flush();
  finishCatLayer(lid, header, doc, catOpts);
  return header;
}

// A points layer from the DXF-pegs contract (resident DXF pegs, a .wfr points element).
export async function openPegsLayer(blob, name, lid, first, r, catOpts) {
  const { header, streamChunks, fetchRecord } = r;
  registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord } });
  H.fitFromHeader(header, first);
  const catsUpfront = header.mapping && header.mapping.cat != null;
  H.renderer.setCategories(catsUpfront ? 1 : 0);
  H.renderer.setLayerCats(lid, catsUpfront ? 256 : 0);
  H.setColorLabels(header);
  const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
  for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
    cb.push({ count: rc.count, x: rc.x, y: rc.y, z: rc.z, intensity: new Uint16Array(rc.count), classification: rc.cat || new Uint8Array(rc.count), rgb: null, recStart: rc.recStart || 0 });
    await new Promise((r2) => setTimeout(r2));
  }
  const doc = cb.flush();
  finishCatLayer(lid, header, doc, catOpts);
  return header;
}

// bbox, colour mode and the authored category legend once a categorized layer has streamed
export function finishCatLayer(lid, header, doc, { authoredOnly = false } = {}) {
  const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const authored = (c) => (c && !(c[0] === 255 && c[1] === 255 && c[2] === 255) ? c : null);   // white is "foreground", not a colour
  H.renderer.setLayerCats(lid, header.categories ? 256 : 0);
  if (header.categories) H.renderer.setCategories(1);
  const L = layerById(lid);
  if (L) { L.bboxLocal = doc.bboxLocal; L.colorSel = header.categories ? 'cat' : 'solid'; }
  const colors = header.catColors ? (authoredOnly ? header.catColors.map(authored) : header.catColors) : null;
  if (L && header.categories && colors && colors.some(Boolean)) {
    L.catLegend = {
      col: header.columns[header.mapping.cat],
      entries: header.categories.map((nm, i) => (colors[i] ? { values: [nm], color: hex(colors[i]) } : null)).filter(Boolean),
      otherColor: '#555a5f',
    };
    applyCatLegend(L, true);
  }
  H.recomputeUnion();
}

// A DXF too big to read whole (a 3DFACE topography reaches gigabytes; one JS
// string can't hold it) streams: ONE pass through condenser's openDxfStream
// feeds every kind the file holds into its own layer — the surface as a
// streamed soup mesh, design strings as capsules, pegs as points — siblings in
// a group, each keeping L.name = the file (that is the project source). `as`
// (Open as / Reinterpret / a project reload) keeps just one kind. Like any
// streamed mesh, the surface is display/section/pick only: solid queries and
// mesh export need the resident tier.
export async function openDxfStreamed(blob, name, opts) {
  const first = opts.first, as = opts.as || null;
  const dxfHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const authored = (c) => (c && !(c[0] === 255 && c[1] === 255 && c[2] === 255) ? c : null);   // ACI 7 is "foreground", not a colour
  const gb = (blob.size / 2 ** 30).toFixed(1);
  $('#meta').textContent = `${name} — ${gb} GB · sampling extents…`;
  const sd = await openDxfStream(blob, { as });
  H.fitFromHeader(sd.header, first);
  const sum = sd.summary;
  const primary = layerById(opts.layer);
  const lids = {}, builders = {}, headers = {}, extra = [];
  const LABEL = { mesh: 'surface', strings: 'strings', points: 'points' };
  const setup = (kind, lid) => {
    const L = layerById(lid);
    const bbox = sd.header.bbox;
    const onChunk = (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); };
    if (kind === 'mesh') {
      const header = headers.mesh = { kind: 'mesh', soup: true, streamed: true, format: 'dxf', vertexCount: 0, triCount: 0, bbox };
      L.kind = 'mesh';
      L.docs = { meshDoc: { blob, name, header } };
      L.tint = opts.tint || '#9ea3a8';
      L.opacity = opts.opacity != null ? opts.opacity : 1;
      H.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity });
      builders.mesh = createSoupChunkBuilder({ frame: H.frame, chunkSize: 1 << 17, batchSize: 1 << 19, seed: 1, onChunk });
    } else if (kind === 'strings') {
      const header = headers.strings = { kind: 'strings', format: 'dxf', count: 0, strings: 0, columns: ['LAYER', 'STRING'], mapping: { chan: null, cat: 0 }, categories: null, numericColumns: [], chanRange: [0, 0], bbox };
      registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord: sum.strings.fetchRecord, recordPosition: sum.strings.recordPosition } });
      H.renderer.setCategories(1);
      H.renderer.setLayerCats(lid, 256);
      H.renderer.setLayerStickRadius(lid, 0.8);
      builders.strings = createStickChunkBuilder({ frame: H.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk });
    } else {
      const header = headers.points = { kind: 'blockmodel', format: 'dxf', count: 0, grid: null, columns: ['X', 'Y', 'Z', 'LAYER'], mapping: { x: 0, y: 1, z: 2, chan: null, cat: 3 }, categories: null, numericColumns: [], bbox };
      registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord: sum.points.fetchRecord } });
      H.renderer.setCategories(1);
      H.renderer.setLayerCats(lid, 256);
      builders.points = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk });
    }
  };
  // the first kind to arrive takes the layer openBlob allocated; later kinds get siblings
  const lidFor = (kind) => {
    if (kind in lids) return lids[kind];
    let lid;
    if (!Object.keys(lids).length) lid = opts.layer;
    else {
      lid = H.allocLayerId();
      if (lid == null) { lids[kind] = null; return null; }  // layer limit: that kind is skipped (reported below)
      S.layers.push({ id: lid, name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: primary ? primary.handle : null, storage: 'loose', lineage: openLineage(name, blob) });
      extra.push(lid);
    }
    lids[kind] = lid;
    const L = layerById(lid);
    if (L) L.label = `${name} · ${LABEL[kind]}`;
    setup(kind, lid);
    return lid;
  };
  try {
    let lastMeta = 0;
    const progress = (at, total) => {
      const now = performance.now(); if (now - lastMeta < 150) return; lastMeta = now;
      const c = sum.counts;
      const parts = [c.triangles && `${c.triangles.toLocaleString()} triangles`, c.strings && `${c.strings.toLocaleString()} strings`, c.points && `${c.points.toLocaleString()} points`].filter(Boolean);
      $('#meta').textContent = `${name} — streaming ${Math.round(100 * at / total)}% of ${gb} GB${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    };
    for await (const b of sd.batches({ onProgress: progress })) {
      const lid = lidFor(b.kind);
      if (lid == null) continue;
      if (b.kind === 'points') {
        const r = b.raw;
        builders.points.push({ count: r.count, x: r.x, y: r.y, z: r.z, intensity: new Uint16Array(r.count), classification: r.cat, rgb: null, recStart: r.recStart });
      } else builders[b.kind].push(b.raw);
      await new Promise((r2) => setTimeout(r2));            // yield to the render loop
    }
    if (!Object.keys(lids).length) throw new Error(as ? `dxf: no ${as === 'strings' ? 'design strings' : as} in this file` : 'dxf: no 3D scene geometry (no faces, polylines or points)');
    // finish each layer: true bboxes, counts, classes + authored colours
    for (const [kind, lid] of Object.entries(lids)) {
      if (lid == null) continue;
      const L = layerById(lid);
      const doc = builders[kind].flush();
      if (L) L.bboxLocal = doc.bboxLocal;
      if (kind === 'mesh') {
        const h = headers.mesh;
        h.triCount = sum.counts.triangles; h.vertexCount = 3 * sum.counts.triangles;
        const tint = opts.tint === undefined && authored(sum.meshColor);
        if (L && tint) { L.tint = dxfHex(tint); H.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity }); }
        if (L) { L.colorSel = $('#colorBy').value; L.docs.meshDoc.metaLine = `${name} — ${h.triCount.toLocaleString()} triangles · DXF · streamed`; }
      } else {
        const h = headers[kind], s = sum[kind];
        h.count = kind === 'strings' ? sum.counts.segments : sum.counts.points;
        if (kind === 'strings') h.strings = sum.counts.strings;
        h.categories = s.categories;
        h.catColors = s.catColors ? s.catColors.map(authored) : null;
        H.renderer.setLayerCats(lid, h.categories ? 256 : 0);
        if (L) {
          L.colorSel = h.categories ? 'cat' : 'solid';
          if (h.categories && h.catColors && h.catColors.some(Boolean)) {
            L.catLegend = { col: 'LAYER', entries: h.categories.map((nm, i) => (h.catColors[i] ? { values: [nm], color: dxfHex(h.catColors[i]) } : null)).filter(Boolean), otherColor: '#555a5f' };
            applyCatLegend(L, true);
          }
        }
      }
    }
    H.recomputeUnion();
    if (first && H._docBbox) H.cam.fit(H._docBbox);               // the sampled bbox aimed the first view; now the true one
    const prim = layerById(opts.layer);
    if (prim) H.setColorLabels(prim.kind === 'mesh' ? null : headers[Object.keys(lids).find((k) => lids[k] === opts.layer)]);
    const placed = Object.entries(lids).filter(([, v]) => v != null).map(([k]) => k);
    const ids = placed.map((k) => lids[k]);
    if (ids.length > 1) H.createLayerGroup(name, ids, { collapsed: false });
    const c = sum.counts, skipped = Object.entries(lids).filter(([, v]) => v == null).map(([k]) => k);
    const warn = sum.warnings.length + sum.warningsSuppressed;
    $('#meta').textContent = `${name} — streamed ${gb} GB · ` + [
      c.triangles && `${c.triangles.toLocaleString()} triangles`, c.strings && `${c.strings.toLocaleString()} strings`, c.points && `${c.points.toLocaleString()} points`,
    ].filter(Boolean).join(' · ') + (warn ? ` · ${warn.toLocaleString()} unsupported/skipped entities` : '') + (skipped.length ? ` · ${skipped.join('+')} not shown (layer limit)` : '');
    H.requestRender();
  } catch (e) {
    for (const lid of extra) { H.renderer.removeLayer(lid); S.layers = S.layers.filter((l) => l.id !== lid); }
    throw e;
  }
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
  if (mode !== 'add') H.closeAllLayers();
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
  const lid = H.allocLayerId();
  if (lid == null) { const msg = `layer limit reached (${H.LAYER_CAP}) — remove one first`; $('#meta').textContent = msg; return layerFailed(name, new Error(msg), over); }
  const first = S.layers.length === 0;
  S.layers.push({ id: lid, name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: (blob && typeof blob === 'object' && H._fileHandles.get(blob)) || null, storage: 'loose', lineage: over.lineage || openLineage(name, blob) });
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
      const { header, streamChunks } = await openLas(blob);
      registerDocs(lid, 'points', { lasDoc: { blob, header } });
      H.fitFromHeader(header, first);
      H.setColorLabels(null);
      const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
      const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
      $('#meta').textContent = `${name} — ${doc.count.toLocaleString()} points · LAS ${header.version} fmt ${header.format}${H.frame.origin.some((v) => v) ? ` · origin ${H.frame.origin.map((v) => v.toLocaleString()).join(', ')}` : ''}`;
      H.requestRender();
    }
    const L = layerById(lid);
    if (L && L.colorSel == null) L.colorSel = $('#colorBy').value;   // a fallback — a branch that chose (DXF strings → 'cat') keeps its choice
    H.renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name, kind: L ? L.kind : null } }));
    return lid;
  } catch (e) {
    $('#meta').textContent = `${name} — ${e.message}`;
    H.renderer.removeLayer(lid);
    S.layers = S.layers.filter((l) => l.id !== lid);
    if (S.layers.length) H.setActiveLayer(S.layers[0].id);
    else $('#empty').style.display = '';
    H.renderLayers();
    return layerFailed(name, e, over);
  }
}

// The caller's half of a load. A failed load has always been shown in #meta and
// cleaned up; a host driving micro also needs to KNOW. openBlob resolves to the
// new layer id (null on failure) and fires micro:layer-added / micro:layer-failed;
// with over.throw it rejects with the error instead of resolving null.
export function layerFailed(name, err, over = {}) {
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

// ── grids (§7.1): GeoTIFF / Surfer .grd / ESRI ASCII → ONE gridDoc shape ──
// { nx, ny, data, x0, y0, dx, dy, nodata, crs, form } — row 0 is the NORTH
// row, x0/y0 are SAMPLE CENTERS, dy positive (row r's centre = y0 − r·dy).
export const ascLooksLikeGrid = async (blob) => /^\s*ncols\b/i.test(await blob.slice(0, 64).text());

export async function readAnyGrid(blob, name, displayCache = null, band = 0) {
  {
    // ONE path for every grid format: a GeoTIFF parses its IFDs; .asc/.grd become
    // the same readGTiff-shaped SOURCE (grid-io.js openGridSource — text grids are
    // indexed in one streamed pass). Display decimates under a cap, eval windows the
    // full-res source — so a multi-GB ASCII DEM opens like a big COG does.
    const isTiff = /\.(tif|tiff)$/i.test(name);
    const DISPLAY_DECODE_CAP = window.__gridDisplayCap || 8_000_000;   // test seam
    const g = isTiff ? await readGTiff(blob) : await openGridSource(blob, name, {
      displayCap: DISPLAY_DECODE_CAP,
      onProgress: (a, t) => { $('#meta').textContent = `${name} — indexing ${Math.round(100 * a / t)}%…`; },
    });
    if (displayCache && isTiff) {
      // a project display-cache sidecar: reuse the parsed IFDs for windowed
      // eval, but take the DISPLAY straight from the cache (no re-decimation)
      const grid = displayCache;
      grid.crs = grid.crs || g.geo.crs;
      grid.form = `GeoTIFF ${g.images[0].width}×${g.images[0].height} · display cache`;
      grid.band = band; grid.bands = g.images[0].samplesPerPixel;
      grid._src = { g, level: 0, name, step: 2, band };    // step>1 → not fullRes → eval windows; band rides along
      return grid;
    }
    // decode an OVERVIEW within a decode budget for the display — a big COG
    // paints instantly; the full-res data is read windowed, only for eval
    const level = pickOverviewForCap(g, DISPLAY_DECODE_CAP);
    // even the coarsest overview may exceed the budget (or there are NO
    // overviews) — decimate that level to fit, one segment resident at a time.
    // Bounded memory for ANY-size TIFF; eval still reads full res windowed.
    const step = stepForCap(g, level, DISPLAY_DECODE_CAP);
    const grid = step > 1 ? await gridDecimatedFromGTiff(g, level, step, band) : await gridFromGTiff(g, level, band);
    if (grid.x0 == null) { grid.x0 = grid.dx / 2; grid.y0 = grid.ny * grid.dy - grid.dy / 2; }
    const img = g.images[0], lvl = g.images[level];
    grid.form = (isTiff
      ? `GeoTIFF ${img.bitsPerSample}-bit${img.sampleFormat === 3 ? ' float' : img.sampleFormat === 2 ? ' int' : ''}` +
        `${{ 1: '', 5: ', LZW', 8: ', deflate', 32946: ', deflate', 32773: ', PackBits' }[img.compression] ?? ''}${img.tiled ? ', tiled' : ''}`
      : g.form) +
      `${level > 0 ? ` · overview ${lvl.width}×${lvl.height} of ${img.width}×${img.height}` : ''}` +
      `${step > 1 ? ` · display ÷${step} (${grid.nx}×${grid.ny})` : ''}`;
    grid.bands = img.samplesPerPixel; grid.band = band; grid._src = { g, level, name, step, band };                  // windowable full-res source (eval + export)
    return grid;
  }
}

// grid → the POINTS pipeline (spec §7.1 v1: heightfield cells as records,
// zero new GL). The FULL grid stays on the layer (L.docs.gridDoc) for the
// surface-flag/ratio evaluation; display decimates by stride to a cap.
export const GRID_DISPLAY_CAP = 4_000_000;

export async function openGridBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading grid…`;
  const grid = await readAnyGrid(blob, name, opts.displayCache || null, opts.band || 0);
  const { nx, ny, data, nodata } = grid;
  const stride = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / GRID_DISPLAY_CAP)));
  // one sweep: z range + displayed-node census (nodata and NaN sit out)
  const isBad = (v2) => Number.isNaN(v2) || (nodata != null && (nodata === SURFER_BLANK ? v2 >= 1.7014e38 : v2 === nodata));
  let zmin = Infinity, zmax = -Infinity, shown = 0;
  for (let r = 0; r < ny; r += stride) for (let c = 0; c < nx; c += stride) {
    const v2 = data[r * nx + c];
    if (isBad(v2)) continue;
    if (v2 < zmin) zmin = v2;
    if (v2 > zmax) zmax = v2;
    shown++;
  }
  if (!shown) throw new Error('grid is all nodata');
  const header = {
    count: shown,
    bbox: {
      min: [grid.x0, grid.y0 - (ny - 1) * grid.dy, zmin],
      max: [grid.x0 + (nx - 1) * grid.dx, grid.y0, zmax],
    },
  };
  const gridDoc = { blob, name, grid, stride, source: grid._src || null, level: grid._src ? grid._src.level : 0, fullRes: !grid._src || (grid._src.level === 0 && grid._src.step === 1) };
  // "Show as surface": a grid IS a heightfield — triangulate it into a shaded
  // relief mesh coloured by elevation (§17 heightfield-drape Phase 1), instead of
  // the raw elevation point cloud. gridDoc stays for by-surface eval; per-cell
  // pick is traded for the solid surface (toggle back to points to pick).
  if (opts.surface) {
    const flatZ = opts.flatZ != null ? opts.flatZ : null;
    const hf = buildHeightfieldMesh(grid, { stride, frame: H.frame, flatZ });
    if (!hf) throw new Error('grid is all nodata');
    const color = H.surfaceColorArray(hf, opts.drape || null, (rampCfgOf(layerById(lid)) || {}).preset, zmin, zmax);
    registerDocs(lid, 'mesh', { gridDoc });
    H.fitFromHeader({ ...header, bbox: { min: hf.bboxLocal.slice(0, 3).map((v, i) => v + (H.frame ? H.frame.origin[i] : 0)), max: hf.bboxLocal.slice(3, 6).map((v, i) => v + (H.frame ? H.frame.origin[i] : 0)) } }, opts.first !== false);
    const smooth = opts.smooth !== false;
    H.renderer.setLayerMeshStyle(lid, { tint: [0.6, 0.63, 0.66], opacity: 1 });
    H.renderer.addChunk({ kind: 'mesh', pos: hf.pos, idx: hf.idx, color, normal: smooth ? hf.normal : null, count: hf.count, bboxLocal: hf.bboxLocal }, 'base', lid);
    const Lg = layerById(lid);
    if (Lg) { Lg.bboxLocal = hf.bboxLocal; Lg.tint = '#9aa0a6'; Lg.gridSurface = true; Lg.surfaceFlatZ = flatZ; Lg.surfaceSmooth = smooth; }
    H.recomputeUnion(); H.requestRender();
    $('#meta').textContent = `${name} — surface · ${hf.vertexCount.toLocaleString()} nodes${stride > 1 ? ` (every ${stride}ᵗʰ)` : ''}${grid.crs ? ` · ${grid.crs}` : ''}`;
    return;
  }
  registerDocs(lid, 'points', { gridDoc });
  H.fitFromHeader(header, opts.first !== false);
  H.setColorLabels(null);
  const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
  // records are SEQUENTIAL displayed indices (the 29-bit partition can't hold
  // raw node indices of a huge DEM); dispIdx joins a record back to its node
  const dispIdx = new Uint32Array(shown);
  const B = 1 << 18;
  let bx = new Float64Array(B), by = new Float64Array(B), bz = new Float64Array(B), bi = new Uint16Array(B), bcl = new Uint8Array(B), br = new Uint32Array(B);
  let fill = 0, rec = 0, pushed = 0;
  const flush = () => {
    if (!fill) return;
    cb.push({ count: fill, x: bx.subarray(0, fill), y: by.subarray(0, fill), z: bz.subarray(0, fill), intensity: bi.subarray(0, fill), classification: bcl.subarray(0, fill), recIdx: br.subarray(0, fill) });
    pushed += fill; fill = 0;
    bx = new Float64Array(B); by = new Float64Array(B); bz = new Float64Array(B); bi = new Uint16Array(B); bcl = new Uint8Array(B); br = new Uint32Array(B);
  };
  for (let r = 0; r < ny; r += stride) {
    for (let c = 0; c < nx; c += stride) {
      const v2 = data[r * nx + c];
      if (isBad(v2)) continue;
      bx[fill] = grid.x0 + c * grid.dx;
      by[fill] = grid.y0 - r * grid.dy;
      bz[fill] = v2;
      br[fill] = rec;
      dispIdx[rec++] = r * nx + c;
      if (++fill === B) flush();
    }
    if ((r / stride | 0) % 64 === 0) {
      $('#meta').textContent = `${name} — building ${Math.round(100 * r / ny)}%`;
      await new Promise((res) => setTimeout(res));
    }
  }
  flush();
  const doc = cb.flush();
  gridDoc.dispIdx = dispIdx;
  const L = layerById(lid);
  if (L) L.bboxLocal = doc.bboxLocal;
  H.recomputeUnion();
  $('#meta').textContent = `${name} — ${nx.toLocaleString()}×${ny.toLocaleString()} ${grid.form}${grid.crs ? ` · ${grid.crs}` : ''}` +
    `${stride > 1 ? ` · showing every ${stride}ᵗʰ node (${shown.toLocaleString()})` : ` · ${shown.toLocaleString()} nodes`}`;
  H.requestRender();
}

// PLY path: discovery sweep (no header bbox) → the points pipeline. The
// provider owns fetchRecord (O(1) binary / sweep ascii) for the pick join.
export async function openPlyBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading header…`;
  const { header, streamChunks, fetchRecord } = await openPly(blob);
  registerDocs(lid, 'points', { plyDoc: { blob, name, header, fetchRecord } });
  H.fitFromHeader(header, opts.first !== false);
  H.setColorLabels(null);
  const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
  const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
  $('#meta').textContent = `${name} — ${doc.count.toLocaleString()} points · PLY ${header.format === 'ascii' ? 'ascii' : 'binary'}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
  H.requestRender();
}

// Context meshes (micro-layers spec §7 tier 1): wireframes / solids / TINs —
// whole-file read, one static chunk, scenery (no records: not pickable, not
// filterable). Picks pass THROUGH a mesh to the elements behind it.
// above this → the streaming soup tier. ?ctxcap=N lowers it so a smoke can exercise the
// over-the-cap paths (promote-to-context) on a mesh small enough to build in a test.
export const CONTEXT_TRI_CAP = (() => { try { const n = +new URLSearchParams(location.search).get('ctxcap'); if (n > 0) return n; } catch {} return 2_000_000; })();

export const MESH_STREAM_BYTES = 160 * 1024 * 1024;

export async function plyFaceCount(blob) {
  try {
    let sampleLen = 64 * 1024, h = null;
    for (;;) {
      h = parsePlyHeader(new TextDecoder('latin1').decode(await blob.slice(0, Math.min(sampleLen, blob.size)).arrayBuffer()));
      if (h) break;
      if (sampleLen >= blob.size) return 0;
      sampleLen *= 4;
    }
    const face = h.elements.find((e) => e.name === 'face');
    return face ? face.count : 0;
  } catch { return 0; }
}

export const plyHasFaces = async (blob) => (await plyFaceCount(blob)) > 0;

export function hexToRgb01(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

// split a multi-object OBJ into per-group mesh layers, landed in a collapsed
// layer GROUP (§7.2). Vertex indices are global in OBJ, so each part = the
// shared non-face lines + that group's faces — every layer keeps a REAL blob
// (projects copy it; winding re-parses it) at the cost of duplicated v-lines.
export async function openObjSplit(blob, name, mode) {
  const text = await blob.text();
  const shared = [];
  const parts = new Map();                                 // group → face lines
  let cur = null;
  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim();
    if (/^[go]\s/.test(t)) { cur = t.replace(/^[go]\s+/, '').trim() || 'group'; continue; }
    if (/^f[\s]/.test(t)) {
      const g = cur === null ? 'default' : cur;
      let arr = parts.get(g); if (!arr) parts.set(g, arr = []);
      arr.push(ln);
    } else if (t && !/^usemtl|^mtllib|^s\s/.test(t)) shared.push(ln);
  }
  const base = name.replace(/\.obj$/i, '');
  const head = shared.join('\n') + '\n';
  const ids = [];
  let first = mode !== 'add';
  let skipped = 0;
  for (const [gname, faces] of parts) {
    const gblob = new Blob([head + faces.join('\n') + '\n']);
    const before = S.layers.length;
    const _got = await openBlob(gblob, `${base} · ${gname}.obj`, first ? 'replace' : 'add');
    first = false;
    if (S.layers.length > before || (before && mode !== 'add' && S.layers.length === 1)) {
      const L = layerById(_got);
      if (L && !ids.includes(L.id)) ids.push(L.id); else skipped++;
    } else skipped++;
  }
  if (ids.length > 1) H.createLayerGroup(name, ids, { collapsed: false });
  $('#meta').textContent = `${name} — split into ${ids.length} solids${skipped ? ` (${skipped} skipped — mesh layer limit)` : ''}`;
  return ids;
}

// (openLfmMesh — .lfm → the condenser mesh contract — lives in src/records.js;
// the split path below writes ONE-MESH .lfm children via writeLFM, so every
// layer stays a real Leapfrog file)
export const lfmTint = (c) => (c ? '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('') : null);

// split a multi-mesh .lfm into per-solid layers inside a layer group; each
// child is a valid ONE-MESH .lfm carrying its name + colour (→ the tint)
export async function openLfmSplit(blob, name, mode) {
  const r = await readLFM(blob);                           // lazy (XML head + blocks sliced) — never one whole buffer
  const base = name.replace(/\.lfm$/i, '');
  const ids = [];
  let first = mode !== 'add';
  let skipped = 0;
  for (const m of r.meshes) {
    $('#meta').textContent = `${name} — writing ${m.name}…`;
    const buf = await writeLFM({ collectionName: m.name, meshes: [m] });
    const before = S.layers.length;
    const _got = await openBlob(new Blob([buf]), `${base} · ${m.name}.lfm`, first ? 'replace' : 'add', null, { tint: lfmTint(m.colour) || undefined });
    first = false;
    if (S.layers.length > before || (before && mode !== 'add' && S.layers.length === 1)) {
      const L = layerById(_got);
      if (L && !ids.includes(L.id)) ids.push(L.id); else skipped++;
    } else skipped++;
  }
  if (ids.length > 1) H.createLayerGroup(name, ids, { collapsed: false });
  $('#meta').textContent = `${name} — split into ${ids.length} solids${skipped ? ` (${skipped} skipped — mesh layer limit)` : ''}`;
  return ids;
}

export async function openMeshDoc(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading mesh…`;
  const L = layerById(lid);
  // over the cap → the streamed soup tier, unless forceContext: the user asked for the
  // exact tier knowing its cost (structural analysis and solid queries need CPU geometry)
  const overCap = (n) => !opts.forceContext && n > CONTEXT_TRI_CAP;
  const setupLayer = (header) => {
    if (!L) return;
    L.kind = 'mesh';
    L.docs = { meshDoc: { blob, name, header, ptBlob: opts.ptBlob || null } };
    L.tint = opts.tint || '#9ea3a8';
    L.opacity = opts.opacity != null ? opts.opacity : 1;
    H.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity });
  };
  // two tiers, chosen by triangle count (§7): ≤ cap → static indexed context
  // mesh; above → the streaming soup (Morton chunks, u16, budgeted prefixes).
  // A big PLY announces its face count in the header — it streams WITHOUT the
  // file ever being held whole; .msh/.obj formats are whole-file reads anyway,
  // so their vertices are transient and only the soup stays resident.
  let header = null, soupSrc = null;
  // a TRUE streaming provider per format, chosen before anything is read whole:
  // PLY and .msh announce their triangle count in a header, .lfm in its XML
  // descriptor; OBJ announces nothing, so its size decides (≈ 60–90 B of text
  // per triangle → MESH_STREAM_BYTES ≈ the context cap)
  const pct = (a, b2) => { $('#meta').textContent = `${name} — reading vertices… ${Math.round(100 * a / b2)}%`; };
  const streamDoc = opts.soupDoc ? () => opts.soupDoc        // a ready streaming provider (a big .wfr element)
    : opts.prebuilt ? null
    : /\.ply$/i.test(name) ? ((opts.forceSoup || overCap(await plyFaceCount(blob))) ? () => openPlySoup(blob, { onProgress: pct }) : null)
    : /\.msh$/i.test(name) ? ((opts.forceSoup || overCap(((await readMSHLayout(blob)).triangles || { count: 0 }).count)) ? () => openMshSoup(blob, { onProgress: pct }) : null)
    : /\.obj$/i.test(name) ? ((opts.forceSoup || (!opts.forceContext && blob.size > MESH_STREAM_BYTES)) ? () => openObjSoup(blob, { onProgress: pct }) : null)
    : /\.lfm$/i.test(name) ? ((opts.forceSoup || overCap(await lfmTriCount(blob))) ? () => openLfmSoup(blob, { onProgress: (msg) => { $('#meta').textContent = `${name} — ${msg}`; } }) : null)
    : null;
  if (streamDoc) {
    const doc = await streamDoc();
    header = doc.header;
    soupSrc = (o) => doc.streamChunks(o);
  } else {
    // prebuilt = an already-joined mesh (e.g. a Datamine pt/tr wireframe pair);
    // otherwise pick the single-file provider by extension.
    const m = opts.prebuilt || await (/\.msh$/i.test(name) ? openMsh : /\.obj$/i.test(name) ? openObj : /\.lfm$/i.test(name) ? openLfmMesh : openPlyMesh)(blob);
    header = m.header;
    if (opts.forceSoup || overCap(header.triCount)) {
      header = { ...header, soup: true };
      soupSrc = (o) => soupFromMesh(m, o);
    } else {
      setupLayer(header);
      H.fitFromHeader(header, opts.first !== false);
      const chunk = buildMeshChunk({ vertices: m.vertices, triangles: m.triangles, frame: H.frame });
      // per-vertex colour when the mesh carries it (a .wfr's color.r/g/b, a PLY's red/green/blue)
      const vcol = vertexColorOf(m.attrs, chunk.vertexCount);
      if (vcol) { chunk.color = vcol; if (L) L.vertexColored = true; }   // the shader takes vColor in place of the tint
      H.renderer.addChunk(chunk, 'base', lid);
      if (L) L.bboxLocal = chunk.bboxLocal;      H.recomputeUnion();
      H.setColorLabels(null);
      $('#meta').textContent = `${name} — ${header.triCount.toLocaleString()} triangles · ${header.vertexCount.toLocaleString()} vertices · ${header.format}`;
      H.requestRender();
      return;
    }
  }
  // ── the soup path: stream → Morton chunks → budgeted accumulation ──
  setupLayer(header);
  H.fitFromHeader(header, opts.first !== false);
  H.setColorLabels(null);
  const cb = createSoupChunkBuilder({ frame: H.frame, chunkSize: 1 << 17, batchSize: 1 << 19, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
  let seen = 0;
  for await (const rc of soupSrc({ batchTris: 1 << 16 })) {
    cb.push(rc);
    seen += rc.count;
    $('#meta').textContent = `${name} — streaming ${seen.toLocaleString()} triangles…`;
    await new Promise((r) => setTimeout(r));
  }
  const doc = cb.flush();
  if (L) L.bboxLocal = doc.bboxLocal;
  H.recomputeUnion();
  L.docs.meshDoc.metaLine = `${name} — ${doc.count.toLocaleString()} triangles · ${header.vertexCount.toLocaleString()} vertices · ${header.format} · streamed`;
  $('#meta').textContent = L.docs.meshDoc.metaLine;
  H.requestRender();
}

// Drillholes (micro-layers spec §5): collar + survey + intervals → desurveyed
// interval midpoints as ONE element layer over the assay table. recIdx = the
// original interval row (the identity survives @gcu/drillhole's depth sort).
export async function openDrillholeLayer(files, opts = {}, mode = 'add', over = {}) {
  if (mode !== 'add') H.closeAllLayers();
  const lid = H.allocLayerId();
  if (lid == null) { const msg = `layer limit reached (${H.LAYER_CAP}) — remove one first`; $('#meta').textContent = msg; return layerFailed('drillholes', new Error(msg), over); }
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
    H.fitFromHeader(header, first);
    H.renderer.setCategories(header.categories ? 1 : 0);
    H.renderer.setLayerCats(lid, header.categories ? 256 : 0);
    H.renderer.setLayerStickRadius(lid, opts.radius || 1);
    H.setColorLabels(header);
    const cb = createStickChunkBuilder({ frame: H.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
    for await (const rc of streamChunks({ chunkPoints: 1 << 16 })) {
      cb.push(rc);
      await new Promise((r) => setTimeout(r));
    }
    const doc = cb.flush();
    const L = layerById(lid);
    if (L) { L.bboxLocal = doc.bboxLocal; L.colorSel = $('#colorBy').value; }
    H.recomputeUnion();
    const warn = header.report.checks.reduce((t, c) => t + c.count, 0);
    dhDoc.metaLine = `${name} — ${header.placed.toLocaleString()}/${header.count.toLocaleString()} intervals · ${header.holes} holes · ${header.method === 'minimumCurvature' ? 'min curvature' : header.method} · dip ${header.dipConvention}${warn ? ` · ⚠ ${warn} check${warn > 1 ? 's' : ''} (File info)` : ''}`;
    $('#meta').textContent = dhDoc.metaLine;
    H.ensureDhSetGroups();                                   // every dh layer lives in its SET group (the group IS the element)
    H.renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name, kind: 'drillholes' } }));
    H.requestRender();
    return lid;
  } catch (e) {
    $('#meta').textContent = `${name} — ${e.message}`;
    H.renderer.removeLayer(lid);
    S.layers = S.layers.filter((l) => l.id !== lid);
    if (S.layers.length) H.setActiveLayer(S.layers[0].id);
    else $('#empty').style.display = '';
    H.renderLayers();
    return layerFailed(name, e, over);
  }
}

// re-channel a drillhole layer (all in memory upstream — cheap). It is a re-desurvey
// with a new channel: it had its own copy that removed the layer BEFORE reopening,
// the order reopenDh was fixed away from (a failed open lost the layer).
export async function reopenDhChan(chan, L = activeLayer()) {
  if (!L || !L.dh || !L.docs.dhDoc) return null;
  return H.reopenDh(L, { chan });
}

// Parquet block model (columnar): the FOOTER gives columns + types + row count
// for free (no text sniff), coord columns come from the schema, and the whole
// table is read as in-memory column arrays that the shared block pipeline (grid
// inference, chunks, pick, filter, eval) consumes via a provider hook. Native
// row-group streaming + the footer's per-group bbox as a spatial index are the
// next step; this is the working opener.
export const _pqNum = (t) => /INT|FLOAT|DOUBLE|DECIMAL/.test(t || '');

// micro:model's grid → micro's internal grid. Forms accepted: per-axis
// { x, y, z } (axis-aligned), the internal rotated form (+ rot, anchor), or a
// producer's { basis: { origin, U, V, W, counts, source? } } alone.
export function microModelGrid(m) {
  const g = m && m.grid;
  if (!g) return null;
  if (g.rot && g.anchor && g.x) return { x: g.x, y: g.y, z: g.z, rot: g.rot, anchor: g.anchor, ...(g.source ? { source: g.source } : {}) };
  if (g.basis) return gridFromBasis(g.basis);
  return g.x ? { x: g.x, y: g.y, z: g.z } : null;
}

// micro:model `dims` (names) → column indices in THIS file, or null if absent/missing
export function microModelDimCols(m, names) {
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
    if (grid && (grid.rot || cachedPq.declared) && !opts.cached) {
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
  if (!grid && !subBlocked && !opts.forcePoints && res.length >= 24) {
    $('#meta').textContent = `${name} — trying a rotated lattice…`;
    const coordSweep = () => (async function* () {
      for await (const { count, cols } of streamParquetColumns(blob, [xN, yN, zN], info.rowGroups, info.meta)) yield { x: cols[xN], y: cols[yN], z: cols[zN], count };
    })();
    latticeCandidate = await detectRotatedLattice(Float64Array.from(res), coordSweep);
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

// Block-model path (.csv etc.): two-sweep provider → regular grid → box impostors.
// Not a regular grid → the points pipeline still shows the centroids.
// ── the TABLE kind: a tabular layer with NO geometry ─────────────────────────
// A join source, a routine's parameter table, a cut-off / density lookup, an
// analysis result. It lives in the layer list, opens an attribute table, filters
// with @gcu/expr, takes calc columns, and exports — but it has no bbox, draws
// nothing, and never enters the 3D budget. Everything spatial is gated off it by
// the absence of a mapping (gridAxesOf → null, so GT/swath never
// offer it) rather than by scattered kind checks.
export async function openTableBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading table…`;
  const { header } = await openTable(blob);
  const L = layerById(lid);
  if (!L) return;
  L.kind = 'table';
  L.docs = { tableDoc: { blob, name, header, metaLine: '' } };
  L.bboxLocal = null;                                      // no geometry — nothing to fit, nothing to draw
  const line = `${name} — ${header.count.toLocaleString()} rows · ${header.columns.length} columns · table (no coordinates)`;
  L.docs.tableDoc.metaLine = line;
  $('#meta').textContent = line;
  H.renderLayers();
}

// ── Excel: a worksheet opens as a TABLE, always ──────────────────────────────
// @gcu/sheet resolves a sheet into typed columns (Excel's own types — numbers,
// dates, booleans), and `openSheet` hands that over as a table document. No CSV
// in the middle, nothing re-sniffed. Geometry is NEVER inferred from a
// spreadsheet: a sheet with columns called X/Y/Z might be a block model or a
// table about something else entirely, so promoting one is the user's explicit
// act ("Interpret as…" on the layer), not ours.
export async function openXlsxBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading workbook…`;
  const doc = await xlsxOpenSheet(blob, { sheet: opts.sheet || null });
  const L = layerById(lid);
  if (!L) return;
  L.kind = 'table';
  L.docs = { tableDoc: { blob, name, header: doc.header, metaLine: '', xlsx: doc, sheet: doc.header.sheet } };
  L.bboxLocal = null;
  L._sheet = doc.header.sheet;                             // the manifest reopens THIS sheet
  if (!L.label || L.label === L.name) L.label = `${basename(name).replace(/\.xlsx$/i, '')} · ${doc.header.sheet}`;
  const line = `${name} · ${doc.header.sheet} — ${doc.header.count.toLocaleString()} rows · ${doc.header.columns.length} columns · table`;
  L.docs.tableDoc.metaLine = line;
  $('#meta').textContent = line;
  H.renderLayers();
}

// open a workbook: one sheet, several, or all of them (a group per workbook)
export async function openWorkbook(blob, name, mode = 'add') {
  let cs;
  try { cs = await xlsxCensus(blob); } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; return; }
  const sheets = cs.sheets.filter((sh) => !sh.empty);
  if (!sheets.length) { $('#meta').textContent = `${name} — no sheets with data`; return; }
  if (sheets.length === 1) { await openBlob(blob, name, mode, null, { sheet: sheets[0].name }); return; }
  const picked = await pickSheets(name, sheets);
  if (!picked || !picked.length) return;
  const ids = [];
  for (let i = 0; i < picked.length; i++) {
    const _got = await openBlob(blob, name, i === 0 ? mode : 'add', null, { sheet: picked[i] });
    const L = layerById(_got);
    if (L) ids.push(L.id);
  }
  if (ids.length > 1) H.createLayerGroup(basename(name), ids, { collapsed: false });   // the workbook IS the group
  $('#meta').textContent = `${name} — ${ids.length} sheet${ids.length === 1 ? '' : 's'} opened as table${ids.length === 1 ? '' : 's'}`;
}

// the sheet picker: which sheets to open (all, by default)
export function pickSheets(name, sheets) {
  return new Promise((res) => {
    const win = floatWin({ title: `sheets · ${basename(name)}`, sub: `${sheets.length} sheets`, x: innerWidth / 2 - 200, y: innerHeight / 3, w: 400, h: Math.min(150 + sheets.length * 24, innerHeight - 140) });
    win.body.className += ' rw-body';
    const boxes = sheets.map((sh) => {
      const row = document.createElement('label');
      row.className = 'rw-bar';
      row.style.cursor = 'pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      const nm = document.createElement('span'); nm.style.flex = '1'; nm.textContent = sh.name;
      const n = document.createElement('span'); n.className = 'lbl';
      n.textContent = `${sh.rows.toLocaleString()} rows · ${sh.columns} cols`;
      row.append(cb, nm, n);
      win.body.appendChild(row);
      return { cb, name: sh.name };
    });
    const bar = document.createElement('div'); bar.className = 'rw-bar'; bar.style.marginTop = '8px';
    const note = document.createElement('span'); note.className = 'lbl'; note.style.flex = '1';
    note.textContent = 'sheets open as tables';
    const ok = document.createElement('button'); ok.className = 'awin-btn btn-p'; ok.textContent = 'Open';
    const cancel = document.createElement('button'); cancel.className = 'awin-btn'; cancel.textContent = 'Cancel';
    bar.append(note, cancel, ok);
    win.body.appendChild(bar);
    let done = false;
    const finish = (v) => { if (done) return; done = true; win.close(); res(v); };
    ok.onclick = () => finish(boxes.filter((b) => b.cb.checked).map((b) => b.name));
    cancel.onclick = () => finish(null);
    win.el._onClose = () => finish(null);
  });
}

// does a delimited file carry X/Y/Z? (mapColumns is the same test the block
// provider uses — null means "no centroid columns", i.e. it is a plain table)
export async function delimitedHasCoords(blob) {
  try {
    const sniff = sniffDelimited(await blob.slice(0, 64 * 1024).text());
    return !!(sniff.header && mapColumns(sniff.header));
  } catch { return false; }
}

// ── rotated lattices (condenser grid/basis.js) ───────────────────────────────
// A provider that finds no axis-aligned grid tries a ROTATED one and hands back
// header.latticeCandidate — never applied silently (spec §3): the user says
// boxes or points. opts.acceptLattice (true/false) answers for a caller that
// has already decided (a host, a test); the decision is stamped on the header
// (header.lattice) and so rides into the sidecar, the manifest and lineage.
export const fmtPitch = (v) => String(+(+v).toFixed(4));

export function latticeNote(g) {
  if (!g || !g.rot) return '';
  const a = basisAngles(g.rot);
  return ` · rotated ${a.azimuth.toFixed(1)}°${a.zOnly ? '' : `, tilt ${a.tilt.toFixed(1)}°`}`;
}

export async function settleLatticeCandidate(header, name, opts = {}) {
  const c = header.latticeCandidate;
  if (!c || header.grid) return;
  const g = c.grid, a = c.angles;
  const desc = `${g.x.count}×${g.y.count}×${g.z.count} blocks of ${fmtPitch(g.x.pitch)}×${fmtPitch(g.y.pitch)}×${fmtPitch(g.z.pitch)}, azimuth ${a.azimuth.toFixed(1)}°${a.zOnly ? '' : `, tilted ${a.tilt.toFixed(1)}°`}`;
  const yes = opts.acceptLattice != null ? !!opts.acceptLattice
    : await H.microConfirm('rotated block model', `${name} isn't on an axis-aligned grid, but every centroid sits on a ROTATED lattice: ${desc}. Draw it as rotated boxes, or keep the centroids as points?`, 'rotated boxes', 'points');
  header.latticeCandidate = null;
  if (yes) { header.grid = g; header.lattice = { basis: 'inferred', confirmed: opts.acceptLattice != null ? 'caller' : 'user', azimuth: +a.azimuth.toFixed(4), tilt: +a.tilt.toFixed(4) }; }
}

// rows a delimited model dropped because they have no usable coordinates (blank
// or not a number) — a data error, so it's said, never silent
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
  H.renderer.removeLayer(lid); if (!opts.keepFilter) H.renderer.setFilter(null, {}, lid);
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
  H.fitFromHeader(header, opts.first !== false && opts.chan == null);
  H.renderer.setCategories(header.categories ? header.categories.length : 0);
  H.setColorLabels(header);
  if (header.grid) {
    const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], H.frame, header.grid.rot || null, header.grid.anchor || null);
    blockDoc.grid = grid;
    const dimPalette = header.subBlocked ? header.dimPalette : null;
    const cb = await baseBlockBuilder(lid, { frame: H.frame, grid, dimPalette });   // 128k/chunk, 16 chunks per Morton batch: tight bboxes are what give the frustum test teeth
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
    const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
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
    H.recomputeUnion();
    blockDoc.metaLine = `${name} — ${doc.count.toLocaleString()} centroids${header.latticeRejected ? ` (the declared lattice was REFUSED: ${header.latticeRejected} — points view)` : blockDoc.forcePoints ? '' : ' (no regular grid detected — points view)'}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
    blockDoc.metaLine += droppedNote(header);
    $('#meta').textContent = blockDoc.metaLine;
    { const Lk = layerById(lid); if (opts.keepFilter && Lk && (Lk.filterExpr || "").trim()) applyBlockFilter(Lk.filterExpr, Lk); }   // THIS layer's filter (was the active one's)
  }
  H.requestRender();
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
  H.renderer.removeLayer(lid); if (!opts.keepFilter) H.renderer.setFilter(null, {}, lid);
  // sub-blocked / irregular models run a FULL discovery sweep before the first
  // chunk (a 13 GB file reads silently for a minute otherwise) — show progress
  const gb = blob.size / 1073741824;
  const onProgress = (p) => { $('#meta').textContent = `${name} — discovery sweep ${Math.round(100 * p.done / (p.total || 1))}% of ${p.total.toLocaleString()} records${gb > 0.5 ? ` (${gb.toFixed(1)} GB)` : ''}…`; };
  const { header, streamChunks } = await openDmModel(blob, { ...(mapping ? { mapping } : {}), forcePoints: opts.forcePoints, onProgress, cached: opts.cached || null });
  const blockDoc = { blob, name, header, metaLine: '', forcePoints: opts.forcePoints, streamChunks };
  registerDocs(lid, header.grid ? 'blocks' : 'points', { blockDoc });
  H.fitFromHeader(header, opts.first !== false && opts.chan == null);
  H.renderer.setCategories(header.categories ? 1 : 0);
  H.setColorLabels(header);
  if (header.grid) {
    const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], H.frame);
    blockDoc.grid = grid;
    const dimPalette = header.subBlocked ? header.dimPalette : null;
    const cb = await baseBlockBuilder(lid, { frame: H.frame, grid, dimPalette });
    const doc = await streamInto(cb, streamChunks, header, name, 1 << 18, lid);
    blockDoc.drawn = doc.count;
    blockDoc.metaLine = header.subBlocked
      ? `${name} — ${doc.count.toLocaleString()} sub-blocks · .dm fine ${header.grid.x.pitch}×${header.grid.y.pitch}×${header.grid.z.pitch} · ${header.dimPalette.length} sizes${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`
      : `${name} — ${doc.count.toLocaleString()} blocks · .dm grid ${header.grid.x.count}×${header.grid.y.count}×${header.grid.z.count} @ ${header.grid.x.pitch}×${header.grid.y.pitch}×${header.grid.z.pitch}${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
  } else {
    // sub-blocked / forced points: centroids as points (grade → intensity slot),
    // RAW record numbers preserved so a picked centroid fetches its .dm record
    const cb = createChunkBuilder({ frame: H.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { H.renderer.addChunk(c, 'base', lid); H.requestRender(); } });
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
    H.recomputeUnion();
    blockDoc.metaLine = `${name} — ${doc.count.toLocaleString()} centroids (sub-blocked .dm — points view)${header.attributes.length ? ' · ' + header.attributes.join(', ') : ''}`;
  }
  $('#meta').textContent = blockDoc.metaLine;
  { const Lk = layerById(lid); if (opts.keepFilter && Lk && (Lk.filterExpr || "").trim()) applyBlockFilter(Lk.filterExpr, Lk); }   // THIS layer's filter (was the active one's)
  H.requestRender();
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
