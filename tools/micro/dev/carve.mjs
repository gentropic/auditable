// CARVE top-level declarations out of tools/micro/index.html into
// tools/micro/src/<module>.js — scope-correct. See README.md beside this file.
//
//   node tools/micro/dev/carve.mjs <module> --names a,b,c --hooks x,y [--getters frame,renderer]
//        [--local '$=(s) => document.querySelector(s)'] [--header "comment text"] [--dry]
//
// - the named top-level declarations (functions, const/let statements) move, with
//   the comment block directly above each, in source order; each is exported
// - inside them, every reference that resolves to the APP's module scope:
//     · an import → re-imported (path re-rooted one level deeper)
//     · a moved name → stays (same module)
//     · a --hooks / --getters name → H.<name> (H is the live hooks object the app
//       passes in: getters for lets that change, so reads stay current)
//     · a --local → defined locally in the module
//     · anything else → the tool REFUSES (prints it) — decide, then rerun
// - index.html loses the declarations, gains `import { …used… } from './src/<module>.js'`
//   and `set<Module>Hooks({ … })` right under it (function hooks are hoisted, the
//   rest are lazy getters — so the wiring is safe before anything else runs).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { Parser } from '../../../ext/acorn/acorn.esm.min.js';

const args = process.argv.slice(2);
const mod = args[0];
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const list = (k) => (opt(k) ? opt(k).split(',').map((x) => x.trim()).filter(Boolean) : []);
const names = new Set(list('names')), hooks = new Set(list('hooks')), getters = new Set(list('getters'));
const locals = (args.filter((a, i) => args[i - 1] === '--local'));
const dry = args.includes('--dry');
const HERE = fileURLToPath(new URL('..', import.meta.url));       // tools/micro/, wherever it is run from
const PATH = HERE + 'index.html';
const html = readFileSync(PATH, 'utf8');
const mOpen = html.indexOf('<script type="module">\n') + '<script type="module">\n'.length;
const mClose = html.indexOf('</script>', mOpen);
const src = html.slice(mOpen, mClose);
const ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: false });

// ── top level ────────────────────────────────────────────────────────────────
const patIds = (p, out = []) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patIds(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((e) => patIds(e, out));
  else if (p.type === 'AssignmentPattern') patIds(p.left, out);
  else if (p.type === 'RestElement') patIds(p.argument, out);
  return out;
};
const top = new Map();                                     // name → { kind, stmt, from?, imported? }
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') for (const s of n.specifiers) top.set(s.local.name, { kind: 'import', stmt: n, from: n.source.value, imported: s.type === 'ImportSpecifier' ? s.imported.name : s.type === 'ImportNamespaceSpecifier' ? '*' : 'default' });
  else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') top.set(n.id.name, { kind: 'decl', stmt: n });
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) for (const id of patIds(d.id)) top.set(id, { kind: n.kind, stmt: n });
  else if (n.type === 'ExportNamedDeclaration' && n.declaration) { /* none expected in the app */ }
}
if (!names.size) { console.error('--names is required'); process.exit(1); }
for (const nm of names) if (!top.has(nm) || top.get(nm).kind === 'import') { console.error(`not a top-level declaration: ${nm}`); process.exit(1); }
const stmts = [...new Set([...names].map((n) => top.get(n).stmt))].sort((a, b) => a.start - b.start);
for (const st of stmts) if (st.type === 'VariableDeclaration') for (const d of st.declarations) for (const id of patIds(d.id)) if (!names.has(id)) { console.error(`'${id}' shares a statement with a moved name — add it to --names`); process.exit(1); }

