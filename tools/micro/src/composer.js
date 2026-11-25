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
import { setSectionWorld, sectionWorld, currentSection } from './section.js';
import { sectionCutOf, sectionRecordMask, filterMaskOf } from './insection.js';
import { rendererDocBbox, layerShown } from './layers.js';
import { attrRowCountOf, layerBlob, layerTableHeader, schemaExt, layerWorldBox, meshVertexData } from './records.js';
import { figureRefs, retargetDoc, guessLayer, guessColumn } from './retarget.js';
import { computeResourceTable, numericColsOf, parseFactor } from './analysis.js';
import { sourceHash, sourceHashSync } from './identity.js';
import { createDocument, parseDocument, serializeDocument, mountEditor, iconButton, exportPDF, exportPNG, frameById, pageDims, tableFromTsv, subjectFrame, refFrame, figureFromPdf, registerKind, replayDrawList, HOUSE_KEYS, FIGURE_KEYS, setTemplate, docFromTemplate, addTitleBlock as compoTitleBlock, addImageFromFile as compoImageFromFile, multiplesGrid, smallMultiples as compoMultiples, groupDigits, significant, fmtBearing } from '../../../ext/compo/index.js';
import { chartFigure } from './analysis-ui.js';
import { colorChoices, colorSelFor } from './color.js';
import { rerunToolRecipe } from './tools.js';
import { SEC_AXES, sectionCells, sectionShapes, sectionDrillholes, sectionMesh, sectionFeatures, VEC_OUTLINES, _vecOutlines } from './vsection.js';
import { gridAxesOf } from './grid-ops.js';
import { xyFigure } from './xyplot.js';
import { compareField, refreshCompareFrame, lineageMd as compareLineageMd, openCompareDialog } from './compare.js';
const $ = (s) => document.querySelector(s);

// the app's side (setComposerHooks): renderViewCanvas(pxW, pxH) → a canvas rendered to convergence
let HK = {};
export function setComposerHooks(h) { HK = h; }
export const composerCamera = (v) => HK.setCameraWorld(v);   // the camera, in world terms, for a page builder (compare.js) — through the hooks, not viewport.js

const PREVIEW_PX_PER_MM = 6;                               // ≈150 dpi on screen; export re-renders at the print dpi
const MAX_PX = 6000;
const slug = (s) => (String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure').toLowerCase();
const hexRgb01 = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ── the view: what a frame needs to know about the camera right now ──
function viewMeta(pxH, canvas) {
  const st = S.cam.state, v = st.view;
  const meta = { ortho: !!st.ortho, zExag: st.zExag || 1 };
  if (v) {
    const nx = v[4], ny = -v[5], m = Math.hypot(nx, ny);    // north's direction on screen (x right, y down): world Y through the camera basis (v[9] was world Z's)
    meta.north = m < 1e-3 ? null : +((Math.atan2(nx / m, -ny / m) * 180) / Math.PI).toFixed(2);
  }
  // an orthographic view has ONE scale: its visible height (2·halfH, world units) over the image's
  // pixels. A perspective view has none — the scale bar says so rather than guess.
  if (st.ortho && st.halfH > 0) meta.worldPerPx = (2 * st.halfH) / pxH;
  if (canvas && canvas._viewProj) meta.proj = { m: canvas._viewProj.map((v) => +(+v).toPrecision(9)), origin: S.frame ? S.frame.origin.slice() : [0, 0, 0], focus: (() => { const o = S.frame ? S.frame.origin : [0, 0, 0], t = S.cam.state.target; return [t[0] + o[0], t[1] + o[1], t[2] + o[2]]; })() };
  meta.facts = viewFacts();
  return meta;
}
// ── FACTS: what a view showed when it was rendered — the camera, the section, each shown layer
// with its file, content hash, filter and record counts. A caption's fields read these, so a
// caption describes the IMAGE (its scene), not whatever the 3D view shows now. ──
function viewFacts() {
  const c = HK.cameraWorld ? HK.cameraWorld() : null;
  let sec = null; try { sec = sectionWorld(); } catch { /* nothing loaded */ }
  const layers = [];
  for (const L of S.layers) {
    if (!layerShown(L.id)) continue;
    const total = attrRowCountOf(L) || 0, m = L._filterMask;
    let shown = total;
    if (m && L.filterExpr) { shown = 0; for (let i = 0; i < m.length; i++) if (m[i]) shown++; }
    const blob = layerBlob(L), l = { name: L.label || L.name, file: (blob && blob.name) || L.name, sha: blob ? sourceHashSync(blob) : null, filter: L.filterExpr || '', shown, total, ...(L.kind === 'mesh' || (L.docs && L.docs.gridDoc) ? { ctx: true } : {}) };   // ctx: a mesh / grid — context, not records anyone counts
    Object.defineProperty(l, '_blob', { value: blob, enumerable: false });   // for completeFacts' hash; never saved
    layers.push(l);
  }
  return {
    camera: c ? { look: +c.look.toFixed(1), elevation: +c.elevation.toFixed(1), ortho: !!c.ortho, zExag: c.zExag } : null,
    section: sec ? { mode: sec.mode, axis: sec.axis, normal: sec.normal.map((v) => +v.toFixed(6)), position: sec.position, thickness: sec.thickness, clip: sec.clip, dipDir: sec.dipDir, dip: sec.dip } : null,
    layers, at: new Date().toISOString(),
  };
}
// the slower facts, once a view frame has rendered: each layer's content hash, and the statistics
// its captions ask for ({mean:AU} …), over the records the view showed (its filters) — and, when the
// frame counts IN THE SECTION (content.statsScope, the default), only those inside its section
const STAT_RE = /\{(mean|median|min|max|std|n):([^{}@]+?)(?::[,_]?(?:\.\d{1,2})?[f%e]?)?(?:@([\w.-]+))?\}/g;
const COUNT_RE = /\{(?:count|mean|median|min|max|std|n)\b[^{}]*?(?:@([\w.-]+))?\}|\$\{[^}]*\bcount\b[^}]*\}/g;
const isView = (f) => !!(f.source && f.source.kind === 'view');
// what a view frame's {count} and statistics cover: 'section' (the records inside its section —
// what the image shows; the default) or 'model' (the whole model, after filters). A view with no
// section cutting a layer counts that layer whole either way.
export const statsScopeOf = (f) => (f && f.content && f.content.statsScope === 'model' ? 'model' : 'section');
// does any caption on the page count / take statistics about view frame f?
function countsAbout(doc, f) {
  for (const t of doc.frames) {
    if (t.kind !== 'text' || !t.content || !t.content.md) continue;
    const md = String(t.content.md); COUNT_RE.lastIndex = 0; let m;
    while ((m = COUNT_RE.exec(md))) if (subjectFrame({ doc, at: m[1] || null }, t, isView) === f) return true;
  }
  return false;
}
async function completeFacts(doc, f) {
  const fx = f.content && f.content.meta && f.content.meta.facts; if (!fx) return;
  // the section, captured NOW (before any await): the caller has the frame's scene on the 3D view,
  // and may put the user's view back while this runs
  const scope = statsScopeOf(f), cs = currentSection(), cuts = new Map();
  for (const l of fx.layers) {
    const L = S.layers.find((x) => (x.label || x.name) === l.name);
    const cut = L ? sectionCutOf(L, cs) : null;
    l.cut = !!cut; delete l.inSection; delete l.inSectionError;
    if (cut && scope === 'section') cuts.set(l.name, { l, cut });
  }
  const baseMasks = new Map(S.layers.map((L) => [L, filterMaskOf(L)]));
  fx.statsScope = scope;
  for (const l of fx.layers) if (l._blob && !l.sha) { try { l.sha = await sourceHash(l._blob); } catch { /* unreadable: no hash */ } }
  if (f.content.vectorOn) { try { await buildVector(f); } catch (e) { f.content.vector = null; f.content.vectorError = e.message; } }
  // the records inside the section, ONE positions pass per layer, only when a caption counts
  // about this view; the masks then serve every statistic below (N captions, one pass)
  const masks = new Map();
  if (cuts.size && countsAbout(doc, f)) {
    for (const [name, { l, cut }] of cuts) {
      try { const r = await sectionRecordMask(cut); masks.set(name, r.mask); l.inSection = r.count; }
      catch (e) {                                  // couldn't read the positions: the field says so ('…') — and WHY, on the status line
        l.inSection = null; l.inSectionError = String((e && e.message) || e);
        $('#meta').textContent = `composer: couldn't count “${name}” inside the section — ${l.inSectionError}`;
      }
    }
  }
  const want = new Set();
  for (const t of doc.frames) {
    if (t.kind !== 'text' || !t.content || !t.content.md) continue;
    const md = String(t.content.md); STAT_RE.lastIndex = 0; let m;
    while ((m = STAT_RE.exec(md))) {               // the view this statistic is about: its @id, the caption's refers-to, the nearest
      const about = subjectFrame({ doc, at: m[3] || null }, t, isView);
      if (about === f) want.add(m[2].trim());
    }
  }
  if (!want.size || !HK.statsScan) return;
  fx.stats = {};
  for (const key of want) {
    const k = key.lastIndexOf(':'), lname = k >= 0 ? key.slice(0, k).trim() : null, col = k >= 0 ? key.slice(k + 1).trim() : key;
    const cands = S.layers.filter((L) => fx.layers.some((l) => l.name === (L.label || L.name)) && (!lname || (L.label || L.name) === lname));
    let got = null;
    for (const L of cands) {
      try {
        const nm = L.label || L.name, inSec = masks.get(nm);
        if (cuts.has(nm) && !inSec) continue;      // in the section, but its positions couldn't be read
        const r = await HK.statsScan(L, { cols: [col] }, inSec || baseMasks.get(L) || null);
        const row = r.rows.find((x) => x.group === '' || x.group == null) || r.rows[0];
        if (row) { got = { layer: nm, n: row.n, mean: row.mean, median: row.q50, min: row.min, max: row.max, std: row.std }; break; }
        if (inSec) { got = { layer: nm, n: 0, mean: null, median: null, min: null, max: null, std: null }; break; }   // the column, but nothing in the section has a value
      } catch { /* not this layer's column */ }
    }
    fx.stats[key] = got || { error: `no shown layer has a column “${col}”` };
  }
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
  // a LOCKED scale (1 : content.scaleLock, world metres per paper metre): the orthographic view's
  // height is set from the frame's — resizing the frame changes what it shows, not the scale
  const st = S.cam.state, lock = +((f.content && f.content.scaleLock) || 0), r0 = st.radius;
  if (lock > 0 && st.ortho) { st.radius = ((f.box[3] * lock) / 1000 / 2) / Math.tan(st.fovY / 2); S.cam.update(); }
  try { const canvas = HK.renderViewCanvas(w, h); return { canvas, meta: viewMeta(h, canvas) }; }
  finally { if (bg) applyBg(); if (st.radius !== r0) { st.radius = r0; S.cam.update(); } }
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
function afterFacts(ed, id) {
  const fr = frameById(ed.getDoc(), id);
  if (fr) completeFacts(ed.getDoc(), fr).then(() => { if (_ed === ed) ed.render(); }, () => {});
}
function viewFrameContent(f) {
  const scene = captureScene(f.source && f.source.name || 'view');
  // a frame given its own background (bgFixed — a report's map on paper) keeps it through re-captures;
  // any other frame follows the 3D view's background
  const fixed = f.source && f.source.bgFixed;
  f.source = { app: 'micro', kind: 'view', scene, bg: fixed || _bgColor, ...(fixed ? { bgFixed: fixed } : {}), ...(f.source && f.source.keyFor ? { keyFor: f.source.keyFor } : {}) };   // a key plan stays one
  const r = renderInto(f, PREVIEW_PX_PER_MM, fixed || null);
  storeImage(f, r.canvas, r.meta);
}
// bg: a background for THIS frame's renders (e.g. '#ffffff' — a report's map on paper), else the 3D view's own
export function addViewFrame(ed, { box = null, border = true, bg = null } = {}) {   // box: [x, y, w, h] mm — else sized to the canvas's aspect
  if (!S.layers.length) { $('#meta').textContent = 'composer: open some data first — a view frame renders the 3D view'; return null; }
  const doc = ed.getDoc(), [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const r = S.cv.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
  let w = Math.min(W - m[1] - m[3], 0.72 * (W - m[1] - m[3])), h = w / aspect;
  const hMax = H - m[0] - m[2] - 18; if (h > hMax) { h = hMax; w = h * aspect; }
  const f = ed.addFrame({ kind: 'image', box: box || [m[3], m[0], +w.toFixed(1), +h.toFixed(1)], content: { photo: true }, source: { app: 'micro', kind: 'view', ...(bg ? { bgFixed: bg } : {}) }, style: { border } });
  ed.update(f.id, (fr) => viewFrameContent(fr));
  afterFacts(ed, f.id);
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

// ── OUT OF DATE: a view frame recorded each layer's content hash when it rendered. If a layer is
// now a different file (a new estimate), or isn't loaded, the frame says so — and "↻ views"
// (or Refresh all figures) renders it again. ──
const _hashing = new WeakSet();
export function staleOf(f) {
  const fx = isView(f) ? f.content && f.content.meta && f.content.meta.facts : f.source && f.source.facts;   // a view's render, or a chart / table's run
  if (!fx || !fx.layers) return null;
  const missing = [], changed = [];
  for (const l of fx.layers) {
    const L = S.layers.find((x) => (x.label || x.name) === l.name);
    if (!L) { missing.push(l); continue; }
    const blob = layerBlob(L); if (!blob || !l.sha) continue;
    const cur = sourceHashSync(blob);
    if (!cur) { if (!_hashing.has(blob)) { _hashing.add(blob); sourceHash(blob).then(() => { if (_ed) _ed.render(); }, () => {}); } continue; }
    if (cur !== l.sha) changed.push({ l, cur });
  }
  if (changed.length) return { text: 'older data', title: changed.map(({ l, cur }) => `${l.name}: rendered from ${l.file} ${l.sha.slice(0, 8)}, the layer is now ${cur.slice(0, 8)}`).join('\n') + '\nRefresh (↻) makes it again' };
  if (missing.length) return { text: 'data not loaded', title: missing.map((l) => `${l.name} (${l.file}${l.sha ? ' ' + l.sha.slice(0, 8) : ''}) isn't loaded`).join('\n') };
  return null;
}
// render every view frame of a figure again from its own scene (the stored preview too), then
// its facts; the user's view comes back after
export async function refreshViews(fig = _fig) {
  if (!fig) return 0;
  const views = fig.doc.frames.filter((f) => isView(f) && f.source.scene);
  const nData = await refreshData(fig);
  if (!views.length) { if (nData) { persist(fig); if (_ed && _fig === fig) _ed.setDoc(fig.doc); $('#meta').textContent = `composer: “${fig.name}” — ${nData} chart / table frame${nData === 1 ? '' : 's'} made again`; } return nData; }
  const mine = captureScene('__composer');
  try {
    for (const f of views) {
      await applyScene(f.source.scene);
      const r = renderInto(f, PREVIEW_PX_PER_MM, f.source.bg);
      storeImage(f, r.canvas, r.meta);
      await completeFacts(fig.doc, f);
    }
  } finally { await applyScene(mine); requestRender(); }
  persist(fig);
  if (_ed && _fig === fig) { _ed.setDoc(fig.doc); }
  $('#meta').textContent = `composer: “${fig.name}” — ${views.length} view${views.length === 1 ? '' : 's'} rendered again${nData ? `, ${nData} chart / table frame${nData === 1 ? '' : 's'} made again` : ''}`;
  return views.length + nData;
}
// ── DATA FRAMES: a chart / table that came from an analysis window keeps its recipe, and a
// resource table its parameters; ↻ refresh makes them again with the data as it is now, and
// each records the content hash of the layers it read (the same "older data" badge as a view) ──
const recipeLayers = (r) => {
  const p = (r && r.params) || {}, out = [];
  for (const s of p.series || []) if (s && s.layer) out.push(s.layer);
  if (p.layer) out.push(p.layer);
  for (const k of ['a', 'b']) if (p[k] && p[k].layer) out.push(p[k].layer);   // a Q-Q's two sides
  return [...new Set(out)];
};
async function stampFacts(f, names) {
  const layers = [];
  for (const nm of names) {
    const L = S.layers.find((x) => x.name === nm || (x.label || x.name) === nm);
    if (!L) { layers.push({ name: nm, file: nm, sha: null }); continue; }
    const blob = layerBlob(L);
    layers.push({ name: L.label || L.name, file: (blob && blob.name) || L.name, sha: blob ? await sourceHash(blob) : null });
  }
  f.source = { ...f.source, facts: { layers, at: new Date().toISOString() } };
}
const _until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 120)); } };
// run a window's recipe headlessly → { spec, tsv } (the routine runner's way: open, wait, read, close)
async function rerunRecipe(recipe) {
  for (const nm of recipeLayers(recipe)) if (!S.layers.some((x) => x.name === nm)) throw new Error(`layer “${nm}” isn't loaded`);
  const direct = await rerunToolRecipe(recipe);           // a registered tool: no window opened (nor the user's own replaced)
  if (direct) return direct;
  if (!HK.runRecipe) throw new Error('recipes are not available');
  const before = new Set(document.querySelectorAll('.fwin'));
  HK.runRecipe({ tool: recipe.tool, name: recipe.name || recipe.tool, params: JSON.parse(JSON.stringify(recipe.params || {})) }, true);
  const el = await _until(() => [...document.querySelectorAll('.fwin')].find((x) => !before.has(x) && (x._runFailed || (x._tableTSV && x._tableTSV()))), 600000);
  if (!el) throw new Error('the analysis did not finish');
  if (el._runFailed) { const why = el._runFailed; const close = el.querySelector('.fwin-head button:last-child'); if (close) close.click(); throw new Error(why); }
  const cv = el.querySelector('canvas');
  const spec = cv && cv._chartSpec ? JSON.parse(JSON.stringify(cv._chartSpec)) : null, tsv = el._tableTSV();
  const close = el.querySelector('.fwin-head button:last-child'); if (close) close.click();
  return { spec, tsv };
}
export async function refreshData(fig = _fig) {
  if (!fig) return 0;
  let n = 0;
  const runs = new Map();                                   // one run per recipe: a chart and its table share it
  for (const f of fig.doc.frames) {
    const src = f.source || {};
    try {
      if (src.recipe) {
        const key = JSON.stringify(src.recipe);
        if (!runs.has(key)) runs.set(key, await rerunRecipe(src.recipe));
        const r = runs.get(key);
        if (f.kind === 'chart' && r.spec) { f.content = { ...f.content, spec: r.spec }; f._list = null; }
        else if (f.kind === 'table' && r.tsv) { const c = tableFromTsv(r.tsv, f.content.title || ''); if (c) f.content = { ...f.content, columns: c.columns, rows: c.rows }; }
        await stampFacts(f, recipeLayers(src.recipe)); f.produced = new Date().toISOString(); n++;
      } else if (src.stereonet && HK.stereonetFigure) {      // a stereonet: the planes measured again, the net redrawn
        const L = S.layers.find((x) => x.name === src.stereonet.layer);
        if (!L) throw new Error(`layer “${src.stereonet.layer}” isn't loaded`);
        f.content = { ...f.content, list: await HK.stereonetFigure(L) };
        await stampFacts(f, [src.stereonet.layer]); f.produced = new Date().toISOString(); n++;
      } else if (src.kind === 'resource' && src.params) {
        f.content = { ...f.content, ...(await resourceContent(src.params)) };
        await stampFacts(f, [src.params.layer]); f.produced = new Date().toISOString(); n++;
      } else if (src.kind === 'compare' && src.params) {      // a comparison (compare.js): the table, its values, the Δ layer — all again
        f.content = { ...f.content, ...(await refreshCompareFrame(f)) };
        await stampFacts(f, [src.params.old, src.params.new]); f.produced = new Date().toISOString(); n++;
      } else if (src.kind === 'compare-lineage' && src.params) {
        f.content = { ...f.content, md: await compareLineageMd(src.params) }; f.produced = new Date().toISOString(); n++;
      }
    } catch (e) { $('#meta').textContent = `composer: ${f.id} not made again — ${e.message}`; }
  }
  return n;
}

