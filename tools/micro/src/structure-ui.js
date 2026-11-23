// micro structure window — the capivaras workbench on an outcrop mesh.
//
// What the geologist does: pick a set, click a joint face with the WAND (it takes
// the whole coplanar face) or paint it with the BRUSH, and read the plane it
// measures. Hovering previews the region and its attitude before anything is
// committed; every committed stroke re-measures the planes, redraws their discs
// on the rock, and updates the table. Sets are a paint column (`SET`) on the
// mesh's vertex records, so undo, saving and export are the paint machinery's.
//
// The geometry lives in ./structure.js; this file is the window and the pointer.
import { floatWin, focusWindow } from './windows.js';
import { setHTML, trusted } from './html.js';
import { resolvedTheme, tok } from './theme.js';
import { plotExportBtns, fmtStat } from './analysis-ui.js';
import { prepareStructure, structureOf, structureCost, regionAt, seedOf, fitRegion, toFile, weldedCodes, measurePlanes, tracePlanes, traceTubes, surfacePath, fileOf, setStats, poleOf, orientationColors, orientationRgb, vertexColors, discMesh, QUALITY, traceNetwork, nodeMarkers, snapToTraces, NODE_COLORS } from './structure.js';
import { Stereonet } from '../../../ext/bearing/index.js';
import { recordingContext } from '../../../ext/plot/index.js';
import { detectSets } from '../../../ext/clar/index.js';
import { buildMeshChunk, writeDxf } from '../../../ext/condenser/src/main.js';
import { meshVertexData } from './records.js';
import { vertexColorOf } from './wfr-io.js';
import { S, layerById, requestRender } from './state.js';
import { pushUndo } from './undo.js';
import { mkLineage } from './lineage.js';
import { renderLayers } from './layers-panel.js';
import { hexToRgb01 } from './color.js';
import { markProjectDirty } from './project.js';
import { addLayer } from './ingest.js';
import { deliverBlob } from './hostio.js';
import { allocLayerId, removeLayerUI } from './layers.js';
import { convertMeshLayer } from './layermenu.js';
import { zoomToPoint } from './camera.js';
import { addPaintValue, createPaintCol, paintApply } from './paint.js';
import { meshHitAt, pixelRay } from './pick.js';
const $ = (s) => document.querySelector(s);

export const _structWins = new Map();                       // mesh layer id → handle
export const SET_COL = 'SET';

const fmtSize = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b >= 1 << 20 ? Math.round(b / (1 << 20)) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const pad3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
const att = (dd, dip) => `${pad3(dd)}/${String(Math.round(dip)).padStart(2, '0')}`;
// κ past 10⁵ is 'parallel to measurement precision' — a nine-digit number would claim more than it knows
const KAPPA_CAP = 1e5;
const fmtKappa = (k) => (Number.isNaN(k) ? '—' : k > KAPPA_CAP ? '>10⁵' : fmtStat(k));   // NaN = undefined (one normal), not a perfect fit
const SET_COLORS = ['#d9534f', '#4a90d9', '#5cb85c', '#e8a33d', '#9b6fd0', '#3cbcb4', '#d96fb0', '#8f9b3c'];

// tool settings ride localStorage — a preference, not project data
const PREFS_KEY = 'micro.structure';
const PREF_DEFAULTS = { tool: 'wand', angle: 12, distance: 0, radius: 1, discs: true, nodes: true, orient: false, gc: false, contour: true };
const prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...PREF_DEFAULTS }; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private */ } };

// ── the set column ──
export const setColOf = (L) => ((L && L.paintCols) || []).find((c) => c.name === SET_COL) || null;
function ensureSetCol(L) {
  let col = setColOf(L);
  if (!col) {
    col = createPaintCol(L, SET_COL);
    if (!col) return null;
    const c = addPaintValue(L, col, 'J1');
    if (c) col.colors[c] = SET_COLORS[0];
  }
  return col;
}
const liveCodes = (col) => col.dict.map((d, i) => (i > 0 && d != null ? i : 0)).filter(Boolean);

// ── colours on the mesh ──
// the base the sets are painted over: the mesh's own vertex colours when it has
// them (a photogrammetric outcrop), its tint otherwise. Cached on the doc.
async function baseColors(L) {
  const md = L.docs.meshDoc;
  if (prefs.orient) { const st = structureOf(L); if (st) return (md._structOrient = md._structOrient || orientationColors(st)); }
  if (md._structBase) return md._structBase;
  if (L.vertexColored) {
    const m = await meshVertexData(L);
    const vc = m && vertexColorOf(m.attrs, m.vertices.length / 3);
    if (vc) return (md._structBase = vc);
  }
  return hexToRgb01(L.tint || '#9ea3a8');
}
// the live rgb buffer, patched in place by the hover preview so a mouse move uploads
// only the vertices it changed
async function paintMesh(L, hd) {
  const col = setColOf(L); if (!col) return;
  const nvFile = col.codes.length;
  hd.base = await baseColors(L);
  hd.rgb = vertexColors(nvFile, col.codes, col.colors, hd.base);
  hd.preview = null;
  S.renderer.setLayerMeshColors(L.id, hd.rgb);
  requestRender();
}
function restoreVertex(hd, col, i) {
  const c = col.codes[i], rgb = hd.rgb;
  if (c && col.colors[c]) { const p = hexToRgb01(col.colors[c]); rgb[3 * i] = p[0]; rgb[3 * i + 1] = p[1]; rgb[3 * i + 2] = p[2]; }
  else if (Array.isArray(hd.base)) { rgb[3 * i] = hd.base[0]; rgb[3 * i + 1] = hd.base[1]; rgb[3 * i + 2] = hd.base[2]; }
  else { rgb[3 * i] = hd.base[3 * i]; rgb[3 * i + 1] = hd.base[3 * i + 1]; rgb[3 * i + 2] = hd.base[3 * i + 2]; }
}
function showPreview(L, hd, fileVerts, hex) {
  const col = setColOf(L); if (!col || !hd.rgb) return;
  let lo = Infinity, hi = -1;
  if (hd.preview) for (const i of hd.preview) { restoreVertex(hd, col, i); if (i < lo) lo = i; if (i > hi) hi = i; }
  hd.preview = fileVerts && fileVerts.length ? fileVerts : null;
  if (hd.preview) {
    const p = hexToRgb01(hex || '#ffffff'), q = [0.4 + 0.6 * p[0], 0.4 + 0.6 * p[1], 0.4 + 0.6 * p[2]];
    for (const i of hd.preview) { hd.rgb[3 * i] = q[0]; hd.rgb[3 * i + 1] = q[1]; hd.rgb[3 * i + 2] = q[2]; if (i < lo) lo = i; if (i > hi) hi = i; }
  }
  if (hi >= lo) { S.renderer.setLayerMeshColors(L.id, hd.rgb, lo, hi + 1); requestRender(); }
}

// ── derived, unsaved mesh layers beside the outcrop: plane discs and trace tubes ──
function derivedOf(L, kind) { return S.layers.find((d) => d.derivedOf === L.id && d.derivedKind === kind) || null; }
function setDerived(L, kind, label, m, opacity) {
  let D = derivedOf(L, kind);
  if (!m || !m.triangles.length) { if (D) { S.renderer.removeLayer(D.id); S.layers = S.layers.filter((x) => x !== D); renderLayers(); requestRender(); } return; }
  if (!D) {
    const id = allocLayerId(); if (id == null) return;
    const name = `${L.label || L.name} · ${label}`;
    D = { id, name, label: name, kind: 'mesh', derivedOf: L.id, derivedKind: kind, docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'volatile', lineage: null, tint: '#ffffff', opacity: 1 };
    S.layers.push(D);
  } else S.renderer.removeLayer(D.id);
  const chunk = buildMeshChunk({ vertices: m.vertices, triangles: m.triangles, frame: S.frame });
  chunk.color = m.color;
  S.renderer.addChunk(chunk, 'base', D.id);
  S.renderer.setLayerMeshStyle(D.id, { tint: [1, 1, 1], opacity });
  D.bboxLocal = chunk.bboxLocal;
  if (!D.visible) S.renderer.setLayerVisible(D.id, false);
  renderLayers(); requestRender();
}
function updateDiscs(L, hd) {
  const col = setColOf(L);
  const on = prefs.discs && hd.planes && hd.planes.length && col;
  setDerived(L, 'planes', 'planes', on ? discMesh(hd.planes, (p) => col.colors[p.code] || '#ffffff') : null, 0.75);
}
// the traces as tubes: the committed ones in their set's colour, the one being drawn
// (and its hover continuation) in white
async function updateTraces(L, hd) {
  const col = setColOf(L);
  const m = await meshVertexData(L); if (!m) return;
  const paths = [...(L.traces || [])];
  if (hd.drawing && hd.drawing.path.length) paths.push({ path: hd.drawing.path, _live: true });
  if (hd.hoverPath && hd.hoverPath.length > 1) paths.push({ path: hd.hoverPath, _live: true });
  const md = L.docs.meshDoc, bb = md.header.bbox;
  const diag = bb ? Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) : 10;
  const rgb = (p) => (p._live ? [1, 1, 1] : hexToRgb01((col && col.colors[p.set]) || '#ffffff'));
  setDerived(L, 'traces', 'traces', paths.length ? traceTubes(m.vertices, paths, rgb, Math.max(1e-3, diag * 0.002)) : null, 1);
}

