// micro — a SECTION SERIES: the current section repeated at a fixed spacing across
// the data, each one rendered as a figure (to convergence, decorations on, titled
// with its position), packed into one .zip with a printable index page — the pack
// a model review ends with. The camera moves WITH the plane (the same Δ along its
// normal), so every sheet is framed alike; the section and the camera are put back
// afterwards. Nothing leaves the machine.
import { S, requestRender } from './state.js';
import { applyCamera, captureCamera } from './camera.js';
import { captureSection, applySection, currentSection, secRange, sectionWorld, setSectionWorld } from './section.js';
import { floatWin, raiseWindow } from './windows.js';
import { deliverBlob } from './hostio.js';
import { _deco, setDecoTitle, saveDeco, drawDecorations } from './deco.js';
import { createZipStreamWriter } from '../../../ext/archive/src/zipstream.js';
import { sceneOrigin } from './coords.js';
const $ = (s) => document.querySelector(s);

let HK = {};
/** The app's side: renderFigureCanvas. */
export function setSeriesHooks(h) { HK = h; }

const MODE_WORD = { plan: 'plan', ew: 'E–W section', ns: 'N–S section', custom: 'section', knife: 'section' };

/** The section's extent across the data, in world units along its normal: [lo, hi]. */
export function seriesExtent() {
  const s = currentSection(); if (!s) return null;
  const [lo, hi] = secRange();
  const o = sceneOrigin();
  const off = s.n[0] * o[0] + s.n[1] * o[1] + s.n[2] * o[2];
  return [lo + off, hi + off];
}

/** The positions of a series from `from` to `to` every `step` (inclusive, ends kept). */
export function seriesPositions(from, to, step) {
  if (!(step > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  const out = [], dir = to >= from ? 1 : -1;
  for (let k = 0; k < 10000; k++) { const p = from + dir * k * step; if (dir > 0 ? p > to + 1e-9 : p < to - 1e-9) break; out.push(+p.toFixed(6)); }
  return out;
}

const blobOf = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('a sheet failed to render'))), 'image/png'));
const pad = (n, w) => String(n).padStart(w, '0');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Render the series. → { blob (zip), sheets: [{ name, position }], mode }.
 * opts: from, to, step (world units along the section normal), scale, decorations, onProgress, signal.
 */
