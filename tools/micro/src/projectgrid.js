// micro — PROJECTIONS AS GRIDS: the numeric sibling of View → Projection. The screen projection
// (src/projection.js) is a PICTURE — the max / min / mean along each line of sight, as drawn, budget
// by budget. This is the same per-column question asked of the RECORDS and answered as a grid LAYER:
// for every node of a plan lattice, the blocks its vertical line passes through, and of them
//   max · min · mean grade (thickness-weighted — every block counts by how much of the line it holds)
//   thickness above a cutoff · grade × thickness (the accumulation) · tonnes · metal per column.
// Exact, not budgeted: every record is read (the columnar engine on the worker pool for a Parquet /
// .dm / indexed CSV model whose columns are plain columns — the row path otherwise), never the screen.
// The grid opens as a layer: it drapes, contours, exports and goes into figures like any DEM.
//
// The support contract decides what a "column" is: a block counts at a node when the node's vertical
// line crosses the block's TRUE box — its own size (sub-blocked: each sub-block its own footprint) and
// its own orientation (rotated: the line is cut by the rotated box) — and it counts by the LENGTH of
// line inside the box, so a mean is volume-weighted and a thickness is a true vertical thickness.
// Plan view only for now: an oblique plane's grid needs a frame for the plane (ROADMAP: first-class
// planes) — the pass is the same with another axis.
import { S, layerById } from './state.js';
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt, layerWorldBox } from './records.js';
import { volumeContextOf, halfAt, metalFactorOf, numericColsOf } from './analysis.js';
import { gridAxesOf, latticeForBbox } from './grid-ops.js';
import { layerWorldBbox } from './gridtools.js';
import { ensureStoredValues } from './columns.js';
import { canScanColumnar, scanColumnar } from './colscan.js';
import { bySupportOf } from './bygeom.js';
import { mkLineage } from './lineage.js';
import { openBlob } from './open.js';
import { writeEsriAsc } from './grid-io.js';
import { floatWin } from './windows.js';
import { registerCommands } from './commands.js';
import { registerTool } from './tools.js';
import { LIMIT_PARAM, normLimit } from './limit-param.js';
import { limitMaskOf, resolveLimit, limitRow } from './polylimit.js';
import { gridCoverage } from './coverage.js';
import { GRID_NODE_CAP, replaceMade } from './pcgrid.js';
import { setProjectionGridOpener } from './projection.js';
import { compileBool, validate } from '../../../ext/expr/index.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
const $ = (s) => document.querySelector(s);

export const PG_STATS = ['max', 'min', 'mean', 'thickness', 'accumulation', 'tonnes', 'metal'];
export const PG_WORDS = {
  max: 'max grade — the highest along each column',
  min: 'min grade — the lowest along each column',
  mean: 'mean grade — thickness-weighted along each column',
  thickness: 'thickness above the cutoff (m)',
  accumulation: 'grade × thickness above the cutoff',
  tonnes: 'tonnes above the cutoff, per column',
  metal: 'metal above the cutoff, per column',
};
const CUT_STATS = new Set(['thickness', 'accumulation', 'tonnes', 'metal']);
const nameOf = (L) => (L ? L.label || L.name : '?');
const baseOf = (L) => nameOf(L).replace(/\.[^.]+$/, '');
export const projectableLayers = () => S.layers.filter((L) => !!gridAxesOf(L));

