// micro — rule-based styling: ordered expression predicates, each with a colour, and
// the else colour; running them over a layer's records, and which colour mode (rules /
// paint / a calc / a ramp) a layer is in. The rule list is drawn by src/props-style.js.
import { colorSelOf } from './ramp.js';
import { stageGate, _propOpen, _propFor, _propTab, renderProps } from './props.js';
import { paintActiveCol, applyPaintPalette, paintBlankVis } from './paint.js';
import { calcDisplayCol, calcSelOf, ensureCalcDisplay } from './calc.js';
import { S, requestRender } from './state.js';
import { markProjectDirty } from './project.js';
import { applyCatLegend, applyCatVisibility } from './categories.js';
import { layerTableHeader, schemaExt, attrRowCountOf, blockCaps, layerRows, extendRow } from './records.js';
import { validate, compileBool } from '../../../ext/expr/index.js';
import { coordNum } from '../../../ext/condenser/src/main.js';
import { viewCatName, viewCatData, ensureViewCat, applyViewCatCodes } from './viewcat.js';
const $ = (s) => document.querySelector(s);

// ── rule-based styling (spec §10.4): ordered expr predicates → colors. One
// sweep evaluates the rules FIRST-MATCH-WINS into a per-record u8 code array
// (the filter-mask machinery), uploaded as the layer's rule texture; the code
// then substitutes for the class code in every element program, so the
// palette, per-rule eyes, and pick culling are the categorized machinery
// re-aimed. Rules are declarative (they persist; codes rebuild on load). ──
export const RULE_ELSE = '#555a5f';
export function ruleModeOf(L) { return L && colorSelOf(L) === 'rules'; }
export function rulesOf(L) { return (L.rules && L.rules.list) || []; }
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
  S.renderer.setLayerPalette(L.id, px, 256);
  requestRender();
}
export function applyRuleVisibility(L, force) {
  if (!force) return stageGate(L, () => applyRuleVisibility(L, true));
  if (!L.ruleHidden || !L.ruleHidden.size) S.renderer.setLayerCatVisibility(L.id, null);
  else {
    const v = new Uint8Array(256).fill(1);
    for (const c of L.ruleHidden) v[c & 255] = 0;
    S.renderer.setLayerCatVisibility(L.id, v);
  }
  markProjectDirty(); requestRender();
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
    S.renderer.setLayerRuleMode(L.id, true);
    applyRulePalette(L, true); applyRuleVisibility(L, true);
    if (L._ruleCodes) S.renderer.setLayerRuleCodes(L.id, L._ruleCodes);   // paint may have borrowed the texture
    else if (rulesOf(L).length && (!L._ruleCodes || L._rulesDirty)) runRules(L, true);
    else S.renderer.setLayerRuleCodes(L.id, null);
  } else if (pc) {
    S.renderer.setLayerRuleMode(L.id, true);
    applyPaintPalette(L, pc);
    S.renderer.setLayerCatVisibility(L.id, paintBlankVis(L, pc));   // no per-value eyes on paint (v1) — only no-data's hide
    S.renderer.setLayerRuleCodes(L.id, pc.codes);
  } else if (L.viewOf != null && (viewCatName(L) || L._viewCat)) {
    // a view classing by its own column: its codes substitute for the chunks'
    // class codes (src/viewcat.js); back on its model's column, they come off
    if (viewCatName(L) && colorSelOf(L) === 'cat' && !viewCatData(L)) ensureViewCat(L).then((v) => { if (v) syncRuleMode(L); }).catch((e) => { $('#meta').textContent = `classes: ${e.message}`; });
    if (!viewCatName(L)) L._viewCat = null;
    applyViewCatCodes(L);
    applyCatLegend(L, true); applyCatVisibility(L, true);
  } else {
    S.renderer.setLayerRuleMode(L.id, false);
    applyCatLegend(L, true); applyCatVisibility(L, true);
  }
  requestRender();
}
// the sweep: compile each rule against the layer schema (ƒ columns included),
// walk the table once, first matching rule claims the record. Numbering
// mirrors applyBlockFilter exactly — delimited skips non-finite-coord rows,
// .dm and drillholes are raw — so codes line up with recIdx.
let _ruleEpoch = 0;
export async function runRules(L, force) {
  if (!force) return stageGate(L, () => runRules(L, true));
  const h = layerTableHeader(L); if (!h) return;
  applyRulePalette(L, true); applyRuleVisibility(L, true);
  S.renderer.setLayerRuleMode(L.id, ruleModeOf(L));
  const rules = rulesOf(L);
  if (!rules.length) { L._ruleCodes = null; L._ruleCounts = null; L._rulesDirty = false; S.renderer.setLayerRuleCodes(L.id, null); requestRender(); return; }
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
  S.renderer.setLayerRuleCodes(L.id, codes);
  $('#meta').textContent = `rules: ${rules.map((r, i) => `${r.name || 'rule ' + (i + 1)} ${counts[i + 1].toLocaleString()}`).join(' · ')} · else ${counts[0].toLocaleString()}`;
  markProjectDirty(); requestRender();
  if (_propOpen && _propFor === L.id && _propTab === 'style') renderProps();   // refresh the count badges
}
