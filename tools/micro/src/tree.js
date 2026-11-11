// micro — the layer TREE: the model (groups, order, visibility, exclusive groups, the
// manifest form a project saves) and the panel that draws it (rows, drag-reorder,
// multi-select, the group menu). Layers themselves live in S.layers; the tree says where
// each one sits and whether it shows.
import { _isMobile, _sheetExclusive } from './windows.js';
import { S, activeLayer, layerById, requestRender } from './state.js';
import { markProjectDirty } from './project.js';
import { addIntervalToSet, collarsRowMenu, dhSetGroupOf, dhSetInfo, setHasTraces, showHoleTraces, surveyRowMenu } from './drillholes.js';
import { openDhQa } from './dhqa.js';
import { layerTableHeader } from './records.js';
import { moreButton } from './longpress.js';
import { basename } from './paths.js';
import { _propFor, _propOpen, closeProps, renderProps } from './props.js';
import { menuXY } from './menu.js';
import { microPrompt } from './prompts.js';
import { openMeshExportDialog } from './meshexport.js';
import { openBatchRename } from './rename.js';
import { setActiveLayer } from './layers.js';
import { applyLayerOpacity, fitLayer, layerMenu } from './layermenu.js';
import { syncSelBar } from './selection.js';
import { syncUndoBtn } from './paint.js';
const $ = (s) => document.querySelector(s);

// ── the layers panel: visibility eyes, active-layer routing, and the layer
// context menu (zoom/info/filter/remove). Auto-shows at two layers; 'p' or
// View → Layers toggles it any time. ──
export let _lpUserHidden = false;

export function toggleLayersPanel(force) {
  const el = $('#layersPanel');
  const show = force != null ? force : !el.classList.contains('show');
  el.classList.toggle('show', show);
  if (show) _sheetExclusive(el);
  if (force == null) _lpUserHidden = !show;
}

// an explicit close (× or a swipe down) is the user's word — renderLayers must not re-open it
export function closeLayersPanel() { _lpUserHidden = true; toggleLayersPanel(false); }

// renderLayers' automatic show: never on top of another phone sheet — it ran on ~50
// actions and each one minimized whatever window you were reading
export function _otherSheetOpen() {
  if (!_isMobile()) return false;
  return $('#propPanel').classList.contains('show') || $('#recPanel').classList.contains('show')
    || [...document.querySelectorAll('.fwin')].some((w) => w.style.display !== 'none');
}

// ── layer GROUPS (spec §4.1 v1): the panel is a tree. A node is a layerId or
// { group, name, visible, collapsed, children }. Visibility is QGIS's: every
// node owns its OWN eye; a layer draws iff its eye AND every ancestor's eye
// are on. Toggling a group never rewrites the children — their pattern greys
// out and returns intact. Order + groups persist in project.json. ──
export function treeSync() {
  const seen = new Set();
  const prune = (arr) => arr.filter((nd) => {
    if (typeof nd === 'number') {
      if (!layerById(nd) || seen.has(nd)) return false;
      seen.add(nd);
      return true;
    }
    nd.children = prune(nd.children);
    return nd.children.length > 0;                         // empty groups dissolve
  });
  S.layerTree = prune(S.layerTree);
  for (const L of S.layers) if (!seen.has(L.id)) S.layerTree.push(L.id);
}

export function applyTreeVisibility() {
  treeSync();
  const walk = (arr, on) => {
    for (const nd of arr) {
      if (typeof nd === 'number') {
        const L = layerById(nd);
        S.renderer.setLayerVisible(nd, !!(on && L && L.visible));
      } else walk(nd.children, on && nd.visible);
    }
  };
  walk(S.layerTree, true);
  requestRender();
}

// ── mutually exclusive groups (QGIS's radio groups). A group flagged `exclusive`
// shows at most one of its DIRECT children (a subgroup counts as one); none is
// allowed. showNode is the ONE place the rule is enforced — every "turn this on"
// (eye, h, palette, context menu, host) goes through it. Scenes and bookmarks
// restore what was saved, without it. Table layers have no geometry → ignored. ──
export const _isTableNode = (nd) => typeof nd === 'number' && (layerById(nd) || {}).kind === 'table';

export function nodeShown(nd) { return typeof nd === 'number' ? !!(layerById(nd) || {}).visible : nd.visible !== false; }

export function setNodeFlag(nd, on) {
  if (typeof nd === 'number') { const L = layerById(nd); if (L) L.visible = !!on; } else nd.visible = !!on;
}

