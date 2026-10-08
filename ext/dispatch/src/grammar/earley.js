// earley.mjs — Earley recogniser + packed semantic evaluation, with optional error-correcting repairs.
//
// chart(R, toks, term, start, opts) recognises the input for grammar R (R[sym] = [{rhs, act}]),
// where term(sym, tok) returns the semantic nodes a terminal symbol yields for a token.
//
// opts.budget (default 0) enables error-correcting parsing (Aho & Peterson 1972): the parser may
//   - skip a token   (cost opts.skip(i), default 1)
//   - substitute a token by a near miss (opts.near(sym, i) → [{ v, cost, to }], default none) — spelling as an edit
//   - insert a terminal the grammar expects (cost opts.insert(sym, i), default Infinity; typically only
//     a few categories are insertable — a preposition, an article). The inserted node comes from
//     opts.fabricate(sym) and is marked { inserted: true }.
// The minimum-cost derivation wins; ties are kept as alternatives. With budget 0 nothing changes.
//
// Returns:
//   derive(sym, i, j)  → [{ v, cost, repairs }] — packed: each (sym, i, j) evaluated once, alternatives
//                        with equal meaning merged keeping the cheaper one, null actions pruned at the span.
//   spans(sym, i)      → end positions j for which sym derives [i, j) within budget
//   furthest, expected()  → diagnostics (where the chart died, what it wanted)
export function chart(R, toks, term, start, opts = {}) {
  const budget = opts.budget ?? 0;
  const skipCost = opts.skip ?? (() => 1);
  const insCost = opts.insert ?? (() => Infinity);
  const fabricate = opts.fabricate ?? (() => null);
  const near = opts.near ?? (() => []);
  const nearMin = (sym, i) => { const c = near(sym, i); return c.length ? Math.min(...c.map(x => x.cost)) : Infinity; };
  const n = toks.length;
  const rules = [];
  for (const lhs in R) for (const r of R[lhs]) rules.push({ id: rules.length, lhs, rhs: r.rhs, act: r.act });
  const byLhs = {}; for (const r of rules) (byLhs[r.lhs] ??= []).push(r);
  const isNT = s => s in R;
  const nullable = new Set();
  for (let changed = true; changed;) { changed = false; for (const r of rules) if (!nullable.has(r.lhs) && r.rhs.every(s => nullable.has(s))) { nullable.add(r.lhs); changed = true; } }
  const insertable = sym => !isNT(sym) && budget > 0 && insCost(sym, 0) < Infinity;

  // ---- recognition (items carry cost; same (rule,dot,origin) at a lower cost supersedes) ----
  const S = Array.from({ length: n + 1 }, () => ({ items: [], best: new Map() }));
  const completed = {};                                   // completed[sym][origin] = Map(end → min cost)
  const add = (k, rule, dot, origin, cost) => {
    if (cost > budget) return;
    const key = `${rule.id},${dot},${origin}`;
    const prev = S[k].best.get(key);
    if (prev !== undefined && prev <= cost) return;
    S[k].best.set(key, cost); S[k].items.push({ rule, dot, origin, cost });
  };
  for (const r of byLhs[start]) add(0, r, 0, 0, 0);
  let furthest = 0;
  for (let k = 0; k <= n; k++) {
    const set = S[k];
    if (!set.items.length) break;
    furthest = k;
    for (let x = 0; x < set.items.length; x++) {
      const it = set.items[x];
      if (set.best.get(`${it.rule.id},${it.dot},${it.origin}`) < it.cost) continue;   // superseded
      const next = it.rule.rhs[it.dot];
      if (next === undefined) {
        const m = (completed[it.rule.lhs] ??= {})[it.origin] ??= new Map();
        if (!(m.has(k) && m.get(k) <= it.cost)) m.set(k, it.cost);
        for (const w of S[it.origin].items) if (w.rule.rhs[w.dot] === it.rule.lhs) add(k, w.rule, w.dot + 1, w.origin, w.cost + it.cost);
      } else if (isNT(next)) {
        for (const r of byLhs[next]) add(k, r, 0, k, 0);
        if (nullable.has(next)) add(k, it.rule, it.dot + 1, it.origin, it.cost);
      } else {
        if (k < n && term(next, toks[k]).length) add(k + 1, it.rule, it.dot + 1, it.origin, it.cost);
        else if (k < n && budget > 0) { const nc = nearMin(next, k); if (nc < Infinity) add(k + 1, it.rule, it.dot + 1, it.origin, it.cost + nc); }   // substitute
        if (insertable(next)) add(k, it.rule, it.dot + 1, it.origin, it.cost + insCost(next, k));   // insert the terminal
      }
      if (budget > 0 && k < n) add(k + 1, it.rule, it.dot, it.origin, it.cost + skipCost(k));        // skip the token
    }
  }
  for (const sym of nullable) for (let k = 0; k <= furthest; k++) { const m = (completed[sym] ??= {})[k] ??= new Map(); if (!m.has(k)) m.set(k, 0); }

  // ---- packed min-cost evaluation ----
  // terminal over [i, j): tokens i..j-2 skipped, token j-1 matches; or i === j with an insertion
  const termSpans = (sym, i) => {
    const out = [];
    if (insertable(sym)) out.push(i);
    let c = 0;
    for (let j = i + 1; j <= n; j++) { if (term(sym, toks[j - 1]).length || (budget > 0 && nearMin(sym, j - 1) + c <= budget)) out.push(j); if (budget === 0) break; c += skipCost(j - 1); if (c > budget) break; }
    return out;
  };
  const spans = (sym, i) => isNT(sym) ? [...(completed[sym]?.[i]?.keys() ?? [])] : termSpans(sym, i);
  const dMemo = new Map(), sMemo = new Map();
  const skipsBetween = (i, j) => { let c = 0; const r = []; for (let k = i; k < j; k++) { c += skipCost(k); r.push({ op: 'skip', at: k, word: toks[k].word }); } return { c, r }; };
  function derive(sym, i, j) {
    const key = `${sym}@${i}-${j}`;
    if (dMemo.has(key)) return dMemo.get(key);
    dMemo.set(key, []);
    let out = [];
    if (!isNT(sym)) {
      if (i === j) { const v = fabricate(sym); out = v ? [{ v: { ...v, inserted: true }, cost: insCost(sym, i), repairs: [{ op: 'insert', at: i, sym }] }] : []; }
      else { const { c, r } = skipsBetween(i, j - 1); if (c <= budget) { out = term(sym, toks[j - 1]).map(v => ({ v, cost: c, repairs: r })); if (!out.length && budget > 0) out = near(sym, j - 1).filter(x => c + x.cost <= budget).map(x => ({ v: x.v, cost: c + x.cost, repairs: [...r, { op: 'subst', at: j - 1, word: toks[j - 1].word, to: x.to }] })); } }
    } else if (completed[sym]?.[i]?.has(j)) {
      const seen = new Map();
      for (const r of byLhs[sym]) for (const kids of seq(r, 0, i, j)) {
        const v = r.act(...kids.vs);
        if (v === null) continue;
        const vk = JSON.stringify(v);
        const prev = seen.get(vk);
        if (!prev || kids.cost < prev.cost) seen.set(vk, { v, cost: kids.cost, repairs: kids.repairs });
      }
      out = [...seen.values()];
    }
    dMemo.set(key, out); return out;
  }
  function seq(rule, idx, i, j) {
    const key = `${rule.id},${idx},${i},${j}`;
    if (sMemo.has(key)) return sMemo.get(key);
    let out = [];
    if (idx === rule.rhs.length) out = i === j ? [{ vs: [], cost: 0, repairs: [] }] : [];
    else {
      const sym = rule.rhs[idx];
      for (const e of spans(sym, i)) {
        if (e > j) continue;
        const heads = derive(sym, i, e); if (!heads.length) continue;
        const tails = seq(rule, idx + 1, e, j); if (!tails.length) continue;
        for (const h of heads) for (const t of tails) { const cost = h.cost + t.cost; if (cost <= budget) out.push({ vs: [h.v, ...t.vs], cost, repairs: [...h.repairs, ...t.repairs] }); }
      }
      if (budget > 0) { const best = new Map(); for (const o of out) { const k = JSON.stringify(o.vs); const p = best.get(k); if (!p || o.cost < p.cost) best.set(k, o); } out = [...best.values()]; }
    }
    sMemo.set(key, out); return out;
  }
  const expected = () => [...new Set(S[furthest].items.map(it => it.rule.rhs[it.dot]).filter(s => s !== undefined && !isNT(s)))];
  return { derive, spans, furthest, expected, nullable, skipCost };
}
