// micro — the file info and memory windows: what a layer is, where its bytes live,
// and what the session is holding.
import { S, activeLayer } from './state.js';
import { showHelp } from './help.js';
import { html, joinH } from './html.js';
import { fmtSize } from './paths.js';
import { basisAngles, supportOfHeader, supportToWorld } from '../../../ext/condenser/src/main.js';
import { pinStats } from './columns.js';
import { crsLabel } from './crs.js';
import { hasSceneFrame, sceneOrigin } from './coords.js';
const $ = (s) => document.querySelector(s);

// the header panel: everything the providers learned about the open file.
// A table with click-to-copy values (lamina's grid-summary pattern): display
// is formatted, the CLIPBOARD gets the raw value — full precision, no
// thousands separators — ready to paste into a report or another tool.
export function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
}

export function showFileInfo() {
  const AL0 = activeLayer();
  const d0 = (AL0 && AL0.docs) || {};
  const meshDoc = d0.meshDoc || null;
  const fdoc = d0.stringsDoc && d0.stringsDoc.features ? d0.stringsDoc : null;   // a strings & polygons layer
  const doc = meshDoc || d0.blockDoc || d0.dhDoc || d0.plyDoc || d0.lasDoc || fdoc;
  if (!doc) { showHelp('file info', html`no file open`); return; }
  const h = doc.header;
  const fmtC = (v) => (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 }));
  // one copyable value: raw goes to the clipboard, shown formatted
  const V = (raw, shown) => (raw == null ? html`<span class="fi-x">—</span>` : html`<span class="fi-v" data-copy="${raw}">${shown != null ? shown : raw}</span>`);
  const num = (v) => (v == null ? V(null) : V(v, fmtC(v)));
  const sep = (x) => html`<span class="fi-x">${x}</span>`;
  const rows = [];
  const row = (k, v) => rows.push(html`<tr><td class="fi-k">${k}</td><td>${v}</td></tr>`);
  // full-width wrapping row — for prose (drillhole checks) that would blow out
  // the nowrap key column and push every value off-screen
  const wide = (h2) => rows.push(html`<tr><td colspan="2" class="fi-w">${h2}</td></tr>`);
  row('file', V(meshDoc ? meshDoc.name : d0.blockDoc ? d0.blockDoc.name : d0.plyDoc ? d0.plyDoc.name : 'point cloud'));
  row('kind', V(fdoc ? `strings & polygons (${(fdoc.source && fdoc.source.format) || h.format})` : meshDoc ? `${h.soup ? 'streamed mesh' : 'context mesh'} (${h.format})` : d0.dhDoc ? `drillholes (${h.method === 'minimumCurvature' ? 'minimum curvature' : h.method}, dip ${h.dipConvention})` : d0.lasDoc ? `LAS ${h.version} · point format ${h.format}` : d0.plyDoc ? `PLY ${h.format === 'ascii' ? 'ascii' : 'binary (little-endian)'}` : h.dm ? 'Datamine .dm block model' : h.grid ? 'delimited block model' : 'delimited points'));
  if (meshDoc) {
    row('triangles', num(h.triCount)); row('vertices', num(h.vertexCount));
    const tp = AL0 && AL0._solidMesh;
    if (tp) row('topology', V(tp.closed ? 'closed solid (watertight)' : `open surface · ${tp.boundaryEdges.toLocaleString()} boundary edges`));
  }
  else row('records', num(h.count));
  if (d0.dhDoc) {
    row('holes', num(h.holes));
    row('placed', num(h.placed));
    for (const c of h.report.checks) wide(html`${sep('⚠')} ${c.label} ${sep('—')} ${V(c.count)}${c.bhids.length ? html` ${sep('·')} ${V(c.bhids.slice(0, 8).join(', ') + (c.bhids.length > 8 ? '…' : ''))}` : ''}`);
  }
  if (h.bbox) {
    for (const [ax, i] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      row(ax, html`${num(h.bbox.min[i])} ${sep('–')} ${num(h.bbox.max[i])} ${sep('(Δ')} ${num(h.bbox.max[i] - h.bbox.min[i])}${sep(')')}`);
    }
  }
  if (hasSceneFrame()) row('frame origin', html`${joinH(sceneOrigin().map(num), sep(', '))}${S.frame.crs ? html` ${sep('·')} ${V(S.frame.crs)}` : ''}`);
  row('project CRS', V(S.crs ? crsLabel(S.crs) : null, S.crs ? crsLabel(S.crs) : 'none set'));
  if (h.crsName) row('file CRS', V(h.crsName));
  const rpj = h.reprojected || (fdoc && fdoc.source && fdoc.source.reprojected);
  if (fdoc && fdoc.source && fdoc.source.fileCrs) row('file CRS', V(fdoc.source.fileCrs.epsg ? `${fdoc.source.fileCrs.name} · EPSG:${fdoc.source.fileCrs.epsg}` : fdoc.source.fileCrs.name));
  if (rpj) wide(html`${sep('reprojected')} ${V(rpj.from)} ${sep('→')} ${V(rpj.to)} ${sep('·')} ${V(rpj.path)} ${sep('· heights unchanged')}`);
  if (AL0 && S.renderer.layerVramBytes(AL0.id)) row('vram (layer)', V(fmtSize(S.renderer.layerVramBytes(AL0.id))));
  const sup = h.grid ? supportOfHeader(h) : null;            // the block-support contract: frame, lattice, sizes
  if (sup) {
    const Lt = sup.lattice, P = Lt.pitch;
    if (sup.sub) {
      row('grid (fine lattice)', joinH(Lt.count.map(num), sep(' × ')));
      row('fine step', joinH(P.map(num), sep(' × ')));
      const q = sup.sizeQMax, big = q ? joinH([q[0] * P[0], q[1] * P[1], q[2] * P[2]].map(num), '×') : null;
      row('sub-block sizes', html`${h.sizeShapes ? html`${num(h.sizeShapes)}${h.sizeShapes >= 65536 ? '+' : ''} shapes` : 'variable'}${big ? html`${sep(' · largest ')}${big}` : ''}`);
    } else {
      row('grid', joinH(Lt.count.map(num), sep(' × ')));
      row('block size', joinH(P.map(num), sep(' × ')));
    }
    const c0 = supportToWorld(sup.frame, Lt.originQ[0], Lt.originQ[1], Lt.originQ[2]);
    row('block 0 centroid', joinH(c0.map(num), sep(', ')));
    if (sup.frame.rotated) { const ag = basisAngles(sup.frame.R); row('rotation', `azimuth ${ag.azimuth.toFixed(2)}°${ag.zOnly ? '' : ` · tilt ${ag.tilt.toFixed(2)}°`} · ${(h.lattice && h.lattice.basis) || 'declared'}${h.lattice && h.lattice.confirmed ? ` (confirmed by ${h.lattice.confirmed})` : ''}`); }
  }
  if (h.scale) {
    row('scale', joinH(h.scale.map(num), sep(', ')));
    row('offset', joinH(h.offset.map(num), sep(', ')));
  }
  if (h.columns) row('columns', joinH(h.columns.map((c) => V(c)), sep(' · ')));
  if (h.attributes && h.attributes.length) row('channels', joinH(h.attributes.map((c) => V(c)), sep(' · ')));
  if (h.categories && h.categories.length) row(h.columns && h.mapping && h.mapping.cat != null ? h.columns[h.mapping.cat] : 'categories', joinH(h.categories.map((c) => V(c)), sep(' · ')));
  showHelp('file info', html`<table class="fi">${rows}</table>`);
  $('#helpBody').querySelectorAll('.fi-v').forEach((el) => el.onclick = () => {
    const v = el.getAttribute('data-copy'); if (v == null) return;
    copyText(v);
    el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 700);
  });
}

