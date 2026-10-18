// adder stdlib — cmath: CPython's Modules/cmathmodule.c, function by function. The same
// algorithms (the large-argument and subnormal rescalings, the log1p path near |z| = 1, the
// branch-cut continuity through signed zeros) and C99 Annex G's special values, as CPython's
// 7×7 tables indexed by the kind of the real and imaginary parts. errno is a module variable:
// EDOM is "math domain error" (ValueError), ERANGE "math range error" (OverflowError).
//
// Concat-bundled with the rest of adder: top-level names carry a `_cm` prefix.

import { AdderError, Complex, adderModules, mkTuple, pyTypeName, syncOf, _cAbs, _cErr, _cQuot, _copysign } from './builtins.js';

const _CM_DBL_MAX = Number.MAX_VALUE, _CM_DBL_MIN = 2.2250738585072014e-308, _CM_MANT_DIG = 53;
const _CM_LARGE_DOUBLE = _CM_DBL_MAX / 4;
const _CM_SQRT_LARGE_DOUBLE = Math.sqrt(_CM_LARGE_DOUBLE);
const _CM_LOG_LARGE_DOUBLE = Math.log(_CM_LARGE_DOUBLE);
const _CM_SQRT_DBL_MIN = Math.sqrt(_CM_DBL_MIN);
const _CM_SCALE_UP = 2 * Math.floor(_CM_MANT_DIG / 2) + 1;   // 53
const _CM_SCALE_DOWN = -Math.floor((_CM_SCALE_UP + 1) / 2);   // -27
const _CM_LN2 = Math.LN2, _CM_LN10 = Math.LN10, _CM_PI = Math.PI, _CM_E = Math.E;
const _CM_EDOM = 1, _CM_ERANGE = 2;
let _cmErrno = 0;

const _cmCopysign = _copysign;
const _cmLdexp = (x, n) => x * 2 ** n;
const _cmFinite = Number.isFinite, _cmIsNaN = Number.isNaN;
const _cmIsInf = (x) => x === Infinity || x === -Infinity;

// the kind of a double, the special-value tables' index
function _cmST(d) {
  if (_cmFinite(d)) {
    if (d !== 0) return _cmCopysign(1, d) === 1 ? 4 : 1;   // ST_POS / ST_NEG
    return _cmCopysign(1, d) === 1 ? 3 : 2;   // ST_PZERO / ST_NZERO
  }
  if (_cmIsNaN(d)) return 6;   // ST_NAN
  return _cmCopysign(1, d) === 1 ? 5 : 0;   // ST_PINF / ST_NINF
}

// The tables, rows by the real part's kind (−inf, −x, −0, +0, +x, +inf, nan), columns by the
// imaginary part's. U: a cell no argument reaches (both parts finite, or a case the function
// computes itself).
const _CM_TOK = {
  N: NaN, I: Infinity, '-I': -Infinity, P: _CM_PI, '-P': -_CM_PI, P12: _CM_PI / 2, '-P12': -_CM_PI / 2,
  P14: _CM_PI / 4, '-P14': -_CM_PI / 4, P34: 3 * _CM_PI / 4, '-P34': -3 * _CM_PI / 4, 0: 0, '-0': -0, 1: 1, '-1': -1, U: NaN,
};
function _cmTable(rows) {
  return rows.map((row) => row.trim().split(/\s+/).map((cell) => {
    const [a, b] = cell === 'U' ? ['U', 'U'] : cell.split(',');
    return [_CM_TOK[a], _CM_TOK[b]];
  }));
}
const _CM_ACOS = _cmTable([
  'P34,I P,I P,I P,-I P,-I P34,-I N,I',
  'P12,I U U U U P12,-I N,N',
  'P12,I U U U U P12,-I P12,N',
  'P12,I U U U U P12,-I P12,N',
  'P12,I U U U U P12,-I N,N',
  'P14,I 0,I 0,I 0,-I 0,-I P14,-I N,I',
  'N,I N,N N,N N,N N,N N,-I N,N']);
