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
const stack = [];
let undoing = false;

export function pushUndo(label, undo, { key = null } = {}) {
  if (undoing) return;
  const top = stack[stack.length - 1], now = Date.now();
  if (key && top && top.key === key && now - top.at < COALESCE_MS) { top.at = now; return; }
  stack.push({ label, undo, key, at: now });
  if (stack.length > MAX) stack.shift();
}
export const isUndoing = () => undoing;
export const undoLabel = () => (stack.length ? stack[stack.length - 1].label : null);
export function clearUndo() { stack.length = 0; }
// → the label undone, or null when there was nothing
export async function undoLast() {
  const e = stack.pop();
  if (!e) return null;
  // only the SYNCHRONOUS part is guarded: the restore's own recording happens
  // there (re-applying a selection); a user action while an async restore runs
  // (a filter re-sweeping) is a real step and must record
  let pr;
  undoing = true;
  try { pr = e.undo(); } finally { undoing = false; }
  await pr;
  return e.label;
}
