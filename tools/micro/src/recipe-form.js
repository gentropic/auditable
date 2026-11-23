// micro NEW RECIPE — a recipe written from scratch, in a form generated from the tool's settings
// list (src/tools.js): no analysis to run first, no YAML to know. The same list checks what the form
// makes, so a saved recipe is one a routine will accept.
import { S } from './state.js';
import { floatWin } from './windows.js';
import { toolList, checkParams } from './tools.js';
import { layerTableHeader, schemaExt } from './records.js';
import { writeRecipe } from './recipes.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
const colsOf = (name) => { const L = S.layers.find((x) => x.name === name || (x.label || x.name) === name); const h = L && layerTableHeader(L); return h ? schemaExt(L, h).map((c) => c.name) : []; };

// one setting → { node, get() }; `ctx.layer()` names the layer column pickers read from
function field(key, spec, ctx) {
  const id = `rf-${key}-${Math.random().toString(36).slice(2, 7)}`;
  const tip = [spec.doc, spec.routine === 'required' ? 'a routine must state it' : Array.isArray(spec.routine) ? `a routine allows ${spec.routine.join(' / ')}` : ''].filter(Boolean).join(' — ');
  let input, get;
  switch (spec.type) {
    case 'layer': {
      input = el('select', { id }); input.append(el('option', { value: '', textContent: '—' }));
      for (const L of S.layers) input.append(el('option', { value: L.name, textContent: L.label || L.name }));
      get = () => input.value || undefined; break;
    }
    case 'column': {
      const dl = el('datalist', { id: `${id}-dl` });
      input = el('input', { id, type: 'text', placeholder: 'column (or an expression)' }); input.setAttribute('list', dl.id);
      input.onfocus = () => { dl.textContent = ''; for (const c of colsOf(ctx.layer())) dl.append(el('option', { value: c })); };
      get = () => input.value.trim() || undefined;
      return { node: el('label', { className: 'rf-row', title: tip }, el('span', { textContent: key + (spec.required ? ' *' : '') }), input, dl), get, input };
    }
    case 'numbers': input = el('input', { id, type: 'text', placeholder: 'e.g. 0.3, 0.5, 1' }); get = () => { const t = input.value.trim(); return t ? t.split(/[\s,;]+/).filter(Boolean).map(Number) : undefined; }; break;
    case 'number': case 'int': input = el('input', { id, type: 'number', step: spec.type === 'int' ? '1' : 'any', placeholder: spec.default != null ? String(spec.default) : '' }); get = () => (input.value === '' ? undefined : +input.value); break;
    case 'enum': input = el('select', { id }); for (const v of spec.values) input.append(el('option', { value: v, textContent: v, selected: v === spec.default })); get = () => input.value; break;
    case 'bool': input = el('input', { id, type: 'checkbox', checked: !!spec.default }); get = () => input.checked; break;
    case 'list': {
      const box = el('div', { className: 'rf-list' }), items = [];
      const add = () => {
        const sub = el('div', { className: 'rf-item' }), fs = Object.entries(spec.item).map(([k, s2]) => [k, field(k, s2, { layer: () => (fs.find(([n]) => n === 'layer') ? fs.find(([n]) => n === 'layer')[1].get() : null) || ctx.layer() })]);
        for (const [, f] of fs) sub.append(f.node);
        const x = el('button', { className: 'awin-btn', textContent: '×', title: 'remove' }); x.onclick = () => { sub.remove(); items.splice(items.indexOf(fs), 1); };
        sub.append(x); box.insertBefore(sub, plus); items.push(fs);
      };
      const plus = el('button', { className: 'awin-btn', textContent: `+ ${key === 'series' ? 'series' : key.replace(/s$/, '')}` }); plus.onclick = add;
      box.append(plus); add();
      get = () => { const v = items.map((fs) => Object.fromEntries(fs.map(([k, f]) => [k, f.get()]).filter(([, x]) => x !== undefined && x !== ''))).filter((o) => Object.keys(o).length); return v.length ? v : undefined; };
      return { node: el('div', { className: 'rf-row rf-wide', title: tip }, el('span', { textContent: key + (spec.required ? ' *' : '') }), box), get };
    }
    default: {                                            // 'any': JSON, or a comma list of names
      input = el('input', { id, type: 'text', placeholder: key === 'density' ? '{"const": 2.7}  or  {"col": "SG"}' : 'a, b  or JSON' });
      get = () => { const t = input.value.trim(); if (!t) return undefined; try { return JSON.parse(t); } catch { return t.split(/\s*,\s*/).filter(Boolean); } };
    }
  }
  return { node: el('label', { className: 'rf-row', title: tip }, el('span', { textContent: key + (spec.required ? ' *' : '') }), input), get, input };
}

export function openRecipeForm(toolName = null, { onSaved = null, save = null } = {}) {
  const tools = toolList();
  const win = floatWin({ title: 'new recipe', sub: 'from scratch', x: 160, y: 80, w: 460, h: Math.min(560, innerHeight - 120) });
  win.el.dataset.recipeForm = '1';
  const top = el('div', { className: 'rf-top' });
  const toolSel = el('select'); for (const t of tools) toolSel.append(el('option', { value: t.name, textContent: t.label, selected: t.name === toolName }));
  const nameIn = el('input', { type: 'text', placeholder: 'recipe name' });
  top.append(el('label', { className: 'rf-row' }, el('span', { textContent: 'tool' }), toolSel), el('label', { className: 'rf-row' }, el('span', { textContent: 'name *' }), nameIn));
  const form = el('div', { className: 'rf-form' }), msg = el('div', { className: 'rw-prevline fail' });
  const saveB = el('button', { className: 'awin-btn', textContent: 'Save recipe' });
  win.body.append(top, form, msg, el('div', { className: 'rw-bar' }, saveB));
  let fields = [];
  const build = () => {
    form.textContent = ''; msg.textContent = '';
    const t = tools.find((x) => x.name === toolSel.value);
    const layerOf = () => { const f = fields.find(([k]) => k === 'layer' || k === 'model'); return f ? f[1].get() : null; };
    fields = Object.entries(t.params).map(([k, spec]) => [k, field(k, spec, { layer: layerOf })]);
    for (const [, f] of fields) form.append(f.node);
  };
  toolSel.onchange = build; build();
  const collect = () => Object.fromEntries(fields.map(([k, f]) => [k, f.get()]).filter(([, v]) => v !== undefined && v !== ''));
  win.collect = collect;
  saveB.onclick = async () => {
    const name = nameIn.value.trim(), params = collect(), tool = toolSel.value;
    if (!name) { msg.textContent = 'a name, please'; return; }
    const { errors } = checkParams(tool, params);
    if (errors.length) { msg.textContent = errors.join(' · '); return; }
    // a recipe a window can run may still be one a routine refuses (a routine must state its cutoffs,
    // band widths, scope all…) — it saves, and says what a routine would need
    const routineOnly = checkParams(tool, params, { routine: true }).errors.filter((e) => !errors.includes(e));
    const r = await (save || writeRecipe)(name, tool, params);
    if (r) {
      win.close(); if (onSaved) onSaved(r);
      if (routineOnly.length) document.querySelector('#meta').textContent = `recipe “${name}” saved — to use it in a routine, add: ${routineOnly.join(' · ')}`;
    }
  };
  return win;
}
