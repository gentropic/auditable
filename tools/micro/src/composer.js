// micro — the COMPOSER: a page (A4/A3/…, portrait or landscape, or a size in mm) with frames on
// it, laid out freely — 3D views, legends, scale bars, north arrows, captions, plots from the
// analysis windows — printed as one PDF or PNG. The page itself is @gcu/compo; micro supplies
// what goes in the frames.
//
// A 3D-view frame REMEMBERS its scene (camera · section · layer visibility / colour / filter, the
// background) and renders at its own size and aspect, so:
// - "Update from the 3D view" re-captures it;
// - "Show in the 3D view" puts the scene back;
// - export re-renders it at the print DPI.
// The legend / scale bar / north frames read the view frame they refer to, so they follow it.
//
// Figures live in the project as figures/<name>.compo.json — plain JSON, the frames' last
// renders inlined, so a figure opens without re-rendering anything.
import { S, requestRender } from './state.js';
import { floatWin } from './windows.js';
import { deliverBlob } from './hostio.js';
import { captureScene, applyScene } from './views.js';
import { legendSpec, legendDefaultTitle, _bgColor, applyBg } from './deco.js';
import { microPrompt, microConfirm } from './prompts.js';
import { resolveFileHandle, removeFileAt } from './paths.js';
import { setSectionWorld } from './section.js';
import { rendererDocBbox } from './layers.js';
import { createDocument, parseDocument, serializeDocument, mountEditor, exportPDF, exportPNG, frameById, pageDims, tableFromTsv } from '../../../ext/compo/index.js';
const $ = (s) => document.querySelector(s);

// the app's side (setComposerHooks): renderViewCanvas(pxW, pxH) → a canvas rendered to convergence
let HK = {};
export function setComposerHooks(h) { HK = h; }

