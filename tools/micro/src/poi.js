// POINTS OF INTEREST — clicked points kept as a labelled table: a name, where it is (WORLD
// coordinates — what a file, a report and the composer say), a note.
//
// They are the project's, not a layer's: they show in the 3D view as labelled markers, list in a
// window (rename, note, go to, remove), export as CSV, become a points layer on request, and go into
// a figure as labels pinned to their points. The project keeps them as points-of-interest.csv at
// its root — a plain X,Y,Z,NAME,NOTE table any tool reads.
//
// Picking reuses the measure click (overlay.js measure mode 'poi'): the same pick, the same surface
// hit, the same TRUE position when a layer is drawn displaced.

import { S, requestRender } from './state.js';
import { worldToLocal } from './coords.js';
import { armPoiPick, projectToCss } from './overlay.js';
import { setPoiSink, addOverlayDrawer } from './overlay-hooks.js';
import { floatWin } from './windows.js';
import { deliverBlob } from './hostio.js';
import { markProjectDirty } from './project.js';
import { resolveFileHandle } from './paths.js';
import { openBlob } from './open.js';
import { mkLineage } from './lineage.js';
import { replaceMade } from './pcgrid.js';
import { registerCommands } from './commands.js';

const $ = (s) => document.querySelector(s);
export const POI_FILE = 'points-of-interest.csv';
const pois = () => (S.pois || (S.pois = []));

export function listPois() { return pois().map((p) => ({ name: p.name, at: p.at.slice(), note: p.note || '' })); }

function nextName() {
  const used = new Set(pois().map((p) => p.name));
  for (let i = 1; ; i++) if (!used.has(`P${i}`)) return `P${i}`;
}

// a point → the list (a unique name: a taken one gets a suffix) → its index
export function addPoi(at, { name = null, note = '' } = {}) {
  if (!Array.isArray(at) || at.length !== 3 || at.some((v) => !Number.isFinite(+v))) throw new Error('point of interest: at must be [x, y, z]');
  let nm = String(name || nextName()).trim() || nextName();
  const used = new Set(pois().map((p) => p.name));
  if (used.has(nm)) { let k = 2; while (used.has(`${nm} (${k})`)) k++; nm = `${nm} (${k})`; }
  pois().push({ name: nm, at: at.map(Number), note: String(note || '') });
  changed();
  return pois().length - 1;
}
export function updatePoi(i, patch) {
  const p = pois()[i]; if (!p) return;
  if (patch.name != null && String(patch.name).trim()) p.name = String(patch.name).trim();
  if (patch.note != null) p.note = String(patch.note);
  if (patch.at) p.at = patch.at.map(Number);
  changed();
}
export function removePoi(i) { pois().splice(i, 1); changed(); }
export function clearPois() { S.pois = []; changed(); }
function changed() { if (S.project) markProjectDirty(); requestRender(); refreshWin(); }

// ── CSV: X,Y,Z,NAME,NOTE (RFC 4180 quoting) ──
const q = (s) => (/[",\n\r]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function poisToCsv(list = pois()) {
  return 'X,Y,Z,NAME,NOTE\n' + list.map((p) => [p.at[0], p.at[1], p.at[2]].map((v) => +(+v).toFixed(4)).concat([q(p.name), q(p.note || '')]).join(',')).join('\n') + (list.length ? '\n' : '');
}
export function poisFromCsv(text) {
  const rows = [], recs = []; let field = '', rec = [], inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inq = false; } else field += c; continue; }
    if (c === '"') inq = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; rec.push(field); recs.push(rec); rec = []; field = ''; }
    else field += c;
  }
  if (field !== '' || rec.length) { rec.push(field); recs.push(rec); }
  if (!recs.length) return rows;
  const head = recs[0].map((h) => h.trim().toUpperCase()), col = (n) => head.indexOf(n);
  const [ix, iy, iz, inm, ino] = ['X', 'Y', 'Z', 'NAME', 'NOTE'].map(col);
  for (const r of recs.slice(1)) {
    const at = [r[ix], r[iy], r[iz]].map(Number);
    if (at.some((v) => !Number.isFinite(v))) continue;
    rows.push({ name: inm >= 0 ? r[inm] : '', at, note: ino >= 0 ? r[ino] || '' : '' });
  }
  return rows;
}

// ── the project: points-of-interest.csv at its root ──
export async function flushPois(dir) {
  try {
    if (!pois().length) { try { await dir.removeEntry(POI_FILE); } catch { /* none */ } return; }
    const fh = await resolveFileHandle(dir, POI_FILE, { create: true }); const w = await fh.createWritable();
    await w.write(poisToCsv()); await w.close();
  } catch { /* best effort, like bookmarks */ }
}
export async function loadPois(dir) {
  S.pois = [];
  try { const fh = await dir.getFileHandle(POI_FILE); S.pois = poisFromCsv(await (await fh.getFile()).text()); } catch { /* none */ }
  refreshWin(); requestRender();
}

// ── picking: the measure click in 'poi' mode, armed until Esc ──
export function armPoi() {
  armPoiPick();
  $('#meta').textContent = 'points of interest: click to add a point (each is named P1, P2 … — rename in the list) · Esc to stop';
  openPoiWindow();
}
setPoiSink((world) => {
  const i = addPoi(world);
  $('#meta').textContent = `point of interest ${pois()[i].name}: ${world.map((v) => v.toFixed(2)).join(', ')} — click another, Esc to stop`;
});

