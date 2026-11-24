// WINDING — Generalized Winding Number Block Model Evaluator
// Main API: Winding.create({ device?, worker?, gpu? }), setMesh(), evaluate()

import { buildBVH } from '../../geometry/src/bvh.js';
import { evaluateCPU, evaluateBoxesCPU } from './cpu.js';
import { createGPUEvaluator, evaluateGPU } from './gpu.js';
import { initWindingWorker, evaluateWorker, evaluateBoxesWorker } from './worker.js';
import { toLocal, toLocalCoords, frameEq } from '../../frame/src/frame.js';

// ── Frame-awareness (@gcu/frame) ────────────────────────────────────────────────
// Geological meshes live at projected magnitudes (UTM northing ~7.7e6). Handing
// those straight to a Float32Array/WGSL f32 kernel hits the float32 wall — ~1 m
// resolution at 7.7e6, so the BVH slab tests and solid-angle math degrade. A frame
// rebases world → a small-magnitude local origin at full f64 BEFORE the f32 downcast.
// Pass an @gcu/frame to setMesh() and evaluate(); omit it for verbatim legacy behaviour.
// Results (winding numbers/flags, per block index) are translation-invariant — only
// the geometry inputs are rebased, nothing to map back.

// World verts (f64-worthy) → local-frame Float32Array. The one hard rule of frame §5:
// anything bound for a Float32Array passes through the local frame first.
function frameLocalVerts(vertices, frame) {
  return frame ? Float32Array.from(toLocalCoords(vertices, frame, { stride: 3 })) : vertices;
}

// Rebase a block model's world origin into the mesh's local frame, guarding that the
// block frame and the mesh frame are the SAME frame — frame rebases, never reprojects.
function frameBlockModel(blockModel, evalFrame, meshFrame, meshName) {
  if (!meshFrame && !evalFrame) return blockModel;                       // legacy path, verbatim
  if (meshFrame && !evalFrame)
    throw new Error(`winding: mesh '${meshName}' was framed; evaluate needs the same frame`);
  if (!meshFrame && evalFrame)
    throw new Error(`winding: evaluate given a frame but mesh '${meshName}' is unframed`);
  if (!frameEq(evalFrame, meshFrame))
    throw new Error(`winding: block-model frame ≠ mesh '${meshName}' frame (frame rebases, never reprojects)`);
  return { ...blockModel, origin: toLocal(blockModel.origin, evalFrame) };
}

// a box list shorter than this runs on one worker (a split's messages would cost more)
const BOX_SPLIT_MIN = 4096;
// a mesh's arrays to one worker (copies — every worker keeps its own)
function postMesh(worker, name, mesh) {
  worker.postMessage({
    type: 'setMesh', name,
    vertices: new Float32Array(mesh.vertices),
    triangles: new Uint32Array(mesh.triangles),
    bvhNodes: new Float32Array(mesh.bvh.nodes),
    triIndices: new Uint32Array(mesh.bvh.triIndices),
  });
}

class Winding {
  constructor() {
    this._gpu = null;       // main-thread GPU evaluator
    this._worker = null;    // Worker instance
    this._workerGPU = false; // whether worker has GPU
    this._meshes = new Map();
    this._defaultMesh = null;
    this._boxWorkers = 1;   // workers a box list may spread over (the main worker + extra CPU ones)
    this._extra = null;     // the extra workers, started on the first big box list: Promise<Worker[]>
  }

  // Create a Winding instance
  // opts.device: GPUDevice for main-thread WebGPU (e.g. Firefox, or shared with three.js)
  // opts.worker: true to run evaluation in a Web Worker
  // opts.gpu: true to let the worker request its own GPUDevice (requires worker: true)
  // opts.boxWorkers: how many workers a BOX LIST (evaluateBoxes) spreads over, the
  //   main one included (needs worker: true). The extra ones are CPU-only, started
  //   on the first box list big enough to split, and hold their own copy of the meshes.
  static async create(opts = {}) {
    const { device, worker, gpu } = opts;
    const w = new Winding();
    if (worker && opts.boxWorkers > 1) w._boxWorkers = Math.floor(opts.boxWorkers);

    if (device) {
      w._gpu = await createGPUEvaluator(device);
    }

    if (worker) {
      const result = await initWindingWorker({ gpu: !!gpu });
      w._worker = result.worker;
      w._workerGPU = result.hasGPU;
    }

    return w;
  }

  // Load a mesh. Builds BVH on main thread, sends to worker if active.
  setMesh(vertices, triangles, opts = {}) {
    const name = opts.name || '_default';
    const frame = opts.frame || null;
    const verts = frameLocalVerts(vertices, frame);            // world → local f32 (frame-aware)
    const bvh = buildBVH(verts, triangles, {
      maxLeafSize: opts.maxLeafSize || 4,
    });
    const mesh = { vertices: verts, triangles, bvh, frame };
    this._meshes.set(name, mesh);
    if (name === '_default' || this._meshes.size === 1) {
      this._defaultMesh = mesh;
    }

    if (this._worker) postMesh(this._worker, name, mesh);
    if (this._extra) this._extra.then((ws) => { for (const x of ws) postMesh(x, name, mesh); });

    return {
      nodeCount: bvh.nodeCount,
      triangleCount: bvh.triIndices.length,
      degenerateCount: bvh.degenerateCount,
    };
  }

