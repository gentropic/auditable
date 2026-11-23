// micro props — the STYLE and CLASSES tabs of the Properties panel: colour by a channel /
// a category / rules / paint / a calc, the ramp section with its live histogram, breaks
// and interval table, the rule list, the class list and its legend, stick radius and
// mesh tint. The engines they drive live in src/ramp.js, src/categories.js and
// src/rules.js; the panel itself in src/props.js.
import { setGridBand, recolorSurface, setSurfaceFlatZ, setSurfaceSmooth } from './surfaces.js';
import { tok } from './theme.js';
import { mkRow, stageGate, renderProps, ppNote, refreshProps, wireScanButton } from './props.js';
import { layerHeaderOf, layerTableHeader, colIsNumeric, schemaExt } from './records.js';
import { S, requestRender, activeLayer } from './state.js';
import { setMeshTint, convertMeshLayer, applyLayerOpacity } from './layermenu.js';
import { markProjectDirty } from './project.js';
import { fmtSize } from './paths.js';
import { colorSelOf, rampCfgOf, RAMP_PRESETS, setRampCfg, rampRangeFor, bakeRampPixels, applyRamp, rampSample, classBreaks, classColor, classLabel, remapClassColors, noDataOf, syncNoData } from './ramp.js';
import { paintColByName, addPaintColorOptions, openPaintPalette } from './paint.js';
import { useAsCategory } from './coltypes.js';
import { viewCatName, modelCatName, viewTextColumns, ensureViewCat } from './viewcat.js';
import { setLayerColorBy } from './color.js';
import { setViewOffset, besideOffset } from './layerviews.js';
import { setLayerDisplayOffset } from './explode.js';
import { setHTML, trusted } from './html.js';
import { layerClassInfo, legendOf, legendCodesOf, ensureLegend, applyCatLegend, applyCatVisibility, rgbCssToHex, ensureCatCounts, textCalcSel, classHidden, storedLegend, resetLegend } from './categories.js';
import { ensureCalcDisplay } from './calc.js';
import { RULE_ELSE, runRules, applyRuleVisibility, applyRulePalette, ruleModeOf } from './rules.js';
import { validate } from '../../../ext/expr/index.js';
import { menuXY } from './menu.js';
import { ruleDefaultColor } from './columns.js';
import { pushUndo } from './undo.js';
import { fmtStat } from './analysis-ui.js';
import { histogramFromCentroids, quantileFromCentroids, cdfFromCentroids } from '../../../ext/sluice/index.js';
import { microPrompt } from './prompts.js';
const $ = (s) => document.querySelector(s);

