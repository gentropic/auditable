// micro — TABLES without positions: a delimited file or an Excel workbook (pick the
// sheets) opened as a plain table layer, for joins and reference data.
import { S, layerById } from './state.js';
import { openTable } from '../../../ext/condenser/src/main.js';
import { createLayerGroup } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { openSheet as xlsxOpenSheet, census as xlsxCensus } from '../../../ext/sheet/index.js';
import { basename } from './paths.js';
import { openBlob } from './open.js';
import { floatWin } from './windows.js';
const $ = (s) => document.querySelector(s);

// Block-model path (.csv etc.): two-sweep provider → regular grid → box impostors.
// Not a regular grid → the points pipeline still shows the centroids.
// ── the TABLE kind: a tabular layer with NO geometry ─────────────────────────
// A join source, a routine's parameter table, a cut-off / density lookup, an
// analysis result. It lives in the layer list, opens an attribute table, filters
// with @gcu/expr, takes calc columns, and exports — but it has no bbox, draws
// nothing, and never enters the 3D budget. Everything spatial is gated off it by
// the absence of a mapping (gridAxesOf → null, so GT/swath never
// offer it) rather than by scattered kind checks.
export async function openTableBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading table…`;
  const { header } = await openTable(blob);
  const L = layerById(lid);
  if (!L) return;
  L.kind = 'table';
  L.docs = { tableDoc: { blob, name, header, metaLine: '' } };
  L.bboxLocal = null;                                      // no geometry — nothing to fit, nothing to draw
  const line = `${name} — ${header.count.toLocaleString()} rows · ${header.columns.length} columns · table (no coordinates)`;
  L.docs.tableDoc.metaLine = line;
  $('#meta').textContent = line;
  renderLayers();
}
// ── Excel: a worksheet opens as a TABLE, always ──────────────────────────────
// @gcu/sheet resolves a sheet into typed columns (Excel's own types — numbers,
// dates, booleans), and `openSheet` hands that over as a table document. No CSV
// in the middle, nothing re-sniffed. Geometry is NEVER inferred from a
// spreadsheet: a sheet with columns called X/Y/Z might be a block model or a
// table about something else entirely, so promoting one is the user's explicit
// act ("Interpret as…" on the layer), not ours.
export async function openXlsxBlob(blob, name, opts = {}) {
  const lid = opts.layer != null ? opts.layer : S.activeId;
  $('#meta').textContent = `${name} — reading workbook…`;
  const doc = await xlsxOpenSheet(blob, { sheet: opts.sheet || null });
  const L = layerById(lid);
  if (!L) return;
  L.kind = 'table';
  L.docs = { tableDoc: { blob, name, header: doc.header, metaLine: '', xlsx: doc, sheet: doc.header.sheet } };
  L.bboxLocal = null;
  L._sheet = doc.header.sheet;                             // the manifest reopens THIS sheet
  if (!L.label || L.label === L.name) L.label = `${basename(name).replace(/\.xlsx$/i, '')} · ${doc.header.sheet}`;
  const line = `${name} · ${doc.header.sheet} — ${doc.header.count.toLocaleString()} rows · ${doc.header.columns.length} columns · table`;
  L.docs.tableDoc.metaLine = line;
  $('#meta').textContent = line;
  renderLayers();
}
// open a workbook: one sheet, several, or all of them (a group per workbook)
export async function openWorkbook(blob, name, mode = 'add') {
  let cs;
  try { cs = await xlsxCensus(blob); } catch (e) { $('#meta').textContent = `${name} — ${e.message}`; return; }
  const sheets = cs.sheets.filter((sh) => !sh.empty);
  if (!sheets.length) { $('#meta').textContent = `${name} — no sheets with data`; return; }
  if (sheets.length === 1) { await openBlob(blob, name, mode, null, { sheet: sheets[0].name }); return; }
  const picked = await pickSheets(name, sheets);
  if (!picked || !picked.length) return;
  const ids = [];
  for (let i = 0; i < picked.length; i++) {
    const _got = await openBlob(blob, name, i === 0 ? mode : 'add', null, { sheet: picked[i] });
    const L = layerById(_got);
    if (L) ids.push(L.id);
  }
  if (ids.length > 1) createLayerGroup(basename(name), ids, { collapsed: false });   // the workbook IS the group
  $('#meta').textContent = `${name} — ${ids.length} sheet${ids.length === 1 ? '' : 's'} opened as table${ids.length === 1 ? '' : 's'}`;
}
// the sheet picker: which sheets to open (all, by default)
function pickSheets(name, sheets) {
  return new Promise((res) => {
    const win = floatWin({ title: `sheets · ${basename(name)}`, sub: `${sheets.length} sheets`, x: innerWidth / 2 - 200, y: innerHeight / 3, w: 400, h: Math.min(150 + sheets.length * 24, innerHeight - 140) });
    win.body.className += ' rw-body';
    const boxes = sheets.map((sh) => {
      const row = document.createElement('label');
      row.className = 'rw-bar';
      row.style.cursor = 'pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      const nm = document.createElement('span'); nm.style.flex = '1'; nm.textContent = sh.name;
      const n = document.createElement('span'); n.className = 'lbl';
      n.textContent = `${sh.rows.toLocaleString()} rows · ${sh.columns} cols`;
      row.append(cb, nm, n);
      win.body.appendChild(row);
      return { cb, name: sh.name };
    });
    const bar = document.createElement('div'); bar.className = 'rw-bar'; bar.style.marginTop = '8px';
    const note = document.createElement('span'); note.className = 'lbl'; note.style.flex = '1';
    note.textContent = 'sheets open as tables';
    const ok = document.createElement('button'); ok.className = 'awin-btn btn-p'; ok.textContent = 'Open';
    const cancel = document.createElement('button'); cancel.className = 'awin-btn'; cancel.textContent = 'Cancel';
    bar.append(note, cancel, ok);
    win.body.appendChild(bar);
    let done = false;
    const finish = (v) => { if (done) return; done = true; win.close(); res(v); };
    ok.onclick = () => finish(boxes.filter((b) => b.cb.checked).map((b) => b.name));
    cancel.onclick = () => finish(null);
    win.el._onClose = () => finish(null);
  });
}
