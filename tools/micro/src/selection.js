// micro — the 3D SELECTION (spec §15 v1): rectangle + lasso, visible-mode — one ID-buffer
// pass over the gesture's bbox, polygon-masked, decoded into per-layer masks
// (the filter-mask pattern; a warm tint in the scene, a 'selected' view in the
// attribute tables). Shift adds, Alt subtracts, Esc clears. Also the
// select-THROUGH sweep (everything in the gesture's tube), the selection bar a
// phone uses in place of shift/alt, and selection undo.
import { S, activeLayer, layerById, requestRender } from './state.js';
import { pushUndo, withUndoGroup } from './undo.js';
import { _attrTables, attrTableSelChanged } from './attrtable.js';
import { refreshLinkedWindows } from './analysis-ui.js';
import { markProjectDirty } from './project.js';
import { attrRowCountOf, docPositionStream } from './records.js';
import { microPrompt } from './prompts.js';
import { mkLineage } from './lineage.js';
import { paintRecount } from './columns.js';
import { ruleModeOf } from './rules.js';
import { colorSelOf } from './ramp.js';
import { viewCatData } from './viewcat.js';
import { textCalcSel, calcCatCol, classHidden, layerClassInfo } from './categories.js';
import { _isMobile } from './windows.js';
import { isMiss, layerOfId, layerSection, supportOfHeader } from '../../../ext/condenser/src/main.js';
import { layerShown } from './layers.js';
import { PAINT, addPaintValue, createPaintCol, paintArmLabel, paintByPolygon, paintVolume, addPaintColorOptions, paintActiveCol } from './paint.js';
import { currentSection } from './section.js';
import { sceneOrigin } from './coords.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setSelectionHooks): _viewMode
let H = {};
export function setSelectionHooks(h) { H = h; }

export function pipTest(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((poly[j][0] - poly[i][0]) * (y - yi)) / (yj - yi) + poly[i][0]) inside = !inside;
  }
  return inside;
}

// SELECTION UNDO: each layer keeps a copy of its last APPLIED mask (L._selShadow,
// one byte a record — skipped past SEL_UNDO_MAX records), which is the "before"
// of the next change; the step restores it. Rapid updates of one layer's
// selection (a progressive scan) coalesce into one step.
const SEL_UNDO_MAX = 16_000_000;

function recordSelectionUndo(L, label) {
  if (!L || (L._selShadow === undefined && !L._selMask)) { if (L) L._selShadow = null; return; }
  const prev = L._selShadow || null, lid = L.id, cur = L._selMask;
  if (!prev && !cur) return;                               // nothing before, nothing now
  if (prev && cur && prev.length === cur.length) { let same = true; for (let i = 0; i < cur.length; i++) if (!prev[i] !== !cur[i]) { same = false; break; } if (same) return; }   // a re-apply, not a change
  const restore = (m) => { const Lx = layerById(lid); if (!Lx) return; Lx._selMask = m ? m.slice() : null; applyLayerSelection(Lx); };
  // the redo's AFTER is the shadow shadowSelection takes right after this (shared, not
  // a second copy); past SEL_UNDO_MAX there is no shadow, so no redo either
  const box = { next: null }; L._selRedoBox = cur && cur.length > SEL_UNDO_MAX ? null : box;
  pushUndo(label, () => restore(prev), { key: 'sel:' + lid, redo: L._selRedoBox ? () => restore(box.next) : null });
}

function shadowSelection(L) {
  L._selShadow = L._selMask && L._selMask.length <= SEL_UNDO_MAX ? L._selMask.slice() : null;
  if (L._selRedoBox) { L._selRedoBox.next = L._selShadow; L._selRedoBox = null; }
}

