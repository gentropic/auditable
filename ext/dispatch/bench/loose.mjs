// An experiment, kept with its result: a statistical rung over a clause ontology ("loose reading"), not part of the package.
//
// Result (14 Oct 2026, golem's ontology, 90 frames): trained in about 3.4 s from ~6000 generated sentences. On a tenth of
// them held out it read 167 of the 253 the grammar could not (5 wrong). On 31 natural misses written by hand it read 1;
// its intent was often right but its THEME/ARG tags were not, so the rewrites did not parse. Used only to put a verb in
// front of the text for the repair pass, it added 1 right offer and 1 wrong one to the 13 the repair pass made alone.
// golem's rung 4 is the repair pass; this stays here until real corrections (a rejection log) can train it.
//
// When the grammar cannot read a text, a small model trained on the device from the ontology guesses which frame
// was meant and which words are its theme and its arguments. The guess is never the answer: it is rewritten as a
// sentence in the controlled register ("<verb> <theme> <prep> <argument> …") and the grammar reads that sentence,
// with every type check it always makes. The host shows the rewrite and the margin, and decides what to do with them.
//
//   looseCorpus(E, { seed, perFrame, samples, keep, refusals })  → { examples, refusals, stats }
//   trainLoose(E, corpus, { epochs })                            → weights (plain JSON)
//   trainLooseSteps(E, corpus, { epochs })                       → a generator: one epoch per step, weights at the end
//   createLooseReader(E, weights).read(text)                    → { status, verb, margin, tags, rewrite, verdict }
//
// Tokens are the grammar's own (multiwords merged, fillers gone, lexicon senses attached), so the features are the
// ontology's and nothing is listed twice. Tags are three: O, THEME, ARG; which role an argument fills is said by the
// preposition before it, or by its type, the way the grammar places loose things. Intent and tags are averaged
// perceptrons; the tagger decodes with Viterbi over the three tags. Deterministic for a seed.
import { makeSession } from '../src/grammar/engine.js';

