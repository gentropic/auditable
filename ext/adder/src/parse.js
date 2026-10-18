// adder v2 — tokenizer + recursive-descent parser
// Produces an AST from Python source code. No external dependencies.

// ── escape sequences ──

function _processEscapes(raw) {
  let out = '', i = 0;
  while (i < raw.length) {
    if (raw[i] !== '\\' || i + 1 >= raw.length) { out += raw[i++]; continue; }
    const c = raw[++i];
    switch (c) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case 'x': out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; break;
      case 'u': out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4; break;
      case 'U': out += String.fromCodePoint(parseInt(raw.slice(i + 1, i + 9), 16)); i += 8; break;
      default:
        if (c >= '0' && c <= '7') {
          let oct = c;
          if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i]; }
          if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i]; }
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += '\\' + c; // unknown escape — keep as-is
        }
    }
    i++;
  }
  return out;
}

// ── tokenizer ──

const _TWO_OP = new Set(['**', '//', '<<', '>>', '<=', '>=', '==', '!=', '->', ':=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=']);
const _THREE_OP = new Set(['**=', '//=', '<<=', '>>=']);

export function adderTokenize(code) {
  // universal newlines, as CPython's tokenizer reads source: \r\n and a lone \r are \n (a
  // triple-quoted string in a CRLF file holds \n; the escape \r stays — it is not a CR here)
  if (code.indexOf('\r') !== -1) code = code.replace(/\r\n?/g, '\n');
  const tokens = [];
  const indentStack = [0];
  let pos = 0, line = 1, col = 0;
  let bracketDepth = 0, atBol = true;
  const len = code.length;

  function tok(type, value) { return { type, value, line, col }; }

  while (pos < len) {
    // ── beginning of line: indentation ──
    if (atBol && bracketDepth === 0) {
      let indent = 0;
      while (pos < len && (code[pos] === ' ' || code[pos] === '\t')) {
        indent += code[pos] === '\t' ? (4 - indent % 4) : 1;
        pos++; col++;
      }
      // skip blank / comment-only lines
      if (pos >= len || code[pos] === '\n' || code[pos] === '\r') {
        if (pos < len) { if (code[pos] === '\r' && code[pos + 1] === '\n') pos++; pos++; line++; col = 0; }
        continue;
      }
      if (code[pos] === '#') {
        while (pos < len && code[pos] !== '\n') { pos++; col++; }
        continue;
      }
      // emit INDENT / DEDENT
      const top = indentStack[indentStack.length - 1];
      if (indent > top) {
        indentStack.push(indent);
        tokens.push(tok('INDENT', ''));
      } else {
        while (indentStack[indentStack.length - 1] > indent) {
          indentStack.pop();
          tokens.push(tok('DEDENT', ''));
        }
      }
      atBol = false;
    }

    const ch = code[pos];

    // ── whitespace (non-BOL) ──
    if (ch === ' ' || ch === '\t') { pos++; col++; continue; }

    // ── newline ──
    if (ch === '\n' || ch === '\r') {
      if (bracketDepth === 0) { tokens.push(tok('NEWLINE', '')); atBol = true; }
      if (ch === '\r' && pos + 1 < len && code[pos + 1] === '\n') pos++;
      pos++; line++; col = 0;
      continue;
    }

    // ── line continuation ──
    if (ch === '\\' && pos + 1 < len && (code[pos + 1] === '\n' || code[pos + 1] === '\r')) {
      pos++;
      if (code[pos] === '\r' && pos + 1 < len && code[pos + 1] === '\n') pos++;
      pos++; line++; col = 0;
      continue;
    }

    // ── comment ──
    if (ch === '#') { while (pos < len && code[pos] !== '\n' && code[pos] !== '\r') { pos++; col++; } continue; }

    // ── strings ──
    let prefix = '';
    if (/[fFrRbBuU]/.test(ch)) {
      let j = pos;
      while (j < len && /[fFrRbBuU]/.test(code[j])) j++;
      if (j < len && (code[j] === '"' || code[j] === "'")) {
        prefix = code.slice(pos, j);
        pos = j; col += prefix.length;
      }
    }
    if ((prefix || ch === '"' || ch === "'") && pos < len && (code[pos] === '"' || code[pos] === "'")) {
      const isRaw = /[rR]/.test(prefix);
      const isFstring = /[fF]/.test(prefix);
      const qch = code[pos];
      let triple = false;
      if (pos + 2 < len && code[pos + 1] === qch && code[pos + 2] === qch) {
        triple = true; pos += 3; col += 3;
      } else {
        pos++; col++;
      }

      if (isFstring) {
        // f-string: extract parts
        const parts = [];
        let textBuf = '';
        const endQuote = triple ? qch + qch + qch : qch;
        while (pos < len) {
          if (triple ? (code[pos] === qch && code[pos + 1] === qch && code[pos + 2] === qch) : code[pos] === qch) {
            pos += triple ? 3 : 1; col += triple ? 3 : 1;
            break;
          }
          if (code[pos] === '\n') { if (!triple) break; textBuf += '\n'; pos++; line++; col = 0; continue; }
          if (code[pos] === '{') {
            if (code[pos + 1] === '{') { textBuf += '{'; pos += 2; col += 2; continue; }
            if (textBuf) { parts.push(textBuf); textBuf = ''; }
            pos++; col++; // skip {
            // the replacement field's expression: `:` starts the format spec and `!` the conversion
            // only at the field's own level — not inside brackets (`{v[:n]}`, `{f(a, b=1)}`), nor
            // inside a string in the expression (`{d['a:b']}`, `{'}'}`)
            let depth = 1, nest = 0, expr = '', spec = null, conv = null, q = null;
            while (pos < len && depth > 0) {
              const c = code[pos];
              if (q) {                                          // inside a string in the expression
                expr += c;
                if (c === '\\') { expr += code[pos + 1] || ''; pos += 2; col += 2; continue; }
                if (c === '\n') { line++; col = 0; pos++; continue; }
                if (code.startsWith(q, pos)) { expr += q.slice(1); pos += q.length; col += q.length; q = null; continue; }
                pos++; col++; continue;
              }
              if (c === '"' || c === "'") {
                q = code.startsWith(c + c + c, pos) ? c + c + c : c;
                expr += q; pos += q.length; col += q.length; continue;
              }
              if (c === '(' || c === '[') { nest++; expr += c; }
              else if ((c === ')' || c === ']') && nest > 0) { nest--; expr += c; }
              else if (c === '\n') { expr += c; line++; col = -1; }
              else if (c === '{') { depth++; expr += c; }
              else if (c === '}') { depth--; if (depth > 0) expr += c; }
              else if (c === '!' && depth === 1 && nest === 0 && 'sra'.includes(code[pos + 1]) && (code[pos + 2] === ':' || code[pos + 2] === '}')) {
                conv = code[pos + 1]; pos += 2; col += 2; continue;
              }
              else if (c === ':' && depth === 1 && nest === 0 && spec === null) {
                spec = ''; pos++; col++;
                while (pos < len && !(code[pos] === '}' && depth === 1)) {
                  if (code[pos] === '{') depth++;
                  if (code[pos] === '}') { depth--; if (depth === 0) break; }
                  spec += code[pos]; pos++; col++;
                }
                continue;
              }
              else { expr += code[pos]; }
              pos++; col++;
            }
            if (code[pos - 1] !== '}' && depth === 0) { /* closing } already consumed */ }
            const selfDoc = /=\s*$/.test(expr) && !/[=!<>]=\s*$/.test(expr);
            if (selfDoc) {
              parts.push(expr);   // the text as written, `=` and spaces included
              parts.push({ expr: expr.replace(/=\s*$/, '').trim(), spec, conv: conv || (spec === null ? 'r' : null) });
            } else {
              parts.push({ expr: expr.trim(), spec, conv });
            }
            continue;
          }
          if (code[pos] === '}') {
            if (code[pos + 1] === '}') { textBuf += '}'; pos += 2; col += 2; continue; }
          }
          if (code[pos] === '\\' && code[pos + 1] !== '{' && code[pos + 1] !== '}') {
            // a backslash takes the next character with it — in a raw string too, where both are
            // kept (rf'\'' is backslash-quote, not the end) — except a brace: `\{{` is a backslash
            // then a literal brace, and `\{x}` a backslash then a field
            const nx = code[pos + 1] || '';
            textBuf += '\\' + nx; pos += 2;
            if (nx === '\n') { line++; col = 0; } else col += 2;
          } else {
            textBuf += code[pos]; pos++; col++;
          }
        }
        if (textBuf) parts.push(textBuf);
        // process escape sequences in text parts
        const processedParts = parts.map(p => typeof p === 'string' ? (isRaw ? p : _processEscapes(p)) : p);
        tokens.push(tok('FSTRING', processedParts));
      } else {
        // regular string
        let raw = '';
        while (pos < len) {
          if (triple ? (code[pos] === qch && code[pos + 1] === qch && code[pos + 2] === qch) : code[pos] === qch) {
            pos += triple ? 3 : 1; col += triple ? 3 : 1;
            break;
          }
          if (code[pos] === '\n') { if (!triple) break; raw += '\n'; pos++; line++; col = 0; continue; }
          if (code[pos] === '\\') {
            // a backslash always takes the next character with it — in a raw string too, where
            // both are kept (r'\'' is backslash-quote, not the end of the string)
            const nx = code[pos + 1] || '';
            raw += '\\' + nx; pos += 2;
            if (nx === '\n') { line++; col = 0; } else col += 2;
          } else {
            raw += code[pos]; pos++; col++;
          }
        }
        const val = isRaw ? raw : _processEscapes(raw);
        tokens.push(/[bB]/.test(prefix) ? tok('BYTES', val) : tok('STRING', val));
      }
      continue;
    }
    // if prefix consumed but no quote follows, reset — it's an identifier
    if (prefix) { pos -= prefix.length; col -= prefix.length; prefix = ''; }

    // ── numbers ──
    if ((ch >= '0' && ch <= '9') || (ch === '.' && pos + 1 < len && code[pos + 1] >= '0' && code[pos + 1] <= '9')) {
      const start = pos;
      if (ch === '0' && pos + 1 < len) {
        const nx = code[pos + 1];
        if (nx === 'x' || nx === 'X') { pos += 2; while (pos < len && (/[0-9a-fA-F_]/.test(code[pos]))) pos++; }
        else if (nx === 'o' || nx === 'O') { pos += 2; while (pos < len && (/[0-7_]/.test(code[pos]))) pos++; }
        else if (nx === 'b' || nx === 'B') { pos += 2; while (pos < len && (code[pos] === '0' || code[pos] === '1' || code[pos] === '_')) pos++; }
        else { while (pos < len && /[0-9_]/.test(code[pos])) pos++; }
      } else {
        while (pos < len && /[0-9_]/.test(code[pos])) pos++;
      }
      let isFloat = false;
      if (pos < len && code[pos] === '.' && !(code[pos + 1] === '.' && code[pos + 2] === '.')) {
        isFloat = true; pos++;
        while (pos < len && /[0-9_]/.test(code[pos])) pos++;
      }
      if (pos < len && (code[pos] === 'e' || code[pos] === 'E')) {
        isFloat = true; pos++;
        if (pos < len && (code[pos] === '+' || code[pos] === '-')) pos++;
        while (pos < len && /[0-9_]/.test(code[pos])) pos++;
      }
      let isComplex = false;
      if (pos < len && (code[pos] === 'j' || code[pos] === 'J')) { pos++; isComplex = true; }
      const raw = code.slice(start, pos).replace(/_/g, '').replace(/[jJ]$/, '');
      if (isComplex) {
        const coeff = parseFloat(raw) || 0;
        col += pos - start;
        tokens.push(tok('NUMBER', { _complex: true, imag: coeff }));
      } else {
        const value = isFloat ? parseFloat(raw)
          : (raw.startsWith('0x') || raw.startsWith('0X')) ? parseInt(raw.slice(2), 16)
          : (raw.startsWith('0o') || raw.startsWith('0O')) ? parseInt(raw.slice(2), 8)
          : (raw.startsWith('0b') || raw.startsWith('0B')) ? parseInt(raw.slice(2), 2)
          : parseInt(raw, 10);
        col += pos - start;
        tokens.push(tok('NUMBER', value));
      }
      continue;
    }

    // ── identifiers ──
    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos;
      while (pos < len && /[a-zA-Z0-9_]/.test(code[pos])) pos++;
      col += pos - start;
      tokens.push(tok('NAME', code.slice(start, pos)));
      continue;
    }

    // ── operators / punctuation ──
    // ellipsis
    if (ch === '.' && pos + 2 < len && code[pos + 1] === '.' && code[pos + 2] === '.') {
      tokens.push(tok('OP', '...')); pos += 3; col += 3; continue;
    }
    // 3-char ops
    if (pos + 2 < len) {
      const t3 = code.slice(pos, pos + 3);
      if (_THREE_OP.has(t3)) { tokens.push(tok('OP', t3)); pos += 3; col += 3; continue; }
    }
    // 2-char ops
    if (pos + 1 < len) {
      const t2 = code.slice(pos, pos + 2);
      if (_TWO_OP.has(t2)) { tokens.push(tok('OP', t2)); pos += 2; col += 2; continue; }
    }
    // brackets — track depth
    if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
    if (ch === ')' || ch === ']' || ch === '}') bracketDepth = Math.max(0, bracketDepth - 1);
    tokens.push(tok('OP', ch)); pos++; col++;
  }

  // ── end of file ──
  if (tokens.length && tokens[tokens.length - 1].type !== 'NEWLINE') {
    tokens.push(tok('NEWLINE', ''));
  }
  while (indentStack.length > 1) { indentStack.pop(); tokens.push(tok('DEDENT', '')); }
  tokens.push(tok('EOF', ''));
  return tokens;
}

