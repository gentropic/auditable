// micro undo — ONE history of reversible actions, behind Ctrl+Z after the paint
// stack. An entry is { label, undo }: undo() puts the state back (and may be
// async). What records here: a selection replaced or cleared, a calc column
// removed, a filter changed, a styling rule removed. Paint keeps its own
// per-layer stack (it is checked first) — strokes are many and cheap to replay.
//
// `undoing` is set while an entry's synchronous part runs, so the action it calls
// to restore the state doesn't record itself as a new step. A step on the SAME key (a layer's
// selection) within COALESCE_MS replaces nothing — the first one's "before" is
// kept, so a rapid series of updates undoes as one.
const MAX = 50, COALESCE_MS = 500;
//
// REDO: an entry may carry `redo` (puts the AFTER state back). Undoing such an
// entry moves it to the redo stack; redoing moves it back. Any fresh step clears
// redo (the usual rule — a new edit forks the history), and tells onFreshStep
// listeners so the paint stacks, which live per layer, can drop theirs too.
const stack = [], redoStack = [];
let undoing = false;
// told whenever the history changes — the phone's undo/redo buttons follow it
const listeners = new Set(), freshListeners = new Set();
export function onUndoChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onFreshStep(fn) { freshListeners.add(fn); return () => freshListeners.delete(fn); }
const changed = () => { for (const fn of listeners) fn(); };

// a GROUP makes one user gesture one step: a lasso over a block model and a drillhole
// layer recorded a step per layer, so one undo took back half the gesture. Inside a
// group, steps collect (one per key — the first BEFORE, the latest AFTER) and land as
// a single entry when the outermost group ends.
let group = null, groupDepth = 0;
export function withUndoGroup(label, fn) {
  if (undoing) return fn();
  if (!groupDepth++) group = { label, parts: [] };
  let r;
  try { r = fn(); } catch (e) { endGroup(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(endGroup);
  endGroup();
  return r;
}
function endGroup() {
  if (--groupDepth) return;
  const g = group; group = null;
  if (!g.parts.length) return;
  if (g.parts.length === 1) { const p = g.parts[0]; pushUndo(p.label, p.undo, { key: p.key, redo: p.redo }); return; }
  const parts = g.parts, redoable = parts.every((p) => p.redo);
  // every part's synchronous restore runs INSIDE the undoing guard (an awaited loop
  // would drop the guard after the first part, and the rest would record themselves)
  const all = (fns) => Promise.all(fns.map((f) => f()));
  pushUndo(g.label, () => all(parts.map((p) => p.undo).reverse()),
    { redo: redoable ? () => all(parts.map((p) => p.redo)) : null });
}

export function pushUndo(label, undo, { key = null, redo = null } = {}) {
  if (undoing) return;
  if (group) {
    const same = key && group.parts.find((p) => p.key === key);
    if (same) same.redo = redo; else group.parts.push({ label, undo, redo, key });
    return;
  }
  const top = stack[stack.length - 1], now = Date.now();
  if (key && top && top.key === key && now - top.at < COALESCE_MS) { top.at = now; top.redo = redo; return; }   // keep the first BEFORE, the latest AFTER
  stack.push({ label, undo, redo, key, at: now });
  if (stack.length > MAX) stack.shift();
  freshStep();
}
// a new edit outside this history (a paint stroke) forks it as well
export function freshStep() {
  redoStack.length = 0;
  for (const fn of freshListeners) fn();
  changed();
}
export const isUndoing = () => undoing;
export const undoLabel = () => (stack.length ? stack[stack.length - 1].label : null);
export const undoTopRedoable = () => !!(stack.length && stack[stack.length - 1].redo);
export const redoLabel = () => (redoStack.length ? redoStack[redoStack.length - 1].label : null);
export function clearUndo() { stack.length = 0; redoStack.length = 0; changed(); }
// only the SYNCHRONOUS part is guarded: the restore's own recording happens
// there (re-applying a selection); a user action while an async restore runs
// (a filter re-sweeping) is a real step and must record
async function run(fn) {
  let pr;
  undoing = true;
  try { pr = fn(); } finally { undoing = false; }
  await pr;
}
// → { label, redoable }, or null when there was nothing
export async function undoLast() {
  const e = stack.pop();
  if (!e) return null;
  if (e.redo) redoStack.push(e);
  changed();
  await run(e.undo);
  return { label: e.label, redoable: !!e.redo };
}
// → the label redone, or null when there was nothing
export async function redoLast() {
  const e = redoStack.pop();
  if (!e) return null;
  stack.push(e);
  changed();
  await run(e.redo);
  return e.label;
}
