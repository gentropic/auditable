// @gcu/condenser view — the built-in chrome that is DRAWN (so it is in snapshots): the
// legends, the scale bar, the north arrow, the exaggeration notice, the hole labels; and
// the cursor readout, which is DOM. Each is a chrome plugin (see chrome.js) built only on
// the plugin api, so a host's own plugins can do anything these do.

import { LinearScale } from '../../../plot/src/scale.js';   // one tick engine for the stack

const meas = (() => { let g = null; return () => g || (g = document.createElement('canvas').getContext('2d')); })();
const fontOf = (th, k = 1, bold = false) => `${bold ? '600 ' : ''}${Math.round(th.font_size * k)}px ${th.mono}`;
const textW = (font, s) => { const g = meas(); g.font = font; return g.measureText(s).width; };

function halo(g, th, text, x, y) {
  g.strokeStyle = th.halo; g.lineWidth = 3; g.lineJoin = 'round';
  g.strokeText(text, x, y);
  g.fillText(text, x, y);
}

function panel(g, th, x, y, w, h) {
  const r = 4;
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  g.fillStyle = th.panel; g.fill();
  g.strokeStyle = th.panel_border; g.lineWidth = 1; g.stroke();
}

// a number for a tick: as many decimals as the step needs
const tickFmt = (v, step) => {
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1);
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step || 1) + 1e-9)));
  return v.toFixed(d);
};
export const coordFmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 ? v.toFixed(1) : String(Math.round(v * 100) / 100)) : '—');

// ── the scale bar: a round length at the camera target's depth, in real metres ──
export function scaleBar() {
  let s = null;
  const compute = (api) => {
    const t = api.target, a = api.project(t[0], t[1], t[2]);
    if (!a) return null;
    const p1 = api.unproject(a[0], a[1]), p2 = api.unproject(a[0] + 100, a[1]);
    if (!p1 || !p2) return null;
    const m100 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);   // unproject gives real z
    if (!(m100 > 1e-9) || !Number.isFinite(m100)) return null;
    const pxPerM = 100 / m100;
    let len = Math.pow(10, Math.floor(Math.log10(120 / pxPerM)));
    for (const k of [5, 2, 1]) if (len * k * pxPerM <= 160) { len *= k; break; }
    return { px: len * pxPerM, label: len >= 1000 ? `${len / 1000} km` : `${len} m`, m100 };
  };
  return {
    id: 'scalebar', slot: 'bottom', order: 0,
    measure(api) { s = compute(api); return s ? { w: s.px + 8, h: 24 } : null; },
    draw(g, api, box) {
      if (!s) return;
      const th = api.theme, x0 = (box.w - s.px) / 2, y = box.h - 6;
      for (const [col, lw] of [[th.halo, 4], [th.foreground, 1.6]]) {
        g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt';
        g.beginPath();
        g.moveTo(x0, y); g.lineTo(x0 + s.px, y);
        g.moveTo(x0, y - 4); g.lineTo(x0, y + 4);
        g.moveTo(x0 + s.px, y - 4); g.lineTo(x0 + s.px, y + 4);
        g.stroke();
      }
      g.font = fontOf(th, 0.95); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = th.foreground;
      halo(g, th, s.label, box.w / 2, y - 6);
    },
  };
}

// ── vertical exaggeration: the scale bar is horizontal, so say when z is stretched ──
export function exaggeration() {
  let text = '';
  return {
    id: 'exaggeration', slot: 'bottom', order: 1,
    measure(api) {
      const z = api.zExag;
      text = z && Math.abs(z - 1) > 1e-6 ? `vertical exaggeration ×${Math.round(z * 100) / 100}` : '';
      return text ? { w: textW(fontOf(api.theme, 0.95), text) + 8, h: 14 } : null;
    },
    draw(g, api, box) {
      const th = api.theme;
      g.font = fontOf(th, 0.95); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = th.accent;
      halo(g, th, text, box.w / 2, box.h / 2);
    },
  };
}

