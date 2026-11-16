// micro — a VIEW's own category column. A model's category is baked into its
// chunks (one class code per record, from header.mapping.cat); changing it
// re-reads the file, which would change the model and every view of it. A view
// that classes by ANOTHER text column instead reads that one column once into a
// per-record code array and hands it to the renderer as the layer's code
// texture — the slot rule-based styling and painted columns already use, where
// the code substitutes for the chunk's class code. The palette, the per-class
// eyes, the legend and pick culling all read the substituted code, so the
// Classes list works on a view's column unchanged: layerClassInfo answers with
// the view's dictionary and ensureCatCounts with its counts.
//
// The view keeps the column NAME (L.catCol, display state: it persists) and
// the codes it derived (L._viewCat, rebuilt after a re-read).
import { S, requestRender } from './state.js';
import { layerRecords, layerTableHeader, attrRowCountOf, colIsNumeric } from './records.js';
import { colorSelOf } from './ramp.js';

export const VIEW_CAT_MAX = 255;                            // codes 0..254 are values; 255 = every value past that
const OTHER = '(other values)';

// the model's own category column, by name (null when it has none)
export function modelCatName(L) {
  const h = layerTableHeader(L);
  return h && h.categories && h.mapping && h.mapping.cat != null ? h.columns[h.mapping.cat] : null;
}

// the text columns a view can class by (coordinates and numbers are left out)
export function viewTextColumns(L) {
  const h = layerTableHeader(L); if (!h) return [];
  return h.columns.filter((_, i) => !colIsNumeric(L, h, i));
}

// the column this view classes by instead of its model's, or null
export function viewCatName(L) {
  if (!L || L.viewOf == null || !L.catCol) return null;
  return L.catCol === modelCatName(L) ? null : L.catCol;
}

// the derived codes, when they are current (same column, same document)
export function viewCatData(L) {
  const name = viewCatName(L), v = L && L._viewCat;
  return name && v && v.name === name && v.hdr === layerTableHeader(L) ? v : null;
}

// read the column once → { names, codes, counts }. Numbered as the renderer
// numbers records (layerRecords), so code r colours record r.
export function ensureViewCat(L) {
  const name = viewCatName(L);
  if (!name) return Promise.resolve(null);
  const have = viewCatData(L); if (have) return Promise.resolve(have);
  if (L._viewCatBusy && L._viewCatBusy.name === name) return L._viewCatBusy.p;
  const h = layerTableHeader(L);
  const ci = h ? h.columns.indexOf(name) : -1;
  if (ci < 0) return Promise.reject(new Error(`no column “${name}” on “${L.label || L.name}”`));
  const p = (async () => {
    const n = attrRowCountOf(L) || 0;
    const raw = new Uint16Array(n);                         // first-seen index, remapped to sorted below
    const seen = new Map(); const order = [];
    let overflow = false, rec = 0;
    $meta(`class by ${name}: reading…`);
    for await (const { raw: f0, rec: r } of layerRecords(L, (a, b) => $meta(`class by ${name}: ${b ? Math.min(100, Math.round((100 * a) / b)) + '%' : a.toLocaleString()}`))) {
      if (r >= n) break;
      const s = f0[ci] == null ? '' : String(f0[ci]).trim();
      let k = seen.get(s);
      if (k == null) {
        if (order.length < VIEW_CAT_MAX) { k = order.length; seen.set(s, k); order.push(s); }
        else { k = VIEW_CAT_MAX; overflow = true; }
      }
      raw[r] = k; rec = r + 1;
      if ((rec & 0xFFFF) === 0) await new Promise((res) => setTimeout(res));
      if (viewCatName(L) !== name) return null;             // the view moved on mid-read
    }
    const sorted = order.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const remap = new Uint8Array(VIEW_CAT_MAX + 1); remap[VIEW_CAT_MAX] = VIEW_CAT_MAX;
    order.forEach((s, k) => { remap[k] = sorted.indexOf(s); });
    const codes = new Uint8Array(n), counts = new Map();
    for (let r = 0; r < rec; r++) { const c = remap[raw[r]]; codes[r] = c; counts.set(c, (counts.get(c) || 0) + 1); }
    for (let r = rec; r < n; r++) codes[r] = VIEW_CAT_MAX;
    const names = sorted.slice();
    if (overflow) { names.length = VIEW_CAT_MAX; names[VIEW_CAT_MAX] = OTHER; }
    const v = { name, hdr: h, names, codes, counts, total: rec, overflow };
    if (viewCatName(L) !== name) return null;
    L._viewCat = v;
    $meta(`${L.label || L.name}: classed by ${name} — ${order.length.toLocaleString()}${overflow ? '+' : ''} values${overflow ? ` (past ${VIEW_CAT_MAX}, the rest share one class)` : ''}`);
    return v;
  })();
  L._viewCatBusy = { name, p };
  p.finally(() => { if (L._viewCatBusy && L._viewCatBusy.p === p) L._viewCatBusy = null; });
  return p;
}

// the renderer half: codes on, or off (the chunks' own class codes again)
export function applyViewCatCodes(L) {
  const v = colorSelOf(L) === 'cat' ? viewCatData(L) : null;   // the column stays chosen while the view shows a ramp
  S.renderer.setLayerRuleMode(L.id, !!v);
  S.renderer.setLayerRuleCodes(L.id, v ? v.codes : null);
  if (v) S.renderer.setLayerCats(L.id, 256);
  requestRender();
  return !!v;
}

function $meta(t) { const el = document.querySelector('#meta'); if (el) el.textContent = t; }
