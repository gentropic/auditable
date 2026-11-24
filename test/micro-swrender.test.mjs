// micro's software-renderer detector + the software mode's frame pacing (tools/micro/src/swrender.js,
// a pure leaf). The renderer strings are the ones the browsers actually report (measured 2026-11-24
// on Chromium/Windows: --disable-gpu, --use-angle=swiftshader, --use-angle=d3d11-warp, the AMD iGPU).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSoftwareRenderer, softwareModeOn, swFrameGate, swNextAt, SW_PACE } from '../tools/micro/src/swrender.js';

test('software renderers are recognised by what they report', () => {
  const cases = [
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Google Inc. (Google)', 'SwiftShader'],
    ['Google SwiftShader', 'Google Inc.', 'SwiftShader'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Microsoft)', 'Microsoft Basic Render (WARP)'],
    ['Microsoft Basic Render Driver', 'Microsoft', 'Microsoft Basic Render (WARP)'],
    ['ANGLE (Microsoft, WARP, D3D11)', '', 'WARP'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa', 'llvmpipe'],
    ['ANGLE (Mesa, llvmpipe (LLVM 17.0.6, 256 bits), OpenGL 4.5)', 'Google Inc. (Mesa)', 'llvmpipe'],
    ['ANGLE (Mesa, Vulkan 1.3 (lavapipe), lavapipe)', '', 'llvmpipe'],
    ['softpipe', 'Mesa', 'softpipe'],
    ['Apple Software Renderer', 'Apple Inc.', 'Apple Software Renderer'],
  ];
  for (const [renderer, vendor, name] of cases) {
    const r = detectSoftwareRenderer({ renderer, vendor });
    assert.equal(r.software, true, renderer);
    assert.equal(r.name, name, renderer);
    assert.equal(r.renderer, renderer);
  }
});

test('hardware and masked renderers are not software', () => {
  for (const renderer of [
    'ANGLE (AMD, AMD Radeon(TM) 890M Graphics (0x0000150E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)',
    'ANGLE (Intel, Vulkan 1.3.255 (Intel(R) Xe Graphics (TGL GT2) (0x00009A49)), Intel open-source Mesa driver)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M2', 'Adreno (TM) 740', 'Mali-G710', 'WebKit WebGL', 'Mozilla', '',
  ]) assert.equal(detectSoftwareRenderer({ renderer, vendor: '' }).software, false, renderer);
  assert.equal(detectSoftwareRenderer().software, false);
  assert.equal(detectSoftwareRenderer({ renderer: null, vendor: undefined }).software, false);
});

test('the setting wins over the detector; auto follows it', () => {
  assert.equal(softwareModeOn('on', false), true);
  assert.equal(softwareModeOn('off', true), false);
  assert.equal(softwareModeOn('auto', true), true);
  assert.equal(softwareModeOn('auto', false), false);
  assert.equal(softwareModeOn(undefined, true), true);
});


test('pacing: nothing owed is idle; interaction draws at once, even mid-frame and mid-load', () => {
  assert.equal(swFrameGate({ now: 1000, dirty: false, converged: true }), 'idle');
  assert.equal(swFrameGate({ now: 1000, dirty: true, converged: false, pending: true, lastInteract: 950, lastChunk: 990, nextAt: 5000 }), 'draw');
});

test('pacing: nothing draws while the last frame is still being rasterized', () => {
  assert.equal(swFrameGate({ now: 10000, dirty: true, converged: false, pending: true }), 'wait');
  assert.equal(swFrameGate({ now: 10000, dirty: false, converged: false, pending: true }), 'wait');
  assert.equal(swFrameGate({ now: 10000, dirty: true, converged: false, pending: false }), 'draw');
});

test('pacing: while data arrives, no refinement, and a change waits a rest proportional to the frame cost', () => {
  const P = SW_PACE;
  // converging (not dirty) with a chunk 100 ms ago: wait, however long since the last frame
  assert.equal(swFrameGate({ now: 10000, dirty: false, converged: false, lastChunk: 9900, nextAt: 0 }), 'wait');
  // a cheap frame rests the floor, an expensive one LOAD_REST × its cost
  assert.equal(swNextAt({ done: 10000, cost: 10, lastChunk: 9900 }), 10000 + P.LOAD_GAP_MS);
  assert.equal(swNextAt({ done: 10000, cost: 1500, lastChunk: 9900 }), 10000 + P.LOAD_REST * 1500);
  const next = swNextAt({ done: 10000, cost: 1500, lastChunk: 9900 });
  assert.equal(swFrameGate({ now: next - 1, dirty: true, converged: false, lastChunk: next - 100, nextAt: next }), 'wait');
  assert.equal(swFrameGate({ now: next, dirty: true, converged: false, lastChunk: next - 100, nextAt: next }), 'draw');
});

test('pacing: once the data is quiet, convergence resumes at IDLE_REST × the frame cost', () => {
  const P = SW_PACE;
  const quiet = 10000 - P.LOAD_QUIET_MS - 1;
  assert.equal(swNextAt({ done: 10000, cost: 10, lastChunk: quiet }), 10000 + P.CONVERGE_GAP_MS);
  const next = swNextAt({ done: 10000, cost: 800, lastChunk: quiet });
  assert.equal(next, 10000 + P.IDLE_REST * 800);
  assert.equal(swFrameGate({ now: next - 1, dirty: false, converged: false, lastChunk: quiet, nextAt: next }), 'wait');
  assert.equal(swFrameGate({ now: next, dirty: false, converged: false, lastChunk: quiet, nextAt: next }), 'draw');
  // just after an interaction there is no rest
  assert.equal(swNextAt({ done: 10000, cost: 800, lastInteract: 9990, lastChunk: quiet }), 10000);
});
