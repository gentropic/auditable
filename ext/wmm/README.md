# @gcu/wmm

**The World Magnetic Model, evaluated — the one number a compass needs to turn
magnetic north into true north, offline.**

```js
import { declination, field } from '@gcu/wmm';

declination(-23.5, -46.6);                 // → −21.9  (degrees, east positive; now)
declination(80, 0, 2025.0);                // → 1.28   (NOAA's first published test point)

const f = field(-23.5, -46.6, { height: 0.76, date: new Date() });
// { x, y, z, h, f (nT), incl, decl, gv (deg), xdot … ddot (per year), year, valid }
```

`true = magnetic + declination` — the convention `@gcu/bearing`'s `compass.*` already
takes as `options.declination`, so a wuffle reading goes from magnetic to true north with
one option.

## What it is

WMM2025 (NOAA/NCEI + the British Geological Survey; epoch 2025.0, valid 2025.0–2030.0) is
a degree-12 spherical-harmonic model of the Earth's main field. This package is the
evaluation written out from the technical report: geodetic → geocentric spherical,
Schmidt semi-normalized associated Legendre functions and their θ-derivatives by
recursion, the three sums, the rotation back to the geodetic frame, and the secular
variation from the rate coefficients. Grid variation is reported poleward of ±55°.

- `src/coefficients.js` is **generated** from NOAA's `WMM2025.COF` — never hand-typed.
  Regenerate from the COF when the model changes (every five years).
- `test/wmm.test.mjs` pins the implementation to **NOAA's twelve published test values**
  (`test-values.json`, also generated): X/Y/Z/H/F to 0.06 nT, angles to 0.006°, rates
  likewise. The model is proven against its own oracle, not assumed.
- Zero dependencies; 10 KB bundled; `valid: false` outside the window, still evaluated.

## API

- `field(lat, lon, { height = 0, date = new Date() })` — `height` in km above the WGS84
  ellipsoid; `date` a `Date` or a decimal year.
- `declination(lat, lon, date?, height?)` — degrees, east positive.
- `decimalYear(date)` — the convention used throughout (`2027-07-02` ≈ `2027.5`).
- `EPOCH`, `MODEL`, `VALID_FROM`, `VALID_TO`, `COEFFICIENTS`, `DEGREE`.

The WMM is a model of the **main** field: it knows nothing about local crustal anomalies
(an iron-rich outcrop) or the phone's own magnetic environment — those are what a
compass's calibration state and a geologist's judgement are for.

MIT. Coefficients: public domain (NOAA/NCEI).
