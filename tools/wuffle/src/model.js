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
  // axial (count each azimuth at both ends) applies to dip direction and trend only when asked: a strike is
  // always axial (diagram-svg.js), but a dip direction counted at +180° too drew every rose mirrored
  rose: { bins: 10, axial: false, scale: 'area', quantity: 'strike', column: null },
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
    this.originals = [];           // files kept VERBATIM (a signed field log, its .sig, its photos): { id, name, file, bytes, sig, photos }
    this.activeDiagram = null;
    this._seq = { d: 0, n: 0, l: 0, f: 0, o: 0 };
    this._listeners = new Set();
    this._undo = []; this._redo = []; this._depth = 0;   // the journal (see below)
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
  // datasets are COPY-ON-WRITE: a change replaces the object (and its rows array), never edits it — so the
  // undo journal can hold references to past datasets instead of copies of their rows
  _replaceDataset(d, next) { this.datasets = this.datasets.map((x) => (x === d ? next : x)); return next; }
  renameDataset(id, name) { const d = this._need(id); this._replaceDataset(d, { ...d, name: this._uniqueName(String(name).trim() || d.name) }); this._emit('dataset-changed', { id }); }
  /** edit rows in place: fn(rows) may mutate them or return a new array; every layer redraws */
  editRows(id, fn) {
    const old = this._need(id), d = this._replaceDataset(old, { ...old, rows: old.rows.map((r) => ({ ...r })), columns: [...old.columns] });
    const out = fn(d.rows);
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
  renameFigure(id, name) { const f = this.figure(id); if (!f) throw new Error(`no figure ${id}`); f.name = String(name).trim() || f.name; this._emit('figure-changed', { id }); }

  // ── originals: files kept byte for byte, never edited (a signature is over exact bytes). The data read from
  //    one is an ordinary dataset beside it (lineage { op: 'field log', original: name }) — edit that freely. ──
  original(id) { return this.originals.find((o) => o.id === id) || null; }
  /** @param {{ name, file, bytes: Uint8Array, sig?: Uint8Array|null, photos?: [{ name, bytes }] }} spec → id */
  addOriginal({ name, file, bytes, sig = null, photos = [] }) {
    if (!(bytes instanceof Uint8Array)) throw new Error('an original is bytes');
    let n = String(name || file || 'original').trim(), k = 2;
    while (this.originals.some((o) => o.name === n)) n = `${name} ${k++}`;
    const o = Object.freeze({ id: this._id('o'), name: n, file: String(file || 'log.csv'), bytes, sig, photos: Object.freeze(photos.map((x) => Object.freeze({ name: x.name, bytes: x.bytes }))) });
    this.originals = [...this.originals, o]; this._emit('original-added', { id: o.id }); return o.id;
  }
  removeOriginal(id) { if (!this.original(id)) throw new Error(`no original ${id}`); this.originals = this.originals.filter((o) => o.id !== id); this._emit('original-removed', { id }); }

  // (the project FILE is project-file.js: the /project tree, zipped — built from these methods, read back through them)

  _need(id) { const d = this.dataset(id); if (!d) throw new Error(`no dataset ${id}`); return d; }
  _needDiagram(id) { const g = this.diagram(id); if (!g) throw new Error(`no diagram ${id}`); return g; }
  _needLayer(id) { const l = this.layer(id); if (!l) throw new Error(`no layer ${id}`); return l; }
}

// ── THE JOURNAL: undo / redo for every change, whoever made it (the UI, the console, an agent) ──
// Each changing method runs inside _journal: the project's state is snapshotted before and after, and the
// pair is one undo step. Snapshots are cheap by construction: datasets are copy-on-write (a snapshot keeps
// references), and the rest — diagrams, layers, figures, the selection — is small. A change made inside
// another (derive → addDataset, a batch) is part of the outer step. Rapid repeats of the same setting on the
// same thing (a rotation drag, typing in a figure) merge into one step. Selection and the active diagram are
// view state: restored with a step, never steps of their own.

