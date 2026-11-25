// micro viewport — the 3D view itself: the renderer + eye-dome lighting + the orbit camera, the
// render loop and its per-frame draw options, view modes (boxes / points, block edges), losing
// and getting back the GPU context, camera directions (setView, glide, pivot), the camera in
// world terms (host API, composer), and the figure canvases rendered to convergence. The
// modules that reach back into the app get their hooks here. Carved from index.html (2026-11-24).
import { createRenderer, createEdl, createOrbitCamera, attachOrbitInput } from '../../../ext/condenser/src/main.js';
import { installLongPress } from './longpress.js';
import { PHI_MAX, setZExag } from './camera.js';
import { projectionStatus, setProjection } from './projection.js';
import { S, requestRender, layerById, FRAME_DRAWERS } from './state.js';
import { setColumnsChangedHook } from './columns.js';
import { fmtSize } from './paths.js';
import { nextZ } from './windows.js';
import { statsScan } from './stats.js';
import { setSeriesHooks } from './section-series.js';
import { recoverSession } from './gpu-restore.js';
import { stereonetFigure } from './structure-ui.js';
import { saveRecipe, routineEval, runRecipe } from './recipes.js';
import { openRoutineWindow } from './routine-ui.js';
import { saveProject } from './project.js';
import { setFigurePdfOpener } from './open.js';
import { syncWholeHoles } from './drillholes.js';
import { resolveColorMode } from './color.js';
import { applyBg, drawDecorations, renderDeco, setDecoHooks } from './deco.js';
import { setOverlayHooks, drawMeasure, drawSectionPlane, drawSwathBand, drawCompass } from './overlay.js';
import { setSettingsHooks, PREFS } from './settings.js';
import { VEC_OUTLINES, _vecOutlines, setVectorOutlines } from './vsection.js';
import { openTurntable, setTurntableHooks } from './turntable.js';
import { openFigurePdf, setComposerHooks } from './composer.js';
import { setLayermenuHooks } from './layermenu.js';
import { setSelectionHooks } from './selection.js';
import { setPaintHooks, addPaintColorOptions } from './paint.js';
import { currentSection } from './section.js';
import { setPickHooks, meshHitAt, pickHitPoint } from './pick.js';
import { SW, initSoftwareMode } from './software-mode.js';
import { swFrameGate, swNextAt } from './swrender.js';
import { registerCommands } from './commands.js';
import { sceneOrigin, worldToLocal, rangeWorldToLocal } from './coords.js';

const $ = (s) => document.querySelector(s);

// src/pick.js reaches back into the app through these
setPickHooks({ get _viewMode() { return _viewMode; } });
// src/paint.js reaches back into the app through these
setPaintHooks({ get _viewMode() { return _viewMode; } });
// src/selection.js reaches back into the app through these
setSelectionHooks({ get _viewMode() { return _viewMode; } });
// src/layermenu.js reaches back into the app through these
setLayermenuHooks({ get _blockEdges() { return _blockEdges; } });
// src/settings.js reaches back into the app through these
setSettingsHooks({ get _blockEdges() { return _blockEdges; }, setBlockEdges });
// src/overlay.js reaches back into the app through these
setOverlayHooks({ get _viewMode() { return _viewMode; } });
export const cv = $('#cv');
export let renderer = createRenderer(cv);
let edl = createEdl(renderer.gl);
export const cam = createOrbitCamera();
S.renderer = renderer;                                     // the long-lived objects go on S: modules read them there
S.cam = cam;
S.cv = cv;
setColumnsChangedHook((L) => addPaintColorOptions(L));     // columns.js → the color-by select tracks the column set
let lastDrawn = 0;
const fpsBuf = [];
initSoftwareMode(renderer.gl);                             // a CPU rasterizer? (src/software-mode.js) — before toolbar.js restores a stored budget
let _lastInteract = -Infinity, _lastChunk = -Infinity, _chunkN = -1, _swNextAt = 0, _swFence = null;   // the software mode's pacing (src/swrender.js)

