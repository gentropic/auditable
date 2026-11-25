// micro — grid export: one dialog, seven formats. ESRI ASCII (.asc), Surfer 7
// binary, Surfer 6 binary and Surfer 6 ASCII (.grd), ESRI binary float (.flt + .hdr,
// zipped with the provenance), GeoTIFF float32 (@gcu/gtiff's writer — deflate on the
// platform's CompressionStream, so still WASM-free) and XYZ / CSV of nodes.
//
// What leaves is always the FULL-RESOLUTION grid of the chosen band, never the
// display (a big GeoTIFF shows an overview or a decimation; the deep review once
// caught an export writing that instead, and band 0 whatever band was picked).
// buildGridExport is the one producer — the dialog's Export button, exportGrid and
// the smokes all call it; deliverBlob (hostio.js) is the one door out.
import { gridFromGTiff, writeGeoTiff } from '../../../ext/gtiff/index.js';
import { createZipStreamWriter } from '../../../ext/archive/src/zipstream.js';
import {
  esriAscParts, surferAsciiParts, writeSurferGrd, writeSurfer7Grd, writeEsriFlt, gridXyzParts,
  gridBlankTest, defaultNodata,
} from './grid-io.js';
import { mkLineage } from './lineage.js';
import { deliverBlob } from './hostio.js';
import { fmtSize } from './paths.js';
import { S } from './state.js';
import { resampleAxisAligned, gridWorldBbox4 } from './grid-ops.js';
import { gridAffine, worldFileText, zOnlyP } from './placement-core.js';
const $ = (s) => document.querySelector(s);

// id · label · extension · which options apply
export const GRID_EXPORT_FMTS = [
  { id: 'asc', label: 'ESRI ASCII grid (.asc)', ext: 'asc', nodata: true, decimals: true },
  { id: 'tif', label: 'GeoTIFF, float32 (.tif)', ext: 'tif', nodata: true },
  { id: 'grd7', label: 'Surfer 7 binary (.grd)', ext: 'grd' },
  { id: 'grd6', label: 'Surfer 6 binary (.grd)', ext: 'grd' },
  { id: 'dsaa', label: 'Surfer 6 ASCII, DSAA (.grd)', ext: 'grd', decimals: true },
  { id: 'flt', label: 'ESRI binary float (.flt + .hdr, zipped)', ext: 'zip', nodata: true },
  { id: 'xyz', label: 'XYZ / CSV of nodes', ext: 'csv', nodata: true, decimals: true },
];
const fmtOf = (id) => GRID_EXPORT_FMTS.find((f) => f.id === id) || GRID_EXPORT_FMTS[0];
const XYZ_DELIMS = { ',': 'csv', '\t': 'txt', ' ': 'xyz' };

const baseOf = (L) => (L.label || L.name).replace(/\.[^.]+$/, '');
export const gridBandsOf = (L) => { const gd = L && L.docs && L.docs.gridDoc; return (gd && gd.grid && gd.grid.bands) || 1; };
export const gridBandOf = (L) => { const gd = L && L.docs && L.docs.gridDoc; return (gd && gd.source && gd.source.band) || (gd && gd.grid && gd.grid.band) || 0; };

// the CRS a GeoTIFF may state: the grid's own (a GeoTIFF source's EPSG), else the
// project frame's — and only when it is an EPSG code. Never invented.
export function gridExportCrs(L) {
  const gd = L && L.docs && L.docs.gridDoc;
  const c = (gd && gd.grid && gd.grid.crs) || (S.frame && S.frame.crs) || null;
  return c && /^\s*EPSG\s*:\s*\d+\s*$/i.test(String(c)) ? String(c).replace(/\s+/g, '').toUpperCase() : null;
}

// the full-resolution grid of `band`. The display grid IS full res only when the
// layer says so AND it is the band asked for; otherwise the source is decoded again.
export async function gridForExport(L, band = gridBandOf(L)) {
  const gd = L.docs.gridDoc;
  if (!gd) throw new Error(`${L.label || L.name} is not a grid`);
  const src = gd.source && gd.source.g;
  if (!src || (gd.fullRes && band === gridBandOf(L))) return gd.grid;
  $('#meta').textContent = `${L.label || L.name} — reading full resolution${gridBandsOf(L) > 1 ? ` (band ${band + 1})` : ''} for export…`;
  const g = await gridFromGTiff(src, 0, band);
  if (g.x0 == null) { g.x0 = g.dx / 2; g.y0 = g.ny * g.dy - g.dy / 2; }   // an un-georeferenced TIFF: the same pixel frame the display uses
  g.crs = g.crs || gd.grid.crs || null;
  if (gd.grid.place) g.place = gd.grid.place;              // a rotated / placed grid: the same frame as the display (src/open-grid.js)
  return g;
}

