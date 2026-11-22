// WORLD — an image frame that is a picture of 3D space (a host's render) can say how:
//
//   content.meta.proj = { m: [16 numbers, column-major: (world − origin) → clip space], origin: [x, y, z], focus?: [x, y, z] }
//
// Then compo knows where any world point lands on the page, and which world coordinate any point
// of the picture shows. That gives:
// - coordinate ticks (or a grid) on the frame's border, as vectors: "512 300 E", "630 RL";
// - labels pinned to a world point (a hole, a callout): the leader follows the point when the
//   view is rendered again.
// The matrix is the renderer's own viewProj at the frame's aspect, so vertical exaggeration and
// a perspective camera come along for free (ticks are drawn only for an orthographic view,
// where a border point has one coordinate).

import { fontMm } from './type.js';

export const hasProj = (f) => !!(f && f.content && f.content.meta && f.content.meta.proj && Array.isArray(f.content.meta.proj.m) && f.content.meta.proj.m.length === 16);
export const isOrthoProj = (m) => Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) < 1e-9;

// the picture's rect on the page (the image kind's fit), mm
export function imageRect(frame) {
  const c = frame.content || {}, b = frame.box, img = frame._img;
  const iw = c.width || (img && img.width), ih = c.height || (img && img.height);
  if (!iw || !ih || c.fit === 'fill') return [b[0], b[1], b[2], b[3]];
  const k = c.fit === 'cover' ? Math.max(b[2] / iw, b[3] / ih) : Math.min(b[2] / iw, b[3] / ih);
  const w = iw * k, h = ih * k;
  return [b[0] + (b[2] - w) / 2, b[1] + (b[3] - h) / 2, w, h];
}
const mul4 = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
function inv4(m) {
  const a = m, inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) return null;
  return inv.map((v) => v / det);
}
const _inv = new WeakMap();
const invOf = (P) => { let i = _inv.get(P); if (!i) { i = inv4(P.m); _inv.set(P, i); } return i; };

// a world point → { x, y } on the page (mm) and whether it is inside the picture; null behind the eye
export function worldToPage(frame, p) {
  const P = frame.content.meta.proj, o = P.origin || [0, 0, 0];
  const c = mul4(P.m, [p[0] - o[0], p[1] - o[1], p[2] - o[2], 1]);
  if (!(c[3] > 1e-12)) return null;
  const nx = c[0] / c[3], ny = c[1] / c[3], r = imageRect(frame);
  return { x: r[0] + ((nx + 1) / 2) * r[2], y: r[1] + ((1 - ny) / 2) * r[3], inside: Math.abs(nx) <= 1 && Math.abs(ny) <= 1 };
}
// the depth (NDC z) of the view's FOCUS (proj.focus, a world point — the camera's target): a ray is
// read there, not at an arbitrary depth (a near-plan view's ray drifts sideways with depth)
function focusZ(frame) {
  const P = frame.content.meta.proj, f = P.focus; if (!Array.isArray(f) || f.length !== 3) return 0;
  const o = P.origin || [0, 0, 0], c = mul4(P.m, [f[0] - o[0], f[1] - o[1], f[2] - o[2], 1]);
  return c[3] > 1e-12 ? Math.max(-1, Math.min(1, c[2] / c[3])) : 0;
}
// a page point (mm) → the world point it shows, at depth ndcZ (−1 near … 1 far; default: the focus's)
export function pageToWorld(frame, x, y, ndcZ) {
  const P = frame.content.meta.proj, o = P.origin || [0, 0, 0], inv = invOf(P); if (!inv) return null;
  if (ndcZ == null) ndcZ = focusZ(frame);
  const r = imageRect(frame), nx = ((x - r[0]) / r[2]) * 2 - 1, ny = 1 - ((y - r[1]) / r[3]) * 2;
  const v = mul4(inv, [nx, ny, ndcZ, 1]);
  return [v[0] / v[3] + o[0], v[1] / v[3] + o[1], v[2] / v[3] + o[2]];
}

