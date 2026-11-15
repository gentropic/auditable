// micro props — the Properties panel: it follows the active layer, holds its tabs and
// the staged apply (live, or held until [apply], with [revert]), and draws the columns
// tab (census stats, types, detection-limit policies, scans) and the source tab. The
// style and classes tabs are src/props-style.js, the join tab src/joins.js; what they
// drive lives in src/ramp.js, src/categories.js, src/rules.js, src/coltypes.js,
// src/calc.js and src/paint.js. Carved from index.html (phase 3).
import { _sheetExclusive } from './windows.js';
import { tok } from './theme.js';
import { S, activeLayer, requestRender } from './state.js';
import { colIsNumeric, layerHeaderOf, layerTableHeader, locationsOf, qualifyPolicy, rowQualifier } from './records.js';
import { appendHTML, html, joinH, setHTML, trusted } from './html.js';
import { colStatsComplete, footerColStats, scanColumns } from './columns.js';
import { fmtStat } from './analysis-ui.js';
import { histogramFromCentroids } from '../../../ext/sluice/index.js';
import { basisAngles, describeQualified, worldMapOf } from '../../../ext/condenser/src/main.js';
import { resetJoinForm, renderJoinTab } from './joins.js';
import { pushUndo } from './undo.js';
import { menuXY } from './menu.js';
import { droppedNote, dmRotationText } from './open-blocks.js';
import { hexToRgb01 } from './color.js';
import { reopenDh } from './drillholes.js';
import { markProjectDirty } from './project.js';
import { openCalcWindow } from './calc.js';
import { reopenWithMapping } from './reopen.js';
import { applyRamp } from './ramp.js';
import { applyCatVisibility, applyCatLegend } from './categories.js';
import { runRules, ruleModeOf, rulesOf } from './rules.js';
import { useAsCategory, setColType, qualifyMenuItems } from './coltypes.js';
import { dropRampRepaint, renderClassesTab, renderStyleTab } from './props-style.js';
const $ = (s) => document.querySelector(s);

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

export function closeProps() { _propOpen = false; _propFor = null; dropRampRepaint(); $('#propPanel').classList.remove('show'); }

export function propKindLine(L) {
  if (L.viewOf != null) {                                  // a VIEW: say whose data, then what that data is
    const M = S.layers.find((x) => x.id === L.viewOf);
    if (M) return `view of “${M.label || M.name}” — its own colour, filter and display · ${propKindLine(M)}`;
  }
  const h = layerHeaderOf(L);
  const n = S.renderer.layerElementCount(L.id) || 0;
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
  const dn = L.docs.blockDoc ? droppedNote(L.docs.blockDoc.header) + (dmRotationText(L.docs.blockDoc.header) ? ' · ⚠ rotated .dm, shown unrotated' : '') : '';
  if (L.docs.blockDoc && L.docs.blockDoc.header.grid) return `block model · ${n.toLocaleString()} blocks${dn}`;
  return `points · ${n.toLocaleString()}${dn}`;
}