export function clearSelection({ silent } = {}) {
  let had = false;
  withUndoGroup('clear selection', () => { for (const L of S.layers) {
    if (L.viewOf != null) continue;                         // a view's selection IS its model's
    if (L._selMask) { had = true; L._selMask = null; L._selCount = 0; recordSelectionUndo(L, 'clear selection'); shadowSelection(L); for (const F of selFamily(L)) S.renderer.setLayerSelection(F.id, null); attrTableSelChanged(L.id); refreshLinkedWindows(L); selectionChanged(L.id, 0); }
  } });
  if (had) { markProjectDirty(); requestRender(); if (!silent) $('#meta').textContent = 'selection cleared'; }
  return had;
}

// the layers drawing these records: the model and its views (src/layerviews.js)
// share ONE selection — it marks records, not a picture — so each draws it
const selFamily = (L) => {
  const M = L.viewOf != null ? layerById(L.viewOf) : L;
  return M ? [M, ...S.layers.filter((v) => v.viewOf === M.id)] : [L];
};

export function applyLayerSelection(L) {
  let c = 0;
  const m = L._selMask;
  if (m) for (let i = 0; i < m.length; i++) c += m[i];
  L._selCount = c;
  if (!c) L._selMask = null;
  recordSelectionUndo(L, 'selection'); shadowSelection(L);
  for (const F of selFamily(L)) S.renderer.setLayerSelection(F.id, c ? L._selMask : null);
  for (const F of selFamily(L)) { attrTableSelChanged(F.id); refreshLinkedWindows(F); }   // GT/swath windows tracking the selection recompute
  selectionChanged(L.id, c);
}

// every selection change funnels here (applyLayerSelection / clearSelection) →
// ONE `micro:selection` per layer per task, however many steps a tool took
const _selDirty = new Map();

function selectionChanged(lid, count) {
  syncSelBar();
  const first = !_selDirty.size;
  _selDirty.set(lid, count);
  if (first) queueMicrotask(() => {
    const all = [..._selDirty]; _selDirty.clear();
    for (const [layer, n] of all) dispatchEvent(new CustomEvent('micro:selection', { detail: { layer, count: n } }));
  });
}

// turn the current filter's matches into a real 3D selection — makes the
// contextual thing explicit (and a sel-scope recipe REPRODUCIBLE: filter,
// convert, run)
export function filterToSelection(L, mode = 'replace') {
  if (!L || !L._filterMask) { $('#meta').textContent = 'filter → selection: no active filter — run one in the filter box first'; return; }
  if (mode === 'replace') clearSelection({ silent: true });
  const n = attrRowCountOf(L);
  if (!n) { $('#meta').textContent = 'filter → selection: this layer has no records'; return; }
  if (!L._selMask || L._selMask.length !== n) L._selMask = new Uint8Array(n);
  const m = L._filterMask, lim = Math.min(n, m.length);
  for (let i = 0; i < lim; i++) if (m[i]) L._selMask[i] = 1;
  applyLayerSelection(L);
  selectionStatus(); markProjectDirty(); requestRender();
  $('#meta').textContent = `filter → selection: ${(L._selCount || 0).toLocaleString()} rows selected`;
}

// materialize the 3D selection as a painted 0/1 column — every row gets an
// explicit value (0 = out, 1 = selected). Same machinery as flag-by-solid, so
// it's brush-editable, filterable (SEL == 1), and rides every export.
export async function selectionToColumn(L) {
  if (!L || !L._selMask || !L._selCount) { $('#meta').textContent = 'selection → column: nothing selected on this layer'; return; }
  const name = (await microPrompt('column name', 'SEL') || '').trim();
  if (!name) return;
  const col = createPaintCol(L, name);
  if (!col) return;                                        // name taken — createPaintCol already said so
  const out = addPaintValue(L, col, '0'), inn = addPaintValue(L, col, '1');
  const m = L._selMask, codes = col.codes, n = codes.length;
  for (let r = 0; r < n; r++) codes[r] = (r < m.length && m[r]) ? inn : out;
  col.lineage = mkLineage('selection', { rows: L._selCount, of: L.name });   // a selection-derived flag is a derived column, not hand paint
  paintRecount(col);
  addPaintColorOptions(L);
  const t2 = _attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  markProjectDirty(); requestRender();
  $('#meta').textContent = `selection → ${name}: ${L._selCount.toLocaleString()} of ${n.toLocaleString()} rows = 1 (filter with ${name} == 1 · rides exports)`;
}

