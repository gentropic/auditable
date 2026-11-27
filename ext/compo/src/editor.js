// The page editor — host-agnostic DOM. A toolbar (page size / orientation / custom mm, zoom, add
// text, align · distribute, front / back, delete, plus the HOST's buttons), the page preview with
// a frame overlay (select · shift-select · drag to move with snapping guides · 8 handles to
// resize · arrows nudge · Delete · ⌘D duplicate · ⌘Z / ⌘⇧Z undo),
// box select (drag on empty page), groups (⌘G / ⌘⇧G: select and move as one), equal-spacing
// guides, snapping while resizing, match size, one-step z-order (⌘] / ⌘[), locks (a locked frame
// won't move, resize or delete), rulers (drag a guide out of one; drag it back to remove it), a
// grid that snaps, an item list (front first: show / hide, lock, rename, drag to restack, groups as
// folders), a context menu (host items +
// built-ins) and an inspector for the selected frame (box in mm, border, the kind's own fields).
//
// mountEditor(el, doc, { env, onChange(doc), toolbar: [{ label, title, run(editor) }],
//   frameMenu(frame, editor) → [{ label, run }], inspector(frame, panelEl, editor) }) → editor

import { freeSpot, stylesOf, styleFromFrame, applyStyleToFrame, defineStyle } from './model.js';
import { renameFrame, sanitizeId, PAPER, pageDims, addFrame, frameById, removeFrames, bringToFront, sendToBack, bringForward, sendBackward, alignFrames, distributeFrames, matchSize, groupFrames, ungroupFrames, expandGroups, unitsOf, boundsOf, moveInStack, snapBox, snapResize, serializeDocument } from './model.js';
import { renderPage, ensureImages } from './render.js';
import { kindOf, canPin, canRotate, pageToPin, legendEntries, legendKey, layoutText, resolveFields, hasQrEncoder, qrContent, tableFromTsv, northAnglesOf } from './kinds.js';
import { fieldList, subjectFrame, refFrame } from './fields.js';
import { hasProj } from './world.js';
import { iconButton } from './icons.js';

const CSS = `
.compo-root { display: flex; flex-direction: column; height: 100%; min-height: 0; font: 12px/1.35 var(--compo-font, system-ui, sans-serif); color: var(--compo-fg, var(--text, #ddd)); outline: none; }
.compo-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 6px; border-bottom: 1px solid var(--compo-border, var(--border, #3a3d42)); }
.compo-bar button, .compo-bar select, .compo-bar input, .compo-side input, .compo-side select, .compo-side textarea, .compo-side button { background: var(--compo-btn, var(--bg-btn, #2a2d31)); color: inherit; border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 3px; font: inherit; padding: 2px 6px; }
.compo-bar button:hover:not(:disabled) { border-color: var(--compo-accent, var(--accent, #fb9044)); }
.compo-bar button:disabled { opacity: 0.4; }
.compo-bar button, .compo-bar select { box-sizing: border-box; height: 24px; }
.compo-bar .compo-grp-bar { display: inline-flex; gap: 3px; align-items: center; flex-wrap: wrap; min-width: 0; }   /* moves to the next line whole; wraps inside only when wider than the bar */
.compo-bar button.compo-ico { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 26px; padding: 0 4px; cursor: pointer; }
.compo-bar button.compo-ico svg { width: 16px; height: 16px; flex: none; display: block; }
.compo-bar button.compo-ico.with-text { padding: 0 7px 0 5px; }
.compo-bar button[aria-pressed=true] { border-color: var(--compo-accent, var(--accent, #fb9044)); color: var(--compo-accent, var(--accent, #fb9044)); }
.compo-bar button:focus-visible, .compo-bar select:focus-visible, .compo-bar input:focus-visible { outline: 2px solid var(--compo-accent, var(--accent, #fb9044)); outline-offset: 1px; }
.compo-bar .sep { width: 1px; align-self: stretch; background: var(--compo-border, var(--border, #3a3d42)); margin: 0 3px; }
.compo-bar input[type=number] { width: 52px; }
.compo-main { flex: 1; display: flex; min-height: 0; }
.compo-scroll { flex: 1; overflow: auto; background: var(--compo-desk, #55585d); position: relative; }
.compo-pagewrap { position: relative; margin: 24px auto; box-shadow: 0 2px 14px rgba(0,0,0,0.45); }
.compo-pagewrap canvas { display: block; }
.compo-overlay { position: absolute; inset: 0; }
.compo-fr { position: absolute; box-sizing: border-box; cursor: move; }
.compo-fr:hover { outline: 1px dashed rgba(60, 130, 230, 0.7); }
.compo-fr.sel { outline: 1.5px solid #3c82e6; }
.compo-fr.locked { cursor: default; }
.compo-h { position: absolute; width: 8px; height: 8px; background: #fff; border: 1.5px solid #3c82e6; box-sizing: border-box; margin: -4px 0 0 -4px; }
.compo-guide { position: absolute; background: #e6339a; pointer-events: none; }
.compo-margin { position: absolute; border: 1px dashed rgba(60, 130, 230, 0.35); pointer-events: none; }
.compo-side { width: 230px; overflow: auto; padding: 8px; border-left: 1px solid var(--compo-border, var(--border, #3a3d42)); display: flex; flex-direction: column; gap: 6px; }
/* the inspector is ONE grid: a label column, and a value cell whose controls fill it — every row
   lines up whatever its controls are (one select, an x/y pair, a checkbox, three numbers) */
.compo-side .row { display: grid; grid-template-columns: 64px minmax(0, 1fr); column-gap: 8px; align-items: center; min-height: 24px; }
.compo-side .row > span:first-child { color: var(--compo-dim, var(--dim, #9a9a9a)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.compo-side .ctl { display: flex; gap: 6px; align-items: center; min-width: 0; }
.compo-side .ctl > input:not([type=checkbox]), .compo-side .ctl > select { flex: 1 1 0; min-width: 0; width: auto; }
.compo-side .ctl > input[type=checkbox] { margin: 0; }
.compo-side .ctl > .hint { flex: none; }
.compo-side .ctl.stack { flex-direction: column; align-items: stretch; gap: 3px; }
.compo-side .ctl.stack > .pair { flex: none; }
.compo-side .row:has(.stack) { align-items: start; }
.compo-side .row:has(.stack) > span:first-child { line-height: 22px; }
.compo-side .pair { flex: 1 1 0; display: flex; gap: 4px; align-items: center; min-width: 0; }
.compo-side .leg { display: flex; gap: 4px; align-items: center; min-height: 24px; }
.compo-side .leg input:not([type]), .compo-side .leg input[type=text] { flex: 1 1 auto; min-width: 0; }
.compo-side .leg input[type=color] { width: 26px; padding: 0; flex: 0 0 auto; }
.compo-side .leg button { min-width: 22px; padding: 0 3px; }
.compo-side .leg.off input:not([type=color]) { opacity: 0.45; }
.compo-side .pair > i { font-style: normal; color: var(--compo-dim, var(--dim, #9a9a9a)); width: 8px; text-align: center; }
.compo-side .pair > input { flex: 1 1 0; min-width: 0; width: auto; }
.compo-side .row input:not([type=checkbox]), .compo-side .row select { box-sizing: border-box; height: 22px; }
.compo-side textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-family: var(--compo-mono, monospace); }
.compo-cells { white-space: pre; overflow-x: auto; tab-size: 12; font-size: 11px; }
.compo-side .hint { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; }
.compo-fr.locked::after { content: 'locked'; position: absolute; right: 1px; top: 1px; font: 9px/1 system-ui, sans-serif; padding: 1px 3px; background: rgba(40,40,40,0.75); color: #fff; border-radius: 2px; pointer-events: none; }
.compo-grp { position: absolute; border: 1px dashed #3c82e6; pointer-events: none; box-sizing: border-box; }
.compo-marq { position: absolute; border: 1px solid #3c82e6; background: rgba(60,130,230,0.12); pointer-events: none; }
.compo-badge { position: absolute; left: 1px; top: 1px; font: 9px/1.2 system-ui, sans-serif; padding: 1px 4px; background: #c98a00; color: #111; border-radius: 2px; pointer-events: auto; cursor: help; max-width: calc(100% - 6px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
.compo-it .warn { color: #c98a00; margin-left: 4px; cursor: help; }
.compo-link { position: absolute; height: 0; border-top: 1px dashed #3c82e6; transform-origin: 0 0; pointer-events: none; z-index: 2; }
.compo-fr.ref { outline: 1px dashed #3c82e6; outline-offset: 2px; }
.compo-it .nm .ds { color: var(--compo-dim, var(--dim, #9a9a9a)); margin-left: 6px; font-weight: normal; }
.compo-side input.compo-id { font-family: var(--compo-mono, monospace); }
.compo-side input.compo-id.bad { outline: 1px solid #c33; }
.compo-gap { position: absolute; background: #e6339a; pointer-events: none; }
.compo-gap-l { position: absolute; font: 10px/1 system-ui, sans-serif; color: #fff; background: #e6339a; padding: 1px 3px; border-radius: 2px; transform: translate(-50%, -50%); pointer-events: none; white-space: nowrap; }
.compo-bar .status { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; margin-left: 4px; }
.compo-scroll { padding-left: 22px; }
.compo-pagewrap { margin: 30px auto 24px; }
.compo-ruler { position: absolute; cursor: crosshair; }
.compo-ruler.top { left: 0; top: -19px; } .compo-ruler.left { top: 0; left: -19px; }
.compo-gl { position: absolute; z-index: 3; }
.compo-gl.x { top: 0; height: 100%; width: 7px; margin-left: -3px; cursor: ew-resize; }
.compo-gl.y { left: 0; width: 100%; height: 7px; margin-top: -3px; cursor: ns-resize; }
.compo-gl::after { content: ''; position: absolute; background: #12a4c4; }
.compo-gl.x::after { left: 3px; top: 0; bottom: 0; width: 1px; } .compo-gl.y::after { top: 3px; left: 0; right: 0; height: 1px; }
.compo-items { display: flex; flex-direction: column; gap: 1px; max-height: 42%; overflow: auto; flex-shrink: 0; padding-bottom: 6px; border-bottom: 1px solid var(--compo-border, var(--border, #3a3d42)); }
.compo-items .ttl { display: flex; justify-content: space-between; color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; padding: 0 2px 3px; }
.compo-it { display: flex; align-items: center; gap: 3px; padding: 2px 3px; border-radius: 3px; user-select: none; }
.compo-it:hover { background: rgba(127,127,127,0.12); }
.compo-it.sel { background: rgba(60,130,230,0.3); }
.compo-it.mem { padding-left: 16px; }
.compo-it.grp .nm { font-weight: bold; }
.compo-it.hid .nm { opacity: 0.45; text-decoration: line-through; }
.compo-side .compo-it button { background: none; border: 0; padding: 0 2px; width: 18px; color: inherit; cursor: pointer; font: inherit; opacity: 0.85; }
.compo-it .nm { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.compo-it .nm input { width: 100%; box-sizing: border-box; }
.compo-it.drop-above { box-shadow: inset 0 2px 0 #3c82e6; } .compo-it.drop-below { box-shadow: inset 0 -2px 0 #3c82e6; }
.compo-insp { display: flex; flex-direction: column; gap: 6px; }
.compo-menu { position: fixed; z-index: 99999; background: var(--compo-btn, var(--bg-panel, #24272b)); border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 4px; padding: 3px 0; min-width: 150px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.compo-menu div { padding: 4px 12px; cursor: pointer; }
.compo-menu div:hover { background: var(--compo-accent, var(--accent, #fb9044)); color: #111; }
`;
let _css = false;
function injectCss() { if (_css || typeof document === 'undefined') return; _css = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v; else if (k in e) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };

// frames that refer to another (captions, scale bars, north arrows) and frames that can be referred to (views: they state a scale)
// any CSS colour → #rrggbb for an <input type=color> (which takes nothing else)
let _cc = null;
function toHex(css, dflt = '#1a1a1a') {
  if (!css) return dflt;
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  try {
    if (!_cc) _cc = document.createElement('canvas').getContext('2d');
    _cc.fillStyle = '#000'; _cc.fillStyle = css; const v = _cc.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : dflt;
  } catch { return dflt; }
}
const canRefer = (f) => f.kind === 'text' || f.kind === 'scalebar' || f.kind === 'north' || f.kind === 'label' || f.kind === 'titleblock';
const isReferable = (f) => !!(f.content && f.content.meta);
export function mountEditor(el, doc, opts = {}) {
  injectCss();
  let D = doc, zoom = 3, sel = [];
  const hist = [], fut = [];
  const env = () => ({ ...(opts.env || {}) });
  // the height a text or label frame's content needs, mm — laid out exactly as the kinds lay it out
  let _mc = null;
  function contentHeight(f) {
    const c = f.content || {}, isLabel = f.kind === 'label';
    if (!_mc) _mc = document.createElement('canvas').getContext('2d');
    const size = +c.size || (isLabel ? 7 : 9), pad = isLabel ? 0.8 : (c.pad ?? 1);
    const text = resolveFields(isLabel ? (c.text != null ? c.text : (c.md || '')) : (c.md || ''), { ...env(), doc: D, title: D.title }, f);
    const fam = c.font || (c.mono ? 'mono' : (D.page && D.page.font) || 'sans');
    const { lines } = layoutText(_mc, text, f.box[2] - 2 * pad, { size, mono: fam === 'mono', serif: fam === 'serif', lineHeight: +c.lineHeight || 1.25 });
    return lines.reduce((s, l) => s + (l.gap || 0) + l.lh, 0) + 2 * pad;
  }
  const root = h('div', { className: 'compo-root', tabIndex: 0 });
  const bar = h('div', { className: 'compo-bar' });
  const scroll = h('div', { className: 'compo-scroll' });
  const wrap = h('div', { className: 'compo-pagewrap' });
  const cv = h('canvas');
  const overlay = h('div', { className: 'compo-overlay' });
  const side = h('div', { className: 'compo-side' });
  const rulerTop = h('canvas', { className: 'compo-ruler top', title: 'drag down for a guide' }), rulerLeft = h('canvas', { className: 'compo-ruler left', title: 'drag right for a guide' });
  const items = h('div', { className: 'compo-items' }), insp = h('div', { className: 'compo-insp' });
  side.append(items, insp);
  let showRulers = true; try { showRulers = localStorage.getItem('compo.rulers') !== 'off'; } catch { /* private */ }
  wrap.append(cv, overlay, rulerTop, rulerLeft); scroll.append(wrap);
  root.append(bar, h('div', { className: 'compo-main' }, scroll, side));
  el.replaceChildren(root);

  // ── history ──
  const snap = () => serializeDocument(D);
  const imgCache = new Map();                              // frame id → decoded bitmap (survives undo)
  const keepImgs = () => { for (const f of D.frames) if (f._img) imgCache.set(f.id, { img: f._img, jpeg: f._jpeg }); };
  let _nudge = null;                                       // a run of arrow nudges in progress (one undo step); any other change ends it
  function commit(fn) {
    _nudge = null;
    keepImgs();
    hist.push(snap()); if (hist.length > 80) hist.shift(); fut.length = 0;
    fn();
    changed();
  }
  function restoreFrom(json) {
    keepImgs();
    const next = JSON.parse(json);
    for (const f of next.frames) { const c = imgCache.get(f.id); if (c) { f._img = c.img; f._jpeg = c.jpeg; } }
    D = next; sel = sel.filter((id) => frameById(D, id)); changed();
  }
  const undo = () => { if (!hist.length) return; _nudge = null; fut.push(snap()); restoreFrom(hist.pop()); };
  const redo = () => { if (!fut.length) return; _nudge = null; hist.push(snap()); restoreFrom(fut.pop()); };
  function changed() { render(); if (opts.onChange) opts.onChange(D); }

  // ── toolbar ──
  const btn = (label, title, run) => h('button', { textContent: label, title, onclick: () => { run(); root.focus(); } });
  const sizeSel = h('select', { title: 'paper size' });
  for (const k of [...Object.keys(PAPER), 'custom']) sizeSel.append(h('option', { value: k, textContent: k }));
  const oriSel = h('select', { title: 'orientation' }, h('option', { value: 'portrait', textContent: 'portrait' }), h('option', { value: 'landscape', textContent: 'landscape' }));
  const wIn = h('input', { type: 'number', title: 'page width (mm)', min: 10, step: 1 }), hIn = h('input', { type: 'number', title: 'page height (mm)', min: 10, step: 1 });
  const customSpan = h('span', { style: 'display:inline-flex;gap:3px;align-items:center' }, wIn, '×', hIn, ' mm');
  sizeSel.onchange = () => commit(() => {
    if (sizeSel.value === 'custom') { const [w, hh] = pageDims(D.page); D.page = { ...D.page, size: 'custom', width: w, height: hh }; } else D.page = { ...D.page, size: sizeSel.value };
  });
  oriSel.onchange = () => commit(() => { D.page = { ...D.page, orientation: oriSel.value }; });
  wIn.onchange = hIn.onchange = () => commit(() => { D.page = { ...D.page, size: 'custom', width: Math.max(10, +wIn.value || 10), height: Math.max(10, +hIn.value || 10) }; });
  const zoomSel = h('select', { title: 'zoom' });
  for (const [v, t] of [['fit', 'fit'], ['2', '50%'], ['3', '75%'], ['3.78', '100%'], ['5.67', '150%'], ['7.56', '200%']]) zoomSel.append(h('option', { value: v, textContent: t }));
  zoomSel.onchange = () => { if (zoomSel.value === 'fit') zoomFit(); else { zoom = +zoomSel.value; render(); } };
  const gridSel = h('select', { title: 'grid — shown and snapped to' });
  for (const [v, t] of [['0', 'no grid'], ['1', 'grid 1 mm'], ['2', 'grid 2 mm'], ['5', 'grid 5 mm'], ['10', 'grid 10 mm']]) gridSel.append(h('option', { value: v, textContent: t }));
  gridSel.onchange = () => commit(() => { const v = +gridSel.value; const p = { ...D.page }; if (v) p.grid = { size: v, show: true, snap: true }; else delete p.grid; D.page = p; });
  // an icon button: its words are the aria-label and the tooltip (with the shortcut, if any)
  const ib = (icon, label, keys, title, run) => iconButton({ icon, label, keys, title, run: () => { run(); root.focus(); } });
  const rulersBtn = ib('rulers', 'Rulers', '', 'show or hide them; drag a guide out of a ruler, drag it back to remove it', () => { showRulers = !showRulers; try { localStorage.setItem('compo.rulers', showRulers ? 'on' : 'off'); } catch { /* private */ } render(); });
  const alignBtns = [['align-left', 'left', 'Align left'], ['align-hcenter', 'hcenter', 'Align centres'], ['align-right', 'right', 'Align right'], ['align-top', 'top', 'Align top'], ['align-vcenter', 'vcenter', 'Align middles'], ['align-bottom', 'bottom', 'Align bottom']]
    .map(([icon, how, l]) => ib(icon, l, '', 'two or more frames; a locked one stays put and is the reference', () => commit(() => alignFrames(D, sel, how))));
  const distBtns = [['dist-h', 'h', 'Distribute horizontally'], ['dist-v', 'v', 'Distribute vertically']].map(([icon, ax, l]) => ib(icon, l, '', 'equal gaps between three or more frames', () => commit(() => distributeFrames(D, sel, ax))));
  const sizeBtns = [['same-w', 'w', 'Same width'], ['same-h', 'h', 'Same height'], ['same-wh', 'both', 'Same size']].map(([icon, what, l]) => ib(icon, l, '', 'as the first selected frame', () => commit(() => matchSize(D, sel, what))));
  const groupBtn = ib('group', 'Group', '⌘G', 'the selected frames select and move as one', () => doGroup());
  const ungroupBtn = ib('ungroup', 'Ungroup', '⌘⇧G', '', () => doUngroup());
  const frontBtn = ib('front', 'Bring to front', '⌘⇧]', '', () => commit(() => bringToFront(D, sel)));
  const fwdBtn = ib('forward', 'Bring forward', '⌘]', 'one step', () => commit(() => bringForward(D, sel)));
  const bwdBtn = ib('backward', 'Send backward', '⌘[', 'one step', () => commit(() => sendBackward(D, sel)));
  const backBtn = ib('back', 'Send to back', '⌘⇧[', '', () => commit(() => sendToBack(D, sel)));
  const delBtn = ib('trash', 'Delete', 'Delete', 'the selected frames (locked ones stay)', () => del());
  const undoBtn = ib('undo', 'Undo', '⌘Z', '', () => undo()), redoBtn = ib('redo', 'Redo', '⌘⇧Z', '', () => redo());
  const status = h('span', { className: 'status' });
  let _stT = 0;
  const say = (msg) => { status.textContent = msg; clearTimeout(_stT); _stT = setTimeout(() => { status.textContent = ''; }, 4000); if (opts.onStatus) opts.onStatus(msg); };
  const sep = () => h('span', { className: 'sep' });
  // undo · add frames (the host's first, then label and text) · align, distribute, match size ·
  // group · stacking and delete · the page
  // each group wraps as a whole on a narrow bar, never split in the middle
  const grp = (...kids) => h('span', { className: 'compo-grp-bar' }, ...kids);
  const hostBtns = (opts.toolbar || []).map((t) => { const run = () => t.run(api); return t.icon ? ib(t.icon, t.label, t.keys || '', t.title || '', run) : btn(t.label, t.title || '', run); });
  bar.append(grp(undoBtn, redoBtn), sep(),
    grp(...hostBtns, ib('label', 'Add label', '', 'a label pinned to a point in a 3D view, or a direction on a stereonet (the host may supply the point)', () => addLabel()),
      ib('text', 'Add text', '', 'a text frame — a caption (fields: {fig} {page} {date} ${…})', () => add({ kind: 'text', content: { md: '**Figure {fig}.** caption', size: 9 } })),
      ib('shape', 'Add shape', '', 'a rectangle, an ellipse, a line or an arrow — a box round something, a pointer', () => add({ kind: 'shape', box: freeSpot(D, 40, 25), content: { shape: 'rect' } })),
      ib('qr', 'Add QR code', '', 'a link or a text, scannable from the printed page', () => addQr()),
      ib('fiducial', 'Add marker', '', 'an AprilTag (36h11) a camera or scanner can find: a printed page that knows where it is', () => add({ kind: 'fiducial', box: freeSpot(D, 15, 15), content: { family: 'tag36h11', id: D.frames.filter((x) => x.kind === 'fiducial').length } }))),
    sep(), grp(...alignBtns, ...distBtns, ...sizeBtns), sep(), grp(groupBtn, ungroupBtn), sep(), grp(frontBtn, fwdBtn, bwdBtn, backBtn, delBtn),
    sep(), grp(sizeSel, oriSel, customSpan, zoomSel, gridSel, rulersBtn), status);

  // ── rendering ──
  function render() { sel = sel.filter((id) => frameById(D, id)); renderCanvas(); syncBar(); renderSide(); }   // (a removed frame leaves the selection)
  function renderCanvas() {
    const [W, H] = pageDims(D.page);
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const pw = Math.round(W * zoom), ph = Math.round(H * zoom);
    wrap.style.width = pw + 'px'; wrap.style.height = ph + 'px';
    cv.width = Math.round(pw * dpr); cv.height = Math.round(ph * dpr);
    cv.style.width = pw + 'px'; cv.style.height = ph + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    renderPage(D, g, env());
    drawOverlay();
    drawRulers();
  }
  function drawOverlay(guides) {
    overlay.replaceChildren();
    const m = D.page.margins || [0, 0, 0, 0], [W, H] = pageDims(D.page);
    const gr = D.page.grid;
    if (gr && gr.show && gr.size > 0) {
      overlay.style.backgroundImage = 'linear-gradient(to right, rgba(60,130,230,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(60,130,230,0.16) 1px, transparent 1px)';
      overlay.style.backgroundSize = `${gr.size * zoom}px ${gr.size * zoom}px`;
    } else overlay.style.backgroundImage = 'none';
    overlay.append(h('div', { className: 'compo-margin', style: `left:${m[3] * zoom}px;top:${m[0] * zoom}px;width:${(W - m[1] - m[3]) * zoom}px;height:${(H - m[0] - m[2]) * zoom}px` }));
    for (const f of D.frames) {
      if (f.hidden) continue;                              // hidden: not drawn, not picked (the list still has it)
      const b = f.box;
      const d = h('div', { className: 'compo-fr' + (sel.includes(f.id) ? ' sel' : '') + (f.locked ? ' locked' : ''), title: `${(kindOf(f.kind) && kindOf(f.kind).label) || f.kind}` });
      d.style.cssText = `left:${b[0] * zoom}px;top:${b[1] * zoom}px;width:${b[2] * zoom}px;height:${b[3] * zoom}px`
        + (+f.rotate && canRotate(f) ? `;transform:rotate(${+f.rotate}deg);transform-origin:50% 50%` : '');   // the box turns with the frame: clicks land on what is drawn
      d.dataset.id = f.id;
      const bdg = badgeOf(f);
      if (bdg) d.append(h('span', { className: 'compo-badge', textContent: bdg.text, title: bdg.title || bdg.text }));
      overlay.append(d);
      if (sel.length === 1 && sel[0] === f.id && !f.locked && !(+f.rotate && canRotate(f))) {   // (a rotated frame: sized in its panel)
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
          const k = h('div', { className: 'compo-h' });
          k.style.left = `${b[0] * zoom + hx * b[2] * zoom}px`; k.style.top = `${b[1] * zoom + hy * b[3] * zoom}px`;
          k.style.cursor = (hx === 0.5 ? 'ns' : hy === 0.5 ? 'ew' : (hx === hy ? 'nwse' : 'nesw')) + '-resize';
          k.dataset.handle = `${hx},${hy}`; k.dataset.id = f.id;
          overlay.append(k);
        }
      }
    }
    if (sel.length === 1) {
      const f = frameById(D, sel[0]), t = f && canRefer(f) ? subjectFrame({ doc: D }, f, isReferable) : null;
      if (t && !t.hidden) {
        const od = [...overlay.querySelectorAll(".compo-fr")].find((x) => x.dataset.id === t.id); if (od) od.classList.add("ref");
        const ax = (f.box[0] + f.box[2] / 2) * zoom, ay = (f.box[1] + f.box[3] / 2) * zoom, bx = (t.box[0] + t.box[2] / 2) * zoom, by = (t.box[1] + t.box[3] / 2) * zoom;
        const ln = h('div', { className: 'compo-link' });
        ln.style.cssText = `left:${ax}px;top:${ay}px;width:${Math.hypot(bx - ax, by - ay)}px;transform:rotate(${Math.atan2(by - ay, bx - ax)}rad)`;
        overlay.append(ln);
      }
    }
    const gd = D.page.guides || {};
    for (const ax of ['x', 'y']) (gd[ax] || []).forEach((v, i) => {
      const gl = h('div', { className: `compo-gl ${ax}`, title: 'drag to move · drag off the page to remove' });
      gl.style[ax === 'x' ? 'left' : 'top'] = `${v * zoom}px`; gl.dataset.guide = `${ax}:${i}`;
      overlay.append(gl);
    });
    // a selected group: its bounds, dashed
    const seenG = new Set();
    for (const id of sel) {
      const f = frameById(D, id); if (!f || !f.group || seenG.has(f.group)) continue;
      seenG.add(f.group);
      const b = boundsOf(D.frames.filter((x) => x.group === f.group));
      overlay.append(h('div', { className: 'compo-grp', style: `left:${b[0] * zoom - 3}px;top:${b[1] * zoom - 3}px;width:${b[2] * zoom + 6}px;height:${b[3] * zoom + 6}px` }));
    }
    if (_marq) { const [x, y, w, hh] = _marq; overlay.append(h('div', { className: 'compo-marq', style: `left:${x * zoom}px;top:${y * zoom}px;width:${w * zoom}px;height:${hh * zoom}px` })); }
    if (guides && guides.gaps) for (const g of guides.gaps) {
      const len = (g.b - g.a) * zoom, at = g.at * zoom, a = g.a * zoom;
      if (len <= 0) continue;
      overlay.append(h('div', { className: 'compo-gap', style: g.k ? `left:${at}px;top:${a}px;width:1px;height:${len}px` : `left:${a}px;top:${at}px;height:1px;width:${len}px` }));
      const lx = g.k ? at : a + len / 2, ly = g.k ? a + len / 2 : at;
      overlay.append(h('div', { className: 'compo-gap-l', textContent: `${+(g.b - g.a).toFixed(1)}`, style: `left:${lx}px;top:${ly}px` }));
    }
    if (guides) {
      if (guides.x != null) overlay.append(h('div', { className: 'compo-guide', style: `left:${guides.x * zoom}px;top:0;width:1px;height:100%` }));
      if (guides.y != null) overlay.append(h('div', { className: 'compo-guide', style: `top:${guides.y * zoom}px;left:0;height:1px;width:100%` }));
    }
  }
  function syncBar() {
    sizeSel.value = PAPER[D.page.size] ? D.page.size : 'custom';
    gridSel.value = D.page.grid && D.page.grid.size ? String(D.page.grid.size) : '0';
    rulersBtn.setAttribute('aria-pressed', String(showRulers));
    undoBtn.disabled = !hist.length; redoBtn.disabled = !fut.length;
    oriSel.value = D.page.orientation || 'portrait'; oriSel.disabled = sizeSel.value === 'custom';
    customSpan.style.display = sizeSel.value === 'custom' ? 'inline-flex' : 'none';
    const [W, H] = pageDims(D.page); wIn.value = +W.toFixed(1); hIn.value = +H.toFixed(1);
    const nu = unitsOf(D, sel).length, grouped = sel.some((id) => { const f = frameById(D, id); return f && f.group; });
    for (const b of alignBtns) b.disabled = nu < 2;
    for (const b of distBtns) b.disabled = nu < 3;
    for (const b of sizeBtns) b.disabled = sel.length < 2;
    groupBtn.disabled = nu < 2; ungroupBtn.disabled = !grouped;
    frontBtn.disabled = fwdBtn.disabled = bwdBtn.disabled = backBtn.disabled = delBtn.disabled = !sel.length;
  }

  // ── inspector ──
  // rebuilding the panel removes a focused input, whose blur fires its change, whose commit
  // re-renders — re-entrantly. Blur first, and let a nested request just ask for one more pass.
  let _inSide = false, _sideAgain = false;
  function renderSide() {
    if (_inSide) { _sideAgain = true; return; }
    _inSide = true;
    try {
      do {
        _sideAgain = false;
        const a = document.activeElement;
        if (a && side.contains(a)) a.blur();
        buildSide();
        if (_keepItems) refreshItemSel(); else buildItems();
      } while (_sideAgain);
    } finally { _inSide = false; }
  }
  function buildSide() {
    insp.replaceChildren();
    if (sel.length !== 1) {
      if (!sel.length) pagePanel();
      if (sel.length) {
        const nu = unitsOf(D, sel).length, locked = sel.filter((id) => frameById(D, id).locked).length;
        insp.append(h('div', { className: 'hint', textContent: `${sel.length} frames${nu < sel.length ? ` in ${nu} unit${nu === 1 ? '' : 's'} (groups move as one)` : ''} — align / distribute / match size from the toolbar; the FIRST selected is the size key` }));
        const lk = h('input', { type: 'checkbox', checked: locked === sel.length });
        lk.indeterminate = locked > 0 && locked < sel.length;
        lk.onchange = () => commit(() => { for (const id of sel) frameById(D, id).locked = lk.checked; });
        insp.append(h('label', { className: 'row' }, h('span', { textContent: 'locked' }), h('span', { className: 'ctl' }, lk)));
        multiPanel();
      } else insp.append(h('div', { className: 'hint', textContent: 'click a frame to edit it · drag to move (snaps to edges, centres and equal gaps; ⌥ off) · drag on the empty page to box-select · handles resize · arrows nudge (⇧ ×10) · ⌘G group · ⌘Z undo' }));
      return;
    }
    const f = frameById(D, sel[0]); if (!f) return;
    const kind = kindOf(f.kind);
    insp.append(h('div', { textContent: `${(kind && kind.label) || f.kind}`, style: 'font-weight:bold' }));
    // the id: the frame's one handle (fields say {scale@plan}); renaming rewrites every reference
    const idIn = h('input', { className: 'compo-id', value: f.id, spellcheck: false, title: 'the frame’s id — fields refer to it as @id; renaming updates every reference' });
    idIn.oninput = () => { const v = sanitizeId(idIn.value); idIn.classList.toggle('bad', !v || (v !== f.id && D.frames.some((x) => x.id === v))); };
    idIn.onchange = () => { if (!doRename(f, idIn.value)) idIn.value = f.id; };
    idIn.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') idIn.blur(); };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'id' }), h('span', { className: 'ctl' }, idIn)));
    if (canRefer(f)) {
      // refers to: the nearest view (the default — it says which), or a fixed one
      const refOK = f.kind === 'label' ? canPin : isReferable;   // a label refers to what it can pin to: a 3D view or a net
      const near = refFrame(D, f, null, refOK), cands = D.frames.filter((x) => x !== f && refOK(x));
      const rs = h('select', { title: 'the frame this one is about: its fields ({scale} {section} …), or the view a scale bar / north arrow measures' },
        h('option', { value: '', textContent: near ? `nearest → ${near.id}` : 'nearest (none yet)' }),
        ...cands.map((x) => h('option', { value: x.id, textContent: x.id })));
      rs.value = (f.content && f.content.of) || '';
      rs.onchange = () => commit(() => { f.content = { ...(f.content || {}) }; if (rs.value) f.content.of = rs.value; else delete f.content.of; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'refers to' }), h('span', { className: 'ctl' }, rs)));
    }
    const num = (label, i) => {
      const inp = h('input', { type: 'number', step: 0.5, value: +f.box[i].toFixed(1) });
      inp.onchange = () => commit(() => { const v = +inp.value; if (Number.isFinite(v)) f.box[i] = i >= 2 ? Math.max(2, v) : v; });
      return h('span', { className: 'pair' }, h('i', { textContent: label }), inp);
    };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'position' }), h('span', { className: 'ctl' }, num('x', 0), num('y', 1))));
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'size' }), h('span', { className: 'ctl' }, num('w', 2), num('h', 3))));
    if (canRotate(f)) {                                     // ROTATION about the centre, degrees clockwise
      const ri = h('input', { type: 'number', min: -180, max: 180, step: 1, value: +f.rotate || 0, style: 'width:56px', title: 'degrees, clockwise, about the frame\'s centre' });
      const setR = (v) => commit(() => { const d = ((((+v || 0) + 180) % 360) + 360) % 360 - 180; if (d) f.rotate = +d.toFixed(2); else delete f.rotate; });
      ri.onchange = () => setR(ri.value);
      const qb = (t, v) => { const b2 = h('button', { textContent: t, title: v ? `${v}°` : 'upright' }); b2.onclick = () => setR(v); return b2; };
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'rotate °' }), h('span', { className: 'ctl' }, ri, qb('0', 0), qb('⟲90', -90), qb('⟳90', 90))));
      if (+f.rotate) insp.append(h('div', { className: 'hint', textContent: 'a rotated frame is sized here (w, h), not by handles' }));
    }
    const st = f.style || {};
    const setStyle = (k, v) => commit(() => { f.style = { ...(f.style || {}) }; if (v == null || v === '' || v === false) delete f.style[k]; else f.style[k] = v; });
    const bd = h('input', { type: 'checkbox', checked: !!st.border });
    bd.onchange = () => setStyle('border', bd.checked);
    const bc = h('input', { type: 'color', value: toHex(st.borderColor), title: 'border colour' });
    bc.onchange = () => setStyle('borderColor', bc.value);
    const bw = h('input', { type: 'number', min: 0.05, max: 3, step: 0.05, value: st.borderWidth || 0.25, title: 'border width (mm)', style: 'width:56px' });
    bw.onchange = () => setStyle('borderWidth', +bw.value || null);
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'border' }), h('span', { className: 'ctl' }, bd, bc, bw)));
    // a fill behind the frame: a panel, a band, a highlight (empty = none)
    // its opacity is kept beside the colour (a picked colour is #rrggbb — it used to drop an rgba fill's alpha)
    const alpha0 = (() => { const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(st.background || ''); return m ? Math.round(+m[1] * 100) : 100; })();
    const fillOn = h('input', { type: 'checkbox', checked: !!st.background, title: 'a fill behind the frame' });
    const fillC = h('input', { type: 'color', value: toHex(st.background, '#f2f2f0'), title: 'fill colour' });
    const fillA = h('input', { type: 'number', min: 0, max: 100, step: 5, value: alpha0, title: 'fill opacity (%)', style: 'width:56px' });
    const fillCss = () => { const a = Math.max(0, Math.min(100, +fillA.value || 0)); if (a >= 100) return fillC.value; const n = parseInt(fillC.value.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a / 100})`; };
    fillOn.onchange = () => setStyle('background', fillOn.checked ? fillCss() : null);
    fillC.onchange = fillA.onchange = () => { if (fillOn.checked) setStyle('background', fillCss()); };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'fill' }), h('span', { className: 'ctl' }, fillOn, fillC, h('span', { className: 'pair' }, h('i', { textContent: '%' }), fillA))));
    const lk = h('input', { type: 'checkbox', checked: !!f.locked });
    lk.onchange = () => commit(() => { f.locked = lk.checked; });
    insp.append(h('label', { className: 'row', title: 'a locked frame won’t move, resize or delete' }, h('span', { textContent: 'locked' }), h('span', { className: 'ctl' }, lk)));
    if (f.group) insp.append(h('div', { className: 'hint', textContent: `in a group of ${D.frames.filter((x) => x.group === f.group).length} — ⌘⇧G ungroups` }));
    if (f.kind === 'text') {
      const ta = h('textarea', { value: f.content.md || '', spellcheck: true });
      let t0 = null;
      ta.onfocus = () => { t0 = snap(); };
      ta.oninput = () => { f.content.md = ta.value; renderCanvas(); };   // the page only: the panel (and the caret) stay
      ta.onchange = () => { if (t0) { hist.push(t0); fut.length = 0; t0 = null; } if (opts.onChange) opts.onChange(D); };
      const size = h('input', { type: 'number', min: 4, max: 72, step: 0.5, value: f.content.size || 9 });
      size.onchange = () => commit(() => { f.content.size = +size.value || 9; });
      const align = h('select', {}, ...['left', 'center', 'right'].map((v) => h('option', { value: v, textContent: v })));
      align.value = f.content.align || 'left';
      align.onchange = () => commit(() => { f.content.align = align.value; });
      const fontSel = h('select', { title: 'the typeface' }, ...[['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']].map(([v, t]) => h('option', { value: v, textContent: t })));
      fontSel.value = f.content.font || (f.content.mono ? 'mono' : 'sans');
      fontSel.onchange = () => commit(() => { f.content.font = fontSel.value; delete f.content.mono; });
      const col = h('input', { type: 'color', value: toHex(f.content.color), title: 'text colour' });
      col.onchange = () => commit(() => { f.content.color = col.value; });
      const lh = h('input', { type: 'number', min: 0.8, max: 3, step: 0.05, value: f.content.lineHeight || 1.25, title: 'line spacing (× the size)', style: 'width:56px' });
      lh.onchange = () => commit(() => { f.content.lineHeight = +lh.value || 1.25; });
      const pad = h('input', { type: 'number', min: 0, max: 20, step: 0.5, value: f.content.pad ?? 1, title: 'padding inside the frame (mm)', style: 'width:56px' });
      pad.onchange = () => commit(() => { f.content.pad = Math.max(0, +pad.value || 0); });
      // insert a field at the caret (compo's own and the host's, each with its help as the tooltip)
      const fl = fieldList(opts.env || {});
      const fsel = h('select', { title: 'insert a field at the caret', className: 'compo-fields' }, h('option', { value: '', textContent: 'insert field…' }),
        ...fl.map((x) => h('option', { value: x.name, textContent: '{' + x.name + '}', title: x.help || '' })));
      fsel.onchange = () => {
        const nm = fsel.value; fsel.value = ''; if (!nm) return;
        const tok = '{' + nm + '}', a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
        commit(() => { f.content.md = ta.value.slice(0, a) + tok + ta.value.slice(b); });
        requestAnimationFrame(() => { const t2 = side.querySelector('textarea'); if (t2) { t2.focus(); t2.selectionStart = t2.selectionEnd = a + tok.length; } });
      };
      const va = h('select', { title: 'where the text sits in the frame, top to bottom' }, ...['top', 'middle', 'bottom'].map((v) => h('option', { value: v, textContent: v })));
      va.value = f.content.valign || 'top';
      va.onchange = () => commit(() => { if (va.value === 'top') delete f.content.valign; else f.content.valign = va.value; });
      const fitB = h('button', { textContent: 'Fit to content', title: 'make the frame exactly as tall as its text' });
      fitB.onclick = () => commit(() => { f.box[3] = Math.max(2, +contentHeight(f).toFixed(1)); });
      insp.append(ta, h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), h('span', { className: 'ctl' }, size, align, va)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, fontSel, col, fitB)),
        h('div', { className: 'row' }, h('span', { textContent: 'spacing' }), h('span', { className: 'ctl' }, h('span', { className: 'pair' }, h('i', { textContent: '↕' }), lh), h('span', { className: 'pair' }, h('i', { textContent: '▢' }), pad))),
        h('div', { className: 'row' }, h('span', { textContent: 'fields' }), h('span', { className: 'ctl' }, fsel)),
        h('div', { className: 'hint', textContent: '# title · ## subtitle · - list · 1. list · --- rule · **bold** · *italic* · `code` · {name} fields, {count:,} · ${expr:,.2f}' }));
      api._focusText = () => ta.focus();
    }
    if (f.kind === 'image') {
      const fit = h('select', {}, ...['contain', 'cover', 'fill'].map((v) => h('option', { value: v, textContent: v })));
      fit.value = f.content.fit || 'contain';
      fit.onchange = () => commit(() => { f.content.fit = fit.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'fit' }), h('span', { className: 'ctl' }, fit)));
      if (!hasProj(f)) {                                    // CROP a plain picture: % trimmed from each edge
        const cr = Array.isArray(f.content.crop) ? f.content.crop : [0, 0, 0, 0];
        const ins = ['left', 'top', 'right', 'bottom'].map((t, i) => { const x = h('input', { type: 'number', min: 0, max: 90, step: 1, value: Math.round(cr[i] * 100), title: `% trimmed from the ${t}`, style: 'width:46px' });
          x.onchange = () => commit(() => { const v = [...(Array.isArray(f.content.crop) ? f.content.crop : [0, 0, 0, 0])]; v[i] = Math.max(0, Math.min(90, +x.value || 0)) / 100; f.content = { ...f.content, crop: v }; if (v.every((q) => !q)) delete f.content.crop; }); return x; });
        const fitc = h('button', { textContent: 'Fit frame', title: 'make the frame the cropped picture\'s shape (its width kept)' });
        fitc.onclick = () => commit(() => { const c0 = f.content, v = c0.crop || [0, 0, 0, 0], iw = c0.width || (f._img && f._img.width), ih = c0.height || (f._img && f._img.height); if (iw && ih) f.box[3] = +(f.box[2] * (ih * (1 - v[1] - v[3])) / (iw * (1 - v[0] - v[2]))).toFixed(1); });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'crop %' }), h('span', { className: 'ctl' }, ...ins.map((x, i) => h('span', { className: 'pair' }, h('i', { textContent: '←↑→↓'[i] }), x)), fitc)));
      }
      if (hasProj(f)) {                                     // a view of 3D space: coordinates on its border
        const tk = h('select', { className: 'compo-ticks', title: 'coordinate ticks on the border (orthographic views), or a grid across' }, ...['off', 'ticks', 'grid'].map((v) => h('option', { value: v, textContent: v })));
        tk.value = f.content.ticks || 'off';
        tk.onchange = () => commit(() => { if (tk.value === 'off') delete f.content.ticks; else f.content.ticks = tk.value; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'coords' }), h('span', { className: 'ctl' }, tk)));
      }
    }
    if (['text', 'label', 'table', 'shape', 'legend'].includes(f.kind)) stylePanel(f);
    if (f.kind === 'table') tablePanel(f);
    if (f.kind === 'scalebar') scalebarPanel(f);
    if (f.kind === 'north') northPanel(f);
    if (f.kind === 'shape') shapePanel(f);
    if (f.kind === 'qr') qrPanel(f);
    if (f.kind === 'fiducial') fiducialPanel(f);
    if (f.kind === 'legend') {
      // the look, then each entry: show/hide, colour, label, order. Your edits sit beside the host's data
      // (content.edit / order — kinds.js), so refreshing the legend from the data keeps them
      const c = f.content || (f.content = {});
      const ttl = h('input', { value: c.title || '', placeholder: 'no title', title: 'the legend’s title (fields work: {name})' });
      ttl.onchange = () => commit(() => { f.content.title = ttl.value; f.content.titleUser = true; });
      const gsz = h('input', { type: 'number', min: 4, max: 24, step: 0.5, value: c.size || 8, title: 'text size (pt)', style: 'width:56px' });
      gsz.onchange = () => commit(() => { f.content.size = +gsz.value || 8; });
      const tcol = h('input', { type: 'color', value: toHex(c.textColor), title: 'text colour' });
      tcol.onchange = () => commit(() => { f.content.textColor = tcol.value; });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'title' }), h('span', { className: 'ctl' }, ttl)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, gsz, tcol)));
      const setEdit = (key, patch) => commit(() => {
        const ed = { ...(f.content.edit || {}) }, cur = { ...(ed[key] || {}), ...patch };
        for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
        if (Object.keys(cur).length) ed[key] = cur; else delete ed[key];
        if (Object.keys(ed).length) f.content.edit = ed; else delete f.content.edit;
      });
      if (c.kind === 'ramp') {
        const hiL = h('input', { value: (c.edit && c.edit.hiLabel) ?? c.hiLabel ?? String(c.hi ?? ''), title: 'the top label' });
        const loL = h('input', { value: (c.edit && c.edit.loLabel) ?? c.loLabel ?? String(c.lo ?? ''), title: 'the bottom label' });
        hiL.onchange = () => commit(() => { f.content.edit = { ...(f.content.edit || {}), hiLabel: hiL.value }; });
        loL.onchange = () => commit(() => { f.content.edit = { ...(f.content.edit || {}), loLabel: loL.value }; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'top' }), h('span', { className: 'ctl' }, hiL)),
          h('div', { className: 'row' }, h('span', { textContent: 'bottom' }), h('span', { className: 'ctl' }, loL)));
      } else {
        const cols = h('input', { type: 'number', min: 1, max: 6, step: 1, value: c.columns || 1, title: 'columns', style: 'width:56px' });
        cols.onchange = () => commit(() => { const n = Math.max(1, Math.min(6, Math.round(+cols.value || 1))); if (n === 1) delete f.content.columns; else f.content.columns = n; });
        const shape = h('select', { title: 'the swatch: a square (areas), a dot (points), a line (curves)' }, ...['square', 'circle', 'line'].map((v) => h('option', { value: v, textContent: v })));
        shape.value = c.swatch || 'square';
        shape.onchange = () => commit(() => { if (shape.value === 'square') delete f.content.swatch; else f.content.swatch = shape.value; });
        insp.append(h('div', { className: 'row' }, h('span', { textContent: 'layout' }), h('span', { className: 'ctl' }, h('span', { className: 'pair' }, h('i', { textContent: '▥' }), cols), shape)));
        const es = legendEntries(c), keys = es.map((e) => e._key);
        const orig = (k) => (c.entries || []).find((x) => legendKey(x) === k) || {};
        es.forEach((e, i) => {
          const eye = h('button', { textContent: e.hidden ? '◌' : '◉', title: e.hidden ? 'show this entry' : 'hide this entry (not drawn)', onclick: () => setEdit(e._key, { hidden: e.hidden ? null : true }) });
          const sw = h('input', { type: 'color', value: toHex(e.color, '#888888'), title: 'its colour' });
          sw.onchange = () => setEdit(e._key, { color: toHex(orig(e._key).color) === sw.value ? null : sw.value });
          const lb = h('input', { value: String(e.label ?? ''), title: 'its label' });
          lb.onchange = () => setEdit(e._key, { label: lb.value === String(orig(e._key).label ?? '') ? null : lb.value });
          const move = (d) => () => { const j = i + d; if (j < 0 || j >= keys.length) return; const k = keys.slice(); [k[i], k[j]] = [k[j], k[i]]; commit(() => { f.content.order = k; }); };
          const up = h('button', { textContent: '↑', title: 'move up', disabled: i === 0, onclick: move(-1) });
          const dn = h('button', { textContent: '↓', title: 'move down', disabled: i === es.length - 1, onclick: move(1) });
          insp.append(h('div', { className: 'leg' + (e.hidden ? ' off' : '') }, eye, sw, lb, up, dn));
        });
      }
      const edited = c.edit || c.order || c.titleUser;
      if (edited) insp.append(h('div', { className: 'row' }, h('span', {}), h('span', { className: 'ctl' }, h('button', { textContent: 'reset edits', title: 'back to the data’s own labels, colours and order', onclick: () => commit(() => { delete f.content.edit; delete f.content.order; delete f.content.titleUser; }) }))));
      insp.append(h('div', { className: 'hint', textContent: 'your edits stay when the legend is refreshed from the data' }));
    }
    if (f.kind === 'label') {
      const tx = h('textarea', { value: f.content.text || '', style: 'min-height:40px' });
      tx.onchange = () => commit(() => { f.content.text = tx.value; });
      const lsz = h('input', { type: 'number', min: 4, max: 48, step: 0.5, value: f.content.size || 7, title: 'size (pt)', style: 'width:56px' });
      lsz.onchange = () => commit(() => { f.content.size = +lsz.value || 7; });
      const lfont = h('select', { title: 'the typeface' }, ...[['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']].map(([v, t]) => h('option', { value: v, textContent: t })));
      lfont.value = f.content.font || 'sans';
      lfont.onchange = () => commit(() => { f.content.font = lfont.value; });
      const lcol = h('input', { type: 'color', value: toHex(f.content.color), title: 'text, leader and dot colour' });
      lcol.onchange = () => commit(() => { f.content.color = lcol.value; });
      const back = h('input', { type: 'checkbox', checked: f.content.backing !== false, title: 'a white backing behind the words, so they read over the picture' });
      back.onchange = () => commit(() => { f.content.backing = back.checked; });
      const lal = h('select', { title: 'the words’ alignment in the box' }, ...['left', 'center', 'right'].map((v) => h('option', { value: v, textContent: v })));
      lal.value = f.content.align || 'left';
      lal.onchange = () => commit(() => { if (lal.value === 'left') delete f.content.align; else f.content.align = lal.value; });
      const lead = h('select', { title: 'the leader from the box to the point' }, ...[['line', 'line + dot'], ['arrow', 'arrow'], ['none', 'none']].map(([v, t]) => h('option', { value: v, textContent: t })));
      lead.value = f.content.leader || 'line';
      lead.onchange = () => commit(() => { if (lead.value === 'line') delete f.content.leader; else f.content.leader = lead.value; });
      const lfit = h('button', { textContent: 'Fit', title: 'make the box exactly as tall as its words' });
      lfit.onclick = () => commit(() => { f.box[3] = Math.max(2, +contentHeight(f).toFixed(1)); });
      // the words show as you type (the page only; one undo step when you leave the box)
      let lt0 = null;
      tx.onfocus = () => { lt0 = snap(); };
      tx.oninput = () => { f.content.text = tx.value; renderCanvas(); };
      tx.onchange = () => { if (lt0) { hist.push(lt0); fut.length = 0; lt0 = null; } if (opts.onChange) opts.onChange(D); };
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), h('span', { className: 'ctl' }, lsz, lal, lfit)),
        h('div', { className: 'row' }, h('span', { textContent: 'type' }), h('span', { className: 'ctl' }, lfont, lcol)),
        h('div', { className: 'row' }, h('span', { textContent: 'leader' }), h('span', { className: 'ctl' }, lead)),
        h('label', { className: 'row' }, h('span', { textContent: 'backing' }), h('span', { className: 'ctl' }, back)));
      const at = f.content.at || [0, 0, 0];
      const tgt = f.content.of ? frameById(D, f.content.of) : refFrame(D, f, null, canPin);
      if (tgt && !hasProj(tgt)) {
        // pinned to a net: the point is a DIRECTION — shown and typed as a line, trend → plunge (axial, lower hemisphere)
        const len = Math.hypot(at[0], at[1], at[2]) || 1, s = at[2] > 0 ? -1 : 1, d = at.map((v) => (s * v) / len);
        const tr = ((Math.atan2(d[0], d[1]) * 180 / Math.PI) + 360) % 360, pl = Math.asin(Math.min(1, -d[2])) * 180 / Math.PI;
        const inp = h('input', { value: `${String(Math.round(tr)).padStart(3, '0')}→${Math.round(pl)}`, title: 'the direction it points at: trend → plunge (also 328/25 or 328 25)' });
        inp.onchange = () => {
          const m = /^\s*(-?[\d.]+)\s*(?:→|->|\/|,|\s)\s*(-?[\d.]+)\s*$/.exec(inp.value);
          if (!m) { say('a direction is trend → plunge, e.g. 328→25'); return; }
          const t = +m[1] * Math.PI / 180, p = +m[2] * Math.PI / 180;
          commit(() => { f.content.at = [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)].map((v) => +v.toFixed(6)); });
        };
        insp.append(tx, h('div', { className: 'row' }, h('span', { textContent: 'points at' }), h('span', { className: 'ctl' }, inp)), h('div', { className: 'hint', textContent: 'the leader follows this direction on the net it refers to' }));
      } else {
        const xyz = ['x', 'y', 'z'].map((k, i) => { const inp = h('input', { type: 'number', step: 'any', value: +(+at[i]).toFixed(3), title: `the point, world ${k}` }); inp.onchange = () => commit(() => { const a = (f.content.at || [0, 0, 0]).slice(); a[i] = +inp.value || 0; f.content.at = a; }); return h('span', { className: 'pair' }, h('i', { textContent: k }), inp); });   // world coordinates are long: one per line
        insp.append(tx, h('div', { className: 'row' }, h('span', { textContent: 'points at' }), h('span', { className: 'ctl stack' }, ...xyz)), h('div', { className: 'hint', textContent: 'the leader follows this world point in the view it refers to' }));
      }
    }
    if (f.kind === 'titleblock') {
      // its rows, one a line — each a text frame's markdown with fields; a row keeps its type
      // size and height by position (a new row: 6.5 pt, 5 mm), the frame's height follows
      const rows = () => (f.content.rows || []).map((r) => r.slice());
      const ta = h('textarea', { value: rows().map((r) => r[0]).join('\n'), spellcheck: true, title: 'one row a line: **bold** · {title} {date} {scale} {page} {pages} · {prop:company} {prop:drawing} …' });
      ta.onchange = () => commit(() => {
        const old = rows(), lines = ta.value.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || i < a.length - 1);
        const next = lines.map((md, i) => [md, old[i] ? old[i][1] : 6.5, old[i] ? old[i][2] : 5]);
        const h0 = old.reduce((s2, r) => s2 + r[2], 0) || 1, h1 = next.reduce((s2, r) => s2 + r[2], 0);
        f.content = { ...f.content, rows: next };
        f.box[1] += f.box[3] - f.box[3] * (h1 / h0); f.box[3] = +(f.box[3] * (h1 / h0)).toFixed(2);   // grows upward: the block's bottom stays on the margin
      });
      ta.onkeydown = (e) => e.stopPropagation();
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'rows' })), ta, h('div', { className: 'hint', textContent: 'one row a line — fields as in a text frame; the values come from properties…' }));
    }
    if (opts.inspector) opts.inspector(f, insp, api);
    if (f.produced) insp.append(h('div', { className: 'hint', textContent: `produced ${String(f.produced).replace('T', ' ').slice(0, 16)}` }));
  }

  // ── pointer: select, move (snapping), resize ──
  const toMm = (e) => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();                                    // keep the keyboard on the editor (no mousedown focus shuffle)
    root.focus();
    const t = e.target, id = t.dataset && t.dataset.id;
    if (t.dataset && t.dataset.guide) { const [ax, i] = t.dataset.guide.split(':'); startGuide(ax, +i, e); return; }
    if (!id) { startMarquee(e); return; }
    const f = frameById(D, id);
    if (t.dataset.handle) return startResize(e, f, t.dataset.handle.split(',').map(Number));
    const unit = expandGroups(D, [id]);                     // a group member brings its group
    if (e.shiftKey) { sel = sel.includes(id) ? sel.filter((x) => !unit.includes(x)) : sel.concat(unit.filter((x) => !sel.includes(x))); render(); return; }
    if (!sel.includes(id)) { sel = [id, ...unit.filter((x) => x !== id)]; render(); }
    if (sel.some((x) => frameById(D, x).locked)) { if (f.locked) say('locked — unlock it to move it'); return; }
    startMove(e);
  });
  overlay.addEventListener('dblclick', (e) => {
    const id = e.target.dataset && e.target.dataset.id, f = id && frameById(D, id); if (!f) return;
    if (opts.frameOpen && opts.frameOpen(f) === true) return;   // the host opens it (micro: edit a view in place)
    if (f.kind === 'text' && api._focusText) api._focusText();
  });
  overlay.addEventListener('contextmenu', (e) => {
    const id = e.target.dataset && e.target.dataset.id; if (!id) return;
    e.preventDefault();
    if (!sel.includes(id)) { const unit = expandGroups(D, [id]); sel = [id, ...unit.filter((x) => x !== id)]; render(); }
    const f = frameById(D, id), nu = unitsOf(D, sel).length, grouped = sel.some((x) => frameById(D, x).group);
    const anyLocked = sel.some((x) => frameById(D, x).locked);
    const items = [...((opts.frameMenu && opts.frameMenu(f, api)) || []), { sep: true },
      { label: 'Duplicate', run: () => dup() },
      ...(nu >= 2 ? [{ label: 'Group', run: () => doGroup() }] : []), ...(grouped ? [{ label: 'Ungroup', run: () => doUngroup() }] : []),
      ...(sel.length >= 2 ? [{ label: 'Same size as the first', run: () => commit(() => matchSize(D, sel, 'both')) }] : []),
      { sep: true },
      { label: 'Bring to front', run: () => commit(() => bringToFront(D, sel)) }, { label: 'Bring forward', run: () => commit(() => bringForward(D, sel)) },
      { label: 'Send backward', run: () => commit(() => sendBackward(D, sel)) }, { label: 'Send to back', run: () => commit(() => sendToBack(D, sel)) },
      { sep: true },
      { label: anyLocked ? 'Unlock' : 'Lock', run: () => commit(() => { for (const x of sel) frameById(D, x).locked = !anyLocked; }) }, { label: 'Delete', run: () => del() }];
    menu(e.clientX, e.clientY, items);
  });
  function startMove(e) {
    const p0 = toMm(e), starts = sel.map((id) => [id, frameById(D, id).box.slice()]);
    const b0 = boundsOf(starts.map(([, b]) => ({ box: b })));
    const before = snap();
    let moved = false;
    const mv = (ev) => {
      const p = toMm(ev); let dx = p[0] - p0[0], dy = p[1] - p0[1];
      if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
      moved = true;
      // snap the selection's bounds (a group or several frames move as one box)
      const pb = b0;
      const s = ev.altKey ? { box: [pb[0] + dx, pb[1] + dy], guides: null } : snapBox(D, [pb[0] + dx, pb[1] + dy, pb[2], pb[3]], { ignore: sel });
      dx = s.box[0] - pb[0]; dy = s.box[1] - pb[1];
      for (const [id, b] of starts) { const f = frameById(D, id); f.box[0] = b[0] + dx; f.box[1] = b[1] + dy; }
      renderFast(s.guides);
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (moved) { hist.push(before); fut.length = 0; changed(); }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function startResize(e, f, [hx, hy]) {
    const p0 = toMm(e), b0 = f.box.slice(), before = snap();
    const aspect = b0[2] / b0[3];
    const mv = (ev) => {
      const p = toMm(ev), dx = p[0] - p0[0], dy = p[1] - p0[1];
      let [x, y, w, hh] = b0;
      if (hx === 0) { x = b0[0] + dx; w = b0[2] - dx; } else if (hx === 1) w = b0[2] + dx;
      if (hy === 0) { y = b0[1] + dy; hh = b0[3] - dy; } else if (hy === 1) hh = b0[3] + dy;
      const keep = ev.shiftKey && hx !== 0.5 && hy !== 0.5;
      let guides = null;
      if (!ev.altKey) { const s2 = snapResize(D, [x, y, w, hh], [hx, hy], { ignore: [f.id], onlyX: keep }); [x, y, w, hh] = s2.box; guides = s2.guides; }   // the dragged edges snap (⌥ off)
      if (keep) { hh = w / aspect; if (hy === 0) y = b0[1] + b0[3] - hh; }   // ⇧ keeps the aspect
      if (w < 3) { if (hx === 0) x = b0[0] + b0[2] - 3; w = 3; }
      if (hh < 3) { if (hy === 0) y = b0[1] + b0[3] - 3; hh = 3; }
      f.box = [x, y, w, hh];
      renderFast(guides);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); hist.push(before); fut.length = 0; changed(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  // ── guides: drag one out of a ruler; drag it to move (½ mm steps, or the grid; ⌥ free); off the
  // page removes it. page.guides = { x: [mm], y: [mm] } — saved with the figure, never printed ──
  function startGuide(axis, idx, e) {
    const before = snap();
    const gd0 = D.page.guides || {};
    const gd = { x: (gd0.x || []).slice(), y: (gd0.y || []).slice() };
    D.page = { ...D.page, guides: gd };
    if (idx == null) { gd[axis].push(axis === 'x' ? toMm(e)[0] : toMm(e)[1]); idx = gd[axis].length - 1; }
    const [W, H] = pageDims(D.page), lim = axis === 'x' ? W : H;
    const mv = (ev) => {
      const p = toMm(ev); let v = axis === 'x' ? p[0] : p[1];
      if (!ev.altKey) { const g = D.page.grid; v = g && g.snap && g.size > 0 ? Math.round(v / g.size) * g.size : Math.round(v * 2) / 2; }
      gd[axis][idx] = v; drawOverlay(); drawRulers();
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const v = gd[axis][idx], gone = !(v >= 0 && v <= lim);
      if (gone) gd[axis].splice(idx, 1);
      if (!gd.x.length && !gd.y.length) { const p = { ...D.page }; delete p.guides; D.page = p; }
      hist.push(before); fut.length = 0; changed();
      say(gone ? 'guide removed' : `guide at ${+v.toFixed(1)} mm`);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  for (const [rc, ax] of [[rulerTop, 'y'], [rulerLeft, 'x']]) {
    rc.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); root.focus(); startGuide(ax, null, e); });
    rc.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [{ label: 'Clear guides', run: () => commit(() => { const p = { ...D.page }; delete p.guides; D.page = p; }) }, { label: 'Hide rulers', run: () => rulersBtn.onclick() }]);
    });
  }
  // the rulers: mm from the page's top-left, the selection's extent shaded
  function drawRulers() {
    rulerTop.style.display = rulerLeft.style.display = showRulers ? '' : 'none';
    if (!showRulers) return;
    const [W, H] = pageDims(D.page), T = 16;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const minor = zoom >= 6 ? 1 : zoom >= 2.5 ? 2 : 5, major = zoom >= 1.6 ? 10 : 50;
    const fs2 = sel.map((id) => frameById(D, id)).filter((f) => f && !f.hidden), sb = fs2.length ? boundsOf(fs2) : null;
    const one = (c2, horiz, total) => {
      const len = total * zoom;
      c2.width = Math.round((horiz ? len : T) * dpr); c2.height = Math.round((horiz ? T : len) * dpr);
      c2.style.width = (horiz ? len : T) + 'px'; c2.style.height = (horiz ? T : len) + 'px';
      const g = c2.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#e7e8eb'; g.fillRect(0, 0, horiz ? len : T, horiz ? T : len);
      if (sb) { const k = horiz ? 0 : 1; g.fillStyle = 'rgba(60,130,230,0.28)'; if (horiz) g.fillRect(sb[0] * zoom, 0, sb[2] * zoom, T); else g.fillRect(0, sb[1] * zoom, T, sb[3] * zoom); }
      g.strokeStyle = '#6b6f76'; g.fillStyle = '#4a4e55'; g.lineWidth = 1; g.font = '9px system-ui, sans-serif';
      g.beginPath();
      for (let mm = 0; mm <= total + 1e-9; mm += minor) {
        const px = Math.round(mm * zoom) + 0.5, isMaj = mm % major === 0, isMid = mm % 5 === 0;
        const L = isMaj ? T * 0.6 : isMid ? T * 0.38 : T * 0.22;
        if (horiz) { g.moveTo(px, T); g.lineTo(px, T - L); } else { g.moveTo(T, px); g.lineTo(T - L, px); }
        if (isMaj && mm > 0) {
          if (horiz) g.fillText(String(mm), px + 2, 9);
          else { g.save(); g.translate(9, px - 2); g.rotate(-Math.PI / 2); g.fillText(String(mm), 0, 0); g.restore(); }
        }
      }
      g.stroke();
      const gd = D.page.guides || {};                      // the guides, marked on their ruler
      g.fillStyle = '#12a4c4';
      for (const v of (horiz ? gd.x : gd.y) || []) { const px = v * zoom; if (horiz) g.fillRect(px - 1, T - 5, 2, 5); else g.fillRect(T - 5, px - 1, 5, 2); }
    };
    one(rulerTop, true, W); one(rulerLeft, false, H);
  }
  // ── the item list: every frame, front first; groups as folders ──
  // a host's badge for a frame: opts.frameBadge(f) → null | 'text' | { text, title }
  // compo's own: content that didn't fit its box (a kind sets frame._overflow while drawing — text, labels,
  // legends, tables). A host's badge wins; the overflow one says what was cut and offers nothing silently.
  function badgeOf(f) {
    let b = null;
    if (opts.frameBadge) { try { const x = opts.frameBadge(f); b = !x ? null : typeof x === 'string' ? { text: x } : x; } catch { b = null; } }
    if (!b && f._overflow) b = { text: 'doesn’t fit', title: `${f._overflow} — make the frame bigger, or the text smaller (Fit to content in its panel)` };
    if (!b && f._needs) b = f._needs;                     // a kind that needs something it wasn't given (a north arrow's place)
    return b;
  }
  // a label: at the host's point (opts.labelPoint(view) → [x,y,z]) or the middle of the view, beside it.
  // Any frame it can pin to: a 3D view (a world point) or a stereonet (a direction) — see kinds.js PINS
  function addLabel() {
    const sv = sel.length === 1 ? frameById(D, sel[0]) : null;
    const v = (sv && canPin(sv)) ? sv : D.frames.find((x) => canPin(x) && !x.hidden);
    if (!v) { say('a label points at something in a 3D view or on a stereonet — add one first'); return; }
    // the host's point: [x, y, z], or { at, text } to suggest the words too (wuffle: a selected plane's attitude)
    let at = opts.labelPoint ? opts.labelPoint(v) : null, text = 'label';
    if (at && !Array.isArray(at)) { if (at.text) text = String(at.text); at = at.at || null; }
    if (!at) at = pageToPin(v, v.box[0] + v.box[2] / 2, v.box[1] + v.box[3] / 2);
    if (!at) { say('could not find a point in that frame to pin the label to'); return; }
    const box = [v.box[0] + v.box[2] * 0.62, v.box[1] + v.box[3] * 0.12, 30, 7];
    add({ kind: 'label', box, content: { text, at: at.map((n) => +(+n).toFixed(hasProj(v) ? 3 : 6)), of: v.id } });   // a direction keeps 6 places
  }
  // a rename → true; refused (and said why) → false
  function doRename(f, raw) {
    const v = sanitizeId(raw), old = f.id;
    if (v === old) return true;
    const probe = { frames: D.frames.map((x) => ({ id: x.id })) }, why = renameFrame(probe, old, v);
    if (why) { say(why); return false; }
    commit(() => { renameFrame(D, old, v); sel = sel.map((id) => (id === old ? v : id)); });
    return true;
  }
  function frameLabel(f) {
    const k = kindOf(f.kind), c = f.content || {}, src = f.source || {};
    if (k && k.describe) { try { const d = k.describe(f); if (d) return d; } catch { /* fall through */ } }
    if (f.kind === 'text') { const t = String(c.md || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); return t ? `text · ${t.length > 30 ? t.slice(0, 30) + '…' : t}` : (f.style && f.style.background ? 'rule' : 'text (empty)'); }
    if (f.kind === 'image') return src.kind === 'view' ? '3D view' : src.kind === 'plot' ? `plot · ${src.name || ''}` : 'image';
    if (f.kind === 'legend') return `legend${c.title ? ' · ' + c.title : ''}`;
    if (f.kind === 'table') return `table${c.title ? ' · ' + c.title : (src.name ? ' · ' + src.name : '')}`;
    if (f.kind === 'drawlist') return 'chart';
    if (f.kind === 'titleblock') return `title block · ${(c.rows || []).length} rows`;
    return (k && k.label) || f.kind;
  }
  let _dragItem = null, _keepItems = false;
  // a selection change re-marks the rows without rebuilding them (a rebuild between the two clicks
  // of a double-click would swallow it)
  function refreshItemSel() {
    for (const r of items.querySelectorAll('.compo-it')) {
      const it = r.dataset.item, ids = it.startsWith('g:') ? D.frames.filter((x) => x.group === it.slice(2)).map((x) => x.id) : [it];
      r.classList.toggle('sel', ids.length > 0 && ids.every((id) => sel.includes(id)));
    }
  }
  function buildItems() {
    items.replaceChildren();
    items.append(h('div', { className: 'ttl' }, h('span', { textContent: `frames · ${D.frames.length}` }), h('span', { textContent: 'front ↑' })));
    let lastG = null;
    for (const f of [...D.frames].reverse()) {
      if (f.group && f.group !== lastG) items.append(itemRow(null, f.group, D.frames.filter((x) => x.group === f.group)));
      lastG = f.group || null;
      items.append(itemRow(f));
    }
  }
  function itemRow(f, group, members) {
    const fs2 = f ? [f] : members, ids = fs2.map((x) => x.id);
    const hidden = fs2.every((x) => x.hidden), locked = fs2.every((x) => x.locked), isSel = ids.every((id) => sel.includes(id));
    const row = h('div', { className: 'compo-it' + (group ? ' grp' : '') + (f && f.group ? ' mem' : '') + (isSel ? ' sel' : '') + (hidden ? ' hid' : ''), draggable: true });
    row.dataset.item = f ? f.id : 'g:' + group;
    const eye = h('button', { textContent: hidden ? '◌' : '◉', title: hidden ? 'show' : 'hide (not drawn, not printed)', onclick: (e) => { e.stopPropagation(); commit(() => { for (const x of fs2) { if (hidden) delete x.hidden; else x.hidden = true; } }); } });
    const lk = h('button', { textContent: locked ? '🔒' : '🔓', title: locked ? 'unlock' : 'lock', style: locked ? '' : 'opacity:0.35', onclick: (e) => { e.stopPropagation(); commit(() => { for (const x of fs2) { if (locked) delete x.locked; else x.locked = true; } }); } });
    const nm = h('span', { className: 'nm' }, ...(group ? [`group · ${members.length}`] : [h('b', { className: 'id', textContent: f.id }), h('span', { className: 'ds', textContent: frameLabel(f) })]));
    row.append(eye, lk, nm);
    if (f) { const bdg = badgeOf(f); if (bdg) row.append(h('span', { className: 'warn', textContent: '⚠', title: bdg.title || bdg.text })); }
    row.onclick = (e) => {
      if (e.shiftKey) sel = isSel ? sel.filter((id) => !ids.includes(id)) : sel.concat(ids.filter((id) => !sel.includes(id)));
      else sel = ids.slice();                                // a member row selects just that member (edit inside a group)
      _keepItems = true; try { render(); } finally { _keepItems = false; } root.focus();
    };
    nm.ondblclick = (e) => {
      if (!f) return;
      e.stopPropagation();
      const inp = h('input', { value: f.id, spellcheck: false }); inp.title = 'the id (letters, digits, - _ .)';
      nm.replaceChildren(inp); inp.focus(); inp.select();
      const done = (keep) => { if (!inp.isConnected) return; const v = inp.value.trim(); if (!(keep && v && v !== f.id && doRename(f, v))) render(); };
      inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    };
    row.ondragstart = (e) => { _dragItem = row.dataset.item; e.dataTransfer.setData('text/plain', _dragItem); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragend = () => { _dragItem = null; };
    const half = (e) => { const r = row.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
    row.ondragover = (e) => { if (!_dragItem || _dragItem === row.dataset.item) return; e.preventDefault(); const up = half(e); row.classList.toggle('drop-above', up); row.classList.toggle('drop-below', !up); };
    row.ondragleave = () => row.classList.remove('drop-above', 'drop-below');
    row.ondrop = (e) => {
      e.preventDefault(); row.classList.remove('drop-above', 'drop-below');
      const src = _dragItem; _dragItem = null; if (!src || src === row.dataset.item) return;
      const mv = src.startsWith('g:') ? D.frames.filter((x) => x.group === src.slice(2)).map((x) => x.id) : [src];
      const up = half(e);                                  // the list is front-first: above a row = in front of it
      const target = f ? f.id : (up ? members[members.length - 1].id : members[0].id);
      commit(() => moveInStack(D, mv, target, up));
    };
    return row;
  }
  // box select: drag on the empty page; frames wholly inside are selected (⇧ adds), groups whole
  let _marq = null;
  function startMarquee(e) {
    const p0 = toMm(e), base = e.shiftKey ? sel.slice() : [];
    let moved = false;
    const mv = (ev) => {
      const p = toMm(ev);
      if (!moved && Math.hypot(p[0] - p0[0], p[1] - p0[1]) * zoom < 3) return;
      moved = true;
      _marq = [Math.min(p0[0], p[0]), Math.min(p0[1], p[1]), Math.abs(p[0] - p0[0]), Math.abs(p[1] - p0[1])];
      const [x, y, w, hh] = _marq;
      const inside = D.frames.filter((f) => !f.hidden && f.box[0] >= x && f.box[1] >= y && f.box[0] + f.box[2] <= x + w && f.box[1] + f.box[3] <= y + hh).map((f) => f.id);
      sel = base.concat(expandGroups(D, inside).filter((id) => !base.includes(id)));
      drawOverlay(); syncBar();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); _marq = null; if (!moved) sel = base; render(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  let _raf = 0, _g = null;
  function renderFast(guides) {
    _g = guides;
    if (_raf) return;
    _raf = requestAnimationFrame(() => { _raf = 0; renderCanvas(); drawOverlay(_g); });
  }

  // ── keys ──
  root.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); return; }
    if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); copyStyle(); return; }
    if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); pasteStyle(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = D.frames.filter((f) => !f.hidden).map((f) => f.id); render(); return; }   // not the hidden ones: a Delete after it would take frames you can't see
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? doUngroup() : doGroup(); return; }
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault(); if (!sel.length) return;
      const up2 = e.code === 'BracketRight';
      commit(() => (e.shiftKey ? (up2 ? bringToFront : sendToBack) : (up2 ? bringForward : sendBackward))(D, sel));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); del(); } return; }
    if (e.key === 'Escape') { sel = []; render(); return; }
    const step = e.shiftKey ? 5 : 0.5, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && sel.length) {
      e.preventDefault();
      const move = () => { for (const id of sel) { const f = frameById(D, id); if (!f.locked) { f.box[0] += dir[0] * step; f.box[1] += dir[1] * step; } } };
      // a run of nudges (the same frames, no pause over a second) is ONE undo step — ⌘Z takes the run back, not 0.5 mm
      const key = sel.join(','), now = Date.now();
      if (_nudge && _nudge.key === key && now - _nudge.t < 1000 && hist.length) { move(); _nudge.t = now; changed(); }
      else { commit(move); _nudge = { key, t: now }; }
    }
  });

  // ── inspector panels ──
  const row = (label, ...ctl) => h('div', { className: 'row' }, h('span', { textContent: label }), h('span', { className: 'ctl' }, ...ctl));
  const numIn = (value, attrs = {}) => h('input', { type: 'number', value: value ?? '', style: 'width:64px', ...attrs });
  const selIn = (opts2, value, title = '') => { const s = h('select', { title }, ...opts2.map(([v, t]) => h('option', { value: v, textContent: t }))); s.value = value; return s; };
  const setC = (f, k, v) => commit(() => { f.content = { ...(f.content || {}) }; if (v == null || v === '' || v === false) delete f.content[k]; else f.content[k] = v; });
  // NAMED STYLES: wear one (its values copied in), make one from this frame, or redefine the one it wears from it —
  // every frame wearing a style follows its redefinition
  function stylePanel(f) {
    const all = stylesOf(D), names = Object.keys(all);
    const s0 = selIn([['', '— none'], ...names.map((n) => [n, n]), ['+new', '+ new style from this frame…']], f.styleName && all[f.styleName] ? f.styleName : '', 'a named style: change it once and every frame wearing it follows');
    s0.onchange = async () => {
      if (s0.value === '+new') {
        const nm = await askName(); if (!nm) { s0.value = f.styleName || ''; return; }
        commit(() => { const n = defineStyle(D, nm, styleFromFrame(f)); f.styleName = nm; say(`style “${nm}” — ${n} frame${n === 1 ? '' : 's'} wear it`); });
      } else commit(() => { if (s0.value) applyStyleToFrame(f, all[s0.value], s0.value); else delete f.styleName; });
    };
    const parts = [s0];
    if (f.styleName && all[f.styleName]) {
      const differs = JSON.stringify(styleFromFrame(f)) !== JSON.stringify({ content: { ...all[f.styleName].content }, style: { ...all[f.styleName].style } });
      const up = h('button', { textContent: 'Update style', title: `make “${f.styleName}” this frame's look — every frame wearing it follows`, disabled: !differs });
      up.onclick = () => commit(() => { const n = defineStyle(D, f.styleName, styleFromFrame(f)); say(`“${f.styleName}” redefined — ${n} frame${n === 1 ? '' : 's'} follow`); });
      parts.push(up);
    }
    insp.append(row('style', ...parts));
  }
  // a name for a new style, asked in the side panel (no window.prompt: some hosts forbid it)
  function askName() {
    return new Promise((res) => {
      const inp = h('input', { placeholder: 'style name', spellcheck: false }), ok = h('button', { textContent: 'Make' }), no = h('button', { textContent: '×' });
      const r = row('name', inp, ok, no); insp.append(r); inp.focus();
      const done = (v) => { r.remove(); res(v); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
      ok.onclick = () => done(inp.value.trim() || null); no.onclick = () => done(null);
    });
  }
  function pagePanel() {
    const pg = D.page, m = pg.margins || [10, 10, 10, 10];
    insp.append(h('div', { textContent: 'page', style: 'font-weight:bold' }));
    const mIn = ['top', 'right', 'bottom', 'left'].map((t, i) => { const x = numIn(m[i], { min: 0, max: 60, step: 1, title: `${t} margin (mm)`, style: 'width:48px' });
      x.onchange = () => commit(() => { const mm = [...(D.page.margins || [10, 10, 10, 10])]; mm[i] = Math.max(0, +x.value || 0); D.page.margins = mm; }); return x; });
    insp.append(row('margins', ...mIn.map((x, i) => h('span', { className: 'pair' }, h('i', { textContent: '↑→↓←'[i] }), x))));
    const bgOn = h('input', { type: 'checkbox', checked: !!pg.background && pg.background !== '#ffffff', title: 'a paper colour other than white' });
    const bgC = h('input', { type: 'color', value: toHex(pg.background, '#ffffff') });
    bgOn.onchange = () => commit(() => { if (bgOn.checked) D.page.background = bgC.value; else delete D.page.background; });
    bgC.onchange = () => { if (bgOn.checked) commit(() => { D.page.background = bgC.value; }); };
    insp.append(row('paper', bgOn, bgC));
    const fnt = selIn([['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']], pg.font || 'sans', 'the typeface of every text that names none');
    fnt.onchange = () => commit(() => { if (fnt.value === 'sans') delete D.page.font; else D.page.font = fnt.value; });
    insp.append(row('typeface', fnt));
  }
  function multiPanel() {
    const fs = sel.map((id) => frameById(D, id)).filter(Boolean);
    const bd = h('input', { type: 'checkbox', checked: fs.every((f) => f.style && f.style.border) });
    bd.indeterminate = !bd.checked && fs.some((f) => f.style && f.style.border);
    bd.onchange = () => commit(() => { for (const f of fs) { f.style = { ...(f.style || {}) }; if (bd.checked) f.style.border = true; else delete f.style.border; } });
    insp.append(row('border', bd));
    const texts = fs.filter((f) => f.kind === 'text' || f.kind === 'label');
    if (texts.length === fs.length) {                       // all text: the type, together
      const sizes = new Set(texts.map((f) => +f.content.size || (f.kind === 'label' ? 7 : 9)));
      const sz = numIn(sizes.size === 1 ? [...sizes][0] : '', { min: 4, max: 72, step: 0.5, placeholder: 'mixed' });
      sz.onchange = () => commit(() => { for (const f of texts) f.content.size = +sz.value || f.content.size; });
      const col = h('input', { type: 'color', value: toHex(texts[0].content.color), title: 'text colour, all of them' });
      col.onchange = () => commit(() => { for (const f of texts) f.content.color = col.value; });
      const fnt = selIn([['', '— as they are'], ['sans', 'sans'], ['serif', 'serif'], ['mono', 'monospace']], '', 'their typeface');
      fnt.onchange = () => { if (fnt.value) commit(() => { for (const f of texts) { f.content.font = fnt.value; delete f.content.mono; } }); };
      insp.append(row('size (pt)', sz, col), row('typeface', fnt));
    }
    insp.append(h('div', { className: 'hint', textContent: '⌘C / ⌘V copy and paste frames (between figures too) · ⌘⌥C / ⌘⌥V copy one frame’s style onto others' }));
  }
  function tablePanel(f) {
    const c = f.content || {};
    const ti = h('input', { value: c.title || '', placeholder: 'title (fields work)' }); ti.onchange = () => setC(f, 'title', ti.value);
    const no = h('input', { value: c.note || '', placeholder: 'a note under it (source, units…)' }); no.onchange = () => setC(f, 'note', no.value);
    const sz = numIn(c.size || 7.5, { min: 4.5, max: 14, step: 0.5, title: 'type size (pt) — it shrinks to fit the width' }); sz.onchange = () => setC(f, 'size', +sz.value || null);
    const zb = h('input', { type: 'checkbox', checked: c.zebra !== false, title: 'light stripes on alternate rows' }); zb.onchange = () => commit(() => { f.content = { ...c, zebra: zb.checked }; });
    const dc = numIn(c.decimals ?? '', { min: 0, max: 8, step: 1, placeholder: 'as is', title: 'every number to this many decimal places (empty: as it came)' }); dc.onchange = () => setC(f, 'decimals', dc.value === '' ? null : Math.max(0, Math.min(8, Math.round(+dc.value))));
    const fit = h('button', { textContent: 'Fit height', title: 'make the frame as tall as all its rows' });
    fit.onclick = () => commit(() => { const lh = (+c.size || 7.5) * 0.3528 * 1.55; f.box[3] = +(0.3 + (c.title ? lh * 1.15 : 0) + lh * (1 + (c.rows || []).length) + (c.note ? lh : 0) + 1.2).toFixed(1); });
    insp.append(row('title', ti), row('note', no), row('size (pt)', sz, zb, h('span', { textContent: 'stripes' })), row('decimals', dc, fit));
    // the CELLS, as tab-separated text (the header first): edit here, or paste over it from a spreadsheet
    const toTsv = (cc) => [(cc.columns || []).join('\t'), ...(cc.rows || []).map((r) => (r || []).map((v) => (v == null ? '' : String(v))).join('\t'))].join('\n');
    const cells = h('textarea', { className: 'compo-cells', value: toTsv(c), spellcheck: false, rows: Math.min(10, 2 + (c.rows || []).length), title: 'the table as tab-separated text, the header row first — edit it, or paste cells from a spreadsheet; applied when you leave the box' });
    cells.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const a = cells.selectionStart; cells.setRangeText('\t', a, cells.selectionEnd, 'end'); } };
    cells.onchange = () => { const t2 = tableFromTsv(cells.value, ''); if (!t2) { say('a table needs a header row'); return; } commit(() => { f.content = { ...f.content, columns: t2.columns, rows: t2.rows }; }); };
    insp.append(h('div', { className: 'row' }, h('span', { textContent: 'cells' }), h('span', { className: 'hint', textContent: 'tab-separated, header first (Tab types a tab)' })), cells);
    const cols = (c.columns || []).slice(0, 12);
    if (cols.length) {
      const al = cols.map((name, j) => { const s = selIn([['', 'auto'], ['l', 'left'], ['c', 'centre'], ['r', 'right']], (c.align && c.align[j]) || '', `column “${name}”`);
        s.onchange = () => commit(() => { const a = [...(f.content.align || [])]; while (a.length < cols.length) a.push(''); a[j] = s.value; f.content = { ...f.content, align: a.some(Boolean) ? a : undefined }; if (!f.content.align) delete f.content.align; }); return h('span', { className: 'pair', title: name }, h('i', { textContent: String(name).slice(0, 6) }), s); });
      insp.append(h('div', { className: 'row' }, h('span', { textContent: 'align' }), h('span', { className: 'ctl', style: 'flex-wrap:wrap' }, ...al)));
    }
  }
  function scalebarPanel(f) {
    const c = f.content || {};
    const ln = numIn(c.length ?? '', { min: 0, step: 'any', placeholder: 'auto', title: 'the bar’s length in the view’s units (empty: the roundest that fits)' }); ln.onchange = () => setC(f, 'length', +ln.value > 0 ? +ln.value : null);
    const sg = numIn(c.segments || 4, { min: 1, max: 10, step: 1, title: 'divisions' }); sg.onchange = () => setC(f, 'segments', Math.max(1, Math.min(10, Math.round(+sg.value || 4))));
    const st = selIn([['alternating', 'alternating'], ['line', 'line'], ['ticks', 'ticks, each labelled']], c.style || 'alternating'); st.onchange = () => setC(f, 'style', st.value === 'alternating' ? null : st.value);
    const ra = h('input', { type: 'checkbox', checked: !!c.ratio, title: 'the representative fraction under it (1 : 2 500) — a view in metres' }); ra.onchange = () => setC(f, 'ratio', ra.checked);
    insp.append(row('length', ln, sg, h('span', { textContent: 'parts' })), row('style', st, ra, h('span', { textContent: '1 : N' })));
  }
  function northPanel(f) {
    const c = f.content || {}, ref = c.reference || 'grid';
    const st = selIn([['arrow', 'arrow'], ['needle', 'needle'], ['star', 'compass star'], ['line', 'line']], c.style || 'arrow');
    st.onchange = () => setC(f, 'style', st.value === 'arrow' ? null : st.value);
    const rf = selIn([['grid', 'grid north (the map’s +Y)'], ['true', 'true north'], ['magnetic', 'magnetic north'], ['all', 'all three (a north diagram)']], ref);
    rf.onchange = () => setC(f, 'reference', rf.value === 'grid' ? null : rf.value);
    insp.append(row('north', rf));
    if (ref !== 'all') insp.append(row('style', st));
    if (ref === 'grid') return;
    // the angles: the host's (from where the view is), unless typed here
    const meta = (() => { try { const t = subjectFrame({ doc: D }, f, (x) => x.content && x.content.meta); return (t && t.content && t.content.meta) || {}; } catch { return {}; } })();
    const A = northAnglesOf(f, opts.env || {}, meta);
    const ang = (key, label, title) => {
      const typed = c[key] != null && c[key] !== '';
      const inp = numIn(typed ? c[key] : '', { step: 'any', placeholder: !typed && A[key] != null ? `${(+A[key]).toFixed(2)} (here)` : 'needed', title });
      inp.onchange = () => setC(f, key, inp.value === '' ? null : +inp.value);
      return row(label, inp, h('span', { textContent: '°' }));
    };
    insp.append(ang('convergence', 'γ grid → true', 'the grid convergence: degrees from grid north to true north, clockwise positive. Empty: from the project’s coordinate system where the view is'));
    if (ref !== 'true') insp.append(ang('declination', 'δ true → mag.', 'the magnetic declination: degrees from true north to magnetic north, east (clockwise) positive. Empty: from the World Magnetic Model where the view is'));
    // where the view is, for a host that works the angles out (its own coordinate system wins; this is the fallback)
    if (opts.env && typeof opts.env.northAngles === 'function') {
      const ll = (key, ph) => { const inp = numIn(c[key] ?? '', { step: 'any', placeholder: ph, title: `the view's ${key === 'lat' ? 'latitude' : 'longitude'} in decimal degrees, when the project has no coordinate system to say it` }); inp.style.width = '64px'; inp.onchange = () => setC(f, key, inp.value === '' ? null : +inp.value); return inp; };
      insp.append(row('place', ll('lat', 'lat'), ll('lon', 'lon')));
    }
    if (ref !== 'all') {
      const sh = h('input', { type: 'checkbox', checked: c.angles !== false, title: 'its angle written under the arrow' });
      sh.onchange = () => setC(f, 'angles', sh.checked ? null : false);
      insp.append(row('caption', sh, h('span', { textContent: 'the angle under it' })));
    }
    if (A.source) insp.append(h('div', { className: 'hint', textContent: `here: ${A.source}` }));
  }
  function shapePanel(f) {
    const c = f.content || {}, kind = c.shape || 'rect';
    const sh = selIn([['rect', 'rectangle'], ['ellipse', 'ellipse'], ['line', 'line'], ['arrow', 'arrow']], kind); sh.onchange = () => setC(f, 'shape', sh.value);
    const sOn = h('input', { type: 'checkbox', checked: c.stroke !== '', title: 'an outline' });
    const sC = h('input', { type: 'color', value: toHex(c.stroke) }); const sW = numIn(c.width || 0.35, { min: 0.05, max: 5, step: 0.05, title: 'line width (mm)' });
    sOn.onchange = () => commit(() => { f.content = { ...f.content }; if (sOn.checked) { if (f.content.stroke === '') delete f.content.stroke; } else f.content.stroke = ''; });
    sC.onchange = () => setC(f, 'stroke', sC.value); sW.onchange = () => setC(f, 'width', +sW.value || null);
    const dsh = h('input', { type: 'checkbox', checked: !!c.dash, title: 'dashed' }); dsh.onchange = () => setC(f, 'dash', dsh.checked);
    insp.append(row('shape', sh), row('line', sOn, sC, sW, dsh, h('span', { textContent: 'dashed' })));
    if (kind === 'rect' || kind === 'ellipse') {
      const fOn = h('input', { type: 'checkbox', checked: !!c.fill }); const fC = h('input', { type: 'color', value: toHex(c.fill, '#f2e7c9') });
      fOn.onchange = () => setC(f, 'fill', fOn.checked ? fC.value : null); fC.onchange = () => { if (fOn.checked) setC(f, 'fill', fC.value); };
      const parts = [fOn, fC];
      if (kind === 'rect') { const rr = numIn(c.radius || 0, { min: 0, max: 30, step: 0.5, title: 'rounded corners (mm)' }); rr.onchange = () => setC(f, 'radius', +rr.value || null); parts.push(h('span', { className: 'pair' }, h('i', { textContent: '◜' }), rr)); }
      insp.append(row('fill', ...parts));
    } else {
      const dr = selIn([['h', '→ across'], ['v', '↓ down'], ['down', '↘ diagonal'], ['up', '↗ diagonal']], c.dir || 'h', 'the way across its frame (the frame’s corners are its ends)'); dr.onchange = () => setC(f, 'dir', dr.value === 'h' ? null : dr.value);
      const parts = [dr];
      if (kind === 'arrow') { const hd = selIn([['end', 'head at the end'], ['both', 'heads at both ends']], c.heads || 'end'); hd.onchange = () => setC(f, 'heads', hd.value === 'end' ? null : hd.value); parts.push(hd); }
      insp.append(row('way', ...parts));
    }
  }
  function qrPanel(f) {
    const c = f.content || {};
    const tx = h('input', { value: c.text || '', placeholder: 'https://… or any text', spellcheck: false });
    const ec = selIn([['L', 'L — 7 %'], ['M', 'M — 15 %'], ['Q', 'Q — 25 %'], ['H', 'H — 30 %']], c.ecc || 'M', 'error correction: how much of it can be damaged and still read');
    const cap = h('input', { type: 'checkbox', checked: !!c.caption, title: 'the text under the code' });
    const apply = (patch) => { try { const next = qrContent({ ...f.content, ...patch }); commit(() => { f.content = next; if (!next.caption) delete f.content.caption; }); } catch (e) { say(e.message); } };
    tx.onchange = () => apply({ text: tx.value.trim() }); ec.onchange = () => apply({ ecc: ec.value }); cap.onchange = () => commit(() => { f.content = { ...f.content, caption: cap.checked }; });
    tx.disabled = ec.disabled = !hasQrEncoder();
    insp.append(row('text', tx), row('level', ec, cap, h('span', { textContent: 'caption' })));
    if (!hasQrEncoder()) insp.append(h('div', { className: 'hint', textContent: 'this app can print QR codes but not make new ones' }));
  }
  function fiducialPanel(f) {
    const c = f.content || {};
    const id = numIn(c.id || 0, { min: 0, max: 586, step: 1, title: 'the tag\'s id in its family (36h11: 0–586) — each marker on a page a different one' });
    id.onchange = () => setC(f, 'id', Math.max(0, Math.min(586, Math.round(+id.value || 0))));
    const cap = h('input', { type: 'checkbox', checked: !!c.caption, title: 'its family and id printed under it' }); cap.onchange = () => setC(f, 'caption', cap.checked);
    const dup = D.frames.filter((x) => x !== f && x.kind === 'fiducial' && Math.round(+x.content.id || 0) === Math.round(+c.id || 0)).length;
    insp.append(row('tag id', id, cap, h('span', { textContent: 'caption' })));
    if (dup) insp.append(h('div', { className: 'hint', textContent: `another marker on this page has id ${c.id || 0} — give each its own, so a scan can tell them apart` }));
  }
  function addQr() {
    if (!hasQrEncoder()) { say('this app can’t make QR codes'); return; }
    const f = add({ kind: 'qr', box: freeSpot(D, 28, 28), content: { ecc: 'M' } });
    requestAnimationFrame(() => { const t = side.querySelector('input[placeholder^="https"]'); if (t) t.focus(); });
    return f;
  }

  // ── copy / paste: frames (as JSON on the clipboard, so another figure — in this app or the other — takes them) and
  // a frame's STYLE (its border and fill, its type) onto others ──
  const CLIP = 'compo-frames/1\n';
  const STYLE_KEYS = ['size', 'font', 'color', 'align', 'valign', 'lineHeight', 'pad', 'backing', 'leader', 'stroke', 'width', 'dash', 'fill', 'radius'];
  let styleClip = null;
  function copyFrames() {
    const fs = sel.map((id) => frameById(D, id)).filter(Boolean); if (!fs.length) return null;
    return CLIP + serializeDocument({ frames: fs.map((f) => ({ ...f })) });
  }
  function pasteFrames(text) {
    if (!String(text).startsWith(CLIP)) return false;
    let data; try { data = JSON.parse(String(text).slice(CLIP.length)); } catch { return false; }
    const fr = (data.frames || []).filter((f) => f && f.kind && f.box), unknown = fr.filter((f) => !kindOf(f.kind)).map((f) => f.kind);
    const made = [];
    commit(() => {
      const groups = new Map();
      for (const c of fr) {
        if (!kindOf(c.kind)) continue;
        const ownId = !frameById(D, c.id);                 // from another figure: its id may stay; here: a fresh one
        const box = [...c.box]; if (!ownId) { box[0] += 5; box[1] += 5; }
        const g = c.group; const nf = addFrame(D, { ...c, box, id: ownId ? c.id : undefined, group: undefined });
        if (g) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(nf.id); }
        made.push(nf);
      }
      for (const ids of groups.values()) if (ids.length > 1) groupFrames(D, ids);
    });
    sel = made.map((f) => f.id); render();
    ensureImages(D).then(() => renderCanvas(), () => {});
    say(`${made.length} frame${made.length === 1 ? '' : 's'} pasted${unknown.length ? ` — ${unknown.length} left out (${[...new Set(unknown)].join(', ')}: not something this app draws)` : ''}`);
    return true;
  }
  root.addEventListener('copy', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = copyFrames(); if (!t) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', t); say(`${sel.length} frame${sel.length === 1 ? '' : 's'} copied`);
  });
  root.addEventListener('cut', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = copyFrames(); if (!t) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', t); del();
  });
  root.addEventListener('paste', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (t && pasteFrames(t)) { e.preventDefault(); return; }
    // cells copied from a spreadsheet (tab-separated, a header and a row at least) → a TABLE frame, in free space
    if (t && /\t/.test(t) && t.replace(/\r/g, '').trim().split('\n').length >= 2) {
      const c = tableFromTsv(t, ''); if (!c) return;
      e.preventDefault();
      const w = Math.min(160, 14 + 18 * c.columns.length), hh = Math.min(180, +(5 + 7.5 * 0.3528 * 1.55 * (c.rows.length + 1.5)).toFixed(1));
      add({ kind: 'table', box: freeSpot(D, w, hh, { shrink: true }), content: c });
      say(`a table: ${c.columns.length} columns × ${c.rows.length} rows — edit its cells in its panel`);
    }
  });
  function copyStyle() {
    const f = frameById(D, sel[0]); if (!f) return;
    const c = f.content || {}, content = {}; for (const k of STYLE_KEYS) if (c[k] !== undefined) content[k] = c[k];
    styleClip = { style: { ...(f.style || {}) }, content, from: f.kind };
    say(`style copied from ${f.id} — ⌘⌥V puts it on the selected frames`);
  }
  function pasteStyle() {
    if (!styleClip || !sel.length) return;
    commit(() => {
      for (const id of sel) {
        const f = frameById(D, id); if (!f || f.locked) continue;
        f.style = { ...styleClip.style }; if (!Object.keys(f.style).length) delete f.style;
        f.content = { ...(f.content || {}) };
        for (const [k, v] of Object.entries(styleClip.content)) {
          // a shape's colours stay a shape's, a text's type a text's: only the keys that mean the same on both
          const shapeKey = ['stroke', 'width', 'dash', 'fill', 'radius'].includes(k);
          if (shapeKey === (f.kind === 'shape')) f.content[k] = v;
        }
      }
    });
    say(`style put on ${sel.length} frame${sel.length === 1 ? '' : 's'}`);
  }

  // ── actions ──
  function add(frame) { let f; commit(() => { f = addFrame(D, frame); }); sel = [f.id]; render(); return f; }
  function del() {
    const locked = sel.filter((id) => frameById(D, id).locked), go = sel.filter((id) => !locked.includes(id));
    if (go.length) commit(() => removeFrames(D, go));
    sel = locked; render();
    if (locked.length) say(`${locked.length} locked frame${locked.length === 1 ? '' : 's'} kept — unlock to delete`);
  }
  function doGroup() { if (unitsOf(D, sel).length < 2) return; commit(() => groupFrames(D, sel)); say('grouped — they select and move as one'); }
  function doUngroup() { if (!sel.some((id) => frameById(D, id).group)) return; commit(() => ungroupFrames(D, sel)); say('ungrouped'); }
  function dup() {
    if (!sel.length) return;
    const made = [];
    commit(() => {
      for (const id of sel) {
        const f = frameById(D, id), c = JSON.parse(serializeDocument({ frames: [f] })).frames[0];
        c.box[0] += 5; c.box[1] += 5; if (f._img) c._img = f._img;
        const g = c.group; delete c.group;
        const nf = addFrame(D, { ...c, id: undefined }); nf._from = g; if (c.locked) nf.locked = true;
        if (f._img) nf._img = f._img;
        made.push(nf);
      }
      // copies of a group are a NEW group
      for (const g of new Set(made.map((m) => m._from).filter(Boolean))) groupFrames(D, made.filter((m) => m._from === g).map((m) => m.id));
      for (const m of made) delete m._from;
    });
    sel = made.map((f) => f.id); render();
  }
  function menu(x, y, items) {
    document.querySelectorAll('.compo-menu').forEach((m) => m.remove());
    const m = h('div', { className: 'compo-menu' });
    for (const it of items) {
      if (it.sep) { if (m.lastChild && !m.lastChild.dataset.sep) m.append(h('hr', { style: 'border:0;border-top:1px solid var(--compo-border, var(--border, #3a3d42));margin:3px 0', 'data-sep': '1' })); continue; }
      m.append(h('div', { textContent: it.label, onclick: () => { m.remove(); root.focus(); it.run(); } }));
    }
    m.style.left = x + 'px'; m.style.top = y + 'px';
    document.body.append(m);
    const off = (ev) => { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
    setTimeout(() => addEventListener('pointerdown', off, true), 0);
  }
  function zoomFit() {
    const [W, H] = pageDims(D.page);
    const r = scroll.getBoundingClientRect();
    zoom = Math.max(0.5, Math.min((r.width - 48) / W, (r.height - 48) / H)) || 3;
    zoomSel.value = 'fit';
    render();
  }

  const api = {
    el: root,
    getDoc: () => D,
    setDoc(next) { D = next; sel = []; hist.length = 0; fut.length = 0; ensureImages(D).then(() => render()); render(); },
    selected: () => sel.map((id) => frameById(D, id)).filter(Boolean),
    select(ids) { sel = ids.filter((id) => frameById(D, id)); render(); },
    addFrame: add, render, zoomFit, undo, redo,
    // change a frame from outside (the host re-rendered it) as one undo step
    update(id, fn) { commit(() => { const f = frameById(D, id); if (f) fn(f); }); },
    destroy() { el.replaceChildren(); },
  };
  ensureImages(D).then(() => render());
  render();
  requestAnimationFrame(() => zoomFit());
  return api;
}
