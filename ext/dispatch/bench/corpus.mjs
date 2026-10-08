// Hand corpus, English: flat commands, coordination and quantifiers, reference, ellipsis, sequencing,
// repair, and deliberate breakers. `node corpus.mjs` prints the verdicts; golden/corpus-en.txt is the
// committed output and test/dispatch-grammar.test.mjs diffs against it. Regenerate the golden file only
// when a verdict is meant to change, and read the diff.
import { createEngine, makeSession, ENGLISH } from '../src/main.js';
import { DEMO_OBJECTS } from './demo.js';
import { readFileSync } from 'node:fs';

export const ONTOLOGY = JSON.parse(readFileSync(new URL('./geostats.json', import.meta.url), 'utf8'));

export const CORPUS_EN = [
  ['— flat —'],
  'krige Cu',
  'krige Cu in the west domain with variogram v2 and a 200 m search',
  'estimate copper in oxide using ordinary kriging with v1',
  'clip Ni at 2 %',
  'composite the samples to 2 m in the sulfide domain',
  'fit a spherical variogram for Ni in the east domain',
  ['— coordination / quantifiers —'],
  'krige Cu, Ni and Co in the west and east domains with v2',
  'krige Cu in every domain except oxide using v1',
  'delete all variograms',
  ['— reference —'],
  'krige Cu in west with the last Cu variogram',
  'show the previous run',
  'export the block model from run r1 as csv',
  'compare the Cu variograms',
  ['— ellipsis —'],
  'krige Ni in east with v3 and 150 m',
  'again but with 300 m',
  'same for Cu',
  'rerun with simple kriging in the west domain',
  'again',
  ['— sequencing —'],
  'fit a spherical variogram for Cu in west, then krige Cu in west with it',
  ['— repair —'],
  'krig Cu in the wset domain with v1',
  'krige coper in oxide with v1',
  ['— breakers —'],
  'frobnicate Cu',
  'krige Cu with a fluffy thing',
  'krige the variogram',
  'krige Cu from the west domain',
  'krige Cu with the west domain',
  'krige Cu west',
  'krige Cu in west with 200',
  'krige in the west domain',
  'clip Cu in west',
  'krige grade in west',
  'why is the Ni estimate so smooth',
  'show me the block model',
  'krige Cu with v1 and v2',
  'compare v1 with v2',
  'krige Cu in west with the last variogram',
  'krige Cu in west with v1 and 200 m and ordinary kriging and v2',
  'krige Cu in west using composites',
  'krige Cu and Ni in west and east with v1 and 200 m',
  'export the Cu run as gslib and then delete it',
  'krige Cu in west with 200 m with v1',
];

// run a corpus through a fresh engine + demo session; returns the text the CLI prints.
// `parses` adds the "N syntactic parses" line (the English golden file has it, the Portuguese one does not).
export function runCorpus(items, locale = ENGLISH, { parses = locale === ENGLISH, ontology = ONTOLOGY, objects = DEMO_OBJECTS } = {}) {
  const { understand } = createEngine(ontology, locale);
  const S = makeSession(structuredClone(objects));
  const out = [];
  for (const item of items) {
    if (Array.isArray(item)) { out.push('\n' + item[0]); continue; }
    const r = understand(item, S);
    const tag = { ok: '✓', ambiguous: '≈', clarify: '?', reject: '✗', outofscope: '↑' }[r.status];
    let line = `${tag} ${item}\n    → `;
    if (r.status === 'ok') line += r.echo;
    else if (r.status === 'ambiguous') line += 'AMBIGUOUS:\n      ' + r.readings.join('\n      ');
    else if (r.status === 'clarify') line += 'CLARIFY: ' + r.reasons.join('; ') + (r.partial ? `\n      (so far: ${r.partial.join(' / ')})` : '');
    else line += r.status.toUpperCase() + ': ' + r.reasons.join('; ');
    if (r.diag.notes.length) line += `\n    · ${r.diag.notes.join('; ')}`;
    if (parses && r.diag.parses > 1) line += `\n    · ${r.diag.parses} syntactic parses`;
    out.push(line);
  }
  return out.join('\n') + '\n';
}

if (/(^|[\\/])corpus\.mjs$/.test(process.argv[1] ?? '')) process.stdout.write(runCorpus(CORPUS_EN));