const rng = seed => { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const TAGS = ['O', 'THEME', 'ARG'];
const REFUSE = '∅';

// chatter that is no command of any frame; a host adds its own through `refusals`
const CHATTER = {
  en: ['tell me a joke', 'how are you today', 'what is the meaning of life', 'write a poem about rocks', 'who won the game last night', 'book me a flight to lisbon',
    'what should i have for dinner', 'translate this into french', 'play some music', 'send an email to the team', 'what can you do', 'help me', 'are you a robot',
    'good morning', 'i am tired', 'that is wrong', 'do you like geology', 'order more core trays', 'call my mother', 'make it prettier', 'close the program',
    'delete everything', 'is it going to rain', 'what do you think', 'summarise my week', 'remind me why i came here', 'tell me about yourself', 'sing a song'],
  pt: ['me conta uma piada', 'como você está', 'qual o sentido da vida', 'escreve um poema sobre rochas', 'quem ganhou o jogo ontem', 'compra uma passagem para lisboa',
    'o que eu janto hoje', 'traduz isso para o francês', 'toca uma música', 'manda um email para a equipe', 'o que você sabe fazer', 'me ajuda', 'você é um robô',
    'bom dia', 'estou cansado', 'isso está errado', 'você gosta de geologia', 'fecha o programa', 'apaga tudo', 'vai chover', 'o que você acha'],
};
// words people wrap a command in that the banks do not drop as fillers
const WRAP = {
  en: { pre: ['i was wondering if you could ', 'quick question, ', 'for the report ', 'golem i need to know ', 'right so ', 'just checking '], post: [' for the report', ' if you can', ' asap', ' when you have a minute', ' thanks a lot', ' cheers mate'] },
  pt: { pre: ['queria saber se dá para ', 'pergunta rápida, ', 'para o relatório ', 'então '], post: [' para o relatório', ' se der', ' quando puder', ' valeu mesmo'] },
};

export function looseCorpus(E, opts = {}) {
  const { seed = 1, perFrame = 40, samples = {}, keep = null, refusals = [], perturb = 2 } = opts;
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)], chance = p => R() < p;
  const ont = E.ont, L = E.locale, code = L.code;
  const col = (o, k) => o[`${k}_${code}`] ?? o[k];
  const NOUNS = Object.fromEntries(ont.nouns.map(n => [n.type, n]));
  const surf = canon => { if (canon === '' || canon === ':') return canon; const ws = L.PREP.split('|').filter(w => (L.preps[w] ?? [w]).includes(canon)); return ws.length ? pick(ws) : null; };
  const unitWords = dim => ont.units.filter(u => dim === '*' ? u.dim !== 'bare' : u.dim === dim).flatMap(u => col(u, 'words') ?? []);
  const NUMS = [1, 2, 3, 5, 7, 10, 12, 14, 20, 25, 30, 45, 60, 90, 100, 120, 250, 0.5, 1.2, 2.7, 3.5, 12.5];
  const DAYS = Object.keys(L.days ?? {}), MONTHS = Object.keys(L.months ?? {});
  const date = () => chance(0.5) ? pick(DAYS) : `${1 + Math.floor(R() * 28)} ${pick(MONTHS)}`;
  const clock = () => pick(['9am', '14:30', '7 pm', '10:15', '18:00', ...Object.keys(L.clocks ?? {})]);
  // a surface for a thing of a type, or null when this ontology gives no way to say one
  function realise(t) {
    if (samples[t]?.length) return pick(samples[t]);
    if (t.startsWith('quantity:')) { const dim = t.slice(9); if (dim === 'bare') return String(pick(NUMS)); const us = unitWords(dim); return us.length ? `${pick(NUMS)} ${pick(us)}` : null; }
    if (t === 'date') return date();
    if (t === 'clock') return clock();
    if (t === 'unit') { const us = unitWords('*'); return us.length ? pick(us) : null; }
    if (t === 'cond') { const subj = (ont.conditions?.subjects ?? []).flatMap(s => Object.values(col(NOUNS[s] ?? {}, 'words') ?? {}).flat()); return subj.length ? `${pick(subj)} ${pick(['>', '<', '>='])} ${pick(NUMS)}` : null; }
    const n = NOUNS[t]; if (!n) return null;
    const words = Object.values(col(n, 'words') ?? {}).flat(), gen = col(n, 'generic') ?? [];
    return words.length ? pick(words) : gen.length ? pick(gen) : null;
  }
  // one frame said once: segments [{ text, tag }] in order, the verb first
  function say(F) {
    const words = col(F, 'words') ?? [];
    const segs = [];
    if (words.length && !(F.elidable && chance(0.35))) segs.push({ text: pick(words), tag: 'O' });
    else if (!F.elidable) return null;
    const theme = (F.theme ?? []).length && (F.required.includes('theme') || chance(0.6)) ? realise(pick(F.theme)) : null;
    if (F.required.includes('theme') && !theme) return null;
    const args = [];
    for (const [k, r] of Object.entries(F.roles ?? {})) {
      if (k === 'subject') continue;
      if (!F.required.includes(k) && !chance(0.4)) continue;
      const v = realise(pick(r.types)); const p = surf(pick(r.preps));
      if (v == null || p == null) { if (F.required.includes(k)) return null; continue; }
      args.push(p === ':' ? [{ text: ':', tag: 'O' }, { text: v, tag: 'ARG' }] : p ? [{ text: p, tag: 'O' }, { text: v, tag: 'ARG' }] : [{ text: v, tag: 'ARG' }]);
    }
    if (theme) segs.push({ text: theme, tag: 'THEME' });
    for (let i = args.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [args[i], args[j]] = [args[j], args[i]]; }
    const colon = args.findIndex(a => a[0].text === ':'); if (colon >= 0) args.push(...args.splice(colon, 1));   // a payload goes last
    for (const a of args) segs.push(...a);
    return segs;
  }
  const join = segs => { let text = '', at = []; for (const s of segs) { const sep = !text || s.text === ':' ? '' : ' '; text += sep; at.push([text.length, text.length + s.text.length, s.tag]); text += s.text; } return { text, at }; };
  // what people do to a sentence the grammar reads: wrap it, drop a preposition, move the theme last, drop the verb, mistype a word
  const W = WRAP[code] ?? WRAP.en;
  const PERTURB = [
    segs => [{ text: pick(W.pre).trimEnd(), tag: 'O' }, ...segs],
    segs => [...segs, { text: pick(W.post).trimStart(), tag: 'O' }],
    segs => { const i = segs.findIndex((s, k) => k > 0 && s.tag === 'O' && s.text !== ':' && segs[k + 1]?.tag === 'ARG'); return i > 0 ? segs.filter((_, k) => k !== i) : null; },
    segs => { const i = segs.findIndex(s => s.tag === 'THEME'); return i >= 0 && i < segs.length - 1 && !segs.some(s => s.text === ':') ? [...segs.slice(0, i), ...segs.slice(i + 1), segs[i]] : null; },
    segs => segs[0]?.tag === 'O' && segs.length > 1 ? segs.slice(1) : null,
    segs => { const k = segs.findIndex(s => s.tag !== 'O' && /[a-z]{6,}/.test(s.text)); if (k < 0) return null; const w = segs[k].text, m = /[a-z]{6,}/.exec(w), p = m.index + 1 + Math.floor(R() * (m[0].length - 2)); return segs.map((s, i) => i === k ? { ...s, text: w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2) } : s); },
  ];
  const examples = [], seen = new Set(); let tried = 0, readable = 0;
  for (const F of ont.verbs) {
    let made = 0;
    for (let a = 0; a < perFrame * 6 && made < perFrame; a++) {
      const segs = say(F); tried++; if (!segs) continue;
      const { text } = join(segs);
      if (seen.has(text)) continue; seen.add(text);
      // a training sentence is one the grammar reads as this frame (and, when the host says, one the host can act on)
      const r = E.understand(text, makeSession([]));
      const cmds = r.status === 'ok' ? [r.commands[0]] : r.status === 'ambiguous' ? (r.alternatives ?? []).map(c => c[0]) : [];
      const cmd = cmds.find(c => c.verb === F.name); if (!cmd || (keep && !keep(cmd))) continue;
      readable++; made++;
      examples.push({ verb: F.name, segs });
      for (let k = 0; k < perturb; k++) { const p = pick(PERTURB)(segs); if (p) { const t = join(p).text; if (!seen.has(t)) { seen.add(t); examples.push({ verb: F.name, segs: p, perturbed: true }); } } }
    }
  }
  const refs = [...(CHATTER[code] ?? CHATTER.en), ...refusals];
  return { examples: examples.map(e => ({ ...e, ...join(e.segs) })), refusals: refs, stats: { tried, readable, examples: examples.length, refusals: refs.length } };
}

