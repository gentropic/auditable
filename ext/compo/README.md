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

## Kinds

| kind | content |
|---|---|
| `text` | `md` (`**bold**`, newlines), `size` (pt), `align`, `mono`, `color`, `pad`. Fields: `{fig}` `{page}` `{pages}` `{date}` `{title}`, and `${expr}`, which the host evaluates (`env.evalField(expr, env.vars, frame)`) |
| `image` | `src` (a data/blob URL, decoded by `ensureImages`) or a host-set `frame._img`. Also `fit` (`contain`/`cover`/`fill`), `smooth`, `meta`. `photo: true` → JPEG in a PDF |
| `drawlist` | `list`, a [@gcu/plot](../plot) `fig.toDrawList()`, replayed as vectors |
| `legend` | `title`, then either `entries: [{color, label}]` or `kind: 'ramp'` with `stops`, `hiLabel`/`loLabel`, optional `tail` |
| `scalebar` | `worldPerMm` + `units`, or `of: <frame id>` → that frame's `content.meta` |
| `north` | `north` (degrees clockwise from page-up), or `of` as above |

`registerKind(name, { label, draw(ctx, box, frame, env) })` adds one. The context is in **mm**, y down.

## Export

- `exportPDF(doc | [docs], { env, title, created, dpi, jpegQuality, compress })` → `Uint8Array`.
  - A list of documents is an **atlas**, one page each, with `{page}`/`{pages}` resolved.
  - `env.prepare(doc, { dpi, page })` runs before each page is drawn, so a host can re-render its frames at print resolution.
- `exportPNG(doc, { dpi, env })` → a PNG `Blob`.
- `renderPage(doc, ctx, env)` draws onto any 2D context in mm.

## The editor

`mountEditor(el, doc, { env, onChange, toolbar, frameMenu, inspector })` returns `{ getDoc, setDoc, selected, select, addFrame, update, render, zoomFit, undo, redo, destroy }`.

- **Selecting and moving:** click to select, ⇧-click to add to the selection. Drag to move; the frame snaps to the margins, the page centre and other frames, with guides shown (⌥ while dragging turns snapping off).
- **Resizing:** eight handles; ⇧ on a corner keeps the aspect ratio.
- **Keys:** arrows nudge 0.5 mm, ⇧ + arrow 5 mm. ⌘D duplicates, Delete removes, ⌘Z / ⌘⇧Z undo and redo, ⌘A selects all.
- **Toolbar:** align, distribute, z-order and page setup.
- **Inspector:** the selected frame's box in mm, its border, and its kind's own fields.
- **Host hooks:** a host adds toolbar buttons, items in the frame context menu, and inspector rows. Its `update(id, fn)` changes a frame as one undo step.
- **Theming:** the editor's colours read `--compo-*`, then the host's `--text` / `--border` / `--accent` / `--bg-btn`.

## Tests

- `test/compo.test.mjs` (npm test): the model, snapping, fields, kinds through a PDF page, and atlas export.
- `test/compo-smoke.mjs` (Playwright): the editor driven by mouse and keys, then the PDF read back by pdf.js and its render probed. Add `--bundled` to run it against `index.js`.