const PREVIEW_PX_PER_MM = 6;                               // ≈150 dpi on screen; export re-renders at the print dpi
const MAX_PX = 6000;
const slug = (s) => (String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure').toLowerCase();
const hexRgb01 = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ── the view: what a frame needs to know about the camera right now ──
function viewMeta(pxH) {
  const st = S.cam.state, v = st.view;
  const meta = { ortho: !!st.ortho, zExag: st.zExag || 1 };
  if (v) {
    const nx = v[4], ny = -v[9], m = Math.hypot(nx, ny);    // north's direction on screen (x right, y down)
    meta.north = m < 1e-3 ? null : +((Math.atan2(nx / m, -ny / m) * 180) / Math.PI).toFixed(2);
  }
  // an orthographic view has ONE scale: its visible height (2·halfH, world units) over the image's
  // pixels. A perspective view has none — the scale bar says so rather than guess.
  if (st.ortho && st.halfH > 0) meta.worldPerPx = (2 * st.halfH) / pxH;
  return meta;
}
const pxFor = (f, pxPerMm) => {
  let w = Math.round(f.box[2] * pxPerMm), h = Math.round(f.box[3] * pxPerMm);
  const k = Math.min(1, MAX_PX / Math.max(w, h)); w = Math.max(16, Math.round(w * k)); h = Math.max(16, Math.round(h * k));
  return [w, h];
};
// render the CURRENT view into a frame-sized canvas, with this background
function renderInto(f, pxPerMm, bg) {
  const [w, h] = pxFor(f, pxPerMm);
  if (bg) S.renderer.setBackground(hexRgb01(bg));
  try { return { canvas: HK.renderViewCanvas(w, h), meta: viewMeta(h) }; } finally { if (bg) applyBg(); }
}
// a frame's own scene, put on the 3D view for the duration of fn, then the user's view back
async function withScene(scene, fn) {
  const mine = captureScene('__composer');
  await applyScene(scene);
  try { return await fn(); } finally { await applyScene(mine); $('#meta').textContent = ''; }
}
// the frame's last render, kept in the document (JPEG; a figure reopens without re-rendering)
function storeImage(f, canvas, meta) {
  f._img = canvas; f._jpeg = null;
  f.content = { ...f.content, width: canvas.width, height: canvas.height, meta, photo: true };
  try {
    const small = document.createElement('canvas');
    const k = Math.min(1, (PREVIEW_PX_PER_MM * Math.max(f.box[2], f.box[3])) / Math.max(canvas.width, canvas.height));
    small.width = Math.max(1, Math.round(canvas.width * k)); small.height = Math.max(1, Math.round(canvas.height * k));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    f.content.src = small.toDataURL('image/jpeg', 0.88);
  } catch { /* a tainted or lost canvas: the frame still shows this session */ }
  f.produced = new Date().toISOString();
}

// ── frames micro makes ──
function viewFrameContent(f) {
  const scene = captureScene(f.source && f.source.name || 'view');
  f.source = { app: 'micro', kind: 'view', scene, bg: _bgColor };
  const r = renderInto(f, PREVIEW_PX_PER_MM, null);
  storeImage(f, r.canvas, r.meta);
}
export function addViewFrame(ed, { box = null, border = true } = {}) {   // box: [x, y, w, h] mm — else sized to the canvas's aspect
  if (!S.layers.length) { $('#meta').textContent = 'composer: open some data first — a view frame renders the 3D view'; return null; }
  const doc = ed.getDoc(), [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const r = S.cv.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
  let w = Math.min(W - m[1] - m[3], 0.72 * (W - m[1] - m[3])), h = w / aspect;
  const hMax = H - m[0] - m[2] - 18; if (h > hMax) { h = hMax; w = h * aspect; }
  const f = ed.addFrame({ kind: 'image', box: box || [m[3], m[0], +w.toFixed(1), +h.toFixed(1)], content: { photo: true }, style: { border } });
  ed.update(f.id, (fr) => viewFrameContent(fr));
  $('#meta').textContent = 'composer: the 3D view went into a frame — resize it freely; "Update from the 3D view" re-captures it';
  return f;
}
// the view frame a legend / scale bar / north refers to: the selected one, else the topmost
const viewFrameOf = (doc, sel) => (sel && sel.find((f) => f.source && f.source.kind === 'view')) || [...doc.frames].reverse().find((f) => f.source && f.source.kind === 'view') || null;

export function legendContentFor(L) {
  const spec = legendSpec(L); if (!spec) return null;
  const title = (L.legendTitle && L.legendTitle.trim()) || legendDefaultTitle(L);
  const fmt = (v) => (Number.isFinite(v) ? +(+v).toPrecision(4) + '' : '');
  if (spec.kind === 'ramp') {
    const stops = [];
    for (let i = 0; i < 32; i++) { const o = Math.round((i / 31) * 255) * 4, p = spec.lut; stops.push(`rgb(${p[o]},${p[o + 1]},${p[o + 2]})`); }
    return { kind: 'ramp', title, stops, lo: spec.lo, hi: spec.hi, hiLabel: (spec.clipHi ? '≥ ' : '') + fmt(spec.hi), loLabel: (spec.clipLo ? '≤ ' : '') + fmt(spec.lo), tail: spec.tail || undefined };
  }
  return { title, entries: spec.entries.map((e) => ({ label: e.label, color: e.color })), tail: spec.tail || undefined };
}
function addLegendFrames(ed) {
  const doc = ed.getDoc(), vf = viewFrameOf(doc, ed.selected());
  const vis = vf ? new Set(vf.source.scene.layers.filter((l) => l.visible).map((l) => l.name)) : null;
  const Ls = S.layers.filter((L) => (vis ? vis.has(L.name) : L.visible !== false) && legendSpec(L));
  if (!Ls.length) { $('#meta').textContent = 'composer: no layer has a legend to show (solid colour or file RGB)'; return; }
  const x0 = vf ? vf.box[0] + vf.box[2] + 6 : 20; let y = vf ? vf.box[1] : 20;
  for (const L of Ls) {
    const c = legendContentFor(L);
    const h = c.kind === 'ramp' ? 42 : Math.min(80, 7 + 4.4 * (c.entries.length + (c.tail ? 1 : 0)));
    ed.addFrame({ kind: 'legend', box: [x0, y, 42, h], content: c, source: { app: 'micro', kind: 'legend', layer: L.name } });
    y += h + 4;
  }
}
function addMarker(ed, kind) {
  const doc = ed.getDoc(), vf = viewFrameOf(doc, ed.selected());
  if (!vf) { $('#meta').textContent = `composer: a ${kind === 'north' ? 'north arrow' : 'scale bar'} refers to a 3D-view frame — add one first`; return; }
  const b = vf.box;
  if (kind === 'scalebar') ed.addFrame({ kind, box: [b[0], b[1] + b[3] + 2, 50, 7], content: { of: vf.id } });
  else ed.addFrame({ kind, box: [b[0] + b[2] - 15, b[1] + 2, 13, 17], content: { of: vf.id }, style: { background: 'rgba(255,255,255,0.85)' } });   // it sits ON the render: a light backing
}

// ── the window ──
let _win = null, _ed = null, _fig = null, _saveT = 0;
export function composerOpen() { return !!(_win && document.body.contains(_win.el)); }
export function composerEditor() { return _ed; }
export function currentFigure() { return _fig; }

function newFigure(name) {
  const doc = createDocument({ title: name, page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] } });
  const fig = { name, doc, file: 'figures/' + slug(name) + '.compo.json' };
  S.figures.push(fig); S.figures.sort((a, b) => a.name.localeCompare(b.name));
  return fig;
}
// every figure write goes through ONE queue: a debounced edit-save and the project save's flush
// never open the same file at once (two writables on one file — the loser fails)
let _writeQ = Promise.resolve();
async function writeFigure(dir, fig) {
  const body = serializeDocument(fig.doc) + '\n';
  for (let attempt = 0; ; attempt++) {
    try { const fh = await resolveFileHandle(dir, fig.file, { create: true }); const w = await fh.createWritable(); await w.write(body); await w.close(); return; }
    catch (e) { if (attempt >= 2) throw e; await new Promise((r) => setTimeout(r, 150 * (attempt + 1))); }
  }
}
const queued = (fn) => (_writeQ = _writeQ.then(fn, fn));
function persist(fig) {
  if (!S.project || !fig || !fig.file) return Promise.resolve();
  const dir = S.project.dir;
  return queued(() => writeFigure(dir, fig).catch((e) => { $('#meta').textContent = `figure save failed — ${e.message}`; }));
}
const persistSoon = (fig) => { clearTimeout(_saveT); _saveT = setTimeout(() => persist(fig), 600); };