// ── the RESOURCE TABLE frame ──
const sig = significant;
async function resourceContent(p) {
  const L = S.layers.find((x) => x.name === p.layer || (x.label || x.name) === p.layer);
  if (!L) throw new Error(`layer “${p.layer}” isn't loaded`);
  const mask = p.scope === 'filter' && L.filterExpr ? L._filterMask : null;
  const r = await computeResourceTable(L, { ...p, mask });
  const mu = p.metalUnit || r.metalUnit;                     // stated, or what the rule made it (t when the grade unit is declared)
  const metal = mu ? `metal (${mu})` : 'metal';
  const columns = r.columns.map((c) => (c === 'tonnes' ? 't' : c === 'grade' ? (p.gradeUnit ? `${p.grade} (${p.gradeUnit})` : p.grade) : c === 'metal' ? metal : c));
  const grp = (v) => (Number.isFinite(v) ? groupDigits(Math.round(v)) : '');   // 2 343 000
  const rows = r.rows.map((row) => row.map((v, i) => (r.columns[i] === 'tonnes' ? grp(v) : r.columns[i] === 'grade' ? sig(v, 4) : r.columns[i] === 'metal' ? (Math.abs(v) >= 1000 ? grp(v) : sig(v, 4)) : v)));
  const d = p.density || {};
  const dens = d.col ? `density ${d.col}${d.unit ? ` (${d.unit})` : ''}` : `density ${d.const != null ? d.const : 1}${d.unit ? ` ${d.unit}` : ' t/m³'}`;
  return { columns, rows, title: p.title || `${L.label || L.name} — resources`, note: `${dens}${p.scope === 'filter' && L.filterExpr ? ` · filter ${L.filterExpr}` : ''} · ${r.records.toLocaleString('en-US')} records` };
}
export async function addResourceFrame(p) {
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const content = await resourceContent(p);
  const rows = Math.min(content.rows.length, 30), w = Math.min(160, 20 + 18 * content.columns.length), h = +(9 + 4.2 * (rows + 2.5)).toFixed(1);
  const f = ed.addFrame({ kind: 'table', box: [m[3] + 8, m[0] + 8, w, h], content, source: { app: 'micro', kind: 'resource', name: content.title, params: p } });
  await stampFacts(f, [p.layer]); ed.render();
  $('#meta').textContent = `composer: a resource table (${content.rows.length} rows) went into “${_fig.name}” — Refresh (↻) makes it again`;
  return f;
}
function openResourceDialog() {
  const cands = S.layers.filter((L) => layerTableHeader(L) && numericColsOf(L).length);
  if (!cands.length) { $('#meta').textContent = 'composer: a resource table needs a block model with a grade column'; return; }
  const w = floatWin({ title: 'resource table', sub: 'tonnes · grade · metal above cutoffs', x: 140, y: 120, w: 420, h: 400 });
  w.el.classList.add('cmp-resource');
  const body = w.body; body.style.cssText += 'display:grid;grid-template-columns:110px 1fr;gap:6px 8px;align-items:center;padding:10px';
  const sel = (opts, val) => { const s = document.createElement('select'); for (const o of opts) { const e = document.createElement('option'); e.value = o; e.textContent = o || '—'; s.append(e); } if (val != null) s.value = val; return s; };
  const inp = (v, title) => { const i = document.createElement('input'); i.value = v; i.title = title || ''; i.onkeydown = (e) => e.stopPropagation(); return i; };
  const row = (label, el) => { const l = document.createElement('span'); l.textContent = label; body.append(l, el); return el; };
  const lay = row('model', sel(cands.map((L) => L.name), cands[0].name));
  const grade = row('grade', sel([])), cut = row('cutoffs', inp('0, 0.5, 1', 'comma-separated, in the grade\'s units'));
  const gunit = row('grade unit', inp('', 'the grade’s unit, e.g. g/t, %, ppm — shown in the header; declared, it sets the metal factor (metal in tonnes) unless you state one'));
  const dcol = row('density', sel([])), dconst = row('… or constant', inp('2.7', 'used when no density column is chosen')), dunit = row('density unit', sel(['t/m3', 'kg/m3', 'g/cm3', 'lb/ft3'], 't/m3'));
  const g1 = row('group by', sel([])), g2 = row('… then by', sel([]));
  const mf = row('metal factor', inp('', 'metal = tonnes × grade × this — a number or a fraction (1/31.1035 for g/t → troy oz). Blank: from the grade unit (% → 0.01, g/t → 1e-6, metal in tonnes), or 1 when no unit is given')), munit = row('metal unit', inp('', 'e.g. oz, t — blank: t when the factor comes from the grade unit'));
  mf.placeholder = 'auto (from the grade unit)'; mf.dataset.metalFactor = '1';
  mf.oninput = () => mf.classList.toggle('bad-in', Number.isNaN(parseFactor(mf.value)));
  const scope = row('records', sel(['all', 'filter'], 'all'));
  const fill = () => {
    const L = S.layers.find((x) => x.name === lay.value), h = layerTableHeader(L), all = schemaExt(L, h).map((c) => c.name), nums = numericColsOf(L);
    const put = (s, opts, pick) => { s.replaceChildren(...opts.map((o) => { const e = document.createElement('option'); e.value = o; e.textContent = o || '—'; return e; })); if (pick != null) s.value = pick; };
    put(grade, nums, nums.find((c) => /^(au|cu|fe|ag|zn|pb|ni|grade)/i.test(c)) || nums[0]);
    put(dcol, ['', ...nums], nums.find((c) => /^(dens|sg|rho|density)/i.test(c)) || '');
    put(g1, ['', ...all], all.find((c) => /^(dom|domain|zone|lith|lithology|lito|litho|rock|rocktype|geol|unit)\b|domain/i.test(c)) || ''); put(g2, ['', ...all], all.find((c) => /^(class|cat|rescat|rescla|jorc)\b|class|categ/i.test(c)) || '');
  };
  lay.onchange = fill; fill();
  const go = document.createElement('button'); go.className = 'awin-btn btn-p'; go.textContent = 'Add';
  const msg = document.createElement('span'); msg.className = 'hint';
  body.append(msg, go);
  go.onclick = async () => {
    const mfv = parseFactor(mf.value);
    if (Number.isNaN(mfv)) { mf.classList.add('bad-in'); msg.textContent = `metal factor “${mf.value.trim()}”: a positive number or a fraction such as 1/31.1035 — or blank`; return; }
    const p = { layer: lay.value, grade: grade.value, gradeUnit: gunit.value.trim() || undefined, cutoffs: cut.value.split(/[,;\s]+/).map(Number).filter(Number.isFinite),
      density: dcol.value ? { col: dcol.value, unit: dunit.value } : { const: +dconst.value || 1, unit: dunit.value }, groupBy: [g1.value, g2.value].filter(Boolean),
      ...(mfv != null ? { metalFactor: mfv } : {}), metalUnit: munit.value.trim() || undefined, scope: scope.value };
    go.disabled = true; msg.textContent = 'computing…';
    try { await addResourceFrame(p); w.close(); } catch (e) { msg.textContent = e.message; go.disabled = false; }
  };
}

