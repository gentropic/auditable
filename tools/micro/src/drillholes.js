// micro — the DRILLHOLE actions: what a loaded drillhole set can do beyond being drawn.
// Re-desurvey (one layer or the whole set), add an interval table to a set, the hole
// traces, the whole-holes section mode and its mask, the hole filter driven from the
// collar table, the collar and survey table windows, and the set groups in the tree.
// The readers live in src/open.js; the app keeps the tree, the camera and the section.
import { S, _fileHandles, layerById, requestRender } from './state.js';
import { openDrillholeLayer, openBlob } from './open.js';
import { refreshProps, renderProps } from './props.js';
import { dhFilterMeta, dhFilterSweep, refilterLayer } from './filter.js';
import { coordNum, createStickChunkBuilder, delimitedRecords, delimiterOfLine, openDrillholeTraces, splitDelimitedRecord } from '../../../ext/condenser/src/main.js';
import { markProjectDirty } from './project.js';
import { peekCollarCols } from './manifest.js';
import { compileBool, validate } from '../../../ext/expr/index.js';
import { floatWin } from './windows.js';
import { basename, layerFiles } from './paths.js';
import { dhGroupName, nextDhSetKey } from './open-dialog.js';
import { menuXY } from './menu.js';
import { microPrompt } from './prompts.js';
import { applyLayerStyling, captureLayerStyling, captureReopenIdentity, restoreReopenIdentity } from './reopen.js';
import { applyTreeVisibility, createLayerGroup, groupLayerIds, treeMove, treeSync } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { closeAttrTable } from './attrtable.js';
import { allocLayerId, setActiveLayer, removeLayerUI } from './layers.js';
import { layerTableHeader, attrRowCountOf, layerRows } from './records.js';
import { mkLineage } from './lineage.js';
import { matColSet, paintRecount } from './columns.js';
import { persistElement } from './element-store.js';
import { createPaintCol, addPaintValue } from './paint.js';
import { setLayerColorSel, setLayerColorBy, colorSelFor, colorByName } from './color.js';
import { filterHolesLayer } from './layermenu.js';
import { registerCommands } from './commands.js';
import { dhRunOpts, collarTransformFor } from './dh-crs.js';
import { sceneOrigin } from './coords.js';
const $ = (s) => document.querySelector(s);

// re-open a drillhole layer with a patched config (method / dip / category —
// re-desurveys), keeping the layer's identity + styling; class eyes survive
// unless the category itself changed
export async function reopenDh(L, patch, { clearCats = false } = {}) {
  const dh = L.docs.dhDoc; if (!dh) return;
  closeAttrTable(L.id);
  const files = dh.blobs, cfg = { ...dh.config, qualify: L.qualify || null, ...patch };
  const id = captureReopenIdentity(L);                                // label · visible · storage (handle n/a for compound dh)
  const setKey = L._setKey, intervalName = L._intervalName;           // dh-set membership (dh-specific, not generic identity)
  const style = captureLayerStyling(L, { clearCats });
  const oldId = L.id, prevActive = S.activeId;
  // open FIRST, remove the old layer only on success. The old order removed L
  // and then, if openDrillholeLayer threw, grafted L's identity/styling onto
  // whatever activeLayer() happened to be — corrupting an unrelated layer and
  // losing the drillhole one. redesurveySet loops this, so one failure could
  // cascade across several layers.
  const beforeIds = new Set(S.layers.map((l) => l.id));
  try {
    await openDrillholeLayer(files, cfg, 'add');
  } catch (e) { $('#meta').textContent = `re-desurvey: ${(L.label || L.name)} — ${e.message} (kept the original)`; return; }
  const L2 = S.layers.find((l) => !beforeIds.has(l.id) && l.dh) || null;   // the freshly-opened dh layer, not "whatever is active"
  if (!L2) { $('#meta').textContent = `re-desurvey: ${(L.label || L.name)} — reopen produced no layer (kept the original)`; return; }
  S.renderer.removeLayer(oldId);
  S.layers = S.layers.filter((l) => l.id !== oldId);
  S.activeId = L2.id;
  restoreReopenIdentity(L2, id);
  L2._setKey = setKey; L2._intervalName = intervalName;             // stay in the same drillhole set
  applyLayerStyling(L2, style, { clearCats });
  if (id.visible === false) applyTreeVisibility();
  await refilterLayer(L2);                                 // any layer: a re-read dropped its GPU mask
  // re-reading a layer that wasn't active (a host's setColorBy) mustn't take the focus
  if (prevActive !== oldId && layerById(prevActive)) setActiveLayer(prevActive);
  renderLayers();
  refreshProps();
  return L2;
}

// the slab a whole-holes layer tests against: its own ± half, else the section's
// (the slab, or a half-space's trace band). Frame-local, like the section.
export function wholeHolesSlab(L, sec) {
  const m = S.renderer.layerSectioned(L.id);
  if (!m || typeof m !== 'object' || !m.whole || !sec) return null;
  const d0 = sec.d0 !== undefined ? sec.d0 : sec.d;
  const half = m.half > 0 ? m.half : (sec.clip === 'front' || sec.clip === 'behind') ? (sec.traceHalf || 1) : sec.half;
  return { n: sec.n, d0, half };
}