export function openComposer(name) {
  let fig = name ? S.figures.find((f) => f.name === name) : _fig || S.figures[0];
  if (!fig) fig = newFigure(name || 'figure 1');
  if (composerOpen()) { showFigure(fig); _win.el.style.zIndex = String(+_win.el.style.zIndex + 1); return _ed; }
  _win = floatWin({ title: 'composer', sub: fig.name, x: 70, y: 70, w: Math.min(1180, innerWidth - 40), h: Math.min(820, innerHeight - 100), onClose: () => { if (_fig) persist(_fig); _ed = null; _win = null; } });
  _win.el.classList.add('composer-win');
  const body = _win.body; body.style.cssText += 'display:flex;flex-direction:column;padding:0;overflow:hidden';
  const top = document.createElement('div'); top.className = 'cmp-top';
  top.style.cssText = 'display:flex;gap:5px;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border);flex-wrap:wrap';
  const pick = document.createElement('select'); pick.title = 'figure';
  const btn = (t, title, fn, cls = 'awin-btn') => { const b = document.createElement('button'); b.className = cls; b.textContent = t; b.title = title; b.onclick = fn; return b; };
  const fill = () => { pick.replaceChildren(...S.figures.map((f) => { const o = document.createElement('option'); o.value = f.name; o.textContent = f.name; return o; })); pick.value = _fig ? _fig.name : ''; };
  pick.onchange = () => showFigure(S.figures.find((f) => f.name === pick.value));
  top.append(pick,
    btn('new', 'a new figure', async () => { const n = ((await microPrompt('figure name', `figure ${S.figures.length + 1}`)) || '').trim(); if (!n) return; showFigure(S.figures.find((f) => f.name === n) || newFigure(n)); fill(); }),
    btn('rename', 'rename this figure', async () => {
      const n = ((await microPrompt('rename figure', _fig.name)) || '').trim(); if (!n || n === _fig.name) return;
      if (S.figures.some((f) => f.name === n)) { $('#meta').textContent = `a figure “${n}” exists`; return; }
      const old = _fig.file; _fig.name = n; _fig.doc.title = n; _fig.file = 'figures/' + slug(n) + '.compo.json';
      if (S.project && old) { try { await removeFileAt(S.project.dir, old); } catch { /* not written yet */ } }
      persist(_fig); fill(); _win.sub.textContent = n;
    }),
    btn('delete', 'delete this figure', async () => {
      if (!(await microConfirm('delete figure', `Delete the figure “${_fig.name}”${S.project ? ` and its file ${_fig.file}` : ''}?`, 'Delete'))) return;
      if (S.project && _fig.file) { try { await removeFileAt(S.project.dir, _fig.file); } catch { /* not written */ } }
      S.figures = S.figures.filter((f) => f !== _fig);
      showFigure(S.figures[0] || newFigure('figure 1')); fill();
    }));
  const sp = document.createElement('span'); sp.style.flex = '1';
  const dpiSel = document.createElement('select'); dpiSel.title = 'export resolution for the 3D views and the PNG';
  for (const d of [150, 300, 600]) { const o = document.createElement('option'); o.value = d; o.textContent = d + ' dpi'; dpiSel.append(o); }
  dpiSel.value = '300';
  top.append(btn('atlas…', 'a routine that renders this figure once per section level into one PDF (Tools → Recipes)', () => makeAtlasRoutine(_fig)));
  top.append(sp, dpiSel, btn('⤓ pdf', 'export the page as a vector PDF (the 3D views re-rendered at the dpi)', () => exportFigurePdf(+dpiSel.value), 'awin-btn btn-p'), btn('⤓ png', 'export the page as a PNG at the dpi', () => exportFigurePng(+dpiSel.value)));
  const host = document.createElement('div'); host.style.cssText = 'flex:1;min-height:0';
  body.append(top, host);
  _win._fill = fill;
  _ed = mountEditor(host, fig.doc, {
    env: envFor(),
    onChange: (d) => { if (_fig) { _fig.doc = d; persistSoon(_fig); } },
    toolbar: [
      { label: '+ 3D view', title: 'the current 3D view as a frame (it remembers the scene)', run: (e) => addViewFrame(e) },
      { label: '+ legend', title: 'a legend for each layer shown in the view frame', run: (e) => addLegendFrames(e) },
      { label: '+ scale', title: 'a scale bar for the view frame (orthographic views have a scale)', run: (e) => addMarker(e, 'scalebar') },
      { label: '+ north', title: 'a north arrow for the view frame', run: (e) => addMarker(e, 'north') },
    ],
    frameMenu: (f, e) => frameMenu(f, e),
    onStatus: (m) => { $('#meta').textContent = 'composer: ' + m; },
  });
  _fig = fig; fill();
  return _ed;
}
function showFigure(fig) {
  if (!fig) return;
  if (_fig && _fig !== fig) persist(_fig);
  _fig = fig;
  if (_ed) _ed.setDoc(fig.doc);
  if (_win) { _win.sub.textContent = fig.name; if (_win._fill) _win._fill(); }
}
function frameMenu(f, ed) {
  if (f.source && f.source.kind === 'view') return [
    { label: 'Update from the 3D view', run: () => ed.update(f.id, (fr) => viewFrameContent(fr)) },
    { label: 'Show in the 3D view', run: () => applyScene(f.source.scene) },
    { label: 'Re-render at this size', run: async () => { await rerender(f, PREVIEW_PX_PER_MM); ed.update(f.id, () => {}); } },
  ];
  if (f.source && f.source.kind === 'legend') return [{ label: 'Update from the layer', run: () => { const L = S.layers.find((x) => x.name === f.source.layer); const c = L && legendContentFor(L); if (c) ed.update(f.id, (fr) => { fr.content = c; }); else $('#meta').textContent = `composer: layer “${f.source.layer}” has no legend now`; } }];
  return [];
}
async function rerender(f, pxPerMm) {
  await withScene(f.source.scene, () => { const r = renderInto(f, pxPerMm, f.source.bg); storeImageQuiet(f, r.canvas, r.meta); });
}
// at export: the hi-res render replaces the bitmap, but the stored preview stays small
function storeImageQuiet(f, canvas, meta) { f._img = canvas; f._jpeg = null; f.content = { ...f.content, width: canvas.width, height: canvas.height, meta }; }

