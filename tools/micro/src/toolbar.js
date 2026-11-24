// micro toolbar — the instrument bar: tool buttons (measure, paint, fit, screenshot, undo / redo),
// the dialogs' buttons, the budget / EDL / point-size inputs. (The colour-by, clip and filter fields
// are src/filter-bar.js.) Carved from index.html (2026-11-24).
import { onFreshStep, onUndoChange } from './undo.js';
import { setZExag } from './camera.js';
import { S, activeLayer, activeDocs, requestRender } from './state.js';
import { installStructurePointer } from './structure-ui.js';
import { ofConfirm, ofCancel, dhImport, dhCancel } from './open-dialog.js';
import { _measure, clearMeasure, armMeasure } from './overlay.js';
import { rgCancel, rgGo, sfCancel, sfGo, ngCancel, ngGo } from './gridtools.js';
import { exCancel, exGo } from './export-dialog.js';
import { adCancel, adGo, sbCancel, sbRcp, sbGo } from './bygeom-ui.js';
import { sealedInfo } from './help.js';
import { deliverBlob } from './hostio.js';
import { rendererDocBbox } from './layers.js';
import { installSelectionTool } from './selection.js';
import { _redoOrder, syncUndoBtn, openPaintPalette, undoAction, redoAction } from './paint.js';
import { installSectionTool } from './section.js';
import { cv, renderer, cam } from './viewport.js';

const $ = (s) => document.querySelector(s);

$('#btnMeasure').onclick = () => { if (_measure.arm) clearMeasure(); else armMeasure(); };

installSectionTool();

installSelectionTool();

onFreshStep(() => { _redoOrder.length = 0; for (const L of S.layers) L._paintRedo = null; });

onUndoChange(syncUndoBtn);

$('#btnPaint').onclick = () => { const Lp = activeLayer(); if (Lp) openPaintPalette(Lp); };

// the export dialog's buttons (src/export-dialog.js)
$('#exCancel').onclick = exCancel; $('#exGo').onclick = exGo;

// the structure window's view of the app (capivaras): paint, the mesh pick, the renderer
installStructurePointer(cv);

// the by-geometry dialogs' buttons — assign domains, select by solid (src/bygeom-ui.js)
$('#adCancel').onclick = adCancel; $('#adGo').onclick = adGo;
$('#sbCancel').onclick = sbCancel; $('#sbRcp').onclick = sbRcp; $('#sbGo').onclick = sbGo;
// the grid dialogs' buttons — mesh → grid, surface tools, New… (src/gridtools.js)
$('#rgCancel').onclick = rgCancel; $('#rgGo').onclick = rgGo;
$('#sfCancel').onclick = sfCancel; $('#sfGo').onclick = sfGo;
$('#ngCancel').onclick = ngCancel; $('#ngGo').onclick = ngGo;

// screenshot: the canvas is the export surface (preserveDrawingBuffer is on)
$('#btnShot').onclick = () => {
  cv.toBlob((blob) => {
    if (!blob) return;
    const stem = (activeDocs().blockDoc && activeDocs().blockDoc.name || activeDocs().lasDoc && 'pointcloud' || 'micro').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_');
    deliverBlob(blob, `micro_${stem}.png`);
  }, 'image/png');
};

['colorBy', 'edlOn', 'edlStr', 'ptPx', 'budget', 'clipMin', 'clipMax'].forEach((id) => $('#' + id).addEventListener('input', requestRender));
// budget survives refreshes (per-frame element budget is a machine preference)
try { const b = localStorage.getItem('micro.budget'); if (b && [...$('#budget').options].some((o) => o.value === b)) $('#budget').value = b; } catch { /* private mode */ }
$('#budget').addEventListener('change', () => { try { localStorage.setItem('micro.budget', $('#budget').value); } catch { /* ignore */ } });
$('#zExag').addEventListener('input', () => setZExag($('#zExag').value));
$('#btnFit').onclick = () => { if (renderer.chunkCount) { cam.fit(rendererDocBbox()); requestRender(); } };

// the two dialogs' buttons
$('#ofOpen').onclick = ofConfirm;
$('#ofCancel').onclick = ofCancel;
$('#dhImport').onclick = dhImport;
$('#dhCancel').onclick = dhCancel;


$('#btnUndo').onclick = () => undoAction();
$('#btnRedo').onclick = () => redoAction();

$('#sealBadge').onclick = sealedInfo;
