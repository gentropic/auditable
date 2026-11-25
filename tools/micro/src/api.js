// micro API — window._micro (the smokes' unstable reach into everything) and window.micro (the
// small, versioned HOST API, src/host-api.js; manual appendix D), plus files arriving from the
// lead-acid shell. Runs last: the host API's announce says micro is up. Carved from index.html
// (2026-11-24).
import { gridsCompatible, commonLattice } from '../../../ext/condenser/src/main.js';
import { shell } from '../../../ext/leadacid/index.js';
import { declusterWeights } from '../../../ext/gsjs/src/decluster.js';
import * as _modUndo from './undo.js';
import { undoLabel } from './undo.js';
import { setZExag, PHI_MAX } from './camera.js';
import { setProjection, projectionStatus, projectionSupport } from './projection.js';
import { openDhQa, _qaWins } from './dhqa.js';
import { swathDir, dirTrendPlunge, frameDipDirDipRake } from './geom.js';
import { writeEsriAsc, writeSurferGrd, readSurferGrd } from './grid-io.js';
import { requestRender, layerById, S, activeDocs } from './state.js';
import { createHostApi } from './host-api.js';
import { attrRowCountOf, layerTableHeader, rowQualifier, rawRecordOf, locationsOf, hasRecords, primaryLocationOf, attrColumnsOf, fetchLayerRow, meshVertexData, meshVertexHeader, extendRow, schemaExt, calcFns, blockCaps, docPositionStream, layerRecords, fetchCsvRecord, colIsNumeric, qualifyPolicy } from './records.js';
import { setCsvColumnar, canScanColumnar, zoneKeeper } from './colscan.js';
import { startChunkBuilder } from './chunkworker.js';
import { rasterizeMeshToGrid, applyGridExtend, fillGridNearest, fillGridTrend, markGridExterior, surfaceFromGrid, buildEmptyGrid, buildEmptyBlockCsv, alignAxis, coverGeometry, gridAxesOf } from './grid-ops.js';
import { matColSet, matColList, matColGet, ensureStoredValues, pinPutMatcol, setPinBudget, pinStats, scanColumns, colStatsComplete, footerColStats } from './columns.js';
import { persistElement, loadElement, matColDelete } from './element-store.js';
import { numericColsOf, computeGT, computeSwath, extractSamples, computeSampleSwath } from './analysis.js';
import { buildElementManifest, buildDhSetManifest, buildGridElementManifest, descFromElement } from './manifest.js';
import { runWfrJob, packLayers, partsSink, handleSink } from './wfr-write.js';
import { applyBlockFilter, dhFilterSweep, applyTableFilter, syncFilterClear } from './filter.js';
import { runExport, exportColumnsOf, convertLayerToParquet } from './export.js';
import { runSpatialJoin, runReconcile, runKeyJoin, spatialJoinToCols, keyJoinToCols } from './joins.js';
import { resultToLayer } from './analysis-ui.js';
import { openGradeTonnage } from './gt.js';
import { applySwathZebra, openSwath } from './swath.js';
import { openStats } from './stats.js';
import { openCrosstab, _xtabWins, parseCutoffs } from './xtab.js';
import { openXyPlot, _xyWins } from './xyplot.js';
import { openMeshQa, _meshQaWins } from './meshqa.js';
import { openModelQa, modelQa, qaFindings, selectFinding, subBlockTiling, _modelQaWins } from './modelqa.js';
import { openComposite, compositeLayer, compositeToLayer } from './composite-ui.js';
import { openPairing, pairBlocksSamples, selectDisagreeing, _pairWins } from './pairing.js';
import { openSectionSeries, renderSectionSeries, seriesPositions, seriesExtent } from './section-series.js';
import { recoverSession, createMemDir } from './gpu-restore.js';
import { setLang, translateDom } from './i18n.js';
import { openGradeShell, gradeShell, readField, contourField, smoothField } from './shells.js';
import { openStructure, openStereonet, importPaintedSets, removeTrace, tracesToDxf, _structWins, planesToTable, structureArmed, structureAfterEdit } from './structure-ui.js';
import { structureOf, prepareStructure, measurePlanes, traceNetwork } from './structure.js';
import { validationRun, openValidation } from './validation.js';
import { openContact, scanContact, meshDistanceOf, writeDistanceColumn, _contactWins } from './contact.js';
import { openFactors, scanFactors, factorsStOf, _factorsWins } from './factors.js';
import { checkAllRecipes, openCheckAllRecipes, saveRecipe, loadRecipes, runRecipe, runRoutine, expandRoutine, routineLoadParams, routineReadTableFull, routineEval, routineSubst, routineFilterRows, routineTargets, openRoutineTracker, recipesMenuItems, checkRoutineHost, runRoutineHost } from './recipes.js';
import { openRoutineWindow, openInputsDialog } from './routine-ui.js';
import { selectBySolid, ratioBySolid, flagBySolid, selectByGridSurface, ratioByGridSurface, flagByGridSurface, residentGridForEval, meshSolidOf, setWindingGpu, assignDomains } from './bygeom.js';
import * as _modProps from './props.js';
import { propKindLine, openProps, setPropTab } from './props.js';
import * as _modStyleClip from './style-clip.js';
import { copyStyle, pasteStyle, captureStyle, applyStyle } from './style-clip.js';
import * as _modColtypes from './coltypes.js';
import { setColumnQualify, useAsCategory } from './coltypes.js';
import { runRules, syncRuleMode, applyRuleVisibility } from './rules.js';
import { applyCatLegend } from './categories.js';
import * as _modRamp from './ramp.js';
import { setRampCfg, bakeRampPixels, rampRangeFor } from './ramp.js';
import { markProjectDirty, closeProject, openProjectDir, saveProject, saveProjectAs } from './project.js';
import { tidyProject, scanFolderForNewData } from './project-folder.js';
import { packLayersToWfr, setAutoPack, setAutoOptimize } from './optimize.js';
import { backupProject, restoreProject, openProjectPack, openPackFile, savePackAsFolder } from './project-pack.js';
import { openBlob, openDrillholeLayer } from './open.js';
import { openTableBlob, openXlsxBlob, openWorkbook } from './open-table.js';
import { openBlocksBlob, setDmOrigin, openParquetBlocks } from './open-blocks.js';
import { openGridBlob } from './open-grid.js';
import { openObjSplit, openLfmSplit } from './open-mesh.js';
import { addLayer, ingestSource } from './ingest.js';
import { openDhDialog, openFilesDialog } from './open-dialog.js';
import { dhSetGroupOf, broadcastCollarCol, addIntervalToSet, redesurveySet, reopenDh, showHoleTraces, showCollars, hideCollars, setHoleFilter, applyHoleFilter, filterHolesSet, openCsvTableWindow, collarsRowMenu, surveyRowMenu } from './drillholes.js';
import * as _modColor from './color.js';
import { colorSelFor, colorByName, setLayerColorSel, colorChoices, setLayerColorBy, layerColorRange, setLayerColorRange, layerPalette, setLayerPalette, paletteList } from './color.js';
import { recolorSurface, setSurfaceFlatZ, setSurfaceSmooth, setGridBand, meshToGridLayer, syncMeshPickable } from './surfaces.js';
import { changeLayerFile, canChangeFile, reloadLayerFromDisk, canReloadLayer, reopenWithMapping, reopenAs, reinterpretOptions } from './reopen.js';
import * as _modDeco from './deco.js';
import { runFigureRecipe, captureFigureCfg, setDeco, setDecoTitle, setLayerLegend, exportFigure, setFigScale, drawDecorations, decorationsMenu, openDecoPanel, setBg, hostDecorations, setHostDecorations } from './deco.js';
import { fileLayerByPath, ensureGroupPath, createLayerGroup, applyTreeVisibility, treeMove, followLayer, fileLayersInGroup, groupPathOf, groupsList, ungroupAt, setGroupVisible, showNode, groupAt, setGroupExclusive, stepExclusive } from './tree.js';
import { renderLayers, toggleLayersPanel, groupMenu, setLayerSectionMode } from './layers-panel.js';
import { saveViewAs, applyView, saveSceneAs, applyScene, captureScene, removeBookmark, removeScene } from './views.js';
import { measureClick, armMeasure, _measure, setSwathBand, recordPosition } from './overlay.js';
import { openWfrDialog, openMeshExportDialog, exportMeshes, writeGridDisplayCache } from './meshexport.js';
import { exportGridAsc, exportGrid, buildGridExport, openGridExportDialog, gridForExport, GRID_EXPORT_FMTS } from './grid-export.js';
import { openSurfaceTools, gridOnLattice, openMeshGridDialog, openNewDialog } from './gridtools.js';
import { openExportDialog } from './export-dialog.js';
import { openSolidDialog, runSolidRecipe, openSolidRecipeConfigured, sbCfgOf, openDomainsDialog } from './bygeom-ui.js';
import { toggleFilterDrawer, renderFilterDrawer } from './filter-drawer.js';
import { sealedInfo, showAbout } from './help.js';
import { applyCalcCols, layerHasColumn, materializeCalcCol, openCalcWindow, ensureCalcDisplay, realizeCalc, realizeCalcPinned } from './calc.js';
import { showMemoryInfo } from './fileinfo.js';
import { openSettingsWindow } from './settings.js';
import { customTheme, setCustomTheme, clearCustomTheme, parseThemeJson, themeJson, registerTokens, contrast, setTheme, sceneDefault, resolvedTheme } from './theme.js';
import { openThemeEditor } from './theme-editor.js';
import { openExplode, explodeGroup, setLayerDisplayOffset, anyDisplaced } from './explode.js';
import { openTurntable, recordTurntable, turntableMime } from './turntable.js';
import { runTool, checkParams, toolList } from './tools.js';
import { openRecipeForm } from './recipe-form.js';
import { openLibraryWindow, libraryList, libraryPut, libraryGet, libraryDelete, packFromProject, packToYaml, packToZip, packFromFile, packIntoProject, runWithoutProject, offerRunOutputs, importPackFile } from './library.js';
import { listRuns, acceptRun, findBaseline } from './runrecord.js';
import { openRunsWindow } from './runs-ui.js';
import { openComposer, retargetFigure, openRetargetDialog, setHouseProps, addTitleBlock, composerFrameMenu, composerEnv, addKeyPlan, smallMultiples, refreshViews, refreshData, addResourceFrame, refreshAllFigures, staleOf, openFigurePdf, addViewFrame, addCanvasFrame, addTableFrame, legendContentFor, figurePdfBytes, composerEditor, currentFigure, compoPage, writePages, makeAtlasRoutine } from './composer.js';
import { openLineageWindow, exportLineageReport, lineageReportHtml } from './lineage-ui.js';
import { compareModels, compareCompat, buildComparisonReport, openCompareDialog, compareContent } from './compare.js';
import { renderEmptyProjects, addRecent } from './recents.js';
import { openBatchRename } from './rename.js';
import { deliverBlob } from './hostio.js';
import { openAttrTable, _attrTables } from './attrtable.js';
import { layerShown, setActiveLayer, rendererDocBbox, removeLayerUI } from './layers.js';
import { createView, setViewOffset, viewsOf, isView, canView, modelOf } from './layerviews.js';
import { confirmRemoveLayer, layerMenu, layerMenuSections, convertMeshLayer, fitLayer } from './layermenu.js';
import { nlSetEnabled, nlEnsureTrained, nlPropose, nlStats, nlHoldOut, describeSession as nlDescribeSession } from './nl.js';
import { applyLayerSelection, selectionStatus, selectVolume, selectByPolygon, selectionToColumn, filterToSelection, setSelStick, clearSelection, setSelThrough } from './selection.js';
import { paintVolume, openPaintPalette, createPaintCol, addPaintValue, paintArm, paintDisarm, paintApply, paintUndo, paintColByName } from './paint.js';
import { sectionWorld, setSectionWorld, applySection, captureSection, knifeCut, currentSection } from './section.js';
import { pickRecord, showRecord, pickHitPoint, pixelRay, blockHalfDims, meshHitAt, showMeshRecord, worldAtPoints } from './pick.js';
import { renderViewCanvas, recreateRenderer, setBlockEdges, renderer, cam, cameraWorld, setCameraWorld, renderFigureCanvas, setView } from './viewport.js';
import { openSample, makeSampleBlockCsv, openDemoProject, makeDemoBlockCsv, makeDemoDrillholes } from './samples.js';
import { windowsMenu, cascadeWindows, closeAllWindows } from './menubar.js';
import { COMMANDS } from './commands.js';
import { isPolygonLayer, featuresOf, pointInPolygonXY, preparePolygons, polygonAreaXY, setFeatureFill, setFeatureCategory } from './polygons.js';
import { resolveLimit, limitMaskOf, prepareScope, polygonLayers } from './polylimit.js';
import { extrudeSolids, extrudeToLayers, openExtrude } from './extrude.js';
import { sectionLines, sectionLinesToLayer, openSectionLines, resolvePlanes } from './sectionlines.js';
import { blockOutlines, blockOutlinesToLayer, openBlockOutlines } from './blockoutline.js';
import { manifoldCheck } from './extrude-core.js';
import { planCoverage } from './coverage.js';
import { buildFeatureExport, readFeatureFile } from './poly-io.js';
import { exportFeatures, copyFeaturesText, pasteFeaturesText, editFeatures, newFeatureLayer, setFeatureElevation } from './poly-ui.js';
import { DRAW as polyDraw, armDraw, armEditVertices, disarmPoly, addDraftVertex, finishDraw, moveVertex, insertVertex, deleteVertex, worldAt } from './poly-draw.js';
import { openPalette, closePalette } from './palette.js';

