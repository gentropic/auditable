// wuffle desk — rotating a net by dragging it (bearing's arcball: frame-consistent, no gimbal flip). With
// the pick tool, a drag past a few pixels rotates; a click still picks. The rotation is the diagram's
// (props.matrix, saved with the project), so every layer and the selection shapes turn together; a figure
// made from the net is drawn as rotated. "Reset rotation" (the diagram's menu) or `rotate off` clears it.

import { mat3 } from '../../../ext/bearing/index.js';

export function createRotate({ project: p, isActive = () => true }) {
  function attach(view) {
    let drag = null, raf = 0, swallowUntil = 0;
    // the click a drag may end with is not a pick — but only THAT click: a drag that ends under pointer
    // capture often fires no click at all, and a lingering "swallow the next click" would eat the user's
    // next real one (the desk smoke caught exactly that)
    view.stage.addEventListener('click', (c) => { if (performance.now() < swallowUntil) { c.stopImmediatePropagation(); swallowUntil = 0; } }, { capture: true });
    view.stage.addEventListener('pointerdown', (e) => {
      if (!isActive() || e.button !== 0 || !view.net) return;
      const q = view.svgPoint(e); if (!q) return;
      drag = { x: q.x, y: q.y, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    });
    view.stage.addEventListener('pointermove', (e) => {
      if (!drag || !view.net) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      if (!drag.moved) { drag.moved = true; try { view.stage.setPointerCapture(drag.id); } catch { /* gone */ } }
      const q = view.svgPoint(e); if (!q) return;
      const R0 = view.net.rotation || mat3.identity();
      const R = mat3.orthonormalize(mat3.multiply(view.net.arcball(drag.x, drag.y, q.x, q.y), R0));
      drag.x = q.x; drag.y = q.y;
      view.net.setRotation(R);                                // the next increment starts from here
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => p.setDiagramProps(view.id, { matrix: Array.from(view.net.rotation), rotation: null }));
    });
    const end = (e) => {
      if (!drag) return;
      const moved = drag.moved; drag = null;
      try { view.stage.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (moved) swallowUntil = performance.now() + 250;
    };
    view.stage.addEventListener('pointerup', end);
    view.stage.addEventListener('pointercancel', end);
  }
  return { attach, reset: (id) => p.setDiagramProps(id, { matrix: null, rotation: null }) };
}