export async function refreshAllFigures() {
  let n = 0;
  for (const fig of S.figures) n += await refreshViews(fig);
  $('#meta').textContent = `composer: ${S.figures.length} figure${S.figures.length === 1 ? '' : 's'}, ${n} view${n === 1 ? '' : 's'} rendered again`;
  return n;
}
// a PDF the composer wrote carries its figure: open it as one (and say how its data compares)
export async function openFigurePdf(blob, name) {
  const { doc } = await figureFromPdf(new Uint8Array(await blob.arrayBuffer()));
  if (!doc) { $('#meta').textContent = `${name}: no compo figure inside — only PDFs micro's composer wrote carry one`; return null; }
  let nm = doc.title || name.replace(/\.pdf$/i, '');
  if (S.figures.some((f) => f.name === nm)) { let k = 2; while (S.figures.some((f) => f.name === `${nm} (${k})`)) k++; nm = `${nm} (${k})`; }
  doc.title = nm;
  const fig = { name: nm, doc, file: 'figures/' + slug(nm) + '.compo.json' };
  S.figures.push(fig); S.figures.sort((a, b) => a.name.localeCompare(b.name));
  openComposer(nm);
  persist(fig);
  const views = doc.frames.filter(isView), st = views.map(staleOf).filter(Boolean);
  $('#meta').textContent = `${name}: the figure “${nm}” — ${views.length} view${views.length === 1 ? '' : 's'}${st.length ? `, ${st.length} of them made from data that isn't loaded or has changed (hover the badge) — ⇄ other data… points it at what's loaded` : views.length ? ', made from the data loaded now' : ''}`;
  return fig;
}

// ── USE WITH OTHER DATA: the figure (or a template, or a PDF micro wrote) pointed at the layers
// loaded now. Each layer it used is matched to a loaded one, each column it used that the new
// layer lacks is named and can be swapped, the views follow the data (moved with it, or scaled
// to it), and ↻ refresh makes everything again. See retarget.js. ──
const layerCols = (L) => { const s = new Set(); try { for (const c of colorChoices(L)) s.add(c); } catch { /* */ } try { const h = layerTableHeader(L); if (h) for (const c of schemaExt(L, h)) s.add(c.name); } catch { /* */ } return s; };
const candOf = (L) => ({ name: L.name, label: L.label || L.name, cols: layerCols(L), box: (() => { const b = layerWorldBox(L); return b && b.map((p) => p.map((v) => +(+v).toFixed(3))); })() });
export async function retargetFigure(fig, plan, { asNew = true, name = null } = {}) {
  let target = fig;
  if (asNew) {
    const first = Object.values(plan.layers || {}).find(Boolean), L0 = first && S.layers.find((x) => x.name === first);
    let nm = name || `${fig.name.replace(/ — .*$/, '')} — ${L0 ? (L0.label || L0.name).replace(/\.[^.]+$/, '') : 'other data'}`;
    if (S.figures.some((f) => f.name === nm)) { let k = 2; while (S.figures.some((f) => f.name === `${nm} (${k})`)) k++; nm = `${nm} (${k})`; }
    const doc = parseDocument(serializeDocument(fig.doc)); doc.title = nm; delete doc.template;
    if (doc.props) { delete doc.props.drawing; delete doc.props.revision; }
    target = { name: nm, doc, file: 'figures/' + slug(nm) + '.compo.json' };
    S.figures.push(target); S.figures.sort((a, b) => a.name.localeCompare(b.name));
  }
  const report = retargetDoc(target.doc, plan, (nm) => { const L = S.layers.find((x) => x.name === nm); return L ? candOf(L) : null; });
  if (_ed) { if (_fig === fig || asNew) showFigure(target); if (_win && _win._fill) _win._fill(); }
  await refreshViews(target);
  persist(target);
  return { figure: target, report };
}
export function openRetargetDialog(fig = _fig) {
  if (!fig) return;
  const refs = figureRefs(fig.doc);
  if (!refs.length) { $('#meta').textContent = `composer: “${fig.name}” names no data — nothing to point elsewhere`; return; }
  if (!S.layers.length) { $('#meta').textContent = 'composer: open the other data first, then “use with other data…”'; return; }
  const cands = S.layers.map(candOf);
  const w = floatWin({ title: 'use with other data', sub: fig.name, x: 160, y: 110, w: 520, h: Math.min(560, 200 + refs.length * 90) });
  w.el.classList.add('cmp-retarget');
  const body = w.body; body.style.cssText += 'display:flex;flex-direction:column;gap:8px;padding:10px;overflow:auto';
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = 'each layer the figure used → a layer loaded now. Columns the new layer lacks are named; pick a replacement or leave them (the frame will say what is missing).';
  body.append(hint);
  const mk = (tag, txt, cls) => { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; };
  const selOf = (opts, val) => { const s = document.createElement('select'); for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); } s.value = val; return s; };
  const rows = [];
  for (const ref of refs) {
    const box = mk('div', null, 'cmp-rt-layer'); box.style.cssText = 'border:1px solid var(--border);border-radius:3px;padding:6px 8px;display:flex;flex-direction:column;gap:4px';
    const head = mk('div'); head.style.cssText = 'display:flex;gap:8px;align-items:center';
    const nm = mk('b', ref.name); nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; nm.title = `used in: ${[...ref.where].join(', ')}`;
    const sel = selOf([['', '— leave as it is'], ...cands.map((c) => [c.name, c.label])], guessLayer(ref, cands));
    head.append(nm, mk('span', '→'), sel);
    const where = mk('div', `${[...ref.where].join(' · ')}${ref.filters.size ? ` · filter ${[...ref.filters].join(' ; ')}` : ''}`, 'hint');
    const colsEl = mk('div'); colsEl.style.cssText = 'display:grid;grid-template-columns:auto auto 1fr;gap:3px 8px;align-items:center';
    const colSel = new Map();
    const fillCols = () => {
      colsEl.replaceChildren(); colSel.clear();
      const c = cands.find((x) => x.name === sel.value); if (!c) return;
      for (const col of [...ref.cols].sort()) {
        if (c.cols.has(col)) continue;
        const g = guessColumn(col, c.cols);
        const s2 = selOf([['', '— missing'], ...[...c.cols].map((x) => [x, x])], g);
        colSel.set(col, s2);
        colsEl.append(mk('span', col), mk('span', '→'), s2);
      }
      if (!colSel.size && ref.cols.size) colsEl.append(mk('span', `columns ${[...ref.cols].join(', ')} — all there`, 'hint'));
    };
    sel.onchange = fillCols; fillCols();
    box.append(head, where, colsEl); body.append(box);
    rows.push({ ref, sel, colSel });
  }
  const opt = mk('div'); opt.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  const place = selOf([['move', 'views move with the data'], ['scale', 'views scale to the data']], 'move');
  place.title = 'move: each view keeps its size and shifts by the difference between the old and new data centres — a view of the north end still frames the north end.\nscale: the same, and also grows or shrinks with the data\'s extent.\nA locked scale stays as it is.';
  const asNew = mk('input'); asNew.type = 'checkbox'; asNew.checked = true;
  const lab = mk('label'); lab.append(asNew, document.createTextNode(' as a new figure'));
  opt.append(place, lab);
  const msg = mk('span', '', 'hint'), go = mk('button', 'Apply', 'awin-btn btn-p');
  const foot = mk('div'); foot.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:flex-end'; foot.append(msg, go);
  body.append(opt, foot);
  go.onclick = async () => {
    const plan = { layers: {}, columns: {}, placement: place.value };
    for (const r of rows) {
      if (!r.sel.value) continue;
      plan.layers[r.ref.name] = r.sel.value;
      const m = {}; for (const [a, s2] of r.colSel) if (s2.value) m[a] = s2.value;
      if (Object.keys(m).length) plan.columns[r.ref.name] = m;
    }
    if (!Object.keys(plan.layers).length) { msg.textContent = 'match at least one layer'; return; }
    go.disabled = true; msg.textContent = 'making it again…';
    try {
      const { figure, report } = await retargetFigure(fig, plan, { asNew: asNew.checked });
      w.close();
      const missing = rows.flatMap((r) => [...r.colSel].filter(([, s2]) => !s2.value).map(([a]) => `${r.ref.name}: ${a}`));
      $('#meta').textContent = `composer: “${figure.name}” — ${report.views} view${report.views === 1 ? '' : 's'}, ${report.charts + report.tables} chart / table frame${report.charts + report.tables === 1 ? '' : 's'} made with the other data${missing.length ? ` · still missing ${missing.join(', ')}` : ''}`;
    } catch (e) { msg.textContent = e.message; go.disabled = false; }
  };
  return w;
}