// ── parser ──

export function adderParse(code) {
  return _manglePrivate(_classAnnotations(_desugarTypeParams(_hoistYields(new _Parser(adderTokenize(code)).parseModule()))), null);
}

// A yield inside an expression — `f((yield x))`, `return (yield)`, `y = 1 + (yield)` — is
// evaluated just before its statement and the statement uses the result: `__yN = yield x` then
// `f(__yN)`. Both engines then only meet yield as a statement or as an assignment's whole
// right-hand side (`v = yield x`, which they implement directly). Python evaluates operands left
// to right, so operands before the yield now run after it: only side effects there can tell.
// Not hoisted: a yield in a loop's test (it must run each time round) — rare enough to leave.
function _isYieldNode(n) { return n && (n.type === 'Yield' || n.type === 'YieldFrom'); }
let _yieldTmp = 0;
function _hoistIn(expr, pre) {
  if (!expr || typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) { for (let i = 0; i < expr.length; i++) expr[i] = _hoistIn(expr[i], pre); return expr; }
  // don't cross into nested scopes: their yields are theirs
  if (expr.type === 'Lambda' || expr.type === 'FunctionDef' || expr.type === 'AsyncFunctionDef' || expr.type === 'ClassDef' ||
      expr.type === 'ListComp' || expr.type === 'SetComp' || expr.type === 'DictComp' || expr.type === 'GeneratorExp') return expr;
  for (const k of Object.keys(expr)) {
    if (k === 'line' || k === 'col' || k === 'type') continue;
    const v = expr[k];
    if (v && typeof v === 'object') expr[k] = _hoistIn(v, pre);
  }
  if (_isYieldNode(expr)) {
    const name = `__y${++_yieldTmp}`;
    pre.push({ type: 'Assign', targets: [{ type: 'Name', id: name, line: expr.line, col: expr.col }], value: expr, line: expr.line, col: expr.col });
    return { type: 'Name', id: name, line: expr.line, col: expr.col };
  }
  return expr;
}
// a statement's expressions, with the yields that are not its whole value hoisted in front
function _hoistStmt(st) {
  const pre = [];
  const keep = (v) => (_isYieldNode(v) ? _hoistChildren(v, pre) : _hoistIn(v, pre));
  switch (st.type) {
    case 'Expr': st.value = keep(st.value); break;
    case 'Assign': st.value = keep(st.value); st.targets = _hoistIn(st.targets, pre); break;
    case 'AugAssign': case 'AnnAssign': if (st.value) st.value = keep(st.value); break;
    case 'Return': if (st.value) st.value = _hoistIn(st.value, pre); break;
    case 'If': st.test = _hoistIn(st.test, pre); break;
    case 'Raise': if (st.exc) st.exc = _hoistIn(st.exc, pre); if (st.cause) st.cause = _hoistIn(st.cause, pre); break;
    case 'Assert': st.test = _hoistIn(st.test, pre); if (st.msg) st.msg = _hoistIn(st.msg, pre); break;
    case 'For': st.iter = _hoistIn(st.iter, pre); break;
    case 'With': for (const it of st.items) it.contextExpr = _hoistIn(it.contextExpr, pre); break;
    default: break;
  }
  return pre;
}
// a yield that is the statement's own value keeps its place; yields inside its operand are hoisted
function _hoistChildren(y, pre) { if (y.value) y.value = _hoistIn(y.value, pre); return y; }
function _hoistBlock(stmts) {
  if (!Array.isArray(stmts)) return;
  for (let i = 0; i < stmts.length; i++) {
    const st = stmts[i];
    if (!st || typeof st !== 'object') continue;
    for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(st[k])) _hoistBlock(st[k]);
    if (Array.isArray(st.handlers)) for (const h of st.handlers) _hoistBlock(h.body);
    if (Array.isArray(st.cases)) for (const c of st.cases) _hoistBlock(c.body);
    const pre = _hoistStmt(st);
    if (pre.length) { stmts.splice(i, 0, ...pre); i += pre.length; }
  }
}
// A class body's annotations are evaluated, as CPython 3.13 does: the body's namespace gets an
// __annotations__ dict, and each `x: T [= v]` stores T's value there —
//   class C:              class C:
//     x: int = 1    →       __annotations__ = {}
//                           x: int = 1
//                           __annotations__['x'] = __adder_annotation__(lambda: int)
// (dataclasses tells a ClassVar[int] field from an int one by the value). An annotation that
// can't be evaluated — a forward reference, an AIR type hint like `f64` — keeps its source text
// (the class factory puts it back), which is what __annotations__ held before. Under `from __future__ import annotations` they all
// stay text (PEP 563).
function _classAnnotations(mod) {
  const future = (mod.body || []).some((s) => s.type === 'ImportFrom' && s.module === '__future__' && (s.names || []).some((n) => n.name === 'annotations'));
  if (future) return mod;
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    for (const k of Object.keys(n)) if (k !== 'line' && k !== 'col' && n[k] && typeof n[k] === 'object') visit(n[k]);
    if (n.type === 'ClassDef' && Array.isArray(n.body) && n.body.some((s) => s.type === 'AnnAssign' && s.target && s.target.type === 'Name')) {
      const out = [];
      const L = { line: n.line, col: n.col };
      const ann = (l) => ({ type: 'Name', id: '__annotations__', ...l });
      let i = 0;
      // after the docstring, which must stay the body's first statement
      if (n.body[0] && n.body[0].type === 'Expr' && n.body[0].value && n.body[0].value.type === 'Constant' && typeof n.body[0].value.value === 'string') out.push(n.body[i++]);
      out.push({ type: 'Assign', targets: [ann(L)], value: { type: 'Dict', keys: [], values: [], ...L }, ...L });
      for (; i < n.body.length; i++) {
        const s = n.body[i];
        out.push(s);
        if (s.type !== 'AnnAssign' || !s.target || s.target.type !== 'Name') continue;
        const l = { line: s.line, col: s.col };
        const thunk = { type: 'Lambda', params: [], kwonly: [], vararg: null, kwarg: null, body: s.annotation, ...l };
        const call = { type: 'Call', func: { type: 'Name', id: '__adder_annotation__', ...l }, args: [thunk], keywords: [], ...l };
        out.push({ type: 'Assign', targets: [{ type: 'Subscript', value: ann(l), slice: { type: 'Constant', value: s.target.id, ...l }, ...l }], value: call, ...l });
      }
      n.body = out;
    }
  };
  visit(mod);
  return mod;
}