// the lattice: square nodes at the model's finest plan pitch, through a block centre (an axis-aligned
// model's columns ARE its block columns — every node a column's middle); a rotated model on round
// multiples of the cell. Over the node cap the cell doubles until it fits (a stated cell is refused).
export function projectGridGeom(L, { cell = null, anchor = null } = {}) {
  const ga = gridAxesOf(L); if (!ga) throw new Error(`${nameOf(L)} is not a block model on a lattice`);
  const bb = layerWorldBbox(L); if (!bb) throw new Error(`${nameOf(L)}: no extent yet (still loading?)`);
  const ex = [bb[0], bb[1], bb[3], bb[4]];
  const an = anchor || (ga.rot ? [0, 0] : [+ga.x.origin || 0, +ga.y.origin || 0]);
  if (+cell > 0) return latticeForBbox(ex, +cell, an);
  let dx = Math.min(Math.abs(+ga.x.pitch) || 1, Math.abs(+ga.y.pitch) || 1);
  let g = latticeForBbox(ex, dx, an);
  while (g.nx * g.ny > GRID_NODE_CAP / 4) { dx *= 2; g = latticeForBbox(ex, dx, an); }
  return g;
}

// the per-node accumulator: one pass, O(1) per node a block touches, O(nodes) memory
function makeColumnAccumulator(geom, { stat, cutoff, mf }) {
  const { x0, y0, dx, nx, ny } = geom, dy = geom.dy || dx, N = nx * ny, area = dx * dy;
  const sw = new Float64Array(N), swg = new Float64Array(N);
  const ext = stat === 'max' || stat === 'min' ? new Float64Array(N).fill(stat === 'max' ? -Infinity : Infinity) : null;
  const cutAcc = CUT_STATS.has(stat) ? new Float64Array(N) : null;
  const cut = Number.isFinite(cutoff) ? cutoff : -Infinity;
  let blocks = 0, touched = 0;
  const q0 = [0, 0, 0];
  // a block: centre c [3] (world), half extents h [3] in its own frame, R (lattice axes as world
  // vectors, R[a] = [x, y, z]) or null, grade g, density d (t/m³ — 1 when none)
  const add = (cx, cy, cz, h0, h1, h2, R, g, d) => {
    blocks++;
    const hx = R ? h0 * Math.abs(R[0][0]) + h1 * Math.abs(R[1][0]) + h2 * Math.abs(R[2][0]) : h0;
    const hy = R ? h0 * Math.abs(R[0][1]) + h1 * Math.abs(R[1][1]) + h2 * Math.abs(R[2][1]) : h1;
    // the nodes under the footprint's bounding box; a node ON a face belongs to the block on its + side
    // (the probe sits a hair inside: a millionth of a cell), so neighbours never both count it
    const eps = dx * 1e-6;
    const c0 = Math.max(0, Math.ceil((cx - hx - eps - x0) / dx)), c1 = Math.min(nx - 1, Math.floor((cx + hx - eps - x0) / dx));
    const r0 = Math.max(0, Math.ceil((y0 - (cy + hy - eps)) / dy)), r1 = Math.min(ny - 1, Math.floor((y0 - (cy - hy - eps)) / dy));
    const hs = [h0, h1, h2];
    for (let r = r0; r <= r1; r++) {
      const py = y0 - r * dy + eps;
      for (let c = c0; c <= c1; c++) {
        const px = x0 + c * dx + eps;
        let th;
        if (!R) {
          if (!(px >= cx - h0 && px < cx + h0 && py >= cy - h1 && py < cy + h1)) continue;
          th = 2 * h2;
        } else {
          // the vertical line (px, py, z) in the block's frame: q(z) = Rᵀ((px, py, 0) − c) + z·Rᵀ ẑ
          const wx = px - cx, wy = py - cy, wz = -cz;
          let lo = -Infinity, hi = Infinity, inside = true;
          for (let a = 0; a < 3 && inside; a++) {
            q0[a] = R[a][0] * wx + R[a][1] * wy + R[a][2] * wz;
            const da = R[a][2], ha = hs[a];
            if (Math.abs(da) < 1e-12) { if (!(q0[a] >= -ha && q0[a] < ha)) inside = false; continue; }
            let ta = (-ha - q0[a]) / da, tb = (ha - q0[a]) / da;
            if (ta > tb) { const t = ta; ta = tb; tb = t; }
            if (ta > lo) lo = ta; if (tb < hi) hi = tb;
          }
          if (!inside || !(hi > lo)) continue;
          th = hi - lo;
        }
        const k = r * nx + c;
        if (!sw[k]) touched++;
        sw[k] += th; swg[k] += th * g;
        if (ext) { if (stat === 'max' ? g > ext[k] : g < ext[k]) ext[k] = g; }
        if (cutAcc && g >= cut) {
          if (stat === 'thickness') cutAcc[k] += th;
          else if (stat === 'accumulation') cutAcc[k] += th * g;
          else if (stat === 'tonnes') cutAcc[k] += th * area * d;
          else cutAcc[k] += th * area * d * g * mf;
        }
      }
    }
  };
  const finish = (nodata = -9999) => {
    const data = new Float32Array(N);
    let filled = 0, sum = 0, peak = -Infinity;
    for (let k = 0; k < N; k++) {
      if (!(sw[k] > 0)) { data[k] = nodata; continue; }
      filled++;
      const v = stat === 'mean' ? swg[k] / sw[k] : ext ? ext[k] : cutAcc[k];
      data[k] = v; if (cutAcc) sum += v; if (v > peak) peak = v;
    }
    return { grid: { nx, ny, x0, y0, dx, dy, data, nodata, crs: null, form: `column-${stat}` }, blocks, filled, empty: N - filled, touched, total: cutAcc ? sum : null, peak };
  };
  return { add, finish };
}

