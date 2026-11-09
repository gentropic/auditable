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
import { plotExportBtns, fmtStat } from './analysis-ui.js';
import { prepareStructure, structureOf, structureCost, regionAt, fitRegion, toFile, weldedCodes, measurePlanes, setStats, poleOf, orientationColors, orientationRgb, vertexColors, discMesh, QUALITY } from './structure.js';
import { Stereonet } from '../../../ext/bearing/index.js';
import { detectSets } from '../../../ext/clar/index.js';
import { meshVertexData } from './records.js';
import { vertexColorOf } from './wfr-io.js';
import { S, layerById } from './state.js';
const $ = (s) => document.querySelector(s);

// the app's side, passed in once (setStructureHooks)
let H = {};
export function setStructureHooks(h) { H = h; }
export const _structWins = new Map();                       // mesh layer id → handle
export const SET_COL = 'SET';

const fmtSize = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b >= 1 << 20 ? Math.round(b / (1 << 20)) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const pad3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
const att = (dd, dip) => `${pad3(dd)}/${String(Math.round(dip)).padStart(2, '0')}`;
// κ past 10⁵ is 'parallel to measurement precision' — a nine-digit number would claim more than it knows
const fmtKappa = (k) => (!Number.isFinite(k) || k > 1e5 ? '>10⁵' : fmtStat(k));
const SET_COLORS = ['#d9534f', '#4a90d9', '#5cb85c', '#e8a33d', '#9b6fd0', '#3cbcb4', '#d96fb0', '#8f9b3c'];

// tool settings ride localStorage — a preference, not project data
const PREFS_KEY = 'micro.structure';
const PREF_DEFAULTS = { tool: 'wand', angle: 12, distance: 0, radius: 1, discs: true, orient: false, gc: false, contour: true };
const prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...PREF_DEFAULTS }; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private */ } };

