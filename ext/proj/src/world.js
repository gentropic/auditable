// @gcu/proj world — Natural Earth 1:110m land outlines (public domain), for a CRS selector's map.
//   await worldRings() → [Float64Array [lon0, lat0, lon1, lat1, …], …] (closed implicitly)
// Inflated on first call (DecompressionStream), cached.
import { WORLD_GZ_B64, WORLD_SOURCE } from './data-world.js';
import { gunzipBase64 } from './table.js';

export { WORLD_SOURCE };
let _rings = null;
export async function worldRings() {
  if (_rings) return _rings;
  const u8 = await gunzipBase64(WORLD_GZ_B64);
  const a = new Int32Array(u8.slice().buffer);
  const q = WORLD_SOURCE.quantum;
  const out = [];
  let k = 1;
  for (let r = 0; r < a[0]; r++) {
    const n = a[k++];
    const ring = new Float64Array(2 * n);
    let x = a[k++], y = a[k++];
    ring[0] = x * q; ring[1] = y * q;
    for (let i = 1; i < n; i++) { x += a[k++]; y += a[k++]; ring[2 * i] = x * q; ring[2 * i + 1] = y * q; }
    out.push(ring);
  }
  _rings = out;
  return out;
}