// ---- features: the grammar's tokens and their lexicon senses ----
const senseKey = s => s.cat === 'VERB' ? `V:${s.verb}` : s.cat === 'NOUN' ? `N:${s.type}` : s.cat === 'LIT' ? `L:${s.type}` : s.cat === 'UNIT' ? `U:${s.dim}` : s.cat === 'PREP' ? `P:${s.canon[0]}` : s.cat;
function tokensOf(E, text) { return E.tokenize(text, { names: {} }).toks.map(t => ({ ...t, keys: [...new Set(t.senses.map(senseKey))] })); }
function intentFeats(toks) {
  const f = ['_b'];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; f.push(`w=${t.word}`); for (const k of t.keys) f.push(`k=${k}`);
    if (i === 0) for (const k of t.keys) f.push(`k0=${k}`);
    if (i > 0) for (const a of toks[i - 1].keys) for (const b of t.keys) f.push(`kk=${a}|${b}`);
  }
  return f;
}
function tokenFeats(toks, i) {
  const t = toks[i], p = toks[i - 1], n = toks[i + 1], f = ['_b', `w=${t.word}`];
  for (const k of t.keys) f.push(`k=${k}`);
  for (const k of p ? p.keys : ['^']) f.push(`pk=${k}`);
  for (const k of n ? n.keys : ['$']) f.push(`nk=${k}`);
  if (p) f.push(`pw=${p.word}`); if (n) f.push(`nw=${n.word}`);
  return f;
}

