// micro — what a column IS: its type override, its detection-limit policy (and the
// re-read a policy change needs), and making it the layer's category column. The
// columns tab of the Properties panel offers them (src/props.js).
import { layerTableHeader, qualifyPolicy } from './records.js';
import { microPrompt } from './prompts.js';
import { S, requestRender, layerById } from './state.js';
import { setColorLabels, ensureValueTex } from './color.js';
import { markProjectDirty } from './project.js';
import { renderProps, refreshProps } from './props.js';
import { pinEvictLayer } from './columns.js';
import { reopenDh } from './drillholes.js';
import { reopenBlockChan } from './open-blocks.js';
import { refilterLayer } from './filter.js';
import { applyRamp } from './ramp.js';
import { followLayer } from './tree.js';
import { reopenWithMapping } from './reopen.js';
const $ = (s) => document.querySelector(s);

// type override = a MUTATION of the layer's derived schema, so every consumer
// (filter schema, color-by options) agrees without new plumbing
export function setColType(L, i, ty) {
  const h = layerTableHeader(L); if (!h) return;
  const name = h.columns[i];
  L.colTypes = L.colTypes || {};
  L.colTypes[name] = ty;
  const at = (h.numericColumns || (h.numericColumns = [])).findIndex((c) => c.i === i);
  if (ty === 'number' && at < 0) { h.numericColumns.push({ i, name }); h.numericColumns.sort((a, b) => a.i - b.i); }
  if (ty === 'string' && at >= 0) h.numericColumns.splice(at, 1);
  L._colStats = null; L._qualFn = undefined;               // the kind changed — stale
  if (L.id === S.activeId) { const keep = $('#colorBy').value; setColorLabels(h); if ([...$('#colorBy').options].some((o) => o.value === keep)) $('#colorBy').value = keep; }
  markProjectDirty();
  renderProps();
}
// ── a numeric column's detection-limit policy (CSV / drillholes). Values are
// substituted at the read, so a change invalidates everything derived from a
// read: column stats, pinned columns, the band index, the filter mask — and the
// colour channel, which the open parsed (a re-read, like a channel switch). ──
const QUALIFY_BELOW = [['half', '<x → x/2 (half the limit)'], ['limit', '<x → x (the limit)'], ['zero', '<x → 0'], ['blank', '<x → blank']];
export function qualifyMenuItems(L, i) {
  const h = layerTableHeader(L), name = h.columns[i], p = qualifyPolicy(L, name);
  return [
    ...QUALIFY_BELOW.map(([k, label]) => ({ label: ((p.below || 'half') === k ? '✓ ' : '') + label, action: () => setColumnQualify(L, i, { ...p, below: k }) })),
    { sep: true },
    { label: (p.above !== 'blank' ? '✓ ' : '') + '>x → x (the limit)', action: () => setColumnQualify(L, i, { ...p, above: 'limit' }) },
    { label: (p.above === 'blank' ? '✓ ' : '') + '>x → blank', action: () => setColumnQualify(L, i, { ...p, above: 'blank' }) },
    { sep: true },
    { label: (p.negBelow ? '✓ ' : '') + 'Negative = below detection (−0.001 → <0.001)', action: () => setColumnQualify(L, i, { ...p, negBelow: !p.negBelow }) },
    { sep: true },
    // a sentinel (−99, −999) is a real number until something says it means "no data"
    { label: `Values that mean blank…${p.blanks && p.blanks.length ? ` (${p.blanks.join(', ')})` : ''}`, action: async () => {
      const v = await microPrompt(`values in ${name} that mean "no data" (comma-separated, e.g. -99, -999)`, (p.blanks || []).join(', '));
      if (v == null) return;
      const arr = String(v).split(/[,;\s]+/).map(Number).filter(Number.isFinite);
      setColumnQualify(L, i, { ...p, blanks: arr.length ? arr : null });
    } },
  ];
}
export async function setColumnQualify(L, i, policy) {
  const h = layerTableHeader(L); if (!h) return null;
  const name = h.columns[i];
  const pol = { below: policy.below || 'half', above: policy.above === 'blank' ? 'blank' : 'limit', negBelow: !!policy.negBelow };
  if (policy.blanks && policy.blanks.length) pol.blanks = [...new Set(policy.blanks.map(Number).filter(Number.isFinite))];
  L.qualify = { ...(L.qualify || {}) };
  if (pol.below === 'half' && pol.above === 'limit' && !pol.negBelow && !pol.blanks) delete L.qualify[name];   // the default isn't stored
  else L.qualify[name] = pol;
  if (!Object.keys(L.qualify).length) L.qualify = null;
  markProjectDirty();
  return refreshQualified(L, h.mapping && h.mapping.chan === i);
}
// drop everything derived from a read; re-read when the colour channel changed
async function refreshQualified(L, rechan) {
  L._qualFn = undefined; L._colStats = null; L._bands = null;
  pinEvictLayer(L.id);
  const d = L.docs || {};
  if (rechan && d.dhDoc) { L = (await reopenDh(L, { qualify: L.qualify || null })) || L; }
  else if (rechan && d.blockDoc && !d.blockDoc.header.dm && !d.blockDoc.parquet) { await reopenBlockChan(d.blockDoc, d.blockDoc.header.mapping.chan, { layer: L.id }); await refilterLayer(L); applyRamp(L, true); }
  else await refilterLayer(L);
  if (L.docs && (L.docs.blockDoc || L.docs.dhDoc)) await ensureValueTex(L);
  refreshProps();
  requestRender();
  return L.id;
}
// project load: a stored policy on the colour channel means the open coloured by
// the default — re-read those layers once they're all in
export const _qualifyReopen = [];
export async function settleQualifyReopens() {
  const ids = _qualifyReopen.splice(0);
  for (const id of ids) {
    const L = layerById(followLayer(id)); if (!L) continue;
    const h = layerTableHeader(L), ch = h && h.mapping ? h.mapping.chan : null;
    const chName = ch != null ? h.columns[ch] : null;
    await refreshQualified(L, !!(chName && L.qualify && L.qualify[chName]));
  }
}
// re-key the class column: the same re-open machinery as re-channeling
export async function useAsCategory(L, i) {
  if (L.dh && L.docs.dhDoc) return reopenDh(L, { cat: i }, { clearCats: true });
  return reopenWithMapping(L, { cat: i }, { clearCats: true });
}
