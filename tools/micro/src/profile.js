// micro PROFILE — the elevation of surfaces along a line.
//
// A line (a string, or a polygon's outer ring, from any strings & polygons layer — or one drawn
// on the spot) is walked at a fixed step, vertices included, and each chosen SURFACE is sampled at
// every station: a grid through its own height function (bilinear, placed or not — the same
// evaluator by-surface selection uses), a mesh by a vertical ray from above (the topmost hit: a pit
// shell, a contact, a wireframe topography). Everything is in WORLD coordinates (src/coords.js):
// the line's vertices as the file has them, the surfaces' true positions (a display offset does not
// move a profile). A station a surface doesn't cover is a gap (NaN), never a zero.
//
//   profileAlong(line, surfaces, { step }) → { line, length, s, x, y, vertexS, series: [{ id, name, label, kind, z }], step }
//   profileTable / profileValues / profileChartSpec / profileHumanTSV — what the window, the routine
//   tool and the composer show
//   openProfile(L?) — the window (Tools → Profile along a line…)
import { S, layerById } from './state.js';
import { surfaceFromGrid } from './grid-ops.js';
import { residentGridForEval, meshSolidOf } from './bygeom.js';
import { raycastBVH } from '../../../ext/winding/index.js';
import { featuresOf, isPolygonLayer } from './polygons.js';
import { surfaceableLayers } from './gridtools.js';
import { armDraw } from './poly-draw.js';
import { floatWin, focusWindow } from './windows.js';
import { plotChart, plotExportBtns, runCancellable, checkAbort } from './analysis-ui.js';
import { saveRecipe } from './recipes.js';
import { registerCommands, contributeMenu } from './commands.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const baseOf = (L) => nameOf(L).replace(/\.[^.]+$/, '');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;

// ── the line ──
// every feature of every strings & polygons layer that can be walked: lines, and polygons' outer rings
export function profileLines() {
  const out = [];
  for (const L of S.layers) {
    if (!isPolygonLayer(L)) continue;
    featuresOf(L).forEach((f, i) => {
      const r = f.rings && f.rings[0];
      if (!r || r.length < 2) return;
      const nm = f.attrs && (f.attrs.NAME || f.attrs.name || f.attrs.Name);
      out.push({ L, f, index: i, id: f.id != null ? f.id : i + 1, label: `${nameOf(L)} · ${nm != null && nm !== '' ? nm : `#${f.id != null ? f.id : i + 1}`}${f.closed ? ' (ring)' : ''}` });
    });
  }
  return out;
}
// { layer, feature } → the line's WORLD vertices [[x, y], …] (a polygon's ring closed back on itself).
// feature: an id, or any attribute value (a NAME) — the rule polygon limits use
export function resolveProfileLine(spec) {
  if (!spec || !spec.layer) throw new Error('profile: which line? — { layer, feature }');
  const L = layerNamed(spec.layer);
  if (!L) throw new Error(`profile: no layer “${spec.layer}”`);
  if (!isPolygonLayer(L)) throw new Error(`profile: “${nameOf(L)}” is not a strings & polygons layer`);
  let fs = featuresOf(L).filter((f) => f.rings && f.rings[0] && f.rings[0].length >= 2);
  if (spec.feature != null) {
    const want = String(spec.feature);
    const byId = fs.filter((f) => String(f.id) === want);
    fs = byId.length ? byId : fs.filter((f) => f.attrs && Object.values(f.attrs).some((v) => String(v) === want));
  }
  if (!fs.length) throw new Error(`profile: no line ${spec.feature != null ? `“${spec.feature}” ` : ''}in “${nameOf(L)}”`);
  if (fs.length > 1 && spec.feature == null) throw new Error(`profile: “${nameOf(L)}” holds ${fs.length} lines — say which (feature: its id or its NAME)`);
  const f = fs[0], r = f.rings[0].map((p) => [+p[0], +p[1]]);
  if (f.closed && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0].slice());
  return { L, f, pts: r };
}

// ── sampling ──
// a surface → (x, y) → z (world), or NaN where it has no value
async function surfaceSampler(L, bbox4) {
  if (L.docs && L.docs.gridDoc && L.docs.gridDoc.grid) {
    const surf = surfaceFromGrid(await residentGridForEval(L, bbox4));
    return { kind: 'grid', z: (x, y) => { const v = surf.sampleZ(x, y); return Number.isFinite(v) ? v : NaN; } };
  }
  const bvh = await meshSolidOf(L);
  if (!bvh) throw new Error(`profile: “${nameOf(L)}” has no geometry to sample (a streamed mesh — convert it to exact first)`);
  const top = bvh.bbox ? bvh.bbox[5] + 1 : 1e7;            // a vertical ray from just above the mesh
  return { kind: 'mesh', z: (x, y) => { const h = raycastBVH(bvh, [x, y, top], [0, 0, -1]); return h && h.point ? h.point[2] : NaN; } };
}

export async function profileAlong(pts, surfaces, { step = null, signal = null, onProgress = null } = {}) {
  if (!pts || pts.length < 2) throw new Error('profile: a line needs two vertices');
  if (!surfaces || !surfaces.length) throw new Error('profile: no surface to sample — pick a grid or a mesh');
  // the line's length and each vertex's chainage
  const vs = [0];
  for (let i = 1; i < pts.length; i++) vs.push(vs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = vs[vs.length - 1];
  if (!(length > 0)) throw new Error('profile: the line has no length in plan');
  const st = +step > 0 ? +step : Math.max(length / 400, 1e-3);
  // stations: every step along each segment, every vertex exactly
  const S0 = [], X = [], Y = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], segL = vs[i] - vs[i - 1];
    const n = Math.max(1, Math.ceil(segL / st - 1e-9));
    for (let k = 0; k < n; k++) { const t = k / n; S0.push(vs[i - 1] + t * segL); X.push(a[0] + t * (b[0] - a[0])); Y.push(a[1] + t * (b[1] - a[1])); }
  }
  S0.push(length); X.push(pts[pts.length - 1][0]); Y.push(pts[pts.length - 1][1]);
  if (S0.length > 200000) throw new Error(`profile: ${S0.length.toLocaleString()} stations — give a bigger step`);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < X.length; i++) { if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i]; }
  const pad = st * 2, bbox4 = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const series = [];
  for (let si = 0; si < surfaces.length; si++) {
    const L = surfaces[si];
    checkAbort(signal);
    const smp = await surfaceSampler(L, bbox4);
    const z = new Float64Array(S0.length);
    for (let i = 0; i < S0.length; i++) z[i] = smp.z(X[i], Y[i]);
    series.push({ id: L.id, name: L.name, label: nameOf(L), kind: smp.kind, z });
    if (onProgress) onProgress((si + 1) / surfaces.length, nameOf(L));
  }
  return { line: pts.map((p) => p.slice()), length, step: st, s: Float64Array.from(S0), x: Float64Array.from(X), y: Float64Array.from(Y), vertexS: vs, series };
}

