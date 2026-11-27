// micro VECTOR SECTIONS — a section as vector line work: every block the section plane cuts, as the
// shape it makes on that plane, in its legend colour; drillhole intervals in the slab, projected onto
// the plane; meshes as their cut lines. For a figure: crisp at any zoom, editable in Illustrator /
// Inkscape, a fraction of a 300-dpi raster.
//
// Any plane (plan, N–S, E–W, a dip/dip-direction or a knife cut). Blocks: regular, sub-blocked or
// rotated, coloured by a numeric ramp (continuous or classed) or by categories; the layer's filter
// applies. Where a block's cut is a rectangle in the plane (the plane square to the lattice) same-
// colour neighbours merge, so a large section stays small; an oblique cut gives each block its
// polygon (three to six sides). Everything is stored in the PLANE's coordinates — a basis
// { origin, u, v } — and drawn through the view's projection.
import { layerRecords, layerTableHeader, schemaExt, numOf, extendRow } from './records.js';
import { volumeContextOf, halfAt } from './analysis.js';
import { gridAxesOf } from './grid-ops.js';
import { colorSelOf, rampCfgOf, classBreaks, classIndex, classColor, noDataOf } from './ramp.js';
import { colorByName } from './color.js';
import { legendSpec } from './deco.js';
import { triangulateRings } from '../../../ext/geometry/index.js';

// the plane, in the section's own (u, v) — w is the axis it cuts across
export const SEC_AXES = { plan: { w: 2, u: 0, v: 1 }, ns: { w: 0, u: 1, v: 2 }, ew: { w: 1, u: 0, v: 2 } };

// ── BLOCK OUTLINES: a section shows colour regions (same-colour neighbours merge, each cell
// stroked only with a hairline of its own fill) unless asked for the blocking itself —
//   none       colour regions (the default; the smallest file)
//   sub-blocks every block's cut drawn on its own and stroked in ink (no merging)
//   parents    fills merged within each parent, and each PARENT cell's cut stroked in ink
//              (a regular model: a parent is a block)
// The default here (Settings → display → vector-section outlines); a caller may pass its own. Ink
// and line widths ride in the layer's `outline` for the drawer (@gcu/compo world.js). ──
export const VEC_OUTLINES = ['none', 'sub-blocks', 'parents'];
export let _vecOutlines = (() => { try { const v = localStorage.getItem('micro.vecOutlines'); return VEC_OUTLINES.includes(v) ? v : 'none'; } catch { return 'none'; } })();
export function setVectorOutlines(v) { _vecOutlines = VEC_OUTLINES.includes(v) ? v : 'none'; try { localStorage.setItem('micro.vecOutlines', _vecOutlines); } catch { /* private */ } }
const OUTLINE_INK = { color: '#1a1a1a', subWidth: 0.08, parentWidth: 0.2 };   // mm on the page
const outlineMode = (o) => (VEC_OUTLINES.includes(o) ? o : _vecOutlines);
// the parent cells of a section's blocks, along two in-plane axes: each block's cut rect
// [u0, v0, u1, v1] → its parent's [i, j]; parent size P [2] (world), the phase from a block that
// spans a whole parent along the axis, else the lowest corner — the support contract's sub-block rule
function parentGrid(raw, P) {
  const ph = [0, 1].map((a) => {
    const full = raw.find((r) => Math.abs((r[a + 2] - r[a]) - P[a]) < 1e-6 * P[a]);
    return full ? full[a] : Math.min(...raw.map((r) => r[a]));
  });
  const idx = (r, a) => Math.floor((r[a] - ph[a]) / P[a] + 1e-6);
  return { key: (r) => `${idx(r, 0)},${idx(r, 1)}`, rect: (r) => { const i = idx(r, 0), j = idx(r, 1); return [ph[0] + i * P[0], ph[1] + j * P[1], ph[0] + (i + 1) * P[0], ph[1] + (j + 1) * P[1]]; } };
}
// the cells with outlines: raw [u0, v0, u1, v1, colour] + mode → { rects, colors, outline }
function outlinedCells(raw, mode, P, max) {
  if (mode === 'sub-blocks') {                             // every block its own cell, stroked
    if (raw.length > max) throw new Error(`${raw.length.toLocaleString()} cells on this section with sub-block outlines — too many for vectors; outlines off, or keep it raster`);
    const rects = [], colors = [];
    for (const r of raw) { rects.push(r[0], r[1], r[2], r[3]); colors.push(r[4]); }
    return { rects, colors, outline: { mode, color: OUTLINE_INK.color, width: OUTLINE_INK.subWidth } };
  }
  // parents: merge within each parent only (the key joins the colour), stroke each parent once
  const pg = parentGrid(raw, P), keyIdx = new Map(), prect = [];
  const tagged = raw.map((r) => { const k = pg.key(r); let ki = keyIdx.get(k); if (ki == null) { ki = keyIdx.size; keyIdx.set(k, ki); prect.push(...pg.rect(r)); } return [r[0], r[1], r[2], r[3], r[4] * 1e7 + ki]; });
  const m = mergeRects(tagged);
  const colors = m.colors.map((c) => Math.floor(c / 1e7));
  if (colors.length + keyIdx.size > max) throw new Error(`${(colors.length + keyIdx.size).toLocaleString()} cells and parent outlines on this section — too many for vectors; outlines off, or keep it raster`);
  return { rects: m.rects, colors, outline: { mode, color: OUTLINE_INK.color, width: OUTLINE_INK.parentWidth, rects: prect } };
}
// a model's parent size in fine steps per axis (sub-blocked: the largest sub-block; regular: 1)
const parentSizeQ = (L) => { const h = L.docs && L.docs.blockDoc && L.docs.blockDoc.header; return h && h.subBlocked && h.sizeQMax ? h.sizeQMax.map((q) => Math.max(1, Math.round(q))) : [1, 1, 1]; };

