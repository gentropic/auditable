// micro — POINT CLOUD → DEM: a points layer (LAS, PLY, XYZ, a CSV of points) gridded onto a
// regular node lattice — the as-built half of "drone flight → reconciliation factors". Each point
// lands on its nearest node and the node keeps the min / mean / max Z (or the count) of the points
// that landed there; empty nodes stay blank, or are filled by the surface tools' fills (nearest /
// planar trend, holes only or out to the edge). Streamed: the cloud is read once, chunk by chunk,
// through the layer's own position stream (src/bygeom.js layerPositions — the columnar workers for
// Parquet / CSV, the provider's reader for LAS / PLY), never held; the memory is the grid's.
// The lattice: nodes at round multiples of the cell (or through an anchor point), or an existing
// grid's own lattice — so successive surveys gridded the same way compare node for node.
// The binner is pure (src/grid-ops.js makePointBinner); this file reads the layer and makes the grid
// layer. The routine tool is `pcgrid` (src/tools.js).
import { S, layerById } from './state.js';
import { attrRowCountOf, layerTableHeader, layerRecords, schemaExt } from './records.js';
import { layerPositions } from './bygeom.js';
import { layerWorldBbox } from './gridtools.js';
import { applyGridExtend, latticeForBbox, makePointBinner, PC_STATS } from './grid-ops.js';
import { niceStep } from './analysis-ui.js';
import { mkLineage } from './lineage.js';
import { openBlob } from './open.js';
import { removeLayerUI } from './layers.js';
import { writeEsriAsc } from './grid-io.js';
import { floatWin } from './windows.js';
import { registerCommands } from './commands.js';
import { compileBool, validate } from '../../../ext/expr/index.js';
const $ = (s) => document.querySelector(s);

export const GRID_NODE_CAP = 32e6;                           // as the surface tools: a grid past this wants a bigger cell

// a layer whose records ARE points to grid: a points layer read from a file (LAS, PLY, XYZ, a CSV of
// points) — not a drillhole layer, a hole trace, or a grid shown as points (that already is a grid)
export const isPointCloud = (L) => !!(L && L.kind === 'points' && !L.dh && !L.trace && L.docs && !L.docs.gridDoc && (L.docs.lasDoc || L.docs.plyDoc || L.docs.blockDoc));
export const pointClouds = () => S.layers.filter(isPointCloud);
const nameOf = (L) => (L ? L.label || L.name : '?');
const baseOf = (L) => nameOf(L).replace(/\.[^.]+$/, '');

// the default cell: about 500 nodes across the cloud's longer side, rounded to a nice step
export function defaultCellOf(L) {
  const bb = layerWorldBbox(L);
  return bb ? niceStep(Math.max(bb[3] - bb[0], bb[4] - bb[1]) / 500) : 1;
}

// the lattice a gridding run fills: an existing grid's (match), or the cloud's bbox at `cell`,
// nodes through `anchor` (default [0, 0] — round multiples of the cell)
export function pcGridGeom(L, { cell, anchor = [0, 0], match = null } = {}) {
  if (match) {
    const g = match.docs && match.docs.gridDoc && match.docs.gridDoc.grid;
    if (!g) throw new Error(`${nameOf(match)} is not a grid`);
    return { x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy || g.dx, nx: g.nx, ny: g.ny };
  }
  const bb = layerWorldBbox(L);
  if (!bb) throw new Error(`${nameOf(L)}: no extent yet (still loading?)`);
  const dx = +cell > 0 ? +cell : defaultCellOf(L);
  return latticeForBbox([bb[0], bb[1], bb[3], bb[4]], dx, anchor);
}

