// Python's number formatting, the parts a matplotlib user writes: str.format templates
// ('{x:,.0f}', '{:.1%}', '{x} m', '{pos}') and %-formatting ('%.2f', '%d', '%5.1e'). Tick
// formatters (StrMethodFormatter, FormatStrFormatter, a plain string to set_major_formatter)
// and bar_label read them. Deterministic: no locale, the same text in every host.
//
// The format spec: [[fill]align][sign][#][0][width][grouping][.precision][type]
//   align < > ^ =  ·  sign + - space  ·  grouping , or _  ·  type d i n f F e E g G % s x X o b c
//   no type: a float prints as Python's repr would (1.0, 2.5, 1e-05)

// Python's repr of a float, near enough: integers keep '.0'; exponents have two digits
export function _pyRepr(v) {
  if (typeof v !== 'number') return String(v);
  if (v !== v) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
  const a = Math.abs(v);
  if (a >= 1e16 || a < 1e-4) return _expo(v.toExponential().replace(/\.?0+e/, 'e'));
  return String(v);
}
// toFixed as Python rounds: an EXACT binary tie goes to the even digit ('{:.0f}' of 1234.5 is
// '1234'); everything else is already the nearest (2.675 is 2.67499… in binary, in both)
// The tie is tested on the double's EXACT value (mantissa × 2^e, in BigInt): a × 10^p
// computed in floating point can land on .5 when the true value doesn't (2.675 × 100).
const _dv = new DataView(new ArrayBuffer(8));
function _fixed(a, p) {
  if (!(a >= 0) || a === Infinity || p > 20) return a.toFixed(Math.min(p, 100));
  // past 1e21 toFixed writes an exponent; Python writes the digits (a double that big is an integer)
  if (a >= 1e21) return BigInt(a).toString() + (p ? '.' + '0'.repeat(p) : '');
  _dv.setFloat64(0, a);
  const hi = _dv.getUint32(0), lo = _dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  if (be === 0) return a.toFixed(p);                       // zero and subnormals: no ties there
  const mant = (BigInt(hi & 0xfffff) << 32n | BigInt(lo)) | (1n << 52n);
  const shift = be - 1075 + 1 + p;                         // 2 × a × 10^p = mant × 5^p × 2^shift
  let n = mant * 5n ** BigInt(p);
  if (shift >= 0) n <<= BigInt(shift);
  else { const d = 1n << BigInt(-shift); if (n % d !== 0n) return a.toFixed(p); n /= d; }
  if (n % 2n === 0n) return a.toFixed(p);                  // an integer number of half-units, even: no tie
  const q = (n - 1n) / 2n, m = q % 2n === 0n ? q : q + 1n; // the tie: to the even neighbour
  const s = m.toString().padStart(p + 1, '0');
  return p ? `${s.slice(0, -p)}.${s.slice(-p)}` : s;
}
// JS writes e+6; Python e+06
const _expo = (s) => s.replace(/e([+-])(\d)$/, 'e$10$2');

function _group(intPart, sep) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

// one value through one spec (the part after ':' in '{x:...}')
export function _formatSpec(v, spec) {
  const m = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec || '');
  if (!m) throw new Error(`plot: '${spec}' is not a format spec plot knows (the Python subset: [[fill]align][sign][#][0][width][,][.precision][type])`);
  let [, fill, align, sign, alt, zero, width, grouping, prec, type] = m;
  prec = prec == null ? null : +prec;
  width = width == null ? 0 : +width;
  if (zero && !align) { fill = '0'; align = '='; }
  if (typeof v !== 'number') {
    let s = String(v);
    if (prec != null) s = s.slice(0, prec);
    return _pad(s, '', width, fill || ' ', align || '<');
  }
  const neg = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  let body;
  if (a !== a) body = 'nan';
  else if (a === Infinity) body = 'inf';
  else switch (type) {
    case 'd': case 'i': case 'n': body = String(Math.round(a)); break;
    case 'f': case 'F': body = _fixed(a, prec ?? 6); break;
    case 'e': case 'E': body = _expo(a.toExponential(prec ?? 6)); break;
    case '%': body = _fixed(a * 100, prec ?? 6) + '%'; break;
    case 'g': case 'G': body = _gfmt(a, prec ?? 6, !!alt); break;
    case 'x': case 'X': body = Math.round(a).toString(16); break;
    case 'o': body = Math.round(a).toString(8); break;
    case 'b': body = Math.round(a).toString(2); break;
    case 'c': body = String.fromCharCode(Math.round(a)); break;
    case 's': body = _pyRepr(a); break;
    default: body = prec != null ? _gfmt(a, prec, false, true) : _pyRepr(a);
  }
  if (type === 'E' || type === 'G' || type === 'F' || type === 'X') body = body.toUpperCase();
  if (grouping && /^\d/.test(body)) {
    const i = body.search(/[.e%]/);
    const ip = i < 0 ? body : body.slice(0, i), rest = i < 0 ? '' : body.slice(i);
    body = _group(ip, grouping) + rest;
  }
  const sgn = neg && body !== 'nan' ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  return _pad(body, sgn, width, fill || ' ', align || '>');
}

