// micro — the PLAIN-LANGUAGE BAR (@gcu/dispatch). Alt+K, or ⌘K when no command name matches.
// The hard rule, enforced here rather than merely intended: dispatch **PROPOSES, IT NEVER
// ACTS**. A recognised phrase becomes ONE palette row that spells out the resolved command
// and its arguments (a filter shows the very @gcu/expr expression it will apply); nothing
// runs until you read it and press Enter. A wrong guess costs a glance; a phrase it does not
// know gets no row at all ("I didn't understand" — never a guess).
//
// It is session-trained: the vocabulary is derived from THIS project (its columns, its
// lithologies, its layer names), a corpus is generated from that in English AND Brazilian
// Portuguese, and a perceptron intent-classifier + a structured-perceptron slot-tagger are
// trained IN THE TAB in about a second. No model file, no network, no WASM — it stays
// Sealed, and it cannot be stale, because it is rebuilt from the data in front of you.
// (LLM at authoring time; zero LLM at runtime.)
//
// What it may say, what it must refuse, and phrase → proposal are the PURE half,
// src/nl-core.js (scored in Node by test/micro-nl.test.mjs against the demo project). This
// file is the app half: the project → its description, the target layer, the palette row,
// and what Enter does.
import { applyBlockFilter } from './filter.js';
import { setZExag } from './camera.js';
import { setBg } from './deco.js';
import { openGradeTonnage } from './gt.js';
import { openSwath } from './swath.js';
import { openStats } from './stats.js';
import { openContact, isDhLayer } from './contact.js';
import { openFactors, isBlockModel } from './factors.js';
import { openCrosstab } from './xtab.js';
import { setProjection } from './projection.js';
import { openExportDialog } from './export-dialog.js';
import { openSolidDialog } from './bygeom-ui.js';
import { filterToSelection } from './selection.js';
import { S, activeLayer, requestRender } from './state.js';
import { applyTreeVisibility } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { numericColsOf } from './analysis.js';
import { layerTableHeader } from './records.js';
import { tokenize as nlTokenize, normText as nlNormText } from '../../../ext/dispatch/index.js';
import { trainNl, interpret, sessionVocab } from './nl-core.js';
import { layerHasColumn } from './calc.js';
import { setActiveLayer } from './layers.js';
import { secRange, setSectionWorld } from './section.js';
const $ = (s) => document.querySelector(s);

const nlMsg = (m) => { $('#meta').textContent = m; };
// ON BY DEFAULT since 2026-11-24 — it passed its evaluation gate (test/micro-nl.test.mjs:
// intent accuracy and refusal rate on a held-out corpus in en + pt). Off stays one click
// away (Settings → experimental, Help → About), and an explicit choice is remembered.
export const NL_DEFAULT_ON = true;
const _stored = (() => { try { return localStorage.getItem('micro.nl'); } catch { return null; } })();
export let _nlOn = _stored === null ? NL_DEFAULT_ON : _stored === '1';
export let _nlDispatcher = null, _nlKey = '', _nlBusy = false, _nlStats = null;
let _nl = null;                                                // { dispatcher, vocab, known, stats }
let _nlExclude = null;                                       // held-out probe support only

// ── the project, described without the app (nl-core's input) ──
export function describeSession() {
  const layers = S.layers.map((L) => {
    const hh = layerTableHeader(L) || {}; const mm = hh.mapping || {};
    // micro's block header carries ONE category channel: h.mapping.cat = the column index,
    // h.categories = its value LIST (a flat array)
    const catCol = mm.cat != null && Array.isArray(hh.categories) && hh.categories.length && hh.columns ? hh.columns[mm.cat] : null;
    // the kind a geologist would NAME it by: interval layers draw as points/sticks but are
    // "the drillholes"; a grid shown as a relief surface is still a grid
    const kind = L.dh ? 'dh' : (L.docs && L.docs.gridDoc) ? 'grid' : L.kind;
    return { name: L.name, label: L.label || null, kind, numCols: (numericColsOf(L) || []).map((c) => c.name || c),
      catCol: catCol || null, categories: catCol ? hh.categories.map(String) : [] };
  });
  const groups = []; const gw = (arr) => { for (const nd of arr || []) if (nd && typeof nd === 'object' && nd.group && nd.name) { groups.push(nd.name); gw(nd.children); } }; gw(S.layerTree);
  return { layers, groups };
}

