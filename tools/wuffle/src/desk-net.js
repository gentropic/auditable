// wuffle desk — one diagram's net: its layers drawn with @gcu/bearing's Stereonet, in tree order (last on
// top). Click picks the nearest point (⇧ adds, Ctrl/⌘ toggles, empty space clears); hovering reports the
// attitude under the cursor. Redraws itself when the project changes anything it shows.

import { Stereonet, statistics, conversions } from '../../../ext/bearing/index.js';
import { orientations } from './io.js';

const tok = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
const pad3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
export const fmtPlane = ([dd, dip]) => `${pad3(dd)}/${String(Math.round(dip)).padStart(2, '0')}`;
export const fmtLine = ([tr, pl]) => `${String(Math.round(pl)).padStart(2, '0')}→${pad3(tr)}`;

export class NetView {
  constructor(project, diagramId, { onStatus } = {}) {
    this.p = project; this.id = diagramId; this.onStatus = onStatus || (() => {});
    this.el = document.createElement('div'); this.el.className = 'wn-host';
    this.el.tabIndex = 0;
    this.sn = null; this.picks = [];   // [{ x, y, datasetId, row }] in svg px, for picking
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.el);
    this._off = project.on((e) => { if (this._concerns(e)) this.draw(); });
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('mousemove', (e) => this._hover(e));
    this.el.addEventListener('mouseleave', () => this.onStatus(''));
  }
  destroy() { this._ro.disconnect(); this._off(); }

  _concerns(e) {
    if (['diagram-changed', 'diagram-removed'].includes(e.type)) return e.id === this.id;
    if (e.type === 'theme') return true;
    const mine = this.p.layersOf(this.id);
    if (['layer-added', 'layer-removed', 'layer-changed', 'layer-moved', 'layers-removed'].includes(e.type)) return true;
    const ds = e.datasetId || e.id;
    return mine.some((l) => l.datasetId === ds);
  }

  _colorOf(layer, i) {
    if (layer.style.color) return layer.style.color;
    const pal = ['--w-set1', '--w-set2', '--w-set3', '--w-set4', '--w-set5', '--w-set6'];
    return tok(pal[i % pal.length]);
  }

  draw() {
    const g = this.p.diagram(this.id); if (!g) return;
    const r = this.el.getBoundingClientRect(), size = Math.max(160, Math.floor(Math.min(r.width, r.height)) - 8);
    if (!r.width || !r.height) return;
    const sn = new Stereonet({
      size, padding: 26, projection: g.props.projection, hemisphere: g.props.hemisphere, gridSpacing: g.props.graticule || 10,
      center: g.props.rotation ? g.props.rotation : undefined, classPrefix: 'wn',
      style: {
        background: tok('--w-net-bg'),
        primitive: { stroke: tok('--w-net-rim'), strokeWidth: 1.4, fill: 'none' },
        grid: { stroke: tok('--w-net-grid'), strokeWidth: 0.5, majorStroke: tok('--w-net-grid'), majorStrokeWidth: 0.7 },
        cardinals: { fill: tok('--w-text-mid'), fontSize: 12, fontFamily: tok('--w-mono') || 'monospace', offset: 14 },
      },
    });
    const sel = tok('--w-violet');
    this.picks = [];
    let contoured = false;
    this.p.layersOf(this.id).forEach((L, i) => {
      if (!L.visible) return;
      const ds = this.p.dataset(L.datasetId); if (!ds) return;
      const col = this._colorOf(L, i), E = L.elements, size0 = L.style.size || 4;
      const o = orientations(ds), chosen = new Set(this.p.selected(ds.id));
      const poles = o.map((x, k) => (x && (x.pole || x.dcos) ? { d: x.pole || x.dcos, k, x } : null)).filter(Boolean);
      if (E.contours?.on && !contoured && poles.length > 2) {
        contoured = true;   // bearing draws one contour set per net: the topmost layer that asks
        // Kamb: sigma sets the counting area (E = kσ); contours in σ at 2σ intervals. Fisher: MUD levels.
        sn.contour(poles.map((q) => q.d), { method: E.contours.method, kambSigma: E.contours.sigma, stroke: col, strokeWidth: 0.9,
          levels: E.contours.levels || (E.contours.method === 'kamb' ? [2, 4, 6, 8, 10, 12] : [2, 4, 6, 8]) });
      }
      if (E.greatCircles?.on) for (const q of poles) if (q.x.plane) sn.plane(q.x.plane[0], q.x.plane[1], { stroke: col, strokeWidth: chosen.has(q.k) ? 1.6 : 0.7, ...(chosen.has(q.k) ? { stroke: sel } : {}) });
      if (ds.kind === 'smallcircles' && E.circles?.on) for (const q of poles) sn.cone(q.x.line[0], q.x.line[1], q.x.angle, { stroke: col });
      const pts = (ds.kind === 'lines' || ds.kind === 'smallcircles') ? (E.points?.on || E.axes?.on) : (E.poles?.on || (ds.kind === 'faults' && E.slip?.on));
      if (pts) for (const q of poles) {
        const on = chosen.has(q.k), st = { fill: on ? sel : col, r: on ? size0 / 2 + 2 : size0 / 2 + 0.5, stroke: on ? tok('--w-net-bg') : 'none', strokeWidth: 1 };
        if (q.x.plane) sn.pole(q.x.plane[0], q.x.plane[1], st); else sn.line(q.x.line[0], q.x.line[1], st);
      }
      const dcos = poles.map((q) => q.d);
      if (E.mean?.on && dcos.length >= 2) {
        const f = statistics.fisherStats(dcos, { axial: E.mean.axial !== false });
        const [tr, pl] = conversions.dcosToLine(f.mean);
        const cone = statistics.confidenceCone(dcos, E.mean.confidence || 0.95, { axial: E.mean.axial !== false });
        sn.line(tr, pl, { fill: 'none', stroke: tok('--w-text'), strokeWidth: 1.6, r: 5 });
        if (cone.halfAngle > 0) sn.cone(tr, pl, cone.halfAngle, { stroke: col, strokeWidth: 1.2, strokeDasharray: 'none' });
      }
      if (dcos.length >= 3 && ['v1Pole', 'v1Circle', 'v2Pole', 'v2Circle', 'v3Pole', 'v3Circle'].some((n) => E[n]?.on)) {
        const pa = statistics.principalAxes(dcos);
        pa.eigenvectors.forEach((v, j) => {
          const n = j + 1, [tr, pl] = conversions.dcosToLine(v);
          if (E[`v${n}Pole`]?.on) sn.line(tr, pl, { fill: tok('--w-text'), r: 3.5, stroke: 'none' });
          if (E[`v${n}Circle`]?.on) { const [dd, dip] = conversions.dcosToPlane(v); sn.plane(dd, dip, { stroke: tok('--w-text-mid'), strokeWidth: 1, strokeDasharray: '5,3' }); }
        });
      }
      for (const q of poles) { const pp = sn.project(q.d); this.picks.push({ x: pp.x, y: pp.y, datasetId: ds.id, row: q.k }); }
    });
    const svg = sn.element(); sn.render();
    this.el.replaceChildren(svg);
    this.sn = sn;
  }

  _svgPoint(e) {
    const svg = this.el.querySelector('svg'); if (!svg) return null;
    const r = svg.getBoundingClientRect(), s = this.sn.size / r.width;
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s, scale: s };
  }
  _nearest(pt) {
    let best = null, bd = 8 * pt.scale;
    for (const k of this.picks) { const d = Math.hypot(k.x - pt.x, k.y - pt.y); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  _click(e) {
    if (!this.sn) return;
    this.p.setActive(this.id);
    const pt = this._svgPoint(e); if (!pt) return;
    const hit = this._nearest(pt);
    if (!hit) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.p.clearSelection(); return; }
    this.p.select(hit.datasetId, [hit.row], e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace');
  }
  _hover(e) {
    if (!this.sn) return;
    const pt = this._svgPoint(e); if (!pt) return;
    const d = this.sn.unproject(pt.x, pt.y);
    if (!d) { this.onStatus(''); return; }
    const hit = this._nearest(pt);
    const plane = conversions.dcosToPlane(d), line = conversions.dcosToLine(d);
    let s = `cursor · pole of ${fmtPlane(plane)} · line ${fmtLine(line)}`;
    if (hit) { const ds = this.p.dataset(hit.datasetId), o = orientations(ds)[hit.row]; s += ` · ${ds.name} #${hit.row + 1} ${o.plane ? fmtPlane(o.plane) : fmtLine(o.line)}`; }
    this.onStatus(s);
  }
}