const _CM_ACOSH = _cmTable([
  'I,-P34 I,-P I,-P I,P I,P I,P34 I,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P14 I,-0 I,-0 I,0 I,0 I,P14 I,N',
  'I,N N,N N,N N,N N,N I,N N,N']);
const _CM_ASINH = _cmTable([
  '-I,-P14 -I,-0 -I,-0 -I,0 -I,0 -I,P14 -I,N',
  '-I,-P12 U U U U -I,P12 N,N',
  '-I,-P12 U U U U -I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P14 I,-0 I,-0 I,0 I,0 I,P14 I,N',
  'I,N N,N N,-0 N,0 N,N I,N N,N']);
const _CM_ATANH = _cmTable([
  '-0,-P12 -0,-P12 -0,-P12 -0,P12 -0,P12 -0,P12 -0,N',
  '-0,-P12 U U U U -0,P12 N,N',
  '-0,-P12 U U U U -0,P12 -0,N',
  '0,-P12 U U U U 0,P12 0,N',
  '0,-P12 U U U U 0,P12 N,N',
  '0,-P12 0,-P12 0,-P12 0,P12 0,P12 0,P12 0,N',
  '0,-P12 N,N N,N N,N N,N 0,P12 N,N']);
const _CM_COSH = _cmTable([
  'I,N U I,0 I,-0 U I,N I,N',
  'N,N U U U U N,N N,N',
  'N,0 U U U U N,0 N,0',
  'N,0 U U U U N,0 N,0',
  'N,N U U U U N,N N,N',
  'I,N U I,-0 I,0 U I,N I,N',
  'N,N N,N N,0 N,0 N,N N,N N,N']);
const _CM_EXP = _cmTable([
  '0,0 U 0,-0 0,0 U 0,0 0,0',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  'I,N U I,-0 I,0 U I,N I,N',
  'N,N N,N N,-0 N,0 N,N N,N N,N']);
const _CM_LOG = _cmTable([
  'I,-P34 I,-P I,-P I,P I,P I,P34 I,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P12 U U U U I,P12 N,N',
  'I,-P14 I,-0 I,-0 I,0 I,0 I,P14 I,N',
  'I,N N,N N,N N,N N,N I,N N,N']);
const _CM_SINH = _cmTable([
  'I,N U -I,-0 -I,0 U I,N I,N',
  'N,N U U U U N,N N,N',
  '0,N U U U U 0,N 0,N',
  '0,N U U U U 0,N 0,N',
  'N,N U U U U N,N N,N',
  'I,N U I,-0 I,0 U I,N I,N',
  'N,N N,N N,-0 N,0 N,N N,N N,N']);
const _CM_SQRT = _cmTable([
  'I,-I 0,-I 0,-I 0,I 0,I I,I N,I',
  'I,-I U U U U I,I N,N',
  'I,-I U U U U I,I N,N',
  'I,-I U U U U I,I N,N',
  'I,-I U U U U I,I N,N',
  'I,-I I,-0 I,-0 I,0 I,0 I,I I,N',
  'I,-I N,N N,N N,N N,N I,I N,N']);
const _CM_TANH = _cmTable([
  '-1,0 U -1,-0 -1,0 U -1,0 -1,0',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  'N,N U U U U N,N N,N',
  '1,0 U 1,-0 1,0 U 1,0 1,0',
  'N,N N,N N,-0 N,0 N,N N,N N,N']);
const _CM_RECT = _cmTable([
  'I,N U -I,0 -I,-0 U I,N I,N',
  'N,N U U U U N,N N,N',
  '0,0 U U U U 0,0 0,0',
  '0,0 U U U U 0,0 0,0',
  'N,N U U U U N,N N,N',
  'I,N U I,-0 I,0 U I,N I,N',
  'N,N N,N N,0 N,0 N,N N,N N,N']);
