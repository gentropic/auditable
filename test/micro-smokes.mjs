// Every micro smoke suite, at once.
//
//   node test/micro-smokes.mjs                 run them all
//   node test/micro-smokes.mjs --build         build micro.html first
//   node test/micro-smokes.mjs --only=smoke2   only the jobs whose name contains the text
//                                              (several, comma-separated)
//   node test/micro-smokes.mjs --jobs=4        how many suites run at the same time
//   node test/micro-smokes.mjs --shards=6      how many pieces micro-smoke2 is cut into
//   node test/micro-smokes.mjs --list          print the jobs and stop
//   node test/micro-smokes.mjs --verbose       print each suite's whole output as it ends
//
// Each suite is its own process with its own server and browser, so they share
// nothing. The run fails if any suite exits non-zero, which a suite that crashed
// before printing its verdict also does. One line per suite, then the failing
// lines of the ones that failed; the whole output of every suite is kept in a
// log folder that the last line names.
//
// The suites are the same files `npm run test:micro*` and CI run one by one.
// micro-smoke2 is the long one, so it is cut into shards (its --shard=i/n).
// The first job, `cycles`, is the import-cycle check of tools/micro/dev/cycles.mjs.
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const has = (name) => process.argv.includes(`--${name}`);
const SHARDS = Math.max(1, +arg('shards', 4) | 0);
const JOBS = Math.max(1, +arg('jobs', Math.max(2, Math.min(8, os.cpus().length >> 1))) | 0);
const ONLY = arg('only', '').split(',').filter(Boolean);
const VERBOSE = has('verbose');

const jobs = [];
const job = (name, file, ...args) => jobs.push({ name, argv: [path.join('test', file), ...args] });
// not a browser suite: a source check that takes under a second (tools/micro/dev/README.md, "cycles.mjs")
jobs.push({ name: 'cycles', argv: [path.join('tools', 'micro', 'dev', 'cycles.mjs')] });
// not a browser suite either: world ↔ local conversions only in src/coords.js (tools/micro/dev/frame-lint.mjs)
jobs.push({ name: 'frames', argv: [path.join('tools', 'micro', 'dev', 'frame-lint.mjs')] });
for (let i = 0; i < SHARDS; i++) job(`smoke2 ${i + 1}/${SHARDS}`, 'micro-smoke2.mjs', `--shard=${i}/${SHARDS}`);
for (let i = 0; i < SHARDS; i++) job(`smoke2 built ${i + 1}/${SHARDS}`, 'micro-smoke2.mjs', '--built', `--shard=${i}/${SHARDS}`);
job('smoke', 'micro-smoke.mjs');
job('host', 'micro-host-smoke.mjs');
job('mobile', 'micro-mobile-smoke.mjs');
job('structure', 'micro-structure-smoke.mjs');
job('structure built', 'micro-structure-smoke.mjs', '--built');
job('shell', 'micro-shell-smoke.mjs');
job('asbuilt', 'micro-asbuilt-smoke.mjs');      // surveys → mined volumes → factors: point cloud → DEM, cut / fill, factors by surveys
job('asbuilt built', 'micro-asbuilt-smoke.mjs', '--built');
job('compare', 'micro-compare-smoke.mjs');      // two model versions → one composer page: the table = a hand computation, the Δ map's categories, the tool, refresh
job('compare built', 'micro-compare-smoke.mjs', '--built');
job('wfr', 'micro-wfr-smoke.mjs');
job('polygons', 'micro-polygons-smoke.mjs');    // strings & polygons: readers (CSV strings, WKT, WKT-CSV, shapefile, GeoJSON), the CRS refusal, exports, QGIS clipboard, draw / edit, project
job('polygons built', 'micro-polygons-smoke.mjs', '--built');
job('polylimit', 'micro-polylimit-smoke.mjs');  // polygons as limits (GT / stats / swath / cut-fill / DEM) + extrusion to solids (z-range, oriented, between surfaces) into by-solid
job('polylimit built', 'micro-polylimit-smoke.mjs', '--built');
job('wave6', 'micro-wave6-smoke.mjs');         // section lines as strings (meshes, grids, domain boundaries) + bench outlines from blocks (marching squares, rotated / sub-blocked), DXF / shapefile round trips
job('wave6 built', 'micro-wave6-smoke.mjs', '--built');
job('coreg', 'micro-coreg-smoke.mjs');          // every layer kind, opened FIRST into an empty scene and opened second, is drawn where its file says (the world vs frame-local class)
job('coreg built', 'micro-coreg-smoke.mjs', '--built');
job('crs', 'micro-crs-smoke.mjs');              // coordinate systems: the project's CRS, reprojection on read (GeoJSON lon/lat, a SAD69 .prj by IBGE's parameters), KML / KMZ in + out, the selector, {crs}, Sealed
job('crs built', 'micro-crs-smoke.mjs', '--built');
job('placement', 'micro-placement-smoke.mjs');  // placements: typed / control points / CRS change on blocks, meshes, clouds; rotated GeoTIFFs (sampling = the unrotated twin), their exports; the Datamine origin migration
job('placement built', 'micro-placement-smoke.mjs', '--built');
job('crsdetective', 'micro-crsdetective-smoke.mjs');  // wave 6b: GCP markers drawn in 3D, structure attitudes follow a placement, the CRS detective (datum twins vs a DEM, flat-ground refusal, vertical offset, reproject on read)
job('crsdetective built', 'micro-crsdetective-smoke.mjs', '--built');
job('nl', 'micro-nl-smoke.mjs');               // the plain-language bar: wiring + propose-never-act (accuracy: test/micro-nl.test.mjs)
const todo = ONLY.length ? jobs.filter((j) => ONLY.some((o) => j.name.includes(o))) : jobs;
if (has('list')) { for (const j of todo) console.log(`${j.name.padEnd(20)} node ${j.argv.join(' ')}`); process.exit(0); }
if (!todo.length) { console.error(`no job matches --only=${ONLY.join(',')}`); process.exit(1); }

