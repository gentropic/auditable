// wuffle's project model — PURE (no DOM, no rendering). Design of record: spec_inbox/wuffle-desk-spec.md.
//
// Three things, ArcMap's data frames without its warts:
//   DATASET  — measurements, once per project. Its rows are the source of truth.
//   DIAGRAM  — a net, a rose or a fabric plot: the top level of the tree, with its own properties.
//   LAYER    — (diagram, dataset, what is drawn and how). Every layer of a dataset is a HARD LINK to
//              the same rows: styling is per layer, data is shared. Removing a layer never removes data.
// Selection belongs to the DATA (a lasso on one net selects the rows on every net). Derived results
// (a set mean, an intersection, a selection made a set) are datasets too, carrying their lineage.

export const DATASET_KINDS = ['planes', 'lines', 'faults', 'smallcircles'];
export const DIAGRAM_KINDS = ['net', 'rose', 'fabric'];

// what a layer can draw, by dataset kind — the nested checkboxes, in tree order. A group (eigen)
// is a parent whose state is the tri-state of its children.
export const ELEMENTS = {
  planes: ['poles', 'greatCircles', 'contours', 'mean', { eigen: ['v1Pole', 'v1Circle', 'v2Pole', 'v2Circle', 'v3Pole', 'v3Circle'] }, 'labels'],
  lines: ['points', 'contours', 'mean', { eigen: ['v1Pole', 'v1Circle', 'v2Pole', 'v2Circle', 'v3Pole', 'v3Circle'] }, 'labels'],
  faults: ['greatCircles', 'slip', 'ptAxes', 'dihedra', 'labels'],
  smallcircles: ['circles', 'axes', 'labels'],
};
// what a new layer shows: poles (or points) — great circles too only for faults, where they're the point;
// 200 great circles bury a net (OpenStereo's default is poles only too)
const DEFAULT_ON = { planes: ['poles'], lines: ['points'], faults: ['greatCircles', 'slip'], smallcircles: ['circles'] };
const DEFAULT_SETTINGS = {
  contours: { method: 'kamb', sigma: 3, levels: null },
  mean: { axial: true, confidence: 0.95 },
  labels: { column: null },
};
export const DIAGRAM_DEFAULTS = {
  net: { projection: 'equal-area', hemisphere: 'lower', rotation: null, matrix: null, graticule: 10 },   // rotation: a centre [tr, pl]; matrix: a dragged rotation
  rose: { bins: 10, axial: true, scale: 'area', quantity: 'strike', column: null },
  fabric: { plot: 'vollmer' },
};

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const leafNames = (kind) => ELEMENTS[kind].flatMap((e) => (typeof e === 'string' ? [e] : Object.values(e)[0]));
function defaultElements(kind) {
  const out = {};
  for (const name of leafNames(kind)) out[name] = { on: DEFAULT_ON[kind].includes(name), ...clone(DEFAULT_SETTINGS[name] || {}) };
  return out;
}

export class Project {
  constructor({ name = 'untitled' } = {}) {
    this.name = name;
    this.datasets = [];            // ordered: the data section
    this.diagrams = [];            // ordered: the tree's top level
    this.layers = [];              // each knows its diagram; order within a diagram = draw order (last on top)
    this.selection = new Map();    // datasetId → Set(row index)
    this.figures = [];             // compo pages: { id, name, doc, from } — `from` the diagram a figure was made of
    this.activeDiagram = null;
    this._seq = { d: 0, n: 0, l: 0, f: 0 };
    this._listeners = new Set();
  }

  // ── events: one 'change' stream, { type, ...detail } ──
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(type, detail = {}) { for (const fn of this._listeners) fn({ type, ...detail }); }
  _id(k) { this._seq[k] += 1; return `${k}${this._seq[k]}`; }

