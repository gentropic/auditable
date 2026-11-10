// micro — BOOKMARKS and SCENES. A bookmark is a viewpoint (camera + section), the quick
// nav aid, with nine numbered slots behind the g-leader. A scene is the full working state
// (camera + section + per-layer visibility, colour and filter, optionally the selection).
// Both live as one JSON file each in the project folder (bookmarks/ and scenes/); the
// in-memory lists (S.views, S.scenes) are the session truth, written on save and remove
// and flushed when the project saves.
import { S, layerById, requestRender } from './state.js';
import { removeFileAt, resolveFileHandle } from './paths.js';
import { markProjectDirty, rleDecode, rleEncode } from './project.js';
import { applyLayerSurface, captureLayerSurface } from './surfaces.js';
import { applyBlockFilter, syncFilterClear } from './filter.js';
import { attrRowCountOf } from './records.js';
import { applyTreeVisibility, renderLayers } from './tree.js';
import { microConfirm, microPrompt } from './prompts.js';
import { setLayerColorSel } from './color.js';
import { setActiveLayer } from './layers.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setViewsHooks): applyCamera, applyLayerSelection, applySection, captureCamera, captureSection
let H = {};
export function setViewsHooks(h) { H = h; }

// ── bookmarks & scenes ──
// A BOOKMARK is a viewpoint (camera + section) — the quick nav aid. A SCENE is
// the full working state (camera + section + per-layer visibility/colour/filter,
// and optionally selection) — pick-up-where-you-were. Both live as files in the
// project folder (bookmarks/ and scenes/, one JSON each — a snapshot .png sidecar
// is a future addition), mirroring recipes/. The in-memory arrays are the session
// source of truth; files are written on save/remove and flushed on saveProject.
export function bmSlug(name) { return (String(name).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'view').toLowerCase(); }