// ── the set column ──
export const setColOf = (L) => ((L && L.paintCols) || []).find((c) => c.name === SET_COL) || null;
function ensureSetCol(L) {
  let col = setColOf(L);
  if (!col) {
    col = H.createPaintCol(L, SET_COL);
    if (!col) return null;
    const c = H.addPaintValue(L, col, 'J1');
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
  return H.hexToRgb01(L.tint || '#9ea3a8');
}
// the live rgb buffer, patched in place by the hover preview so a mouse move uploads
// only the vertices it changed
async function paintMesh(L, hd) {
  const col = setColOf(L); if (!col) return;
  const nvFile = col.codes.length;
  hd.base = await baseColors(L);
  hd.rgb = vertexColors(nvFile, col.codes, col.colors, hd.base);
  hd.preview = null;
  H.renderer.setLayerMeshColors(L.id, hd.rgb);
  H.requestRender();
}
function restoreVertex(hd, col, i) {
  const c = col.codes[i], rgb = hd.rgb;
  if (c && col.colors[c]) { const p = H.hexToRgb01(col.colors[c]); rgb[3 * i] = p[0]; rgb[3 * i + 1] = p[1]; rgb[3 * i + 2] = p[2]; }
  else if (Array.isArray(hd.base)) { rgb[3 * i] = hd.base[0]; rgb[3 * i + 1] = hd.base[1]; rgb[3 * i + 2] = hd.base[2]; }
  else { rgb[3 * i] = hd.base[3 * i]; rgb[3 * i + 1] = hd.base[3 * i + 1]; rgb[3 * i + 2] = hd.base[3 * i + 2]; }
}
function showPreview(L, hd, fileVerts, hex) {
  const col = setColOf(L); if (!col || !hd.rgb) return;
  let lo = Infinity, hi = -1;
  if (hd.preview) for (const i of hd.preview) { restoreVertex(hd, col, i); if (i < lo) lo = i; if (i > hi) hi = i; }
  hd.preview = fileVerts && fileVerts.length ? fileVerts : null;
  if (hd.preview) {
    const p = H.hexToRgb01(hex || '#ffffff'), q = [0.4 + 0.6 * p[0], 0.4 + 0.6 * p[1], 0.4 + 0.6 * p[2]];
    for (const i of hd.preview) { hd.rgb[3 * i] = q[0]; hd.rgb[3 * i + 1] = q[1]; hd.rgb[3 * i + 2] = q[2]; if (i < lo) lo = i; if (i > hi) hi = i; }
  }
  if (hi >= lo) { H.renderer.setLayerMeshColors(L.id, hd.rgb, lo, hi + 1); H.requestRender(); }
}

// ── the plane discs: a derived, unsaved mesh layer beside the outcrop ──
function discLayerOf(L) { return S.layers.find((d) => d.derivedOf === L.id && d.derivedKind === 'planes') || null; }
function updateDiscs(L, hd) {
  let D = discLayerOf(L);
  const col = setColOf(L);
  const want = prefs.discs && hd.planes && hd.planes.length && col;
  if (!want) { if (D) { H.renderer.removeLayer(D.id); S.layers = S.layers.filter((x) => x !== D); H.renderLayers(); H.requestRender(); } return; }
  if (!D) {
    const id = H.allocLayerId(); if (id == null) return;
    const name = `${L.label || L.name} · planes`;
    D = { id, name, label: name, kind: 'mesh', derivedOf: L.id, derivedKind: 'planes', docs: {}, bboxLocal: null, colorSel: null, clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'volatile', lineage: null, tint: '#ffffff', opacity: 1 };
    S.layers.push(D);
  } else H.renderer.removeLayer(D.id);
  const m = discMesh(hd.planes, (p) => col.colors[p.code] || '#ffffff');
  const chunk = H.buildMeshChunk({ vertices: m.vertices, triangles: m.triangles, frame: H.frame });
  chunk.color = m.color;
  H.renderer.addChunk(chunk, 'base', D.id);
  H.renderer.setLayerMeshStyle(D.id, { tint: [1, 1, 1], opacity: 0.75 });
  D.bboxLocal = chunk.bboxLocal;
  if (!D.visible) H.renderer.setLayerVisible(D.id, false);
  H.renderLayers(); H.requestRender();
}

// ── the refresh every paint edit runs (stroke, undo, redo, restore) ──
export async function structureAfterEdit(L) {
  if (!L || L.kind !== 'mesh' || !setColOf(L)) return;
  const hd = _structWins.get(L.id) || L._structView || (L._structView = {});
  await paintMesh(L, hd);
  const st = structureOf(L);
  if (st) {
    const col = setColOf(L);
    hd.planes = measurePlanes(st, col.codes, col.dict);
    hd.selSet = null;
    updateDiscs(L, hd);
  }
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
      b.onclick = async () => { if (await H.convertMeshLayer(L, false)) start(); };
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
      sw.oninput = () => { col.colors[code] = sw.value; H.markProjectDirty(); structureAfterEdit(L); };
      const nm = document.createElement('input'); nm.type = 'text'; nm.className = 'sw-in'; nm.value = col.dict[code]; nm.style.width = '54px';
      nm.onchange = () => { const v = nm.value.trim(); if (v && !col.dict.some((d, i) => i !== code && d === v)) { col.dict[code] = v; L._colStats = null; H.markProjectDirty(); structureAfterEdit(L); } else nm.value = col.dict[code]; };
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
      const c = H.addPaintValue(L, col, `J${n}`);
      if (c) { col.colors[c] = SET_COLORS[(n - 1) % SET_COLORS.length]; hd.active = c; }
      render();
    };
    rail.append(add);
    // ── rail: tool ──
    rail.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'tool' }));
    const tools = document.createElement('div'); tools.className = 'st-tools';
    for (const [k, label, title] of [['wand', 'wand', 'click a face: takes the whole coplanar face'], ['brush', 'brush', 'drag: paints within the radius of the stroke, staying on the face it started on'], ['erase', 'erase', 'click (wand) or drag (brush) to unpaint']]) {
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
    rail.append(num('angle', 'angle', 'the wand (and the brush) stop where the surface turns more than this from the face you clicked', '1', '°'));
    rail.append(num('offset', 'distance', 'optional: they also stop this far off the clicked plane (a step onto a parallel face)', '0.05', 'm'));
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
        const sc = cell(p.set); sc.style.color = col.colors[p.code] || '';
        cell(att(p.dip_direction, p.dip));
        cell(p.n_vertices.toLocaleString(), 'num'); cell(fmtStat(p.radius), 'num'); cell(p.eig_ratio.toFixed(3), 'num');
        cell(p.kappa != null ? fmtKappa(p.kappa) : '—', 'num');
        const q = cell(p.flags.length ? '⚠ ' + p.flags.join(', ') : '✓');
        q.style.color = p.flags.length ? '#c8a43c' : 'var(--ok)';
        if (p.flags.length) q.title = { rough: `rough: e₂/e₁ > ${QUALITY.rough} — the patch is not very planar`, elongated: `elongated: e₁/e₀ < ${QUALITY.elongated} — strike is well determined, dip much less so`, few: `few: under ${QUALITY.few} vertices` }[p.flags[0]];
        tr.onclick = () => { hd.sel = k; H.zoomToPoint([p.X, p.Y, p.Z], p.radius * 1.5); render(); };
        t.append(tr);
      }
      main.append(t);
    }
    const nSets = new Set(hd.planes.map((p) => p.code)).size;
    win.sub.textContent = `${hd.planes.length} plane${hd.planes.length === 1 ? '' : 's'} · ${nSets} set${nSets === 1 ? '' : 's'}`;
    win.el._structure = { planes: hd.planes.map(({ _verts, ...p }) => p) };
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
    if (code < 1) { code = H.addPaintValue(L, col, name); if (!code) continue; }
    col.colors[code] = toHex(g.color);
    if (H.paintApply(L, col, g.vertices, code)) made++;
  }
  $('#meta').textContent = `sets from paint: ${made} set${made === 1 ? '' : 's'} (${groups.map((g) => `${COLOR_NAMES[g.key] || g.key} ${g.vertices.length.toLocaleString()}`).join(' · ')})`;
  const hd = _structWins.get(L.id); if (hd && hd.render) hd.render();
  return made;
}