// tool → what it SAYS it will do, and what it does when you press Enter. (a, L, p): the
// canonical args, the resolved target layer, the whole interpretation.
const NL_RUN = {
  'micro.colorBy': (a, L) => ({ say: `Colour by ${a.column}${nlOn(L)}`,
    run: () => { nlFocus(L); const sel = $('#colorBy'); const o = [...sel.options].find((x) => x.textContent === a.column || x.value === a.column); if (!o) return nlMsg(`no column "${a.column}" on ${L ? (L.label || L.name) : 'this layer'}`); sel.value = o.value; sel.dispatchEvent(new Event('change')); } }),
  'micro.filterBlocks': (a, L, p) => ({ say: `Filter:  ${p.expr}${nlOn(L)}`, run: () => { nlFocus(L); $('#filter').value = p.expr; return applyBlockFilter(p.expr, L); } }),
  // filter → selection, then the filter you had comes back: the selection is the result
  'micro.selectBlocks': (a, L, p) => ({ say: `Select where  ${p.expr}${nlOn(L)}`,
    run: async () => {
      if (!L) return;
      nlFocus(L);
      const prev = L.filterExpr || '';
      let said = null;
      try {
        $('#filter').value = p.expr; await applyBlockFilter(p.expr, L);
        // a filter that didn't apply (an expression this layer can't read) leaves the box marked and
        // the OLD mask in place — selecting then would select the previous filter's rows
        if ($('#filter').classList.contains('err')) { said = `select: nothing selected — ${$('#meta').textContent.replace(/^filter: /, '')}`; return; }
        filterToSelection(L, 'replace');
        said = $('#meta').textContent;
      } finally {
        $('#filter').value = prev; await applyBlockFilter(prev, L);
        if (said) $('#meta').textContent = said;
      }
    } }),
  'micro.selectBySolid': (a) => {
    const M = nlLayerByName(a.layer);
    if (!M || !((M.kind === 'mesh' && M.docs.meshDoc && !M.docs.meshDoc.header.soup) || (M.docs && M.docs.gridDoc))) return null;   // what the dialog can use: a context-tier mesh or a grid
    return { say: `Select by solid: ${a.layer}  (opens the dialog)`, run: () => openSolidDialog(M) };
  },
  'micro.clearFilter': (a, L) => ({ say: `Clear the block filter${nlOn(L)}`, run: () => { nlFocus(L); $('#filter').value = ''; return applyBlockFilter('', L); } }),
  'micro.sectionAt': (a) => ({ say: `Section on ${a.axis} at ${a.position}${a.thickness ? `, ${a.thickness} m thick` : ''}`, run: () => nlSectionAt(a.axis, a.position, a.thickness) }),
  'micro.clearSection': () => ({ say: 'Clear the section', run: () => { const m = $('#secMode'); m.value = 'off'; m.dispatchEvent(new Event('input')); } }),
  'micro.setSectionThickness': (a) => ({ say: `Section thickness ${a.thickness} m`, run: () => {
    if ($('#secMode').value === 'off') return nlMsg(`section thickness: there is no section yet — say where (“section at elevation …, ${a.thickness} m thick”)`);
    setSectionWorld({ thickness: +a.thickness, clip: 'slab' });   // a thickness means a slab: front / behind would ignore it
    requestRender();
  } }),
  'micro.setZExag': (a) => ({ say: `Vertical exaggeration ×${a.factor}`, run: () => setZExag(a.factor) }),
  'micro.setBackground': (a) => ({ say: `Background: ${a.color}`, run: () => { const hex = NL_BG[String(a.color).toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : null); if (!hex) return nlMsg(`background: no colour “${a.color}”`); setBg(hex); } }),
  'micro.openGradeTonnage': (a, L) => ({ say: `Grade–tonnage${a.column ? ' of ' + a.column : ''}${nlOn(L)}  (opens the window)`,
    run: () => { if (!L) return; nlFocus(L); openGradeTonnage(L, a.column ? { cfg: nlSeriesCfg(L, 'gt', a.column) } : undefined); } }),
  'micro.openSwath': (a, L) => ({ say: `Swath${a.column ? ' of ' + a.column : ''}${a.axis ? ' along ' + a.axis : ''}${nlOn(L)}  (opens the window)`,
    run: () => {
      if (!L) return; nlFocus(L);
      if (!a.column && !a.axis) return openSwath(L);
      const cfg = a.column ? nlSeriesCfg(L, 'swath', a.column) : { ...((L.analysis && L.analysis.swath) || {}) };
      if (a.axis) { cfg.mode = 'axes'; cfg.axis = { X: 0, Y: 1, Z: 2 }[a.axis]; }
      openSwath(L, { cfg });
    } }),
  'micro.openStats': (a, L, p) => ({ say: `Stats${a.column ? ' of ' + a.column : ''}${p.groupBy ? ' by ' + p.groupBy : ''}${nlOn(L)}  (opens the window)`,
    run: () => {
      if (!L) return; nlFocus(L);
      if (!a.column && !p.groupBy) return openStats(L);
      const cfg = { ...((L.analysis && L.analysis.stats) || {}) };
      if (a.column) cfg.cols = [a.column];
      if (p.groupBy) cfg.groupBy = p.groupBy;
      openStats(L, { cfg });
    } }),
  'micro.openContact': (a, L) => ({ say: `Contact plot${a.column ? ' of ' + a.column : ''}${nlOn(L)}  (opens the window)`,
    run: () => { if (!L) return; nlFocus(L); openContact(L, a.column ? { cfg: nlSeriesCfg(L, 'contact', a.column) } : undefined); } }),
  'micro.openFactors': (a, L) => ({ say: `Reconciliation factors${nlOn(L)}  (opens the window)`, run: () => { if (!L) return; nlFocus(L); openFactors(L); } }),
  'micro.openCrosstab': (a, L, p) => ({ say: `Resource cross-tab${a.column ? ' of ' + a.column : ''}${p.groupBy ? ' by ' + p.groupBy : ''}${nlOn(L)}  (opens the window)`,
    run: () => {
      if (!L) return; nlFocus(L);
      if (!a.column && !p.groupBy) return openCrosstab(L);
      const cfg = { ...((L.analysis && L.analysis.xtab) || {}) };
      if (a.column) cfg.grade = a.column;
      if (p.groupBy) cfg.group = p.groupBy;
      openCrosstab(L, { cfg });
    } }),
  'micro.setProjection': (a) => ({ say: a.mode === 'off' ? 'Projection off — the front surface' : `Projection: ${a.mode} along the line of sight`, run: () => setProjection(a.mode === 'off' ? null : a.mode) }),
  'micro.exportRows': (a, L) => ({ say: `Export rows${nlOn(L, true)}…  (opens the export dialog)`, run: () => { if (!L) return; nlFocus(L); openExportDialog(L); } }),
  'micro.setLayerVisibility': (a) => ({ say: `${a.action === 'hide' ? 'Hide' : 'Show'} ${a.layer}`,
    run: () => {
      const vis = a.action !== 'hide';
      const L = nlLayerByName(a.layer);
      if (L) {
        L.visible = vis; applyTreeVisibility(); renderLayers(); requestRender();   // renderLayers → the tree checkbox updates too
        const hidden = vis ? nlHiddenAncestors(L.id) : [];
        if (hidden.length) nlMsg(`${a.layer} is on, but its group ${hidden.map((g) => `“${g}”`).join(' › ')} is hidden — show the group to see it`);
        return;
      }
      const g = nlFindGroup(a.layer);
      if (g) { g.visible = vis; applyTreeVisibility(); renderLayers(); requestRender(); return; }
      nlMsg(`no layer or group "${a.layer}"`);
    } }),
};

