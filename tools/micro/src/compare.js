// micro — MODEL VERSION COMPARISON: two versions of a block model (last month's estimate and this
// month's, a re-domained one, a re-run with new samples) → what changed, on one page.
//
//   compareModels(p)          the numbers: per group (domain × class) and cutoff, old vs new tonnes /
//                             grade / metal with Δ and Δ%; per bench at the lowest cutoff; the
//                             groups and benches with the largest |Δ metal|; and — when p.map —
//                             the reconcile Δ layer (new − old on the common lattice) with a `change`
//                             category per block: added · removed · changed · unchanged
//   buildComparisonReport(p)  the composer page: the comparison table (↻ refresh computes it again),
//                             a map of the changed blocks (plan, and optionally a section), the
//                             biggest moves as live {cmp:…} fields, both models' lineage
//   comparemodels             the routine tool (tools.js): the same numbers as values a check reads —
//                             `abs(cmp.delta_metal_pct) < 5`
//
// The table needs no common lattice (each side is summed on its own blocks, with the block-support
// volume rule every tool uses); the Δ map does, and is refused with the compatibility check's own
// reason. A sub-blocked side against a regular one is mapped at the regular side's (parent)
// resolution, as reconcile does.
import { S } from './state.js';
import { layerTableHeader, schemaExt, layerRecords, numOf, layerBlob, attrRowCountOf, layerWorldBox } from './records.js';
import { ensureStoredValues } from './columns.js';
import { volumeContextOf, volumeAt, metalFactorOf, numericColsOf, parseFactor } from './analysis.js';
import { gridAxesOf } from './grid-ops.js';
import { gridsCompatible, makeBoxAggregator, coordNum } from '../../../ext/condenser/src/main.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
import { reconcileModels } from './joins.js';
import { openComposer, addViewFrame, legendContentFor, currentFigure, composerCamera as setCameraWorld } from './composer.js';
import { captureScene, applyScene } from './views.js';
import { setSectionWorld } from './section.js';
import { floatWin } from './windows.js';
import { registerCommands, contributeMenu } from './commands.js';
import { sourceHash } from './identity.js';
import { LINEAGE_LABEL, lineageSummary } from './lineage-ui.js';
import { fmtSize } from './paths.js';
import { groupDigits, significant, subjectFrame } from '../../../ext/compo/index.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => L.label || L.name;
const short = (L) => nameOf(L).replace(/\.[^.]+$/, '');
const layerNamed = (name) => {
  const L = S.layers.find((x) => x.name === name) || S.layers.find((x) => nameOf(x) === name);
  if (!L) throw new Error(`layer “${name}” isn't loaded`);
  return L;
};
const isSub = (L) => !!(layerTableHeader(L) || {}).subBlocked;
// the block models a comparison can take: a block grid (not a model opened as points), not a view
export const comparableLayers = () => S.layers.filter((L) => L.docs && L.docs.blockDoc && gridAxesOf(L) && L.viewOf == null);

// ── can the two be MAPPED against each other (the Δ map needs a common lattice) ──
// → { ok, reason?, how }: how = 'same' (one lattice) · 'common' (compatible lattices, compared on the
// finest common one) · 'parent' (a sub-blocked side aggregated onto the regular side's blocks)
export function compareCompat(O, N) {
  const go = gridAxesOf(O), gn = gridAxesOf(N);
  if (!go || !gn) return { ok: false, reason: `${nameOf(go ? N : O)} has no block grid (a model opened as points) — reopen it as a block model` };
  const so = isSub(O), sn = isSub(N);
  if (so !== sn) {
    const R = makeBoxAggregator(so ? gn : go, { source: so ? go : gn });
    return R.ok ? { ok: true, how: 'parent' } : { ok: false, reason: R.reason };
  }
  const c = gridsCompatible(go, gn);
  if (!c.ok) return { ok: false, reason: c.reason };
  const same = ['x', 'y', 'z'].every((a) => Math.abs(go[a].pitch - gn[a].pitch) < 1e-9 * Math.max(1, Math.abs(go[a].pitch)));
  return { ok: true, how: same ? 'same' : 'common' };
}