// ── the planes as a table layer (replace on name: running it twice == once) ──
const TABLE_COLS = ['plane_id', 'set', 'dip_direction', 'dip', 'X', 'Y', 'Z', 'nx', 'ny', 'nz', 'eig0', 'eig1', 'eig2', 'n_vertices', 'average_resultant_length', 'radius', 'kappa', 'rms', 'eig_ratio', 'quality'];
const rowOf = (p) => ({ ...p, quality: p.flags.length ? p.flags.join(' ') : 'ok' });
function planesTSV(planes) {
  if (!planes || !planes.length) return null;
  return [TABLE_COLS.join('\t'), ...planes.map((p) => { const r = rowOf(p); return TABLE_COLS.map((c) => r[c] ?? '').join('\t'); })].join('\n');
}
export async function planesToTable(L, hd) {
  const planes = (hd || L._structView || {}).planes || [];
  if (!planes.length) { $('#meta').textContent = 'structure: no planes to tabulate yet'; return null; }
  const name = `${(L.label || L.name).replace(/\.[^.]+$/, '')}-planes`;
  for (const old of S.layers.filter((x) => x.kind === 'table' && (x.label || x.name).replace(/\.csv$/i, '') === name)) H.removeLayerUI(old.id);
  const columns = {};
  for (const c of TABLE_COLS) columns[c] = planes.map((p) => { const v = rowOf(p)[c]; return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? (c === 'set' || c === 'quality' ? '' : NaN) : v; });
  const id = await H.addLayer({ kind: 'table', name, columns });
  const T = id != null ? layerById(id) : null;
  if (T) {
    T.lineage = H.mkLineage('structure.planes', { sets: [...new Set(planes.map((p) => p.set))], planes: planes.length, wand: { angle: prefs.angle, offset: prefs.distance || null } }, [L.lineage].filter(Boolean));
    H.markProjectDirty();
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
  const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
  $('#meta').textContent = prefs.tool === 'erase'
    ? `erase (${shape}) — ${shape === 'wand' ? 'click a painted face' : 'drag over paint'} · Esc stops`
    : `${shape} → ${set} — ${shape === 'wand' ? 'click a face' : 'drag to paint'} · alt erases · right-drag orbits · Esc stops`;
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
    if (hd) { showPreview(was.L, hd, null); if (hd.render) hd.render(); }
    $('#meta').textContent = 'structure: brush down';
  }
}
// a canvas point → the region the current tool would take there (welded + file), or null
async function regionUnder(L, x, y, eraseKey) {
  const st = structureOf(L), col = setColOf(L), hd = _structWins.get(L.id);
  if (!st || !col || !hd) return null;
  const hit = await H.meshHitAt(L, x, y);
  if (!hit) return null;
  const erase = prefs.tool === 'erase' || eraseKey;
  const shape = prefs.tool === 'erase' ? (prefs.shape || 'wand') : prefs.tool;
  const codes = weldedCodes(st, col.codes);
  // painting stays out of OTHER sets; erasing walks only paint
  const exclude = new Uint8Array(st.nv);
  for (let j = 0; j < st.nv; j++) exclude[j] = erase ? (codes[j] === 0 ? 1 : 0) : (codes[j] && codes[j] !== hd.active ? 1 : 0);
  const { o, d } = H.pixelRay(x, y), org = H.frame.origin;
  const ray = { origin: [o[0] + org[0], o[1] + org[1], o[2] + org[2]], direction: d };
  const r = regionAt(st, hit, ray, shape, { angle: prefs.angle, distance: prefs.distance, radius: prefs.radius }, exclude);
  // the seed itself may sit in another set (painting) or be unpainted (erasing) — nothing to do there
  if (exclude[r.seed]) return { blocked: true, code: codes[r.seed], st, col, hd };
  return { ...r, erase, shape, st, col, hd, file: toFile(st, r.vertices) };
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
  return H.paintApply(L, col, file, erase ? 0 : hd.active);
}
const inCanvas = (e) => { const r = $('#cv').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
export function installStructurePointer(cv) {
  cv.addEventListener('pointermove', (e) => {
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
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && _armed) { disarm(); } });
  // the outcrop goes → its window, discs and arming go with it
  addEventListener('micro:layer-removed', (e) => {
    const id = e.detail && e.detail.id;
    if (_armed && _armed.L.id === id) disarm();
    const hd = _structWins.get(id); if (hd) hd.win.close ? hd.win.close() : hd.win.el.remove();
    for (const D of S.layers.filter((d) => d.derivedOf === id)) { H.renderer.removeLayer(D.id); S.layers = S.layers.filter((x) => x !== D); }
    H.renderLayers();
  });
}
export const structureArmed = () => _armed;

