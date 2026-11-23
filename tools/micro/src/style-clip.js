// micro — a layer's STYLE as a value you can copy, paste, save and load: colour-by, ramps
// (classes, colours, clips), the category legend and hidden classes, rules, opacity, edges,
// the legend caption. Everything is matched BY NAME on the receiving layer — a column called
// FE gets FE's classes whatever its position, a category legend applies when the category
// column has the same name, hidden classes by their values — so the drillholes take the
// model's grade classes, January's model the same look as February's, one project another's.
//
// Copy puts the style on micro's own clipboard AND the system clipboard (as JSON), so a paste
// works across tabs and projects; Save style… writes the same JSON as a file. A paste is one
// undo step, and the status line says what applied and what had no match.
import { S, requestRender } from './state.js';
import { colorSelOf, rampKey, rampCfgOf, migrateRampKeys, applyRamp } from './ramp.js';
import { layerTableHeader } from './records.js';
import { layerClassInfo, applyCatLegend, applyCatVisibility } from './categories.js';
import { ruleModeOf, runRules, syncRuleMode } from './rules.js';
import { setLayerColorSel } from './color.js';
import { applyLayerOpacity } from './layermenu.js';
import { styleSnap, restoreStyleSnap, refreshProps } from './props.js';
import { pushUndo } from './undo.js';
import { markProjectDirty } from './project.js';
import { deliverBlob } from './hostio.js';
const $ = (s) => document.querySelector(s);

export const STYLE_FORMAT = 'micro-style';
let _clip = null;                                          // the last copied style (micro's own clipboard)
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// the style of L, as plain JSON (names, not positions)
export function captureStyle(L) {
  migrateRampKeys(L);
  const sel = String(colorSelOf(L)), h = layerTableHeader(L);
  const ramps = clone(L.ramps || {});
  // the live clip belongs to the current colour-by's config
  const key = rampKey(L, sel), c = L.clip || ['', ''];
  if ((c[0] !== '' && c[0] != null) || (c[1] !== '' && c[1] != null)) (ramps[key] || (ramps[key] = { preset: 'viridis', classed: false, breaks: [] })).clip = [String(c[0] ?? ''), String(c[1] ?? '')];
  else if (ramps[key]) delete ramps[key].clip;
  const colorBy = sel.startsWith('chan:') ? { column: h ? h.columns[+sel.slice(5)] : null }
    : sel.startsWith('calc:') ? { calc: sel.slice(5) }
    : sel.startsWith('paint:') ? { paint: sel.slice(6) }
    : { mode: sel };                                       // elev · cat · rules · solid · a cloud's 0–3
  const info = layerClassInfo(L);
  const hidden = info && L.catHidden ? [...L.catHidden].map((code) => (info.kind === 'las' ? code : info.names[code])).filter((v) => v != null) : [];
  return {
    format: STYLE_FORMAT, version: 1, from: L.label || L.name || '',
    colorBy, ramps,
    catLegend: clone(L.catLegend) || null, catHidden: hidden,
    calcCats: L.calcCats && Object.keys(L.calcCats).length ? clone(L.calcCats) : null,   // text ƒ classes: by column NAME and VALUE, so they carry as they are
    rules: clone(L.rules) || null, ruleHidden: L.ruleHidden ? [...L.ruleHidden] : [],
    opacity: L.opacity != null ? L.opacity : null, edges: L.edges ?? null, legendTitle: L.legendTitle || null,
    noData: L.noData ? { ...L.noData } : null,
  };
}

export function parseStyle(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  return o && o.format === STYLE_FORMAT && o.version === 1 ? o : null;
}

// the colour-by a style names, on THIS layer (or null when it has no such column)
function selOn(L, cb) {
  if (!cb) return null;
  const h = layerTableHeader(L);
  if (cb.column != null) { const i = h ? h.columns.indexOf(cb.column) : -1; return i >= 0 ? `chan:${i}` : null; }
  if (cb.calc != null) return (L.calcCols || []).some((c) => c.name === cb.calc) ? `calc:${cb.calc}` : null;
  if (cb.paint != null) return (L.paintCols || []).some((c) => c.name === cb.paint) ? `paint:${cb.paint}` : null;
  return cb.mode || null;
}

