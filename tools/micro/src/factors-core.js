// micro factors-core — the reconciliation factors' arithmetic, pure (no DOM, no layers):
//   F1 = grade control / resource model   (does the short-range model find what the long-range one promised?)
//   F2 = mill / grade control              (does the plant get what grade control sent it?)
//   F3 = mill / resource model = F1 × F2   (the whole chain)
// each for TONNES, GRADE and METAL (metal = tonnes × grade × metal factor, so F_metal = F_tonnes ×
// F_grade). A source's totals per period are { t, m } (tonnes, metal) — grade is DERIVED, m / (t × mf),
// so summing periods (cumulative) sums tonnes and metal and never averages grades.
// A factor whose denominator is not > 0, or whose numerator is blank, is BLANK (NaN) — never Infinity,
// never 0: a period nothing was mined in has no factor, it does not have a bad one.
// ./factors.js scans the models and the production table into these totals; tests/micro-factors.test.mjs.

// the key a period is matched by: trimmed text; a number in any spelling (1, 1.0, " 01") as its
// canonical number, so a period column of 1…12 matches a production sheet's 01…12
export function periodKey(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v).trim();
  if (s === '') return '';
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return String(+s);
  return s;
}

// natural order: 2 before 10, "2026-02" before "2026-10", "M2" before "M10"
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// a / b, or blank: b must be > 0 and both finite
export function ratio(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : NaN; }

// a source's per-period accumulator: key → { t, m, n }. add(t, g) adds tonnes t at grade g
// (grade already in the report unit; metal = t × g × mf)
export function makeAcc(mf = 1) {
  const map = new Map();
  return {
    map,
    add(key, t, g) {
      if (!(t > 0) || !Number.isFinite(g)) return;
      let e = map.get(key); if (!e) map.set(key, (e = { t: 0, m: 0, n: 0 }));
      e.t += t; e.m += t * g * mf; e.n++;
    },
    // a production row: tonnes plus a grade OR a metal (both: the metal as stated)
    addRow(key, t, g, m) {
      if (!Number.isFinite(t) || t < 0) return false;
      const metal = Number.isFinite(m) ? m : Number.isFinite(g) ? t * g * mf : NaN;
      if (!Number.isFinite(metal)) return false;
      let e = map.get(key); if (!e) map.set(key, (e = { t: 0, m: 0, n: 0 }));
      e.t += t; e.m += metal; e.n++;
      return true;
    },
  };
}

// totals { t, m } → { t, g, m } (g blank when there are no tonnes)
export function tgm(e, mf = 1) {
  if (!e) return { t: NaN, g: NaN, m: NaN };
  return { t: e.t, g: e.t > 0 && mf > 0 ? e.m / (e.t * mf) : NaN, m: e.m };
}
const fac = (num, den) => ({ t: ratio(num.t, den.t), g: ratio(num.g, den.g), m: ratio(num.m, den.m) });
const sumInto = (acc, e) => { if (e) { acc.t += e.t; acc.m += e.m; } };

// the factor rows, one per period, in `periods` order (periods every source lacks are left out
// unless listed). model, gc: Map key → { t, m } (a period a model has no tonnes in: { t: 0 } or absent
// → zero tonnes, not blank — it WAS mined, the model put nothing there); mill: Map | null — a period
// without production has a blank mill and blank F2 / F3.
// Cumulative ("to date", c): tonnes and metal summed over this period and every earlier one; the
// cumulative mill — and so c.f2 / c.f3 — goes blank from the first period with no production
// (a to-date figure that silently skipped a month would read as a good factor).
export function factorRows({ periods, model, gc, mill = null, mf = 1 }) {
  const out = [];
  const cm = { t: 0, m: 0 }, cg = { t: 0, m: 0 }, cp = { t: 0, m: 0 };
  let millBroken = !mill;
  for (const p of periods) {
    const em = model.get(p) || { t: 0, m: 0 }, eg = gc.get(p) || { t: 0, m: 0 };
    const ep = mill ? mill.get(p) || null : null;
    sumInto(cm, em); sumInto(cg, eg);
    if (ep && !millBroken) sumInto(cp, ep); else millBroken = true;
    const M = tgm(em, mf), G = tgm(eg, mf), P = ep ? tgm(ep, mf) : tgm(null);
    const cM = tgm(cm, mf), cG = tgm(cg, mf), cP = millBroken ? tgm(null) : tgm(cp, mf);
    out.push({
      period: p, model: M, gc: G, mill: P,
      f1: fac(G, M), f2: fac(P, G), f3: fac(P, M),
      c: { model: cM, gc: cG, mill: cP, f1: fac(cG, cM), f2: fac(cP, cG), f3: fac(cP, cM) },
      n: { model: em.n || 0, gc: eg.n || 0, mill: ep ? ep.n || 0 : 0 },
    });
  }
  return out;
}

