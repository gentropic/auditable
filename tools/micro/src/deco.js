// micro — the DECORATIONS overlay and the figure: scale bar, north arrow, colour legends
// and title, drawn live on the 2D overlay and captured verbatim by Export figure; the
// background colour (the ink flips on a light one); the decorations panel; and the
// figure recipe. The app owns the camera, the render loop and the overlay canvas.
import { hexToRgb01 } from './color.js';
import { sceneDefault } from './theme.js';
import { ensureLegend, layerClassInfo, legendCodesOf, textCalcSel, classHidden } from './categories.js';
import { colorSelOf, rampCfgOf, rampRangeFor, bakeRampPixels, classBreaks, classColor, classLabel, noDataOf } from './ramp.js';
import { rulesOf, RULE_ELSE } from './rules.js';
import { paintColByName } from './paint.js';
import { calcSelOf } from './calc.js';
import { layerTableHeader } from './records.js';
import { S, activeLayer, requestRender } from './state.js';
import { fmtStat } from './analysis-ui.js';
import { floatWin, focusWindow } from './windows.js';
import { saveRecipe } from './recipes.js';
import { deliverBlob } from './hostio.js';
import { resolveFileHandle } from './paths.js';
import { applyCamera, captureCamera } from './camera.js';
import { applySection, captureSection } from './section.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setDecoHooks): renderFigureCanvas
let HK = {};
export function setDecoHooks(h) { HK = h; }

// ── viewport decorations (scale bar · north · legend · title) — a 2D overlay
// that shows LIVE and is captured verbatim by figure export. One draw routine
// serves both (the live #decoCv and the export canvas). ──
export let _deco = (() => { try { return Object.assign({ scale: false, north: false, legend: false, title: false, titleText: '' }, JSON.parse(localStorage.getItem('micro.deco') || '{}')); } catch { return { scale: false, north: false, legend: false, title: false, titleText: '' }; } })();

export function saveDeco() { try { localStorage.setItem('micro.deco', JSON.stringify(_deco)); } catch { /* private mode */ } }

