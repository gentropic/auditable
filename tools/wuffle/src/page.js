// wuffle — a project INSIDE a page: "Save as page" writes a wuffle.html that carries its project, so one
// file sent to someone opens straight into the data. The page is the built wuffle.html as it arrived (the
// loader keeps a copy before anything runs: window.__wufflePage) plus one block:
//
//   <script type="application/zip" id="wuffle-project" data-encoding="gzip" data-name="…">base64…</script>
//
// — the .zip.wuffle bytes (project-file.js), gzipped, base64, kept apart from the runtime (which the
// loader gzips separately). So any wuffle page can open another's project: File → Open reads only the
// block, never runs the other page.

const BLOCK = /<script\b[^>]*\bid="wuffle-project"[^>]*>([\s\S]*?)<\/script>\s*/;
const RUNTIME = /<script type="text\/plain" id="wuffle-rt">/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');   // > too: inside a tag it would end the block's match

async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));

/** a .zip.wuffle's bytes → the block's HTML */
export async function projectBlock(zipBytes, name = 'untitled') {
  const gz = await pipe(zipBytes, new CompressionStream('gzip'));
  return `<script type="application/zip" id="wuffle-project" data-encoding="gzip" data-name="${esc(name)}">\n${b64(gz).replace(/.{1,100}/g, '$&\n')}</script>\n`;
}

/** a page's HTML → its project's .zip.wuffle bytes, or null when it carries none */
export async function projectFromPage(html) {
  const m = BLOCK.exec(String(html)); if (!m) return null;
  const raw = unb64(m[1]);
  return /data-encoding="gzip"/.test(m[0]) ? pipe(raw, new DecompressionStream('gzip')) : raw;
}

/** the block's text (its identity: an autosave slot per received page), or null */
export const blockText = (html) => BLOCK.exec(String(html))?.[1].replace(/\s/g, '') || null;

/** the pristine page + a project → the page to save (an old block replaced; the title names the project) */
export function pageWithProject(pageHtml, block, name) {
  // the deployed site wraps its PWA tags (manifest, service worker) in these markers: a page someone saves
  // and sends is a standalone file, not an install of gentropic.org/wuffle, so they don't travel with it
  let html = String(pageHtml).replace(BLOCK, '').replace(/<!--wuffle-pwa-->[\s\S]*?<!--\/wuffle-pwa-->\n?/g, '');
  if (!RUNTIME.test(html)) throw new Error('this is not a built wuffle page (no runtime block) — Save as page works from wuffle.html');
  html = html.replace(RUNTIME, (m) => block + m);
  if (name) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(name)} — wuffle</title>`);
  return html;
}

/** does this text look like an HTML page (rather than a CSV)? */
export const isPage = (text) => /^\s*(<!doctype html|<html)/i.test(String(text).slice(0, 200));

/** a short stable hash of a string (FNV-1a) — names the autosave slot of a page's project */
export function hashText(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
