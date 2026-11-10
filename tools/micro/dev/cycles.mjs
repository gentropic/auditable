// CYCLES: the import cycles between tools/micro/src modules, and the one rule that
// keeps them safe.
//
//   node tools/micro/dev/cycles.mjs             the groups, and every breach of the rule
//   node tools/micro/dev/cycles.mjs --verbose   also the load-time uses that are fine
//   node tools/micro/dev/cycles.mjs --why a b   one chain of imports from a to b
//
// Modules that import each other, directly or through others, form a GROUP. ES
// modules allow that: every binding exists before any module runs, and a function
// that is only CALLED later finds its imports filled. What fails is a module that
// USES a group sibling's export while it is still loading, because which of the two
// runs first depends on where the app's imports enter the group. The dev tree and
// the built micro.html enter it at different places, so such a fault can show in
// one and not in the other.
//
// The rule: inside a group, no module uses a sibling's export at load time. Not at
// the top level, not in a function it calls on the spot, not through one of its own
// functions that it calls while loading. Exit code 1 when a module breaks it.
//
// "At load time" is everything outside a function body, plus: a function called
// where it is written ((() => { … })()), a function passed to map / forEach / filter
// and the like, a class's superclass, static blocks and static fields, and the body
// of any top-level function of the module that load-time code calls by name. A
// function handed to anything else (addEventListener, setTimeout, a registry) is
// taken to run later. The check reads the source; it does not run it.
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse, moduleRefs } from './scope.mjs';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const WHY = argv.includes('--why') ? argv.slice(argv.indexOf('--why') + 1, argv.indexOf('--why') + 3) : null;

