// a .dm OPEN cut into units (condenser dmOpenRuns / dmDiscoverRun / dmDecodeRun) and run
// by any runner — the one-thread runner, or units finishing out of order as on a worker
// pool — gives the SAME header and the same stream, record for record, as one unit
// over the whole file: same records, same raw numbers, same category codes, same sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDmModel, dmPageRunner, dmDiscoverRun, dmDecodeRun, dmOpenRuns, sizeCollector } from '../ext/condenser/src/main.js';
import { makeDM } from './dm-make.mjs';
import { makeSubblockRows } from './subblock-make.mjs';

const ROCKS = ['OX', 'TR', 'FR', 'WS', 'QZ', ''];
function fixture({ rotated = false, blanks = true } = {}) {
  const { rows } = makeSubblockRows({ seed: 11, nx: 6, ny: 5, nz: 3 });
  const out = rows.map((r, i) => ({ ...r, ROCK: ROCKS[(i * 7 + (i >> 5)) % ROCKS.length], XC: blanks && i % 97 === 13 ? null : r.XC }));
  const fields = [
    { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' },
    { name: 'V', type: 'N' }, { name: 'ROCK', type: 'A' },
    ...(rotated ? [{ name: 'ROTAXIS1', type: 'N', constant: 3 }, { name: 'ANGLE1', type: 'N', constant: -35 }, { name: 'X0', type: 'N', constant: 500000 }, { name: 'Y0', type: 'N', constant: 7000000 }, { name: 'Z0', type: 'N', constant: 100 }] : []),
  ];
  return { blob: new Blob([makeDM(fields, out, { precision: 'ep' })]), rows: out };
}

// a pool's behaviour without workers: every unit started at once, finishing in REVERSE
// order, handed back in unit order (as @gcu/scan's dm runner does)
const scrambled = {
  async discover({ file, h, p, units, onProgress }) {
    const out = new Array(units.length);
    await Promise.all(units.map((u, g) => new Promise((r) => setTimeout(r, (units.length - g) * 2)).then(async () => { out[g] = await dmDiscoverRun(file, h, u.res != null ? { ...p, res: u.res } : p, u); })));
    if (onProgress) onProgress(units.reduce((a, u) => a + u.count, 0));
    return out;
  },
  async *decode({ file, h, p, units }) {
    const all = await Promise.all(units.map((u, g) => new Promise((r) => setTimeout(r, (units.length - g) * 2)).then(() => dmDecodeRun(file, h, p, u))));
    for (const u of all) yield u;
  },
};

async function drain(m, chunkPoints) {
  const keys = ['x', 'y', 'z', 'chan', 'cat', 'dimQ', 'recIdx'], acc = Object.fromEntries(keys.map((k) => [k, []]));
  for await (const c of m.streamChunks({ chunkPoints })) for (const k of keys) if (c[k]) acc[k].push(...c[k]);
  return acc;
}
const headerOf = (h) => JSON.stringify({ grid: h.grid, bbox: h.bbox, subBlocked: h.subBlocked, sizeQMax: h.sizeQMax, sizeShapes: h.sizeShapes, cats: h.categories, lattice: h.lattice, refused: h.subBlockRefused });

for (const rotated of [false, true]) {
  test(`dm open: many units, any runner === one unit (${rotated ? 'rotated' : 'axis-aligned'} sub-blocked, blanks, a category)`, async () => {
    const { blob, rows } = fixture({ rotated });
    const one = await openDmModel(blob, { unitRecords: 1 << 30 });
    const a = await drain(one, 1 << 30);
    for (const [runner, unitRecords, chunkPoints] of [[dmPageRunner, 37, 41], [scrambled, 53, 29], [scrambled, 1, 7]]) {
      const m = await openDmModel(blob, { runner, unitRecords });
      assert.ok(dmOpenRuns(m.header.dm, unitRecords).length > 5, 'cut into several units');
      const b = await drain(m, chunkPoints);
      assert.equal(headerOf(m.header), headerOf(one.header), 'header');
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], `stream ${k}`);
    }
    // and the one-unit answer is the file's: every record with a centroid, raw numbers, codes in first-appearance order
    const want = rows.map((r, i) => (r.XC == null ? -1 : i)).filter((i) => i >= 0);
    assert.deepEqual(a.recIdx, want, 'raw record numbers, blanks skipped and not reused');
    assert.ok(one.header.subBlocked && one.header.grid, 'sub-blocked boxes');
    const order = []; for (const i of want) { const v = rows[i].ROCK; if (!order.includes(v)) order.push(v); }
    assert.deepEqual(one.header.categories, order, 'category codes in first-appearance order');
    assert.deepEqual(a.cat, want.map((i) => order.indexOf(rows[i].ROCK)), 'per-record codes');
  });
}

test('sizeCollector: partials merged in order === one sweep (indices, representatives, min/max)', () => {
  const vals = [];
  for (let i = 0; i < 5000; i++) vals.push([1 + (i % 7) * (1 + 1e-9 * (i % 3)), 2 + (i % 5), 0.5 * (1 + (i % 4))]);
  const one = sizeCollector(); for (const v of vals) one.add(...v);
  for (const cut of [1, 13, 999]) {
    const m = sizeCollector();
    for (let a = 0; a < vals.length; a += cut) { const p = sizeCollector(); for (const v of vals.slice(a, a + cut)) p.add(...v); m.merge(p.toJSON()); }
    assert.deepEqual(m.toJSON(), one.toJSON(), `cut ${cut}`);
    assert.deepEqual([m.count, m.shapes, m.min, m.max], [one.count, one.shapes, one.min, one.max]);
  }
});
