// the compass's signed log in a project: the signature is checked (and a changed byte caught), the drop is
// gathered (log + .sig + the photos it names), and the ORIGINAL survives a .zip.wuffle round trip byte for
// byte while the data read from it stays editable; /project/field shows it read-only; undo takes it back.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLog, gather, isFieldLog, photoNames, describe as say } from '../tools/wuffle/src/field-log.js';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { writeProject, readProject } from '../tools/wuffle/src/project-file.js';
import { projectFs } from '../tools/wuffle/src/project-fs.js';

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');
// exactly what field.js publishes (a CRLF-free CSV, a photo on the second row)
const LOG = 'type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo\n'
  + 'plane,120,45,30,2026-11-20T14:02:11.000Z,-30.1,-51.2,4,true,-15.2,\n'
  + 'plane,118,47,28,2026-11-20T14:05:40.000Z,-30.1,-51.2,4,true,-15.2,wuffle-002-20261120T140540.jpg\n'
  + 'line,200,20,,2026-11-20T14:09:02.000Z,-30.1,-51.2,5,true,-15.2,\n';

async function signed(bytes) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes);
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  return enc.encode(JSON.stringify({ file: 'wuffle-log.csv', alg: 'ECDSA-P256-SHA256', sig: b64(sig), pub: b64(pub), hash: '', security: 'strongbox', signedAt: '2026-11-20T15:00:00Z' }, null, 1));
}

describe('field-log.js — the signature', () => {
  it('verifies the exact bytes, and catches one changed byte', async () => {
    const bytes = enc.encode(LOG), sig = await signed(bytes);
    const v = await verifyLog(bytes, sig);
    assert.equal(v.state, 'verified'); assert.equal(v.security, 'strongbox'); assert.match(v.key, /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    assert.match(say(v), /verified/);
    const tampered = bytes.slice(); tampered[tampered.indexOf(0x34)] = 0x35;   // a 4 → 5 somewhere in the numbers
    assert.equal((await verifyLog(tampered, sig)).state, 'mismatch');
  });
  it('no .sig is "unsigned", a broken one is "unreadable" — never a throw', async () => {
    assert.equal((await verifyLog(enc.encode(LOG), null)).state, 'unsigned');
    assert.equal((await verifyLog(enc.encode(LOG), enc.encode('not json'))).state, 'unreadable');
    assert.equal((await verifyLog(enc.encode(LOG), enc.encode('{"alg":"RSA"}'))).state, 'unreadable');
  });
});

describe('field-log.js — gathering a drop', () => {
  it('a log takes its .sig and the photos it names; strays are reported, other data passes through', async () => {
    assert.ok(isFieldLog(LOG)); assert.ok(!isFieldLog('dd,dip\n10,20\n'));
    assert.deepEqual(photoNames(LOG), ['wuffle-002-20261120T140540.jpg']);
    const f = (name, s) => ({ name, bytes: typeof s === 'string' ? enc.encode(s) : s });
    const g = gather([f('wuffle-log.csv', LOG), f('wuffle-log.csv.sig', '{}'), f('wuffle-002-20261120T140540.jpg', new Uint8Array([0xff, 0xd8])),
      f('other.jpg', new Uint8Array([1])), f('planes.csv', 'dd,dip\n10,20\n')]);
    assert.equal(g.logs.length, 1); assert.equal(g.logs[0].sig.name, 'wuffle-log.csv.sig'); assert.equal(g.logs[0].photos.length, 1);
    assert.deepEqual(g.rest.map((x) => x.name), ['planes.csv']); assert.deepEqual(g.stray.map((x) => x.name), ['other.jpg']);
  });
});

describe('a field original in a project', () => {
  async function withOriginal() {
    const p = new Project({ name: 'serra' }), bytes = enc.encode(LOG), sig = await signed(bytes), jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    p.batch('open field log', () => {
      const oid = p.addOriginal({ name: 'field 2026-11-20', file: 'wuffle-log.csv', bytes, sig, photos: [{ name: 'wuffle-002-20261120T140540.jpg', bytes: jpg }] });
      for (const s of readTable(LOG, p.original(oid).name)) p.addDataset({ ...s, lineage: { op: 'field log', original: p.original(oid).name } });
    });
    return { p, bytes, sig, jpg };
  }
  it('round-trips a .zip.wuffle byte for byte, and still verifies; the data beside it stays editable', async () => {
    const { p, bytes, sig, jpg } = await withOriginal();
    const planes = p.datasets.find((d) => d.kind === 'planes');
    p.editRows(planes.id, (rows) => rows.slice(0, 1));                         // edit the working copy …
    const { project: q, warnings } = await readProject(await writeProject(p));
    assert.deepEqual(warnings, []);
    const o = q.originals[0];
    assert.equal(o.name, 'field 2026-11-20'); assert.equal(o.file, 'wuffle-log.csv');
    assert.deepEqual([...o.bytes], [...bytes]); assert.deepEqual([...o.sig], [...sig]); assert.deepEqual([...o.photos[0].bytes], [...jpg]);
    assert.equal((await verifyLog(o.bytes, o.sig)).state, 'verified');           // … the original is untouched
    assert.equal(q.datasets.find((d) => d.kind === 'planes').rows.length, 1);
  });
  it('/project/field shows it read-only; rm -r takes it whole; undo brings it back', async () => {
    const { p, bytes } = await withOriginal();
    const fs = projectFs(p);
    assert.ok((await fs.readdir('/')).includes('field'));
    assert.deepEqual(await fs.readdir('/field'), ['field 2026-11-20']);
    assert.deepEqual(await fs.readdir('/field/field 2026-11-20'), ['photos', 'wuffle-log.csv', 'wuffle-log.csv.sig']);
    assert.deepEqual([...(await fs.readFile('/field/field 2026-11-20/wuffle-log.csv', 'bytes'))], [...bytes]);
    await assert.rejects(fs.writeFile('/field/field 2026-11-20/wuffle-log.csv', 'x'), /kept exactly as it came/);
    await assert.rejects(fs.unlink('/field/field 2026-11-20/wuffle-log.csv.sig'), /goes whole/);
    await assert.rejects(fs.writeFile('/field/new.csv', 'x'), /originals as they came/);
    await fs.rmdir('/field/field 2026-11-20', { recursive: true });
    assert.equal(p.originals.length, 0);
    p.undo(); assert.equal(p.originals.length, 1);
  });
});
