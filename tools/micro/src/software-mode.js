// micro — SOFTWARE-RENDERER MODE. When the 3D view is drawn by a CPU rasterizer (SwiftShader, WARP,
// llvmpipe … — src/swrender.js decides from the GL strings), micro's GPU habits starve the loaders:
// the demo project took 581 s on SwiftShader. In this mode micro
//   · draws ~100k elements a frame instead of 1M (only when the user never chose a budget — a stored
//     micro.budget still wins),
//   · draws ON CHANGE and converges lazily, a throttled frame at a time, never while data is still
//     arriving (the pacing is src/swrender.js swFrameGate; the loop that obeys it is src/viewport.js),
//   · skips the idle pick capture — a click renders its one pixel instead of every idle frame
//     building a full id buffer,
//   · starts with eye-dome lighting off (two more full-screen passes a frame),
//   · stands the heavy optional passes down: ambient occlusion off, a ghost filter's outline drawn
//     as its flat tint (renderer.setLightweight),
// and says so once on the status line. Settings → display → "software rendering" forces it on or
// off (micro.swRender = auto | on | off) — on a GPU machine that is how the mode is tried.
import { S, requestRender } from './state.js';
import { detectSoftwareRenderer, softwareModeOn } from './swrender.js';
import { registerCommands } from './commands.js';
const $ = (s) => document.querySelector(s);

const KEY = 'micro.swRender';
export const SW_BUDGET = '100000';
// what the renderer is (filled by initSoftwareMode) and whether the mode is in force now
export const SW = { detected: false, name: '', renderer: '', on: false };
export let _swPref = (() => { try { const v = localStorage.getItem(KEY); return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; } })();
let _edlOffByUs = false, _budgetByUs = false, _said = false;

function glStrings(gl) {
  try {
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    if (d) return { renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL) || '', vendor: gl.getParameter(d.UNMASKED_VENDOR_WEBGL) || '' };
    return { renderer: gl.getParameter(gl.RENDERER) || '', vendor: gl.getParameter(gl.VENDOR) || '' };   // Firefox: RENDERER is unmasked itself
  } catch { return { renderer: '', vendor: '' }; }
}
const userBudget = () => { try { return localStorage.getItem('micro.budget'); } catch { return null; } };

// once, at boot, with the view's GL context (src/viewport.js). Runs BEFORE src/toolbar.js restores a
// stored budget, so a user's own choice lands on top of the mode's default.
export function initSoftwareMode(gl) {
  Object.assign(SW, detectSoftwareRenderer(glStrings(gl)));
  SW.detected = SW.software; delete SW.software;
  apply(true);
}

// Settings / palette: 'auto' | 'on' | 'off'
export function setSwPref(v) {
  _swPref = v === 'on' || v === 'off' ? v : 'auto';
  try { if (_swPref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, _swPref); } catch { /* private */ }
  apply(true);
}

function apply(announce) {
  const on = softwareModeOn(_swPref, SW.detected);
  const was = SW.on; SW.on = on;
  const bud = $('#budget'), edl = $('#edlOn');
  if (on && !was) {
    if (bud && !userBudget() && bud.value !== SW_BUDGET) { bud.value = SW_BUDGET; _budgetByUs = true; }
    if (edl && edl.checked) { edl.checked = false; _edlOffByUs = true; }
  } else if (!on && was) {
    if (bud && _budgetByUs && !userBudget()) { const d = [...bud.options].find((o) => o.defaultSelected); if (d) bud.value = d.value; }
    if (edl && _edlOffByUs) edl.checked = true;
    _budgetByUs = false; _edlOffByUs = false;
  }
  document.body.classList.toggle('sw-render', on);
  // the heavy optional passes stand down (a ghost outline draws as its tint; ambient occlusion off — src/viewport.js)
  if (S.renderer && S.renderer.setLightweight) S.renderer.setLightweight(on);
  if (on && announce && (!_said || !was)) {
    const m = $('#meta');
    if (m) m.textContent = SW.detected ? `software rendering detected (${SW.name}) — reduced detail; see Help → About` : 'software rendering mode (forced in Settings) — reduced detail; see Help → About';
    _said = true;
  } else if (!on && was && announce) {
    const m = $('#meta'); if (m) m.textContent = 'software rendering mode off — full GPU detail';
  }
  if (S.renderer) S.renderer.invalidate();
  requestRender();
}

// the Help / About line: what the view is drawn by
export function rendererSummary() {
  return `${SW.renderer || 'unknown renderer'}${SW.detected ? ` — software (${SW.name})` : ''} · software-rendering mode ${SW.on ? 'ON' : 'off'}${_swPref !== 'auto' ? ` (forced ${_swPref} in Settings)` : ''}`;
}

registerCommands([
  { id: 'sw-render-on', group: 'View', title: 'Software rendering mode: on', kw: 'slow cpu no gpu swiftshader warp llvmpipe reduced detail vm remote desktop', when: () => !SW.on, run: () => setSwPref('on') },
  { id: 'sw-render-off', group: 'View', title: 'Software rendering mode: off', kw: 'full gpu detail swiftshader', when: () => SW.on, run: () => setSwPref('off') },
]);
