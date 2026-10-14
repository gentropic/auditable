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
  // "which countries have a population over 100 million" = "countries having a population over …": the question word, a thing, its arguments
  rule('Question', 'WH NPList PPs', (_, l, a) => a.length ? { kind: 'cmd', verb: null, args: [{ kind: 'np', list: l }, ...a], question: true } : null);
  rule('Program', 'Cmd THEN Program', (c, _, p) => [c, ...p]);
  // a fragment (understand with { fragment: true }): what is left of a command when the rest is the session's last one —
  // "in feet", "and chile", "log scale", "where au > 1", "again but with 300 m". It is an 'again' the ellipsis completes.
  const frag = (t, a) => t.length || a.length ? [{ kind: 'again', args: [...t, ...a] }] : null;
  rule('Fragment', 'Theme PPs', frag);
  rule('Fragment', 'CONJ Theme PPs', (_, t, a) => frag(t, a));
  rule('Fragment', 'Cmd', c => c.kind === 'again' ? [c] : null);
  rule('Program', 'Cmd CONJ THEN Program', (c, _, __, p) => [c, ...p]);
  rule('Program', 'Cmd COMMA THEN Program', (c, _, __, p) => [c, ...p]);
  rule('Program', 'Cmd COMMA CONJ THEN Program', (c, _, __, ___, p) => [c, ...p]);

  // object comes right after the verb or not at all; everything after is prepositional
  rule('Cmd', 'VERB Theme PPs', (v, t, a) => ({ kind: 'cmd', verb: v.verb, args: [...t, ...a] }));
  rule('Cmd', 'AGAIN Theme PPs', (_, t, a) => ({ kind: 'again', args: [...t, ...a] }));
  rule('Cmd', 'AGAIN BUT Theme PPs', (_, __, t, a) => ({ kind: 'again', args: [...t, ...a] }));
  rule('Cmd', 'AGAIN COMMA BUT Theme PPs', (_, __, ___, t, a) => ({ kind: 'again', args: [...t, ...a] }));

  // question shapes around a verb: a copula after the thing ("how much fe is in 45.2% fe2o3"), "are there" ("how many
  // working days are there between …"), do-support with the verb last ("where do 090/45 and 270/45 intersect"), and a
  // verb said last, as a noun ("fe to fe2o3 factor")
  rule('Cmd', 'VERB NPList COP PPs', (v, l, _, a) => a.length ? { kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }, ...a] } : null);
  rule('Cmd', 'VERB NPList COP', (v, l) => ({ kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }] }));   // the copula last: "what day 15 nov 2027 is"
  // what is asked for first, then the copula and the thing: "how many g/t is 0.35 oz per short ton" — the first thing is placed by its type
  rule('Cmd', 'VERB NP COP NPList PPs', (v, n, _, l, a) => ({ kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }, ...a, { kind: 'pp', prep: '', canon: [''], val: [n], topic: true }] }));
  if (X.exist) rule('Cmd', 'VERB Theme EXIST PPs', (v, t, _, a) => ({ kind: 'cmd', verb: v.verb, args: [...t, ...a] }));
  if (X.doq) rule('Cmd', 'DOQ NPList PPs VERB PPs', (_, l, a, v, b) => ({ kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }, ...a, ...b] }));   // "what does 1 m of nq core weigh at 2.7"
  rule('Cmd', 'NPList PPs VERB', (l, a, v) => ({ kind: 'cmd', verb: v.verb, args: [{ kind: 'np', list: l }, ...a] }));
  // an argument said first, before a comma: "on a 14 on 14 off roster, am i off on 25 dec". The binder places it by its
  // preposition, or, when the preposition names no role that takes it, as one of the things the command is about
  rule('Cmd', 'PP COMMA Cmd', (p, _, c) => c.kind === 'cmd' ? { ...c, args: [...c.args, { ...p, topic: true }] } : null);
  if (X.subject) rule('Cmd', 'NP VERB Theme PPs', (n, v, t, a) => ({ kind: 'cmd', verb: v.verb, args: [...t, { kind: 'pp', prep: '', canon: ['subject'], val: [n] }, ...a] }));   // "pop means population": only frames that declare a subject
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
  rule('PPs', 'COMMA PP PPs', (_, a, r) => [a, ...r]);   // arguments set off by commas: "landlocked countries, sorted by population"

  rule('PP', 'PREP NPList', (p, l) => ({ kind: 'pp', prep: p.word, canon: p.canon, val: l }));
  rule('PP', 'COLON NPList', (_, l) => ({ kind: 'pp', prep: ':', canon: [':'], val: l }));   // "check: …", a payload after a line break
  rule('PP', 'DEMO COLON NPList', (_, __, l) => ({ kind: 'pp', prep: ':', canon: [':'], val: l }));             // "summarise this: …", "diff these: …"
  rule('PP', 'PREP:of DEMO COLON NPList', (_, __, ___, l) => ({ kind: 'pp', prep: ':', canon: [':'], val: l }));   // "word count of this: …"
  rule('PP', 'Date', d => ({ kind: 'pp', prep: '', canon: ['on'], val: [d] }));
  const bareOk = n => X.bareTypes.has(n.type) || (n.type === 'quantity' && (X.bareTypes.has('quantity:*') || X.bareTypes.has(`quantity:${n.dim}`)));
  if (X.bareTypes.size) rule('PP', 'NP', n => bareOk(n) ? { kind: 'pp', prep: '', canon: [''], val: [n] } : null);   // a role with no marker, of a type a frame declares one for                   // a bare date is a time argument: "call him tomorrow"

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
  rule('NP', 'QUANT Core', (q, c) => c.generic ? null : { ...c, each: true });   // "each hole" where hole names one thing (a column): per hole, for the host
  if (X.headFirst) rule('NP', 'DET Core REF', (d, c, r) => ({ ...c, ref: r.word }));                        // a rodada anterior
  rule('NP', 'PRON', p => ({ type: '*', pron: p.word }));
  rule('NP', 'IDENT', t => t.type ? { type: t.type, name: t.name, generic: false, attrs: {} } : null);
  rule('NP', 'Quantity', q => q);
  rule('NP', 'UNIT', u => ({ type: 'unit', unit: u.unit, dim: u.dim, generic: false, attrs: {} }));   // "in miles": a unit as a thing
  rule('NP', 'TEXT', t => ({ type: 'text', value: t.text, generic: false, attrs: {} }));            // a free-text span (the engine cuts it)
  rule('NP', 'LIT PostMods', (t, pm) => {   // a token shape the ontology declares (270/60, DH-03), with its modifiers ("14 on 14 off from 6 oct")
    const n = { type: t.type, value: t.value, generic: false, attrs: {} };
    for (const m of pm) { const r = X.postmod(n, m); if (!r) return null; Object.assign(n, r); }
    return n;
  });
  // a shaped value before its noun: "a 000/30 plane", "a 14 on 14 off roster" — the value names the thing, or modifies it
  // the way it would after it ("plane 000/30")
  const litHead = (t, h, pm) => {
    let n = h.type === t.type && h.generic ? { ...h, value: t.value, generic: false } : null;
    if (!n) { const r = X.postmod(h, { prep: '', np: { type: t.type, value: t.value } }); if (!r) return null; n = { ...h, ...r, generic: false }; }
    for (const m of pm) { const r = X.postmod(n, m); if (!r) return null; Object.assign(n, r); }
    return n;
  };
  rule('NP', 'LIT Head PostMods', litHead);
  rule('NP', 'DET LIT Head PostMods', (_, t, h, pm) => litHead(t, h, pm));
  rule('NP', 'Date', d => d);
  rule('NP', 'Clock', c => c);
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
    if (p === '') {   // a bare modifier: a shaped token or a number right after the noun ("hole 270/60", "rake 30")
      if (X.postmodQuantity.has('')) rule('PostMod', 'Quantity', q => ({ prep: '', q }));
      rule('PostMod', 'LIT', t => ({ prep: '', np: { type: t.type, value: t.value } }));
      continue;
    }
    if (X.postmodQuantity.has(p)) { rule('PostMod', `PREP:${p} Quantity`, (_, q) => ({ prep: p, q })); rule('PostMod', `COP PREP:${p} Quantity`, (_, __, q) => ({ prep: p, q })); }   // "cu above 1", "cu is above 1"
    if (X.postmodThing.has(p)) rule('PostMod', `PREP:${p} NP`, (_, n) => ({ prep: p, np: n }));   // "a section at 045" and "a hole at 270/60" both
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

  // dates: a weekday or relative day ("friday", "tomorrow", "next monday"), a day and month with an optional
  // year in either order ("25 december", "oct 16 2026", "16 de outubro de 2026"), an ISO date; a weekday in
  // front of a full date is checked by the host, not here. Clock times: 09:30, 9pm, "9 am", noon, a bare hour.
  const date = o => ({ type: 'date', generic: false, attrs: {}, ...o });
  const dayOf = (n, m, y) => Number.isInteger(n.n) && n.n >= 1 && n.n <= 31 && (!y || (Number.isInteger(y.n) && y.n >= 1000 && y.n <= 9999))
    ? date({ d: n.n, m: m.m, ...(y ? { y: y.n } : {}), value: [n.n, m.word, y && y.n].filter(Boolean).join(' ') }) : null;
  rule('Date', 'DAY', d => date(d.dow != null ? { dow: d.dow, value: d.word } : { off: d.off, value: d.word }));   // off = days from today
  if (X.nextDay) rule('Date', 'THEN:next DAY', (_, d) => d.dow != null ? date({ dow: d.dow, next: true, value: `next ${d.word}` }) : null);
  rule('Date', 'DATE', d => date({ y: d.y, m: d.m, d: d.d, value: d.word }));
  rule('Date', 'NUM MONTH', (n, m) => dayOf(n, m));
  rule('Date', 'NUM MONTH NUM', (n, m, y) => dayOf(n, m, y));
  rule('Date', 'NUM PREP:of MONTH', (n, _, m) => dayOf(n, m));
  rule('Date', 'NUM PREP:of MONTH PREP:of NUM', (n, _, m, __, y) => dayOf(n, m, y));
  rule('Date', 'MONTH NUM', (m, n) => dayOf(n, m));
  rule('Date', 'MONTH NUM NUM', (m, n, y) => dayOf(n, m, y));
  rule('Date', 'MONTH NUM COMMA NUM', (m, n, _, y) => dayOf(n, m, y));
  rule('Date', 'DAY Date', (w, d) => w.dow != null && d.d != null ? { ...d, dow: w.dow, value: `${w.word} ${d.value}` } : null);
  rule('Date', 'DAY COMMA Date', (w, _, d) => w.dow != null && d.d != null ? { ...d, dow: w.dow, value: `${w.word} ${d.value}` } : null);
  const clock = (h, mi, value) => ({ type: 'clock', h, mi, value, generic: false, attrs: {} });
  const hhmm = (h, mi) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  rule('Clock', 'CLOCK', c => clock(c.h, c.mi, hhmm(c.h, c.mi)));
  rule('Clock', 'NUM AMPM', (n, a) => { if (!Number.isInteger(n.n) || n.n < 1 || n.n > 12) return null; const pm = /^p/.test(a.word), am = /^a/.test(a.word);
    const h = pm && n.n < 12 ? n.n + 12 : am && n.n === 12 ? 0 : n.n; return clock(h, 0, hhmm(h, 0)); });
  rule('Clock', 'CLOCK AMPM', (c, a) => { if (c.h < 1 || c.h > 12) return null; const pm = /^p/.test(a.word), am = /^a/.test(a.word);   // "2:30 pm"
    const h = pm && c.h < 12 ? c.h + 12 : am && c.h === 12 ? 0 : c.h; return clock(h, c.mi, hhmm(h, c.mi)); });
  rule('Clock', 'NUM', n => Number.isInteger(n.n) && n.n >= 0 && n.n <= 24 ? clock(n.n, 0, hhmm(n.n, 0)) : null);

  rule('Quantity', 'NUM', t => ({ type: 'quantity', n: t.n, unit: null, dim: 'bare' }));
  rule('Quantity', 'NUM UNIT', (t, u) => ({ type: 'quantity', n: t.n, unit: u.unit, dim: u.dim }));
  // a fraction said after the whole: "an hour and a half", "one and a half hours", "2 km and a quarter" (never a list)
  rule('Quantity', `Quantity CONJ:${X.and} FRAC`, (q, _, f) => q.unit ? { ...q, n: q.n + f.n } : null);
  rule('Quantity', `NUM CONJ:${X.and} FRAC UNIT`, (t, _, f, u) => ({ type: 'quantity', n: t.n + f.n, unit: u.unit, dim: u.dim }));
  // a number with its multiplier: "100 million", "2.5 billion tonnes"
  rule('Quantity', 'NUM MULT', (t, m) => ({ type: 'quantity', n: +(t.n * m.n).toPrecision(15), unit: null, dim: 'bare' }));
  rule('Quantity', 'NUM MULT UNIT', (t, m, u) => ({ type: 'quantity', n: +(t.n * m.n).toPrecision(15), unit: u.unit, dim: u.dim }));
  rule('Quantity', 'DET UNIT', (d, u) => X.indefinite.includes(d.word) ? { type: 'quantity', n: 1, unit: u.unit, dim: u.dim } : null);   // "an hour", "um minuto"
  // conditions on rows, for roles of type 'cond': "cu > 0.5 and lith is BRX", "au between 1 and 2", "lith in BRX, GRD",
  // "cu is not blank", "not au above 1". A condition is one thing; "and" binds tighter than "or". The columns it may
  // name are the ontology's (conditions.subjects); a value is a number, a name, a shape, or a word nobody declared
  // ("lith is granite"), which the host matches against its data.
  if (X.cond) {
    const leafC = (c, op, v) => ({ col: { type: c.type, value: c.value ?? c.name ?? null }, op, ...(Array.isArray(v) ? { vals: v } : v === undefined ? {} : { val: v }) });
    const node = c => ({ type: 'cond', value: X.condText(c), cond: c, generic: false, attrs: {} });
    rule('Cond', 'CAnd', a => a);
    rule('Cond', `Cond CONJ:${X.or} CAnd`, (a, _, b) => ({ or: [...(a.or ?? [a]), b] }));
    rule('CAnd', 'CAtom', a => a);
    rule('CAnd', `CAnd CONJ:${X.and} CAtom`, (a, _, b) => ({ and: [...(a.and ?? [a]), b] }));
    rule('CAtom', 'NOT CAtom', (_, a) => ({ not: a }));
    for (const op of ['above', 'below', 'atleast', 'atmost', 'equals']) {
      rule('CAtom', `CCol PREP:${op} CVal`, (c, _, v) => leafC(c, op, v));
      rule('CAtom', `CCol COP PREP:${op} CVal`, (c, _, __, v) => leafC(c, op, v));
      rule('CAtom', `CCol NOT PREP:${op} CVal`, (c, _, __, v) => ({ not: leafC(c, op, v) }));
    }
    rule('CAtom', 'CCol COP CVal', (c, _, v) => leafC(c, 'equals', v));
    rule('CAtom', 'CCol NOT CVal', (c, _, v) => leafC(c, 'differs', v));
    rule('CAtom', 'CCol COP NOT CVal', (c, _, __, v) => leafC(c, 'differs', v));
    rule('CAtom', 'CCol CVal', (c, v) => v.n == null ? leafC(c, 'equals', v) : null);   // "lith BRX": a name, never a bare number
    rule('CAtom', `CCol PREP:between CVal CONJ:${X.and} CVal`, (c, _, a, __, b) => a.n != null && b.n != null ? leafC(c, 'between', [a, b]) : null);
    rule('CAtom', `CCol COP PREP:between CVal CONJ:${X.and} CVal`, (c, _, __, a, ___, b) => a.n != null && b.n != null ? leafC(c, 'between', [a, b]) : null);
    rule('CAtom', 'CCol PREP:in CVals', (c, _, vs) => leafC(c, 'in', vs));
    rule('CAtom', 'CCol COP PREP:in CVals', (c, _, __, vs) => leafC(c, 'in', vs));
    rule('CAtom', 'CCol COP BLANK', c => leafC(c, 'blank'));
    rule('CAtom', 'CCol NOT BLANK', c => leafC(c, 'present'));
    rule('CAtom', 'CCol COP NOT BLANK', c => leafC(c, 'present'));
    rule('CCol', 'Head', h => X.cond.subjects.includes(h.type) && !h.generic ? h : null);
    rule('CCol', 'DET Head', (_, h) => X.cond.subjects.includes(h.type) && !h.generic ? h : null);
    rule('CVal', 'Quantity', q => ({ n: q.n, ...(q.unit ? { unit: q.unit } : {}) }));
    rule('CVal', 'NOUN', t => ({ s: t.value ?? t.word }));
    rule('CVal', 'IDENT', t => ({ s: t.name }));
    rule('CVal', 'LIT', t => ({ s: t.value }));
    rule('CVal', 'UNK', t => ({ s: t.word }));
    rule('CVals', 'CVal', v => [v]);
    rule('CVals', 'CVal COMMA CVals', (v, _, r) => [v, ...r]);
    rule('CVals', 'CVal CONJ CVals', (v, _, r) => [v, ...r]);
    rule('PP', 'PREP Cond', (p, c) => ({ kind: 'pp', prep: p.word, canon: p.canon, val: [node(c)] }));
    for (const p of X.condPostPreps) rule('PostMod', `PREP:${p} Cond`, (_, c) => ({ prep: p, np: node(c) }));   // "samples with au above 0.1"
  }
  return R;
}
