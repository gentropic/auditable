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
import { sha256File, sha256Text, Sha256 } from './sha256.js';
import { ensureStoredValues } from './columns.js';
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

// ── runs, baselines, acceptance ──
// every run in the project: [{ dir, rec, accepted }] (newest first). A folder without a readable
// run.json is skipped.
export async function listRuns() {
  const out = [];
  let runs;
  try { runs = await S.project.dir.getDirectoryHandle('runs'); } catch { return out; }
  for await (const [name, h] of runs.entries()) {
    if (h.kind !== 'directory') continue;
    let rec = null, accepted = null;
    try { rec = JSON.parse(await (await (await h.getFileHandle('run.json')).getFile()).text()); } catch { continue; }
    try { accepted = JSON.parse(await (await (await h.getFileHandle('accepted.json')).getFile()).text()); } catch { /* not accepted */ }
    out.push({ dir: `runs/${name}`, rec, accepted });
  }
  return out.sort((a, b) => String(b.rec.started).localeCompare(String(a.rec.started)));
}

// the run a new run compares against: the latest ACCEPTED run of the same routine, else its latest
// successful one. null: none yet (checks against it are then "not evaluated").
export async function findBaseline(routineName, excludeDir) {
  const runs = (await listRuns()).filter((x) => x.rec.routine && x.rec.routine.name === routineName && x.dir !== excludeDir && x.rec.status === 'ok');
  const acc = runs.filter((x) => x.accepted).sort((a, b) => String(b.accepted.at).localeCompare(String(a.accepted.at)));
  const pick = acc[0] || runs[0] || null;
  return pick ? { dir: pick.dir, rec: pick.rec, accepted: !!pick.accepted } : null;
}

// accept a run as the baseline: a SIDECAR beside run.json (the record itself stays as written, so
// it can be signed as it stands). by: a typed name — there are no accounts.
export async function acceptRun(dir, by, note = '') {
  const fh = await resolveFileHandle(S.project.dir, `${dir}/accepted.json`, { create: true });
  const body = { by: String(by || '').trim() || 'unnamed', at: new Date().toISOString(), note: String(note || '') };
  const w = await fh.createWritable(); await w.write(JSON.stringify(body, null, 1) + '\n'); await w.close();
  return body;
}

// a step's table from a record (the machine TSV it wrote, read back with its key)
export async function recordTable(entry, parse) {
  const o = entry && entry.outputs && entry.outputs.find((x) => /\.tsv$/i.test(x.path));
  if (!o) return null;
  try { return parse(await (await (await resolveFileHandle(S.project.dir, o.path)).getFile()).text(), entry.key); } catch { return null; }
}

// ── the CACHE (routines v2, step 6): a step whose inputs, settings and micro build match an earlier
// successful step — and whose outputs still hash as recorded — is reused instead of run again. Its
// files are copied into this run's folder; the record says which run they came from. ──
// The inputs are a FINGERPRINT per layer the step reads: its source files' SHA-256 and every derived
// column it carries (calc expressions; painted and materialized columns' contents) — a repainted
// domain or an edited calc column is a new fingerprint, never a stale reuse.
const canon = (v) => {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
};
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
export async function layerDerivedHash(L) {
  const sh = new Sha256(), enc = (s) => sh.update(new TextEncoder().encode(String(s)));
  enc(canon((L.calcCols || []).map((c) => ({ name: c.name, expr: c.expr, ty: c.ty || 'number' }))));
  const cols = L.paintCols || [];
  if (cols.some((c) => c.mat && !c.fvalues)) await ensureStoredValues(L, new Set(cols.filter((c) => c.mat).map((c) => String(c.name).toLowerCase())));
  for (const c of cols) {
    enc(`|${c.name}|${c.kind || ''}|${canon(c.dict || [])}|`);
    if (c.mat && c.fvalues) sh.update(bytesOf(c.fvalues)); else if (c.codes) sh.update(bytesOf(c.codes));
  }
  return sh.hex();
}
export async function stepFingerprints(layerNames) {
  const out = [];
  for (const nm of [...new Set(layerNames)].sort()) {
    const L = S.layers.find((x) => x.name === nm || (x.label || x.name) === nm);
    if (!L) { out.push({ name: nm, missing: true }); continue; }
    const fp = await layerFingerprint(L);
    out.push({ name: nm, files: fp.files.map((f) => f.sha256 || `session:${f.name}`), derived: await layerDerivedHash(L) });
  }
  return out;
}
export const stepKey = (tool, params, fingerprints) => sha256Text(canon({ build: S.build, tool, params, layers: fingerprints }));

// an earlier step with this key whose outputs are still the recorded bytes → { dir, entry } | null
export async function findCachedStep(key, excludeDir) {
  for (const x of await listRuns()) {
    if (x.dir === excludeDir) continue;
    for (const e of x.rec.steps || []) {
      if (!e || e.cacheKey !== key || e.status !== 'ok' || !Array.isArray(e.outputs) || !e.outputs.length) continue;
      let intact = true;
      for (const o of e.outputs) {
        try { const f = await (await resolveFileHandle(S.project.dir, o.path)).getFile(); if (f.size !== o.bytes || (await sha256File(f)) !== o.sha256) { intact = false; break; } }
        catch { intact = false; break; }
      }
      if (intact) return { dir: x.dir, entry: e };
    }
  }
  return null;
}
// copy a cached step's outputs into this run's folder (same bytes, so the same hashes)
export async function copyOutputs(entry, intoDir) {
  const outs = [];
  for (const o of entry.outputs) {
    const f = await (await resolveFileHandle(S.project.dir, o.path)).getFile();
    const to = `${intoDir}/${o.path.split('/').pop()}`;
    const fh = await resolveFileHandle(S.project.dir, to, { create: true }); const w = await fh.createWritable(); await w.write(f); await w.close();
    outs.push({ path: to, bytes: o.bytes, sha256: o.sha256 });
  }
  return outs;
}
