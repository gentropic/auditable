// How long does micro's demo project take to assemble, on whatever renderer this browser gets?
// A timing probe, not a pass/fail gate: it opens micro (dev tree, or --built), runs the demo project
// (block model + drillholes + terrain + phases + ore shell + section + grade-tonnage) and reports the
// wall time, the renderer string, whether software-rendering mode engaged, and the budget in force.
//
//   node test/micro-demo-timing.mjs                      # Chromium's default GL (ANGLE)
//   MICRO_CHROMIUM_ARGS=--disable-gpu node test/micro-demo-timing.mjs                # SwiftShader
//   MICRO_CHROMIUM_ARGS=--use-angle=d3d11-warp node test/micro-demo-timing.mjs       # Windows WARP
//   BUDGET=100000 node test/micro-demo-timing.mjs        # a stored budget, as if the user chose it
//   node test/micro-demo-timing.mjs --built --timeout=900
//   SWRENDER=on|off …                                    # force the software mode's setting
//
// On the lab (no flag = SwiftShader; --use-angle=vulkan = the Iris Xe) this is how the
// software-renderer mode was measured (2026-11-24). Writes { wall_s, software, budget } to
// $LAB_RESULT when set. Exit 0 when the demo assembled, 1 when it didn't within the timeout.
import { chromium } from 'playwright';
import http from 'http';
import { readFile, writeFile } from 'fs/promises';
import { join, extname } from 'path';

const BUILT = process.argv.includes('--built');
const TIMEOUT_S = +((process.argv.find((a) => a.startsWith('--timeout=')) || '').slice(10) || 900);
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const args = (process.env.MICRO_CHROMIUM_ARGS || '--use-gl=angle').split(/\s+/).filter(Boolean);
const br = await chromium.launch({ args });
const ctx = await br.newContext({ viewport: { width: 1100, height: 750 } });
await ctx.addInitScript(({ budget, sw }) => {
  try {
    if (budget) localStorage.setItem('micro.budget', budget);
    if (sw) localStorage.setItem('micro.swRender', sw);
  } catch { /* opaque origin */ }
}, { budget: process.env.BUDGET || '', sw: process.env.SWRENDER || '' });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:${server.address().port}${BUILT ? '/micro.html' : '/tools/micro/index.html'}`);
await p.waitForFunction(() => window._micro, null, { timeout: 120000 });
const boot = await p.evaluate(() => ({
  meta: document.querySelector('#meta').textContent,
  software: document.body.classList.contains('sw-render'),
  budget: document.querySelector('#budget').value,
  edl: document.querySelector('#edlOn').checked,
  renderer: (() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })(),
}));
console.log(`renderer: ${boot.renderer}`);
console.log(`software mode: ${boot.software} · budget ${boot.budget} · EDL ${boot.edl} · status “${boot.meta}”`);

const t0 = Date.now();
await p.evaluate(() => { window.__demoDone = null; window._micro.openDemoProject().then(() => { window.__demoDone = 'ok'; }, (e) => { window.__demoDone = 'threw: ' + e.message; }); });
let last = '', done = null;
while ((Date.now() - t0) / 1000 < TIMEOUT_S) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await p.evaluate(() => ({ done: window.__demoDone, layers: window._micro.layers().length, meta: (document.querySelector('#meta').textContent || '').slice(0, 90) }));
  const line = `${s.layers} layers | ${s.meta}`;
  if (line !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${line}`); last = line; }
  if (s.done) { done = s.done; break; }
}
const wall = (Date.now() - t0) / 1000;
console.log(done === 'ok' ? `assembled in ${wall.toFixed(1)} s` : `NOT assembled after ${wall.toFixed(0)} s (${done || 'timeout'})`);
console.log(`stats: ${await p.evaluate(() => document.querySelector('#stats').textContent)}`);
// then: how long until the still view has converged (the picture complete)
let conv = null;
if (done === 'ok') {
  const t1 = Date.now();
  while ((Date.now() - t1) / 1000 < TIMEOUT_S) {
    if (await p.evaluate(() => /converged/.test(document.querySelector('#stats').textContent))) { conv = (Date.now() - t0) / 1000; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(conv != null ? `view converged at ${conv.toFixed(1)} s` : 'view NOT converged within the timeout');
  console.log(`stats: ${await p.evaluate(() => document.querySelector('#stats').textContent)}`);
}
if (process.env.LAB_RESULT) await writeFile(process.env.LAB_RESULT, JSON.stringify({ wall_s: +wall.toFixed(1), converged_s: conv != null ? +conv.toFixed(1) : -1, software: boot.software ? 1 : 0, budget: +boot.budget, assembled: done === 'ok' ? 1 : 0 }));
await br.close(); server.close();
process.exit(done === 'ok' ? 0 : 1);
