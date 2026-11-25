// micro SECTION LINES, the pure part — where a plane cuts a triangle mesh, a gridded surface or the
// DOMAIN BOUNDARIES of a block model, as 3D segments that share their end points EXACTLY, then
// chained into polylines. No DOM, no state: test/micro-sectionlines.test.mjs runs it in Node.
//
// The plane is n·p = pos in WORLD coordinates (n a unit vector). A point is on the FRONT side when
// n·p − pos > 0, otherwise behind — the same half-open rule as a section's blocks, so a vertex (or a
// block face) lying exactly on the plane is cut once, never twice.
//
//   meshPlaneSegments(V, T, n, pos, out = []) → out: [{ a: [x,y,z], b: [x,y,z], ka, kb }]
//       one segment per triangle that crosses the plane; ka/kb name the mesh EDGE (or vertex) each
//       end lies on, so neighbouring triangles' segments meet at the same key.
//   gridToMesh(g) → { vertices, triangles } a gridded surface (x0, y0 = the TOP row, dx, dy, nx,
//       ny, data, nodata) as a triangulated heightfield, nodata cells left out.
//   latticeBoundarySegments(blocks, lattice, n, pos, { outer }) → [{ a, b, ka, kb, pair: [A, B] }]
//       blocks: [{ lo: [i, j, k], size: [ni, nj, nk], cat }] in FINE lattice steps; lattice:
//       { pitch [3], originQ [3] (the centre of fine cell 0, lattice coords), R (3×3 column-major,
//       world ← lattice), anchor [3] }. The boundary between two face-adjacent blocks whose `cat`
//       differs (outer: also a block and empty space) is the shared face; each such face the plane
//       cuts gives a segment, keyed by the LATTICE EDGE it crosses. pair = the two values, sorted.
//   chainSegments(segs) → [{ pts: [[x,y,z], …], closed }] segments joined end to end through their
//       keys (a junction of three or more lines ends each line there); collinear vertices dropped.
//   lineLength(pts, closed) → the 3D length
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function meshPlaneSegments(V, T, n, pos, out = []) {
  const nv = V.length / 3, d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) d[i] = n[0] * V[i * 3] + n[1] * V[i * 3 + 1] + n[2] * V[i * 3 + 2] - pos;
  const front = (i) => d[i] > 0;
  // the crossing on edge (i, j), i behind / j in front — or the behind vertex itself when it's ON the plane
  const cross = (i, j) => {
    if (d[i] === 0) return { p: [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]], k: 'v' + i };
    const t = d[i] / (d[i] - d[j]);
    return { p: [V[i * 3] + t * (V[j * 3] - V[i * 3]), V[i * 3 + 1] + t * (V[j * 3 + 1] - V[i * 3 + 1]), V[i * 3 + 2] + t * (V[j * 3 + 2] - V[i * 3 + 2])], k: i < j ? i * nv + j : j * nv + i };
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2], fa = front(a), fb = front(b), fc = front(c);
    if (fa === fb && fb === fc) continue;
    // the lone vertex (alone on its side) and the other two
    const odd = fa === fb ? c : fa === fc ? b : a, [o1, o2] = odd === a ? [b, c] : odd === b ? [c, a] : [a, b];
    const fo = front(odd);
    const p = fo ? cross(o1, odd) : cross(odd, o1), q = fo ? cross(o2, odd) : cross(odd, o2);
    if (p.k === q.k) continue;                              // a corner touching the plane: no length
    out.push({ a: p.p, b: q.p, ka: p.k, kb: q.k });
  }
  return out;
}

export function gridToMesh(g) {
  const nod = g.nodata;
  const bad = (v) => !Number.isFinite(v) || (nod != null && (nod >= 1.7e38 ? v >= 1.7014e38 : v === nod));
  const V = new Float64Array(g.nx * g.ny * 3);
  for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) {
    const i = r * g.nx + c; V[i * 3] = g.x0 + c * g.dx; V[i * 3 + 1] = g.y0 - r * g.dy; V[i * 3 + 2] = g.data[i];
  }
  const T = [];
  for (let r = 0; r < g.ny - 1; r++) for (let c = 0; c < g.nx - 1; c++) {
    const i00 = r * g.nx + c, i10 = i00 + 1, i01 = i00 + g.nx, i11 = i01 + 1;
    const b00 = bad(g.data[i00]), b10 = bad(g.data[i10]), b01 = bad(g.data[i01]), b11 = bad(g.data[i11]);
    if (!b00 && !b10 && !b11) T.push(i00, i10, i11);
    if (!b00 && !b11 && !b01) T.push(i00, i11, i01);
    else if (b11 && !b00 && !b10 && !b01) T.push(i00, i10, i01);   // a nodata corner: keep the triangle that avoids it
    if (b00 && !b10 && !b11 && !b01) T.push(i10, i11, i01);
  }
  return { vertices: V, triangles: Uint32Array.from(T) };
}

