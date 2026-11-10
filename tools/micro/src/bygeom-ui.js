// micro — the by-geometry dialogs: assign domains (one categorical column by the winning solid)
// and select / flag / ratio by a solid, a surface or a grid — the forms, their progress lines,
// the run and cancel handlers, and the recipe side (state from params, run, open configured).
// The evaluation itself is src/bygeom.js; the app wires the buttons.
import { S, layerById } from './state.js';
import { _windingGpu, assignDomains, flagBySolid, ratioBySolid, sbCancelActive, selectBySolid, setWindingGpu, solidOrientedMesh } from './bygeom.js';
import { ppNote } from './props.js';
import { hasRecords, layerTableHeader } from './records.js';
import { saveRecipe } from './recipes.js';
import { layerShown } from './layers.js';
const $ = (s) => document.querySelector(s);

// ── the assign-domains dialog ──
export let _adDlg = null;

export function openDomainsDialog() {
  const solids = S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
  if (!solids.length) { $('#meta').textContent = 'assign domains: open the domain solids first (context-tier meshes)'; return; }
  const grids = S.layers.filter((L) => { const doc = L.docs.blockDoc; return doc && (doc.grid || (doc.header && doc.header.grid)); });
  if (!grids.length) { $('#meta').textContent = 'assign domains: needs a regular block model layer'; return; }
  _adDlg = {
    picks: new Set(solids.map((L) => L.id)),
    lid: grids[0].id, name: 'DOMAIN', res: [2, 2, 2],
  };
  renderDomainsDialog();
  $('#adDlg').classList.add('show');
  // topology reads label each row honestly (open sheets claim nothing)
  for (const L of solids) if (!L._solidMesh) solidOrientedMesh(L).then(() => { if (_adDlg) renderDomainsDialog(); });
}

export function renderDomainsDialog() {
  const d = _adDlg; if (!d) return;
  const body = $('#adDlgBody');
  body.textContent = '';
  const mkRow2 = (label, ...els) => {
    const row = document.createElement('div'); row.className = 'ex-row';
    const b2 = document.createElement('b'); b2.textContent = label;
    row.append(b2, ...els);
    body.appendChild(row);
    return row;
  };
  const solids = S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
  const sRow = mkRow2('solids');
  sRow.style.alignItems = 'flex-start';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  for (const L of solids) {
    const lab = document.createElement('label');
    const cb2 = document.createElement('input'); cb2.type = 'checkbox'; cb2.checked = d.picks.has(L.id);
    cb2.onchange = () => { if (cb2.checked) d.picks.add(L.id); else d.picks.delete(L.id); };
    const open = L._solidMesh && !L._solidMesh.closed;
    lab.append(cb2, ` ${L.label || L.name}${open ? ' — open surface, claims nothing' : ''}`);
    if (open) lab.className = 'dis';
    list.appendChild(lab);
  }
  sRow.appendChild(list);
  const grids = S.layers.filter((L) => { const doc = L.docs.blockDoc; return doc && (doc.grid || (doc.header && doc.header.grid)); });
  const gSel = document.createElement('select');
  for (const L of grids) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; gSel.appendChild(o); }
  gSel.value = String(d.lid);
  gSel.onchange = () => { d.lid = +gSel.value; };
  mkRow2('model', gSel);
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = d.name;
  nameIn.onchange = () => { d.name = nameIn.value.trim() || 'DOMAIN'; };
  mkRow2('column', nameIn);
  const ins = ['x', 'y', 'z'].map((ax, k) => {
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '1'; inp.value = String(d.res[k]);
    inp.style.width = '44px';
    inp.oninput = () => { d.res[k] = Math.max(1, +inp.value || 1); };
    return inp;
  });
  const x2 = () => { const sp = document.createElement('span'); sp.style.color = 'var(--muted)'; sp.textContent = '×'; return sp; };
  mkRow2('probes', ins[0], x2(), ins[1], x2(), ins[2]);
  body.appendChild(ppNote('each block goes to the solid holding its LARGEST fraction — edge blocks land with their dominant domain; unclaimed stay unpainted (brush-editable after)'));
  $('#adDlgMsg').textContent = '';
}