// a record's colour, the way the legend paints it — null: not drawn (no data hidden, or a mode
// this can't paint)
export function colourerOf(L) {
  const spec = legendSpec(L), sel = String(colorSelOf(L));
  if (!spec) return null;
  const nd = noDataOf(L), ndColor = nd.hide ? null : nd.color;
  if (spec.kind === 'ramp') {
    const { lut, lo, hi } = spec, clip = [parseFloat(L.clip && L.clip[0]), parseFloat(L.clip && L.clip[1])];
    const hex = (k) => '#' + [lut[k * 4], lut[k * 4 + 1], lut[k * 4 + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
    const cache = new Array(256);
    return { numeric: true, of: (v) => {
      if (!Number.isFinite(v)) return ndColor;
      if ((Number.isFinite(clip[0]) && v < clip[0]) || (Number.isFinite(clip[1]) && v > clip[1])) return null;   // clipped: not shown
      const k = Math.max(0, Math.min(255, Math.round(((v - lo) / ((hi - lo) || 1)) * 255)));
      return cache[k] || (cache[k] = hex(k));
    } };
  }
  if (spec.kind === 'classes' && (sel.startsWith('chan:') || sel.startsWith('calc:'))) {    // a classed ramp
    const cfg = rampCfgOf(L) || {}, br = classBreaks(cfg), hidden = cfg.hide || [];
    return { numeric: true, of: (v) => { if (!Number.isFinite(v)) return ndColor; const k = classIndex(br, v); return hidden[k] ? null : classColor(cfg, br, k); } };
  }
  if (spec.kind === 'classes' && (sel === 'cat' || sel.startsWith('catcol:'))) {
    // a row's value → its entry's colour: by the values an entry stands for (a legend relabels them —
    // "gneiss basement" for GNEISS), else by its label (an entry per value)
    const by = new Map();
    for (const e of spec.entries) { if (!by.has(String(e.label))) by.set(String(e.label), e.color); for (const v of e.values || []) by.set(String(v), e.color); }
    return { numeric: false, of: (v) => (v == null || v === '' ? ndColor : by.get(String(v)) || null) };
  }
  return null;
}

// the cells one block layer makes on the section → { rects: [u0, v0, u1, v1, …], colors: [i…],
// palette: ['#…'], blocks, merged } — or throws saying why it can't
export async function sectionCells(L, sec, { max = 150000, outlines = null } = {}) {
  const om = outlineMode(outlines);
  const ax = SEC_AXES[sec && sec.mode];
  if (!ax) throw new Error('vector sections need an axis section — plan, N–S or E–W');
  const ga = gridAxesOf(L);
  if (!ga) throw new Error(`${L.label || L.name} is not a block model on a lattice`);
  // a rotated lattice's blocks aren't rectangles in an axis section: sectionShapes cuts them (the
  // composer routes a rotated model there) — this compact v1 form is for axis-aligned lattices only
  if (ga.rot) throw new Error(`${L.label || L.name}: a rotated lattice — cut by sectionShapes, not as axis rectangles`);
  const col = colourerOf(L);
  if (!col) throw new Error(`${L.label || L.name}: vector sections colour by a ramp or by categories — not by this colour mode`);
  const h = layerTableHeader(L), m = h && h.mapping;
  if (!m || m.x == null) throw new Error(`${L.label || L.name} has no coordinate columns`);
  const schema = schemaExt(L, h), vname = colorByName(L), vi = schema.findIndex((c) => c.name === vname);
  if (vi < 0) throw new Error(`${L.label || L.name}: no column “${vname}”`);
  const ci = [m.x, m.y, m.z], pitch = [ga.x.pitch, ga.y.pitch, ga.z.pitch].map((p) => Math.abs(+p) || 1);
  const vc = volumeContextOf(L);                           // each block's box from the support contract (halfAt)
  const mask = L.filterExpr && L._filterMask ? L._filterMask : null, d0 = +sec.position;
  const raw = [];                                           // u0, v0, u1, v1, colour
  const palette = [], pIdx = new Map();
  let blocks = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (mask && !(rec < mask.length && mask[rec])) continue;
    const half = halfAt(vc, f);
    const cw = +f[ci[ax.w]];
    if (!(cw - half[ax.w] <= d0 && d0 < cw + half[ax.w])) continue;   // the plane cuts this block (half-open: a face on the plane counts once)
    const v = col.numeric ? numOf(f[vi]) : f[vi];
    const c = col.of(v); if (!c) continue;
    let k = pIdx.get(c); if (k == null) { k = palette.length; palette.push(c); pIdx.set(c, k); }
    const cu = +f[ci[ax.u]], cv = +f[ci[ax.v]];
    raw.push([cu - half[ax.u], cv - half[ax.v], cu + half[ax.u], cv + half[ax.v], k]);
    if (++blocks > max * 4) throw new Error(`${blocks.toLocaleString()}+ blocks on this section — too many for vectors; keep it raster`);
  }
  if (om !== 'none') {
    const q = parentSizeQ(L), o = outlinedCells(raw, om, [q[ax.u] * pitch[ax.u], q[ax.v] * pitch[ax.v]], max);
    return { rects: o.rects, colors: o.colors, palette, blocks, merged: o.colors.length, outline: o.outline };
  }
  // merge runs along u: same row (v0, v1), same colour, touching
  raw.sort((a, b) => a[1] - b[1] || a[3] - b[3] || a[0] - b[0]);
  const rects = [], colors = [];
  for (const r of raw) {
    const n = colors.length;
    if (n && colors[n - 1] === r[4] && rects[n * 4 - 3] === r[1] && rects[n * 4 - 1] === r[3] && Math.abs(rects[n * 4 - 2] - r[0]) < 1e-6) { rects[n * 4 - 2] = r[2]; continue; }
    rects.push(r[0], r[1], r[2], r[3]); colors.push(r[4]);
  }
  // then stack identical runs from row to row (same u0, u1, colour, the rows touching): a uniform
  // area becomes one rectangle — fewer cells, and no seam between rows
  { const ord = colors.map((_, i) => i).sort((a, b) => rects[a * 4] - rects[b * 4] || rects[a * 4 + 2] - rects[b * 4 + 2] || colors[a] - colors[b] || rects[a * 4 + 1] - rects[b * 4 + 1]);
    const R2 = [], C2 = [];
    for (const i of ord) {
      const n = C2.length;
      if (n && C2[n - 1] === colors[i] && R2[n * 4 - 4] === rects[i * 4] && R2[n * 4 - 2] === rects[i * 4 + 2] && Math.abs(R2[n * 4 - 1] - rects[i * 4 + 1]) < 1e-6) { R2[n * 4 - 1] = rects[i * 4 + 3]; continue; }
      R2.push(rects[i * 4], rects[i * 4 + 1], rects[i * 4 + 2], rects[i * 4 + 3]); C2.push(colors[i]);
    }
    rects.length = 0; colors.length = 0; rects.push(...R2); colors.push(...C2); }
  if (colors.length > max) throw new Error(`${colors.length.toLocaleString()} cells on this section — too many for vectors; keep it raster`);
  return { rects, colors, palette, blocks, merged: colors.length };
}

// ── v2: ANY plane, rotated models, drillholes, meshes ─────────────────────────────────────────────
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const r6 = (x) => +x.toFixed(6);

// the plane n·p = position and a basis on it: u along the strike (horizontal), v up the dip — the
// way a section reads (a plan: u east, v north). origin = `near` dropped onto the plane, so the
// stored coordinates stay small. A sec from the view's facts: { normal, position }.
export function planeOf(sec, near = [0, 0, 0]) {
  const n = unit(sec.normal), pos = +sec.position;
  let u = Math.abs(n[2]) > 0.999 ? [1, 0, 0] : unit(cross([0, 0, 1], n));
  if (Math.abs(n[2]) <= 0.999 && (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0))) u = [-u[0], -u[1], -u[2]];   // read west → east (south → north)
  let v = cross(n, u); if (v[2] < -1e-9 || (Math.abs(v[2]) < 1e-9 && v[1] < 0)) v = [-v[0], -v[1], -v[2]];          // up (north on a plan)
  const d = dot(n, near) - pos, origin = [near[0] - d * n[0], near[1] - d * n[1], near[2] - d * n[2]].map((x) => +x.toFixed(3));
  return { n, pos, origin, u: u.map(r6), v: v.map(r6) };
}
const toUV = (P, p) => { const q = [p[0] - P.origin[0], p[1] - P.origin[1], p[2] - P.origin[2]]; return [dot(q, P.u), dot(q, P.v)]; };

