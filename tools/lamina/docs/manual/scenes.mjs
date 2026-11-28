// How to stage each screenshot in a live lamina: the scenes of scenes/*.mjs, merged (one file per group of
// chapters, so several people can add scenes at once). A scene gets { p, ev, openText, openB64, sample } in
// a FRESH page and returns { el?, els?, clip?, wait? }: el = a selector to capture instead of the whole
// window, els = the box around several. `viewport` sets the window size, `dark` the colour scheme.
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'scenes');
export const SCENES = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
  const m = await import(pathToFileURL(join(dir, f)).href);
  for (const [k, v] of Object.entries(m.SCENES || {})) {
    if (SCENES[k]) throw new Error(`scene ${k} is defined twice (scenes/${f})`);
    SCENES[k] = v;
  }
}