// ── a view frame's own inspector rows: its scale (shown, and lockable) ──
function viewInspector(f, el) {
  if (!isView(f) || !_ed) return;
  if (f.source && f.source.keyFor) {                        // a key plan: which views' sections it shows
    const on = new Set([].concat(f.source.keyFor)), cands = keyable(_ed.getDoc(), f);
    const head = document.createElement('div'); head.className = 'hint'; head.textContent = 'shows the sections of:';
    el.append(head);
    if (!cands.length) { const n = document.createElement('div'); n.className = 'hint'; n.textContent = 'no view on the page is cut by a non-plan section'; el.append(n); }
    for (const c of cands) {
      const lab = document.createElement('label'); lab.className = 'cmp-keyfor';   // in the inspector's value column
      lab.style.cssText = 'display:flex;gap:6px;align-items:center;margin-left:72px;min-height:22px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on.has(c.id); cb.dataset.id = c.id;
      const sec = c.content.meta.facts.section;
      cb.onchange = () => _ed.update(f.id, (fr) => { const s2 = new Set([].concat(fr.source.keyFor || [])); if (cb.checked) s2.add(c.id); else s2.delete(c.id); fr.source = { ...fr.source, keyFor: [...s2] }; });
      cb.style.margin = '0'; lab.append(cb, document.createTextNode(`${c.id} — ${sectionText(sec)}`)); el.append(lab);
    }
  }
  const m = f.content.meta || {}, wpm = m.worldPerPx > 0 ? (m.worldPerPx * (f.content.height || 1)) / f.box[3] : 0;
  const now = wpm > 0 ? Math.round(wpm * 1000) : null;
  const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.step = 'any';
  inp.className = 'cmp-scale'; inp.value = f.content.scaleLock || ''; inp.placeholder = now ? String(now) : '—';
  if (!now && !f.content.scaleLock) inp.disabled = true;   // a perspective view has no scale to lock
  inp.title = 'lock the scale: 1 : this many (orthographic views) — the frame then shows more or less when resized, never at another scale; empty = free';
  inp.onkeydown = (e) => e.stopPropagation();
  inp.onchange = async () => {
    const v = +inp.value;
    _ed.update(f.id, (fr) => { if (v > 0) fr.content.scaleLock = v; else delete fr.content.scaleLock; });
    const fr = frameById(_ed.getDoc(), f.id); await rerender(fr, PREVIEW_PX_PER_MM); _ed.render();
  };
  const row = document.createElement('div'); row.className = 'row';   // the editor's grid: a label, then one value cell
  const lab = document.createElement('span'); lab.textContent = 'scale';
  const ctl = document.createElement('span'); ctl.className = 'ctl';
  const one = document.createElement('span'); one.className = 'hint'; one.textContent = '1 :';
  const hint = document.createElement('span'); hint.className = 'hint';
  hint.textContent = f.content.scaleLock ? 'locked' : m.ortho ? 'free' : 'perspective';
  ctl.append(one, inp, hint); row.append(lab, ctl); el.append(row);
  // what this view's {count} and statistics captions cover: the records inside its section (what
  // the image shows — the default), or the whole model; filters apply either way
  const sec = m.facts && m.facts.section;
  const srow = document.createElement('div'); srow.className = 'row';
  const slab = document.createElement('span'); slab.textContent = 'captions';
  const sctl = document.createElement('span'); sctl.className = 'ctl';
  const ssel = document.createElement('select'); ssel.className = 'cmp-statsscope';
  for (const [v, t] of [['section', 'in the section'], ['model', 'whole model']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; ssel.append(o); }
  ssel.value = statsScopeOf(f);
  ssel.title = 'what {count} and the statistics ({mean:AU} …) in captions about this view count: the records inside its section — block centroids, interval midpoints; what the image shows — or the whole model. Filters apply either way.';
  ssel.onkeydown = (e) => e.stopPropagation();
  ssel.onchange = async () => {
    const v = ssel.value;
    _ed.update(f.id, (fr) => { fr.content = { ...fr.content, statsScope: v }; });
    const fr = frameById(_ed.getDoc(), f.id);
    if (fr && fr.source && fr.source.scene) { await withScene(fr.source.scene, () => completeFacts(_ed.getDoc(), fr)); _ed.render(); }
  };
  sctl.append(ssel);
  if (!sec) { const nh = document.createElement('span'); nh.className = 'hint'; nh.textContent = 'no section'; nh.title = 'this view has no section: its captions count the whole model either way'; sctl.append(nh); }
  srow.append(slab, sctl); el.append(srow);
}
// ── double-click a view frame: work it in the 3D view, at the frame's shape; Done re-captures it ──
let _editing = null;
export function editViewInPlace(f) {
  if (_editing || !_ed || !isView(f)) return;
  const ed = _ed, id = f.id, mine = captureScene('__composer');
  _editing = { id };
  applyScene(f.source.scene);
  const view = S.cv.parentElement, r = view.getBoundingClientRect(), aspect = f.box[2] / f.box[3];
  const hgt = r.height, wid = Math.min(r.width, hgt * aspect), h2 = wid < hgt * aspect ? wid / aspect : hgt;
  const frameEl = document.createElement('div'); frameEl.className = 'cmp-editframe';
  frameEl.style.cssText = `position:absolute;left:${(r.width - wid) / 2}px;top:${(r.height - h2) / 2}px;width:${wid}px;height:${h2}px;box-shadow:0 0 0 9999px rgba(0,0,0,0.42);outline:1px dashed #fff;pointer-events:none;z-index:5`;
  const bar = document.createElement('div'); bar.className = 'cmp-editbar';
  bar.style.cssText = 'position:absolute;left:50%;top:8px;transform:translateX(-50%);z-index:6;display:flex;gap:6px;align-items:center;padding:4px 8px;background:var(--bg-panel, #222);border:1px solid var(--border);border-radius:4px';
  const msg = document.createElement('span'); msg.textContent = `editing ${id} — navigate, section, filter; the frame shows what is inside the box`;
  const done = document.createElement('button'); done.className = 'awin-btn btn-p'; done.textContent = 'Done';
  const cancel = document.createElement('button'); cancel.className = 'awin-btn'; cancel.textContent = 'Cancel';
  bar.append(msg, done, cancel);
  view.append(frameEl, bar);
  if (_win) _win.el.style.display = 'none';
  const finish = async (keep) => {
    frameEl.remove(); bar.remove(); _editing = null;
    if (keep && _ed === ed && frameById(ed.getDoc(), id)) { ed.update(id, (fr) => viewFrameContent(fr)); afterFacts(ed, id); }
    await applyScene(mine);
    if (_win) _win.el.style.display = '';
    $('#meta').textContent = keep ? `composer: ${id} re-captured` : 'composer: edit cancelled';
  };
  done.onclick = () => finish(true); cancel.onclick = () => finish(false);
  _editing.finish = finish;
  $('#meta').textContent = `composer: editing ${id} in the 3D view — Done re-captures it`;
}
export const viewEditState = () => _editing;

// ── KEY PLAN: a whole-model plan that wears the section of the view it keys (source.keyFor): the
// trace and the slab of that view's section as it was rendered — so on every atlas page the line
// moves with the page. The plan itself is a view frame (its own scene: north up, no section). ──
const KEY_COLORS = ['#c0392b', '#1f6fb4', '#2e8b57', '#8e44ad', '#d35400', '#16a085'];
const saysFig = (f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || '');
function overlaysFor(frame, env) {
  const kf = frame.source && frame.source.keyFor; if (!kf || !env.doc) return null;
  const out = [];
  [].concat(kf).forEach((id, k) => {
    const t = env.doc.frames.find((x) => x.id === id), fx = t && t.content && t.content.meta && t.content.meta.facts;
    const sec = fx && fx.section; if (!sec || !sec.normal) return;
    const cap = env.figOf ? refFrame(env.doc, t, null, saysFig) : null;
    out.push({ type: 'plane', normal: sec.normal, position: sec.position, thickness: sec.thickness || 0, color: KEY_COLORS[k % KEY_COLORS.length], label: (cap ? `Fig ${env.figOf(cap)} · ` : '') + sectionText(sec) });
  });
  return out;
}
// the views a key plan can show: those whose section is not a plan (a vertical or a dipping cut)
const keyable = (doc, self) => doc.frames.filter((x) => isView(x) && x !== self && !(x.source && x.source.keyFor) && (() => { const s = x.content && x.content.meta && x.content.meta.facts && x.content.meta.facts.section; return s && s.mode !== 'plan'; })());
export async function addKeyPlan(ed, target = null) {
  const doc = ed.getDoc(), sel = ed.selected().find(isView);
  // one view (the one asked for, or selected) — else every view on the page cut by a non-plan section
  const keys = target ? [target] : sel ? [sel] : keyable(doc, null);
  target = keys[0] || doc.frames.find(isView);
  if (!target) { $('#meta').textContent = 'composer: a key plan keys a 3D-view frame — add one first'; return null; }
  const bb = rendererDocBbox(); if (!bb || !(bb[3] > bb[0])) { $('#meta').textContent = 'composer: nothing loaded to plan'; return null; }
  const [W, H] = pageDims(doc.page), m = doc.page.margins || [10, 10, 10, 10];
  const dx = bb[3] - bb[0], dy = bb[4] - bb[1], w = 60, h = Math.max(30, Math.min(80, +(w * dy / Math.max(1e-9, dx)).toFixed(1)));
  const box = [W - m[1] - w, H - m[2] - h, w, h];
  const mine = captureScene('__composer');
  let f = null;
  try {
    await applyScene(target.source.scene);                 // the same layers and colours as the view it keys …
    setSectionWorld(null);                                 // … but the whole model, from above, north up
    const o = S.frame ? S.frame.origin : [0, 0, 0], st = S.cam.state;
    const halfH = Math.max(dy / 2, dx / 2 / (w / h)) * 1.06;
    HK.setCameraWorld({ look: 0, elevation: 90, ortho: true, target: [(bb[0] + bb[3]) / 2 + o[0], (bb[1] + bb[4]) / 2 + o[1], (bb[2] + bb[5]) / 2 + o[2]], distance: halfH / Math.tan(st.fovY / 2) });
    f = ed.addFrame({ kind: 'image', box, content: { photo: true }, source: { app: 'micro', kind: 'view', keyFor: (keys.length ? keys : [target]).map((x) => x.id) }, style: { border: true } });
    ed.update(f.id, (fr) => viewFrameContent(fr));
    afterFacts(ed, f.id);
  } finally { await applyScene(mine); }
  $('#meta').textContent = `composer: a key plan for ${target.id} — its section shows on it, page by page in an atlas`;
  return f;
}

// ── SMALL MULTIPLES: one view repeated — coloured by each of several columns, cut at several
// section levels, or under several filters — in a grid over the view's own box, each copy a
// normal view frame with a caption that says which. They form a group. ──
export async function smallMultiples(ed, f, { vary, values, cols, axis = 'z', thickness = 10 }) {
  if (!isView(f) || !values || !values.length) return [];
  const base = f.source.scene, n = values.length;
  multiplesGrid(f.box, n, { cols });                      // too small → refused before the scene moves
  const mainName = (base.layers.find((sl) => sl.visible) || base.layers[0] || {}).name;
  const L = S.layers.find((x) => (x.label || x.name) === mainName || x.name === mainName);
  const mine = captureScene('__composer');
  let made;
  try {
    made = await compoMultiples(ed, f, {
      n, cols,
      variant: async (k, box) => {                         // copy k: the view under its own scene
        const v = values[k], scene = JSON.parse(JSON.stringify(base));
        const sl = scene.layers.find((q) => q.name === mainName);
        if (vary === 'colour' && sl && L) { sl.colorSel = colorSelFor(L, v); sl.color = v; }   // the name is what a scene applies
        if (vary === 'filter' && sl) sl.filter = String(v);
        await applyScene(scene);
        if (vary === 'section') setSectionWorld({ axis, position: +v, thickness: +thickness || 10 });
        const vf = ed.addFrame({ kind: 'image', box, content: { photo: true }, source: { app: 'micro', kind: 'view' }, style: { border: true } });
        ed.update(vf.id, (fr) => viewFrameContent(fr));
        afterFacts(ed, vf.id);
        return vf;
      },
      caption: (k) => (vary === 'section' ? '{section}' : String(values[k])),
    });
  } finally { await applyScene(mine); }
  persistSoon(_fig);
  $('#meta').textContent = `composer: ${n} small multiples (${vary}) in place of ${f.id} — a group; each is a view of its own`;
  return made;
}
function openMultiplesDialog(ed, f) {
  const mainName = (f.source.scene.layers.find((sl) => sl.visible) || {}).name;
  const L = S.layers.find((x) => (x.label || x.name) === mainName || x.name === mainName);
  const choices = L ? colorChoices(L).filter((c) => !['rules', 'solid', 'elev'].includes(c)) : [];
  const w = floatWin({ title: 'small multiples', sub: f.id, x: 160, y: 140, w: 420, h: 360 });
  w.el.classList.add('cmp-multiples');
  const body = w.body; body.style.cssText += 'display:grid;grid-template-columns:110px 1fr;gap:6px 8px;align-items:center;padding:10px';
  const row = (label, el) => { const l = document.createElement('span'); l.textContent = label; body.append(l, el); return el; };
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const vary = row('vary', mk('select', {}));
  for (const [v, t] of [['colour', 'colour by a column'], ['section', 'section level'], ['filter', 'filter']]) vary.append(mk('option', { value: v, textContent: t }));
  const cols = row('columns', mk('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 10px;max-height:110px;overflow:auto' }));
  for (const c of choices) { const lab = mk('label', {}); lab.append(mk('input', { type: 'checkbox', value: c, checked: choices.indexOf(c) < 4 }), ' ' + c); cols.append(lab); }
  const vals = row('values', mk('input', { placeholder: 'section: 600, 620, 640 · filter: AU > 1; AU > 2', title: 'section levels (comma-separated), or filters (semicolon-separated)' }));
  const axis = row('axis', mk('select', {})); for (const a of ['z', 'x', 'y']) axis.append(mk('option', { value: a, textContent: a === 'z' ? 'z (plan)' : a === 'x' ? 'x (N–S)' : 'y (E–W)' }));
  const thick = row('thickness', mk('input', { type: 'number', value: 10, min: 0.1, step: 'any' }));
  const per = row('per row', mk('input', { type: 'number', value: '', min: 1, placeholder: 'auto' }));
  for (const el of [vals, thick, per]) el.onkeydown = (e) => e.stopPropagation();
  const sync = () => { const v = vary.value; cols.parentElement && (cols.style.opacity = v === 'colour' ? 1 : 0.35); vals.disabled = v === 'colour'; axis.disabled = thick.disabled = v !== 'section'; };
  vary.onchange = sync; sync();
  const go = mk('button', { className: 'awin-btn btn-p', textContent: 'Make' }), msg = mk('span', { className: 'hint' });
  body.append(msg, go);
  go.onclick = async () => {
    const v = vary.value;
    const values = v === 'colour' ? [...cols.querySelectorAll('input:checked')].map((i) => i.value)
      : v === 'section' ? vals.value.split(/[,\s]+/).map(Number).filter(Number.isFinite) : vals.value.split(';').map((s) => s.trim()).filter(Boolean);
    if (!values.length) { msg.textContent = 'nothing to repeat over'; return; }
    go.disabled = true; msg.textContent = 'rendering…';
    try { await smallMultiples(ed, f, { vary: v, values, cols: +per.value || 0, axis: axis.value, thickness: +thick.value }); w.close(); }
    catch (e) { msg.textContent = e.message; go.disabled = false; }
  };
}