// the records a filter expression keeps (LAS: Classification == 2 — the ground class), as a mask by
// record number; the cloud's own filter box (scope 'filtered') is the layer's live mask
async function filterMaskOf(L, expr, signal) {
  const h = layerTableHeader(L); if (!h) throw new Error(`${nameOf(L)} has no columns to filter on`);
  const schema = schemaExt(L, h), v = validate(String(expr), schema);
  if (!v.ok) throw new Error(`filter “${expr}”: ${(v.errors[0] && v.errors[0].message) || 'invalid'}`);
  const fn = compileBool(String(expr), schema, { decimal: '.' });
  const mask = new Uint8Array(attrRowCountOf(L) || 0);
  let n = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (rec < mask.length && fn(f)) mask[rec] = 1;
    if (((++n) & 0xffff) === 0) { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); await new Promise((r) => setTimeout(r)); }
  }
  return mask;
}

/**
 * Grid a point cloud (no layer made). opts: cell, anchor [x, y], match (a grid LAYER whose lattice
 * to fill), stat (min | mean | max | count), fill (none | nearest | trend), holesOnly, filter (an
 * expression), scope ('all' | 'filtered' — the layer's filter box), onProgress(frac, text), signal.
 * → { grid, geom, points, outside, skipped, filled, empty, filledByFill }
 */
export async function gridPointCloud(L, opts = {}) {
  if (!isPointCloud(L)) throw new Error(`${nameOf(L)} is not a point cloud (a points layer: LAS, PLY, XYZ, a CSV of points)`);
  const stat = opts.stat || 'mean';
  if (!PC_STATS.includes(stat)) throw new Error(`stat: one of ${PC_STATS.join(' / ')}`);
  const geom = pcGridGeom(L, opts);
  if (geom.nx * geom.ny > GRID_NODE_CAP) throw new Error(`${geom.nx.toLocaleString()} × ${geom.ny.toLocaleString()} nodes is over the ${GRID_NODE_CAP / 1e6}M cap — use a bigger cell`);
  let mask = null;
  if (opts.filter && String(opts.filter).trim()) { if (opts.onProgress) opts.onProgress(0, 'filtering…'); mask = await filterMaskOf(L, opts.filter, opts.signal); }
  else if (opts.scope === 'filtered') { mask = L._filterMask || null; if (!mask) throw new Error(`${nameOf(L)} has no filter — type one in the filter box, or give a filter expression`); }
  const b = makePointBinner(geom, stat);
  const total = attrRowCountOf(L) || (L.docs.lasDoc && L.docs.lasDoc.header && L.docs.lasDoc.header.count) || 0;
  let seen = 0, chunks = 0;
  for await (const part of layerPositions(L)) {
    if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const recs = part.recs, base = part.base || 0;
    const keep = mask ? (i) => { const r = recs ? recs[i] : base + i; return r < mask.length && mask[r] === 1; } : null;
    b.add(part.x, part.y, part.z, part.count, keep);
    seen += part.count;
    if (opts.onProgress && ((++chunks) & 3) === 0) { opts.onProgress(total ? Math.min(1, seen / total) : 0, `${seen.toLocaleString()} points`); await new Promise((r) => setTimeout(r)); }
  }
  const out = b.finish();
  if (!out.filled) throw new Error(`no point of ${nameOf(L)} fell on the lattice${mask ? ' (after the filter)' : ''}`);
  let filledByFill = 0;
  if (opts.fill && opts.fill !== 'none' && stat !== 'count') {
    if (opts.onProgress) opts.onProgress(1, `filling (${opts.fill})…`);
    applyGridExtend(out.grid, opts.fill, opts.holesOnly !== false);
    for (let k = 0; k < out.grid.data.length; k++) if (out.grid.data[k] !== out.grid.nodata) filledByFill++;
    filledByFill -= out.filled;
  }
  return { ...out, geom, filledByFill };
}

// a re-run REPLACES what an earlier run made under the same name in this session (re-running is
// running once), never a file-backed layer the user opened
export function replaceMade(name) {
  for (const x of S.layers.filter((q) => q.memoryOnly && q.name === name)) removeLayerUI(x.id);
}

