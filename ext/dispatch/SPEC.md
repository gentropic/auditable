# @gcu/dispatch — natural-language tool-call dispatch, session-trained

**Status:** v0.1 (folded in from the `gcu-dispatch` incubator, 2026-07-13)
**Depends on:** nothing (zero-dep, browser-pure ESM)

One utterance in, one routed, explainable tool call out. No conversation,
no agent loop, no network, no shipped model: the dispatcher is **trained
in the tab, from the session's own vocabulary, in under a second**, and
discarded with the tab. What ships is ~30 KB of banks, kinds, and two
linear learners.

## Provenance (one paragraph of history)

The incubator (`../gcu-dispatch`, kept as the lab) ran the experiment:
a 26M tool-calling transformer (Cactus Needle) scored 4/24 stock and
3/24 after a teacher finetune on a frozen yardstick; a Snips-shaped
resolver — averaged-perceptron intent + structured-perceptron slot
tagger + gazetteers + a deterministic assembler — scored 50/52 on the
tripled toolset, training in 0.8 s. The resolver ladder inverted. This
package is that winner, generalized. Full record:
`gcu-dispatch/eval/runs/2026-07-13-P2-comparison-report.md`.

## Architecture

```
        session (columns, categories, layers)
                    │ deriveVocab
                    ▼
tools (declarative) ──▶ gen (banks × kinds, seeded) ──▶ corpus
                    │                                     │ align (answer-first)
                    │                                     ▼
                    │                                   train (perceptrons, <1 s)
                    ▼                                     │
        createDispatcher({ vocab, tools, weights }) ◀─────┘
                    │
   dispatch(query, { surface }) → { calls, intent, margin, tags }
```

- **Intent**: averaged multiclass perceptron over unigrams/bigrams +
  gazetteer + STRUCTURAL features (has-comparison, has-layer, has-unit —
  the hand-computed nonlinearity that makes a linear model sufficient).
  `REFUSE` is a first-class intent.
- **Slots**: averaged structured perceptron (CRF-class), 10 tags
  (O COL OP VAL CAT RNG POS THICK ID LAYER), Viterbi decode.
- **Assembly**: deterministic, per KIND (below) — tags + lexicons →
  arguments; failure → empty calls (degrade to the palette).
