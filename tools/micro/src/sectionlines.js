// micro SECTION LINES — where a section plane cuts a solid or surface MESH, a GRIDDED surface or
// the DOMAIN BOUNDARIES of a block model, as a strings & polygons layer (src/polygons.js): one
// feature per chained polyline, in world 3D, with its attributes — the source layer, what kind of
// cut it is, for a domain boundary the two values either side, the plane and its position, the
// length. Exportable as DXF / shapefile / WKT-CSV / GeoJSON like any feature layer: a pit shell's
// bench toe on a plan, an ore/waste contact on a cross-section, for CAD and survey.
//
// The plane: the current section (any axis, a dip / dip-direction, a knife cut), or one stated —
// { axis: 'x'|'y'|'z', position } · { normal: [x, y, z], position } · { dipDir, dip, position } —
// with `at: [x, y, z]` in place of a position, and `positions: [..]` for a series of parallel planes
// (every bench) into one layer. A closed line on a PLAN becomes a polygon (usable as a limit); on
// any other plane a closed line stays a closed string.
//
// The geometry is src/sectionlines-core.js (pure, unit-tested): mesh cuts keyed by the mesh edge, a
// grid as a triangulated heightfield, domain boundaries as the shared faces of differing blocks on
// the fine lattice (rotated and sub-blocked models included) keyed by the lattice edge — so every
// segment meets its neighbour exactly and the chaining never guesses.
import { S } from './state.js';
import { meshVertexData, layerTableHeader } from './records.js';
import { residentGridForEval } from './bygeom.js';
import { sectionWorld } from './section.js';
import { layerWorldBbox } from './gridtools.js';
import { gridAxesOf } from './grid-ops.js';
import { latticeCells, defaultCategoryColumn } from './lattice-cells.js';
import { meshPlaneSegments, gridToMesh, latticeBoundarySegments, chainSegments, lineLength } from './sectionlines-core.js';
import { newFeatureLayer } from './poly-ui.js';
import { mkLineage } from './lineage.js';
import { replaceMade } from './pcgrid.js';
import { floatWin } from './windows.js';
import { registerCommands, contributeMenu, contributeLayerMenu } from './commands.js';
import { registerTool } from './tools.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;
export const SECTIONLINE_KINDS = ['mesh', 'grid', 'domain'];

// what a layer can give: 'mesh' (a context-tier mesh), 'grid' (a gridded surface), 'domain' (a block model) or null
export function sectionKindOf(L) {
  if (!L || !L.docs) return null;
  if (L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup) return 'mesh';
  if (L.docs.gridDoc && L.docs.gridDoc.grid) return 'grid';
  if (gridAxesOf(L) && L.docs.blockDoc && layerTableHeader(L)) return 'domain';
  return null;
}
export const sectionableLayers = () => S.layers.filter((L) => L.visible !== false && sectionKindOf(L) && !L.viewOf);

// a plane spec → [{ n, pos, mode, label }]
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); if (!(l > 0)) throw new Error('section lines: a plane normal must not be zero'); return v.map((c) => c / l); };
export function resolvePlanes(plane, positions = null) {
  let n, pos = null, mode;
  if (plane == null || plane === 'current') {
    const w = sectionWorld();
    if (!w) throw new Error('section lines: there is no section on — turn one on, or state a plane ({ axis, position })');
    n = w.normal.slice(); pos = w.position; mode = w.mode;
  } else if (typeof plane === 'object') {
    if (plane.axis != null) {
      const a = { x: 0, y: 1, z: 2 }[String(plane.axis).toLowerCase()];
      if (a == null) throw new Error(`section lines: axis is x, y or z (got ${JSON.stringify(plane.axis)})`);
      n = [0, 0, 0]; n[a] = 1; mode = ['ns', 'ew', 'plan'][a];
    } else if (plane.normal != null) {
      const v = [].concat(plane.normal).map(Number);
      if (v.length !== 3 || v.some((c) => !Number.isFinite(c))) throw new Error('section lines: normal is three numbers');
      n = unit(v); mode = Math.abs(n[2]) > 0.999999 ? 'plan' : 'custom';
    } else if (plane.dipDir != null || plane.dip != null) {
      const a = (+plane.dipDir || 0) * Math.PI / 180, d = Math.max(0, Math.min(90, +plane.dip || 0)) * Math.PI / 180;
      n = unit([-Math.sin(a) * Math.sin(d), -Math.cos(a) * Math.sin(d), Math.cos(d)]); mode = d === 0 ? 'plan' : 'custom';
    } else throw new Error('section lines: say which plane — axis, normal, or dipDir + dip (or "current")');
    if (plane.at != null) { const p = [].concat(plane.at).map(Number); if (p.length !== 3 || p.some((c) => !Number.isFinite(c))) throw new Error('section lines: at is [x, y, z]'); pos = n[0] * p[0] + n[1] * p[1] + n[2] * p[2]; }
    else if (plane.position != null) { pos = +plane.position; if (!Number.isFinite(pos)) throw new Error('section lines: position must be a number'); }
  } else throw new Error(`section lines: plane is "current" or { axis | normal | dipDir, position } (got ${JSON.stringify(plane)})`);
  const list = positions && positions.length ? positions.map(Number) : [pos];
  if (list.some((p) => p == null || !Number.isFinite(p))) throw new Error('section lines: the plane needs a position (or at: [x, y, z], or positions: [..])');
  const label = mode === 'plan' ? 'plan' : mode === 'ns' ? 'N–S' : mode === 'ew' ? 'E–W' : 'oblique';
  return list.map((p) => ({ n, pos: p, mode, label }));
}

