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

## wuffle's cover: THE WUFFLE

A waffle whose grid is a lower-hemisphere equal-area stereonet — the net's 10° graticule baked in as the
ridges — with a chocolate chip at each of Tocher's 200 poles and maple syrup wherever their Kamb density
reaches 4σ (its edge IS the 4σ contour; it runs deeper where the poles crowd). Every position is wuffle's:
`waffle-data.mjs` exports the projected graticule, the poles and the Kamb field from bearing into
`waffle.json`; `waffle.py` builds the waffle, chips and syrup from that in Blender and renders it in Cycles.
Not a generated image: a figure. What is placed comes from the data (every ridge, every chip, the syrup's
extent); what is merely *food* is seeded noise, identical every run:
- the batter: crests that rise and fall, uneven pocket floors, batter bubbles, an irregular rim, crumbs;
  browned by height (crests and rim darkest) with multi-scale mottling, toasted speckle, pores, subsurface;
- the chips: six chip shapes (flat base, irregular sides, a curled tip), sizes varied, one in ten tipped
  over; tempered chocolate with a little bloom — and, where they sit in the syrup, sunk a little and glossy;
- the syrup: transmissive amber with absorption (darker where deeper), drips running over the rim and down
  the side where the pool reaches the edge (metaballs);
- the light: a warm studio HDRI — Poly Haven's *brown_photostudio_02* (CC0, fetched into `assets/`) — a low
  sun raking the ridges, a softbox only the wet surfaces see, a shadow catcher onto the cover's basalt.

    node tools/wuffle/docs/manual/build.mjs waffle      # ~15 min on a laptop GPU; --res= --samples= to taste
    node tools/wuffle/docs/manual/build.mjs pdf

Without a render, the cover falls back to `art.png`, the density net (`art.mjs`, `node build.mjs cover`).
`on-basalt.mjs` composites a transparent render onto the cover's ground, to judge it as it will print.

Files: `art.mjs` → `art.png`; `waffle-data.mjs` → `waffle.json`; `waffle.py` → `waffle.png`;
`chapters/00-title.tex` composes the page and picks the caption that matches the figure.