// ── the stereonet: the planes' poles, linked both ways ──
// Lower-hemisphere equal-area (bearing's Stereonet). One pole per plane in its set's
// colour; per set, the Fisher mean and its α95 cone; optional great circles and a
// density contour of all poles. Click a pole → that plane (the table + the camera);
// drag a lasso → select planes, then move them to another set — so a stereonet can
// split a set the way a geologist reads it, and the paint follows (one undo step).
// Hovering the rock with the wand puts its plane on the net as a ghost pole.
const NET = 300;
const NET_STYLE = {
  background: '#161616',
  primitive: { stroke: '#8a9099', strokeWidth: 1.2, fill: 'none' },
  grid: { stroke: '#262626', strokeWidth: 0.5, majorStroke: '#333', majorStrokeWidth: 0.7 },
  cardinals: { fontSize: 11, fontFamily: 'ui-monospace, monospace', fill: '#8a9099', offset: 12 },
  pole: { r: 3, fill: '#bbb', stroke: 'none' },
  plane: { stroke: '#bbb', strokeWidth: 0.8, fill: 'none' },
  cone: { stroke: '#bbb', strokeWidth: 1, fill: 'none', strokeDasharray: '3,2' },
};
function setGhost(hd, r) {
  const prev = hd.ghost;
  if (!r || !r.vertices || r.vertices.length < 3) hd.ghost = null;
  else { const f = fitRegion(r.st, r.vertices); hd.ghost = f ? { dd: f.dipDirection, dip: f.dip } : null; }
  if (hd.stereo && (prev || hd.ghost)) hd.stereo.render();
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
  const sn = new Stereonet({ size: NET, padding: 18, style: NET_STYLE, classPrefix: 'msn' });
  const el = sn.element(); el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const lasso = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  lasso.setAttribute('fill', 'rgba(200,155,60,0.12)'); lasso.setAttribute('stroke', '#c89b3c'); lasso.setAttribute('stroke-width', '1');
  stage.append(bg, el);
  const selRow = document.createElement('div'); selRow.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;min-height:24px';
  const legend = document.createElement('div'); legend.style.cssText = 'font-size:11px;color:var(--dim);font-family:var(--mono);line-height:1.6';
  wrap.append(opts, stage, selRow, legend);
  win.body.append(wrap);

  // the orientation wheel under the net, when the rock is coloured that way: the
  // same hue/saturation map, so a colour on the rock reads off the net directly
  let bgFor = null;
  function drawWheel() {
    bg.style.display = prefs.orient ? '' : 'none';
    sn.setStyle({ ...NET_STYLE, background: prefs.orient ? 'none' : NET_STYLE.background });   // setStyle REPLACES the instance style
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
    if (prefs.contour && planes.length >= 3) sn.contour(planes.map(poleOf), { stroke: '#5a6470', strokeWidth: 0.7 });
    if (prefs.gc) for (const p of planes) sn.plane(p.dip_direction, p.dip, { stroke: colOfCode(p.code), strokeWidth: 0.7 });
    planes.forEach((p, k) => {
      const sel = (hd.selSet && hd.selSet.has(k)) || k === hd.sel;
      sn.pole(p.dip_direction, p.dip, { fill: colOfCode(p.code), r: 2.5 + Math.min(3, Math.log10(Math.max(1, p.n_vertices)) * 0.8), stroke: sel ? '#ffffff' : 'none', strokeWidth: sel ? 1.5 : 0 });
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
    if (hd.ghost) sn.pole(hd.ghost.dd, hd.ghost.dip, { fill: 'none', stroke: '#ffffff', strokeWidth: 1.5, r: 5, strokeDasharray: '2,2' });
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
      code = H.addPaintValue(L, col, `J${k}`); if (!code) return;
      col.colors[code] = SET_COLORS[(k - 1) % SET_COLORS.length];
    }
    const verts = [];
    for (const k of hd.selSet) { const p = hd.planes[k]; if (p) for (const v2 of p._verts) verts.push(v2); }
    const n = hd.selSet.size;
    hd.selSet = null;
    if (verts.length) H.paintApply(L, col, toFile(st, verts), code);   // → re-measure via paintAfterEdit
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
      else { hd.selSet = new Set([best]); hd.sel = best; const p = planes[best]; H.zoomToPoint([p.X, p.Y, p.Z], p.radius * 1.5); }
    } else {
      const hit = new Set(e.shiftKey && hd.selSet ? hd.selSet : []);
      planes.forEach((p, k) => { const [px, py] = polePx(p); if (inPoly(px, py, poly)) hit.add(k); });
      hd.selSet = hit.size ? hit : null;
    }
    render(); if (hd.render) hd.render();
  });
  hd.stereo = { win, render, sn };
  render();
  return hd.stereo;
}
