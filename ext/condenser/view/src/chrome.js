// @gcu/condenser view — the chrome as plugins.
//
// Everything drawn or placed over the 3D scene is a plugin: the toolbar, the section
// bar, the readouts, the legends, the scale bar, the north arrow, the hole labels. A
// host page adds its own, removes or replaces the built-ins, without forking the view:
//
//   v.chrome.add({
//     id: 'sel-stats', slot: 'top-right', order: 10,
//     mount(el, api) { … },          // DOM: controls, panels (never in a snapshot)
//     measure(api) → { w, h },       // canvas: the size to reserve in the slot …
//     draw(g, api, box) { … },       // … and the drawing, in CSS px from the box's corner
//     click(x, y, e, api) { … },     // a click on the drawing, box-local
//     cursor(x, y, api) → 'pointer', // the cursor over it
//     describe(api) → 'text',        // the drawing as words, for assistive tech (its aria-label)
//     update(changed, api) { … },    // something changed: { view, state, selection, theme, pick, … }
//     unmount() { … },
//   });
//   v.chrome.remove('legend');        // or replace: add with the same id
//
// Slots: the four corners, 'top' and 'bottom' (centred), and 'overlay' — the whole
// canvas, for drawing anchored to the scene (labels). A slot stacks its plugins by
// `order`, from its edge inward, so nothing overlaps and everything reflows on resize.
// Whatever a plugin DRAWS is in snapshots; its DOM is not.

export const SLOTS = ['top-left', 'top', 'top-right', 'bottom-left', 'bottom', 'bottom-right', 'overlay'];

const CSS = `
.cdslot { position:absolute; display:flex; flex-direction:column; gap:6px; pointer-events:none; z-index:4; max-width:calc(100% - 12px); }
.cdslot > * { pointer-events:auto; }
.cdslot.top-left { left:6px; top:6px; align-items:flex-start; }
.cdslot.top-right { right:6px; top:6px; align-items:flex-end; }
.cdslot.top { left:50%; top:6px; transform:translateX(-50%); align-items:center; }
.cdslot.bottom-left { left:6px; bottom:6px; flex-direction:column-reverse; align-items:flex-start; }
.cdslot.bottom-right { right:6px; bottom:6px; flex-direction:column-reverse; align-items:flex-end; }
.cdslot.bottom { left:50%; bottom:6px; transform:translateX(-50%); flex-direction:column-reverse; align-items:center; }
.cdplug { display:flex; flex-direction:column; gap:6px; }
.cdslot.top-right .cdplug, .cdslot.bottom-right .cdplug { align-items:flex-end; }
.cdslot.top .cdplug, .cdslot.bottom .cdplug { align-items:center; }
.cdplug:empty, .cdplug.off { display:none; }
.cdph { flex:none; }
`;

