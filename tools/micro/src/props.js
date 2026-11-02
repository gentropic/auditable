// micro props — the Properties panel and the STYLING it drives: the style tab (colour
// by a channel / a category / rules / paint / a calc, the ramp with its live histogram
// and breaks, class visibility and the legend, rule lists, stick radius, mesh tint),
// the columns tab (census stats, types, detection-limit policies, materialize, use as
// category), the join tab and the source tab. Carved from index.html (phase 3).
import { _sheetExclusive } from './windows.js';
import { S, activeLayer, layerById } from './state.js';
import { attrRowCountOf, blockCaps, calcOrder, colIsNumeric, extendRow, layerHeaderOf, layerRecords, layerRows, layerTableHeader, locationsOf, numOf, qualifyPolicy, rowQualifier, schemaExt } from './records.js';
import { fmtSize } from './paths.js';
import { html, setHTML, trusted } from './html.js';
import { compileBool, compileChunk, compileValue, deps, parse, quoteIdent, validate } from '../../../ext/expr/index.js';
import { PAINT_BLANK, censusChunkCols, colStatsComplete, ensureStoredValues, expandedDeps, footerColStats, matColCodes, matColSet, matColSourceHash, paintRecount, pinEvictLayer, pinGet, pinWindow, ruleDefaultColor, scanColumns } from './columns.js';
import { fmtStat } from './analysis-ui.js';
import { cdfFromCentroids, histogramFromCentroids, quantileFromCentroids } from '../../../ext/sluice/index.js';
import { basisAngles, categoryPalettePixels, coordNum, describeQualified, gridsCompatible, palettePixels, worldMapOf } from '../../../ext/condenser/src/main.js';
import { mkLineage } from './lineage.js';
import { persistElement } from './element-store.js';
import { gridAxesOf } from './grid-ops.js';
import { keyJoinToCols, runKeyJoin, shortName, spatialJoinToCols } from './joins.js';
import { pushUndo } from './undo.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setPropsHooks): CONTEXT_TRI_CAP, _docBbox, addPaintValue, appendColStats, applyLayerOpacity, collarCells, colorHeaderOf, convertMeshLayer, createPaintCol, csvRecords, droppedNote, ensureValueTex, followLayer, frame, hexToRgb01, markProjectDirty, menuXY, microPrompt, openBlob, openCalcWindow, openPaintPalette, openReconcileMenu, paintColByName, recolorSurface, refilterLayer, renderLayers, renderer, reopenBlockChan, reopenDh, reopenWithMapping, requestRender, runSpatialJoinUI, setColorLabels, setGridBand, setLayerColorSel, setMeshTint, setSurfaceFlatZ, setSurfaceSmooth
let H = {};
export function setPropsHooks(h) { H = h; }

// ── layer properties (§10 v1): follows the ACTIVE layer, live-apply, tabbed.
// style = kind-adaptive controls; classes = per-class eyes (GPU cull — the
// class code rides every element, so toggling is a texture update: no sweeps).
export let _propOpen = false, _propFor = null;

export let _propTab = (() => { try { return localStorage.getItem('micro.propTab') || 'style'; } catch { return 'style'; } })();

export function openProps() {
  _propOpen = true;
  $('#recPanel').classList.remove('show');
  $('#propPanel').classList.add('show');
  _sheetExclusive($('#propPanel'));
  const L = activeLayer();
  if (L && !L._stagePend) L._styleSnap = styleSnap(L);
  renderProps();
}

// the panel's state from outside: re-render for whatever is active now, or open on a tab
export function refreshProps() { if (_propOpen) { _propFor = null; renderProps(); } }

export function setPropTab(t) { _propTab = t; try { localStorage.setItem('micro.propTab', t); } catch { /* ignore */ } }

export function closeProps() { _propOpen = false; _propFor = null; _rampRepaint = null; $('#propPanel').classList.remove('show'); }

export function propKindLine(L) {
  const h = layerHeaderOf(L);
  const n = H.renderer.layerElementCount(L.id) || 0;
  if (L.kind === 'mesh') {
    // a mesh is the one element with two record spaces, so name both rather than
    // reporting triangles as though they were the whole story
    const tier = h && h.soup ? 'streamed' : 'context';
    const locs = locationsOf(L);
    if (!locs.length) return `${tier} mesh · ${n.toLocaleString()} triangles`;   // streamed: no CPU records
    return `${tier} mesh · ${locs.map((l) => `${l.count.toLocaleString()} ${l.name}`).join(' · ')}`;
  }
  if (L.kind === 'table') return `table · ${(h ? h.count : 0).toLocaleString()} rows · ${h ? h.columns.length : 0} columns · no geometry`;
  if (L.dh) return `drillholes · ${n.toLocaleString()} intervals`;
  const dn = L.docs.blockDoc ? H.droppedNote(L.docs.blockDoc.header) : '';
  if (L.docs.blockDoc && L.docs.blockDoc.header.grid) return `block model · ${n.toLocaleString()} blocks${dn}`;
  return `points · ${n.toLocaleString()}${dn}`;
}

export function renderProps() {
  const L = activeLayer();
  if (!L) { closeProps(); return; }
  if (_propFor !== L.id) {
    _joinForm = null;                                      // the form belongs to one layer
    if (!L._stagePend) L._styleSnap = styleSnap(L);        // revert's baseline
  }
  _propFor = L.id;
  syncPPFooter();
  $('#ppTitle').textContent = L.label || L.name;
  $('#ppSub').textContent = propKindLine(L);
  const tabs = $('#ppTabs'); tabs.textContent = '';
  const tabList = ['style', 'classes', 'columns', ...(layerTableHeader(L) ? ['join'] : []), 'source'];
  if (!tabList.includes(_propTab)) _propTab = 'style';
  for (const t of tabList) {
    const b = document.createElement('button');
    b.className = 'pp-tab' + (t === _propTab ? ' active' : '');
    b.textContent = t;
    b.onclick = () => { _propTab = t; try { localStorage.setItem('micro.propTab', t); } catch { /* ignore */ } renderProps(); };
    tabs.appendChild(b);
  }
  const body = $('#ppBody'); body.textContent = '';
  if (_propTab === 'classes') renderClassesTab(body, L);
  else if (_propTab === 'columns') renderColumnsTab(body, L);
  else if (_propTab === 'join') renderJoinTab(body, L);
  else if (_propTab === 'source') renderSourceTab(body, L);
  else renderStyleTab(body, L);
}

export const mkRow = (label, ...ctrls) => {
  const row = document.createElement('div'); row.className = 'pp-row';
  const lab = document.createElement('label'); lab.textContent = label;
  row.append(lab, ...ctrls);
  return row;
};

export const ppNote = (text) => { const d = document.createElement('div'); d.className = 'pp-note'; d.textContent = text; return d; };

export function renderStyleTab(body, L) {
  const gdoc = L.docs && L.docs.gridDoc;                    // multi-band GeoTIFF: pick the band (like a channel) — points OR surface
  if (gdoc && gdoc.grid && gdoc.grid.bands > 1) {
    const sel = document.createElement('select');
    for (let i = 0; i < gdoc.grid.bands; i++) { const o = document.createElement('option'); o.value = i; o.textContent = `band ${i + 1}`; sel.appendChild(o); }
    sel.value = gdoc.grid.band || 0;
    sel.onchange = () => H.setGridBand(L, +sel.value);
    body.appendChild(mkRow('band', sel));
  }
  if (L.kind === 'mesh') {
    const h = layerHeaderOf(L);
    if (L.gridSurface) {                                    // a heightfield surface: colour by elevation or a draped grid
      const sel = document.createElement('select');
      const optE = document.createElement('option'); optE.value = ''; optE.textContent = 'elevation'; sel.appendChild(optE);
      const grids = S.layers.filter((g) => g !== L && g.docs && g.docs.gridDoc && g.docs.gridDoc.grid);
      for (const g of grids) { const o = document.createElement('option'); o.value = g.name; o.textContent = g.label || g.name; sel.appendChild(o); }
      sel.value = L.drapeSource || '';
      sel.onchange = () => { const g = grids.find((x) => x.name === sel.value); H.recolorSurface(L, g || null); };
      body.appendChild(mkRow('drape', sel));
      // shape: relief heightfield, or a FLAT horizontal sheet at a world z (for a
      // 2D data grid with no DEM — appears as a plan sheet coloured by its value)
      const shp = document.createElement('span'); shp.style.cssText = 'display:flex;align-items:center;gap:6px';
      const flatChk = document.createElement('input'); flatChk.type = 'checkbox'; flatChk.checked = L.surfaceFlatZ != null;
      const zIn = document.createElement('input'); zIn.type = 'number'; zIn.step = 'any'; zIn.style.width = '84px'; zIn.value = L.surfaceFlatZ != null ? L.surfaceFlatZ : 0; zIn.style.display = L.surfaceFlatZ != null ? '' : 'none';
      const zLab = document.createElement('span'); zLab.className = 'pp-val'; zLab.textContent = 'flat @ z'; zLab.style.display = L.surfaceFlatZ != null ? '' : 'none';
      flatChk.onchange = () => { const on = flatChk.checked; zIn.style.display = on ? '' : 'none'; zLab.style.display = on ? '' : 'none'; H.setSurfaceFlatZ(L, on ? (+zIn.value || 0) : null); };
      zIn.onchange = () => { if (flatChk.checked) H.setSurfaceFlatZ(L, +zIn.value || 0); };
      shp.append(flatChk, document.createTextNode(' flatten'), zLab, zIn);
      body.appendChild(mkRow('shape', shp));
      // shading: smooth grid-gradient normals vs faceted (flat per-triangle — reads the cells)
      const shd = document.createElement('select');
      for (const [v, t] of [['smooth', 'smooth'], ['faceted', 'faceted (flat)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; shd.appendChild(o); }
      shd.value = L.surfaceSmooth === false ? 'faceted' : 'smooth';
      shd.onchange = () => H.setSurfaceSmooth(L, shd.value === 'smooth');
      body.appendChild(mkRow('shading', shd));
    } else {
      const tintIn = document.createElement('input'); tintIn.type = 'color'; tintIn.value = L.tint || '#9ea3a8';
      tintIn.oninput = () => H.setMeshTint(L, tintIn.value);
      body.appendChild(mkRow('tint', tintIn));
    }
    const op = document.createElement('input'); op.type = 'range'; op.min = 5; op.max = 100; op.step = 5;
    op.value = Math.round((L.opacity != null ? L.opacity : 1) * 100);
    const opVal = document.createElement('span'); opVal.className = 'pp-val'; opVal.textContent = op.value + '%';
    op.oninput = () => {
      opVal.textContent = op.value + '%';
      L.opacity = +op.value / 100;
      stageGate(L, () => { H.renderer.setLayerMeshStyle(L.id, { opacity: L.opacity }); H.requestRender(); });
      H.markProjectDirty();
    };
    body.appendChild(mkRow('opacity', op, opVal));
    if (h) {
      const now = H.renderer.layerVramBytes(L.id);
      const tierTxt = document.createElement('span'); tierTxt.textContent = `${h.soup ? 'streamed' : 'exact'} · ${fmtSize(now)}`;
      body.appendChild(mkRow('tier', tierTxt));
      const canExact = h.soup && h.triCount <= H.CONTEXT_TRI_CAP;
      if (!h.soup || canExact) {
        const est = h.soup ? h.vertexCount * 12 + h.triCount * 12 : h.triCount * 18;
        const btn = document.createElement('button'); btn.className = 'pp-tab';
        btn.textContent = `convert to ${h.soup ? 'exact' : 'streamed'} (~${fmtSize(est)})`;
        btn.onclick = async () => { await H.convertMeshLayer(L, !h.soup); renderProps(); };
        body.appendChild(mkRow('', btn));
      }
    }
    return;
  }
  // element layers: MODE first, COLUMN second (the QGIS two-level selector).
  // colorSel stays the single flat source of truth — the panel derives
  // (mode, column) from it and writes back THROUGH the toolbar's select.
  const cb = $('#colorBy');
  const isTable = !!(L.docs.blockDoc || L.docs.dhDoc);
  const selv = colorSelOf(L);
  const selPaint = typeof selv === 'string' && selv.startsWith('paint:') ? H.paintColByName(L, selv.slice(6)) : null;
  const mode = isTable
    ? (selv === 'solid' ? 'solid' : selv === 'cat' ? 'categorized' : selv === 'rules' ? 'rule-based'
      : selPaint && selPaint.kind !== 'ratio' ? 'painted' : 'continuous')
    : (selv === '2' ? 'categorized' : selv === '3' ? 'rgb' : 'continuous');
  if (mode === 'continuous') L._lastCont = selv;           // return here when leaving solid/categorized
  const setSel = (v) => {
    if ([...cb.options].some((o) => o.value === v)) { cb.value = v; cb.dispatchEvent(new Event('change')); }
    renderProps();
  };
  const brushCols = (L.paintCols || []).filter((c) => c.kind !== 'ratio');
  const mSel = document.createElement('select');
  for (const m2 of (isTable
    ? ['continuous', 'categorized', 'rule-based', ...(brushCols.length ? ['painted'] : []), 'solid']
    : ['continuous', 'categorized', 'rgb'])) {
    const o = document.createElement('option'); o.value = m2; o.textContent = m2; mSel.appendChild(o);
  }
  mSel.value = mode;
  mSel.onchange = async () => {
    const m2 = mSel.value;
    if (m2 === 'solid') return setSel('solid');
    if (m2 === 'rule-based') return setSel('rules');
    if (m2 === 'painted') { const pc = brushCols[0]; if (pc) { addPaintColorOptions(L); return setSel('paint:' + pc.name); } return; }
    if (m2 === 'rgb') return setSel('3');
    if (m2 === 'continuous') {
      if (!isTable) return setSel('0');
      const h2 = layerTableHeader(L);
      return setSel(L._lastCont || (h2 && h2.mapping.chan != null ? `chan:${h2.mapping.chan}` : 'elev'));
    }
    // categorized: needs a class column — re-key to the first text column
    // when none is mapped yet (the use-as-category machinery)
    if (!isTable) return setSel('2');
    const h2 = layerTableHeader(L);
    if (h2 && h2.categories && h2.categories.length) return setSel('cat');
    const cand = h2 ? h2.columns.findIndex((_, i) => !colIsNumeric(L, h2, i)) : -1;
    if (cand < 0) { $('#meta').textContent = 'categorized: no text column to class by — re-type one under columns'; renderProps(); return; }
    await useAsCategory(L, cand);
    setSel('cat');
  };
  body.appendChild(mkRow('mode', mSel));
  if (mode === 'continuous') {
    const colSel = document.createElement('select');
    if (isTable) {
      const h2 = layerTableHeader(L);
      const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; colSel.appendChild(o); };
      add('elev', 'elevation');
      for (const c of (h2 && h2.numericColumns) || []) add(`chan:${c.i}`, c.name);
      for (const pc of (L.paintCols || []).filter((c) => c.kind === 'ratio')) add('paint:' + pc.name, '% ' + pc.name);
    } else {
      setHTML(colSel, trusted('<option value="0">elevation</option><option value="1">intensity</option>'));
    }
    if ([...colSel.options].some((o) => o.value === selv)) colSel.value = selv;
    colSel.onchange = () => { if (colSel.value.startsWith('paint:')) addPaintColorOptions(L); setSel(colSel.value); };
    body.appendChild(mkRow('column', colSel));
    if (selPaint && selPaint.kind === 'ratio') body.appendChild(ppNote('fraction-inside column — values are 0–1 (code/255); recompute from Tools → Select by solid…'));
    const mkClip = (id) => {
      const inp = document.createElement('input'); inp.type = 'number'; inp.style.width = '76px';
      inp.value = $('#' + id).value; inp.placeholder = id === 'clipMin' ? 'min' : 'max';
      inp.oninput = () => { $('#' + id).value = inp.value; $('#' + id).dispatchEvent(new Event('input')); H.requestRender(); };
      return inp;
    };
    body.appendChild(mkRow('clip', mkClip('clipMin'), mkClip('clipMax')));
    renderRampSection(body, L);
  } else if (mode === 'categorized') {
    if (isTable) {
      const h2 = layerTableHeader(L);
      const colSel = document.createElement('select');
      h2.columns.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; colSel.appendChild(o); });
      colSel.value = String(h2.mapping.cat != null ? h2.mapping.cat : -1);
      colSel.title = 'the class column — changing re-reads the file (any column can class: zone codes included)';
      colSel.onchange = async () => { await useAsCategory(L, +colSel.value); setSel('cat'); };
      body.appendChild(mkRow('column', colSel));
    }
    const info = layerClassInfo(L);
    if (info) renderClassList(body, L, info);
    else body.appendChild(ppNote('no category classes in this layer'));
  } else if (mode === 'rule-based') {
    renderRuleList(body, L);
  } else if (mode === 'painted') {
    const colSel = document.createElement('select');
    for (const pc of brushCols) { const o = document.createElement('option'); o.value = 'paint:' + pc.name; o.textContent = pc.name; colSel.appendChild(o); }
    if ([...colSel.options].some((o) => o.value === selv)) colSel.value = selv;
    colSel.onchange = () => { addPaintColorOptions(L); setSel(colSel.value); };
    body.appendChild(mkRow('column', colSel));
    if (selPaint) {
      const live = selPaint.dict.map((d2, c2) => (c2 > 0 && d2 != null ? { label: d2, n: selPaint.counts ? selPaint.counts[c2] : 0 } : null)).filter(Boolean);
      for (const v of live) {
        const row = document.createElement('div'); row.className = 'pp-cat';
        const sw = document.createElement('span'); sw.className = 'sw';
        sw.style.background = selPaint.colors[selPaint.dict.indexOf(v.label)] || '#555a5f';
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = v.label;
        const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = v.n.toLocaleString();
        row.append(sw, nm, ct);
        body.appendChild(row);
      }
    }
    const open = document.createElement('button'); open.className = 'pp-tab';
    open.textContent = 'open paint palette…';
    open.onclick = () => H.openPaintPalette(L);
    body.appendChild(mkRow('', open));
    body.appendChild(ppNote('a painted column — values, colors, and the brush live in the palette window'));
  } else {
    body.appendChild(ppNote(mode === 'solid' ? 'solid — one color, nothing to map' : 'rgb — colors come from the file'));
  }
  // per-layer opacity (Bayer dither in-shader) — meshes get theirs above;
  // blocks + drillholes share the same verb as the ctx menu
  if (L.docs.blockDoc || L.dh) {
    const op = document.createElement('input'); op.type = 'range'; op.min = 5; op.max = 100; op.step = 5;
    op.value = Math.round((L.opacity != null ? L.opacity : 1) * 100);
    const opVal = document.createElement('span'); opVal.className = 'pp-val'; opVal.textContent = op.value + '%';
    op.oninput = () => { opVal.textContent = op.value + '%'; H.applyLayerOpacity(L, +op.value / 100); };
    body.appendChild(mkRow('opacity', op, opVal));
  }
  if (L.dh && L.docs.dhDoc) renderStickRadius(body, L);
}

