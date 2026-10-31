// @gcu/scan zones — the keep(z) a delimited source reads by. ZONE MAPS
// (condenser io/zones.js) are per-index-entry statistics from the open: numeric
// min / max / blank, category value sets. keep(z) → false when zone z can hold
// nothing the scan wants:
//   ast   — a predicate its statistics rule out (expr canMatch over the ranges
//           of `names`: the columns whose statistics still apply — the caller
//           leaves out a column the schema has retyped since);
//   bbox  — [x0, y0, z0, x1, y1, z1] it doesn't touch (by `coords`, the x/y/z
//           column names);
//   mask  — a per-record scope with nothing set in it.
// D = { expr, condenser }.
export function zoneKeep(D, zs, { ast = null, names = [], bbox = null, coords = null, mask = null } = {}) {
  if (!zs || !(ast || bbox || mask)) return null;
  const k = zs.k;
  const cx = coords && zs.num[coords[0]], cy = coords && zs.num[coords[1]], cz = coords && zs.num[coords[2]];
  return (z) => {
    if (mask) {
      let any = false;
      for (let i = z * k, e = Math.min(mask.length, (z + 1) * k); i < e; i++) if (mask[i]) { any = true; break; }
      if (!any) return false;
    }
    if (bbox && cx && cy && cz && cx.min[z] <= cx.max[z]) {
      if (cx.max[z] < bbox[0] || cx.min[z] > bbox[3] || cy.max[z] < bbox[1] || cy.min[z] > bbox[4] || cz.max[z] < bbox[2] || cz.min[z] > bbox[5]) return false;
    }
    if (ast && names.length && !D.expr.canMatch(ast, D.condenser.zoneRanges(zs, z, z, names))) return false;
    return true;
  };
}
