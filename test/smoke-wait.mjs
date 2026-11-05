// Shared wait policy for the Playwright smokes.
//
// waitForFunction polls on animation frames by default, and a page busy on CI's
// 2-core software-GL runner renders few of them: a condition that held could go
// unseen until the wait gave up (the demo project "stalled" at 6 layers while
// waiting for more than 5). Every waitForFunction polls on an interval instead,
// unless the call sets its own `polling`.
//
// That runner is also several times slower than a desktop, so on CI (GitHub sets
// CI=true) every wait's limit is scaled — SMOKE_TIMEOUT_SCALE overrides the factor.
// A wait that would time out locally still times out locally.
//
// Call once per process, right after launching the browser; it patches the shared
// Frame prototype, so every page the smoke opens afterwards gets the same policy.
// Only the Frame: page.waitForFunction delegates to its main frame's, so patching
// both would apply the scale twice.

const SCALE = +(process.env.SMOKE_TIMEOUT_SCALE || (process.env.CI ? 3 : 1));
const POLL_MS = 250;
const DEFAULT_TIMEOUT = 30000;                             // Playwright's own default

export async function installSmokeWaits(browser) {
  const page = await browser.newPage();                    // only to reach the prototype
  const proto = Object.getPrototypeOf(page.mainFrame());
  await page.close();
  if (proto.__smokeWaits) return;
  const orig = proto.waitForFunction;
  proto.waitForFunction = function (fn, arg, opts = {}) {
    const timeout = opts.timeout === 0 ? 0 : (opts.timeout ?? DEFAULT_TIMEOUT) * SCALE;
    return orig.call(this, fn, arg, { polling: POLL_MS, ...opts, timeout });
  };
  proto.__smokeWaits = true;
}

export const smokeTimeoutScale = SCALE;
