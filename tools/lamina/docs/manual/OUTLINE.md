# The lamina manual — outline

Target 120–150 pages, reference-grade, organised by how someone meets a file: open it, see what it is,
read it, ask it questions, measure it, keep and share what they did. Labels: `ch:…`, `sec:…`, `app:…`.
Status per chapter: **written** (probed against the pinned build), **stub** (waits on the code track:
`spec_inbox/lamina-workspace-spec.md`), **rewrite** (written against today's lamina, will change).

## Front matter
Cover (placeholder — the figure is Arthur's call) · Contents · About this book (how to read, conventions,
the pending-chapters note).

## Part I — Meeting lamina
1. **lamina** (`ch:lamina`) — written. What it is for; what it reads; read-only; the view vs the file;
   never-resident in one paragraph; Sealed in one paragraph; what it is not.
2. **Getting started** (`ch:start`) — written. The empty screen; the sample model; the window (menus,
   filter box, ƒ+ col, Σ stats, row box, file name, kind badge, status line, footer, build stamp); menus at
   a glance; right-click is where the actions are; recents; theme; a first ten minutes.
3. **Installing and running** (`ch:install`) — written. The web address, installing as an app, the
   Microsoft Store, the single file and `file://`, New window, the lead-acid Android shell, embedding (a
   pointer to app. A); what lamina keeps on the machine (index cache, recents) and how to clear it.

## Part II — Opening files
4. **Opening a file** (`ch:open`) — written. Open, drop, recents, the OS "open with"; the order lamina
   tries things in (lens, workbook, archive, Parquet, .dm, cached index, detection); delimited text:
   delimiters, the header guess, quoting, GeoEAS/GSLIB, whitespace dumps, comment preambles, decimal comma,
   encodings and the ⚠ hint; plain text as lines; binary; the interpretation popover; honest failures.
5. **Formats in detail** (`ch:formats`) — written. Excel workbooks; Datamine `.dm`; Apache Parquet
   (types from the footer, INT64 beyond 2^53, codecs refused, nested columns, row groups); archives (zip,
   tar, gz, zst, bz2, xz; the picker; what streams and what must fit in memory).
6. **The raw view** (`ch:raw`) — STUB. Lines and hex, the jumps between a row and its bytes, search,
   compressed and resident sources, the live raw pane in the interpretation dialog.
7. **How a huge file scrolls** (`ch:huge`) — written. The block index; the scan (worker or inline); the
   index cache; windowed reads; the record cursor; result views; stream sources and the tape; strided
   `.dm` reads; Parquet row-group pruning; the resident limit; what each operation costs.

## Part III — Reading the table
8. **The grid** (`ch:grid`) — written. Scrolling, rows, sort (stacked keys), go to row, selection and
   copy, widths and autofit, number formats, text/number, colour scales, hiding, the columns panel,
   pinning, the record inspector, find, the selection statistics, scroll lock.
9. **Column distributions** (`ch:gutter`) — written. The glyphs (histogram, top values, null bar, ≈, log),
   the filtered overlay, hover / click / drag / double-click, brush modes.
10. **Views and panels** (`ch:views`) — STUB. Documents and views; tabs and splits; several files;
    workbook sheets and archive members as tabs; a second view of the same file; the focused panel;
    narrow screens and the shell.

## Part IV — Asking questions
11. **The filter** (`ch:filter`) — written. The box; Enter / Esc; highlighting and autocomplete; errors;
    the filter-widget drawer; filters from the grid (cell menu, glyphs, statistics values); what a filter
    scans (projection on .dm and Parquet, pruning); filter and sort together; cancelling.
12. **The expression language** (`ch:expr`) — written. A full reference: names and quoting, literals,
    operators and precedence, the C-style spellings, ranges, sets, text matching, the blank model and its
    truth table, casts, functions by group, comments and line breaks, totality, decimal comma, errors.
13. **Calculated columns** (`ch:calc`) — written. Adding, the preview, types, editing and removing, the
    manager, what they cost, what carries them (export, lens, instruments).

## Part V — Instruments
14. **Statistics** (`ch:stats`) — written. One column (count, nulls, non-numeric, moments, CV, skew,
    zeros, quantiles, histogram, log x, excluding zeros/negatives, building a set filter); every column
    (Σ stats: the two-pass column summary, its approximations, precompute only); the selection line.
15. **Group by** (`ch:groupby`) — written. Groups, values, the weight, weighted mean, numeric bands,
    filtering to a group, limits.
16. **Grade–tonnage** (`ch:gt`) — written. Volume · density · proportion as expressions, density units,
    grade units and metal, the report, the cutoff curves and table, custom cutoffs, plot ranges, the
    maths, what is left out, saving the chart.
17. **Grid summary** (`ch:gridsum`) — written. Centroids and sizes, origin/size/count, ordering,
    sub-blocks, parent cells, fill, "no regular grid".
18. **Data quality** (`ch:dq`) — written. Every check, its rule, its severity, the sample, the fix.

## Part VI — Keeping and sharing
19. **Lenses** (`ch:lens`) — REWRITE when lens v2 lands. v1: what is kept and what isn't, by-name matching,
    skipped-and-reported, applying, opening a `.lamina`. v2 (stub): sources, views, layout, the slot
    dialog, recents restoring views, the session.
20. **Export** (`ch:export`) — written. The dialog, delimiters, header, rows, columns, streaming, `.dm`
    and Parquet to CSV, exports through the shell.
21. **Sealed** (`ch:sealed`) — written. What `connect-src 'none'` blocks; no eval, no WebAssembly; what
    lamina stores locally; the hosted app and its service worker; verifying a copy (SHA-256, the
    capability declaration, the CSP, the SBOM); embedding and what it does to the claim.

## Appendices
A. **window.lamina** (`app:host`) — written. Every call, its arguments and results, events; v1 is one
   table (multi-view: when views land).
B. **Keys and mouse** (`app:keys`) — written.
C. **Expression functions** (`app:functions`) — written. Every function, alphabetical, one line each.
D. **Limits** (`app:limits`) — written. Every number lamina caps at, and what happens there.

## How it was made (and how to keep it true)
Chapters written against a PINNED build (`work/lamina.html`, gitignored), every claim run on it with the
probes in `work/probes/` (gitignored, like wuffle's `experiments/` probe). Bugs and confusing behaviour
found while writing are in `BUGS.md` for the code track; the book describes what lamina does, and where
that is a bug it says what you see and how to get round it, until the fix lands.
