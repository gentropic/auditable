# wuffle

**A stereonet workbench and a geological compass — one single-file GCU tool, two homes.**

> A wuffle throws its planes and lines straight onto a stereonet. The name puns
> on the *Wulff net*, but orientation data belongs on an **equal-area (Schmidt)**
> net — so that's the default.

wuffle is a structural-geology compass/clinometer. Two homes, one file:

- **In the field** (inside the [lead-acid](https://github.com/gentropic/lead-acid)
  Android shell): lay the phone on a plane (bedding, joint, foliation) → **dip
  direction / dip**; sight a lineation → **trend / plunge**, live off the device
  orientation. It was lead-acid's first *original* instrument — the artifact that
  exists *because* of the shell, dogfooding `keepAwake`, `fs/publish`, `share`.
- **On the desktop**: the **desk**, a stereonet workbench (below). `?field` opens the
  compass on a desktop too, with manual entry — type `045/30` (plane) or `310→70` (line).

In the field each measurement lands live on the Schmidt net and appends to a log you
delete from, clear, and publish (Downloads CSV in the shell; a file download on desktop).
The desk opens that log as it is (planes and lines become two datasets).

## The desk

One window, laid out by `@gcu/rails`: the **layers** tree on the left, one tab per
**diagram** in the middle (nets, roses, fabric plots, figures), and **table · statistics ·
console** below. Everything runs offline in the one file.

- **Data once, layers per diagram.** A dataset lives once in the project; a diagram shows
  it through *layers*, and every layer of a dataset is a view of the same rows (styling per
  layer, data shared). Drag a layer onto another diagram to add a view (⇧ moves it); a ⧉
  badge marks data drawn in more than one place; *remove from everywhere* asks first.
- **OpenStereo's nested checkboxes**: a layer opens into what it draws — poles, great
  circles, contours (Kamb or Fisher), mean + cone, eigenvectors V1–V3 (pole and great
  circle each), labels; faults: slip with sense arrows, P/T axes, right dihedra. The
  properties dialog (double-click) sets how they draw.
- **Selections in attitude space**: pick, lasso, cone and band on the net, built on the
  sphere so they keep meaning the same measurements when the net rotates. The selection
  belongs to the data: it shows on every diagram and in the table; *selection → new dataset*.
- **Statistics**: axial Fisher mean with κ and α95, eigen analysis (S1–S3, Woodcock K/C,
  Vollmer P/G/R), Michael's (1984) stress inversion for faults. Results become datasets with
  lineage: the mean, the eigenvectors, a β diagram, the intersection of two layers.
- **Rose diagrams** (strike, dip direction or trend) and **fabric plots** (Vollmer, Woodcock).
- **Drag a net to rotate it** (arcball); the console's `rotate 045→30` centres it.
- **Console** (`` ` ``): `sample tocher`, `contour kamb 3`, `select cone 150/60 20`, `stats`,
  `mean`, `beta`, `intersect a b`, `rotate`, `history` — a routine is just lines.
- **Figures**: Figure → *New figure from the active net* opens a @gcu/compo page (the net
  as vectors, a legend, the statistics, a caption saying what is drawn); export PDF or PNG;
  *↻ from the net* redraws it after changes. Figures are kept in the `.wuffle` project.
- **Files**: any delimited text (dip direction/dip, right-hand-rule strike/dip, trend/plunge,
  faults, small circles, single attitude columns like `N30E 40SE`) — never refused: what
  couldn't be read is counted, and a guessed column mapping says so. Save/open `.wuffle`.

Text everywhere: planes as dip direction/dip (`045/72`), lines as trend→plunge (`045→32`).
Sample data: Tocher, F. E. (1979), *The computer contouring of fabric diagrams*, Computers &
Geosciences 5, 73–126 (`samples/tocher.csv`).

The nets, selections, statistics drawing and the figure frame come from **`@gcu/stereonet`**
(`ext/stereonet`, shared with the notebook's stereonet cell); the maths from **`@gcu/bearing`**.

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

## Code

`src/field.js` is the compass. The desk is one module per job: `model.js` (the project),
`io.js` (readers), `layers.js` (model → @gcu/stereonet), `stats.js`, `commands.js`, `figure.js`
(all pure, Node-tested) and the panels `desk-*.js` (`desk.js` only wires them). New features
land as new modules.

## Build & test

```
node build.js --target=wuffle     # → wuffle.html (registry build: bearing, leadacid, wmm, rails,
                                  #   menu, dialog, loom, stereonet, compo + the src/ modules)
npm run test:wuffle               # the compass, over the built file (?field)
npm run test:wuffle:bench         # the compass in the mocked lead-acid shell
npm run test:wuffle:desk          # the desk, dev tree AND built file (36 checks: real drags, console, figures…)
node --test test/wuffle-*.test.mjs test/stereonet-*.test.mjs   # the pure modules (in npm test)
node tools/wuffle/dev/gen-samples.mjs                          # after changing samples/*.csv
```

`wuffle.html` is a gitignored build output. Deploy: a Pages site
(gentropic.org/wuffle) and/or copied into the lead-acid APK's assets. The build imports
only the page's entry at boot (importing every module would run the compass on the desk).
Dev source imports the ext packages by relative path; the build maps them to the bundle.

## Roadmap

- ~~**Switchboard token migration**~~ ✓ 2026-10-07 — the 3-layer cascade: `--sw-*` basalt
  swatches + the six CVD-tuned accents on `:root` (a dark-only field tool), `--au-*` roles the
  components read (orange=action, blue=info, green=go, yellow=caution, red=fault,
  violet=selected — the active mode is *selected*, so it went violet), fonts as
  `--au-mono`/`--au-sans`. The stereonet's data colours come from the tokens at runtime (SVG
  attributes can't resolve `var()`). gnsslog migrated alongside; constellations take the hue
  swatches directly — they're categories, not roles.
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