// the order periods are reported in: `listed` first (a volume list keeps its own order), then every
// other key any source has, naturally sorted (blank keys — unmined — never)
export function periodOrder(listed, ...maps) {
  const seen = new Set(listed.filter((k) => k !== ''));
  const rest = new Set();
  for (const mp of maps) if (mp) for (const k of mp.keys()) if (k !== '' && !seen.has(k)) rest.add(k);
  return [...seen, ...[...rest].sort(naturalCompare)];
}

export const QUANTITIES = [['tonnes', 't'], ['grade', 'g'], ['metal', 'm']];

// the machine table: one row per period × quantity, key [period, quantity];
// columns model, gc, mill, f1, f2, f3 for the period and c_model … c_f3 to date
export function factorTable(rows) {
  const columns = ['period', 'quantity', 'model', 'gc', 'mill', 'f1', 'f2', 'f3', 'c_model', 'c_gc', 'c_mill', 'c_f1', 'c_f2', 'c_f3'];
  const out = [];
  for (const r of rows) for (const [q, k] of QUANTITIES) {
    out.push([r.period, q, r.model[k], r.gc[k], r.mill[k], r.f1[k], r.f2[k], r.f3[k], r.c.model[k], r.c.gc[k], r.c.mill[k], r.c.f1[k], r.c.f2[k], r.c.f3[k]]);
  }
  return { columns, rows: out, key: ['period', 'quantity'] };
}

// values for checks: the LAST period's factors f1_t … f3_m and its sources' totals model_t …
// mill_m; the same to date with a c_ prefix (c_f1_t …); periods = how many. Blank stays blank
// (a check that reads one is "not evaluated").
export function factorValues(rows) {
  const v = { periods: rows.length };
  const last = rows[rows.length - 1];
  for (const [, k] of QUANTITIES) {
    for (const f of ['f1', 'f2', 'f3']) { v[`${f}_${k}`] = last ? last[f][k] : NaN; v[`c_${f}_${k}`] = last ? last.c[f][k] : NaN; }
    for (const s of ['model', 'gc', 'mill']) { v[`${s}_${k}`] = last ? last[s][k] : NaN; v[`c_${s}_${k}`] = last ? last.c[s][k] : NaN; }
  }
  return v;
}

// the identities, checked on what the table reports: F3 = F1 × F2 and F_metal = F_tonnes × F_grade,
// wherever all three are defined → the largest relative deviation (0 for consistent arithmetic)
export function identityError(rows) {
  let worst = 0;
  const dev = (a, b) => { if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) worst = Math.max(worst, Math.abs(a - b) / Math.abs(b)); };
  for (const r of rows) for (const blk of [r, r.c]) {
    for (const [, k] of QUANTITIES) dev(blk.f3[k], blk.f1[k] * blk.f2[k]);
    for (const f of ['f1', 'f2', 'f3']) dev(blk[f].m, blk[f].t * blk[f].g);
  }
  return worst;
}

// a production row's stated metal against its tonnes × grade × mf → the relative deviation
// (NaN when the row doesn't state both)
export function metalMismatch(t, g, m, mf = 1) {
  if (!Number.isFinite(t) || !Number.isFinite(g) || !Number.isFinite(m) || !(m !== 0)) return NaN;
  return Math.abs(m - t * g * mf) / Math.abs(m);
}