// which holes' collar → EOH paths reach into the slab (a station inside it, or
// a path segment jumping across it)
export function crossingHoles(L, slab) {
  const dh = L.docs.dhDoc; if (!dh || !dh.holePaths) return null;
  const o = sceneOrigin();
  const [nx, ny, nz] = slab.n;
  const off = nx * o[0] + ny * o[1] + nz * o[2];            // the paths are WORLD coordinates; the plane is frame-local
  const lo = slab.d0 - slab.half + off, hi = slab.d0 + slab.half + off;
  const out = new Set();
  for (const [bh, xyz] of dh.holePaths()) {
    let prev = null;
    for (let k = 0; k < xyz.length; k += 3) {
      const t = nx * xyz[k] + ny * xyz[k + 1] + nz * xyz[k + 2];
      if ((t >= lo && t <= hi) || (prev != null && ((prev < lo && t > hi) || (prev > hi && t < lo)))) { out.add(bh); break; }
      prev = t;
    }
  }
  return out;
}

export function maskOfHoles(L, holes) {
  const dh = L.docs.dhDoc, im = dh.header.intervalMapping, raw = dh.rawRecord || dh.fetchRecord;
  const mask = new Uint8Array(dh.header.count);
  for (let i = 0; i < mask.length; i++) { const f = raw(i); if (f && holes.has(f[im.bhid])) mask[i] = 1; }
  return mask;
}

// TWO masks on a drillhole layer, kept apart on purpose:
// - L._filterMask — the FILTER: the interval expression AND the hole filter. It's
//   data: export "matches", the analyses' 'filtered' scope, filter → selection,
//   the attribute table and the status line all read it.
// - L._secHoleMask — a DISPLAY rule: the whole-holes section's crossing holes.
//   Moving the section changes what's drawn, never what the filter matched.
// pushDhMask is the one place the renderer's per-layer mask is set for a
// drillhole layer: the filter AND the display rules (L._drawMask, for the smokes).
export function pushDhMask(L) {
  const dh = L && L.docs && L.docs.dhDoc; if (!dh) return;
  let sec = L._secHoleMask || null;
  if (sec && sec.length !== dh.header.count) { invalidateWholeHoles(L); sec = null; }   // a re-read changed the records — next frame recomputes
  const f = L._filterMask || null;
  let m = f || sec;
  if (f && sec) { m = new Uint8Array(f.length); for (let i = 0; i < m.length; i++) m[i] = f[i] & sec[i]; }
  L._drawMask = m;
  if (!m) S.renderer.setFilter(null, {}, L.id);
  else { S.renderer.setActiveSet('base', L.id); S.renderer.setFilter(m, { isolate: true }, L.id); }
  requestRender();
}

export function invalidateWholeHoles(L) {
  L._secHoleMask = null; L._secHoleSig = null; L._secHoleCount = 0; _wholeKey = '';
}

// per frame (currentDrawOpts): when the section or a whole-holes layer changed,
// recompute which holes cross; refilter only when that SET changed (a scrub
// mostly doesn't change it)
export let _wholeKey = '';

export function syncWholeHoles(sec) {
  let key = sec ? `${sec.n.join()}|${sec.d0}|${sec.d}|${sec.half}|${sec.traceHalf}|` : 'off|';
  let any = false;
  for (const L of S.layers) {
    if (!L.dh) continue;
    const m = S.renderer.layerSectioned(L.id);
    if (m && typeof m === 'object' && m.whole) { key += `${L.id}:${m.half || ''}:${L._secHoleSig != null ? 's' : 'n'};`; any = true; }   // a re-opened layer (no set yet) re-keys
    else if (L._secHoleSig != null) { key += `${L.id}:x;`; any = true; }
  }
  if (!any || key === _wholeKey) { if (!any) _wholeKey = ''; return; }
  _wholeKey = key;
  for (const L of S.layers) {
    if (!L.dh || !L.docs.dhDoc) continue;
    const slab = wholeHolesSlab(L, sec);
    const holes = slab ? crossingHoles(L, slab) : null;
    const sig = holes ? `${holes.size}:${[...holes].sort().join('\u0001')}` : null;
    if (sig === (L._secHoleSig == null ? null : L._secHoleSig)) continue;
    L._secHoleSig = sig;
    L._secHoleMask = holes ? maskOfHoles(L, holes) : null;
    L._secHoleCount = holes ? holes.size : 0;
    pushDhMask(L);                                         // display only — the filter didn't change
    if (L.id === S.activeId) $('#meta').textContent = dhFilterMeta(L);
  }
}

// small whole-file tables (collar / survey): RECORDS, not lines — a quoted
// field may hold the delimiter or a line break (condenser's record layer)
export function csvRecords(text) {
  const nl = text.indexOf('\n');
  const d = delimiterOfLine((nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, ''));
  return delimitedRecords(text, d, { dropPartial: false }).filter((x) => x.trim());
}

