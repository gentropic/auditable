# The cover — Site C

micro's manual follows the GCU field-manual cover (wuffle's is the first; see
`tools/wuffle/docs/manual/cover/README.md` for the series rules): basalt, the kicker, the name, the amber
rule, the subtitle, and a figure rising out of the lower right, captioned at the foot.

**micro's figure:** a geologist's desk. Site C's geological map, printed on an A3 sheet at 1 : 5 000, and three
serial sections — A–A′, B–B′, C–C′, cut across the fold through the three drill fences — painted in gouache on
glass plates at 1 : 10 000 and put down on the map. The way deposits were modelled before computers, and the
thing micro does now: sections through a body of data.

Every line comes from one implicit model, micro's **Site C** sample (`tools/micro/src/site-c.js`, opened under
File → Sample data by `samples.js openSiteC`): plain functions answering "which rock, what grade" at any point,
so the cover and the sample are provably the same deposit:
- a shelf sequence (quartzite, banded iron formation, marble, phyllite, metavolcanics) on a gneiss basement;
- folded into an antiform trending 040°, plunging 11° NE, its axial plane inclined (vergence SE);
- cut by a normal fault (strike 120°, dip 65° SW, 70 m throw);
- intruded by a granite stock with a skarn where it meets the marble;
- eroded: low hills, a valley along the fault, a thin regolith;
- gold where the BIF thickens in the fold hinge (a plunging shoot), and in the skarn.

`plates-data.mjs` draws the sheet and the plates from it: the contacts, the classic ornaments, strike and dip
(the gradient of the stratigraphic field), the fault and fold traces (solved on the topography), 5 m contours,
the drill fences and section lines, the ore envelope hatched in vermilion; a full legend and title block
(`plates-draw.js` is its drawing half, run in a page). The name lives in one constant (`NAME`). Then
`plates.py` lays them out in Blender: the paper flat under the glass (a wave and an old fold elsewhere), the
plates DROPPED a few millimetres and left to settle as rigid bodies — so they really rest on one another —
a desk lamp's warm pool, a dim fill, a strip and a card that only the glass sees (its edges and margins).

    node tools/micro/docs/manual/build.mjs plates     # ~10–15 min on a laptop GPU; --res= --samples= to taste
    node tools/micro/docs/manual/build.mjs pdf

Quick looks without Blender: `node sketch.mjs out.png` (the map and two sections, flat, in seconds).
Files: `../../../src/site-c.js` (the model) → `plates-data.mjs` + `plates-draw.js` → `textures/`, `plates.json` →
`plates.py` → `plates.png` → `on-basalt.mjs` → `plates-cover.jpg` (all outputs gitignored).
The studio HDRI is Poly Haven's *brown_photostudio_02* (CC0), fetched into `assets/` by the build.