- **Gate signal**: intent margin + assembly success (both meaningful,
  unlike a small transformer's logprob).
- **Surface scoping**: `dispatch(q, {surface: 'micro'})` restricts
  candidates to that surface's tools + REFUSE — the shortlister's role.

## The kind contract (the plugin boundary)

Tools are DATA. A host registers declarations; dispatch owns the kind
implementations (render for the corpus, align for training labels,
assemble for inference). Adding a tool to a host never edits dispatch.

Kinds (v0.1): `comparison-filter` · `column-pick` · `axis-position` ·
`axis-pick` · `category-visibility` · `layer-pick` · `layer-action` ·
`lexicon-pick` · `number-arg` · `no-arg`.

```js
{ name: 'micro.filterBlocks', kind: 'comparison-filter',
  nouns: ['blocks', 'the blocks', 'the model'], benchRange: 'BENCH' }
{ name: 'micro.sectionAt', kind: 'axis-position',
  axes: { Z: ['elevation', 'elev', 'horizontal', 'level', 'plan', 'rl'],
          X: ['easting', 'east', 'north-south', 'ns'],
          Y: ['northing', 'north', 'east-west', 'ew'] } }
{ name: 'micro.setColorRamp', kind: 'lexicon-pick', argName: 'preset',
  values: { viridis: ['viridis'], greys: ['greys', 'grayscale'] },
  frames: ['use the {val} ramp', 'switch to {val}', '{val} colors'] }
{ name: 'micro.clearFilter', kind: 'no-arg',
  frames: ['clear the filter', 'remove the filter', 'unfilter'] }
```

Frames are template strings with `{slot}` placeholders — declarations
stay JSON-able (see MCP adoption below). Kind-specific fields are
documented per kind in `src/kinds.js`.

## Session vocabulary

`deriveVocab({ numCols, catCols, catValues, layers, locale })` — the
host maps its live session into synonym pools (a column named FE gets
['FE', 'iron', …] from the element lexicon plus host-supplied aliases;
layers arrive as label→file). NOTHING here is baked: new project, new
vocabulary, retrain — the dispatcher cannot be stale.

`trainSession(vocab, tools, opts)` = generate → align → train in one
call. `opts.excludeTexts` is the eval-contamination guard (a Set of
normalized texts never emitted into the corpus). `opts.seed` for
byte-reproducibility. `opts.extraRefusals` for host-domain negatives.

## Locale

Banks, op-words, units, show/hide verbs, and word-numbers are keyed by
locale (`en` shipped; `pt-BR` is the next bank, not the next feature —
"esconde a canga", "seção na cota 1020" ride the same machinery).

## MCP adoption (designed, not built)

A WebMCP/MCP tool whose inputSchema is rightly shaped maps onto a kind
mechanically: empty properties → `no-arg`; one all-enum string →
`lexicon-pick` (enum values become the lexicon, description feeds
synonyms); one number → `number-arg`; enum'd column + op + value →
`comparison-filter`. `adoptMcpTool(schema, hints?)` would emit a
declaration, with `hints.kind` as the escape hatch for schemas the
heuristic can't type. The registry (numen) stays the source of truth;
dispatch derives, never invents. This is the bridge that makes any
well-shaped MCP surface voice/command-bar-able for free.

## Non-goals (unchanged from the incubator spec)

Multi-step plans, conversational replies, replacing explicit UI. The
palette is the floor: low margin or failed assembly returns `[]`, and
the host shows candidates instead of guessing.

## The grammar rung (clause)

**Status:** folded in 2026-10-08 from the `clause` prototype (files: `src/grammar/`,
bench and corpora: `bench/`), then extended the same day with elided verbs and
closed questions for golem's register. It sits BELOW the perceptrons in the
resolver ladder: a reading the grammar produces is a deterministic parse, not
a guess.

A parser for a controlled command language: **case grammar** (Fillmore 1968) —
every verb is a frame, arguments are roles marked by prepositions and
disambiguated by the *type* of the thing that fills them — over a small
phrase-structure grammar (~50 rules, `grammar.js`) run by an **Earley chart
parser with error-correcting repairs** (`earley.js`: skip / insert /
substitute, each with a cost; the minimum-cost derivation wins; strict mode is
budget 0). Domain knowledge is a JSON ontology (nouns with typed values and
per-locale synonyms, units, compounds, postmods, quantity modifiers, verb
frames); language knowledge is a locale bank (`locales/en.js`,
`locales/pt.js`). Output is a typed, resolved command — `{verb, theme, roles}`
— which is the tool call. A generator walks the same grammar forward and is the
test suite (`bench/fuzz.mjs`).

```
text ─ tokenize ─► lexemes ─ chart(Program) ─► parses ─ bind(frame) ─► readings ─ resolve(session) ─► commands ─ echo
                     │            │ strict fails / dies semantically
                     │            └─ chart with repair budget, tiers by cost, first tier that binds wins
                     └ locale bank: function words, prep canon map, stem, gender/agree, times, comps, phrase table
ontology: nouns/synonyms(_locale) · compounds · postmods · qmods · verbs{theme, roles{preps, types}, creates, distributive, sanity}
session:  objects{type, value|name, attrs, by, t} · names · last · history · now
```

`createEngine(ontology, locale)` → `{ understand, suggest, preview, assemble, echo, … }`.
Verdicts from `understand(text, session, {repair:{budget}})`: `ok` (with
`repaired` and `diag.repairs`), `ambiguous` (readings), `clarify` (reasons +
a `partial` echo), `reject` (reasons: islands, stop position, expected
terminals, the smallest span that fit the grammar but not the types),
`outofscope` (questions). Every verdict explains itself. `assemble({verb,
theme, roles}, session)` pushes a slot tagger's groups through the same binder
and resolver, so a statistical guess still has to type-check before it becomes
a call. `framesFrom(tools, baseOntology)` derives verb frames and enum noun
types from an MCP/numen-style manifest (`x-*` hints say what a signature
cannot).

**Elision and closed questions.** Most of what golem is asked is not an
imperative: "density of chalcopyrite", "2 km in miles", "histogram of cu",
"what is the density of chalcopyrite", "which countries are landlocked". The
grammar reads these as commands with the verb left out. `Cmd → NPList PPs`
yields a command with `verb: null`; the engine binds it against every frame the
ontology marks `elidable`, and the frames whose theme and roles type-check
survive. One survivor is the reading; two is `ambiguous`; none is a `reject`
that names what nothing takes ("nothing takes Cu on its own"). So the ontology,
not the grammar, decides what may be asked for bare. A closed question is the
same command with a wh-word in front: `Question → WHCOP NPList PPs` ("what is
…", "what's …", "quanto é …") and `Question → WH Core COP NPList PPs` ("which
countries are landlocked" = "landlocked countries"; the predicate must compound
onto the subject or the branch dies). Three small supports came with it: `NP →
UNIT` so "in miles" is a thing of type `unit`; the theme type `quantity:*` for
frames that take any dimensioned quantity (a bare number does not qualify);
and `compounds[].echo`, which asks the echo to show a compound attribute as an
adjective ("landlocked country"). The cost of elision is honest and measured:
dropping the verb from "identify the pyrite" leaves "the pyrite", a valid
definition request, so the mutation fuzzer counts it as a silent change.

`bench/golem.json` is the starting ontology for that register (conversions,
lookups, plots, definitions, lists, a timer, export, open, identify; en and
pt-BR), `bench/golem-corpus.mjs` its hand corpus, `bench/golem-fuzz.mjs` a
generator that is generic over the ontology and renders each command in four
surface forms (bare, verb, "what is", "which … are").

**Numbers** (recorded runs in `bench/results/`; regenerate with the package
scripts `test:grammar`, `fuzz`, `bench`, `perf`, `calib`): fuzzer round-trip
100% en and pt over 3000 sentences; junk words never accepted; silent meaning
changes ≤ 1.2%, all from a dropped adjective yielding a different *valid*
sentence. The golem register (`golem-fuzz.mjs`, 3000 sentences, four forms):
100% en and pt; silent changes 1.3% en, 0.8% pt, all from a dropped word
yielding another valid sentence (including the dropped verb that elision
reads as a bare request). Head-to-head on 547 held-out sentences against the perceptrons
trained on the same generated domain: clean 100% vs 86%; dropped preposition
97% vs 26%; reordered object 97% at 0.7% wrong vs 39% at 9.7%; chatty wrapper
100% vs 23%; heavy typo 44% via the cascade vs 35%. Strict parse 0.3–0.5 ms,
3.4 ms for a 45-token three-clause sentence; engine build ~3 ms.

**The ceiling.** This is a controlled language, by design. Covered: one
imperative with prepositional arguments; coordination (distributive on the
object, union on roles); quantifiers with exceptions; definite reference by
name, recency, attributes, plural, relative clause with time, comparative;
ellipsis chains (`again but with`, `same for`); `then`-sequences with
pronouns; bare phrases bound through `elidable` frames; closed questions
(wh-word + copula + phrase, "which X are Y"). Deliberately NOT covered, and not
to be added to this rung: open questions (why, how, explain), passives,
agreement checking, general subordinate clauses, open vocabulary, world
knowledge — those go to the tier above. The repair budget is
the only place the grammar disagrees with the input; it is bounded, and every
repair is reported.

**Gates.** `test/dispatch-grammar.test.mjs`: the hand corpora (`bench/corpus.mjs`,
`bench/corpus-pt.mjs`, `bench/golem-corpus.mjs`) must reproduce `bench/golden/*.txt`
byte for byte, both fuzzers must round-trip 100% in both locales, and
`framesFrom` must regenerate every demo frame. Change a golden file only when a verdict is meant to change,
and read the diff.

**Conventions.** In grammar actions, return `null` to kill a branch; return
`{}` for a meaningless-but-present node — never `null` for "nothing". The
recogniser accepts strings the type actions reject, so diagnostics distinguish
"syntax died" from "types died" (`smallestDeadSpan`). Preposition polysemy in
pt (`de` = of/from) resurrects attachment ambiguities English never had; fix
those in the ontology, not the grammar. Repair costs: skipping a preposition
costs like a content word; substituting a *known* word costs more than an
unknown; a repair that drops unknown words is a `clarify`, not an `ok`.
Trailing tokens can only be skipped at the top level.

**Fold-in, remaining** (1 and 2 done: the move, and `tagSetOf` in train.js):

3. A `frame` kind in `kinds.js`: `render` = the fuzzer's `genCommand` (parts
   carry role labels), `align` = trivial from parts, `assemble` =
   `engine.assemble({verb, theme, roles})`. Declaration = an ontology verb
   frame; `adoptMcpTool` = `framesFrom`. `genCommand` moves out of
   `bench/fuzz.mjs` into `src/grammar/` when this happens.
