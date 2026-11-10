// micro — the filter drawer: the structured view of the filter expression,
// one row per condition, with the bounds and values each column offers.
import { pinGet } from './columns.js';
import { applyBlockFilter, pqGroupRanges, syncFilterClear } from './filter.js';
import { layerTableHeader, schemaExt } from './records.js';
import { numericColsOf } from './analysis.js';
import { createFilterDrawer, flattenExpr as fuiFlatten, fmtNum as fuiFmtNum, renderChain as fuiRenderChain, renderLeaf as fuiRenderLeaf } from '../../../ext/filterui/index.js';
import { parse, quoteIdent, validate } from '../../../ext/expr/index.js';
import { activeLayer } from './state.js';
import { renderExprHL } from './exprfield.js';
const $ = (s) => document.querySelector(s);

// ── the FILTER WIDGET DRAWER — @gcu/filterui, driven by micro's providers ────
// The engine (span-surgical AST↔widget projection over the expression text) is
// the shared package now; micro supplies the metadata providers (pinned
// columns / parquet footers / band sidecars), the @gcu/expr services, the
// highlight overlay, and the apply debounce. The calc window drives the same
// row renderers with its own rewrite context, as before.
export let _fdOpen = false, _fdTimer = null, _fdDrawer = null;

// numeric bounds for a column: pinned column → exact; parquet footers; band sidecars; else spread around v
export function fdBounds(L, col, v) {
  const e = pinGet(L, col);
  if (e && e.data) { let mn = Infinity, mx = -Infinity; const d = e.data; for (let i = 0; i < d.length; i++) { const x = d[i]; if (x === x) { if (x < mn) mn = x; if (x > mx) mx = x; } } if (mn <= mx) return [mn, mx]; }
  const P = L.docs.blockDoc && L.docs.blockDoc.parquet;
  if (P) { let mn = Infinity, mx = -Infinity; for (const rg of P.rowGroups) { const r = pqGroupRanges(rg)[String(col).toLowerCase()]; if (r) { if (r.min < mn) mn = r.min; if (r.max > mx) mx = r.max; } } if (mn <= mx) return [mn, mx]; }
  const B = L._bands && L._bands.cols && L._bands.cols[String(col).toLowerCase()];
  if (B) { let mn = Infinity, mx = -Infinity; for (let b = 0; b * 2 < B.length; b++) { const v0 = B[b * 2], v1 = B[b * 2 + 1]; if (v0 != null) { if (v0 < mn) mn = v0; if (v1 > mx) mx = v1; } } if (mn <= mx) return [mn, mx]; }
  const sp = Math.max(1, Math.abs(v) * 2); return [v - sp, v + sp];
}

// category values for a column: pinned dict → header categories → just the current
export function fdValues(L, col, cur) {
  const pc = (L.paintCols || []).find((c) => c.name === col && c.dict && c.dict.length);   // flag / derived categorical paint column
  if (pc) return pc.dict.filter((x) => x !== '');
  const e = pinGet(L, col); if (e && e.dict) return e.dict.filter((x) => x !== '');
  const h = layerTableHeader(L); const mm = h && h.mapping;
  if (h && h.categories && mm && mm.cat != null && String(h.columns[mm.cat]).toLowerCase() === String(col).toLowerCase()) return h.categories.slice();
  return [...new Set(cur)];
}

// the add-row column picker: numeric columns + the mapped category + dict-coded paint columns
export function fdColumnsOf(AL) {
  const nums = numericColsOf(AL); const h = layerTableHeader(AL); const mm = h.mapping || {};
  const catName = mm.cat != null ? h.columns[mm.cat] : null;
  const catPaint = (AL.paintCols || []).filter((c) => c.kind !== 'ratio' && c.dict && c.dict.length > 1);   // flag / derived categorical paint columns
  const categorical = catName ? [catName] : [];
  for (const c of catPaint) if (c.name !== catName) categorical.push(c.name);
  return { numeric: nums, categorical };
}

export const fdMetaFor = (L) => ({
  boundsFor: (col, v) => fdBounds(L, col, v),
  valuesFor: (col, cur) => fdValues(L, col, cur),
  columns: () => fdColumnsOf(L),
});

// calc-window compatibility: the old inline renderers' signatures, now backed by the package
export const fdNum = fuiFmtNum;

export const fdRenderChain = (d, n, L, ctx, delSelf) => fuiRenderChain(d, n, fdMetaFor(L), { quoteIdent, ...ctx }, delSelf);

export const fdRenderLeaf = (d, leaf, L, ctx, del) => fuiRenderLeaf(d, leaf, fdMetaFor(L), { quoteIdent, ...ctx }, del);

export function fdDrawer() {
  if (_fdDrawer) return _fdDrawer;
  _fdDrawer = createFilterDrawer({
    host: $('#fdrawer'),
    expr: { parse, validate, quoteIdent },
    meta: {                                                // live: always the ACTIVE layer
      boundsFor: (col, v) => fdBounds(activeLayer(), col, v),
      valuesFor: (col, cur) => fdValues(activeLayer(), col, cur),
      columns: () => { const AL = activeLayer(); return AL && layerTableHeader(AL) ? fdColumnsOf(AL) : { numeric: [], categorical: [] }; },
    },
    schema: () => { const AL = activeLayer(); const h = AL && layerTableHeader(AL); return h ? schemaExt(AL, h) : undefined; },
    highlight: (hl, text) => renderExprHL(hl, text),
    apply: (text, source) => {
      $('#filter').value = fuiFlatten(text); syncFilterClear();
      clearTimeout(_fdTimer);
      if (source === 'reset' || source === 'clear') applyBlockFilter(text);
      else _fdTimer = setTimeout(() => applyBlockFilter(text), source === 'editor' ? 300 : 60);
    },
  });
  return _fdDrawer;
}

export function fdSrc() {
  if (_fdOpen && _fdDrawer) return _fdDrawer.getText();
  const L = activeLayer(); return (L && L.filterExpr) || $('#filter').value;
}

export function renderFilterDrawer() { fdDrawer().render(); }

export function toggleFilterDrawer(force) {
  const d = $('#fdrawer');
  _fdOpen = force !== undefined ? force : !_fdOpen;
  $('#filterWidgets').classList.toggle('on', _fdOpen);
  $('#filterWidgets').textContent = _fdOpen ? '▴' : '▾';
  if (!_fdOpen) { d.classList.remove('show'); return; }
  const L = activeLayer();
  fdDrawer().open((L && L.filterExpr) || $('#filter').value);
  const r = $('#filterWrap').getBoundingClientRect();
  d.style.left = Math.max(8, Math.min(innerWidth - 540, r.left)) + 'px';
  d.style.top = (r.bottom + 4) + 'px';
  d.classList.add('show');
}
