// micro — the host-API INGEST: addLayer(spec). A host page hands micro typed columns (or a
// file) with stated roles; nothing is sniffed. Columns are written ONCE into micro's own
// formats (Parquet with a micro:model footer, PLY, RFC 4180 CSV) and opened through the
// ordinary openers with explicit roles, so an ingested layer IS a file-backed layer and
// there is no second code path. A file source is opened in place, never copied.
import { microModelOf, mkLineage } from './lineage.js';
import { _fileHandles, layerById } from './state.js';
import { addPaintColorOptions } from './paint.js';
import { parquetInfoAsync, writeParquet } from '../../../ext/parquet/index.js';
import { DIM_PALETTE_MAX, axisDistinct, coordNum, gridFromBasis, inferAxis, inferSubBlockLattice, latticeMisfit, makeDimKeyer, peekDmColumns, sniffDelimited } from '../../../ext/condenser/src/main.js';
import { openBlob, openDrillholeLayer } from './open.js';
import { colorHeaderOf, colorSelFor, setLayerColorBy, setLayerColorRange, setLayerPalette } from './color.js';
import { fileLayersInGroup } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { writePlyMeshBytes } from './meshexport.js';
import { removeLayerUI } from './layers.js';
const $ = (s) => document.querySelector(s);

// ── the HOST front door: _micro.addLayer(spec) ────────────────────────────────
// A host page that already knows what its data IS hands micro typed columns and
// their roles; nothing is sniffed. The columns are written once into micro's
// OWN formats — a block model or point set as Parquet (with a `micro:model`
// footer stating the lattice, so no discovery runs), a mesh as binary PLY, a
// drillhole trio or a table as RFC-4180 CSV — and opened with every role passed
// explicitly. So the layer IS a file-backed layer: pick, colour-by, filters,
// stats, GT, swath, sections, export and project save all work on it exactly
// as on a file, with no second code path to drift. The bytes are held in
// memory as a File; saving the project writes them into it like any source.
//
// Resolves to the layer id once the layer is complete; rejects with the error
// micro would otherwise show (it is still shown in #meta). Contract and
// examples: docs/index.html (#host-api).
export const INGEST_KINDS = ['blocks', 'points', 'mesh', 'drillholes', 'table'];