// the background names the bar can say → Settings' scene colours (deco.js's list)
const NL_BG = { basalt: '#121212', dark: '#121212', escuro: '#121212', black: '#000000', preto: '#000000', white: '#ffffff', branco: '#ffffff', paper: '#f4f2ec', papel: '#f4f2ec', auto: 'auto', theme: 'auto', default: 'auto', padrao: 'auto', 'padrão': 'auto' };

// an analysis window's saved setup with its FIRST series pointed at a column — the window
// opens configured (the "Run" stays yours, as for a recipe)
export function nlSeriesCfg(L, key, col) {
  const saved = (L.analysis && L.analysis[key]) || {};
  let s0 = (saved.series && saved.series[0]) || {};
  // the saved first series' FILTER and UNIT belong to its column: pointing the series at another
  // column kept them ("grade tonnage for AU" after a CU series filtered to oxide: AU, oxide-only, in %)
  if (s0.col && s0.col !== col) { const { filter, unit, ...rest } = s0; s0 = rest; }
  const gu = L.gtUnits || {};
  const w0 = gu.weight === '#const' ? (gu.densConst != null ? String(gu.densConst) : '') : (gu.weight || '');
  return { ...saved, series: [{ ...s0, layer: L.name, col, unit: s0.unit || gu.grade || '', weight: s0.weight != null ? s0.weight : (key === 'gt' ? w0 : '') }] };
}

