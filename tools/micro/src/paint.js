// micro — paint-to-column (§15, the crown jewel): interactive domaining. A painted
// column = per-record u8 codes + a value dict, filled by the selection
// GESTURES while a brush value is armed — the rules machinery with a brush
// instead of an expression. The palette is a LAYER-PINNED floating window
// (the attribute-table rule: a brush must never retarget under your hand).
// Painted values ride extendRow, so filter/scan/table/record-panel see them
// as ordinary text columns; codes persist byte-RLE'd in project.json.
// Also the palette window and Ctrl+Z / Ctrl+Y, which choose between the shared
// history and a layer's paint stack.
import { S, activeLayer, layerById, requestRender } from './state.js';
import { _selArm, armSelect, disarmSelect, nextSelEpoch, pipTest, selEpoch, throughScan } from './selection.js';
import { attrRowCountOf, layerTableHeader } from './records.js';
import { PAINT_BLANK, paintRecount, ruleDefaultColor } from './columns.js';
import { RULE_ELSE, addPaintColorOptions, applyPaintPalette, colorSelOf, paintSelOf } from './props.js';
import { markProjectDirty } from './project.js';
import { freshStep, redoLabel, redoLast, undoLabel, undoLast, undoTopRedoable } from './undo.js';
import { structureAfterEdit, structureArmed, structureTool } from './structure-ui.js';
import { _attrTables } from './attrtable.js';
import { isMiss, layerOfId } from '../../../ext/condenser/src/main.js';
import { floatWin, focusWindow } from './windows.js';
import { setLayerColorSel } from './color.js';
import { menuXY } from './menu.js';
const $ = (s) => document.querySelector(s);
// the brush, shared with the selection tool (its gestures paint while a brush is armed)
export const PAINT = {
  arm: null,          // { lid, colName, code } — ONE armed brush globally
  lastKind: 'rect',   // the gesture shape the brush last used
  lastLid: null,      // the layer painted LAST (Ctrl+Z falls back to it)
};

// the app's side, passed in once (setPaintHooks): _viewMode, currentSection
let H = {};
export function setPaintHooks(h) { H = h; }

const _paintWins = new Map();                              // layerId → { win, render }

export function paintColByName(L, name) { return ((L && L.paintCols) || []).find((c) => c.name === name); }

export function paintArmLabel() {
  if (!PAINT.arm) return '';
  const L = layerById(PAINT.arm.lid);
  const col = L && paintColByName(L, PAINT.arm.colName);
  if (!col) return '';
  return `${col.name} = ${PAINT.arm.code ? col.dict[PAINT.arm.code] : 'unpainted'}`;
}

export function paintDisarm() {
  if (!PAINT.arm) return;
  const t = PAINT.arm;
  PAINT.arm = null;
  $('#btnPaint').classList.remove('on');
  if (_selArm) disarmSelect();
  const w = _paintWins.get(t.lid);
  if (w) w.render();
  $('#meta').textContent = 'brush down';
}

export function paintArm(lid, colName, code) {
  PAINT.arm = { lid, colName, code };
  $('#btnPaint').classList.add('on');
  for (const [, w] of _paintWins) w.render();
  armSelect(_selArm || PAINT.lastKind || 'rect');          // painting rides the gesture tools, sticky
}

export function createPaintCol(L, name, kind) {
  const n = attrRowCountOf(L);
  if (!n) { $('#meta').textContent = 'paint: no records behind this layer'; return null; }
  name = (name || '').trim();
  if (!name) return null;
  const h = layerTableHeader(L);
  const source = new Set([...((h && h.columns) || []), ...(L.calcCols || []).map((c) => c.name)]);
  if (source.has(name)) { $('#meta').textContent = `paint: “${name}” is a source or ƒ column — pick another name`; return null; }
  const col = { name, dict: [''], colors: ['#000000'], blankColor: PAINT_BLANK, codes: new Uint8Array(n) };
  if (kind) col.kind = kind;                               // 'ratio' = numeric code/255, no dict
  paintRecount(col);
  L.paintCols = L.paintCols || [];
  const at = L.paintCols.findIndex((c) => c.name === name);
  if (at >= 0) L.paintCols[at] = col;                      // REPLACE on name — running an op twice == running it once
  else L.paintCols.push(col);
  L._colStats = null;                                      // the scan doesn't know this column yet
  addPaintColorOptions(L);
  markProjectDirty();
  return col;
}

