// micro — YAML fields: the routine editor's step boxes as small editors — a highlight layer
// behind a transparent-text textarea (the expression fields' overlay, exprfield.js), completions
// at the caret from the tool's own settings list (src/tools.js), and live corrections: the box is
// parsed and checked the way a routine will run it, every problem lands on its line, and a
// did-you-mean is one click. Nothing here ever changes the text unasked.
import { S, activeLayer } from './state.js';
import { layerTableHeader, schemaExt } from './records.js';
import { toolDef, toolList, checkParams } from './tools.js';
import { STEP_KEYS, yamlToJs } from './recipes.js';
import { tokenize, complete } from '../../../ext/expr/index.js';
import { parse as yamlParse } from '../../../ext/yaml/index.js';
import { _ac, _acAnchor, acRender, acClose, acKeydown, columnValues } from './exprfield.js';
import { html, setHTML } from './html.js';

// a step's own keywords (not tool settings) — what the routine runner reads off a step
const KW = {
  with: { type: 'map', doc: 'the tool’s settings' },
  tool: { type: 'tool', doc: 'an inline step: which tool' },
  recipe: { type: 'recipe', doc: 'run a saved recipe' },
  as: { type: 'string', doc: 'names the report file' },
  each: { type: 'map', doc: 'a parameter table — the steps run once per row' },
  steps: { type: 'steps', doc: 'the steps of a block' },
  filter: { type: 'expr', doc: 'which rows of the table fan out' },
  check: { type: 'expr', doc: 'a condition over the results so far' },
  every: { type: 'expr', doc: 'a condition every row must meet' },
  in: { type: 'string', doc: 'the step whose table a check reads' },
  compare: { type: 'string', doc: 'a step compared with the baseline run' },
  tolerance: { type: 'number', doc: 'the relative change a compare allows' },
  level: { type: 'enum', values: ['stop', 'warn'], doc: 'a failed check stops the run, or only warns' },
  say: { type: 'string', doc: 'what a failed check says' },
  guard: { type: 'enum', values: ['no-overwrites'], doc: 'stop before running if a report exists' },
  output: { type: 'map', doc: 'where reports go (dir, prefix, suffix)' },
  emit: { type: 'string', doc: 'a value the step hands to later steps' },
  cache: { type: 'bool', doc: 'false: always recompute' },
};
const BOX_KW = ['with', 'cache'];                           // what a step BOX may carry besides settings
const EXPR_KEYS = new Set(['filter', 'check', 'every']);
const isList = (sp) => sp && (sp.type === 'list' || sp.type === 'numbers' || sp.type === 'steps');
const isMap = (sp) => sp && (sp.type === 'map' || sp.type === 'object');

