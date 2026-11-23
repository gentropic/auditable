# The micro manual — outline

Files: `chapters/<nn>-<slug>.tex`, labels `ch:<slug>`. Figure requests: `figures/wanted/<group>.txt`.

## Front matter (editor)
- Title · Contents · How to read this book (preface, written last)

## Part I — First steps  (group A)
- 01-micro — What micro is, and how it thinks: elements and their locations (cells, nodes, intervals, vertices), columns as the atom, never-resident streaming, provenance, Sealed (no network); what it is not. A TikZ diagram of the model.
- 02-start — Getting started: opening micro (web, installed PWA, offline, phone), the screen (a labelled full-window screenshot: toolbar, layers panel, view, status line, properties), opening data (drag, File → Open, the open dialog), the layers panel, getting around (orbit / pan / zoom, views, fit, ⌘K the command palette), undo and the safety nets.
- 03-tour — A guided tour (the long tutorial): the demo project → look around → ask a question (the filter) → the drillholes → derive a column (ƒ) → grade–tonnage → a section → a figure in the composer → save the project → a first routine. Many tryit boxes and screenshots.

## Part II — Data  (group B)
- 04-opening — Opening data: formats at a glance, the open dialog (roles, Open as ▾, mappings), Reinterpret as, Reload from disk, decimal commas, delimiters, what "never resident" means for big files.
- 05-blocks — Block models: regular, sub-blocked (true boxes), rotated (detected, confirmed, declared), Datamine .dm, Parquet (and Optimize to spatial Parquet), which format to keep a model in, grade shells.
- 06-drillholes — Drillholes: collar / survey / intervals, the open dialog trio, desurveying, the set in the layers panel, several interval tables, the hole filter, broadcast, display (sticks, radius, traces, collars), composites.
- 07-meshes — Meshes, wireframes & CAD: PLY / OBJ / MSH / LFM / Datamine wireframes, DXF (surfaces, strings, pegs), .wfr, OMF, styling meshes, mesh export.
- 08-grids — Grids & surfaces: GeoTIFF (bands, overviews), Surfer, ESRI ASCII, a grid as relief / flat sheet / drape, surface tools (extend, fill, combine), rasterize a mesh, new grids and models from parameters.
- 09-columns — Tables, columns & the attribute table: tables and spreadsheets (xlsx sheets), column types and the scan, detection limits (<0.01), blanks, the attribute table.

## Part III — Seeing  (group C)
- 10-color — Color & styling: color by a column, ramps and their range, classes (breaks, the histogram), categories and the legend, no-data, copy / paste style, opacity, block edges, background and theme.
- 11-sections — Sections & views: plan / N–S / E–W / dip & dip-direction / knife, slab, front / behind, per-layer cut modes, whole holes, section series, views of one model shown twice (offset), exploded views, vertical exaggeration, bookmarks and scenes.
- 12-picking — Picking, measuring & selecting: the record panel, measure, rectangle / lasso / through selection, selection to a column, domaining (painting, assign domains by solids).
- 13-filter — The filter & ƒ derived columns: the filter box and its drawer, the expression language by example, calculated columns (the Calculations window), color by ƒ, materializing.

## Part IV — Analysis  (groups D and E)
- 14-analysis (D) — How the analysis windows work: the rail, Run, scopes (all / filtered / selection), series, ranges, ⇥ figure, ⇥ layer, save as recipe, the same numbers in a routine.
- 15-gt (D) — Grade–tonnage: series, units, density, cutoffs, comparing models, reconciliation-aware curves.
- 16-resources (D) — The resource cross-tab and the resource table: groups × grade bins, cumulative vs between cutoffs, metal factors, the composer's resource table.
- 17-swath (D) — Swath / drift: directions (axes, oriented trio, trend/plunge), bands, the zebra and the band ghost, comparing model and samples.
- 18-stats (D) — Stats, scatter & Q-Q.
- 19-validation (D) — Validation & pairing: declustering, global bias, the sample swath, block-vs-sample pairs.
- 20-joins (E) — Join & reconcile: compatibility, spatial join, key join, reconcile (Δ), sub-blocked and rotated cases.
- 21-geometry (E) — By geometry: select / flag / ratio by a solid, a surface, a gridded surface; assign domains.
- 22-qa (E) — QA reports: model QA, drillhole QA, mesh QA & volume.
- 23-structure (E) — Structural geology on an outcrop mesh: prepare for structural analysis, paint a plane, attitudes (dip / dip direction), fit quality, traces and I/Y/X nodes, the stereonet, painted sets.

## Part V — Figures  (group E)
- 24-figures — Decorations & figure export: scale bar, north arrow, legend, title, background, Export figure, figure recipes.
- 25-composer — The composer: pages, frames (3D view, chart, table, text, legend, image, label, key plan), the inspector, fields and captions ({fig}, {mean:AU}…), scale lock, ticks and grids, vector sections, small multiples, house style and title blocks, templates and "use with other data", PDF export with the figure embedded.
- 26-atlas — Atlases: a page per bench / per section, via routines.

## Part VI — Automation  (group F)
- 27-recipes — Recipes: save as recipe, run, edit, New recipe… (the form), Check all recipes, the YAML.
- 28-routines — Routines: steps, inline tools and `with:`, each blocks (rows, columns, from a CSV / xlsx), filters, params sheets, ${…}, inputs (requires:), guards, the editor, preview, the tracker, retry / skip / resume.
- 29-checks — Checks & comparisons: scalar and row checks, not-evaluated, compare tables and tolerances, baselines and Accept, the Runs window.
- 30-records — Run records, the cache & provenance: the run folder, run.json, SHA-256s, reuse and fingerprints, Run fresh, lineage of derived layers.
- 31-library — The library: recipes and routines outside projects, running without a project (folder / zip of chosen outputs), packs, export and import (YAML or zip).

## Part VII — Projects & trust  (group F)
- 32-projects — Projects: the folder layout, saving and opening, tidy, the folder as inbox, bookmarks and scenes.
- 33-store — Backups, packs & the project store inside: backups, project packs, Parquet as the store, element manifests, column sidecars, the memory budget.
- 34-sealed — Security & everywhere: Sealed (no network), the verifier, installing, offline, on a phone (review mode), inside the Android shell.

## Appendices  (group G, except C)
- A-keys — Keyboard reference.
- B-expr — The expression language: syntax, operators, functions, blanks, cookbook.
- C-tools — Tool reference (GENERATED from `toolList()` by the harness — not hand-written).
- D-formats — File formats read and written.
- E-host — For developers: hosting micro, `window.micro` (layers, views, tools, routines, events), `addLayer`, `micro:model`.
- F-glossary — Glossary.