// the network's nodes as small octahedra, coloured by kind (I / Y / X)
function updateNodes(L, hd) {
  const net = hd.network, md = L.docs.meshDoc, bb = md && md.header.bbox;
  const diag = bb ? Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) : 10;
  const on = prefs.nodes && net && net.nodes.length;
  setDerived(L, 'nodes', 'trace nodes', on ? nodeMarkers(net.nodes, Math.max(1e-3, diag * 0.006)) : null, 1);
}

// ── the refresh every paint edit runs (stroke, undo, redo, restore) — and every trace edit ──
export async function structureAfterEdit(L) {
  if (!L || L.kind !== 'mesh' || !setColOf(L)) return;
  const hd = _structWins.get(L.id) || L._structView || (L._structView = {});
  await paintMesh(L, hd);
  const st = structureOf(L);
  const col = setColOf(L);
  const m = (L.traces && L.traces.length) ? await meshVertexData(L) : null;
  const tp = m ? tracePlanes(m.vertices, L.traces, col.dict) : [];
  if (st) hd.planes = [...measurePlanes(st, col.codes, col.dict), ...tp];
  else hd.planes = tp;
  hd.planes.forEach((p, i) => { p.plane_id = i + 1; });
  hd.selSet = null;
  hd.network = st && L.traces && L.traces.length ? traceNetwork(st, L.traces) : null;
  updateDiscs(L, hd);
  await updateTraces(L, hd);
  updateNodes(L, hd);
  if (hd.render) hd.render();
  if (hd.stereo) hd.stereo.render();
}

