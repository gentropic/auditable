// CPU winding number evaluation
// Used for testing and as fallback when WebGPU is unavailable

import { NODE_SIZE } from '../../geometry/src/bvh.js';

const PI4 = 4 * Math.PI;

// Van Oosterom-Strackee solid angle formula
// Returns the signed solid angle subtended by triangle (a,b,c) at point p
function solidAngle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const apx = ax - px, apy = ay - py, apz = az - pz;
  const bpx = bx - px, bpy = by - py, bpz = bz - pz;
  const cpx = cx - px, cpy = cy - py, cpz = cz - pz;

  const ra = Math.sqrt(apx * apx + apy * apy + apz * apz);
  const rb = Math.sqrt(bpx * bpx + bpy * bpy + bpz * bpz);
  const rc = Math.sqrt(cpx * cpx + cpy * cpy + cpz * cpz);

  if (ra < 1e-10 || rb < 1e-10 || rc < 1e-10) return 0; // point on vertex

  // numerator = a' . (b' x c')
  const crossX = bpy * cpz - bpz * cpy;
  const crossY = bpz * cpx - bpx * cpz;
  const crossZ = bpx * cpy - bpy * cpx;
  const num = apx * crossX + apy * crossY + apz * crossZ;

  // denominator = ra*rb*rc + (a'.b')*rc + (b'.c')*ra + (c'.a')*rb
  const ab = apx * bpx + apy * bpy + apz * bpz;
  const bc = bpx * cpx + bpy * cpy + bpz * cpz;
  const ca = cpx * apx + cpy * apy + cpz * apz;
  const den = ra * rb * rc + ab * rc + bc * ra + ca * rb;

  return 2 * Math.atan2(num, den);
}

// Brute-force winding number (no BVH) — for testing small meshes
function windingBrute(px, py, pz, vertices, triangles, triIndices) {
  let sum = 0;
  const n = triIndices ? triIndices.length : triangles.length / 3;
  for (let i = 0; i < n; i++) {
    const ti = triIndices ? triIndices[i] : i;
    const a = triangles[ti * 3], b = triangles[ti * 3 + 1], c = triangles[ti * 3 + 2];
    sum += solidAngle(px, py, pz,
      vertices[a * 3], vertices[a * 3 + 1], vertices[a * 3 + 2],
      vertices[b * 3], vertices[b * 3 + 1], vertices[b * 3 + 2],
      vertices[c * 3], vertices[c * 3 + 1], vertices[c * 3 + 2]);
  }
  return sum / PI4;
}

// BVH-accelerated winding number with Barill far-field dipoles (Fast Winding
// Numbers for Soups and Clouds, SIGGRAPH 2018, order 1): a node whose whole
// subtree is far away (dist > BETA × subtree radius) contributes as a single
// dipole — Ω ≈ N·(c−p)/d³ — instead of an exact per-triangle descent. Turns
// per-query cost from O(triangles) into ~O(log triangles).
const WINDING_BETA2 = 9;                                   // β = 3 — order-1 dipole stays within ~0.5% of exact
function windingBVH(px, py, pz, vertices, triangles, bvhNodes, triIndices) {
  let sum = 0;
  const stack = [0]; // start at root

  while (stack.length > 0) {
    const nodeIdx = stack.pop();
    const off = nodeIdx * NODE_SIZE;

    // far field: the subtree as one dipole
    const qx = bvhNodes[off + 8] - px, qy = bvhNodes[off + 9] - py, qz = bvhNodes[off + 10] - pz;
    const d2 = qx * qx + qy * qy + qz * qz;
    const r = bvhNodes[off + 14];
    if (d2 > WINDING_BETA2 * r * r) {
      sum += (bvhNodes[off + 11] * qx + bvhNodes[off + 12] * qy + bvhNodes[off + 13] * qz) / (d2 * Math.sqrt(d2));
      continue;
    }

    const data2 = bvhNodes[off + 7];

    if (data2 > 0) {
      // Leaf node: data1 = first, data2 = count
      const first = bvhNodes[off + 6];
      const count = data2;
      for (let i = first; i < first + count; i++) {
        const ti = triIndices[i];
        const a = triangles[ti * 3], b = triangles[ti * 3 + 1], c = triangles[ti * 3 + 2];
        sum += solidAngle(px, py, pz,
          vertices[a * 3], vertices[a * 3 + 1], vertices[a * 3 + 2],
          vertices[b * 3], vertices[b * 3 + 1], vertices[b * 3 + 2],
          vertices[c * 3], vertices[c * 3 + 1], vertices[c * 3 + 2]);
      }
    } else {
      // Internal node: data1 = left, data2 = -(right) - 1
      const left = bvhNodes[off + 6];
      const right = -(data2) - 1;
      stack.push(left);
      stack.push(right);
    }
  }

  return sum / PI4;
}