// ── what it shows ──
const SERIES_COLORS = ['#e8913a', '#4aa3df', '#5fb85f', '#d6c34a', '#b97fd0', '#d95f5f', '#9aa0a6'];
const fin = (a) => { let lo = Infinity, hi = -Infinity, n = 0; for (const v of a) if (Number.isFinite(v)) { n++; if (v < lo) lo = v; if (v > hi) hi = v; } return { lo, hi, n }; };

export function profileChartSpec(r) {
  if (!r) return null;
  let lo = Infinity, hi = -Infinity;
  for (const se of r.series) { const e = fin(se.z); if (e.n) { lo = Math.min(lo, e.lo); hi = Math.max(hi, e.hi); } }
  if (!(hi >= lo)) return { series: [], placeholder: 'no surface has a value along the line' };
  const padZ = Math.max(1, (hi - lo) * 0.08);
  const series = r.series.map((se, k) => ({ name: se.label, color: SERIES_COLORS[k % SERIES_COLORS.length], axis: 'left', kind: 'line',
    data: Array.from(r.s, (s, i) => [s, Number.isFinite(se.z[i]) ? se.z[i] : null]) }));
  // the line's vertices: thin dashed verticals, so a bend reads on the chart
  for (const vs of r.vertexS.slice(1, -1)) series.push({ name: '', color: '#6b7078', axis: 'left', kind: 'line', dash: true, data: [[vs, lo - padZ], [vs, hi + padZ]] });
  return { xLabel: 'distance along the line (m)', leftLabel: 'elevation (m)', series, xRange: [0, r.length], leftRange: [lo - padZ, hi + padZ] };
}
export function profileTable(r) {
  const cols = ['chainage', 'x', 'y', ...r.series.map((se) => se.label)];
  const rows = Array.from(r.s, (s, i) => [s, r.x[i], r.y[i], ...r.series.map((se) => (Number.isFinite(se.z[i]) ? se.z[i] : null))]);
  return { columns: cols, key: ['chainage'], units: Object.fromEntries(cols.map((c) => [c, 'm'])), rows };
}
export function profileValues(r) {
  const v = { length: r.length, stations: r.s.length, step: r.step };
  for (const se of r.series) { const e = fin(se.z); v[`${se.label} min`] = e.n ? e.lo : null; v[`${se.label} max`] = e.n ? e.hi : null; v[`${se.label} covered`] = e.n / r.s.length; }
  return v;
}
export function profileHumanTSV(r) {
  if (!r) return null;
  const c = (v) => (Number.isFinite(v) ? +(+v).toFixed(3) : '');
  return [`profile\t${r.series.map((se) => se.label).join(' · ')}\t(${c(r.length)} m, a station every ${c(r.step)} m)`,
    ['chainage (m)', 'x', 'y', ...r.series.map((se) => `${se.label} z (m)`)].join('\t'),
    ...Array.from(r.s, (s, i) => [c(s), c(r.x[i]), c(r.y[i]), ...r.series.map((se) => c(se.z[i]))].join('\t'))].join('\n');
}

