// @gcu/scan — the engine on the page path (Node has no Worker, so every job runs
// in-thread — the same kernel and view the workers run). Three sources, one
// answer: a filter over the same model as Parquet, as an indexed CSV and as a
// Datamine .dm gives the brute-force record set; zone keeping skips only zones
// that can't match; stats merge in unit order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScan, makeColAcc } from '../ext/scan/src/main.js';
import * as parquet from '../ext/parquet/index.js';
import * as condenser from '../ext/condenser/src/main.js';
import * as expr from '../ext/expr/index.js';
import * as sluice from '../ext/sluice/index.js';
import { makeDM } from './dm-make.mjs';

const scan = createScan({ deps: { parquet, condenser, expr, sluice } });   // no urls.worker: the page path
const N = 5000;
const rows = Array.from({ length: N }, (_, i) => ({ X: 5 + (i % 20) * 10, Y: 5 + ((i / 20 | 0) % 25) * 10, Z: 5 + (i / 500 | 0) * 10, AU: (i * 7919 % 1000) / 100 }));
const truth = (f) => rows.map((r, i) => (f(r) ? i : -1)).filter((i) => i >= 0);
const schema = ['X', 'Y', 'Z', 'AU'].map((name) => ({ name, type: 'number' }));
const spec = { base: ['X', 'Y', 'Z', 'AU'], paints: [] };
const filterJob = (source, ex) => ({ source, kernel: 'filter', params: { schema, expr: ex, coords: ['X', 'Y', 'Z'], chan: null, cat: null }, spec, readCols: ['X', 'Y', 'Z', 'AU'] });
const hitsOf = (res, units) => { const out = []; res.parts.forEach((p, g) => { if (p) for (let i = 0; i < p.mask.length; i++) if (p.mask[i]) out.push(units[g].start + i); }); return out; };

async function sources() {
  const pqBuf = parquet.writeParquet({ columnData: ['X', 'Y', 'Z', 'AU'].map((name) => ({ name, data: rows.map((r) => r[name]), type: 'DOUBLE' })), rowGroupSize: 700 });
  const info = parquet.parquetInfo(pqBuf);
  const pq = scan.sources.parquet({ buf: pqBuf, meta: info.meta, names: ['X', 'Y', 'Z', 'AU'], rowGroups: info.rowGroups }, ['X', 'Y', 'Z', 'AU']);
  const csvBlob = new Blob(['X,Y,Z,AU\n' + rows.map((r) => `${r.X},${r.Y},${r.Z},${r.AU}`).join('\n') + '\n']);
  const bm = await condenser.openBlockModel(csvBlob, { zones: true });
  const h = bm.header, m = h.mapping;
  const o = { delim: h.delim, x: m.x, y: m.y, z: m.z, cols: ['X', 'Y', 'Z', 'AU'].map((n) => ({ i: h.columns.indexOf(n), num: true, policy: null })) };
  const csv = scan.sources.delimited(csvBlob, h, o, ['X', 'Y', 'Z', 'AU'], { anchors: 1 });
  const dmBlob = new Blob([makeDM(['X', 'Y', 'Z', 'AU'].map((name) => ({ name, type: 'N' })), rows, { precision: 'ep' })]);
  const dmd = await condenser.openDmModel(dmBlob);
  const dm = scan.sources.dm(dmBlob, dmd.header.dm, dmd.header.columns, ['X', 'Y', 'Z', 'AU']);
  return { pq, csv, dm, csvBlob, h, o };
}

test('scan: one filter, three sources, the brute-force answer (units in order)', async () => {
  const S = await sources();
  for (const [ex, f] of [['AU > 7.5', (r) => r.AU > 7.5], ['Z < 30 and X >= 100', (r) => r.Z < 30 && r.X >= 100]]) {
    const want = truth(f);
    for (const k of ['pq', 'csv', 'dm']) {
      if (k !== 'dm') assert.ok(S[k].units.length > 1, `${k}: several units`);   // a .dm run is ~4 MB: this one is a single run
      const res = await scan.run(filterJob(S[k], ex));
      assert.equal(res.where, 'on this page');
      assert.deepEqual(hitsOf(res, S[k].units), want, `${k}: ${ex}`);
    }
  }
});

test('scan: zone keeping reads only zones that can match — and loses nothing', async () => {
  const S = await sources();
  const zs = S.h.zones;
  assert.ok(zs && zs.n === Math.ceil(N / 1024));
  const ex = 'Z < 30', ast = expr.parse(ex);
  const keep = scan.zoneKeep(zs, { ast, names: ['Z'] });
  const src = scan.sources.delimited(S.csvBlob, S.h, S.o, ['X', 'Y', 'Z', 'AU'], { anchors: 1, keep });
  const res = await scan.run(filterJob(src, ex));
  assert.ok(res.zonesSkipped > 0, `skipped ${res.zonesSkipped} of ${res.zones}`);
  assert.deepEqual(hitsOf(res, src.units), truth((r) => r.Z < 30));
  const box = scan.zoneKeep(zs, { bbox: [0, 0, 0, 1e9, 1e9, 20], coords: ['X', 'Y', 'Z'] });
  let kept = 0; for (let z = 0; z < zs.n; z++) if (box(z)) kept++;
  assert.equal(kept, 1, 'a bbox below z=20 touches the first zone only');
  assert.equal(scan.zoneKeep(zs, {}), null, 'nothing to skip by → no keeper');
});

test('scan: stats over a source equal the accumulator over every value', async () => {
  const S = await sources();
  const res = await scan.run({ source: S.pq, kernel: 'stats', params: { schema, cols: ['AU'], groupBy: null, weight: null }, spec, readCols: ['AU'] });
  const { statsMerge, momentStd } = await import('../ext/scan/src/kernels.js');
  const merged = statsMerge(sluice, res.parts.filter(Boolean));
  const a = merged.groups.get('')[0];
  const acc = makeColAcc(sluice), c = acc.create(true);
  for (const r of rows) acc.pushNumber(c, r.AU);
  const ref = acc.result(c, N);
  assert.equal(a.n, N);
  assert.ok(Math.abs(a.mean - ref.mean) < 1e-9);
  // the kernel's weighted std is the population one (÷N); welford's divides by N−1
  assert.ok(Math.abs(momentStd(a) - ref.std * Math.sqrt((N - 1) / N)) < 1e-9);
});

test('scan: createScan names a missing dependency; an unknown kernel throws', async () => {
  assert.throws(() => createScan({ deps: { parquet, condenser, expr } }), /deps\.sluice/);
  const S = await sources();
  await assert.rejects(scan.run({ ...filterJob(S.pq, 'AU > 1'), kernel: 'nope' }), /no kernel 'nope'/);
});
