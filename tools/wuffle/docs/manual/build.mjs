// Builds the wuffle manual: screenshots from a live wuffle, then the book. (The micro manual's harness,
// trimmed: wuffle has no tool registry or demo project to draw charts from yet.)
//
//   node tools/wuffle/docs/manual/build.mjs              everything (shots · print · pdf)
//   node tools/wuffle/docs/manual/build.mjs pdf          only the book
//   node tools/wuffle/docs/manual/build.mjs shots --only desk-tour,console
//
// shots — every screenshot named in figures/wanted/*.txt that scenes.mjs knows how to stage →
//         figures/shots/<name>.png, each from a FRESH wuffle (no autosave carried between scenes); a
//         name with no scene is listed, and the book shows a placeholder
// print — each shot's print copy (≤1800 px, JPEG or PNG, whichever is smaller) → figures/print/
// pdf   — latexmk (LuaLaTeX, biber for references.bib) → build/wuffle-manual.pdf
import { chromium } from 'playwright';
import http from 'http';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { extname, join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { SCENES } from './scenes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const FONTS = resolve(ROOT, 'tools/micro/docs/manual/fonts');   // the micro manual's faces, read in place
const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1]).split(',') : null;
const PHASES = argv.filter((a) => !a.startsWith('--') && !(onlyArg && a === argv[argv.indexOf(onlyArg) + 1]));
const want = (ph) => !PHASES.length || PHASES.includes(ph);

// ── the wanted lists: `name | what the shot shows` per line ──
async function readWanted() {
  const dir = join(HERE, 'figures', 'wanted'), shots = new Map();
  if (!existsSync(dir)) return shots;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.txt')).sort()) {
    for (const raw of (await readFile(join(dir, f), 'utf8')).split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const [name, state = ''] = line.split('|').map((s) => s.trim());
      if (/^[\w-]+$/.test(name)) shots.set(name, { state, from: f });
    }
  }
  return shots;
}

