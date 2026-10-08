// @gcu/dispatch — module manifest / curated export surface.
// One utterance in, one routed, explainable tool call out — session-trained
// (the model is younger than your coffee), zero-dep, browser-pure, Sealed-
// compatible. See SPEC.md; provenance: the gcu-dispatch incubator.
export { deriveVocab, LOCALES, ELEMENT_LEX } from './vocab.js';
export { createContext } from './features.js';
export { KINDS } from './kinds.js';
export { generate } from './gen.js';
export { alignCorpus, trainModels, TAGS, tagSetOf } from './train.js';
export { createDispatcher, trainSession } from './api.js';
export { tokenize, normText, mulberry32 } from './text.js';
// the grammar rung (clause): a controlled-command parser — case-grammar verb frames over an Earley
// chart with costed repairs; ontology as data, locale banks for en and pt-BR. SPEC.md "The grammar rung".
export { createEngine, makeSession, DEMO_NOW } from './grammar/engine.js';
export { buildGrammar } from './grammar/grammar.js';
export { chart } from './grammar/earley.js';
export { framesFrom } from './grammar/frames-from.js';
export { ENGLISH } from './grammar/locales/en.js';
export { PORTUGUESE } from './grammar/locales/pt.js';
