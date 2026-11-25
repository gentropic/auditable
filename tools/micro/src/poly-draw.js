// micro POLYGON DRAW / EDIT — a basic plan-view tool for strings & polygons (src/polygons.js).
//
// DRAW (Tools → Draw polygon / Draw line, or a feature layer's menu → Geometry): click vertices
// on the view — they land on a horizontal plane at the drawing elevation (the plan section's,
// else the top of the scene) through the camera ray, so a plan view draws in plan. A vertex
// snaps to any feature vertex within 10 px (hold Alt to place freely). Close a polygon by
// clicking its first vertex, double-clicking, or Enter; Backspace / Ctrl+Z take the last vertex
// back; Esc stops. Then a name and optional attributes (key=value, …). The polygon goes into the
// layer drawn into (a menu's "Draw polygon into this layer", or the active DRAWN layer) or a new
// layer "drawn polygons" — a layer like any other: table, filter, colour, export, project.
//
// EDIT VERTICES (a feature layer's menu → Geometry, or the palette): every vertex of the layer
// (or of its selected features) gets a handle, every edge a midpoint handle. Drag a vertex to
// move it (its z is kept); drag a midpoint to insert a vertex there; Alt-click a vertex, or click
// it and press Delete, to remove it. Each edit is one undo step (Ctrl+Z). Enter / Esc ends.
//
// A drawn or edited layer is kept as micro's own WKT-CSV (src/poly-ui.js), so a project save
// writes it into polygons/ and a reopen reads it back.
import { S, layerById, requestRender, FRAME_DRAWERS } from './state.js';
import { pixelRay } from './pick.js';
import { projectToCss } from './overlay.js';
import { isPolygonLayer, featureDocOf } from './polygons.js';
import { editFeatures, newFeatureLayer } from './poly-ui.js';
import { microPrompt } from './prompts.js';
import { setActiveLayer } from './layers.js';
import { currentSection } from './section.js';
import { registerCommands, contributeMenu } from './commands.js';
import { worldToLocal, localToWorld, axisWorldToLocal, axisLocalToWorld } from './coords.js';
const $ = (s) => document.querySelector(s);

const SNAP_PX = 10, HANDLE_PX = 8, EDIT_MAX = 20000;
// the tool's state: mode 'draw' | 'edit' | null
export const DRAW = { mode: null, L: null, closed: true, pts: [], z: 0, mouse: null, drag: null, picked: null, draftId: 0 };

// ── screen ⇄ world ──────────────────────────────────────────────────────────────────────────
const toLocal = (w) => worldToLocal(w);
const cssOf = (w) => projectToCss(toLocal(w));
// a CSS pixel → the world point on the horizontal plane at `z` (null when the ray runs parallel)
export function worldAt(cssX, cssY, z) {
  const { o, d } = pixelRay(cssX, cssY);
  const zl = axisWorldToLocal(z, 2);
  if (Math.abs(d[2]) < 1e-9) return null;
  const t = (zl - o[2]) / d[2];
  return [...localToWorld([o[0] + t * d[0], o[1] + t * d[1], zl]).slice(0, 2), z];
}
// the drawing elevation: a plan section's plane, else the top of what's open
function drawZ() {
  const sec = currentSection();
  if (sec && sec.n && Math.abs(sec.n[2]) > 0.99 && Number.isFinite(sec.d0)) return axisLocalToWorld(sec.d0 / sec.n[2], 2);
  if (S.docBbox) return axisLocalToWorld(S.docBbox[5], 2);
  return axisLocalToWorld(0, 2);
}
// snap: the nearest feature vertex (any visible feature layer) within SNAP_PX
function snapTo(cssX, cssY) {
  let best = null, bd = SNAP_PX;
  for (const L of S.layers) {
    if (!isPolygonLayer(L) || L.visible === false) continue;
    const d = featureDocOf(L);
    let n = 0; for (const f of d.features) for (const r of f.rings) n += r.length;
    if (n > EDIT_MAX) continue;
    for (const f of d.features) for (const r of f.rings) for (const p of r) {
      const c = cssOf(p); if (!c) continue;
      const dd = Math.hypot(c[0] - cssX, c[1] - cssY);
      if (dd < bd) { bd = dd; best = p; }
    }
  }
  for (const p of DRAW.pts) { const c = cssOf(p); if (c) { const dd = Math.hypot(c[0] - cssX, c[1] - cssY); if (dd < bd) { bd = dd; best = p; } } }
  return best ? [best[0], best[1], DRAW.z] : null;
}