// ── the north arrow: world +N projected at the target; fades when you look along north ──
export function northArrow() {
  let ang = 0, alpha = 0;
  return {
    id: 'north', slot: 'top-right', order: 0,
    measure(api) {
      const t = api.target, a = api.project(t[0], t[1], t[2]);
      const s = a && api.unproject(a[0] + 60, a[1]), p0 = a && api.unproject(a[0], a[1]);
      if (!a || !s || !p0) return null;
      const step = Math.hypot(s[0] - p0[0], s[1] - p0[1], s[2] - p0[2]) || 1;
      const b = api.project(t[0], t[1] + step, t[2]);
      if (!b) return null;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      alpha = Math.max(0, Math.min(1, Math.hypot(dx, dy) / 24));
      ang = Math.atan2(dy, dx);
      return alpha > 0.05 ? { w: 40, h: 40 } : null;
    },
    draw(g, api, box) {
      const th = api.theme, cx = box.w / 2, cy = box.h / 2;
      g.globalAlpha = alpha;
      g.save();
      g.translate(cx, cy); g.rotate(ang);
      g.beginPath();
      g.moveTo(10, 0); g.lineTo(-7, 5); g.lineTo(-4, 0); g.lineTo(-7, -5); g.closePath();
      g.fillStyle = th.foreground; g.strokeStyle = th.halo; g.lineWidth = 2;
      g.stroke(); g.fill();
      g.restore();
      g.font = fontOf(th, 1, true); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = th.foreground;
      halo(g, th, 'N', cx + Math.cos(ang) * 15, cy + Math.sin(ang) * 15);
      g.globalAlpha = 1;
    },
  };
}

// ── hole labels (labels: true on a drillhole layer): the BHID at each collar ──
export function holeLabels() {
  return {
    id: 'labels', slot: 'overlay',
    draw(g, api, box) {
      const th = api.theme;
      g.font = fontOf(th, 0.92); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = th.foreground;
      for (const L of api.layers()) {
        if (L.kind !== 'drillholes' || !L.labels || !L.visible || !L.collars) continue;
        let n = 0;
        for (const c of L.collars) {
          if (n >= 400) break;                                 // a 10k-hole campaign is a texture, not labels
          const p = api.project(c.x, c.y, c.z);
          if (!p || p[0] < -20 || p[0] > box.w + 20 || p[1] < -10 || p[1] > box.h + 10) continue;
          halo(g, th, c.name, p[0], p[1] - 4);
          g.fillRect(p[0] - 1, p[1] - 2, 2, 2);                // the collar tick
          n++;
        }
      }
    },
  };
}

