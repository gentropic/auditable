// FRAME-LINT: world ↔ local coordinates are converted in ONE place (src/coords.js).
//
//   node tools/micro/dev/frame-lint.mjs            exit 1 on a breach
//   node tools/micro/dev/frame-lint.mjs --report   every remaining site, file by file
//
// micro keeps two coordinate spaces — WORLD (files, the user, a host) and LOCAL (what is drawn:
// world minus the scene frame's origin). Every coordinate bug of 2026-11-25 (the plain-language
// section, the elevation clip, saved sections, the surface built before its frame, a moved mesh's
// pick) was a hand-written conversion done slightly wrong, or one missing. So:
//   • `frame.origin` (the arithmetic) and `S.frame =` (the frame's life) belong in src/coords.js;
//   • a file may still hold the sites it had when this check arrived (ALLOWED below, shrinking
//     to nothing as files migrate) — but never MORE, and a new file none;
//   • a file below its allowance is reported, so the allowance is lowered with it.
// Passing the frame OBJECT on (`frame: S.frame` to condenser's builders) is fine: the library does
// the arithmetic. The check reads the source (comments stripped); it does not run it.
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const REPORT = process.argv.includes('--report');

// files whose frame arithmetic is on a frame they are HANDED (not the scene's), by design
const LIBRARY_LIKE = {
  'chunkworker.js': 'serialises a frame it was handed into a worker message',
  'placement.js': 're-expresses a build frame into a target frame it is handed (placeHeightfield)',
};
// the sites each file had when the check arrived — only ever lowered (2026-11-25: 84 in 34 files)
const ALLOWED = {};

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const PAT = [/frame\.origin/g, /S\.frame\s*=(?!=)/g];
const counts = {};
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
  if (f === 'coords.js' || LIBRARY_LIKE[f]) continue;
  const s = strip(readFileSync(SRC + f, 'utf8'));
  let n = 0; const lines = [];
  s.split('\n').forEach((line, i) => { let k = 0; for (const re of PAT) k += (line.match(re) || []).length; if (k) { n += k; lines.push(i + 1); } });
  if (n) counts[f] = { n, lines };
}
let bad = 0, total = 0;
const lower = [];
for (const [f, { n, lines }] of Object.entries(counts).sort()) {
  total += n;
  const allowed = ALLOWED[f] || 0;
  if (n > allowed) { bad++; console.log(`FRAME: ${f} has ${n} world↔local site(s) outside src/coords.js (allowed ${allowed}) — lines ${lines.join(', ')}: use coords.js`); }
  else if (REPORT) console.log(`  ${f}: ${n} (lines ${lines.join(', ')})`);
}
for (const [f, allowed] of Object.entries(ALLOWED)) { const n = counts[f] ? counts[f].n : 0; if (n < allowed) lower.push(`${f} ${allowed} → ${n}`); }
if (lower.length) console.log(`FRAME: lower the allowance in tools/micro/dev/frame-lint.mjs: ${lower.join(', ')}`);
console.log(bad ? `FRAME-LINT: FAIL — ${bad} file(s) over their allowance` : `FRAME-LINT: PASS — ${total} legacy site(s) left in ${Object.keys(counts).length} file(s)${lower.length ? ' (allowances to lower, above)' : ''}`);
process.exit(bad || lower.length ? 1 : 0);
