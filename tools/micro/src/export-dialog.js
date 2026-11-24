// micro — the export dialog: what to write (format, columns, the selection or the filter,
// compression) for one layer, and the default file name. The writing is src/export.js; the app
// wires the buttons.
import { S, activeLayer, layerById } from './state.js';
import { attrRowCountOf, layerTableHeader, rowQualifier } from './records.js';
import { exportColumnsOf, latticeConstantsOf, runExport } from './export.js';
const fmtBytes = (b) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const $ = (s) => document.querySelector(s);

// ── the export dialog ──
export let _exDlg = null;

export function openExportDialog(L0) {
  const layers = S.layers.filter((L) => layerTableHeader(L));
  if (!layers.length) { $('#meta').textContent = 'export: no table-backed layers (blocks or drillholes)'; return; }
  const L = L0 && layerTableHeader(L0) ? L0 : (activeLayer() && layerTableHeader(activeLayer()) ? activeLayer() : layers[0]);
  _exDlg = { lid: L.id, scope: 'all', off: new Set(), delim: ',', dec: false, name: null, format: 'csv', codec: 'SNAPPY', spatialSort: true, qual: false };
  renderExportDialog();
  $('#exDlg').classList.add('show');
}

export function exDefaultName(L, format = 'csv') {
  const base = (L.label || L.name).replace(/\.[^.]+$/, '').replace(/[^\wÀ-ɏ .-]+/g, '_');
  return `${base}_export.${format === 'parquet' ? 'parquet' : 'csv'}`;
}

