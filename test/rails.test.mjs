// Unit tests for @gcu/rails state operations.
// Pure functions only; render/interaction tests need a real browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findTab,
  findStack,
  findNode,
  findFloat,
  isSplit,
  walk,
  dockStacks,
  removeTabFromStack,
  cleanup,
  placeStack,
  upgradeState,
  patchTab,
  liveTabIds,
  validateState,
  emptyState,
  makeId,
  freshId,
  serializeState,
} from '../ext/rails/src/state.js';

const stack = (id, ...tabIds) => ({ id, flex: 1, active: tabIds[0], tabs: tabIds.map(t => ({ id: t, title: t.toUpperCase() })) });

// Two columns: s1 (a, b) | s2 (c).
function makeState() {
  return {
    root: { id: 'n1', dir: 'row', children: [stack('s1', 'a', 'b'), stack('s2', 'c')] },
    floats: [],
  };
}

// A row whose second child is a column: s1 | (s2 / s3).
function makeNested() {
  return {
    root: { id: 'n1', dir: 'row', children: [
      stack('s1', 'a'),
      { id: 'n2', dir: 'col', flex: 1, children: [stack('s2', 'b'), stack('s3', 'c')] },
    ] },
    floats: [],
  };
}

// Shape of the docked tree, ids and directions only: 'row(s1,col(s2,s3))'.
function shape(node) {
  if (!node) return 'null';
  if (isSplit(node)) return `${node.dir}(${node.children.map(shape).join(',')})`;
  return node.id;
}

// ── lookup ───────────────────────────────────────────────────────────────

test('findTab locates a tab and returns parent/stack/idx', () => {
  const s = makeState();
  const hit = findTab(s, 'b');
  assert.equal(hit.tab.id, 'b');
  assert.equal(hit.stack.id, 's1');
  assert.equal(hit.parent.id, 'n1');
  assert.equal(hit.idx, 1);
  assert.equal(hit.container, 'dock');
});

test('findTab finds tabs at any depth', () => {
  const s = makeNested();
  const hit = findTab(s, 'c');
  assert.equal(hit.stack.id, 's3');
  assert.equal(hit.parent.id, 'n2');
});

test('findTab returns null for missing id', () => {
  assert.equal(findTab(makeState(), 'nope'), null);
});

test('findTab works when the root is a single stack', () => {
  const s = { root: stack('s1', 'a'), floats: [] };
  const hit = findTab(s, 'a');
  assert.equal(hit.stack.id, 's1');
  assert.equal(hit.parent, null);
});

test('findStack locates a stack and its parent', () => {
  const s = makeNested();
  const hit = findStack(s, 's2');
  assert.equal(hit.stack.id, 's2');
  assert.equal(hit.parent.id, 'n2');
  assert.equal(findStack(s, 'n2'), null, 'a split is not a stack');
});

test('findNode returns node, parent and index', () => {
  const s = makeNested();
  const hit = findNode(s, 's3');
  assert.equal(hit.node.id, 's3');
  assert.equal(hit.parent.id, 'n2');
  assert.equal(hit.index, 1);
  assert.equal(findNode(s, 'n1').parent, null);
  assert.equal(findNode(s, 'missing'), null);
});

test('walk and dockStacks visit in document order', () => {
  const s = makeNested();
  const ids = [];
  walk(s.root, n => ids.push(n.id));
  assert.deepEqual(ids, ['n1', 's1', 'n2', 's2', 's3']);
  assert.deepEqual(dockStacks(s).map(x => x.id), ['s1', 's2', 's3']);
  assert.deepEqual(dockStacks(emptyState()), []);
});

// ── removal + cleanup ────────────────────────────────────────────────────

test('removeTabFromStack removes tab and reassigns active', () => {
  const s = makeState();
  const removed = removeTabFromStack(s, 'a');
  assert.equal(removed.id, 'a');
  assert.equal(s.root.children[0].tabs.length, 1);
  assert.equal(s.root.children[0].active, 'b');
});

test('removeTabFromStack preserves active when removing inactive tab', () => {
  const s = makeState();
  removeTabFromStack(s, 'b');
  assert.equal(s.root.children[0].active, 'a');
});