// ── the line model: indent-based paths (the @gcu/yaml subset — block style, children strictly
// deeper, `- ` items, quoted strings) ──
const KEY_RE = /^([A-Za-z_$][\w.$-]*|"(?:[^"\\]|\\.)*"|'[^']*')[ \t]*:(?=\s|$)/;
function scanLine(s) {
  let i = 0; while (s[i] === ' ') i++;
  const ind = i, dashes = [];
  while (s[i] === '-' && (i + 1 >= s.length || s[i + 1] === ' ')) { dashes.push(i); i++; while (s[i] === ' ') i++; }
  let key = null, ks = -1, ke = -1;
  const m = s[i] === '#' ? null : KEY_RE.exec(s.slice(i));
  if (m) { key = m[1].replace(/^["']|["']$/g, ''); ks = i; ke = i + m[1].length; i += m[0].length; while (s[i] === ' ') i++; }
  let j = i, q = null, cs = -1;
  for (; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === '\\' && q === '"') j++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (j === 0 || s[j - 1] === ' ')) { cs = j; break; }
  }
  let ve = cs < 0 ? s.length : cs; while (ve > i && s[ve - 1] === ' ') ve--;
  return { ind, dashes, key, ks, ke, vs: i, ve, cs };
}
function lineModel(text) {
  const lines = []; const stack = [{ col: -1, items: -1 }]; let off = 0;
  for (const s of text.split('\n')) {
    const L = scanLine(s); L.off = off; L.text = s; off += s.length + 1;
    if (!L.dashes.length && L.key == null && L.vs >= L.ve) { lines.push(L); continue; }   // blank / comment
    for (const d of L.dashes) {
      while (stack.length > 1 && stack[stack.length - 1].col >= d) stack.pop();
      const par = stack[stack.length - 1]; par.items++;
      stack.push({ col: d, seg: par.items, items: -1 });
    }
    if (L.key != null) {
      while (stack.length > 1 && stack[stack.length - 1].col >= L.ks) stack.pop();
      stack.push({ col: L.ks, seg: L.key, items: -1 });
    }
    L.path = stack.slice(1).map((e) => e.seg);
    lines.push(L);
  }
  return { lines, stack };
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const unq = (v) => String(v || '').trim().replace(/^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/, (_, a, b) => (a != null ? a : b));
const valAt = (lines, segs) => { const L = lines.find((x) => x.path && x.key != null && eq(x.path, segs)); return L ? unq(L.text.slice(L.vs, L.ve)) : null; };

// what a path names: { kind: 'step' | 'tool' | 'item' | 'list' | 'value' | 'opaque', schema?, spec?, tool }
function toolOfStep(lines, segs, ctx) {
  const t = valAt(lines, [...segs, 'tool']); if (t) return t;
  const r = valAt(lines, [...segs, 'recipe']); const rc = r && S.recipes.find((x) => x.name === r);
  return rc ? rc.tool : segs.length ? null : ctx.tool();
}
function resolve(segs, lines, ctx) {
  let n = { kind: 'step', tool: toolOfStep(lines, [], ctx) };
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i], def = n.tool && toolDef(n.tool);
    if (n.kind === 'step') {
      if (seg === 'with') n = { kind: 'tool', schema: def ? def.params : {}, tool: n.tool };
      else if (seg === 'steps') n = { kind: 'steps' };
      else { const sp = (def && def.params[seg]) || KW[seg]; n = sp ? (sp.type === 'list' ? { kind: 'list', spec: sp, tool: n.tool } : { kind: 'value', spec: sp, tool: n.tool }) : { kind: 'opaque' }; }
    } else if (n.kind === 'steps') n = typeof seg === 'number' ? { kind: 'step', tool: toolOfStep(lines, segs.slice(0, i + 1), ctx) } : { kind: 'opaque' };
    else if (n.kind === 'tool' || n.kind === 'item') {
      const sp = n.schema[seg];
      n = !sp ? { kind: 'opaque' } : sp.type === 'list' ? { kind: 'list', spec: sp, tool: n.tool } : { kind: 'value', spec: sp, tool: n.tool };
    } else if (n.kind === 'list') n = typeof seg === 'number' ? { kind: 'item', schema: n.spec.item, tool: n.tool } : { kind: 'opaque' };
    else n = { kind: 'opaque' };
  }
  return n;
}
const isExprKey = (key, n) => (n.kind === 'value' && n.spec.type === 'expr') || (EXPR_KEYS.has(key) && n.kind !== 'opaque');

const layerNamed = (nm) => nm && S.layers.find((x) => x.name === nm || (x.label || x.name) === nm);
function layerFor(lines, segs, ctx) {                       // the nearest `layer:` (or `model:`) up the path
  for (let k = segs.length; k >= 0; k--) {
    const p = segs.slice(0, k); if (typeof p[p.length - 1] === 'number' || !p.length || p[p.length - 1] === 'with') {
      for (const key of ['layer', 'model']) { const L = layerNamed(valAt(lines, [...p, key])); if (L) return L; }
    }
  }
  const b = ctx.base() || {};
  return layerNamed(b.layer) || layerNamed(b.model) || activeLayer();
}
const colsOf = (L) => { const h = L && layerTableHeader(L); return h ? schemaExt(L, h) : []; };

