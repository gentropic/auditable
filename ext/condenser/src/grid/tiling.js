// @gcu/condenser — do a sub-blocked model's blocks TILE their parents?
//
// A sub-blocked model is a parent lattice (the cells a regular model would have)
// with each parent split into sub-blocks. Received from another package, the split
// is worth checking before anyone reports from it: every parent's sub-blocks should
// fill it exactly — no gap (volume under the parent's), no two sub-blocks claiming
// the same space (an overlap — volume over), none reaching out of its parent.
//
// Streaming, one pass, never a whole-model fine grid (a real 18.7M-block file has
// ~9 billion fine cells): each block lands in its parent by its LOW corner; a parent
// keeps a volume sum (one number) and — while it is OPEN — an occupancy bitmap of
// its own fine cells. Blocks of a parent arrive together in every exporter we have
// seen (Datamine sorts by IJK), so a small FIFO of open parents is enough; a parent
// whose blocks come back after it was closed is COUNTED (revisited), and overlaps
// between its two visits are not seen — said, never guessed.
//
// Coordinates: the block-support contract (grid/support.js). Positions arrive in
// WORLD; each is carried into the model's lattice frame (q = Rᵀ(p − anchor)) and
// read in HALF fine steps from the lattice origin, so a centroid is an even integer
// and a corner (centroid ∓ size) an integer — exact arithmetic, no tolerance past
// the one rounding of the centroid.

/**
 * A tiling checker for a support (sup.sub must be true).
 * opts:
 *   parentSize [3] — a parent's size in FINE steps (the largest sub-block, by default the header's sizeQMax)
 *   phase      [3] | null — the lattice-frame coordinate of a parent CORNER (Datamine XMORIG…: local frame);
 *                  null → found from the first block that spans a whole parent along an axis
 *   unit       [3] — the occupancy cell in fine steps (2 when the pitch is half the sizes' GCD — every
 *                  valid sub-block corner then lands on it; 1 always works, 4–8× the work)
 *   ijk        { nx, ny, nz } | null — check a Datamine IJK column: IJK = (I·NY + J)·NZ + K, parents from the phase
 *   keep       how many offending record numbers each finding keeps (the count is always exact)
 *   openBytes  the budget for open parents' bitmaps
 * → { add(chunk), finish() }; chunk = { x, y, z, dimQ (u8 ×3 fine steps), recs, count, ijk? (Float64Array) }
 */
