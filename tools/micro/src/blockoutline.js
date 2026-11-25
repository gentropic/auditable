// micro BENCH OUTLINES — the plan outline of a set of blocks (the filtered, the selected, a
// category value, or every category on its own), bench by bench, as POLYGON features: dig lines /
// ore outlines for drill-and-blast, out as DXF or shapefile like any strings & polygons layer.
//
// Per bench, each plan cell of the model's FINE lattice is occupied when the chosen blocks fill at
// least half of it through the bench (rule 'half'; 'any' = any part) — for a regular model, where a
// bench is one block high, that is exactly the chosen blocks. The occupancy is traced by marching
// squares (src/blockoutline-core.js, pure + unit-tested): one polygon per 4-connected region, its
// enclosures as holes, every vertex on an exact lattice corner (the staircase is the truth by
// default; `simplify` drops corners within a stated tolerance in metres, never moving one). A
// rotated model is traced in its own lattice frame and mapped to world; a sub-blocked model on its
// fine lattice, a bench being one PARENT high unless `bench` says otherwise.
//
// Each polygon carries BENCH (the bench's index), Z (its level), Z_BOT / Z_TOP, CATEGORY, BLOCKS
// (blocks whose centre lies in it), CELLS, AREA (m², plan), VOLUME (m³ of the chosen blocks inside
// it) and, with a density, TONNES.
import { S } from './state.js';
import { layerTableHeader } from './records.js';
import { latticeCells, latticeOf, defaultCategoryColumn } from './lattice-cells.js';
import { labelCells, outlineCells, simplifyRing, ringAreaIJ } from './blockoutline-core.js';
import { newFeatureLayer } from './poly-ui.js';
import { mkLineage } from './lineage.js';
import { replaceMade } from './pcgrid.js';
import { floatWin } from './windows.js';
import { registerCommands, contributeMenu, contributeLayerMenu } from './commands.js';
import { registerTool } from './tools.js';
import { supportToWorld } from '../../../ext/condenser/src/main.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;
export const outlineableLayers = () => S.layers.filter((L) => !L.viewOf && latticeOf(L) && layerTableHeader(L));
export const OUTLINE_SCOPES = ['all', 'filtered', 'selection'];
export const OUTLINE_RULES = ['half', 'any'];
export const OUTLINE_LEVELS = ['mid', 'bottom', 'top'];

/**
 * The bench outlines (no layer). opts: layer, scope (all | filtered | selection), where, by (a
 * column: one outline set per value), value (only blocks whose category — `column`, default the
 * layer's — is this), column, density (number or column), bench (m; default one parent block),
 * rule (half | any), simplify (m; 0 = the exact staircase), level (mid | bottom | top).
 * → { features, columns, benches, lattice, … }
 */