const _cmSpecial = (re, im) => !_cmFinite(re) || !_cmFinite(im);
const _cmLookup = (table, re, im) => { const v = table[_cmST(re)][_cmST(im)]; return [v[0], v[1]]; };

function _cmSqrt(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_SQRT, re, im); }
  if (re === 0 && im === 0) return [0, im];
  let ax = Math.abs(re), ay = Math.abs(im), s;
  if (ax < _CM_DBL_MIN && ay < _CM_DBL_MIN) {
    // hypot(ax, ay) may be subnormal: rescale
    ax = _cmLdexp(ax, _CM_SCALE_UP);
    s = _cmLdexp(Math.sqrt(ax + Math.hypot(ax, _cmLdexp(ay, _CM_SCALE_UP))), _CM_SCALE_DOWN);
  } else {
    ax /= 8;
    s = 2 * Math.sqrt(ax + Math.hypot(ax, ay / 8));
  }
  const d = ay / (2 * s);
  _cmErrno = 0;
  return re >= 0 ? [s, _cmCopysign(d, im)] : [d, _cmCopysign(s, im)];
}

function _cmAcos(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_ACOS, re, im); }
  let rr, ri;
  if (Math.abs(re) > _CM_LARGE_DOUBLE || Math.abs(im) > _CM_LARGE_DOUBLE) {
    // avoid unnecessary overflow for large arguments
    rr = Math.atan2(Math.abs(im), re);
    // split into cases for the branch cut's continuity with unsigned zeros
    if (re < 0) ri = -_cmCopysign(Math.log(Math.hypot(re / 2, im / 2)) + _CM_LN2 * 2, im);
    else ri = _cmCopysign(Math.log(Math.hypot(re / 2, im / 2)) + _CM_LN2 * 2, -im);
  } else {
    const s1 = _cmSqrt(1 - re, -im), s2 = _cmSqrt(1 + re, im);
    rr = 2 * Math.atan2(s1[0], s2[0]);
    ri = Math.asinh(s2[0] * s1[1] - s2[1] * s1[0]);
  }
  _cmErrno = 0;
  return [rr, ri];
}

function _cmAcosh(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_ACOSH, re, im); }
  let rr, ri;
  if (Math.abs(re) > _CM_LARGE_DOUBLE || Math.abs(im) > _CM_LARGE_DOUBLE) {
    rr = Math.log(Math.hypot(re / 2, im / 2)) + _CM_LN2 * 2;
    ri = Math.atan2(im, re);
  } else {
    const s1 = _cmSqrt(re - 1, im), s2 = _cmSqrt(re + 1, im);
    rr = Math.asinh(s1[0] * s2[0] + s1[1] * s2[1]);
    ri = 2 * Math.atan2(s1[1], s2[0]);
  }
  _cmErrno = 0;
  return [rr, ri];
}

function _cmAsinh(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_ASINH, re, im); }
  let rr, ri;
  if (Math.abs(re) > _CM_LARGE_DOUBLE || Math.abs(im) > _CM_LARGE_DOUBLE) {
    if (im >= 0) rr = _cmCopysign(Math.log(Math.hypot(re / 2, im / 2)) + _CM_LN2 * 2, re);
    else rr = -_cmCopysign(Math.log(Math.hypot(re / 2, im / 2)) + _CM_LN2 * 2, -re);
    ri = Math.atan2(im, Math.abs(re));
  } else {
    const s1 = _cmSqrt(1 + im, -re), s2 = _cmSqrt(1 - im, re);
    rr = Math.asinh(s1[0] * s2[1] - s2[0] * s1[1]);
    ri = Math.atan2(im, s1[0] * s2[0] - s1[1] * s2[1]);
  }
  _cmErrno = 0;
  return [rr, ri];
}