function nlSectionAt(axis, position, thickness) {
  // WORLD coordinates, like the host API: the slider is frame-local, so going
  // through setSectionWorld (not #secPos directly) keeps "z 500" at z 500.
  const s = setSectionWorld({ axis: String(axis).toLowerCase(), position: +position, ...(thickness ? { thickness: +thickness } : {}) });
  // the plane is clamped to the data; say so instead of silently moving it
  if (s && Math.abs(s.position - position) > 1e-6 * Math.max(1, Math.abs(position))) {
    const [lo, hi] = secRange(), off = S.frame ? S.frame.origin[{ X: 0, Y: 1, Z: 2 }[axis]] : 0;
    const f = (v) => (+v.toFixed(2)).toString();
    $('#meta').textContent = `section: ${axis} ${f(position)} is outside the data (${f(lo + off)} to ${f(hi + off)}) — placed at ${f(s.position)}`;
  }
  requestRender();
}

// The vocabulary IS the session: the WHOLE project's columns, categories and layers.
// Scoping columns to the active layer would have been the easy dodge — it makes "colour by
// FE" unsayable while the copper model is active — but the project is the thing you are
// working on, not one layer of it. So the vocabulary spans every layer, a phrase may NAME
// its layer ("colour iron_model by FE"), and when it doesn't, nlResolveTarget() decides.
// The proposal always says which layer it will touch.
// The vocabulary depends on the LAYER SET, not on which one is active — so switching the
// active layer costs nothing (the target is resolved per phrase, not per model).
function nlSessionKey() {
  const gs = []; const gw = (arr) => { for (const nd of arr || []) if (nd && typeof nd === 'object' && nd.group) { gs.push(nd.name); gw(nd.children); } }; gw(S.layerTree);
  const d = describeSession();
  return d.layers.map((l) => `${l.name}:${l.label || ''}:${l.kind}:${l.numCols.join(',')}:${l.catCol || ''}:${l.categories.join(',')}`).join('|') + '#' + gs.join(',');
}