// ── highlight ──
const VAR_RE = /\$\{[^}]*\}?|\$[A-Za-z_][\w.]*/g;
function exprSpans(s, a, b, out) {                         // the inside of a quoted expression → renderExprHL's classes
  const raw = s.slice(a, b);
  const masked = raw.replace(/\\./g, (m) => ' ' + m[1]).replace(VAR_RE, (m) => '_'.repeat(m.length));
  const vars = [...raw.matchAll(VAR_RE)].map((m) => [m.index, m.index + m[0].length]);
  for (const t of tokenize(masked)) {
    const v = vars.find(([x, y]) => t.start >= x && t.end <= y);
    out.push({ s: a + t.start, e: a + t.end, cls: v ? 'yf-var' : 'hl-' + t.kind });
  }
}
function lineSpans(L, lines, ctx) {
  const s = L.text, out = [];
  for (const d of L.dashes) out.push({ s: d, e: d + 1, cls: 'yf-dash' });
  let expr = false;
  if (L.key != null) {
    out.push({ s: L.ks, e: L.ke, cls: 'yf-key' });
    try { expr = isExprKey(L.key, resolve(L.path, lines, ctx)); } catch { expr = false; }
  }
  const v = s.slice(L.vs, L.ve);
  if (v) {
    const q = v[0];
    if (q === '"' || q === "'") {
      let e = 1; for (; e < v.length; e++) { if (v[e] === '\\' && q === '"') e++; else if (v[e] === q) break; }
      const end = L.vs + Math.min(e + 1, v.length);
      out.push({ s: L.vs, e: L.vs + 1, cls: 'hl-string' });
      if (expr) exprSpans(s, L.vs + 1, Math.min(L.vs + e, end), out);
      else {
        let p = L.vs + 1;
        for (const m of v.slice(1, e).matchAll(VAR_RE)) {
          const a = L.vs + 1 + m.index;
          if (a > p) out.push({ s: p, e: a, cls: 'hl-string' });
          out.push({ s: a, e: a + m[0].length, cls: 'yf-var' }); p = a + m[0].length;
        }
        if (L.vs + e > p) out.push({ s: p, e: L.vs + e, cls: 'hl-string' });
      }
      if (e < v.length) out.push({ s: L.vs + e, e: end, cls: 'hl-string' });
    } else if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) out.push({ s: L.vs, e: L.ve, cls: 'hl-number' });
    else if (/^(true|false|null|~)$/.test(v)) out.push({ s: L.vs, e: L.ve, cls: 'hl-boolean' });
    else if (/^(\[\]|\{\}|[|>][-+]?)$/.test(v)) out.push({ s: L.vs, e: L.ve, cls: 'yf-dash' });
  }
  if (L.cs >= 0) out.push({ s: L.cs, e: s.length, cls: 'hl-comment' });
  return out.sort((x, y) => x.s - y.s);
}
function renderHL(f) {
  const text = f.ta.value, { lines } = lineModel(text), caret = f.ta.selectionStart, parts = [];
  lines.forEach((L, li) => {
    if (li) parts.push('\n');
    const spans = lineSpans(L, lines, f.ctx), bad = f.marks.get(li), s = L.text;
    const cuts = new Set([0, s.length]);
    for (const sp of spans) { cuts.add(sp.s); cuts.add(sp.e); }
    for (const b of bad || []) { cuts.add(b.s); cuts.add(Math.min(b.e, s.length)); }
    if (caret >= L.off && caret <= L.off + s.length) cuts.add(caret - L.off);
    const pts = [...cuts].filter((x) => x >= 0 && x <= s.length).sort((a, b) => a - b);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      if (caret === L.off + a && !f._caretDone) { parts.push(html`<span class="yf-caret"></span>`); f._caretDone = true; }
      if (b == null || b <= a) continue;
      const sp = spans.find((x) => x.s <= a && x.e >= b), isBad = (bad || []).some((x) => x.s <= a && x.e >= b);
      const cls = [sp ? sp.cls : '', isBad ? 'yf-bad' : ''].filter(Boolean).join(' ');
      parts.push(cls ? html`<span class="${cls}">${s.slice(a, b)}</span>` : s.slice(a, b));
    }
  });
  f._caretDone = false;
  if (text.endsWith('\n') || !text) parts.push(' ');
  setHTML(f.hl, html`${parts}`);
  f.hl.scrollTop = f.ta.scrollTop; f.hl.scrollLeft = f.ta.scrollLeft;
}

