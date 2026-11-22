// The page editor — host-agnostic DOM. A toolbar (page size / orientation / custom mm, zoom, add
// text, align · distribute, front / back, delete, plus the HOST's buttons), the page preview with
// a frame overlay (select · shift-select · drag to move with snapping guides · 8 handles to
// resize · arrows nudge · Delete · ⌘D duplicate · ⌘Z / ⌘⇧Z undo),
// box select (drag on empty page), groups (⌘G / ⌘⇧G: select and move as one), equal-spacing
// guides, snapping while resizing, match size, one-step z-order (⌘] / ⌘[), locks (a locked frame
// won't move, resize or delete), a context menu (host items +
// built-ins) and an inspector for the selected frame (box in mm, border, the kind's own fields).
//
// mountEditor(el, doc, { env, onChange(doc), toolbar: [{ label, title, run(editor) }],
//   frameMenu(frame, editor) → [{ label, run }], inspector(frame, panelEl, editor) }) → editor

import { PAPER, pageDims, addFrame, frameById, removeFrames, bringToFront, sendToBack, bringForward, sendBackward, alignFrames, distributeFrames, matchSize, groupFrames, ungroupFrames, expandGroups, unitsOf, boundsOf, snapBox, snapResize, serializeDocument } from './model.js';
import { renderPage, ensureImages } from './render.js';
import { kindOf } from './kinds.js';

const CSS = `
.compo-root { display: flex; flex-direction: column; height: 100%; min-height: 0; font: 12px/1.35 var(--compo-font, system-ui, sans-serif); color: var(--compo-fg, var(--text, #ddd)); outline: none; }
.compo-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 6px; border-bottom: 1px solid var(--compo-border, var(--border, #3a3d42)); }
.compo-bar button, .compo-bar select, .compo-bar input, .compo-side input, .compo-side select, .compo-side textarea, .compo-side button { background: var(--compo-btn, var(--bg-btn, #2a2d31)); color: inherit; border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 3px; font: inherit; padding: 2px 6px; }
.compo-bar button:hover:not(:disabled) { border-color: var(--compo-accent, var(--accent, #fb9044)); }
.compo-bar button:disabled { opacity: 0.4; }
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
.compo-side .row { display: flex; gap: 4px; align-items: center; }
.compo-side .row > span:first-child { width: 58px; color: var(--compo-dim, var(--dim, #9a9a9a)); }
.compo-side input[type=number] { width: 54px; }
.compo-side textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-family: var(--compo-mono, monospace); }
.compo-side .hint { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; }
.compo-fr.locked::after { content: 'locked'; position: absolute; right: 1px; top: 1px; font: 9px/1 system-ui, sans-serif; padding: 1px 3px; background: rgba(40,40,40,0.75); color: #fff; border-radius: 2px; pointer-events: none; }
.compo-grp { position: absolute; border: 1px dashed #3c82e6; pointer-events: none; box-sizing: border-box; }
.compo-marq { position: absolute; border: 1px solid #3c82e6; background: rgba(60,130,230,0.12); pointer-events: none; }
.compo-gap { position: absolute; background: #e6339a; pointer-events: none; }
.compo-gap-l { position: absolute; font: 10px/1 system-ui, sans-serif; color: #fff; background: #e6339a; padding: 1px 3px; border-radius: 2px; transform: translate(-50%, -50%); pointer-events: none; white-space: nowrap; }
.compo-bar .status { color: var(--compo-dim, var(--dim, #9a9a9a)); font-size: 11px; margin-left: 4px; }
.compo-menu { position: fixed; z-index: 99999; background: var(--compo-btn, var(--bg-panel, #24272b)); border: 1px solid var(--compo-border, var(--border, #3a3d42)); border-radius: 4px; padding: 3px 0; min-width: 150px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.compo-menu div { padding: 4px 12px; cursor: pointer; }
.compo-menu div:hover { background: var(--compo-accent, var(--accent, #fb9044)); color: #111; }
`;
let _css = false;
function injectCss() { if (_css || typeof document === 'undefined') return; _css = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v; else if (k in e) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };

export function mountEditor(el, doc, opts = {}) {
  injectCss();
  let D = doc, zoom = 3, sel = [];
  const hist = [], fut = [];
  const env = () => ({ ...(opts.env || {}) });
  const root = h('div', { className: 'compo-root', tabIndex: 0 });
  const bar = h('div', { className: 'compo-bar' });
  const scroll = h('div', { className: 'compo-scroll' });
  const wrap = h('div', { className: 'compo-pagewrap' });
  const cv = h('canvas');
  const overlay = h('div', { className: 'compo-overlay' });
  const side = h('div', { className: 'compo-side' });
  wrap.append(cv, overlay); scroll.append(wrap);
  root.append(bar, h('div', { className: 'compo-main' }, scroll, side));
  el.replaceChildren(root);

  // ── history ──
  const snap = () => serializeDocument(D);
  const imgCache = new Map();                              // frame id → decoded bitmap (survives undo)
  const keepImgs = () => { for (const f of D.frames) if (f._img) imgCache.set(f.id, { img: f._img, jpeg: f._jpeg }); };
  function commit(fn) {
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
  const undo = () => { if (!hist.length) return; fut.push(snap()); restoreFrom(hist.pop()); };
  const redo = () => { if (!fut.length) return; hist.push(snap()); restoreFrom(fut.pop()); };
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
  const alignBtns = [['⇤', 'left'], ['⇹', 'hcenter'], ['⇥', 'right'], ['⤒', 'top'], ['⇳', 'vcenter'], ['⤓', 'bottom']].map(([l, how]) => btn(l, `align ${how}`, () => commit(() => alignFrames(D, sel, how))));
  const distBtns = [['↔', 'h'], ['↕', 'v']].map(([l, ax]) => btn(l, ax === 'h' ? 'distribute horizontally' : 'distribute vertically', () => commit(() => distributeFrames(D, sel, ax))));
  const sizeBtns = [['W=', 'w', 'same width as the first selected'], ['H=', 'h', 'same height as the first selected'], ['▣=', 'both', 'same size as the first selected']].map(([l, what, t]) => btn(l, t, () => commit(() => matchSize(D, sel, what))));
  const groupBtn = btn('group', 'group the selected frames (⌘G) — they select and move as one', () => doGroup());
  const ungroupBtn = btn('ungroup', 'ungroup (⌘⇧G)', () => doUngroup());
  const frontBtn = btn('front', 'bring to front (⌘⇧])', () => commit(() => bringToFront(D, sel)));
  const fwdBtn = btn('↑', 'bring forward one step (⌘])', () => commit(() => bringForward(D, sel)));
  const bwdBtn = btn('↓', 'send backward one step (⌘[)', () => commit(() => sendBackward(D, sel)));
  const backBtn = btn('back', 'send to back (⌘⇧[)', () => commit(() => sendToBack(D, sel)));
  const delBtn = btn('delete', 'delete the selected frames (locked ones stay)', () => del());
  const status = h('span', { className: 'status' });
  let _stT = 0;
  const say = (msg) => { status.textContent = msg; clearTimeout(_stT); _stT = setTimeout(() => { status.textContent = ''; }, 4000); if (opts.onStatus) opts.onStatus(msg); };
  bar.append(sizeSel, oriSel, customSpan, h('span', { className: 'sep' }), zoomSel, h('span', { className: 'sep' }),
    btn('+ text', 'add a text frame (fields: {fig} {page} {date} ${…})', () => add({ kind: 'text', content: { md: '**Figure {fig}.** caption', size: 9 } })),
    h('span', { className: 'sep' }), ...alignBtns, ...distBtns, ...sizeBtns, h('span', { className: 'sep' }), groupBtn, ungroupBtn, h('span', { className: 'sep' }), frontBtn, fwdBtn, bwdBtn, backBtn, delBtn);
  if (opts.toolbar && opts.toolbar.length) {
    bar.append(h('span', { className: 'sep' }));
    for (const t of opts.toolbar) bar.append(btn(t.label, t.title || '', () => t.run(api)));
  }
  bar.append(status);

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
  }
  function drawOverlay(guides) {
    overlay.replaceChildren();
    const m = D.page.margins || [0, 0, 0, 0], [W, H] = pageDims(D.page);
    overlay.append(h('div', { className: 'compo-margin', style: `left:${m[3] * zoom}px;top:${m[0] * zoom}px;width:${(W - m[1] - m[3]) * zoom}px;height:${(H - m[0] - m[2]) * zoom}px` }));
    for (const f of D.frames) {
      const b = f.box;
      const d = h('div', { className: 'compo-fr' + (sel.includes(f.id) ? ' sel' : '') + (f.locked ? ' locked' : ''), title: `${(kindOf(f.kind) && kindOf(f.kind).label) || f.kind}` });
      d.style.cssText = `left:${b[0] * zoom}px;top:${b[1] * zoom}px;width:${b[2] * zoom}px;height:${b[3] * zoom}px`;
      d.dataset.id = f.id;
      overlay.append(d);
      if (sel.length === 1 && sel[0] === f.id && !f.locked) {
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
          const k = h('div', { className: 'compo-h' });
          k.style.left = `${b[0] * zoom + hx * b[2] * zoom}px`; k.style.top = `${b[1] * zoom + hy * b[3] * zoom}px`;
          k.style.cursor = (hx === 0.5 ? 'ns' : hy === 0.5 ? 'ew' : (hx === hy ? 'nwse' : 'nesw')) + '-resize';
          k.dataset.handle = `${hx},${hy}`; k.dataset.id = f.id;
          overlay.append(k);
        }
      }
    }
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
      } while (_sideAgain);
    } finally { _inSide = false; }
  }
  function buildSide() {
    side.replaceChildren();
    if (sel.length !== 1) {
      if (sel.length) {
        const nu = unitsOf(D, sel).length, locked = sel.filter((id) => frameById(D, id).locked).length;
        side.append(h('div', { className: 'hint', textContent: `${sel.length} frames${nu < sel.length ? ` in ${nu} unit${nu === 1 ? '' : 's'} (groups move as one)` : ''} — align / distribute / match size from the toolbar; the FIRST selected is the size key` }));
        const lk = h('input', { type: 'checkbox', checked: locked === sel.length });
        lk.indeterminate = locked > 0 && locked < sel.length;
        lk.onchange = () => commit(() => { for (const id of sel) frameById(D, id).locked = lk.checked; });
        side.append(h('label', { className: 'row' }, h('span', { textContent: 'locked' }), lk));
      } else side.append(h('div', { className: 'hint', textContent: 'click a frame to edit it · drag to move (snaps to edges, centres and equal gaps; ⌥ off) · drag on the empty page to box-select · handles resize · arrows nudge (⇧ ×10) · ⌘G group · ⌘Z undo' }));
      return;
    }
    const f = frameById(D, sel[0]); if (!f) return;
    const kind = kindOf(f.kind);
    side.append(h('div', { textContent: `${(kind && kind.label) || f.kind}`, style: 'font-weight:bold' }));
    const num = (label, i) => {
      const inp = h('input', { type: 'number', step: 0.5, value: +f.box[i].toFixed(1) });
      inp.onchange = () => commit(() => { const v = +inp.value; if (Number.isFinite(v)) f.box[i] = i >= 2 ? Math.max(2, v) : v; });
      return h('span', { style: 'display:inline-flex;gap:2px;align-items:center' }, label, inp);
    };
    side.append(h('div', { className: 'row' }, h('span', { textContent: 'position' }), num('x', 0), num('y', 1)));
    side.append(h('div', { className: 'row' }, h('span', { textContent: 'size' }), num('w', 2), num('h', 3)));
    const bd = h('input', { type: 'checkbox', checked: !!(f.style && f.style.border) });
    bd.onchange = () => commit(() => { f.style = { ...(f.style || {}), border: bd.checked }; });
    side.append(h('label', { className: 'row' }, h('span', { textContent: 'border' }), bd));
    const lk = h('input', { type: 'checkbox', checked: !!f.locked });
    lk.onchange = () => commit(() => { f.locked = lk.checked; });
    side.append(h('label', { className: 'row', title: 'a locked frame won’t move, resize or delete' }, h('span', { textContent: 'locked' }), lk));
    if (f.group) side.append(h('div', { className: 'hint', textContent: `in a group of ${D.frames.filter((x) => x.group === f.group).length} — ⌘⇧G ungroups` }));
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
      const mono = h('input', { type: 'checkbox', checked: !!f.content.mono });
      mono.onchange = () => commit(() => { f.content.mono = mono.checked; });
      side.append(ta, h('div', { className: 'row' }, h('span', { textContent: 'size (pt)' }), size, align), h('label', { className: 'row' }, h('span', { textContent: 'monospace' }), mono),
        h('div', { className: 'hint', textContent: '**bold** · fields {fig} {page} {pages} {date} {title} · ${expr} from the host' }));
      api._focusText = () => ta.focus();
    }
    if (f.kind === 'image') {
      const fit = h('select', {}, ...['contain', 'cover', 'fill'].map((v) => h('option', { value: v, textContent: v })));
      fit.value = f.content.fit || 'contain';
      fit.onchange = () => commit(() => { f.content.fit = fit.value; });
      side.append(h('div', { className: 'row' }, h('span', { textContent: 'fit' }), fit));
    }
    if (f.kind === 'legend') {
      const t = h('input', { value: f.content.title || '' });
      t.onchange = () => commit(() => { f.content.title = t.value; });
      side.append(h('div', { className: 'row' }, h('span', { textContent: 'title' }), t));
    }
    if (opts.inspector) opts.inspector(f, side, api);
    if (f.produced) side.append(h('div', { className: 'hint', textContent: `produced ${String(f.produced).replace('T', ' ').slice(0, 16)}` }));
  }

  // ── pointer: select, move (snapping), resize ──
  const toMm = (e) => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();                                    // keep the keyboard on the editor (no mousedown focus shuffle)
    root.focus();
    const t = e.target, id = t.dataset && t.dataset.id;
    if (!id) { startMarquee(e); return; }
    const f = frameById(D, id);
    if (t.dataset.handle) return startResize(e, f, t.dataset.handle.split(',').map(Number));
    const unit = expandGroups(D, [id]);                     // a group member brings its group
    if (e.shiftKey) { sel = sel.includes(id) ? sel.filter((x) => !unit.includes(x)) : sel.concat(unit.filter((x) => !sel.includes(x))); render(); return; }
    if (!sel.includes(id)) { sel = [id, ...unit.filter((x) => x !== id)]; render(); }
    if (sel.some((x) => frameById(D, x).locked)) { if (f.locked) say('locked — unlock it to move it'); return; }
    startMove(e);
  });
  overlay.addEventListener('dblclick', (e) => { const id = e.target.dataset && e.target.dataset.id; if (id && frameById(D, id).kind === 'text' && api._focusText) api._focusText(); });
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
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = D.frames.map((f) => f.id); render(); return; }
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
    if (dir && sel.length) { e.preventDefault(); commit(() => { for (const id of sel) { const f = frameById(D, id); if (!f.locked) { f.box[0] += dir[0] * step; f.box[1] += dir[1] * step; } } }); }
  });

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
