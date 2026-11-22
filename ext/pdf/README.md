# @gcu/pdf

A small PDF writer with a **canvas-2D drawing context**: code that draws on a canvas draws a
**vector** PDF page. Paths become PDF paths, text is text in the standard PDF fonts, images are
embedded at their own resolution. Zero dependencies, no WASM. Deflate uses the platform's
`CompressionStream`, so it runs in browsers, workers, Node 18+ and Deno.

```js
import { PdfDocument } from '@gcu/pdf';

const doc = new PdfDocument({ title: 'Section 7 000 400' });
const ctx = doc.addPage('A4', 'landscape').getContext('2d', { units: 'mm' });
ctx.fillStyle = '#1f77b4';
ctx.fillRect(20, 20, 120, 60);                 // mm from the top-left, as on a canvas
ctx.font = '12px sans-serif';                  // → Helvetica
ctx.fillText('FE ≥ 55', 20, 100);              // ≥ is written as >= in the standard fonts
ctx.drawImage(render3d, 150, 20, 120, 90);     // a canvas, an ImageBitmap, ImageData, or {jpeg, width, height}
const bytes = await doc.save();                // Uint8Array
```

## Pages

`doc.addPage(size, orientation, { units })` takes three forms:
- `addPage('A4')` or `addPage('A3', 'landscape')`. The sizes are A0–A5, Letter, Legal and Tabloid.
- `addPage([w, h])` in mm.
- `addPage({ width, height })` in points.

`page.getContext('2d', { units: 'mm' | 'pt' })` sets the units of the context's user space, which
follows canvas convention: origin at the top-left, y down. Helpers: `pageSize(name, orientation)`,
`PAGE_SIZES` (points), `mm(v)`.

## The context

It is a `CanvasRenderingContext2D` subset that covers what drawing code uses:

- **Paths:** `moveTo`, `lineTo`, `bezierCurveTo`, `quadraticCurveTo`, `arc`, `arcTo`, `ellipse`, `rect`, `roundRect` and `closePath`; `fill` (nonzero or evenodd), `stroke` and `clip`; `fillRect` and `strokeRect`.
- **Styles:** `fillStyle` and `strokeStyle` take any CSS colour (hex, `rgb()`/`rgba()`, named). Also `globalAlpha`, `lineWidth`, `lineCap`, `lineJoin`, `miterLimit`, `setLineDash` and `lineDashOffset`.
- **Text:** `fillText` and `strokeText` (with `maxWidth`), `measureText`, `font`, `textAlign`, `textBaseline`.
- **Images:** `drawImage` (3, 5 and 9 arguments), `putImageData`, `imageSmoothingEnabled` (written as `/Interpolate`). Alpha becomes a soft mask. A source drawn twice is embedded once.
- **State:** `save`/`restore`, `translate`, `scale`, `rotate`, `transform`, `setTransform`, `resetTransform`.

A transform applies to what is drawn after it, as on a canvas, and scales line widths and dashes.

What PDF can't express here is reported once through `doc.warnings` and `onWarn`, never dropped
silently:
- gradients and patterns are drawn as their first colour stop;
- shadows, filters and composite operations other than source-over are not drawn;
- `Path2D` is not supported.

`clearRect` does nothing, because a PDF page has no pixels to clear.

## Fonts

A CSS `font` picks one of the **standard fonts**, which every reader carries, so nothing is embedded:
- a monospace stack becomes **Courier**;
- a serif stack becomes **Times**;
- anything else becomes **Helvetica**;
- `bold` selects the bold face.

Courier advances exactly 0.6 em per glyph, the same advance `@gcu/plot` lays its labels out with,
so plot's text lands where its layout put it.

Text is encoded as WinAnsi: ASCII, Latin-1 and the typographic marks (– — ‘ ’ “ ” • … €). A few
characters GCU text uses are written in plain form: `−` → `-`, `≥` → `>=`, `→` → `->`. Any other
character is written as `?` with a warning (an embedded font would carry it; that's planned, not
built).

## Documents

The document options are `{ title, author, subject, keywords, creator, created, compress, onWarn, strict }`:
- `created` (a `Date`) makes output byte-identical for identical input.
- `compress: false` leaves content streams readable, for debugging.
- `strict` turns warnings into errors.

Fonts, transparency states and images are shared across pages.

## Used by

- `@gcu/plot`: `fig.toPDF()` and `savefig('x.pdf')` replay the figure's draw list onto a page.
- `@gcu/compo`, the GCU page composer (planned), for pages and atlases.
- micro, for figures and report pages, keeping micro's no-network, no-WASM rules.

## Tests

- `test/pdf.test.mjs` checks the file structure (every cross-reference offset resolves) and each operator.
- `test/pdf-smoke.mjs` reads the output back with pdf.js in Chromium and renders it. The render matches the same drawing on a canvas: 99.4% of pixels for the reference scene, 99.1% for a plot figure.