// asin(z) = -i asinh(iz)
function _cmAsin(re, im) { const s = _cmAsinh(-im, re); return [s[1], -s[0]]; }

function _cmAtanh(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_ATANH, re, im); }
  // reduce to re >= 0: atanh(z) = -atanh(-z)
  if (re < 0) { const r = _cmAtanh(-re, -im); return [-r[0], -r[1]]; }
  const ay = Math.abs(im);
  let rr, ri;
  if (re > _CM_SQRT_LARGE_DOUBLE || ay > _CM_SQRT_LARGE_DOUBLE) {
    // |z| large: atanh(z) ~ 1/z ± i·pi/2
    const h = Math.hypot(re / 2, im / 2);   // safe from overflow
    rr = re / 4 / h / h;
    ri = -_cmCopysign(_CM_PI / 2, -im);
    _cmErrno = 0;
  } else if (re === 1 && ay < _CM_SQRT_DBL_MIN) {
    // C99: atanh(1 ± 0i) is inf ± 0i
    if (ay === 0) { rr = Infinity; ri = im; _cmErrno = _CM_EDOM; }
    else {
      rr = -Math.log(Math.sqrt(ay) / Math.sqrt(Math.hypot(ay, 2)));
      ri = _cmCopysign(Math.atan2(2, -ay) / 2, im);
      _cmErrno = 0;
    }
  } else {
    rr = Math.log1p(4 * re / ((1 - re) * (1 - re) + ay * ay)) / 4;
    ri = -Math.atan2(-2 * im, (1 - re) * (1 + re) - ay * ay) / 2;
    _cmErrno = 0;
  }
  return [rr, ri];
}

// atan(z) = -i atanh(iz)
function _cmAtan(re, im) { const s = _cmAtanh(-im, re); return [s[1], -s[0]]; }

function _cmCosh(re, im) {
  let rr, ri;
  if (_cmSpecial(re, im)) {
    if (_cmIsInf(re) && _cmFinite(im) && im !== 0) {
      rr = _cmCopysign(Infinity, Math.cos(im));
      ri = re > 0 ? _cmCopysign(Infinity, Math.sin(im)) : -_cmCopysign(Infinity, Math.sin(im));
    } else [rr, ri] = _cmLookup(_CM_COSH, re, im);
    // EDOM when y is ±inf and x is not a NaN
    _cmErrno = _cmIsInf(im) && !_cmIsNaN(re) ? _CM_EDOM : 0;
    return [rr, ri];
  }
  if (Math.abs(re) > _CM_LOG_LARGE_DOUBLE) {
    // cosh(x) overflows where cosh(z) doesn't
    const x1 = re - _cmCopysign(1, re);
    rr = Math.cos(im) * Math.cosh(x1) * _CM_E;
    ri = Math.sin(im) * Math.sinh(x1) * _CM_E;
  } else {
    rr = Math.cos(im) * Math.cosh(re);
    ri = Math.sin(im) * Math.sinh(re);
  }
  _cmErrno = _cmIsInf(rr) || _cmIsInf(ri) ? _CM_ERANGE : 0;
  return [rr, ri];
}

// cos(z) = cosh(iz)
function _cmCos(re, im) { return _cmCosh(-im, re); }

function _cmExp(re, im) {
  let rr, ri;
  if (_cmSpecial(re, im)) {
    if (_cmIsInf(re) && _cmFinite(im) && im !== 0) {
      if (re > 0) { rr = _cmCopysign(Infinity, Math.cos(im)); ri = _cmCopysign(Infinity, Math.sin(im)); }
      else { rr = _cmCopysign(0, Math.cos(im)); ri = _cmCopysign(0, Math.sin(im)); }
    } else [rr, ri] = _cmLookup(_CM_EXP, re, im);
    // EDOM when y is ±inf and x is neither a NaN nor -inf
    _cmErrno = _cmIsInf(im) && (_cmFinite(re) || re === Infinity) ? _CM_EDOM : 0;
    return [rr, ri];
  }
  if (re > _CM_LOG_LARGE_DOUBLE) {
    const l = Math.exp(re - 1);
    rr = l * Math.cos(im) * _CM_E;
    ri = l * Math.sin(im) * _CM_E;
  } else {
    const l = Math.exp(re);
    rr = l * Math.cos(im);
    ri = l * Math.sin(im);
  }
  _cmErrno = _cmIsInf(rr) || _cmIsInf(ri) ? _CM_ERANGE : 0;
  return [rr, ri];
}

