// micro POLYGONS, the app side — opening a strings & polygons file into a layer, committing
// edits (a drawn or edited layer is kept as micro's own WKT-CSV), exporting (WKT-CSV, GeoJSON,
// Shapefile, DXF — deliverBlob is the one door out), the QGIS clipboard both ways, and the
// layer-menu rows + palette commands. The model and the API live in src/polygons.js; the
// readers and writers in src/poly-io.js; drawing in src/poly-draw.js.
import { S, layerById, requestRender } from './state.js';
import { makeFeatureDoc, renderFeatureLayer, refreshFeatureLayer, featureDocOf, isPolygonLayer, defaultStickRadius, setFeatureFill, setFeatureCategory } from './polygons.js';
import { readFeatureFile, buildFeatureExport, FEATURE_EXPORTS, featuresToWktCsv, sniffWktCsv, readWktCsv, resolveCrs } from './poly-io.js';
import { projectCrs, crsLabel } from './crs.js';
import { adoptFileCrs, offerProjectCrs } from './crs-ui.js';
import { featuresOf } from './polygons.js';
import { registerDocs } from './open.js';
import { fitFromHeader, recomputeUnion, allocLayerId, LAYER_CAP, setActiveLayer } from './layers.js';
import { setColorLabels } from './color.js';
import { openBlocksBlob } from './open-blocks.js';
import { openLineage } from './lineage.js';
import { renderLayers } from './layers-panel.js';
import { deliverBlob } from './hostio.js';
import { microChoose, microPrompt } from './prompts.js';
import { markProjectDirty } from './project.js';
import { pushUndo } from './undo.js';
import { registerCommands, contributeMenu, COMMANDS, commandCtx } from './commands.js';
import { armEditVertices, armDraw } from './poly-draw.js';
import { hasSceneFrame, axisLocalToWorld } from './coords.js';
const $ = (s) => document.querySelector(s);