// ── the window ──
let _win = null;
export function openProfile(L0, ropts = {}) {
  if (!surfaceableLayers().length) { $('#meta').textContent = 'profile: needs a surface (a grid or a context mesh) to sample'; return null; }
  if (_win && _win.win.el.isConnected) { if (!ropts.cfg && !ropts.run) { focusWindow(_win.win.el); return _win; } _win.win.close(); }
  const st = { line: null, surfaces: new Set(), step: '', res: null, running: false, drawFrom: null };
  const lines = profileLines();
  const fromL = L0 && isPolygonLayer(L0) ? lines.find((x) => x.L === L0) : null;
  if (fromL || lines[0]) { const x = fromL || lines[0]; st.line = { layer: x.L.name, feature: x.id }; }
  const surfs0 = surfaceableLayers();
  if (L0 && surfs0.includes(L0)) st.surfaces.add(L0.id); else if (surfs0[0]) st.surfaces.add(surfs0[0].id);
  if (ropts.cfg) {
    const c = ropts.cfg;
    if (c.line) st.line = { ...c.line };
    if (Array.isArray(c.surfaces)) { st.surfaces = new Set(); for (const n of c.surfaces) { const Lx = layerNamed(n); if (Lx) st.surfaces.add(Lx.id); } }
    if (c.step) st.step = String(c.step);
  }
  const win = floatWin({ title: 'profile', sub: 'pick a line and the surfaces, then Run', x: Math.max(12, innerWidth - 820), y: 110, w: 800, h: 460, onClose: () => { _win = null; } });
  win.el.dataset.profile = '1';
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1 1 60%;min-height:120px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout pf-readout';
  main.append(cv, readout); body.append(rail, main);
  const cfgOf = () => ({ line: st.line, surfaces: [...st.surfaces].map((id) => (layerById(id) || {}).name).filter(Boolean), ...(+st.step > 0 ? { step: +st.step } : {}) });
  const plot = () => {
    readout.textContent = '';
    if (!st.res) { plotChart(cv, { series: [], placeholder: st.running ? 'sampling…' : 'press Run' }); return; }
    plotChart(cv, profileChartSpec(st.res));
    const add = (k, v, tip) => { const s = document.createElement('span'); s.className = 'val-stat'; if (tip) s.title = tip; const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    add('length', `${st.res.length.toFixed(1)} m`, `${st.res.s.length.toLocaleString()} stations, every ${+st.res.step.toFixed(3)} m and at each vertex`);
    for (const se of st.res.series) { const e = fin(se.z); add(se.label, e.n ? `${e.lo.toFixed(2)} – ${e.hi.toFixed(2)} m` : 'no value', `${Math.round(100 * e.n / st.res.s.length)} % of the line covered`); }
  };
  win.el._onResized = () => { if (st.res) plotChart(cv, profileChartSpec(st.res)); };
  let runBtn, progEl;
  const run = async () => {
    if (st.running) return;
    st.running = true; plot(); win.sub.textContent = 'sampling…';
    const rc = runCancellable(runBtn);
    try {
      const ln = resolveProfileLine(st.line);
      const surfs = [...st.surfaces].map((id) => layerById(id)).filter(Boolean);
      st.res = await profileAlong(ln.pts, surfs, { step: +st.step > 0 ? +st.step : null, signal: rc.signal, onProgress: (f, t) => { progEl.textContent = `${Math.round(f * 100)}% · ${t}`; } });
      win.sub.textContent = `${nameOf(ln.L)} · ${st.res.length.toFixed(1)} m · ${st.res.series.map((se) => se.label).join(', ')}`;
    } catch (e) { win.el._runFailed = e.name === 'AbortError' ? 'cancelled' : e.message; win.sub.textContent = e.name === 'AbortError' ? 'cancelled' : e.message; }
    finally { st.running = false; rc.done(); progEl.textContent = ''; plot(); }
  };
  const head = (t) => Object.assign(document.createElement('div'), { className: 'sw-h', textContent: t });
  const row = (label, el) => { const r = document.createElement('div'); r.className = 'sw-row'; const l = document.createElement('span'); l.textContent = label; l.style.cssText = 'width:44px;flex:0 0 auto'; r.append(l, el); el.style.flex = '1'; el.style.minWidth = '0'; return r; };
  function buildRail() {
    rail.textContent = '';
    // the line: any string / ring of any strings & polygons layer, or draw one
    const lSec = document.createElement('div'); lSec.append(head('line'));
    const ls = document.createElement('select'); ls.className = 'sw-sel'; ls.dataset.role = 'line';
    const all = profileLines();
    if (!all.length) ls.append(new Option('— no line yet: draw one —', ''));
    for (const x of all) ls.append(new Option(x.label, `${x.L.name}\u0000${x.id}`));
    if (st.line) ls.value = `${st.line.layer}\u0000${st.line.feature}`;
    ls.onchange = () => { const [layer, feature] = ls.value.split('\u0000'); st.line = layer ? { layer, feature } : null; };
    // the list is rebuilt when opened, so a line drawn (or loaded) meanwhile is offered
    ls.onmousedown = () => { if (profileLines().length !== all.length) buildRail(); };
    const dr = document.createElement('button'); dr.className = 'sw-add'; dr.textContent = '✎ draw a line'; dr.title = 'click its vertices on the view, Enter to finish (it becomes a line in a “drawn” layer)';
    dr.onclick = () => {
      st.drawFrom = profileLines().length;
      if (!armDraw({ closed: false })) return;
      // pick up the line the moment it exists
      const poll = setInterval(() => {
        if (!win.el.isConnected) { clearInterval(poll); return; }
        const now = profileLines();
        if (now.length > st.drawFrom) { clearInterval(poll); const x = now[now.length - 1]; st.line = { layer: x.L.name, feature: x.id }; buildRail(); }
      }, 400);
    };
    lSec.append(row('line', ls), dr);
    rail.append(lSec);
    // the surfaces: any number of grids and meshes
    const sSec = document.createElement('div'); sSec.append(head('surfaces'));
    for (const L of surfaceableLayers()) {
      const lb = document.createElement('label'); lb.className = 'sw-row'; lb.title = L.docs.gridDoc ? 'a grid: sampled through its height function (bilinear)' : 'a mesh: sampled by a vertical ray from above (its top)';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.surfaces.has(L.id); cb.dataset.surface = L.name;
      cb.onchange = () => { if (cb.checked) st.surfaces.add(L.id); else st.surfaces.delete(L.id); };
      lb.append(cb, document.createTextNode(` ${nameOf(L)}${L.docs.gridDoc ? ' (grid)' : ' (mesh)'}`)); sSec.append(lb);
    }
    rail.append(sSec);
    const pSec = document.createElement('div'); pSec.append(head('stations'));
    const si = document.createElement('input'); si.className = 'sw-in'; si.type = 'text'; si.value = st.step; si.placeholder = 'auto (length / 400)'; si.title = 'the distance between stations along the line (every vertex is one too)'; si.onchange = () => { st.step = si.value.trim(); };
    pSec.append(row('step (m)', si)); rail.append(pSec);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rname = () => `profile ${st.line ? st.line.feature : ''}`.trim();
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => saveRecipe('profile', cfgOf(), rname());
    win.el._recipe = () => ({ tool: 'profile', name: rname(), params: cfgOf() });
    const resRow = plotExportBtns(cv, () => `profile-${st.line ? st.line.feature : 'line'}.png`.replace(/[^\w.-]+/g, '_'), () => (st.res ? profileHumanTSV(st.res) : null), 'profile');
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, progEl); rail.append(foot);
  }
  buildRail(); plot();
  _win = { win, st, run, plot };
  if (ropts.run) run();
  return _win;
}

// ── the palette command, the Tools menu row, a strings layer's own entry ──
registerCommands([
  { id: 'profile', group: 'Analyse', title: 'Profile along a line…', kw: 'profile elevation section line topography surface chainage cross ground level along long section perfil', when: () => surfaceableLayers().length > 0, run: (c) => openProfile(c.L) },
]);
contributeMenu('tools', () => (surfaceableLayers().length ? [{ label: 'Profile along a line…', action: () => openProfile(null) }] : []));
