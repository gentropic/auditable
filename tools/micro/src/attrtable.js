// the attribute table: one window per layer over its records (filter, sort, selection, reveal)
import { floatWin, focusWindow, nextZ } from './windows.js';
import { attrColumnsOf, attrRowCountOf, extendRow, fetchLayerRow } from './records.js';
import { PENDING, createGrid } from '../../../ext/loom/index.js';
import { S, requestRender } from './state.js';
import { emitPick, showRecord } from './pick.js';
const $ = (s) => document.querySelector(s);

export const _attrTables = new Map();                             // layerId → { win, grid, view }

// (fetchLayerRow / attrColumnsOf / the LOCATIONS vocabulary — primaryLocationOf,
// locationsOf, attrRowCountOf, hasRecords — live in src/records.js)
export function openAttrTable(L) {
  if (_attrTables.has(L.id)) { const t2 = _attrTables.get(L.id); focusWindow(t2.win.el); return; }
  const cols = attrColumnsOf(L);
  if (!cols) { $('#meta').textContent = 'no table behind this layer'; return; }
  const total = attrRowCountOf(L);
  const view = { matches: null, only: false };
  const cache = new Map();                                 // rec → extended fields
  const queue = new Set();
  let fetching = false, readyCbs = [];
  const notify = () => { for (const cb of readyCbs) { try { cb(); } catch { /* gone */ } } };
  const pump = async () => {
    if (fetching) return;
    fetching = true;
    while (queue.size) {
      const batch = [...queue].slice(0, 300);
      for (const r of batch) queue.delete(r);
      for (const r of batch) {
        if (cache.has(r)) continue;
        try { cache.set(r, extendRow(L, await fetchLayerRow(L, r), r) || []); }
        catch { cache.set(r, []); }
      }
      if (cache.size > 6000) { const it = cache.keys(); for (let i = 0; i < 2000; i++) cache.delete(it.next().value); }
      notify();
      await new Promise((r2) => setTimeout(r2));
    }
    fetching = false;
  };
  const recOf = (r) => (view.matches ? view.matches[r] : r);
  const provider = {
    dims: () => ({ rows: view.matches ? view.matches.length : total, cols: cols.length }),
    header: (c) => ({ label: cols[c].name }),
    rowHeader: (r) => String(recOf(r)),
    cellAt(r, c) {
      const rec = recOf(r);
      const row = cache.get(rec);
      if (row === undefined) { queue.add(rec); pump(); return PENDING; }
      const v = row[c];
      if (v == null || v === '') return null;
      return { value: v, type: cols[c].num ? 'number' : 'text' };
    },
    onReady(cb) { readyCbs.push(cb); return () => { readyCbs = readyCbs.filter((x) => x !== cb); }; },
  };
  const win = floatWin({
    title: `table · ${L.label || L.name}`,
    sub: `${total.toLocaleString()} rows`,
    x: 80 + (_attrTables.size % 4) * 36, y: 80 + (_attrTables.size % 4) * 30,
    w: Math.min(innerWidth - 120, 880),
    onClose: () => { grid.destroy(); _attrTables.delete(L.id); },
  });
  // view toggles: 'matches' rides the retained filter mask, 'selected' the
  // §15 selection mask — mutually exclusive (a view, not a query language)
  const mkToggle = (label2, title2) => {
    const lab = document.createElement('label');
    const cb2 = document.createElement('input'); cb2.type = 'checkbox';
    lab.append(cb2, ' ' + label2);
    lab.title = title2;
    win.head.insertBefore(lab, win.head.querySelector('button'));
    return cb2;
  };
  const oc = mkToggle('matches', 'show only rows matching the current filter');
  const sc = mkToggle('selected', 'show only selected rows (r / v to select in the scene)');
  const rebuildView = () => {
    const src = sc.checked ? L._selMask : oc.checked ? L._filterMask : null;
    if (src) {
      const out = [];
      for (let i = 0; i < src.length; i++) if (src[i]) out.push(i);
      view.matches = Uint32Array.from(out);
    } else view.matches = null;
    win.sub.textContent = `${(view.matches ? view.matches.length : total).toLocaleString()} rows${view.matches ? ` of ${total.toLocaleString()}` : ''}`;
    grid.refresh();
  };
  oc.onchange = () => { if (oc.checked) sc.checked = false; rebuildView(); };
  sc.onchange = () => { if (sc.checked) oc.checked = false; rebuildView(); };
  const grid = createGrid(win.body, provider, { readOnly: true, defaultColW: 96, rowH: 22, hdrH: 22, rowHdrW: 64, fontPx: 12 });
  win.el._onResized = () => grid.refresh();
  let syncing = false;
  grid.onSelect((sel) => {
    if (syncing || !sel) return;                           // loom sel = {r0,c0,r1,c1}
    const rec = recOf(sel.r0);
    if (rec == null) return;
    S.renderer.setPicked({ layer: L.id, rec });
    showRecord({ layer: L.id, rec });
    requestRender();
    emitPick({ layer: L.id, rec }, 'table');
  });
  _attrTables.set(L.id, {
    win, grid, view,
    revealRec(rec) {
      let row = rec;
      if (view.matches) {
        let lo2 = 0, hi2 = view.matches.length - 1, at = -1;
        while (lo2 <= hi2) { const mid = (lo2 + hi2) >> 1; if (view.matches[mid] === rec) { at = mid; break; } if (view.matches[mid] < rec) lo2 = mid + 1; else hi2 = mid - 1; }
        if (at < 0) return;
        row = at;
      }
      syncing = true;
      grid.setSelection({ r0: row, c0: 0, r1: row, c1: cols.length - 1 });
      grid.revealCell(row, 0);
      syncing = false;
      win.el.style.zIndex = nextZ();
    },
    filterChanged() { if (oc.checked) rebuildView(); },
    selChanged() { if (sc.checked) rebuildView(); },
    invalidate() { cache.clear(); grid.refresh(); },       // painted values changed under the cache
    close: () => win.close(),
  });
  rebuildView();
}

export function attrTableFilterChanged(lid) { const t2 = _attrTables.get(lid); if (t2) t2.filterChanged(); }

export function attrTableSelChanged(lid) { const t2 = _attrTables.get(lid); if (t2 && t2.selChanged) t2.selChanged(); }

export function closeAttrTable(lid) { const t2 = _attrTables.get(lid); if (t2) t2.close(); }

// (fetchCsvRecord lives in src/records.js)
export function attrTableReveal(lid, rec) { const t2 = _attrTables.get(lid); if (t2) t2.revealRec(rec); }
