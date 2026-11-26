// wuffle desk — the other diagram kinds, beside the net: a ROSE (bearing's roseSVG) and a FABRIC plot
// (Woodcock K–C or Vollmer P–G–R, bearing's fabricplot). Same contract as NetView (el, draw, destroy, a
// project listener), so the layout treats every diagram alike.
//   rose:   the visible layers' azimuths together — planes by STRIKE (axial) or DIP DIRECTION, lines by
//           TREND — in sectors of `bins`°, area-true (sqrt) or linear
//   fabric: one point per visible layer, in its colour
// Fabric plots draw their ink in fixed dark strokes, so they sit on a paper card in either theme.

import { rose, fabricplot } from '../../../ext/bearing/index.js';
import { orientations } from './io.js';
import { tok } from './desk-theme.js';

export const ROSE_QUANTITIES = [['strike', 'strike (planes)'], ['dipDirection', 'dip direction (planes)'], ['trend', 'trend (lines)']];
const REDRAW = new Set(['layer-added', 'layer-removed', 'layer-changed', 'layer-moved', 'layers-removed', 'rows-changed', 'project-loaded']);

/** a dataset's azimuths for a rose */
export function roseAzimuths(ds, quantity) {
  const out = [];
  for (const o of orientations(ds)) {
    if (!o) continue;
    if (o.plane) { if (quantity === 'trend') continue; out.push(quantity === 'strike' ? (o.plane[0] + 270) % 360 : o.plane[0]); }
    else if (o.line) { if (quantity !== 'trend') continue; out.push(o.line[0]); }
  }
  return out;
}

class DiagramView {
  constructor(project, diagramId) {
    this.p = project; this.id = diagramId; this.drawn = new Set();
    this.el = document.createElement('div'); this.el.className = 'wn-host';
    this.stage = document.createElement('div'); this.stage.className = 'wn-stage'; this.el.append(this.stage);
    this._ro = new ResizeObserver(() => this.draw()); this._ro.observe(this.el);
    this._off = project.on((e) => {
      if ((e.type === 'diagram-changed' && e.id === this.id) || REDRAW.has(e.type)) this.draw();
      else if (e.type === 'dataset-changed' && this.p.layersOf(this.id).some((l) => l.datasetId === e.id)) this.draw();
    });
  }
  destroy() { this._ro.disconnect(); this._off(); }
  size() { const r = this.el.getBoundingClientRect(); return r.width && r.height ? Math.max(200, Math.floor(Math.min(r.width, r.height)) - 16) : 0; }
  show(markup, paper = false) {
    const wrap = document.createElement('div'); wrap.className = paper ? 'wdg-paper' : 'wdg-plain'; wrap.innerHTML = markup;
    this.stage.replaceChildren(wrap);
    for (const fn of this.drawn) fn(this);
  }
  note(text) { const n = document.createElement('p'); n.className = 'wdg-note'; n.textContent = text; this.stage.replaceChildren(n); }
}

export class RoseView extends DiagramView {
  draw() {
    const g = this.p.diagram(this.id), size = this.size(); if (!g || !size) return;
    const q = g.props.quantity || 'strike', layers = this.p.layersOf(this.id).filter((L) => L.visible);
    const az = layers.flatMap((L) => roseAzimuths(this.p.dataset(L.datasetId), q));
    if (!az.length) { this.note(layers.length ? `no ${q === 'trend' ? 'lines' : 'planes'} to bin by ${q} — choose another quantity in the diagram's menu` : 'drag a dataset or a layer here'); return; }
    const axial = q === 'strike' ? true : !!g.props.axial;
    const svg = rose.roseSVG(az, { size, binWidth: g.props.bins || 10, axial, scale: g.props.scale === 'linear' ? 'linear' : 'sqrt', rings: 4,
      fill: layers[0].style.color || tok('--w-orange'), fillOpacity: 0.75, petalStroke: tok('--w-bg-deep'), frameStroke: tok('--w-net-rim'), background: 'none' });
    this.show(svg);
    this.el.dataset.n = String(az.length);
  }
}

export class FabricView extends DiagramView {
  draw() {
    const g = this.p.diagram(this.id), size = this.size(); if (!g || !size) return;
    const sets = this.p.layersOf(this.id).filter((L) => L.visible).map((L) => {
      const ds = this.p.dataset(L.datasetId);
      return { dcos: orientations(ds).filter(Boolean).map((o) => o.pole || o.dcos), color: L.style.color, label: L.name || ds.name };
    }).filter((s) => s.dcos.length >= 3);
    if (!sets.length) { this.note('drag a dataset or a layer here (three measurements or more)'); return; }
    const fn = g.props.plot === 'woodcock' ? fabricplot.woodcockSVG : fabricplot.vollmerSVG;
    this.show(fn(sets, { size: Math.min(size, 520) }), true);
    this.el.dataset.n = String(sets.length);
  }
}