// ---- averaged perceptrons ----
function avgModel() { const w = {}, u = {}; let c = 1; return {
  score: (cls, fs) => { const wc = w[cls]; if (!wc) return 0; let s = 0; for (const f of fs) s += wc[f] ?? 0; return s; },
  update(cls, fs, d) { const wc = (w[cls] ??= {}), uc = (u[cls] ??= {}); for (const f of fs) { wc[f] = (wc[f] ?? 0) + d; uc[f] = (uc[f] ?? 0) + c * d; } },
  tick() { c++; },
  final() { const out = {}; for (const [cls, wc] of Object.entries(w)) { const o = {}; for (const [f, v] of Object.entries(wc)) { const a = v - (u[cls][f] ?? 0) / c; if (Math.abs(a) > 1e-9) o[f] = +a.toFixed(4); } out[cls] = o; } return out; } }; }
function intentModel(C) { const w = new Map(), u = new Map(); let c = 1; const vec = (m, f) => { let v = m.get(f); if (!v) m.set(f, v = new Float64Array(C)); return v; };
  return {
    scores(fs) { const acc = new Float64Array(C); for (const f of fs) { const v = w.get(f); if (v) for (let k = 0; k < C; k++) acc[k] += v[k]; } return acc; },
    update(k, fs, d) { for (const f of fs) { vec(w, f)[k] += d; vec(u, f)[k] += c * d; } },
    tick() { c++; },
    final() { const out = {}; for (const [f, v] of w) { const uv = u.get(f), o = {}; let any = false; for (let k = 0; k < C; k++) { const a = v[k] - uv[k] / c; if (Math.abs(a) >= 0.01) { o[k] = +a.toFixed(2); any = true; } } if (any) out[f] = o; } return out; } }; }
function viterbi(n, emit, trans) {
  const T = TAGS.length, dp = Array.from({ length: n }, () => new Float64Array(T).fill(-1e18)), bp = Array.from({ length: n }, () => new Int8Array(T));
  for (let t = 0; t < T; t++) dp[0][t] = emit(0, t) + trans(-1, t);
  for (let i = 1; i < n; i++) for (let t = 0; t < T; t++) { const e = emit(i, t); for (let p = 0; p < T; p++) { const s = dp[i - 1][p] + trans(p, t) + e; if (s > dp[i][t]) { dp[i][t] = s; bp[i][t] = p; } } }
  let best = 0; for (let t = 1; t < T; t++) if (dp[n - 1][t] > dp[n - 1][best]) best = t;
  const out = new Array(n); for (let i = n - 1, t = best; i >= 0; i--) { out[i] = t; t = bp[i][t]; } return out;
}

export function* trainLooseSteps(E, corpus, { epochs = 8, seed = 7 } = {}) {
  const R = rng(seed);
  // the training items, tokenized once: intent label and per-token tags (by where each token starts)
  const items = corpus.examples.map(e => { const toks = tokensOf(E, e.text); return { toks, verb: e.verb, tags: toks.map(t => { const s = e.at.find(([a, b]) => t.s >= a && t.s < b); return TAGS.indexOf(s ? s[2] : 'O'); }) }; }).filter(x => x.toks.length);
  for (const q of corpus.refusals) { const toks = tokensOf(E, q); if (toks.length) items.push({ toks, verb: REFUSE, tags: null }); }
  const classes = [...new Set(items.map(x => x.verb))], cix = new Map(classes.map((c, k) => [c, k]));
  const I = intentModel(classes.length), G = avgModel();
  const tf = x => x.tf ??= x.toks.map((_, i) => tokenFeats(x.toks, i));
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    let wrong = 0;
    for (const x of items) {
      const fs = x.fi ??= intentFeats(x.toks);
      const sc = I.scores(fs); let best = 0; for (let k = 1; k < sc.length; k++) if (sc[k] > sc[best]) best = k;
      const want = cix.get(x.verb); if (best !== want) { I.update(want, fs, 1); I.update(best, fs, -1); wrong++; }
      I.tick();
      if (x.tags) {
        const F = tf(x), got = viterbi(x.toks.length, (i, t) => G.score(TAGS[t], F[i]), (p, t) => G.score('>', [`${p < 0 ? '^' : TAGS[p]}>${TAGS[t]}`]));
        for (let i = 0; i < got.length; i++) if (got[i] !== x.tags[i]) { G.update(TAGS[x.tags[i]], F[i], 1); G.update(TAGS[got[i]], F[i], -1); }
        for (let i = 0; i < got.length; i++) { const pg = i ? TAGS[got[i - 1]] : '^', pw = i ? TAGS[x.tags[i - 1]] : '^'; if (pg !== pw || got[i] !== x.tags[i]) { G.update('>', [`${pw}>${TAGS[x.tags[i]]}`], 1); G.update('>', [`${pg}>${TAGS[got[i]]}`], -1); } }
      }
      G.tick();
    }
    yield { epoch: ep + 1, of: epochs, intentErrors: wrong, items: items.length };
  }
  const intent = I.final(), tag = G.final();
  return { v: 2, classes, intent, tag: Object.fromEntries(TAGS.map(t => [t, tag[t] ?? {}])), trans: tag['>'] ?? {} };
}
export function trainLoose(E, corpus, opts) { const it = trainLooseSteps(E, corpus, opts); let r; do r = it.next(); while (!r.done); return r.value; }