// ── VECTOR SECTIONS: with content.vectorOn, a view frame's blocks are drawn as vector cells (the
// section plane through each block model the view shows), the view's other layers as a transparent
// render on top. Rebuilt with every render of the frame (preview, refresh, export, atlas page) —
// called while the frame's scene is on. ──
function vectorWhyNot(fx, proj) {
  const sec = fx && fx.section, cam = fx && fx.camera;
  if (!sec || !Array.isArray(sec.normal)) return 'a vector section needs a section on the view';
  if (!cam || !cam.ortho) return 'a vector section needs an orthographic view';
  const msg = 'a vector section is seen square-on: look straight at the section plane (a plan from above, a vertical section along its strike)';
  if (proj && Array.isArray(proj.m) && proj.m.length === 16) {
    // the world direction the view collapses to a point (column-major: rows 0 and 1 of the 3×3) — in
    // the exaggerated display space, it must lie along the plane's normal (within 5°)
    const m = proj.m, r0 = [m[0], m[4], m[8]], r1 = [m[1], m[5], m[9]], e = cam.zExag || 1;
    const w = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
    const wd = [w[0], w[1], w[2] * e], nd = [sec.normal[0], sec.normal[1], sec.normal[2] / e];
    const c = Math.abs(wd[0] * nd[0] + wd[1] * nd[1] + wd[2] * nd[2]) / ((Math.hypot(...wd) * Math.hypot(...nd)) || 1);
    return c > Math.cos((5 * Math.PI) / 180) ? null : msg;
  }
  if (!SEC_AXES[sec.mode]) return msg;                     // no projection recorded: only the axis cases can be judged
  const lk = ((cam.look % 360) + 360) % 360, el = cam.elevation, near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 5;
  const along = sec.mode === 'plan' ? el > 85 : Math.abs(el) < 5 && (sec.mode === 'ns' ? (near(lk, 90) || near(lk, 270)) : (near(lk, 0) || near(lk, 180)));
  return along ? null : msg;
}
// a layer in a vector section: blocks always; drillholes and meshes when they're cut by the section
// the ordinary way (or, drillholes, as whole holes crossing it). Anything else stays in the raster
// overlay, with the reason.
async function vectorLayer(L, sec, near, outlines = null) {   // outlines: the frame's own mode, else the Settings default
  const name = L.label || L.name, mode = S.renderer.layerSectioned(L.id);
  if (gridAxesOf(L)) {
    const ga = gridAxesOf(L);
    if (SEC_AXES[sec.mode] && !ga.rot) {                   // v1's form: compact, and what older figures hold
      const c = await sectionCells(L, sec, { outlines });
      return { type: 'cells', layer: name, axis: SEC_AXES[sec.mode], position: sec.position, rects: c.rects.map((v) => +v.toFixed(4)), colors: c.colors, palette: c.palette, blocks: c.blocks, ...(c.outline ? { outline: c.outline } : {}) };
    }
    const c = await sectionShapes(L, sec, near, { outlines });
    if (c.rects) c.rects = c.rects.map((v) => +v.toFixed(4)); if (c.pts) c.pts = c.pts.map((v) => +v.toFixed(4));
    return { ...c, layer: name };
  }
  if (L.dh && L.docs && L.docs.dhDoc) {
    if (mode === false || mode === 'front' || mode === 'behind') return { skip: `${name}: not cut by the section` };
    const c = await sectionDrillholes(L, sec, near, { mode, radius: S.renderer.layerStickRadius(L.id) || 1 });
    c.pts = c.pts.map((v) => +v.toFixed(4));
    return { ...c, layer: name };
  }
  if (L.kind === 'mesh' && L.docs && L.docs.meshDoc) {
    if (mode === false) return { skip: `${name}: not cut by the section` };
    const m = await meshVertexData(L);
    if (!m) return { skip: `${name}: a streamed mesh keeps no triangles to cut` };
    const c = sectionMesh(L, sec, near, m, { tint: L.tint || '#9ea3a8' });
    c.pts = c.pts.map((v) => +v.toFixed(4));
    return { ...c, layer: name };
  }
  if (L.docs && L.docs.stringsDoc && L.docs.stringsDoc.features) {   // strings & polygons: lines in the slab (+ fills on a plan)
    if (mode === false) return { skip: `${name}: not cut by the section` };
    return sectionFeatures(L, sec, near, { radius: S.renderer.layerStickRadius(L.id) || 1 }).map((c) => ({ ...c, pts: c.pts.map((v) => +v.toFixed(4)), layer: name }));
  }
  return { skip: null };                                   // points, grids, …: the raster's
}
const vectorSummary = (l) => l.type === 'lines' ? `${l.layer}: ${l.starts.length} lines${l.intervals != null ? ` from ${l.intervals} intervals` : ''}` : `${l.layer}: ${l.colors.length} ${l.type === 'polys' ? 'polygons' : 'cells'} from ${l.blocks} blocks`;
async function buildVector(f) {
  const fx = f.content.meta && f.content.meta.facts, why = vectorWhyNot(fx, f.content.meta && f.content.meta.proj);
  if (why) throw new Error(why);
  const sec = fx.section;
  const shown = S.layers.filter((L) => fx.layers.some((l) => l.name === (L.label || L.name)));
  if (!shown.some((L) => gridAxesOf(L) || L.dh || L.kind === 'mesh' || (L.docs && L.docs.stringsDoc && L.docs.stringsDoc.features))) throw new Error('a vector section draws block models, drillholes, meshes and strings & polygons — this view shows none');
  // the plane's stored coordinates are kept small: its origin sits near the data
  const P = f.content.meta.proj, near = P && Array.isArray(P.focus) ? P.focus : [0, 0, 0];
  const layers = [], vectored = [], notes = [];
  for (const L of shown) {
    const r = await vectorLayer(L, sec, near, f.content.vectorOutlines || null);
    if (r.skip !== undefined) { if (r.skip) notes.push(r.skip); continue; }
    if (Array.isArray(r)) layers.push(...r); else layers.push(r);   // a feature layer brings its fills + its lines
    vectored.push(L);
  }
  const blocks = vectored, others = shown.filter((L) => !vectored.includes(L));
  let overlay = null;
  if (others.length) {                                      // the rest of the view, without the blocks, on a transparent background
    for (const L of blocks) S.renderer.setLayerVisible(L.id, false);
    // the renderer's last pass writes an opaque background, so the overlay is drawn on a KEY colour
    // (magenta, which no ramp uses) and the key is cut out — near-key edge pixels too
    S.renderer.setBackground([1, 0, 1, 1]);
    try {
      const [w, h] = pxFor(f, PREVIEW_PX_PER_MM * 2), cv = HK.renderViewCanvas(w, h), g = cv.getContext('2d'), im = g.getImageData(0, 0, w, h), d = im.data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 2] > 200 && d[i + 1] < 60 && Math.abs(d[i] - d[i + 2]) < 40) d[i + 3] = 0;
      g.putImageData(im, 0, 0); overlay = cv.toDataURL('image/png');
    }
    finally { applyBg(); for (const L of blocks) S.renderer.setLayerVisible(L.id, L.visible !== false); }
  }
  f.content.vector = { background: f.source.bg || _bgColor, layers, overlay, ...(notes.length ? { notes } : {}) };
  f._vimg = null;
  delete f.content.vectorError;
}