export function adProgress(frac, label) {
  $('#adDlgMsg').textContent = label ? `${label} — ${Math.round(frac * 100)}%` : '';
  const bar = $('#adProg');
  bar.style.display = frac > 0 && frac < 1 ? '' : 'none';
  $('#adProgFill').style.width = `${Math.round(frac * 100)}%`;
}

export function adCancel() { sbCancelActive(); $('#adDlg').classList.remove('show'); _adDlg = null; }

export async function adGo() {
  const d = _adDlg; if (!d) return;
  const solids = S.layers.filter((L) => d.picks.has(L.id));
  const L = layerById(d.lid);
  if (!solids.length || !L) { $('#adDlgMsg').textContent = 'pick at least one solid'; return; }
  const btn = $('#adGo');
  btn.disabled = true;
  for (const el of $('#adDlgBody').querySelectorAll('input, select')) el.disabled = true;
  adProgress(0.001, 'starting');
  try {
    const col = await assignDomains(solids, L, { name: d.name, res: d.res, onProgress: adProgress });
    if (!col) { adProgress(0, ''); $('#adDlgMsg').textContent = $('#meta').textContent; return; }
    $('#adDlg').classList.remove('show'); _adDlg = null;
  } finally {
    btn.disabled = false;
    for (const el of $('#adDlgBody').querySelectorAll('input, select')) el.disabled = false;
    adProgress(0, '');
  }
}

// ── the select-by-solid dialog ──
export let _sbDlg = null;

export function openSolidDialog(meshL0) {
  const solids = S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
  const gridsG = S.layers.filter((L) => L.docs.gridDoc);
  const geoms = [...solids, ...gridsG];
  if (!geoms.length) { $('#meta').textContent = 'select by solid / surface: open a context-tier mesh (.msh / .obj / small .ply) or a grid (.tif / .grd / .asc) first'; return; }
  const elements = S.layers.filter((L) => hasRecords(L) && !L.docs.gridDoc);
  if (!elements.length) { $('#meta').textContent = 'select by solid / surface: no element layers to classify'; return; }
  _sbDlg = {
    solid: (meshL0 && geoms.includes(meshL0) ? meshL0 : geoms[0]).id,
    act: 'select', side: null, combine: 'replace', method: 'winding',
    res: [3, 3, 3], name: null, flagName: null, flagLabel: 'IN',
    targets: new Set(elements.filter((L) => layerShown(L.id)).map((L) => L.id)),
    ratioLid: null, surfB: null,
  };
  renderSolidDialog();
  $('#sbDlg').classList.add('show');
  sbEnsureTopology();
}

// topology drives the dialog's grammar (inside/outside vs below/above/between);
// it needs the mesh parsed — kick the read, re-render when it lands
export async function sbEnsureTopology() {
  const d = _sbDlg; if (!d) return;
  const meshL = layerById(d.solid);
  if (!meshL || meshL.docs.gridDoc || meshL._solidMesh) return;
  await solidOrientedMesh(meshL);
  if (_sbDlg === d) renderSolidDialog();
}

export function sbDefaultName(d) {
  const meshL = layerById(d.solid);
  const pre = { below: 'BELOW_', above: 'ABOVE_', between: 'BTW_' }[d.side] || 'IN_';
  return (pre + (meshL ? (meshL.label || meshL.name) : 'SOLID')).replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_').toUpperCase().slice(0, 24);
}