// the groups from the root down to `node`'s parent ([] at the root, null if absent)
export function groupChainOf(node, arr = S.layerTree, chain = []) {
  for (const nd of arr) {
    if (nd === node) return chain;
    if (typeof nd !== 'number' && nd.group) {
      const r = groupChainOf(node, nd.children, [...chain, nd]);
      if (r) return r;
    }
  }
  return null;
}

export function showNode(nd, on) {
  setNodeFlag(nd, on);
  if (on) {
    const chain = groupChainOf(nd) || [];
    const g = chain[chain.length - 1];
    if (g && g.exclusive) for (const sib of g.children) if (sib !== nd && !_isTableNode(sib)) setNodeFlag(sib, false);
  }
  applyTreeVisibility(); renderLayers(); markProjectDirty();
}

// flag a group exclusive; turning it ON keeps the topmost shown child
export function setGroupExclusive(g, on) {
  g.exclusive = !!on;
  if (on) {
    let kept = false;
    for (const c of g.children) {
      if (_isTableNode(c) || !nodeShown(c)) continue;
      if (kept) setNodeFlag(c, false); else kept = true;
    }
  }
  applyTreeVisibility(); renderLayers(); markProjectDirty();
}

// { / }: step the nearest exclusive group around the active layer (wraps). The
// shown child moves on, and the active layer follows it.
// A host may pass the (exclusive) group itself instead.
export function stepExclusive(dir, gIn = null) {
  let g = gIn, here = -1;
  if (!g) {
    const La = activeLayer();
    const chain = La ? groupChainOf(La.id) : null;
    let k = chain ? chain.length - 1 : -1;
    while (k >= 0 && !chain[k].exclusive) k--;
    if (k < 0) { $('#meta').textContent = '{ } step a mutually exclusive group — the active layer isn’t in one'; return false; }
    g = chain[k];
    here = g.children.filter((c) => !_isTableNode(c)).indexOf(chain[k + 1] || La.id);
  }
  const kids = g.children.filter((c) => !_isTableNode(c));
  if (!kids.length) return false;
  let cur = kids.findIndex(nodeShown);
  if (cur < 0) cur = here < 0 ? (dir > 0 ? -1 : 0) : here - dir;   // none shown: start at the active layer, else the end
  const next = kids[((cur + dir) % kids.length + kids.length) % kids.length];
  showNode(next, true);
  const lead = typeof next === 'number' ? next : groupLayerIds(next).find((id) => !_isTableNode(id));
  if (lead != null && lead !== S.activeId) setActiveLayer(lead);
  const label = typeof next === 'number' ? (layerById(next).label || layerById(next).name) : next.name;
  $('#meta').textContent = `${g.name}: ${label} (${kids.indexOf(next) + 1}/${kids.length})`;
  return true;
}

// gather a group's layer ids (recursive)
export function groupLayerIds(nd, out = []) {
  for (const c of nd.children) {
    if (typeof c === 'number') out.push(c);
    else groupLayerIds(c, out);
  }
  return out;
}

// nest the given root-level layers into a new (collapsed) group
// ensure a group path exists ("reports/swaths" → nested groups), returning the
// children array to file into
export function ensureGroupPath(segments) {
  treeSync();
  let arr = S.layerTree;
  for (const seg of segments) {
    const name = String(seg).trim();
    if (!name) continue;
    let g = arr.find((nd) => typeof nd !== 'number' && nd.group && !nd.dhSet && nd.name === name);
    if (!g) { g = { group: true, name, visible: true, collapsed: false, children: [] }; arr.push(g); }
    arr = g.children;
  }
  return arr;
}

// file a layer by a PATH-SHAPED name: the last segment is the label, the rest
// are groups. Returns true when it moved (i.e. the name carried a path).
export function fileLayerByPath(L, path) {
  const parts = String(path).split('/').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) { L.label = String(path).trim() || L.label; return false; }
  const leaf = parts.pop();
  const dest = ensureGroupPath(parts);
  const src = treeFindParent(L.id);
  if (src) src.arr.splice(src.i, 1);
  dest.push(L.id);
  L.label = leaf;
  renderLayers();
  markProjectDirty();
  return true;
}