export async function addLayer(spec = {}) {
  const kind = spec.kind;
  try {
    if (!INGEST_KINDS.includes(kind)) throw new Error(`addLayer: kind must be one of ${INGEST_KINDS.join(' | ')} (got ${JSON.stringify(kind)})`);
    // roles.categories: several text columns offered in the colour-by list. With no
    // roles.category, the first of them opens as the category (no re-read later).
    const R0 = kind === 'drillholes' ? spec.intervals && spec.intervals.roles : spec.roles;
    const cats = R0 && R0.categories != null ? [].concat(R0.categories).map(String) : null;
    if (cats && !cats.length) throw new Error('addLayer: roles.categories is empty');
    if (cats && R0.category == null) {
      const R1 = { ...R0, category: cats[0] };
      spec = kind === 'drillholes' ? { ...spec, intervals: { ...spec.intervals, roles: R1 } } : { ...spec, roles: R1 };
    }
    const roles = (kind === 'drillholes' ? spec.intervals && spec.intervals.roles : spec.roles) || {};
    const name = String(spec.name || kind);
    const lineage = mkLineage('ingest', { kind, roles: spec.roles || null, lattice: spec.lattice ? 'declared' : undefined, by: 'host' }, []);
    let lid;
    if (spec.file) lid = await ingestFileLayer(spec, name, lineage);
    else if (kind === 'blocks' || kind === 'points') lid = await ingestColumnsLayer(spec, name, lineage);
    else if (kind === 'mesh') lid = await ingestMeshLayer(spec, name, lineage);
    else if (kind === 'drillholes') lid = await ingestDrillholes(spec, name, lineage);
    else lid = await ingestTable(spec, name, lineage);
    let L = layerById(lid);
    if (L) {
      L.label = name;
      if (cats) {
        const h = colorHeaderOf(L), have = h ? h.columns : [];
        const bad = cats.filter((c) => !have.includes(c));
        if (bad.length) { removeLayerUI(L.id); throw new Error(`addLayer: roles.categories names ${bad.map((c) => JSON.stringify(c)).join(', ')}, not ${bad.length > 1 ? 'columns' : 'a column'} of the layer (it has ${have.join(', ')})`); }
        L.catChoices = cats;
        addPaintColorOptions(L);
      }
      if (spec.group) fileLayersInGroup(spec.group, [L.id]);
      // the host named the column it cares about: start coloured by it (category,
      // else value), not by elevation. spec.colorBy overrides.
      const want = spec.colorBy != null ? spec.colorBy : roles.category != null ? roles.category : roles.value != null ? roles.value : null;
      if (want != null) {
        try { lid = await setLayerColorBy(L, colorSelFor(L, want)); }
        catch (e) { if (spec.colorBy != null) { removeLayerUI(L.id); throw e; } }   // a stated colorBy is checked; the role default is best-effort
        L = layerById(lid);
      }
      // the colour scale, after the colour-by it belongs to: a stated one is checked
      if (L && (spec.palette != null || spec.colorRange !== undefined)) {
        try {
          if (spec.palette != null) setLayerPalette(L, spec.palette);
          if (spec.colorRange !== undefined) setLayerColorRange(L, spec.colorRange);
        } catch (e) { removeLayerUI(L.id); throw e; }
      }
      renderLayers();
    }
    return lid;
  } catch (e) {
    // errors raised BEFORE a layer existed never reached openBlob's handler
    if (!e._micro) { $('#meta').textContent = `${spec.name || kind || 'addLayer'} — ${e.message}`; dispatchEvent(new CustomEvent('micro:layer-failed', { detail: { name: spec.name || kind, error: e.message } })); }
    throw e;
  }
}

// ── addLayer with a FILE: the big-data door ───────────────────────────────────
// spec.file = a File / Blob or a FileSystemFileHandle. Nothing is copied: the
// file opens IN PLACE (never resident — Parquet, CSV and .dm stream from it)
// with the stated roles resolved by NAME against its header. A handle is
// remembered, so project save and "reload from disk" use the real file.
// Duck-typed on purpose: a host frame's File is not `instanceof File` here.
export const isBlobLike = (b) => !!b && typeof b === 'object' && typeof b.slice === 'function' && typeof b.size === 'number';

export async function ingestSource(src, what = 'file') {
  let file = src, handle = null;
  if (src && typeof src.getFile === 'function' && !isBlobLike(src)) { handle = src; file = await src.getFile(); }
  if (!isBlobLike(file)) throw new Error(`addLayer: ${what} must be a File, a Blob or a FileSystemFileHandle`);
  if (handle) _fileHandles.set(file, handle);
  return file;
}

export const extOf = (n) => ((String(n || '').match(/\.([^./\\]+)$/) || [])[1] || '').toLowerCase();

// the column names a file's header states (delimited, Parquet, .dm)
export async function fileColumnNames(file, ext) {
  if (ext === 'parquet' || ext === 'pq') return (await parquetInfoAsync(file)).columns.map((c) => c.name);
  if (ext === 'dm') { const n = await peekDmColumns(file); if (!n) throw new Error('addLayer: not a readable .dm file'); return n; }
  const sn = sniffDelimited(await file.slice(0, 64 * 1024).text());
  if (!sn.header) throw new Error('addLayer: the file has no header row, so roles can\'t be stated by name');
  return sn.header.map((h) => String(h).trim());
}

export function roleIndex(names, roles, key, required, what = 'roles') {
  const nm = roles && roles[key];
  if (nm == null) { if (required) throw new Error(`addLayer: ${what}.${key} is required`); return null; }
  const i = names.indexOf(nm);
  if (i < 0) throw new Error(`addLayer: ${what}.${key} names “${nm}”, which is not a column of the file (${names.slice(0, 30).join(', ')}${names.length > 30 ? ', …' : ''})`);
  return i;
}