// ── the overlay ─────────────────────────────────────────────────────────────────────────────
function svgEl() {
  let s = $('#polySvg');
  if (!s) {
    s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = 'polySvg';
    s.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:2');
    $('#view').appendChild(s);
  }
  return s;
}
const NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
export function drawPolyOverlay() {
  const s = svgEl();
  if (!DRAW.mode || !S.frame) { if (s.style.display !== 'none') { s.style.display = 'none'; s.textContent = ''; } return; }
  s.style.display = ''; s.textContent = '';
  const ink = '#ff26b3', casing = '#121212';
  if (DRAW.mode === 'draw') {
    const pts = DRAW.pts.map(cssOf).filter(Boolean);
    const path = [...pts, ...(DRAW.mouse ? [DRAW.mouse] : [])];
    if (path.length >= 2) {
      const d = path.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('') + (DRAW.closed && path.length >= 3 ? 'Z' : '');
      s.append(mk('path', { d, fill: DRAW.closed ? 'rgba(255,38,179,0.08)' : 'none', stroke: casing, 'stroke-width': 4, 'stroke-linejoin': 'round' }),
        mk('path', { d, fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round' }));
    }
    pts.forEach((p, i) => s.append(mk('circle', { cx: p[0], cy: p[1], r: i === 0 ? 5 : 3.5, fill: i === 0 ? '#fff' : ink, stroke: casing, 'stroke-width': 1.5 })));
    return;
  }
  // edit: the edges, then a square per vertex and a small circle per edge midpoint
  for (const h of editHandles()) {
    if (h.kind === 'edge') s.append(mk('line', { x1: h.a[0], y1: h.a[1], x2: h.b[0], y2: h.b[1], stroke: ink, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
  }
  for (const h of editHandles()) {
    if (h.kind === 'mid') s.append(mk('circle', { cx: h.c[0], cy: h.c[1], r: 3, fill: '#fff', stroke: ink, 'stroke-width': 1.2 }));
    else if (h.kind === 'vertex') {
      const on = DRAW.picked && DRAW.picked.fi === h.fi && DRAW.picked.ri === h.ri && DRAW.picked.vi === h.vi;
      s.append(mk('rect', { x: h.c[0] - 4, y: h.c[1] - 4, width: 8, height: 8, fill: on ? '#ffd94d' : ink, stroke: casing, 'stroke-width': 1.2 }));
    }
  }
}
FRAME_DRAWERS.push(drawPolyOverlay);

// edit handles in CSS px: vertices, edge midpoints, and the edges themselves (for the outline)
function editHandles() {
  const L = DRAW.L, d = featureDocOf(L);
  if (!d) return [];
  const sel = L._selMask && L._selCount ? L._selMask : null;
  const out = [];
  d.features.forEach((f, fi) => {
    if (sel && !sel[fi]) return;
    f.rings.forEach((r, ri) => {
      const m = f.closed ? r.length : r.length - 1;
      const cs = r.map((p, vi) => {
        const dragged = DRAW.drag && DRAW.drag.fi === fi && DRAW.drag.ri === ri && DRAW.drag.vi === vi;
        return cssOf(dragged ? DRAW.drag.to : p);
      });
      for (let i = 0; i < m; i++) {
        const a = cs[i], b = cs[(i + 1) % r.length];
        if (!a || !b) continue;
        out.push({ kind: 'edge', fi, ri, vi: i, a, b });
        out.push({ kind: 'mid', fi, ri, vi: i, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
      }
      cs.forEach((c, vi) => { if (c) out.push({ kind: 'vertex', fi, ri, vi, c }); });
    });
  });
  return out;
}
function hitHandle(x, y) {
  let best = null, bd = HANDLE_PX;
  for (const h of editHandles()) {
    if (h.kind === 'edge') continue;
    const dd = Math.hypot(h.c[0] - x, h.c[1] - y) - (h.kind === 'vertex' ? 0.5 : 0);   // a vertex wins a tie
    if (dd < bd) { bd = dd; best = h; }
  }
  return best;
}

// ── arming ──────────────────────────────────────────────────────────────────────────────────
// opts: { into: layer to add to, closed: polygon (true) or line (false) }
export function armDraw({ into = null, closed = true } = {}) {
  if (!S.frame) { $('#meta').textContent = 'draw: open some data first — a polygon is drawn over what is on the view'; return false; }
  installInput();
  disarmPoly(true);
  const L0 = S.layers.find((l) => l.id === S.activeId);
  const target = into || (isPolygonLayer(L0) && featureDocOf(L0).source.format === 'drawn' ? L0 : null);
  Object.assign(DRAW, { mode: 'draw', L: target, closed: !!closed, pts: [], z: drawZ(), mouse: null, drag: null, picked: null, draftId: DRAW.draftId + 1 });
  S.cv.style.cursor = 'crosshair';
  $('#meta').textContent = `draw ${closed ? 'polygon' : 'line'}${target ? ` into “${target.label || target.name}”` : ''} — click vertices (z ${+DRAW.z.toFixed(2)}); ${closed ? 'click the first vertex, double-click or Enter closes' : 'double-click or Enter ends'}; Backspace takes one back; Esc stops`;
  requestRender();
  return true;
}
export function armEditVertices(L) {
  if (!isPolygonLayer(L)) { $('#meta').textContent = 'edit vertices: pick a strings & polygons layer'; return false; }
  const d = featureDocOf(L), sel = L._selMask && L._selCount ? L._selMask : null;
  let n = 0; d.features.forEach((f, i) => { if (!sel || sel[i]) for (const r of f.rings) n += r.length; });
  if (n > EDIT_MAX) { $('#meta').textContent = `edit vertices: ${n.toLocaleString()} vertices — select the features to edit first (at most ${EDIT_MAX.toLocaleString()})`; return false; }
  installInput();
  disarmPoly(true);
  Object.assign(DRAW, { mode: 'edit', L, pts: [], mouse: null, drag: null, picked: null });
  setActiveLayer(L.id);
  $('#meta').textContent = `edit vertices of “${L.label || L.name}”${sel ? ' (the selected features)' : ''} — drag a vertex; drag a midpoint to add one; Alt-click or Delete removes; Enter / Esc ends`;
  requestRender();
  return true;
}
export function disarmPoly(quiet = false) {
  const was = DRAW.mode;
  Object.assign(DRAW, { mode: null, L: null, pts: [], mouse: null, drag: null, picked: null });
  if (S.cv) S.cv.style.cursor = '';
  drawPolyOverlay();
  if (was && !quiet) $('#meta').textContent = was === 'draw' ? 'draw: stopped' : 'edit vertices: done';
  requestRender();
}
// Ctrl+Z while drawing: the last vertex (src/keyboard.js asks first)
export function polyDraftUndo() {
  if (DRAW.mode !== 'draw' || !DRAW.pts.length) return false;
  DRAW.pts.pop(); requestRender(); drawPolyOverlay();
  return true;
}

// ── drawing ─────────────────────────────────────────────────────────────────────────────────
export function addDraftVertex(cssX, cssY, { free = false } = {}) {
  if (DRAW.mode !== 'draw') return null;
  // the first vertex again closes the polygon
  if (DRAW.closed && DRAW.pts.length >= 3) { const c = cssOf(DRAW.pts[0]); if (c && Math.hypot(c[0] - cssX, c[1] - cssY) <= SNAP_PX) { finishDraw(); return 'closed'; } }
  const p = (!free && snapTo(cssX, cssY)) || worldAt(cssX, cssY, DRAW.z);
  if (!p) { $('#meta').textContent = 'draw: this view looks along the drawing plane — turn to plan (or any view that sees the ground)'; return null; }
  DRAW.pts.push(p);
  requestRender(); drawPolyOverlay();
  return p;
}
const parseAttrs = (s) => {
  const out = {};
  for (const part of String(s || '').split(/[,;]/)) { const k = part.indexOf('='); if (k > 0) { const key = part.slice(0, k).trim(), v = part.slice(k + 1).trim(); if (key) out[key] = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) ? +v : v; } }
  return out;
};
let _drawnN = 0;
// finish the draft → a feature (name + attributes asked unless given)
export async function finishDraw({ name = null, attrs = null } = {}) {
  if (DRAW.mode !== 'draw') return null;
  const pts = DRAW.pts.slice();
  if (pts.length < (DRAW.closed ? 3 : 2)) { $('#meta').textContent = `draw: a ${DRAW.closed ? 'polygon needs 3' : 'line needs 2'} vertices`; return null; }
  const closed = DRAW.closed, into = DRAW.L, draftId = DRAW.draftId;
  if (name == null) {
    name = await microPrompt(`name of the new ${closed ? 'polygon' : 'line'}`, `${closed ? 'polygon' : 'line'} ${(into ? featureDocOf(into).features.length : 0) + 1}`);
    if (name == null) return null;                          // cancelled: keep drawing
    if (attrs == null) { const a = await microPrompt('attributes (optional) — e.g. code=OB1, bench=850', ''); attrs = a == null ? {} : parseAttrs(a); }
  }
  if (DRAW.draftId !== draftId) return null;
  attrs = attrs || {};
  const feature = { id: null, kind: closed ? 'polygon' : 'line', rings: [pts], parts: [[0]], closed };
  let L = into && layerById(into.id);
  if (L && isPolygonLayer(L)) {
    editFeatures(L, `draw ${closed ? 'polygon' : 'line'}`, (d) => {
      const want = ['NAME', ...Object.keys(attrs)];
      for (const c of want) if (!d.header.columns.includes(c)) { d.header.columns.push(c); for (const r of d.rows) r.push(''); }
      feature.id = d.features.length + 1;
      d.features.push(feature);
      d.rows.push(d.header.columns.map((c) => (c === 'NAME' ? name : attrs[c] !== undefined ? attrs[c] : '')));
    });
  } else {
    const columns = ['NAME', ...Object.keys(attrs)];
    feature.id = 1;
    L = newFeatureLayer(`drawn polygons${++_drawnN > 1 ? ' ' + _drawnN : ''}`, { format: 'drawn', features: [feature], columns, rows: [columns.map((c) => (c === 'NAME' ? name : attrs[c]))], crs: null, warnings: [] }, { source: 'drawn' });
  }
  // keep drawing into the same layer: a fresh draft
  Object.assign(DRAW, { mode: 'draw', L, pts: [], mouse: null, draftId: DRAW.draftId + 1 });
  $('#meta').textContent = `“${name}” added to ${L.label || L.name} — draw the next one, or Esc`;
  requestRender(); drawPolyOverlay();
  return L;
}

// ── editing ─────────────────────────────────────────────────────────────────────────────────
export function moveVertex(L, fi, ri, vi, x, y) {
  return editFeatures(L, 'move vertex', (d) => { const p = d.features[fi].rings[ri][vi]; p[0] = x; p[1] = y; });
}
export function insertVertex(L, fi, ri, after, x, y) {
  return editFeatures(L, 'insert vertex', (d) => { const r = d.features[fi].rings[ri], a = r[after], b = r[(after + 1) % r.length]; r.splice(after + 1, 0, [x, y, (a[2] + b[2]) / 2]); });
}
export function deleteVertex(L, fi, ri, vi) {
  const d = featureDocOf(L), f = d && d.features[fi];
  if (!f) return false;
  if (f.rings[ri].length <= (f.closed ? 3 : 2)) { $('#meta').textContent = `edit: a ${f.closed ? 'polygon ring keeps 3' : 'line keeps 2'} vertices at least`; return false; }
  return editFeatures(L, 'delete vertex', (dd) => { dd.features[fi].rings[ri].splice(vi, 1); });
}

// ── input ───────────────────────────────────────────────────────────────────────────────────
function installInput() {
  const cv = S.cv;
  if (!cv || cv._polyInput) return;
  cv._polyInput = true;
  const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => {
    if (!DRAW.mode || e.button !== 0) return;
    const [x, y] = rel(e);
    if (DRAW.mode === 'draw') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.detail >= 2) { finishDraw(); return; }           // a double-click: the second click doesn't add a vertex
      addDraftVertex(x, y, { free: e.altKey });
      return;
    }
    const h = hitHandle(x, y);
    if (!h) return;                                          // not on a handle: the view orbits as usual
    e.stopImmediatePropagation(); e.preventDefault();
    const L = DRAW.L;
    if (h.kind === 'vertex' && e.altKey) { deleteVertex(L, h.fi, h.ri, h.vi); DRAW.picked = null; drawPolyOverlay(); return; }
    let start = h;
    if (h.kind === 'mid') {                                  // a midpoint: insert there, then drag the new vertex
      const r = featureDocOf(L).features[h.fi].rings[h.ri], a = r[h.vi], b = r[(h.vi + 1) % r.length];
      insertVertex(L, h.fi, h.ri, h.vi, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      start = { kind: 'vertex', fi: h.fi, ri: h.ri, vi: h.vi + 1 };
    }
    DRAW.picked = { fi: start.fi, ri: start.ri, vi: start.vi };
    const p0 = featureDocOf(L).features[start.fi].rings[start.ri][start.vi];
    DRAW.drag = { ...DRAW.picked, to: p0.slice(), moved: false, x0: x, y0: y };
    const move = (ev) => {
      if (!DRAW.drag) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const [mx, my] = rel(ev);
      if (Math.hypot(mx - DRAW.drag.x0, my - DRAW.drag.y0) < 2 && !DRAW.drag.moved) return;
      DRAW.drag.moved = true;
      const w = (!ev.altKey && snapExcept(mx, my, DRAW.drag)) || worldAt(mx, my, p0[2]);
      if (w) DRAW.drag.to = [w[0], w[1], p0[2]];
      drawPolyOverlay();
    };
    const up = () => {
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true);
      const dr = DRAW.drag; DRAW.drag = null;
      if (dr && dr.moved && DRAW.L) moveVertex(DRAW.L, dr.fi, dr.ri, dr.vi, dr.to[0], dr.to[1]);
      drawPolyOverlay();
    };
    addEventListener('pointermove', move, { capture: true, passive: false }); addEventListener('pointerup', up, true);
    drawPolyOverlay();
  }, { capture: true });
  cv.addEventListener('pointermove', (e) => {
    if (DRAW.mode !== 'draw') return;
    const [x, y] = rel(e);
    const sn = !e.altKey && snapTo(x, y);
    DRAW.mouse = sn ? cssOf(sn) : [x, y];
    drawPolyOverlay();
  });
  addEventListener('keydown', (e) => {
    if (!DRAW.mode || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || $('#pmDlg') && $('#pmDlg').classList.contains('show')) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); disarmPoly(); }
    else if (k === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (DRAW.mode === 'draw' && DRAW.pts.length) finishDraw(); else disarmPoly(); }
    else if (DRAW.mode === 'draw' && k === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); polyDraftUndo(); }
    else if (DRAW.mode === 'edit' && (k === 'Delete' || k === 'Backspace') && DRAW.picked) {
      e.preventDefault(); e.stopImmediatePropagation();
      const p = DRAW.picked; DRAW.picked = null; deleteVertex(DRAW.L, p.fi, p.ri, p.vi); drawPolyOverlay();
    }
  }, true);
}
// snapping while dragging a vertex: not to itself
function snapExcept(x, y, dr) {
  const d = featureDocOf(DRAW.L), self = d && d.features[dr.fi].rings[dr.ri][dr.vi];
  const s = snapTo(x, y);
  return s && self && s[0] === self[0] && s[1] === self[1] ? null : s;
}
// the canvas exists once the viewport module has run; the arming functions install it too
setTimeout(installInput, 0);

registerCommands([
  { id: 'poly-draw', group: 'Tools', title: 'Draw polygon…', kw: 'draw digitize polygon limit pit lease blast outline plan sketch new', when: () => !!S.frame, run: () => { armDraw({ closed: true }); } },
  { id: 'poly-draw-line', group: 'Tools', title: 'Draw line…', kw: 'draw digitize line string polyline trace plan sketch', when: () => !!S.frame, run: () => { armDraw({ closed: false }); } },
  { id: 'poly-draw-into', group: 'Tools', title: 'Draw polygon into this layer', kw: 'draw add polygon feature existing layer', when: (c) => isPolygonLayer(c.L), run: (c) => { armDraw({ into: c.L, closed: true }); } },
  { id: 'poly-edit', group: 'Tools', title: 'Edit vertices', kw: 'edit move insert delete vertex vertices polygon line reshape', when: (c) => isPolygonLayer(c.L), run: (c) => { armEditVertices(c.L); } },
]);
contributeMenu('tools', () => (S.frame ? [{ label: 'Draw polygon…', action: () => { armDraw({ closed: true }); } }, { label: 'Draw line…', action: () => { armDraw({ closed: false }); } }] : []));

try { window._microPolyDraw = { DRAW, armDraw, armEditVertices, disarmPoly, addDraftVertex, finishDraw, moveVertex, insertVertex, deleteVertex, worldAt, polyDraftUndo }; } catch { /* headless */ }