// ── HOUSE STYLE: the project's shared properties (company, client, project, prepared, checked,
// disclaimer) in figures/house.json; a figure's own (drawing, revision) in its doc.props. {prop:key}
// reads the figure's over the house's. Any figure can be a TEMPLATE (doc.template): "new" can start
// from one — its frames, its page, its properties (drawing and revision cleared). The keys, the title
// block and the template mechanics are @gcu/compo's (house.js); micro keeps where they persist. ──
const HOUSE_FILE = 'figures/house.json';
function persistHouse() {
  if (!S.project) return Promise.resolve();
  const dir = S.project.dir, body = JSON.stringify({ format: 'micro-house', version: 1, props: S.house.props }, null, 1) + '\n';
  return queued(async () => { try { const fh = await resolveFileHandle(dir, HOUSE_FILE, { create: true }); const w = await fh.createWritable(); await w.write(body); await w.close(); } catch (e) { $('#meta').textContent = `house style not saved — ${e.message}`; } });
}
export function setHouseProps(props) { S.house = { ...(S.house || {}), props: { ...props } }; persistHouse(); if (_ed) _ed.render(); }
function openPropsDialog() {
  if (!_fig) return;
  const w = floatWin({ title: 'properties', sub: _fig.name, x: 160, y: 120, w: 420, h: 420 });
  w.el.classList.add('cmp-props');
  const body = w.body; body.style.cssText += 'display:grid;grid-template-columns:110px 1fr;gap:6px 8px;align-items:center;padding:10px';
  const head = (t) => { const h = document.createElement('div'); h.textContent = t; h.style.cssText = 'grid-column:1/3;font-weight:bold;margin-top:4px'; body.append(h); };
  const inputs = {};
  const row = (key, label, val, scope) => { const l = document.createElement('span'); l.textContent = label; const i = document.createElement('input'); i.value = val || ''; i.dataset.key = key; i.dataset.scope = scope; i.onkeydown = (e) => e.stopPropagation(); body.append(l, i); inputs[scope + ':' + key] = i; };
  head('this figure');
  for (const [k, lab] of FIGURE_KEYS) row(k, lab, (_fig.doc.props || {})[k], 'fig');
  head('the project (every figure)');
  const hp = (S.house && S.house.props) || {};
  for (const [k, lab] of HOUSE_KEYS) row(k, lab, hp[k], 'house');
  for (const k of Object.keys(hp)) if (!HOUSE_KEYS.some(([h]) => h === k)) row(k, k, hp[k], 'house');
  const hint = document.createElement('div'); hint.className = 'hint'; hint.style.gridColumn = '1/3';
  hint.textContent = 'captions and the title block read these as {prop:key} — {prop:client}, {prop:drawing}';
  const save = document.createElement('button'); save.className = 'awin-btn btn-p'; save.textContent = 'Save';
  body.append(hint, document.createElement('span'), save);
  save.onclick = () => {
    const fp = { ...(_fig.doc.props || {}) }, h2 = { ...hp };
    for (const i of Object.values(inputs)) { const v = i.value.trim(), tgt = i.dataset.scope === 'fig' ? fp : h2; if (v) tgt[i.dataset.key] = v; else delete tgt[i.dataset.key]; }
    _fig.doc.props = fp; setHouseProps(h2); persist(_fig); _ed.render();
    w.close();
  };
}
// the title block (compo's titleblock kind: ruled rows of fields, bottom-right, one frame)
export function addTitleBlock(ed) {
  const ids = compoTitleBlock(ed);
  $('#meta').textContent = 'composer: a title block — its fields read the figure\'s and the project\'s properties (properties…)';
  return ids;
}
// an image from a file — a logo, a photo, a sketch (compo inserts it; the source record is micro's)
const addImageFromFile = (ed) => compoImageFromFile(ed, { source: (name) => ({ app: 'micro', kind: 'image', name }) });

// ── the window ──
let _win = null, _ed = null, _fig = null, _saveT = 0;
export function composerOpen() { return !!(_win && document.body.contains(_win.el)); }
export function composerEditor() { return _ed; }
export function currentFigure() { return _fig; }

function newFigure(name, from = null) {
  let doc;
  if (from) doc = docFromTemplate(from.doc, name);         // from a template: its frames, page and properties; a drawing of its own
  else doc = createDocument({ title: name, page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] } });
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

// the composer's bars on a phone: finger-sized targets (the icons grow with them)
const COMPOSER_CSS = `
body.mobile .composer-win .compo-bar { gap: 6px; flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }   /* one swipeable strip each: the page keeps the sheet */
body.mobile .composer-win .compo-bar > *, body.mobile .composer-win .compo-bar .compo-grp-bar { flex: none; flex-wrap: nowrap; }
body.mobile .composer-win .compo-bar .compo-grp-bar { gap: 6px; }
body.mobile .composer-win .compo-bar button, body.mobile .composer-win .compo-bar select { height: 40px; }
body.mobile .composer-win .compo-bar button.compo-ico { min-width: 40px; }
body.mobile .composer-win .compo-bar button.compo-ico svg { width: 20px; height: 20px; }
`;
function injectComposerCss() {
  if (document.getElementById('composer-css')) return;
  const s = document.createElement('style'); s.id = 'composer-css'; s.textContent = COMPOSER_CSS; document.head.append(s);
}
export function openComposer(name) {
  let fig = name ? S.figures.find((f) => f.name === name) : _fig || S.figures[0];
  if (!fig) fig = newFigure(name || 'figure 1');
  if (composerOpen()) { showFigure(fig); _win.el.style.zIndex = String(+_win.el.style.zIndex + 1); return _ed; }
  _win = floatWin({ title: 'composer', sub: fig.name, x: 70, y: 70, w: Math.min(1180, innerWidth - 40), h: Math.min(820, innerHeight - 100), onClose: () => { if (_fig) persist(_fig); _ed = null; _win = null; } });
  _win.el.classList.add('composer-win');
  injectComposerCss();
  const body = _win.body; body.style.cssText += 'display:flex;flex-direction:column;padding:0;overflow:hidden';
  const top = document.createElement('div'); top.className = 'compo-bar cmp-top';   // the editor bar's look: one toolbar language
  top.style.font = '12px/1.35 var(--compo-font, system-ui, sans-serif)';
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; return s; };
  const pick = document.createElement('select'); pick.title = 'figure';
  const btn = (t, title, fn, cls = '') => { const b = document.createElement('button'); b.className = cls; b.textContent = t; b.title = title; b.onclick = fn; return b; };
  // an icon where the icon is obvious (compo's icons, so the two bars speak one language); words
  // where it isn't — the template toggle, properties…, other data…, atlas…
  const ib = (icon, label, title, fn, cls = '', text = '') => iconButton({ icon, label, title, run: fn, cls, text });
  const fromSel = document.createElement('select'); fromSel.title = 'what a new figure starts from: blank, or a template'; fromSel.className = 'cmp-from';
  const tplBtn = btn('☆ template', 'make this figure a template — new figures can start from it (its frames, page and properties)', () => { setTemplate(_fig.doc, !_fig.doc.template); persist(_fig); fill(); });
  const fill = () => {
    pick.replaceChildren(...S.figures.map((f) => { const o = document.createElement('option'); o.value = f.name; o.textContent = f.name + (f.doc.template ? ' ★' : ''); return o; })); pick.value = _fig ? _fig.name : '';
    const keep = fromSel.value; fromSel.replaceChildren(...[['', 'blank'], ['@compare', 'comparison report…'], ...S.figures.filter((f) => f.doc.template).map((f) => [f.name, 'from ' + f.name])].map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; })); fromSel.value = [...fromSel.options].some((o) => o.value === keep) ? keep : '';
    tplBtn.textContent = _fig && _fig.doc.template ? '★ template' : '☆ template';
  };
  pick.onchange = () => showFigure(S.figures.find((f) => f.name === pick.value));
  top.append(pick,
    ib('file-new', 'New figure', 'from the template chosen beside it, if any — or a comparison report of two model versions', async () => {
      if (fromSel.value === '@compare') { const n = ((await microPrompt('report name', 'model comparison')) || '').trim(); if (n) openCompareDialog({ name: n }); return; }
      const n = ((await microPrompt('figure name', `figure ${S.figures.length + 1}`)) || '').trim(); if (!n) return; const tpl = S.figures.find((f) => f.name === fromSel.value && f.doc.template) || null; showFigure(S.figures.find((f) => f.name === n) || newFigure(n, tpl)); fill(); }),
    fromSel,
    ib('rename', 'Rename figure', 'its file is renamed too', async () => {
      const n = ((await microPrompt('rename figure', _fig.name)) || '').trim(); if (!n || n === _fig.name) return;
      if (S.figures.some((f) => f.name === n)) { $('#meta').textContent = `a figure “${n}” exists`; return; }
      const old = _fig.file; _fig.name = n; _fig.doc.title = n; _fig.file = 'figures/' + slug(n) + '.compo.json';
      if (S.project && old) { try { await removeFileAt(S.project.dir, old); } catch { /* not written yet */ } }
      persist(_fig); fill(); _win.sub.textContent = n;
    }),
    ib('file-x', 'Delete figure', 'after a confirmation', async () => {
      if (!(await microConfirm('delete figure', `Delete the figure “${_fig.name}”${S.project ? ` and its file ${_fig.file}` : ''}?`, 'Delete'))) return;
      if (S.project && _fig.file) { try { await removeFileAt(S.project.dir, _fig.file); } catch { /* not written */ } }
      S.figures = S.figures.filter((f) => f !== _fig);
      showFigure(S.figures[0] || newFigure('figure 1')); fill();
    }));
  const sp = document.createElement('span'); sp.style.flex = '1';
  const dpiSel = document.createElement('select'); dpiSel.title = 'export resolution for the 3D views and the PNG';
  for (const d of [150, 300, 600]) { const o = document.createElement('option'); o.value = d; o.textContent = d + ' dpi'; dpiSel.append(o); }
  dpiSel.value = '300';
  const embLab = document.createElement('label'); embLab.className = 'cmp-embed'; embLab.style.cssText = 'display:flex;align-items:center;gap:4px;margin-right:4px';
  embLab.title = 'the PDF carries this figure (its scenes, layer and file names, coordinates, recipes) so micro can open it again as an editable figure.\nUntick for a deliverable that should hold only the page.';
  const embBox = document.createElement('input'); embBox.type = 'checkbox';
  embBox.onchange = () => { if (embBox.checked) delete _fig.doc.embedSource; else _fig.doc.embedSource = false; persist(_fig); };
  embLab.append(embBox, document.createTextNode('embed figure'));
  _win._syncEmbed = () => { embBox.checked = !(_fig && _fig.doc.embedSource === false); };
  top.append(sep(), ib('refresh', 'Refresh', 'make this figure again with the data as it is now: every 3D view from its scene, every chart and table from its analysis, every resource table', () => refreshViews(_fig)));
  top.append(btn('⇄ other data…', 'make this figure with other data: each layer it used → a layer loaded now, missing columns swapped, the views moved with the data — then everything made again', () => openRetargetDialog(_fig)));
  top.append(tplBtn, btn('properties…', 'the figure\'s drawing number and revision, and the project\'s house properties — {prop:key} in captions and the title block', () => openPropsDialog()));
  top.append(sep(), btn('atlas…', 'a routine that renders this figure once per section level into one PDF (Tools → Recipes)', () => makeAtlasRoutine(_fig)));
  top.append(sp, embLab, dpiSel, ib('download', 'Export PDF', 'the page as a vector PDF (the 3D views re-rendered at the dpi)', () => exportFigurePdf(+dpiSel.value), 'btn-p', 'PDF'), ib('download', 'Export PNG', 'the page as a PNG at the dpi', () => exportFigurePng(+dpiSel.value), '', 'PNG'));
  const host = document.createElement('div'); host.style.cssText = 'flex:1;min-height:0';
  body.append(top, host);
  _win._fill = fill;
  _ed = mountEditor(host, fig.doc, {
    env: envFor(),
    onChange: (d) => { if (_fig) { _fig.doc = d; persistSoon(_fig); } },
    toolbar: [
      { icon: 'view', label: 'Add 3D view', title: 'the current 3D view as a frame (it remembers the scene)', run: (e) => addViewFrame(e) },
      { icon: 'legend', label: 'Add legend', title: 'a legend for each layer shown in the view frame', run: (e) => addLegendFrames(e) },
      { icon: 'scalebar', label: 'Add scale bar', title: 'a scale bar for the view frame (orthographic views have a scale)', run: (e) => addMarker(e, 'scalebar') },
      { icon: 'north', label: 'Add north arrow', title: 'a north arrow for the view frame', run: (e) => addMarker(e, 'north') },
      { icon: 'titleblock', label: 'Add title block', title: 'bottom-right: company, project, client, title, drawing, revision, date, prepared / checked, scale, page — fields from properties…', run: (e) => addTitleBlock(e) },
      { icon: 'image', label: 'Add image', title: 'an image from a file — a logo, a photo, a sketch', run: (e) => addImageFromFile(e) },
      { icon: 'table', label: 'Add resource table', title: 'tonnes, grade and metal above cutoffs, by domain × class — made again on Refresh', run: () => openResourceDialog() },
      { label: '+ key plan', title: 'a whole-model plan that shows where the selected view’s section is — page by page in an atlas', run: (e) => addKeyPlan(e) },
    ],
    frameMenu: (f, e) => frameMenu(f, e),
    frameBadge: (f) => staleOf(f),
    labelPoint: () => (S.lastPoint && Date.now() - S.lastPoint.t < 10 * 60e3 ? S.lastPoint.at : null),
    inspector: (f, el) => viewInspector(f, el),
    frameOpen: (f) => { if (!isView(f)) return false; editViewInPlace(f); return true; },
    onStatus: (m) => { $('#meta').textContent = 'composer: ' + m; },
  });
  _fig = fig; fill(); _win._syncEmbed();
  return _ed;
}
function showFigure(fig) {
  if (!fig) return;
  if (_fig && _fig !== fig) persist(_fig);
  _fig = fig;
  if (_ed) _ed.setDoc(fig.doc);
  if (_win) { _win.sub.textContent = fig.name; if (_win._fill) _win._fill(); if (_win._syncEmbed) _win._syncEmbed(); }
}
export const composerFrameMenu = (f, ed) => frameMenu(f, ed);   // the view frame's menu items — hosts and tests
function frameMenu(f, ed) {
  if (f.source && f.source.kind === 'view') return [
    { label: 'Update from the 3D view', run: () => { ed.update(f.id, (fr) => viewFrameContent(fr)); afterFacts(ed, f.id); } },
    { label: 'Refresh fields (statistics)', run: async () => { await withScene(f.source.scene, () => completeFacts(ed.getDoc(), f)); ed.render(); } },
    { label: 'Show in the 3D view', run: () => applyScene(f.source.scene) },
    { label: 'Re-render at this size', run: async () => { await rerender(f, PREVIEW_PX_PER_MM); ed.update(f.id, () => {}); } },
    { label: f.content.vectorOn ? 'Vector section: off (raster)' : 'Vector section (blocks, drillholes, meshes as vectors)', run: async () => {
      const on = !f.content.vectorOn;
      ed.update(f.id, (fr) => { if (on) fr.content.vectorOn = true; else { delete fr.content.vectorOn; delete fr.content.vector; delete fr.content.vectorError; } });
      if (on) { const fr = frameById(ed.getDoc(), f.id); await withScene(fr.source.scene, () => completeFacts(ed.getDoc(), fr)); ed.render(); $('#meta').textContent = fr.content.vectorError ? `composer: no vector section — ${fr.content.vectorError}` : `composer: ${f.id} is a vector section (${fr.content.vector.layers.map(vectorSummary).join(' · ')}${fr.content.vector.notes ? ' — raster: ' + fr.content.vector.notes.join('; ') : ''})`; }
    } },
    ...(f.content.vectorOn ? [{ label: `Vector outlines: ${f.content.vectorOutlines || `default (${_vecOutlines})`} — click to change`, run: async () => {
      const order = [null, ...VEC_OUTLINES], next = order[(order.indexOf(f.content.vectorOutlines || null) + 1) % order.length];
      ed.update(f.id, (fr) => { if (next) fr.content.vectorOutlines = next; else delete fr.content.vectorOutlines; });
      const fr = frameById(ed.getDoc(), f.id); await withScene(fr.source.scene, () => completeFacts(ed.getDoc(), fr)); ed.render();
      $('#meta').textContent = fr.content.vectorError ? `composer: ${fr.content.vectorError}` : `composer: vector outlines — ${next || `default (${_vecOutlines})`}`;
    } }] : []),
    { label: 'Small multiples…', run: () => openMultiplesDialog(ed, f) },
    { label: 'Key plan for this view', run: () => addKeyPlan(ed, f) },
  ];
  if (f.source && f.source.kind === 'legend') return [{ label: 'Update from the layer', run: () => { const L = S.layers.find((x) => x.name === f.source.layer); const c = L && legendContentFor(L); if (c) ed.update(f.id, (fr) => { fr.content = c; }); else $('#meta').textContent = `composer: layer “${f.source.layer}” has no legend now`; } }];
  return [];
}
async function rerender(f, pxPerMm) {
  await withScene(f.source.scene, async () => { const r = renderInto(f, pxPerMm, f.source.bg); storeImageQuiet(f, r.canvas, r.meta); await completeFacts(_ed ? _ed.getDoc() : { frames: [f] }, f); });
}
// at export: the hi-res render replaces the bitmap, but the stored preview stays small
function storeImageQuiet(f, canvas, meta) { f._img = canvas; f._jpeg = null; f.content = { ...f.content, width: canvas.width, height: canvas.height, meta }; }