function _cmLog(re, im) {
  if (_cmSpecial(re, im)) { _cmErrno = 0; return _cmLookup(_CM_LOG, re, im); }
  const ax = Math.abs(re), ay = Math.abs(im);
  let rr;
  if (ax > _CM_LARGE_DOUBLE || ay > _CM_LARGE_DOUBLE) {
    rr = Math.log(Math.hypot(ax / 2, ay / 2)) + _CM_LN2;
  } else if (ax < _CM_DBL_MIN && ay < _CM_DBL_MIN) {
    if (ax > 0 || ay > 0) {
      // hypot(ax, ay) is subnormal: rescale
      rr = Math.log(Math.hypot(_cmLdexp(ax, _CM_MANT_DIG), _cmLdexp(ay, _CM_MANT_DIG))) - _CM_MANT_DIG * _CM_LN2;
    } else {
      // log(±0 ± 0i)
      _cmErrno = _CM_EDOM;
      return [-Infinity, Math.atan2(im, re)];
    }
  } else {
    const h = Math.hypot(ax, ay);
    if (h >= 0.71 && h <= 1.73) {
      const am = ax > ay ? ax : ay, an = ax > ay ? ay : ax;
      rr = Math.log1p((am - 1) * (am + 1) + an * an) / 2;
    } else rr = Math.log(h);
  }
  _cmErrno = 0;
  return [rr, Math.atan2(im, re)];
}

function _cmLog10(re, im) {
  const r = _cmLog(re, im);
  return [r[0] / _CM_LN10, r[1] / _CM_LN10];
}

function _cmSinh(re, im) {
  let rr, ri;
  if (_cmSpecial(re, im)) {
    if (_cmIsInf(re) && _cmFinite(im) && im !== 0) {
      rr = re > 0 ? _cmCopysign(Infinity, Math.cos(im)) : -_cmCopysign(Infinity, Math.cos(im));
      ri = _cmCopysign(Infinity, Math.sin(im));
    } else [rr, ri] = _cmLookup(_CM_SINH, re, im);
    _cmErrno = _cmIsInf(im) && !_cmIsNaN(re) ? _CM_EDOM : 0;
    return [rr, ri];
  }
  if (Math.abs(re) > _CM_LOG_LARGE_DOUBLE) {
    const x1 = re - _cmCopysign(1, re);
    rr = Math.cos(im) * Math.sinh(x1) * _CM_E;
    ri = Math.sin(im) * Math.cosh(x1) * _CM_E;
  } else {
    rr = Math.cos(im) * Math.sinh(re);
    ri = Math.sin(im) * Math.cosh(re);
  }
  _cmErrno = _cmIsInf(rr) || _cmIsInf(ri) ? _CM_ERANGE : 0;
  return [rr, ri];
}

// sin(z) = -i sinh(iz)
function _cmSin(re, im) { const s = _cmSinh(-im, re); return [s[1], -s[0]]; }

