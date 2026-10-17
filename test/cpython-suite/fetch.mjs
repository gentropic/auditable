// node test/cpython-suite/fetch.mjs — a sparse checkout of CPython's Lib/test, at the tag matching
// the local `python` (its results are the reference the adder runs are compared with), into
// test/cpython-suite/cpython (gitignored). Re-running with the same version does nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dest = join(HERE, 'cpython');
const version = execFileSync('python', ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).trim();
const stamp = join(dest, '.adder-version');
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version) { console.log(`CPython ${version} tests already in ${dest}`); process.exit(0); }
if (existsSync(dest)) { console.error(`${dest} holds another version's tests — remove it first`); process.exit(1); }
const git = (...a) => execFileSync('git', a, { stdio: 'inherit', cwd: HERE });
git('clone', '--quiet', '--depth', '1', '--branch', `v${version}`, '--filter=blob:none', '--sparse', 'https://github.com/python/cpython', dest);
execFileSync('git', ['sparse-checkout', 'set', 'Lib/test'], { stdio: 'inherit', cwd: dest });
writeFileSync(stamp, version + '\n');
console.log(`CPython ${version} Lib/test → ${dest}`);
