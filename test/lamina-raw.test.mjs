// @gcu/lamina raw view (ext/lamina/src/raw.js): lines with the invisible made visible + their byte
// offsets, the raw cursor (filter / find run on it), offset ↔ line ↔ record, and hex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemorySource, splitRecordsPos, visibleText, createRawLinesView, installRawCursor, lineOfOffset, recordOffset, recordAtOffset, createHexView } from '../ext/lamina/src/main.js';

const enc = (s) => new TextEncoder().encode(s);

test('visibleText shows tabs, control characters, BOM, no-break space and trailing spaces', () => {
  assert.equal(visibleText('a\tb'), 'a⇥b');
  assert.equal(visibleText('x\u0000y\u001b'), 'x␀y␛');
  assert.equal(visibleText('﻿ID'), '⟨BOM⟩ID');
  assert.equal(visibleText('1 234'), '1⍽234');
  assert.equal(visibleText('OXIDE  '), 'OXIDE··');
  assert.equal(visibleText('plain text'), 'plain text');
});

test('raw lines: each line with its byte offset and its ending, CRLF and LF told apart', async () => {
  const bytes = enc('id,v\r\n1,"a\nb"\n2,x \n3,y');
  const src = buildMemorySource(bytes, { kind: 'text', blockSize: 2 });
  const vs = createRawLinesView(src);
  assert.equal(vs.rowCount(), 5);                                  // lines, not records: the quoted newline splits
  const rows = []; for (let r = 0; r < 5; r++) rows.push(await vs.ensureRow(r));
  assert.deepEqual(rows, [['0', 'id,v␍␊'], ['6', '1,"a␊'], ['11', 'b"␊'], ['14', '2,x·␊'], ['19', '3,y']]);
});

test('raw cursor: the same fields for a scan, and readByLoc reads one line back', async () => {
  const bytes = enc('alpha\nbeta\r\ngamma\n');
  const cur = installRawCursor(buildMemorySource(bytes, { kind: 'text', blockSize: 2 }));
  const seen = [];
  await cur.eachRecord({}, (disp, f, loc, len) => { seen.push([disp, f, loc, len]); });
  assert.deepEqual(seen, [[0, ['0', 'alpha␊'], 0, 6], [1, ['6', 'beta␍␊'], 6, 6], [2, ['12', 'gamma␊'], 12, 6]]);
  assert.deepEqual(await cur.readByLoc(6, 6), ['6', 'beta␍␊']);
});

test('a block wider than the read window is cut, and says so', async () => {
  const bytes = enc('x'.repeat(100) + '\nshort\n');
  const vs = createRawLinesView(buildMemorySource(bytes, { kind: 'text', blockSize: 4 }), { maxBlockBytes: 40 });
  const r0 = await vs.ensureRow(0);
  assert.match(r0[1], /^x{40} … \(the line goes on — see hex\)$/);
  assert.match((await vs.ensureRow(1))[1], /not read; see hex/);
});

test('offset ↔ line, and record ↔ offset in a quote-aware table source', async () => {
  const text = 'id,v\n1,"a\nb"\n2,x\n3,y\n';
  const bytes = enc(text);
  const lines = buildMemorySource(bytes, { kind: 'text', blockSize: 2 });
  assert.equal(await lineOfOffset(lines, 0), 0);
  assert.equal(await lineOfOffset(lines, text.indexOf('2,x')), 3);   // after the quoted newline: line 3
  const table = buildMemorySource(bytes, { kind: 'delimited', blockSize: 2 });
  const split = (b) => splitRecordsPos(b, { kind: 'delimited' });
  assert.equal(await recordOffset(table, 2, split), text.indexOf('2,x'));   // record 2 is "2,x" (record 1 spans two lines)
  assert.equal(await recordAtOffset(table, text.indexOf('b"'), split), 1);   // inside the quoted field → record 1
  assert.equal(await recordAtOffset(table, text.indexOf('3,y'), split), 3);
});

test('hex: 16 bytes a row, offset in hex, text with dots; the cursor scans the same rows', async () => {
  const bytes = new Uint8Array(40); for (let i = 0; i < 40; i++) bytes[i] = i < 26 ? 65 + i : i;
  const { view, cursor } = createHexView({ totalBytes: 40, readRange: async (o, l) => bytes.subarray(o, o + l) }, { rowsPerBlock: 2 });
  assert.equal(view.rowCount(), 3);
  const r0 = await view.ensureRow(0), r2 = await view.ensureRow(2);
  assert.equal(r0[0], '00000000');
  assert.equal(r0[1], '41 42 43 44 45 46 47 48  49 4a 4b 4c 4d 4e 4f 50');
  assert.equal(r0[2], 'ABCDEFGHIJKLMNOP');
  assert.equal(r2[0], '00000020');
  assert.equal(r2[2], ` !"#$%&'`);
  assert.equal((await view.ensureRow(1))[2], 'QRSTUVWXYZ......');
  assert.equal(r2[1].trimEnd(), '20 21 22 23 24 25 26 27');
  const offs = []; await cursor.eachRecord({}, (d, f, loc) => offs.push(loc));
  assert.deepEqual(offs, [0, 16, 32]);
  assert.deepEqual(await cursor.readByLoc(16, 16), (await view.ensureRow(1)));
});
