// FIELDS — the live bits of text on a page. A caption says `{fig}`, `{page}`, `{date:DD/MM/YYYY}`,
// `{scale}`; the page fills them in when it is drawn, so a reprint is always current.
//
//   {name}           a field
//   {name:arg}       a field with an argument (a format, a frame's name, a column …)
//   {name:arg:,.2f}  … and a number format at the end
//   {name@id}        … about the frame with that id ({scale@plan}); without one, the frame's
//                    "refers to" (content.of), else the nearest frame that fits
//   ${expr}          an expression the HOST evaluates (env.evalField), e.g. an atlas row's values
//   ${expr:,.0f}     … formatted
//
// Number formats (Python's, the useful part): `,` or `_` groups thousands (comma / space), `.N`
// the decimals, then `f` fixed, `%` percent, `e` exponent. `,` alone groups an integer.
//
// Fields are a registry: compo registers fig/page/pages/date/time/title (and scale, in
// kinds.js); a host adds its own with registerField or per page with env.fields. An unknown
// `{word}` is left exactly as written, so ordinary braces in text survive.

const FIELDS = new Map();
// fn(arg, frame, env) → a string, a number (formatted), or null/undefined (→ '—')
export function registerField(name, fn, help = '') { FIELDS.set(name, { fn, help }); }
export function fieldList(env = {}) {
  const out = [...FIELDS].map(([name, f]) => ({ name, help: f.help }));
  for (const h of env.fieldHelp || []) if (!out.some((o) => o.name === h.name)) out.push(h);
  return out;
}

// ── number formats ──
const SPEC_RE = /^([,_])?(?:\.(\d{1,2}))?([f%e])?$/;
export const isFormatSpec = (s) => !!s && SPEC_RE.test(s);
// no format: six significant figures, but never rounding away the integer part (a UTM northing)
const plain = (x) => (Number.isInteger(x) ? String(x) : Math.abs(x) >= 1e6 ? String(Math.round(x)) : String(+x.toPrecision(6))).replace(/^-/, '−');
// small formatters a host's own fields share with compo's:
// groupDigits(2343000) → '2 343 000' — an integer's thousands grouped (a space, the SI way; ',' for 2,343,000)
export const groupDigits = (n, sep = ' ') => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
// significant(1234.567, 4) → 1235 — a number to k significant figures ('' when it isn't one)
export const significant = (v, k = 4) => (Number.isFinite(v) ? +v.toPrecision(k) : '');
// fmtBearing(45) → '045°' — a compass bearing, three digits, 0–359
export const fmtBearing = (v) => String(Math.round(((v % 360) + 360) % 360) % 360).padStart(3, '0') + '°';
const group = (intStr, sep) => groupDigits(intStr, sep);
export function formatNumber(x, spec = '') {
  if (typeof x !== 'number') return x == null ? '' : String(x);
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞';
  const m = SPEC_RE.exec(spec || '');
  if (!m || !spec) return plain(x);
  const [, sep, dec, type] = m;
  let v = x, suffix = '';
  if (type === '%') { v = x * 100; suffix = '%'; }
  let s;
  if (type === 'e') s = v.toExponential(dec != null ? +dec : 3);
  else if (dec != null) s = v.toFixed(+dec);
  else if (type === 'f' || type === '%') s = v.toFixed(type === '%' ? 0 : 6);
  else s = plain(v).replace('−', '-');
  if (sep && type !== 'e') {
    const neg = s[0] === '-', body = neg ? s.slice(1) : s, [ip, fp] = body.split('.');
    s = (neg ? '-' : '') + group(ip, sep === ',' ? ',' : ' ') + (fp != null ? '.' + fp : '');
  }
  return s.replace(/^-/, '−') + suffix;
}
// a value as text: numbers through the format, the rest as they are
const asText = (v, spec) => (v == null ? '—' : typeof v === 'number' ? formatNumber(v, spec) : String(v));

// ── dates: YYYY YY MMMM MMM MM M DD D HH mm ss ──
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = (n) => String(n).padStart(2, '0');
export function formatDate(d, fmt) {
  const t = { YYYY: d.getFullYear(), YY: p2(d.getFullYear() % 100), MMMM: MON[d.getMonth()], MMM: MON[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), M: d.getMonth() + 1, DD: p2(d.getDate()), D: d.getDate(), HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()) };
  return String(fmt).replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|mm|ss/g, (k) => String(t[k]));
}
const nowOf = (env) => (env.now instanceof Date ? env.now : env.now ? new Date(env.now) : new Date());

