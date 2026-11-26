// wuffle desk — the other diagram kinds, beside the net: a ROSE (bearing's roseSVG) and a FABRIC plot
// (Woodcock K–C or Vollmer P–G–R, bearing's fabricplot). Same contract as NetView (el, draw, destroy, a
// project listener), so the layout treats every diagram alike.
//   rose:   the visible layers' azimuths together — planes by STRIKE (axial) or DIP DIRECTION, lines by
//           TREND — in sectors of `bins`°, area-true (sqrt) or linear
//   fabric: one point per visible layer, in its colour
// Fabric plots draw their ink in fixed dark strokes, so they sit on a paper card in either theme.

import { roseMarkup, fabricMarkup } from './diagram-svg.js';
import { tok } from './desk-theme.js';

export const ROSE_QUANTITIES = [['strike', 'strike (planes)'], ['dipDirection', 'dip direction (planes)'], ['trend', 'trend (lines)']];
const REDRAW = new Set(['layer-added', 'layer-removed', 'layer-changed', 'layer-moved', 'layers-removed', 'rows-changed', 'project-loaded', 'history']);

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
    const r = roseMarkup(this.p, g, { size, fill: tok('--w-orange'), petalStroke: tok('--w-bg-deep'), frameStroke: tok('--w-net-rim') });
    if (r.note) { this.note(r.note); return; }
    this.show(r.svg);
    this.el.dataset.n = String(r.n);
  }
}

export class FabricView extends DiagramView {
  draw() {
    const g = this.p.diagram(this.id), size = this.size(); if (!g || !size) return;
    const r = fabricMarkup(this.p, g, { size });
    if (r.note) { this.note(r.note); return; }
    this.show(r.svg, true);
    this.el.dataset.n = String(r.n);
  }
}
