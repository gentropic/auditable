// @gcu/compo — a figure / page composer. See README.md.
export { COMPO_FORMAT, COMPO_VERSION, PAPER, pageDims, createDocument, parseDocument, serializeDocument, newId, addFrame, frameById, renameFrame, sanitizeId, ID_RE, idPrefix, removeFrames, bringToFront, sendToBack, bringForward, sendBackward, alignFrames, distributeFrames, matchSize, groupFrames, ungroupFrames, expandGroups, unitsOf, boundsOf, gatherGroup, pruneGroups, moveInStack, snapBox, snapResize } from './model.js';
export { SANS, MONO, fontMm, registerKind, kindOf, resolveFields, layoutText, replayDrawList, niceBelow, frameWorldPerMm, tableFromTsv } from './kinds.js';
export { registerField, fieldList, formatNumber, formatDate, refFrame, subjectFrame, isFormatSpec, groupDigits, significant, fmtBearing } from './fields.js';
export { hasProj, isOrthoProj, imageRect, worldToPage, pageToWorld, worldTicks, drawTicks, niceStep, fmtCoord, planeTrace, drawOverlays, drawVector } from './world.js';
export { renderPage, ensureImages, exportPDF, exportPNG, figureFromPdf } from './render.js';
export { HOUSE_KEYS, FIGURE_KEYS, setTemplate, docFromTemplate, TITLE_BLOCK_ROWS, titleBlockFrames } from './house.js';
export { addTitleBlock, addImageSrc, addImageFromFile, readImageFile, multiplesGrid, smallMultiples } from './insert.js';
export { mountEditor } from './editor.js';
export { ICONS, iconSvg, iconButton } from './icons.js';