export function collarCells(lines) {
  const delim = delimiterOfLine(lines[0]);
  return (ln) => splitDelimitedRecord(ln, delim).map((x) => x.trim());
}

export function collarKeyIndex(dh, low) {                         // the hole-id column on the COLLAR side
  // the RESOLVED collar mapping is the truth — it was sniffed/mapped against the
  // collar file's own columns at import. The old path searched the collar header
  // for the INTERVAL table's bhid column NAME and fell back to column 0, so a set
  // whose collar and assay files named the hole-id column differently joined on
  // the wrong column (hole filter / broadcast / traces all silently misjoined).
  const cm = dh.header.collarMapping || {};
  if (cm.bhid != null && cm.bhid >= 0 && cm.bhid < low.length) return cm.bhid;
  const im = dh.header.intervalMapping || {};              // fallback: name-match, then leading column
  const bhidName = im.bhid != null ? dh.header.columns[im.bhid] : null;
  const ki = bhidName ? low.indexOf(String(bhidName).toLowerCase()) : -1;
  return ki >= 0 ? ki : 0;
}

export async function applyHoleFilter(L, expr) {
  const dh = L && L.docs && L.docs.dhDoc; if (!dh) return { err: 'not a drillhole layer' };
  expr = (expr || '').trim();
  if (!expr) {
    L.holeFilter = ''; L._holeIds = null; L._holeMask = null;
    dhFilterSweep(L, L.filterExpr || ''); markProjectDirty();
    return { holes: null };
  }
  const cols = await peekCollarCols(dh);
  const schema = cols.map((c) => ({ name: c.name, type: c.type === 'number' ? 'number' : 'string' }));
  const v = validate(expr, schema);
  if (!v.ok) return { err: (v.errors[0] && v.errors[0].message) || 'invalid expression' };
  const fn = compileBool(expr, schema, { decimal: '.' });
  const lines = csvRecords(await dh.blobs.collar.text());
  const cells2 = collarCells(lines);
  const names = cells2(lines[0]), low = names.map((x) => x.toLowerCase());
  const ki = collarKeyIndex(dh, low);
  const ids = new Set();
  let total = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = cells2(lines[i]); if (c.length <= ki) continue;
    total++;
    let keep = false; try { keep = !!fn(c); } catch { /* blank verdict */ }
    if (keep) ids.add(String(c[ki]).trim());
  }
  const im = dh.header.intervalMapping || {};
  const mask = new Uint8Array(dh.header.count);
  for (let i = 0; i < dh.header.count; i++) { const f = dh.fetchRecord(i); if (ids.has(String(f[im.bhid] ?? '').trim())) mask[i] = 1; }
  L.holeFilter = expr; L._holeIds = ids; L._holeMask = mask;
  dhFilterSweep(L, L.filterExpr || '');
  markProjectDirty();
  return { holes: ids.size, total };
}

export async function filterHolesSet(nd) {
  const members = groupLayerIds(nd).map(layerById).filter((L) => L && L.dh && L.docs.dhDoc);
  if (!members.length) return;
  const cc = await peekCollarCols(members[0].docs.dhDoc).catch(() => []);
  const v = await microPrompt('hole filter — an expression over the COLLAR columns (empty clears)', members[0].holeFilter || '', { expr: () => ({ columns: cc.map((c) => ({ name: c.name, type: c.type === 'number' ? 'number' : 'string' })) }) });
  if (v == null) return;
  return setHoleFilter(nd, v);
}
// the hole filter on every member of a set, and what derives from them follows
export async function setHoleFilter(nd, v) {
  const members = groupLayerIds(nd).map(layerById).filter((L) => L && L.dh && L.docs.dhDoc);
  let res = null;
  for (const L of members) {
    res = await applyHoleFilter(L, v);
    if (res && res.err) { $('#meta').textContent = `hole filter: ${res.err}`; return res; }
  }
  if (setHasTraces(nd)) { hideHoleTraces(nd); await showHoleTraces(nd); }   // traces follow the verdict
  if (setHasCollars(nd)) { noteCollarStyle(collarLayerOf(nd)); await showCollars(nd, nd.collars); }   // so do the collars, keeping their look
  const also = [setHasTraces(nd) && 'traces', setHasCollars(nd) && 'collars'].filter(Boolean);
  $('#meta').textContent = res && res.holes != null
    ? `hole filter: ${res.holes} of ${res.total} holes — intervals${also.map((x) => ' + ' + x).join('')} follow`
    : 'hole filter cleared';
  renderLayers();
  return res;
}

