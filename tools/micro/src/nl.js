// micro — EXPERIMENTAL: the natural-language command bar (@gcu/dispatch).
// OFF BY DEFAULT. Enabled from Help → About. The hard rule, enforced here rather
// than merely intended: dispatch **PROPOSES, IT NEVER ACTS**. A recognised phrase
// becomes ONE palette row that spells out the resolved command and its arguments;
// nothing runs until you read it and press Enter. A wrong guess costs a glance.
//
// It is session-trained: the vocabulary is derived from THIS project (its columns,
// its lithologies, its layer names), a corpus is generated from that, and a
// perceptron intent-classifier + a structured-perceptron slot-tagger are trained
// IN THE TAB in about a second. No model file, no network, no WASM — it stays
// Sealed, and it cannot be stale, because it is rebuilt from the data in front of
// you. (LLM at authoring time; zero LLM at runtime.)
import { applyBlockFilter } from './filter.js';
import { setZExag } from './camera.js';
import { setBg } from './deco.js';
import { openGradeTonnage } from './gt.js';
import { S, activeLayer, requestRender } from './state.js';
import { applyTreeVisibility } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { numericColsOf } from './analysis.js';
import { layerTableHeader } from './records.js';
import { deriveVocab as nlDeriveVocab, normText as nlNormText, tokenize as nlTokenize, trainSession as nlTrainSession } from '../../../ext/dispatch/index.js';
import { layerHasColumn } from './calc.js';
import { setActiveLayer } from './layers.js';
import { secRange } from './section.js';
const $ = (s) => document.querySelector(s);

const nlMsg = (m) => { $('#meta').textContent = m; };
export let _nlOn = localStorage.getItem('micro.nl') === '1';
export let _nlDispatcher = null, _nlKey = '', _nlBusy = false, _nlStats = null;
let _nlExclude = null;                                       // held-out probe support only

// The tools it may propose — DECLARATIONS ONLY, each one wired below. If a verb
// is not in this list it cannot be uttered, which is the point.
const NL_TOOLS = [
  { name: 'micro.colorBy', kind: 'column-pick', argName: 'column', pools: ['numeric', 'categorical'],
    frames: ['color the model by {col}', 'color by {col}', 'paint the blocks by {col}', 'color the model with the {col} column', 'show {col} on the model', 'map {col}', 'display {col}', 'color everything by {col}', 'put {col} on the color ramp', 'color the blocks with {col}', 'shade by {col}', 'set the colour to {col}', 'ramp on {col}'] },
  { name: 'micro.filterBlocks', kind: 'comparison-filter', nouns: ['blocks', 'the blocks', 'the model'] },
  { name: 'micro.clearFilter', kind: 'no-arg',
    frames: ['clear the filter', 'remove the filter', 'reset the filter', 'drop all filters', 'unfilter', 'clear filters', 'remove all the filters', 'take the filter off', 'no filter', 'filter off', 'clear the block filter', 'reset filters'] },
  { name: 'micro.sectionAt', kind: 'axis-position', axes: { X: ['x', 'easting', 'east-west'], Y: ['y', 'northing', 'north-south'], Z: ['z', 'elevation', 'level', 'bench', 'rl'] } },
  { name: 'micro.clearSection', kind: 'no-arg',
    frames: ['clear the section', 'close the section', 'remove the section', 'no section', 'take out the section', 'section off', 'drop the section', 'get rid of the section', 'full model again, no section', 'stop sectioning', 'remove the slab', 'clear the slice'] },
  // a THICKNESS always carries a thickness word (thick / slab / thickness); a POSITION
  // carries a place word (at / on). Both are numbers near "section" — the words are what
  // tell them apart, so each set must be unambiguous on its own.
  { name: 'micro.setSectionThickness', kind: 'number-arg', argName: 'thickness', values: [5, 10, 15, 20, 25, 30, 40, 50, 75, 100],
    frames: ['make the section {n} meters thick', 'section thickness {n}', 'set the slab to {n} m', '{n} meter thick section', 'thicken the section to {n}', 'slab thickness {n} meters', 'make the slab {n} m thick', 'section {n} m thick'] },
  { name: 'micro.setZExag', kind: 'number-arg', argName: 'factor', values: [1, 1.5, 2, 2.5, 3, 4, 5, 10], wordNumbers: true,
    frames: ['exaggerate z by {n}', 'vertical exaggeration {n}', 'z exaggeration {n}', 'set z exag to {n}', 'stretch the vertical by {n}', '{n}x vertical', 'make the z scale {n}', 'exaggerate the vertical by {n}'] },
  { name: 'micro.setBackground', kind: 'lexicon-pick', argName: 'color',
    values: { basalt: ['basalt', 'the default background', 'dark grey', 'dark'], black: ['black'], white: ['white'], paper: ['paper', 'off-white'] },
    frames: ['{val} background', 'set the background to {val}', 'make the background {val}', 'put the background {val}', 'background {val}', 'change the background to {val}', 'make it {val}', 'go {val}'] },
  { name: 'micro.openGradeTonnage', kind: 'column-pick', argName: 'column', optional: true,
    frames: ['grade tonnage for {col}', 'open the grade tonnage for {col}', 'GT curve on {col}', 'grade-tonnage of {col}', 'tonnage curve for {col}', 'tonnage above cutoff for {col}', 'grade and tonnage on {col}'] },
  { name: 'micro.setLayerVisibility', kind: 'layer-action' },
];