// ── scope-correct references inside the moved statements ────────────────────
// a reference that no enclosing scope declares resolves to the MODULE scope
const refs = [];                                           // { name, start, end, shorthand }
function hoisted(body, out) {                              // var + function declarations of a function body
  const walk = (x) => {
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'VariableDeclaration' && x.kind === 'var') x.declarations.forEach((d) => patIds(d.id, out));
    if (x.type === 'FunctionDeclaration') { out.push(x.id.name); return; }
    if (/Function|Class/.test(x.type)) return;
    for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  };
  walk(body);
  return out;
}
function blockDecls(stmtsArr) {
  const out = [];
  for (const s of stmtsArr) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach((d) => patIds(d.id, out));
    if (s.type === 'ClassDeclaration' || s.type === 'FunctionDeclaration') out.push(s.id.name);
  }
  return out;
}
function visit(x, scopes, parent, key) {
  if (!x || typeof x.type !== 'string') return;
  const has = (n) => scopes.some((s) => s.has(n));
  switch (x.type) {
    case 'Identifier': {
      if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
        || ((parent.type === 'Property' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand)
        || (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed)
        || ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label'))) return;
      if (parent && parent.type === 'Property' && parent.shorthand && key === 'key') return;   // the value side carries it
      const write = !!parent && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression');
      if (!has(x.name)) refs.push({ name: x.name, start: x.start, end: x.end, write, shorthand: !!(parent && parent.type === 'Property' && parent.shorthand && key === 'value') });
      return;
    }
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
      const sc = new Set();
      if (x.id && x.type === 'FunctionExpression') sc.add(x.id.name);
      x.params.forEach((p) => patIds(p, []).forEach((n) => sc.add(n)));
      if (x.body.type === 'BlockStatement') { hoisted(x.body, []).forEach((n) => sc.add(n)); blockDecls(x.body.body).forEach((n) => sc.add(n)); }
      const inner = [...scopes, sc];
      x.params.forEach((p) => visitPattern(p, inner));
      if (x.body.type === 'BlockStatement') x.body.body.forEach((s) => visit(s, inner, x.body, 'body')); else visit(x.body, inner, x, 'body');
      return;
    }
    case 'ClassDeclaration': case 'ClassExpression': {
      const sc = new Set(x.id ? [x.id.name] : []);
      if (x.superClass) visit(x.superClass, scopes, x, 'superClass');
      x.body.body.forEach((m) => visit(m, [...scopes, sc], x.body, 'body'));
      return;
    }
    case 'BlockStatement': case 'StaticBlock': { const sc = new Set(blockDecls(x.body)); x.body.forEach((s) => visit(s, [...scopes, sc], x, 'body')); return; }
    case 'SwitchStatement': { visit(x.discriminant, scopes, x, 'discriminant'); const sc = new Set(blockDecls(x.cases.flatMap((c) => c.consequent))); for (const c of x.cases) { if (c.test) visit(c.test, [...scopes, sc], c, 'test'); c.consequent.forEach((s) => visit(s, [...scopes, sc], c, 'consequent')); } return; }
    case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
      const sc = new Set();
      const init = x.init || x.left;
      if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') init.declarations.forEach((d) => patIds(d.id, []).forEach((n) => sc.add(n)));
      const inner = [...scopes, sc];
      for (const k of ['init', 'left', 'test', 'update', 'right', 'body']) if (x[k]) visit(x[k], inner, x, k);
      return;
    }
    case 'CatchClause': { const sc = new Set(x.param ? patIds(x.param, []) : []); if (x.param) visitPattern(x.param, [...scopes, sc]); visit(x.body, [...scopes, sc], x, 'body'); return; }
    case 'VariableDeclarator': { visitPattern(x.id, scopes); if (x.init) visit(x.init, scopes, x, 'init'); return; }
    default:
      for (const k in x) { if (k === 'start' || k === 'end') continue; const v = x[k]; if (Array.isArray(v)) v.forEach((c) => visit(c, scopes, x, k)); else if (v && typeof v.type === 'string') visit(v, scopes, x, k); }
  }
}
// a pattern declares (no refs) except its default values / computed keys
function visitPattern(p, scopes) {
  if (!p) return;
  if (p.type === 'AssignmentPattern') { visitPattern(p.left, scopes); visit(p.right, scopes, p, 'right'); }
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => { if (q.type === 'RestElement') visitPattern(q.argument, scopes); else { if (q.computed) visit(q.key, scopes, q, 'key'); visitPattern(q.value, scopes); } });
  else if (p.type === 'ArrayPattern') p.elements.forEach((e) => visitPattern(e, scopes));
  else if (p.type === 'RestElement') visitPattern(p.argument, scopes);
  else if (p.type !== 'Identifier') visit(p, scopes, null, null);   // a member target in an assignment pattern
}
for (const st of stmts) visit(st, [new Set()], null, null);