export async function writeViewFile(v, subdir, payload) {
  if (!S.project || !v.file) return;
  try { const fh = await resolveFileHandle(S.project.dir, v.file, { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(payload, null, 2) + '\n'); await w.close(); }
  catch (e) { $('#meta').textContent = `${subdir} save failed — ${e.message}`; }
}

// bookmarks (viewpoints)
export async function saveViewAs() {
  const name = ((await microPrompt('bookmark name', `view ${S.views.length + 1}`)) || '').trim();
  if (!name) return;
  const existing = S.views.find((v) => v.name === name);
  const v = existing || { name, file: 'bookmarks/' + bmSlug(name) + '.json' };
  v.camera = H.captureCamera(); v.section = H.captureSection();
  if (!existing) { S.views.push(v); S.views.sort((a, b) => a.name.localeCompare(b.name)); }
  await writeViewFile(v, 'bookmark', { app: 'micro', kind: 'bookmark', name: v.name, camera: v.camera, section: v.section });
  markProjectDirty();
  $('#meta').textContent = `${existing ? 'updated' : 'saved'} bookmark “${name}”${S.project ? ` → ${v.file}` : ' (in memory — save the project to keep it)'}`;
}

export function applyView(v) { H.applyCamera(v.camera); H.applySection(v.section); $('#meta').textContent = `bookmark “${v.name}”`; }

// view SLOTS — the g-leader's targets. g then a digit recalls; g then
// Shift+digit saves the current view into "slot N". Name-addressed on
// purpose (the bookmark list is name-SORTED, so Nth-in-list renumbers as
// bookmarks accrue — "slot 2" must always mean the same view); recall falls
// back to Nth-in-list so plain bookmarks stay reachable.
export function slotView(n) { return S.views.find((v) => v.name === `slot ${n}`); }

export async function saveViewSlot(n) {
  const existing = slotView(n);
  const v = existing || { name: `slot ${n}`, file: 'bookmarks/' + bmSlug(`slot ${n}`) + '.json' };
  v.camera = H.captureCamera(); v.section = H.captureSection();
  if (!existing) { S.views.push(v); S.views.sort((a, b) => a.name.localeCompare(b.name)); }
  await writeViewFile(v, 'bookmark', { app: 'micro', kind: 'bookmark', name: v.name, camera: v.camera, section: v.section });
  markProjectDirty();
  $('#meta').textContent = `${existing ? 'updated' : 'saved'} slot ${n} — g ${n} recalls it${S.project ? '' : ' (in memory — save the project to keep it)'}`;
}

export function recallViewSlot(n) {
  const v = slotView(n) || S.views[n - 1];                  // named slot first, Nth bookmark as the fallback
  if (v) applyView(v);
  else $('#meta').textContent = `no view in slot ${n} — g then Shift+${n} saves the current view there`;
}

export let _gotoArm = 0;   // the g-leader timer (0 = disarmed)

export function gotoDisarm() { if (_gotoArm) { clearTimeout(_gotoArm); _gotoArm = 0; } }

export function armGoto() {
  gotoDisarm();
  _gotoArm = setTimeout(() => { _gotoArm = 0; $('#meta').textContent = ''; }, 2500);
  $('#meta').textContent = 'goto — 1–9 recalls a view slot · Shift+digit saves the current view · Esc cancels';
}

export async function removeBookmark(v) {
  if (!(await microConfirm('remove bookmark', `Remove the bookmark “${v.name}”${S.project && v.file ? ` — and its file ${v.file} in the project` : ''}?`, 'Remove'))) return;
  S.views = S.views.filter((x) => x !== v);
  if (S.project && v.file) { try { await removeFileAt(S.project.dir, v.file); } catch { /* already gone */ } }
  markProjectDirty();
  $('#meta').textContent = `removed bookmark “${v.name}”`;
}

// scenes (full working state)
export function captureScene(name, withSel) {
  return {
    name, camera: H.captureCamera(), section: H.captureSection(),
    layers: S.layers.map((L) => {
      const o = { name: L.name, visible: L.visible !== false, colorSel: L.colorSel || '', filter: L.filterExpr || '', ...captureLayerSurface(L) };
      if (withSel && L._selMask && L._selCount) o.sel = rleEncode(L._selMask);   // opt-in; selection can be large (RLE'd)
      return o;
    }),
  };
}

export async function applyScene(s) {
  H.applyCamera(s.camera); H.applySection(s.section);
  const prevActive = S.activeId;
  for (const sl of (s.layers || [])) {
    let L = S.layers.find((x) => x.name === sl.name) || S.layers.find((x) => (x.label || x.name) === sl.name);
    if (!L) continue;
    L = await applyLayerSurface(L, sl) || L;   // surface/drape/flatZ/faceted/band FIRST (may reopen → fresh L), then vis/color/filter on it
    if (sl.visible != null) { L.visible = !!sl.visible; S.renderer.setLayerVisible(L.id, L.visible); }
    if (sl.colorSel != null && sl.colorSel !== (L.colorSel || '')) setLayerColorSel(L, sl.colorSel);
    if (sl.filter != null && (L.filterExpr || '') !== sl.filter) {   // applyBlockFilter sweeps the ACTIVE layer → focus it first
      setActiveLayer(L.id); $('#filter').value = sl.filter; syncFilterClear(); await applyBlockFilter(sl.filter);
    }
    if (sl.sel) { L._selMask = rleDecode(sl.sel, attrRowCountOf(L)); H.applyLayerSelection(L); }   // computes _selCount + paints
  }
  if (layerById(prevActive)) setActiveLayer(prevActive);
  applyTreeVisibility(); renderLayers(); requestRender();
  const missing = (s.layers || []).filter((sl) => !S.layers.some((x) => x.name === sl.name || (x.label || x.name) === sl.name)).map((sl) => sl.name);
  $('#meta').textContent = `scene “${s.name}”${missing.length ? ` · ${missing.length} layer${missing.length === 1 ? '' : 's'} not loaded (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})` : ''}`;
}

