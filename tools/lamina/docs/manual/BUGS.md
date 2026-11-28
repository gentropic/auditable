# lamina bugs and confusing behaviour found while writing the manual

Found against the PINNED build `0.1.0 · b31bbe3 · 2026-11-27` (work/lamina.html). Not fixed here — the
code track fixes them. Repro files: `work/make-fixtures.mjs` writes them to `work/fx/`; the probes in
`work/probes/` drive the page (`node work/probe.mjs <probe>`). The book describes what lamina does today
and, where it is a bug, how to get round it; when a fix lands, the sentence marked in the chapter changes.

## Status at the second pinned build `0.1.0 · b87b3aa`

FIXED (the code track; the book's caution boxes are gone and the chapters describe the fixed behaviour):
#1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16. Everything below that line is history.

New, found writing the views / raw / lens chapters on b87b3aa:

17. **Group by's first Value is the ID column.** `openGroupBy` seeds `values: [firstNum]` — on a block
    model that is `ID` (sum 2.4296e+9, mean 74934…), which is never what anyone groups. Grade–tonnage
    already skips id/x/y/z/dx/dy/dz for its default grade; group by should use the same rule. Seen in the
    `pin` scene (it now sets the value explicitly).

18. **A pinned result's caption reads "Group by of sample_blockmodel.csv".** `${pr.name} of ${src.label}`
    — fine for "Statistics of …", "Grade–tonnage of …", awkward for "Group by of …". Cosmetic; the book
    quotes it as it is.

## Bugs (as found on b31bbe3)

1. **A `.dm` inside an archive opens as "binary file".** `model.dm.gz` and a zip holding `model.dm`
   both show the binary note. `openInner` (archive entries, decompressed resident bytes) checks Parquet
   and text but not Datamine (`open()` does check it). Repro: probe `formats` (model.dm.gz,
   model-dm.zip). Same gap for an `.xlsx` inside a zip (not probed). Book: ch:formats §archives says so.

2. *(FIXED by the code track — the note now reads "not a table — View → Raw (hex) shows its bytes";
   the book follows the new text. Still stale: Help → About's "binary → hex" wording is right now.)*
   **The binary note says "use the hex viewer for this one" — there is no hex viewer.** `showBinary`.
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

11. **A calculated column's type is guessed from the FILE's first six rows.** `inferCalcType` (and the
    editor's preview) evaluates the expression on rows 0–5 of the base view — the file's order, not the
    view's — and calls it a number only if those six give numbers. `if(Cu_pct >= 1, Cu_pct, blank)` on
    the sample is blank on its first six rows (the waste cap), so the column is typed TEXT: no histogram,
    Statistics shows top values (`1.034 ×16 …`), it can't be a grade–tonnage grade. Filters still work
    (number-looking text compares as a number). Should use the expression's static type where known
    (an `if` whose branches are numeric/blank → number) or sample the spread rows. Probe `calc`.
    Book: ch:calc (a caution box: Treat as number).

12. **An unknown function gives an unhelpful error.** `foo(1)` → "expr parse error: trailing input near
    '('" (expr bundle). "unknown function foo — did you mean floor?" would match how unknown columns are
    reported.

13. **A calculated column's name may contain `-`**, which the expression language then reads as minus
    (`cu-hi` must be written `` `cu-hi` ``). The editor's rule is `[A-Za-z_][A-Za-z0-9_-]*`; dropping `-`
    avoids handing users the OK-Indic trap.

14. **Data quality's "thousands separators" check can never fire.** `scanDataQuality` tests
    `/^-?\d{1,3}(,\d{3})+…$/` only in the branch where `parseNum(t)` succeeded — but with decimal '.',
    `parseNum('1,234')` is `Number('1,234')` = NaN, so such values go to the non-numeric branch and are
    reported as "non-numeric values (e.g. 1,234)". Move the test into the NaN branch. Book: ch:dq table.

15. **Clicking a group (group by) replaces the current filter.** Group a FILTERED view, click a group →
    the grid shows the whole group, the original filter gone. Better: AND the group condition onto the
    current filter. Book: ch:groupby (a caution box).

16. **A single-precision `.dm` exports its numbers with float32 noise.** SP stores 4-byte floats; lamina
    widens them to doubles and stringifies the double: a stored 0.1 exports as `0.10000000149011612`,
    2.524 as `2.5239999294281006` (export, `lamina.rows()`, and the cell text). The ".dm → CSV converter"
    then writes 17-digit noise into every grade. Format SP values as the SHORTEST decimal that round-trips
    the float32 (e.g. try `toPrecision(6..9)` until `Math.fround(parsed) === x`). EP (8-byte) is fine.
    Probe `dmsp`. Book: ch:formats §dm + ch:export (caution boxes).

## Confusing behaviour (works as coded; worth a look)

8. **An all-text table loses its header.** The header guess wants a numeric value in a later row, so a
   codes-and-descriptions table opens with `col 1…n` and its names as row 1 (`latin1.csv`). A first row
   whose values are all distinct from the rows below it, or a `.csv` name, could tip it. Book: ch:open
   §header says how to set Header: yes.

9. **The decimal comma is never detected.** A semicolon-delimited file of `45,2` numbers opens as all
   text with its header taken for data. Semicolon + every comma between digits is a strong signal (it's
   the Brazilian/European export default). Book: ch:open §decimal comma (a caution box + the try-it).