export function renderSolidDialog() {
  const d = _sbDlg; if (!d) return;
  const body = $('#sbDlgBody');
  body.textContent = '';
  const mkRow2 = (label, ...els) => {
    const row = document.createElement('div'); row.className = 'ex-row';
    const b2 = document.createElement('b'); b2.textContent = label;
    row.append(b2, ...els);
    body.appendChild(row);
    return row;
  };
  const mkRadios = (row, group, pairs, cur, onpick) => {
    for (const [key, label] of pairs) {
      const lab = document.createElement('label');
      const r2 = document.createElement('input'); r2.type = 'radio'; r2.name = group;
      r2.checked = cur === key;
      r2.onchange = () => onpick(key);
      lab.append(r2, label);
      row.appendChild(lab);
    }
  };
  const solids = S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
  const gridsG = S.layers.filter((L) => L.docs.gridDoc);
  const geoms = [...solids, ...gridsG];
  const sSel = document.createElement('select');
  for (const L of geoms) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = (L.docs.gridDoc ? '▦ ' : '') + (L.label || L.name); sSel.appendChild(o); }
  sSel.value = String(d.solid);
  sSel.onchange = () => { d.solid = +sSel.value; d.name = null; d.flagName = null; d.side = null; renderSolidDialog(); sbEnsureTopology(); };
  mkRow2('geometry', sSel);
  const meshSel = layerById(d.solid);
  const geomIsGrid = meshSel && !!meshSel.docs.gridDoc;
  const topo = meshSel && meshSel._solidMesh;
  const tNote = document.createElement('div'); tNote.className = 'pp-note';
  tNote.textContent = geomIsGrid ? `gridded surface (${meshSel.docs.gridDoc.grid.nx.toLocaleString()}×${meshSel.docs.gridDoc.grid.ny.toLocaleString()} heightfield) — above / below / between; a bilinear sample, no winding`
    : !topo ? 'reading mesh topology…'
    : topo.forced ? `forced closed volume (${topo.boundaryEdges.toLocaleString()} boundary edges bridged by winding) — inside / outside apply`
    : topo.closed ? 'closed solid — inside / outside apply'
    : `open surface (${topo.boundaryEdges.toLocaleString()} boundary edges) — above / below / between apply, via winding closures`;
  body.appendChild(tNote);
  // force-closed override: treat an almost-watertight shell as a closed volume so
  // inside / outside applies (winding tolerates the open rim). Offered only when the
  // mesh actually has boundary edges; toggling clears the cached solid / BVH / winding.
  if (!geomIsGrid && topo && topo.boundaryEdges > 0) {
    const fcRow = mkRow2('volume');
    const lab = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!meshSel._forceClosed;
    cb.onchange = () => {
      meshSel._forceClosed = cb.checked;
      meshSel._solidMesh = null; meshSel._solidBVH = null; meshSel._variants = null;
      if (meshSel._windingEngine && meshSel._windingEngine.terminate) meshSel._windingEngine.terminate();
      if (meshSel._peelEngine && meshSel._peelEngine.terminate) meshSel._peelEngine.terminate();
      meshSel._windingEngine = null; meshSel._windingMeshes = null; meshSel._peelEngine = null; meshSel._peelMeshes = null;
      d.side = null;                                          // grammar flips inside/outside ↔ above/below
      renderSolidDialog(); sbEnsureTopology();
    };
    lab.append(cb, ' treat as closed volume');
    fcRow.appendChild(lab);
  }
  // compute backend — GPU (default, fast) or the worker CPU path (slower, but can't
  // trip the GPU driver watchdog: the safety valve when a device hangs on a huge solid).
  mkRadios(mkRow2('compute'), 'sbcompute', [['gpu', 'GPU'], ['cpu', 'CPU']], _windingGpu ? 'gpu' : 'cpu', (k) => setWindingGpu(k === 'gpu'));
  // engine: winding (robust, any mesh) or peel (depth-peel — much faster for a CLEAN
  // closed solid on a regular grid: the oxide-from-Leapfrog case). Closed solids only.
  if (topo && !geomIsGrid) {
    mkRadios(mkRow2('engine'), 'sbengine', [['winding', 'winding'], ['peel', 'peel · fast']], d.method === 'peel' ? 'peel' : 'winding', (k) => { d.method = k; renderSolidDialog(); });
    body.appendChild(ppNote(d.method === 'peel'
      ? 'peel casts one ray per column (exact along Z) — fast for clean meshes, closed OR open surface. If it reports overflow or looks wrong on a messy mesh, use winding.'
      : 'winding sums a robust scalar field — tolerant of holes / flipped normals, any mesh. Try peel for a big clean solid or surface.'));
  }
  const isSurf = geomIsGrid || (topo && !topo.closed);
  const sides = isSurf ? [['below', 'below'], ['above', 'above'], ['between', 'between']] : [['inside', 'inside'], ['outside', 'outside']];
  if (!d.side || !sides.some(([k]) => k === d.side)) d.side = sides[0][0];
  mkRadios(mkRow2('do'), 'sbact',
    [['select', 'select'], ['flag', 'flag column'], ['ratio', 'fraction column']],
    d.act, (k) => { d.act = k; renderSolidDialog(); });
  if (d.act !== 'ratio' || isSurf) {
    mkRadios(mkRow2('which'), 'sbside', sides, d.side, (k) => { d.side = k; renderSolidDialog(); });
  }
  if (isSurf && d.side === 'between') {
    const others = geomIsGrid
      ? S.layers.filter((L) => L.docs.gridDoc && L.id !== d.solid)
      : S.layers.filter((L) => L.kind === 'mesh' && L.id !== d.solid && L.docs.meshDoc && !L.docs.meshDoc.header.soup && L._solidMesh && !L._solidMesh.closed);
    if (!others.length) {
      body.appendChild(ppNote(geomIsGrid ? 'between needs a SECOND grid surface layer' : 'between needs a SECOND open surface layer (open one, or wait for topology reads)'));
      if (!geomIsGrid) S.layers.filter((L) => L.kind === 'mesh' && L.id !== d.solid && L.docs.meshDoc && !L.docs.meshDoc.header.soup && !L._solidMesh)
        .forEach((L) => solidOrientedMesh(L).then(() => { if (_sbDlg === d) renderSolidDialog(); }));
      $('#sbGo').disabled = true;
    } else {
      $('#sbGo').disabled = false;
      if (d.surfB == null || !others.some((L) => L.id === d.surfB)) d.surfB = others[0].id;
      const bSel = document.createElement('select');
      for (const L of others) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = (L.docs.gridDoc ? '▦ ' : '') + (L.label || L.name); bSel.appendChild(o); }
      bSel.value = String(d.surfB);
      bSel.onchange = () => { d.surfB = +bSel.value; };
      mkRow2('lower', bSel);
      body.appendChild(ppNote('between = below the first surface AND above this one'));
    }
  }
  if (d.act === 'ratio') {
    const grids = S.layers.filter((L) => { const doc = L.docs.blockDoc; return doc && (doc.grid || (doc.header && doc.header.grid)); });
    if (!grids.length) { body.appendChild(ppNote('fraction-inside needs a regular block model layer')); $('#sbGo').disabled = true; return; }
    $('#sbGo').disabled = false;
    if (d.ratioLid == null || !grids.some((L) => L.id === d.ratioLid)) d.ratioLid = grids[0].id;
    const gSel = document.createElement('select');
    for (const L of grids) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; gSel.appendChild(o); }
    gSel.value = String(d.ratioLid);
    gSel.onchange = () => { d.ratioLid = +gSel.value; renderSolidDialog(); };
    mkRow2('model', gSel);
    const nameIn = document.createElement('input'); nameIn.type = 'text';
    nameIn.value = d.name != null ? d.name : sbDefaultName(d);
    nameIn.onchange = () => { d.name = nameIn.value; };
    mkRow2('column', nameIn);
    // probes per AXIS — benches are anisotropic (10×10×5 wants 3×3×2)
    const tally = document.createElement('span');
    tally.style.color = 'var(--muted)';
    const tallyText = () => {
      const n2 = d.res[0] * d.res[1] * d.res[2];
      const Lg = layerById(d.ratioLid);
      const doc2 = Lg && Lg.docs.blockDoc;
      const gsz = doc2 && (doc2.grid || (doc2.header && doc2.header.grid));
      const dims = gsz && gsz.size ? ` · ${gsz.size.map((v, k) => +(v / d.res[k]).toFixed(2)).join('×')} m blocklings` : '';
      return `= ${n2.toLocaleString()} probes/block${dims}`;
    };
    const ins = ['x', 'y', 'z'].map((ax, k) => {
      const inp = document.createElement('input'); inp.type = 'number';
      inp.min = '1'; inp.value = String(d.res[k]);
      inp.style.width = '44px';
      inp.title = `probes along ${ax}`;
      inp.oninput = () => {
        d.res[k] = Math.max(1, +inp.value || 1);
        tally.textContent = tallyText();
      };
      return inp;
    });
    tally.textContent = tallyText();
    const x2 = () => { const sp = document.createElement('span'); sp.style.color = 'var(--muted)'; sp.textContent = '×'; return sp; };
    mkRow2('probes', ins[0], x2(), ins[1], x2(), ins[2], tally);
  } else {
    $('#sbGo').disabled = false;
    if (d.act === 'select') {
      mkRadios(mkRow2('combine'), 'sbcomb', [['replace', 'replace'], ['add', 'add'], ['subtract', 'subtract']], d.combine, (k) => { d.combine = k; });
    }
    const tRow = mkRow2('layers');
    for (const L of S.layers.filter((x) => hasRecords(x) && !x.docs.gridDoc)) {
      const flaggable = d.act !== 'flag' || !!layerTableHeader(L);
      const lab = document.createElement('label');
      if (!flaggable) { lab.className = 'dis'; lab.title = 'flag columns need a table-backed layer'; }
      const cb2 = document.createElement('input'); cb2.type = 'checkbox';
      cb2.checked = flaggable && d.targets.has(L.id);
      cb2.disabled = !flaggable;
      cb2.onchange = () => { if (cb2.checked) d.targets.add(L.id); else d.targets.delete(L.id); };
      lab.append(cb2, L.label || L.name);
      tRow.appendChild(lab);
    }
    if (d.act === 'flag') {
      const nameIn = document.createElement('input'); nameIn.type = 'text';
      nameIn.value = d.flagName != null ? d.flagName : sbDefaultName(d);
      nameIn.onchange = () => { d.flagName = nameIn.value; };
      mkRow2('column', nameIn);
      const labIn = document.createElement('input'); labIn.type = 'text';
      labIn.value = d.flagLabel;
      labIn.style.maxWidth = '90px';
      labIn.onchange = () => { d.flagLabel = labIn.value.trim() || 'IN'; };
      mkRow2('value', labIn);
    }
  }
  $('#sbDlgMsg').textContent = '';
}

