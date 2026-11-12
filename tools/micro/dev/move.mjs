// MOVE top-level declarations from one src module to another (existing or new),
// scope-correct, rewriting every importer. carve.mjs takes code OUT OF THE APP;
// this moves it between modules. See README.md beside this file.
//
//   node tools/micro/dev/move.mjs <from> <to> --names a,b,c [--header "comment"] [--dry]
//
// - the named top-level declarations of src/<from>.js move, with the comment block
//   directly above each, in source order, to the end of src/<to>.js (created with
//   --header as its opening comment when it does not exist)
// - inside them, every reference that resolves to <from>'s module scope:
//     · an import of <from> → imported by <to> from the same source (an import
//       of <to> itself is simply local there)
//     · a declaration that stays in <from> → <to> imports it from './<from>.js'
//       (<from> gains `export` on it when it lacked one); `$` is copied instead
//     · a moved name → stays (same module)
// - what stays in <from> and still uses a moved name imports it from './<to>.js'
// - every other module, and index.html, that imported a moved name from <from>
//   imports it from <to> instead
// - imports of <from> that only the moved code used are removed
// It REFUSES (and says why) a name that would clash in <to>, an assignment across
// the new module boundary (an imported binding can't be written), the hooks object
// H, a namespace import of <from>, and a statement that declares a name not moved.
// The two modules may end up importing each other: run cycles.mjs afterwards.
// Do not run it while a smoke suite is reading the tree.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse, patIds, moduleRefs } from './scope.mjs';

const DIR = fileURLToPath(new URL('..', import.meta.url));       // tools/micro/
const argv = process.argv.slice(2);
const [FROM, TO] = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const NAMES = new Set((opt('names') || '').split(',').map((x) => x.trim()).filter(Boolean));
const HEADER = opt('header'), DRY = argv.includes('--dry');
const die = (m) => { console.error(m); process.exit(1); };
if (!FROM || !TO || !NAMES.size) die('usage: move.mjs <from> <to> --names a,b,c [--header "…"] [--dry]');
if (FROM === TO) die('from and to are the same module');

const readText = (p) => { const raw = readFileSync(p, 'utf8'), crlf = raw.includes('\r\n'); return { text: raw.split('\r\n').join('\n'), crlf }; };
const writeText = (p, text, crlf) => { if (!DRY) writeFileSync(p, crlf ? text.split('\n').join('\r\n') : text); };
const applyEdits = (text, edits) => { for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) text = text.slice(0, e.start) + e.text + text.slice(e.end); return text; };
const fromPath = DIR + `src/${FROM}.js`, toPath = DIR + `src/${TO}.js`;
if (!existsSync(fromPath)) die(`no src/${FROM}.js`);
const isNew = !existsSync(toPath);
if (isNew && !HEADER) die(`src/${TO}.js does not exist: give it a --header`);