const $ = (s) => document.querySelector(s);

const _MODS = { 'ramp.js': _modRamp, 'color.js': _modColor, 'deco.js': _modDeco, 'coltypes.js': _modColtypes, 'props.js': _modProps, 'style-clip.js': _modStyleClip, 'undo.js': _modUndo };
// selection, by record index (the host API): read it, set it
function selectionRecords(L) {
  const m = L._selMask; if (!m || !L._selCount) return new Uint32Array(0);
  const out = new Uint32Array(L._selCount);
  for (let i = 0, k = 0; i < m.length && k < out.length; i++) if (m[i]) out[k++] = i;
  return out;
}
function setSelectionRecords(L, recs, mode = 'replace') {
  const n = attrRowCountOf(L);
  if (!n) throw new Error(`select: “${L.label || L.name}” has no records`);
  if (!['replace', 'add', 'remove'].includes(mode)) throw new Error(`select: mode is replace, add or remove (got ${JSON.stringify(mode)})`);
  const list = recs == null ? [] : recs;
  for (const r of list) if (!Number.isInteger(+r) || r < 0 || r >= n) throw new Error(`select: ${r} is not a record of “${L.label || L.name}”`);
  if (mode === 'replace' || !L._selMask || L._selMask.length !== n) {
    const keep = mode !== 'replace' && L._selMask && L._selMask.length === n ? L._selMask : null;
    L._selMask = keep || new Uint8Array(n);
    if (mode === 'replace') L._selMask.fill(0);
  }
  const v = mode === 'remove' ? 0 : 1;
  for (const r of list) L._selMask[r] = v;
  applyLayerSelection(L);
  selectionStatus(); markProjectDirty(); requestRender();
  return L._selCount || 0;
}