// the rules editor (§10.4): ordered rows, first match wins top-to-bottom.
// Color/name/eye edits are texture-only (instant); expr edits, add, remove,
// and reorder change what the codes MEAN, so they re-run the sweep (staged
// like every other style edit — auto-apply sweeps on commit, otherwise the
// apply button does).
export function renderRuleList(body, L) {
  if (!L.rules) L.rules = { list: [], elseColor: RULE_ELSE };
  if (!L.ruleHidden) L.ruleHidden = new Set();
  const rules = L.rules.list;
  const h = layerTableHeader(L);
  const schema = h ? schemaExt(L, h) : null;
  const sec = document.createElement('div'); sec.className = 'pp-sec';
  sec.textContent = 'rules — first match wins';
  body.appendChild(sec);
  // structural change: codes are stale until the next sweep
  const structural = () => { L._rulesDirty = true; H.markProjectDirty(); runRules(L); };
  // hidden codes follow their rule OBJECTS through remove/reorder
  const remapHidden = (fn) => {
    const hidObjs = [...L.ruleHidden].filter((c) => c > 0).map((c) => rules[c - 1]).filter(Boolean);
    const hadElse = L.ruleHidden.has(0);
    fn();
    L.ruleHidden = new Set((hadElse ? [0] : []).concat(hidObjs.map((o) => rules.indexOf(o) + 1).filter((c) => c > 0)));
  };
  const entryRows = [];
  const rowFor = (r, idx, isElse) => {
    const code = isElse ? 0 : idx + 1;
    const row = document.createElement('div'); row.className = 'pp-rule' + (L.ruleHidden.has(code) ? ' off' : '');
    if (!isElse) {
      const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⠿'; grip.title = 'drag to reorder — priority is top-down';
      grip.onpointerdown = (ev) => {
        ev.preventDefault();
        try { grip.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
        row.style.opacity = '0.45';
        let target = -1;
        const clear = () => entryRows.forEach((r2) => r2.row.classList.remove('drop-above'));
        const move = (mv) => {
          clear();
          target = entryRows.findIndex((r2) => mv.clientY < r2.row.getBoundingClientRect().top + r2.row.offsetHeight / 2);
          if (target < 0) target = entryRows.length;
          if (entryRows[target]) entryRows[target].row.classList.add('drop-above');
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          row.style.opacity = ''; clear();
          const from = entryRows.findIndex((r2) => r2.row === row);
          if (from < 0 || target < 0 || target === from || target === from + 1) return;
          remapHidden(() => {
            const [it] = rules.splice(from, 1);
            rules.splice(target > from ? target - 1 : target, 0, it);
          });
          structural();
          renderProps();
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      };
      row.appendChild(grip);
    } else {
      row.appendChild(document.createElement('span'));     // grid slot
    }
    const eye = document.createElement('input'); eye.type = 'checkbox';
    eye.checked = !L.ruleHidden.has(code);
    eye.title = isElse ? 'show/hide unmatched records' : 'show/hide this rule’s records';
    eye.onchange = () => {
      if (eye.checked) L.ruleHidden.delete(code); else L.ruleHidden.add(code);
      row.classList.toggle('off', !eye.checked);
      applyRuleVisibility(L);
      H.markProjectDirty();
    };
    const sw = document.createElement('input'); sw.type = 'color';
    sw.value = isElse ? ((L.rules.elseColor) || RULE_ELSE) : (r.color || RULE_ELSE);
    sw.oninput = () => {
      if (isElse) L.rules.elseColor = sw.value; else r.color = sw.value;
      applyRulePalette(L);
      H.markProjectDirty();
    };
    row.append(eye, sw);
    if (isElse) {
      const nm = document.createElement('span'); nm.className = 'else-nm'; nm.textContent = 'everything else';
      nm.style.gridColumn = '4 / 6';
      row.appendChild(nm);
    } else {
      const nm = document.createElement('input'); nm.type = 'text'; nm.placeholder = `rule ${idx + 1}`;
      nm.value = r.name || '';
      nm.onchange = () => { r.name = nm.value.trim(); H.markProjectDirty(); };
      const ex = document.createElement('input'); ex.type = 'text'; ex.placeholder = 'FE > 55 and LITO = "HEM"';
      ex.value = r.expr || '';
      ex.title = 'the filter language, over every column (ƒ included)';
      if ((r.expr || '').trim() && schema) ex.classList.toggle('err', !validate(r.expr, schema).ok);
      ex.onchange = () => {
        r.expr = ex.value;
        const ok = !!ex.value.trim() && (!schema || validate(ex.value, schema).ok);
        ex.classList.toggle('err', !!ex.value.trim() && !ok);
        if (ok) structural();
        else { L._rulesDirty = true; H.markProjectDirty(); }
      };
      row.append(nm, ex);
    }
    const ct = document.createElement('span'); ct.className = 'ct';
    ct.textContent = L._ruleCounts && !L._rulesDirty && code < L._ruleCounts.length ? L._ruleCounts[code].toLocaleString() : '';
    row.appendChild(ct);
    if (!isElse) {
      const kb = document.createElement('span'); kb.className = 'pp-kebab'; kb.textContent = '⋮'; kb.title = 'rule actions';
      kb.onclick = (e) => {
        e.stopPropagation();
        const r2 = kb.getBoundingClientRect();
        H.menuXY(r2.left - 60, r2.bottom + 2, [
          { label: 'Duplicate', action: () => { remapHidden(() => rules.splice(idx + 1, 0, { name: r.name ? r.name + ' copy' : '', expr: r.expr, color: ruleDefaultColor(rules.length) })); structural(); renderProps(); } },
          { label: 'Remove', action: () => { const gone = rules[idx]; pushUndo(`remove rule ${gone.name || gone.expr || ''}`.trim(), () => { remapHidden(() => rules.splice(Math.min(idx, rules.length), 0, gone)); structural(); refreshProps(); }, { redo: () => { const j = rules.indexOf(gone); if (j >= 0) { remapHidden(() => rules.splice(j, 1)); structural(); refreshProps(); } } }); remapHidden(() => rules.splice(idx, 1)); structural(); renderProps(); } },
        ]);
      };
      row.appendChild(kb);
    } else {
      row.appendChild(document.createElement('span'));     // grid slot
    }
    return row;
  };
  rules.forEach((r, i) => { const row = rowFor(r, i, false); entryRows.push({ row }); body.appendChild(row); });
  body.appendChild(rowFor(null, -1, true));
  const add = document.createElement('button'); add.className = 'pp-tab';
  add.textContent = '+ add rule';
  add.onclick = () => {
    rules.push({ name: '', expr: '', color: ruleDefaultColor(rules.length) });
    H.markProjectDirty();
    renderProps();
  };
  const run = document.createElement('button'); run.className = 'pp-tab';
  run.textContent = L._rulesDirty || !L._ruleCodes ? 'run rules •' : 'run rules';
  run.title = 'one sweep over the table — first matching rule claims each record';
  run.onclick = () => runRules(L, true);
  body.appendChild(mkRow('', add, run));
  if (!rules.length) body.appendChild(ppNote('no rules yet — everything wears the else color'));
  else if (L._rulesDirty || !L._ruleCodes) body.appendChild(ppNote('rules edited — run (or apply) to re-sweep'));
}

export function renderStickRadius(body, L) {
  const sec = document.createElement('div'); sec.className = 'pp-sec'; sec.textContent = 'style';
  body.appendChild(sec);
  const cur = H.renderer.layerStickRadius(L.id);
  // slider covers the common range; the number box types exact / beyond-slider
  // values (no hard cap — deposit-scale views can want fat sticks).
  const r = document.createElement('input'); r.type = 'range'; r.min = 0.2; r.max = 25; r.step = 0.1;
  r.value = Math.min(cur, 25);
  const num = document.createElement('input'); num.type = 'number'; num.min = 0.05; num.step = 0.1; num.value = String(cur); num.style.width = '58px';
  const apply = (v) => {
    if (!Number.isFinite(v) || v <= 0) return;
    L.docs.dhDoc.config.radius = v;
    stageGate(L, () => { H.renderer.setLayerStickRadius(L.id, v); H.requestRender(); });
    H.markProjectDirty();
  };
  r.oninput = () => { num.value = (+r.value).toFixed(1); apply(+r.value); };
  num.onchange = () => { const v = +num.value; r.value = Math.min(Math.max(v, +r.min), +r.max); apply(v); };
  body.appendChild(mkRow('stick radius (m)', r, num));
}

export function renderRampSection(body, L) {
  const cfg = rampCfgOf(L) || { preset: 'viridis', classed: false, breaks: [] };
  const sec = document.createElement('div'); sec.className = 'pp-sec'; sec.textContent = 'ramp';
  body.appendChild(sec);
  const sel = document.createElement('select');
  for (const name of Object.keys(RAMP_PRESETS)) { const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o); }
  sel.value = cfg.preset;
  sel.onchange = () => { setRampCfg(L, { preset: sel.value }); renderProps(); };
  const cl = document.createElement('label');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!cfg.classed;
  cb.onchange = () => { setRampCfg(L, { classed: cb.checked }); renderProps(); };
  cl.append(cb, ' classed');
  cl.title = 'solid color per interval — the grade-shell legend; unchecked stretches the ramp between breakpoints';
  body.appendChild(mkRow('', sel, cl));
  // the baked preview strip
  const prev = document.createElement('canvas'); prev.className = 'pp-ramp-preview'; prev.width = 256; prev.height = 1;
  const drawPreview = () => {
    const [lo, hi] = rampRangeFor(L);
    const px = bakeRampPixels(rampCfgOf(L) || cfg, lo, hi);
    const g2 = prev.getContext('2d');
    const img = g2.createImageData(256, 1);
    img.data.set(px);
    g2.putImageData(img, 0, 0);
  };
  drawPreview();
  _rampRepaint = { prev: drawPreview, hist: null };
  body.appendChild(prev);
  const selv = colorSelOf(L);
  const isChan = String(selv).startsWith('chan:');
  const isRatio = String(selv).startsWith('paint:');       // only ratio channels reach here
  const isElev = selv === 'elev' || selv === '0';
  if (!isChan && !isElev && !isRatio) {
    body.appendChild(ppNote('breakpoints live on grade channels and elevation'));
    return;
  }
  const [rLo, rHi] = rampRangeFor(L);
  renderIntervalTable(body, L, rLo, rHi);
  // the breaks quick-entry — type round numbers, Enter applies (sorted, deduped)
  {
    const cfgNow = rampCfgOf(L);
    const bIn = document.createElement('input'); bIn.type = 'text';
    bIn.placeholder = 'e.g. 15, 25, 40';
    bIn.style.cssText = 'flex:1;background:#242424;color:var(--text);border:1px solid var(--border);font:inherit;padding:2px 5px;';
    bIn.value = ((cfgNow && cfgNow.breaks) || []).map((v) => fmtStat(v)).join(', ');
    const applyBreaks = () => {
      const vals = bIn.value.split(/[,;\s]+/).map(parseFloat).filter(Number.isFinite).sort((a, b2) => a - b2);
      const breaks = vals.filter((v, i) => i === 0 || v > vals[i - 1]);
      setRampCfg(L, { breaks, colors: null });             // band count changed — custom colors are stale
      renderProps();
    };
    bIn.onkeydown = (e) => { if (e.key === 'Enter') applyBreaks(); };
    bIn.onblur = () => { if (bIn.value !== ((rampCfgOf(L) || {}).breaks || []).map((v) => fmtStat(v)).join(', ')) applyBreaks(); };
    body.appendChild(mkRow('breaks', bIn));
    // live drag sync — but never while the user is typing in it
    if (_rampRepaint) _rampRepaint.breaksIn = () => {
      if (document.activeElement === bIn) return;
      bIn.value = (((rampCfgOf(L) || {}).breaks) || []).slice().sort((a, b2) => a - b2).map((v) => fmtStat(v)).join(', ');
    };
  }
  if (!isChan && !isRatio) return;                         // the histogram is scan-fed — channels and ratio columns have stats
  const h = layerTableHeader(L);
  const colName = isRatio ? String(selv).slice(6) : (h && h.columns[+String(selv).slice(5)]);
  const stat = colName && L._colStats && L._colStats[colName];
  if (!stat || stat.kind !== 'num' || !stat.centroids) {
    const btn = document.createElement('button'); btn.className = 'pp-scan';
    btn.textContent = `scan ${colName || 'the channel'} for its histogram + quantiles`;
    wireScanButton(btn, L, colName ? [colName] : null);
    body.appendChild(btn);
    return;
  }
  // ── the histogram editor ──
  const cvh = document.createElement('canvas'); cvh.className = 'pp-hist'; cvh.width = 480; cvh.height = 144;
  const [lo, hi] = rampRangeFor(L);
  const span = hi > lo ? hi - lo : 1;
  const N = 48, bins = histogramFromCentroids(stat.centroids, stat.total, lo, lo + span, N);
  let peak = 0;
  const pos = [];
  for (let b2 = 0; b2 < N; b2++) { if (bins[b2] > peak) peak = bins[b2]; if (bins[b2] > 0) pos.push(bins[b2]); }
  pos.sort((a, b2) => a - b2);
  // grade data is lognormal — a dominant waste value buries the ore tail on a
  // linear count axis. Auto log when the peak dwarfs the median populated bin.
  if (L._histLog == null) L._histLog = peak > 50 * Math.max(1, pos.length ? pos[pos.length >> 1] : 1);
  const barH = (n) => (L._histLog ? Math.log1p(n) / Math.log1p(peak) : peak ? n / peak : 0);
  const vx = (v) => ((v - lo) / span) * cvh.width;
  const xv = (x) => lo + (x / cvh.width) * span;
  const draw = () => {
    const g2 = cvh.getContext('2d');
    g2.clearRect(0, 0, cvh.width, cvh.height);
    // the bars wear the colors their values RENDER as (the baked LUT) — the
    // histogram is the legend; drag a break and the colors split at the line
    const lut = bakeRampPixels(rampCfgOf(L) || { preset: 'viridis', breaks: [] }, lo, hi);
    for (let b2 = 0; b2 < N; b2++) {
      const hp = bins[b2] ? Math.max(1, Math.round((cvh.height - 14) * barH(bins[b2]))) : 0;
      if (!hp) continue;
      const ti = Math.min(255, Math.max(0, Math.round(((b2 + 0.5) / N) * 255)));
      g2.fillStyle = `rgb(${lut[ti * 4]},${lut[ti * 4 + 1]},${lut[ti * 4 + 2]})`;
      g2.fillRect(b2 * 10, cvh.height - hp, 9, hp);
    }
    const c2 = rampCfgOf(L);
    for (const v of (c2 && c2.breaks) || []) {
      const x = vx(v);
      g2.fillStyle = '#c89b3c';
      g2.fillRect(x - 1, 0, 2, cvh.height);
      g2.font = '11px monospace'; g2.textAlign = 'center';
      g2.fillText(fmtStat(v), Math.max(18, Math.min(cvh.width - 18, x)), 11);
    }
  };
  draw();
  if (_rampRepaint) _rampRepaint.hist = draw;
  const evX = (e) => { const r2 = cvh.getBoundingClientRect(); return ((e.clientX - r2.left) / r2.width) * cvh.width; };
  const nearBreak = (x) => {
    const c2 = rampCfgOf(L);
    if (!c2 || !c2.breaks) return -1;
    let best = -1, bd = 8;
    c2.breaks.forEach((v, i) => { const d2 = Math.abs(vx(v) - x); if (d2 < bd) { bd = d2; best = i; } });
    return best;
  };
  let dragging = -1;
  cvh.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x = evX(e);
    const k = nearBreak(x);
    if (k >= 0) { dragging = k; cvh.setPointerCapture(e.pointerId); }
  });
  cvh.addEventListener('pointermove', (e) => {
    const x = evX(e);
    if (dragging >= 0) {
      const c2 = rampCfgOf(L, true);
      c2.breaks[dragging] = xv(x);
      draw(); drawPreview();
      // live 3D tracking: with deferred re-shade a mid-drag ramp update is one
      // fullscreen resolve pass, not a re-raster — the model recolours under
      // the drag. Non-forced → the staged-apply mode still stages.
      applyRamp(L);
      // …and the interval table + breaks entry follow the gesture in place
      if (_rampRepaint && _rampRepaint.bands) _rampRepaint.bands();
      if (_rampRepaint && _rampRepaint.breaksIn) _rampRepaint.breaksIn();
    } else cvh.style.cursor = nearBreak(x) >= 0 ? 'ew-resize' : 'crosshair';
  });
  cvh.addEventListener('pointerup', () => { if (dragging >= 0) { dragging = -1; setRampCfg(L, {}); renderProps(); } });
  cvh.addEventListener('dblclick', (e) => {
    const c2 = rampCfgOf(L, true);
    c2.breaks.push(xv(evX(e)));
    c2.breaks.sort((a, b2) => a - b2);
    setRampCfg(L, {});
    renderProps();                                          // the interval table + breaks input follow the gesture
  });
  cvh.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const k = nearBreak(evX(e));
    if (k >= 0) { const c2 = rampCfgOf(L, true); c2.breaks.splice(k, 1); setRampCfg(L, {}); renderProps(); }
  });
  body.appendChild(cvh);
  const hint = document.createElement('div'); hint.className = 'pp-hist-hint';
  hint.textContent = 'double-click adds a breakpoint · drag moves · right-click removes';
  body.appendChild(hint);
  // auto-breaks from the scan's t-digest
  const bulk = document.createElement('div'); bulk.className = 'pp-bulk';
  const nIn = document.createElement('input'); nIn.type = 'number'; nIn.min = 2; nIn.max = 12; nIn.value = 5;
  nIn.style.cssText = 'width:44px;background:#242424;color:var(--text);border:1px solid var(--border);font:inherit;padding:1px 3px;';
  const mkA = (label, fn) => { const a = document.createElement('a'); a.textContent = label; a.onclick = fn; return a; };
  const logL = document.createElement('label');
  const logCb = document.createElement('input'); logCb.type = 'checkbox'; logCb.checked = !!L._histLog;
  logCb.onchange = () => { L._histLog = logCb.checked; draw(); };
  logL.append(logCb, ' log');
  logL.title = 'log-scale the counts — grade distributions bury their ore tail on a linear axis';
  bulk.append(
    nIn,
    mkA('quantiles', () => {
      const n = Math.max(2, Math.min(12, +nIn.value || 5));
      const q = (p2) => quantileFromCentroids(stat.centroids, stat.total, p2);
      let breaks = [];
      const collect = (cents, total) => {
        const out = [];
        for (let i = 1; i < n; i++) {
          const v = quantileFromCentroids(cents, total, i / n);
          if (Number.isFinite(v) && v > lo && v < hi && (!out.length || v - out[out.length - 1] > span * 1e-4)) out.push(v);
        }
        return out;
      };
      breaks = collect(stat.centroids, stat.total);
      if (breaks.length < Math.min(2, n - 1)) {
        // a dominant value (waste at min grade) collapses the quantiles —
        // fall back to quantiles of the TAIL above it: breaks within the
        // mineralized population, which is what a grade legend wants
        const tail = stat.centroids.filter(([m2]) => m2 > lo + span * 1e-6);
        const tTotal = tail.reduce((a, c2) => a + c2[1], 0);
        if (tTotal > 0) breaks = collect(tail, tTotal);
      }
      setRampCfg(L, { breaks, colors: null }); renderProps();
    }),
    mkA('equal', () => {
      const n = Math.max(2, Math.min(12, +nIn.value || 5));
      const breaks = [];
      for (let i = 1; i < n; i++) breaks.push(lo + (span * i) / n);
      setRampCfg(L, { breaks, colors: null }); renderProps();
    }),
    mkA('clear', () => { setRampCfg(L, { breaks: [], colors: null }); renderProps(); }),
    logL,
  );
  body.appendChild(bulk);
}