export function renderProps() {
  const L = activeLayer();
  if (!L) { closeProps(); return; }
  if (_propFor !== L.id) {
    resetJoinForm();                                       // the form belongs to one layer
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

// ── staged apply (the pp footer): auto ON = live-apply (the default, micro's
// grammar); auto OFF = panel style edits mutate the LAYER STATE but hold the
// renderer push until [apply] — one reconvergence instead of one per edit on
// huge layers. [revert] restores the snapshot from when the panel targeted
// the layer. Source-tab re-reads and toolbar controls stay immediate. ──
export let _autoApply = (() => { try { return localStorage.getItem('micro.autoApply') !== 'off'; } catch { return true; } })();

export function setAutoApply(on) { _autoApply = !!on; try { localStorage.setItem('micro.autoApply', on ? 'on' : 'off'); } catch { /* ignore */ } }

function styleSnap(L) {
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
  if (L.kind === 'mesh') S.renderer.setLayerMeshStyle(L.id, { tint: hexToRgb01(L.tint || '#9ea3a8'), opacity: L.opacity != null ? L.opacity : 1 });
  if (L.dh && L.docs.dhDoc) S.renderer.setLayerStickRadius(L.id, L.docs.dhDoc.config.radius || 1);
  L._stagePend = false;
  requestRender();
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
  markProjectDirty();
  renderProps();
}

export function syncPPFooter() {
  const L = activeLayer();
  $('#ppAuto').checked = _autoApply;
  $('#ppApply').disabled = _autoApply || !L || !L._stagePend;
  $('#ppApply').textContent = L && L._stagePend ? 'apply •' : 'apply';
}

// ── the columns tab: per-column types (with real consumers — the filter's
// schema, color-by eligibility, the category column) + streaming stats on
// request: ONE pass, ALL columns, @gcu/sluice accumulators (welford + t-digest
// for numerics, topK/cardinality for text). The t-digest centroids double as
// the sparkline — and later feed the style tab's breakpoints editor. ──
function colRole(h, i) {
  const m = h.mapping || {}, im = h.intervalMapping || {};
  if (i === m.x) return 'X'; if (i === m.y) return 'Y'; if (i === m.z) return 'Z';
  if (i === im.bhid) return 'hole id'; if (i === im.from) return 'FROM'; if (i === im.to) return 'TO';
  if (i === m.chan) return 'color'; if (i === m.cat) return 'category';
  return null;
}

// One column's statistics as a block of the panel: the Parquet footer's numbers
// before any scan, the scanned numbers after it (with the sparkline), or a
// categorical column's top values.
function appendColStats(body, stat, onCtx) {
  if (!stat) return;
  const d = document.createElement('div'); d.className = 'pp-stats';
  if (onCtx) d.oncontextmenu = onCtx;
  if (stat.footer) {                                       // Parquet's footer, before any scan
    setHTML(d, html`n <span class="v">${stat.n.toLocaleString()}</span> · nulls <span class="v">${stat.nulls.toLocaleString()}</span><br><span class="v">${fmtStat(stat.min)}</span> … <span class="v">${fmtStat(stat.max)}</span> <span class="pp-footnote">from the file's footer — scan for mean, sd + quantiles</span>`);
  } else if (stat.kind === 'num') {
    setHTML(d, html`n <span class="v">${stat.n.toLocaleString()}</span> · nulls <span class="v">${stat.nulls.toLocaleString()}</span><br>mean <span class="v">${fmtStat(stat.mean)}</span> · std <span class="v">${fmtStat(stat.std)}</span><br><span class="v">${fmtStat(stat.min)}</span> · p25 <span class="v">${fmtStat(stat.p25)}</span> · p50 <span class="v">${fmtStat(stat.p50)}</span> · p75 <span class="v">${fmtStat(stat.p75)}</span> · <span class="v">${fmtStat(stat.max)}</span>`);
    if (stat.qual) {                                       // detection-limit values were substituted — never silently
      const t = stat.qual, bits = [t.below && `${t.below.toLocaleString()} below detection`, t.above && `${t.above.toLocaleString()} above`, t.code && `${t.code.toLocaleString()} lab codes → blank`].filter(Boolean);
      appendHTML(d, html`<br><span class="pp-footnote">${bits.join(' · ')} — substituted on read</span>`);
    }
    if (stat.centroids && stat.centroids.length && stat.max > stat.min) d.appendChild(sparkline(stat.centroids, stat.total, stat.min, stat.max));
  } else {
    const top = joinH(stat.top.map(([v, n]) => html`${v} <span class="v">${Math.round((100 * n) / (stat.n || 1))}%</span>`), ' · ');
    setHTML(d, html`n <span class="v">${stat.n.toLocaleString()}</span> · distinct <span class="v">${stat.distinct}${stat.overflow ? '+' : ''}</span> · nulls <span class="v">${stat.nulls.toLocaleString()}</span><br>${top}`);
  }
  body.appendChild(d);
}

function sparkline(centroids, total, min, max) {
  const c = document.createElement('canvas'); c.width = 120; c.height = 18; c.className = 'pp-spark';
  const g = c.getContext('2d');
  const N = 24, bins = histogramFromCentroids(centroids, total, min, max > min ? max : min + 1, N);
  let peak = 0; for (let b = 0; b < N; b++) if (bins[b] > peak) peak = bins[b];
  g.fillStyle = tok('--accent');
  for (let b = 0; b < N; b++) { const hp = peak ? Math.round((16 * bins[b]) / peak) : 0; if (hp) g.fillRect(b * 5, 17 - hp, 4, hp); }
  return c;
}

function renderColumnsTab(body, L) {
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
  calcB.onclick = () => openCalcWindow(L, (L.calcCols || []).length ? 0 : -1);
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
      menuXY(x, y, [
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
    appendColStats(body, (L._colStats && L._colStats[name]) || (footer && footer[name]), onCtx);
  }
  // ── ƒ calculated columns (§10.1): row-extensions the filter/scan/record all see ──
  const calc = L.calcCols || [];
  calc.forEach((c, k) => {
    const row = document.createElement('div'); row.className = 'pp-col';
    const fx = document.createElement('span'); fx.className = 'pp-badge'; fx.textContent = 'ƒ';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name; nm.title = c.expr;
    const ty = document.createElement('span'); ty.className = 'ty'; ty.textContent = c.ty === 'string' ? 'text' : 'number';
    row.append(fx, nm, ty);
    const openMenu = (x, y) => menuXY(x, y, [
      { label: 'Edit…', action: () => openCalcWindow(L, k) },
      { label: 'Remove', action: () => { const gone = L.calcCols[k]; pushUndo(`remove ƒ ${gone.name}`, () => { L.calcCols.splice(Math.min(k, L.calcCols.length), 0, gone); L._calcFns = null; L._colStats = null; markProjectDirty(); refreshProps(); }, { redo: () => { const j = L.calcCols.indexOf(gone); if (j >= 0) { L.calcCols.splice(j, 1); L._calcFns = null; L._colStats = null; markProjectDirty(); refreshProps(); } } }); L.calcCols.splice(k, 1); L._calcFns = null; L._colStats = null; markProjectDirty(); renderProps(); } },
    ]);
    const onCtx = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); };
    row.oncontextmenu = onCtx;
    const kb = document.createElement('span'); kb.className = 'pp-kebab'; kb.textContent = '⋮'; kb.title = 'column actions';
    kb.onclick = (e) => { e.stopPropagation(); const r2 = kb.getBoundingClientRect(); openMenu(r2.left - 60, r2.bottom + 2); };
    row.appendChild(kb);
    body.appendChild(row);
    appendColStats(body, L._colStats && L._colStats[c.name], onCtx);
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

// ── the source tab: where the layer's positions come from + what it spans.
// Per kind: delimited get LIVE X/Y/Z mapping selects (re-reads the file, like
// use-as-category); drillholes get the three tables + desurvey method/dip
// (changing re-desurveys) + the validation report; everything shows extent,
// grids their parameters. File info ('i') stays the copyable dump — this is
// the ACTIONABLE per-layer home.
function renderSourceTab(body, L) {
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
      sel.onchange = () => reopenWithMapping(L, { [key]: +sel.value });
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
          reopenDh(L, { mappings: full });
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
    mSel.onchange = () => reopenDh(L, { method: mSel.value });
    mRow.append(mLab, mSel);
    body.appendChild(mRow);
    const dRow = document.createElement('div'); dRow.className = 'pp-row';
    const dLab = document.createElement('label'); dLab.textContent = 'dip';
    const dSel = document.createElement('select');
    for (const [v, t] of [['auto', `auto (${escS(h.dipConvention)})`], ['pos-down', 'positive down'], ['neg-down', 'negative down']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; dSel.appendChild(o);
    }
    dSel.value = (dh.config && dh.config.dipConvention) || 'auto';
    dSel.onchange = () => reopenDh(L, { dipConvention: dSel.value });
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
  if (dmRotationText(h)) line(html`<span class="pp-banner bad" style="display:block">⚠ rotated Datamine model — ${dmRotationText(h)}. micro shows it in the model's own frame and does not rotate it into world coordinates yet: volumes, grades and tonnages are right, positions against other layers (drillholes, topography, solids) are not.</span>`);
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
  if (S.frame) { sec('frame'); line(html`origin <span class="v">${S.frame.origin.map(fm).join(', ')}</span>`); }
}
