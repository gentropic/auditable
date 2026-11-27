// micro — the GRID readers: GeoTIFF (the finest overview within the display budget,
// or a decimated read), Surfer .grd and ESRI ASCII, each to a grid layer. openBlob
// (src/open.js) dispatches here.
import { readGTiff, pickOverviewForCap, stepForCap, gridDecimatedFromGTiff, gridFromGTiff } from '../../../ext/gtiff/index.js';
import { openGridSource, SURFER_BLANK } from './grid-io.js';
import { S, layerById, requestRender } from './state.js';
import { buildHeightfieldMesh, createChunkBuilder } from '../../../ext/condenser/src/main.js';
import { surfaceColorArray, gridHeightfield } from './surfaces.js';
import { rampCfgOf } from './ramp.js';
import { registerDocs } from './open.js';
import { fitFromHeader, recomputeUnion } from './layers.js';
import { setColorLabels } from './color.js';
import { layerPlacementM, gridPlaceOf } from './placement.js';
import { affineToGridPlace, parseWorldFile, compilePlacement, applyP, placeBbox, fmtLen } from './placement-core.js';
import { gridWorldBbox4 } from './grid-ops.js';
import { boxLocalToWorld } from './coords.js';
const $ = (s) => document.querySelector(s);

// ── grids (§7.1): GeoTIFF / Surfer .grd / ESRI ASCII → ONE gridDoc shape ──
// { nx, ny, data, x0, y0, dx, dy, nodata, crs, form } — row 0 is the NORTH
// row, x0/y0 are SAMPLE CENTERS, dy positive (row r's centre = y0 − r·dy).
// ROTATED rasters (a GeoTIFF ModelTransformation with rotation terms, a world file's B / D
// terms): the nodes stay on the grid's OWN lattice (x0 … in its frame) and grid.filePlace
// (a compiled placement, src/placement-core.js) takes that frame to world; the layer's own
// placement composes on top (grid.place — what every sampler and the display use).
// A shear (non-perpendicular pixel axes) has no rigid form: the nearest rotation is used and
// how far it departs is SAID (grid.placeNote), never silently dropped.
function rasterPlace(g, affine) {
  const img = g.images[0];
  const r = affineToGridPlace(affine, img.width, img.height);
  g.geo.affine = affine; g.geo.origin = [0, 0]; g.geo.scale = [r.dx, r.dy];
  const place = compilePlacement({ tx: r.corner[0], ty: r.corner[1], kappa: r.theta });
  const note = `rotated ${+r.theta.toFixed(4)}°${Math.abs(r.shear) > 1e-9 ? ` · sheared ${+r.shear.toFixed(4)}° — taken as the nearest rotation, off by up to ${fmtLen(r.dev)}` : ''}`;
  return { place, note };
}
export const ascLooksLikeGrid = async (blob) => /^\s*ncols\b/i.test(await blob.slice(0, 64).text());
async function readAnyGrid(blob, name, displayCache = null, band = 0, worldFile = null) {
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
    // a rotated raster — the file's ModelTransformation, or a world file beside it (which wins:
    // it is the one the user handed over) — is read in its own frame, then placed
    let rp = null;
    if (isTiff && worldFile) { try { rp = rasterPlace(g, parseWorldFile(worldFile)); rp.note = `world file · ${rp.note}`; } catch (e) { $('#meta').textContent = `${name} — the world file was not read (${e.message})`; } }
    else if (isTiff && g.geo && g.geo.affine) rp = rasterPlace(g, g.geo.affine);
    if (displayCache && isTiff) {
      // a project display-cache sidecar: reuse the parsed IFDs for windowed
      // eval, but take the DISPLAY straight from the cache (no re-decimation)
      const grid = displayCache;
      grid.crs = grid.crs || g.geo.crs;
      grid.form = `GeoTIFF ${g.images[0].width}×${g.images[0].height} · display cache`;
      grid.band = band; grid.bands = g.images[0].samplesPerPixel;
      grid._src = { g, level: 0, name, step: 2, band };    // step>1 → not fullRes → eval windows; band rides along
      if (rp) { grid.filePlace = rp.place; grid.placeNote = rp.note; }
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
    // the band's name and unit, where the file says them (GDAL_METADATA — what micro, GDAL and QGIS write)
    if (g.geo && g.geo.bandNames && g.geo.bandNames[band]) grid.bandName = g.geo.bandNames[band];
    if (g.geo && g.geo.bandUnits && g.geo.bandUnits[band]) grid.bandUnit = g.geo.bandUnits[band];
    if (rp) { grid.filePlace = rp.place; grid.placeNote = rp.note; grid.form += ` · ${rp.note}`; }
    return grid;
  }
}
// grid → the POINTS pipeline (spec §7.1 v1: heightfield cells as records,
// zero new GL). The FULL grid stays on the layer (L.docs.gridDoc) for the
// surface-flag/ratio evaluation; display decimates by stride to a cap.
const GRID_DISPLAY_CAP = 4_000_000;
export async function openGridBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading grid…`;
  const grid = await readAnyGrid(blob, name, opts.displayCache || null, opts.band || 0, opts.worldFile || null);
  // the effective placement: the file's own rotation, then the layer's (a surface: about Z only)
  grid.place = gridPlaceOf(grid, layerPlacementM(layerById(lid)), { surface: !!opts.surface });
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
  const localBox = { min: [grid.x0, grid.y0 - (ny - 1) * grid.dy, zmin], max: [grid.x0 + (nx - 1) * grid.dx, grid.y0, zmax] };
  const header = { count: shown, bbox: grid.place ? placeBbox(grid.place, localBox) : localBox };
  const gridDoc = { blob, name, grid, stride, source: grid._src || null, level: grid._src ? grid._src.level : 0, fullRes: !grid._src || (grid._src.level === 0 && grid._src.step === 1), worldFile: opts.worldFile || null };
  { const Lg1 = layerById(lid); if (Lg1 && grid.bandName && !Lg1.gridValue) Lg1.gridValue = { name: grid.bandName, ...(grid.bandUnit ? { unit: grid.bandUnit } : {}) }; }   // a named band: a named value
  { const Lg0 = layerById(lid); if (Lg0 && Lg0.lineage) { const pp = { ...(Lg0.lineage.params || {}) }; if (Lg0.placement) pp.placement = Lg0.placement; else delete pp.placement; if (grid.placeNote) pp.rasterRotation = grid.placeNote; Lg0.lineage.params = pp; } }
  // "Show as surface": a grid IS a heightfield — triangulate it into a shaded
  // relief mesh coloured by elevation (§17 heightfield-drape Phase 1), instead of
  // the raw elevation point cloud. gridDoc stays for by-surface eval; per-cell
  // pick is traded for the solid surface (toggle back to points to pick).
  if (opts.surface) {
    const flatZ = opts.flatZ != null ? opts.flatZ : null;
    // the relief is built in the scene's frame — so the FIRST layer plants it before building, as
    // the points path does. Built first, a lone surface's relief stayed in world numbers while the
    // frame was then planted around it: every later layer, section, pick and measure was off by the
    // frame's origin (v0.7.3: a model added to a topography opened as a surface sat ~600 km away)
    if (!S.frame) fitFromHeader(header, false);
    const hf = gridHeightfield(grid, stride, flatZ);
    if (!hf) throw new Error('grid is all nodata');
    const color = surfaceColorArray(hf, opts.drape || null, (rampCfgOf(layerById(lid)) || {}).preset, zmin, zmax);
    registerDocs(lid, 'mesh', { gridDoc });
    const hw = boxLocalToWorld(Array.from(hf.bboxLocal));
    fitFromHeader({ ...header, bbox: { min: hw.slice(0, 3), max: hw.slice(3, 6) } }, opts.first !== false);
    const smooth = opts.smooth !== false;
    S.renderer.setLayerMeshStyle(lid, { tint: [0.6, 0.63, 0.66], opacity: 1 });
    S.renderer.addChunk({ kind: 'mesh', pos: hf.pos, idx: hf.idx, color, normal: smooth ? hf.normal : null, count: hf.count, bboxLocal: hf.bboxLocal }, 'base', lid);
    const Lg = layerById(lid);
    if (Lg) { Lg.bboxLocal = hf.bboxLocal; Lg.tint = '#9aa0a6'; Lg.gridSurface = true; Lg.surfaceFlatZ = flatZ; Lg.surfaceSmooth = smooth; }
    recomputeUnion(); requestRender();
    $('#meta').textContent = `${name} — surface · ${hf.vertexCount.toLocaleString()} nodes${stride > 1 ? ` (every ${stride}ᵗʰ)` : ''}${grid.crs ? ` · ${grid.crs}` : ''}`;
    return;
  }
  registerDocs(lid, 'points', { gridDoc });
  fitFromHeader(header, opts.first !== false);
  setColorLabels(null);
  const cb = createChunkBuilder({ frame: S.frame, chunkSize: 1 << 18, batchSize: 1 << 22, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
  // records are SEQUENTIAL displayed indices (the 29-bit partition can't hold
  // raw node indices of a huge DEM); dispIdx joins a record back to its node
  const dispIdx = new Uint32Array(shown);
  const B = 1 << 18;
  let bx = new Float64Array(B), by = new Float64Array(B), bz = new Float64Array(B), bi = new Uint16Array(B), bcl = new Uint8Array(B), br = new Uint32Array(B);
  let fill = 0, rec = 0, pushed = 0;
  const P = grid.place || null, q = [0, 0, 0];
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
      if (P) { applyP(P, grid.x0 + c * grid.dx, grid.y0 - r * grid.dy, v2, q); bx[fill] = q[0]; by[fill] = q[1]; bz[fill] = q[2]; }   // a rotated / placed grid's node in world
      else { bx[fill] = grid.x0 + c * grid.dx; by[fill] = grid.y0 - r * grid.dy; bz[fill] = v2; }
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
  recomputeUnion();
  $('#meta').textContent = `${name} — ${nx.toLocaleString()}×${ny.toLocaleString()} ${grid.form}${grid.crs ? ` · ${grid.crs}` : ''}${layerById(lid) && layerById(lid).placement ? ' · placed' : ''}` +
    `${stride > 1 ? ` · showing every ${stride}ᵗʰ node (${shown.toLocaleString()})` : ` · ${shown.toLocaleString()} nodes`}`;
  requestRender();
}