// ── a module's top level ────────────────────────────────────────────────────
function topOf(text) {
  const ast = parse(text), top = new Map(), imports = [];
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      imports.push(n);
      for (const s of n.specifiers) top.set(s.local.name, { kind: 'import', stmt: n, spec: s, from: n.source.value, imported: s.type === 'ImportSpecifier' ? s.imported.name : s.type === 'ImportNamespaceSpecifier' ? '*' : 'default' });
      continue;
    }
    const exp = n.type === 'ExportNamedDeclaration' && n.declaration;
    const d = exp ? n.declaration : n;
    if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') top.set(d.id.name, { kind: 'decl', stmt: n, decl: d, exported: !!exp });
    else if (d.type === 'VariableDeclaration') for (const v of d.declarations) for (const id of patIds(v.id)) top.set(id, { kind: d.kind, stmt: n, decl: d, exported: !!exp });
    if (n.type === 'ExportNamedDeclaration' && !n.declaration) for (const s of n.specifiers) top.set('export:' + s.exported.name, { kind: 'reexport', stmt: n });
  }
  return { ast, top, imports };
}
// the comment block directly above — but only below the last carve pointer in it
// ("// (x lives in src/y.js)"): what stands above a pointer belongs to something
// that already moved, or to the section, not to this declaration
const POINTER = /^\s*\/\/ \(.*\blives? in\b|^\s*\/\/ .*\blives? in src\/[\w-]+\.js\)?\s*$/;
const leadStart = (text, st) => {
  let a = text.lastIndexOf('\n', st.start - 1) + 1;
  if (text.slice(a, st.start).trim()) return st.start;
  for (;;) {
    if (a <= 1) break;
    const ps = text.lastIndexOf('\n', a - 2) + 1, line = text.slice(ps, a - 1);
    if (/^\s*\/\//.test(line) && !POINTER.test(line)) a = ps; else break;
  }
  return a;
};
const lineEnd = (text, end) => { const e = text.indexOf('\n', end); return e < 0 ? text.length : e + 1; };
const specText = (imported, local) => (imported === local ? local : `${imported} as ${local}`);

// ── <from> ──────────────────────────────────────────────────────────────────
const F = readText(fromPath);
const fm = topOf(F.text);
for (const nm of NAMES) { const t = fm.top.get(nm); if (!t || t.kind === 'import') die(`not a top-level declaration of ${FROM}: ${nm}`); }
const moved = [...new Set([...NAMES].map((n) => fm.top.get(n).stmt))].sort((a, b) => a.start - b.start);
for (const st of moved) {
  const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
  if (d.type === 'VariableDeclaration') for (const v of d.declarations) for (const id of patIds(v.id)) if (!NAMES.has(id)) die(`'${id}' shares a statement with a moved name — add it to --names`);
}
const movedSet = new Set(moved);
const staying = fm.ast.body.filter((n) => !movedSet.has(n) && n.type !== 'ImportDeclaration');

const inRefs = moduleRefs(moved), outRefs = moduleRefs(staying);
const needImport = new Map();            // local name → { from, imported } that <to> must import
const needFromExport = new Set();        // staying names <to> imports from <from>
const copyLocal = new Set();             // staying declarations copied into <to> ($)
const problems = [];
for (const r of inRefs) {
  if (NAMES.has(r.name)) continue;
  if (r.name === 'H') { problems.push('the moved code uses the hooks object H'); continue; }
  const t = fm.top.get(r.name);
  if (!t) continue;                                         // a global
  if (t.kind === 'import') {
    if (r.write) problems.push(`the moved code assigns the import '${r.name}'`);
    if (t.imported === '*' && t.from === `./${TO}.js`) problems.push(`namespace import of ${TO} in ${FROM}`);
    if (t.from === `./${TO}.js`) continue;                  // local in <to>
    needImport.set(r.name, { from: t.from, imported: t.imported });
    continue;
  }
  if (r.name === '$') { copyLocal.add('$'); continue; }
  if (r.write) { problems.push(`the moved code assigns '${r.name}', which stays in ${FROM}`); continue; }
  needFromExport.add(r.name);
  needImport.set(r.name, { from: `./${FROM}.js`, imported: r.name });
}
const backImport = new Set();            // moved names what stays in <from> still uses
for (const r of outRefs) if (NAMES.has(r.name)) { if (r.write) problems.push(`${FROM} still assigns '${r.name}', which moves`); backImport.add(r.name); }
for (const r of outRefs) if (r.name === 'H') { /* fine: stays */ }

// ── <to> ────────────────────────────────────────────────────────────────────
const T = isNew ? { text: '', crlf: F.crlf } : readText(toPath);
const tm = isNew ? { ast: { body: [] }, top: new Map(), imports: [] } : topOf(T.text);
const toDropSpec = new Set();            // <to>'s imports of moved names from <from> (become local)
for (const nm of NAMES) {
  const t = tm.top.get(nm);
  if (!t) continue;
  if (t.kind === 'import' && t.from === `./${FROM}.js` && t.imported === nm) { toDropSpec.add(t.spec); continue; }
  problems.push(`'${nm}' is already bound in ${TO}`);
}
for (const [local, need] of needImport) {
  const t = tm.top.get(local);
  if (!t) continue;
  if (t.kind === 'import' && t.from === need.from && t.imported === need.imported) { needImport.delete(local); continue; }
  problems.push(`'${local}' is bound differently in ${TO} (the moved code wants it from ${need.from})`);
}
if (copyLocal.has('$') && tm.top.has('$')) copyLocal.delete('$');
// does <to> import from <from> by namespace? then the rewrite is not ours to do
for (const n of tm.imports) if (n.source.value === `./${FROM}.js` && n.specifiers.some((s) => s.type === 'ImportNamespaceSpecifier')) problems.push(`${TO} imports ${FROM} as a namespace`);
if (problems.length) die('REFUSED:\n  ' + [...new Set(problems)].join('\n  '));

// rewrite one file's import declarations: drop some specifiers, add some (by source)
// adds: Map(source → [[imported, local]]). Additions merge into an existing
// declaration from that source, else a new line after `after` (or the last import).
function importEdits(text, imports, drops, adds, after) {
  const edits = [], merged = new Set();
  for (const n of imports) {
    const add = adds.get(n.source.value);
    const dropped = n.specifiers.filter((s) => drops.has(s));
    if (!dropped.length && !add) continue;
    if (n.specifiers.some((s) => s.type !== 'ImportSpecifier')) { if (dropped.length) die(`can't rewrite a default/namespace import: ${text.slice(n.start, n.end)}`); continue; }
    const keep = n.specifiers.filter((s) => !drops.has(s)).map((s) => [s.imported.name, s.local.name]);
    if (add) { for (const p of add) if (!keep.some((k) => k[1] === p[1])) keep.push(p); merged.add(n.source.value); }
    if (!keep.length) { edits.push({ start: n.start, end: lineEnd(text, n.end), text: '' }); continue; }
    edits.push({ start: n.start, end: n.end, text: `import { ${keep.map(([i, l]) => specText(i, l)).join(', ')} } from '${n.source.value}';` });
  }
  const fresh = [...adds].filter(([src]) => !merged.has(src));
  if (fresh.length) {
    const anchor = after || imports[imports.length - 1];
    const at = anchor ? lineEnd(text, anchor.end) : 0;
    edits.push({ start: at, end: at, text: fresh.map(([src, ps]) => `import { ${ps.map(([i, l]) => specText(i, l)).join(', ')} } from '${src}';\n`).join('') });
  }
  return edits;
}

// the moved text, each statement exported where it was or where something now needs it
const exportNeeded = new Set([...NAMES].filter((n) => fm.top.get(n).exported || backImport.has(n)));
const crossUsers = [];                   // [file, names] — other importers, filled below
let body = '';
for (const st of moved) {
  const a = leadStart(F.text, st), e = lineEnd(F.text, st.end);
  let t = F.text.slice(a, e);
  if (st.type !== 'ExportNamedDeclaration') {
    const d = st, ids = d.type === 'VariableDeclaration' ? d.declarations.flatMap((v) => patIds(v.id)) : [d.id.name];
    if (ids.some((x) => exportNeeded.has(x))) { const off = st.start - a; t = t.slice(0, off) + 'export ' + t.slice(off); }
  }
  body += t;
}

// ── other importers (src modules + index.html) ──────────────────────────────
const others = [];
for (const f of readdirSync(DIR + 'src')) if (f.endsWith('.js') && f !== `${FROM}.js` && f !== `${TO}.js`) others.push({ path: DIR + 'src/' + f, label: f, prefix: './', script: false });
others.push({ path: DIR + 'index.html', label: 'index.html', prefix: './src/', script: true });
const otherOut = [];
for (const o of others) {
  const R = readText(o.path);
  let off = 0, code = R.text;
  if (o.script) {                                          // the app: the largest module script
    const re = /<script type="module">([\s\S]*?)<\/script>/g; let m, best = null;
    while ((m = re.exec(R.text))) if (!best || m[1].length > best[1].length) best = m;
    off = best.index + '<script type="module">'.length; code = best[1];
  }
  const ast = parse(code), imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
  const src = `${o.prefix}${FROM}.js`, dst = `${o.prefix}${TO}.js`;
  const drops = new Set(), add = [];
  for (const n of imports) if (n.source.value === src) for (const s of n.specifiers) {
    if (s.type === 'ImportNamespaceSpecifier') die(`${o.label} imports ${FROM} as a namespace — rewrite by hand`);
    if (s.type === 'ImportSpecifier' && NAMES.has(s.imported.name)) {
      drops.add(s); add.push([s.imported.name, s.local.name]);
      if (!exportNeeded.has(s.imported.name)) die(`${o.label} imports '${s.imported.name}', which ${FROM} does not export`);
    }
  }
  if (!drops.size) continue;
  const after = imports.find((n) => n.source.value === src);
  const edits = importEdits(code, imports, drops, new Map([[dst, add]]), after);
  const next = applyEdits(code, edits);
  otherOut.push({ o, R, text: o.script ? R.text.slice(0, off) + next + R.text.slice(off + code.length) : next });
  crossUsers.push([o.label, add.map((p) => p[0])]);
}

// ── write <from> ────────────────────────────────────────────────────────────
const fEdits = [];
for (const st of moved) fEdits.push({ start: leadStart(F.text, st), end: lineEnd(F.text, st.end), text: '' });
for (const nm of needFromExport) {
  const t = fm.top.get(nm);
  if (t.exported) continue;
  if (t.stmt.type === 'ExportNamedDeclaration') continue;
  fEdits.push({ start: t.stmt.start, end: t.stmt.start, text: 'export ' });
}
// imports that only the moved code used
const outNames = new Set(outRefs.map((r) => r.name));
const fDrops = new Set();
for (const n of fm.imports) for (const s of n.specifiers) if (inRefs.some((r) => r.name === s.local.name) && !outNames.has(s.local.name)) fDrops.add(s);
const fAdds = new Map(backImport.size ? [[`./${TO}.js`, [...backImport].map((n) => [n, n])]] : []);
fEdits.push(...importEdits(F.text, fm.imports, fDrops, fAdds));
let fText = applyEdits(F.text, fEdits).replace(/\n{3,}/g, '\n\n');

// ── write <to> ──────────────────────────────────────────────────────────────
const tAdds = new Map();
for (const [local, need] of needImport) { if (!tAdds.has(need.from)) tAdds.set(need.from, []); tAdds.get(need.from).push([need.imported, local]); }
let tText;
const localText = copyLocal.has('$') ? F.text.slice(fm.top.get('$').stmt.start, lineEnd(F.text, fm.top.get('$').stmt.end)) : '';
if (isNew) {
  const head = HEADER.split('\n').map((l) => '// ' + l).join('\n') + '\n';
  const imps = [...tAdds].map(([src, ps]) => `import { ${ps.map(([i, l]) => specText(i, l)).join(', ')} } from '${src}';\n`).join('');
  tText = head + imps + localText + '\n' + body.replace(/^\n+/, '');
} else {
  const edits = importEdits(T.text, tm.imports, toDropSpec, tAdds);
  if (localText) { const last = tm.imports[tm.imports.length - 1]; const at = last ? lineEnd(T.text, last.end) : 0; edits.push({ start: at, end: at, text: localText }); }
  tText = applyEdits(T.text, edits);
  tText = tText.replace(/\n*$/, '\n') + '\n' + body.replace(/^\n+/, '');
}
tText = tText.replace(/\n{3,}/g, '\n\n');

// ── report + write ──────────────────────────────────────────────────────────
console.log(`${FROM} → ${TO}${isNew ? ' (new)' : ''}: ${NAMES.size} names, ${moved.length} statements, ${body.split('\n').length - 1} lines`);
if (tAdds.size) console.log(`  ${TO} imports: ` + [...tAdds].map(([s, ps]) => `${ps.map((p) => p[1]).join(', ')} from ${s}`).join('; '));
if (copyLocal.size) console.log(`  ${TO} gets its own: ${[...copyLocal].join(', ')}`);
if (backImport.size) console.log(`  ${FROM} imports back: ${[...backImport].join(', ')}`);
if (needFromExport.size) console.log(`  ${FROM} exports for it: ${[...needFromExport].filter((n) => !fm.top.get(n).exported).join(', ') || '(already exported)'}`);
if (fDrops.size) console.log(`  ${FROM} drops imports: ${[...fDrops].map((s) => s.local.name).join(', ')}`);
for (const [l, ns] of crossUsers) console.log(`  ${l}: ${ns.join(', ')} now from ${TO}`);
writeText(fromPath, fText, F.crlf);
writeText(toPath, tText, T.crlf);
for (const { o, R, text } of otherOut) writeText(o.path, text, R.crlf);
if (DRY) console.log('(dry run — nothing written)');
