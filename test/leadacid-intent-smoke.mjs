// lead-acid `intent` through the vendored shim + bench (SPEC §5.1 intent, §4.7 bench):
// list from the fixture, a send recorded with its typed fields, the shell's four
// verdicts (400 field, 404 name, 503 capability, 200 launched) — on a desktop,
// no phone. The device acceptance lives in the plugin spec §7.
//   node test/leadacid-intent-smoke.mjs
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = `<!doctype html><meta charset="utf-8"><title>intent bench</title>
<script>window.__benchFixtures = { intent: { 'sendto.sms': false, dial: false } };</script>
<script src="/ext/leadacid/bench.js?bench"></script>
<script type="module">
import { shell } from '/ext/leadacid/index.js';
window.shell = shell; window.__ready = true;
</script>`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/bench.html' || p === '/bench.html?bench') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
  try { const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let fails = 0;
const chk = (name, cond, extra) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bench.html?bench`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready && window.shell && window.shell.present);

const r = await page.evaluate(async () => {
  const s = window.shell;
  const out = { present: s.present };
  out.list = await s.intent.list();
  out.timer = await s.intent.send('clock.timer', { seconds: 1800, message: 'core shed' });
  out.calendar = await s.intent.send('calendar.insert', { title: 'Send samples to the lab', begin: '2026-10-09T09:00', end: '2026-10-09T10:00', location: ' core shed ' });
  const err = async (name, fields) => { try { await s.intent.send(name, fields); return null; } catch (e) { return { status: e.status, error: e.error, field: e.field, capability: e.capability }; } };
  out.badRange = await err('clock.timer', { seconds: 100000 });
  out.badUnknown = await err('clock.alarm', { hour: 6, minutes: 15, snooze: true });
  out.badMissing = await err('calendar.insert', { begin: '2026-10-09T09:00' });
  out.badDial = await err('dial', { number: '*#06#' });
  out.offList = await err('browser.open', { url: 'https://x' });
  out.noHandler = await err('sendto', { kind: 'sms', to: '+55 11 99999', body: 'hi' });
  out.mailOk = await s.intent.send('sendto', { kind: 'mail', to: 'lab@example.com', subject: 'samples', body: 'on their way' });
  out.ledger = window.__bench.intents.map((i) => [i.name, i.fields]);
  return out;
});
await browser.close(); server.close();

chk(`the shim is present on the bench and lists the allowlist with the fixture's answers (${JSON.stringify(r.list)})`,
  r.present === true && r.list['calendar.insert'] === true && r.list['clock.timer'] === true && r.list['sendto.sms'] === false && r.list['sendto.mail'] === true && r.list.dial === false && Object.keys(r.list).length === 8);
chk(`a timer and a calendar event launch and land in the ledger with their typed, trimmed fields (${JSON.stringify(r.ledger.slice(0, 2))})`,
  r.timer.launched === true && r.calendar.launched === true && r.ledger[0][0] === 'clock.timer' && r.ledger[0][1].seconds === 1800 && r.ledger[1][0] === 'calendar.insert' && r.ledger[1][1].location === 'core shed');
chk(`400 names the field: range (${JSON.stringify(r.badRange)}), unknown (${JSON.stringify(r.badUnknown)}), missing (${JSON.stringify(r.badMissing)}), a USSD code (${JSON.stringify(r.badDial)})`,
  r.badRange.status === 400 && r.badRange.field === 'seconds' && r.badUnknown.status === 400 && r.badUnknown.field === 'snooze' && r.badMissing.status === 400 && r.badMissing.field === 'title' && r.badDial.status === 400 && r.badDial.field === 'number');
chk(`404 off the allowlist (${r.offList.status}); 503 names the capability when no app handles it (${JSON.stringify(r.noHandler)}); the mail twin still goes (${JSON.stringify(r.mailOk)})`,
  r.offList.status === 404 && r.noHandler.status === 503 && r.noHandler.capability === 'intent.sendto' && r.mailOk.launched === true && r.ledger.length === 3);

console.log(fails ? `\nLEAD-ACID INTENT SMOKE: ${fails} FAILURES` : '\nLEAD-ACID INTENT SMOKE: PASS');
process.exit(fails ? 1 : 0);
