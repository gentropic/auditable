// wuffle desk — the NET'S right-click menu. What it offers depends on what is under the cursor:
//   a measurement (a pole or a line, or a great / small circle drawn on the net)
//       its attitude; select it (or add / remove it); show its row in the table; copy it; its layer's elements
//   an empty spot on the net
//       the attitude there; add it as a plane (this is its pole) or as a line; center the net on it; copy it
//   and always: the SELECTION (statistics, → a dataset, invert, clear), the net's own settings (the tree's
//   menu shares them) and the picture — SVG, PNG, or copied to the clipboard.
// With the measure tool chosen, the right button measures (desk-measure.js) and this menu stays away.
// Typed additions go through the console's own `add`, so the net and the console make the same data.

import { Menu } from '../../../ext/menu/index.js';
import { alert } from '../../../ext/dialog/index.js';
import * as bearing from '../../../ext/bearing/index.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { sceneLayers } from './layers.js';
import { layerStats } from './stats.js';
import { diagramSvg } from './diagram-svg.js';

const { conversions } = bearing;
const D = 180 / Math.PI;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.min(1, Math.abs(dot(a, b)))) * D;          // axial: 0–90
const ELEMENTS = [['poles', 'poles'], ['points', 'points'], ['greatCircles', 'great circles'], ['contours', 'contours'], ['mean', 'mean + cone'],
  ['eigen', 'eigenvectors'], ['labels', 'labels']];
const fileName = (s) => String(s || 'net').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'net';
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