test('removeTabFromStack returns null when tab missing', () => {
  assert.equal(removeTabFromStack(makeState(), 'nope'), null);
});

test('cleanup drops empty stacks and collapses a one-child split', () => {
  const s = makeState();
  s.root.children[1].tabs = [];
  cleanup(s);
  assert.equal(shape(s.root), 's1', 'the row with one child is replaced by that child');
});

test('cleanup of the last stack empties the dock', () => {
  const s = { root: stack('s1', 'a'), floats: [] };
  s.root.tabs = [];
  cleanup(s);
  assert.equal(s.root, null);
});

test('cleanup: a one-child split hands its place (flex, size, collapse) to the child', () => {
  const s = makeNested();
  s.root.children[1].flex = 2.5;
  s.root.children[1].collapsible = true;
  s.root.children[1].children[0].tabs = [];   // s2 empties; n2 keeps only s3
  cleanup(s);
  assert.equal(shape(s.root), 'row(s1,s3)');
  const s3 = s.root.children[1];
  assert.equal(s3.flex, 2.5);
  assert.equal(s3.collapsible, true);
});

test('cleanup merges a split into a same-direction parent, keeping on-screen shares', () => {
  const s = {
    root: { id: 'n1', dir: 'row', children: [
      { ...stack('s1', 'a'), flex: 2 },
      { id: 'n2', dir: 'row', flex: 2, children: [{ ...stack('s2', 'b'), flex: 1 }, { ...stack('s3', 'c'), flex: 3 }] },
    ] },
    floats: [],
  };
  cleanup(s);
  assert.equal(shape(s.root), 'row(s1,s2,s3)');
  const f = s.root.children.map(c => c.flex);
  assert.deepEqual(f, [2, 0.5, 1.5]);
});

test('cleanup reselects active if it points to a missing tab', () => {
  const s = makeState();
  s.root.children[0].active = 'ghost';
  cleanup(s);
  assert.equal(s.root.children[0].active, 'a');
});

test('cleanup on already-empty workspace is a no-op (empty legal)', () => {
  const s = emptyState();
  cleanup(s);
  assert.equal(s.root, null);
  assert.deepEqual(s.floats, []);
});

test('liveTabIds collects all tab ids in state', () => {
  const ids = liveTabIds(makeNested());
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
});

// ── placeStack: the split operations ─────────────────────────────────────

