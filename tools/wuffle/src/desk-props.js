// wuffle desk — a LAYER'S PROPERTIES, in tabs: everything about how one layer draws.
//   General     its name, shown or hidden, a filter (only the rows where an expression holds), its place in
//               the draw order, and how its dataset is read
//   Symbols     colour, symbol (circle, square, triangle, diamond, cross, x), size, hollow, opacity; colour by
//               a column (its categories — a set, a lithology — or a ramp over a number), size by a column
//   Lines       great and small circles: their own colour, width, dash
//   Contours    the method (Kamb, Fisher kernel, Schmidt % per 1 % area, cosine power) and its parameter, the
//               levels, filled bands, the line width; for faults, the poles or the slip lines
//   Statistics  the mean's cone (confidence) and whether the data are axial
//   Labels      from which column, their size, only the selected rows
// A tab appears only when the layer has the thing it sets. One Apply is one undo step. The style lives in the
// layer (saved with the project); filter / colour by / size by read the dataset's columns, by name.

import { Dialog } from '../../../ext/dialog/index.js';
import { orientations } from './io.js';
import { checkExpr } from './calc.js';
import { columnsDialog } from './desk-columns.js';
import { colorByOf, layerFilterRows } from './layers.js';

const h = (t, cls, text) => { const e = document.createElement(t); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SYMBOLS = [['circle', '● circle'], ['square', '■ square'], ['triangle', '▲ triangle'], ['diamond', '◆ diamond'], ['cross', '+ cross'], ['x', '× x']];
const DASHES = [['solid', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']];
const METHODS = [['kamb', 'Kamb (σ)'], ['fisher', 'Fisher kernel (MUD)'], ['percent', 'Schmidt (% per 1 % area)'], ['cosine', 'cosine power (MUD)']];
const DEFAULT_LEVELS = { kamb: '2, 4, 6, 8, 10, 12 (σ)', fisher: '2, 4, 6, 8 (MUD)', percent: '1, 2, 4, 6, 8, 10 (%)', cosine: '2, 4, 6, 8 (MUD)' };
let lastTab = 'general';

const isNumericCol = (ds, c) => { let n = 0, ok = 0; for (const r of ds.rows) { const v = r[c]; if (v === '' || v == null) continue; n++; if (Number.isFinite(typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')))) ok++; } return n > 0 && ok / n > 0.9; };

export async function layerProperties(p, layerId) {
  const L = p.layer(layerId); if (!L) return false;
  const ds = p.dataset(L.datasetId), E = L.elements, st = L.style || {}, n = orientations(ds).filter(Boolean).length;
  const siblings = p.layersOf(L.diagramId), at = siblings.findIndex((x) => x.id === L.id);
  const pointKey = ['poles', 'points', 'axes', 'slip'].find((k) => E[k]);
  const hasLines = !!(E.greatCircles || E.circles), numCols = ds.columns.filter((c) => isNumericCol(ds, c));
  const res = await new Dialog({
    title: `${L.name || ds.name} · properties`, width: 470,
    render(body, ctx) {
      const v = {};                                      // the controls, by name
      const tabs = h('div', 'wpt-tabs'), panes = new Map();
      const pane = (key, label) => { const d = h('div', 'wpt-pane'); d.dataset.tab = key; panes.set(key, d); const b = h('button', 'wpt-tab', label); b.type = 'button'; b.dataset.tab = key; b.onclick = () => show(key); tabs.append(b); return d; };
      const show = (key) => { if (!panes.has(key)) key = 'general'; lastTab = key; for (const [k, d] of panes) d.hidden = k !== key; for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === key); };
      const row = (into, label, el, hint) => { const r = h('label', 'wprow'); r.append(h('span', null, label), el); if (hint) r.title = hint; into.append(r); return el; };
      const inp = (type, value, attrs = {}) => { const i = h('input'); i.type = type; if (type === 'checkbox') i.checked = !!value; else i.value = value ?? ''; Object.assign(i, attrs); return i; };
      const sel = (opts, val) => { const s = h('select'); for (const [k, t] of opts) s.append(new Option(t, k)); s.value = val ?? opts[0][0]; return s; };
      const note = (into, text) => { const e = h('p', 'wpnote', text); into.append(e); return e; };

      // ── General ──
      const G = pane('general', 'General');
      note(G, `${ds.name} · ${ds.kind} · ${n} of ${ds.rows.length} rows read`);
      v.name = row(G, 'name', inp('text', L.name || '', { placeholder: ds.name }));
      v.visible = row(G, 'shown', inp('checkbox', L.visible !== false));
      v.filter = row(G, 'only rows where', inp('text', st.filter || '', { placeholder: "dip > 60 and set = 'S1'" }), 'an expression over each row: columns by name, and dip, dipdir, strike, trend, plunge, rake — empty: every row');
      const fNote = note(G, '');
      const checkFilter = () => {
        const e = v.filter.value.trim(); fNote.classList.remove('bad');
        if (!e) { fNote.textContent = 'every row is drawn'; return true; }
        const err = checkExpr(ds, e); if (err) { fNote.textContent = err; fNote.classList.add('bad'); return false; }
        const k = layerFilterRows(ds, e); fNote.textContent = `${k ? k.size : ds.rows.length} of ${ds.rows.length} rows drawn`; return true;
      };
      v.filter.addEventListener('input', () => { ok.disabled = !checkFilter(); });
      if (siblings.length > 1) v.order = row(G, 'draw order', sel(siblings.map((x, i) => [String(i), `${i + 1}${i === siblings.length - 1 ? ' (on top)' : i === 0 ? ' (at the bottom)' : ''}`]), String(at)));
      const readBtn = h('button', null, 'How the data is read…'); readBtn.type = 'button';
      readBtn.onclick = async () => { await columnsDialog(p, ds.id); };
      G.append(readBtn);

      // ── Symbols ──
      if (pointKey) {
        const S = pane('symbols', 'Symbols');
        v.color = row(S, 'colour', inp('color', st.color || '#e8836b'));
        v.symbol = row(S, 'symbol', sel(SYMBOLS, st.symbol || 'circle'));
        v.size = row(S, 'size', inp('number', st.size || 4, { min: 1, max: 16, step: 0.5 }));
        v.hollow = row(S, 'hollow', inp('checkbox', !!st.hollow), 'an outline in the colour, not a filled shape');
        v.opacity = row(S, 'opacity', inp('range', Math.round((st.opacity ?? 1) * 100), { min: 10, max: 100, step: 5 }));
        const cb = st.colorBy || {};
        v.cbCol = row(S, 'colour by', sel([['', '— the layer’s colour'], ...ds.columns.map((c) => [c, c])], cb.column || ''));
        v.cbMode = row(S, '… as', sel([['cat', 'categories (one colour each)'], ['num', 'a ramp over its numbers']], cb.mode || 'cat'));
        const cbKey = h('div', 'wpt-key'); S.append(cbKey);
        const showKey = () => {
          const col = v.cbCol.value; v.cbMode.disabled = !col; v.color.disabled = !!col;
          if (col && !numCols.includes(col) && v.cbMode.value === 'num') v.cbMode.value = 'cat';
          cbKey.replaceChildren();
          const k = col ? colorByOf(ds, { column: col, mode: v.cbMode.value }) : null; if (!k) return;
          if (k.key.kind === 'ramp') { cbKey.append(h('span', null, `${+k.key.lo.toPrecision(4)}`), Object.assign(h('span', 'wpt-ramp'), { style: `background:linear-gradient(90deg,${k.key.stops.join(',')})` }), h('span', null, `${+k.key.hi.toPrecision(4)}`)); return; }
          for (const e of k.key.entries.slice(0, 12)) { const s = h('span', 'wpt-sw'); s.append(Object.assign(h('i'), { style: `background:${e.color}` }), document.createTextNode(e.label)); cbKey.append(s); }
          if (k.key.entries.length > 12) cbKey.append(h('span', null, `… ${k.key.entries.length - 12} more`));
        };
        v.cbCol.onchange = showKey; v.cbMode.onchange = showKey; showKey();
        const sb = st.sizeBy || {};
        v.sbCol = row(S, 'size by', sel([['', '— the same size'], ...numCols.map((c) => [c, c])], sb.column || ''));
        const sbr = h('span', 'wpt-inline'); v.sbMin = inp('number', sb.min || 2, { min: 1, max: 30, step: 0.5 }); v.sbMax = inp('number', sb.max || 10, { min: 1, max: 30, step: 0.5 });
        sbr.append(v.sbMin, h('span', null, ' to '), v.sbMax); row(S, '… from', sbr);
        const sbOn = () => { v.sbMin.disabled = v.sbMax.disabled = !v.sbCol.value; v.size.disabled = !!v.sbCol.value; }; v.sbCol.onchange = sbOn; sbOn();
      }

      // ── Lines ──
      if (hasLines) {
        const Ln = pane('lines', 'Lines');
        v.lineOwn = row(Ln, 'own colour', inp('checkbox', !!st.lineColor), 'off: the circles take the layer’s colour (or each row’s, coloured by a column)');
        v.lineColor = row(Ln, 'colour', inp('color', st.lineColor || st.color || '#e8836b'));
        v.lineWidth = row(Ln, 'width', inp('number', st.lineWidth || (E.greatCircles ? 0.7 : 1), { min: 0.2, max: 4, step: 0.1 }));
        v.lineDash = row(Ln, 'line', sel(DASHES, st.lineDash || 'solid'));
        const lo = () => { v.lineColor.disabled = !v.lineOwn.checked; }; v.lineOwn.onchange = lo; lo();
      }

      // ── Contours ──
      if (E.contours) {
        const C = pane('contours', 'Contours');
        const c = E.contours;
        v.cm = row(C, 'method', sel(METHODS, c.method || 'kamb'));
        v.cs = row(C, 'Kamb k (E = kσ)', inp('number', c.sigma ?? 3, { min: 1, max: 6, step: 0.5 }));
        v.ck = row(C, 'kernel width (°)', inp('number', c.kernel ?? '', { min: 1, max: 45, step: 0.5, placeholder: `auto (90/√n = ${(90 / Math.sqrt(Math.max(1, n))).toFixed(1)})` }));
        v.ca = row(C, 'circle area (%)', inp('number', c.area ?? 1, { min: 0.25, max: 10, step: 0.25 }));
        v.cp = row(C, 'power k', inp('number', c.power ?? '', { min: 2, max: 2000, step: 1, placeholder: 'auto (≈ the Fisher default)' }));
        v.cl = row(C, 'levels', inp('text', (c.levels || []).join(', ')));
        v.cf = row(C, 'filled bands', inp('checkbox', !!c.filled));
        v.cw = row(C, 'line width', inp('number', st.contourWidth || 0.9, { min: 0.2, max: 4, step: 0.1 }));
        if (ds.kind === 'faults') v.cof = row(C, 'contour', sel([['poles', 'the planes’ poles'], ['slip', 'the slip lines']], c.of || 'poles'));
        const byMethod = () => {
          const m = v.cm.value;
          v.cs.closest('label').hidden = m !== 'kamb'; v.ck.closest('label').hidden = m !== 'fisher';
          v.ca.closest('label').hidden = m !== 'percent'; v.cp.closest('label').hidden = m !== 'cosine';
          for (const el of [v.cs, v.ck, v.ca, v.cp]) el.closest('label').style.display = el.closest('label').hidden ? 'none' : '';
          v.cl.placeholder = DEFAULT_LEVELS[m];
        };
        v.cm.onchange = byMethod; byMethod();
        note(C, 'one contoured layer per net: a second one is said on the net, not drawn');
      }

      // ── Statistics ──
      if (E.mean) {
        const T = pane('stats', 'Statistics');
        v.mc = row(T, 'cone confidence', sel([['0.9', '90 %'], ['0.95', '95 %'], ['0.99', '99 %']], String(E.mean.confidence ?? 0.95)));
        v.ma = row(T, 'axial', inp('checkbox', E.mean.axial !== false), 'poles and lines without a sense are axes: a direction and its opposite are the same measurement');
      }

      // ── Labels ──
      if (E.labels) {
        const Lb = pane('labels', 'Labels');
        v.lab = row(Lb, 'from', sel([['', '— row number'], ...ds.columns.map((c) => [c, c])], E.labels.column || ''));
        v.labSize = row(Lb, 'size', inp('number', st.labelSize || 9, { min: 5, max: 24, step: 1 }));
        v.labSel = row(Lb, 'only the selected', inp('checkbox', !!st.labelsSelectedOnly));
        note(Lb, 'switch the labels on in the tree (the layer’s “labels” checkbox)');
      }

      const bar = h('div', 'wpbar'), ok = h('button', 'primary', 'Apply'), cancel = h('button', null, 'Cancel');
      ok.type = cancel.type = 'button'; ok.dataset.default = 'true';
      bar.append(cancel, ok);
      const holder = h('div', 'wpt-body'); holder.append(...panes.values());
      body.append(tabs, holder, bar);
      show(lastTab); checkFilter();
      cancel.onclick = () => ctx.close(null);
      ok.onclick = () => { if (!ok.disabled) ctx.close(v); };
    },
  }).show();
  if (!res) return false;
  const v = res, num = (el, d = null) => (el && el.value !== '' && Number.isFinite(+el.value) ? +el.value : d);
  p.batch('layer properties', () => {                     // one Apply, one undo step
    if ((L.name || '') !== v.name.value.trim()) p.renameLayer(layerId, v.name.value);
    if ((L.visible !== false) !== v.visible.checked) p.setLayerVisible(layerId, v.visible.checked);
    const style = { filter: v.filter.value.trim() || null };
    if (v.color) Object.assign(style, {
      color: v.color.value, symbol: v.symbol.value === 'circle' ? null : v.symbol.value, size: num(v.size, 4), hollow: v.hollow.checked || null,
      opacity: +v.opacity.value >= 100 ? null : +v.opacity.value / 100,
      colorBy: v.cbCol.value ? { column: v.cbCol.value, mode: v.cbMode.value } : null,
      sizeBy: v.sbCol.value ? { column: v.sbCol.value, min: num(v.sbMin, 2), max: num(v.sbMax, 10) } : null,
    });
    if (v.lineWidth) Object.assign(style, { lineColor: v.lineOwn.checked ? v.lineColor.value : null, lineWidth: num(v.lineWidth), lineDash: v.lineDash.value === 'solid' ? null : v.lineDash.value });
    if (v.cw) style.contourWidth = num(v.cw, 0.9);
    if (v.labSize) Object.assign(style, { labelSize: num(v.labSize, 9), labelsSelectedOnly: v.labSel.checked || null });
    p.setLayerStyle(layerId, style);
    if (v.cm) {
      const lv = String(v.cl.value || '').split(/[,\s]+/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      p.setElementSettings(layerId, 'contours', { method: v.cm.value, sigma: num(v.cs, 3), kernel: num(v.ck), area: num(v.ca, 1), power: num(v.cp),
        filled: !!v.cf.checked, levels: lv.length ? lv : null, ...(v.cof ? { of: v.cof.value } : {}) });
    }
    if (v.mc) p.setElementSettings(layerId, 'mean', { confidence: +v.mc.value, axial: v.ma.checked });
    if (v.lab) p.setElementSettings(layerId, 'labels', { column: v.lab.value || null });
    if (v.order && +v.order.value !== at) p.moveLayer(layerId, L.diagramId, +v.order.value);
  });
  return true;
}
