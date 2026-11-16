// micro — what a project save does to the data first, each behind a one-time
// remembered confirm: optimize block models to spatial (Morton-sorted) Parquet, and pack
// meshes into .wfr. Also the Optimize dialog a layer menu opens.
import { layerTableHeader, layerBlob } from './records.js';
import { fmtSize, layerFiles } from './paths.js';
import { S, _fileHandles, requestRender } from './state.js';
import { convertLayerToParquet } from './export.js';
import { wfrExportable } from './meshexport.js';
import { isWfrName } from './wfr-io.js';
import { baseName as wfrBase, handleSink, packLayers } from './wfr-write.js';
import { openWfrFile } from './open-mesh.js';
import { mkLineage } from './lineage.js';
import { applyCatLegend } from './categories.js';
import { recomputeUnion } from './layers.js';
import { renderLayers } from './layers-panel.js';
import { markProjectDirty } from './project.js';
import { microChoose } from './prompts.js';
import { holdStoredValues } from './columns.js';
import { persistElement } from './element-store.js';
const $ = (s) => document.querySelector(s);

// "Parquet is the project store": on save, non-Parquet block models get
// reordered to Morton-sorted spatial Parquet (the same in-place op as the
// layer-menu "Optimize to spatial Parquet"), behind a one-time remembered
// confirm. Painting stays editable. The manual menu action is the per-layer
// escape hatch; the remembered choice is resettable from Tools → Settings.
export let _autoOptimize = (() => { try { return localStorage.getItem('micro.autoOptimize'); } catch { return null; } })();   // 'on' | 'off' | null (unasked)
export function setAutoOptimize(v) { _autoOptimize = v; try { if (v == null) localStorage.removeItem('micro.autoOptimize'); else localStorage.setItem('micro.autoOptimize', v); } catch { /* private mode */ } }   // null = ask again
let _autoOptimizeSkip = false;
// auto-optimize-on-save leaves models above this for an EXPLICIT conversion
// (the layer menu): the external sort has no memory ceiling, but rewriting a
// multi-GB file in the middle of a save is a surprise nobody wants.
const OPTIMIZE_MAX_BLOCKS = 8_000_000;
// the EXPLICIT conversion dialog (less magic): per-layer rows naming the path
// it will take (Morton-sorted vs streamed file-order), a VISIBLE keep-original
// choice (orphan removal used to be silent), and the auto-on-save preference
// set where its meaning is in front of you. Resolves { layers, keepOriginal,
// auto } or null (Not now / ×).
export function openOptimizeDialog(cands, { fromSave = false } = {}) {
  return new Promise((resolve) => {
    const body = $('#opDlgBody'); body.textContent = '';
    const rows = cands.map((L) => {
      const h = layerTableHeader(L), big = h.count > OPTIMIZE_MAX_BLOCKS;
      const row = document.createElement('div'); row.className = 'op-row';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = L.label || L.name;
      const d = document.createElement('span'); d.className = 'd'; d.textContent = `${fmtSize(layerBlob(L) ? layerBlob(L).size : 0)} · ${h.count.toLocaleString()} blocks`;
      const path = document.createElement('span'); path.className = 'path'; path.textContent = '→ Morton-sorted (spatial index)';
      path.title = `reordered on the Morton curve — the footer becomes a 3D spatial index${big ? '. A big model: sorted externally in bounded memory, which takes a while' : ''}`;
      row.append(cb, nm, d, path); body.append(row);
      return { L, cb };
    });
    const opts = document.createElement('div'); opts.className = 'op-opts';
    const mkOpt = (label, checked, title) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked; if (title) l.title = title; l.append(c, document.createTextNode(label)); opts.append(l); return c; };
    const keepC = mkOpt('keep the original file in the project (otherwise it is removed after the parquet saves)', false);
    const autoC = fromSave ? mkOpt('do this automatically on every save (models under 8M blocks)', _autoOptimize === 'on') : null;
    body.append(opts);
    const note = document.createElement('div'); note.className = 'op-note';
    note.textContent = 'What happens: the layer swaps to the parquet in place — painting stays editable, filters re-apply, lineage records the conversion. The parquet self-describes (grid, categories, frame) and its footer is the query index.';
    body.append(note);
    const done = (res) => { $('#opDlg').classList.remove('show'); $('#opGo').onclick = $('#opNot').onclick = $('#opCancel').onclick = null; resolve(res); };
    $('#opGo').onclick = () => done({ layers: rows.filter((r) => r.cb.checked).map((r) => r.L), keepOriginal: keepC.checked, auto: autoC ? autoC.checked : null });
    $('#opNot').onclick = () => done(null);
    $('#opCancel').onclick = () => done(null);
    $('#opDlgMsg').textContent = fromSave ? 'asked once — the checkbox below makes it standing' : '';
    $('#opDlg').classList.add('show');
  });
}
export async function maybeAutoOptimize() {
  let cands = S.layers.filter((L) => L.viewOf == null && !L.collarOf && L.docs.blockDoc && !L.docs.blockDoc.parquet && layerTableHeader(L) && (layerTableHeader(L).mapping || {}).x != null);
  const big = cands.filter((L) => layerTableHeader(L).count > OPTIMIZE_MAX_BLOCKS);
  if (big.length) { $('#meta').textContent = `optimize: ${big.map((L) => L.label || L.name).join(', ')} over ${(OPTIMIZE_MAX_BLOCKS / 1e6)}M blocks — kept as-is (convert explicitly via the layer menu: it sorts in bounded memory, but takes a while)`; cands = cands.filter((L) => !big.includes(L)); }
  if (!cands.length) return;
  let choice = _autoOptimize, picked = cands, keepOriginal = false;
  if (choice == null) {
    if (_autoOptimizeSkip) return;
    const res = await openOptimizeDialog(cands, { fromSave: true });
    if (!res) { _autoOptimizeSkip = true; return; }           // Not now / ×: ask again next session, not never (Settings has never)
    if (res.auto) setAutoOptimize('on');                    // unticked: converted this once; a NEW model still asks
    picked = res.layers; keepOriginal = res.keepOriginal;
    if (!picked.length) return;
  } else if (choice !== 'on') return;
  for (const L of picked) { $('#meta').textContent = `optimizing ${L.name}…`; try { await convertLayerToParquet(L, { keepOriginal }); } catch (e) { $('#meta').textContent = `optimize ${L.name}: ${e.message}`; } }
}
// ── meshes are .wfr in a project — the mesh twin of "Parquet is the project store" ──
// On save, mesh / strings / pegs layers whose source isn't already a .wfr are packed into
// meshes/<source>.wfr (one file per SOURCE: a DXF's surface, strings and pegs share one) and
// re-open in place from their element — same layer id, label, tint, visibility, legend; lineage
// records the store. Asked once (remembered); Tools → Settings changes it. Source files already in
// the project are KEPT: packing never deletes data on its own (Tidy is the explicit verb).
export let _autoPack = (() => { try { return localStorage.getItem('micro.autoPackMeshes'); } catch { return null; } })();   // 'on' | 'off' | null
export function setAutoPack(v) { _autoPack = v; try { if (v == null) localStorage.removeItem('micro.autoPackMeshes'); else localStorage.setItem('micro.autoPackMeshes', v); } catch { /* private mode */ } }   // null = ask again
let _autoPackSkip = false;
// .wfr numbers line and point records in BRICK order (Morton), so a strings or
// pegs layer comes back with its records renumbered; per-record state (painted
// or ratio columns, the 3D selection) would then sit on the wrong records, and
// the next save would stamp it with the new file's identity. Mesh vertices are
// safe (.wfr keeps their vid). Until the pack carries a source→brick permutation,
// such a layer is not packed — it stays on its source file.
const recordStateAtRisk = (L) => L.kind !== 'mesh' && ((L.paintCols && L.paintCols.length > 0) || (L._selMask && L._selMask.some((v) => v)));
export const packableMesh = (L) => wfrExportable(L) && !L.gridSurface && !isWfrName(L.name) && layerFiles(L).some((fd) => fd.blob) && !recordStateAtRisk(L);
export async function packLayersToWfr(Ls) {
  if (!S.project || !Ls.length) return 0;
  const dir = S.project.dir, mdir = await dir.getDirectoryHandle('meshes', { create: true });
  const exists = async (n) => { try { await mdir.getFileHandle(n); return true; } catch { return false; } };
  const groups = new Map();                                   // one .wfr per source blob
  for (const L of Ls) { const b = layerFiles(L).map((fd) => fd.blob).find(Boolean); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(L); }
  let packed = 0;
  for (const members of groups.values()) {
    const base = wfrBase(members[0].name);
    let fname = `${base}.wfr`;
    for (let i = 2; await exists(fname); i++) fname = `${base}-${i}.wfr`;
    const fh = await mdir.getFileHandle(fname, { create: true });
    const sink = await handleSink(fh);
    let res;
    try {
      res = await packLayers({ sink, layers: members, onProgress: (p) => { $('#meta').textContent = p.phase === 'reading' ? `storing ${p.source} as .wfr${p.total ? ` — ${Math.round(100 * p.bytes / p.total)}%` : '…'}` : `storing ${fname} — writing…`; } });
      await sink.close();
    } catch (e) {
      await sink.abort(); await mdir.removeEntry(fname).catch(() => {});
      $('#meta').textContent = `store as .wfr: ${members.map((L) => L.label || L.name).join(', ')} — ${e.message}`;
      continue;
    }
    const file = await fh.getFile();
    _fileHandles.set(file, fh);
    for (const L of members) {
      const els = res.elementsOf.get(L);
      if (!els || els.length !== 1) continue;                 // a source that split into several elements stays as it was
      // the rename moves where its stored columns live: load + hold them from the
      // old home, write them at the new one once it has reopened
      const hold = await holdStoredValues(L);
      try {
      const keep = { label: L.label, visible: L.visible, tint: L.tint, opacity: L.opacity, catLegend: L.catLegend, lineage: L.lineage, sectioned: S.renderer.layerSectioned(L.id) };
      S.renderer.removeLayer(L.id);
      L.docs = {};
      L.name = fname; L.handle = fh; L.storage = 'project';
      await openWfrFile(file, fname, { layer: L.id, first: false, element: els[0], tint: keep.tint, opacity: keep.opacity });
      if (keep.label) L.label = keep.label;
      L.lineage = mkLineage('store', { format: 'wfr', file: `meshes/${fname}`, element: els[0] }, [keep.lineage]);
      if (keep.visible === false) { L.visible = false; S.renderer.setLayerVisible(L.id, false); }
      if (keep.sectioned != null && keep.sectioned !== true) S.renderer.setLayerSectioned(L.id, keep.sectioned);
      if (keep.catLegend) { L.catLegend = keep.catLegend; applyCatLegend(L, true); }
      try { await persistElement(L); } catch (e) { $('#meta').textContent = `${L.label || L.name}: stored as .wfr, but its columns did not save — ${e.message}`; }
      packed++;
      } finally { hold.release(); }
    }
  }
  recomputeUnion(); renderLayers(); markProjectDirty(); requestRender();
  return packed;
}
export async function maybeAutoPackMeshes() {
  const cands = S.layers.filter(packableMesh);
  if (!cands.length || _autoPack === 'off') return;
  if (_autoPack == null) {
    if (_autoPackSkip) return;                             // "Not now" holds for this session
    const a = await microChoose('store meshes as .wfr',
      `${cands.length} mesh/strings/points layer${cands.length === 1 ? '' : 's'} (${cands.map((L) => L.label || L.name).slice(0, 4).join(', ')}${cands.length > 4 ? ', …' : ''}) can be stored in the project as .wfr — bricked, a fraction of the size, quick to reopen, attributes kept. Source files already in the project are kept. Settings → "store meshes as .wfr on save" changes your answer later.`,
      [{ label: 'Never', value: 'never', quiet: true }, { label: 'Not now', value: 'skip' }, { label: 'Yes', value: 'once' }, { label: 'Yes, always', value: 'always' }]);
    if (a === 'never') { setAutoPack('off'); return; }
    if (a === 'always') setAutoPack('on');
    else if (a !== 'once') { _autoPackSkip = true; return; }   // Not now / × / Esc: ask again next session
  }
  const n = await packLayersToWfr(cands);
  if (n) $('#meta').textContent = `stored ${n} layer${n === 1 ? '' : 's'} as .wfr in meshes/`;
}