export function addPaintValue(L, col, label) {
  const live = col.dict.filter((d, i) => i > 0 && d != null).length;
  if (col.dict.length >= 256) { $('#meta').textContent = 'paint: a column holds at most 255 values'; return null; }
  label = (label || '').trim() || `value ${live + 1}`;
  col.dict.push(label);
  col.colors.push(ruleDefaultColor(live));
  const c2 = new Uint32Array(col.dict.length); c2.set(col.counts); col.counts = c2;
  if (paintSelOf(L) === col.name) applyPaintPalette(L, col);
  markProjectDirty();
  return col.dict.length - 1;
}

// the stroke core: assign `code` to a set of records, with a diff-based undo
// entry (indices + old codes — bounded, cheap even at 50M records)
export function paintApply(L, col, recs, code) {
  const n = attrRowCountOf(L);
  if (col.codes.length !== n) { const c2 = new Uint8Array(n); c2.set(col.codes.subarray(0, Math.min(n, col.codes.length))); col.codes = c2; paintRecount(col); }
  const idx = [], old = [];
  for (const r of recs) if (r < n && col.codes[r] !== code) { idx.push(r); old.push(col.codes[r]); }
  if (!idx.length) { $('#meta').textContent = 'paint: nothing new there'; return 0; }
  const st = (L._paintUndo = L._paintUndo || []);
  PAINT.lastLid = L.id;
  st.push({ col: col.name, idx: Uint32Array.from(idx), old: Uint8Array.from(old) });
  freshStep();                                             // a new stroke forks the history: redo is gone
  L._paintVer = (L._paintVer || 0) + 1;                    // ƒ display realizations that read this paint go stale
  let bytes = 0; for (const u of st) bytes += u.idx.length * 5;
  while (st.length > 1 && bytes > 32e6) { const d = st.shift(); bytes -= d.idx.length * 5; }
  for (let i = 0; i < idx.length; i++) { col.counts[old[i]]--; col.counts[code]++; col.codes[idx[i]] = code; }
  paintAfterEdit(L, col);
  $('#meta').textContent = `paint: ${idx.length.toLocaleString()} → ${code ? col.dict[code] : 'unpainted'} · ${col.name} (Ctrl+Z undoes)`;
  return idx.length;
}

// move one stroke between a layer's paint stacks: restore its codes and record the
// inverse on the other stack (undo → redo, redo → undo)
function paintSwap(L, from, to) {
  const u = L[from].pop();
  const col = paintColByName(L, u.col);
  if (!col) return null;
  const now = new Uint8Array(u.idx.length);
  for (let i = 0; i < u.idx.length; i++) {
    const r = u.idx[i];
    if (r < col.codes.length) { now[i] = col.codes[r]; col.counts[col.codes[r]]--; col.counts[u.old[i]]++; col.codes[r] = u.old[i]; }
  }
  (L[to] = L[to] || []).push({ col: u.col, idx: u.idx, old: now });
  L._paintVer = (L._paintVer || 0) + 1;
  paintAfterEdit(L, col);
  return { n: u.idx.length, col };
}

export function paintUndo(L) {
  if (!L._paintUndo || !L._paintUndo.length) { $('#meta').textContent = 'paint: nothing to undo'; return; }
  const r = paintSwap(L, '_paintUndo', '_paintRedo'); if (!r) return;
  _redoOrder.push(L.id);
  $('#meta').textContent = `paint: undid ${r.n.toLocaleString()} · ${r.col.name}`;
}

function paintRedo(L) {
  if (!L._paintRedo || !L._paintRedo.length) return;
  const r = paintSwap(L, '_paintRedo', '_paintUndo'); if (!r) return;
  $('#meta').textContent = `paint: redid ${r.n.toLocaleString()} · ${r.col.name}`;
}

// ONE undo and ONE redo, for the keys and the phone's ↶ ↷ buttons. Undo: the paint
// stack of the layer being painted (or the active one) first, then the shared
// history. Redo replays in the reverse order of the undos — _redoOrder says which
// stack each one came from ('h' = the shared history, a layer id = its paint).
export const _redoOrder = [];

// whose paint stack Ctrl+Z reads: the armed brush's layer, else the outcrop the structure tools
// are armed on, else the active layer — and when the active layer has no paint to undo, the
// layer painted LAST (a stereonet 'move to set' paints the outcrop while a table is active)
function _undoTarget() {
  const SA = structureArmed();
  if (!PAINT.arm && SA && structureTool() === 'trace') return null;   // drawing traces: Ctrl+Z is the shared history (a trace isn't paint)
  const Lz = PAINT.arm ? layerById(PAINT.arm.lid) : SA ? SA.L : activeLayer();
  if (Lz && Lz._paintUndo && Lz._paintUndo.length) return Lz;
  if (PAINT.arm || SA) return null;
  const Ll = PAINT.lastLid != null ? layerById(PAINT.lastLid) : null;
  return Ll && Ll._paintUndo && Ll._paintUndo.length ? Ll : null;
}