export function selectionStatus() {
  let total = 0, nL = 0;
  for (const L of S.layers) if (L._selCount && L.viewOf == null) { total += L._selCount; nL++; }
  if (_isMobile()) { $('#meta').textContent = selCountText() || 'selection: nothing there'; return; }   // the bar carries add / remove
  $('#meta').textContent = total
    ? `selected: ${total.toLocaleString()} element${total === 1 ? '' : 's'}${nL > 1 ? ` across ${nL} layers` : ''} — shift adds · alt subtracts · Esc clears`
    : 'selection: nothing there';
}

// a lasso restricted to ONE layer (the host's selectInPolygon) replaces only that
// layer's selection; the user's lasso (only == null) replaces everyone's
function clearForLasso(only) {
  if (only == null) { clearSelection({ silent: true }); return; }
  const L = layerById(only);
  if (L && L._selMask) { L._selMask.fill(0); applyLayerSelection(L); }
}

export function selectByPolygon(poly, mode, isRect, only = null) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const region = S.renderer.pickRegion({ x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - x0, h: y1 - y0 }, S.cam,
    { pointPx: +$('#ptPx').value, blocksAsPoints: H._viewMode === 'points', section: currentSection() });
  if (!region) { if (mode === 'replace') clearForLasso(only); $('#meta').textContent = 'selection: nothing there'; return; }
  const { data, w, h, dpr } = region;
  const rx = Math.max(0, x0), ry = Math.max(0, y0);
  const perLayer = new Map();
  for (let j = 0; j < h; j++) {
    const cssY = ry + (h - 1 - j) / dpr;                   // GL rows are bottom-up
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      if (isMiss(data[o + 1])) continue;                    // nothing under this pixel
      const lid = layerOfId(data[o + 1]);                  // G = layer | face<<16, R = record
      if (only != null && lid !== only) continue;
      if (!isRect && !pipTest(rx + i / dpr, cssY, poly)) continue;
      let set = perLayer.get(lid);
      if (!set) perLayer.set(lid, set = new Set());
      set.add(data[o] >>> 0);
    }
  }
  if (mode === 'replace') clearForLasso(only);
  for (const L of S.layers) {
    const hits = perLayer.get(L.id);
    if (!hits) continue;
    // a mesh hit is encoded as record 0 (the CPU resolves the triangle on a
    // single click) — so a lasso over an opaque mesh set _selMask[0]=1 for it,
    // inflating _selCount and corrupting selection→column, with no visible mark.
    // Rectangle/lasso select is for record-bearing layers only.
    if (L.kind === 'mesh') continue;
    const n = attrRowCountOf(L);
    if (!n) continue;
    if (!L._selMask || L._selMask.length !== n) L._selMask = new Uint8Array(n);
    const v = mode === 'subtract' ? 0 : 1;
    for (const r of hits) if (r < n) L._selMask[r] = v;
    applyLayerSelection(L);
  }
  selectionStatus();
  markProjectDirty(); requestRender();
}

