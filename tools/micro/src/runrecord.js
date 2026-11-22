// micro RUN RECORDS (routines v2, step 3) — every routine run leaves a folder:
//
//   runs/<local date> <hhmm> <routine>/
//     run.json        what ran: the routine (and the SHA-256 of its file), the micro build, the inputs
//                     answered, every layer read (each file's name, size and SHA-256), every step
//                     (its expanded settings — automatic values pinned — status, duration, values,
//                     warnings, the outputs it wrote with their SHA-256), the resume / retry / skip
//                     events, and the run's status
//     <reports>.tsv   the steps' tables (unless the routine sends them elsewhere with output.dir)
//
// run.json is rewritten after every step, so a crash leaves a record of what had happened. A resume
// continues the SAME record. Nothing in a record is edited afterwards (acceptance, step 4, lives in a
// sidecar beside it), so the record can be signed as it stands.
import { S } from './state.js';
import { layerFiles, resolveFileHandle } from './paths.js';
import { sha256File, sha256Text } from './sha256.js';
import { layerById } from './state.js';

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d = new Date()) => `${localDate(d)} ${pad(d.getHours())}${pad(d.getMinutes())}`;
const slugOf = (s) => (String(s).toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'routine');
const now = () => new Date().toISOString();

// a layer's input files, with their hashes (waits for any hash still running)
export async function layerFingerprint(L) {
  const files = [];
  for (const f of layerFiles(L)) {
    if (!f.blob) { files.push({ role: f.role, name: f.name, size: null, sha256: null, note: 'not a file (made in this session)' }); continue; }
    files.push({ role: f.role, name: f.blob.name || f.name, size: f.blob.size, sha256: await sha256File(f.blob) });
  }
  return { name: L.name, label: L.label || L.name, kind: L.dh ? 'drillholes' : L.kind, files };
}

// a new record: picks a folder no earlier run has, hashes the routine's file and the layers it reads
export async function newRunRecord(r, steps, layerNames, onStatus) {
  const dir0 = `runs/${localStamp()} ${slugOf(r.name)}`;
  let dir = dir0, k = 2;
  for (;;) { const taken = await resolveFileHandle(S.project.dir, `${dir}/run.json`).then(() => true, () => false); if (!taken) break; dir = `${dir0}-${k++}`; }
  let routineHash = null;
  if (r.file) { try { routineHash = await sha256File(await (await resolveFileHandle(S.project.dir, r.file)).getFile()); } catch { /* not on disk (a routine made in code) */ } }
  if (!routineHash) routineHash = sha256Text(JSON.stringify({ name: r.name, params: r.params }));
  const layers = [];
  for (const nm of layerNames) {
    const L = S.layers.find((x) => x.name === nm || (x.label || x.name) === nm);
    if (!L) continue;
    if (onStatus) onStatus(`hashing ${L.label || L.name}…`);
    layers.push(await layerFingerprint(L));
  }
  return {
    v: 1, dir,
    routine: { name: r.name, file: r.file || null, sha256: routineHash },
    micro: S.build, started: now(), finished: null, status: 'running',
    inputs: r._inputs || null,
    layers,
    steps: steps.map((st, i) => ({ n: i + 1, step: st.guard ? 'guard' : st._slug, status: 'pending' })),
    events: [{ at: now(), kind: 'start' }],
  };
}

export async function writeRecord(rec) {
  const fh = await resolveFileHandle(S.project.dir, `${rec.dir}/run.json`, { create: true });
  const w = await fh.createWritable(); await w.write(JSON.stringify(rec, null, 1) + '\n'); await w.close();
}

// an output's entry: its path, size and hash
export async function outputEntry(path, text) {
  if (text != null) return { path, bytes: new TextEncoder().encode(text).length, sha256: sha256Text(text) };
  try { const f = await (await resolveFileHandle(S.project.dir, path)).getFile(); return { path, bytes: f.size, sha256: await sha256File(f) }; }
  catch { return { path, bytes: null, sha256: null }; }
}

// hash a layer's files as it opens, in the background — a routine then rarely waits for it
addEventListener('micro:layer-added', (e) => {
  const L = e.detail && layerById(e.detail.id);
  if (!L) return;
  for (const f of layerFiles(L)) if (f.blob) sha256File(f.blob).catch(() => {});
});
