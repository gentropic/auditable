// TOSTATE: a top-level variable of tools/micro/index.html becomes a property of a
// state object that a module exports (S in src/state.js by default).
//
//   node tools/micro/dev/tostate.mjs <name>[,<name>…] [--obj=S] [--from=state] [--dry]
//
// For each name, which must be a top-level let / const / var of the app script:
//   - every reference that resolves to it becomes <obj>.<name>. References are
//     resolved by scope, so a parameter, a local or a property key with the same
//     name is left alone. A shorthand property { name } becomes { name: <obj>.<name> }.
//   - its declaration goes. If the app's initial value is not the one the state
//     object already holds, the declaration becomes an assignment in the same place.
//   - the app imports <obj> from ./src/<from>.js if it does not already.
// The property must already exist in the state object: add it there first, with
// its comment. The tool refuses (and says why) when the property is missing, when
// <obj> is bound to something else where a reference stands, or when a declaration
// that must become an assignment shares its statement with other declarations.
// Do not run it while a smoke suite is reading the tree. See README.md.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse, patIds, moduleRefs } from './scope.mjs';

const DIR = fileURLToPath(new URL('..', import.meta.url));       // tools/micro/
const argv = process.argv.slice(2);
const val = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const DRY = argv.includes('--dry'), OBJ = val('obj', 'S'), FROM = val('from', 'state');
const names = (argv.find((a) => !a.startsWith('--')) || '').split(',').map((x) => x.trim()).filter(Boolean);
const die = (msg) => { console.error(msg); process.exit(1); };
if (!names.length) die('usage: tostate.mjs <name>[,<name>…] [--obj=S] [--from=state] [--dry]');

const readText = (p) => { const raw = readFileSync(p, 'utf8'), crlf = raw.includes('\r\n'); return { text: raw.split('\r\n').join('\n'), crlf }; };
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// ── the state object ────────────────────────────────────────────────────────
const statePath = `${DIR}src/${FROM}.js`;
if (!existsSync(statePath)) die(`no such module: src/${FROM}.js`);
const stateSrc = readText(statePath).text;
const held = new Map();                                    // property → the source text of its initial value
{
  let found = false;
  for (const n of parse(stateSrc).body) {
    if (n.type !== 'ExportNamedDeclaration' || !n.declaration || n.declaration.type !== 'VariableDeclaration') continue;
    for (const d of n.declaration.declarations) {
      if (d.id.type !== 'Identifier' || d.id.name !== OBJ) continue;
      if (!d.init || d.init.type !== 'ObjectExpression') die(`src/${FROM}.js: ${OBJ} is not an object literal`);
      found = true;
      for (const p of d.init.properties) if (p.type === 'Property' && !p.computed) held.set(p.key.name || p.key.value, stateSrc.slice(p.value.start, p.value.end));
    }
  }
  if (!found) die(`src/${FROM}.js does not export an object named ${OBJ}`);
}
for (const n of names) if (!held.has(n)) die(`src/${FROM}.js: ${OBJ} has no property '${n}' — add it there first (with its comment), then rerun`);

// ── the app script ──────────────────────────────────────────────────────────
const htmlPath = DIR + 'index.html';
const html = readText(htmlPath);
let appAt = -1, app = null;
{ const re = /<script type="module">([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html.text))) if (!app || m[1].length > app.length) { app = m[1]; appAt = m.index + '<script type="module">'.length; } }
if (app == null) die('index.html: no module script');
const lineOf = (pos) => html.text.slice(0, appAt + pos).split('\n').length;
const ast = parse(app);

const top = new Map();                                     // name → { kind, stmt, decl?, from?, imported? }
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') for (const s of n.specifiers) top.set(s.local.name, { kind: 'import', stmt: n, from: n.source.value, imported: s.type === 'ImportSpecifier' ? s.imported.name : null });
  else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') top.set(n.id.name, { kind: 'decl', stmt: n });
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) for (const id of patIds(d.id)) top.set(id, { kind: n.kind, stmt: n, decl: d });
}
for (const n of names) {
  const t = top.get(n);
  if (!t) die(`not a top-level variable of the app: ${n}`);
  if (t.kind === 'import' || t.kind === 'decl') die(`${n} is ${t.kind === 'import' ? 'an import' : 'a function or class'}, not a variable`);
  if (t.decl.id.type !== 'Identifier') die(`${n} is declared by a destructuring pattern — give it a declaration of its own first`);
}
const modPath = `./src/${FROM}.js`;
const objTop = top.get(OBJ);
if (objTop && !(objTop.kind === 'import' && objTop.from === modPath && objTop.imported === OBJ)) die(`the app already binds ${OBJ} to something other than the export of src/${FROM}.js`);

