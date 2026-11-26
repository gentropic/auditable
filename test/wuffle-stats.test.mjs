// wuffle's statistics and derived datasets: checked against bearing and against geometry known by construction.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable, orientations } from '../tools/wuffle/src/io.js';
import { layerStats, deriveMean, deriveEigen, deriveBeta, deriveIntersection } from '../tools/wuffle/src/stats.js';

const mk = (text, name = 'd') => { const p = new Project(); const id = p.addDataset(readTable(text, name)[0]); return { p, id }; };
const near = (a, b, t) => Math.abs(a - b) <= t;

describe('statistics', () => {
  it('tocher: 200 measurements, an axial mean with κ and α95, eigenvalues summing to 1', () => {
    const t = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');
    const { p, id } = mk(t, 'tocher');
    const s = layerStats(p.dataset(id));
    assert.equal(s.n, 200);
    assert.ok(s.mean.kappa > 0 && s.mean.alpha > 0 && s.mean.alpha < 90);
    assert.ok(near(s.eigen.values.reduce((a, b) => a + b, 0), 1, 1e-9));
  });
  it('a tight set of planes: the mean is their attitude', () => {
    const { p, id } = mk('dd,dip\n90,60\n92,61\n88,59\n90,60\n');
    const m = layerStats(p.dataset(id)).mean;
    assert.ok(near(m.plane[0], 90, 1) && near(m.plane[1], 60, 1), `${m.plane}`);
  });
  it('a subvertical set straddling the primitive keeps one mean (axial), not a nonsense average', () => {
    const { p, id } = mk('dd,dip\n90,88\n270,88\n91,89\n269,87\n');
    const m = layerStats(p.dataset(id)).mean;
    assert.ok(m.plane[1] > 85 && m.kappa > 50, `${m.plane} κ ${m.kappa}`);
  });
});

describe('faults: Michael (1984)', () => {
  it('normal faults all round → σ1 vertical, σ3 horizontal, a stress ratio between 0 and 1', () => {
    const rows = ['dd,dip,trend,plunge,sense'];
    for (const dd of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 90, 270, 90, 270]) rows.push(`${dd},60,${dd},60,N`);
    const { p, id } = mk(rows.join('\n') + '\n', 'normal');
    const s = layerStats(p.dataset(id)).stress;
    assert.equal(s.n, 16);
    assert.ok(s.axes[0][1] > 80, `σ1 ${s.axes[0]}`); assert.ok(s.axes[2][1] < 10, `σ3 ${s.axes[2]}`);
    assert.ok(s.phi >= 0 && s.phi <= 1, `φ ${s.phi}`);
  });
  it('unknown senses are left out; too few faults give no inversion', () => {
    const { p, id } = mk('dd,dip,trend,plunge,sense\n90,60,90,60,N\n80,60,80,60,U\n100,60,100,60,N\n', 'few');
    assert.equal(layerStats(p.dataset(id)).stress, null);
  });
});

describe('derived datasets', () => {
  it('the mean → a one-row planes dataset, lineage pointing at its source', () => {
    const { p, id } = mk('dd,dip\n90,60\n92,61\n88,59\n');
    const d = p.dataset(deriveMean(p, id));
    assert.equal(d.kind, 'planes'); assert.equal(d.rows.length, 1);
    assert.equal(d.lineage.op, 'mean'); assert.equal(d.lineage.sources[0].id, id);
    assert.equal(orientations(d).filter(Boolean).length, 1);
  });
  it('eigenvectors → three lines V1–V3 with their eigenvalues, descending', () => {
    const { p, id } = mk('dd,dip\n90,60\n92,61\n88,59\n100,50\n');
    const d = p.dataset(deriveEigen(p, id));
    assert.deepEqual(d.rows.map((r) => r.axis), ['V1', 'V2', 'V3']);
    assert.ok(d.rows[0].eigenvalue >= d.rows[1].eigenvalue && d.rows[1].eigenvalue >= d.rows[2].eigenvalue);
  });
  it('β: the planes of a cylindrical fold all meet near the fold axis', () => {
    // planes containing the axis 000→20: poles on the great circle normal to it
    const D = Math.PI / 180, axis = [0, Math.cos(20 * D), -Math.sin(20 * D)];
    const rows = [];
    for (let k = 0; k < 6; k++) {
      const t = (k * 30 + 15) * D, u = [1, 0, 0], w = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
      let pole = [Math.cos(t) * u[0] + Math.sin(t) * w[0], Math.cos(t) * u[1] + Math.sin(t) * w[1], Math.cos(t) * u[2] + Math.sin(t) * w[2]];
      if (pole[2] > 0) pole = pole.map((x) => -x);
      const dip = Math.acos(-pole[2]) / D, dd = (Math.atan2(-pole[0], -pole[1]) / D + 360) % 360;
      rows.push(`${dd.toFixed(4)},${dip.toFixed(4)}`);
    }
    const { p, id } = mk('dd,dip\n' + rows.join('\n') + '\n');
    const b = p.dataset(deriveBeta(p, id));
    assert.equal(b.rows.length, 15);
    for (const r of b.rows) assert.ok(near(r.plunge, 20, 0.05) && (near(r.trend, 0, 0.05) || near(r.trend, 360, 0.05)), `${r.trend}→${r.plunge}`);
  });
  it('the intersection of two limbs is the fold axis; parallel planes refuse, lines refuse', () => {
    const p = new Project();
    const a = p.addDataset(readTable('dd,dip\n90,40\n', 'east limb')[0]), b = p.addDataset(readTable('dd,dip\n270,40\n', 'west limb')[0]);
    const r = p.dataset(deriveIntersection(p, a, b)).rows[0];
    assert.ok(near(r.plunge, 0, 1e-6) && (near(r.trend, 0, 1e-6) || near(r.trend, 180, 1e-6)), `${r.trend}→${r.plunge}`);
    assert.ok(near(r.angle, 80, 1e-6));
    const c = p.addDataset(readTable('dd,dip\n90,40\n', 'again')[0]);
    assert.throws(() => deriveIntersection(p, a, c), /parallel/);
    const l = p.addDataset(readTable('trend,plunge\n10,10\n', 'lines')[0]);
    assert.throws(() => deriveIntersection(p, a, l), /intersect planes/);
  });
});
