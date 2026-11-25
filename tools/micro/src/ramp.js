// micro — per-layer colour ramps: the presets, a ramp baked into the 256-px LUT the
// shaders sample, which ramp and range a layer's current colour selection uses, and
// applying it. The ramp section of the Properties panel draws them (src/props-style.js).
import { S, requestRender } from './state.js';
import { stageGate } from './props.js';
import { _rampRepaint } from './props-style.js';
import { paintActiveCol, applyPaintPalette, paintBlankVis } from './paint.js';
import { calcDisplayCol, calcSelOf, ensureCalcDisplay } from './calc.js';
import { applyCatLegend, applyCatVisibility } from './categories.js';
import { ensureValueTex } from './color.js';
import { markProjectDirty } from './project.js';
import { layerTableHeader } from './records.js';
import { axisLocalToWorld } from './coords.js';
const $ = (s) => document.querySelector(s);

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
// ── the CLASS model (classed ramps): breaks b0 < … < bn make n+1 classes — < b0, b0–b1, …,
// ≥ bn — over the FULL break list, whatever the data range, the clip or the layer. A class's
// colour is colors[k] (or the preset sampled at the class's place among ALL classes), so a
// clip, a narrower layer (drillholes vs the model), a sentinel or a new file never moves a
// colour to another interval. Every reader — the GPU's LUT, the pane's table, the histogram,
// the figure legend — goes through these, so they cannot disagree.
export function classBreaks(cfg) {
  const b = ((cfg && cfg.breaks) || []).filter(Number.isFinite).slice().sort((a, c) => a - c);
  return b.filter((v, i) => i === 0 || v > b[i - 1]);
}
export function classIndex(breaks, v) { let k = 0; while (k < breaks.length && v >= breaks[k]) k++; return k; }
const _hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
export function classColor(cfg, breaks, k) {
  const ov = cfg && cfg.colors && cfg.colors[k];
  if (ov) return ov;
  return _hex(rampSample(RAMP_PRESETS[(cfg && cfg.preset) || 'viridis'] || RAMP_PRESETS.viridis, (k + 0.5) / (breaks.length + 1)));
}
// '< 20' · '20 – 40' · '≥ 65'
export function classLabel(breaks, k, fmt = String) {
  if (!breaks.length) return 'all';
  if (k === 0) return `< ${fmt(breaks[0])}`;
  if (k === breaks.length) return `≥ ${fmt(breaks[k - 1])}`;
  return `${fmt(breaks[k - 1])} – ${fmt(breaks[k])}`;
}
// a break edit keeps each colour with ITS class: a new class takes the colour of the old one
// with the same lower bound, else the same upper bound (a split gives both halves the
// colour; a merge keeps the lower one; moving a break keeps both neighbours'); a wholesale
// re-classification with the same class count (quantiles, equal) keeps the palette by place
export function remapClassColors(oldBreaks, oldColors, newBreaks) {
  if (!oldColors || !oldColors.some(Boolean)) return null;
  const same = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
  const bound = (br, k) => [k === 0 ? -Infinity : br[k - 1], k === br.length ? Infinity : br[k]];
  const nOld = oldBreaks.length + 1, nNew = newBreaks.length + 1;
  const out = new Array(nNew).fill(null);
  let matched = 0;
  for (let k = 0; k < nNew; k++) {
    const [lo, hi] = bound(newBreaks, k);
    let j = -1;
    for (let q = 0; q < nOld && j < 0; q++) if (same(bound(oldBreaks, q)[0], lo)) j = q;
    for (let q = 0; q < nOld && j < 0; q++) if (same(bound(oldBreaks, q)[1], hi)) j = q;
    if (j >= 0) { out[k] = oldColors[j] || null; matched++; }
  }
  if (!matched && nOld === nNew) for (let k = 0; k < nNew; k++) out[k] = oldColors[k] || null;
  return out.some(Boolean) ? out : null;
}