export function renderStyleTab(body, L) {
  const gdoc = L.docs && L.docs.gridDoc;                    // multi-band GeoTIFF: pick the band (like a channel) — points OR surface
  if (gdoc && gdoc.grid && gdoc.grid.bands > 1) {
    const sel = document.createElement('select');
    for (let i = 0; i < gdoc.grid.bands; i++) { const o = document.createElement('option'); o.value = i; o.textContent = `band ${i + 1}`; sel.appendChild(o); }
    sel.value = gdoc.grid.band || 0;
    sel.onchange = () => setGridBand(L, +sel.value);
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
      sel.onchange = () => { const g = grids.find((x) => x.name === sel.value); recolorSurface(L, g || null); };
      body.appendChild(mkRow('drape', sel));
      // shape: relief heightfield, or a FLAT horizontal sheet at a world z (for a
      // 2D data grid with no DEM — appears as a plan sheet coloured by its value)
      const shp = document.createElement('span'); shp.style.cssText = 'display:flex;align-items:center;gap:6px';
      const flatChk = document.createElement('input'); flatChk.type = 'checkbox'; flatChk.checked = L.surfaceFlatZ != null;
      const zIn = document.createElement('input'); zIn.type = 'number'; zIn.step = 'any'; zIn.style.width = '84px'; zIn.value = L.surfaceFlatZ != null ? L.surfaceFlatZ : 0; zIn.style.display = L.surfaceFlatZ != null ? '' : 'none';
      const zLab = document.createElement('span'); zLab.className = 'pp-val'; zLab.textContent = 'flat @ z'; zLab.style.display = L.surfaceFlatZ != null ? '' : 'none';
      flatChk.onchange = () => { const on = flatChk.checked; zIn.style.display = on ? '' : 'none'; zLab.style.display = on ? '' : 'none'; setSurfaceFlatZ(L, on ? (+zIn.value || 0) : null); };
      zIn.onchange = () => { if (flatChk.checked) setSurfaceFlatZ(L, +zIn.value || 0); };
      shp.append(flatChk, document.createTextNode(' flatten'), zLab, zIn);
      body.appendChild(mkRow('shape', shp));
      // shading: smooth grid-gradient normals vs faceted (flat per-triangle — reads the cells)
      const shd = document.createElement('select');
      for (const [v, t] of [['smooth', 'smooth'], ['faceted', 'faceted (flat)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; shd.appendChild(o); }
      shd.value = L.surfaceSmooth === false ? 'faceted' : 'smooth';
      shd.onchange = () => setSurfaceSmooth(L, shd.value === 'smooth');
      body.appendChild(mkRow('shading', shd));
    } else {
      const tintIn = document.createElement('input'); tintIn.type = 'color'; tintIn.value = L.tint || '#9ea3a8';
      tintIn.oninput = () => setMeshTint(L, tintIn.value);
      body.appendChild(mkRow('tint', tintIn));
    }
    const op = document.createElement('input'); op.type = 'range'; op.min = 5; op.max = 100; op.step = 5;
    op.value = Math.round((L.opacity != null ? L.opacity : 1) * 100);
    const opVal = document.createElement('span'); opVal.className = 'pp-val'; opVal.textContent = op.value + '%';
    op.oninput = () => {
      opVal.textContent = op.value + '%';
      L.opacity = +op.value / 100;
      stageGate(L, () => { S.renderer.setLayerMeshStyle(L.id, { opacity: L.opacity }); requestRender(); });
      markProjectDirty();
    };
    body.appendChild(mkRow('opacity', op, opVal));
    if (h) {
      const now = S.renderer.layerVramBytes(L.id);
      const tierTxt = document.createElement('span'); tierTxt.textContent = `${h.soup ? 'streamed' : 'exact'} · ${fmtSize(now)}`;
      body.appendChild(mkRow('tier', tierTxt));
      {                                                    // exact at any size: past the cap convertMeshLayer asks first
        const est = h.soup ? (h.vertexCount || h.triCount / 2) * 12 + h.triCount * 12 : h.triCount * 18;
        const btn = document.createElement('button'); btn.className = 'pp-tab';
        btn.textContent = `convert to ${h.soup ? 'exact' : 'streamed'} (~${fmtSize(est)})`;
        btn.onclick = async () => { await convertMeshLayer(L, !h.soup); renderProps(); };
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
  const selPaint = typeof selv === 'string' && selv.startsWith('paint:') ? paintColByName(L, selv.slice(6)) : null;
  const textCalc = isTable ? textCalcSel(L) : null;       // a text ƒ colours by class: categorized
  const textCalcs = isTable ? (L.calcCols || []).filter((c) => c.ty === 'string') : [];
  const mode = isTable
    ? (selv === 'solid' ? 'solid' : selv === 'cat' || textCalc ? 'categorized' : selv === 'rules' ? 'rule-based'
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
    if (L.viewOf != null) {                                 // a view classes by its own column — no re-read of its model
      if (viewCatName(L) || modelCatName(L)) return setSel('cat');
      const first = viewTextColumns(L)[0];
      if (!first) { $('#meta').textContent = 'categorized: no text column to class by — re-type one under columns (on the model)'; renderProps(); return; }
      await setLayerColorBy(L, 'catcol:' + first).catch((e) => { $('#meta').textContent = `categorized — ${e.message}`; });
      addPaintColorOptions(L); renderProps(); return;
    }
    const h2 = layerTableHeader(L);
    if (h2 && h2.categories && h2.categories.length) return setSel('cat');
    if (textCalcs.length) { addPaintColorOptions(L); return setSel('calc:' + textCalcs[0].name); }   // a text ƒ classes live, no re-read
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
      for (const pc of (L.paintCols || []).filter((c) => c.kind === 'ratio')) add('paint:' + pc.name, (pc.mat ? '' : '% ') + pc.name);   // a materialized column is a column, not a fraction
      // calculated columns are columns: colour, class and legend by them like any other
      for (const cc of (L.calcCols || []).filter((c) => (c.ty || 'number') === 'number')) add('calc:' + cc.name, 'ƒ ' + cc.name);
    } else {
      setHTML(colSel, trusted('<option value="0">elevation</option><option value="1">intensity</option>'));
    }
    if ([...colSel.options].some((o) => o.value === selv)) colSel.value = selv;
    colSel.onchange = () => { if (colSel.value.startsWith('paint:')) addPaintColorOptions(L); setSel(colSel.value); };
    body.appendChild(mkRow('column', colSel));
    if (selPaint && selPaint.kind === 'ratio' && !selPaint.mat) body.appendChild(ppNote('fraction-inside column — values are 0–1 (code/255); recompute from Tools → Select by solid…'));
    const mkClip = (id) => {
      const inp = document.createElement('input'); inp.type = 'number'; inp.style.width = '76px';
      inp.value = $('#' + id).value; inp.placeholder = id === 'clipMin' ? 'min' : 'max';
      inp.oninput = () => { $('#' + id).value = inp.value; $('#' + id).dispatchEvent(new Event('input')); requestRender(); };
      // committed: repaint in place; the full re-render waits until focus has LEFT the pane — a
      // rebuild here would destroy the max box the user is tabbing or clicking into
      inp.onchange = () => {
        $('#' + id).value = inp.value; $('#' + id).dispatchEvent(new Event('change'));
        setTimeout(() => { const f = document.activeElement; if (f && f.closest && f.closest('#propPanel')) repaintRamp(); else renderProps(); }, 0);
      };
      return inp;
    };
    body.appendChild(mkRow('clip', mkClip('clipMin'), mkClip('clipMax')));
    renderRampSection(body, L);
  } else if (mode === 'categorized') {
    if (isTable && L.viewOf != null) {                       // a view: any text column, read into the view's own class codes
      const colSel = document.createElement('select');
      for (const c of viewTextColumns(L)) { const o = document.createElement('option'); o.value = c; o.textContent = c; colSel.appendChild(o); }
      colSel.value = viewCatName(L) || modelCatName(L) || '';
      colSel.title = "the class column — this view's own; its model and other views keep theirs";
      colSel.onchange = async () => {
        await setLayerColorBy(L, 'catcol:' + colSel.value).catch((e) => { $('#meta').textContent = `categorized — ${e.message}`; });
        addPaintColorOptions(L); renderProps();
      };
      body.appendChild(mkRow('column', colSel));
    } else if (isTable) {
      const h2 = layerTableHeader(L);
      const colSel = document.createElement('select');
      h2.columns.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c; colSel.appendChild(o); });
      // text ƒ columns class too — live, from their expression (no re-read; they recompute when edited)
      for (const cc of textCalcs) { const o = document.createElement('option'); o.value = 'calc:' + cc.name; o.textContent = 'ƒ ' + cc.name; colSel.appendChild(o); }
      colSel.value = textCalc ? 'calc:' + textCalc : String(h2.mapping.cat != null ? h2.mapping.cat : -1);
      colSel.title = 'the class column — a file column re-reads the file (any column can class: zone codes included); a ƒ column classes live';
      colSel.onchange = async () => {
        if (colSel.value.startsWith('calc:')) { addPaintColorOptions(L); return setSel(colSel.value); }
        const i = +colSel.value;
        if (h2.categories && h2.mapping.cat === i) return setSel('cat');   // back from a ƒ to the file's own class column
        await useAsCategory(L, i); setSel('cat');
      };
      body.appendChild(mkRow('column', colSel));
    }
    const info = layerClassInfo(L);
    if (info && info.pending && info.calc) {                // a text ƒ, still being computed (it re-renders this pane)
      body.appendChild(ppNote(`computing ƒ ${info.calc}…`));
      ensureCalcDisplay(L);
    } else if (info && info.pending) {                      // a view's own column, still being read
      body.appendChild(ppNote(`reading ${info.column}…`));
      ensureViewCat(L).then((v) => { if (v) renderProps(); }).catch((e) => { $('#meta').textContent = `classes — ${e.message}`; });
    } else if (info) renderClassList(body, L, info);
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
    open.onclick = () => openPaintPalette(L);
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
    op.oninput = () => { opVal.textContent = op.value + '%'; applyLayerOpacity(L, +op.value / 100); };
    body.appendChild(mkRow('opacity', op, opVal));
  }
  if (L.dh && L.docs.dhDoc) renderStickRadius(body, L);
  if (L.viewOf != null) renderViewOffset(body, L);
  else if (L.kind !== 'table') renderLayerOffset(body, L);
}
// any layer can be DRAWN somewhere else — pulled aside to compare, or by a group's
// Explode… — its data stays where it is
function renderLayerOffset(body, L) {
  const cur = L.offset || [0, 0, 0];
  const ins = ['x', 'y', 'z'].map((ax, k) => {
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.style.width = '52px';
    inp.value = String(cur[k]); inp.title = `draw the layer moved along ${ax} (world units) — its records keep their coordinates`;
    inp.onchange = () => { setLayerDisplayOffset(L, ins.map((i) => +i.value || 0)); renderProps(); };
    return inp;
  });
  body.appendChild(mkRow('offset', ...ins));
  if (L.offset) {
    const home = document.createElement('button'); home.className = 'pp-tab'; home.textContent = 'home';
    home.title = 'draw it where its data is';
    home.onclick = () => { setLayerDisplayOffset(L, null); renderProps(); };
    body.appendChild(mkRow('', home));
    body.appendChild(ppNote('drawn displaced — picks, measures, exports and analysis read the true coordinates'));
  }
}
// a VIEW can be drawn somewhere else than its data — side by side with its
// model, for two columns over the same region. Display only.
function renderViewOffset(body, L) {
  const cur = L.offset || [0, 0, 0];
  const ins = ['x', 'y', 'z'].map((ax, k) => {
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.style.width = '52px';
    inp.value = String(cur[k]); inp.title = `move the view along ${ax} (world units) — its records keep their coordinates`;
    inp.onchange = () => { setViewOffset(L, ins.map((i) => +i.value || 0)); };
    return inp;
  });
  body.appendChild(mkRow('offset', ...ins));
  const beside = document.createElement('button'); beside.className = 'pp-tab';
  beside.textContent = 'beside its model';
  beside.title = 'move the view east, next to its model and its other views';
  beside.onclick = () => { const o = besideOffset(L); if (o) { setViewOffset(L, o); renderProps(); } else $('#meta').textContent = 'offset: nothing drawn to place it beside'; };
  const reset = document.createElement('button'); reset.className = 'pp-tab';
  reset.textContent = 'on its model';
  reset.disabled = !L.offset;
  reset.onclick = () => { setViewOffset(L, null); renderProps(); };
  body.appendChild(mkRow('', beside, reset));
  if (L.offset) body.appendChild(ppNote('moved for display — picks, exports and analysis read the true coordinates'));
}
// the rules editor (§10.4): ordered rows, first match wins top-to-bottom.
// Color/name/eye edits are texture-only (instant); expr edits, add, remove,
// and reorder change what the codes MEAN, so they re-run the sweep (staged
// like every other style edit — auto-apply sweeps on commit, otherwise the
// apply button does).
function renderRuleList(body, L) {
  if (!L.rules) L.rules = { list: [], elseColor: RULE_ELSE };
  if (!L.ruleHidden) L.ruleHidden = new Set();
  const rules = L.rules.list;
  const h = layerTableHeader(L);
  const schema = h ? schemaExt(L, h) : null;
  const sec = document.createElement('div'); sec.className = 'pp-sec';
  sec.textContent = 'rules — first match wins';
  body.appendChild(sec);
  // structural change: codes are stale until the next sweep
  const structural = () => { L._rulesDirty = true; markProjectDirty(); runRules(L); };
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
      markProjectDirty();
    };
    const sw = document.createElement('input'); sw.type = 'color';
    sw.value = isElse ? ((L.rules.elseColor) || RULE_ELSE) : (r.color || RULE_ELSE);
    sw.oninput = () => {
      if (isElse) L.rules.elseColor = sw.value; else r.color = sw.value;
      applyRulePalette(L);
      markProjectDirty();
    };
    row.append(eye, sw);
    if (isElse) {
      const nm = document.createElement('span'); nm.className = 'else-nm'; nm.textContent = 'everything else';
      nm.style.gridColumn = '4 / 6';
      row.appendChild(nm);
    } else {
      const nm = document.createElement('input'); nm.type = 'text'; nm.placeholder = `rule ${idx + 1}`;
      nm.value = r.name || '';
      nm.onchange = () => { r.name = nm.value.trim(); markProjectDirty(); };
      const ex = document.createElement('input'); ex.type = 'text'; ex.placeholder = 'FE > 55 and LITO = "HEM"';
      ex.value = r.expr || '';
      ex.title = 'the filter language, over every column (ƒ included)';
      if ((r.expr || '').trim() && schema) ex.classList.toggle('err', !validate(r.expr, schema).ok);
      ex.onchange = () => {
        r.expr = ex.value;
        const ok = !!ex.value.trim() && (!schema || validate(ex.value, schema).ok);
        ex.classList.toggle('err', !!ex.value.trim() && !ok);
        if (ok) structural();
        else { L._rulesDirty = true; markProjectDirty(); }
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
        menuXY(r2.left - 60, r2.bottom + 2, [
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
    markProjectDirty();
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
function renderStickRadius(body, L) {
  const sec = document.createElement('div'); sec.className = 'pp-sec'; sec.textContent = 'style';
  body.appendChild(sec);
  const cur = S.renderer.layerStickRadius(L.id);
  // slider covers the common range; the number box types exact / beyond-slider
  // values (no hard cap — deposit-scale views can want fat sticks).
  const r = document.createElement('input'); r.type = 'range'; r.min = 0.2; r.max = 25; r.step = 0.1;
  r.value = Math.min(cur, 25);
  const num = document.createElement('input'); num.type = 'number'; num.min = 0.05; num.step = 0.1; num.value = String(cur); num.style.width = '58px';
  const apply = (v) => {
    if (!Number.isFinite(v) || v <= 0) return;
    L.docs.dhDoc.config.radius = v;
    stageGate(L, () => { S.renderer.setLayerStickRadius(L.id, v); requestRender(); });
    markProjectDirty();
  };
  r.oninput = () => { num.value = (+r.value).toFixed(1); apply(+r.value); };
  num.onchange = () => { const v = +num.value; r.value = Math.min(Math.max(v, +r.min), +r.max); apply(v); };
  body.appendChild(mkRow('stick radius (m)', r, num));
}
// a break edit: the new list (sorted, deduped), each colour kept with its class
// (remapClassColors), and one undo step that restores the exact before — on THIS cfg
// object, so an undo after switching the colour-by still lands on the right column
function editBreaks(L, next, label) {
  const c = rampCfgOf(L, true);
  const cp = (a) => (a ? a.slice() : null);
  const before = { breaks: (c.breaks || []).slice(), colors: cp(c.colors), hide: cp(c.hide) };
  const nb = classBreaks({ breaks: next }), ob = classBreaks(c);
  const colors = remapClassColors(ob, c.colors, nb);
  const hide = remapClassColors(ob, c.hide, nb);            // a class's eye travels with it like its colour
  setRampCfg(L, { breaks: nb, colors, hide });
  const after = { breaks: nb.slice(), colors: cp(colors), hide: cp(hide) };
  const put = (st) => { c.breaks = st.breaks.slice(); c.colors = cp(st.colors); c.hide = cp(st.hide); applyRamp(L); markProjectDirty(); refreshProps(); };
  pushUndo(label, () => put(before), { redo: () => put(after) });
}
// blanks (a missing value) draw in their own colour — or hide — rather than as the lowest
// class; the count comes from the column's scan when there is one
function renderNoDataRow(body, L) {
  const nd = noDataOf(L);
  const chip = document.createElement('input'); chip.type = 'color'; chip.value = nd.color;
  chip.title = 'the colour blanks (missing values) draw in';
  chip.style.cssText = 'width:16px;height:14px;padding:0;border:1px solid var(--border);background:none;cursor:pointer;';
  const set = (patch, label) => {
    const before = L.noData ? { ...L.noData } : null;
    L.noData = { ...noDataOf(L), ...patch };
    const after = { ...L.noData };
    syncNoData(L); requestRender(); markProjectDirty();
    const put = (v) => { L.noData = v ? { ...v } : null; syncNoData(L); requestRender(); markProjectDirty(); refreshProps(); };
    pushUndo(label, () => put(before), { redo: () => put(after), key: `nodata:${L.id}:${Object.keys(patch)[0]}` });
  };
  chip.oninput = () => set({ color: chip.value }, 'no-data colour');
  const lab = document.createElement('label');
  const hide = document.createElement('input'); hide.type = 'checkbox'; hide.checked = !!nd.hide;
  hide.onchange = () => { set({ hide: hide.checked }, hide.checked ? 'hide blanks' : 'show blanks'); };
  lab.append(hide, ' hide');
  const ct = document.createElement('span'); ct.className = 'pp-val';
  const sv = String(colorSelOf(L)), h = layerTableHeader(L);
  const name = sv.startsWith('chan:') && h ? h.columns[+sv.slice(5)] : sv.startsWith('calc:') ? sv.slice(5) : sv.startsWith('paint:') ? sv.slice(6) : null;
  const stat = name && L._colStats && L._colStats[name];
  ct.textContent = stat && stat.nulls != null ? `${stat.nulls.toLocaleString()} blank` : '';
  body.appendChild(mkRow('no data', chip, lab, ct));
}
function renderRampSection(body, L) {
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
  const isCalc = String(selv).startsWith('calc:');         // a calculated column: classes and a histogram like a channel
  const isElev = selv === 'elev' || selv === '0';
  if (!isChan && !isElev && !isRatio && !isCalc) {
    body.appendChild(ppNote('breakpoints live on numeric columns and elevation'));
    return;
  }
  const [rLo, rHi] = rampRangeFor(L);
  renderIntervalTable(body, L, rLo, rHi);
  // the breaks quick-entry — type round numbers, Enter applies (sorted, deduped)
  {
    const cfgNow = rampCfgOf(L);
    const bIn = document.createElement('input'); bIn.type = 'text';
    bIn.placeholder = 'e.g. 15, 25, 40';
    bIn.style.cssText = 'flex:1;background:var(--bg-btn);color:var(--text);border:1px solid var(--border);font:inherit;padding:2px 5px;';
    bIn.value = ((cfgNow && cfgNow.breaks) || []).map((v) => fmtStat(v)).join(', ');
    const applyBreaks = () => {
      editBreaks(L, bIn.value.split(/[,;\s]+/).map(parseFloat).filter(Number.isFinite), 'edit breaks');   // colours stay with their classes
      renderProps();
    };
    bIn.onkeydown = (e) => { if (e.key === 'Enter') applyBreaks(); };
    bIn.onblur = () => { if (bIn.value !== ((rampCfgOf(L) || {}).breaks || []).map((v) => fmtStat(v)).join(', ')) applyBreaks(); };
    body.appendChild(mkRow('breaks', bIn));
    renderNoDataRow(body, L);
    // live drag sync — but never while the user is typing in it
    if (_rampRepaint) _rampRepaint.breaksIn = () => {
      if (document.activeElement === bIn) return;
      bIn.value = (((rampCfgOf(L) || {}).breaks) || []).slice().sort((a, b2) => a - b2).map((v) => fmtStat(v)).join(', ');
    };
  }
  if (!isChan && !isRatio && !isCalc) return;              // the histogram is scan-fed — channels, ratio and calc columns have stats
  const h = layerTableHeader(L);
  const colName = isRatio ? String(selv).slice(6) : isCalc ? String(selv).slice(5) : (h && h.columns[+String(selv).slice(5)]);
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
      const ti = Math.min(255, Math.max(0, Math.floor(((b2 + 0.5) / N) * 256)));   // the texel the GPU reads for this value
      g2.fillStyle = `rgb(${lut[ti * 4]},${lut[ti * 4 + 1]},${lut[ti * 4 + 2]})`;
      g2.fillRect(b2 * 10, cvh.height - hp, 9, hp);
    }
    const c2 = rampCfgOf(L);
    for (const v of (c2 && c2.breaks) || []) {
      const x = vx(v);
      g2.fillStyle = tok('--accent');
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
  let dragging = -1, dragBefore = null;
  cvh.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x = evX(e);
    const k = nearBreak(x);
    if (k >= 0) {
      const c0 = rampCfgOf(L, true);
      c0.breaks = classBreaks(c0);                          // sorted, so a break's neighbours are its indices ± 1
      dragging = nearBreak(x); dragBefore = c0.breaks.slice();
      cvh.setPointerCapture(e.pointerId);
    }
  });
  cvh.addEventListener('pointermove', (e) => {
    const x = evX(e);
    if (dragging >= 0) {
      const c2 = rampCfgOf(L, true);
      // a break can't pass its neighbours: classes keep their order, so their colours stay theirs
      const eps = span * 1e-4;
      const lo2 = dragging > 0 ? c2.breaks[dragging - 1] + eps : -Infinity;
      const hi2 = dragging < c2.breaks.length - 1 ? c2.breaks[dragging + 1] - eps : Infinity;
      c2.breaks[dragging] = Math.min(hi2, Math.max(lo2, xv(x)));
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
  cvh.addEventListener('pointerup', () => {
    if (dragging < 0) return;
    dragging = -1;
    const c2 = rampCfgOf(L, true), before = dragBefore, after = c2.breaks.slice();
    setRampCfg(L, {});
    const put = (b) => { c2.breaks = b.slice(); applyRamp(L); markProjectDirty(); refreshProps(); };
    if (before) pushUndo('move a break', () => put(before), { redo: () => put(after) });
    renderProps();
  });
  cvh.addEventListener('dblclick', (e) => {               // split the class under the pointer: both halves keep its colour
    const c2 = rampCfgOf(L, true);
    editBreaks(L, [...(c2.breaks || []), xv(evX(e))], 'add a break');
    renderProps();                                          // the interval table + breaks input follow the gesture
  });
  cvh.addEventListener('contextmenu', (e) => {             // merge two classes: the lower one's colour stays
    e.preventDefault();
    const k = nearBreak(evX(e));
    if (k >= 0) { const c2 = rampCfgOf(L, true); editBreaks(L, c2.breaks.filter((_, i) => i !== k), 'remove a break'); renderProps(); }
  });
  body.appendChild(cvh);
  const hint = document.createElement('div'); hint.className = 'pp-hist-hint';
  hint.textContent = 'double-click adds a breakpoint · drag moves · right-click removes';
  body.appendChild(hint);
  // auto-breaks from the scan's t-digest
  const bulk = document.createElement('div'); bulk.className = 'pp-bulk';
  const nIn = document.createElement('input'); nIn.type = 'number'; nIn.min = 2; nIn.max = 12; nIn.value = 5;
  nIn.style.cssText = 'width:44px;background:var(--bg-btn);color:var(--text);border:1px solid var(--border);font:inherit;padding:1px 3px;';
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
      editBreaks(L, breaks, 'quantile breaks'); renderProps();   // same class count → the palette stays
    }),
    mkA('equal', () => {
      const n = Math.max(2, Math.min(12, +nIn.value || 5));
      const breaks = [];
      for (let i = 1; i < n; i++) breaks.push(lo + (span * i) / n);
      editBreaks(L, breaks, 'equal breaks'); renderProps();
    }),
    mkA('clear', () => { editBreaks(L, [], 'clear breaks'); renderProps(); }),
    logL,
  );
  body.appendChild(bulk);
}
// the interval table (§10 breakpoints). CLASSED: one row per class over the FULL break list —
// '< 20' · '20 – 40' · '≥ 65', an editable colour chip, the upper bound editable in place
// (any value: a class outside this layer's range keeps its row and colour, count 0), and a
// count + share from the scan's centroids. STRETCHED (unclassed): one row per band between
// the range ends and the breaks inside it. The quick-entry input above stays for typing.
function renderIntervalTable(body, L, lo, hi) {
  const cfg = rampCfgOf(L);
  if (!cfg) return;
  const classed = !!cfg.classed;
  const all = classBreaks(cfg);
  const breaks = classed ? all : all.filter((v) => v > lo && v < hi);
  if (!breaks.length) return;
  const stops = RAMP_PRESETS[cfg.preset || 'viridis'] || RAMP_PRESETS.viridis;
  const selv = colorSelOf(L);
  const h = layerTableHeader(L);
  const sv = String(selv);
  const colName = sv.startsWith('chan:') && h ? h.columns[+sv.slice(5)] : sv.startsWith('calc:') ? sv.slice(5) : sv.startsWith('paint:') ? sv.slice(6) : null;
  const stat = colName && L._colStats && L._colStats[colName];
  const F = stat && stat.centroids ? cdfFromCentroids(stat.centroids, stat.total) : null;
  const fmtN = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e5 ? Math.round(v / 1e3) + 'k' : Math.round(v).toLocaleString());
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  // the rows of the current break list: [from, to] per row (±∞ at a class table's ends)
  const rowsOf = (bks) => (classed
    ? Array.from({ length: bks.length + 1 }, (_, k) => [k === 0 ? -Infinity : bks[k - 1], k === bks.length ? Infinity : bks[k]])
    : [lo, ...bks].map((v, k, arr) => [v, k === arr.length - 1 ? hi : arr[k + 1]]));
  const countOf = (a2, b2) => {
    if (!F) return null;
    const fa = a2 === -Infinity ? 0 : F(a2), fb = b2 === Infinity ? stat.total : F(b2 === hi && !classed ? b2 + 1e-9 : b2);
    return Math.max(0, fb - fa);
  };
  const ctText = (n) => (n == null ? '–' : `${fmtN(n)} · ${stat.total ? Math.round((100 * n) / stat.total) : 0}%`);
  const swOf = (bks, k, rows) => (classed ? classColor(cfg, bks, k)
    : hex(rampSample(stops, ((rows[k][0] + rows[k][1]) / 2 - lo) / Math.max(hi - lo, 1e-9))));
  const rows = rowsOf(breaks);
  const liveRows = [];                                     // per-row element refs for the live drag sync
  rows.forEach(([from, to], k) => {
    const row = document.createElement('div'); row.className = classed ? 'pp-band eyed' : 'pp-band';
    const live = { fromS: null, dash: null, toIn: null, toS: null, sw: null, chip: null, ct: null };
    liveRows.push(live);
    if (classed) {
      // the class's eye: hidden classes cull (GPU — the ramp texel's alpha), aren't pickable, and
      // leave the legend; one undo step
      const eye = document.createElement('input'); eye.type = 'checkbox'; eye.checked = !(cfg.hide && cfg.hide[k]);
      eye.title = `show class ${classLabel(breaks, k, fmtStat)}`;
      eye.onchange = () => {
        const c2 = rampCfgOf(L, true), before = c2.hide ? c2.hide.slice() : null;
        const h2 = (c2.hide || []).slice(); h2[k] = !eye.checked;
        const after = h2.some(Boolean) ? h2 : null;
        setRampCfg(L, { hide: after });
        const put = (hd) => { c2.hide = hd ? hd.slice() : null; applyRamp(L); markProjectDirty(); refreshProps(); };
        pushUndo(`${eye.checked ? 'show' : 'hide'} class ${classLabel(breaks, k, fmtStat)}`, () => put(before), { redo: () => put(after) });
      };
      row.appendChild(eye);
      const chip = document.createElement('input'); chip.type = 'color';
      chip.value = classColor(cfg, breaks, k);
      chip.title = `class ${classLabel(breaks, k, fmtStat)}`;
      chip.style.cssText = 'width:16px;height:14px;padding:0;border:1px solid var(--border);background:none;cursor:pointer;';
      let chipBefore = null;
      chip.onfocus = () => { const c0 = rampCfgOf(L, true); chipBefore = c0.colors ? c0.colors.slice() : null; };
      chip.oninput = () => {
        const c2 = rampCfgOf(L, true);
        c2.colors = c2.colors || [];
        c2.colors[k] = chip.value;
        setRampCfg(L, {});
      };
      chip.onchange = () => {                               // one undo step per colour choice
        const c2 = rampCfgOf(L, true), before = chipBefore, after = c2.colors ? c2.colors.slice() : null;
        const put = (cl) => { c2.colors = cl ? cl.slice() : null; applyRamp(L); markProjectDirty(); refreshProps(); };
        pushUndo('class colour', () => put(before), { redo: () => put(after), key: `classcolor:${L.id}:${k}` });
        chipBefore = after;
      };
      row.appendChild(chip);
      live.chip = chip;
    } else {
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = swOf(breaks, k, rows);
      row.appendChild(sw);
      live.sw = sw;
    }
    // the bounds: classed '< b0' · 'a – b' · '≥ bn'; stretched 'lo – b' … 'b – hi'
    const first = classed && k === 0, last = k === rows.length - 1;
    const fromS = document.createElement('span'); fromS.className = 'from';
    fromS.textContent = first ? '' : classed && last ? '≥' : fmtStat(from);
    const dash = document.createElement('span'); dash.className = 'dash'; dash.textContent = first ? '<' : classed && last ? '' : '–';
    row.append(fromS, dash);
    live.fromS = fromS; live.dash = dash;
    if (!last) {
      const toIn = document.createElement('input'); toIn.type = 'number'; toIn.step = 'any';
      toIn.value = +to.toFixed(2);
      toIn.onchange = () => {
        const v = parseFloat(toIn.value);
        if (!Number.isFinite(v) || (!classed && (v <= lo || v >= hi))) { toIn.value = +to.toFixed(2); return; }
        editBreaks(L, breaks.map((b3, i) => (i === k ? v : b3)), 'edit a class bound');
        renderProps();
      };
      row.appendChild(toIn);
      live.toIn = toIn;
    } else {
      const toS = document.createElement('span'); toS.className = 'to-max';
      toS.textContent = classed ? fmtStat(breaks[breaks.length - 1]) : fmtStat(to);
      row.appendChild(toS);
      live.toS = toS;
    }
    const ct = document.createElement('span'); ct.className = 'ct';
    ct.textContent = ctText(countOf(from, to));
    row.appendChild(ct);
    live.ct = ct;
    body.appendChild(row);
  });
  // live drag sync: the histogram drag repatches bounds, swatches and counts in place — the
  // file-of-record stays cfg.breaks; renderProps still owns any structural change (a row
  // added or removed mid-gesture just freezes the table until pointerup)
  if (_rampRepaint) _rampRepaint.bands = () => {
    const c2 = rampCfgOf(L);
    const all2 = classBreaks(c2);
    const bks = classed ? all2 : all2.filter((v) => v > lo && v < hi);
    if (bks.length !== breaks.length) return;
    const rs = rowsOf(bks);
    liveRows.forEach((r, k) => {
      const [from, to] = rs[k];
      const first = classed && k === 0, last = k === rs.length - 1;
      r.fromS.textContent = first ? '' : classed && last ? '≥' : fmtStat(from);
      if (r.toIn && document.activeElement !== r.toIn) r.toIn.value = +to.toFixed(2);
      if (r.toS) r.toS.textContent = classed ? fmtStat(bks[bks.length - 1]) : fmtStat(to);
      if (r.sw) r.sw.style.background = swOf(bks, k, rs);
      if (r.chip && document.activeElement !== r.chip) r.chip.value = classColor(c2, bks, k);
      r.ct.textContent = ctText(countOf(from, to));
    });
  };
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
// the class legend (eyes + swatches + counts + bulk) — the classes tab's body,
// also embedded by the style tab's categorized mode
function renderClassList(body, L, info) {
  const sec = document.createElement('div'); sec.className = 'pp-sec';
  sec.textContent = `classes — ${info.column}`;
  body.appendChild(sec);
  const hidden = classHidden(L, info);                     // the layer's class codes, or a text ƒ's hidden values
  const leg = legendOf(L, info);
  // long class lists (domains, lithologies, string codes) get a search box —
  // same pattern as the record-panel field picker; bulk acts on what's shown
  let searchIn = null;
  if (leg.entries.length > 8) {
    searchIn = document.createElement('input');
    searchIn.type = 'text'; searchIn.className = 'pp-catsearch'; searchIn.placeholder = `search ${leg.entries.length} classes…`; searchIn.spellcheck = false;
    body.appendChild(searchIn);
  }
  const stored = storedLegend(L, info) === leg;
  const covered = new Set();
  for (const e of leg.entries) for (const c of legendCodesOf(info, e)) covered.add(c);
  const uncovered = stored ? info.codes.filter((c) => !covered.has(c)) : [];
  const touch = () => { ensureLegend(L, info); applyCatLegend(L); markProjectDirty(); };
  const entryRows = [];                                    // for the drag map
  const rowFor = (e, codes, isOther) => {
    const row = document.createElement('div'); row.className = 'pp-cat' + (codes.length && codes.every((c) => hidden.has(c)) ? ' off' : '');
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
          markProjectDirty();
          renderProps();
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      };
      row.appendChild(grip);
    }
    const eye = document.createElement('input'); eye.type = 'checkbox';
    eye.checked = !codes.length || codes.some((c) => !hidden.has(c));
    eye.onchange = () => {
      for (const c of codes) { if (eye.checked) hidden.delete(c); else hidden.add(c); }
      row.classList.toggle('off', !eye.checked);
      applyCatVisibility(L);
    };
    const sw = document.createElement('input'); sw.type = 'color'; sw.value = isOther ? (leg.otherColor || '#555a5f') : e.color;
    sw.style.cssText = 'width:16px;height:14px;padding:0;border:1px solid var(--border);background:none;cursor:pointer;flex:0 0 auto;';
    sw.oninput = () => {
      const legS = ensureLegend(L, info);
      if (isOther) legS.otherColor = sw.value;
      else { const me = legS.entries.find((x) => x === e) || legS.entries.find((x) => x.label === e.label); if (me) me.color = sw.value; }
      applyCatLegend(L); markProjectDirty();
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
        menuXY(ev.clientX, ev.clientY, [
          { label: 'Split into entries', action: () => {
            const l2 = legS();
            for (const c of codes) l2.entries.push({ label: String(info.names[c]), values: [info.kind === 'las' ? c : String(info.names[c])], color: rgbCssToHex(info.colorAt(c)) });
            touch(); renderProps();
          } },
        ]);
        return;
      }
      menuXY(ev.clientX, ev.clientY, [
        { label: 'Rename…', action: async () => { const v = await microPrompt('legend label', e.label); if (v && v.trim()) { const l2 = legS(); const me = l2.entries.find((x) => x.label === e.label); if (me) me.label = v.trim(); touch(); renderProps(); } } },
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
    if (info.calc && !legendCodesOf(info, e).length) continue;   // a ƒ class absent now: kept (its colour returns with it), not listed
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
      r.eye.checked = !r.codes.length || r.codes.some((c) => !hidden.has(c));
      r.row.classList.toggle('off', !r.eye.checked);
    }
    applyCatVisibility(L);
  };
  const shownCodes = () => { const out = []; for (const r of shownRows()) out.push(...r.codes); return out.length ? out : info.codes; };
  bulk.append(
    mkA('all', () => { for (const c of shownCodes()) hidden.delete(c); sync(); }),
    mkA('none', () => { for (const c of shownCodes()) hidden.add(c); sync(); }),
    mkA('invert', () => { for (const c of shownCodes()) { if (hidden.has(c)) hidden.delete(c); else hidden.add(c); } sync(); }),
    ...(stored ? [mkA('reset legend', () => { resetLegend(L, info); renderProps(); })] : []),
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
export let _rampRepaint = null;   // { prev, hist } — the ramp section's live canvases
export function dropRampRepaint() { _rampRepaint = null; }   // the panel closed: nothing to keep live
// a clip typed in the pane: the strip, histogram, table and breaks entry repaint in place
export function repaintRamp() { const r = _rampRepaint; if (!r) return; for (const k of ['prev', 'hist', 'bands', 'breaksIn']) if (r[k]) r[k](); }
