// micro — Help: the keyboard, touch and analysis reference, About, the update check,
// and what the Sealed badge says.
import { keysHelpHtml } from './keys.js';
import { setHTML, trusted } from './html.js';
import { S } from './state.js';
import { _nlOn, nlEnsureTrained, nlSetEnabled } from './nl.js';
const $ = (s) => document.querySelector(s);

export const HELP_KEYS = `
<b>every key</b> (the same list as the manual and the printable card)<br>${keysHelpHtml()}<br><br>
<b>command palette</b> — <code>⌘K</code> / <code>Ctrl+K</code> (or the <b>⌘K</b> button) searches EVERY action and shows only what applies right now — the fastest way to reach anything, including the analysis tools (Help → <b>Analysis & workbench</b> for those)<br><br>
<b>mouse</b><br>
drag — orbit · right-drag / shift-drag — pan · wheel — zoom · <code>⌃</code>wheel — scrub the section · <code>⌥</code>wheel — slab thickness<br>
<b>click</b> a block or point — pick it: magenta glow + the record panel (full source row)<br>
<code>m</code> then two clicks — <b>measure</b>: 3D · plan · Δz between the picked records (<code>Esc</code> clears)<br>
<code>p</code> — <b>layers panel</b>: open several datasets together (drop several files at once, or Open… → "add as a layer"); right-click a layer for zoom / info / filter / remove · <code>[</code> / <code>]</code> step the active layer · right-click a group → <b>Mutually exclusive</b> shows one child at a time (round eyes), and <code>{</code> / <code>}</code> step through it<br>
<code>h</code> — hide/show the <b>active layer</b> (flick between overlaid models) · <code>⇧H</code> — <b>solo</b> it (again restores; step layers with <code>[</code> <code>]</code> while soloed to walk them one at a time) · <code>F2</code> — <b>rename</b> it · <code>⇧B</code> — <b>block edges</b> on/off (per-layer override in the layer's right-click menu)<br>
<code>Ctrl+S</code> — <b>save the project</b>: File → project folder (Chromium) keeps your layers, styling, filters, camera, section, and saved views in a plain folder — project.json + the files<br><br>
<b>view</b><br>
<code>f</code> fit the data · <code>n</code> <code>s</code> <code>e</code> <code>w</code> look that way (level) · <code>d</code> plan · <code>u</code> from below · <code>o</code> ortho/perspective<br><br>
<b>sections</b> — a cut through the data; everything hidden is neither drawn nor pickable. Blocks and drillhole sticks cut <b>true</b>: a block straddling the plane shows its cut interior at the plane (a thin slab reads as a continuous painted wall), and a sectioned mesh's trace draws <b>over</b> the wall like a wireframe outline on a section plot<br>
pick a preset (plan · N–S · E–W), press <code>k</code> (or <code>c</code> for <i>cut</i>) and <b>drag a line</b> (the vertical section through it; <code>⇧</code> snaps to 15°, <code>⇧⌥</code> to 5°, <code>Esc</code> cancels), or choose <b>custom</b> and type the plane's dip direction + dip · <code>x</code> toggles the section on/off<br>
<b>slab · front · behind</b> — keep a band of ±thickness, or everything on one side of the plane<br>
<b>plane</b> — outline the cut plane in the view · <b>2D</b> — face-on + orthographic + rotation locked (drags pan; the paper-section view) · right-click a layer → <b>Cut by sections</b>: follow · follow with its own slab (± m) · keep front only · keep behind only · don't cut (keep topo whole for context, or split one model at the plane while another follows the slab) · on drillholes, keep holes that cross the slab, whole<br>
<code>l</code> — face the section (<code>⇧L</code> its back) · <code>,</code> <code>.</code> — walk the section one slab at a time · <code>⌃</code>wheel scrubs · <code>⌥</code>wheel thickens the slab · <b>follow</b> — the camera walks with the scrub (the cut stays put on screen) · the number is slab half-thickness (m)<br><br>
<b>goto</b> — <code>g</code> then <code>1</code>–<code>9</code> recalls a view slot; <code>g</code> then <code>Shift+digit</code> saves the current view into that slot (a bookmark named “slot N” — camera + section, travels with the project). <code>F1</code> opens this help<br><br>
<b>selection</b> (<code>r</code> rectangle · <code>v</code> lasso, or Tools menu) — drag over the scene: what you SEE gets selected (occlusion-honest, all visible layers at once), tinted gold; <b>shift</b> adds, <b>alt</b> subtracts, <code>Esc</code> clears; releasing WITH shift/alt keeps the tool armed for the next gesture (middle-drag still orbits; Settings → interaction to change); the attribute table's <b>selected</b> view lists the grabbed rows; selections persist in the project<br>
The <b>select-through</b> toolbar toggle (the stacked layers, also Tools → Select through) flips the tools to the extruded tube: EVERYTHING whose position projects inside the shape — occluded included — via one pass over the data (a load-sweep's cost; drillholes are instant)<br><br>
<b>attribute table</b> (<code>t</code> / right-click a layer / Data menu) — the layer's rows as a floating, layer-pinned window (open several); windowed reads, so a 1.8M-row model scrolls cold; <b>matches</b> shows only the filtered rows; click a row to pick it in the scene — picks scroll the table to their row; ƒ columns included; read-only<br><br>
<b>layer properties</b> — right-click a layer → Properties… (or View menu): <b>style</b> (color-by, clip, stick radius, mesh tint/opacity/tier) · <b>classes</b> (per-class eyes over the category column — hide lithologies with a click; all · none · invert; hidden classes don't draw or pick; counts fill in as they're swept) · <b>columns</b> (per-column types — number/text drives the filter and color-by; right-click a column to re-type it, make it the category, or the color channel; <b>scan columns</b> streams the whole table once and fills n · mean · std · quantiles · histogram per column; <b>add calculated column…</b> defines ƒ columns (<code>FE + 0.4 * MN</code>) that the filter, the scan, and the record panel all see) · <b>source</b> (X/Y/Z column mapping — change re-reads the file; drillhole tables + desurvey method/dip — change re-desurveys; extent, grid parameters)<br>
<b>rule-based styling</b> — style mode <b>rule-based</b> (block models + drillholes): ordered rules, each an expression (<code>FE > 60 and LITO = "HEM"</code>) with a name + color; ONE sweep over the table paints each record with its first matching rule (drag to re-prioritize), everything unmatched wears the <b>else</b> color; per-rule eyes hide a rule's records (draw + pick, GPU-side); counts per rule after the sweep; rules persist in the project and re-sweep on load<br>
<b>paint to column</b> (<code>b</code> / the brush button / Data menu) — interactive domaining: a PAINTED column is a category column you fill by hand. The palette window (layer-pinned, like tables) picks the column + the value; while a value is armed, the <code>r</code> / <code>v</code> gestures PAINT it onto whatever they cross (<b>alt</b> erases, Tools → Select through paints the whole tube, <code>Esc</code> puts the brush down, <code>Ctrl+Z</code> undoes a stroke); or build a careful selection first and <b>apply to selection</b>. While painting the layer colors by the column (unpainted recedes dark); painted values are REAL columns — the filter (<code>DOMAIN = "HW_OXIDE"</code>), the scan, the attribute table, and the record panel all see them; they persist in the project<br>
<b>export rows</b> (Data → Export rows… / the layer context menu) — data leaves micro the way it came in, as rows: scope <b>all</b> · <b>filter matches</b> · <b>selection</b>; every column including ƒ calculated and ✎ painted ones (paint a DOMAIN, export it, feed the estimator); CSV with delimiter choice + decimal comma; streamed, so 1.8M rows is one sweep, and opening a .dm then exporting IS the .dm → CSV converter. In the attribute table, <code>Ctrl+C</code> copies the grid selection as TSV<br>
<b>select by solid</b> (Tools menu / right-click a mesh layer) — a closed context mesh (.msh / .obj / small .ply) classifies records by winding number: <b>select inside/outside</b> sweeps any element layers into the ordinary selection (paint or export it — the solids → coded-model loop), a <b>flag column</b> writes a value (e.g. <code>IN</code>) into a NEW painted column on any table-backed layers — blocks, points, drillholes — which you can then touch up with the brush; or <b>fraction-inside column</b> probes each block of a regular model (any per-axis resolution — 3×3×2 for benches, 10×10×10 for 1 m blocklings) and writes a numeric 0–1 column (<code>%</code> badge) the filter, table, and export all see; all of it works with flipped solids and colors the layer by the result when done. OPEN SURFACES (topo, weathering horizons — the dialog reads the mesh topology and says which) classify <b>above / below / between</b> instead: the surface is CLOSED by a skirt to a far apex and the same winding containment applies — strong at any depth, and blocks beyond the surface's footprint honestly come back unclassified; <b>between</b> takes a second surface (below the first AND above the second)<br>
<b>assign domains</b> (Tools menu) — the whole coded-model loop in one run: pick the domain solids, the model and a column name, and every block goes to the solid holding its largest fraction; unclaimed blocks stay unpainted and the result is an ordinary painted column — filter it, export it, touch it up with the brush<br>
<b>grids</b> — GeoTIFF / Surfer .grd / ESRI .asc open as heightfield layers (cells are pickable records; huge DEMs decimate for display, the full grid stays for evaluation); a mesh right-click → <b>Rasterize to grid…</b> renders it onto a DEM; grid layers export as ESRI ASCII<br>
<b>layer groups</b> — the layers panel is a tree: a group's eye greys its children without touching THEIR eyes (re-enable and the pattern returns); <b>drag a row</b> between rows to reorder, ONTO a group to join it (touch: long-press the row → Move up / down / to group); <b>ctrl+click</b> multi-selects rows (shift+click = a range) — right-click → <b>Group N selected…</b>; right-click a layer → Move to group… (or New group…), right-click a group → rename / zoom / ungroup; groups persist in the project<br>
<b>category legend</b> (categorized mode / classes tab): the color chip edits each class in place; <b>⠿ drag</b> reorders entries; right-click an entry to <b>rename</b>, <b>merge into</b> another (grouped classes share one color and one eye — BIF + ITABIRITE → "Iron Fm"), <b>ungroup</b>, or <b>remove</b> (values fall into a grey <i>other</i> bucket; split it back out any time; <b>reset legend</b> returns to the raw values)<br>
<b>auto / apply / revert</b> (the panel footer): style edits apply live by default; uncheck <b>auto</b> to batch them (one reconvergence instead of one per edit on a 100M layer) — <b>apply •</b> pushes everything, <b>revert</b> returns to the panel-open snapshot<br>
<b>ramps + classes</b> (style tab): pick a ramp per layer; type breaks (<code>20, 40, 55, 60, 65</code>) and tick <b>classed</b> for solid classes <code>&lt; 20</code> … <code>≥ 65</code>, each with a colour chip and an <b>eye</b> (hidden = not drawn, not pickable, off the legend); a class keeps its colour whatever the range, clip or layer · on a scanned column <b>double-click the histogram</b> to add a break (drag moves, right-click removes), with counts per class; quantile/equal auto-breaks · every edit undoes · <b>no data</b>: blanks draw grey (or hide) — never as the lowest grade; a −99 sentinel → right-click the column → <b>Detection limits &amp; blanks</b> · the clip belongs to the column · <b>Style → Copy / Paste / Save / Load style</b> (layer menu) carries a look to another layer, model or project by column name<br><br>
<b>meshes</b> — .msh (Leapfrog) / .obj / .ply-with-faces / .lfm / .dxf / .wfr / Datamine pt+tr pairs, and the surfaces of an .omf project; a multi-object .obj or .lfm offers "split into N solids (as a group)" at open, .lfm solids keeping their Leapfrog colours<br>
a click on a mesh reports the point on its surface; its vertices are its records (attribute table, paint) · right-click the layer → <b>Mesh QA / volume…</b> (watertight, shells, volume) · <b>Tint…</b> / <b>Opacity…</b> · sections cut meshes per-pixel and draw their trace on the cut face<br><br>
<b>filter</b> — one expression language over EVERY column (source, ƒ, painted, joined):<br>
<code>/</code> focuses the box · autocomplete offers columns, functions, and the category values — <code>Tab</code>/<code>Enter</code> accepts<br><code>FE &gt; 55 and LITO = "HEMATITE"</code> · <code>between</code> · <code>in (…)</code> · <code>&#96;spaced name&#96;</code> in backticks · <code># comments</code> — Enter applies, Esc clears<br>
matching elements isolate — everything else drops out of the render, the table, and the analysis<br>
the <b>▾ drawer</b> beside the box projects the expression as LIVE WIDGETS — sliders + chips with operator dropdowns, clickable and/or pills, real bracket groups, a remove × per condition, and a multiline editor; every control rewrites its own span of the text<br><br>
<b>ƒ derived columns</b> — Tools → <b>Calculated columns…</b> is the workbench: expressions over the FULL schema (calc-on-calc composes), an <code>if()</code> ladder projects as a case table, constants as sliders. Colour by <code>ƒ NAME</code> straight from the colour dropdown. Joins and drillhole broadcasts land as materialized columns too — the filter, GT/swath, record panel, and exports all see every one of them<br><br>
<b>drillholes</b> — a set is a GROUP: ◈ collars and ↧ survey rows carry their own actions (attribute tables, <b>Filter holes…</b> over collar columns — the verdict masks every interval table and the traces — <b>Broadcast</b> a collar column onto the intervals, re-desurvey, traces). The set's menu has <b>QA report…</b>: every row to look at before estimating — blank or duplicate collars, orphan and bad survey stations, doglegs, gaps, overlaps, depths past the end of hole, text in a grade column — each at its table and row; click one to go to the hole; export it as TSV<br><br>
<b>knobs</b><br>
<b>min/max</b> boxes clip the color scale (outliers stop eating the ramp; empty = auto) · View menu: <b>boxes</b> = true block faces · <b>points</b> = fixed splats (snappier) · <b>block edges</b> = outline every block (and every cut block on a section) · <b>budget</b> = elements per frame (lower = snappier; converges when still) · <b>EDL</b> = the shading that makes points read as a surface`;