let _nlTraining = null;                                       // the in-flight training (callers wait on it, not on null)
export async function nlEnsureTrained() {
  const key = nlSessionKey();
  if (_nlDispatcher && _nlKey === key) return _nlDispatcher;
  if (_nlBusy && _nlTraining) { await _nlTraining; return nlEnsureTrained(); }   // a newer key than the one training: go again
  _nlBusy = true;
  let done; _nlTraining = new Promise((r) => { done = r; });
  try {
    await new Promise((r) => setTimeout(r));                              // let the palette paint "learning…"
    const t0 = performance.now();
    // exclude is the CONTAMINATION GUARD: a held-out probe passes its own utterances so
    // they can never be trained on. Production passes nothing.
    _nl = trainNl(describeSession(), { exclude: _nlExclude });
    _nlDispatcher = _nl.dispatcher; _nlKey = key;
    _nlStats = { ..._nl.stats, ms: Math.round(performance.now() - t0) };
    return _nlDispatcher;
  } catch (e) {
    console.warn('[nl] training failed', e);
    _nlDispatcher = null; _nl = null;
    return null;
  } finally { _nlBusy = false; _nlTraining = null; done(); }
}

// WHICH LAYER does a phrase mean? Commands act on ONE layer, but a project holds many.
// Resolution, in order:
//   1. the phrase NAMES a layer (the tagger marks it LAYER)      → that one
//   2. the active layer, if it can do this and has the column     → "what I'm looking at"
//   3. exactly one layer that can do this has that column         → that one, and say so
//   4. exactly one layer can do this at all (contact → the holes) → that one
//   5. otherwise the active layer (run() will say what's missing)
// The proposal NAMES the target when more than one layer is open, so you read which model
// you are about to touch before you press Enter.
function nlLayerFromTags(q, tags) {
  if (!tags) return null;
  const toks = nlTokenize(q);
  const span = [];
  for (let i = 0; i < toks.length && i < tags.length; i++) if (tags[i] === 'LAYER') span.push(toks[i]);
  if (!span.length) return null;
  // Match the SAME synonyms the vocabulary was built from — exactly, as tokens (diacritics folded,
  // a leading article dropped). Splitting names into fragments made "model" match every
  // *_model.csv; matching only the label missed "the drillholes" / "os furos" (sweep 2026-11-25).
  const ART = /^(the|a|an|o|os|a|as)\s+/;
  const norm = (t) => nlTokenize(String(t)).join(' ').replace(ART, '').trim();
  const text = norm(span.join(' '));
  if (!text) return null;
  const V = _nl && _nl.vocab && _nl.vocab.layers ? _nl.vocab.layers : {};
  const hits = new Set();
  for (const L of S.layers) {
    const nm = L.label || L.name;
    const syns = [nm, nm.replace(/\.[a-z0-9]+$/i, ''), ...(V[nm] || [])];
    if (syns.some((sy) => norm(sy) === text)) hits.add(L);
  }
  return hits.size === 1 ? [...hits][0] : null;                // 0 hits or AMBIGUOUS → don't guess
}

// what each tool can act on (a regular block model for the lattice analyses, the holes for
// a downhole contact plot); absent = any layer
const NL_CAN = {
  'micro.openSwath': (L) => isBlockModel(L), 'micro.openCrosstab': (L) => isBlockModel(L), 'micro.openFactors': (L) => isBlockModel(L),
  'micro.openContact': (L) => isDhLayer(L),                // (wrapped: these are read when called, not while the module loads)
  'micro.openGradeTonnage': (L) => isBlockModel(L) || isDhLayer(L),
  'micro.openStats': (L) => !!layerTableHeader(L), 'micro.exportRows': (L) => !!layerTableHeader(L),
  'micro.filterBlocks': (L) => !!layerTableHeader(L), 'micro.selectBlocks': (L) => !!layerTableHeader(L),
};