// Evaluate block model on CPU
// opts.onProgress: async (fraction) => void — called per z-layer, yields to UI
async function evaluateCPU(vertices, triangles, bvhNodes, triIndices, blockModel, opts = {}) {
  const { mode = 'proportion', resolution = [4, 4, 4], threshold = 0.5, onProgress } = opts;
  const { origin, size, count } = blockModel;
  const [nx, ny, nz] = count;
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = size;
  const [sx, sy, sz] = resolution;
  const total = nx * ny * nz;

  const useBVH = bvhNodes && bvhNodes.length > 0;

  function winding(px, py, pz) {
    if (useBVH) return windingBVH(px, py, pz, vertices, triangles, bvhNodes, triIndices);
    return windingBrute(px, py, pz, vertices, triangles, triIndices);
  }

  // yield to main thread so UI can update
  const yield_ = onProgress
    ? () => new Promise(r => setTimeout(r, 0))
    : null;

  if (mode === 'flag') {
    const flags = new Uint8Array(total);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const px = ox + (i + 0.5) * dx;
          const py = oy + (j + 0.5) * dy;
          const pz = oz + (k + 0.5) * dz;
          const w = winding(px, py, pz);
          flags[i + j * nx + k * nx * ny] = w >= threshold ? 1 : 0;
        }
      }
      if (onProgress) {
        onProgress((k + 1) / nz);
        await yield_();
      }
    }
    return { flags };
  }

  // Proportion mode
  const proportions = new Float32Array(total);
  const flags = new Uint8Array(total);
  const subTotal = sx * sy * sz;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let sk = 0; sk < sz; sk++) {
          for (let sj = 0; sj < sy; sj++) {
            for (let si = 0; si < sx; si++) {
              const px = ox + (i + (si + 0.5) / sx) * dx;
              const py = oy + (j + (sj + 0.5) / sy) * dy;
              const pz = oz + (k + (sk + 0.5) / sz) * dz;
              const w = winding(px, py, pz);
              if (w >= threshold) inside++;
            }
          }
        }
        const idx = i + j * nx + k * nx * ny;
        proportions[idx] = inside / subTotal;
        flags[idx] = proportions[idx] >= threshold ? 1 : 0;
      }
    }
    if (onProgress) {
      onProgress((k + 1) / nz);
      await yield_();
    }
  }

  return { proportions, flags };
}

// Evaluate a LIST of axis-aligned boxes — a model whose blocks don't share one size
// (sub-blocked), so there is no lattice to sweep. boxes = { centres: Float64Array(3n),
// halves: Float32Array|Float64Array(3n), count? }, in the MESH's coordinates (the
// caller's frame). Each box is probed on its OWN rx×ry×rz cell-centred sub-grid —
// the same probes evaluateCPU lays inside a lattice cell, scaled to the box — and
// 'flag' tests its centre. A box (or a probe) outside the mesh's bounds is outside
// without a winding call (it is, for a closed mesh; and the skirt closures are closed).
// → { proportions?: Float32Array(n), flags: Uint8Array(n) }
async function evaluateBoxesCPU(vertices, triangles, bvhNodes, triIndices, boxes, opts = {}) {
  const { mode = 'proportion', resolution = [4, 4, 4], threshold = 0.5, onProgress } = opts;
  const C = boxes.centres, H = boxes.halves;
  const n = boxes.count != null ? boxes.count : C.length / 3;
  const useBVH = bvhNodes && bvhNodes.length > 0;
  let b0, b1, b2, b3, b4, b5;
  if (useBVH) { b0 = bvhNodes[0]; b1 = bvhNodes[1]; b2 = bvhNodes[2]; b3 = bvhNodes[3]; b4 = bvhNodes[4]; b5 = bvhNodes[5]; }
  else {
    b0 = b1 = b2 = Infinity; b3 = b4 = b5 = -Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
      if (x < b0) b0 = x; if (x > b3) b3 = x; if (y < b1) b1 = y; if (y > b4) b4 = y; if (z < b2) b2 = z; if (z > b5) b5 = z;
    }
  }
  const inside = (px, py, pz) => px >= b0 && px <= b3 && py >= b1 && py <= b4 && pz >= b2 && pz <= b5
    && (useBVH ? windingBVH(px, py, pz, vertices, triangles, bvhNodes, triIndices) : windingBrute(px, py, pz, vertices, triangles, triIndices)) >= threshold;
  const flag = mode === 'flag';
  const [sx, sy, sz] = flag ? [1, 1, 1] : resolution;
  const subTotal = sx * sy * sz;
  const flags = new Uint8Array(n), proportions = flag ? null : new Float32Array(n);
  const step = 8192;
  for (let s0 = 0; s0 < n; s0 += step) {
    const s1 = Math.min(n, s0 + step);
    for (let b = s0; b < s1; b++) {
      const cx = C[b * 3], cy = C[b * 3 + 1], cz = C[b * 3 + 2];
      const hx = H[b * 3], hy = H[b * 3 + 1], hz = H[b * 3 + 2];
      if (cx + hx < b0 || cx - hx > b3 || cy + hy < b1 || cy - hy > b4 || cz + hz < b2 || cz - hz > b5) continue;   // the box misses the mesh
      if (flag) { flags[b] = inside(cx, cy, cz) ? 1 : 0; continue; }
      let ins = 0;
      for (let k = 0; k < sz; k++) {
        const pz = cz + hz * ((2 * k + 1) / sz - 1);
        for (let j = 0; j < sy; j++) {
          const py = cy + hy * ((2 * j + 1) / sy - 1);
          for (let i = 0; i < sx; i++) if (inside(cx + hx * ((2 * i + 1) / sx - 1), py, pz)) ins++;
        }
      }
      const p = ins / subTotal;
      proportions[b] = p; flags[b] = p >= threshold ? 1 : 0;
    }
    if (onProgress) { onProgress(s1 / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  return flag ? { flags } : { proportions, flags };
}

export { solidAngle, windingBrute, windingBVH, evaluateCPU, evaluateBoxesCPU, WINDING_BETA2 };