// background colour (renderer clear + the figure backdrop). Decorations pick a
// contrasting ink from its luminance, so white-bg report figures stay readable.
// _bgPref is the CHOICE — 'auto' (match the chrome theme: basalt in dark, a
// light gray in light) or an explicit hex; _bgColor is what's showing.
// micro.scene replaces micro.bg, whose '#121212' was just the old default,
// so only a non-default old value carries over as an explicit choice.
export let _bgPref = (() => {
  try {
    const v = localStorage.getItem('micro.scene'); if (v) return v;
    const old = localStorage.getItem('micro.bg'); return old && old.toLowerCase() !== '#121212' ? old : 'auto';
  } catch { return 'auto'; }
})();
const resolveBg = () => (/^#[0-9a-fA-F]{6}$/.test(_bgPref) ? _bgPref : sceneDefault());
export let _bgColor = resolveBg();

export let _deInk = { fg: '#fff', bg: 'rgba(0,0,0,0.6)' };

export function decoInk() { const c = hexToRgb01(_bgColor), lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return lum > 0.55 ? { fg: '#151515', bg: 'rgba(255,255,255,0.7)' } : { fg: '#fff', bg: 'rgba(0,0,0,0.6)' }; }

export function applyBg() { if (S.renderer && S.renderer.setBackground) { S.renderer.setBackground(hexToRgb01(_bgColor)); requestRender(); } }

/** 'auto' (follow the theme) or '#rrggbb'. */
export function setBg(hex) {
  if (hex !== 'auto' && !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  _bgPref = hex; _bgColor = resolveBg();
  try { localStorage.setItem('micro.scene', hex); } catch { /* ignore */ }
  applyBg(); drawDecorations();
}
// a theme switch moves an 'auto' scene with it
window.addEventListener('micro:theme', () => { if (_bgPref !== 'auto') return; _bgColor = resolveBg(); applyBg(); drawDecorations(); });

export function niceNum(x) { if (!(x > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e; }

export function fmtLen(m) { return m >= 1000 ? +(m / 1000).toPrecision(3) + ' km' : (m < 1 ? +m.toPrecision(2) : +m.toFixed(m < 10 ? 1 : 0)) + ' m'; }

export function worldPerPixel() {
  const vp = S.cam.state.viewProj, v = S.cam.state.view, t = S.cam.state.target; if (!vp || !v || !t) return null;
  let Rw = [v[0], v[4], v[8]]; const rl = Math.hypot(Rw[0], Rw[1], Rw[2]) || 1; Rw = [Rw[0] / rl, Rw[1] / rl, Rw[2] / rl];
  const r = S.cv.getBoundingClientRect();
  const proj = (p) => { const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15]; return [((cx / cw) * 0.5 + 0.5) * r.width, (0.5 - (cy / cw) * 0.5) * r.height]; };
  const p0 = proj(t), p1 = proj([t[0] + Rw[0], t[1] + Rw[1], t[2] + Rw[2]]);
  const px = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  return px > 1e-6 ? 1 / px : null;
}

// right-docked property panel overlays the viewport's right edge — the same reason
// #compass shifts left in CSS. Right-anchored canvas decorations (legend, north
// arrow) offset by its width so they don't hide under it. (Float windows are
// movable, so they're the user's to clear; the docked panel is the predictable one.)
export function _rightInset() {
  const pp = $('#propPanel');
  return pp && pp.classList.contains('show') && !document.body.classList.contains('presenting') ?(pp.getBoundingClientRect().width || 272) + 12 : 0;
}

export const _stroked = (g, fn, lw) => { g.lineWidth = lw + 2; g.strokeStyle = _deInk.bg; fn(); g.lineWidth = lw; g.strokeStyle = _deInk.fg; fn(); };

export const _label = (g, txt, x, y) => { g.lineWidth = 3; g.strokeStyle = _deInk.bg; g.strokeText(txt, x, y); g.fillStyle = _deInk.fg; g.fillText(txt, x, y); };

export function drawScaleBar(g, W, H) {
  const wpp = worldPerPixel(); if (!wpp || !Number.isFinite(wpp)) return;
  const barWorld = niceNum(W * 0.18 * wpp), barPx = barWorld / wpp, x = 16, y = H - 22;
  _stroked(g, () => { g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.moveTo(x, y); g.lineTo(x + barPx, y); g.moveTo(x + barPx, y - 5); g.lineTo(x + barPx, y + 5); g.stroke(); }, 2);
  g.font = '12px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  _label(g, (S.cam.state.ortho ? '' : '~') + fmtLen(barWorld), x, y - 9);
}

export function drawNorthArrow(g, W, H) {
  const v = S.cam.state.view; if (!v) return;
  // world north (0,1,0) on screen: x = v[4], y = v[5] (the camera basis, src/overlay.js) — v[9] was world Z's
  let nx = v[4], ny = -v[5]; const m = Math.hypot(nx, ny); if (m < 1e-3) return; nx /= m; ny /= m;
  const cx = W - 42 - _rightInset(), cy = 52, Ln = 22;
  const arrow = () => { g.beginPath(); g.moveTo(cx - nx * Ln, cy - ny * Ln); g.lineTo(cx + nx * Ln, cy + ny * Ln); const px = -ny, py = nx; g.moveTo(cx + nx * Ln, cy + ny * Ln); g.lineTo(cx + nx * (Ln - 8) + px * 5, cy + ny * (Ln - 8) + py * 5); g.moveTo(cx + nx * Ln, cy + ny * Ln); g.lineTo(cx + nx * (Ln - 8) - px * 5, cy + ny * (Ln - 8) - py * 5); g.stroke(); };
  _stroked(g, arrow, 2);
  g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  _label(g, 'N', cx + nx * (Ln + 9), cy + ny * (Ln + 9));
}

export function drawTitleDeco(g, W, H) {
  if (!_deco.titleText) return;
  g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  _label(g, _deco.titleText, W / 2, 12);
}

// ── what a layer's colour MEANS right now — the one description every legend draws (the live
// overlay and the exported figure), following the colour MODE: a continuous ramp (its baked
// LUT, so stretched breaks bend it as the model shows, with ≤/≥ ends under a clip), classes
// (one swatch per class over the full break list — what the model is drawn in), categories
// (the classes tab's labels and colours, hidden entries left out), rules (each rule's name and
// colour, then 'everything else'), or a painted column's values. Solid and file RGB: none.
// The ONE function, so a legend can't disagree with the drawing. ──
const RAMP_SEL = (sel) => sel.startsWith('chan:') || sel === 'elev' || sel === '0' || sel.startsWith('calc:');
export function legendSpec(L) {
  const sel = String(colorSelOf(L));
  const pc = sel.startsWith('paint:') ? paintColByName(L, sel.slice(6)) : null;
  const textCalc = sel.startsWith('calc:') && textCalcSel(L);   // a text ƒ colours by class, not by ramp
  if ((RAMP_SEL(sel) && !textCalc) || (pc && pc.kind === 'ratio')) {
    const rng = rampRangeFor(L);
    if (!rng || !Number.isFinite(rng[0]) || !Number.isFinite(rng[1])) return null;
    const cfg = rampCfgOf(L) || { preset: 'viridis', classed: false, breaks: [] };
    const all = classBreaks(cfg);
    // blanks in this column, shown: a "no data" swatch after the classes / under the bar
    const nd = noDataOf(L), sv2 = sel, h2 = layerTableHeader(L);
    const nm = sv2.startsWith('chan:') && h2 ? h2.columns[+sv2.slice(5)] : sv2.startsWith('calc:') ? sv2.slice(5) : sv2.startsWith('paint:') ? sv2.slice(6) : null;
    const st = nm && L._colStats && L._colStats[nm];
    const noData = !nd.hide && st && st.nulls > 0 ? { label: 'no data', color: nd.color } : null;
    if (cfg.classed && all.length) {
      // high values on top, as the ramp bar reads; a hidden class isn't drawn, so it isn't listed
      const entries = all.concat([null]).map((_, k) => ({ label: classLabel(all, k, fmtStat), color: classColor(cfg, all, k), hidden: !!(cfg.hide && cfg.hide[k]) })).filter((e) => !e.hidden);
      return { kind: 'classes', highFirst: true, entries, tail: noData };
    }
    const clip = [parseFloat(L.clip && L.clip[0]), parseFloat(L.clip && L.clip[1])];
    return { kind: 'ramp', tail: noData, lo: rng[0], hi: rng[1], lut: bakeRampPixels(cfg, rng[0], rng[1]),
      ticks: all.filter((v) => v > rng[0] && v < rng[1]), clipLo: Number.isFinite(clip[0]), clipHi: Number.isFinite(clip[1]) };
  }
  if (sel === 'rules') {
    const hid = L.ruleHidden || new Set();
    const entries = rulesOf(L).map((r, i) => ({ label: r.name || r.expr || `rule ${i + 1}`, color: r.color || RULE_ELSE, hidden: hid.has(i + 1) }));
    entries.push({ label: 'everything else', color: (L.rules && L.rules.elseColor) || RULE_ELSE, hidden: hid.has(0) });
    return { kind: 'classes', entries: entries.filter((e) => !e.hidden) };
  }
  if (pc) {                                                // a painted (brush) column: its values and colours
    const entries = pc.dict.map((d2, c) => (c > 0 && d2 != null ? { label: String(d2), color: pc.colors[c] || RULE_ELSE } : null)).filter(Boolean);
    return entries.length ? { kind: 'classes', entries } : null;
  }
  if (sel === 'cat' || sel.startsWith('catcol:') || sel === '2' || textCalc) {
    const info = layerClassInfo(L); if (!info || info.pending) return null;
    const leg = ensureLegend(L, info); if (!leg || !leg.entries) return null;
    const hid = info.calc ? classHidden(L, info) : L.catHidden || new Set();
    const entries = leg.entries
      .filter((e) => { const cs = legendCodesOf(info, e); return info.calc ? cs.length && !cs.every((c) => hid.has(c)) : !cs.length || !cs.every((c) => hid.has(c)); })
      .map((e) => ({ label: e.label, color: e.color }));
    // a text ƒ's blank results draw in the no-data colour: listed, unless hidden
    const nd = noDataOf(L), blanks = info.calc && L._calcDisplay && L._calcDisplay.col && L._calcDisplay.col.counts[0] > 0;
    return entries.length ? { kind: 'classes', entries, tail: blanks && !nd.hide ? { label: 'no data', color: nd.color } : undefined } : null;
  }
  return null;
}

// legend title shown when the user hasn't overridden it — the coloured attribute
export function legendDefaultTitle(L) {
  const sel = String(colorSelOf(L));
  if (sel.startsWith('chan:')) { const h = layerTableHeader(L); return (h && h.columns[+sel.slice(5)]) || 'value'; }
  if (sel === 'elev' || sel === '0') return 'elevation';
  if (sel === 'rules') return 'rules';
  if (sel.startsWith('calc:')) return calcSelOf(L) || 'value';
  if (sel.startsWith('paint:')) return sel.slice(6);
  if (sel === 'cat' || sel.startsWith('catcol:') || sel === '2') { const info = layerClassInfo(L); if (info && info.column) return info.column; }
  return L.label || L.name || '';
}
// two legends on one attribute name say whose they are (the model's FE and the holes' FE)
function legendCaption(L) {
  if (L.legendTitle && L.legendTitle.trim()) return L.legendTitle.trim();
  const t = legendDefaultTitle(L);
  const twin = legendLayers().some((o) => o !== L && !(o.legendTitle && o.legendTitle.trim()) && legendDefaultTitle(o) === t);
  return twin ? `${t} · ${L.label || L.name || ''}` : t;
}

// can this layer show a legend at all?
export function legendAvailable(L) { return !!legendSpec(L); }

export function legendLayers() { return S.layers.filter((L) => L.legend && L.visible && legendAvailable(L)); }

export function anyLegend() { return legendLayers().length > 0; }

// draw ONE legend for layer L at (bx, by); returns the vertical extent consumed
// (so multiple legends can stack down the right column). Caption defaults to the
// coloured attribute name, overridable per-layer via L.legendTitle.
const LEGEND_MAX = 12;
// text cut to a width with an ellipsis (legends live in a fixed right-hand column)
function _fit(g, t, maxW) {
  if (g.measureText(t).width <= maxW) return t;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
export function drawOneLegend(g, L, bx, by) {
  const spec = legendSpec(L); if (!spec) return 0;
  const cap = legendCaption(L), bw = 15;
  if (cap) {                                               // ellipsized to the legend column, never off the edge
    g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    _label(g, _fit(g, cap, 140), bx, by - 7);
  }
  if (spec.kind === 'ramp') {
    const { lo, hi, lut } = spec, bh = 118;
    for (let i = 0; i < bh; i++) {
      const t = Math.round((1 - i / (bh - 1)) * 255) * 4;
      g.fillStyle = `rgb(${lut[t]},${lut[t + 1]},${lut[t + 2]})`; g.fillRect(bx, by + i, bw, 1);
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    const yOf = (v) => by + (1 - (v - lo) / Math.max(hi - lo, 1e-12)) * bh;
    g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    // ends: a clipped end says values beyond it share its colour
    _label(g, (spec.clipHi ? '≥ ' : '') + fmtStat(hi), bx + bw + 5, by);
    _label(g, (spec.clipLo ? '≤ ' : '') + fmtStat(lo), bx + bw + 5, by + bh);
    if (spec.ticks.length) {                                // a stretched ramp's breaks, where the colours bend
      for (const v of spec.ticks) {
        const y = yOf(v);
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw + 3, y); g.stroke();
        if (y > by + 12 && y < by + bh - 12) _label(g, fmtStat(v), bx + bw + 5, y);
      }
    } else _label(g, fmtStat((lo + hi) / 2), bx + bw + 5, by + bh / 2);
    if (spec.tail) {                                         // blanks: their own swatch under the bar
      const y = by + bh + 14;
      g.fillStyle = spec.tail.color; g.fillRect(bx, y - 6, 12, 12);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, y - 6, 12, 12);
      g.textBaseline = 'middle'; _label(g, spec.tail.label, bx + 17, y);
      return bh + 12 + 20;
    }
    return bh + 12;
  }
  // classes / categories / rules / painted values: one swatch per entry
  const list = (spec.highFirst ? spec.entries.slice().reverse() : spec.entries.slice()).concat(spec.tail ? [spec.tail] : []);
  let y = by + 6;                                          // the first swatch clears the caption
  g.textBaseline = 'middle';
  for (const e of list.slice(0, LEGEND_MAX)) {
    g.fillStyle = e.color; g.fillRect(bx, y - 6, 12, 12);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, y - 6, 12, 12);
    _label(g, _fit(g, String(e.label), 125), bx + 17, y);
    y += 17;
  }
  if (list.length > LEGEND_MAX) { _label(g, `+${list.length - LEGEND_MAX} more`, bx + 17, y); y += 17; }
  return (y - by) + 4;
}

// a layer's EXTRA legend rows under its colour legend (src/logs.js: its log tracks) — a drawer
// (g, L, bx, by) → the height it used; registered by the feature, so this module imports none
const _legendExtras = [];
export function addLegendExtra(fn) { _legendExtras.push(fn); }
export function drawLegendsDeco(g, W, H) {
  const bx = W - 148 - _rightInset(); let by = 84;
  for (const L of S.layers.filter((x) => x.legend && x.visible)) {
    if (legendAvailable(L)) { const used = drawOneLegend(g, L, bx, by); if (used) by += used + 16; }
    for (const fn of _legendExtras) { const used = fn(g, L, bx, by) || 0; if (used) by += used + 12; }
  }
}

export function renderDeco(g, W, H) {
  _deInk = decoInk();
  if (_deco.scale) drawScaleBar(g, W, H);
  if (_deco.north) drawNorthArrow(g, W, H);
  drawLegendsDeco(g, W, H);
  if (_deco.title) drawTitleDeco(g, W, H);
  if ((_deco.scale || _deco.north || _deco.title || anyLegend()) && S.layers.some((L) => L.offset && L.visible !== false)) drawDisplacedNote(g, W, H);
}

// an exploded figure says so: positions between displaced layers are not real
function drawDisplacedNote(g, W, H) {
  g.font = '11px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
  _label(g, 'exploded view — some layers drawn displaced; distances between them are not real', 12, H - 10);
}

export function drawDecorations() {
  const dc = $('#decoCv'), r = S.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!_deco.scale && !_deco.north && !anyLegend() && !_deco.title) { if (dc.width) { dc.width = 0; dc.height = 0; } return; }
  dc.width = Math.round(r.width * dpr); dc.height = Math.round(r.height * dpr);
  const g = dc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  renderDeco(g, r.width, r.height);
}

export function setDeco(key, val) { _deco[key] = val; saveDeco(); drawDecorations(); }

export function setDecoTitle(t) { _deco.titleText = t || ''; _deco.title = !!t; saveDeco(); drawDecorations(); }

// legends are PER-LAYER (each shows that layer's own colour mapping); multiple
// can be on and they stack. Persisted in the project manifest, not localStorage.
export function setLayerLegend(L, on) { if (!L) return; L.legend = !!on; drawDecorations(); if (_decoWin && _decoWin._render) _decoWin._render(); }

// the host's view of the decorations (micro.decorations / setDecorations). A host
// call is NOT remembered in localStorage: compare panes share it, and the host
// re-states what it wants. legend = the ids of layers showing one.
export function hostDecorations() {
  return { scale: !!_deco.scale, north: !!_deco.north, title: _deco.title && _deco.titleText ? _deco.titleText : null, legend: S.layers.filter((L) => L.legend).map((L) => L.id) };
}

export function setHostDecorations(o, layerOf) {
  for (const k of ['scale', 'north']) if (o[k] != null && typeof o[k] !== 'boolean') throw new Error(`micro: setDecorations ${k} must be true or false`);
  if (o.title != null && o.title !== false && typeof o.title !== 'string') throw new Error('micro: setDecorations title must be a string, or false/null for none');
  let legendOn = null;
  if (o.legend != null) {
    if (o.legend === true) legendOn = new Set(S.layers.filter((L) => L.visible !== false).map((L) => L.id));
    else if (o.legend === false) legendOn = new Set();
    else legendOn = new Set([].concat(o.legend).map((id) => layerOf(id).id));   // throws on an unknown id, before anything changes
  }
  if (o.scale != null) _deco.scale = o.scale;
  if (o.north != null) _deco.north = o.north;
  if (o.title !== undefined) { _deco.titleText = o.title || ''; _deco.title = !!o.title; }
  if (legendOn) for (const L of S.layers) L.legend = legendOn.has(L.id);
  drawDecorations(); if (_decoWin && _decoWin._render) _decoWin._render();
  return hostDecorations();
}

// export resolution multiplier (1× = on-screen; 2×/3× supersample for print)
export let _figScale = (() => { try { return Math.max(1, Math.min(4, +localStorage.getItem('micro.figScale') || 1)); } catch { return 1; } })();

export function setFigScale(s) { _figScale = Math.max(1, Math.min(4, (s | 0) || 1)); try { localStorage.setItem('micro.figScale', String(_figScale)); } catch { /* private */ } }

export function _figureDownload(out) {
  out.toBlob((blob) => {
    if (!blob) return; window._lastFigure = blob;
    const stem = (activeLayer() && (activeLayer().label || activeLayer().name) || 'micro').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_');
    const fname = `figure_${stem}.png`; deliverBlob(blob, fname);
    $('#meta').textContent = `figure → ${fname}`;
  }, 'image/png');
}

// export the viewport + decorations as a PNG (cv has preserveDrawingBuffer). At
// scale > 1 the scene is re-rendered into a scale× backing and converged there
// (a one-shot supersample), then restored — point size / EDL radius scale too so
// the figure looks identical, just sharper. Sealed: no network, pure canvas.
export function exportFigure(scale = _figScale) {
  // one renderer for the menu and the host (micro.snapshot): rendered to
  // convergence at any scale — the 1× path used to copy the interactive canvas
  // as it stood, which could be mid-accumulation
  if (scale > 1) $('#meta').textContent = `rendering figure ${scale}×…`;
  _figureDownload(HK.renderFigureCanvas(scale));
}

// Decorations & figure — a NON-MODAL float panel (not a modal): decorations draw
// live on the viewport, so a dimming backdrop would hide what you're adjusting.
// Everything applies live; the window's × dismisses. Single instance.
export let _decoWin = null;

export function openDecoPanel() {
  if (_decoWin) { focusWindow(_decoWin.el); return; }
  const win = floatWin({ title: 'decorations & figure', sub: '', x: Math.max(12, innerWidth - 336), y: 92, w: 316, h: 430, onClose: () => { _decoWin = null; } });
  _decoWin = win;
  const wrap = document.createElement('div'); wrap.className = 'deco-panel'; win.body.appendChild(wrap);
  const mkChk = (label, on, fn) => { const l = document.createElement('label'); l.className = 'deco-chk'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.onchange = () => fn(cb.checked, cb); l.append(cb, document.createTextNode(label)); return l; };
  const render = () => {
    wrap.textContent = '';
    // ── decorations ──
    const secD = document.createElement('div'); secD.className = 'deco-sec';
    const hD = document.createElement('div'); hD.className = 'deco-h'; hD.textContent = 'decorations'; secD.append(hD);
    secD.append(mkChk('Scale bar', _deco.scale, (v) => setDeco('scale', v)));
    secD.append(mkChk('North arrow', _deco.north, (v) => setDeco('north', v)));
    const tRow = document.createElement('div'); tRow.className = 'deco-legrow';
    const tcb = document.createElement('input'); tcb.type = 'checkbox'; tcb.checked = _deco.title;
    const tLab = document.createElement('label'); tLab.className = 'deco-chk'; tLab.append(tcb, document.createTextNode('Title'));
    tcb.onchange = () => setDeco('title', tcb.checked);
    const tin = document.createElement('input'); tin.type = 'text'; tin.className = 'deco-in sm'; tin.placeholder = 'figure title…'; tin.value = _deco.titleText || '';
    tin.oninput = () => { _deco.titleText = tin.value; _deco.title = !!tin.value; tcb.checked = _deco.title; saveDeco(); drawDecorations(); };
    tRow.append(tLab, tin); secD.append(tRow);
    wrap.append(secD);
    // ── legends (per-layer, stack) ──
    const secL = document.createElement('div'); secL.className = 'deco-sec';
    const hL = document.createElement('div'); hL.className = 'deco-h'; hL.textContent = 'legends'; secL.append(hL);
    const cands = S.layers.filter((L) => L.visible && legendAvailable(L));
    if (!cands.length) { const e = document.createElement('div'); e.className = 'deco-empty'; e.textContent = 'no coloured layers to key'; secL.append(e); }
    for (const L of cands) {
      const row = document.createElement('div'); row.className = 'deco-legrow';
      const lab = document.createElement('label'); lab.className = 'deco-chk'; lab.title = L.label || L.name;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!L.legend; cb.onchange = () => { L.legend = cb.checked; drawDecorations(); };
      lab.append(cb, document.createTextNode(L.label || L.name));
      const ti = document.createElement('input'); ti.type = 'text'; ti.className = 'deco-in sm'; ti.placeholder = legendDefaultTitle(L); ti.value = L.legendTitle || '';
      ti.oninput = () => { L.legendTitle = ti.value; drawDecorations(); };
      row.append(lab, ti); secL.append(row);
    }
    wrap.append(secL);
    // ── background ──
    const secB = document.createElement('div'); secB.className = 'deco-sec';
    const hB = document.createElement('div'); hB.className = 'deco-h'; hB.textContent = 'background'; secB.append(hB);
    const sw = document.createElement('div'); sw.className = 'deco-swatches';
    for (const [name, hex] of [['match the theme', 'auto'], ['basalt', '#121212'], ['black', '#000000'], ['white', '#ffffff'], ['paper', '#f4f2ec']]) {
      const b = document.createElement('button'); b.className = 'deco-sw' + (_bgPref.toLowerCase() === hex ? ' on' : '') + (hex === 'auto' ? ' auto' : ''); b.style.background = hex === 'auto' ? 'linear-gradient(135deg, #121212 50%, #c9c8c5 50%)' : hex; b.title = name;
      b.onclick = () => { setBg(hex); render(); }; sw.append(b);
    }
    const col = document.createElement('input'); col.type = 'color'; col.className = 'deco-color'; col.title = 'custom'; col.value = /^#[0-9a-fA-F]{6}$/.test(_bgColor) ? _bgColor : '#121212';
    col.oninput = () => { setBg(col.value); [...sw.querySelectorAll('.deco-sw')].forEach((x) => x.classList.remove('on')); };
    sw.append(col); secB.append(sw); wrap.append(secB);
    // ── export ──
    const foot = document.createElement('div'); foot.className = 'deco-foot';
    const scRow = document.createElement('div'); scRow.className = 'deco-legrow';
    const scLab = document.createElement('span'); scLab.className = 'deco-chk'; scLab.style.cursor = 'default'; scLab.textContent = 'Resolution';
    const scSel = document.createElement('select'); scSel.className = 'deco-in';
    for (const s of [1, 2, 3]) { const o = document.createElement('option'); o.value = s; o.textContent = s + '×' + (s === 1 ? ' (screen)' : ''); if (s === _figScale) o.selected = true; scSel.append(o); }
    scSel.onchange = () => setFigScale(+scSel.value);
    scRow.append(scLab, scSel); foot.append(scRow);
    const ex = document.createElement('button'); ex.className = 'deco-export btn-p'; ex.textContent = 'Export figure (PNG)'; ex.onclick = () => exportFigure();
    foot.append(ex);
    const tt = document.createElement('button'); tt.className = 'deco-export rcp'; tt.textContent = 'record turntable video…'; tt.title = 'orbit the view once and save it as a video (every frame rendered to convergence, decorations on)';
    tt.onclick = () => { if (HK.openTurntable) HK.openTurntable(); };
    foot.append(tt);
    const rcp = document.createElement('button'); rcp.className = 'deco-export rcp'; rcp.textContent = 'save as recipe…'; rcp.title = 'save this view + decorations + background + resolution as a re-runnable figure recipe (Tools → Recipes)';
    rcp.onclick = () => saveRecipe('figure', captureFigureCfg(), _deco.titleText || 'figure');
    foot.append(rcp); wrap.append(foot);
  };
  win._render = render;
  render();
}

export function decorationsMenu() { openDecoPanel(); }   // back-compat alias (View menu / palette)

// ── the FIGURE recipe: camera + decorations + background + export scale.
// Running applies the lot, waits for the render to converge, exports the PNG,
// then RESTORES everything it touched (temporary changes give back what they
// took). "The monthly plan-view figure" regenerates itself. ──
// per-layer cut modes captured BY NAME (only non-default: false/'front'/'behind');
// applying resets everything to follow, then sets the listed overrides
export function captureCutModes() {
  return S.layers.map((L) => ({ layer: L.name, mode: S.renderer.layerSectioned(L.id) })).filter((x) => x.mode !== true);
}

export function applyCutModes(modes) {
  for (const L of S.layers) S.renderer.setLayerSectioned(L.id, true);   // reset to follow
  for (const { layer, mode } of (modes || [])) { const L = S.layers.find((x) => x.name === layer); if (L) S.renderer.setLayerSectioned(L.id, mode); }
}

// a figure recipe captures the whole picture: camera + decorations + background
// + export scale + the SECTION (position, thickness, orientation) + per-layer
// cut modes — so "the monthly plan/section figure" reproduces exactly.
export function captureFigureCfg() { return { camera: captureCamera(), bg: _bgColor, deco: { ..._deco }, figScale: _figScale, section: captureSection(), cutModes: captureCutModes() }; }

export async function runFigureRecipe(params) {
  const prev = captureFigureCfg(), prevBgPref = _bgPref;   // restore the CHOICE, so "match the theme" stays matched
  try {
    if (params.camera) applyCamera(params.camera);
    if (params.bg) setBg(params.bg);
    if (params.deco) { Object.assign(_deco, params.deco); saveDeco(); }
    if (params.section) applySection(params.section);       // the section IS the figure for a section plot
    if (params.cutModes) applyCutModes(params.cutModes);
    drawDecorations(); requestRender();
    $('#meta').textContent = 'figure recipe: rendering…';
    // the figure renderer converges by itself (no waiting on the status line); `out` writes the PNG
    // into the project — the routine step's file — and the download stays for an interactive run
    const cv = HK.renderFigureCanvas(params.figScale || 1);
    if (params.out && S.project && S.project.dir) {
      const blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('the figure could not be encoded'))), 'image/png'));
      const fh = await resolveFileHandle(S.project.dir, String(params.out), { create: true });
      const w = await fh.createWritable(); await w.write(blob); await w.close();
      window._lastFigure = blob;
      $('#meta').textContent = `figure → ${params.out}`;
      return { out: String(params.out) };
    }
    _figureDownload(cv);
    return { out: null };
  } finally {
    applyCamera(prev.camera); setBg(prevBgPref);
    Object.assign(_deco, prev.deco); saveDeco();
    applySection(prev.section); applyCutModes(prev.cutModes);   // put the section + cut modes back
    drawDecorations(); requestRender();
    if (_decoWin && _decoWin._render) _decoWin._render();
  }
}
