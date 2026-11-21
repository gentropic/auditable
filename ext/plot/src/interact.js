// @gcu/plot/interact — interaction for a figure on a page (spec §9). Opt-in: the core never
// touches the DOM's events; this module does, and only when called.
//
//   const ui = interact(fig, canvas?, {readout, crosshair, units, format, extra, brush,
//                                      onBrush, onClick, onViewChange, radius, label})
//   document.body.append(ui.element)              // the canvas, wrapped with its overlay
//   ui.on('brush' | 'click' | 'view' | 'hover', fn) · ui.off(…) · ui.reset() · ui.redraw()
//   ui.setSelection({axes, x: [lo, hi], y: [lo, hi]} | null) · ui.destroy()
//   link([ax1, ax2, …], {x: true, y: false})       // linked views, across figures too
//
// - Hover: a readout, crosshair and highlight ring, drawn on an OVERLAY canvas — a pointer
//   move never redraws the figure. The readout names the picked trace and its values
//   (format(pick) replaces the lines, extra(trace, index) adds some); with nothing picked it
//   shows the coordinates under the pointer (with units: a plan view's readout).
// - Wheel zooms about the cursor (shift: x only, alt: y only; never one axis alone at equal
//   aspect, which would break it); drag pans; double-click resets. Everything is done in pixel
//   space through the axes' own scales, so log and inverted axes zoom and pan correctly.
// - Shift-drag brushes (or plain drag, with {brush: 'x' | 'y' | 'xy'}): onBrush({axes,
//   x: [lo, hi] | null, y: [lo, hi] | null}); a click clears it.
// - Keyboard: the canvas is focusable with an aria-label; arrows pan, + and − zoom, 0 resets,
//   Esc clears the selection. Touch: pointer events, two fingers pinch-zoom and pan.
// - The figure's limits are plain set_xlim / set_ylim, so a shared axis (subplots(sharex))
//   moves with it; link() goes across figures. ax.set_view() from a host redraws the figure
//   and fires no onViewChange (it came from outside), so two views can follow each other
//   without echoing.

const _figs = new WeakMap();           // figure → its controller (link redraws through it)