// ── a live wuffle (the dev tree, served from the repo root) ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' };
async function startServer() {
  const server = http.createServer(async (req, res) => {
    try { const path = decodeURIComponent(new URL(req.url, 'http://x').pathname); const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // the BUILT page when there is one (its build stamp and gzipped runtime are what a reader has); the dev
  // tree otherwise, which shows __WUFFLE_BUILD__ in place of the stamp
  const built = existsSync(join(ROOT, 'wuffle.html'));
  if (!built) console.log('shots: no wuffle.html — run `node build.js --target=wuffle` first for the real build stamp; using the dev tree');
  return { url: `http://127.0.0.1:${server.address().port}/${built ? 'wuffle.html' : 'tools/wuffle/index.html'}`, close: () => server.close() };
}

async function phaseShots(shots) {
  const out = join(HERE, 'figures', 'shots');
  await mkdir(out, { recursive: true });
  const srv = await startServer(), browser = await chromium.launch();
  const missing = [];
  try {
    for (const [name, w] of shots) {
      if (ONLY && !ONLY.includes(name)) continue;
      const scene = SCENES[name];
      if (!scene) { missing.push(`${name}  (${w.from}: ${w.state})`); continue; }
      // a fresh context per scene: its own (empty) IndexedDB, so no autosave leaks between shots
      const vp = scene.viewport || { width: 1440, height: 900 };
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log(`  ${name}: page error:`, e.message));
      try {
        await p.goto(srv.url + (scene.query || '?desk'), { waitUntil: 'load' });
        await p.waitForFunction(() => window.__wuffleDesk || window.__wuffle, null, { timeout: 30000 });
        if (scene.query !== '?field') await p.evaluate(() => window.__wuffleDesk.restored);
        const r = (await scene.stage({ p, ev: (fn, arg) => p.evaluate(fn, arg) })) || {};
        await p.waitForTimeout(r.wait || 800);
        await (r.el ? p.locator(r.el).first() : p).screenshot({ path: join(out, name + '.png') });
        console.log('shot:', name);
      } catch (e) { console.log(`shot: ${name} FAILED — ${e.message.split('\n')[0]}`); process.exitCode = 1; }
      finally { await ctx.close(); }
    }
  } finally { await browser.close(); srv.close(); }
  if (missing.length) console.log(`shots without a scene yet (${missing.length}):\n  ` + missing.join('\n  '));
}

// ── print: the 2× captures are far bigger than the page needs (see the micro manual's build.mjs) ──
const PRINT_MAX_W = 1800, PRINT_JPEG_Q = 0.88;
async function phasePrint() {
  const src = join(HERE, 'figures', 'shots'), out = join(HERE, 'figures', 'print');
  if (!existsSync(src)) return;
  await mkdir(out, { recursive: true });
  const names = (await readdir(src)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
  const todo = names.filter((n) => { const have = ['.jpg', '.png'].map((e) => join(out, n + e)).find((f) => existsSync(f)); return !have || statSync(have).mtimeMs < statSync(join(src, n + '.png')).mtimeMs; });
  for (const f of await readdir(out)) if (!names.includes(f.replace(/\.(jpg|png)$/, ''))) unlinkSync(join(out, f));
  if (!todo.length) { console.log(`print: ${names.length} copies up to date`); return; }
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    for (const n of todo) {
      const png = await readFile(join(src, n + '.png'));
      const r = await p.evaluate(async ({ b64, maxW, q }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const k = Math.min(1, maxW / img.naturalWidth), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        return { jpg: c.toDataURL('image/jpeg', q).split(',')[1], png: c.toDataURL('image/png').split(',')[1] };
      }, { b64: png.toString('base64'), maxW: PRINT_MAX_W, q: PRINT_JPEG_Q });
      const jpg = Buffer.from(r.jpg, 'base64'), small = Buffer.from(r.png, 'base64');
      const [ext, bytes] = jpg.length < small.length * 0.8 ? ['.jpg', jpg] : ['.png', small];
      for (const e of ['.jpg', '.png']) { const f = join(out, n + e); if (existsSync(f)) unlinkSync(f); }
      await writeFile(join(out, n + ext), bytes);
    }
    console.log(`print: ${todo.length} copies`);
  } finally { await browser.close(); }
}

// ── pdf ──
function phasePdf() {
  const r = spawnSync('latexmk', ['-lualatex', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-outdir=build', 'wuffle-manual.tex'], { cwd: HERE, stdio: 'inherit', shell: true, env: { ...process.env, TTFONTS: FONTS + '//;', OSFONTDIR: FONTS } });
  // latexmk exits non-zero on MiKTeX's "you have not checked for updates" nag alone — judge by the log
  let log = ''; try { log = readFileSync(join(HERE, 'build', 'wuffle-manual.log'), 'utf8'); } catch {}
  const errors = (log.match(/^\S+\.tex:\d+: .*$/gm) || []).length + (/Fatal error occurred/.test(log) ? 1 : 0);
  const overfull = (log.match(/^Overfull \\hbox/gm) || []).length, missing = (log.match(/Missing character/g) || []).length;
  let blg = ''; try { blg = readFileSync(join(HERE, 'build', 'wuffle-manual.blg'), 'utf8'); } catch {}
  const biberErrors = blg.match(/^ERROR - .*$/gm) || [];
  const undefinedCites = [...new Set((log.match(/Citation '[^']+'[^\n]*undefined/g) || []).map((m) => m.match(/'([^']+)'/)[1]))];
  const undefinedRefs = [...new Set((log.match(/Reference `[^']+' on page/g) || []).map((m) => m.match(/`([^']+)'/)[1]))];
  if (biberErrors.length) console.log('pdf: biber —\n  ' + biberErrors.join('\n  '));
  if (undefinedCites.length) console.log('pdf: undefined citations — ' + undefinedCites.join(', '));
  if (undefinedRefs.length) console.log('pdf: undefined references — ' + undefinedRefs.join(', '));
  if (errors || biberErrors.length || undefinedCites.length || (r.status !== 0 && !existsSync(join(HERE, 'build', 'wuffle-manual.pdf')))) { console.log(`pdf: FAILED (${errors} errors, ${biberErrors.length} biber errors, ${undefinedCites.length} undefined citations) — see build/wuffle-manual.log`); process.exitCode = 1; }
  else console.log(`pdf: build/wuffle-manual.pdf  (overfull lines ${overfull}, missing glyphs ${missing}, undefined references ${undefinedRefs.length})`);
}

if (want('shots')) await phaseShots(await readWanted());
if (want('print') || want('pdf')) await phasePrint();
if (want('pdf')) phasePdf();