  // Evaluate a single mesh against a block model
  // Priority: worker (GPU or CPU) > main-thread GPU > main-thread CPU
  async evaluate(blockModel, opts = {}) {
    const meshName = opts.mesh || '_default';
    const mesh = this._meshes.get(meshName) || this._defaultMesh;
    if (!mesh) throw new Error('No mesh loaded. Call setMesh() first.');

    const { frame: evalFrame = null, ...restOpts } = opts;
    const bm = frameBlockModel(blockModel, evalFrame, mesh.frame, meshName);

    if (this._worker) {
      return evaluateWorker(this._worker, meshName, bm, restOpts);
    }

    const { vertices, triangles, bvh } = mesh;

    if (this._gpu) {
      return evaluateGPU(this._gpu, vertices, triangles,
        bvh.nodes, bvh.triIndices, bm, restOpts);
    }

    return evaluateCPU(vertices, triangles,
      bvh.nodes, bvh.triIndices, bm, restOpts);
  }

  // Evaluate a LIST of boxes, each its own size — a sub-blocked model, which has no
  // lattice to sweep. boxes = { centres (world, or the mesh's frame when unframed),
  // halves (per box, same units), count? }. Each box is probed on its own
  // resolution sub-grid ('proportion') or at its centre ('flag'). Worker CPU, or the
  // main-thread CPU; the GPU kernel dispatches lattices only.
  // → { proportions?: Float32Array(n), flags: Uint8Array(n) }, in box order.
  async evaluateBoxes(boxes, opts = {}) {
    const meshName = opts.mesh || '_default';
    const mesh = this._meshes.get(meshName) || this._defaultMesh;
    if (!mesh) throw new Error('No mesh loaded. Call setMesh() first.');
    const { frame: evalFrame = null, ...restOpts } = opts;
    if (!!evalFrame !== !!mesh.frame || (evalFrame && !frameEq(evalFrame, mesh.frame))) throw new Error(`winding: box frame ≠ mesh '${meshName}' frame (frame rebases, never reprojects)`);
    const centres = evalFrame ? toLocalCoords(boxes.centres, evalFrame, { stride: 3 }) : boxes.centres;
    const bx = { centres, halves: boxes.halves, count: boxes.count != null ? boxes.count : boxes.centres.length / 3 };
    if (this._worker && this._boxWorkers > 1 && bx.count >= BOX_SPLIT_MIN) return this._evaluateBoxesPool(meshName, bx, restOpts);
    if (this._worker) return evaluateBoxesWorker(this._worker, meshName, bx, restOpts);
    return evaluateBoxesCPU(mesh.vertices, mesh.triangles, mesh.bvh.nodes, mesh.bvh.triIndices, bx, restOpts);
  }

  // A box list SPREAD over the workers: cut into slices (several per worker, so a
  // slice of boxes far from the mesh — no winding calls — doesn't leave a worker idle
  // while another grinds through the ones inside), each slice evaluated whole by
  // evaluateBoxesCPU on whichever worker is free, its answers written back at its
  // offset. Every box's answer depends on that box and the mesh alone, so the result
  // is bit-for-bit the one-worker answer, in box order.
  async _evaluateBoxesPool(meshName, bx, opts) {
    if (!this._extra) {
      const n = this._boxWorkers - 1;
      this._extra = Promise.all(Array.from({ length: n }, () => initWindingWorker({ gpu: false }).then((r) => r.worker, () => null)))
        .then((ws) => { ws = ws.filter(Boolean); for (const x of ws) for (const [name, m] of this._meshes) postMesh(x, name, m); return ws; });
    }
    const ws = [this._worker, ...(await this._extra)];
    if (ws.length < 2) return evaluateBoxesWorker(this._worker, meshName, bx, opts);
    const n = bx.count, flag = opts.mode === 'flag';
    const per = Math.max(1024, Math.ceil(n / (ws.length * 4)));
    const flags = new Uint8Array(n), proportions = flag ? null : new Float32Array(n);
    const C = bx.centres, H = bx.halves;
    let next = 0, done = 0;
    const { onProgress, ...rest } = opts;
    const loop = async (w) => {
      while (next < n) {
        const s0 = next, s1 = Math.min(n, s0 + per); next = s1;
        const r = await evaluateBoxesWorker(w, meshName, { centres: C.slice(3 * s0, 3 * s1), halves: H.slice(3 * s0, 3 * s1), count: s1 - s0 }, rest);
        flags.set(r.flags, s0);
        if (proportions) proportions.set(r.proportions, s0);
        done += s1 - s0; if (onProgress) onProgress(done / n);
      }
    };
    await Promise.all(ws.map(loop));
    return flag ? { flags } : { proportions, flags };
  }

  // Evaluate multiple named surfaces against the same block model
  async evaluateMultiple(blockModel, opts = {}) {
    const { surfaces = [], ...evalOpts } = opts;
    const results = {};
    for (const name of surfaces) {
      results[name] = await this.evaluate(blockModel, { ...evalOpts, mesh: name });
    }
    return results;
  }

  // true if any GPU path is active (main-thread or worker)
  get hasGPU() { return this._gpu !== null || this._workerGPU; }
  get hasWorker() { return this._worker !== null; }
  // how many workers a box list may use (1 = the main one)
  get boxWorkers() { return this._worker ? this._boxWorkers : 0; }

  // Terminate worker. Falls back to main-thread GPU or CPU.
  terminate() {
    if (this._extra) { const ex = this._extra; this._extra = null; ex.then((ws) => { for (const x of ws) x.postMessage({ type: 'terminate' }); }); }
    if (this._worker) {
      this._worker.postMessage({ type: 'terminate' });
      this._worker = null;
      this._workerGPU = false;
    }
  }
}

export { Winding, buildBVH };
// CPU math helpers — part of the curated public surface (matches the old footer).
export { evaluateCPU, evaluateBoxesCPU, solidAngle, windingBrute, windingBVH } from './cpu.js';
// Ray → mesh over the same BVH: the CPU half of mesh picking (the GPU ID-buffer
// says WHICH mesh; this says which triangle, where, and which way it faces).
export { raycastBVH } from '../../geometry/src/ray.js';