// a host's lasso (window.micro.selectInPolygon): micro's own visible or through
// selection, over a CSS-pixel polygon, on one layer (or every layer, as the
// user's lasso does). → the resulting selection count(s).
async function hostSelectInPolygon(lid, poly, { mode = 'replace', through = false } = {}) {
  const m = { replace: 'replace', add: 'add', remove: 'subtract' }[mode];
  if (!m) throw new Error(`micro: mode is replace, add or remove (got ${JSON.stringify(mode)})`);
  if (!Array.isArray(poly) || poly.length < 3 || !poly.every((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])))
    throw new Error('micro: selectInPolygon needs a polygon of at least 3 [x, y] canvas points');
  const pts = poly.map((p) => [+p[0], +p[1]]);
  if (lid != null) {
    const L = layerById(lid);
    if (L.kind === 'mesh' || !attrRowCountOf(L)) throw new Error(`micro: “${L.label || L.name}” has no records to select`);
  }
  if (through) await selectVolume(pts, m, false, lid);
  else selectByPolygon(pts, m, false, lid);
  const one = (L) => ({ layer: L.id, count: L._selCount || 0 });
  return lid != null ? one(layerById(lid)) : S.layers.filter((L) => L.kind !== 'mesh' && attrRowCountOf(L)).map(one);
}