attachOrbitInput(cv, cam, { onChange: () => { _lastInteract = performance.now(); requestRender(); } });
new ResizeObserver(() => { const [w, h] = renderer.resize(); cam.setAspect(w / h); requestRender(); }).observe(cv);
// touch: a press held still opens the element's context menu (iOS has none of its
// own). Not on the 3D view — a held finger there is the picking loupe's (roadmapped)
installLongPress({ exclude: 'input, textarea, select, [contenteditable], #cv' });
// the GPU context can be taken away (Android does it under memory pressure, or after
// the tab sat in the background). Every layer's GPU copy is gone with it, but the
// session — layers, painted and calculated columns, selections — is plain JS and
// still here. Say so, and offer the two safe exits instead of a silent black view.
// When the context comes back, the view is rebuilt from the sources
// (src/gpu-restore.js: the session saved into an in-memory folder and reopened on
// a fresh renderer). Until then the bar offers the two safe exits.
export function recreateRenderer() {
  renderer = createRenderer(cv);
  edl = createEdl(renderer.gl);
  _swFence = null;                                         // a fence of the lost context means nothing now
  S.renderer = renderer;
  if (window._micro) window._micro.renderer = renderer;
  renderer.setMaxPixelRatio(document.body.classList.contains('mobile') ? 2 : Infinity);
  renderer.setLightweight(SW.on);                          // a software rasterizer: the heavy optional passes stand down
  { const [w, h] = renderer.resize(); cam.setAspect(w / h); }
  applyBg();
  requestRender();
}
let _recovering = false;
cv.addEventListener('webglcontextrestored', async () => {
  const bar = $('#glLost'), msg = bar && bar.querySelector('span');
  _recovering = true;
  try {
    await recoverSession({ recreate: recreateRenderer }, { onStatus: (t) => { if (msg) msg.textContent = t; } });
    if (bar) bar.remove();
  } catch (err) { if (msg) msg.textContent = 'The graphics came back but the view could not be rebuilt — ' + err.message + '. Save the project, then reload.'; }
  finally { _recovering = false; S.dirty = true; requestRender(); }
});
cv.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                                      // lets the browser hand a context back
  let bar = $('#glLost');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'glLost'; bar.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    msg.textContent = 'The system reset the 3D graphics. Your layers and columns are still here — micro rebuilds the view when the graphics come back (or save the project, then reload).';
    const save = document.createElement('button'); save.textContent = 'save project';
    save.onclick = () => saveProject().catch((err) => { msg.textContent = 'save failed — ' + err.message; });
    const reload = document.createElement('button'); reload.textContent = 'reload';
    reload.onclick = () => location.reload();
    bar.append(msg, save, reload); document.body.appendChild(bar);
  }
  bar.style.zIndex = nextZ();
});

