// How to stage each screenshot the book asks for (figures/wanted/<group>.txt names them).
// One scene file per group in scenes/ (A.mjs … F.mjs), each `export const SCENES = { name: fn }`.
//
// A scene starts from the demo project as it opens (build.mjs resets windows, filter, selection
// between scenes — but a scene that changes deeper state, e.g. hides a layer, recolors, moves the
// camera or the section, must put it back, or do its changes in a way the next reset undoes),
// sets the state up in the page, and returns what to capture:
//   {}                              the whole micro window
//   { el: '<selector>' }            one element (the last match) — a floating window, a dialog, a panel
//   { clip: {x,y,width,height} }    a region of the page (CSS px; the viewport is 1440 × 900)
//   wait: ms before capture; blankOk: true when there is no 3D in the picture
//   after: async () => {} — run after the capture, to undo deeper state the scene changed
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'scenes');
export const SCENES = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
  const m = await import(pathToFileURL(join(dir, f)).href);
  for (const [k, v] of Object.entries(m.SCENES || {})) {
    if (SCENES[k]) console.log(`scenes: ${k} is defined twice (${f})`);
    SCENES[k] = v;
  }
}