export function latticeBoundarySegments(blocks, lattice, n, pos, { outer = false, maxCells = 20e6 } = {}) {
  const P = lattice.pitch, Q0 = lattice.originQ, R = lattice.R || [1, 0, 0, 0, 1, 0, 0, 0, 1], A = lattice.anchor || [0, 0, 0];
  // the plane in the lattice frame: n_l = Rᵀ n, and the corner of fine cell 0 as the origin of the arithmetic
  const nl = [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]];
  const c0 = [Q0[0] - P[0] / 2, Q0[1] - P[1] / 2, Q0[2] - P[2] / 2];
  const base = dot3(nl, c0) - (pos - dot3(n, A));           // d(node 0,0,0)
  const s = [nl[0] * P[0], nl[1] * P[1], nl[2] * P[2]];     // d grows by s[a] per node step along a
  const dNode = (i, j, k) => base + s[0] * i + s[1] * j + s[2] * k;
  const ext = (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 2;
  // the fine cells the plane cuts (a corner behind and a corner in front), each → its block
  let i0 = Infinity, j0 = Infinity, k0 = Infinity, i1 = -Infinity, j1 = -Infinity, k1 = -Infinity;
  for (const b of blocks) {
    if (b.lo[0] < i0) i0 = b.lo[0]; if (b.lo[1] < j0) j0 = b.lo[1]; if (b.lo[2] < k0) k0 = b.lo[2];
    if (b.lo[0] + b.size[0] > i1) i1 = b.lo[0] + b.size[0]; if (b.lo[1] + b.size[1] > j1) j1 = b.lo[1] + b.size[1]; if (b.lo[2] + b.size[2] > k1) k1 = b.lo[2] + b.size[2];
  }
  if (!blocks.length) return [];
  const NX = i1 - i0 + 2, NY = j1 - j0 + 2;
  const keyOf = (i, j, k) => ((k - k0 + 1) * NY + (j - j0 + 1)) * NX + (i - i0 + 1);
  const cellBlock = new Map();
  // the axis most across the plane: walk the other two, solve for the few cells along it
  const ax = [0, 1, 2].reduce((m, a) => (Math.abs(s[a]) > Math.abs(s[m]) ? a : m), 0), [o1, o2] = [0, 1, 2].filter((a) => a !== ax);
  const cutCell = (i, j, k) => { const dc = dNode(i, j, k) + (s[0] + s[1] + s[2]) / 2; return dc - ext <= 0 && 0 < dc + ext; };
  let cells = 0;
  blocks.forEach((b, bi) => {
    // a quick reject: the block's own box
    const dc = dNode(b.lo[0], b.lo[1], b.lo[2]) + (s[0] * b.size[0] + s[1] * b.size[1] + s[2] * b.size[2]) / 2;
    const be = (Math.abs(s[0]) * b.size[0] + Math.abs(s[1]) * b.size[1] + Math.abs(s[2]) * b.size[2]) / 2;
    if (!(dc - be <= 0 && 0 < dc + be)) return;
    const idx = [0, 0, 0];
    for (let u = b.lo[o1]; u < b.lo[o1] + b.size[o1]; u++) for (let v = b.lo[o2]; v < b.lo[o2] + b.size[o2]; v++) {
      idx[o1] = u; idx[o2] = v; idx[ax] = 0;
      // along ax the cell centre's d is linear: centre(t) = c + s[ax]·t; the cut needs |centre| ≤ ext
      const c = dNode(idx[0], idx[1], idx[2]) + (s[0] + s[1] + s[2]) / 2;
      let lo = b.lo[ax], hi = b.lo[ax] + b.size[ax] - 1;
      if (s[ax] !== 0) {
        const ta = (-ext - c) / s[ax], tb = (ext - c) / s[ax];
        lo = Math.max(lo, Math.floor(Math.min(ta, tb)) - 1); hi = Math.min(hi, Math.ceil(Math.max(ta, tb)) + 1);
      }
      for (let t = lo; t <= hi; t++) {
        idx[ax] = t;
        if (!cutCell(idx[0], idx[1], idx[2])) continue;
        cellBlock.set(keyOf(idx[0], idx[1], idx[2]), bi);
        if (++cells > maxCells) throw new Error(`${cells.toLocaleString()}+ fine cells on this plane — too many`);
      }
    }
  });
  // lattice node → world
  const nodeWorld = (i, j, k, out) => {
    const u = c0[0] + i * P[0], v = c0[1] + j * P[1], w = c0[2] + k * P[2];
    out[0] = A[0] + R[0] * u + R[3] * v + R[6] * w; out[1] = A[1] + R[1] * u + R[4] * v + R[7] * w; out[2] = A[2] + R[2] * u + R[5] * v + R[8] * w;
    return out;
  };
  const nodeKey = (i, j, k) => `${i},${j},${k}`;
  const segs = [];
  const ta = [0, 0, 0], tb = [0, 0, 0];
  // the face of cell (i, j, k) on its +e side (or −e with neg) → the segment where the plane cuts it
  const face = (i, j, k, e, neg, pair) => {
    const f = [i, j, k]; if (!neg) f[e] += 1;              // the face lies on node layer f[e] along e
    const [p, q] = [0, 1, 2].filter((a) => a !== e);
    const corner = (dp, dq) => { const c = f.slice(); c[p] += dp; c[q] += dq; return c; };
    const C = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
    const D = C.map((c) => dNode(c[0], c[1], c[2]));
    const pts = [];
    for (let m = 0; m < 4; m++) {
      const a = C[m], b = C[(m + 1) % 4], da = D[m], db = D[(m + 1) % 4];
      if ((da > 0) === (db > 0)) continue;
      // orient the edge from its lower node, so the two faces sharing it compute the same point
      const flip = a[0] + a[1] + a[2] > b[0] + b[1] + b[2];
      const lo = flip ? b : a, hi = flip ? a : b, dl = flip ? db : da, dh = flip ? da : db;
      const bh = dl > 0 ? hi : lo, dbh = dl > 0 ? dh : dl;   // the behind node of the edge
      if (dbh === 0) { pts.push({ p: nodeWorld(bh[0], bh[1], bh[2], [0, 0, 0]), k: 'n' + nodeKey(bh[0], bh[1], bh[2]) }); continue; }
      const t = dl / (dl - dh);
      nodeWorld(lo[0], lo[1], lo[2], ta); nodeWorld(hi[0], hi[1], hi[2], tb);
      const axis = lo[0] !== hi[0] ? 0 : lo[1] !== hi[1] ? 1 : 2;
      pts.push({ p: [ta[0] + t * (tb[0] - ta[0]), ta[1] + t * (tb[1] - ta[1]), ta[2] + t * (tb[2] - ta[2])], k: 'e' + nodeKey(lo[0], lo[1], lo[2]) + ':' + axis });
    }
    if (pts.length === 2 && pts[0].k !== pts[1].k) segs.push({ a: pts[0].p, b: pts[1].p, ka: pts[0].k, kb: pts[1].k, pair });
  };
  const catOf = (bi) => (bi == null ? null : blocks[bi].cat);
  const str = (v) => (v == null ? '' : String(v));
  for (const [key, bi] of cellBlock) {
    let r = key;
    const ii = (r % NX) + i0 - 1; r = (r - (r % NX)) / NX;
    const jj = (r % NY) + j0 - 1; const kk = (r - (r % NY)) / NY + k0 - 1;
    const here = str(catOf(bi));
    for (let e = 0; e < 3; e++) {
      const up = [ii, jj, kk]; up[e] += 1;
      const nb = cellBlock.get(keyOf(up[0], up[1], up[2]));
      if (nb != null) {
        if (nb !== bi && str(catOf(nb)) !== here) face(ii, jj, kk, e, false, [here, str(catOf(nb))].sort());
      } else if (outer) face(ii, jj, kk, e, false, ['', here].sort());
      if (outer) {
        const dn = [ii, jj, kk]; dn[e] -= 1;
        if (cellBlock.get(keyOf(dn[0], dn[1], dn[2])) == null) face(ii, jj, kk, e, true, ['', here].sort());
      }
    }
  }
  return segs;
}

