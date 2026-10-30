// qualified assay numbers: <0.001 / >10 / lab codes → numbers under a policy,
// and the CSV block-model + drillhole readers treating such columns as numeric
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyQualified, qualifiedNumber, censusQualified, describeQualified, openBlockModel, openDrillholes } from '../ext/condenser/src/main.js';

test('classifyQualified: numbers, below/above, codes, text, blank', () => {
  const k = (s) => classifyQualified(s).kind;
  assert.equal(k('0.0011'), 'num'); assert.equal(k(' 2e-3 '), 'num'); assert.equal(k(-0.5), 'num');
  assert.equal(k('<0.001'), 'below'); assert.equal(k('< .005'), 'below'); assert.equal(k('<=0.01'), 'below'); assert.equal(k('≤1'), 'below');
  assert.equal(k('>10'), 'above'); assert.equal(k('≥ 2.5'), 'above');
  for (const c of ['BDL', 'b.d.l.', 'ND', 'n.d.', 'LNR', 'IS', 'NSS', 'n/a', 'NA', '-', '--', '*']) assert.equal(k(c), 'code', c);
  assert.equal(k('OXIDE'), 'text'); assert.equal(k('<DL'), 'text');
  assert.equal(k(''), 'blank'); assert.equal(k('  '), 'blank'); assert.equal(k(null), 'blank');
  assert.equal(classifyQualified('<0.001').v, 0.001);
});

test('qualifiedNumber: the policy decides', () => {
  assert.equal(qualifiedNumber('<0.002'), 0.001);                          // default: half the limit
  assert.equal(qualifiedNumber('<0.002', { below: 'limit' }), 0.002);
  assert.equal(qualifiedNumber('<0.002', { below: 'zero' }), 0);
  assert.ok(Number.isNaN(qualifiedNumber('<0.002', { below: 'blank' })));
  assert.equal(qualifiedNumber('>10'), 10);
  assert.ok(Number.isNaN(qualifiedNumber('>10', { above: 'blank' })));
  assert.ok(Number.isNaN(qualifiedNumber('BDL'))); assert.ok(Number.isNaN(qualifiedNumber('')));
  assert.equal(qualifiedNumber('-0.004'), -0.004);                         // negatives untouched by default…
  assert.equal(qualifiedNumber('-0.004', { below: 'half', negBelow: true }), 0.002);   // …unless the column says so
  assert.equal(qualifiedNumber('3.5'), 3.5); assert.equal(qualifiedNumber(7), 7);
  assert.equal(describeQualified(), '<x → x/2 · >x → x');
});

test('censusQualified: numeric once qualifiers count, never all-codes, never with text', () => {
  const c = censusQualified(['<0.001', '0.0011', '0.0038', 'BDL', '>5', '']);
  assert.deepEqual([c.numeric, c.qualified, c.num, c.below, c.above, c.code], [true, true, 2, 1, 1, 1]);
  assert.equal(censusQualified(['BDL', 'ND']).numeric, false);
  assert.equal(censusQualified(['0.1', 'OXIDE']).numeric, false);
  assert.deepEqual([censusQualified(['0.1', '0.2']).numeric, censusQualified(['0.1', '0.2']).qualified], [true, false]);
});

const csvBlob = (t) => new Blob([t]);
const collectChan = async (sc) => { const out = []; for await (const c of sc()) out.push(...c.chan); return out; };

test('openBlockModel: a <x column is numeric, qualified, and colours by its substitute', async () => {
  let t = 'XC,YC,ZC,CU_pct,LITO\n';
  const cu = ['<0.002', '0.0011', '0.0038', '>0.5', '0.0070', 'BDL', '0.0030', '0.0036'];
  for (let i = 0; i < 8; i++) t += `${i * 10},0,0,${cu[i]},OX\n`;
  const { header, streamChunks } = await openBlockModel(csvBlob(t), { rotated: false });
  const i = header.columns.indexOf('CU_pct');
  assert.ok(header.numericColumns.some((c) => c.i === i), 'numeric');
  assert.deepEqual(header.qualifiedColumns.map((c) => [c.name, c.below, c.above, c.code]), [['CU_pct', 1, 1, 1]]);
  assert.equal(header.mapping.chan, i);                                   // the auto channel isn't demoted
  assert.equal(header.columns[header.mapping.cat], 'LITO');               // and doesn't become the category
  const v = await collectChan(streamChunks);
  assert.equal(v[0], 0.001); assert.equal(v[3], 0.5); assert.ok(Number.isNaN(v[5]));
  const { streamChunks: s2 } = await openBlockModel(csvBlob(t), { rotated: false, qualify: { CU_pct: { below: 'limit' } } });
  assert.equal((await collectChan(s2))[0], 0.002);                        // the column's own policy
});

test('openDrillholes: a <x interval column is numeric and colours by its substitute', async () => {
  const collar = csvBlob('BHID,X,Y,Z\nH1,0,0,100\n');
  const survey = csvBlob('BHID,AT,AZ,DIP\nH1,0,0,-90\n');
  const intervals = csvBlob('BHID,FROM,TO,CU_pct,SAMPLE_ID\nH1,0,2,<0.001,S1\nH1,2,4,0.0011,S2\nH1,4,6,0.0038,S3\n');
  const doc = await openDrillholes({ collar, survey, intervals });
  const h = doc.header;
  const i = h.columns.indexOf('CU_pct');
  assert.ok(h.numericColumns.some((c) => c.i === i));
  assert.deepEqual(h.qualifiedColumns.map((c) => [c.name, c.below]), [['CU_pct', 1]]);
  assert.equal(h.mapping.chan, i);
  assert.equal(h.chanRange[0], 0.0005);
});
