// @gcu/condenser — RFC 4180 quoting in the delimited readers: a quoted field
// may hold the delimiter, a line break, or a doubled quote, and every reader
// built on the record layer (sniff, both sweeps, the record index, tables,
// drillhole trios) must see one record where the file has one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFields, endsInQuote, RecordJoiner, sampleRecords, WS } from '../ext/condenser/src/io/delimited.js';
import { sniffDelimited, openBlockModel, openTable, lineFields, fetchDelimitedRecord, openDrillholes } from '../ext/condenser/src/main.js';

test('delimited: splitFields — plain, quoted, doubled quotes, padding, literal mid-field quote', () => {
  assert.deepEqual(splitFields('a,b,c', ','), ['a', 'b', 'c']);
  assert.deepEqual(splitFields('a,"b,c",d', ','), ['a', 'b,c', 'd']);
  assert.deepEqual(splitFields('"say ""hi""",2', ','), ['say "hi"', '2']);
  assert.deepEqual(splitFields('1, "x, y" ,3', ','), ['1', 'x, y ', '3']);         // padding before the quote is dropped; after it, kept
  assert.deepEqual(splitFields('12" core,5', ','), ['12" core', '5']);              // a quote mid-field is literal
  assert.deepEqual(splitFields('"line\none",2', ','), ['line\none', '2']);
  assert.deepEqual(splitFields('a,,"",', ','), ['a', '', '', '']);
  assert.deepEqual(splitFields('a\t\t"x"', '\t'), ['a', '', 'x']);                 // a tab delimiter is never padding
  assert.deepEqual(splitFields('  1  "two words"   3 ', WS), ['1', 'two words', '3']);
});

test('delimited: endsInQuote + RecordJoiner glue a record across lines', () => {
  assert.equal(endsInQuote('a,"open', ','), true);
  assert.equal(endsInQuote('a,"closed"', ','), false);
  assert.equal(endsInQuote('a,12" core', ','), false);                              // literal quote opens nothing
  assert.equal(endsInQuote('still inside', ',', true), true);
  assert.equal(endsInQuote('end"",here"', ',', true), false);                      // a doubled quote inside, then the close
  const j = new RecordJoiner(',');
  assert.equal(j.push('1,"a'), null);
  assert.equal(j.push('b""c'), null);
  assert.equal(j.push('d",2'), '1,"a\nb""c\nd",2');
  assert.deepEqual(splitFields('1,"a\nb""c\nd",2', ','), ['1', 'a\nb"c\nd', '2']);
  assert.deepEqual(sampleRecords('h1,h2\n1,"x\ny"\n2,"z', ','), ['h1,h2', '1,"x\ny"']);   // the cut-off record is dropped
});

// a block model whose free-text column has commas, a line break and doubled quotes
const quotedModel = () => {
  const rows = ['XC,YC,ZC,FE,NOTE'];
  let k = 0;
  for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const note = k === 4 ? '"multi\nline, with ""quotes"""' : k % 3 === 0 ? '"a, b"' : 'plain';
    rows.push(`${5 + x * 10},${5 + y * 10},${5 + z * 10},${k},${note}`);
    k++;
  }
  return rows.join('\r\n') + '\r\n';
};

test('delimited: sniff counts fields per RECORD (the "no consistent delimiter" failure)', () => {
  const s = sniffDelimited(quotedModel());
  assert.equal(s.delim, ',');
  assert.deepEqual(s.header, ['XC', 'YC', 'ZC', 'FE', 'NOTE']);
});

test('delimited: block model with quoted text — grid, every record, indexed fetch past a multi-line record', async () => {
  const blob = new Blob([quotedModel()]);
  const { header, streamChunks } = await openBlockModel(blob, { indexEvery: 2 });
  assert.equal(header.count, 27);
  assert.ok(header.grid);
  assert.deepEqual([header.grid.x.count, header.grid.y.count, header.grid.z.count], [3, 3, 3]);
  const fe = [];
  for await (const rc of streamChunks({ chunkPoints: 8 })) for (let i = 0; i < rc.count; i++) fe.push(rc.chan[i]);
  assert.deepEqual(fe, Array.from({ length: 27 }, (_, i) => i));
  const r4 = await fetchDelimitedRecord(blob, header, 4);
  assert.equal(r4[4], 'multi\nline, with "quotes"');
  for (const rec of [3, 5, 6, 26]) assert.equal(+(await fetchDelimitedRecord(blob, header, rec))[3], rec);   // anchors land on record starts
  let rows = 0;
  for await (const batch of lineFields(blob, header.delim, true)) rows += batch.length;
  assert.equal(rows, 27);
});