function envFor(extra = {}) {
  return {
    ...extra,
    // ${expr} in a caption: the atlas's row values (vars), else empty — micro fields come later
    evalField: (expr, vars) => (vars && Object.prototype.hasOwnProperty.call(vars, expr) ? vars[expr] : (HK.evalField ? HK.evalField(expr, vars) : `⟨${expr}⟩`)),
  };
}
// export: every view frame re-rendered at the print dpi with its own scene (the user's view restored after)
function prepareFor(dpi) {
  return async (doc) => {
    const views = doc.frames.filter((f) => f.source && f.source.kind === 'view' && f.source.scene);
    if (!views.length) return;
    const mine = captureScene('__composer');
    try {
      for (const f of views) {
        await applyScene(f.source.scene);
        const r = renderInto(f, dpi / 25.4, f.source.bg);
        storeImageQuiet(f, r.canvas, r.meta);
      }
    } finally { await applyScene(mine); requestRender(); }
  };
}
export async function figurePdfBytes(fig = _fig, dpi = 300, opts = {}) {
  return exportPDF(fig.doc, { env: envFor({ prepare: prepareFor(dpi) }), title: fig.name, creator: 'micro', dpi, ...opts });
}
async function exportFigurePdf(dpi) {
  if (!_fig) return;
  $('#meta').textContent = `composer: rendering “${_fig.name}” at ${dpi} dpi…`;
  try {
    const bytes = await figurePdfBytes(_fig, dpi);
    await deliverBlob(new Blob([bytes], { type: 'application/pdf' }), slug(_fig.name) + '.pdf');
    $('#meta').textContent = `composer: ${slug(_fig.name)}.pdf (${(bytes.length / 1024).toFixed(0)} KB)`;
  } catch (e) { $('#meta').textContent = `composer: PDF failed — ${e.message}`; }
  if (_ed) _ed.render();
}
async function exportFigurePng(dpi) {
  if (!_fig) return;
  $('#meta').textContent = `composer: rendering “${_fig.name}” at ${dpi} dpi…`;
  try {
    const blob = await exportPNG(_fig.doc, { dpi, env: envFor({ prepare: prepareFor(dpi) }) });
    await deliverBlob(blob, slug(_fig.name) + '.png');
    $('#meta').textContent = `composer: ${slug(_fig.name)}.png`;
  } catch (e) { $('#meta').textContent = `composer: PNG failed — ${e.message}`; }
  if (_ed) _ed.render();
}

