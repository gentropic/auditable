// micro — the CRS detective's pure core (tools/micro/src/crs-detective-core.js), against the real
// EPSG table and @gcu/proj's real transforms, on synthetic collars whose truth is known here:
//   · the projection key: "+proj=utm +zone=23 +south" ≡ the tmerc it stands for; datum stripped
//   · the datum twins of SIRGAS 2000 / UTM 23S near Belo Horizonte include SAD69, Córrego Alegre
//     and WGS 84 in the same zone — found from the table, never listed by hand
//   · collars surveyed on a hilly DEM in SIRGAS 2000, their numbers then written in SAD69: the
//     detective ranks SAD69 first by a clear margin; the same collars left in SIRGAS → "as is"
//   · a flat DEM → "can't tell", with the reason; a 25 m vertical offset everywhere → called out,
//     and the right datum still wins on the spread
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEpsgTable, lookupEpsg, transformPoints } from '../ext/proj/index.js';
import { projectionKey, datumKey, datumTwins, hypothesesFor, misfitStats, runDetective, median } from '../tools/micro/src/crs-detective-core.js';

const allEntries = async () => { const t = await loadEpsgTable(); const out = []; for (let i = 0; i < t.count; i++) out.push(t.entry(i)); return out; };
// a DEM with relief: ~120 m of hills over 4 km, as a sampler on a 10 m lattice (bilinear, like micro's)
const X0 = 600000, Y0 = 7790000;
const hill = (x, y) => 900 + 60 * Math.sin((x - X0) / 400) * Math.cos((y - Y0) / 550) + 0.02 * (x - X0);
const latticed = (f, pitch = 10) => (x, y) => {
  const fx = (x - X0) / pitch, fy = (y - Y0) / pitch;
  if (fx < 0 || fy < 0 || fx > 400 || fy > 400) return NaN;
  const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, z = (i, j) => f(X0 + i * pitch, Y0 + j * pitch);
  return z(c, r) * (1 - tx) * (1 - ty) + z(c + 1, r) * tx * (1 - ty) + z(c, r + 1) * (1 - tx) * ty + z(c + 1, r + 1) * tx * ty;
};
// 60 collars spread over the DEM (deterministic), ON the surface, in SIRGAS 2000 / UTM 23S
const TRUE = [];
for (let k = 0; k < 60; k++) { const x = X0 + 300 + ((k * 617) % 3400), y = Y0 + 300 + ((k * 389) % 3400); TRUE.push([x, y, hill(x, y)]); }