const parseNodata = (s) => {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  const v = +t;
  if (!Number.isFinite(v)) throw new Error(`nodata “${t}” is not a number`);
  return v;
};

async function zipOf(members) {
  const chunks = [];
  const w = createZipStreamWriter({ write: (b) => { chunks.push(b.slice()); } });
  for (const [name, data] of members) await w.add(name, data, { aligned: false, mtime: Date.now() });
  await w.finish();
  return new Blob(chunks, { type: 'application/zip' });
}

/**
 * buildGridExport(L, opts) → { blob, name, grid, notes, format, rows? }
 *   format     'asc' | 'tif' | 'grd7' | 'grd6' | 'dsaa' | 'flt' | 'xyz'
 *   band       0-based band (default: the layer's picked band)
 *   nodata     number | 'nan' | '' (default: the grid's own if ordinary, else -9999)
 *   decimals   text formats: null = float32-exact (default), or 0–12
 *   name       the file name (default: the layer's, with the format's extension)
 *   xyz:  delim ',' | '\t' | ' ' · header (true) · valueName ('z') · skipEmpty (true)
 *   tif:  compression 'deflate' | 'none' · predictor 3 | 1 · layout 'strips' | 'tiles'
 */
export async function buildGridExport(L, opts = {}) {
  const f = fmtOf(opts.format);
  const band = opts.band != null ? opts.band | 0 : gridBandOf(L);
  let g = await gridForExport(L, band);
  const notes = [];
  // A ROTATED (or placed) grid: GeoTIFF says it (ModelTransformation, plus a world file beside it)
  // and XYZ writes every node where it is; ESRI ASCII / binary float and Surfer have no rotation
  // terms, so they REFUSE it with the reason — or, asked (opts.resample), take an axis-aligned
  // resample over its world extent at the same cell, and say so.
  let worldFile = null;
  if (g.place) {
    if (!zOnlyP(g.place)) throw new Error(`${L.label || L.name} is tilted out of the horizontal — no grid format holds a tilted sheet; drop the tilt to export it`);
    const scaled = Math.abs(g.place.s - 1) > 1e-12 || Math.abs(g.place.t[2]) > 1e-12;
    if (f.id === 'tif' || f.id === 'xyz') {
      if (scaled) { const d = new Float32Array(g.data.length), bad = gridBlankTest(g); for (let i = 0; i < d.length; i++) d[i] = bad(g.data[i]) ? g.data[i] : g.place.t[2] + g.place.s * g.data[i]; g = { ...g, data: d }; notes.push('values written as placed (z = t_z + s·value)'); }
    } else if (opts.resample) {
      g = resampleAxisAligned(g, { nodata: defaultNodata(g) });
      notes.push(`resampled to an axis-aligned ${g.nx}×${g.ny} lattice at ${+g.dx.toPrecision(6)} (bilinear) — ${f.label.replace(/ \(.*$/, '')} has no rotation terms`);
    } else throw new Error(`${f.label} has no rotation terms and ${L.label || L.name} is rotated — export it as GeoTIFF (it carries the rotation, plus a world file) or XYZ, or tick "resample to axis-aligned"`);
  }
  const nd = f.nodata ? (parseNodata(opts.nodata) ?? defaultNodata(g)) : null;
  const decimals = opts.decimals === undefined ? null : opts.decimals;
  const square = Math.abs(g.dx - g.dy) <= Math.abs(g.dx) * 1e-9;
  if (!square && (f.id === 'asc' || f.id === 'flt')) notes.push(`cells are ${g.dx}×${g.dy}: written with GDAL's ${f.id === 'asc' ? 'dx/dy' : 'xdim/ydim'} (ArcGIS proper reads square cells only)`);
  if (nd != null && !Number.isNaN(nd)) {                    // a real value equal to the nodata would read back as empty
    const bad = gridBlankTest(g);
    let clash = 0;
    for (let i = 0; i < g.nx * g.ny; i++) { const v = g.data[i]; if (!bad(v) && v === Math.fround(nd)) clash++; }
    if (clash) notes.push(`${clash.toLocaleString()} cell${clash === 1 ? '' : 's'} hold the value ${nd} and will read back as empty — pick another nodata`);
  }
  const lineage = mkLineage('export.grid', {
    format: f.id, band, ...(f.nodata ? { nodata: Number.isNaN(nd) ? 'nan' : nd } : {}), nx: g.nx, ny: g.ny,
    ...(f.id === 'tif' ? { compression: opts.compression || 'deflate' } : {}),
  }, [L.lineage]);
  const ext = f.id === 'xyz' ? (XYZ_DELIMS[opts.delim || ','] || 'csv') : f.ext;
  let name = (opts.name || '').trim() || `${baseOf(L)}.${ext}`;
  name = name.replace(/[\\/]/g, '_');
  let blob, rows;
  switch (f.id) {
    case 'asc': blob = new Blob(esriAscParts(g, { nodata: nd, decimals }), { type: 'text/plain' }); break;
    case 'dsaa': blob = new Blob(surferAsciiParts(g, { decimals }), { type: 'text/plain' }); break;
    case 'grd6': blob = new Blob([writeSurferGrd(g)], { type: 'application/octet-stream' }); break;
    case 'grd7': blob = new Blob([writeSurfer7Grd(g)], { type: 'application/octet-stream' }); break;
    case 'xyz': {
      const parts = gridXyzParts(g.place ? { ...g, place: g.place } : g, { delim: opts.delim || ',', header: opts.header !== false, names: ['x', 'y', (opts.valueName || 'z').trim() || 'z'], skipEmpty: opts.skipEmpty !== false, nodata: nd, decimals });
      rows = parts.rows;
      blob = new Blob(parts, { type: opts.delim === ',' || !opts.delim ? 'text/csv' : 'text/plain' });
      break;
    }
    case 'flt': {
      const base = name.replace(/\.(zip|flt|hdr)$/i, '');
      if (!/\.zip$/i.test(name)) name = base + '.zip';
      const { flt, hdr } = writeEsriFlt(g, { nodata: nd });
      blob = await zipOf([[`${base}.flt`, new Uint8Array(flt)], [`${base}.hdr`, hdr], [`${base}.lineage.json`, JSON.stringify(lineage, null, 1)]]);
      break;
    }
    case 'tif': {
      const crs = gridExportCrs(L) || (g.crs && /^EPSG:\d+$/i.test(g.crs) ? g.crs : null);
      if (g.place) { worldFile = worldFileText(g); notes.push('rotated: written as a GeoTIFF ModelTransformation; the world file (.tfw) rides beside it'); }
      const bytes = await writeGeoTiff(g, {
        ...(g.place ? { transform: gridAffine(g) } : {}),
        compression: opts.compression === 'none' ? 'none' : 'deflate', predictor: opts.predictor === 1 ? 1 : 3,
        layout: opts.layout === 'tiles' ? 'tiles' : 'strips', tileSize: 256, nodata: nd, crs,
        description: JSON.stringify({ micro: { lineage } }), software: `micro ${S.build || ''}`.trim(),
      });
      if (!bytes.info.geoKeys) notes.push('no CRS written — the layer carries no EPSG code (the coordinates are kept; set the CRS in your GIS)');
      blob = new Blob([bytes], { type: 'image/tiff' });
      break;
    }
  }
  return { blob, name, grid: g, notes, format: f.id, rows, lineage, worldFile, worldFileName: worldFile ? name.replace(/\.tiff?$/i, '') + '.tfw' : null };
}