// ── opening ─────────────────────────────────────────────────────────────────────────────────
const KIND_WORD = { geojson: 'GeoJSON', wkt: 'WKT', 'wkt-csv': 'WKT-CSV', 'csv-strings': 'string file', shapefile: 'Shapefile', dxf: 'DXF', drawn: 'drawn', pasted: 'pasted (WKT)' };
export function featureMetaLine(name, h, warnings = []) {
  const lines = h.count - h.polygons;
  const parts = [h.polygons && `${h.polygons.toLocaleString()} polygon${h.polygons === 1 ? '' : 's'}`, lines && `${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`].filter(Boolean);
  return `${name} — ${parts.join(' · ') || 'no features'} · ${h.columns.length} attribute${h.columns.length === 1 ? '' : 's'} · ${KIND_WORD[h.format] || h.format}${h.crs && h.crs.name ? ` · ${h.crs.name}` : ''}${warnings.length ? ' · ' + warnings.join(' · ') : ''}`;
}
// a feature model → the layer `lid` (allocated by openBlob or by the caller)
export function installFeatureModel(lid, first, model, blob, name, poly = {}) {
  const L = layerById(lid);
  const doc = makeFeatureDoc(model, blob, name, { catCol: poly.cat });
  registerDocs(lid, 'points', { stringsDoc: doc });
  if (L) { L.polyFill = !!poly.fill; if (poly.fillOpacity != null) L.fillOpacity = poly.fillOpacity; if (poly.fillColor) L.fillColor = poly.fillColor; }
  fitFromHeader(doc.header, first);
  if (doc.header.categories) S.renderer.setCategories(1);
  S.renderer.setLayerCats(lid, doc.header.categories ? 256 : 0);
  S.renderer.setLayerStickRadius(lid, poly.radius || defaultStickRadius(doc.header));
  setColorLabels(doc.header);
  if (L) L.colorSel = doc.header.categories ? 'cat' : 'solid';
  if (L && lid === S.activeId) { const cb = $('#colorBy'); if ([...cb.options].some((o) => o.value === L.colorSel)) cb.value = L.colorSel; }
  renderFeatureLayer(L);
  recomputeUnion();
  doc.metaLine = featureMetaLine(name, doc.header, model.warnings || []);
  $('#meta').textContent = doc.metaLine;
  return doc;
}
// the features that came without a z → at `z` (the rest keep theirs)
function placeFlat(model, z) {
  model.features.forEach((f, i) => { if (model.noZ && model.noZ[i]) for (const r of f.rings) for (const p of r) p[2] = z; });
}
// openBlob's branch: the file → features (or points, when that's all it holds)
export async function openFeaturesBlob(blob, name, opts = {}) {
  const lid = opts.layer, first = opts.first;
  $('#meta').textContent = `${name} — reading features…`;
  // the CRS (src/crs.js): reprojected into the project's on read; a projected file with no project
  // CRS gives the project its CRS; a geographic one with none → the offer to set one (not when a
  // host / routine asked to be told by an exception instead)
  const ropts = { kind: opts.kind, parts: opts.parts, assumeProjected: !!opts.assumeProjected };
  let model;
  try { model = await readFeatureFile(blob, name, { ...ropts, target: projectCrs() }); }
  catch (e) {
    if (!e.geographic || opts.noAsk || projectCrs()) throw e;
    const c = await offerProjectCrs(e, name);
    if (!c) throw e;
    model = await readFeatureFile(blob, name, { ...ropts, target: c });
  }
  if (!projectCrs() && model.fileCrs) await adoptFileCrs(model.fileCrs, name);
  if (model.reprojected) {
    const t = projectCrs();
    model.crs = { kind: 'projected', name: crsLabel(t), epsg: t && t.epsg ? t.epsg : undefined };
    const L0 = layerById(lid);
    if (L0 && L0.lineage) L0.lineage.params = { ...(L0.lineage.params || {}), reproject: model.reprojected };
  }
  if (!model.features.length && model.points && model.points.length) {
    // a file of points only: a points layer from a generated X,Y,Z table, the attributes as columns
    const cols = model.columns, esc = (v) => { const s = v === '' || v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = [['X', 'Y', 'Z', ...cols].map(esc).join(','), ...model.points.map((p, i) => [p[0], p[1], p[2], ...(model.pointRows[i] || [])].map(esc).join(','))].join('\n') + '\n';
    const csvName = name.replace(/\.[^.]+$/, '') + '.points.csv';
    const L = layerById(lid);
    const csv = new File([text], csvName, { type: 'text/csv' });
    if (L) { L.label = name; L.name = csvName; L.memoryOnly = true; L.handle = null; }
    await openBlocksBlob(csv, csvName, { layer: lid, first, forcePoints: true, mapping: { x: 0, y: 1, z: 2, chan: null, cat: null } });
    $('#meta').textContent = `${name} — ${model.points.length.toLocaleString()} points (no lines or polygons) → a points layer${model.warnings.length ? ' · ' + model.warnings.join(' · ') : ''}`;
    return { points: model.points.length };
  }
  const flat = model.noZ ? model.noZ.filter(Boolean).length : 0;
  if (flat && opts.z != null && Number.isFinite(+opts.z)) placeFlat(model, +opts.z);
  else if (flat) model.warnings.push(`${flat === model.features.length ? 'a 2D file' : `${flat} feature${flat === 1 ? '' : 's'} without Z`}: drawn at z = 0 (Set elevation… places it)`);
  const doc = installFeatureModel(lid, first, model, blob, name, opts.poly || {});
  if (/\.zip$/i.test(name) && blob._shpBase) { const L = layerById(lid); if (L) { L.label = `${blob._shpBase}.shp`; L.memoryOnly = true; } }
  return { features: doc.header.count };
}

// ── edits: a changed layer becomes micro's own WKT-CSV ──────────────────────────────────────
const snap = (d) => ({ features: JSON.parse(JSON.stringify(d.features)), rows: JSON.parse(JSON.stringify(d.rows)), columns: [...d.header.columns] });
function restore(L, s) {
  const d = featureDocOf(L); if (!d) return;
  d.features = s.features; d.rows = s.rows; d.header = { ...d.header, columns: s.columns };
  materialize(L);
}
// the bytes after an edit: WKT-CSV (comma), named after the layer, in this session only until a save
function materialize(L) {
  const d = featureDocOf(L);
  const h = refreshFeatureLayer(L);
  const text = featuresToWktCsv(featuresOf(L), h.columns, { delim: ',' });
  const base = (L.name || 'polygons').replace(/\.(zip|shp|geojson|json|wkt|csv|txt|tsv|dxf)$/i, '').replace(/\.points$/, '').replace(/[^\w.-]+/g, '_') || 'polygons';
  const fname = `${base}.csv`;
  const blob = new File([text], fname, { type: 'text/csv' });
  if (!L.label && L.name !== fname) L.label = L.name;
  L.name = fname; d.name = fname; d.blob = blob;
  L.handle = null; L.memoryOnly = true; if (L.storage === 'project') L.storage = 'loose';
  h.format = d.source.format === 'drawn' ? 'drawn' : 'wkt-csv';
  d.metaLine = featureMetaLine(L.label || L.name, h);
  renderLayers();
  markProjectDirty();
  dispatchEvent(new Event('micro:project-dirty'));
  requestRender();
}
// one undoable edit: `fn(doc)` changes doc.features / doc.rows in place
export function editFeatures(L, label, fn) {
  const d = featureDocOf(L); if (!d) return false;
  const before = snap(d);
  fn(d);
  // an edit moves vertices IN PLACE: drop each feature's cached bbox and parts (polygons.js)
  for (const f of d.features || []) { if (f) { delete f._bbox; delete f._parts; } }
  const after = snap(d);
  materialize(L);
  pushUndo(label, () => { const Lx = layerById(L.id); if (Lx) restore(Lx, before); }, { redo: () => { const Lx = layerById(L.id); if (Lx) restore(Lx, after); } });
  return true;
}
// a new feature layer from scratch (drawing, a paste) — returns the layer
export function newFeatureLayer(name, model, { label = null, source = 'drawn', poly = {} } = {}) {
  const lid = allocLayerId();
  if (lid == null) throw new Error(`layer limit reached (${LAYER_CAP}) — remove one first`);
  const first = S.layers.length === 0;
  const fname = name.replace(/[^\w.-]+/g, '_') + '.csv';
  const text = featuresToWktCsv([], model.columns, { delim: ',' });
  const blob = new File([text], fname, { type: 'text/csv' });
  S.layers.push({ id: lid, name: fname, label: label || name, kind: 'points', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'loose', memoryOnly: true, lineage: openLineage(fname, blob) });
  S.activeId = lid;
  $('#empty').style.display = 'none';
  installFeatureModel(lid, first, { ...model, format: source }, blob, fname, poly);
  const L = layerById(lid);
  featureDocOf(L).source.format = source;
  if (model.features.length) materialize(L);
  setActiveLayer(lid);
  renderLayers();
  dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id: lid, name: fname, kind: 'points' } }));
  return L;
}

