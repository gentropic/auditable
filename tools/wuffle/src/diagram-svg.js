// wuffle — a diagram as an SVG string, from the model alone (no DOM, no open tab): a net through
// @gcu/stereonet + bearing's own string renderer, a rose through bearing's roseSVG, a fabric plot through
// fabricplot. The desk's views draw with these (in the theme's colours); /project's <kind>.svg and a
// routine get them on paper.

import * as bearing from '../../../ext/bearing/index.js';
import { stereonetCore, PAPER } from '../../../ext/stereonet/index.js';
import { orientations } from './io.js';
import { sceneLayers } from './layers.js';

const { rose, fabricplot } = bearing;
const core = stereonetCore(bearing);
export const INK = { selected: '#793A8D', ink: '#232322', inkMid: '#504F4C', halo: '#FFFFFF' };

/** a dataset's azimuths for a rose: planes by STRIKE (axial) or DIP DIRECTION, lines by TREND */
export function roseAzimuths(ds, quantity) {
  const out = [];
  for (const o of orientations(ds)) {
    if (!o) continue;
    if (o.plane) { if (quantity === 'trend') continue; out.push(quantity === 'strike' ? (o.plane[0] + 270) % 360 : o.plane[0]); }
    else if (o.line) { if (quantity !== 'trend') continue; out.push(o.line[0]); }
  }
  return out;
}

/** → { svg, n } or { note } (nothing to draw, and why) */
export function roseMarkup(p, g, { size = 400, fill = '#C2562B', petalStroke = '#FFFFFF', frameStroke = '#5A5856' } = {}) {
  const q = g.props.quantity || 'strike', layers = p.layersOf(g.id).filter((L) => L.visible);
  const az = layers.flatMap((L) => roseAzimuths(p.dataset(L.datasetId), q));
  if (!az.length) return { note: layers.length ? `no ${q === 'trend' ? 'lines' : 'planes'} to bin by ${q} — choose another quantity in the diagram's menu` : 'drag a dataset or a layer here' };
  const axial = q === 'strike' ? true : !!g.props.axial;
  return { n: az.length, svg: rose.roseSVG(az, { size, binWidth: g.props.bins || 10, axial, scale: g.props.scale === 'linear' ? 'linear' : 'sqrt', rings: 4,
    fill: layers[0].style.color || fill, fillOpacity: 0.75, petalStroke, frameStroke, background: 'none' }) };
}

/** → { svg, n } or { note } */
export function fabricMarkup(p, g, { size = 400 } = {}) {
  const sets = p.layersOf(g.id).filter((L) => L.visible).map((L) => {
    const ds = p.dataset(L.datasetId);
    return { dcos: orientations(ds).filter(Boolean).map((o) => o.pole || o.dcos), color: L.style.color, label: L.name || ds.name };
  }).filter((s) => s.dcos.length >= 3);
  if (!sets.length) return { note: 'drag a dataset or a layer here (three measurements or more)' };
  const fn = g.props.plot === 'woodcock' ? fabricplot.woodcockSVG : fabricplot.vollmerSVG;
  return { n: sets.length, svg: fn(sets, { size: Math.min(size, 520) }) };
}

/** a net on paper, as drawn now (selection included — it's the diagram, not a figure) */
export function netMarkup(p, g, { size = 400 } = {}) {
  const scene = core.buildScene({ layers: sceneLayers(p, g.id), colors: INK });
  const { net } = core.renderScene(scene, { size, projection: g.props.projection, hemisphere: g.props.hemisphere, graticule: g.props.graticule,
    rotation: g.props.matrix || null, center: g.props.rotation || null, theme: PAPER });
  return { svg: net.svg() };
}

/** any diagram → its SVG string, or null when there is nothing to draw */
export function diagramSvg(p, diagramId, opts) {
  const g = p.diagram(diagramId); if (!g) return null;
  const out = g.kind === 'rose' ? roseMarkup(p, g, opts) : g.kind === 'fabric' ? fabricMarkup(p, g, opts) : netMarkup(p, g, opts);
  return out.svg || null;
}
