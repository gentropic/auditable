// @gcu/rails — state operations
// Pure functions over the State tree. Zero DOM, zero imports.
//
// State shape (informative, see SPEC §3):
//   State = { root: Node | null, floats: Float[] }
//   Node  = Split | Stack
//   Split = { id, dir: 'row' | 'col', children: Node[], flex?, size?, collapsible?, collapsed? }
//   Stack = { id, tabs: Tab[], active, flex?, size?, tabPosition?, collapsible?, collapsed? }
//   Tab   = { id, title, closeable?, draggable?, ...consumer }
//   Float = { id, stack: Stack, x, y, w, h, z, minimized?, maximized? }
//
// A Split lays its children out along `dir` ('row' = left to right, 'col' =
// top to bottom). `flex` is a child's proportional weight inside its parent;
// `size` is a fixed pixel size along the parent's axis. After cleanup() the
// tree is normal: no empty stacks, no split with fewer than two children, and
// no split directly inside a split of the same direction.

let _nextIdCounter = 1;

export function isSplit(node) {
  return !!node && Array.isArray(node.children);
}

// Bare numeric id — only safe when state is empty or ids don't collide.
// Prefer freshId(state, prefix) for runtime insertions.
export function makeId(prefix) {
  return prefix + (_nextIdCounter++).toString(36);
}

// Depth-first walk of the docked tree. fn(node, parent, index).
export function walk(node, fn, parent = null, index = 0) {
  if (!node) return;
  fn(node, parent, index);
  if (isSplit(node)) node.children.forEach((c, i) => walk(c, fn, node, i));
}

// Every docked stack, in document order.
export function dockStacks(state) {
  const out = [];
  walk(state.root, n => { if (!isSplit(n)) out.push(n); });
  return out;
}

// Collect every id currently in state (splits, stacks, tabs, floats).
function collectIds(state) {
  const used = new Set();
  walk(state.root, n => {
    if (n.id) used.add(n.id);
    for (const tab of n.tabs || []) if (tab.id) used.add(tab.id);
  });
  for (const float of state.floats || []) {
    if (float.id) used.add(float.id);
    if (float.stack?.id) used.add(float.stack.id);
    for (const tab of float.stack?.tabs || []) {
      if (tab.id) used.add(tab.id);
    }
  }
  return used;
}

// Generate an id with the given prefix that doesn't collide with anything
// currently in state. Use this for any id created at runtime — seed states
// with user-chosen ids (e.g., 's1', 's2') are common and will otherwise clash
// with naive counter-based ids.
export function freshId(state, prefix) {
  const used = collectIds(state);
  while (true) {
    const id = prefix + (_nextIdCounter++).toString(36);
    if (!used.has(id)) return id;
  }
}

// Find a docked node by id → { node, parent, index } or null.
export function findNode(state, id) {
  let hit = null;
  walk(state.root, (node, parent, index) => {
    if (!hit && node.id === id) hit = { node, parent, index };
  });
  return hit;
}

export function findTab(state, tabId) {
  let hit = null;
  walk(state.root, (node, parent) => {
    if (hit || isSplit(node)) return;
    const idx = node.tabs.findIndex(t => t.id === tabId);
    if (idx >= 0) hit = { parent, stack: node, tab: node.tabs[idx], idx, container: 'dock' };
  });
  if (hit) return hit;
  for (const float of state.floats || []) {
    if (!float.stack) continue;
    const idx = float.stack.tabs.findIndex(t => t.id === tabId);
    if (idx >= 0) return { float, stack: float.stack, tab: float.stack.tabs[idx], idx, container: 'float' };
  }
  return null;
}

export function findFloat(state, floatId) {
  for (const float of state.floats || []) {
    if (float.id === floatId) return float;
  }
  return null;
}

export function findStack(state, stackId) {
  const hit = findNode(state, stackId);
  if (hit && !isSplit(hit.node)) return { parent: hit.parent, stack: hit.node, container: 'dock' };
  for (const float of state.floats || []) {
    if (float.stack && float.stack.id === stackId) {
      return { float, stack: float.stack, container: 'float' };
    }
  }
  return null;
}

// Remove a tab from its stack. Returns the removed Tab or null.
// Leaves the stack potentially empty; call cleanup(state) after.
export function removeTabFromStack(state, tabId) {
  const hit = findTab(state, tabId);
  if (!hit) return null;
  hit.stack.tabs.splice(hit.idx, 1);
  if (hit.stack.active === tabId && hit.stack.tabs.length) {
    const fallback = Math.max(0, hit.idx - 1);
    hit.stack.active = hit.stack.tabs[fallback].id;
  }
  return hit.tab;
}

function fixActive(stack) {
  if (!stack.tabs.find(t => t.id === stack.active)) stack.active = stack.tabs[0].id;
}