// the interval table (§10 breakpoints): one row per BAND — swatch (an
// editable color chip in classed mode: grade shells colored like categories),
// the upper boundary editable in place, count + share from the scan's
// centroids. The quick-entry input above stays for typing round numbers.
export function renderIntervalTable(body, L, lo, hi) {
  const cfg = rampCfgOf(L);
  const breaks = ((cfg && cfg.breaks) || []).filter((v) => Number.isFinite(v) && v > lo && v < hi).sort((a, b2) => a - b2);
  if (!breaks.length) return;
  const stops = RAMP_PRESETS[(cfg && cfg.preset) || 'viridis'] || RAMP_PRESETS.viridis;
  const selv = colorSelOf(L);
  const h = layerTableHeader(L);
  const colName = String(selv).startsWith('chan:') && h ? h.columns[+String(selv).slice(5)] : null;
  const stat = colName && L._colStats && L._colStats[colName];
  const F = stat && stat.centroids ? cdfFromCentroids(stat.centroids, stat.total) : null;
  const bandCount = (a, b2) => (F ? Math.max(0, F(b2) - F(a)) : null);
  const edges = [lo, ...breaks, hi];
  const fmtN = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e5 ? Math.round(v / 1e3) + 'k' : Math.round(v).toLocaleString());
  const liveRows = [];                                     // per-band element refs for the live drag sync
  for (let k = 0; k < edges.length - 1; k++) {
    const row = document.createElement('div'); row.className = 'pp-band';
    const live = { fromS: null, toIn: null, toS: null, sw: null, ct: null };
    liveRows.push(live);
    const midT = cfg.classed ? (k + 0.5) / (edges.length - 1) : ((edges[k] + edges[k + 1]) / 2 - lo) / Math.max(hi - lo, 1e-9);
    const defHex = '#' + rampSample(stops, midT).map((v) => v.toString(16).padStart(2, '0')).join('');
    if (cfg.classed) {
      const chip = document.createElement('input'); chip.type = 'color';
      chip.value = (cfg.colors && cfg.colors[k]) || defHex;
      chip.style.cssText = 'width:16px;height:14px;padding:0;border:1px solid var(--border);background:none;cursor:pointer;';
      chip.oninput = () => {
        const c2 = rampCfgOf(L, true);
        c2.colors = c2.colors || [];
        c2.colors[k] = chip.value;
        setRampCfg(L, {});
      };
      row.appendChild(chip);
    } else {
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = defHex;
      row.appendChild(sw);
      live.sw = sw;
    }
    const fromS = document.createElement('span'); fromS.className = 'from'; fromS.textContent = fmtStat(edges[k]);
    const dash = document.createElement('span'); dash.className = 'dash'; dash.textContent = '–';
    row.append(fromS, dash);
    live.fromS = fromS;
    if (k < edges.length - 2) {
      const toIn = document.createElement('input'); toIn.type = 'number'; toIn.step = 'any';
      toIn.value = +edges[k + 1].toFixed(2);
      toIn.onchange = () => {
        const v = parseFloat(toIn.value);
        if (!Number.isFinite(v) || v <= lo || v >= hi) { toIn.value = +edges[k + 1].toFixed(2); return; }
        const c2 = rampCfgOf(L, true);
        c2.breaks = breaks.map((b3, i) => (i === k ? v : b3)).sort((a, b3) => a - b3).filter((b3, i, arr) => i === 0 || b3 > arr[i - 1]);
        setRampCfg(L, {});
        renderProps();
      };
      row.appendChild(toIn);
      live.toIn = toIn;
    } else {
      const toS = document.createElement('span'); toS.className = 'to-max'; toS.textContent = fmtStat(edges[k + 1]);
      row.appendChild(toS);
      live.toS = toS;
    }
    const ct = document.createElement('span'); ct.className = 'ct';
    const n = bandCount(edges[k], k === edges.length - 2 ? edges[k + 1] + 1e-9 : edges[k + 1]);
    ct.textContent = n == null ? '–' : `${fmtN(n)} · ${stat.total ? Math.round((100 * n) / stat.total) : 0}%`;
    row.appendChild(ct);
    live.ct = ct;
    body.appendChild(row);
  }
  // live drag sync: the histogram drag repatches bounds, swatches, and counts
  // in place — the FILE-of-record stays cfg.breaks; renderProps still owns any
  // structural change (a band added/removed mid-gesture just freezes the table
  // until pointerup)
  if (_rampRepaint) _rampRepaint.bands = () => {
    const c2 = rampCfgOf(L);
    const bks = ((c2 && c2.breaks) || []).filter((v) => Number.isFinite(v) && v > lo && v < hi).sort((a, b3) => a - b3);
    if (bks.length !== breaks.length) return;
    const ed = [lo, ...bks, hi];
    liveRows.forEach((r, k) => {
      r.fromS.textContent = fmtStat(ed[k]);
      if (r.toIn && document.activeElement !== r.toIn) r.toIn.value = +ed[k + 1].toFixed(2);
      if (r.toS) r.toS.textContent = fmtStat(ed[k + 1]);
      if (r.sw) {
        const midT = c2 && c2.classed ? (k + 0.5) / (ed.length - 1) : ((ed[k] + ed[k + 1]) / 2 - lo) / Math.max(hi - lo, 1e-9);
        r.sw.style.background = '#' + rampSample(stops, midT).map((v) => v.toString(16).padStart(2, '0')).join('');
      }
      const n2 = bandCount(ed[k], k === ed.length - 2 ? ed[k + 1] + 1e-9 : ed[k + 1]);
      r.ct.textContent = n2 == null ? '–' : `${fmtN(n2)} · ${stat.total ? Math.round((100 * n2) / stat.total) : 0}%`;
    });
  };
}

// LAS classification names (ASPRS standard 0–18)
export const LAS_CLASSES = ['never classified', 'unclassified', 'ground', 'low vegetation', 'medium vegetation', 'high vegetation', 'building', 'low point (noise)', 'reserved', 'water', 'rail', 'road surface', 'reserved', 'wire — guard', 'wire — conductor', 'transmission tower', 'wire connector', 'bridge deck', 'high noise'];

export function layerClassInfo(L) {
  const d = L.docs || {};
  const h = (d.blockDoc || d.dhDoc || d.stringsDoc || {}).header;
  if (h && h.categories && h.categories.length) {
    const px = categoryPalettePixels(256);
    return {
      kind: 'dict', names: h.categories, codes: h.categories.map((_, i) => i),
      colorAt: (c) => `rgb(${px[c * 4]},${px[c * 4 + 1]},${px[c * 4 + 2]})`,
      column: h.columns && h.mapping && h.mapping.cat != null ? h.columns[h.mapping.cat] : 'category',
      countable: !!(d.dhDoc || d.blockDoc),
    };
  }
  if (d.lasDoc) {
    const px = palettePixels();
    return {
      kind: 'las', names: LAS_CLASSES, codes: LAS_CLASSES.map((_, i) => i),
      colorAt: (c) => `rgb(${px[c * 4]},${px[c * 4 + 1]},${px[c * 4 + 2]})`,
      column: 'classification', countable: false,
    };
  }
  return null;
}

// ── staged apply (the pp footer): auto ON = live-apply (the default, micro's
// grammar); auto OFF = panel style edits mutate the LAYER STATE but hold the
// renderer push until [apply] — one reconvergence instead of one per edit on
// huge layers. [revert] restores the snapshot from when the panel targeted
// the layer. Source-tab re-reads and toolbar controls stay immediate. ──
export let _autoApply = (() => { try { return localStorage.getItem('micro.autoApply') !== 'off'; } catch { return true; } })();

export function setAutoApply(on) { _autoApply = !!on; try { localStorage.setItem('micro.autoApply', on ? 'on' : 'off'); } catch { /* ignore */ } }

export function styleSnap(L) {
  return {
    ramps: L.ramps ? JSON.parse(JSON.stringify(L.ramps)) : null,
    catLegend: L.catLegend ? JSON.parse(JSON.stringify(L.catLegend)) : null,
    catHidden: L.catHidden ? [...L.catHidden] : [],
    rules: L.rules ? JSON.parse(JSON.stringify(L.rules)) : null,
    ruleHidden: L.ruleHidden ? [...L.ruleHidden] : [],
    tint: L.tint, opacity: L.opacity,
    radius: L.docs && L.docs.dhDoc ? L.docs.dhDoc.config.radius || 1 : null,
  };
}

export function stageGate(L, push) {
  if (_autoApply || !_propOpen || !L || L.id !== _propFor) { push(); return; }
  L._stagePend = true;
  syncPPFooter();
}

export function pushAllStyle(L) {
  applyCatVisibility(L, true);
  applyCatLegend(L, true);
  applyRamp(L, true);
  if (ruleModeOf(L) && (L._rulesDirty || !L._ruleCodes) && rulesOf(L).length) runRules(L, true);
  if (L.kind === 'mesh') H.renderer.setLayerMeshStyle(L.id, { tint: H.hexToRgb01(L.tint || '#9ea3a8'), opacity: L.opacity != null ? L.opacity : 1 });
  if (L.dh && L.docs.dhDoc) H.renderer.setLayerStickRadius(L.id, L.docs.dhDoc.config.radius || 1);
  L._stagePend = false;
  H.requestRender();
  syncPPFooter();
}

export function revertStyle(L) {
  const s2 = L._styleSnap; if (!s2) return;
  L.ramps = s2.ramps ? JSON.parse(JSON.stringify(s2.ramps)) : null;
  L.catLegend = s2.catLegend ? JSON.parse(JSON.stringify(s2.catLegend)) : null;
  L.catHidden = new Set(s2.catHidden);
  L.rules = s2.rules ? JSON.parse(JSON.stringify(s2.rules)) : null;
  L.ruleHidden = new Set(s2.ruleHidden || []);
  L._rulesDirty = true;                                    // codes may not match the restored list
  if (s2.tint != null) L.tint = s2.tint;
  if (s2.opacity != null) L.opacity = s2.opacity;
  if (s2.radius != null && L.docs && L.docs.dhDoc) L.docs.dhDoc.config.radius = s2.radius;
  pushAllStyle(L);
  H.markProjectDirty();
  renderProps();
}