// set every vertex's z (2D data, a drawn limit placed at a bench)
export async function setFeatureElevation(L, z = null) {
  if (!isPolygonLayer(L)) return;
  if (z == null) { const v = await microPrompt('elevation (z) for every vertex of the layer', String(featureDocOf(L).header.bbox.min[2])); if (v == null || v === '') return; z = +v; }
  if (!Number.isFinite(+z)) { $('#meta').textContent = 'set elevation: not a number'; return; }
  editFeatures(L, 'set elevation', (d) => { for (const f of d.features) for (const r of f.rings) for (const p of r) p[2] = +z; });
  $('#meta').textContent = `${L.label || L.name} — every vertex at z = ${+z}`;
}

// ── export ──────────────────────────────────────────────────────────────────────────────────
export async function exportFeatures(L, format = null, opts = {}) {
  if (!isPolygonLayer(L)) { $('#meta').textContent = 'export features: pick a strings & polygons layer'; return null; }
  const sel = !!(L._selMask && L._selCount);
  if (!format) {
    format = await microChoose('export features', `${L.label || L.name} — ${sel ? `the ${L._selCount} selected feature${L._selCount === 1 ? '' : 's'}` : 'every feature'}, with its attributes. A shapefile comes as a .zip (.shp .shx .dbf .cpg .prj).`,
      [{ label: 'Cancel', value: null, quiet: true }, ...FEATURE_EXPORTS.map((f) => ({ label: f.label.replace(/ \(.*/, ''), value: f.id }))]);
    if (!format) return null;
  }
  try {
    const r = await buildFeatureExport(L, format, { selectedOnly: opts.selectedOnly != null ? opts.selectedOnly : sel, projectCrs: projectCrs() });
    if (opts.deliver !== false) await deliverBlob(r.blob, r.name);
    $('#meta').textContent = `exported ${r.name}${r.note ? ' — ' + r.note : ''}`;
    return r;
  } catch (e) { $('#meta').textContent = `export features — ${e.message}`; return null; }
}

// ── the QGIS clipboard ──────────────────────────────────────────────────────────────────────
// copy: the selected features (or all) as QGIS copies them — tab-separated, a header row, the
// WKT first (wkt_geom), then the attributes
export function copyFeaturesText(L) {
  const d = featureDocOf(L); if (!d) return null;
  const records = L._selMask && L._selCount ? L._selMask : null;
  return featuresToWktCsv(featuresOf(L, { records }), d.header.columns, { delim: '\t' });
}
export async function copyFeatures(L) {
  const text = copyFeaturesText(L);
  if (!text) { $('#meta').textContent = 'copy features: pick a strings & polygons layer'; return null; }
  const n = text.split('\n').length - 2;
  try { await navigator.clipboard.writeText(text); $('#meta').textContent = `copied ${n} feature${n === 1 ? '' : 's'} as WKT — paste into a QGIS layer (Edit → Paste Features)`; }
  catch { $('#meta').textContent = 'copy features: the clipboard refused (no permission in this browser)'; }
  return text;
}
// paste: QGIS-copied text (or any WKT-CSV) → a new layer. Geometry without Z asks for one.
let _pasteN = 0;
export async function pasteFeaturesText(text, { z = null, name = null, assumeProjected = false } = {}) {
  const sn = sniffWktCsv(text || '');
  if (!sn) { $('#meta').textContent = 'paste features: the clipboard holds no features (a table with a wkt_geom column — QGIS: select features, Ctrl+C)'; return null; }
  const model = readWktCsv(text, sn);
  try { await resolveCrs(model, 'the pasted features', { target: projectCrs(), assumeProjected }); } catch (e) { $('#meta').textContent = e.message; throw e; }   // lon/lat → reprojected into the project's CRS
  if (!model.features.length) { $('#meta').textContent = 'paste features: no lines or polygons in the clipboard (points paste into QGIS-style point layers — open them as a file)'; return null; }
  const flat = model.noZ ? model.noZ.filter(Boolean).length : 0;
  if (flat) {                                              // 2D geometry: a DECLARED z, never a silent guess
    if (z == null) {
      const dz = S.docBbox && hasSceneFrame() ? axisLocalToWorld(S.docBbox[5], 2) : 0;
      const v = await microPrompt(`${flat === model.features.length ? 'these features have' : `${flat} of these features have`} no Z — place them at elevation`, String(+dz.toFixed(2)));
      if (v == null) return null;
      z = +v;
    }
    if (!Number.isFinite(+z)) { $('#meta').textContent = 'paste features: not an elevation'; return null; }
    placeFlat(model, +z);
  }
  const nm = name || `pasted features ${++_pasteN}`;
  const L = newFeatureLayer(nm, model, { source: 'pasted' });
  $('#meta').textContent = `${nm} — ${model.features.length} feature${model.features.length === 1 ? '' : 's'} pasted${model.warnings.length ? ' · ' + model.warnings.join(' · ') : ''}`;
  return L;
}
export async function pasteFeatures() {
  let text = '';
  try { text = await navigator.clipboard.readText(); }
  catch { $('#meta').textContent = 'paste features: the clipboard can\'t be read here — press Ctrl+V over the view instead'; return null; }
  return pasteFeaturesText(text);
}
// Ctrl+V over the view (not in a field): features in the clipboard → a new layer
addEventListener('paste', (e) => {
  const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
  if (t && t.isContentEditable) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text || !sniffWktCsv(text)) return;
  e.preventDefault();
  pasteFeaturesText(text).catch(() => {});
});

