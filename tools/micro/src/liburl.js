// micro liburl — where a library lives, for a WORKER to import. A module worker
// has no import map: the built file maps '#name' to a blob URL in its import
// map, so that URL is the answer there; the dev tree has no such entry, so the
// path relative to this module (devRel, from tools/micro/src/) is.
export function libUrl(name, devRel) {
  try { const u = import.meta.resolve('#' + name); if (/^(blob|https?|file):/.test(u)) return u; } catch { /* not mapped */ }
  return new URL(devRel, import.meta.url).href;
}