// ── the legends: one per coloured layer, stacked; drawn, so they are in snapshots ──
const PAD = 7, BAR_W = 150, BAR_H = 9, ROW = 15, SW = 10, MAX_ROWS = 12, GAP = 6;
export function legends() {
  let blocks = [], hits = [];
  const layout = (api) => {
    const th = api.theme, fTitle = fontOf(th, 1, true), fRow = fontOf(th, 1), fSmall = fontOf(th, 0.9);
    blocks = [];
    let y = 0, W = 0;
    for (const e of api.legend()) {
      const title = e.channel && e.channel !== e.title ? `${e.title} · ${e.channel}` : e.title;
      const units = e.units ? ` (${e.units})` : '';
      let w = textW(fTitle, title) + textW(fSmall, units), h;
      if (e.kind === 'ramp') { w = Math.max(w, BAR_W); h = 14 + BAR_H + 3 + 13; }
      else {
        const shown = e.classes.slice(0, MAX_ROWS);
        const cw = e.classes.some((c) => c.count != null) ? Math.max(...shown.map((c) => textW(fSmall, String(c.count ?? '')))) + 10 : 0;
        for (const c of shown) w = Math.max(w, SW + 6 + textW(fRow, c.label) + cw);
        h = 14 + shown.length * ROW + (e.classes.length > MAX_ROWS ? ROW : 0);
        e._cw = cw;
      }
      w = Math.ceil(w + 2 * PAD); h = Math.ceil(h + 2 * PAD);
      blocks.push({ e, title, units, y, w, h });
      y += h + GAP; W = Math.max(W, w);
    }
    for (const b of blocks) b.x = W - b.w;                 // right-aligned in the slot
    return blocks.length ? { w: W, h: y - GAP } : null;
  };
  return {
    id: 'legend', slot: 'bottom-right', order: 0,
    measure: layout,
    draw(g, api) {
      const th = api.theme;
      hits = [];
      for (const b of blocks) {
        const { e } = b, x = b.x + PAD;
        let y = b.y + PAD;
        panel(g, th, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        g.textBaseline = 'top'; g.textAlign = 'left';
        g.font = fontOf(th, 1, true); g.fillStyle = th.foreground;
        g.fillText(b.title, x, y);
        if (b.units) { const tw = g.measureText(b.title).width; g.font = fontOf(th, 0.9); g.fillStyle = th.muted; g.fillText(b.units, x + tw, y + 1); }
        y += 14;
        if (e.kind === 'ramp') drawRamp(g, th, e, x, y, b.w - 2 * PAD);
        else {
          const shown = e.classes.slice(0, MAX_ROWS);
          for (const c of shown) {
            const ry = y + 2;
            g.fillStyle = `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`;
            if (!c.hidden) g.fillRect(x, ry, SW, SW);
            g.strokeStyle = th.frame; g.lineWidth = 1; g.strokeRect(x + 0.5, ry + 0.5, SW - 1, SW - 1);
            g.font = fontOf(th, 1); g.fillStyle = c.hidden ? th.muted : th.foreground; g.textBaseline = 'top';
            g.fillText(c.label, x + SW + 6, ry - 1);
            if (c.hidden) { const tw = g.measureText(c.label).width; g.fillRect(x + SW + 6, ry + 5, tw, 1); }
            if (c.count != null) { g.font = fontOf(th, 0.9); g.fillStyle = th.muted; g.textAlign = 'right'; g.fillText(String(c.count), b.x + b.w - PAD, ry); g.textAlign = 'left'; }
            hits.push({ x: b.x, y, w: b.w, h: ROW, layer: e.layer, label: c.label });
            y += ROW;
          }
          if (e.classes.length > MAX_ROWS) {
            g.font = fontOf(th, 0.9); g.fillStyle = th.muted;
            g.fillText(`and ${e.classes.length - MAX_ROWS} more`, x, y + 1);
          }
        }
      }
    },
    describe() {
      return blocks.map(({ e, title, units }) => (e.kind === 'ramp'
        ? `${title}${units}: ${coordFmt(e.range[0])} to ${coordFmt(e.range[1])}${e.threshold ? `, threshold ${coordFmt(e.threshold[0])} to ${coordFmt(e.threshold[1])}` : ''}`
        : `${title}${units}: ${e.classes.map((c) => `${c.label}${c.hidden ? ' (hidden)' : ''}${c.count != null ? ` ${c.count}` : ''}`).join(', ')}`)).join('; ');
    },
    cursor(x, y) { return hits.some((h) => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) ? 'pointer' : ''; },
    click(x, y, ev, api) {
      const h = hits.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      if (!h) return;
      if (ev.shiftKey) api.isolateClass(h.layer, h.label); else api.toggleClass(h.layer, h.label);
    },
  };
}

// a ramp over the data range: colours clamp at the clip, the threshold dims what it cuts
function drawRamp(g, th, e, x0, y0, W) {
  let [lo, hi] = e.range;
  if (!(hi > lo)) hi = lo + 1;
  const [c0, c1] = e.clip || e.range;
  const span = (c1 - c0) || 1, px = e.pixels;
  for (let i = 0; i < W; i++) {
    const v = lo + ((i + 0.5) / W) * (hi - lo);
    const k = Math.round(Math.max(0, Math.min(1, (v - c0) / span)) * 255) * 4;
    g.fillStyle = `rgb(${px[k]},${px[k + 1]},${px[k + 2]})`;
    g.fillRect(x0 + i, y0, 1, BAR_H);
  }
  const at = (v) => x0 + ((v - lo) / (hi - lo)) * W;
  if (e.threshold) {                                       // dim what the threshold cuts, bracket what it keeps
    const a = Math.max(x0, Math.min(x0 + W, at(e.threshold[0]))), b = Math.max(x0, Math.min(x0 + W, at(e.threshold[1])));
    g.fillStyle = th.panel; g.globalAlpha = e.dim ? 0.55 : 0.85;
    g.fillRect(x0, y0, a - x0, BAR_H); g.fillRect(b, y0, x0 + W - b, BAR_H);
    g.globalAlpha = 1;
    g.strokeStyle = th.foreground; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a + 2, y0 - 2); g.lineTo(a, y0 - 2); g.lineTo(a, y0 + BAR_H + 2); g.lineTo(a + 2, y0 + BAR_H + 2);
    g.moveTo(b - 2, y0 - 2); g.lineTo(b, y0 - 2); g.lineTo(b, y0 + BAR_H + 2); g.lineTo(b - 2, y0 + BAR_H + 2);
    g.stroke();
  }
  g.strokeStyle = th.frame; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, BAR_H - 1);
  if (e.clip) {                                            // the clip ends: small marks above the bar
    g.fillStyle = th.muted;
    for (const v of e.clip) {
      if (v <= lo || v >= hi) continue;
      const cx = at(v);
      g.beginPath(); g.moveTo(cx - 3, y0 - 4); g.lineTo(cx + 3, y0 - 4); g.lineTo(cx, y0); g.closePath(); g.fill();
    }
  }
  const sc = new LinearScale([lo, hi], [x0, x0 + W]);
  const ticks = sc.ticks(5), step = ticks.length > 1 ? ticks[1] - ticks[0] : hi - lo;
  g.font = fontOf(th, 0.9); g.fillStyle = th.muted; g.textBaseline = 'top';
  let right = -Infinity;
  for (const v of ticks) {
    const tx = sc.transform(v), label = tickFmt(v, step), tw = g.measureText(label).width;
    let lx = Math.max(x0, Math.min(x0 + W - tw, tx - tw / 2));
    if (lx < right + 4) continue;                          // no overlapping labels
    g.fillRect(Math.round(tx) - 0.5, y0 + BAR_H, 1, 3);
    g.textAlign = 'left';
    g.fillText(label, lx, y0 + BAR_H + 4);
    right = lx + tw;
  }
}

