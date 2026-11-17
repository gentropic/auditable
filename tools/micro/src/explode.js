// micro — EXPLODED VIEWS: a group's layers pulled apart along an axis so each can
// be seen whole (a geological model's units, two wireframe revisions, a pit and the
// model under it). Display only: every layer keeps its data where it is — picks,
// filters, selections, analysis and exports read true coordinates (condenser's
// per-layer offset is a camera translation; pick and select-through already add it
// back, measure reads the true positions). A layer's offset persists with the
// project (display state, like visibility).
import { S, layerById, requestRender } from './state.js';
import { groupLayerIds } from './tree.js';
import { markProjectDirty } from './project.js';
import { floatWin, raiseWindow } from './windows.js';
const $ = (s) => document.querySelector(s);

/** Move ANY layer for display ([dx,dy,dz] world units; null = home). */
export function setLayerDisplayOffset(L, o, { quiet = false } = {}) {
  if (!L) throw new Error('offset: no such layer');
  const v = o ? [0, 1, 2].map((k) => +o[k] || 0) : [0, 0, 0];
  if (!v.every(Number.isFinite)) throw new Error(`offset: needs [dx, dy, dz] (got ${JSON.stringify(o)})`);
  L.offset = v.some((x) => x !== 0) ? v : null;
  S.renderer.setLayerOffset(L.id, L.offset);
  if (!quiet) { markProjectDirty(); requestRender(); }
  return L.offset ? [...L.offset] : [0, 0, 0];
}

export const anyDisplaced = () => S.layers.some((L) => L.offset && L.offset.some((v) => v !== 0));

const AXES = { z: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };

// the members in TREE order (top of the list first), drawn layers only
function members(nd) {
  return groupLayerIds(nd).map(layerById).filter((L) => L && S.renderer.contentBbox({ layers: [L.id] }));
}

// the extent of the tallest member along the axis — the natural unit for a gap
export function explodeUnit(nd, axis = 'z') {
  const k = { x: 0, y: 1, z: 2 }[axis];
  let m = 0;
  for (const L of members(nd)) {
    const b = S.renderer.contentBbox({ layers: [L.id] });
    if (b) m = Math.max(m, b[k + 3] - b[k]);
  }
  return m || 1;
}

/**
 * Explode a group: member i (counted from the BOTTOM of the list, so the stack on
 * screen reads like the list) moves i × gap along the axis. gap 0 = everything home.
 */
export function explodeGroup(nd, gap, axis = 'z') {
  const dir = AXES[axis] || AXES.z;
  const Ls = members(nd);
  const n = Ls.length;
  Ls.forEach((L, idx) => {
    const i = n - 1 - idx;
    setLayerDisplayOffset(L, gap ? dir.map((d) => d * gap * i) : null, { quiet: true });
  });
  nd._explode = gap ? { gap, axis } : null;
  markProjectDirty(); requestRender();
  return Ls.map((L) => ({ id: L.id, offset: L.offset ? [...L.offset] : [0, 0, 0] }));
}

// after a reopen the offsets are back but the slider's state isn't: read it off the top member
function inferExplode(nd) {
  const Ls = members(nd), n = Ls.length;
  if (n < 2 || !Ls[0].offset) return null;
  const k = [2, 0, 1].find((j) => Ls[0].offset[j]);
  return k == null ? null : { gap: Ls[0].offset[k] / (n - 1), axis: ['x', 'y', 'z'][k] };
}

let _win = null;
export function openExplode(nd) {
  if (_win) { _win.close(); _win = null; }
  const name = nd.name || 'group';
  const win = floatWin({ title: 'explode', sub: name, x: Math.max(12, innerWidth - 340), y: 110, w: 300, h: 210, onClose: () => { _win = null; } });
  _win = win;
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px';
  const cur = nd._explode || inferExplode(nd) || { gap: 0, axis: 'z' };
  const axis = document.createElement('select'); axis.className = 'sw-sel';
  for (const [k, t] of [['z', 'up (z)'], ['x', 'east (x)'], ['y', 'north (y)']]) axis.append(new Option(t, k));
  axis.value = cur.axis;
  const unit = () => explodeUnit(nd, axis.value);
  const sl = document.createElement('input'); sl.type = 'range'; sl.min = '0'; sl.max = '300'; sl.step = '1'; sl.style.flex = '1';
  sl.value = String(Math.round(100 * (cur.gap || 0) / unit()));
  const val = document.createElement('span'); val.style.cssText = 'min-width:70px;text-align:right;color:var(--muted)';
  const row = (label, ...els) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; const s = document.createElement('span'); s.style.cssText = 'color:var(--text);min-width:44px'; s.textContent = label; r.append(s, ...els); win.body.appendChild(r); };
  row('along', axis);
  row('gap', sl, val);
  const apply = () => {
    const gap = (+sl.value / 100) * unit();
    explodeGroup(nd, gap, axis.value);
    val.textContent = gap ? `${gap >= 100 ? Math.round(gap) : +gap.toFixed(1)} m` : 'home';
  };
  sl.oninput = apply; axis.onchange = apply;
  const home = document.createElement('button'); home.className = 'awin-btn'; home.textContent = 'home';
  home.title = 'every member back where its data is';
  home.onclick = () => { sl.value = '0'; apply(); };
  row('', home);
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'display only — picks, measures, filters, analysis and exports read the true coordinates';
  win.body.appendChild(note);
  val.textContent = cur.gap ? `${+(+cur.gap).toFixed(1)} m` : 'home';
  return win;
}