export function undoAction() {
  const Lz = _undoTarget();
  if (Lz) { paintUndo(Lz); syncUndoBtn(); }
  else if (undoLabel()) {
    if (undoTopRedoable()) _redoOrder.push('h');           // NOW, not after the await — a redo right behind must find it
    undoLast().then((r) => { if (r) $('#meta').textContent = `undone: ${r.label}`; syncUndoBtn(); });
  }
  else $('#meta').textContent = 'nothing to undo';
}

function _redoNext() {
  while (_redoOrder.length) {                             // skip entries whose layer went away
    const k = _redoOrder[_redoOrder.length - 1];
    if (k === 'h' ? redoLabel() : (layerById(k) && layerById(k)._paintRedo && layerById(k)._paintRedo.length)) return k;
    _redoOrder.pop();
  }
  return null;
}

export function redoAction() {
  const k = _redoNext();
  if (k == null) { $('#meta').textContent = 'nothing to redo'; return; }
  _redoOrder.pop();
  if (k === 'h') redoLast().then((lbl) => { if (lbl) $('#meta').textContent = `redone: ${lbl}`; syncUndoBtn(); });
  else { paintRedo(layerById(k)); syncUndoBtn(); }
}

export function syncUndoBtn() {
  const b = $('#btnUndo'), rb = $('#btnRedo');
  if (b) {
    const lbl = _undoTarget() ? 'paint stroke' : undoLabel();
    b.disabled = !lbl;
    b.title = lbl ? `undo ${lbl}` : 'nothing to undo';
  }
  if (rb) {
    const k = _redoNext(), lbl = k == null ? null : k === 'h' ? redoLabel() : 'paint stroke';
    rb.disabled = !lbl;
    rb.title = lbl ? `redo ${lbl}` : 'nothing to redo';
  }
}

export function paintAfterEdit(L, col) {
  syncUndoBtn();
  if (L.kind === 'mesh' && col.name === 'SET') structureAfterEdit(L);   // the sets ARE this column: recolour + re-measure
  if (paintSelOf(L) === col.name) S.renderer.setLayerRuleCodes(L.id, col.codes);
  const w = _paintWins.get(L.id); if (w) w.render();
  const t2 = _attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  L._colStats = null;                                      // stats are stale for this column
  markProjectDirty(); requestRender();
}

// visible-mode stroke: the ID-buffer readback (occlusion-honest, like the
// selection tools) filtered to the brush's layer
export function paintByPolygon(poly, code, isRect) {
  const t = PAINT.arm; if (!t) return;
  const L = layerById(t.lid);
  const col = L && paintColByName(L, t.colName);
  if (!col) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const region = S.renderer.pickRegion({ x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - x0, h: y1 - y0 }, S.cam,
    { pointPx: +$('#ptPx').value, blocksAsPoints: H._viewMode === 'points', section: H.currentSection() });
  if (!region) { $('#meta').textContent = 'paint: nothing there'; return; }
  const { data, w, h, dpr } = region;
  const rx = Math.max(0, x0), ry = Math.max(0, y0);
  const hits = new Set();
  for (let j = 0; j < h; j++) {
    const cssY = ry + (h - 1 - j) / dpr;
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      if (isMiss(data[o + 1]) || layerOfId(data[o + 1]) !== t.lid) continue;   // another layer (or nothing)
      if (!isRect && !pipTest(rx + i / dpr, cssY, poly)) continue;
      hits.add(data[o] >>> 0);
    }
  }
  paintApply(L, col, hits, code);
}

// through-mode stroke: the extruded tube over the brush's layer (grabs what
// occlusion hides — the domaining gesture usually WANTS the whole tube)
export async function paintVolume(poly, code, isRect) {
  const t = PAINT.arm; if (!t) return;
  const L = layerById(t.lid);
  const col = L && paintColByName(L, t.colName);
  if (!col) return;
  const epoch = nextSelEpoch();                               // shares the gesture epoch — a newer stroke supersedes
  const o = S.frame ? S.frame.origin : [0, 0, 0];
  const vp = S.cam.state.viewProj;
  const rc = S.cv.getBoundingClientRect();
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of poly) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const inPoly = (px2, py2) => px2 >= bx0 && px2 <= bx1 && py2 >= by0 && py2 <= by1 && (isRect || pipTest(px2, py2, poly));
  const hit = (wx, wy, wz) => {
    const X = wx - o[0], Y = wy - o[1], Z = wz - o[2];
    const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
    if (cw <= 1e-9) return false;
    const px2 = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * rc.width;
    const py2 = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * rc.height;
    return inPoly(px2, py2);
  };
  const hits = [];
  try { if (!(await throughScan(L, hit, (r) => { hits.push(r); }, epoch, 'paint'))) return; }
  catch (e) { $('#meta').textContent = `paint through: ${e.message}`; return; }
  if (epoch !== selEpoch()) return;
  paintApply(L, col, hits, code);
}