// ── layer menu rows (src/layermenu.js asks) + palette commands ──────────────────────────────
export function polygonMenuItems(L) {
  if (!isPolygonLayer(L)) return { display: [], geometry: [], data: [] };
  const d = featureDocOf(L);
  const textCols = d.header.columns.filter((c, i) => !d.header.numericColumns.some((n) => n.i === i));
  return {
    display: [
      ...(d.header.polygons ? [{ label: (L.polyFill ? '✓ ' : '') + 'Fill polygons', action: () => { setFeatureFill(L, !L.polyFill); markProjectDirty(); } }] : []),
      { label: `Line width… (${S.renderer.layerStickRadius(L.id)} m)`, action: async () => {
        const v = await microPrompt('line half-width (metres)', String(S.renderer.layerStickRadius(L.id)));
        const r = parseFloat(v); if (Number.isFinite(r) && r > 0) { S.renderer.setLayerStickRadius(L.id, r); L.polyRadius = r; markProjectDirty(); requestRender(); }
      } },
      ...(textCols.length ? [{ label: 'Classes by…', submenu: () => textCols.map((c) => ({ label: (d.header.mapping.cat != null && d.header.columns[d.header.mapping.cat] === c ? '✓ ' : '') + c, action: () => { setFeatureCategory(L, c); L.colorSel = 'cat'; setColorLabels(featureDocOf(L).header); if (L.id === S.activeId) { const cb = $('#colorBy'); if ([...cb.options].some((o) => o.value === 'cat')) cb.value = 'cat'; } markProjectDirty(); requestRender(); } })) }] : []),
    ],
    geometry: [
      { label: 'Edit vertices', action: () => armEditVertices(L) },
      { label: 'Draw polygon into this layer', action: () => armDraw({ into: L, closed: true }) },
      { label: 'Set elevation…', action: () => setFeatureElevation(L) },
      ...(d.header.polygons ? [{ label: 'Extrude polygons to a solid…', action: () => { const c = COMMANDS.find((x) => x.id === 'extrude'); if (c) c.run({ ...commandCtx(), L }); } }] : []),
    ],
    data: [
      { label: 'Export features…', action: () => exportFeatures(L) },
      { label: 'Copy features (WKT, for QGIS)', action: () => copyFeatures(L) },
    ],
  };
}

