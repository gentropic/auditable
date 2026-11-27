// @gcu/compo — a figure / page composer. See README.md.
export { COMPO_FORMAT, COMPO_VERSION, PAPER, pageDims, createDocument, parseDocument, serializeDocument, newId, addFrame, frameById, renameFrame, sanitizeId, ID_RE, idPrefix, removeFrames, bringToFront, sendToBack, bringForward, sendBackward, alignFrames, distributeFrames, matchSize, groupFrames, ungroupFrames, expandGroups, unitsOf, boundsOf, gatherGroup, pruneGroups, moveInStack, snapBox, snapResize, freeSpot, LOAD_MIGRATIONS, DEFAULT_STYLES, STYLE_CONTENT_KEYS, stylesOf, styleFromFrame, applyStyleToFrame, defineStyle } from './model.js';
export { TAG36H11, tagCells } from './apriltag.js';
export { SANS, MONO, SERIF, fontMm, registerKind, kindOf, canPin, canRotate, pinToPage, pageToPin, resolveFields, layoutText, drawText, refreshLegend, legendEntries, legendKey, LEGEND_USER_KEYS, replayDrawList, niceBelow, frameWorldPerMm, tableFromTsv, setQrEncoder, hasQrEncoder, qrContent } from './kinds.js';
export { registerField, fieldList, formatNumber, formatDate, refFrame, subjectFrame, isFormatSpec, groupDigits, significant, fmtBearing } from './fields.js';
export { hasProj, isOrthoProj, imageRect, worldToPage, pageToWorld, worldTicks, drawTicks, niceStep, fmtCoord, planeTrace, drawOverlays, drawVector } from './world.js';
export { renderPage, ensureImages, exportPDF, exportPNG, figureFromPdf } from './render.js';
export { exportSVG, SvgContext2D } from './svg.js';
export { HOUSE_KEYS, FIGURE_KEYS, setTemplate, docFromTemplate, TITLE_BLOCK_ROWS, titleBlockFrame, titleBlockFrames, migrateTitleBlocks } from './house.js';
export { addTitleBlock, addImageSrc, addImageFromFile, readImageFile, multiplesGrid, smallMultiples } from './insert.js';
export { mountEditor } from './editor.js';
export { ICONS, iconSvg, iconButton } from './icons.js';