// VOLUME (through) selection: the lasso extruded through the scene — pure
// geometry, occlusion ignored (that's the point: grab what's BEHIND too, the
// mode painting will want). Positions come from the same streams that loaded
// the data; drillholes resolve O(1) via recordPosition. Cost ≈ one load sweep.
// "Through" acts on what is DRAWN, not on everything in the tube. Its point is
// occlusion — reach what's behind — not a way past the display: a record the
// filter keeps out (filters isolate), a hidden category or rule class, the
// section, or a hidden layer/group keeps off the screen can't be selected or
// painted through either. (It could, and a through-lasso over a filtered model
// selected the filtered-out blocks too — into selection → column, exports of the
// selection, grade-tonnage on it. The anywidget's select_through always had this
// rule.) ONE scan for select and paint, so the two can't disagree.
// → (chunk, i, r) => is record r (chunk row i) on screen? null when nothing hides
function throughDrawnTest(L) {
  const isDh = !!(L.docs && L.docs.dhDoc);
  const mask = isDh ? (L._drawMask || null) : (L._filterMask || null);   // dh: filter AND whole-holes
  let codes = null, hidden = null;                         // codes null → the chunk's own category codes
  if (ruleModeOf(L)) { if (L.ruleHidden && L.ruleHidden.size && L._ruleCodes) { codes = L._ruleCodes; hidden = L.ruleHidden; } }
  else if (textCalcSel(L)) {                               // a text ƒ by class: its own codes + hidden classes
    const tc = calcCatCol(L), hid = tc ? classHidden(L, layerClassInfo(L)) : null;
    if (tc && hid.size) { codes = tc.codes; hidden = hid; }
  }
  else if (!paintActiveCol(L) && L.catHidden && L.catHidden.size) {
    hidden = L.catHidden;
    const vc = colorSelOf(L) === 'cat' ? viewCatData(L) : null;
    if (vc) codes = vc.codes;
  }
  const cs = currentSection();
  const sec = cs ? layerSection(cs, S.renderer.layerSectioned(L.id)) : null;
  if (!mask && !hidden && !sec) return null;
  const off = S.renderer.layerOffset(L.id);
  const o0 = sceneOrigin();
  const o = [o0[0] - off[0], o0[1] - off[1], o0[2] - off[2]];   // n·(x + off − origin)
  // a block's reach along the section normal: its half-dims projected on n
  // (rotated lattices through their U/V/W; sub-blocks by their size in fine steps)
  // (the block-support contract: the frame's U/V/W, the fine pitch, a sub-block's size in fine steps)
  let reach = () => 0;
  const sup = !isDh && L.docs.blockDoc ? supportOfHeader(L.docs.blockDoc.header) : null;
  if (sec && sup) {
    const n = sec.n, R = sup.frame.R, P = sup.lattice.pitch;
    const q = [0, 1, 2].map((a) => Math.abs(n[0] * R[3 * a] + n[1] * R[3 * a + 1] + n[2] * R[3 * a + 2]) * P[a] / 2);   // one fine step's reach
    const reg = q[0] + q[1] + q[2];
    if (!sup.sub) reach = () => reg;
    else {
      const qm = sup.sizeQMax || [255, 255, 255], subMax = q[0] * qm[0] + q[1] * qm[1] + q[2] * qm[2];
      reach = (ch, i) => (ch.dimQ ? q[0] * ch.dimQ[3 * i] + q[1] * ch.dimQ[3 * i + 1] + q[2] * ch.dimQ[3 * i + 2] : subMax);
    }
  }
  const dot = (x, y, z) => sec.n[0] * (x - o[0]) + sec.n[1] * (y - o[1]) + sec.n[2] * (z - o[2]);
  return (ch, i, r) => {
    if (mask && !mask[r]) return false;
    if (hidden && (codes || ch.cat) && hidden.has(codes ? codes[r] : ch.cat[i])) return false;   // a stream without codes can't say
    if (sec) {
      const lo = sec.d - sec.half, hi = sec.d + sec.half;
      if (ch.ax) {                                         // an interval: drawn if its segment meets the slab
        const a = dot(ch.ax[i], ch.ay[i], ch.az[i]), b = dot(ch.bx[i], ch.by[i], ch.bz[i]);
        if (Math.max(a, b) < lo || Math.min(a, b) > hi) return false;
      } else {
        const t = dot(ch.x[i], ch.y[i], ch.z[i]), k = reach(ch, i);
        if (t + k < lo || t - k > hi) return false;
      }
    }
    return true;
  };
}

