// micro — how a FILTER is shown, per layer: what happens to the records it leaves out.
//   isolate  (the default) they drop out of the view — and the render budget runs over the matches
//   dim      they stay, darkened — opaque: they hide and muddy what is behind them
//   ghost    they draw as ONE flat, faint colour BEHIND the matches, never covering one — the
//            shape of the rest of the model, for context, without hiding anything
//   outline  only the ghost's silhouette: a thin line round the envelope of what was left out
// The ghost is @gcu/condenser's gl-ghost.js (a depth target of the left-out records + a stencil
// of the kept elements); a software rasterizer draws an outline as the tint (renderer.setLightweight,
// src/software-mode.js). Block models and point clouds; a drillhole layer's filter always isolates.
// Saved with the layer's display state (src/layer-display.js).
import { S, activeLayer, requestRender } from './state.js';
import { registerCommands, contributeMenu } from './commands.js';
const $ = (s) => document.querySelector(s);

export const FILTER_SHOWS = ['isolate', 'dim', 'ghost', 'outline'];
export const FILTER_SHOW_WORDS = {
  isolate: 'isolate — the rest drops out',
  dim: 'dim — the rest darkened',
  ghost: 'ghost — the rest a faint flat shape behind',
  outline: 'outline — the rest as a silhouette line',
};
export const filterShowOf = (L) => (L && FILTER_SHOWS.includes(L.filterShow) ? L.filterShow : 'isolate');
// can this layer show its filter as anything but isolate? (blocks and points — not drillholes)
export const canShowFilter = (L) => !!(L && !L.dh && L.docs && (L.docs.blockDoc || L.docs.lasDoc || L.docs.plyDoc));
// the renderer's setFilter options for this layer's mode
export function filterOptsOf(L) {
  const m = canShowFilter(L) ? filterShowOf(L) : 'isolate';
  return { isolate: m !== 'dim', ghost: m === 'ghost' ? 'tint' : m === 'outline' ? 'outline' : null };
}
// compaction (the matches as chunks of their own) is isolate's: the other modes draw the base chunks
export const compactsFilter = (L) => filterShowOf(L) === 'isolate';

// set a layer's mode; a filter in force is shown the new way at once (its mask, the base chunks)
export function setFilterShow(L, mode, { quiet = false } = {}) {
  if (!L) return false;
  const m = FILTER_SHOWS.includes(mode) ? mode : 'isolate';
  if (m !== 'isolate' && !canShowFilter(L)) { if (!quiet) $('#meta').textContent = `filter display: ${L.label || L.name} — a drillhole filter always isolates`; return false; }
  L.filterShow = m === 'isolate' ? undefined : m;
  const mask = L.filterExpr && L._filterMask;
  if (mask) {
    if (m !== 'isolate') S.renderer.clearCompact(L.id);   // the compact chunks hold only the matches — the base chunks draw
    S.renderer.setActiveSet('base', L.id);
    S.renderer.setFilter(mask, filterOptsOf(L), L.id);
  }
  dispatchEvent(new Event('micro:project-dirty'));
  requestRender();
  if (!quiet) $('#meta').textContent = `filter display (${L.label || L.name}): ${FILTER_SHOW_WORDS[m]}${mask ? '' : ' — when a filter is set'}`;
  return true;
}

// the Display menu's rows (src/layermenu.js / the View menu): the four modes, the current ticked
export function filterShowMenuItems(L) {
  const cur = filterShowOf(L);
  return FILTER_SHOWS.map((m) => ({ label: (cur === m ? '✓ ' : '') + FILTER_SHOW_WORDS[m], action: () => setFilterShow(L, m) }));
}

registerCommands([
  { id: 'filter-show-isolate', group: 'Filter', title: 'Filter display: isolate (the rest drops out)', kw: 'filter show hide rest isolate', when: (c) => canShowFilter(c.L), run: (c) => setFilterShow(c.L, 'isolate') },
  { id: 'filter-show-dim', group: 'Filter', title: 'Filter display: dim the rest', kw: 'filter context darken rest', when: (c) => canShowFilter(c.L), run: (c) => setFilterShow(c.L, 'dim') },
  { id: 'filter-show-ghost', group: 'Filter', title: 'Filter display: ghost (the rest a faint shape behind)', kw: 'filter ghost context transparent rest behind silhouette tint x-ray', when: (c) => canShowFilter(c.L), run: (c) => setFilterShow(c.L, 'ghost') },
  { id: 'filter-show-outline', group: 'Filter', title: 'Filter display: outline (the rest as a silhouette)', kw: 'filter ghost outline silhouette envelope edge context rest', when: (c) => canShowFilter(c.L), run: (c) => setFilterShow(c.L, 'outline') },
]);

// the View menu: the active layer's filter display
contributeMenu('view', () => { const L = activeLayer(); return canShowFilter(L) ? [{ label: `Filter display: ${filterShowOf(L)}`, submenu: () => filterShowMenuItems(L) }] : []; });

try { window._microVis = Object.assign(window._microVis || {}, { setFilterShow, filterShowOf, filterOptsOf }); } catch { /* headless */ }
