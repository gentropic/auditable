// micro filter bar — the fields under the instrument bar: colour-by, the clip pair, and the filter
// box with its autocomplete, the widgets drawer and the touch expression strip. Runs AFTER src/mobile.js
// (src/boot.js): the strip reads the keyboard inset from the visual viewport once the phone layout is
// in place. Carved from index.html (2026-11-24).
import { pushUndo } from './undo.js';
import { S, activeLayer, requestRender, layerById } from './state.js';
import { syncFilterClear, applyBlockFilter } from './filter.js';
import { refreshProps } from './props.js';
import { repaintRamp } from './props-style.js';
import { rampCfgOf, applyRamp } from './ramp.js';
import { setLayerColorBy } from './color.js';
import { attachAutocomplete, filterCtx, exprStripField, xsKey, xsSync, _exprFields, exprField, acClose, syncHL } from './exprfield.js';
import { toggleFilterDrawer, _fdOpen, renderFilterDrawer } from './filter-drawer.js';
import { calcDisplayCol } from './calc.js';
import { paintActiveCol } from './paint.js';

const $ = (s) => document.querySelector(s);

// (blockCaps / layerRecords / docPositionStream live in src/records.js)
// switching the grade channel = re-stream sweep 2 with a new mapping (windowed ethos)
$('#colorBy').addEventListener('change', () => {
  const L = activeLayer();
  // the open properties pane follows a colour-by chosen here (it went stale before)
  if (L) setLayerColorBy(L, $('#colorBy').value).then(() => refreshProps(), (e) => {
    $('#meta').textContent = `color — ${e.message}`;
    if (L.colorSel != null && [...$('#colorBy').options].some((o) => o.value === String(L.colorSel))) $('#colorBy').value = String(L.colorSel);   // the select shows what IS drawn
  });
  else requestRender();
});

// the clip: an inverted pair isn't applied while it's being typed (the old range holds, the
// status line says why) and is swapped on commit; the pane follows — fully when the edit came
// from here, as a repaint when it came from the pane's own boxes (so typing keeps its focus)
const clipPair = () => [$('#clipMin').value, $('#clipMax').value];
const clipInverted = ([a, b]) => Number.isFinite(parseFloat(a)) && Number.isFinite(parseFloat(b)) && parseFloat(a) > parseFloat(b);
for (const id of ['clipMin', 'clipMax']) {
  $('#' + id).addEventListener('input', () => {
    const L = activeLayer();
    if (L) {
      const p = clipPair();
      if (clipInverted(p)) { $('#meta').textContent = `clip: min ${p[0]} is above max ${p[1]} — not applied (they swap when you leave the box)`; return; }
      L.clip = p;
      const pcR = paintActiveCol(L) || calcDisplayCol(L);
      if (rampCfgOf(L) || (pcR && pcR.kind === 'ratio')) applyRamp(L, true);
      requestRender();
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#propPanel')) repaintRamp(); else refreshProps();
    }
    dispatchEvent(new Event('micro:project-dirty'));
  });
  $('#' + id).addEventListener('change', () => {
    const L = activeLayer(); const p = clipPair();
    if (!L || !clipInverted(p)) return;
    $('#clipMin').value = p[1]; $('#clipMax').value = p[0];
    $('#meta').textContent = `clip: min and max swapped → ${p[1]} – ${p[0]}`;
    $('#clipMin').dispatchEvent(new Event('input'));
  });
}

attachAutocomplete($('#filter'), filterCtx);

{
  const strip = $('#exprStrip');
  strip.addEventListener('mousedown', (e) => e.preventDefault());   // keep the field's focus (and the keyboard)
  strip.querySelector('.xs-keys').addEventListener('click', (e) => { const b = e.target.closest('button'); const el = exprStripField(); if (b && el) xsKey(el, b.dataset.k); });
  document.addEventListener('focusin', xsSync);
  document.addEventListener('focusout', () => setTimeout(xsSync, 0));   // after focus lands on whatever's next
  document.addEventListener('selectionchange', () => { if (exprStripField()) xsSync(); });   // a tap moves the caret → new context
  document.addEventListener('input', (e) => { if (_exprFields.has(e.target)) xsSync(); }, true);
  const vv = window.visualViewport;                         // the keyboard: whatever the visual viewport lost at the bottom
  const kb = () => document.documentElement.style.setProperty('--kb', vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px' : '0px');
  if (vv) { vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); }
  kb();
}
exprField($('#filter'), filterCtx);

$('#filter').addEventListener('input', syncFilterClear);
$('#filterClear').onclick = () => {
  $('#filter').value = ''; syncFilterClear(); acClose();
  applyBlockFilter('');                                    // one click: clear AND re-render unfiltered
};
$('#filter').addEventListener('keydown', (e) => {
  const filterStep = (next) => {
    const L = activeLayer(), prev = (L && L.filterExpr) || '';
    const put = (v) => async () => { const Lx = layerById(L.id); if (!Lx) return; if (Lx.id === S.activeId) { $('#filter').value = v; syncFilterClear(); } await applyBlockFilter(v, Lx); };
    if (L && prev !== next) pushUndo(next ? 'filter' : 'clear filter', put(prev), { redo: put(next) });
    applyBlockFilter(next);
  };
  if (e.key === 'Enter') filterStep($('#filter').value);
  else if (e.key === 'Escape') { $('#filter').value = ''; syncFilterClear(); filterStep(''); }
});

$('#filterWidgets').onclick = () => toggleFilterDrawer();
$('#filter').addEventListener('change', () => { if (_fdOpen) renderFilterDrawer(); });
for (const ev of ['scroll', 'keyup', 'click', 'input']) $('#filter').addEventListener(ev, () => syncHL($('#filter'), $('#filterHL')));