export function createLayerGroup(name, layerIds, { collapsed = true, dhSet = false } = {}) {
  treeSync();
  const node = { group: true, name, visible: true, collapsed, children: [], ...(dhSet ? { dhSet: true } : {}) };
  // pull each member from WHEREVER it sits (root or inside another group).
  // Siblings regroup in place (the new group takes the first member's slot);
  // members from DIFFERENT containers meet at the root — predictable, and it
  // never buries the new group inside a container you only half-selected.
  let insert = null, sameParent = true;
  for (const id of layerIds) {
    const src = treeFindParent(id);
    if (!src) continue;
    src.arr.splice(src.i, 1);
    node.children.push(id);
    if (!insert) insert = { arr: src.arr, i: src.i };
    else if (insert.arr !== src.arr) sameParent = false;
    else if (src.i < insert.i) insert.i--;
  }
  if (node.children.length) {
    if (insert && sameParent) insert.arr.splice(Math.min(insert.i, insert.arr.length), 0, node);
    else S.layerTree.push(node);
  }
  renderLayers();
  markProjectDirty();
  return node;
}

// tree ⇄ manifest (layers referenced by their manifest index)
export function treeToManifest(idOf) {
  const conv = (arr) => arr.map((nd) => (typeof nd === 'number'
    ? (idOf.has(nd) ? idOf.get(nd) : null)
    : { g: nd.name, v: nd.visible, c: nd.collapsed, ch: conv(nd.children), d: nd.dhSet ? 1 : undefined, x: nd.exclusive ? 1 : undefined })).filter((x) => x !== null);
  return conv(S.layerTree);
}

export function treeFromManifest(tree, idAt) {
  const conv = (arr) => arr.map((nd) => (typeof nd === 'number'
    ? (idAt[nd] != null ? idAt[nd] : null)
    : { group: true, name: nd.g, visible: nd.v !== false, collapsed: !!nd.c, children: conv(nd.ch || []), ...(nd.d ? { dhSet: true } : {}), ...(nd.x ? { exclusive: true } : {}) }))
    .filter((x) => x !== null && (typeof x === 'number' || x.children.length));
  S.layerTree = conv(tree || []);
  treeSync();
  applyTreeVisibility();
}

// find a node's parent array + index (layer ids compare by value — unique)
export function treeFindParent(node, arr = S.layerTree) {
  for (let i = 0; i < arr.length; i++) {
    const nd = arr[i];
    if (nd === node) return { arr, i };
    if (typeof nd !== 'number' && nd.group) {
      const r = treeFindParent(node, nd.children);
      if (r) return r;
    }
  }
  return null;
}

// ── groups by PATH ("Model/Domains"), for a host. A group exists while it holds
// something: an emptied one dissolves (treeSync), so making one = filing layers
// into it. Drillhole set groups are the element itself, so a drillhole layer is
// filed by moving its whole SET group. ──
export const groupSegs = (path) => String(path == null ? '' : path).split('/').map((s) => s.trim()).filter(Boolean);

export function groupAt(path) {
  let arr = S.layerTree, g = null;
  for (const seg of groupSegs(path)) {
    g = arr.find((nd) => typeof nd !== 'number' && nd.group && !nd.dhSet && nd.name === seg);
    if (!g) return null;
    arr = g.children;
  }
  return g;
}

export function groupPathOf(id) {                                 // the plain-group path a layer sits under ('' at the root)
  const s = treeSlotOf(id);
  return s ? s.path.filter((p) => !p.dhSet).map((p) => p.name).join('/') : '';
}

export function groupsList() {
  treeSync();
  const out = [];
  const walk = (arr, pre) => {
    for (const nd of arr) {
      if (typeof nd === 'number' || !nd.group) continue;
      const path = nd.dhSet ? pre : (pre ? pre + '/' : '') + nd.name;
      if (!nd.dhSet) out.push({ path, name: nd.name, visible: nd.visible !== false, collapsed: !!nd.collapsed, exclusive: !!nd.exclusive, layers: groupLayerIds(nd) });
      walk(nd.children, path);
    }
  };
  walk(S.layerTree, '');
  return out;
}

export function fileLayersInGroup(path, ids) {
  treeSync();
  const segs = groupSegs(path);
  for (const id of ids) {
    const set = dhSetGroupOf(id);
    const node = set || id;                                // the set travels whole
    const dest = segs.length ? ensureGroupPath(segs) : S.layerTree;
    const src = treeFindParent(node);
    if (!src || src.arr === dest) continue;
    src.arr.splice(src.i, 1);
    dest.push(node);
  }
  treeSync(); applyTreeVisibility(); renderLayers(); markProjectDirty();
}