registerCommands([
  { id: 'poly-export', group: 'File', title: 'Export features…', kw: 'polygons strings lines wkt csv geojson shapefile shp dxf qgis export save attributes', when: (c) => isPolygonLayer(c.L), run: (c) => exportFeatures(c.L) },
  { id: 'poly-copy', group: 'Edit', title: 'Copy features (WKT, for QGIS)', kw: 'clipboard qgis wkt copy polygons strings features selection', when: (c) => isPolygonLayer(c.L), run: (c) => copyFeatures(c.L) },
  { id: 'poly-paste', group: 'Edit', title: 'Paste features (WKT from QGIS)', kw: 'clipboard qgis wkt paste polygons strings features new layer', run: () => pasteFeatures() },
  { id: 'poly-fill', group: 'View', title: 'Fill polygons (toggle)', kw: 'polygon fill area shade solid triangulate', when: (c) => isPolygonLayer(c.L) && featureDocOf(c.L).header.polygons > 0, run: (c) => { setFeatureFill(c.L, !c.L.polyFill); markProjectDirty(); } },
  { id: 'poly-elev', group: 'Edit', title: 'Set elevation…', kw: 'polygon strings z elevation bench flatten 2d', when: (c) => isPolygonLayer(c.L), run: (c) => setFeatureElevation(c.L) },
]);
contributeMenu('file', () => [{ label: 'Paste features (WKT from QGIS)', action: () => pasteFeatures() }]);

try { window._microPolyUi = { installFeatureModel, openFeaturesBlob, editFeatures, newFeatureLayer, exportFeatures, copyFeaturesText, pasteFeaturesText, setFeatureElevation }; } catch { /* headless */ }