test('placeStack split: beside a stack in a same-direction parent takes half its share', () => {
  const s = makeState();
  s.root.children[1].flex = 2;
  placeStack(s, { to: 'split', nodeId: 's2', side: 'right' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(s1,s2,s9)');
  assert.equal(s.root.children[1].flex, 1);
  assert.equal(s.root.children[2].flex, 1);
});

test('placeStack split: left/top insert before the target', () => {
  const s = makeState();
  placeStack(s, { to: 'split', nodeId: 's2', side: 'left' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(s1,s9,s2)');
});

test('placeStack split: across the parent axis wraps the target in a new split', () => {
  const s = makeState();
  placeStack(s, { to: 'split', nodeId: 's1', side: 'bottom' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(col(s1,s9),s2)');
  validateState(s);
});

test('placeStack split: the wrapping split takes over the target flex and size', () => {
  const s = makeState();
  s.root.children[0].flex = 3;
  s.root.children[1].size = 250;
  placeStack(s, { to: 'split', nodeId: 's2', side: 'top' }, stack('s9', 'z'));
  const wrap = s.root.children[1];
  assert.equal(shape(wrap), 'col(s9,s2)');
  assert.equal(wrap.size, 250);
  assert.equal(wrap.children[1].size, undefined, 'the wrapped stack sizes by flex now');
});

test('placeStack split: a single-stack root becomes a split', () => {
  const s = { root: stack('s1', 'a'), floats: [] };
  placeStack(s, { to: 'split', nodeId: 's1', side: 'right' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(s1,s9)');
  assert.equal(s.root.children[1].flex, 1, 'splitting one stack halves it');
});

test('placeStack split at the root edge: a full-width row under every column', () => {
  const s = makeNested();
  placeStack(s, { to: 'split', nodeId: 'n1', side: 'bottom' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'col(row(s1,col(s2,s3)),s9)');
  assert.equal(s.root.children[1].flex, 0.5, 'splitting a group gives the newcomer a third');
  validateState(s);
});

test('placeStack split at the root edge along its own axis adds an end child', () => {
  const s = makeState();
  placeStack(s, { to: 'split', nodeId: 'n1', side: 'left' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(s9,s1,s2)');
});

test('placeStack split with no dock makes the stack the root', () => {
  const s = emptyState();
  placeStack(s, { to: 'split', side: 'right' }, stack('s9', 'z'));
  assert.equal(shape(s.root), 's9');
});

test('placeStack insert: a new child of a split at an index', () => {
  const s = makeNested();
  placeStack(s, { to: 'insert', splitId: 'n2', at: 1 }, stack('s9', 'z'));
  assert.equal(shape(s.root), 'row(s1,col(s2,s9,s3))');
  placeStack(s, { to: 'insert', splitId: 'n1' }, stack('s8', 'y'));
  assert.equal(shape(s.root), 'row(s1,col(s2,s9,s3),s8)');
});

test('placeStack rejects bad targets', () => {
  const s = makeState();
  assert.throws(() => placeStack(s, { to: 'insert', splitId: 's1' }, stack('s9', 'z')), /split s1 not found/);
  assert.throws(() => placeStack(s, { to: 'split', nodeId: 's1', side: 'middle' }, stack('s9', 'z')), /invalid side/);
  assert.throws(() => placeStack(s, { to: 'split', nodeId: 'nope', side: 'left' }, stack('s9', 'z')), /not found/);
});

test('moving a lone tab out of its stack and splitting elsewhere normalizes', () => {
  // s2 (c) | s1 (a, b): drag c below s1 → s2 empties, cleanup tidies.
  const s = makeState();
  const tab = removeTabFromStack(s, 'c');
  placeStack(s, { to: 'split', nodeId: 's1', side: 'bottom' }, { id: 's9', tabs: [tab], active: tab.id });
  cleanup(s);
  assert.equal(shape(s.root), 'col(s1,s9)');
  validateState(s);
});

// ── upgrade from the two-level shape ─────────────────────────────────────

test('upgradeState turns rails/stacks into a row of columns', () => {
  const s = upgradeState({
    rails: [
      { id: 'r1', flex: 1, width: 300, collapsible: true, stacks: [
        { id: 's1', flex: 1, height: 200, active: 'a', tabs: [{ id: 'a' }] },
        { id: 's2', flex: 2, active: 'b', tabs: [{ id: 'b' }] },
      ] },
      { id: 'r2', flex: 1.5, stacks: [{ id: 's3', flex: 1, active: 'c', tabs: [{ id: 'c' }] }] },
    ],
    floats: [],
  });
  assert.equal('rails' in s, false);
  assert.equal(shape(s.root), 'row(col(s1,s2),s3)');
  const col = s.root.children[0];
  assert.equal(col.id, 'r1');
  assert.equal(col.size, 300);
  assert.equal(col.collapsible, true);
  assert.equal(col.children[0].size, 200);
  assert.equal('height' in col.children[0], false);
  assert.equal(s.root.children[1].flex, 1.5, 'a one-stack rail hands its flex to the stack');
  validateState(s);
});

test('upgradeState: an empty rails list is an empty dock; floats are kept', () => {
  const s = upgradeState({ rails: [], floats: [{ id: 'f1', x: 0, y: 0, w: 10, h: 10, z: 1, stack: stack('fs', 'x') }] });
  assert.equal(s.root, null);
  assert.equal(s.floats.length, 1);
  validateState(s);
});

test('upgradeState leaves a current state alone and fills in floats', () => {
  const cur = makeNested();
  delete cur.floats;
  const s = upgradeState(cur);
  assert.equal(shape(s.root), 'row(s1,col(s2,s3))');
  assert.deepEqual(s.floats, []);
});

// ── patchTab ─────────────────────────────────────────────────────────────

test('patchTab updates fields and flags chrome-visibility', () => {
  const s = makeState();
  const r1 = patchTab(s, 'a', { title: 'A2' });
  assert.deepEqual(r1, { changed: true, chromeVisible: true });
  assert.equal(findTab(s, 'a').tab.title, 'A2');
  const r2 = patchTab(s, 'a', { payload: 1 });
  assert.deepEqual(r2, { changed: true, chromeVisible: false });
});

test('patchTab no-op for unchanged values', () => {
  const s = makeState();
  assert.equal(patchTab(s, 'a', { title: 'A' }).changed, false);
});

test('patchTab ignores id mutation attempts', () => {
  const s = makeState();
  patchTab(s, 'a', { id: 'zzz' });
  assert.equal(findTab(s, 'a').tab.id, 'a');
});

test('patchTab on missing tab returns unchanged', () => {
  assert.deepEqual(patchTab(makeState(), 'nope', { title: 'x' }), { changed: false, chromeVisible: false });
});

test('Tab.badge is a chrome-visible field', () => {
  const s = makeState();
  assert.deepEqual(patchTab(s, 'a', { badge: 5 }), { changed: true, chromeVisible: true });
  assert.equal(patchTab(s, 'a', { badge: 5 }).changed, false);
  assert.deepEqual(patchTab(s, 'a', { badge: null }), { changed: true, chromeVisible: true });
});

test('preserveOnClose flag is a pass-through on tabs', () => {
  const s = { root: { ...stack('s1', 'a') }, floats: [] };
  s.root.tabs[0].preserveOnClose = true;
  validateState(s);
  assert.equal(findTab(s, 'a').tab.preserveOnClose, true);
  patchTab(s, 'a', { preserveOnClose: false });
  assert.equal(findTab(s, 'a').tab.preserveOnClose, false);
});

// ── validation ───────────────────────────────────────────────────────────

test('validateState passes on well-formed states', () => {
  validateState(makeState());
  validateState(makeNested());
  validateState(emptyState());
  validateState({ root: stack('s1', 'a'), floats: [] });
});

test('validateState rejects a state without root', () => {
  assert.throws(() => validateState({ floats: [] }), /state\.root missing/);
});

test('validateState rejects empty stack', () => {
  const s = makeState();
  s.root.children[1].tabs = [];
  assert.throws(() => validateState(s), /must contain at least one tab/);
});

test('validateState rejects an empty split and a bad direction', () => {
  const s = makeNested();
  s.root.children[1].children = [];
  assert.throws(() => validateState(s), /has no children/);
  const t = makeNested();
  t.root.children[1].dir = 'diagonal';
  assert.throws(() => validateState(t), /dir must be/);
});

test('validateState rejects duplicate ids across splits, stacks and tabs', () => {
  const s = makeNested();
  s.root.children[1].id = 's1';
  assert.throws(() => validateState(s), /duplicate id s1/);
  const t = makeState();
  t.root.children[1].tabs[0].id = 'a';
  t.root.children[1].active = 'a';
  assert.throws(() => validateState(t), /duplicate id a/);
});

test('validateState rejects active pointing to missing tab', () => {
  const s = makeState();
  s.root.children[0].active = 'ghost';
  assert.throws(() => validateState(s), /active references missing tab/);
});

test('collapsed and collapsible pass through on nodes', () => {
  const s = makeNested();
  s.root.children[1].collapsible = true;
  s.root.children[1].collapsed = true;
  validateState(s);
  cleanup(s);
  assert.equal(findNode(s, 'n2').node.collapsed, true);
});

// ── ids ──────────────────────────────────────────────────────────────────

test('emptyState returns valid empty workspace', () => {
  assert.deepEqual(emptyState(), { root: null, floats: [] });
});

test('makeId produces unique ids', () => {
  const a = makeId('t'), b = makeId('t');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('t'));
});

test('freshId never returns an id already in state', () => {
  const s = makeNested();
  for (let i = 0; i < 50; i++) {
    const sid = freshId(s, 's');
    assert.equal(findNode(s, sid), null, `stack id ${sid} collided`);
    s.root.children[1].children.push({ id: sid, tabs: [{ id: 'dummy-' + i }], active: 'dummy-' + i });
  }
});

test('freshId avoids ids from an explicit user seed', () => {
  const s = makeNested();
  assert.ok(!['s1', 's2', 's3'].includes(freshId(s, 's')));
  assert.ok(!['n1', 'n2'].includes(freshId(s, 'n')));
});

// ── serialize ────────────────────────────────────────────────────────────

test('serializeState round-trips through JSON.parse', () => {
  const back = JSON.parse(serializeState(makeNested()));
  assert.equal(shape(back.root), 'row(s1,col(s2,s3))');
  assert.equal(back.root.children[1].children[1].active, 'c');
});

test('serializeState with replacer filters consumer fields', () => {
  const s = makeState();
  s.root.children[0].tabs[0].doc = { big: 'value' };
  const back = JSON.parse(serializeState(s, (key, value) => key === 'doc' ? { $ref: 'filtered' } : value));
  assert.deepEqual(back.root.children[0].tabs[0].doc, { $ref: 'filtered' });
});

// ── floats ───────────────────────────────────────────────────────────────

function makeStateWithFloat() {
  return {
    root: stack('s1', 'a'),
    floats: [
      { id: 'f1', x: 100, y: 100, w: 400, h: 300, z: 1, stack: stack('fs1', 'ft1', 'ft2') },
    ],
  };
}

test('findTab locates tabs inside floats', () => {
  const hit = findTab(makeStateWithFloat(), 'ft1');
  assert.equal(hit.container, 'float');
  assert.equal(hit.float.id, 'f1');
  assert.equal(hit.tab.id, 'ft1');
});

test('findTab distinguishes docked vs float tabs via container', () => {
  const s = makeStateWithFloat();
  assert.equal(findTab(s, 'a').container, 'dock');
  assert.equal(findTab(s, 'ft1').container, 'float');
});

test('findFloat returns the float by id', () => {
  const s = makeStateWithFloat();
  assert.equal(findFloat(s, 'f1').id, 'f1');
  assert.equal(findFloat(s, 'missing'), null);
});

test('findStack finds stacks in both the dock and floats', () => {
  const s = makeStateWithFloat();
  assert.equal(findStack(s, 's1').container, 'dock');
  assert.equal(findStack(s, 'fs1').container, 'float');
});

test('cleanup removes floats whose stack becomes empty', () => {
  const s = makeStateWithFloat();
  s.floats[0].stack.tabs = [];
  cleanup(s);
  assert.equal(s.floats.length, 0);
});

test('cleanup preserves floats with remaining tabs and reselects active', () => {
  const s = makeStateWithFloat();
  s.floats[0].stack.tabs.splice(0, 1);
  cleanup(s);
  assert.equal(s.floats.length, 1);
  assert.equal(s.floats[0].stack.active, 'ft2');
});

test('liveTabIds includes float tab ids', () => {
  const ids = liveTabIds(makeStateWithFloat());
  for (const id of ['a', 'ft1', 'ft2']) assert.equal(ids.has(id), true);
});

test('validateState checks floats', () => {
  validateState(makeStateWithFloat());
  const a = makeStateWithFloat(); delete a.floats[0].x;
  assert.throws(() => validateState(a), /float.*x.*finite/);
  const b = makeStateWithFloat(); delete b.floats[0].stack;
  assert.throws(() => validateState(b), /float.*missing stack/);
  const c = makeStateWithFloat();
  c.floats.push({ ...c.floats[0], stack: stack('fs-dup', 'ft-dup') });
  assert.throws(() => validateState(c), /duplicate id f1/);
  const d = makeStateWithFloat(); d.floats[0].stack.id = 's1';
  assert.throws(() => validateState(d), /duplicate id s1/);
});

test('freshId does not collide with float ids', () => {
  const s = makeStateWithFloat();
  assert.notEqual(freshId(s, 'fs'), 'fs1');
  assert.notEqual(freshId(s, 'f'), 'f1');
});