4. Rung 1 in `dispatch(q)`: `understand(q, session)` strict → with
   `{repair:{budget:3}}` → the perceptron path → `assemble` through the
   binder. Gate = clause status + margin. Return shape unchanged (`calls,
   intent, margin`) plus `explain: diag`.
5. One tokenizer, two granularities: dispatch's word tokenizer stays; clause's
   lexeme pass becomes a second stage over it, keeping word spans on each
   lexeme. Delete the `tagsFor` alignment hack in the bench once done.
6. Locale banks merge: `ENGLISH`/`PORTUGUESE` become the same bank as
   `LOCALES` (dispatch's word-numbers, ops and polite wrappers feed the
   generator; clause's function words, prep canon map, stem, times, comps feed
   the grammar).
7. Session: `deriveVocab` and clause's `session.objects` come from the same
   host call; objects need `type, name|value, attrs, by, t`.
8. Lint at load: two roles on one verb sharing a preposition with overlapping
   types; a noun with no synonyms in the active locale. Both are guaranteed
   ambiguities.
9. Measure repair-mode perf on long input; scale the budget with length if
   needed.
10. Train the perceptrons on the disordered corpus (the fuzzer's perturbations;
    tags move with tokens) and rerun the bench. Decide from the number whether
    CRF-informed costs (`mixed`) stay. The tagger is confidently wrong on
    reordered input until then; do not wire `mixed` into the cascade before this.