// The refusal bank. micro trained WITHOUT one, which is why "delete the block model"
// proposed an action — a destructive verb has to be REFUSED, and refusal is learned
// from examples like anything else. (This bank is the lab's, authored long before any
// of it was measured.) Destructive verbs get paraphrase DEPTH on purpose: they are the
// one class where a confident misread would be unforgivable.
const NL_REFUSALS = [
  'what is the average iron grade', 'compute the mean FE', 'how many blocks are there',
  'export the model to csv', 'save the project', 'run a variogram', 'krige the AU',
  'add the drillholes', 'measure the distance between those points', 'print a report',
  'what does LOI mean', 'change the block size', 'reproject to UTM', 'open the last project',
  'sum the tonnage above cutoff', 'what is a variogram', 'estimate the gold',
  'composite the assays', 'what does itabirite mean',
  'delete the block model', 'delete the model', 'delete the topography', 'delete this layer',
  'erase the block model', 'erase the drillholes', 'destroy the pit design', 'wipe the project',
  'remove the model from disk', 'drop the database', 'format the drive', 'overwrite the file',
  'email this to my boss', 'upload it to the server', 'make me a cup of tea',
];

// tool → what it SAYS it will do, and what it does when you press Enter.
const NL_RUN = {
  'micro.colorBy': (a, L) => ({ say: `Colour by ${a.column}${nlOn(L)}`,
    run: () => { nlFocus(L); const sel = $('#colorBy'); const o = [...sel.options].find((x) => x.textContent === a.column || x.value === a.column); if (!o) return nlMsg(`no column "${a.column}" on ${L ? (L.label || L.name) : 'this layer'}`); sel.value = o.value; sel.dispatchEvent(new Event('change')); } }),
  'micro.filterBlocks': (a, L) => { const e = nlClausesToExpr(a.clauses); return { say: `Filter blocks:  ${e}${nlOn(L)}`, run: () => { nlFocus(L); $('#filter').value = e; applyBlockFilter(e); } }; },
  'micro.clearFilter': (a, L) => ({ say: `Clear the block filter${nlOn(L)}`, run: () => { nlFocus(L); $('#filter').value = ''; applyBlockFilter(''); } }),
  'micro.sectionAt': (a) => ({ say: `Section on ${a.axis} at ${a.position}`, run: () => nlSectionAt(a.axis, a.position) }),
  'micro.clearSection': () => ({ say: 'Clear the section', run: () => { const m = $('#secMode'); m.value = 'off'; m.dispatchEvent(new Event('input')); } }),
  'micro.setSectionThickness': (a) => ({ say: `Section thickness ${a.thickness} m`, run: () => { const h = $('#secHalf'); h.value = a.thickness / 2; h.dispatchEvent(new Event('input')); } }),
  'micro.setZExag': (a) => ({ say: `Vertical exaggeration ×${a.factor}`, run: () => setZExag(a.factor) }),
  'micro.setBackground': (a) => ({ say: `Background: ${a.color}`, run: () => setBg(a.color) }),
  'micro.openGradeTonnage': (a, L) => ({ say: `Grade–tonnage${a.column ? ' for ' + a.column : ''}${nlOn(L)}`, run: () => { if (L) { nlFocus(L); openGradeTonnage(L, a.column || null); } } }),
  'micro.setLayerVisibility': (a) => ({ say: `${a.action === 'hide' ? 'Hide' : 'Show'} ${a.layer}`,
    run: () => {
      const vis = a.action !== 'hide';
      const L = S.layers.find((x) => (x.label || x.name) === a.layer || x.name === a.layer);
      if (L) { L.visible = vis; applyTreeVisibility(); renderLayers(); requestRender(); return; }   // renderLayers → the tree checkbox updates too
      const g = nlFindGroup(a.layer);
      if (g) { g.visible = vis; applyTreeVisibility(); renderLayers(); requestRender(); return; }
      nlMsg(`no layer or group "${a.layer}"`);
    } }),
};

