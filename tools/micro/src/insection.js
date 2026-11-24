// micro — RECORDS INSIDE A SECTION: which of a layer's records lie inside the section the view is
// cut by, as a record mask. The composer's captions use it ({count} and the statistics over what a
// view frame's image shows, page by page in an atlas); anything else asking "how much of this
// layer is in the slab" can too.
//
// "Inside" is decided by ONE point per record, so contiguous slabs PARTITION a layer (an atlas's
// bench counts add up to the model's — a block straddling two benches is counted on one, never
// both):
// - a block: its CENTROID. The slab is widened to at least one block along its normal, so a slab
//   thinner than a block still holds the blocks its plane cuts (the image shows them).
// - a drillhole interval: its MIDPOINT (as placed by the desurvey).
// - a point of a cloud: itself.
// - a "whole holes" drillhole layer: the holes the image draws whole — every interval of a hole
//   that crosses the slab (the renderer's own set, no geometry here).
// The interval is half-open — (d − h, d + h] along the normal, the same rule a vector section uses
// for the plane cutting a block — so a record on the face between two slabs is in exactly one.
// A half-space (front / behind) is "inside" on its kept side: what is drawn. A layer the section
// doesn't cut (its "cut by sections" off), a mesh, a grid or a table has no such records → null.
import { S } from './state.js';
import { layerPositions } from './bygeom.js';
import { attrRowCountOf } from './records.js';
import { syncWholeHoles } from './drillholes.js';
import { currentSection } from './section.js';
import { layerSection, supportOfHeader } from '../../../ext/condenser/src/main.js';

// the base mask a layer's records pass before any section: its filter (drillholes the same way the
// composer's "shown" counts them)
export const filterMaskOf = (L) => (L.filterExpr && L._filterMask ? L._filterMask : null);

// what the CURRENT section does to layer L, captured now (frame-local plane, the layer's own mode
// and offset, the masks it starts from) so a later async pass reads this moment, not whatever the
// 3D view shows by then → { kind: 'slab', … } | { kind: 'whole', … } | null (not cut / no records)
export function sectionCutOf(L, cs = currentSection()) {
  if (!cs || !L || !L.docs) return null;
  const d = L.docs;
  if (d.meshDoc || d.gridDoc || d.stringsDoc || d.tableDoc) return null;   // no positional records
  const isDh = !!d.dhDoc;
  if (!isDh && !d.blockDoc && !d.lasDoc && !d.plyDoc) return null;
  if (isDh && !d.dhDoc.recordPosition) return null;
  const mode = S.renderer.layerSectioned(L.id);
  const base = filterMaskOf(L);
  if (isDh && mode && typeof mode === 'object' && mode.whole) {
    try { syncWholeHoles(cs); } catch { /* the renderer's last set stands */ }
    const holes = L._secHoleMask || null;
    return holes ? { kind: 'whole', L, holes, base } : null;
  }
  const sec = layerSection(cs, mode);
  if (!sec) return null;
  const off = S.renderer.layerOffset ? S.renderer.layerOffset(L.id) : [0, 0, 0];
  const o0 = S.frame ? S.frame.origin : [0, 0, 0];
  const o = [o0[0] - off[0], o0[1] - off[1], o0[2] - off[2]];   // n·(x + off − origin): world → the section's frame
  // a block's reach along the normal (its half-dims projected on n; a rotated lattice through U/V/W):
  // the slab is at least one block thick, so a thin slab still holds the blocks its plane cuts
  // (the block-support contract's frame + pitch — one lattice cell; a sub-blocked model's fine cell)
  let reach = 0;
  const sup = !isDh && d.blockDoc ? supportOfHeader(d.blockDoc.header) : null;
  if (sup) {
    const n = sec.n, R = sup.frame.R, P = sup.lattice.pitch;
    const pr = [0, 1, 2].map((a) => Math.abs(n[0] * R[3 * a] + n[1] * R[3 * a + 1] + n[2] * R[3 * a + 2]));
    reach = (Math.abs(P[0]) * pr[0] + Math.abs(P[1]) * pr[1] + Math.abs(P[2]) * pr[2]) / 2;
  }
  const h = Math.max(sec.half, reach);
  return { kind: 'slab', L, n: sec.n.slice(), o, lo: sec.d - h, hi: sec.d + h, clip: sec.clip, base };
}

// world bbox of the slab when it is square to an axis (a spatial pushdown for the positions read:
// a Morton-sorted Parquet skips the row groups the slab can't touch) — else null
function slabBbox(cut) {
  const n = cut.n, k = n.findIndex((c) => Math.abs(Math.abs(c) - 1) < 1e-9);
  if (k < 0 || cut.clip !== 'slab') return null;
  const BIG = 1e300, bb = [-BIG, -BIG, -BIG, BIG, BIG, BIG], s = Math.sign(n[k]);
  const a = cut.lo * s + cut.o[k], b = cut.hi * s + cut.o[k];
  bb[k] = Math.min(a, b); bb[k + 3] = Math.max(a, b);
  return bb;
}

// one streamed pass over the layer's positions → { mask: Uint8Array (inside AND the base filter),
// count }. N records; nothing but the mask is kept.
export async function sectionRecordMask(cut) {
  const L = cut.L, N = attrCount(L);
  if (cut.kind === 'whole') {
    const m = new Uint8Array(N), hs = cut.holes, b = cut.base;
    let count = 0;
    for (let r = 0; r < N; r++) if (hs[r] && (!b || b[r])) { m[r] = 1; count++; }
    return { mask: m, count };
  }
  const mask = new Uint8Array(N), b = cut.base, [nx, ny, nz] = cut.n, [ox, oy, oz] = cut.o, lo = cut.lo, hi = cut.hi;
  let count = 0;
  for await (const ch of layerPositions(L, slabBbox(cut))) {
    const { x, y, z, recs, base, count: c } = ch;
    for (let i = 0; i < c; i++) {
      const r = recs ? recs[i] : base + i;
      if (r >= N || (b && !b[r])) continue;
      const t = nx * (x[i] - ox) + ny * (y[i] - oy) + nz * (z[i] - oz);
      if (t > lo && t <= hi && !mask[r]) { mask[r] = 1; count++; }
    }
  }
  return { mask, count };
}

const attrCount = (L) => attrRowCountOf(L) || 0;
