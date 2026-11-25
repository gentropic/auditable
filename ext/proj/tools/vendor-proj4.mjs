#!/usr/bin/env node
// Vendor proj4js into @gcu/proj: the published, minified UMD bundle (dist/proj4.js — proj4 +
// wkt-parser + mgrs, MIT all three) copied VERBATIM between two marker lines and wrapped as an
// ES module, so @gcu/build can inline it into ext/proj/index.js.
//
//   npm pack proj4@2.22.0 && mkdir p && tar xzf proj4-2.22.0.tgz -C p
//   node ext/proj/tools/vendor-proj4.mjs p/package
//
// Writes src/vendor-proj4.js (the wrapped bundle) and vendor/VENDOR.json (version + sha256 of
// the verbatim bytes). The licences live in vendor/ (LICENSE-proj4.md, -wkt-parser, -mgrs).
// No network here: the tarball is fetched by hand, deliberately, and its hash recorded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = process.argv[2];
if (!pkgDir) { console.error('usage: node vendor-proj4.mjs <extracted proj4 package dir>'); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const dist = fs.readFileSync(path.join(pkgDir, 'dist', 'proj4.js'), 'utf8').replace(/\r\n/g, '\n').trim();
if (/\bnew Function\b|\beval\(/.test(dist)) { console.error('proj4 dist uses eval / new Function — refusing (Sealed builds forbid it)'); process.exit(1); }
const sha = crypto.createHash('sha256').update(dist).digest('hex');
const out = `// proj4js ${pkg.version} — VENDORED VERBATIM (dist/proj4.js, MIT: proj4 + wkt-parser + mgrs;
// licences in ext/proj/vendor/). Regenerate with ext/proj/tools/vendor-proj4.mjs; never edit.
// The UMD bundle sees a CommonJS \`module\`, assigns its export there, and we export it as \`proj4\`.
const module = { exports: {} };
const exports = module.exports;
// ---- BEGIN proj4 ${pkg.version} dist/proj4.js (sha256 ${sha}) ----
${dist}
// ---- END proj4 ----
export const proj4 = module.exports;
`;
fs.writeFileSync(path.join(here, '..', 'src', 'vendor-proj4.js'), out);
const vj = path.join(here, '..', 'vendor', 'VENDOR.json');
const prev = fs.existsSync(vj) ? JSON.parse(fs.readFileSync(vj, 'utf8')) : {};
prev.proj4 = { version: pkg.version, file: 'dist/proj4.js', sha256: sha, bytes: dist.length, licence: 'MIT', bundles: ['proj4', 'wkt-parser', 'mgrs'] };
fs.writeFileSync(vj, JSON.stringify(prev, null, 2) + '\n');
console.log(`vendored proj4 ${pkg.version} (${(dist.length / 1024).toFixed(1)} KB, sha256 ${sha.slice(0, 12)}…)`);
