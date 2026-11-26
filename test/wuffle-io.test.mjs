// wuffle's readers: delimited text → dataset specs → orientations. Never refuses at read time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDelimited, sniffRoles, readTable, orientations } from '../tools/wuffle/src/io.js';
import { Project } from '../tools/wuffle/src/model.js';

const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;
const read1 = (text, name) => { const [s] = readTable(text, name); return s; };

describe('the tocher sample (Tocher 1979)', () => {
  const text = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');
  it('200 planes, dip direction / dip from the header, comment lines skipped', () => {
    const s = read1(text, 'tocher');
    assert.equal(s.kind, 'planes');
    assert.equal(s.rows.length, 200);
    assert.deepEqual(s.roles, { dipDir: 'dip direction', dip: 'dip' });
    assert.equal(s.meta.read.guessed, false);
    assert.equal(s.rows[0]['dip direction'], 147.704);
  });
  it('every row becomes a pole in the lower hemisphere, and the project takes it as it comes', () => {
    const s = read1(text, 'tocher');
    const p = new Project(); const d = p.addDataset(s);
    const o = orientations(p.dataset(d));
    assert.equal(o.filter(Boolean).length, 200);
    assert.ok(o.every((x) => x.pole[2] <= 0));
  });
});

describe('the shipped samples', () => {
  it('src/samples.js carries samples/tocher.csv byte for byte (regenerate: node tools/wuffle/dev/gen-samples.mjs)', async () => {
    const { TOCHER } = await import('../tools/wuffle/src/samples.js');
    assert.equal(TOCHER, readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8'));
  });
});

describe('sniffing', () => {
  it('headerless, whitespace: the first two numbers as dip direction / dip, flagged as a guess', () => {
    const s = read1('147.7 64.8\n113.6 50.4\n126.5 44.6\n');
    assert.deepEqual(s.roles, { dipDir: 'c1', dip: 'c2' });
    assert.equal(s.meta.read.guessed, true);
    assert.match(s.meta.read.why, /dip direction/);
  });
  it('dip first: swapped when the second column passes 90', () => {
    const s = read1('64 147\n50 113\n44 126\n');
    assert.deepEqual(s.roles, { dipDir: 'c2', dip: 'c1' });
    assert.match(s.meta.read.why, /swapped/);
  });
  it('semicolons with decimal commas; RFC 4180 quotes', () => {
    const a = read1('DD;DIP;NOTE\n045,5;72,25;calcite\n050;70;"open; 2 mm"\n');
    assert.equal(a.rows[0].DD, 45.5); assert.equal(a.rows[0].DIP, 72.25);
    assert.equal(a.meta.read.decimalComma, true);
    const b = read1('dd,dip,note\n45,72,"fill, ""calcite"""\n');
    assert.equal(b.rows[0].note, 'fill, "calcite"');
  });
  it('strike / dip is the right-hand rule: dip direction = strike + 90', () => {
    const s = read1('Strike,Dip\n0,60\n');
    assert.equal(s.notation, 'rhr');
    const o = orientations({ ...s, id: 'x' });
    assert.deepEqual(o[0].plane, [90, 60]);
  });
  it('trend / plunge → lines; plane + line + sense → faults; axis + angle → small circles', () => {
    assert.equal(read1('trend,plunge\n120,30\n').kind, 'lines');
    const f = read1('dip direction,dip,trend,plunge,sense\n90,60,90,60,N\n');
    assert.equal(f.kind, 'faults'); assert.equal(f.roles.sense, 'sense');
    const o = orientations(f)[0];
    assert.ok(o.pole && o.lineDcos && o.sense === 'N');
    assert.equal(read1('trend,plunge,angle\n0,90,30\n').kind, 'smallcircles');
  });
  it('a single attitude column: 045/30 and quadrant notation (a strike, the dip quadrant picks the side)', () => {
    const s = read1('attitude\n045/30\nN30E 40SE\n120/85\n');
    assert.equal(s.roles.attitude, 'attitude');
    const o = orientations(s);
    assert.deepEqual(o[0].plane, [45, 30]);
    assert.ok(near(o[1].plane[0], 120) && o[1].plane[1] === 40, `N30E 40SE → ${o[1].plane}`);
  });
  it('a set column is carried as a role', () => {
    assert.deepEqual(sniffRoles(['DD', 'DIP', 'Set'], [{ DD: 1, DIP: 2, Set: 'J1' }]).roles, { dipDir: 'DD', dip: 'DIP', set: 'Set' });
  });
});

describe('never refuses', () => {
  it('unreadable rows are kept as rows but have no orientation; short lines are counted as skipped', () => {
    const s = read1('dd,dip\n45,30\nabc,30\n50,120\nlonely\n60,40\n');
    assert.equal(s.meta.read.skipped, 1);
    const o = orientations(s);
    assert.deepEqual(o.map(Boolean), [true, false, false, true]);
  });
  it('nothing usable still gives a dataset that says why', () => {
    const s = read1('name,comment\nfoo,bar\n');
    assert.equal(s.meta.read.why, 'no orientation columns found');
  });
});

describe("wuffle's own field log", () => {
  it('planes and lines in one file become two datasets', () => {
    const log = 'type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo\n'
      + 'plane,45,72,315,2026-11-26T10:00:00Z,-20.1,-43.9,3,true,-21.4,\nline,120,30,,2026-11-26T10:01:00Z,,,,magnetic,,\nplane,48,70,318,2026-11-26T10:02:00Z,,,,true,-21.4,p1.jpg\n';
    const specs = readTable(log, 'b3');
    assert.deepEqual(specs.map((s) => [s.name, s.kind, s.rows.length]), [['b3 · planes', 'planes', 2], ['b3 · lines', 'lines', 1]]);
    assert.deepEqual(orientations(specs[1])[0].line, [120, 30]);
  });
});

describe('parseDelimited', () => {
  it('tabs, pipes, BOM, duplicate header names', () => {
    const t = parseDelimited('﻿a\tb\ta\n1\t2\t3\n');
    assert.equal(t.delimiter, '\t');
    assert.deepEqual(t.columns, ['a', 'b', 'a_2']);
    assert.equal(parseDelimited('x|y\n1|2\n').delimiter, '|');
  });
});

describe('one attitude column: the arrow decides', () => {
  it('a column of trend→plunge (or >) is lines, read as lines', () => {
    const [d] = readTable('att\n045→30\n310→70\n200>20\n', 'x');
    assert.equal(d.kind, 'lines');
    assert.deepEqual(orientations(d).map((o) => o.line), [[45, 30], [310, 70], [200, 20]]);
  });
  it('a column mixing planes and lines splits into two datasets', () => {
    const r = readTable('att\n045/30\n310→70\n120/40\n', 'x');
    assert.deepEqual(r.map((d) => [d.name, d.kind, d.rows.length]), [['x · planes', 'planes', 2], ['x · lines', 'lines', 1]]);
    assert.deepEqual(orientations(r[1]).map((o) => o.line), [[310, 70]]);
  });
  it('a guess over named columns says they are names wuffle doesn\'t know, not "no named columns"', () => {
    assert.match(readTable('azimuth,inclination\n10,20\n30,40\n', 'x')[0].meta.read.why, /^no column names wuffle knows/);
    assert.match(readTable('10,20\n30,40\n', 'x')[0].meta.read.why, /^no named columns/);
  });
});

describe('delimiters, from the review', () => {
  it('a headerless semicolon file with decimal commas reads as numbers, not as comma-split words', () => {
    const t = parseDelimited('120,5;40,2\n130,1;35,7\n140,0;30,9\n');
    assert.equal(t.delimiter, ';'); assert.equal(t.decimalComma, true);
    assert.deepEqual(t.rows[0], { c1: 120.5, c2: 40.2 });
  });
  it('one odd line in a four-line file: the delimiter still found, the odd line counted as skipped', () => {
    const t = parseDelimited('dd,dip\n10,20\nhello\n30,40\n');
    assert.equal(t.delimiter, ','); assert.equal(t.rows.length, 2); assert.equal(t.skipped, 1);
  });
});