/** Grid a point cloud and open the DEM as a grid layer. → { id, name, …gridPointCloud's numbers } */
export async function pointsToGridLayer(L, opts = {}) {
  const r = await gridPointCloud(L, opts);
  const name = opts.name ? (/\.asc$/i.test(opts.name) ? opts.name : `${opts.name}.asc`) : `${baseOf(L)}_${r.grid.form.replace('points-', '')}${+r.geom.dx.toPrecision(6)}m.asc`;
  const lin = mkLineage('pcgrid', { of: L.name, cell: r.geom.dx, stat: opts.stat || 'mean', ...(opts.match ? { match: opts.match.name } : { anchor: opts.anchor || [0, 0] }), fill: opts.fill || 'none', ...(opts.fill && opts.fill !== 'none' ? { holesOnly: opts.holesOnly !== false } : {}), ...(opts.filter ? { filter: String(opts.filter) } : opts.scope === 'filtered' ? { filter: L.filterExpr || '(the filter box)' } : {}) }, [L.lineage].filter(Boolean));
  replaceMade(name);
  const id = await openBlob(new File([writeEsriAsc(r.grid)], name), name, S.layers.length ? 'add' : 'replace', null, { lineage: lin });
  const NL = id != null ? layerById(id) : null;
  if (NL) NL.memoryOnly = true;                              // made in the session: a save writes it into the project
  return { id, name, ...r };
}