/**
 * The section lines (no layer). opts: plane, positions, sources (layers or names; default every
 * visible mesh, grid and block model with a category), kinds (subset of mesh / grid / domain),
 * column (the category for domain boundaries; default the layer's category), outer (domain
 * boundaries also against empty space), where (only the blocks this keeps).
 * → { features: [{ rings, closed, attrs }], columns, planes, perSource: [{ layer, kind, lines, length }] }
 */
export async function sectionLines(opts = {}) {
  const planes = resolvePlanes(opts.plane, opts.positions);
  const kinds = opts.kinds ? [].concat(opts.kinds) : SECTIONLINE_KINDS.slice();
  for (const k of kinds) if (!SECTIONLINE_KINDS.includes(k)) throw new Error(`section lines: kinds are ${SECTIONLINE_KINDS.join(' / ')} (got ${JSON.stringify(k)})`);
  let src = opts.sources != null ? [].concat(opts.sources).map((s) => (typeof s === 'object' && s ? s : layerNamed(String(s)))) : null;
  if (src && src.some((x) => !x)) throw new Error(`section lines: ${[].concat(opts.sources).filter((s) => typeof s !== 'object' && !layerNamed(String(s))).map((s) => `“${s}”`).join(', ')} isn't loaded`);
  if (!src) src = sectionableLayers().filter((L) => sectionKindOf(L) !== 'domain' || defaultCategoryColumn(L) || opts.column);
  src = src.filter((L) => kinds.includes(sectionKindOf(L)));
  if (!src.length) throw new Error('section lines: nothing to cut — a mesh, a gridded surface, or a block model with a category');
  const columns = ['SOURCE', 'KIND', 'BOUNDARY', 'CAT_A', 'CAT_B', 'PLANE', 'POSITION', 'LENGTH'];
  const features = [], perSource = [];
  const plan = planes[0].mode === 'plan';
  for (const L of src) {
    const kind = sectionKindOf(L);
    let mesh = null, cells = null, column = null;
    if (kind === 'mesh') {
      mesh = await meshVertexData(L);
      if (!mesh) throw new Error(`section lines: ${nameOf(L)} keeps no triangles to cut (a streamed mesh — convert it to exact first)`);
    } else if (kind === 'grid') {
      const b = layerWorldBbox(L);
      const g = await residentGridForEval(L, b ? [b[0], b[1], b[3], b[4]] : null);
      mesh = gridToMesh(g);
    } else {
      column = opts.column || defaultCategoryColumn(L);
      if (!column) throw new Error(`section lines: ${nameOf(L)} has no category column — name one (column)`);
      const mask = L.filterExpr && L._filterMask ? L._filterMask : null;
      cells = await latticeCells(L, { mask, where: opts.where || null, column });
    }
    let nLines = 0, len = 0;
    for (const pl of planes) {
      let segs;
      if (cells) segs = latticeBoundarySegments(cells.blocks, cells.lattice, pl.n, pl.pos, { outer: !!opts.outer });
      else segs = meshPlaneSegments(mesh.vertices, mesh.triangles, pl.n, pl.pos);
      const groups = new Map();
      if (cells) for (const s of segs) { const k = s.pair.join('\u0000'); let g = groups.get(k); if (!g) groups.set(k, (g = { pair: s.pair, segs: [] })); g.segs.push(s); }
      else groups.set('', { pair: null, segs });
      for (const g of groups.values()) {
        for (const line of chainSegments(g.segs)) {
          if (line.pts.length < 2) continue;
          const L3 = lineLength(line.pts, line.closed);
          const poly = line.closed && plan && line.pts.length >= 3;
          const rings = [line.closed && !poly ? [...line.pts, line.pts[0]] : line.pts];
          features.push({
            kind: poly ? 'polygon' : 'line', closed: poly, rings, parts: [[0]],
            attrs: { SOURCE: nameOf(L), KIND: kind, BOUNDARY: g.pair ? g.pair.map((v) => (v === '' ? '(none)' : v)).join(' / ') : '', CAT_A: g.pair ? g.pair[0] : '', CAT_B: g.pair ? g.pair[1] : '', PLANE: pl.label, POSITION: +pl.pos.toFixed(4), LENGTH: +L3.toFixed(4) },
          });
          nLines++; len += L3;
        }
      }
    }
    perSource.push({ layer: nameOf(L), name: L.name, kind, lines: nLines, length: len, column });
  }
  return { features, columns, planes, perSource };
}