function _hoistYields(mod) {
  // every function body (generators are functions whose body has a yield)
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if ((n.type === 'FunctionDef' || n.type === 'AsyncFunctionDef') && Array.isArray(n.body)) _hoistBlock(n.body);
    for (const k of Object.keys(n)) if (k !== 'line' && k !== 'col' && n[k] && typeof n[k] === 'object') visit(n[k]);
  };
  visit(mod);
  return mod;
}

// PEP 695, as CPython compiles it: a generic def / class / type alias is built inside an
// "annotation scope" — a hidden function that makes the type parameters (TypeVar, TypeVarTuple,
// ParamSpec, with their bounds, constraints and defaults), defines the object (a generic class
// gets Generic[...] as a base, as CPython adds it), records __type_params__ and returns it:
//   def f[T](x: T): …      →   def __generic_parameters_of_f():
//                                   T = typing.TypeVar('T'); def f(x: T): …; f.__type_params__ = (T,); return f
//                               f = __generic_parameters_of_f(); del __generic_parameters_of_f
// `type X[T] = v` is a TypeAliasType whose value is evaluated lazily. Both engines then run the
// plain statements.
function _desugarTypeParams(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    if (!node.some((n) => n && typeof n === 'object' && (n.typeParams || n.type === 'TypeAlias'))) { for (const n of node) _desugarTypeParams(n); return node; }
    const out = [];
    for (const n of node) {
      if (n && typeof n === 'object' && (n.typeParams || n.type === 'TypeAlias')) out.push(..._genericStatements(n));
      else { _desugarTypeParams(n); out.push(n); }
    }
    node.length = 0; node.push(...out);
    return node;
  }
  for (const k of Object.keys(node)) if (k !== 'line' && k !== 'col' && node[k] && typeof node[k] === 'object') _desugarTypeParams(node[k]);
  return node;
}
function _genericStatements(n) {
  const L = { line: n.line, col: n.col };
  const name = (id) => ({ type: 'Name', id, ...L });
  const str = (v) => ({ type: 'Constant', value: v, ...L });
  const typing = (attr) => ({ type: 'Attribute', value: { type: 'Call', func: name('__import__'), args: [str('typing')], keywords: [], ...L }, attr, ...L });
  const params = n.typeParams || [];
  const helper = `__generic_parameters_of_${n.name}`;
  const body = [];
  for (const tp of params) {
    const args = [str(tp.name)], keywords = [];
    if (tp.bound) {
      if (tp.bound.type === 'Tuple') args.push(...tp.bound.elts);   // T: (int, str) — constraints
      else keywords.push({ name: 'bound', arg: 'bound', value: tp.bound });
    }
    if (tp.default) keywords.push({ name: 'default', arg: 'default', value: tp.default });
    if (tp.kind !== 'TypeVarTuple') keywords.push({ name: 'infer_variance', arg: 'infer_variance', value: { type: 'Constant', value: true, ...L } });
    body.push({ type: 'Assign', targets: [name(tp.name)], value: { type: 'Call', func: typing(tp.kind), args, keywords, ...L }, ...L });
  }
  const paramTuple = { type: 'Tuple', elts: params.map((tp) => name(tp.name)), ...L };
  if (n.type === 'TypeAlias') {
    const lazy = { type: 'Lambda', params: [], kwonly: [], vararg: null, kwarg: null, body: n.value, ...L };
    body.push({ type: 'Return', value: { type: 'Call', func: typing('_lazy_alias'), args: [str(n.name), lazy, paramTuple], keywords: [], ...L }, ...L });
  } else {
    const def = { ...n, typeParams: null };
    _desugarTypeParams(def.body);
    if (n.type === 'ClassDef' && params.length) {
      // Generic[T, *Ts, P] as the last base, unless one already is (class C[T](Generic[T]))
      const elts = params.map((tp) => (tp.kind === 'TypeVarTuple' ? { type: 'Starred', value: name(tp.name), ...L } : name(tp.name)));
      def.bases = [...def.bases, { type: 'Subscript', value: typing('Generic'), slice: elts.length === 1 ? elts[0] : { type: 'Tuple', elts, ...L }, ...L }];
    }
    body.push(def);
    body.push({ type: 'Assign', targets: [{ type: 'Attribute', value: name(n.name), attr: '__type_params__', ...L }], value: paramTuple, ...L });
    body.push({ type: 'Return', value: name(n.name), ...L });
  }
  const fn = { type: 'FunctionDef', name: helper, params: [], kwonly: [], vararg: null, kwarg: null, posonly: 0, body, decorators: [], returns: null, typeParams: null, ...L };
  return [
    fn,
    { type: 'Assign', targets: [name(n.name)], value: { type: 'Call', func: name(helper), args: [], keywords: [], ...L }, ...L },
    { type: 'Delete', targets: [name(helper)], ...L },
  ];
}

// Private name mangling, as CPython's compiler does it: inside a class body (its methods and the
// functions nested in them included), an identifier `__x` that doesn't end in `__` is
// `_Class__x` — names, attributes, parameters, keyword arguments, global / nonlocal lists. The
// class's name loses its leading underscores first; a class of only underscores mangles nothing.
// Strings are left alone (getattr(self, "__x") is not mangled, as in Python).
function _mangle(n, cls) {
  return cls && typeof n === 'string' && n.length > 2 && n.startsWith('__') && !n.endsWith('__') ? `_${cls}${n}` : n;
}
function _manglePrivate(node, cls) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) { for (const x of node) _manglePrivate(x, cls); return node; }
  const walkKeys = (keys) => { for (const k of keys) if (node[k] && typeof node[k] === 'object') _manglePrivate(node[k], cls); };
  switch (node.type) {
    case 'ClassDef': {
      const own = node.name;
      if (cls) node.name = _mangle(node.name, cls);
      walkKeys(['bases', 'keywords', 'decorators']);
      const inner = String(own).replace(/^_+/, '') || null;
      _manglePrivate(node.body, inner);
      return node;
    }
    case 'Name': if (cls) node.id = _mangle(node.id, cls); return node;
    case 'Attribute': if (cls) node.attr = _mangle(node.attr, cls); _manglePrivate(node.value, cls); return node;
    case 'Global': case 'Nonlocal': if (cls) node.names = node.names.map((n) => _mangle(n, cls)); return node;
    case 'FunctionDef': case 'AsyncFunctionDef': case 'Lambda':
      if (cls) {
        if (node.name) node.name = _mangle(node.name, cls);
        for (const p of [...(node.params || []), ...(node.kwonly || [])]) if (p && p.name) p.name = _mangle(p.name, cls);
        for (const k of ['vararg', 'kwarg']) {
          if (typeof node[k] === 'string') node[k] = _mangle(node[k], cls);
          else if (node[k] && node[k].name) node[k].name = _mangle(node[k].name, cls);
        }
      }
      break;
    case 'ExceptHandler': if (cls && node.name) node.name = _mangle(node.name, cls); break;
    default: break;
  }
  // keyword arguments of a call: `f(__wrapper=x)` in a class body is `f(_C__wrapper=x)`
  if (cls && Array.isArray(node.keywords)) for (const kw of node.keywords) { if (kw && typeof kw.name === 'string') kw.name = _mangle(kw.name, cls); if (kw && typeof kw.arg === 'string') kw.arg = _mangle(kw.arg, cls); }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'line' || k === 'col') continue;
    const v = node[k];
    if (v && typeof v === 'object') _manglePrivate(v, cls);
  }
  return node;
}

export function _adderParseExpr(code) {
  return new _Parser(adderTokenize(code + '\n')).parseExpr();
}

// the names a match pattern binds, in order of first appearance
export function matchPatternNames(p, out = []) {
  if (!p) return out;
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  switch (p.type) {
    case 'MatchAs': if (p.pattern) matchPatternNames(p.pattern, out); add(p.name); break;
    case 'MatchStar': add(p.name); break;
    case 'MatchOr': for (const q of p.patterns) matchPatternNames(q, out); break;
    case 'MatchSequence': for (const q of p.patterns) matchPatternNames(q, out); break;
    case 'MatchMapping': for (const q of p.patterns) matchPatternNames(q, out); add(p.rest); break;
    case 'MatchClass': for (const q of [...p.patterns, ...p.kwdPatterns]) matchPatternNames(q, out); break;
    default: break;
  }
  return out;
}

