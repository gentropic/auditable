// micro — the DECORATIONS overlay and the figure: scale bar, north arrow, colour legends
// and title, drawn live on the 2D overlay and captured verbatim by Export figure; the
// background colour (the ink flips on a light one); the decorations panel; and the
// figure recipe. The app owns the camera, the render loop and the overlay canvas.
import { hexToRgb01 } from './open.js';
import { RAMP_PRESETS, colorSelOf, ensureLegend, layerClassInfo, rampCfgOf, rampRangeFor, rampSample } from './props.js';
import { layerTableHeader } from './records.js';
import { S, activeLayer } from './state.js';
import { fmtStat } from './analysis-ui.js';
import { floatWin, focusWindow } from './windows.js';
import { saveRecipe } from './recipes.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setDecoHooks): applyCamera, applySection, cam, captureCamera, captureSection, cv, deliverBlob, renderFigureCanvas, renderer, requestRender
let HK = {};
export function setDecoHooks(h) { HK = h; }

// ── viewport decorations (scale bar · north · legend · title) — a 2D overlay
// that shows LIVE and is captured verbatim by figure export. One draw routine
// serves both (the live #decoCv and the export canvas). ──
export let _deco = (() => { try { return Object.assign({ scale: false, north: false, legend: false, title: false, titleText: '' }, JSON.parse(localStorage.getItem('micro.deco') || '{}')); } catch { return { scale: false, north: false, legend: false, title: false, titleText: '' }; } })();

export function saveDeco() { try { localStorage.setItem('micro.deco', JSON.stringify(_deco)); } catch { /* private mode */ } }

// background colour (renderer clear + the figure backdrop). Decorations pick a
// contrasting ink from its luminance, so white-bg report figures stay readable.
export let _bgColor = (() => { try { return localStorage.getItem('micro.bg') || '#121212'; } catch { return '#121212'; } })();

export let _deInk = { fg: '#fff', bg: 'rgba(0,0,0,0.6)' };

export function decoInk() { const c = hexToRgb01(_bgColor), lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return lum > 0.55 ? { fg: '#151515', bg: 'rgba(255,255,255,0.7)' } : { fg: '#fff', bg: 'rgba(0,0,0,0.6)' }; }

export function applyBg() { if (HK.renderer && HK.renderer.setBackground) { HK.renderer.setBackground(hexToRgb01(_bgColor)); HK.requestRender(); } }

export function setBg(hex) { if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return; _bgColor = hex; try { localStorage.setItem('micro.bg', hex); } catch { /* ignore */ } applyBg(); drawDecorations(); }

