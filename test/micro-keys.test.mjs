// micro's keyboard shortcuts have ONE list (tools/micro/src/keys.js). The manual
// and the printable card are rendered from it (docs/sync-keys.mjs), and the
// single-key handler in the app must bind exactly the keys the list names — the
// three hand-written copies this replaced had drifted apart (a bare digit
// "jumped to a bookmark" in the manual years after it stopped doing anything).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KEYS } from '../tools/micro/src/keys.js';
import { renderKeyDocs } from '../tools/micro/docs/sync-keys.mjs';

test('micro keys: the manual and the card are rendered from keys.js (run docs/sync-keys.mjs)', () => {
  for (const r of renderKeyDocs()) assert.equal(r.before, r.after, `${r.file} is out of date — node tools/micro/docs/sync-keys.mjs`);
});

test('micro keys: the single-key handler binds exactly the keys the list names', () => {
  const src = fs.readFileSync(new URL('../tools/micro/index.html', import.meta.url), 'utf8');
  const start = src.indexOf("if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;   // typing, not commanding");
  assert.ok(start > 0, 'the single-key handler');
  const body = src.slice(start, src.indexOf('\n});', start));
  const bound = new Set([...body.matchAll(/k === '([^']+)'/g)].map((m) => m[1]).filter((k) => !['Shift', 'Control', 'Alt', 'Meta'].includes(k)));
  const listed = new Set(KEYS.flatMap((k) => k.bind || []));
  assert.deepEqual([...bound].filter((k) => !listed.has(k)).sort(), [], 'bound in the app but missing from keys.js');
  assert.deepEqual([...listed].filter((k) => !bound.has(k)).sort(), [], 'in keys.js but not bound by the app');
});