// Python's 'g': p significant digits, fixed or exponent by the exponent, zeros stripped;
// noType: the empty type with a precision (like g, but keeps at least one decimal)
function _gfmt(a, p, alt, noType) {
  if (p === 0) p = 1;
  if (a === 0) return alt ? (0).toFixed(p - 1) : noType ? '0.0' : '0';
  const exp = Math.floor(Math.log10(a));
  let s;
  if (exp >= -4 && exp < p) {
    s = _fixed(a, Math.max(0, p - 1 - exp));
    // rounding can carry into a new digit (9.99 → 10.0): toFixed handles it; strip zeros
    if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    if (noType && !s.includes('.')) s += '.0';
  } else {
    s = a.toExponential(p - 1);
    if (!alt) s = s.replace(/\.?0+e/, 'e');
    s = _expo(s);
  }
  return s;
}

function _pad(body, sgn, width, fill, align) {
  const n = body.length + sgn.length;
  if (n >= width) return sgn + body;
  const k = width - n;
  if (align === '=') return sgn + fill.repeat(k) + body;
  if (align === '<') return sgn + body + fill.repeat(k);
  if (align === '^') { const l = Math.floor(k / 2); return fill.repeat(l) + sgn + body + fill.repeat(k - l); }
  return fill.repeat(k) + sgn + body;
}

// a str.format template: '{x:,.0f} m', '{:.1%}', '{0}', '{pos}'. `named` gives the fields
// ({x, pos}); bare and numbered fields take `args` in order.
export function pyFormat(template, named, ...args) { return _pyFormatWith(template, named, args, null); }
// the same, each formatted field passed through hook (StrMethodFormatter's unicode minus)
export function _pyFormatWith(template, named, args, hook) {
  let auto = 0;
  const h = hook || ((s) => s);
  return String(template).replace(/\{\{|\}\}|\{([^{}:!]*)(?:![rsa])?(?::([^{}]*))?\}/g, (whole, field, spec) => {
    if (whole === '{{') return '{';
    if (whole === '}}') return '}';
    let v;
    if (field === '' || field == null) v = args.length ? args[auto++] : named && named.x;
    else if (/^\d+$/.test(field)) v = args.length ? args[+field] : named && named.x;
    else if (named && field in named) v = named[field];
    else throw new Error(`plot: '{${field}}' has nothing to fill it (the fields are ${named ? Object.keys(named).map((k) => `{${k}}`).join(', ') : 'positional'})`);
    // pos is matplotlib's tick index, an int: it prints as one
    if (field === 'pos' && Number.isInteger(v) && !spec) return String(v);
    return h(spec ? _formatSpec(v, spec) : (typeof v === 'number' ? _pyRepr(v) : String(v)));
  });
}

// %-formatting: '%.2f', '%d', '%5.1e', '%s', '%%' — one value
export function pctFormat(fmt, v) {
  return String(fmt).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([diouxXeEfFgGcrs%])/g, (whole, flags, width, prec, type) => {
    if (type === '%') return '%';
    let align = flags.includes('-') ? '<' : '>';
    let spec = '';
    if (flags.includes('0') && !flags.includes('-')) spec += '0';
    if (width) spec += width;
    if (prec != null) spec += '.' + prec;
    const t = type === 'i' || type === 'u' ? 'd' : type === 'r' || type === 's' ? 's' : type;
    spec += t;
    const sign = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    // %s is str(v): Python's repr of a float ('%s' % 1.0 is '1.0')
    if (t === 's') return _formatSpec(typeof v === 'number' ? _pyRepr(v) : v, (align === '<' ? '<' : '') + (width || ''));
    // %d truncates toward zero ('%d' % 2.7 is '2'), unlike {:d}, which refuses a float
    const val = t === 'd' && typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : v;
    return _formatSpec(val, (align === '<' ? '<' : '') + sign + spec);
  });
}