// a grid made in the session (a resample, a cut / fill, a gridded cloud) → the file its layer opens
// from: ESRI ASCII when axis-aligned, a GeoTIFF with its ModelTransformation when it is rotated (the
// rotation rides in the file, so the layer reopens rotated — ASCII would drop it)
export async function gridLayerFile(grid, name) {
  const base = String(name).replace(/\.(asc|tif|tiff)$/i, '');
  if (!grid.place) return { blob: new Blob([esriAscParts(grid, {}).join('')], { type: 'text/plain' }), name: `${base}.asc` };
  const bytes = await writeGeoTiff(grid, { transform: gridAffine(grid), nodata: defaultNodata(grid), compression: 'deflate' });
  return { blob: new Blob([bytes], { type: 'image/tiff' }), name: `${base}.tif` };
}

// build + deliver + say what was written
export async function exportGrid(L, opts = {}) {
  const r = await buildGridExport(L, opts);
  deliverBlob(r.blob, r.name);
  if (r.worldFile) deliverBlob(new Blob([r.worldFile], { type: 'text/plain' }), r.worldFileName);   // the rotation also as a world file
  $('#meta').textContent = `exported ${r.name} (${r.grid.nx}×${r.grid.ny})${r.notes.length ? ' · ' + r.notes.join(' · ') : ''}`;
  return r;
}

