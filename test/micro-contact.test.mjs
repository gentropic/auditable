// micro contact analysis — the pure binning (tools/micro/src/contact-core.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downholeContacts, contactValues, contactBinRows, binRecord, holeRuns } from '../tools/micro/src/contact-core.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
// a hole: n intervals of `len` m, the domain and value from depth
const hole = (id, n, len, at) => Array.from({ length: n }, (_, i) => { const f = i * len, t = f + len, r = at((f + t) / 2); return { hole: id, from: f, to: t, dom: r.dom, v: r.v, w: 1, keep: true }; });

test('a hard contact: ORE 10 above WASTE 2 at 20 m → the binned means, metres and counts', () => {
  const ivs = hole('H1', 10, 4, (d) => (d < 20 ? { dom: 'ORE', v: 10 } : { dom: 'WASTE', v: 2 }));
  const r = downholeContacts(ivs, { domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 8 });
  assert.equal(r.contacts, 1); assert.equal(r.holes, 1);
  const rows = contactBinRows(r.bins, 2, ['ORE', 'WASTE']);
  assert.deepEqual(rows.map((x) => x.center), [-7, -5, -3, -1, 1, 3, 5, 7]);
  for (const x of rows) { near(x.mean, x.center < 0 ? 10 : 2); near(x.support, 2); assert.equal(x.side, x.center < 0 ? 'ORE' : 'WASTE'); }
  // a 4 m interval spans two 2 m bins: each bin counts the piece in it
  assert.deepEqual(rows.map((x) => x.count), [1, 1, 1, 1, 1, 1, 1, 1]);
  const v = contactValues(r.bins, 2);
  near(v.mean_inside, 10); near(v.mean_outside, 2); near(v.step, 8); near(v.ratio, 5); near(v.slope_inside, 0); near(v.slope_outside, 0);
});

test('a soft contact reads as slopes; the direction filter and pooling', () => {
  // grade falls linearly with depth across the contact at 20 m: soft
  const ivs = hole('H1', 20, 2, (d) => ({ dom: d < 20 ? 'ORE' : 'WASTE', v: 40 - d }));
  const r = downholeContacts(ivs, { domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 10 });
  const v = contactValues(r.bins, 2);
  near(v.step, 2);                                          // 21 vs 19: just the 2 m between the bin centres
  near(v.slope_inside, -1); near(v.slope_outside, -1);     // −1 per metre of signed distance (A at −, B at +): a ramp, on both sides
  // a second hole drilled the other way: WASTE above ORE
  const ivs2 = hole('H2', 10, 2, (d) => (d < 10 ? { dom: 'WASTE', v: 1 } : { dom: 'ORE', v: 9 }));
  const both = downholeContacts([...ivs, ...ivs2], { domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 10 });
  assert.equal(both.contacts, 2);
  assert.equal(downholeContacts([...ivs, ...ivs2], { domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 10, direction: 'AtoB' }).contacts, 1);
  const bta = downholeContacts([...ivs, ...ivs2], { domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 10, direction: 'BtoA' });
  assert.equal(bta.contacts, 1);
  near(contactValues(bta.bins, 2).mean_inside, 9);         // only H2: ORE is below
});

test('domain B blank = any other; slivers and gaps are skipped; blanks break runs', () => {
  // ORE 0–20, a 2 m TRANSITION sliver 20–22, WASTE 22–40
  const ivs = hole('H1', 20, 2, (d) => ({ dom: d < 20 ? 'ORE' : d < 22 ? 'TRANS' : 'WASTE', v: d < 20 ? 10 : 2 }));
  const any = downholeContacts(ivs, { domA: 'ORE', binWidth: 2, maxDist: 6 });
  assert.equal(any.contacts, 1);                            // ORE→TRANS (TRANS→WASTE has no A)
  const minRun = downholeContacts(ivs, { domA: 'ORE', binWidth: 2, maxDist: 6, minRun: 3 });
  assert.equal(minRun.contacts, 0); assert.equal(minRun.skipped.short, 1);
  // a 10 m unsampled gap at the contact: no contact across it (maxGap defaults to the bin width)
  const gapped = [...hole('H1', 5, 2, () => ({ dom: 'ORE', v: 10 })), ...hole('H1', 5, 2, () => ({ dom: 'WASTE', v: 2 })).map((x) => ({ ...x, from: x.from + 20, to: x.to + 20 }))];
  assert.equal(downholeContacts(gapped, { domA: 'ORE', binWidth: 2, maxDist: 6 }).skipped.gap, 1);
  assert.equal(downholeContacts(gapped, { domA: 'ORE', binWidth: 2, maxDist: 6, maxGap: 12 }).contacts, 1);
  // a blank-domain interval between ORE and WASTE is not a contact
  const blank = hole('H1', 6, 2, (d) => ({ dom: d < 6 ? 'ORE' : d < 8 ? '' : 'WASTE', v: 5 }));
  assert.equal(holeRuns(blank, 2).length, 2);
  assert.equal(downholeContacts(blank, { domA: 'ORE', binWidth: 2, maxDist: 6 }).contacts, 0);
});

test('the walk stays inside each run, weights multiply the length, keep=false drops the value only', () => {
  // ORE 0–4 (a 4 m run), WASTE 4–40: maxDist 10 still reads only 4 m of ORE
  const ivs = hole('H1', 20, 2, (d) => ({ dom: d < 4 ? 'ORE' : 'WASTE', v: d < 4 ? 10 : 2 }));
  ivs[0].w = 3;                                             // a density of 3 on the top interval
  const r = downholeContacts(ivs, { domA: 'ORE', binWidth: 2, maxDist: 10 });
  const rows = contactBinRows(r.bins, 2, ['ORE', 'other']);
  assert.deepEqual(rows.filter((x) => x.center < 0).map((x) => x.center), [-3, -1]);
  const far = rows.find((x) => x.center === -3); near(far.support, 2); near(far.weight, 6);
  ivs[1].keep = false;                                      // filtered out: the run still stands, its value doesn't count
  const r2 = downholeContacts(ivs, { domA: 'ORE', binWidth: 2, maxDist: 10 });
  assert.equal(r2.contacts, 1);
  assert.equal(contactBinRows(r2.bins, 2, ['ORE', 'other']).filter((x) => x.center < 0).length, 1);
});

test('signed-distance records bin by floor(d / bw), out to maxDist', () => {
  const bins = new Map();
  for (const [d, v] of [[-0.5, 10], [-1.5, 8], [0.2, 2], [1.9, 3], [7, 99], [-9, 99]]) binRecord(bins, d, 1, 5, v, 1, 1);
  const rows = contactBinRows(bins, 1, ['inside', 'outside']);
  assert.deepEqual(rows.map((x) => [x.side, x.center, x.mean]), [['inside', -1.5, 8], ['inside', -0.5, 10], ['outside', 0.5, 2], ['outside', 1.5, 3]]);
  const v = contactValues(bins, 1);
  near(v.step, 8); near(v.n, 2);
  near(contactValues(bins, 1, 2).mean_inside, 9);           // near = 2 bins: both inside bins
});
