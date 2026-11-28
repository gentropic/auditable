# lamina bugs and confusing behaviour found while writing the manual

Found against the PINNED build `0.1.0 · b31bbe3 · 2026-11-27` (work/lamina.html). Not fixed here — the
code track fixes them. Repro files: `work/make-fixtures.mjs` writes them to `work/fx/`; the probes in
`work/probes/` drive the page (`node work/probe.mjs <probe>`). The book describes what lamina does today
and, where it is a bug, how to get round it; when a fix lands, the sentence marked in the chapter changes.

## Bugs

1. **A `.dm` inside an archive opens as "binary file".** `model.dm.gz` and a zip holding `model.dm`
   both show the binary note. `openInner` (archive entries, decompressed resident bytes) checks Parquet
   and text but not Datamine (`open()` does check it). Repro: probe `formats` (model.dm.gz,
   model-dm.zip). Same gap for an `.xlsx` inside a zip (not probed). Book: ch:formats §archives says so.

2. **The binary note says "use the hex viewer for this one" — there is no hex viewer.** `showBinary`.
   Help → About also says "binary → hex". The raw view (code track) is the fix; until then the message
   promises something that doesn't exist. Book: ch:open §text (pending box).

3. **The interpretation popover's settings silently do nothing on `.dm` and Parquet.** Changing
   Delimiter (or any setting) on an open `model.dm` or `two-groups.parquet` changes nothing — `reopen()`
   needs `current.file`/`current.bytes`, which the dm/parquet mounts don't set. The settings shouldn't be
   offered there (or should be disabled with a word). Probe `dmforce`. Book: ch:open §interpretation.

4. **The column summary's p50 can be far from the median on skewed grades.** Σ stats → `Cu_pct` p50
   shows `0.134192 ≈`; the column's own Statistics (exact) gives p50 = 0.042 — three times smaller.
   `quantilesFromHist` interpolates linearly inside 40 equal bins over [min, max]; 89,234 of 120,000
   values sit in the first bin (0–0.2), so the "≈" median is the bin's interpolation, not the data's.
   The ≈ mark is honest but the size of the error isn't guessable. Options: interpolate in the log
   histogram for a positive skewed column (both are already computed), or more bins, or a t-digest
   (sluice has one). Probe `instruments`. Book: ch:stats §summary (a caution box).

5. **Filter errors suggest a nonsense column for a bare text value.** `lito = OXIDE` →
   "unknown column: OXIDE — did you mean ID?"; `ok-indic > 2` → "unknown column: ok — did you mean ID?".
   The expr validator's own fuzzy match (edit distance ≤ 2 from a short name) wins, and that suppresses
   lamina's better hint ("quote it as "OXIDE" if you meant text"). For OXIDE specifically, the value IS a
   value of LITO (the gutter knows it) — the best message is "OXIDE is a value of LITO — quote it:
   LITO = "OXIDE"". Probe `ui`. Book: ch:filter §errors.

6. **Help → About and the capability declaration list `seek-bzip`, which lamina no longer bundles.**
   bzip2 and xz are now @gcu/bz2 and @gcu/lzma (23fd3ea9); the built file contains `seek-bzip` only in the
   About text. `capability.template.json` third_party and the emitted `sbom.json` still name it — the SBOM
   is supposed to be the build-derived truth. Book: ch:sealed names the decoders as they are.

7. **Opening an archive with several entries leaves the previous file's chrome showing.** Open a
   Parquet, then a zip with two CSVs: while the entry picker is up, the badge still says `parquet`, the
   status line says `decompressing…`, and `lamina.rows()` still returns the Parquet's rows. Cosmetic,
   but the host API answering for a file that's no longer being shown is a real wrong answer. Probe
   `formats` (two.zip after two-groups.parquet).

10. **"Clip outliers (p5–p95)" takes its percentiles from the file's FIRST 8,192 rows, not a spread
    sample.** `computeClipBounds` scans `limit: GUTTER_SAMPLE` from the top, where the gutter uses the
    spread sample (`gutterSampleRows`). On a model written top-down that is the waste cap: the sample
    model opens with `Cu_pct` heat-mapped over 0–0.059 % while the column runs to 7.98 %, so every ore
    block is the same saturated top colour — the showcase heat map is two-tone. Use the spread sample
    (or the gutter's own sample values). Probe `clip`. Book: ch:grid §colour scales (a caution box).

## Confusing behaviour (works as coded; worth a look)

8. **An all-text table loses its header.** The header guess wants a numeric value in a later row, so a
   codes-and-descriptions table opens with `col 1…n` and its names as row 1 (`latin1.csv`). A first row
   whose values are all distinct from the rows below it, or a `.csv` name, could tip it. Book: ch:open
   §header says how to set Header: yes.

9. **The decimal comma is never detected.** A semicolon-delimited file of `45,2` numbers opens as all
   text with its header taken for data. Semicolon + every comma between digits is a strong signal (it's
   the Brazilian/European export default). Book: ch:open §decimal comma (a caution box + the try-it).
