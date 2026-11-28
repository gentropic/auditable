// Builds the lamina manual: screenshots from a live lamina, then the book. (The wuffle manual's harness,
// trimmed: lamina has no console to generate a command appendix from.)
//
//   node tools/lamina/docs/manual/build.mjs              everything (shots · print · pdf)
//   node tools/lamina/docs/manual/build.mjs pdf          only the book
//   node tools/lamina/docs/manual/build.mjs shots --only overview,gt-report
//
// shots — every screenshot named in figures/wanted/*.txt that scenes.mjs knows how to stage →
//         figures/shots/<name>.png, each from a FRESH lamina (its own IndexedDB: no recents or index
//         cache carried between scenes); a name with no scene is listed, and the book shows a placeholder
// print — each shot's print copy (≤1800 px, JPEG or PNG, whichever is smaller) → figures/print/
// pdf   — latexmk (LuaLaTeX, biber for references.bib) → build/lamina-manual.pdf
// dd60  — the cover (opt-in: needs Blender, takes minutes): cover/lcd.mjs draws the DD-60's screen from the
//         sample's own rows, cover/label.mjs prints the caddy's label, cover/dd60.py models and renders the
//         device in Blender (Cycles, a shadow catcher, wuffle's studio HDRI when it's there), and wuffle's
//         on-basalt.mjs lays it on the page's basalt → cover/cover.jpg (the title page picks it up).
//
// WHICH lamina: work/lamina.html when it exists (a pinned build — copy one there to shoot a fixed version
// while lamina itself is being changed), else the built lamina.html at the repo root.
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

