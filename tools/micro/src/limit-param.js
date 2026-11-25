// micro — the polygon LIMIT as a tool setting: its shape, its schema entry, its check. Zero
// imports, so the tool schemas (src/tools.js, read at load) can take it without joining the
// import group src/polylimit.js lives in. The behaviour is src/polylimit.js.
//
//   limit: { layer, feature?, where?, selected? }  (a bare string = { layer })

// a limit as the tools take it: null (none), or { layer, feature?, where?, selected? }
export function normLimit(v) {
  if (v == null || v === '' || v === false) return null;
  if (typeof v === 'string') return { layer: v };
  if (typeof v !== 'object' || !v.layer) return null;
  const o = { layer: String(v.layer) };
  if (v.feature != null && v.feature !== '') o.feature = v.feature;
  if (v.where != null && String(v.where).trim()) o.where = String(v.where).trim();
  if (v.selected) o.selected = true;
  return o;
}

// the schema entry every tool that takes a limit carries (src/tools.js checks type 'limit')
export const LIMIT_PARAM = { type: 'limit', doc: 'only what lies inside these polygons in plan: { layer, feature?, where? } — layer: a strings & polygons layer; feature: one feature by its id or any attribute value; where: an expression over the polygon attributes. Records by their plan x/y (a block by its centroid); grid nodes by the share of their cell inside (exact)' };

// the shape check src/tools.js runs for type 'limit'
export function checkLimitValue(v, path, errs, { routine = false } = {}) {
  if (typeof v === 'string') return;
  if (!v || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${path}: a map { layer, feature?, where? }, got ${JSON.stringify(v)}`); return; }
  for (const k of Object.keys(v)) if (!['layer', 'feature', 'where', 'selected'].includes(k)) errs.push(`${path}: no setting “${k}” (settings: layer, feature, where)`);
  if (typeof v.layer !== 'string' || !v.layer) errs.push(`${path}.layer: the polygon layer's name`);
  if (v.where != null && typeof v.where !== 'string') errs.push(`${path}.where: an expression`);
  if (v.feature != null && typeof v.feature !== 'string' && typeof v.feature !== 'number') errs.push(`${path}.feature: a feature id or attribute value`);
  if (routine && v.selected) errs.push(`${path}.selected: a routine can't use the 3D selection (it isn't saved with the routine) — name the feature, or use where`);
}
