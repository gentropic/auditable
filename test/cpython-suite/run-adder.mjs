// node test/cpython-suite/run-adder.mjs <file.py> [auto|tree] [siteDir ...]
// Runs a Python file under adder (the src tree) with a VFS: each siteDir is copied to
// /site/<basename> and /site is put on sys.path. Prints the program's output; an uncaught error
// as "ERR <type>: <message>" (with TB=1, the adder traceback and JS stack too).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const A = await import(new URL('ext/adder/src/index.js', ROOT));
A.attachAir(await import(new URL('ext/air/index.js', ROOT)));
// unittest and the rest of the stdlib precompiled — a stale batteries.js is refused (compiled on import)
A.addPrecompiled((await import(new URL('ext/adder/batteries.js', ROOT))).default);
// the compile cache on disk: modules and exec strings compiled by an earlier run aren't compiled
// again (ADDER_NO_CACHE=1 to run without it)
if (!process.env.ADDER_NO_CACHE) A.setCompileStore((await import(new URL('ext/adder/src/node-cache.js', ROOT))).nodeCompileStore());
const B = await import(new URL('ext/adder/src/builtins.js', ROOT));
const { VFS } = await import(new URL('ext/vfs/src/vfs.js', ROOT));
const { path: vfsPath } = await import(new URL('ext/vfs/src/path.js', ROOT));

const [file, engine = 'auto', ...sites] = process.argv.slice(2);
const vfs = await VFS.create();
await vfs.mkdir('/site', { recursive: true });
await vfs.mkdir('/tmp', { recursive: true });
// the working directory (os.getcwd()): where a test's TESTFN files are made
await vfs.mkdir('/projects/self', { recursive: true });
async function copy(src, dst) {
  if (statSync(src).isDirectory()) {
    await vfs.mkdir(dst, { recursive: true });
    for (const e of readdirSync(src)) if (e !== '__pycache__') await copy(join(src, e), dst + '/' + e);
  } else if (/\.(py|txt|json|cfg|xml|html|csv)$/.test(src)) {
    await vfs.writeFile(dst, readFileSync(src, 'utf8'));
  }
}
for (const s of sites) await copy(s, '/site/' + basename(s));
B.setAdderVFS(vfs, vfsPath);
const code = 'import sys\nsys.path.insert(0, "/site")\n' + readFileSync(file, 'utf8');
try {
  await A.run(code, { engine, vfs, stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) });
} catch (e) {
  const msg = String((e && (e.pyType ? `${e.pyType}: ${e.pyMessage}` : e.message)) || e).split('\n')[0];
  process.stdout.write(`ERR ${msg}\n`);
  if (process.env.TB) {
    if (e && e._traceback) process.stdout.write('TB ' + JSON.stringify(e._traceback) + ' line ' + e.adderLine + '\n');
    process.stdout.write(String((e && e.stack) || '').split('\n').slice(1, 10).join('\n') + '\n');
  }
}
process.exit(0);
