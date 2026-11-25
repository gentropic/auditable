// micro — the MESH readers: PLY / OBJ / MSH / LFM surfaces (a context-tier mesh, or a
// streamed triangle soup past CONTEXT_TRI_CAP), DXF (3D faces, design strings, pegs),
// .wfr, and Datamine wireframe pairs (a points file + a triangles file). Multi-object OBJ
// and LFM files split into one layer per object. openBlob (src/open.js) dispatches here.
import { dmWireframeRole, peekDmColumns, openDmWireframe, DXF_STREAM_BYTES, openDxf, createStickChunkBuilder, createChunkBuilder, openDxfStream, createSoupChunkBuilder, parsePlyHeader, openPlySoup, readMSHLayout, openMshSoup, openObjSoup, openMsh, openObj, openPlyMesh, soupFromMesh, buildMeshChunk } from '../../../ext/condenser/src/main.js';
import { closeAllLayers, allocLayerId, LAYER_CAP, removeLayerUI, fitFromHeader, recomputeUnion } from './layers.js';
import { S, layerById, requestRender } from './state.js';
import { openLineage } from './lineage.js';
import { createLayerGroup } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { openWfrBlob, wfrResidentMesh, wfrSoupDoc, wfrStringsDoc, wfrPointsDoc, summarizeElements, vertexColorOf } from './wfr-io.js';
import { registerDocs, openBlob } from './open.js';
import { layerPlacementM, placeMesh, placedSoupStream } from './placement.js';
import { placeBbox } from './placement-core.js';
import { setColorLabels, hexToRgb01 } from './color.js';
import { applyCatLegend } from './categories.js';
import { readLFM, writeLFM } from '../../../ext/lfm/lfm.js';
import { lfmTriCount, openLfmSoup, openLfmMesh } from './records.js';
const $ = (s) => document.querySelector(s);

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
  if (mode !== 'add') closeAllLayers();
  const lid = allocLayerId();
  if (lid == null) { $('#meta').textContent = `layer limit reached (${LAYER_CAP}) — remove one first`; return; }
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
    renderLayers();
    dispatchEvent(new Event('micro:project-dirty'));
  } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; const L = layerById(lid); if (L) removeLayerUI(lid); }
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
      lid = allocLayerId();
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
  if (ids.length > 1) createLayerGroup(name, ids, { collapsed: false });
  if (multi) $('#meta').textContent = `${name} — ${ids.length} elements (${summarizeElements(wfr).filter((s) => !skipped.includes(s.name)).map((s) => `${s.name}: ${s.kind}`).join(' · ')})${skipped.length ? ` · ${skipped.length} skipped (layer limit)` : ''}`;
  return ids;
}
// A strings (sticks) layer from any provider of the condenser strings contract — resident DXF,
// a .wfr lines element: { header, streamChunks → stick RawChunks, fetchRecord, recordPosition }.
// The header may only learn its categories while streaming (a .wfr reads its layer attribute
// brick by brick), so the category legend is applied after the stream.
async function openStringsLayer(blob, name, lid, first, r, catOpts) {
  const { header, streamChunks, fetchRecord, recordPosition } = r;
  registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord, recordPosition } });
  fitFromHeader(header, first);
  const catsUpfront = header.mapping && header.mapping.cat != null;
  S.renderer.setCategories(catsUpfront ? 1 : 0);
  S.renderer.setLayerCats(lid, catsUpfront ? 256 : 0);
  S.renderer.setLayerStickRadius(lid, 0.8);
  setColorLabels(header);
  const cb = createStickChunkBuilder({ frame: S.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  for await (const rc of streamChunks({ chunkPoints: 1 << 16 })) { cb.push(rc); await new Promise((r2) => setTimeout(r2)); }
  const doc = cb.flush();
  finishCatLayer(lid, header, doc, catOpts);
  return header;
}
// A points layer from the DXF-pegs contract (resident DXF pegs, a .wfr points element).
async function openPegsLayer(blob, name, lid, first, r, catOpts) {
  const { header, streamChunks, fetchRecord } = r;
  registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord } });
  fitFromHeader(header, first);
  const catsUpfront = header.mapping && header.mapping.cat != null;
  S.renderer.setCategories(catsUpfront ? 1 : 0);
  S.renderer.setLayerCats(lid, catsUpfront ? 256 : 0);
  setColorLabels(header);
  const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
    cb.push({ count: rc.count, x: rc.x, y: rc.y, z: rc.z, intensity: new Uint16Array(rc.count), classification: rc.cat || new Uint8Array(rc.count), rgb: null, recStart: rc.recStart || 0 });
    await new Promise((r2) => setTimeout(r2));
  }
  const doc = cb.flush();
  finishCatLayer(lid, header, doc, catOpts);
  return header;
}
// bbox, colour mode and the authored category legend once a categorized layer has streamed
function finishCatLayer(lid, header, doc, { authoredOnly = false } = {}) {
  const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const authored = (c) => (c && !(c[0] === 255 && c[1] === 255 && c[2] === 255) ? c : null);   // white is "foreground", not a colour
  S.renderer.setLayerCats(lid, header.categories ? 256 : 0);
  if (header.categories) S.renderer.setCategories(1);
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
  recomputeUnion();
}
// A DXF too big to read whole (a 3DFACE topography reaches gigabytes; one JS
// string can't hold it) streams: ONE pass through condenser's openDxfStream
// feeds every kind the file holds into its own layer — the surface as a
// streamed soup mesh, design strings as capsules, pegs as points — siblings in
// a group, each keeping L.name = the file (that is the project source). `as`
// (Open as / Reinterpret / a project reload) keeps just one kind. Like any
// streamed mesh, the surface is display/section/pick only: solid queries and
// mesh export need the resident tier.
async function openDxfStreamed(blob, name, opts) {
  const first = opts.first, as = opts.as || null;
  const dxfHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const authored = (c) => (c && !(c[0] === 255 && c[1] === 255 && c[2] === 255) ? c : null);   // ACI 7 is "foreground", not a colour
  const gb = (blob.size / 2 ** 30).toFixed(1);
  $('#meta').textContent = `${name} — ${gb} GB · sampling extents…`;
  const sd = await openDxfStream(blob, { as });
  fitFromHeader(sd.header, first);
  const sum = sd.summary;
  const primary = layerById(opts.layer);
  const lids = {}, builders = {}, headers = {}, extra = [];
  const LABEL = { mesh: 'surface', strings: 'strings', points: 'points' };
  const setup = (kind, lid) => {
    const L = layerById(lid);
    const bbox = sd.header.bbox;
    const onChunk = (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); };
    if (kind === 'mesh') {
      const header = headers.mesh = { kind: 'mesh', soup: true, streamed: true, format: 'dxf', vertexCount: 0, triCount: 0, bbox };
      L.kind = 'mesh';
      L.docs = { meshDoc: { blob, name, header } };
      L.tint = opts.tint || '#9ea3a8';
      L.opacity = opts.opacity != null ? opts.opacity : 1;
      S.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity });
      builders.mesh = createSoupChunkBuilder({ frame: S.frame, chunkSize: 1 << 17, batchSize: 1 << 19, seed: 1, onChunk });
    } else if (kind === 'strings') {
      const header = headers.strings = { kind: 'strings', format: 'dxf', count: 0, strings: 0, columns: ['LAYER', 'STRING'], mapping: { chan: null, cat: 0 }, categories: null, numericColumns: [], chanRange: [0, 0], bbox };
      registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord: sum.strings.fetchRecord, recordPosition: sum.strings.recordPosition } });
      S.renderer.setCategories(1);
      S.renderer.setLayerCats(lid, 256);
      S.renderer.setLayerStickRadius(lid, 0.8);
      builders.strings = createStickChunkBuilder({ frame: S.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk });
    } else {
      const header = headers.points = { kind: 'blockmodel', format: 'dxf', count: 0, grid: null, columns: ['X', 'Y', 'Z', 'LAYER'], mapping: { x: 0, y: 1, z: 2, chan: null, cat: 3 }, categories: null, numericColumns: [], bbox };
      registerDocs(lid, 'points', { stringsDoc: { blob, name, header, fetchRecord: sum.points.fetchRecord } });
      S.renderer.setCategories(1);
      S.renderer.setLayerCats(lid, 256);
      builders.points = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk });
    }
  };
  // the first kind to arrive takes the layer openBlob allocated; later kinds get siblings
  const lidFor = (kind) => {
    if (kind in lids) return lids[kind];
    let lid;
    if (!Object.keys(lids).length) lid = opts.layer;
    else {
      lid = allocLayerId();
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
        if (L && tint) { L.tint = dxfHex(tint); S.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity }); }
        if (L) { L.colorSel = $('#colorBy').value; L.docs.meshDoc.metaLine = `${name} — ${h.triCount.toLocaleString()} triangles · DXF · streamed`; }
      } else {
        const h = headers[kind], s = sum[kind];
        h.count = kind === 'strings' ? sum.counts.segments : sum.counts.points;
        if (kind === 'strings') h.strings = sum.counts.strings;
        h.categories = s.categories;
        h.catColors = s.catColors ? s.catColors.map(authored) : null;
        S.renderer.setLayerCats(lid, h.categories ? 256 : 0);
        if (L) {
          L.colorSel = h.categories ? 'cat' : 'solid';
          if (h.categories && h.catColors && h.catColors.some(Boolean)) {
            L.catLegend = { col: 'LAYER', entries: h.categories.map((nm, i) => (h.catColors[i] ? { values: [nm], color: dxfHex(h.catColors[i]) } : null)).filter(Boolean), otherColor: '#555a5f' };
            applyCatLegend(L, true);
          }
        }
      }
    }
    recomputeUnion();
    if (first && S.docBbox) S.cam.fit(S.docBbox);               // the sampled bbox aimed the first view; now the true one
    const prim = layerById(opts.layer);
    if (prim) setColorLabels(prim.kind === 'mesh' ? null : headers[Object.keys(lids).find((k) => lids[k] === opts.layer)]);
    const placed = Object.entries(lids).filter(([, v]) => v != null).map(([k]) => k);
    const ids = placed.map((k) => lids[k]);
    if (ids.length > 1) createLayerGroup(name, ids, { collapsed: false });
    const c = sum.counts, skipped = Object.entries(lids).filter(([, v]) => v == null).map(([k]) => k);
    const warn = sum.warnings.length + sum.warningsSuppressed;
    $('#meta').textContent = `${name} — streamed ${gb} GB · ` + [
      c.triangles && `${c.triangles.toLocaleString()} triangles`, c.strings && `${c.strings.toLocaleString()} strings`, c.points && `${c.points.toLocaleString()} points`,
    ].filter(Boolean).join(' · ') + (warn ? ` · ${warn.toLocaleString()} unsupported/skipped entities` : '') + (skipped.length ? ` · ${skipped.join('+')} not shown (layer limit)` : '');
    requestRender();
  } catch (e) {
    for (const lid of extra) { S.renderer.removeLayer(lid); S.layers = S.layers.filter((l) => l.id !== lid); }
    throw e;
  }
}
// Context meshes (micro-layers spec §7 tier 1): wireframes / solids / TINs —
// whole-file read, one static chunk, scenery (no records: not pickable, not
// filterable). Picks pass THROUGH a mesh to the elements behind it.
// above this → the streaming soup tier. ?ctxcap=N lowers it so a smoke can exercise the
// over-the-cap paths (promote-to-context) on a mesh small enough to build in a test.
export const CONTEXT_TRI_CAP = (() => { try { const n = +new URLSearchParams(location.search).get('ctxcap'); if (n > 0) return n; } catch {} return 2_000_000; })();
export const MESH_STREAM_BYTES = 160 * 1024 * 1024;   // an OBJ past this streams (its text announces no triangle count)
async function plyFaceCount(blob) {
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
  if (ids.length > 1) createLayerGroup(name, ids, { collapsed: false });
  $('#meta').textContent = `${name} — split into ${ids.length} solids${skipped ? ` (${skipped} skipped — mesh layer limit)` : ''}`;
  return ids;
}
// the split path below writes ONE-MESH .lfm children via writeLFM, so every
// layer stays a real Leapfrog file)
const lfmTint = (c) => (c ? '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('') : null);
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
  if (ids.length > 1) createLayerGroup(name, ids, { collapsed: false });
  $('#meta').textContent = `${name} — split into ${ids.length} solids${skipped ? ` (${skipped} skipped — mesh layer limit)` : ''}`;
  return ids;
}
export async function openMeshDoc(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading mesh…`;
  const L = layerById(lid);
  const PM = layerPlacementM(L);                           // the layer's rigid placement (src/placement.js): the vertices in world
  // over the cap → the streamed soup tier, unless forceContext: the user asked for the
  // exact tier knowing its cost (structural analysis and solid queries need CPU geometry)
  const overCap = (n) => !opts.forceContext && n > CONTEXT_TRI_CAP;
  const setupLayer = (header) => {
    if (!L) return;
    L.kind = 'mesh';
    L.docs = { meshDoc: { blob, name, header, ptBlob: opts.ptBlob || null, placeM: PM || null } };   // placeM: records.js reReadMesh places every re-parse
    S.renderer.removeLayer(lid);
    if (L.lineage) { const pp = { ...(L.lineage.params || {}) }; if (L.placement) pp.placement = L.placement; else delete pp.placement; L.lineage.params = pp; }
    L.tint = opts.tint || '#9ea3a8';
    L.opacity = opts.opacity != null ? opts.opacity : 1;
    S.renderer.setLayerMeshStyle(lid, { tint: hexToRgb01(L.tint), opacity: L.opacity });
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
    header = PM ? { ...doc.header, bbox: doc.header.bbox ? placeBbox(PM, doc.header.bbox) : doc.header.bbox, placed: true } : doc.header;
    soupSrc = PM ? placedSoupStream((o) => doc.streamChunks(o), PM) : (o) => doc.streamChunks(o);
  } else {
    // prebuilt = an already-joined mesh (e.g. a Datamine pt/tr wireframe pair);
    // otherwise pick the single-file provider by extension.
    const m = placeMesh(opts.prebuilt || await (/\.msh$/i.test(name) ? openMsh : /\.obj$/i.test(name) ? openObj : /\.lfm$/i.test(name) ? openLfmMesh : openPlyMesh)(blob), PM);
    header = m.header;
    if (opts.forceSoup || overCap(header.triCount)) {
      header = { ...header, soup: true };
      soupSrc = (o) => soupFromMesh(m, o);
    } else {
      setupLayer(header);
      fitFromHeader(header, opts.first !== false);
      const chunk = buildMeshChunk({ vertices: m.vertices, triangles: m.triangles, frame: S.frame });
      // per-vertex colour when the mesh carries it (a .wfr's color.r/g/b, a PLY's red/green/blue)
      const vcol = vertexColorOf(m.attrs, chunk.vertexCount);
      if (vcol) { chunk.color = vcol; if (L) L.vertexColored = true; }   // the shader takes vColor in place of the tint
      S.renderer.addChunk(chunk, 'base', lid);
      if (L) L.bboxLocal = chunk.bboxLocal;      recomputeUnion();
      setColorLabels(null);
      $('#meta').textContent = `${name} — ${header.triCount.toLocaleString()} triangles · ${header.vertexCount.toLocaleString()} vertices · ${header.format}`;
      requestRender();
      return;
    }
  }
  // ── the soup path: stream → Morton chunks → budgeted accumulation ──
  setupLayer(header);
  fitFromHeader(header, opts.first !== false);
  setColorLabels(null);
  const cb = createSoupChunkBuilder({ frame: S.frame, chunkSize: 1 << 17, batchSize: 1 << 19, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  let seen = 0;
  for await (const rc of soupSrc({ batchTris: 1 << 16 })) {
    cb.push(rc);
    seen += rc.count;
    $('#meta').textContent = `${name} — streaming ${seen.toLocaleString()} triangles…`;
    await new Promise((r) => setTimeout(r));
  }
  const doc = cb.flush();
  if (L) L.bboxLocal = doc.bboxLocal;
  recomputeUnion();
  L.docs.meshDoc.metaLine = `${name} — ${doc.count.toLocaleString()} triangles · ${header.vertexCount.toLocaleString()} vertices · ${header.format} · streamed`;
  $('#meta').textContent = L.docs.meshDoc.metaLine;
  requestRender();
}