export function setGroupVisible(path, on) {
  const g = groupAt(path); if (!g) return false;
  showNode(g, on);
  return true;
}

export function ungroupAt(path) {                                 // dissolve: the children take the group's place
  const g = groupAt(path); if (!g) return false;
  const src = treeFindParent(g); if (!src) return false;
  src.arr.splice(src.i, 1, ...g.children);
  treeSync(); applyTreeVisibility(); renderLayers(); markProjectDirty();
  return true;
}

// ── a reopen that REPLACES a layer. Drillhole re-reads open the new layer before
// removing the old one (a failure keeps the original), and the id is baked into
// the GPU record keys, so the successor can't take the old id. It used to land at
// the ROOT of the tree, out of its group (re-channel a grouped drillhole set and
// it fell out). Now the successor takes the old layer's place, and a host hears
// `micro:layer-replaced` { from, to }; the API follows stale ids forward.
// A slot is the group PATH by name (+ each group's state) and an index — not live
// references, because the old layer's group dissolves if it was the only child.
export function treeSlotOf(id) {
  const path = [];
  const walk = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const nd = arr[i];
      if (nd === id) return i;
      if (typeof nd !== 'number' && nd.group) {
        path.push({ name: nd.name, visible: nd.visible, collapsed: nd.collapsed, exclusive: !!nd.exclusive, dhSet: !!nd.dhSet });
        const r = walk(nd.children);
        if (r != null) return r;
        path.pop();
      }
    }
    return null;
  };
  const i = walk(S.layerTree);
  return i == null ? null : { path, i };
}

export function treePlace(id, slot) {
  if (!slot) return;
  const src = treeFindParent(id);
  if (src) src.arr.splice(src.i, 1);
  let arr = S.layerTree;
  for (const seg of slot.path) {
    let g = arr.find((nd) => typeof nd !== 'number' && nd.group && nd.name === seg.name && !!nd.dhSet === seg.dhSet);
    if (!g) { g = { group: true, name: seg.name, visible: seg.visible, collapsed: seg.collapsed, children: [], ...(seg.exclusive ? { exclusive: true } : {}), ...(seg.dhSet ? { dhSet: true } : {}) }; arr.push(g); }
    arr = g.children;
  }
  arr.splice(Math.min(slot.i, arr.length), 0, id);
}

export const _successor = new Map();   // replaced id → the id that replaced it

export function layerReplaced(oldId, newId, slot) {
  treePlace(newId, slot);
  treeSync();
  applyTreeVisibility();
  if (oldId === newId) return;
  _successor.set(oldId, newId);
  dispatchEvent(new CustomEvent('micro:layer-replaced', { detail: { from: oldId, to: newId } }));
}

// an id → the live layer it now names (follows replacements; ids recycle, so a
// LIVE id is never forwarded)
export function followLayer(id) {
  for (let k = 0; k < 64 && id != null && !layerById(id) && _successor.has(id); k++) id = _successor.get(id);
  return id;
}

export function treeContains(nd, target) {
  if (nd === target) return true;
  if (typeof nd === 'number' || !nd.group) return false;
  return nd.children.some((c) => treeContains(c, target));
}

// move a node: before/after a sibling, or INTO a group (appended)
export function treeMove(node, target, where) {
  if (node === target) return;
  if (typeof node !== 'number' && treeContains(node, target)) return;   // no self-nesting
  const src = treeFindParent(node);
  if (!src) return;
  src.arr.splice(src.i, 1);
  if (where === 'into') {
    target.children.push(node);
    target.collapsed = false;
  } else {
    const dst = treeFindParent(target);
    if (!dst) { S.layerTree.push(node); }
    else dst.arr.splice(dst.i + (where === 'after' ? 1 : 0), 0, node);
  }
  treeSync();
  renderLayers();
  markProjectDirty();
}

// multi-selected rows (layer ids): ctrl/cmd+click toggles, shift+click
// ranges over the visible rows, plain click clears — right-click a selected
// row offers "Group N selected…"
export const _lpSel = new Set();

export function lpSelIds() { return S.layers.filter((L) => _lpSel.has(L.id)).map((L) => L.id); }