const FN = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;
// array methods that call the function they are given before they return
const SYNC = new Set(['forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'sort', 'toSorted', 'from']);

const mods = readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
const edges = new Map();       // module -> Set(module it imports)
const loadUse = new Map();     // module -> [{ name, from, line, call, via }]

for (const m of mods) {
  const ast = parse(readFileSync(SRC + m + '.js', 'utf8').split('\r\n').join('\n'));
  const imp = new Map();       // local name -> the sibling module it comes from
  const own = new Map();       // top-level function name -> its node
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      const s = /^\.\/([\w.-]+)\.js$/.exec(n.source.value);
      if (s) for (const sp of n.specifiers) imp.set(sp.local.name, s[1]);
      continue;
    }
    const d = (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration ? n.declaration : n;
    if (d.type === 'FunctionDeclaration' && d.id) own.set(d.id.name, d);
    if (d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier' && v.init && FN.test(v.init.type)) own.set(v.id.name, v.init);
  }
  edges.set(m, new Set([...imp.values()].filter((x) => x !== m)));

  // identifiers that resolve to the module scope (a parameter or a local of the
  // same name as an import is not the import)
  const body = ast.body.filter((n) => n.type !== 'ImportDeclaration');
  const top = new Set(moduleRefs(body).map((r) => r.start));

  const uses = [], entered = new Set();
  const kids = (x, f) => { for (const k in x) { if (k === 'start' || k === 'end' || k === 'loc') continue; const v = x[k]; if (Array.isArray(v)) v.forEach((c) => f(c, k)); else if (v && typeof v.type === 'string') f(v, k); } };
  const scan = (x, parent, key, runs, via) => {
    if (!x || typeof x.type !== 'string') return;
    if (x.type === 'ExportSpecifier') return;
    if (FN.test(x.type)) { if (runs) kids(x, (c, k) => scan(c, x, k, false, via)); return; }
    if (x.type === 'ClassDeclaration' || x.type === 'ClassExpression') {
      if (x.superClass) scan(x.superClass, x, 'superClass', false, via);
      for (const el of x.body.body) {
        if (el.type === 'StaticBlock') scan(el, x.body, 'body', false, via);
        else if (el.type === 'PropertyDefinition' && el.static && el.value) scan(el.value, el, 'value', false, via);
      }
      return;
    }
    if (x.type === 'Identifier') {
      if (top.has(x.start) && imp.has(x.name)) uses.push({ name: x.name, from: imp.get(x.name), line: x.loc.start.line, call: !!parent && (parent.type === 'CallExpression' || parent.type === 'NewExpression') && key === 'callee', via });
      return;
    }
    const isCall = x.type === 'CallExpression' || x.type === 'NewExpression';
    if (isCall && x.callee.type === 'Identifier' && top.has(x.callee.start) && own.has(x.callee.name) && !entered.has(x.callee.name)) {
      entered.add(x.callee.name);                          // the module calls its own function while loading: its body runs now
      const f = own.get(x.callee.name);
      kids(f, (c, k) => scan(c, f, k, false, [...via, `${x.callee.name}() at line ${x.loc.start.line}`]));
    }
    const sync = isCall && x.callee.type === 'MemberExpression' && !x.callee.computed && SYNC.has(x.callee.property.name);
    kids(x, (c, k) => scan(c, x, k, (isCall && k === 'callee') || (sync && k === 'arguments'), via));
  };
  body.forEach((s) => scan(s, null, null, false, []));
  loadUse.set(m, uses);
}

// the groups: strongly connected components of the import graph (Tarjan)
let counter = 0;
const stack = [], onStack = new Set(), index = new Map(), low = new Map(), groupOf = new Map(), groups = [];
const connect = (v) => {
  index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v);
  for (const w of edges.get(v)) {
    if (!edges.has(w)) continue;
    if (!index.has(w)) { connect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const g = []; let w;
    do { w = stack.pop(); onStack.delete(w); groupOf.set(w, groups.length); g.push(w); } while (w !== v);
    groups.push(g.sort());
  }
};
for (const m of mods) if (!index.has(m)) connect(m);
const cyclic = groups.filter((g) => g.length > 1);
const inCycle = (a, b) => a !== b && groupOf.get(a) === groupOf.get(b);

if (WHY) {
  const [a, b] = WHY;
  if (!edges.has(a) || !edges.has(b)) { console.error(`--why needs two module names (${!edges.has(a) ? a : b} is not one)`); process.exit(2); }
  const prev = new Map([[a, null]]), queue = [a];
  while (queue.length && !prev.has(b)) { const v = queue.shift(); for (const w of edges.get(v)) if (edges.has(w) && !prev.has(w)) { prev.set(w, v); queue.push(w); } }
  if (!prev.has(b)) { console.log(`${a} does not reach ${b}`); process.exit(0); }
  const chain = []; for (let v = b; v !== null; v = prev.get(v)) chain.unshift(v);
  console.log(chain.join(' → '));
  process.exit(0);
}

const nEdges = [...edges.values()].reduce((n, s) => n + s.size, 0);
console.log(`${mods.length} modules, ${nEdges} imports between them, ${cyclic.length} import cycle group${cyclic.length === 1 ? '' : 's'}`);
for (const g of cyclic) console.log(`  group of ${g.length}: ${g.join(' ')}`);

const say = (m, u) => `  ${m}.js:${u.line}  ${u.call ? 'calls' : 'reads'} ${u.name} (from ${u.from})${u.via.length ? '  — reached through ' + u.via.join(', then ') : ''}`;
const bad = [], fine = [];
for (const m of mods) for (const u of loadUse.get(m)) (inCycle(m, u.from) ? bad : fine).push(say(m, u));

if (VERBOSE) {
  console.log(`\nload-time uses of an import from a module outside the user's group (fine: that module has always run first): ${fine.length}`);
  fine.forEach((l) => console.log(l));
}
if (bad.length) {
  console.log(`\nused while loading, between two modules of one group:`);
  bad.forEach((l) => console.log(l));
  console.log(`\nCYCLES: FAIL — ${bad.length} load-time use${bad.length === 1 ? '' : 's'} inside an import cycle. Move the use into a function that runs later, or move what is used into a module outside the group.`);
  process.exit(1);
}
console.log(cyclic.length ? `CYCLES: PASS — no module in a group uses a sibling's export while it loads` : 'CYCLES: PASS — no import cycles');