export async function ingestFileLayer(spec, name, lineage) {
  const kind = spec.kind;
  if (kind === 'drillholes') return ingestDrillholes(spec, name, lineage);
  const file = await ingestSource(spec.file);
  const ext = (spec.format || extOf(file.name) || '').toLowerCase().replace(/^\./, '');
  if (!ext) throw new Error('addLayer: the file has no extension — say what it is with spec.format (e.g. "parquet", "csv", "dm")');
  // the name micro opens it under keeps the format's extension (dispatch + project save)
  const openName = extOf(file.name) === ext ? file.name : `${name.replace(/\.[^.]+$/, '')}.${ext}`;
  lineage.params.file = file.name || openName;
  if (kind === 'mesh') {
    if (!/^(ply|obj|msh|lfm|wfr|dxf)$/.test(ext)) throw new Error(`addLayer: a mesh file must be .ply .obj .msh .lfm .wfr or .dxf (got .${ext})`);
    return openBlob(file, openName, 'add', null, { asKind: 'mesh', lineage, throw: true, tint: spec.tint, opacity: spec.opacity });
  }
  if (kind === 'table') {
    if (!/^(csv|txt|tsv|dat|xlsx)$/.test(ext)) throw new Error(`addLayer: a table file must be delimited text or .xlsx (got .${ext})`);
    return openBlob(file, openName, 'add', null, { asKind: 'table', lineage, throw: true });
  }
  // blocks / points
  if (!/^(csv|txt|tsv|dat|parquet|pq|dm)$/.test(ext)) throw new Error(`addLayer: a ${kind} file must be .csv/.txt/.tsv/.dat, .parquet or .dm (got .${ext})`);
  const names = await fileColumnNames(file, ext);
  const roles = spec.roles || {};
  const mapping = {
    x: roleIndex(names, roles, 'x', true), y: roleIndex(names, roles, 'y', true), z: roleIndex(names, roles, 'z', true),
    chan: roleIndex(names, roles, 'value', false), cat: roleIndex(names, roles, 'category', false),
  };
  const pq = ext === 'parquet' || ext === 'pq', dm = ext === 'dm';
  if (mapping.cat == null && !pq) mapping.cat = -1;             // stated: no category (Parquet says it with strictMapping)
  let dimCols = null;
  if (spec.sizes) {
    if (kind !== 'blocks') throw new Error('addLayer: sizes are for kind "blocks"');
    if (spec.lattice) throw new Error('addLayer: give sizes OR a lattice — a declared SUB-BLOCK lattice isn\'t supported yet (the fine lattice is measured from the sizes)');
    const sz = spec.sizes, d = {};
    for (const [k, def] of [['x', 'dx'], ['y', 'dy'], ['z', 'dz']]) {
      const v = sz[def] != null ? sz[def] : sz[k];
      if (typeof v !== 'string') throw new Error(`addLayer: with a file, sizes.${def} must name a column`);
      d[k] = roleIndex(names, { [def]: v }, def, true, 'sizes');
    }
    if (dm && ['XINC', 'YINC', 'ZINC'].some((nm, a) => names[d['xyz'[a]]] !== nm)) throw new Error('addLayer: a .dm file\'s sub-block sizes are its XINC/YINC/ZINC fields');
    dimCols = d;
  }
  let lattice = null;
  if (spec.lattice && kind === 'blocks') {
    if (dm) throw new Error('addLayer: a .dm file states its own lattice (its prototype fields) — a declared lattice is for CSV and Parquet');
    lattice = normalizeLattice(spec.lattice);
  }
  return openBlob(file, openName, 'add', null, {
    asKind: kind === 'points' ? 'points' : 'blocks', mapping, strictMapping: true, dimCols,
    lattice, declaredBy: 'host', acceptLattice: spec.acceptLattice, lineage, throw: true,
  });
}