const JOURNALED = {
  addDataset: 'open data', renameDataset: 'rename', editRows: 'edit rows', removeDataset: 'delete data',
  derive: 'derive', selectionToDataset: 'selection → dataset',
  addDiagram: 'new diagram', setDiagramProps: 'diagram settings', renameDiagram: 'rename diagram', removeDiagram: 'remove diagram',
  addLayer: 'add layer', addView: 'add view', moveLayer: 'move layer', removeLayer: 'remove layer', removeEverywhere: 'remove from everywhere',
  setLayerVisible: 'show / hide', setLayerStyle: 'style', setElement: 'show / hide elements', setElementSettings: 'element settings',
  addFigure: 'new figure', setFigureDoc: 'edit figure', renameFigure: 'rename figure', removeFigure: 'delete figure',
  addOriginal: 'keep original', removeOriginal: 'remove original',
};
const COALESCE = new Set(['setDiagramProps', 'setLayerStyle', 'setElementSettings', 'setFigureDoc', 'editRows']);
const COALESCE_MS = 800;

Project.prototype._snap = function () {
  return { datasets: this.datasets.slice(), originals: this.originals.slice(), diagrams: clone(this.diagrams), layers: clone(this.layers), figures: clone(this.figures),
    selection: new Map([...this.selection].map(([k, v]) => [k, new Set(v)])), active: this.activeDiagram };
};
Project.prototype._restore = function (s) {
  this.datasets = s.datasets.slice(); this.originals = s.originals.slice(); this.diagrams = clone(s.diagrams); this.layers = clone(s.layers); this.figures = clone(s.figures);
  this.selection = new Map([...s.selection].map(([k, v]) => [k, new Set(v)]));
  this.activeDiagram = this.diagram(s.active) ? s.active : (this.diagrams[0]?.id || null);
};
const sameState = (a, b) => a.datasets.length === b.datasets.length && a.datasets.every((d, i) => d === b.datasets[i])
  && a.originals.length === b.originals.length && a.originals.every((o, i) => o === b.originals[i])
  && JSON.stringify([a.diagrams, a.layers, a.figures]) === JSON.stringify([b.diagrams, b.layers, b.figures]);

Project.prototype._journal = function (label, method, args, run) {
  if (this._depth > 0) return run();                    // part of an outer step
  this._depth++;
  const before = this._snap();
  let out;
  try { out = run(); } catch (e) { this._depth--; this._restore(before); throw e; }   // a refused change leaves nothing half-done
  this._depth--;
  const after = this._snap();
  if (sameState(before, after)) return out;              // nothing changed: no step
  const last = this._undo[this._undo.length - 1], now = Date.now(), key = args && typeof args[0] !== 'object' ? args[0] : null;
  if (last && COALESCE.has(method) && last.method === method && last.key === key && now - last.at < COALESCE_MS) { last.after = after; last.at = now; }
  else { this._undo.push({ label, method, key, before, after, at: now }); if (this._undo.length > 200) this._undo.shift(); }
  this._redo = [];
  return out;
};
/** several changes as ONE undo step: p.batch('open tocher', () => { … }) */
Project.prototype.batch = function (label, fn) { return this._journal(label, 'batch', [], fn); };
Project.prototype.canUndo = function () { return this._undo.length > 0; };
Project.prototype.canRedo = function () { return this._redo.length > 0; };
Project.prototype.undoLabel = function () { return this._undo.at(-1)?.label || null; };
Project.prototype.redoLabel = function () { return this._redo.at(-1)?.label || null; };
Project.prototype.undo = function () {
  const e = this._undo.pop(); if (!e) return null;
  this._restore(e.before); this._redo.push(e);
  this._emit('history', { label: e.label, dir: 'undo' }); return e.label;
};
Project.prototype.redo = function () {
  const e = this._redo.pop(); if (!e) return null;
  this._restore(e.after); this._undo.push(e);
  this._emit('history', { label: e.label, dir: 'redo' }); return e.label;
};
Project.prototype.clearHistory = function () { this._undo = []; this._redo = []; };

for (const [m, label] of Object.entries(JOURNALED)) {
  const f = Project.prototype[m];
  Project.prototype[m] = function (...args) { return this._journal(label, m, args, () => f.apply(this, args)); };
}