// ── THE ATLAS: one figure, many pages. A page = the figure with per-page changes applied to its
// view frames (a section plane, a camera, a filter), its ${…} captions filled from the page's
// values, its legends re-read from the layers. The `compo` recipe tool renders one page per
// step; in a routine `each` block that is one page per row, collected into a `book` (one PDF)
// or written page by page (`out`).
//
// params: { figure, view: { section: {axis|normal|dipDir+dip, position|at, thickness, clip} |
//   'off', camera: {look, elevation, distance, target, ortho, zExag}, filter: "expr" |
//   { "<layer>": "expr" } }, vars: { name: value }, dpi, out: "atlas/p-$x.png|.pdf",
//   book: "atlas/x.pdf" }
// evalField(expr, vars) evaluates a caption's ${expr} (the routine's expression language).
export async function compoPage(params, evalField) {
  const P = params || {};
  const fig = S.figures.find((f) => f.name === P.figure);
  if (!fig) throw new Error(`composer: no figure “${P.figure}” (${S.figures.length ? 'figures: ' + S.figures.map((f) => f.name).join(', ') : 'make one in View → Composer…'})`);
  const dpi = Math.max(72, Math.min(600, +P.dpi || 300));
  const vars = P.vars || {};
  // the page: a copy of the figure (images carried by reference — they're re-rendered or reused)
  const doc = JSON.parse(serializeDocument(fig.doc));
  for (const f of doc.frames) { const o = frameById(fig.doc, f.id); if (o && o._img) f._img = o._img; }
  doc._vars = vars;
  // captions: ${expr} from this page's values (the {page} / {pages} / {fig} fields stay for export)
  for (const f of doc.frames) {
    if (f.kind !== 'text' || !f.content || !f.content.md) continue;
    f.content.md = String(f.content.md).replace(/\$\{([^}]*)\}/g, (_, e) => {
      const k = e.trim();
      if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
      try { const v = evalField ? evalField(k, vars) : undefined; return v == null ? '' : typeof v === 'number' ? String(+v.toPrecision(6)) : String(v); }
      catch (err) { return `⟨${k}: ${err.message}⟩`; }
    });
  }
  const views = doc.frames.filter((f) => f.source && f.source.kind === 'view' && f.source.scene);
  if (!views.length && !doc.frames.some((f) => f.source && f.source.kind === 'legend')) return doc;
  const v = P.view || {};
  const mine = captureScene('__atlas');
  try {
    for (const f of views) {
      const scene = JSON.parse(JSON.stringify(f.source.scene));
      if (v.filter != null) for (const sl of scene.layers) {
        const fx = typeof v.filter === 'string' ? v.filter : v.filter[sl.name];
        if (fx != null && sl.visible !== false) sl.filter = String(fx);
      }
      await applyScene(scene);
      if (v.camera) HK.setCameraWorld(v.camera);
      if (v.section === 'off') setSectionWorld(null);
      else if (v.section) setSectionWorld(v.section);
      const r = renderInto(f, dpi / 25.4, f.source.bg);
      storeImageQuiet(f, r.canvas, r.meta);
      f.content.photo = true;
      // this page's legends read the layers while the page's scene is on
      for (const lf of doc.frames) {
        if (!(lf.source && lf.source.kind === 'legend')) continue;
        const L = S.layers.find((x) => x.name === lf.source.layer);
        const c = L && legendContentFor(L);
        if (c) lf.content = { ...c, title: lf.content.title || c.title };
      }
    }
  } finally { await applyScene(mine); requestRender(); $('#meta').textContent = ''; }
  return doc;
}
// write pages: a .pdf (all of them, one per page) or a .png (the first) into the project
export async function writePages(path, docs, { dpi = 300 } = {}) {
  if (!S.project || !S.project.dir) throw new Error('composer: writing pages needs a project');
  let blob;
  if (/\.png$/i.test(path)) blob = await exportPNG(docs[0], { dpi, env: envFor() });
  else blob = new Blob([await exportPDF(docs, { env: envFor(), title: docs[0].title, creator: 'micro', dpi })], { type: 'application/pdf' });
  const fh = await resolveFileHandle(S.project.dir, path, { create: true });
  const w = await fh.createWritable(); await w.write(blob); await w.close();
  return blob.size;
}
// a starter atlas routine for the current figure: a section stepped through the data, a page per
// level, the level in the caption, one PDF. Written to recipes/ and opened in the routine editor.
export async function makeAtlasRoutine(fig = _fig, { save = true } = {}) {
  if (!fig) return null;
  const vf = fig.doc.frames.find((f) => f.source && f.source.kind === 'view');
  if (!vf) { $('#meta').textContent = 'composer: an atlas steps a 3D-view frame — add one first'; return null; }
  const sec = vf.source.scene.section;
  const axis = (sec && sec.mode === 'ns') ? 'x' : (sec && sec.mode === 'ew') ? 'y' : 'z';
  const k = { x: 0, y: 1, z: 2 }[axis], b = rendererDocBbox(), o = S.frame ? S.frame.origin : [0, 0, 0];
  const lo = b[k] + o[k], hi = b[k + 3] + o[k], n = 6, step = (hi - lo) / n;
  const levels = Array.from({ length: n }, (_, i) => +(lo + step * (i + 0.5)).toFixed(step < 10 ? 1 : 0));
  const name = `${fig.name} atlas`;
  const params = {
    steps: [{
      each: { level: levels },
      steps: [{ tool: 'compo', figure: fig.name, view: { section: { axis, position: '$level', thickness: +(step * 0.8).toPrecision(3), clip: 'slab' } }, vars: { level: '$level' }, book: `atlas/${slug(fig.name)}.pdf`, dpi: 200 }],
    }],
  };
  if (!save) return { name, tool: 'routine', params };
  const r = await HK.saveRecipe('routine', params, name);
  if (r) { HK.openRoutineWindow(r); $('#meta').textContent = `composer: “${r.name}” — ${n} ${axis === 'z' ? 'levels' : 'sections'} → atlas/${slug(fig.name)}.pdf; write \${level} in a caption to label each page, then Run`; }
  return r;
}