// Normalize a subtree. Returns the node to keep in its place, or null.
//   - empty stacks go;
//   - a split's same-direction child split is merged into it (weights scaled
//     so the merged children keep their on-screen share);
//   - a split left with one child is replaced by that child, which takes over
//     the split's place: its flex, size and collapse settings.
function tidy(node) {
  if (!isSplit(node)) {
    if (!node.tabs || node.tabs.length === 0) return null;
    fixActive(node);
    return node;
  }
  const out = [];
  for (const c of node.children.map(tidy)) {
    if (!c) continue;
    if (isSplit(c) && c.dir === node.dir && c.size == null && !c.collapsed) {
      const sum = c.children.reduce((a, k) => a + (k.flex ?? 1), 0) || 1;
      const scale = (c.flex ?? 1) / sum;
      for (const k of c.children) { k.flex = (k.flex ?? 1) * scale; out.push(k); }
    } else {
      out.push(c);
    }
  }
  if (out.length === 0) return null;
  if (out.length === 1) {
    const only = out[0];
    if (node.flex != null) only.flex = node.flex; else delete only.flex;
    if (node.size != null) only.size = node.size; else delete only.size;
    if (node.collapsible) only.collapsible = true;
    if (node.collapsed) only.collapsed = true;
    return only;
  }
  node.children = out;
  return node;
}

// Cleanup pass: drop empty stacks and floats, normalize the docked tree,
// reselect active where needed.
//
// Caller is responsible for deciding when to evict panels: closeTab evicts,
// moveTab does not. This function handles the structural cleanup of empty
// containers and does NOT touch the panel cache.
export function cleanup(state) {
  state.root = state.root ? tidy(state.root) : null;

  // Empty float's stack → float removed entirely (invariant 3).
  if (Array.isArray(state.floats)) {
    state.floats = state.floats.filter(f => f.stack && f.stack.tabs.length > 0);
    for (const f of state.floats) fixActive(f.stack);
  }
}

const SIDE_DIR = { left: 'row', right: 'row', top: 'col', bottom: 'col' };

// Place a new stack in the docked tree. Mutates state. Targets:
//   { to: 'insert', splitId, at }   — a new child of an existing split
//                                     (at = child index; default: the end)
//   { to: 'split', nodeId, side }   — beside an existing node; side is
//                                     'left' | 'right' | 'top' | 'bottom'
// The caller fills the stack's tabs (before or after) and runs cleanup().
export function placeStack(state, target, stack) {
  if (target.to === 'insert') {
    const hit = findNode(state, target.splitId);
    if (!hit || !isSplit(hit.node)) throw new Error(`rails: split ${target.splitId} not found`);
    const split = hit.node;
    stack.flex = avgFlex(split.children);
    const at = target.at ?? split.children.length;
    split.children.splice(Math.max(0, Math.min(at, split.children.length)), 0, stack);
    return;
  }
  if (target.to !== 'split') throw new Error(`rails: placeStack can't handle ${target.to}`);
  const dir = SIDE_DIR[target.side];
  if (!dir) throw new Error(`rails: invalid side ${target.side}`);
  const before = target.side === 'left' || target.side === 'top';

  if (!state.root) {
    state.root = stack;
    return;
  }
  const hit = target.nodeId == null ? { node: state.root, parent: null, index: 0 }
                                    : findNode(state, target.nodeId);
  if (!hit) throw new Error(`rails: node ${target.nodeId} not found`);
  const { node, parent, index } = hit;

  if (parent && parent.dir === dir) {
    // Same axis as the parent: take half of the target's share.
    if (node.size != null) {
      stack.flex = avgFlex(parent.children);
    } else {
      const half = (node.flex ?? 1) / 2;
      node.flex = half;
      stack.flex = half;
    }
    parent.children.splice(before ? index : index + 1, 0, stack);
    return;
  }
  if (isSplit(node) && node.dir === dir) {
    // Edge of a split along its own axis: a new end child.
    stack.flex = avgFlex(node.children);
    if (before) node.children.unshift(stack); else node.children.push(stack);
    return;
  }
  // Different axis: wrap the target in a new split. Splitting a single stack
  // halves it; splitting a group gives the newcomer a third.
  const wrap = { id: freshId(state, 'n'), dir, children: before ? [stack, node] : [node, stack] };
  if (node.flex != null) wrap.flex = node.flex;
  if (node.size != null) wrap.size = node.size;
  delete node.size;
  node.flex = 1;
  stack.flex = isSplit(node) ? 0.5 : 1;
  if (parent) parent.children[index] = wrap;
  else state.root = wrap;
}

function avgFlex(nodes) {
  const flexed = nodes.filter(n => n.size == null);
  if (!flexed.length) return 1;
  return flexed.reduce((a, n) => a + (n.flex ?? 1), 0) / flexed.length;
}