// ── one side: tonnes and grade·tonnes per (cutoff, group), and per bench at the lowest cutoff ──
// The same arithmetic as the resource table (analysis.js computeResourceTable): a block's tonnes =
// its support volume × density × the density unit's factor; a blank grade is no block.
async function scanSide(L, { grade, density, groupBy, cutoffs, bench }, onProgress) {
  const dens = density || {};
  await ensureStoredValues(L, new Set([grade, dens.col, ...groupBy].filter(Boolean).map((x) => String(x).toLowerCase())));
  const h = layerTableHeader(L), schema = schemaExt(L, h), at = (nm) => schema.findIndex((c) => c.name === nm || c.name.toLowerCase() === String(nm).toLowerCase());
  const gi = at(grade); if (gi < 0) throw new Error(`compare: no grade column “${grade}” on ${nameOf(L)}`);
  const di = dens.col ? at(dens.col) : -1; if (dens.col && di < 0) throw new Error(`compare: no density column “${dens.col}” on ${nameOf(L)}`);
  const ki = groupBy.map((c) => { const i = at(c); if (i < 0) throw new Error(`compare: no column “${c}” on ${nameOf(L)}`); return i; });
  const zi = h.mapping ? h.mapping.z : -1;
  const dScale = dens.unit ? unitConvert(1, dens.unit, 't/m3') : 1, dConst = dens.const != null && Number.isFinite(+dens.const) ? +dens.const : 1;
  const vc = volumeContextOf(L);
  const groups = new Map(), benches = new Map();             // "cutoff|g1|g2" → { t, tg } · bench index → { t, tg }
  let rc = 0, blocks = 0;
  for await (const { f } of layerRecords(L)) {
    rc++;
    if ((rc & 0xffff) === 0) { if (onProgress) onProgress(rc); await new Promise((r) => setTimeout(r)); }
    const g = numOf(f[gi]); if (!Number.isFinite(g)) continue;
    const t = volumeAt(vc, f) * (di >= 0 ? (+f[di] || 0) : dConst) * dScale;
    if (!(t > 0)) continue;
    blocks++;
    const key = ki.map((i) => { const v = f[i]; return v == null || v === '' ? '—' : String(v); }).join('|');
    for (const c of cutoffs) {
      if (g < c) break;
      const k = c + '|' + key; let a = groups.get(k); if (!a) groups.set(k, (a = { t: 0, tg: 0 }));
      a.t += t; a.tg += t * g;
    }
    if (bench && zi >= 0 && g >= cutoffs[0]) {
      const z = coordNum(f[zi]);
      if (Number.isFinite(z)) { const b = Math.floor((z - bench.z0) / bench.h + 1e-9); let a = benches.get(b); if (!a) benches.set(b, (a = { t: 0, tg: 0 })); a.t += t; a.tg += t * g; }
    }
  }
  return { groups, benches, records: rc, blocks };
}

const pct = (d, o) => (o !== 0 && Number.isFinite(o) && Number.isFinite(d) ? (100 * d) / o : NaN);
const sideOf = (a, mf) => (a ? { t: a.t, g: a.t > 0 ? a.tg / a.t : NaN, m: a.tg * mf } : { t: 0, g: NaN, m: 0 });
const deltaOf = (o, n) => ({ old: o, new: n, dt: n.t - o.t, dtp: pct(n.t - o.t, o.t), dg: n.g - o.g, dgp: pct(n.g - o.g, o.g), dm: n.m - o.m, dmp: pct(n.m - o.m, o.m) });

// the comparison's parameters, normalised: defaults filled, cutoffs sorted, the bench height chosen
function normalize(p) {
  const O = layerNamed(p.old), N = layerNamed(p.new);
  const cutoffs = (Array.isArray(p.cutoffs) && p.cutoffs.length ? p.cutoffs : [0]).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!cutoffs.length) throw new Error('compare: at least one cutoff');
  const groupBy = (p.groupBy || []).filter(Boolean).slice(0, 2);
  // benches: horizontal slices of the bench height (default the z pitch of the regular side, else the
  // old model's), counted from its lattice's lower face so a regular model's bench is one block level
  const ref = isSub(O) && !isSub(N) ? N : O, ga = gridAxesOf(ref);
  const h = +p.benchHeight > 0 ? +p.benchHeight : ga ? Math.abs(ga.z.pitch) || 1 : 1;
  const z0 = ga && !ga.rot ? ga.z.origin - Math.abs(ga.z.pitch) / 2 : 0;
  return { O, N, cutoffs, groupBy, gradeOld: p.gradeOld || p.grade, gradeNew: p.grade, bench: { z0, h }, mf: metalFactorOf(p) };
}