// an analysis window's plot → an image frame on the current figure (micro:to-composer)
export function addCanvasFrame(canvas, name) {
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const w = 110, h = (w * canvas.height) / Math.max(1, canvas.width);
  const f = ed.addFrame({ kind: 'image', box: [m[3] + 8, m[0] + 8, w, +h.toFixed(1)], content: { width: canvas.width, height: canvas.height, src: canvas.toDataURL('image/png') }, source: { app: 'micro', kind: 'plot', name } });
  const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d').drawImage(canvas, 0, 0);
  f._img = copy; ed.render();
  $('#meta').textContent = `composer: ${name} went into “${_fig.name}”`;
  return f;
}
// an analysis window's table (its ⧉ table TSV) → a table frame, beside the plot when both came
export function addTableFrame(tsv, name, near = null) {
  const c = tableFromTsv(tsv, ''); if (!c) return null;
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const rows = Math.min(c.rows.length, 30), w = Math.min(120, 14 + 16 * c.columns.length), h = +(5 + 4.2 * (rows + 1.5)).toFixed(1);
  const box = near ? [near.box[0] + near.box[2] + 6, near.box[1], w, h] : [m[3] + 8, m[0] + 8, w, h];
  const f = ed.addFrame({ kind: 'table', box, content: c, source: { app: 'micro', kind: 'table', name } });
  $('#meta').textContent = `composer: the ${name} table (${c.rows.length} rows) went into “${_fig.name}”`;
  return f;
}
addEventListener('micro:to-composer', (e) => {
  const d = e.detail || {};
  const p = d.canvas ? addCanvasFrame(d.canvas, d.name || 'plot') : null;
  if (d.tsv) addTableFrame(d.tsv, d.name || 'table', p);
});