export const composerEnv = (extra) => envFor(extra);   // the page env micro draws with (fields, overlays) — for hosts and tests
function envFor(extra = {}) {
  return {
    ...extra,
    fields: MICRO_FIELDS, fieldHelp: MICRO_FIELD_HELP, overlaysFor,
    get props() { return (S.house && S.house.props) || {}; },
    get crs() { return S.crs ? { name: S.crs.name, code: S.crs.epsg ? `EPSG:${S.crs.epsg}` : null } : null; },   // {crs} (compo's field; src/crs.js)
    // ${expr}: the atlas row's values (vars), then the nearest view's numbers (count, total,
    // section, look, elevation, page, pages), in the routine's expression language
    evalField: (expr, vars, frame, env) => {
      if (vars && Object.prototype.hasOwnProperty.call(vars, expr)) return vars[expr];
      const scope = { ...scopeOf(frame, env || {}), ...(vars || {}) };
      if (Object.prototype.hasOwnProperty.call(scope, expr)) return scope[expr];
      return HK.evalField ? HK.evalField(expr, scope) : `⟨${expr}⟩`;
    },
  };
}
// ── micro's fields, each about ONE view frame: the field's @id ({section@plan}), else the caption's
// "refers to", else the nearest view. Layer fields take a layer's name ({count:blocks}); statistics a
// column, optionally layer:column ({mean:AU}, {mean:holes:AU}). ──
const viewOf = (frame, env) => subjectFrame(env, frame, isView);
const factsOf = (frame, env) => { const v = viewOf(frame, env); return v && v.content && v.content.meta && v.content.meta.facts; };
const coord = (v, th) => {
  if (Math.abs(v) >= 1000) return groupDigits(Math.round(v)).replace(/^-/, '−');
  const dec = th && th < 1 ? 2 : Math.abs(v) < 10 ? 2 : 1;
  return String(+v.toFixed(dec)).replace(/^-/, '−');
};
function sectionText(sec) {
  if (!sec) return 'no section';
  const th = sec.thickness, band = th ? ` ± ${+(th / 2).toPrecision(3)}` : sec.clip === 'front' ? ' and above' : sec.clip === 'behind' ? ' and below' : '';
  if (sec.mode === 'plan') return `${coord(sec.position, th)} RL${band}`;
  if (sec.mode === 'ns') return `${coord(sec.position, th)} E${band}`;
  if (sec.mode === 'ew') return `${coord(sec.position, th)} N${band}`;
  const n = sec.normal || [0, 0, 1];
  const dipDir = sec.dipDir != null ? sec.dipDir : ((Math.atan2(-n[0], -n[1]) * 180) / Math.PI + 360) % 360;
  const dip = sec.dip != null ? sec.dip : (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;
  return `a plane dipping ${Math.round(dip)}° toward ${String(Math.round(dipDir) % 360).padStart(3, '0')}°${band}`;
}
// a named layer → that layer; unnamed → the layers whose records a caption counts (meshes' vertices and
// grids' nodes are context: an atlas bench read 265,998 'blocks' with them, 260,000 without)
const layersOf = (fx, a) => (fx ? fx.layers.filter((l) => (a ? l.name === a : !l.ctx)) : []);
const sum = (ls, k) => ls.reduce((s, l) => s + l[k], 0);
// {count}: the records the view shows after filters — in its section when the frame counts there
// (statsScope 'section', the default) and a section cuts the layer. null = not computed yet ('…')
function countOf(v, fx, ls) {
  if (statsScopeOf(v) !== 'section') return sum(ls, 'shown');
  let n = 0;
  for (const l of ls) {
    const cut = l.cut != null ? l.cut : !!fx.section;      // facts from before the scope existed: cut if the view had a section
    if (!cut) { n += l.shown; continue; }
    if (fx.statsScope !== 'section' || typeof l.inSection !== 'number') return null;
    n += l.inSection;
  }
  return n;
}
const MICRO_FIELDS = {
  section: (a, f, env) => { const fx = factsOf(f, env); return fx ? sectionText(fx.section) : null; },
  look: (a, f, env) => { const fx = factsOf(f, env); return fx && fx.camera ? fmtBearing(fx.camera.look) : null; },
  elevation: (a, f, env) => { const fx = factsOf(f, env); return fx && fx.camera ? Math.round(fx.camera.elevation) + '°' : null; },
  layers: (a, f, env) => { const fx = factsOf(f, env); return fx ? fx.layers.map((l) => l.name).join(', ') || 'no layers' : null; },
  count: (a, f, env) => { const fx = factsOf(f, env), ls = layersOf(fx, a); if (!ls.length) return null; const n = countOf(viewOf(f, env), fx, ls); return n == null ? '…' : n; },
  total: (a, f, env) => { const ls = layersOf(factsOf(f, env), a); return ls.length ? sum(ls, 'total') : null; },
  filter: (a, f, env) => {
    const ls = layersOf(factsOf(f, env), a); if (!ls.length) return null;
    const fl = ls.filter((l) => l.filter);
    return fl.length ? fl.map((l) => (ls.length > 1 ? `${l.name}: ${l.filter}` : l.filter)).join('; ') : 'no filter';
  },
  source: (a, f, env) => { const ls = layersOf(factsOf(f, env), a); return ls.length ? [...new Set(ls.map((l) => l.file))].join(', ') : null; },
  sha: (a, f, env) => {
    const ls = layersOf(factsOf(f, env), a); if (!ls.length) return null;
    const h = (l) => (l.sha ? String(l.sha).replace(/^[^:]*:/, '').slice(0, 8) : '…');
    return ls.length === 1 ? h(ls[0]) : ls.map((l) => `${l.file} ${h(l)}`).join(', ');
  },
  project: () => (S.project && S.project.name) || 'no project',
  micro: () => S.build || 'dev',
  cmp: (a, f, env) => compareField(a, f, env),               // a value of the page's comparison table (compare.js)
};
for (const k of ['mean', 'median', 'min', 'max', 'std', 'n']) MICRO_FIELDS[k] = (a, f, env) => {
  if (!a) return `⟨which column? {${k}:AU}⟩`;
  const fx = factsOf(f, env); if (!fx) return null;
  const st = fx.stats && fx.stats[a];
  if (!st || (fx.statsScope || 'model') !== statsScopeOf(viewOf(f, env))) return '…';   // not computed yet, or for the other scope (the view frame's menu: Refresh fields)
  return st.error ? `⟨${st.error}⟩` : st[k] == null ? '—' : st[k];   // — : nothing in the section has a value
};
const MICRO_FIELD_HELP = [
  { name: 'section', help: 'the section the nearest view shows: 630 RL ± 5 · 7 604 125 N' },
  { name: 'look', help: 'the bearing the view looks toward: 045°' },
  { name: 'elevation', help: 'how far above the horizon the eye sits: 30° (90° = plan)' },
  { name: 'layers', help: 'the layers the view shows' },
  { name: 'count', help: 'records shown, after filters — inside the view’s section unless the view frame counts the whole model (its “captions” setting): {count:,} · {count:layer}' },
  { name: 'total', help: 'records in the shown layers, before filters' },
  { name: 'filter', help: 'the filter(s) the view used' },
  { name: 'source', help: 'the files the shown layers read' },
  { name: 'sha', help: 'a short content hash of each source file' },
  { name: 'project', help: 'the project folder' },
  { name: 'micro', help: 'the micro build that made the page' },
  { name: 'mean', help: 'a column’s mean over the shown records (the same records {count} counts — the section’s, or the whole model’s): {mean:AU:.2f} · {mean:layer:AU}' },
  { name: 'median', help: 'a column’s median: {median:AU}' },
  { name: 'min', help: 'a column’s minimum: {min:AU}' },
  { name: 'max', help: 'a column’s maximum: {max:AU}' },
  { name: 'std', help: 'a column’s standard deviation: {std:AU}' },
  { name: 'n', help: 'how many of the records {count} counts have a value: {n:AU}' },
  { name: 'cmp', help: 'a value of the page’s comparison table (Compare model versions…): {cmp:delta_metal_pct:.1f} · {cmp:summary} · {cmp:blocks} · {cmp:group1} (the biggest move) · {cmp:bench1} · {cmp:old} / {cmp:new}' },
];
// the ${…} scope: the nearest view's numbers
function scopeOf(frame, env) {
  const out = { page: env.page ?? 1, pages: env.pages ?? 1 };
  const fx = env.doc ? factsOf(frame, env) : null;
  if (!fx) return out;
  const rl = layersOf(fx, null), n = countOf(viewOf(frame, env), fx, rl);
  out.count = n == null ? sum(rl, 'shown') : n; out.total = sum(rl, 'total');
  if (fx.camera) { out.look = fx.camera.look; out.elevation = fx.camera.elevation; }
  if (fx.section) out.section = fx.section.position;
  return out;
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
        await completeFacts(doc, f);
      }
    } finally { await applyScene(mine); requestRender(); }
  };
}
export async function figurePdfBytes(fig = _fig, dpi = 300, opts = {}) {
  // a figure can opt out of carrying itself: its scenes name the files, the layers, the coordinates —
  // a deliverable for a client may want only the page (doc.embedSource === false; templates carry it)
  return exportPDF(fig.doc, { env: envFor({ prepare: prepareFor(dpi) }), title: fig.name, creator: 'micro', dpi, ...(fig.doc.embedSource === false ? { source: false } : {}), ...opts });
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
  if (!fig) throw new Error(`composer: no figure “${P.figure}” (${S.figures.length ? 'figures: ' + S.figures.map((f) => f.name).join(', ') : 'make one in File → Composer…'})`);
  const dpi = Math.max(72, Math.min(600, +P.dpi || 300));
  const vars = P.vars || {};
  // the page: a copy of the figure (images carried by reference — they're re-rendered or reused)
  const doc = JSON.parse(serializeDocument(fig.doc));
  for (const f of doc.frames) { const o = frameById(fig.doc, f.id); if (o && o._img) f._img = o._img; }
  doc._vars = vars; doc._source = fig.doc;                  // _source: the figure itself, which the book's PDF carries
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
      const scene = JSON.parse(JSON.stringify(f.source.scene)), key = !!f.source.keyFor;   // a key plan keeps its own scene: the page's overrides are for the views it keys
      if (v.filter != null && !key) for (const sl of scene.layers) {
        const fx = typeof v.filter === 'string' ? v.filter : v.filter[sl.name];
        if (fx != null && sl.visible !== false) sl.filter = String(fx);
      }
      await applyScene(scene);
      if (v.camera && !key) HK.setCameraWorld(v.camera);
      if (!key && v.section === 'off') setSectionWorld(null);
      else if (!key && v.section) setSectionWorld(v.section);
      const r = renderInto(f, dpi / 25.4, f.source.bg);
      storeImageQuiet(f, r.canvas, r.meta);
      f.content.photo = true;
      await completeFacts(doc, f);
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
  else blob = new Blob([await exportPDF(docs, { env: envFor(), title: docs[0].title, creator: 'micro', dpi, source: (docs[0]._source && docs[0]._source.embedSource !== false && docs[0]._source) || false })], { type: 'application/pdf' });
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
      // settings under `with:` — the form routines are written in (the old loose form still reads,
      // but Check all recipes flags it)
      steps: [{ tool: 'compo', with: { figure: fig.name, view: { section: { axis, position: '$level', thickness: +(step * 0.8).toPrecision(3), clip: 'slab' } }, vars: { level: '$level' }, book: `atlas/${slug(fig.name)}.pdf`, dpi: 200 } }],
    }],
  };
  if (!save) return { name, tool: 'routine', params };
  const r = await HK.saveRecipe('routine', params, name);
  if (r) { HK.openRoutineWindow(r); $('#meta').textContent = `composer: “${r.name}” — ${n} ${axis === 'z' ? 'levels' : 'sections'} → atlas/${slug(fig.name)}.pdf; write \${level} in a caption to label each page, then Run`; }
  return r;
}