const run = (argv, opts = {}) => new Promise((resolve) => {
  const t0 = Date.now(); let out = '';
  const c = spawn(process.execPath, argv, { cwd: root, env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(c);
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  c.on('close', (code, signal) => { running.delete(c); resolve({ code: code == null ? 1 : code, signal, out, secs: (Date.now() - t0) / 1000 }); });
});
const running = new Set();
process.on('SIGINT', () => { for (const c of running) c.kill(); process.exit(130); });

if (has('build')) {
  process.stdout.write('building micro.html … ');
  const r = await run(['build.js', '--target=micro']);
  if (r.code) { console.log('FAILED'); console.log(r.out); process.exit(1); }
  console.log(`${r.secs.toFixed(1)}s`);
}
// The built suites test micro.html as it lies on disk. Say so when the source is newer.
{
  const built = path.join(root, 'micro.html');
  if (!fs.existsSync(built)) { console.error('micro.html is missing — run with --build (or: node build.js --target=micro)'); process.exit(1); }
  const dir = path.join(root, 'tools', 'micro'), at = fs.statSync(built).mtimeMs;
  const srcs = [path.join(dir, 'index.html'), ...fs.readdirSync(path.join(dir, 'src')).map((f) => path.join(dir, 'src', f))];
  const newer = srcs.filter((f) => fs.statSync(f).mtimeMs > at);
  if (newer.length) console.log(`note: micro.html is older than ${newer.length} file${newer.length > 1 ? 's' : ''} under tools/micro (${path.basename(newer[0])}${newer.length > 1 ? ', …' : ''}) — the built suites test the old build; --build rebuilds first`);
}

// Suites running side by side are slower than alone; give their waits more room.
const env = { ...process.env };
if (!env.SMOKE_TIMEOUT_SCALE && !env.CI && JOBS > 1) env.SMOKE_TIMEOUT_SCALE = '2';
const logDir = path.join(os.tmpdir(), 'micro-smokes');
fs.mkdirSync(logDir, { recursive: true });

const verdictOf = (out) => { const ls = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); return ls.length ? ls[ls.length - 1] : '(no output)'; };
const BAD = /^FAIL|✗|PAGEERROR|\bError\b|not ok|Unhandled|triggerUncaughtException/;
const t0 = Date.now(), failed = [];
let next = 0, done = 0;
console.log(`${todo.length} suites, ${Math.min(JOBS, todo.length)} at a time`);
const worker = async () => {
  for (;;) {
    const j = todo[next++]; if (!j) return;
    const r = await run(j.argv, { env });
    const log = path.join(logDir, j.name.replace(/[^\w]+/g, '-') + '.log');
    fs.writeFileSync(log, r.out);
    const okay = r.code === 0;
    console.log(`${okay ? 'ok  ' : 'FAIL'} ${j.name.padEnd(20)} ${r.secs.toFixed(0).padStart(4)}s  ${okay ? verdictOf(r.out) : `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}`}   [${++done}/${todo.length}]`);
    if (VERBOSE) console.log(r.out);
    if (!okay) failed.push({ j, r, log });
  }
};
await Promise.all(Array.from({ length: Math.min(JOBS, todo.length) }, worker));

for (const { j, r, log } of failed) {
  console.log(`\n── ${j.name} — node ${j.argv.join(' ')}`);
  const ls = r.out.split(/\r?\n/), bad = ls.filter((l) => BAD.test(l)), tail = ls.filter((l) => l.trim()).slice(-12);
  for (const l of bad.slice(0, 40)) console.log('  ' + l);
  if (bad.length > 40) console.log(`  … ${bad.length - 40} more`);
  if (!bad.length || r.signal || !/passed|PASS|FAIL/.test(tail.join('\n'))) { console.log('  last lines:'); for (const l of tail) console.log('    ' + l); }
  console.log(`  log: ${log}`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(failed.length
  ? `\nMICRO SMOKES: FAIL — ${failed.length} of ${todo.length} suites (${failed.map((f) => f.j.name).join(', ')}) in ${secs}s. Logs: ${logDir}`
  : `\nMICRO SMOKES: PASS — ${todo.length} suites in ${secs}s. Logs: ${logDir}`);
process.exit(failed.length ? 1 : 0);