// apply a style to L by name; one undo step. Returns { applied: [...], skipped: [...] }.
export async function applyStyle(L, st) {
  if (!L || !st) return null;
  const before = styleSnap(L), applied = [], skipped = [];
  migrateRampKeys(L);
  // ramps: each column's config (classes, colours, clip) — by name, merged over this layer's
  L.ramps = L.ramps || {};
  const h = layerTableHeader(L);
  for (const [k, cfg] of Object.entries(st.ramps || {})) {
    const known = !k.startsWith('col:') || (h && h.columns.includes(k.slice(4)));
    L.ramps[k] = clone(cfg);
    if (known) applied.push(k.startsWith('col:') ? k.slice(4) : k);
  }
  // the colour-by, by name
  const want = selOn(L, st.colorBy);
  const cbName = st.colorBy && (st.colorBy.column ?? st.colorBy.calc ?? st.colorBy.paint ?? st.colorBy.mode);
  if (want && [...$('#colorBy').options].some((o) => o.value === want) || (want && L.id !== S.activeId)) {
    if (String(L.colorSel) !== want) await setLayerColorSel(L, want);
    applied.push(`colour by ${cbName}`);
  } else if (cbName != null) skipped.push(`colour by ${cbName} (no such column here)`);
  // the clip comes with the colour-by's config (also when the colour-by didn't change)
  const cfg = rampCfgOf(L);
  L.clip = cfg && cfg.clip ? cfg.clip.slice() : ['', ''];
  if (L.id === S.activeId) { $('#clipMin').value = L.clip[0]; $('#clipMax').value = L.clip[1]; }
  // a text ƒ's classes: kept by ƒ name and value, so they apply to any layer with a ƒ of that name
  if (st.calcCats) {
    const have = new Set((L.calcCols || []).filter((c) => c.ty === 'string').map((c) => c.name));
    for (const [nm, cc] of Object.entries(st.calcCats)) {
      if (!have.has(nm)) { skipped.push(`classes of ƒ ${nm} (no text ƒ column of that name here)`); continue; }
      (L.calcCats || (L.calcCats = {}))[nm] = clone(cc); applied.push(`classes of ƒ ${nm}`);
    }
    if (String(L.colorSel).startsWith('calc:') && have.has(String(L.colorSel).slice(5))) { applyCatLegend(L, true); applyCatVisibility(L, true); }
  }
  // categories: the legend applies when the category column has the same name
  const info = layerClassInfo(L);
  if (st.catLegend) {
    if (info && st.catLegend.col === info.column) { L.catLegend = clone(st.catLegend); applyCatLegend(L, true); applied.push(`classes of ${info.column}`); }
    else skipped.push(`classes of ${st.catLegend.col} (this layer's category column is ${info ? info.column : 'none'})`);
  }
  if (info && st.catHidden && st.catHidden.length) {
    const codes = st.catHidden.map((v) => (info.kind === 'las' ? v : info.names.indexOf(v))).filter((c) => c >= 0);
    L.catHidden = new Set(codes); applyCatVisibility(L, true);
  }
  if (st.rules) {
    L.rules = clone(st.rules); L.ruleHidden = new Set(st.ruleHidden || []); L._rulesDirty = true;
    if (ruleModeOf(L)) { syncRuleMode(L); runRules(L, true); }
    applied.push(`${(st.rules.list || []).length} rule(s)`);
  }
  if (st.opacity != null && (L.docs.blockDoc || L.dh)) applyLayerOpacity(L, st.opacity);
  if (st.edges !== undefined) { L.edges = st.edges; S.renderer.setLayerEdges(L.id, st.edges); }
  if (st.legendTitle !== undefined) L.legendTitle = st.legendTitle;
  if (st.noData !== undefined) L.noData = st.noData ? { ...st.noData } : null;
  applyRamp(L, true);
  pushUndo(`paste style onto ${L.label || L.name}`, () => restoreStyleSnap(L, before, { colorBy: true }));
  markProjectDirty(); requestRender(); refreshProps();
  return { applied, skipped };
}

export async function copyStyle(L) {
  _clip = captureStyle(L);
  try { await navigator.clipboard.writeText(JSON.stringify(_clip)); } catch { /* no permission / no clipboard: micro's own still works */ }
  $('#meta').textContent = `style copied from ${L.label || L.name} — Paste style on another layer (or project)`;
  return _clip;
}

// micro's clipboard first; else the system clipboard, if it holds a micro style
export async function pasteStyle(L) {
  let st = _clip;
  if (!st) { try { st = parseStyle(await navigator.clipboard.readText()); } catch { st = null; } }
  if (!st) { $('#meta').textContent = 'paste style: nothing copied — Copy style on a layer first (or Load style…)'; return null; }
  const r = await applyStyle(L, st);
  if (r) $('#meta').textContent = `style from ${st.from || 'a copied layer'} → ${L.label || L.name}: ${r.applied.join(', ') || 'nothing matched'}${r.skipped.length ? ` · not here: ${r.skipped.join('; ')}` : ''}`;
  return r;
}
export const canPasteStyle = () => !!_clip;

export async function saveStyleFile(L) {
  const st = captureStyle(L);
  const name = `${String(L.label || L.name || 'layer').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}.microstyle.json`;
  await deliverBlob(new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' }), name);
  $('#meta').textContent = `style saved → ${name}`;
}

export async function loadStyleFile(L, file = null) {
  const f = file || await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,.microstyle.json'; i.onchange = () => res(i.files[0] || null); i.click(); });
  if (!f) return null;
  const st = parseStyle(await f.text());
  if (!st) { $('#meta').textContent = `load style: ${f.name} is not a micro style`; return null; }
  _clip = st;
  return pasteStyle(L);
}