export function syncPPFooter() {
  const L = activeLayer();
  $('#ppAuto').checked = _autoApply;
  $('#ppApply').disabled = _autoApply || !L || !L._stagePend;
  $('#ppApply').textContent = L && L._stagePend ? 'apply •' : 'apply';
}

export function applyCatVisibility(L, force) {
  if (!force) return stageGate(L, () => applyCatVisibility(L, true));
  if (ruleModeOf(L)) return applyRuleVisibility(L, true);  // rule mode: the vis texture is indexed by RULE code
  if (paintActiveCol(L)) { H.renderer.setLayerCatVisibility(L.id, null); H.requestRender(); return; }   // paint mode: no code eyes
  if (!L.catHidden || !L.catHidden.size) H.renderer.setLayerCatVisibility(L.id, null);
  else {
    const v = new Uint8Array(256).fill(1);
    for (const c of L.catHidden) v[c & 255] = 0;
    H.renderer.setLayerCatVisibility(L.id, v);
  }
  H.markProjectDirty(); H.requestRender();
}

export function restoreHiddenCats(L, arr) {
  if (!arr || !arr.length) return;
  const h = layerHeaderOf(L);
  const dict = h && h.categories;
  L.catHidden = new Set(arr.map((v) => (typeof v === 'number' ? v : dict ? dict.indexOf(v) : -1)).filter((c) => c >= 0));
  if (L.catHidden.size) applyCatVisibility(L, true);
}

// counts fill in async — the eyes never wait on a sweep
export async function ensureCatCounts(L, info) {
  if (L._catCounts || !info.countable) return L._catCounts || null;
  const counts = new Map();
  let total = 0;
  const d = L.docs;
  if (d.dhDoc) {
    const dh = d.dhDoc, ci = dh.header.mapping.cat;
    const code = new Map(info.names.map((n, i) => [n, i]));
    for (let i = 0; i < dh.header.count; i++) {
      const f = dh.fetchRecord(i);
      const c = code.get(String(f[ci]).trim());
      if (c != null) { counts.set(c, (counts.get(c) || 0) + 1); total++; }
    }
  } else if (d.blockDoc) {
    // ONE loop for all three block sources. It was two — a `.dm` branch and a
    // delimited branch with an identical body — and Parquet, being neither, fell
    // into the delimited one and had its binary bytes parsed as text. The Classes
    // tab then showed counts of zero or nonsense beside category NAMES that were
    // perfectly correct (those come from the footer), which is the hardest kind of
    // wrong to notice. layerRows already abstracts the row source, so asking it
    // fixes the bug and deletes the duplication together.
    const m = d.blockDoc.header.mapping;
    const code = new Map(info.names.map((n, i) => [n, i]));
    for await (const batch of layerRows(L, null)) {   /* rows ok: category counts: placed blocks only, not numbered */
      for (const f of batch) {
        if (!Number.isFinite(coordNum(f[m.x])) || !Number.isFinite(coordNum(f[m.y])) || !Number.isFinite(coordNum(f[m.z]))) continue;
        const c = code.get(String(f[m.cat]).trim());
        if (c != null) counts.set(c, (counts.get(c) || 0) + 1);
        total++;
      }
    }
  }
  L._catCounts = { counts, total };
  return L._catCounts;
}

export function renderClassesTab(body, L) {
  if (ruleModeOf(L)) {
    body.appendChild(ppNote('rule-based mode — visibility follows the RULES (style tab), not the category classes'));
    return;
  }
  const info = layerClassInfo(L);
  if (!info) {
    body.appendChild(ppNote(L.kind === 'mesh'
      ? 'meshes are scenery — classes arrive with mesh records (OBJ groups) on the roadmap'
      : 'no category column in this layer — classes light up when one is mapped (LITO, classification, …)'));
    return;
  }
  renderClassList(body, L, info);
}

// ── the CATEGORY LEGEND (§10 categorized): entries decoupled from the raw
// column values — each owns a color, a label, and a SET of member values
// (grouping = one row, one color, eyes toggle every member code). Removed
// values fall into an automatic grey "other" bucket. Colors bake into a
// per-layer palette texture; the class codes on the GPU never change. ──
export const rgbCssToHex = (css) => {
  const m2 = String(css).match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m2 ? '#' + [1, 2, 3].map((i) => (+m2[i]).toString(16).padStart(2, '0')).join('') : '#888888';
};

export function defaultLegendEntries(info) {
  return info.codes.map((c) => ({ label: String(info.names[c]), values: [info.kind === 'las' ? c : String(info.names[c])], color: rgbCssToHex(info.colorAt(c)) }));
}

export function legendOf(L, info) {
  if (L.catLegend && L.catLegend.col === info.column) return L.catLegend;
  return { col: info.column, entries: defaultLegendEntries(info), otherColor: '#555a5f' };
}

export function ensureLegend(L, info) {
  if (!L.catLegend || L.catLegend.col !== info.column) L.catLegend = legendOf(L, info);
  return L.catLegend;
}

export const legendCodesOf = (info, e) => e.values.map((v) => (typeof v === 'number' ? v : info.names.indexOf(v))).filter((c) => c >= 0);

export function applyCatLegend(L, force) {
  if (!force) return stageGate(L, () => applyCatLegend(L, true));
  if (ruleModeOf(L)) return applyRulePalette(L, true);     // rule mode: the palette holds RULE colors
  { const pc = paintActiveCol(L); if (pc) return applyPaintPalette(L, pc); }   // paint mode: painted-value colors
  const info = layerClassInfo(L);
  if (!info) return;
  const leg = L.catLegend && L.catLegend.col === info.column ? L.catLegend : null;
  if (!leg) { H.renderer.setLayerPalette(L.id, null); H.requestRender(); return; }
  const width = info.kind === 'las' ? 32 : 256;
  const px = new Uint8Array(width * 4);
  const put = (c, hex) => {
    const n = parseInt(hex.slice(1), 16);
    px[c * 4] = (n >> 16) & 255; px[c * 4 + 1] = (n >> 8) & 255; px[c * 4 + 2] = n & 255; px[c * 4 + 3] = 255;
  };
  for (let c = 0; c < width; c++) put(c, leg.otherColor || '#555a5f');   // uncovered → the other bucket
  for (const e of leg.entries) for (const c of legendCodesOf(info, e)) if (c < width) put(c, e.color);
  H.renderer.setLayerPalette(L.id, px, width);
  H.requestRender();
}

// ── rule-based styling (spec §10.4): ordered expr predicates → colors. One
// sweep evaluates the rules FIRST-MATCH-WINS into a per-record u8 code array
// (the filter-mask machinery), uploaded as the layer's rule texture; the code
// then substitutes for the class code in every element program, so the
// palette, per-rule eyes, and pick culling are the categorized machinery
// re-aimed. Rules are declarative (they persist; codes rebuild on load). ──
export const RULE_ELSE = '#555a5f';

export function ruleModeOf(L) { return L && colorSelOf(L) === 'rules'; }

export function rulesOf(L) { return (L.rules && L.rules.list) || []; }

// painted-column color channel: colorSel 'paint:<name>' → that column's codes
// ride the SAME rule texture + palette (rules fill codes by expression,
// painting fills them by gesture — one GPU path)
// ── color-by-ƒ: a calc column drives the display via an EPHEMERAL realization —
// a display CACHE, not data (never serialized, invisible to exports/records;
// materialize→stored stays the freeze path). Freshness = a hash of the
// DEFINITION CLOSURE (this expr + every transitively-referenced ƒ expr, via
// deps) + source identity + the paint version (a brush stroke can feed a calc).
// Stale → re-realize lazily (one scan) → bake codes → the same ratio-paint
// palette/codes path materialized columns ride. One realization per layer
// (the colored one); kept when you color away, replaced when you pick another.
export function calcSelOf(L) { const v = L && colorSelOf(L); return v && typeof v === 'string' && v.startsWith('calc:') ? v.slice(5) : null; }

export function calcDisplayHash(L, name) {
  const by = new Map((L.calcCols || []).map((c) => [String(c.name).toLowerCase(), c]));
  const seen = new Set(); const parts = [];
  (function walk(nm) {
    const c = by.get(nm); if (!c || seen.has(nm)) return; seen.add(nm);
    parts.push(c.name + '=' + c.expr);
    let ds = []; try { ds = deps(c.expr); } catch { /* bad expr → no deps */ }
    for (const d of ds) walk(String(d).toLowerCase());
  })(String(name).toLowerCase());
  return parts.join('\n') + '|' + matColSourceHash(L) + '|' + (L._paintVer || 0);
}

export function calcDisplayCol(L) {
  const name = calcSelOf(L); if (!name) return null;
  const cd = L._calcDisplay;
  return cd && cd.name === name && cd.hash === calcDisplayHash(L, name) ? cd.col : null;
}

export async function ensureCalcDisplay(L) {
  const name = calcSelOf(L); if (!name || calcDisplayCol(L)) return;
  const cc = (L.calcCols || []).find((c) => c.name === name); if (!cc || cc.ty === 'string') return;
  const hash = calcDisplayHash(L, name);
  if (L._calcDisplayBusy === hash) return;                 // this exact state is already being realized
  L._calcDisplayBusy = hash;
  $('#meta').textContent = `ƒ ${name}: computing for display…`;
  let vals;
  try { vals = await realizeCalc(L, name); }
  catch (e) { L._calcDisplayBusy = null; $('#meta').textContent = `ƒ ${name}: ${e.message}`; return; }
  L._calcDisplayBusy = null;
  if (calcSelOf(L) !== name || hash !== calcDisplayHash(L, name)) { ensureCalcDisplay(L); return; }   // went stale mid-scan
  let mn = Infinity, mx = -Infinity, nn = 0;
  for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; nn++; } }
  if (!nn) { mn = 0; mx = 0; }
  const col = { name, kind: 'ratio', mat: true, selKey: 'calc:' + name, fvalues: vals, codes: matColCodes(vals, mn, mx), blankColor: PAINT_BLANK, min: mn, max: mx, count: vals.length, nonnull: nn };
  L._calcDisplay = { name, hash, col };
  applyRamp(L, true); syncRuleMode(L);
  $('#meta').textContent = `ƒ ${name}: colored — ${nn.toLocaleString()} values, ${fmtStat(mn)} … ${fmtStat(mx)}`;
}

export function paintSelOf(L) {
  const v = L && colorSelOf(L);
  return v && typeof v === 'string' && v.startsWith('paint:') ? v.slice(6) : null;
}

export function paintActiveCol(L) {
  const name = paintSelOf(L);
  return name ? (L.paintCols || []).find((c) => c.name === name) : null;
}

export function applyPaintPalette(L, col) {
  if (col.kind === 'ratio') {
    // a ratio column is a full numeric channel: preset/classed/breakpoints and
    // the clip window all apply, baked through the palette (codes are absolute
    // v = code/255; the LUT covers the clip range, codes remap into it)
    const cfg = (L.ramps && L.ramps[col.selKey || ('paint:' + col.name)]) || { preset: 'viridis', classed: false, breaks: [] };
    const clip = [parseFloat(L.clip && L.clip[0]), parseFloat(L.clip && L.clip[1])];
    const lo = Number.isFinite(clip[0]) ? clip[0] : 0, hi = Number.isFinite(clip[1]) ? clip[1] : 1;
    const lut = bakeRampPixels(cfg, lo, hi);
    const px = new Uint8Array(256 * 4);
    const span = Math.max(hi - lo, 1e-9);
    for (let code = 0; code < 256; code++) {
      const t = Math.max(0, Math.min(1, (code / 255 - lo) / span));
      const s2 = Math.round(t * 255) * 4;
      px[code * 4] = lut[s2]; px[code * 4 + 1] = lut[s2 + 1]; px[code * 4 + 2] = lut[s2 + 2]; px[code * 4 + 3] = 255;
    }
    H.renderer.setLayerPalette(L.id, px, 256);
    H.requestRender();
    return;
  }
  const px = new Uint8Array(256 * 4);
  const put = (c, hex) => {
    const v = parseInt(hex.slice(1), 16);
    px[c * 4] = (v >> 16) & 255; px[c * 4 + 1] = (v >> 8) & 255; px[c * 4 + 2] = v & 255; px[c * 4 + 3] = 255;
  };
  for (let c = 0; c < 256; c++) put(c, col.blankColor || PAINT_BLANK);
  col.dict.forEach((label, i) => { if (i > 0 && i < 256 && label != null) put(i, col.colors[i] || RULE_ELSE); });
  H.renderer.setLayerPalette(L.id, px, 256);
  H.requestRender();
}

// (paintRecount lives in src/columns.js)
// paint options ride the toolbar color select for the ACTIVE layer (inserted
// before 'solid'); called on layer switch, column create, and restore
export function addPaintColorOptions(L) {
  if (!L || L.id !== S.activeId) return;
  const sel = $('#colorBy');
  for (const pc of L.paintCols || []) {
    const v = 'paint:' + pc.name;
    if (![...sel.options].some((o) => o.value === v)) {
      const o = document.createElement('option'); o.value = v; o.textContent = (pc.kind === 'ratio' ? '% ' : '✎ ') + pc.name;
      const solid = [...sel.options].find((x) => x.value === 'solid');
      sel.insertBefore(o, solid || null);
    }
  }
  for (const cc of (L.calcCols || []).filter((c) => c.ty !== 'string')) {   // ƒ numeric calcs color too
    const v = 'calc:' + cc.name;
    if (![...sel.options].some((o) => o.value === v)) {
      const o = document.createElement('option'); o.value = v; o.textContent = 'ƒ ' + cc.name;
      const solid = [...sel.options].find((x) => x.value === 'solid');
      sel.insertBefore(o, solid || null);
    }
  }
  for (const o of [...sel.options]) if (o.value.startsWith('calc:') && !(L.calcCols || []).some((c) => c.ty !== 'string' && 'calc:' + c.name === o.value)) o.remove();
  // other text columns a host offered as categories (addLayer roles.categories):
  // choosing one re-reads the layer with it as THE category (setLayerColorBy)
  const h = H.colorHeaderOf(L), curCat = h && h.categories ? h.columns[h.mapping.cat] : null;
  for (const o of [...sel.options]) if (o.value.startsWith('catcol:')) o.remove();
  for (const name of L.catChoices || []) {
    if (name === curCat) continue;
    const o = document.createElement('option'); o.value = 'catcol:' + name; o.textContent = name;
    const after = [...sel.options].find((x) => x.value === 'cat') || [...sel.options].find((x) => x.value === 'rules');
    sel.insertBefore(o, after ? (after.value === 'cat' ? after.nextSibling : after) : null);
  }
}

// (ruleDefaultColor lives in src/columns.js)
export function applyRulePalette(L, force) {
  if (!force) return stageGate(L, () => applyRulePalette(L, true));
  const rules = rulesOf(L);
  const px = new Uint8Array(256 * 4);
  const put = (c, hex) => {
    const v = parseInt(hex.slice(1), 16);
    px[c * 4] = (v >> 16) & 255; px[c * 4 + 1] = (v >> 8) & 255; px[c * 4 + 2] = v & 255; px[c * 4 + 3] = 255;
  };
  for (let c = 0; c < 256; c++) put(c, (L.rules && L.rules.elseColor) || RULE_ELSE);
  rules.forEach((r, i) => { if (i + 1 < 256) put(i + 1, r.color || RULE_ELSE); });
  H.renderer.setLayerPalette(L.id, px, 256);
  H.requestRender();
}

export function applyRuleVisibility(L, force) {
  if (!force) return stageGate(L, () => applyRuleVisibility(L, true));
  if (!L.ruleHidden || !L.ruleHidden.size) H.renderer.setLayerCatVisibility(L.id, null);
  else {
    const v = new Uint8Array(256).fill(1);
    for (const c of L.ruleHidden) v[c & 255] = 0;
    H.renderer.setLayerCatVisibility(L.id, v);
  }
  H.markProjectDirty(); H.requestRender();
}

