// micro — the CRS DETECTIVE window: "were these collars recorded in another datum?"
//
// A drillhole set's collars against a DEM layer: the collar file's numbers read as the project's
// system ("as is") and as each of its datum twins (same projection, another datum — SAD69,
// Córrego Alegre, WGS 84… found in the EPSG table), each reading's collars sampled on the DEM, the
// misfits ranked, and a verdict in plain language. The math is src/crs-detective-core.js (pure,
// Node-tested); this module reads the files, reprojects (@gcu/proj), samples the DEM and draws.
//
// Never acts on its own: the winning reading becomes a REPROJECTION only when the user presses
// "reproject" — the set is re-read with its collars' system stated (config.srcCrs, src/dh-crs.js:
// reprojection on read, with the path + accuracy in lineage). The limits are on the window, always.
import { readDelimited, parseCollars } from '../../../ext/condenser/src/main.js';
import { loadEpsgTable } from '../../../ext/proj/index.js';
import { S, layerById, requestRender } from './state.js';
import { floatWin, focusWindow } from './windows.js';
import { groupLayerIds } from './tree.js';
import { dhSetGroupOf, redesurveySet, setHasCollars, showCollars } from './drillholes.js';
import { residentGridForEval } from './bygeom.js';
import { surfaceFromGrid } from './grid-ops.js';
import { projectCrs, transformPoints, crsLabel, crsToJSON, crsFromJSON, WGS84 } from './crs.js';
import { datumTwins, hypothesesFor, runDetective } from './crs-detective-core.js';
import { registerCommands } from './commands.js';
const $ = (s) => document.querySelector(s);
const membersOf = (nd) => groupLayerIds(nd).map(layerById).filter((L) => L && L.dh && L.docs.dhDoc && !L.trace);
const demLayers = () => S.layers.filter((L) => L && L.viewOf == null && L.docs && L.docs.gridDoc);
const fm = (v, d = 2) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
export const _crsWins = new Map();                         // set node → window state

/**
 * Run the detective on a set against a DEM layer (no window): → the core's result + what it ran on
 * { result, dem, collars, set }. Throws with a reason when it can't run.
 */
export async function checkSetCrs(nd, { dem = null, tol = 2, margin = 2 } = {}) {
  const members = membersOf(nd);
  if (!members.length) throw new Error('not a drillhole set');
  const base = projectCrs();
  if (!base) throw new Error('the project has no coordinate system — set one first (the CRS chip in the status bar): the collars are compared as read in it and in its datum twins');
  const d0 = members[0].docs.dhDoc, mc = d0.header.collarMapping;
  if (!mc || mc.x == null || mc.y == null || mc.z == null) throw new Error('the collar X / Y / Z columns are not identified');
  const demL = dem != null ? layerById(dem) : demLayers()[0];
  if (!demL || !demL.docs.gridDoc) throw new Error('no DEM: open a grid (GeoTIFF, .grd, .asc) of the topography first');
  // the collar file's own numbers (no reprojection) — each reading reinterprets them
  const { collars } = parseCollars(await readDelimited(d0.blobs.collar), mc);
  if (collars.length < 3) throw new Error(`only ${collars.length} collar${collars.length === 1 ? '' : 's'} with X / Y / Z — at least 3 are needed`);
  const raw = collars.map((c) => [c.x, c.y, c.z]);
  let cx = 0, cy = 0; for (const p of raw) { cx += p[0]; cy += p[1]; } cx /= raw.length; cy /= raw.length;
  let lonLat = null; try { lonLat = transformPoints(base, WGS84, [[cx, cy]])[0]; } catch { lonLat = null; }
  const t = await loadEpsgTable();
  const entries = { *[Symbol.iterator]() { for (let i = 0; i < t.count; i++) yield t.entry(i); } };
  const twins = datumTwins(base, entries, { lonLat });
  let current = null; try { current = d0.config && d0.config.srcCrs ? await crsFromJSON(d0.config.srcCrs) : null; } catch { current = null; }
  const hyps = hypothesesFor(raw, base, twins, (a, b, p) => transformPoints(a, b, p), { current, label: (c) => crsLabel(c) });
  // the DEM at full resolution over every reading's collars (+ a few nodes for the slopes)
  const g0 = demL.docs.gridDoc.grid, pitch0 = (g0.dx || 1) * (g0.place ? g0.place.s : 1);
  const b4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const h of hyps) for (const p of h.xy) { if (p[0] < b4[0]) b4[0] = p[0]; if (p[1] < b4[1]) b4[1] = p[1]; if (p[0] > b4[2]) b4[2] = p[0]; if (p[1] > b4[3]) b4[3] = p[1]; }
  const pad = 4 * pitch0; b4[0] -= pad; b4[1] -= pad; b4[2] += pad; b4[3] += pad;
  const grid = await residentGridForEval(demL, b4);
  const surf = surfaceFromGrid(grid), pitch = (grid.dx || pitch0) * (grid.place ? grid.place.s : 1);
  const result = runDetective({ collars: raw, hypotheses: hyps, sampleZ: surf.sampleZ, pitch, tol, margin });
  return { result, dem: demL, collars: raw.length, set: nd, base };
}

