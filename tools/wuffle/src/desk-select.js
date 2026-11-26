// wuffle desk — the selection tools on a net: pick (a click, the net's own), LASSO, CONE and BAND. The shapes
// are drawn in ATTITUDE space (@gcu/stereonet's select.js): a lasso is a spherical polygon, a cone an axis
// and an angle, a band a great circle and a half-width — so a selection keeps meaning the same measurements
// when the net rotates. A gesture selects in every visible layer on that net; the selection is the data's
// (it shows on every net and in the table). ⇧ adds, ⌥/Alt subtracts. The last shape stays drawn, dashed,
// until another gesture or Esc.

import { rowsInShape, shapeOutline, greatCircleThrough, axialAngle } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';

export const TOOLS = [['pick', 'pick', 'click a measurement (⇧ adds, Ctrl toggles)'], ['lasso', 'lasso', 'draw round measurements'],
  ['cone', 'cone', 'drag from an axis: everything within that angle'], ['band', 'band', 'drag along a great circle: everything within the band']];
const NS = 'http://www.w3.org/2000/svg';

// bearing's net.unproject returns a WORLD direction (its doc says so: it undoes the net's rotation itself),
// so a picked direction is used as it comes. Guarded by the desk smoke's rotated-net check, which caught a
// second rotation here.

export function createSelectTools({ project: p, onStatus = () => {} }) {
  let tool = 'pick', bandWidth = 10;
  const views = new Set(), shapes = new Map();   // view → the last shape drawn on it
  const bars = new Set();

  const pathOf = (view, pts) => {
    let d = '', prev = null;
    for (const v of pts) {
      const q = view.net.project(v);
      // a jump across the net (the outline passing the primitive) starts a new piece
      const jump = prev && Math.hypot(q.x - prev.x, q.y - prev.y) > view.net.size * 0.4;
      d += `${!prev || jump ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; prev = q;
    }
    return d;
  };
  const drawShape = (view, shape, live = false) => {
    const svg = view.stage.querySelector('svg'); if (!svg || !view.net) return;
    svg.querySelector('.wsel-shapes')?.remove();
    if (!shape) return;
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'wsel-shapes');
    for (const ring of shapeOutline(shape)) { const path = document.createElementNS(NS, 'path'); path.setAttribute('class', `wsel-shape${live ? ' live' : ''}`); path.setAttribute('d', pathOf(view, ring)); g.append(path); }
    svg.append(g);
  };
  const drawLasso = (view, svgPts) => {
    const svg = view.stage.querySelector('svg'); if (!svg) return;
    svg.querySelector('.wsel-shapes')?.remove();
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'wsel-shapes');
    const path = document.createElementNS(NS, 'path'); path.setAttribute('class', 'wsel-shape live');
    path.setAttribute('d', svgPts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('') + 'Z');
    g.append(path); svg.append(g);
  };

  /** apply a shape on a view: rows inside, per dataset, in every visible layer there */
  const apply = (view, shape, mode) => {
    const per = new Map();   // datasetId → rows (union over that dataset's layers on this net)
    for (const L of sceneLayers(p, view.id)) {
      if (L.visible === false) continue;
      const rows = rowsInShape(L.data, shape), s = per.get(L.datasetId) || new Set();
      for (const r of rows) s.add(r); per.set(L.datasetId, s);
    }
    let n = 0, of = 0;
    for (const [ds, rows] of per) {
      p.select(ds, [...rows], mode); n += rows.size; of += p.dataset(ds).rows.length;
    }
    shapes.set(view, shape);
    drawShape(view, shape);
    onStatus(`${shape.type}: ${n} of ${of} measurement${of === 1 ? '' : 's'}${mode === 'add' ? ' added' : mode === 'subtract' ? ' removed' : ''}`);
    return n;
  };
  const modeOf = (e) => (e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');

  function attach(view) {
    views.add(view);
    // the strip of tools
    const bar = document.createElement('div'); bar.className = 'wsel-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'selection tools');
    for (const [id, label, title] of TOOLS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.dataset.tool = id;
      b.onclick = () => setTool(id); bar.append(b);
    }
    const wl = document.createElement('label'); wl.title = 'the band\'s half-width, degrees';
    const wi = document.createElement('input'); wi.type = 'number'; wi.min = 1; wi.max = 45; wi.step = 1; wi.value = bandWidth; wi.dataset.role = 'bandwidth';
    wi.onchange = () => { bandWidth = Math.max(1, Math.min(45, +wi.value || 10)); for (const b of bars) b.querySelector('[data-role=bandwidth]').value = bandWidth; };
    wl.append('±', wi, '°'); bar.append(wl);
    view.el.append(bar); bars.add(bar);
    refreshBars();
    view.drawn.add((v) => drawShape(v, shapes.get(v)));   // the last shape survives redraws

    // the gestures
    let drag = null;
    const dirAt = (e) => { const q = view.svgPoint(e); if (!q) return null; const d = view.net.unproject(q.x, q.y); return d ? { q, d } : null; };
    view.stage.addEventListener('pointerdown', (e) => {
      if (tool === 'pick' || e.button !== 0 || !view.net) return;
      const a = dirAt(e); if (!a) return;
      e.preventDefault(); view.stage.setPointerCapture(e.pointerId);
      drag = { a, pts: [a], svg: [a.q], mode: modeOf(e) };
      p.setActive(view.id);
    });
    view.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const b = dirAt(e); if (!b) return;
      if (tool === 'lasso') {
        const last = drag.svg[drag.svg.length - 1];
        if (Math.hypot(b.q.x - last.x, b.q.y - last.y) < 3 * b.q.scale) return;
        drag.pts.push(b); drag.svg.push(b.q); drawLasso(view, drag.svg);
      } else if (tool === 'cone') {
        drag.shape = { type: 'cone', axis: drag.a.d, angle: axialAngle(drag.a.d, b.d) }; drawShape(view, drag.shape, true);
        onStatus(`cone: ${drag.shape.angle.toFixed(1)}° about the axis`);
      } else if (tool === 'band') {
        const pole = greatCircleThrough(drag.a.d, b.d);
        if (pole) { drag.shape = { type: 'band', pole, width: bandWidth }; drawShape(view, drag.shape, true); }
      }
    });
    view.stage.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      try { view.stage.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const shape = tool === 'lasso' ? (d.pts.length >= 3 ? { type: 'polygon', vertices: d.pts.map((x) => x.d) } : null) : d.shape;
      if (!shape || (shape.type === 'cone' && shape.angle < 0.2)) { drawShape(view, shapes.get(view)); return; }
      apply(view, shape, d.mode);
    });
    // a gesture is not a click: keep the net's own pick from firing after one
    view.stage.addEventListener('click', (e) => { if (tool !== 'pick') { e.stopImmediatePropagation(); } }, true);
  }

  function refreshBars() {
    for (const bar of bars) {
      for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
      bar.querySelector('label').hidden = tool !== 'band';
    }
    for (const v of views) v.stage.style.cursor = tool === 'pick' ? '' : 'crosshair';
  }
  function setTool(t) { tool = t; refreshBars(); }
  function clearShapes() { shapes.clear(); for (const v of views) drawShape(v, null); }
  function detach(view) { views.delete(view); shapes.delete(view); }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('desk')) clearShapes(); });

  return { attach, detach, setTool, get tool() { return tool; }, apply, clearShapes, setBandWidth: (w) => { bandWidth = w; }, shapeOf: (v) => shapes.get(v) || null };
}
