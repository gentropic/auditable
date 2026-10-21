// adder stdlib — numbers: fractions, decimal, statistics, and the math functions they need
// (erf, erfc, gamma, lgamma, an exact sumprod). CPython computes statistics exactly (sums of
// floats as rationals, one rounding at the end), so this does too: a small BigInt rational core
// with a correctly rounded conversion back to float.
//
// Concat-bundled with the rest of adder: top-level names carry an `_nm` prefix.

import {
  AdderError, PyTuple, PyDict, mkTuple, pyTypeName, pyRepr, pyStr, pyIter, pyCollect, pyBool, pyEq, pyLt,
  pyAdd, pySub, pyMul, pyTrueDiv, pySorted, pyFormatValue, adderModules, makeExcType, _pyHash, _namedtuple, NotImplemented,
  isIntNum, intToFloat,
} from './builtins.js';

const _nmIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _nmKw = (args) => (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' &&
  args[args.length - 1]._kw === true ? args.pop() : null);
const _nmHas = (kw, k) => !!kw && Object.hasOwn(kw, k) && k !== '_kw';
const _nmType = (name, Cls, module) => {
  const ctor = (...a) => new Cls(...a);
  ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name;
  if (module) ctor.__module__ = module;
  Cls.prototype.__adderClass__ = name;
  Cls.prototype.__adderType__ = ctor;
  ctor._jsClass = Cls;
  return ctor;
};
// an int as a Python value: a Number while it is exact, a BigInt beyond 2**53
const _nmInt = (b) => (b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b);
const _nmIsInt = (v) => (typeof v === 'number' && isIntNum(v)) || typeof v === 'bigint' || typeof v === 'boolean';
const _nmBig = (v) => (typeof v === 'bigint' ? v : BigInt(typeof v === 'boolean' ? +v : v));
// a float repr that keeps the '.0' (NormalDist's and the statistics reprs print floats)
const _nmFloatRepr = (x) => (Number.isInteger(x) && Math.abs(x) < 1e16 ? `${x}.0` : pyRepr(x));

// ── exact rationals: [numerator, denominator] BigInts, denominator > 0 ──
const _nmAbs = (b) => (b < 0n ? -b : b);
function _nmGcd(a, b) { a = _nmAbs(a); b = _nmAbs(b); while (b) [a, b] = [b, a % b]; return a; }
const _nmBitlen = (b) => (b === 0n ? 0 : _nmAbs(b).toString(2).length);
// a finite float, exactly
function _nmFromFloat(x) {
  if (!Number.isFinite(x)) throw new AdderError(Number.isNaN(x) ? 'ValueError' : 'OverflowError', Number.isNaN(x) ? 'cannot convert NaN to integer ratio' : 'cannot convert Infinity to integer ratio');
  if (Number.isInteger(x)) return [BigInt(x), 1n];
  const f = new Float64Array([x]);
  const u = new BigUint64Array(f.buffer)[0];
  const neg = u >> 63n;
  const e = Number((u >> 52n) & 0x7ffn);
  let m = u & 0xfffffffffffffn;
  let exp;
  if (e === 0) exp = -1074; else { m |= 1n << 52n; exp = e - 1075; }
  let n = neg ? -m : m;
  let d = 1n;
  if (exp >= 0) n <<= BigInt(exp); else d = 1n << BigInt(-exp);
  const g = _nmGcd(n, d);
  return [n / g, d / g];
}
// n / d, correctly rounded to the nearest float (ties to even), as CPython's int / int
function _nmToFloat(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  if (n === 0n) return 0;
  const neg = n < 0n;
  if (neg) n = -n;
  let k = 55 - (_nmBitlen(n) - _nmBitlen(d));
  let q, r;
  for (;;) {
    if (k >= 0) { const nn = n << BigInt(k); q = nn / d; r = nn % d; } else { const dd = d << BigInt(-k); q = n / dd; r = n % dd; }
    if (_nmBitlen(q) >= 55) break;
    k += 2;
  }
  const L = _nmBitlen(q);
  const E = L - 1 - k;                       // the value lies in [2**E, 2**(E+1))
  let p = 53;
  if (E < -1022) p = 53 - (-1022 - E);       // subnormal: fewer mantissa bits
  if (p < 0) p = 0;
  const drop = L - p;
  let m = q >> BigInt(drop);
  const rem = q & ((1n << BigInt(drop)) - 1n);
  const half = 1n << BigInt(drop - 1);
  if (rem > half || (rem === half && (r !== 0n || (m & 1n) === 1n))) m += 1n;
  let e2 = drop - k;
  let v = Number(m);
  if (e2 > 1023) { v *= 2 ** 1023; e2 -= 1023; if (e2 > 1023) return neg ? -Infinity : Infinity; }
  if (e2 < -1022) { v *= 2 ** (e2 + 600); v *= 2 ** -600; } else v *= 2 ** e2;
  return neg ? -v : v;
}
const _nmRat = (n, d) => { if (d < 0n) { n = -n; d = -d; } const g = _nmGcd(n, d) || 1n; return [n / g, d / g]; };
const _nmRadd = (a, b) => _nmRat(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const _nmRmul = (a, b) => _nmRat(a[0] * b[0], a[1] * b[1]);
// a number / Fraction / Decimal, exactly (null for inf / nan, which the caller then propagates)
function _nmExact(x) {
  if (typeof x === 'boolean') return [BigInt(+x), 1n];
  if (typeof x === 'bigint') return [x, 1n];
  if (typeof x === 'number') return Number.isFinite(x) ? _nmFromFloat(x) : null;
  if (x instanceof _NmFraction) return [x._n, x._d];
  if (x instanceof _NmDecimal) return x._special ? null : x._ratio();
  if (x && typeof x.as_integer_ratio === 'function') { const t = x.as_integer_ratio(); return [_nmBig(t[0]), _nmBig(t[1])]; }
  throw new AdderError('TypeError', `can't convert type '${pyTypeName(x)}' to numerator/denominator`);
}

// ── math additions: erf / erfc (fdlibm), gamma / lgamma (CPython's Lanczos), sumprod ──
const _nmF = (hi, lo) => { const b = new DataView(new ArrayBuffer(8)); b.setUint32(0, hi); b.setUint32(4, lo); return b.getFloat64(0); };
const _nmHi = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getInt32(0); };
const _nmLoZero = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); b.setUint32(4, 0); return b.getFloat64(0); };
const _NM_ERX = _nmF(0x3FEB0AC1, 0x60000000), _NM_EFX = _nmF(0x3FC06EBA, 0x8214DB69), _NM_EFX8 = _nmF(0x3FF06EBA, 0x8214DB69);
const _NM_PP = [_nmF(0x3FC06EBA, 0x8214DB68), _nmF(0xBFD4CD7D, 0x691CB913), _nmF(0xBF9D2A51, 0xDBD7194F), _nmF(0xBF77A291, 0x236668E4), _nmF(0xBEF8EAD6, 0x120016AC)];
const _NM_QQ = [0, _nmF(0x3FD97779, 0xCDDADC09), _nmF(0x3FB0A54C, 0x5536CEBA), _nmF(0x3F74D022, 0xC4D36B0F), _nmF(0x3F215DC9, 0x221C1A10), _nmF(0xBED09C43, 0x42A26120)];
const _NM_PA = [_nmF(0xBF6359B8, 0xBEF77538), _nmF(0x3FDA8D00, 0xAD92B34D), _nmF(0xBFD7D240, 0xFBB8C3F1), _nmF(0x3FD45FCA, 0x805120E4), _nmF(0xBFBC6398, 0x3D3E28EC), _nmF(0x3FA22A36, 0x599795EB), _nmF(0xBF61BF38, 0x0A96073F)];
const _NM_QA = [0, _nmF(0x3FBB3E66, 0x18EEE323), _nmF(0x3FE14AF0, 0x92EB6F33), _nmF(0x3FB2635C, 0xD99FE9A7), _nmF(0x3FC02660, 0xE763351F), _nmF(0x3F8BEDC2, 0x6B51DD1C), _nmF(0x3F888B54, 0x5735151D)];
const _NM_RA = [_nmF(0xBF843412, 0x600D6435), _nmF(0xBFE63416, 0xE4BA7360), _nmF(0xC0251E04, 0x41B0E726), _nmF(0xC04F300A, 0xE4CBA38D), _nmF(0xC0644CB1, 0x84282266), _nmF(0xC067135C, 0xEBCCABB2), _nmF(0xC0545265, 0x57E4D2F2), _nmF(0xC023A0EF, 0xC69AC25C)];
const _NM_SA = [0, _nmF(0x4033A6B9, 0xBD707687), _nmF(0x4061350C, 0x526AE721), _nmF(0x407B290D, 0xD58A1A71), _nmF(0x40842B19, 0x21EC2868), _nmF(0x407AD021, 0x57700314), _nmF(0x405B28A3, 0xEE48AE2C), _nmF(0x401A47EF, 0x8E484A93), _nmF(0xBFAEEFF2, 0xEE749A62)];
const _NM_RB = [_nmF(0xBF843412, 0x39E86F4A), _nmF(0xBFE993BA, 0x70C285DE), _nmF(0xC031C209, 0x555F995A), _nmF(0xC064145D, 0x43C5ED98), _nmF(0xC083EC88, 0x1375F228), _nmF(0xC0900461, 0x6A2E5992), _nmF(0xC07E384E, 0x9BDC383F)];
const _NM_SB = [0, _nmF(0x403E568B, 0x261D5190), _nmF(0x40745CAE, 0x221B9F0A), _nmF(0x409802EB, 0x189D5118), _nmF(0x40A8FFB7, 0x688C246A), _nmF(0x40A3F219, 0xCEDF3BE6), _nmF(0x407DA874, 0xE79FE763), _nmF(0xC03670E2, 0x42712D62)];
const _nmPoly = (c, z, from = 0) => { let r = c[c.length - 1]; for (let i = c.length - 2; i >= from; i--) r = c[i] + z * r; return r; };
const _nmQ = (c, z) => { let r = c[c.length - 1]; for (let i = c.length - 2; i >= 1; i--) r = c[i] + z * r; return 1 + z * r; };
function _nmErfTail(x, ix, cut) {
  const ax = Math.abs(x);
  const s = 1 / (ax * ax);
  let R, S;
  if (ix < cut) { R = _nmPoly(_NM_RA, s); S = _nmQ(_NM_SA, s); } else { R = _nmPoly(_NM_RB, s); S = _nmQ(_NM_SB, s); }
  const z = _nmLoZero(ax);
  return Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S) / ax;
}
function _nmErf(x) {
  if (Number.isNaN(x)) return x;
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;
  const hx = _nmHi(x), ix = hx & 0x7fffffff;
  if (ix < 0x3feb0000) {
    if (ix < 0x3e300000) return ix < 0x00800000 ? 0.125 * (8.0 * x + _NM_EFX8 * x) : x + _NM_EFX * x;
    const z = x * x;
    return x + x * (_nmPoly(_NM_PP, z) / _nmQ(_NM_QQ, z));
  }
  if (ix < 0x3ff40000) {
    const s = Math.abs(x) - 1;
    const P = _nmPoly(_NM_PA, s), Q = _nmQ(_NM_QA, s);
    return hx >= 0 ? _NM_ERX + P / Q : -_NM_ERX - P / Q;
  }
  if (ix >= 0x40180000) return hx >= 0 ? 1 - 1e-300 : 1e-300 - 1;
  const r = _nmErfTail(x, ix, 0x4006DB6E);
  return hx >= 0 ? 1 - r : r - 1;
}
function _nmErfc(x) {
  if (Number.isNaN(x)) return x;
  if (!Number.isFinite(x)) return x > 0 ? 0 : 2;
  const hx = _nmHi(x), ix = hx & 0x7fffffff;
  if (ix < 0x3feb0000) {
    if (ix < 0x3c700000) return 1 - x;
    const z = x * x;
    const y = _nmPoly(_NM_PP, z) / _nmQ(_NM_QQ, z);
    if (hx < 0x3fd00000) return 1 - (x + x * y);
    let r = x * y;
    r += (x - 0.5);
    return 0.5 - r;
  }
  if (ix < 0x3ff40000) {
    const s = Math.abs(x) - 1;
    const P = _nmPoly(_NM_PA, s), Q = _nmQ(_NM_QA, s);
    if (hx >= 0) return (1 - _NM_ERX) - P / Q;
    return 1 + (_NM_ERX + P / Q);
  }
  if (ix < 0x403c0000) {
    if (hx < 0 && ix >= 0x40180000) return 2 - 1e-300;
    const r = _nmErfTail(x, ix, 0x4006DB6D);
    return hx > 0 ? r : 2 - r;
  }
  return hx > 0 ? 1e-300 * 1e-300 : 2 - 1e-300;
}
const _NM_LANCZOS_G = 6.024680040776729583740234375;
const _NM_LANCZOS_GMH = 5.524680040776729583740234375;
const _NM_LANCZOS_NUM = [23531376880.410759688572007674451636754734846804940, 42919803642.649098768957899047001988850926355848959,
  35711959237.355668049440185451547166705960488635843, 17921034426.037209699919755754458931112671403265390,
  6039542586.3520280050642916443072979210699388420708, 1439720407.3117216736632230727949123939715485786772,
  248874557.86205415651146038641322942321632125127801, 31426415.585400194380614231628318205362874684987640,
  2876370.6289353724412254090516208496135991145378768, 186056.26539522349504029498971604569928220784236328,
  8071.6720023658162106380029022722506138218516325024, 210.82427775157934587250973392071336271166969580291,
  2.5066282746310002701649081771338373386264310793408];