// ── the window ──
export async function openStructure(L) {
  const md = L && L.docs && L.docs.meshDoc;
  if (!md) { $('#meta').textContent = 'structural analysis: needs a mesh layer'; return null; }
  const ex = _structWins.get(L.id); if (ex && ex.win.el.isConnected) { focusWindow(ex.win.el); return ex; }
  const win = floatWin({ title: `structure · ${L.label || L.name}`, sub: '', x: Math.max(12, innerWidth - 556), y: 96, w: 540, h: 420,
    onClose: () => { if (_armed && _armed.L === L) disarm(); _structWins.delete(L.id); } });
  const hd = Object.assign(L._structView || {}, { win, L, active: 0, planes: (L._structView && L._structView.planes) || [], sel: -1 });
  L._structView = hd;
  _structWins.set(L.id, hd);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main';
  body.append(rail, main);
  const say = (t) => { main.textContent = ''; const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = t; main.append(d); return d; };

  // ── not ready yet: streamed (promote first), or not prepared ──
  async function ready() {
    const h = L.docs.meshDoc && L.docs.meshDoc.header;
    if (!h) { say('this layer is no longer a mesh'); return false; }
    if (h.soup) {
      rail.textContent = '';
      const d = say(`This mesh is drawn streamed (${h.triCount.toLocaleString()} triangles), which keeps no geometry on the page to measure. Load it exactly first.`);
      const b = document.createElement('button'); b.className = 'awin-btn btn-p'; b.style.marginTop = '10px';
      b.textContent = `Load exact (~${fmtSize((h.vertexCount || h.triCount / 2) * 12 + h.triCount * 12)} GPU)…`;
      b.onclick = async () => { if (await convertMeshLayer(L, false)) start(); };
      d.append(document.createElement('br'), b);
      win.sub.textContent = 'streamed — needs the exact mesh';
      return false;
    }
    if (!structureOf(L)) {
      const cost = structureCost(h);
      win.sub.textContent = `preparing · ~${fmtSize(cost)}`; win.sub.classList.add('busy');
      say(`Preparing the mesh for analysis: topology, normals and area weights (about ${fmtSize(cost)} kept while the window's work is in use)…`);
      try { await prepareStructure(L, { onProgress: (m) => { win.sub.textContent = `${m} · ~${fmtSize(cost)}`; } }); }
      catch (e) { say(`structure: ${e.message || e}`); return false; }
      finally { win.sub.classList.remove('busy'); }
      if (!structureOf(L)) { say('structure: could not read this mesh\'s geometry'); return false; }
    }
    return true;
  }

  function render() {
    if (!win.el.isConnected) return;
    const col = setColOf(L); if (!col) return;
    const live = liveCodes(col);
    if (!live.includes(hd.active)) hd.active = live[0] || 0;
    // ── rail: sets ──
    rail.textContent = '';
    const h1 = Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'sets' });
    rail.append(h1);
    for (const code of live) {
      const r = document.createElement('div'); r.className = 'sw-row st-set' + (code === hd.active ? ' on' : '');
      const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'stset' + L.id; rb.checked = code === hd.active; rb.title = 'paint this set';
      rb.onchange = () => { hd.active = code; render(); if (_armed) armHint(); };
      const sw = document.createElement('input'); sw.type = 'color'; sw.value = col.colors[code] || '#ffffff'; sw.style.cssText = 'width:22px;height:16px;padding:0;border:0;background:none;cursor:pointer';
      sw.oninput = () => { col.colors[code] = sw.value; markProjectDirty(); structureAfterEdit(L); };
      const nm = document.createElement('input'); nm.type = 'text'; nm.className = 'sw-in'; nm.value = col.dict[code]; nm.style.width = '54px';
      nm.onchange = () => { const v = nm.value.trim(); if (v && !col.dict.some((d, i) => i !== code && d === v)) { col.dict[code] = v; L._colStats = null; markProjectDirty(); structureAfterEdit(L); } else nm.value = col.dict[code]; };
      const sm = setStats(hd.planes, code);
      const info = document.createElement('span'); info.className = 'st-setinfo';
      if (sm.n) {
        info.textContent = `${sm.n} · ${att(sm.dip_direction, sm.dip)}`;
        info.title = `${sm.n} plane${sm.n === 1 ? '' : 's'}; Fisher mean ${att(sm.dip_direction, sm.dip)}${sm.n > 1 ? `; κ ${fmtKappa(sm.kappa)}; α95 ${sm.alpha95.toFixed(1)}°` : ''}`;
      } else info.textContent = '—';
      r.append(rb, sw, nm, info);
      rail.append(r);
    }
    if (L.vertexColored) {
      const imp = document.createElement('button'); imp.className = 'awin-btn'; imp.textContent = '⇩ sets from paint';
      imp.title = 'ply2atti: a mesh painted in saturated colours (pure red, green, blue, …) — each colour becomes a set; photographic colour never does';
      imp.onclick = () => importPaintedSets(L);
      rail.append(imp);
    }
    const add = document.createElement('button'); add.className = 'awin-btn'; add.textContent = '+ set';
    add.onclick = () => {
      const n = liveCodes(col).length + 1;
      const c = addPaintValue(L, col, `J${n}`);
      if (c) { col.colors[c] = SET_COLORS[(n - 1) % SET_COLORS.length]; hd.active = c; }
      render();
    };
    rail.append(add);
    // ── rail: tool ──
    rail.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'tool' }));
    const tools = document.createElement('div'); tools.className = 'st-tools';
    for (const [k, label, title] of [['wand', 'wand', 'click a face: takes the whole coplanar face'], ['brush', 'brush', 'drag: paints within the radius of the stroke, staying on the face it started on'], ['erase', 'erase', 'click (wand) or drag (brush) to unpaint'], ['trace', 'trace', 'click points along a fracture trace — the line follows the surface between them. Double-click or Enter finishes · Backspace drops the last point · Esc cancels']]) {
      const b = document.createElement('button'); b.className = 'awin-btn' + (prefs.tool === k ? ' on' : ''); b.textContent = label; b.title = title;
      b.onclick = () => { prefs.tool = k; if (k !== 'erase') prefs.shape = k; savePrefs(); render(); arm(L); };
      tools.append(b);
    }
    rail.append(tools);
    const num = (label, key, title, step, unit) => {
      const r = document.createElement('div'); r.className = 'sw-row'; r.title = title;
      const s = document.createElement('span'); s.textContent = label; s.style.width = '52px';
      const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = step; i.min = '0'; i.value = prefs[key] || ''; i.style.width = '60px';
      i.placeholder = key === 'distance' ? 'off' : '';
      i.onchange = () => { prefs[key] = Math.max(0, parseFloat(i.value) || 0); savePrefs(); };
      const u = document.createElement('span'); u.textContent = unit; u.style.color = 'var(--dim)';
      r.append(s, i, u); return r;
    };
    const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
    if (prefs.tool !== 'trace') rail.append(num('angle', 'angle', 'the wand (and the brush) stop where the surface turns more than this from the face you clicked', '1', '°'));
    if (prefs.tool !== 'trace') rail.append(num('offset', 'distance', 'optional: they also stop this far off the clicked plane (a step onto a parallel face)', '0.05', 'm'));
    if (shape === 'brush') rail.append(num('radius', 'radius', 'the brush circle, in world units', '0.1', 'm'));
    const arm1 = document.createElement('button'); arm1.className = 'awin-btn btn-p' + (_armed && _armed.L === L ? ' on' : '');
    arm1.textContent = _armed && _armed.L === L ? '■ stop (Esc)' : '▸ paint';
    arm1.onclick = () => { if (_armed && _armed.L === L) disarm(); else arm(L); render(); };
    rail.append(arm1);
    // ── rail: show ──
    rail.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'show' }));
    const dl = document.createElement('label'); dl.className = 'sw-row'; dl.title = 'a disc per measured plane, drawn on the rock in its set\'s colour';
    const dc = document.createElement('input'); dc.type = 'checkbox'; dc.checked = prefs.discs;
    dc.onchange = () => { prefs.discs = dc.checked; savePrefs(); updateDiscs(L, hd); };
    dl.append(dc, ' plane discs');
    rail.append(dl);
    if (L.traces && L.traces.length) {
      const nl = document.createElement('label'); nl.className = 'sw-row'; nl.title = 'where traces end (I), abut (Y) and cross (X), marked on the rock';
      const nc = document.createElement('input'); nc.type = 'checkbox'; nc.checked = prefs.nodes;
      nc.onchange = () => { prefs.nodes = nc.checked; savePrefs(); updateNodes(L, hd); };
      nl.append(nc, ' trace nodes');
      rail.append(nl);
    }
    const ol = document.createElement('label'); ol.className = 'sw-row'; ol.title = 'colour the rock by its orientation — hue = dip direction, saturation = dip (flat is white). Joint sets show as patches of one colour before anything is painted';
    const oc = document.createElement('input'); oc.type = 'checkbox'; oc.checked = prefs.orient;
    oc.onchange = () => { prefs.orient = oc.checked; savePrefs(); structureAfterEdit(L); };
    ol.append(oc, ' colour by orientation');
    rail.append(ol);
    const sb = document.createElement('button'); sb.className = 'awin-btn'; sb.textContent = '◎ stereonet'; sb.title = 'the planes\' poles on a lower-hemisphere equal-area net — lasso poles to select planes, move them to another set';
    sb.onclick = () => openStereonet(L);
    rail.append(sb);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    const tb = document.createElement('button'); tb.className = 'awin-btn'; tb.textContent = '→ table layer'; tb.title = 'the planes as a table layer (replaces an earlier one of the same name) — filter, export and lineage apply';
    tb.onclick = () => planesToTable(L, hd);
    if (L.traces && L.traces.length) {
      const tx = document.createElement('button'); tx.className = 'awin-btn'; tx.textContent = '⇥ traces .dxf'; tx.title = 'the traces as 3D polylines, one DXF layer per set, in world coordinates — for CAD or a modelling package';
      tx.onclick = async () => { const txt = await tracesToDxf(L); if (txt) deliverBlob(new Blob([txt], { type: 'application/dxf' }), `${(L.label || L.name).replace(/\.[^.]+$/, '')}-traces.dxf`); };
      foot.append(tx);
    }
    foot.append(tb, plotExportBtns(null, () => `planes-${(L.label || L.name).replace(/\.[^.]+$/, '')}`, () => planesTSV(hd.planes), 'structure'));
    rail.append(foot);
    // ── main: the planes ──
    main.textContent = '';
    if (!hd.planes.length) {
      say(`No planes yet. Pick a set, press ▸ paint, and click a joint face: the wand takes the whole face up to ${prefs.angle || 12}° off the one you clicked. Hovering shows the region and its attitude first.`);
    } else {
      const t = document.createElement('table'); t.className = 'st-tbl';
      const hr = document.createElement('tr');
      for (const h of ['#', 'set', 'dd/dip', 'n', 'radius', 'e₂/e₁', 'κ', 'quality']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); }
      t.append(hr);
      for (const [k, p] of hd.planes.entries()) {
        const tr = document.createElement('tr'); tr.title = 'click: go to this plane'; if (k === hd.sel || (hd.selSet && hd.selSet.has(k))) tr.className = 'sel';
        const cell = (v, cls) => { const td = document.createElement('td'); td.textContent = v; if (cls) td.className = cls; tr.append(td); return td; };
        cell(String(p.plane_id));
        const sc = cell(p.set + (p.source === 'trace' ? ' ⌇' : '')); sc.style.color = col.colors[p.code] || '';
        if (p.source === 'trace') sc.title = `a trace, ${fmtStat(p.length)} long — its plane is fitted through the line`;
        cell(att(p.dip_direction, p.dip));
        cell(p.n_vertices.toLocaleString(), 'num'); cell(fmtStat(p.radius), 'num'); cell(p.eig_ratio.toFixed(3), 'num');
        cell(p.kappa != null ? fmtKappa(p.kappa) : '—', 'num');
        const q = cell(p.flags.length ? '⚠ ' + p.flags.join(', ') : '✓');
        q.style.color = p.flags.length ? 'var(--caution)' : 'var(--ok)';
        if (p.flags.length) q.title = { straight: 'straight: the trace is nearly a straight line — it fixes the strike, not the dip', rough: `rough: e₂/e₁ > ${QUALITY.rough} — the patch is not very planar`, elongated: `elongated: e₁/e₀ < ${QUALITY.elongated} — strike is well determined, dip much less so`, few: `few: under ${QUALITY.few} vertices` }[p.flags[0]];
        tr.onclick = () => { hd.sel = k; zoomToPoint([p.X, p.Y, p.Z], p.radius * 1.5); render(); };
        if (p.source === 'trace') {
          const del = document.createElement('td'); del.textContent = '×'; del.title = 'delete this trace (Ctrl+Z undoes)'; del.style.cursor = 'pointer';
          del.onclick = (ev) => { ev.stopPropagation(); removeTrace(L, p._trace); };
          tr.append(del);
        }
        t.append(tr);
      }
      main.append(t);
    }
    if (hd.network) main.append(networkPanel(hd.network, col));
    const nSets = new Set(hd.planes.map((p) => p.code)).size;
    win.sub.textContent = `${hd.planes.length} plane${hd.planes.length === 1 ? '' : 's'} · ${nSets} set${nSets === 1 ? '' : 's'}`;
    win.el._structure = { planes: hd.planes.map(({ _verts, ...p }) => p), network: hd.network && { counts: hd.network.counts, branches: hd.network.branches, lines: hd.network.lines, CB: hd.network.connectivityPerBranch, CL: hd.network.connectivityPerLine, abut: hd.network.abut, touches: hd.network.touches } };
  }
  hd.render = render;
  async function start() {
    if (!(await ready())) return;
    if (!ensureSetCol(L)) { say('structure: this mesh has no vertex records'); return; }
    await structureAfterEdit(L);
    render();
  }
  await start();
  return hd;
}

