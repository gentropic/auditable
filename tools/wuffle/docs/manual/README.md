# The wuffle manual (LaTeX)

The typeset manual for wuffle: a LuaLaTeX book whose screenshots are made by driving wuffle itself, so
they can't go stale. Started 2026-11-26 on the micro manual's design and method.

## Build

```
node build.js --target=wuffle                         # the shots are taken from the BUILT wuffle.html
node tools/wuffle/docs/manual/build.mjs               # shots · print · pdf → build/wuffle-manual.pdf
node tools/wuffle/docs/manual/build.mjs pdf           # the book only
node tools/wuffle/docs/manual/build.mjs shots --only console
```

Needs Node with Playwright (the repo's dev dependency) and a TeX distribution with LuaLaTeX, biber and
latexmk (MiKTeX or TeX Live, 2025 or later). The fonts are the micro manual's
(`tools/micro/docs/manual/fonts/`, all OFL), read in place.

## Layout

| path | what |
|---|---|
| `wuffle-manual.tex` | the book's main file |
| `style/wuffle.sty` | the design — a FORK of `micro.sty` with the names changed (see its header) |
| `references.bib` | the works wuffle builds on — not yet checked against publishers' records |
| `chapters/` | one file per chapter; `index.tex` lists them in order |
| `figures/wanted/shots.txt` | the screenshots the book asks for |
| `scenes.mjs` | how to stage each screenshot in a live wuffle |
| `build.mjs` | the harness |
| `OUTLINE.md` | the whole book, written and not |

Write in the micro manual's voice: `tools/micro/docs/manual/STYLE.md` applies here as it stands (plain,
second person, a real menu path and a real number, a try-it per chapter, no summaries).

## Keeping it true

Every console line and try-it in the book has been run against the built page (the probe lives in the
gitignored `experiments/wuffle-manual-probe.mjs`). Writing the first six chapters that way found:
`ls -l` hid symlinks, `150>60` in the shell is a redirect, the compass took `200>20` as a plane, the
declination never updated after the first fix, the README claimed a `sed` and `awk` geas doesn't have,
and an undo puts the selection back. The desk part found eight more: labels drew nothing, a column of
`045→30` lines opened as planes, dip-direction and trend roses were drawn mirrored (axial by default), a
second contour set was skipped without a word, "remove from everywhere (N diagrams)" counted layers,
Properties → Apply took several undos, a CSV added to a zip by hand drew nothing, and photo names lost
their seconds. Keep doing it: a claim that hasn't run is a guess.