// an analysis window's plot → an image frame on the current figure (micro:to-composer)
// ── a CHART frame: an analysis window's chart as its spec, laid out by @gcu/plot at the frame's
// own size each time it draws (resize it and the chart re-flows — text stays its size) and
// written into the PDF as vectors. The spec is plain data, saved with the figure. ──
const PX_PER_MM = 96 / 25.4;
registerKind('chart', {
  label: 'chart',
  describe: (f) => `chart · ${(f.source && f.source.name) || (f.content && f.content.spec && f.content.spec.title) || ''}`,
  draw(ctx, box, frame) {
    const spec = frame.content && frame.content.spec; if (!spec) return;
    const W = box[2] * PX_PER_MM, H = box[3] * PX_PER_MM, key = `${W.toFixed(1)}x${H.toFixed(1)}`;
    if (!frame._list || frame._listKey !== key || frame._listSpec !== spec) {
      const { fig } = (spec.type === 'xy' ? xyFigure : chartFigure)(spec, { width: W, height: H, theme: 'paper', fontSize: +frame.content.fontSize || 10 });
      fig.set_facecolor('none');
      frame._list = fig.toDrawList(); frame._listKey = key; frame._listSpec = spec;
    }
    ctx.save(); ctx.translate(box[0], box[1]); ctx.scale(1 / PX_PER_MM, 1 / PX_PER_MM);
    replayDrawList(ctx, frame._list);
    ctx.restore();
  },
});
// a draw list (a graphic recorded from any 2D-context drawer — the stereonet) → a vector frame
export function addDrawlistFrame(list, name, stereonet = null) {
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const w = 80, h = +(w * list.height / Math.max(1, list.width)).toFixed(1);
  const f = ed.addFrame({ kind: 'drawlist', box: [m[3] + 8, m[0] + 8, w, h], content: { list }, source: { app: 'micro', kind: 'graphic', name, ...(stereonet ? { stereonet } : {}) } });
  if (stereonet) stampFacts(f, [stereonet.layer]).then(() => { if (_ed) _ed.render(); });
  $('#meta').textContent = `composer: ${name} went into “${_fig.name}” (vector)`;
  return f;
}
export function addChartFrame(spec, name, recipe = null) {
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const f = ed.addFrame({ kind: 'chart', box: [m[3] + 8, m[0] + 8, 120, 72], content: { spec }, source: { app: 'micro', kind: 'plot', name, ...(recipe ? { recipe } : {}) } });
  if (recipe) stampFacts(f, recipeLayers(recipe)).then(() => { if (_ed) _ed.render(); });
  $('#meta').textContent = `composer: ${name} went into “${_fig.name}” as a chart (vector; it re-flows when resized)`;
  return f;
}
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
export function addTableFrame(tsv, name, near = null, recipe = null) {
  const c = tableFromTsv(tsv, ''); if (!c) return null;
  const ed = openComposer();
  const doc = ed.getDoc(), m = doc.page.margins || [12, 12, 12, 12];
  const rows = Math.min(c.rows.length, 30), w = Math.min(120, 14 + 16 * c.columns.length), h = +(5 + 4.2 * (rows + 1.5)).toFixed(1);
  const box = near ? [near.box[0] + near.box[2] + 6, near.box[1], w, h] : [m[3] + 8, m[0] + 8, w, h];
  const f = ed.addFrame({ kind: 'table', box, content: c, source: { app: 'micro', kind: 'table', name, ...(recipe ? { recipe } : {}) } });
  if (recipe) stampFacts(f, recipeLayers(recipe)).then(() => { if (_ed) _ed.render(); });
  $('#meta').textContent = `composer: the ${name} table (${c.rows.length} rows) went into “${_fig.name}”`;
  return f;
}
addEventListener('micro:to-composer', (e) => {
  const d = e.detail || {};
  const p = d.drawlist ? addDrawlistFrame(d.drawlist, d.name || 'graphic', d.stereonet || null) : d.spec ? addChartFrame(d.spec, d.name || 'chart', d.recipe) : d.canvas ? addCanvasFrame(d.canvas, d.name || 'plot') : null;
  if (d.tsv) addTableFrame(d.tsv, d.name || 'table', p, d.recipe);
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
  S.house = { props: {} };
  try { const fh = await resolveFileHandle(dir, HOUSE_FILE); const j = JSON.parse(await (await fh.getFile()).text()); if (j && j.props && typeof j.props === 'object') S.house = { props: j.props }; } catch { /* no house style yet */ }
  if (composerOpen()) { _fig = null; showFigure(S.figures[0] || newFigure('figure 1')); }
}
export async function flushFigures(dir) {
  clearTimeout(_saveT);                                    // the save writes the current state: no stale edit-save after it
  const failed = [];
  for (const fig of S.figures) {
    if (!fig.file) fig.file = 'figures/' + slug(fig.name) + '.compo.json';
    await queued(() => writeFigure(dir, fig).catch((e) => { failed.push(`${fig.file} (${e.message})`); }));
  }
  if (S.house && Object.keys(S.house.props || {}).length) await persistHouse();
  if (failed.length) console.warn('micro: figures not saved —', failed.join('; '));
  return failed;
}
export { frameById };