export async function blockOutlines(opts = {}) {
  const L = typeof opts.layer === 'object' && opts.layer ? opts.layer : layerNamed(String(opts.layer || ''));
  if (!L) throw new Error(`bench outlines: the block model “${opts.layer}” isn't loaded`);
  const lat0 = latticeOf(L);
  if (!lat0) throw new Error(`bench outlines: ${nameOf(L)} is not a block model on a lattice`);
  const scope = opts.scope || 'all';
  if (!OUTLINE_SCOPES.includes(scope)) throw new Error(`bench outlines: scope is ${OUTLINE_SCOPES.join(' / ')}`);
  let mask = null;
  if (scope === 'selection') { if (!(L._selMask && L._selCount)) throw new Error('bench outlines: no selection on this layer — brush the 3D first'); mask = L._selMask; }
  if (scope === 'filtered') { if (!L._filterMask) throw new Error('bench outlines: no active filter on this layer — run one in the filter box first'); mask = L._filterMask; }
  const rule = opts.rule || 'half';
  if (!OUTLINE_RULES.includes(rule)) throw new Error(`bench outlines: rule is ${OUTLINE_RULES.join(' / ')}`);
  const level = opts.level || 'mid';
  if (!OUTLINE_LEVELS.includes(level)) throw new Error(`bench outlines: level is ${OUTLINE_LEVELS.join(' / ')}`);
  const hasValue = opts.value != null && opts.value !== '';
  const catCol = opts.by || (hasValue ? opts.column || defaultCategoryColumn(L) : null);
  if (hasValue && !catCol) throw new Error(`bench outlines: ${nameOf(L)} has no category column to match “${opts.value}” — name one (column)`);
  const cells = await latticeCells(L, { mask, where: opts.where || null, column: catCol, density: opts.density, signal: opts.signal || null });
  const lat = cells.lattice, P = lat.pitch, c0 = lat.originQ.map((o, a) => o - P[a] / 2);
  let blocks = cells.blocks;
  if (hasValue) blocks = blocks.filter((b) => String(b.cat) === String(opts.value));
  if (!blocks.length) throw new Error(`bench outlines: no blocks ${hasValue ? `with ${catCol} = ${opts.value}` : ''}${scope !== 'all' ? ` in the ${scope}` : ''}${opts.where ? ` where ${opts.where}` : ''}`.replace(/\s+$/, ''));
  // the bench: one parent block high (sub-blocked), one block (regular), or as asked
  let steps = lat.sub ? lat.sizeQMax[2] : 1;
  if (opts.bench != null && opts.bench !== '') {
    steps = Math.round(+opts.bench / P[2]);
    if (!(steps >= 1) || Math.abs(steps * P[2] - +opts.bench) > 1e-6 * Math.max(1, +opts.bench)) throw new Error(`bench outlines: a bench of ${opts.bench} m is not a whole number of the model’s ${P[2]} m steps`);
  }
  // the benches' phase: where a full-height block starts, else the lowest block
  const full = blocks.find((b) => b.size[2] === steps);
  const k0 = full ? full.lo[2] : Math.min(...blocks.map((b) => b.lo[2]));
  const phase = ((k0 % steps) + steps) % steps;
  let iMin = Infinity, jMin = Infinity, iMax = -Infinity, jMax = -Infinity;
  for (const b of blocks) { if (b.lo[0] < iMin) iMin = b.lo[0]; if (b.lo[1] < jMin) jMin = b.lo[1]; if (b.lo[0] + b.size[0] > iMax) iMax = b.lo[0] + b.size[0]; if (b.lo[1] + b.size[1] > jMax) jMax = b.lo[1] + b.size[1]; }
  const nx = iMax - iMin, ny = jMax - jMin;
  if (nx * ny > 64e6) throw new Error(`bench outlines: the plan lattice is ${nx} × ${ny} cells — too large`);
  // per (bench, category): fill (in fine voxels), volume and weight per plan cell
  const groups = new Map();
  const groupOf = (bi, cat) => {
    const key = `${bi}\u0000${cat == null ? '' : cat}`;
    let g = groups.get(key);
    if (!g) {
      if (groups.size >= 4096) throw new Error('bench outlines: more than 4096 bench × category sets — choose a value, or fewer categories');
      groups.set(key, (g = { bench: bi, cat: cat == null ? '' : String(cat), fill: new Float32Array(nx * ny), vol: new Float64Array(nx * ny), w: new Float64Array(nx * ny), centres: [] }));
    }
    return g;
  };
  for (const b of blocks) {
    const kb = b.lo[2], kt = b.lo[2] + b.size[2], cat = cells.column && !hasValue ? b.cat : (hasValue ? String(opts.value) : null);
    const ncell = b.size[0] * b.size[1] * b.size[2];
    const b0 = Math.floor((kb - phase) / steps), b1 = Math.floor((kt - 1 - phase) / steps);
    const ck = kb + b.size[2] / 2, cb = Math.floor((ck - phase) / steps);
    for (let bi = b0; bi <= b1; bi++) {
      const lo = Math.max(kb, phase + bi * steps), hi = Math.min(kt, phase + (bi + 1) * steps), ov = hi - lo;
      if (ov <= 0) continue;
      const g = groupOf(bi, cat), fv = ov / ncell;
      for (let j = b.lo[1]; j < b.lo[1] + b.size[1]; j++) for (let i = b.lo[0]; i < b.lo[0] + b.size[0]; i++) {
        const c = (i - iMin) + (j - jMin) * nx;
        g.fill[c] += ov; g.vol[c] += b.vol * fv; g.w[c] += b.w * fv;
      }
      if (bi === cb) g.centres.push((b.lo[0] + Math.floor(b.size[0] / 2) - iMin) + (b.lo[1] + Math.floor(b.size[1] / 2) - jMin) * nx);
    }
  }
  const tol = +opts.simplify > 0 ? +opts.simplify : 0;
  const cellArea = P[0] * P[1];
  const toW = (u, v, w) => supportToWorld(lat.frame, u, v, w, [0, 0, 0]);
  const features = [], benchRows = new Map();
  const sorted = [...groups.values()].sort((a, b) => a.bench - b.bench || (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0));
  for (const g of sorted) {
    const occ = new Uint8Array(nx * ny);
    for (let c = 0; c < nx * ny; c++) occ[c] = rule === 'any' ? (g.fill[c] > 0 ? 1 : 0) : (g.fill[c] >= steps / 2 - 1e-9 ? 1 : 0);
    const labs = labelCells(occ, nx, ny);
    if (!labs.count) continue;
    const rVol = new Float64Array(labs.count + 1), rW = new Float64Array(labs.count + 1), rBlocks = new Int32Array(labs.count + 1);
    for (let c = 0; c < nx * ny; c++) { const id = labs.label[c]; if (id) { rVol[id] += g.vol[c]; rW[id] += g.w[c]; } }
    for (const c of g.centres) { const id = labs.label[c]; if (id) rBlocks[id]++; }
    const wBot = c0[2] + (phase + g.bench * steps) * P[2], wTop = wBot + steps * P[2];
    const wAt = level === 'bottom' ? wBot : level === 'top' ? wTop : (wBot + wTop) / 2;
    const zBot = toW(c0[0], c0[1], wBot)[2], zTop = toW(c0[0], c0[1], wTop)[2], zAt = toW(c0[0], c0[1], wAt)[2];
    const regions = outlineCells(occ, nx, ny, labs);
    for (const rg of regions) {
      // corners → the lattice plan (u, v) in metres, simplified there (R is a rotation: distances keep), then world
      const plan = (ring) => ring.map(([i, j]) => [c0[0] + (i + iMin) * P[0], c0[1] + (j + jMin) * P[1]]);
      let outer = plan(rg.outer), holes = rg.holes.map(plan);
      if (tol) { outer = simplifyRing(outer, tol); holes = holes.map((h) => simplifyRing(h, tol)).filter((h) => h.length >= 3 && Math.abs(ringAreaIJ(h)) > 0); }
      const area = Math.abs(ringAreaIJ(outer)) - holes.reduce((s, h) => s + Math.abs(ringAreaIJ(h)), 0);
      const rings = [outer, ...holes].map((r) => r.map(([u, v]) => toW(u, v, wAt)));
      features.push({
        kind: 'polygon', closed: true, rings, parts: [rings.map((_, i) => i)],
        attrs: {
          BENCH: g.bench, Z: +zAt.toFixed(4), Z_BOT: +zBot.toFixed(4), Z_TOP: +zTop.toFixed(4), CATEGORY: g.cat,
          BLOCKS: rBlocks[rg.label], CELLS: rg.cells, AREA: +area.toFixed(4), VOLUME: +rVol[rg.label].toFixed(4),
          ...(cells.density != null ? { TONNES: +rW[rg.label].toFixed(4) } : {}),
          HOLES: holes.length, VERTICES: rings.reduce((s, r) => s + r.length, 0),
        },
      });
    }
    const br = benchRows.get(g.bench) || { bench: g.bench, z: zAt, polygons: 0, area: 0, volume: 0, tonnes: 0 };
    br.polygons += regions.length; br.volume += regions.reduce((s, rg) => s + rVol[rg.label], 0); br.tonnes += regions.reduce((s, rg) => s + rW[rg.label], 0);
    br.area += features.slice(features.length - regions.length).reduce((s, f) => s + f.attrs.AREA, 0);
    benchRows.set(g.bench, br);
  }
  const columns = ['BENCH', 'Z', 'Z_BOT', 'Z_TOP', 'CATEGORY', 'BLOCKS', 'CELLS', 'AREA', 'VOLUME', ...(cells.density != null ? ['TONNES'] : []), 'HOLES', 'VERTICES'];
  return { L, features, columns, benches: [...benchRows.values()].sort((a, b) => a.bench - b.bench), lattice: lat, steps, phase, cellArea, column: cells.column, density: cells.density, scope, rule, level, simplify: tol, blocks: blocks.length };
}

