// Inlines the grammar engine, the demo ontology and the demo session into playground.src.html →
// playground.html: one file, no module loader. The output is gitignored; `npm run playground`
// from ext/dispatch regenerates it. (The page head still links Google Fonts; it is a bench page,
// not a sealed artifact.)
import { readFileSync, writeFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url);
const strip = (src) => src.replace(/^import [^\n]*;\n/gm, '').replace(/^export /gm, '');
const files = ['../src/grammar/earley.js', '../src/grammar/locales/en.js', '../src/grammar/locales/pt.js', '../src/grammar/grammar.js', '../src/grammar/engine.js', './demo.js'];
const js = files.map((f) => `// ── ${f.replace('../', '')} ──\n` + strip(readFileSync(here(f), 'utf8'))).join('\n');
const ont = readFileSync(here('./geostats.json'), 'utf8');
const page = readFileSync(here('./playground.src.html'), 'utf8');
writeFileSync(here('./playground.html'), page.replace('/*__PARSER__*/', 'const ONTOLOGY = ' + ont + ';\n' + js));
console.log('ext/dispatch/bench/playground.html written');