export function sbProgress(frac, label) {
  $('#sbDlgMsg').textContent = label ? `${label} — ${Math.round(frac * 100)}%` : '';
  const bar = $('#sbProg');
  bar.style.display = frac > 0 && frac < 1 ? '' : 'none';
  $('#sbProgFill').style.width = `${Math.round(frac * 100)}%`;
}

export let _sbRunning = false;

export function sbCancel() {
  if (_sbRunning) sbCancelActive();                        // aborts the worker + bumps the epochs
  $('#sbDlg').classList.remove('show'); _sbDlg = null; _sbRunning = false;
}

// ── the by-geometry evaluation core — shared by the dialog's Run and the
// solid RECIPE path (same semantics, different progress surface) ──
export async function sbExecute(d, onProgress) {
  const meshL = layerById(d.solid); if (!meshL) return { ok: false, msg: 'geometry layer is gone' };
  const meshB = d.side === 'between' ? layerById(d.surfB) : null;
  const topo2 = meshL._solidMesh;
  const rMode = (meshL.docs.gridDoc) || (topo2 && !topo2.closed) ? d.side : 'inside';
  const method = (topo2 && !meshL.docs.gridDoc) ? (d.method || 'winding') : 'winding';   // peel handles closed solids AND open surfaces; grids stay winding
  if (d.act === 'ratio') {
    const L = layerById(d.ratioLid); if (!L) return { ok: false, msg: 'the target model layer is gone' };
    const defName = sbDefaultName(d);
    const col = await ratioBySolid(meshL, L, { name: (d.name || defName).trim() || defName, res: d.res, mode: rMode, meshB, method, onProgress });
    if (!col) return { ok: false, msg: $('#meta').textContent };
  } else if (d.act === 'flag') {
    const defName = sbDefaultName(d);
    const made = await flagBySolid(meshL, S.layers.filter((L) => d.targets.has(L.id)), {
      name: (d.flagName || defName).trim() || defName, label: d.flagLabel || 'IN', mode: d.side, meshB, method, onProgress,
    });
    if (!made) return { ok: false, msg: $('#meta').textContent || 'no layer took the column' };
  } else {
    await selectBySolid(meshL, { mode: d.side, meshB, targets: S.layers.filter((L) => d.targets.has(L.id)), combine: d.combine, method, onProgress });
  }
  return { ok: true };
}