export function niceNum(x) { if (!(x > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e; }

export function fmtLen(m) { return m >= 1000 ? +(m / 1000).toPrecision(3) + ' km' : (m < 1 ? +m.toPrecision(2) : +m.toFixed(m < 10 ? 1 : 0)) + ' m'; }

export function worldPerPixel() {
  const vp = HK.cam.state.viewProj, v = HK.cam.state.view, t = HK.cam.state.target; if (!vp || !v || !t) return null;
  let Rw = [v[0], v[4], v[8]]; const rl = Math.hypot(Rw[0], Rw[1], Rw[2]) || 1; Rw = [Rw[0] / rl, Rw[1] / rl, Rw[2] / rl];
  const r = HK.cv.getBoundingClientRect();
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
  _label(g, (HK.cam.state.ortho ? '' : '~') + fmtLen(barWorld), x, y - 9);
}

export function drawNorthArrow(g, W, H) {
  const v = HK.cam.state.view; if (!v) return;
  let nx = v[4], ny = -v[9]; const m = Math.hypot(nx, ny); if (m < 1e-3) return; nx /= m; ny /= m;
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

// legend title shown when the user hasn't overridden it — the coloured attribute
export function legendDefaultTitle(L) {
  const sel = colorSelOf(L);
  if (String(sel).startsWith('chan:')) { const h = layerTableHeader(L); return (h && h.columns[+sel.slice(5)]) || 'value'; }
  return L.label || L.name || '';
}

// can this layer show a legend at all? (a continuous ramp with a range, or classes)
export function legendAvailable(L) {
  const sel = colorSelOf(L);
  if (String(sel).startsWith('chan:')) return !!rampRangeFor(L);
  const info = layerClassInfo(L); if (!info) return false; const leg = ensureLegend(L, info); return !!(leg && leg.entries && leg.entries.length);
}

export function legendLayers() { return S.layers.filter((L) => L.legend && L.visible && legendAvailable(L)); }

export function anyLegend() { return legendLayers().length > 0; }

// draw ONE legend for layer L at (bx, by); returns the vertical extent consumed
// (so multiple legends can stack down the right column). Caption defaults to the
// coloured attribute name, overridable per-layer via L.legendTitle.
export function drawOneLegend(g, L, bx, by) {
  const sel = colorSelOf(L), bw = 15;
  const cap = (L.legendTitle && L.legendTitle.trim()) || legendDefaultTitle(L);
  if (String(sel).startsWith('chan:')) {
    const cfg = rampCfgOf(L) || { preset: 'viridis' }, stops = RAMP_PRESETS[cfg.preset] || RAMP_PRESETS.viridis, rng = rampRangeFor(L);
    if (!rng) return 0; const [lo, hi] = rng, bh = 118;
    if (cap) { g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; _label(g, cap, bx, by - 7); }
    for (let i = 0; i < bh; i++) { const c = rampSample(stops, 1 - i / bh); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(bx, by + i, bw, 1); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    _label(g, fmtStat(hi), bx + bw + 5, by); _label(g, fmtStat((lo + hi) / 2), bx + bw + 5, by + bh / 2); _label(g, fmtStat(lo), bx + bw + 5, by + bh);
    return bh + 12;
  } else {
    const info = layerClassInfo(L); if (!info) return 0; const leg = ensureLegend(L, info); if (!leg || !leg.entries) return 0;
    let y = by;
    if (cap) { g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; _label(g, cap, bx, y - 7); }
    g.textBaseline = 'middle';
    for (const e of leg.entries.slice(0, 12)) { g.fillStyle = e.color; g.fillRect(bx, y - 6, 12, 12); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, y - 6, 12, 12); _label(g, String(e.values ? e.values[0] : e.label || ''), bx + 17, y); y += 17; }
    return (y - by) + 4;
  }
}

export function drawLegendsDeco(g, W, H) {
  const bx = W - 148 - _rightInset(); let by = 84;
  for (const L of legendLayers()) { const used = drawOneLegend(g, L, bx, by); if (used) by += used + 16; }
}

export function renderDeco(g, W, H) {
  _deInk = decoInk();
  if (_deco.scale) drawScaleBar(g, W, H);
  if (_deco.north) drawNorthArrow(g, W, H);
  drawLegendsDeco(g, W, H);
  if (_deco.title) drawTitleDeco(g, W, H);
}

export function drawDecorations() {
  const dc = $('#decoCv'), r = HK.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
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
    const fname = `figure_${stem}.png`; HK.deliverBlob(blob, fname);
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
    for (const [name, hex] of [['basalt', '#121212'], ['black', '#000000'], ['white', '#ffffff'], ['paper', '#f4f2ec']]) {
      const b = document.createElement('button'); b.className = 'deco-sw' + (_bgColor.toLowerCase() === hex ? ' on' : ''); b.style.background = hex; b.title = name;
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
    const rcp = document.createElement('button'); rcp.className = 'deco-export rcp'; rcp.textContent = 'save as recipe…'; rcp.title = 'save this view + decorations + background + resolution as a re-runnable figure recipe (Tools → Recipes)';
    rcp.onclick = () => saveRecipe('figure', captureFigureCfg(), _deco.titleText || 'figure');
    foot.append(rcp); wrap.append(foot);
  };
  win._render = render;
  render();
}

export function decorationsMenu() { openDecoPanel(); }

// ── the FIGURE recipe: camera + decorations + background + export scale.
// Running applies the lot, waits for the render to converge, exports the PNG,
// then RESTORES everything it touched (temporary changes give back what they
// took). "The monthly plan-view figure" regenerates itself. ──
// per-layer cut modes captured BY NAME (only non-default: false/'front'/'behind');
// applying resets everything to follow, then sets the listed overrides
export function captureCutModes() {
  return S.layers.map((L) => ({ layer: L.name, mode: HK.renderer.layerSectioned(L.id) })).filter((x) => x.mode !== true);
}

export function applyCutModes(modes) {
  for (const L of S.layers) HK.renderer.setLayerSectioned(L.id, true);   // reset to follow
  for (const { layer, mode } of (modes || [])) { const L = S.layers.find((x) => x.name === layer); if (L) HK.renderer.setLayerSectioned(L.id, mode); }
}

// a figure recipe captures the whole picture: camera + decorations + background
// + export scale + the SECTION (position, thickness, orientation) + per-layer
// cut modes — so "the monthly plan/section figure" reproduces exactly.
export function captureFigureCfg() { return { camera: HK.captureCamera(), bg: _bgColor, deco: { ..._deco }, figScale: _figScale, section: HK.captureSection(), cutModes: captureCutModes() }; }

export async function runFigureRecipe(params) {
  const prev = captureFigureCfg();
  try {
    if (params.camera) HK.applyCamera(params.camera);
    if (params.bg) setBg(params.bg);
    if (params.deco) { Object.assign(_deco, params.deco); saveDeco(); }
    if (params.section) HK.applySection(params.section);       // the section IS the figure for a section plot
    if (params.cutModes) applyCutModes(params.cutModes);
    drawDecorations(); HK.requestRender();
    $('#meta').textContent = 'figure recipe: rendering…';
    await new Promise((res) => { const t0 = performance.now(); const t = setInterval(() => { if (/converged/.test($('#stats').textContent) || performance.now() - t0 > 20000) { clearInterval(t); res(); } }, 150); });
    exportFigure(params.figScale || 1);
  } finally {
    HK.applyCamera(prev.camera); setBg(prev.bg);
    Object.assign(_deco, prev.deco); saveDeco();
    HK.applySection(prev.section); applyCutModes(prev.cutModes);   // put the section + cut modes back
    drawDecorations(); HK.requestRender();
    if (_decoWin && _decoWin._render) _decoWin._render();
  }
}