// is b on the straight line a → c (within a relative tolerance)?
function collinear(a, b, c, tol = 1e-9) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(u[0], u[1], u[2]), lv = Math.hypot(v[0], v[1], v[2]);
  if (lu === 0 || lv === 0) return true;
  const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
  return Math.hypot(cx, cy, cz) <= tol * lu * lv && dot3(u, v) > 0;
}
export function dropCollinear(pts, closed) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    if (!collinear(a, pts[i], c)) out.push(pts[i]);
  }
  return out.length >= (closed ? 3 : 2) ? out : pts.slice();
}

export function chainSegments(segs) {
  const ns = segs.length, by = new Map();
  for (let i = 0; i < ns; i++) for (const k of [segs[i].ka, segs[i].kb]) { let l = by.get(k); if (!l) by.set(k, (l = [])); l.push(i); }
  const used = new Uint8Array(ns), lines = [];
  const extend = (line, key) => {                           // onward from the point `key`, through unused segments
    for (;;) {
      const list = by.get(key);
      if (!list || list.length > 2) return key;            // a junction (three or more): the line ends here
      const i = list.find((j) => !used[j]); if (i == null) return key;
      used[i] = 1;
      const s = segs[i], nk = s.ka === key ? s.kb : s.ka;
      line.push(s.ka === key ? s.b : s.a); key = nk;
    }
  };
  for (let i = 0; i < ns; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i];
    const fwd = [s.a, s.b], endKey = extend(fwd, s.kb);
    let closed = endKey === s.ka;
    let pts;
    if (closed) { fwd.pop(); pts = fwd; }
    else { const back = []; extend(back, s.ka); pts = [...back.reverse(), ...fwd]; }
    lines.push({ pts: dropCollinear(pts, closed), closed });
  }
  return lines;
}

export function lineLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  if (closed && pts.length > 2) { const a = pts[pts.length - 1], b = pts[0]; L += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  return L;
}