export const HELP_TOUCH = `
<b>the view</b><br>
one finger — orbit · two fingers — pinch to zoom, move together to pan, twist to turn<br>
<b>tap</b> a block, point or surface — its record opens as a card (the view doesn't move; drag the card's handle up for the full sheet, flick it away to close) · a tap a little off an edge still finds it<br>
<b>double-tap</b> the model — orbit about that spot · double-tap empty space — fit<br>
<b>hold still</b> on the model — the <b>magnifier</b>: what's under your finger, enlarged above it; slide onto the exact spot and lift to pick it<br><br>
<b>the bottom bar</b><br>
<b>layers</b> · <b>props</b> (the active layer) · <b>select</b> · <b>section</b> · <b>measure</b> · <b>fit</b> — everything else is in ☰ and the <b>⌘K</b> palette (type what you want: "grade tonnage", "export", "save")<br>
↶ ↷ in the top bar undo and redo — one gesture is one step<br><br>
<b>select</b> — drag a rectangle or draw a lasso (the shape buttons on the selection bar); <b>new · + · −</b> say what the next drag does (a phone has no shift / alt); <b>through</b> takes hidden blocks too; <b>→ col</b> writes the selection as a column; × clears<br>
<b>section</b> — the strip above the bar: the mode, a scrub slider, − / + for the slab; <b>⋯</b> for slab · front · behind, a custom dip, plane · follow · 2D<br>
<b>measure</b> — tap two points; or press and slide: a crosshair rides above your finger (with the magnifier) and lifting takes the point under it<br><br>
<b>sheets</b> — every window and panel is a sheet from the bottom (on the right, holding the phone sideways); drag its handle to resize, past the bottom to close; one at a time — the others wait as chips above it; the view moves its middle above the sheet<br>
<b>rows</b> — long-press a layer row (or tap its ⋯) for its menu<br>
<b>typing an expression</b> (filter, ƒ columns, hole filter) — a strip rides the keyboard: the symbols a phone keyboard hides, ◂ ▸ to move the cursor, and what fits at the cursor — columns, then operators, then the category values<br>
<b>Back</b> closes what's on top — a menu, a dialog, the card, a sheet, an armed tool — before it leaves micro<br><br>
<b>swath</b> — drag sideways across the plot to hold a band range (and select it in 3D); tap a bar to see its band in the model`;