// A match pattern as a plain descriptor for pyMatch (builtins.js): the shape only. The values
// it compares against — literals, dotted names like Color.RED, mapping keys, the class of a
// class pattern — go into `valueNodes` as expressions for the engine to evaluate; the
// descriptor refers to them by index. Both engines match through the same descriptor.
export function compileMatchPattern(p, valueNodes) {
  const val = (node) => { valueNodes.push(node); return valueNodes.length - 1; };
  switch (p.type) {
    case 'MatchAs':
      if (!p.pattern) return p.name ? { k: 'cap', name: p.name } : { k: 'any' };
      return { k: 'as', p: compileMatchPattern(p.pattern, valueNodes), name: p.name };
    case 'MatchStar': return { k: 'star', name: p.name };
    case 'MatchValue': return { k: 'val', i: val(p.value) };
    case 'MatchSingleton': return { k: 'single', v: p.value };
    case 'MatchOr': return { k: 'or', ps: p.patterns.map((q) => compileMatchPattern(q, valueNodes)) };
    case 'MatchSequence': return { k: 'seq', ps: p.patterns.map((q) => compileMatchPattern(q, valueNodes)) };
    case 'MatchMapping':
      return { k: 'map', keys: p.keys.map(val), ps: p.patterns.map((q) => compileMatchPattern(q, valueNodes)), rest: p.rest };
    case 'MatchClass':
      return { k: 'cls', c: val(p.cls), ps: p.patterns.map((q) => compileMatchPattern(q, valueNodes)),
        kw: p.kwdAttrs, kps: p.kwdPatterns.map((q) => compileMatchPattern(q, valueNodes)) };
    default: throw new SyntaxError(`unknown pattern ${p.type}`);
  }
}

// the targets of `:=` anywhere in a statement's expressions (comprehensions included: a walrus
// binds in the enclosing scope), not inside a nested def / class / lambda, which have their own
export function collectWalrusTargets(node, defines) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectWalrusTargets(n, defines); return; }
  if (node.type === 'FunctionDef' || node.type === 'AsyncFunctionDef' || node.type === 'ClassDef' || node.type === 'Lambda') return;
  if (node.type === 'NamedExpr' && node.target && node.target.type === 'Name') defines.add(node.target.id);
  for (const k of Object.keys(node)) {
    if (k === 'body' || k === 'orelse' || k === 'finalbody' || k === 'handlers') continue;   // statements: the define scans walk those
    const v = node[k];
    if (v && typeof v === 'object') collectWalrusTargets(v, defines);
  }
}

const _AUGASSIGN = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '@=']);