// dispatch hands back CANONICAL args (clauses arrays, real booleans) → @gcu/expr text
function nlClausesToExpr(clauses) {
  return (clauses || []).map((c) => {
    const v = typeof c.value === 'string' && !/^-?\d/.test(c.value) ? JSON.stringify(c.value) : c.value;
    return `${c.column} ${c.op} ${v}`;
  }).join(' and ');
}

function nlSectionAt(axis, position) {
  const mode = axis === 'Z' ? 'plan' : axis === 'X' ? 'ns' : 'ew';       // X → an east-facing (N–S) plane
  const m = $('#secMode'); m.value = mode; m.dispatchEvent(new Event('input'));
  const [lo, hi] = secRange();
  $('#secPos').value = hi > lo ? Math.max(0, Math.min(1, (position - lo) / (hi - lo))) : 0.5;
  $('#secPos').dispatchEvent(new Event('input'));
  requestRender();
}

// The vocabulary IS the session: the WHOLE project's columns, categories and layers.
// Scoping columns to the active layer would have been the easy dodge — it makes
// "colour by FE" unsayable while the copper model is active — but the project is
// the thing you are working on, not one layer of it. So the vocabulary spans every
// layer, a phrase may NAME its layer ("colour iron_model by FE"), and when it
// doesn't, nlResolveTarget() decides (active → the only layer with that column).
// The proposal always says which layer it will touch.
//
// The ranges are FIXED, deliberately: rampRangeFor() is a DISPLAY artifact that may
// or may not have been computed yet, so feeding it here made the training corpus —
// and therefore the weights, and therefore the answers — depend on what the UI
// happened to have done. dispatch itself is fully seeded; the instability was mine.
// A range only shapes the example numbers in generated utterances, and the tagger
// learns "a number after an operator is a value", so magnitudes barely matter while
// STABILITY matters a great deal.
function nlSessionVocab() {
  const numCols = {}, catCols = {}, catValues = {}, layers = {};
  for (const L of S.layers) {
    const nm = L.label || L.name;
    const bare = nm.replace(/\.[a-z0-9]+$/i, '');            // "drillholes.csv" → "drillholes"
    const byKind = {
      blocks: ['the model', 'the block model', 'the blocks'],
      points: ['the points', 'the cloud'],
      dh: ['the drillholes', 'the holes', 'the drilling'],
      mesh: ['the mesh', 'the surface'],
      grid: ['the grid', 'the surface'],
      table: ['the table'],
    }[L.kind] || [];
    // ALWAYS ≥2 synonyms: layer-action's generator picks one that is NOT the filename,
    // so a lone-synonym layer would generate "hide undefined" into the corpus.
    const syns = [...new Set([nm.toLowerCase(), bare.toLowerCase(), `the ${bare.toLowerCase()}`, ...byKind])].filter(Boolean);
    layers[nm] = syns;
    for (const c of numericColsOf(L) || []) numCols[c.name || c] = { lo: 0, hi: 100, dec: 2 };
    // micro's block header carries ONE category channel: h.mapping.cat = the column
    // index, h.categories = its value LIST (a flat array, NOT a {col:dict} object —
    // Object.entries on the array was producing "0"→"HEMATITE" garbage → no cat vocab).
    const hh = layerTableHeader(L) || {}; const mm = hh.mapping || {};
    if (mm.cat != null && Array.isArray(hh.categories) && hh.categories.length && hh.columns) {
      const catName = hh.columns[mm.cat];
      if (catName) {
        catCols[catName] = [...new Set([catName.toLowerCase(), ...(catCols[catName] || [])])];
        catValues[catName] = catValues[catName] || {};
        for (const v of hh.categories) if (v) catValues[catName][String(v)] = [String(v).toLowerCase()];
      }
    }
  }
  // groups are addressable targets too ("hide mining phases") — walk the tree and add
  // each group NAME (keyed by name; resolved in NL_RUN.setLayerVisibility via nlFindGroup).
  const addGroups = (arr) => { for (const nd of arr || []) { if (nd && typeof nd === 'object' && nd.group && nd.name) {
    const gl = String(nd.name).toLowerCase(), last = gl.split(/\s+/).pop();
    layers[nd.name] = [...new Set([gl, `the ${gl}`, ...(last && last !== gl ? [`the ${last}`] : [])])];
    addGroups(nd.children);
  } } };
  addGroups(S.layerTree);
  return { numCols, catCols, catValues, layers, idCols: [] };
}