// ── the frame a field is ABOUT ──
// refFrame(doc, frame, id, test): the frame with that id, else the nearest one passing the test
// (the gap between the boxes, then their centres: the caption under a view means that view).
export function refFrame(doc, frame, id, test = () => true) {
  if (!doc) return null;
  const frames = doc.frames.filter((f) => !f.hidden && f !== frame);
  if (id) return frames.find((f) => f.id === id) || null;
  const cand = frames.filter(test);
  if (!frame || cand.length <= 1) return cand[0] || null;
  const gap = (a, b) => {
    const dx = Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])), dy = Math.max(0, a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3]));
    const cx = a[0] + a[2] / 2 - (b[0] + b[2] / 2), cy = a[1] + a[3] / 2 - (b[1] + b[3] / 2);
    return Math.hypot(dx, dy) * 1e3 + Math.hypot(cx, cy);
  };
  let best = null, bd = Infinity;
  for (const f of cand) { const d = gap(frame.box, f.box); if (d < bd) { bd = d; best = f; } }
  return best;
}
// subjectFrame(env, frame, test) — in order: the field's own @id, the frame's "refers to"
// (content.of), the nearest frame passing the test. The one rule every frame-reading field uses.
export function subjectFrame(env, frame, test = () => true) {
  const doc = env.doc; if (!doc) return null;
  if (env.at) return doc.frames.find((f) => f.id === env.at) || null;
  const of = frame && frame.content && frame.content.of;
  if (of) return doc.frames.find((f) => f.id === of) || null;
  return refFrame(doc, frame, null, test);
}
const saysFig = (f) => f.kind === 'text' && /\{fig\}/.test((f.content && f.content.md) || '');

// ── the built-ins ──
registerField('fig', (a, frame, env) => {
  if (!env.figOf) return 1;
  if (!env.at) return env.figOf(frame);
  // {fig@x}: x's figure number — x a caption, or (a view) the caption nearest it
  const t = env.doc && env.doc.frames.find((f) => f.id === env.at);
  const cap = t && (saysFig(t) ? t : refFrame(env.doc, t, null, saysFig));
  return cap ? env.figOf(cap) : `⟨“${env.at}” has no {fig} caption⟩`;
}, 'the figure number (counted in page order, on across an atlas); {fig@plan} = another caption’s or view’s');
registerField('page', (a, f, env) => env.page ?? 1, 'the page number');
registerField('pages', (a, f, env) => env.pages ?? 1, 'the page count');
registerField('date', (a, f, env) => (a ? formatDate(nowOf(env), a) : env.date || formatDate(nowOf(env), 'YYYY-MM-DD')), 'today: {date} · {date:DD/MM/YYYY} · {date:D MMMM YYYY}');
registerField('time', (a, f, env) => formatDate(nowOf(env), a || 'HH:mm'), 'the time: {time} · {time:HH:mm:ss}');
registerField('title', (a, f, env) => env.title || '', "the figure's title");
// {prop:key} — a property: the document's own (doc.props — a drawing number, a revision) over the
// host's (env.props — a house style's company, client, project …)
registerField('prop', (a, f, env) => {
  if (!a) return '⟨which property? {prop:client}⟩';
  const own = env.doc && env.doc.props && env.doc.props[a], house = env.props && env.props[a];
  return own != null && own !== '' ? own : house != null && house !== '' ? house : '—';
}, "a property — the figure's own (drawing, revision) over the project's (company, client, project, prepared, checked): {prop:client}");

// {name}  {name:arg}  {name:arg:spec}  … and @id last: {scale@plan}, {mean:AU:.2f@plan}
const FIELD_RE = /\{([A-Za-z][\w-]*)(?::([^{}@]*))?(?:@([\w.-]+))?\}/g;
export function resolveFields(src, env = {}, frame = null) {
  let s = String(src == null ? '' : src);
  // ${expr} and ${expr:spec} — the host's expressions
  s = s.replace(/\$\{([^}]*)\}/g, (_, raw) => {
    let expr = raw, spec = '';
    const k = raw.lastIndexOf(':');
    if (k >= 0 && isFormatSpec(raw.slice(k + 1).trim())) { expr = raw.slice(0, k); spec = raw.slice(k + 1).trim(); }
    if (!env.evalField) return `⟨${expr.trim()}⟩`;
    try { const v = env.evalField(expr.trim(), env.vars || {}, frame, env); return v == null ? '' : asText(v, spec); } catch (e) { return `⟨${expr.trim()}: ${e.message}⟩`; }
  });
  return s.replace(FIELD_RE, (whole, name, arg, at) => {
    const f = (env.fields && env.fields[name]) ? { fn: env.fields[name] } : FIELDS.get(name);
    if (!f) return whole;
    if (at && env.doc && !env.doc.frames.some((x) => x.id === at)) return `⟨no frame “${at}”⟩`;
    let a = arg == null ? '' : arg, spec = '';
    if (isFormatSpec(a)) { spec = a; a = ''; } else { const k = a.lastIndexOf(':'); if (k >= 0 && isFormatSpec(a.slice(k + 1))) { spec = a.slice(k + 1); a = a.slice(0, k); } }
    try { return asText(f.fn(a.trim(), frame, at ? { ...env, at } : env), spec); } catch (e) { return `⟨${name}: ${e.message}⟩`; }
  });
}