// one column → { type, data, labels? }: the Parquet physical type, the values,
// and (for a pre-coded category) the code → label list in the HOST's order
export function ingestColumn(nm, v) {
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v) && !Array.isArray(v) && v.codes) {
    const labels = (v.labels || []).map(String);
    const data = Array.from(v.codes, (c) => (c >= 0 && c < labels.length ? labels[c] : null));
    return { type: 'STRING', data, labels, n: data.length };
  }
  if (ArrayBuffer.isView(v)) {
    const type = v instanceof Float64Array ? 'DOUBLE' : v instanceof Float32Array ? 'FLOAT'
      : (v instanceof Int8Array || v instanceof Int16Array || v instanceof Int32Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray || v instanceof Uint16Array) ? 'INT32'
        : v instanceof BigInt64Array ? 'INT64' : null;
    if (type === null) return { type: 'DOUBLE', data: Float64Array.from(v, Number), n: v.length };   // Uint32 / BigUint64: widen honestly
    return { type, data: v, n: v.length };
  }
  if (Array.isArray(v)) {
    const isNum = v.every((x) => x == null || typeof x === 'number');
    return isNum ? { type: 'DOUBLE', data: v.map((x) => (x == null ? null : x)), n: v.length } : { type: 'STRING', data: v.map((x) => (x == null ? null : String(x))), n: v.length };
  }
  throw new Error(`addLayer: column “${nm}” must be a typed array, an array, or { codes, labels }`);
}

export function ingestTableCols(columns, what = 'columns') {
  if (!columns || typeof columns !== 'object') throw new Error(`addLayer: ${what} must be an object of named columns`);
  const names = Object.keys(columns);
  if (!names.length) throw new Error(`addLayer: ${what} is empty`);
  const cols = {};
  for (const nm of names) cols[nm] = ingestColumn(nm, columns[nm]);
  const n = cols[names[0]].n;
  for (const nm of names) if (cols[nm].n !== n) throw new Error(`addLayer: column “${nm}” has ${cols[nm].n} values, “${names[0]}” has ${n} — every column in ${what} must be one length`);
  if (!n) throw new Error(`addLayer: ${what} has no rows`);
  return { names, cols, n };
}

export function ingestRole(t, roles, key, required, what = 'roles') {
  const nm = roles && roles[key];
  if (nm == null) { if (required) throw new Error(`addLayer: ${what}.${key} is required`); return null; }
  const i = t.names.indexOf(nm);
  if (i < 0) throw new Error(`addLayer: ${what}.${key} names “${nm}”, which is not a column (${t.names.join(', ')})`);
  return i;
}

// a declared lattice → micro's grid. Forms: { x:{origin,pitch,count}, y, z }
// (axis-aligned per axis), { origin:[..], pitch:[..]|size:[..], counts:[..] },
// or the §2 basis { origin, U, V, W, counts, source? } — origin is ALWAYS block
// 0's CENTROID. A rotated basis becomes { x,y,z, rot, anchor } (grid/basis.js).
export function normalizeLattice(lat) {
  if (!lat) return null;
  if (lat.basis) lat = lat.basis;
  if (lat.x && lat.y && lat.z) return { x: { ...lat.x }, y: { ...lat.y }, z: { ...lat.z }, ...(lat.rot ? { rot: lat.rot, anchor: lat.anchor } : {}) };
  if (lat.U && lat.V && lat.W) { try { return gridFromBasis(lat); } catch (e) { throw new Error(`addLayer: ${e.message}`); } }
  const o = lat.origin, p = lat.pitch || lat.size, c = lat.counts || lat.count;
  if (!o || !p || !c || o.length !== 3 || p.length !== 3 || c.length !== 3) throw new Error('addLayer: lattice needs { origin:[x,y,z], pitch:[dx,dy,dz], counts:[nx,ny,nz] } (or per-axis x/y/z, or a U/V/W basis)');
  return { x: { origin: +o[0], pitch: +p[0], count: c[0] | 0 }, y: { origin: +o[1], pitch: +p[1], count: c[1] | 0 }, z: { origin: +o[2], pitch: +p[2], count: c[2] | 0 } };
}