export const HELP_ABOUT = `
<b>micro</b> — a streaming workbench for massive spatial-element files: LiDAR point clouds
(.las, .ply, .xyz), block models (.csv, .dm, .parquet — regular or variable-size sub-blocked), grids, and drillholes. No import step —
first look in about a second at any size, densifying while you orbit. Beyond viewing:
filter · section · domain by solid · join &amp; reconcile models · grade-tonnage · swath ·
validate against drillholes · figure export — all against the source file, all with a
provenance trail (Help → <b>Analysis &amp; workbench</b>). Nothing leaves your machine.<br><br>
Engine: <code>@gcu/condenser</code>. Part of the Auditable project — Geoscientific Chaos
Union, <code>gentropic.org</code>. MIT. All code in this file is GCU's own,
implemented from the published methods below.<br><br>
<b>References</b> — the rendering model follows:<br>
· M. Schütz, G. Mandlburger, J. Otepka, M. Wimmer — <i>Progressive Real-Time Rendering of
One Billion Points Without Hierarchical Acceleration Structures</i>. Computer Graphics
Forum 39(2), 51–64, 2020. doi:10.1111/cgf.13911 — the streaming, no-preprocess,
progressive-accumulation model at micro's core.<br>
· M. Schütz, B. Kerbl, M. Wimmer — <i>Rendering Point Clouds with Compute Shaders and
Vertex Order Optimization</i>. Computer Graphics Forum 40(4), 2021. doi:10.1111/cgf.14345
— the vertex-order/Morton line behind micro's batch chunking.<br>
· M. Schütz, B. Kerbl, M. Wimmer — <i>Software Rasterization of 2 Billion Points in Real
Time</i>. Proc. ACM Comput. Graph. Interact. Tech. 5(3), art. 24, 2022. doi:10.1145/3543863<br>
· C. Boucheny — <i>Visualisation scientifique de grands volumes de données: pour une
approche perceptive</i>. PhD thesis, Université Joseph Fourier, 2009; and A. Ribes,
C. Boucheny — <i>Eye-Dome Lighting: a non-photorealistic shading technique</i>. Kitware
Source 7, 2011 — the EDL shading.<br>
· C. Sigg, T. Weyrich, M. Botsch, M. Gross — <i>GPU-Based Ray-Casting of Quadratic
Surfaces</i>. Eurographics Symp. on Point-Based Graphics, 59–65, 2006 — the ray-cast
impostor technique behind the exact block rendering.<br><br>
toolbar icons: <a href="https://lucide.dev" target="_blank" rel="noopener">Lucide</a> v0.462.0, ISC license.<br><br>
build <code>${S.build}</code>`;

