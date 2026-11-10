// HOOKS: where each one points, and turning the stale ones into imports.
//
//   node tools/micro/dev/hooks.mjs                    the count, by where the target lives
//   node tools/micro/dev/hooks.mjs <module>           that module's hooks
//   node tools/micro/dev/hooks.mjs --all              every module's hooks
//   node tools/micro/dev/hooks.mjs --direct [--only=a,b] [--dry]
//
// A module carved out of tools/micro/index.html reaches back into the app through
// a hooks object: the app calls set<Module>Hooks({ … }) once, the module reads
// H.<name>. That is right while the target still lives in the app. Once the target
// has moved to a module of its own, the hook is stale: the module can import it.
//
// --direct converts every stale hook whose import closes no cycle:
//   - src/<module>.js: H.<name> becomes the name, imported from its module; the
//     "passed in once" comment loses it; a hooks object left empty is removed
//   - index.html: the property leaves set<Module>Hooks({ … }); a call left empty is
//     removed with its import; an import the app no longer uses is removed
// It refuses a hook (and says so) when the name is already bound in the module,
// when the module assigns to it, or when the import would close a cycle.
// Do not run it while a smoke suite is reading the tree. See README.md.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { Parser } from '../../../ext/acorn/acorn.esm.min.js';

const DIR = fileURLToPath(new URL('..', import.meta.url));       // tools/micro/
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const val = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
const DRY = flag('dry'), DIRECT = flag('direct'), ONLY = val('only').split(',').filter(Boolean);
const one = argv.find((a) => !a.startsWith('--'));

const readText = (p) => { const raw = readFileSync(p, 'utf8'), crlf = raw.includes('\r\n'); return { text: raw.split('\r\n').join('\n'), crlf }; };
const writeText = (p, text, crlf) => writeFileSync(p, crlf ? text.split('\n').join('\r\n') : text);
const parse = (s) => Parser.parse(s, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const walk = (x, f, parent = null, key = null) => { if (!x || typeof x.type !== 'string') return; f(x, parent, key); for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, f, x, k)); else if (v && typeof v.type === 'string') walk(v, f, x, k); } };
const patIds = (p, out = []) => { if (!p) return out; if (p.type === 'Identifier') out.push(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patIds(q.type === 'RestElement' ? q.argument : q.value, out)); else if (p.type === 'ArrayPattern') p.elements.forEach((e) => patIds(e, out)); else if (p.type === 'AssignmentPattern') patIds(p.left, out); else if (p.type === 'RestElement') patIds(p.argument, out); return out; };
// an Identifier node that is a NAME in a position that reads no binding
const isLabel = (parent, key) => (parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
  || (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand)
  || (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed)
  || (parent.type === 'PropertyDefinition' && key === 'key' && !parent.computed);

// ── the app script, and the modules ─────────────────────────────────────────
const htmlPath = DIR + 'index.html';
const html = readText(htmlPath);
let appAt = -1, app = null;
{ const re = /<script type="module">([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html.text))) if (!app || m[1].length > app.length) { app = m[1]; appAt = m.index + '<script type="module">'.length; } }
if (app == null) { console.error('index.html: no module script'); process.exit(1); }
const appLen = app.length;

const mods = {};                                   // name → { exports:Set, imports:Set(module) }
for (const f of readdirSync(DIR + 'src')) {
  if (!f.endsWith('.js')) continue;
  const ast = parse(readText(DIR + 'src/' + f).text), exports = new Set(), imports = new Set();
  for (const n of ast.body) {
    if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) { if (n.declaration.id) exports.add(n.declaration.id.name); else for (const d of n.declaration.declarations || []) patIds(d.id).forEach((x) => exports.add(x)); }
      for (const s of n.specifiers || []) exports.add(s.exported.name);
    }
    if (n.type === 'ImportDeclaration' && /^\.\//.test(n.source.value)) imports.add(n.source.value.slice(2, -3));
  }
  mods[f.slice(0, -3)] = { exports, imports };
}
const reach = (from, to, seen = new Set()) => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); for (const k of (mods[from] ? mods[from].imports : [])) if (reach(k, to, seen)) return true; return false; };

