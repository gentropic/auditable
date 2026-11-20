// The view's state, for a page — the same contract anywidget's model gives the view in
// Jupyter, so view.js runs unchanged on either (see its header).
//
//   const store = createStore({ height: 520, _styles: [...] });
//   store.get(key) · store.set(key, value) · store.save_changes()
//   store.on('change:<key>', fn) · store.on('msg:custom', fn) · store.off(ev, fn)
//   store.send(content, buffers)    the view → its host: delivered to on('send', fn)
//   store.emit(content, buffers)    the host → the view: delivered to on('msg:custom', fn)
//
// Semantics copied from anywidget's model (Backbone), because the view relies on them:
//   - set() fires 'change:<key>' synchronously — the view hears its own writes
//   - setting a value EQUAL to the current one fires nothing; equality is deep for plain
//     data (objects, arrays, typed arrays), identity for anything else. The view writes
//     back fresh `_styles` arrays; an identity check would echo forever.
//   - save_changes() publishes to the kernel in Jupyter; a page has no kernel, so here it
//     only notifies on('save', fn) — a host persisting state() can listen there.

function _same(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    if (a instanceof DataView) return a.buffer === b.buffer && a.byteOffset === b.byteOffset;   // payloads: identity
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_same(a[i], b[i])) return false;
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !_same(a[k], b[k])) return false;
  return true;
}

export function createStore(initial = {}) {
  const state = { ...initial };
  const subs = new Map();                                  // event → Set(fn)
  const fire = (ev, ...args) => {
    const set = subs.get(ev);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(...args); } catch (e) { if (typeof console !== 'undefined') console.error(`condenser view: a '${ev}' handler threw`, e); }
    }
  };
  return {
    get(key) { return state[key]; },
    set(key, value) {
      if (_same(state[key], value)) return;
      state[key] = value;
      fire('change:' + key, value);
      fire('change', key, value);
    },
    save_changes() { fire('save'); },
    on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); },
    off(ev, fn) { const s = subs.get(ev); if (s) s.delete(fn); },
    send(content, buffers) { fire('send', content, buffers || []); },
    emit(content, buffers) { fire('msg:custom', content, buffers || []); },
    // every key and value, for a host that saves the view (step 2's state() reads this)
    snapshot() { return { ...state }; },
  };
}

export { _same as _sameValue };