function _cmTanh(re, im) {
  let rr, ri;
  if (_cmSpecial(re, im)) {
    if (_cmIsInf(re) && _cmFinite(im) && im !== 0) {
      rr = re > 0 ? 1 : -1;
      ri = _cmCopysign(0, 2 * Math.sin(im) * Math.cos(im));
    } else [rr, ri] = _cmLookup(_CM_TANH, re, im);
    // EDOM when y is ±inf and x is finite
    _cmErrno = _cmIsInf(im) && _cmFinite(re) ? _CM_EDOM : 0;
    return [rr, ri];
  }
  if (Math.abs(re) > _CM_LOG_LARGE_DOUBLE) {
    // 1 - tanh(x)**2 as 4·exp(-2|x|), where cosh(x) would overflow
    rr = _cmCopysign(1, re);
    ri = 4 * Math.sin(im) * Math.cos(im) * Math.exp(-2 * Math.abs(re));
  } else {
    const tx = Math.tanh(re), ty = Math.tan(im), cx = 1 / Math.cosh(re);
    const txty = tx * ty, denom = 1 + txty * txty;
    rr = tx * (1 + ty * ty) / denom;
    ri = ((ty / denom) * cx) * cx;
  }
  _cmErrno = 0;
  return [rr, ri];
}

// tan(z) = -i tanh(iz)
function _cmTan(re, im) { const s = _cmTanh(-im, re); return [s[1], -s[0]]; }

// atan2 with C99's answers where platforms disagree
function _cmAtan2(re, im) {
  if (_cmIsNaN(re) || _cmIsNaN(im)) return NaN;
  if (_cmIsInf(im)) {
    if (_cmIsInf(re)) return _cmCopysign(1, re) === 1 ? _cmCopysign(0.25 * _CM_PI, im) : _cmCopysign(0.75 * _CM_PI, im);
    return _cmCopysign(0.5 * _CM_PI, im);
  }
  if (_cmIsInf(re) || im === 0) return _cmCopysign(1, re) === 1 ? _cmCopysign(0, im) : _cmCopysign(_CM_PI, im);
  return Math.atan2(im, re);
}

// |z| and z / w are complex's own (_Py_c_abs, _Py_c_quot); their errno lands in this module's
function _cmAbs(re, im) {
  const r = _cAbs(re, im);
  _cmErrno = _cErr.no; _cErr.no = 0;
  return r;
}
function _cmQuot(ar, ai, br, bi) {
  _cErr.no = 0;
  const q = _cQuot(ar, ai, br, bi);
  if (_cErr.no) _cmErrno = _cErr.no;
  _cErr.no = 0;
  return q;
}

// PyComplex_AsCComplex: a complex, a real (an int, a bool, __float__, __index__), or __complex__;
// [re, im], or a Promise of it when a tree-walked dunder answered
export function _cmArg(x) {
  if (typeof x === 'number') return [x, 0];
  if (x instanceof Complex) return [x.real, x.imag];
  if (typeof x === 'boolean') return [+x, 0];
  if (typeof x === 'bigint') { const n = Number(x); if (!_cmFinite(n)) throw new AdderError('OverflowError', 'int too large to convert to float'); return [n, 0]; }
  if (x !== null && typeof x === 'object' && !x._kw && typeof x !== 'string') {
    if (typeof x.__complex__ === 'function') {
      const chk = (v) => {
        if (v instanceof Complex) return [v.real, v.imag];
        throw new AdderError('TypeError', `__complex__ returned non-complex (type ${pyTypeName(v)})`);
      };
      const r = syncOf(x.__complex__).call(x);
      return r && typeof r.then === 'function' ? r.then(chk) : chk(r);
    }
    for (const m of ['__float__', '__index__']) {
      if (typeof x[m] === 'function') {
        const chk = (v) => {
          if (typeof v === 'number' || typeof v === 'bigint') return [Number(v), 0];
          throw new AdderError('TypeError', `${pyTypeName(x)}.${m} returned non-${m === '__float__' ? 'float' : 'int'} (type ${pyTypeName(v)})`);
        };
        const r = syncOf(x[m]).call(x);
        return r && typeof r.then === 'function' ? r.then(chk) : chk(r);
      }
    }
  }
  throw new AdderError('TypeError', `must be real number, not ${pyTypeName(x)}`);
}
// a float argument (rect, isclose's tolerances): what math takes
function _cmReal(x) {
  if (typeof x === 'number') return x;
  if (x instanceof Complex) throw new AdderError('TypeError', 'must be real number, not complex');
  const r = _cmArg(x);
  return r && typeof r.then === 'function' ? r.then((v) => v[0]) : r[0];
}
const _cmThen = (v, f) => (v && typeof v.then === 'function' ? v.then(f) : f(v));
const _cmAll = (vs, f) => (vs.some((v) => v && typeof v.then === 'function') ? Promise.all(vs).then(f) : f(vs));