// Collect the set of tab ids currently in state. Used to decide panel evictions.
export function liveTabIds(state) {
  const ids = new Set();
  for (const stack of dockStacks(state)) {
    for (const tab of stack.tabs) ids.add(tab.id);
  }
  for (const float of state.floats || []) {
    for (const tab of float.stack?.tabs || []) ids.add(tab.id);
  }
  return ids;
}

// Bring a state into the current shape. Accepts the pre-tree shape
// ({ rails: [{ stacks: [...] }] } — columns of vertically stacked groups),
// which is a row split of column splits. Returns the same object, mutated.
export function upgradeState(state) {
  if (!state || typeof state !== 'object') return state;
  if (!Array.isArray(state.floats)) state.floats = [];
  if (Array.isArray(state.rails) && !('root' in state)) {
    const rails = state.rails;
    delete state.rails;
    const asSize = (n, key) => {
      if (n[key] != null) { n.size = n[key]; }
      delete n[key];
    };
    const cols = rails.map(r => {
      const col = { id: r.id, dir: 'col', children: (r.stacks || []).map(s => { asSize(s, 'height'); return s; }) };
      if (r.flex != null) col.flex = r.flex;
      if (r.width != null) col.size = r.width;
      if (r.collapsible) col.collapsible = true;
      if (r.collapsed) col.collapsed = true;
      return col;
    });
    state.root = cols.length ? { id: null, dir: 'row', children: cols } : null;
    if (state.root) state.root.id = freshId(state, 'n');
    // Normalize without dropping anything validate would reject: an empty
    // legacy rail had no tabs anyway.
    state.root = state.root ? tidy(state.root) : null;
  }
  if (!('root' in state)) state.root = null;
  return state;
}

// Validate that a state satisfies the invariants (SPEC §3). Throws on violation.
// Run after deserialize / programmatic state replacement. Skipped in hot paths.
export function validateState(state) {
  if (!state || !('root' in state)) {
    throw new Error('rails: state.root missing (null for an empty dock)');
  }
  const seen = new Set();
  const claim = (id, what) => {
    if (!id) throw new Error(`rails: ${what} missing id`);
    if (seen.has(id)) throw new Error(`rails: duplicate id ${id}`);
    seen.add(id);
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') throw new Error('rails: invalid node');
    if (isSplit(node)) {
      claim(node.id, 'split');
      if (node.dir !== 'row' && node.dir !== 'col') {
        throw new Error(`rails: split ${node.id} dir must be 'row' or 'col'`);
      }
      if (node.children.length === 0) throw new Error(`rails: split ${node.id} has no children`);
      node.children.forEach(visit);
    } else {
      validateStack(node, claim);
    }
  };
  if (state.root) visit(state.root);

  for (const float of state.floats || []) {
    claim(float.id, 'float');
    if (!float.stack) throw new Error(`rails: float ${float.id} missing stack`);
    validateStack(float.stack, claim);
    for (const dim of ['x', 'y', 'w', 'h', 'z']) {
      if (typeof float[dim] !== 'number' || !Number.isFinite(float[dim])) {
        throw new Error(`rails: float ${float.id} ${dim} must be a finite number`);
      }
    }
  }
}

function validateStack(stack, claim) {
  claim(stack.id, 'stack');
  if (!Array.isArray(stack.tabs) || stack.tabs.length === 0) {
    throw new Error(`rails: stack ${stack.id} must contain at least one tab`);
  }
  for (const tab of stack.tabs) claim(tab.id, 'tab');
  if (!stack.tabs.find(t => t.id === stack.active)) {
    throw new Error(`rails: stack ${stack.id} active references missing tab ${stack.active}`);
  }
}

// Merge-patch a tab's fields. Returns {changed, chromeVisible} for render routing.
// chromeVisible fields force a structural strip rebuild; others are payload-only.
const CHROME_VISIBLE_FIELDS = new Set(['title', 'closeable', 'draggable', 'badge']);

export function patchTab(state, tabId, patch) {
  const hit = findTab(state, tabId);
  if (!hit) return { changed: false, chromeVisible: false };
  let changed = false;
  let chromeVisible = false;
  for (const key of Object.keys(patch)) {
    if (key === 'id') continue;
    if (hit.tab[key] !== patch[key]) {
      hit.tab[key] = patch[key];
      changed = true;
      if (CHROME_VISIBLE_FIELDS.has(key)) chromeVisible = true;
    }
  }
  return { changed, chromeVisible };
}

// Serialize state to JSON. Consumer passes a replacer for non-JSON tab fields.
export function serializeState(state, replacer) {
  return JSON.stringify(state, replacer);
}

// Default empty state — valid (an empty workspace is legal).
export function emptyState() {
  return { root: null, floats: [] };
}
