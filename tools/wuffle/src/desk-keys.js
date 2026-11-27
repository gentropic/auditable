// wuffle desk — the KEYS and small gestures on the nets (Help → Keyboard and mouse lists them all):
// The net keys (R, arrows, Ctrl+A, Ctrl+C, ?) act when a net or the bare page has the focus; Esc and
// Ctrl+PgUp/PgDn anywhere on the desk.
//   R               reset the active net's rotation (the ↺ rotated button on a net does the same)
//   ← → / ↑ ↓       turn the active net: spin about its centre / tilt it; 5° a press, 1° with Shift
//   Ctrl+A          select everything the active net shows
//   Esc             clear the drawn selection shapes; again (or when there are none), the selection
//   Ctrl+C          copy the selected attitudes, one per line (045/30, 120→40, a fault's plane and line)
//   Ctrl+PgUp/PgDn  the previous / next diagram
//   ?               the keys help
//   double-click    a measurement: its row in the table
// None of them act while you type (a field, the console, a dialog) or inside a figure, which has its own.

import { mat3 } from '../../../ext/bearing/index.js';
import { formatPlane, formatLine } from '../../../ext/stereonet/index.js';
import { orientations } from './io.js';

const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable || !!t?.closest?.('.wfig-host, .gcu-dialog, .wcon');

export function createKeys({ project: p, layout, select, table, menus, onStatus = () => {} }) {
  const activeView = () => layout.views.get(p.activeDiagram) || null;
  const deskOn = () => document.body.classList.contains('desk') && !document.querySelector('.gcu-dialog');

  /** the active net turned by `deg` about an axis of the VIEW (z: its centre, x: across it) */
  function turn(axis, deg) {
    const v = activeView(), g = p.diagram(p.activeDiagram);
    if (!v || !v.net || !g || g.kind !== 'net') return false;
    const R0 = v.net.rotation || mat3.identity();
    const R = mat3.orthonormalize(mat3.multiply(mat3.rotationFromAxisAngle(axis, (deg * Math.PI) / 180), R0));
    p.setDiagramProps(g.id, { matrix: Array.from(R), rotation: null });
    return true;
  }
  function resetRotation() {
    const g = p.diagram(p.activeDiagram); if (!g || g.kind !== 'net') return;
    if (!g.props.matrix && !g.props.rotation) { onStatus(`${g.name} isn’t rotated`); return; }
    p.setDiagramProps(g.id, { matrix: null, rotation: null }); onStatus(`${g.name}: rotation reset`);
  }
  /** the datasets the active net shows (visible layers), once each */
  const shown = () => { const g = p.diagram(p.activeDiagram); return g ? [...new Set(p.layersOf(g.id).filter((L) => L.visible !== false).map((L) => L.datasetId))] : []; };
  const nSelected = () => shown().reduce((a, id) => a + p.selected(id).length, 0);
  function selectAll() {
    const ids = shown(); if (!ids.length) return;
    p.batch('select all', () => { for (const id of ids) p.select(id, p.dataset(id).rows.map((_, i) => i)); });
    onStatus(`${nSelected()} selected`);
  }
  async function copySelection() {
    const out = [];
    for (const id of shown()) {
      const ds = p.dataset(id), o = orientations(ds);
      for (const r of p.selected(id)) {
        const a = o[r]; if (!a) continue;
        out.push(a.plane && a.line ? `${formatPlane(a.plane)} ${formatLine(a.line)}${a.sense ? ' ' + a.sense : ''}` : a.plane ? formatPlane(a.plane) : `${formatLine(a.line)}${a.angle != null ? ` ${a.angle}` : ''}`);
      }
    }
    if (!out.length) return false;
    try { await navigator.clipboard.writeText(out.join('\n') + '\n'); onStatus(`copied ${out.length} attitude${out.length === 1 ? '' : 's'}`); }
    catch { onStatus('couldn’t reach the clipboard'); }
    return true;
  }
  function stepDiagram(dir) {
    const ds = p.diagrams; if (ds.length < 2) return;
    const i = Math.max(0, ds.findIndex((g) => g.id === p.activeDiagram));
    const g = ds[(i + dir + ds.length) % ds.length];
    p.setActive(g.id); layout.focusDiagram(g.id); onStatus(g.name);
  }

  addEventListener('keydown', async (e) => {
    if (!deskOn() || typing(e.target)) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === 'Escape') {
      const hadShapes = select.clearShapes();
      if (!hadShapes && nSelected()) { p.clearSelection(); onStatus('selection cleared'); }
      return;
    }
    // the net keys act on a net or the bare page — never in the table's grid or the tree, which have their own
    const onNet = e.target === document.body || !!e.target?.closest?.('.wn-host');
    if (mod && (k === 'PageUp' || k === 'PageDown')) { e.preventDefault(); stepDiagram(k === 'PageUp' ? -1 : 1); return; }
    if (!onNet) return;
    if (mod && !e.altKey && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(); return; }
    if (mod && !e.altKey && (k === 'c' || k === 'C') && !String(getSelection?.() || '')) { if (nSelected()) { e.preventDefault(); await copySelection(); } return; }
    if (mod || e.altKey) return;
    if (k === '?') { e.preventDefault(); menus.run('keys'); return; }
    if ((k === 'r' || k === 'R') && !e.repeat) { e.preventDefault(); resetRotation(); return; }
    const step = e.shiftKey ? 1 : 5;
    const arrow = { ArrowLeft: [[0, 0, 1], -step], ArrowRight: [[0, 0, 1], step], ArrowUp: [[1, 0, 0], -step], ArrowDown: [[1, 0, 0], step] }[k];
    if (arrow && turn(arrow[0], arrow[1])) e.preventDefault();
  });

  // a double-click on a measurement: its row in the table
  document.addEventListener('dblclick', (e) => {
    if (!deskOn()) return;
    const stage = e.target?.closest?.('.wn-stage'); if (!stage) return;
    const v = [...layout.views.values()].find((x) => x.stage === stage); if (!v || !v.net) return;
    const pt = v.svgPoint(e); if (!pt) return;
    const hit = v._hit(pt); if (!hit) return;
    table.reveal(hit.datasetId, hit.row); layout.focusTable();
  });

  return { resetRotation, turn, selectAll, copySelection, stepDiagram };
}