// ── a live lamina ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' };
async function startServer() {
  const pinned = join(HERE, 'work', 'lamina.html'), built = join(ROOT, 'lamina.html');
  const page = existsSync(pinned) ? pinned : built;
  if (!existsSync(page)) throw new Error('shots: no lamina.html — run `node build.js --target=lamina` (or copy a build to work/lamina.html)');
  console.log('shots: from', page === pinned ? 'the PINNED work/lamina.html' : 'the built lamina.html');
  const server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const body = path === '/lamina.html' ? await readFile(page) : await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/lamina.html`, close: () => server.close() };
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
      const vp = scene.viewport || { width: 1280, height: 760 };
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scene.dark ? 'dark' : 'light' });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log(`  ${name}: page error:`, e.message));
      try {
        await p.goto(srv.url + (scene.query || ''), { waitUntil: 'load' });
        await p.waitForFunction(() => window.lamina && window._lamina, null, { timeout: 30000 });
        const ev = (fn, arg) => p.evaluate(fn, arg);
        // helpers a scene can use: open a text or base64 file as a dropped File, the sample model
        const openText = (fname, text) => p.evaluate(async ({ fname, text }) => { try { await window.lamina.open(new File([text], fname)); } catch { /* a picker or a note is a state too */ } }, { fname, text });
        const openB64 = (fname, b64) => p.evaluate(async ({ fname, b64 }) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); try { await window.lamina.open(new File([b], fname)); } catch { /* idem */ } }, { fname, b64 });
        const sample = async () => { await p.evaluate(() => window._lamina.openSampleData()); await p.waitForFunction(() => /rows/.test(document.querySelector('#meta').textContent)); await p.waitForTimeout(1200); };
        const r = (await scene.stage({ p, ev, openText, openB64, sample })) || {};
        await p.waitForTimeout(r.wait || 800);
        if (r.els) {
          const boxes = (await Promise.all(r.els.map((s) => p.locator(s).first().boundingBox()))).filter(Boolean);
          const pad = r.pad ?? 6, v = p.viewportSize();
          const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad), y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
          const x2 = Math.min(v.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad), y2 = Math.min(v.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
          await p.screenshot({ path: join(out, name + '.png'), clip: { x, y, width: x2 - x, height: y2 - y } });
        } else if (r.clip) await p.screenshot({ path: join(out, name + '.png'), clip: r.clip });
        else await (r.el ? p.locator(r.el).first() : p).screenshot({ path: join(out, name + '.png') });
        console.log('shot:', name);
      } catch (e) { console.log(`shot: ${name} FAILED — ${e.message.split('\n')[0]}`); process.exitCode = 1; }
      finally { await ctx.close(); }
    }
  } finally { await browser.close(); srv.close(); }
  if (missing.length) console.log(`shots without a scene yet (${missing.length}):\n  ` + missing.join('\n  '));
}

// ── print: the 2× captures are far bigger than the page needs ──
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
  const r = spawnSync('latexmk', ['-lualatex', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-outdir=build', 'lamina-manual.tex'], { cwd: HERE, stdio: 'inherit', shell: true, env: { ...process.env, TTFONTS: FONTS + '//;', OSFONTDIR: FONTS } });
  // latexmk exits non-zero on MiKTeX's "you have not checked for updates" nag alone — judge by the log
  let log = ''; try { log = readFileSync(join(HERE, 'build', 'lamina-manual.log'), 'utf8'); } catch {}
  const errors = (log.match(/^\S+\.tex:\d+: .*$/gm) || []).length + (/Fatal error occurred/.test(log) ? 1 : 0);
  const overfull = (log.match(/^Overfull \\hbox/gm) || []).length, missing = (log.match(/Missing character/g) || []).length;
  let blg = ''; try { blg = readFileSync(join(HERE, 'build', 'lamina-manual.blg'), 'utf8'); } catch {}
  const biberErrors = blg.match(/^ERROR - .*$/gm) || [];
  const undefinedCites = [...new Set((log.match(/Citation '[^']+'[^\n]*undefined/g) || []).map((m) => m.match(/'([^']+)'/)[1]))];
  const undefinedRefs = [...new Set((log.match(/Reference `[^']+' on page/g) || []).map((m) => m.match(/`([^']+)'/)[1]))];
  const pages = (log.match(/Output written on .*\((\d+) pages?/) || [])[1];
  if (biberErrors.length) console.log('pdf: biber —\n  ' + biberErrors.join('\n  '));
  if (undefinedCites.length) console.log('pdf: undefined citations — ' + undefinedCites.join(', '));
  if (undefinedRefs.length) console.log('pdf: undefined references — ' + undefinedRefs.join(', '));
  if (errors || biberErrors.length || undefinedCites.length || (r.status !== 0 && !existsSync(join(HERE, 'build', 'lamina-manual.pdf')))) { console.log(`pdf: FAILED (${errors} errors, ${biberErrors.length} biber errors, ${undefinedCites.length} undefined citations) — see build/lamina-manual.log`); process.exitCode = 1; }
  else console.log(`pdf: build/lamina-manual.pdf  (${pages || '?'} pages · overfull lines ${overfull}, missing glyphs ${missing}, undefined references ${undefinedRefs.length})`);
}

// the cover: opt-in only (`node build.mjs dd60 [--res 2100 --samples 320]`)
if (PHASES.includes('dd60')) {
  const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const res = flag('--res', '2100'), samples = flag('--samples', '320');
  for (const s of ['lcd.mjs', 'label.mjs']) if (spawnSync(process.execPath, [join(HERE, 'cover', s)], { stdio: 'inherit' }).status !== 0) { console.log(`dd60: ${s} FAILED`); process.exit(1); }
  const pf = 'C:/Program Files/Blender Foundation';
  const found = existsSync(pf) ? (await readdir(pf)).map((v) => join(pf, v, 'blender.exe')).find((p) => existsSync(p)) : null;
  const blender = process.env.BLENDER || found || 'blender';
  const hdri = resolve(ROOT, 'tools/wuffle/docs/manual/cover/assets/brown_photostudio_02_2k.hdr');   // wuffle's (gitignored, fetched by its waffle step)
  const r = spawnSync(blender, ['-b', '-P', join(HERE, 'cover', 'dd60.py'), '--', '--res', res, '--samples', samples, '--hdri', existsSync(hdri) ? hdri : '', '--out', join(HERE, 'cover', 'cover.png')], { stdio: 'inherit' });
  if (r.status !== 0) { console.log('dd60: FAILED (is Blender installed? set BLENDER=path/to/blender)'); process.exitCode = 1; }
  else spawnSync(process.execPath, [resolve(ROOT, 'tools/wuffle/docs/manual/cover/on-basalt.mjs'), join(HERE, 'cover', 'cover.png'), join(HERE, 'cover', 'cover.jpg')], { stdio: 'inherit' });
}
if (want('shots') && !(PHASES.length === 1 && PHASES[0] === 'dd60')) await phaseShots(await readWanted());
if ((want('print') || want('pdf')) && !(PHASES.length === 1 && PHASES[0] === 'dd60')) await phasePrint();
if (want('pdf') && !(PHASES.length === 1 && PHASES[0] === 'dd60')) phasePdf();
