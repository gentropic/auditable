// wuffle desk — the table: one dataset in a @gcu/loom grid. Its rows ARE the data: an edit goes through the
// model (every net redraws), rows selected anywhere wear loom's brushing wash here, and selecting rows
// here selects them everywhere. A read-only first column shows the attitude wuffle read from the row.

import { createGrid, CellState, CellType, DARK_COLORS, LIGHT_COLORS } from '../../../ext/loom/index.js';
import { orientations } from './io.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';

function providerFor(p, datasetId) {
  const ds = () => p.dataset(datasetId);
  let o = orientations(ds());
  const refresh = () => { o = orientations(ds()); };
  const cols = () => ['attitude', ...ds().columns];
  return {
    refreshOrientations: refresh,
    dims: () => ({ rows: ds().rows.length, cols: cols().length }),
    header: (c) => (c === 0 ? { label: ds().kind === 'lines' ? 'trend→plunge' : ds().kind === 'smallcircles' ? 'axis trend→plunge' : 'dip dir/dip' } : { label: cols()[c] }),
    cellAt(r, c) {
      // (a grid that drew a longer dataset a moment ago may still ask for a row that is gone: no row, no cell)
      const d = ds(); if (!d || r >= d.rows.length || !d.rows[r]) return null;
      const hi = p.selection.get(datasetId)?.has(r) ? { highlight: true } : undefined;
      if (c === 0) {
        const x = o[r];
        const text = !x ? '—' : x.plane ? formatPlane(x.plane) : formatLine(x.line);
        return { value: text, state: x ? CellState.DERIVED : CellState.ERROR, type: CellType.STRING, style: { ...(hi || {}), text } };
      }
      const v = d.rows[r][cols()[c]];
      return { value: v === '' ? null : v, state: CellState.RAW, type: typeof v === 'number' ? CellType.NUMBER : CellType.STRING, ...(hi ? { style: hi } : {}) };
    },
    commit(r, c, raw) {
      if (c === 0) return;
      const name = cols()[c], s = String(raw).trim();
      const v = s === '' ? '' : (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? +s : s);
      p.editRows(datasetId, (rows) => { rows[r][name] = v; });
    },
  };
}

export class TableView {
  constructor(project) {
    this.p = project; this.datasetId = null; this.grid = null;
    this.el = document.createElement('div'); this.el.className = 'wt-host';
    this.head = document.createElement('div'); this.head.className = 'wt-head';
    this.body = document.createElement('div'); this.body.className = 'wt-body';
    this.el.append(this.head, this.body);
    this._mute = false;
    project.on((e) => {
      if (!this.datasetId) return;
      if (e.type === 'dataset-removed' && e.id === this.datasetId) { this.show(null); return; }
      if (e.type === 'history') { if (!this.p.dataset(this.datasetId)) this.show(null); else { this.provider.refreshOrientations(); this._title(); this.grid?.refresh(); } return; }
      if (e.type === 'selection-changed' && !e.datasetId) { this.grid?.refresh(); return; }   // everything cleared
      const ds = e.datasetId || e.id;
      if (ds !== this.datasetId) return;
      if (e.type === 'rows-changed' || e.type === 'dataset-changed') { this.provider.refreshOrientations(); this._title(); }
      this.grid?.refresh();
    });
    this.show(null);
  }
  /** the theme changed: loom paints from a colour object, not from CSS */
  applyTheme() { this.grid?.setColors(this._colors()); }
  _colors() { return document.documentElement.dataset.resolvedTheme === 'light' ? LIGHT_COLORS : DARK_COLORS; }
  _title() {
    const d = this.datasetId && this.p.dataset(this.datasetId);
    this.head.textContent = d ? `${d.name} · ${d.kind} · ${d.rows.length} rows${d.meta?.read?.guessed ? ` · ${d.meta.read.why}` : ''}` : 'no dataset — click a layer or a dataset in the tree';
  }
  /** a picked measurement's row: the table shows its dataset and scrolls to it */
  reveal(datasetId, row) {
    if (this.datasetId !== datasetId) this.show(datasetId);
    if (this.grid && row >= 0) { try { this.grid.revealCell(row, 0); } catch { /* an older loom: shown, not scrolled */ } }
  }
  show(datasetId) {
    this.grid?.destroy(); this.grid = null;
    this.datasetId = datasetId && this.p.dataset(datasetId) ? datasetId : null;
    this._title();
    this.body.replaceChildren();
    if (!this.datasetId) return;
    this.provider = providerFor(this.p, this.datasetId);
    this.grid = createGrid(this.body, this.provider, { colors: this._colors() });
    this.grid.onSelect((sel) => {
      if (!sel || this._mute) return;
      const rows = []; for (let r = sel.r0; r <= sel.r1; r++) rows.push(r);
      this.p.select(this.datasetId, rows);
    });
  }
}