class _Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, col: 0 }; }
  advance() { return this.tokens[this.pos++]; }
  at(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  eat(type, value) { return this.at(type, value) ? this.advance() : null; }
  expect(type, value) {
    const t = this.eat(type, value);
    if (!t) { const p = this.peek(); throw new SyntaxError(`Expected ${value || type}, got '${p.value}' [${p.type}] (line ${p.line})`); }
    return t;
  }

  // ── module / block / statement list ──

  parseModule() {
    const body = [];
    while (!this.at('EOF')) {
      if (this.eat('NEWLINE')) continue;
      body.push(...this.parseStmt());
    }
    return { type: 'Module', body };
  }

  parseBlock() {
    if (this.at('NEWLINE')) {
      this.advance();
      this.expect('INDENT');
      const stmts = [];
      while (!this.at('DEDENT') && !this.at('EOF')) {
        if (this.eat('NEWLINE')) continue;
        stmts.push(...this.parseStmt());
      }
      this.eat('DEDENT');
      return stmts;
    }
    return this.parseSimpleList();
  }

  parseStmt() {
    const t = this.peek();
    // decorators
    if (t.type === 'OP' && t.value === '@') {
      const decorators = [];
      while (this.at('OP', '@')) {
        this.advance();
        decorators.push(this.parseExpr());
        this.expect('NEWLINE');
      }
      if (this.at('NAME', 'def') || this.at('NAME', 'async')) {
        const s = this.at('NAME', 'async') ? (this.advance(), this.parseDef(true, decorators)) : this.parseDef(false, decorators);
        return [s];
      }
      if (this.at('NAME', 'class')) return [this.parseClass(decorators)];
      throw new SyntaxError(`Expected def or class after decorator (line ${this.peek().line})`);
    }
    // async
    if (t.type === 'NAME' && t.value === 'async') {
      this.advance();
      if (this.at('NAME', 'def')) return [this.parseDef(true)];
      if (this.at('NAME', 'for')) return [this.parseFor(true)];
      if (this.at('NAME', 'with')) return [this.parseWith(true)];
      throw new SyntaxError(`Expected def, for, or with after async (line ${t.line})`);
    }
    // compound statements
    if (t.type === 'NAME') {
      if (t.value === 'if') return [this.parseIf()];
      if (t.value === 'for') return [this.parseFor()];
      if (t.value === 'while') return [this.parseWhile()];
      if (t.value === 'def') return [this.parseDef()];
      if (t.value === 'class') return [this.parseClass()];
      if (t.value === 'try') return [this.parseTry()];
      if (t.value === 'with') return [this.parseWith()];
      // `match` is a soft keyword: a match statement only when `match <subject>:` opens a block
      // of cases; otherwise (`match = ...`, `match.group()`) it is an ordinary name
      if (t.value === 'match') { const m = this._tryParseMatch(); if (m) return [m]; }
      // `type` is a soft keyword: `type Name[params] = value` declares an alias (PEP 695)
      if (t.value === 'type') {
        const n1 = this.tokens[this.pos + 1], n2 = this.tokens[this.pos + 2];
        if (n1 && n1.type === 'NAME' && n2 && n2.type === 'OP' && (n2.value === '=' || n2.value === '[')) {
          this.advance();
          const name = this.advance().value;
          const typeParams = this.at('OP', '[') ? this._parseTypeParams() : null;
          this.expect('OP', '=');
          const value = this.parseExpr();
          this.eat('NEWLINE');
          return [{ type: 'TypeAlias', name, typeParams, value, line: t.line, col: t.col }];
        }
      }
    }
    return this.parseSimpleList();
  }

  // ── match statement (structural pattern matching, PEP 634) ──

  _tryParseMatch() {
    const start = this.pos;
    const t = this.advance();
    let subject;
    try {
      subject = this.parseStarExpr();
      if (this.at('OP', ',')) {
        const elts = [subject];
        while (this.eat('OP', ',')) { if (this.at('OP', ':')) break; elts.push(this.parseStarExpr()); }
        subject = { type: 'Tuple', elts, line: subject.line, col: subject.col };
      }
      this.expect('OP', ':');
      this.expect('NEWLINE');
      this.expect('INDENT');
      if (!this.at('NAME', 'case')) throw new SyntaxError('expected case');
    } catch {
      this.pos = start;
      return null;
    }
    const cases = [];
    while (!this.at('DEDENT') && !this.at('EOF')) {
      if (this.eat('NEWLINE')) continue;
      const c = this.expect('NAME', 'case');
      const pattern = this._parseCasePattern();
      const guard = this.eat('NAME', 'if') ? this.parseExpr() : null;
      this.expect('OP', ':');
      cases.push({ type: 'match_case', pattern, guard, body: this.parseBlock(), line: c.line, col: c.col });
    }
    this.eat('DEDENT');
    return { type: 'Match', subject, cases, line: t.line, col: t.col };
  }

  // case a, b, *rest:  — an open sequence, or a single pattern
  _parseCasePattern() {
    const first = this._parseStarOrPattern();
    if (!this.at('OP', ',')) {
      if (first.type === 'MatchStar') throw new SyntaxError(`can't use starred pattern here (line ${first.line})`);
      return first;
    }
    const patterns = [first];
    while (this.eat('OP', ',')) {
      if (this.at('NAME', 'if') || this.at('OP', ':')) break;
      patterns.push(this._parseStarOrPattern());
    }
    return { type: 'MatchSequence', patterns, line: first.line, col: first.col };
  }

  _parseStarOrPattern() {
    if (this.at('OP', '*')) {
      const t = this.advance();
      const n = this.expect('NAME').value;
      return { type: 'MatchStar', name: n === '_' ? null : n, line: t.line, col: t.col };
    }
    return this._parseAsPattern();
  }

  _parseAsPattern() {
    const p = this._parseOrPattern();
    if (this.eat('NAME', 'as')) {
      const n = this.expect('NAME').value;
      if (n === '_') throw new SyntaxError(`cannot use '_' as a target (line ${p.line})`);
      return { type: 'MatchAs', pattern: p, name: n, line: p.line, col: p.col };
    }
    return p;
  }

  _parseOrPattern() {
    const patterns = [this._parseClosedPattern()];
    while (this.eat('OP', '|')) patterns.push(this._parseClosedPattern());
    return patterns.length === 1 ? patterns[0] : { type: 'MatchOr', patterns, line: patterns[0].line, col: patterns[0].col };
  }

  _parseClosedPattern() {
    const t = this.peek();
    // numbers, negative numbers and complex literals (1, -2.5, 1+2j)
    if (t.type === 'NUMBER' || (t.type === 'OP' && t.value === '-')) {
      return { type: 'MatchValue', value: this.parseArith(), line: t.line, col: t.col };
    }
    if (t.type === 'STRING' || t.type === 'BYTES') {
      return { type: 'MatchValue', value: this.parseAtom(), line: t.line, col: t.col };
    }
    if (t.type === 'NAME') {
      if (t.value === 'True' || t.value === 'False' || t.value === 'None') {
        this.advance();
        return { type: 'MatchSingleton', value: t.value === 'True' ? true : t.value === 'False' ? false : null, line: t.line, col: t.col };
      }
      this.advance();
      let expr = { type: 'Name', id: t.value, line: t.line, col: t.col };
      let dotted = false;
      while (this.at('OP', '.')) {
        this.advance();
        expr = { type: 'Attribute', value: expr, attr: this.expect('NAME').value, line: t.line, col: t.col };
        dotted = true;
      }
      if (this.at('OP', '(')) return this._parseClassPattern(expr, t);
      if (dotted) return { type: 'MatchValue', value: expr, line: t.line, col: t.col };
      if (t.value === '_') return { type: 'MatchAs', pattern: null, name: null, line: t.line, col: t.col };
      return { type: 'MatchAs', pattern: null, name: t.value, line: t.line, col: t.col };
    }
    if (t.type === 'OP' && (t.value === '(' || t.value === '[')) {
      const close = t.value === '(' ? ')' : ']';
      this.advance();
      if (this.eat('OP', close)) return { type: 'MatchSequence', patterns: [], line: t.line, col: t.col };
      const first = this._parseStarOrPattern();
      if (t.value === '(' && this.eat('OP', ')')) {
        if (first.type === 'MatchStar') return { type: 'MatchSequence', patterns: [first], line: t.line, col: t.col };
        return first;   // (p) groups
      }
      const patterns = [first];
      while (this.eat('OP', ',')) {
        if (this.at('OP', close)) break;
        patterns.push(this._parseStarOrPattern());
      }
      this.expect('OP', close);
      return { type: 'MatchSequence', patterns, line: t.line, col: t.col };
    }
    if (t.type === 'OP' && t.value === '{') {
      this.advance();
      const keys = [], patterns = [];
      let rest = null;
      while (!this.at('OP', '}')) {
        if (this.eat('OP', '**')) { rest = this.expect('NAME').value; this.eat('OP', ','); break; }
        const kt = this.peek();
        let key;
        if (kt.type === 'NAME' && !['True', 'False', 'None'].includes(kt.value)) {
          this.advance();
          key = { type: 'Name', id: kt.value, line: kt.line, col: kt.col };
          while (this.eat('OP', '.')) key = { type: 'Attribute', value: key, attr: this.expect('NAME').value, line: kt.line, col: kt.col };
          if (key.type === 'Name') throw new SyntaxError(`mapping pattern keys may only match literals and attribute lookups (line ${kt.line})`);
        } else if (kt.type === 'NAME') { this.advance(); key = { type: 'Constant', value: kt.value === 'True' ? true : kt.value === 'False' ? false : null, line: kt.line, col: kt.col }; }
        else if (kt.type === 'NUMBER' || (kt.type === 'OP' && kt.value === '-')) key = this.parseArith();
        else key = this.parseAtom();
        this.expect('OP', ':');
        keys.push(key);
        patterns.push(this._parseAsPattern());
        if (!this.eat('OP', ',')) break;
      }
      this.expect('OP', '}');
      return { type: 'MatchMapping', keys, patterns, rest, line: t.line, col: t.col };
    }
    throw new SyntaxError(`invalid pattern at '${t.value}' (line ${t.line})`);
  }

  // Point(1, y=2): positional sub-patterns, then keyword ones
  _parseClassPattern(cls, t) {
    this.expect('OP', '(');
    const patterns = [], kwdAttrs = [], kwdPatterns = [];
    while (!this.at('OP', ')')) {
      if (this.at('NAME') && this.tokens[this.pos + 1]?.type === 'OP' && this.tokens[this.pos + 1]?.value === '=') {
        kwdAttrs.push(this.advance().value);
        this.advance();
        kwdPatterns.push(this._parseAsPattern());
      } else {
        if (kwdAttrs.length) throw new SyntaxError(`positional patterns follow keyword patterns (line ${t.line})`);
        patterns.push(this._parseAsPattern());
      }
      if (!this.eat('OP', ',')) break;
    }
    this.expect('OP', ')');
    return { type: 'MatchClass', cls, patterns, kwdAttrs, kwdPatterns, line: t.line, col: t.col };
  }

  parseSimpleList() {
    const stmts = [this.parseSimple()];
    while (this.eat('OP', ';')) {
      if (this.at('NEWLINE') || this.at('EOF')) break;
      stmts.push(this.parseSimple());
    }
    this.eat('NEWLINE');
    return stmts;
  }

  parseSimple() {
    const t = this.peek();
    if (t.type === 'NAME') {
      switch (t.value) {
        case 'return': return this.parseReturn();
        case 'raise': return this.parseRaise();
        case 'assert': return this.parseAssert();
        case 'import': return this.parseImport();
        case 'from': return this.parseFromImport();
        case 'global': return this.parseGlobalNonlocal('Global');
        case 'nonlocal': return this.parseGlobalNonlocal('Nonlocal');
        case 'del': return this.parseDel();
        case 'pass': this.advance(); return { type: 'Pass', line: t.line, col: t.col };
        case 'break': this.advance(); return { type: 'Break', line: t.line, col: t.col };
        case 'continue': this.advance(); return { type: 'Continue', line: t.line, col: t.col };
        case 'yield': return this.parseYield();
      }
    }
    return this.parseAssignOrExpr();
  }

  // ── simple statements ──

  parseReturn() {
    const t = this.advance();
    let value = null;
    if (!this.at('NEWLINE') && !this.at('OP', ';') && !this.at('EOF')) value = this.parseExprOrStars();
    return { type: 'Return', value, line: t.line, col: t.col };
  }

  parseYield() {
    // a yield statement — or the right-hand side's start: `yield x` then `= …` is not valid, but
    // the statement may be just the expression, so parse it as one and wrap it
    const y = this._parseYieldExpr();
    return { type: 'Expr', value: y, line: y.line, col: y.col };
  }

  // a yield expression: `yield`, `yield v`, `yield a, b` (a tuple), `yield from it` — what an
  // assignment's right-hand side or a parenthesized expression may be
  _parseYieldExpr() {
    const t = this.advance(); // 'yield'
    if (this.eat('NAME', 'from')) return { type: 'YieldFrom', value: this.parseExpr(), line: t.line, col: t.col };
    let value = null;
    if (!this.at('NEWLINE') && !this.at('OP', ';') && !this.at('EOF') && !this.at('OP', ')') && !this.at('OP', ']') && !this.at('OP', '}') && !this.at('OP', '=')) {
      value = this.parseExprOrStars();
    }
    return { type: 'Yield', value, line: t.line, col: t.col };
  }
  _parseRhs() { return this.at('NAME', 'yield') ? this._parseYieldExpr() : this.parseExprOrStars(); }

  parseRaise() {
    const t = this.advance();
    let exc = null;
    if (!this.at('NEWLINE') && !this.at('OP', ';') && !this.at('EOF')) exc = this.parseExpr();
    // raise X from Y (Y may be None): `hasCause` tells `from None` from no `from` at all
    if (exc && this.eat('NAME', 'from')) return { type: 'Raise', exc, cause: this.parseExpr(), hasCause: true, line: t.line, col: t.col };
    return { type: 'Raise', exc, line: t.line, col: t.col };
  }

  parseAssert() {
    const t = this.advance();
    const test = this.parseExpr();
    let msg = null;
    if (this.eat('OP', ',')) msg = this.parseExpr();
    return { type: 'Assert', test, msg, line: t.line, col: t.col };
  }

  parseImport() {
    const t = this.advance();
    const names = [];
    do {
      // String-literal import: `import "./utils.py" as u`. Alias required — can't
      // derive an identifier from an arbitrary path.
      if (this.at('STRING')) {
        const path = this.advance().value;
        if (!this.eat('NAME', 'as')) {
          throw new Error(`path imports require 'as <alias>' at line ${t.line} (cannot derive a name from "${path}")`);
        }
        const alias = this.expect('NAME').value;
        names.push({ path, alias });
      } else {
        let module = this.expect('NAME').value;
        while (this.eat('OP', '.')) module += '.' + this.expect('NAME').value;
        const alias = this.eat('NAME', 'as') ? this.expect('NAME').value : null;
        names.push({ module, alias });
      }
    } while (this.eat('OP', ','));
    return { type: 'Import', names, line: t.line, col: t.col };
  }

  parseFromImport() {
    const t = this.advance(); // 'from'
    // String-literal from-import: `from "./utils.py" import foo, bar`
    if (this.at('STRING')) {
      const path = this.advance().value;
      this.expect('NAME', 'import');
      if (this.eat('OP', '*')) return { type: 'ImportFrom', path, names: [{ name: '*', alias: null }], line: t.line, col: t.col };
      const names = [];
      const paren = this.eat('OP', '(');
      do {
        if (paren && this.at('OP', ')')) break;   // trailing comma: from x import (a, b,)
        const name = this.expect('NAME').value;
        const alias = this.eat('NAME', 'as') ? this.expect('NAME').value : null;
        names.push({ name, alias });
      } while (this.eat('OP', ','));
      if (paren) this.expect('OP', ')');
      return { type: 'ImportFrom', path, names, line: t.line, col: t.col };
    }
    let module = '';
    while (this.at('OP', '.') || this.at('OP', '...')) {
      module += this.advance().value;
    }
    if (this.at('NAME') && this.peek().value !== 'import') {
      module += this.advance().value;
      while (this.eat('OP', '.')) module += '.' + this.expect('NAME').value;
    }
    this.expect('NAME', 'import');
    if (this.eat('OP', '*')) return { type: 'ImportFrom', module, names: [{ name: '*', alias: null }], line: t.line, col: t.col };
    const names = [];
    const paren = this.eat('OP', '(');
    do {
      if (paren && this.at('OP', ')')) break;     // trailing comma: from x import (a, b,)
      const name = this.expect('NAME').value;
      const alias = this.eat('NAME', 'as') ? this.expect('NAME').value : null;
      names.push({ name, alias });
    } while (this.eat('OP', ','));
    if (paren) this.expect('OP', ')');
    return { type: 'ImportFrom', module, names, line: t.line, col: t.col };
  }

  parseGlobalNonlocal(nodeType) {
    const t = this.advance();
    const names = [this.expect('NAME').value];
    while (this.eat('OP', ',')) names.push(this.expect('NAME').value);
    return { type: nodeType, names, line: t.line, col: t.col };
  }

  parseDel() {
    const t = this.advance();
    const targets = [this.parseExpr()];
    while (this.eat('OP', ',')) targets.push(this.parseExpr());
    return { type: 'Delete', targets, line: t.line, col: t.col };
  }

  parseAssignOrExpr() {
    const expr = this.parseExprOrStars();
    // augmented assignment
    if (this.at('OP') && _AUGASSIGN.has(this.peek().value)) {
      const op = this.advance().value.slice(0, -1);
      return { type: 'AugAssign', target: this._asTarget(expr), op, value: this._parseRhs(), line: expr.line, col: expr.col };
    }
    // annotation
    if (this.eat('OP', ':')) {
      const annotation = this.parseExpr();
      const value = this.eat('OP', '=') ? this._parseRhs() : null;
      return { type: 'AnnAssign', target: this._asTarget(expr), annotation, value, line: expr.line, col: expr.col };
    }
    // assignment (possibly chained: a = b = val)
    if (this.eat('OP', '=')) {
      const targets = [this._asTarget(expr)];
      let value = this._parseRhs();
      while (this.eat('OP', '=')) {
        targets.push(this._asTarget(value));
        value = this._parseRhs();
      }
      return { type: 'Assign', targets, value, line: expr.line, col: expr.col };
    }
    return { type: 'Expr', value: expr, line: expr.line, col: expr.col };
  }

  _parseForTarget() {
    // parse target for 'for' statement — stops before 'in'
    const first = this._parseTargetAtom();
    if (!this.at('OP', ',')) return first;
    const elts = [first];
    while (this.eat('OP', ',')) {
      if (this.at('NAME', 'in')) break;
      elts.push(this._parseTargetAtom());
    }
    return { type: 'Tuple', elts, line: first.line, col: first.col };
  }

  _parseTargetAtom() {
    if (this.at('OP', '*')) {
      const t = this.advance();
      return { type: 'Starred', value: this._parseTargetAtom(), line: t.line, col: t.col };
    }
    let expr = this.parseAtom();
    // allow postfix: .attr, [sub]
    while (true) {
      if (this.eat('OP', '.')) { expr = { type: 'Attribute', value: expr, attr: this.expect('NAME').value, line: expr.line, col: expr.col }; }
      else if (this.eat('OP', '[')) { const s = this._parseSlice(); this.expect('OP', ']'); expr = { type: 'Subscript', value: expr, slice: s, line: expr.line, col: expr.col }; }
      else break;
    }
    return expr;
  }

  _asTarget(node) {
    switch (node.type) {
      case 'Name': case 'Subscript': case 'Attribute': case 'Starred': return node;
      case 'Tuple': case 'List': return { ...node, elts: node.elts.map(e => this._asTarget(e)) };
      default: throw new SyntaxError(`Invalid assignment target: ${node.type} (line ${node.line})`);
    }
  }

  // ── compound statements ──

  parseIf() {
    const t = this.advance(); // 'if' or 'elif'
    const test = this.parseExpr();
    this.expect('OP', ':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.at('NAME', 'elif')) orelse = [this.parseIf()];
    else if (this.eat('NAME', 'else')) { this.expect('OP', ':'); orelse = this.parseBlock(); }
    return { type: 'If', test, body, orelse, line: t.line, col: t.col };
  }

  parseFor(isAsync = false) {
    const t = this.advance(); // 'for'
    const target = this._asTarget(this._parseForTarget());
    this.expect('NAME', 'in');
    const iter = this.parseExprOrStars();
    this.expect('OP', ':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.eat('NAME', 'else')) { this.expect('OP', ':'); orelse = this.parseBlock(); }
    return { type: 'For', target, iter, body, orelse, isAsync, line: t.line, col: t.col };
  }

  parseWhile() {
    const t = this.advance();
    const test = this.parseExpr();
    this.expect('OP', ':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.eat('NAME', 'else')) { this.expect('OP', ':'); orelse = this.parseBlock(); }
    return { type: 'While', test, body, orelse, line: t.line, col: t.col };
  }

  parseDef(isAsync = false, decorators = []) {
    const t = this.advance(); // 'def'
    const name = this.expect('NAME').value;
    const typeParams = this.at('OP', '[') ? this._parseTypeParams() : null;
    this.expect('OP', '(');
    const params = this._parseFuncParams();
    this.expect('OP', ')');
    let returns = null;
    if (this.eat('OP', '->')) returns = this.parseExpr();
    this.expect('OP', ':');
    const body = this.parseBlock();
    return { type: isAsync ? 'AsyncFunctionDef' : 'FunctionDef', name, ...params, body, decorators, returns, typeParams, line: t.line, col: t.col };
  }

  // PEP 695 type parameters: [T, T: bound, T: (c1, c2), T = default, *Ts, **P]
  _parseTypeParams() {
    this.expect('OP', '[');
    const out = [];
    while (!this.at('OP', ']')) {
      let kind = 'TypeVar';
      if (this.eat('OP', '**')) kind = 'ParamSpec';
      else if (this.eat('OP', '*')) kind = 'TypeVarTuple';
      const nt = this.expect('NAME');
      let bound = null, dflt = null;
      if (kind === 'TypeVar' && this.eat('OP', ':')) bound = this.parseExpr();
      if (this.eat('OP', '=')) dflt = this.parseExpr();
      out.push({ kind, name: nt.value, bound, default: dflt, line: nt.line, col: nt.col });
      if (!this.eat('OP', ',')) break;
    }
    this.expect('OP', ']');
    return out;
  }

  _parseFuncParams() {
    const params = [], kwonly = [];
    let vararg = null, kwarg = null, seenStar = false, posonly = 0;
    let varargAnnotation = null, kwargAnnotation = null;
    while (!this.at('OP', ')')) {
      if (this.eat('OP', '**')) {
        kwarg = this.expect('NAME').value;
        if (this.eat('OP', ':')) kwargAnnotation = this.parseExpr();   // **kwargs: Any
        this.eat('OP', ',');                                             // trailing comma
        break;
      }
      if (this.eat('OP', '*')) {
        seenStar = true;
        if (this.at('NAME')) {
          vararg = this.advance().value;
          if (this.eat('OP', ':')) varargAnnotation = this.parseExpr();  // *args: int
        }
        this.eat('OP', ',');
        continue;
      }
      // `/`: the parameters before it are positional-only (PEP 570). Recorded; not yet
      // enforced (passing one by keyword binds it, where CPython raises TypeError).
      if (this.eat('OP', '/')) { posonly = params.length; this.eat('OP', ','); continue; }
      const pName = this.expect('NAME').value;
      let annotation = null;
      if (this.eat('OP', ':')) annotation = this.parseExpr();
      let def = null;
      if (this.eat('OP', '=')) def = this.parseExpr();
      (seenStar ? kwonly : params).push({ name: pName, default: def, annotation });
      if (!this.eat('OP', ',')) break;
    }
    return { params, vararg, kwonly, kwarg, posonly, varargAnnotation, kwargAnnotation };
  }

  parseClass(decorators = []) {
    const t = this.advance(); // 'class'
    const name = this.expect('NAME').value;
    const typeParams = this.at('OP', '[') ? this._parseTypeParams() : null;
    let bases = [];
    const keywords = [];   // class X(Base, metaclass=M, flag=True): metaclass + __init_subclass__ kwargs
    if (this.eat('OP', '(')) {
      while (!this.at('OP', ')')) {
        const nx = this.tokens[this.pos + 1];
        if (this.at('NAME') && nx && nx.type === 'OP' && nx.value === '=') {
          const arg = this.advance().value; this.advance();
          keywords.push({ arg, value: this.parseExpr() });
        } else if (this.eat('OP', '**')) keywords.push({ arg: null, value: this.parseExpr() });
        else if (this.at('OP', '*')) { this.advance(); bases.push({ type: 'Starred', value: this.parseExpr(), line: t.line, col: t.col }); }
        else bases.push(this.parseExpr());
        this.eat('OP', ',');
      }
      this.expect('OP', ')');
    }
    this.expect('OP', ':');
    const body = this.parseBlock();
    return { type: 'ClassDef', name, bases, keywords, body, decorators, typeParams, line: t.line, col: t.col };
  }

  parseTry() {
    const t = this.advance();
    this.expect('OP', ':');
    const body = this.parseBlock();
    const handlers = [];
    while (this.at('NAME', 'except')) {
      this.advance();
      let excType = null, excName = null;
      if (!this.at('OP', ':')) {
        excType = this.parseExpr();
        if (this.eat('NAME', 'as')) excName = this.expect('NAME').value;
      }
      this.expect('OP', ':');
      handlers.push({ type: 'ExceptHandler', excType, name: excName, body: this.parseBlock(), line: t.line });
    }
    let orelse = [];
    if (this.eat('NAME', 'else')) { this.expect('OP', ':'); orelse = this.parseBlock(); }
    let finalbody = [];
    if (this.eat('NAME', 'finally')) { this.expect('OP', ':'); finalbody = this.parseBlock(); }
    return { type: 'Try', body, handlers, orelse, finalbody, line: t.line, col: t.col };
  }

  parseWith(isAsync = false) {
    const t = this.advance();
    // `with (a() as x, b() as y,):` (3.10): parenthesized items — tried first, else the `(` opens
    // an ordinary expression (`with (yield x):`, `with (a, b):` is a tuple as the manager)
    if (this.at('OP', '(')) {
      const start = this.pos;
      try {
        this.advance();
        const items = [];
        while (!this.at('OP', ')')) {
          const contextExpr = this.parseExpr();
          const optionalVar = this.eat('NAME', 'as') ? this._asTarget(this.parseExpr()) : null;
          items.push({ contextExpr, optionalVar });
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', ')');
        if (items.length && this.at('OP', ':') && (items.length > 1 || items[0].optionalVar)) {
          this.advance();
          return { type: 'With', items, body: this.parseBlock(), isAsync, line: t.line, col: t.col };
        }
      } catch (e) { /* not the parenthesized form */ }
      this.pos = start;
    }
    const items = [];
    do {
      const contextExpr = this.parseExpr();
      const optionalVar = this.eat('NAME', 'as') ? this._asTarget(this.parseExpr()) : null;
      items.push({ contextExpr, optionalVar });
    } while (this.eat('OP', ','));
    this.expect('OP', ':');
    return { type: 'With', items, body: this.parseBlock(), isAsync, line: t.line, col: t.col };
  }

  // ── expressions ──

  parseExprOrStars() {
    const first = this.parseStarExpr();
    if (!this.at('OP', ',') || this.at('OP', ')') || this.at('OP', ']') || this.at('OP', '}')) return first;
    // check if comma is part of tuple (not a function call separator)
    // in contexts like assignment RHS, commas make tuples
    const elts = [first];
    while (this.eat('OP', ',')) {
      if (this.at('NEWLINE') || this.at('EOF') || this.at('OP', ')') || this.at('OP', ']') ||
          this.at('OP', '}') || this.at('OP', ';') || this.at('OP', '=') || this.at('OP', ':')) break;
      elts.push(this.parseStarExpr());
    }
    if (elts.length === 1) return first;
    return { type: 'Tuple', elts, line: first.line, col: first.col };
  }

  parseStarExpr() {
    if (this.at('OP', '*') && !this._isBinContext()) {
      const t = this.advance();
      return { type: 'Starred', value: this.parseExpr(), line: t.line, col: t.col };
    }
    return this.parseExpr();
  }

  _isBinContext() {
    // star is binary if preceded by a value token
    if (this.pos === 0) return false;
    const prev = this.tokens[this.pos - 1];
    return prev && (prev.type === 'NAME' || prev.type === 'NUMBER' || prev.type === 'STRING' || prev.type === 'BYTES' || prev.type === 'FSTRING' ||
      prev.value === ')' || prev.value === ']' || prev.value === '}');
  }

  parseExpr() {
    if (this.at('NAME', 'lambda')) return this.parseLambda();
    // walrus operator: name := expr
    if (this.peek().type === 'NAME' && this.tokens[this.pos + 1]?.type === 'OP' && this.tokens[this.pos + 1]?.value === ':=') {
      const name = this.advance();
      this.advance(); // :=
      return { type: 'NamedExpr', target: { type: 'Name', id: name.value, line: name.line, col: name.col }, value: this.parseExpr(), line: name.line, col: name.col };
    }
    return this.parseTernary();
  }

  parseTernary() {
    const expr = this.parseOr();
    if (this.eat('NAME', 'if')) {
      const test = this.parseOr();
      this.expect('NAME', 'else');
      const orelse = this.parseExpr();
      return { type: 'IfExp', test, body: expr, orelse, line: expr.line, col: expr.col };
    }
    return expr;
  }

  parseOr() {
    let first = this.parseAnd();
    if (!this.at('NAME', 'or')) return first;
    const values = [first];
    while (this.eat('NAME', 'or')) values.push(this.parseAnd());
    return { type: 'BoolOp', op: 'or', values, line: first.line, col: first.col };
  }

  parseAnd() {
    let first = this.parseNot();
    if (!this.at('NAME', 'and')) return first;
    const values = [first];
    while (this.eat('NAME', 'and')) values.push(this.parseNot());
    return { type: 'BoolOp', op: 'and', values, line: first.line, col: first.col };
  }

  parseNot() {
    if (this.at('NAME', 'not') && !(this.tokens[this.pos + 1]?.value === 'in')) {
      const t = this.advance();
      return { type: 'UnaryOp', op: 'not', operand: this.parseNot(), line: t.line, col: t.col };
    }
    return this.parseCompare();
  }

  parseCompare() {
    let left = this.parseBitOr();
    const ops = [], comparators = [];
    while (this._isCompOp()) {
      ops.push(this._readCompOp());
      comparators.push(this.parseBitOr());
    }
    if (!ops.length) return left;
    return { type: 'Compare', left, ops, comparators, line: left.line, col: left.col };
  }

  _isCompOp() {
    const v = this.peek().value;
    if (['<', '>', '<=', '>=', '==', '!='].includes(v)) return true;
    if (v === 'in' || v === 'is') return true;
    if (v === 'not' && this.tokens[this.pos + 1]?.value === 'in') return true;
    return false;
  }

  _readCompOp() {
    if (this.at('NAME', 'not')) { this.advance(); this.expect('NAME', 'in'); return 'not in'; }
    if (this.at('NAME', 'is')) { this.advance(); if (this.eat('NAME', 'not')) return 'is not'; return 'is'; }
    if (this.at('NAME', 'in')) { this.advance(); return 'in'; }
    return this.advance().value;
  }

  _binLeft(sub, ...ops) {
    let left = sub.call(this);
    while (this.at('OP') && ops.includes(this.peek().value)) {
      const op = this.advance().value;
      left = { type: 'BinOp', left, op, right: sub.call(this), line: left.line, col: left.col };
    }
    return left;
  }

  parseBitOr() { return this._binLeft(this.parseBitXor, '|'); }
  parseBitXor() { return this._binLeft(this.parseBitAnd, '^'); }
  parseBitAnd() { return this._binLeft(this.parseShift, '&'); }
  parseShift() { return this._binLeft(this.parseArith, '<<', '>>'); }
  parseArith() { return this._binLeft(this.parseTerm, '+', '-'); }
  parseTerm() { return this._binLeft(this.parseUnary, '*', '/', '//', '%', '@'); }

  parseUnary() {
    if (this.at('OP', '-') || this.at('OP', '+') || this.at('OP', '~')) {
      const t = this.advance();
      return { type: 'UnaryOp', op: t.value, operand: this.parseUnary(), line: t.line, col: t.col };
    }
    return this.parsePower();
  }

  parsePower() {
    const left = this.parseAwait();
    if (this.eat('OP', '**')) {
      return { type: 'BinOp', left, op: '**', right: this.parseUnary(), line: left.line, col: left.col };
    }
    return left;
  }

  parseAwait() {
    if (this.at('NAME', 'await')) {
      const t = this.advance();
      return { type: 'Await', value: this.parseUnary(), line: t.line, col: t.col };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parseAtom();
    while (true) {
      if (this.eat('OP', '.')) {
        const attr = this.expect('NAME').value;
        expr = { type: 'Attribute', value: expr, attr, line: expr.line, col: expr.col };
      } else if (this.eat('OP', '(')) {
        const { args, keywords } = this._parseCallArgs();
        this.expect('OP', ')');
        expr = { type: 'Call', func: expr, args, keywords, line: expr.line, col: expr.col };
      } else if (this.eat('OP', '[')) {
        const slice = this._parseSlice();
        this.expect('OP', ']');
        expr = { type: 'Subscript', value: expr, slice, line: expr.line, col: expr.col };
      } else break;
    }
    return expr;
  }

  _parseCallArgs() {
    const args = [], keywords = [];
    while (!this.at('OP', ')')) {
      if (this.at('OP', '**')) {
        this.advance();
        keywords.push({ name: null, value: this.parseExpr() });
      } else if (this.at('OP', '*')) {
        this.advance();
        args.push({ type: 'Starred', value: this.parseExpr(), line: this.peek().line, col: this.peek().col });
      } else if (this.peek().type === 'NAME' && this.tokens[this.pos + 1]?.value === '=' && this.tokens[this.pos + 1]?.type === 'OP') {
        // keyword argument — but check it's not ==
        if (!(this.tokens[this.pos + 2]?.type === 'OP' && this.tokens[this.pos + 2]?.value === '=')) {   // a STRING '=' is a value
          const name = this.advance().value;
          this.advance(); // =
          keywords.push({ name, value: this.parseExpr() });
        } else {
          args.push(this.parseExpr());
        }
      } else {
        const expr = this.parseExpr();
        // generator expression: sum(x for x in items)
        if (this._atCompFor()) {
          const generators = this._parseCompIter();
          args.push({ type: 'GeneratorExp', elt: expr, generators, line: expr.line, col: expr.col });
        } else {
          args.push(expr);
        }
      }
      this.eat('OP', ',');
    }
    return { args, keywords };
  }

  _parseSlice() {
    // Parse the first slice or expression. If a comma follows, parse
    // additional items and wrap the whole thing in a Tuple — numpy /
    // pandas style `arr[i, j]`, `df.iloc[0:5, :]` semantics. Python
    // sugar for `arr[(i, j)]` — the runtime forwards the tuple to
    // __getitem__/__setitem__ which the target object (DataFrame, nd-
    // array, etc.) interprets as multi-dim access.
    const first = this._parseSliceItem();
    // x[*a] (3.11) is x[(*a,)]
    if (!this.at('OP', ',')) return first && first.type === 'Starred' ? { type: 'Tuple', elts: [first], line: first.line, col: first.col } : first;
    const elts = [first];
    while (this.eat('OP', ',')) {
      // Trailing comma allowed (`arr[i,]`) — just stop before the `]`.
      if (this.at('OP', ']')) break;
      elts.push(this._parseSliceItem());
    }
    return { type: 'Tuple', elts, line: first?.line || 0, col: 0 };
  }

  _parseSliceItem() {
    if (this.at('OP', '*')) { const t = this.advance(); return { type: 'Starred', value: this.parseExpr(), line: t.line, col: t.col }; }
    let lower = null;
    if (!this.at('OP', ':') && !this.at('OP', ']') && !this.at('OP', ',')) lower = this.parseExpr();
    if (this.eat('OP', ':')) {
      let upper = null, step = null;
      if (!this.at('OP', ':') && !this.at('OP', ']') && !this.at('OP', ',')) upper = this.parseExpr();
      if (this.eat('OP', ':')) {
        if (!this.at('OP', ']') && !this.at('OP', ',')) step = this.parseExpr();
      }
      return { type: 'Slice', lower, upper, step, line: (lower || this.peek()).line, col: 0 };
    }
    return lower;
  }

  parseAtom() {
    const t = this.peek();

    // keywords
    if (t.type === 'NAME') {
      if (t.value === 'True') { this.advance(); return { type: 'Constant', value: true, line: t.line, col: t.col }; }
      if (t.value === 'False') { this.advance(); return { type: 'Constant', value: false, line: t.line, col: t.col }; }
      if (t.value === 'None') { this.advance(); return { type: 'Constant', value: null, line: t.line, col: t.col }; }
      if (t.value === 'not') {
        // `not` as a unary — but we shouldn't get here normally (parseNot handles it)
        // handle it as a fallback
        this.advance();
        return { type: 'UnaryOp', op: 'not', operand: this.parseNot(), line: t.line, col: t.col };
      }
      this.advance();
      return { type: 'Name', id: t.value, line: t.line, col: t.col };
    }

    // number
    if (t.type === 'NUMBER') { this.advance(); return { type: 'Constant', value: t.value, line: t.line, col: t.col }; }

    // strings: adjacent literals concatenate, plain and f-strings mixed ("a" f"{b}" "c"); an
    // all-plain run is a constant, any f-string makes the whole run one f-string
    if (t.type === 'STRING' || t.type === 'FSTRING') {
      const run = [];
      while (this.peek().type === 'STRING' || this.peek().type === 'FSTRING') run.push(this.advance());
      if (run.every((x) => x.type === 'STRING')) return { type: 'Constant', value: run.map((x) => x.value).join(''), line: t.line, col: t.col };
      const parts = [];
      for (const x of run) { if (x.type === 'STRING') parts.push(x.value); else parts.push(...x.value); }
      return this._parseFstring({ ...t, value: parts });
    }

    // bytes literal b'...' (adjacent ones concatenate): its value as a latin-1 string
    if (t.type === 'BYTES') {
      this.advance();
      let value = t.value;
      while (this.peek().type === 'BYTES') value += this.advance().value;
      return { type: 'Bytes', value, line: t.line, col: t.col };
    }


    // ellipsis
    // `...` is the Ellipsis singleton (a builtin name, so both engines resolve it like any other)
    if (t.type === 'OP' && t.value === '...') { this.advance(); return { type: 'Name', id: 'Ellipsis', ellipsis: true, line: t.line, col: t.col }; }

    // parenthesized / tuple / generator
    if (t.type === 'OP' && t.value === '(') {
      this.advance();
      if (this.eat('OP', ')')) return { type: 'Tuple', elts: [], line: t.line, col: t.col };
      // (yield …): a yield expression anywhere an expression goes
      if (this.at('NAME', 'yield')) { const y = this._parseYieldExpr(); this.expect('OP', ')'); return y; }
      const first = this.parseStarExpr();
      if (this._atCompFor()) {
        const generators = this._parseCompIter();
        this.expect('OP', ')');
        return { type: 'GeneratorExp', elt: first, generators, line: t.line, col: t.col };
      }
      if (this.eat('OP', ',')) {
        const elts = [first];
        while (!this.at('OP', ')')) {
          elts.push(this.parseStarExpr());
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', ')');
        return { type: 'Tuple', elts, line: t.line, col: t.col };
      }
      this.expect('OP', ')');
      return first;
    }

    // list / list comprehension
    if (t.type === 'OP' && t.value === '[') {
      this.advance();
      if (this.eat('OP', ']')) return { type: 'List', elts: [], line: t.line, col: t.col };
      const first = this.parseStarExpr();
      if (this._atCompFor()) {
        const generators = this._parseCompIter();
        this.expect('OP', ']');
        return { type: 'ListComp', elt: first, generators, line: t.line, col: t.col };
      }
      const elts = [first];
      while (this.eat('OP', ',')) {
        if (this.at('OP', ']')) break;
        elts.push(this.parseStarExpr());
      }
      this.expect('OP', ']');
      return { type: 'List', elts, line: t.line, col: t.col };
    }

    // dict / set / comprehension
    if (t.type === 'OP' && t.value === '{') {
      this.advance();
      if (this.eat('OP', '}')) return { type: 'Dict', keys: [], values: [], line: t.line, col: t.col };
      // dict unpacking first: {**a, ...}
      if (this.eat('OP', '**')) {
        return this._parseDictBody(t, [null], [this.parseExpr()]);
      }
      const first = this.parseStarExpr();            // `{*a, b}` — a starred item makes it a set
      if (first.type !== 'Starred' && this.eat('OP', ':')) {
        // dict
        const firstVal = this.parseExpr();
        if (this._atCompFor()) {
          const generators = this._parseCompIter();
          this.expect('OP', '}');
          return { type: 'DictComp', key: first, value: firstVal, generators, line: t.line, col: t.col };
        }
        return this._parseDictBody(t, [first], [firstVal]);
      }
      // set
      if (this._atCompFor()) {
        const generators = this._parseCompIter();
        this.expect('OP', '}');
        return { type: 'SetComp', elt: first, generators, line: t.line, col: t.col };
      }
      const elts = [first];
      while (this.eat('OP', ',')) {
        if (this.at('OP', '}')) break;
        elts.push(this.parseStarExpr());
      }
      this.expect('OP', '}');
      return { type: 'Set', elts, line: t.line, col: t.col };
    }

    throw new SyntaxError(`Unexpected token: ${t.type} '${t.value}' (line ${t.line})`);
  }

  _parseDictBody(startTok, keys, values) {
    while (this.eat('OP', ',')) {
      if (this.at('OP', '}')) break;
      if (this.eat('OP', '**')) {
        keys.push(null);
        values.push(this.parseExpr());
      } else {
        keys.push(this.parseExpr());
        this.expect('OP', ':');
        values.push(this.parseExpr());
      }
    }
    this.expect('OP', '}');
    return { type: 'Dict', keys, values, line: startTok.line, col: startTok.col };
  }

  // a comprehension clause starts here: `for …`, or `async for …`
  _atCompFor() {
    if (this.at('NAME', 'for')) return true;
    const nx = this.tokens[this.pos + 1];
    return this.at('NAME', 'async') && !!nx && nx.type === 'NAME' && nx.value === 'for';
  }

  _parseCompIter() {
    const generators = [];
    while (this.at('NAME', 'for') || this.at('NAME', 'async')) {
      const isAsync = !!this.eat('NAME', 'async');
      this.expect('NAME', 'for');
      const target = this._asTarget(this._parseForTarget());
      this.expect('NAME', 'in');
      const iter = this.parseOr();
      const ifs = [];
      while (this.at('NAME', 'if')) { this.advance(); ifs.push(this.parseOr()); }
      generators.push({ target, iter, ifs, isAsync });
    }
    return generators;
  }

  // A format spec with replacement fields (`>{w}`, `{fill}^{width}.{prec}f`) is itself an f-string:
  // a JoinedStr the engines evaluate first. A plain spec stays a string.
  _parseFormatSpec(spec, tok) {
    if (!spec) return null;
    if (!spec.includes('{')) return spec;
    const parts = [];
    let text = '';
    for (let i = 0; i < spec.length; i++) {
      if (spec[i] !== '{') { text += spec[i]; continue; }
      let depth = 1, j = i + 1;
      while (j < spec.length && depth) { if (spec[j] === '{') depth++; else if (spec[j] === '}') depth--; j++; }
      if (text) { parts.push(text); text = ''; }
      let expr = spec.slice(i + 1, j - 1), conv = null;
      const m = /!([sra])$/.exec(expr); if (m) { conv = m[1]; expr = expr.slice(0, -2); }
      parts.push({ expr: expr.trim(), spec: null, conv });
      i = j - 1;
    }
    if (text) parts.push(text);
    return this._parseFstring({ ...tok, value: parts });
  }

  _parseFstring(tok) {
    const values = [];
    for (const part of tok.value) {
      if (typeof part === 'string') {
        if (part) values.push({ type: 'Constant', value: part, line: tok.line, col: tok.col });
      } else {
        const exprNode = _adderParseExpr(part.expr);
        values.push({
          type: 'FormattedValue', value: exprNode,
          conversion: part.conv || null,
          formatSpec: this._parseFormatSpec(part.spec, tok),
          line: tok.line, col: tok.col,
        });
      }
    }
    return { type: 'JoinedStr', values, line: tok.line, col: tok.col };
  }

  parseLambda() {
    const t = this.advance(); // 'lambda'
    const params = [];
    let vararg = null, kwarg = null;
    while (!this.at('OP', ':')) {
      if (this.eat('OP', '*')) { if (this.at('NAME')) vararg = this.advance().value; this.eat('OP', ','); continue; }
      if (this.eat('OP', '**')) { kwarg = this.expect('NAME').value; this.eat('OP', ','); break; }
      if (this.eat('OP', '/')) { this.eat('OP', ','); continue; }      // positional-only marker
      const name = this.expect('NAME').value;
      const def = this.eat('OP', '=') ? this.parseExpr() : null;
      params.push({ name, default: def });
      this.eat('OP', ',');
    }
    this.expect('OP', ':');
    return { type: 'Lambda', params, vararg, kwarg, body: this.parseExpr(), line: t.line, col: t.col };
  }
}