// …so switching the active layer re-derives the vocabulary (a ~0.9 s retrain, lazily,
// the next time you actually use the bar).
// The vocabulary depends on the LAYER SET, not on which one is active — so switching
// the active layer costs nothing (the target is resolved per phrase, not per model).
function nlSessionKey() {
  const gs = []; const gw = (arr) => { for (const nd of arr || []) if (nd && typeof nd === 'object' && nd.group) { gs.push(nd.name); gw(nd.children); } }; gw(S.layerTree);
  return S.layers.map((L) => `${L.id}:${L.label || L.name}:${(numericColsOf(L) || []).length}`).join('|') + '#' + gs.join(',');
}

export async function nlEnsureTrained() {
  const key = nlSessionKey();
  if (_nlDispatcher && _nlKey === key) return _nlDispatcher;
  if (_nlBusy) return null;
  _nlBusy = true;
  try {
    await new Promise((r) => setTimeout(r));                              // let the palette paint "training…"
    const t0 = performance.now();
    const vocab = nlDeriveVocab(nlSessionVocab());
    // excludeTexts is the CONTAMINATION GUARD: a held-out probe passes its own
    // utterances so they can never be trained on. Production passes nothing.
    const { dispatcher, stats } = nlTrainSession({ vocab, tools: NL_TOOLS, seed: 42,
      extraRefusals: NL_REFUSALS, excludeTexts: _nlExclude });
    _nlDispatcher = dispatcher; _nlKey = key;
    _nlStats = { ...stats, ms: Math.round(performance.now() - t0) };
    return dispatcher;
  } catch (e) {
    console.warn('[nl] training failed', e);
    _nlDispatcher = null;
    return null;
  } finally { _nlBusy = false; }
}