export const HELP_ANALYSIS = `
Everything here is on a layer's <b>right-click menu</b> and in the <b>command palette</b> (<code>⌘K</code>) — the palette only shows what applies to the active layer. Every analysis window works the same way: a rail of settings, <b>Run</b> (click again to cancel), a scope of <b>all / filt / sel</b>, and one results row — <b>⤓ png · ⧉ copy · ⇥ layer · ⧉ table</b>; the setup is saved with the project.<br><br>
<b>grade-tonnage</b> — <b>tonnage</b> + <b>mean grade</b> above cutoff. Each <b>series</b> is a layer + grade column + declared unit + density expression (<code>SG</code>, <code>2.7</code>; blank = volume) + optional filter, so model-vs-model curves are one window; a reconcile layer pre-seeds reference vs new<br>
<b>resource cross-tab</b> — tonnage · grade · metal · blocks by a group (a category or painted column — domains, classes) × grade bins between your cutoffs, or cumulative above each; a row with no grade keeps its tonnage in its own column<br>
<b>stats</b> — n · mean · std · quartiles per column, optionally grouped and weighted<br>
<b>scatter / Q-Q</b> — <b>scatter</b>: one column against another, every pair while there are few, a density at any size, log axes, r; <b>Q-Q</b>: two sides (any layer, column, filter, scope — model vs model, model vs drillholes) quantile against quantile, with the 1:1 line<br>
<b>swath (drift)</b> — mean grade per slab along a <b>direction</b>: the grid <b>axes</b> X/Y/Z, an oriented trio from <b>dip-direction / dip / rake</b> (across · along-strike · down-dip), or a single <b>trend / plunge</b>. Add a <b>series</b> per curve — each from any layer, with its own <b>column</b>, a free <b>weight expression</b> (blank = block volume; <code>SG</code>, <code>SG*PARTIAL</code>, or a decluster column for tonnage/sample weighting) and its own <b>filter</b> — so you can overlay <b>kriging · NN · samples</b>. Configure, then <b>Run</b> (it scans once, binning all directions together): switching axis and adjusting band width / offset are then instant. <b>zebra</b> paints the alternate bands onto the 3D so you see what the plot bins<br>
<b>join &amp; reconcile</b> (Properties → <b>join</b> tab) — <b>spatial join</b> resamples a <i>compatible</i> model onto a target grid (a banner shows compatibility: clean replicate/aggregate, or the reason it can't); <b>key join</b> matches by a key column. <b>Reconcile</b> two model versions → a coloured <b>Δ map</b> (this − reference, diverging ramp about 0) on a common lattice, with <b>matched · mean Δ · added · removed</b> — the change-control record<br>
<b>sub-blocked models</b> — variable-size (octree) block models open as their <b>true boxes</b>, each block at its own size. Join &amp; reconcile aggregate them to the reference grid by <b>volume</b> — a big parent and its small sub-blocks weighted by the space each fills — so a sub-blocked model compares cleanly against a regular one at the parent resolution<br>
<b>validate vs drillholes</b> — is the model consistent with the samples? Declusters the drillhole grades (spatial sampling over-drills high grade), then reports the <b>global bias</b> (model mean vs declustered sample mean) and a <b>model-vs-sample swath</b>. (Point vs block support: a global offset can be real; the swaths flag <i>local</i> bias)<br>
<b>common grid</b> (New… → <b>cover compatible models</b>) — an empty model on a lattice that covers <i>and</i> is compatible with several models at once — the natural reconcile target<br>
<b>optimize to spatial Parquet</b> — reorders a model Morton-sorted (a footer spatial index; queries skip whole row-groups). Runs automatically when you save a project — Parquet is the project store<br>
<b>lineage</b> — every derived layer remembers <i>how it was made</i>: open → join / reconcile / optimize wraps its sources with the params + build + time. <b>Lineage…</b> shows the tree + exports a readable HTML <b>report</b>; Parquet exports carry it embedded. Provenance you can attach to a sign-off<br>
<b>linked brushing</b> — scope <b>sel</b> follows the 3D selection (rubber-band a bench and read its curve live), <b>filt</b> the filter box<br>
<b>drillhole QA</b> (a drillhole set's menu) — every row to look at before estimating: blank or duplicate collars, orphan and bad survey stations, doglegs, gaps, overlaps, depths past the end of hole, text in a grade column — each at its table and row; click one to go to the hole<br>
<b>mesh QA / volume</b> (a mesh's menu) — watertight or not, shells, flipped faces, slivers, and each shell's volume (× a density: tonnes); click an issue to step to it<br><br>
<b>figures</b> (View → <b>Decorations &amp; figure…</b>) — a live panel: toggle a <b>scale bar</b>, <b>north arrow</b>, and <b>title</b>; turn on a colour <b>legend per layer</b> (they stack, each captioned by its coloured attribute — rename inline); set a <b>background</b> (white/paper for print — the decorations flip to dark ink). <b>Export figure</b> captures exactly what you see as a report-ready PNG — at <b>1× / 2× / 3×</b> resolution (2×/3× re-render the scene sharper for print)<br>
<b>composer</b> (View → <b>Composer…</b>, or ⌘K) — lay out a <b>page</b> (A5–A2, Letter, portrait / landscape, or a size in mm) and print it as a vector <b>PDF</b> or a PNG. <b>+ 3D view</b> puts the current view in a frame that renders at ITS size and remembers its scene (right-click: <b>Update from the 3D view</b> · <b>Show in the 3D view</b>); <b>+ legend</b> / <b>+ scale</b> / <b>+ north</b> follow that frame (a scale bar needs an orthographic view, and stays true when you resize the frame); <b>+ text</b> takes fields (the text inspector's <b>insert field…</b> lists them): {fig} {page} {pages} {date:DD/MM/YYYY} {time} {title} {scale} — and from the 3D-view frame the caption <b>refers to</b> (the inspector: nearest, or a fixed one; or <b>@id</b> in the field, {scale@plan} · {fig@plan}), as it was rendered: {section} {look} {elevation} {layers} {count} {total} {filter} {source} {sha} {project} {micro}, and statistics over its shown records, {mean:AU} {median:AU} {min:AU} {max:AU} {std:AU} {n:AU} (or {mean:<i>layer</i>:AU}). A number format goes last: {count:,} · {mean:AU:.2f} · &#36;{count / total:.1%} (&#36;{…} computes with count, total, section, look, elevation, page). Drag to move (snaps to margins and other frames), handles to resize, arrows nudge, ⌘Z undoes. Analysis windows send their chart with <b>⇥ figure</b>: a vector chart frame that re-flows when resized, and remembers the analysis that made it (its table too). <b>+ resource</b> adds a resource table: tonnes, grade and metal above your cutoffs, by domain and class, from the model. Export re-renders each view at the chosen dpi. <b>atlas…</b> writes a routine that renders the figure once per section level into one PDF (a <b>compo</b> step in an <b>each</b> block — set any view, filter or caption value per page; write &#36;{level} in a caption). Analysis tables arrive as book-style table frames. A view frame knows its projection: in the inspector, <b>coords</b> puts coordinate ticks (or a grid) on an orthographic view's border, and <b>scale 1:</b> locks its scale — resizing then changes what it shows, never the scale. <b>+ label</b> pins a label to the record you last clicked in the 3D view (else the view's middle); its leader follows the point. Double-click a view frame to work it in the 3D view at the frame's shape; <b>Done</b> re-captures it. <b>+ key plan</b> adds a whole-model plan wearing the selected view's section line — on every atlas page the line moves with the page. A view frame's menu → <b>Small multiples…</b> repeats it, coloured by several columns, cut at several levels, or under several filters, in a grid over its box, each copy captioned. A view frame's menu → <b>Vector section</b> prints an orthographic plan / N–S / E–W section as vectors: every block the plane cuts, in its legend colour (a ramp or categories; the filter applies), the view's other layers on top; it is made again with every render, so atlas pages are vector too. A 3D-view frame remembers the content hash of each file it showed: when a layer is now a different file it wears <b>older data</b> (missing: <b>data not loaded</b>), and <b>↻ refresh</b> makes the figure again with the data as it is now: every view from its scene, every chart and table from its analysis, every resource table (⌘K → Refresh all figures: every figure). Each exported PDF carries its figure — open or drop the PDF on micro and it is an editable figure again, its badges saying whether your data still matches. Every frame has an <b>id</b> (view-1, text-2 …): rename it in the inspector or by double-clicking it in the frame list, and every reference follows. Figures save in the project as <b>figures/</b>name<b>.compo.json</b><br>
<b>windows</b> (View → <b>Windows…</b>) — the analysis + table + paint windows are all draggable and layer-pinned; list / focus / <b>cascade</b> / <b>close all</b> from here<br>`;

