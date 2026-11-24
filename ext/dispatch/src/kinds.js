// @gcu/dispatch — the KIND implementations: the plugin boundary. A tool is a
// DECLARATION ({name, kind, ...kind fields}); each kind owns three verbs:
//   render(tool, ctx, R)              → {q, args}   (corpus generation)
//   align(toks, tags, args, ctx, tool) → bool        (training labels, answer-first)
//   assemble(tool, ctx, toks, tags)    → args | null  (inference)
// Assemblers emit the tool's CANONICAL argument shape (clauses arrays, real
// booleans) — hosts get WebMCP-shaped calls, not a model-era flattening.
import { tokenize, gazSpans, NUM_RE, num, cap } from './text.js';

// ── shared render helpers (R = { rnd, pick, maybe }) ──
export const mkR = (rnd) => ({ rnd, pick: (arr) => arr[(rnd() * arr.length) | 0], maybe: (p) => rnd() < p });
const fill = (frame, slots) => frame.replace(/\{(\w+)\}/g, (m, k) => (slots[k] !== undefined ? slots[k] : m));
const politeWrap = (q, R, L) => {
  const k = R.rnd();
  return k < 0.55 ? q : k < 0.7 ? q + L.politeSuffixes[0] : k < 0.8 ? L.politePrefixes[0] + q : k < 0.9 ? cap(q) + '.' : q + (L.politeSuffixes[1] || '');
};
const numVal = (c, R) => { const v = c.lo + R.rnd() * (c.hi - c.lo); return +v.toFixed(c.dec === 1 && R.maybe(0.5) ? 0 : c.dec); };
const pickNumCol = (vocab, R) => { const names = Object.keys(vocab.numCols); const col = R.pick(names); return { col, cfg: vocab.numCols[col] }; };
const catColOf = (tool, vocab) => tool.column || Object.keys(vocab.catValues)[0];
// a multi-locale bank ('en+pt') writes each example in ONE sub-locale; a single bank is its own
const subOf = (L, R) => (L.subs ? R.pick(L.subs) : L);
// a tool field given per locale ({ en: [...], pt: [...] }) or once for all (an array)
const loc = (x, T) => (x == null ? null : Array.isArray(x) ? x : (x[T.id] || x.en || Object.values(x)[0]));
// a synonym in THIS example's language: vocab.synL (per-locale pools, deriveVocab) when it
// has one for T, else the union pool — so a pt sentence says "densidade", not "the density"
const inLang = (byLang, T, pool) => { const p = byLang && byLang[T.id]; return p && p.length ? p : pool; };
const numSyn = (cfg, T, R) => R.pick(inLang(cfg.synL, T, cfg.syn));
const catValSyn = (vocab, col, v, T, R) => R.pick(inLang(vocab.synL && vocab.synL.catValues && vocab.synL.catValues[col] && vocab.synL.catValues[col][v], T, vocab.catValues[col][v]));
const catColSyn = (vocab, col, T, R) => R.pick(inLang(vocab.synL && vocab.synL.catCols && vocab.synL.catCols[col], T, (vocab.catCols && vocab.catCols[col]) || [col]));
const layerSyn = (vocab, file, T, R) => { const all = vocab.layers[file].filter((s) => s !== file); const p = inLang(vocab.synL && vocab.synL.layers && vocab.synL.layers[file], T, all).filter((s) => s !== file); return R.pick(p.length ? p : all); };
// a lexicon value's synonyms: [..] | {syn:[..], frames} | {en:[..], pt:[..]}
const lexSyns = (spec) => (Array.isArray(spec) ? spec : [...(spec.syn || []), ...(spec.en || []), ...(spec.pt || [])]);

