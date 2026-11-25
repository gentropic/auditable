// micro EXTRUDE — polygons → CLOSED SOLID mesh layers, the producing op that makes a strings &
// polygons layer load-bearing: a blast outline extruded between two bench surfaces becomes a solid
// the by-solid machinery takes unchanged (select / flag / fraction / assign domains / the factors'
// volumes) — grade and tonnes in the shot.
//
// Three modes (the geometry is src/extrude-core.js, pure and unit-tested):
//   zrange    the polygon × [z0, z1] — a vertical prism. Tagged on the layer (L._prism): the by-solid
//             FRACTION of a regular model then skips winding's sampling and computes it EXACTLY —
//             each block column's plan area inside (the cell clipped to the polygon) × the block's z
//             overlap (bygeom.js evalSolidOnGrid). The tag lives for the session; a reopened project
//             reads the solid as any other mesh (sampled fraction).
//   oriented  along a direction (trend / plunge in degrees, or a vector) for a length
//   between   walls on the polygon; the caps are the TOP and BOTTOM surfaces — a grid layer, a
//             mesh (its top, rasterized at its own cell), or a number — sampled on a plan
//             triangulation refined until each cap is within `tol` of its surface
// Every solid is checked watertight and outward (manifoldCheck) before it becomes a layer; one that
// fails is refused with the count of bad edges, never handed to winding. The layer carries lineage
// (op extrude: the polygon layer, which features, the mode and its numbers, the volume).
import { S, layerById } from './state.js';
import { resolveLimit, polygonLayers } from './polylimit.js';
import { extrudeZRange, extrudeOriented, extrudeBetween, manifoldCheck } from './extrude-core.js';
import { featureBBoxXY } from './coverage.js';
import { ingestMeshLayer } from './ingest.js';
import { mkLineage } from './lineage.js';
import { replaceMade } from './pcgrid.js';
import { surfaceFromGrid, latticeForBbox } from './grid-ops.js';
import { gridOnLattice, surfaceableLayers, surfCellOf, layerWorldBbox } from './gridtools.js';
import { residentGridForEval } from './bygeom.js';
import { floatWin } from './windows.js';
import { registerCommands, contributeMenu } from './commands.js';
import { registerTool } from './tools.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const baseOf = (L) => nameOf(L).replace(/\.[^.]+$/, '');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;
export const EXTRUDE_MODES = ['zrange', 'oriented', 'between'];

// a surface spec (a layer name / layer, or a number) → { fn(x, y) → z, label, cell } over the plan bbox
async function surfaceSampler(spec, bb4, what) {
  if (typeof spec === 'number' || (typeof spec === 'string' && spec.trim() !== '' && Number.isFinite(+spec))) {
    const z = +spec; return { fn: () => z, label: String(z), cell: 0 };
  }
  const L = typeof spec === 'object' && spec ? spec : layerNamed(String(spec || ''));
  if (!L) throw new Error(`extrude: the ${what} surface “${spec}” isn't loaded (a grid, a mesh, or a number)`);
  const pad = [bb4[0] - 1, bb4[1] - 1, bb4[2] + 1, bb4[3] + 1];
  if (L.docs.gridDoc && L.docs.gridDoc.grid) {
    const g = await residentGridForEval(L, pad);
    const s = surfaceFromGrid(g);
    return { fn: s.sampleZ, label: L.name, cell: g.dx, L };
  }
  if (L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup) {
    const cell = surfCellOf(L);
    const geom = latticeForBbox([pad[0] - cell, pad[1] - cell, pad[2] + cell, pad[3] + cell], cell);
    const g = await gridOnLattice(L, geom);
    return { fn: surfaceFromGrid(g).sampleZ, label: L.name, cell, L };
  }
  throw new Error(`extrude: “${nameOf(L)}” is not a surface (a grid, or a context-tier mesh)`);
}

/**
 * Extrude polygons to closed solids (no layer). opts: polygons (layer or name), feature / where /
 * selected (which features — as a polygon limit), mode, z0, z1, trend, plunge, direction, length,
 * top, bottom, tol, maxEdge, minEdge, each (one solid per feature).
 * → [{ feature, rec, mesh: { vertices, triangles, volume, area, stats }, check }]
 */
