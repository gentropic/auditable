// @gcu/condenser view — coordinates in the picture: axes around a locked 2D view, an
// orientation triad, and axes on the bounding box of a free 3D view. Chrome plugins (see
// chrome.js) on the plugin api, like the other built-ins; all three are DRAWN, so they are in
// snapshots.
//
// - axes (locked orthographic views: plan, sections, any locked direction): a real
//   @gcu/plot figure laid over the canvas in its "axes as chrome" mode — no face, the limits
//   set from the view rectangle, so the frame, ticks and labels are plot's own (one tick
//   engine for the stack, the same theme). Its margins become a frame band, and the chrome
//   slots move inside it. The plot Axes is the host's too (v.axes): collars, a licence
//   polygon, contours drawn in world coordinates over a plan or section.
// - triad: E, N and Z as the camera sees them; a click on one shows the view from that side,
//   on the centre the three-quarter view.
// - box: in free 3D, ticks and labels along three edges of the data's bounding box, chosen on
//   the box's outline toward the viewer, so a 3D snapshot carries its coordinates.

import { Figure } from '../../../plot/src/figure.js';
import { _niceTicks, _fmtStep } from '../../../plot/src/nice.js';

const fontOf = (th, k = 1, bold = false) => `${bold ? '600 ' : ''}${Math.round(th.font_size * k)}px ${th.mono}`;
function halo(g, th, text, x, y) {
  g.strokeStyle = th.halo; g.lineWidth = 3; g.lineJoin = 'round';
  g.strokeText(text, x, y);
  g.fillText(text, x, y);
}

// ── axes around a locked view ──
// One figure per view, made on first use (so v.axes works before the view is locked). Each
// frame: if the rectangle, the canvas size or the theme moved, a first pass lays the figure
// out over the whole canvas to find the plot rectangle plot's margins leave; the limits are
// then those of THAT rectangle (the canvas maps linearly to the world in an orthographic view),
// and the margins are frozen so the drawing pass lays out exactly there.
export function planAxes() {
  let fig = null, ax = null, themeOf = null, key = '', rectPx = null;
  const ensure = (api) => {
    if (!fig) {
      fig = new Figure(1, 1, { figsize: [400, 300], theme: api.theme });
      fig.set_facecolor('none');
      ax = fig.axes[0];
      ax.set_facecolor('none');
      themeOf = api.theme;
    }
    if (themeOf !== api.theme) { fig.set_theme(api.theme); themeOf = api.theme; key = ''; }
    return ax;
  };
  const NAMES = { E: 'E', N: 'N', RL: 'RL', along: 'along', u: 'u', v: 'v' };
  return {
    id: 'axes', slot: 'overlay', order: -100,
    axes: ensure,
    draw(g, api, box) {
      const vi = api.viewInfo();
      if (!vi.rect) { rectPx = null; api.setInsets(null); return; }
      ensure(api);
      const W = box.w, H = box.h, r = vi.rect;
      const uAt = (x) => r.u0 + (x / W) * (r.u1 - r.u0);
      const vAt = (y) => r.v1 - (y / H) * (r.v1 - r.v0);
      const [nu, nv] = vi.axes || ['u', 'v'];
      const grid = !!api.get('grid');
      const k = `${W}|${H}|${r.u0}|${r.u1}|${r.v0}|${r.v1}|${nu}|${nv}|${grid}`;
      if (k !== key || !rectPx) {
        fig.width = W; fig.height = H;
        ax.set_xlabel(NAMES[nu] || nu); ax.set_ylabel(NAMES[nv] || nv);
        ax.grid(grid, { alpha: 0.35 });
        // pass 1: lay out over the whole canvas (the recording context measures text the way
        // the drawing will: every font plot uses is monospace, 0.6 em a character)
        ax._margins = null;
        ax.set_view({ xlim: [uAt(0), uAt(W)], ylim: [vAt(H), vAt(0)] });
        fig.toDrawList();
        const R = ax.view;
        // too small to lay out: nothing this frame (and try again on the next)
        if (!R) { rectPx = null; key = ''; api.setInsets(null); return; }
        rectPx = { x: R.x, y: R.y, w: R.w, h: R.h };
        key = k;
        ax._margins = { left: R.x, top: R.y, right: W - R.x - R.w, bottom: H - R.y - R.h };
        ax.set_view({ xlim: [uAt(R.x), uAt(R.x + R.w)], ylim: [vAt(R.y + R.h), vAt(R.y)] });
      }
      const P = rectPx;
      // the frame band: the margins, opaque, so labels read over any scene
      g.save();
      g.fillStyle = api.theme.background;
      g.globalAlpha = 0.92;
      g.beginPath();
      g.rect(0, 0, W, H);
      g.rect(P.x, P.y, P.w, P.h);
      g.fill('evenodd');
      g.restore();
      // the figure, at device resolution (a host's rasterized items stay sharp)
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      fig.draw(g, { dpr });
      g.restore();
      api.setInsets({ top: P.y, left: P.x, right: W - P.x - P.w, bottom: H - P.y - P.h });
    },
    describe(api) {
      const vi = api.viewInfo();
      if (!vi.rect || !ax || !ax.view) return '';
      const [a, b] = ax.get_xlim(), [c, d] = ax.get_ylim(), [nu, nv] = vi.axes || ['u', 'v'];
      return `axes: ${nu} ${Math.round(Math.min(a, b))} to ${Math.round(Math.max(a, b))}, ${nv} ${Math.round(Math.min(c, d))} to ${Math.round(Math.max(c, d))}`;
    },
    unmount() { key = ''; },
  };
}