export function bakeRampPixels(cfg, lo, hi) {
  const px = new Uint8Array(256 * 4);
  const stops = RAMP_PRESETS[cfg.preset] || RAMP_PRESETS.viridis;
  const span = hi > lo ? hi - lo : 1;
  const all = classBreaks(cfg);
  const breaks = all.filter((v) => v > lo && v < hi);      // the STRETCHED ramp bends at the breaks inside the range
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let c;
    let hidden = false;
    if (cfg.classed && all.length) {
      // classes over the FULL break list: colour k is class k's, whatever the range. The texel's
      // class is its SAMPLING centre's ((i + ½)/256 — the GPU reads it NEAREST), so a boundary
      // is exact to half a texel and never a blend of two classes
      const k = classIndex(all, lo + ((i + 0.5) / 256) * span);
      const n2 = parseInt(classColor(cfg, all, k).slice(1), 16);
      c = [(n2 >> 16) & 255, (n2 >> 8) & 255, n2 & 255];
      hidden = !!(cfg.hide && cfg.hide[k]);               // a class's eye: alpha 0 → the shaders cull it
    } else if (breaks.length) {
      const v = lo + t * span;
      const edges = [lo, ...breaks, hi];
      let k = 0; while (k < edges.length - 2 && v >= edges[k + 1]) k++;
      const f = (v - edges[k]) / Math.max(edges[k + 1] - edges[k], 1e-9);
      c = rampSample(stops, (k + Math.min(1, Math.max(0, f))) / (edges.length - 1));
    } else {
      c = rampSample(stops, t);
    }
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = hidden ? 0 : 255;
  }
  return px;
}
export const colorSelOf = (L) => (L.id === S.activeId ? $('#colorBy').value : (L.colorSel || 'elev'));
// a ramp config belongs to a COLUMN, so it is keyed by the column's NAME: 'chan:3' is FE in
// one file and SG in the next (Change file…), and a pasted style matches columns by name.
// Other selections (elev, calc:NAME, paint:NAME, a cloud's '0') already name themselves.
export function rampKey(L, sel) {
  const s = String(sel);
  if (!s.startsWith('chan:')) return s;
  const h = layerTableHeader(L), name = h && h.columns[+s.slice(5)];
  return name != null ? 'col:' + name : s;
}
// configs saved before the re-key ('chan:N') move to their names — ALL at once, under the
// header they were saved against (a project load, or just before Change file… swaps it)
export function migrateRampKeys(L) {
  if (!L || !L.ramps || L._rampsKeyed === L.ramps) return;
  const h = layerTableHeader(L);
  if (!h) return;
  for (const k of Object.keys(L.ramps)) {
    if (!k.startsWith('chan:')) continue;
    const name = h.columns[+k.slice(5)];
    if (name != null && !L.ramps['col:' + name]) L.ramps['col:' + name] = L.ramps[k];
    if (name != null) delete L.ramps[k];
  }
  L._rampsKeyed = L.ramps;
}
export function rampCfgOf(L, create = false) {
  migrateRampKeys(L);
  const key = rampKey(L, colorSelOf(L));
  if (!L.ramps) { if (!create) return null; L.ramps = {}; }
  if (!L.ramps[key]) { if (!create) return null; L.ramps[key] = { preset: 'viridis', classed: false, breaks: [] }; }
  return L.ramps[key];
}
// the value range the SHADER maps to t — mirrors the clip-aware ranges
export function rampRangeFor(L) {
  const sel = colorSelOf(L);
  const clip = [parseFloat(L.clip[0]), parseFloat(L.clip[1])];
  if (String(sel).startsWith('chan:')) {
    const cr = S.renderer.layerChanRange(L.id) || [0, 1];
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
  const b = S.docBbox || [0, 0, 0, 1, 1, 1];
  return [Number.isFinite(clip[0]) ? clip[0] : axisLocalToWorld(b[2], 2), Number.isFinite(clip[1]) ? clip[1] : axisLocalToWorld(b[5], 2)];
}
// what a BLANK value draws as (condenser chan.js): micro's default is the neutral grey the
// rules and painted columns use for "nothing", shown — a missing grade must not look like the
// lowest one. L.noData = { color, hide }; the legend gets a row for it.
export const NODATA_DEFAULT = '#555a5f';
export function noDataOf(L) { return Object.assign({ color: NODATA_DEFAULT, hide: false }, (L && L.noData) || {}); }
export function syncNoData(L) {
  if (!L || !S.renderer || !S.renderer.setLayerNoData) return;
  const nd = noDataOf(L), n = parseInt(String(nd.color).slice(1), 16);
  S.renderer.setLayerNoData(L.id, [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, nd.hide ? 0 : 1]);
  // a stored / ƒ column colours its blanks through its own palette (code 0), not the chunks' no-data
  // channel: give it the same colour and hide
  const pc = paintActiveCol(L) || calcDisplayCol(L);
  if (pc && pc.kind === 'ratio' && pc.mat) { applyPaintPalette(L, pc); S.renderer.setLayerCatVisibility(L.id, paintBlankVis(L, pc)); }
  else if (pc && pc.cat) { applyCatLegend(L, true); applyCatVisibility(L, true); }   // a text ƒ: blanks are its code 0
}
export function applyRamp(L, force) {
  if (!force) return stageGate(L, () => applyRamp(L, true));
  syncNoData(L);
  if (L.docs && (L.docs.blockDoc || L.docs.dhDoc || L.docs.lasDoc || L.docs.plyDoc)) ensureValueTex(L).catch((e) => { $('#meta').textContent = `colour — ${e.message}`; });
  const pcR = paintActiveCol(L) || calcDisplayCol(L);
  if (!pcR && calcSelOf(L)) ensureCalcDisplay(L);          // realize lazily; it re-applies on completion
  if (pcR && pcR.kind === 'ratio') { applyPaintPalette(L, pcR); return; }   // ramp+clip bake INTO the palette
  if (pcR && pcR.cat) { requestRender(); return; }          // a text ƒ by class: no ramp (its legend is the palette)
  const cfg = rampCfgOf(L);
  if (!cfg || (cfg.preset === 'viridis' && !(cfg.breaks && cfg.breaks.length))) {
    S.renderer.setLayerRamp(L.id, null);
  } else {
    const [lo, hi] = rampRangeFor(L);
    S.renderer.setLayerRamp(L.id, bakeRampPixels(cfg, lo, hi), { nearest: !!(cfg.classed && classBreaks(cfg).length) });
  }
  requestRender();
}
// the clip belongs to the COLOUR-BY, not the layer: FE's 40–65 must not flatten SG (2.8–4.3)
// into one colour. Switching saves the old selection's clip with its ramp config and brings
// the new selection's back (none: the data range). L.clip stays the live value every reader
// already uses; the toolbar boxes follow for the active layer.
export function swapClipForSel(L, prevSel, nextSel) {
  if (!L || prevSel === nextSel) return;
  migrateRampKeys(L);
  L.ramps = L.ramps || {};
  const pk = prevSel == null ? null : rampKey(L, prevSel), nk = rampKey(L, nextSel);
  prevSel = pk; nextSel = nk;
  const cur = L.clip || ['', ''];
  const set = cur[0] !== '' && cur[0] != null || cur[1] !== '' && cur[1] != null;
  if (prevSel != null) {
    if (set) (L.ramps[prevSel] || (L.ramps[prevSel] = { preset: 'viridis', classed: false, breaks: [] })).clip = [String(cur[0] ?? ''), String(cur[1] ?? '')];
    else if (L.ramps[prevSel]) delete L.ramps[prevSel].clip;
  }
  const nc = L.ramps[nextSel] && L.ramps[nextSel].clip;
  L.clip = nc ? nc.slice() : ['', ''];
  if (L.id === S.activeId) { const a = $('#clipMin'), b = $('#clipMax'); if (a && b) { a.value = L.clip[0]; b.value = L.clip[1]; } }
}
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
  markProjectDirty();
}