// a lightweight table view over a small CSV blob (the collar/survey tables —
// hole-granularity data that deserves inspection but isn't a render layer)
export async function openCsvTableWindow(title, blob) {
  const lines = csvRecords(await blob.text());
  if (!lines.length) { $('#meta').textContent = `${title}: empty file`; return; }
  const cells2 = collarCells(lines);
  const CAP = 10000;
  const win = floatWin({ title, sub: `${(lines.length - 1).toLocaleString()} rows${lines.length - 1 > CAP ? ` · showing ${CAP.toLocaleString()}` : ''}`, x: 140, y: 120, w: 540, h: 340 });
  win.body.style.cssText += 'display:flex;flex-direction:column;';
  const wrap = document.createElement('div'); wrap.style.cssText = 'flex:1;overflow:auto;font:11px var(--mono);';
  const tbl = document.createElement('table'); tbl.style.cssText = 'border-collapse:collapse;white-space:nowrap;';
  const mkTr = (vals, th) => {
    const tr = document.createElement('tr');
    for (const v of vals) {
      const td = document.createElement(th ? 'th' : 'td');
      td.textContent = v;
      td.style.cssText = 'padding:2px 12px 2px 4px;text-align:left;border-bottom:1px solid var(--bd2);font-weight:normal;' + (th ? 'position:sticky;top:0;background:var(--bg-bar);color:var(--accent);' : '');
      tr.appendChild(td);
    }
    return tr;
  };
  tbl.appendChild(mkTr(cells2(lines[0]), true));
  for (let i = 1; i < Math.min(lines.length, CAP + 1); i++) tbl.appendChild(mkTr(cells2(lines[i])));
  wrap.appendChild(tbl);
  win.body.appendChild(wrap);
  return win;
}

// the COLLARS row: hole-granularity nouns — its menu carries the collar-location
// verbs (table view, the hole filter, broadcast → every member's intervals)
export function collarsRowMenu(nd, x, y) {
  const info = dhSetInfo(nd); if (!info) return;
  const members = groupLayerIds(nd).map(layerById).filter((L2) => L2 && L2.dh && L2.docs.dhDoc);
  const rep = members[0]; if (!rep) return;
  const hf = members.find((L2) => L2.holeFilter);
  menuXY(x, y, [
    { label: 'Attribute table…', action: () => openCsvTableWindow(`collars · ${basename(info.blobs.collar.name || 'collars')}`, info.blobs.collar) },
    { label: (hf ? '✓ ' : '') + 'Filter holes…', action: () => filterHolesSet(nd) },
    { label: 'Broadcast column to intervals', submenu: () => broadcastMenuItems(nd) },
  ]);
}

// the collar columns that can be broadcast onto every member's intervals (the collars
// row's submenu and the command palette share it)
export function broadcastMenuItems(nd) {
  const members = groupLayerIds(nd).map(layerById).filter((L2) => L2 && L2.dh && L2.docs.dhDoc);
  const rep = members[0]; if (!rep) return [];
  const cols = (rep.docs.dhDoc._collarCols || []).filter((c) => c.name);
  return cols.length
    ? cols.map((c) => ({ label: `${c.name} (${c.type})`, action: async () => { for (const L2 of members) await broadcastCollarCol(L2, c.name); } }))
    : [{ label: '(reading collar columns…)', action: () => {} }];
}

// the SURVEY row: the trajectory nouns — table view, desurvey method, traces
export function surveyRowMenu(nd, x, y) {
  const info = dhSetInfo(nd); if (!info) return;
  menuXY(x, y, [
    { label: 'Attribute table…', action: () => openCsvTableWindow(`survey · ${basename(info.blobs.survey.name || 'survey')}`, info.blobs.survey) },
    { label: 'Re-desurvey set…', action: () => setTimeout(() => redesurveyMenu(nd, x, y), 0) },
    { label: setHasTraces(nd) ? 'Hide hole traces' : 'Show hole traces', action: () => showHoleTraces(nd) },
    { label: setHasCollars(nd) ? 'Hide collars' : 'Show collars', action: () => showCollars(nd) },
  ]);
}

export function ensureDhSetGroups() {
  treeSync();
  const bySet = new Map();
  for (const L of S.layers) {
    if (!(L.dh && L.docs.dhDoc) || L.trace || L.viewOf != null || dhSetGroupOf(L.id)) continue;
    const k = L._setKey || ('solo:' + L.id);
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k).push(L);
  }
  for (const members of bySet.values()) {
    const files = layerFiles(members[0]);
    createLayerGroup(dhGroupName(basename((files[0] && files[0].name) || 'holes')), members.map((L) => L.id), { collapsed: false, dhSet: true });
  }
}

export function dhSetInfo(nd) {
  for (const id of groupLayerIds(nd)) { const L = layerById(id); if (L && L.dh && L.docs.dhDoc) return { blobs: L.docs.dhDoc.blobs, config: L.docs.dhDoc.config, setKey: L._setKey }; }
  return null;
}

// the dhSet group a layer sits in (or null if it's at the root / a plain group)
export function dhSetGroupOf(id) {
  const walk = (arr, grp) => { for (const nd of arr) { if (nd === id) return grp; if (typeof nd !== 'number' && nd.group) { const r = walk(nd.children, nd); if (r !== undefined) return r; } } return undefined; };
  const g = walk(S.layerTree, null);
  return g && g.dhSet ? g : null;
}