// the honest check for a DECLARED lattice: every centroid sits on a node of it
// (within the gridsCompatible-family tolerance) and inside its counts. A host's
// or file's statement is applied without a confirm — but never against the data.
export function checkDeclaredGrid(grid, X, Y, Z, n) {
  for (const k of ['x', 'y', 'z']) if (!(grid[k].count >= 1) || !(grid[k].pitch > 0 || grid[k].count === 1)) throw new Error(`addLayer: declared lattice axis ${k} needs pitch > 0 and count ≥ 1`);
  for (let i = 0; i < n; i++) {
    const x = coordNum(X[i]), y = coordNum(Y[i]), z = coordNum(Z[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const bad = latticeMisfit(grid, x, y, z, i);
    if (bad) throw new Error(`addLayer: declared lattice rejected — ${bad}`);
  }
}

export async function ingestColumnsLayer(spec, name, lineage) {
  const t = ingestTableCols(spec.columns);
  const roles = spec.roles || {};
  const xi = ingestRole(t, roles, 'x', true), yi = ingestRole(t, roles, 'y', true), zi = ingestRole(t, roles, 'z', true);
  const vi = ingestRole(t, roles, 'value', false), ci = ingestRole(t, roles, 'category', false);
  for (const i of [xi, yi, zi]) if (t.cols[t.names[i]].type === 'STRING') throw new Error(`addLayer: coordinate column “${t.names[i]}” is not numeric`);
  if (vi != null && t.cols[t.names[vi]].type === 'STRING') throw new Error(`addLayer: roles.value “${t.names[vi]}” is not numeric — use roles.category for text`);
  // sub-block sizes: each a column name, an array, or a constant
  let dims = null;
  if (spec.sizes && spec.kind === 'blocks') {
    const sz = spec.sizes, out = {};
    for (const [k, def] of [['x', 'dx'], ['y', 'dy'], ['z', 'dz']]) {
      const v = sz[def] != null ? sz[def] : sz[k];
      if (v == null) throw new Error(`addLayer: sizes.${def} is required with sizes`);
      if (typeof v === 'string') { const i = t.names.indexOf(v); if (i < 0) throw new Error(`addLayer: sizes.${def} names “${v}”, which is not a column`); out[k] = v; continue; }
      let nm = def.toUpperCase(); while (t.names.includes(nm)) nm += '_';
      const col = typeof v === 'number' ? { type: 'DOUBLE', data: new Float64Array(t.n).fill(v), n: t.n } : ingestColumn(nm, v);
      if (col.n !== t.n) throw new Error(`addLayer: sizes.${def} has ${col.n} values, expected ${t.n}`);
      t.names.push(nm); t.cols[nm] = col; out[k] = nm;
    }
    dims = out;
  }
  const X = t.cols[t.names[xi]].data, Y = t.cols[t.names[yi]].data, Z = t.cols[t.names[zi]].data;
  // the model the footer states: bbox, categories (host order), lattice
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.n; i++) {
    const p = [coordNum(X[i]), coordNum(Y[i]), coordNum(Z[i])];
    if (!p.every(Number.isFinite)) continue;
    for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
  }
  if (!Number.isFinite(min[0])) throw new Error('addLayer: no finite coordinates');
  let categories = null;
  if (ci != null) {
    const c = t.cols[t.names[ci]];
    categories = c.labels ? c.labels : [...new Set(c.data.filter((v) => v != null && v !== '').map(String))].sort();
    if (categories.length > 255) categories = null;        // past 255 the code is a u8 — no category colouring, as for a file
  }
  let grid = null, subBlocked = false, dimPalette = null;
  if (spec.kind === 'blocks') {
    if (dims && spec.lattice) throw new Error('addLayer: give sizes OR a lattice — a declared SUB-BLOCK lattice isn\'t supported yet (the fine lattice is measured from the sizes)');
    if (dims) {
      const axc = [axisDistinct(Infinity), axisDistinct(Infinity), axisDistinct(Infinity)], ax = axc.map((c) => c.set), minDim = [Infinity, Infinity, Infinity], keys = new Set(), dimKeyOf = makeDimKeyer();
      const DX = t.cols[dims.x].data, DY = t.cols[dims.y].data, DZ = t.cols[dims.z].data;
      for (let i = 0; i < t.n; i++) {
        axc[0].add(coordNum(X[i])); axc[1].add(coordNum(Y[i])); axc[2].add(coordNum(Z[i]));
        const dx = +DX[i], dy = +DY[i], dz = +DZ[i];
        if (dx > 0 && dy > 0 && dz > 0) { if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz; if (keys.size <= DIM_PALETTE_MAX) keys.add(dimKeyOf(dx, dy, dz)); }
      }
      const sb = inferSubBlockLattice(ax, minDim, keys);
      if (sb) { grid = sb.grid; subBlocked = true; dimPalette = sb.dimPalette; }
      else if (keys.size <= 1 && Number.isFinite(minDim[0])) dims = null;   // one size everywhere: a regular model — fall through
      else throw new Error(`addLayer: sizes given, but the blocks don't sit on a power-of-2 sub-lattice${keys.size > DIM_PALETTE_MAX ? ` (more than ${DIM_PALETTE_MAX} distinct sizes)` : ''} — open as points, or check the sizes`);
    }
    if (!grid && spec.lattice) {
      grid = normalizeLattice(spec.lattice);
      checkDeclaredGrid(grid, X, Y, Z, t.n);
    } else if (!grid) {
      const axc = [axisDistinct(Infinity), axisDistinct(Infinity), axisDistinct(Infinity)], ax = axc.map((c) => c.set);
      for (let i = 0; i < t.n; i++) { const xv = coordNum(X[i]), yv = coordNum(Y[i]), zv = coordNum(Z[i]); if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) { axc[0].add(xv); axc[1].add(yv); axc[2].add(zv); } }
      const axes = ax.map((s) => (s.size < 300000 ? inferAxis([...s].sort((a, b) => a - b)) : null));
      grid = axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;   // null → centroids as points, as for a file
    }
  }
  const header = { grid, bbox: { min, max }, categories, subBlocked, dimPalette, columns: t.names, dimCols: dims ? { x: t.names.indexOf(dims.x), y: t.names.indexOf(dims.y), z: t.names.indexOf(dims.z) } : null, lattice: spec.lattice ? { basis: 'declared', by: 'host' } : null };
  const model = { ...microModelOf(header), declared: spec.lattice ? 'host' : undefined };
  const kv = [
    { key: 'micro:model', value: JSON.stringify(model) },
    { key: 'micro:frame', value: JSON.stringify({ origin: [0, 0, 0], crs: (spec.frame && spec.frame.crs) || null, spatial: false }) },
    { key: 'micro:lineage', value: JSON.stringify(lineage) },
  ];
  const bytes = writeParquet({ columnData: t.names.map((nm) => ({ name: nm, data: t.cols[nm].data, type: t.cols[nm].type })), codec: 'UNCOMPRESSED', rowGroupSize: 1 << 16, kvMetadata: kv });
  const fileName = /\.parquet$/i.test(name) ? name : `${name}.parquet`;
  const file = new File([bytes], fileName, { type: 'application/vnd.apache.parquet' });
  const mapping = { x: xi, y: yi, z: zi, chan: vi, cat: ci };
  return openBlob(file, fileName, 'add', null, { asKind: spec.kind === 'points' ? 'points' : 'blocks', mapping, strictMapping: true, cached: spec.kind === 'points' ? null : model, lineage, throw: true });
}

