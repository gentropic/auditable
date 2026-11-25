// micro CONTOURS — a grid's isolines as a strings & polygons layer.
//
// Right-click a grid (shown as nodes or as a surface) → Geometry → Contours → strings…: every
// `interval` from `base` across the grid's range (or between a min and a max), each level traced
// by marching squares on the grid's own nodes (grid-ops.js isolines: saddles by the cell centre,
// nodata cells left out, segments chained into polylines and closed rings). Each contour line is
// a 3D string at its elevation (world — a placed grid through its placement), with ELEV, INDEX
// (1 on every nth level: the index contours) and its plan LENGTH — a layer to style by INDEX, to
// export as DXF / shapefile / WKT-CSV, to profile, or to use as a limit (a closed ring has an inside).
//   contoursToLayer(L, { interval, base, index, min, max, name }) → { id, name, lines, levels, … }
import { S, layerById } from './state.js';
import { isolines, contourLevels, gridWorldBbox4 } from './grid-ops.js';
import { residentGridForEval } from './bygeom.js';
import { newFeatureLayer } from './poly-ui.js';
import { mkLineage } from './lineage.js';
import { replaceMade } from './pcgrid.js';
import { niceStep } from './analysis-ui.js';
import { floatWin } from './windows.js';
import { registerTool } from './tools.js';
import { registerCommands, contributeLayerMenu } from './commands.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;
const isGridLayer = (L) => !!(L && L.docs && L.docs.gridDoc && L.docs.gridDoc.grid);
export const contourableLayers = () => S.layers.filter((L) => isGridLayer(L) && !L.viewOf);

// the grid's value range (its own data, the place's z scale and shift applied: what ELEV reads)
function gridRange(g) {
  let lo = Infinity, hi = -Infinity; const nod = g.nodata;
  for (const v of g.data) if (Number.isFinite(v) && v !== nod && Math.abs(v) < 1.7e38) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const zs = g.place ? g.place.s : 1, zt = g.place ? g.place.t[2] : 0;
  return hi >= lo ? [zt + zs * lo, zt + zs * hi] : null;
}
// a sensible interval: about 20 lines across the range, on a round number
export function defaultInterval(L) { const r = isGridLayer(L) ? gridRange(L.docs.gridDoc.grid) : null; return r ? niceStep((r[1] - r[0]) / 20) || 1 : 1; }

const planLen = (pts, closed) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (closed && pts.length > 2) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]); return s; };

export async function contoursOf(L, { interval = null, base = 0, index = 5, min = null, max = null } = {}) {
  if (!isGridLayer(L)) throw new Error(`contours: “${nameOf(L)}” is not a grid`);
  const g0 = L.docs.gridDoc.grid;
  const g = await residentGridForEval(L, gridWorldBbox4(g0));          // the full-resolution nodes (a big GeoTIFF is read, not its preview)
  const rng = gridRange(g);
  if (!rng) throw new Error(`contours: “${nameOf(L)}” holds no value`);
  const iv = +interval > 0 ? +interval : defaultInterval(L);
  const zs = g.place ? g.place.s : 1, zt = g.place ? g.place.t[2] : 0;
  const lo = min != null && Number.isFinite(+min) ? Math.max(+min, rng[0]) : rng[0], hi = max != null && Number.isFinite(+max) ? Math.min(+max, rng[1]) : rng[1];
  const worldLevels = contourLevels(lo, hi, iv, +base || 0);
  if (!worldLevels.length) throw new Error(`contours: no level of ${iv} from ${+base || 0} falls within ${rng[0].toFixed(2)} – ${rng[1].toFixed(2)}`);
  // trace in the grid's own value units (a placed grid stores z − its shift, ÷ its scale)
  const traced = isolines(g, worldLevels.map((w) => (w - zt) / zs));
  const features = [];
  traced.forEach((t, k) => {
    const elev = worldLevels[k], idx = +index > 0 && Math.abs(Math.round((elev - (+base || 0)) / iv) % Math.round(+index)) === 0 ? 1 : 0;
    for (const ln of t.lines) if (ln.pts.length >= 2) features.push({ pts: ln.pts, closed: ln.closed && ln.pts.length >= 3, attrs: { ELEV: elev, INDEX: idx, LENGTH: +planLen(ln.pts, ln.closed).toFixed(3) } });
  });
  return { features, levels: worldLevels, interval: iv, base: +base || 0, index: +index || 0, range: rng, grid: L.name };
}