  // ── datasets ──
  dataset(id) { return this.datasets.find((d) => d.id === id) || null; }
  /**
   * @param {{ name: string, kind?: string, rows: object[], columns?: string[], roles?: object,
   *           notation?: string, lineage?: object, meta?: object }} spec
   *   roles map meaning → column: planes { dipDir, dip } (or { strike, dip } with notation 'rhr'),
   *   lines { trend, plunge }, faults { dipDir, dip, trend, plunge, sense }, smallcircles { trend, plunge, angle }.
   */
  addDataset(spec) {
    const kind = spec.kind || 'planes';
    if (!DATASET_KINDS.includes(kind)) throw new Error(`dataset kind must be one of ${DATASET_KINDS.join(', ')} (got ${kind})`);
    const rows = (spec.rows || []).map((r) => ({ ...r }));
    const columns = spec.columns ? [...spec.columns] : [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const d = { id: this._id('d'), name: this._uniqueName(spec.name || kind), kind, rows, columns, roles: { ...(spec.roles || {}) },
      notation: spec.notation || null, lineage: spec.lineage ? clone(spec.lineage) : null, meta: clone(spec.meta || {}) };
    this.datasets.push(d);
    this._emit('dataset-added', { id: d.id });
    return d.id;
  }
  _uniqueName(name) {
    const used = new Set(this.datasets.map((d) => d.name));
    if (!used.has(name)) return name;
    let k = 2; while (used.has(`${name} (${k})`)) k++;
    return `${name} (${k})`;
  }
  renameDataset(id, name) { const d = this._need(id); d.name = this._uniqueName(String(name).trim() || d.name); this._emit('dataset-changed', { id }); }
  /** edit rows in place: fn(rows) may mutate them or return a new array; every layer redraws */
  editRows(id, fn) {
    const d = this._need(id), out = fn(d.rows);
    if (Array.isArray(out)) d.rows = out;
    for (const r of d.rows) for (const k of Object.keys(r)) if (!d.columns.includes(k)) d.columns.push(k);
    const sel = this.selection.get(id);
    if (sel) for (const i of [...sel]) if (i >= d.rows.length) sel.delete(i);
    this._emit('rows-changed', { id });
  }
  /** where a dataset is drawn: [{ layer, diagram }] */
  usesOf(datasetId) {
    return this.layers.filter((l) => l.datasetId === datasetId).map((l) => ({ layer: l.id, diagram: l.diagramId, diagramName: this.diagram(l.diagramId)?.name }));
  }
  /**
   * Remove a dataset. Still drawn somewhere → refused unless { force: true }; the error names the diagrams,
   * so the app can confirm with them. Derived datasets keep their lineage (it names the source by name).
   */
  removeDataset(id, { force = false } = {}) {
    const d = this._need(id), uses = this.usesOf(id);
    if (uses.length && !force) {
      const e = new Error(`“${d.name}” is drawn on ${[...new Set(uses.map((u) => u.diagramName))].join(', ')}`);
      e.uses = uses; throw e;
    }
    this.layers = this.layers.filter((l) => l.datasetId !== id);
    this.datasets = this.datasets.filter((x) => x !== d);
    this.selection.delete(id);
    this._emit('dataset-removed', { id, uses });
  }
  /**
   * A new dataset made from others: a set mean, an intersection, a selection made a set. Lineage records
   * the operation, its parameters and its sources (by id AND name, so it still reads if a source goes).
   */
  derive({ name, kind = 'planes', rows, columns, roles, notation, op, params = {}, sources = [] }) {
    const lineage = { op, params: clone(params), sources: sources.map((s) => ({ id: s, name: this.dataset(s)?.name ?? null })), at: new Date().toISOString() };
    return this.addDataset({ name, kind, rows, columns, roles, notation, lineage });
  }
  /** the selected rows of a dataset, as a new dataset (same kind, roles and notation; lineage → the source) */
  selectionToDataset(datasetId, name) {
    const d = this._need(datasetId), sel = [...(this.selection.get(datasetId) || [])].sort((a, b) => a - b);
    if (!sel.length) throw new Error(`nothing selected in “${d.name}”`);
    return this.derive({ name: name || `${d.name} · selection`, kind: d.kind, rows: sel.map((i) => ({ ...d.rows[i] })), columns: d.columns,
      roles: d.roles, notation: d.notation, op: 'selection', params: { rows: sel }, sources: [datasetId] });
  }

  // ── diagrams ──
  diagram(id) { return this.diagrams.find((g) => g.id === id) || null; }
  addDiagram(kind = 'net', { name, props } = {}) {
    if (!DIAGRAM_KINDS.includes(kind)) throw new Error(`diagram kind must be one of ${DIAGRAM_KINDS.join(', ')}`);
    const n = this.diagrams.filter((g) => g.kind === kind).length + 1;
    const g = { id: this._id('n'), kind, name: name || `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, props: { ...clone(DIAGRAM_DEFAULTS[kind]), ...(props || {}) } };
    this.diagrams.push(g);
    if (!this.activeDiagram) this.activeDiagram = g.id;
    this._emit('diagram-added', { id: g.id });
    return g.id;
  }
  setDiagramProps(id, props) { Object.assign(this._needDiagram(id).props, props); this._emit('diagram-changed', { id }); }
  renameDiagram(id, name) { const g = this._needDiagram(id); g.name = String(name).trim() || g.name; this._emit('diagram-changed', { id }); }
  /** removing a diagram removes its layers, never data */
  removeDiagram(id) {
    this._needDiagram(id);
    this.layers = this.layers.filter((l) => l.diagramId !== id);
    this.diagrams = this.diagrams.filter((g) => g.id !== id);
    if (this.activeDiagram === id) this.activeDiagram = this.diagrams[0]?.id || null;
    this._emit('diagram-removed', { id });
  }
  setActive(id) { this._needDiagram(id); this.activeDiagram = id; this._emit('active-changed', { id }); }

  // ── layers ──
  layer(id) { return this.layers.find((l) => l.id === id) || null; }
  layersOf(diagramId) { return this.layers.filter((l) => l.diagramId === diagramId); }
  /** a dataset onto a diagram: a new view (hard link) with default elements and the given style */
  addLayer(diagramId, datasetId, { style, elements, name } = {}) {
    this._needDiagram(diagramId); const d = this._need(datasetId);
    const l = { id: this._id('l'), diagramId, datasetId, name: name || null, visible: true,
      elements: elements ? clone(elements) : defaultElements(d.kind), style: { color: null, symbol: 'circle', size: 4, ...(style || {}) } };
    this.layers.push(l);
    this._emit('layer-added', { id: l.id });
    return l.id;
  }
  /** the drag default: the same data on another diagram, its styling copied (then independent) */
  addView(layerId, toDiagramId) {
    const l = this._needLayer(layerId);
    return this.addLayer(toDiagramId, l.datasetId, { style: l.style, elements: l.elements, name: l.name });
  }
  /** shift-drag: the layer leaves its diagram for another (at an index in that diagram's order) */
  moveLayer(layerId, toDiagramId, index = null) {
    const l = this._needLayer(layerId); this._needDiagram(toDiagramId);
    this.layers = this.layers.filter((x) => x !== l);
    l.diagramId = toDiagramId;
    const peers = this.layersOf(toDiagramId);
    const at = index == null || index >= peers.length ? (peers.length ? this.layers.indexOf(peers[peers.length - 1]) + 1 : this.layers.length) : this.layers.indexOf(peers[Math.max(0, index)]);
    this.layers.splice(at, 0, l);
    this._emit('layer-moved', { id: layerId });
  }
  removeLayer(layerId) { this._needLayer(layerId); this.layers = this.layers.filter((l) => l.id !== layerId); this._emit('layer-removed', { id: layerId }); }
  /** "remove from everywhere": every layer of the dataset goes; the data stays (the app confirms first, with usesOf) */
  removeEverywhere(datasetId) {
    this._need(datasetId);
    const gone = this.layers.filter((l) => l.datasetId === datasetId).map((l) => l.id);
    this.layers = this.layers.filter((l) => l.datasetId !== datasetId);
    this._emit('layers-removed', { ids: gone, datasetId });
    return gone;
  }
  setLayerVisible(layerId, on) { this._needLayer(layerId).visible = !!on; this._emit('layer-changed', { id: layerId }); }
  setLayerStyle(layerId, style) { Object.assign(this._needLayer(layerId).style, style); this._emit('layer-changed', { id: layerId }); }

  // ── elements: the nested checkboxes ──
  /** switch an element (or a whole group, e.g. 'eigen') on or off */
  setElement(layerId, name, on) {
    const l = this._needLayer(layerId), kind = this._need(l.datasetId).kind;
    const group = ELEMENTS[kind].find((e) => typeof e === 'object' && Object.keys(e)[0] === name);
    const names = group ? Object.values(group)[0] : [name];
    for (const n of names) { if (!l.elements[n]) throw new Error(`${kind} layers have no element “${n}”`); l.elements[n].on = !!on; }
    this._emit('layer-changed', { id: layerId });
  }
  /** settings of one element (contour method, cone confidence…), merged */
  setElementSettings(layerId, name, settings) {
    const l = this._needLayer(layerId);
    if (!l.elements[name]) throw new Error(`no element “${name}”`);
    Object.assign(l.elements[name], settings);
    this._emit('layer-changed', { id: layerId });
  }
  /** 'on' | 'off' | 'partial' — partial when some children of a group are on */
  elementState(layerId, name) {
    const l = this._needLayer(layerId), kind = this._need(l.datasetId).kind;
    const group = ELEMENTS[kind].find((e) => typeof e === 'object' && Object.keys(e)[0] === name);
    const names = group ? Object.values(group)[0] : [name];
    const on = names.filter((n) => l.elements[n]?.on).length;
    return on === 0 ? 'off' : on === names.length ? 'on' : 'partial';
  }
  /** the layer's tree, for the UI: [{ name, state, children? }] */
  elementTree(layerId) {
    const l = this._needLayer(layerId), kind = this._need(l.datasetId).kind;
    return ELEMENTS[kind].map((e) => (typeof e === 'string'
      ? { name: e, state: l.elements[e].on ? 'on' : 'off' }
      : { name: Object.keys(e)[0], state: this.elementState(layerId, Object.keys(e)[0]), children: Object.values(e)[0].map((c) => ({ name: c, state: l.elements[c].on ? 'on' : 'off' })) }));
  }

  // ── selection: on the data ──
  /** mode: 'replace' | 'add' | 'subtract' | 'toggle' */
  select(datasetId, rows, mode = 'replace') {
    const d = this._need(datasetId);
    let s = this.selection.get(datasetId) || new Set();
    if (mode === 'replace') s = new Set();
    for (const i of rows) {
      if (!(i >= 0 && i < d.rows.length)) continue;
      if (mode === 'subtract') s.delete(i); else if (mode === 'toggle') (s.has(i) ? s.delete(i) : s.add(i)); else s.add(i);
    }
    if (s.size) this.selection.set(datasetId, s); else this.selection.delete(datasetId);
    this._emit('selection-changed', { datasetId });
  }
  selected(datasetId) { return [...(this.selection.get(datasetId) || [])].sort((a, b) => a - b); }
  clearSelection(datasetId = null) {
    if (datasetId) this.selection.delete(datasetId); else this.selection.clear();
    this._emit('selection-changed', { datasetId });
  }

  // ── figures (compo documents, kept with the project) ──
  figure(id) { return this.figures.find((f) => f.id === id) || null; }
  addFigure({ name, doc, from = null }) {
    const f = { id: this._id('f'), name: name || `Figure ${this.figures.length + 1}`, doc: clone(doc), from };
    this.figures.push(f); this._emit('figure-added', { id: f.id }); return f.id;
  }
  setFigureDoc(id, doc) { const f = this.figure(id); if (!f) throw new Error(`no figure ${id}`); f.doc = clone(doc); this._emit('figure-changed', { id }); }
  removeFigure(id) { this.figures = this.figures.filter((f) => f.id !== id); this._emit('figure-removed', { id }); }

  // ── the project file ──
  toJSON() {
    return { app: 'wuffle', v: 1, name: this.name, seq: { ...this._seq }, activeDiagram: this.activeDiagram,
      datasets: clone(this.datasets), diagrams: clone(this.diagrams), layers: clone(this.layers), figures: clone(this.figures),
      selection: Object.fromEntries([...this.selection].map(([k, v]) => [k, [...v]])) };
  }
  static fromJSON(j) {
    if (!j || j.app !== 'wuffle') throw new Error('not a wuffle project');
    const p = new Project({ name: j.name });
    p._seq = { d: 0, n: 0, l: 0, f: 0, ...(j.seq || {}) };
    p.datasets = clone(j.datasets || []); p.diagrams = clone(j.diagrams || []); p.layers = clone(j.layers || []); p.figures = clone(j.figures || []);
    // a layer whose dataset or diagram is missing is dropped (a file edited by hand), never a crash
    const ds = new Set(p.datasets.map((d) => d.id)), gs = new Set(p.diagrams.map((g) => g.id));
    p.layers = p.layers.filter((l) => ds.has(l.datasetId) && gs.has(l.diagramId));
    for (const [k, v] of Object.entries(j.selection || {})) if (ds.has(k)) p.selection.set(k, new Set(v));
    p.activeDiagram = gs.has(j.activeDiagram) ? j.activeDiagram : p.diagrams[0]?.id || null;
    return p;
  }

  _need(id) { const d = this.dataset(id); if (!d) throw new Error(`no dataset ${id}`); return d; }
  _needDiagram(id) { const g = this.diagram(id); if (!g) throw new Error(`no diagram ${id}`); return g; }
  _needLayer(id) { const l = this.layer(id); if (!l) throw new Error(`no layer ${id}`); return l; }
}