let converged = true;
export let _viewMode = 'boxes';                                   // boxes = impostors · points = fixed splats (View menu)
export function setViewMode(m) { _viewMode = m; requestRender(); }
export let _blockEdges = (() => { try { return localStorage.getItem('micro.edges') === '1'; } catch { return false; } })();   // block edge lines (View toggle)
export function setBlockEdges(on) { _blockEdges = !!on; try { localStorage.setItem('micro.edges', on ? '1' : '0'); } catch { /* private */ } requestRender(); }
// the per-frame draw options (budget, point size, colour modes, per-layer clip/
// colour, section, clip). Shared by the render loop and figure export so a
// supersample export renders the scene identically.
function currentDrawOpts() {
  const clipV = (id) => { const v = $('#' + id).value.trim(); return v === '' ? null : +v; };
  const clipOf = (L) => { const c = [L.clip[0].trim(), L.clip[1].trim()]; return [c[0] === '' ? null : +c[0], c[1] === '' ? null : +c[1]]; };
  const modeOf = (v) => (v === 'elev' ? 0 : v && v.startsWith('chan:') ? 1 : v === 'cat' || v === 'rules' || (v && (v.startsWith('paint:') || v.startsWith('calc:'))) ? 2 : v === 'solid' ? 3 : +v || 0);
  // an ELEVATION clip is typed (and legended, and reported to a host) in real z; the renderer
  // compares it with frame-LOCAL z — convert here, the one place the two meet (sweep 2026-11-25:
  // a 500–900 clip on the demo, frame z 648, drew the whole model as the ramp's bottom colour)
  const forRenderer = (mode, c) => (mode === 0 ? rangeWorldToLocal(c, 2) : c);
  const layerOpts = {};
  for (const L of S.layers) { const mode = L.id === S.activeId ? resolveColorMode() : modeOf(L.colorSel); layerOpts[L.id] = { colorMode: mode, clip: forRenderer(mode, L.id === S.activeId ? [clipV('clipMin'), clipV('clipMax')] : clipOf(L)) }; };
  const section = currentSection();
  syncWholeHoles(section);                                 // whole-holes layers: which holes cross the slab (cheap unless it moved)
  return { budget: +$('#budget').value, pointPx: +$('#ptPx').value, colorMode: resolveColorMode(), blocksAsPoints: _viewMode === 'points', blockEdges: _blockEdges, section, clip: forRenderer(resolveColorMode(), [clipV('clipMin'), clipV('clipMax')]), layerOpts: S.layers.length ? layerOpts : null, projection: S.projection };
}
// eye-dome lighting reads depth — under a projection (src/projection.js) depth means nothing, so it's off
function edlEnabled() {
  return $('#edlOn').checked && !S.projection;
}
// AMBIENT OCCLUSION (Settings → display): a soft shade where surfaces meet at an angle — inner
// corners, the foot of a pit wall, between benches (condenser edl.js, the same pass as EDL). A
// machine preference, off by default; off under a projection (no depth) and in software rendering
export const AO_LEVELS = [['off', 'off'], ['0.5', 'soft'], ['1', 'medium'], ['1.6', 'strong']];
let _ao = (() => { try { const v = localStorage.getItem('micro.ao'); return AO_LEVELS.some(([k]) => k === v) ? v : 'off'; } catch { return 'off'; } })();
export function setAmbientOcclusion(v) {
  _ao = AO_LEVELS.some(([k]) => k === String(v)) ? String(v) : 'off';
  try { if (_ao === 'off') localStorage.removeItem('micro.ao'); else localStorage.setItem('micro.ao', _ao); } catch { /* private */ }
  requestRender();
}
export const ambientOcclusion = () => _ao;
const aoStrength = () => (_ao === 'off' || SW.on || S.projection ? 0 : +_ao);
// the EDL + AO options at a pixel scale s (a figure renders bigger: the radii grow with it)
const postOpts = (s = 1) => ({ enabled: edlEnabled(), strength: +$('#edlStr').value, radius: 1.4 * s, ao: aoStrength(), aoRadius: 9 * s * Math.min(2, window.devicePixelRatio || 1) });
// display preferences owned here and beside (Settings → display renders the rows)
{
  const at = PREFS.findIndex((p) => p.label === 'block edges') + 1 || PREFS.length;
  PREFS.splice(at, 0,
    { sec: 'display', label: 'ambient occlusion', desc: 'a soft shade where surfaces meet at an angle — inner corners, the foot of a pit wall, between benches; mostly for figures. Off under a projection and in software rendering', kind: 'choice', opts: AO_LEVELS, get: () => _ao, set: (v) => setAmbientOcclusion(v) },
    { sec: 'display', label: 'vector-section outlines', desc: 'a composer vector section draws colour regions (none) — or every block’s cut outlined in ink (sub-blocks), or each parent block’s (parents); outlines add cells, so a large section may then be too many for vectors', kind: 'choice', opts: VEC_OUTLINES.map((v) => [v, v]), get: () => _vecOutlines, set: (v) => setVectorOutlines(v) });
}
let _idleCapDone = false;
function loop(t) {
  if (renderer.gl.isContextLost() || _recovering) { requestAnimationFrame(loop); return; }   // nothing to draw on until the view is rebuilt (gpu-restore)
  let swWait = false;
  if (SW.on) {                                             // software rendering: draw on change, converge lazily, never while data arrives
    const now = performance.now(), n = renderer.chunkCount;
    if (n !== _chunkN) { _chunkN = n; _lastChunk = now; }
    if (_swFence && renderer.gl.getSyncParameter(_swFence.sync, renderer.gl.SYNC_STATUS) === renderer.gl.SIGNALED) {   // the last frame is rasterized: rest in proportion to what it cost
      renderer.gl.deleteSync(_swFence.sync);
      _swNextAt = swNextAt({ done: now, cost: now - _swFence.at, lastInteract: _lastInteract, lastChunk: _lastChunk });
      _swFence = null;
    }
    swWait = swFrameGate({ now, dirty: S.dirty, converged, pending: !!_swFence, lastInteract: _lastInteract, lastChunk: _lastChunk, nextAt: _swNextAt }) === 'wait';
  }
  if (swWait) { /* owed, not yet — the next frame asks again */ }
  else if (S.dirty || !converged) {                        // keep converging while still (progressive accumulation)
    S.dirty = false; _idleCapDone = false;                 // (a drawn frame may have moved the camera: re-check the capture)
    const [w, h] = renderer.resize();
    cam.setAspect(w / h);
    const opts = currentDrawOpts();
    const t0 = performance.now();
    const r = edl.render(w, h, cam, () => renderer.draw(cam, opts), postOpts());
    converged = r.converged;
    fpsBuf.push(performance.now() - t0); if (fpsBuf.length > 30) fpsBuf.shift();
    const ms = fpsBuf.reduce((a, b) => a + b, 0) / fpsBuf.length;
    const total = renderer.elementCount, acc = renderer.accumulated;
    const vram = renderer.vramBytes ? ` · vram ${fmtSize(renderer.vramBytes)}` : '';
    const heap = performance.memory ? ` · heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '';
    $('#stats').textContent = `${SW.on ? 'software · ' : ''}${projectionStatus(r)}${total.toLocaleString()} pts · ${renderer.chunkCount} chunks (${r.visible} vis) · ${converged ? `converged ${acc.toLocaleString()}` : `accumulating ${(100 * acc / (total || 1)).toFixed(0)}%`} · ${ms.toFixed(1)} ms${vram}${heap}`;
    drawMeasure();                                         // the overlay rides the camera
    drawSectionPlane();
    drawSwathBand();                                       // the swath hover/drag band ghost
    drawCompass();
    drawDecorations();                                     // scale bar / north / legend / title overlay
    for (const f of FRAME_DRAWERS) { try { f(); } catch (e) { console.warn('overlay:', e); } }   // e.g. the polygon draw/edit tool (src/poly-draw.js)
    if (SW.on && !_swFence) { const sync = renderer.gl.fenceSync(renderer.gl.SYNC_GPU_COMMANDS_COMPLETE, 0); if (sync) _swFence = { sync, at: t0 }; }
  } else if (!_idleCapDone && !SW.on) {                    // still and converged: build the pick buffer, a batch a frame
    // (not in software mode: there a click renders its own pixel instead)
    const o = currentDrawOpts();
    try { _idleCapDone = renderer.idleCapture(cam, { pointPx: o.pointPx, blocksAsPoints: o.blocksAsPoints, section: o.section, budget: o.budget }); }
    catch (e) { _idleCapDone = true; console.warn('pick capture:', e); }   // never let idle work stop the render loop
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
drawCompass();

// camera: look = the compass bearing you LOOK toward (0 = north, 90 = east),
// elevation = how far above the target the eye sits (90 = plan, looking down)
const R2D = 180 / Math.PI;
export function cameraWorld() {
  const st = cam.state, o = sceneOrigin();
  const look = ((Math.atan2(-Math.cos(st.theta), -Math.sin(st.theta)) * R2D) % 360 + 360) % 360;
  return { target: [st.target[0] + o[0], st.target[1] + o[1], st.target[2] + o[2]], look, elevation: st.phi * R2D, distance: st.radius, ortho: !!st.ortho, zExag: st.zExag || 1, projection: S.projection || null };
}
export function setCameraWorld(v = {}) {
  const st = cam.state, o = sceneOrigin();
  const num = (x, what) => { const n = +x; if (!Number.isFinite(n)) throw new Error(`view: ${what} must be a number`); return n; };
  if (v.target != null) {
    const t = [].concat(v.target).map(Number);
    if (t.length !== 3 || t.some((c) => !Number.isFinite(c))) throw new Error('view: target must be [x, y, z]');
    st.target = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  }
  if (v.look != null) { const b = num(v.look, 'look') / R2D; st.theta = Math.atan2(-Math.cos(b), -Math.sin(b)); }
  if (v.elevation != null) st.phi = Math.max(-PHI_MAX, Math.min(PHI_MAX, num(v.elevation, 'elevation') / R2D));
  if (v.distance != null) { const dd = num(v.distance, 'distance'); if (!(dd > 0)) throw new Error('view: distance must be positive'); st.radius = dd; }
  if (v.ortho != null) cam.setOrtho(!!v.ortho);
  if (v.zExag != null) setZExag(num(v.zExag, 'zExag'));
  if (v.projection !== undefined) {
    if (v.projection != null && !['max', 'min', 'mean'].includes(v.projection)) throw new Error('view: projection is max, min, mean or null');
    if (!setProjection(v.projection, { quiet: true })) throw new Error(`view: the ${v.projection} projection isn't offered by this GPU`);
  }
  cam.update(); requestRender();
  return cameraWorld();
}
// a figure as a canvas: rendered to CONVERGENCE (the interactive canvas may be
// mid-accumulation), decorations on top unless asked not to. Scale 1–4.
export function renderFigureCanvas(scale = 1, { decorations = true } = {}) {
  scale = Math.max(1, Math.min(4, (scale | 0) || 1));
  const r = cv.getBoundingClientRect();
  const bw = cv.width, bh = cv.height, tw = bw * scale, th = bh * scale;
  const opts = currentDrawOpts(); opts.pointPx = opts.pointPx * scale;
  const edlOpts = postOpts(scale);
  if (scale !== 1) cv.width = tw, cv.height = th;
  renderer.invalidate();
  let res, guard = 0;
  do { res = edl.render(tw, th, cam, () => renderer.draw(cam, opts), edlOpts); guard++; } while (!res.converged && guard < 4000);
  const out = document.createElement('canvas'); out.width = tw; out.height = th;
  const g = out.getContext('2d'); g.drawImage(cv, 0, 0);
  if (decorations) { const sx = tw / r.width; g.setTransform(sx, 0, 0, sx, 0, 0); renderDeco(g, r.width, r.height); }
  if (scale !== 1) { cv.width = bw; cv.height = bh; }
  renderer.invalidate(); requestRender();
  return out;
}
// a picture of the current view at an exact pixel size AND aspect (a composer frame), rendered
// to convergence; points and the EDL radius scale with the output so the picture reads as the
// screen does. The canvas and the camera's aspect go back after.
export function renderViewCanvas(pw, ph) {
  pw = Math.max(16, Math.min(8192, Math.round(pw))); ph = Math.max(16, Math.min(8192, Math.round(ph)));
  const bw = cv.width, bh = cv.height, s = Math.max(1, ph / Math.max(1, bh));
  const opts = currentDrawOpts(); opts.pointPx = opts.pointPx * s;
  const edlOpts = postOpts(s);
  cv.width = pw; cv.height = ph; cam.setAspect(pw / ph);
  renderer.invalidate();
  let res, guard = 0;
  try {
    do { res = edl.render(pw, ph, cam, () => renderer.draw(cam, opts), edlOpts); guard++; } while (!res.converged && guard < 4000);
    const out = document.createElement('canvas'); out.width = pw; out.height = ph;
    out.getContext('2d').drawImage(cv, 0, 0);
    out._viewProj = Array.from(cam.state.viewProj);          // at THIS aspect: the composer's frame knows its projection
    return out;
  } finally {
    cv.width = bw; cv.height = bh; cam.setAspect(bw / bh);
    renderer.invalidate(); requestRender();
  }
}

