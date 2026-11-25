// micro — a layer's DISPLAY extras, as the project saves them: one field (`display`) in the layer's
// project.json entry, one restore call. What rides here: how its filter is shown (src/ghost.js) and
// its drillhole log tracks (src/logs.js). A feature adds its part below, nothing in project.js.
import { filterShowOf, setFilterShow } from './ghost.js';
import { logTracksOf, setLogTracks } from './logs.js';

// → the saved form, or undefined when there is nothing to keep
export function displayStateOf(L) {
  const d = {};
  if (filterShowOf(L) !== 'isolate') d.filterShow = filterShowOf(L);
  const logs = logTracksOf(L);
  if (logs.length) d.logs = logs.map((t) => ({ ...t }));
  return Object.keys(d).length ? d : undefined;
}

// after the layer's filter and colour are back (project.js restoreStyleExtras)
export async function restoreDisplayState(L, d) {
  if (!d || typeof d !== 'object') return;
  if (d.filterShow) setFilterShow(L, d.filterShow, { quiet: true });
  if (Array.isArray(d.logs) && d.logs.length) { try { await setLogTracks(L, d.logs, { quiet: true }); } catch (e) { (L._colsUnread || (L._colsUnread = [])).push({ name: 'log tracks', why: e.message }); } }
}

try { window._microVis = Object.assign(window._microVis || {}, { displayStateOf, restoreDisplayState }); } catch { /* headless */ }
