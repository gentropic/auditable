// @gcu/dispatch grammar — the English locale bank for the clause parser.
// A locale bank is: the closed-class words by category, a map from each surface preposition to the
// canonical (English) prepositions it can mean, morphology (stem, plural, gender agreement), the time
// and comparative tables, and the phrase table the echo uses. Nothing else about the language lives
// here; domain words come from the ontology.
export const ENGLISH = {
  code: 'en', headFirst: false,
  DET: 'the|a|an|this|that|my|our', REF: 'last|previous|latest|current|first|new',
  QUANT: 'all|every|each', EXCEPT: 'except|excluding|minus', CONJ: 'and|or|plus', COMMA: ',',
  PREP: 'with|using|by|per|in|on|for|from|to|at|as|above|below|over|under|of|into|without|against|where|>|<|>=|<=|=|≥|≤|greater than|more than|less than|at least|at most|equal to|equals',
  THEN: 'then|afterwards|next', BUT: 'but', PRON: 'it|them|those', AGAIN: 'again|rerun|redo|repeat|same',
  QWORD: 'why|how|what|when|who|is|are|does|do|should|can|could|would',
  // closed questions the grammar reads as commands with the verb left out: a wh-word, a copula, the fused forms
  DEMO: 'this|these|it|that|them|the following|the following text|the text|the two|both',   // before a colon: "summarise this: …"
  WH: 'what|which', COP: 'is|are|was|were', WHCOP: "what is|what's|whats|what are|which is|which are|how much is|how many are",
  TRAIL: 'please|thanks|thank you|pls|plz|cheers',   // politeness that closes a sentence, trimmed from the end of a free text
  FILLER: "please|now|just|kindly|go|ahead|me|us|hey|hi|hello|yo|thanks|thank you|cheers|pls|plz|so|um|uh|er|erm|hmm|well|oh|alright|can you|could you|would you|will you|i want you to|i need you to|i want to|i need|i'd like|i would like|give me|tell me|for me|let us|lets",
  // identity for every English preposition except the comparisons, which share a canon with their words
  preps: { '>': ['above'], 'greater than': ['above'], 'more than': ['above'], '<': ['below'], 'less than': ['below'], '>=': ['atleast'], '≥': ['atleast'], 'at least': ['atleast'],
    '<=': ['atmost'], '≤': ['atmost'], 'at most': ['atmost'], '=': ['equals'], 'equal to': ['equals'], equals: ['equals'] },
  // the calendar: weekday numbers (0 = Sunday) or a day relative to today; months; named clock times; am/pm.
  // "sun" is left out on purpose: it is the sun more often than Sunday.
  days: { sunday: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
    today: { rel: 0 }, tonight: { rel: 0 }, tomorrow: { rel: 1 }, yesterday: { rel: -1 } },
  months: { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 },
  clocks: { noon: [12, 0], midday: [12, 0], midnight: [0, 0] },
  AMPM: "am|pm|a.m.|p.m.|o'clock",
  indefinite: ['a', 'an'], newRef: ['new'], firstRef: ['first'],
  phr: { new: 'new', last: 'last', every: 'every', except: 'except', fromRun: 'from run', above: 'above', below: 'below', atleast: 'at least', atmost: 'at most', equals: 'equal to', then: 'Then', assuming: 'assuming', of: 'of', hole: '___', than: 'than' },
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
