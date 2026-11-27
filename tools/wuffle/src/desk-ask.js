// wuffle desk — ASK: a small form for a menu item that needs values (a slope face, an angle, a layer, a
// column). It returns the values; the menu turns them into the console's own command line and runs that,
// so a menu and a typed line make the same change and land in the same history.
//
// fields: [{ key, label, type: 'text' | 'number' | 'select' | 'check' | 'area', value, options: [[value, text]],
//            placeholder, hint, required, showIf: (values) => bool }]
// → { key: value } (numbers as numbers, checks as booleans), or null when cancelled.

import { Dialog } from '../../../ext/dialog/index.js';

const h = (t, cls, text) => { const e = document.createElement(t); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function ask({ title, note = null, fields, okLabel = 'OK', width = 440, check = null }) {
  return new Dialog({
    title, width,
    render(body, ctx) {
      if (note) body.append(h('p', 'wpnote', note));
      const inputs = new Map(), rows = new Map();
      const values = () => Object.fromEntries(fields.map((f) => {
        const el = inputs.get(f.key);
        if (f.type === 'check') return [f.key, el.checked];
        if (f.type === 'number') return [f.key, el.value.trim() === '' ? null : +el.value];
        return [f.key, el.value];
      }));
      const msg = h('p', 'wpnote'), bar = h('div', 'wpbar'), ok = h('button', 'primary', okLabel), cancel = h('button', null, 'Cancel');
      ok.type = cancel.type = 'button'; ok.dataset.default = 'true';
      let touched = false;                                 // what is missing is said quietly until you start typing
      const refresh = (e) => {
        if (e) touched = true;
        const v = values();
        for (const f of fields) if (f.showIf) { const hid = !f.showIf(v); rows.get(f.key).hidden = hid; rows.get(f.key).style.display = hid ? 'none' : ''; const n = rows.get(f.key + '·hint'); if (n) n.hidden = hid; }
        const missing = fields.filter((f) => f.required && !rows.get(f.key).hidden && (v[f.key] == null || v[f.key] === ''));
        const why = missing.length ? `${missing.map((f) => f.label).join(', ')} — needed` : check ? check(v) : null;
        msg.textContent = why || ''; msg.classList.toggle('bad', !!why && touched); ok.disabled = !!why;
      };
      for (const f of fields) {
        let el;
        if (f.type === 'select') { el = h('select'); for (const [v, t] of f.options) el.append(new Option(t, v)); if (f.value != null) el.value = f.value; }
        else if (f.type === 'area') { el = h('textarea'); el.rows = f.rows || 4; el.value = f.value ?? ''; el.style.cssText = 'font:12px var(--w-mono);width:100%;box-sizing:border-box;resize:vertical;background:var(--w-bg-bright);color:var(--w-text);border:1px solid var(--w-border);border-radius:3px;padding:4px 6px'; }
        else { el = h('input'); el.type = f.type === 'check' ? 'checkbox' : f.type === 'number' ? 'number' : 'text'; if (f.type === 'check') el.checked = !!f.value; else if (f.value != null) el.value = f.value; if (f.step) el.step = f.step; }
        if (f.placeholder) el.placeholder = f.placeholder;
        el.dataset.key = f.key; inputs.set(f.key, el);
        el.addEventListener('input', refresh); el.addEventListener('change', refresh);
        const r = h('label', 'wprow'); r.append(h('span', null, f.label), el);
        rows.set(f.key, r); body.append(r);
        if (f.hint) { const n = h('p', 'wpnote', f.hint); n.style.margin = '-2px 0 6px 140px'; r.after(n); rows.set(f.key + '·hint', n); }
      }
      refresh();
      bar.append(cancel, ok); body.append(msg, bar);
      cancel.onclick = () => ctx.close(null);
      ok.onclick = () => { if (!ok.disabled) ctx.close(values()); };
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !ok.disabled) { e.preventDefault(); ctx.close(values()); } });
      setTimeout(() => body.querySelector('input:not([type=checkbox]), textarea, select')?.focus(), 0);
    },
  }).show();
}