// ── the cursor readout: E/N/RL under the cursor in a locked view; the picked element's
// coordinates in free 3D. DOM — a readout is for looking, not for the figure ──
export function readout() {
  let el = null, at = null, lastPick = null;
  const show = (api) => {
    if (!el) return;
    const v = api.viewInfo();
    let txt = '';
    if (v.rect && at) {
      const { rect, axes } = v, w = v.px.w || 1, h = v.px.h || 1;
      const u = rect.u0 + (at[0] / w) * (rect.u1 - rect.u0), vv = rect.v1 - (at[1] / h) * (rect.v1 - rect.v0);
      txt = `${axes[0]} ${coordFmt(u)}   ${axes[1]} ${coordFmt(vv)}`;
    } else if (!v.rect && lastPick) {
      txt = `E ${coordFmt(lastPick.x)}   N ${coordFmt(lastPick.y)}   RL ${coordFmt(lastPick.z)}`;
    }
    el.textContent = txt;
    el.style.display = txt ? '' : 'none';
  };
  let onMove = null, onLeave = null, cv = null;
  return {
    id: 'readout', slot: 'bottom-left', order: 20,
    mount(host, api) {
      el = document.createElement('div');
      el.className = 'cdread';
      el.style.display = 'none';
      host.appendChild(el);
      cv = api.canvas;
      onMove = (e) => { const r = cv.getBoundingClientRect(); at = [e.clientX - r.left, e.clientY - r.top]; show(api); };
      onLeave = () => { at = null; show(api); };
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerleave', onLeave);
    },
    update(changed, api) {
      if ('pick' in changed) lastPick = changed.pick;
      if ('view' in changed || 'pick' in changed) show(api);
    },
    unmount() { if (cv) { cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); } el = null; },
  };
}
