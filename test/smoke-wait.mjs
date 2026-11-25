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

// page.evaluate of an ASYNC page function that does heavy work, without awaiting its promise
// over the DevTools protocol.
//
// Playwright evaluates through CDP Runtime.callFunctionOn with awaitPromise, and V8's inspector
// tracks that promise with a WEAK handle. Once the promise settles nothing else holds it; its
// reaction (the inspector's own then-callback) is only a queued microtask. A garbage collection
// in that gap clears the handle and CDP answers "Promise was collected", even though the page
// function finished — and Playwright reports any such protocol error as "Execution context was
// destroyed, most likely because of a navigation". No navigation happened. The gap is
// dangerous when the promise settles in the middle of the app's own microtask cascade (the page
// function's last awaits resolve among the app's promises, which allocate): a GC lands there
// now and then, more often on some machines than others (micro-compare-smoke's refresh: never
// on Windows, 2–7 in 15 on the Linux labs, 2026-11-25). Forcing a GC into the gap reproduces it
// on any page, every time.
//
// Here the page function runs detached: a SYNC evaluate starts it and parks its outcome in a
// window slot, sync evaluates poll the slot, and a sync evaluate reads the result. A sync
// evaluate settles on its own protocol task with nothing else queued, so nothing allocates in
// its gap. `arg` must be JSON (it is spliced into the expression); the function, as with
// page.evaluate, sees no Node closure.
let _settledSeq = 0;
export async function evaluateSettled(page, fn, arg, { poll = 25, timeout = 600000 } = {}) {
  const key = `__evaluateSettled${++_settledSeq}`, K = JSON.stringify(key);
  // the function is compiled HERE, inside the protocol call (a CSP that forbids eval doesn't apply
  // to the inspector); only calling it is deferred, out of the protocol call
  await page.evaluate(`(() => {
    const fn = (${fn.toString()}), slot = window[${K}] = { done: false };
    Promise.resolve().then(() => fn(${arg === undefined ? '' : JSON.stringify(arg)})).then(
      (value) => { slot.value = value; slot.done = true; },
      (e) => { slot.error = (e && (e.stack || e.message)) || String(e); slot.done = true; });
  })()`);
  const t0 = Date.now(), limit = timeout * SCALE;
  while (!(await page.evaluate((k) => window[k].done, key))) {
    if (Date.now() - t0 > limit) throw new Error(`evaluateSettled: the page function did not finish in ${limit} ms`);
    await new Promise((r) => setTimeout(r, poll));
  }
  const s = await page.evaluate((k) => { const s = window[k]; delete window[k]; return s; }, key);
  if (s.error) throw new Error(`evaluateSettled: ${s.error}`);
  return s.value;
}
