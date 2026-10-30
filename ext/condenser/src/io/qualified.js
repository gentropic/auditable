// ── qualified numbers: assay values with a detection-limit qualifier ──────────
// A lab table writes `<0.001` for "below detection" and `>10` for "over the
// upper limit", plus codes for "no value" (BDL, ND, LNR, IS, -). Read as plain
// numbers those are NaN, so ONE such cell made the whole column text. This is
// the one place they become numbers, under a policy:
//   below: 'half' (the resource-estimation convention, default) | 'limit' | 'zero' | 'blank'
//   above: 'limit' (default) | 'blank'
//   negBelow: false — when true a NEGATIVE value means "below |v|" (some labs
//     write -0.001 for <0.001). Off by default: -99/-999 usually means MISSING,
//     so it's a per-column decision, never a guess.
// A plain number is untouched; blank stays blank (NaN); text stays NaN.

export const QUALIFIED_DEFAULT = Object.freeze({ below: 'half', above: 'limit', negBelow: false });

const QUAL_RE = /^([<>]=?|≤|≥)\s*([+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
// "no value" codes labs write in a numeric column (case-insensitive, dots optional)
const CODE_RE = /^(?:b\.?d\.?l\.?|n\.?d\.?|l\.?n\.?r\.?|i\.?s\.?|n\.?s\.?s?\.?|n\.?r\.?|n\/?a|n\.a\.|nan|null|none|missing|-+|\*+)$/i;

// what a cell IS: { kind: 'num'|'below'|'above'|'code'|'blank'|'text', v }
export function classifyQualified(s) {
  if (s == null) return { kind: 'blank', v: NaN };
  if (typeof s === 'number') return Number.isFinite(s) ? { kind: 'num', v: s } : { kind: 'blank', v: NaN };
  const t = String(s).trim();
  if (t === '') return { kind: 'blank', v: NaN };
  const n = +t;
  if (Number.isFinite(n)) return { kind: 'num', v: n };
  const m = QUAL_RE.exec(t);
  if (m) {
    const lim = +m[2];
    return { kind: m[1][0] === '<' || m[1] === '≤' ? 'below' : 'above', v: lim };
  }
  if (CODE_RE.test(t)) return { kind: 'code', v: NaN };
  return { kind: 'text', v: NaN };
}

// a cell → number under a policy (NaN = blank). The fast path is a plain number.
export function qualifiedNumber(s, policy = QUALIFIED_DEFAULT) {
  if (typeof s === 'number') return s;
  if (s == null || s === '') return NaN;
  const n = +s;
  if (Number.isFinite(n)) {
    if (n < 0 && policy && policy.negBelow) return belowValue(-n, policy);
    return n;
  }
  const c = classifyQualified(s);
  if (c.kind === 'below') return belowValue(c.v, policy);
  if (c.kind === 'above') return (policy && policy.above === 'blank') ? NaN : c.v;
  return NaN;
}
function belowValue(lim, policy) {
  const b = (policy && policy.below) || 'half';
  return b === 'limit' ? lim : b === 'zero' ? 0 : b === 'blank' ? NaN : lim / 2;
}

// Census of a sample of cells: is this a numeric column once qualifiers count?
// numeric: every non-blank cell is a number, a qualified number or a code, and
// at least one is a real number (a column of nothing but codes is not data).
export function censusQualified(vals) {
  const out = { n: 0, num: 0, below: 0, above: 0, code: 0, text: 0 };
  for (const s of vals) {
    const k = classifyQualified(s).kind;
    if (k === 'blank') continue;
    out.n++; out[k]++;
  }
  out.numeric = out.n > 0 && out.text === 0 && out.num > 0;
  out.qualified = out.numeric && (out.below + out.above + out.code) > 0;
  return out;
}

// a policy's one-line description (UI + lineage)
export function describeQualified(policy = QUALIFIED_DEFAULT) {
  const b = policy.below || 'half';
  const below = b === 'half' ? '<x → x/2' : b === 'limit' ? '<x → x' : b === 'zero' ? '<x → 0' : '<x → blank';
  const above = policy.above === 'blank' ? '>x → blank' : '>x → x';
  return `${below} · ${above}${policy.negBelow ? ' · −x → below x' : ''}`;
}
