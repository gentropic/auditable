// @gcu/dispatch grammar — the phrase-structure rules of the controlled command language (~50 rules).
// Terminals: CATEGORY or CATEGORY:word. Nonterminals: capitalised. Actions return a node, or null to
// kill the branch (type pruning inside the parse; return {} for a present-but-meaningless node, never
// null for "nothing"). X carries the type-driven helpers the engine derives from the ontology:
// headFirst, identTypes, postmodPreps, postmodQuantity, compound(), postmod(), qmod().
export function buildGrammar(X) {
  const R = {};
  const rule = (lhs, rhs, act) => (R[lhs] ??= []).push({ rhs: rhs ? rhs.split(' ') : [], act });

  rule('Program', 'Cmd', c => [c]);
  // closed, value-returning questions are commands with the verb left out: "what is the density of chalcopyrite"
  // reads as "density of chalcopyrite". Open questions (why, how) have no rule here and stay out of scope.
  rule('Program', 'Question', q => [q]);
  rule('Question', 'WHCOP NPList PPs', (_, l, a) => ({ kind: 'cmd', verb: null, args: [{ kind: 'np', list: l }, ...a], question: true }));
  // "which countries are landlocked" = "landlocked countries": the predicate must compound onto the subject
  rule('Question', 'WH Core COP NPList PPs', (_, c, __, l, a) => {
    let n = c; for (const m of l) { const r = X.compound(m, n); if (!r) return null; n = r; }
    return { kind: 'cmd', verb: null, args: [{ kind: 'np', list: [n] }, ...a], question: true };
  });
  rule('Program', 'Cmd THEN Program', (c, _, p) => [c, ...p]);
  rule('Program', 'Cmd CONJ THEN Program', (c, _, __, p) => [c, ...p]);
  rule('Program', 'Cmd COMMA THEN Program', (c, _, __, p) => [c, ...p]);
  rule('Program', 'Cmd COMMA CONJ THEN Program', (c, _, __, ___, p) => [c, ...p]);

  // object comes right after the verb or not at all; everything after is prepositional
  rule('Cmd', 'VERB Theme PPs', (v, t, a) => ({ kind: 'cmd', verb: v.verb, args: [...t, ...a] }));
  rule('Cmd', 'AGAIN Theme PPs', (_, t, a) => ({ kind: 'again', args: [...t, ...a] }));
  rule('Cmd', 'AGAIN BUT Theme PPs', (_, __, t, a) => ({ kind: 'again', args: [...t, ...a] }));
  rule('Cmd', 'AGAIN COMMA BUT Theme PPs', (_, __, ___, t, a) => ({ kind: 'again', args: [...t, ...a] }));

  rule('Cmd', 'VERB PPs LATE NPList', (v, a, _, l) => ({ kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }, ...a] }));   // object after the PPs — a repair, never free
  rule('Cmd', 'LATE PP PPs VERB Theme PPs', (_, p, a, v, t, b) => ({ kind: 'cmd', verb: v.verb, args: [...t, p, ...a, ...b] }));   // arguments before the verb — also a repair
  // no verb: a bare thing, maybe with arguments — "density of chalcopyrite", "2 km in miles", "histogram of cu".
  // The engine binds it to the frames the ontology marks `elidable`; the ontology, not the grammar, says what
  // can be asked for on its own. Two frames surviving is an honest ambiguity, reported as such.
  rule('Cmd', 'NPList PPs', (l, a) => ({ kind: 'cmd', verb: null, args: [{ kind: 'np', list: l }, ...a] }));
  rule('Theme', '', () => []);
  rule('Theme', 'NPList', l => [{ kind: 'np', list: l }]);
  rule('PPs', '', () => []);
  rule('PPs', 'PP PPs', (a, r) => [a, ...r]);

  rule('PP', 'PREP NPList', (p, l) => ({ kind: 'pp', prep: p.word, canon: p.canon, val: l }));

  rule('NPList', 'NP NPTail', (n, t) => [n, ...t]);
  rule('NPTail', '', () => []);
  rule('NPTail', 'CONJ NP NPTail', (_, n, t) => [n, ...t]);
  rule('NPTail', 'COMMA NP NPTail', (_, n, t) => [n, ...t]);
  rule('NPTail', 'COMMA CONJ NP NPTail', (_, __, n, t) => [n, ...t]);

  rule('NP', 'Core', c => c);
  rule('NP', 'DET Core', (d, c) => ({ ...c, det: d.word }));
  rule('NP', 'DET REF Core', (d, r, c) => ({ ...c, ref: r.word }));
  rule('NP', 'REF Core', (r, c) => ({ ...c, ref: r.word }));
  rule('NP', 'QUANT Core Except', (q, c, e) => c.generic ? { ...c, all: true, except: e } : null);
  rule('NP', 'QUANT DET Core Except', (q, _, c, e) => c.generic ? { ...c, all: true, except: e } : null);   // all the domains / todos os domínios
  if (X.headFirst) rule('NP', 'DET Core REF', (d, c, r) => ({ ...c, ref: r.word }));                        // a rodada anterior
  rule('NP', 'PRON', p => ({ type: '*', pron: p.word }));
  rule('NP', 'IDENT', t => t.type ? { type: t.type, name: t.name, generic: false, attrs: {} } : null);
  rule('NP', 'Quantity', q => q);
  rule('NP', 'UNIT', u => ({ type: 'unit', unit: u.unit, dim: u.dim, generic: false, attrs: {} }));   // "in miles": a unit as a thing
  rule('NP', 'DET Quantity Head', (_, q, h) => X.qmod(q, h));
  rule('NP', 'Quantity Head', (q, h) => X.qmod(q, h));
  rule('Except', '', () => []);
  rule('Except', 'EXCEPT NPList', (_, l) => l);

  rule('Core', 'Head Ident PostMods', (h, id, pm) => {
    const n = { ...h };
    if (h.plural) n.plural = true;
    if (!id.none) { if (!X.identTypes.has(h.type)) return null; n.name = id.name; n.generic = false; }
    for (const m of pm) { const r = X.postmod(n, m); if (!r) return null; Object.assign(n, r); }
    return n;
  });
  rule('Ident', '', () => ({ none: true }));
  rule('Ident', 'IDENT', t => ({ name: t.name }));
  rule('Ident', 'NUM', t => ({ name: String(t.n) }));
  rule('PostMods', '', () => []);
  rule('PostMods', 'PostMod PostMods', (m, r) => [m, ...r]);
  for (const p of X.postmodPreps) {
    if (X.postmodQuantity.has(p)) rule('PostMod', `PREP:${p} Quantity`, (_, q) => ({ prep: p, q }));
    else rule('PostMod', `PREP:${p} NP`, (_, n) => ({ prep: p, np: n }));
  }
  rule('PostMod', 'PREP:of Quantity', (_, q) => ({ prep: 'of', q, qmod: true }));   // "a search of 200 m" / "busca de 200 m"
  // relative clause: "the variogram (that) I fitted yesterday", "the run we did last week", "the variogram fitted this morning"
  rule('PostMod', 'RelHead VERB When', (_, v, w) => ({ rel: { verb: v.verb, when: w } }));
  rule('PostMod', 'VERB When', (v, w) => w ? { rel: { verb: v.verb, when: w } } : null);          // participle form needs the time to disambiguate
  rule('PostMod', 'PREP:from TIME', (_, t) => ({ rel: { when: t } }));                              // "the run from yesterday"
  rule('PostMod', 'TIME', t => ({ rel: { when: t } }));                                             // "yesterday's" is not modelled; "the run yesterday" is
  rule('PostMod', 'PREP:with CompNP', (_, c) => ({ rel: { cmp: c.cmp } }));                              // "the run with the bigger search"
  rule('RelHead', 'SUBJ', () => ({}));
  rule('RelHead', 'REL SUBJ', () => ({}));
  rule('When', '', () => null);
  rule('When', 'TIME', t => t);
  const compNP = (c, h) => h.type === 'search' || h.type === 'composites' ? { ...h, cmp: { sign: c.sign, sup: c.sup } } : null;
  rule('CompNP', 'COMP Head', compNP); rule('CompNP', 'DET COMP Head', (_, c, h) => compNP(c, h));
  if (X.headFirst) { rule('CompNP', 'Head COMP', (h, c) => compNP(c, h)); rule('CompNP', 'DET Head COMP', (_, h, c) => compNP(c, h)); }   // pt allows both orders
  rule('NP', 'CompNP', c => c);

  const leaf = t => ({ type: t.type, value: t.value, generic: !!t.generic, attrs: {}, ...(t.plural ? { plural: true } : {}) });
  if (X.headFirst) {   // head then modifiers: "variograma esférico", "domínio oeste"
    rule('Head', 'NOUN Mods', (t, ms) => ms.reduce((h, m) => h && X.compound(leaf(m), h), leaf(t)));
    rule('Mods', '', () => []);
    rule('Mods', 'NOUN Mods', (m, r) => [m, ...r]);
  } else {             // modifiers then head: "spherical variogram", "west domain"
    rule('Head', 'NOUN', leaf);
    rule('Head', 'NOUN Head', (a, h) => X.compound(leaf(a), h));
  }

  rule('Quantity', 'NUM', t => ({ type: 'quantity', n: t.n, unit: null, dim: 'bare' }));
  rule('Quantity', 'NUM UNIT', (t, u) => ({ type: 'quantity', n: t.n, unit: u.unit, dim: u.dim }));
  return R;
}
