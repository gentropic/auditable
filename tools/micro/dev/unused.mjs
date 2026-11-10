// UNUSED: the imports of tools/micro/index.html that nothing in the app script uses.
//
//   node tools/micro/dev/unused.mjs                     the list, grouped by source
//   node tools/micro/dev/unused.mjs --prune [--dry]     remove them
//   node tools/micro/dev/unused.mjs --prune=a,b         remove only these (refused when used)
//
// carve.mjs moves code out of the app and leaves behind the imports only that code
// used. They do no harm when the page runs, but they make the app look as if it
// depends on things it does not.
// A name counts as used when some reference in the script resolves to the module
// scope (scope.mjs): a parameter, a local or a property key of the same name is not
// a use, and neither is a mention in a comment or a string.
// --prune removes the named imports; a declaration left with none goes whole, with
// the comment at the end of its line. A side-effect import (`import './x.js'`), a
// default import and a namespace import are never touched.
// Do not run it while a smoke suite is reading the tree. See README.md.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse, moduleRefs } from './scope.mjs';

const DIR = fileURLToPath(new URL('..', import.meta.url));       // tools/micro/
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const pruneArg = argv.find((a) => a === '--prune' || a.startsWith('--prune='));
const ONLY = pruneArg && pruneArg.includes('=') ? new Set(pruneArg.slice(8).split(',').map((x) => x.trim()).filter(Boolean)) : null;

const htmlPath = DIR + 'index.html';
const raw = readFileSync(htmlPath, 'utf8'), crlf = raw.includes('\r\n');
const html = raw.split('\r\n').join('\n');
let app = null, appAt = 0;
{ const re = /<script type="module">([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html))) if (app === null || m[1].length > app.length) { app = m[1]; appAt = m.index + '<script type="module">'.length; } }
if (app === null) { console.error('no module script in tools/micro/index.html'); process.exit(1); }

const ast = parse(app);
const decls = ast.body.filter((n) => n.type === 'ImportDeclaration');
const used = new Set(moduleRefs(ast.body.filter((n) => n.type !== 'ImportDeclaration')).map((r) => r.name));
const isUnused = (s) => s.type === 'ImportSpecifier' && !used.has(s.local.name);

const all = decls.flatMap((n) => n.specifiers.filter(isUnused).map((s) => ({ name: s.local.name, from: n.source.value })));
if (!pruneArg) {
  const by = new Map();
  for (const u of all) { if (!by.has(u.from)) by.set(u.from, []); by.get(u.from).push(u.name); }
  for (const [from, names] of by) console.log(`${from}: ${names.join(', ')}`);
  const total = decls.reduce((n, d) => n + d.specifiers.length, 0);
  console.log(`${all.length} unused of ${total} imports, from ${by.size} of ${decls.length} sources`);
  process.exit(0);
}

const edits = [], refused = [];
let removed = 0, gone = 0;
if (ONLY) {
  const known = new Set(decls.flatMap((n) => n.specifiers.map((s) => s.local.name)));
  for (const nm of ONLY) if (!known.has(nm)) refused.push(`${nm} (not an import)`); else if (used.has(nm)) refused.push(`${nm} (used)`);
}
for (const n of decls) {
  const drop = n.specifiers.filter((s) => isUnused(s) && (!ONLY || ONLY.has(s.local.name)));
  if (!drop.length) continue;
  const keep = n.specifiers.filter((s) => !drop.includes(s));
  removed += drop.length;
  if (!keep.length) {
    let end = n.end;
    const rest = /^[ \t]*\/\/[^\n]*/.exec(app.slice(end));         // the comment that described it
    if (rest) end += rest[0].length;
    if (app[end] === '\n') end++;
    edits.push({ start: n.start, end, text: '' });
    gone++;
  } else {
    const text = (s) => app.slice(s.start, s.end);
    const named = keep.filter((s) => s.type === 'ImportSpecifier').map(text);
    const other = keep.filter((s) => s.type !== 'ImportSpecifier').map(text);
    const list = [...other, ...(named.length ? ['{ ' + named.join(', ') + ' }'] : [])].join(', ');
    edits.push({ start: n.start, end: n.end, text: `import ${list} from ${app.slice(n.source.start, n.source.end)};` });
  }
}
let out = app;
for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
parse(out);                                                       // still a module
for (const r of refused) console.log(`  refused  ${r}`);
console.log(`${removed} imports removed from ${edits.length} declarations (${gone} declarations gone)`);
if (DRY) { console.log('(dry run — nothing written)'); process.exit(0); }
if (removed) {
  const text = html.slice(0, appAt) + out + html.slice(appAt + app.length);
  writeFileSync(htmlPath, crlf ? text.split('\n').join('\r\n') : text);
}