// ── completions ──
const q = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const typeLabel = (sp) => [sp.type === 'map' ? 'block' : sp.type, sp.default !== undefined && sp.default !== '' ? `default ${JSON.stringify(sp.default)}` : '', sp.required || sp.routine === 'required' ? 'required' : ''].filter(Boolean).join(' · ');
function keyOptions(n, siblings, pad) {
  const out = [], add = (k, sp, kind = 'column') => {
    if (siblings.has(k) || sp.display) return;
    const nl = '\n' + pad + '  ';
    const insert = isList(sp) ? `${k}:${nl}- ` : isMap(sp) ? `${k}:${nl}` : `${k}: `;
    out.push({ value: k, kind, detail: typeLabel(sp), doc: sp.doc || '', insert, after: 'refresh' });
  };
  const def = n.tool && toolDef(n.tool);
  if (n.kind === 'step') {
    if (n.box) for (const k of BOX_KW) add(k, KW[k], 'keyword');
    else for (const k of Object.keys(KW)) add(k, KW[k], 'keyword');
    if (def && (n.box || !siblings.has('with'))) for (const [k, sp] of Object.entries(def.params)) add(k, sp);
  } else if (n.kind === 'tool' || n.kind === 'item') for (const [k, sp] of Object.entries(n.schema || {})) add(k, sp);
  return out;
}
function valueOptions(sp, f, lines, segs, typed) {
  const out = [], ctx = f.ctx;
  const push = (v, kind, detail) => out.push({ value: String(v), kind, detail, insert: q(v) });
  if (sp.type === 'enum') for (const v of sp.values) push(v, 'value', 'one of');
  else if (sp.type === 'bool') for (const v of ['true', 'false']) out.push({ value: v, kind: 'keyword', insert: v });
  else if (sp.type === 'layer') for (const L of S.layers) push(L.name, 'value', L.label && L.label !== L.name ? L.label : 'layer');
  else if (sp.type === 'column') for (const c of colsOf(layerFor(lines, segs, ctx))) push(c.name, 'column', c.type);
  else if (sp.type === 'tool') for (const t of toolList()) push(t.name, 'value', t.label);
  else if (sp.type === 'recipe') for (const r of S.recipes) if (r.tool !== 'routine') push(r.name, 'value', r.tool);
  if (['layer', 'column', 'string', 'expr', 'enum', 'any'].includes(sp.type)) for (const v of ctx.vars()) push('$' + v, 'function', 'variable');
  const t = typed.toLowerCase();
  const res = out.filter((o) => o.value.toLowerCase().startsWith(t) || (t && o.value.toLowerCase().includes(t)));
  return res.length === 1 && res[0].value === typed && f._closedQuote ? [] : res;
}
function completionsAt(f) {
  const ta = f.ta, text = ta.value, caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) return null;
  const ls = text.lastIndexOf('\n', caret - 1) + 1, le = text.indexOf('\n', caret) < 0 ? text.length : text.indexOf('\n', caret);
  const { stack } = lineModel(text.slice(0, ls));
  const all = lineModel(text).lines.filter((L) => L.path);
  const line = text.slice(ls, le), col = caret - ls, before = line.slice(0, col);
  const st = stack.map((e) => ({ ...e }));
  const pathTo = (c) => { while (st.length > 1 && st[st.length - 1].col >= c) st.pop(); return st.slice(1).map((e) => e.seg); };
  const km = /^(\s*)((?:- +)*)([\w$.-]*)$/.exec(before);
  if (km) {                                                  // a KEY position
    let c = km[1].length;
    for (const d of km[2].matchAll(/- +/g)) { pathTo(c); const par = st[st.length - 1]; par.items++; st.push({ col: c, seg: par.items, items: -1 }); c += d[0].length; }
    const segs = pathTo(c), n = resolve(segs, all, f.ctx); if (!segs.length) n.box = f.box;
    const sib = new Set(all.filter((L) => L.key != null && eq(L.path.slice(0, -1), segs) && L.off !== ls).map((L) => L.key));
    const frag = km[3], tail = /^[\w$.-]*/.exec(line.slice(col))[0];
    sib.delete(frag + tail);
    const opts = keyOptions(n, sib, ' '.repeat(c)).filter((o) => o.value.toLowerCase().startsWith(frag.toLowerCase()));
    return { from: caret - frag.length, to: caret + tail.length, options: opts.slice(0, 60) };
  }
  const L = scanLine(line);
  if (L.key == null || col < L.ke + 1) return null;
  for (const d of L.dashes) { pathTo(d); const par = st[st.length - 1]; par.items++; st.push({ col: d, seg: par.items, items: -1 }); }
  const parent = pathTo(L.ks), n = resolve([...parent, L.key], all, f.ctx);
  if (n.kind !== 'value') return null;
  const sp = n.spec, v = line.slice(L.vs, L.ve), quoted = v[0] === '"' || v[0] === "'";
  if (col < L.vs && v) return null;
  if (quoted && (isExprKey(L.key, n))) {                     // inside an expression → @gcu/expr's completer
    const qe = v.length > 1 && v[v.length - 1] === v[0] ? L.ve - 1 : line.length;   // unterminated: the caret's still inside
    if (col <= L.vs || col > qe) return null;
    const raw = line.slice(L.vs + 1, qe), rel = col - L.vs - 1;
    const vm = /\$\{?([\w.]*)$/.exec(raw.slice(0, rel));
    if (vm) return { from: caret - vm[0].length, to: caret, options: f.ctx.vars().filter((x) => x.startsWith(vm[1])).map((x) => ({ value: '$' + x, kind: 'function', detail: 'variable' })) };
    const Ly = layerFor(all, parent, f.ctx);
    const masked = raw.replace(/\\./g, (m) => ' ' + m[1]).replace(VAR_RE, (m) => '_'.repeat(m.length));
    const res = complete(masked, rel, { columns: colsOf(Ly), values: Ly && Ly === activeLayer() ? columnValues : undefined });
    const esc = v[0] === '"' ? (s) => s.replace(/"/g, '\\"') : (s) => s;
    return { from: ls + L.vs + 1 + res.from, to: ls + L.vs + 1 + res.to, options: res.options.map((o) => ({ ...o, insert: esc(o.value) + ((o.kind === 'operator' || o.kind === 'keyword') ? ' ' : '') })) };
  }
  f._closedQuote = quoted && v.length > 1 && v[v.length - 1] === v[0];
  const typed = (quoted ? v.slice(1, f._closedQuote ? -1 : undefined) : v).slice(0, Math.max(0, col - L.vs - (quoted ? 1 : 0)));
  return { from: ls + (v ? L.vs : col), to: ls + (v ? L.ve : col), options: valueOptions(sp, f, all, parent, typed).slice(0, 60) };
}
function refresh(f) {
  if (_ac.suppress) return;
  const res = completionsAt(f);
  if (!res || !res.options.length) { if (_ac.input === f.ta) acClose(); return; }
  for (const o of res.options) if (o.after === 'refresh') o.after = () => refresh(f);
  _ac.input = f.ta; _ac.res = res; _ac.sel = 0; acRender(f.ta);
}

// ── corrections: parse, then checkParams the way a routine runs the step; each problem → its line ──
const segsOf = (p) => { const out = []; String(p).replace(/([^.[\]]+)|\[(\d+)\]/g, (_, k, i) => { out.push(i != null ? +i : k); return ''; }); return out; };
function lint(f) {
  const text = f.ta.value, { lines } = lineModel(text), probs = [];
  f.marks = new Map();
  const mark = (li, s, e) => { if (!f.marks.has(li)) f.marks.set(li, []); f.marks.get(li).push({ s, e }); };
  if (text.trim()) {
    let obj = null;
    // check a LENIENT copy: a bare `key:` still being typed (nothing nested under it) reads as empty —
    // the strict reader refuses it, which turned the box red mid-word and hid every other check.
    // The routine itself still parses strictly.
    const src = text.split('\n'), indOf = (s) => s.match(/^ */)[0].length;
    for (let i = 0; i < src.length; i++) {
      if (!/^\s*(?:- )?[\w.$-]+:\s*$/.test(src[i])) continue;
      let j = i + 1; while (j < src.length && !src[j].trim()) j++;
      const sameIndList = j < src.length && indOf(src[j]) === indOf(src[i]) && /^\s*- /.test(src[j]) && !/^\s*- /.test(src[i]);   // `key:` then `- item` at the same indent is a list
      if (j >= src.length || (indOf(src[j]) <= indOf(src[i]) && !sameIndList)) src[i] = src[i].replace(/:\s*$/, ': ""');
    }
    try { obj = yamlToJs(yamlParse(src.join('\n'))); } catch (e) {
      const li = (e.line || 1) - 1, L = lines[li];
      if (L) mark(li, L.ind, L.text.length || 1);
      probs.push({ li, msg: String(e.message).replace(/^\[rule [^\]]*\]\s*line \d+, col \d+:\s*/, '') });
    }
    const tool = f.ctx.tool();
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && tool && toolDef(tool)) {
      const own = Object.fromEntries(Object.entries(obj).filter(([k]) => !STEP_KEYS.includes(k) && !KW[k]));
      const params = { ...(f.ctx.base() || {}), ...own, ...(obj.with && typeof obj.with === 'object' ? obj.with : {}) };
      for (const err of checkParams(tool, params, { routine: true }).errors) {
        let segs = null, fix = null;
        const m = /^(?:(.+?): )?no setting “(.+?)”(?: — did you mean “(.+?)”\?)?/.exec(err);
        if (m) { segs = [...(m[1] ? segsOf(m[1]) : []), m[2]]; fix = m[3] || null; }
        else { const m2 = /^([A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*):/.exec(err); if (m2) segs = segsOf(m2[1]); }
        let li = -1;
        if (segs) li = lines.findIndex((L) => L.path && L.key != null && (eq(L.path, segs) || eq(L.path, ['with', ...segs])));
        if (li >= 0) mark(li, lines[li].ks, lines[li].ke);
        probs.push({ li, msg: err, fix });
      }
    }
  }
  f.msgs.replaceChildren();
  for (const p of probs) {
    const row = document.createElement('div'); row.className = 'yf-msg';
    const t = document.createElement('span'); t.textContent = (p.li >= 0 ? `line ${p.li + 1}: ` : '') + p.msg;
    if (p.li >= 0) { t.className = 'yf-go'; t.onclick = () => { const L = lines[p.li]; f.ta.focus(); f.ta.setSelectionRange(L.off + Math.max(L.ks, L.ind), L.off + Math.max(L.ke, L.ind)); }; }
    row.appendChild(t);
    if (p.fix && p.li >= 0) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'yf-fix'; b.textContent = `→ ${p.fix}`; b.title = `replace “${lines[p.li].key}” with “${p.fix}”`;
      b.onclick = () => {
        const L = lines[p.li]; if (f.ta.value !== text) return lint(f);   // the text moved on — re-check first
        f.ta.setRangeText(p.fix, L.off + L.ks, L.off + L.ke, 'end');
        f.ta.dispatchEvent(new Event('input')); f.ta.dispatchEvent(new Event('change'));
        acClose(); lint(f);
      };
      row.appendChild(b);
    }
    f.msgs.appendChild(row);
  }
  f.ta.classList.toggle('yf-has', probs.length > 0);
  renderHL(f);
}