const _NM_LANCZOS_DEN = [0.0, 39916800.0, 120543840.0, 150917976.0, 105258076.0, 45995730.0, 13339535.0, 2637558.0, 357423.0, 32670.0, 1925.0, 66.0, 1.0];
const _NM_GAMMA_INT = [1.0, 1.0, 2.0, 6.0, 24.0, 120.0, 720.0, 5040.0, 40320.0, 362880.0, 3628800.0, 39916800.0, 479001600.0, 6227020800.0,
  87178291200.0, 1307674368000.0, 20922789888000.0, 355687428096000.0, 6402373705728000.0, 121645100408832000.0,
  2432902008176640000.0, 51090942171709440000.0, 1124000727777607680000.0];
const _NM_LOGPI = 1.144729885849400174143427351353058711647;
function _nmLanczosSum(x) {
  let num = 0, den = 0;
  if (x < 5.0) for (let i = 12; i >= 0; i--) { num = num * x + _NM_LANCZOS_NUM[i]; den = den * x + _NM_LANCZOS_DEN[i]; }
  else for (let i = 0; i < 13; i++) { num = num / x + _NM_LANCZOS_NUM[i]; den = den / x + _NM_LANCZOS_DEN[i]; }
  return num / den;
}
function _nmSinpi(x) {
  const y = Math.abs(x) % 2.0;
  const n = Math.round(2.0 * y);
  let r;
  switch (n) {
    case 0: r = Math.sin(Math.PI * y); break;
    case 1: r = Math.cos(Math.PI * (y - 0.5)); break;
    case 2: r = Math.sin(Math.PI * (1.0 - y)); break;
    case 3: r = -Math.cos(Math.PI * (y - 1.5)); break;
    default: r = Math.sin(Math.PI * (y - 2.0));
  }
  return (x < 0 || Object.is(x, -0) ? -1 : 1) * r;
}
const _nmDomain = () => new AdderError('ValueError', 'math domain error');
const _nmRange = () => new AdderError('OverflowError', 'math range error');
function _nmGamma(x) {
  if (!Number.isFinite(x)) { if (Number.isNaN(x) || x > 0) return x; throw _nmDomain(); }
  if (x === 0) throw _nmDomain();
  if (x === Math.floor(x)) {
    if (x < 0) throw _nmDomain();
    if (x <= 23) return _NM_GAMMA_INT[x - 1];
  }
  const absx = Math.abs(x);
  if (absx < 1e-20) { const r = 1.0 / x; if (!Number.isFinite(r)) throw _nmRange(); return r; }
  if (absx > 200.0) { if (x < 0) return 0.0 / _nmSinpi(x); throw _nmRange(); }
  const y = absx + _NM_LANCZOS_GMH;
  let z;
  if (absx > _NM_LANCZOS_GMH) { const q = y - absx; z = q - _NM_LANCZOS_GMH; } else { const q = y - _NM_LANCZOS_GMH; z = q - absx; }
  z = z * _NM_LANCZOS_G / y;
  let r;
  if (x < 0) {
    r = -Math.PI / _nmSinpi(absx) / absx * Math.exp(y) / _nmLanczosSum(absx);
    r -= z * r;
    if (absx < 140.0) r /= Math.pow(y, absx - 0.5);
    else { const sp = Math.pow(y, absx / 2.0 - 0.25); r /= sp; r /= sp; }
  } else {
    r = _nmLanczosSum(absx) / Math.exp(y);
    r += z * r;
    if (absx < 140.0) r *= Math.pow(y, absx - 0.5);
    else { const sp = Math.pow(y, absx / 2.0 - 0.25); r *= sp; r *= sp; }
  }
  if (!Number.isFinite(r)) throw _nmRange();
  return r;
}
function _nmLgamma(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? x : Infinity;
  if (x === Math.floor(x) && x <= 2.0) { if (x <= 0) throw _nmDomain(); return 0.0; }
  const absx = Math.abs(x);
  if (absx < 1e-20) return -Math.log(absx);
  let r = Math.log(_nmLanczosSum(absx)) - _NM_LANCZOS_G;
  r += (absx - 0.5) * (Math.log(absx + _NM_LANCZOS_G - 0.5) - 1);
  if (x < 0.0) r = _NM_LOGPI - Math.log(Math.abs(_nmSinpi(absx))) - Math.log(absx) - r;
  if (!Number.isFinite(r)) throw _nmRange();
  return r;
}
// sum(p[i] * q[i]) computed exactly and rounded once (CPython's sumprod is accurate to the ulp)
function _nmSumprod(p, q) {
  const a = [...pyIter(p)], b = [...pyIter(q)];
  if (a.length !== b.length) throw new AdderError('ValueError', 'Inputs are not the same length');
  if (!a.every((v) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') || !b.every((v) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s = pyAdd(s, pyMul(a[i], b[i]));
    return s;
  }
  const allInt = a.every(_nmIsInt) && b.every(_nmIsInt);
  let acc = [0n, 1n];
  for (let i = 0; i < a.length; i++) {
    const x = _nmExact(a[i]), y = _nmExact(b[i]);
    if (!x || !y) return a.reduce((s, v, j) => s + v * b[j], 0);
    acc = _nmRadd(acc, _nmRmul(x, y));
  }
  return allInt ? _nmInt(acc[0]) : _nmToFloat(acc[0], acc[1]);
}
// an int or bool argument as the float CPython's math converts it to (OverflowError past the range)
const _nmRealArg = (f) => { const w = (x) => f(typeof x === 'bigint' || typeof x === 'boolean' ? intToFloat(x) : x); w._pyName = f.name.replace(/^_nm/, '').toLowerCase(); return w; };
Object.assign(adderModules.math, {
  erf: _nmRealArg(_nmErf), erfc: _nmRealArg(_nmErfc), gamma: _nmRealArg(_nmGamma), lgamma: _nmRealArg(_nmLgamma), sumprod: _nmSumprod,
  fsum: (it) => { let acc = [0n, 1n]; const special = []; for (const v of pyIter(it)) { const x = Number(v); if (!Number.isFinite(x)) special.push(x); else acc = _nmRadd(acc, _nmFromFloat(x)); } if (special.length) return special.reduce((s, v) => s + v, 0); return _nmToFloat(acc[0], acc[1]); },
});

// ── fractions ──
// Fraction over BigInts: from ints, floats (exactly), strings ('3/4', '-1.5e2'), Decimals and
// other Fractions; arithmetic with ints, floats (giving floats) and Fractions; comparison,
// hashing equal to an equal int's, limit_denominator, as_integer_ratio, round / floor / ceil.
class _NmFraction {
  constructor(numerator = 0, denominator = null, ...rest) {
    if (numerator !== null && typeof numerator === 'object' && numerator._kw) { const kw = numerator; numerator = kw.numerator ?? 0; denominator = kw.denominator ?? null; }
    if (denominator !== null && typeof denominator === 'object' && denominator._kw) denominator = denominator.denominator ?? null;
    let n, d;
    if (denominator === null || denominator === undefined) {
      if (_nmIsInt(numerator)) { n = _nmBig(numerator); d = 1n; }
      else if (numerator instanceof _NmFraction) { n = numerator._n; d = numerator._d; }
      else if (typeof numerator === 'number') [n, d] = _nmFromFloat(numerator);
      else if (numerator instanceof _NmDecimal) { if (numerator._special) throw new AdderError('ValueError', `cannot convert ${numerator} to Fraction`); [n, d] = numerator._ratio(); }
      else if (typeof numerator === 'string') [n, d] = _nmParseFraction(numerator);
      else throw new AdderError('TypeError', 'argument should be a string or a Rational instance');
    } else {
      const a = _nmFracArg(numerator), b = _nmFracArg(denominator);
      n = a[0] * b[1]; d = a[1] * b[0];
    }
    if (d === 0n) throw new AdderError('ZeroDivisionError', `Fraction(${n}, 0)`);
    const g = _nmGcd(n, d) || 1n;
    if (d < 0n) { n = -n; d = -d; }
    this._n = n / g; this._d = d / g;
  }
  get numerator() { return _nmInt(this._n); }
  get denominator() { return _nmInt(this._d); }
  __repr__() { return `Fraction(${this._n}, ${this._d})`; }
  __reduce__() { return mkTuple([this.__adderType__, mkTuple([this.numerator, this.denominator])]); }
  __str__() { return this._d === 1n ? String(this._n) : `${this._n}/${this._d}`; }
  __format__(spec) { return spec ? pyFormatValue(this.valueOf(), spec) : this.__str__(); }
  valueOf() { return _nmToFloat(this._n, this._d); }
  __float__() { return this.valueOf(); }
  __int__() { return _nmInt(this._n / this._d); }
  __trunc__() { return this.__int__(); }
  __floor__() { const q = this._n / this._d; return _nmInt(this._n < 0n && q * this._d !== this._n ? q - 1n : q); }
  __ceil__() { const q = this._n / this._d; return _nmInt(this._n > 0n && q * this._d !== this._n ? q + 1n : q); }
  __round__(nd) {
    if (nd === undefined || nd === null) {
      const fl = _nmBig(this.__floor__()); const rem = [this._n - fl * this._d, this._d];   // remainder in [0, 1)
      const twice = 2n * rem[0];
      return _nmInt(twice > rem[1] || (twice === rem[1] && (fl & 1n) === 1n) ? fl + 1n : fl);
    }
    const shift = 10n ** BigInt(Math.abs(nd));
    const scaled = nd > 0 ? new _NmFraction(_nmInt(this._n * shift), _nmInt(this._d)) : new _NmFraction(_nmInt(this._n), _nmInt(this._d * shift));
    const r = _nmBig(scaled.__round__());
    return nd > 0 ? new _NmFraction(_nmInt(r), _nmInt(shift)) : new _NmFraction(_nmInt(r * shift));
  }
  __hash__() { return this._d === 1n ? _pyHash(_nmInt(this._n)) : _pyHash(this.valueOf()); }
  __bool__() { return this._n !== 0n; }
  __neg__() { return _nmFrac(-this._n, this._d); }
  __pos__() { return this; }
  __abs__() { return _nmFrac(_nmAbs(this._n), this._d); }
  is_integer() { return this._d === 1n; }
  as_integer_ratio() { return mkTuple([_nmInt(this._n), _nmInt(this._d)]); }
  limit_denominator(max = 1000000) {
    // CPython's continued-fraction walk, then the nearer of the two best candidates
    if (max !== null && typeof max === 'object' && max._kw) max = max.max_denominator ?? 1000000;
    const maxD = _nmBig(max);
    if (maxD < 1n) throw new AdderError('ValueError', 'max_denominator should be at least 1');
    if (this._d <= maxD) return _nmFrac(this._n, this._d);
    let p0 = 0n, q0 = 1n, p1 = 1n, q1 = 0n, n = this._n, d = this._d;
    for (;;) {
      const a = _nmBig(_nmFloorDiv(n, d));
      const q2 = q0 + a * q1;
      if (q2 > maxD) break;
      [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
      [n, d] = [d, n - a * d];
    }
    const k = (maxD - q0) / q1;
    return 2n * d * (q0 + k * q1) <= this._d ? _nmFrac(p1, q1) : _nmFrac(p0 + k * p1, q0 + k * q1);
  }
  _bin(o, f, rf) {
    if (o instanceof _NmFraction || _nmIsInt(o)) return f(this, o instanceof _NmFraction ? o : _nmFrac(_nmBig(o), 1n));
    if (typeof o === 'number') return rf(this.valueOf(), o);
    return _nmNotImpl;
  }
  __add__(o) { return this._bin(o, (a, b) => _nmFrac(a._n * b._d + b._n * a._d, a._d * b._d), (a, b) => a + b); }
  __radd__(o) { return this.__add__(o); }
  __sub__(o) { return this._bin(o, (a, b) => _nmFrac(a._n * b._d - b._n * a._d, a._d * b._d), (a, b) => a - b); }
  __rsub__(o) { return this._bin(o, (a, b) => _nmFrac(b._n * a._d - a._n * b._d, a._d * b._d), (a, b) => b - a); }
  __mul__(o) { return this._bin(o, (a, b) => _nmFrac(a._n * b._n, a._d * b._d), (a, b) => a * b); }
  __rmul__(o) { return this.__mul__(o); }
  __truediv__(o) {
    return this._bin(o, (a, b) => { if (b._n === 0n) throw new AdderError('ZeroDivisionError', `Fraction(${a._n * b._d}, 0)`); return _nmFrac(a._n * b._d, a._d * b._n); }, (a, b) => pyTrueDiv(a, b));
  }
  __rtruediv__(o) {
    return this._bin(o, (a, b) => { if (a._n === 0n) throw new AdderError('ZeroDivisionError', `Fraction(${b._n * a._d}, 0)`); return _nmFrac(b._n * a._d, b._d * a._n); }, (a, b) => pyTrueDiv(b, a));
  }
  __floordiv__(o) { return this._bin(o, (a, b) => _nmFloorDiv(a._n * b._d, a._d * b._n), (a, b) => Math.floor(a / b)); }
  __rfloordiv__(o) { return this._bin(o, (a, b) => _nmFloorDiv(b._n * a._d, b._d * a._n), (a, b) => Math.floor(b / a)); }
  __mod__(o) { return this._bin(o, (a, b) => { const q = _nmBig(_nmFloorDiv(a._n * b._d, a._d * b._n)); return _nmFrac(a._n * b._d - q * b._n * a._d, a._d * b._d); }, (a, b) => ((a % b) + b) % b); }
  __pow__(o) {
    if (_nmIsInt(o)) {
      const e = _nmBig(o);
      if (e >= 0n) return _nmFrac(this._n ** e, this._d ** e);
      if (this._n === 0n) throw new AdderError('ZeroDivisionError', `Fraction(${this._d ** -e}, 0)`);
      return _nmFrac(this._d ** -e, this._n ** -e);
    }
    if (o instanceof _NmFraction && o._d === 1n) return this.__pow__(_nmInt(o._n));
    return Math.pow(this.valueOf(), Number(o));
  }
  __rpow__(o) { return this._d === 1n && _nmIsInt(o) ? new _NmFraction(o).__pow__(_nmInt(this._n)) : Math.pow(Number(o), this.valueOf()); }
  _cmp(o) {
    if (o instanceof _NmFraction || _nmIsInt(o)) { const b = o instanceof _NmFraction ? o : _nmFrac(_nmBig(o), 1n); const l = this._n * b._d, r = b._n * this._d; return l < r ? -1 : l > r ? 1 : 0; }
    if (typeof o === 'number') { if (Number.isNaN(o)) return NaN; if (!Number.isFinite(o)) return o > 0 ? -1 : 1; const [n, d] = _nmFromFloat(o); const l = this._n * d, r = n * this._d; return l < r ? -1 : l > r ? 1 : 0; }
    return null;
  }
  __eq__(o) { const c = this._cmp(o); return c === null ? _nmNotImpl : c === 0; }
  __lt__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('<', this, o); return c < 0; }
  __le__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('<=', this, o); return c <= 0; }
  __gt__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('>', this, o); return c > 0; }
  __ge__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('>=', this, o); return c >= 0; }
}
const _nmNotImpl = NotImplemented;
const _nmCmpErr = (op, a, b) => new AdderError('TypeError', `'${op}' not supported between instances of '${pyTypeName(a)}' and '${pyTypeName(b)}'`);
const _nmFrac = (n, d) => new _NmFraction(_nmInt(n), _nmInt(d));
function _nmFloorDiv(n, d) { let q = n / d; if ((n % d !== 0n) && ((n < 0n) !== (d < 0n))) q -= 1n; return _nmInt(q); }
function _nmFracArg(v) {
  if (_nmIsInt(v)) return [_nmBig(v), 1n];
  if (v instanceof _NmFraction) return [v._n, v._d];
  throw new AdderError('TypeError', 'both arguments should be Rational instances');
}
function _nmParseFraction(s) {
  const m = /^\s*([+-]?)(?=\d|\.\d)(\d*(?:_\d+)*)(?:(?:\/(\d+(?:_\d+)*))?|(?:\.(\d*(?:_\d+)*))?(?:[eE]([+-]?\d+(?:_\d+)*))?)\s*$/.exec(s);
  if (!m) throw new AdderError('ValueError', `Invalid literal for Fraction: ${pyRepr(s)}`);
  const clean = (t) => (t || '').replace(/_/g, '');
  let n = BigInt(clean(m[2]) || '0'), d = 1n;
  if (m[3] !== undefined) { d = BigInt(clean(m[3])); if (d === 0n) throw new AdderError('ZeroDivisionError', `Fraction(${n}, 0)`); }
  else {
    const frac = clean(m[4]);
    if (frac) { n = n * 10n ** BigInt(frac.length) + BigInt(frac); d = 10n ** BigInt(frac.length); }
    if (m[5] !== undefined) { const e = Number(clean(m[5])); if (e >= 0) n *= 10n ** BigInt(e); else d *= 10n ** BigInt(-e); }
  }
  if (m[1] === '-') n = -n;
  return [n, d];
}
const _nmFractionType = _nmType('Fraction', _NmFraction, 'fractions');
_nmFractionType.from_float = (f) => new _NmFraction(f);
_nmFractionType.from_decimal = (d) => new _NmFraction(d);
adderModules.fractions = { Fraction: _nmFractionType };