// About + the experiments drawer. The NL command bar lives here, OFF by default:
// a stranger's first minute must not contain a text box that guesses.
export function showAbout() {
  const exp = `
  <h3 style="margin-top:1.2em">Experimental</h3>
  <p class="fi-note">Off by default, and rightly so — these are not finished.</p>
  <label style="display:flex;gap:.5em;align-items:flex-start;cursor:pointer">
    <input type="checkbox" id="nlToggle"${_nlOn ? ' checked' : ''} style="margin-top:.25em">
    <span><b>Natural-language command bar</b><br>
    <span class="fi-note">Press ⌘K / Ctrl+K and type a phrase — <i>“colour by FE”</i>, <i>“hematite above 60 iron”</i>,
    <i>“section on Z at 1020”</i>. It <b>proposes</b> a command and never runs it: you read what it understood, and press Enter.<br>
    It learns <b>this project's</b> vocabulary — your columns, your lithologies, your layer names — and trains in about a second,
    in this tab. No model file, no network, no WASM: micro stays Sealed, and it cannot be out of date.
    It will misread you. Nothing it proposes is destructive.</span></span>
  </label>`;
  showHelp('about micro', trusted(HELP_ABOUT + exp));
  const cb = $('#nlToggle');
  if (cb) cb.onchange = () => { nlSetEnabled(cb.checked); if (cb.checked) nlEnsureTrained(); };
}