// ── coordinate ticks on an orthographic view's border ──
const AXIS = ['E', 'N', 'RL'];
const NICE = [1, 2, 2.5, 5, 10];
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return NICE.find((n) => n >= f - 1e-9) * p;
}
export function fmtCoord(v, step) {
  const dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9));
  const s = Math.abs(v).toFixed(dec), [ip, fp] = s.split('.');
  return (v < 0 ? '−' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fp ? '.' + fp : '');
}
// the ticks of one view frame: [{ edge, axis, value, x, y }] — what drawTicks draws, for tests and hosts
export function worldTicks(frame, { spacing = 18 } = {}) {
  if (!hasProj(frame) || !isOrthoProj(frame.content.meta.proj.m)) return [];
  const r = imageRect(frame), b = frame.box;
  const x0 = Math.max(r[0], b[0]), y0 = Math.max(r[1], b[1]), x1 = Math.min(r[0] + r[2], b[0] + b[2]), y1 = Math.min(r[1] + r[3], b[1] + b[3]);
  if (!(x1 > x0 && y1 > y0)) return [];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, n0 = pageToWorld(frame, cx, cy, -1), n1 = pageToWorld(frame, cx, cy, 1);
  if (!n0 || !n1) return [];
  const dl = Math.hypot(n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]) || 1, dir = [0, 1, 2].map((i) => (n1[i] - n0[i]) / dl);
  const edges = [['top', [x0, y0], [x1, y0]], ['bottom', [x0, y1], [x1, y1]], ['left', [x0, y0], [x0, y1]], ['right', [x1, y0], [x1, y1]]];
  const out = [];
  for (const [edge, a, bb] of edges) {
    const wa = pageToWorld(frame, a[0], a[1]), wb = pageToWorld(frame, bb[0], bb[1]);
    const e = [0, 1, 2].map((i) => wb[i] - wa[i]), el = Math.hypot(...e) || 1;
    // the coordinate this edge shows: constant along the view direction, changing most along the edge
    let ax = -1, best = 0;
    for (let i = 0; i < 3; i++) if (Math.abs(dir[i]) < 0.3 && Math.abs(e[i]) / el > 0.5 && Math.abs(e[i]) > best) { best = Math.abs(e[i]); ax = i; }
    if (ax < 0) continue;
    const lenMm = Math.hypot(bb[0] - a[0], bb[1] - a[1]), step = niceStep(Math.abs(e[ax]) / Math.max(1.5, lenMm / spacing));
    const lo = Math.min(wa[ax], wb[ax]), hi = Math.max(wa[ax], wb[ax]);
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
      const t = (v - wa[ax]) / e[ax];
      if (t < 0.02 || t > 0.98) continue;                  // not in the corners
      out.push({ edge, axis: AXIS[ax], ai: ax, value: +v.toFixed(9), step, x: a[0] + t * (bb[0] - a[0]), y: a[1] + t * (bb[1] - a[1]) });
    }
  }
  return out;
}
export function drawTicks(ctx, frame, mode = 'ticks') {
  const ticks = worldTicks(frame); if (!ticks.length) return;
  const size = 5.5, tl = 1.6;
  ctx.save();
  ctx.lineWidth = 0.18; ctx.strokeStyle = '#1a1a1a';
  if (mode === 'grid') {                                   // lines across: a value on one edge to the same value on the opposite edge
    ctx.save(); ctx.strokeStyle = 'rgba(26,26,26,0.35)'; ctx.lineWidth = 0.12;
    for (const [e1, e2] of [['top', 'bottom'], ['left', 'right']]) for (const t of ticks.filter((x) => x.edge === e1)) {
      const u = ticks.find((x) => x.edge === e2 && x.axis === t.axis && Math.abs(x.value - t.value) < t.step * 1e-6);
      if (u) { ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(u.x, u.y); ctx.stroke(); }
    }
    ctx.restore();
  }
  ctx.font = fontMm(size); ctx.fillStyle = '#1a1a1a';
  for (const t of ticks) {
    const txt = `${fmtCoord(t.value, t.step)} ${t.axis}`, inward = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[t.edge];
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + inward[0] * tl, t.y + inward[1] * tl); ctx.stroke();
    const w = ctx.measureText(txt).width, hh = size * 25.4 / 72;
    ctx.save();
    ctx.translate(t.x + inward[0] * (tl + 0.4), t.y + inward[1] * (tl + 0.4));
    if (t.edge === 'left' || t.edge === 'right') ctx.rotate(-Math.PI / 2);
    // the label sits inward of its tick, centred on it, on a light backing. Rotated −90° on the
    // side edges (reading upward), local +y points into the picture on the left edge, out of it
    // on the right — so the left and top labels hang below y = 0, the right and bottom ones above.
    const y0 = t.edge === 'top' || t.edge === 'left' ? 0 : -hh * 1.15;
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(-w / 2 - 0.4, y0, w + 0.8, hh * 1.15);
    ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(txt, 0, y0 + 0.1 * hh);
    ctx.restore();
  }
  ctx.restore();
}