export function lpSelRange(toId) {
  const lids = [...document.querySelectorAll('#lpRows .lp-row')].map((r) => (r.dataset.lid != null ? +r.dataset.lid : null));
  const a = lids.indexOf(S.activeId), b2 = lids.indexOf(toId);
  if (a < 0 || b2 < 0) return;
  _lpSel.clear();
  for (let i = Math.min(a, b2); i <= Math.max(a, b2); i++) if (lids[i] != null) _lpSel.add(lids[i]);
  renderLayers();
}

// step a node among its SIBLINGS (the long-press reorder — no drag needed)
export function treeMoveStep(node, dir) {
  const src = treeFindParent(node);
  if (!src) return;
  const j = src.i + dir;
  if (j < 0 || j >= src.arr.length) return;
  src.arr.splice(src.i, 1);
  src.arr.splice(j, 0, node);
  treeSync(); renderLayers(); markProjectDirty();
}

export function moveLayerToGroupMenu(L, x, y) {
  treeSync();
  const groups = [];
  const walk = (arr) => { for (const nd of arr) if (typeof nd !== 'number' && nd.group) { groups.push(nd); walk(nd.children); } };
  walk(S.layerTree);
  const src = treeFindParent(L.id);
  const inGroup = src && src.arr !== S.layerTree;
  menuXY(x, y, [
    ...groups.map((g) => ({ label: `→ ${g.name}`, action: () => treeMove(L.id, g, 'into') })),
    { label: 'New group…', action: async () => {
      const v = await microPrompt('group name', 'group');
      if (!v || !v.trim()) return;
      const src2 = treeFindParent(L.id);
      if (src2) src2.arr.splice(src2.i, 1);
      S.layerTree.push({ group: true, name: v.trim(), visible: true, collapsed: false, children: [L.id] });
      treeSync(); renderLayers(); markProjectDirty();
    } },
    ...(inGroup ? [{ label: 'Panel root (leave the group)', action: () => {
      const src2 = treeFindParent(L.id);
      if (src2) { src2.arr.splice(src2.i, 1); S.layerTree.push(L.id); }
      treeSync(); renderLayers(); markProjectDirty();
    } }] : []),
  ]);
}

// a drillhole set's collar/survey/config come from any member interval layer
// ── CROSS-LOCATION FILTER PROPAGATION — the hole filter: a predicate over the
// COLLARS location (EOH > 200, a company, a campaign) projects through the
// key relation to every member's intervals (a per-record mask ANDed into the
// interval sweep) and to the trace sticks (traces regenerate from the matching
// holes only). Nothing materializes — the relation carries the verdict.
// The expression validates against the collar columns (peekCollarCols types).
// ── a layer's cut by the section (Cut by sections ▸). The renderer's per-layer
// mode: true (follow) · 'front' · 'behind' · false (don't cut) · { half } —
// follow with this layer's OWN slab, ± half around the plane · { whole, half? }
// — drillholes: not cut; the holes whose collar → end-of-hole path crosses the
// slab draw whole, the others are hidden. ──
export function secModeLabel(m) {
  if (m === true || m == null) return '';
  if (m === false) return ' (off)';
  if (typeof m === 'object') return m.whole ? ` (whole holes${m.half > 0 ? `, ± ${m.half} m` : ''})` : ` (± ${m.half} m)`;
  return ` (${m})`;
}

export function setLayerSectionMode(L, m) {
  S.renderer.setLayerSectioned(L.id, m);
  markProjectDirty(); requestRender();
}

export function sectionModeItems(L) {
  const m = S.renderer.layerSectioned(L.id);
  const own = m && typeof m === 'object' && m.half > 0 ? m.half : null;
  const whole = !!(m && typeof m === 'object' && m.whole);
  const opt = (on, t, v) => ({ label: (on ? '✓ ' : '') + t, action: () => setLayerSectionMode(L, v) });
  const askHalf = async (keepWhole = false) => {
    const cur = own || +$('#secHalf').value || 10;
    const v = await microPrompt('this layer’s slab: ± metres around the section plane', String(cur));
    if (v == null || !String(v).trim()) return;
    const h = +String(v).replace(',', '.');
    if (!(h > 0)) { $('#meta').textContent = 'slab: a positive number of metres'; return; }
    setLayerSectionMode(L, keepWhole ? { whole: true, half: h } : { half: h });
  };
  return [
    opt(m === true, 'follow the section', true),
    { label: (own != null && !whole ? '✓ ' : '') + `follow, with its own slab${own != null && !whole ? ` (± ${own} m)` : ''}…`, action: () => askHalf(false) },
    opt(m === 'front', 'keep front only', 'front'),
    opt(m === 'behind', 'keep behind only', 'behind'),
    ...(L.dh ? [opt(whole, 'keep holes that cross the slab, whole', { whole: true, ...(own != null ? { half: own } : {}) })] : []),
    opt(m === false, "don't cut", false),
    ...(L.dh && whole ? [{ sep: true }, { label: own != null ? `holes test a slab of ± ${own} m…` : 'holes test their own slab…', action: () => askHalf(true) },
      ...(own != null ? [{ label: 'holes test the section’s slab', action: () => setLayerSectionMode(L, { whole: true }) }] : [])] : []),
  ];
}

