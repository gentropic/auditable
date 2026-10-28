// lamina — the HOST API (window.lamina). A page that embeds lamina drives it
// through this surface, and only this one: small, versioned, documented
// (docs/index.html#api). micro's window.micro made the same promises first:
//   · version: changes within a major only ADD; a break is a new major;
//   · plain data out — a host never holds a live internal object;
//   · columns by NAME (case-insensitive, like the filter language);
//   · actions return promises that reject with the reason; getters are sync.
// lamina holds ONE table at a time, so v1's verbs act on the open table. When
// a second table arrives (the keyed compare view), an optional table id is an
// additive change.
//
// window._lamina stays what it is — the smokes' and the manual's reach into the
// app's internals, unstable by definition. This is a thin layer over the
// functions the UI itself calls (injected — they live in the app module), so the
// API and the UI can't drift apart.

export const API_VERSION = 1;

export function createHostApi(d) {
  const table = () => { const c = d.current(); if (!c) throw new Error('lamina: no table is open'); return c; };
  const colIndex = (c, name) => {
    if (typeof name === 'number' && c.schema[name]) return name;
    const k = String(name).toLowerCase();
    const i = c.schema.findIndex((s) => s.name.toLowerCase() === k);
    if (i < 0) throw new Error(`lamina: no column ${JSON.stringify(name)} — the columns are ${c.schema.map((s) => s.name).join(', ')}`);
    return i;
  };
  const formatOf = (c) => (c.d.dm ? 'dm' : c.d.parquet ? 'parquet' : c.d.xlsx ? 'xlsx' : c.d.kind === 'delimited' ? (c.d.delimiter === '\t' ? 'tsv' : 'csv') : c.d.kind);
  const view = (c) => c.view || c.baseVs;
  const info = () => {
    const c = d.current(); if (!c) return null;
    return {
      name: c.label, format: formatOf(c), bytes: c.totalBytes,
      rows: view(c).rowCount(), totalRows: c.baseVs.rowCount(),
      columns: c.schema.map((s) => s.name),
      filter: c.filterResult ? d.filterText() : '',
      sort: (c.sort || []).map((s) => ({ column: c.schema[s.col].name, desc: s.dir === 'desc' })),
    };
  };
  const column = (c, i) => {
    const s = c.schema[i], calc = s.calc ? (c.calcs || []).find((x) => x.name === s.name) : null;
    return {
      name: s.name, type: s.type === 'number' ? 'number' : 'string',
      hidden: c.hidden.has(i), format: c.colFormats[i] || null, width: c.colWidths[i] != null ? c.colWidths[i] : null,
      ...(calc ? { calc: true, expr: calc.expr } : {}),
    };
  };
  // a display field → plain data: a number column's numbers as Numbers, blank as null
  const value = (c, i, raw) => {
    if (raw == null || raw === '') return null;
    if (c.schema[i] && c.schema[i].type === 'number') { const x = d.parseNum(raw, c.d.decimal); return Number.isNaN(x) ? String(raw) : x; }
    return String(raw);
  };
  const recordOf = (vs, r) => (vs.rowHeaderAt ? vs.rowHeaderAt(r) - 1 : r);
  const verb = (fn) => async (...a) => fn(...a);
  const chrome = () => ({ title: !document.body.classList.contains('chrome-notitle') });

  let ready;
  const readyP = new Promise((res) => { ready = res; });

  const api = {
    version: API_VERSION,
    ready: readyP,

    // ── the table ──
    // open a File, Blob, FileSystemFileHandle or bytes as lamina opens a dropped
    // file (sniffed: CSV/TSV, .dm, Parquet, .xlsx, archives…). Resolves to info().
    open: verb(async (input, o = {}) => { await d.open(input, o); return info(); }),
    info,
    columns: () => { const c = table(); return c.schema.map((_, i) => column(c, i)); },
    setColumn: verb(async (name, o = {}) => {
      const c = table(), i = colIndex(c, name);
      if (o.type != null) { if (o.type !== 'number' && o.type !== 'string') throw new Error('lamina: type is "number" or "string"'); d.setColType(i, o.type); }
      if (o.format !== undefined) d.setColFormat(i, o.format || null);
      if (o.hidden != null) (o.hidden ? d.hideColumn : d.showColumn)(i);
      await d.settle();
      return column(d.current(), i);
    }),
    // the display order, by name; columns left out keep their order after these.
    // Resolves to the whole display order (hidden columns included).
    orderColumns: verb(async (names) => {
      const c = table();
      d.setColOrder(names.map((n) => colIndex(c, n)));
      return d.displayOrder().map((i) => d.current().schema[i].name);
    }),

    // ── reading: rows of the CURRENT view (filtered and sorted), with each row's
    // record number in the file (0-based) ──
    rows: verb(async (start = 0, count = 100, o = {}) => {
      const c = table(), vs = view(c), n = vs.rowCount();
      const idx = o.columns ? o.columns.map((x) => colIndex(c, x)) : c.schema.map((_, i) => i);
      const a = Math.max(0, start | 0), b = Math.min(n, a + Math.max(0, count | 0));
      const rows = [], records = [];
      for (let r = a; r < b; r++) {
        const f = await vs.ensureRow(r);
        if (d.current() !== c) throw new Error('lamina: the table changed while reading');
        rows.push(idx.map((i) => value(c, i, f && f[i])));
        records.push(recordOf(vs, r));
      }
      return { columns: idx.map((i) => c.schema[i].name), rows, records };
    }),
    row: verb(async (r) => {
      const c = table(), vs = view(c);
      if (!Number.isInteger(r) || r < 0 || r >= vs.rowCount()) throw new Error(`lamina: row ${r} is not in the view (0…${vs.rowCount() - 1})`);
      const f = await vs.ensureRow(r);
      const out = {}; c.schema.forEach((s, i) => { out[s.name] = value(c, i, f && f[i]); });
      return out;
    }),

    // ── the view ──
    filter: verb(async (expr) => {
      const c = table();
      if (!String(expr || '').trim()) { await d.applyFilter(''); return { matched: c.baseVs.rowCount(), total: c.baseVs.rowCount() }; }
      const err = d.checkExpr(expr, c.schema);
      if (err) throw new Error(`lamina: ${err}`);
      await d.applyFilter(expr);
      const e = d.filterError(); if (e) throw new Error(`lamina: ${e}`);
      const cc = d.current();
      return { matched: cc.filterResult ? cc.filterResult.nums.length : cc.baseVs.rowCount(), total: cc.baseVs.rowCount() };
    }),
    clearFilter: verb(async () => { table(); await d.applyFilter(''); }),
    // [{ column, desc }], most significant first; [] or null clears
    sort: verb(async (keys) => {
      const c = table();
      const ks = (keys || []).map((k) => ({ col: colIndex(c, typeof k === 'string' ? k : k.column), dir: k && k.desc ? 'desc' : 'asc' }));
      await d.setSort(ks.length ? ks : null);
      if (ks.length && !d.current().sort) throw new Error('lamina: the sort did not complete');
      return info().sort;
    }),
    // bring view row r (0-based) into sight and select it
    goto: verb((r) => { const c = table(); if (!Number.isInteger(r) || r < 0 || r >= view(c).rowCount()) throw new Error(`lamina: row ${r} is not in the view`); d.gotoRow(r + 1); }),
    selection: () => d.selection(),
    // { from, to, columns? } — view rows (inclusive) and column names (default: the first)
    select: verb(async (o) => {
      const c = table(), n = view(c).rowCount();
      const from = o.from | 0, to = o.to == null ? from : o.to | 0;
      if (from < 0 || to < from || to >= n) throw new Error(`lamina: rows ${from}…${to} are not in the view (0…${n - 1})`);
      const cols = (o.columns && o.columns.length ? o.columns : [c.schema[c._vis ? c._vis[0] : 0].name]).map((x) => colIndex(c, x));
      d.select(from, to, cols);
      return d.selection();
    }),

    // ── derived columns (never materialized; an @gcu/expr formula) ──
    addCalc: verb(async (name, expr) => {
      const c = table();
      if (!name || c.schema.some((s) => s.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`lamina: the name ${JSON.stringify(name)} is taken`);
      const err = d.checkExpr(expr, c.schema);
      if (err) throw new Error(`lamina: ${err}`);
      await d.addCalc(String(name), expr);
      const cc = d.current();
      return column(cc, colIndex(cc, name));
    }),
    removeCalc: verb(async (name) => {
      const c = table(), i = (c.calcs || []).findIndex((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (i < 0) throw new Error(`lamina: no calculated column ${JSON.stringify(name)}`);
      await d.removeCalc(i);
    }),

    // ── the whole view as data: the .lamina lens (filter · sort · calc columns ·
    // formats · hidden · order · widths), columns by name ──
    lens: () => { table(); return d.buildLens(); },
    applyLens: verb(async (lens) => {
      if (!lens || lens.kind !== 'lamina-lens') throw new Error('lamina: not a lens (kind must be "lamina-lens")');
      table();
      const skipped = await d.applyLens(lens);
      return { skipped: skipped || [] };
    }),

    // ── analysis: numbers, no window. Over the filtered rows when a filter is on. ──
    stats: verb((name, o = {}) => { const c = table(); return d.columnStats(colIndex(c, name), o); }),
    groupBy: verb(async ({ by, values, weight } = {}) => {
      const c = table();
      const g = colIndex(c, by), vs = (values || []).map((v) => colIndex(c, v)), w = weight != null ? colIndex(c, weight) : null;
      if (!vs.length) throw new Error('lamina: groupBy needs values: [column, …]');
      const res = await d.groupBy(g, vs, w);
      const named = (acc) => ({ count: acc.count, values: Object.fromEntries(acc.vars.map((v, k) => [c.schema[vs[k]].name, v])) });
      return { by: c.schema[g].name, groups: res.groups.map((x) => ({ key: x.key, ...named(x) })), total: named(res.total), truncated: res.truncated };
    }),
    // tonnes = volume × density × proportion per row (each an expression: a column,
    // a constant, dx*dy*dz…); densityUnit declares the density's unit (→ t/m³)
    gradeTonnage: verb(async ({ by = null, grades, volume = '1', density = '1', proportion = '1', densityUnit = 't/m3' } = {}) => {
      const c = table();
      const gs = (grades || []).map((x) => colIndex(c, x));
      if (!gs.length) throw new Error('lamina: gradeTonnage needs grades: [column, …]');
      const g = by != null ? colIndex(c, by) : null;
      const res = await d.gradeTonnage({ group: g, grades: gs, volume, density, proportion, densityUnit });
      const named = (a) => ({ count: a.count, tonnes: a.tonnes, grades: Object.fromEntries(a.grades.map((x, k) => [c.schema[gs[k]].name, x])) });
      return { by: g != null ? c.schema[g].name : null, groups: res.groups.map((x) => ({ key: x.key, ...named(x) })), total: named(res.total), truncated: res.truncated };
    }),

    // ── export: the current view (or every row) as CSV/TSV. A Blob, or streamed to
    // a WritableStream you pass as `to` (resolves to { rows }) for big extracts ──
    export: verb(async (o = {}) => {
      const c = table();
      const delimiter = o.format === 'tsv' ? '\t' : ',';
      const colIdx = o.columns ? o.columns.map((x) => colIndex(c, x)) : null;
      const opts = { delimiter, header: o.header !== false, allRows: !!o.allRows, colIdx };
      if (o.to) {
        const w = o.to.getWriter(); const enc = new TextEncoder();
        const rows = await d.runExport({ ...opts, sink: { write: (t) => w.write(enc.encode(t)), close: () => w.close() } });
        return { rows };
      }
      const text = await d.exportToString(opts);
      return new Blob([text], { type: delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv' });
    }),

    // ── chrome: lamina's title (?embed=1 hides it from the first paint) ──
    chrome,
    setChrome: verb((o = {}) => {
      if (o.title != null) document.body.classList.toggle('chrome-notitle', !o.title);
      return chrome();
    }),
  };

  // events, on lamina's window: lamina:ready, lamina:opened, lamina:open-failed,
  // lamina:filter, lamina:selection
  const fire = (name, detail) => dispatchEvent(new CustomEvent('lamina:' + name, { detail }));
  const announce = () => {
    ready(api);
    fire('ready', { version: API_VERSION });
    try { if (window.frameElement) window.frameElement.dispatchEvent(new CustomEvent('lamina:ready', { detail: { version: API_VERSION } })); } catch { /* cross-origin host */ }
  };
  return { api, announce, fire, info };
}