// ── shared align helpers ──
const mkClaim = (toks, tags) => ({
  claim(start, len, tag) { for (let k = 0; k < len; k++) if (tags[start + k] !== 'O') return false; for (let k = 0; k < len; k++) tags[start + k] = tag; return true; },
  claimGaz(map, want, tag, matchFn) {
    for (const s of gazSpans(toks, map)) {
      const hit = matchFn ? matchFn(s.val) : s.val === want;
      if (hit && tags[s.i] === 'O') { for (let k = 0; k < s.len; k++) tags[s.i + k] = tag; return true; }
    }
    return false;
  },
  claimNum(v, tag) {
    for (let i = 0; i < toks.length; i++) if (tags[i] === 'O' && /^[0-9.]+$/.test(toks[i]) && Math.abs(+toks[i] - +v) < 1e-9) { tags[i] = tag; return i; }
    return -1;
  },
});

// ── shared assemble helpers ──
export function groupTags(toks, tags) {
  const groups = [];
  for (let i = 0; i < toks.length; i++) {
    if (tags[i] === 'O') continue;
    const last = groups[groups.length - 1];
    if (last && last.tag === tags[i] && last.end === i - 1) { last.end = i; last.words.push(toks[i]); }
    else groups.push({ tag: tags[i], start: i, end: i, words: [toks[i]] });
  }
  return (tag) => groups.filter((x) => x.tag === tag);
}
const normFrom = (map) => (words) => { for (let l = words.length; l >= 1; l--) for (let i = 0; i + l <= words.length; i++) { const k = words.slice(i, i + l).join(' '); if (map.has(k)) return map.get(k); } return null; };
const opFromGroup = (words, L) => {
  if (words.includes('no') && words.includes('less')) return '>=';
  if (words.includes('at') && words.includes('least')) return '>=';
  if (words.includes('at') && words.includes('most')) return '<=';
  if (words.includes('up') && words.includes('to')) return '<=';
  if (words.includes('>') && words.includes('=')) return '>=';   // the tokenizer splits >= into '>' '='
  if (words.includes('<') && words.includes('=')) return '<=';
  // pt: "pelo menos" / "no mínimo" (≥), "no máximo" (≤), "maior ou igual" / "menor ou igual"
  if (words.includes('pelo') && words.includes('menos')) return '>=';
  if (words.includes('minimo')) return '>=';
  if (words.includes('maximo')) return '<=';
  if (words.includes('igual') && words.includes('maior')) return '>=';
  if (words.includes('igual') && words.includes('menor')) return '<=';
  for (const w of words) if (L.opWord[w]) return L.opWord[w];
  return null;
};
const showHide = (toks, L) => {
  const H = new Set(L.hideWords), S = new Set(L.showWords), N = new Set(L.negators);
  let hide = toks.some((t) => H.has(t)), show = toks.some((t) => S.has(t));
  if (toks.some((t) => N.has(t))) { const t2 = hide; hide = show; show = t2; }
  return hide && !show ? 'hide' : show ? 'show' : 'hide';
};
const firstNum = (g, toks) => {
  for (const tag of ['VAL', 'POS', 'THICK']) { const v = g(tag)[0]; if (v && Number.isFinite(num(v.words[0]))) return num(v.words[0]); }
  const t = toks.find((x) => NUM_RE.test(x));
  return t !== undefined ? num(t) : null;
};
const lexFind = (toks, values) => {
  for (const [key, spec] of Object.entries(values)) {
    const syns = lexSyns(spec);
    for (const s of [key, ...syns]) {
      const seq = tokenize(s);
      for (let i = 0; i + seq.length <= toks.length; i++) if (seq.every((w, k) => toks[i + k] === w)) return key;
    }
  }
  return null;
};

