// wuffle — a FIGURE from a diagram: a @gcu/compo page holding the diagram — a net ('stereonet' frame: its scene
// as data, so it prints as vectors), a rose or a fabric plot (figure-kinds.js, likewise from data) — a legend of
// its layers, their statistics as a table, a title and a caption that says what the reader is looking at. Pure:
// the same call builds the page for the desk, a test or a routine.
//   buildFigure(p, diagramId)        a new page for one diagram
//   diagramFrames(p, doc, diagramId) another diagram's frames for an existing page (in free space)
//   refreshFigure(p, doc)            every frame wuffle made, again from ITS diagram as it is now — boxes, styles,
//                                    the user's own frames and edits kept, and each frame's own settings (a net
//                                    frame's projection / hemisphere / graticule / selection: source.view)
//   staleOf(p, frame)                why a frame no longer shows its diagram (or null)

import * as bearing from '../../../ext/bearing/index.js';
import { createDocument, refreshLegend, freeSpot } from '../../../ext/compo/index.js';
import { stereonetCore, formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { layerStats } from './stats.js';
import { roseData } from './diagram-svg.js';

const core = stereonetCore(bearing);
const INK = { selected: '#793A8D', ink: '#232322', inkMid: '#504F4C', halo: '#FFFFFF' };
const DIAGRAM_KIND = { net: 'stereonet', rose: 'rose', fabric: 'fabric' };
const QUANTITY = { strike: 'strike', dipDirection: 'dip direction', trend: 'trend' };

/** a frame's view settings over the diagram's own (source.view: what the inspector changed for this frame alone) */
const viewOf = (g, view = {}) => ({ projection: view.projection || g.props.projection, hemisphere: view.hemisphere || g.props.hemisphere,
  graticule: view.graticule ?? g.props.graticule ?? 10, selection: !!view.selection });   // (0 = no graticule)

/** circular mean of azimuths (axial: of doubled angles) → { mean, Rbar } */
function circularMean(az, axial) {
  let s = 0, c = 0; const k = axial ? 2 : 1;
  for (const a of az) { const t = (a * k * Math.PI) / 180; s += Math.sin(t); c += Math.cos(t); }
  const n = az.length || 1, Rbar = Math.hypot(s, c) / n;
  let m = (Math.atan2(s, c) * 180) / Math.PI / k; m = ((m % (360 / k)) + 360 / k) % (360 / k);
  return { mean: m, Rbar };
}

/** the frames' content for a diagram, by frame role */
function contents(p, diagramId, view = {}) {
  const g = p.diagram(diagramId);
  const v = viewOf(g, view);
  const vis = sceneLayers(p, diagramId).filter((L) => L.visible !== false);
  const named = (L) => p.layer(L.id)?.name || p.dataset(L.datasetId).name;
  const legendEntries = vis.map((L) => ({ key: L.id, color: L.color || '#232322', label: `${named(L)} (${L.data.length})` }));   // key: an edit follows its layer
  const head = { title: { md: `**${g.name}**`, size: 13 } };
  const made = ' Made with wuffle, {date:DD/MM/YYYY}.';

  if (g.kind === 'rose') {
    const q = g.props.quantity || 'strike', axial = q === 'strike' ? true : !!g.props.axial;
    const wc = g.props.weight || null;
    const per = vis.map((L) => ({ L, ...roseData(p.dataset(L.datasetId), q, wc) }));
    const az = per.flatMap((x) => x.az), weights = wc ? per.flatMap((x) => x.w || x.az.map(() => 0)) : null;
    const rows = per.map(({ L, az: a }) => { const m = a.length ? circularMean(a, axial) : null; return [named(L), String(a.length), m ? `${String(Math.round(m.mean)).padStart(3, '0')}°` : '—', m ? m.Rbar.toFixed(2) : '—']; });
    return { ...head,
      diagram: { azimuths: az, ...(weights ? { weights, weight: wc } : {}), binWidth: g.props.bins || 10, axial, scale: g.props.scale === 'linear' ? 'linear' : 'sqrt', color: (vis[0] && vis[0].color) || '#C2562B', quantity: q },
      legend: { title: 'layers', size: 8, entries: legendEntries },
      stats: { title: `${QUANTITY[q] || q} — circular statistics`, columns: ['layer', 'n', 'mean', 'R̄'], rows, size: 7.5, note: axial ? 'axial: the mean of doubled angles' : '' },
      caption: { md: `Rose diagram of ${QUANTITY[q] || q}${axial ? ' (both ends counted)' : ''}${wc ? `, sectors weighted by ${wc}` : ''}, ${g.props.bins || 10}° sectors, ${g.props.scale === 'linear' ? 'linear' : 'area-true (√)'} scale; the rings are quarters of the largest sector.${made}`, size: 8 },
    };
  }
  if (g.kind === 'fabric') {
    const pts = [], rows = [];
    for (const L of vis) {
      const s = layerStats(p.dataset(L.datasetId)); if (!s.eigen) continue;
      pts.push({ s: s.eigen.values, color: L.color, label: named(L) });
      rows.push([named(L), String(s.n), ...s.eigen.values.map((x) => x.toFixed(3)), s.eigen.K.toFixed(2), s.eigen.C.toFixed(2), s.eigen.K > 1 ? 'cluster' : 'girdle']);
    }
    const plot = g.props.plot === 'woodcock' ? 'woodcock' : 'vollmer';
    return { ...head,
      diagram: { plot, points: pts },
      legend: { title: 'layers', size: 8, entries: legendEntries },
      stats: { title: 'eigenvalues of the orientation tensor', columns: ['layer', 'n', 'S1', 'S2', 'S3', 'K', 'C', 'shape'], rows, size: 7.5 },
      caption: { md: `${plot === 'woodcock' ? 'Woodcock (1977) plot, ln(S1/S2) against ln(S2/S3): K = 1 divides clusters from girdles, C is the strength' : 'Vollmer (1990) triangle: point, girdle and random fractions of the orientation tensor'}; normalised eigenvalues S1 ≥ S2 ≥ S3.${made}`, size: 8 },
    };
  }

  // ── a net ──
  const layers = vis.map((L) => (v.selection ? L : { ...L, selected: [] }));   // a figure shows the data, not a selection — unless asked
  const scene = core.buildScene({ layers, colors: INK });
  let girdles = 0;
  const rows = layers.map((L) => {
    const ds = p.dataset(L.datasetId), s = layerStats(ds), isPlane = ds.kind !== 'lines';
    const girdle = s.eigen && s.eigen.K < 1; if (girdle) girdles++;
    return [named(L), String(s.n), s.mean ? `${isPlane ? formatPlane(s.mean.plane) : formatLine(s.mean.line)}${girdle ? ' *' : ''}` : '—',
      s.mean ? s.mean.kappa.toFixed(1) : '—', s.mean ? s.mean.alpha.toFixed(1) : '—', s.eigen ? s.eigen.K.toFixed(2) : '—',
      s.eigen ? formatLine(s.eigen.vectors[2].line) : '—'];
  });
  const contoured = layers.filter((L) => L.elements?.contours?.on);
  // the contour key: a line in the layer's colour, saying what a contour is
  const contourEntries = contoured.map((L) => ({ key: `contours:${L.id}`, color: L.color || '#232322', swatch: 'line',
    label: L.elements.contours.method === 'fisher' ? `${named(L)} · density (MUD)` : `${named(L)} · Kamb, ${2}σ steps (k = ${L.elements.contours.sigma ?? 3})` }));
  const proj = v.projection === 'equal-angle' ? 'Equal-angle (Wulff)' : 'Equal-area (Schmidt)';
  const c0 = contoured[0];
  const contourTxt = c0 ? (c0.elements.contours.method === 'fisher' ? ' · Fisher-kernel density contours (MUD)' : ` · Kamb contours at 2σ intervals (k = ${c0.elements.contours.sigma ?? 3})`) : '';
  const lineage = [...new Set(layers.map((L) => p.dataset(L.datasetId)).filter((d) => d.lineage).map((d) => `${d.name}: ${d.lineage.op} of ${d.lineage.sources.map((s) => s.name).join(', ')}`))];
  return { ...head,
    diagram: { scene, net: { projection: v.projection, hemisphere: v.hemisphere, rotation: g.props.matrix || null, center: g.props.rotation || null, graticule: v.graticule }, title: g.name },
    legend: { title: 'layers', size: 8, entries: [...legendEntries, ...contourEntries] },
    stats: { title: 'statistics (axial Fisher mean)', columns: ['layer', 'n', 'mean', 'κ', 'α95 °', 'K', 'V3'], rows, size: 7.5,
      // a girdle (K < 1) has no centre: its mean says little, its V3 — the girdle's pole, β on folded beds — says a lot
      ...(girdles ? { note: '* K < 1, a girdle: read V3 (its pole; β on folded beds), not the mean' } : {}) },
    caption: { md: `${proj}, ${v.hemisphere} hemisphere${g.props.rotation ? `, centered on ${formatLine(g.props.rotation)}` : g.props.matrix ? ', rotated' : ''}${contourTxt}. `
      + `Planes as dip direction/dip, lines as trend→plunge.${v.selection ? ' The selected measurements are in violet.' : ''}${lineage.length ? ` Derived: ${lineage.join('; ')}.` : ''}${made}`, size: 8 },
  };
}

const BOXES = { title: [12, 12, 273, 10], diagram: [12, 26, 172, 172], legend: [192, 28, 93, 46], stats: [192, 78, 93, 60], caption: [192, 142, 93, 56] };
const KIND = (g) => ({ title: 'text', diagram: DIAGRAM_KIND[g.kind] || 'stereonet', legend: 'legend', stats: 'table', caption: 'text' });
const ROLE = (k) => (k === 'diagram' ? 'net' : k);       // the frame's source.wuffle (a saved figure says 'net')

/** a new compo document for a diagram */
export function buildFigure(p, diagramId) {
  const g = p.diagram(diagramId); if (!g) throw new Error(`no diagram ${diagramId}`);
  const doc = createDocument({ title: g.name });
  const c = contents(p, diagramId), K = KIND(g);
  for (const k of Object.keys(BOXES)) doc.frames.push({ id: `wuffle-${ROLE(k)}`, kind: K[k], box: BOXES[k].slice(), content: c[k], source: { wuffle: ROLE(k), diagram: diagramId, ...(K[k] === 'text' ? { made: c[k].md } : {}) } });
  return doc;
}

/** another diagram on a page: its diagram, legend and statistics frames, beside what's there (free space) →
 *  frames to add (they aren't added: the editor adds them, so the addition is one undoable step) */
export function diagramFrames(p, doc, diagramId) {
  const g = p.diagram(diagramId); if (!g) throw new Error(`no diagram ${diagramId}`);
  const c = contents(p, diagramId), K = KIND(g), out = [], probe = { ...doc, frames: [...doc.frames] };
  const taken = new Set(doc.frames.map((f) => f.id));
  const idFor = (role) => { let id = `wuffle-${role}-${diagramId}`, k = 2; while (taken.has(id)) id = `wuffle-${role}-${diagramId}-${k++}`; taken.add(id); return id; };
  const sizes = { diagram: [110, 110], legend: [70, 30], stats: [93, 34] };
  let near = null, crowded = false;
  for (const k of ['diagram', 'legend', 'stats']) {
    const box = freeSpot(probe, sizes[k][0], sizes[k][1], { near, shrink: k === 'diagram' });
    if (box._fallback) crowded = true;                     // no room left on the page: it lands on top (said by the caller)
    const f = { id: idFor(ROLE(k)), kind: K[k], box: [...box], content: c[k], source: { wuffle: ROLE(k), diagram: diagramId } };
    out.push(f); probe.frames.push(f); if (k === 'diagram') near = f;
  }
  out.crowded = crowded;
  return out;
}

/** the frames made again from their diagrams as they are now; boxes, styles and the user's own frames kept — and
 *  their own edits: a legend keeps its labels, colours, order and look (compo's refreshLegend); a title or
 *  caption you have rewritten stays yours (only text still reading what wuffle wrote is made again).
 *  diagramId: only that diagram's frames (else every diagram's) */
export function refreshFigure(p, doc, diagramId = null) {
  const next = JSON.parse(JSON.stringify(doc)), cache = new Map();
  const cOf = (f) => {
    const id = f.source.diagram, key = `${id}|${JSON.stringify(f.source.view || {})}`;
    if (!cache.has(key)) cache.set(key, p.diagram(id) ? contents(p, id, f.source.view || {}) : null);
    return cache.get(key);
  };
  for (const f of next.frames) {
    const role = f.source && f.source.wuffle; if (!role) continue;
    if (diagramId && f.source.diagram !== diagramId) continue;
    const c = cOf(f); if (!c) continue;
    const k = role === 'net' ? 'diagram' : role; if (!c[k]) continue;
    if (f.kind === 'legend') f.content = refreshLegend(f.content, c[k]);
    else if (f.kind === 'text') {
      const mine = f.source.made != null && f.content && f.content.md !== f.source.made;
      if (!mine) { f.content = { ...c[k], ...f.content, md: c[k].md }; f.source.made = c[k].md; }   // the words again; its size, typeface, colour stay
    } else if (f.kind === 'table') f.content = { ...c[k], ...pick(f.content, ['size', 'decimals', 'align', 'zebra']) };   // its look stays yours
    else f.content = { ...c[k], ...(f.content && f.content.theme ? { theme: f.content.theme } : {}) };
  }
  return next;
}
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };

/** a wuffle frame whose diagram has changed since it was made → why; else null. Diagram and statistics frames only
 *  (a legend or a caption may be yours) — compared as data, so a change that doesn't show doesn't flag */
export function staleOf(p, frame, cache = new Map()) {
  const s = frame.source || {}; if (!s.wuffle || !s.diagram) return null;
  if (!p.diagram(s.diagram)) return { text: 'diagram gone', title: 'the diagram this frame was made from is no longer in the project' };
  if (frame.kind === 'legend' || frame.kind === 'text') return null;
  const key = `${s.diagram}|${JSON.stringify(s.view || {})}`;
  if (!cache.has(key)) cache.set(key, contents(p, s.diagram, s.view || {}));
  const c = cache.get(key), k = s.wuffle === 'net' ? 'diagram' : s.wuffle;
  if (!c[k]) return null;
  const now = frame.kind === 'table' ? JSON.stringify([c[k].columns, c[k].rows]) : JSON.stringify(c[k]);
  const was = frame.kind === 'table' ? JSON.stringify([frame.content.columns, frame.content.rows]) : JSON.stringify({ ...frame.content, theme: undefined });
  return now === was ? null : { text: 'older data', title: `${p.diagram(s.diagram).name} has changed since this was made — ↻ from the diagrams makes it again` };
}