export async function contoursToLayer(L, opts = {}) {
  const r = await contoursOf(L, opts);
  if (!r.features.length) throw new Error(`contours: no line — the levels miss every cell of “${nameOf(L)}”`);
  const nm = (opts.name || `contours_${nameOf(L).replace(/\.[^.]+$/, '')}_${r.interval}m`).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/\.csv$/i, '');
  const columns = ['ELEV', 'INDEX', 'LENGTH'];
  const model = {
    columns, crs: null, warnings: [],
    features: r.features.map((f, i) => ({ id: i + 1, kind: f.closed ? 'polygon' : 'line', rings: [f.pts], parts: [[0]], closed: f.closed })),
    rows: r.features.map((f) => columns.map((c) => f.attrs[c])),
  };
  replaceMade(`${nm}.csv`);                                 // a re-run replaces its own earlier layer
  const C = newFeatureLayer(nm, model, { source: 'contours', poly: { cat: 'INDEX' } });
  C.lineage = mkLineage('contours', { grid: L.name, interval: r.interval, base: r.base, index: r.index, ...(opts.min != null ? { min: +opts.min } : {}), ...(opts.max != null ? { max: +opts.max } : {}) }, [L.lineage].filter(Boolean));
  C.memoryOnly = true;
  return { id: C.id, name: C.name, lines: r.features.length, levels: r.levels.length, interval: r.interval, closed: r.features.filter((f) => f.closed).length,
    length: r.features.reduce((s, f) => s + f.attrs.LENGTH, 0), range: r.range };
}

