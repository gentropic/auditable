// wuffle — a FIGURE from a diagram: a @gcu/compo page holding the net (a 'stereonet' frame that carries its
// scene as data, so it prints as vectors), a legend of its layers, their statistics as a table, a title and
// a caption that says what the reader is looking at. Pure: the same call builds the page for the desk, a
// test or a routine. refreshFigure() makes the frames again from the diagram as it is now, keeping the
// frames' boxes (the page layout the user arranged) and anything they added.

import * as bearing from '../../../ext/bearing/index.js';
import { createDocument } from '../../../ext/compo/index.js';
import { stereonetCore, formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { layerStats } from './stats.js';

const core = stereonetCore(bearing);
const INK = { selected: '#232322', ink: '#232322', inkMid: '#504F4C', halo: '#FFFFFF' };

/** the frames' content for a diagram, by frame id */
function contents(p, diagramId) {
  const g = p.diagram(diagramId);
  const layers = sceneLayers(p, diagramId).filter((L) => L.visible !== false).map((L) => ({ ...L, selected: [] }));   // a figure shows the data, not a selection
  const scene = core.buildScene({ layers, colors: INK });
  const named = (L) => p.layer(L.id)?.name || p.dataset(L.datasetId).name;
  const rows = layers.map((L) => {
    const ds = p.dataset(L.datasetId), s = layerStats(ds), isPlane = ds.kind !== 'lines';
    return [named(L), String(s.n), s.mean ? (isPlane ? formatPlane(s.mean.plane) : formatLine(s.mean.line)) : '—',
      s.mean ? s.mean.kappa.toFixed(1) : '—', s.mean ? s.mean.alpha.toFixed(1) : '—', s.eigen ? s.eigen.K.toFixed(2) : '—'];
  });
  const contoured = layers.find((L) => L.elements?.contours?.on);
  const proj = g.props.projection === 'equal-angle' ? 'Equal-angle (Wulff)' : 'Equal-area (Schmidt)';
  const contourTxt = contoured ? (contoured.elements.contours.method === 'fisher' ? ' · Fisher-kernel density contours (MUD)' : ` · Kamb contours at 2σ intervals (k = ${contoured.elements.contours.sigma ?? 3})`) : '';
  const lineage = [...new Set(layers.map((L) => p.dataset(L.datasetId)).filter((d) => d.lineage).map((d) => `${d.name}: ${d.lineage.op} of ${d.lineage.sources.map((s) => s.name).join(', ')}`))];
  return {
    title: { md: `**${g.name}**`, size: 13 },
    net: { scene, net: { projection: g.props.projection, hemisphere: g.props.hemisphere, center: g.props.rotation || null, graticule: g.props.graticule || 10 }, title: g.name },
    legend: { title: 'layers', size: 8, entries: layers.map((L) => ({ color: L.color || '#232322', label: `${named(L)} (${L.data.length})` })) },
    stats: { title: 'statistics (axial Fisher mean)', columns: ['layer', 'n', 'mean', 'κ', 'α95 °', 'K'], rows, size: 7.5 },
    caption: { md: `${proj}, ${g.props.hemisphere} hemisphere${g.props.rotation ? `, centred on ${formatLine(g.props.rotation)}` : ''}${contourTxt}. `
      + `Planes as dip direction/dip, lines as trend→plunge.${lineage.length ? ` Derived: ${lineage.join('; ')}.` : ''} Made with wuffle, {date:DD/MM/YYYY}.`, size: 8 },
  };
}

const BOXES = { title: [12, 12, 273, 10], net: [12, 26, 172, 172], legend: [192, 28, 93, 46], stats: [192, 78, 93, 60], caption: [192, 142, 93, 56] };
const KIND = { title: 'text', net: 'stereonet', legend: 'legend', stats: 'table', caption: 'text' };

/** a new compo document for a diagram */
export function buildFigure(p, diagramId) {
  const g = p.diagram(diagramId); if (!g) throw new Error(`no diagram ${diagramId}`);
  if (g.kind !== 'net') throw new Error(`${g.name} is a ${g.kind} — figures are made from nets for now`);
  const doc = createDocument({ title: g.name });
  const c = contents(p, diagramId);
  for (const k of Object.keys(BOXES)) doc.frames.push({ id: `wuffle-${k}`, kind: KIND[k], box: BOXES[k].slice(), content: c[k], source: { wuffle: k, diagram: diagramId } });
  return doc;
}

/** the frames made again from the diagram as it is now; boxes, styles and the user's own frames kept */
export function refreshFigure(p, doc, diagramId) {
  const c = contents(p, diagramId), next = JSON.parse(JSON.stringify(doc));
  for (const f of next.frames) { const k = f.source && f.source.wuffle; if (k && c[k] && f.source.diagram === diagramId) f.content = c[k]; }
  return next;
}