// dialog state → op-shaped recipe params (layers by NAME, like every recipe)
export function sbCfgOf(d) {
  const nm = (id) => { const L = layerById(id); return L ? L.name : null; };
  const meshL = layerById(d.solid);
  const p = { geometry: nm(d.solid), do: d.act, which: d.side };
  if (meshL && meshL._forceClosed && !meshL.docs.gridDoc) p.forceClosed = true;
  if (d.side === 'between') p.lower = nm(d.surfB);
  if (d.method === 'peel' && meshL && !meshL.docs.gridDoc) p.engine = 'peel';
  if (d.act === 'ratio') {
    p.model = nm(d.ratioLid);
    p.column = (d.name || sbDefaultName(d)).trim() || sbDefaultName(d);
    p.probes = d.res.slice();
  } else {
    p.targets = S.layers.filter((L) => d.targets.has(L.id)).map((L) => L.name);
    if (d.act === 'flag') { p.column = (d.flagName || sbDefaultName(d)).trim() || sbDefaultName(d); p.value = d.flagLabel || 'IN'; }
    if (d.act === 'select') p.combine = d.combine;
  }
  return p;
}

// recipe params → dialog state. Throws with a named-layer message when a
// referenced layer isn't loaded (routines surface it before anything runs).
export const sbFindLayer = (name) => S.layers.find((x) => x.name === name || x.label === name);