window._micro = {
  get hasFSAA() { return S.hasFSAA; },
  mod: async (n) => { if (!_MODS[n]) throw new Error(`_micro.mod: ${n} is not exposed (add it to _MODS)`); return _MODS[n]; },
  compareModels, compareCompat, buildComparisonReport, openCompareDialog, compareContent,
  openComposer, retargetFigure, openRetargetDialog, colorSelFor, colorByName, runTool, checkParams,
  validationRun, listRuns, acceptRun, findBaseline, openRunsWindow, openRecipeForm, checkAllRecipes,
  openCheckAllRecipes, openLibraryWindow, libraryList, libraryPut, libraryGet, libraryDelete, packFromProject,
  packToYaml, packToZip, packFromFile, packIntoProject, runWithoutProject, offerRunOutputs, importPackFile,
  setHouseProps, addTitleBlock, house: () => S.house, composerFrameMenu, composerEnv, addKeyPlan,
  smallMultiples, refreshViews, refreshData, addResourceFrame, refreshAllFigures, staleOf, openFigurePdf,
  addViewFrame, addCanvasFrame, addTableFrame, legendContentFor, figurePdfBytes, composerEditor, currentFigure,
  compoPage, writePages, makeAtlasRoutine, renderViewCanvas, figures: () => S.figures, copyStyle, pasteStyle,
  captureStyle, applyStyle, createView, setViewOffset, changeLayerFile, layerTableHeader, setLang,
  lang: () => document.documentElement.lang, translateDom, openGradeShell, gradeShell, readField, contourField,
  smoothField, recoverSession, recreateRenderer, createMemDir, openSectionSeries, renderSectionSeries,
  seriesPositions, seriesExtent, sectionWorld, setSectionWorld, openPairing, pairBlocksSamples,
  selectDisagreeing, pairWins: _pairWins, openComposite, compositeLayer, compositeToLayer, openModelQa,
  modelQa, qaFindings, selectFinding, subBlockTiling, modelQaWins: _modelQaWins, measureClick, armMeasure,
  measureState: () => _measure, openExplode, explodeGroup, setLayerDisplayOffset, anyDisplaced, openTurntable,
  recordTurntable, turntableMime, openThemeEditor, customTheme, setCustomTheme, clearCustomTheme,
  parseThemeJson, themeJson, registerTokens, contrast, setTheme, sceneDefault, canChangeFile, viewsOf, isView,
  canView, modelOf, renderLayers, applySection, captureSection, openMeshQa, meshQaWins: _meshQaWins, openXyPlot,
  xyWins: _xyWins, openCrosstab, xtabWins: _xtabWins, parseCutoffs, openDhQa, qaWins: _qaWins, dhSetGroupOf,
  applySwathZebra, confirmRemoveLayer, undoLabel, startChunkBuilder, setCsvColumnar, canScanColumnar,
  zoneKeeper, paintVolume, layerShown, backupProject, restoreProject, openProjectPack, openPackFile,
  isPolygonLayer, featuresOf, pointInPolygonXY, preparePolygons, polygonAreaXY, setFeatureFill, setFeatureCategory,
  resolveLimit, limitMaskOf, prepareScope, polygonLayers, extrudeSolids, extrudeToLayers, openExtrude, manifoldCheck, planCoverage,
  sectionLines, sectionLinesToLayer, openSectionLines, resolvePlanes, blockOutlines, blockOutlinesToLayer, openBlockOutlines,
  buildFeatureExport, readFeatureFile, exportFeatures, copyFeaturesText, pasteFeaturesText, editFeatures, newFeatureLayer,
  setFeatureElevation, polyDraw, armDraw, armEditVertices, disarmPoly, addDraftVertex, finishDraw, moveVertex,
  insertVertex, deleteVertex, worldAt,
  savePackAsFolder, addLayer, setColumnQualify, rowQualifier, rawRecordOf, pick: pickRecord, deliverBlob,
  toggleLayersPanel, closeProject, openWfrDialog, wfr: { runWfrJob, packLayers, partsSink, handleSink },
  packLayersToWfr, setAutoPack, renderEmptyProjects, attrRowCountOf, locationsOf, hasRecords,
  primaryLocationOf, propKindLine, attrColumnsOf, fetchLayerRow, meshVertexData, meshVertexHeader, extendRow,
  schemaExt, calcFns, blockCaps, docPositionStream, layerRecords, openBlob, openBatchRename, groupMenu,
  layerMenu, layerMenuSections, openMeshExportDialog, exportMeshes, selectionToColumn, filterToSelection,
  applyCalcCols, openSurfaceTools, gridOnLattice, setSwathBand, saveRecipe, loadRecipes, runRecipe, runRoutine,
  expandRoutine, routineLoadParams, routineReadTableFull, routineEval, routineSubst, routineFilterRows,
  routineTargets, layerHasColumn, resultToLayer, fileLayerByPath, ensureGroupPath, openRoutineWindow,
  openInputsDialog, openRoutineTracker, recipesMenuItems, _recipesList: () => S.recipes, openStats,
  runFigureRecipe, captureFigureCfg, openSample, openBlocksBlob, setDmOrigin, makeSampleBlockCsv,
  openDemoProject, makeDemoBlockCsv, makeDemoDrillholes, setZExag, recolorSurface, setSurfaceFlatZ,
  setSurfaceSmooth, setGridBand, applyBlockFilter, showRecord, knifeCut, addRecent, fetchCsvRecord,
  currentSection, convertMeshLayer, openProps, setPropTab, showMemoryInfo, setRampCfg, bakeRampPixels, rampRangeFor,
  applyCatLegend, runRules, syncRuleMode, applyRuleVisibility, openPaintPalette, createPaintCol, addPaintValue,
  paintArm, paintDisarm, paintApply, paintUndo, paintColByName, setLayerColorSel, runExport, openExportDialog,
  exportColumnsOf, selectBySolid, ratioBySolid, flagBySolid, selectByGridSurface, ratioByGridSurface,
  flagByGridSurface, matColSet, matColList, matColGet, persistElement, loadElement, matColDelete,
  ensureStoredValues, pinPutMatcol, buildElementManifest, buildDhSetManifest, buildGridElementManifest,
  descFromElement, broadcastCollarCol, materializeCalcCol, setPinBudget, pinStats, rampRangeFor,
  meshToGridLayer, rasterizeMeshToGrid, applyGridExtend, fillGridNearest, fillGridTrend, markGridExterior,
  residentGridForEval, surfaceFromGrid, writeEsriAsc, writeSurferGrd, readSurferGrd, writeGridDisplayCache,
  exportGridAsc, exportGrid, buildGridExport, openGridExportDialog, gridForExport, GRID_EXPORT_FMTS,
  openMeshGridDialog, openNewDialog, buildEmptyGrid, buildEmptyBlockCsv, alignAxis, coverGeometry,
  openGridBlob, meshSolidOf, openSolidDialog, openParquetBlocks, convertLayerToParquet, setAutoOptimize,
  setWindingGpu, runSolidRecipe, openSolidRecipeConfigured, sbCfgOf, gridAxesOf, runSpatialJoin, runReconcile,
  runKeyJoin, spatialJoinToCols, keyJoinToCols, gridsCompatible, commonLattice, openProps, numericColsOf,
  scanColumns, colStatsComplete, footerColStats, openGradeTonnage, computeGT, openSwath, computeSwath,
  swathDir, dirTrendPlunge, frameDipDirDipRake, openLineageWindow, openCalcWindow, ensureCalcDisplay,
  realizeCalc, realizeCalcPinned, exportLineageReport, lineageReportHtml, openPalette, closePalette, COMMANDS,
  openValidation, openContact, scanContact, meshDistanceOf, writeDistanceColumn, contactWins: _contactWins,
  openFactors, scanFactors, factorsStOf, factorsWins: _factorsWins, extractSamples, computeSampleSwath,
  declusterWeights, setDeco, setDecoTitle, setLayerLegend, exportFigure, setFigScale, drawDecorations,
  decorationsMenu, openDecoPanel, setBg, setTheme, resolvedTheme, setBlockEdges, windowsMenu, cascadeWindows,
  closeAllWindows, sealedInfo, openSettingsWindow, setSelStick, setProjection, projectionStatus,
  projectionSupport, createLayerGroup, layerTree: () => S.layerTree, applyTreeVisibility, treeMove,
  addIntervalToSet, redesurveySet, reopenDh, showHoleTraces, showCollars, hideCollars, setHoleFilter,
  applyHoleFilter, filterHolesSet, dhFilterSweep, openCsvTableWindow, collarsRowMenu, surveyRowMenu,
  openDhDialog, openObjSplit, openLfmSplit, assignDomains, openDomainsDialog, openAttrTable,
  attrTables: _attrTables, selectByPolygon, selectVolume, clearSelection, setSelThrough,
  blockDoc: () => activeDocs().blockDoc || null, layers: () => S.layers, setActiveLayer,
  activeId: () => S.activeId, openProjectDir, saveProject, saveProjectAs, tidyProject, scanFolderForNewData,
  reloadLayerFromDisk, canReloadLayer, openTableBlob, applyTableFilter, useAsCategory, reopenWithMapping,
  openXlsxBlob, openWorkbook, openFilesDialog, reopenAs, reinterpretOptions, project: () => S.project,
  views: () => S.views, scenes: () => S.scenes, toggleFilterDrawer, renderFilterDrawer, saveViewAs, applyView,
  saveSceneAs, applyScene, captureScene, removeBookmark, removeScene, importDrillholes: openDrillholeLayer,
  recordPosition, pickHitPoint, pixelRay, blockHalfDims, meshHitAt, showMeshRecord, syncMeshPickable,
  openStructure, structureAfterEdit, openStereonet, importPaintedSets, removeTrace, tracesToDxf, structureWins: _structWins,
  structureOf, prepareStructure, measurePlanes, traceNetwork, planesToTable, structureArmed, nlSetEnabled,
  nlEnsureTrained, nlPropose, nlDescribeSession, showAbout, nlStats, nlHoldOut, renderer, cam, get frame() { return S.frame; },
  requestRender, docBbox: rendererDocBbox,
};