export function createLooseReader(E, W) {
  const ont = E.ont, col = (o, k) => o[`${k}_${E.locale.code}`] ?? o[k];
  const VERB = Object.fromEntries(ont.verbs.map(v => [v.name, v]));
  const scores = fs => { const acc = new Float64Array(W.classes.length); for (const f of fs) { const v = W.intent[f]; if (v) for (const k in v) acc[k] += v[k]; } return acc; };
  function read(text) {
    const toks = tokensOf(E, text); if (!toks.length) return { status: 'reject', reason: 'nothing to read' };
    const fs = intentFeats(toks), sc = scores(fs), ranked = W.classes.map((c, k) => [c, sc[k]]).sort((a, b) => b[1] - a[1]);
    const [verb, top] = ranked[0], margin = +(top - (ranked[1]?.[1] ?? 0)).toFixed(3), runnerUp = ranked[1]?.[0] ?? null;
    const ranked3 = ranked.filter(([c]) => c !== REFUSE).slice(0, 3).map(([c, v]) => [c, +v.toFixed(3)]);
    if (verb === REFUSE) return { status: 'refuse', margin, runnerUp, ranked: ranked3 };
    const F = VERB[verb]; if (!F) return { status: 'reject', reason: `unknown frame ${verb}`, margin };
    const tf = toks.map((_, i) => tokenFeats(toks, i));
    const tags = viterbi(toks.length, (i, t) => { const wc = W.tag[TAGS[t]]; let s = 0; for (const f of tf[i]) s += wc[f] ?? 0; return s; }, (p, t) => W.trans[`${p < 0 ? '^' : TAGS[p]}>${TAGS[t]}`] ?? 0).map(t => TAGS[t]);
    // spans of THEME and ARG, as typed; an argument keeps the preposition right before it
    const spans = [];
    for (let i = 0; i < toks.length; i++) {
      if (tags[i] === 'O') continue;
      const j0 = i; while (i + 1 < toks.length && tags[i + 1] === tags[j0]) i++;
      const prev = toks[j0 - 1], prep = tags[j0] === 'ARG' && prev && tags[j0 - 1] === 'O' && prev.senses.some(s => s.cat === 'PREP' || s.cat === 'COLON') ? prev.word : '';
      spans.push({ tag: tags[j0], text: text.slice(toks[j0].s, toks[i].e), prep });
    }
    // the rewrite: the frame's verb word, the theme, unmarked arguments listed after it, marked ones with their preposition
    const theme = spans.filter(s => s.tag === 'THEME').map(s => s.text).join(' and ');
    const loose = spans.filter(s => s.tag === 'ARG' && !s.prep).map(s => s.text), marked = spans.filter(s => s.tag === 'ARG' && s.prep);
    const words = col(F, 'words') ?? [];
    const head = [words[0] ?? '', theme].filter(Boolean).join(' ');
    const colon = marked.filter(s => s.prep === ':'), rest = marked.filter(s => s.prep !== ':');
    const rewrite = [head + (loose.length ? (head ? ', ' : '') + loose.join(', ') : ''), ...rest.map(s => `${s.prep} ${s.text}`)].filter(Boolean).join(' ') + colon.map(s => `: ${s.text}`).join('');
    const verdict = E.understand(rewrite, makeSession([]));
    return { status: 'guess', verb, margin, runnerUp, ranked: ranked3, tags: toks.map((t, i) => [t.word, tags[i]]), rewrite, verdict };
  }
  return { read };
}