// ── world OVERLAYS on a projected view: { type: 'plane', normal, position, thickness?, color?, label? }
// draws the plane's TRACE — where n·p = position crosses the picture (at the view's focal depth;
// exact for a vertical plane on a plan) — solid, with its slab's faces dashed when it has a
// thickness. A key plan wears the section of the view it keys. ──
function planeSegment(frame, normal, position) {
  const r = imageRect(frame), b = frame.box;
  const x0 = Math.max(r[0], b[0]), y0 = Math.max(r[1], b[1]), x1 = Math.min(r[0] + r[2], b[0] + b[2]), y1 = Math.min(r[1] + r[3], b[1] + b[3]);
  const g = (x, y) => { const w = pageToWorld(frame, x, y); return w ? normal[0] * w[0] + normal[1] * w[1] + normal[2] * w[2] - position : NaN; };
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], v = cs.map(([x, y]) => g(x, y)), pts = [];
  if (v.some((q) => !Number.isFinite(q))) return null;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, a = v[i], c = v[j];
    if (a === 0) pts.push(cs[i]);
    if ((a < 0 && c > 0) || (a > 0 && c < 0)) { const t = a / (a - c); pts.push([cs[i][0] + t * (cs[j][0] - cs[i][0]), cs[i][1] + t * (cs[j][1] - cs[i][1])]); }
  }
  return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null;
}
export function planeTrace(frame, ov) {
  if (!hasProj(frame) || !ov || !Array.isArray(ov.normal)) return null;
  const n = ov.normal.map(Number), l = Math.hypot(...n); if (!(l > 0)) return null;
  const u = n.map((q) => q / l), d = +ov.position / l;
  // a plane facing the viewer (a level on a plan) has no trace — it is the whole picture or none of it
  const r = imageRect(frame), cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2, n0 = pageToWorld(frame, cx, cy, -1), n1 = pageToWorld(frame, cx, cy, 1);
  if (n0 && n1) { const dv = [0, 1, 2].map((i) => n1[i] - n0[i]), dl = Math.hypot(...dv) || 1; if (Math.abs((u[0] * dv[0] + u[1] * dv[1] + u[2] * dv[2]) / dl) > 0.98) return null; }
  const out = { line: planeSegment(frame, u, d), faces: [] };
  if (+ov.thickness > 0) for (const s of [-1, 1]) { const f = planeSegment(frame, u, d + (s * +ov.thickness) / 2); if (f) out.faces.push(f); }
  return out.line || out.faces.length ? out : null;
}
export function drawOverlays(ctx, frame, list) {
  for (const ov of list || []) {
    if (!ov || ov.type !== 'plane') continue;
    const t = planeTrace(frame, ov); if (!t) continue;
    const col = ov.color || '#c0392b';
    ctx.save();
    ctx.strokeStyle = col;
    if (t.faces.length) {
      ctx.lineWidth = 0.18; ctx.setLineDash([0.8, 0.6]);
      for (const [a, b] of t.faces) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (t.line) {
      const [a, b] = t.line;
      ctx.lineWidth = 0.45; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if (ov.label) {
        ctx.font = fontMm(6, { bold: true }); ctx.fillStyle = col; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
        const w = ctx.measureText(String(ov.label)).width, hh = 6 * 25.4 / 72;
        const p = a[1] < b[1] ? a : b, x = Math.min(p[0] + 0.8, frame.box[0] + frame.box[2] - w - 0.8), y = Math.max(p[1] + hh + 0.8, frame.box[1] + hh + 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 0.4, y - hh - 0.2, w + 0.8, hh + 0.4);
        ctx.fillStyle = col; ctx.fillText(String(ov.label), x, y);
      }
    }
    ctx.restore();
  }
}