// ── the palette window ──
export function openPaintPalette(L) {
  if (!L) return;
  if (L.kind === 'mesh' || !layerTableHeader(L)) { $('#meta').textContent = 'paint: needs a table-backed layer (blocks or drillholes)'; return; }
  const ex = _paintWins.get(L.id);
  if (ex) { focusWindow(ex.win.el); return; }
  const brushable = (L.paintCols || []).filter((c) => c.kind !== 'ratio');
  const st = {
    colName: (brushable[0] && brushable[0].name) || null,
    prevSel: colorSelOf(L),                                // hand the color back on close (unless re-aimed)
    creating: !(L.paintCols && L.paintCols.length),
  };
  const win = floatWin({
    title: `paint · ${L.label || L.name}`, sub: '',
    x: Math.max(12, innerWidth - 610), y: 92, w: 264, h: 340,
    onClose: () => {
      _paintWins.delete(L.id);
      if (PAINT.arm && PAINT.arm.lid === L.id) paintDisarm();
      if (paintSelOf(L) && st.prevSel != null && !String(st.prevSel).startsWith('paint:')) setLayerColorSel(L, st.prevSel);
    },
  });
  const render = () => {
    const body = win.body; body.textContent = '';
    body.classList.add('pw-body');
    const col = st.colName ? paintColByName(L, st.colName) : null;
    win.sub.textContent = col ? `✎ ${col.name}` : '';
    // ── column row ──
    const colSel = document.createElement('select');
    for (const pc of (L.paintCols || []).filter((c) => c.kind !== 'ratio')) { const o = document.createElement('option'); o.value = pc.name; o.textContent = pc.name; colSel.appendChild(o); }
    { const o = document.createElement('option'); o.value = '__new__'; o.textContent = '＋ new column…'; colSel.appendChild(o); }
    if (st.colName) colSel.value = st.colName;
    colSel.onchange = () => {
      if (colSel.value === '__new__') { st.creating = true; render(); return; }
      st.colName = colSel.value;
      if (PAINT.arm && PAINT.arm.lid === L.id) PAINT.arm = null;
      setLayerColorSel(L, 'paint:' + st.colName);
      render();
    };
    const colRow = document.createElement('div'); colRow.className = 'pw-colrow';
    const colLab = document.createElement('label'); colLab.textContent = 'column';
    colRow.append(colLab, colSel);
    body.appendChild(colRow);
    if (st.creating) {
      const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = 'DOMAIN';
      nameIn.className = 'pw-name-in';
      const mk = document.createElement('button'); mk.className = 'awin-btn btn-p'; mk.textContent = 'create';
      const commit = () => {
        const c2 = createPaintCol(L, nameIn.value || 'DOMAIN');
        if (!c2) return;
        st.colName = c2.name; st.creating = false;
        setLayerColorSel(L, 'paint:' + c2.name);
        render();
      };
      mk.onclick = commit;
      nameIn.onkeydown = (ev) => { if (ev.key === 'Enter') commit(); };
      const row = document.createElement('div'); row.className = 'pw-colrow';
      const lab = document.createElement('label'); lab.textContent = 'name';
      row.append(lab, nameIn, mk);
      body.appendChild(row);
      const hint = document.createElement('div');
      hint.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5;padding:8px 2px';
      hint.textContent = 'name a category column and create it — then add values, pick one, and brush straight onto the blocks (b arms the brush; click applies, right-drag erases)';
      body.appendChild(hint);
      if (!col) { setTimeout(() => nameIn.focus(), 0); return; }
    }
    if (!col) return;
    // ── value rows: click to arm the brush; every r/v gesture then paints ──
    const armedHere = (code) => PAINT.arm && PAINT.arm.lid === L.id && PAINT.arm.colName === col.name && PAINT.arm.code === code;
    const rowFor = (code) => {
      const isBlank = code === 0;
      const row = document.createElement('div'); row.className = 'pw-row' + (armedHere(code) ? ' armed' : '');
      const dot = document.createElement('input'); dot.type = 'radio'; dot.name = 'pwarm' + L.id;
      dot.checked = armedHere(code);
      dot.title = isBlank ? 'arm the eraser' : 'arm this value — r / v gestures paint it';
      const arm = () => { if (armedHere(code)) paintDisarm(); else paintArm(L.id, col.name, code); };
      dot.onclick = (ev) => { ev.preventDefault(); arm(); };
      const sw = document.createElement('input'); sw.type = 'color';
      sw.value = isBlank ? (col.blankColor || PAINT_BLANK) : (col.colors[code] || RULE_ELSE);
      sw.oninput = () => {
        if (isBlank) col.blankColor = sw.value; else col.colors[code] = sw.value;
        if (paintSelOf(L) === col.name) applyPaintPalette(L, col);
        markProjectDirty();
      };
      let nm;
      if (isBlank) {
        nm = document.createElement('span'); nm.className = 'pw-blank'; nm.textContent = 'unpainted';
      } else {
        nm = document.createElement('input'); nm.type = 'text'; nm.value = col.dict[code];
        nm.onchange = () => { const v = nm.value.trim(); if (v) { col.dict[code] = v; L._colStats = null; markProjectDirty(); if (armedHere(code)) armSelect(_selArm || PAINT.lastKind); } else nm.value = col.dict[code]; };
      }
      const ct = document.createElement('span'); ct.className = 'ct';
      ct.textContent = col.counts && code < col.counts.length ? col.counts[code].toLocaleString() : '';
      row.append(dot, sw, nm, ct);
      if (!isBlank) {
        const kb = document.createElement('span'); kb.className = 'pp-kebab'; kb.textContent = '⋮';
        kb.onclick = (ev) => {
          ev.stopPropagation();
          const r2 = kb.getBoundingClientRect();
          const cnt = col.counts[code] || 0;
          menuXY(r2.left - 60, r2.bottom + 2, [
            { label: `Clear (${cnt.toLocaleString()} → unpainted)`, action: () => { const recs = []; for (let i = 0; i < col.codes.length; i++) if (col.codes[i] === code) recs.push(i); paintApply(L, col, recs, 0); } },
            { label: 'Remove value', action: () => {
              const recs = []; for (let i = 0; i < col.codes.length; i++) if (col.codes[i] === code) recs.push(i);
              if (recs.length) paintApply(L, col, recs, 0);
              col.dict[code] = null;                       // tombstone — codes stay stable
              if (armedHere(code)) PAINT.arm = null;
              if (paintSelOf(L) === col.name) applyPaintPalette(L, col);
              markProjectDirty(); render();
            } },
          ]);
        };
        row.appendChild(kb);
      } else {
        row.appendChild(document.createElement('span'));
      }
      return row;
    };
    for (let c2 = 1; c2 < col.dict.length; c2++) if (col.dict[c2] != null) body.appendChild(rowFor(c2));
    body.appendChild(rowFor(0));
    // ── footer tools ──
    const add = document.createElement('button'); add.textContent = '+ value';
    add.onclick = () => { const code = addPaintValue(L, col); if (code != null) { paintArm(L.id, col.name, code); render(); } };
    const apply = document.createElement('button'); apply.textContent = 'apply to selection';
    apply.title = 'stamp the armed value onto the current selection (build one with plain r / v first)';
    apply.disabled = !(L._selMask && PAINT.arm && PAINT.arm.lid === L.id);
    apply.onclick = () => {
      if (!L._selMask || !PAINT.arm || PAINT.arm.lid !== L.id) return;
      const recs = [];
      for (let i = 0; i < L._selMask.length; i++) if (L._selMask[i]) recs.push(i);
      paintApply(L, paintColByName(L, PAINT.arm.colName), recs, PAINT.arm.code);
    };
    const undo = document.createElement('button'); undo.textContent = 'undo';
    undo.title = 'undo the last stroke (Ctrl+Z)';
    undo.disabled = !(L._paintUndo && L._paintUndo.length);
    undo.onclick = () => paintUndo(L);
    const tools = document.createElement('div'); tools.className = 'pw-tools';
    tools.append(add, apply, undo);
    body.appendChild(tools);
    const hint = document.createElement('div'); hint.className = 'pp-note';
    hint.textContent = PAINT.arm && PAINT.arm.lid === L.id
      ? 'drag r / v gestures to paint · alt erases · the select-through toggle paints the whole tube · Esc stops'
      : 'click a value to arm the brush';
    body.appendChild(hint);
  };
  _paintWins.set(L.id, { win, render });
  render();
  if (st.colName) setLayerColorSel(L, 'paint:' + st.colName);
}