export function showHelp(title, html) {
  $('#helpTitle').textContent = title;
  setHTML($('#helpBody'), html);
  $('#help').classList.add('show');
}

// Check for a new build. Seal-safe: the page never fetches — it asks the service
// worker (via the deploy-injected __microCheckUpdate → a gcu-sw postMessage), and
// the SW does the network. Inert on the offline file:// download (no SW → no global).
export function checkForUpdates() {
  const fn = window.__microCheckUpdate;
  if (!fn) { $('#meta').textContent = 'updates: this is the offline file — the hosted app (gentropic.org/micro) auto-updates via its service worker'; return; }
  $('#meta').textContent = 'checking for updates…';
  fn().then((r) => {
    if (r && r.changed) $('#meta').textContent = 'a new version is available — reload to apply (see the banner)';
    else if (r && r.noSw) $('#meta').textContent = 'updates: no service worker present — nothing to check';
    else if (r && r.timeout) $('#meta').textContent = 'update check timed out — try again';
    else $('#meta').textContent = 'micro is up to date';
  }).catch(() => { $('#meta').textContent = 'update check failed'; });
}

// Sealed badge: micro's real differentiator (no network, data stays local,
// WASM-free) made visible — a click explains why + points at the verifier.
export function sealedInfo() {
  const existing = $('#sealPop'); if (existing) { existing.remove(); return; }
  const badge = $('#sealBadge'), r = badge.getBoundingClientRect();
  const pop = document.createElement('div'); pop.id = 'sealPop';
  setHTML(pop, trusted('<h4><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Sealed — nothing leaves this machine</h4>'
    + '<ul><li><b>No network access from the page.</b> The page policy blocks every connection (<code>connect-src \'none\'</code>) — no telemetry, no cloud, no data egress.</li>'
    + '<li>Your data — point clouds, block models, drillholes — stays on this device (memory / local disk), never uploaded.</li>'
    + '<li><b>WASM-free</b>, runtime in the clear — the code is readable and auditable, not opaque binary.</li>'
    + '<li><b>File vs hosted app.</b> The downloadable <code>micro.html</code> is what\'s sealed: zero network, no service worker. The hosted app (gentropic.org/micro) adds a service worker <i>outside</i> the sealed page that caches it for offline use + checks for a newer build — fetching only micro\'s own files, never your data. Run the downloaded file for provable zero-network.</li></ul>'
    + '<div class="dim">Verify the build + how to bring it through approval → <a href="https://gentropic.org/security" target="_blank" rel="noopener noreferrer">gentropic.org/security</a></div>'));
  document.body.appendChild(pop);
  pop.style.left = Math.max(6, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  const off = (e) => { if (!pop.contains(e.target) && e.target !== badge && !badge.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } };
  setTimeout(() => document.addEventListener('pointerdown', off), 0);
}
