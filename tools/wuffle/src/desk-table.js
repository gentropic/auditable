// wuffle desk — the table: one dataset in a @gcu/loom grid. Its rows ARE the data: an edit goes through the
// model (every net redraws), rows selected anywhere wear loom's brushing wash here, and selecting rows
// here selects them everywhere. A read-only first column shows the attitude wuffle read from the row.

import { createGrid, CellState, CellType, DARK_COLORS, LIGHT_COLORS } from '../../../ext/loom/index.js';
import { orientations } from './io.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { Dialog } from '../../../ext/dialog/index.js';
import { checkExpr, schemaOf } from './calc.js';

function providerFor(p, datasetId) {
  const ds = () => p.dataset(datasetId);
  let o = orientations(ds());
  const refresh = () => { o = orientations(ds()); };
  const isTable = () => ds().kind === 'table';
  const cols = () => (isTable() ? [...ds().columns] : ['attitude', ...ds().columns]);   // a table has no attitude column
  return {
    refreshOrientations: refresh,
    dims: () => ({ rows: ds().rows.length, cols: cols().length }),
    // a calculated column says so in its header (ƒ), its formula in the tooltip
    header: (c) => (c === 0 && !isTable() ? { label: ds().kind === 'lines' ? 'trend→plunge' : ds().kind === 'smallcircles' ? 'axis trend→plunge' : 'dip dir/dip' } : (() => { const f = ((ds().meta && ds().meta.calc) || []).find((x) => x.name === cols()[c]); return f ? { label: `ƒ ${cols()[c]}`, title: `${cols()[c]} = ${f.expr}` } : { label: cols()[c] }; })()),
    cellAt(r, c) {
      // (a grid that drew a longer dataset a moment ago may still ask for a row that is gone: no row, no cell)
      const d = ds(); if (!d || r >= d.rows.length || !d.rows[r]) return null;
      const hi = p.selection.get(datasetId)?.has(r) ? { highlight: true } : undefined;
      if (c === 0 && !isTable()) {
        const x = o[r];
        const text = !x ? '—' : x.plane ? formatPlane(x.plane) : formatLine(x.line);
        return { value: text, state: x ? CellState.DERIVED : CellState.ERROR, type: CellType.STRING, style: { ...(hi || {}), text } };
      }
      const v = d.rows[r][cols()[c]];
      return { value: v === '' ? null : v, state: CellState.RAW, type: typeof v === 'number' ? CellType.NUMBER : CellType.STRING, ...(hi ? { style: hi } : {}) };
    },
    commit(r, c, raw) {
      if (c === 0 && !isTable()) return;
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
    const txt = document.createElement('span');
    txt.textContent = d ? `${d.name} · ${d.kind} · ${d.rows.length} rows${d.meta?.read?.guessed ? ` · ${d.meta.read.why}` : ''}` : 'no dataset — click a layer or a dataset in the tree';
    this.head.replaceChildren(txt);
    if (!d) return;
    const fx = document.createElement('button'); fx.type = 'button'; fx.className = 'wt-calc'; fx.textContent = 'ƒ new column';
    fx.title = 'a calculated column: a formula over the row (its columns, and dip, dipdir, strike, pole_trend, trend, plunge, rake), kept with the data and made again when the rows change';
    fx.onclick = () => this.calcDialog();
    this.head.append(fx);
  }
  /** ƒ: name + expression, checked as you type (the console's calc, without the shell's quoting) */
  async calcDialog(prefill = {}) {
    const p = this.p, id = this.datasetId, d = p.dataset(id); if (!d) return null;
    const res = await new Dialog({
      title: `${d.name} · calculated column`, width: 460,
      render(body, ctx) {
        const h = (t, cls, text) => { const e = document.createElement(t); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        const nm = h('input'); nm.value = prefill.name || ''; nm.placeholder = 'name'; nm.className = 'wt-calc-name';
        const ex = h('textarea'); ex.rows = 3; ex.value = prefill.expr || ''; ex.placeholder = "if(dip > 60, 'steep', 'shallow')"; ex.className = 'wt-calc-expr'; ex.spellcheck = false;
        const msg = h('div', 'wpnote', `columns: ${schemaOf(d).join(', ')}`);
        const ok = h('button', 'primary', 'Add'); ok.type = 'button'; ok.dataset.default = 'true';
        const cancel = h('button', null, 'Cancel'); cancel.type = 'button';
        const check = () => { const e = ex.value.trim() ? checkExpr({ ...d, columns: d.columns.filter((c) => c !== nm.value.trim()) }, ex.value) : 'write an expression'; msg.textContent = e || `columns: ${schemaOf(d).join(', ')}`; msg.classList.toggle('bad', !!e && !!ex.value.trim()); ok.disabled = !!e || !nm.value.trim(); };
        nm.oninput = ex.oninput = check;
        const bar = h('div', 'wpbar'); bar.append(cancel, ok);
        body.append(h('label', 'wprow'), nm, ex, msg, bar);
        body.firstChild.append(h('span', null, 'name'));
        cancel.onclick = () => ctx.close(null);
        ok.onclick = () => ctx.close({ name: nm.value.trim(), expr: ex.value.trim() });
        check(); setTimeout(() => (prefill.name ? ex : nm).focus(), 0);
      },
    }).show();
    if (!res) return null;
    try { p.setCalc(id, res.name, res.expr); return res; } catch (e) { this.head.title = e.message; return null; }
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