// what a section keeps of the space: the slab |n·p − pos| ≤ t/2, or a half-space
function keepOf(sec) {
  const t = sec.thickness;
  if (sec.clip === 'front') return [0, Infinity];
  if (sec.clip === 'behind') return [-Infinity, 0];
  return t > 0 ? [-t / 2, t / 2] : [-Infinity, Infinity];
}

// blocks on any plane → cells (rectangles in a lattice-square plane, merged) or polygons
export async function sectionShapes(L, sec, near, { max = 150000, outlines = null } = {}) {
  const om = outlineMode(outlines);
  const ga = gridAxesOf(L);
  if (!ga) throw new Error(`${L.label || L.name} is not a block model on a lattice`);
  const col = colourerOf(L);
  if (!col) throw new Error(`${L.label || L.name}: vector sections colour by a ramp or by categories — not by this colour mode`);
  const h = layerTableHeader(L), m = h && h.mapping;
  if (!m || m.x == null) throw new Error(`${L.label || L.name} has no coordinate columns`);
  const schema = schemaExt(L, h), vname = colorByName(L), vi = schema.findIndex((c) => c.name === vname);
  if (vi < 0) throw new Error(`${L.label || L.name}: no column “${vname}”`);
  const R = ga.rot ? [ga.rot.slice(0, 3), ga.rot.slice(3, 6), ga.rot.slice(6, 9)] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const n0 = unit(sec.normal), pitch = [ga.x.pitch, ga.y.pitch, ga.z.pitch].map((p) => Math.abs(+p) || 1);
  // square to the lattice: the plane's normal along a lattice axis → every cut is a rectangle in
  // the other two axes — take THEM as the basis and merge like v1
  const sq = [0, 1, 2].find((k) => Math.abs(Math.abs(dot(n0, R[k])) - 1) < 1e-6);
  let P = planeOf(sec, near);
  if (sq != null) {
    const [a, b] = [0, 1, 2].filter((k) => k !== sq);
    // the reading order (u along, v up) decides which lattice axis is u
    const pick = (k) => Math.abs(dot(R[k], P.u)) >= Math.abs(dot(R[k], P.v));
    let [iu, iv] = pick(a) && !pick(b) ? [a, b] : pick(b) && !pick(a) ? [b, a] : [a, b];
    const su = dot(R[iu], P.u) < 0 ? -1 : 1, sv = dot(R[iv], P.v) < 0 ? -1 : 1;
    P = { ...P, u: R[iu].map((x) => r6(x * su)), v: R[iv].map((x) => r6(x * sv)), lattice: [iu, iv, su, sv] };
  }
  const ci = [m.x, m.y, m.z], vc = volumeContextOf(L);     // each block's box from the support contract (halfAt)
  const mask = L.filterExpr && L._filterMask ? L._filterMask : null;
  const raw = [], polys = [], palette = [], pIdx = new Map();
  const pq = parentSizeQ(L), PS = [0, 1, 2].map((a) => pq[a] * pitch[a]);
  const lows = om === 'parents' && !P.lattice ? [] : null; // an oblique cut: each block's lattice-frame low corner + half
  let blocks = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (mask && !(rec < mask.length && mask[rec])) continue;
    const half = halfAt(vc, f);
    const c = [+f[ci[0]], +f[ci[1]], +f[ci[2]]];
    const dist = dot(P.n, c) - P.pos, ext = half[0] * Math.abs(dot(P.n, R[0])) + half[1] * Math.abs(dot(P.n, R[1])) + half[2] * Math.abs(dot(P.n, R[2]));
    if (!(-ext <= -dist && -dist < ext)) continue;         // the plane cuts this block (half-open: a face on the plane counts once)
    const val = col.numeric ? numOf(f[vi]) : f[vi], colour = col.of(val); if (!colour) continue;
    let k = pIdx.get(colour); if (k == null) { k = palette.length; palette.push(colour); pIdx.set(colour, k); }
    if (++blocks > max * 4) throw new Error(`${blocks.toLocaleString()}+ blocks on this section — too many for vectors; keep it raster`);
    if (P.lattice) {
      const [iu, iv] = P.lattice, [cu, cv] = toUV(P, c), hu = half[iu], hv = half[iv];
      raw.push([cu - hu, cv - hv, cu + hu, cv + hv, k]);
      continue;
    }
    const uniq = cutPolygon(P, c, half, R);
    if (uniq.length >= 3) polys.push(uniq, k);
    if (lows) lows.push([0, 1, 2].map((a) => dot(R[a], c) - half[a]), half.slice());
  }
  const plane = { origin: P.origin, u: P.u, v: P.v };
  if (P.lattice) {
    if (om !== 'none') {
      const [iu, iv] = P.lattice, o = outlinedCells(raw, om, [PS[iu], PS[iv]], max);
      return { type: 'cells', plane, rects: o.rects, colors: o.colors, palette, blocks, outline: o.outline };
    }
    const merged = mergeRects(raw);
    if (merged.colors.length > max) throw new Error(`${merged.colors.length.toLocaleString()} cells on this section — too many for vectors; keep it raster`);
    return { type: 'cells', plane, rects: merged.rects, colors: merged.colors, palette, blocks };
  }
  const pts = [], starts = [], colors = [];
  for (let i = 0; i < polys.length; i += 2) { starts.push(pts.length / 2); for (const p of polys[i]) pts.push(p[0], p[1]); colors.push(polys[i + 1]); }
  if (colors.length > max) throw new Error(`${colors.length.toLocaleString()} cells on this section — too many for vectors; keep it raster`);
  const out = { type: 'polys', plane, pts, starts, colors, palette, blocks };
  if (om === 'sub-blocks') out.outline = { mode: om, color: OUTLINE_INK.color, width: OUTLINE_INK.subWidth };
  else if (om === 'parents' && lows.length) {
    // each parent box (in the lattice frame: a low corner on the parent lattice, the parent size) cut by the plane
    const ph = [0, 1, 2].map((a) => { let full = null, lo = Infinity; for (let i = 0; i < lows.length; i += 2) { const l = lows[i][a], hh = lows[i + 1][a]; if (l < lo) lo = l; if (full == null && Math.abs(2 * hh - PS[a]) < 1e-6 * PS[a]) full = l; } return full != null ? full : lo; });
    const seen = new Set(), opts = [], ost = [];
    for (let i = 0; i < lows.length; i += 2) {
      const id = [0, 1, 2].map((a) => Math.floor((lows[i][a] - ph[a]) / PS[a] + 1e-6)), key = id.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const cl = [0, 1, 2].map((a) => ph[a] + (id[a] + 0.5) * PS[a]);   // the parent's centre in the lattice frame → world
      const cw = [0, 1, 2].map((x) => R[0][x] * cl[0] + R[1][x] * cl[1] + R[2][x] * cl[2]);
      const poly = cutPolygon(P, cw, PS.map((v) => v / 2), R);
      if (poly.length >= 3) { ost.push(opts.length / 2); for (const p of poly) opts.push(p[0], p[1]); }
    }
    if (colors.length + ost.length > max) throw new Error(`${(colors.length + ost.length).toLocaleString()} cells and parent outlines on this section — too many for vectors; outlines off, or keep it raster`);
    out.outline = { mode: om, color: OUTLINE_INK.color, width: OUTLINE_INK.parentWidth, pts: opts, starts: ost };
  }
  return out;
}
// one box (centre c, half extents h [3], axes R) cut by the plane → its polygon in (u, v): the box's
// edges that cross the plane, ordered around their centre
function cutPolygon(P, c, half, R) {
  const pts = [];
  const corner = (s) => [0, 1, 2].map((a) => c[a] + s[0] * half[0] * R[0][a] + s[1] * half[1] * R[1][a] + s[2] * half[2] * R[2][a]);
  for (let e = 0; e < 3; e++) for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    const sA = [0, 0, 0], sB = [0, 0, 0]; const [o1, o2] = [0, 1, 2].filter((a) => a !== e);
    sA[e] = -1; sB[e] = 1; sA[o1] = sB[o1] = s1; sA[o2] = sB[o2] = s2;
    const A = corner(sA), B = corner(sB), dA = dot(P.n, A) - P.pos, dB = dot(P.n, B) - P.pos;
    if ((dA < 0) === (dB < 0) && dA !== 0 && dB !== 0) continue;
    const t = dA === dB ? 0 : dA / (dA - dB);
    pts.push(toUV(P, [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]));
  }
  if (!pts.length) return pts;
  const mu = pts.reduce((s, p) => s + p[0], 0) / pts.length, mv = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  pts.sort((p, q) => Math.atan2(p[1] - mv, p[0] - mu) - Math.atan2(q[1] - mv, q[0] - mu));
  return pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return i === 0 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
}
// v1's two passes, as one function: runs along u, then identical runs stacked along v
function mergeRects(raw) {
  raw.sort((a, b) => a[1] - b[1] || a[3] - b[3] || a[0] - b[0]);
  const rects = [], colors = [];
  for (const r of raw) {
    const n = colors.length;
    if (n && colors[n - 1] === r[4] && Math.abs(rects[n * 4 - 3] - r[1]) < 1e-6 && Math.abs(rects[n * 4 - 1] - r[3]) < 1e-6 && Math.abs(rects[n * 4 - 2] - r[0]) < 1e-6) { rects[n * 4 - 2] = r[2]; continue; }
    rects.push(r[0], r[1], r[2], r[3]); colors.push(r[4]);
  }
  const ord = colors.map((_, i) => i).sort((a, b) => rects[a * 4] - rects[b * 4] || rects[a * 4 + 2] - rects[b * 4 + 2] || colors[a] - colors[b] || rects[a * 4 + 1] - rects[b * 4 + 1]);
  const R2 = [], C2 = [];
  for (const i of ord) {
    const n = C2.length;
    if (n && C2[n - 1] === colors[i] && Math.abs(R2[n * 4 - 4] - rects[i * 4]) < 1e-6 && Math.abs(R2[n * 4 - 2] - rects[i * 4 + 2]) < 1e-6 && Math.abs(R2[n * 4 - 1] - rects[i * 4 + 1]) < 1e-6) { R2[n * 4 - 1] = rects[i * 4 + 3]; continue; }
    R2.push(rects[i * 4], rects[i * 4 + 1], rects[i * 4 + 2], rects[i * 4 + 3]); C2.push(colors[i]);
  }
  return { rects: R2, colors: C2 };
}