/** Bench outlines → a new strings & polygons layer. → { id, name, polygons, benches, … } */
export async function blockOutlinesToLayer(opts = {}) {
  const r = await blockOutlines(opts);
  if (!r.features.length) throw new Error('bench outlines: no cell is filled enough to outline (rule half: at least half a bench) — try rule any');
  const nm = (opts.name || `${nameOf(r.L).replace(/\.[^.]+$/, '')}_outlines${opts.value != null && opts.value !== '' ? '_' + opts.value : ''}`).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/\.csv$/i, '');
  const model = {
    columns: r.columns, crs: null, warnings: [],
    features: r.features.map((f, i) => ({ id: i + 1, kind: f.kind, rings: f.rings, parts: f.parts, closed: true })),
    rows: r.features.map((f) => r.columns.map((c) => (f.attrs[c] === undefined ? '' : f.attrs[c]))),
  };
  replaceMade(`${nm}.csv`);
  const L = newFeatureLayer(nm, model, { source: 'outlines', poly: { cat: r.column ? 'CATEGORY' : null } });
  const params = { layer: r.L.name, scope: r.scope, ...(opts.where ? { where: String(opts.where) } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.value != null && opts.value !== '' ? { value: opts.value, column: r.column } : {}), ...(r.density != null ? { density: r.density } : {}), bench: r.steps * r.lattice.pitch[2], rule: r.rule, level: r.level, simplify: r.simplify, polygons: r.features.length, blocks: r.blocks };
  L.lineage = mkLineage('blockoutlines', params, [r.L.lineage]);
  L.memoryOnly = true;
  return { id: L.id, name: L.name, polygons: r.features.length, benches: r.benches, area: r.features.reduce((s, f) => s + f.attrs.AREA, 0), volume: r.features.reduce((s, f) => s + f.attrs.VOLUME, 0), tonnes: r.density != null ? r.features.reduce((s, f) => s + f.attrs.TONNES, 0) : null, cellArea: r.cellArea, steps: r.steps };
}