// src/deco.js reaches back into the app through these
setDecoHooks({ renderFigureCanvas, openTurntable });
setTurntableHooks({ renderFigureCanvas });
setFigurePdfOpener(openFigurePdf);
setComposerHooks({ renderViewCanvas, setCameraWorld, saveRecipe, openRoutineWindow, cameraWorld, statsScan, evalField: routineEval, runRecipe, stereonetFigure });
setSeriesHooks({ renderFigureCanvas });

applyBg();                                                 // restore the saved background at boot

// view directions: keep target + radius, set azimuth/elevation. Mining reading:
// n = LOOKING north (camera south of target), level view; d = plan (down); u = up.
export function setView(theta, phi) {
  const st = cam.state;
  st.theta = theta; st.phi = phi;
  cam.update(); requestRender();
}
// orbit about a picked spot: the target GLIDES there (a short eased pan — same angle, same
// distance), so the spot comes to the centre without the view jumping
let _glideRaf = 0;
function glideTarget(to, ms = 260) {
  const st = cam.state, from = st.target.slice(), t0 = performance.now();
  cancelAnimationFrame(_glideRaf);
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms), ease = 1 - (1 - k) ** 3;
    st.target = from.map((v, i) => v + (to[i] - v) * ease);
    cam.update(); requestRender();
    if (k < 1) _glideRaf = requestAnimationFrame(step);
  };
  step();
}
export async function pivotOn(hit, cssX, cssY) {
  const L = layerById(hit.layer);
  const w = L && L.kind === 'mesh' ? ((await meshHitAt(L, cssX, cssY)) || {}).drawn : await pickHitPoint(hit, cssX, cssY);   // pivot on what is DRAWN
  if (!w || !S.frame) return;
  glideTarget(worldToLocal(w));
  $('#meta').textContent = 'orbiting about the tapped spot — double-tap empty space to fit';
}

registerCommands([
  { id: 'ao-on', group: 'View', title: 'Ambient occlusion: on', kw: 'ssao shading corners creases benches figure quality depth shade', when: () => _ao === 'off', run: () => setAmbientOcclusion('1') },
  { id: 'ao-off', group: 'View', title: 'Ambient occlusion: off', kw: 'ssao shading', when: () => _ao !== 'off', run: () => setAmbientOcclusion('off') },
]);
try { window._microVis = Object.assign(window._microVis || {}, { setAmbientOcclusion, ambientOcclusion }); } catch { /* headless */ }