// ── decimal ──
// Decimal: arbitrary-precision decimal floating point, as a sign + BigInt coefficient +
// exponent, under a context (prec, default 28; rounding, default ROUND_HALF_EVEN). +, -, *, /,
// //, %, ** (integer exponents), sqrt, quantize, normalize, to_integral_value, comparison
// with ints / floats / Decimals, exact Decimal(float), CPython's str / repr / format('f').
// Signals InvalidOperation and DivisionByZero raise (CPython's default traps). Not here: the
// other traps and flags, Emax / Emin limits, ln / log10 / exp, non-integer powers beyond float.
const _NM_ROUNDINGS = ['ROUND_DOWN', 'ROUND_HALF_UP', 'ROUND_HALF_EVEN', 'ROUND_CEILING', 'ROUND_FLOOR', 'ROUND_UP', 'ROUND_HALF_DOWN', 'ROUND_05UP'];
const _nmDecExc = makeExcType('decimal.DecimalException', 'ArithmeticError');
const _nmInvalidOp = makeExcType('decimal.InvalidOperation', 'decimal.DecimalException');
const _nmDivZero = makeExcType('decimal.DivisionByZero', 'decimal.DecimalException', 'ZeroDivisionError');
class _NmContext {
  constructor(...a) {
    const kw = _nmKw(a) || {};
    this.prec = _nmHas(kw, 'prec') ? kw.prec : a[0] ?? 28;
    this.rounding = _nmHas(kw, 'rounding') ? kw.rounding : a[1] ?? 'ROUND_HALF_EVEN';
    this.Emin = _nmHas(kw, 'Emin') ? kw.Emin : -999999;
    this.Emax = _nmHas(kw, 'Emax') ? kw.Emax : 999999;
    this.capitals = _nmHas(kw, 'capitals') ? kw.capitals : 1;
  }
  copy() { return new _NmContext({ _kw: true, prec: this.prec, rounding: this.rounding, Emin: this.Emin, Emax: this.Emax, capitals: this.capitals }); }
  __repr__() { return `Context(prec=${this.prec}, rounding=${this.rounding}, Emin=${this.Emin}, Emax=${this.Emax}, capitals=${this.capitals}, clamp=0, flags=[], traps=[InvalidOperation, DivisionByZero, Overflow])`; }
}
let _nmCtx = new _NmContext();
const _nmPow10 = (k) => 10n ** BigInt(k);
const _nmDigits = (c) => (c === 0n ? 1 : c.toString().length);
// drop `drop` digits from coeff with the rounding mode; the result's sign is `sign`
function _nmRoundDrop(coeff, drop, mode, sign) {
  if (drop <= 0) return coeff * _nmPow10(-drop);
  const p = _nmPow10(drop);
  const q = coeff / p, rem = coeff % p;
  if (rem === 0n) return q;
  const half = p / 2n;
  switch (mode) {
    case 'ROUND_DOWN': return q;
    case 'ROUND_UP': return q + 1n;
    case 'ROUND_HALF_UP': return rem >= half ? q + 1n : q;
    case 'ROUND_HALF_DOWN': return rem > half ? q + 1n : q;
    case 'ROUND_CEILING': return sign ? q : q + 1n;
    case 'ROUND_FLOOR': return sign ? q + 1n : q;
    case 'ROUND_05UP': return (q % 10n === 0n || q % 10n === 5n) ? q + 1n : q;
    default: return rem > half || (rem === half && (q & 1n) === 1n) ? q + 1n : q;
  }
}
class _NmDecimal {
  constructor(value = '0', context = null) {
    if (value !== null && typeof value === 'object' && value._kw) { context = value.context ?? null; value = value.value ?? '0'; }
    this._sign = 0; this._coeff = 0n; this._exp = 0; this._special = null;
    if (value instanceof _NmDecimal) { Object.assign(this, { _sign: value._sign, _coeff: value._coeff, _exp: value._exp, _special: value._special }); return; }
    if (typeof value === 'boolean') value = +value;
    if (typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0))) {
      const b = _nmBig(value); this._sign = b < 0n ? 1 : 0; this._coeff = _nmAbs(b); return;
    }
    if (typeof value === 'number') { this._fromFloat(value); return; }
    if (value instanceof PyTuple || Array.isArray(value)) {
      const [s, digits, e] = value;
      this._sign = s ? 1 : 0;
      this._coeff = BigInt([...digits].join('') || '0');
      if (typeof e === 'string') this._special = e === 'F' ? 'F' : e === 'n' ? 'n' : 'N'; else this._exp = e;
      return;
    }
    if (typeof value !== 'string') throw new AdderError('TypeError', `conversion from ${pyTypeName(value)} to Decimal is not supported`);
    const s = value.trim().replace(/_/g, '');
    const m = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s);
    if (m) {
      const intPart = m[2] ?? '', frac = m[3] ?? m[4] ?? '';
      this._sign = m[1] === '-' ? 1 : 0;
      this._coeff = BigInt((intPart + frac) || '0');
      this._exp = (m[5] ? parseInt(m[5], 10) : 0) - frac.length;
      return;
    }
    const sp = /^([+-])?(inf|infinity|nan|snan)(\d*)$/i.exec(s);
    if (sp) {
      this._sign = sp[1] === '-' ? 1 : 0;
      const w = sp[2].toLowerCase();
      this._special = w.startsWith('inf') ? 'F' : w === 'nan' ? 'n' : 'N';
      return;
    }
    throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.ConversionSyntax'>]");
  }
  _fromFloat(x) {
    if (Number.isNaN(x)) { this._special = 'n'; return; }
    if (!Number.isFinite(x)) { this._special = 'F'; this._sign = x < 0 ? 1 : 0; return; }
    const neg = x < 0 || Object.is(x, -0);
    const [n, d] = _nmFromFloat(Math.abs(x));
    // d is a power of two: n / 2**k = n * 5**k / 10**k
    const k = _nmBitlen(d) - 1;
    this._sign = neg ? 1 : 0; this._coeff = n * 5n ** BigInt(k); this._exp = -k;
  }
  _ratio() { return this._exp >= 0 ? [(this._sign ? -1n : 1n) * this._coeff * _nmPow10(this._exp), 1n] : _nmRat((this._sign ? -1n : 1n) * this._coeff, _nmPow10(-this._exp)); }
  _isZero() { return !this._special && this._coeff === 0n; }
  // CPython's to-sci-string
  __str__() {
    const sign = this._sign ? '-' : '';
    if (this._special === 'F') return `${sign}Infinity`;
    if (this._special) return `${sign}${this._special === 'N' ? 'sNaN' : 'NaN'}`;
    const digits = this._coeff.toString();
    const left = this._exp + digits.length;
    const dot = this._exp <= 0 && left > -6 ? left : 1;
    let intpart, fracpart;
    if (dot <= 0) { intpart = '0'; fracpart = '.' + '0'.repeat(-dot) + digits; }
    else if (dot >= digits.length) { intpart = digits + '0'.repeat(dot - digits.length); fracpart = ''; }
    else { intpart = digits.slice(0, dot); fracpart = '.' + digits.slice(dot); }
    const e = left === dot ? '' : `E${left - dot >= 0 ? '+' : ''}${left - dot}`;
    return sign + intpart + fracpart + e;
  }
  __repr__() { return `Decimal('${this.__str__()}')`; }
  __reduce__() { return mkTuple([this.__adderType__, mkTuple([_NmDecimal.prototype.__str__.call(this)])]); }
  __format__(spec) { return _nmDecFormat(this, spec || ''); }
  valueOf() { return this._special === 'F' ? (this._sign ? -Infinity : Infinity) : this._special ? NaN : Number(this.__str__()); }
  __float__() { return this.valueOf(); }
  __int__() {
    if (this._special) throw new AdderError(this._special === 'F' ? 'OverflowError' : 'ValueError', this._special === 'F' ? 'cannot convert Infinity to integer' : 'cannot convert NaN to integer');
    const v = this._exp >= 0 ? this._coeff * _nmPow10(this._exp) : this._coeff / _nmPow10(-this._exp);
    return _nmInt(this._sign ? -v : v);
  }
  __trunc__() { return this.__int__(); }
  __floor__() { return this.to_integral_value({ _kw: true, rounding: 'ROUND_FLOOR' }).__int__(); }
  __ceil__() { return this.to_integral_value({ _kw: true, rounding: 'ROUND_CEILING' }).__int__(); }
  __round__(nd) {
    if (nd === undefined || nd === null) return this.to_integral_value({ _kw: true, rounding: 'ROUND_HALF_EVEN' }).__int__();
    return this.quantize(_nmDec(0, 1n, -nd), 'ROUND_HALF_EVEN');
  }
  __hash__() {
    if (this._special) return _pyHash(this.valueOf());
    const [n, d] = this._ratio();
    return d === 1n ? _pyHash(_nmInt(n)) : _pyHash(_nmToFloat(n, d));
  }
  __bool__() { return !this._isZero(); }
  __neg__() { return _nmFix(_nmDec(this._special ? this._sign ^ 1 : (this._coeff === 0n ? 0 : this._sign ^ 1), this._coeff, this._exp, this._special)); }
  __pos__() { return _nmFix(_nmDec(this._coeff === 0n && !this._special ? 0 : this._sign, this._coeff, this._exp, this._special)); }
  __abs__() { return _nmFix(_nmDec(0, this._coeff, this._exp, this._special)); }
  copy_abs() { return _nmDec(0, this._coeff, this._exp, this._special); }
  copy_negate() { return _nmDec(this._sign ^ 1, this._coeff, this._exp, this._special); }
  is_nan() { return this._special === 'n' || this._special === 'N'; }
  is_infinite() { return this._special === 'F'; }
  is_finite() { return !this._special; }
  is_zero() { return this._isZero(); }
  is_signed() { return this._sign === 1; }
  adjusted() { return this._special ? 0 : this._exp + _nmDigits(this._coeff) - 1; }
  as_tuple() {
    const digits = this._special ? (this._special === 'F' ? [0] : []) : [...this._coeff.toString()].map(Number);
    return _nmDecimalTuple(this._sign, mkTuple(digits), this._special ? this._special : this._exp);
  }
  as_integer_ratio() {
    if (this._special) throw new AdderError(this._special === 'F' ? 'OverflowError' : 'ValueError', 'cannot convert to integer ratio');
    const [n, d] = this._ratio(); return mkTuple([_nmInt(n), _nmInt(d)]);
  }
  _bin(o, op) {
    const b = _nmCoerce(o, op);
    if (b === null) return _nmNotImpl;
    return b;
  }
  __add__(o) { const b = this._bin(o, '+'); return b === _nmNotImpl ? b : _nmAdd(this, b); }
  __radd__(o) { const b = this._bin(o, '+'); return b === _nmNotImpl ? b : _nmAdd(b, this); }
  __sub__(o) { const b = this._bin(o, '-'); return b === _nmNotImpl ? b : _nmAdd(this, b.copy_negate()); }
  __rsub__(o) { const b = this._bin(o, '-'); return b === _nmNotImpl ? b : _nmAdd(b, this.copy_negate()); }
  __mul__(o) { const b = this._bin(o, '*'); return b === _nmNotImpl ? b : _nmMul(this, b); }
  __rmul__(o) { const b = this._bin(o, '*'); return b === _nmNotImpl ? b : _nmMul(b, this); }
  __truediv__(o) { const b = this._bin(o, '/'); return b === _nmNotImpl ? b : _nmDiv(this, b); }
  __rtruediv__(o) { const b = this._bin(o, '/'); return b === _nmNotImpl ? b : _nmDiv(b, this); }
  __floordiv__(o) { const b = this._bin(o, '//'); return b === _nmNotImpl ? b : _nmDivInt(this, b)[0]; }
  __rfloordiv__(o) { const b = this._bin(o, '//'); return b === _nmNotImpl ? b : _nmDivInt(b, this)[0]; }
  __mod__(o) { const b = this._bin(o, '%'); return b === _nmNotImpl ? b : _nmDivInt(this, b)[1]; }
  __rmod__(o) { const b = this._bin(o, '%'); return b === _nmNotImpl ? b : _nmDivInt(b, this)[1]; }
  __divmod__(o) { const b = this._bin(o, 'divmod()'); return b === _nmNotImpl ? b : mkTuple(_nmDivInt(this, b)); }
  __pow__(o) { const b = this._bin(o, '**'); return b === _nmNotImpl ? b : _nmPow(this, b); }
  __rpow__(o) { const b = this._bin(o, '**'); return b === _nmNotImpl ? b : _nmPow(b, this); }
  _cmp(o) {
    let b;
    if (o instanceof _NmDecimal) b = o;
    else if (_nmIsInt(o)) b = new _NmDecimal(o);
    else if (typeof o === 'number') b = new _NmDecimal(o);
    else if (o instanceof _NmFraction) { if (this._special) return this._special === 'F' ? (this._sign ? -1 : 1) : NaN; const [n, d] = this._ratio(); const l = n * o._d, r = o._n * d; return l < r ? -1 : l > r ? 1 : 0; }
    else return null;
    if (this.is_nan() || b.is_nan()) return NaN;
    if (this._special || b._special) {
      const v = (x) => (x._special === 'F' ? (x._sign ? -Infinity : Infinity) : 0);
      const av = this._special ? v(this) : 0, bv = b._special ? v(b) : 0;
      if (this._special && b._special) return av === bv ? 0 : av < bv ? -1 : 1;
      return this._special ? (av < 0 ? -1 : 1) : (bv < 0 ? 1 : -1);
    }
    const [an, ad] = this._ratio(), [bn, bd] = b._ratio();
    const l = an * bd, r = bn * ad;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  __eq__(o) { const c = this._cmp(o); return c === null ? _nmNotImpl : c === 0; }
  __lt__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('<', this, o); if (Number.isNaN(c)) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]"); return c < 0; }
  __le__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('<=', this, o); if (Number.isNaN(c)) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]"); return c <= 0; }
  __gt__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('>', this, o); if (Number.isNaN(c)) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]"); return c > 0; }
  __ge__(o) { const c = this._cmp(o); if (c === null) throw _nmCmpErr('>=', this, o); if (Number.isNaN(c)) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]"); return c >= 0; }
  compare(o) { const c = this._cmp(o); return Number.isNaN(c) ? _nmDec(0, 0n, 0, 'n') : new _NmDecimal(c); }
  max(o) { return this._cmp(o) >= 0 ? this : new _NmDecimal(o); }
  min(o) { return this._cmp(o) <= 0 ? this : new _NmDecimal(o); }
  quantize(exp, ...a) {
    const kw = _nmKw(a);
    const rounding = (kw && _nmHas(kw, 'rounding') ? kw.rounding : a[0]) || _nmCtx.rounding;
    const target = exp instanceof _NmDecimal ? exp : new _NmDecimal(exp);
    if (this._special || target._special) {
      if (this.is_nan() || target.is_nan()) return _nmDec(0, 0n, 0, 'n');
      if (this._special === 'F' && target._special === 'F') return this;
      throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]");
    }
    const coeff = _nmRoundDrop(this._coeff, target._exp - this._exp, rounding, this._sign);
    if (_nmDigits(coeff) > _nmCtx.prec) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]");
    return _nmDec(this._sign, coeff, target._exp);
  }
  to_integral_value(...a) {
    const kw = _nmKw(a);
    const rounding = (kw && _nmHas(kw, 'rounding') ? kw.rounding : a[0]) || _nmCtx.rounding;
    if (this._special || this._exp >= 0) return this;
    return _nmDec(this._sign, _nmRoundDrop(this._coeff, -this._exp, rounding, this._sign), 0);
  }
  to_integral(...a) { return this.to_integral_value(...a); }
  to_integral_exact(...a) { return this.to_integral_value(...a); }
  normalize() {
    if (this._special) return this;
    const d = _nmFix(this);
    if (d._coeff === 0n) return _nmDec(d._sign, 0n, 0);
    let c = d._coeff, e = d._exp;
    while (c % 10n === 0n) { c /= 10n; e += 1; }
    return _nmDec(d._sign, c, e);
  }
  sqrt() {
    if (this._special) { if (this.is_nan() || !this._sign) return this; throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]"); }
    if (this._coeff === 0n) return _nmDec(this._sign, 0n, this._exp >> 1);
    if (this._sign) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]");
    // CPython's _pydecimal algorithm
    const prec = _nmCtx.prec + 1;
    let e = this._exp >> 1, c, l;
    if (this._exp & 1) { c = this._coeff * 10n; l = (_nmDigits(this._coeff) >> 1) + 1; } else { c = this._coeff; l = (_nmDigits(this._coeff) + 1) >> 1; }
    const shift = prec - l;
    let exact;
    if (shift >= 0) { c *= 100n ** BigInt(shift); exact = true; } else { const p = 100n ** BigInt(-shift); exact = c % p === 0n; c /= p; }
    e -= shift;
    let n = _nmPow10(prec);
    for (;;) { const q = c / n; if (n <= q) break; n = (n + q) >> 1n; }
    exact = exact && n * n === c;
    if (exact) { if (shift >= 0) n /= _nmPow10(shift); else n *= _nmPow10(-shift); e += shift; }
    else if (n % 5n === 0n) n += 1n;
    return _nmFix(_nmDec(0, n, e), 'ROUND_HALF_EVEN');
  }
  exp() { return new _NmDecimal(Math.exp(this.valueOf())).__pos__(); }
  ln() { return new _NmDecimal(Math.log(this.valueOf())).__pos__(); }
  log10() { return new _NmDecimal(Math.log10(this.valueOf())).__pos__(); }
  scaleb(n) { return _nmFix(_nmDec(this._sign, this._coeff, this._exp + Number(n), this._special)); }
  fma(b, c) { return _nmAdd(_nmMul(this, new _NmDecimal(b), true), new _NmDecimal(c)); }
}
const _nmDec = (sign, coeff, exp, special = null) => { const d = Object.create(_NmDecimal.prototype); d._sign = sign; d._coeff = coeff; d._exp = exp; d._special = special; return d; };
// round to the context's precision
function _nmFix(d, rounding) {
  if (d._special) return d;
  const digits = _nmDigits(d._coeff);
  if (digits <= _nmCtx.prec) return d;
  const drop = digits - _nmCtx.prec;
  let c = _nmRoundDrop(d._coeff, drop, rounding || _nmCtx.rounding, d._sign), e = d._exp + drop;
  if (_nmDigits(c) > _nmCtx.prec) { c /= 10n; e += 1; }
  return _nmDec(d._sign, c, e);
}
function _nmCoerce(o, op) {
  if (o instanceof _NmDecimal) return o;
  if (_nmIsInt(o)) return new _NmDecimal(o);
  if (typeof o === 'number') throw new AdderError('TypeError', `unsupported operand type(s) for ${op}: 'decimal.Decimal' and 'float'`);
  return null;
}
const _nmInvalid = () => new AdderError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]");
function _nmAdd(a, b) {
  if (a.is_nan() || b.is_nan()) return _nmDec(0, 0n, 0, 'n');
  if (a._special === 'F' || b._special === 'F') {
    if (a._special === 'F' && b._special === 'F' && a._sign !== b._sign) throw _nmInvalid();
    return a._special === 'F' ? a : b;
  }
  const e = Math.min(a._exp, b._exp);
  const av = (a._sign ? -1n : 1n) * a._coeff * _nmPow10(a._exp - e);
  const bv = (b._sign ? -1n : 1n) * b._coeff * _nmPow10(b._exp - e);
  const s = av + bv;
  let sign = s < 0n ? 1 : 0;
  if (s === 0n) sign = a._sign && b._sign ? 1 : (_nmCtx.rounding === 'ROUND_FLOOR' && (a._sign || b._sign) ? 1 : 0);
  return _nmFix(_nmDec(sign, _nmAbs(s), e));
}
function _nmMul(a, b, noFix) {
  const sign = a._sign ^ b._sign;
  if (a.is_nan() || b.is_nan()) return _nmDec(0, 0n, 0, 'n');
  if (a._special === 'F' || b._special === 'F') {
    if ((a._special !== 'F' && a._coeff === 0n) || (b._special !== 'F' && b._coeff === 0n)) throw _nmInvalid();
    return _nmDec(sign, 0n, 0, 'F');
  }
  const d = _nmDec(sign, a._coeff * b._coeff, a._exp + b._exp);
  return noFix ? d : _nmFix(d);
}
function _nmDiv(a, b) {
  const sign = a._sign ^ b._sign;
  if (a.is_nan() || b.is_nan()) return _nmDec(0, 0n, 0, 'n');
  if (a._special === 'F') { if (b._special === 'F') throw _nmInvalid(); return _nmDec(sign, 0n, 0, 'F'); }
  if (b._special === 'F') return _nmDec(sign, 0n, 0 - 1000000);
  if (b._coeff === 0n) {
    if (a._coeff === 0n) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.DivisionUndefined'>]");
    throw new AdderError('decimal.DivisionByZero', "[<class 'decimal.DivisionByZero'>]");
  }
  let coeff, exp;
  if (a._coeff === 0n) { exp = a._exp - b._exp; coeff = 0n; }
  else {
    const shift = _nmDigits(b._coeff) - _nmDigits(a._coeff) + _nmCtx.prec + 1;
    exp = a._exp - b._exp - shift;
    let rem;
    if (shift >= 0) { const n = a._coeff * _nmPow10(shift); coeff = n / b._coeff; rem = n % b._coeff; }
    else { const dd = b._coeff * _nmPow10(-shift); coeff = a._coeff / dd; rem = a._coeff % dd; }
    if (rem) { if (coeff % 5n === 0n) coeff += 1n; }
    else { const ideal = a._exp - b._exp; while (exp < ideal && coeff % 10n === 0n) { coeff /= 10n; exp += 1; } }
  }
  return _nmFix(_nmDec(sign, coeff, exp));
}
// a // b truncates toward zero (unlike int //), a % b takes the dividend's sign
function _nmDivInt(a, b) {
  if (a._special || b._special) throw _nmInvalid();
  if (b._coeff === 0n) {
    if (a._coeff === 0n) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.DivisionUndefined'>]");
    throw new AdderError('decimal.DivisionByZero', "[<class 'decimal.DivisionByZero'>]");
  }
  const e = Math.min(a._exp, b._exp);
  const av = a._coeff * _nmPow10(a._exp - e), bv = b._coeff * _nmPow10(b._exp - e);
  const q = av / bv, r = av % bv;
  if (_nmDigits(q) > _nmCtx.prec) throw new AdderError('decimal.InvalidOperation', "[<class 'decimal.DivisionImpossible'>]");
  return [_nmDec(a._sign ^ b._sign, q, 0), _nmFix(_nmDec(a._sign, r, e))];
}
function _nmPow(a, b) {
  if (!b._special && b._exp >= 0) {
    let e = b._coeff * _nmPow10(b._exp);
    if (b._sign) {
      if (a._coeff === 0n && !a._special) throw new AdderError('decimal.DivisionByZero', "[<class 'decimal.DivisionByZero'>]");
      const prec = _nmCtx.prec;
      _nmCtx.prec = prec + 10;
      let r;
      try { r = _nmDiv(_nmDec(0, 1n, 0), _nmPowInt(a, e)); } finally { _nmCtx.prec = prec; }
      return _nmFix(r);
    }
    return _nmFix(_nmPowInt(a, e));
  }
  return _nmFix(new _NmDecimal(Math.pow(a.valueOf(), b.valueOf())));
}
function _nmPowInt(a, e) {
  if (a._special) return e === 0n ? _nmDec(0, 1n, 0) : _nmDec(a._sign && (e & 1n) ? 1 : 0, 0n, 0, a._special);
  return _nmDec(a._sign && (e & 1n) ? 1 : 0, a._coeff ** e, a._exp * Number(e));
}
// format(Decimal, spec): fixed ('f'), percent ('%'), scientific ('e'), general / str; width,
// fill / align, sign, ',' / '_' grouping
function _nmDecFormat(d, spec) {
  const m = /^(?:(.)?([<>=^]))?([+\- ]?)(z?)(#?)(0?)(\d*)([,_]?)(?:\.(\d+))?([eEfFgG%n]?)$/.exec(spec);
  if (!m) throw new AdderError('ValueError', `Invalid format specifier '${spec}' for object of type 'decimal.Decimal'`);
  let [, fill, align, sign, , , zero, width, group, precS, type] = m;
  const prec = precS === undefined ? null : Number(precS);
  let v = d;
  let body;
  if (v._special) body = v._special === 'F' ? 'Infinity' : 'NaN';
  else if (type === 'f' || type === 'F' || type === '%') {
    if (type === '%') v = _nmDec(v._sign, v._coeff, v._exp + 2);
    if (prec !== null) v = v.quantize(_nmDec(0, 1n, -prec), 'ROUND_HALF_EVEN');
    const digits = v._coeff.toString();
    if (v._exp >= 0) body = digits + '0'.repeat(v._exp);
    else { const p = digits.padStart(-v._exp + 1, '0'); body = p.slice(0, p.length + v._exp) + '.' + p.slice(p.length + v._exp); }
    if (type === '%') body += '%';
  } else if (type === 'e' || type === 'E') {
    const digits = v._coeff.toString();
    const adj = v._exp + digits.length - 1;
    let mant = digits;
    if (prec !== null) { const r = _nmRoundDrop(v._coeff, digits.length - (prec + 1), 'ROUND_HALF_EVEN', v._sign).toString(); mant = r.length > prec + 1 ? r.slice(0, prec + 1) : r.padEnd(prec + 1, '0'); }
    body = (mant.length > 1 ? mant[0] + '.' + mant.slice(1) : mant) + type + (adj >= 0 ? '+' : '-') + String(Math.abs(adj));
  } else {
    body = _nmDec(0, v._coeff, v._exp).__str__();
  }
  if (group) { const [ip, fp] = body.split('.'); body = ip.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fp !== undefined ? '.' + fp : ''); }
  const neg = v._sign === 1;
  const signStr = neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  let out = signStr + body;
  const w = width ? Number(width) : 0;
  if (out.length < w) {
    if (zero && !align) { fill = '0'; align = '='; }
    const f = fill || ' ', pad = w - out.length;
    const al = align || '>';
    if (al === '<') out += f.repeat(pad);
    else if (al === '^') out = f.repeat(pad >> 1) + out + f.repeat(pad - (pad >> 1));
    else if (al === '=') out = signStr + f.repeat(pad) + body;
    else out = f.repeat(pad) + out;
  }
  return out;
}
const _nmDecimalTuple = _namedtuple('DecimalTuple', ['sign', 'digits', 'exponent']);
const _nmDecimalType = _nmType('Decimal', _NmDecimal, 'decimal');
_nmDecimalType.from_float = (f) => new _NmDecimal(f);
class _NmLocalContext {
  constructor(ctx, kw) { this._ctx = ctx; this._kw = kw; this._saved = null; }
  __enter__() {
    this._saved = _nmCtx;
    _nmCtx = (this._ctx || _nmCtx).copy();
    if (this._kw) for (const k of ['prec', 'rounding', 'Emin', 'Emax', 'capitals']) if (_nmHas(this._kw, k)) _nmCtx[k] = this._kw[k];
    return _nmCtx;
  }
  __exit__() { _nmCtx = this._saved; return false; }
}
_NmLocalContext.prototype.__adderClass__ = '_ContextManager';
adderModules.decimal = {
  Decimal: _nmDecimalType, Context: _nmType('Context', _NmContext, 'decimal'),
  getcontext: () => _nmCtx, setcontext: (c) => { _nmCtx = c; return null; },
  localcontext: (...a) => { const kw = _nmKw(a); return new _NmLocalContext(a[0] || (kw && kw.ctx) || null, kw); },
  DecimalException: _nmDecExc, InvalidOperation: _nmInvalidOp, DivisionByZero: _nmDivZero,
  ...Object.fromEntries(_NM_ROUNDINGS.map((r) => [r, r])),
  MAX_PREC: 999999999999999999, MAX_EMAX: 999999999999999999, MIN_EMIN: -999999999999999999,
};
Object.defineProperty(adderModules.decimal, 'DefaultContext', { get: () => _nmCtx, enumerable: true });

