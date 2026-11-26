// How to stage each screenshot in a live wuffle: the scenes of scenes/*.mjs, merged (one file per group of
// chapters, so several people can add scenes at once). A scene gets { p, ev } (the Playwright page and
// page.evaluate) in a FRESH page, and returns { el?, wait? }: el = a selector to capture instead of the
// whole window. `query` picks the home (?desk by default), `viewport` the window size.
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