test('projectionKey: utm ≡ its tmerc, datum stripped; datumKey keeps the datum', () => {
  const a = projectionKey('+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
  const b = projectionKey('+proj=tmerc +lat_0=0 +lon_0=-45 +k=0.9996 +x_0=500000 +y_0=10000000 +ellps=aust_SA +towgs84=-57,1,-41,0,0,0,0 +units=m +no_defs');
  assert.equal(a, b);
  assert.notEqual(a, projectionKey('+proj=utm +zone=24 +south +ellps=GRS80 +units=m'));
  assert.notEqual(a, projectionKey('+proj=utm +zone=23 +ellps=GRS80 +units=m'));   // north
  assert.equal(projectionKey('+proj=longlat +datum=WGS84'), null);
  assert.match(datumKey('+proj=utm +zone=23 +south +ellps=aust_SA +towgs84=-57,1,-41 +units=m'), /ellps=aust_SA towgs84=-57,1,-41/);
});

test('datumTwins: SIRGAS 2000 / UTM 23S near Belo Horizonte → SAD69, Córrego Alegre, WGS 84 in the same zone, from the table', async () => {
  const base = await lookupEpsg(31983), entries = await allEntries();
  const twins = datumTwins(base, entries, { lonLat: [-43.9, -19.9] });
  const codes = new Set(twins.map((c) => c.epsg));
  for (const c of [29193, 22523, 32723]) assert.ok(codes.has(c), `twin EPSG:${c} found (got ${[...codes].join(',')})`);
  assert.ok(!codes.has(31983) && !codes.has(31984) && !codes.has(29194));      // not itself, not zone 24 (SIRGAS, SAD69)
  assert.ok(twins.every((c) => projectionKey(c.def) === projectionKey(base.def)));
  // a twin whose area of use is elsewhere is left out (far from its box)
  const far = datumTwins(base, entries, { lonLat: [10, 50] });
  assert.ok(!far.some((c) => c.epsg === 29193));
});

test('misfitStats: median |Δz|, signed median, spread, inside', () => {
  const s = misfitStats([1, -1, 2, -2, 0, NaN, 10], 1.5);
  assert.equal(s.n, 6); assert.equal(s.medAbs, 1.5); assert.equal(s.med, 0.5);
  assert.ok(Math.abs(s.inside - 3 / 6) < 1e-12);
  assert.equal(median([3, 1, 2]), 2);
});

const runFor = async (rawPts, sampleZ, opts = {}) => {
  const base = await lookupEpsg(31983), entries = await allEntries();
  const twins = datumTwins(base, entries, { lonLat: [-43.9, -19.9] });
  const hyps = hypothesesFor(rawPts, base, twins, (a, b, p) => transformPoints(a, b, p));
  return runDetective({ collars: rawPts, hypotheses: hyps, sampleZ, pitch: 10, tol: 2, ...opts });
};

test('synthetic: SIRGAS collars written in SAD69 → the detective names SAD69, by a clear margin', async () => {
  const sad = await lookupEpsg(29193), sir = await lookupEpsg(31983);
  const raw = transformPoints(sir, sad, TRUE);                       // the numbers as a SAD69 survey writes them
  const shift = median(raw.map((p, i) => Math.hypot(p[0] - TRUE[i][0], p[1] - TRUE[i][1])));
  assert.ok(shift > 50 && shift < 80, `SAD69 ↔ SIRGAS here is ~60–70 m (${shift.toFixed(1)})`);
  const r = await runFor(raw, latticed(hill));
  const top = r.hypotheses[0];
  assert.ok(top.members.some((m) => m.id === 'EPSG:29193'), `SAD69 ranked first (got ${top.label})`);
  assert.equal(r.verdict.kind, 'shift');
  assert.ok(r.verdict.ratio >= 4, `margin ≥ 4× (${r.verdict.ratio.toFixed(1)})`);
  assert.ok(top.medAbs < 0.5 && top.inside > 0.95, `back on the ground (median |Δz| ${top.medAbs.toFixed(3)} m)`);
  assert.match(r.verdict.text, /recorded in SAD69/);
  const asIs = r.hypotheses.find((h) => h.asIs);
  assert.ok(asIs.members.some((m) => m.id === 'EPSG:32723'), 'WGS 84 is the same reading as SIRGAS 2000 here — one row');
});

test('synthetic: the same collars left in SIRGAS → "as is" wins', async () => {
  const r = await runFor(TRUE, latticed(hill));
  assert.ok(r.hypotheses[0].asIs);
  assert.equal(r.verdict.kind, 'as-is');
  assert.ok(r.verdict.ratio >= 4);
});

test('a flat DEM: the test refuses to name a datum, and says why', async () => {
  const sad = await lookupEpsg(29193), sir = await lookupEpsg(31983);
  const flat = (x, y) => 900 + 0.001 * (x - X0);
  const raw = transformPoints(sir, sad, TRUE.map(([x, y]) => [x, y, flat(x, y)]));
  const r = await runFor(raw, latticed(flat));
  assert.equal(r.verdict.kind, 'flat');
  assert.match(r.verdict.text, /too flat/);
  assert.ok(r.slope.medDeg < 1);
});

test('a vertical offset everywhere is called out; the right datum still wins on the spread', async () => {
  const sad = await lookupEpsg(29193), sir = await lookupEpsg(31983);
  const raw = transformPoints(sir, sad, TRUE).map((p) => [p[0], p[1], p[2] + 25]);
  const r = await runFor(raw, latticed(hill));
  assert.ok(r.vertical && Math.abs(r.vertical.offset - 25) < 1, `offset ~25 m (${r.vertical && r.vertical.offset})`);
  assert.match(r.verdict.text, /above the DEM everywhere/);
  assert.ok(r.hypotheses[0].members.some((m) => m.id === 'EPSG:29193'));
  assert.equal(r.verdict.kind, 'shift');
});

test('collars off the DEM are excluded and counted', async () => {
  const pts = [...TRUE.slice(0, 10), [X0 - 5000, Y0, 900], [X0 + 99999, Y0, 900]];
  const r = await runFor(pts, latticed(hill));
  const asIs = r.hypotheses.find((h) => h.asIs);
  assert.equal(asIs.off, 2); assert.equal(asIs.n, 10);
});
