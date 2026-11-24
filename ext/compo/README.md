# @gcu/compo

A figure / page composer. A **page** (A5–A2, Letter, Legal, Tabloid or a custom size in mm;
portrait or landscape; margins) with **frames** placed freely on it, each a box in millimetres
holding finished content of one **kind** — a render, a chart, a legend, a scale bar, a north
arrow, a caption. One drawing path puts a page onto the editor's canvas, a PNG, or a vector PDF
(through [`@gcu/pdf`](../pdf), inlined in the bundle). Plain-JSON documents. No dependencies,
no WASM; the editor is plain DOM and works in any host page.

compo does not make content: a host does (micro renders its 3D view, plot its figures) and hands
it in. compo lays it out, keeps it, and prints it.

```js
import { createDocument, addFrame, mountEditor, exportPDF } from '@gcu/compo';

const doc = createDocument({ title: 'Pit A', page: { size: 'A3', orientation: 'landscape' } });
const view = addFrame(doc, { kind: 'image', box: [12, 12, 260, 180], content: { photo: true, meta: { worldPerMm: 2.5, north: 0 } } });
view._img = await createImageBitmap(canvas);            // the host's render
addFrame(doc, { kind: 'scalebar', box: [12, 196, 60, 8], content: { of: view.id } });
addFrame(doc, { kind: 'text', box: [80, 196, 200, 12], content: { md: '**Figure {fig}.** {title}, level ${level} m' } });

const ed = mountEditor(element, doc, { onChange: (d) => save(d) });
const bytes = await exportPDF(ed.getDoc(), { env: { evalField: (expr, vars) => vars[expr], vars: { level: 340 } } });
```

## The document

```json
{ "format": "compo", "version": 1, "title": "…",
  "page": { "size": "A4", "orientation": "landscape", "margins": [12, 12, 12, 12] },
  "frames": [ { "id": "image-1", "kind": "image", "box": [x, y, w, h], "content": { … },
                "style": { "border": true }, "source": { … }, "produced": "ISO time" } ] }
```

- The frames list is back to front.
- `source` is the host's own record of where the content came from, so it can refresh it.
- Fields whose names start with `_` are runtime only and never saved: `_img`, a decoded bitmap, and `_jpeg`.
- `parseDocument` checks the document; `serializeDocument` writes it.
- Unknown kinds are kept, and draw as an error box until a host registers them.

**Ids.** A frame's `id` is its one handle.
- It is generated as `<prefix>-<n>`: `view-1`, `text-2`, `scale-1`, `legend-1`, `table-1`, `chart-1`, `image-1`, `plot-1` (`idPrefix(frame)`, `newId(doc, prefix)`).
- It is a short token: letters, digits, `-`, `_` and `.` (`ID_RE`, `sanitizeId`).
- `renameFrame(doc, from, to)` renames it and rewrites every reference: other frames' `content.of`, and `@id` in their fields. It returns null, or the reason it refused (a taken id, a space).
- Older documents migrate on `parseDocument`: a frame's display `name` becomes its id when it can, and `{ref:x}` / `{scale:x}` become `{fig@x}` / `{scale@x}`.

**Refers to.** A caption, scale bar or north arrow is ABOUT one other frame:
- its `content.of` when set;
- else the nearest frame that fits (one with `content.meta`, i.e. a view).

## Kinds

