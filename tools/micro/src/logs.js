// micro — LOG TRACKS on drillholes: any number of value tracks beside each hole, like the tracks of a
// downhole log — FE as bars on the right, SG on the left, LITO as a coloured strip on the trace.
// Each track: a column, a kind (bar: the ribbon's width IS the value on the track's scale · strip: a
// constant ribbon coloured by the value — classes for a text column, a ramp for a number), a side
// (left / right of the hole on the SCREEN, or centred on it), an offset and a width (metres), a scale
// and a colour. The ribbons face the viewer in 3D and the screen in a section (@gcu/condenser
// gl-logs.js — a billboard per interval per track over the sticks' own buffers; nothing new streamed).
// Filters and sections apply as to the sticks. The decorations legend lists the tracks; a figure
// renders them as the view does. Saved with the layer's display state (src/layer-display.js).
import { S, activeLayer, requestRender } from './state.js';
import { layerTableHeader, schemaExt, extendRow, numOf } from './records.js';
import { numericColsOf } from './analysis.js';
import { RAMP_PRESETS, bakeRampPixels } from './ramp.js';
import { categoryPalettePixels } from '../../../ext/condenser/src/main.js';
import { floatWin } from './windows.js';
import { registerCommands, contributeMenu } from './commands.js';
import { addLegendExtra, _label } from './deco.js';
import { fmtStat } from './analysis-ui.js';
const $ = (s) => document.querySelector(s);

export const LOG_SIDES = ['right', 'left', 'center'];
export const LOG_KINDS = ['bar', 'strip'];
const PALETTE = ['#e8913a', '#4aa3df', '#6cc070', '#d9c24a', '#c96bd1', '#e06464', '#9aa5b1'];
const nameOf = (L) => (L ? L.label || L.name : '?');
export const isLogLayer = (L) => !!(L && L.dh && L.docs && L.docs.dhDoc && !L.trace);
export const logTracksOf = (L) => (L && Array.isArray(L.logs) ? L.logs : []);
const radiusOf = (L) => (S.renderer && S.renderer.layerStickRadius ? S.renderer.layerStickRadius(L.id) : 1) || 1;

// the columns a track can read: every numeric one (bars, ramp strips) and every text one (class strips)
export function logColumnsOf(L) {
  const h = layerTableHeader(L); if (!h) return { num: [], text: [] };
  const schema = schemaExt(L, h), num = numericColsOf(L), m = h.mapping || {};
  const im = h.intervalMapping || (L.docs.dhDoc && L.docs.dhDoc.header.intervalMapping) || {};     // the hole id and FROM / TO are the trace, not a track
  const skip = new Set([m.x, m.y, m.z, im.from, im.to, im.hole, im.bhid, im.id].filter((i) => i != null && i >= 0));
  const text = schema.filter((c, i) => c.type === 'string' && !skip.has(i) && !/^(hole_?id|bhid|from|to|depth_?from|depth_?to)$/i.test(c.name)).map((c) => c.name);
  return { num, text: [...new Set(text)].filter((t) => !num.includes(t)) };
}