// ── references ──────────────────────────────────────────────────────────────
const want = new Set(names);
const refs = moduleRefs(ast.body).filter((r) => want.has(r.name));
for (const r of refs) if (r.scopes.some((s) => s.has(OBJ))) die(`line ${lineOf(r.start)}: ${r.name} is used where ${OBJ} is bound to something else`);
const edits = refs.map((r) => ({ start: r.start, end: r.end, text: r.shorthand ? `${r.name}: ${OBJ}.${r.name}` : `${OBJ}.${r.name}` }));

// ── declarations ────────────────────────────────────────────────────────────
const report = [];
const count = (n) => refs.filter((r) => r.name === n).length;
for (const st of new Set(names.map((n) => top.get(n).stmt))) {
  const going = st.declarations.filter((d) => d.id.type === 'Identifier' && want.has(d.id.name));
  const kept = st.declarations.filter((d) => !going.includes(d));
  const differs = going.filter((d) => squash(d.init ? app.slice(d.init.start, d.init.end) : 'undefined') !== squash(held.get(d.id.name)));
  if (differs.length && st.declarations.length > 1) die(`line ${lineOf(st.start)}: ${differs.map((d) => d.id.name).join(', ')} starts with a value other than the one in src/${FROM}.js, and shares its statement — give it a statement of its own first, or make the two values agree`);
  for (const d of going) report.push(`${d.id.name}: ${count(d.id.name)} references → ${OBJ}.${d.id.name}; declaration (line ${lineOf(st.start)}) ${differs.includes(d) ? `becomes ${OBJ}.${d.id.name} = …` : 'removed'}`);
  if (differs.length) {                                    // the one declarator: an assignment in its place (the init's own references are edited separately)
    const d = differs[0];
    edits.push({ start: st.start, end: d.init.start, text: `${OBJ}.${d.id.name} = ` });
  } else if (kept.length) {                                // cut the going declarators out of the list
    for (const d of going) {
      const i = st.declarations.indexOf(d), next = st.declarations.slice(i + 1).find((x) => kept.includes(x));
      if (next && !edits.some((e) => e.cut && e.end === d.start)) edits.push({ start: d.start, end: st.declarations[i + 1].start, text: '', cut: true });
      else { const prev = st.declarations[i - 1]; edits.push({ start: prev.end, end: d.end, text: '', cut: true }); }
    }
  } else {                                                 // the whole statement, and its line when it stands alone on it
    let a = st.start, b = st.end;
    const ls = app.lastIndexOf('\n', a - 1) + 1, le = app.indexOf('\n', b);
    const before = app.slice(ls, a), after = app.slice(b, le < 0 ? app.length : le);
    if (!before.trim() && (!after.trim() || /^\s*\/\//.test(after))) { a = ls; b = le < 0 ? app.length : le + 1; if (after.trim()) report.push(`  its comment went with it — move it to src/${FROM}.js if it is not there: ${after.trim()}`); }
    edits.push({ start: a, end: b, text: '' });
  }
}

// ── the import ──────────────────────────────────────────────────────────────
if (!objTop) {
  const imp = ast.body.find((n) => n.type === 'ImportDeclaration' && n.source.value === modPath && n.specifiers.some((s) => s.type === 'ImportSpecifier'));
  if (imp) { const last = imp.specifiers.filter((s) => s.type === 'ImportSpecifier').pop(); edits.push({ start: last.end, end: last.end, text: `, ${OBJ}` }); }
  else { const lastImp = ast.body.filter((n) => n.type === 'ImportDeclaration').pop(); const at = lastImp ? app.indexOf('\n', lastImp.end) + 1 : 0; edits.push({ start: at, end: at, text: `import { ${OBJ} } from '${modPath}';\n` }); }
  report.push(`the app now imports ${OBJ} from ${modPath}`);
}

// ── apply, back to front; an edit inside a removed range is dropped with it ──
edits.sort((p, q) => q.start - p.start || q.end - p.end);
const cuts = edits.filter((e) => e.text === '' && e.end > e.start);
let out = app;
for (const e of edits) {
  if (cuts.some((c) => c !== e && c.start <= e.start && e.end <= c.end)) continue;
  out = out.slice(0, e.start) + e.text + out.slice(e.end);
}
let after;
try { after = parse(out); } catch (err) { die(`the rewritten script does not parse: ${err.message}`); }
const left = moduleRefs(after.body).filter((r) => want.has(r.name));
if (left.length) die(`references the rewrite missed: ${[...new Set(left.map((r) => r.name))].join(', ')}`);

for (const l of report) console.log(l);
if (DRY) { console.log('(dry run: nothing written)'); process.exit(0); }
const text = html.text.slice(0, appAt) + out + html.text.slice(appAt + app.length);
writeFileSync(htmlPath, html.crlf ? text.split('\n').join('\r\n') : text);