// scene-global memory readout (the numbers live in the renderer; this is a table)
export async function showMemoryInfo() {
  const rows = [];
  const row = (k, v) => rows.push(html`<tr><td class="fi-k">${k}</td><td>${v}</td></tr>`);
  let total = 0;
  for (const L of S.layers) {
    const b = S.renderer.layerVramBytes(L.id);
    total += b;
    row(L.label || L.name, html`${fmtSize(b)} <span class="fi-x">· ${(S.renderer.layerElementCount(L.id) || 0).toLocaleString()} elements${L.visible ? '' : ' · hidden (still resident)'}</span>`);
  }
  row('total vram', html`<b>${fmtSize(S.renderer.vramBytes || total)}</b>`);
  { const st = pinStats(); if (st.bytes || st.budget) row('filter column cache', html`${fmtSize(st.bytes)} <span class="fi-x">· ${st.cols} column${st.cols === 1 ? '' : 's'} pinned · budget ${st.budget ? fmtSize(st.budget) : 'off'}</span>`); }
  if (performance.memory) row('js heap', fmtSize(performance.memory.usedJSHeapSize));
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      row('site storage', html`${fmtSize(est.usage || 0)} <span class="fi-x">of ${fmtSize(est.quota || 0)} available</span>`);
    } catch { /* unavailable */ }
  }
  row('', html`<span class="fi-x">vram = geometry buffers held by layers (hidden layers included). Convert big meshes to streamed, or remove layers, to shed it.</span>`);
  showHelp('memory', html`<table class="fi">${rows}</table>`);
}