function _cmRaise() {
  const e = _cmErrno;
  _cmErrno = 0;
  if (e === _CM_EDOM) throw new AdderError('ValueError', 'math domain error');
  if (e === _CM_ERANGE) throw new AdderError('OverflowError', 'math range error');
}
function _cmCount(name, args, min, max) {
  if (args.length && args[args.length - 1] && args[args.length - 1]._kw === true) {
    const kw = args[args.length - 1];
    if (Object.keys(kw).some((k) => k !== '_kw')) throw new AdderError('TypeError', `${name}() takes no keyword arguments`);
    args.pop();
  }
  const n = args.length;
  if (n < min || n > max) {
    if (min === max) throw new AdderError('TypeError', `${name}() takes exactly one argument (${n} given)`);
    throw new AdderError('TypeError', `${name} expected at ${n < min ? 'least' : 'most'} ${n < min ? min : max} argument${(n < min ? min : max) > 1 ? 's' : ''}, got ${n}`);
  }
}
// cmath.<name>(z), as the clinic wrapper: errno cleared, the C function, errno checked
function _cmFunc(name, f) {
  const w = function (...args) {
    _cmCount(name, args, 1, 1);
    return _cmThen(_cmArg(args[0]), ([re, im]) => {
      _cmErrno = 0;
      const r = f(re, im);
      _cmRaise();
      return new Complex(r[0], r[1]);
    });
  };
  Object.defineProperty(w, 'name', { value: name });
  w._pyName = name;
  return w;
}