export async function extrudeSolids(opts) {
  const PL = typeof opts.polygons === 'object' ? opts.polygons : layerNamed(String(opts.polygons || ''));
  if (!PL) throw new Error(`extrude: the polygon layer “${opts.polygons}” isn't loaded`);
  const R = resolveLimit({ layer: PL.name, ...(opts.feature != null && opts.feature !== '' ? { feature: opts.feature } : {}), ...(opts.where ? { where: opts.where } : {}), ...(opts.selected ? { selected: true } : {}) });
  const mode = opts.mode || 'zrange';
  if (!EXTRUDE_MODES.includes(mode)) throw new Error(`extrude: mode is one of ${EXTRUDE_MODES.join(' / ')}`);
  let top = null, bottom = null;
  if (mode === 'between') {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of R.features) { const b = featureBBoxXY(f); bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]); }
    top = await surfaceSampler(opts.top, bb, 'top'); bottom = await surfaceSampler(opts.bottom, bb, 'bottom');
  }
  const out = [];
  for (const f of R.features) {
    let mesh;
    if (mode === 'zrange') mesh = extrudeZRange(f, { z0: +opts.z0, z1: +opts.z1 });
    else if (mode === 'oriented') mesh = extrudeOriented(f, { direction: opts.direction || { trend: +opts.trend, plunge: +opts.plunge }, length: +opts.length });
    else {
      // never refine below half the finer surface's own node spacing: a cap can't follow a grid finer than its nodes
      const cells = [top.cell, bottom.cell].filter((c) => c > 0);
      const minEdge = +opts.minEdge > 0 ? +opts.minEdge : cells.length ? Math.min(...cells) / 2 : 0;
      mesh = extrudeBetween(f, { top: top.fn, bottom: bottom.fn, tol: +opts.tol > 0 ? +opts.tol : 0.1, maxEdge: +opts.maxEdge > 0 ? +opts.maxEdge : Infinity, minEdge });
    }
    const check = manifoldCheck(mesh.vertices, mesh.triangles);
    if (!check.ok) throw new Error(`extrude: feature ${f.id} gave a solid that isn't watertight (${check.boundary} open edges, ${check.nonManifold} non-manifold, ${check.misoriented} flipped) — a self-intersecting outline?`);
    out.push({ feature: f, rec: f.rec, mesh, check });
  }
  return { PL, R, mode, top: top && top.label, bottom: bottom && bottom.label, solids: out };
}

// several closed meshes → one (each stays its own closed shell)
function mergeMeshes(list) {
  let nv = 0, nt = 0;
  for (const m of list) { nv += m.vertices.length; nt += m.triangles.length; }
  const V = new Float64Array(nv), T = new Uint32Array(nt);
  let vo = 0, to = 0;
  for (const m of list) { V.set(m.vertices, vo); for (let i = 0; i < m.triangles.length; i++) T[to + i] = m.triangles[i] + vo / 3; vo += m.vertices.length; to += m.triangles.length; }
  return { vertices: V, triangles: T };
}