// ── the dialog ───────────────────────────────────────────────────────────────
let _win = null;
export function openPcGridDialog(L0) {
  const clouds = pointClouds();
  if (!clouds.length) { $('#meta').textContent = 'grid points: open a point cloud first (LAS, PLY, XYZ, a CSV of points)'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const d = { src: (L0 && clouds.includes(L0) ? L0 : clouds[0]).id, cell: 0, stat: 'mean', anchorOn: false, ax: 0, ay: 0, match: '', fill: 'none', holesOnly: true, filter: '' };
  d.cell = defaultCellOf(layerById(d.src));
  const win = floatWin({ title: 'grid points', sub: 'point cloud → DEM', x: Math.max(12, innerWidth - 430), y: 100, w: 400, h: 440, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.pcgrid = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Grid'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg);
  win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 84px;color:var(--text)'; s.textContent = label; r.append(s, el); form.appendChild(r); return el; };
  const sel = (opts, val, onch) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val); s.onchange = () => onch(s.value); return s; };
  const num = (val, onch, w = 90) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = 'any'; i.value = String(val); i.style.width = w + 'px'; i.oninput = () => onch(+i.value); return i; };
  const tally = document.createElement('span'); tally.style.cssText = 'color:var(--muted);font-size:11px';
  const geomNow = () => { try { return pcGridGeom(layerById(d.src), { cell: d.cell, anchor: d.anchorOn ? [d.ax, d.ay] : [0, 0], match: d.match ? layerById(+d.match) : null }); } catch { return null; } };
  const updTally = () => {
    const g = geomNow();
    tally.textContent = g ? `= ${g.nx.toLocaleString()} × ${g.ny.toLocaleString()} nodes (${(g.nx * g.ny).toLocaleString()})` : '(no extent yet)';
    const over = g && g.nx * g.ny > GRID_NODE_CAP;
    go.disabled = !g || over; msg.textContent = over ? `over ${GRID_NODE_CAP / 1e6}M nodes — raise the cell` : '';
  };
  const build = () => {
    form.textContent = '';
    const L = layerById(d.src);
    row('points', sel(clouds.map((c) => [c.id, nameOf(c)]), d.src, (v) => { d.src = +v; d.cell = defaultCellOf(layerById(d.src)); build(); }), 'the point cloud to grid');
    const grids = S.layers.filter((g) => g.docs && g.docs.gridDoc && g.docs.gridDoc.grid);
    row('lattice', sel([['', 'its own extent'], ...grids.map((g) => [g.id, `match: ${nameOf(g)}`])], d.match, (v) => { d.match = v; build(); }), 'the nodes to fill: the cloud’s extent at a cell size, or an existing grid’s lattice (an earlier survey — so the two compare node for node)');
    if (!d.match) {
      const ci = row('cell (m)', num(d.cell, (v) => { d.cell = v > 0 ? v : d.cell; updTally(); }), 'node spacing; the default is ~500 nodes across the cloud');
      ci.parentElement.append(tally);
      const ar = document.createElement('div'); ar.style.cssText = 'display:flex;gap:6px;align-items:center';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.anchorOn; cb.onchange = () => { d.anchorOn = cb.checked; build(); };
      const cl = document.createElement('label'); cl.style.cssText = 'display:flex;gap:4px;align-items:center'; cl.append(cb, 'through a point');
      ar.append(cl);
      if (d.anchorOn) ar.append(num(d.ax, (v) => { d.ax = v; updTally(); }, 84), num(d.ay, (v) => { d.ay = v; updTally(); }, 84));
      row('nodes', ar, 'the nodes sit on round multiples of the cell (0, 0 phase) — or pass through a point you give (another survey’s lattice)');
    } else form.append(tally);
    row('statistic', sel([['min', 'min Z — ground under vegetation'], ['mean', 'mean Z'], ['max', 'max Z — crest, canopy'], ['count', 'count — point density']], d.stat, (v) => { d.stat = v; build(); }), 'what each node keeps of the points that fall in its cell');
    if (d.stat !== 'count') {
      row('empties', sel([['none', 'leave blank'], ['nearest', 'nearest (flat)'], ['trend', 'planar trend']], d.fill, (v) => { d.fill = v; build(); }), 'nodes no point fell on: blank, or filled as the surface tools fill');
      if (d.fill !== 'none') { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.holesOnly; cb.onchange = () => { d.holesOnly = cb.checked; }; row('holes only', cb, 'fill only the gaps inside the cloud — beyond its edge stays blank'); }
    }
    const fi = document.createElement('input'); fi.className = 'sw-in'; fi.style.flex = '1'; fi.value = d.filter; fi.placeholder = L && L.filterExpr ? `the filter box: ${L.filterExpr}` : 'all points (e.g. Classification == 2)';
    fi.oninput = () => { d.filter = fi.value; };
    row('only', fi, 'an expression keeping the points to grid (a LAS ground class: Classification == 2). Blank: the layer’s filter box if it has one, else every point');
    note.textContent = 'each point lands on its nearest node; the node keeps the statistic of the Z that landed there. Read once, streamed — the cloud is never held. The DEM opens as a grid layer (export it, extend it, use it as a survey in cut / fill and the factors).';
    updTally();
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'gridding…';
    const t0 = performance.now();
    try {
      const L = layerById(d.src);
      const filter = d.filter.trim() || '';
      const r = await pointsToGridLayer(L, { cell: d.cell, anchor: d.anchorOn ? [d.ax, d.ay] : [0, 0], match: d.match ? layerById(+d.match) : null, stat: d.stat, fill: d.fill, holesOnly: d.holesOnly, filter, scope: !filter && L.filterExpr && L._filterMask ? 'filtered' : 'all', onProgress: (f, t) => { msg.textContent = `${Math.round(f * 100)}% · ${t}`; } });
      const s = ((performance.now() - t0) / 1000).toFixed(1);
      msg.textContent = `${r.points.toLocaleString()} points → ${r.filled.toLocaleString()} of ${(r.geom.nx * r.geom.ny).toLocaleString()} nodes${r.filledByFill ? ` (+${r.filledByFill.toLocaleString()} filled)` : ''} in ${s} s`;
      $('#meta').textContent = `grid points: ${r.name} — ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}

// ── its palette command (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  { id: 'pcgrid', group: 'Layer', title: 'Grid points to DEM…', kw: 'point cloud las ply xyz lidar drone survey photogrammetry dem dtm raster grid min mean max ground bin rasterize topography as-built', when: (c) => !!(isPointCloud(c.L) || pointClouds().length), run: (c) => openPcGridDialog(c.L) },
]);
