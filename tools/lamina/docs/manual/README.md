# The lamina manual (LaTeX)

The typeset manual for lamina: a LuaLaTeX book whose screenshots are made by driving lamina itself, so
they can't go stale. Started 2026-11-27 on the wuffle manual's design and method.

## Build

```
node build.js --target=lamina                         # the shots are taken from a BUILT lamina.html
node tools/lamina/docs/manual/build.mjs               # shots · print · pdf → build/lamina-manual.pdf
node tools/lamina/docs/manual/build.mjs pdf           # the book only
node tools/lamina/docs/manual/build.mjs shots --only gt-report,dq
```

**Which lamina is shot:** `work/lamina.html` when it exists (a PINNED build — copy one there to write and
shoot against a fixed version while lamina itself changes), else `lamina.html` at the repo root. `work/` is
gitignored; so are `build/` and the generated `figures/shots/` and `figures/print/`.

Needs Node with Playwright (the repo's dev dependency) and a TeX distribution with LuaLaTeX, biber and
latexmk. The fonts are the micro manual's (`tools/micro/docs/manual/fonts/`, all OFL), read in place.

## Layout

| path | what |
|---|---|
| `lamina-manual.tex` | the book's main file |
| `style/lamina.sty` | the design — a FORK of `wuffle.sty`, itself a fork of `micro.sty` (see below) |
| `references.bib` | the works the book cites — not yet checked against publishers' records |
| `chapters/` | one file per chapter; `index.tex` lists them in order |
| `figures/wanted/shots.txt` | the screenshots the book asks for |
| `scenes.mjs`, `scenes/*.mjs` | how to stage each screenshot in a live lamina |
| `build.mjs` | the harness |
| `OUTLINE.md` | the whole book, written and not |
| `BUGS.md` | bugs and confusing behaviour found while writing, for the code track |

Write in the micro manual's voice: `tools/micro/docs/manual/STYLE.md` applies as it stands (plain, second
person, a real menu path and a real number, a try-it per chapter, no summaries). Code blocks are the
`codeblock` environment (fvextra Verbatim), never `listings`, which displaces non-ASCII characters.
Chapters still waiting on the code track carry a `pending` box.

## The style is the third copy

micro → wuffle → lamina: three copies of the same `.sty` with the names changed. They should become one
shared GCU book style. That is a separate decision (it touches all three builds), deliberately not taken
here.

## Keeping it true

Every claim was run against the pinned build with the probes in `work/probes/` (`node work/probe.mjs
<probe>`; fixtures from `work/make-fixtures.mjs`). Writing it found the bugs in `BUGS.md`. Where the book
describes a bug, it says what you see and how to get round it; change the sentence when the fix lands.
