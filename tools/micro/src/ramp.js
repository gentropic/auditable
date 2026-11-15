// micro — per-layer colour ramps: the presets, a ramp baked into the 256-px LUT the
// shaders sample, which ramp and range a layer's current colour selection uses, and
// applying it. The ramp section of the Properties panel draws them (src/props-style.js).
import { S, requestRender } from './state.js';
import { stageGate } from './props.js';
import { _rampRepaint } from './props-style.js';
import { paintActiveCol, applyPaintPalette } from './paint.js';
import { calcDisplayCol, calcSelOf, ensureCalcDisplay } from './calc.js';
import { ensureValueTex } from './color.js';
import { markProjectDirty } from './project.js';
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
  const o = S.frame ? S.frame.origin[2] : 0;
  return [Number.isFinite(clip[0]) ? clip[0] : b[2] + o, Number.isFinite(clip[1]) ? clip[1] : b[5] + o];
}
export function applyRamp(L, force) {
  if (!force) return stageGate(L, () => applyRamp(L, true));
  if (L.docs && (L.docs.blockDoc || L.docs.dhDoc)) ensureValueTex(L).catch((e) => { $('#meta').textContent = `colour — ${e.message}`; });
  const pcR = paintActiveCol(L) || calcDisplayCol(L);
  if (!pcR && calcSelOf(L)) ensureCalcDisplay(L);          // realize lazily; it re-applies on completion
  if (pcR && pcR.kind === 'ratio') { applyPaintPalette(L, pcR); return; }   // ramp+clip bake INTO the palette
  const cfg = rampCfgOf(L);
  if (!cfg || (cfg.preset === 'viridis' && !(cfg.breaks && cfg.breaks.length))) {
    S.renderer.setLayerRamp(L.id, null);
  } else {
    const [lo, hi] = rampRangeFor(L);
    S.renderer.setLayerRamp(L.id, bakeRampPixels(cfg, lo, hi));
  }
  requestRender();
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
