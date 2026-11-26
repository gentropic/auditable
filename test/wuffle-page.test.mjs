// a project inside a page: the block round-trips, replaces an old one, sits before the runtime, and is read
// without running anything; a page that isn't a built wuffle page is refused clearly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectBlock, projectFromPage, pageWithProject, blockText, isPage, hashText } from '../tools/wuffle/src/page.js';

const PAGE = '<!doctype html>\n<html><head><title>wuffle</title></head><body><main></main>\n'
  + '<script type="text/plain" id="wuffle-rt">\nAAAA\n</script>\n<script id="wuffle-boot">/* loader */</script>\n</body></html>';
const zip = new Uint8Array(5000).map((_, i) => (i * 7) % 251);

describe('page.js — a project inside a page', () => {
  it('the block round-trips the zip bytes (gzipped inside)', async () => {
    const block = await projectBlock(zip, 'Serra <study>');
    assert.match(block, /id="wuffle-project"/); assert.match(block, /data-name="Serra &lt;study&gt;"/);
    const html = pageWithProject(PAGE, block, 'Serra <study>');
    assert.deepEqual([...await projectFromPage(html)], [...zip]);
    assert.ok(html.indexOf('wuffle-project') < html.indexOf('wuffle-rt'), 'before the runtime');
    assert.match(html, /<title>Serra &lt;study&gt; — wuffle<\/title>/);
  });
  it('saving again replaces the old block (one project per page)', async () => {
    const once = pageWithProject(PAGE, await projectBlock(zip, 'a'), 'a');
    const twice = pageWithProject(once, await projectBlock(new Uint8Array([1, 2, 3]), 'b'), 'b');
    assert.equal(twice.match(/id="wuffle-project"/g).length, 1);
    assert.deepEqual([...await projectFromPage(twice)], [1, 2, 3]);
    assert.notEqual(blockText(once), blockText(twice)); assert.notEqual(hashText(blockText(once)), hashText(blockText(twice)));
  });
  it('the deployed site\'s PWA tags stay behind: a saved page is a standalone file', async () => {
    const site = PAGE.replace('</head>', '<!--wuffle-pwa--><link rel="manifest" href="manifest.webmanifest">\n<script>navigator.serviceWorker.register("sw.js")</script><!--/wuffle-pwa-->\n</head>');
    const saved = pageWithProject(site, await projectBlock(zip, 'a'), 'a');
    assert.doesNotMatch(saved, /manifest|serviceWorker|wuffle-pwa/);
    assert.deepEqual([...await projectFromPage(saved)], [...zip]);
  });
  it('a page without a project, or not a built wuffle page', async () => {
    assert.equal(await projectFromPage(PAGE), null);
    assert.throws(() => pageWithProject('<html><body></body></html>', '<script id="wuffle-project"></script>'), /not a built wuffle page/);
    assert.ok(isPage('  <!DOCTYPE html><html>')); assert.ok(!isPage('dd,dip\n1,2'));
  });
});
