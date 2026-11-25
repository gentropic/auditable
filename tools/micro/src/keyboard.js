// micro keyboard — the window-level shortcuts: ⌘K / Alt+K, undo / redo, and the single-key
// reflexes (src/keys.js is their one list; test/micro-keys.test.mjs keeps the handler below and
// the list in step). Carved from index.html (2026-11-24).
import { trusted } from './html.js';
import { PHI_MAX } from './camera.js';
import { activeLayer, S, requestRender } from './state.js';
import { hasRecords } from './records.js';
import { openProps } from './props.js';
import { showNode, stepExclusive } from './tree.js';
import { toggleLayersPanel } from './layers-panel.js';
import { _gotoArm, gotoDisarm, saveViewSlot, recallViewSlot, armGoto } from './views.js';
import { armMeasure, _measure, clearMeasure } from './overlay.js';
import { showHelp, HELP_KEYS } from './help.js';
import { showFileInfo } from './fileinfo.js';
import { renameActiveLayer } from './rename.js';
import { openAttrTable } from './attrtable.js';
import { setActiveLayer } from './layers.js';
import { _nlOn } from './nl.js';
import { armSelect, _selArm, disarmSelect, clearSelection } from './selection.js';
import { undoAction, redoAction, openPaintPalette, PAINT, paintDisarm } from './paint.js';
import { polyDraftUndo } from './poly-draw.js';
import { _knifeArm, armKnife, viewAlongSection, scrubSection, toggleSection } from './section.js';
import { setView, cam, setBlockEdges, _blockEdges } from './viewport.js';
import { soloActiveLayer } from './command-list.js';
import { _palOpen, closePalette, openPalette } from './palette.js';

const $ = (s) => document.querySelector(s);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); _palOpen ? closePalette() : openPalette(); }
  // Ctrl/⌘+Z: paint's own stack first, then the history (src/undo.js). It lived in
  // the single-key handler, which returns on any modifier — so it never ran.
  // In a text field it stays the field's own text undo.
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    if (!polyDraftUndo()) undoAction();                    // a polygon being drawn takes its own last vertex back first
  }
  else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (!e.shiftKey && (e.key === 'y' || e.key === 'Y'))) && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    redoAction();
  }
  else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK' && _nlOn) { e.preventDefault(); closePalette(); openPalette({ nl: true }); }   // Alt+K → straight to the NL bar (experimental)
}, true);
window.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;   // typing, not commanding
  const k = e.key;
  if (e.ctrlKey || e.metaKey || e.altKey) return;         // reserved combos (⌘K palette, Alt+K NL bar, ⌘S save…) handled elsewhere — Alt must not trigger the single-key reflexes (k=knife)
  if (_gotoArm) {                                          // g-leader armed: the next digit is a view slot
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;   // a modifier press is not the next key
    if (/^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      const n = +e.code.slice(5), withShift = e.shiftKey;
      gotoDisarm();
      if (withShift) saveViewSlot(n); else recallViewSlot(n);
      return;
    }
    gotoDisarm(); $('#meta').textContent = '';             // any other key disarms…
    if (k === 'Escape') return;                            // …Esc quietly; the rest fall through to their normal job
  }
  if (k === 'f') $('#btnFit').click();
  else if (k === 'k' || k === 'c') { $('#secMode').value = 'knife'; $('#secMode').dispatchEvent(new Event('input')); }   // k = knife, c = cut (same verb, two reflexes)
  else if (k === 'Escape' && _knifeArm) { armKnife(false); $('#secMode').value = 'off'; $('#secMode').dispatchEvent(new Event('input')); }
  else if (k === 'n') setView(-Math.PI / 2, 0);           // looking north (+Y): camera south of target
  else if (k === 's') setView(Math.PI / 2, 0);            // looking south
  else if (k === 'e') setView(Math.PI, 0);                // looking east (+X): camera west
  else if (k === 'w') setView(0, 0);                      // looking west
  else if (k === 'd') setView(cam.state.theta, PHI_MAX);  // plan (looking down)
  else if (k === 'u') setView(cam.state.theta, -PHI_MAX); // looking up
  else if (k === 'l') viewAlongSection();                 // face-on to the section
  else if (k === 'L') viewAlongSection(true);             // ⇧L: face its BACK (the other side)
  else if (k === '/') { e.preventDefault(); $('#filter').focus(); }
  else if (k === 'i') showFileInfo();
  else if (k === 'm') armMeasure();
  else if (k === 'p') toggleLayersPanel();
  else if (k === 'P') { const Lp = activeLayer(); if (Lp) { setActiveLayer(Lp.id); openProps(); } }   // ⇧P: layer Properties (pairs with p = layers panel)
  else if (k === 'B') { setBlockEdges(!_blockEdges); $('#meta').textContent = `block edges ${_blockEdges ? 'on' : 'off'}`; }   // ⇧B: block edges (the View toggle)
  else if (k === 'h') { const Lh = activeLayer(); if (Lh) { showNode(Lh.id, !Lh.visible); $('#meta').textContent = `${Lh.label || Lh.name} ${Lh.visible ? 'shown' : 'hidden'}`; } }   // h: hide/show the active layer (compare-overlays flick)
  else if (k === '{' || k === '}') stepExclusive(k === '}' ? 1 : -1);   // { }: step the active layer's mutually exclusive group (pit phases)
  else if (k === 'H') soloActiveLayer();                  // ⇧H: solo the active layer (again = restore; re-solos if active changed)
  else if (k === 'F2') { const Lr = activeLayer(); if (Lr) { e.preventDefault(); renameActiveLayer(Lr); } }   // F2: rename (the Windows reflex)
  else if (k === 't') { const Lt = activeLayer(); if (Lt && hasRecords(Lt)) openAttrTable(Lt); }
  else if (k === 'r') armSelect('rect');
  else if (k === 'v') armSelect('lasso');
  else if (k === 'b') { const Lb = activeLayer(); if (Lb) openPaintPalette(Lb); }
  else if (k === 'Escape' && PAINT.arm) paintDisarm();
  else if (k === 'Escape' && _selArm) disarmSelect();
  else if (k === 'Escape' && !_knifeArm && !_measure.arm && !_measure.b) clearSelection();
  else if (k === ',' || k === '.') scrubSection(k === ',' ? -1 : 1);   // walk the section (Leapfrog convention)
  else if ((k === '[' || k === ']') && S.layers.length > 1) {   // step the active layer (wraps)
    const i = S.layers.findIndex((L) => L.id === S.activeId);
    const j = (i + (k === ']' ? 1 : -1) + S.layers.length) % S.layers.length;
    setActiveLayer(S.layers[j].id);
  }
  else if (k === 'Escape' && (_measure.arm || _measure.b)) clearMeasure();
  else if (k === 'o') { cam.setOrtho(!cam.state.ortho); requestRender(); }
  else if (k === 'x') toggleSection();
  else if (k === 'g') armGoto();                          // the goto leader — bare digits are NOT bound (a stray digit must never teleport the camera)
  else if (k === 'F1') { e.preventDefault(); showHelp('keyboard & mouse', trusted(HELP_KEYS)); }
});