// ── the dialog ───────────────────────────────────────────────────────────────
let _win = null;
export function openBlockOutlines(L0 = null) {
  const layers = outlineableLayers();
  if (!layers.length) { $('#meta').textContent = 'bench outlines: open a block model first'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const B0 = L0 && layers.includes(L0) ? L0 : layers[0];
  const d = { layer: B0.name, scope: B0._selCount ? 'selection' : B0._filterMask ? 'filtered' : 'all', where: '', mode: 'all', by: '', value: '', density: '', rule: 'half', level: 'mid', simplify: 0, name: '' };
  const win = floatWin({ title: 'bench outlines', sub: 'blocks → plan polygons per bench', x: Math.max(12, innerWidth - 450), y: 100, w: 420, h: 480, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.blockoutlines = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Outline'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg);
  win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 84px;color:var(--text)'; s.textContent = label; r.append(s, el); form.appendChild(r); return el; };
  const sel = (opts, val, onch) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val); s.onchange = () => onch(s.value); return s; };
  const txt = (val, onch, ph = '') => { const i = document.createElement('input'); i.className = 'sw-in'; i.style.flex = '1'; i.value = String(val); i.placeholder = ph; i.oninput = () => onch(i.value.trim()); return i; };
  const build = () => {
    form.textContent = '';
    row('model', sel(layers.map((L) => [L.name, nameOf(L)]), d.layer, (v) => { d.layer = v; build(); }), 'the block model');
    const BL = layerNamed(d.layer), h = layerTableHeader(BL), cat = defaultCategoryColumn(BL);
    row('blocks', sel([['all', 'every block'], ...(BL._filterMask ? [['filtered', 'the filtered blocks']] : []), ...(BL._selCount ? [['selection', `the selected (${BL._selCount.toLocaleString()})`]] : [])], d.scope, (v) => { d.scope = v; }), 'which blocks are outlined');
    row('where', txt(d.where, (v) => { d.where = v; }, 'e.g. AU >= 0.5'), 'only the blocks this expression keeps (on top of the choice above)');
    row('outline', sel([['all', 'all of them, one set'], ['by', 'each category on its own'], ['value', 'one category value']], d.mode, (v) => { d.mode = v; build(); }), 'one outline for the chosen blocks, one per category value, or just one value');
    if (d.mode === 'by') row('by', sel(h.columns.map((c) => [c, c]), d.by || cat || h.columns[0], (v) => { d.by = v; }), 'the column whose values each get their own outlines');
    if (d.mode === 'value') {
      if (!d.by) d.by = cat || h.columns[0];
      row('column', sel(h.columns.map((c) => [c, c]), d.by, (v) => { d.by = v; }), 'the category column');
      row('value', txt(d.value, (v) => { d.value = v; }, 'e.g. ORE'), 'the value outlined');
    }
    row('density', txt(d.density, (v) => { d.density = v; }, 't/m³ or a column (optional)'), 'with a density each polygon carries its tonnes');
    row('rule', sel([['half', 'a cell is in when half the bench is filled'], ['any', 'a cell is in when any of it is']], d.rule, (v) => { d.rule = v; }), 'for a regular model (a bench = a block) both give the blocks exactly');
    row('at', sel([['mid', 'the bench’s middle'], ['bottom', 'the floor'], ['top', 'the crest']], d.level, (v) => { d.level = v; }), 'the level the polygons sit at');
    const sm = document.createElement('input'); sm.className = 'sw-in'; sm.type = 'number'; sm.step = 'any'; sm.min = '0'; sm.value = String(d.simplify); sm.style.width = '80px'; sm.oninput = () => { d.simplify = Math.max(0, +sm.value || 0); };
    row('simplify (m)', sm, '0 keeps the exact lattice staircase; a tolerance drops corners within it (Douglas–Peucker) — vertices are kept or dropped, never moved');
    row('name', txt(d.name, (v) => { d.name = v; }, 'automatic'), 'the new layer’s name');
    note.textContent = 'one polygon per connected patch per bench (holes kept), every vertex on a lattice corner unless simplified. Each carries its bench, level, block count, area, volume (and tonnes with a density) — export as DXF or shapefile for the drill-and-blast design.';
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'outlining…';
    try {
      const r = await blockOutlinesToLayer({ layer: d.layer, scope: d.scope, where: d.where || null, ...(d.mode === 'by' ? { by: d.by || defaultCategoryColumn(layerNamed(d.layer)) } : {}), ...(d.mode === 'value' ? { column: d.by, value: d.value } : {}), density: d.density === '' ? null : (Number.isFinite(+d.density) ? +d.density : d.density), rule: d.rule, level: d.level, simplify: d.simplify, name: d.name || null });
      msg.textContent = `${r.polygons} polygon${r.polygons === 1 ? '' : 's'} on ${r.benches.length} bench${r.benches.length === 1 ? '' : 'es'} → ${r.name}`;
      $('#meta').textContent = `bench outlines: ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}

// ── the routine tool ─────────────────────────────────────────────────────────
registerTool('blockoutlines', {
  label: 'bench outlines', cache: false, makes: 'layer',
  params: {
    layer: { type: 'layer', required: true, kinds: ['blocks'], doc: 'the block model' },
    scope: { type: 'enum', values: OUTLINE_SCOPES.slice(), default: 'all', routine: ['all', 'filtered'], why: 'a selection isn’t saved with a routine', doc: 'which blocks: all, the filtered, the 3D selection' },
    where: { type: 'expr', of: 'layer', doc: 'only the blocks this expression keeps' },
    by: { type: 'column', of: 'layer', doc: 'one set of outlines per value of this column' },
    column: { type: 'column', of: 'layer', doc: 'with value: the category column (default the model’s category)' },
    value: { type: 'any', doc: 'only the blocks whose category is this value' },
    density: { type: 'any', doc: 'a density (t/m³) or a column — each polygon then carries TONNES' },
    bench: { type: 'number', doc: 'the bench height (m) — a whole number of the model’s steps (default one block; a sub-blocked model’s parent)' },
    rule: { type: 'enum', values: OUTLINE_RULES.slice(), default: 'half', doc: 'half: a plan cell is in when the blocks fill at least half of it through the bench · any: when they fill any of it' },
    level: { type: 'enum', values: OUTLINE_LEVELS.slice(), default: 'mid', doc: 'the level the polygons sit at: the bench’s middle, floor or crest' },
    simplify: { type: 'number', default: 0, doc: 'a tolerance (m): drop staircase corners within it (Douglas–Peucker; 0 = the exact lattice edges)' },
    name: { type: 'string', doc: 'the new layer’s name (default <model>_outlines)' },
  },
  outputs: { key: ['bench'] },
  check(p, errs) {
    if (p.by && p.value != null && p.value !== '') errs.push('by and value: one or the other — every value on its own, or one value');
    if (p.simplify != null && !(p.simplify >= 0)) errs.push('simplify: a tolerance in metres, 0 or more');
    if (p.bench != null && !(p.bench > 0)) errs.push('bench: a positive height in metres');
  },
  async scan(p) { return blockOutlinesToLayer({ ...p }); },
  shape(r, p) {
    return { table: { columns: ['bench', 'z', 'polygons', 'area', 'volume', ...(r.tonnes != null ? ['tonnes'] : [])], key: ['bench'], rows: r.benches.map((b) => [b.bench, +b.z.toFixed(3), b.polygons, +b.area.toFixed(3), +b.volume.toFixed(3), ...(r.tonnes != null ? [+b.tonnes.toFixed(3)] : [])]), units: { area: 'm²', volume: 'm³', tonnes: 't' } },
      values: { polygons: r.polygons, area: r.area, volume: r.volume, ...(r.tonnes != null ? { tonnes: r.tonnes } : {}) }, layers: [r.name], resolved: { ...p }, warnings: [] };
  },
});

// ── palette + menus ──
export function blockOutlineMenuItems(L) {
  if (L.viewOf || !latticeOf(L)) return [];
  return [{ label: 'Bench outlines → polygons…', action: () => openBlockOutlines(L) }];
}
contributeLayerMenu('geometry', blockOutlineMenuItems);
registerCommands([
  { id: 'blockoutlines', group: 'Layer', title: 'Bench outlines → polygons…', kw: 'outline polygon bench dig line ore outline blast drill and blast marching squares plan footprint block model selection filter category dxf shapefile', when: () => outlineableLayers().length > 0, run: (c) => openBlockOutlines(c.L && latticeOf(c.L) ? c.L : null) },
]);
contributeMenu('tools', () => (outlineableLayers().length ? [{ label: 'Bench outlines → polygons…', action: () => openBlockOutlines(null) }] : []));