/** Extrude and open the solid(s) as mesh layers. → { layers: [{ id, name, volume, features }], volume, … } */
export async function extrudeToLayers(opts) {
  const r = await extrudeSolids(opts);
  const groups = opts.each ? r.solids.map((s) => [s]) : [r.solids];
  const tag = r.mode === 'zrange' ? `z${+(+opts.z0).toFixed(2)}-${+(+opts.z1).toFixed(2)}` : r.mode === 'oriented' ? 'oriented' : `${String(r.top).replace(/\.[^.]+$/, '')}-${String(r.bottom).replace(/\.[^.]+$/, '')}`;
  const made = [];
  for (const g of groups) {
    const one = opts.each ? g[0].feature : null;
    const nm = (opts.name ? (opts.each ? `${opts.name}_${one.id}` : opts.name) : `${baseOf(r.PL)}${one ? '_' + one.id : ''}_${tag}`).replace(/[\\/:*?"<>|\s]+/g, '_');
    const file = /\.ply$/i.test(nm) ? nm : `${nm}.ply`;
    const m = g.length === 1 ? g[0].mesh : mergeMeshes(g.map((s) => s.mesh));
    const volume = g.reduce((s, x) => s + x.mesh.volume, 0);
    const params = {
      polygons: r.PL.name, features: g.map((s) => s.feature.id), mode: r.mode,
      ...(r.mode === 'zrange' ? { z0: Math.min(+opts.z0, +opts.z1), z1: Math.max(+opts.z0, +opts.z1) } : {}),
      ...(r.mode === 'oriented' ? (opts.direction ? { direction: opts.direction } : { trend: +opts.trend, plunge: +opts.plunge }) : {}),
      ...(r.mode === 'oriented' ? { length: +opts.length } : {}),
      ...(r.mode === 'between' ? { top: r.top, bottom: r.bottom, tol: g[0].mesh.stats.tol, maxDeviation: +Math.max(...g.map((s) => s.mesh.stats.maxDeviation)).toPrecision(4) } : {}),
      volume: +volume.toPrecision(10), watertight: true,
    };
    replaceMade(file);                                         // a re-run replaces its own earlier solid
    const id = await ingestMeshLayer(m, file, mkLineage('extrude', params, [r.PL.lineage]));
    const NL = layerById(id);
    if (NL) {
      NL.memoryOnly = true;
      // the vertical-prism tag: the by-solid fraction of a regular model computes it exactly
      if (r.mode === 'zrange') NL._prism = { z0: params.z0, z1: params.z1, features: g.map((s) => ({ closed: true, rings: s.feature.rings.map((q) => q.map((p) => [p[0], p[1], p[2]])), parts: s.feature.parts.map((pp) => pp.slice()) })) };
    }
    made.push({ id, name: file, volume, features: g.map((s) => s.feature.id), triangles: m.triangles.length / 3, maxDeviation: r.mode === 'between' ? params.maxDeviation : null });
  }
  return { mode: r.mode, polygons: r.PL.name, layers: made, volume: made.reduce((s, x) => s + x.volume, 0), solids: r.solids.length };
}

// ── the dialog ───────────────────────────────────────────────────────────────
let _win = null;
export function openExtrude(L0) {
  const polys = polygonLayers();
  if (!polys.length) { $('#meta').textContent = 'extrude: open (or draw) a polygon layer first — a strings & polygons layer with closed features'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const P0 = L0 && polys.includes(L0) ? L0 : polys[0];
  const zs = [];
  for (const L of S.layers) { const b = layerWorldBbox(L); if (b && L !== P0) zs.push(b[2], b[5]); }
  const pz = (() => { const b = layerWorldBbox(P0); return b ? b[2] : 0; })();
  const d = { src: P0.name, limit: { layer: P0.name }, mode: 'zrange', z0: zs.length ? Math.floor(Math.min(...zs)) : pz - 10, z1: zs.length ? Math.ceil(Math.max(...zs)) : pz,
    trend: 0, plunge: 90, length: 20, top: '', bottom: '', tol: 0.1, each: false, name: '' };
  const surfs = surfaceableLayers();
  if (surfs.length) { d.top = surfs[0].name; d.bottom = (surfs[1] || surfs[0]).name; }
  const win = floatWin({ title: 'extrude polygons', sub: 'polygon → closed solid', x: Math.max(12, innerWidth - 440), y: 100, w: 410, h: 470, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.extrude = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Extrude'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg);
  win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:0 0 84px;color:var(--text)'; s.textContent = label; r.append(s, el); form.appendChild(r); return el; };
  const sel = (opts, val, onch) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val); s.onchange = () => onch(s.value); return s; };
  const num = (val, onch, w = 90) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = 'any'; i.value = String(val); i.style.width = w + 'px'; i.oninput = () => onch(+i.value); return i; };
  const surfOpts = () => [...surfaceableLayers().map((L) => [L.name, `${nameOf(L)}${L.docs.gridDoc ? ' (grid)' : ' (mesh)'}`]), ['#z', 'a level (z)…']];
  const build = () => {
    form.textContent = '';
    row('polygons', sel(polys.map((L) => [L.name, nameOf(L)]), d.src, (v) => { d.src = v; d.limit = { layer: v }; build(); }), 'the strings & polygons layer — its closed features are extruded');
    const PL = layerNamed(d.src);
    const fsel = sel([['', 'all polygons'], ...(PL && PL._selCount ? [['#sel', `the selected (${PL._selCount})`]] : []), ...(PL ? [...new Set(resolveLimitSafe(PL).map((f) => String(f.id)))].slice(0, 500).map((v) => [v, v]) : [])],
      d.limit.selected ? '#sel' : d.limit.feature != null ? String(d.limit.feature) : '', (v) => { d.limit = { layer: d.src, ...(v === '#sel' ? { selected: true } : v ? { feature: v } : {}) }; });
    row('features', fsel, 'which polygons: all, the ones selected in 3D, or one');
    row('mode', sel([['zrange', 'between two levels (z-range prism)'], ['oriented', 'along a direction (oriented prism)'], ['between', 'between two surfaces']], d.mode, (v) => { d.mode = v; build(); }), 'z-range: walls straight up from z0 to z1 · oriented: a prism along a trend/plunge for a length · between: the caps follow two surfaces');
    if (d.mode === 'zrange') {
      const zr = document.createElement('div'); zr.style.cssText = 'display:flex;gap:6px;align-items:center';
      zr.append(num(d.z0, (v) => { d.z0 = v; }), document.createTextNode('to'), num(d.z1, (v) => { d.z1 = v; }));
      row('z from', zr, 'the prism’s floor and roof (RL); the default spans what else is open');
    } else if (d.mode === 'oriented') {
      const dr = document.createElement('div'); dr.style.cssText = 'display:flex;gap:6px;align-items:center';
      dr.append(num(d.trend, (v) => { d.trend = v; }, 64), document.createTextNode('/'), num(d.plunge, (v) => { d.plunge = v; }, 64));
      row('trend/plunge', dr, 'the direction the base is swept along, degrees (plunge positive down; 90 = straight down)');
      row('length (m)', num(d.length, (v) => { d.length = v; }), 'how far along that direction (negative sweeps the other way)');
    } else {
      for (const k of ['top', 'bottom']) {
        const isZ = d[k] === '' || Number.isFinite(+d[k]);
        const s = sel(surfOpts(), isZ ? '#z' : d[k], (v) => { d[k] = v === '#z' ? '0' : v; build(); });
        const r = row(k, s, `the ${k} cap: a grid, a mesh (its top), or a level`);
        if (isZ) r.parentElement.append(num(d[k] === '' ? 0 : +d[k], (v) => { d[k] = String(v); }, 70));
      }
      row('tolerance (m)', num(d.tol, (v) => { d.tol = v > 0 ? v : d.tol; }), 'how far a cap may stray from its surface — the triangulation is refined until it doesn’t (or its edges reach half the surface’s own node spacing)');
    }
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.each; cb.onchange = () => { d.each = cb.checked; };
    row('one per polygon', cb, 'a solid layer per feature (assign domains wants one per domain) — else one layer holding them all');
    const nm = document.createElement('input'); nm.className = 'sw-in'; nm.style.flex = '1'; nm.value = d.name; nm.placeholder = 'automatic'; nm.oninput = () => { d.name = nm.value.trim(); };
    row('name', nm, 'the solid layer’s name');
    note.textContent = d.mode === 'zrange'
      ? 'a vertical prism: select / flag / fraction / assign domains take it like any solid — and the fraction of a regular model is EXACT for it (each block column’s plan area inside the polygon × its z overlap), not sampled.'
      : d.mode === 'between' ? 'walls on the polygon, the caps on the two surfaces (refined to the tolerance). Where the surfaces cross the solid pinches to nothing. Every solid is checked watertight before it opens.'
        : 'the polygon at its own vertices’ z, swept along the direction. Every solid is checked watertight before it opens.';
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'extruding…';
    try {
      const r = await extrudeToLayers({ polygons: d.src, ...(d.limit.feature != null ? { feature: d.limit.feature } : {}), ...(d.limit.selected ? { selected: true } : {}), mode: d.mode, z0: d.z0, z1: d.z1, trend: d.trend, plunge: d.plunge, length: d.length,
        top: Number.isFinite(+d.top) && d.top !== '' ? +d.top : d.top, bottom: Number.isFinite(+d.bottom) && d.bottom !== '' ? +d.bottom : d.bottom, tol: d.tol, each: d.each, name: d.name || null });
      msg.textContent = `${r.solids} polygon${r.solids === 1 ? '' : 's'} → ${r.layers.length} solid layer${r.layers.length === 1 ? '' : 's'} · ${Math.round(r.volume).toLocaleString()} m³ · watertight`;
      $('#meta').textContent = `extrude: ${r.layers.map((x) => x.name).join(', ')} — ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}
function resolveLimitSafe(PL) { try { return resolveLimit({ layer: PL.name }).features; } catch { return []; } }

// ── the routine tool ─────────────────────────────────────────────────────────
registerTool('extrude', {
  label: 'extrude polygons', cache: false, makes: 'layer',
  params: {
    polygons: { type: 'layer', required: true, doc: 'the strings & polygons layer whose closed features are extruded' },
    feature: { type: 'any', doc: 'one feature — its id, or the value of any of its attributes (absent: every polygon)' },
    where: { type: 'expr', of: 'polygons', doc: 'only the polygons this expression over their attributes keeps' },
    mode: { type: 'enum', values: EXTRUDE_MODES.slice(), default: 'zrange', doc: 'zrange: the polygon × [z0, z1] (a vertical prism — its fraction on a regular model is exact) · oriented: a prism along trend/plunge for a length · between: the caps on two surfaces' },
    z0: { type: 'number', doc: 'zrange: the floor (RL)' },
    z1: { type: 'number', doc: 'zrange: the roof (RL)' },
    trend: { type: 'number', doc: 'oriented: the direction’s trend, degrees' },
    plunge: { type: 'number', doc: 'oriented: its plunge, degrees, positive down (90 = straight down)' },
    direction: { type: 'numbers', doc: 'oriented: the direction as a vector [x, y, z] instead of trend/plunge' },
    length: { type: 'number', doc: 'oriented: how far along the direction (m)' },
    top: { type: 'any', doc: 'between: the top surface — a grid or mesh layer, or a level (a number)' },
    bottom: { type: 'any', doc: 'between: the bottom surface — a grid or mesh layer, or a level' },
    tol: { type: 'number', default: 0.1, doc: 'between: how far a cap may stray from its surface (m) — the cap is refined until it doesn’t' },
    maxEdge: { type: 'number', doc: 'between: no cap edge longer than this (m; default an eighth of the polygon’s span)' },
    each: { type: 'bool', default: false, doc: 'one solid layer per polygon (else one layer holding them all)' },
    name: { type: 'string', doc: 'the solid layer’s name (default <polygons>_<mode>; with each: <name>_<feature id>)' },
  },
  outputs: { key: [] },
  check(p, errs) {
    if (p.mode === 'zrange' && (p.z0 == null || p.z1 == null)) errs.push('z0 and z1: the prism’s floor and roof (mode zrange)');
    if (p.mode === 'oriented') { if (p.length == null) errs.push('length: how far along the direction (mode oriented)'); if (!p.direction && (p.trend == null || p.plunge == null)) errs.push('trend and plunge (or direction): which way (mode oriented)'); if (p.direction && !(Array.isArray(p.direction) && p.direction.length === 3)) errs.push('direction: [x, y, z]'); }
    if (p.mode === 'between' && (p.top == null || p.bottom == null)) errs.push('top and bottom: the two surfaces (layers, or levels) (mode between)');
    if (p.tol != null && !(p.tol > 0)) errs.push('tol: a positive number of metres');
  },
  async scan(p, ctx) {
    void ctx;
    const r = await extrudeToLayers({ ...p, feature: p.feature, where: p.where || null, each: !!p.each, name: p.name || null });
    return r;
  },
  shape(r, p) {
    return { table: { columns: ['layer', 'features', 'volume', 'triangles'], key: ['layer'], rows: r.layers.map((x) => [x.name, x.features.join(' '), x.volume, x.triangles]), units: { volume: 'm³' } },
      values: { volume: r.volume, solids: r.solids, layers: r.layers.length }, layers: r.layers.map((x) => x.name), resolved: { ...p }, warnings: [] };
  },
});

// ── palette + menus ──
registerCommands([
  { id: 'extrude', group: 'Layer', title: 'Extrude polygons to a solid…', kw: 'extrude prism solid polygon blast shot pit limit lease domain wireframe between surfaces bench z-range oriented closed mesh volume', when: () => polygonLayers().length > 0, run: (c) => openExtrude(c.L) },
]);
contributeMenu('tools', () => (polygonLayers().length ? [{ label: 'Extrude polygons to a solid…', action: () => openExtrude(null) }] : []));
