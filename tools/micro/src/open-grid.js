// micro — the GRID readers: GeoTIFF (the finest overview within the display budget,
// or a decimated read), Surfer .grd and ESRI ASCII, each to a grid layer. openBlob
// (src/open.js) dispatches here.
import { readGTiff, pickOverviewForCap, stepForCap, gridDecimatedFromGTiff, gridFromGTiff } from '../../../ext/gtiff/index.js';
import { openGridSource, SURFER_BLANK } from './grid-io.js';
import { S, layerById, requestRender } from './state.js';
import { buildHeightfieldMesh, createChunkBuilder } from '../../../ext/condenser/src/main.js';
import { surfaceColorArray } from './surfaces.js';
import { rampCfgOf } from './ramp.js';
import { registerDocs } from './open.js';
import { fitFromHeader, recomputeUnion } from './layers.js';
import { setColorLabels } from './color.js';
const $ = (s) => document.querySelector(s);

// ── grids (§7.1): GeoTIFF / Surfer .grd / ESRI ASCII → ONE gridDoc shape ──
// { nx, ny, data, x0, y0, dx, dy, nodata, crs, form } — row 0 is the NORTH
// row, x0/y0 are SAMPLE CENTERS, dy positive (row r's centre = y0 − r·dy).
export const ascLooksLikeGrid = async (blob) => /^\s*ncols\b/i.test(await blob.slice(0, 64).text());
async function readAnyGrid(blob, name, displayCache = null, band = 0) {
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
const GRID_DISPLAY_CAP = 4_000_000;
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
    const hf = buildHeightfieldMesh(grid, { stride, frame: S.frame, flatZ });
    if (!hf) throw new Error('grid is all nodata');
    const color = surfaceColorArray(hf, opts.drape || null, (rampCfgOf(layerById(lid)) || {}).preset, zmin, zmax);
    registerDocs(lid, 'mesh', { gridDoc });
    fitFromHeader({ ...header, bbox: { min: hf.bboxLocal.slice(0, 3).map((v, i) => v + (S.frame ? S.frame.origin[i] : 0)), max: hf.bboxLocal.slice(3, 6).map((v, i) => v + (S.frame ? S.frame.origin[i] : 0)) } }, opts.first !== false);
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
  recomputeUnion();
  $('#meta').textContent = `${name} — ${nx.toLocaleString()}×${ny.toLocaleString()} ${grid.form}${grid.crs ? ` · ${grid.crs}` : ''}` +
    `${stride > 1 ? ` · showing every ${stride}ᵗʰ node (${shown.toLocaleString()})` : ` · ${shown.toLocaleString()} nodes`}`;
  requestRender();
}
