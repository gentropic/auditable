# The cover — a GCU field manual

A proposed house style for every GCU manual's cover (wuffle's is the first):

**The cover is a figure the tool drew.** Generated at build time from the tool's own sample data, by the
tool's own code — never an illustration — and captioned at the foot like any figure in the book: what it
shows, from which data, by which method. The book's subject, auditable even on the cover.

Shared (the series):
- basalt ground; the kicker `A GCU FIELD MANUAL` in spaced display caps, amber;
- the tool's name in the display face (Barlow Semi Condensed), large; the amber rule; a light subtitle;
- the figure rising out of the lower right, cropped by the page edge;
- at the foot: `Cover.` + the figure's caption, then `Geoscientific Chaos Union · gentropic.org/<tool>`.

Individual (each book): the figure, and its palette.
- wuffle — the Tocher (1979) net: Fisher-kernel density, Kamb contours, every great circle and pole
  (teal → amber → bone).
- micro (suggested) — a section through the demo deposit: block grades, the drillholes, the topography.
- lamina — its own heat-mapped table of a real file's columns; gslib — a kriged map with its variogram;
  moncad — a drawing at the frame's true coordinates.

Files: `art.mjs` draws `art.png` (transparent, 2800 px); `chapters/00-title.tex` composes the page.
`node build.mjs cover` redraws it (and `pdf` does when the art is missing).