// drillholes: each interval the section keeps — clipped to the slab (or half-space), or whole when
// the layer shows whole holes crossing it — projected onto the plane, in the 3D view's colours.
// Consecutive intervals of one colour join into one line. width = the 3D sticks' diameter.
export async function sectionDrillholes(L, sec, near, { mode = true, radius = 1, max = 400000 } = {}) {
  const dh = L.docs && L.docs.dhDoc;
  if (!dh || !dh.streamChunks) throw new Error(`${L.label || L.name}: no drillhole geometry`);
  const col = colourerOf(L);
  if (!col) throw new Error(`${L.label || L.name}: drillholes as vectors colour by a ramp or by categories — not by this colour mode`);
  const h = layerTableHeader(L), schema = schemaExt(L, h), vname = colorByName(L), vi = schema.findIndex((c) => c.name === vname);
  if (vi < 0) throw new Error(`${L.label || L.name}: no column “${vname}”`);
  const whole = mode && typeof mode === 'object' && mode.whole;
  const drawn = L._drawMask || (L.filterExpr && L._filterMask) || null;
  const P = planeOf(sec, near), [lo, hi] = whole ? [-Infinity, Infinity] : keepOf(sec);
  const palette = [], pIdx = new Map(), pts = [], starts = [], colors = [];
  let intervals = 0, last = null;
  for await (const ch of dh.streamChunks()) {
    for (let q = 0; q < ch.count; q++) {
      const rec = ch.recIdx[q];
      if (drawn && !(rec < drawn.length && drawn[rec])) continue;
      const A = [ch.ax[q], ch.ay[q], ch.az[q]], B = [ch.bx[q], ch.by[q], ch.bz[q]];
      const dA = dot(P.n, A) - P.pos, dB = dot(P.n, B) - P.pos;
      let t0 = 0, t1 = 1;                                  // clip the segment to lo ≤ d ≤ hi
      for (const [bound, sgn] of [[lo, 1], [hi, -1]]) {
        if (!Number.isFinite(bound)) continue;
        const fa = sgn * (dA - bound), fb = sgn * (dB - bound);
        if (fa < 0 && fb < 0) { t0 = 1; t1 = 0; break; }
        if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
      }
      if (!(t1 > t0)) continue;
      const f = extendRow(L, dh.fetchRecord(rec), rec), val = col.numeric ? numOf(f[vi]) : f[vi], colour = col.of(val);
      if (!colour) continue;
      let k = pIdx.get(colour); if (k == null) { k = palette.length; palette.push(colour); pIdx.set(colour, k); }
      const at = (t) => toUV(P, [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]);
      const a = at(t0), b = at(t1);
      if (last && last.k === k && Math.hypot(a[0] - last.u, a[1] - last.v) < 1e-6) pts.push(b[0], b[1]);   // continues the line
      else { starts.push(pts.length / 2); pts.push(a[0], a[1], b[0], b[1]); colors.push(k); }
      last = { k, u: b[0], v: b[1] };
      if (++intervals > max) throw new Error(`${intervals.toLocaleString()}+ intervals on this section — too many for vectors; keep it raster`);
    }
  }
  return { type: 'lines', plane: { origin: P.origin, u: P.u, v: P.v }, pts, starts, colors, palette, width: 2 * radius, intervals };
}

