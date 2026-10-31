// micro: text from a file never becomes markup. Every HTML sink goes through
// tools/micro/src/html.js (html`…` escapes interpolations; setHTML refuses a
// plain string), and this guard fails on any sink anywhere else in micro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { html, trusted, joinH, setHTML, appendHTML, esc } from '../tools/micro/src/html.js';

const ROOT = new URL('../tools/micro/', import.meta.url);
const SINK = /\.innerHTML\b|\.outerHTML\s*=|insertAdjacentHTML|document\.write|createContextualFragment/;

test('no HTML sink outside src/html.js', () => {
  const files = ['index.html', ...readdirSync(new URL('src/', ROOT)).filter((f) => f.endsWith('.js') && f !== 'html.js').map((f) => 'src/' + f)];
  const hits = [];
  for (const f of files) {
    readFileSync(new URL(f, ROOT), 'utf8').split('\n').forEach((ln, i) => { if (SINK.test(ln)) hits.push(`${f}:${i + 1}: ${ln.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], 'use setHTML(el, html`…`) from src/html.js');
});

test('html`…` escapes text, keeps nested html, drops null/false', () => {
  const evil = '<img src=x onerror="location=1">';
  assert.equal(String(html`<b>${evil}</b>`), '<b>&lt;img src=x onerror=&quot;location=1&quot;&gt;</b>');
  assert.equal(String(html`<i title="${"a'b"}">${html`<u>x</u>`}</i>`), '<i title="a&#39;b"><u>x</u></i>');
  assert.equal(String(html`${[html`<p>1</p>`, '<2>']}${null}${undefined}${false}${0}`), '<p>1</p>&lt;2&gt;0');
  assert.equal(String(joinH([html`<a>`, '&'], html`<hr>`)), '<a><hr>&amp;');
  assert.equal(esc('"&'), '&quot;&amp;');
});

test('setHTML / appendHTML refuse a plain string', () => {
  const el = { innerHTML: '', insertAdjacentHTML(_, s) { this.innerHTML += s; } };
  assert.throws(() => setHTML(el, '<b>x</b>'), /not html/);
  assert.throws(() => appendHTML(el, '<b>x</b>'), /not html/);
  setHTML(el, trusted('<b>x</b>')); appendHTML(el, html`${'<y>'}`);
  assert.equal(el.innerHTML, '<b>x</b>&lt;y&gt;');
});