// ── the triad: world E, N, Z as the camera sees them; a click picks the view from that side ──
export function triad() {
  const S = 64, C = S / 2, L = 22;
  let tips = [];
  // the views from each side, named by where they LOOK: from +E you look west
  const FROM = { E: 'west', N: 'south', Z: 'plan' };
  return {
    id: 'triad', slot: 'bottom-left', order: 5,
    measure() { return { w: S, h: S }; },
    draw(g, api) {
      const th = api.theme, { r, up } = api.basis();
      const cyc = th.cycle || [];
      const axes = [['E', [1, 0, 0], cyc[3] || '#d62728'], ['N', [0, 1, 0], cyc[2] || '#2ca02c'], ['Z', [0, 0, 1], cyc[0] || '#1f77b4']];
      // toward the viewer last: depth along the view direction (r × up)
      const fwd = [r[1] * up[2] - r[2] * up[1], r[2] * up[0] - r[0] * up[2], r[0] * up[1] - r[1] * up[0]];
      tips = axes.map(([name, e, col]) => {
        const sx = e[0] * r[0] + e[1] * r[1] + e[2] * r[2], sy = -(e[0] * up[0] + e[1] * up[1] + e[2] * up[2]);
        const depth = e[0] * fwd[0] + e[1] * fwd[1] + e[2] * fwd[2];
        return { name, col, x: C + sx * L, y: C + sy * L, len: Math.hypot(sx, sy), depth };
      }).sort((a, b) => b.depth - a.depth);
      g.save();
      g.beginPath(); g.arc(C, C, 4, 0, 2 * Math.PI);
      g.fillStyle = th.foreground; g.globalAlpha = 0.6; g.fill(); g.globalAlpha = 1;
      for (const t of tips) {
        g.globalAlpha = t.len < 0.15 ? 0.35 : 1;           // pointing at you: fade the stub
        g.strokeStyle = th.halo; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(C, C); g.lineTo(t.x, t.y); g.stroke();
        g.strokeStyle = t.col; g.lineWidth = 2;
        g.beginPath(); g.moveTo(C, C); g.lineTo(t.x, t.y); g.stroke();
        const lx = C + (t.x - C) * (1 + 9 / Math.max(L * t.len, 1)), ly = C + (t.y - C) * (1 + 9 / Math.max(L * t.len, 1));
        t.lx = t.len < 0.15 ? t.x : lx; t.ly = t.len < 0.15 ? t.y - 8 : ly;
        g.font = fontOf(th, 0.95, true); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = t.col;
        halo(g, th, t.name, t.lx, t.ly);
      }
      g.restore();
    },
    // the centre first (an axis pointing at you has its tip there), then the labels, then the
    // tips of the axes that show some length
    _hit(x, y) {
      if (Math.hypot(x - C, y - C) < 5) return 'centre';
      for (const t of tips) if (Math.hypot(x - t.lx, y - t.ly) < 8) return t.name;
      for (const t of tips) if (t.len >= 0.15 && Math.hypot(x - t.x, y - t.y) < 7) return t.name;
      return Math.hypot(x - C, y - C) < 8 ? 'centre' : null;
    },
    click(x, y, e, api) {
      const h = this._hit(x, y);
      if (h === 'centre') api.look('three-quarter');
      else if (h) api.look(FROM[h]);
    },
    cursor(x, y) { return this._hit(x, y) ? 'pointer' : ''; },
    describe() { return 'orientation: E, N and Z as seen; activate one for the view from that side, the centre for the three-quarter view'; },
  };
}