// ── inside the lead-acid shell (POSTURE A): files shared or opened INTO micro arrive
// as fs tokens (mmap'd ranged reads) — the shim's fileBlob makes each a Blob-shaped
// source, and openBlob dispatches by name exactly as it would a dropped File. The
// first file replaces an empty scene; later ones add layers. On the web `shell.present`
// is false and none of this runs.
if (shell.present) {
  shell.intake(async (item) => {
    try {
      if (item.kind === 'file') {
        await openBlob(item.blob, item.name, S.layers.length ? 'add' : 'replace');
        $('#meta').textContent = `opened ${item.name} from the shell (${(item.size / 1048576).toFixed(1)} MB, ranged reads)`;
      } else if (item.kind === 'error') $('#meta').textContent = `${item.error} (${item.name})`;
    } catch (e) { $('#meta').textContent = `could not open ${item.name || 'the shared file'}: ${e.message || e}`; }
  }).catch(() => { /* no intake plugin in this build */ });
  window._micro.shell = shell;
}

// ── window.micro — the HOST API (src/host-api.js; manual appendix D). The small,
// versioned surface a host page builds on; window._micro above stays the smokes'
// unstable reach into everything. Announced last: micro is up. ──
const _host = createHostApi({
  toolList, runTool, checkRoutine: checkRoutineHost, runRoutine: runRoutineHost, listRuns, acceptRun,
  followLayer, addLayer, removeLayer: removeLayerUI, createView, setViewOffset, setActiveLayer, applyBlockFilter, pickRecord,
  openFile: async (src, o) => {
    const f = await ingestSource(src, 'open()\'s file');
    const lid = await openBlob(f, String(o.name || f.name || 'file'), 'add', null, { throw: true, ...(o.acceptLattice != null ? { acceptLattice: o.acceptLattice } : {}) });
    if (lid != null && o.group) fileLayersInGroup(o.group, [lid]);
    return lid;
  },
  treeChanged: () => { applyTreeVisibility(); renderLayers(); markProjectDirty(); },
  colorByName, colorChoices, colorSelFor, setLayerColorBy,
  layerColorRange, setLayerColorRange, layerPalette, setLayerPalette, paletteList,
  groupPathOf, groupsList, fileLayersInGroup, ungroupAt, setGroupVisible,
  showLayer: (id, on) => showNode(id, on),
  setGroupExclusive: (path, on) => { const g = groupAt(path); if (!g) return false; setGroupExclusive(g, on); return true; },
  stepGroup: (path, dir) => { const g = groupAt(path); if (!g) return null; if (!g.exclusive) return false; stepExclusive(dir, g); return true; },
  sectionWorld, setSectionWorld, cameraWorld, setCameraWorld, renderFigure: renderFigureCanvas,
  decorations: hostDecorations, setDecorations: setHostDecorations,
  layerSectioned: (id) => renderer.layerSectioned(id), setLayerSectionMode,
  backupProject, restoreProject, openProjectPack, savePackAsFolder,
  setDetectionLimits: (L, column, policy) => {
    const h = layerTableHeader(L), i = h ? h.columns.indexOf(column) : -1;
    if (i < 0) throw new Error(`micro: no column “${column}” on “${L.label || L.name}”`);
    if (!rowQualifier(L) || !colIsNumeric(L, h, i)) throw new Error(`micro: “${column}” isn’t a numeric column of a CSV or drillhole layer`);
    const p = policy || {};
    if (p.below != null && !['half', 'limit', 'zero', 'blank'].includes(p.below)) throw new Error('micro: below must be half | limit | zero | blank');
    if (p.above != null && !['limit', 'blank'].includes(p.above)) throw new Error('micro: above must be limit | blank');
    return setColumnQualify(L, i, { ...qualifyPolicy(L, column), ...p }).then(() => undefined);
  },
  selectionRecords, setSelectionRecords, clearSelection: () => clearSelection({ silent: true }),
  worldAtPoints, selectInPolygon: hostSelectInPolygon,
  mirrorFilterBox: (e) => { $('#filter').value = e; syncFilterClear(); },
  clearPick: () => { $('#recPanel').classList.remove('show'); $('#rpCfg').classList.remove('show'); renderer.setPicked(null); requestRender(); },
  fit: (L) => { if (L) fitLayer(L); else if (renderer.chunkCount) { cam.fit(rendererDocBbox()); requestRender(); } },
  look: (v) => ({
    north: () => setView(-Math.PI / 2, 0), south: () => setView(Math.PI / 2, 0),
    east: () => setView(Math.PI, 0), west: () => setView(0, 0),
    plan: () => setView(cam.state.theta, PHI_MAX), below: () => setView(cam.state.theta, -PHI_MAX),
  })[v](),
});
window.micro = _host.api;
window._micro.setColorBy = (id, column) => _host.api.setColorBy(id, column);   // what plow's studio feature-detects
_host.announce();
