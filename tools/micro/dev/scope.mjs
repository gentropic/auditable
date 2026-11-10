// Scope resolution shared by the tools in this folder: which identifiers in a set
// of statements resolve to the MODULE scope (no enclosing function, block, loop,
// class or catch clause declares them).
import { Parser } from '../../../ext/acorn/acorn.esm.min.js';

export const parse = (s) => Parser.parse(s, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

// the names a binding pattern declares
export const patIds = (p, out = []) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patIds(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((e) => patIds(e, out));
  else if (p.type === 'AssignmentPattern') patIds(p.left, out);
  else if (p.type === 'RestElement') patIds(p.argument, out);
  return out;
};

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

// Every reference inside `stmts` that resolves to the module scope:
//   { name, start, end, write, shorthand, scopes }
// `write` is an assignment or update target; `shorthand` is the value side of a
// shorthand property ({ a } — rewriting it needs `a: <new>`); `scopes` is the
// list of name sets enclosing the reference, innermost last, so a caller can ask
// whether some OTHER name is shadowed where the reference stands.
// A declaration is not a reference: `let a = 1` at the top of `stmts` reports
// nothing for `a`.
export function moduleRefs(stmts) {
  const refs = [];
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
        if (!has(x.name)) refs.push({ name: x.name, start: x.start, end: x.end, write, shorthand: !!(parent && parent.type === 'Property' && parent.shorthand && key === 'value'), scopes });
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
  return refs;
}
