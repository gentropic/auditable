// Test-only synthetic look-alike of a rotated, sub-blocked Datamine model (the
// shape of an Isatis.neo export: parents 20 × 20 × 10 m, sub-blocks integer on a
// 1 m lattice, many shapes, a single rotation ANGLE1 about Z, XC/YC/ZC in the
// model's own frame). Deterministic; pure JS, so node tests and the browser smokes
// (served from the repo root) share it. Used by test/condenser-support.test.mjs and
// micro-smoke2.
import { makeDM } from './dm-make.mjs';

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// a random split of `len` metres into integer parts (1..len), or the whole
function split(rnd, len, pWhole) {
  if (rnd() < pWhole) return [len];
  const parts = [];
  let left = len;
  while (left > 0) { const p = Math.min(left, 1 + Math.floor(rnd() * Math.min(left, len * 0.7))); parts.push(p); left -= p; }
  return parts;
}

/**
 * → { rows: [{ XC, YC, ZC, XINC, YINC, ZINC, V }], shapes, local: { min, max } }
 * nx × ny × nz parents of px × py × pz m from local (0, 0, 0); each parent kept whole
 * or split into integer sub-blocks (odd sizes included).
 */
export function makeSubblockRows({ seed = 7, nx = 8, ny = 6, nz = 4, px = 20, py = 20, pz = 10, pWhole = 0.25, maxOver = null } = {}) {
  const rnd = mulberry(seed), rows = [], shapes = new Set();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const sx = split(rnd, px, pWhole), sy = split(rnd, py, pWhole), sz = split(rnd, pz, pWhole);
    let z0 = k * pz;
    for (const dz of sz) {
      let y0 = j * py;
      for (const dy of sy) {
        let x0 = i * px;
        for (const dx of sx) {
          const XC = x0 + dx / 2, YC = y0 + dy / 2, ZC = z0 + dz / 2;
          rows.push({ XC, YC, ZC, XINC: dx, YINC: dy, ZINC: dz, V: +(Math.sin(XC / 37) + Math.cos(YC / 23) + ZC / 40).toFixed(4) });
          shapes.add(`${dx},${dy},${dz}`);
          x0 += dx;
        }
        y0 += dy;
      }
      z0 += dz;
    }
  }
  if (maxOver) rows.push({ XC: nx * px + maxOver / 2, YC: py / 2, ZC: pz / 2, XINC: maxOver, YINC: 1, ZINC: 1, V: 0 });   // one block past 255 fine steps
  return { rows, shapes: shapes.size };
}

/** The .dm bytes: ANGLE1 about Z (ROTAXIS1 = 3), origin X0/Y0/Z0 (0 = anonymised, as the real file). */
export function makeSubblockDm(rows, { angle1 = -50, origin = [0, 0, 0] } = {}) {
  const fields = [
    { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' },
    { name: 'X0', type: 'N', constant: origin[0] }, { name: 'Y0', type: 'N', constant: origin[1] }, { name: 'Z0', type: 'N', constant: origin[2] },
    { name: 'ROTAXIS1', type: 'N', constant: 3 }, { name: 'ANGLE1', type: 'N', constant: angle1 },
    { name: 'ROTAXIS2', type: 'N', constant: 1 }, { name: 'ANGLE2', type: 'N', constant: 0 },
    { name: 'ROTAXIS3', type: 'N', constant: 3 }, { name: 'ANGLE3', type: 'N', constant: 0 },
    { name: 'V', type: 'N' },
  ];
  return new Uint8Array(makeDM(fields, rows, { precision: 'ep' }));
}

/**
 * A REGULAR rotated .dm the Datamine way: the lattice as DD constants (XMORIG…,
 * XINC…, NX…) and the same single rotation — the parent model beside a sub-blocked
 * one (rows from makeSubblockRows with pWhole = 1, local frame from 0, 0, 0).
 */
export function makeRegularDm(rows, { angle1 = -50, origin = [0, 0, 0], nx, ny, nz, px = 20, py = 20, pz = 10 } = {}) {
  const k = (name, constant) => ({ name, type: 'N', constant });
  const fields = [
    { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    k('XMORIG', 0), k('YMORIG', 0), k('ZMORIG', 0), k('XINC', px), k('YINC', py), k('ZINC', pz), k('NX', nx), k('NY', ny), k('NZ', nz),
    k('X0', origin[0]), k('Y0', origin[1]), k('Z0', origin[2]),
    k('ROTAXIS1', 3), k('ANGLE1', angle1), k('ROTAXIS2', 1), k('ANGLE2', 0), k('ROTAXIS3', 3), k('ANGLE3', 0),
    { name: 'V', type: 'N' },
  ];
  return new Uint8Array(makeDM(fields, rows.map((r) => ({ XC: r.XC, YC: r.YC, ZC: r.ZC, V: r.V })), { precision: 'ep' }));
}

/** The same blocks as CSV, in the model's own (axis-aligned) frame — the rotated model's twin. */
export function makeSubblockCsv(rows) {
  return 'XC,YC,ZC,XINC,YINC,ZINC,V\n' + rows.map((r) => `${r.XC},${r.YC},${r.ZC},${r.XINC},${r.YINC},${r.ZINC},${r.V}`).join('\n') + '\n';
}

/**
 * World centroid bounds by the documented reading, computed INDEPENDENTLY of the
 * reader: ANGLE1 turns the model axes clockwise seen from above, so a local point
 * turns by −ANGLE1 counter-clockwise; world = origin + that.
 */
export function worldCentroidBounds(rows, { angle1 = -50, origin = [0, 0, 0] } = {}) {
  const t = (-angle1 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const r of rows) {
    const p = [origin[0] + c * r.XC - s * r.YC, origin[1] + s * r.XC + c * r.YC, origin[2] + r.ZC];
    for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
  }
  return { min: mn, max: mx };
}