/** reproject the set's collars as `crs` (null = read them as the project's system) — re-reads every member */
export async function applySetCollarCrs(nd, crs, note = null) {
  const keepCollars = setHasCollars(nd) ? { ...(nd.collars || {}) } : null;
  await redesurveySet(nd, { srcCrs: crs ? crsToJSON(crs) : null });
  for (const L of membersOf(nd)) if (L.lineage && note) L.lineage.params = { ...(L.lineage.params || {}), crsCheck: note };
  if (keepCollars) await showCollars(nd, keepCollars);
  requestRender();
  dispatchEvent(new CustomEvent('micro:dh-crs', { detail: { set: nd.name, crs: crs ? crsToJSON(crs) : null } }));
}

export function openCrsDetective(ndOrLayer) {
  const nd = ndOrLayer && ndOrLayer.dhSet ? ndOrLayer : (ndOrLayer && ndOrLayer.id != null ? dhSetGroupOf(ndOrLayer.id) : null);
  if (!nd) { $('#meta').textContent = 'CRS check: needs a drillhole set'; return null; }
  const ex = _crsWins.get(nd); if (ex && ex.win.el.isConnected) { focusWindow(ex.win.el); ex.run(); return ex; }
  const st = { nd, dem: (demLayers()[0] || {}).id ?? null, tol: 2, r: null, err: null, running: false };
  const win = floatWin({ title: `CRS check · ${nd.name || 'drillholes'}`, sub: '', x: Math.max(12, innerWidth - 820), y: 96, w: 800, h: 470, onClose: () => _crsWins.delete(nd) });
  st.win = win; win.el.dataset.crsCheck = '1'; win.el._crsCheck = st;
  _crsWins.set(nd, st);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main'; main.style.cssText = 'overflow:auto;padding:8px 10px;gap:8px';
  body.append(rail, main);

  // ── the rail: what it runs on, then the limits of the test ──
  const h = (t) => { const d = document.createElement('div'); d.className = 'sw-h'; d.textContent = t; return d; };
  const row = (label, el, title = '') => { const r = document.createElement('div'); r.className = 'sw-row'; r.title = title; const s = document.createElement('span'); s.textContent = label; r.append(s, el); return r; };
  const demSel = document.createElement('select'); demSel.className = 'sw-sel'; demSel.dataset.crsDem = '1';
  const fillDems = () => { demSel.textContent = ''; for (const L of demLayers()) demSel.append(Object.assign(document.createElement('option'), { value: String(L.id), textContent: L.label || L.name })); if (st.dem != null) demSel.value = String(st.dem); };
  demSel.onchange = () => { st.dem = +demSel.value; run(); };
  const tolIn = document.createElement('input'); tolIn.className = 'sw-in sw-num'; tolIn.type = 'number'; tolIn.step = 'any'; tolIn.value = String(st.tol); tolIn.dataset.crsTol = '1';
  tolIn.onchange = () => { const v = +tolIn.value; if (v > 0) { st.tol = v; run(); } else tolIn.value = String(st.tol); };
  const rerun = document.createElement('button'); rerun.className = 'awin-btn'; rerun.textContent = 'check again'; rerun.onclick = () => run();
  const limits = document.createElement('div'); limits.style.cssText = 'font:11px var(--mono);color:var(--muted);display:flex;flex-direction:column;gap:5px';
  for (const t of [
    'Collars are surveyed on the ground, so they should sit ON the topography. Each reading of the collar file is reprojected into the project\'s system and its collars sampled on the DEM: the right datum puts them back on the ground.',
    'Needs RELIEF: on flat ground a sideways shift changes no height, and the test can\'t tell the datums apart (it says so, from the DEM\'s slope under the collars).',
    'The DEM itself must be in the right system — this checks the collars against it, not it against the world.',
    'Collars may truly sit off today\'s surface: pre-strip topography, collars surveyed before mining. A large, consistent offset everywhere is reported as such, not taken for a datum.',
    'Only datums that share the project\'s projection are tried; readings that land within 0.5 m of each other are one row.',
  ]) { const p = document.createElement('div'); p.textContent = t; limits.append(p); }
  rail.append(h('DEM'), row('grid', demSel, 'the topography the collars are checked against'), row('tolerance m', tolIn, 'a collar within this of the DEM counts as on the ground'), rerun, h('what this can and can\'t tell'), limits);

  // ── the main column: the verdict, the slope line, the ranked table ──
  const verdict = document.createElement('div'); verdict.dataset.crsVerdict = '1';
  verdict.style.cssText = 'font:12px var(--mono);padding:8px 10px;border:1px solid var(--border);border-radius:4px;line-height:1.45';
  const act = document.createElement('div'); act.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  const slopeLine = document.createElement('div'); slopeLine.dataset.crsSlope = '1'; slopeLine.style.cssText = 'font:11px var(--mono);color:var(--muted)';
  const tbl = document.createElement('table'); tbl.dataset.crsTable = '1'; tbl.style.cssText = 'border-collapse:collapse;font:11px var(--mono);width:100%';
  main.append(verdict, act, slopeLine, tbl);

  const COL = { shift: 'var(--caution, #c90)', 'as-is': 'var(--ok, #3a3)', flat: 'var(--muted, #888)', inconclusive: 'var(--muted, #888)', insufficient: 'var(--fault, #c33)', 'no-candidates': 'var(--muted, #888)', error: 'var(--fault, #c33)' };
  function render() {
    act.textContent = ''; tbl.textContent = '';
    if (st.err) { verdict.textContent = st.err; verdict.style.borderColor = verdict.style.color = COL.error; verdict.dataset.kind = 'error'; slopeLine.textContent = ''; return; }
    if (!st.r) { verdict.textContent = st.running ? 'reading the collars and the DEM…' : ''; verdict.style.color = ''; return; }
    const { result: r, dem, collars } = st.r, v = r.verdict;
    verdict.textContent = v.text; verdict.dataset.kind = v.kind;
    verdict.style.borderColor = COL[v.kind] || 'var(--border)'; verdict.style.color = v.kind === 'shift' || v.kind === 'as-is' ? COL[v.kind] : '';
    if (v.kind === 'shift' && v.winner && !v.winner.current) {
      const b = document.createElement('button'); b.className = 'awin-btn btn-p'; b.dataset.crsApply = '1';
      b.textContent = `reproject the collars as ${crsLabel(v.winner.crs)}`;
      b.title = 'the set is re-read with its collars stated in this system and reprojected into the project\'s (heights carried; the path and its accuracy in lineage)';
      b.onclick = () => apply(v.winner);
      act.append(b);
    }
    const cur = r.hypotheses.find((x) => x.current);
    if (cur && !cur.asIs) {
      const b = document.createElement('button'); b.className = 'awin-btn'; b.dataset.crsUndo = '1';
      b.textContent = 'read the collars as the project\'s system again'; b.onclick = () => apply(r.hypotheses.find((x) => x.asIs));
      act.append(b);
    }
    slopeLine.textContent = `${collars} collars · DEM ${dem.label || dem.name} · slope under the collars: median ${fm(r.slope.medDeg, 1)}°, 90% under ${fm(r.slope.p90Deg, 1)}° · ranked by ${r.vertical ? 'the spread about the common offset' : 'median |Δz|'} (Δz = collar − DEM)`;
    const hr = document.createElement('tr');
    for (const t of ['#', 'reading of the collar file', 'median |Δz|', 'spread', 'median Δz', `within ±${st.tol} m`, 'used', 'off DEM', 'moves them']) {
      const th = document.createElement('th'); th.textContent = t; th.style.cssText = 'text-align:left;font-weight:normal;color:var(--muted);padding:2px 6px 2px 0;white-space:nowrap'; hr.append(th);
    }
    tbl.append(hr);
    r.hypotheses.forEach((x, i) => {
      const tr = document.createElement('tr'); tr.dataset.crsRow = x.id;
      if (i === 0 && (v.kind === 'shift' || v.kind === 'as-is')) tr.style.color = COL[v.kind];
      const td = (t, title = '') => { const c = document.createElement('td'); c.textContent = t; c.title = title; c.style.cssText = 'padding:2px 6px 2px 0;white-space:nowrap'; tr.append(c); return c; };
      td(String(i + 1));
      const lab = td(`${x.label}${x.current ? '  (current)' : ''}`, x.members.map((m) => m.label).join('\n')); lab.style.whiteSpace = 'normal';
      td(`${fm(x.medAbs)} m`); td(`${fm(x.spread)} m`); td(`${fm(x.med)} m`);
      td(Number.isFinite(x.inside) ? `${Math.round(100 * x.inside)}%` : '—');
      td(String(x.n)); td(String(x.off));
      td(x.asIs ? '—' : `${fm(x.shift, 1)} m`, x.asIs ? '' : `this reading moves the collars ~${fm(x.shift, 1)} m sideways; over this DEM that is a ~${fm(x.power)} m height change (median)`);
      tbl.append(tr);
    });
  }
  async function apply(h) {
    win.sub.textContent = 'reprojecting the collars…';
    try {
      await applySetCollarCrs(nd, h.asIs ? null : h.crs, { reading: h.label, medianAbsDz: +h.medAbs.toFixed(3), ratio: st.r && st.r.result.verdict.ratio ? +st.r.result.verdict.ratio.toFixed(2) : null, dem: st.r ? (st.r.dem.label || st.r.dem.name) : null });
      $('#meta').textContent = h.asIs ? `${nd.name}: collars read as the project's system` : `${nd.name}: collars reprojected from ${crsLabel(h.crs)} into ${crsLabel(projectCrs())}`;
    } catch (e) { $('#meta').textContent = `CRS check: ${e.message}`; }
    win.sub.textContent = '';
    await run();
  }
  async function run() {
    if (st.running) return;
    st.running = true; st.err = null; fillDems();
    win.sub.textContent = 'checking…'; win.sub.classList.add('busy'); render();
    try { st.r = await checkSetCrs(nd, { dem: st.dem, tol: st.tol }); st.dem = st.r.dem.id; demSel.value = String(st.dem); }
    catch (e) { st.r = null; st.err = `CRS check: ${e.message}`; }
    finally { st.running = false; win.sub.textContent = ''; win.sub.classList.remove('busy'); }
    render();
    dispatchEvent(new CustomEvent('micro:crs-check', { detail: { set: nd.name, kind: st.r ? st.r.result.verdict.kind : 'error' } }));
  }
  st.run = run; st.apply = apply;
  fillDems(); run();
  return st;
}

registerCommands([
  { id: 'dh-crs-check', group: 'Drillholes', title: 'Check CRS against topography…', kw: 'crs datum sad69 corrego alegre sirgas wgs84 shift offset topography dem collar elevation detective reproject coordinate system',
    when: (c) => !!(c.L && c.L.dh && c.L.docs.dhDoc && dhSetGroupOf(c.L.id)), run: (c) => openCrsDetective(dhSetGroupOf(c.L.id)) },
]);

try { window._microCrsCheck = { openCrsDetective, checkSetCrs, applySetCollarCrs, wins: _crsWins }; } catch { /* headless */ }
