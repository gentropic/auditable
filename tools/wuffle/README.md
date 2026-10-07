# wuffle

**A geological compass — a single-file GCU tool with two homes.**

> A wuffle throws its planes and lines straight onto a stereonet. The name puns
> on the *Wulff net*, but orientation data belongs on an **equal-area (Schmidt)**
> net — so that's the default.

wuffle is a structural-geology compass/clinometer. Two homes, one file:

- **In the field** (inside the [lead-acid](https://github.com/gentropic/lead-acid)
  Android shell): lay the phone on a plane (bedding, joint, foliation) → **dip
  direction / dip**; sight a lineation → **trend / plunge**, live off the device
  orientation. It was lead-acid's first *original* instrument — the artifact that
  exists *because* of the shell, dogfooding `keepAwake`, `fs/publish`, `share`.
- **On the desktop** (gentropic.org/wuffle, or the raw file): the same tool as a
  **stereonet + manual entry** — type `045/30` (plane) or `310→70` (line) to plot,
  read the net, download the log. No device orientation, but a real analysis surface.

Each measurement lands live on the Schmidt net and appends to a log you delete
from, clear, and publish (Downloads CSV in the shell; a file download on desktop).

## How it works

- **Orientation → geology:** `deviceorientationabsolute` feeds `@gcu/bearing`'s
  `compass.planeFromDeviceOrientation` / `lineFromDeviceOrientation`.
- **The Schmidt net is `@gcu/bearing`'s `Stereonet`** (`projection: 'equal-area'`).
- **Smoothness:** `sn.render()` re-projects the whole graticule per call — too heavy
  at 60 Hz. So the static net (graticule + measured data) redraws only on
  measure/clear, and the moving live-preview rides a separate overlay `<path>`
  updated per frame via `requestAnimationFrame` (computed with bearing's own
  projection so the ghost matches a real plot). 8 fps → 60 fps.
- **Net-centric layout:** a circle inscribed in a square leaves the corners empty,
  so the reading, caption, and measure-FAB live in the net's dead corners.
- **Shell-aware:** feature-detects the shell via `@gcu/leadacid`; `shell.present`
  false on desktop (native features simply absent), true in lead-acid.

## Build & test

```
node build.js --target=wuffle     # → wuffle.html (registry build: bearing + leadacid + app)
npm run test:wuffle               # committed smoke over the built file (boot, net, plot, entry, …)
```

`wuffle.html` is a gitignored build output. Deploy: a Pages site
(gentropic.org/wuffle) and/or copied into the lead-acid APK's assets. Dev source
imports `@gcu/bearing` + `@gcu/leadacid` via the import-map in `index.html`.

## Roadmap

- **Switchboard token migration** — the CSS is already GCU-dark; move it onto the
  `--au-*`/`--sw-*` cascade for full design-system alignment + CVD accents.
- ~~**sensor → v2**~~ ✓ 2026-10-06 — inside the shell, wuffle reads the FUSED rotation
  vector through `shell.orientation()` (lead-acid.js converts Android's quaternion to the
  W3C alpha/beta/gamma triple — unit-tested in `test/leadacid-orientation.test.mjs`), so
  the same `compass.*` math runs on it, and the compass **accuracy** the event hides is
  shown (`compass · fused · high`; low/unreliable → "figure-8 to calibrate"). Falls back
  to `deviceorientation` if the stream can't open; reopens after the shell pauses it.
- ~~**attest-signed logs**~~ ✓ 2026-10-06 — inside the shell, **publish** signs the exact
  bytes of `wuffle-log.csv` with the phone's hardware key (`attest`: StrongBox where the
  phone has it, else the TEE) and publishes `wuffle-log.csv.sig` beside it — a small JSON
  `{file, alg, sig, pub, hash, security, signedAt}` (ECDSA P-256 / SHA-256, raw r‖s, the
  public key as base64 SPKI). Anyone verifies it with WebCrypto alone:

  ```js
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', b64(sig.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64(sig.sig), csvBytes);   // → true
  ```

  The unit of provenance is the published file, not each reading (a reading signed
  alone proves nothing about the set). An instrument built without the attest plugin
  publishes unsigned and says so. Guarded end to end by the bench smoke (the bench's
  attest is a real WebCrypto key, so the verification there is real).
- ~~**reload a log**~~ ✓ 2026-10-07 — `intake`, share's inbound twin: a CSV shared or
  opened into wuffle (a published `wuffle-log.csv`, or anything with the same columns)
  reloads into the log — "Open with wuffle" from Files, or the share sheet. Verified on the
  S24+ both ways: a share that LAUNCHES wuffle, and one that reaches it while running.
- ~~**WMM declination**~~ ✓ 2026-10-07 — **true north, offline.** The gnss fix feeds
  `@gcu/wmm` (WMM2025, pinned to NOAA's twelve published test values) and the declination
  goes straight into bearing's `compass.*` as `options.declination`; the label reads
  `true N · decl −21.9°` and each live reading records `north=true` + `declination_deg`
  (manual entries are `as-typed` — they're whatever north the user used). Until a fix
  arrives the readings stay magnetic and say so. Verified on the S24+ at a real fix.
- ~~**Georeferencing**~~ ✓ 2026-10-07 (wuffle v3) — inside the shell, a `gnss` fix stream
  stamps every measurement with lat/lon + accuracy (`lat,lon,acc_m` columns in the published
  CSV, round-tripped by intake; a `±N m` badge beside the title). The first open asks for the
  location permission; a refusal just means unstamped measurements. Verified on the S24+
  with a real fix.
- ~~**an outcrop photo per station**~~ ✓ 2026-10-07 — the **photo** button opens a viewfinder
  (plain `getUserMedia`, environment camera, a 2560×1920 ideal frame — a webcam on the desktop)
  and **capture** attaches a JPEG to the last measurement (a 📷 on its row, a `photo` column in
  the CSV); publish sends each photo to Pictures beside the log (desktop: downloads them). The
  capture waits for painted frames — the first frames off a real sensor are black. In the shell
  the `camera` plugin asks for the permission first so the dialog isn't nested in the viewfinder.
  Verified on the S24+ (1920×2560, 168 KB, landed in Pictures).
- **Fabric analysis** — bearing has density contouring + mean-vector/eigen stats +
  rose diagrams; surface them for a session.

## Credits

Geology + stereonet engine: **[@gcu/bearing](https://github.com/endarthur/bearing.js)**
(`ext/bearing`). Shell shim: `@gcu/leadacid` (`ext/leadacid`, vendored from
gentropic/lead-acid). GCU — CC0.
