// micro — is the 3D view drawn by a SOFTWARE renderer? A pure leaf (no DOM, no imports), so the
// answer is unit-tested (test/micro-swrender.test.mjs) and the app glue (src/software-mode.js) only
// reads the GL strings and hands them here.
//
// On a machine without a usable GPU — a VM, a remote desktop, a locked-down laptop, a CI box — the
// browser falls back to a CPU rasterizer, and micro's GPU habits (a 1M-element budget, a frame
// accumulating every animation frame, an idle pick capture) starve everything else: the demo
// project took 581 s to assemble on SwiftShader. What each renderer actually reports (the
// WEBGL_debug_renderer_info UNMASKED_RENDERER string, measured 2026-11-24 unless noted):
//   SwiftShader  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
//                (Chrome's --disable-gpu / no-GPU fallback; older Chromes: "Google SwiftShader")
//   WARP         "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)"
//                (Windows' software D3D; Firefox says "Microsoft Basic Render Driver" too)
//   llvmpipe     "llvmpipe (LLVM 15.0.7, 256 bits)", via ANGLE "ANGLE (Mesa, llvmpipe (LLVM …), OpenGL 4.5)"
//                (Mesa on Linux without a GPU driver; its Vulkan twin lavapipe also says llvmpipe)
//   softpipe     "softpipe" (Mesa's reference rasterizer)
//   Apple        "Apple Software Renderer" (macOS' fallback)
// A renderer that names a real GPU, or a masked one ("WebKit WebGL", "Mozilla"), is NOT software:
// without evidence micro keeps its GPU behaviour. failIfMajorPerformanceCaveat is NOT used — Chrome
// hands SwiftShader out under it when the flag asked for SwiftShader (measured), so it says nothing.

const SOFTWARE = [
  [/swiftshader/i, 'SwiftShader'],
  [/microsoft basic render/i, 'Microsoft Basic Render (WARP)'],
  [/\bwarp\b/i, 'WARP'],
  [/llvmpipe|lavapipe/i, 'llvmpipe'],
  [/softpipe/i, 'softpipe'],
  [/apple software renderer/i, 'Apple Software Renderer'],
];

// → { software: bool, name: '' | the renderer's family, renderer: the string looked at }
export function detectSoftwareRenderer({ renderer = '', vendor = '' } = {}) {
  const s = `${renderer || ''} ${vendor || ''}`;
  for (const [re, name] of SOFTWARE) if (re.test(s)) return { software: true, name, renderer: String(renderer || '') };
  return { software: false, name: '', renderer: String(renderer || '') };
}

// the mode actually in force: the user's setting ('on' / 'off') wins; 'auto' follows the detector
export function softwareModeOn(pref, detected) {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return !!detected;
}

// ── the software mode's frame pacing. On a GPU the render loop draws every animation frame until
// the picture converges; on a CPU rasterizer one frame of the demo (100k blocks) is ~1.5 s of the
// "GPU" process's time, and every synchronous GL call the loaders make (an upload, a shader link
// status, a fence) queues behind it: with a frame a second while the demo loaded, it took 100 s;
// with none, 5 s (measured, SwiftShader, 2026-11-24). So the mode draws ON CHANGE and paces itself
// by the renderer's own speed, read from a fence after each frame:
//   · a change the user is making (orbit, zoom — input in the last INTERACT_MS) draws at once;
//   · otherwise nothing draws while the last frame is still being rasterized (`pending`);
//   · after it, the renderer rests LOAD_REST × that frame's cost while data is still arriving (a
//     chunk landed in the last LOAD_QUIET_MS) — and at least LOAD_GAP_MS — or IDLE_REST × it
//     once the data is quiet (at least CONVERGE_GAP_MS), so the loaders keep most of the machine;
//   · there is no progressive refinement while data is arriving: only a change draws.
export const SW_PACE = { INTERACT_MS: 400, LOAD_QUIET_MS: 800, LOAD_GAP_MS: 2000, LOAD_REST: 6, CONVERGE_GAP_MS: 120, IDLE_REST: 1 };

// → 'idle' (nothing owed) | 'wait' (owed, not yet) | 'draw'
export function swFrameGate({ now, dirty, converged, pending = false, lastInteract = -Infinity, lastChunk = -Infinity, nextAt = 0 }, P = SW_PACE) {
  if (!dirty && converged) return 'idle';
  if (dirty && now - lastInteract < P.INTERACT_MS) return 'draw';
  if (pending || now < nextAt) return 'wait';
  if (!dirty && now - lastChunk < P.LOAD_QUIET_MS) return 'wait';
  return 'draw';
}

// → the earliest time the next non-interactive frame may draw: `done` = when the last frame's
// fence signalled, `cost` = how long it took the renderer (submit → signal), in ms
export function swNextAt({ done, cost = 0, lastInteract = -Infinity, lastChunk = -Infinity }, P = SW_PACE) {
  if (done - lastInteract < P.INTERACT_MS) return done;
  return done - lastChunk < P.LOAD_QUIET_MS
    ? done + Math.max(P.LOAD_GAP_MS, P.LOAD_REST * cost)
    : done + Math.max(P.CONVERGE_GAP_MS, P.IDLE_REST * cost);
}