// stream a layer's records, calling onHit(r) for each one drawn whose position
// projects into the gesture. false when superseded by a newer gesture.
export async function throughScan(L, hit, onHit, epoch, verb) {
  if (!layerShown(L.id)) return true;
  const d = L.docs, n = attrRowCountOf(L);
  const drawn = throughDrawnTest(L);
  const streamChunks = d.dhDoc && d.dhDoc.streamChunks ? d.dhDoc.streamChunks : await docPositionStream(d);
  if (!streamChunks) return true;
  let done = 0;
  const [dx, dy, dz] = S.renderer.layerOffset(L.id);       // a moved view is selected where it is drawn
  for await (const ch of streamChunks({ chunkPoints: 1 << 18 })) {
    if (epoch !== selEpoch()) return false;                 // superseded by a newer gesture
    const xs = ch.x, ys = ch.y, zs = ch.z, recs = ch.recIdx || null, base = ch.recStart || 0;
    for (let i = 0; i < ch.count; i++) {
      const r = recs ? recs[i] : base + i;
      if (r >= n || !hit(xs[i] + dx, ys[i] + dy, zs[i] + dz)) continue;
      if (drawn && !drawn(ch, i, r)) continue;
      onHit(r);
    }
    done += ch.count;
    if ((done & 0xFFFFF) === 0) { $('#meta').textContent = `${verb} through: ${L.label || L.name} — ${done.toLocaleString()} scanned…`; await new Promise((r2) => setTimeout(r2)); }
  }
  return true;
}

export let _selThrough = false;

let _selEpoch = 0;

// the gesture epoch selections share: a newer gesture supersedes an older, slower one
export function nextSelEpoch() { return ++_selEpoch; }

export function selEpoch() { return _selEpoch; }

export async function selectVolume(poly, mode, isRect, only = null) {
  const epoch = nextSelEpoch();
  const o = sceneOrigin();
  const vp = S.cam.state.viewProj;
  const rc = S.cv.getBoundingClientRect();
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of poly) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const inPoly = (px2, py2) => px2 >= bx0 && px2 <= bx1 && py2 >= by0 && py2 <= by1 && (isRect || pipTest(px2, py2, poly));
  const hit = (wx, wy, wz) => {
    const X = wx - o[0], Y = wy - o[1], Z = wz - o[2];
    const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
    if (cw <= 1e-9) return false;                          // behind the eye
    const px2 = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * rc.width;
    const py2 = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * rc.height;
    return inPoly(px2, py2);
  };
  if (mode === 'replace') clearForLasso(only);
  const v = mode === 'subtract' ? 0 : 1;
  for (const L of S.layers) {
    if (!layerShown(L.id) || L.kind === 'mesh') continue;
    if (only != null && L.id !== only) continue;
    const n = attrRowCountOf(L);
    if (!n) continue;
    if (!L._selMask || L._selMask.length !== n) L._selMask = new Uint8Array(n);
    const m = L._selMask;
    $('#meta').textContent = `select through: sweeping ${L.label || L.name}…`;
    try { if (!(await throughScan(L, hit, (r) => { m[r] = v; }, epoch, 'select'))) return; }
    catch (e) { $('#meta').textContent = `select through: ${L.name} — ${e.message}`; }
    applyLayerSelection(L);
  }
  if (epoch !== selEpoch()) return;
  selectionStatus();
  markProjectDirty(); requestRender();
}

// gesture arming — the knife's grammar: one-shot, capture-phase, Esc cancels
export let _selArm = null;                                        // 'rect' | 'lasso' | null

// selection stickiness (Settings → interaction): 'oneshot' | 'smart' | 'sticky'
export let _selStick = (() => { try { return localStorage.getItem('micro.selStick') || 'smart'; } catch { return 'smart'; } })();

export function setSelStick(v) { _selStick = v; try { localStorage.setItem('micro.selStick', v); } catch { /* private */ } }

let _selPts = null;

let _selPrompt = null;                                     // the status line armSelect wrote, to take back on disarm

