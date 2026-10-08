// @gcu/dispatch grammar — the English locale bank for the clause parser.
// A locale bank is: the closed-class words by category, a map from each surface preposition to the
// canonical (English) prepositions it can mean, morphology (stem, plural, gender agreement), the time
// and comparative tables, and the phrase table the echo uses. Nothing else about the language lives
// here; domain words come from the ontology.
export const ENGLISH = {
  code: 'en', headFirst: false,
  DET: 'the|a|an|this|that|my|our', REF: 'last|previous|latest|current|first|new',
  QUANT: 'all|every|each', EXCEPT: 'except|excluding|minus', CONJ: 'and|or|plus', COMMA: ',',
  PREP: 'with|using|by|in|on|for|from|to|at|as|above|below|over|under|of|into|without|against',
  THEN: 'then|afterwards|next', BUT: 'but', PRON: 'it|them|those', AGAIN: 'again|rerun|redo|repeat|same',
  QWORD: 'why|how|what|when|who|is|are|does|do|should|can|could|would',
  // closed questions the grammar reads as commands with the verb left out: a wh-word, a copula, the fused forms
  WH: 'what|which', COP: 'is|are|was|were', WHCOP: "what is|what's|whats|what are|which is|which are|how much is|how many are",
  FILLER: 'please|now|just|kindly|go|ahead|me|us|hey|hi|yo|thanks|thank you|cheers|pls|plz|so|can you|could you|would you|will you|i want you to|i need you to|i want to|let us|lets',
  preps: {},   // identity: every English prep is its own canon
  indefinite: ['a', 'an'], newRef: ['new'], firstRef: ['first'],
  phr: { new: 'new', last: 'last', every: 'every', except: 'except', fromRun: 'from run', above: 'above', below: 'below', then: 'Then', assuming: 'assuming', of: 'of', hole: '___', than: 'than' },
  // morphology: a stem both the lexicon and the input are folded through; plural = word ≠ lexeme and ends in s
  stem: w => { let x = w; if (x.length > 4 && /ies$/.test(x)) x = x.slice(0, -3) + 'y'; else if (x.length > 4 && /(ss|sh|ch|x)es$/.test(x)) x = x.slice(0, -2); else if (x.length > 3 && /[^s]s$/.test(x)) x = x.slice(0, -1);
    if (x.length > 5 && /ing$/.test(x)) x = x.slice(0, -3); else if (x.length > 4 && /ed$/.test(x)) x = x.slice(0, -2);
    x = x.replace(/([b-df-hj-np-tv-z])\1$/, '$1'); if (x.length > 3 && /e$/.test(x)) x = x.slice(0, -1); return x; },
  gender: () => 'm', agree: { m: {}, f: {} }, plural: w => /[^s]s$/.test(w),
  // relative clauses and time
  REL: 'that|which|who', SUBJ: 'i|we|you|they', TIME: 'today|yesterday|this morning|this week|last week|this month|last month|earlier',
  times: { today: [0, 1], yesterday: [1, 2], 'this morning': [0, 1], 'this week': [0, 7], 'last week': [7, 14], 'this month': [0, 30], 'last month': [30, 60], earlier: [0, 3650] },   // days ago: [from, to)
  COMP: 'bigger|larger|wider|smaller|narrower|longer|shorter|biggest|largest|widest|smallest|narrowest|longest|shortest',
  comps: { bigger: ['+', 0], larger: ['+', 0], wider: ['+', 0], longer: ['+', 0], smaller: ['-', 0], narrower: ['-', 0], shorter: ['-', 0], biggest: ['+', 1], largest: ['+', 1], widest: ['+', 1], longest: ['+', 1], smallest: ['-', 1], narrowest: ['-', 1], shortest: ['-', 1] },
};