export function renderExportDialog() {
  const d = _exDlg; if (!d) return;
  const L = layerById(d.lid); if (!L) return;
  const body = $('#exDlgBody');
  body.textContent = '';
  const mkRow2 = (label, ...els) => {
    const row = document.createElement('div'); row.className = 'ex-row';
    const b2 = document.createElement('b'); b2.textContent = label;
    row.append(b2, ...els);
    body.appendChild(row);
    return row;
  };
  // layer
  const lSel = document.createElement('select');
  for (const L2 of S.layers.filter((x) => layerTableHeader(x))) {
    const o = document.createElement('option'); o.value = String(L2.id); o.textContent = L2.label || L2.name; lSel.appendChild(o);
  }
  lSel.value = String(d.lid);
  lSel.onchange = () => { d.lid = +lSel.value; d.off = new Set(); d.name = null; d.q = ''; renderExportDialog(); };
  mkRow2('layer', lSel);
  // scope (counts shown live; absent scopes disabled)
  const total = attrRowCountOf(L);
  let fN = 0; if (L._filterMask) for (let i = 0; i < L._filterMask.length; i++) fN += L._filterMask[i];
  let sN = 0; if (L._selMask) for (let i = 0; i < L._selMask.length; i++) sN += L._selMask[i];
  if ((d.scope === 'matches' && !fN) || (d.scope === 'selection' && !sN)) d.scope = 'all';
  const scopeRow = mkRow2('rows');
  for (const [key, label, n, on] of [['all', 'all', total, true], ['matches', 'filter matches', fN, fN > 0], ['selection', 'selection', sN, sN > 0]]) {
    const lab = document.createElement('label');
    if (!on) lab.className = 'dis';
    const r2 = document.createElement('input'); r2.type = 'radio'; r2.name = 'exscope';
    r2.checked = d.scope === key; r2.disabled = !on;
    r2.onchange = () => { d.scope = key; };
    lab.append(r2, `${label} (${n.toLocaleString()})`);
    scopeRow.appendChild(lab);
  }
  // columns — searchable (block models carry 50+ columns; the lamina lesson);
  // all/none act on whatever the search currently shows. The grid rebuilds
  // LOCALLY so typing in the search box never loses focus.
  const cols = exportColumnsOf(L);
  const search = document.createElement('input'); search.type = 'text'; search.placeholder = 'search…';
  search.value = d.q || '';
  search.style.maxWidth = '150px';
  mkRow2('columns', search);
  const links = document.createElement('div'); links.className = 'ex-links';
  const allA = document.createElement('a'), noneA = document.createElement('a');
  const tally = document.createElement('span'); tally.style.color = 'var(--muted)';
  links.append(allA, noneA, tally);
  body.appendChild(links);
  const grid = document.createElement('div'); grid.className = 'ex-cols';
  body.appendChild(grid);
  let shown = [];
  const rebuildCols = () => {
    const q = (d.q || '').toLowerCase();
    shown = cols.map((_, i) => i).filter((i) => !q || cols[i].name.toLowerCase().includes(q));
    allA.textContent = q ? 'all shown' : 'all';
    noneA.textContent = q ? 'none shown' : 'none';
    const live = cols.filter((c) => !c.stale).length;
    tally.textContent = `${cols.filter((c, i) => !c.stale && !d.off.has(i)).length} of ${live} picked${q ? ` · ${shown.length} shown` : ''}`;
    grid.textContent = '';
    for (const i of shown) {
      const c = cols[i];
      const lab = document.createElement('label');
      const cb2 = document.createElement('input'); cb2.type = 'checkbox'; cb2.checked = !d.off.has(i) && !c.stale;
      if (c.stale) { cb2.disabled = true; lab.className = 'dis'; lab.title = c.stale; lab.appendChild(cb2); lab.append(`${c.name} (not exported)`); grid.appendChild(lab); continue; }
      cb2.onchange = () => { if (cb2.checked) d.off.delete(i); else d.off.add(i); rebuildCols(); };
      lab.appendChild(cb2);
      if (c.badge) { const b3 = document.createElement('span'); b3.className = 'bdg'; b3.textContent = c.badge; lab.appendChild(b3); }
      lab.append(c.name);
      lab.title = c.name;
      grid.appendChild(lab);
    }
    if (!shown.length) { const none = document.createElement('span'); none.style.color = 'var(--muted)'; none.textContent = 'no columns match'; grid.appendChild(none); }
  };
  search.oninput = () => { d.q = search.value; rebuildCols(); };
  allA.onclick = () => { for (const i of shown) d.off.delete(i); rebuildCols(); };
  noneA.onclick = () => { for (const i of shown) d.off.add(i); rebuildCols(); };
  rebuildCols();
  // format: CSV (text) or Parquet (columnar, compressed)
  const fRow = mkRow2('as');
  for (const [k, lab] of [['csv', 'CSV'], ['parquet', 'Parquet']]) {
    const l = document.createElement('label'); const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'exfmt'; rb.checked = d.format === k;
    rb.onchange = () => { d.format = k; d.name = null; renderExportDialog(); };
    l.append(rb, lab); fRow.appendChild(l);
  }
  if (d.format === 'parquet') {
    const cSel = document.createElement('select');
    for (const [v, t] of [['SNAPPY', 'snappy (fast)'], ['GZIP', 'gzip (smaller)'], ['UNCOMPRESSED', 'none']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; cSel.appendChild(o); }
    cSel.value = d.codec; cSel.onchange = () => { d.codec = cSel.value; };
    const ssLab = document.createElement('label');
    const ssCb = document.createElement('input'); ssCb.type = 'checkbox'; ssCb.checked = d.spatialSort;
    ssCb.onchange = () => { d.spatialSort = ssCb.checked; };
    ssLab.append(ssCb, 'spatial sort');
    ssLab.title = 'Morton-order by centroid → the footer becomes a 3D spatial index (skip row groups outside a solid/section on eval)';
    mkRow2('compression', cSel, ssLab);
  } else {
    const dSel = document.createElement('select');
    for (const [v, t] of [[',', 'comma ,'], [';', 'semicolon ;'], ['tab', 'tab']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; dSel.appendChild(o); }
    dSel.value = d.delim; dSel.onchange = () => { d.delim = dSel.value; };
    const decLab = document.createElement('label');
    const decCb = document.createElement('input'); decCb.type = 'checkbox'; decCb.checked = d.dec;
    decCb.onchange = () => { d.dec = decCb.checked; };
    decLab.append(decCb, 'decimal comma');
    decLab.title = 'write 61,4 instead of 61.4 in numeric columns (pt-BR Excel)';
    mkRow2('delimiter', dSel, decLab);
    if (rowQualifier(L)) {                                 // a CSV / drillhole layer: <0.001 can be written as read or as substituted
      const qLab = document.createElement('label');
      const qCb = document.createElement('input'); qCb.type = 'checkbox'; qCb.checked = d.qual;
      qCb.onchange = () => { d.qual = qCb.checked; };
      qLab.append(qCb, 'write <x / >x as their substitutes');
      qLab.title = 'off: values leave as the file had them (<0.001). On: as micro reads them (each column’s detection-limit rule, e.g. 0.0005; lab codes blank)';
      mkRow2('detection limits', qLab);
    }
  }
  // the lattice: a block model on one travels with the file — Parquet in its footer
  // (always), CSV in a `# micro:model` comment line (on by default); and, for packages
  // that read neither, as constant columns on every row (off — it costs every row)
  const th = layerTableHeader(L);
  if (th && th.grid) {
    const lc = latticeConstantsOf(th);
    const els = [];
    if (d.format !== 'parquet') {
      const hLab = document.createElement('label');
      const hCb = document.createElement('input'); hCb.type = 'checkbox'; hCb.checked = d.latHdr !== false;
      hCb.onchange = () => { d.latHdr = hCb.checked; };
      hLab.append(hCb, '# micro:model header');
      hLab.title = 'one comment line above the header row stating the lattice (frame, rotation, pitch, size columns): micro reopens the file as the same boxes, checked against every row; other readers skip # lines (pandas: comment="#")';
      els.push(hLab);
    }
    if (lc && lc.cols.length) {
      const cLab = document.createElement('label');
      const cCb = document.createElement('input'); cCb.type = 'checkbox'; cCb.checked = !!d.latCols;
      const rows = attrRowCountOf(L) || 0;
      // ~ the text each row gains: the constants as written, ~14 characters per local coordinate
      const perRow = lc.cols.reduce((a, c) => a + 1 + (c.local != null ? 14 : String(c.value).length), 0);
      const cost = d.format === 'parquet'
        ? `+${lc.cols.length} columns; the constants compress to almost nothing in Parquet${lc.cols.some((c) => c.local != null) ? ', the local XL/YL/ZL cost 3 numbers a row' : ''}`
        : `+${lc.cols.length} columns on every row ≈ ${perRow} bytes × ${rows.toLocaleString()} rows ≈ ${fmtBytes(perRow * rows)}`;
      cCb.onchange = () => { d.latCols = cCb.checked; };
      cLab.append(cCb, 'lattice as columns');
      cLab.title = `Datamine-style: ${lc.cols.map((c) => c.name).join(' ')} written on every row (world = X0/Y0/Z0 + ANGLE1 about Z · XL/YL/ZL) — for a package that reads neither micro:model carrier. ${cost}.${lc.note ? ' ' + lc.note + '.' : ''}`;
      const costEl = document.createElement('span'); costEl.style.color = 'var(--muted)'; costEl.textContent = cost;
      els.push(cLab, costEl);
    }
    if (els.length) mkRow2('lattice', ...els);
  }
  // filename
  const nameIn = document.createElement('input'); nameIn.type = 'text';
  nameIn.value = d.name != null ? d.name : exDefaultName(L, d.format);
  nameIn.onchange = () => { d.name = nameIn.value; };
  mkRow2('file', nameIn);
  $('#exDlgMsg').textContent = '';
}

export function exCancel() { $('#exDlg').classList.remove('show'); _exDlg = null; }

export async function exGo() {
  const d = _exDlg; if (!d) return;
  const L = layerById(d.lid); if (!L) return;
  const cols = exportColumnsOf(L);
  const colIdx = cols.map((_, i) => i).filter((i) => !d.off.has(i) && !cols[i].stale);
  if (!colIdx.length) { $('#exDlgMsg').textContent = 'pick at least one column'; return; }
  const btn = $('#exGo');
  btn.disabled = true;
  $('#exDlgMsg').textContent = 'sweeping…';
  try {
    const n = await runExport(L, { scope: d.scope, colIdx, delim: d.delim, decimalComma: d.dec, format: d.format, codec: d.codec, spatialSort: d.spatialSort, qualified: d.qual, latticeHeader: d.latHdr !== false, latticeColumns: !!d.latCols, filename: (d.name || exDefaultName(L, d.format)).trim() || exDefaultName(L, d.format) });
    if (n >= 0) { $('#exDlg').classList.remove('show'); _exDlg = null; }
  } finally { btn.disabled = false; }
}
