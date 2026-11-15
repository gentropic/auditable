// micro — the layer TREE model: groups, order, visibility, exclusive groups, moving and
// replacing layers in it, and the manifest form a project saves. Layers themselves live
// in S.layers; the tree says where each one sits and whether it shows. The panel that
// draws it is src/layers-panel.js.
import { S, activeLayer, layerById, requestRender } from './state.js';
import { markProjectDirty } from './project.js';
import { dhSetGroupOf } from './drillholes.js';
import { setActiveLayer } from './layers.js';
import { renderLayers } from './layers-panel.js';
const $ = (s) => document.querySelector(s);

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
  snapViews();
}

// a view's row sits right under its model's, wherever the model goes (a drag of
// the model carries its views; a view dragged away comes back)
function snapViews() {
  const views = S.layers.filter((L) => L.viewOf != null && layerById(L.viewOf));
  if (!views.length) return;
  const isV = new Set(views.map((V) => V.id));
  const order = [];                                        // the views' current order, kept
  const pull = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { const nd = arr[i]; if (typeof nd === 'number') { if (isV.has(nd)) { order.unshift(nd); arr.splice(i, 1); } } else pull(nd.children); } };
  pull(S.layerTree);
  const place = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const nd = arr[i];
      if (typeof nd !== 'number') { place(nd.children); continue; }
      const mine = order.filter((v) => layerById(v).viewOf === nd);
      if (mine.length) { arr.splice(i + 1, 0, ...mine); i += mine.length; }
    }
  };
  place(S.layerTree);
  const prune = (arr) => arr.filter((nd) => typeof nd === 'number' || (nd.children = prune(nd.children)).length > 0);
  S.layerTree = prune(S.layerTree);
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
// a group's LAYERS — the files in it. A view (src/layerviews.js) is a row in the
// group but not a member of it: drillhole-set verbs, counts and renames act on
// the models, and a view follows its model.
export function groupLayerIds(nd, out = []) {
  for (const c of nd.children) {
    if (typeof c === 'number') { const L = layerById(c); if (!(L && L.viewOf != null)) out.push(c); }
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

