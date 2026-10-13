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

**Slots for golem's register** (2026-10-13; corpus `bench/golem-slots.mjs`, goldens
`golden/golem-slots-{en,pt}.txt`):

- **Free text.** A theme or role of type `text` takes words verbatim. The span opens
  after the verb of a frame whose theme is `text` (past an optional `lead` word the
  frame lists, such as "that" / "que"); after a preposition a text role declares; after
  a colon or line break when a role declares `':'` (a demonstrative may come first:
  "summarise this: …", "word count of this: …"); after the verb or a theme noun of a
  frame whose text role declares the bare preposition `''` ("decode hex 676f"); a
  preposition or colon opens a span only where a frame that uses it is said or can be
  elided, and at most 160 candidates are tried; or, for
  a frame that declares `subject: ['text']`, it is the words before the verb ("pop means
  population"; the verb as typed, not a typo repair, and no colon or other verb before
  it). A payload after a colon is everything to the end, as typed, words the tokenizer
  would drop included. Any other span ends before a preposition, a weekday or "next"
  after which the rest still reads, or at the end of the input less the politeness and
  punctuation that close the sentence (the bank's `TRAIL`: "…, thanks", "… hole 12?"),
  so a filler that is content stays ("remember that hole 12 is ok"). Candidates are
  tried strictly, fewest words of text first wherever they opened, before any repair;
  the first whole reading wins. So "remind me to send the samples to the lab on friday
  at 9" keeps the date and time as arguments, and "search my notes for resurvey"
  searches for "resurvey". A span is one `TEXT` token: nothing inside it is looked up,
  stemmed or repaired, notes about words inside it are dropped, and the echo quotes it
  (cut at 60 characters; the command carries all of it).
- **The echo names every role.** Roles the ontology's `echoOrder` lists come first, then the
  rest, so two readings that differ only in a role never echo the same (and a host never
  takes the first of two readings it could not tell apart).
- **Bare text at an unknown word.** A frame's bare text role (`''`) may also start at a word
  nothing else knows, where the frame is said or elidable ("… 2% chalcopyrite").
- **Ambiguity with alternatives.** An `ambiguous` verdict carries `alternatives`, the
  commands of each reading, so a host whose tools take only one of them can bind each
  and say which (golem: "python" is a verb and a format; only the verb has a tool for a
  block of code).
- **Tokens with offsets.** The tokenizer keeps each token's place in the input, so a
  text span is sliced from what was typed. A colon before a space and a line break are
  `COLON` tokens; `< > <= >= = ≤ ≥` stand alone; numbers may carry a sign and
  thousands separators; a full stop ending the input is the sentence's, not the last
  word's ("… in miles."). Commas left at the edges after dropped fillers go too
  ("hey golem, …").
- **Dates and clock times.** Banks carry `days` (weekday numbers, or `{ rel }` days
  from today), `months`, `clocks` (noon, meio-dia) and `AMPM`. Things of type `date`
  (`{ dow, next }`, `{ off }`, or `{ d, m, y? }`, plus ISO dates) and `clock`
  (`{ h, mi }`: 09:30, 9pm, 9h30, "9 am", a bare hour) are NPs; a bare date is also a
  time argument with canon `on` ("call him tomorrow"). The host resolves a date
  against its own clock; the grammar never does.
- **Shapes.** `ontology.shapes: [{ type, re }]` declares token shapes (a regex source,
  so the ontology stays JSON) that become things of that type: `270/60` as an
  orientation, a hole id. A shape may span several pieces ("-19.92, -43.94",
  "14 on 14 off"); the longest that ends where a piece ends is taken first. A one-piece
  token may also stay a number. A shaped thing takes postmodifiers like a noun ("14 on 14
  off from 6 oct").
- **Case and glue.** A shape may declare `flags` (`''` for a case-sensitive one, such as a
  chemical formula: CuFeS2 is not cufes2 by accident); shapes are tested on the piece as
  typed, and a multi-piece shape never ends on a line break. A number glued to a unit the
  lexicon knows is the two of them ("5km", "45.2%", "2.7g/cm3"), and a filler that is also
  a unit is the unit right after a number ("75 um"; "um, …" stays a hesitation).
- **Number words.** Banks carry `numbers` (one to twenty, the tens, a dozen, half, a quarter of
  an, three quarters of a; pt um to cem, meia, um quarto de) as NUM senses, and "a/an + unit" is one
  of that unit ("an hour", "half an hour", "set a timer for ninety seconds").
- **Bare arguments.** A role whose `preps` include `''` takes a thing with no marker,
  only of the types such roles declare: "9am sao paulo in perth", "is 21 apr 2027 a
  working day".
- **Exact names.** A noun marked `exact: true` (places, file names) is matched as
  written: its words are never the target of a typo repair or a stem, so an unknown
  name stays unknown (and can fall to a text role) instead of becoming a near one.
- **Prepositions.** The English bank gained until, till, after, before, since, between,
  across, through, during, within, around, near; pt gained depois de, antes de, desde,
  entre, durante, através de, perto de. Role markers that are not prepositions in a
  grammar book but mark a role the same way: for each, for every, in each, in every,
  grouped by (canon `by`); weighted by (`weighted`); sorted by, ordered by (`sort`);
  having, that have, which have, have, has (`where`); pt para cada, por cada, em cada,
  agrupado por, ponderado por, ordenado por, que têm.
- **Quantifiers the session cannot fill.** "every X" resolves to the session's Xs; when
  the session holds none, the quantified thing stays in the command (`all: true`) for
  the host to apply ("true thickness of every intercept" of a table).
- **Subjects and typo repairs.** A subject before a verb may contain a word the typo
  pass turned into a verb: the check is on what was typed ("pop means population" when
  "pop" is one edit from "top").
- **Comparisons.** Prepositions with canons `above`, `below`, `atleast`, `atmost`,
  `equals` cover the words and the signs ("greater than", "at least", ">=", "maior
  que", "pelo menos"); quantity postmods on those canons read "cu > 0.5" and "gold is
  at least 1.2 g/t". English maps only these in `preps`; every other English
  preposition is its own canon.
- **Fillers.** The banks gained the hesitations and wrappers people type (um, well, i
  need, give me, for me; hum, me diz, preciso de). A host adds its own through
  `ontology.fillers`, which is where a word that is a value elsewhere belongs: "ok" is
  ordinary kriging in the geostatistics demo, so it is not in the English bank.

Still to do for golem: amendments (`in feet`, `and chile`) through the ellipsis
machinery, and answer fragments (below). Arithmetic stays outside: a token-shape check
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