// strings & polygons (src/polygons.js): every feature segment in the slab (clipped to it, like a
// drillhole interval), projected onto the plane, in the feature's colour — and, on a PLAN with the
// layer's fill on, each polygon whose vertices lie in the slab as its fill (triangles, holes kept).
// → one or two layers: [lines, polys?]. A layer coloured 'solid' draws in its fill colour.
export function sectionFeatures(L, sec, near, { radius = 1, max = 400000 } = {}) {
  const d = L.docs && L.docs.stringsDoc;
  if (!d || !d.features) throw new Error(`${L.label || L.name}: no features`);
  const col = colourerOf(L), solid = L.fillColor || '#c89b3c';
  const h = d.header, schema = schemaExt(L, h), vname = col ? colorByName(L) : null, vi = vname ? schema.findIndex((c) => c.name === vname) : -1;
  if (col && vi < 0) throw new Error(`${L.label || L.name}: no column “${vname}”`);
  const drawn = (L.filterExpr && L._filterMask) || null;
  const P = planeOf(sec, near), [lo, hi] = keepOf(sec), plan = Math.abs(P.n[2]) > 0.999;
  const palette = [], pIdx = new Map(), pts = [], starts = [], colors = [];
  const fpts = [], fstarts = [], fcolors = [];
  let segs = 0;
  const colourOf = (rec) => {
    if (!col) return solid;
    const f = extendRow(L, d.fetchRecord(rec), rec), v = col.numeric ? numOf(f[vi]) : f[vi];
    return col.of(v);
  };
  const idx = (c) => { let k = pIdx.get(c); if (k == null) { k = palette.length; palette.push(c); pIdx.set(c, k); } return k; };
  d.features.forEach((f, rec) => {
    if (drawn && !(rec < drawn.length && drawn[rec])) return;
    const colour = colourOf(rec); if (!colour) return;
    const k = idx(colour);
    let allIn = true;
    for (const r of f.rings) {
      const m = f.closed ? r.length : r.length - 1;
      let last = null;
      for (let i = 0; i < m; i++) {
        const A = r[i], B = r[(i + 1) % r.length];
        const dA = dot(P.n, A) - P.pos, dB = dot(P.n, B) - P.pos;
        if (dA < lo || dA > hi) allIn = false;
        let t0 = 0, t1 = 1;
        for (const [bound, sgn] of [[lo, 1], [hi, -1]]) {
          if (!Number.isFinite(bound)) continue;
          const fa = sgn * (dA - bound), fb = sgn * (dB - bound);
          if (fa < 0 && fb < 0) { t0 = 1; t1 = 0; break; }
          if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
        }
        if (!(t1 > t0)) { last = null; continue; }
        const at = (t) => toUV(P, [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]);
        const a = at(t0), b = at(t1);
        if (last && Math.hypot(a[0] - last[0], a[1] - last[1]) < 1e-6) pts.push(b[0], b[1]);
        else { starts.push(pts.length / 2); pts.push(a[0], a[1], b[0], b[1]); colors.push(k); }
        last = b;
        if (++segs > max) throw new Error(`${segs.toLocaleString()}+ segments on this section — too many for vectors; keep it raster`);
      }
    }
    if (plan && L.polyFill && f.closed && allIn) {
      for (const part of f.parts) {
        const t = triangulateRings(part.map((ri) => f.rings[ri]));
        for (let q = 0; q < t.triangles.length; q += 3) {
          fstarts.push(fpts.length / 2);
          for (let c = 0; c < 3; c++) { const vtx = t.triangles[q + c] * 3; const uv = toUV(P, [t.vertices[vtx], t.vertices[vtx + 1], t.vertices[vtx + 2]]); fpts.push(uv[0], uv[1]); }
          fcolors.push(k);
        }
      }
    }
  });
  const plane = { origin: P.origin, u: P.u, v: P.v };
  const out = [];
  if (fcolors.length) out.push({ type: 'polys', plane, pts: fpts, starts: fstarts, colors: fcolors, palette: palette.slice(), blocks: fcolors.length });
  out.push({ type: 'lines', plane, pts, starts, colors, palette, width: 2 * radius, intervals: segs });
  return out;
}