// ── editing keys: Tab/Shift+Tab indent, Enter keeps the indent (continues a list, opens a block) ──
function insertText(ta, txt) { ta.focus(); if (!document.execCommand('insertText', false, txt)) { ta.setRangeText(txt, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } }
function editKey(e, f) {
  const ta = f.ta, v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
  if (e.key === 'Tab') {
    e.preventDefault();
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    if (!e.shiftKey && a === b) return insertText(ta, '  ');
    const le = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0)); const end = le < 0 ? v.length : le;
    const block = v.slice(ls, end).split('\n'), out = block.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
    ta.setSelectionRange(ls, end); insertText(ta, out);
    // a selection stays selected (indent it again, or keep typing over it); a bare caret stays a caret —
    // selecting the line after a dedent made the next keystroke replace the whole line
    if (a !== b) ta.setSelectionRange(ls, ls + out.length);
    else { const c = Math.max(ls, a - (end - ls - out.length)); ta.setSelectionRange(c, c); }
  } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && a === b) {
    e.preventDefault();
    const ls = v.lastIndexOf('\n', a - 1) + 1, before = v.slice(ls, a), L = scanLine(before);
    if (L.dashes.length && L.key == null && L.vs >= L.ve) {             // an empty `- ` ends the list: back out a level
      ta.setSelectionRange(ls, a); return insertText(ta, ' '.repeat(Math.max(0, L.dashes[L.dashes.length - 1] - 2)));
    }
    let pad = L.key != null ? L.ks : L.ind;
    let tail = '';
    if (L.key != null && L.vs >= L.ve) pad += 2;                        // `key:` with nothing → open its block
    else if (L.dashes.length && L.key == null) { pad = L.dashes[L.dashes.length - 1]; tail = '- '; }   // `- item` → the next item
    insertText(ta, '\n' + ' '.repeat(pad) + tail);
  }
}

