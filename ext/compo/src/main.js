// @gcu/compo — a figure / page composer. See README.md.
export { COMPO_FORMAT, COMPO_VERSION, PAPER, pageDims, createDocument, parseDocument, serializeDocument, newId, addFrame, frameById, renameFrame, sanitizeId, ID_RE, idPrefix, removeFrames, bringToFront, sendToBack, bringForward, sendBackward, alignFrames, distributeFrames, matchSize, groupFrames, ungroupFrames, expandGroups, unitsOf, boundsOf, gatherGroup, pruneGroups, moveInStack, snapBox, snapResize } from './model.js';
export { SANS, MONO, fontMm, registerKind, kindOf, resolveFields, layoutText, replayDrawList, niceBelow, frameWorldPerMm, tableFromTsv } from './kinds.js';
export { registerField, fieldList, formatNumber, formatDate, refFrame, subjectFrame, isFormatSpec } from './fields.js';
export { renderPage, ensureImages, exportPDF, exportPNG } from './render.js';
export { mountEditor } from './editor.js';
