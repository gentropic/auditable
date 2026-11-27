// wuffle desk — the tree. Top level: the DIAGRAMS (the focused one bold), each with its LAYERS; a layer opens
// into its elements (OpenStereo's nested checkboxes; groups are tri-state). At the bottom, the DATA: every
// dataset, drawn or not. Drag a layer onto another diagram = a new view of the same data (⇧ moves it);
// drag a dataset onto a diagram = a layer. Double-click a layer (or its menu) for its properties.

import { Menu } from '../../../ext/menu/index.js';
import { Dialog, confirm, prompt } from '../../../ext/dialog/index.js';
import { orientations } from './io.js';

const LABEL = { poles: 'poles', points: 'points', greatCircles: 'great circles', contours: 'contours', mean: 'mean + cone', eigen: 'eigenvectors',
  v1Pole: 'V1', v1Circle: 'V1 great circle', v2Pole: 'V2', v2Circle: 'V2 great circle', v3Pole: 'V3', v3Circle: 'V3 great circle',
  labels: 'labels', slip: 'slip lines', ptAxes: 'P and T axes', dihedra: 'right dihedra', circles: 'circles', axes: 'axes' };
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class TreeView {
  constructor(project, { onShowDataset, onFocusDiagram, colorOf } = {}) {
    this.p = project; this.open = new Set(); this.onShowDataset = onShowDataset || (() => {});
    this.onFocusDiagram = onFocusDiagram || (() => {}); this.colorOf = colorOf || (() => null);
    this.el = h('div', 'wtree'); this.el.setAttribute('role', 'tree');
    project.on(() => this.render());
    this.render();
  }

  _check(state, onToggle, title) {
    const b = h('button', `wcb ${state}`); b.type = 'button'; b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', state === 'partial' ? 'mixed' : String(state === 'on')); if (title) b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onToggle(state !== 'on'); });
    return b;
  }
  _twisty(key) {
    const t = h('button', 'wtw', this.open.has(key) ? '▾' : '▸'); t.type = 'button'; t.setAttribute('aria-label', this.open.has(key) ? 'collapse' : 'expand');
    t.addEventListener('click', (e) => { e.stopPropagation(); this.open.has(key) ? this.open.delete(key) : this.open.add(key); this.render(); });
    return t;
  }

  render() {
    const p = this.p, root = this.el;
    root.replaceChildren();
    for (const g of p.diagrams) {
      if (!this.open.has('init:' + g.id)) { this.open.add('init:' + g.id); this.open.add(g.id); }   // a new diagram opens
      const row = h('div', `wrow wdiag${p.activeDiagram === g.id ? ' active' : ''}`);
      row.append(this._twisty(g.id), h('span', 'wico', g.kind === 'net' ? '◍' : g.kind === 'rose' ? '✺' : '△'), h('span', 'wname', g.name),
        h('span', 'wn', `${p.layersOf(g.id).length}`));
      row.addEventListener('click', () => { p.setActive(g.id); this.onFocusDiagram(g.id); });
      row.addEventListener('contextmenu', (e) => this._diagramMenu(e, g));
      this._dropTarget(row, g.id);
      root.append(row);
      if (!this.open.has(g.id)) continue;
      p.layersOf(g.id).forEach((L, i) => {
        const ds = p.dataset(L.datasetId), key = L.id;
        const lr = h('div', 'wrow wlayer'); lr.draggable = true;
        const sw = h('span', 'wsw'); sw.style.background = this.colorOf(L, i) || 'var(--w-text-mid)';
        lr.append(this._twisty(key), this._check(L.visible ? 'on' : 'off', (on) => p.setLayerVisible(L.id, on), 'show / hide'), sw,
          h('span', 'wname', L.name || ds.name), h('span', 'wn', String(ds.rows.length)));
        // the badge counts the OTHER DIAGRAMS this dataset is drawn on (it counted layers: a second view on the
        // same net read as another diagram)
        const others = new Set(p.usesOf(ds.id).map((u) => u.diagram).filter((d) => d !== g.id)).size;
        if (others > 0) { const b = h('span', 'wlink', `⧉${others}`); b.title = `also drawn on ${others} other diagram${others > 1 ? 's' : ''} — the same data`; lr.append(b); }
        lr.addEventListener('click', () => { p.setActive(g.id); this.onShowDataset(ds.id); });
        lr.addEventListener('dblclick', () => this.properties(L.id));
        lr.addEventListener('contextmenu', (e) => this._layerMenu(e, L));
        lr.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-wuffle-layer', L.id); e.dataTransfer.effectAllowed = 'copyMove'; });
        root.append(lr);
        if (!this.open.has(key)) return;
        for (const el of p.elementTree(L.id)) {
          const er = h('div', 'wrow wel');
          er.append(el.children ? this._twisty(key + ':' + el.name) : h('span', 'wtw'), this._check(el.state, (on) => p.setElement(L.id, el.name, on)), h('span', 'wname', LABEL[el.name] || el.name));
          if (el.name === 'contours') er.append(h('span', 'wn', L.elements.contours.method === 'kamb' ? `Kamb ${L.elements.contours.sigma}σ` : 'Fisher'));
          if (el.name === 'mean') er.append(h('span', 'wn', `${Math.round((L.elements.mean.confidence || 0.95) * 100)} %`));
          root.append(er);
          if (el.children && this.open.has(key + ':' + el.name)) for (const c of el.children) {
            const cr = h('div', 'wrow wel wel2');
            cr.append(h('span', 'wtw'), this._check(c.state, (on) => p.setElement(L.id, c.name, on)), h('span', 'wname', LABEL[c.name] || c.name));
            root.append(cr);
          }
        }
      });
    }
    if (p.figures.length) {
      root.append(h('div', 'wsec', 'figures'));
      for (const f of p.figures) {
        const r = h('div', 'wrow wdata'); r.append(h('span', 'wtw'), h('span', 'wico', '▭'), h('span', 'wname', f.name));
        r.addEventListener('click', () => this.onOpenFigure?.(f.id));
        r.addEventListener('contextmenu', async (e) => { e.preventDefault(); const a = await Menu.show([{ label: 'Open', action: 'open' }, { label: 'Rename…', action: 'rename' }, '---', { label: 'Delete figure', action: 'del', danger: true }], { x: e.clientX, y: e.clientY });
          if (a === 'open') this.onOpenFigure?.(f.id);
          else if (a === 'rename') { const n = await prompt('Name of the figure', { defaultValue: f.name }); if (n) p.renameFigure(f.id, n); }
          else if (a === 'del' && await confirm(`Delete “${f.name}”?`, { okLabel: 'Delete', danger: true })) p.removeFigure(f.id); });
        root.append(r);
      }
    }
    root.append(h('div', 'wsec', 'data'));
    if (!p.datasets.length) root.append(h('div', 'wempty', 'File → Open data…, or File → Open the tocher sample'));
    for (const ds of p.datasets) {
      const r = h('div', 'wrow wdata'); r.draggable = true;
      const uses = p.usesOf(ds.id).length;
      r.append(h('span', 'wtw'), h('span', 'wico', ds.lineage ? '↳' : '▤'), h('span', 'wname', ds.name), h('span', 'wn', `${ds.rows.length}${uses ? '' : ' · not drawn'}`));
      if (ds.lineage) r.title = `made by ${ds.lineage.op} from ${ds.lineage.sources.map((s) => s.name).join(', ')}`;
      r.addEventListener('click', () => this.onShowDataset(ds.id));
      r.addEventListener('contextmenu', (e) => this._dataMenu(e, ds));
      r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-wuffle-dataset', ds.id); e.dataTransfer.effectAllowed = 'copy'; });
      root.append(r);
    }
  }

  _dropTarget(row, diagramId) {
    row.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].some((t) => t.startsWith('application/x-wuffle-'))) return;
      e.preventDefault(); e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'; row.classList.add('drop');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop');
      const lid = e.dataTransfer.getData('application/x-wuffle-layer'), did = e.dataTransfer.getData('application/x-wuffle-dataset');
      if (lid) { const L = this.p.layer(lid); if (!L || L.diagramId === diagramId) return; e.shiftKey ? this.p.moveLayer(lid, diagramId) : this.p.addView(lid, diagramId); }
      else if (did) this.p.addLayer(diagramId, did);
      this.open.add(diagramId);
    });
  }

  async _layerMenu(e, L) {
    e.preventDefault();
    const p = this.p, ds = p.dataset(L.datasetId), others = p.diagrams.filter((g) => g.id !== L.diagramId);
    const uses = p.usesOf(ds.id);
    const a = await Menu.show([
      { label: 'Properties…', action: 'props' },
      { label: 'Show the table', action: 'table' },
      '---',
      { label: 'Add a view to', disabled: !others.length, children: others.map((g) => ({ label: g.name, action: 'view:' + g.id })) },
      { label: 'Move to', disabled: !others.length, children: others.map((g) => ({ label: g.name, action: 'move:' + g.id })) },
      { label: 'Selection → new dataset', action: 'selds', disabled: !p.selected(ds.id).length },
      '---',
      { label: 'Remove from this diagram', action: 'remove' },
      // (counted in DIAGRAMS: a dataset drawn twice on one net is still one diagram)
      { label: `Remove from everywhere${new Set(uses.map((u) => u.diagramName)).size > 1 ? ` (${new Set(uses.map((u) => u.diagramName)).size} diagrams)` : ''}`, action: 'everywhere', danger: true },
    ], { x: e.clientX, y: e.clientY });
    if (!a) return;
    if (a === 'props') this.properties(L.id);
    else if (a === 'table') this.onShowDataset(ds.id);
    else if (a.startsWith('view:')) p.addView(L.id, a.slice(5));
    else if (a.startsWith('move:')) p.moveLayer(L.id, a.slice(5));
    else if (a === 'selds') { const id = p.selectionToDataset(ds.id); this.onShowDataset(id); }
    else if (a === 'remove') p.removeLayer(L.id);
    else if (a === 'everywhere') {
      const names = [...new Set(uses.map((u) => u.diagramName))].join(', ');
      if (await confirm(`Remove “${ds.name}” from ${names}? The data stays in the project.`, { okLabel: 'Remove from everywhere', danger: true })) p.removeEverywhere(ds.id);
    }
  }
  async _diagramMenu(e, g) {
    e.preventDefault();
    const a = await Menu.show([
      { label: 'Rename…', action: 'rename' },
      ...this.diagramItems(g),
      '---',
      { label: 'Remove diagram', action: 'remove', danger: true },
    ], { x: e.clientX, y: e.clientY });
    if (a) await this.diagramAction(g, a);
  }
  /** a diagram's own settings, as menu items — the tree's menu and the net's right-click share them */
  diagramItems(g) {
    return g.kind === 'rose' ? [
      { label: 'Quantity', children: [['strike', 'strike (planes, axial)'], ['dipDirection', 'dip direction (planes)'], ['trend', 'trend (lines)']].map(([k, t]) => ({ label: t, action: 'q:' + k, checked: (g.props.quantity || 'strike') === k, group: 'q' })) },
      { label: 'Sector', children: [5, 10, 15, 20, 30].map((b) => ({ label: `${b}°`, action: 'bins:' + b, checked: g.props.bins === b, group: 'b' })) },
      { label: 'Scale', children: [['area', 'area-true (√)'], ['linear', 'linear']].map(([k, t]) => ({ label: t, action: 'scale:' + k, checked: (g.props.scale || 'area') === k, group: 's' })) },
      { label: 'Count both ends (axial)', action: 'axial', checked: (g.props.quantity || 'strike') === 'strike' || !!g.props.axial, disabled: (g.props.quantity || 'strike') === 'strike' },
    ] : g.kind === 'fabric' ? [
      { label: 'Plot', children: [['vollmer', 'Vollmer P–G–R'], ['woodcock', 'Woodcock K–C']].map(([k, t]) => ({ label: t, action: 'plot:' + k, checked: g.props.plot === k, group: 'f' })) },
    ] : [
      { label: 'Projection', children: [{ label: 'equal-area (Schmidt)', action: 'proj:equal-area', checked: g.props.projection === 'equal-area', group: 'p' }, { label: 'equal-angle (Wulff)', action: 'proj:equal-angle', checked: g.props.projection === 'equal-angle', group: 'p' }] },
      { label: 'Hemisphere', children: [{ label: 'lower', action: 'hemi:lower', checked: g.props.hemisphere === 'lower', group: 'h' }, { label: 'upper', action: 'hemi:upper', checked: g.props.hemisphere === 'upper', group: 'h' }] },
      { label: 'Graticule', children: [[0, 'none'], [5, '5°'], [10, '10°'], [15, '15°'], [30, '30°']].map(([v, t]) => ({ label: t, action: 'grat:' + v, checked: (g.props.graticule ?? 10) === v, group: 'g' })) },
      { label: 'Reset rotation', action: 'unrotate', disabled: !g.props.matrix && !g.props.rotation },
    ];
  }
  /** → true when it was one of the diagram's actions */
  async diagramAction(g, a) {
    if (a === 'rename') { const n = await prompt('Name of the diagram', { defaultValue: g.name }); if (n) this.p.renameDiagram(g.id, n); }
    else if (a.startsWith('proj:')) this.p.setDiagramProps(g.id, { projection: a.slice(5) });
    else if (a.startsWith('hemi:')) this.p.setDiagramProps(g.id, { hemisphere: a.slice(5) });
    else if (a.startsWith('grat:')) this.p.setDiagramProps(g.id, { graticule: +a.slice(5) });
    else if (a === 'unrotate') this.p.setDiagramProps(g.id, { matrix: null, rotation: null });
    else if (a.startsWith('q:')) this.p.setDiagramProps(g.id, { quantity: a.slice(2) });
    else if (a.startsWith('bins:')) this.p.setDiagramProps(g.id, { bins: +a.slice(5) });
    else if (a.startsWith('scale:')) this.p.setDiagramProps(g.id, { scale: a.slice(6) });
    else if (a === 'axial') this.p.setDiagramProps(g.id, { axial: !g.props.axial });
    else if (a.startsWith('plot:')) this.p.setDiagramProps(g.id, { plot: a.slice(5) });
    else if (a === 'remove') { if (await confirm(`Remove “${g.name}”? Its layers go; the data stays.`, { okLabel: 'Remove', danger: true })) this.p.removeDiagram(g.id); }
    else return false;
    return true;
  }
  async _dataMenu(e, ds) {
    e.preventDefault();
    const p = this.p, nets = p.diagrams;
    const a = await Menu.show([
      { label: 'Show the table', action: 'table' },
      { label: ds.kind === 'table' ? 'Draw on (a table has no attitudes — join it onto measurements)' : 'Draw on', disabled: !nets.length || ds.kind === 'table', children: nets.map((g) => ({ label: g.name, action: 'draw:' + g.id })) },
      { label: 'Rename…', action: 'rename' },
      '---',
      { label: 'Delete dataset', action: 'delete', danger: true },
    ], { x: e.clientX, y: e.clientY });
    if (!a) return;
    if (a === 'table') this.onShowDataset(ds.id);
    else if (a.startsWith('draw:')) p.addLayer(a.slice(5), ds.id);
    else if (a === 'rename') { const n = await prompt('Name of the dataset', { defaultValue: ds.name }); if (n) p.renameDataset(ds.id, n); }
    else if (a === 'delete') {
      const uses = p.usesOf(ds.id);
      const where = uses.length ? ` It is drawn on ${[...new Set(uses.map((u) => u.diagramName))].join(', ')}.` : '';
      if (await confirm(`Delete “${ds.name}” (${ds.rows.length} rows)?${where}`, { okLabel: 'Delete', danger: true })) p.removeDataset(ds.id, { force: true });
    }
  }

  /** the OS2 rhythm: set a layer up once here, then look at the net */
  async properties(layerId) {
    const p = this.p, L = p.layer(layerId); if (!L) return;
    const ds = p.dataset(L.datasetId), E = L.elements, n = orientations(ds).filter(Boolean).length;
    const res = await new Dialog({
      title: `${L.name || ds.name} · properties`, width: 380,
      render(body, ctx) {
        const row = (label, input) => { const r = h('label', 'wprow'); r.append(h('span', null, label), input); body.append(r); return input; };
        const inp = (type, value, attrs = {}) => { const i = h('input'); i.type = type; i.value = value; Object.assign(i, attrs); return i; };
        const sel = (opts, v) => { const s = h('select'); for (const [k, t] of opts) { const o = h('option', null, t); o.value = k; s.append(o); } s.value = v; return s; };
        body.append(h('p', 'wpnote', `${ds.name} · ${ds.kind} · ${n} of ${ds.rows.length} rows read`));
        const color = row('color', inp('color', L.style.color || '#e8836b'));
        const size = row('symbol size', inp('number', L.style.size || 4, { min: 1, max: 12, step: 0.5 }));
        let cm, cs, mc;
        let cf, cl;
        if (E.contours) { cm = row('contours', sel([['kamb', 'Kamb (σ)'], ['fisher', 'Fisher kernel (MUD)']], E.contours.method)); cs = row('Kamb k (E = kσ)', inp('number', E.contours.sigma ?? 3, { min: 1, max: 6, step: 0.5 }));
          cf = row('filled bands', inp('checkbox', '', { checked: !!E.contours.filled })); cl = row('levels', inp('text', (E.contours.levels || []).join(', '), { placeholder: E.contours.method === 'fisher' ? '2, 4, 6, 8 (MUD)' : '2, 4, 6, 8, 10, 12 (σ)' })); }
        if (E.mean) mc = row('cone confidence', sel([['0.95', '95 %'], ['0.99', '99 %'], ['0.9', '90 %']], String(E.mean.confidence ?? 0.95)));
        const lab = E.labels ? row('labels from', sel([['', '— row number'], ...ds.columns.map((c) => [c, c])], E.labels.column || '')) : null;
        const bar = h('div', 'wpbar'); const ok = h('button', 'primary', 'Apply'); ok.type = 'button'; ok.dataset.default = 'true';
        const cancel = h('button', null, 'Cancel'); cancel.type = 'button';
        bar.append(cancel, ok); body.append(bar);
        cancel.onclick = () => ctx.close(null);
        ok.onclick = () => ctx.close({ color: color.value, size: +size.value, cm: cm?.value, cs: cs ? +cs.value : null, cf: cf ? cf.checked : null, cl: cl ? cl.value : null, mc: mc ? +mc.value : null, lab: lab ? lab.value : null });
      },
    }).show();
    if (!res) return;
    p.batch('layer properties', () => {                 // one Apply, one undo step
      p.setLayerStyle(layerId, { color: res.color, size: res.size });
      if (res.cm) {
        const lv = String(res.cl || '').split(/[,\s]+/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        p.setElementSettings(layerId, 'contours', { method: res.cm, sigma: res.cs, filled: !!res.cf, levels: lv.length ? lv : null });
      }
      if (res.mc) p.setElementSettings(layerId, 'mean', { confidence: res.mc });
      if (res.lab != null && E.labels) p.setElementSettings(layerId, 'labels', { column: res.lab || null });
    });
  }
}