// the old single-format door (kept for hosts and the smokes): ESRI ASCII, 3 decimals
export const exportGridAsc = (L) => exportGrid(L, { format: 'asc', decimals: 3 });

// ── the dialog ───────────────────────────────────────────────────────────
let _lastFmt = 'asc';
export function openGridExportDialog(L) {
  const gd = L && L.docs && L.docs.gridDoc;
  if (!gd) return;
  const g0 = gd.grid, src = gd.source && gd.source.g;
  const fullNx = src ? src.images[0].width : g0.nx, fullNy = src ? src.images[0].height : g0.ny;
  const body = $('#geDlgBody'); body.textContent = '';
  const head = document.createElement('div'); head.className = 'ge-list';
  head.textContent = `${L.label || L.name} — ${fullNx.toLocaleString()}×${fullNy.toLocaleString()} nodes`;
  const grid = document.createElement('div'); grid.className = 'ge-grid';
  const rows = {};
  const field = (key, label, el) => { const l = document.createElement('label'); l.textContent = label; grid.append(l, el); rows[key] = [l, el]; return el; };
  const sel = (opts) => { const s = document.createElement('select'); for (const [v, t] of opts) s.append(Object.assign(document.createElement('option'), { value: v, textContent: t })); return s; };
  const fmt = field('format', 'format', sel(GRID_EXPORT_FMTS.map((f) => [f.id, f.label])));
  fmt.value = _lastFmt;
  const nb = gridBandsOf(L);
  const band = field('band', 'band', sel(Array.from({ length: nb }, (_, i) => [String(i), `band ${i + 1}${i === gridBandOf(L) ? ' (shown)' : ''}`])));
  band.value = String(gridBandOf(L));
  const nodata = field('nodata', 'nodata', Object.assign(document.createElement('input'), { type: 'text', spellcheck: false, value: String(defaultNodata(g0)), title: 'the value an empty cell is written as (nan allowed for binary formats)' }));
  // "exact" (blank) = float32-exact, shortest; or a whole number of digits, 0–12 (what the tool takes)
  const dec = field('decimals', 'decimals', Object.assign(document.createElement('input'), { type: 'text', spellcheck: false, value: 'exact', placeholder: 'exact or 0–12', title: 'digits after the point, a whole number 0–12 — or exact: the shortest text that reads back the same float32' }));
  dec.dataset.decimals = '1';
  const decOf = () => { const t = dec.value.trim().toLowerCase(); if (t === '' || t === 'exact') return null; return /^\d+$/.test(t) && +t <= 12 ? +t : NaN; };
  dec.oninput = () => dec.classList.toggle('bad-in', Number.isNaN(decOf()));
  const delim = field('delim', 'delimiter', sel([[',', 'comma (.csv)'], ['\t', 'tab (.txt)'], [' ', 'space (.xyz)']]));
  const vname = field('vname', 'value column', Object.assign(document.createElement('input'), { type: 'text', spellcheck: false, value: 'z' }));
  const comp = field('comp', 'compression', sel([['deflate3', 'deflate + predictor 3 (smallest)'], ['deflate', 'deflate'], ['none', 'none']]));
  const layout = field('layout', 'layout', sel([['strips', 'strips'], ['tiles', 'tiles 256×256']]));
  const nameIn = field('name', 'file', Object.assign(document.createElement('input'), { type: 'text', spellcheck: false }));
  const checks = document.createElement('div'); checks.className = 'ge-checks';
  const cb = (label, on) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = on; l.append(c, ' ' + label + '  '); checks.append(l); return c; };
  const header = cb('header row', true), skip = cb('skip empty nodes', true);
  const rotChecks = document.createElement('div'); rotChecks.className = 'ge-checks';
  const rs = document.createElement('label'), resample = document.createElement('input'); resample.type = 'checkbox'; resample.dataset.geResample = '1';
  rs.append(resample, ' resample to axis-aligned (bilinear) — the format has no rotation terms'); rotChecks.append(rs);
  const note = document.createElement('div'); note.className = 'ge-note';
  const crs = gridExportCrs(L);
  const extOf = () => (fmt.value === 'xyz' ? XYZ_DELIMS[delim.value] : fmtOf(fmt.value).ext);
  const sync = () => {
    const f = fmtOf(fmt.value);
    const show = (k, on) => { for (const el of rows[k]) el.style.display = on ? '' : 'none'; };
    show('band', nb > 1); show('nodata', !!f.nodata); show('decimals', !!f.decimals);
    show('delim', f.id === 'xyz'); show('vname', f.id === 'xyz'); show('comp', f.id === 'tif'); show('layout', f.id === 'tif');
    checks.style.display = f.id === 'xyz' ? '' : 'none';
    rotChecks.style.display = g0.place && f.id !== 'tif' && f.id !== 'xyz' ? '' : 'none';
    if (!nameIn.dataset.touched) nameIn.value = `${baseOf(L)}.${extOf()}`;
    else nameIn.value = nameIn.value.replace(/\.[^.]+$/, '') + '.' + extOf();
    const msg = ['the full-resolution grid' + (nb > 1 ? ' of the chosen band' : '') + (src && !gd.fullRes ? ' (not the thinned display)' : '') + ', world coordinates.'];
    if (f.id === 'grd6' && (fullNx > 32767 || fullNy > 32767)) msg.push('too big for Surfer 6 (32767 rows/columns at most) — use Surfer 7.');
    if (f.id.startsWith('grd') || f.id === 'dsaa') msg.push('Surfer blanks empty nodes with 1.70141e38 (the format’s own).');
    if (f.id === 'tif') msg.push(crs ? `CRS ${crs} written as GeoKeys; provenance in the ImageDescription.` : 'no CRS is known for this layer, so none is written (the coordinates are; set the CRS in your GIS). Provenance in the ImageDescription.');
    if (f.id === 'flt') msg.push('one .zip holding the .flt, its .hdr and the provenance (.lineage.json).');
    if (f.id === 'xyz') msg.push('one row per node, north row first; x and y at the node.');
    if ((f.id === 'asc' || f.id === 'flt') && Math.abs(g0.dx - g0.dy) > Math.abs(g0.dx) * 1e-9) msg.push('cells are not square: written in GDAL’s non-square form.');
    if (g0.place) msg.push(f.id === 'tif' ? 'ROTATED: written as a ModelTransformation, with a .tfw world file beside it.' : f.id === 'xyz' ? 'ROTATED: every node at its true x, y.' : 'ROTATED: this format has no rotation terms — it refuses the grid unless you tick “resample to axis-aligned”.');
    note.textContent = msg.join(' ');
  };
  nameIn.oninput = () => { nameIn.dataset.touched = '1'; };
  fmt.oninput = delim.oninput = sync;
  sync();
  body.append(head, grid, checks, rotChecks, note);
  const msg = $('#geDlgMsg'); msg.textContent = '';
  const close = () => { $('#geDlg').classList.remove('show'); $('#geGo').onclick = $('#geNot').onclick = $('#geCancel').onclick = null; };
  $('#geGo').onclick = async () => {
    if (fmtOf(fmt.value).decimals && Number.isNaN(decOf())) { dec.classList.add('bad-in'); msg.textContent = `decimals “${dec.value.trim()}”: exact, or a whole number 0–12`; return; }
    _lastFmt = fmt.value;
    const opts = {
      format: fmt.value, band: +band.value, nodata: nodata.value, name: nameIn.value,
      decimals: Number.isNaN(decOf()) ? null : decOf(),
      delim: delim.value, valueName: vname.value, header: header.checked, skipEmpty: skip.checked,
      compression: comp.value === 'none' ? 'none' : 'deflate', predictor: comp.value === 'deflate3' ? 3 : 1, layout: layout.value,
      resample: resample.checked,
    };
    $('#geGo').disabled = true; msg.textContent = 'writing…';
    try {
      const r = await exportGrid(L, opts);
      close();
      $('#meta').textContent += ` — ${fmtSize(r.blob.size)}`;
    } catch (e) { msg.textContent = `export failed: ${e.message || e}`; }
    finally { $('#geGo').disabled = false; }
  };
  $('#geNot').onclick = close; $('#geCancel').onclick = close;
  $('#geDlg').classList.add('show');
}