// → { params, cutoffs, groupBy, rows: [{ cutoff, key: [..], ...delta }], totals: { [cutoff]: delta },
//     benches: [{ z, ...delta }], moves: { groups, benches }, blocks: { added, removed, changed, … } | null,
//     mapLayer, old: {..}, new: {..}, mf, metalUnit }
export async function compareModels(p, { onProgress = null } = {}) {
  if (!p || !p.old || !p.new) throw new Error('compare: which two models? (old, new)');
  if (!p.grade) throw new Error('compare: which grade column?');
  const P = normalize(p), { O, N, cutoffs, groupBy } = P;
  if (O === N) throw new Error('compare: the old and the new model are the same layer');
  const mf = P.mf.mf;
  const so = await scanSide(O, { grade: P.gradeOld, density: p.densityOld || p.density, groupBy, cutoffs, bench: P.bench }, onProgress);
  const sn = await scanSide(N, { grade: P.gradeNew, density: p.density, groupBy, cutoffs, bench: P.bench }, onProgress);
  const rows = [], totals = {};
  for (const c of cutoffs) {
    const pre = c + '|', keys = new Set();
    for (const m of [so.groups, sn.groups]) for (const k of m.keys()) if (k.startsWith(pre)) keys.add(k.slice(pre.length));
    let to = { t: 0, tg: 0 }, tn = { t: 0, tg: 0 };
    for (const k of [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const ao = so.groups.get(pre + k), an = sn.groups.get(pre + k);
      if (ao) { to.t += ao.t; to.tg += ao.tg; } if (an) { tn.t += an.t; tn.tg += an.tg; }
      rows.push({ cutoff: c, key: groupBy.length ? k.split('|') : [], ...deltaOf(sideOf(ao, mf), sideOf(an, mf)) });
    }
    totals[c] = deltaOf(sideOf(to, mf), sideOf(tn, mf));
  }
  const benches = [...new Set([...so.benches.keys(), ...sn.benches.keys()])].sort((a, b) => a - b)
    .map((b) => ({ z: +(P.bench.z0 + (b + 0.5) * P.bench.h).toPrecision(10), ...deltaOf(sideOf(so.benches.get(b), mf), sideOf(sn.benches.get(b), mf)) }));
  const big = (list) => list.filter((r) => r.dm !== 0 && Number.isFinite(r.dm)).sort((a, b) => Math.abs(b.dm) - Math.abs(a.dm)).slice(0, 5);
  const moves = { groups: groupBy.length ? big(rows.filter((r) => r.cutoff === cutoffs[0])) : [], benches: big(benches) };
  // the Δ map: reconcile new − old with the change category (a re-run replaces its own layer)
  let blocks = null, mapLayer = null;
  if (p.map !== false) {
    const c = compareCompat(O, N);
    if (!c.ok) throw new Error(`compare: no Δ map — ${c.reason} (map: false compares the tables alone)`);
    const name = p.mapName || `compare_${short(N)}_vs_${short(O)}.csv`.replace(/[\\/:*?"<>|]+/g, '_');
    const r = await reconcileModels(N, O, { weights: {}, useSel: false }, P.gradeNew, { replace: true, refGrade: P.gradeOld, change: true, tol: +p.tolerance > 0 ? +p.tolerance : 0, name });
    if (!r) throw new Error('compare: the Δ map was not made');
    mapLayer = r.name;
    const changed = r.changed || 0;
    blocks = { added: r.thisOnly || 0, removed: r.refOnly || 0, changed, unchanged: (r.matched || 0) - changed, matched: r.matched || 0, meanDelta: r.meanDelta, meanAbsDelta: r.meanAbsDelta, how: c.how };
  }
  return {
    params: { ...p }, cutoffs, groupBy, rows, totals, benches, moves, blocks, mapLayer, mf, metalUnit: P.mf.unit,
    gradeOld: P.gradeOld, gradeNew: P.gradeNew, bench: P.bench,
    old: { layer: O.name, label: nameOf(O), records: so.records, blocks: so.blocks }, new: { layer: N.name, label: nameOf(N), records: sn.records, blocks: sn.blocks },
  };
}

// ── as numbers a routine check reads (the lowest cutoff's totals) ──
const num = (v) => (Number.isFinite(v) ? v : NaN);
export function compareValues(r) {
  const t = r.totals[r.cutoffs[0]];
  const v = {
    old_tonnes: t.old.t, new_tonnes: t.new.t, delta_tonnes: t.dt, delta_tonnes_pct: num(t.dtp),
    old_grade: num(t.old.g), new_grade: num(t.new.g), delta_grade: num(t.dg), delta_grade_pct: num(t.dgp),
    old_metal: t.old.m, new_metal: t.new.m, delta_metal: t.dm, delta_metal_pct: num(t.dmp),
    groups: new Set(r.rows.map((x) => x.key.join('|'))).size, benches: r.benches.length,
    max_group_delta_metal: r.moves.groups.length ? r.moves.groups[0].dm : 0, max_bench_delta_metal: r.moves.benches.length ? r.moves.benches[0].dm : 0,
  };
  if (r.blocks) Object.assign(v, { added: r.blocks.added, removed: r.blocks.removed, changed: r.blocks.changed, unchanged: r.blocks.unchanged, matched: r.blocks.matched, mean_delta_grade: num(r.blocks.meanDelta) });
  return v;
}
// the machine table: one row per cutoff × group (no totals — they're the sum of their cutoff's rows)
export function compareTable(r, p = r.params) {
  const g = r.groupBy;
  return {
    columns: ['cutoff', ...g, 'old_tonnes', 'new_tonnes', 'delta_tonnes', 'delta_tonnes_pct', 'old_grade', 'new_grade', 'delta_grade', 'delta_grade_pct', 'old_metal', 'new_metal', 'delta_metal', 'delta_metal_pct'],
    key: ['cutoff', ...g],
    rows: r.rows.map((x) => [x.cutoff, ...x.key, x.old.t, x.new.t, x.dt, num(x.dtp), num(x.old.g), num(x.new.g), num(x.dg), num(x.dgp), x.old.m, x.new.m, x.dm, num(x.dmp)]),
    units: { old_tonnes: 't', new_tonnes: 't', delta_tonnes: 't', delta_tonnes_pct: '%', old_grade: p.gradeUnit || '', new_grade: p.gradeUnit || '', delta_grade: p.gradeUnit || '', delta_grade_pct: '%', old_metal: r.metalUnit, new_metal: r.metalUnit, delta_metal: r.metalUnit, delta_metal_pct: '%' },
  };
}

// ── as a page: the composer's table content, and the values its {cmp:…} fields read ──
const grp = (v) => (Number.isFinite(v) ? groupDigits(Math.round(v)).replace(/^-/, '−') : '—');
const sig = (v, k = 4) => (Number.isFinite(v) ? String(significant(v, k)).replace(/^-/, '−') : '—');
const sgn = (v, s) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '' : '±') + s : '—');
const pctTxt = (v) => (Number.isFinite(v) ? sgn(v, `${v.toFixed(1)} %`).replace(/^-/, '−') : '—');
const metalTxt = (v) => (Math.abs(v) >= 1000 ? grp(v) : sig(v));
const dMetalTxt = (v) => (Number.isFinite(v) ? sgn(v, metalTxt(v)) : '—');
function moveText(x, label, mu) {
  const m = `Δ metal ${dMetalTxt(x.dm)}${mu ? ' ' + mu : ''}`;
  if (!(x.old.t > 0)) return `${label}: ${m} — new (only in the new model)`;
  if (!(x.new.t > 0)) return `${label}: ${m} — gone (only in the old model)`;
  return `${label}: ${m} (${pctTxt(x.dmp)}) · tonnes ${pctTxt(x.dtp)} · grade ${pctTxt(x.dgp)}`;
}
export function compareContent(r, p = r.params) {
  const g = r.groupBy, mu = r.metalUnit, gu = p.gradeUnit ? ` (${p.gradeUnit})` : '';
  const columns = ['cutoff', ...g, 't old', 't new', 'Δ t %', `grade old${gu}`, `grade new${gu}`, 'Δ grade %', `metal old${mu ? ` (${mu})` : ''}`, 'metal new', 'Δ metal', 'Δ metal %'];
  const line = (c, key, x) => [String(c), ...key, grp(x.old.t), grp(x.new.t), pctTxt(x.dtp), sig(x.old.g), sig(x.new.g), pctTxt(x.dgp), metalTxt(x.old.m), metalTxt(x.new.m), dMetalTxt(x.dm), pctTxt(x.dmp)];
  const rows = [];
  for (const c of r.cutoffs) {
    const rs = r.rows.filter((x) => x.cutoff === c);
    for (const x of rs) rows.push(line(c, x.key, x));
    if (g.length && rs.length > 1) rows.push(line(c, ['total', ...g.slice(1).map(() => '')], r.totals[c]));
  }
  const d = p.density || {};
  const dens = d.col ? `density ${d.col}` : `density ${d.const != null ? d.const : 1}${d.unit ? ' ' + d.unit : ' t/m³'}`;
  const t0 = r.totals[r.cutoffs[0]], v = compareValues(r);
  const values = {
    ...v, old: r.old.label, new: r.new.label, grade: r.gradeNew === r.gradeOld ? r.gradeNew : `${r.gradeOld} → ${r.gradeNew}`, cutoff: r.cutoffs[0], cutoffs: r.cutoffs.join(', '),
    metal_unit: mu || '', map: r.mapLayer || '',
    summary: `metal ${pctTxt(t0.dmp)} (${dMetalTxt(t0.dm)}${mu ? ' ' + mu : ''}) · tonnes ${pctTxt(t0.dtp)} · grade ${pctTxt(t0.dgp)}`,
    blocks: r.blocks ? `${r.blocks.added.toLocaleString('en-US')} added · ${r.blocks.removed.toLocaleString('en-US')} removed · ${r.blocks.changed.toLocaleString('en-US')} changed · ${r.blocks.unchanged.toLocaleString('en-US')} unchanged` : 'no Δ map',
  };
  r.moves.groups.forEach((x, i) => { values['group' + (i + 1)] = moveText(x, x.key.join(' · '), mu); });
  r.moves.benches.forEach((x, i) => { values['bench' + (i + 1)] = moveText(x, `bench ${sig(x.z, 6)}`, mu); });
  return {
    title: `${r.new.label} vs ${r.old.label} — ${r.gradeNew}`, columns, rows, values,
    note: `Δ = new − old · Δ% of old · ${dens}${r.mf !== 1 ? ` · metal = t × grade × ${sig(r.mf, 6)}` : ''} · ${r.old.blocks.toLocaleString('en-US')} → ${r.new.blocks.toLocaleString('en-US')} blocks`,
  };
}

// ── {cmp:key}: a value of the comparison table on the page (the nearest, or {cmp:key@id}) ──
const isCompare = (f) => !!(f.source && f.source.kind === 'compare');
export function compareField(a, frame, env) {
  if (!a) return '⟨which value? {cmp:delta_metal_pct}⟩';
  const t = subjectFrame(env, frame, isCompare), v = t && t.content && t.content.values;
  if (!v) return '⟨no comparison table on the page⟩';
  return Object.prototype.hasOwnProperty.call(v, a) ? v[a] : null;
}

// ── both models' lineage, as text: the file, its content hash and date, and how each was made ──
const when = (t) => { if (!t) return ''; const d = new Date(t), p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export async function lineageMd(p) {
  const out = ['**Lineage**'];
  for (const [role, nm] of [['old', p.old], ['new', p.new]]) {
    const L = S.layers.find((x) => x.name === nm || nameOf(x) === nm);
    out.push('', `**${role}** · ${L ? nameOf(L) : nm}`);
    if (!L) { out.push('not loaded'); continue; }
    const blob = layerBlob(L);
    if (blob) {
      let sha = null; try { sha = await sourceHash(blob); } catch { /* unreadable */ }
      out.push(`${blob.name || L.name} · ${fmtSize(blob.size || 0)}${sha ? ` · ${String(sha).replace(/^[^:]*:/, '').slice(0, 12)}` : ''}${blob.lastModified ? ` · ${when(blob.lastModified)}` : ''}`);
    }
    out.push(`${(attrRowCountOf(L) || 0).toLocaleString('en-US')} records`);
    const walk = (lin, depth) => {
      if (!lin || out.length > 40) return;
      out.push(`${'  '.repeat(depth)}${depth ? '└ ' : ''}${LINEAGE_LABEL[lin.op] || lin.op}${lineageSummary(lin) ? ' — ' + lineageSummary(lin) : ''}${lin.at ? ` (${when(lin.at)})` : ''}`);
      for (const s of lin.sources || []) walk(s, depth + 1);
    };
    walk(L.lineage, 0);
  }
  return out.join('\n');
}

// ── the map: the Δ layer alone, its unchanged blocks filtered out, from above (and in section) ──
const MAP_FILTER = 'change != "unchanged"';
// the change classes carry meaning, so their colours are fixed (added green, removed red, changed amber,
// unchanged grey) — set once; a legend the user has restyled is left alone
const CHANGE_COLORS = [['added', '#3a9a4b'], ['removed', '#c8413b'], ['changed', '#e0a32e'], ['unchanged', '#8d9399']];
function changeLegend(J) {
  if (J.catLegend && J.catLegend.col === 'change') return;
  J.catLegend = { col: 'change', entries: CHANGE_COLORS.map(([v, color]) => ({ label: v, values: [v], color })), otherColor: '#555a5f' };
}
async function mapScene(J, { color = 'delta', section = false, aspect = 1 } = {}) {
  changeLegend(J);
  const sc = captureScene('compare map');
  for (const sl of sc.layers) sl.visible = sl.name === J.name;
  const sl = sc.layers.find((q) => q.name === J.name);
  if (sl) { sl.filter = MAP_FILTER; sl.color = color === 'change' ? 'change' : (layerTableHeader(J).columns.find((c) => c.startsWith('Δ')) || sl.color); delete sl.colorSel; }
  await applyScene(sc);
  const bx = layerWorldBox(J), ga = gridAxesOf(J);
  const half = ga ? [ga.x.pitch / 2, ga.y.pitch / 2, ga.z.pitch / 2].map(Math.abs) : [0, 0, 0];
  const lo = bx[0].map((v, k) => v - half[k]), hi = bx[1].map((v, k) => v + half[k]);
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2), d = [0, 1, 2].map((k) => hi[k] - lo[k]);
  const fov = S.cam.state.fovY;
  if (!section) {
    setSectionWorld(null);
    const halfH = Math.max(d[1] / 2, d[0] / 2 / aspect) * 1.08;
    setCameraWorld({ look: 0, elevation: 90, ortho: true, target: c, distance: halfH / Math.tan(fov / 2) });
  } else {                                                  // an E–W section through the middle row of blocks, looking north
    const zx = S.cam.state.zExag || 1, halfH = Math.max((d[2] * zx) / 2, d[0] / 2 / aspect) * 1.12;
    const y = ga && !ga.rot ? ga.y.origin + Math.round((c[1] - ga.y.origin) / ga.y.pitch) * ga.y.pitch : c[1];
    setCameraWorld({ look: 0, elevation: 0, ortho: true, target: c, distance: halfH / Math.tan(fov / 2) });
    setSectionWorld({ axis: 'y', position: y, thickness: ga ? Math.abs(ga.y.pitch) * 0.9 : Math.max(1, d[1] / 20) });
  }
}

// ── the page ──
export async function buildComparisonReport(p, { name = null, result = null } = {}) {
  const r = result || await compareModels(p);
  let nm = name || `${r.new.label.replace(/\.[^.]+$/, '')} vs ${r.old.label.replace(/\.[^.]+$/, '')}`;
  if (S.figures.some((f) => f.name === nm)) { let k = 2; while (S.figures.some((f) => f.name === `${nm} (${k})`)) k++; nm = `${nm} (${k})`; }
  const ed = openComposer(nm), doc = ed.getDoc();
  doc.page = { ...doc.page, size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] };
  const W = 297, H = 210, m = 12, iw = W - 2 * m;
  const content = compareContent(r, p);
  ed.addFrame({ kind: 'text', box: [m, m, iw, 12], content: { md: '**Model comparison — {cmp:new} vs {cmp:old}**\n{cmp:grade} · cutoffs {cmp:cutoffs} · {date:D MMMM YYYY}', size: 11 }, source: { app: 'micro', kind: 'compare-title' } });
  const th = Math.min(100, +(9 + 4.2 * (content.rows.length + 2.5)).toFixed(1));
  const tf = ed.addFrame({ kind: 'table', box: [m, m + 14, iw, th], content, source: { app: 'micro', kind: 'compare', name: content.title, params: { ...p } } });
  const y0 = m + 14 + th + 4, hb = H - m - y0;
  const wv = 112, xm = m + wv + 5, wm = 78, xl = xm + wm + 5, wl = W - m - xl;
  // the biggest moves, live: they read the table's values, so ↻ refresh rewrites them
  const nG = Math.min(3, r.moves.groups.length), nB = Math.min(3, r.moves.benches.length);
  const mv = ['**Biggest moves** (|Δ metal|, cutoff {cmp:cutoff})', '**overall** {cmp:summary}', '**blocks** {cmp:blocks}'];
  if (r.groupBy.length) mv.push('', `**by ${r.groupBy.join(' × ')}**`, ...Array.from({ length: Math.max(1, nG) }, (_, i) => `${i + 1}. {cmp:group${i + 1}}`));
  mv.push('', '**by bench**', ...Array.from({ length: Math.max(1, nB) }, (_, i) => `${i + 1}. {cmp:bench${i + 1}}`));
  ed.addFrame({ kind: 'text', box: [xm, y0, wm, hb * 0.66], content: { md: mv.join('\n'), size: 7.5 }, source: { app: 'micro', kind: 'compare-moves' } });
  ed.addFrame({ kind: 'text', box: [xl, y0, wl, hb], content: { md: await lineageMd(p), size: 7 }, source: { app: 'micro', kind: 'compare-lineage', params: { old: p.old, new: p.new } } });
  // the Δ map (+ its legend): the Δ layer's own scene, the user's view back after
  const J = r.mapLayer ? S.layers.find((x) => x.name === r.mapLayer) : null;
  const views = [];
  if (J) {
    const mine = captureScene('__compare');
    try {
      const yv = y0 + 6, hv = hb - 6;                        // the map's title sits above it, not on the render
      const boxes = p.section ? [[m, yv, wv, (hv - 3) / 2], [m, yv + (hv - 3) / 2 + 3, wv, (hv - 3) / 2]] : [[m, yv, wv, hv]];
      for (let i = 0; i < boxes.length; i++) {
        await mapScene(J, { color: p.mapColor || 'delta', section: i === 1, aspect: boxes[i][2] / boxes[i][3] });
        const f = addViewFrame(ed, { box: boxes[i], border: true, bg: '#ffffff' });   // a report's map on paper, whatever the 3D view's background
        if (f) views.push(f);
      }
      const lc = legendContentFor(J);
      if (lc) ed.addFrame({ kind: 'legend', box: [xm, y0 + hb * 0.66 + 2, 42, Math.min(hb * 0.34 - 2, lc.kind === 'ramp' ? 30 : 7 + 4.4 * (lc.entries.length + 1))], content: lc, source: { app: 'micro', kind: 'legend', layer: J.name } });
    } finally { await applyScene(mine); }
    ed.addFrame({ kind: 'text', box: [m, y0, wv, 5], content: { md: `**Changed blocks** — ${(p.mapColor || 'delta') === 'change' ? 'added / removed / changed' : `Δ ${r.gradeNew} (new − old)`}${p.section ? ' · plan, E–W section' : ' · plan'}`, size: 7 }, source: { app: 'micro', kind: 'compare-maptitle' } });
  }
  ed.render();
  $('#meta').textContent = `compare: “${nm}” — ${content.rows.length} table rows, metal ${content.values.summary}${r.blocks ? ` · ${content.values.blocks}` : ''}`;
  return { figure: currentFigure(), table: tf, views, result: r };
}
// make the comparison again for a refresh (the composer's ↻): the table's content, the Δ layer again
export async function refreshCompareFrame(f) {
  const r = await compareModels(f.source.params);
  return compareContent(r, f.source.params);
}