/** a diagram → a PNG blob (its paper SVG, rasterized at scale × its size) */
export async function diagramPng(p, diagramId, { size = 800, scale = 2 } = {}) {
  const svg = diagramSvg(p, diagramId, { size }); if (!svg) throw new Error('nothing to draw on this diagram yet');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.decoding = 'sync';
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('the picture could not be drawn')); img.src = url; });
    const cv = document.createElement('canvas'); cv.width = Math.round(size * scale); cv.height = Math.round(size * scale);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export function createNetMenu({ project: p, tree, table, select, layout, commands, onStatus = () => {} }) {
  /**
   * What is under a pointer event on a net → { dir, datum? } — dir: the direction there (null off the net);
   * datum: { layer, datasetId, row, what: 'point' | 'circle', o } — a point within 8 px (the net's own picks),
   * else the nearest drawn great circle (planes with circles on) or small circle within 8 px of it
   */
  function hitAt(view, e) {
    const pt = view.svgPoint(e); if (!pt || !view.net) return { dir: null };
    const dir = view.net.unproject(pt.x, pt.y); if (!dir || !dir.every(Number.isFinite)) return { dir: null };   // (a net in a background tab has no size)
    const k = view._hit(pt);
    const L0 = k && sceneLayers(p, view.id).find((L) => L.datasetId === k.datasetId && L.visible !== false);
    if (k && L0) return { dir, datum: { layer: L0.id, datasetId: k.datasetId, row: k.row, what: 'point', o: L0.data.find((d) => d.row === k.row) } };
    // 8 px, as an angle HERE (a projection stretches differently at the centre and the rim)
    const side = view.net.unproject(pt.x + 8 * pt.scale, pt.y) || view.net.unproject(pt.x - 8 * pt.scale, pt.y);
    const tol = side ? Math.max(0.5, Math.acos(Math.min(1, Math.abs(dot(dir, side)))) * D) : 3;
    let best = null;
    for (const L of sceneLayers(p, view.id)) {
      if (L.visible === false) continue;
      const circles = L.kind === 'smallcircles' || (L.elements.greatCircles && L.elements.greatCircles.on);
      if (!circles) continue;
      for (const d of L.data) {
        const off = L.kind === 'smallcircles' ? (d.dcos && d.angle != null ? Math.abs((Math.acos(Math.max(-1, Math.min(1, dot(dir, d.dcos)))) * D) - d.angle) : Infinity)
          : d.pole ? Math.abs(90 - angle(dir, d.pole)) : Infinity;
        if (off <= tol && (!best || off < best.off)) best = { off, datum: { layer: L.id, datasetId: L.datasetId, row: d.row, what: 'circle', o: d } };
      }
    }
    return { dir, datum: best && best.datum };
  }

  const attitudeText = (o) => (o.plane && o.line ? `${formatPlane(o.plane)} ${formatLine(o.line)}${o.sense ? ' ' + o.sense : ''}`
    : o.plane ? formatPlane(o.plane) : `${formatLine(o.line)}${o.angle != null ? ` ±${o.angle}°` : ''}`);
  const addText = (o) => (o.plane && o.line ? `add f ${o.plane.join('/')} ${o.line.join('/')}${o.sense ? ' ' + o.sense : ''}` : o.plane ? `add p ${o.plane.join('/')}` : o.angle != null ? `add sc ${o.line.join('/')} ${o.angle}` : `add l ${o.line.join('/')}`);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); onStatus(`copied ${text}`); } catch { onStatus(`couldn't reach the clipboard — ${text}`); } };
  const r1 = (v) => Math.round(v * 10) / 10;
  const run = (line) => { const r = commands.run(line); onStatus(r.text.split('\n')[0]); return r; };

  async function show(view, e) {
    const g = p.diagram(view.id); if (!g || !view.net) return;
    const { dir, datum } = hitAt(view, e);
    const items = [];
    let here = null;
    if (datum) {
      const ds = p.dataset(datum.datasetId), L = p.layer(datum.layer), sel = new Set(p.selected(ds.id)), on = sel.has(datum.row);
      items.push({ label: `${ds.name} #${datum.row + 1} · ${attitudeText(datum.o)}${datum.what === 'circle' ? ' (its circle)' : ''}`, disabled: true });
      items.push({ label: on ? 'Select only this' : 'Select', action: 'd:sel' });
      items.push(on ? { label: 'Remove from the selection', action: 'd:unsel' } : { label: 'Add to the selection', action: 'd:add', disabled: !sel.size });
      items.push({ label: 'Show its row in the table', action: 'd:row' });
      items.push({ label: 'Copy its attitude', action: 'd:copy' });
      if (L) items.push({ label: `Layer “${L.name || ds.name}”`, children: [
        ...ELEMENTS.filter(([k]) => L.elements[k]).map(([k, t]) => ({ label: t, action: 'el:' + k, checked: !!L.elements[k].on })),
        '---', { label: 'Properties…', action: 'd:props' }, { label: 'Hide this layer', action: 'd:hide' } ] });
    } else if (dir) {
      const plane = conversions.dcosToPlane(dir).map(r1), line = conversions.dcosToLine(dir).map(r1);
      here = { plane, line };
      items.push({ label: `here · pole of ${formatPlane(plane)} · line ${formatLine(line)}`, disabled: true });
      items.push({ label: `Add the plane ${formatPlane(plane)}`, action: 'h:plane', title: 'the plane whose pole is here, into “typed planes”' });
      items.push({ label: `Add the line ${formatLine(line)}`, action: 'h:line' });
      if (g.kind === 'net') items.push({ label: 'Center the net here', action: 'h:center' });
      items.push({ label: 'Copy this attitude', action: 'h:copy' });
    }
    // the selection, wherever it is (it's the data's): only what this net shows
    const shown = [...new Set(p.layersOf(view.id).filter((L) => L.visible !== false).map((L) => L.datasetId))];
    const nSel = shown.reduce((a, id) => a + p.selected(id).length, 0);
    items.push('---', { label: nSel ? `Selection (${nSel})` : 'Selection', children: [
      { label: 'Statistics of the selection', action: 's:stats', disabled: !nSel },
      { label: 'Selection → new dataset', action: 's:ds', disabled: !nSel },
      { label: 'Select all', action: 's:all' }, { label: 'Invert', action: 's:inv' },
      { label: 'Clear', action: 's:none', disabled: !nSel } ] });
    items.push({ label: g.name, children: [{ label: 'Rename…', action: 'rename' }, ...tree.diagramItems(g)] });
    items.push('---', { label: 'Export SVG', action: 'x:svg' }, { label: 'Export PNG', action: 'x:png' }, { label: 'Copy as a picture', action: 'x:copy' });

    const a = await Menu.show(items, { x: e.clientX, y: e.clientY });
    if (!a) return;
    try {
      if (datum) {
        const ds = p.dataset(datum.datasetId);
        if (a === 'd:sel') p.select(ds.id, [datum.row]);
        else if (a === 'd:add') p.select(ds.id, [datum.row], 'add');
        else if (a === 'd:unsel') p.select(ds.id, [datum.row], 'subtract');
        else if (a === 'd:row') { table.reveal(ds.id, datum.row); layout.focusTable?.(); }
        else if (a === 'd:copy') await copy(attitudeText(datum.o));
        else if (a === 'd:props') tree.properties(datum.layer);
        else if (a === 'd:hide') p.setLayerVisible(datum.layer, false);
        else if (a.startsWith('el:')) { const L = p.layer(datum.layer); p.setElement(L.id, a.slice(3), !L.elements[a.slice(3)].on); }
      }
      if (here) {
        if (a === 'h:plane') run(`add p ${here.plane.join('/')}`);
        else if (a === 'h:line') run(`add l ${here.line.join('/')}`);
        else if (a === 'h:center') run(`rotate "${here.line[0]}→${here.line[1]}"`);
        else if (a === 'h:copy') await copy(`${formatPlane(here.plane)} (pole ${formatLine(here.line)})`);
      }
      if (a === 's:stats') await alert(selectionReport(view), { title: 'statistics of the selection' });
      else if (a === 's:ds') { let last = null; for (const id of shown) if (p.selected(id).length) last = p.selectionToDataset(id); if (last) { p.addLayer(view.id, last); table.show(last); } }
      else if (a === 's:all' || a === 's:inv') { p.setActive(view.id); run(`select ${a === 's:all' ? 'all' : 'invert'}`); }
      else if (a === 's:none') p.clearSelection();
      else if (a === 'x:svg') { const svg = diagramSvg(p, view.id, { size: 800 }); if (!svg) throw new Error('nothing to draw on this diagram yet'); download(new Blob([svg], { type: 'image/svg+xml' }), `${fileName(g.name)}.svg`); }
      else if (a === 'x:png') download(await diagramPng(p, view.id), `${fileName(g.name)}.png`);
      else if (a === 'x:copy') { const b = await diagramPng(p, view.id); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); onStatus(`${g.name} copied as a picture`); }
      else if (!a.startsWith('d:') && !a.startsWith('h:') && !a.startsWith('el:') && !a.startsWith('s:')) await tree.diagramAction(g, a);
    } catch (err) { onStatus(err.message); }
  }

  /** the selection's numbers, one block per dataset this net shows */
  function selectionReport(view) {
    const out = [];
    for (const id of [...new Set(p.layersOf(view.id).filter((L) => L.visible !== false).map((L) => L.datasetId))]) {
      const ds = p.dataset(id), rows = p.selected(id); if (!rows.length) continue;
      const s = layerStats(ds, { rows }), isPlane = ds.kind !== 'lines';
      out.push(`${ds.name} · ${rows.length} of ${ds.rows.length} selected`);
      if (s.mean) out.push(`  mean ${isPlane ? formatPlane(s.mean.plane) + ' · pole ' : ''}${formatLine(s.mean.line)} · κ ${s.mean.kappa.toFixed(1)} · α95 ${s.mean.alpha.toFixed(1)}°`);
      else out.push('  (a mean needs two)');
      if (s.eigen) out.push(`  S ${s.eigen.values.map((x) => x.toFixed(3)).join(' ')} · K ${s.eigen.K.toFixed(2)} · C ${s.eigen.C.toFixed(2)}`);
    }
    return out.join('\n') || 'nothing selected';
  }

  function attach(view) {
    view.stage.addEventListener('contextmenu', (e) => {
      if (select.tool === 'measure') return;            // the right button measures (desk-measure.js)
      e.preventDefault(); p.setActive(view.id); show(view, e);
    });
  }
  return { attach, hitAt, show, selectionReport, png: (diagramId, opts) => diagramPng(p, diagramId, opts) };
}