// ── the trace network: counts, the I–Y–X triangle, connectivity, who abuts whom ──
// The ternary is Sanderson & Nixon's: corners I, Y, X, the network a point by its node
// proportions; the dashed lines are constant connections-per-line, C_L = 1, 2, 3
// (C_L = 4(Y+X)/(I+Y) — straight lines in the triangle, so two points each).
const rgbHex = (c) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
function networkPanel(net, col) {
  const box = document.createElement('div'); box.className = 'st-net';
  const { I, Y, X, other } = net.counts, n = I + Y + X;
  const W = 150, Hh = 132, P = { I: [10, Hh - 14], Y: [W - 10, Hh - 14], X: [W / 2, 12] };
  const at = (pi, py, px) => [pi * P.I[0] + py * P.Y[0] + px * P.X[0], pi * P.I[1] + py * P.Y[1] + px * P.X[1]];
  let svg = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" style="flex:none">`;
  svg += `<polygon points="${[P.I, P.Y, P.X].map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--dim)" stroke-width="1"/>`;
  for (const c of [1, 2, 3]) {
    const a = at(1 - c / 4, c / 4, 0), b = at(4 / (4 + c), 0, c / (4 + c));
    svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="var(--dim)" stroke-dasharray="2 3" stroke-width="0.8"/>`;
    svg += `<text x="${a[0] + 2}" y="${a[1] + 10}" font-size="8" fill="var(--dim)">${c}</text>`;
  }
  for (const k of ['I', 'Y', 'X']) svg += `<text x="${P[k][0] + (k === 'I' ? -8 : k === 'Y' ? 2 : -3)}" y="${P[k][1] + (k === 'X' ? -2 : 11)}" font-size="10" fill="${rgbHex(NODE_COLORS[k])}">${k}</text>`;
  if (n) { const [x, y] = at(I / n, Y / n, X / n); svg += `<circle cx="${x}" cy="${y}" r="4" fill="var(--fg, #ddd)" stroke="#000" stroke-width="0.5"/>`; }
  svg += '</svg>';
  const tri = document.createElement('div'); setHTML(tri, trusted(svg));   // numbers + fixed labels only tri.title = 'Sanderson & Nixon (2015): the network by its node proportions; dashed: connections per line C_L = 1, 2, 3';
  const info = document.createElement('div'); info.className = 'st-netinfo';
  const line = (t, title) => { const d = document.createElement('div'); d.textContent = t; if (title) d.title = title; info.append(d); return d; };
  const h = line('trace network'); h.className = 'sw-h';
  const cnt = line('');
  for (const k of ['I', 'Y', 'X']) { const sp = document.createElement('span'); sp.style.color = rgbHex(NODE_COLORS[k]); sp.textContent = `${k} ${net.counts[k]}  `; cnt.append(sp); }
  if (other) cnt.append(`· ${other} other`);
  cnt.title = 'I: a trace ends in intact rock · Y: a trace ends against another · X: two traces cross' + (other ? ' · other: 5+ branches at one point — usually two nodes digitized on top of each other' : '');
  line(`${net.branches} branches · ${net.lines} lines`, 'branches = (I + 3Y + 4X) / 2 · lines = (I + Y) / 2');
  line(`C_B ${net.connectivityPerBranch.toFixed(2)} · C_L ${net.connectivityPerLine.toFixed(2)}`, 'connections per branch (0–2) and per line — C_L ≥ 3.57 is the percolation threshold usually quoted');
  const pairs = [];
  for (const a of Object.keys(net.abut)) for (const b of Object.keys(net.abut[a])) pairs.push([+a, +b, net.abut[a][b]]);
  if (pairs.length) {
    const ab = line('abutments', 'a trace that ends against another formed after it — the younger set abuts the older'); ab.className = 'sw-h';
    for (const [a, b, c] of pairs.sort((p, q) => q[2] - p[2])) {
      const d = document.createElement('div');
      const sa = document.createElement('span'); sa.textContent = col.dict[a] || '?'; sa.style.color = col.colors[a] || '';
      const sb = document.createElement('span'); sb.textContent = col.dict[b] || '?'; sb.style.color = col.colors[b] || '';
      d.append(sa, ' ends against ', sb, ` ×${c}`);
      info.append(d);
    }
  }
  if (net.touches) line(`${net.touches} touch${net.touches === 1 ? '' : 'es'} not counted`, 'two traces share a point without crossing (or run along each other) — not a node');
  box.append(tri, info);
  return box;
}

// ── ply2atti: sets from a mesh painted in saturated colours ──
// The predecessor's workflow: paint the outcrop in MeshLab, one pure colour per set,
// then extract. clar's detectSets finds the saturated corners of the colour cube
// (photographic colour never sits exactly on one), and each becomes a set named
// for its colour, painted with that colour — one paint step per set, so Ctrl+Z
// takes them back one at a time.
const COLOR_NAMES = { '100': 'red', '010': 'green', '001': 'blue', '110': 'yellow', '101': 'magenta', '011': 'cyan', '000': 'black', '111': 'white' };
const toHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
export async function importPaintedSets(L) {
  const m = await meshVertexData(L);
  const nv = m ? m.vertices.length / 3 : 0;
  const vc = m && vertexColorOf(m.attrs, nv);
  if (!vc) { $('#meta').textContent = 'sets from paint: this mesh carries no vertex colours'; return 0; }
  const groups = detectSets(vc);
  if (!groups.length) { $('#meta').textContent = 'sets from paint: no saturated paint found (photographic colour never counts)'; return 0; }
  const col = ensureSetCol(L); if (!col) return 0;
  // a fresh window's empty J1 is a placeholder, not a set the user made
  for (const c of liveCodes(col)) if (col.dict[c] === 'J1' && !(col.counts && col.counts[c])) col.dict[c] = null;
  let made = 0;
  for (const g of groups) {
    const name = COLOR_NAMES[g.key] || g.key;
    let code = col.dict.indexOf(name);
    if (code < 1) { code = addPaintValue(L, col, name); if (!code) continue; }
    col.colors[code] = toHex(g.color);
    if (paintApply(L, col, g.vertices, code)) made++;
  }
  $('#meta').textContent = `sets from paint: ${made} set${made === 1 ? '' : 's'} (${groups.map((g) => `${COLOR_NAMES[g.key] || g.key} ${g.vertices.length.toLocaleString()}`).join(' · ')})`;
  const hd = _structWins.get(L.id); if (hd && hd.render) hd.render();
  return made;
}

// the traces as DXF: one 3D POLYLINE per trace (its surface path, world coordinates),
// one layer per set, coloured as the set (true colour)
export async function tracesToDxf(L) {
  const m = await meshVertexData(L), col = setColOf(L);
  if (!m || !L.traces || !L.traces.length) return null;
  const features = L.traces.map((t) => {
    const v = new Float64Array(t.path.length * 3);
    t.path.forEach((i, k) => { v[3 * k] = m.vertices[3 * i]; v[3 * k + 1] = m.vertices[3 * i + 1]; v[3 * k + 2] = m.vertices[3 * i + 2]; });
    const [r, g, b] = hexToRgb01((col && col.colors[t.set]) || '#ffffff').map((x) => Math.round(x * 255));
    return { type: 'polyline', geometry: { vertices: v, closed: false }, properties: { layer: (col && col.dict[t.set]) || 'traces', color: { mode: 'rgb', r, g, b } } };
  });
  return writeDxf({ features, layers: Object.fromEntries(features.map((ft) => [ft.properties.layer, {}])) });
}

// ── trace edits (the shared history: a trace isn't paint) ──
function commitTrace(L, t) {
  L.traces = L.traces || [];
  L.traces.push(t);
  const undo = () => { const i = L.traces.indexOf(t); if (i >= 0) L.traces.splice(i, 1); markProjectDirty(); structureAfterEdit(L); };
  const redo = () => { if (!L.traces.includes(t)) L.traces.push(t); markProjectDirty(); structureAfterEdit(L); };
  pushUndo('trace', undo, { redo });
  markProjectDirty(); structureAfterEdit(L);
}
export function removeTrace(L, k) {
  const t = L.traces && L.traces[k]; if (!t) return;
  L.traces.splice(k, 1);
  pushUndo('delete trace', () => { L.traces.splice(Math.min(k, L.traces.length), 0, t); markProjectDirty(); structureAfterEdit(L); },
    { redo: () => { const i = L.traces.indexOf(t); if (i >= 0) L.traces.splice(i, 1); markProjectDirty(); structureAfterEdit(L); } });
  markProjectDirty(); structureAfterEdit(L);
}

// ── the planes as a table layer (replace on name: running it twice == once) ──
const TABLE_COLS = ['plane_id', 'set', 'source', 'length', 'dip_direction', 'dip', 'X', 'Y', 'Z', 'nx', 'ny', 'nz', 'eig0', 'eig1', 'eig2', 'n_vertices', 'average_resultant_length', 'radius', 'kappa', 'rms', 'eig_ratio', 'quality'];
// κ is stored as the display shows it: past 10⁵ (∞ included, a patch whose
// normals agree exactly) is 'parallel to measurement precision', so the column
// holds KAPPA_CAP there. An infinite κ used to be written as blank, so the best
// fits read as missing data.
const rowOf = (p) => ({ ...p, quality: p.flags.length ? p.flags.join(' ') : 'ok', kappa: typeof p.kappa === 'number' && p.kappa > KAPPA_CAP ? KAPPA_CAP : p.kappa });
function planesTSV(planes) {
  if (!planes || !planes.length) return null;
  return [TABLE_COLS.join('\t'), ...planes.map((p) => { const r = rowOf(p); return TABLE_COLS.map((c) => r[c] ?? '').join('\t'); })].join('\n');
}
export async function planesToTable(L, hd) {
  const planes = (hd || L._structView || {}).planes || [];
  if (!planes.length) { $('#meta').textContent = 'structure: no planes to tabulate yet'; return null; }
  const name = `${(L.label || L.name).replace(/\.[^.]+$/, '')}-planes`;
  for (const old of S.layers.filter((x) => x.kind === 'table' && (x.label || x.name).replace(/\.csv$/i, '') === name)) removeLayerUI(old.id);
  const columns = {};
  for (const c of TABLE_COLS) columns[c] = planes.map((p) => { const v = rowOf(p)[c]; return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? (c === 'set' || c === 'quality' ? '' : NaN) : v; });
  const id = await addLayer({ kind: 'table', name, columns });
  const T = id != null ? layerById(id) : null;
  if (T) {
    T.lineage = mkLineage('structure.planes', { sets: [...new Set(planes.map((p) => p.set))], planes: planes.length, kappaCap: KAPPA_CAP, wand: { angle: prefs.angle, offset: prefs.distance || null } }, [L.lineage].filter(Boolean));
    markProjectDirty();
    $('#meta').textContent = `structure: ${planes.length} planes → ${name}`;
  }
  return id;
}

// ── the pointer: armed painting on one mesh ──
let _armed = null;                                         // { L } while ▸ paint is on
let _stroke = null;                                        // brush: Set of file vertices this drag has covered
let _hoverSeq = 0;
function armHint() {
  if (!_armed) return;
  const L = _armed.L, col = setColOf(L), hd = _structWins.get(L.id);
  const set = col && hd ? col.dict[hd.active] : '?';
  if (prefs.tool === 'trace') {
    const n = hd && hd.drawing ? hd.drawing.pts.length : 0;
    $('#meta').textContent = n ? `trace → ${set}: ${n} point${n === 1 ? '' : 's'} — click on along the fracture · double-click / Enter finishes · Backspace drops a point · Esc cancels` : `trace → ${set} — click the first point of a fracture trace · Esc stops`;
    return;
  }
  const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
  $('#meta').textContent = prefs.tool === 'erase'
    ? `erase (${shape}) — ${shape === 'wand' ? 'click a painted face' : 'drag over paint'} · Esc stops`
    : `${shape} → ${set} — ${shape === 'wand' ? 'click a face' : `drag to paint · ⇧ + wheel sizes the brush (${prefs.radius} m)`} · alt erases · right-drag orbits · Esc stops`;
}
export function arm(L) {
  _armed = { L };
  const cv = $('#cv'); cv.style.cursor = 'crosshair';
  armHint();
  const hd = _structWins.get(L.id); if (hd && hd.render) hd.render();
}
export function disarm() {
  const was = _armed; _armed = null; _stroke = null;
  $('#cv').style.cursor = '';
  if (was) {
    const hd = _structWins.get(was.L.id);
    if (hd) { showPreview(was.L, hd, null); if (hd.drawing || hd.hoverPath) { hd.drawing = null; hd.hoverPath = null; updateTraces(was.L, hd); } if (hd.render) hd.render(); }
    $('#meta').textContent = 'structure: brush down';
  }
}
// a canvas point → the region the current tool would take there (welded + file), or null
async function regionUnder(L, x, y, eraseKey) {
  const st = structureOf(L), col = setColOf(L), hd = _structWins.get(L.id);
  if (!st || !col || !hd) return null;
  const hit = await meshHitAt(L, x, y);
  if (!hit) return null;
  const erase = prefs.tool === 'erase' || eraseKey;
  const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
  const codes = weldedCodes(st, col.codes);
  // painting stays out of OTHER sets; erasing walks only paint
  const exclude = new Uint8Array(st.nv);
  for (let j = 0; j < st.nv; j++) exclude[j] = erase ? (codes[j] === 0 ? 1 : 0) : (codes[j] && codes[j] !== hd.active ? 1 : 0);
  const { o, d } = pixelRay(x, y), org = S.frame.origin;
  const ray = { origin: [o[0] + org[0], o[1] + org[1], o[2] + org[2]], direction: d };
  const r = regionAt(st, hit, ray, shape, { angle: prefs.angle, distance: prefs.distance, radius: prefs.radius }, exclude);
  // the seed itself may sit in another set (painting) or be unpainted (erasing) — nothing to do there
  if (exclude[r.seed]) return { blocked: true, code: codes[r.seed], st, col, hd };
  return { ...r, erase, shape, st, col, hd, file: toFile(st, r.vertices) };
}
const SNAP_PX = 10;
async function vertexUnder(L, x, y) {
  const st = structureOf(L); if (!st) return null;
  const hit = await meshHitAt(L, x, y);
  if (!hit) return null;
  if (L.traces && L.traces.length) {
    // SNAP_PX on screen, as a distance in the world at the hit's depth
    const r0 = pixelRay(x, y), r1 = pixelRay(x + SNAP_PX, y);
    const o = S.frame ? S.frame.origin : [0, 0, 0];
    const rel = [hit.point[0] - o[0] - r0.o[0], hit.point[1] - o[1] - r0.o[1], hit.point[2] - o[2] - r0.o[2]];
    const t = (rel[0] * r0.d[0] + rel[1] * r0.d[1] + rel[2] * r0.d[2]) / (r0.d[0] ** 2 + r0.d[1] ** 2 + r0.d[2] ** 2);
    const rad = Math.hypot(...[0, 1, 2].map((k) => (r1.o[k] - r0.o[k]) + (r1.d[k] - r0.d[k]) * t));
    const s = snapToTraces(st, L.traces, hit.point, rad);
    if (s != null) return { st, v: s, snapped: true };
  }
  return { st, v: seedOf(st, hit) };
}
function traceFinish(L) {
  const hd = _structWins.get(L.id); if (!hd || !hd.drawing) return;
  const st = structureOf(L), d = hd.drawing;
  hd.drawing = null; hd.hoverPath = null;
  if (d.path.length < 2) { $('#meta').textContent = 'trace: needs two points or more'; updateTraces(L, hd); return; }
  commitTrace(L, { set: hd.active, pts: d.pts.map((j) => fileOf(st, j)), path: Array.from(d.path, (j) => fileOf(st, j)) });
  $('#meta').textContent = `trace → ${setColOf(L).dict[hd.active]} (${d.pts.length} points; Ctrl+Z undoes)`;
}
function traceRebuild(st, pts) {                           // the path through every control point, in order
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (!i) { out.push(pts[0]); continue; }
    const seg = surfacePath(st, pts[i - 1], pts[i]); if (!seg) return null;
    for (let k = 1; k < seg.length; k++) out.push(seg[k]);
  }
  return out;
}
function readout(r) {
  if (!r || r.blocked || !r.vertices || r.vertices.length < 3) return null;
  const f = fitRegion(r.st, r.vertices);
  if (!f) return null;
  return `${att(f.dipDirection, f.dip)} · ${f.n.toLocaleString()} vertices · e₂/e₁ ${f.eigRatio21.toFixed(3)}`;
}
function commit(L, file, erase) {
  const col = setColOf(L), hd = _structWins.get(L.id);
  if (!col || !hd || !file || !file.length) return 0;
  return paintApply(L, col, file, erase ? 0 : hd.active);
}
const inCanvas = (e) => { const r = $('#cv').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
let _lastPtr = null, _radAcc = 0;
export function installStructurePointer(cv) {
  // ⇧ + wheel sizes the BRUSH while it is armed (proportional per notch, like ⌥ + wheel for the slab:
  // responsive at any mesh scale). Captured on window so the camera's dolly never sees the notch.
  // Shift turns a wheel notch into a horizontal scroll on some systems: read whichever delta moved.
  window.addEventListener('wheel', (e) => {
    if (!_armed || !e.shiftKey || e.target !== cv) return;
    const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
    if (shape !== 'brush') return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    _radAcc += e.deltaY || e.deltaX;
    while (Math.abs(_radAcc) >= 100) {
      const up = _radAcc < 0;                                // wheel up = a bigger brush
      prefs.radius = Math.max(0.01, +((prefs.radius || 1) * (up ? 1.15 : 1 / 1.15)).toPrecision(3));
      _radAcc -= Math.sign(_radAcc) * 100;
    }
    savePrefs();
    const hd = _structWins.get(_armed.L.id); if (hd && hd.render) hd.render();   // the rail's radius box follows
    $('#meta').textContent = `brush radius ${prefs.radius} m — ⇧ + wheel to change`;
    if (_lastPtr) cv.dispatchEvent(new PointerEvent('pointermove', { clientX: _lastPtr[0], clientY: _lastPtr[1], bubbles: true }));   // the hover preview at the new size
  }, { capture: true, passive: false });
  cv.addEventListener('pointermove', (e) => {
    _lastPtr = [e.clientX, e.clientY];
    if (!_armed) return;
    const L = _armed.L;
    if (_stroke) {                                         // brush drag: grow the stroke
      e.stopImmediatePropagation();
      // every move's region counts — a stroke is the union, so a slow hit test must not drop
      // the move before it (no latest-wins here, unlike the hover)
      const [x, y] = inCanvas(e), stroke = _stroke;
      regionUnder(L, x, y, e.altKey).then((r) => {
        if (!r || r.blocked || _stroke !== stroke) return;
        for (const i of r.file) stroke.add(i);
        const col = setColOf(L);
        showPreview(L, r.hd, Uint32Array.from(stroke), r.erase ? (col.blankColor || '#333333') : col.colors[r.hd.active]);
      });
      return;
    }
    if (e.buttons || e.pointerType !== 'mouse') return;   // hover previews are for a mouse at rest
    if (prefs.tool === 'trace') {
      const hd = _structWins.get(L.id); if (!hd || !hd.drawing) return;
      const [x, y] = inCanvas(e), seq = ++_hoverSeq;
      requestAnimationFrame(() => {
        if (seq !== _hoverSeq || !_armed) return;
        vertexUnder(L, x, y).then((u) => {
          if (seq !== _hoverSeq || !u || !hd.drawing) return;
          hd.hoverPath = surfacePath(u.st, hd.drawing.pts[hd.drawing.pts.length - 1], u.v);
          updateTraces(L, hd);
          if (u.snapped) $('#meta').textContent = 'on an existing trace — click to end against it (a Y node) or carry on across it (an X)';
          else armHint();
        });
      });
      return;
    }
    const [x, y] = inCanvas(e), seq = ++_hoverSeq;
    requestAnimationFrame(() => {
      if (seq !== _hoverSeq || !_armed) return;
      regionUnder(L, x, y, e.altKey).then((r) => {
        if (seq !== _hoverSeq || !_armed) return;
        const hd = _structWins.get(L.id); if (!hd) return;
        if (!r) { showPreview(L, hd, null); setGhost(hd, null); armHint(); return; }
        if (r.blocked) { showPreview(L, hd, null); $('#meta').textContent = r.erase ? 'nothing painted there' : `that face is already in ${r.col.dict[r.code]} — erase it first`; return; }
        const col = setColOf(L);
        showPreview(L, hd, r.file, r.erase ? (col.blankColor || '#333333') : col.colors[hd.active]);
        const t = readout(r);
        setGhost(hd, r.erase || r.blocked ? null : r);
        $('#meta').textContent = r.erase ? `erase ${r.file.length.toLocaleString()} vertices` : `${r.shape} → ${col.dict[hd.active]}: ${t || `${r.file.length} vertices`} — click to ${r.shape === 'wand' ? 'take it' : 'paint'}`;
      });
    });
  }, { capture: true });
  cv.addEventListener('pointerdown', (e) => {
    if (!_armed || e.button !== 0) return;               // right / middle drags still orbit and pan
    e.stopImmediatePropagation(); e.preventDefault();
    const L = _armed.L;
    const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
    const [x, y] = inCanvas(e);
    if (prefs.tool === 'trace') {
      const seq = ++_hoverSeq;
      vertexUnder(L, x, y).then((u) => {
        if (seq !== _hoverSeq) return;
        const hd = _structWins.get(L.id); if (!hd) return;
        if (!u) { $('#meta').textContent = 'trace: not on the rock'; return; }
        if (!hd.drawing) hd.drawing = { pts: [u.v], path: [u.v] };
        else {
          const last = hd.drawing.pts[hd.drawing.pts.length - 1];
          if (u.v === last) return;                          // the second click of a double-click
          const seg = surfacePath(u.st, last, u.v);
          if (!seg) { $('#meta').textContent = 'trace: that point is not connected to the last one along the surface'; return; }
          hd.drawing.pts.push(u.v);
          for (let k = 1; k < seg.length; k++) hd.drawing.path.push(seg[k]);
        }
        hd.hoverPath = null;
        armHint(); updateTraces(L, hd);
      });
      return;
    }
    if (shape === 'brush') {
      _stroke = new Set(); _stroke.erase = prefs.tool === 'erase' || e.altKey;
      regionUnder(L, x, y, e.altKey).then((r) => { if (r && !r.blocked && _stroke) for (const i of r.file) _stroke.add(i); });
      return;
    }
    const seq = ++_hoverSeq;
    regionUnder(L, x, y, e.altKey).then((r) => {
      if (seq !== _hoverSeq) return;
      if (!r) { $('#meta').textContent = 'structure: nothing there'; return; }
      if (r.blocked) { $('#meta').textContent = r.erase ? 'nothing painted there' : `that face is already in ${r.col.dict[r.code]} — erase it first`; return; }
      const t = readout(r);
      const n = commit(L, r.file, r.erase);
      if (n && t && !r.erase) $('#meta').textContent = `${r.col.dict[r.hd.active]} + ${t} (Ctrl+Z undoes)`;
    });
  }, { capture: true });
  const end = (e) => {
    if (!_armed || !_stroke) return;
    e.stopImmediatePropagation();
    const L = _armed.L, s = _stroke; _stroke = null; ++_hoverSeq;
    const hd = _structWins.get(L.id); if (hd) showPreview(L, hd, null);
    if (s.size) commit(L, Uint32Array.from(s), s.erase);
  };
  cv.addEventListener('pointerup', end, { capture: true });
  cv.addEventListener('pointercancel', end, { capture: true });
  cv.addEventListener('dblclick', (e) => { if (_armed && prefs.tool === 'trace') { e.stopImmediatePropagation(); e.preventDefault(); setTimeout(() => traceFinish(_armed.L), 30); } }, { capture: true });
  addEventListener('keydown', (e) => {
    if (!_armed) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const L = _armed.L, hd = _structWins.get(L.id);
    if (prefs.tool === 'trace' && hd && hd.drawing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hd.drawing = null; hd.hoverPath = null; updateTraces(L, hd); armHint(); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); traceFinish(L); return; }
      if (e.key === 'Backspace') {
        e.preventDefault(); e.stopImmediatePropagation();
        const d = hd.drawing; d.pts.pop();
        if (!d.pts.length) hd.drawing = null; else d.path = traceRebuild(structureOf(L), d.pts) || [d.pts[0]];
        hd.hoverPath = null; updateTraces(L, hd); armHint(); return;
      }
    }
    if (e.key === 'Escape') disarm();
  }, true);
  // the outcrop goes → its window, discs and arming go with it
  addEventListener('micro:layer-removed', (e) => {
    const id = e.detail && e.detail.id;
    if (_armed && _armed.L.id === id) disarm();
    const hd = _structWins.get(id); if (hd) hd.win.close ? hd.win.close() : hd.win.el.remove();
    for (const D of S.layers.filter((d) => d.derivedOf === id)) { S.renderer.removeLayer(D.id); S.layers = S.layers.filter((x) => x !== D); }
    renderLayers();
  });
}
export const structureArmed = () => _armed;
export const structureTool = () => prefs.tool;

// ── the stereonet: the planes' poles, linked both ways ──
// Lower-hemisphere equal-area (bearing's Stereonet). One pole per plane in its set's
// colour; per set, the Fisher mean and its α95 cone; optional great circles and a
// density contour of all poles. Click a pole → that plane (the table + the camera);
// drag a lasso → select planes, then move them to another set — so a stereonet can
// split a set the way a geologist reads it, and the paint follows (one undo step).
// Hovering the rock with the wand puts its plane on the net as a ghost pole.
const NET = 300;
// the net's chrome follows the theme (read at every render, so a theme switch repaints it)
// the net's look: micro's panel (dark or light) — or PAPER, for a figure (white, dark ink)
const netStyle = (paper = false) => {
  const light = paper || resolvedTheme() === 'light', ink = paper ? '#222' : tok('--text');
  return {
    background: paper ? '#ffffff' : tok('--panel'),
    primitive: { stroke: light ? '#5f5d5a' : '#8a9099', strokeWidth: 1.2, fill: 'none' },
    grid: { stroke: light ? '#d0cfcc' : '#262626', strokeWidth: 0.5, majorStroke: light ? '#bdbbb7' : '#333', majorStrokeWidth: 0.7 },
    cardinals: { fontSize: 11, fontFamily: 'ui-monospace, monospace', fill: light ? '#4f4e4b' : '#8a9099', offset: 12 },
    pole: { r: 3, fill: ink, stroke: 'none' },
    plane: { stroke: ink, strokeWidth: 0.8, fill: 'none' },
    cone: { stroke: ink, strokeWidth: 1, fill: 'none', strokeDasharray: '3,2' },
  };
};
function setGhost(hd, r) {
  const prev = hd.ghost;
  if (!r || !r.vertices || r.vertices.length < 3) hd.ghost = null;
  else { const f = fitRegion(r.st, r.vertices); hd.ghost = f ? { dd: f.dipDirection, dip: f.dip } : null; }
  if (hd.stereo && (prev || hd.ghost)) hd.stereo.render();
}
// the stereonet figure of a layer, made again from its painted sets (the composer's ↻ refresh): the
// planes measured afresh, the net drawn on paper — the window opened for it and closed after if it
// wasn't open
export async function stereonetFigure(L) {
  if (!L || L.kind !== 'mesh') throw new Error('a stereonet needs a mesh layer');
  await structureAfterEdit(L);
  const hd = _structWins.get(L.id) || L._structView;
  if (!hd) throw new Error(`open the structure window for ${L.label || L.name} once`);
  const was = !!(hd.stereo && hd.stereo.win.el.isConnected);
  const sn = openStereonet(L); if (!sn) throw new Error('the stereonet could not open');
  try { return sn.toFigure(); } finally { if (!was) sn.win.close(); }
}
export function openStereonet(L) {
  const hd = _structWins.get(L.id) || L._structView;
  if (!hd) { $('#meta').textContent = 'stereonet: open the structure window first'; return null; }
  if (hd.stereo && hd.stereo.win.el.isConnected) { focusWindow(hd.stereo.win.el); return hd.stereo; }
  const win = floatWin({ title: `stereonet · ${L.label || L.name}`, sub: '', x: 24, y: 96, w: 340, h: 470, onClose: () => { hd.stereo = null; } });
  const wrap = document.createElement('div'); wrap.className = 'sn-wrap';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;height:100%;box-sizing:border-box;overflow:auto';
  const opts = document.createElement('div'); opts.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dim)';
  const tog = (key, label, title) => {
    const l = document.createElement('label'); l.title = title; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!prefs[key];
    c.onchange = () => { prefs[key] = c.checked; savePrefs(); render(); };
    l.append(c, ' ' + label); return l;
  };
  opts.append(tog('gc', 'great circles', 'each plane as its great circle, not just its pole'), tog('contour', 'density', 'Fisher-kernel density contours of all poles (3 or more)'));
  const stage = document.createElement('div'); stage.style.cssText = `position:relative;width:${NET}px;height:${NET}px;align-self:center;flex:none;touch-action:none`;
  const bg = document.createElement('canvas'); bg.width = NET; bg.height = NET; bg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
  const sn = new Stereonet({ size: NET, padding: 18, style: netStyle(), classPrefix: 'msn' });
  const el = sn.element(); el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const lasso = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  lasso.setAttribute('fill', 'color-mix(in srgb, var(--accent) 12%, transparent)'); lasso.setAttribute('stroke', 'var(--accent)'); lasso.setAttribute('stroke-width', '1');
  stage.append(bg, el);
  const selRow = document.createElement('div'); selRow.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;min-height:24px';
  const legend = document.createElement('div'); legend.style.cssText = 'font-size:11px;color:var(--dim);font-family:var(--mono);line-height:1.6';
  wrap.append(opts, stage, selRow, legend);
  win.body.append(wrap);

  // the orientation wheel under the net, when the rock is coloured that way: the
  // same hue/saturation map, so a colour on the rock reads off the net directly
  let bgFor = null, paper = false, lastLines = [];
  function drawWheel() {
    bg.style.display = prefs.orient ? '' : 'none';
    { const ns = netStyle(paper); sn.setStyle({ ...ns, background: prefs.orient ? 'none' : ns.background }); }   // setStyle REPLACES the instance style
    if (!prefs.orient || bgFor === 'wheel') return;
    const g = bg.getContext('2d'), img = g.createImageData(NET, NET), c = [0, 0, 0];
    for (let y = 0; y < NET; y++) for (let x = 0; x < NET; x++) {
      const d = sn.unproject(x + 0.5, y + 0.5); if (!d) continue;
      orientationRgb(-d[0], -d[1], -d[2], c);               // the pole → the surface normal it stands for
      const o = (y * NET + x) * 4; img.data[o] = c[0] * 255; img.data[o + 1] = c[1] * 255; img.data[o + 2] = c[2] * 255; img.data[o + 3] = 150;
    }
    g.putImageData(img, 0, 0); bgFor = 'wheel';
  }
  const colOfCode = (code) => { const col = setColOf(L); return (col && col.colors[code]) || '#bbb'; };
  function render() {
    if (!win.el.isConnected) return;
    const planes = hd.planes || [], col = setColOf(L);
    drawWheel();
    sn.clear(); sn.clearContours();
    if (prefs.contour && planes.length >= 3) sn.contour(planes.map(poleOf), { stroke: paper || resolvedTheme() === 'light' ? '#7f8a96' : '#5a6470', strokeWidth: 0.7 });
    if (prefs.gc) for (const p of planes) sn.plane(p.dip_direction, p.dip, { stroke: colOfCode(p.code), strokeWidth: 0.7 });
    planes.forEach((p, k) => {
      const sel = !paper && ((hd.selSet && hd.selSet.has(k)) || k === hd.sel);
      sn.pole(p.dip_direction, p.dip, { fill: colOfCode(p.code), r: 2.5 + Math.min(3, Math.log10(Math.max(1, p.n_vertices)) * 0.8), stroke: sel ? tok('--text-hi') : 'none', strokeWidth: sel ? 1.5 : 0 });
    });
    const lines = [];
    for (const code of col ? liveCodes(col) : []) {
      const m = setStats(planes, code); if (!m.n) continue;
      sn.pole(m.dip_direction, m.dip, { fill: 'none', stroke: colOfCode(code), strokeWidth: 2, r: 6 });
      if (m.n > 1 && m.alpha95 > 0) {                    // the cone is around the mean POLE (a line: trend/plunge)
        const tr = (m.dip_direction + 180) % 360, pl = 90 - m.dip;
        sn.cone(tr, pl, m.alpha95, { stroke: colOfCode(code) });
      }
      lines.push([code, `${col.dict[code]} · ${m.n} · ${att(m.dip_direction, m.dip)}${m.n > 1 ? ` · κ ${fmtKappa(m.kappa)} · α95 ${m.alpha95.toFixed(1)}°` : ''}`]);
    }
    lastLines = lines.map(([code, t]) => [colOfCode(code), t]);
    if (paper) return;                                    // a figure: the net only, no ghost / legend / selection UI
    if (hd.ghost) sn.pole(hd.ghost.dd, hd.ghost.dip, { fill: 'none', stroke: tok('--text-hi'), strokeWidth: 1.5, r: 5, strokeDasharray: '2,2' });
    sn.render();
    if (lasso.parentNode !== el) el.append(lasso);
    legend.textContent = '';
    for (const [code, t] of lines) { const d = document.createElement('div'); d.textContent = '● ' + t; d.style.color = colOfCode(code); legend.append(d); }
    if (!lines.length) legend.textContent = 'no planes yet';
    // the selection: count + move-to-set
    selRow.textContent = '';
    const n = hd.selSet ? hd.selSet.size : 0;
    if (n) {
      const lab = document.createElement('span'); lab.textContent = `${n} plane${n === 1 ? '' : 's'} selected →`;
      const to = document.createElement('select'); to.className = 'sw-sel';
      for (const code of liveCodes(col)) { const o = document.createElement('option'); o.value = code; o.textContent = col.dict[code]; to.append(o); }
      const nw = document.createElement('option'); nw.value = 'new'; nw.textContent = '+ new set'; to.append(nw);
      const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'move';
      go.onclick = () => moveToSet(to.value);
      const clr = document.createElement('button'); clr.className = 'awin-btn'; clr.textContent = 'clear';
      clr.onclick = () => { hd.selSet = null; render(); if (hd.render) hd.render(); };
      selRow.append(lab, to, go, clr);
    } else { const t = document.createElement('span'); t.style.color = 'var(--dim)'; t.textContent = 'click a pole · drag a lasso to select planes'; selRow.append(t); }
    win.sub.textContent = `${planes.length} pole${planes.length === 1 ? '' : 's'}`;
    win.el._stereo = { poles: planes.length, sel: n, sets: lines.map(([, t]) => t), ghost: hd.ghost };
  }
  function moveToSet(v) {
    const col = setColOf(L), st = structureOf(L); if (!col || !st || !hd.selSet) return;
    let code = +v;
    if (v === 'new') {
      const k = liveCodes(col).length + 1;
      code = addPaintValue(L, col, `J${k}`); if (!code) return;
      col.colors[code] = SET_COLORS[(k - 1) % SET_COLORS.length];
    }
    const verts = [], moved = [];
    for (const k of hd.selSet) { const p = hd.planes[k]; if (!p) continue; if (p.source === 'trace') moved.push([L.traces[p._trace], L.traces[p._trace].set]); else for (const v2 of p._verts) verts.push(v2); }
    const n = hd.selSet.size;
    hd.selSet = null;
    if (moved.length) {
      for (const [t] of moved) t.set = code;
      pushUndo('move traces', () => { for (const [t, was] of moved) t.set = was; markProjectDirty(); structureAfterEdit(L); },
        { redo: () => { for (const [t] of moved) t.set = code; markProjectDirty(); structureAfterEdit(L); } });
      markProjectDirty();
      if (!verts.length) structureAfterEdit(L);
    }
    if (verts.length) paintApply(L, col, toFile(st, verts), code);   // → re-measure via paintAfterEdit
    $('#meta').textContent = `stereonet: ${n} plane${n === 1 ? '' : 's'} → ${col.dict[code]} (Ctrl+Z undoes)`;
  }
  // pointer: a click picks the nearest pole, a drag draws a lasso
  const toNet = (e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) * NET / r.width, (e.clientY - r.top) * NET / r.height]; };
  const polePx = (p) => { const q = sn.project(poleOf(p)); return [q.x, q.y]; };
  let pts = null;
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; pts = [toNet(e)]; el.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => {
    if (!pts) return;
    const q = toNet(e), last = pts[pts.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 3) { pts.push(q); lasso.setAttribute('points', pts.map((a) => a.join(',')).join(' ')); }
  });
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  el.addEventListener('pointerup', (e) => {
    if (!pts) return;
    const poly = pts; pts = null; lasso.setAttribute('points', '');
    const planes = hd.planes || [];
    if (poly.length < 3) {                                 // a click: the nearest pole within 8 px
      const [x, y] = poly[0]; let best = -1, bd = 8;
      planes.forEach((p, k) => { const [px, py] = polePx(p); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = k; } });
      if (best < 0) { hd.selSet = null; hd.sel = -1; }
      else if (e.shiftKey) { hd.selSet = hd.selSet || new Set(); if (hd.selSet.has(best)) hd.selSet.delete(best); else hd.selSet.add(best); }
      else { hd.selSet = new Set([best]); hd.sel = best; const p = planes[best]; zoomToPoint([p.X, p.Y, p.Z], p.radius * 1.5); }
    } else {
      const hit = new Set(e.shiftKey && hd.selSet ? hd.selSet : []);
      planes.forEach((p, k) => { const [px, py] = polePx(p); if (inPoly(px, py, poly)) hit.add(k); });
      hd.selSet = hit.size ? hit : null;
    }
    render(); if (hd.render) hd.render();
  });
  // ⇥ figure: the net on paper, drawn into a recording 2D context (@gcu/plot's) — a draw list the
  // composer prints as vectors; the orientation wheel (when shown) as an image under it, the set
  // means and their statistics as text beneath
  function toFigure() {
    paper = true; bgFor = null;
    try {
      render();
      const lh = 14, H = NET + 10 + lh * lastLines.length, rec = recordingContext(NET, H);
      rec.fillStyle = '#ffffff'; rec.fillRect(0, 0, NET, H);
      if (prefs.orient) { const g = bg.getContext('2d'), im = g.getImageData(0, 0, NET, NET); rec.drawRGBA(0, 0, NET, NET, NET, NET, im.data); }
      sn.draw(rec);
      rec.font = '10px ui-monospace, monospace'; rec.textAlign = 'left'; rec.textBaseline = 'middle';
      lastLines.forEach(([c, t], k) => { rec.fillStyle = c; rec.fillText('● ' + t, 8, NET + 6 + lh * (k + 0.5)); });
      return { version: 2, width: NET, height: H, ops: rec.ops };
    } finally { paper = false; bgFor = null; render(); }
  }
  const figBtn = document.createElement('button'); figBtn.className = 'awin-btn'; figBtn.textContent = '⇥ figure';
  figBtn.title = 'the net into the composer — vector, on paper, with the set means beneath';
  figBtn.onclick = () => dispatchEvent(new CustomEvent('micro:to-composer', { detail: { drawlist: toFigure(), stereonet: { layer: L.name }, name: `stereonet-${(L.label || L.name).replace(/\.[^.]+$/, '')}` } }));
  opts.append(figBtn);
  win.el._onResized = () => render();                     // the theme-change repaint (windows.js calls it on resize too)
  hd.stereo = { win, render, sn, toFigure };
  render();
  return hd.stereo;
}