function nlResolveTarget(q, tags, column, name) {
  const can = NL_CAN[name] || (() => true);
  const named = nlLayerFromTags(q, tags);
  if (named) return can(named) ? named : { cannot: named };   // NAMED but unable ("export the topography"): say so, don't switch layers
  const has = (L) => !column || layerHasColumn(column, L.label || L.name) || layerHasColumn(column, L.name);   // (column, layer) — that order
  const A = activeLayer();
  if (A && can(A) && has(A)) return A;
  const able = S.layers.filter(can);
  const have = able.filter(has);
  if (have.length === 1) return have[0];
  if (have.length > 1 && column) return A && have.includes(A) ? A : have[0];
  if (able.length === 1) return able[0];
  return A;
}

// name the layer in the proposal whenever the project holds more than one
const nlOn = (L, always) => ((S.layers.length > 1 || always) && L ? ` on ${L.label || L.name}` : '');

// act on the resolved layer: micro's controls follow the ACTIVE layer, so make it active first
function nlFocus(L) { if (L && L.id !== S.activeId) setActiveLayer(L.id); }

// is `col` a numeric column of L (the ones an analysis window can plot)?
function nlIsNumeric(L, col) {
  const c = String(col).toLowerCase();
  return (numericColsOf(L) || []).some((x) => String(x.name || x).toLowerCase() === c);
}

function nlLayerByName(name) { return S.layers.find((x) => (x.label || x.name) === name || x.name === name) || null; }

// the names of the hidden groups a layer sits inside (outermost first)
function nlHiddenAncestors(id) {
  const out = [];
  const walk = (arr, path) => { for (const nd of arr || []) { if (nd && typeof nd === 'object' && nd.group) { if (walk(nd.children, [...path, nd])) return true; } else if (nd === id || (nd && nd.id === id)) { out.push(...path.filter((g) => g.visible === false).map((g) => g.name)); return true; } } return false; };
  walk(S.layerTree, []);
  return out;
}

// resolve a GROUP node by name (case-insensitive) — groups are visibility targets too
function nlFindGroup(name) {
  const want = String(name).toLowerCase(); let found = null;
  const walk = (arr) => { for (const nd of arr || []) { if (found) return; if (nd && typeof nd === 'object' && nd.group) { if ((nd.name || '').toLowerCase() === want) { found = nd; return; } walk(nd.children); } } };
  walk(S.layerTree); return found;
}

const NL_VERB = { 'micro.filterBlocks': 'filter', 'micro.selectBlocks': 'select', 'micro.selectBySolid': 'select by solid', 'micro.colorBy': 'colour', 'micro.sectionAt': 'section', 'micro.clearSection': 'clear section', 'micro.setSectionThickness': 'section', 'micro.setZExag': 'z-exag', 'micro.setBackground': 'background', 'micro.openGradeTonnage': 'grade–tonnage', 'micro.clearFilter': 'clear filter', 'micro.openSwath': 'swath', 'micro.openStats': 'stats', 'micro.openContact': 'contact plot', 'micro.openFactors': 'factors', 'micro.openCrosstab': 'cross-tab', 'micro.setProjection': 'projection', 'micro.exportRows': 'export rows' };

// the structured breakdown of a resolved call — labelled chips ("column: FE", "on:
// deposit.csv") so a full phrase shows exactly what was understood, not just prose.
function nlBreakdown(name, args, L, p) {
  const out = [];
  out.push({ k: '', v: name === 'micro.setLayerVisibility' ? (args.action === 'hide' ? 'hide' : 'show') : (NL_VERB[name] || name) });
  if (name === 'micro.filterBlocks' || name === 'micro.selectBlocks') {
    (args.clauses || []).forEach((cl, i) => {
      if (i) out.push({ k: '', v: args.join || 'and' });
      out.push({ k: cl.column, v: `${cl.op} ${typeof cl.value === 'string' ? '“' + cl.value + '”' : cl.value}` });
    });
  } else if (args.column) out.push({ k: 'column', v: args.column });
  if (args.axis != null) { out.push({ k: 'axis', v: args.axis }); if (args.position != null) out.push({ k: 'at', v: args.position }); }
  if (args.thickness != null) out.push({ k: 'thick', v: `${args.thickness} m` });
  if (args.factor != null) out.push({ k: 'factor', v: `×${args.factor}` });
  if (args.color) out.push({ k: 'colour', v: args.color });
  if (args.mode) out.push({ k: 'mode', v: args.mode });
  if (p && p.groupBy) out.push({ k: 'by', v: p.groupBy });
  if (args.layer) out.push({ k: '', v: args.layer });
  if (L && NL_CAN[name] !== undefined || (L && name === 'micro.colorBy')) out.push({ k: 'on', v: L.label || L.name });
  return out;
}