// ── statistics ──
// CPython's algorithms: means and the sum of squares exact (rationals), stdev as the correctly
// rounded square root of a fraction, quantiles / median_grouped / correlation / covariance /
// linear_regression as written in statistics.py, and NormalDist. Not here: kde, kde_random.
const _nmStatErr = makeExcType('statistics.StatisticsError', 'ValueError');
const _nmStatFail = (msg) => new AdderError('statistics.StatisticsError', msg);
// the result type of a sum: int, float, Fraction or Decimal (as statistics._coerce)
function _nmKind(values) {
  let k = 'int';
  for (const v of values) {
    const t = v instanceof _NmFraction ? 'Fraction' : v instanceof _NmDecimal ? 'Decimal' : (typeof v === 'number' && !isIntNum(v)) ? 'float' : _nmIsInt(v) ? 'int' : null;
    if (t === null) throw new AdderError('TypeError', `can't convert type '${pyTypeName(v)}' to numerator/denominator`);
    if (t === 'int') continue;
    if (k === 'int') k = t;
    else if (k !== t) {
      if ((k === 'Fraction' && t === 'float') || (k === 'float' && t === 'Fraction')) k = 'float';
      else throw new AdderError('TypeError', `can't convert type '${t}' to '${k}'`);
    }
  }
  return k;
}
// a rational result, converted to the data's type (statistics._convert)
function _nmConvert([n, d], kind) {
  if (kind === 'Fraction') return _nmFrac(n, d);
  if (kind === 'Decimal') return _nmDiv(new _NmDecimal(_nmInt(n)), new _NmDecimal(_nmInt(d)));
  if (kind === 'int' && d === 1n) return _nmInt(n);
  return _nmToFloat(n, d);
}
// sum of the data, exactly; non-finite values propagate as in CPython
function _nmSum(values) {
  let acc = [0n, 1n], special = null;
  for (const v of values) {
    const r = _nmExact(v);
    if (r === null) { special = special === null ? Number(v) : special + Number(v); continue; }
    acc = _nmRadd(acc, r);
  }
  return { acc, special };
}
const _nmData = async (data) => {
  const xs = await pyCollect(data);
  return xs;
};
async function _nmMean(data) {
  const xs = await _nmData(data);
  if (!xs.length) throw _nmStatFail('mean requires at least one data point');
  const kind = _nmKind(xs);
  const { acc, special } = _nmSum(xs);
  if (special !== null) return special;
  return _nmConvert(_nmRat(acc[0], acc[1] * BigInt(xs.length)), kind);
}
// sum of squared deviations, exact (statistics._ss)
function _nmSS(xs, c) {
  const kind = _nmKind(xs);
  const n = BigInt(xs.length);
  if (c !== undefined && c !== null) {
    let acc = [0n, 1n];
    for (const x of xs) {
      const dv = pySub(x, c);
      const sq = pyMul(dv, dv);
      const r = _nmExact(sq);
      if (r === null) return { kind, ss: null, special: Number(sq) };
      acc = _nmRadd(acc, r);
    }
    return { kind, ss: acc, mean: _nmExact(c) };
  }
  let sx = [0n, 1n], sxx = [0n, 1n];
  for (const x of xs) {
    const r = _nmExact(x);
    if (r === null) return { kind, ss: null, special: Number(x) };
    sx = _nmRadd(sx, r);
    sxx = _nmRadd(sxx, _nmRmul(r, r));
  }
  // (n * sxx - sx * sx) / n — poor for floats, exact for fractions
  const ss = _nmRat(n * sxx[0] * sx[1] * sx[1] - sx[0] * sx[0] * sxx[1], n * sxx[1] * sx[1] * sx[1]);
  return { kind, ss, mean: _nmRat(sx[0], sx[1] * n) };
}
// sqrt(n / m) correctly rounded (statistics._float_sqrt_of_frac)
const _nmIsqrt = (n) => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); if (x === 0n) x = 1n; for (;;) { const y = (x + n / x) >> 1n; if (y >= x) { while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; } x = y; } };
function _nmSqrtOfFrac(n, m) {
  const rto = (a, b) => { const r = _nmIsqrt(a / b); return r | (r * r * b !== a ? 1n : 0n); };
  const q = Math.floor((_nmBitlen(n) - _nmBitlen(m) - 109) / 2);
  if (q >= 0) return _nmToFloat(rto(n, m << BigInt(2 * q)) << BigInt(q), 1n);
  return _nmToFloat(rto(n << BigInt(-2 * q), m), 1n << BigInt(-q));
}
function _nmDecSqrt(dec) { return dec.sqrt(); }
async function _nmVariance(data, xbar, population) {
  const xs = await _nmData(data);
  const n = xs.length;
  if (population ? n < 1 : n < 2) throw _nmStatFail(population ? 'pvariance requires at least one data point' : 'variance requires at least two data points');
  const r = _nmSS(xs, xbar);
  if (r.ss === null) return { kind: r.kind, special: r.special };
  const div = BigInt(population ? n : n - 1);
  return { kind: r.kind, v: _nmRat(r.ss[0], r.ss[1] * div) };
}
const _nmVarOut = (r) => (r.special !== undefined ? r.special : _nmConvert(r.v, r.kind));
const _nmStdOut = (r) => {
  if (r.special !== undefined) return Math.sqrt(r.special);
  if (r.kind === 'Decimal') return _nmDecSqrt(_nmConvert(r.v, 'Decimal'));
  return _nmSqrtOfFrac(r.v[0], r.v[1]);
};
async function _nmSortedData(data) { return pySorted(await pyCollect(data), null, false); }
const _nmFsum = (xs) => adderModules.math.fsum(xs);
// sum((x - xbar) * (y - ybar)) the way statistics computes it (fsum means, sumprod of deviations)
function _nmDevs(xs) { const m = _nmFsum(xs) / xs.length; return xs.map((x) => x - m); }
function _nmSqrtprod(x, y) {
  const h = Math.sqrt(x * y);
  if (!Number.isFinite(h)) {
    if (h === Infinity && Number.isFinite(x) && Number.isFinite(y)) { const s = 2.0 ** -512; return _nmSqrtprod(s * x, s * y) / s; }
    return h;
  }
  if (!h) { if (x && y) { const s = 2.0 ** 537; return _nmSqrtprod(s * x, s * y) / s; } return h; }
  const d = _nmSumprod([x, h], [y, -h]);
  return h + d / (2.0 * h);
}
// the inverse normal CDF: Wichura's AS241 (statistics._normal_dist_inv_cdf)
function _nmInvCdf(p, mu, sigma) {
  const q = p - 0.5;
  let num, den, x;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    num = (((((((2.5090809287301226727e+3 * r + 3.3430575583588128105e+4) * r + 6.7265770927008700853e+4) * r +
      4.5921953931549871457e+4) * r + 1.3731693765509461125e+4) * r + 1.9715909503065514427e+3) * r +
      1.3314166789178437745e+2) * r + 3.3871328727963666080e+0) * q;
    den = (((((((5.2264952788528545610e+3 * r + 2.8729085735721942674e+4) * r + 3.9307895800092710610e+4) * r +
      2.1213794301586595867e+4) * r + 5.3941960214247511077e+3) * r + 6.8718700749205790830e+2) * r +
      4.2313330701600911252e+1) * r + 1.0);
    x = num / den;
    return mu + (x * sigma);
  }
  let r = q <= 0.0 ? p : 1.0 - p;
  r = Math.sqrt(-Math.log(r));
  if (r <= 5.0) {
    r = r - 1.6;
    num = (((((((7.7454501427834140764e-4 * r + 2.27238449892691845833e-2) * r + 2.41780725177450611770e-1) * r +
      1.27045825245236838258e+0) * r + 3.64784832476320460504e+0) * r + 5.76949722146069140550e+0) * r +
      4.63033784615654529590e+0) * r + 1.42343711074968357734e+0);
    den = (((((((1.05075007164441684324e-9 * r + 5.47593808499534494600e-4) * r + 1.51986665636164571966e-2) * r +
      1.48103976427480074590e-1) * r + 6.89767334985100004550e-1) * r + 1.67638483018380384940e+0) * r +
      2.05319162663775882187e+0) * r + 1.0);
  } else {
    r = r - 5.0;
    num = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.24266094738807843860e-3) * r +
      2.65321895265761230930e-2) * r + 2.96560571828504891230e-1) * r + 1.78482653991729133580e+0) * r +
      5.46378491116411436990e+0) * r + 6.65790464350110377720e+0);
    den = (((((((2.04426310338993978564e-15 * r + 1.42151175831644588870e-7) * r + 1.84631831751005468180e-5) * r +
      7.86869131145613259100e-4) * r + 1.48753612908506148525e-2) * r + 1.36929880922735805310e-1) * r +
      5.99832206555887937690e-1) * r + 1.0);
  }
  x = num / den;
  if (q < 0.0) x = -x;
  return mu + (x * sigma);
}
class _NmNormalDist {
  constructor(mu = 0.0, sigma = 1.0) {
    if (mu !== null && typeof mu === 'object' && mu._kw) { const kw = mu; mu = kw.mu ?? 0.0; sigma = kw.sigma ?? 1.0; }
    else if (sigma !== null && typeof sigma === 'object' && sigma._kw) sigma = sigma.sigma ?? 1.0;
    if (sigma < 0.0) throw _nmStatFail('sigma must be non-negative');
    this._mu = Number(mu); this._sigma = Number(sigma);
  }
  get mean() { return this._mu; }
  get median() { return this._mu; }
  get mode() { return this._mu; }
  get stdev() { return this._sigma; }
  get variance() { return this._sigma * this._sigma; }
  pdf(x) {
    const variance = this._sigma * this._sigma;
    if (!variance) throw _nmStatFail('pdf() not defined when sigma is zero');
    const diff = x - this._mu;
    return Math.exp(diff * diff / (-2.0 * variance)) / Math.sqrt(2 * Math.PI * variance);
  }
  cdf(x) {
    if (!this._sigma) throw _nmStatFail('cdf() not defined when sigma is zero');
    return 0.5 * _nmErfc((this._mu - x) / (this._sigma * Math.SQRT2));
  }
  inv_cdf(p) {
    if (p <= 0.0 || p >= 1.0) throw _nmStatFail('p must be in the range 0.0 < p < 1.0');
    return _nmInvCdf(p, this._mu, this._sigma);
  }
  quantiles(n = 4) { if (n && n._kw) n = n.n ?? 4; return Array.from({ length: n - 1 }, (_, i) => this.inv_cdf((i + 1) / n)); }
  zscore(x) { if (!this._sigma) throw _nmStatFail('zscore() not defined when sigma is zero'); return (x - this._mu) / this._sigma; }
  overlap(other) {
    if (!(other instanceof _NmNormalDist)) throw new AdderError('TypeError', 'Expected another NormalDist instance');
    let X = this, Y = other;
    if (Y._sigma < X._sigma || (Y._sigma === X._sigma && Y._mu < X._mu)) [X, Y] = [Y, X];   // sorted, so overlap commutes
    const X_var = X.variance, Y_var = Y.variance;
    if (!X_var || !Y_var) throw _nmStatFail('overlap() not defined when sigma is zero');
    const dv = Y_var - X_var;
    const dm = Math.abs(Y._mu - X._mu);
    if (!dv) return _nmErfc(dm / (2.0 * X._sigma * Math.SQRT2));
    const a = X._mu * Y_var - Y._mu * X_var;
    const b = X._sigma * Y._sigma * Math.sqrt(dm * dm + dv * Math.log(Y_var / X_var));
    const x1 = (a + b) / dv;
    const x2 = (a - b) / dv;
    return 1.0 - (Math.abs(Y.cdf(x1) - X.cdf(x1)) + Math.abs(Y.cdf(x2) - X.cdf(x2)));
  }
  samples(n, ...a) {
    const kw = _nmKw(a);
    const seed = kw && _nmHas(kw, 'seed') ? kw.seed : a[0] ?? null;
    const rnd = seed === null ? Math.random : adderModules.random && adderModules.random.Random ? (() => { const g = adderModules.random.Random(seed); return () => g.random(); })() : Math.random;
    return Array.from({ length: n }, () => this.inv_cdf(rnd() || Number.MIN_VALUE));
  }
  __add__(o) { return o instanceof _NmNormalDist ? new _NmNormalDist(this._mu + o._mu, Math.hypot(this._sigma, o._sigma)) : new _NmNormalDist(this._mu + o, this._sigma); }
  __radd__(o) { return this.__add__(o); }
  __sub__(o) { return o instanceof _NmNormalDist ? new _NmNormalDist(this._mu - o._mu, Math.hypot(this._sigma, o._sigma)) : new _NmNormalDist(this._mu - o, this._sigma); }
  __rsub__(o) { return new _NmNormalDist(o - this._mu, this._sigma); }
  __mul__(o) { return new _NmNormalDist(this._mu * o, this._sigma * Math.abs(o)); }
  __rmul__(o) { return this.__mul__(o); }
  __truediv__(o) { return new _NmNormalDist(this._mu / o, this._sigma / Math.abs(o)); }
  __pos__() { return new _NmNormalDist(this._mu, this._sigma); }
  __neg__() { return new _NmNormalDist(-this._mu, this._sigma); }
  __eq__(o) { return o instanceof _NmNormalDist ? this._mu === o._mu && this._sigma === o._sigma : false; }
  __hash__() { return _pyHash(mkTuple([this._mu, this._sigma])); }
  __repr__() { return `NormalDist(mu=${_nmFloatRepr(this._mu)}, sigma=${_nmFloatRepr(this._sigma)})`; }
}
const _nmNormalDistType = _nmType('NormalDist', _NmNormalDist, 'statistics');
_nmNormalDistType.from_samples = async (data) => {
  const xs = await pyCollect(data);
  const xbar = _nmFsum(xs) / xs.length;
  const r = await _nmVariance(xs, null, false);
  return new _NmNormalDist(xbar, _nmStdOut(r));
};
const _nmLinReg = _namedtuple('LinearRegression', ['slope', 'intercept']);
function _nmPairs(x, y, need) {
  const xs = [...pyIter(x)], ys = [...pyIter(y)];
  if (xs.length !== ys.length) throw _nmStatFail(need === 'linear_regression' ? 'linear regression requires that both inputs have same number of data points' : `${need} requires that both inputs have same number of data points`);
  if (xs.length < 2) throw _nmStatFail(need === 'linear_regression' ? 'linear regression requires at least two data points' : `${need} requires at least two data points`);
  return [xs.map(Number), ys.map(Number)];
}
async function _nmMedianLowHigh(data, which) {
  const xs = await _nmSortedData(data);
  const n = xs.length;
  if (!n) throw _nmStatFail('no median for empty data');
  if (n % 2 === 1) return xs[n >> 1];
  return which === 'low' ? xs[(n >> 1) - 1] : xs[n >> 1];
}
function _nmRank(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}
adderModules.statistics = {
  StatisticsError: _nmStatErr,
  NormalDist: _nmNormalDistType,
  mean: _nmMean,
  fmean: async (data, ...a) => {
    const kw = _nmKw(a);
    const weights = kw && _nmHas(kw, 'weights') ? kw.weights : a[0] ?? null;
    const xs = (await pyCollect(data)).map(Number);
    if (weights === null) {
      if (!xs.length) throw _nmStatFail('fmean requires at least one data point');
      return _nmFsum(xs) / xs.length;
    }
    const ws = (await pyCollect(weights)).map(Number);
    if (ws.length !== xs.length) throw _nmStatFail('data and weights must be the same length');
    const wsum = _nmFsum(ws);
    if (!wsum) throw _nmStatFail('sum of weights must be non-zero');
    return _nmSumprod(xs, ws) / wsum;
  },
  geometric_mean: async (data) => {
    let n = 0, foundZero = false;
    const logs = [];
    for (const x of await pyCollect(data)) {
      const v = Number(x);
      if (v > 0) { n++; logs.push(Math.log(v)); }
      else if (v === 0) { n++; foundZero = true; }
      else throw _nmStatFail('No negative inputs allowed');
    }
    const total = _nmFsum(logs);
    if (!n) throw _nmStatFail('Must have a non-empty dataset');
    if (Number.isNaN(total)) return NaN;
    if (foundZero) return total === Infinity ? NaN : 0.0;
    return Math.exp(total / n);
  },
  harmonic_mean: async (data, ...a) => {
    const kw = _nmKw(a);
    const weights = kw && _nmHas(kw, 'weights') ? kw.weights : a[0] ?? null;
    const xs = await pyCollect(data);
    const n = xs.length;
    if (n < 1) throw _nmStatFail('harmonic_mean requires at least one data point');
    if (n === 1 && weights === null) { if (Number(xs[0]) < 0) throw _nmStatFail('harmonic mean does not support negative values'); return xs[0]; }
    const ws = weights === null ? xs.map(() => 1) : await pyCollect(weights);
    if (ws.length !== n) throw _nmStatFail('Number of weights does not match data size');
    let sumW = [0n, 1n];
    for (const w of ws) sumW = _nmRadd(sumW, _nmExact(w));
    const terms = [];
    for (let i = 0; i < n; i++) {
      if (Number(xs[i]) < 0) throw _nmStatFail('harmonic mean does not support negative values');
      if (!ws[i]) { terms.push(0); continue; }
      if (Number(xs[i]) === 0) return 0;
      terms.push(pyTrueDiv(ws[i], xs[i]));
    }
    const kind = _nmKind([...xs, ...ws]);
    const { acc } = _nmSum(terms);
    if (acc[0] <= 0n) throw _nmStatFail('Weighted sum must be positive');
    return _nmConvert(_nmRat(sumW[0] * acc[1], sumW[1] * acc[0]), kind === 'int' ? 'float' : kind);
  },
  median: async (data) => {
    const xs = await _nmSortedData(data);
    const n = xs.length;
    if (!n) throw _nmStatFail('no median for empty data');
    if (n % 2 === 1) return xs[n >> 1];
    const i = n >> 1;
    return pyTrueDiv(pyAdd(xs[i - 1], xs[i]), 2);
  },
  median_low: (data) => _nmMedianLowHigh(data, 'low'),
  median_high: (data) => _nmMedianLowHigh(data, 'high'),
  median_grouped: async (data, ...a) => {
    const kw = _nmKw(a);
    let interval = kw && _nmHas(kw, 'interval') ? kw.interval : a[0] ?? 1.0;
    const xs = await _nmSortedData(data);
    const n = xs.length;
    if (!n) throw _nmStatFail('no median for empty data');
    let x = xs[n >> 1];
    let i = 0; while (i < n && pyLt(xs[i], x) === true) i++;
    let j = i; while (j < n && !(pyLt(x, xs[j]) === true)) j++;
    interval = Number(interval); x = Number(x);
    const L = x - interval / 2.0;
    return L + interval * (n / 2 - i) / (j - i);
  },
  mode: async (data) => {
    const xs = await pyCollect(data);
    if (!xs.length) throw _nmStatFail('no mode for empty data');
    const counts = new PyDict();
    for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
    let best = null, bc = 0;
    for (const [k, c] of counts) if (c > bc) { best = k; bc = c; }
    return best;
  },
  multimode: async (data) => {
    const counts = new PyDict();
    for (const x of await pyCollect(data)) counts.set(x, (counts.get(x) || 0) + 1);
    const max = Math.max(0, ...counts.values());
    return [...counts].filter(([, c]) => c === max).map(([k]) => k);
  },
  variance: async (data, xbar = null) => _nmVarOut(await _nmVariance(data, xbar && xbar._kw ? xbar.xbar ?? null : xbar, false)),
  pvariance: async (data, mu = null) => _nmVarOut(await _nmVariance(data, mu && mu._kw ? mu.mu ?? null : mu, true)),
  stdev: async (data, xbar = null) => _nmStdOut(await _nmVariance(data, xbar && xbar._kw ? xbar.xbar ?? null : xbar, false)),
  pstdev: async (data, mu = null) => _nmStdOut(await _nmVariance(data, mu && mu._kw ? mu.mu ?? null : mu, true)),
  quantiles: async (data, ...a) => {
    const kw = _nmKw(a) || {};
    const n = _nmHas(kw, 'n') ? kw.n : 4;
    const method = _nmHas(kw, 'method') ? kw.method : 'exclusive';
    if (n < 1) throw _nmStatFail('n must be at least 1');
    const xs = await _nmSortedData(data);
    const ld = xs.length;
    if (ld < 2) { if (ld === 1) return Array(n - 1).fill(xs[0]); throw _nmStatFail('must have at least one data point'); }
    const out = [];
    if (method === 'inclusive') {
      const m = ld - 1;
      for (let i = 1; i < n; i++) { const j = Math.floor(i * m / n), delta = (i * m) % n; out.push(pyTrueDiv(pyAdd(pyMul(xs[j], n - delta), pyMul(xs[j + 1], delta)), n)); }
      return out;
    }
    if (method === 'exclusive') {
      const m = ld + 1;
      for (let i = 1; i < n; i++) {
        let j = Math.floor(i * m / n);
        j = j < 1 ? 1 : j > ld - 1 ? ld - 1 : j;
        const delta = i * m - j * n;
        out.push(pyTrueDiv(pyAdd(pyMul(xs[j - 1], n - delta), pyMul(xs[j], delta)), n));
      }
      return out;
    }
    throw new AdderError('ValueError', `Unknown method: ${pyRepr(method)}`);
  },
  covariance: (x, y) => {
    const [xs, ys] = _nmPairs(x, y, 'covariance');
    return _nmSumprod(_nmDevs(xs), _nmDevs(ys)) / (xs.length - 1);
  },
  correlation: (x, y, ...a) => {
    const kw = _nmKw(a);
    const method = kw && _nmHas(kw, 'method') ? kw.method : a[0] ?? 'linear';
    let [xs, ys] = _nmPairs(x, y, 'correlation');
    if (method === 'ranked') { xs = _nmRank(xs); ys = _nmRank(ys); }
    else if (method !== 'linear') throw new AdderError('ValueError', `Unknown method: ${pyRepr(method)}`);
    const dx = _nmDevs(xs), dy = _nmDevs(ys);
    const sxy = _nmSumprod(dx, dy), sxx = _nmSumprod(dx, dx), syy = _nmSumprod(dy, dy);
    if (!sxx || !syy) throw _nmStatFail('at least one of the inputs is constant');
    return sxy / _nmSqrtprod(sxx, syy);
  },
  linear_regression: (x, y, ...a) => {
    const kw = _nmKw(a);
    const proportional = !!(kw && _nmHas(kw, 'proportional') ? kw.proportional : false);
    const [xs, ys] = _nmPairs(x, y, 'linear_regression');
    let sxy, sxx, xbar = 0, ybar = 0;
    if (!proportional) { xbar = _nmFsum(xs) / xs.length; ybar = _nmFsum(ys) / ys.length; const dx = xs.map((v) => v - xbar), dy = ys.map((v) => v - ybar); sxy = _nmSumprod(dx, dy); sxx = _nmSumprod(dx, dx); }
    else { sxy = _nmSumprod(xs, ys); sxx = _nmSumprod(xs, xs); }
    if (!sxx) throw _nmStatFail('x is constant');
    const slope = sxy / sxx;
    return _nmLinReg(slope, ybar - slope * xbar);
  },
};