export function armSelect(kind) {
  _selArm = kind; _selPts = null;
  queueMicrotask(syncSelBar);
  PAINT.lastKind = kind;
  if (!PAINT.arm) _selShapeLast = kind;
  $('#btnSelRect').classList.toggle('on', kind === 'rect' || (_isMobile() && !PAINT.arm));   // the phone's one select button stands for either shape
  $('#btnSelLasso').classList.toggle('on', kind === 'lasso');
  S.cv.style.cursor = 'crosshair';
  $('#meta').textContent = PAINT.arm
    ? `painting ${paintArmLabel()} — drag to paint · alt erases · Esc stops` + (_selThrough ? ' · THROUGH' : '')
    : _isMobile()
    ? (selCountText() || (kind === 'rect' ? 'select: drag a rectangle' : 'select: draw a lasso')) + (_selThrough ? ' · through' : ' · visible only')
    : (kind === 'rect'
      ? 'select: drag a rectangle — shift adds, alt subtracts (and keeps the tool armed)'
      : 'select: draw a lasso — shift adds, alt subtracts (and keeps the tool armed)') + (_selThrough ? ' · THROUGH (everything in the tube)' : ' · visible');
  _selPrompt = $('#meta').textContent;
}

export function disarmSelect() {
  _selArm = null; _selPts = null;
  // take the "select: drag a rectangle" prompt back with the tool, or it outlives it (Back,
  // Esc, the button); a message written since — a count, "nothing there" — stays
  if (_selPrompt !== null && $('#meta').textContent === _selPrompt) $('#meta').textContent = '';
  _selPrompt = null;
  $('#btnSelRect').classList.remove('on');
  $('#btnSelLasso').classList.remove('on');
  syncSelBar();
  S.cv.style.cursor = '';
  $('#selSvg').style.display = 'none';
}

let _selShapeLast = 'rect';                                // the phone's select button re-arms the last shape

export function setSelThrough(v) {
  _selThrough = !!v;
  $('#btnSelThrough').classList.toggle('on', _selThrough);
  if (_selArm) armSelect(_selArm);                         // refresh the armed hint
  syncSelBar();
}

// a phone has no shift / alt: the selection bar's new · add · remove sets what the
// next drag does (sticky until changed); the modifiers still win on a keyboard
let _selTouchMode = 'replace';

const selModeOf = (e) => (e.shiftKey ? 'add' : e.altKey ? 'subtract' : _selTouchMode);

function selBarTarget() {
  const A = activeLayer();
  return A && A._selCount ? A : S.layers.find((L) => L._selCount) || null;
}

function selCountText() {
  let total = 0, nL = 0;
  for (const L of S.layers) if (L._selCount && L.viewOf == null) { total += L._selCount; nL++; }
  if (!total) return '';
  const T = selBarTarget();
  return `${total.toLocaleString()} selected${nL > 1 ? ` · ${nL} layers` : T ? ` · ${T.label || T.name}` : ''}`;
}

let _selBarTotal = 0;                                      // the count goes to the status line when it CHANGES

export function syncSelBar() {
  const mobile = document.body.classList.contains('mobile');
  let total = 0;
  for (const L of S.layers) if (L._selCount && L.viewOf == null) total += L._selCount;
  const on = mobile && (total > 0 || !!_selArm);
  document.body.classList.toggle('sel-on', on);
  if (!on) { _selBarTotal = total; return; }
  if (total !== _selBarTotal) { _selBarTotal = total; $('#meta').textContent = selCountText() || 'selection cleared'; }
  for (const b of $('#selBarShape').children) b.classList.toggle('on', b.dataset.k === (_selArm && !PAINT.arm ? _selArm : null));
  $('#selBarThrough').classList.toggle('on', _selThrough);
  for (const b of $('#selBarModes').children) b.classList.toggle('on', b.dataset.m === _selTouchMode);
  $('#selBarCol').disabled = !selBarTarget();
  $('#selBarClear').disabled = !total;
}