export function createChrome(host, api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  host.appendChild(style);
  const slots = {};
  for (const s of SLOTS) {
    if (s === 'overlay') continue;
    const d = document.createElement('div');
    d.className = `cdslot ${s}`;
    host.appendChild(d);
    slots[s] = d;
  }
  const items = new Map();                                 // id → { def, wrap, ph, box, size }

  const check = (def) => {
    if (!def || typeof def !== 'object') throw new TypeError('condenser: chrome.add() takes a plugin object');
    if (!def.id || typeof def.id !== 'string') throw new TypeError('condenser: a chrome plugin needs an id');
    const slot = def.slot || 'overlay';
    if (!SLOTS.includes(slot)) throw new TypeError(`condenser: chrome plugin '${def.id}': no slot '${slot}' (${SLOTS.join(', ')})`);
    if (!def.mount && !def.draw) throw new TypeError(`condenser: chrome plugin '${def.id}' has neither mount() nor draw()`);
    if (def.draw && slot !== 'overlay' && !def.measure) throw new TypeError(`condenser: chrome plugin '${def.id}' draws in a slot, so it needs measure()`);
    return slot;
  };

  function add(def) {
    const slot = check(def);
    if (items.has(def.id)) remove(def.id);
    const it = { def, slot, wrap: null, ph: null, box: null, size: null };
    if (slot !== 'overlay') {
      const wrap = document.createElement('div');
      wrap.className = 'cdplug';
      wrap.dataset.id = def.id;
      const order = def.order || 0;
      wrap.dataset.order = String(order);
      const parent = slots[slot];
      const next = [...parent.children].find((c) => +c.dataset.order > order);
      parent.insertBefore(wrap, next || null);
      it.wrap = wrap;
      if (def.draw) {                                      // the space a drawing takes, and its clicks
        const ph = document.createElement('div');
        ph.className = 'cdph';
        ph.style.display = 'none';
        const local = (e) => { const r = ph.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        ph.addEventListener('pointerdown', (e) => e.stopPropagation());
        ph.addEventListener('click', (e) => { if (def.click) { const [x, y] = local(e); def.click(x, y, e, api); } });
        ph.addEventListener('pointermove', (e) => { const [x, y] = local(e); ph.style.cursor = (def.cursor && def.cursor(x, y, api)) || ''; });
        wrap.appendChild(ph);
        it.ph = ph;
      }
    }
    items.set(def.id, it);
    if (def.mount) {
      const at = it.wrap || host;
      const el = it.ph ? (() => { const d = document.createElement('div'); at.insertBefore(d, it.ph); return d; })() : at;
      def.mount(el, api);
    }
    if (def.update) def.update({ all: true }, api);
    api.invalidate();
    return def.id;
  }

  function remove(id) {
    const it = items.get(id);
    if (!it) return false;
    items.delete(id);
    try { if (it.def.unmount) it.def.unmount(); } catch (e) { console.error(`condenser: chrome plugin '${id}' unmount threw`, e); }
    if (it.wrap) it.wrap.remove();
    api.invalidate();
    return true;
  }

  // every frame, after the scene: size the drawn plugins' places, let the slots lay them
  // out, then draw each into its box. g is in CSS px.
  function draw(g, W, H) {
    const drawn = [];
    for (const it of items.values()) {
      const d = it.def;
      if (!d.draw) continue;
      if (it.slot === 'overlay') { drawn.push([it, { x: 0, y: 0, w: W, h: H }]); continue; }
      let sz = null;
      try { sz = d.measure(api); } catch (e) { console.error(`condenser: chrome plugin '${d.id}' measure threw`, e); }
      const show = !!(sz && sz.w > 0 && sz.h > 0);
      const key = show ? `${Math.ceil(sz.w)}x${Math.ceil(sz.h)}` : '';
      if (key !== it.size) {
        it.size = key;
        it.ph.style.display = show ? '' : 'none';
        if (show) { it.ph.style.width = `${Math.ceil(sz.w)}px`; it.ph.style.height = `${Math.ceil(sz.h)}px`; }
      }
      if (show) drawn.push([it, null, sz]);
    }
    const hr = host.getBoundingClientRect();
    for (const [it, fixed, sz] of drawn) {
      let box = fixed;
      if (!box) {
        const r = it.ph.getBoundingClientRect();
        box = { x: r.left - hr.left, y: r.top - hr.top, w: sz.w, h: sz.h };
      }
      it.box = box;
      g.save();
      if (!fixed) g.translate(box.x, box.y);
      try { it.def.draw(g, api, box); } catch (e) { console.error(`condenser: chrome plugin '${it.def.id}' draw threw`, e); }
      g.restore();
      // a drawing is an image to assistive tech: describe() is its text
      if (it.ph && it.def.describe) {
        let d = '';
        try { d = String(it.def.describe(api) || ''); } catch { /* no description this frame */ }
        if (d !== it.desc) { it.desc = d; it.ph.setAttribute('role', 'img'); it.ph.setAttribute('aria-label', d); }
      }
    }
  }

  function update(changed) {
    for (const it of items.values()) {
      if (!it.def.update) continue;
      try { it.def.update(changed, api); } catch (e) { console.error(`condenser: chrome plugin '${it.def.id}' update threw`, e); }
    }
  }

  function destroy() {
    for (const id of [...items.keys()]) remove(id);
    style.remove();
    for (const s of Object.values(slots)) s.remove();
  }

  return {
    add, remove, draw, update, destroy,
    has: (id) => items.has(id),
    list: () => [...items.values()].map((it) => ({ id: it.def.id, slot: it.slot, order: it.def.order || 0 })),
    slot: (name) => slots[name],
  };
}
