# The cover — the GCU DD-60 "DADA Diskman"

The series' house style (wuffle's `cover/README.md`): basalt ground, the kicker, the name in the display face,
the amber rule, the subtitle, and a figure captioned at the foot like any figure in the book.

lamina's figure is the **DD-60**, the "DADA Diskman" (a de-branded Data Discman DD-8 that is already a skin of
the Works book reader), made an object: a portrait charcoal body, a raised lid with a big lime LCD, round
rubber keys, NO / YES, four arrow buttons in an elliptical recess, and beside it the file on an 8 cm disc in
its caddy (the Electronic Book discs came in caddies: a ribbed body, a brushed shutter, a printed label).
The modelling follows the DD-8 reference photos kept with the skin's private prototype.

What on it is data, and what isn't:
- **the screen** (`lcd.mjs`) is drawn at LCD resolution from lamina's own sample block model (the same
  generator as `openSampleData`): rows 55,691–55,705, the Cu_pct of 1 % and over shown inverse, a grade bar
  per row, lamina's actions on the F-key tab bar. Every pixel snapped to the panel's three inks.
- **the label** (`label.mjs`) names the file and what lamina reads off it.
- the device, its keys and the caddy are modelled (`dd60.py`), not data. The plastic carries a fine moulded
  grain in its normal and roughness, not a printed texture.

    node tools/lamina/docs/manual/build.mjs dd60                 # ~10–20 min on a laptop GPU
    node tools/lamina/docs/manual/build.mjs dd60 --res 900 --samples 64   # a quick look

It writes `cover/cover.png` (transparent, a shadow catcher's shadow) and lays it on the page's basalt with
wuffle's `on-basalt.mjs` → `cover/cover.jpg`, which the title page places page-wide over its lower 240 mm.
The studio light is wuffle's HDRI (`tools/wuffle/docs/manual/cover/assets/`, fetched by its waffle step);
without it the render uses its area lights alone.