// ── the dialog: Compare model versions… (a layer's Analyse menu, the palette, Tools, a new figure) ──
export function openCompareDialog({ newLayer = null, name = null } = {}) {
  const cands = comparableLayers();
  if (cands.length < 2) { $('#meta').textContent = 'compare: open two versions of a block model first'; return null; }
  const w = floatWin({ title: 'compare model versions', sub: 'old vs new — one page', x: 150, y: 100, w: 460, h: 560 });
  w.el.classList.add('cmp-compare'); w.el.dataset.compare = '1';
  const body = w.body; body.style.cssText += 'display:grid;grid-template-columns:120px 1fr;gap:6px 8px;align-items:center;padding:10px;overflow:auto';
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const sel = (opts, val) => { const s = mk('select', {}); for (const [v, t] of opts) s.append(mk('option', { value: v, textContent: t })); if (val != null) s.value = val; return s; };
  const inp = (v, title) => { const i = mk('input', { value: v, title: title || '' }); i.onkeydown = (e) => e.stopPropagation(); return i; };
  const row = (label, el, role) => { body.append(mk('span', { textContent: label }), el); if (role) el.dataset.role = role; return el; };
  const lopts = cands.map((L) => [L.name, nameOf(L)]);
  const nDef = newLayer && cands.includes(newLayer) ? newLayer : cands[cands.length - 1];
  const oldS = row('old model', sel(lopts, (cands.find((L) => L !== nDef) || cands[0]).name), 'old');
  const newS = row('new model', sel(lopts, nDef.name), 'new');
  const ban = mk('div', { className: 'pp-banner' }); ban.style.gridColumn = '1/3'; body.append(ban);
  const gOld = row('grade (old)', sel([]), 'gradeOld'), gNew = row('grade (new)', sel([]), 'grade');
  const gunit = row('grade unit', inp('', 'g/t, %, ppm … — declared, metal comes out in tonnes (as the resource table)'), 'gradeUnit');
  const dcol = row('density', sel([]), 'density'), dconst = row('… or constant', inp('2.7', 'used when no density column is chosen'), 'densConst');
  const dunit = row('density unit', sel(['t/m3', 'kg/m3', 'g/cm3', 'lb/ft3'].map((u) => [u, u]), 't/m3'));
  const g1 = row('domain', sel([]), 'domain'), g2 = row('class', sel([]), 'class');
  const cut = row('cutoffs', inp('0', 'comma-separated, in the grade’s units — Δ per group at each; the moves and the checks read the lowest'), 'cutoffs');
  const mf = row('metal factor', inp('', 'metal = t × grade × this — blank: from the grade unit'), 'metalFactor');
  const mcol = row('map colour', sel([['delta', 'Δ grade (new − old)'], ['change', 'added / removed / changed']], 'delta'), 'mapColor');
  const secLab = mk('label', {}); const secCb = mk('input', { type: 'checkbox' }); secLab.append(secCb, ' also an E–W section'); row('map', secLab);
  const pick = (s, opts, want) => { s.replaceChildren(...opts.map((o) => mk('option', { value: o, textContent: o || '—' }))); s.value = opts.includes(want) ? want : opts[0] || ''; };
  const fill = () => {
    const O = cands.find((L) => L.name === oldS.value), N = cands.find((L) => L.name === newS.value);
    const numsO = numericColsOf(O), numsN = numericColsOf(N);
    const gg = (nums) => nums.find((c) => /^(au|cu|fe|ag|zn|pb|ni|mo|grade)/i.test(c)) || nums[0];
    const keepN = gNew.value; pick(gNew, numsN, keepN || gg(numsN));
    pick(gOld, numsO, numsO.includes(gNew.value) ? gNew.value : gg(numsO));
    const allN = schemaExt(N, layerTableHeader(N)).map((c) => c.name), allO = new Set(schemaExt(O, layerTableHeader(O)).map((c) => c.name));
    const both = allN.filter((c) => allO.has(c));
    pick(dcol, ['', ...numsN.filter((c) => numsO.includes(c))], dcol.value || both.find((c) => /^(dens|sg|rho|density)/i.test(c)) || '');
    pick(g1, ['', ...both], g1.value || both.find((c) => /^(dom|domain|zone|lith|lithology|rock|rocktype|geol|unit)\b|domain/i.test(c)) || '');
    pick(g2, ['', ...both], g2.value || both.find((c) => /^(class|cat|rescat|rescla|jorc)\b|class|categ/i.test(c)) || '');
    const c = O === N ? { ok: false, reason: 'the same layer twice' } : compareCompat(O, N);
    ban.className = 'pp-banner ' + (c.ok ? 'ok' : 'bad');
    ban.textContent = c.ok ? { same: 'the same lattice — the Δ map compares block for block', common: 'compatible lattices — the Δ map is on the finest common one', parent: 'sub-blocked vs regular — the Δ map is at the regular model’s blocks' }[c.how] : `no Δ map — ${c.reason}`;
    go.disabled = O === N;
  };
  oldS.onchange = fill; newS.onchange = fill; gNew.onchange = () => { if (numericColsOf(layerNamed(oldS.value)).includes(gNew.value)) gOld.value = gNew.value; };
  const go = mk('button', { className: 'awin-btn btn-p', textContent: 'Make the page' }), msg = mk('span', { className: 'hint' });
  go.dataset.go = '1';
  body.append(msg, go);
  fill();
  w.params = () => {
    const mfv = parseFactor(mf.value);
    if (Number.isNaN(mfv)) throw new Error(`metal factor “${mf.value.trim()}”: a positive number or a fraction such as 1/31.1035 — or blank`);
    const cuts = cut.value.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!cuts.length || cuts.some((x) => !Number.isFinite(x))) throw new Error(`cutoffs “${cut.value}”: numbers, comma-separated`);
    const ok = compareCompat(layerNamed(oldS.value), layerNamed(newS.value)).ok;
    return { old: oldS.value, new: newS.value, grade: gNew.value, ...(gOld.value !== gNew.value ? { gradeOld: gOld.value } : {}),
      density: dcol.value ? { col: dcol.value, unit: dunit.value } : { const: +dconst.value || 1, unit: dunit.value }, groupBy: [g1.value, g2.value].filter(Boolean),
      cutoffs: cuts, ...(gunit.value.trim() ? { gradeUnit: gunit.value.trim() } : {}), ...(mfv != null ? { metalFactor: mfv } : {}),
      map: ok, mapColor: mcol.value, ...(secCb.checked ? { section: true } : {}) };
  };
  go.onclick = async () => {
    let p; try { p = w.params(); } catch (e) { msg.textContent = e.message; return; }
    go.disabled = true; msg.textContent = 'comparing…';
    try { const res = await buildComparisonReport(p, { name }); w.close(); return res; }
    catch (e) { msg.textContent = e.message; go.disabled = false; }
  };
  return w;
}

// ── where it is offered: the palette, the Tools menu (the layer's Analyse menu is layermenu.js) ──
registerCommands([
  { id: 'compare', group: 'Analyse', title: 'Compare model versions…', kw: 'compare versions old new month change difference delta reconcile report page composer tonnes grade metal domain class lineage', when: () => comparableLayers().length >= 2, run: (c) => openCompareDialog({ newLayer: c.L }) },
]);
contributeMenu('tools', () => (comparableLayers().length >= 2 ? [{ label: 'Compare model versions…', action: () => openCompareDialog({}) }] : []));