export function interact(fig, canvas, opts) {
  if (canvas && !(typeof canvas.getContext === 'function') && typeof canvas === 'object' && opts === undefined) { opts = canvas; canvas = null; }
  if (!fig || !Array.isArray(fig.axes)) throw new TypeError('interact: expected a Figure (subplots()[0])');
  if (typeof document === 'undefined') throw new Error('interact: needs a DOM; with none, use ax.pick / toData / toPixel directly');
  const o = opts || {};
  if (_figs.has(fig)) _figs.get(fig).destroy();
  canvas = canvas || fig.show();
  const th = fig._theme;
  const listeners = { brush: [], click: [], view: [], hover: [] };
  if (o.onBrush) listeners.brush.push(o.onBrush);
  if (o.onClick) listeners.click.push(o.onClick);
  if (o.onViewChange) listeners.view.push(o.onViewChange);
  if (o.onHover) listeners.hover.push(o.onHover);
  const emit = (ev, arg) => { for (const fn of listeners[ev]) { try { fn(arg); } catch (e) { console.error(e); } } };

  // ── the wrapper and the overlay ──
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;line-height:0;';
  if (canvas.parentNode) canvas.parentNode.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  const over = document.createElement('canvas');
  over.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  wrap.appendChild(over);
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.style.outline = 'none';
  const label = o.label || [fig._suptitle && fig._suptitle.text, ...fig.axes.map((a) => a._title && a._title.text)].filter(Boolean).join('; ') || 'chart';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label} — interactive: drag to pan, wheel or + and − to zoom, arrows to pan, 0 to reset`);

  const dprOf = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const sizeTo = () => {
    const dpr = dprOf();
    for (const c of [canvas, over]) {
      const w = Math.round(fig.width * dpr), h = Math.round(fig.height * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      c.style.width = fig.width + 'px'; c.style.height = fig.height + 'px';
    }
  };

  // ── drawing ──
  let frame = 0, pendingView = null, hover = null, sel = null, drag = null;
  const draw = () => {
    frame = 0;
    sizeTo();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fig.draw(ctx, { dpr: dprOf() });
    if (pendingView) { const axs = pendingView; pendingView = null; for (const ax of axs) emit('view', { axes: ax, xlim: ax.get_xlim(), ylim: ax.get_ylim() }); }
    // the pointer's pick belongs to the old view; look again
    if (hover) hover = hoverAt(hover.px, hover.py);
    drawOverlay();
  };
  const request = () => { if (!frame) frame = requestAnimationFrame(draw); };
  fig._requestDraw = request;

  const ox = () => over.getContext('2d');
  function drawOverlay() {
    const dpr = dprOf(), g = ox();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, over.width, over.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sel && sel.axes.view) drawBrush(g, sel.axes, sel.x, sel.y, false);
    if (drag && drag.mode === 'brush') drawBrush(g, drag.ax, ...drag.range(), true);
    if (hover && !drag) drawHover(g, hover);
  }
  function drawBrush(g, ax, xr, yr, live) {
    const v = ax.view;
    const xs = xr ? xr.map((d) => v.xScale.transform(d)) : [v.x, v.x + v.w];
    const ys = yr ? yr.map((d) => v.yScale.transform(d)) : [v.y, v.y + v.h];
    const x0 = Math.max(v.x, Math.min(...xs)), x1 = Math.min(v.x + v.w, Math.max(...xs));
    const y0 = Math.max(v.y, Math.min(...ys)), y1 = Math.min(v.y + v.h, Math.max(...ys));
    g.save();
    g.fillStyle = th.selection || th.accent;
    g.globalAlpha = live ? 0.18 : 0.12;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.globalAlpha = 1;
    g.strokeStyle = th.selection || th.accent;
    g.lineWidth = 1;
    g.setLineDash(live ? [4, 3] : []);
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    g.restore();
  }
  const fontOf = (d = -1) => `${(th.font_size || 11) + d}px ${th.mono || th.font || 'monospace'}`;
  function drawHover(g, h) {
    const ax = h.ax, v = ax.view;
    g.save();
    if (o.crosshair !== false) {
      g.strokeStyle = th.muted || th.foreground;
      g.globalAlpha = 0.6;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(Math.round(h.px) + 0.5, v.y); g.lineTo(Math.round(h.px) + 0.5, v.y + v.h);
      g.moveTo(v.x, Math.round(h.py) + 0.5); g.lineTo(v.x + v.w, Math.round(h.py) + 0.5);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    if (h.pick && h.pick.kind !== 'polygon' && h.pick.x != null) {
      const [qx, qy] = h.pick.axes.toPixel(h.pick.x, h.pick.y);
      if (qx - qx === 0 && qy - qy === 0) {
        g.strokeStyle = th.halo; g.lineWidth = 4;
        g.beginPath(); g.arc(qx, qy, 6, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = th.accent; g.lineWidth = 2;
        g.beginPath(); g.arc(qx, qy, 6, 0, 2 * Math.PI); g.stroke();
      }
    }
    if (o.readout !== false && h.lines.length) {
      g.font = fontOf(-1);
      const lh = (th.font_size || 11) + 3, pad = 6;
      const w = Math.max(...h.lines.map((s) => g.measureText(s).width)) + 2 * pad, hh = h.lines.length * lh + 2 * pad - 3;
      let bx = h.px + 14, by = h.py + 14;
      if (bx + w > fig.width - 2) bx = h.px - 14 - w;
      if (by + hh > fig.height - 2) by = h.py - 14 - hh;
      bx = Math.max(2, bx); by = Math.max(2, by);
      g.fillStyle = th.panel || th.background;
      g.globalAlpha = 0.94;
      g.fillRect(bx, by, w, hh);
      g.globalAlpha = 1;
      g.strokeStyle = th.panel_border || th.frame;
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, w - 1, hh - 1);
      g.fillStyle = th.foreground;
      g.textBaseline = 'top';
      h.lines.forEach((s, i) => g.fillText(s, bx + pad, by + pad + i * lh));
    }
    g.restore();
  }

  // ── the readout's numbers: as many decimals as one pixel resolves ──
  const unitOf = (axis) => (o.units == null ? '' : typeof o.units === 'string' ? o.units : o.units[axis] || '');
  const nameOf = (ax, axis) => { const l = axis === 'x' ? ax._xlabel : ax._ylabel; const t = l && String(l.text); return t && t.length <= 14 ? t : axis; };
  function fmtAxis(ax, axis, val) {
    if (val == null || val !== val) return '—';
    if (typeof val === 'string') return val;
    const cats = axis === 'x' ? ax._xcats : ax._ycats;
    if (cats && Number.isInteger(val) && cats.list[val] != null) return cats.list[val];
    const v = ax.view, s = axis === 'x' ? v.xScale : v.yScale;
    // a date axis: the date, to what one pixel resolves (UTC, as its ticks)
    if (axis === 'x' ? ax._xdate : ax._ydate) {
      const per = Math.abs(s.domain[1] - s.domain[0]) / (axis === 'x' ? v.w : v.h);
      const iso = new Date(val).toISOString();
      return per >= 864e5 ? iso.slice(0, 10) : per >= 6e4 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : per >= 1e3 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(11, 23);
    }
    let str;
    if (s.log) str = Number(val).toPrecision(4);
    else {
      const per = Math.abs(s.domain[1] - s.domain[0]) / (axis === 'x' ? v.w : v.h);
      const dec = Math.max(0, Math.min(8, Math.ceil(-Math.log10(per))));
      str = Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    const u = unitOf(axis);
    return u ? `${str} ${u}` : str;
  }
  const fmtNum = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toPrecision(4) : String(+v.toPrecision(5)));
  function linesOf(ax, pick, xd, yd) {
    if (pick && o.format) { const r = o.format(pick); return r == null ? [] : Array.isArray(r) ? r.map(String) : String(r).split('\n'); }
    const out = [];
    if (pick) {
      if (pick.label) out.push(String(pick.label));
      if (pick.kind === 'polygon') {
        const p = pick.properties || {};
        for (const k of Object.keys(p).slice(0, 6)) out.push(`${k}: ${fmtNum(p[k])}`);
        out.push(`${nameOf(ax, 'x')} = ${fmtAxis(ax, 'x', xd)}`, `${nameOf(ax, 'y')} = ${fmtAxis(ax, 'y', yd)}`);
      } else {
        out.push(`${nameOf(pick.axes, 'x')} = ${fmtAxis(pick.axes, 'x', pick.x)}`, `${nameOf(pick.axes, 'y')} = ${fmtAxis(pick.axes, 'y', pick.y)}`);
        if (pick.value != null) out.push(`value = ${fmtNum(pick.value)}`);
        else if (typeof pick.c === 'number') out.push(`c = ${fmtNum(pick.c)}`);
        if (pick.kind === 'bin' && pick.edges) out.push(`bin = [${fmtNum(pick.edges[0])}, ${fmtNum(pick.edges[1])})`);
      }
      if (o.extra) { const e = o.extra(pick.trace, pick.index, pick); if (e != null) out.push(...(Array.isArray(e) ? e : String(e).split('\n')).map(String)); }
    } else if (o.coordinates !== false) {
      out.push(`${nameOf(ax, 'x')} = ${fmtAxis(ax, 'x', xd)}`, `${nameOf(ax, 'y')} = ${fmtAxis(ax, 'y', yd)}`);
    }
    return out;
  }
  function hoverAt(px, py) {
    const ax = fig.axesAt(px, py);
    if (!ax) return null;
    const pick = ax.pick(px, py, { radius: o.radius != null ? o.radius : 8 });
    const [xd, yd] = ax.toData(px, py);
    return { ax, px, py, pick, lines: linesOf(ax, pick, xd, yd) };
  }

  // ── the view: zoom and pan in PIXEL space, through the axes' own scales ──
  // the limits that put pixel x0 at the left edge and x1 at the right (display order: an
  // inverted axis stays inverted, a log axis stays geometric)
  const limsAt = (s, p0, p1) => [s.inverse(p0), s.inverse(p1)];
  const changed = new Set();
  function setLims(ax, xl, yl) {
    if (xl && xl.every((v) => v - v === 0)) ax.set_xlim(xl[0], xl[1]);
    if (yl && yl.every((v) => v - v === 0)) ax.set_ylim(yl[0], yl[1]);
    changed.add(ax);
    // linked views, in other figures too (their own redraw); the link says which axes follow
    for (const l of ax._links || []) for (const b of l.axes) {
      if (b === ax) continue;
      if (l.x && xl) b.set_xlim(xl[0], xl[1]);
      if (l.y && yl) b.set_ylim(yl[0], yl[1]);
      const c = b.figure && _figs.get(b.figure);
      if (c && b.figure !== fig) c._viewFromLink(b); else changed.add(b);
    }
  }
  function commitView() {
    pendingView = [...changed];
    changed.clear();
    request();
  }
  const equalAspect = (ax) => ax._aspect === 'equal';
  function zoomAt(ax, cx, cy, f, lockAxis) {
    const v = ax.view;
    const only = equalAspect(ax) ? null : lockAxis;
    const xl = only === 'y' ? null : limsAt(v.xScale, cx + (v.x - cx) * f, cx + (v.x + v.w - cx) * f);
    const yl = only === 'x' ? null : limsAt(v.yScale, cy + (v.y + v.h - cy) * f, cy + (v.y - cy) * f);
    setLims(ax, xl, yl);
  }
  function panBy(ax, view, dx, dy) {
    const v = view;
    setLims(ax, limsAt(v.xScale, v.x - dx, v.x + v.w - dx), limsAt(v.yScale, v.y + v.h - dy, v.y - dy));
  }
  function reset() {
    for (const [ax, h] of home) setLims(ax, h.x, h.y);
    commitView();
  }

  // ── pointer events ──
  const pointers = new Map();
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) * fig.width) / r.width, ((e.clientY - r.top) * fig.height) / r.height]; };
  const snapView = (ax) => ({ ...ax.view, xScale: ax.view.xScale, yScale: ax.view.yScale });
  function onDown(e) {
    canvas.focus({ preventScroll: true });
    const [px, py] = local(e);
    pointers.set(e.pointerId, { px, py });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (pointers.size === 2) {
      // a pinch: from the two fingers' midpoint and distance
      const [a, b] = [...pointers.values()];
      const ax = fig.axesAt((a.px + b.px) / 2, (a.py + b.py) / 2) || (drag && drag.ax);
      if (!ax) return;
      drag = { mode: 'pinch', ax, view: snapView(ax), mid: [(a.px + b.px) / 2, (a.py + b.py) / 2], dist: Math.hypot(a.px - b.px, a.py - b.py) || 1 };
      return;
    }
    const ax = fig.axesAt(px, py);
    if (!ax || (e.button != null && e.button > 1)) return;
    const brushMode = o.brush ? (e.shiftKey ? null : o.brush) : e.shiftKey ? 'xy' : null;
    const mode = e.button === 1 ? 'pan' : brushMode ? 'brush' : 'pan';
    drag = {
      mode, ax, view: snapView(ax), x0: px, y0: py, x1: px, y1: py, moved: false, brush: brushMode,
      range() {
        const v = this.view, b = this.brush;
        const xr = b === 'y' ? null : [v.xScale.inverse(this.x0), v.xScale.inverse(this.x1)].sort((p, q) => p - q);
        const yr = b === 'x' ? null : [v.yScale.inverse(this.y0), v.yScale.inverse(this.y1)].sort((p, q) => p - q);
        return [xr, yr];
      },
    };
  }
  function onMove(e) {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { px, py });
    if (drag && drag.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = [(a.px + b.px) / 2, (a.py + b.py) / 2], dist = Math.hypot(a.px - b.px, a.py - b.py) || 1;
      const f = drag.dist / dist, v = drag.view;
      // scale about the starting midpoint, then follow the midpoint's travel
      const cx = drag.mid[0], cy = drag.mid[1], dx = mid[0] - cx, dy = mid[1] - cy;
      const xl = limsAt(v.xScale, cx + (v.x - cx) * f - dx * f, cx + (v.x + v.w - cx) * f - dx * f);
      const yl = limsAt(v.yScale, cy + (v.y + v.h - cy) * f - dy * f, cy + (v.y - cy) * f - dy * f);
      setLims(drag.ax, xl, yl);
      commitView();
      return;
    }
    if (drag) {
      drag.x1 = px; drag.y1 = py;
      if (Math.abs(px - drag.x0) + Math.abs(py - drag.y0) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.mode === 'pan') { panBy(drag.ax, drag.view, px - drag.x0, py - drag.y0); commitView(); }
      else drawOverlay();
      return;
    }
    hover = hoverAt(px, py);
    drawOverlay();
    if (hover) emit('hover', hover.pick);
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const d = drag;
    if (d.mode === 'pinch') { if (pointers.size === 0) drag = null; return; }
    drag = null;
    if (!d.moved) {
      // a click: clears a brush, and reports what's under it
      if (sel) setSelection(null);
      const pick = d.ax.pick(d.x0, d.y0, { radius: o.radius != null ? o.radius : 8 });
      emit('click', pick ? { ...pick } : { axes: d.ax, pick: null, x: d.ax.toData(d.x0, d.y0)[0], y: d.ax.toData(d.x0, d.y0)[1] });
    } else if (d.mode === 'brush') {
      const [x, y] = d.range();
      setSelection({ axes: d.ax, x, y });
    }
    drawOverlay();
  }
  function onLeave() { if (!drag) { hover = null; drawOverlay(); } }
  function onWheel(e) {
    const [px, py] = local(e);
    const ax = fig.axesAt(px, py);
    if (!ax) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0015)));
    zoomAt(ax, px, py, f, e.shiftKey ? 'x' : e.altKey ? 'y' : null);
    commitView();
  }
  function onDbl(e) { e.preventDefault(); reset(); }
  function onKey(e) {
    const ax = (hover && hover.ax) || (sel && sel.axes) || fig.axes[0];
    if (!ax || !ax.view) return;
    const v = ax.view, cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const step = 0.1;
    let done = true;
    switch (e.key) {
      case 'ArrowLeft': panBy(ax, v, v.w * step, 0); break;
      case 'ArrowRight': panBy(ax, v, -v.w * step, 0); break;
      case 'ArrowUp': panBy(ax, v, 0, v.h * step); break;
      case 'ArrowDown': panBy(ax, v, 0, -v.h * step); break;
      case '+': case '=': zoomAt(ax, cx, cy, 0.8, null); break;
      case '-': case '_': zoomAt(ax, cx, cy, 1.25, null); break;
      case '0': case 'Home': reset(); return e.preventDefault();
      case 'Escape': if (sel) setSelection(null); else done = false; break;
      default: done = false;
    }
    if (!done) return;
    e.preventDefault();
    if (e.key !== 'Escape') commitView();
  }

  function setSelection(s) {
    sel = s && s.axes ? { axes: s.axes, x: s.x || null, y: s.y || null } : null;
    drawOverlay();
    emit('brush', sel ? { ...sel } : null);
  }

  // the first draw, then the home limits (ax.view exists from then on)
  draw();
  const home = new Map(fig.axes.map((ax) => [ax, { x: ax.get_xlim(), y: ax.get_ylim() }]));

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('keydown', onKey);

  const ctl = {
    element: wrap, canvas, overlay: over, figure: fig,
    on(ev, fn) { if (!listeners[ev]) throw new Error(`interact: no event '${ev}'; use brush, click, view or hover`); listeners[ev].push(fn); return ctl; },
    off(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } return ctl; },
    reset, setSelection, redraw: request,
    get selection() { return sel ? { ...sel } : null; },
    // a linked axes in this figure moved: redraw here, and say so
    _viewFromLink(ax) { changed.add(ax); commitView(); },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('keydown', onKey);
      if (frame) cancelAnimationFrame(frame);
      if (fig._requestDraw === request) delete fig._requestDraw;
      over.remove();
      if (wrap.parentNode) wrap.parentNode.replaceChild(canvas, wrap);
      _figs.delete(fig);
    },
  };
  _figs.set(fig, ctl);
  return ctl;
}

// link([ax1, ax2, …], {x = true, y = true}) — these axes share their view: zooming or panning
// one moves the others, in other figures too. Returns an unlink function.
export function link(axes, opts) {
  const o = opts || {};
  const l = { axes: Array.from(axes), x: o.x !== false, y: o.y !== false };
  if (!l.x && !l.y) throw new Error('link: link x, y or both');
  for (const ax of l.axes) (ax._links || (ax._links = [])).push(l);
  return () => { for (const ax of l.axes) if (ax._links) ax._links = ax._links.filter((k) => k !== l); };
}
