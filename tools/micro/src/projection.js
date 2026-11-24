// micro — PROJECTIONS (View → Projection): maximum / minimum / mean intensity along
// the line of sight. Per pixel, the highest (lowest, average) value of every block
// or point the ray crosses, occlusion ignored, through the layer's own ramp —
// "where are the high grades, through the whole model". The engine side is
// @gcu/condenser's gl-mip.js; this is the state, the words and the status line.
//
// One SCENE-wide mode (S.projection: null | 'max' | 'min' | 'mean'). It applies to
// every visible blocks/points layer coloured by a NUMERIC column; layers coloured by
// category, rule, RGB or elevation, meshes and drillholes draw as usual (a class
// has no maximum; elevation's max along a vertical ray is just the top). It rides
// with the camera — bookmarks, scenes, the project and composer frames keep it.
import { S, requestRender } from './state.js';
import { registerCommands } from './commands.js';
const $ = (s) => document.querySelector(s);

export const PROJECTIONS = ['max', 'min', 'mean'];
// the short name on the status line, and the menu's words
export const PROJ_NAME = { max: 'MIP', min: 'MinIP', mean: 'mean IP' };
export const PROJ_MENU = [
  [null, 'Off — the front surface'],
  ['max', 'Max — the highest value along each line of sight'],
  ['min', 'Min — the lowest value along each line of sight'],
  ['mean', 'Mean — the average along each line of sight'],
];

// what this GPU offers, per mode ({ format, bits } | null)
export function projectionSupport() {
  try { return (S.renderer && S.renderer.projectionSupport) || {}; } catch { return {}; }
}

export function setProjection(mode, { quiet = false } = {}) {
  const m = PROJECTIONS.includes(mode) ? mode : null;
  if (m && !projectionSupport()[m]) {
    if (!quiet) $('#meta').textContent = `the ${m} projection needs float render targets, which this graphics card doesn't offer — max and min work here`;
    return false;
  }
  if (S.projection === m) return true;
  S.projection = m;
  requestRender();
  if (!quiet) {
    const sup = m && projectionSupport()[m];
    $('#meta').textContent = !m ? 'projection off — the front surface again'
      : `projection: ${m} along the line of sight (${PROJ_NAME[m]}) — blocks and points colored by a numeric column; occlusion ignored, eye-dome lighting off${sup && !sup.float ? ' · this GPU stores it in 8 bits (256 levels)' : ''}`;
  }
  return true;
}

// the status line's prefix: which projection, and whether the picture is exact yet —
// while not every element has been drawn (the per-frame budget, orbiting), the
// picture is the max over what has been drawn so far, and it says so
export function projectionStatus(r) {
  const m = S.projection;
  if (!m) return '';
  const p = r && r.projection;
  if (!p) return `${PROJ_NAME[m]} — no layer colored by a numeric column · `;
  return p.exact ? `${PROJ_NAME[m]} (exact) · ` : `${PROJ_NAME[m]} (partial — ${p.drawn.toLocaleString()} of ${p.total.toLocaleString()} drawn) · `;
}

// the View menu's submenu
export function projectionMenuItems() {
  const sup = projectionSupport();
  return PROJ_MENU.map(([v, t]) => ({
    label: (S.projection === v ? '✓ ' : '') + t + (v && !sup[v] ? ' (not on this GPU)' : ''),
    action: () => setProjection(v),
  }));
}

// ── its palette commands (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  { id: 'proj-max', group: 'View', title: 'Projection: max (MIP)', kw: 'maximum intensity projection highest grade through the model x-ray line of sight', run: () => setProjection('max') },
  { id: 'proj-min', group: 'View', title: 'Projection: min (MinIP)', kw: 'minimum intensity projection lowest grade through the model line of sight', run: () => setProjection('min') },
  { id: 'proj-mean', group: 'View', title: 'Projection: mean', kw: 'average intensity projection along the line of sight', when: () => !!projectionSupport().mean, run: () => setProjection('mean') },
  { id: 'proj-off', group: 'View', title: 'Projection: off', kw: 'front surface normal view mip', when: () => !!S.projection, run: () => setProjection(null) },
]);