// mode entry/exit: rules, PAINTED COLUMNS, and categories share the palette +
// vis + code textures, so switching re-bakes/re-uploads whichever owns them
// now (texture updates, no sweeps — rule codes are kept CPU-side for exactly
// this hand-back)
export function syncRuleMode(L) {
  if (!L) return;
  const pc = paintActiveCol(L) || calcDisplayCol(L);
  if (!pc && calcSelOf(L)) ensureCalcDisplay(L);           // realize lazily; it re-syncs on completion
  if (ruleModeOf(L)) {
    H.renderer.setLayerRuleMode(L.id, true);
    applyRulePalette(L, true); applyRuleVisibility(L, true);
    if (L._ruleCodes) H.renderer.setLayerRuleCodes(L.id, L._ruleCodes);   // paint may have borrowed the texture
    else if (rulesOf(L).length && (!L._ruleCodes || L._rulesDirty)) runRules(L, true);
    else H.renderer.setLayerRuleCodes(L.id, null);
  } else if (pc) {
    H.renderer.setLayerRuleMode(L.id, true);
    applyPaintPalette(L, pc);
    H.renderer.setLayerCatVisibility(L.id, null);            // no per-value eyes on paint (v1)
    H.renderer.setLayerRuleCodes(L.id, pc.codes);
  } else {
    H.renderer.setLayerRuleMode(L.id, false);
    applyCatLegend(L, true); applyCatVisibility(L, true);
  }
  H.requestRender();
}

// the sweep: compile each rule against the layer schema (ƒ columns included),
// walk the table once, first matching rule claims the record. Numbering
// mirrors applyBlockFilter exactly — delimited skips non-finite-coord rows,
// .dm and drillholes are raw — so codes line up with recIdx.
export let _ruleEpoch = 0;

export async function runRules(L, force) {
  if (!force) return stageGate(L, () => runRules(L, true));
  const h = layerTableHeader(L); if (!h) return;
  applyRulePalette(L, true); applyRuleVisibility(L, true);
  H.renderer.setLayerRuleMode(L.id, ruleModeOf(L));
  const rules = rulesOf(L);
  if (!rules.length) { L._ruleCodes = null; L._ruleCounts = null; L._rulesDirty = false; H.renderer.setLayerRuleCodes(L.id, null); H.requestRender(); return; }
  const schema = schemaExt(L, h);
  const fns = [];
  for (const r of rules) {
    const v = validate(r.expr || '', schema);
    if (!(r.expr || '').trim() || !v.ok) { $('#meta').textContent = `rules: “${r.name || r.expr || 'rule ' + (rules.indexOf(r) + 1)}” — ${!(r.expr || '').trim() ? 'empty expression' : (v.errors[0] && v.errors[0].message) || 'invalid expression'}`; return; }
    fns.push(compileBool(r.expr, schema, { decimal: '.' }));
  }
  const n = attrRowCountOf(L); if (!n) return;
  const epoch = ++_ruleEpoch;
  const codes = new Uint8Array(n);
  const counts = new Uint32Array(rules.length + 1);
  const m = h.mapping || {};
  const isDelim = !blockCaps(L).rowIsRecord;
  const isDm = !!(L.docs.blockDoc && L.docs.blockDoc.header.dm);
  let rec = 0;
  $('#meta').textContent = 'rules: sweeping…';
  for await (const batch of layerRows(L, (a, b) =>   /* rows ok: rules: gates its own coordinates */ { $('#meta').textContent = `rules: sweeping… ${b ? Math.min(100, Math.round((100 * a) / b)) + '%' : a.toLocaleString()}`; })) {
    for (const f0 of batch) {
      if (isDelim) {
        const xv = coordNum(f0[m.x]), yv = coordNum(f0[m.y]), zv = coordNum(f0[m.z]);
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;   // renderer numbering skips these
      }
      const f = extendRow(L, isDm ? f0.map((v) => (v == null ? '' : v)) : f0, rec);
      let c = 0;
      for (let i = 0; i < fns.length; i++) if (fns[i](f)) { c = i + 1; break; }
      if (rec < n) { codes[rec] = c; counts[c]++; }
      rec++;
    }
    await new Promise((r) => setTimeout(r));
    if (epoch !== _ruleEpoch) return;                      // superseded by a newer sweep
  }
  L._ruleCodes = codes; L._ruleCounts = counts; L._rulesDirty = false;
  H.renderer.setLayerRuleCodes(L.id, codes);
  $('#meta').textContent = `rules: ${rules.map((r, i) => `${r.name || 'rule ' + (i + 1)} ${counts[i + 1].toLocaleString()}`).join(' · ')} · else ${counts[0].toLocaleString()}`;
  H.markProjectDirty(); H.requestRender();
  if (_propOpen && _propFor === L.id && _propTab === 'style') renderProps();   // refresh the count badges
}

// the class legend (eyes + swatches + counts + bulk) — the classes tab's body,
// also embedded by the style tab's categorized mode
export function renderClassList(body, L, info) {
  const sec = document.createElement('div'); sec.className = 'pp-sec';
  sec.textContent = `classes — ${info.column}`;
  body.appendChild(sec);
  if (!L.catHidden) L.catHidden = new Set();
  const leg = legendOf(L, info);
  // long class lists (domains, lithologies, string codes) get a search box —
  // same pattern as the record-panel field picker; bulk acts on what's shown
  let searchIn = null;
  if (leg.entries.length > 8) {
    searchIn = document.createElement('input');
    searchIn.type = 'text'; searchIn.className = 'pp-catsearch'; searchIn.placeholder = `search ${leg.entries.length} classes…`; searchIn.spellcheck = false;
    body.appendChild(searchIn);
  }
  const stored = L.catLegend === leg;
  const covered = new Set();
  for (const e of leg.entries) for (const c of legendCodesOf(info, e)) covered.add(c);
  const uncovered = stored ? info.codes.filter((c) => !covered.has(c)) : [];
  const touch = () => { ensureLegend(L, info); applyCatLegend(L); H.markProjectDirty(); };
  const entryRows = [];                                    // for the drag map
  const rowFor = (e, codes, isOther) => {
    const row = document.createElement('div'); row.className = 'pp-cat' + (codes.length && codes.every((c) => L.catHidden.has(c)) ? ' off' : '');
    if (!isOther) {
      const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⠿'; grip.title = 'drag to reorder';
      grip.onpointerdown = (ev) => {
        ev.preventDefault();
        try { grip.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
        row.style.opacity = '0.45';
        let target = -1;
        const clear = () => entryRows.forEach((r2) => r2.row.classList.remove('drop-above'));
        const move = (mv) => {
          clear();
          target = entryRows.findIndex((r2) => mv.clientY < r2.row.getBoundingClientRect().top + r2.row.offsetHeight / 2);
          if (target < 0) target = entryRows.length;
          if (entryRows[target]) entryRows[target].row.classList.add('drop-above');
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          row.style.opacity = ''; clear();
          const from = entryRows.findIndex((r2) => r2.row === row);
          if (from < 0 || target < 0 || target === from || target === from + 1) return;
          const legS = ensureLegend(L, info);
          const [it] = legS.entries.splice(from, 1);
          legS.entries.splice(target > from ? target - 1 : target, 0, it);
          H.markProjectDirty();
          renderProps();
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      };
      row.appendChild(grip);
    }
    const eye = document.createElement('input'); eye.type = 'checkbox';
    eye.checked = !codes.length || codes.some((c) => !L.catHidden.has(c));
    eye.onchange = () => {
      for (const c of codes) { if (eye.checked) L.catHidden.delete(c); else L.catHidden.add(c); }
      row.classList.toggle('off', !eye.checked);
      applyCatVisibility(L);
    };
    const sw = document.createElement('input'); sw.type = 'color'; sw.value = isOther ? (leg.otherColor || '#555a5f') : e.color;
    sw.style.cssText = 'width:16px;height:14px;padding:0;border:1px solid var(--border);background:none;cursor:pointer;flex:0 0 auto;';
    sw.oninput = () => {
      const legS = ensureLegend(L, info);
      if (isOther) legS.otherColor = sw.value;
      else { const me = legS.entries.find((x) => x === e) || legS.entries.find((x) => x.label === e.label); if (me) me.color = sw.value; }
      applyCatLegend(L); H.markProjectDirty();
    };
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = isOther ? `other (${codes.length})` : e.label + (e.values.length > 1 ? ` (${e.values.length})` : '');
    nm.title = isOther ? codes.map((c) => info.names[c]).join(', ') : e.values.map((v) => (typeof v === 'number' ? info.names[v] : v)).join(', ');
    const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = info.countable ? '…' : '–';
    row.append(eye, sw, nm, ct);
    row.oncontextmenu = (ev) => {
      ev.preventDefault();
      const legS = () => ensureLegend(L, info);
      if (isOther) {
        H.menuXY(ev.clientX, ev.clientY, [
          { label: 'Split into entries', action: () => {
            const l2 = legS();
            for (const c of codes) l2.entries.push({ label: String(info.names[c]), values: [info.kind === 'las' ? c : String(info.names[c])], color: rgbCssToHex(info.colorAt(c)) });
            touch(); renderProps();
          } },
        ]);
        return;
      }
      H.menuXY(ev.clientX, ev.clientY, [
        { label: 'Rename…', action: async () => { const v = await H.microPrompt('legend label', e.label); if (v && v.trim()) { const l2 = legS(); const me = l2.entries.find((x) => x.label === e.label); if (me) me.label = v.trim(); touch(); renderProps(); } } },
        ...(leg.entries.length > 1 ? [{ label: 'Merge into', submenu: () => leg.entries.filter((x) => x !== e).map((t2) => ({ label: t2.label, action: () => {
          const l2 = legS();
          const src = l2.entries.find((x) => x.label === e.label), dst = l2.entries.find((x) => x.label === t2.label);
          if (src && dst && src !== dst) { dst.values.push(...src.values); l2.entries.splice(l2.entries.indexOf(src), 1); touch(); renderProps(); }
        } })) }] : []),
        ...(e.values.length > 1 ? [{ label: 'Ungroup', action: () => {
          const l2 = legS();
          const me = l2.entries.find((x) => x.label === e.label);
          if (me) {
            const at = l2.entries.indexOf(me);
            const split = me.values.map((v) => { const c = typeof v === 'number' ? v : info.names.indexOf(v); return { label: String(typeof v === 'number' ? info.names[v] : v), values: [v], color: c >= 0 ? rgbCssToHex(info.colorAt(c)) : me.color }; });
            l2.entries.splice(at, 1, ...split);
            touch(); renderProps();
          }
        } }] : []),
        { label: 'Remove (→ other)', action: () => {
          const l2 = legS();
          const me = l2.entries.find((x) => x.label === e.label);
          if (me) { l2.entries.splice(l2.entries.indexOf(me), 1); touch(); renderProps(); }
        } },
      ]);
    };
    body.appendChild(row);
    return { codes, ct, row, eye };
  };
  const rows = [];
  for (const e of leg.entries) {
    const r2 = rowFor(e, legendCodesOf(info, e), false);
    rows.push(r2); entryRows.push(r2);
  }
  if (uncovered.length) rows.push(rowFor(null, uncovered, true));
  // search: hide non-matching rows; bulk verbs act on the VISIBLE set while a
  // search is active (so "none" on "cang" hides only the cangas)
  const shownRows = () => rows.filter((r) => r.row.style.display !== 'none');
  if (searchIn) {
    searchIn.oninput = () => {
      const q = searchIn.value.trim().toLowerCase();
      for (const r of rows) {
        const nm2 = r.row.querySelector('.nm');
        const hay = (nm2 ? nm2.textContent + ' ' + (nm2.title || '') : '').toLowerCase();
        r.row.style.display = !q || hay.includes(q) ? '' : 'none';
      }
    };
  }
  const bulk = document.createElement('div'); bulk.className = 'pp-bulk';
  const mkA = (label, fn) => { const a = document.createElement('a'); a.textContent = label; a.onclick = fn; return a; };
  const sync = () => {
    for (const r of rows) {
      r.eye.checked = !r.codes.length || r.codes.some((c) => !L.catHidden.has(c));
      r.row.classList.toggle('off', !r.eye.checked);
    }
    applyCatVisibility(L);
  };
  const shownCodes = () => { const out = []; for (const r of shownRows()) out.push(...r.codes); return out.length ? out : info.codes; };
  bulk.append(
    mkA('all', () => { for (const c of shownCodes()) L.catHidden.delete(c); sync(); }),
    mkA('none', () => { for (const c of shownCodes()) L.catHidden.add(c); sync(); }),
    mkA('invert', () => { for (const c of shownCodes()) { if (L.catHidden.has(c)) L.catHidden.delete(c); else L.catHidden.add(c); } sync(); }),
    ...(stored ? [mkA('reset legend', () => { L.catLegend = null; H.renderer.setLayerPalette(L.id, null); H.markProjectDirty(); H.requestRender(); renderProps(); })] : []),
  );
  body.appendChild(bulk);
  body.appendChild(ppNote('right-click an entry: rename · merge into · ungroup · remove — the color chip edits in place'));
  if (info.countable) {
    ensureCatCounts(L, info).then((cc) => {
      if (!cc || activeLayer() !== L) return;
      for (const r of rows) {
        const n = r.codes.reduce((a, c) => a + (cc.counts.get(c) || 0), 0);
        r.ct.textContent = `${n.toLocaleString()} · ${cc.total ? Math.round((100 * n) / cc.total) : 0}%`;
      }
    });
  }
}

// ── the columns tab: per-column types (with real consumers — the filter's
// schema, color-by eligibility, the category column) + streaming stats on
// request: ONE pass, ALL columns, @gcu/sluice accumulators (welford + t-digest
// for numerics, topK/cardinality for text). The t-digest centroids double as
// the sparkline — and later feed the style tab's breakpoints editor. ──
// (layerTableHeader / colIsNumeric live in src/records.js)
// calculated / virtual columns (§10.1): lamina's ƒ — an @gcu/expr VALUE
// expression evaluated as an EXTENSION OF THE ROW wherever rows are decoded
// (filter sweeps, the columns scan, the record panel). Cheap when absent:
// extendRow returns the row untouched.
// ── the COLUMN RESOLVER core (substrate step 1, in-micro) ─────────────────────
// ONE census of a layer's columns in ONE order — base (source) → STORED derived
// (paint + materialized) → COMPUTED (calc, input order) — shared by schemaExt /
// extendRow / exportColumnsOf so positions can never drift. Calc expressions
// compile against the FULL census, so a calc can reference an ESTIMATED
// (materialized) column, a paint column, or another calc — composition:
// coalesce(AU_domA, AU_domB) over two estimates. Calc→calc references EVALUATE
// in dependency (topo) order into their census slots; cycles yield blank.
// (calcOrder / calcFns live in src/records.js)
// (matColSourceHash / matColLooseId / matColList / storedCols / matColGet /
// matColCodes / matColSet live in src/columns.js)
// (the element-manifest builders — elementGeometry / layerColumnsOps /
// buildElementManifest / dhElementName / peekCollarCols / buildDhSetManifest —
// live in src/manifest.js)
// ── BROADCAST — the first CROSS-LOCATION op on the dh element's relations:
// a collar column lands on an interval member BY THE HOLE-ID KEY, so hole-
// granularity attributes (EOH, COMPANY, campaign dates) become filterable /
// colorable / GT-able interval columns. Numeric → a MATERIALIZED column
// (Parquet sidecar; the ops[] entry records inputs [{loc:'collars', column}]);
// text → a dict paint-style CATEGORY column (persists via the paint channel,
// lineage kept; the manifest records it as DERIVED with the same op — it is
// re-derivable from the collar file the element already names). Typed string
// sidecars are the recorded follow-up that would let text broadcasts
// materialize like numbers do.
export async function broadcastCollarCol(L, colName) {
  const dh = L.docs.dhDoc; const h = layerTableHeader(L);
  if (!dh || !h) { $('#meta').textContent = 'broadcast: not a drillhole layer'; return; }
  const im = h.intervalMapping || {};
  if (im.bhid == null) { $('#meta').textContent = 'broadcast: no hole-id column on the intervals'; return; }
  const taken = new Set([...h.columns, ...(L.calcCols || []).map((c) => c.name), ...(L.paintCols || []).map((c) => c.name)].map((x) => String(x).toLowerCase()));
  const outName = taken.has(String(colName).toLowerCase()) ? colName + '_C' : colName;
  if (taken.has(String(outName).toLowerCase())) { $('#meta').textContent = `broadcast: “${outName}” already exists`; return; }
  const text = await dh.blobs.collar.text();               // the collar table is small — parse it whole
  const lines = H.csvRecords(text);
  const cells2 = H.collarCells(lines);
  const names = cells2(lines[0]), low = names.map((x) => x.toLowerCase());
  const ci = low.indexOf(String(colName).toLowerCase());
  if (ci < 0) { $('#meta').textContent = `broadcast: “${colName}” not in the collar file`; return; }
  // the resolved collar mapping first (see collarKeyIndex); name-match only as fallback
  const cm = dh.header.collarMapping || {};
  let ki = (cm.bhid != null && cm.bhid >= 0 && cm.bhid < low.length) ? cm.bhid : low.indexOf(String(h.columns[im.bhid]).toLowerCase());
  if (ki < 0) ki = 0;
  const map = new Map(); let numeric = true, seen = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = cells2(lines[i]); if (c.length <= Math.max(ci, ki)) continue;
    const v = c[ci]; map.set(String(c[ki]).trim(), v);
    if (v !== '' && v != null) { seen++; if (!Number.isFinite(+v)) numeric = false; }
  }
  if (!seen) numeric = false;
  const n = attrRowCountOf(L) || 0;
  $('#meta').textContent = `broadcast: ${colName} → ${n.toLocaleString()} intervals…`;
  const lin = mkLineage('broadcast', { from: 'collars', column: colName, key: names[ki], holes: map.size }, [L.lineage].filter(Boolean));
  if (numeric) {
    const vals = new Float32Array(n); let rec = 0;
    for await (const batch of layerRows(L, null)) { for (const f0 of batch) { if (rec >= n) break; const v = map.get(   /* rows ok: drillhole intervals: every row is a record */String(f0[im.bhid] ?? '').trim()); const x = v === '' || v == null ? NaN : +v; vals[rec] = Number.isFinite(x) ? x : NaN; rec++; } await new Promise((r) => setTimeout(r)); }
    matColSet(L, outName, vals, { lineage: lin });
    try { await persistElement(L); } catch { /* best-effort */ }
  } else {
    const col = H.createPaintCol(L, outName);
    if (!col) return;
    col.lineage = lin;
    const codeOf = new Map(); let rec = 0, full = false;
    for await (const batch of layerRows(L, null)) {   /* rows ok: drillhole intervals: every row is a record */
      for (const f0 of batch) {
        if (rec >= n || full) break;
        const v = String(map.get(String(f0[im.bhid] ?? '').trim()) ?? '').trim();
        if (v) {
          let code = codeOf.get(v);
          if (code == null) { code = H.addPaintValue(L, col, v); if (code == null) { full = true; break; } codeOf.set(v, code); }
          col.codes[rec] = code;
        }
        rec++;
      }
      if (full) break;
      await new Promise((r) => setTimeout(r));
    }
    paintRecount(col);
    L._colStats = null; L._calcFns = null;
  }
  H.setLayerColorSel(L, 'paint:' + outName);
  H.markProjectDirty(); renderProps(); H.requestRender();
  $('#meta').textContent = `broadcast: ${outName} on ${L.label || L.name} — the filter, color ramps, GT/swath, and exports all see it`;
}

// a v1 drillhole element manifest → the loader's descriptor shape (the bridge
// that lets element.json REPLACE .holes.json; returns null for anything else)
// (descFromElement / buildGridElementManifest / elementHydrate live in src/manifest.js)
// (matColEncode / matColDecodeStr / matColDecode live in src/columns.js)
// (persistElement lives in src/element-store.js)
// (loadElement lives in src/element-store.js)
// (matColDelete lives in src/element-store.js)
// freeze a computed calc column into a stored materialized column (same name):
// evaluate its expression across every record → matColSet, drop the calc col. Bakes
// an expensive expression, or keeps a derived column without carrying its inputs.
// FAST PATH: when every BASE column in the target's dependency cone is PINNED
// (a prior complete filter scan teed it), realize via compileChunk over 256K
// typed windows — the tier-3 filter engine (~100× the row path, no file read).
// Materialized/paint inputs come from RAM inside censusChunkCols; ƒ inputs
// realize chunk-wise in dependency order. Any unpinned base dep → null (the
// row path takes over, and the next complete filter scan may pin it).
export function realizeCalcPinned(L, name) {
  const h = layerTableHeader(L); if (!h) return null;
  if (!(L.calcCols || []).some((c) => c.name === name)) return null;
  let ast; try { ast = parse(quoteIdent(name)); } catch { return null; }
  const needL = expandedDeps(L, ast); needL.add(String(name).toLowerCase());
  const baseLow = new Map(h.columns.map((c, i) => [String(c).toLowerCase(), c]));
  const pcsLow = new Set((L.paintCols || []).map((c) => String(c.name).toLowerCase()));
  const ccsLow = new Set((L.calcCols || []).map((c) => String(c.name).toLowerCase()));
  const baseNames = [];
  for (const k of needL) {
    if (ccsLow.has(k) || pcsLow.has(k)) continue;          // resolved from RAM by censusChunkCols
    const bn = baseLow.get(k); if (!bn) continue;          // unknown name → blank, same as everywhere
    if (!pinGet(L, bn)) return null;
    baseNames.push(bn);
  }
  const censusSchema = schemaExt(L, h);
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  let chunkFns;
  try {
    chunkFns = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase()))
      .map((it) => ({ slot: baseLen + paintLen + it.idx, fn: compileChunk(it.c.expr, censusSchema, { decimal: '.' }) }));
  } catch { return null; }
  const target = (L.calcCols || []).findIndex((c) => c.name === name);
  const total = attrRowCountOf(L) || 0; if (!total) return null;
  const vals = new Float32Array(total); const scr = {};
  for (let at = 0; at < total; at += (1 << 18)) {
    const n = Math.min(1 << 18, total - at);
    const byName = {};
    baseNames.forEach((bn, ci) => { byName[bn] = pinWindow(pinGet(L, bn), at, n, scr[ci] || (scr[ci] = [])); });
    const ccols = censusChunkCols(L, h, byName, at, n, needL, chunkFns);
    const col = ccols[baseLen + paintLen + target];
    if (!col) return null;
    for (let i = 0; i < n; i++) { const v = numOf(col[i]); vals[at + i] = Number.isFinite(v) ? v : NaN; }
  }
  return vals;
}

