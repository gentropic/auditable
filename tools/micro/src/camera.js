// micro's camera in WORLD terms. The orbit camera itself is @gcu/condenser's
// (S.cam, made by the app at load) and works in frame-local coordinates; a
// bookmark, a scene, a project and a figure recipe all keep a view in world
// coordinates, so it survives a change of frame.
import { S, requestRender } from './state.js';
const $ = (s) => document.querySelector(s);

// how close to straight down / up the orbit may tilt (exactly ±90° loses the azimuth)
export const PHI_MAX = Math.PI / 2 - 0.02;

// the view as plain data: where it looks (world), from how far and which way
export function captureCamera() {
  const st = S.cam.state, o = S.frame ? S.frame.origin : [0, 0, 0];
  return { target: [st.target[0] + o[0], st.target[1] + o[1], st.target[2] + o[2]], radius: st.radius, theta: st.theta, phi: st.phi, ortho: !!st.ortho, zExag: st.zExag || 1 };
}
export function applyCamera(c) {
  if (!c) return;
  const st = S.cam.state, o = S.frame ? S.frame.origin : [0, 0, 0];
  st.target = [c.target[0] - o[0], c.target[1] - o[1], c.target[2] - o[2]];
  st.radius = c.radius; st.theta = c.theta; st.phi = c.phi;
  S.cam.setOrtho(!!c.ortho);
  st.zExag = c.zExag || 1; if ($('#zExag')) $('#zExag').value = st.zExag;   // vertical exaggeration rides with the view (bookmarks/scenes/figure recipes)
  S.cam.update(); requestRender();
}
// vertical exaggeration — a GLOBAL scene z-scale (camera-level, all layers registered)
export function setZExag(v) {
  const s = Math.max(0.1, Math.min(50, +v || 1));
  S.cam.state.zExag = s;
  if ($('#zExag') && +$('#zExag').value !== s) $('#zExag').value = s;
  S.cam.update(); requestRender();
  $('#meta').textContent = s === 1 ? 'vertical exaggeration off (1×)' : `vertical exaggeration ${s}×`;
}

// frame a WORLD point: `r` around it, and never less than `floor` (so radius 0
// is a close look, not a zero-size box)
export function zoomToPoint(p, r, floor = 1) {
  const o = S.frame ? S.frame.origin : [0, 0, 0], h = Math.max(floor, r || 0);
  S.cam.fit([p[0] - o[0] - h, p[1] - o[1] - h, p[2] - o[2] - h, p[0] - o[0] + h, p[1] - o[1] + h, p[2] - o[2] + h]); requestRender();
}
