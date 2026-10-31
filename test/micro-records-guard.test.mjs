// micro: records, not rows. layerRecords (src/records.js) owns "what number is
// this record" — a delimited row with no coordinates was dropped at the open and
// is NOT a record, and every path that numbered raw rows itself (the joins'
// back-attach, the zebra, the column stats) gave later records their
// neighbour's values. A raw layerRows() walk is still right for some jobs (a
// keyed lookup table, raw export text, a drillhole's intervals) — but each one
// must say why, on the line: /* rows ok: <reason> */.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../tools/micro/', import.meta.url);

test('every raw layerRows() walk outside records.js says why rows are right', () => {
  const files = ['index.html', ...readdirSync(new URL('src/', ROOT)).filter((f) => f.endsWith('.js') && f !== 'records.js').map((f) => 'src/' + f)];
  const bare = [];
  for (const f of files) {
    readFileSync(new URL(f, ROOT), 'utf8').split('\n').forEach((ln, i) => {
      if (/\blayerRows\(/.test(ln) && !/rows ok:/.test(ln) && !/^\s*(\/\/|\*)/.test(ln) && !/^import\b/.test(ln.trim())) bare.push(`${f}:${i + 1}: ${ln.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(bare, [], 'walk layerRecords(L) — or mark the line /* rows ok: <reason> */');
});