/** Section lines → a new strings & polygons layer. → { id, name, features, perSource, … } */
export async function sectionLinesToLayer(opts = {}) {
  const r = await sectionLines(opts);
  if (!r.features.length) throw new Error(`section lines: the plane cuts nothing in ${r.perSource.map((p) => p.layer).join(', ')}`);
  const P = r.planes[0];
  const nm = (opts.name || `sectionlines_${P.label === 'N–S' ? 'NS' : P.label === 'E–W' ? 'EW' : P.label}_${r.planes.length > 1 ? `${r.planes.length}x` : +P.pos.toFixed(2)}`).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/\.csv$/i, '');
  const model = {
    columns: r.columns, crs: null, warnings: [],
    features: r.features.map((f, i) => ({ id: i + 1, kind: f.kind, rings: f.rings, parts: f.parts, closed: f.closed })),
    rows: r.features.map((f) => r.columns.map((c) => f.attrs[c])),
  };
  replaceMade(`${nm}.csv`);                                 // a re-run replaces its own earlier layer
  const domainOnly = r.perSource.every((p) => p.kind === 'domain');
  const L = newFeatureLayer(nm, model, { source: 'sectionlines', poly: { cat: domainOnly ? 'BOUNDARY' : 'SOURCE' } });
  const params = { plane: { normal: P.n.map((v) => +v.toFixed(9)), ...(r.planes.length > 1 ? { positions: r.planes.map((p) => p.pos) } : { position: P.pos }) }, sources: r.perSource.map((p) => p.name), kinds: [...new Set(r.perSource.map((p) => p.kind))], ...(r.perSource.some((p) => p.column) ? { column: r.perSource.find((p) => p.column).column } : {}), ...(opts.outer ? { outer: true } : {}), ...(opts.where ? { where: String(opts.where) } : {}), lines: r.features.length };
  L.lineage = mkLineage('sectionlines', params, r.perSource.map((p) => (layerNamed(p.name) || {}).lineage));
  L.memoryOnly = true;
  return { id: L.id, name: L.name, features: r.features.length, perSource: r.perSource, planes: r.planes.length, length: r.features.reduce((s, f) => s + f.attrs.LENGTH, 0), closed: r.features.filter((f) => f.closed || (f.rings[0].length > 2 && f.rings[0][0] === f.rings[0][f.rings[0].length - 1])).length };
}

