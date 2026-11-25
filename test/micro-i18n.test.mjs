// micro's pt-BR catalog covers the chrome that is GUARANTEED to pass through t():
// palette command titles + groups, float-window titles + subtitles, and menu items
// (an object with a label and a run / submenu). Static and deliberately loose: only
// single-line string literals are read, so a computed label is simply not checked —
// the test never fails on something it can't see. When it fails it lists the keys;
// add each to tools/micro/src/i18n-pt.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import PT from '../tools/micro/src/i18n-pt.js';

const SRC = path.join(import.meta.dirname, '../tools/micro/src');
const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const val = (m, i) => (m[i] ?? m[i + 1] ?? '').replace(/\\(['"])/g, '$1');
// a lone lowercase word is DATA to menu.js (left as it is); no letters = nothing to say
const translatable = (s) => /[A-Za-z]{2}/.test(s) && !/^[a-z_][\w.]*$/.test(s);
const covered = (s) => s in PT || (/^(✓ |• )/.test(s) && s.slice(2) in PT);

function untranslated() {
  const miss = new Map();
  const want = (s, where) => { s = s.trim(); if (translatable(s) && !covered(s) && !miss.has(s)) miss.set(s, where); };
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js') || f.startsWith('i18n')) continue;
    const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const where = `${f}:${i + 1}`;
      // floatWin({ title: '…', sub: '…' })
      for (const m of line.matchAll(new RegExp(String.raw`floatWin\(\{\s*title:\s*(?:${LIT})(?:,\s*sub:\s*(?:${LIT}))?`, 'g'))) {
        want(val(m, 1), where); if (m[3] != null || m[4] != null) want(val(m, 3), where);
      }
      // palette commands: { id: '…', group: '…', title: '…' }
      if (/\bid:\s*'[\w:.-]+'/.test(line) && /\btitle:/.test(line)) {
        for (const m of line.matchAll(new RegExp(String.raw`\b(title|group):\s*(?:${LIT})`, 'g'))) want(val(m, 2), where);
      }
      // menu items: { label: …, run / action / submenu: … }
      for (const m of line.matchAll(new RegExp(String.raw`\{\s*(?:icon:\s*'[^']*',\s*)?label:\s*(?:${LIT})([^{}]*)`, 'g'))) {
        if (/\b(run|submenu|action)\s*:/.test(m[3])) want(val(m, 1), where);
      }
    });
  }
  return miss;
}

test('micro pt-BR: every literal command / window / menu label has a translation', () => {
  const miss = untranslated();
  assert.equal(miss.size, 0, `untranslated (add to tools/micro/src/i18n-pt.js):\n${[...miss].map(([k, w]) => `  ${w}  ${JSON.stringify(k)}`).join('\n')}`);
});

test('micro pt-BR: no empty entries (an empty string would blank a label)', () => {
  for (const [k, v] of Object.entries(PT)) assert.ok(typeof v === 'string' && v.length, `empty translation for ${JSON.stringify(k)}`);
});
