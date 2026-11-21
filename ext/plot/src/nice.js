// Round tick values and their labels — the leaf both ticks.js and ticker.js stand on (no imports).

// at most `count` round ticks inside [lo, hi], as many as fit: the smallest step of 1, 2, 2.5
// or 5 × a power of ten that gives no more than `count` (and at least two while the range
// allows) — matplotlib's MaxNLocator idea
export function _niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const n = (step) => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1;
  const e0 = Math.floor(Math.log10(span)) - 3;
  let step = null;
  for (let e = e0; e <= e0 + 5 && step == null; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const s = m * Math.pow(10, e);
      if (n(s) <= Math.max(2, count)) { step = s; break; }
    }
  }
  if (step == null) step = Math.pow(10, e0 + 6);
  const a = Math.ceil(lo / step - 1e-9), b = Math.floor(hi / step + 1e-9);
  const out = [];
  for (let k = a; k <= b && out.length < 200; k++) out.push(+(k * step).toPrecision(12));
  out.step = step;
  return out;
}

// labels for ticks with this step: just the decimals the step needs; plain digits up to 1e9
// (a northing reads 8200100, as matplotlib prints it), exponents past that or below 1e-4
export function _fmtStep(values, step) {
  const big = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (big >= 1e9 || (big > 0 && big < 1e-4)) return values.map((v) => (v === 0 ? '0' : v.toExponential(Math.max(0, Math.min(3, Math.round(-Math.log10(step / big)))))));
  let dec = 0;
  while (dec < 10 && Math.abs(step * Math.pow(10, dec) - Math.round(step * Math.pow(10, dec))) > 1e-6 * Math.max(1, step * Math.pow(10, dec))) dec++;
  return values.map((v) => { const s = v.toFixed(dec); return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s; });
}

