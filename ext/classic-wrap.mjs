// classic-wrap — a self-contained ES module bundle as a CLASSIC script, its exports on a global.
//
// For pages that cannot load a module: a sandboxed iframe has origin `null`, a module script is
// always fetched in CORS mode, so `<script type="module">` (and any `import`) fails there before
// anything runs, while a classic `<script src>` loads. The wrap is mechanical and CHECKED — it
// refuses rather than guesses:
//   • the bundle has no static `import` and no top-level `await` (it must be self-contained);
//   • its only export is ONE `export { a, b as c }` footer (the shape @gcu/build and the concat
//     builds emit) — anything else (`export function`, `export default`) throws;
//   • `import.meta.url` becomes the script's own URL (document.currentScript.src, captured as the
//     script starts — the only moment it is set), or '' where there is none;
//   • `replace` pairs are applied and each must match EXACTLY once (a stale marker fails the build).
// Strict mode is kept (a module is always strict). The global is frozen.
//
//   import { toClassic } from '../classic-wrap.mjs';
//   writeFileSync('index.classic.js', toClassic(src, { global: 'gcuPlot', banner: '…' }));

export function toClassic(src, { global, replace = [], banner = '' } = {}) {
  if (!/^[A-Za-z_$][\w$]*$/.test(global || '')) throw new Error(`classic-wrap: bad global name ${JSON.stringify(global)}`);
  if (/^\s*import\s*(?:[\w${*]|['"])/m.test(src)) throw new Error('classic-wrap: the bundle has a static import — it must be self-contained');
  if (/^await\s/m.test(src)) throw new Error('classic-wrap: the bundle has a top-level await');
  const foot = /^export\s*\{([^}]*)\}\s*;?\s*$/m;
  const m = foot.exec(src);
  if (!m) throw new Error('classic-wrap: no `export { … }` footer found');
  let body = src.slice(0, m.index) + src.slice(m.index + m[0].length);
  const stray = /^export\s/m.exec(body);
  if (stray) throw new Error(`classic-wrap: an export other than the footer: ${body.slice(stray.index, stray.index + 60)}…`);
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const a = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
    if (!a) throw new Error(`classic-wrap: can't read the export ${JSON.stringify(s)}`);
    return a[2] && a[2] !== a[1] ? `${a[2]}: ${a[1]}` : a[1];
  });
  for (const [from, to] of replace) {
    const n = body.split(from).length - 1;
    if (n !== 1) throw new Error(`classic-wrap: ${JSON.stringify(from.slice(0, 60))} matched ${n} times (want exactly 1)`);
    body = body.replace(from, () => to);
  }
  body = body.replace(/\bimport\.meta\.url\b/g, '__gcuScriptUrl');
  if (/\bimport\.meta\b/.test(body)) throw new Error('classic-wrap: import.meta used for more than .url');
  return `${banner ? banner.replace(/^/gm, '// ') + '\n' : ''}(function (root) {
'use strict';
const __gcuScriptUrl = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
${body}
root.${global} = Object.freeze({ ${names.join(', ')} });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
`;
}