// A phrase → ONE proposal row. NEVER runs anything.
// the session the bar was trained on is still the project's? (a layer opened, closed, renamed,
// a column added — the vocabulary is out of date and the bar retrains before it proposes)
export const nlStale = () => !!_nlDispatcher && _nlKey !== nlSessionKey();

export function nlPropose(q) {
  if (!_nlOn || !_nl || !_nlDispatcher || q.length < 3) return null;
  if (nlStale()) { nlEnsureTrained(); return null; }                     // never propose from an old project's vocabulary
  const p = interpret(_nl, q);
  if (!p) return null;                                                   // refused / not understood → no row
  const mk = NL_RUN[p.name];
  if (!mk) return null;                                                  // declared but unwired → say nothing
  const col = p.args.column || (p.args.clauses && p.args.clauses[0] && p.args.clauses[0].column) || null;
  let target = nlResolveTarget(p.q || q, p.tags, col, p.name);
  if (target && target.cannot) return null;                              // the phrase named a layer this can't act on
  // a CATEGORY column where the window needs a number: stats and the cross-tab GROUP by it
  // ("stats by lithology" — en kept it as the column, pt as groupBy); grade–tonnage, swath and
  // the contact plot can't use it, so they propose nothing rather than a broken window
  if (p.args.column && target && !nlIsNumeric(target, p.args.column)) {
    if (p.name === 'micro.openStats' || p.name === 'micro.openCrosstab') { p.groupBy = p.groupBy || p.args.column; p.args = { ...p.args }; delete p.args.column; }
    else if (p.name === 'micro.openGradeTonnage' || p.name === 'micro.openSwath' || p.name === 'micro.openContact') return null;
  }
  let act = null;
  try { act = mk(p.args, target, p); } catch { return null; }
  if (!act || !act.say) return null;
  return { id: 'nl:' + p.name, group: 'suggested', title: act.say, nl: true, expr: p.expr || null, name: p.name, args: p.args,
    breakdown: nlBreakdown(p.name, p.args, target, p), run: () => act.run() };
}

// completion vocab keywords (verbs / operators / axis words, en + pt) — the closed classes
// the gazetteer doesn't carry as column/category/layer synonyms.
const NL_VERBS = ['color', 'colour', 'filter', 'select', 'show', 'hide', 'only', 'clear', 'keep', 'section', 'elevation', 'easting', 'northing', 'bench', 'thickness', 'grade', 'tonnage', 'background', 'exaggeration', 'exaggerate', 'above', 'below', 'over', 'under', 'greater', 'less', 'swath', 'stats', 'statistics', 'contact', 'factors', 'cross-tab', 'projection', 'export', 'inside',
  'colorir', 'filtrar', 'selecionar', 'mostrar', 'esconder', 'seção', 'cota', 'espessura', 'acima', 'abaixo', 'maior', 'menor', 'estatísticas', 'contato', 'fatores', 'projeção', 'exportar', 'dentro', 'fundo'];