// ── the field: wraps `ta` in place. getCtx: { tool() → tool name, base() → the recipe's params
// (what the box is layered over), vars() → $variables in scope }; box: a step's box (vs a whole file)
export function yamlField(ta, getCtx, { box = true } = {}) {
  const outer = document.createElement('div'); outer.className = 'yf';
  const wrap = document.createElement('div'); wrap.className = 'yf-wrap';
  const hl = document.createElement('div'); hl.className = 'exprhl yf-hl'; hl.setAttribute('aria-hidden', 'true');
  const msgs = document.createElement('div'); msgs.className = 'yf-msgs';
  if (ta.parentNode) ta.parentNode.insertBefore(outer, ta);
  wrap.append(hl, ta); outer.append(wrap, msgs);
  ta.wrap = 'off'; ta.spellcheck = false; ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocomplete', 'off');
  const ctx = { tool: () => (getCtx().tool || null), base: () => getCtx().base || {}, vars: () => getCtx().vars || [] };
  const f = { ta, hl, msgs, ctx, box, marks: new Map() };
  ta._yf = f;
  _acAnchor.set(ta, () => { const c = hl.querySelector('.yf-caret'); const r = (c || ta).getBoundingClientRect(); return { left: r.left, bottom: c ? r.top + parseFloat(getComputedStyle(ta).lineHeight || 16) : r.bottom, width: 220 }; });
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 360) + 'px'; };
  let lt = null;
  const later = () => { clearTimeout(lt); lt = setTimeout(() => lint(f), 300); };
  ta.addEventListener('input', () => { grow(); renderHL(f); refresh(f); later(); });
  ta.addEventListener('keydown', (e) => { acKeydown(e, ta); if (!e.defaultPrevented) editKey(e, f); }, true);
  ta.addEventListener('click', () => { renderHL(f); refresh(f); });
  ta.addEventListener('keyup', (e) => { if (/^Arrow|Home|End/.test(e.key) && !(_ac.res && _ac.input === ta)) renderHL(f); });
  ta.addEventListener('scroll', () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('blur', () => setTimeout(() => { if (_ac.input === ta) acClose(); }, 120));
  // the box may be hidden at birth (folded ⋯) — size + check it when it first shows
  new ResizeObserver(() => { if (ta.offsetParent && !f._seen) { f._seen = true; grow(); } }).observe(outer);
  renderHL(f); if (ta.value.trim()) lint(f);
  return { el: outer, lint: () => lint(f) };
}