// ── the 3D view: a marker and its name at every point (rides the camera with the measure overlay) ──
addOverlayDrawer(() => {
  const host = $('#view'); if (!host) return;
  let svg = $('#poiSvg');
  if (!pois().length) { if (svg) svg.style.display = 'none'; return; }
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'poiSvg';
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
    host.appendChild(svg);
  }
  svg.style.display = '';
  const NS = 'http://www.w3.org/2000/svg';
  svg.textContent = '';
  for (const p of pois()) {
    const c = projectToCss(worldToLocal(p.at)); if (!c) continue;
    const g = document.createElementNS(NS, 'g');
    const m = document.createElementNS(NS, 'path');
    m.setAttribute('d', `M${c[0]},${c[1]} l-5,-9 a5.5,5.5 0 1 1 10,0 z`);
    m.setAttribute('fill', '#ffd94d'); m.setAttribute('stroke', '#121212'); m.setAttribute('stroke-width', '1.2');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', c[0] + 8); t.setAttribute('y', c[1] - 10); t.setAttribute('fill', '#fff'); t.setAttribute('font-size', '12'); t.setAttribute('font-family', 'monospace');
    t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', '#121212'); t.setAttribute('stroke-width', '3.5');
    t.textContent = p.name;
    g.append(m, t); svg.appendChild(g);
  }
});

// ── a points layer (a plain X,Y,Z,NAME,NOTE CSV — NAME is its category) ──
export async function poisToLayer({ name = 'points_of_interest' } = {}) {
  if (!pois().length) throw new Error('points of interest: there are none yet');
  const fname = `${String(name).replace(/[^\w.-]+/g, '_')}.csv`;
  replaceMade(fname);
  const lin = mkLineage('points of interest', { count: pois().length }, []);
  const id = await openBlob(new File([poisToCsv()], fname, { type: 'text/csv' }), fname, 'add', null, { asKind: 'points', lineage: lin });
  const L = id != null ? S.layers.find((x) => x.id === id) : null;
  if (L) L.memoryOnly = true;                              // made from the list, which the project keeps
  return id;
}

// ── the composer: one label per point, in the given view frame ──
export function poiLabelFrames(view) {
  const b = view.box, n = pois().length;
  return pois().map((p, i) => ({ kind: 'label', box: [b[0] + b[2] * 0.62, b[1] + b[3] * (0.08 + 0.8 * i / Math.max(1, n)), 30, 7], content: { text: p.name, at: p.at.map((v) => +(+v).toFixed(3)), of: view.id } }));
}

// ── the window ──
let _win = null;
function refreshWin() { if (_win && _win.isConnected) _win._fill(); }
export function openPoiWindow() {
  if (_win && _win.isConnected) { _win._fill(); return _win; }
  const w = floatWin({ title: 'points of interest', sub: '', x: 120, y: 120, w: 560, h: 300, onClose: () => { _win = null; } });
  _win = w.el || w;
  _win.dataset.poi = '1';
  const body = w.body || _win.querySelector('.fwin-body');
  const list = document.createElement('div'); list.className = 'poi-list'; list.style.cssText = 'overflow:auto;flex:1;font:12px var(--mono, monospace)';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding-top:6px';
  const btn = (label, title, fn) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.onclick = fn; bar.appendChild(b); return b; };
  btn('+ pick', 'click points in the 3D view (Esc stops)', () => armPoi());
  btn('export CSV', 'X,Y,Z,NAME,NOTE in world coordinates', () => deliverBlob(new Blob([poisToCsv()], { type: 'text/csv' }), POI_FILE));
  btn('as a points layer', 'a points layer of them (NAME as the category)', () => poisToLayer().catch((e) => { $('#meta').textContent = e.message; }));
  btn('clear', 'remove every point of interest', () => clearPois());
  body.style.display = 'flex'; body.style.flexDirection = 'column';
  body.append(list, bar);
  _win._fill = () => {
    list.textContent = '';
    const sub = _win.querySelector('.fwin-head .sub'); if (sub) sub.textContent = `${pois().length} point${pois().length === 1 ? '' : 's'}`;
    if (!pois().length) { list.textContent = 'none yet — + pick, then click in the 3D view'; return; }
    const tbl = document.createElement('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse';
    const hr = document.createElement('tr'); hr.style.cssText = 'text-align:left;color:var(--dim)';
    for (const h of ['name', 'X', 'Y', 'Z', 'note', '']) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); }
    tbl.appendChild(hr);
    pois().forEach((p, i) => {
      const tr = document.createElement('tr'); tr.dataset.i = i;
      const inp = (v, key, wpx) => { const td = document.createElement('td'); const x = document.createElement('input'); x.value = v; x.style.width = wpx; x.dataset.key = key; x.onchange = () => updatePoi(i, { [key]: x.value }); td.appendChild(x); return td; };
      const num = (v) => { const td = document.createElement('td'); td.textContent = v.toFixed(2); td.style.paddingRight = '8px'; return td; };
      const act = document.createElement('td');
      const go = document.createElement('button'); go.textContent = '◎'; go.title = 'centre the view on it'; go.onclick = () => { S.cam.state.target = worldToLocal(p.at); S.cam.update && S.cam.update(); requestRender(); };
      const rm = document.createElement('button'); rm.textContent = '×'; rm.title = 'remove'; rm.onclick = () => removePoi(i);
      act.append(go, rm);
      tr.append(inp(p.name, 'name', '7em'), num(p.at[0]), num(p.at[1]), num(p.at[2]), inp(p.note || '', 'note', '12em'), act);
      tbl.appendChild(tr);
    });
    list.appendChild(tbl);
  };
  _win._fill();
  return _win;
}

registerCommands([
  { id: 'poi', group: 'Analyse', title: 'Points of interest…', kw: 'poi point interest marker label pin waypoint callout table export', run: () => armPoi() },
  { id: 'poilist', group: 'Analyse', title: 'Points of interest: the list', kw: 'poi points interest table list export csv', when: () => pois().length > 0, run: () => openPoiWindow() },
]);