export async function sbStateFromParams(p) {
  const geomL = sbFindLayer(String(p.geometry || ''));
  if (!geomL) throw new Error(`solid recipe: geometry layer “${p.geometry || '?'}” is not loaded`);
  if (p.forceClosed != null && !geomL.docs.gridDoc && !!geomL._forceClosed !== !!p.forceClosed) {
    geomL._forceClosed = !!p.forceClosed;                  // same cache-clear the dialog's toggle does
    geomL._solidMesh = null; geomL._solidBVH = null; geomL._variants = null;
    if (geomL._windingEngine && geomL._windingEngine.terminate) geomL._windingEngine.terminate();
    if (geomL._peelEngine && geomL._peelEngine.terminate) geomL._peelEngine.terminate();
    geomL._windingEngine = null; geomL._windingMeshes = null; geomL._peelEngine = null; geomL._peelMeshes = null;
  }
  if (!geomL.docs.gridDoc) await solidOrientedMesh(geomL);
  const act = ['select', 'flag', 'ratio'].includes(p.do) ? p.do : 'flag';
  const d = {
    solid: geomL.id, act, side: p.which || null, combine: p.combine || 'replace',
    method: p.engine === 'peel' ? 'peel' : 'winding',
    res: Array.isArray(p.probes) && p.probes.length === 3 ? p.probes.map((v) => Math.max(1, +v || 1)) : [3, 3, 3],
    name: p.column || null, flagName: p.column || null, flagLabel: p.value || 'IN',
    targets: new Set(), ratioLid: null, surfB: null,
  };
  const topo = geomL._solidMesh;
  const isSurf = !!geomL.docs.gridDoc || (topo && !topo.closed);
  const sides = isSurf ? ['below', 'above', 'between'] : ['inside', 'outside'];
  if (!d.side || !sides.includes(d.side)) d.side = sides[0];
  if (d.side === 'between') {
    const low = sbFindLayer(String(p.lower || ''));
    if (!low) throw new Error(`solid recipe: “between” needs the lower surface “${p.lower || '?'}” loaded`);
    d.surfB = low.id;
  }
  if (act === 'ratio') {
    const M = sbFindLayer(String(p.model || ''));
    const doc = M && M.docs.blockDoc;
    if (!doc || !(doc.grid || (doc.header && doc.header.grid))) throw new Error(`solid recipe: fraction needs the regular block model “${p.model || '?'}” loaded`);
    d.ratioLid = M.id;
  } else {
    const wanted = Array.isArray(p.targets) && p.targets.length ? p.targets.map(String) : null;
    const elements = S.layers.filter((L) => hasRecords(L) && !L.docs.gridDoc);
    for (const L of elements) if (wanted ? wanted.some((n2) => L.name === n2 || L.label === n2) : layerShown(L.id)) d.targets.add(L.id);
    if (wanted) {
      const missing = wanted.filter((n2) => !elements.some((L) => L.name === n2 || L.label === n2));
      if (missing.length) throw new Error(`solid recipe: target layer${missing.length > 1 ? 's' : ''} not loaded — ${missing.join(', ')}`);
    }
    if (!d.targets.size) throw new Error('solid recipe: no target layers loaded');
  }
  return d;
}