// one opacity for every layer in a group (the members apply it kind-aware)
export const groupOpacityItems = (nd) => {
  const Ls = groupLayerIds(nd).map(layerById).filter(Boolean);
  const cur = Ls.length ? Math.round((Ls[0].opacity != null ? Ls[0].opacity : 1) * 100) : 100;
  return [100, 75, 50, 25].map((pc) => ({
    label: (cur === pc ? '✓ ' : '') + pc + '%',
    action: () => { for (const L of Ls) applyLayerOpacity(L, pc / 100); },
  }));
};

export function groupMenu(nd, x, y) {
  const items = [];
  if (nd.dhSet) {                                          // location verbs live on the collar/survey ROWS now
    items.push({ label: setHasTraces(nd) ? 'Hide hole traces' : 'Show hole traces', action: () => showHoleTraces(nd) });
    items.push({ label: 'Add interval table…', action: () => addIntervalToSet(nd) });
    items.push({ label: 'QA report…', action: () => openDhQa(nd) });
    items.push({ sep: true });
  }
  menuXY(x, y, [
    ...items,
    { label: 'Move up', action: () => treeMoveStep(nd, -1) },
    { label: 'Move down', action: () => treeMoveStep(nd, 1) },
    { label: 'Rename group…', action: async () => { const v = await microPrompt('group name', nd.name); if (v && v.trim()) { nd.name = v.trim(); renderLayers(); markProjectDirty(); } } },
    ...(groupLayerIds(nd).length >= 2 ? [{ label: 'Rename layers…', action: () => openBatchRename(groupLayerIds(nd).map(layerById)) }] : []),
    ...(() => {
      const gm = groupLayerIds(nd).map(layerById).filter((x) => x && x.kind === 'mesh' && x.docs.meshDoc);
      return gm.length ? [{ label: gm.length > 1 ? `Export ${gm.length} meshes…` : 'Export mesh…', action: () => openMeshExportDialog(gm) }] : [];
    })(),
    { label: 'Zoom to group', action: () => {
      let u = null;
      for (const id of groupLayerIds(nd)) {
        const L = layerById(id); const b2 = L && L.bboxLocal; if (!b2) continue;
        if (!u) u = Float64Array.from(b2);
        else for (let i = 0; i < 3; i++) { if (b2[i] < u[i]) u[i] = b2[i]; if (b2[i + 3] > u[i + 3]) u[i + 3] = b2[i + 3]; }
      }
      if (u) { S.cam.fit(u); requestRender(); }
    } },
    { label: 'Opacity', submenu: () => groupOpacityItems(nd) },
    { label: (nd.exclusive ? '✓ ' : '') + 'Mutually exclusive', kbd: '{ }', action: () => setGroupExclusive(nd, !nd.exclusive) },
    { sep: true },
    { label: 'Ungroup (keep layers)', action: () => {
      treeSync();
      const at = S.layerTree.indexOf(nd);
      if (at >= 0) S.layerTree.splice(at, 1, ...nd.children);
      renderLayers(); markProjectDirty();
    } },
  ]);
}