export async function realizeCalc(L, name) {                      // one pass → per-record Float32 values of ƒ `name`
  const h = layerTableHeader(L); if (!h) throw new Error('no column table');
  const fast = realizeCalcPinned(L, name);
  if (fast) return fast;
  try { await ensureStoredValues(L, expandedDeps(L, parse(quoteIdent(name)))); } catch { /* unknown deps → blanks */ }
  const fn = compileValue(quoteIdent(name), schemaExt(L, h), { decimal: '.' });   // a NAME as an expression → quote
  const n = attrRowCountOf(L) || 0; const vals = new Float32Array(n); let rec = 0;
  // numbered as the renderer numbers (layerRecords): a CSV row with no usable
  // coordinates is no record, so counting it shifted every later value one block on
  for await (const { f } of layerRecords(L, null)) {
    if (rec >= n) break;
    let v; try { v = numOf(fn(f)); } catch { v = NaN; }
    vals[rec] = Number.isFinite(v) ? v : NaN; rec++;
    if ((rec & 0xFFFF) === 0) await new Promise((r) => setTimeout(r));
  }
  for (let i = rec; i < n; i++) vals[i] = NaN;              // past the last record: blank, never 0
  return vals;
}

export async function materializeCalcCol(L, name) {
  const cc = (L.calcCols || []).find((c) => c.name === name); if (!cc) { $('#meta').textContent = `materialize: no calc column “${name}”`; return; }
  if (!layerTableHeader(L)) return;
  $('#meta').textContent = `materializing “${name}”…`;
  const vals = await realizeCalc(L, name);
  const rec = vals.length;
  const wasColor = colorSelOf(L) === 'calc:' + name;
  L.calcCols = (L.calcCols || []).filter((c) => c.name !== name); L._calcFns = null;   // computed → stored (no schema collision)
  L._calcDisplay = null;                                    // the ephemeral realization is superseded by the stored column
  matColSet(L, name, vals, { lineage: mkLineage('materialize', { from: 'calc', expr: cc.expr }, [L.lineage].filter(Boolean)) });
  if (wasColor) H.setLayerColorSel(L, 'paint:' + name);
  try { await persistElement(L); } catch { /* best-effort */ }
  H.markProjectDirty(); H.renderLayers(); H.requestRender();
  $('#meta').textContent = `materialized “${name}” — ${rec.toLocaleString()} values stored`;
}

// (extendRow / schemaExt live in src/records.js)
// (censusChunkCols lives in src/columns.js)
// an expression's dependency cone, calc-EXPANDED (lowercased names)
// (expandedDeps lives in src/columns.js)
// (the PIN CACHE — pinBudgetBytes/setPinBudget/pinStats/pinTrim/pinPutMatcol/
// pinTouchMatcol — lives in src/columns.js; readSidecarCol below is the injected
// sidecar reader, see setSidecarReader at boot)
// (readSidecarCol lives in src/element-store.js — registered as columns.js's sidecar reader there)
// (ensureStoredValues lives in src/columns.js)
// (pinPut / pinGet / pinEvictLayer / pinWindow live in src/columns.js)
// the shared TIER-3 sweep: evaluate the filter over PINNED columns in 256K
// windows (no file read). Returns hits, or -1 if superseded (caller returns).
// (pinnedSweep lives in src/columns.js — the app injects chunkF + the o callbacks)
// (sampleRow lives in src/records.js)
export function colRole(h, i) {
  const m = h.mapping || {}, im = h.intervalMapping || {};
  if (i === m.x) return 'X'; if (i === m.y) return 'Y'; if (i === m.z) return 'Z';
  if (i === im.bhid) return 'hole id'; if (i === im.from) return 'FROM'; if (i === im.to) return 'TO';
  if (i === m.chan) return 'color'; if (i === m.cat) return 'category';
  return null;
}

// type override = a MUTATION of the layer's derived schema, so every consumer
// (filter schema, color-by options) agrees without new plumbing
export function setColType(L, i, ty) {
  const h = layerTableHeader(L); if (!h) return;
  const name = h.columns[i];
  L.colTypes = L.colTypes || {};
  L.colTypes[name] = ty;
  const at = (h.numericColumns || (h.numericColumns = [])).findIndex((c) => c.i === i);
  if (ty === 'number' && at < 0) { h.numericColumns.push({ i, name }); h.numericColumns.sort((a, b) => a.i - b.i); }
  if (ty === 'string' && at >= 0) h.numericColumns.splice(at, 1);
  L._colStats = null; L._qualFn = undefined;               // the kind changed — stale
  if (L.id === S.activeId) { const keep = $('#colorBy').value; H.setColorLabels(h); if ([...$('#colorBy').options].some((o) => o.value === keep)) $('#colorBy').value = keep; }
  H.markProjectDirty();
  renderProps();
}

// (applyColTypes lives in src/records.js)
// ── a numeric column's detection-limit policy (CSV / drillholes). Values are
// substituted at the read, so a change invalidates everything derived from a
// read: column stats, pinned columns, the band index, the filter mask — and the
// colour channel, which the open parsed (a re-read, like a channel switch). ──
export const QUALIFY_BELOW = [['half', '<x → x/2 (half the limit)'], ['limit', '<x → x (the limit)'], ['zero', '<x → 0'], ['blank', '<x → blank']];

export function qualifyMenuItems(L, i) {
  const h = layerTableHeader(L), name = h.columns[i], p = qualifyPolicy(L, name);
  return [
    ...QUALIFY_BELOW.map(([k, label]) => ({ label: ((p.below || 'half') === k ? '✓ ' : '') + label, action: () => setColumnQualify(L, i, { ...p, below: k }) })),
    { sep: true },
    { label: (p.above !== 'blank' ? '✓ ' : '') + '>x → x (the limit)', action: () => setColumnQualify(L, i, { ...p, above: 'limit' }) },
    { label: (p.above === 'blank' ? '✓ ' : '') + '>x → blank', action: () => setColumnQualify(L, i, { ...p, above: 'blank' }) },
    { sep: true },
    { label: (p.negBelow ? '✓ ' : '') + 'Negative = below detection (−0.001 → <0.001)', action: () => setColumnQualify(L, i, { ...p, negBelow: !p.negBelow }) },
  ];
}

export async function setColumnQualify(L, i, policy) {
  const h = layerTableHeader(L); if (!h) return null;
  const name = h.columns[i];
  const pol = { below: policy.below || 'half', above: policy.above === 'blank' ? 'blank' : 'limit', negBelow: !!policy.negBelow };
  L.qualify = { ...(L.qualify || {}) };
  if (pol.below === 'half' && pol.above === 'limit' && !pol.negBelow) delete L.qualify[name];   // the default isn't stored
  else L.qualify[name] = pol;
  if (!Object.keys(L.qualify).length) L.qualify = null;
  H.markProjectDirty();
  return refreshQualified(L, h.mapping && h.mapping.chan === i);
}

// drop everything derived from a read; re-read when the colour channel changed
export async function refreshQualified(L, rechan) {
  L._qualFn = undefined; L._colStats = null; L._bands = null;
  pinEvictLayer(L.id);
  const d = L.docs || {};
  if (rechan && d.dhDoc) { L = (await H.reopenDh(L, { qualify: L.qualify || null })) || L; }
  else if (rechan && d.blockDoc && !d.blockDoc.header.dm && !d.blockDoc.parquet) { await H.reopenBlockChan(d.blockDoc, d.blockDoc.header.mapping.chan, { layer: L.id }); await H.refilterLayer(L); applyRamp(L, true); }
  else await H.refilterLayer(L);
  if (L.docs && L.docs.blockDoc) await H.ensureValueTex(L);
  refreshProps();
  H.requestRender();
  return L.id;
}

// project load: a stored policy on the colour channel means the open coloured by
// the default — re-read those layers once they're all in
export const _qualifyReopen = [];

export async function settleQualifyReopens() {
  const ids = _qualifyReopen.splice(0);
  for (const id of ids) {
    const L = layerById(H.followLayer(id)); if (!L) continue;
    const h = layerTableHeader(L), ch = h && h.mapping ? h.mapping.chan : null;
    const chName = ch != null ? h.columns[ch] : null;
    await refreshQualified(L, !!(chName && L.qualify && L.qualify[chName]));
  }
}

// (layerRows lives in src/records.js)
// opts.bands: also collect per-64k-record-band min/max for every BASE numeric
// column into L._bands — the .dm/CSV pushdown substrate (parquet's footer
// stats, retrofitted). Same single pass; band numbering = RAW record order.
// (scanColumns lives in src/columns.js)
export function sparkline(centroids, total, min, max) {
  const c = document.createElement('canvas'); c.width = 120; c.height = 18; c.className = 'pp-spark';
  const g = c.getContext('2d');
  const N = 24, bins = histogramFromCentroids(centroids, total, min, max > min ? max : min + 1, N);
  let peak = 0; for (let b = 0; b < N; b++) if (bins[b] > peak) peak = bins[b];
  g.fillStyle = '#c89b3c';
  for (let b = 0; b < N; b++) { const hp = peak ? Math.round((16 * bins[b]) / peak) : 0; if (hp) g.fillRect(b * 5, 17 - hp, 4, hp); }
  return c;
}