// ── classify module-scope references ────────────────────────────────────────
const imports = new Map(), hookUse = new Set(), unknown = new Set();
const localNames = new Set(locals.map((l) => l.split('=')[0].trim()));
for (const r of refs) {
  if (names.has(r.name) || localNames.has(r.name)) continue;
  const t = top.get(r.name);
  if (!t) continue;                                        // a global (window, Math, document…)
  if (t.kind === 'import') { imports.set(r.name, t); continue; }
  if (hooks.has(r.name) || getters.has(r.name)) { if (r.write) { console.error(`'${r.name}' is ASSIGNED in the moved code — a hook can't be written; move it (--names) or give the app a setter`); process.exit(1); } hookUse.add(r.name); continue; }
  unknown.add(r.name);
}
if (unknown.size) { console.error('UNHANDLED app-scope references — pass them as --hooks/--getters, move them (--names) or --local:\n  ' + [...unknown].sort().join(', ')); process.exit(1); }

// ── the module text ─────────────────────────────────────────────────────────
const leadStart = (st) => {                                // include the comment block directly above
  let a = src.lastIndexOf('\n', st.start - 1) + 1;         // the statement's own line
  if (src.slice(a, st.start).trim()) return st.start;     // something else shares the line
  for (;;) {
    if (a <= 1) break;
    const ps = src.lastIndexOf('\n', a - 2) + 1, line = src.slice(ps, a - 1);
    if (/^\s*\/\//.test(line)) a = ps; else break;
  }
  return a;
};
// the hooks object is H — unless the moved code binds its own H (a height parameter, say),
// which would shadow it: then it is HK.
const idRe = (n) => new RegExp('(?<![.\\w$])' + n + '(?![\\w$])');
const movedSrc = stmts.map((st) => src.slice(st.start, st.end)).join('\n');
const HN = idRe('H').test(movedSrc) ? 'HK' : 'H';
if (HN === 'HK' && idRe('HK').test(movedSrc)) { console.error('moved code uses both H and HK as identifiers — pick another hooks name'); process.exit(1); }
const pieces = [];
for (const st of stmts) {
  const a = leadStart(st);
  let b = st.end;                                          // + a trailing same-line comment
  { const eol = src.indexOf('\n', b), tail = src.slice(b, eol < 0 ? src.length : eol).replace(/\r$/, ''); if (/^[ \t]*\/\/.*$/.test(tail)) b += tail.length; }
  let text = src.slice(a, b);
  // rewrite hook refs inside, back to front
  const mine = refs.filter((r) => r.start >= st.start && r.end <= st.end && hookUse.has(r.name)).sort((p, q) => q.start - p.start);
  for (const r of mine) { const ra = r.start - a, rb = r.end - a; text = text.slice(0, ra) + (r.shorthand ? `${r.name}: ${HN}.${r.name}` : `${HN}.${r.name}`) + text.slice(rb); }
  // export it
  const off = st.start - a;
  text = text.slice(0, off) + 'export ' + text.slice(off);
  pieces.push({ a, b, text });
}
const reroot = (from) => (from.startsWith('./src/') ? './' + from.slice(6) : from.startsWith('../../') ? '../' + from : from);
const byFrom = new Map();
for (const [local, t] of imports) { const f = reroot(t.from); if (!byFrom.has(f)) byFrom.set(f, []); byFrom.get(f).push(t.imported === '*' ? { ns: local } : t.imported === 'default' ? { def: local } : { name: t.imported, local }); }
const importLines = [...byFrom].map(([f, xs]) => {
  const ns = xs.find((x) => x.ns); if (ns) return `import * as ${ns.ns} from '${f}';`;
  const def = xs.find((x) => x.def);
  const named = xs.filter((x) => x.name).map((x) => (x.name === x.local ? x.name : `${x.name} as ${x.local}`)).sort();
  return `import ${def ? def.def + (named.length ? ', ' : '') : ''}${named.length ? `{ ${named.join(', ')} }` : ''} from '${f}';`;
});
const Mod = mod.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const header = opt('header') ? opt('header').split('\\n').map((l) => `// ${l}`).join('\n') + '\n' : '';
const hookDoc = hookUse.size ? `// the app's side, passed in once (set${Mod}Hooks): ${[...hookUse].sort().join(', ')}\nlet ${HN} = {};\nexport function set${Mod}Hooks(h) { ${HN} = h; }\n` : '';
const localDefs = locals.map((l) => `const ${l.split('=')[0].trim()} = ${l.slice(l.indexOf('=') + 1).trim()};`).join('\n');
const out = `${header}${importLines.join('\n')}\n${localDefs ? localDefs + '\n' : ''}${hookDoc}\n${pieces.map((p) => p.text).join('\n\n')}\n`;

// ── index.html: cut, import, wire ───────────────────────────────────────────
let app = src;
const usedOutside = new Set();
for (const p of [...pieces].sort((x, y) => y.a - x.a)) app = app.slice(0, p.a) + app.slice(p.b);
app = app.replace(/(\r?\n)(?:[ \t]*\r?\n){2,}/g, (m, nl) => nl + nl);   // a cut leaves a run of blank lines; the page keeps none longer than one
const rest =Parser.parse(app, { ecmaVersion: 'latest', sourceType: 'module' });
const allIds = new Set(); (function w(x) { if (!x || typeof x.type !== 'string') return; if (x.type === 'Identifier') allIds.add(x.name); for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === 'string') w(v); } })(rest);
for (const n of names) if (allIds.has(n)) usedOutside.add(n);
const writes = new Set(); (function w(x) { if (!x || typeof x.type !== 'string') return; if (x.type === 'AssignmentExpression' && x.left.type === 'Identifier' && names.has(x.left.name)) writes.add(x.left.name); if (x.type === 'UpdateExpression' && x.argument.type === 'Identifier' && names.has(x.argument.name)) writes.add(x.argument.name); for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === 'string') w(v); } })(rest);
if (writes.size) { console.error('the APP still assigns these moved names (an import cannot be written) — give the module a setter first: ' + [...writes].join(', ')); process.exit(1); }
const hookObj = hookUse.size ? `set${Mod}Hooks({ ${[...hookUse].sort().map((h) => (getters.has(h) || ['const', 'let'].includes(top.get(h).kind) ? `get ${h}() { return ${h}; }` : h)).join(', ')} });\n` : '';
const wire = hookObj ? `// src/${mod}.js reaches back into the app through these\n${hookObj}` : '';
const lastImport = rest.body.filter((n) => n.type === 'ImportDeclaration').pop();
const impNames = [...usedOutside, ...(hookUse.size ? [`set${Mod}Hooks`] : [])];
const impLine = `import { ${impNames.join(', ')} } from './src/${mod}.js';\n`;
// place after the last import line
const li = app.indexOf('\n', lastImport.end) + 1;
app = app.slice(0, li) + impLine + wire + app.slice(li);
const outPath = `${HERE}src/${mod}.js`;
if (existsSync(outPath)) { console.error(`${outPath} exists`); process.exit(1); }
console.log(`moving ${pieces.length} statements (${out.split('\n').length} lines) → ${outPath}; hooks: ${[...hookUse].sort().join(', ') || '—'}; imports from ${byFrom.size} modules; app keeps: ${impNames.join(', ')}`);
if (dry) process.exit(0);
writeFileSync(outPath, out);
writeFileSync(PATH, html.slice(0, mOpen) + app + html.slice(mClose));