export async function runSolidRecipe(params) {                    // headless: resolve, evaluate, report
  const d = await sbStateFromParams(params);
  const prog = (frac, label) => { if (label && frac > 0 && frac < 1) $('#meta').textContent = `by solid — ${label} ${Math.round(frac * 100)}%`; };
  const r = await sbExecute(d, prog);
  if (!r.ok) throw new Error(r.msg || 'by-solid evaluation failed');
  $('#meta').textContent = `by solid: done${params.column ? ` — ${params.column}` : ''}`;
  return r;
}

export async function openSolidRecipeConfigured(params) {         // preview: the dialog, configured, not run
  try {
    _sbDlg = await sbStateFromParams(params);
    renderSolidDialog();
    $('#sbDlg').classList.add('show');
  } catch (e) { $('#meta').textContent = `by-solid recipe: ${e.message}`; }
}

export function sbRcp() {
  const d = _sbDlg; if (!d) return;
  const meshL = layerById(d.solid);
  const base = (meshL ? (meshL.label || meshL.name) : 'solid').replace(/\.[^.]+$/, '');
  saveRecipe('solid', sbCfgOf(d), `${base} ${d.act === 'ratio' ? 'fraction' : d.act} by solid`);
}

export async function sbGo() {
  const d = _sbDlg; if (!d) return;
  const btn = $('#sbGo');
  btn.disabled = true;
  _sbRunning = true;
  for (const el of $('#sbDlgBody').querySelectorAll('input, select')) el.disabled = true;
  sbProgress(0.001, 'starting');
  try {
    const r = await sbExecute(d, sbProgress);
    if (!r.ok) { sbProgress(0, ''); $('#sbDlgMsg').textContent = r.msg || ''; return; }
    if (_sbDlg) { $('#sbDlg').classList.remove('show'); _sbDlg = null; }
  } finally {
    _sbRunning = false;
    btn.disabled = false;
    for (const el of $('#sbDlgBody').querySelectorAll('input, select')) el.disabled = false;
    sbProgress(0, '');
  }
}