const audit = (src) => {
  const ast = parse(src), appImports = new Map(), rows = [];           // local → { mod, imported }
  for (const n of ast.body) if (n.type === 'ImportDeclaration' && /^\.\/src\//.test(n.source.value)) for (const s of n.specifiers) appImports.set(s.local.name, { mod: n.source.value.slice(6, -3), imported: s.imported ? s.imported.name : null });
  walk(ast, (x) => {
    if (x.type !== 'CallExpression' || x.callee.type !== 'Identifier' || !/^set\w+Hooks$/.test(x.callee.name)) return;
    const t = appImports.get(x.callee.name), obj = x.arguments[0];
    if (!t || !obj || obj.type !== 'ObjectExpression') return;
    for (const p of obj.properties) {
      if (p.type !== 'Property') { rows.push({ target: t.mod, setter: x.callee.name, hook: '…spread', points: '…', where: 'app' }); continue; }
      const hook = p.key.name || p.key.value, getter = p.kind === 'get';
      let points;
      if (getter) { const b = p.value.body.body[0]; points = b && b.argument ? src.slice(b.argument.start, b.argument.end) : '?'; }
      else if (p.value.type === 'Identifier') points = p.value.name;
      else points = src.slice(p.value.start, Math.min(p.value.end, p.value.start + 50)).replace(/\s+/g, ' ');
      const imp = /^[A-Za-z_$][\w$]*$/.test(points) ? appImports.get(points) : null;
      const where = /^S\./.test(points) ? 'S' : imp ? 'module' : 'app';
      rows.push({ target: t.mod, setter: x.callee.name, hook, getter, points, where, from: imp ? imp.mod : null, aliased: !!imp && imp.imported !== points });
    }
  });
  return rows;
};
const verdict = (r) => (r.where !== 'module' ? r.where : (r.from === r.target || reach(r.from, r.target)) ? `import ${r.from} (CYCLE: ${r.from} reaches ${r.target})` : `import ${r.from}`);

if (!DIRECT) {
  const rows = audit(app), targets = [...new Set(rows.map((r) => r.target))];
  if (!one && !flag('all')) {
    const by = {}; for (const r of rows) { const v = verdict(r), k = v.startsWith('import') ? (v.includes('CYCLE') ? 'import (cycle)' : 'import') : v; by[k] = (by[k] || 0) + 1; }
    console.log(rows.length, 'hooks in', targets.length, 'modules:', by);
    const freq = {}; for (const r of rows) if (r.where === 'app') freq[r.points] = (freq[r.points] || 0) + 1;
    console.log('app-defined, by count:', Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  } else for (const t of targets) {
    if (one && one !== t) continue;
    const rs = rows.filter((r) => r.target === t);
    console.log(`\n${t}:`);
    for (const r of rs) if (r.where !== 'app') console.log(`  ${r.getter ? 'get ' : ''}${r.hook}${r.points !== r.hook ? ' = ' + r.points : ''}  →  ${verdict(r)}`);
    console.log('  app: ' + rs.filter((r) => r.where === 'app').map((r) => (r.getter ? 'get ' : '') + r.hook).join(', '));
  }
  process.exit(0);
}

// ── --direct ────────────────────────────────────────────────────────────────
const applyEdits = (text, edits) => { for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) text = text.slice(0, e.start) + e.text + text.slice(e.end); return text; };

// one module: H.<hook> → the name, imported. Returns { text, done, refused, notes, emptied }.
const directModule = (T, items, setter) => {
  const { text } = readText(DIR + 'src/' + T + '.js'), ast = parse(text);
  const out = { text, done: [], refused: [], notes: [], emptied: false };
  const setNode = ast.body.find((n) => n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'FunctionDeclaration' && n.declaration.id.name === setter);
  const asg = setNode && setNode.declaration.body.body.length === 1 && setNode.declaration.body.body[0].expression;
  if (!asg || asg.type !== 'AssignmentExpression' || asg.left.type !== 'Identifier') { out.refused = items.map((i) => ({ ...i, why: `${setter} is not the plain \`H = h\` setter` })); return out; }
  const HN = asg.left.name;
  const letNode = ast.body.find((n) => n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.name === HN);
  // every binding in the module, at any depth, and what it imports
  const bound = new Map(), imported = new Map();                 // name → count; local → { source, imported }
  const bind = (n) => bound.set(n, (bound.get(n) || 0) + 1);
  walk(ast, (x) => {
    if (x.type === 'VariableDeclarator') patIds(x.id).forEach(bind);
    if (x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression') { if (x.id) bind(x.id.name); x.params.forEach((q) => patIds(q).forEach(bind)); }
    if (x.type === 'ClassDeclaration' && x.id) bind(x.id.name);
    if (x.type === 'CatchClause' && x.param) patIds(x.param).forEach(bind);
    if (x.type === 'ImportDeclaration') for (const s of x.specifiers) { bind(s.local.name); imported.set(s.local.name, { source: x.source.value, imported: s.imported ? s.imported.name : null }); }
  });
  if (!letNode || bound.get(HN) !== 1) { out.refused = items.map((i) => ({ ...i, why: `${HN} is bound more than once in ${T}.js` })); return out; }
  // every use of the hooks object
  const uses = new Map(); let stray = null;                      // hook → [{ node, assigned }]
  walk(ast, (x, parent, key) => {
    if (x.type !== 'Identifier' || x.name !== HN || !parent || isLabel(parent, key)) return;
    if (parent === letNode.declarations[0] && key === 'id') return;
    if (parent === asg && key === 'left') return;
    if (parent.type === 'MemberExpression' && key === 'object' && !parent.computed) { const h = parent.property.name; if (!uses.has(h)) uses.set(h, []); uses.get(h).push(parent); return; }
    stray = stray || x;
  });
  if (stray) { out.refused = items.map((i) => ({ ...i, why: `${HN} is used whole at ${T}.js:${stray.loc.start.line}, not only as ${HN}.<name>` })); return out; }
  const assigned = new Set();
  walk(ast, (x) => { const t = x.type === 'AssignmentExpression' ? x.left : x.type === 'UpdateExpression' ? x.argument : null; if (t && t.type === 'MemberExpression' && t.object.type === 'Identifier' && t.object.name === HN && !t.computed) assigned.add(t.property.name); });

  const edits = [], add = new Map();                             // source module → Set(names)
  for (const it of items) {
    const have = imported.get(it.points), src = `./${it.from}.js`;
    if (it.aliased) { out.refused.push({ ...it, why: 'the app imports it under another name' }); continue; }
    if (assigned.has(it.hook)) { out.refused.push({ ...it, why: `${T}.js assigns to ${HN}.${it.hook}` }); continue; }
    if (bound.has(it.points) && !(have && have.source === src && have.imported === it.points)) { out.refused.push({ ...it, why: `${it.points} is already bound in ${T}.js` }); continue; }
    for (const m of uses.get(it.hook) || []) edits.push({ start: m.start, end: m.end, text: it.points });
    if (!have) { if (!add.has(it.from)) add.set(it.from, new Set()); add.get(it.from).add(it.points); }
    out.done.push(it);
  }
  if (!out.done.length) return out;
  const impDecls = ast.body.filter((n) => n.type === 'ImportDeclaration');
  const fresh = [];
  for (const [from, names] of add) {
    const d = impDecls.find((n) => n.source.value === `./${from}.js`);
    if (d && d.specifiers.length && d.specifiers.every((s) => s.type === 'ImportSpecifier')) {
      const list = d.specifiers.map((s) => ({ name: s.imported.name, text: text.slice(s.start, s.end) }));
      for (const nm of [...names].sort()) { let i = list.findIndex((s) => s.name > nm); if (i < 0) i = list.length; list.splice(i, 0, { name: nm, text: nm }); }
      edits.push({ start: d.specifiers[0].start, end: d.specifiers[d.specifiers.length - 1].end, text: list.map((s) => s.text).join(', ') });
    } else if (d && !d.specifiers.length) edits.push({ start: d.start, end: d.end, text: `import { ${[...names].sort().join(', ')} } from './${from}.js';` });
    else if (d) { out.refused.push(...out.done.filter((i) => i.from === from).map((i) => ({ ...i, why: `${T}.js imports ${from}.js in a form this tool does not edit` }))); out.done = out.done.filter((i) => i.from !== from); for (let k = edits.length - 1; k >= 0; k--) if (names.has(edits[k].text)) edits.splice(k, 1); }
    else fresh.push(`import { ${[...names].sort().join(', ')} } from './${from}.js';`);
  }
  if (fresh.length && impDecls.length) { const last = impDecls[impDecls.length - 1]; edits.push({ start: last.end, end: last.end, text: '\n' + fresh.join('\n') }); }
  else if (fresh.length) {
    // a module with no imports yet: they go under the header comment at the top of the file
    let at = 0; while (text.startsWith('//', at)) { const nl = text.indexOf('\n', at); if (nl < 0) break; at = nl + 1; }
    edits.push({ start: at, end: at, text: fresh.join('\n') + '\n' });
    if (at && text[at] !== '\n') out.notes.push(`${T}.js: had no imports — check where the new import landed relative to the top comment`);
  }
  // the "passed in once" comment, and the whole hooks object when nothing is left
  const gone = new Set(out.done.map((i) => i.hook)), left = [...uses.keys()].filter((h) => !gone.has(h));
  const cm = new RegExp(`^// the app's side, passed in once \\(${setter}\\): (.*)\\n(?=let ${HN} = \\{\\};)`, 'm').exec(text);
  const simple = cm && /^[\w$]+(, [\w$]+)*$/.test(cm[1]);
  if (!left.length) {
    out.emptied = true;
    let a = letNode.start; const b = setNode.end + (text[setNode.end] === '\n' ? 1 : 0);
    if (cm) a = cm.index; else out.notes.push(`${T}.js: the hooks object is gone — its comment above line ${letNode.loc.start.line} needs removing by hand`);
    if (text.slice(letNode.end, setNode.start).trim()) out.notes.push(`${T}.js: something sits between \`let ${HN}\` and ${setter} — check it`);
    edits.push({ start: a, end: b, text: '' });
  } else if (simple) {
    const keep = cm[1].split(', ').filter((h) => !gone.has(h));
    edits.push({ start: cm.index, end: cm.index + cm[0].length, text: `// the app's side, passed in once (${setter}): ${keep.join(', ')}\n` });
  } else out.notes.push(`${T}.js: update the "passed in once" comment by hand (drop ${[...gone].join(', ')})`);
  out.text = applyEdits(text, edits);
  parse(out.text);
  return out;
};

// remove one entry from a comma list (object properties, import specifiers) at index i
const cutFromList = (src, list, i) => {
  const p = list[i];
  const ownLine = (a) => { const ls = src.lastIndexOf('\n', a - 1) + 1; return /^[ \t]*$/.test(src.slice(ls, a)) ? ls : -1; };
  if (i < list.length - 1) {
    const next = list[i + 1], between = src.slice(p.end, next.start);
    if (/^\s*,\s*$/.test(between) && !(between.includes('\n') && ownLine(p.start) < 0)) return src.slice(0, p.start) + src.slice(next.start);
    let a = p.start, b = p.end + /^\s*,?[ \t]*/.exec(src.slice(p.end))[0].length;
    const ls = ownLine(a); if (ls >= 0 && src[b] === '\n') { a = ls; b++; }
    return src.slice(0, a) + src.slice(b);
  }
  const prev = list[i - 1], between = src.slice(prev.end, p.start);
  if (/^\s*,\s*$/.test(between)) return src.slice(0, prev.end) + src.slice(p.end);
  let a = p.start, b = p.end + /^[ \t]*,?[ \t]*/.exec(src.slice(p.end))[0].length;
  const ls = ownLine(a); if (ls >= 0 && src[b] === '\n') { a = ls; b++; }
  return src.slice(0, a) + src.slice(b);
};
const cutLine = (src, start, end) => { const a = src.lastIndexOf('\n', start - 1) + 1, b = src[end] === '\n' ? end + 1 : end; return /^[ \t]*$/.test(src.slice(a, start)) ? src.slice(0, a) + src.slice(b) : src.slice(0, start) + src.slice(end); };
const setterCall = (src, setter) => { const st = parse(src).body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.name === setter); if (!st) throw new Error(`${setter}(…) is not a top-level statement of the app`); return st; };
const dropHook = (src, setter, hook) => {
  const st = setterCall(src, setter), props = st.expression.arguments[0].properties;
  const i = props.findIndex((p) => p.type === 'Property' && (p.key.name || p.key.value) === hook);
  if (i < 0) throw new Error(`${setter}: no ${hook}`);
  if (props.length > 1) return cutFromList(src, props, i);
  return dropCall(src, setter);
};
const dropCall = (src, setter) => {
  const st = setterCall(src, setter);
  let out = cutLine(src, st.start, st.end);
  // the one-line comment the carve tool wrote above the call
  const a = out.lastIndexOf('\n', st.start - 2) + 1, line = out.slice(a, out.indexOf('\n', a));
  if (/^\/\/ src\/[\w-]+\.js reaches back into the app through these$/.test(line.trim())) out = out.slice(0, a) + out.slice(a + line.length + 1);
  return out;
};
const dropUnusedImport = (src, name) => {
  const ast = parse(src); let n = 0, decl = null, spec = null;
  for (const d of ast.body) if (d.type === 'ImportDeclaration') for (const s of d.specifiers) if (s.local.name === name) { decl = d; spec = s; }
  if (!decl) return src;
  walk(ast, (x, parent, key) => { if (x.type === 'Identifier' && x.name === name && parent && parent.type !== 'ImportSpecifier' && !isLabel(parent, key)) n++; });
  if (n) return src;
  if (decl.specifiers.length === 1) return cutLine(src, decl.start, decl.end);
  return cutFromList(src, decl.specifiers, decl.specifiers.indexOf(spec));
};

const rows = audit(app).filter((r) => r.where === 'module' && (!ONLY.length || ONLY.includes(r.target)));
const plan = new Map(), cyclic = [];
for (const r of rows) {
  if (r.from === r.target || reach(r.from, r.target)) { cyclic.push(r); continue; }
  mods[r.target].imports.add(r.from);                            // later rows see this edge
  if (!plan.has(r.target)) plan.set(r.target, []);
  plan.get(r.target).push(r);
}
let nDone = 0, nRefused = 0; const notes = [], writes = [], dropped = new Set();
for (const [T, items] of plan) {
  const r = directModule(T, items, items[0].setter);
  for (const it of r.refused) { console.log(`  refused  ${T} ← ${it.points} (${it.from}): ${it.why}`); nRefused++; }
  if (!r.done.length) continue;
  for (const it of r.done) { app = dropHook(app, it.setter, it.hook); dropped.add(it.points); }
  if (r.emptied) {
    // the module may have had hooks the app still passes but nothing reads
    try { app = dropCall(app, items[0].setter); } catch { /* already gone with its last property */ }
    dropped.add(items[0].setter);
  }
  notes.push(...r.notes); nDone += r.done.length;
  writes.push([DIR + 'src/' + T + '.js', r.text]);
  const by = {}; for (const it of r.done) (by[it.from] = by[it.from] || []).push(it.points);
  console.log(`${T}${r.emptied ? ' (no hooks left)' : ''}: ${Object.entries(by).map(([f, ns]) => `${ns.join(', ')} ← ${f}`).join(' · ')}`);
}
const unused = []; for (const nm of dropped) { const before = app; app = dropUnusedImport(app, nm); if (app !== before) unused.push(nm); }
parse(app);
console.log(`\n${nDone} hooks became imports in ${writes.length} modules; ${nRefused} refused; ${cyclic.length} would close a cycle`);
if (unused.length) console.log(`the app no longer imports: ${unused.join(', ')}`);
for (const n of notes) console.log('note: ' + n);
if (DRY) { console.log('(dry run — nothing written)'); process.exit(0); }
for (const [p, text] of writes) writeText(p, text, readText(p).crlf);
writeText(htmlPath, html.text.slice(0, appAt) + app + html.text.slice(appAt + appLen), html.crlf);