// read one column over every interval → { values: Float32Array (NaN = blank), lo, hi } or, for a text
// column, the codes (1..255 by first appearance; 0 = blank) + the class names
function readColumn(L, col) {
  const dh = L.docs.dhDoc, h = layerTableHeader(L), schema = schemaExt(L, h);
  const ci = schema.findIndex((c) => c.name === col || c.name.toLowerCase() === String(col).toLowerCase());
  if (ci < 0) throw new Error(`${nameOf(L)} has no column “${col}”`);
  const text = schema[ci].type === 'string' && !numericColsOf(L).includes(schema[ci].name);
  const n = dh.header.count, values = new Float32Array(n).fill(NaN), dict = [null];
  const codeOf = new Map();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const f = extendRow(L, dh.fetchRecord(i), i), raw = f[ci];
    if (text) {
      if (raw == null || raw === '') continue;
      const k = String(raw);
      let c = codeOf.get(k);
      if (c == null) { if (dict.length >= 256) continue; c = dict.length; dict.push(k); codeOf.set(k, c); }
      values[i] = c;
    } else {
      const v = numOf(raw); if (!Number.isFinite(v)) continue;
      values[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
  }
  return text ? { values, text: true, dict } : { values, text: false, lo: lo === Infinity ? 0 : lo, hi: hi === -Infinity ? 1 : hi };
}
const hexRgb = (hex) => { const n = parseInt(String(hex || '#e8913a').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// the track as saved: { col, kind, side, offset, width, min, max, color, ramp } — offset / width in
// metres (null = automatic: beside the stick, stacked out from earlier tracks on the same side)
function normTrack(t, i) {
  return {
    col: String(t.col), kind: LOG_KINDS.includes(t.kind) ? t.kind : 'bar', side: LOG_SIDES.includes(t.side) ? t.side : 'right',
    offset: Number.isFinite(+t.offset) && t.offset !== null && t.offset !== '' ? +t.offset : null,
    width: Number.isFinite(+t.width) && +t.width > 0 ? +t.width : null,
    min: t.min === null || t.min === '' || t.min === undefined || !Number.isFinite(+t.min) ? null : +t.min,
    max: t.max === null || t.max === '' || t.max === undefined || !Number.isFinite(+t.max) ? null : +t.max,
    color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : PALETTE[i % PALETTE.length],
    ramp: t.ramp ? String(t.ramp in RAMP_PRESETS ? t.ramp : 'viridis') : null,
  };
}

// set a layer's tracks (replaces them all) and draw them → the resolved tracks (offsets, widths and
// scales filled in), for the legend and the host
export async function setLogTracks(L, tracks, { quiet = false } = {}) {
  if (!isLogLayer(L)) throw new Error(`log tracks: ${nameOf(L)} is not a drillhole layer`);
  const list = (tracks || []).map(normTrack);
  const r = radiusOf(L);
  // side tracks start clear of the stick — and of a centred strip's band round it
  const band = Math.max(0, ...list.filter((t) => t.side === 'center').map((t) => (t.width != null ? t.width : r * 3.5) / 2 + Math.abs(t.offset || 0)));
  const used = { left: Math.max(r * 1.5, band + r * 0.3), right: Math.max(r * 1.5, band + r * 0.3) };
  const eng = [], resolved = [];
  for (const t of list) {
    const col = readColumn(L, t.col);
    if (t.kind === 'bar' && col.text) throw new Error(`log tracks: “${t.col}” is text — a text column is a strip (classes)`);
    // a centred strip is a band round the stick (wider than it, so it shows either side); a side
    // track starts clear of the stick
    const width = t.width != null ? t.width : t.side === 'center' ? r * 3.5 : t.kind === 'strip' ? r * 1.5 : r * 5;
    let offset = t.offset;
    if (offset == null) {
      if (t.side === 'center') offset = 0;
      else { offset = used[t.side]; used[t.side] += width + r * 0.6; }
    } else if (t.side !== 'center') used[t.side] = Math.max(used[t.side], offset + width + r * 0.6);
    const lo = col.text ? 0 : t.min != null ? t.min : t.kind === 'bar' ? Math.min(0, col.lo) : col.lo;
    const hi = col.text ? 255 : t.max != null ? t.max : col.hi;
    const ramp = !col.text && (t.kind === 'strip' || t.ramp) ? bakeRampPixels({ preset: t.ramp || 'viridis', classed: false, breaks: [] }, lo, hi > lo ? hi : lo + 1) : null;
    let palette = null;
    if (col.text) {
      palette = categoryPalettePixels(256);
      // the layer's own class colours, when its class legend is on this column
      const leg = L.catLegend && L.catLegend.col === t.col ? L.catLegend : null, by = new Map();
      if (leg) for (const e of leg.entries || []) for (const v of e.values || []) if (typeof v === 'string') by.set(v, e.color);
      col.dict.forEach((k, c) => { const hex = c && by.get(k); if (hex && /^#[0-9a-f]{6}$/i.test(hex)) { const v = parseInt(hex.slice(1), 16); palette.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], c * 4); } });
    }
    eng.push({ values: col.values, kind: t.kind, side: t.side, offset, width, range: [lo, hi > lo ? hi : lo + 1], color: hexRgb(t.color), ramp, palette });
    resolved.push({ ...t, _offset: offset, _width: width, _lo: lo, _hi: hi, _dict: col.text ? col.dict : null, _ramp: ramp, _palette: palette });
  }
  L.logs = list.length ? list : undefined;
  L._logsResolved = resolved;
  S.renderer.setLayerLogs(L.id, eng);
  dispatchEvent(new Event('micro:project-dirty'));
  requestRender();
  if (!quiet) $('#meta').textContent = list.length ? `log tracks (${nameOf(L)}): ${list.map((t) => `${t.col} ${t.kind} ${t.side}`).join(' · ')}` : `log tracks (${nameOf(L)}): none`;
  return resolved;
}
export const addLogTrack = (L, t) => setLogTracks(L, [...logTracksOf(L), t]);
export const removeLogTrack = (L, i) => setLogTracks(L, logTracksOf(L).filter((_, k) => k !== i));

// ── the legend (src/deco.js draws it under the layer's colour legend) ──
export function logLegendRows(L) {
  if (!L || !L.visible || !L._logsResolved || !L._logsResolved.length) return [];
  return L._logsResolved.map((t) => ({ col: t.col, kind: t.kind, side: t.side, color: t.color, lo: t._lo, hi: t._hi, dict: t._dict, ramp: t._ramp, palette: t._palette }));
}

// drawn under the layer's colour legend in the decorations (and so in the quick figure): one row
// per track — its swatch (the bar's colour, the strip's ramp, or its first classes), the column,
// the side and the scale
// registered after the module graph has loaded: deco.js sits in the same import cycle, so its
// export may not be initialised while this module evaluates (tools/micro/dev/cycles.mjs)
queueMicrotask(() => addLegendExtra((g, L, bx, by) => {
  const rows = logLegendRows(L); if (!rows.length) return 0;
  g.font = '11px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  _label(g, `logs · ${nameOf(L)}`.slice(0, 22), bx, by + 4);
  let y = by + 18;
  g.textBaseline = 'middle';
  for (const t of rows) {
    if (t.dict) {                                           // a class strip: up to four classes, then a count
      const names = t.dict.slice(1, 5), pal = t.palette;
      names.forEach((k, i) => { const c = i + 1; g.fillStyle = `rgb(${pal[c * 4]},${pal[c * 4 + 1]},${pal[c * 4 + 2]})`; g.fillRect(bx + i * 7, y - 6, 6, 12); });
      _label(g, `${t.col} ${t.side}${t.dict.length > 5 ? ` · ${t.dict.length - 1} classes` : ''}`.slice(0, 20), bx + 34, y);
    } else {
      if (t.ramp) for (let i = 0; i < 28; i++) { const k = Math.round(i / 27 * 255) * 4; g.fillStyle = `rgb(${t.ramp[k]},${t.ramp[k + 1]},${t.ramp[k + 2]})`; g.fillRect(bx + i, y - 6, 1, 12); }
      else { g.fillStyle = t.color; g.fillRect(bx, y - 4, 28, 8); }
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, y - 6, 28, 12);
      _label(g, `${t.col} ${t.side} ${fmtStat(t.lo)}–${fmtStat(t.hi)}`.slice(0, 22), bx + 34, y);
    }
    y += 17;
  }
  return y - by;
}));

// ── the window ──
let _win = null;
export function openLogsWindow(L0) {
  const Ls = S.layers.filter(isLogLayer);
  if (!Ls.length) { $('#meta').textContent = 'drillhole logs: open a drillhole set first'; return null; }
  const L = isLogLayer(L0) ? L0 : Ls[0];
  if (_win && _win.el.isConnected) _win.close();
  const win = floatWin({ title: 'drillhole logs', sub: nameOf(L), x: Math.max(12, innerWidth - 520), y: 110, w: 500, h: 380, onClose: () => { _win = null; } });
  _win = win; win.el.dataset.logs = '1';
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px;overflow-y:auto';
  const cols = logColumnsOf(L);
  const rows = document.createElement('div'); rows.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'each track is a ribbon beside every hole: a BAR is as wide as the value on its scale, a STRIP is coloured by it (a text column: its classes). Sides are the screen’s; blank offset / width = beside the stick, stacked. Ribbons face you in 3D and the screen in a section.';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center';
  const add = document.createElement('button'); add.className = 'awin-btn'; add.textContent = '+ track'; add.dataset.add = '1';
  const msg = document.createElement('span'); msg.style.cssText = 'flex:1;color:var(--muted)';
  bar.append(add, msg);
  win.body.append(rows, bar, note);
  let draft = logTracksOf(L).map((t) => ({ ...t }));
  const apply = async () => { try { await setLogTracks(L, draft, { quiet: true }); msg.textContent = draft.length ? `${draft.length} track${draft.length === 1 ? '' : 's'}` : 'no tracks'; } catch (e) { msg.textContent = e.message; } };
  const sel = (opts, val, on) => { const s = document.createElement('select'); s.className = 'sw-sel'; for (const [v, t] of opts) s.append(new Option(t, String(v))); s.value = String(val ?? ''); s.onchange = () => on(s.value); return s; };
  const num = (val, ph, on) => { const i = document.createElement('input'); i.className = 'sw-in'; i.style.width = '54px'; i.placeholder = ph; i.value = val == null ? '' : String(val); i.onchange = () => on(i.value.trim() === '' ? null : +i.value); return i; };
  const render = () => {
    rows.textContent = '';
    draft.forEach((t, i) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap'; r.dataset.track = String(i);
      const isText = cols.text.includes(t.col);
      r.append(
        sel([...cols.num.map((c) => [c, c]), ...cols.text.map((c) => [c, c + ' (text)'])], t.col, (v) => { t.col = v; if (cols.text.includes(v)) t.kind = 'strip'; render(); apply(); }),
        sel(isText ? [['strip', 'strip']] : [['bar', 'bar'], ['strip', 'strip']], t.kind, (v) => { t.kind = v; apply(); }),
        sel(LOG_SIDES.map((s) => [s, s]), t.side, (v) => { t.side = v; apply(); }),
        num(t.width, 'width', (v) => { t.width = v; apply(); }),
        num(t.offset, 'offset', (v) => { t.offset = v; apply(); }),
        ...(isText ? [] : [num(t.min, 'min', (v) => { t.min = v; apply(); }), num(t.max, 'max', (v) => { t.max = v; apply(); })]),
      );
      if (!isText && t.kind === 'bar') { const c = document.createElement('input'); c.type = 'color'; c.value = t.color || PALETTE[i % PALETTE.length]; c.oninput = () => { t.color = c.value; apply(); }; r.append(c); }
      const x = document.createElement('button'); x.className = 'awin-btn'; x.textContent = '×'; x.title = 'remove this track'; x.onclick = () => { draft.splice(i, 1); render(); apply(); };
      r.append(x);
      rows.appendChild(r);
    });
  };
  add.onclick = () => {
    const used = new Set(draft.map((t) => t.col));
    const col = cols.num.find((c) => !used.has(c)) || cols.text.find((c) => !used.has(c)) || cols.num[0] || cols.text[0];
    if (!col) { msg.textContent = 'no column to log'; return; }
    const text = cols.text.includes(col), sides = draft.filter((t) => t.side !== 'center').length;
    draft.push({ col, kind: text ? 'strip' : 'bar', side: text ? 'center' : sides % 2 ? 'left' : 'right', color: PALETTE[draft.length % PALETTE.length] });
    render(); apply();
  };
  render();
  return win;
}

registerCommands([
  { id: 'dh-logs', group: 'Drillholes', title: 'Drillhole logs…', kw: 'log tracks downhole bars strips ribbons fe sg lithology beside the hole multi value', when: () => S.layers.some(isLogLayer), run: (c) => openLogsWindow(c.L) },
]);
contributeMenu('view', () => (S.layers.some(isLogLayer) ? [{ label: 'Drillhole logs…', action: () => openLogsWindow(activeLayer()) }] : []));

try { window._microVis = Object.assign(window._microVis || {}, { setLogTracks, addLogTrack, removeLogTrack, logTracksOf, openLogsWindow, logLegendRows }); } catch { /* headless */ }