function drawSelShape() {
  const el = $('#selShape');
  if (!_selPts || _selPts.length < 2) { el.setAttribute('points', ''); return; }
  el.setAttribute('points', _selPts.map((p2) => p2.join(',')).join(' '));
}

// the selection tool's controls: the tool-row and selection-bar buttons, and the
// canvas gestures (capture phase, so an armed tool gets the pointer first)
export function installSelectionTool() {
  $('#btnSelRect').onclick = () => {
    if (_isMobile()) { if (_selArm && !PAINT.arm) disarmSelect(); else armSelect(_selShapeLast); return; }
    if (_selArm === 'rect') disarmSelect(); else armSelect('rect');
  };
  $('#btnSelLasso').onclick = () => { if (_selArm === 'lasso') disarmSelect(); else armSelect('lasso'); };
  $('#btnSelThrough').onclick = () => setSelThrough(!_selThrough);
  for (const b of $('#selBarModes').children) b.onclick = () => { _selTouchMode = b.dataset.m; if (!_selArm) armSelect(_selShapeLast); syncSelBar(); };
  // the shape + through buttons wear the desktop tool row's own icons
  for (const b of $('#selBarShape').children) {
    b.appendChild($(b.dataset.k === 'rect' ? '#btnSelRect svg' : '#btnSelLasso svg').cloneNode(true));
    b.onclick = () => armSelect(b.dataset.k);
  }
  $('#selBarThrough').appendChild($('#btnSelThrough svg').cloneNode(true));
  $('#selBarThrough').onclick = () => setSelThrough(!_selThrough);
  $('#selBarCol').onclick = () => { const T = selBarTarget(); if (T) selectionToColumn(T); };
  $('#selBarClear').onclick = () => { clearSelection(); syncSelBar(); };
  S.cv.addEventListener('pointerdown', (e) => {
    if (!_selArm || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const r = S.cv.getBoundingClientRect();
    _selPts = [[e.clientX - r.left, e.clientY - r.top]];
    $('#selSvg').style.display = '';
  }, { capture: true });
  S.cv.addEventListener('pointermove', (e) => {
    if (!_selArm || !_selPts) return;
    e.stopImmediatePropagation();
    const r = S.cv.getBoundingClientRect();
    const pt = [e.clientX - r.left, e.clientY - r.top];
    if (_selArm === 'rect') {
      const a = _selPts[0];
      _selPts = [a, [pt[0], a[1]], pt, [a[0], pt[1]]];
    } else {
      const last = _selPts[_selPts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 4) _selPts.push(pt);
    }
    drawSelShape();
  }, { capture: true });
  S.cv.addEventListener('pointerup', (e) => {
    if (!_selArm || !_selPts) return;
    e.stopImmediatePropagation();
    const poly = _selPts.slice();
    const kind = _selArm;
    disarmSelect();
    if (poly.length >= (kind === 'rect' ? 4 : 3)) {
      if (PAINT.arm) {
        // painting: the gesture assigns the armed value (alt erases) and STAYS
        // armed — drag, drag, drag; Esc puts the brush down
        (_selThrough ? paintVolume : paintByPolygon)(poly, e.altKey ? 0 : PAINT.arm.code, kind === 'rect');
        armSelect(kind);
      } else {
        const mode = selModeOf(e);
        withUndoGroup(mode === 'replace' ? 'selection' : mode === 'add' ? 'add to selection' : 'remove from selection',
          () => (_selThrough ? selectVolume : selectByPolygon)(poly, mode, kind === 'rect'));
        // stickiness per Settings: 'smart' re-arms after an add/subtract (shift/alt, or
        // the phone bar's + add / − remove: more gestures are coming), 'sticky' always,
        // 'oneshot' never
        if (_selStick === 'sticky' || (_selStick === 'smart' && mode !== 'replace')) armSelect(kind);
      }
    } else $('#meta').textContent = PAINT.arm ? 'paint: nothing there' : 'selection: nothing there';
  }, { capture: true });
}