// ── the project: figures/ *.compo.json in, any not yet written out ──
export async function loadFigures(dir) {
  S.figures = [];
  try {
    const fd = await dir.getDirectoryHandle('figures');
    for await (const [nm, h] of fd.entries()) {
      if (h.kind !== 'file' || !/\.compo\.json$/i.test(nm)) continue;
      try { const doc = parseDocument(await (await h.getFile()).text()); S.figures.push({ name: doc.title || nm.replace(/\.compo\.json$/i, ''), doc, file: 'figures/' + nm }); } catch { /* skip a bad file */ }
    }
  } catch { /* no figures/ folder */ }
  S.figures.sort((a, b) => a.name.localeCompare(b.name));
  if (composerOpen()) { _fig = null; showFigure(S.figures[0] || newFigure('figure 1')); }
}
export async function flushFigures(dir) {
  clearTimeout(_saveT);                                    // the save writes the current state: no stale edit-save after it
  const failed = [];
  for (const fig of S.figures) {
    if (!fig.file) fig.file = 'figures/' + slug(fig.name) + '.compo.json';
    await queued(() => writeFigure(dir, fig).catch((e) => { failed.push(`${fig.file} (${e.message})`); }));
  }
  if (failed.length) console.warn('micro: figures not saved —', failed.join('; '));
  return failed;
}
export { frameById };