// a mesh: where the plane cuts it — each triangle crossing the plane gives a segment, chained into
// polylines by their shared edges. In the mesh's tint.
export function sectionMesh(L, sec, near, mesh, { tint = '#9ea3a8', max = 2000000 } = {}) {
  const V = mesh.vertices, T = mesh.triangles, P = planeOf(sec, near), nv = V.length / 3;
  const d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) d[i] = P.n[0] * V[i * 3] + P.n[1] * V[i * 3 + 1] + P.n[2] * V[i * 3 + 2] - P.pos;
  const side = (i) => d[i] >= 0;                           // a vertex ON the plane counts as in front: no zero-length pieces
  const cut = new Map();                                   // edge key → its crossing point, so neighbours share one point
  const ptOf = (i, j) => {
    const key = i < j ? i * nv + j : j * nv + i;
    let p = cut.get(key);
    if (!p) { const t = d[i] / (d[i] - d[j]); p = toUV(P, [V[i * 3] + t * (V[j * 3] - V[i * 3]), V[i * 3 + 1] + t * (V[j * 3 + 1] - V[i * 3 + 1]), V[i * 3 + 2] + t * (V[j * 3 + 2] - V[i * 3 + 2])]); p.key = key; cut.set(key, p); }
    return p;
  };
  const segs = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2], sa = side(a), sb = side(b), sc = side(c);
    if (sa === sb && sb === sc) continue;
    const odd = sa === sb ? c : sa === sc ? b : a, [o1, o2] = odd === a ? [b, c] : odd === b ? [c, a] : [a, b];
    segs.push(ptOf(odd, o1), ptOf(odd, o2));
    if (segs.length > max) throw new Error(`${L.label || L.name}: too many cut segments for vectors; keep it raster`);
  }
  // chain: segment i runs segs[2i] → segs[2i+1]; segments meeting at an edge-point share its key
  const ns = segs.length / 2, by = new Map();
  for (let i = 0; i < ns; i++) for (const e of [2 * i, 2 * i + 1]) { const k = segs[e].key; (by.get(k) || by.set(k, []).get(k)).push(i); }
  const used = new Uint8Array(ns), pts = [], starts = [];
  const extend = (line, key) => {                          // onward from the point `key`, through unused segments
    for (;;) {
      const i = (by.get(key) || []).find((j) => !used[j]); if (i == null) return;
      used[i] = 1; const a = segs[2 * i], b = segs[2 * i + 1], nxt = a.key === key ? b : a;
      line.push(nxt); key = nxt.key;
    }
  };
  for (let i = 0; i < ns; i++) {
    if (used[i]) continue;
    used[i] = 1; const a = segs[2 * i], b = segs[2 * i + 1];
    const fwd = [a, b]; extend(fwd, b.key);
    const back = []; extend(back, a.key);
    const line = [...back.reverse(), ...fwd];
    starts.push(pts.length / 2); for (const p of line) pts.push(p[0], p[1]);
  }
  return { type: 'lines', plane: { origin: P.origin, u: P.u, v: P.v }, pts, starts, colors: starts.map(() => 0), palette: [tint], lw: 0.35, segments: segs.length / 2 };
}

try { window._microVis = Object.assign(window._microVis || {}, { sectionCells, sectionShapes, sectionFeatures, setVectorOutlines, vectorOutlines: () => _vecOutlines }); } catch { /* headless */ }