// ── the kinds ──
export const KINDS = {
  // {nouns:[...], rowRegister?:bool, idColumn?, idPrefix?, benchRange? (cat col
  //  with numeric levels, e.g. BENCH), depthRange? ({from, to})}
  'comparison-filter': {
    defaultTarget: 120,
    // {frames?: per-locale sentence frames with {noun} {cond} (a SELECT verb, say — default: the
    //  bank's filter frames), catFrames?: frames for a categorical value alone ({v} {noun} {cc})}
    render(tool, ctx, R) {
      const { vocab } = ctx;
      const T = subOf(vocab.L, R), L = T;                   // this example's language
      const noun = R.pick(loc(tool.nouns, T));
      const catCol = Object.keys(vocab.catValues)[0];
      const cats = catCol ? vocab.catValues[catCol] : null;
      const opPhrase = (op) => R.pick(L.ops[op]);
      const clPhrase = (syn, op, v) => fill(R.pick(T.tpl.num), { c: syn, o: opPhrase(op), v });
      const catPhrase = (vsyn, csyn) => fill(R.pick(T.tpl.cat), { v: vsyn, cc: csyn });
      const wrap = (cond) => fill(R.pick(loc(tool.frames, T) || T.tpl.filter), { noun, cond });
      const kind = R.rnd();
      if (tool.idColumn && kind < 0.12) {
        const id = `${tool.idPrefix || 'ID-'}${String(1 + ((R.rnd() * 120) | 0)).padStart(3, '0')}`;
        return { q: R.pick([`samples from hole ${id}`, `only hole ${id}`, `show the intervals of ${id}`, `rows from ${id}`]), args: { clauses: [{ column: tool.idColumn, op: '=', value: id }], join: 'and' } };
      }
      // a numeric RANGE on one column ("fe between 50 and 60") → two clauses
      if (T.tpl.range && kind < 0.08) {
        const { col, cfg } = pickNumCol(vocab, R);
        let a = numVal(cfg, R), b = numVal(cfg, R); if (a > b) [a, b] = [b, a]; if (a === b) b = +(a + 1).toFixed(2);
        const q = wrap(fill(R.pick(T.tpl.range), { c: numSyn(cfg, T, R), a, b }));
        return { q, args: { clauses: [{ column: col, op: '>=', value: a }, { column: col, op: '<=', value: b }], join: 'and' } };
      }
      if (kind < 0.35) {
        const { col, cfg } = pickNumCol(vocab, R);
        const syn = numSyn(cfg, T, R), op = R.pick(Object.keys(L.ops)), v = numVal(cfg, R);
        const unit = R.maybe(0.2) ? ' ' + R.pick(T.unitWords || ['%']) : '';
        return { q: wrap(clPhrase(syn, op, v) + unit), args: { clauses: [{ column: col, op, value: v }], join: 'and' } };
      }
      if (cats && kind < 0.5) {
        const v = R.pick(Object.keys(cats)), syn = catValSyn(vocab, catCol, v, T, R);
        const colSyn = catColSyn(vocab, catCol, T, R);
        const q = R.maybe(0.5) ? fill(R.pick(loc(tool.catFrames, T) || T.tpl.catOnly), { v: syn, noun, cc: colSyn }) : wrap(catPhrase(syn, colSyn));
        return { q, args: { clauses: [{ column: catCol, op: '=', value: v }], join: 'and' } };
      }
      if (kind < 0.68) {
        if (tool.depthRange) {
          const a = 10 * ((2 + R.rnd() * 10) | 0), b = a + 10 * ((2 + R.rnd() * 8) | 0);
          return { q: R.pick([`intervals from ${a} to ${b} meters`, `samples between ${a} and ${b} m depth`]), args: { clauses: [{ column: tool.depthRange.from, op: '>=', value: a }, { column: tool.depthRange.to, op: '<=', value: b }], join: 'and' } };
        }
        if (tool.benchRange) {
          const lv = tool.benchLevels || [940, 960, 980, 1000, 1020, 1040, 1060, 1080, 1100, 1120, 1140];
          const i = (R.rnd() * (lv.length - 3)) | 0, a = lv[i], b = lv[i + 1 + ((R.rnd() * (lv.length - i - 2)) | 0)];
          const bn = tool.benchRange.toLowerCase();
          return { q: R.pick([`${tool.nouns[0]} from ${bn} ${a} to ${bn} ${b}`, `${bn}es ${a} to ${b}`, `between ${bn} ${a} and ${b}`, `${tool.nouns[0]} between ${bn} ${a} and ${bn} ${b}`, `from ${bn} ${a} to ${b}`, `${bn} ${a} to ${bn} ${b}`, `keep the ${bn}es from ${a} to ${b}`, `only ${bn}es ${a} to ${b}`]), args: { clauses: [{ column: tool.benchRange, op: '>=', value: a }, { column: tool.benchRange, op: '<=', value: b }], join: 'and' } };
        }
      }
      const A = pickNumCol(vocab, R);
      let B = pickNumCol(vocab, R), guard = 0;
      while (B.col === A.col && guard++ < 5) B = pickNumCol(vocab, R);
      const aOp = R.pick(Object.keys(L.ops)), aV = numVal(A.cfg, R), aSyn = numSyn(A.cfg, T, R);
      const catB = cats && R.maybe(0.3);
      const bCl = catB ? { column: catCol, op: '=', value: R.pick(Object.keys(cats)) } : { column: B.col, op: R.pick(Object.keys(L.ops)), value: numVal(B.cfg, R) };
      const bSyn = catB ? catValSyn(vocab, catCol, bCl.value, T, R) : numSyn(B.cfg, T, R);
      const join = catB ? 'and' : R.maybe(0.25) ? 'or' : 'and';
      const aPhrase = clPhrase(aSyn, aOp, aV);
      const bPhrase = catB ? catPhrase(bSyn, catColSyn(vocab, catCol, T, R)) : clPhrase(bSyn, bCl.op, bCl.value);
      // a categorical value may also sit in front of the noun: "hematite blocks with fe above 60"
      const q = catB && T.id === 'en' && R.maybe(0.3) ? `only ${bSyn}${tool.rowRegister ? ' samples' : ' blocks'} with ${aPhrase}`
        : wrap(catB && R.maybe(0.5) ? `${aPhrase} ${bPhrase}` : `${aPhrase} ${T.tpl.join[join]} ${bPhrase}`);
      return { q, args: { clauses: [{ column: A.col, op: aOp, value: aV }, bCl], join } };
    },
    align(toks, tags, args, ctx, tool) {
      const c = mkClaim(toks, tags), L = ctx.vocab.L;
      const cls = args.clauses;
      const isRange = cls.length === 2 && cls[0].column === cls[1].column && cls[0].op === '>=' && cls[1].op === '<=';
      const isDepth = tool.depthRange && cls.length === 2 && cls[0].column === tool.depthRange.from;
      for (const cl of cls) {
        if (ctx.vocab.catValues[cl.column]) { if (!c.claimGaz(ctx.gaz.lit, null, 'CAT', (v) => v.col === cl.column && v.value === cl.value)) return false; continue; }
        if (cl.column === tool.idColumn) { const i = toks.findIndex((t, k) => tags[k] === 'O' && t.toUpperCase() === String(cl.value).toUpperCase()); if (i < 0) return false; tags[i] = 'ID'; continue; }
        if (!isDepth) { if (!c.claimGaz(ctx.gaz.col, cl.column, 'COL') && !c.claimGaz(ctx.gaz.cat, cl.column, 'COL') && tags.indexOf('COL') < 0) return false; }
        if (c.claimNum(cl.value, 'VAL') < 0) return false;
        const opWords = L.ops[cl.op] || [];
        outer: for (const w of opWords) {
          const seq = tokenize(w);
          for (let i = 0; i + seq.length <= toks.length; i++) if (seq.every((s, k) => toks[i + k] === s && tags[i + k] === 'O')) { c.claim(i, seq.length, 'OP'); break outer; }
        }
      }
      if (isRange || isDepth) {
        const vIdx = tags.map((t, i) => (t === 'VAL' ? i : -1)).filter((i) => i >= 0);
        if (vIdx.length >= 2) for (let i = vIdx[0] + 1; i < vIdx[vIdx.length - 1]; i++) if (tags[i] === 'O' && ctx.vocab.L.rangeWords.includes(toks[i])) { tags[i] = 'RNG'; break; }
      }
      return true;
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags), L = ctx.vocab.L;
      const normCol = (w) => normFrom(ctx.gaz.col)(w) || normFrom(ctx.gaz.cat)(w);
      const clauses = [];
      const cols = g('COL'), ops = g('OP'), vals = g('VAL'), rngs = g('RNG');
      const usedV = new Set(), usedO = new Set();
      for (const c of cols) {
        const col = normCol(c.words);
        if (!col) continue;
        const free = () => vals.filter((v) => !usedV.has(v));
        const rng = rngs.find((r) => !r.used && free().some((v) => v.end < r.start) && free().some((v) => v.start > r.end));
        if (rng && free().length >= 2) {
          const v1 = free().filter((v) => v.end < rng.start).sort((a, b) => b.end - a.end)[0];
          const v2 = free().filter((v) => v.start > rng.end).sort((a, b) => a.start - b.start)[0];
          if (v1 && v2) {
            rng.used = true; usedV.add(v1); usedV.add(v2);
            clauses.push({ at: c.start, column: col, op: '>=', value: num(v1.words[0]) });
            clauses.push({ at: v2.start, column: col, op: '<=', value: num(v2.words[0]) });
            continue;
          }
        }
        const op = ops.filter((o) => !usedO.has(o)).sort((a, b) => Math.abs(a.start - c.end) - Math.abs(b.start - c.end))[0];
        const v = vals.filter((x) => !usedV.has(x) && x.start > c.end).sort((a, b) => a.start - b.start)[0]
          || vals.filter((x) => !usedV.has(x)).sort((a, b) => Math.abs(a.start - c.end) - Math.abs(b.start - c.end))[0];
        if (!v) continue;
        usedV.add(v); if (op) usedO.add(op);
        clauses.push({ at: c.start, column: col, op: (op && opFromGroup(op.words, L)) || '>', value: num(v.words[0]) });
      }
      for (const c of g('CAT')) { const hit = normFrom(ctx.gaz.lit)(c.words); if (hit) clauses.push({ at: c.start, column: hit.col, op: '=', value: hit.value }); }
      // an EXACT category value the tagger left untagged ("canga only", "apenas hematita com …")
      // is still that category — the gazetteer is the lexicon, not a guess
      for (const sp of gazSpans(toks, ctx.gaz.lit)) {
        if (tags.slice(sp.i, sp.i + sp.len).some((t) => t !== 'O')) continue;
        if (clauses.some((cl) => cl.column === sp.val.col)) continue;
        clauses.push({ at: sp.i, column: sp.val.col, op: '=', value: sp.val.value });
      }
      if (tool.idColumn) for (const c of g('ID')) clauses.push({ at: c.start, column: tool.idColumn, op: '=', value: c.words[0].toUpperCase() });
      if (tool.depthRange && !clauses.length) {
        const rng = rngs.find((r) => !r.used);
        const free = vals.filter((v) => !usedV.has(v));
        if (rng && free.length >= 2) {
          const v1 = free.filter((v) => v.end < rng.start).sort((a, b) => b.end - a.end)[0];
          const v2 = free.filter((v) => v.start > rng.end).sort((a, b) => a.start - b.start)[0];
          if (v1 && v2) {
            clauses.push({ at: v1.start, column: tool.depthRange.from, op: '>=', value: num(v1.words[0]) });
            clauses.push({ at: v2.start, column: tool.depthRange.to, op: '<=', value: num(v2.words[0]) });
          }
        }
      }
      if (!clauses.length) return null;
      clauses.sort((a, b) => a.at - b.at);
      const out = { clauses: clauses.map(({ at, ...cl }) => cl), join: clauses.length > 1 && toks.some((t) => (L.orWords || ['or']).includes(t)) ? 'or' : 'and' };
      return out;
    },
  },

  // {argName:'column', frames:['color by {col}',...], emptyFrames?:[...],
  //  optional?:bool, pools?:['numeric','categorical']}
  'column-pick': {
    defaultTarget: 100,
    render(tool, ctx, R) {
      const { vocab } = ctx;
      const T = subOf(vocab.L, R);
      if (tool.optional && tool.emptyFrames && R.maybe(0.4)) return { q: R.pick(loc(tool.emptyFrames, T)), args: {} };
      const pools = tool.pools || ['numeric'];
      const names = [...(pools.includes('numeric') ? Object.keys(vocab.numCols) : []), ...(pools.includes('categorical') ? Object.keys(vocab.catCols) : [])];
      const col = R.pick(names);
      const syn = vocab.numCols[col] ? numSyn(vocab.numCols[col], T, R) : catColSyn(vocab, col, T, R);
      // {grp}: a categorical column named as a GROUPING ("stats of {col} by {grp}") — context
      // the classifier learns from; the host reads the grouping itself (it is not an argument)
      const cats = Object.keys(vocab.catCols);
      const frames = cats.length ? loc(tool.frames, T) : loc(tool.frames, T).filter((f) => !f.includes('{grp}'));
      const grp = cats.length ? catColSyn(vocab, R.pick(cats), T, R) : '';
      return { q: fill(R.pick(frames), { col: syn, grp }), args: { [tool.argName || 'column']: col } };
    },
    align(toks, tags, args, ctx, tool) {
      const c = mkClaim(toks, tags);
      const col = args[tool.argName || 'column'];
      if (col === undefined) return true;
      return c.claimGaz(ctx.gaz.col, col, 'COL') || c.claimGaz(ctx.gaz.cat, col, 'COL');
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      const c = g('COL')[0] || g('CAT')[0];
      let col = c && (normFrom(ctx.gaz.col)(c.words) || normFrom(ctx.gaz.cat)(c.words));
      // an exact column name the tagger missed ("paint by lithology") — the first one said
      if (!col) {
        const pools = tool.pools || ['numeric'];
        const sp = [...(pools.includes('numeric') ? gazSpans(toks, ctx.gaz.col) : []), ...(pools.includes('categorical') ? gazSpans(toks, ctx.gaz.cat) : [])].sort((x, y) => x.i - y.i)[0];
        if (sp) col = sp.val;
      }
      if (col) return { [tool.argName || 'column']: col };
      return tool.optional ? {} : null;
    },
  },

  // {axes: {Z:[words], X:[words], Y:[words]}, posArg?, thickArg?}
  'axis-position': {
    defaultTarget: 120,
    render(tool, ctx, R) {
      const T = subOf(ctx.vocab.L, R);
      const t = R.maybe(0.3) ? 5 * ((1 + R.rnd() * 10) | 0) : null;
      const th = t ? fill(R.pick(T.tpl.thick), { t }) : '';
      const kind = R.rnd();
      const posArg = tool.posArg || 'position', thickArg = tool.thickArg || 'thickness';
      const mk = (axis, position) => ({ q: fill(R.pick(T.tpl.section[axis]), { p: position, th }), args: { axis, [posArg]: position, ...(t ? { [thickArg]: t } : {}) } });
      if (kind < 0.55) return mk('Z', 900 + 20 * ((R.rnd() * 13) | 0) + R.pick([0, 5, 10, -5]));
      if (kind < 0.8) return mk('X', 100 * ((30 + R.rnd() * 30) | 0));
      return mk('Y', 100 * ((70 + R.rnd() * 30) | 0));
    },
    align(toks, tags, args, ctx, tool) {
      const c = mkClaim(toks, tags);
      const thickArg = tool.thickArg || 'thickness', posArg = tool.posArg || 'position';
      if (args[thickArg] !== undefined && c.claimNum(args[thickArg], 'THICK') < 0) return false;
      return c.claimNum(args[posArg], 'POS') >= 0;
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      const pos = g('POS')[0] || g('VAL')[0];
      if (!pos) return null;
      let axis = 'Z';
      outer: for (const t of toks) for (const [ax, words] of Object.entries(tool.axes)) if (words.includes(t)) { axis = ax; break outer; }
      const out = { axis, [tool.posArg || 'position']: num(pos.words[0]) };
      const th = g('THICK')[0];
      if (th) out[tool.thickArg || 'thickness'] = num(th.words[0]);
      return out;
    },
  },

  // {argName:'axis', axes:{X:[words],Y:[],Z:[]}, colArg?:'column',
  //  frames:['swath along {ax}'], colFrames:['swath of {col} along {ax}'],
  //  axisOptional?:bool + colOnlyFrames?:['swath of {col}'] (no direction said → no axis arg)}
  'axis-pick': {
    defaultTarget: 90,
    render(tool, ctx, R) {
      const T = subOf(ctx.vocab.L, R);
      if (tool.axisOptional && tool.colArg && tool.colOnlyFrames && R.maybe(0.3)) {
        const { col, cfg } = pickNumCol(ctx.vocab, R);
        return { q: fill(R.pick(loc(tool.colOnlyFrames, T)), { col: numSyn(cfg, T, R) }), args: { [tool.colArg]: col } };
      }
      const axis = R.pick(Object.keys(tool.axes));
      const ax = R.pick((tool.sayAxes && loc(tool.sayAxes, T) && loc(tool.sayAxes, T)[axis]) || tool.axes[axis]);   // sayAxes: the words to WRITE, per locale (axes stays the union the assembler reads)
      if (!tool.colArg || R.maybe(0.45)) return { q: fill(R.pick(loc(tool.frames, T)), { ax }), args: { [tool.argName || 'axis']: axis } };
      const { col, cfg } = pickNumCol(ctx.vocab, R);
      return { q: fill(R.pick(loc(tool.colFrames, T)), { ax, col: numSyn(cfg, T, R) }), args: { [tool.argName || 'axis']: axis, [tool.colArg]: col } };
    },
    align(toks, tags, args, ctx, tool) {
      const c = mkClaim(toks, tags);
      if (tool.colArg && args[tool.colArg] !== undefined) return c.claimGaz(ctx.gaz.col, args[tool.colArg], 'COL');
      return true;
    },
    assemble(tool, ctx, toks, tags) {
      let axis = null;
      outer: for (const t of toks) for (const [ax, words] of Object.entries(tool.axes)) if (words.includes(t)) { axis = ax; break outer; }
      if (!axis && !tool.axisOptional) return null;
      const out = axis ? { [tool.argName || 'axis']: axis } : {};
      if (tool.colArg) {
        const g = groupTags(toks, tags);
        const c = g('COL')[0];
        const col = c && normFrom(ctx.gaz.col)(c.words);
        if (col) out[tool.colArg] = col;
      }
      return out;
    },
  },

  // {column:'LITO'} → {column, value, visible:bool}
  'category-visibility': {
    defaultTarget: 110,
    render(tool, ctx, R) {
      const col = catColOf(tool, ctx.vocab);
      const vals = ctx.vocab.catValues[col];
      const v = R.pick(Object.keys(vals)), syn = R.pick(vals[v]);
      const T = subOf(ctx.vocab.L, R);
      const show = R.maybe(0.4);
      const q = fill(R.pick(show ? T.tpl.catShow : T.tpl.catHide), { x: syn, X: cap(syn) });
      return { q, args: { column: col, value: v, visible: show } };
    },
    align(toks, tags, args, ctx) {
      const c = mkClaim(toks, tags);
      return c.claimGaz(ctx.gaz.lit, null, 'CAT', (v) => v.col === args.column && v.value === args.value);
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      const c = g('CAT')[0];
      const hit = c && normFrom(ctx.gaz.lit)(c.words);
      if (!hit) return null;
      return { column: hit.col, value: hit.value, visible: showHide(toks, ctx.vocab.L) === 'show' };
    },
  },

  // {argName:'layer', frames:['zoom to {layer}',...]}
  'layer-pick': {
    defaultTarget: 70,
    render(tool, ctx, R) {
      const file = R.pick(Object.keys(ctx.vocab.layers));
      const T = subOf(ctx.vocab.L, R);
      const syn = layerSyn(ctx.vocab, file, T, R);
      return { q: fill(R.pick(loc(tool.frames, T)), { layer: syn }), args: { [tool.argName || 'layer']: file } };
    },
    align(toks, tags, args, ctx, tool) {
      return mkClaim(toks, tags).claimGaz(ctx.gaz.layer, args[tool.argName || 'layer'], 'LAYER');
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      const c = g('LAYER')[0];
      const layer = (c && normFrom(ctx.gaz.layer)(c.words)) || normFrom(ctx.gaz.layer)(toks);
      return layer ? { [tool.argName || 'layer']: layer } : null;
    },
  },

  // {} → {layer, action:'show'|'hide'}
  'layer-action': {
    defaultTarget: 80,
    render(tool, ctx, R) {
      const file = R.pick(Object.keys(ctx.vocab.layers));
      const T = subOf(ctx.vocab.L, R);
      const syn = layerSyn(ctx.vocab, file, T, R);
      const show = R.maybe(0.45);
      const q = fill(R.pick(show ? T.tpl.layerShow : T.tpl.layerHide), { x: syn, X: cap(syn) });
      return { q, args: { layer: file, action: show ? 'show' : 'hide' } };
    },
    align(toks, tags, args, ctx) {
      return mkClaim(toks, tags).claimGaz(ctx.gaz.layer, args.layer, 'LAYER');
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      const c = g('LAYER')[0];
      const layer = (c && normFrom(ctx.gaz.layer)(c.words)) || normFrom(ctx.gaz.layer)(toks);
      return layer ? { layer, action: showHide(toks, ctx.vocab.L) } : null;
    },
  },

  // {argName, values:{key: [syn] | {syn:[...], frames:[...]}}, frames:['use {val}',...]}
  'lexicon-pick': {
    defaultTarget: 55,
    render(tool, ctx, R) {
      const key = R.pick(Object.keys(tool.values));
      const spec = tool.values[key];
      const T = subOf(ctx.vocab.L, R);
      const syns = Array.isArray(spec) ? spec : (loc(spec.en || spec.pt ? { en: spec.en, pt: spec.pt } : null, T) || spec.syn || [key]);
      const perValueFrames = !Array.isArray(spec) && spec.frames;
      if (perValueFrames) return { q: R.pick(spec.frames), args: { [tool.argName]: key } };
      return { q: fill(R.pick(loc(tool.frames, T)), { val: R.pick(syns) }), args: { [tool.argName]: key } };
    },
    align() { return true; },                                // lexicon at assembly; no tags
    assemble(tool, ctx, toks) {
      const key = lexFind(toks, tool.values);
      return key ? { [tool.argName]: key } : null;
    },
  },

  // {argName, frames:['exaggerate z by {n}'], values?:[...], wordNumbers?:bool}
  'number-arg': {
    defaultTarget: 45,
    render(tool, ctx, R) {
      const n = tool.values ? R.pick(tool.values) : +(0.5 + R.rnd() * 9.5).toFixed(1);
      const L = subOf(ctx.vocab.L, R);
      const asWord = tool.wordNumbers && Number.isInteger(n) && n >= 1 && n <= 9 && R.maybe(0.3);
      const word = asWord ? Object.keys(L.wordNums).find((k) => L.wordNums[k] === n) : null;
      return { q: fill(R.pick(loc(tool.frames, L)), { n: word || n }), args: { [tool.argName]: n } };
    },
    align(toks, tags, args, ctx, tool) {
      const c = mkClaim(toks, tags);
      if (c.claimNum(args[tool.argName], 'VAL') >= 0) return true;
      if (!tool.wordNumbers) return false;
      const wn = ctx.vocab.L.wordNums;
      const wi = toks.findIndex((t, k) => tags[k] === 'O' && wn[t] === args[tool.argName]);
      if (wi < 0) return false;
      tags[wi] = 'VAL';
      return true;
    },
    assemble(tool, ctx, toks, tags) {
      const g = groupTags(toks, tags);
      let n = firstNum(g, toks);
      if (n == null && tool.wordNumbers) { const wn = ctx.vocab.L.wordNums; const w = toks.find((t) => wn[t]); if (w) n = wn[w]; }
      return n != null ? { [tool.argName]: n } : null;
    },
  },

  // {frames:[...]}
  'no-arg': {
    defaultTarget: 30,
    render(tool, ctx, R) {
      const T = subOf(ctx.vocab.L, R);
      return { q: politeWrap(R.pick(loc(tool.frames, T)), R, T), args: {} };
    },
    align() { return true; },
    assemble() { return {}; },
  },
};