const _cmModule = {
  __name__: 'cmath',
  pi: _CM_PI, e: _CM_E, tau: 2 * _CM_PI,
  inf: Infinity, infj: new Complex(0, Infinity), nan: NaN, nanj: new Complex(0, NaN),
  acos: _cmFunc('acos', _cmAcos), acosh: _cmFunc('acosh', _cmAcosh),
  asin: _cmFunc('asin', _cmAsin), asinh: _cmFunc('asinh', _cmAsinh),
  atan: _cmFunc('atan', _cmAtan), atanh: _cmFunc('atanh', _cmAtanh),
  cos: _cmFunc('cos', _cmCos), cosh: _cmFunc('cosh', _cmCosh),
  exp: _cmFunc('exp', _cmExp),
  log10: _cmFunc('log10', _cmLog10),
  sin: _cmFunc('sin', _cmSin), sinh: _cmFunc('sinh', _cmSinh),
  sqrt: _cmFunc('sqrt', _cmSqrt),
  tan: _cmFunc('tan', _cmTan), tanh: _cmFunc('tanh', _cmTanh),
  log(...args) {
    _cmCount('log', args, 1, 2);
    return _cmAll(args.map(_cmArg), ([x, y]) => {
      _cmErrno = 0;
      let r = _cmLog(x[0], x[1]);
      if (y) {
        // (as CPython: log(y) sets errno afresh, the division may set EDOM)
        const ly = _cmLog(y[0], y[1]);
        r = _cmQuot(r[0], r[1], ly[0], ly[1]);
      }
      _cmRaise();
      return new Complex(r[0], r[1]);
    });
  },
  phase(...args) {
    _cmCount('phase', args, 1, 1);
    return _cmThen(_cmArg(args[0]), ([re, im]) => _cmAtan2(re, im));
  },
  polar(...args) {
    _cmCount('polar', args, 1, 1);
    return _cmThen(_cmArg(args[0]), ([re, im]) => {
      const phi = _cmAtan2(re, im);
      _cmErrno = 0;
      const r = _cmAbs(re, im);
      _cmRaise();
      return mkTuple([r, phi]);
    });
  },
  rect(...args) {
    _cmCount('rect', args, 2, 2);
    return _cmAll(args.map(_cmReal), ([r, phi]) => {
      let re, im;
      _cmErrno = 0;
      if (!_cmFinite(r) || !_cmFinite(phi)) {
        // r = ±inf, phi finite and nonzero: ±inf ±inf i, the signs from cos and sin
        if (_cmIsInf(r) && _cmFinite(phi) && phi !== 0) {
          if (r > 0) { re = _cmCopysign(Infinity, Math.cos(phi)); im = _cmCopysign(Infinity, Math.sin(phi)); }
          else { re = -_cmCopysign(Infinity, Math.cos(phi)); im = -_cmCopysign(Infinity, Math.sin(phi)); }
        } else [re, im] = _cmLookup(_CM_RECT, r, phi);
        // EDOM when r is a nonzero number and phi infinite
        if (r !== 0 && !_cmIsNaN(r) && _cmIsInf(phi)) _cmErrno = _CM_EDOM;
      } else if (phi === 0) {
        re = r; im = r * phi;
      } else {
        re = r * Math.cos(phi); im = r * Math.sin(phi);
      }
      _cmRaise();
      return new Complex(re, im);
    });
  },
  isfinite(...args) { _cmCount('isfinite', args, 1, 1); return _cmThen(_cmArg(args[0]), ([re, im]) => _cmFinite(re) && _cmFinite(im)); },
  isnan(...args) { _cmCount('isnan', args, 1, 1); return _cmThen(_cmArg(args[0]), ([re, im]) => _cmIsNaN(re) || _cmIsNaN(im)); },
  isinf(...args) { _cmCount('isinf', args, 1, 1); return _cmThen(_cmArg(args[0]), ([re, im]) => _cmIsInf(re) || _cmIsInf(im)); },
  isclose(...args) {
    const kw = args.length && args[args.length - 1] && args[args.length - 1]._kw === true ? args.pop() : null;
    if (args.length !== 2) throw new AdderError('TypeError', `isclose() takes exactly 2 positional arguments (${args.length} given)`);
    if (kw) for (const k of Object.keys(kw)) if (k !== '_kw' && k !== 'rel_tol' && k !== 'abs_tol') throw new AdderError('TypeError', `isclose() got an unexpected keyword argument '${k}'`);
    const relTol = kw && 'rel_tol' in kw ? _cmReal(kw.rel_tol) : 1e-9;
    const absTol = kw && 'abs_tol' in kw ? _cmReal(kw.abs_tol) : 0;
    return _cmAll([_cmArg(args[0]), _cmArg(args[1]), relTol, absTol], ([a, b, rel, abs]) => {
      if (rel < 0 || abs < 0) throw new AdderError('ValueError', 'tolerances must be non-negative');
      // identical: even two infinities
      if (a[0] === b[0] && a[1] === b[1]) return true;
      // an infinity is close only to itself
      if (_cmIsInf(a[0]) || _cmIsInf(a[1]) || _cmIsInf(b[0]) || _cmIsInf(b[1])) return false;
      const diff = _cmAbs(a[0] - b[0], a[1] - b[1]);
      return diff <= rel * _cmAbs(b[0], b[1]) || diff <= rel * _cmAbs(a[0], a[1]) || diff <= abs;
    });
  },
};
for (const [k, v] of Object.entries(_cmModule)) if (typeof v === 'function' && !v._pyName) { Object.defineProperty(v, 'name', { value: k }); v._pyName = k; }
adderModules.cmath = _cmModule;