// WHICH LAYER does a phrase mean?
// Commands act on ONE layer, but a project holds many — and the vocabulary spans
// all of them, so "colour by FE" is sayable while the copper model is active.
// Resolution, in order:
//   1. the phrase NAMES a layer (the tagger marks it LAYER) → that one
//   2. the active layer, if it has the column                → "what I'm looking at"
//   3. exactly one layer HAS that column                     → that one, and say so
//   4. otherwise the active layer (run() will say what's missing)
// The proposal always NAMES the target when more than one layer is open, so you
// read which model you are about to touch before you press Enter.
function nlLayerFromTags(q, tags) {
  if (!tags) return null;
  const toks = nlTokenize(q);
  const span = [];
  for (let i = 0; i < toks.length && i < tags.length; i++) if (tags[i] === 'LAYER') span.push(toks[i]);
  if (!span.length) return null;
  const text = span.join(' ').toLowerCase().trim();
  // Match the SAME synonyms the vocabulary was built from — exactly. (Splitting
  // names into fragments made "model" match every *_model.csv, so the first layer
  // always won and "colour copper_model by CU" resolved to iron_model.)
  const hits = [];
  for (const L of S.layers) {
    const nm = (L.label || L.name);
    const syns = [nm.toLowerCase(), nm.toLowerCase().replace(/\.[a-z0-9]+$/, '')];
    if (syns.some((sy) => sy === text) || text === nm.toLowerCase()) hits.push(L);
  }
  if (hits.length === 1) return hits[0];
  // 0 hits, or AMBIGUOUS ("the model", with two block models open) → do not guess;
  // let the column decide, and failing that, the active layer.
  return null;
}

function nlResolveTarget(q, tags, column) {
  const named = nlLayerFromTags(q, tags);
  if (named) return named;
  const A = activeLayer();
  if (!column) return A;
  const has = (L) => layerHasColumn(column, L.label || L.name) || layerHasColumn(column, L.name);   // (column, layer) — that order
  if (A && has(A)) return A;
  const have = S.layers.filter(has);
  if (have.length === 1) return have[0];                     // only one layer HAS it → obviously that one
  return A;                                                  // absent everywhere, or ambiguous → active; run() says what's missing
}

// name the layer in the proposal whenever the project holds more than one
const nlOn = (L) => (S.layers.length > 1 && L ? ` on ${L.label || L.name}` : '');

// act on the resolved layer: micro's controls follow the ACTIVE layer, so make it active first
function nlFocus(L) { if (L && L.id !== S.activeId) setActiveLayer(L.id); }

// resolve a GROUP node by name (case-insensitive) — groups are visibility targets too
function nlFindGroup(name) {
  const want = String(name).toLowerCase(); let found = null;
  const walk = (arr) => { for (const nd of arr || []) { if (found) return; if (nd && typeof nd === 'object' && nd.group) { if ((nd.name || '').toLowerCase() === want) { found = nd; return; } walk(nd.children); } } };
  walk(S.layerTree); return found;
}

// the structured breakdown of a resolved call — labelled chips ("column: FE", "on:
// deposit.csv") so a full phrase shows exactly what was understood, not just prose.
function nlBreakdown(name, args, L) {
  const p = [];
  const verb = name === 'micro.setLayerVisibility' ? (args.action === 'hide' ? 'hide' : 'show')
    : ({ 'micro.filterBlocks': 'filter', 'micro.colorBy': 'colour', 'micro.sectionAt': 'section', 'micro.clearSection': 'clear section', 'micro.setSectionThickness': 'section', 'micro.setZExag': 'z-exag', 'micro.setBackground': 'background', 'micro.openGradeTonnage': 'grade–tonnage', 'micro.clearFilter': 'clear filter' }[name] || name);
  p.push({ k: '', v: verb });
  if (name === 'micro.filterBlocks') {
    (args.clauses || []).forEach((cl, i) => {
      if (i) p.push({ k: '', v: args.join || 'and' });
      p.push({ k: cl.column, v: `${cl.op} ${typeof cl.value === 'string' ? '“' + cl.value + '”' : cl.value}` });
    });
  } else if (args.column) p.push({ k: 'column', v: args.column });
  else if (args.axis != null) { p.push({ k: 'axis', v: args.axis }); p.push({ k: 'at', v: args.position }); if (args.thickness) p.push({ k: 'thick', v: `${args.thickness} m` }); }
  else if (args.factor != null) p.push({ k: 'factor', v: `×${args.factor}` });
  else if (args.color) p.push({ k: 'colour', v: args.color });
  else if (args.thickness != null) p.push({ k: 'thick', v: `${args.thickness} m` });
  else if (args.layer) p.push({ k: '', v: args.layer });
  if (L && (name === 'micro.filterBlocks' || name === 'micro.colorBy' || name === 'micro.openGradeTonnage')) p.push({ k: 'on', v: L.label || L.name });
  return p;
}