// ── the dialog ──
let _win = null;
export function openContours(L0 = null) {
  const grids = contourableLayers();
  if (!grids.length) { $('#meta').textContent = 'contours: open a grid first (a DEM, a GeoTIFF, a Surfer or ESRI grid)'; return null; }
  if (_win && _win.el.isConnected) _win.close();
  const L = L0 && grids.includes(L0) ? L0 : grids[0];
  const d = { grid: L.name, interval: defaultInterval(L), base: 0, index: 5, min: '', max: '', name: '' };
  const win = floatWin({ title: 'contours', sub: 'a grid → strings & polygons', x: Math.max(12, innerWidth - 440), y: 110, w: 400, h: 330, onClose: () => { _win = null; } });
  _win = win;
  win.el.dataset.contours = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const form = document.createElement('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'each level becomes 3D lines at its elevation (closed rings where a contour closes on itself), with ELEV, INDEX (1 on every nth level) and LENGTH — style by INDEX, export as DXF / shapefile / WKT-CSV.';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Make contours'; go.dataset.go = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(go, msg); win.body.append(form, note, bar);
  const row = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'width:74px;flex:0 0 auto;color:var(--muted)'; s.textContent = label; r.append(s, el); form.append(r); return r; };
  const num = (val, onch, ph = '') => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = 'any'; i.value = val === '' ? '' : String(val); i.placeholder = ph; i.style.width = '110px'; i.oninput = () => onch(i.value); return i; };
  const build = () => {
    form.textContent = '';
    const s = document.createElement('select'); s.className = 'sw-sel'; s.style.flex = '1'; s.dataset.role = 'grid';
    for (const G of grids) s.append(new Option(nameOf(G), G.name));
    s.value = d.grid; s.onchange = () => { d.grid = s.value; d.interval = defaultInterval(layerNamed(d.grid)); build(); };
    row('grid', s);
    const G = layerNamed(d.grid), rg = G && gridRange(G.docs.gridDoc.grid);
    row('interval', num(d.interval, (v) => { d.interval = +v; }), `the distance between levels${rg ? ` (the grid runs ${rg[0].toFixed(2)} – ${rg[1].toFixed(2)})` : ''}`).querySelector('input').dataset.role = 'interval';
    row('base', num(d.base, (v) => { d.base = +v; }), 'the levels are base + k · interval (0: round numbers)');
    row('index every', num(d.index, (v) => { d.index = +v; }), 'INDEX = 1 on every nth level (0: none)');
    const mm = document.createElement('div'); mm.style.cssText = 'display:flex;gap:6px;align-items:center';
    mm.append(num(d.min, (v) => { d.min = v; }, 'min'), document.createTextNode('–'), num(d.max, (v) => { d.max = v; }, 'max'));
    row('between', mm, 'only levels in this range (blank: the whole grid)');
    const nm = document.createElement('input'); nm.className = 'sw-in'; nm.style.flex = '1'; nm.value = d.name; nm.placeholder = 'automatic'; nm.oninput = () => { d.name = nm.value.trim(); };
    row('name', nm, 'the new layer’s name');
  };
  build();
  go.onclick = async () => {
    go.disabled = true; msg.textContent = 'tracing…';
    try {
      const r = await contoursToLayer(layerNamed(d.grid), { interval: d.interval, base: d.base, index: d.index, min: d.min === '' ? null : +d.min, max: d.max === '' ? null : +d.max, name: d.name || null });
      msg.textContent = `${r.levels} levels · ${r.lines} lines (${r.closed} closed) → ${r.name}`;
      $('#meta').textContent = `contours: ${msg.textContent}`;
    } catch (e) { msg.textContent = e.message; }
    finally { go.disabled = false; }
  };
  return win;
}

// ── the routine tool ──
registerTool('contours', {
  label: 'contours', cache: false, makes: 'layer',
  params: {
    grid: { type: 'layer', required: true, kinds: ['grid'], doc: 'the grid contoured (a DEM, a grade grid…)' },
    interval: { type: 'number', routine: 'required', why: 'the automatic interval follows the data’s range — a monthly contour set needs one stated interval', doc: 'the distance between levels (default: about 20 across the range, rounded)' },
    base: { type: 'number', default: 0, doc: 'levels are base + k · interval' },
    index: { type: 'int', default: 5, doc: 'INDEX = 1 on every nth level (0: none)' },
    min: { type: 'number', doc: 'only levels at or above this' },
    max: { type: 'number', doc: 'only levels at or below this' },
    name: { type: 'string', doc: 'the new layer’s name (default contours_<grid>_<interval>m)' },
  },
  outputs: { key: [] },
  check(p, errs) { if (p.interval != null && !(p.interval > 0)) errs.push('interval: a positive number'); if (p.index != null && !(p.index >= 0)) errs.push('index: 0 or more'); },
  async scan(p) { const L = layerNamed(p.grid); if (!L) throw new Error(`contours: no layer “${p.grid}”`); return contoursToLayer(L, { ...p }); },
  shape(r, p) {
    return { table: null, values: { levels: r.levels, lines: r.lines, closed: r.closed, length: r.length, interval: r.interval }, layers: [r.name], resolved: { ...p, interval: r.interval }, warnings: [] };
  },
});

// ── palette + the grid's Geometry menu ──
registerCommands([
  { id: 'contours', group: 'Analyse', title: 'Contours → strings…', kw: 'contours contour isolines curvas de nivel topography elevation lines dem grid index', when: () => contourableLayers().length > 0, run: (c) => openContours(c.L) },
]);
contributeLayerMenu('geometry', (L) => (isGridLayer(L) && !L.viewOf ? [{ label: 'Contours → strings…', action: () => openContours(L) }] : []));