export async function pickIntervalFile() {
  try {
    if (window.showOpenFilePicker) { const [h] = await window.showOpenFilePicker(); const f = await h.getFile(); _fileHandles.set(f, h); return f; }
    return await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => res(i.files[0]); i.click(); });
  } catch { return null; }
}

// add another interval table to an existing set — desurvey vs its collar+survey
export async function addIntervalToSet(nd) {
  const info = dhSetInfo(nd); if (!info) return;
  const file = await pickIntervalFile(); if (!file) return;
  const _got = await openDrillholeLayer({ collar: info.blobs.collar, survey: info.blobs.survey, intervals: file }, { ...info.config }, 'add');
  const L2 = layerById(_got); if (L2) {
    L2._setKey = info.setKey; L2._intervalName = file.name; treeMove(L2.id, nd, 'into');
    // inherit the set's hole filter — a filtered set that gains an interval table
    // otherwise shows ALL holes on the new one while its siblings show a subset
    const sib = groupLayerIds(nd).map(layerById).find((x) => x && x.dh && x.holeFilter && x !== L2);
    if (sib) { await applyHoleFilter(L2, sib.holeFilter); }
  }
  markProjectDirty();
}

// promote a lone dh layer into a set by adding a second interval table
export async function addIntervalToLayer(L) {
  const dh = L.docs.dhDoc; if (!dh) return;
  const file = await pickIntervalFile(); if (!file) return;
  const key = L._setKey || nextDhSetKey(); L._setKey = key; if (!L._intervalName) L._intervalName = basename(layerFiles(L)[2].name);
  const _got = await openDrillholeLayer({ collar: dh.blobs.collar, survey: dh.blobs.survey, intervals: file }, { ...dh.config }, 'add');
  const L2 = layerById(_got); if (!L2) return;
  L2._setKey = key; L2._intervalName = file.name;
  const grp = dhSetGroupOf(L.id);
  if (grp) treeMove(L2.id, grp, 'into');
  else createLayerGroup(dhGroupName(basename(dh.blobs.collar.name || 'holes')), [L.id, L2.id], { collapsed: false, dhSet: true });
  markProjectDirty();
}

// re-desurvey every interval table in a set together (they share geometry) —
// reopenDh keeps _setKey, so the reopened layers stay in the group
export async function redesurveySet(nd, patch) {
  for (const id of groupLayerIds(nd).slice()) {
    const L = layerById(id); if (!L || !L.dh) continue;
    const L2 = await reopenDh(L, patch);   // the replacement (null if it failed and kept the original)
    if (L2) treeMove(L2.id, nd, 'into');
  }
  // the trace sticks are desurveyed from the OLD geometry — rebuild them, the
  // way filterHolesSet does after a hole-filter change, or they render the old
  // paths while the interval sticks show the new ones
  if (setHasTraces(nd)) { hideHoleTraces(nd); await showHoleTraces(nd); }
  renderLayers(); markProjectDirty();
}

// derived collar→EOH hole traces for a set: a non-persisted (volatile) sticks
// layer, thin + solid grey, nested under the set. Toggled on the set node —
// shows full hole coverage even where an interval table has gaps.
export const setHasTraces = (nd) => groupLayerIds(nd).some((id) => { const L = layerById(id); return L && L.trace; });

export function hideHoleTraces(nd) {
  nd.traces = false;
  for (const id of groupLayerIds(nd).slice()) { const L = layerById(id); if (L && L.trace) { S.renderer.removeLayer(id); S.layers = S.layers.filter((l) => l.id !== id); } }
  treeSync(); renderLayers(); requestRender();
}

export async function showHoleTraces(nd) {
  if (setHasTraces(nd)) { hideHoleTraces(nd); return; }   // toggle off
  let info = dhSetInfo(nd); if (!info) return;
  const lid = allocLayerId();
  if (lid == null) { $('#meta').textContent = 'layer limit reached (7 element layers)'; return; }
  const name = dhGroupName(basename(info.blobs.collar.name || 'holes')) + ' · traces';
  info = { ...info, blobs: { ...info.blobs, collar: await keptCollarFile(nd, info) } };   // the hole filter propagates to the traces
  nd.traces = true; markProjectDirty();
  // NOT made active — a non-active layer renders modeOf(colorSel), i.e. solid grey
  S.layers.push({ id: lid, name, label: name, kind: 'points', trace: true, docs: {}, bboxLocal: null, colorSel: 'solid', clip: ['', ''], filterExpr: '', visible: true, handle: null, storage: 'volatile', lineage: null });
  $('#meta').textContent = `${name} — desurveying…`;
  try {
    const { header, streamChunks, fetchRecord } = await openDrillholeTraces({ collar: info.blobs.collar, survey: info.blobs.survey }, await dhRunOpts(info.config));
    const L = layerById(lid); if (L) L.docs = { tracesDoc: { header, fetchRecord, config: info.config } };
    S.renderer.setLayerStickRadius(lid, 0.4);   // thin
    const cb = createStickChunkBuilder({ frame: S.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => { S.renderer.addChunk(c, 'base', lid); requestRender(); } });
    for await (const rc of streamChunks({ chunkPoints: 1 << 16 })) { cb.push(rc); await new Promise((r) => setTimeout(r)); }
    const doc = cb.flush();
    if (L) L.bboxLocal = doc.bboxLocal;
    treeSync(); treeMove(lid, nd, 'into');    // nest under the set
    renderLayers(); requestRender();
    $('#meta').textContent = `${header.holes} hole trace${header.holes === 1 ? '' : 's'} · ${header.count.toLocaleString()} segments`;
  } catch (e) { $('#meta').textContent = `traces — ${e.message}`; S.renderer.removeLayer(lid); S.layers = S.layers.filter((l) => l.id !== lid); renderLayers(); }
}

