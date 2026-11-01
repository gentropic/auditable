// Render micro's keyboard shortcuts (src/keys.js) into the manual and the
// printable card, between their markers:
//   index.html   <!-- keys:manual --> … <!-- /keys:manual -->
//   card.html    <!-- keys:card:<group> --> … <!-- /keys:card:<group> -->
// node tools/micro/docs/sync-keys.mjs          rewrites both files
// node tools/micro/docs/sync-keys.mjs --check  exits 1 if either would change
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY_GROUPS, keysManualHtml, keysCardHtml } from '../src/keys.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function fill(text, marker, body, file) {
  const open = `<!-- ${marker} -->`, close = `<!-- /${marker} -->`;
  const a = text.indexOf(open), b = text.indexOf(close);
  if (a < 0 || b < a) throw new Error(`${file}: markers ${open} … ${close} not found`);
  return text.slice(0, a + open.length) + '\n' + body + '\n' + text.slice(b);
}

// → [{ file, before, after }]
export function renderKeyDocs() {
  const out = [];
  const man = path.join(here, 'index.html');
  const m0 = fs.readFileSync(man, 'utf8');
  out.push({ file: man, before: m0, after: fill(m0, 'keys:manual', keysManualHtml(), 'index.html') });
  const card = path.join(here, 'card.html');
  const c0 = fs.readFileSync(card, 'utf8');
  let c = c0;
  for (const g of KEY_GROUPS) c = fill(c, `keys:card:${g.replace(/ /g, '-')}`, keysCardHtml(g), 'card.html');
  out.push({ file: card, before: c0, after: c });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const r of renderKeyDocs()) {
    if (r.before === r.after) continue;
    stale++;
    if (check) console.log(`stale: ${path.relative(process.cwd(), r.file)}`);
    else { fs.writeFileSync(r.file, r.after); console.log(`wrote ${path.relative(process.cwd(), r.file)}`); }
  }
  if (check && stale) { console.log('run: node tools/micro/docs/sync-keys.mjs'); process.exit(1); }
  if (!stale) console.log('keys: in sync');
}