export function renderLayers() {
  const rows = $('#lpRows'); if (!rows) return;
  rows.textContent = '';
  treeSync();
  for (const id of [..._lpSel]) if (!layerById(id)) _lpSel.delete(id);
  const visual = [];                                       // DOM-ordered rows for the drag targets
  // drag: grip pointerdown → move over rows → drop between (reorder) or ONTO
  // a group (join); trees stay honest (no dropping a group into itself)
  // the ROW is the drag handle — no grip column. A 5px threshold keeps
  // click (activate/collapse) and dblclick (fit) intact; mouse only, so
  // touch keeps scrolling the list (long-press = the context menu, which
  // carries Move up/down/to group for reordering by thumb).
  const armDrag = (row, node) => {
    row.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.pointerType !== 'mouse') return;
      if (ev.target.matches('input, .lp-caret, .lp-close')) return;
      const sx = ev.clientX, sy = ev.clientY;
      let dragging = false, target = null, where = null;
      const clear = () => visual.forEach((v2) => v2.row.classList.remove('lp-drop-above', 'lp-drop-below', 'lp-drop-into'));
      const move = (mv) => {
        if (!dragging) {
          if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < 5) return;
          dragging = true; row.style.opacity = '0.45';
        }
        clear(); target = null; where = null;
        for (const v2 of visual) {
          const rc = v2.row.getBoundingClientRect();
          if (mv.clientY < rc.top || mv.clientY > rc.bottom) continue;
          const f = (mv.clientY - rc.top) / rc.height;
          if (v2.isGroup && f > 0.3 && f < 0.7) { where = 'into'; v2.row.classList.add('lp-drop-into'); }
          else if (f <= 0.5) { where = 'before'; v2.row.classList.add('lp-drop-above'); }
          else { where = 'after'; v2.row.classList.add('lp-drop-below'); }
          target = v2.node;
          break;
        }
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        if (!dragging) return;                             // plain click — let it be one
        row.style.opacity = ''; clear();
        // a drag must not double as a click (group rows toggle collapse)
        row.addEventListener('click', (e2) => e2.stopImmediatePropagation(), { capture: true, once: true });
        if (target != null && target !== node) treeMove(node, target, where === 'into' ? 'into' : where);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  };
  const layerRow = (L, depth, dim, parent) => {
    const row = document.createElement('div');
    row.className = 'lp-row' + (L.id === S.activeId ? ' active' : '') + (_lpSel.has(L.id) ? ' sel' : '') + (L.visible ? '' : ' off') + (dim ? ' dim' : '');
    row.dataset.lid = L.id;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    let eye;
    if (L.kind === 'table') {                              // no geometry → nothing to show or hide; the glyph names the kind
      eye = document.createElement('span'); eye.className = 'lp-infoico'; eye.textContent = '▦';
      eye.title = 'table — rows and columns, no geometry';
    } else {
      eye = document.createElement('input');
      eye.type = 'checkbox'; eye.checked = L.visible; eye.title = 'visible (a disabled group greys the row — the eye stays yours)';
      eye.onclick = (e) => { e.stopPropagation(); showNode(L.id, eye.checked); };
      if (parent && parent.exclusive) { eye.classList.add('lp-radio'); eye.title = 'visible — one at a time in this group ({ } steps through it)'; }
    }
    const name = document.createElement('span'); name.className = 'lp-name';
    name.textContent = (L.storage === 'external' ? '↗ ' : '') + (L.label || L.name);
    name.title = (L.label && L.label !== L.name ? `${L.label} (${L.name})` : L.name) + (L.storage === 'external' ? ' — linked from outside the project folder' : '');
    const n = document.createElement('span'); n.className = 'lp-n';
    n.textContent = (L.kind === 'table' ? ((layerTableHeader(L) || {}).count || 0) : (S.renderer.layerElementCount(L.id) || 0)).toLocaleString();
    armDrag(row, L.id);
    // every row carries the caret SLOT (leaves get it empty) so checkboxes
    // column-align per depth — a group's eye sits level with its siblings,
    // and its children land one indent to the RIGHT of it, not the left
    const slot = document.createElement('span'); slot.className = 'lp-caret';
    row.append(slot, eye, name, n, moreButton(row));
    row.onclick = (e) => {
      if (e.ctrlKey || e.metaKey) {
        // starting a multi-select: promote the currently-active layer in first,
        // so ctrl+click a second layer gives you BOTH (matches shift-range)
        if (!_lpSel.size && layerById(S.activeId)) _lpSel.add(S.activeId);
        if (!_lpSel.delete(L.id)) _lpSel.add(L.id);
        renderLayers(); return;
      }
      if (e.shiftKey) { lpSelRange(L.id); return; }
      if (_lpSel.size) _lpSel.clear();
      setActiveLayer(L.id);
    };
    row.ondblclick = () => fitLayer(L);
    row.oncontextmenu = (e) => { e.preventDefault(); layerMenu(L, e.clientX, e.clientY); };
    rows.appendChild(row);
    visual.push({ row, node: L.id, isGroup: false });
  };
  const walk = (arr, depth, dim, parent = null) => {
    for (const nd of arr) {
      if (typeof nd === 'number') { const L = layerById(nd); if (L) layerRow(L, depth, dim, parent); continue; }
      const row = document.createElement('div');
      row.className = 'lp-row lp-group' + (nd.visible ? '' : ' off') + (dim ? ' dim' : '');
      row.style.paddingLeft = `${6 + depth * 14}px`;
      const caret = document.createElement('span'); caret.className = 'lp-caret';
      caret.textContent = nd.collapsed ? '▸' : '▾';
      caret.onclick = (e) => { e.stopPropagation(); nd.collapsed = !nd.collapsed; renderLayers(); markProjectDirty(); };
      const eye = document.createElement('input');
      eye.type = 'checkbox'; eye.checked = nd.visible; eye.title = 'group visibility — children keep their own eyes';
      eye.onclick = (e) => { e.stopPropagation(); showNode(nd, eye.checked); };
      if (parent && parent.exclusive) eye.classList.add('lp-radio');
      const name = document.createElement('span'); name.className = 'lp-name';
      name.textContent = nd.name;
      if (nd.exclusive) name.title = 'mutually exclusive — one child at a time ({ } steps)';
      const ids = groupLayerIds(nd);
      const n = document.createElement('span'); n.className = 'lp-n';
      n.textContent = ids.length + (nd.collapsed ? ` · ${ids.reduce((t, id) => t + (S.renderer.layerElementCount(id) || 0), 0).toLocaleString()}` : '');
      armDrag(row, nd);
      row.append(caret, eye, name, n, moreButton(row));
      row.onclick = (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) return; nd.collapsed = !nd.collapsed; renderLayers(); };
      row.oncontextmenu = (e) => { e.preventDefault(); groupMenu(nd, e.clientX, e.clientY); };
      rows.appendChild(row);
      visual.push({ row, node: nd, isGroup: true });
      if (!nd.collapsed && nd.dhSet) {                     // the element's other LOCATIONS: collar + survey rows
        const info = dhSetInfo(nd);
        const rep = groupLayerIds(nd).map(layerById).find((L2) => L2 && L2.dh && L2.docs.dhDoc);
        if (info && rep) {
          const infoRow = (ico, label, tail, menuFor) => {
            const r2 = document.createElement('div');
            r2.className = 'lp-row lp-info' + (dim || !nd.visible ? ' dim' : '');
            r2.style.paddingLeft = `${6 + (depth + 1) * 14}px`;
            const slot = document.createElement('span'); slot.className = 'lp-caret';
            const ic = document.createElement('span'); ic.className = 'lp-infoico'; ic.textContent = ico;
            const nm2 = document.createElement('span'); nm2.className = 'lp-name'; nm2.textContent = label;
            const n2 = document.createElement('span'); n2.className = 'lp-n'; n2.textContent = tail;
            r2.append(slot, ic, nm2, n2);
            const open2 = (e) => { e.preventDefault(); e.stopPropagation(); menuFor(e.clientX, e.clientY); };
            r2.oncontextmenu = open2; r2.onclick = open2;   // info rows have no activate — the menu IS the row
            rows.appendChild(r2);
          };
          infoRow('◈', basename(info.blobs.collar.name || 'collars'), `${rep.docs.dhDoc.header.holes || ''} holes`, (x, y) => collarsRowMenu(nd, x, y));
          infoRow('↧', basename(info.blobs.survey.name || 'survey'), rep.docs.dhDoc.config.method === 'minimumCurvature' || !rep.docs.dhDoc.config.method ? 'min curv' : rep.docs.dhDoc.config.method, (x, y) => surveyRowMenu(nd, x, y));
        }
      }
      if (!nd.collapsed) walk(nd.children, depth + 1, dim || !nd.visible, nd);
    }
  };
  walk(S.layerTree, 0, false);
  syncUndoBtn();                                           // the active layer decides whose paint strokes ↶ undoes
  syncSelBar();
  if (S.layers.length >= 1 && !_lpUserHidden && !$('#layersPanel').classList.contains('show') && !_otherSheetOpen()) toggleLayersPanel(true);   // the panel is the layer's front door — right-click is the menu
  if (S.layers.length === 0) toggleLayersPanel(false);
  if (_propOpen && _propFor !== S.activeId) renderProps();  // re-target, never rebuild under a typing cursor
  if (_propOpen && !S.layers.length) closeProps();
}
