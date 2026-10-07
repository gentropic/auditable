# gnsslog

**A raw GNSS logger — the instrument that drives lead-acid's `gnss` plugin and its
foreground-service capture.**

Raw GNSS observations (pseudorange, carrier phase, per-satellite C/N0 and state, clock
bias/drift) are what post-processing, PPK and quality assessment need, and the web platform
can't give them. gnsslog is a single-file GCU tool that runs inside the
[lead-acid](https://github.com/gentropic/lead-acid) Android shell and does one thing well:

- a **sky plot** (north up, zenith centre) and **C/N0 bars** from the live satellite status —
  coloured by constellation, filled when used in the fix;
- **start** a capture (raw measurements · fixes · satellite status · NMEA, your pick) under a
  name; the shell's foreground service writes one JSON line per event to `<name>.jsonl` and
  keeps going with the screen off, the notification stating the real state
  ("GNSS logging — 4,312 epochs · ±0.6 m");
- **stop** seals the file; **publish** puts it in Downloads, **share** hands it to another app;
- come back later (a reload, a return from the launcher) and the page **re-attaches** to the
  running capture.

On the desktop the same file boots and says it needs the shell — raw GNSS is a native
capability. `?bench` runs it against the mocked plugin for development (`node
test/gnsslog-smoke.mjs` drives the whole cycle that way, plus the built file's desktop boot).

Build: `node build.js --target=gnsslog` → `gnsslog.html` (gitignored). lead-acid packages it
(`gnsslog/` there syncs the built file at build time) — `gradlew :gnsslog:assembleDebug`.

## The log format

One JSON object per line (`application/x-ndjson`), `kind` first:

| kind | fields |
|---|---|
| `start` | `name`, `what[]`, `t` (ms), `device` |
| `raw` | `t`, `clock{timeNanos, fullBiasNanos, biasNanos, driftNanosPerSecond, discontinuity}`, `measurements[{svid, c (constellation), state, tOff, rxSv, rxUnc, cn0, prr, prrUnc, adrState, adr, adrUnc, freq?}]` |
| `fix` | `t`, `lat`, `lon`, `alt`, `acc`, `provider` |
| `status` | `t`, `sats`, `used` |
| `nmea` | `t`, `s` (the sentence) |
| `stop` | `t`, `epochs`, `fixes`, `nmea` |

The fields are Android's `GnssMeasurement` / `GnssClock` values, emitted faithfully; the
PPK/PPP math is the consumer's job (a notebook, a geodesy library), not the logger's.