// example phrases for an EMPTY Alt+K, instantiated from THIS session (real columns, a real
// category value, a real group/layer) — discovery + a template you can edit.
export function nlStarters() {
  const V = sessionVocab(describeSession());
  const col = Object.keys(V.numCols)[0];
  const catCol = Object.keys(V.catValues)[0]; const catVal = catCol && Object.keys(V.catValues[catCol])[0];
  let grp = null; for (const nd of S.layerTree || []) if (!grp && nd && typeof nd === 'object' && nd.group && nd.name) grp = nd.name;
  const lay = S.layers[0] && (S.layers[0].label || S.layers[0].name);
  const solid = S.layers.find((L) => L.kind === 'mesh');
  const s = [];
  if (col) { s.push(`colour by ${col}`); s.push(catVal ? `blocks above 50 ${col} in ${String(catVal).toLowerCase()}` : `${col} > 60`); }
  if (catVal) s.push(`only ${String(catVal).toLowerCase()}`);
  if (col) s.push(`select ${col} > 60`);
  if (solid) s.push(`select inside ${solid.label || solid.name}`);
  if (grp || lay) s.push(`hide ${grp || lay}`);
  { const b = S.docBbox, oz = S.frame ? S.frame.origin[2] : 0;                // the data's middle, rounded
    const zm = b ? Math.round(((b[2] + b[5]) / 2 + oz) / 10) * 10 : null;
    if (Number.isFinite(zm)) s.push(`section at elevation ${zm}`); }
  if (col) { s.push(`swath of ${col} along x`); s.push(`stats for ${col}${catCol ? ' by ' + catCol : ''}`); s.push(`grade tonnage for ${col}`); }
  if (col) s.push(`colorir por ${col}`);
  return s.map((t) => ({ id: 'nlstart:' + t, group: '', title: t, hint: 'example', fill: t }));
}

// complete the CURRENT (last) word against the session vocabulary + the verb list. A closed
// candidate set → nothing to hallucinate; picking one replaces the word.
export function nlComplete(raw) {
  const frag = ((raw.match(/(\S*)$/) || [])[1] || '').toLowerCase();
  if (frag.length < 1) return [];
  const V = sessionVocab(describeSession());
  const seen = new Set(), out = [];
  const push = (disp, kind) => { const d = String(disp), key = d.toLowerCase(); if (key.startsWith(frag) && key !== frag && !seen.has(key)) { seen.add(key); out.push({ d, kind }); } };
  for (const c of Object.keys(V.numCols)) { push(c, 'column'); for (const sy of V.numCols[c].syn || []) push(sy, 'column'); }
  for (const col of Object.keys(V.catValues)) for (const val of Object.keys(V.catValues[col])) for (const sy of V.catValues[col][val]) push(sy, 'value');
  for (const f of Object.keys(V.layers)) for (const sy of V.layers[f]) push(sy, 'layer');
  for (const w of NL_VERBS) push(w, 'word');
  out.sort((a, b) => a.d.length - b.d.length || a.d.localeCompare(b.d));
  const prefix = raw.slice(0, raw.length - frag.length);
  return out.slice(0, 8).map((o) => ({ id: 'nlcomp:' + o.d, group: '', title: o.d, hint: o.kind, fill: prefix + o.d + ' ' }));
}

export function nlSetEnabled(on) {
  _nlOn = !!on;
  try { localStorage.setItem('micro.nl', _nlOn ? '1' : '0'); } catch { /* private mode: this session only */ }
  if (!_nlOn) { _nlDispatcher = null; _nl = null; _nlKey = ''; }
  nlMsg(_nlOn ? 'plain-language bar ON — Alt+K asks in plain words (en / pt); ⌘K falls back to it when no command name matches. It proposes; Enter runs.' : 'plain-language bar off');
}

// for the smokes: the last training's numbers, and phrases held OUT of the next one
export function nlStats() { return _nlStats; }

export function nlHoldOut(texts) { _nlExclude = texts ? new Set(texts.map(nlNormText)) : null; _nlDispatcher = null; _nl = null; _nlKey = ''; }