async function filterMaskOf(L, expr, signal) {
  const h = layerTableHeader(L), schema = schemaExt(L, h), v = validate(String(expr), schema);
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
 * The column statistic of a block model as a plan grid (no layer made). opts:
 *   col (the grade column — any numeric column, ƒ and stored ones included), stat (PG_STATS),
 *   cutoff (thickness / accumulation / tonnes / metal: blocks at or above it count; blank = all),
 *   density (a column name or a number, t/m³ — tonnes and metal; default 1, i.e. m³), densityUnit,
 *   gradeUnit / metalFactor (metal = tonnes × grade × factor — the one metal rule, analysis.js),
 *   cell, anchor [x, y], filter (an expression) | scope ('filtered' — the layer's filter box: the
 *   default when it has one — or 'all'), onProgress(frac, text), signal.
 * → { grid, geom, blocks, filled, empty, total, peak, where, unit }
 */
export async function projectGrid(L, opts = {}) {
  const ga = gridAxesOf(L); if (!ga) throw new Error(`${nameOf(L)} is not a block model on a lattice (open it as blocks)`);
  const stat = opts.stat || 'max';
  if (!PG_STATS.includes(stat)) throw new Error(`stat: one of ${PG_STATS.join(' / ')}`);
  const h = layerTableHeader(L), schema = schemaExt(L, h), at = (nm) => schema.findIndex((c) => c.name === nm || c.name.toLowerCase() === String(nm).toLowerCase());
  const col = opts.col; if (!col) throw new Error('which grade column?');
  const gi = at(col); if (gi < 0) throw new Error(`no column “${col}” on ${nameOf(L)}`);
  if (!numericColsOf(L).some((c) => c.toLowerCase() === String(col).toLowerCase())) throw new Error(`“${col}” is not a numeric column`);
  const dens = opts.density, dConst = dens == null || dens === '' ? 1 : Number.isFinite(+dens) ? +dens : null;
  const di = dConst == null ? at(dens) : -1;
  if (dConst == null && di < 0) throw new Error(`density: no column “${dens}” (or give a number, t/m³)`);
  if (dConst != null && !(dConst > 0)) throw new Error('density: a positive number (t/m³), or a column');
  const dScale = opts.densityUnit ? unitConvert(1, opts.densityUnit, 't/m3') : 1;
  const cutoff = opts.cutoff == null || opts.cutoff === '' || opts.cutoff === 'none' ? null : +opts.cutoff;
  if (cutoff != null && !Number.isFinite(cutoff)) throw new Error('cutoff: a number, or blank for every block');
  const { mf, unit: metalUnit } = stat === 'metal' ? metalFactorOf(opts) : { mf: 1, unit: '' };
  const geom = projectGridGeom(L, opts);
  if (geom.nx * geom.ny > GRID_NODE_CAP) throw new Error(`${geom.nx.toLocaleString()} × ${geom.ny.toLocaleString()} nodes is over the ${GRID_NODE_CAP / 1e6}M cap — use a bigger cell`);
  let mask = null;
  if (opts.filter && String(opts.filter).trim()) { if (opts.onProgress) opts.onProgress(0, 'filtering…'); mask = await filterMaskOf(L, opts.filter, opts.signal); }
  else if (opts.scope !== 'all' && L.filterExpr && L._filterMask) mask = L._filterMask;
  // a polygon limit: only the blocks whose centroid lies inside it (and, below, only the nodes inside it)
  const lim = opts.limit ? resolveLimit(opts.limit) : null;
  if (lim) { const lm = await limitMaskOf(L, opts.limit, { signal: opts.signal }); mask = mask ? Uint8Array.from(lm, (v, i) => (v && i < mask.length && mask[i] ? 1 : 0)) : lm; }
  const acc = makeColumnAccumulator(geom, { stat, cutoff, mf });
  const R = ga.rot ? [ga.rot.slice(0, 3), ga.rot.slice(3, 6), ga.rot.slice(6, 9)] : null;
  const total = attrRowCountOf(L) || 0;
  const abort = () => { if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
  let seen = 0, where = 'on this page';
  // the columnar engine: the grade and density are plain columns (no ƒ / stored column to evaluate)
  const plain = (i) => i >= 0 && i < h.columns.length;
  const bs = bySupportOf(L);
  if (canScanColumnar(L) && plain(gi) && (di < 0 || plain(di)) && !window.__pgRowPath) {
    const P = L.docs.blockDoc.parquet, m = h.mapping;
    const coords = P ? P.coordNames : [h.columns[m.x], h.columns[m.y], h.columns[m.z]];
    const names = P ? P.names : h.columns, gName = names.find((n) => n.toLowerCase() === h.columns[gi].toLowerCase()) || h.columns[gi];
    const dName = di >= 0 ? names.find((n) => n.toLowerCase() === h.columns[di].toLowerCase()) || h.columns[di] : null;
    const sizes = bs && bs.sub && bs.sizes ? bs.sizes : null;
    const hv = [0, 0, 0];
    const half = (part, i) => {
      if (!sizes) { hv[0] = bs.pitch[0] / 2; hv[1] = bs.pitch[1] / 2; hv[2] = bs.pitch[2] / 2; return hv; }
      const q = part.dimQ; hv[0] = (q[3 * i] || 1) * bs.pitch[0] / 2; hv[1] = (q[3 * i + 1] || 1) * bs.pitch[1] / 2; hv[2] = (q[3 * i + 2] || 1) * bs.pitch[2] / 2; return hv;
    };
    await ensureStoredValues(L, new Set([gName, dName].filter(Boolean).map((x) => x.toLowerCase())));
    await scanColumnar(L, { kernel: 'positions', params: { coords, extra: [gName, ...(dName ? [dName] : [])], ...(sizes ? { sizes, pitch: bs.pitch } : {}) }, exprs: [],
      extraCols: [...coords, ...(sizes || []), gName, ...(dName ? [dName] : [])], signal: opts.signal,
      onProgress: (d, n, w) => { where = w || where; if (opts.onProgress) opts.onProgress(total ? Math.min(1, d / total) : 0, `${d.toLocaleString()} blocks`); },
      onPart: (g, part, start) => {
        const G = part.ex[0], D = dName ? part.ex[1] : null;
        for (let i = 0; i < part.rec.length; i++) {
          const rec = start + part.rec[i];
          if (mask && !(rec < mask.length && mask[rec])) continue;
          const gv = G[i]; if (!Number.isFinite(gv)) continue;           // a blank grade is unestimated, not 0
          const dv = D ? D[i] * dScale : dConst * dScale; if (D && !(dv > 0)) continue;
          const hh = half(part, i);
          acc.add(part.x[i], part.y[i], part.z[i], hh[0], hh[1], hh[2], R, gv, dv);
        }
        seen += part.rec.length;
      } });
  } else {
    where = 'on this page';
    const vc = volumeContextOf(L), m = h.mapping, hh = [0, 0, 0];
    await ensureStoredValues(L, new Set([col, di >= 0 ? schema[di].name : null].filter(Boolean).map((x) => String(x).toLowerCase())));
    for await (const { f, rec } of layerRecords(L)) {
      seen++;
      if ((seen & 0xffff) === 0) { abort(); if (opts.onProgress) opts.onProgress(total ? Math.min(1, seen / total) : 0, `${seen.toLocaleString()} blocks`); await new Promise((r) => setTimeout(r)); }
      if (mask && !(rec < mask.length && mask[rec])) continue;
      const gv = numOf(f[gi]); if (!Number.isFinite(gv)) continue;
      const dv = di >= 0 ? numOf(f[di]) * dScale : dConst * dScale; if (!(dv > 0)) continue;
      const x = numOf(f[m.x]), y = numOf(f[m.y]), z = numOf(f[m.z]);
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
      halfAt(vc, f, hh);
      acc.add(x, y, z, hh[0], hh[1], hh[2], R, gv, dv);
    }
  }
  const out = acc.finish();
  if (lim && out.grid) {                                     // the map stops at the polygons: a node whose cell none of them reaches is blank
    const cov = gridCoverage(lim.features, out.grid), g = out.grid;
    for (let k = 0; k < g.data.length; k++) if (!(cov[k] > 0) && g.data[k] !== g.nodata) { if (out.total != null) out.total -= g.data[k]; g.data[k] = g.nodata; out.filled--; out.empty = (out.empty || 0) + 1; }
    out.limit = normLimit(opts.limit);
  }
  if (!out.filled) throw new Error(`no block of ${nameOf(L)} crossed a node${mask ? ' (after the filter)' : ''}${lim ? ' inside the limit' : ''} — a smaller cell?`);
  const unit = stat === 'thickness' ? 'm' : stat === 'tonnes' ? (dConst === 1 && di < 0 && !opts.densityUnit ? 'm³ (no density)' : 't') : stat === 'metal' ? metalUnit : stat === 'accumulation' ? `${col}·m` : col;
  return { ...out, geom, where, unit, stat, cutoff, seen };
}

/** project and open the grid as a layer → { id, name, …projectGrid's numbers } */
export async function projectGridLayer(L, opts = {}) {
  const r = await projectGrid(L, opts);
  const stat = r.stat, cut = r.cutoff != null && CUT_STATS.has(stat) ? `_${r.cutoff}` : '';
  const name = opts.name ? (/\.asc$/i.test(opts.name) ? opts.name : `${opts.name}.asc`) : `${baseOf(L)}_${stat}_${opts.col}${cut}_${+r.geom.dx.toPrecision(6)}m.asc`;
  const lin = mkLineage('projectgrid', { of: L.name, col: opts.col, stat, ...(r.cutoff != null ? { cutoff: r.cutoff } : {}), cell: r.geom.dx,
    ...(stat === 'tonnes' || stat === 'metal' ? { density: opts.density ?? 1 } : {}),
    ...(opts.filter ? { filter: String(opts.filter) } : opts.scope !== 'all' && L.filterExpr && L._filterMask ? { filter: L.filterExpr } : {}), ...(r.limit ? { limit: r.limit } : {}) }, [L.lineage].filter(Boolean));
  replaceMade(name);
  // a DATA grid, not a DEM: a flat sheet just above the model, coloured by the value, the value named for what
  // it is (FE_max, thickness…) — it used to open as an elevation, a relief drawn at "Z" = the statistic
  const top = (() => { try { const b = layerWorldBox(L); return b ? b[1][2] : null; } catch { return null; } })();
  const flatZ = top != null ? +(top + Math.max(1, r.geom.dx)).toFixed(3) : null;
  const vname = stat === 'thickness' || stat === 'tonnes' || stat === 'count' ? `${stat}${cut ? cut : ''}` : `${opts.col}_${stat}${cut}`;
  const id = await openBlob(new File([writeEsriAsc(r.grid)], name), name, S.layers.length ? 'add' : 'replace', null, { lineage: lin, ...(flatZ != null ? { asKind: 'surface', flatZ } : {}) });
  const NL = id != null ? layerById(id) : null;
  if (NL) {
    NL.memoryOnly = true;                                    // made in the session: a save writes it into the project
    NL.gridValue = { name: vname, ...(r.unit && r.unit !== opts.col ? { unit: r.unit } : {}) };   // (max / mean: the column's own unit — no more to say)
  }
  return { id, name, ...r };
}

// ── the window ───────────────────────────────────────────────────────────────
let _win = null;
export function openProjectGridDialog(L0) {
  const list = projectableLayers();
  if (!list.length) { $('#meta').textContent = 'projection to grid: open a block model first'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const L1 = L0 && list.includes(L0) ? L0 : list[0];
  const firstNum = (L) => { const c = numericColsOf(L); const sel = String(L.colorSel || ''); const cur = sel.startsWith('chan:') ? (layerTableHeader(L).columns[+sel.slice(5)] || null) : null; return cur && c.includes(cur) ? cur : c[0] || ''; };
  const d = { src: L1.id, col: firstNum(L1), stat: S.projection && ['max', 'min', 'mean'].includes(S.projection) ? S.projection : 'max', cutoff: '', density: '', cell: 0, scope: L1.filterExpr ? 'filtered' : 'all', gradeUnit: '', limit: null };
  try { d.cell = projectGridGeom(L1).dx; } catch { d.cell = 10; }
  const win = floatWin({ title: 'projection to grid', sub: 'column statistics → a plan grid', x: Math.max(12, innerWidth - 450), y: 96, w: 420, h: 470, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.projectgrid = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Make grid'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg);
  win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 84px;color:var(--text)'; s.textContent = label; r.append(s, el); form.appendChild(r); return el; };
  const sel = (opts, val, onch) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val); s.onchange = () => onch(s.value); return s; };
  const inp = (val, onch, ph = '', w = null) => { const i = document.createElement('input'); i.className = 'sw-in'; i.value = String(val); i.placeholder = ph; if (w) i.style.width = w + 'px'; else i.style.flex = '1'; i.oninput = () => onch(i.value); return i; };
  const tally = document.createElement('span'); tally.style.cssText = 'color:var(--muted);font-size:11px';
  const updTally = () => {
    let g = null; try { g = projectGridGeom(layerById(d.src), { cell: +d.cell > 0 ? +d.cell : null }); } catch { /* no extent */ }
    tally.textContent = g ? `= ${g.nx.toLocaleString()} × ${g.ny.toLocaleString()} nodes` : '(no extent yet)';
    const over = g && g.nx * g.ny > GRID_NODE_CAP; go.disabled = !g || over || !d.col; msg.textContent = over ? `over ${GRID_NODE_CAP / 1e6}M nodes — raise the cell` : '';
  };
  const build = () => {
    form.textContent = '';
    const L = layerById(d.src);
    row('model', sel(list.map((x) => [x.id, nameOf(x)]), d.src, (v) => { d.src = +v; const Lx = layerById(d.src); d.col = firstNum(Lx); try { d.cell = projectGridGeom(Lx).dx; } catch { /* keep */ } d.scope = Lx.filterExpr ? 'filtered' : 'all'; build(); }), 'the block model to project');
    row('column', sel(numericColsOf(L).map((c) => [c, c]), d.col, (v) => { d.col = v; }), 'the grade — any numeric column, ƒ and stored columns included');
    row('statistic', sel(PG_STATS.map((s) => [s, PG_WORDS[s]]), d.stat, (v) => { d.stat = v; build(); }), 'what each node keeps of the blocks its vertical line crosses');
    if (CUT_STATS.has(d.stat)) row('cutoff', inp(d.cutoff, (v) => { d.cutoff = v; }, 'blank = every block', 90), 'blocks at or above it count');
    if (d.stat === 'tonnes' || d.stat === 'metal') row('density', inp(d.density, (v) => { d.density = v; }, 'a column or t/m³ (blank = 1)'), 'per block: a density column, or one value in t/m³');
    if (d.stat === 'metal') row('grade unit', sel([['', 'as stated (metal in grade·t)'], ['pct', '% → t of metal'], ['g/t', 'g/t → t of metal'], ['ppm', 'ppm → t of metal']], d.gradeUnit, (v) => { d.gradeUnit = v; }), 'declared, metal comes out in tonnes of metal');
    const ci = row('cell (m)', inp(d.cell, (v) => { d.cell = v; updTally(); }, '', 90), 'node spacing — the default is the model’s finest plan pitch, nodes through a block centre');
    ci.parentElement.append(tally);
    form.append(limitRow(d, () => build(), { label: 'inside', width: '84px' }));
    if (L.filterExpr) row('blocks', sel([['filtered', `the filter: ${L.filterExpr}`], ['all', 'every block']], d.scope, (v) => { d.scope = v; }), 'the layer’s filter box applies, or not');
    note.textContent = 'each node’s vertical line through the model: the blocks it crosses count by the length of line inside them (sub-blocks by their own size, a rotated model by its turned boxes). Every record is read — the picture is not the source. The grid opens as a layer: drape it, contour it, export it.';
    updTally();
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'projecting…';
    const t0 = performance.now();
    try {
      const r = await projectGridLayer(layerById(d.src), { col: d.col, stat: d.stat, cutoff: d.cutoff.trim ? d.cutoff.trim() : d.cutoff, density: String(d.density).trim(), gradeUnit: d.gradeUnit, cell: +d.cell > 0 ? +d.cell : null, scope: d.scope, limit: normLimit(d.limit),
        onProgress: (f, t) => { msg.textContent = `${Math.round(f * 100)}% · ${t}`; } });
      msg.textContent = `${r.seen.toLocaleString()} blocks → ${r.filled.toLocaleString()} of ${(r.geom.nx * r.geom.ny).toLocaleString()} nodes in ${((performance.now() - t0) / 1000).toFixed(1)} s${r.total != null ? ` · total ${+r.total.toPrecision(6)} ${r.unit}` : ''}`;
      $('#meta').textContent = `projection to grid: ${r.name} — ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}

// ── the routine tool ─────────────────────────────────────────────────────────
registerTool('projectgrid', {
  label: 'projection to grid', cache: false, makes: 'layer',
  params: {
    layer: { type: 'layer', required: true, kinds: ['blocks'], doc: 'the block model' },
    col: { type: 'column', required: true, doc: 'the grade column (any numeric column, ƒ and stored ones included)' },
    stat: { type: 'enum', values: PG_STATS.slice(), default: 'max', doc: 'per node, of the blocks its vertical line crosses: max · min · mean (thickness-weighted) grade · thickness above the cutoff · accumulation (grade × thickness) · tonnes · metal' },
    cutoff: { type: 'any', doc: 'thickness / accumulation / tonnes / metal: blocks at or above it count; absent or "none" = every block' },
    density: { type: 'any', doc: 'tonnes / metal: a density column name or a number in t/m³ (absent = 1, i.e. volume)' },
    densityUnit: { type: 'string', doc: 'the density column’s unit (kg/m3, lb/ft3 …) — converted to t/m³' },
    gradeUnit: { type: 'string', default: '', doc: 'metal: the grade unit; declared, metal is in tonnes of metal (% → × 0.01, g/t → × 1e-6)' },
    metalFactor: { type: 'number', doc: 'metal = tonnes × grade × this (overrides gradeUnit)' },
    cell: { type: 'number', routine: 'required', why: 'the default cell follows the model — a grid compared month to month needs one stated cell', doc: 'node spacing (default outside a routine: the model’s finest plan pitch)' },
    anchor: { type: 'numbers', doc: 'a point [x, y] the nodes pass through (default: a block centre; a rotated model: [0, 0])' },
    filter: { type: 'expr', default: '', of: 'layer', doc: 'only the blocks this keeps (absent: the layer’s filter box, when it has one)' },
    scope: { type: 'enum', values: ['filtered', 'all'], default: 'filtered', doc: 'without a filter expression: the layer’s filter box (filtered) or every block (all)' },
    limit: { ...LIMIT_PARAM, doc: 'only the blocks whose centroid lies inside these polygons in plan, and only the nodes inside them: { layer, feature?, where? }' },
    name: { type: 'string', doc: 'the grid layer’s name (default <model>_<stat>_<col>[_cutoff]_<cell>m.asc)' },
  },
  outputs: { key: [] },
  check(p, errs) {
    if (p.cell != null && !(p.cell > 0)) errs.push('cell: a positive number');
    if (p.anchor != null && !(Array.isArray(p.anchor) && p.anchor.length === 2)) errs.push('anchor: [x, y]');
    if (p.cutoff != null && p.cutoff !== 'none' && !(typeof p.cutoff === 'number' && Number.isFinite(p.cutoff))) errs.push('cutoff: a number or "none"');
  },
  async scan(p, ctx) {
    const L = S.layers.find((x) => x.name === p.layer || (x.label || x.name) === p.layer);
    if (!L) throw new Error(`no layer “${p.layer}”`);
    return projectGridLayer(L, { col: p.col, stat: p.stat, cutoff: p.cutoff, density: p.density, densityUnit: p.densityUnit, gradeUnit: p.gradeUnit, metalFactor: p.metalFactor,
      cell: p.cell, anchor: p.anchor || null, filter: p.filter, scope: p.scope, limit: p.limit || null, name: p.name || null, signal: ctx.signal, onProgress: ctx.progress ? (f) => ctx.progress(Math.round(f * 100), 100) : null });
  },
  shape(r, p) {
    return { table: null, values: { blocks: r.blocks, nodes: r.geom.nx * r.geom.ny, filled: r.filled, empty: r.empty, cell: r.geom.dx, peak: r.peak, ...(r.total != null ? { total: r.total } : {}) },
      layers: [r.name], resolved: { ...p, cell: r.geom.dx }, warnings: [] };
  },
});

// ── its palette command ──
registerCommands([
  { id: 'projectgrid', group: 'Layer', title: 'Projection to grid…', kw: 'mip maximum minimum mean projection plan grid column thickness accumulation grade thickness gt tonnes metal per column isopach contour map', when: () => projectableLayers().length > 0, run: (c) => openProjectGridDialog(c.L) },
]);

setProjectionGridOpener((L) => openProjectGridDialog(L || (S.layers.find((x) => x.id === S.activeId) || null)));

// the test seam (window._micro is api.js's; these are this module's own)
try { window._microVis = Object.assign(window._microVis || {}, { projectGrid, projectGridLayer, projectGridGeom, openProjectGridDialog }); } catch { /* headless */ }