export async function ingestMeshLayer(spec, name, lineage) {
  const v = spec.vertices, tr = spec.triangles;
  if (!ArrayBuffer.isView(v) || v.length % 3) throw new Error('addLayer: mesh.vertices must be a typed array of x,y,z triples');
  if (!ArrayBuffer.isView(tr) || tr.length % 3) throw new Error('addLayer: mesh.triangles must be a typed array of index triples');
  const nv = v.length / 3;
  for (let i = 0; i < tr.length; i++) if (!(tr[i] >= 0 && tr[i] < nv)) throw new Error(`addLayer: mesh.triangles[${i}] = ${tr[i]} is not a vertex index (${nv} vertices)`);
  const fileName = /\.ply$/i.test(name) ? name : `${name}.ply`;
  const file = new File([writePlyMeshBytes(Float64Array.from(v), Uint32Array.from(tr))], fileName);
  return openBlob(file, fileName, 'add', null, { asKind: 'mesh', lineage, throw: true, tint: spec.tint, opacity: spec.opacity });
}

// columns → RFC 4180 CSV text: a field holding the delimiter, a quote, a line
// break or edge spaces is quoted; NaN / null are empty
export function columnsToCsv(t) {
  const q = (s) => (/[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const out = [t.names.map(q).join(',')];
  for (let i = 0; i < t.n; i++) {
    out.push(t.names.map((nm) => { const v = t.cols[nm].data[i]; if (v == null) return ''; if (typeof v === 'number' && !Number.isFinite(v)) return ''; return q(String(v)); }).join(','));
  }
  return out.join('\n') + '\n';
}

export async function ingestDrillholes(spec, name, lineage) {
  // each table: { columns, roles } (in memory → CSV) or { file, roles } (a
  // delimited File / handle, opened in place) — they may be mixed
  const base = name.replace(/\.(csv|txt)$/i, '');
  const tbl = async (key) => {
    const s = spec[key];
    if (!s || (!s.columns && !s.file)) throw new Error(`addLayer: drillholes.${key} must be { columns, roles } or { file, roles }`);
    if (s.file) {
      const file = await ingestSource(s.file, `drillholes.${key}.file`);
      if (!/^(csv|txt|tsv|dat)$/.test(extOf(file.name) || 'csv')) throw new Error(`addLayer: drillholes.${key}.file must be delimited text`);
      return { names: await fileColumnNames(file, 'csv'), roles: s.roles || {}, file };
    }
    const t = ingestTableCols(s.columns, `${key}.columns`);
    return { names: t.names, roles: s.roles || {}, file: new File([columnsToCsv(t)], `${base}_${key}.csv`, { type: 'text/csv' }) };
  };
  const C = await tbl('collar'), Sv = await tbl('survey'), I = await tbl('intervals');
  const r = (T, key, req, what) => roleIndex(T.names, T.roles, key, req, what);
  const mappings = {
    collar: { bhid: r(C, 'bhid', true, 'collar.roles'), x: r(C, 'x', true, 'collar.roles'), y: r(C, 'y', true, 'collar.roles'), z: r(C, 'z', true, 'collar.roles'), eoh: r(C, 'eoh', false, 'collar.roles') ?? -1 },
    survey: { bhid: r(Sv, 'bhid', true, 'survey.roles'), at: r(Sv, Sv.roles.at != null ? 'at' : 'depth', false, 'survey.roles') ?? -1, az: r(Sv, 'az', true, 'survey.roles'), dip: r(Sv, 'dip', true, 'survey.roles') },
    intervals: { bhid: r(I, 'bhid', true, 'intervals.roles'), from: r(I, 'from', true, 'intervals.roles'), to: r(I, 'to', true, 'intervals.roles') },
  };
  const files = { collar: C.file, survey: Sv.file, intervals: I.file };
  const opts = { mappings, chan: r(I, 'value', false, 'intervals.roles'), cat: r(I, 'category', false, 'intervals.roles') };
  if (opts.chan == null) delete opts.chan;
  if (opts.cat == null) delete opts.cat;
  if (spec.method) opts.method = spec.method;
  if (spec.dipConvention) opts.dipConvention = spec.dipConvention;
  return openDrillholeLayer(files, opts, 'add', { lineage, throw: true });
}

export async function ingestTable(spec, name, lineage) {
  const t = ingestTableCols(spec.columns);
  const fileName = /\.csv$/i.test(name) ? name : `${name}.csv`;
  return openBlob(new File([columnsToCsv(t)], fileName, { type: 'text/csv' }), fileName, 'add', null, { asKind: 'table', lineage, throw: true });
}
