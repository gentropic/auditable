// wuffle desk — one diagram's net: @gcu/stereonet's core draws it (wuffle's layers → its scene → a bearing
// net). Click picks the nearest point (⇧ adds, Ctrl/⌘ toggles, empty space clears); hovering reports the
// attitude under the cursor. Redraws when the project changes anything it shows, or the theme changes.

import * as bearing from '../../../ext/bearing/index.js';
import { stereonetCore, nearestPick, formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { orientations } from './io.js';
import { tok, netTheme } from './desk-theme.js';

const core = stereonetCore(bearing);
const REDRAW = new Set(['layer-added', 'layer-removed', 'layer-changed', 'layer-moved', 'layers-removed', 'history']);

export class NetView {
  constructor(project, diagramId, { onStatus } = {}) {
    this.p = project; this.id = diagramId; this.onStatus = onStatus || (() => {});
    this.el = document.createElement('div'); this.el.className = 'wn-host'; this.el.tabIndex = 0;
    this.stage = document.createElement('div'); this.stage.className = 'wn-stage';   // the drawing; tools sit beside it
    // what the net could NOT draw, said on the net (a second contour set, dihedra on a rotated net): skipped
    // silently, it looked like the drawing was all there was
    this.notesEl = document.createElement('div'); this.notesEl.className = 'wn-notes'; this.notesEl.hidden = true;
    this.el.append(this.stage, this.notesEl);
    this.net = null; this.picks = []; this.scene = null;
    this.drawn = new Set();   // hooks run after every draw (a tool's overlay, …): fn(view)
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.stage);                       // the stage: the space under the tool strip
    this._off = project.on((e) => { if (this._concerns(e)) this.draw(); });
    this.stage.addEventListener('click', (e) => this._click(e));
    this.stage.addEventListener('mousemove', (e) => this._hover(e));
    this.el.addEventListener('mouseleave', () => this.onStatus(''));
  }
  destroy() { this._ro.disconnect(); this._off(); }

  _concerns(e) {
    if (e.type === 'diagram-changed' || e.type === 'diagram-removed') return e.id === this.id;
    if (REDRAW.has(e.type)) return true;
    const ds = e.datasetId || e.id;
    return this.p.layersOf(this.id).some((l) => l.datasetId === ds) || (e.type === 'selection-changed' && !e.datasetId);
  }

  draw() {
    const g = this.p.diagram(this.id); if (!g) return;
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;                    // a background tab: drawn when it's shown
    const size = Math.max(160, Math.floor(Math.min(r.width, r.height)) - 8);
    this.scene = core.buildScene({ layers: sceneLayers(this.p, this.id),
      colors: { selected: tok('--w-violet'), ink: tok('--w-text'), inkMid: tok('--w-text-mid'), halo: tok('--w-net-bg') } });
    const out = core.renderScene(this.scene, { size, projection: g.props.projection, hemisphere: g.props.hemisphere,
      graticule: g.props.graticule, rotation: g.props.matrix || null, center: g.props.rotation || null, classPrefix: 'wn', theme: netTheme() });
    this.net = out.net; this.picks = out.picks;
    this.stage.replaceChildren(out.svg);
    const rotated = !!(g.props.matrix || g.props.rotation);
    const notes = this.scene.notes.map((n) => n.replace(/“(l\d+)”/g, (m, id) => `“${this._layerName(id)}”`));
    if (rotated && this.scene.primitives.some((q) => q.type === 'dihedra')) notes.push('right dihedra aren’t drawn on a rotated net (Reset rotation to see them)');
    this.notesEl.replaceChildren(...notes.map((n) => { const d = document.createElement('div'); d.textContent = n; return d; }));
    this.notesEl.hidden = !notes.length;
    for (const fn of this.drawn) fn(this);
  }

  /** a layer's name in a note; two layers of one diagram that share a name are told apart by their place (2nd …) */
  _layerName(id) {
    const L = this.p.layer(id); if (!L) return id;
    const nm = (x) => x.name || this.p.dataset(x.datasetId)?.name || x.id;
    const same = this.p.layersOf(L.diagramId).filter((x) => nm(x) === nm(L));
    return same.length > 1 ? `${nm(L)}, layer ${same.indexOf(L) + 1} of ${same.length}` : nm(L);
  }

  /** a pointer event → svg units on the net (and the scale from css px) */
  svgPoint(e) { return this._svgPoint(e); }
  _svgPoint(e) {
    const svg = this.stage.querySelector('svg'); if (!svg) return null;
    const r = svg.getBoundingClientRect(), s = this.net.size / r.width;
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s, scale: s };
  }
  _hit(pt) {
    const k = nearestPick(this.picks, pt.x, pt.y, 8 * pt.scale); if (!k) return null;
    const L = this.p.layer(k.ref.layer); return L ? { datasetId: L.datasetId, row: k.ref.row } : null;
  }
  _click(e) {
    if (!this.net) return;
    this.p.setActive(this.id);
    const pt = this._svgPoint(e); if (!pt) return;
    const hit = this._hit(pt);
    if (!hit) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.p.clearSelection(); return; }
    this.p.select(hit.datasetId, [hit.row], e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace');
  }
  _hover(e) {
    if (!this.net) return;
    const pt = this._svgPoint(e); if (!pt) return;
    const d = this.net.unproject(pt.x, pt.y);
    if (!d) { this.onStatus(''); return; }
    let s = `cursor · pole of ${formatPlane(bearing.conversions.dcosToPlane(d))} · line ${formatLine(bearing.conversions.dcosToLine(d))}`;
    const hit = this._hit(pt);
    if (hit) { const ds = this.p.dataset(hit.datasetId), o = orientations(ds)[hit.row]; s += ` · ${ds.name} #${hit.row + 1} ${o.plane ? formatPlane(o.plane) : formatLine(o.line)}`; }
    this.onStatus(s);
  }
}
