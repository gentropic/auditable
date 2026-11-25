// micro — a layer's DISPLAY extras, as the project saves them: one field (`display`) in the layer's
// project.json entry, one restore call. What rides here: how its filter is shown (src/ghost.js). A
// feature adds its part below, nothing in project.js.
import { filterShowOf, setFilterShow } from './ghost.js';

// → the saved form, or undefined when there is nothing to keep
export function displayStateOf(L) {
  const d = {};
  if (filterShowOf(L) !== 'isolate') d.filterShow = filterShowOf(L);
  return Object.keys(d).length ? d : undefined;
}

// after the layer's filter and colour are back (project.js restoreStyleExtras)
export async function restoreDisplayState(L, d) {
  if (!d || typeof d !== 'object') return;
  if (d.filterShow) setFilterShow(L, d.filterShow, { quiet: true });
}