// ── the dialog ───────────────────────────────────────────────────────────────
let _win = null;
export function openSectionLines(L0 = null) {
  const layers = sectionableLayers();
  if (!layers.length) { $('#meta').textContent = 'section lines: open a mesh, a gridded surface or a block model first'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const w0 = sectionWorld();
  const d = { plane: w0 ? 'current' : 'z', pos: 0, dipDir: 0, dip: 60, positions: '', src: new Set(L0 && sectionKindOf(L0) ? [L0.name] : layers.filter((L) => sectionKindOf(L) !== 'domain' || defaultCategoryColumn(L)).map((L) => L.name)), column: '', outer: false, name: '' };
  const bb = (() => { const L = L0 || layers[0], b = layerWorldBbox(L); return b; })();
  if (bb) d.pos = +((bb[2] + bb[5]) / 2).toFixed(2);
  const win = floatWin({ title: 'section lines', sub: 'cuts → strings & polygons', x: Math.max(12, innerWidth - 450), y: 100, w: 420, h: 460, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.sectionlines = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Make lines'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg);
  win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 84px;color:var(--text)'; s.textContent = label; r.append(s, el); form.appendChild(r); return el; };
  const sel = (opts, val, onch) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val); s.onchange = () => onch(s.value); return s; };
  const num = (val, onch, w = 90) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = 'any'; i.value = String(val); i.style.width = w + 'px'; i.oninput = () => onch(+i.value); return i; };
  const build = () => {
    form.textContent = '';
    row('plane', sel([...(w0 ? [['current', `the current section (${w0.mode})`]] : []), ['z', 'plan at a level (z)'], ['x', 'N–S at an easting (x)'], ['y', 'E–W at a northing (y)'], ['dd', 'dip / dip-direction']], d.plane, (v) => { d.plane = v; build(); }), 'the plane the cuts are made on');
    if (d.plane === 'dd') {
      const dr = document.createElement('div'); dr.style.cssText = 'display:flex;gap:6px;align-items:center';
      dr.append(num(d.dip, (v) => { d.dip = v; }, 60), document.createTextNode('/'), num(d.dipDir, (v) => { d.dipDir = v; }, 60));
      row('dip/dir', dr, 'the plane’s dip and dip direction, degrees');
    }
    if (d.plane !== 'current') {
      row('position', num(d.pos, (v) => { d.pos = v; }), d.plane === 'dd' ? 'n·p — the plane’s offset along its pole (world)' : 'the level / easting / northing of the plane (world)');
      const ps = document.createElement('input'); ps.className = 'sw-in'; ps.style.flex = '1'; ps.placeholder = 'or a series: 800, 810, 820…'; ps.value = d.positions; ps.oninput = () => { d.positions = ps.value; };
      row('series', ps, 'several parallel planes into one layer — every bench, every section line');
    }
    const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;max-height:120px;overflow:auto';
    for (const L of layers) {
      const k = sectionKindOf(L), lab = document.createElement('label'); lab.style.cssText = 'display:flex;gap:6px;align-items:center';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.src.has(L.name); cb.dataset.layer = L.name;
      cb.onchange = () => { if (cb.checked) d.src.add(L.name); else d.src.delete(L.name); };
      lab.append(cb, document.createTextNode(`${nameOf(L)} (${k === 'domain' ? 'domain boundaries' : k})`)); box.append(lab);
    }
    row('cut', box, 'the layers cut: meshes (solids, surfaces), gridded surfaces, block models (the boundaries between domains)');
    if ([...d.src].some((n) => sectionKindOf(layerNamed(n)) === 'domain')) {
      const bl = [...d.src].map(layerNamed).find((L) => sectionKindOf(L) === 'domain');
      const h = layerTableHeader(bl);
      row('domain by', sel([['', `the category (${defaultCategoryColumn(bl) || 'none'})`], ...h.columns.map((c) => [c, c])], d.column, (v) => { d.column = v; }), 'the column whose change of value is the boundary');
      const ob = document.createElement('input'); ob.type = 'checkbox'; ob.checked = d.outer; ob.onchange = () => { d.outer = ob.checked; };
      row('model edge', ob, 'also the boundary between a domain and no block (the model’s edge, a filtered-out block)');
    }
    const nm = document.createElement('input'); nm.className = 'sw-in'; nm.style.flex = '1'; nm.value = d.name; nm.placeholder = 'automatic'; nm.oninput = () => { d.name = nm.value.trim(); };
    row('name', nm, 'the new layer’s name');
    note.textContent = 'each cut becomes a polyline feature (world 3D) carrying its source, its kind, the two domains either side and the plane — a strings & polygons layer to export as DXF, shapefile or WKT-CSV. On a plan, a closed line is a polygon (a limit for the analyses).';
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'cutting…';
    try {
      const series = d.positions.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).map(Number);
      const plane = d.plane === 'current' ? 'current' : d.plane === 'dd' ? { dipDir: d.dipDir, dip: d.dip, position: d.pos } : { axis: d.plane, position: d.pos };
      const r = await sectionLinesToLayer({ plane, positions: series.length && d.plane !== 'current' ? series : null, sources: [...d.src], column: d.column || null, outer: d.outer, name: d.name || null });
      msg.textContent = `${r.features} line${r.features === 1 ? '' : 's'} · ${Math.round(r.length).toLocaleString()} m → ${r.name}`;
      $('#meta').textContent = `section lines: ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}

// ── the routine tool ─────────────────────────────────────────────────────────
registerTool('sectionlines', {
  label: 'section lines', cache: false, makes: 'layer',
  params: {
    plane: { type: 'any', default: 'current', doc: '"current" (the section on now), or { axis: x|y|z, position } · { normal: [x, y, z], position } · { dipDir, dip, position } — `at: [x, y, z]` in place of a position' },
    positions: { type: 'numbers', doc: 'a series of parallel planes (the plane’s normal at each of these positions) into one layer — every bench' },
    sources: { type: 'any', doc: 'the layer(s) cut — a name or a list (default: every visible mesh, gridded surface and block model with a category)' },
    kinds: { type: 'any', doc: 'which kinds of cut: a list of mesh / grid / domain (default all three)' },
    column: { type: 'string', doc: 'domain boundaries: the column whose change of value is the boundary (default the block model’s category)' },
    outer: { type: 'bool', default: false, doc: 'domain boundaries: also between a domain and no block (the model’s edge)' },
    where: { type: 'expr', doc: 'domain boundaries: only the blocks this expression keeps' },
    name: { type: 'string', doc: 'the new layer’s name (default sectionlines_<plane>_<position>)' },
  },
  outputs: { key: [] },
  check(p, errs) {
    if (p.plane !== 'current' && (typeof p.plane !== 'object' || p.plane == null || Array.isArray(p.plane))) errs.push('plane: "current" or { axis, position } / { normal, position } / { dipDir, dip, position }');
    if (p.plane && typeof p.plane === 'object') for (const k of Object.keys(p.plane)) if (!['axis', 'normal', 'dipDir', 'dip', 'position', 'at'].includes(k)) errs.push(`plane: no setting “${k}” (axis, normal, dipDir, dip, position, at)`);
    if (p.kinds != null) for (const k of [].concat(p.kinds)) if (!SECTIONLINE_KINDS.includes(k)) errs.push(`kinds: ${JSON.stringify(k)} is not one of ${SECTIONLINE_KINDS.join(' / ')}`);
    if (p.sources != null && ![].concat(p.sources).every((s) => typeof s === 'string')) errs.push('sources: a layer name or a list of names');
  },
  async scan(p) { return sectionLinesToLayer({ ...p }); },
  shape(r, p) {
    return { table: { columns: ['source', 'kind', 'lines', 'length'], key: ['source'], rows: r.perSource.map((x) => [x.layer, x.kind, x.lines, +x.length.toFixed(3)]), units: { length: 'm' } },
      values: { lines: r.features, length: r.length, planes: r.planes }, layers: [r.name], resolved: { ...p }, warnings: [] };
  },
});

// ── palette + menus ──
export function sectionLineMenuItems(L) {
  const k = sectionKindOf(L);
  if (!k || L.viewOf) return [];
  return [{ label: k === 'domain' ? 'Domain boundaries on a section → strings…' : 'Section lines → strings…', action: () => openSectionLines(L) }];
}
contributeLayerMenu('geometry', sectionLineMenuItems);
registerCommands([
  { id: 'sectionlines', group: 'Layer', title: 'Section lines → strings…', kw: 'section cut intersection lines strings polylines contour toe crest bench domain boundary contact mesh solid surface grid dxf shapefile cad survey export', when: () => sectionableLayers().length > 0, run: (c) => openSectionLines(c.L && sectionKindOf(c.L) ? c.L : null) },
]);
contributeMenu('tools', () => (sectionableLayers().length ? [{ label: 'Section lines → strings…', action: () => openSectionLines(null) }] : []));