// A phrase → ONE proposal row. Never runs anything.
export function nlPropose(q) {
  if (!_nlOn || !_nlDispatcher || q.length < 4) return null;
  let r = null;
  try { r = _nlDispatcher.dispatch(q, { surface: 'micro' }); } catch { return null; }
  // dispatch() → { calls: [{ name, arguments }], intent, margin }. A refusal (or a
  // failed assembly) comes back with NO calls — say nothing rather than guess.
  const call = r && r.calls && r.calls[0];
  if (!call || !call.name) return null;
  const mk = NL_RUN[call.name];
  if (!mk) return null;                                                  // declared but unwired → say nothing
  const args = call.arguments || {};
  const col = args.column || (args.clauses && args.clauses[0] && args.clauses[0].column) || null;
  const target = nlResolveTarget(q, r.tags, col);
  let act = null;
  try { act = mk(args, target); } catch { return null; }
  if (!act || !act.say) return null;
  return { id: 'nl:' + call.name, group: 'suggested', title: act.say, nl: true, breakdown: nlBreakdown(call.name, args, target), run: () => act.run() };
}

// completion vocab keywords (verbs / operators / axis words) — the closed classes the
// gazetteer doesn't carry as column/category/layer synonyms.
const NL_VERBS = ['color', 'colour', 'filter', 'show', 'hide', 'only', 'clear', 'keep', 'section', 'elevation', 'easting', 'northing', 'bench', 'thickness', 'grade', 'tonnage', 'background', 'exaggeration', 'exaggerate', 'above', 'below', 'over', 'under', 'greater', 'less'];

// example phrases for an EMPTY Alt+K, instantiated from THIS session (real columns, a
// real category value, a real group/layer) — discovery + a template you can edit.
export function nlStarters() {
  const V = nlDeriveVocab(nlSessionVocab());
  const col = Object.keys(V.numCols)[0];
  const catCol = Object.keys(V.catValues)[0]; const catVal = catCol && Object.keys(V.catValues[catCol])[0];
  let grp = null; for (const nd of S.layerTree || []) if (!grp && nd && typeof nd === 'object' && nd.group && nd.name) grp = nd.name;
  const lay = S.layers[0] && (S.layers[0].label || S.layers[0].name);
  const s = [];
  if (col) { s.push(`colour by ${col}`); s.push(`${col} > 60`); }
  if (catVal) s.push(`only ${String(catVal).toLowerCase()}`);
  if (grp || lay) s.push(`hide ${grp || lay}`);
  s.push('section at elevation 1040');
  if (col) s.push(`grade tonnage for ${col}`);
  return s.map((t) => ({ id: 'nlstart:' + t, group: '', title: t, hint: 'example', fill: t }));
}

// complete the CURRENT (last) word against the session vocabulary + the verb list. A
// closed candidate set → nothing to hallucinate; picking one replaces the word.
export function nlComplete(raw) {
  const frag = ((raw.match(/(\S*)$/) || [])[1] || '').toLowerCase();
  if (frag.length < 1) return [];
  const V = nlDeriveVocab(nlSessionVocab());
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
  localStorage.setItem('micro.nl', _nlOn ? '1' : '0');
  if (!_nlOn) { _nlDispatcher = null; _nlKey = ''; }
  nlMsg(_nlOn ? 'natural-language command bar ON (experimental) — ⌘K/Ctrl+K falls back to it; Alt+K goes straight to it' : 'natural-language command bar off');
}

// for the smokes: the last training's numbers, and phrases held OUT of the next one
export function nlStats() { return _nlStats; }

export function nlHoldOut(texts) { _nlExclude = texts ? new Set(texts.map(nlNormText)) : null; _nlDispatcher = null; _nlKey = ''; }
