// wuffle desk — the statistics panel: for each layer on the ACTIVE net, n, the axial Fisher mean with κ and
// α95, the eigen analysis (S1–S3, Woodcock K and C, Vollmer P G R) — and buttons that keep a result as a
// DATASET with lineage (mean, eigenvectors, β diagram, the intersection with another layer). The numbers
// come from stats.js (pure); this module only shows them.

import { alert } from '../../../ext/dialog/index.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { layerStats, deriveMean, deriveEigen, deriveBeta, deriveIntersection } from './stats.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

export class StatsView {
  constructor(project, { onDerived } = {}) {
    this.p = project; this.onDerived = onDerived || (() => {});
    this.el = h('div', 'wst-panel'); this.el.setAttribute('aria-live', 'polite');
    this._t = 0;
    project.on(() => { cancelAnimationFrame(this._t); this._t = requestAnimationFrame(() => this.render()); });
    this.render();
  }
  async _derive(fn) {
    try { const id = this.p.batch('derive', () => { const x = fn(); const g = this.p.activeDiagram; if (g) this.p.addLayer(g, x); return x; }); this.onDerived(id); }
    catch (e) { await alert(e.message); }
  }
  render() {
    const p = this.p, g = p.diagram(p.activeDiagram);
    this.el.replaceChildren();
    if (!g) { this.el.append(h('p', 'wst-empty', 'no net')); return; }
    const layers = p.layersOf(g.id).filter((L) => L.visible);
    this.el.append(h('div', 'wst-title', `${g.name} · ${layers.length} layer${layers.length === 1 ? '' : 's'}`));
    if (!layers.length) { this.el.append(h('p', 'wst-empty', 'nothing drawn on this net')); return; }
    for (const L of layers) {
      const ds = p.dataset(L.datasetId), s = layerStats(ds), isPlane = ds.kind === 'planes' || ds.kind === 'faults';
      const card = h('section', 'wst-card'); card.dataset.layer = L.id;
      const head = h('div', 'wst-head'); const sw = h('span', 'wst-sw'); sw.style.background = L.style.color || 'var(--w-text-mid)';
      head.append(sw, h('b', null, L.name || ds.name), h('span', 'wst-n', `n ${s.n}${s.n !== s.of ? ` of ${s.of}` : ''}`));
      card.append(head);
      const dl = h('dl', 'wst-dl');
      const row = (k, v, title) => { const dt = h('dt', null, k); if (title) dt.title = title; dl.append(dt, h('dd', null, v)); };
      if (s.mean) {
        row('mean', isPlane ? `${formatPlane(s.mean.plane)} · pole ${formatLine(s.mean.line)}` : formatLine(s.mean.line), 'axial Fisher mean (poles and lines are axes)');
        row('κ', f(s.mean.kappa, 1), 'Fisher concentration'); row(`α${Math.round(s.mean.confidence * 100)}`, `${f(s.mean.alpha, 1)}°`, 'cone of confidence about the mean');
      } else row('mean', 'needs ≥ 2');
      if (s.eigen) {
        row('S1 S2 S3', s.eigen.values.map((v) => f(v, 3)).join('  '), 'normalised eigenvalues of the orientation tensor');
        const VT = ['the largest eigenvalue’s axis: a cluster’s center', 'the intermediate axis', 'the smallest eigenvalue’s axis: a girdle’s pole (on folded beds, the fold axis)'];
        s.eigen.vectors.forEach((v, i) => row(`V${i + 1}`, `${formatLine(v.line)}${i === 2 && isPlane ? ` · girdle ${formatPlane(v.plane)}` : ''}`, VT[i]));
        row('K · C', `${f(s.eigen.K)} · ${f(s.eigen.C)}`, 'Woodcock: K > 1 cluster, K < 1 girdle; C strength');
        row('P G R', [s.eigen.P, s.eigen.G, s.eigen.R].map((v) => f(v)).join('  '), 'Vollmer point, girdle, random');
      }
      if (s.stress) {
        row('σ1 σ2 σ3', s.stress.axes.map((a) => formatLine(a)).join('  '), `Michael (1984), ${s.stress.n} faults with a known sense`);
        row('φ', f(s.stress.phi), 'stress ratio (σ2 − σ3)/(σ1 − σ3)');
      } else if (ds.kind === 'faults') row('stress', 'needs ≥ 4 faults with a known sense');
      card.append(dl);
      const acts = h('div', 'wst-acts');
      const btn = (label, title, fn, on = true) => { const b = h('button', null, label); b.type = 'button'; b.title = title; b.disabled = !on; b.onclick = () => this._derive(fn); acts.append(b); };
      btn('mean → dataset', 'keep the mean as a dataset (drawn on this net, with its lineage)', () => deriveMean(p, ds.id), !!s.mean);
      btn('eigenvectors → dataset', 'V1–V3 as a lines dataset', () => deriveEigen(p, ds.id), !!s.eigen);
      if (isPlane) btn('β → dataset', 'every pairwise intersection of these planes, as lines', () => deriveBeta(p, ds.id), s.n >= 2);
      const others = layers.filter((o) => o !== L && ['planes', 'faults'].includes(p.dataset(o.datasetId).kind));
      if (isPlane && others.length) {
        const sel = h('select'); sel.title = 'intersect this layer\'s mean plane with another\'s';
        sel.append(new Option('∩ intersect with…', ''));
        for (const o of others) sel.append(new Option(o.name || p.dataset(o.datasetId).name, o.datasetId));
        sel.onchange = () => { const b = sel.value; sel.value = ''; if (b) this._derive(() => deriveIntersection(p, ds.id, b)); };
        acts.append(sel);
      }
      card.append(acts);
      this.el.append(card);
    }
  }
}
