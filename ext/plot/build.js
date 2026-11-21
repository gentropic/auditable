#!/usr/bin/env node
// Bundles ext/plot/src/ ES modules into a single index.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, 'src');
const mainPath = path.join(srcDir, 'main.js');
const mainSrc = fs.readFileSync(mainPath, 'utf8');

// Extract module paths from main.js (imports and re-exports)
const importPaths = [];
for (const line of mainSrc.split('\n')) {
  // './x.js' in src/, or '../../theme/src/theme.js' — a shared package's source, concatenated in
  const m = line.match(/^(?:import|export)\s+.*['"](\.\.?\/.+?)['"];?\s*(?:\/\/.*)?$/);
  if (m && !importPaths.includes(m[1])) importPaths.push(m[1]);   // a re-export names a file already in
}

const chunks = [];
for (const relPath of importPaths) {
  const filePath = path.join(srcDir, relPath);
  let src = fs.readFileSync(filePath, 'utf8');
  const basename = path.basename(relPath);

  // Strip import lines (single-line and multi-line)
  src = src.replace(/^import\s+.*['"].*['"];?\s*$/gm, '');
  src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"].*['"];?\s*$/gm, '');

  // Replace export function -> function, export const -> const, etc.
  src = src.replace(/^export function /gm, 'function ');
  src = src.replace(/^export const /gm, 'const ');
  src = src.replace(/^export let /gm, 'let ');
  src = src.replace(/^export class /gm, 'class ');
  src = src.replace(/^export async function /gm, 'async function ');

  // Strip export { ... } and export default lines
  src = src.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  src = src.replace(/^export\s+default\s+.*$/gm, '');

  // Trim leading/trailing blank lines
  src = src.replace(/^\n+/, '').replace(/\n+$/, '');

  chunks.push(`// -- ${basename} --\n\n${src}`);
}

const header = '// \u26a0 GENERATED FILE \u2014 DO NOT EDIT. Source: ext/plot/src/  Build: node ext/plot/build.js\n'
  + '// @gcu/plot \u2014 Canvas 2D plotting library for Auditable\n'
  + '// Line, scatter, bar, histogram, imshow. GCU dark theme.\n';

// The bundle is the package's entry ('@gcu/plot'): the source imports @gcu/theme from outside
// the package, so src/ can't be published as an entry. It exports every name src/api.js
// exports (the pyplot functions: xlabel, title, …), plus the classes and helpers below.
const EXTRA = ['Figure', 'Axes', 'LinearScale', 'LogScale', 'getCmap', 'replay', 'recordingContext', 'themeFromCSS', 'resolveTheme',
  'Normalize', 'LogNorm', 'TwoSlopeNorm', 'CenteredNorm', 'BoundaryNorm', 'ListedColormap', 'LinearSegmentedColormap', 'toSVG', 'encodePNG', 'interact', 'link'];
const apiSrc = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');
const apiNames = [];
for (const m of apiSrc.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)) apiNames.push(m[1]);
for (const m of apiSrc.matchAll(/^export \{([^}]*)\};?[ \t]*$/gm)) for (const n of m[1].split(',')) { const k = n.trim().split(/\s+as\s+/).pop(); if (k) apiNames.push(k); }
const exportNames = [...new Set([...apiNames, ...EXTRA])];
const output = header + '\n' + chunks.join('\n\n') + '\n\nexport { ' + exportNames.join(', ') + ' };\n';

const outPath = path.join(__dirname, 'index.js');
fs.writeFileSync(outPath, output);
const size = fs.statSync(outPath).size;
console.log(`Built ext/plot/index.js (${(size / 1024).toFixed(1)} KB)`);

// API.md's "Unsupported" table comes from the SAME lists the warnings read (src/opts.js), so
// the docs and the warnings can't drift; llms.txt is API.md, for models.
const { _UNSUPPORTED, _NOOP_CALLS } = await import('./src/opts.js');
const rows = [];
const cell = (s) => String(s).replace(/\|/g, '\\|');                    // a | would split the table row
for (const [fn, keys] of Object.entries(_UNSUPPORTED)) for (const [k, hint] of Object.entries(keys)) rows.push(`| \`${fn}(…, {${k}})\` | ${cell(hint)} |`);
for (const [fn, hint] of Object.entries(_NOOP_CALLS)) rows.push(`| \`${fn}()\` | ${cell(hint)} |`);
const apiPath = path.join(__dirname, 'API.md');
let api = fs.readFileSync(apiPath, 'utf8');
api = api.replace(/<!-- unsupported:begin -->[\s\S]*?<!-- unsupported:end -->/, `<!-- unsupported:begin -->\n| | instead |\n|---|---|\n${rows.join('\n')}\n<!-- unsupported:end -->`);
fs.writeFileSync(apiPath, api);
fs.writeFileSync(path.join(__dirname, 'llms.txt'), api);
console.log(`Wrote ext/plot/API.md + llms.txt (${rows.length} unsupported entries, from src/opts.js)`);

// gallery.html: every ```js example <name> block of API.md, drawn in the dark theme and in
// paper, each under interact(). The examples become functions of this page's own module at
// build time (no eval on the page), with every name the bundle exports in scope — so the
// gallery can't drift from the docs, and a model reading API.md sees code that runs.
const examples = [...api.matchAll(/^```js example ([\w-]+)\n([\s\S]*?)^```$/gm)].map((m) => ({ name: m[1], code: m[2] }));
const indent = (s) => s.replace(/^(?=.)/gm, '    ');
const gallery = `<!doctype html>
<!-- ⚠ GENERATED by ext/plot/build.js from API.md's examples. Open it from a local server
     (python -m http.server, at the repo root or ext/plot/): a module can't load over file://. -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@gcu/plot gallery</title>
<style>
  body { margin: 0; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; }
  section { padding: 16px 20px 24px; }
  section.dark { background: #0e0f11; color: #ddd; }
  section.paper { background: #f4f4f2; color: #222; }
  h2 { font-size: 13px; font-weight: normal; margin: 0 0 12px; opacity: .7; }
  .grid { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-size: 11px; opacity: .6; margin-top: 4px; }
  .err { color: #e44; white-space: pre-wrap; }
</style>
<body>
<section class="dark"><h2>@gcu/plot · dark · ${examples.length} examples from API.md — hover, wheel, drag, shift-drag, double-click</h2><div class="grid" id="dark"></div></section>
<section class="paper"><h2>paper (plt.style.use('default'))</h2><div class="grid" id="paper"></div></section>
<script type="module">
import * as P from './index.js';
const { ${exportNames.join(', ')} } = P;
const EXAMPLES = [
${examples.map((e) => `  ['${e.name}', () => {\n${indent(e.code)}    return fig;\n  }],`).join('\n')}
];
for (const [theme, style] of [['dark', 'dark_background'], ['paper', 'default']]) {
  P.style.use(style);
  const host = document.getElementById(theme);
  for (const [name, make] of EXAMPLES) {
    const box = document.createElement('figure');
    try {
      const ui = interact(make());
      box.append(ui.element);
    } catch (e) {
      box.innerHTML = '<div class="err"></div>';
      box.firstChild.textContent = name + ': ' + (e && e.stack || e);
      console.error(e);
    }
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    box.append(cap);
    host.append(box);
  }
}
P.style.use('dark_background');
window.__galleryDone = EXAMPLES.length;
</script>
`;
fs.writeFileSync(path.join(__dirname, 'gallery.html'), gallery);
console.log(`Wrote ext/plot/gallery.html (${examples.length} examples)`);