export async function renderSectionSeries({ from, to, step, scale = 1, decorations = true, title = null, onProgress = null, signal = null } = {}) {
  const w0 = sectionWorld();
  if (!w0) throw new Error('turn a section on first');
  if (w0.clip !== 'slab') throw new Error('a series steps a slab — set the section to “slab”, not a half-space');
  const pos = seriesPositions(from, to, step);
  if (!pos.length) throw new Error('nothing to render — check from, to and the step');
  if (pos.length > 500) throw new Error(`${pos.length} sections — keep it under 500 (a larger step)`);
  if (!HK.renderFigureCanvas) throw new Error('figure renderer missing');
  const cam0 = captureCamera(), sec0 = captureSection(), title0 = _deco.titleText, titleOn0 = _deco.title;
  const n = w0.normal, word = MODE_WORD[w0.mode] || 'section';
  const base = title || title0 || '';
  const chunks = [];
  const zip = createZipStreamWriter({ write: (b) => { chunks.push(b.slice()); } });
  const sheets = [];
  const width = String(Math.round(Math.max(Math.abs(from), Math.abs(to)))).length;
  try {
    for (let k = 0; k < pos.length; k++) {
      if (signal && signal.aborted) throw new Error('cancelled');
      const p = pos[k];
      setSectionWorld({ position: p });
      const d = p - w0.position;
      applyCamera({ ...cam0, target: [cam0.target[0] + d * n[0], cam0.target[1] + d * n[1], cam0.target[2] + d * n[2]] });
      const label = `${word} ${+p.toFixed(2)}${w0.thickness ? ` ± ${+(w0.thickness / 2).toFixed(2)}` : ''}`;
      if (decorations) setDecoTitle(base ? `${base} — ${label}` : label);
      const cv = HK.renderFigureCanvas(scale, { decorations });
      const name = `${pad(k + 1, 3)}-${w0.mode}-${p < 0 ? 'm' : ''}${pad(Math.abs(Math.round(p)), width)}.png`;
      await zip.add(name, new Uint8Array(await (await blobOf(cv)).arrayBuffer()), { aligned: false, mtime: Date.now() });
      sheets.push({ name, position: p, label });
      if (onProgress) onProgress(k + 1, pos.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(base || 'section series')}</title>
<style>body{font:13px system-ui,sans-serif;margin:24px;color:#222}h1{font-size:18px}figure{margin:0 0 24px;page-break-inside:avoid}img{max-width:100%;border:1px solid #ccc}figcaption{color:#555;margin-top:4px}@media print{figure{page-break-after:always}}</style>
<h1>${esc(base || 'section series')}</h1><p>${pos.length} ${esc(word)}s every ${esc(step)} m, ${esc(from)} to ${esc(to)}${w0.thickness ? `, slab ± ${esc(w0.thickness / 2)} m` : ''} — micro, ${esc(new Date().toISOString().slice(0, 10))}</p>
${sheets.map((s) => `<figure><img src="${esc(s.name)}" alt="${esc(s.label)}"><figcaption>${esc(s.label)}</figcaption></figure>`).join('\n')}
`;
    await zip.add('index.html', html, { aligned: false, mtime: Date.now() });
    await zip.finish();
  } finally {
    applySection(sec0);
    applyCamera(cam0);
    if (decorations) { _deco.titleText = title0; _deco.title = titleOn0; saveDeco(); drawDecorations(); }
    requestRender();
  }
  return { blob: new Blob(chunks, { type: 'application/zip' }), sheets, mode: w0.mode };
}

let _win = null;
export function openSectionSeries() {
  if (_win && _win.el.isConnected) { raiseWindow(_win.el); return _win; }
  const ext = seriesExtent();
  if (!ext) { $('#meta').textContent = 'section series: turn a section on first (the section control, or x)'; return null; }
  const w0 = sectionWorld();
  const win = floatWin({ title: 'section series', sub: MODE_WORD[w0.mode] || 'section', x: Math.max(12, innerWidth - 360), y: 110, w: 330, h: 330, onClose: () => { if (ctl) ctl.abort(); _win = null; } });
  _win = win;
  let ctl = null;
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;font-family:var(--mono);font-size:12px';
  const field = (label, el, title) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px'; if (title) r.title = title; const s = document.createElement('span'); s.style.cssText = 'flex:1;color:var(--text)'; s.textContent = label; r.append(s, el); win.body.appendChild(r); return el; };
  const num = (v) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'number'; i.step = 'any'; i.value = String(v); i.style.cssText = 'flex:0 0 96px;width:96px'; return i; };
  const half = w0.thickness ? w0.thickness / 2 : 5;
  const stepGuess = Math.max(2 * half, +(((ext[1] - ext[0]) / 10)).toPrecision(1));
  const fromIn = field('from', num(+(ext[0] + half).toFixed(2)), 'the first section, in world units along the section normal');
  const toIn = field('to', num(+(ext[1] - half).toFixed(2)));
  const stepIn = field('every', num(stepGuess), 'the spacing between sections');
  const res = field('resolution', (() => { const s = document.createElement('select'); s.className = 'sw-sel'; s.append(new Option('1× (screen)', '1'), new Option('2×', '2')); return s; })());
  const count = document.createElement('div'); count.style.cssText = 'color:var(--muted)';
  const upd = () => { const n = seriesPositions(+fromIn.value, +toIn.value, +stepIn.value).length; count.textContent = `${n} section${n === 1 ? '' : 's'} · slab ± ${+half.toFixed(2)} m · the camera moves with each`; };
  for (const i of [fromIn, toIn, stepIn]) i.oninput = upd;
  win.body.appendChild(count); upd();
  const note = document.createElement('div'); note.style.cssText = 'color:var(--dim);font-size:11px;line-height:1.5';
  note.textContent = 'one .zip: a PNG per section (decorations on, titled with its position) and an index.html to print';
  win.body.appendChild(note);
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:auto';
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Render';
  const prog = document.createElement('span'); prog.style.cssText = 'flex:1;color:var(--muted)';
  row.append(go, prog); win.body.appendChild(row);
  go.onclick = async () => {
    if (ctl) { ctl.abort(); return; }
    ctl = new AbortController(); go.textContent = 'Cancel';
    try {
      const r = await renderSectionSeries({ from: +fromIn.value, to: +toIn.value, step: +stepIn.value, scale: +res.value, signal: ctl.signal, onProgress: (i, n) => { prog.textContent = `section ${i} of ${n}`; } });
      const nm = `${(_deco.titleText || 'micro').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'micro'}-sections-${r.mode}.zip`;
      prog.textContent = `${r.sheets.length} sections → ${nm}`;
      $('#meta').textContent = `section series saved as ${nm}`;
      deliverBlob(r.blob, nm);
    } catch (e) { prog.textContent = e.message; }
    finally { ctl = null; go.textContent = 'Render'; }
  };
  return win;
}
