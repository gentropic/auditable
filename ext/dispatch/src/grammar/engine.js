// @gcu/dispatch grammar — the clause engine. Builds a lexicon from ontology + locale, tokenizes
// (multiword, stems, identifiers, a one-edit typo pre-pass), parses with the Earley chart (strict,
// then with a repair budget), binds the parse to a verb frame (prepositions = role labels, types prune),
// resolves against the session (names, recency, quantifiers, ellipsis), and echoes the reading back.
//
//   understand(text, session, {repair:{budget}}) → { status: ok | ambiguous | clarify | reject | outofscope, … }
//   suggest(text, session) / preview(text, session)   predictive input
//   assemble({verb, theme, roles}, session)          a slot tagger's groups through the same binder
//
// See SPEC.md "The grammar rung" for the pipeline, the verdicts and the ceiling.
import { chart } from './earley.js';
import { buildGrammar } from './grammar.js';
import { ENGLISH } from './locales/en.js';

function dl(a, b) { // Damerau-Levenshtein
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// ───────────────────────────── engine ─────────────────────────────
export function createEngine(ont, locale = ENGLISH) {
  // ---- lexicon from ontology + locale ----
  const LEX = {};
  const add = (words, cat, extra = {}) => { for (const w of words.split('|')) (LEX[w] ??= []).push({ cat, word: w, ...extra }); };
  for (const cat of ['DET', 'REF', 'QUANT', 'EXCEPT', 'CONJ', 'COMMA', 'THEN', 'BUT', 'PRON', 'AGAIN', 'QWORD', 'FILLER', 'REL', 'SUBJ', 'WH', 'COP', 'WHCOP']) if (locale[cat]) add(locale[cat], cat);
  for (const [w, r] of Object.entries(locale.times)) add(w, 'TIME', { from: r[0], to: r[1] });
  for (const [w, c] of Object.entries(locale.comps)) add(w, 'COMP', { sign: c[0], sup: !!c[1] });
  for (const p of locale.PREP.split('|')) add(p, 'PREP', { canon: locale.preps[p] ?? [p] });
  const L = k => `${k}_${locale.code}`;   // ontology synonym column for this locale, falling back to the default column
  const col = (o, k) => o[L(k)] ?? o[k];
  const VERBS = Object.fromEntries(ont.verbs.map(v => [v.name, v]));
  for (const v of ont.verbs) add(col(v, 'words').join('|'), 'VERB', { verb: v.name });
  const NOUNS = Object.fromEntries(ont.nouns.map(n => [n.type, n]));
  for (const n of ont.nouns) {
    for (const [value, words] of Object.entries(col(n, 'words') ?? {})) add(words.join('|'), 'NOUN', { type: n.type, value });
    if (col(n, 'generic')) add(col(n, 'generic').join('|'), 'NOUN', { type: n.type, value: null, generic: true });
  }
  for (const u of ont.units) add(col(u, 'words').join('|'), 'UNIT', { dim: u.dim, unit: u.unit });
  const MULTI = Object.keys(LEX).filter(k => k.includes(' ')).map(k => k.split(' ')).sort((a, b) => b.length - a.length);
  const SINGLE = Object.keys(LEX).filter(k => !k.includes(' '));
  const CONTENT = new Set(Object.keys(LEX).filter(k => LEX[k].some(s => ['NOUN', 'VERB', 'UNIT'].includes(s.cat))));
  const STEMS = {};   // stem → senses of content words, so inflected forms nobody listed still resolve
  for (const k of CONTENT) if (!k.includes(' ')) (STEMS[locale.stem(k)] ??= []).push(...LEX[k].filter(s => ['NOUN', 'VERB', 'UNIT'].includes(s.cat)).map(s => ({ ...s, lexeme: k })));
  const NEEDS_ID = new Set(ont.nouns.filter(n => n.needsId).map(n => n.type));

  // ---- type-driven helpers used inside the grammar ----
  const X = {
    headFirst: !!locale.headFirst,
    identTypes: new Set(ont.nouns.filter(n => n.ident).map(n => n.type)),
    postmodPreps: [...new Set(ont.postmods.map(p => p.prep))],
    postmodQuantity: new Set(ont.postmods.filter(p => p.quantity).map(p => p.prep)),
    compound(a, h) {
      if (a.type === h.type && !a.generic && h.generic) return { ...h, value: a.value, generic: false };
      for (const c of ont.compounds) if (c.mod === a.type && c.heads.includes(h.type)) return { ...h, attrs: { ...h.attrs, [c.attr]: a.value ?? '?' } };
      return null;
    },
    postmod(n, m) {
      if (m.rel) { if (!X.identTypes.has(n.type) || n.type === 'search') return null; return { rel: { ...(n.rel ?? {}), ...m.rel }, generic: false }; }
      if (m.qmod) return X.qmod(m.q, n) ? { attrs: { ...n.attrs, [ont.qmods.find(x => x.head === n.type).attr]: m.q }, generic: false } : null;
      for (const p of ont.postmods) {
        if (p.prep !== m.prep || !p.heads.includes(n.type)) continue;
        if (p.quantity) return { attrs: { ...n.attrs, [p.attr]: m.q } };
        if (m.np.type === p.mod) return { attrs: { ...n.attrs, [p.attr]: p.byName ? (m.np.name ?? m.np.ref ?? '?') : m.np.value } };
      }
      return null;
    },
    qmod(q, h) {
      for (const m of ont.qmods) if (m.head === h.type && m.dims.includes(q.dim)) return { ...h, attrs: { ...h.attrs, [m.attr]: q }, generic: false };
      return null;
    },
  };
  const R = buildGrammar(X);

  // ---- tokenizer ----
  function tokenize(text, session) {
    const raw = text.toLowerCase().replace(/([,?!])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
    const toks = []; const notes = []; const unknown = [];
    for (let i = 0; i < raw.length;) {
      let hit = null;
      let mwPlural = false;
      for (const mw of MULTI) if (mw.every((w, k) => raw[i + k] === w || (k === mw.length - 1 && raw[i + k] && locale.stem(raw[i + k]) === locale.stem(w) && LEX[mw.join(' ')].some(x => x.cat === 'NOUN')))) { hit = mw; mwPlural = locale.plural(raw[i + mw.length - 1]); break; }
      if (hit) { const w = hit.join(' '); if (LEX[w][0].cat !== 'FILLER') toks.push({ word: w, senses: mwPlural ? LEX[w].map(x => x.cat === 'NOUN' ? { ...x, plural: true } : x) : LEX[w] }); i += hit.length; continue; }
      const w = raw[i++];
      if (w === '?' || w === '!') continue;
      if (LEX[w]) { if (LEX[w][0].cat !== 'FILLER') { const plural = locale.plural(w); toks.push({ word: w, senses: plural ? LEX[w].map(x => x.cat === 'NOUN' ? { ...x, plural } : x) : LEX[w] }); } continue; }
      if (/^\d+(\.\d+)?$/.test(w)) { toks.push({ word: w, senses: [{ cat: 'NUM', n: parseFloat(w) }] }); continue; }
      if (session?.names?.[w]) { toks.push({ word: w, senses: [{ cat: 'IDENT', name: w, type: session.names[w] }] }); continue; }
      if (/^[a-z]+\d+$/.test(w)) { toks.push({ word: w, senses: [{ cat: 'IDENT', name: w }] }); continue; }
      const st = STEMS[locale.stem(w)];
      if (st) { const plural = locale.plural(w); toks.push({ word: w, senses: st.map(s => ({ ...s, plural })), stemmed: true }); continue; }
      const tol = w.length < 7 ? 1 : 2;
      const cands = SINGLE.filter(k => k.length > 2 && CONTENT.has(k) && dl(w, k) <= tol);   // never repair into a function word
      if (cands.length === 1) { notes.push(`read "${w}" as "${cands[0]}"`); toks.push({ word: cands[0], senses: LEX[cands[0]], repaired: w }); continue; }
      if (cands.length > 1) notes.push(`"${w}" could be ${cands.map(c => `"${c}"`).join(' / ')} — not guessing`);
      unknown.push(w); toks.push({ word: w, senses: [{ cat: 'UNK' }] });
    }
    return { toks, notes, unknown };
  }

  // terminal match: a token yields one node per matching sense (lexical ambiguity lives here)
  const term = (sym, t) => {
    const [cat, word] = sym.split(':');
    return t.senses.filter(s => s.cat === cat && (!word || t.word === word || (cat === 'PREP' && s.canon.includes(word)))).map(s => ({ ...s, word: t.word }));
  };
  const FAB = { PREP: () => ({ cat: 'PREP', word: '∅', canon: ['*'] }), DET: () => ({ cat: 'DET', word: '∅' }), LATE: () => ({ cat: 'LATE' }) };
  // repair costs — a dozen numbers, calibrated by calib.mjs against the mutation benchmark
  const COSTS = { skipFunc: 0.5, skipUnk: 0.6, skipContent: 1.5, skipTagged: 2, skipO: 0.5, insPrep: 1, insPrepTagged: 0.5, insDet: 0.5, order: 1, subst1: 0.4, subst2: 1.2, substKnown: 2 };
  const NEAR_POOL = Object.keys(LEX).filter(k => !k.includes(' ') && LEX[k].some(x => ['NOUN', 'VERB', 'UNIT', 'PREP'].includes(x.cat)));
  const CONTENT_CATS = ['NOUN', 'VERB', 'UNIT', 'NUM', 'IDENT', 'PREP'];
  function makeParser(toks, repair) {
    // repair = { budget, tags?, costs? } — tags (from a slot tagger) shape the costs: cheap to skip an O token,
    // dear to skip a role token, cheap to insert a preposition right before a role span
    let opts = {};
    if (repair?.budget) {
      const K = { ...COSTS, ...(repair.costs ?? {}) };
      const tag = i => repair.tags?.[i] ?? null;
      const nearCache = new Map();
      const nearFor = i => {   // content lexemes within edit distance 2 of this token, once per token
        if (nearCache.has(i)) return nearCache.get(i);
        const w = toks[i].word; const out = [];
        if (w.length >= 2 && !/^\d/.test(w)) {
          for (const k of NEAR_POOL) { if (Math.abs(k.length - w.length) > 2) continue; const d = dl(w, k); if (d >= 1 && d <= 2 && (d === 1 || w.length >= 5)) for (const s of LEX[k]) if (CONTENT_CATS.includes(s.cat)) out.push({ v: { ...s, word: k }, cost: (d === 1 ? K.subst1 : K.subst2) * (toks[i].senses.every(x => x.cat === 'UNK') ? 1 : K.substKnown), to: k }); }
          for (const [name, type] of Object.entries(repair.names ?? {})) { const d = dl(w, name); if (d === 1) out.push({ v: { cat: 'IDENT', name, type, word: name }, cost: K.subst1, to: name }); }
        }
        nearCache.set(i, out); return out;
      };
      opts = { budget: repair.budget,
        skip: i => tag(i) && tag(i) !== 'O' ? K.skipTagged : toks[i].senses.every(x => x.cat === 'UNK') ? K.skipUnk : tag(i) === 'O' ? K.skipO : toks[i].senses.some(x => CONTENT_CATS.includes(x.cat)) ? K.skipContent : K.skipFunc,
        insert: (sym, i) => sym === 'PREP' ? (tag(i)?.startsWith('R_') ? K.insPrepTagged : K.insPrep) : sym === 'DET' ? K.insDet : sym === 'LATE' ? K.order : Infinity,
        near: (sym, i) => { const [cat, word] = sym.split(':'); return nearFor(i).filter(x => x.v.cat === cat && (!word || x.v.word === word)); },
        fabricate: sym => FAB[sym]?.() ?? null };
    }
    const C = chart(R, toks, term, 'Program', opts);
    const parse = (sym, i) => C.spans(sym, i).flatMap(j => C.derive(sym, i, j).map(d => ({ node: d.v, end: j, cost: d.cost, repairs: d.repairs })));
    parse.chart = C;
    return parse;
  }
  const describeRepairs = (toks, repairs) => repairs.map(r => r.op === 'skip' ? `ignored "${r.word}"` : r.op === 'subst' ? `read "${r.word}" as "${r.to}"` : r.sym === 'LATE' ? 'read the arguments out of order' : `assumed ${r.sym === 'PREP' ? 'a preposition' : 'an article'} before "${toks[r.at]?.word ?? 'the end'}"`);
  // human names for the terminals the chart was waiting for
  const EXPECT = { NOUN: 'a thing', VERB: 'a verb', DET: 'an article', PREP: 'a preposition', NUM: 'a number', UNIT: 'a unit', IDENT: 'a name', CONJ: `'${locale.CONJ.split('|')[0]}'`, THEN: `'${locale.THEN.split('|')[0]}'`, COMMA: "','", QUANT: 'a quantifier', REF: `'${locale.REF.split('|')[0]}'`, PRON: 'a pronoun', REL: `'${locale.REL.split('|')[0]}'`, SUBJ: `'${locale.SUBJ.split('|')[0]}'`, TIME: 'a time', COMP: 'a comparative', WH: 'a question word', COP: `'${(locale.COP ?? 'is').split('|')[0]}'`, WHCOP: `'${(locale.WHCOP ?? 'what is').split('|')[0]}'`, EXCEPT: `'${locale.EXCEPT.split('|')[0]}'`, BUT: `'${locale.BUT.split('|')[0]}'`, AGAIN: `'${locale.AGAIN.split('|')[0]}'` };
  const expectName = sym => { const [cat, w] = sym.split(':'); if (cat === 'LATE') return null; return w ? `'${w}'` : (EXPECT[cat] ?? cat); };

  // ---- binding ----
  const typeOf = v => v.type === 'quantity' ? `quantity:${v.dim}` : v.type;
  const typeOk = (want, v) => want === '*' || v.type === '*' || want === typeOf(v) || (v.type === 'quantity' && ((want === 'quantity:*' && v.dim !== 'bare') || (v.dim === 'bare' && want !== 'quantity:*' && want.startsWith('quantity:'))));   // a bare number fits a typed quantity slot (the unit is assumed), never an any-quantity one
  const lbl = verb => VERBS[verb].label.toLowerCase();

  function bind(cmd) {
    if (cmd.verb == null) return bindElided(cmd);
    const F = VERBS[cmd.verb]; const problems = [];
    let alts = [{ verb: cmd.verb, theme: null, roles: {} }];
    for (const a of cmd.args) {
      if (a.kind === 'np') {
        const bad = a.list.filter(n => !F.theme.some(t => typeOk(t, n)));
        if (bad.length) { problems.push(`"${lbl(cmd.verb)}" takes ${F.theme.join('/')}, not ${bad.map(describe).join(', ')}`); return { alts: [], problems }; }
        alts = alts.map(b => b.theme ? null : { ...b, theme: a.list }).filter(Boolean);
        if (!alts.length) problems.push('two things in object position — which one did you mean?');
        continue;
      }
      const byPrep = Object.entries(F.roles).filter(([, r]) => a.canon.includes('*') || r.preps.some(p => a.canon.includes(p)));
      if (!byPrep.length) { problems.push(`"${a.prep}" is not something ${lbl(cmd.verb)} understands`); return { alts: [], problems }; }
      for (const v of a.val) {
        const roles = byPrep.filter(([, r]) => r.types.some(t => typeOk(t, v)));
        if (!roles.length) {
          problems.push(`"${a.prep} ${describe(v)}": after "${a.prep}" ${lbl(cmd.verb)} expects ${byPrep.map(([k, r]) => `${k} (${r.types.join('/')})`).join(' or ')}`);
          return { alts: [], problems };
        }
        alts = alts.flatMap(b => roles.map(([k]) => ({ ...b, roles: { ...b.roles, [k]: [...(b.roles[k] ?? []), v] } })));
      }
    }
    return { alts, problems };
  }

  // no verb was said: try every frame the ontology marks elidable. Readings that bind survive; more than one
  // surviving frame is an ambiguity for the layer above, not a guess here.
  function bindElided(cmd) {
    const frames = ont.verbs.filter(v => v.elidable);
    const theme = cmd.args.find(a => a.kind === 'np');
    const what = theme ? theme.list.map(describe).join(', ') : 'that';
    if (!frames.length) return { alts: [], problems: [`no verb, and nothing in this vocabulary is asked for on its own (${what})`] };
    const alts = [], near = [];
    for (const F of frames) {
      const r = bind({ ...cmd, verb: F.name });
      if (r.alts.length) alts.push(...r.alts);
      else if (theme && theme.list.every(n => F.theme.some(t => typeOk(t, n)))) near.push(...r.problems);   // the thing fit, an argument did not
    }
    if (alts.length) return { alts, problems: [] };
    return { alts: [], problems: near.length ? [...new Set(near)] : [`no verb, and nothing takes ${what} on its own`] };
  }

  // ---- resolution ----
  function resolve(b, session, prev) {
    const missing = []; const notes = [];
    const F = VERBS[b.verb];
    const out = { verb: b.verb, theme: [], roles: {} };
    const fix = (list, slot) => list.flatMap(n => {
      if (n.type === 'quantity') return [n];
      if (n.pron) { const src = prev ?? session.last; if (!src?.theme?.length) { missing.push(`"${n.pron}" — nothing to refer to`); return []; } return src.theme; }
      if (n.all) { const pool = session.objects.filter(o => o.type === n.type); const ex = new Set(n.except.map(e => e.value)); return pool.filter(o => !ex.has(o.value)); }
      const now = session.now ?? 0; const DAY = 86400000;
      const relOk = o => { const r = n.rel; if (!r) return true;
        if (r.verb && o.by && o.by !== r.verb) return false;
        if (r.when && !(now - o.t >= r.when.from * DAY && now - o.t < r.when.to * DAY)) return false;
        return true; };
      if (n.rel && !n.ref) {
        let hits = session.objects.filter(o => o.type === n.type && Object.entries(n.attrs).every(([k, v]) => o.attrs?.[k] === v) && relOk(o));
        if (n.rel.cmp) { const key = o => o.attrs?.search?.n ?? o.attrs?.radius?.n ?? -Infinity; hits = hits.filter(o => key(o) > -Infinity).sort((a, b) => n.rel.cmp.sign === '+' ? key(b) - key(a) : key(a) - key(b)).slice(0, 1); }
        if (!hits.length) { missing.push(`no ${describe(n)} in session`); return []; }
        if (hits.length > 1 && !n.plural) { missing.push(`which ${n.type}? (${hits.map(describe).join(', ')})`); return []; }
        return [...hits].sort((a, b) => a.t - b.t);
      }
      if (n.cmp) {   // "a bigger search": scaled from the last command's value, or the session's extreme
        const last = session.last?.roles?.[slot]?.[0]; const base = last?.type === 'quantity' ? last : last?.attrs?.radius;
        const step = ont.scales?.[slot] ?? 1.5;
        if (n.cmp.sup || !base) { const pool = session.objects.map(o => o.attrs?.search ?? o.attrs?.radius).filter(q => q?.n != null); if (!pool.length) { missing.push(`${describe(n)} — ${P.than} what?`); return []; }
          const q = pool.sort((a, b) => n.cmp.sign === '+' ? b.n - a.n : a.n - b.n)[0]; return [{ ...q }]; }
        return [{ type: 'quantity', n: +(n.cmp.sign === '+' ? base.n * step : base.n / step).toFixed(1), unit: base.unit, dim: base.dim }];
      }
      if (n.ref) {
        const pool = session.objects.filter(o => o.type === n.type && (!n.attrs.variable || o.attrs?.variable === n.attrs.variable) && relOk(o)).sort((x, y) => y.t - x.t);
        const pick = locale.firstRef.includes(n.ref) ? pool.at(-1) : pool[0];
        if (!pick) { missing.push(`no ${n.ref} ${n.type}${n.attrs.variable ? ' for ' + n.attrs.variable : ''} in session`); return []; }
        return [pick];
      }
      if (n.name) { const o = session.objects.find(o => o.name === n.name); if (!o) { missing.push(`${n.type} "${n.name}" not found`); return []; } if (o.type !== n.type) { missing.push(`"${n.name}" is a ${o.type}, not a ${n.type}`); return []; } return [o]; }
      if (slot === 'object' && F.creates) return [{ ...n, fresh: true }];
      if (n.generic && n.value == null) {
        const hits = session.objects.filter(o => o.type === n.type && Object.entries(n.attrs).every(([k, v]) => o.attrs?.[k] === v));
        if (hits.length === 1 || (hits.length > 1 && n.plural)) return [...hits].sort((a, b) => a.t - b.t);   // plural = all of them, oldest first; singular with several matches asks
        if (NEEDS_ID.has(n.type)) {
          if (!hits.length) missing.push(NOUNS[n.type].words ? `which ${n.type}?` : `no ${describe(n)} in session`);
          else missing.push(`which ${n.type}? (${hits.map(describe).join(', ')})`);
          return [];
        }
      }
      return [n];
    });
    if (b.theme) out.theme = fix(b.theme, 'object');
    for (const [k, v] of Object.entries(b.roles)) out.roles[k] = fix(v, k);
    if (F.creates) for (const t of out.theme) { t.by = b.verb; t.t = session.now ?? 0; for (const k of ont.inherit) if (out.roles[k]?.length === 1) t.attrs = { ...t.attrs, [k]: out.roles[k][0].value }; }
    for (const [k, vs] of Object.entries(out.roles)) if (!vs.every(v => F.roles[k].types.some(t => typeOk(t, v)))) return { cmd: out, missing, notes, dead: true };
    if (b.theme && !out.theme.every(t => F.theme.some(ty => typeOk(ty, t)))) return { cmd: out, missing, notes, dead: true };
    for (const r of F.required) {
      if (r === 'theme') { if (!out.theme.length && !missing.length) missing.push(`${lbl(b.verb)} what?`); }
      else if (!out.roles[r]) missing.push(`missing ${r} (${F.roles[r].types.join('/')}) — say "${F.roles[r].preps[0]} …"`);
    }
    if (F.minTheme && out.theme.length + (out.roles.against?.length ?? 0) < F.minTheme) missing.push(`${lbl(b.verb)} needs at least ${F.minTheme} things`);
    for (const s of F.sanity ?? []) for (const v of out.roles[s.role] ?? []) for (const t of out.theme)
      if (v.attrs?.[s.attr] && t.value && v.attrs[s.attr] !== t.value) notes.push(`${describe(v)} was made for ${v.attrs[s.attr]}, this is ${t.value}`);
    for (const [k, vs] of Object.entries(out.roles)) for (const q of vs) if (q.type === 'quantity' && q.dim === 'bare') {
      const want = F.roles[k].types.find(t => t.startsWith('quantity:'))?.split(':')[1];
      const u = ont.units.find(u => u.dim === want); if (u) notes.push(`${P.assuming} ${q.n} ${u.unit}`);
    }
    return { cmd: out, missing, notes };
  }

  // ---- generator: canonical phrase in the active locale (the grammar run backwards, at the level the echo needs) ----
  const P = locale.phr;
  const typeName = t => (col(NOUNS[t] ?? {}, 'generic') ?? [t])[0];                      // "variogram" / "variograma"
  const valueName = (t, v) => t === 'variable' ? v : ((col(NOUNS[t] ?? {}, 'words') ?? {})[v]?.[0] ?? v);   // Cu stays Cu; "west" / "oeste"
  const roleLabel = k => (ont[`roleLabels_${locale.code}`] ?? {})[k] ?? k;
  function describe(n) {
    if (n.type === 'quantity') return `${n.n}${n.unit ? ' ' + n.unit : ''}`;
    if (n.type === 'unit') return n.unit;
    if (n.type === '*') return n.pron ?? 'that';
    if (n.all) return `${locale.agree[locale.gender(typeName(n.type))]?.[P.every] ?? P.every} ${typeName(n.type)}${n.except?.length ? ` ${P.except} ` + n.except.map(describe).join(', ') : ''}`;
    if (n.attrs?.radius) return describe(n.attrs.radius);
    const head = n.value != null ? valueName(n.type, n.value) : typeName(n.type);
    const mods = [];                                                                    // adjective-like modifiers
    if (n.attrs?.model) mods.push(valueName('vmodel', n.attrs.model));
    if (n.attrs?.variable) mods.push(n.attrs.variable);
    if (n.attrs?.domain) mods.push(valueName('domain', n.attrs.domain));
    for (const c of ont.compounds) if (c.echo && n.attrs?.[c.attr] != null) mods.push(valueName(c.mod, n.attrs[c.attr]));   // "landlocked country"
    const g = locale.gender(head); const agree = w => locale.agree[g]?.[w] ?? w;
    const pre = []; if (n.fresh) pre.push(agree(P.new)); if (n.ref) pre.push(locale.firstRef.includes(n.ref) ? n.ref : locale.newRef.includes(n.ref) ? agree(P.new) : agree(P.last));
    if (n.cmp) pre.push(Object.entries(locale.comps).find(([, c]) => c[0] === n.cmp.sign && !!c[1] === n.cmp.sup)?.[0] ?? '');
    const post = [];
    if (n.name) post.push(n.name);
    if (n.attrs?.run) post.push(`${P.fromRun} ${n.attrs.run}`);
    if (n.attrs?.length) post.push(describe(n.attrs.length));
    if (n.attrs?.above) post.push(`${P.above} ${describe(n.attrs.above)}`);
    if (n.attrs?.below) post.push(`${P.below} ${describe(n.attrs.below)}`);
    if (n.rel?.when) post.push(Object.entries(locale.times).find(([, r]) => r[0] === n.rel.when.from && r[1] === n.rel.when.to)?.[0] ?? '');
    if (n.rel?.verb) post.push(`(${col(VERBS[n.rel.verb], 'words')[0]})`);
    const core = locale.headFirst ? [head, ...mods.map(m => /^[A-Z]/.test(m) ? `${P.of} ${m}` : m)] : [...mods, head];   // "variograma esférico de Cu" / "spherical Cu variogram"
    return [...pre, ...core, ...post].join(' ');
  }
  function echo(c) {
    const parts = [c.theme.length ? `${col(VERBS[c.verb], 'label')} ${c.theme.map(describe).join(', ')}` : col(VERBS[c.verb], 'label')];
    for (const k of ont.echoOrder) if (c.roles[k]?.length) { const vs = c.roles[k]; const redundant = vs.every(v => v.type === k && describe(v).includes(typeName(v.type))); parts.push(`${redundant ? '' : roleLabel(k) + ' '}${vs.map(describe).join(', ')}`); }
    return parts.join('; ') + '.';
  }

  function smallestDeadSpan(toks, C) {
    let best = null;
    for (const sym of ['Head', 'Core', 'NP', 'PostMod']) for (let i = 0; i < toks.length; i++) for (const j of C.spans(sym, i)) {
      if (j - i < 2 || C.derive(sym, i, j).length) continue;
      if (!best || j - i < best.len) best = { len: j - i, sym, i, j };
    }
    if (!best) return null;
    const words = toks.slice(best.i, best.j).map(t => t.word);
    const types = toks.slice(best.i, best.j).flatMap(t => t.senses.filter(s => s.cat === 'NOUN').map(s => s.type));
    const why = best.sym === 'Head' ? `a ${types[0] ?? 'thing'} does not modify a ${types.at(-1) ?? 'thing'}` : best.sym === 'PostMod' ? 'that modifier does not apply to this kind of thing' : 'these do not combine';
    return { text: words.join(' '), why };
  }
  function islands(toks, parse) {
    const segs = []; let i = 0;
    while (i < toks.length) {
      let best = null;
      for (const sym of ['Cmd', 'PP', 'NPList', 'Quantity']) for (const r of parse(sym, i)) if (r.end > i && (!best || r.end > best.end)) best = { sym, end: r.end };
      if (best) { segs.push({ text: toks.slice(i, best.end).map(t => t.word).join(' '), as: best.sym }); i = best.end; }
      else { const last = segs.at(-1); const w = toks[i].word; if (last && !last.as) last.text += ' ' + w; else segs.push({ text: w, as: null }); i++; }
    }
    return segs;
  }

  function ellipsis(c, session, problems) {
    if (!session.last) { problems.add('nothing to repeat yet'); return null; }
    const L = session.last; const F = VERBS[L.verb];
    const themeNP = c.args.find(a => a.kind === 'np');
    const args = [{ kind: 'np', list: themeNP ? themeNP.list : L.theme }];
    const overridden = new Set();
    for (const a of c.args.filter(a => a.kind === 'pp')) {
      const fits = Object.entries(F.roles).filter(([, r]) => (a.canon.includes('*') || r.preps.some(p => a.canon.includes(p))) && a.val.every(v => r.types.some(t => typeOk(t, v))));
      if (!fits.length && !themeNP && a.val.every(v => F.theme.some(t => typeOk(t, v)))) { args[0] = { kind: 'np', list: a.val }; continue; }
      args.push(a);
      for (const [k] of fits) overridden.add(k);
    }
    for (const [k, v] of Object.entries(L.roles)) if (!overridden.has(k)) args.push({ kind: 'pp', prep: F.roles[k].preps[0], canon: [F.roles[k].preps[0]], val: v });
    return { kind: 'cmd', verb: L.verb, args };
  }

  const fanout = c => (VERBS[c.verb].distributive && c.theme.length > 1) ? c.theme.map(t => ({ ...c, theme: [t] })) : [c];

  function understand(text, session, opts = {}) {
    const { toks, notes, unknown } = tokenize(text, session);
    const diag = { notes, unknown, coverage: null, parses: 0, repairs: [] };
    if (!toks.length) return { status: 'reject', reasons: ['nothing to parse'], diag };
    const isQ = toks[0].senses.some(s => s.cat === 'QWORD'), isUnk = toks[0].senses.every(s => s.cat === 'UNK');
    const parse = makeParser(toks);
    const strictFull = isUnk ? [] : parse('Program', 0).filter(r => r.end === toks.length).map(r => ({ ...r, repairs: [] }));
    diag.parses = strictFull.length;
    let result = strictFull.length ? semantic(strictFull, toks, session, diag, opts) : null;
    if ((!result || result.status === 'reject') && opts.repair?.budget) {
      // error-correcting pass: candidate derivations by ascending repair cost; the first tier that survives binding wins
      const P2 = makeParser(toks, { ...opts.repair, names: session.names }); const C2 = P2.chart;
      const all = P2('Program', 0).flatMap(r => { let c = r.cost; const extra = []; for (let k = r.end; k < toks.length; k++) { c += C2.skipCost(k); extra.push({ op: 'skip', at: k, word: toks[k].word }); } return c <= opts.repair.budget && c > 0 ? [{ ...r, cost: c, repairs: [...r.repairs, ...extra] }] : []; });
      for (const cost of [...new Set(all.map(r => r.cost))].sort((a, b) => a - b)) {
        const d2 = { ...diag, repairs: [], repairCost: cost };
        const r2 = semantic(all.filter(r => r.cost === cost), toks, session, d2, opts);
        if (r2.status !== 'reject') { Object.assign(diag, d2); return r2; }
      }
    }
    if (result) return result;
    if (isQ) return { status: 'outofscope', reasons: ['an open question — I read closed ones (what is …, which … are …), the rest needs the tier above'], diag };
    if (isUnk) return { status: 'reject', reasons: [`"${toks[0].word}" is not a verb I know`], diag };
    return semantic([], toks, session, diag, opts);   // no parse at all: chart diagnostics
  }
  function semantic(full, toks, session, diag, opts) {
    const repairsOf = full.map(r => r.repairs); full = full.map(r => r.node);
    if (!full.length) {
      const parse = makeParser(toks); const C = parse.chart;
      diag.coverage = islands(toks, parse);
      const stuck = diag.coverage.filter(s => !s.as).map(s => `"${s.text}"`);
      const got = diag.coverage.filter(s => s.as).map(s => `"${s.text}"`);
      const at = C.furthest;   // the chart died here: this token could not be scanned
      const exp = [...new Set(C.expected().map(expectName).filter(Boolean))].sort();
      diag.expected = exp; diag.stoppedAt = at;
      const where = at < toks.length ? `at "${toks[at].word}"` : 'at the end';
      const reasons = [];
      if (stuck.length) reasons.push(`understood ${got.join(', ') || 'nothing'}; could not place ${stuck.join(', ')}`);
      else if (diag.coverage[0]?.as === 'Cmd' && diag.coverage.length > 1) reasons.push(`understood "${diag.coverage[0].text}"; "${diag.coverage.slice(1).map(r => r.text).join(' ')}" is left over`);
      // the grammar accepted the whole input but the type actions killed every reading: name the smallest span that died
      const dead = at === toks.length ? smallestDeadSpan(toks, C) : null;
      if (dead) reasons.push(`"${dead.text}" fits the grammar but not the types — ${dead.why}`);
      else reasons.push(`stopped ${where}${at < toks.length && !toks[at].senses.some(s => s.cat !== 'UNK') ? ' (unknown word)' : ''}; expected ${exp.length ? exp.join(', ') : 'nothing more'}`);
      return { status: 'reject', reasons, diag };
    }

    const readings = []; const perParse = []; const readingParse = [];
    for (const [pi, prog] of full.entries()) {
      let seqAlts = [[]]; let dead = false; const problems = new Set();
      for (const c of prog) {
        const cmd = c.kind === 'again' ? ellipsis(c, session, problems) : c;
        if (!cmd) { dead = true; break; }
        const { alts, problems: p } = bind(cmd);
        p.forEach(x => problems.add(x));
        if (!alts.length) { dead = true; break; }
        seqAlts = seqAlts.flatMap(s => alts.map(a => [...s, a]));
      }
      perParse.push(problems);
      if (!dead) for (const s of seqAlts) { readings.push(s); readingParse.push(pi); }
    }
    const problems = perParse.sort((a, b) => a.size - b.size)[0] ?? new Set();
    const seen = new Map();
    for (const [ri, r] of readings.entries()) { const k = JSON.stringify(r); if (!seen.has(k)) seen.set(k, { r, pi: readingParse[ri] }); }
    const uniq = [...seen.values()].map(x => x.r); const uniqParse = [...seen.values()].map(x => x.pi);
    if (!uniq.length) return { status: 'reject', reasons: [...problems], diag };

    const resolved = uniq.map(seq => { let prev = null; return seq.map(b => { const r = resolve(b, session, prev); prev = r.cmd; return r; }); });
    const alive = resolved.filter(seq => seq.every(r => !r.dead));
    if (!alive.length) return { status: 'reject', reasons: ['a reference resolved to the wrong kind of thing for every reading'], diag };
    const clean = alive.filter(seq => seq.every(r => !r.missing.length));
    if (!clean.length) {
      const missing = [...new Set(alive.flatMap(seq => seq.flatMap(r => r.missing)))];
      return { status: 'clarify', reasons: missing, partial: alive[0].map(r => echo(r.cmd)), diag };
    }
    const echos = clean.map(seq => seq.map(r => echo(r.cmd)).join(` ${P.then}: `));
    const distinct = [...new Set(echos)];
    if (distinct.length > 1) return { status: 'ambiguous', reasons: ['more than one reading survives'], readings: distinct, diag };

    const cmds = clean[0].map(r => r.cmd).flatMap(fanout);
    const rawRepairs = repairsOf[uniqParse[resolved.indexOf(clean[0])]] ?? [];
    diag.repairs = describeRepairs(toks, rawRepairs);
    // a repair that discarded words it does not know is a guess, not an understanding: ask, showing what it would do
    const droppedUnknown = rawRepairs.filter(r => r.op === 'skip' && toks[r.at].senses.every(x => x.cat === 'UNK')).map(r => `"${r.word}"`);
    if (droppedUnknown.length) return { status: 'clarify', reasons: [`did not understand ${droppedUnknown.join(', ')} — ignore ${droppedUnknown.length > 1 ? 'them' : 'it'}?`], partial: cmds.map(echo), repaired: true, diag };
    diag.notes.push(...clean[0].flatMap(r => r.notes), ...diag.repairs);
    session.last = cmds.at(-1); session.history.push(...cmds);
    return { status: 'ok', commands: cmds, echo: cmds.map(echo).join(` ${P.then}: `), repaired: diag.repairs.length > 0, diag };
  }

  // ───────────────────────────── predictive input ─────────────────────────────
  // suggest(text): what can come next, filtered by grammar (chart expectations), frame (roles still open)
  // and session (objects of the right type). preview(text): echo of what is understood so far, with a hole.
  const surfacePreps = canon => locale.preps && Object.keys(locale.preps).length
    ? Object.entries(locale.preps).filter(([, c]) => c.includes(canon)).map(([w]) => w).slice(0, 1) : [canon];
  function suggest(text, session, limit = 8) {
    const partial = /\S$/.test(text) ? text.split(/\s+/).at(-1).toLowerCase() : '';
    const head = partial ? text.slice(0, text.length - partial.length) : text;
    const { toks } = tokenize(head, session);
    const out = [];
    const push = (word, kind) => { if (!out.some(o => o.word === word) && (!partial || word.toLowerCase().startsWith(partial))) out.push({ word, kind }); };
    if (!toks.length) { for (const v of ont.verbs) push(col(v, 'words')[0], 'verb'); for (const w of locale.AGAIN.split('|').slice(0, 1)) push(w, 'verb'); return out.slice(0, limit); }
    const C = chart(R, toks, term, 'Program');
    if (C.furthest < toks.length) return [];                             // already broken; nothing sensible follows
    const exp = new Set(C.expected());
    const verbTok = [...toks].reverse().find(t => t.senses.some(s => s.cat === 'VERB'));
    const F = verbTok ? VERBS[verbTok.senses.find(s => s.cat === 'VERB').verb] : null;
    const F0 = F ?? (toks.some(t => t.senses.some(s => s.cat === 'AGAIN')) && session.last ? VERBS[session.last.verb] : null);
    // roles already used in this clause (approximate: by preposition canon since the verb)
    const since = verbTok ? toks.lastIndexOf(verbTok) : 0;
    const usedCanon = toks.slice(since).flatMap(t => t.senses.filter(s => s.cat === 'PREP').flatMap(s => s.canon));
    const open = F0 ? Object.entries(F0.roles).filter(([, r]) => !r.preps.some(p => usedCanon.includes(p))) : [];
    const lastTok = toks.at(-1);
    const inList = lastTok?.senses.some(s => s.cat === 'CONJ' || s.cat === 'COMMA');
    const lastPrep = inList ? [...toks.slice(since)].reverse().find(t => t.senses.some(s => s.cat === 'PREP'))?.senses.find(s => s.cat === 'PREP') : lastTok?.senses.find(s => s.cat === 'PREP');
    const objectsOf = types => session.objects.filter(o => types.some(t => t === '*' || o.type === t));
    const wordsOf = t => { const n = NOUNS[t]; if (!n) return []; return [...Object.keys(col(n, 'words') ?? {}).map(v => valueName(t, v)), ...(col(n, 'generic') ?? []).slice(0, 1)]; };
    const nameOf = o => o.name ?? valueName(o.type, o.value);
    if (lastPrep && F0) {                                                  // after a preposition: things the open roles accept
      const roles = Object.entries(F0.roles).filter(([, r]) => r.preps.some(p => lastPrep.canon.includes(p)));
      for (const [, r] of roles) {
        for (const o of objectsOf(r.types)) push(nameOf(o), 'object');
        for (const t of r.types) { if (t.startsWith('quantity')) { const u = ont.units.find(u => u.dim === t.split(':')[1]); push(`200 ${u ? col(u, 'words')[0] : ''}`.trim(), 'value'); } else for (const w of wordsOf(t)) push(w, 'value'); }
      }
    } else if (F0 && (exp.has('NOUN') || exp.has('DET')) && (since === toks.length - 1 || (inList && !lastPrep))) {   // theme position (or continuing the theme list)
      for (const t of F0.theme) { for (const o of objectsOf([t])) push(nameOf(o), 'object'); for (const w of wordsOf(t)) push(w, 'value'); }
      if (F0.theme.includes('*')) for (const o of session.objects.filter(o => o.name)) push(o.name, 'object');
    }
    if (exp.has('PREP') && F0) for (const [k, r] of open) for (const p of surfacePreps(r.preps[0])) push(p, `role:${roleLabel(k)}`);
    if (exp.has('TIME')) for (const w of Object.keys(locale.times).slice(0, 4)) push(w, 'time');
    if (exp.has('COMP')) for (const w of Object.keys(locale.comps).slice(0, 2)) push(w, 'comparative');
    if (exp.has('SUBJ') || exp.has('REL')) push(locale.SUBJ.split('|')[0], 'relative');
    if (exp.has('CONJ')) push(locale.CONJ.split('|')[0], 'and');
    if (exp.has('THEN')) push(locale.THEN.split('|')[0], 'then');
    if (exp.has('EXCEPT')) push(locale.EXCEPT.split('|')[0], 'except');
    if (exp.has('VERB')) for (const v of ont.verbs) push(col(v, 'words')[0], 'verb');
    return out.slice(0, limit);
  }
  function preview(text, session) {
    const { toks } = tokenize(text, session);
    if (!toks.length) return null;
    const C = chart(R, toks, term, 'Program');
    const ends = C.spans('Cmd', 0).filter(j => j <= toks.length).sort((a, b) => b - a);
    for (const j of ends) {                                                // longest prefix that is a whole command
      for (const { v: c } of C.derive('Cmd', 0, j)) {
        const cmd = c.kind === 'again' ? ellipsis(c, session, new Set()) : c; if (!cmd) continue;
        const { alts } = bind(cmd); if (!alts.length) continue;
        const r = resolve(alts[0], session, null); if (r.dead) continue;
        let e = echo(r.cmd).replace(/\.$/, '');
        const tail = toks.slice(j); const prep = tail.find(t => t.senses.some(s => s.cat === 'PREP'))?.senses.find(s => s.cat === 'PREP');
        const F = VERBS[r.cmd.verb];
        if (prep) { const k = Object.entries(F.roles).find(([, ro]) => ro.preps.some(p => prep.canon.includes(p)))?.[0]; e += `; ${k ? roleLabel(k) : prep.word} ${P.hole}`; }
        else if (r.missing.length) e += `; ${P.hole}`;
        return { echo: e + '.', complete: j === toks.length && !r.missing.length, missing: r.missing };
      }
    }
    return null;
  }
  // assemble: a verb plus role→text groups (e.g. from a slot tagger) go through the same binder and resolver
  // as parsed input, so a statistical tagger's guess still has to type-check before it becomes a call.
  function assemble({ verb, theme, roles }, session) {
    const F = VERBS[verb]; if (!F) return { status: 'reject', reasons: [`unknown verb ${verb}`] };
    const np = text => { const { toks } = tokenize(text, session); if (!toks.length) return null; const C = chart(R, toks, term, 'NPList'); const vs = C.derive('NPList', 0, toks.length); return vs.length ? vs[0].v : null; };
    const args = [];
    if (theme) { const l = np(theme); if (!l) return { status: 'reject', reasons: [`cannot read object "${theme}"`] }; args.push({ kind: 'np', list: l }); }
    for (const [k, text] of Object.entries(roles)) {
      if (!F.roles[k]) return { status: 'reject', reasons: [`${verb} has no role ${k}`] };
      const l = np(text); if (!l) return { status: 'reject', reasons: [`cannot read ${k} "${text}"`] };
      args.push({ kind: 'pp', prep: F.roles[k].preps[0], canon: [F.roles[k].preps[0]], val: l });
    }
    const { alts, problems } = bind({ kind: 'cmd', verb, args });
    if (!alts.length) return { status: 'reject', reasons: problems };
    const r = resolve(alts[0], session, null);
    if (r.dead) return { status: 'reject', reasons: ['type check failed'] };
    if (r.missing.length) return { status: 'clarify', reasons: r.missing };
    const cmds = fanout(r.cmd);
    return { status: 'ok', commands: cmds, echo: cmds.map(echo).join(` ${P.then}: `) };
  }
  return { understand, suggest, preview, assemble, echo, describe, tokenize, LEX, VERBS, NOUNS, ont, locale };
}

// the clock a session is born with when the host gives none: day 20, so relative times
// ("yesterday", "last week") have room to resolve in demos and tests
export const DEMO_NOW = 20 * 86400000;
export function makeSession(objects = [], now = DEMO_NOW) {
  const names = Object.fromEntries(objects.filter(o => o.name).map(o => [o.name, o.type]));
  return { objects, names, last: null, history: [], now };
}