test('delimited: a table with quoted text counts records, not lines', async () => {
  const t = await openTable(new Blob(['ID,COMMENT,V\n1,"one, two",3\n2,"multi\nline",4\n3,plain,5\n']));
  assert.equal(t.header.count, 3);
  assert.deepEqual(t.header.numericColumns.map((c) => c.name), ['ID', 'V']);
});

test('delimited: drillhole interval table with free-text comments desurveys', async () => {
  const collar = new Blob(['BHID,X,Y,Z,EOH\nV1,1000,2000,500,100\n']);
  const survey = new Blob(['BHID,AT,AZ,DIP\nV1,0,0,90\n']);
  const intervals = new Blob(['BHID,FROM,TO,FE,COMMENT\nV1,0,2,30.1,"broken, oxidised"\nV1,2,4,31.5,"core loss\nnear 3 m, ""soft"""\nV1,4,6,40.0,ok\n']);
  const { header, fetchRecord } = await openDrillholes({ collar, survey, intervals });
  assert.equal(header.count, 3);
  assert.equal(header.placed, 3);
  const r1 = await fetchRecord(1);
  assert.ok(r1.includes('core loss\nnear 3 m, "soft"'));
});

test('delimited: sniff — spaces inside comma fields do not make whitespace the delimiter', () => {
  const s = sniffDelimited('hole id,rock type\nDH 01,fresh rock\nDH 02,weathered rock\nDH 03,fresh rock\n');
  assert.equal(s.delim, ',');
  assert.deepEqual(s.header, ['hole id', 'rock type']);
  // …but a whitespace file whose only commas are decimal marks stays whitespace
  const w = sniffDelimited('X Y Z G\n500 600 100 1,5\n510 600 100 2,25\n520 600 100 0,5\n');
  assert.equal(w.delim, WS);
  assert.equal(w.decimal, ',');
  // and a tab file with spaced text is tab, not whitespace
  assert.equal(sniffDelimited('a b\tc d\n1 2\t3 4\n5 6\t7 8\n').delim, '\t');
});

test('delimited: sniff — quoted all-numeric names over unquoted numbers are a header', () => {
  assert.deepEqual(sniffDelimited('"2019","2020"\n1,4\n2,5\n').header, ['2019', '2020']);
  assert.equal(sniffDelimited('2019,2020\n1,4\n2,5\n').header, null);                 // unquoted: still data
  assert.equal(sniffDelimited('"1","4"\n"2","5"\n"3","6"\n').header, null);           // quote-everything: the data is quoted too
  assert.deepEqual(sniffDelimited('"1","2"\n3,"a,b"\n').header, ['1', '2']);         // a quoted TEXT field in the data doesn't cancel it
});

test('delimited: a quoted "#" field is data, not a comment line', async () => {
  const { header } = await openTable(new Blob(['"tag",v\n"#1",1\nA,2\n"#N/A",3\n']));
  assert.equal(header.count, 3);
});

test('delimited: a blank category value is its own category, not the first real one', async () => {
  const csv = 'XC,YC,ZC,AU,ROCK\n5,5,5,1,OX\n15,5,5,2,\n25,5,5,3,FR\n';
  const { header, streamChunks } = await openBlockModel(new Blob([csv]), { rotated: false, mapping: { x: 0, y: 1, z: 2, chan: 3, cat: 4 } });
  assert.deepEqual(header.categories, ['', 'FR', 'OX']);
  const codes = [];
  for await (const rc of streamChunks({ chunkPoints: 8 })) for (let i = 0; i < rc.count; i++) codes.push(header.categories[rc.cat[i]]);
  assert.deepEqual(codes, ['OX', '', 'FR']);
});
