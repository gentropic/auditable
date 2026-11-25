# The micro manual (LaTeX)

The typeset manual for micro: a LuaLaTeX book whose screenshots, charts and tool reference are made
by driving micro itself, so they can't go stale.

## Build

```
node tools/micro/docs/manual/build.mjs              # everything → tools/micro/docs/manual/build/micro-manual.pdf
node tools/micro/docs/manual/build.mjs shots --only gt-window,tour-opened
node tools/micro/docs/manual/build.mjs data tools pdf
```

## Publishing

CI can't build the book (no TeX, no GPU for the screenshots), so it travels as a release asset
attached by hand after the release workflow has run:

```
gh release upload vX.Y.Z tools/micro/docs/manual/build/micro-manual.pdf --clobber
```

micro's Pages publish (`../micro/.github/workflows/publish.yml`) fetches it from the newest release
that carries one into `docs/`, so the docs page's `micro-manual.pdf` link is same-origin. It is never
committed to either repo.

Phases: **tools** (Appendix C from `window.micro.tools()`), **data** (every `data` line in
`figures/wanted/*.txt` run through `window.micro.runTool` on the demo project → `figures/data/*.tsv`),
**shots** (every screenshot named in `figures/wanted/*.txt`, staged by `scenes/<group>.mjs`),
**print** (each shot's print copy, at most 1800 px wide as JPEG or PNG, whichever is smaller →
`figures/print/`; runs before every pdf), **pdf** (latexmk). A screenshot with no scene yet prints as a labelled placeholder.

Needs: Node with Playwright (the repo's dev dependency), and a TeX distribution with LuaLaTeX, biber and
latexmk (MiKTeX or TeX Live, 2025 or later). Fonts ship in `fonts/` (Barlow, Barlow Semi Condensed,
Space Mono, Noto Sans Math — all OFL); the build points `TTFONTS` at that folder.

## Layout

| path | what |
|---|---|
| `micro-manual.tex` | the book's main file |
| `style/micro.sty` | the design: page, fonts, colors, chapter/part openers, boxes, code, figures |
| `references.bib` | the works micro builds on (biblatex/biber, author–year); every entry checked against its publisher's record |
| `chapters/` | one file per chapter; `index.tex` lists them in order |
| `figures/wanted/<group>.txt` | the screenshots and charts each group of chapters asks for |
| `scenes/<group>.mjs` | how to stage each screenshot in a live micro |
| `build.mjs` | the harness |
| `STYLE.md` | how to write for the book (voice, macros, figures, accuracy) |
| `OUTLINE.md` | the book's structure and labels |

Generated (gitignored): `build/`, `figures/shots/`, `figures/print/`, `figures/data/`, `chapters/C-tools.tex`.