export function renderColumnsTab(body, L) {
  const h = layerTableHeader(L);
  if (!h) {
    body.appendChild(ppNote(L.kind === 'mesh' ? 'meshes carry no table — columns arrive with mesh records (OBJ groups)' : 'no column table in this layer (LAS/PLY attributes arrive later)'));
    return;
  }
  const scan = document.createElement('button'); scan.className = 'pp-scan';
  scan.textContent = colStatsComplete(L) ? 'rescan columns' : 'scan columns — one pass, every column';
  wireScanButton(scan, L, null);
  body.appendChild(scan);
  const footer = colStatsComplete(L) ? null : footerColStats(L);
  const calcB = document.createElement('button'); calcB.className = 'pp-scan';
  calcB.textContent = (L.calcCols || []).length ? `ƒ calculations… (${L.calcCols.length})` : 'ƒ add calculated column…';
  calcB.onclick = () => H.openCalcWindow(L, (L.calcCols || []).length ? 0 : -1);
  body.appendChild(calcB);
  for (let i = 0; i < h.columns.length; i++) {
    const name = h.columns[i];
    const row = document.createElement('div'); row.className = 'pp-col';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name; nm.title = name;
    const ty = document.createElement('span'); ty.className = 'ty'; ty.textContent = colIsNumeric(L, h, i) ? 'number' : 'text';
    row.append(nm, ty);
    const qc = (h.qualifiedColumns || []).find((c) => c.i === i);
    if (qc && colIsNumeric(L, h, i)) {                     // the column reads numeric BECAUSE <x / >x / codes were substituted — say so
      const b3 = document.createElement('span'); b3.className = 'pp-badge'; b3.textContent = '<DL';
      b3.title = `qualified values in the sample: ${qc.below} below detection · ${qc.above} above · ${qc.code} lab codes\nread as ${describeQualified(qualifyPolicy(L, name))} (codes → blank) — right-click to change`;
      row.appendChild(b3);
    }
    const role = colRole(h, i);
    if (role) { const b2 = document.createElement('span'); b2.className = 'pp-badge'; b2.textContent = role; row.appendChild(b2); }
    const openMenu = (x, y) => {
      const isNum = colIsNumeric(L, h, i);
      const m = h.mapping || {};
      const spatial = i === m.x || i === m.y || i === m.z;
      H.menuXY(x, y, [
        { label: (isNum ? '✓ ' : '') + 'Number', action: () => { if (!isNum && !spatial) setColType(L, i, 'number'); } },
        { label: (!isNum ? '✓ ' : '') + 'Text', action: () => { if (isNum && !spatial) setColType(L, i, 'string'); } },
        ...(isNum && !spatial && rowQualifier(L) ? [{ label: 'Below / above detection', submenu: () => qualifyMenuItems(L, i) }] : []),
        ...(spatial ? [] : [
          { sep: true },
          ...(isNum && L.docs.blockDoc ? [{ label: 'Use as color channel', action: () => { const v = `chan:${i}`; if ([...$('#colorBy').options].some((o) => o.value === v)) { $('#colorBy').value = v; $('#colorBy').dispatchEvent(new Event('change')); } } }] : []),
          ...(L.docs.blockDoc && i !== m.cat ? [{ label: 'Use as category', action: () => useAsCategory(L, i) }] : []),
          ...(L.dh && L.docs.dhDoc && i !== m.cat ? [{ label: 'Use as category', action: () => useAsCategory(L, i) }] : []),
        ]),
      ]);
    };
    const onCtx = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); };
    row.oncontextmenu = onCtx;
    const kb = document.createElement('span'); kb.className = 'pp-kebab'; kb.textContent = '⋮'; kb.title = 'column actions';
    kb.onclick = (e) => { e.stopPropagation(); const r2 = kb.getBoundingClientRect(); openMenu(r2.left - 60, r2.bottom + 2); };
    row.appendChild(kb);
    body.appendChild(row);
    H.appendColStats(body, (L._colStats && L._colStats[name]) || (footer && footer[name]), onCtx);
  }
  // ── ƒ calculated columns (§10.1): row-extensions the filter/scan/record all see ──
  const calc = L.calcCols || [];
  calc.forEach((c, k) => {
    const row = document.createElement('div'); row.className = 'pp-col';
    const fx = document.createElement('span'); fx.className = 'pp-badge'; fx.textContent = 'ƒ';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name; nm.title = c.expr;
    const ty = document.createElement('span'); ty.className = 'ty'; ty.textContent = c.ty === 'string' ? 'text' : 'number';
    row.append(fx, nm, ty);
    const openMenu = (x, y) => H.menuXY(x, y, [
      { label: 'Edit…', action: () => H.openCalcWindow(L, k) },
      { label: 'Remove', action: () => { const gone = L.calcCols[k]; pushUndo(`remove ƒ ${gone.name}`, () => { L.calcCols.splice(Math.min(k, L.calcCols.length), 0, gone); L._calcFns = null; L._colStats = null; H.markProjectDirty(); refreshProps(); }, { redo: () => { const j = L.calcCols.indexOf(gone); if (j >= 0) { L.calcCols.splice(j, 1); L._calcFns = null; L._colStats = null; H.markProjectDirty(); refreshProps(); } } }); L.calcCols.splice(k, 1); L._calcFns = null; L._colStats = null; H.markProjectDirty(); renderProps(); } },
    ]);
    const onCtx = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); };
    row.oncontextmenu = onCtx;
    const kb = document.createElement('span'); kb.className = 'pp-kebab'; kb.textContent = '⋮'; kb.title = 'column actions';
    kb.onclick = (e) => { e.stopPropagation(); const r2 = kb.getBoundingClientRect(); openMenu(r2.left - 60, r2.bottom + 2); };
    row.appendChild(kb);
    body.appendChild(row);
    H.appendColStats(body, L._colStats && L._colStats[c.name], onCtx);
  });
  body.appendChild(ppNote('right-click a column: type (number/text — drives the filter and color-by) · use as category / color channel · ƒ columns work in the filter, the scan, and the record panel'));
}

// a scan button: click scans (`columns` = the names, null = every column), a
// second click while it runs cancels; the panel re-renders when the scan lands
export function wireScanButton(btn, L, columns) {
  let ac = null;
  btn.onclick = async () => {
    if (ac) { ac.abort(); return; }
    ac = new AbortController();
    try {
      await scanColumns(L, (a, b2) => { btn.textContent = `scanning… ${b2 ? Math.min(100, Math.round((100 * a) / b2)) : a.toLocaleString()}% — click to cancel`; }, { columns, signal: ac.signal });
      renderProps();
    } catch (e) {
      btn.textContent = e.name === 'AbortError' ? 'scan cancelled — click to scan again' : `scan failed — ${e.message}`;
    } finally { ac = null; }
  };
}

// re-key the class column: the same re-open machinery as re-channeling
export async function useAsCategory(L, i) {
  if (L.dh && L.docs.dhDoc) return H.reopenDh(L, { cat: i }, { clearCats: true });
  return H.reopenWithMapping(L, { cat: i }, { clearCats: true });
}

// ── per-layer color ramps (§10 breakpoints): presets + value BREAKPOINTS,
// baked into a 256-px LUT the shaders already sample — zero shader changes.
// classed = solid color per interval (the grade-shell legend); unclassed
// breaks = a stretched continuous ramp. Config lives PER COLOR SELECTION
// (L.ramps[colorSel]) so FE and AU each remember their own legend. ──
export const RAMP_PRESETS = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  spectral: [[43, 131, 186], [171, 221, 164], [255, 255, 191], [253, 174, 97], [215, 25, 28]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  turbo: [[48, 18, 59], [62, 156, 254], [34, 236, 161], [218, 226, 25], [122, 4, 3]],
  greys: [[24, 24, 24], [235, 235, 235]],
  // ColorBrewer RdBu (7, reversed: low blue → high red). White sits exactly at
  // the middle, so a range symmetric about 0 centres a difference on zero
  rdbu: [[33, 102, 172], [103, 169, 207], [209, 229, 240], [247, 247, 247], [253, 219, 199], [239, 138, 98], [178, 24, 43]],
};

// what each palette is for, as the host API lists them (palettes())
export const RAMP_KIND = { viridis: 'sequential', magma: 'sequential', turbo: 'sequential', greys: 'sequential', spectral: 'diverging', rdbu: 'diverging' };

export function rampSample(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, x | 0), f = x - k;
  return [0, 1, 2].map((c) => Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f));
}

export function bakeRampPixels(cfg, lo, hi) {
  const px = new Uint8Array(256 * 4);
  const stops = RAMP_PRESETS[cfg.preset] || RAMP_PRESETS.viridis;
  const span = hi > lo ? hi - lo : 1;
  const breaks = (cfg.breaks || []).filter((v) => Number.isFinite(v) && v > lo && v < hi).sort((a, b) => a - b);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let c;
    if (cfg.classed && breaks.length) {
      const v = lo + t * span;
      let k = 0; while (k < breaks.length && v >= breaks[k]) k++;
      const ov = cfg.colors && cfg.colors[k];
      if (ov) { const n2 = parseInt(ov.slice(1), 16); c = [(n2 >> 16) & 255, (n2 >> 8) & 255, n2 & 255]; }
      else c = rampSample(stops, (k + 0.5) / (breaks.length + 1));
    } else if (breaks.length) {
      const v = lo + t * span;
      const edges = [lo, ...breaks, hi];
      let k = 0; while (k < edges.length - 2 && v >= edges[k + 1]) k++;
      const f = (v - edges[k]) / Math.max(edges[k + 1] - edges[k], 1e-9);
      c = rampSample(stops, (k + Math.min(1, Math.max(0, f))) / (edges.length - 1));
    } else {
      c = rampSample(stops, t);
    }
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return px;
}

export const colorSelOf = (L) => (L.id === S.activeId ? $('#colorBy').value : (L.colorSel || 'elev'));

export function rampCfgOf(L, create = false) {
  const sel = colorSelOf(L);
  if (!L.ramps) { if (!create) return null; L.ramps = {}; }
  if (!L.ramps[sel]) { if (!create) return null; L.ramps[sel] = { preset: 'viridis', classed: false, breaks: [] }; }
  return L.ramps[sel];
}

// the value range the SHADER maps to t — mirrors the clip-aware ranges
export function rampRangeFor(L) {
  const sel = colorSelOf(L);
  const clip = [parseFloat(L.clip[0]), parseFloat(L.clip[1])];
  if (String(sel).startsWith('chan:')) {
    const cr = H.renderer.layerChanRange(L.id) || [0, 1];
    return [Number.isFinite(clip[0]) ? clip[0] : cr[0], Number.isFinite(clip[1]) ? clip[1] : cr[1]];
  }
  if (String(sel).startsWith('paint:')) {                  // ratio channels: absolute 0..1, or a materialized column's real [min,max]
    const pc = (L.paintCols || []).find((c) => c.name === String(sel).slice(6));
    const lo0 = pc && pc.mat ? pc.min : 0, hi0 = pc && pc.mat ? pc.max : 1;
    return [Number.isFinite(clip[0]) ? clip[0] : lo0, Number.isFinite(clip[1]) ? clip[1] : hi0];
  }
  if (String(sel).startsWith('calc:')) {                   // ƒ display realization: real [min,max]
    const cd = calcDisplayCol(L);
    return [Number.isFinite(clip[0]) ? clip[0] : (cd ? cd.min : 0), Number.isFinite(clip[1]) ? clip[1] : (cd ? cd.max : 1)];
  }
  const b = H._docBbox || [0, 0, 0, 1, 1, 1];
  const o = H.frame ? H.frame.origin[2] : 0;
  return [Number.isFinite(clip[0]) ? clip[0] : b[2] + o, Number.isFinite(clip[1]) ? clip[1] : b[5] + o];
}

export function applyRamp(L, force) {
  if (!force) return stageGate(L, () => applyRamp(L, true));
  if (L.docs && L.docs.blockDoc) H.ensureValueTex(L).catch((e) => { $('#meta').textContent = `colour — ${e.message}`; });
  const pcR = paintActiveCol(L) || calcDisplayCol(L);
  if (!pcR && calcSelOf(L)) ensureCalcDisplay(L);          // realize lazily; it re-applies on completion
  if (pcR && pcR.kind === 'ratio') { applyPaintPalette(L, pcR); return; }   // ramp+clip bake INTO the palette
  const cfg = rampCfgOf(L);
  if (!cfg || (cfg.preset === 'viridis' && !(cfg.breaks && cfg.breaks.length))) {
    H.renderer.setLayerRamp(L.id, null);
  } else {
    const [lo, hi] = rampRangeFor(L);
    H.renderer.setLayerRamp(L.id, bakeRampPixels(cfg, lo, hi));
  }
  H.requestRender();
}

export let _rampRepaint = null;

export function setRampCfg(L, patch) {
  const cfg = rampCfgOf(L, true);
  Object.assign(cfg, patch);
  applyRamp(L);
  if (_rampRepaint) {                                      // keep the strip + histogram + table honest without a DOM rebuild
    if (_rampRepaint.prev) _rampRepaint.prev();
    if (_rampRepaint.hist) _rampRepaint.hist();
    if (_rampRepaint.bands) _rampRepaint.bands();
    if (_rampRepaint.breaksIn) _rampRepaint.breaksIn();
  }
  H.markProjectDirty();
}

// ── the source tab: where the layer's positions come from + what it spans.
// Per kind: delimited get LIVE X/Y/Z mapping selects (re-reads the file, like
// ── join tab (§ join-spec): the active layer is the LEFT. Spatial mode
// resamples a compatible right model onto a target grid; key mode hash-joins by
// a key column. Both emit a NEW layer. Reconcile is a spatial preset (Δ column).
export let _joinForm = null;

export const joinTableLayers = (L) => S.layers.filter((x) => x.id !== L.id && layerTableHeader(x));

export const joinBlockLayers = (L) => S.layers.filter((x) => x.id !== L.id && gridAxesOf(x));

export function renderJoinTab(body, L) {
  if (!layerTableHeader(L)) { body.appendChild(ppNote('join needs a table-backed layer')); return; }
  if (!_joinForm) _joinForm = { mode: gridAxesOf(L) ? 'spatial' : 'key', rightId: null, target: 'left', cols: [], ops: {}, weights: {}, keyL: '', keyR: '', bring: new Set(), dup: 'first' };
  const jf = _joinForm;
  const seg = document.createElement('div'); seg.className = 'pp-seg';
  for (const md of ['spatial', 'key']) {
    const bt = document.createElement('button'); bt.className = 'pp-segbtn' + (jf.mode === md ? ' on' : '');
    bt.textContent = md === 'spatial' ? 'Spatial' : 'By key';
    if (md === 'spatial' && !gridAxesOf(L)) bt.disabled = true;
    bt.onclick = () => { jf.mode = md; renderProps(); };
    seg.appendChild(bt);
  }
  body.appendChild(mkRow('mode', seg));
  const rights = jf.mode === 'spatial' ? joinBlockLayers(L) : joinTableLayers(L);
  if (!rights.length) { body.appendChild(ppNote(jf.mode === 'spatial' ? 'open another block model to join against' : 'open another table layer to join against')); return; }
  const rSel = document.createElement('select');
  { const o = document.createElement('option'); o.value = ''; o.textContent = '— pick a layer —'; rSel.appendChild(o); }
  for (const r of rights) { const o = document.createElement('option'); o.value = String(r.id); o.textContent = r.label || r.name; rSel.appendChild(o); }
  rSel.value = jf.rightId != null && rights.some((r) => r.id === jf.rightId) ? String(jf.rightId) : '';
  rSel.onchange = () => { jf.rightId = rSel.value ? +rSel.value : null; jf.cols = []; jf.bring = new Set(); jf.keyL = ''; jf.keyR = ''; renderProps(); };
  body.appendChild(mkRow('right', rSel));
  const R = jf.rightId != null ? layerById(jf.rightId) : null;
  if (!R) return;
  if (jf.mode === 'spatial') renderSpatialJoinUI(body, L, R, jf); else renderKeyJoinUI(body, L, R, jf);
}