After the fold-in, for golem's register: free-text roles (`remember that …`,
`check: …`, `X means Y`, event titles — a role type `text` that swallows the
remainder, never repairs, and is legal only where a frame declares it), an
absolute date and clock lexicon beyond the relative `TIME` words, an
orientation token shape (`270/60`), and amendments (`in feet`, `and chile`)
through the ellipsis machinery. Arithmetic stays outside: a token-shape check
routes it to the expression parser before the grammar sees it.

After the fold-in, in general: answer fragments (a second start symbol for replies to a
pending `clarify`: `the second`, `v2`, `both`, `yes`); rank-then-ask with
pick-priors `(verb, prep, type) → role` as a printed table; a session fuzzer;
a rejection log; negation / `without` / ranges / number words / full pt gender
agreement.

## Roadmap

- pt-BR banks; per-host extra synonyms (au → 'ouro'). (The grammar rung ships a pt-BR bank already; the perceptron banks do not.)
- Rung-1 exact layer: normalized-pattern hash of the training corpus
  checked before the classifier (explainable exact hits).
- Gate calibration: margin thresholds fitted per session size.
- A-Bus service + numen registry wiring (the incubator spec's P3).
- micro/lamina integration: command bar + palette degradation.
- `adoptMcpTool` per the section above.