export function tilingChecker(sup, { parentSize, phase = null, unit = [1, 1, 1], ijk = null, keep = 200000, openBytes = 32 << 20, maxBuffered = 1 << 20 } = {}) {
  if (!sup || !sup.sub) throw new Error('tiling: needs a sub-blocked support');
  const R = sup.frame.R, A = sup.frame.anchor, rot = sup.frame.rotated;
  const P = sup.lattice.pitch, OQ = sup.lattice.originQ, NF = sup.lattice.count;
  const Pq = parentSize.map((v) => Math.max(1, Math.round(v)));
  const U = [0, 1, 2].map((a) => (unit[a] > 1 && Pq[a] % unit[a] === 0 ? unit[a] : 1));
  const P2 = Pq.map((v) => 2 * v), U2 = U.map((v) => 2 * v);
  const C = [0, 1, 2].map((a) => Pq[a] / U[a]);           // occupancy cells per parent, per axis
  const W = Math.ceil(C[0] / 32), words = W * C[1] * C[2];
  const maxOpen = Math.max(4, Math.min(4096, Math.floor(openBytes / (4 * words))));
  const fullVol = P2[0] * P2[1] * P2[2];                  // in half-step³ (exact integers)
  // the parent corner in half fine steps from the lattice origin (stated, or found below)
  let phi2 = phase ? phase.map((v, a) => 2 * (v - OQ[a]) / P[a]) : null;
  let phaseFrom = phase ? 'stated' : null;
  if (phi2 && phi2.some((v) => Math.abs(v - Math.round(v)) > 1e-3)) { phi2 = null; phaseFrom = null; }   // a stated corner off the fine lattice: find it instead
  if (phi2) phi2 = phi2.map(Math.round);
  const found = [null, null, null];                       // the corner, per axis, from a block spanning a whole parent

  // parent index bounds: a corner (centroid − size) is ≥ −Pq half steps and ≤ 2(NF−1)
  let pmin, pn, NP, vol, state;
  // the hot loop's scalars (one block = a few dozen flops; no small arrays in it)
  const oqx = OQ[0], oqy = OQ[1], oqz = OQ[2], k2x = 2 / P[0], k2y = 2 / P[1], k2z = 2 / P[2];
  const p2x = P2[0], p2y = P2[1], p2z = P2[2], u2x = U2[0], u2y = U2[1], u2z = U2[2], cy_ = C[1];
  const pow2 = U2.every((u) => (u & (u - 1)) === 0), mkx = u2x - 1, mky = u2y - 1, mkz = u2z - 1;   // a cell a power of two half steps: a mask, not a %
  let phx = 0, phy = 0, phz = 0, pminx = 0, pminy = 0, pminz = 0, pnx = 0, pny = 0, pnz = 0;
  const setup = () => {
    pmin = [0, 1, 2].map((a) => Math.floor((-Pq[a] - phi2[a]) / P2[a]) - 1);
    pn = [0, 1, 2].map((a) => Math.floor((2 * (NF[a] - 1) + Pq[a] - phi2[a]) / P2[a]) + 2 - pmin[a]);
    [phx, phy, phz] = phi2; [pminx, pminy, pminz] = pmin; [pnx, pny, pnz] = pn;
    NP = pn[0] * pn[1] * pn[2];
    if (!(NP <= 1 << 27)) throw new Error(`tiling: ${NP.toLocaleString()} parent cells — too many to check`);
    vol = new Float64Array(NP); state = new Uint8Array(NP);   // 0 unseen · 1 open · 2 closed · |4 revisited
  };
  if (phi2) setup();

  const out = {
    blocks: 0, offGrid: 0, offLattice: 0, crossing: 0, overlap: 0, ijkBad: 0, revisited: 0,
    offGridRecs: [], offLatticeRecs: [], crossingRecs: [], overlapRecs: [], ijkRecs: [],
  };
  const push = (arr, r) => { if (arr.length < keep) arr.push(r); };
  // the open parents: FIFO, with a pool of cleared bitmaps
  const open = new Map(), fifo = [], pool = [];
  let fifoHead = 0, lastP = -1, lastBits = null;
  const bitsOf = (pi) => {
    if (pi === lastP) return lastBits;
    let b = open.get(pi);
    if (!b) {
      if (open.size >= maxOpen) {                          // close the oldest
        const old = fifo[fifoHead++];
        const ob = open.get(old); open.delete(old); state[old] = (state[old] & 4) | 2;
        ob.fill(0); pool.push(ob);
        if (fifoHead > 4096) { fifo.splice(0, fifoHead); fifoHead = 0; }
      }
      if (state[pi] & 2) { if (!(state[pi] & 4)) out.revisited++; state[pi] |= 4; }
      b = pool.pop() || new Uint32Array(words);
      open.set(pi, b); fifo.push(pi); state[pi] = (state[pi] & 4) | 1;
    }
    lastP = pi; lastBits = b;
    return b;
  };

  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = R, ax = A[0], ay = A[1], az = A[2];
  function one(x, y, z, s0, s1, s2, rec, ij) {
    out.blocks++;
    let qx = x, qy = y, qz = z;
    if (rot) {
      const dx = x - ax, dy = y - ay, dz = z - az;
      qx = r0 * dx + r1 * dy + r2 * dz; qy = r3 * dx + r4 * dy + r5 * dz; qz = r6 * dx + r7 * dy + r8 * dz;
    }
    // per axis, unrolled (this runs once per block — 18.7M times on a real model): the centroid
    // in half steps (even when on the fine lattice), the low corner from the parent lattice's
    // corner, the parent, the block's span inside it (clipped: a block reaching out crosses)
    const tx = (qx - oqx) * k2x, ty = (qy - oqy) * k2y, tz = (qz - oqz) * k2z;
    const ix = Math.round(tx), iy = Math.round(ty), iz = Math.round(tz);
    if (Math.abs(tx - ix) > 2e-3 || Math.abs(ty - iy) > 2e-3 || Math.abs(tz - iz) > 2e-3 || ((ix | iy | iz) & 1)) { out.offGrid++; push(out.offGridRecs, rec); return; }   // a centroid between fine nodes
    const rx = ix - s0 - phx, ry = iy - s1 - phy, rz = iz - s2 - phz;
    const px = Math.floor(rx / p2x), py = Math.floor(ry / p2y), pz = Math.floor(rz / p2z);
    const lx = rx - px * p2x, ly = ry - py * p2y, lz = rz - pz * p2z;
    let hx = lx + 2 * s0, hy = ly + 2 * s1, hz = lz + 2 * s2, cross = false;
    if (hx > p2x) { cross = true; hx = p2x; }
    if (hy > p2y) { cross = true; hy = p2y; }
    if (hz > p2z) { cross = true; hz = p2z; }
    const i0 = px - pminx, i1 = py - pminy, i2 = pz - pminz;
    if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= pnx || i1 >= pny || i2 >= pnz) { out.crossing++; push(out.crossingRecs, rec); return; }
    const pi = i0 + pnx * (i1 + pny * i2);
    if (cross) { out.crossing++; push(out.crossingRecs, rec); }
    vol[pi] += (hx - lx) * (hy - ly) * (hz - lz);
    if (ij !== null && ijk) {
      const e = (px * ijk.ny + py) * ijk.nz + pz;
      if (!(ij === e)) { out.ijkBad++; push(out.ijkRecs, rec); }
    }
    if (pow2 ? (((lx | hx) & mkx) | ((ly | hy) & mky) | ((lz | hz) & mkz)) !== 0
      : (lx % u2x !== 0 || hx % u2x !== 0 || ly % u2y !== 0 || hy % u2y !== 0 || lz % u2z !== 0 || hz % u2z !== 0)) { out.offLattice++; push(out.offLatticeRecs, rec); bitsOf(pi); return; }
    // occupancy: rows along X, a word per 32 cells; a cell already set → this block overlaps another
    const b = bitsOf(pi);
    const cx0 = lx / u2x, cx1 = hx / u2x, cy0 = ly / u2y, cy1 = hy / u2y, cz0 = lz / u2z, cz1 = hz / u2z;
    let hit = 0;
    if (W === 1) {                                         // the common case: a parent's row fits one word
      const n = cx1 - cx0, m = n === 32 ? 0xffffffff : ((1 << n) - 1) << cx0;
      for (let cz = cz0; cz < cz1; cz++) {
        let at = cz * cy_ + cy0;
        for (let cy = cy0; cy < cy1; cy++, at++) { const v = b[at]; hit |= v & m; b[at] = v | m; }
      }
    } else {
      const w0 = cx0 >>> 5, w1 = (cx1 - 1) >>> 5;
      for (let cz = cz0; cz < cz1; cz++) {
        for (let cy = cy0; cy < cy1; cy++) {
          const base = (cz * cy_ + cy) * W;
          for (let w = w0; w <= w1; w++) {
            const a = w === w0 ? cx0 & 31 : 0, e = w === w1 ? ((cx1 - 1) & 31) + 1 : 32;
            const m = e - a === 32 ? 0xffffffff : (((1 << (e - a)) - 1) << a) >>> 0;
            const v = b[base + w];
            hit |= v & m;
            b[base + w] = v | m;
          }
        }
      }
    }
    if (hit) { out.overlap++; push(out.overlapRecs, rec); }
  }
  function run(ch) {
    const { x, y, z, dimQ, count } = ch, recs = ch.recs, base = ch.base || 0, IJ = ch.ijk || null;
    for (let i = 0; i < count; i++) {
      one(x[i], y[i], z[i], dimQ[3 * i], dimQ[3 * i + 1], dimQ[3 * i + 2], recs ? recs[i] : base + i, IJ ? IJ[i] : null);
    }
  }
  // no stated corner: hold the first chunks until each axis has a block spanning a whole parent
  let held = [], heldN = 0;
  const look = (ch) => {
    const { x, y, z, dimQ, count } = ch;
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < 3; a++) {
        if (found[a] != null || dimQ[3 * i + a] !== Pq[a]) continue;
        const v = a === 0 ? x[i] : a === 1 ? y[i] : z[i];
        let qa;
        if (rot) { const dx = x[i] - A[0], dy = y[i] - A[1], dz = z[i] - A[2]; qa = R[3 * a] * dx + R[3 * a + 1] * dy + R[3 * a + 2] * dz; } else qa = v;
        const t = Math.round((2 * (qa - OQ[a])) / P[a]);
        found[a] = t - Pq[a];
      }
      if (found[0] != null && found[1] != null && found[2] != null) return true;
    }
    return false;
  };
  const release = (guess) => {
    phi2 = found.map((v, a) => (v != null ? v : guess[a]));
    phaseFrom = found.every((v) => v != null) ? 'block' : 'guess';
    setup();
    for (const ch of held) run(ch);
    held = null;
  };
  let guessLo = [Infinity, Infinity, Infinity];
  return {
    add(ch) {
      if (!ch || !ch.count) return;
      if (phi2) { run(ch); return; }
      held.push(ch); heldN += ch.count;
      // the lowest corner seen — the guess when no block spans a whole parent
      for (let i = 0; i < ch.count; i++) for (let a = 0; a < 3; a++) {
        const v = a === 0 ? ch.x[i] : a === 1 ? ch.y[i] : ch.z[i];
        let qa;
        if (rot) { const dx = ch.x[i] - A[0], dy = ch.y[i] - A[1], dz = ch.z[i] - A[2]; qa = R[3 * a] * dx + R[3 * a + 1] * dy + R[3 * a + 2] * dz; } else qa = v;
        const c = Math.round((2 * (qa - OQ[a])) / P[a]) - ch.dimQ[3 * i + a];
        if (c < guessLo[a]) guessLo[a] = c;
      }
      if (look(ch) || heldN >= maxBuffered) release(guessLo);
    },
    finish() {
      if (!phi2) { if (!held || !held.length) return { ...out, empty: true }; release(guessLo); }
      // per parent: the filled volume against the parent's
      let parents = 0, under = 0, over = 0, underVol = 0, overVol = 0;
      const underAt = [];
      for (let pi = 0; pi < NP; pi++) {
        if (!state[pi]) continue;
        parents++;
        const v = vol[pi];
        if (v < fullVol) {
          under++; underVol += fullVol - v;
          if (underAt.length < 200) {
            const i0 = pi % pn[0], i1 = Math.floor(pi / pn[0]) % pn[1], i2 = Math.floor(pi / (pn[0] * pn[1]));
            const c = [0, 1, 2].map((a) => OQ[a] + ((phi2[a] + ([i0, i1, i2][a] + pmin[a]) * P2[a] + Pq[a]) / 2) * P[a]);
            underAt.push(rot ? [A[0] + R[0] * c[0] + R[3] * c[1] + R[6] * c[2], A[1] + R[1] * c[0] + R[4] * c[1] + R[7] * c[2], A[2] + R[2] * c[0] + R[5] * c[1] + R[8] * c[2]] : c);
          }
        } else if (v > fullVol) { over++; overVol += v - fullVol; }
      }
      const cellVol = (P[0] * P[1] * P[2]) / 8;            // a half-step³ in model units
      return {
        ...out, parents, under, over, underVolume: underVol * cellVol, overVolume: overVol * cellVol, underAt,
        parentSize: [0, 1, 2].map((a) => Pq[a] * P[a]), parentVolume: fullVol * cellVol,
        phaseFrom, unit: U.slice(), ijkChecked: !!ijk,
      };
    },
  };
}