export async function saveSceneAs(withSel) {
  const name = ((await microPrompt(withSel ? 'scene name (with selection)' : 'scene name', `scene ${S.scenes.length + 1}`)) || '').trim();
  if (!name) return;
  const existing = S.scenes.find((s) => s.name === name);
  const captured = captureScene(name, withSel);
  const s = existing || { name, file: 'scenes/' + bmSlug(name) + '.json' };
  Object.assign(s, captured);
  if (!existing) { S.scenes.push(s); S.scenes.sort((a, b) => a.name.localeCompare(b.name)); }
  await writeViewFile(s, 'scene', { app: 'micro', kind: 'scene', name: s.name, camera: s.camera, section: s.section, layers: s.layers });
  markProjectDirty();
  $('#meta').textContent = `${existing ? 'updated' : 'saved'} scene “${name}” (${s.layers.length} layer${s.layers.length === 1 ? '' : 's'}${withSel ? ' + selection' : ''})${S.project ? ` → ${s.file}` : ' (in memory — save the project to keep it)'}`;
}

export async function removeScene(s) {
  if (!(await microConfirm('remove scene', `Remove the scene “${s.name}”${S.project && s.file ? ` — and its file ${s.file} in the project` : ''}?`, 'Remove'))) return;
  S.scenes = S.scenes.filter((x) => x !== s);
  if (S.project && s.file) { try { await removeFileAt(S.project.dir, s.file); } catch { /* already gone */ } }
  markProjectDirty();
  $('#meta').textContent = `removed scene “${s.name}”`;
}

// write out any in-memory bookmarks/scenes that lack a persisted file yet
// (created before the project existed, or migrated from a legacy project.json)
export async function flushViewsScenes(dir) {
  for (const v of S.views) {
    if (!v.file) v.file = 'bookmarks/' + bmSlug(v.name) + '.json';
    try { const fh = await resolveFileHandle(dir, v.file, { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify({ app: 'micro', kind: 'bookmark', name: v.name, camera: v.camera, section: v.section }, null, 2) + '\n'); await w.close(); } catch { /* best effort */ }
  }
  for (const s of S.scenes) {
    if (!s.file) s.file = 'scenes/' + bmSlug(s.name) + '.json';
    try { const fh = await resolveFileHandle(dir, s.file, { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify({ app: 'micro', kind: 'scene', name: s.name, camera: s.camera, section: s.section, layers: s.layers }, null, 2) + '\n'); await w.close(); } catch { /* best effort */ }
  }
}

// scan bookmarks/ and scenes/ → the in-memory arrays (mirrors loadRecipes). A
// legacy project.json `views` array (older projects) is migrated into S.views and
// gets written out to bookmarks/ on the next save.
export async function loadViewsScenes(dir, legacyViews) {
  S.views = []; S.scenes = [];
  try {
    const bd = await dir.getDirectoryHandle('bookmarks');
    for await (const [nm, h] of bd.entries()) {
      if (h.kind !== 'file' || !/\.json$/i.test(nm)) continue;
      try { const j = JSON.parse(await (await h.getFile()).text()); if (j && j.camera) S.views.push({ name: String(j.name || nm.replace(/\.json$/i, '')), camera: j.camera, section: j.section, file: 'bookmarks/' + nm }); } catch { /* skip bad file */ }
    }
  } catch { /* no bookmarks/ folder — maybe legacy */ }
  if (!S.views.length && Array.isArray(legacyViews)) S.views = legacyViews.map((v) => ({ name: v.name, camera: v.camera, section: v.section }));   // file assigned on next save
  try {
    const sd = await dir.getDirectoryHandle('scenes');
    for await (const [nm, h] of sd.entries()) {
      if (h.kind !== 'file' || !/\.json$/i.test(nm)) continue;
      try { const j = JSON.parse(await (await h.getFile()).text()); if (j && j.camera) S.scenes.push({ name: String(j.name || nm.replace(/\.json$/i, '')), camera: j.camera, section: j.section, layers: j.layers || [], file: 'scenes/' + nm }); } catch { /* skip */ }
    }
  } catch { /* no scenes/ folder */ }
  S.views.sort((a, b) => a.name.localeCompare(b.name));
  S.scenes.sort((a, b) => a.name.localeCompare(b.name));
}