export function renderSpatialJoinUI(body, L, R, jf) {
  const c = gridsCompatible(gridAxesOf(L), gridAxesOf(R));
  const ban = document.createElement('div');
  if (c.ok) { ban.className = 'pp-banner ok'; ban.textContent = c.nested ? `compatible — clean replicate / aggregate` : `compatible — common lattice (mixed weights)`; }
  else { ban.className = 'pp-banner bad'; ban.textContent = `incompatible — ${c.reason}`; }
  body.appendChild(ban);
  if (!c.ok) return;
  // target grid
  const tSel = document.createElement('select');
  for (const [v, lab] of [['left', `${shortName(L)} (this)`], ['right', shortName(R)], ['finest', 'common — finest'], ['coarsest', 'common — coarsest']]) { const o = document.createElement('option'); o.value = v; o.textContent = lab; tSel.appendChild(o); }
  tSel.value = jf.target; tSel.onchange = () => { jf.target = tSel.value; renderProps(); };
  body.appendChild(mkRow('target grid', tSel));
  // per-source column pickers
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const addSourceCols = (side, srcL, h) => {
    const head = document.createElement('div'); head.className = 'pp-jhead'; head.textContent = `${side === 'left' ? shortName(L) : shortName(R)} columns`; body.appendChild(head);
    const m = h.mapping || {};
    for (let i = 0; i < h.columns.length; i++) {
      if (i === m.x || i === m.y || i === m.z) continue;      // coords define the grid, not joined
      const name = h.columns[i], num = colIsNumeric(srcL, h, i), key = side + ':' + name;
      const row = document.createElement('div'); row.className = 'pp-jcol';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = jf.cols.includes(key);
      cb.onchange = () => { if (cb.checked) jf.cols.push(key); else jf.cols = jf.cols.filter((k) => k !== key); renderProps(); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name; nm.title = name + (num ? ' · number' : ' · text');
      row.append(cb, nm);
      if (jf.cols.includes(key)) {
        if (num) {
          const opSel = document.createElement('select'); for (const op of ['mean', 'sum', 'count']) { const o = document.createElement('option'); o.value = op; o.textContent = op; opSel.appendChild(o); } opSel.value = jf.ops[key] || 'mean'; opSel.onchange = () => { jf.ops[key] = opSel.value; }; row.appendChild(opSel);
          const wSel = document.createElement('select'); { const o = document.createElement('option'); o.value = ''; o.textContent = 'unweighted'; wSel.appendChild(o); }
          for (let w = 0; w < h.columns.length; w++) if (colIsNumeric(srcL, h, w) && w !== i && w !== m.x && w !== m.y && w !== m.z) { const o = document.createElement('option'); o.value = h.columns[w]; o.textContent = '× ' + h.columns[w]; wSel.appendChild(o); }
          wSel.value = jf.weights[key] || ''; wSel.onchange = () => { jf.weights[key] = wSel.value; }; row.appendChild(wSel);
        } else { const t = document.createElement('span'); t.style.cssText = 'font-size:11px;color:var(--dim)'; t.textContent = 'majority'; row.appendChild(t); }
      }
      body.appendChild(row);
    }
  };
  addSourceCols('left', L, lh); addSourceCols('right', R, rh);
  // scope: honor each side's 3D selection (rubber-band a zone → join/reconcile just it)
  const anySel = (L._selMask && L._selCount) || (R && R._selMask && R._selCount);
  const selLab = document.createElement('label'); selLab.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--muted);cursor:pointer';
  const selCb = document.createElement('input'); selCb.type = 'checkbox';
  selCb.checked = !!jf.useSel && !!anySel; selCb.disabled = !anySel;
  selCb.onchange = () => { jf.useSel = selCb.checked; };
  selLab.append(selCb, anySel ? 'only the 3D selection (each side uses its own, where present)' : 'only the 3D selection — select something first (r / v)');
  if (!anySel) jf.useSel = false;
  body.appendChild(selLab);
  // run + reconcile
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:6px;margin-top:10px';
  const rightPicked = jf.cols.some((k) => k.startsWith('right:'));
  const runC = document.createElement('button'); runC.className = 'pp-scan'; runC.style.flex = '1'; runC.textContent = 'Join → columns here';
  runC.disabled = !(jf.target === 'left' && rightPicked);
  runC.title = jf.target === 'left' ? `resample ${shortName(R)}'s picked columns onto this model's own cells — real columns, no new layer` : 'columns land here only when the target grid is THIS model (other targets change the record set → a new layer)';
  runC.onclick = async () => { try { const outs = await spatialJoinToCols(L, R, jf); $('#meta').textContent = `join: ${outs.join(', ')} on ${L.label || L.name} — filter, color, GT and export all see ${outs.length > 1 ? 'them' : 'it'}`; } catch (e) { $('#meta').textContent = `join: ${e.message}`; } };
  btns.appendChild(runC);
  const run = document.createElement('button'); run.className = 'pp-scan'; run.textContent = `→ new layer`;
  run.disabled = !jf.cols.length;
  run.title = 'a new block-model layer on the target grid';
  run.onclick = () => H.runSpatialJoinUI(L, R, jf);
  btns.appendChild(run);
  // reconcile enabled when a numeric column exists in BOTH
  const shared = lh.columns.filter((n) => colIsNumeric(L, lh, lh.columns.indexOf(n)) && rh.columns.includes(n) && colIsNumeric(R, rh, rh.columns.indexOf(n)) && ![lh.mapping.x, lh.mapping.y, lh.mapping.z].includes(lh.columns.indexOf(n)));
  const rec = document.createElement('button'); rec.className = 'pp-scan'; rec.textContent = 'Reconcile…'; rec.disabled = !shared.length;
  rec.title = shared.length ? `Δ on ${shared.join(', ')}` : 'needs a numeric column present in both models';
  rec.onclick = () => H.openReconcileMenu(L, R, jf, shared, rec);
  btns.appendChild(rec);
  body.appendChild(btns);
  body.appendChild(ppNote('a new block-model layer on the target grid, carrying the chosen columns as real (filter/colour/export-able) columns'));
}

export function renderKeyJoinUI(body, L, R, jf) {
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const colSel = (cols, val, on) => { const s = document.createElement('select'); { const o = document.createElement('option'); o.value = ''; o.textContent = '— key —'; s.appendChild(o); } for (const n of cols) { const o = document.createElement('option'); o.value = n; o.textContent = n; s.appendChild(o); } s.value = val || ''; s.onchange = () => on(s.value); return s; };
  body.appendChild(mkRow('left key', colSel(lh.columns, jf.keyL, (v) => { jf.keyL = v; })));
  body.appendChild(mkRow('right key', colSel(rh.columns, jf.keyR, (v) => { jf.keyR = v; })));
  const head = document.createElement('div'); head.className = 'pp-jhead'; head.textContent = 'bring columns'; body.appendChild(head);
  for (const n of rh.columns) {
    if (n === jf.keyR) continue;
    const row = document.createElement('div'); row.className = 'pp-jcol';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = jf.bring.has(n);
    cb.onchange = () => { if (cb.checked) jf.bring.add(n); else jf.bring.delete(n); };
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n;
    row.append(cb, nm); body.appendChild(row);
  }
  const dupSel = document.createElement('select'); for (const [v, lab] of [['first', 'first match'], ['aggregate', 'average dups'], ['error', 'error on dups']]) { const o = document.createElement('option'); o.value = v; o.textContent = lab; dupSel.appendChild(o); } dupSel.value = jf.dup; dupSel.onchange = () => { jf.dup = dupSel.value; };
  body.appendChild(mkRow('duplicate keys', dupSel));
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const runC = document.createElement('button'); runC.className = 'pp-scan'; runC.style.flex = '1'; runC.textContent = 'Join → columns here';
  runC.disabled = !(jf.keyL && jf.keyR && jf.bring.size);
  runC.title = 'the brought columns land ON this layer (rows unchanged — a key join never needs a new layer)';
  runC.onclick = async () => {
    try {
      const { outs, matched, rows } = await keyJoinToCols(L, R, { leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup });
      $('#meta').textContent = `key join: ${matched.toLocaleString()} of ${rows.toLocaleString()} rows matched — ${outs.join(', ')} on ${L.label || L.name}`;
    } catch (e) { $('#meta').textContent = `key join: ${e.message}`; }
  };
  btns.appendChild(runC);
  const run = document.createElement('button'); run.className = 'pp-scan'; run.textContent = '→ new layer';
  run.disabled = !(jf.keyL && jf.keyR && jf.bring.size);
  run.title = 'export-shaped: a new layer/file of this layer’s rows + the brought columns';
  run.onclick = async () => {
    try {
      const { blob, rows, matched } = await runKeyJoin({ leftL: L, rightL: R, leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup, prefix: shortName(R).replace(/\W+/g, '_') + '_', label: 'join' });
      const name = `${shortName(L)}+${shortName(R)}.csv`;
      const lin = mkLineage('keyjoin', { leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup }, [L.lineage, R.lineage]);
      await H.openBlob(blob, name, 'add', null, { lineage: lin });
      $('#meta').textContent = `key join: ${matched.toLocaleString()} of ${rows.toLocaleString()} rows matched → ${name}`;
    } catch (e) { $('#meta').textContent = `key join: ${e.message}`; }
  };
  btns.appendChild(run);
  body.appendChild(btns);
  body.appendChild(ppNote('columns land HERE by default (matched by key; unmatched → blank) — “new layer” writes a joined copy instead'));
}

export function renderSourceTab(body, L) {
  const d = L.docs || {};
  const h = layerHeaderOf(L);
  if (!h) { body.appendChild(ppNote('no source metadata for this layer')); return; }
  const escS = (v) => (v == null ? '—' : String(v));      // text: html`…` escapes it
  const fm = (v) => (v == null || !Number.isFinite(v) ? '–' : Number.isInteger(v) ? v.toLocaleString() : +v.toFixed(3) + '');
  const sec = (t) => { const el = document.createElement('div'); el.className = 'pp-sec'; el.textContent = t; body.appendChild(el); };
  const line = (h2) => { const el = document.createElement('div'); el.className = 'pp-stats'; el.style.marginLeft = '0'; setHTML(el, h2); body.appendChild(el); };
  if (d.blockDoc && !d.blockDoc.header.dm) {
    sec('position — column mapping');
    const row = document.createElement('div'); row.className = 'pp-row';
    for (const key of ['x', 'y', 'z']) {
      const wrap = document.createElement('label'); wrap.textContent = key.toUpperCase() + ' '; wrap.style.minWidth = '0';
      const sel = document.createElement('select'); sel.style.maxWidth = '64px';
      h.columns.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; sel.appendChild(o); });
      sel.value = String(h.mapping[key]);
      sel.onchange = () => H.reopenWithMapping(L, { [key]: +sel.value });
      wrap.appendChild(sel);
      row.appendChild(wrap);
    }
    body.appendChild(row);
    line(trusted('<span class="fi-x">changing a mapping re-reads the file</span>'));
  } else if (d.blockDoc && d.blockDoc.header.dm) {
    sec('position');
    line(html`Datamine .dm — centroids from <span class="v">XC / YC / ZC</span>, grid from the DD constants`);
  } else if (d.dhDoc) {
    const dh = d.dhDoc;
    sec('tables');
    const bn = (b2) => escS(b2 && b2.name);
    line(html`collar <span class="v">${bn(dh.blobs.collar)}</span> · <span class="v">${h.holes}</span> holes`);
    line(html`survey <span class="v">${bn(dh.blobs.survey)}</span>`);
    line(html`intervals <span class="v">${bn(dh.blobs.intervals)}</span> · <span class="v">${h.placed.toLocaleString()}</span> of <span class="v">${h.count.toLocaleString()}</span> placed`);
    for (const c of h.report.checks) line(html`⚠ ${escS(c.label)} · <span class="v">${c.count}</span>${c.bhids && c.bhids.length ? html` <span class="fi-x">(${escS(c.bhids.slice(0, 4).join(', '))}${c.bhids.length > 4 ? '…' : ''})</span>` : ''}`);
    // collar + survey geometry mapping — re-map a column and re-desurvey.
    // (The interval table's grade/category columns live in the columns tab.)
    const mapSec = (title, cols, mapping, role, fields) => {
      if (!cols || !cols.length) return;
      sec(title);
      const row = document.createElement('div'); row.className = 'pp-row'; row.style.flexWrap = 'wrap';
      for (const [key, label, optional] of fields) {
        const wrap = document.createElement('label'); wrap.textContent = label + ' '; wrap.style.minWidth = '0';
        const selE = document.createElement('select'); selE.style.maxWidth = '84px';
        if (optional) { const o = document.createElement('option'); o.value = '-1'; o.textContent = '—'; selE.appendChild(o); }
        cols.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; selE.appendChild(o); });
        selE.value = String(mapping && mapping[key] != null ? mapping[key] : (optional ? -1 : 0));
        selE.onchange = () => {
          const full = { collar: { ...h.collarMapping }, survey: { ...h.surveyMapping }, intervals: { ...h.intervalMapping } };
          full[role][key] = +selE.value;
          H.reopenDh(L, { mappings: full });
        };
        wrap.appendChild(selE); row.appendChild(wrap);
      }
      body.appendChild(row);
    };
    mapSec('collar — column mapping', h.collarColumns, h.collarMapping, 'collar', [['bhid', 'hole id', false], ['x', 'X', false], ['y', 'Y', false], ['z', 'Z', false], ['eoh', 'EOH', true]]);
    mapSec('survey — column mapping', h.surveyColumns, h.surveyMapping, 'survey', [['bhid', 'hole id', false], ['at', 'depth', true], ['az', 'azimuth', false], ['dip', 'dip', false]]);
    if (h.collarColumns && h.collarColumns.length) line(trusted('<span class="fi-x">re-mapping a column re-desurveys the holes</span>'));
    sec('desurvey');
    const mRow = document.createElement('div'); mRow.className = 'pp-row';
    const mLab = document.createElement('label'); mLab.textContent = 'method';
    const mSel = document.createElement('select');
    for (const [v, t] of [['minimumCurvature', 'minimum curvature'], ['balancedTangential', 'balanced tangential'], ['tangential', 'tangential']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; mSel.appendChild(o);
    }
    mSel.value = h.method;
    mSel.onchange = () => H.reopenDh(L, { method: mSel.value });
    mRow.append(mLab, mSel);
    body.appendChild(mRow);
    const dRow = document.createElement('div'); dRow.className = 'pp-row';
    const dLab = document.createElement('label'); dLab.textContent = 'dip';
    const dSel = document.createElement('select');
    for (const [v, t] of [['auto', `auto (${escS(h.dipConvention)})`], ['pos-down', 'positive down'], ['neg-down', 'negative down']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; dSel.appendChild(o);
    }
    dSel.value = (dh.config && dh.config.dipConvention) || 'auto';
    dSel.onchange = () => H.reopenDh(L, { dipConvention: dSel.value });
    dRow.append(dLab, dSel);
    body.appendChild(dRow);
    line(trusted('<span class="fi-x">changing method or dip re-desurveys the holes</span>'));
  } else if (L.kind === 'mesh') {
    sec('mesh');
    line(html`<span class="v">${(h.triCount || 0).toLocaleString()}</span> triangles · <span class="v">${(h.vertexCount || 0).toLocaleString()}</span> vertices · <span class="v">${escS(h.format)}</span>${h.soup ? html` · <span class="v">streamed</span>` : ''}`);
  } else {
    sec('position');
    line(html`<span class="v">${escS(h.kind === 'las' ? `LAS ${h.version} fmt ${h.format}` : 'PLY ' + escS(h.format))}</span> — positions from the file's own records`);
  }
  if (h.grid) {
    sec('block grid');
    line(html`count <span class="v">${h.grid.x.count} × ${h.grid.y.count} × ${h.grid.z.count}</span>`);
    line(html`block <span class="v">${fm(h.grid.x.pitch)} × ${fm(h.grid.y.pitch)} × ${fm(h.grid.z.pitch)}</span> m`);
    { const c0 = h.grid.rot ? worldMapOf(h.grid)(h.grid.x.origin, h.grid.y.origin, h.grid.z.origin) : [h.grid.x.origin, h.grid.y.origin, h.grid.z.origin]; line(html`block 0 centroid <span class="v">${fm(c0[0])}, ${fm(c0[1])}, ${fm(c0[2])}</span>`); }
    if (h.grid.rot) { const ag = basisAngles(h.grid.rot); line(html`rotated <span class="v">azimuth ${ag.azimuth.toFixed(1)}°${ag.zOnly ? '' : `, tilt ${ag.tilt.toFixed(1)}°`}</span> · ${(h.lattice && h.lattice.basis) || 'declared'}`); }
  }
  if (h.bbox) {
    sec('extent — world');
    for (const [ax, i] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      line(html`${ax} <span class="v">${fm(h.bbox.min[i])}</span> – <span class="v">${fm(h.bbox.max[i])}</span> <span class="fi-x">· Δ</span> <span class="v">${fm(h.bbox.max[i] - h.bbox.min[i])}</span>`);
    }
  }
  if (H.frame) { sec('frame'); line(html`origin <span class="v">${H.frame.origin.map(fm).join(', ')}</span>`); }
}