// the collar file as the set's hole filter leaves it (every row when none)
async function keptCollarFile(nd, info) {
  const memb = groupLayerIds(nd).map(layerById).find((L2) => L2 && L2.dh && L2._holeIds);
  if (!memb || !memb._holeIds) return info.blobs.collar;
  const lines = csvRecords(await info.blobs.collar.text());
  const cells2 = collarCells(lines);
  const low = cells2(lines[0]).map((x) => x.toLowerCase());
  const ki = collarKeyIndex(memb.docs.dhDoc, low);
  const kept = [lines[0], ...lines.slice(1).filter((ln) => memb._holeIds.has(String(cells2(ln)[ki] ?? '').trim()))];
  return new File([kept.join('\n')], basename(info.blobs.collar.name || 'collars.csv'), { type: 'text/csv' });
}

// a collar file recorded in another system (the set's config.srcCrs): the same rows with X / Y
// reprojected, so the glyphs sit where the holes do (src/dh-crs.js); the file itself as is otherwise
async function reprojectedCollarFile(file, mc, cfg) {
  const xf = await collarTransformFor(cfg);
  if (!xf) return file;
  const lines = csvRecords(await file.text());
  const delim = delimiterOfLine(lines[0]), cells = (ln) => splitDelimitedRecord(ln, delim);
  const q = (v) => (/["\r\n]/.test(v) || v.includes(delim) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = lines.slice(1).map(cells);
  const idx = [], pts = [];
  rows.forEach((r, i) => { const x = coordNum(r[mc.x]), y = coordNum(r[mc.y]), z = coordNum(r[mc.z]); if (Number.isFinite(x) && Number.isFinite(y)) { idx.push(i); pts.push([x, y, Number.isFinite(z) ? z : 0]); } });
  const moved = pts.length ? xf(pts) : [];
  idx.forEach((i, k) => { rows[i][mc.x] = String(+moved[k][0].toFixed(4)); rows[i][mc.y] = String(+moved[k][1].toFixed(4)); });
  return new File([[lines[0], ...rows.map((r) => r.map((v) => q(String(v ?? ''))).join(delim))].join('\n') + '\n'], file.name, { type: 'text/csv' });
}

// ── COLLARS as glyphs: the set's collar table drawn as a POINTS layer, one
// glyph per hole at its collar, nested in the set. It is the collar FILE opened
// as points (its resolved X/Y/Z), so every collar column — hole id, EOH,
// campaign, rig, year — colours, filters, picks and shows in the record panel
// like any layer's. Derived: never saved as a layer of its own (the set already
// names the file); the set remembers it is shown, its glyph size and colour.
export const collarLayerOf = (nd) => groupLayerIds(nd).map(layerById).find((L) => L && L.collarOf);
export const setHasCollars = (nd) => !!collarLayerOf(nd);
export const COLLAR_SCALE = 3;                              // × the global point size

export function hideCollars(nd, { keepFlag = false } = {}) {
  const L = collarLayerOf(nd);
  if (L) removeLayerUI(L.id);
  if (!keepFlag) { nd.collars = null; markProjectDirty(); }
  treeSync(); renderLayers(); requestRender();
}

// keep: { scale, color } — a rebuild (hole filter, project reopen) keeps the look
export async function showCollars(nd, keep = null) {
  if (!keep && setHasCollars(nd)) { hideCollars(nd); return null; }   // toggle off
  if (keep && setHasCollars(nd)) hideCollars(nd, { keepFlag: true });
  const info = dhSetInfo(nd); if (!info) return null;
  const memb = groupLayerIds(nd).map(layerById).find((L2) => L2 && L2.dh && L2.docs.dhDoc);
  const mc = memb && memb.docs.dhDoc.header.collarMapping;
  if (!mc || mc.x == null || mc.y == null || mc.z == null) { $('#meta').textContent = 'collars: the collar X/Y/Z columns are not identified'; return null; }
  const file = await reprojectedCollarFile(await keptCollarFile(nd, info), mc, memb.docs.dhDoc.config);
  const fname = basename(file.name || info.blobs.collar.name || 'collars.csv');
  if (!/\.(csv|txt|tsv|dat)$/i.test(fname)) { $('#meta').textContent = `collars: ${fname} — a delimited collar file is needed`; return null; }
  const prev = S.activeId;
  const lid = await openBlob(file, fname, 'add', null, {
    asKind: 'points', mapping: { x: mc.x, y: mc.y, z: mc.z, chan: null, cat: -1 }, strictMapping: true,
    lineage: mkLineage('collars', { set: nd.name, file: fname }, []),
  });
  const L = lid != null ? layerById(lid) : null;
  if (!L) { $('#meta').textContent = 'collars: the collar file did not open as points'; return null; }
  L.collarOf = true; L.storage = 'volatile'; L.handle = null;
  L.name = L.label = dhGroupName(basename(info.blobs.collar.name || 'holes')) + ' · collars';
  const scale = (keep && keep.scale) || COLLAR_SCALE;
  S.renderer.setLayerPointScale(lid, scale);
  nd.collars = { scale, color: (keep && keep.color) || null };
  treeSync(); treeMove(lid, nd, 'into');
  if (keep && keep.color) { try { await setLayerColorBy(L, colorSelFor(L, keep.color)); } catch { /* the column went away */ } }
  if (prev != null && layerById(prev)) setActiveLayer(prev);
  markProjectDirty(); renderLayers(); requestRender();
  $('#meta').textContent = `${(attrRowCountOf(L) || 0).toLocaleString()} collars — colour, filter and pick them like any layer`;
  return L;
}

// the set's look of its collars, for the project (set on change)
export function noteCollarStyle(L) {
  if (!L || !L.collarOf) return;
  for (const nd of allSetNodes()) if (collarLayerOf(nd) === L) nd.collars = { scale: S.renderer.layerPointScale(L.id), color: colorByName(L) };
}
function allSetNodes() {
  const out = []; const walk = (a) => { for (const nd of a) if (typeof nd !== 'number') { if (nd.dhSet) out.push(nd); walk(nd.children); } };
  walk(S.layerTree); return out;
}

// a reopened project: bring back the traces and collars each set showed
export async function restoreSetDerived() {
  for (const nd of allSetNodes()) {
    if (nd.traces && !setHasTraces(nd)) { nd.traces = false; try { await showHoleTraces(nd); } catch { /* geometry gone */ } }
    if (nd.collars && !setHasCollars(nd)) { try { await showCollars(nd, nd.collars); } catch { /* collar file gone */ } }
  }
}

export function redesurveyMenu(nd, x, y) {
  menuXY(x, y, [
    { label: 'method: minimum curvature', action: () => redesurveySet(nd, { method: 'minimumCurvature' }) },
    { label: 'method: balanced tangential', action: () => redesurveySet(nd, { method: 'balancedTangential' }) },
    { label: 'method: tangential', action: () => redesurveySet(nd, { method: 'tangential' }) },
    { sep: true },
    { label: 'dip: auto-detect', action: () => redesurveySet(nd, { dipConvention: 'auto' }) },
    { label: 'dip: positive down', action: () => redesurveySet(nd, { dipConvention: 'pos-down' }) },
    { label: 'dip: negative down', action: () => redesurveySet(nd, { dipConvention: 'neg-down' }) },
  ]);
}

// ── BROADCAST — the first CROSS-LOCATION op on the dh element's relations:
// a collar column lands on an interval member BY THE HOLE-ID KEY, so hole-
// granularity attributes (EOH, COMPANY, campaign dates) become filterable /
// colorable / GT-able interval columns. Numeric → a MATERIALIZED column
// (Parquet sidecar; the ops[] entry records inputs [{loc:'collars', column}]);
// text → a dict paint-style CATEGORY column (persists via the paint channel,
// lineage kept; the manifest records it as DERIVED with the same op — it is
// re-derivable from the collar file the element already names). Typed string
// sidecars are the recorded follow-up that would let text broadcasts
// materialize like numbers do.
export async function broadcastCollarCol(L, colName) {
  const dh = L.docs.dhDoc; const h = layerTableHeader(L);
  if (!dh || !h) { $('#meta').textContent = 'broadcast: not a drillhole layer'; return; }
  const im = h.intervalMapping || {};
  if (im.bhid == null) { $('#meta').textContent = 'broadcast: no hole-id column on the intervals'; return; }
  const taken = new Set([...h.columns, ...(L.calcCols || []).map((c) => c.name), ...(L.paintCols || []).map((c) => c.name)].map((x) => String(x).toLowerCase()));
  const outName = taken.has(String(colName).toLowerCase()) ? colName + '_C' : colName;
  if (taken.has(String(outName).toLowerCase())) { $('#meta').textContent = `broadcast: “${outName}” already exists`; return; }
  const text = await dh.blobs.collar.text();               // the collar table is small — parse it whole
  const lines = csvRecords(text);
  const cells2 = collarCells(lines);
  const names = cells2(lines[0]), low = names.map((x) => x.toLowerCase());
  const ci = low.indexOf(String(colName).toLowerCase());
  if (ci < 0) { $('#meta').textContent = `broadcast: “${colName}” not in the collar file`; return; }
  // the resolved collar mapping first (see collarKeyIndex); name-match only as fallback
  const cm = dh.header.collarMapping || {};
  let ki = (cm.bhid != null && cm.bhid >= 0 && cm.bhid < low.length) ? cm.bhid : low.indexOf(String(h.columns[im.bhid]).toLowerCase());
  if (ki < 0) ki = 0;
  const map = new Map(); let numeric = true, seen = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = cells2(lines[i]); if (c.length <= Math.max(ci, ki)) continue;
    const v = c[ci]; map.set(String(c[ki]).trim(), v);
    if (v !== '' && v != null) { seen++; if (!Number.isFinite(+v)) numeric = false; }
  }
  if (!seen) numeric = false;
  const n = attrRowCountOf(L) || 0;
  $('#meta').textContent = `broadcast: ${colName} → ${n.toLocaleString()} intervals…`;
  const lin = mkLineage('broadcast', { from: 'collars', column: colName, key: names[ki], holes: map.size }, [L.lineage].filter(Boolean));
  if (numeric) {
    const vals = new Float32Array(n); let rec = 0;
    for await (const batch of layerRows(L, null)) { for (const f0 of batch) { if (rec >= n) break; const v = map.get(   /* rows ok: drillhole intervals: every row is a record */String(f0[im.bhid] ?? '').trim()); const x = v === '' || v == null ? NaN : +v; vals[rec] = Number.isFinite(x) ? x : NaN; rec++; } await new Promise((r) => setTimeout(r)); }
    matColSet(L, outName, vals, { lineage: lin });
    try { await persistElement(L); } catch { /* best-effort */ }
  } else {
    const col = createPaintCol(L, outName);
    if (!col) return;
    col.lineage = lin;
    const codeOf = new Map(); let rec = 0, full = false;
    for await (const batch of layerRows(L, null)) {   /* rows ok: drillhole intervals: every row is a record */
      for (const f0 of batch) {
        if (rec >= n || full) break;
        const v = String(map.get(String(f0[im.bhid] ?? '').trim()) ?? '').trim();
        if (v) {
          let code = codeOf.get(v);
          if (code == null) { code = addPaintValue(L, col, v); if (code == null) { full = true; break; } codeOf.set(v, code); }
          col.codes[rec] = code;
        }
        rec++;
      }
      if (full) break;
      await new Promise((r) => setTimeout(r));
    }
    paintRecount(col);
    L._colStats = null; L._calcFns = null;
  }
  setLayerColorSel(L, 'paint:' + outName);
  markProjectDirty(); renderProps(); requestRender();
  $('#meta').textContent = `broadcast: ${outName} on ${L.label || L.name} — the filter, color ramps, GT/swath, and exports all see it`;
}

// ── its palette commands (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  { id: 'dh-filter', group: 'Drillholes', title: 'Filter holes…', kw: 'hole filter collar campaign company eoh depth subset', when: (c) => !!(c.L && c.L.dh && c.L.docs.dhDoc), run: (c) => { const nd = dhSetGroupOf(c.L.id); return nd ? filterHolesSet(nd) : filterHolesLayer(c.L); } },
  { id: 'dh-interval', group: 'Drillholes', title: 'Add interval table…', kw: 'assay lithology interval file another table drillhole set', when: (c) => !!(c.L && dhSetGroupOf(c.L.id)), run: (c) => addIntervalToSet(dhSetGroupOf(c.L.id)) },
  { id: 'dh-redesurvey', group: 'Drillholes', title: 'Re-desurvey set…', kw: 'desurvey method minimum curvature tangential dip convention trajectory survey', when: (c) => !!(c.L && dhSetGroupOf(c.L.id)), run: (c) => setTimeout(() => redesurveyMenu(dhSetGroupOf(c.L.id), innerWidth / 2 - 130, innerHeight / 3), 0) },
  { id: 'dh-traces', group: 'Drillholes', title: 'Show / hide hole traces', kw: 'traces trajectory path collar eoh lines sticks toggle', when: (c) => !!(c.L && dhSetGroupOf(c.L.id)), run: (c) => showHoleTraces(dhSetGroupOf(c.L.id)) },
  { id: 'dh-collars', group: 'Drillholes', title: 'Show / hide collars', kw: 'collar points hole tops toggle', when: (c) => !!(c.L && dhSetGroupOf(c.L.id)), run: (c) => showCollars(dhSetGroupOf(c.L.id)) },
  { id: 'dh-broadcast', group: 'Drillholes', title: 'Broadcast collar column to intervals…', kw: 'broadcast collar attribute copy join hole column intervals', when: (c) => !!(c.L && dhSetGroupOf(c.L.id)), run: (c) => setTimeout(() => menuXY(innerWidth / 2 - 130, innerHeight / 3, broadcastMenuItems(dhSetGroupOf(c.L.id))), 0) },
]);