| kind | content |
|---|---|
| `text` | `md` (`**bold**`, newlines), `size` (pt), `align`, `mono`, `color`, `pad`. Takes [fields](#fields) |
| `image` | `src` (a data/blob URL, decoded by `ensureImages`) or a host-set `frame._img`. Also `fit` (`contain`/`cover`/`fill`), `smooth`, `meta`. `photo: true` → JPEG in a PDF |
| `drawlist` | `list`, a [@gcu/plot](../plot) `fig.toDrawList()`, replayed as vectors |
| `legend` | `title`, then either `entries: [{color, label}]` or `kind: 'ramp'` with `stops`, `hiLabel`/`loLabel`, optional `tail` |
| `scalebar` | `worldPerMm` + `units`, or `of: <frame id>` → that frame's `content.meta`. A view frame states `meta.worldPerPx` (world units per image pixel) so the bar follows the frame's drawn size: resize it and the scale stays true (`frameWorldPerMm(frame)`) |
| `table` | `columns`, `rows`, `title`, `note`, `size` (pt), `align` (per column `l`/`r`/`c`), `zebra`. Book style: rules above and below, numbers right-aligned, light striping; the type shrinks to fit the width (down to 4.5 pt); rows that don't fit are counted (`… N more rows`). `tableFromTsv(tsv, title)` builds one |
| `north` | `north` (degrees clockwise from page-up; `null` = the view looks along north), or `of` as above |

`registerKind(name, { label, draw(ctx, box, frame, env) })` adds one. The context is in **mm**, y down.

## Views of 3D space

An image frame that is a render can say how it maps world space: `content.meta.proj = { m, origin }`. `m` is the renderer's column-major viewProj at the frame's aspect, applied to (world − origin). Then:
- `worldToPage(frame, [x, y, z])` → `{ x, y, inside }` in mm, and `pageToWorld(frame, x, y, ndcZ)` the other way;
- **coordinate ticks:** `content.ticks = 'ticks' | 'grid'` (the inspector's **coords**). Each border names the coordinate it shows: 512 300 E, 7 604 000 N, 600 RL. Ticks are vectors at nice steps, drawn for orthographic views only. `worldTicks(frame)` lists them;
- **labels** (kind `label`): `content.text` and `content.at = [x, y, z]`. The leader runs from the box to where the point lands in the view it refers to (`content.of`, else the nearest projected view). If the point is outside the picture, the leader stops at the picture's edge with an arrowhead toward it. **+ label** pins the host's `opts.labelPoint(view)`, else the view's middle. A kind with `overflow: true` is not clipped to its box.
- **overlays:** `content.overlays` (and a host's `env.overlaysFor(frame, env)`) draw on the picture. A `{ type: 'plane', normal, position, thickness?, color?, label? }` draws that plane's TRACE: where it crosses the picture, solid, with its slab's faces dashed and a label. `planeTrace(frame, plane)` returns the segments; a plane facing the viewer has none. `proj.focus` (a world point) is the depth a page point is read at.
- **vector pictures:** `content.vector = { background, layers: [{ type: 'cells', axis: { w, u, v }, position, rects: [u0, v0, u1, v1, …], colors, palette }], overlay? }` draws a section as vector cells in place of the bitmap (`vectorOn: false` shows the bitmap). Each cell is a rectangle on the plane `axis.w = position`, put through the frame's projection, so ticks, overlays and labels land on it as they do on the raster. `overlay` is an image src drawn over the cells (the host's other layers, transparent).
- `opts.frameOpen(f)` → true lets the host handle a double-click (micro edits the view in place).

## Fields

Live text, filled in each time the page is drawn: text frames, and legend and table titles and notes.

- `{name}`, `{name:arg}`, and a number format last: `{name:arg:,.2f}`, or `{count:,}` with no argument.
- `@id` at the very end makes the field about that frame: `{scale@plan}`, `{mean:AU:.2f@plan}`. Without it, the field is about the frame its text frame refers to (see [Ids](#the-document)).
- `${expr}` and `${expr:,.0f}`: an expression the host evaluates, `env.evalField(expr, env.vars, frame, env)`.
- An unknown `{word}` stays as written, so ordinary braces survive.

| field | gives |
|---|---|
| `{fig}` | the figure number: captions are counted in page order, and on across an atlas |
| `{fig@id}` | another caption's figure number; for a view, the number of the caption nearest it |
| `{page}` `{pages}` | the page number and count |
| `{date}` `{date:DD/MM/YYYY}` | today; tokens `YYYY YY MMMM MMM MM M DD D HH mm ss` |
| `{time}` `{time:HH:mm:ss}` | the time |
| `{title}` | the document's title |
| `{prop:key}` | a property: the document's own (`doc.props`, e.g. a drawing number) over the host's (`env.props`, a house style) — `—` when neither has it |
| `{scale}` | `1 : 2 500`: the scale of the view the caption is about (from `content.meta`). A perspective view has none |

**Number formats** follow Python:
- `,` or `_` groups thousands with a comma or a space;
- `.N` sets the decimals;
- then `f` (fixed), `%` (percent) or `e` (exponent).

With no format, a number shows six significant figures, but the integer part is never rounded away (so a northing stays whole).

**Host fields:**
- `registerField(name, fn(arg, frame, env), help)` adds a field for every document.
- `env.fields = { name: fn }` adds fields for one render, and wins over a registered field of the same name.
- `env.fieldHelp = [{ name, help }]` lists the host's fields in the editor's picker.

`subjectFrame(env, frame, test)` is the one rule a host field uses to find its frame: the field's `@id` (`env.at`), else the frame's `content.of`, else the nearest frame that passes `test`. `refFrame(doc, frame, id, test)` is its lookup: by id, or the nearest.

Also exported: `formatNumber`, `formatDate`, `fieldList`, and the small formatters compo's own fields use, for a host's: `groupDigits(2343000)` → `2 343 000` (or `groupDigits(n, ',')`), `significant(v, k)` (k significant figures), `fmtBearing(45)` → `045°`.

## House style and templates

- **Properties** are what `{prop:key}` reads. `HOUSE_KEYS` names the shared ones (company, client, project, prepared, checked, disclaimer — every figure of a project; the host passes them as `env.props` and keeps them where it likes), `FIGURE_KEYS` a figure's own (drawing, revision — in `doc.props`). Each is `[key, label]`.
- **The title block:** `addTitleBlock(ed)` adds six bordered text rows, bottom-right inside the margins, as one group — company; project · client; title; drawing · revision · date; prepared · checked; scale · page. Every row is fields. `titleBlockFrames(doc, { rows, width })` gives the frames without adding them; `TITLE_BLOCK_ROWS` is the default `[md, size pt, height mm]` list.
- **Templates:** `setTemplate(doc, on)` marks a document as one. `docFromTemplate(tpl, title, { clear })` starts a new document from it: its frames, page and properties, a title of its own, not a template, and the per-drawing properties (`FIGURE_KEYS` unless `clear` says otherwise) gone. Which templates exist is the host's catalogue.

## Inserting

- `addImageSrc(ed, src, { name, width = 35, source })` adds an image frame from a URL the page can load (a `data:` URL keeps it in the saved document), top-left inside the margins, at the image's aspect. `addImageFromFile(ed, { source: (name) => record })` opens the file picker first; `readImageFile(file)` → a `data:` URL.
- **Small multiples:** `smallMultiples(ed, frame, { n, cols, variant, caption })` repeats a frame n times in a grid over its own box. The host makes each copy: `await variant(k, box)` adds a frame in that box and returns it. compo captions it (`caption(k)`, which may be a field such as `{section}`; the caption refers to its copy), then removes the original and groups the copies and captions. `multiplesGrid(box, n, { cols, gap, capH })` is the layout alone, and throws when the cells would be too small.

## Export

- `exportPDF(doc | [docs], { env, title, created, dpi, jpegQuality, compress, source, attach })` → `Uint8Array`.
  - A list of documents is an **atlas**, one page each, with `{page}`/`{pages}` resolved and `{fig}` numbered on across the pages.
  - `env.prepare(doc, { dpi, page })` runs before each page is drawn, so a host can re-render its frames at print resolution.
  - **The PDF carries its source.** A one-page export embeds its document as `<title>.compo.json` (a PDF attachment). An atlas embeds `opts.source` when given, e.g. the figure its pages were made from. `source: false` embeds nothing, and `attach: [{ name, data, mime, description }]` adds more files.
- `figureFromPdf(bytes)` → `{ doc, name, attachments }`: the figure a compo PDF carries (`doc` is null when it carries none), so the PDF opens again as an editable figure.
- `exportPNG(doc, { dpi, env })` → a PNG `Blob`.
- `renderPage(doc, ctx, env)` draws onto any 2D context in mm.

## The editor

`mountEditor(el, doc, { env, onChange, toolbar, frameMenu, inspector })` returns `{ getDoc, setDoc, selected, select, addFrame, update, render, zoomFit, undo, redo, destroy }`.

- **Selecting:** click to select, ⇧-click to add to the selection. Drag on the empty page to box-select the frames wholly inside the box.
- **Moving and snapping:** drag to move. The frame (or the whole selection, as one box) snaps to:
  - the page edges, the margins and the page centre;
  - other frames' edges and centres;
  - **equal spacing** — a gap that already exists between two frames side by side, or centred between two neighbours. The gaps show in mm.
  - Guides show what it snapped to; ⌥ while dragging turns snapping off.
- **Resizing:** eight handles. The dragged edges snap the same way; ⇧ on a corner keeps the aspect ratio.
- **Groups:** ⌘G groups the selection and ⌘⇧G ungroups. A group selects, moves, aligns and distributes as one unit, and its copies form a new group.
- **Arranging:**
  - Align (6 ways) and distribute (h / v) work by unit. A **locked** frame is the reference: it counts toward the bounds but stays put.
  - Match size: same width, height or both as the FIRST selected frame, the key.
  - Z-order: front, back, and one step forward or back (⌘] / ⌘[, with ⇧ for front / back).
- **Locks:** a locked frame won't drag, resize, nudge or delete, and wears a badge. Lock it from the inspector, the item list or the context menu.
- **Rulers and guides:** mm rulers along the page's top and left, with the selection's extent shaded (toggle **rulers**). Drag out of a ruler for a guide: ½ mm steps, or the grid; ⌥ moves it freely. Drag a guide to move it, and back to its ruler to remove it. Right-click a ruler to clear all guides. Guides are snap lines, are saved as `page.guides = { x: [mm], y: [mm] }`, and never print.
- **Grid:** 1, 2, 5 or 10 mm, drawn faintly and snapped to (moving and resizing); `page.grid = { size, show, snap }`.
- **Item list:** every frame, front first, above the inspector.
  - Each row has an eye (a hidden frame is neither drawn, picked nor printed) and a lock.
  - Each row shows the id, then a description. A click selects; a member row selects just that member, to edit inside a group. Double-click renames the id.
  - Drag a row to restack. A group is a folder row over its members and moves as a block. A member dragged out of its block leaves the group; another frame dropped on a group lands beside the block, never inside it. Grouping gathers the members together in the stack.
  - A kind can name its frames for the list with `describe(frame)`.
- **Keys:** arrows nudge 0.5 mm, ⇧ + arrow 5 mm. ⌘D duplicates, Delete removes, ⌘Z / ⌘⇧Z undo and redo, ⌘A selects all.
- **Toolbar:** page setup and the arranging buttons. A status line says when something was refused.
- **Inspector:** the selected frame's id (renaming it updates every reference), its "refers to" for a caption / scale bar / north arrow (**nearest → view-1**, saying which it picked, or a fixed frame; the frame it refers to is outlined and linked on the page), its box in mm, its border, its lock, and its kind's own fields. A multiple selection shows its units and one lock box for all of them. A text frame has an **insert field…** picker: compo's fields and the host's, each with its help as a tooltip. A pick inserts at the caret as one undo step.
- **Context menu:** the host's items, then Duplicate, Group / Ungroup, Same size, the four z-order steps, Lock / Unlock and Delete.
- **Host hooks:** a host adds toolbar buttons, items in the frame context menu, and inspector rows. `frameBadge(f)` → null, a text, or `{ text, title }` puts a badge on a frame (on the page, and a ⚠ in the item list). micro uses it to mark views made from data that has changed. Its `update(id, fn)` changes a frame as one undo step.
- **Theming:** the editor's colours read `--compo-*`, then the host's `--text` / `--border` / `--accent` / `--bg-btn`.

## Tests

- `test/compo.test.mjs` (npm test): the model, snapping, fields and formatters, house style, templates, the small-multiples grid, kinds through a PDF page, and atlas export.
- `test/compo-smoke.mjs` (Playwright): the editor driven by mouse and keys, the insertions (title block, image, small multiples), then the PDF read back by pdf.js and its render probed. Add `--bundled` to run it against `index.js`.