// ── axes on the bounding box (free 3D) ──
// For each world axis, one of the box's four parallel edges: E and N along the bottom face
// (the top one when you look from below), on the side nearer the bottom of the screen; Z up
// the vertical edge furthest left. Ticks from plot's tick engine, as many as the edge's
// on-screen length holds; labels pushed away from the box's centre.
export function boxAxes() {
  return {
    id: 'box', slot: 'overlay', order: -50,
    draw(g, api) {
      const vi = api.viewInfo();
      if (vi.rect) return;                                   // a locked view has the plot axes
      const bb = api.bbox;
      if (!bb) return;
      const [x0, y0, z0, x1, y1, z1] = bb;
      const P = (x, y, z) => api.project(x, y, z);
      const ctr = P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      if (!ctr) return;
      const below = (vi.camera && vi.camera.plunge < 0);
      const zf = below ? z1 : z0;
      const mid = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null);
      const lowest = (cands) => cands.map((c) => ({ ...c, m: mid(P(...c.a), P(...c.b)) })).filter((c) => c.m).sort((p, q) => q.m[1] - p.m[1])[0];
      const leftmost = (cands) => cands.map((c) => ({ ...c, m: mid(P(...c.a), P(...c.b)) })).filter((c) => c.m).sort((p, q) => p.m[0] - q.m[0])[0];
      const edges = [
        { name: 'E', lo: x0, hi: x1, pick: lowest([{ a: [x0, y0, zf], b: [x1, y0, zf], fix: [y0, zf] }, { a: [x0, y1, zf], b: [x1, y1, zf], fix: [y1, zf] }]), pt: (t, f) => [t, f[0], f[1]] },
        { name: 'N', lo: y0, hi: y1, pick: lowest([{ a: [x0, y0, zf], b: [x0, y1, zf], fix: [x0, zf] }, { a: [x1, y0, zf], b: [x1, y1, zf], fix: [x1, zf] }]), pt: (t, f) => [f[0], t, f[1]] },
        { name: 'RL', lo: z0, hi: z1, pick: leftmost([[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => ({ a: [x, y, z0], b: [x, y, z1], fix: [x, y] }))), pt: (t, f) => [f[0], f[1], t] },
      ];
      const th = api.theme, W = api.size.w, H = api.size.h;
      // the corners where two drawn axes meet: no tick label there (two would overlap)
      const ends = edges.map((e) => (e.pick ? [P(...e.pick.a), P(...e.pick.b)] : [null, null]));
      const shared = (k, p) => ends.some(([a, b], j) => j !== k && [a, b].some((q) => q && Math.hypot(q[0] - p[0], q[1] - p[1]) < 4));
      g.save();
      g.font = fontOf(th, 0.9);
      edges.forEach((e, k) => {
        const c = e.pick;
        if (!c || !(e.hi > e.lo)) return;
        const [A, B] = ends[k];
        if (!A || !B) return;
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (len < 30) return;
        // outward: away from the box's centre, perpendicular to the edge on screen
        let nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
        const m = c.m;
        if ((m[0] - ctr[0]) * nx + (m[1] - ctr[1]) * ny < 0) { nx = -nx; ny = -ny; }
        g.strokeStyle = th.foreground; g.globalAlpha = 0.75; g.lineWidth = 1;
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
        g.globalAlpha = 1;
        // plot's tick engine (the axes of a locked view use the same): a tick per ~55 px
        const ticks = _niceTicks(e.lo, e.hi, Math.max(2, Math.min(8, Math.floor(len / 55))));
        const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : (e.hi - e.lo);
        const labels = _fmtStep(ticks, step);
        g.textAlign = Math.abs(nx) < 0.3 ? 'center' : nx > 0 ? 'left' : 'right';
        g.textBaseline = Math.abs(ny) < 0.3 ? 'middle' : ny > 0 ? 'top' : 'bottom';
        g.fillStyle = th.foreground;
        ticks.forEach((t, i) => {
          if (t < e.lo - 1e-9 || t > e.hi + 1e-9) return;
          const p = P(...e.pt(t, c.fix));
          if (!p) return;
          g.strokeStyle = th.foreground; g.lineWidth = 1;
          g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + nx * 5, p[1] + ny * 5); g.stroke();
          if (!shared(k, p)) halo(g, th, labels[i], p[0] + nx * 8, p[1] + ny * 8);
        });
        // the axis name, beyond the labels, kept on the canvas
        g.font = fontOf(th, 1, true);
        const lx = Math.max(12, Math.min(W - 12, m[0] + nx * 34)), ly = Math.max(10, Math.min(H - 10, m[1] + ny * 34));
        halo(g, th, e.name, lx, ly);
        g.font = fontOf(th, 0.9);
      });
      g.restore();
    },
  };
}
